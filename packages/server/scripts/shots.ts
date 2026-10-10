import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { parseScenario } from '@turing-city/core';
import { chromium } from 'playwright-core';
import { loadConfig } from '../src/config.ts';
import { loadFirmwareDir } from '../src/firmware-files.ts';
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

/** The centre of the first element that matches the selector and holds the text. It is read in one turn of the page, so a re-render cannot make it stale. */
function centerOf(selector: string, text = ''): Promise<{ x: number; y: number } | null> {
  return page.evaluate(
    ({ selector, text }) => {
      const target = [...document.querySelectorAll(selector)].find((e) => (e.textContent ?? '').includes(text));
      const r = target?.getBoundingClientRect();
      return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
    },
    { selector, text },
  );
}

/** A real mouse click on it, the way a player makes one; fails at once when it is not on the page. */
async function clickOn(selector: string, text = ''): Promise<void> {
  const at = await centerOf(selector, text);
  if (!at) throw new Error(`nothing to click: ${selector} ${text}`);
  await page.mouse.click(at.x, at.y);
}

const textOf = (selector: string): Promise<string> => page.evaluate((s) => document.querySelector(s)?.textContent ?? '', selector);

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

/** What the browser computes for a CSS colour: the cascade has been applied, which a class name does not show. */
const computedColor = (css: string): Promise<string> =>
  page.evaluate((value) => {
    const probe = document.createElement('i');
    probe.style.color = value;
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  }, css);

/** The computed colours of the numbers after "자금" and "전력" in the top bar. */
const topBarColors = (): Promise<{ money: string; power: string }> =>
  page.evaluate(() => {
    const numberAfter = (label: string): string => {
      const span = [...document.querySelectorAll('#topbar > span')].find((s) => s.textContent?.startsWith(label));
      const number = span?.querySelector('b');
      return number ? getComputedStyle(number).color : 'missing';
    };
    return { money: numberAfter('자금'), power: numberAfter('전력') };
  });

type Rgb = readonly [number, number, number];
interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}
const RED: Rgb = [0xff, 0x4d, 0x4d];

/** A second page, in a context of its own, that only decodes PNGs: the browser reads the pixels, so no image library is needed. */
const decoder = await (await browser.newContext()).newPage();

/** How many pixels of the PNG inside the rectangle are within the tolerance of the colour. */
function countPixels(png: Buffer, rect: Rect, rgb: Rgb, tolerance = 12): Promise<number> {
  return decoder.evaluate(
    async ({ base64, rect, rgb, tolerance }) => {
      const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob());
      const canvas = new OffscreenCanvas(rect.width, rect.height);
      const context = canvas.getContext('2d');
      if (!context) throw new Error('no 2d context');
      context.drawImage(bitmap, -rect.x, -rect.y);
      const { data } = context.getImageData(0, 0, rect.width, rect.height);
      let count = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (
          Math.abs(data[i]! - rgb[0]) <= tolerance &&
          Math.abs(data[i + 1]! - rgb[1]) <= tolerance &&
          Math.abs(data[i + 2]! - rgb[2]) <= tolerance
        )
          count += 1;
      }
      return count;
    },
    { base64: png.toString('base64'), rect, rgb, tolerance },
  );
}

/**
 * The map blinks every 450 ms, so one screenshot can catch only one phase. This takes screenshots until the colour's pixel count
 * inside the rectangle has differed by at least `minDifference` between two of them, and keeps the fullest as `-lit` and the
 * emptiest as `-dark`. The pixels of the screenshots decide, so the files hold the phases they are named for.
 */
