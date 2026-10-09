import { applyActions } from './actions.ts';
import { raiseAlert } from './alerts.ts';
import { deployFirmware, runTransitions } from './boards.ts';
import { runDatacenters, runFires } from './datacenter.ts';
import type { FirmwareHost } from './firmware-host.ts';
import { runPower } from './power.ts';
import { createRng, deriveSeed } from './rng.ts';
import type { Scenario } from './scenario.ts';
import { runSeries } from './series.ts';
import { runBoardTicks } from './ticks.ts';
import { seasonSteps } from './time.ts';
import { type Alert, createWorld, findBoard, type SimContext, type Streams, type WorldState } from './world.ts';

export type RecordedInput =
  | { readonly step: number; readonly kind: 'deploy'; readonly boardId: string; readonly version: number; readonly source: string }
  | { readonly step: number; readonly kind: 'rebuild'; readonly boardId: string }
  | { readonly step: number; readonly kind: 'pause' | 'resume' };

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
    runFires(this.ctx, s);
    this.checkSeasonEnd(s);
    w.step = s + 1;
    return { step: w.step, alerts: w.alerts.filter((a) => a.id >= firstAlert), ended: w.ended };
  }

  /** Queues firmware for a board; it becomes current at the board's next tick. */
  deploy(boardId: string, source: string): { version: number } {
    const board = findBoard(this.world, boardId);
    if (!board) throw new Error(`unknown board ${boardId}`);
    const version = deployFirmware(board, source);
    this.record.inputs.push({ step: this.world.step, kind: 'deploy', boardId, version, source });
    return { version };
  }

  /** Records a pause or a resume; the world doesn't change. */
  mark(kind: 'pause' | 'resume'): void {
    this.record.inputs.push({ step: this.world.step, kind });
  }

  close(): void {
    this.ctx.host.close();
  }

  private checkSeasonEnd(s: number): void {
    if (this.world.ended || s + 1 < seasonSteps(this.scenario.time)) return;
    this.world.ended = { kind: 'completed', step: s };
    raiseAlert(this.world, s, 'seasonEnd', null, '시즌이 끝났어요');
  }
}

/** Rebuilds a session from its record, up to (not including) the given step. */
export function replay(scenario: Scenario, seed: number, record: SessionRecord, host: FirmwareHost, untilStep: number): Session {
  const session = new Session(scenario, seed, host);
  let next = 0;
  while (session.world.step < untilStep && !session.world.ended) {
    while (next < record.inputs.length && record.inputs[next]!.step === session.world.step) {
      const input = record.inputs[next]!;
      if (input.kind === 'deploy') session.deploy(input.boardId, input.source);
      else if (input.kind === 'pause' || input.kind === 'resume') session.mark(input.kind);
      next += 1;
    }
    session.step();
  }
  return session;
}
