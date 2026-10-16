import { clearFlag, raiseAlert, raiseOnce } from './alerts.ts';
import { appendLog } from './boards.ts';
import { MICRO, mulDiv } from './fixed.ts';
import type { Refusal } from './refusal.ts';
import { takesBoard } from './scenario.ts';
import type { CommandResult, InstallPart } from './session.ts';
import { seasonSteps, stepsForSeconds, stepsPerDay } from './time.ts';
import { type BoardState, createBoard, type EndKind, findBoard, findFacility, type SimContext } from './world.ts';

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
  } else if (w.boards.length > 0 && w.boards.every((b) => b.status === 'destroyed' || b.status === 'rebuilding')) {
    end(ctx, step, 'fallen', '마을이 함락됐어요');
  } else if (step + 1 >= seasonSteps(ctx.scenario.time)) {
    end(ctx, step, 'completed', '시즌이 끝났어요');
  }
}

function refuse(reason: string, refusal: Refusal): CommandResult {
  return { ok: false, reason, refusal };
}

/** Takes money for something the player bought, or answers false when there isn't enough. */
function pay(ctx: SimContext, amount: number, line: 'installs' | 'repairs' | 'rebuild'): boolean {
  const cost = amount * MICRO;
  if (ctx.world.money < cost) return false;
  ctx.world.money -= cost;
  ctx.world.ledger[line] += cost;
  return true;
}

/**
 * The player buys a facility's board (T1) or its board's comm module (T2). A new board runs with no firmware, so the facility goes
 * on by hand until the player deploys some; it joins the boards in its facility's place, whatever order the boards came in.
 */
export function installPart(ctx: SimContext, facilityId: string, part: InstallPart, step: number): CommandResult {
  const w = ctx.world;
  const facility = findFacility(w, facilityId);
  if (!facility) return refuse(`unknown facility ${facilityId}`, { code: 'unknownFacility', facility: facilityId });
  const spec = ctx.scenario.facilities[facility.index]!;
  if (!takesBoard(facility.kind) || spec.board === null) {
    return refuse(`${facilityId} takes no board`, { code: 'takesNoBoard', facility: facilityId });
  }
  if (facility.condition !== 'ok') return refuse(`${facilityId} is wrecked`, { code: 'wrecked', facility: facilityId });
  const board = findBoard(w, facilityId);
  const prices = ctx.scenario.tuning.install;
  if (part === 'board') {
    if (board) return refuse(`${facilityId} already has a board`, { code: 'alreadyInstalled', facility: facilityId, part });
    if (!pay(ctx, prices.boardPrice[facility.kind], 'installs')) return refuse('not enough money', { code: 'tooPoor' });
    const created = createBoard(ctx.scenario, spec, facility.index);
    created.powered = facility.powered;
    const at = w.boards.findIndex((b) => b.index > facility.index);
    w.boards.splice(at === -1 ? w.boards.length : at, 0, created);
    appendLog(created, step, 'system', 'board installed');
    return { ok: true };
  }
  if (!board) return refuse(`${facilityId} has no board`, { code: 'noBoard', facility: facilityId });
  if (board.status === 'destroyed' || board.status === 'rebuilding') {
    return refuse(`${facilityId}'s board is down`, { code: 'boardDown', facility: facilityId });
  }
  if (board.comm) return refuse(`${facilityId} already has a comm module`, { code: 'alreadyInstalled', facility: facilityId, part });
  if (!pay(ctx, prices.commPrice, 'installs')) return refuse('not enough money', { code: 'tooPoor' });
  board.comm = true;
  appendLog(board, step, 'system', 'comm module installed');
  return { ok: true };
}

/** The human's rebuild of a destroyed board: it pays now and comes back after the rebuild time. */
export function startRebuild(ctx: SimContext, board: BoardState, step: number): CommandResult {
  const t = ctx.scenario.tuning.rebuild;
  if (board.status !== 'destroyed')
    return { ok: false, reason: `${board.id} is not destroyed`, refusal: { code: 'notDestroyed', board: board.id } };
  if (!pay(ctx, t.cost, 'rebuild')) return { ok: false, reason: 'not enough money', refusal: { code: 'tooPoor' } };
  board.status = 'rebuilding';
  board.readyAt = step + stepsForSeconds(ctx.scenario.time, t.seconds);
  appendLog(board, step, 'system', `rebuilding (ready in ${t.seconds} s)`);
  return { ok: true };
}
