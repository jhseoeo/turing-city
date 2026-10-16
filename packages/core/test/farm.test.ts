import { describe, expect, it } from 'vitest';
import { harvest, harvestProblem, isRipe, ripeness, ripenSteps, rotSteps, runFarms } from '../src/farm.ts';
import { facilityDemand } from '../src/power.ts';
import { Session } from '../src/session.ts';
import { findFacility } from '../src/world.ts';
import { FakeHost } from './helpers/fake-host.ts';
import { m2Scenario } from './helpers/scenarios.ts';

/** The milestone-2 town on steady, free power, with no raid. `withBoard` installs F1's board at the start. */
function town(withBoard = false, host = new FakeHost()): Session {
  const s = new Session(
    m2Scenario((j) => {
      j.tuning.wind.start = 220;
      j.tuning.wind.maxChangePerSecond = 0;
      j.tuning.fuelPrice = { start: 0, min: 0, max: 0 };
      j.tuning.emf.rumourThreshold = 1_000_000_000;
      if (withBoard) Object.assign(j.facilities.find((f) => f.id === 'F1')!.board!, { startsInstalled: true });
    }),
    1,
    host,
  );
  s.world.plant.thermalSetting = 300;
  return s;
}

describe('farms', () => {
  it('ripens after ripenSeconds, its ripeness counting up to 100', () => {
    const s = town();
    const farm = s.world.farms.F1!;
    expect(ripenSteps(s.ctx)).toBe(800); // 40 s at 20 steps a second
    expect(rotSteps(s.ctx)).toBe(400); // 20 s
    expect([0, 1, 200, 400, 799, 800, 1_000].map((step) => ripeness(s.ctx, farm, step))).toEqual([0, 0, 25, 50, 99, 100, 100]);
    expect(isRipe(s.ctx, farm, 799)).toBe(false);
    expect(isRipe(s.ctx, farm, 800)).toBe(true);
  });

  it('harvests a ripe crop into the outbox and replants; an unripe field gives nothing', () => {
    const s = town();
    const farm = s.world.farms.F1!;
    harvest(s.ctx, 'F1', 799);
    expect(farm).toEqual({ plantedAt: 0, outbox: 0 });
    harvest(s.ctx, 'F1', 800);
    expect(farm).toEqual({ plantedAt: 800, outbox: 40 });
    harvest(s.ctx, 'F1', 801); // just replanted: nothing is ripe
    expect(farm).toEqual({ plantedAt: 800, outbox: 40 });
  });

  it('fills the outbox to its capacity and wastes the rest', () => {
    const s = town();
    const farm = s.world.farms.F1!;
    farm.outbox = 70;
    harvest(s.ctx, 'F1', 800);
    expect(farm.outbox).toBe(80); // 70 + 40 is 110, and the outbox holds 80
    farm.plantedAt = 0;
    harvest(s.ctx, 'F1', 800); // into a full outbox: the whole crop is wasted, and the field replants all the same
    expect(farm).toEqual({ plantedAt: 800, outbox: 80 });
  });

  it('rots a crop left ripe for rotSeconds, and replants', () => {
    const s = town();
    const farm = s.world.farms.F1!;
    runFarms(s.ctx, 1_199); // ripe since step 800: 399 steps
    expect(farm.plantedAt).toBe(0);
    runFarms(s.ctx, 1_200); // 400 steps: it rots
    expect(farm).toEqual({ plantedAt: 1_200, outbox: 0 });
  });

  it('rots in the running world: Session.step runs the farms', () => {
    const s = town();
    while (s.world.step < 1_200) s.step();
    expect(s.world.farms.F1!.plantedAt).toBe(0); // ripe for 399 steps
    s.step(); // step 1,200: the rot time is up
    expect(s.world.farms.F1).toEqual({ plantedAt: 1_200, outbox: 0 });
  });

  it("logs a rotted crop on the farm's board", () => {
    const s = town(true);
    runFarms(s.ctx, 1_200);
    expect(s.world.boards[0]!.log.at(-1)).toMatchObject({ kind: 'system', text: 'crop rotted' });
  });

  it('is harvested by hand: the press applies at once, and a field with nothing ripe is refused', () => {
    const s = town();
    expect(s.hand('F1', { kind: 'harvest' })).toEqual({
      ok: false,
      reason: 'F1: nothing is ripe',
      refusal: { code: 'cannotAct', facility: 'F1', detail: 'nothing is ripe' },
    });
    while (s.world.step < 800) s.step();
    expect(s.hand('F1', { kind: 'harvest' })).toEqual({ ok: true });
    expect(s.world.farms.F1).toEqual({ plantedAt: 800, outbox: 40 }); // between steps, with no step run
    expect(s.world.farms.F2).toEqual({ plantedAt: 0, outbox: 0 }); // the others wait for their own harvest
  });

  it('is harvested by firmware with io.harvest(), which reads ripeness and outbox', () => {
    const host = new FakeHost();
    const seen: Array<[unknown, unknown]> = [];
    const picker = host.program('picker', (sensors) => {
      seen.push([sensors.ripeness, sensors.outbox]);
      return sensors.ripeness === 100 ? { actions: [{ kind: 'harvest' }] } : {};
    });
    const s = town(true, host);
    s.deploy('F1', picker);
    while (s.world.step < 900) s.step();
    expect(seen[0]).toEqual([1, 0]); // F1's first beat, at step 14 (1 Hz, phase 6), reads 1
    // the beat at 794 reads 99 (79400 over 800, rounded down); the one at 814 reads 100 and harvests, and the harvest takes hold from the next step
    expect(seen.find(([r]) => r === 100)).toEqual([100, 0]);
    expect(s.world.farms.F1).toEqual({ plantedAt: 815, outbox: 40 });
  });

  it('neither ripens into a harvest nor rots while wrecked', () => {
    const s = town();
    findFacility(s.world, 'F1')!.condition = 'wrecked';
    expect(harvestProblem(s.ctx, 'F1', 800)).toBe('the farm is wrecked');
    harvest(s.ctx, 'F1', 800);
    runFarms(s.ctx, 1_200);
    expect(s.world.farms.F1).toEqual({ plantedAt: 0, outbox: 0 });
  });

  it('replants when its repair finishes', () => {
    const s = town();
    const f1 = findFacility(s.world, 'F1')!;
    f1.condition = 'wrecked';
    expect(s.repair('F1')).toEqual({ ok: true });
    const ready = f1.repairReadyAt!;
    while (s.world.step <= ready) s.step();
    expect(f1.condition).toBe('ok');
    expect(s.world.farms.F1!.plantedAt).toBe(ready);
  });

  it('grows with no board and no power, and asks the grid for nothing', () => {
    const s = town();
    expect(facilityDemand(s.ctx, findFacility(s.world, 'F1')!, 0)).toBe(0);
    while (s.world.step <= 800) s.step();
    expect(isRipe(s.ctx, s.world.farms.F1!, s.world.step)).toBe(true);
  });
});
