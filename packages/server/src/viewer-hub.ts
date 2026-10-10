import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { ALERT_KINDS, type ControllerEvent, type ServerToViewer, ToolError, type ViewerToServer } from '@turing-city/core';
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
      return { type: 'deploy', board: event.board, version: event.version, time: event.time };
  }
}

/** The most a viewer's message may weigh. A command is a few dozen bytes; a bigger message closes its connection. */
const MAX_MESSAGE_BYTES = 64 * 1024;

const boardId = z.string().min(1).max(32);

/** What a viewer may send: the commands of ViewerToServer, exactly. Nothing else reaches the controller. */
const viewerCommand: z.ZodType<ViewerToServer> = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('startSeason') }),
  z.strictObject({ type: z.literal('play') }),
  z.strictObject({ type: z.literal('pause') }),
  z.strictObject({ type: z.literal('speed'), speed: z.literal([1, 2, 3]) }),
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
      case 'rebuild': {
        const result = await controller.rebuild(message.board);
        if (!result.ok) send(ws, { type: 'error', message: result.reason, refusal: result.refusal });
        return;
      }
      case 'autoPause':
        controller.setAutoPause(message.kinds);
        return;
      case 'reissueToken':
        options.reissueToken();
        broadcast(options.hello());
        return;
      case 'inspect':
        send(ws, { type: 'inspection', board: message.board, inspection: await controller.inspect(message.board) });
        return;
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
