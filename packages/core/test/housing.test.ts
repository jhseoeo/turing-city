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
    while (h1.fed && step < 5_000) runHousing(s.ctx, step++); // bounded, so that a block that never runs out fails and does not hang
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

  it("reads its numbers from the scenario, and rounds a step's meal and tax down", () => {
    const s = new Session(
      m2Scenario((j) => {
        j.time.secondsPerDay = 30; // 600 steps a day, which neither 22 food nor 88 money split evenly
        j.tuning.housing = { residents: 11, foodPerPersonPerDay: 2, power: 50, taxPerPersonPerDay: 8, startFood: 120 };
      }),
      1,
      new FakeHost(),
    );
    expect(mealMilli(s.ctx)).toBe(36); // 11 x 2 = 22 food a day over 600 steps: 36.67 milli
    expect(taxMicro(s.ctx)).toBe(146_666); // 11 x 8 = 88 a day over 600 steps: 146,666.67 micro
    expect(housingDraw(s.ctx, findFacility(s.world, 'H1')!)).toBe(50);
    expect(populationCounts(s.ctx)).toEqual({ fed: 22, hungry: 0, unpowered: 0 });
  });

  it('loses the food that cannot cover a meal', () => {
    const s = town();
    const h1 = s.world.housing.H1!;
    h1.foodMilli = 49; // a meal is 50
    runHousing(s.ctx, 0);
    expect(h1).toEqual({ foodMilli: 0, fed: false });
  });

  it('keeps one hunger episode for each block', () => {
    const s = town();
    s.world.housing.H1!.foodMilli = 0;
    s.world.housing.H2!.foodMilli = 0;
    runHousing(s.ctx, 0);
    expect(hungerAlerts(s).map((a) => [a.facilityId, a.step])).toEqual([
      ['H1', 0],
      ['H2', 0],
    ]);
    s.world.housing.H1!.foodMilli = 1_000; // H1 is fed again and H2 is not: only H1's episode ends
    runHousing(s.ctx, 1);
    s.world.housing.H1!.foodMilli = 0;
    runHousing(s.ctx, 2);
    expect(hungerAlerts(s).map((a) => [a.facilityId, a.step])).toEqual([
      ['H1', 0],
      ['H2', 0],
      ['H1', 2],
    ]);
  });

  it('counts a block that is both hungry and without power as hungry', () => {
    const s = town();
    s.world.housing.H1!.foodMilli = 0;
    findFacility(s.world, 'H1')!.powered = false;
    runHousing(s.ctx, 0);
    expect(populationCounts(s.ctx)).toEqual({ fed: 40, hungry: 40, unpowered: 0 });
  });

  it('eats and pays tax once in every step of the world', () => {
    const s = town();
    const before = s.world.money;
    s.step();
    expect(s.world.housing).toEqual({ H1: { foodMilli: 119_950, fed: true }, H2: { foodMilli: 119_950, fed: true } });
    expect(s.world.ledger.tax).toBe(2 * 250_000);
    expect(s.world.money - before).toBe(2 * 250_000); // nothing else in this town moves its money: no boards, no fuel, no jobs
  });

  it("reports a block's hunger in the step it starts", () => {
    const s = town();
    s.world.housing.H1!.foodMilli = 0;
    const report = s.step();
    expect(report.alerts.filter((a) => a.kind === 'hunger').map((a) => [a.facilityId, a.step])).toEqual([['H1', 0]]);
  });

  it('pays no tax for a block that the grid cuts in the same step', () => {
    const s = town();
    s.world.plant.thermalSetting = 0;
    s.world.plant.wind = 100; // 77 + 92 asked of 100: H2 is cut
    s.step();
    expect(findFacility(s.world, 'H2')!.powered).toBe(false);
    expect(s.world.ledger.tax).toBe(250_000); // H1 only
  });

  it("counts a step's tax in the money that the end check reads", () => {
    const s = town();
    s.world.money = -1; // one micro-unit below zero: this step's tax lifts it above before the check
    s.step();
    expect(s.world.belowZeroSince).toBeNull();
    expect(s.world.alerts.some((a) => a.kind === 'moneyBelowZero')).toBe(false);
  });

  it('feeds a block on the step a truck arrives, so that it never goes hungry', () => {
    const s = town();
    const h1 = s.world.housing.H1!;
    h1.foodMilli = 140 * 50; // seven thousand milli: enough through step 139
    s.world.warehouses.W!.stockMilli = 30_000;
    dispatch(s.ctx, 'W', { kind: 'dispatch', truck: 1, from: 'W', to: 'H1', amount: 30 }, 0);
    for (let i = 0; i < 140; i++) s.step(); // steps 0 to 139
    expect(h1).toEqual({ foodMilli: 0, fed: true });
    s.step(); // step 140: W to H1 is 14 cells at 10 steps each, so the truck unloads in phase 6 and the block eats from its load
    expect(h1).toEqual({ foodMilli: 30_000 - 50, fed: true });
    expect(hungerAlerts(s)).toEqual([]);
  });
});
