import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { chromium } from 'playwright-core';
import { loadConfig } from '../src/config.ts';
import { startGameServer } from '../src/game-server.ts';

/**
 * pnpm shots: the real viewer in headless Chrome, against a real server and a scripted agent. It writes screenshots to
 * scratch/shots, to be looked at, and runs the checks that need a browser. A failed check ends the run with exit code 1.
 */
const out = 'scratch/shots';
/** The seasons the script starts itself, so that its numbers repeat from run to run. */
const SEED = 3;
mkdirSync(out, { recursive: true });
const configDir = mkdtempSync(join(tmpdir(), 'tc-shots-'));
const server = await startGameServer({ port: 0, configDir, dev: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1320, height: 860 } });

const failures: string[] = [];
function check(name: string, ok: boolean, detail = ''): void {
  process.stdout.write(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail === '' ? '' : ` (${detail})`}\n`);
  if (!ok) failures.push(name);
}

const shot = async (name: string): Promise<void> => {
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(out, `${name}.png`) });
  process.stdout.write(`${out}/${name}.png\n`);
};

/** Polls until the condition holds or the time is up. */
async function waitUntil(condition: () => Promise<boolean>, timeoutMs = 3000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > deadline) return false;
    await page.waitForTimeout(40);
  }
  return true;
}

/** How many snapshots the page's socket has received: proof that the page was being re-rendered during a press. */
let snapshotFrames = 0;
page.on('websocket', (ws) => {
  ws.on('framereceived', (frame) => {
    if (typeof frame.payload === 'string' && frame.payload.startsWith('{"type":"snapshot"')) snapshotFrames += 1;
  });
});

interface Agent {
  /** A tool's result, parsed (every tool answers JSON text); a tool error throws. */
  call(tool: string, args?: Record<string, unknown>): Promise<unknown>;
  disconnect(): Promise<void>;
}
const agents: Agent[] = [];

/** An MCP client the way a player's agent connects: the token from the server's config, over HTTP. */
async function connectAgent(name: string): Promise<Agent> {
  const transport = new StreamableHTTPClientTransport(new URL(`${server.url}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${loadConfig(configDir).token}` } },
  });
  const client = new Client({ name, version: '0.0.1' });
  await client.connect(transport as Transport);
  let connected = true;
  const agent: Agent = {
    async call(tool, args = {}) {
      const result = (await client.callTool({ name: tool, arguments: args })) as { content: Array<{ text: string }>; isError?: boolean };
      const text = result.content[0]?.text ?? '';
      if (result.isError) throw new Error(`${tool}: ${text}`);
      return JSON.parse(text);
    },
    async disconnect() {
      if (!connected) return;
      connected = false;
      await transport.terminateSession();
      await client.close();
    },
  };
  agents.push(agent);
  return agent;
}

interface Status {
  readonly money: number;
  readonly power: { readonly generation: number; readonly demand: number };
  readonly ended: { readonly kind: string } | null;
  readonly run: { readonly paused: boolean; readonly speed: number };
}

try {
  await page.goto(server.url);
  await shot('1-start-waiting');

  let agent: Agent = await connectAgent('shots');
  await shot('2-start-connected');

  await page.getByText('시즌 시작').click();
  await page.waitForTimeout(500);
  await agent.call('dev_new_season', { seed: SEED }); // the button's own season has a random seed
  const careful =
    'function tick(io, mem) if io.temp > 70 then io.cool(3) end if io.temp < 82 then io.process() end io.log("t", io.temp) end';
  const deployHealthy = async (): Promise<void> => {
    await agent.call('deploy_firmware', { board: 'P', code: 'function tick(io) io.set_thermal(250) end' });
    await agent.call('deploy_firmware', { board: 'DA', code: careful });
  };
  await deployHealthy();
  await agent.call('dev_run_until', { seconds: 30 });
  await shot('3-running');

  const map = await page.locator('#map canvas').boundingBox();
  if (!map) throw new Error('the map canvas is missing');
  const clickCell = (x: number, y: number) => page.mouse.click(map.x + x * 34 + 17, map.y + y * 34 + 17);
  await clickCell(5, 4); // DA
  await shot('4-datacenter-selected');
  await clickCell(4, 4); // the plant
  await shot('5-plant-selected');
  await page.keyboard.press('h');
  await shot('6-heatmap');

  await agent.disconnect();
  await shot('7-agent-lost');

  // ---- A second agent, and the clock running: what the page's controls do while it redraws 19 times a second ----
  await page.keyboard.press('h'); // the heatmap off again
  agent = await connectAgent('shots-2');
  check('the lost-agent overlay goes away when an agent reconnects', await waitUntil(() => page.locator('#overlay').isHidden()));
  const status = async (): Promise<Status> => (await agent.call('get_status')) as Status;
  const clockLabel = (): Promise<string> => page.evaluate(() => document.querySelector('#topbar b')?.textContent ?? '');

  await agent.call('dev_new_season', { seed: SEED });
  await deployHealthy();
  await agent.call('dev_run_until', { seconds: 20 });
  await clickCell(5, 4); // DA: its log is long enough to scroll
  await agent.call('dev_play');
  await page.waitForFunction(() => document.querySelector('#topbar .speed button')?.textContent === '⏸');

  // A click is a press and a release on the same button; the page used to replace the button between the two.
  const pauseButton = await page.evaluate(() => {
    const r = document.querySelector('#topbar .speed button')?.getBoundingClientRect();
    return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
  });
  if (!pauseButton) throw new Error('the pause button is missing');
  await page.mouse.move(pauseButton.x, pauseButton.y);
  const before = snapshotFrames;
  await page.mouse.down();
  await page.waitForTimeout(300);
  const during = snapshotFrames - before;
  await page.mouse.up();
  const paused = await waitUntil(async () => (await status()).run.paused, 1500);
  check(
    'a press held across several snapshots still clicks the pause button',
    during >= 3 && paused,
    `${during} snapshots arrived during the press, paused: ${paused}`,
  );
  check(
    'the screen shows the pause once the pointer is up',
    await waitUntil(async () => (await page.locator('#topbar .speed button').first().textContent()) === '▶', 1500),
  );
  await agent.call('dev_play');

  // A press whose release is lost must not freeze the screen: the page draws again at once.
  for (const lost of ['pointercancel', 'blur', 'contextmenu']) {
    await page.mouse.move(700, 800);
    await page.mouse.down();
    await page.evaluate((type) => window.dispatchEvent(new Event(type)), lost);
    const was = await clockLabel();
    check(
      `the screen draws again after ${lost}, though the release never came`,
      await waitUntil(async () => (await clockLabel()) !== was, 600),
    );
    await page.mouse.up();
  }

  // The panel is rebuilt with every snapshot: a block the player scrolled stays where it was.
  const scrollable = await page.evaluate(() => {
    const pre = document.querySelector<HTMLElement>('#panel pre');
    return pre ? pre.scrollHeight - pre.clientHeight : -1;
  });
  check('the panel log is long enough to scroll', scrollable > 150, `${scrollable} px to scroll`);
  await page.evaluate(() => {
    const pre = document.querySelector<HTMLElement>('#panel pre');
    if (pre) pre.scrollTop = 120;
  });
  const renders = snapshotFrames;
  await page.waitForTimeout(1200);
  const scrolledTo = await page.evaluate(() => document.querySelector<HTMLElement>('#panel pre')?.scrollTop ?? -1);
  check(
    'the panel log keeps its scroll position across re-renders',
    Math.abs(scrolledTo - 120) <= 1,
    `scrollTop ${scrolledTo} after ${snapshotFrames - renders} snapshots`,
  );
} finally {
  for (const agent of agents) await agent.disconnect().catch(() => undefined);
  await browser.close();
  await server.close();
}
if (failures.length > 0) {
  process.stderr.write(`${failures.length} check(s) failed: ${failures.join('; ')}\n`);
  process.exitCode = 1;
}
