/**
 * `pnpm web:smoke`: the web demo's build played in headless Chrome. It serves `packages/web/dist` as plain files (no game server),
 * starts a season, works the datacenter by hand, installs a board, deploys firmware from the editor, and reads the firmware's log
 * line back in the panel. Exits 1 on a failed check. TURING_CITY_CHROME names a Chromium build where Google Chrome is missing.
 */
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseScenario } from '@turing-city/core';
import { chromium } from 'playwright-core';

const CELL = 34;
const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const scenario = parseScenario(
  JSON.parse(readFileSync(fileURLToPath(new URL('../../../scenarios/m2-town.json', import.meta.url)), 'utf8')),
);
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.wasm': 'application/wasm',
};

const server = createServer((req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
  const file = path === '/' ? 'index.html' : path;
  try {
    const body = readFileSync(join(dist, file));
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;

const chromePath = process.env.TURING_CITY_CHROME;
const browser = await chromium.launch(chromePath ? { executablePath: chromePath, headless: true } : { channel: 'chrome', headless: true });
let failed = 0;
const check = (name: string, ok: boolean, detail = ''): void => {
  if (!ok) failed += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
};

try {
  const page = await browser.newPage({ viewport: { width: 1320, height: 860 } });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // A missing file is told by its URL (the console's own line names none); a browser's own favicon request is no error of the page's.
  page.on('response', (r) => {
    if (r.status() >= 400 && !r.url().endsWith('/favicon.ico')) errors.push(`${r.status()} ${r.url()}`);
  });
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) errors.push(m.text());
  });
  const textOf = (selector: string): Promise<string> => page.evaluate((s) => document.querySelector(s)?.textContent ?? '', selector);
  const waitUntil = async (test: () => Promise<boolean>, ms = 10_000): Promise<boolean> => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await test()) return true;
      await page.waitForTimeout(100);
    }
    return false;
  };
  /**
   * Clicks the first enabled button in the scope whose label starts with the text, by its place on the screen: the page rebuilds its
   * buttons on every snapshot while the clock runs, and holds the render only while a real pointer is down.
   */
  const clickButton = async (scope: string, label: string): Promise<boolean> => {
    const at = await page.evaluate(
      ({ scope, label }) => {
        const button = [...document.querySelectorAll<HTMLButtonElement>(`${scope} button`)].find(
          (b) => (b.textContent ?? '').startsWith(label) && !b.disabled,
        );
        const r = button?.getBoundingClientRect();
        return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
      },
      { scope, label },
    );
    if (!at) return false;
    await page.mouse.click(at.x, at.y);
    return true;
  };

  await page.goto(url);
  check(
    'the start screen opens with the season button live, without a server',
    await waitUntil(async () => (await page.locator('.start-button').count()) > 0 && !(await page.locator('.start-button').isDisabled())),
  );
  const start = await textOf('#start');
  check(
    'it says it is the web demo, and offers no agent connection',
    start.includes('웹 데모') && !start.includes('토큰'),
    start.slice(0, 80),
  );

  await page.locator('.start-button').click();
  check('a season starts: the town and the top bar show', await waitUntil(async () => (await textOf('#topbar')).includes('자금')));
  const guide = await textOf('#guide');
  check(
    'the guide card puts the comm module and agents in the desktop version, and offers no MCP',
    guide.includes('데스크톱 버전') && !guide.includes('MCP'),
    guide.slice(0, 80),
  );
  await page.keyboard.press('Escape'); // the guide card

  const map = await page.locator('#map canvas').boundingBox();
  if (!map) throw new Error('no map');
  const select = async (id: string, title: string): Promise<boolean> => {
    const f = scenario.facilities.find((x) => x.id === id)!;
    await page.mouse.click(map.x + f.x * CELL + CELL / 2, map.y + f.y * CELL + CELL / 2);
    return waitUntil(async () => (await textOf('#panel h2')) === title);
  };
  // The wind alone can't power the town: the plant's thermal output, set by hand with its slider, makes up the rest.
  check('a click on P opens the plant', await select('P', '발전소 P'));
  await page.evaluate(() => {
    const slider = document.querySelector<HTMLInputElement>('#panel input[type=range]')!;
    slider.value = slider.max;
    slider.dispatchEvent(new Event('change'));
  });
  check('the slider sets the thermal output by hand', await waitUntil(async () => !(await textOf('#topbar')).includes('화력 0')));
  check('a click on DA opens its panel', await select('DA', '데이터센터 DA'));
  check(
    '[처리] works DA by hand',
    (await clickButton('#panel', '처리')) && (await waitUntil(async () => (await textOf('#panel')).includes('처리 중'))),
  );

  check(
    'a board installs on DA',
    (await clickButton('#panel', '보드 설치')) && (await waitUntil(async () => (await textOf('#panel')).includes('편집'))),
  );
  check('no comm module is offered: no agent can connect', !(await textOf('#panel')).includes('통신 모듈 ('));

  await clickButton('#panel', '편집');
  check('the editor opens', await waitUntil(async () => (await page.locator('#editor-window .cm-content').count()) > 0));
  await page.locator('#editor-window .cm-content').click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.insertText('function tick(io)\n  io.log("hello from the web")\nend\n');
  await clickButton('#editor-window', '배포');
  check(
    'the deploy is accepted',
    await waitUntil(async () => /v1/.test(await textOf('#editor-window .result'))),
    await textOf('#editor-window .result'),
  );
  await page.keyboard.press('Escape'); // the editor
  await clickButton('#topbar', '▶');
  check(
    "the board runs the firmware: its log line shows in the panel's log",
    await waitUntil(
      async () =>
        page.evaluate(() =>
          [...document.querySelectorAll('#panel pre')].some((p) => /\d+일 [\d:]+ {2}hello from the web/.test(p.textContent ?? '')),
        ),
      20_000,
    ),
  );

  await clickButton('#panel', '매뉴얼');
  check('the manual opens, with no download button', await waitUntil(async () => (await textOf('#manual-window')).includes('DA')));
  check('the manual has no .md download in the web demo', !(await textOf('#manual-window')).includes('.md 다운로드'));
  check('no errors in the page', errors.length === 0, errors.slice(0, 3).join(' | '));
  await page.screenshot({ path: 'scratch/web-smoke.png' });
} finally {
  await browser.close();
  server.close();
}
console.log(failed === 0 ? 'web smoke: all checks passed' : `web smoke: ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
