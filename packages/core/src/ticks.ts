import { clearFlag, raiseOnce } from './alerts.ts';
import { appendLog } from './boards.ts';
import type { TickOutcome } from './firmware-host.ts';
import { deriveSeed } from './rng.ts';
import { sensorFrame } from './sensors.ts';
import { isBeat } from './time.ts';
import type { BoardState, SimContext } from './world.ts';

export interface Ticked {
  readonly board: BoardState;
  readonly outcome: TickOutcome;
}

/** Phase 4: runs the firmware of every powered, awake board whose beat falls on this step. */
export function runBoardTicks(ctx: SimContext, step: number): Ticked[] {
  const ticked: Ticked[] = [];
  const facilityIds = ctx.world.boards.map((b) => b.id);
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
    const outcome = ctx.host.tick(board.id, { sensors: sensorFrame(ctx, board), newSource });
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
    if (outcome.error) {
      appendLog(board, step, 'error', `${outcome.error.kind}: ${outcome.error.message}`);
      raiseOnce(ctx.world, `fwerr:${board.id}`, step, 'firmwareError', board.id, `${board.id} 펌웨어 에러: ${outcome.error.message}`);
    } else {
      clearFlag(ctx.world, `fwerr:${board.id}`);
    }
    ticked.push({ board, outcome });
  }
  return ticked;
}
