import { clearFlag, raiseOnce } from './alerts.ts';
import { startSleep } from './boards.ts';
import { coolSteps, jobSteps, processProblem } from './datacenter.ts';
import { harvest } from './farm.ts';
import type { FacilityAction } from './firmware-host.ts';
import { clamp } from './fixed.ts';
import { jobPowerShort } from './power.ts';
import type { FacilityKind } from './scenario.ts';
import type { Ticked } from './ticks.ts';
import { dispatch } from './warehouse.ts';
import { type FacilityState, findFacility, type SimContext, toInt } from './world.ts';

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
 * Applies one facility action, from firmware or from the player's hand: the same action does the same thing either way.
 * startStep is the first step it affects: the hand acts between steps, at world.step, and firmware in phase 5 of step s acts
 * from s + 1. A wrecked or repairing facility ignores every action, and so does a facility of the wrong kind.
 */
export function applyFacilityAction(ctx: SimContext, facility: FacilityState, action: FacilityAction, startStep: number): void {
  if (facility.condition !== 'ok' || kindProblem(facility, action) !== null) return;
  const w = ctx.world;
  const t = ctx.scenario.tuning;
  // Firmware's action comes during step w.step and starts at the next one, while the job or cycle that covers w.step has yet to run
  // it: that one is still running too. (The hand's action comes between steps, and starts at w.step.)
  const now = w.step;
  switch (action.kind) {
    case 'process': {
      // A job runs jobMs from its start, to its end: a press while one runs does nothing (the user, 2026-10-16: the next job waits for
      // this one to finish). No job starts while a cooling cycle runs, nor without the power for it: that one raises an alert, once
      // until a job starts again, so that firmware calling on every beat doesn't flood the feed.
      const dc = w.datacenters[facility.id]!;
      if (processProblem(ctx, facility.id, now) !== null) break;
      const problem = jobProblem(ctx, facility, startStep);
      if (problem === 'not enough power') {
        raiseOnce(w, `jobPower:${facility.id}`, now, 'powerShortage', facility.id, `${facility.id} 전력이 모자라 처리를 시작하지 못했어요`);
      }
      if (problem !== null) break;
      clearFlag(w, `jobPower:${facility.id}`);
      dc.busyFrom = startStep;
      dc.busyUntil = startStep + jobSteps(ctx);
      dc.workedSteps = 0;
      break;
    }
    case 'cool': {
      // A cooling cycle runs to its end: a press while one runs does nothing. It stops a running job: the two never run at once.
      const dc = w.datacenters[facility.id]!;
      const cycling = (step: number): boolean => dc.coolFrom <= step && step < dc.coolUntil;
      if (cycling(now) || cycling(startStep)) break;
      dc.coolFrom = startStep;
      dc.coolUntil = startStep + coolSteps(ctx);
      if (dc.busyFrom <= startStep && startStep < dc.busyUntil) dc.busyUntil = startStep;
      break;
    }
    case 'setThermal':
      w.plant.thermalSetting = clamp(toInt(action.output), 0, t.thermal.max);
      break;
    case 'setPriority': {
      // A priority list names facilities, with a board or not: housing is a consumer too.
      const known = new Set(w.facilities.map((f) => f.id));
      w.plant.priority = [...new Set(action.order.filter((id) => known.has(id)))];
      break;
    }
    case 'harvest':
      harvest(ctx, facility.id, startStep);
      break;
    case 'dispatch':
      dispatch(ctx, facility.id, action, startStep);
      break;
  }
}

/** Phase 5: applies what each tick asked for, from the next step. A failed tick asks for nothing, and a sleep stops the rest. */
export function applyActions(ctx: SimContext, step: number, ticked: readonly Ticked[]): void {
  for (const { board, outcome } of ticked) {
    const facility = findFacility(ctx.world, board.id)!;
    for (const action of outcome.actions) {
      if (board.status !== 'running') break; // a sleep stops the rest of the list
      if (action.kind === 'sleep') startSleep(ctx, board, step, action.seconds);
      else applyFacilityAction(ctx, facility, action, step + 1);
    }
  }
}
