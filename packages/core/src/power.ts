import { clearFlag, raiseOnce } from './alerts.ts';
import { appendLog } from './boards.ts';
import { datacenterDraw } from './datacenter.ts';
import { mulDiv } from './fixed.ts';
import { housingDraw } from './housing.ts';
import { stepsForSeconds } from './time.ts';
import { type BoardState, type FacilityState, findBoard, manhattan, type SimContext, type WorldState } from './world.ts';

/** The town's one power plant (the scenario guarantees it). */
export function plantFacility(world: WorldState): FacilityState {
  const plant = world.facilities.find((f) => f.kind === 'power');
  if (!plant) throw new Error('the scenario has no power plant');
  return plant;
}

/** What a board itself draws: its parts while running, sleep power while asleep, nothing while destroyed or being rebuilt. */
function boardDraw(ctx: SimContext, board: BoardState | undefined): number {
  if (!board) return 0;
  if (board.status === 'running') return board.spec.power;
  if (board.status === 'asleep') return ctx.scenario.tuning.sleepPower;
  return 0;
}

/**
 * What a facility requests this step, transmission loss included: its board's draw, a datacenter's job and cooling on the steps
 * their windows cover, and housing's own use. A wrecked or repairing facility requests nothing.
 */
export function facilityDemand(ctx: SimContext, facility: FacilityState, step: number): number {
  if (facility.condition !== 'ok') return 0;
  const t = ctx.scenario.tuning;
  let base = boardDraw(ctx, findBoard(ctx.world, facility.id));
  base += datacenterDraw(ctx, facility, step);
  base += housingDraw(ctx, facility);
  const plant = plantFacility(ctx.world);
  const distance = manhattan(facility.x, facility.y, plant.x, plant.y);
  return base + mulDiv(base, t.transmissionLossPctPerCell * distance, 100);
}

/** Consumers (every facility but the plant), highest priority first: the plant's list, then the rest in scenario order. */
export function priorityOrder(world: WorldState): FacilityState[] {
  const consumers = world.facilities.filter((f) => f.kind !== 'power');
  const listed = world.plant.priority ?? [];
  const first = listed.map((id) => consumers.find((f) => f.id === id)).filter((f): f is FacilityState => f !== undefined);
  return [...first, ...consumers.filter((f) => !first.includes(f))];
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

interface Grid {
  readonly generation: number;
  readonly plantDraw: number;
  readonly order: readonly FacilityState[];
  readonly demands: readonly number[];
  readonly powered: readonly boolean[];
}

/** Who the grid can supply at this step: generation against demand, shedding the lowest priorities first. Changes nothing. */
function solveGrid(ctx: SimContext, step: number): Grid {
  const w = ctx.world;
  const plant = plantFacility(w);
  // The thermal module follows the town's setting whatever the plant's board is doing: the board only automates it. A wrecked plant
  // makes nothing until it is repaired; the wind turbine is not the board's either, and it keeps turning.
  const thermal = plant.condition === 'ok' ? w.plant.thermalSetting : 0;
  const generation = w.plant.wind + thermal;
  const plantDraw = facilityDemand(ctx, plant, step);
  const order = priorityOrder(w);
  const demands = order.map((f) => facilityDemand(ctx, f, step));
  const available = generation - plantDraw;
  let load = demands.reduce((a, b) => a + b, 0);
  const powered = order.map(() => true);
  for (let i = order.length - 1; i >= 0 && load > available; i--) {
    if (demands[i] === 0) continue;
    powered[i] = false;
    load -= demands[i]!;
  }
  return { generation, plantDraw, order, demands, powered };
}

/** Writes a grid's result into the facilities, the boards (with their log lines), and the plant's figures. */
function assignGrid(ctx: SimContext, g: Grid, step: number): void {
  const w = ctx.world;
  const plant = plantFacility(w);
  const plantBoard = findBoard(w, plant.id);
  // The plant's own board is never shed, even when nothing is generated, so its firmware can always start the thermal module.
  plant.powered = true;
  if (plantBoard) plantBoard.powered = true;
  g.order.forEach((f, i) => {
    f.powered = g.powered[i]!;
    const board = findBoard(w, f.id);
    if (!board) return;
    const was = board.powered;
    board.powered = f.powered;
    logPower(ctx, board, was, step);
  });
  w.plant.generation = g.generation;
  w.plant.demand = g.plantDraw + g.demands.reduce((a, b) => a + b, 0);
  w.plant.shed = g.order.filter((_, i) => !g.powered[i] && g.demands[i]! > 0).map((f) => f.id);
}

/**
 * The grid as step 0 will find it, so that the views before the first step (and a deploy's "installs at") do not say a facility has
 * power that step 0 cuts. It is the first power phase's own assignment, without its shortage alert: step 0 runs the phase again.
 */
export function initPower(ctx: SimContext): void {
  assignGrid(ctx, solveGrid(ctx, 0), 0);
}

/** Phase 3: generation, demand, and shedding. The grid sheds whole facilities; a facility's board has power when its facility has. */
export function runPower(ctx: SimContext, step: number): void {
  const w = ctx.world;
  assignGrid(ctx, solveGrid(ctx, step), step);
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
