import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { ALERT_KINDS, type BoardKind, boardManual, parseScenario, pathTo } from '@turing-city/core';
import { type Browser, chromium, type Page } from 'playwright-core';
import { loadConfig } from '../src/config.ts';
import { startGameServer } from '../src/game-server.ts';

/**
 * pnpm shots: the real viewer in headless Chrome, against a real server and a scripted agent. It writes screenshots to
 * scratch/shots, to be looked at, and runs the checks that need a browser. A failed check ends the run with exit code 1.
 *
 * The player's part is played in the page with real clicks and keys: the hand controls, installs, the manual, the editor, repairs
 * and rebuilds. The scripted agent uses the board tools a player's agent has at T2, and the dev tools for time and seasons. *
 * What the map's WebGL drawing hides (where each text went) is read from a second viewer in a Chrome without WebGL, where Phaser draws
 * with its 2D canvas renderer (see mapTexts). Where the player's screens are not as they should be, the check stays failing.
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
const browser = await chromium.launch({ channel: 'chrome', headless: true });
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
/** An outbound truck's route: the trucks' colour at 0.9 opacity on the ground (map-scene.ts draws a returning leg fainter). */
const ROUTE = blend(TRUCK, GROUND, 0.9);
/** A repair's hatch lines (0xffb020 at 0.8, map-scene.ts) over the grey a facility that is down is filled with (0x2a2f36 at 0.55 over the ground). */
const HATCH = blend([0xff, 0xb0, 0x20], blend([0x2a, 0x2f, 0x36], GROUND, 0.55), 0.8);

/** A second page, in a context of its own, that only decodes PNGs: the browser reads the pixels, so no image library is needed. */
const decoder = await (await browser.newContext()).newPage();

/** How many pixels of the PNG inside the rectangles (counted together) are within the tolerance of the colour. */
function countPixelsIn(png: Buffer, rects: readonly Rect[], rgb: Rgb, tolerance = 12): Promise<number> {
  return decoder.evaluate(
    async ({ base64, rects, rgb, tolerance }) => {
      const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob());
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext('2d');
      if (!context) throw new Error('no 2d context');
      context.drawImage(bitmap, 0, 0);
      let count = 0;
      for (const rect of rects) {
        const { data } = context.getImageData(rect.x, rect.y, rect.width, rect.height);
        for (let i = 0; i < data.length; i += 4) {
          if (
            Math.abs(data[i]! - rgb[0]) <= tolerance &&
            Math.abs(data[i + 1]! - rgb[1]) <= tolerance &&
            Math.abs(data[i + 2]! - rgb[2]) <= tolerance
          )
            count += 1;
        }
      }
      return count;
    },
    { base64: png.toString('base64'), rects, rgb, tolerance },
  );
}

/** How many pixels of the PNG inside the rectangle are within the tolerance of the colour. */
const countPixels = (png: Buffer, rect: Rect, rgb: Rgb, tolerance = 12): Promise<number> => countPixelsIn(png, [rect], rgb, tolerance);

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

