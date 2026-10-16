import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { type BoardKind, boardManual, parseScenario } from '@turing-city/core';
import { chromium } from 'playwright-core';
import { loadConfig } from '../src/config.ts';
import { startGameServer } from '../src/game-server.ts';

/**
 * pnpm shots: the real viewer in headless Chrome, against a real server and a scripted agent. It writes screenshots to
 * scratch/shots, to be looked at, and runs the checks that need a browser. A failed check ends the run with exit code 1.
 *
 * The player's part is played in the page with real clicks and keys: the hand controls, installs, the manual, the editor, repairs
 * and rebuilds. The scripted agent uses the board tools a player's agent has at T2, and the dev tools for time and seasons.
 */
const out = 'scratch/shots';
/** The seasons the script starts itself, so that its numbers repeat from run to run. */
const SEED = 3;
/** The map's cell size in pixels: CELL in the viewer's map-scene.ts, which pulls in Phaser and cannot load here. */
const CELL = 34;
/** The server's own scenario (its default): the cells, the prices on the buttons, the times, and the manuals come from it. */
const scenario = parseScenario(JSON.parse(readFileSync('scenarios/m2-town.json', 'utf8')));
const tuning = scenario.tuning;
const cellOf = (id: string): readonly [number, number] => {
  const facility = scenario.facilities.find((f) => f.id === id);
  if (!facility) throw new Error(`no facility ${id} in the scenario`);
  return [facility.x, facility.y];
};
/** The facilities that take a board: every one but housing. */
const boardSlots = scenario.facilities.filter((f) => f.board !== null).map((f) => f.id);
/** Game seconds in the hours the buttons show (a repair, a rebuild). */
const hours = (seconds: number): number => Math.floor((seconds * 24) / scenario.time.secondsPerDay);
mkdirSync(out, { recursive: true });
/** Google Chrome by default; TURING_CITY_CHROME names another Chromium build's executable (a machine without Chrome). */
const chromePath = process.env.TURING_CITY_CHROME;
const browser = await chromium.launch(chromePath ? { executablePath: chromePath, headless: true } : { channel: 'chrome', headless: true });
// The copy buttons are checked on the clipboard, and the manual's download in its file.
const context = await browser.newContext({
  viewport: { width: 1320, height: 860 },
  permissions: ['clipboard-read', 'clipboard-write'],
  acceptDownloads: true,
});
const page = await context.newPage();

