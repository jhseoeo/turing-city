import { mkdtempSync, writeFileSync } from 'node:fs';
import { connect, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { ServerToViewer, ViewerToServer } from '@turing-city/core';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { loadConfig } from '../src/config.ts';
import { startGameServer } from '../src/game-server.ts';

let stop: (() => Promise<void>) | null = null;
afterEach(async () => {
  await stop?.();
  stop = null;
});

/**
 * A viewer connection that records every message. A browser always sends an Origin on a WebSocket handshake, so by default
 * this one sends the game page's; null sends none, the way a program other than a browser may.
 */
async function viewer(
  port: number,
  origin: string | null = `http://127.0.0.1:${port}`,
): Promise<{ ws: WebSocket; seen: ServerToViewer[]; send: (m: ViewerToServer) => void }> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, origin === null ? {} : { origin });
  const seen: ServerToViewer[] = [];
  ws.on('message', (data) => seen.push(JSON.parse(String(data)) as ServerToViewer));
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });
  return { ws, seen, send: (m) => ws.send(JSON.stringify(m)) };
}

const until = async (cond: () => boolean, ms = 5000): Promise<void> => {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 20));
  }
};

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
    // A browser always sends an Origin. A handshake without one comes from some other program on this machine,
    // and the hello message it would get carries the token that config.json keeps owner-only.
    await expect(viewer(server.port, null)).rejects.toThrow('403');
    const handshake = `GET /ws HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n`;
    expect(await raw(server.port, handshake)).toBe('HTTP/1.1 403 Forbidden');
  });
});
