import { clearFlag, raiseAlert, raiseOnce } from './alerts.ts';
import { wreckFacility } from './boards.ts';
import { idiv, MICRO, MILLI, mulDiv } from './fixed.ts';
import { type DatacenterState, type FacilityState, findFacility, type SimContext } from './world.ts';

/** Steps one job runs: a press of [처리] or one process() call. The scenario makes it a whole number (Task 1's validation). */
export function jobSteps(ctx: SimContext): number {
  return idiv(ctx.scenario.tuning.datacenter.jobMs * ctx.scenario.time.stepsPerSecond, 1000);
}

/** Steps one cooling cycle lasts: a press of [냉각] or one cool() call. */
export function coolSteps(ctx: SimContext): number {
  return idiv(ctx.scenario.tuning.datacenter.coolingCycleMs * ctx.scenario.time.stepsPerSecond, 1000);
}

function covers(from: number, until: number, step: number): boolean {
  return from <= step && step < until;
}

/**
 * Whether a datacenter works at this step: its job covers the step, it stands, and the grid supplies it. Its board does not matter:
 * the work is the facility's, whoever started it, and a sleeping or missing board does not stop it.
 */
export function isProcessing(ctx: SimContext, facilityId: string, step: number): boolean {
  const f = findFacility(ctx.world, facilityId);
  const dc = ctx.world.datacenters[facilityId];
  return !!f && !!dc && f.condition === 'ok' && f.powered && covers(dc.busyFrom, dc.busyUntil, step);
}

/** Whether a datacenter's cooling cycle runs at this step: the cycle covers the step, it stands, and the grid supplies it. */
export function isCooling(ctx: SimContext, facilityId: string, step: number): boolean {
  const f = findFacility(ctx.world, facilityId);
  const dc = ctx.world.datacenters[facilityId];
  return !!f && !!dc && f.condition === 'ok' && f.powered && covers(dc.coolFrom, dc.coolUntil, step);
}

/**
 * What a datacenter's own work requests this step, before transmission loss. That is processPower on a step its job covers, and
 * coolingPower on a step its cooling cycle covers, whoever started them. Power is requested whether or not it comes: the power
 * phase decides that. A wrecked or repairing datacenter requests nothing, and so does any other kind of facility.
 */
export function datacenterDraw(ctx: SimContext, facility: FacilityState, step: number): number {
  const dc = ctx.world.datacenters[facility.id];
  if (!dc || facility.condition !== 'ok') return 0;
  const t = ctx.scenario.tuning.datacenter;
  return (covers(dc.busyFrom, dc.busyUntil, step) ? t.processPower : 0) + (covers(dc.coolFrom, dc.coolUntil, step) ? t.coolingPower : 0);
}

/**
 * The milli-degrees a cooling cycle takes off at this step. coolingDropMilli is split over the cycle's steps, and the remainders are
 * spread so that the whole cycle takes off exactly coolingDropMilli: 15,000 over 80 steps is 187 and 188 by turns.
 */
export function coolingDrop(ctx: SimContext, dc: DatacenterState, step: number): number {
  const total = ctx.scenario.tuning.datacenter.coolingDropMilli;
  const n = dc.coolUntil - dc.coolFrom;
  const k = step - dc.coolFrom;
  if (n <= 0 || k < 0 || k >= n) return 0;
  return idiv(total * (k + 1), n) - idiv(total * k, n);
}

/** Phase 6: income and heat from work, the passive leak, and cooling cycles, for every datacenter that stands. */
export function runDatacenters(ctx: SimContext, step: number): void {
  const t = ctx.scenario.tuning.datacenter;
  const sps = ctx.scenario.time.stepsPerSecond;
  const w = ctx.world;
  for (const f of w.facilities) {
    const dc = w.datacenters[f.id];
    if (!dc || f.condition !== 'ok') continue;
    let temp = dc.tempMilli;
    if (isProcessing(ctx, f.id, step)) {
      const income = mulDiv(w.jobPrice, MICRO, sps);
      w.money += income;
      w.ledger.datacenterIncome += income;
      temp += idiv(t.heatMilliPerSecond, sps);
    }
    const excess = temp - t.ambientMilli;
    if (excess > 0) temp -= idiv(excess * t.passiveCoolingPermillePerSecond, 1000 * sps);
    if (isCooling(ctx, f.id, step)) temp -= coolingDrop(ctx, dc, step);
    dc.tempMilli = Math.max(temp, t.ambientMilli);
    if (dc.tempMilli >= t.overheatAlertMilli) {
      raiseOnce(w, `overheat:${f.id}`, step, 'overheat', f.id, `${f.id} 과열 ${idiv(dc.tempMilli, MILLI)}°C`);
    } else if (dc.tempMilli < t.overheatAlertMilli - 5 * MILLI) {
      clearFlag(w, `overheat:${f.id}`);
    }
  }
}

/**
 * Phase 9: a standing datacenter above the fire threshold rolls for fire every step, asleep, shed, or without a board alike.
 * A fire wrecks it, its board with it.
 */
export function runFires(ctx: SimContext, step: number): void {
  const t = ctx.scenario.tuning.datacenter;
  const sps = ctx.scenario.time.stepsPerSecond;
  for (const f of ctx.world.facilities) {
    const dc = ctx.world.datacenters[f.id];
    if (!dc || f.condition !== 'ok') continue;
    if (dc.tempMilli <= t.fireThresholdMilli) continue;
    const ppm = idiv((dc.tempMilli - t.fireThresholdMilli) * t.firePermillePerDegreePerSecond, sps);
    if (ctx.rng.fire.chancePpm(ppm)) {
      raiseAlert(ctx.world, step, 'fire', f.id, `${f.id}에 불이 났어요`);
      wreckFacility(ctx, f, step, 'fire');
    }
  }
}
