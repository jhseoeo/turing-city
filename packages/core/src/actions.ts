import { startSleep } from './boards.ts';
import { coolSteps, jobSteps } from './datacenter.ts';
import { harvest } from './farm.ts';
import type { FacilityAction } from './firmware-host.ts';
import { clamp } from './fixed.ts';
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
  switch (action.kind) {
    case 'process': {
      // A job runs jobMs from its start. A press while one runs doesn't stack: the job ends jobMs after the latest press. A job
      // that covers the step before startStep is still running: firmware acts after the power phase charged that step and before
      // the datacenter phase pays and heats it, so the press goes on with the job, and no step is lost.
      const dc = w.datacenters[facility.id]!;
      const running = dc.busyFrom < startStep && startStep <= dc.busyUntil;
      if (!running) dc.busyFrom = startStep;
      dc.busyUntil = Math.max(dc.busyUntil, startStep + jobSteps(ctx));
      break;
    }
    case 'cool': {
      // A cooling cycle runs to its end: a press while one runs does nothing. A press on the step after its last goes on with it,
      // for the same reason as a job's: that last step is still to be cooled, so the new cycle extends the window.
      const dc = w.datacenters[facility.id]!;
      if (dc.coolFrom <= startStep && startStep < dc.coolUntil) break;
      const continues = dc.coolFrom < startStep && startStep <= dc.coolUntil;
      if (!continues) dc.coolFrom = startStep;
      dc.coolUntil = startStep + coolSteps(ctx);
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
      if (facility.kind === 'farm') harvest(ctx, facility.id, startStep);
      break;
    case 'dispatch':
      if (facility.kind === 'warehouse') dispatch(ctx, facility.id, action, startStep);
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
