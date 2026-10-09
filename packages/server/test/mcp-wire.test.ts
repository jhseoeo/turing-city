import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { GameApi } from '@turing-city/core';
import { afterEach, describe, expect, it } from 'vitest';
import { createMcpEndpoint, type McpOptions } from '../src/mcp.ts';

// The MCP endpoint spoken to by hand: the requests the SDK's client never sends, and an agent that decides which of the
// server's pings it answers and when its stream closes (the SDK's client answers every ping).

const TOKEN = 'test-token';

interface Rig {
  url: URL;
  /** The agent's `connected` flag, once for every time the endpoint reported a change. */
  history: boolean[];
  drop: () => Promise<void>;
  close: () => Promise<void>;
}

let rig: Rig | null = null;

async function start(options: Partial<McpOptions> = {}): Promise<Rig> {
  const history: boolean[] = [];
  const endpoint = createMcpEndpoint({
    api: {} as GameApi, // no tool is called here
    token: () => TOKEN,
    onAgent: (status) => history.push(status.connected),
    pingEveryMs: 100,
    pingTimeoutMs: 300,
    graceMs: 600,
    ...options,
  });
  const server: Server = createServer((req, res) => void endpoint.handle(req, res));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const started: Rig = {
    url: new URL(`http://127.0.0.1:${port}/mcp`),
    history,
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

afterEach(async () => {
  await rig?.close();
  rig = null;
});

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const until = async (cond: () => boolean, ms = 5000): Promise<void> => {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('timed out waiting');
    await sleep(10);
  }
};

const JSON_HEADERS = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
const initialize = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'wire-agent', version: '0.0.1' } },
};
const listTools = { jsonrpc: '2.0', id: 2, method: 'tools/list' };

/** The status of an answer, with its body let go (an event stream would never end). */
async function statusOf(url: URL, init: RequestInit): Promise<number> {
  const response = await fetch(url, init);
  await response.body?.cancel();
  return response.status;
}

describe('MCP endpoint by hand: who is let in', () => {
  it('refuses a token that is longer, shorter, or without its scheme, and asks for a bearer token', async () => {
    const r = await start();
    const wrong = [`Bearer ${TOKEN}x`, `Bearer ${TOKEN.slice(0, -1)}`, TOKEN, `Basic ${TOKEN}`, `bearer ${TOKEN}`];
    const answers: Array<[number, string | null]> = [];
    for (const authorization of wrong) {
      const response = await fetch(r.url, {
        method: 'POST',
        headers: { ...JSON_HEADERS, authorization },
        body: JSON.stringify(initialize),
      });
      await response.body?.cancel();
      answers.push([response.status, response.headers.get('www-authenticate')]);
    }
    expect(answers).toEqual(wrong.map(() => [401, 'Bearer']));
    const right = { method: 'POST', headers: { ...JSON_HEADERS, authorization: `Bearer ${TOKEN}` }, body: JSON.stringify(initialize) };
    expect(await statusOf(r.url, right)).toBe(200);
  });

  it('answers 500, and goes on serving, when something inside it fails', async () => {
    const r = await start({
      token: () => {
        throw new Error('the token could not be read');
      },
    });
    const ask = () =>
      statusOf(r.url, {
        method: 'POST',
        headers: { ...JSON_HEADERS, authorization: `Bearer ${TOKEN}` },
        body: JSON.stringify(initialize),
        signal: AbortSignal.timeout(2000),
      });
    expect([await ask(), await ask()]).toEqual([500, 500]);
  });

  it('refuses every request that carries an Origin header, whatever it says and whatever the method', async () => {
    const r = await start();
    const headers = { ...JSON_HEADERS, authorization: `Bearer ${TOKEN}` };
    const answers: number[] = [];
    for (const origin of ['http://evil.example', 'null', '', `http://127.0.0.1:${r.url.port}`]) {
      answers.push(await statusOf(r.url, { method: 'POST', headers: { ...headers, origin }, body: JSON.stringify(initialize) }));
    }
    for (const method of ['GET', 'DELETE', 'OPTIONS']) {
      answers.push(await statusOf(r.url, { method, headers: { ...headers, origin: 'http://evil.example' } }));
    }
    expect(answers).toEqual([403, 403, 403, 403, 403, 403, 403]);
  });

  it('answers a session it does not know with 404, so that a client starts a new one', async () => {
    const r = await start();
    const headers = { ...JSON_HEADERS, authorization: `Bearer ${TOKEN}`, 'mcp-session-id': 'no-such-session' };
    const answers = [
      await statusOf(r.url, { method: 'POST', headers, body: JSON.stringify(listTools) }),
      await statusOf(r.url, { method: 'GET', headers: { ...headers, accept: 'text/event-stream' } }),
      await statusOf(r.url, { method: 'DELETE', headers }),
    ];
    expect(answers).toEqual([404, 404, 404]);
  });
});

