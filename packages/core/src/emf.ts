import type { TickOutcome } from './firmware-host.ts';
import { idiv, MILLI, mulDiv } from './fixed.ts';
import type { Ticked } from './ticks.ts';
import { cellIndex, type SimContext, type WorldState } from './world.ts';

/** Milli-EMF that one tick emits: instructions / instructionsPerUnit, plus perAction for each action. */
export function tickEmission(ctx: SimContext, outcome: TickOutcome): number {
  const e = ctx.scenario.tuning.emf;
  return mulDiv(outcome.instructions, MILLI, e.instructionsPerUnit) + outcome.actions.length * e.perAction * MILLI;
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

/** Phase 7: emissions from this step's ticks and from every awake, powered board; then diffusion and decay. */
export function runEmf(ctx: SimContext, ticked: readonly Ticked[]): void {
  const { scenario, world } = ctx;
  const sps = scenario.time.stepsPerSecond;
  for (const { board, outcome } of ticked) {
    const i = cellIndex(scenario, board.x, board.y);
    world.emf[i] = world.emf[i]! + tickEmission(ctx, outcome);
  }
  for (const board of world.boards) {
    if (board.status !== 'running' || !board.powered) continue;
    const i = cellIndex(scenario, board.x, board.y);
    world.emf[i] = world.emf[i]! + mulDiv(board.spec.baseEmfPerSecond, MILLI, sps);
  }
  const e = scenario.tuning.emf;
  diffuse(world.emf, scenario.grid.width, scenario.grid.height, e.diffusionPctPerSecond, e.decayPctPerSecond, sps);
}

/** The field's total in whole EMF units. */
export function fieldTotal(world: WorldState): number {
  let sum = 0;
  for (const v of world.emf) sum += v;
  return idiv(sum, MILLI);
}
