import { describe, expect, it } from 'vitest';
import type { FacilityAction } from '../src/firmware-host.ts';
import { MICRO } from '../src/fixed.ts';
import { stateHash } from '../src/hash.ts';
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

describe('the warehouse', () => {
  it('collects: drives a cell every stepsPerCell steps, takes the outbox at the farm, and stocks it back home', () => {
    const s = town();
    const wh = s.world.warehouses.W!;
    const truck = wh.trucks[0]!;
    s.world.farms.F1!.outbox = 30;
    expect(stepsPerCell(s.ctx)).toBe(10); // 2 cells a second at 20 steps a second
    expect(s.hand('W', d({ amount: 40 }))).toEqual({ ok: true });
    s.step(); // step 0 applies it: the truck sets out
    expect(truck).toMatchObject({
      status: 'outbound',
      x: 11,
      y: 6,
      cellsDone: 0,
      load: 0,
      job: { kind: 'collect', targetId: 'F1', amount: 40 },
    });
    while (s.world.step <= 10) s.step();
    expect([truck.x, truck.y]).toEqual([10, 6]); // one cell along the row by step 10
    while (s.world.step <= 120) s.step(); // W (11, 6) to F1 (2, 9) is 9 cells along the row and 3 down: there on step 120
    expect(truck).toMatchObject({ status: 'returning', x: 2, y: 9, load: 30 });
    expect(s.world.farms.F1!.outbox).toBe(0);
    while (s.world.step <= 240) s.step(); // and home on step 240
    expect(truck).toMatchObject({ status: 'idle', x: 11, y: 6, load: 0, job: null });
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
    dispatch(s.ctx, 'W', d({ truck: 2, from: 'W', to: 'H1', amount: 30 }), 0);
    expect(wh.stockMilli).toBe(20_000);
    expect(truck).toMatchObject({ status: 'outbound', load: 30, job: { kind: 'deliver', targetId: 'H1', amount: 30 } });
    for (let step = 0; step <= 140; step++) runWarehouses(s.ctx, step); // W (11, 6) to H1 (2, 1) is 9 + 5 cells: there on step 140
    expect(truck).toMatchObject({ status: 'returning', x: 2, y: 1, load: 0 });
    expect(h1.foodMilli).toBe(food + 30_000);
    for (let step = 141; step <= 280; step++) runWarehouses(s.ctx, step);
    expect(truck).toMatchObject({ status: 'idle', x: 11, y: 6, load: 0, job: null });
    expect(s.world.ledger.truckFuel).toBe(28 * MICRO);
  });

  it('carries no more than the stock, its capacity, or the amount, and collects no more than the outbox holds', () => {
    const s = town();
    const wh = s.world.warehouses.W!;
    wh.stockMilli = 25_500; // 25 whole units and half of one
    dispatch(s.ctx, 'W', d({ truck: 1, from: 'W', to: 'H2', amount: 40 }), 0);
    expect(wh.trucks[0]!.load).toBe(25);
    expect(wh.stockMilli).toBe(500);
    s.world.farms.F2!.outbox = 30;
    dispatch(s.ctx, 'W', d({ truck: 2, from: 'F2', amount: 10 }), 0);
    for (let step = 0; step <= 110; step++) runWarehouses(s.ctx, step); // W to F2 (3, 9) is 8 + 3 cells: there on step 110
    expect(wh.trucks[1]!.load).toBe(10);
    expect(s.world.farms.F2!.outbox).toBe(20);
  });

  it('refuses what a truck cannot do, and says why', () => {
    const s = town();
    const wh = s.world.warehouses.W!;
    expect(dispatchProblem(s.ctx, 'W', d())).toBeNull();
    expect(dispatchProblem(s.ctx, 'W', d({ truck: 3 }))).toBe('there is no truck 3; trucks are 1-2');
    expect(dispatchProblem(s.ctx, 'W', d({ truck: 1.5 }))).toBe('there is no truck 1.5; trucks are 1-2');
    expect(dispatchProblem(s.ctx, 'W', d({ amount: 0 }))).toBe('the amount must be a whole number from 1 to 40');
    expect(dispatchProblem(s.ctx, 'W', d({ amount: 41 }))).toBe('the amount must be a whole number from 1 to 40');
    expect(dispatchProblem(s.ctx, 'W', d({ amount: 2.5 }))).toBe('the amount must be a whole number from 1 to 40');
    const trip = 'a truck collects from a farm to the warehouse, or delivers from the warehouse to a housing block';
    expect(dispatchProblem(s.ctx, 'W', d({ from: 'F1', to: 'H1' }))).toBe(trip);
    expect(dispatchProblem(s.ctx, 'W', d({ from: 'W', to: 'F1' }))).toBe(trip);
    expect(dispatchProblem(s.ctx, 'W', d({ from: 'H1', to: 'W' }))).toBe(trip);
    expect(dispatchProblem(s.ctx, 'W', d({ from: 'W', to: 'H1' }))).toBe('the warehouse has no food to deliver');
    wh.stockMilli = 1_000;
    expect(dispatchProblem(s.ctx, 'W', d({ from: 'W', to: 'H1' }))).toBeNull();
    wh.trucks[0]!.status = 'outbound';
    expect(dispatchProblem(s.ctx, 'W', d())).toBe('truck 1 is on the road');
    findFacility(s.world, 'W')!.condition = 'wrecked';
    expect(dispatchProblem(s.ctx, 'W', d({ truck: 2 }))).toBe('the warehouse is wrecked');
    expect(dispatchProblem(s.ctx, 'F1', d())).toBe('not a warehouse');
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

  it('is dispatched by firmware with io.dispatch(), and reads its stock, the farms, the housing blocks, and its trucks', () => {
    const host = new FakeHost();
    const frames: Array<Record<string, unknown>> = [];
    const runner = host.program('runner', (sensors) => {
      frames.push({ ...sensors });
      return frames.length === 1 ? { actions: [{ kind: 'dispatch', truck: 1, from: 'F2', to: 'W', amount: 20 }] } : {};
    });
    const s = town((j) => {
      Object.assign(j.facilities.find((f) => f.id === 'W')!.board!, { startsInstalled: true });
    }, host);
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
    expect(s.world.warehouses.W!.trucks[0]).toMatchObject({ status: 'outbound', job: { kind: 'collect', targetId: 'F2', amount: 20 } });
  });

  it('lets its stock spoil by spoilagePctPerDay, split over the steps and rounded down', () => {
    const s = town();
    const wh = s.world.warehouses.W!;
    wh.stockMilli = 100_000;
    runWarehouses(s.ctx, 0);
    expect(wh.stockMilli).toBe(99_998); // 2% of 100 a day over 800 steps is 2.5 milli-units a step, taken as 2
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

  it('replays a session of hand harvests and dispatches into the same state', () => {
    const scenario = m2Scenario((j) => {
      j.tuning.wind.maxChangePerSecond = 0;
      j.tuning.emf.rumourThreshold = 1_000_000_000;
    });
    const live = new Session(scenario, 1, new FakeHost());
    expect(live.hand('P', { kind: 'setThermal', output: 300 })).toEqual({ ok: true });
    while (live.world.step < 2_400) live.step();
    expect(live.hand('F1', { kind: 'harvest' })).toEqual({ ok: true });
    live.step(); // step 2,400: 24 into F1's outbox
    expect(live.hand('W', d({ amount: 24 }))).toEqual({ ok: true });
    while (live.world.step < 2_700) live.step(); // the truck is back with 24 on step 2,641
    expect(live.hand('W', d({ truck: 2, from: 'W', to: 'H1', amount: 20 }))).toEqual({ ok: true });
    while (live.world.step < 3_000) live.step();
    const again = replay(scenario, 1, live.record, new FakeHost(), live.world.step);
    expect(stateHash(again.world)).toBe(stateHash(live.world));
    expect(live.record.inputs.map((i) => i.kind)).toEqual(['hand', 'hand', 'hand', 'hand']);
  });
});
