import { Worker } from 'node:worker_threads';
import {
  type AgentStatus,
  type AlertKind,
  type AlertView,
  type BoardInspection,
  type BoardSummary,
  type ControllerEvent,
  type ControllerStatus,
  type Datasheet,
  type DeployOutcome,
  type FirmwareView,
  type GameState,
  type LogView,
  type MapView,
  type Query,
  type Scenario,
  type Snapshot,
  type StatusView,
  ToolError,
  timeView,
  type WorkerRequest,
  type WorkerResponse,
} from '@turing-city/core';
import { SyntaxChecker } from '@turing-city/firmware';

export interface ControllerOptions {
  readonly scenario: Scenario;
  /** A batch of steps taking longer than this stops the session (spec §6.8). */
  readonly watchdogMs?: number;
  /** The most steps one batch may carry. */
  readonly stepsPerBatch?: number;
}

const CLOCK_MS = 50;
const NO_SEASON = "The season hasn't started: ask the player to press Start.";

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void };

/**
 * The main thread's side of a season: the clock, the worker, the watchdog, and the rules
 * of play (an agent must be connected to start or play).
 */
export class GameController {
  private readonly scenario: Scenario;
  private readonly watchdogMs: number;
  private readonly stepsPerBatch: number;
  private readonly listeners = new Set<(event: ControllerEvent) => void>();
  private readonly pending = new Map<number, Pending>();
  private checker: Promise<SyntaxChecker> | null = null;
  private worker: Worker | null = null;
  private progress: Int32Array | null = null;
  private nextId = 1;
  private state: GameState = 'idle';
  private speed: 1 | 2 | 3 = 1;
  private agent: AgentStatus = { connected: false, clientName: null };
  private crash: string | null = null;
  private autoPause: AlertKind[] = ['raid', 'boardDestroyed', 'fire', 'firmwareError'];
  private snapshotNow: Snapshot | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastClock = 0;
  private debt = 0;
  private inFlight: Promise<void> | null = null;

  constructor(options: ControllerOptions) {
    this.scenario = options.scenario;
    this.watchdogMs = options.watchdogMs ?? 5000;
    this.stepsPerBatch = options.stepsPerBatch ?? 200;
  }