/** A text the map drew, with the box it covers, in the map canvas's pixels. */
interface MapText {
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Runs in the page, before the game's own code: records every text of the map's last frame. Phaser's WebGL renderer leaves no
 * trace of where a text went, but its 2D canvas renderer draws each text as a drawImage of the text's own canvas, with the text
 * lines drawn into that canvas just before, so the page can say what was drawn and where. (A function of its own: Playwright
 * sends its source to the page, so it takes nothing from this file.)
 */
function recordTexts(): void {
  const w = window as unknown as { __mapFrame: unknown[] };
  w.__mapFrame = [];
  let current: unknown[] = [];
  const lines = new Map<HTMLCanvasElement, string[]>();
  const proto = CanvasRenderingContext2D.prototype;
  const { fillText, fillRect, clearRect, drawImage } = proto;
  /** A frame starts where the renderer clears the whole map canvas: what was drawn since the last clear is the last whole frame. */
  const startFrame = (): void => {
    if (current.length > 0) w.__mapFrame = current;
    current = [];
  };
  proto.clearRect = function (this: CanvasRenderingContext2D, x: number, y: number, width: number, height: number): void {
    if (this.canvas.isConnected && width >= this.canvas.width && height >= this.canvas.height) startFrame();
    clearRect.call(this, x, y, width, height);
  };
  proto.fillRect = function (this: CanvasRenderingContext2D, x: number, y: number, width: number, height: number): void {
    // A text starts its own canvas with its background; the map's canvas starts a frame with one over the whole of it.
    if (!this.canvas.isConnected) lines.set(this.canvas, []);
    else if (width >= this.canvas.width && height >= this.canvas.height) startFrame();
    fillRect.call(this, x, y, width, height);
  };
  proto.fillText = function (this: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth?: number): void {
    lines.get(this.canvas)?.push(text);
    if (maxWidth === undefined) fillText.call(this, text, x, y);
    else fillText.call(this, text, x, y, maxWidth);
  };
  proto.drawImage = function (this: CanvasRenderingContext2D, image: CanvasImageSource, ...rest: number[]): void {
    const text = image instanceof HTMLCanvasElement ? lines.get(image) : undefined;
    if (this.canvas.isConnected && image instanceof HTMLCanvasElement && text !== undefined && rest.length === 8) {
      const m = this.getTransform();
      const [, , , , dx = 0, dy = 0, dw = 0, dh = 0] = rest;
      current.push({ text: text.join('\n'), x: m.e + dx * m.a, y: m.f + dy * m.d, width: dw * m.a, height: dh * m.d });
    }
    (drawImage as (...args: unknown[]) => void).call(this, image, ...rest);
  } as typeof proto.drawImage;
}

/** Whether two boxes cover each other by more than a pixel in both directions (a hair's overlap of two lines' boxes is not a collision). */
const overprints = (a: MapText, b: MapText): boolean =>
  Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > 1 && Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > 1;

/** The texts the map draws now, as a second viewer in a Chrome without WebGL sees them; `selected` is the facility it clicks first. */
const flatBrowser: { current: Browser | null } = { current: null };
async function mapTexts(selected: string | null): Promise<MapText[]> {
  flatBrowser.current ??= await chromium.launch({ channel: 'chrome', headless: true, args: ['--disable-webgl', '--disable-3d-apis'] });
  const flat: Page = await flatBrowser.current.newPage({ viewport: { width: 1320, height: 860 } });
  try {
    await flat.addInitScript(recordTexts);
    await flat.goto(server.url);
    const canvas = flat.locator('#map canvas');
    await canvas.waitFor();
    const box = await canvas.boundingBox();
    if (selected !== null && box) {
      const [x, y] = cellOf(selected);
      await flat.mouse.click(box.x + x * CELL + CELL / 2, box.y + y * CELL + CELL / 2);
    }
    await flat.waitForTimeout(400); // a few frames
    return await flat.evaluate(() => (window as unknown as { __mapFrame: MapText[] }).__mapFrame);
  } finally {
    await flat.close();
  }
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
  let agent: Agent = await connectAgent('claude-code'); // a real agent's name: the top bar's longest agent label
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

  /**
   * The top bar is one line of nine items (white-space: nowrap), and the window is 1320 px: nothing of it may run past the window or
   * out of the bar, whatever the numbers say (an outage, hunger, a connected agent). Not redesigned here: an overflow is reported.
   */
  const expectTopBarFits = async (what: string): Promise<void> => {
    const bar = await page.evaluate(() => {
      const root = document.querySelector<HTMLElement>('#topbar');
      if (!root) return null;
      const items = [...root.children] as HTMLElement[];
      const boxes = items.map((i) => i.getBoundingClientRect());
      const lastRight = Math.round(boxes.at(-1)?.right ?? 0);
      // The agent's label is pushed to the right edge (margin-left: auto): what is left between it and the tools before it.
      const spare = Math.round((boxes.at(-1)?.left ?? 0) - (boxes.at(-2)?.right ?? 0) - 18);
      return {
        nowrap: getComputedStyle(root).whiteSpace === 'nowrap',
        items: items.length,
        // The items are centred in the bar: on one row their middles agree, on a wrapped one they are a row apart.
        middles: Math.round(Math.max(...boxes.map((b) => (b.top + b.bottom) / 2)) - Math.min(...boxes.map((b) => (b.top + b.bottom) / 2))),
        spare,
        scrollWidth: root.scrollWidth,
        clientWidth: root.clientWidth,
        lastRight,
        pageScrollWidth: document.documentElement.scrollWidth,
        windowWidth: window.innerWidth,
        text: root.textContent ?? '',
      };
    });
    if (!bar) throw new Error('the top bar is missing');
    check(
      `${what}: the top bar is one line of nine items`,
      bar.nowrap && bar.items === 9 && bar.middles <= 3,
      `nowrap ${bar.nowrap}, ${bar.items} items, their middles ${bar.middles} px apart`,
    );
    check(
      `${what}: nothing of the top bar runs past the window`,
      bar.scrollWidth <= bar.clientWidth && bar.lastRight <= bar.windowWidth && bar.pageScrollWidth <= bar.windowWidth,
      `bar ${bar.scrollWidth} of ${bar.clientWidth} px, last item ends at ${bar.lastRight} of ${bar.windowWidth}, page ${bar.pageScrollWidth}, ${bar.spare} px to spare: ${bar.text}`,
    );
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
  // The tick on the card survives the page's renders while the clock runs: it is redrawn about 20 times a second.
  await clickOn('#guide label', '다시 보지 않기');
  const rendersBeforeTick = snapshotFrames;
  await agent.call('dev_play');
  await page.waitForTimeout(1200);
  const ticks = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLInputElement>('#guide input[type=checkbox]')].map((box) => box.checked),
  );
  check(
    'the tick on "다시 보지 않기" survives the page redrawing while the clock runs: the one box is still ticked',
    ticks.length === 1 && ticks[0] === true && snapshotFrames - rendersBeforeTick >= 10,
    `boxes ticked: ${JSON.stringify(ticks)}, ${snapshotFrames - rendersBeforeTick} snapshots arrived`,
  );
  await agent.call('dev_pause');
  await page.keyboard.press('Escape');
  check('Escape closes it', await waitUntil(async () => !(await isShown('#guide'))));

