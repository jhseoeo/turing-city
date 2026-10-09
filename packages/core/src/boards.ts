import { raiseAlert } from './alerts.ts';
import { clamp } from './fixed.ts';
import { stepsForSeconds } from './time.ts';
import { type BoardState, type LogLine, type SimContext, toInt } from './world.ts';

export const LOG_LIMIT = 200;

/** Appends a log line; a line equal to the last one only bumps its repeat count. */
export function appendLog(board: BoardState, step: number, kind: LogLine['kind'], text: string): void {
  const last = board.log[board.log.length - 1];
  if (last && last.kind === kind && last.text === text) {
    last.repeat += 1;
    last.step = step;
    return;
  }
  board.log.push({ step, kind, text, repeat: 1 });
  if (board.log.length > LOG_LIMIT) board.log.splice(0, board.log.length - LOG_LIMIT);
}

/** Queues firmware; it becomes current at the board's next tick. Accepted for any board state. */
export function deployFirmware(board: BoardState, source: string): number {
  const version = board.nextVersion++;
  board.pending = { version, source };
  return version;
}

export function shutdownVm(ctx: SimContext, board: BoardState): void {
  if (board.vmBooted) {
    ctx.host.shutdown(board.id);
    board.vmBooted = false;
  }
  const dc = ctx.world.datacenters[board.id];
  if (dc) {
    dc.jobFrom = -1;
    dc.jobUntil = -1;
  }
}

export function startSleep(ctx: SimContext, board: BoardState, step: number, seconds: number): void {
  const s = clamp(toInt(seconds, 1), 1, ctx.scenario.tuning.maxSleepSeconds);
  shutdownVm(ctx, board);
  board.status = 'asleep';
  board.wakeAt = step + stepsForSeconds(ctx.scenario.time, s);
  appendLog(board, step, 'system', `sleeping ${s} s (RAM wiped)`);
}

export function destroyBoard(ctx: SimContext, board: BoardState, step: number, cause: 'fire' | 'luddites'): void {
  if (board.status === 'destroyed' || board.status === 'rebuilding') return;
  shutdownVm(ctx, board);
  board.status = 'destroyed';
  board.wakeAt = null;
  ctx.world.stats.boardsLost += 1;
  appendLog(board, step, 'system', cause === 'fire' ? 'destroyed by fire' : 'smashed by Luddites');
  raiseAlert(ctx.world, step, 'boardDestroyed', board.id, `${board.id} 보드가 부서졌어요 (${cause === 'fire' ? '화재' : '러다이트'})`);
}

/** Phase 1: sleeps that end and rebuilds that finish at this step. */
export function runTransitions(ctx: SimContext, step: number): void {
  for (const board of ctx.world.boards) {
    if (board.status === 'asleep' && board.wakeAt !== null && board.wakeAt <= step) {
      board.status = 'running';
      board.wakeAt = null;
      appendLog(board, step, 'system', 'woke up');
    } else if (board.status === 'rebuilding' && board.readyAt !== null && board.readyAt <= step) {
      board.status = 'running';
      board.readyAt = null;
      appendLog(board, step, 'system', 'rebuilt');
    }
  }
}
