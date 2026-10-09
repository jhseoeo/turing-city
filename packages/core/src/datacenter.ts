import { clearFlag, raiseAlert, raiseOnce } from './alerts.ts';
import { destroyBoard } from './boards.ts';
import { idiv, MICRO, MILLI, mulDiv } from './fixed.ts';
import type { SimContext } from './world.ts';

/** Whether a datacenter's job covers this step and its board can work. */
export function isProcessing(ctx: SimContext, boardId: string, step: number): boolean {
  const board = ctx.world.boards.find((b) => b.id === boardId);
  const dc = ctx.world.datacenters[boardId];
  return !!board && !!dc && board.status === 'running' && board.powered && step >= dc.jobFrom && step <= dc.jobUntil;
}

/** Phase 6: income, heat, and cooling for every datacenter. */
export function runDatacenters(ctx: SimContext, step: number): void {
  const t = ctx.scenario.tuning.datacenter;
  const sps = ctx.scenario.time.stepsPerSecond;
  const w = ctx.world;
  for (const board of w.boards) {
    const dc = w.datacenters[board.id];
    if (!dc) continue;
    const working = board.status === 'running' && board.powered;
    let temp = dc.tempMilli;
    if (isProcessing(ctx, board.id, step)) {
      const income = mulDiv(w.jobPrice, MICRO, sps);
      w.money += income;
      w.ledger.datacenterIncome += income;
      temp += idiv(t.heatMilliPerSecond, sps);
    }
    temp -= idiv((temp - t.ambientMilli) * t.passiveCoolingPctPerSecond, 100 * sps);
    if (working && dc.cooling > 0) temp -= idiv(dc.cooling * t.coolingMilliPerLevelPerSecond, sps);
    dc.tempMilli = Math.max(temp, t.ambientMilli);
    if (dc.tempMilli >= t.overheatAlertMilli) {
      raiseOnce(w, `overheat:${board.id}`, step, 'overheat', board.id, `${board.id} 과열 ${idiv(dc.tempMilli, MILLI)}°C`);
    } else if (dc.tempMilli < t.overheatAlertMilli - 5 * MILLI) {
      clearFlag(w, `overheat:${board.id}`);
    }
  }
}

/** Phase 9: a datacenter above the fire threshold rolls for fire every step. */
export function runFires(ctx: SimContext, step: number): void {
  const t = ctx.scenario.tuning.datacenter;
  const sps = ctx.scenario.time.stepsPerSecond;
  for (const board of ctx.world.boards) {
    const dc = ctx.world.datacenters[board.id];
    if (!dc || board.status === 'destroyed' || board.status === 'rebuilding') continue;
    if (dc.tempMilli <= t.fireThresholdMilli) continue;
    const ppm = idiv((dc.tempMilli - t.fireThresholdMilli) * t.firePermillePerDegreePerSecond, sps);
    if (ctx.rng.fire.chancePpm(ppm)) {
      raiseAlert(ctx.world, step, 'fire', board.id, `${board.id}에 불이 났어요`);
      destroyBoard(ctx, board, step, 'fire');
    }
  }
}
