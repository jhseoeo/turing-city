import { describe, expect, it } from 'vitest';
import { wreckFacility } from '../src/boards.ts';
import type { FacilityAction } from '../src/firmware-host.ts';
import { MICRO } from '../src/fixed.ts';
import { stateHash } from '../src/hash.ts';
import { sensorFrame } from '../src/sensors.ts';
import { replay, Session } from '../src/session.ts';
import { dispatch, dispatchProblem, runWarehouses, stepsPerCell } from '../src/warehouse.ts';
import { findFacility } from '../src/world.ts';
import { FakeHost } from './helpers/fake-host.ts';
import { m2Scenario } from './helpers/scenarios.ts';

type Dispatch = Extract<FacilityAction, { kind: 'dispatch' }>;

/** A dispatch: truck 1 collecting 10 from F1, unless a test says otherwise. */
const d = (over: Partial<Omit<Dispatch, 'kind'>> = {}): Dispatch => ({
  kind: 'dispatch',
  truck: 1,
  from: 'F1',
  to: 'W',
  amount: 10,
  ...over,
});

const TRIP = 'a truck collects from a farm to the warehouse, or delivers from the warehouse to a housing block';
const AMOUNT = 'the amount must be a whole number from 1 to 40';

/** The milestone-2 town on steady, free power, with no raid. */
function town(change?: Parameters<typeof m2Scenario>[0], host = new FakeHost()): Session {
  const s = new Session(
    m2Scenario((j) => {
      j.tuning.wind.start = 220;
      j.tuning.wind.maxChangePerSecond = 0;
      j.tuning.fuelPrice = { start: 0, min: 0, max: 0 };
      j.tuning.emf.rumourThreshold = 1_000_000_000;
      change?.(j);
    }),
    1,
    host,
  );
  s.world.plant.thermalSetting = 300;
  return s;
}

/** The warehouse's board is installed at the start; it has no firmware until a test deploys some. */
const withBoard: Parameters<typeof m2Scenario>[0] = (j) => {
  Object.assign(j.facilities.find((f) => f.id === 'W')!.board!, { startsInstalled: true });
};

/** Runs the world through step `last`: afterwards it is at step last + 1. */
function runThrough(s: Session, last: number): void {
  while (s.world.step <= last) s.step();
}

