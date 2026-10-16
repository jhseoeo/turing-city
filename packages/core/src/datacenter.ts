import { clearFlag, raiseAlert, raiseOnce } from './alerts.ts';
import { destroyBoard } from './boards.ts';
import { idiv, MICRO, MILLI, mulDiv } from './fixed.ts';
import { findFacility, type SimContext } from './world.ts';

/** Steps one cooling cycle lasts. The scenario makes it a whole number. */
export function coolSteps(ctx: SimContext): number {
  return idiv(ctx.scenario.tuning.datacenter.coolingCycleMs * ctx.scenario.time.stepsPerSecond, 1000);
}

/** Whether a datacenter works at this step: it stands, the grid supplies it, and its busy window covers the step. */
export function isProcessing(ctx: SimContext, facilityId: string, step: number): boolean {
  const facility = findFacility(ctx.world, facilityId);
  const dc = ctx.world.datacenters[facilityId];
  return !!facility && !!dc && facility.condition === 'ok' && facility.powered && dc.busyFrom <= step && step < dc.busyUntil;
}

/** Whether a datacenter cools at this step: the same, for its cool window. */
export function isCooling(ctx: SimContext, facilityId: string, step: number): boolean {
  const facility = findFacility(ctx.world, facilityId);
  const dc = ctx.world.datacenters[facilityId];
  return !!facility && !!dc && facility.condition === 'ok' && facility.powered && dc.coolFrom <= step && step < dc.coolUntil;
}

/** Phase 6: income, heat, and cooling for every datacenter. */
export function runDatacenters(ctx: SimContext, step: number): void {
  const t = ctx.scenario.tuning.datacenter;
  const sps = ctx.scenario.time.stepsPerSecond;
  const w = ctx.world;
  for (const facility of w.facilities) {
    const dc = w.datacenters[facility.id];
    if (!dc) continue;
    let temp = dc.tempMilli;
    if (isProcessing(ctx, facility.id, step)) {
      const income = mulDiv(w.jobPrice, MICRO, sps);
      w.money += income;
      w.ledger.datacenterIncome += income;
      temp += idiv(t.heatMilliPerSecond, sps);
    }
    temp -= idiv((temp - t.ambientMilli) * t.passiveCoolingPctPerSecond, 100 * sps);
    if (isCooling(ctx, facility.id, step)) temp -= idiv(t.coolingDropMilli, coolSteps(ctx));
    dc.tempMilli = Math.max(temp, t.ambientMilli);
    if (dc.tempMilli >= t.overheatAlertMilli) {
      raiseOnce(w, `overheat:${facility.id}`, step, 'overheat', facility.id, `${facility.id} 과열 ${idiv(dc.tempMilli, MILLI)}°C`);
    } else if (dc.tempMilli < t.overheatAlertMilli - 5 * MILLI) {
      clearFlag(w, `overheat:${facility.id}`);
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
