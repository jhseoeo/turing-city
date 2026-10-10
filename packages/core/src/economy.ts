import { clearFlag, raiseAlert, raiseOnce } from './alerts.ts';
import { appendLog } from './boards.ts';
import { MICRO, mulDiv } from './fixed.ts';
import type { Refusal } from './refusal.ts';
import { seasonSteps, stepsForSeconds, stepsPerDay } from './time.ts';
import type { BoardState, EndKind, SimContext } from './world.ts';

/** Phase 10a: fuel for the thermal output the power phase made this step, and upkeep for every running or sleeping board. */
export function runEconomy(ctx: SimContext): void {
  const w = ctx.world;
  const spd = stepsPerDay(ctx.scenario.time);
  // Generation is the wind plus the thermal output, and phase 3 left both. The plant's firmware (phase 5) or a smash (phase 8)
  // may have changed the setting or the board since, but the module ran as phase 3 found it.
  const thermal = w.plant.generation - w.plant.wind;
  const fuel = mulDiv(thermal * w.plant.fuelPrice, MICRO, spd);
  const intact = w.boards.filter((b) => b.status === 'running' || b.status === 'asleep').length;
  const upkeep = mulDiv(intact * ctx.scenario.tuning.boardUpkeepPerDay, MICRO, spd);
  w.money -= fuel + upkeep;
  w.ledger.fuel += fuel;
  w.ledger.upkeep += upkeep;
}

function end(ctx: SimContext, step: number, kind: EndKind, message: string): void {
  ctx.world.ended = { kind, step };
  raiseAlert(ctx.world, step, 'seasonEnd', null, message);
}

/** Phase 10b: bankruptcy, then the town's fall, then the season's last step. */
export function checkEnd(ctx: SimContext, step: number): void {
  const w = ctx.world;
  if (w.ended) return;
  if (w.money < 0) {
    w.belowZeroSince ??= step;
    raiseOnce(w, 'belowZero', step, 'moneyBelowZero', null, '자금이 바닥났어요');
  } else {
    w.belowZeroSince = null;
    clearFlag(w, 'belowZero');
  }
  const spd = stepsPerDay(ctx.scenario.time);
  if (w.belowZeroSince !== null && step - w.belowZeroSince + 1 >= ctx.scenario.tuning.bankruptcyDays * spd) {
    end(ctx, step, 'bankrupt', '파산했어요');
  } else if (w.boards.every((b) => b.status === 'destroyed' || b.status === 'rebuilding')) {
    end(ctx, step, 'fallen', '마을이 함락됐어요');
  } else if (step + 1 >= seasonSteps(ctx.scenario.time)) {
    end(ctx, step, 'completed', '시즌이 끝났어요');
  }
}

/** What a rebuild answers: it started, or why not, in words for agents and logs and as a code for the viewer to say in Korean. */
export type RebuildResult = { ok: true } | { ok: false; reason: string; refusal: Refusal };

/** The human's rebuild of a destroyed board: it pays now and comes back after the rebuild time. */
export function startRebuild(ctx: SimContext, board: BoardState, step: number): RebuildResult {
  const t = ctx.scenario.tuning.rebuild;
  if (board.status !== 'destroyed')
    return { ok: false, reason: `${board.id} is not destroyed`, refusal: { code: 'notDestroyed', board: board.id } };
  const cost = t.cost * MICRO;
  if (ctx.world.money < cost) return { ok: false, reason: 'not enough money', refusal: { code: 'tooPoor' } };
  ctx.world.money -= cost;
  ctx.world.ledger.rebuild += cost;
  board.status = 'rebuilding';
  board.readyAt = step + stepsForSeconds(ctx.scenario.time, t.seconds);
  appendLog(board, step, 'system', `rebuilding (ready in ${t.seconds} s)`);
  return { ok: true };
}
