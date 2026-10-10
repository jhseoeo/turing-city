import { clearFlag, raiseAlert, raiseOnce } from './alerts.ts';
import { wreckFacility } from './boards.ts';
import { idiv, MICRO, MILLI, mulDiv } from './fixed.ts';
import { type DatacenterState, type FacilityState, findFacility, type SimContext } from './world.ts';

/** Steps one job runs: a press of [처리], or one process(). The scenario makes it a whole number. */
export function jobSteps(ctx: SimContext): number {
  return idiv(ctx.scenario.tuning.datacenter.jobMs * ctx.scenario.time.stepsPerSecond, 1000);
}

/** Steps one cooling cycle lasts: a press of [냉각], or one cool(). The scenario makes it a whole number. */
export function coolSteps(ctx: SimContext): number {
  return idiv(ctx.scenario.tuning.datacenter.coolingCycleMs * ctx.scenario.time.stepsPerSecond, 1000);
}

function covers(from: number, until: number, step: number): boolean {
  return from <= step && step < until;
}

/**
 * Whether a datacenter works at this step: it stands, the grid supplies it, and its busy window covers the step. Its board does not
 * matter: the work is the facility's, whoever started it, and a sleeping or missing board does not stop it.
 */
export function isProcessing(ctx: SimContext, facilityId: string, step: number): boolean {
  const facility = findFacility(ctx.world, facilityId);
  const dc = ctx.world.datacenters[facilityId];
  return !!facility && !!dc && facility.condition === 'ok' && facility.powered && covers(dc.busyFrom, dc.busyUntil, step);
}

/** Whether a datacenter cools at this step: the same, for its cool window. */
export function isCooling(ctx: SimContext, facilityId: string, step: number): boolean {
  const facility = findFacility(ctx.world, facilityId);
  const dc = ctx.world.datacenters[facilityId];
  return !!facility && !!dc && facility.condition === 'ok' && facility.powered && covers(dc.coolFrom, dc.coolUntil, step);
}

/**
 * What a datacenter's own work requests this step, before transmission loss: processPower on a step its busy window covers, and
 * coolingPower on a step its cool window covers, whoever started them. Power is requested whether or not it comes: the power phase
 * decides that. A wrecked or repairing datacenter requests nothing, and neither does any other kind of facility.
 */
export function datacenterDraw(ctx: SimContext, facility: FacilityState, step: number): number {
  const dc = ctx.world.datacenters[facility.id];
  if (!dc || facility.condition !== 'ok') return 0;
  const t = ctx.scenario.tuning.datacenter;
  return (covers(dc.busyFrom, dc.busyUntil, step) ? t.processPower : 0) + (covers(dc.coolFrom, dc.coolUntil, step) ? t.coolingPower : 0);
}

/**
 * The milli-degrees a cooling cycle takes off at this step. coolingDropMilli is split over the cycle's steps and the remainders are
 * spread, so that a whole cycle takes off exactly coolingDropMilli: 15,000 over 80 steps is 187 and 188 by turns. A window may hold
 * back-to-back cycles (a press at the step after one's last goes on with it), each coolSteps long from coolFrom, so the position is
 * taken within a cycle and not within the window.
 */
export function coolingDrop(ctx: SimContext, dc: DatacenterState, step: number): number {
  if (!covers(dc.coolFrom, dc.coolUntil, step)) return 0;
  const total = ctx.scenario.tuning.datacenter.coolingDropMilli;
  const n = coolSteps(ctx);
  const k = (step - dc.coolFrom) % n;
  return idiv(total * (k + 1), n) - idiv(total * k, n);
}

/**
 * Phase 6: for every datacenter that stands, income and heat from work, the slow passive leak, and the cooling cycle's drop.
 * A wrecked or repairing datacenter does nothing at all, not even leak.
 */
export function runDatacenters(ctx: SimContext, step: number): void {
  const t = ctx.scenario.tuning.datacenter;
  const sps = ctx.scenario.time.stepsPerSecond;
  const w = ctx.world;
  for (const facility of w.facilities) {
    const dc = w.datacenters[facility.id];
    if (!dc || facility.condition !== 'ok') continue;
    let temp = dc.tempMilli;
    if (isProcessing(ctx, facility.id, step)) {
      const income = mulDiv(w.jobPrice, MICRO, sps);
      w.money += income;
      w.ledger.datacenterIncome += income;
      temp += idiv(t.heatMilliPerSecond, sps);
    }
    const excess = temp - t.ambientMilli;
    if (excess > 0) temp -= idiv(excess * t.passiveCoolingPermillePerSecond, 1000 * sps);
    if (isCooling(ctx, facility.id, step)) temp -= coolingDrop(ctx, dc, step);
    dc.tempMilli = Math.max(temp, t.ambientMilli);
    if (dc.tempMilli >= t.overheatAlertMilli) {
      raiseOnce(w, `overheat:${facility.id}`, step, 'overheat', facility.id, `${facility.id} 과열 ${idiv(dc.tempMilli, MILLI)}°C`);
    } else if (dc.tempMilli < t.overheatAlertMilli - 5 * MILLI) {
      clearFlag(w, `overheat:${facility.id}`);
    }
  }
}

/**
 * Phase 9: a datacenter that stands and is above the fire threshold rolls for fire every step, whether its board sleeps or is
 * missing, and whether the grid supplies it or not. A fire wrecks it, its board with it.
 */
export function runFires(ctx: SimContext, step: number): void {
  const t = ctx.scenario.tuning.datacenter;
  const sps = ctx.scenario.time.stepsPerSecond;
  for (const facility of ctx.world.facilities) {
    const dc = ctx.world.datacenters[facility.id];
    if (!dc || facility.condition !== 'ok') continue;
    if (dc.tempMilli <= t.fireThresholdMilli) continue;
    const ppm = idiv((dc.tempMilli - t.fireThresholdMilli) * t.firePermillePerDegreePerSecond, sps);
    if (ctx.rng.fire.chancePpm(ppm)) {
      raiseAlert(ctx.world, step, 'fire', facility.id, `${facility.id}에 불이 났어요`);
      wreckFacility(ctx, facility, step, 'fire');
    }
  }
}
