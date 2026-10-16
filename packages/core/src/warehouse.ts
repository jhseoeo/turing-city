import type { FacilityAction, SensorValue } from './firmware-host.ts';
import { idiv, MICRO, MILLI, mulDiv } from './fixed.ts';
import { pathTo } from './luddites.ts';
import { stepsPerDay } from './time.ts';
import {
  type FacilityState,
  findFacility,
  manhattan,
  type SimContext,
  type TruckJob,
  type TruckState,
  type WarehouseState,
} from './world.ts';

type Dispatch = Extract<FacilityAction, { kind: 'dispatch' }>;

/** Steps a truck takes to enter the next cell of its road. The scenario makes it a whole number (Task 1's validation). */
export function stepsPerCell(ctx: SimContext): number {
  return idiv(ctx.scenario.time.stepsPerSecond, ctx.scenario.tuning.warehouse.truckCellsPerSecond);
}

/**
 * What a dispatch would do: collect from a facility with an outbox (a farm) to this warehouse, or deliver from it to a facility
 * whose residents eat (a housing block); null when it is neither.
 */
function tripOf(ctx: SimContext, warehouseId: string, d: Dispatch): Pick<TruckJob, 'kind' | 'targetId'> | null {
  const from = findFacility(ctx.world, d.from);
  const to = findFacility(ctx.world, d.to);
  if (from && ctx.world.farms[from.id] && d.to === warehouseId) return { kind: 'collect', targetId: from.id };
  if (to && ctx.world.housing[to.id] && d.from === warehouseId) return { kind: 'deliver', targetId: to.id };
  return null;
}

/** Why a dispatch cannot start now, or null. Session.hand refuses with it; the action skips (firmware gets nothing done). */
export function dispatchProblem(ctx: SimContext, warehouseId: string, d: Dispatch): string | null {
  const capacity = ctx.scenario.tuning.warehouse.truckCapacity;
  const home = findFacility(ctx.world, warehouseId);
  const wh = ctx.world.warehouses[warehouseId];
  if (!home || !wh) return 'not a warehouse';
  if (home.condition !== 'ok') return 'the warehouse is wrecked';
  const truck = wh.trucks.find((t) => t.id === d.truck);
  if (!truck) return `there is no truck ${d.truck}; trucks are 1-${wh.trucks.length}`;
  if (truck.status !== 'idle') return `truck ${truck.id} is on the road`;
  if (!Number.isInteger(d.amount) || d.amount < 1 || d.amount > capacity) {
    return `the amount must be a whole number from 1 to ${capacity}`;
  }
  const trip = tripOf(ctx, warehouseId, d);
  if (!trip) return 'a truck collects from a farm to the warehouse, or delivers from the warehouse to a housing block';
  if (trip.kind === 'deliver' && wh.stockMilli < MILLI) return 'the warehouse has no food to deliver';
  return null;
}

/** Sends an idle truck on its trip; a dispatch with a problem does nothing. A delivery loads at once, from whole units of the stock. */
export function dispatch(ctx: SimContext, warehouseId: string, d: Dispatch, step: number): void {
  if (dispatchProblem(ctx, warehouseId, d) !== null) return;
  const w = ctx.world;
  const home = findFacility(w, warehouseId)!;
  const wh = w.warehouses[warehouseId]!;
  const trip = tripOf(ctx, warehouseId, d)!;
  const target = findFacility(w, trip.targetId)!;
  const truck = wh.trucks.find((t) => t.id === d.truck)!;
  truck.job = { kind: trip.kind, targetId: trip.targetId, amount: d.amount };
  truck.status = 'outbound';
  truck.path = pathTo(home.x, home.y, target.x, target.y);
  truck.cellsDone = 0;
  truck.legFrom = step;
  truck.load = 0;
  if (trip.kind === 'deliver') {
    const load = Math.min(d.amount, idiv(wh.stockMilli, MILLI), ctx.scenario.tuning.warehouse.truckCapacity);
    wh.stockMilli -= load * MILLI;
    truck.load = load;
  }
}

