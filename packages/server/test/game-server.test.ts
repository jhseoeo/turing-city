import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { connect, type Socket } from 'node:net';
import { networkInterfaces, tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { ServerToViewer, ViewerToServer } from '@turing-city/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import { loadConfig } from '../src/config.ts';
import { startGameServer } from '../src/game-server.ts';

let stop: (() => Promise<void>) | null = null;
/** What a test opened, undone last in, first out: viewers go before the server they are connected to. */
const closers: Array<() => unknown> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of closers.splice(0).reverse()) {
    try {
      await close();
    } catch {
      // already gone
    }
  }
  await stop?.();
  stop = null;
});

type GameServer = Awaited<ReturnType<typeof startGameServer>>;

/** A game server on a free port with a config directory of its own, closed when the test ends. */
async function start(options: { dev?: boolean; viewerDist?: string | null } = {}): Promise<{ server: GameServer; configDir: string }> {
  const configDir = mkdtempSync(join(tmpdir(), 'tc-server-'));
  const server = await startGameServer({ port: 0, configDir, viewerDist: null, ...options });
  closers.push(() => server.close());
  return { server, configDir };
}

/**
 * A viewer connection that records every message. A browser always sends an Origin on a WebSocket handshake, so by default
 * this one sends the game page's; null sends none, the way a program other than a browser may.
 */
async function viewer(
  port: number,
  origin: string | null = `http://127.0.0.1:${port}`,
): Promise<{ ws: WebSocket; seen: ServerToViewer[]; send: (m: ViewerToServer) => void }> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, origin === null ? {} : { origin });
  closers.push(() => ws.terminate());
  const seen: ServerToViewer[] = [];
  ws.on('message', (data) => seen.push(JSON.parse(String(data)) as ServerToViewer));
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });
  return { ws, seen, send: (m) => ws.send(JSON.stringify(m)) };
}

/** An agent connected over MCP with the token in configDir, the way Claude Code connects. */
async function connectAgent(server: GameServer, configDir: string): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(new URL(`${server.url}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${loadConfig(configDir).token}` } },
  });
  const agent = new Client({ name: 'test-agent', version: '0.0.1' });
  await agent.connect(transport as Transport);
  closers.push(() => agent.close());
  return agent;
}

const until = async (cond: () => boolean, ms = 5000): Promise<void> => {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 20));
  }
};

/** As until(), for a condition that has to be asked of the game. */
const eventually = async (cond: () => Promise<boolean>, ms = 5000): Promise<void> => {
  const t0 = Date.now();
  while (!(await cond())) {
    if (Date.now() - t0 > ms) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 20));
  }
};

/** Whether a TCP connection to this address opens. */
function canConnect(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ port, host, timeout: 2000 }, () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('error', () => resolve(false));
    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });
  });
}

/** The status the MCP endpoint answers an initialize request that carries this token. */
async function initializeStatus(server: GameServer, token: string): Promise<number> {
  const res = await fetch(`${server.url}/mcp`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'probe', version: '1' } },
    }),
  });
  await res.body?.cancel();
  return res.status;
}

const textOf = (result: unknown): string => (result as { content: Array<{ text: string }> }).content[0]?.text ?? '';

/** Sends raw bytes and gives the reply's first line ('' when the server just hangs up). */
function raw(port: number, text: string): Promise<string> {
  return new Promise((resolve) => {
    let reply = '';
    const socket = connect(port, '127.0.0.1', () => socket.write(text));
    socket.on('data', (data) => {
      reply += String(data);
    });
    socket.on('close', () => resolve(reply.split('\r\n')[0] ?? ''));
    socket.on('error', () => resolve(''));
  });
}

/** For each origin, whether the viewer socket lets a handshake from it in. */
async function accepted(port: number, origins: readonly string[]): Promise<Record<string, boolean>> {
  const result: Record<string, boolean> = {};
  for (const origin of origins) {
    result[origin] = await viewer(port, origin).then(
      (v) => {
        v.ws.close();
        return true;
      },
      () => false,
    );
  }
  return result;
}

function last<T extends ServerToViewer['type']>(seen: ServerToViewer[], type: T): Extract<ServerToViewer, { type: T }> | undefined {
  return seen.filter((m): m is Extract<ServerToViewer, { type: T }> => m.type === type).at(-1);
}