/** A bare MCP agent: it speaks HTTP by hand, so a test decides which pings it answers and when its stream closes. */
async function agent(url: URL, answers: (ping: number) => boolean = () => true) {
  const headers = { ...JSON_HEADERS, authorization: `Bearer ${TOKEN}` };
  const opened = await fetch(url, { method: 'POST', headers, body: JSON.stringify(initialize) });
  await opened.text();
  const session = { 'mcp-session-id': opened.headers.get('mcp-session-id') ?? '', 'mcp-protocol-version': '2025-06-18' };
  const post = (body: unknown) => fetch(url, { method: 'POST', headers: { ...headers, ...session }, body: JSON.stringify(body) });
  await post({ jsonrpc: '2.0', method: 'notifications/initialized' });
  const self = {
    /** The pings it has received, on every stream it opened. */
    pings: 0,
    /** Whether to answer the n-th ping (the first is 1). A test may change it. */
    answers,
    post,
    /** A stream request that asks for an event stream, answered or not. */
    stream() {
      const control = new AbortController();
      const response = fetch(url, { headers: { ...headers, ...session, accept: 'text/event-stream' }, signal: control.signal });
      const ended = response.then(read).catch(() => undefined);
      return { response, close: () => control.abort(), ended };
    },
    /** Any other request to the stream's address. */
    get: (accept: string) => fetch(url, { headers: { ...headers, ...session, accept } }),
  };
  async function read(res: Response): Promise<void> {
    const reader = res.body?.getReader();
    if (!reader) return;
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
      for (let end = buffer.indexOf('\n\n'); end >= 0; end = buffer.indexOf('\n\n')) {
        const block = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const data = block.split('\n').find((line) => line.startsWith('data: '));
        const message = (data ? JSON.parse(data.slice(6)) : {}) as { id?: number; method?: string };
        if (message.method !== 'ping') continue;
        self.pings += 1;
        if (self.answers(self.pings)) void post({ jsonrpc: '2.0', id: message.id, result: {} }).catch(() => undefined);
      }
    }
  }
  return self;
}

describe('MCP endpoint by hand: the connection rule', () => {
  it('does not disconnect an agent that misses a ping now and then', async () => {
    const r = await start();
    const a = await agent(r.url, (n) => n % 2 === 0); // misses every other ping, never two in a row
    a.stream();
    await until(() => a.pings >= 7);
    expect(r.history).toEqual([true]);
  });

  it('disconnects an agent that leaves two pings in a row unanswered, and connects it again when it answers', async () => {
    const r = await start();
    const a = await agent(r.url, (n) => n > 2); // misses the first two pings, then answers them all
    a.stream();
    await until(() => r.history.length >= 3);
    expect(r.history).toEqual([true, false, true]);
  });

  it('counts the missed pings afresh when the stream reopens', async () => {
    const r = await start();
    const a = await agent(r.url, () => false); // answers no ping at all
    const first = a.stream();
    await until(() => r.history.length >= 2); // two missed pings end the connection
    first.close();
    await sleep(50);
    a.stream(); // within the grace: the reopened stream starts with a clean count
    await until(() => r.history.length >= 3);
    expect(r.history.slice(0, 3)).toEqual([true, false, true]);
  });

  it('ends the connection when the stream closes, and keeps the session if the stream reopens in time', async () => {
    const r = await start({ graceMs: 500 });
    const a = await agent(r.url);
    const first = a.stream();
    await until(() => r.history.length >= 1);
    first.close();
    await until(() => r.history.length >= 2); // at once: the game does not wait for the grace
    a.stream();
    await until(() => r.history.length >= 3);
    await sleep(800); // longer than the grace: the session was not closed behind the agent
    expect(r.history).toEqual([true, false, true]);
    expect((await a.post(listTools)).status).toBe(200);
  });

  it('ends the session of an agent whose stream stays closed past the grace', async () => {
    const r = await start({ graceMs: 300 });
    const a = await agent(r.url);
    const stream = a.stream();
    await until(() => r.history.length >= 1);
    stream.close();
    await until(() => r.history.length >= 2);
    await sleep(600);
    expect((await a.post(listTools)).status).toBe(404); // the agent has to start a new session
    expect(r.history).toEqual([true, false]);
  });

  it('does not take a refused stream request for an open stream', async () => {
    const r = await start();
    const a = await agent(r.url);
    const refused = await a.get('application/json');
    expect(refused.status).toBe(406);
    await refused.body?.cancel();
    await sleep(300);
    expect(r.history).toEqual([]);
  });

  it('stays connected while any agent is, whatever happens to another one', async () => {
    const r = await start();
    const live = await agent(r.url);
    const leaving = await agent(r.url);
    const streams = [live.stream(), leaving.stream()];
    await Promise.all(streams.map((s) => s.response)); // both streams are open
    expect(r.history).toEqual([true]);
    streams[1]?.close(); // its session lives on within the grace, but its stream is gone
    await sleep(300);
    expect(r.history).toEqual([true]);
  });

  it('closes the agents streams and forgets their sessions when it drops them', async () => {
    const r = await start();
    const a = await agent(r.url);
    const stream = a.stream();
    let ended = false;
    void stream.ended.then(() => {
      ended = true;
    });
    await until(() => r.history.length >= 1);
    await r.drop();
    await until(() => ended); // the server hung up on the agent's stream
    expect(r.history).toEqual([true, false]);
    expect((await a.post(listTools)).status).toBe(404); // and no longer knows the session
  });
});
