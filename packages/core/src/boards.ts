import { raiseAlert } from './alerts.ts';
import { clamp } from './fixed.ts';
import { stepsForSeconds } from './time.ts';
import { type BoardState, type FacilityState, findBoard, type LogLine, type SimContext, toInt } from './world.ts';

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

/** Drops the board's VM: its mem and globals are gone. Its facility is not touched: a sleep stops only the board. */
export function shutdownVm(ctx: SimContext, board: BoardState): void {
  if (board.vmBooted) {
    ctx.host.shutdown(board.id);
    board.vmBooted = false;
  }
}

/** Ends whatever a datacenter was doing: its job and its cooling cycle. */
function stopDatacenter(ctx: SimContext, facilityId: string): void {
  const dc = ctx.world.datacenters[facilityId];
  if (!dc) return;
  dc.busyFrom = -1;
  dc.busyUntil = -1;
  dc.coolFrom = -1;
  dc.coolUntil = -1;
}

export function startSleep(ctx: SimContext, board: BoardState, step: number, seconds: number): void {
  const s = clamp(toInt(seconds, 1), 1, ctx.scenario.tuning.maxSleepSeconds);
  shutdownVm(ctx, board);
  board.status = 'asleep';
  board.wakeAt = step + stepsForSeconds(ctx.scenario.time, s);
  appendLog(board, step, 'system', `sleeping ${s} s (RAM wiped)`);
}

/** The board's part of a wreck: it stops, loses its VM and mem, and a rebuild under way is lost with it. */
function destroyBoard(ctx: SimContext, board: BoardState, step: number, cause: 'fire' | 'luddites'): void {
  if (board.status === 'destroyed') return;
  shutdownVm(ctx, board);
  board.status = 'destroyed';
  board.wakeAt = null;
  board.readyAt = null;
  appendLog(board, step, 'system', cause === 'fire' ? 'destroyed by fire' : 'smashed by Luddites');
}

/**
 * Luddites or fire wreck a whole facility: it stops, by hand too, until the player repairs it, and its board, if it has one, is
 * destroyed with it (the board is rebuilt separately, once the facility stands again).
 */
export function wreckFacility(ctx: SimContext, facility: FacilityState, step: number, cause: 'fire' | 'luddites'): void {
  if (facility.condition !== 'ok') return;
  facility.condition = 'wrecked';
  facility.repairReadyAt = null;
  const board = findBoard(ctx.world, facility.id);
  if (board) destroyBoard(ctx, board, step, cause);
  stopDatacenter(ctx, facility.id);
  // A warehouse is left alone: its stock and its idle trucks stay, as a farm's outbox does, and trucks on the road finish their trips.
  ctx.world.stats.wrecks += 1;
  raiseAlert(ctx.world, step, 'wrecked', facility.id, `${facility.id} 시설이 부서졌어요 (${cause === 'fire' ? '화재' : '러다이트'})`);
}

/** Phase 1: sleeps that end, board rebuilds that finish, and facility repairs that finish at this step. */
export function runTransitions(ctx: SimContext, step: number): void {
  for (const facility of ctx.world.facilities) {
    if (facility.condition !== 'repairing' || facility.repairReadyAt === null || facility.repairReadyAt > step) continue;
    facility.condition = 'ok';
    facility.repairReadyAt = null;
    // A repaired datacenter is new hardware: the wreck's heat doesn't come back with it.
    const dc = ctx.world.datacenters[facility.id];
    if (dc) dc.tempMilli = ctx.scenario.tuning.datacenter.ambientMilli;
    stopDatacenter(ctx, facility.id);
    // A repaired farm starts a new crop: whatever grew before the wreck is lost. The food already in its outbox is not: it was
    // harvested before the wreck, and a wreck does not touch it.
    const farm = ctx.world.farms[facility.id];
    if (farm) farm.plantedAt = step;
  }
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
