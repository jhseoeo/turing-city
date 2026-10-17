import {
  type Act,
  alertsView,
  alertView,
  type BoardState,
  type BootInfo,
  boardManual,
  type CommandResult,
  type DeployedBy,
  type FirmwareHost,
  findBoard,
  findFacility,
  firmwareView,
  inspectBoard,
  listBoards,
  logsView,
  mapView,
  parseScenario,
  type Query,
  Session,
  snapshot,
  statusView,
  type TickInput,
  type TickOutcome,
  ToolError,
  type WorkerRequest,
  type WorkerResponse,
} from '@turing-city/core';
import { WasmoonHost } from '@turing-city/firmware';
import { exactAction } from './hand-action.ts';

/** What the season's thread needs from where it runs: a Node worker thread, or a browser's Web Worker (the web demo). */
export interface SeasonWorkerOptions {
  /** Sends a response to the controller. */
  readonly post: (message: WorkerResponse) => void;
  /**
   * Told around each board's tick: the board's index and firmware version while it runs, and -1 after. The Node worker writes it
   * into shared memory, where the controller's watchdog reads which board stopped answering.
   */
  readonly progress?: (index: number, version: number) => void;
  /** Where the Lua WebAssembly module comes from (the firmware package's createLuaRuntime). */
  readonly wasmUrl?: string;
}

/** Tells which board is running around each tick. */
class TrackingHost implements FirmwareHost {
  private readonly inner: FirmwareHost;
  private readonly index: (boardId: string) => [number, number];
  private readonly progress: (index: number, version: number) => void;

  constructor(inner: FirmwareHost, index: (boardId: string) => [number, number], progress: (index: number, version: number) => void) {
    this.inner = inner;
    this.index = index;
    this.progress = progress;
  }
  boot(info: BootInfo): void {
    this.inner.boot(info);
  }
  tick(boardId: string, input: TickInput, act: Act): TickOutcome {
    const [i, version] = this.index(boardId);
    this.progress(i, version);
    try {
      return this.inner.tick(boardId, input, act);
    } finally {
      this.progress(-1, version);
    }
  }
  shutdown(boardId: string): void {
    this.inner.shutdown(boardId);
  }
  close(): void {
    this.inner.close();
  }
}

/**
 * The board an agent may work on: one with a comm module (T2, spec 10-10 §8). An id that names no board slot (nothing at all, or
 * housing, which takes no board) is null, which the agent tools read as an unknown board, as in milestone 1.
 */
function agentBoard(s: Session, id: string): BoardState | null {
  const facility = findFacility(s.world, id);
  if (!facility || facility.boardSpec === null) return null;
  const board = findBoard(s.world, id);
  if (!board?.comm) {
    throw new ToolError(`${id} has no comm module: the player installs one from the facility's panel`, { code: 'noComm', board: id });
  }
  return board;
}

/** Where a deploy goes: the player's needs a board, the agent's a comm module as well. */
function deployTarget(s: Session, id: string, by: DeployedBy): BoardState {
  if (s.world.ended) throw new ToolError('the season has ended', { code: 'seasonEnded' });
  const board = by === 'agent' ? agentBoard(s, id) : findBoard(s.world, id);
  if (board) return board;
  if (by === 'player' && findFacility(s.world, id)?.boardSpec) {
    throw new ToolError(`${id} has no board: install one from its panel first`, { code: 'noBoard', facility: id });
  }
  throw new ToolError(`unknown board ${id}; list_boards lists the boards`, { code: 'unknownBoard', board: id });
}

function answer(s: Session, query: Query): unknown {
  const ctx = s.ctx;
  switch (query.kind) {
    case 'listBoards':
      return listBoards(s.world);
    case 'manual':
      return agentBoard(s, query.board) ? boardManual(s.scenario, query.board) : null;
    case 'firmware':
      return agentBoard(s, query.board) ? firmwareView(s.world, query.board) : null;
    case 'logs':
      return agentBoard(s, query.board) ? logsView(ctx, query.board, query.since ?? undefined) : null;
    case 'map':
      return mapView(ctx);
    case 'status':
      return statusView(ctx);
    case 'alerts':
      return alertsView(ctx, query.since ?? undefined);
    case 'inspect':
      return inspectBoard(ctx, query.board);
  }
}

