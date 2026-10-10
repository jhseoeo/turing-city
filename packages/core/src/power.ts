import { clearFlag, raiseOnce } from './alerts.ts';
import { appendLog } from './boards.ts';
import { mulDiv } from './fixed.ts';
import { stepsForSeconds } from './time.ts';
import { type BoardState, manhattan, type SimContext, type WorldState } from './world.ts';

export function plantBoard(world: WorldState): BoardState {
  const plant = world.boards.find((b) => b.kind === 'power');
  if (!plant) throw new Error('the scenario has no power plant');
  return plant;
}

/** What a facility requests this step, transmission loss included. */
export function facilityDemand(ctx: SimContext, board: BoardState, step: number): number {
  const t = ctx.scenario.tuning;
  let base: number;
  if (board.status === 'destroyed' || board.status === 'rebuilding') return 0;
  if (board.status === 'asleep') {
    base = t.sleepPower;
  } else {
    base = board.spec.power;
    const dc = ctx.world.datacenters[board.id];
    if (dc) {
      if (step >= dc.jobFrom && step <= dc.jobUntil) base += t.datacenter.processPower;
      base += dc.cooling * t.datacenter.coolingPowerPerLevel;
    }
  }
  const plant = plantBoard(ctx.world);
  const distance = manhattan(board.x, board.y, plant.x, plant.y);
  return base + mulDiv(base, t.transmissionLossPctPerCell * distance, 100);
}

/** Consumers (every board but the plant's), highest priority first. */
export function priorityOrder(world: WorldState): BoardState[] {
  const consumers = world.boards.filter((b) => b.kind !== 'power');
  const listed = world.plant.priority ?? [];
  const first = listed.map((id) => consumers.find((b) => b.id === id)).filter((b): b is BoardState => b !== undefined);
  return [...first, ...consumers.filter((b) => !first.includes(b))];
}

/**
 * What a board's own log says of its power. A cut is logged as it happens, so a plant that flickers leaves one folded "power lost" line
 * and not a line a step; "power back" comes only once the board has had power, unbroken, for the quiet time since its last cut, so it
 * never interleaves with a flicker. A board that is smashed or being rebuilt owes no "power back" (its own lines say what happened),
 * and one that is rebuilt starts fresh.
 */
function logPower(ctx: SimContext, board: BoardState, wasPowered: boolean, step: number): void {
  if (board.status !== 'running' && board.status !== 'asleep') {
    board.lastCutStep = null;
    return;
  }
  const quietSeconds = ctx.scenario.tuning.shortageQuietSeconds;
  if (!board.powered) {
    if (wasPowered) appendLog(board, step, 'system', 'power lost');
    board.lastCutStep = step;
  } else if (board.lastCutStep !== null && step - board.lastCutStep >= stepsForSeconds(ctx.scenario.time, quietSeconds)) {
    appendLog(board, step, 'system', quietSeconds > 0 ? `power back (steady for ${quietSeconds} s)` : 'power back');
    board.lastCutStep = null;
  }
}

/** Phase 3: generation, demand, and shedding. */
export function runPower(ctx: SimContext, step: number): void {
  const w = ctx.world;
  const plant = plantBoard(w);
  const thermal = plant.status === 'running' ? w.plant.thermalSetting : 0;
  const generation = w.plant.wind + thermal;
  const plantDraw = facilityDemand(ctx, plant, step);
  const order = priorityOrder(w);
  const demands = order.map((b) => facilityDemand(ctx, b, step));
  const available = generation - plantDraw;
  let load = demands.reduce((a, b) => a + b, 0);
  const powered = order.map(() => true);
  for (let i = order.length - 1; i >= 0 && load > available; i--) {
    if (demands[i] === 0) continue;
    powered[i] = false;
    load -= demands[i]!;
  }
  plant.powered = true;
  order.forEach((b, i) => {
    const was = b.powered;
    b.powered = powered[i]!;
    logPower(ctx, b, was, step);
  });
  w.plant.generation = generation;
  w.plant.demand = plantDraw + demands.reduce((a, b) => a + b, 0);
  w.plant.shed = order.filter((_, i) => !powered[i] && demands[i]! > 0).map((b) => b.id);
  if (w.plant.shed.length > 0) {
    w.plant.lastShedStep = step;
    raiseOnce(w, 'shortage', step, 'powerShortage', null, `전력 부족: ${w.plant.shed.join(', ')} 정전`);
  } else if (
    w.plant.lastShedStep !== null &&
    step - w.plant.lastShedStep >= stepsForSeconds(ctx.scenario.time, ctx.scenario.tuning.shortageQuietSeconds)
  ) {
    // The episode ends only after the grid has been quiet for a while: a plant that sheds and re-powers again and again would
    // otherwise raise an alert at every turn, flood get_alerts and push the older alerts out of the buffer.
    clearFlag(w, 'shortage');
  }
}
