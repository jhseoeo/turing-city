import { isProcessing } from './datacenter.ts';
import { countsAsAction, type TickOutcome } from './firmware-host.ts';
import { idiv, MILLI, mulDiv } from './fixed.ts';
import type { Ticked } from './ticks.ts';
import { type BoardState, cellIndex, type SimContext, type WorldState } from './world.ts';

/**
 * Milli-EMF that one tick emits: instructions / instructionsPerUnit, plus perAction for each action that is machine labor.
 * A process() call is counted as the datacenter's running time instead (processingEmission), whoever starts the job, and sleep()
 * is no labor.
 */
export function tickEmission(ctx: SimContext, outcome: TickOutcome): number {
  const e = ctx.scenario.tuning.emf;
  const labor = outcome.actions.filter((a) => countsAsAction(a.kind)).length;
  return mulDiv(outcome.instructions, MILLI, e.instructionsPerUnit) + labor * e.perAction * MILLI;
}

/** Milli-EMF a running, powered board gives off each step: its base EMF, and a comm module's on top, spread over the second. */
export function baseEmission(ctx: SimContext, board: BoardState): number {
  const perSecond = board.spec.baseEmfPerSecond + (board.comm ? ctx.scenario.tuning.install.commBaseEmfPerSecond : 0);
  return mulDiv(perSecond, MILLI, ctx.scenario.time.stepsPerSecond);
}

/** Milli-EMF a datacenter's servers give off on each step they work, whoever started the job: a press of [처리] or process(). */
export function processingEmission(ctx: SimContext): number {
  return mulDiv(ctx.scenario.tuning.emf.processingPerSecond, MILLI, ctx.scenario.time.stepsPerSecond);
}

/**
 * One step of diffusion to the four neighbours inside the map, then decay. In place.
 * Decay rounds up, so that small values fade to zero instead of lingering.
 */
export function diffuse(
  field: number[],
  width: number,
  height: number,
  sharePctPerSecond: number,
  decayPctPerSecond: number,
  stepsPerSecond: number,
): void {
  const next = field.slice();
  const denom = 100 * stepsPerSecond;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const share = idiv(field[i]! * sharePctPerSecond, denom);
      if (share === 0) continue;
      const give = (n: number): void => {
        next[n] = next[n]! + share;
        next[i] = next[i]! - share;
      };
      if (x > 0) give(i - 1);
      if (x < width - 1) give(i + 1);
      if (y > 0) give(i - width);
      if (y < height - 1) give(i + width);
    }
  }
  for (let i = 0; i < next.length; i++) {
    const v = next[i]!;
    field[i] = v + idiv(-v * decayPctPerSecond, denom); // v - ceil(v * pct / denom)
  }
}

/**
 * Phase 7: this step's ticks, every running and powered board's base EMF, and every working datacenter's processing EMF, each
 * into its own cell; then diffusion and decay. The player's hands give off nothing. The step is the world's own: phase 7 of step s
 * runs with world.step === s.
 */
export function runEmf(ctx: SimContext, ticked: readonly Ticked[]): void {
  const { scenario, world } = ctx;
  const add = (x: number, y: number, milli: number): void => {
    const i = cellIndex(scenario, x, y);
    world.emf[i] = world.emf[i]! + milli;
  };
  for (const { board, outcome } of ticked) add(board.x, board.y, tickEmission(ctx, outcome));
  for (const board of world.boards) {
    if (board.status === 'running' && board.powered) add(board.x, board.y, baseEmission(ctx, board));
  }
  for (const f of world.facilities) {
    if (isProcessing(ctx, f.id, world.step)) add(f.x, f.y, processingEmission(ctx));
  }
  const e = scenario.tuning.emf;
  diffuse(world.emf, scenario.grid.width, scenario.grid.height, e.diffusionPctPerSecond, e.decayPctPerSecond, scenario.time.stepsPerSecond);
}

/** The field's total in whole EMF units. */
export function fieldTotal(world: WorldState): number {
  let sum = 0;
  for (const v of world.emf) sum += v;
  return idiv(sum, MILLI);
}
