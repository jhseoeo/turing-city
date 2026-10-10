import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { AGENT_INSTRUCTIONS, type AgentStatus, type GameApi } from '@turing-city/core';
import { afterEach, describe, expect, it } from 'vitest';
import { createMcpEndpoint, type DevTools } from '../src/mcp.ts';

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
  /** The dev tools the endpoint was given when started with dev = true; a test may change their methods. */
  dev: DevTools;
  close: () => Promise<void>;
}

let rig: Rig | null = null;

async function start(dev = false, token: () => string = () => TOKEN): Promise<Rig & { drop: () => Promise<void> }> {
  const api = fakeApi();
  const devTools: DevTools = {
    play: () => {},
    pause: () => {},
    setSpeed: () => {},
    runUntil: async () => {},
    newSeason: async () => {},
    rebuild: async () => ({ ok: true }),
  };
  const agent: AgentStatus[] = [];
  const endpoint = createMcpEndpoint({
    api,
    token,
    onAgent: (s) => agent.push(s),
    pingEveryMs: 100,
    pingTimeoutMs: 100,
    graceMs: 200,
    ...(dev ? { dev: devTools } : {}),
  });
  const server: Server = createServer((req, res) => void endpoint.handle(req, res));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const started = {
    url: new URL(`http://127.0.0.1:${port}/mcp`),
    agent,
    api,
    dev: devTools,
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

/** What a tool result says: the text of its first content block. */
function textOf(result: unknown): string {
  return (result as { content: Array<{ text: string }> }).content[0]?.text ?? '';
}

describe('tool input', () => {
  // core's tools trust their arguments (AgentTool.run casts them): the limits live in each tool's input schema, and the
  // server must check them before any tool runs.
  it('refuses firmware with a NUL byte, over 64 KB, or of the wrong shape, before the game sees it', async () => {
    const r = await start();
    const { client } = await connect(r.url);
    // what to send, and the word the agent's error must carry so it can tell what to fix
    const refused: Array<[string, Record<string, unknown>, string]> = [
      ['a NUL byte', { board: 'DA', code: 'function tick() end\u0000os.exit()' }, 'NUL byte'],
      ['one character over 64 KB', { board: 'DA', code: 'x'.repeat(65_537) }, '65536'],
      ['no code', { board: 'DA' }, 'code'],
      ['code that is not text', { board: 'DA', code: 42 }, 'code'],
      ['no board', { code: 'function tick() end' }, 'board'],
    ];
    const answers: Record<string, { isError: unknown; mentions: boolean }> = {};
    for (const [why, args, mention] of refused) {
      const result = await client.callTool({ name: 'deploy_firmware', arguments: args });
      answers[why] = { isError: result.isError, mentions: textOf(result).includes(mention) };
    }
    expect(answers).toEqual(Object.fromEntries(refused.map(([why]) => [why, { isError: true, mentions: true }])));
    expect(r.api.deployed).toEqual([]);
    await client.close();
  });

  it('lets through firmware of exactly 64 KB', async () => {
    const r = await start();
    const { client } = await connect(r.url);
    const result = await client.callTool({ name: 'deploy_firmware', arguments: { board: 'DA', code: 'x'.repeat(65_536) } });
    expect(result.isError).toBeFalsy();
    expect(r.api.deployed.map(([board, code]) => [board, code.length])).toEqual([['DA', 65_536]]);
    await client.close();
  });
});

describe('a failure inside the game', () => {
  // The controller rejects with a plain Error, not a ToolError, when a request is cut short (a season restarts or the
  // simulator fails) and when it refuses a run. The agent must read the message as a tool error, not meet a protocol failure.
  it('reaches the agent as a tool error, for every tool', async () => {
    const r = await start(true);
    const message = 'the simulator failed: boom';
    const rejects = async (): Promise<never> => {
      throw new Error(message);
    };
    const throws = (): never => {
      throw new Error(message);
    };
    Object.assign(r.api, {
      listBoards: rejects,
      datasheet: rejects,
      firmware: rejects,
      deploy: rejects,
      logs: rejects,
      map: rejects,
      status: rejects,
      alerts: rejects,
    });
    Object.assign(r.dev, { play: throws, pause: throws, setSpeed: throws, runUntil: rejects, newSeason: rejects, rebuild: rejects });
    const { client } = await connect(r.url);
    // valid arguments for every tool, so that nothing but the failure can make a call fail
    const calls: Record<string, Record<string, unknown>> = {
      list_boards: {},
      get_datasheet: { board: 'DA' },
      get_firmware: { board: 'DA' },
      deploy_firmware: { board: 'DA', code: 'function tick() end' },
      read_logs: { board: 'DA' },
      get_map: {},
      get_status: {},
      get_alerts: {},
      dev_play: {},
      dev_pause: {},
      dev_set_speed: { speed: 2 },
      dev_run_until: { seconds: 5 },
      dev_new_season: { seed: 1 },
      dev_rebuild: { board: 'DA' },
    };
    expect(Object.keys(calls).sort()).toEqual((await client.listTools()).tools.map((t) => t.name).sort());
    const answers: Record<string, { isError: unknown; text: string }> = {};
    for (const [name, args] of Object.entries(calls)) {
      const result = await client.callTool({ name, arguments: args }); // a protocol failure would reject here
      answers[name] = { isError: result.isError, text: textOf(result) };
    }
    expect(answers).toEqual(Object.fromEntries(Object.keys(calls).map((name) => [name, { isError: true, text: message }])));
    await client.close();
  });
});

describe('what the agent is given beyond the eight tools', () => {
  it("gives the agent the game's instructions", async () => {
    const r = await start();
    const { client } = await connect(r.url);
    expect(client.getInstructions()).toBe(AGENT_INSTRUCTIONS);
    await client.close();
  });

  it('hands each dev tool its arguments, and returns what the game answers', async () => {
    const r = await start(true);
    const calls: unknown[][] = [];
    Object.assign(r.dev, {
      play: () => void calls.push(['play']),
      pause: () => void calls.push(['pause']),
      setSpeed: (speed: number) => void calls.push(['setSpeed', speed]),
      runUntil: async (goal: unknown) => void calls.push(['runUntil', goal]),
      newSeason: async (seed: number) => void calls.push(['newSeason', seed]),
      rebuild: async (board: string) => {
        calls.push(['rebuild', board]);
        return { ok: false, reason: 'DB is not destroyed' };
      },
    });
    const { client } = await connect(r.url);
    const answer = async (name: string, args: Record<string, unknown>): Promise<unknown> =>
      JSON.parse(textOf(await client.callTool({ name, arguments: args })));
    const done = { ok: true };
    expect(await answer('dev_play', {})).toEqual(done);
    expect(await answer('dev_pause', {})).toEqual(done);
    expect(await answer('dev_set_speed', { speed: 3 })).toEqual(done);
    expect(await answer('dev_run_until', { seconds: 5, alertKinds: ['raid'] })).toEqual(done);
    expect(await answer('dev_run_until', { alertKinds: ['fire'] })).toEqual(done);
    expect(await answer('dev_run_until', {})).toEqual(done);
    expect(await answer('dev_new_season', { seed: 7 })).toEqual(done);
    expect(await answer('dev_rebuild', { board: 'DB' })).toEqual({ ok: false, reason: 'DB is not destroyed' });
    expect(calls).toStrictEqual([
      ['play'],
      ['pause'],
      ['setSpeed', 3],
      ['runUntil', { seconds: 5, alertKinds: ['raid'] }],
      ['runUntil', { alertKinds: ['fire'] }], // what the agent left out stays out
      ['runUntil', {}],
      ['newSeason', 7],
      ['rebuild', 'DB'],
    ]);
    await client.close();
  });

  it('refuses dev arguments that fit no speed, no time, and no seed, before the game sees them', async () => {
    const r = await start(true);
    const calls: unknown[] = [];
    Object.assign(r.dev, {
      setSpeed: (speed: number) => calls.push(speed),
      runUntil: async (goal: unknown) => calls.push(goal),
      newSeason: async (seed: number) => calls.push(seed),
    });
    const { client } = await connect(r.url);
    const refused: Array<[string, Record<string, unknown>]> = [
      ['dev_set_speed', { speed: 4 }],
      ['dev_set_speed', { speed: '2' }],
      ['dev_run_until', { seconds: 0 }],
      ['dev_run_until', { seconds: -3 }],
      ['dev_run_until', { alertKinds: 'raid' }],
      // A kind that does not exist would never be raised, and the run would go on to the end of the season.
      ['dev_run_until', { alertKinds: ['raidd'] }],
      ['dev_run_until', { alertKinds: ['raid', 'nope'] }],
      ['dev_run_until', { seconds: 5, alertKinds: [''] }],
      ['dev_new_season', { seed: 1.5 }],
      ['dev_new_season', {}],
    ];
    const answers: unknown[] = [];
    for (const [name, args] of refused) answers.push((await client.callTool({ name, arguments: args })).isError);
    expect(answers).toEqual(refused.map(() => true));
    expect(calls).toEqual([]);
    await client.close();
  });
});
