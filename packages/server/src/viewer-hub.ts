import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import type { ControllerEvent, ServerToViewer, ViewerToServer } from '@turing-city/core';
import { type WebSocket, WebSocketServer } from 'ws';
import type { GameController } from './game-controller.ts';

export interface ViewerHubOptions {
  readonly controller: GameController;
  readonly hello: () => ServerToViewer;
  readonly reissueToken: () => void;
  /**
   * Origins allowed to open the viewer socket. A handshake with no Origin is refused too: a browser always sends one, so
   * it comes from some other program, and the hello message carries the token that config.json keeps owner-only.
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

export function createViewerHub(options: ViewerHubOptions): {
  upgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void;
  close(): void;
} {
  const { controller } = options;
  const wss = new WebSocketServer({ noServer: true });
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
        if (!result.ok) send(ws, { type: 'error', message: result.reason });
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
      let message: ViewerToServer;
      try {
        message = JSON.parse(String(data)) as ViewerToServer;
      } catch {
        return;
      }
      handle(ws, message).catch((error: unknown) =>
        send(ws, { type: 'error', message: error instanceof Error ? error.message : String(error) }),
      );
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
