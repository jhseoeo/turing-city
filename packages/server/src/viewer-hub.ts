import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import {
  ALERT_KINDS,
  type CommandResult,
  type ControllerEvent,
  FACILITY_ACTION,
  FIRMWARE_SOURCE,
  INSTALL_PART,
  type ServerToViewer,
  ToolError,
  type ViewerToServer,
} from '@turing-city/core';
import { type WebSocket, WebSocketServer } from 'ws';
import { z } from 'zod';
import type { GameController } from './game-controller.ts';

export interface ViewerHubOptions {
  readonly controller: GameController;
  readonly hello: () => ServerToViewer;
  readonly reissueToken: () => void;
  /**
   * Origins allowed to open the viewer socket. A handshake with no Origin is refused too, because a browser always sends
   * one. That keeps out web pages and clients that don't set the header. It does not keep out a process that sets the header
   * itself: any process that can reach 127.0.0.1 gets the token from hello and the player's controls, even one that cannot
   * read config.json. The prototype accepts that; a viewer secret passed out of band would close it (spec section 7.1).
   */
  readonly allowedOrigins: readonly string[];
}

function toMessage(event: ControllerEvent): ServerToViewer {
  switch (event.kind) {
    case 'status':
      return { type: 'status', status: event.status };
    case 'snapshot':
      return { type: 'snapshot', snapshot: event.snapshot };
    case 'alerts':
      return { type: 'alerts', alerts: event.alerts };
    case 'deploy':
      return { type: 'deploy', board: event.board, version: event.version, time: event.time, by: event.by };
  }
}

/**
 * The most a viewer's message may weigh. A command is a few dozen bytes, but the editor's deploy carries a firmware source of up to
 * 65,536 characters, which JSON can spend 6 bytes on each (a control character's \u escape): 384 KiB. A bigger message closes its
 * connection.
 */
const MAX_MESSAGE_BYTES = 512 * 1024;

const boardId = z.string().min(1).max(32);

/** What a viewer may send: the commands of ViewerToServer, exactly. Nothing else reaches the controller. */
const viewerCommand: z.ZodType<ViewerToServer> = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('startSeason') }),
  z.strictObject({ type: z.literal('play') }),
  z.strictObject({ type: z.literal('pause') }),
  z.strictObject({ type: z.literal('speed'), speed: z.literal([1, 2, 3]) }),
  z.strictObject({ type: z.literal('deploy'), board: boardId, code: FIRMWARE_SOURCE }),
  z.strictObject({ type: z.literal('hand'), facility: boardId, action: FACILITY_ACTION }),
  z.strictObject({ type: z.literal('install'), facility: boardId, part: INSTALL_PART }),
  z.strictObject({ type: z.literal('repair'), facility: boardId }),
  z.strictObject({ type: z.literal('rebuild'), board: boardId }),
  z.strictObject({ type: z.literal('autoPause'), kinds: z.array(z.enum(ALERT_KINDS)).max(ALERT_KINDS.length) }),
  z.strictObject({ type: z.literal('reissueToken') }),
  z.strictObject({ type: z.literal('inspect'), board: boardId }),
]);

const BAD_COMMAND = 'bad command: ';

/** A viewer's message as a command, or why it is none (short, because it goes back to the viewer). */
function parseCommand(text: string): { ok: true; command: ViewerToServer } | { ok: false; reason: string } {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, reason: `${BAD_COMMAND}not JSON` };
  }
  const parsed = viewerCommand.safeParse(json);
  if (parsed.success) return { ok: true, command: parsed.data };
  const issues = parsed.error.issues.map((i) => (i.path.length > 0 ? `${i.path.map(String).join('.')}: ${i.message}` : i.message));
  return { ok: false, reason: `${BAD_COMMAND}${issues.join('; ')}`.slice(0, 200) };
}

/** What the viewer is told when a command fails: the English message, and the code of the refusal when it is one the viewer knows. */
function refused(error: unknown): ServerToViewer {
  const message = error instanceof Error ? error.message : String(error);
  return error instanceof ToolError && error.refusal ? { type: 'error', message, refusal: error.refusal } : { type: 'error', message };
}

