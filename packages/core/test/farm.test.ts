import { describe, expect, it } from 'vitest';
import { wreckFacility } from '../src/boards.ts';
import { harvest, harvestProblem, isRipe, ripeness, ripenSteps, rotSteps, runFarms } from '../src/farm.ts';
import { stateHash } from '../src/hash.ts';
import { facilityDemand } from '../src/power.ts';
import { sensorFrame } from '../src/sensors.ts';
import { replay, Session } from '../src/session.ts';
import { findFacility } from '../src/world.ts';
import { FakeHost } from './helpers/fake-host.ts';
import { m2Scenario } from './helpers/scenarios.ts';

/**
 * The milestone-2 town on steady, free power, with no raid. `withBoard` installs F1's board at the start. The crop is the one of
 * three 40 s days: the numbers below are written against it, and the town's own farm tuning, which the playtest retunes, is not theirs.
 */
function town(withBoard = false, host = new FakeHost()): Session {
  const s = new Session(
    m2Scenario((j) => {
      j.tuning.wind.start = 220;
      j.tuning.wind.maxChangePerSecond = 0;
      j.tuning.fuelPrice = { start: 0, min: 0, max: 0 };
      j.tuning.emf.rumourThreshold = 1_000_000_000;
      j.tuning.farm = { ripenSeconds: 120, rotSeconds: 40, yield: 24, outboxCapacity: 50 };
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
    expect(ripenSteps(s.ctx)).toBe(2_400); // 120 s at 20 steps a second
    expect(rotSteps(s.ctx)).toBe(800); // 40 s
    expect([0, 1, 600, 1_200, 2_399, 2_400, 3_000].map((step) => ripeness(s.ctx, farm, step))).toEqual([0, 0, 25, 50, 99, 100, 100]);
    expect(isRipe(s.ctx, farm, 2_399)).toBe(false);
    expect(isRipe(s.ctx, farm, 2_400)).toBe(true);
  });

  it('reads a crop that was planted a step ahead as not grown at all', () => {
    // A firmware harvest in step s replants at s + 1, so for the rest of that step the crop is planted in the future.
    const s = town();
    expect(ripeness(s.ctx, { plantedAt: 101, outbox: 0 }, 100)).toBe(0);
    expect(isRipe(s.ctx, { plantedAt: 101, outbox: 0 }, 100)).toBe(false);
  });

  it('harvests a ripe crop into the outbox and replants; an unripe field gives nothing', () => {
    const s = town();
    const farm = s.world.farms.F1!;
    harvest(s.ctx, 'F1', 2_399);
    expect(farm).toEqual({ plantedAt: 0, outbox: 0 });
    harvest(s.ctx, 'F1', 2_400);
    expect(farm).toEqual({ plantedAt: 2_400, outbox: 24 });
    harvest(s.ctx, 'F1', 2_401); // just replanted: nothing is ripe
    expect(farm).toEqual({ plantedAt: 2_400, outbox: 24 });
  });

  it('fills the outbox to its capacity and wastes the rest', () => {
    const s = town();
    const farm = s.world.farms.F1!;
    farm.outbox = 40;
    harvest(s.ctx, 'F1', 2_400);
    expect(farm.outbox).toBe(50); // 40 + 24 is 64, and the outbox holds 50
    farm.plantedAt = 0;
    harvest(s.ctx, 'F1', 2_400); // into a full outbox: the whole crop is wasted, and the field replants all the same
    expect(farm).toEqual({ plantedAt: 2_400, outbox: 50 });
  });

  it('rots a crop left ripe for rotSeconds, and replants', () => {
    const s = town();
    const farm = s.world.farms.F1!;
    runFarms(s.ctx, 3_199); // ripe since step 2,400: 799 steps
    expect(farm.plantedAt).toBe(0);
    runFarms(s.ctx, 3_200); // 800 steps: it rots
    expect(farm).toEqual({ plantedAt: 3_200, outbox: 0 });
  });

  it("logs a rotted crop on the farm's board", () => {
    const s = town(true);
    runFarms(s.ctx, 3_200);
    expect(s.world.boards[0]!.log.at(-1)).toMatchObject({ kind: 'system', text: 'crop rotted' });
  });

  it('loses only the crop in the field to rot: the food already in the outbox stays', () => {
    const s = town();
    const farm = s.world.farms.F1!;
    farm.outbox = 10;
    runFarms(s.ctx, 3_200);
    expect(farm).toEqual({ plantedAt: 3_200, outbox: 10 });
  });

  it('rots a crop nobody harvests as the world steps, and says so on the board', () => {
    const s = town(true);
    while (s.world.step <= 3_200) s.step(); // ripe from step 2,400, and 800 steps later it rots
    expect(s.world.farms.F1).toEqual({ plantedAt: 3_200, outbox: 0 });
    expect(s.world.boards[0]!.log.at(-1)).toMatchObject({ step: 3_200, kind: 'system', text: 'crop rotted' });
    expect(s.world.farms.F2).toEqual({ plantedAt: 3_200, outbox: 0 }); // every farm rots, a farm with no board without a line
  });

  it('is harvested by hand: the press applies at once, and a field with nothing ripe is refused', () => {
    const s = town();
    const refused = {
      ok: false,
      reason: 'F1: nothing is ripe',
      refusal: { code: 'cannotAct', facility: 'F1', detail: 'nothing is ripe' },
    };
    expect(s.hand('F1', { kind: 'harvest' })).toEqual(refused);
    while (s.world.step < 2_399) s.step();
    expect(s.hand('F1', { kind: 'harvest' })).toEqual(refused); // a step short
    s.step();
    expect(s.hand('F1', { kind: 'harvest' })).toEqual({ ok: true });
    expect(s.world.farms.F1).toEqual({ plantedAt: 2_400, outbox: 24 }); // at once: the world has not stepped since the press
    expect(s.world.farms.F2).toEqual({ plantedAt: 0, outbox: 0 }); // the others wait for their own harvest
  });

  it('records a harvest by hand at the step it was made, refuses and records nothing otherwise, and replays into the same state', () => {
    const live = town();
    // The helper's thermal setting is no input: the hand sets it again, so that the replay starts from the same plant.
    live.hand('P', { kind: 'setThermal', output: 300 });
    expect(live.hand('F1', { kind: 'harvest' }).ok).toBe(false);
    while (live.world.step < 2_400) live.step();
    expect(live.hand('F1', { kind: 'harvest' })).toEqual({ ok: true });
    expect(live.hand('F1', { kind: 'harvest' }).ok).toBe(false); // just replanted
    expect(live.hand('DA', { kind: 'harvest' }).ok).toBe(false); // not a farm
    for (let i = 0; i < 50; i++) live.step();
    expect(live.record.inputs.filter((i) => i.kind === 'hand' && i.action.kind === 'harvest')).toEqual([
      { step: 2_400, kind: 'hand', facilityId: 'F1', action: { kind: 'harvest' } },
    ]);
    expect(live.world.stats.handActions).toBe(2); // the thermal setting and the harvest
    const again = replay(live.scenario, live.seed, live.record, new FakeHost(), live.world.step);
    expect(again.world.farms.F1).toEqual({ plantedAt: 2_400, outbox: 24 });
    expect(stateHash(again.world)).toBe(stateHash(live.world));
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
    while (s.world.step < 2_500) s.step();
    expect(seen[0]).toEqual([0, 0]); // F1's first beat, at step 14 (1 Hz, its index 6 for the phase)
    // the beat at 2,394 reads 99; the next, at 2,414, harvests, and like every firmware action it acts from the next step
    expect(s.world.farms.F1).toEqual({ plantedAt: 2_415, outbox: 24 });
    expect(seen.at(-1)).toEqual([3, 24]); // the beat at 2,494: the new crop is 79 steps old, and the food waits in the outbox
  });

  it('lets firmware save a crop in the very step it would rot: a step harvests before it rots', () => {
    const host = new FakeHost();
    // F1 beats at steps 14, 34, ...; this firmware waits for day 5, which starts at step 3,200, so its first harvest is at step 3,214.
    const late = host.program('late', (sensors) =>
      sensors.day === 5 && sensors.ripeness === 100 ? { actions: [{ kind: 'harvest' }] } : {},
    );
    const s = town(true, host);
    s.world.farms.F1!.plantedAt = 14; // ripe at step 2,414, and left to rot at step 3,214
    s.deploy('F1', late);
    while (s.world.step <= 3_214) s.step();
    expect(s.world.farms.F1).toEqual({ plantedAt: 3_215, outbox: 24 });
    expect(s.world.boards[0]!.log.map((l) => l.text)).not.toContain('crop rotted');
  });

  it('shows a farm board the ripeness of its crop and the food in its outbox, as of the step the world is at', () => {
    const s = town(true);
    const board = s.world.boards[0]!;
    const read = () => {
      const { ripeness, outbox } = sensorFrame(s.ctx, board);
      return [ripeness, outbox];
    };
    expect(read()).toEqual([0, 0]);
    while (s.world.step < 1_200) s.step();
    s.world.farms.F1!.outbox = 7;
    expect(read()).toEqual([50, 7]);
    while (s.world.step < 2_399) s.step();
    expect(read()).toEqual([99, 7]);
    s.step();
    expect(read()).toEqual([100, 7]);
  });

  it('neither ripens into a harvest nor rots while wrecked', () => {
    const s = town();
    findFacility(s.world, 'F1')!.condition = 'wrecked';
    expect(harvestProblem(s.ctx, 'F1', 2_400)).toBe('the farm is wrecked');
    harvest(s.ctx, 'F1', 2_400);
    runFarms(s.ctx, 3_200);
    expect(s.world.farms.F1).toEqual({ plantedAt: 0, outbox: 0 });
  });

  it('neither ripens into a harvest nor rots while its repair is under way', () => {
    const s = town();
    findFacility(s.world, 'F1')!.condition = 'repairing'; // as startRepair leaves it
    expect(harvestProblem(s.ctx, 'F1', 2_400)).not.toBeNull();
    harvest(s.ctx, 'F1', 2_400);
    runFarms(s.ctx, 3_200);
    expect(s.world.farms.F1).toEqual({ plantedAt: 0, outbox: 0 });
  });

  it('says that what is not a farm cannot be harvested, and harvests nothing of it', () => {
    const s = town();
    const before = stateHash(s.world);
    expect(harvestProblem(s.ctx, 'DA', 5_000)).toBe('not a farm');
    expect(harvestProblem(s.ctx, 'ZZ', 5_000)).toBe('not a farm');
    harvest(s.ctx, 'DA', 5_000);
    harvest(s.ctx, 'ZZ', 5_000);
    expect(stateHash(s.world)).toBe(before);
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

  it('keeps the food waiting in its outbox through a wreck and a repair: only the crop in the field is lost', () => {
    const s = town();
    const f1 = findFacility(s.world, 'F1')!;
    const farm = s.world.farms.F1!;
    farm.outbox = 24; // harvested, and not yet fetched by a truck
    while (s.world.step < 1_000) s.step(); // the crop in the field has grown for 1,000 steps
    wreckFacility(s.ctx, f1, s.world.step, 'luddites');
    expect(farm).toEqual({ plantedAt: 0, outbox: 24 });
    expect(s.repair('F1')).toEqual({ ok: true });
    const ready = f1.repairReadyAt!;
    while (s.world.step <= ready) s.step();
    expect(f1.condition).toBe('ok');
    expect(farm).toEqual({ plantedAt: ready, outbox: 24 }); // the field is replanted, and the box is as it was
  });

  it('grows with no board and no power, and asks the grid for nothing', () => {
    const s = town();
    expect(facilityDemand(s.ctx, findFacility(s.world, 'F1')!, 0)).toBe(0);
    while (s.world.step <= 2_400) s.step();
    expect(isRipe(s.ctx, s.world.farms.F1!, s.world.step)).toBe(true);
  });
});