/**
 * The season's side of the controller's worker protocol, with no transport of its own: it runs one session and answers the
 * controller's requests through `post`. The returned function takes each request as it comes (the controller sends nothing else
 * until a season has 'started'); a request that throws past its own handling posts 'fatal'.
 */
export function createSeasonWorker(options: SeasonWorkerOptions): (message: WorkerRequest) => void {
  const send = options.post;
  const progress = options.progress ?? (() => {});
  let session: Session | null = null;

  /**
   * Answers a request that carries an id. A handler that throws fails that one request and leaves the season running, and a
   * ToolError's refusal travels with its message, so that the viewer can say it in Korean. A plain Error that escaped to `handle`
   * would stop the whole season as 'fatal'.
   */
  function reply(id: number, compute: () => unknown): void {
    try {
      send({ type: 'reply', id, value: compute() });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const refusal = error instanceof ToolError ? error.refusal : undefined;
      send(refusal ? { type: 'refused', id, message, refusal } : { type: 'refused', id, message });
    }
  }

  /**
   * A command that changed the world tells the main thread how it stands before it answers: snapshots otherwise come with a batch
   * of steps, and a game that stands still would show none of it. A refused command changed nothing.
   */
  function changed(s: Session, result: CommandResult): CommandResult {
    if (result.ok) send({ type: 'snapshot', snapshot: snapshot(s.ctx) });
    return result;
  }

  async function handle(message: WorkerRequest): Promise<void> {
    if (message.type === 'start') {
      const scenario = parseScenario(message.scenario);
      const holder: { s: Session | null } = { s: null };
      const host = new TrackingHost(
        await WasmoonHost.create(options.wasmUrl),
        (boardId) => {
          const board = holder.s?.world.boards.find((b) => b.id === boardId);
          return [board?.index ?? -1, (board?.pending ?? board?.firmware)?.version ?? 0];
        },
        progress,
      );
      session = new Session(scenario, message.seed, host);
      holder.s = session;
      send({ type: 'started', snapshot: snapshot(session.ctx) });
      return;
    }
    const s = session;
    if (!s) throw new Error(`no season for ${message.type}`);
    switch (message.type) {
      case 'advance': {
        const alerts = [];
        for (let i = 0; i < message.steps && !s.world.ended; i++) {
          for (const a of s.step().alerts) alerts.push(alertView(s.scenario, a));
        }
        send({ type: 'advanced', snapshot: snapshot(s.ctx), alerts });
        return;
      }
      case 'deploy':
        reply(message.id, () => {
          const board = deployTarget(s, message.board, message.by);
          const result = s.deploy(message.board, message.code, message.by);
          send({ type: 'snapshot', snapshot: snapshot(s.ctx) });
          // The controller tells when the code installs, which depends on what the board is doing and on its power.
          return {
            ...result,
            boardStatus: board.status,
            powered: board.powered,
            standing: findFacility(s.world, board.id)?.condition === 'ok',
          };
        });
        return;
      case 'install':
        reply(message.id, () => changed(s, s.install(message.facility, message.part)));
        return;
      case 'repair':
        reply(message.id, () => changed(s, s.repair(message.facility)));
        return;
      case 'rebuild':
        reply(message.id, () => changed(s, s.rebuild(message.board)));
        return;
      case 'hand':
        reply(message.id, () => {
          // The session trusts an action's shape and records the caller's object, so a client's is rebuilt exactly first.
          const action = exactAction(message.action);
          if (!action) {
            return {
              ok: false,
              reason: 'not a hand action',
              refusal: { code: 'badCommand', detail: 'not a hand action' },
            } satisfies CommandResult;
          }
          return changed(s, s.hand(message.facility, action));
        });
        return;
      case 'mark':
        s.mark(message.kind);
        return;
      case 'query':
        reply(message.id, () => answer(s, message.query));
        return;
    }
  }

  return (message: WorkerRequest) => {
    handle(message).catch((error: unknown) => send({ type: 'fatal', message: error instanceof Error ? error.message : String(error) }));
  };
}
