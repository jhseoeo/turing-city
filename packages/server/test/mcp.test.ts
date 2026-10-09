import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { AgentStatus, GameApi } from '@turing-city/core';
import { afterEach, describe, expect, it } from 'vitest';
import { createMcpEndpoint } from '../src/mcp.ts';

const TOKEN = 'test-token';

function fakeApi(): GameApi & { deployed: Array<[string, string]> } {
  const deployed: Array<[string, string]> = [];
  return {
    deployed,
    listBoards: async () => [],
    datasheet: async () => null,
    firmware: async () => null,
    deploy: async (board, code) => {
      deployed.push([board, code]);
      return { ok: true, version: 1, installsAt: "the board's next tick" };
    },
    logs: async () => [],
    map: async () => ({ width: 20, height: 12, facilities: [] }),
    status: async () => ({
      time: { day: 1, clock: '00:00', seconds: 0 },
      seasonDays: 30,
      money: 5000,
      power: { generation: 0, demand: 0, shed: [] },
      ended: null,
      run: { paused: true, speed: 1 },
    }),
    alerts: async () => [],
  };
}

interface Rig {
  url: URL;
  agent: AgentStatus[];
  api: ReturnType<typeof fakeApi>;
  close: () => Promise<void>;
}

let rig: Rig | null = null;

async function start(dev = false, token: () => string = () => TOKEN): Promise<Rig & { drop: () => Promise<void> }> {
  const api = fakeApi();
  const agent: AgentStatus[] = [];
  const endpoint = createMcpEndpoint({
    api,
    token,
    onAgent: (s) => agent.push(s),
    pingEveryMs: 100,
    pingTimeoutMs: 100,
    graceMs: 200,
    ...(dev
      ? {
          dev: {
            play: () => {},
            pause: () => {},
            setSpeed: () => {},
            runUntil: async () => {},
            newSeason: async () => {},
            rebuild: async () => ({ ok: true }),
          },
        }
      : {}),
  });
  const server: Server = createServer((req, res) => void endpoint.handle(req, res));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const started = {
    url: new URL(`http://127.0.0.1:${port}/mcp`),
    agent,
    api,
    drop: () => endpoint.dropSessions(),
    close: async () => {
      await endpoint.close();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
  rig = started;
  return started;
}

async function connect(url: URL, token = TOKEN): Promise<{ client: Client; transport: StreamableHTTPClientTransport }> {
  const transport = new StreamableHTTPClientTransport(url, { requestInit: { headers: { Authorization: `Bearer ${token}` } } });
  const client = new Client({ name: 'test-client', version: '0.0.1' });
  await client.connect(transport as Transport);
  return { client, transport };
}

const until = async (cond: () => boolean, ms = 3000): Promise<void> => {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 20));
  }
};

afterEach(async () => {
  await rig?.close();
  rig = null;
});

describe('MCP endpoint', () => {
  it('refuses a missing or wrong token, and any browser origin', async () => {
    const { url } = await start();
    const init = {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: '{}',
    };
    expect((await fetch(url, init)).status).toBe(401);
    expect((await fetch(url, { ...init, headers: { ...init.headers, authorization: 'Bearer nope' } })).status).toBe(401);
    expect(
      (await fetch(url, { ...init, headers: { ...init.headers, authorization: `Bearer ${TOKEN}`, origin: 'http://evil.example' } })).status,
    ).toBe(403);
  });

  it('lists the eight agent tools, and the dev tools only in dev mode', async () => {
    const plain = await start();
    const { client } = await connect(plain.url);
    expect((await client.listTools()).tools.map((t) => t.name)).toEqual([
      'list_boards',
      'get_datasheet',
      'get_firmware',
      'deploy_firmware',
      'read_logs',
      'get_map',
      'get_status',
      'get_alerts',
    ]);
    await client.close();
    await plain.close();
    rig = null;
    const dev = await start(true);
    const second = await connect(dev.url);
    const names = (await second.client.listTools()).tools.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining(['dev_play', 'dev_pause', 'dev_set_speed', 'dev_run_until', 'dev_new_season', 'dev_rebuild']),
    );
    await second.client.close();
  });

  it('calls a tool and returns JSON text', async () => {
    const r = await start();
    const { client } = await connect(r.url);
    const result = await client.callTool({ name: 'deploy_firmware', arguments: { board: 'DA', code: 'function tick() end' } });
    expect(JSON.parse((result.content as Array<{ text: string }>)[0]!.text)).toMatchObject({ ok: true, version: 1 });
    expect(r.api.deployed).toEqual([['DA', 'function tick() end']]);
    const status = await client.callTool({ name: 'get_status', arguments: {} });
    expect(JSON.parse((status.content as Array<{ text: string }>)[0]!.text).money).toBe(5000);
    await client.close();
  });

  it('reports a ToolError as a tool error', async () => {
    const r = await start();
    const { client } = await connect(r.url);
    const result = await client.callTool({ name: 'get_datasheet', arguments: { board: 'ZZ' } });
    expect(result.isError).toBe(true);
    expect((result.content as Array<{ text: string }>)[0]!.text).toContain('unknown board ZZ');
    await client.close();
  });

  it('reports the agent connected while its stream is open, and gone when it closes', async () => {
    const r = await start();
    const { client, transport } = await connect(r.url);
    await until(() => r.agent.at(-1)?.connected === true);
    expect(r.agent.at(-1)).toEqual({ connected: true, clientName: 'test-client' });
    await new Promise((resolve) => setTimeout(resolve, 400)); // several pings, all answered
    expect(r.agent.at(-1)?.connected).toBe(true);
    await transport.terminateSession();
    await client.close();
    await until(() => r.agent.at(-1)?.connected === false);
  });

  it('stays connected until the last of two agents leaves', async () => {
    const r = await start();
    const a = await connect(r.url);
    const b = await connect(r.url);
    await until(() => r.agent.at(-1)?.connected === true);
    await a.transport.terminateSession();
    await a.client.close();
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(r.agent.at(-1)?.connected).toBe(true);
    await b.transport.terminateSession();
    await b.client.close();
    await until(() => r.agent.at(-1)?.connected === false);
  });

  it('cuts off agents holding a reissued token', async () => {
    let token = TOKEN;
    const r = await start(false, () => token);
    const { client } = await connect(r.url);
    await until(() => r.agent.at(-1)?.connected === true);
    token = 'new-token';
    await r.drop();
    await until(() => r.agent.at(-1)?.connected === false);
    await expect(connect(r.url, TOKEN)).rejects.toThrow();
    const again = await connect(r.url, 'new-token');
    await until(() => r.agent.at(-1)?.connected === true);
    await again.client.close();
    await client.close().catch(() => undefined);
  });
});