describe('game server', () => {
  it('runs a season end to end: viewer, agent, deploy, and the connection rule', async () => {
    const configDir = mkdtempSync(join(tmpdir(), 'tc-server-'));
    const server = await startGameServer({ port: 0, configDir, dev: true, viewerDist: null });
    stop = server.close;
    const v = await viewer(server.port);
    await until(() => last(v.seen, 'hello') !== undefined && last(v.seen, 'status') !== undefined);
    expect(last(v.seen, 'hello')!.connect).toContain(loadConfig(configDir).token);
    expect(last(v.seen, 'status')!.status).toMatchObject({ state: 'idle', agent: { connected: false } });

    v.send({ type: 'startSeason' });
    await until(() => last(v.seen, 'error') !== undefined);
    expect(last(v.seen, 'error')!.message).toContain('connect an agent first');

    const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${server.port}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${loadConfig(configDir).token}` } },
    });
    const agent = new Client({ name: 'e2e-agent', version: '0.0.1' });
    await agent.connect(transport as Transport);
    await until(() => last(v.seen, 'status')?.status.agent.connected === true);

    v.send({ type: 'startSeason' });
    await until(() => last(v.seen, 'status')?.status.state === 'paused');
    const deployed = await agent.callTool({
      name: 'deploy_firmware',
      arguments: { board: 'DA', code: 'function tick(io) io.log("on") end' },
    });
    expect(deployed.isError).toBeFalsy();
    await until(() => last(v.seen, 'deploy') !== undefined);
    await agent.callTool({ name: 'dev_run_until', arguments: { seconds: 1 } });
    await until(() => last(v.seen, 'snapshot')!.snapshot.boards[1]!.hasFirmware);

    v.send({ type: 'inspect', board: 'DA' });
    await until(() => last(v.seen, 'inspection') !== undefined);
    expect(last(v.seen, 'inspection')!.inspection!.logs.some((l) => l.text === 'on')).toBe(true);

    v.send({ type: 'play' });
    await until(() => last(v.seen, 'status')?.status.state === 'running');
    await transport.terminateSession();
    await agent.close();
    await until(() => last(v.seen, 'status')?.status.state === 'paused');
    expect(last(v.seen, 'status')!.status.blockedByAgent).toBe(true);
    v.ws.close();
  }, 30_000);

  it('keeps serving after requests that would crash a careless server', async () => {
    const dist = mkdtempSync(join(tmpdir(), 'tc-viewer-'));
    writeFileSync(join(dist, 'index.html'), '<!doctype html>');
    const server = await startGameServer({ port: 0, configDir: mkdtempSync(join(tmpdir(), 'tc-server-')), viewerDist: dist });
    stop = server.close;
    // Any web page can make the browser request a malformed escape.
    expect((await fetch(`${server.url}/%`)).status).toBe(400);
    // A raw client can send a request target, or an upgrade, that isn't a URL at all.
    expect(await raw(server.port, 'GET http://[ HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n')).toBe('HTTP/1.1 400 Bad Request');
    const upgrade = 'Connection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==';
    expect(await raw(server.port, `GET http://[ HTTP/1.1\r\nHost: x\r\n${upgrade}\r\n\r\n`)).toBe('');
    // A WebSocket client that breaks the protocol (an unmasked frame) loses only its own connection.
    const v = await viewer(server.port);
    const closed = new Promise<number>((resolve) => v.ws.once('close', resolve));
    (v.ws as unknown as { _socket: Socket })._socket.write(Buffer.from([0x81, 0x02, 0x68, 0x69]));
    expect(await closed).toBe(1002);
    expect((await fetch(`${server.url}/`)).status).toBe(200);
  });

  it('refuses a WebSocket from another website', async () => {
    const server = await startGameServer({ port: 0, configDir: mkdtempSync(join(tmpdir(), 'tc-server-')), viewerDist: null });
    stop = server.close;
    await expect(viewer(server.port, 'http://evil.example')).rejects.toThrow();
  });

  it('refuses a WebSocket handshake that sends no Origin', async () => {
    const server = await startGameServer({ port: 0, configDir: mkdtempSync(join(tmpdir(), 'tc-server-')), viewerDist: null });
    stop = server.close;
    // A browser always sends an Origin, so a handshake without one is no web page: a client that does not set the header.
    // (A program that sets it itself gets in; it runs as the player and could read the token file anyway, spec section 7.1.)
    await expect(viewer(server.port, null)).rejects.toThrow('403');
    const handshake = `GET /ws HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n`;
    expect(await raw(server.port, handshake)).toBe('HTTP/1.1 403 Forbidden');
  });

  // 5173 is Vite's default port, shared by every Vite project on the machine, and the hello message a page gets carries the
  // token. Only a server started with the dev flag (`pnpm start:dev`, which is what runs next to `pnpm viewer`) lets that page in.
  it.each([
    { mode: 'a plain server', dev: false },
    { mode: 'a dev-mode server', dev: true },
  ])('lets $mode accept the pages it serves, and the Vite dev server only in dev mode', async ({ dev }) => {
    const server = await startGameServer({ port: 0, configDir: mkdtempSync(join(tmpdir(), 'tc-server-')), dev, viewerDist: null });
    stop = server.close;
    const own = [`http://127.0.0.1:${server.port}`, `http://localhost:${server.port}`];
    const lookalike = `${own[1]}.evil.example`;
    expect(
      await accepted(server.port, [...own, 'http://127.0.0.1:5173', 'http://localhost:5173', 'http://127.0.0.1:5174', lookalike]),
    ).toEqual({
      [own[0]!]: true,
      [own[1]!]: true,
      'http://127.0.0.1:5173': dev,
      'http://localhost:5173': dev,
      'http://127.0.0.1:5174': false,
      [lookalike]: false,
    });
  });

  // The controller announces its events from timers and from the agent's connection, where a throw would end the process.
  it('survives a viewer it cannot write to, and drops it', async () => {
    const { server } = await start();
    const a = await viewer(server.port);
    const b = await viewer(server.port);
    await until(() => last(a.seen, 'status') !== undefined && last(b.seen, 'status') !== undefined);
    const dropped = [a, b].map((v) => new Promise<number>((resolve) => v.ws.once('close', resolve)));
    // From here on every write throws, except the ones this test makes itself on the viewer's side.
    const write = WebSocket.prototype.send;
    let mine = false;
    vi.spyOn(WebSocket.prototype, 'send').mockImplementation(function (this: WebSocket, ...args: unknown[]) {
      if (!mine) throw new Error('write failed');
      (write as (...a: unknown[]) => void).apply(this, args);
    });
    mine = true;
    a.send({ type: 'speed', speed: 2 });
    mine = false;
    // The new speed makes the controller announce its status to both viewers. Neither write works, so both are dropped.
    await Promise.all(dropped);
    vi.restoreAllMocks();
    // The server is still there, and the command was carried out.
    const c = await viewer(server.port);
    await until(() => last(c.seen, 'status') !== undefined);
    expect(last(c.seen, 'status')!.status.speed).toBe(2);
  });

  it('closes the viewers and frees the port when the server closes', async () => {
    const { server } = await start();
    const v = await viewer(server.port);
    const closed = new Promise<number>((resolve) => v.ws.once('close', resolve));
    await server.close();
    await closed;
    expect(await canConnect(server.port, '127.0.0.1')).toBe(false);
  });

  it('listens on the loopback address only', async () => {
    const { server } = await start();
    // A server bound to every IPv4 interface answers on this machine's own network addresses, and one bound to the default
    // host (every interface, IPv6 included) answers on ::1 as well.
    const network = Object.values(networkInterfaces()).flatMap((list) =>
      (list ?? []).filter((i) => i.family === 'IPv4' && !i.internal).map((i) => i.address),
    );
    expect(await canConnect(server.port, '127.0.0.1')).toBe(true);
    for (const host of ['::1', ...network]) expect(await canConnect(server.port, host), host).toBe(false);
  });

  it('lets only the /mcp path reach the MCP endpoint', async () => {
    const dist = mkdtempSync(join(tmpdir(), 'tc-viewer-'));
    writeFileSync(join(dist, 'index.html'), '<!doctype html>');
    const { server } = await start({ viewerDist: dist });
    const status = async (path: string): Promise<number> => (await fetch(`${server.url}${path}`)).status;
    // The endpoint turns away a request with no token, which tells it from the viewer.
    expect(await status('/mcp')).toBe(401);
    expect(await status('/mcp?next=1')).toBe(401);
    for (const path of ['/', '/ws', '/mcp/', '/mcp/x', '/mcpx', '/MCP', '/x/mcp', '/%6dcp']) expect(await status(path), path).toBe(200);
  });

  it('upgrades only /ws to a WebSocket', async () => {
    const { server } = await start();
    const upgrade = (path: string): string =>
      `GET ${path} HTTP/1.1\r\nHost: 127.0.0.1\r\nOrigin: http://127.0.0.1:${server.port}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n`;
    for (const path of ['/', '/wss', '/ws/', '/mcp']) expect(await raw(server.port, upgrade(path)), path).toBe('');
    await viewer(server.port); // /ws itself opens
  });

  it('serves the built viewer: each file by its type, index.html for any other path, and nothing from outside the directory', async () => {
    const base = mkdtempSync(join(tmpdir(), 'tc-viewer-'));
    const dist = join(base, 'dist');
    mkdirSync(join(dist, 'assets'), { recursive: true });
    const page = '<!doctype html><title>viewer</title>';
    writeFileSync(join(dist, 'index.html'), page);
    writeFileSync(join(dist, 'assets', 'app.js'), 'export {};');
    writeFileSync(join(dist, 'assets', 'app.css'), 'body {}');
    writeFileSync(join(base, 'secret.txt'), 'outside the build directory');
    mkdirSync(join(base, 'dist-old'));
    writeFileSync(join(base, 'dist-old', 'key.txt'), 'in a directory whose name starts like the build directory');
    const { server } = await start({ viewerDist: dist });
    const get = async (path: string): Promise<{ status: number; type: string | null; body: string }> => {
      const res = await fetch(`${server.url}${path}`);
      return { status: res.status, type: res.headers.get('content-type'), body: await res.text() };
    };
    const html = { status: 200, type: 'text/html; charset=utf-8', body: page };
    expect(await get('/')).toEqual(html);
    expect(await get('/assets/app.js')).toEqual({ status: 200, type: 'text/javascript; charset=utf-8', body: 'export {};' });
    expect((await get('/assets/app.css')).type).toBe('text/css; charset=utf-8');
    // A path that names no file, or a directory, is the page: the viewer routes by itself.
    for (const path of ['/nope', '/assets/missing.js', '/assets/', '/assets']) expect(await get(path), path).toEqual(html);
    // An escaped slash is a slash once decoded, and would climb out of the directory, into a sibling whose name starts like it too.
    for (const path of ['/..%2fsecret.txt', '/assets/..%2f..%2fsecret.txt', '/..%2fdist-old%2fkey.txt'])
      expect(await get(path), path).toEqual({ status: 403, type: null, body: '' });
  });

  it('says what to do when the viewer has not been built, and has nothing at / when it is told to serve none', async () => {
    const { server } = await start({ viewerDist: mkdtempSync(join(tmpdir(), 'tc-viewer-')) });
    const res = await fetch(`${server.url}/`);
    expect(res.status).toBe(404);
    expect(await res.text()).toContain('run pnpm start');
    const { server: bare } = await start();
    expect((await fetch(`${bare.url}/`)).status).toBe(404);
  });

  it('offers the dev tools only to a server started with the dev flag', async () => {
    const toolNames = async (dev: boolean): Promise<string[]> => {
      const { server, configDir } = await start({ dev });
      return (await (await connectAgent(server, configDir)).listTools()).tools.map((tool) => tool.name);
    };
    const plain = await toolNames(false);
    expect(plain).toContain('deploy_firmware');
    expect(plain.filter((name) => name.startsWith('dev_'))).toEqual([]);
    expect((await toolNames(true)).filter((name) => name.startsWith('dev_')).sort()).toEqual([
      'dev_new_season',
      'dev_pause',
      'dev_play',
      'dev_rebuild',
      'dev_run_until',
      'dev_set_speed',
    ]);
  });

  it('reissues the token: the old one stops working, the agent is cut off, and every viewer gets the new connect command', async () => {
    const { server, configDir } = await start();
    const v = await viewer(server.port);
    const w = await viewer(server.port);
    await connectAgent(server, configDir);
    await until(() => last(v.seen, 'status')?.status.agent.connected === true);
    const oldToken = loadConfig(configDir).token;
    expect(last(v.seen, 'hello')).toMatchObject({ port: server.port });
    expect(last(v.seen, 'hello')!.connect).toContain(`:${server.port}/mcp`);
    // Whenever a viewer is told the agent is gone, the old token has to be dead already: the token switches before the sessions drop.
    const tokenWhenTold: string[] = [];
    const write = WebSocket.prototype.send;
    vi.spyOn(WebSocket.prototype, 'send').mockImplementation(function (this: WebSocket, ...args: unknown[]) {
      if (typeof args[0] === 'string' && args[0].includes('"connected":false')) tokenWhenTold.push(loadConfig(configDir).token);
      (write as (...a: unknown[]) => void).apply(this, args);
    });
    v.send({ type: 'reissueToken' });
    const hellos = (x: typeof v): number => x.seen.filter((m) => m.type === 'hello').length;
    await until(() => hellos(v) === 2 && hellos(w) === 2 && last(v.seen, 'status')?.status.agent.connected === false);
    vi.restoreAllMocks();
    const newToken = loadConfig(configDir).token;
    expect(newToken).not.toBe(oldToken);
    for (const x of [v, w]) {
      expect(last(x.seen, 'hello')!.connect).toContain(newToken);
      expect(last(x.seen, 'hello')!.connect).not.toContain(oldToken);
    }
    expect([...new Set(tokenWhenTold)]).toEqual([newToken]); // told at least once, and always with the new token in place
    // The old token is refused from now on, and the new one lets an agent in again.
    expect(await initializeStatus(server, oldToken)).toBe(401);
    await connectAgent(server, configDir);
    await until(() => last(v.seen, 'status')?.status.agent.connected === true);
  });

  it('ignores what a viewer sends that is not a command, and keeps serving', async () => {
    const { server } = await start();
    const v = await viewer(server.port);
    await until(() => last(v.seen, 'status') !== undefined);
    // Text that is not JSON, JSON that is not an object, objects that name no command, and bytes.
    for (const text of ['', 'not json', '{"type":', 'null', '[]', '"play"', '7', '{}', '{"type":"nope"}', '{"__proto__":{"type":"play"}}'])
      v.ws.send(text);
    v.ws.send(Buffer.from([0xff, 0x00, 0x01]));
    // The same connection still gets its commands answered.
    v.send({ type: 'inspect', board: 'DA' });
    await until(() => v.seen.some((m) => m.type === 'error' && m.message.includes("hasn't started")));
  });

  it("streams the season to every viewer and carries the player's commands", async () => {
    const { server, configDir } = await start({ dev: true });
    const v = await viewer(server.port);
    const agent = await connectAgent(server, configDir);
    await until(() => last(v.seen, 'status')?.status.agent.connected === true);
    const call = async (name: string, args: Record<string, unknown>): Promise<unknown> => {
      const result = await agent.callTool({ name, arguments: args });
      expect((result as { isError?: boolean }).isError).toBeFalsy();
      return result;
    };
    await call('dev_new_season', { seed: 1 }); // the same season every run
    await until(() => last(v.seen, 'status')?.status.state === 'paused');

    // A viewer that opens the page later is given the season as it stands, at once.
    const late = await viewer(server.port);
    await until(() => last(late.seen, 'snapshot') !== undefined);
    expect(last(late.seen, 'status')!.status.state).toBe('paused');
    expect(last(late.seen, 'snapshot')).toEqual(last(v.seen, 'snapshot'));

    // The clock's commands reach the controller, and what it announces reaches every viewer.
    const heard = (): ReturnType<typeof last<'status'>> => last(late.seen, 'status');
    v.send({ type: 'speed', speed: 3 });
    await until(() => heard()?.status.speed === 3);
    v.send({ type: 'autoPause', kinds: ['fire'] });
    await until(() => heard()?.status.autoPause.join() === 'fire');
    v.send({ type: 'play' });
    await until(() => heard()?.status.state === 'running');
    v.send({ type: 'pause' });
    await until(() => heard()?.status.state === 'paused');

    // A rebuild the game refuses is told to the viewer that asked and to nobody else. Messages to a viewer arrive in order, so
    // an answer to the other viewer's own question shows that nothing was sent to it before.
    v.send({ type: 'rebuild', board: 'DA' });
    await until(() => last(v.seen, 'error')?.message === 'DA is not destroyed');
    late.send({ type: 'inspect', board: 'DA' });
    await until(() => last(late.seen, 'inspection') !== undefined);
    expect(last(late.seen, 'error')).toBeUndefined();
    // An inspection answers the viewer that asked and no other. The other viewer's came first, so it would sit before this
    // one's own answer on this connection if it had been sent here.
    v.send({ type: 'inspect', board: 'DB' });
    await until(() => v.seen.some((m) => m.type === 'inspection' && m.board === 'DB'));
    expect(v.seen.some((m) => m.type === 'inspection' && m.board === 'DA')).toBe(false);

    // Alerts go to everyone. With no firmware the Luddites smash a board in the fifth game day.
    await call('dev_run_until', { alertKinds: ['boardDestroyed'] });
    const destroyed = (x: typeof v) =>
      x.seen.flatMap((m) => (m.type === 'alerts' ? m.alerts : [])).find((a) => a.kind === 'boardDestroyed');
    await until(() => destroyed(v) !== undefined && destroyed(late) !== undefined);
    const lost = destroyed(v)!.facility!;

    // Rebuilding the lost board from the viewer is accepted: the game says nothing and the board is being rebuilt.
    v.send({ type: 'rebuild', board: lost });
    await eventually(async () => {
      const boards = JSON.parse(textOf(await call('list_boards', {}))) as Array<{ id: string; status: string }>;
      return boards.find((b) => b.id === lost)?.status === 'rebuilding';
    });
    expect(v.seen.filter((m) => m.type === 'error')).toHaveLength(1);
  });
});
