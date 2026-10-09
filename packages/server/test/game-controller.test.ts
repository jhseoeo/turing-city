import { readFileSync } from 'node:fs';
import { parseScenario } from '@turing-city/core';
import { afterEach, describe, expect, it } from 'vitest';
import { GameController } from '../src/game-controller.ts';

const scenario = parseScenario(JSON.parse(readFileSync('scenarios/m1-power.json', 'utf8')));
const AGENT = { connected: true, clientName: 'test-agent' };
let controller: GameController | null = null;

function make(options: { watchdogMs?: number } = {}): GameController {
  controller = new GameController({ scenario, ...options });
  return controller;
}

afterEach(() => {
  controller?.close();
  controller = null;
});

describe('GameController', () => {
  it('refuses to start a season without an agent, and starts paused with one', async () => {
    const c = make();
    await expect(c.startSeason(1)).rejects.toThrow('connect an agent first');
    c.setAgent(AGENT);
    await c.startSeason(1);
    expect(c.status().state).toBe('paused');
    expect(c.latestSnapshot()?.step).toBe(0);
  });

  it("deploys through the syntax check and installs on the board's next tick", async () => {
    const c = make();
    c.setAgent(AGENT);
    await c.startSeason(1);
    await expect(c.deploy('DA', 'function tick( end')).resolves.toMatchObject({ ok: false });
    await expect(c.deploy('DA', 'function tick(io) io.log("hi") end')).resolves.toMatchObject({ ok: true, version: 1 });
    await c.runUntil({ seconds: 1 });
    const logs = await c.logs('DA', undefined);
    expect(logs?.some((l) => l.text === 'hi')).toBe(true);
  });

  it("answers the agent tools' reads", async () => {
    const c = make();
    c.setAgent(AGENT);
    await expect(c.listBoards()).rejects.toThrow('season');
    await c.startSeason(1);
    expect((await c.listBoards()).map((b) => b.id)).toEqual(['P', 'DA', 'DB']);
    expect((await c.datasheet('DA'))?.parts.clockHz).toBe(5);
    expect(await c.datasheet('ZZ')).toBeNull();
    expect((await c.statusOf()).money).toBe(5000);
  });

  it('plays in real time and pauses', async () => {
    const c = make();
    c.setAgent(AGENT);
    await c.startSeason(1);
    c.setSpeed(3);
    c.play();
    expect(c.status().state).toBe('running');
    await new Promise((r) => setTimeout(r, 400));
    c.pause();
    const step = c.latestSnapshot()!.step;
    expect(step).toBeGreaterThan(5);
    await new Promise((r) => setTimeout(r, 200));
    expect(c.latestSnapshot()!.step).toBeLessThanOrEqual(step + 60);
    expect(c.status().state).toBe('paused');
  });

  it('pauses on a disconnect and refuses to play until the agent is back', async () => {
    const c = make();
    c.setAgent(AGENT);
    await c.startSeason(1);
    c.play();
    c.setAgent({ connected: false, clientName: null });
    expect(c.status()).toMatchObject({ state: 'paused', blockedByAgent: true });
    expect(() => c.play()).toThrow('connect an agent first');
    c.setAgent(AGENT);
    c.play();
    expect(c.status().state).toBe('running');
  });

  it('pauses on an alert type the player picked', async () => {
    const c = make();
    c.setAgent(AGENT);
    await c.startSeason(1);
    c.setAutoPause(['firmwareError']);
    await c.deploy('DA', 'function tick() error("boom") end');
    c.setSpeed(3);
    c.play();
    for (let i = 0; i < 40 && c.status().state === 'running'; i++) await new Promise((r) => setTimeout(r, 50));
    expect(c.status().state).toBe('paused');
  });

  it('stops the session when a batch outlives the watchdog', async () => {
    const c = make({ watchdogMs: 1 });
    c.setAgent(AGENT);
    await c.startSeason(1);
    await expect(c.runUntil({ seconds: 600 })).rejects.toThrow('stopped');
    expect(c.status().state).toBe('crashed');
    expect(c.status().crash).toMatch(/stopped responding/);
  });

  it('stops the clock when the season ends while running', async () => {
    const short = parseScenario({
      ...JSON.parse(readFileSync('scenarios/m1-power.json', 'utf8')),
      time: { stepsPerSecond: 20, secondsPerDay: 1, seasonDays: 1 },
    });
    controller = new GameController({ scenario: short });
    const c = controller;
    c.setAgent(AGENT);
    await c.startSeason(1);
    c.setSpeed(3);
    c.play();
    for (let i = 0; i < 40 && c.status().state === 'running'; i++) await new Promise((r) => setTimeout(r, 50));
    expect(c.status().state).toBe('ended');
    expect(c.latestSnapshot()?.ended?.kind).toBe('completed');
  });

  it('starts every season fresh', async () => {
    const c = make();
    c.setAgent(AGENT);
    await c.startSeason(1);
    await c.deploy('DA', 'function tick() end');
    await c.runUntil({ seconds: 1 });
    await c.startSeason(1);
    expect(c.latestSnapshot()?.step).toBe(0);
    expect((await c.listBoards())[1]!.firmwareVersion).toBeNull();
  });
});
