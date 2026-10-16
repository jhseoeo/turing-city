import { applyActions, applyFacilityAction, kindProblem } from './actions.ts';
import { deployFirmware, runTransitions } from './boards.ts';
import { runDatacenters, runFires } from './datacenter.ts';
import { checkEnd, installPart, runEconomy, startRebuild, startRepair } from './economy.ts';
import { runEmf } from './emf.ts';
import type { FacilityAction, FirmwareHost } from './firmware-host.ts';
import { runLuddites, runRumour } from './luddites.ts';
import { runPower } from './power.ts';
import type { Refusal } from './refusal.ts';
import { createRng, deriveSeed } from './rng.ts';
import type { Scenario } from './scenario.ts';
import { runSeries } from './series.ts';
import { runBoardTicks } from './ticks.ts';
import { type Alert, createWorld, findBoard, findFacility, type SimContext, type Streams, type WorldState } from './world.ts';

/** Who deployed a firmware: the player from the game's editor, or an agent over MCP. */
export type DeployedBy = 'player' | 'agent';

/** What the player buys for a facility: its board (T1), or the board's comm module (T2). */
export type InstallPart = 'board' | 'comm';

/** Every command of the player answers this: done, or why not (English for agents and logs, a code for the viewer's Korean). */
export type CommandResult = { readonly ok: true } | { readonly ok: false; readonly reason: string; readonly refusal: Refusal };

/** Milestone 1's name for a rebuild's answer. */
export type RebuildResult = CommandResult;

export type RecordedInput =
  | {
      readonly step: number;
      readonly kind: 'deploy';
      readonly boardId: string;
      readonly version: number;
      readonly source: string;
      readonly by: DeployedBy;
    }
  | { readonly step: number; readonly kind: 'install'; readonly facilityId: string; readonly part: InstallPart }
  | { readonly step: number; readonly kind: 'repair'; readonly facilityId: string }
  | { readonly step: number; readonly kind: 'rebuild'; readonly boardId: string }
  | { readonly step: number; readonly kind: 'hand'; readonly facilityId: string; readonly action: FacilityAction }
  | { readonly step: number; readonly kind: 'pause' | 'resume' };

const SEASON_ENDED: CommandResult = { ok: false, reason: 'the season has ended', refusal: { code: 'seasonEnded' } };

export interface SessionRecord {
  readonly scenarioId: string;
  readonly seed: number;
  readonly inputs: RecordedInput[];
}

export interface StepReport {
  /** The world's step after this one. */
  readonly step: number;
  readonly alerts: readonly Alert[];
  readonly ended: WorldState['ended'];
}

export class Session {
  readonly scenario: Scenario;
  readonly seed: number;
  readonly world: WorldState;
  readonly record: SessionRecord;
  /** What every phase reads and changes; the server's queries read it too. */
  readonly ctx: SimContext;

  constructor(scenario: Scenario, seed: number, host: FirmwareHost) {
    this.scenario = scenario;
    this.seed = seed;
    this.world = createWorld(scenario);
    this.record = { scenarioId: scenario.id, seed, inputs: [] };
    const rng: Streams = {
      weather: createRng(deriveSeed(seed, 'weather')),
      market: createRng(deriveSeed(seed, 'market')),
      fire: createRng(deriveSeed(seed, 'fire')),
      luddites: createRng(deriveSeed(seed, 'luddites')),
    };
    this.ctx = { scenario, world: this.world, host, seed, rng };
  }

  /** Advances the world by one step and reports the alerts raised during it. */
  step(): StepReport {
    const w = this.world;
    if (w.ended) return { step: w.step, alerts: [], ended: w.ended };
    const s = w.step;
    const firstAlert = w.nextAlertId;
    runTransitions(this.ctx, s);
    runSeries(this.ctx, s);
    runPower(this.ctx, s);
    const ticked = runBoardTicks(this.ctx, s);
    applyActions(this.ctx, s, ticked);
    runDatacenters(this.ctx, s);
    runEmf(this.ctx, ticked);
    runRumour(this.ctx, s);
    runLuddites(this.ctx, s);
    runFires(this.ctx, s);
    runEconomy(this.ctx);
    checkEnd(this.ctx, s);
    w.step = s + 1;
    return { step: w.step, alerts: w.alerts.filter((a) => a.id >= firstAlert), ended: w.ended };
  }

