import { describe, expect, it } from 'vitest';
import { housingDraw, mealMilli, populationCounts, runHousing, taxMicro } from '../src/housing.ts';
import { facilityDemand } from '../src/power.ts';
import { Session } from '../src/session.ts';
import { dispatch, runWarehouses } from '../src/warehouse.ts';
import { findFacility } from '../src/world.ts';
import { FakeHost } from './helpers/fake-host.ts';
import { m2Scenario } from './helpers/scenarios.ts';

/** The milestone-2 town on steady, free power, with no raid. */
function town(): Session {
  const s = new Session(
    m2Scenario((j) => {
      j.tuning.wind.start = 220;
      j.tuning.wind.maxChangePerSecond = 0;
      j.tuning.fuelPrice = { start: 0, min: 0, max: 0 };
      j.tuning.emf.rumourThreshold = 1_000_000_000;
    }),
    1,
    new FakeHost(),
  );
  s.world.plant.thermalSetting = 300;
  return s;
}

const hungerAlerts = (s: Session) => s.world.alerts.filter((a) => a.kind === 'hunger');

describe('housing', () => {
  it('starts every block with the tuned food', () => {
    const s = town();
    expect(s.world.housing).toEqual({ H1: { foodMilli: 120_000, fed: true }, H2: { foodMilli: 120_000, fed: true } });
  });

  it("eats its residents' food a day, split over the steps", () => {
    const s = town();
    expect(mealMilli(s.ctx)).toBe(50); // 40 people x 1 a day, over 800 steps
    runHousing(s.ctx, 0);
    expect(s.world.housing.H1).toEqual({ foodMilli: 119_950, fed: true });
  });

  it('runs out after its food lasts, and goes hungry: 120 food feed 40 people for 3 days', () => {
    const s = town();
    const h1 = s.world.housing.H1!;
    let step = 0;
    while (h1.fed) runHousing(s.ctx, step++);
    expect(step).toBe(2_401); // fed through step 2,399, three days of 800 steps; hungry at step 2,400
    expect(h1.foodMilli).toBe(0);
  });

  it('pays tax for a block that is fed and powered, and none for one hungry or without power', () => {
    const s = town();
    expect(taxMicro(s.ctx)).toBe(250_000); // 40 people x 5 a day, over 800 steps
    runHousing(s.ctx, 0);
    expect(s.world.ledger.tax).toBe(2 * 250_000); // both blocks
    findFacility(s.world, 'H2')!.powered = false;
    runHousing(s.ctx, 1);
    expect(s.world.ledger.tax).toBe(3 * 250_000); // H1 only
    s.world.housing.H1!.foodMilli = 0;
    runHousing(s.ctx, 2);
    expect(s.world.ledger.tax).toBe(3 * 250_000); // H1 hungry, H2 without power
  });

  it('raises one hunger alert when a block goes hungry, and another only after it was fed again', () => {
    const s = town();
    s.world.housing.H1!.foodMilli = 0;
    for (let step = 0; step < 5; step++) runHousing(s.ctx, step);
    expect(hungerAlerts(s).map((a) => [a.facilityId, a.step, a.message])).toEqual([['H1', 0, 'H1 주민이 굶고 있어요']]);
    s.world.housing.H1!.foodMilli = 1_000;
    runHousing(s.ctx, 5);
    s.world.housing.H1!.foodMilli = 0;
    runHousing(s.ctx, 6);
    expect(hungerAlerts(s).map((a) => a.step)).toEqual([0, 6]);
  });

  it('draws its power from the grid with transmission loss, and goes without when the grid cuts it', () => {
    const s = town();
    const h1 = findFacility(s.world, 'H1')!;
    const h2 = findFacility(s.world, 'H2')!;
    expect(housingDraw(s.ctx, h1)).toBe(70);
    expect(housingDraw(s.ctx, findFacility(s.world, 'DA')!)).toBe(0);
    expect(facilityDemand(s.ctx, h1, 0)).toBe(77); // 5 cells from the plant: + 10%
    expect(facilityDemand(s.ctx, h2, 0)).toBe(92); // 16 cells: + 32%
    s.world.plant.thermalSetting = 0;
    s.world.plant.wind = 100; // 100 made against 77 + 92 asked: H2, the later of the two in the default order, is cut
    s.step();
    expect([h1.powered, h2.powered]).toEqual([true, false]);
    expect(populationCounts(s.ctx)).toEqual({ fed: 40, hungry: 0, unpowered: 40 });
  });

  it('counts residents as fed, hungry, or without power', () => {
    const s = town();
    runHousing(s.ctx, 0);
    expect(populationCounts(s.ctx)).toEqual({ fed: 80, hungry: 0, unpowered: 0 });
    s.world.housing.H1!.foodMilli = 0;
    findFacility(s.world, 'H2')!.powered = false;
    runHousing(s.ctx, 1);
    expect(populationCounts(s.ctx)).toEqual({ fed: 0, hungry: 40, unpowered: 40 });
  });

  it('runs in every step of a session: the blocks eat and the town collects tax', () => {
    const s = town();
    s.step();
    s.step();
    expect(s.world.housing.H1).toEqual({ foodMilli: 120_000 - 2 * 50, fed: true });
    expect(s.world.ledger.tax).toBe(2 * 2 * 250_000); // two blocks, two steps
  });

  it('feeds a hungry block again when a truck delivers', () => {
    const s = town();
    const h1 = s.world.housing.H1!;
    h1.foodMilli = 0;
    runHousing(s.ctx, 0);
    expect(h1.fed).toBe(false);
    s.world.warehouses.W!.stockMilli = 30_000;
    dispatch(s.ctx, 'W', { kind: 'dispatch', truck: 1, from: 'W', to: 'H1', amount: 30 }, 1);
    for (let step = 1; step <= 141; step++) runWarehouses(s.ctx, step); // W to H1 is 14 cells: there on step 141
    runHousing(s.ctx, 142);
    expect(h1).toEqual({ foodMilli: 30_000 - 50, fed: true });
    expect(hungerAlerts(s)).toHaveLength(1);
  });
});