/**
 * Moves a truck by the cells its leg has reached by this step, paying fuel for each, and lands it at the end of its leg. At the
 * farm it takes what the outbox holds, up to the amount and its capacity; at a housing block it unloads; at home it stocks what it
 * carries and stands idle. The next leg starts on the step the last one ended.
 */
function moveTruck(ctx: SimContext, home: FacilityState, wh: WarehouseState, truck: TruckState, step: number): void {
  const job = truck.job;
  if (truck.status === 'idle' || job === null) return;
  const t = ctx.scenario.tuning.warehouse;
  const w = ctx.world;
  const reached = Math.min(truck.path.length, idiv(step - truck.legFrom, stepsPerCell(ctx)));
  while (truck.cellsDone < reached) {
    const [x, y] = truck.path[truck.cellsDone]!;
    truck.x = x;
    truck.y = y;
    truck.cellsDone += 1;
    const fuel = t.fuelPerCell * MICRO;
    w.money -= fuel;
    w.ledger.truckFuel += fuel;
  }
  if (truck.cellsDone < truck.path.length) return;
  if (truck.status === 'outbound') {
    const target = findFacility(w, job.targetId)!;
    if (job.kind === 'collect') {
      const farm = w.farms[job.targetId]!;
      const take = Math.min(job.amount, farm.outbox, t.truckCapacity);
      farm.outbox -= take;
      truck.load = take;
    } else {
      w.housing[job.targetId]!.foodMilli += truck.load * MILLI;
      truck.load = 0;
    }
    truck.status = 'returning';
    truck.path = pathTo(target.x, target.y, home.x, home.y);
    truck.cellsDone = 0;
    truck.legFrom = step;
    return;
  }
  wh.stockMilli += truck.load * MILLI;
  truck.load = 0;
  truck.status = 'idle';
  truck.job = null;
  truck.path = [];
  truck.cellsDone = 0;
}

/**
 * Phase 6: every warehouse's trucks move, wrecked or not (a truck on the road finishes its trip). On the last step of each day its
 * stock spoils by spoilagePctPerDay, rounded down: once a day, so that a small stock spoils too.
 */
export function runWarehouses(ctx: SimContext, step: number): void {
  const w = ctx.world;
  const spoilage = ctx.scenario.tuning.warehouse.spoilagePctPerDay;
  const spd = stepsPerDay(ctx.scenario.time);
  for (const f of w.facilities) {
    const wh = w.warehouses[f.id];
    if (!wh) continue;
    for (const truck of wh.trucks) moveTruck(ctx, f, wh, truck, step);
    if (step % spd === spd - 1) wh.stockMilli -= mulDiv(wh.stockMilli, spoilage, 100);
  }
}

/**
 * What a warehouse board's sensors read: its stock in whole units; every farm with its outbox and distance from the warehouse;
 * every housing block with its food, residents, and distance; and its trucks, with where they are, what they carry, and where
 * they are bound (nil when idle).
 */
export function warehouseReading(ctx: SimContext, warehouseId: string, sensor: 'stock' | 'farms' | 'housing' | 'trucks'): SensorValue {
  const w = ctx.world;
  const home = findFacility(w, warehouseId);
  const wh = w.warehouses[warehouseId];
  if (!home || !wh) return undefined;
  switch (sensor) {
    case 'stock':
      return idiv(wh.stockMilli, MILLI);
    case 'farms':
      return w.facilities
        .filter((f) => w.farms[f.id] !== undefined)
        .map((f) => ({ id: f.id, outbox: w.farms[f.id]?.outbox ?? 0, distance: manhattan(home.x, home.y, f.x, f.y) }));
    case 'housing':
      return w.facilities
        .filter((f) => w.housing[f.id] !== undefined)
        .map((f) => ({
          id: f.id,
          food: idiv(w.housing[f.id]?.foodMilli ?? 0, MILLI),
          residents: ctx.scenario.tuning.housing.residents,
          distance: manhattan(home.x, home.y, f.x, f.y),
        }));
    case 'trucks':
      return wh.trucks.map((t) => ({ id: t.id, status: t.status, x: t.x, y: t.y, load: t.load, target: t.job?.targetId }));
  }
}