export function createViewerHub(options: ViewerHubOptions): {
  upgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void;
  close(): void;
} {
  const { controller } = options;
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });
  const clients = new Set<WebSocket>();
  /**
   * Never throws. It runs inside the controller's events, which come from timers and from the agent's connection, where a
   * throw would end the process; a viewer that can't be written to is dropped instead.
   */
  const send = (ws: WebSocket, message: ServerToViewer): void => {
    if (ws.readyState !== ws.OPEN) return;
    try {
      ws.send(JSON.stringify(message));
    } catch {
      ws.terminate(); // its close listener takes it out of the set
    }
  };
  const broadcast = (message: ServerToViewer): void => {
    for (const ws of clients) send(ws, message);
  };
  /** A command the game refused is told to the viewer that sent it, with its code; a done one says nothing (the snapshot shows it). */
  const tell = (ws: WebSocket, result: CommandResult): void => {
    if (!result.ok) send(ws, { type: 'error', message: result.reason, refusal: result.refusal });
  };
  const unsubscribe = controller.onEvent((event) => broadcast(toMessage(event)));

  async function handle(ws: WebSocket, message: ViewerToServer): Promise<void> {
    switch (message.type) {
      case 'startSeason':
        await controller.startSeason();
        return;
      case 'play':
        controller.play();
        return;
      case 'pause':
        controller.pause();
        return;
      case 'speed':
        controller.setSpeed(message.speed);
        return;
      case 'deploy': {
        // The editor's deploy is always the player's: `by` is never read from the message. Its answer, a syntax error included, goes
        // to the viewer that sent it; a refusal (a facility with no board, no season) is told by the catch around handle().
        const outcome = await controller.deploy(message.board, message.code, 'player');
        send(ws, { type: 'deployResult', board: message.board, outcome });
        return;
      }
      case 'hand':
        tell(ws, await controller.hand(message.facility, message.action));
        return;
      case 'install':
        tell(ws, await controller.install(message.facility, message.part));
        return;
      case 'repair':
        tell(ws, await controller.repair(message.facility));
        return;
      case 'rebuild':
        tell(ws, await controller.rebuild(message.board));
        return;
      case 'autoPause':
        controller.setAutoPause(message.kinds);
        return;
      case 'reissueToken':
        options.reissueToken();
        broadcast(options.hello());
        return;
      case 'inspect': {
        // The panel asks twice a second while a board is selected. With no season to read (before the first, after a crash,
        // or one replaced while the question was out, which the controller fails with a plain Error) it gets an empty
        // inspection: a refusal would sit in the screen's notice, over the overlay. A failure of the season's own is still told.
        const inspection = await controller.inspect(message.board).catch((error: unknown) => {
          const code = error instanceof ToolError ? error.refusal?.code : undefined;
          if (!(error instanceof ToolError) || code === 'noSeason' || code === 'crashed') return null;
          throw error;
        });
        send(ws, { type: 'inspection', board: message.board, inspection });
        return;
      }
    }
  }

  wss.on('connection', (ws: WebSocket) => {
    clients.add(ws);
    send(ws, options.hello());
    send(ws, { type: 'status', status: controller.status() });
    const snap = controller.latestSnapshot();
    if (snap) send(ws, { type: 'snapshot', snapshot: snap });
    ws.on('message', (data) => {
      const parsed = parseCommand(String(data));
      if (!parsed.ok) {
        send(ws, {
          type: 'error',
          message: parsed.reason,
          refusal: { code: 'badCommand', detail: parsed.reason.slice(BAD_COMMAND.length) },
        });
        return;
      }
      handle(ws, parsed.command).catch((error: unknown) => send(ws, refused(error)));
    });
    ws.on('close', () => clients.delete(ws));
    // After a protocol error, ws closes the connection itself; without a listener the error would crash the server.
    ws.on('error', () => clients.delete(ws));
  });

  return {
    upgrade(req, socket, head) {
      const origin = req.headers.origin;
      if (origin === undefined || !options.allowedOrigins.includes(origin)) {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
    },
    close() {
      unsubscribe();
      for (const ws of clients) ws.terminate();
      wss.close();
    },
  };
}
