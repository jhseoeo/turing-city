import { parentPort, workerData } from 'node:worker_threads';
import {
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

if (!parentPort) throw new Error('worker.ts runs as a worker thread');
const port = parentPort;
/** [board index or -1, firmware version]: what the watchdog reports if this thread stops answering. */
const progress = new Int32Array((workerData as { progress: SharedArrayBuffer }).progress);

/** Writes which board is running into shared memory around each tick. */
class TrackingHost implements FirmwareHost {
  private readonly inner: FirmwareHost;
  private readonly index: (boardId: string) => [number, number];

  constructor(inner: FirmwareHost, index: (boardId: string) => [number, number]) {
    this.inner = inner;
    this.index = index;
  }
  boot(info: BootInfo): void {
    this.inner.boot(info);
  }
  tick(boardId: string, input: TickInput): TickOutcome {
    const [i, version] = this.index(boardId);
    Atomics.store(progress, 0, i);
    Atomics.store(progress, 1, version);
    try {
      return this.inner.tick(boardId, input);
    } finally {
      Atomics.store(progress, 0, -1);
    }
  }
  shutdown(boardId: string): void {
    this.inner.shutdown(boardId);
  }
  close(): void {
    this.inner.close();
  }
}

let session: Session | null = null;

function send(message: WorkerResponse): void {
  port.postMessage(message);
}

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
 * The board an agent may work on: one with a comm module (T2, spec 10-10 §8). An id that names no board slot (nothing at all, or
 * housing, which takes no board) is null, which the agent tools read as an unknown board, as in milestone 1.
 */
function agentBoard(s: Session, id: string): BoardState | null {
  const facility = findFacility(s.world, id);
  if (!facility || facility.boardSpec === null) return null;
  const board = findBoard(s.world, id);
  if (!board?.comm) {
    throw new ToolError(`${id} has no comm module: the player installs one from the board's panel`, { code: 'noComm', board: id });
  }
  return board;
}

/** Where a deploy goes: the player's needs a board, the agent's a comm module as well. */
function deployTarget(s: Session, id: string, by: DeployedBy): BoardState {
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
 * A command that changed the world tells the main thread how it stands before it answers: snapshots otherwise come with a batch of
 * steps, and a game that stands still would show none of it. A refused command changed nothing.
 */
function changed(s: Session, result: CommandResult): CommandResult {
  if (result.ok) send({ type: 'snapshot', snapshot: snapshot(s.ctx) });
  return result;
}

async function handle(message: WorkerRequest): Promise<void> {
  if (message.type === 'start') {
    const scenario = parseScenario(message.scenario);
    const holder: { s: Session | null } = { s: null };
    const host = new TrackingHost(await WasmoonHost.create(), (boardId) => {
      const board = holder.s?.world.boards.find((b) => b.id === boardId);
      return [board?.index ?? -1, (board?.pending ?? board?.firmware)?.version ?? 0];
    });
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

port.on('message', (message: WorkerRequest) => {
  handle(message).catch((error: unknown) => send({ type: 'fatal', message: error instanceof Error ? error.message : String(error) }));
});
