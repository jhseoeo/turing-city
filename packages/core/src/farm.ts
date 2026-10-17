import { appendLog } from './boards.ts';
import { idiv } from './fixed.ts';
import { stepsForSeconds } from './time.ts';
import { type FarmState, findBoard, findFacility, type SimContext } from './world.ts';

/** Steps a crop takes to ripen. */
export function ripenSteps(ctx: SimContext): number {
  return stepsForSeconds(ctx.scenario.time, ctx.scenario.tuning.farm.ripenSeconds);
}

/** Steps a ripe crop lasts before it rots. */
export function rotSteps(ctx: SimContext): number {
  return stepsForSeconds(ctx.scenario.time, ctx.scenario.tuning.farm.rotSeconds);
}

export function isRipe(ctx: SimContext, farm: FarmState, step: number): boolean {
  return step - farm.plantedAt >= ripenSteps(ctx);
}

/** How far the crop has grown, from 0 when planted to 100 when ripe, rounded down. */
export function ripeness(ctx: SimContext, farm: FarmState, step: number): number {
  const n = ripenSteps(ctx);
  if (n <= 0) return 100;
  return Math.max(0, Math.min(100, idiv((step - farm.plantedAt) * 100, n)));
}

/** Why the player's harvest cannot happen now, or null. Session.hand refuses with it. */
export function harvestProblem(ctx: SimContext, farmId: string, step: number): string | null {
  const f = findFacility(ctx.world, farmId);
  const farm = ctx.world.farms[farmId];
  if (!f || !farm) return 'not a farm';
  if (f.condition !== 'ok') return 'the farm is wrecked';
  if (!isRipe(ctx, farm, step)) return 'nothing is ripe';
  return null;
}

/**
 * A ripe crop goes to the outbox, and the field replants. Whatever passes the outbox's capacity is wasted. An unripe field or a
 * wrecked farm: nothing. From a hand or from firmware alike.
 */
export function harvest(ctx: SimContext, farmId: string, step: number): void {
  const f = findFacility(ctx.world, farmId);
  const farm = ctx.world.farms[farmId];
  if (!f || !farm || f.condition !== 'ok' || !isRipe(ctx, farm, step)) return;
  const t = ctx.scenario.tuning.farm;
  farm.outbox = Math.min(t.outboxCapacity, farm.outbox + t.yield);
  farm.plantedAt = step;
}

/**
 * Phase 6: a crop left ripe for the rot time rots: it is lost, and the field replants at that step. A farm with a board logs it.
 * A wrecked or repairing farm is skipped: its repair replants it.
 */
export function runFarms(ctx: SimContext, step: number): void {
  const limit = ripenSteps(ctx) + rotSteps(ctx);
  for (const f of ctx.world.facilities) {
    const farm = ctx.world.farms[f.id];
    if (!farm || f.condition !== 'ok') continue;
    if (step - farm.plantedAt < limit) continue;
    farm.plantedAt = step;
    const board = findBoard(ctx.world, f.id);
    if (board) appendLog(board, step, 'system', 'crop rotted');
  }
}