async function bothPhases(name: string, what: string, rect: Rect, rgb: Rgb, minDifference: number): Promise<void> {
  const frames: Array<{ png: Buffer; count: number }> = [];
  while (frames.length < 20) {
    const png = await page.screenshot();
    frames.push({ png, count: await countPixels(png, rect, rgb) });
    const counts = frames.map((f) => f.count);
    if (Math.max(...counts) - Math.min(...counts) >= minDifference) break;
  }
  const lit = frames.reduce((a, b) => (b.count > a.count ? b : a));
  const dark = frames.reduce((a, b) => (b.count < a.count ? b : a));
  for (const [phase, frame] of [
    ['lit', lit],
    ['dark', dark],
  ] as const) {
    writeFileSync(join(out, `${name}-${phase}.png`), frame.png);
    process.stdout.write(`${out}/${name}-${phase}.png\n`);
  }
  check(
    `${what} blinks: lit in one screenshot, dark in another`,
    lit.count - dark.count >= minDifference,
    `${lit.count} pixels lit, ${dark.count} dark, ${frames.length} screenshots`,
  );
}

/**
 * A rough price of keeping up with the game, for a few seconds of the page as it is: the frame times seen by requestAnimationFrame,
 * and Chrome's own counters for the main thread's work and the JS heap. Headless Chrome draws Phaser's WebGL in software, so the
 * frame times say more about this machine than about the player's; the script's share and the heap are the page's own.
 */
async function measure(label: string, seconds: number): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const counters = async (): Promise<Record<string, number>> =>
    Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
  await cdp.send('HeapProfiler.collectGarbage'); // so the first heap figure is what the page keeps, not what it has yet to sweep
  const start = await counters();
  const snapshotsBefore = snapshotFrames;
  const heapSamples: number[] = [];
  let measuring = true;
  const sampler = (async () => {
    while (measuring) {
      heapSamples.push((await counters()).JSHeapUsedSize ?? 0);
      await page.waitForTimeout(250);
    }
  })();
  const frames = await page.evaluate(
    (ms) =>
      new Promise<number[]>((resolve) => {
        const times: number[] = [];
        let last = performance.now();
        const end = last + ms;
        const tick = (now: number): void => {
          times.push(now - last);
          last = now;
          if (now < end) requestAnimationFrame(tick);
          else resolve(times);
        };
        requestAnimationFrame(tick);
      }),
    seconds * 1000,
  );
  measuring = false;
  await sampler;
  const snapshots = snapshotFrames - snapshotsBefore;
  await cdp.send('HeapProfiler.collectGarbage');
  const end = await counters();
  await cdp.detach();

  const ms = frames.slice(1).sort((a, b) => a - b); // the first interval includes the wait for the first frame
  if (ms.length === 0) throw new Error(`perf ${label}: the page drew no frame in ${seconds} s`);
  const at = (p: number): number => ms[Math.min(ms.length - 1, Math.floor(ms.length * p))] ?? 0;
  const span = (end.Timestamp ?? 0) - (start.Timestamp ?? 0);
  const share = (name: string): number => Math.round((100 * ((end[name] ?? 0) - (start[name] ?? 0))) / span);
  const mb = (bytes: number | undefined): string => ((bytes ?? 0) / 1e6).toFixed(1);
  process.stdout.write(
    `perf ${label}, ${seconds} s: ${ms.length} frames, frame ms p50 ${at(0.5).toFixed(1)} p95 ${at(0.95).toFixed(1)} max ${at(1).toFixed(1)}; ` +
      `${(snapshots / seconds).toFixed(1)} snapshots/s; main thread busy ${share('TaskDuration')}%, script ${share('ScriptDuration')}%, ` +
      `layout+style ${Math.round(share('LayoutDuration') + share('RecalcStyleDuration'))}%; ` +
      `JS heap ${mb(start.JSHeapUsedSize)} -> ${mb(end.JSHeapUsedSize)} MB after GC (peak ${mb(Math.max(...heapSamples))}); ` +
      `DOM nodes ${start.Nodes} -> ${end.Nodes}\n`,
  );
}

