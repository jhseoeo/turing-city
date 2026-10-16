import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import type { ServerToViewer } from '@turing-city/core';
import { type WebSocket, WebSocketServer } from 'ws';
import type { GameController } from './game-controller.ts';
import { createViewerPeer, MAX_MESSAGE_BYTES, toMessage } from './viewer-peer.ts';

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

  wss.on('connection', (ws: WebSocket) => {
    clients.add(ws);
    const peer = createViewerPeer({
      controller,
      send: (message) => send(ws, message),
      hello: options.hello,
      reissueToken: () => {
        options.reissueToken();
        broadcast(options.hello());
      },
    });
    peer.greet();
    ws.on('message', (data) => peer.receive(String(data)));
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
