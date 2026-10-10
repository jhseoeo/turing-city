import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { chromium } from 'playwright-core';
import { loadConfig } from '../src/config.ts';
import { startGameServer } from '../src/game-server.ts';

const out = 'scratch/shots';
mkdirSync(out, { recursive: true });
const configDir = mkdtempSync(join(tmpdir(), 'tc-shots-'));
const server = await startGameServer({ port: 0, configDir, dev: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1320, height: 860 } });
const shot = async (name: string): Promise<void> => {
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(out, `${name}.png`) });
  process.stdout.write(`${out}/${name}.png\n`);
};

try {
  await page.goto(server.url);
  await shot('1-start-waiting');

  const transport = new StreamableHTTPClientTransport(new URL(`${server.url}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${loadConfig(configDir).token}` } },
  });
  const agent = new Client({ name: 'shots', version: '0.0.1' });
  await agent.connect(transport as Transport);
  await shot('2-start-connected');

  await page.getByText('시즌 시작').click();
  await page.waitForTimeout(500);
  const careful =
    'function tick(io, mem) if io.temp > 70 then io.cool(3) end if io.temp < 82 then io.process() end io.log("t", io.temp) end';
  await agent.callTool({ name: 'deploy_firmware', arguments: { board: 'P', code: 'function tick(io) io.set_thermal(250) end' } });
  await agent.callTool({ name: 'deploy_firmware', arguments: { board: 'DA', code: careful } });
  await agent.callTool({ name: 'dev_run_until', arguments: { seconds: 30 } });
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

  await transport.terminateSession();
  await agent.close();
  await shot('7-agent-lost');
} finally {
  await browser.close();
  await server.close();
}