try {
  await page.goto(server.url);
  await shot('1-start-waiting');

  const BAD = await computedColor('var(--bad)');
  const WHITE = await computedColor('#fff');

  let agent: Agent = await connectAgent('shots');
  const status = async (): Promise<Status> => (await agent.call('get_status')) as Status;
  const clockLabel = (): Promise<string> => page.evaluate(() => document.querySelector('#topbar b')?.textContent ?? '');

  /** Waits until the top bar shows the server's money and power, then checks the colours of those two numbers. */
  const expectTopBar = async (what: string, now: Status, money: string, power: string): Promise<void> => {
    await page.waitForFunction(
      ({ powerText, moneyText }) => {
        const text = document.querySelector('#topbar')?.textContent ?? '';
        return text.includes(powerText) && text.includes(moneyText);
      },
      { powerText: `${now.power.generation} / ${now.power.demand}`, moneyText: now.money.toLocaleString('en-US') },
    );
    const colors = await topBarColors();
    check(`${what}: the money is ${money === BAD ? 'red' : 'white'}`, colors.money === money, `computed ${colors.money}`);
    check(`${what}: the power is ${power === BAD ? 'red' : 'white'}`, colors.power === power, `computed ${colors.power}`);
  };

  /** A fresh season, nothing selected, and the page showing it. */
  const newSeason = async (): Promise<void> => {
    await agent.call('dev_new_season', { seed: SEED });
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.querySelector('#topbar b')?.textContent?.startsWith('1일차 00:00') === true);
  };
  const careful =
    'function tick(io, mem) if io.temp > 70 then io.cool(3) end if io.temp < 82 then io.process() end io.log("t", io.temp) end';
  const deployHealthy = async (): Promise<void> => {
    await agent.call('deploy_firmware', { board: 'P', code: 'function tick(io) io.set_thermal(250) end' });
    await agent.call('deploy_firmware', { board: 'DA', code: careful });
  };

  await shot('2-start-connected');

  await page.getByText('시즌 시작').click();
  await page.waitForTimeout(500);
  await agent.call('dev_new_season', { seed: SEED }); // the button's own season has a random seed
  await deployHealthy();
  await agent.call('dev_run_until', { seconds: 30 });
  await shot('3-running');
  await expectTopBar('a healthy season', await status(), WHITE, WHITE);

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

  await agent.call('dev_new_season', { seed: SEED });
  await deployHealthy();
  await agent.call('dev_run_until', { seconds: 20 });
  await clickCell(5, 4); // DA: its log is long enough to scroll
  await agent.call('dev_play');
  await waitUntil(async () => (await textOf('#topbar .speed button')) === '⏸');

  // A click is a press and a release on the same button; the page used to replace the button between the two.
  const pauseButton = await centerOf('#topbar .speed button');
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
    await waitUntil(async () => (await textOf('#topbar .speed button')) === '▶', 1500),
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

  // ---- What the page costs while the clock runs, with DA's panel open: the numbers go to the output, no limit is checked ----
  await agent.call('dev_pause');
  await measure('paused', 2);
  await agent.call('dev_play');
  await measure('1x', 4);
  await agent.call('dev_set_speed', { speed: 3 });
  await measure('3x', 4);
  await agent.call('dev_set_speed', { speed: 1 });

  // ---- The keys, the feed's click-to-jump and the auto-pause toggles, with the clock running ----
  // A key acts on the state the page last showed, so each press waits for the page to show the last one's result.
  const playButton = (): Promise<string> => textOf('#topbar .speed button');
  await page.keyboard.press('Space');
  check('Space pauses a running game', await waitUntil(async () => (await status()).run.paused && (await playButton()) === '▶'));
  await page.keyboard.press('Space');
  check('Space plays a paused game', await waitUntil(async () => !(await status()).run.paused && (await playButton()) === '⏸'));
  for (const speed of [3, 2, 1]) {
    await page.keyboard.press(String(speed));
    check(`${speed} sets the speed to ${speed}x`, await waitUntil(async () => (await status()).run.speed === speed));
  }

  // H toggles the heatmap; with the game paused the map holds still, so equal screenshots mean the same picture.
  await agent.call('dev_pause');
  const mapShot = (): Promise<Buffer> => page.screenshot({ clip: { x: map.x, y: map.y, width: map.width, height: map.height } });
  const plain = await mapShot();
  await page.keyboard.press('h');
  await page.waitForTimeout(300);
  const heated = await mapShot();
  await page.keyboard.press('h');
  await page.waitForTimeout(300);
  check('H shows the heatmap and hides it again', !plain.equals(heated) && plain.equals(await mapShot()));
  await agent.call('dev_play');

  await page.keyboard.press('Escape');
  check('Escape clears the selection', await waitUntil(async () => (await textOf('#panel')).includes('시설을 클릭하면')));
  await clickOn('#feed .item', 'P에 펌웨어');
  check('clicking a deploy in the feed selects its board', await waitUntil(async () => (await textOf('#panel h2')) === '발전소 P'));

  const toggles = (): Promise<Array<[string, boolean]>> =>
    page.evaluate(() =>
      [...document.querySelectorAll<HTMLInputElement>('#feed .toggles input')].map((box): [string, boolean] => [
        box.parentElement?.textContent?.trim() ?? '',
        box.checked,
      ]),
    );
  const flipped = (list: Array<[string, boolean]>, label: string): string =>
    JSON.stringify(list.map(([name, on]) => [name, name === label ? !on : on]));
  const untouched = await toggles();
  await clickOn('#feed .toggles label', '러다이트 접근');
  check(
    'clicking a toggle turns it, and only it, over',
    await waitUntil(async () => JSON.stringify(await toggles()) === flipped(untouched, '러다이트 접근')),
  );
  await page.waitForTimeout(600);
  check(
    "the toggle still holds after the page has redrawn from the server's status",
    JSON.stringify(await toggles()) === flipped(untouched, '러다이트 접근'),
  );
  await clickOn('#feed .toggles label', '러다이트 접근');
  check('clicking it again puts it back', await waitUntil(async () => JSON.stringify(await toggles()) === JSON.stringify(untouched)));

  // ---- States the shots above do not reach, each made on purpose with the dev tools and a fixed seed ----
  // The power plant falls short: no thermal output, and two datacenters cooling at level 3 ask for 168 units, while the wind
  // (120 to start, 8 a second at most) gives 144 or less in the first 3 seconds.
  await newSeason();
  const cooling = 'function tick(io) io.cool(3) end';
  await agent.call('deploy_firmware', { board: 'DA', code: cooling });
  await agent.call('deploy_firmware', { board: 'DB', code: cooling });
  await agent.call('dev_run_until', { seconds: 3 });
  const short = await status();
  check(
    'the plant is short of power',
    short.power.generation < short.power.demand,
    `${short.power.generation} made, ${short.power.demand} asked`,
  );
  await clickCell(4, 4);
  await expectTopBar('power short', short, WHITE, BAD);
  await shot('8-power-short');

  // Money below zero: the most thermal output burns the money, and nothing earns any. The datacenters sleep and the plant acts
  // only once, so that the town stays quiet enough for no raid to come before the money runs out (a raid would end the burn).
  await newSeason();
  await agent.call('deploy_firmware', {
    board: 'P',
    code: 'function tick(io, mem) if not mem.on then io.set_thermal(300) mem.on = true end end',
  });
  for (const board of ['DA', 'DB']) await agent.call('deploy_firmware', { board, code: 'function tick(io) io.sleep(40) end' });
  await agent.call('dev_run_until', { seconds: 150 });
  const broke = await status();
  check('the money is below zero and the season goes on', broke.money < 0 && broke.ended === null, `money ${broke.money}`);
  await expectTopBar('money below zero', broke, BAD, WHITE);
  await shot('9-money-below-zero');

  // ... and three days below zero end the season.
  await agent.call('dev_run_until', { alertKinds: ['seasonEnd'] });
  const over = await status();
  check('three days below zero end the season in bankruptcy', over.ended?.kind === 'bankrupt', JSON.stringify(over.ended));
  check('the season-end overlay names the ending', await waitUntil(async () => (await textOf('#overlay')).startsWith('파산')));
  const overlayText = await textOf('#overlay');
  check(
    'the season-end overlay shows the final money',
    overlayText.includes(`최종 자금 ${over.money.toLocaleString('en-US')}`),
    overlayText,
  );
  await shot('10-season-ended');
  await clickOn('#overlay button', '새 시즌');
  check(
    'the overlay\'s "새 시즌" starts a season',
    await waitUntil(async () => (await page.locator('#overlay').isHidden()) && (await clockLabel()).startsWith('1일차 00:00')),
  );

  // A board whose firmware fails every tick: its light blinks red.
  await newSeason();
  await deployHealthy();
  await agent.call('deploy_firmware', { board: 'DB', code: 'function tick(io) local board = nil; return board.id end' });
  await agent.call('dev_run_until', { seconds: 5 });
  await clickCell(16, 8);
  // The page draws the selection a moment after the click, and the panel's log when the board's inspection arrives.
  const panelShowsError = async (): Promise<boolean> => {
    const panel = await textOf('#panel');
    return panel.includes('에러') && panel.includes('[error]') && (await textOf('#feed')).includes('에러');
  };
  check('the panel of the erroring board says so and shows the error in its log, and the feed too', await waitUntil(panelShowsError));
  const led = { x: Math.round(map.x + 16 * 34 + 29 - 6), y: Math.round(map.y + 8 * 34 + 5 - 6), width: 12, height: 12 };
  await bothPhases('11-board-error', "DB's light", led, RED, 20);

  // A raid, with the clock: the default auto-pause stops the game when the Luddites appear and when a board is smashed.
  await newSeason();
  for (const [board, code] of Object.entries(loadFirmwareDir('scenarios/firmware/m1/careless')))
    await agent.call('deploy_firmware', { board, code });
  await agent.call('dev_run_until', { seconds: 60 }); // the first raid comes at 68 s
  await page.keyboard.press('3');
  await page.keyboard.press('Space');
  const alertKinds = async (): Promise<string[]> => ((await agent.call('get_alerts')) as Array<{ kind: string }>).map((a) => a.kind);
  const raided = await waitUntil(async () => (await alertKinds()).includes('raid'), 20_000);
  check('the raid pauses the game by itself', raided && (await waitUntil(async () => (await status()).run.paused, 2000)));
  check('the page shows the pause', await waitUntil(async () => (await textOf('#topbar .speed button')) === '▶'));
  // A group picks its target on its first step, a beat after it appears: the pause comes before that, so there is no path yet.
  await agent.call('dev_run_until', { seconds: 2 });
  const mapRect = { x: Math.round(map.x), y: Math.round(map.y), width: Math.round(map.width), height: Math.round(map.height) };
  await bothPhases('12-raid', "the Luddites' path", mapRect, RED, 300);
  await page.keyboard.press('Space');
  const smashed = await waitUntil(async () => (await alertKinds()).includes('boardDestroyed'), 30_000);
  check('a smashed board pauses the game by itself', smashed && (await waitUntil(async () => (await status()).run.paused, 2000)));

  // The alert names the board; clicking it opens the board's panel, where a destroyed board offers its rebuild.
  await clickOn('#feed .item', '부서졌어요');
  const scenario = parseScenario(JSON.parse(readFileSync('scenarios/m1-power.json', 'utf8')));
  const rebuild = scenario.tuning.rebuild;
  const label = `재건 (${rebuild.cost.toLocaleString('en-US')} · ${Math.floor((rebuild.seconds * 24) / scenario.time.secondsPerDay)}시간)`;
  check(
    'clicking an alert in the feed opens the destroyed board, with its rebuild button',
    await waitUntil(async () => (await textOf('#panel button')) === label),
    `wanted "${label}", got "${await textOf('#panel button')}"`,
  );
  await shot('13-board-destroyed');
  await clickOn('#panel button');
  await agent.call('dev_run_until', { seconds: 1 });
  check('the rebuild button starts the rebuild', await waitUntil(async () => (await textOf('#panel')).includes('재건 중…')));
  await shot('14-rebuilding');
} finally {
  for (const agent of agents) await agent.disconnect().catch(() => undefined);
  await browser.close();
  await server.close();
  rmSync(configDir, { recursive: true, force: true }); // the token it holds belongs to this run only
}
if (failures.length > 0) {
  process.stderr.write(`${failures.length} check(s) failed: ${failures.join('; ')}\n`);
  process.exitCode = 1;
}