  /** Queues firmware for a board; it becomes current at the board's next tick. A facility without a board takes no firmware. */
  deploy(boardId: string, source: string, by: DeployedBy = 'player'): { version: number } {
    const board = findBoard(this.world, boardId);
    if (!board) throw new Error(findFacility(this.world, boardId) ? `${boardId} has no board` : `unknown board ${boardId}`);
    const version = deployFirmware(board, source);
    this.record.inputs.push({ step: this.world.step, kind: 'deploy', boardId, version, source, by });
    return { version };
  }

  /** The player buys a facility's board or its board's comm module. Refused once the season has ended: money is the score. */
  install(facilityId: string, part: InstallPart): CommandResult {
    if (this.world.ended) return SEASON_ENDED;
    const result = installPart(this.ctx, facilityId, part, this.world.step);
    if (result.ok) this.record.inputs.push({ step: this.world.step, kind: 'install', facilityId, part });
    return result;
  }

  /** The player's repair of a wrecked facility. Refused once the season has ended. */
  repair(facilityId: string): CommandResult {
    if (this.world.ended) return SEASON_ENDED;
    const result = startRepair(this.ctx, facilityId, this.world.step);
    if (result.ok) this.record.inputs.push({ step: this.world.step, kind: 'repair', facilityId });
    return result;
  }

  /** The player's rebuild of a destroyed board. Refused once the season has ended: money is the score, and a replay stops there. */
  rebuild(boardId: string): CommandResult {
    if (this.world.ended) return SEASON_ENDED;
    const result = startRebuild(this.ctx, boardId, this.world.step);
    if (result.ok) this.record.inputs.push({ step: this.world.step, kind: 'rebuild', boardId });
    return result;
  }

  /**
   * The player works a facility by hand, as its firmware would: the action applies at once, between steps, from world.step on.
   * Firmware that sets the same thing in a later step wins over it, as the hand wins over firmware that set it before: the last
   * writer wins. Refused for a facility that isn't there, isn't standing, or doesn't take the action.
   */
  hand(facilityId: string, action: FacilityAction): CommandResult {
    if (this.world.ended) return SEASON_ENDED;
    const facility = findFacility(this.world, facilityId);
    if (!facility)
      return { ok: false, reason: `unknown facility ${facilityId}`, refusal: { code: 'unknownFacility', facility: facilityId } };
    if (facility.condition !== 'ok')
      return { ok: false, reason: `${facilityId} is wrecked`, refusal: { code: 'wrecked', facility: facilityId } };
    const problem = kindProblem(facility, action);
    if (problem !== null) {
      return { ok: false, reason: `${facilityId}: ${problem}`, refusal: { code: 'cannotAct', facility: facilityId, detail: problem } };
    }
    this.record.inputs.push({ step: this.world.step, kind: 'hand', facilityId, action });
    this.world.stats.handActions += 1;
    applyFacilityAction(this.ctx, facility, action, this.world.step);
    return { ok: true };
  }

  /** Records a pause or a resume; the world doesn't change. */
  mark(kind: 'pause' | 'resume'): void {
    this.record.inputs.push({ step: this.world.step, kind });
  }

  close(): void {
    this.ctx.host.close();
  }
}

/** Rebuilds a session from its record, up to (not including) the given step. */
export function replay(scenario: Scenario, seed: number, record: SessionRecord, host: FirmwareHost, untilStep: number): Session {
  const session = new Session(scenario, seed, host);
  let next = 0;
  while (session.world.step < untilStep && !session.world.ended) {
    while (next < record.inputs.length && record.inputs[next]!.step === session.world.step) {
      const input = record.inputs[next]!;
      if (input.kind === 'deploy') session.deploy(input.boardId, input.source, input.by);
      else if (input.kind === 'install') session.install(input.facilityId, input.part);
      else if (input.kind === 'repair') session.repair(input.facilityId);
      else if (input.kind === 'rebuild') session.rebuild(input.boardId);
      else if (input.kind === 'hand') session.hand(input.facilityId, input.action);
      else session.mark(input.kind);
      next += 1;
    }
    session.step();
  }
  return session;
}