const failures: string[] = [];
function check(name: string, ok: boolean, detail = ''): void {
  process.stdout.write(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail === '' ? '' : ` (${detail})`}\n`);
  if (!ok) failures.push(name);
}

/** A precondition of the next check: when it does not hold, the run stops, so that the check cannot pass on an earlier state. */
function must(ok: boolean, what: string): void {
  if (!ok) throw new Error(`precondition failed: ${what}`);
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

/**
 * The centre of the first element that matches the selector and holds the text (with exact, whose text is the text). It is read in
 * one turn of the page, so a re-render cannot make it stale, which a Playwright locator can (the page rebuilds its buttons about 20
 * times a second while the clock runs).
 */
function centerOf(selector: string, text = '', exact = false): Promise<{ x: number; y: number } | null> {
  return page.evaluate(
    ({ selector, text, exact }) => {
      const target = [...document.querySelectorAll(selector)].find((e) => {
        const content = e.textContent ?? '';
        return exact ? content === text : content.includes(text);
      });
      const r = target?.getBoundingClientRect();
      return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
    },
    { selector, text, exact },
  );
}

/** A real mouse click on it, the way a player makes one; fails at once when it is not on the page. */
async function clickOn(selector: string, text = '', exact = false): Promise<void> {
  const at = await centerOf(selector, text, exact);
  if (!at) throw new Error(`nothing to click: ${selector} ${text}`);
  await page.mouse.click(at.x, at.y);
}

const textOf = (selector: string): Promise<string> => page.evaluate((s) => document.querySelector(s)?.textContent ?? '', selector);
const isShown = async (selector: string): Promise<boolean> => !(await page.locator(selector).isHidden());

/** The first button in the scope whose label starts with the text: its label, and whether it is disabled. Null when there is none. */
const buttonNamed = (scope: string, text: string): Promise<{ text: string; disabled: boolean } | null> =>
  page.evaluate(
    ({ scope, text }) => {
      const button = [...document.querySelectorAll<HTMLButtonElement>(`${scope} button`)].find((b) =>
        (b.textContent ?? '').startsWith(text),
      );
      return button ? { text: button.textContent ?? '', disabled: button.disabled } : null;
    },
    { scope, text },
  );

/** What the page's clipboard holds (the context grants reading it). */
const clipboard = (): Promise<string> => page.evaluate(() => navigator.clipboard.readText());

/** How many snapshots the page's socket has received: proof that the page was being re-rendered during a press. */
let snapshotFrames = 0;
page.on('websocket', (ws) => {
  ws.on('framereceived', (frame) => {
    if (typeof frame.payload === 'string' && frame.payload.startsWith('{"type":"snapshot"')) snapshotFrames += 1;
  });
});

interface Agent {
  /** A tool's result, parsed (the tools answer JSON text); a tool error throws. */
  call(tool: string, args?: Record<string, unknown>): Promise<unknown>;
  /** A tool's result as it came: get_datasheet answers the manual as markdown, not JSON. A tool error throws. */
  text(tool: string, args?: Record<string, unknown>): Promise<string>;
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
  const raw = async (tool: string, args: Record<string, unknown>): Promise<string> => {
    const result = (await client.callTool({ name: tool, arguments: args })) as { content: Array<{ text: string }>; isError?: boolean };
    const text = result.content[0]?.text ?? '';
    if (result.isError) throw new Error(`${tool}: ${text}`);
    return text;
  };
  const agent: Agent = {
    call: async (tool, args = {}) => JSON.parse(await raw(tool, args)),
    text: (tool, args = {}) => raw(tool, args),
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
  readonly time: { readonly seconds: number };
  readonly money: number;
  readonly power: { readonly generation: number; readonly demand: number };
  readonly food: { readonly warehouse: number; readonly housing: number };
  readonly ended: { readonly kind: string } | null;
  readonly run: { readonly paused: boolean; readonly speed: number };
}
interface BoardRow {
  readonly id: string;
  readonly kind: BoardKind;
  readonly tier: number;
  readonly condition: string;
  readonly board: { readonly status: string } | null;
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
/** The map's red: the error light and the Luddites' path (LED_COLORS.error in the viewer's format.ts). */
const RED: Rgb = [0xff, 0x4d, 0x4d];
/** The trucks (TRUCK_COLOR in the viewer's map-scene.ts), and the map's ground under them. */
const TRUCK: Rgb = [0xff, 0x9f, 0x43];
const GROUND: Rgb = [0x14, 0x1a, 0x20];
const blend = (top: Rgb, under: Rgb, alpha: number): Rgb => [
  Math.round(alpha * top[0] + (1 - alpha) * under[0]),
  Math.round(alpha * top[1] + (1 - alpha) * under[1]),
  Math.round(alpha * top[2] + (1 - alpha) * under[2]),
];
/** A caption's background on the map ('#0c0f13cc' in map-scene.ts, over the ground): the box each caption is drawn in. */
const CAPTION: Rgb = blend([0x0c, 0x0f, 0x13], GROUND, 0.8);
/** An outbound truck's route: the trucks' colour at 0.9 opacity on the ground (map-scene.ts draws a returning leg fainter). */
const ROUTE = blend(TRUCK, GROUND, 0.9);

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
 * The runs of columns, left to right, in which some pixel of the PNG inside the rectangle is within the tolerance of the colour: where
 * labels with that background colour lie along a row of the map. Each run is [first column, last column], relative to the rectangle.
 */
function columnRuns(png: Buffer, rect: Rect, rgb: Rgb, tolerance = 3): Promise<Array<[number, number]>> {
  return decoder.evaluate(
    async ({ base64, rect, rgb, tolerance }) => {
      const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob());
      const canvas = new OffscreenCanvas(rect.width, rect.height);
      const context = canvas.getContext('2d');
      if (!context) throw new Error('no 2d context');
      context.drawImage(bitmap, -rect.x, -rect.y);
      const { data } = context.getImageData(0, 0, rect.width, rect.height);
      const runs: Array<[number, number]> = [];
      for (let x = 0; x < rect.width; x++) {
        let hit = false;
        for (let y = 0; y < rect.height && !hit; y++) {
          const i = 4 * (y * rect.width + x);
          hit =
            Math.abs(data[i]! - rgb[0]) <= tolerance &&
            Math.abs(data[i + 1]! - rgb[1]) <= tolerance &&
            Math.abs(data[i + 2]! - rgb[2]) <= tolerance;
        }
        const last = runs[runs.length - 1];
        if (hit && last && last[1] === x - 1) last[1] = x;
        else if (hit) runs.push([x, x]);
      }
      return runs;
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
  const deadline = Date.now() + 3000; // more than three blink periods, so a blinking part shows both phases
  do {
    const png = await page.screenshot();
    frames.push({ png, count: await countPixels(png, rect, rgb) });
    const counts = frames.map((f) => f.count);
    if (Math.max(...counts) - Math.min(...counts) >= minDifference) break;
  } while (Date.now() < deadline);
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
 * and Chrome's own counters for the main thread's work and the JS heap. Headless Chrome draws Phaser's WebGL in software and
 * holds its frames to a 60 Hz cadence, so the frame times show dropped frames, not cost; the busy shares and the heap are the cost.
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

// The server and its config directory (it holds a token) are made last, just before the try that removes them: a Chrome that fails
// to launch, above, must not leave either behind.
const configDir = mkdtempSync(join(tmpdir(), 'tc-shots-'));
const server = await startGameServer({ port: 0, configDir, dev: true }).catch((error: unknown) => {
  rmSync(configDir, { recursive: true, force: true });
  throw error;
});
let serverClosed = false;
try {
  await page.goto(server.url);
  const BAD = await computedColor('var(--bad)');
  const WHITE = await computedColor('#fff');

  // ---- The start screen: an agent is optional (10-10 spec §8) ----
  check(
    '"시즌 시작" is enabled with no agent connected',
    await waitUntil(async () => (await buttonNamed('.start', '시즌 시작'))?.disabled === false),
  );
  check('the start screen offers an agent as optional', (await textOf('.start')).includes('에이전트 연결 (선택)'));
  await shot('1-start');

  // ---- The guide card (10-10 spec §10.2) ----
  await clickOn('.start button', '시즌 시작');
  check(
    'a season starts with no agent, and the guide card says what to do',
    await waitUntil(async () => (await isShown('#guide')) && (await textOf('#guide')).includes('이렇게 해요'), 5000),
  );
  await shot('2-guide');
  await clickOn('#guide button', '알겠어요');
  check('"알겠어요" closes the card', await waitUntil(async () => !(await isShown('#guide'))));

  // The scripted agent: game time run as fast as the server can while the game is paused, and seasons with a fixed seed.
  let agent: Agent = await connectAgent('shots');
  const status = async (): Promise<Status> => (await agent.call('get_status')) as Status;
  const boards = async (): Promise<BoardRow[]> => (await agent.call('list_boards')) as BoardRow[];
  const boardOf = async (id: string): Promise<BoardRow | undefined> => (await boards()).find((b) => b.id === id);
  const alertKinds = async (): Promise<string[]> =>
    ((await agent.call('get_alerts')) as { alerts: Array<{ kind: string }> }).alerts.map((a) => a.kind);
  /** Game time, as fast as the server runs it. The game must be paused. */
  const run = (seconds: number): Promise<unknown> => agent.call('dev_run_until', { seconds });
  /**
   * Runs a second at a time until an alert of the kind comes, for at most the seconds given. dev_run_until's own alert goal stops at
   * the end of a batch, up to 10 game seconds late, and the Luddites walk a cell a second.
   */
  const runUntilAlert = async (kind: string, maxSeconds: number): Promise<boolean> => {
    for (let s = 0; s < maxSeconds; s++) {
      await run(1);
      if ((await alertKinds()).includes(kind)) return true;
    }
    return false;
  };
  const clockLabel = (): Promise<string> => page.evaluate(() => document.querySelector('#topbar b')?.textContent ?? '');
  /**
   * A new season with the fixed seed, once the page shows it. The page knows that a season started from a snapshot at its first step
   * after one at a later step, so the season it replaces runs a second first.
   */
  const newSeason = async (): Promise<void> => {
    await run(1);
    await agent.call('dev_new_season', { seed: SEED });
    await page.waitForFunction(() => document.querySelector('#topbar b')?.textContent?.startsWith('1일차 00:00') === true);
  };
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

  await newSeason();
  check('the card shows again at the next season', await waitUntil(() => isShown('#guide')));
  await clickOn('#guide label', '다시 보지 않기');
  await clickOn('#guide button', '알겠어요');
  await newSeason();
  await page.waitForTimeout(800);
  check(
    'with "다시 보지 않기" ticked, the card stays away at the next season, and the browser keeps that',
    !(await isShown('#guide')) && (await page.evaluate(() => localStorage.getItem('turing-city:guide-dismissed'))) === '1',
  );
  await clickOn('#topbar button', '도움말');
  check('[도움말] opens the card again', await waitUntil(() => isShown('#guide')));
  // The checkbox keeps the focus once clicked; it takes no text, so the game's keys still reach the page.
  await clickOn('#guide input[type=checkbox]');
  const focused = await page.evaluate(() => (document.activeElement as HTMLInputElement | null)?.type ?? '');
  await page.keyboard.press('Escape');
  check(
    'Escape closes it, even with its checkbox ticked and focused',
    focused === 'checkbox' && (await waitUntil(async () => !(await isShown('#guide')))),
    `focus on ${focused}`,
  );

  // ---- The town at T0: every facility runs by hand, none has a board ----
  const map = await page.locator('#map canvas').boundingBox();
  if (!map) throw new Error('the map canvas is missing');
  const mapRect = { x: Math.round(map.x), y: Math.round(map.y), width: Math.round(map.width), height: Math.round(map.height) };
  /** Selects a facility with a click on its cell. The windows lie over the map, so none may be open. */
  const select = async (id: string, title: string): Promise<void> => {
    const [x, y] = cellOf(id);
    await page.mouse.click(map.x + x * CELL + CELL / 2, map.y + y * CELL + CELL / 2);
    if (!(await waitUntil(async () => (await textOf('#panel h2')) === title))) throw new Error(`the panel did not open ${title}`);
  };
  await run(1); // the power phase has run once
  const atT0 = await boards();
  check(
    'every facility that takes a board starts without one (T0)',
    atT0.length === boardSlots.length && atT0.every((b) => b.tier === 0 && b.board === null),
    atT0.map((b) => `${b.id}:T${b.tier}`).join(' '),
  );
  check(
    'the top bar shows the food and the people',
    await waitUntil(async () => {
      const bar = await textOf('#topbar');
      return bar.includes('식량') && bar.includes('인구');
    }),
  );
  const t0 = await status();
  await expectTopBar('the town at T0', t0, WHITE, t0.power.generation < t0.power.demand ? BAD : WHITE);
  await shot('3-town-t0');

  // ---- The plant by hand: the thermal slider, and the supply order (10-10 spec §4.3) ----
  await select('P', '발전소 P');
  const thermalMax = tuning.thermal.max;
  await page.locator('#panel input[type=range]').fill(String(thermalMax)); // sent on change, as when a drag is let go
  check(
    "the thermal slider sets the plant's output, and the paused game shows it at once",
    await waitUntil(async () => (await textOf('#topbar')).includes(`화력 ${thermalMax}`)),
    (await textOf('#topbar')).slice(0, 160),
  );
  /** A facility's place in the supply order, as the panel shows it (1 is supplied first), and the centre of its ↑. */
  const priorityRow = (id: string): Promise<{ rank: number; up: { x: number; y: number } | null }> =>
    page.evaluate((id) => {
      const rows = [...document.querySelectorAll('#panel .prio-row')];
      const index = rows.findIndex((r) => r.firstElementChild?.textContent?.endsWith(` ${id}`));
      const r = rows[index]?.querySelector('button')?.getBoundingClientRect();
      return { rank: index + 1, up: r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null };
    }, id);
  const startRank = (await priorityRow('DA')).rank;
  for (let k = 0; k < 10; k++) {
    const { rank, up } = await priorityRow('DA');
    if (rank <= 1 || !up) break;
    await page.mouse.click(up.x, up.y);
    await waitUntil(async () => (await priorityRow('DA')).rank === rank - 1);
  }
  check('↑ moves a facility up the supply order, to the top', startRank > 1 && (await priorityRow('DA')).rank === 1, `from ${startRank}`);

  // ---- The datacenter by hand: [처리] mashed, then a cooling cycle (10-10 spec §4.3) ----
  await select('DA', '데이터센터 DA');
  const tempOf = async (): Promise<number> => Number(/온도\s*(\d+)°C/.exec(await textOf('#panel'))?.[1] ?? Number.NaN);
  const cold = await tempOf();
  await agent.call('dev_play');
  let processing = false;
  for (let k = 0; k < 14; k++) {
    await clickOn('#panel button', '처리');
    await page.waitForTimeout(150);
    if ((await textOf('#panel')).includes('처리 중')) processing = true;
  }
  await agent.call('dev_pause');
  await page.waitForTimeout(300);
  const hot = await tempOf();
  check('mashing [처리] keeps the datacenter processing, and it heats up', processing && hot > cold, `${cold} -> ${hot} °C`);
  await run(1); // the last press's job ends
  await clickOn('#panel button', '냉각');
  check(
    '[냉각] starts a cycle, and the button waits for its end',
    await waitUntil(async () => {
      const button = await buttonNamed('#panel', '냉각');
      return button?.disabled === true && button.text === '냉각 중…';
    }),
    JSON.stringify(await buttonNamed('#panel', '냉각')),
  );
  // Processing and cooling never run at once (the user, 2026-10-16): [처리] waits for the cycle, and the cooling gauge shows its time.
  const gaugeWidth = (kind: string): Promise<number> =>
    page.evaluate((k) => {
      const bar = document.querySelector<HTMLElement>(`#panel .gauge.${k} i`);
      return bar ? bar.getBoundingClientRect().width : -1;
    }, kind);
  check(
    'while it cools, [처리] waits with its reason, the cooling gauge is full, and the job gauge empty',
    (await buttonNamed('#panel', '처리'))?.disabled === true &&
      (await textOf('#panel .controls .reason')).includes('냉각하는 동안에는 처리할 수 없어요') &&
      (await gaugeWidth('cool')) > 0 &&
      (await gaugeWidth('job')) === 0,
    `cool ${await gaugeWidth('cool')} px, job ${await gaugeWidth('job')} px`,
  );
  await shot('4-datacenter-by-hand');
  await run(tuning.datacenter.coolingCycleMs / 1000 + 0.5);
  // The page shows the run's end a moment after the run returns: the temperature is read from the render that shows the button back.
  const cycleOver = await waitUntil(async () => (await buttonNamed('#panel', '냉각'))?.disabled === false);
  const cooled = await tempOf();
  check('when the cycle ends, the button is back and the datacenter is cooler', cycleOver && cooled < hot, `${hot} -> ${cooled} °C`);

  // ---- A board, then a comm module (10-10 spec §4.1, §8) ----
  const boardPrice = tuning.install.boardPrice.datacenter;
  const commPrice = tuning.install.commPrice;
  const beforeInstall = (await status()).money;
  check(
    'the board button shows its price',
    (await buttonNamed('#panel', '보드 설치'))?.text === `보드 설치 (${boardPrice.toLocaleString('en-US')})`,
    JSON.stringify(await buttonNamed('#panel', '보드 설치')),
  );
  await clickOn('#panel button', '보드 설치');
  check(
    '[보드 설치] puts a board in the datacenter (T1) for its price',
    (await waitUntil(async () => (await textOf('#panel')).includes('T1 보드'))) &&
      (await boardOf('DA'))?.tier === 1 &&
      (await status()).money === beforeInstall - boardPrice,
  );
  check('a new board has no firmware, and the panel says so', (await textOf('#panel')).includes('펌웨어 없음'));
  const refused = await agent.text('get_datasheet', { board: 'DA' }).then(
    () => 'answered',
    (error: unknown) => String(error),
  );
  check("the agent's board tools do not reach a board without a comm module", refused.includes('no comm module'), refused);
  await clickOn('#panel button', '통신 모듈');
  check(
    '[통신 모듈] mounts a comm module (T2) for its price',
    (await waitUntil(async () => (await textOf('#panel')).includes('T2 통신 모듈'))) &&
      (await boardOf('DA'))?.tier === 2 &&
      (await status()).money === beforeInstall - boardPrice - commPrice,
  );
  const manualDA = boardManual(scenario, 'DA') ?? '';
  check(
    "at T2 the agent reads the board's manual, the same text the player reads",
    manualDA !== '' && (await agent.text('get_datasheet', { board: 'DA' })) === manualDA,
  );
  await shot('5-installed');

  // ---- The manual: the board's, copied and downloaded, and the index (10-10 spec §9) ----
  await clickOn('#panel button', '매뉴얼');
  check(
    "[매뉴얼] opens the board's manual beside the map",
    await waitUntil(async () => (await isShown('#manual-window')) && (await textOf('#manual-window')).includes('DA 보드 매뉴얼')),
  );
  await clickOn('#manual-window button', '마크다운 복사');
  check(
    '[마크다운 복사] puts the whole manual on the clipboard, as markdown',
    await waitUntil(async () => (await clipboard()) === manualDA),
  );
  const [download] = await Promise.all([page.waitForEvent('download'), clickOn('#manual-window button', '.md 다운로드')]);
  const saved = readFileSync(await download.path(), 'utf8');
  check(
    '[.md 다운로드] saves the same text as a .md file',
    download.suggestedFilename() === 'turing-city-manual-DA.md' && saved === manualDA,
    download.suggestedFilename(),
  );
  await shot('6-manual');
  await clickOn('#topbar button', '매뉴얼');
  check(
    "the top bar's [매뉴얼] opens the index, which lists every board slot",
    await waitUntil(async () => {
      const text = await textOf('#manual-window .body');
      return text.includes('매뉴얼 목차') && boardSlots.every((id) => text.includes(id));
    }),
  );

  // ---- The editor: a syntax error, a deploy, the game's keys, a draft (10-10 spec §10.4) ----
  await clickOn('#panel button', '편집');
  const code = (): Promise<string> => textOf('#editor-window .cm-content');
  check(
    '[편집] opens the editor beside the manual, on a starting firmware',
    await waitUntil(async () => (await isShown('#editor-window')) && (await code()).includes('function tick(io, mem)')),
  );
  /** Replaces the editor's text the way a paste from an AI chat does: in one insertion, so that no bracket or indent is added. */
  const setCode = async (source: string): Promise<void> => {
    // The focus, not a click: the centre of a long source's content lies far below the window, where a click lands on something else.
    await page.focus('#editor-window .cm-content');
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.insertText(source);
  };
  const result = (): Promise<string> => textOf('#editor-window .result');
  await setCode('function tick\nend\n');
  await clickOn('#editor-window button', '배포');
  check(
    'a deploy with a syntax error is refused, with the line it is on',
    await waitUntil(async () => (await result()).startsWith('2번째 줄')),
    await result(),
  );
  await shot('7-editor-syntax-error');
  // A board that counts its ticks in its log: no processing, so no heat, and a log that grows by a line a tick.
  const logging = 'function tick(io, mem)\n  mem.n = (mem.n or 0) + 1\n  io.log("tick", mem.n)\nend\n';
  await setCode(logging);
  await clickOn('#editor-window button', '배포');
  check(
    'a deploy from the editor is accepted, and says when it installs',
    await waitUntil(async () => (await result()).startsWith('v1 배포됨 · 보드의 다음 틱에 설치돼요')),
    await result(),
  );
  check(
    'the feed says the player deployed it',
    await waitUntil(async () => (await textOf('#feed')).includes('플레이어: DA에 펌웨어 v1 배포')),
  );
  check(
    'with the game paused, the panel shows the deploy waiting to install',
    await waitUntil(async () => (await textOf('#panel')).includes('설치 대기 v1')),
  );
  // What the server would refuse is stopped in the editor, with its reason: a source over the limit (whose frame would close the
  // socket without a word) and one with a NUL character. Neither reaches the server: the feed shows no second deploy.
  await setCode(`-- ${'x'.repeat(65_536)}`);
  await clickOn('#editor-window button', '배포');
  check(
    'a source over 65,536 characters is refused in the editor, in Korean, before it is sent',
    await waitUntil(async () => (await result()).startsWith('펌웨어가 너무 길어요 (65,539자)')),
    await result(),
  );
  await setCode(`${logging}\u0000`);
  await clickOn('#editor-window button', '배포');
  check(
    'a source with a NUL character is refused in the editor, in Korean, before it is sent',
    await waitUntil(async () => (await result()).startsWith('코드에 NUL 문자')),
    await result(),
  );
  await page.waitForTimeout(300);
  check(
    'neither refused source reached the server, and the page is still connected',
    !(await textOf('#feed')).includes('DA에 펌웨어 v2') && !(await isShown('#notice')),
    await textOf('#notice'),
  );
  await setCode(logging); // the code the board was given
  // The game's keys go into the code while the editor has the focus.
  await clickOn('#editor-window .cm-content');
  await page.keyboard.press('ControlOrMeta+End');
  const still = await status();
  for (const key of ['Space', '3', 'h']) await page.keyboard.press(key);
  await page.waitForTimeout(400);
  const after = await status();
  check(
    "the game's keys do nothing while the editor has the focus: they type into the code",
    after.run.paused === still.run.paused && after.run.speed === still.run.speed && (await code()).includes(' 3h'),
    `paused ${still.run.paused} -> ${after.run.paused}, speed ${still.run.speed} -> ${after.run.speed}`,
  );
  await clickOn('#editor-window button', '×');
  check('[×] closes the editor', await waitUntil(async () => !(await isShown('#editor-window'))));
  await clickOn('#panel button', '편집');
  check(
    'the editor opens again on the text it was closed with',
    await waitUntil(async () => (await code()).includes('io.log') && (await code()).includes(' 3h')),
  );
  // The editor survives a running game: snapshots arrive about 20 times a second, and the screens around it are rebuilt on each one.
  await clickOn('#editor-window .cm-content');
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.insertText('\n-- half-typed');
  await clickOn('#topbar button', '▶');
  await page.waitForTimeout(1500);
  check(
    'the editor keeps its text while the game runs',
    (await isShown('#editor-window')) && (await code()).includes('-- half-typed') && !(await status()).run.paused,
    await code(),
  );
  await clickOn('#topbar button', '⏸');
  await waitUntil(async () => (await status()).run.paused);
  // Back to the code the board runs. The editor opened on a draft, and this text differs from it, so a close keeps it as the new draft.
  await setCode(logging);
  // Escape with the focus outside the code closes what is open nearest first: the editor, then the manual.
  await clickOn('#panel h2');
  await page.keyboard.press('Escape');
  check(
    'with the focus outside the editor, Escape closes the editor first, and leaves the manual open',
    await waitUntil(async () => !(await isShown('#editor-window')) && (await isShown('#manual-window'))),
  );
  await clickOn('#panel button', '편집');
  must(await waitUntil(async () => (await code()) === logging.replaceAll('\n', '')), 'the editor opens again on its draft');
  await page.focus('#editor-window .cm-content');
  // Escape with the focus in the code: CodeMirror's own Escapes come first (its search panel, a selection), then the window's.
  await page.keyboard.press('ControlOrMeta+F');
  const searchOpen = await waitUntil(() => isShown('#editor-window .cm-search'));
  await page.keyboard.press('Escape');
  check(
    "Escape in the editor's search panel closes the search panel, not the editor",
    searchOpen &&
      (await waitUntil(async () => (await page.locator('#editor-window .cm-search').count()) === 0)) &&
      (await isShown('#editor-window')),
    `search panel opened: ${searchOpen}`,
  );
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  check('Escape with code selected collapses the selection and leaves the editor open', await isShown('#editor-window'));
  await page.keyboard.press('Escape');
  check(
    'the next Escape in the code closes the editor, and nothing else: the manual stays open',
    await waitUntil(async () => !(await isShown('#editor-window')) && (await isShown('#manual-window'))),
  );
  await page.keyboard.press('Escape');
  check('the next Escape closes the manual', await waitUntil(async () => !(await isShown('#manual-window'))));

  // ---- The board at work: its log, and its light when its firmware fails ----
  await run(2);
  await clickOn('#panel button', '로그 복사');
  check(
    "[로그 복사] puts the board's log on the clipboard",
    await waitUntil(async () => (await clipboard()).includes('firmware v1 installed')),
  );
  // The panel is rebuilt with every snapshot and every inspection (twice a second): the button's word must outlive those renders.
  const copiedSaid = await waitUntil(async () => (await buttonNamed('#panel', '복사했어요')) !== null);
  await page.waitForTimeout(800);
  check(
    '[로그 복사] says that it copied, across the renders of the next moment',
    copiedSaid && (await buttonNamed('#panel', '복사했어요')) !== null,
  );
  check('and then it is [로그 복사] again', await waitUntil(async () => (await buttonNamed('#panel', '로그 복사')) !== null));
  // A draft is what the player typed and did not deploy. The editor opens on the draft left by the last Escape, gets a line more, deploys
  // that (v2), and is closed with nothing typed after the deploy: it keeps no draft, so it opens next on the board's newer code, the
  // agent's. The deployed text differs from the one the editor opened on, so only the deploy's answer can make the close keep nothing.
  await clickOn('#panel button', '편집');
  must(await waitUntil(async () => (await code()).includes('io.log')), 'the editor opens on its draft');
  await page.focus('#editor-window .cm-content');
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.insertText('\n-- v2');
  await clickOn('#editor-window button', '배포');
  const redeployed = await waitUntil(async () => (await result()).startsWith('v2 배포됨'));
  await clickOn('#editor-window button', '×');
  const faulty = 'function tick(io) local board = nil; return board.id end';
  await agent.call('deploy_firmware', { board: 'DA', code: faulty });
  check(
    "the agent's deploy reaches the T2 board, and the feed says the agent made it",
    await waitUntil(async () => (await textOf('#feed')).includes('에이전트: DA에 펌웨어 v3 배포')),
  );
  await waitUntil(async () => (await textOf('#panel')).includes('설치 대기 v3')); // the inspection the editor opens on is current
  await clickOn('#panel button', '편집');
  check(
    "an editor closed with nothing typed since its deploy opens again on the board's newer firmware, the agent's",
    redeployed && (await waitUntil(async () => (await isShown('#editor-window')) && (await code()) === faulty)),
    `redeployed: ${redeployed}; ${await code()}`,
  );
  await clickOn('#editor-window button', '×');
  await run(2);
  const [lx, ly] = cellOf('DA');
  // The light is a dot 5 px in from the top right corner of its cell; the rectangle is a little square around it.
  const light = { x: Math.round(map.x + (lx + 1) * CELL - 5 - 6), y: Math.round(map.y + ly * CELL + 5 - 6), width: 12, height: 12 };
  await bothPhases('8-board-error', "DA's light", light, RED, 20);
  await agent.call('deploy_firmware', { board: 'DA', code: logging });
  await run(1);

  // ---- The clock running: what the page's controls do while it redraws about 20 times a second ----
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

  // A held key repeats keydown (repeat set), and the repeats come after the page has shown the first one's result: if they acted,
  // a held Space would flip pause and play at the repeat rate.
  await page.keyboard.down('Space');
  check('a held Space pauses a running game', await waitUntil(async () => (await status()).run.paused && (await playButton()) === '▶'));
  await page.keyboard.down('Space'); // the key repeating
  await page.waitForTimeout(300);
  check('the repeat of a held Space does not play again', (await status()).run.paused);
  // A Space left to the page would scroll it, and a held one would on every repeat.
  const repeatCancelled = await page.evaluate(() => {
    const repeat = new KeyboardEvent('keydown', { code: 'Space', key: ' ', repeat: true, bubbles: true, cancelable: true });
    document.body.dispatchEvent(repeat);
    return repeat.defaultPrevented;
  });
  check('the repeat of a held Space is kept from scrolling the page', repeatCancelled);
  await page.keyboard.up('Space');
  await page.keyboard.press('Space');
  check('Space plays again once it is released', await waitUntil(async () => !(await status()).run.paused && (await playButton()) === '⏸'));

  for (const speed of [3, 2, 1]) {
    await page.keyboard.press(String(speed));
    check(`${speed} sets the speed to ${speed}x`, await waitUntil(async () => (await status()).run.speed === speed));
  }

  // H toggles the heatmap; with the game paused the map holds still (nothing blinks: no Luddites, no failing board), so equal
  // screenshots mean the same picture.
  await agent.call('dev_pause');
  const mapShot = (): Promise<Buffer> => page.screenshot({ clip: { x: map.x, y: map.y, width: map.width, height: map.height } });
  const plain = await mapShot();
  /** Presses twice, and says whether the heatmap came on after the first press and was off again after the second. */
  const heatmapToggledBy = async (press: () => Promise<unknown>): Promise<boolean> => {
    await press();
    await page.waitForTimeout(300);
    const heated = await mapShot();
    await press();
    await page.waitForTimeout(300);
    return !plain.equals(heated) && plain.equals(await mapShot());
  };
  check('H shows the heatmap and hides it again', await heatmapToggledBy(() => page.keyboard.press('h')));
  // With the Korean input source on, Chrome reports the H key as 'Process': only its code says which key it was.
  const processedH = (): Promise<unknown> =>
    page.evaluate(() =>
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Process', code: 'KeyH', keyCode: 229, bubbles: true })),
    );
  check('H toggles the heatmap when it is reported as key "Process", code "KeyH"', await heatmapToggledBy(processedH));

  // With Cmd, Ctrl or Alt down a key is the system's or the browser's shortcut (Cmd+H, Ctrl+1), not a command to the game.
  for (const modifier of ['Meta', 'Control', 'Alt']) {
    await page.keyboard.down(modifier);
    await page.keyboard.press('3');
    await page.keyboard.press('h');
    await page.keyboard.up(modifier);
  }
  await page.waitForTimeout(300);
  check(
    'the speed and heatmap keys pressed with Cmd, Ctrl or Alt do nothing',
    (await status()).run.speed === 1 && plain.equals(await mapShot()),
  );
  await agent.call('dev_play');

  await page.keyboard.press('Escape');
  check('Escape clears the selection', await waitUntil(async () => (await textOf('#panel')).includes('시설을 클릭하면')));
  await clickOn('#feed .item', 'DA에 펌웨어');
  check('clicking a deploy in the feed selects its board', await waitUntil(async () => (await textOf('#panel h2')) === '데이터센터 DA'));

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
  check(
    'the feed offers a toggle for a lost agent, on by default',
    untouched.some(([name, on]) => name === '에이전트 끊김' && on),
    JSON.stringify(untouched),
  );
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
  await agent.call('dev_pause');

  // ---- A raid: the facility is wrecked, repaired, and its board rebuilt, each paid for on its own (10-10 spec §6) ----
  // The plant gets a T2 board whose firmware acts on every tick: machine labour is the loudest EMF for the money (10-10 spec §5), and
  // an output of 0 burns no fuel. The datacenter sleeps, so that the plant is the strongest target.
  await select('P', '발전소 P');
  await clickOn('#panel button', '보드 설치');
  await waitUntil(async () => (await textOf('#panel')).includes('T1 보드'));
  await clickOn('#panel button', '통신 모듈');
  check('the plant takes a board and a comm module too (T2)', await waitUntil(async () => (await boardOf('P'))?.tier === 2));
  // The editor moves to another board without a close: what was typed for the first is kept as its draft.
  await select('DA', '데이터센터 DA');
  await clickOn('#panel button', '편집');
  await waitUntil(async () => (await code()).includes('function tick'));
  await clickOn('#editor-window .cm-content');
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.insertText('\n-- for DA');
  await select('P', '발전소 P');
  await clickOn('#panel button', '편집');
  // P has no firmware: its editor opens on the starting one once P's inspection comes, and until then shows no code at all.
  const movedToP = await waitUntil(async () => {
    const text = await code();
    return (await textOf('#editor-window header b')) === 'P 펌웨어' && text.includes('function tick') && !text.includes('-- for DA');
  });
  await select('DA', '데이터센터 DA');
  await clickOn('#panel button', '편집');
  check(
    "the editor moved to another board keeps the first board's text as its draft",
    movedToP &&
      (await waitUntil(async () => (await textOf('#editor-window header b')) === 'DA 펌웨어' && (await code()).includes('-- for DA'))),
    `moved to P: ${movedToP}; ${await code()}`,
  );
  await clickOn('#editor-window button', '×');
  await select('P', '발전소 P');
  await agent.call('deploy_firmware', { board: 'P', code: 'function tick(io) io.set_thermal(0) end' });
  await agent.call('deploy_firmware', { board: 'DA', code: 'function tick(io) io.sleep(40) end' });
  check(
    'a raid comes to the noisy plant',
    await runUntilAlert('raid', scenario.time.seasonDays * scenario.time.secondsPerDay),
    `at ${(await status()).time.seconds} s`,
  );
  await run(1); // a group picks its target on its first step
  await bothPhases('9-raid', "the Luddites' path", mapRect, RED, 100);
  check('the Luddites wreck a facility', await runUntilAlert('wrecked', 60));
  const wreckedRow = (await boards()).find((b) => b.condition === 'wrecked');
  check(
    'they wreck the noisy plant, and its board with it',
    wreckedRow?.id === 'P' && wreckedRow.board?.status === 'destroyed',
    JSON.stringify(wreckedRow),
  );
  const target = wreckedRow ?? { id: 'P', kind: 'power' as const };
  await waitUntil(async () => (await centerOf('#feed .item', '부서졌어요')) !== null); // the page draws what the server just announced a moment later
  await page.keyboard.press('Escape'); // the plant is selected: the alert must select it again on its own
  must(await waitUntil(async () => (await textOf('#panel')).includes('시설을 클릭하면')), 'Escape clears the selection');
  await clickOn('#feed .item', '부서졌어요');
  const repairCost = tuning.repair.cost[target.kind];
  const repairLabel = `시설 복구 (${repairCost.toLocaleString('en-US')} · ${hours(tuning.repair.seconds)}시간)`;
  check(
    'the alert opens the wrecked facility, which offers its repair',
    await waitUntil(async () => (await buttonNamed('#panel', '시설 복구'))?.text === repairLabel),
    `wanted "${repairLabel}", got ${JSON.stringify(await buttonNamed('#panel', '시설 복구'))}`,
  );
  check(
    'a wrecked facility says so, and has no hand controls',
    (await textOf('#panel')).includes('● 부서짐') && (await page.locator('#panel .controls').count()) === 0,
  );
  await shot('10-wrecked');
  const beforeRepair = await status();
  await clickOn('#panel button', '시설 복구');
  check(
    'the repair starts at once and takes its cost, and no game time passes',
    (await waitUntil(async () => (await textOf('#panel')).includes('복구 중'))) &&
      (await status()).money === beforeRepair.money - repairCost &&
      (await status()).time.seconds === beforeRepair.time.seconds,
  );
  await shot('11-repairing');
  await run(tuning.repair.seconds + 1);
  const rebuildLabel = `보드 재건 (${tuning.rebuild.cost.toLocaleString('en-US')} · ${hours(tuning.rebuild.seconds)}시간)`;
  check(
    'once the facility stands, its board offers its rebuild, paid for on its own',
    await waitUntil(async () => {
      const button = await buttonNamed('#panel', '보드 재건');
      return button?.text === rebuildLabel && !button.disabled;
    }),
    `wanted "${rebuildLabel}", got ${JSON.stringify(await buttonNamed('#panel', '보드 재건'))}`,
  );
  check(
    'the repaired facility works by hand again, while its board still reads 파괴',
    (await page.locator('#panel .controls').count()) === 1 && (await textOf('#panel')).includes('● 파괴'),
  );
  await clickOn('#panel button', '보드 재건');
  check('the rebuild starts', await waitUntil(async () => (await textOf('#panel')).includes('재건 중')));
  await run(tuning.rebuild.seconds + 1);
  const rebuilt = await boardOf(target.id);
  check(
    'the board comes back with its comm module (T2)',
    rebuilt?.condition === 'ok' && rebuilt.tier === 2 && rebuilt.board?.status === 'running',
    JSON.stringify(rebuilt),
  );
  await shot('12-rebuilt');

  // ---- Food by hand: a harvest, a truck to collect it, and a truck to deliver it (10-10 spec §4.3, contract §9) ----
  await newSeason();
  await run(tuning.farm.ripenSeconds + 1);
  // The three farms side by side, ripe: their captions are at their widest ("100%"), and each must stay within its own cell's width.
  await page.keyboard.press('Escape'); // nothing selected: no other label on the map
  await waitUntil(async () => (await textOf('#panel')).includes('시설을 클릭하면'));
  await page.waitForTimeout(300); // the map draws on its next frame
  const farms = ['F1', 'F2', 'F3'].map(cellOf);
  const [firstFarm] = farms;
  if (!firstFarm) throw new Error('no farms');
  const captionRow = {
    x: Math.round(map.x + firstFarm[0] * CELL),
    y: Math.round(map.y + (firstFarm[1] + 1) * CELL + 2),
    width: farms.length * CELL + CELL,
    height: 20,
  };
  const runs = await columnRuns(await page.screenshot(), captionRow, CAPTION);
  check(
    'the three adjacent farms each show their own caption, apart from the next one',
    runs.length === farms.length &&
      runs.every(([first, last], k) => Math.abs(first - k * CELL) <= 2 && last - first >= 10 && last < (k + 1) * CELL),
    `caption boxes at columns ${JSON.stringify(runs)} of the row under F1, F2, F3; cells start every ${CELL} px`,
  );
  await shot('13-farms-ripe');
  await select('F1', '밭 F1');
  check('a ripe farm offers [수확]', await waitUntil(async () => (await buttonNamed('#panel', '수확'))?.disabled === false));
  await clickOn('#panel button', '수확');
  const crop = Math.min(tuning.farm.yield, tuning.farm.outboxCapacity);
  check(
    '[수확] puts the crop in the outbox',
    await waitUntil(async () => /출고함\s*(\d+)/.exec(await textOf('#panel'))?.[1] === String(crop)),
    (await textOf('#panel')).slice(0, 160),
  );
  await select('W', '물류창고 W');
  const capacity = tuning.warehouse.truckCapacity;
  /** The truck form: truck 1, a trip, and the largest load, picked with its buttons, then [보내기]. */
  const send = async (trip: string): Promise<void> => {
    await clickOn('#panel button', '1번 트럭');
    await clickOn('#panel button', trip);
    await clickOn('#panel button', String(capacity), true); // exactly: a trip's label can hold the same number
    await waitUntil(async () => (await buttonNamed('#panel', '보내기'))?.disabled === false);
    await clickOn('#panel button', '보내기');
  };
  await send('F1에서 회수');
  check(
    'the truck form sends a truck to collect from the farm',
    await waitUntil(async () => (await textOf('#panel')).includes('1번 트럭: F1(으)로 가는 중')),
    (await textOf('#panel')).slice(0, 200),
  );
  await run(1);
  // The warehouse shows the routes its trucks are on; a farm no truck serves shows none.
  const routePixels = async (): Promise<number> => {
    await page.waitForTimeout(300); // the map draws on its next frame
    return countPixels(await page.screenshot(), mapRect, ROUTE);
  };
  const withRoute = await routePixels();
  await select('F2', '밭 F2');
  const withoutRoute = await routePixels();
  check(
    "the warehouse selected shows its truck's route, and a farm the truck does not serve does not",
    withRoute - withoutRoute >= 300,
    `${withRoute} route pixels with W selected, ${withoutRoute} with F2`,
  );
  await select('W', '물류창고 W');
  await shot('14-truck-out');
  const [fx, fy] = cellOf('F1');
  const [wx, wy] = cellOf('W');
  await run((2 * (Math.abs(fx - wx) + Math.abs(fy - wy))) / tuning.warehouse.truckCellsPerSecond); // out and back
  const collected = Math.min(crop, capacity);
  check(
    'the truck comes back, and the crop goes into the stock',
    await waitUntil(async () => Number(/재고\s*(\d+)/.exec(await textOf('#panel'))?.[1] ?? 0) >= collected - 1),
    (await textOf('#panel')).slice(0, 200),
  );
  await send('H1에 전달');
  check(
    'the truck form sends a truck to deliver to a housing block, with the stock aboard',
    await waitUntil(async () => (await textOf('#panel')).includes('1번 트럭: H1(으)로 가는 중')),
  );
  // The homes only eat, so their food goes up only when the truck unloads.
  let delivered = false;
  for (let k = 0; k < 60 && !delivered; k++) {
    const food = (await status()).food.housing;
    await run(0.5);
    delivered = (await status()).food.housing > food;
  }
  check('the truck unloads at the housing block: the homes have more food', delivered);
  check('then it turns back, empty', await waitUntil(async () => (await textOf('#panel')).includes('1번 트럭: H1에서 돌아오는 중')));

  // ---- Money running out: the most fuel, and nothing earning ----
  await newSeason();
  await select('P', '발전소 P');
  await page.locator('#panel input[type=range]').fill(String(thermalMax));
  const farmPrice = tuning.install.boardPrice.farm;
  for (let k = 0; k < 60 && (await status()).money >= farmPrice; k++) await run(5);
  await select('F1', '밭 F1');
  const poor = await status();
  check(
    'with too little money the board button is disabled, and the panel says why',
    await waitUntil(
      async () => (await buttonNamed('#panel', '보드 설치'))?.disabled === true && (await textOf('#panel')).includes('자금이 모자라요'),
    ),
    `money ${poor.money}, price ${farmPrice}: ${JSON.stringify(await buttonNamed('#panel', '보드 설치'))}`,
  );
  await shot('15-too-poor');
  for (let k = 0; k < 60 && (await status()).money >= 0; k++) await run(5);
  const broke = await status();
  check('the money is below zero and the season goes on', broke.money < 0 && broke.ended === null, `money ${broke.money}`);
  await expectTopBar('money below zero', broke, BAD, WHITE);
  await shot('16-money-below-zero');

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
  await shot('17-season-ended');
  await agent.disconnect();
  await page.waitForTimeout(600);
  check('with no agent the overlay\'s "새 시즌" is still enabled', (await buttonNamed('#overlay', '새 시즌'))?.disabled === false);
  await clickOn('#overlay button', '새 시즌');
  check(
    'the overlay\'s "새 시즌" starts a season with no agent',
    await waitUntil(async () => !(await isShown('#overlay')) && (await clockLabel()).startsWith('1일차 00:00'), 5000),
  );

  // ---- A lost agent: an alert, and the default auto-pause (10-10 spec §8) ----
  agent = await connectAgent('shots-2');
  await waitUntil(async () => (await textOf('#topbar')).includes('에이전트 연결 (shots-2)'));
  await agent.call('dev_play');
  must(await waitUntil(async () => (await textOf('#topbar .speed button')) === '⏸'), 'the game runs before the agent drops');
  await agent.disconnect();
  check(
    'an agent that drops raises an alert, and the game pauses by itself',
    await waitUntil(
      async () => (await textOf('#feed')).includes('에이전트 연결이 끊겼어요') && (await textOf('#topbar .speed button')) === '▶',
      8000,
    ),
  );
  await shot('18-agent-lost');
  await page.keyboard.press('Space');
  check('play goes on without an agent', await waitUntil(async () => (await textOf('#topbar .speed button')) === '⏸'));

  // ---- The server goes away with the game on the screen: the page says so ----
  serverClosed = true;
  await server.close();
  check(
    'the game screen says when the server is gone',
    await waitUntil(async () => (await textOf('#notice')).includes('게임 서버에 연결할 수 없어요'), 4000),
    `the notice says "${await textOf('#notice')}"`,
  );
  await shot('19-server-lost');
} finally {
  for (const agent of agents) await agent.disconnect().catch(() => undefined);
  await browser.close();
  if (!serverClosed) await server.close();
  rmSync(configDir, { recursive: true, force: true }); // the token it holds belongs to this run only
}
if (failures.length > 0) {
  process.stderr.write(`${failures.length} check(s) failed: ${failures.join('; ')}\n`);
  process.exitCode = 1;
}