  onEvent(listener: (event: ControllerEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  status(): ControllerStatus {
    return {
      state: this.state,
      speed: this.speed,
      agent: this.agent,
      blockedByAgent: !this.agent.connected,
      crash: this.crash,
      autoPause: [...this.autoPause],
      scenarioName: this.scenario.name,
    };
  }

  latestSnapshot(): Snapshot | null {
    return this.snapshotNow;
  }

  setAgent(agent: AgentStatus): void {
    this.agent = agent;
    if (!agent.connected && this.state === 'running') this.pause();
    else this.emitStatus();
  }

  setAutoPause(kinds: readonly AlertKind[]): void {
    this.autoPause = [...kinds];
    this.emitStatus();
  }

  setSpeed(speed: 1 | 2 | 3): void {
    this.speed = speed;
    this.emitStatus();
  }

  /** A new season in a fresh worker (a fresh Lua runtime). It starts paused. */
  async startSeason(seed = Math.floor(Math.random() * 2 ** 31)): Promise<void> {
    if (!this.agent.connected) throw new Error('connect an agent first');
    this.stopClock();
    this.terminate('a new season started');
    // Until the new worker answers 'started', reads and deploys get "the season hasn't started".
    this.state = 'idle';
    this.crash = null;
    this.progress = new Int32Array(new SharedArrayBuffer(8));
    this.progress[0] = -1;
    // Node strips the worker's types itself and warns about it once per thread; the server runs with this flag already.
    const worker = new Worker(new URL('./worker.ts', import.meta.url), {
      workerData: { progress: this.progress.buffer },
      execArgv: ['--disable-warning=ExperimentalWarning'],
    });
    this.worker = worker;
    worker.on('message', (m: WorkerResponse) => this.onWorker(m));
    worker.on('error', (e) => this.fail(`the simulator failed: ${e instanceof Error ? e.message : String(e)}`));
    const started = new Promise<Snapshot>((resolve, reject) => {
      this.startWaiter = { resolve, reject };
    });
    this.post({ type: 'start', scenario: this.scenarioJson(), seed });
    this.snapshotNow = await started;
    this.state = 'paused';
    this.emit({ kind: 'snapshot', snapshot: this.snapshotNow });
    this.emitStatus();
  }

  play(): void {
    if (!this.agent.connected) throw new Error('connect an agent first');
    if (this.state !== 'paused') return;
    this.state = 'running';
    this.post({ type: 'mark', kind: 'resume' });
    this.lastClock = performance.now();
    this.debt = 0;
    this.timer = setInterval(() => this.onClock(), CLOCK_MS);
    this.emitStatus();
  }

  pause(): void {
    if (this.state !== 'running') return;
    this.stopClock();
    this.state = 'paused';
    this.post({ type: 'mark', kind: 'pause' });
    this.emitStatus();
  }

  /** As fast as possible, without the clock: for tests and the dev tools. */
  async runUntil(goal: { seconds?: number; alertKinds?: readonly AlertKind[] }): Promise<void> {
    if (this.state !== 'paused') throw new Error('run_until needs a paused season');
    const sps = this.scenario.time.stepsPerSecond;
    const target = goal.seconds === undefined ? Number.POSITIVE_INFINITY : (this.snapshotNow?.step ?? 0) + goal.seconds * sps;
    for (;;) {
      const at = this.snapshotNow?.step ?? 0;
      if (at >= target || (this.state as GameState) !== 'paused' || this.snapshotNow?.ended) return;
      const alerts = await this.advance(Math.min(this.stepsPerBatch, target - at));
      if (goal.alertKinds && alerts.some((a) => goal.alertKinds!.includes(a.kind))) return;
    }
  }

  async deploy(board: string, code: string): Promise<DeployOutcome> {
    this.requireSeason();
    this.checker ??= SyntaxChecker.create();
    const problem = (await this.checker).check(code);
    if (problem !== null) return { ok: false, error: problem };
    const result = (await this.request({ type: 'deploy', id: 0, board, code })) as { version: number };
    const time = timeView(this.scenario, this.snapshotNow?.step ?? 0);
    this.emit({ kind: 'deploy', board, version: result.version, time });
    return { ok: true, version: result.version, installsAt: "the board's next tick" };
  }

  async rebuild(board: string): Promise<{ ok: true } | { ok: false; reason: string }> {
    this.requireSeason();
    return (await this.request({ type: 'rebuild', id: 0, board })) as { ok: true } | { ok: false; reason: string };
  }

  listBoards(): Promise<BoardSummary[]> {
    return this.query({ kind: 'listBoards' }) as Promise<BoardSummary[]>;
  }
  datasheet(board: string): Promise<Datasheet | null> {
    return this.query({ kind: 'datasheet', board }) as Promise<Datasheet | null>;
  }
  firmware(board: string): Promise<FirmwareView | null> {
    return this.query({ kind: 'firmware', board }) as Promise<FirmwareView | null>;
  }
  logs(board: string, since: number | undefined): Promise<LogView[] | null> {
    return this.query({ kind: 'logs', board, since: since ?? null }) as Promise<LogView[] | null>;
  }
  map(): Promise<MapView> {
    return this.query({ kind: 'map' }) as Promise<MapView>;
  }
  /** The season's status for the agent tools (status() is the controller's own). */
  statusOf(): Promise<StatusView> {
    return this.query({ kind: 'status' }) as Promise<StatusView>;
  }
  alerts(since: number | undefined): Promise<AlertView[]> {
    return this.query({ kind: 'alerts', since: since ?? null }) as Promise<AlertView[]>;
  }
  inspect(board: string): Promise<BoardInspection | null> {
    return this.query({ kind: 'inspect', board }) as Promise<BoardInspection | null>;
  }

  close(): void {
    this.stopClock();
    this.terminate('the server is shutting down');
    this.listeners.clear();
  }

  // ---- internals ----

  private startWaiter: { resolve: (s: Snapshot) => void; reject: (e: Error) => void } | null = null;
  private advanceWaiter: { resolve: (alerts: readonly AlertView[]) => void; reject: (e: Error) => void } | null = null;
  private watchdog: ReturnType<typeof setTimeout> | null = null;

  private onClock(): void {
    if (this.state !== 'running' || this.inFlight) return;
    const now = performance.now();
    this.debt += ((now - this.lastClock) / 1000) * this.scenario.time.stepsPerSecond * this.speed;
    this.lastClock = now;
    const n = Math.min(Math.floor(this.debt), this.stepsPerBatch);
    if (n <= 0) return;
    this.debt -= n;
    this.inFlight = this.advance(n)
      .then(() => undefined)
      .catch(() => undefined)
      .finally(() => {
        this.inFlight = null;
      });
  }

  private advance(steps: number): Promise<readonly AlertView[]> {
    return new Promise((resolve, reject) => {
      this.advanceWaiter = { resolve, reject };
      this.watchdog = setTimeout(() => this.onWatchdog(), this.watchdogMs);
      this.post({ type: 'advance', steps });
    });
  }

  private onWorker(m: WorkerResponse): void {
    switch (m.type) {
      case 'started':
        this.startWaiter?.resolve(m.snapshot);
        this.startWaiter = null;
        return;
      case 'advanced': {
        if (this.watchdog) clearTimeout(this.watchdog);
        this.watchdog = null;
        this.snapshotNow = m.snapshot;
        this.emit({ kind: 'snapshot', snapshot: m.snapshot });
        if (m.alerts.length > 0) this.emit({ kind: 'alerts', alerts: m.alerts });
        if (m.snapshot.ended) {
          this.stopClock();
          this.state = 'ended';
          this.emitStatus();
        } else if (this.state === 'running' && m.alerts.some((a) => this.autoPause.includes(a.kind))) {
          this.pause();
        }
        const waiter = this.advanceWaiter;
        this.advanceWaiter = null;
        waiter?.resolve(m.alerts);
        return;
      }
      case 'reply': {
        const p = this.pending.get(m.id);
        this.pending.delete(m.id);
        p?.resolve(m.value);
        return;
      }
      case 'fatal':
        this.fail(`the simulator failed: ${m.message}`);
        return;
    }
  }

  private onWatchdog(): void {
    const index = this.progress ? Atomics.load(this.progress, 0) : -1;
    const version = this.progress ? Atomics.load(this.progress, 1) : 0;
    const board = index >= 0 ? this.scenario.facilities[index]?.id : undefined;
    this.fail(
      board
        ? `the simulator stopped responding while ${board} ran firmware v${version}; the session stopped`
        : 'the simulator stopped responding; the session stopped',
    );
  }

  private fail(message: string): void {
    this.stopClock();
    this.terminate(message);
    this.state = 'crashed';
    this.crash = message;
    this.emitStatus();
  }

  private query(query: Query): Promise<unknown> {
    if (!this.worker || this.state === 'idle' || this.state === 'crashed') return Promise.reject(new ToolError(NO_SEASON));
    return this.request({ type: 'query', id: 0, query });
  }

  private request(message: WorkerRequest & { id: number }): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.post({ ...message, id } as WorkerRequest);
    });
  }

  private requireSeason(): void {
    if (!this.worker || this.state === 'idle' || this.state === 'crashed') throw new ToolError(NO_SEASON);
  }

  private post(message: WorkerRequest): void {
    this.worker?.postMessage(message);
  }

  private stopClock(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Stops the worker and fails everything still waiting on it, so no caller hangs. */
  private terminate(reason: string): void {
    if (this.watchdog) clearTimeout(this.watchdog);
    this.watchdog = null;
    if (this.worker) void this.worker.terminate();
    this.worker = null;
    const error = new Error(reason);
    this.startWaiter?.reject(error);
    this.startWaiter = null;
    this.advanceWaiter?.reject(error);
    this.advanceWaiter = null;
    for (const p of this.pending.values()) p.reject(error);
    this.pending.clear();
  }

  private scenarioJson(): unknown {
    return JSON.parse(JSON.stringify(this.scenario));
  }

  private emitStatus(): void {
    this.emit({ kind: 'status', status: this.status() });
  }

  private emit(event: ControllerEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}