  // ---- The town at T0: every facility runs by hand, none has a board ----
  const map = await page.locator('#map canvas').boundingBox();
  if (!map) throw new Error('the map canvas is missing');
  const mapRect = { x: Math.round(map.x), y: Math.round(map.y), width: Math.round(map.width), height: Math.round(map.height) };
  /** A facility's cell in the page's pixels. */
  const cellBox = (id: string): Rect => {
    const [x, y] = cellOf(id);
    return { x: Math.round(map.x + x * CELL), y: Math.round(map.y + y * CELL), width: CELL, height: CELL };
  };
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
  await expectTopBarFits('the town at T0 (an outage, an agent connected)');
  // The idle trucks wait in the warehouse's cell, in a colour that shows against the warehouse's own.
  const warehouseCell = cellBox('W');
  const waiting = await countPixels(await page.screenshot(), warehouseCell, TRUCK);
  check(
    "the idle trucks are visible in the warehouse's cell",
    waiting >= 30 * tuning.warehouse.trucks,
    `${waiting} truck-coloured pixels for ${tuning.warehouse.trucks} trucks`,
  );
  // The three farms stand side by side, and their captions are wider than a cell: each must be whole, and none over another.
  const texts = await mapTexts(null);
  const farms = scenario.facilities.filter((f) => f.kind === 'farm');
  const captions = farms.map((f) =>
    texts.find(
      (t) => /^\d+% · \d+$/.test(t.text) && Math.abs(t.x - f.x * CELL) < 1 && t.y >= (f.y + 1) * CELL && t.y < (f.y + 1) * CELL + 14,
    ),
  );
  check(
    "each farm's caption (ripeness and outbox) is drawn under its cell",
    farms.length === 3 && captions.every((c) => c !== undefined),
    JSON.stringify(captions),
  );
  const shown = captions.filter((c): c is MapText => c !== undefined);
  check(
    "the captions are whole: inside the map's canvas, and a readable width",
    shown.length === farms.length &&
      shown.every((c) => c.x >= 0 && c.y >= 0 && c.x + c.width <= map.width && c.y + c.height <= map.height && c.width >= 25),
    JSON.stringify(shown),
  );
  const printedOver = shown.flatMap((c) => texts.filter((t) => t !== c && overprints(c, t)).map((t) => `${c.text} over ${t.text}`));
  check(
    "the adjacent farms' captions overprint neither each other nor any other text of the map",
    shown.length === farms.length && printedOver.length === 0,
    printedOver.join('; '),
  );
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
  // With the thermal module at its most the town has power to spare: no outage, no hunger, a connected agent.
  await run(1);
  check(
    'with the plant at its most the town is calm: no outage in the top bar',
    await waitUntil(async () => !(await textOf('#topbar')).includes('정전')),
    (await textOf('#topbar')).slice(0, 160),
  );
  await expectTopBarFits('a calm town (an agent connected)');
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
  // Where the [처리] button and the top bar's tools sit, press after press: the user's playtest found both jumping as rows and
  // numbers came and went, which moved the button away from the pointer.
  const places = new Set<string>();
  const placeOf = (): Promise<string> =>
    page.evaluate(() => {
      const button = [...document.querySelectorAll<HTMLButtonElement>('#panel button')].find((b) => b.textContent === '처리');
      const tools = document.querySelector('#topbar .tools');
      const r = (e: Element | null | undefined) =>
        e ? `${Math.round(e.getBoundingClientRect().x)},${Math.round(e.getBoundingClientRect().y)}` : '-';
      return `${r(button)} ${r(tools)}`;
    });
  for (let k = 0; k < 14; k++) {
    await clickOn('#panel button', '처리');
    places.add(await placeOf());
    await page.waitForTimeout(150);
    places.add(await placeOf());
    if ((await textOf('#panel .dc-status')).includes('처리 중')) processing = true;
  }
  await agent.call('dev_pause');
  await page.waitForTimeout(300);
  const hot = await tempOf();
  check(
    'mashing [처리] keeps the datacenter processing, says so under the buttons, and it heats up',
    processing && hot > cold,
    `${cold} -> ${hot} °C`,
  );
  check('mashing [처리] moves neither the button nor the top bar', places.size === 1, [...places].join(' | '));
  await run(1); // the last press's job ends
  await clickOn('#panel button', '냉각');
  check(
    '[냉각] starts a cycle, and the button waits for its end, the line under it saying why',
    await waitUntil(async () => {
      const button = await buttonNamed('#panel', '냉각');
      return button?.disabled === true && (await textOf('#panel .dc-status')).includes('냉각 중');
    }),
    JSON.stringify(await buttonNamed('#panel', '냉각')),
  );
  await shot('4-datacenter-by-hand');
  await run(tuning.datacenter.coolingCycleMs / 1000 + 0.5);
  const cooled = await tempOf();
  check(
    'when the cycle ends, the button is back and the datacenter is cooler',
    (await waitUntil(async () => (await buttonNamed('#panel', '냉각'))?.disabled === false)) && cooled < hot,
    `${hot} -> ${cooled} °C`,
  );

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
    await clickOn('#editor-window .cm-editor'); // not .cm-content: a long text makes that taller than the window, and its middle is off the screen
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
  // A deploy the game refuses: a source over 64 KB, as when a whole project is pasted in. The answer is an error with no deployResult,
  // and the result line must turn from "보내는 중…" into its Korean text, not wait for ever.
  await setCode(`-- ${'x'.repeat(77)}\n`.repeat(900));
  await clickOn('#editor-window button', '배포');
  check(
    'a deploy the game refuses shows its Korean refusal on the editor\'s result line, in place of "보내는 중…"',
    await waitUntil(async () => (await result()).startsWith('서버가 알아듣지 못하는 명령이에요')),
    `the line says "${(await result()).slice(0, 120)}"`,
  );
  check(
    'the refusal reads as a failure: the result line is in the bad style',
    await page.evaluate(() => document.querySelector('#editor-window .result')?.classList.contains('bad') === true),
  );
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
  // Escape works from inside the code, with the focus where the player types. With text selected, the first press is CodeMirror's:
  // it only collapses the selection. The next closes the editor, which keeps its text as a draft.
  await clickOn('#editor-window .cm-content');
  await page.keyboard.press('ControlOrMeta+A');
  const selectedChars = (): Promise<number> => page.evaluate(() => window.getSelection()?.toString().length ?? 0);
  const selectedBefore = await selectedChars();
  await page.keyboard.press('Escape');
  check(
    'with text selected in the code, the first Escape only collapses the selection',
    selectedBefore > 20 && (await selectedChars()) === 0 && (await isShown('#editor-window')),
    `${selectedBefore} characters selected, then ${await selectedChars()}`,
  );
  await page.keyboard.press('Escape');
  check(
    'the second Escape closes the editor from inside the code, and leaves the manual open',
    await waitUntil(async () => !(await isShown('#editor-window')) && (await isShown('#manual-window'))),
  );
  await clickOn('#panel button', '편집');
  check(
    'the editor Escape closed has kept its text as a draft',
    await waitUntil(async () => (await isShown('#editor-window')) && (await code()).includes('-- half-typed')),
    await code(),
  );
  // With nothing selected, one Escape closes it, wherever the focus is in the code.
  await page.keyboard.press('Escape');
  check(
    'with nothing selected, one Escape closes the editor from inside the code',
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
  await agent.call('deploy_firmware', { board: 'DA', code: 'function tick(io) local board = nil; return board.id end' });
  check(
    "the agent's deploy reaches the T2 board, and the feed says the agent made it",
    await waitUntil(async () => (await textOf('#feed')).includes('에이전트: DA에 펌웨어 v2 배포')),
  );
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
  const togglePins = [
    '러다이트 출현',
    '러다이트 접근',
    '시설 파괴',
    '화재',
    '과열',
    '정전',
    '굶주림',
    '펌웨어 에러',
    '자금 마이너스',
    '에이전트 끊김',
  ];
  check(
    "the feed's auto-pause toggles are the alert kinds but the season's end: ten, a lost agent among them",
    untouched.length === ALERT_KINDS.length - 1 && JSON.stringify(untouched.map(([name]) => name)) === JSON.stringify(togglePins),
    JSON.stringify(untouched.map(([name]) => name)),
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
  check(
    'a wrecked facility offers no board rebuild yet: the repair comes first',
    (await buttonNamed('#panel', '보드 재건')) === null,
    JSON.stringify(await buttonNamed('#panel', '보드 재건')),
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
  check(
    'a facility under repair offers no board rebuild either',
    (await buttonNamed('#panel', '보드 재건')) === null,
    JSON.stringify(await buttonNamed('#panel', '보드 재건')),
  );
  // The hatch of a repair runs across the whole cell: every quarter of it holds hatch lines (the colour of a repair, 0.8 over the grey).
  await page.waitForTimeout(300);
  const repairCell = cellBox(target.id);
  const half = CELL / 2;
  const quarters = [0, 1].flatMap((row) =>
    [0, 1].map((col) => ({ x: repairCell.x + col * half, y: repairCell.y + row * half, width: half, height: half })),
  );
  const hatchPng = await page.screenshot();
  const hatched: number[] = [];
  for (const quarter of quarters) hatched.push(await countPixels(hatchPng, quarter, HATCH, 40));
  check(
    'a repairing facility is hatched across the whole cell, every quarter of it',
    hatched.every((n) => n >= 8),
    `hatch pixels in the quarters (top left, top right, bottom left, bottom right): ${hatched.join(', ')}`,
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
  await select('F1', '밭 F1');
  const unripe = await buttonNamed('#panel', '수확');
  check(
    '[수확] is disabled while the crop is not ripe, and says how far along it is',
    unripe?.disabled === true && (await textOf('#panel .reason')).startsWith('아직 익지 않았어요 ('),
    `${JSON.stringify(unripe)}: ${await textOf('#panel .reason')}`,
  );
  await clickOn('#panel button', '수확'); // a press on a disabled button does nothing
  await page.waitForTimeout(200);
  check('a press on the disabled [수확] harvests nothing', /출고함\s*(\d+)/.exec(await textOf('#panel'))?.[1] === '0');
  await run(tuning.farm.ripenSeconds + 1);
  check(
    'a ripe farm offers [수확], with no reason against it',
    (await waitUntil(async () => (await buttonNamed('#panel', '수확'))?.disabled === false)) &&
      (await page.locator('#panel .reason').count()) === 0,
  );
  await clickOn('#panel button', '수확');
  const crop = Math.min(tuning.farm.yield, tuning.farm.outboxCapacity);
  check(
    '[수확] puts the crop in the outbox',
    await waitUntil(async () => /출고함\s*(\d+)/.exec(await textOf('#panel'))?.[1] === String(crop)),
    (await textOf('#panel')).slice(0, 160),
  );
  await select('F2', '밭 F2'); // the second farm's crop, for the second truck
  await clickOn('#panel button', '수확');
  check(
    "the second farm's crop is in its outbox too",
    await waitUntil(async () => /출고함\s*(\d+)/.exec(await textOf('#panel'))?.[1] === String(crop)),
  );
  await select('W', '물류창고 W');
  const capacity = tuning.warehouse.truckCapacity;
  /** The truck form: a truck, a trip, and the largest load, picked with its buttons, then [보내기]. */
  const send = async (trip: string, truck = 1): Promise<void> => {
    await clickOn('#panel button', `${truck}번 트럭`);
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
  await shot('13-truck-out');
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
  // The second truck goes to collect from F2 while the first is on its way to H1: both are out, and none is left to send.
  await send('F2에서 회수', 2);
  check(
    'the truck form sends the second truck to the second farm',
    await waitUntil(async () => (await textOf('#panel')).includes('2번 트럭: F2(으)로 가는 중')),
  );
  const noTruck = await buttonNamed('#panel', '보내기');
  check(
    'with every truck out, [보내기] is disabled and says there is no idle truck',
    noTruck?.disabled === true && (await textOf('#panel .reason')) === '대기 중인 트럭이 없어요',
    `${JSON.stringify(noTruck)}: ${await textOf('#panel .reason')}`,
  );
  await shot('13b-two-trucks-out');
  // Both trucks stand in the warehouse's cell, side by side, each with its label (number, where to, load): none may print over another text.
  const withTrucks = await mapTexts(null);
  const truckLabels = withTrucks.filter((t) => /^\d[→←]/.test(t.text));
  const truckOver = truckLabels.flatMap((a) =>
    withTrucks.filter((b) => b !== a && overprints(a, b)).map((b) => `"${a.text}" over "${b.text}"`),
  );
  check(
    'the labels of two trucks that share a cell overprint neither each other nor any other text of the map',
    truckLabels.length === 2 && truckOver.length === 0,
    `${truckLabels.map((t) => `"${t.text}" at ${Math.round(t.x)},${Math.round(t.y)} (${Math.round(t.width)} wide)`).join(', ')}; ${truckOver.join('; ')}`,
  );

  // The routes follow the selection (10-09 spec §8.2): the warehouse shows every route its trucks are on, a farm only the collections
  // from it, a housing block only the deliveries to it, and nothing else shows one. Each route is judged on the cells it alone crosses.
  const standing = new Set(scenario.facilities.map((f) => `${f.x},${f.y}`));
  const cellsOfRoute = (from: string, to: string): Array<[number, number]> => {
    const [ax, ay] = cellOf(from);
    const [bx, by] = cellOf(to);
    return [[ax, ay], ...pathTo(ax, ay, bx, by)];
  };
  const toH1 = cellsOfRoute('W', 'H1');
  const toF2 = cellsOfRoute('W', 'F2');
  const alone = (mine: Array<[number, number]>, other: Array<[number, number]>): Array<[number, number]> =>
    mine.filter(([x, y]) => !standing.has(`${x},${y}`) && !other.some(([ox, oy]) => ox === x && oy === y));
  const onlyH1 = alone(toH1, toF2);
  const onlyF2 = alone(toF2, toH1);
  /** The 6 px squares at the centres of the cells: a route's line of 2 px passes through each. */
  const centres = (cells: Array<[number, number]>): Rect[] =>
    cells.map(([x, y]) => ({
      x: Math.round(map.x + x * CELL + CELL / 2 - 3),
      y: Math.round(map.y + y * CELL + CELL / 2 - 3),
      width: 6,
      height: 6,
    }));
  const routesSeen = async (): Promise<{ h1: number; f2: number }> => {
    await page.waitForTimeout(300);
    const png = await page.screenshot();
    return { h1: await countPixelsIn(png, centres(onlyH1), ROUTE), f2: await countPixelsIn(png, centres(onlyF2), ROUTE) };
  };
  const routeCases: Array<[string, string, boolean, boolean]> = [
    ['W', '물류창고 W', true, true],
    ['F2', '밭 F2', false, true],
    ['H1', '주거지 H1', true, false],
    ['F1', '밭 F1', false, false],
    ['H2', '주거지 H2', false, false],
    ['P', '발전소 P', false, false],
  ];
  for (const [id, title, h1, f2] of routeCases) {
    await select(id, title);
    const seen = await routesSeen();
    const shows = (n: number, cells: number): boolean => n >= 6 * cells;
    const hides = (n: number): boolean => n <= 2;
    check(
      `with ${id} selected, ${[h1 ? 'the delivery to H1' : '', f2 ? 'the collection from F2' : ''].filter(Boolean).join(' and ') || 'no route'} show${h1 && f2 ? '' : 's'}`,
      (h1 ? shows(seen.h1, onlyH1.length) : hides(seen.h1)) && (f2 ? shows(seen.f2, onlyF2.length) : hides(seen.f2)),
      `route pixels on the cells only the delivery to H1 crosses: ${seen.h1} (${onlyH1.length} cells); only the collection from F2: ${seen.f2} (${onlyF2.length} cells)`,
    );
  }
  await select('W', '물류창고 W');
  // The homes only eat, so their food goes up only when the truck unloads.
  let delivered = false;
  for (let k = 0; k < 60 && !delivered; k++) {
    const food = (await status()).food.housing;
    await run(0.5);
    delivered = (await status()).food.housing > food;
  }
  check('the truck unloads at the housing block: the homes have more food', delivered);
  check('then it turns back, empty', await waitUntil(async () => (await textOf('#panel')).includes('1번 트럭: H1에서 돌아오는 중')));

  // ---- The plant's consumers: with boards on the three farms, each consumer's label sits over its own cell ----
  for (const id of ['F1', 'F2', 'F3']) {
    await select(id, `밭 ${id}`);
    await clickOn('#panel button', '보드 설치');
    await waitUntil(async () => (await textOf('#panel')).includes('T1 보드'));
  }
  const labelled = await mapTexts('P');
  const labels = labelled.filter((t) => /^(−\d+|정전)\n\d+순위$/.test(t.text));
  const consumerCells = ['H1', 'H2', 'F1', 'F2', 'F3'];
  // Where a label belongs: its bottom edge just above its cell's top (in the top row, where there is no room, pushed down onto the cell).
  const bottomOver = (y: number, height: number): number => Math.max(y * CELL - 2, height);
  const ownLabels = consumerCells.map((id) => {
    const [x, y] = cellOf(id);
    // The label of this cell: the one at its height, and of those the nearest to its column (the farms share columns with the homes).
    const atHeight = labels.filter((l) => Math.abs(l.y + l.height - bottomOver(y, l.height)) <= 1);
    const nearest = atHeight.sort((a, b) => Math.abs(a.x - (x * CELL + 1)) - Math.abs(b.x - (x * CELL + 1)))[0];
    return { id, x, y, label: nearest };
  });
  check(
    'with the plant selected, every consumer (the homes and the three farms with boards) has a two-line label',
    ownLabels.every((c) => c.label !== undefined) && labels.length === ownLabels.length,
    JSON.stringify(labels),
  );
  const offCell = ownLabels.filter(
    ({ x, label }) => label !== undefined && !(label.x >= x * CELL - 0.5 && label.x + label.width <= (x + 1) * CELL + 0.5),
  );
  check(
    "each consumer's label sits over its own cell, within its width",
    offCell.length === 0,
    offCell.map((c) => `${c.id}: ${JSON.stringify(c.label)}`).join('; '),
  );
  const crossed = labels.flatMap((a, i) =>
    labels
      .slice(i + 1)
      .filter((b) => overprints(a, b))
      .map((b) => `${a.text.replace('\n', ' ')} over ${b.text.replace('\n', ' ')}`),
  );
  check('no two consumer labels overlap', crossed.length === 0, crossed.join('; '));
  await select('P', '발전소 P');
  await shot('13c-consumer-labels');

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
  await shot('14-too-poor');
  for (let k = 0; k < 60 && (await status()).money >= 0; k++) await run(5);
  const broke = await status();
  check('the money is below zero and the season goes on', broke.money < 0 && broke.ended === null, `money ${broke.money}`);
  await expectTopBar('money below zero', broke, BAD, WHITE);
  await shot('15-money-below-zero');
  // The homes' food runs out some days on: hunger is in the top bar too, beside the money in red.
  for (let k = 0; k < 8 && !(await textOf('#topbar')).includes('굶주림'); k++) await run(5);
  check(
    'the homes go hungry, and the top bar says so',
    await waitUntil(async () => (await textOf('#topbar')).includes('굶주림')),
    (await textOf('#topbar')).slice(0, 160),
  );
  await expectTopBarFits('money below zero and hunger (an agent connected)');

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
  await shot('16-season-ended');
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
  await waitUntil(async () => (await textOf('#topbar .speed button')) === '⏸');
  await agent.disconnect();
  check(
    'an agent that drops raises an alert, and the game pauses by itself',
    await waitUntil(
      async () => (await textOf('#feed')).includes('에이전트 연결이 끊겼어요') && (await textOf('#topbar .speed button')) === '▶',
      8000,
    ),
  );
  await shot('17-agent-lost');
  await page.keyboard.press('Space');
  check('play goes on without an agent', await waitUntil(async () => (await textOf('#topbar .speed button')) === '⏸'));

  // The editor is open when the server goes away: [배포] has no socket to send over, and says so.
  await select('F1', '밭 F1');
  await clickOn('#panel button', '보드 설치');
  await waitUntil(async () => (await textOf('#panel')).includes('T1 보드'));
  await clickOn('#panel button', '편집');
  check(
    "the editor opens on a new season's board",
    await waitUntil(async () => (await isShown('#editor-window')) && (await code()).includes('function tick(io, mem)')),
  );
  check('with the socket open [배포] is enabled', (await buttonNamed('#editor-window', '배포'))?.disabled === false);

  // ---- The server goes away with the game on the screen: the page says so ----
  serverClosed = true;
  await server.close();
  check(
    'the game screen says when the server is gone',
    await waitUntil(async () => (await textOf('#notice')).includes('게임 서버에 연결할 수 없어요'), 4000),
    `the notice says "${await textOf('#notice')}"`,
  );
  const noSocket = await buttonNamed('#editor-window', '배포');
  check(
    'with the socket closed, [배포] is disabled, and says why',
    noSocket?.disabled === true && (await textOf('#editor-window .reason')).startsWith('서버와 연결이 끊겨서'),
    `${JSON.stringify(noSocket)}: ${await textOf('#editor-window .reason')}`,
  );
  // The reason is a sentence beside the buttons: the title and the buttons must stay on one line each, however long it is.
  const wrapped = await page.evaluate(() =>
    [...document.querySelectorAll('#editor-window header > :not(.reason)')]
      .map((e) => {
        const range = document.createRange();
        range.selectNodeContents(e);
        return { text: e.textContent ?? '', lines: new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size };
      })
      .filter((part) => part.lines > 1),
  );
  check(
    "with the reason showing, the editor's title and buttons each stay on one line",
    wrapped.length === 0,
    wrapped.map((part) => `"${part.text}" runs over ${part.lines} lines`).join('; '),
  );
  await clickOn('#editor-window button', '배포'); // a press on it sends nothing, and the line does not claim that it did
  await page.waitForTimeout(300);
  check('a press on the disabled [배포] leaves the result line empty', (await result()) === '', await result());
  await shot('18-server-lost');
} finally {
  for (const agent of agents) await agent.disconnect().catch(() => undefined);
  await browser.close();
  await flatBrowser.current?.close();
  if (!serverClosed) await server.close();
  rmSync(configDir, { recursive: true, force: true }); // the token it holds belongs to this run only
}
if (failures.length > 0) {
  process.stderr.write(`${failures.length} check(s) failed: ${failures.join('; ')}\n`);
  process.exitCode = 1;
}
