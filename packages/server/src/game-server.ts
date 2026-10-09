import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { parseScenario, type ServerToViewer } from '@turing-city/core';
import { configDir, connectCommand, loadConfig, reissueToken } from './config.ts';
import { GameController, gameApi } from './game-controller.ts';
import { createMcpEndpoint, type DevTools } from './mcp.ts';
import { serveStatic } from './static-files.ts';
import { createViewerHub } from './viewer-hub.ts';

export interface GameServerOptions {
  readonly port?: number;
  readonly configDir?: string;
  readonly dev?: boolean;
  readonly scenarioPath?: string;
  /** The built viewer to serve at /; null serves none (tests). */
  readonly viewerDist?: string | null;
}

/** The request's path, or null when its target isn't a URL at all (a raw client can send anything). */
function pathOf(req: IncomingMessage): string | null {
  try {
    return new URL(req.url ?? '/', 'http://x').pathname;
  } catch {
    return null;
  }
}

/**
 * The Vite dev server's pages (`pnpm viewer`). 5173 is Vite's default port, shared by every Vite project on the machine, and the
 * hello message a page gets carries the token, so only a server started with the dev flag lets these origins in.
 */
const VITE_ORIGINS = ['http://127.0.0.1:5173', 'http://localhost:5173'];

const DEFAULT_SCENARIO = fileURLToPath(new URL('../../../scenarios/m1-power.json', import.meta.url));
const DEFAULT_VIEWER = fileURLToPath(new URL('../../viewer/dist', import.meta.url));

export async function startGameServer(
  options: GameServerOptions = {},
): Promise<{ port: number; url: string; connect: string; close(): Promise<void> }> {
  const dir = options.configDir ?? configDir();
  let config = loadConfig(dir);
  const scenario = parseScenario(JSON.parse(readFileSync(options.scenarioPath ?? DEFAULT_SCENARIO, 'utf8')));
  const controller = new GameController({ scenario });
  const dev: DevTools | undefined = options.dev
    ? {
        play: () => controller.play(),
        pause: () => controller.pause(),
        setSpeed: (s) => controller.setSpeed(s),
        runUntil: (goal) => controller.runUntil(goal),
        newSeason: (seed) => controller.startSeason(seed),
        rebuild: (board) => controller.rebuild(board),
      }
    : undefined;
  const mcp = createMcpEndpoint({
    api: gameApi(controller),
    token: () => config.token,
    onAgent: (status) => controller.setAgent(status),
    ...(dev ? { dev } : {}),
  });
  const viewerDist = options.viewerDist === undefined ? DEFAULT_VIEWER : options.viewerDist;

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const path = pathOf(req);
    if (path === null) res.writeHead(400).end();
    else if (path === '/mcp') await mcp.handle(req, res);
    else if (viewerDist !== null) await serveStatic(viewerDist, req, res);
    else res.writeHead(404).end();
  }
  const http = createServer((req, res) => {
    route(req, res).catch(() => {
      // No request may stop the game: whatever a handler throws becomes an error response.
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
  await new Promise<void>((resolve) => http.listen(options.port ?? config.port, '127.0.0.1', resolve));
  const port = (http.address() as AddressInfo).port;
  const portConfig = () => ({ ...config, port });
  const hello = (): ServerToViewer => ({ type: 'hello', connect: connectCommand(portConfig()), port });
  const hub = createViewerHub({
    controller,
    hello,
    reissueToken: () => {
      config = reissueToken(dir);
      void mcp.dropSessions(); // agents holding the old token are cut off; their reconnection gets 401
    },
    allowedOrigins: [`http://127.0.0.1:${port}`, `http://localhost:${port}`, ...(options.dev ? VITE_ORIGINS : [])],
  });
  http.on('upgrade', (req, socket, head) => {
    if (pathOf(req) === '/ws') hub.upgrade(req, socket, head);
    else socket.destroy();
  });

  return {
    port,
    url: `http://127.0.0.1:${port}`,
    connect: connectCommand(portConfig()),
    async close() {
      hub.close();
      await mcp.close();
      controller.close();
      http.closeAllConnections();
      await new Promise((resolve) => http.close(resolve));
    },
  };
}
