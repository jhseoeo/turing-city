import { firmwareAction } from './actions.ts';
import { clearFlag, raiseOnce } from './alerts.ts';
import { appendLog, startSleep } from './boards.ts';
import type { Act, TickOutcome } from './firmware-host.ts';
import { deriveSeed } from './rng.ts';
import { sensorFrame } from './sensors.ts';
import { isBeat } from './time.ts';
import { type BoardState, findFacility, type SimContext } from './world.ts';

export interface Ticked {
  readonly board: BoardState;
  readonly outcome: TickOutcome;
}

/**
 * Phase 4: runs the firmware of every powered, awake board whose beat falls on this step, in board order. Each action applies the
 * moment the firmware calls it, from the next step, and answers the call (the user, 2026-10-17). A sleep takes effect when the tick
 * ends, and the board's actions called after it are refused.
 */
export function runBoardTicks(ctx: SimContext, step: number): Ticked[] {
  const ticked: Ticked[] = [];
  // Firmware names facilities by id (set_priority, dispatch): every facility of the town, with a board or not.
  const facilityIds = ctx.world.facilities.map((f) => f.id);
  for (const board of ctx.world.boards) {
    if (board.status !== 'running' || !board.powered || !isBeat(step, board.period, board.phase)) continue;
    if (board.firmware === null && board.pending === null) continue;
    let newSource: string | null = null;
    if (!board.vmBooted) {
      ctx.host.boot({
        boardId: board.id,
        kind: board.kind,
        spec: board.spec,
        facilityIds,
        seed: deriveSeed(ctx.seed, 'board', board.id, board.bootCount),
      });
      board.vmBooted = true;
      board.bootCount += 1;
      newSource = (board.pending ?? board.firmware)?.source ?? null;
    } else if (board.pending) {
      newSource = board.pending.source;
    }
    const facility = findFacility(ctx.world, board.id)!;
    let sleepFor: number | null = null;
    const act: Act = (action) => {
      if (sleepFor !== null) return 'the board is going to sleep';
      if (action.kind === 'sleep') {
        sleepFor = action.seconds;
        return null;
      }
      return firmwareAction(ctx, facility, action, step);
    };
    const outcome = ctx.host.tick(board.id, { sensors: sensorFrame(ctx, board), newSource }, act);
    if (board.pending) {
      board.firmware = board.pending;
      board.pending = null;
      ctx.world.stats.deploys += 1;
      appendLog(board, step, 'system', `firmware v${board.firmware.version} installed`);
    }
    ctx.world.stats.instructions += outcome.instructions;
    board.lastTick = {
      step,
      instructions: outcome.instructions,
      actions: outcome.actions.length,
      ramUsedBytes: outcome.ramUsedBytes,
      error: outcome.error,
    };
    for (const line of outcome.logs) appendLog(board, step, 'log', line);
    if (outcome.droppedLogs) appendLog(board, step, 'system', `${outcome.droppedLogs} log lines dropped this tick`);
    if (outcome.error) {
      appendLog(board, step, 'error', `${outcome.error.kind}: ${outcome.error.message}`);
      raiseOnce(ctx.world, `fwerr:${board.id}`, step, 'firmwareError', board.id, `${board.id} 펌웨어 에러: ${outcome.error.message}`);
    } else {
      clearFlag(ctx.world, `fwerr:${board.id}`);
    }
    ticked.push({ board, outcome });
    if (sleepFor !== null) startSleep(ctx, board, step, sleepFor);
  }
  return ticked;
}
