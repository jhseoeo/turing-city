import { parentPort, workerData } from 'node:worker_threads';
import {
  alertsView,
  alertView,
  type BootInfo,
  datasheet,
  type FirmwareHost,
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
  type WorkerRequest,
  type WorkerResponse,
} from '@turing-city/core';
import { WasmoonHost } from '@turing-city/firmware';

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
 * Answers a request that carries an id. A handler that throws fails that one request and leaves the season running:
 * Session.deploy throws for an unknown board before it changes anything, and a plain Error that escaped to `handle`
 * would stop the whole season as 'fatal'.
 */
function reply(id: number, compute: () => unknown): void {
  try {
    send({ type: 'reply', id, value: compute() });
  } catch (error) {
    send({ type: 'refused', id, message: error instanceof Error ? error.message : String(error) });
  }
}

function answer(s: Session, query: Query): unknown {
  const ctx = s.ctx;
  switch (query.kind) {
    case 'listBoards':
      return listBoards(s.world);
    case 'datasheet':
      return datasheet(ctx, query.board);
    case 'firmware':
      return firmwareView(s.world, query.board);
    case 'logs':
      return logsView(ctx, query.board, query.since ?? undefined);
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
    // A request that changes the world tells the main thread how it stands before it answers: snapshots otherwise come with
    // a batch of steps, and a game that stands still would show neither the deploy nor the rebuild.
    case 'deploy':
      reply(message.id, () => {
        const result = s.deploy(message.board, message.code);
        send({ type: 'snapshot', snapshot: snapshot(s.ctx) });
        return result;
      });
      return;
    case 'rebuild':
      reply(message.id, () => {
        const result = s.rebuild(message.board);
        if (result.ok) send({ type: 'snapshot', snapshot: snapshot(s.ctx) });
        return result;
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