describe('the warehouse', () => {
  it('collects: drives a cell every stepsPerCell steps, takes the outbox at the farm, and stocks it back home', () => {
    const s = town();
    const wh = s.world.warehouses.W!;
    const truck = wh.trucks[0]!;
    s.world.farms.F1!.outbox = 30;
    expect(stepsPerCell(s.ctx)).toBe(10); // 2 cells a second at 20 steps a second
    expect(s.hand('W', d({ amount: 40 }))).toEqual({ ok: true });
    // The press applies at once: the truck is on its way before a step has run, and its first leg starts at the press step.
    expect(truck).toMatchObject({
      status: 'outbound',
      x: 11,
      y: 6,
      cellsDone: 0,
      legFrom: 0,
      load: 0,
      job: { kind: 'collect', targetId: 'F1', amount: 40 },
    });
    runThrough(s, 9);
    expect([truck.x, truck.y]).toEqual([11, 6]); // the first cell comes on step 10, not before
    runThrough(s, 10);
    expect([truck.x, truck.y]).toEqual([10, 6]); // one cell along the row on step 10
    runThrough(s, 119);
    // W (11, 6) to F1 (2, 9) is 9 cells along the row and 3 down: one more to go
    expect(truck).toMatchObject({ status: 'outbound', x: 2, y: 8, cellsDone: 11 });
    runThrough(s, 120); // the last of its 12 cells, on step 120
    expect(truck).toMatchObject({ status: 'returning', x: 2, y: 9, load: 30 });
    expect(s.world.farms.F1!.outbox).toBe(0);
    runThrough(s, 130);
    expect([truck.x, truck.y]).toEqual([3, 9]); // the way back is row first too
    runThrough(s, 239);
    expect(truck).toMatchObject({ status: 'returning', x: 11, y: 7, cellsDone: 11, load: 30 });
    runThrough(s, 240); // and home on step 240
    expect(truck).toMatchObject({ status: 'idle', x: 11, y: 6, load: 0, job: null, path: [], cellsDone: 0 });
    expect(wh.stockMilli).toBe(30_000);
    expect(s.world.ledger.truckFuel).toBe(24 * MICRO); // 12 cells out and 12 back, at 1 a cell
  });

  it('delivers: loads at dispatch, unloads at the housing block, and drives back empty', () => {
    const s = town();
    const wh = s.world.warehouses.W!;
    const h1 = s.world.housing.H1!;
    const truck = wh.trucks[1]!;
    wh.stockMilli = 50_000;
    const food = h1.foodMilli;
    const money = s.world.money;
    dispatch(s.ctx, 'W', d({ truck: 2, from: 'W', to: 'H1', amount: 30 }), 0);
    expect(wh.stockMilli).toBe(20_000);
    expect(truck).toMatchObject({ status: 'outbound', load: 30, job: { kind: 'deliver', targetId: 'H1', amount: 30 } });
    for (let step = 0; step <= 139; step++) runWarehouses(s.ctx, step);
    expect(truck).toMatchObject({ status: 'outbound', x: 2, y: 2, load: 30 }); // a cell short of the block, and still loaded
    expect(h1.foodMilli).toBe(food);
    runWarehouses(s.ctx, 140); // W (11, 6) to H1 (2, 1) is 9 + 5 cells: there on step 140
    expect(truck).toMatchObject({ status: 'returning', x: 2, y: 1, load: 0 });
    expect(h1.foodMilli).toBe(food + 30_000);
    for (let step = 141; step <= 279; step++) runWarehouses(s.ctx, step);
    expect(truck).toMatchObject({ status: 'returning', x: 11, y: 5 });
    runWarehouses(s.ctx, 280);
    expect(truck).toMatchObject({ status: 'idle', x: 11, y: 6, load: 0, job: null });
    expect(s.world.ledger.truckFuel).toBe(28 * MICRO);
    expect(money - s.world.money).toBe(28 * MICRO); // the fuel is paid from the town's money
  });

  it('carries no more than the stock, its capacity, or the amount, and collects no more than the outbox holds', () => {
    const s = town();
    const wh = s.world.warehouses.W!;
    const h2 = s.world.housing.H2!;
    const food = h2.foodMilli;
    wh.stockMilli = 25_500; // 25 whole units and half of one
    dispatch(s.ctx, 'W', d({ truck: 1, from: 'W', to: 'H2', amount: 40 }), 0);
    expect(wh.trucks[0]!.load).toBe(25);
    expect(wh.stockMilli).toBe(500);
    s.world.farms.F2!.outbox = 30;
    dispatch(s.ctx, 'W', d({ truck: 2, from: 'F2', amount: 10 }), 0);
    // W to F2 (3, 9) is 8 + 3 cells, and W to H2 (17, 1) is 6 + 5: both trucks are there on step 110
    for (let step = 0; step <= 110; step++) runWarehouses(s.ctx, step);
    expect(wh.trucks[1]!.load).toBe(10);
    expect(s.world.farms.F2!.outbox).toBe(20);
    expect(h2.foodMilli).toBe(food + 25_000); // the block gets what was loaded, not the 40 that were asked for
  });

  it('refuses what a truck cannot do, and says why', () => {
    const s = town();
    const wh = s.world.warehouses.W!;
    expect(dispatchProblem(s.ctx, 'W', d())).toBeNull();
    expect(dispatchProblem(s.ctx, 'W', d({ truck: 3 }))).toBe('there is no truck 3; trucks are 1-2');
    expect(dispatchProblem(s.ctx, 'W', d({ truck: 1.5 }))).toBe('there is no truck 1.5; trucks are 1-2');
    expect(dispatchProblem(s.ctx, 'W', d({ amount: 0 }))).toBe(AMOUNT);
    expect(dispatchProblem(s.ctx, 'W', d({ amount: 41 }))).toBe(AMOUNT);
    expect(dispatchProblem(s.ctx, 'W', d({ amount: 2.5 }))).toBe(AMOUNT);
    expect(dispatchProblem(s.ctx, 'W', d({ amount: 1 }))).toBeNull(); // the ends of the range are allowed
    expect(dispatchProblem(s.ctx, 'W', d({ amount: 40 }))).toBeNull();
    expect(dispatchProblem(s.ctx, 'W', d({ from: 'F1', to: 'H1' }))).toBe(TRIP);
    expect(dispatchProblem(s.ctx, 'W', d({ from: 'W', to: 'F1' }))).toBe(TRIP);
    expect(dispatchProblem(s.ctx, 'W', d({ from: 'H1', to: 'W' }))).toBe(TRIP);
    expect(dispatchProblem(s.ctx, 'W', d({ from: 'W', to: 'H1' }))).toBe('the warehouse has no food to deliver');
    wh.stockMilli = 999; // not one whole unit
    expect(dispatchProblem(s.ctx, 'W', d({ from: 'W', to: 'H1' }))).toBe('the warehouse has no food to deliver');
    wh.stockMilli = 1_000;
    expect(dispatchProblem(s.ctx, 'W', d({ from: 'W', to: 'H1' }))).toBeNull();
    wh.trucks[0]!.status = 'outbound';
    expect(dispatchProblem(s.ctx, 'W', d())).toBe('truck 1 is on the road');
    wh.trucks[0]!.status = 'returning';
    expect(dispatchProblem(s.ctx, 'W', d())).toBe('truck 1 is on the road');
    findFacility(s.world, 'W')!.condition = 'wrecked';
    expect(dispatchProblem(s.ctx, 'W', d({ truck: 2 }))).toBe('the warehouse is wrecked');
    findFacility(s.world, 'W')!.condition = 'repairing';
    expect(dispatchProblem(s.ctx, 'W', d({ truck: 2 }))).toBe('the warehouse is wrecked'); // it does not stand until its repair is done
    expect(dispatchProblem(s.ctx, 'F1', d())).toBe('not a warehouse');
  });

  it('names only the first thing that is wrong, in a fixed order', () => {
    const s = town();
    const wh = s.world.warehouses.W!;
    const home = findFacility(s.world, 'W')!;
    const bad = d({ truck: 9, amount: 0, from: 'H1', to: 'W' }); // everything wrong at once
    expect(dispatchProblem(s.ctx, 'F1', bad)).toBe('not a warehouse');
    home.condition = 'wrecked';
    expect(dispatchProblem(s.ctx, 'W', bad)).toBe('the warehouse is wrecked');
    home.condition = 'ok';
    expect(dispatchProblem(s.ctx, 'W', bad)).toBe('there is no truck 9; trucks are 1-2');
    wh.trucks[0]!.status = 'outbound';
    expect(dispatchProblem(s.ctx, 'W', { ...bad, truck: 1 })).toBe('truck 1 is on the road');
    wh.trucks[0]!.status = 'idle';
    expect(dispatchProblem(s.ctx, 'W', { ...bad, truck: 1 })).toBe(AMOUNT);
    expect(dispatchProblem(s.ctx, 'W', { ...bad, truck: 1, from: 'W', to: 'H1' })).toBe(AMOUNT); // before "no food", as before the trip
    expect(dispatchProblem(s.ctx, 'W', { ...bad, truck: 1, amount: 5 })).toBe(TRIP);
    expect(dispatchProblem(s.ctx, 'W', { ...bad, truck: 1, amount: 5, from: 'W', to: 'H1' })).toBe('the warehouse has no food to deliver');
  });

  it('refuses a hand dispatch it cannot do, with its reason, and records nothing', () => {
    const s = town();
    expect(s.hand('W', d({ from: 'W', to: 'H1' }))).toEqual({
      ok: false,
      reason: 'W: the warehouse has no food to deliver',
      refusal: { code: 'cannotAct', facility: 'W', detail: 'the warehouse has no food to deliver' },
    });
    expect(s.record.inputs).toEqual([]);
  });

  it('keeps a truck on the road until it is home: the hand may not send it out again, out or back, and may after', () => {
    const s = town();
    s.world.farms.F1!.outbox = 30;
    const busy = {
      ok: false,
      reason: 'W: truck 1 is on the road',
      refusal: { code: 'cannotAct', facility: 'W', detail: 'truck 1 is on the road' },
    };
    expect(s.hand('W', d())).toEqual({ ok: true });
    expect(s.hand('W', d())).toEqual(busy); // out
    runThrough(s, 120);
    expect(s.world.warehouses.W!.trucks[0]!.status).toBe('returning');
    expect(s.hand('W', d())).toEqual(busy); // back
    expect(s.hand('W', d({ truck: 2 }))).toEqual({ ok: true }); // the other one is free
    runThrough(s, 240);
    expect(s.world.warehouses.W!.trucks[0]!.status).toBe('idle');
    expect(s.hand('W', d())).toEqual({ ok: true });
  });

  it('is dispatched by firmware with io.dispatch(), and reads its stock, the farms, the housing blocks, and its trucks', () => {
    const host = new FakeHost();
    const frames: Array<Record<string, unknown>> = [];
    const runner = host.program('runner', (sensors) => {
      frames.push({ ...sensors });
      return frames.length === 1 ? { actions: [{ kind: 'dispatch', truck: 1, from: 'F2', to: 'W', amount: 20 }] } : {};
    });
    const s = town(withBoard, host);
    s.world.farms.F2!.outbox = 20;
    s.world.warehouses.W!.stockMilli = 7_500;
    s.deploy('W', runner);
    while (frames.length === 0) s.step(); // W's first beat is step 6 (2 Hz, its index 4 for the phase)
    expect(frames[0]).toMatchObject({
      day: 1,
      stock: 7, // whole units
      farms: [
        { id: 'F1', outbox: 0, distance: 12 },
        { id: 'F2', outbox: 20, distance: 11 },
        { id: 'F3', outbox: 0, distance: 10 },
      ],
      housing: [
        { id: 'H1', food: expect.any(Number), residents: 40, distance: 14 },
        { id: 'H2', food: expect.any(Number), residents: 40, distance: 11 },
      ],
      trucks: [
        { id: 1, status: 'idle', x: 11, y: 6, load: 0, target: undefined },
        { id: 2, status: 'idle', x: 11, y: 6, load: 0, target: undefined },
      ],
    });
    const truck = s.world.warehouses.W!.trucks[0]!;
    // Like every firmware action it acts from the step after its tick: the leg starts on step 7, and the first cell comes on 17.
    expect(truck).toMatchObject({ status: 'outbound', legFrom: 7, job: { kind: 'collect', targetId: 'F2', amount: 20 } });
    runThrough(s, 16);
    expect([truck.x, truck.y]).toEqual([11, 6]);
    runThrough(s, 17);
    expect([truck.x, truck.y]).toEqual([10, 6]);
  });

  it('skips a firmware dispatch the warehouse cannot do: a truck already on the road goes on with its trip', () => {
    const host = new FakeHost();
    let beats = 0;
    const eager = host.program('eager', () => {
      beats += 1;
      // Truck 1 is sent to F1 on the first beat, and asked for F2 on every later one, while it is out.
      return { actions: [{ kind: 'dispatch', truck: 1, from: beats === 1 ? 'F1' : 'F2', to: 'W', amount: beats === 1 ? 30 : 5 }] };
    });
    const s = town(withBoard, host);
    s.world.farms.F1!.outbox = 30;
    s.world.farms.F2!.outbox = 30;
    s.deploy('W', eager);
    runThrough(s, 127); // the first beat is step 6, the leg starts on step 7, and its 12 cells end on step 127
    expect(beats).toBe(13); // beats on steps 6, 16, ..., 126: twelve of them were refused
    expect(s.world.warehouses.W!.trucks[0]).toMatchObject({
      status: 'returning',
      x: 2,
      y: 9,
      load: 30,
      legFrom: 127,
      job: { kind: 'collect', targetId: 'F1', amount: 30 },
    });
    expect(s.world.farms.F1!.outbox).toBe(0);
    expect(s.world.farms.F2!.outbox).toBe(30);
    expect(s.world.warehouses.W!.trucks[1]).toMatchObject({ status: 'idle', job: null });
  });

  it('shows a warehouse board its trucks as they are on the road, and its housing blocks in whole units of food', () => {
    const s = town(withBoard);
    const board = s.world.boards.find((b) => b.id === 'W')!;
    s.world.farms.F1!.outbox = 30;
    expect(s.hand('W', d({ amount: 40 }))).toEqual({ ok: true });
    runThrough(s, 10);
    s.world.housing.H1!.foodMilli = 12_999;
    s.world.housing.H2!.foodMilli = 500;
    expect(sensorFrame(s.ctx, board)).toMatchObject({
      housing: [
        { id: 'H1', food: 12 },
        { id: 'H2', food: 0 },
      ],
      trucks: [
        { id: 1, status: 'outbound', x: 10, y: 6, load: 0, target: 'F1' },
        { id: 2, status: 'idle', x: 11, y: 6, load: 0, target: undefined },
      ],
    });
    runThrough(s, 130);
    expect(sensorFrame(s.ctx, board)).toMatchObject({
      trucks: [{ id: 1, status: 'returning', x: 3, y: 9, load: 30, target: 'F1' }, { id: 2 }],
    });
  });

  it('lets its stock spoil by spoilagePctPerDay, split over the steps and rounded down', () => {
    const s = town();
    const wh = s.world.warehouses.W!;
    wh.stockMilli = 100_000;
    runWarehouses(s.ctx, 0);
    expect(wh.stockMilli).toBe(99_998); // 2% of 100 a day over 800 steps is 2.5 milli-units a step, taken as 2
  });

  it('spoils its stock once a step as the world runs', () => {
    const s = town();
    const wh = s.world.warehouses.W!;
    wh.stockMilli = 100_000;
    s.step();
    expect(wh.stockMilli).toBe(99_998);
    s.step();
    expect(wh.stockMilli).toBe(99_996);
  });

  it('lets a truck that reaches a farm in the very step its firmware harvests take that harvest: actions apply before trucks move', () => {
    const host = new FakeHost();
    const picker = host.program('picker', (sensors) => (sensors.ripeness === 100 ? { actions: [{ kind: 'harvest' }] } : {}));
    const s = town((j) => {
      j.tuning.farm = { ripenSeconds: 3, rotSeconds: 40, yield: 40, outboxCapacity: 80 }; // ripe 60 steps after planting
      Object.assign(j.facilities.find((f) => f.id === 'F1')!.board!, { startsInstalled: true });
    }, host);
    s.world.farms.F1!.plantedAt = 74; // F1's beat on step 134 is the first to read 100
    s.deploy('F1', picker);
    runThrough(s, 13);
    expect(s.hand('W', d({ amount: 40 }))).toEqual({ ok: true }); // pressed at step 14: its 12 cells end on step 134
    runThrough(s, 133);
    expect(s.world.farms.F1).toEqual({ plantedAt: 74, outbox: 0 });
    expect(s.world.warehouses.W!.trucks[0]).toMatchObject({ status: 'outbound', cellsDone: 11 });
    s.step(); // step 134: the harvest fills the outbox, and then the truck arrives
    expect(s.world.farms.F1).toEqual({ plantedAt: 135, outbox: 0 });
    expect(s.world.warehouses.W!.trucks[0]).toMatchObject({ status: 'returning', load: 40 });
  });

  it('lets trucks on the road finish their trips when the warehouse is wrecked, and takes no new dispatch', () => {
    const s = town();
    const wh = s.world.warehouses.W!;
    s.world.farms.F1!.outbox = 30;
    dispatch(s.ctx, 'W', d({ amount: 30 }), 0);
    findFacility(s.world, 'W')!.condition = 'wrecked';
    for (let step = 0; step <= 240; step++) runWarehouses(s.ctx, step);
    expect(wh.trucks[0]).toMatchObject({ status: 'idle', load: 0 });
    expect(wh.stockMilli).toBe(30_000);
    dispatch(s.ctx, 'W', d({ truck: 2 }), 241);
    expect(wh.trucks[1]!.status).toBe('idle');
  });

  it('keeps its stock and its idle trucks through a wreck and a repair, and the stock goes on spoiling', () => {
    const s = town();
    const wh = s.world.warehouses.W!;
    const home = findFacility(s.world, 'W')!;
    wh.stockMilli = 100_000;
    const trucks = JSON.parse(JSON.stringify(wh.trucks));
    const wrecked = s.world.step;
    wreckFacility(s.ctx, home, wrecked, 'luddites');
    expect(wh.stockMilli).toBe(100_000); // Luddites wreck machines, not food
    expect(wh.trucks).toEqual(trucks);
    expect(s.repair('W')).toEqual({ ok: true });
    const ready = home.repairReadyAt!;
    while (s.world.step <= ready) s.step();
    expect(home.condition).toBe('ok');
    expect(wh.trucks).toEqual(trucks);
    // Only spoilage took from the stock, wrecked and under repair too: 2 milli-units a step while it holds 80 units or more.
    expect(wh.stockMilli).toBe(100_000 - 2 * (s.world.step - wrecked));
  });

  it('replays a session of hand harvests and dispatches into the same state', () => {
    const scenario = m2Scenario((j) => {
      j.tuning.wind.maxChangePerSecond = 0;
      j.tuning.emf.rumourThreshold = 1_000_000_000;
      // The crop of three 40 s days, as farm.test.ts has it: ripe on step 2,400, and 24 food a harvest. The town's own farm numbers
      // are the playtest's to retune, and the steps below are not theirs.
      j.tuning.farm = { ripenSeconds: 120, rotSeconds: 40, yield: 24, outboxCapacity: 50 };
    });
    const live = new Session(scenario, 1, new FakeHost());
    const truck = live.world.warehouses.W!.trucks[0]!;
    expect(live.hand('P', { kind: 'setThermal', output: 300 })).toEqual({ ok: true });
    while (live.world.step < 2_400) live.step();
    expect(live.hand('F1', { kind: 'harvest' })).toEqual({ ok: true });
    expect(live.world.farms.F1!.outbox).toBe(24); // at once
    live.step(); // step 2,400
    expect(live.hand('W', d({ amount: 24 }))).toEqual({ ok: true }); // pressed at step 2,401: the leg starts there
    while (live.world.step < 2_641) live.step(); // 12 cells out, to F1 on step 2,521, and 12 back
    expect(truck).toMatchObject({ status: 'returning', load: 24 });
    live.step();
    expect(truck).toMatchObject({ status: 'idle', load: 0 }); // the truck is back with 24 on step 2,641
    expect(live.world.warehouses.W!.stockMilli).toBe(24_000);
    while (live.world.step < 2_700) live.step();
    expect(live.hand('W', d({ truck: 2, from: 'W', to: 'H1', amount: 20 }))).toEqual({ ok: true });
    while (live.world.step < 3_000) live.step();
    const again = replay(scenario, 1, live.record, new FakeHost(), live.world.step);
    expect(stateHash(again.world)).toBe(stateHash(live.world));
    expect(live.record.inputs).toEqual([
      { step: 0, kind: 'hand', facilityId: 'P', action: { kind: 'setThermal', output: 300 } },
      { step: 2_400, kind: 'hand', facilityId: 'F1', action: { kind: 'harvest' } },
      { step: 2_401, kind: 'hand', facilityId: 'W', action: d({ amount: 24 }) },
      { step: 2_700, kind: 'hand', facilityId: 'W', action: d({ truck: 2, from: 'W', to: 'H1', amount: 20 }) },
    ]);
  });
});
