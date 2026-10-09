import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Transferable, Worker } from 'node:worker_threads';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { parseScenario } from '@turing-city/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GameController, gameApi } from '../src/game-controller.ts';
import { createMcpEndpoint } from '../src/mcp.ts';

// The MCP endpoint over the real GameController: what an agent reads when the controller refuses or gives up on a request.

const TOKEN = 'test-token';
const scenario = parseScenario(JSON.parse(readFileSync('scenarios/m1-power.json', 'utf8')));

interface Rig {
  controller: GameController;
  client: Client;
  close: () => Promise<void>;
}

let rig: Rig | null = null;

/** An agent connected to a server whose game is a real controller, with the connection rule and the dev tools wired to it. */
async function start(withSeason = true): Promise<Rig> {
  const controller = new GameController({ scenario });
  const endpoint = createMcpEndpoint({
    api: gameApi(controller),
    token: () => TOKEN,
    onAgent: (status) => controller.setAgent(status),
    dev: {
      play: () => controller.play(),
      pause: () => controller.pause(),
      setSpeed: (speed) => controller.setSpeed(speed),
      runUntil: (goal) => controller.runUntil(goal),
      newSeason: (seed) => controller.startSeason(seed),
      rebuild: (board) => controller.rebuild(board),
    },
  });
  const server: Server = createServer((req, res) => void endpoint.handle(req, res));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } },
  });
  const client = new Client({ name: 'test-client', version: '0.0.1' });
  await client.connect(transport as Transport);
  await until(() => controller.status().agent.connected); // a season starts only for a connected agent
  if (withSeason) await controller.startSeason(1);
  const started: Rig = {
    controller,
    client,
    close: async () => {
      await client.close().catch(() => undefined);
      await endpoint.close();
      controller.close();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
  rig = started;
  return started;
}

const until = async (cond: () => boolean, ms = 3000): Promise<void> => {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 10));
  }
};

const textOf = (result: unknown): string => (result as { content: Array<{ text: string }> }).content[0]?.text ?? '';

/** The controller's worker thread: the one place a test can hold an answer back or make the thread fail. */
const workerOf = (c: GameController): Worker => (c as unknown as { worker: Worker }).worker;

/** Keeps the worker from ever receiving messages of one type, so the request that sent one stays out. Counts them. */
function holdBack(c: GameController, type: string): { count: number } {
  const worker = workerOf(c);
  const send = worker.postMessage.bind(worker);
  const held = { count: 0 };
  vi.spyOn(worker, 'postMessage').mockImplementation((message: { type: string }, transfer?: readonly Transferable[]) => {
    if (message.type === type) held.count += 1;
    else send(message, transfer);
  });
  return held;
}

afterEach(async () => {
  vi.restoreAllMocks();
  await rig?.close();
  rig = null;
});

describe('MCP endpoint over the real controller', () => {
  // terminate() rejects what was waiting on the worker with a plain Error; the agent has to read it as a tool error.
  it.each([
    { how: 'a new season starts', message: 'a new season started', cut: (c: GameController) => c.startSeason(2) },
    {
      how: 'the simulator fails',
      message: 'the simulator failed: boom',
      cut: async (c: GameController) => void workerOf(c).emit('error', new Error('boom')),
    },
  ])('tells the agent a read was cut short when $how', async ({ message, cut }) => {
    const r = await start();
    const held = holdBack(r.controller, 'query'); // the read goes out and does not come back
    const call = r.client.callTool({ name: 'list_boards', arguments: {} });
    await until(() => held.count === 1);
    await cut(r.controller);
    const result = await call;
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(message);
  });

  it('tells the agent to try again when a batch of steps is already running', async () => {
    const r = await start();
    const held = holdBack(r.controller, 'advance'); // a batch goes out and does not come back
    const running = r.controller.runUntil({ seconds: 600 });
    running.catch(() => undefined); // closing the controller at the end of the test cuts the run short
    await until(() => held.count === 1);
    const result = await r.client.callTool({ name: 'dev_run_until', arguments: { seconds: 1 } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/already running.*try again/);
  });

  it('tells the agent what a call needs when there is no season to play', async () => {
    const r = await start(false);
    const status = await r.client.callTool({ name: 'get_status', arguments: {} });
    expect(status.isError).toBe(true);
    expect(textOf(status)).toContain("hasn't started");
    const run = await r.client.callTool({ name: 'dev_run_until', arguments: { seconds: 1 } });
    expect(run.isError).toBe(true);
    expect(textOf(run)).toContain('needs a paused season');
  });
});
