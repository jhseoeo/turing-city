import { clearFlag, raiseOnce } from './alerts.ts';
import { coolSteps, jobSteps, processProblem } from './datacenter.ts';
import { harvest, harvestProblem } from './farm.ts';
import type { FacilityAction } from './firmware-host.ts';
import { clamp } from './fixed.ts';
import { jobPowerShort } from './power.ts';
import type { FacilityKind } from './scenario.ts';
import { dispatch, dispatchProblem } from './warehouse.ts';
import { type FacilityState, type SimContext, toInt } from './world.ts';

/** The kind of facility each action works. */
const ACTION_FACILITY: Record<FacilityAction['kind'], FacilityKind> = {
  process: 'datacenter',
  cool: 'datacenter',
  setThermal: 'power',
  setPriority: 'power',
  harvest: 'farm',
  dispatch: 'warehouse',
};

/** Each kind in words, for refusals. */
const KIND_NAMES: Record<FacilityKind, string> = {
  power: 'power plant',
  datacenter: 'datacenter',
  farm: 'farm',
  warehouse: 'warehouse',
  housing: 'housing block',
};

/**
 * Why a datacenter can't start a job at this step, or null: a cooling cycle or a job runs, or the grid can't supply it with the job
 * (the user, 2026-10-17: with too little power, no job starts at all). Session.hand refuses with it; firmware's process() is ignored.
 */
export function jobProblem(ctx: SimContext, facility: FacilityState, step: number): string | null {
  return processProblem(ctx, facility.id, step) ?? (jobPowerShort(ctx, facility, step) > 0 ? 'not enough power' : null);
}

/** Why a facility of its kind can't take the action at all, or null. Session.hand refuses with it. */
export function kindProblem(facility: FacilityState, action: FacilityAction): string | null {
  const kind = ACTION_FACILITY[action.kind];
  return facility.kind === kind ? null : `${action.kind} is a ${KIND_NAMES[kind]}'s action`;
}

/**
 * Applies one facility action, from firmware or from the player's hand: the same action does the same thing either way. Returns
 * null, or why the facility did not take it, and then nothing changed: the hand's refusal and the answer of firmware's call (the user,
 * 2026-10-17). startStep is the first step it affects: the hand acts between steps, at world.step, and firmware acts mid-tick in
 * step s, from s + 1.
 */
export function applyFacilityAction(ctx: SimContext, facility: FacilityState, action: FacilityAction, startStep: number): string | null {
  if (facility.condition !== 'ok') return 'the facility is wrecked';
  const wrongKind = kindProblem(facility, action);
  if (wrongKind !== null) return wrongKind;
  const w = ctx.world;
  const t = ctx.scenario.tuning;
  // Firmware's action comes during step w.step and starts at the next one, while the job or cycle that covers w.step has yet to run
  // it: that one is still running too. (The hand's action comes between steps, and starts at w.step.)
  const now = w.step;
  switch (action.kind) {
    case 'process': {
      // A job runs jobMs from its start, to its end: a press while one runs does nothing (the user, 2026-10-16: the next job waits for
      // this one to finish). No job starts while a cooling cycle runs, nor without the power for it.
      const dc = w.datacenters[facility.id]!;
      const problem = processProblem(ctx, facility.id, now) ?? jobProblem(ctx, facility, startStep);
      if (problem !== null) return problem;
      dc.busyFrom = startStep;
      dc.busyUntil = startStep + jobSteps(ctx);
      dc.workedSteps = 0;
      return null;
    }
    case 'cool': {
      // A cooling cycle runs to its end: a press while one runs does nothing. It stops a running job: the two never run at once.
      const dc = w.datacenters[facility.id]!;
      const cycling = (step: number): boolean => dc.coolFrom <= step && step < dc.coolUntil;
      if (cycling(now) || cycling(startStep)) return 'a cooling cycle is running';
      dc.coolFrom = startStep;
      dc.coolUntil = startStep + coolSteps(ctx);
      if (dc.busyFrom <= startStep && startStep < dc.busyUntil) dc.busyUntil = startStep;
      return null;
    }
    case 'setThermal':
      w.plant.thermalSetting = clamp(toInt(action.output), 0, t.thermal.max);
      return null;
    case 'setPriority': {
      // A priority list names facilities, with a board or not: housing is a consumer too.
      const known = new Set(w.facilities.map((f) => f.id));
      w.plant.priority = [...new Set(action.order.filter((id) => known.has(id)))];
      return null;
    }
    case 'harvest': {
      const problem = harvestProblem(ctx, facility.id, startStep);
      if (problem === null) harvest(ctx, facility.id, startStep);
      return problem;
    }
    case 'dispatch': {
      const problem = dispatchProblem(ctx, facility.id, action);
      if (problem === null) dispatch(ctx, facility.id, action, startStep);
      return problem;
    }
  }
}

/**
 * One action of a board's firmware, mid-tick in phase 4 of step s: it applies at once, from s + 1, and its answer goes back to the
 * call. A job refused for want of power raises an alert, once until a job starts again, so that firmware calling on every beat
 * doesn't flood the feed (the user, 2026-10-17).
 */
export function firmwareAction(ctx: SimContext, facility: FacilityState, action: FacilityAction, step: number): string | null {
  const why = applyFacilityAction(ctx, facility, action, step + 1);
  if (action.kind === 'process') {
    const flag = `jobPower:${facility.id}`;
    if (why === 'not enough power') {
      raiseOnce(ctx.world, flag, step, 'powerShortage', facility.id, `${facility.id} 전력이 모자라 처리를 시작하지 못했어요`);
    } else if (why === null) {
      clearFlag(ctx.world, flag);
    }
  }
  return why;
}
