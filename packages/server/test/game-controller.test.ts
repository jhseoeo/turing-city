import { readFileSync } from 'node:fs';
import { Worker } from 'node:worker_threads';
import {
  type AlertView,
  type BoardKind,
  type ControllerEvent,
  parseScenario,
  runSeason,
  type Scenario,
  ToolError,
  timeView,
} from '@turing-city/core';
import { WasmoonHost } from '@turing-city/firmware';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadFirmwareDir } from '../src/firmware-files.ts';
import { GameController, gameApi, installsAt } from '../src/game-controller.ts';

const scenario = parseScenario(JSON.parse(readFileSync('scenarios/m1-power.json', 'utf8')));
/** The whole town, every facility at T0: no boards. */
const m2 = parseScenario(JSON.parse(readFileSync('scenarios/m2-town.json', 'utf8')));
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

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function until(condition: () => boolean, ms = 3000): Promise<void> {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > ms) throw new Error('timed out waiting');
    await sleep(10);
  }
}

/** The m1 scenario with another clock. */
function withTime(time: { stepsPerSecond: number; secondsPerDay: number; seasonDays: number }): Scenario {
  return parseScenario({ ...JSON.parse(readFileSync('scenarios/m1-power.json', 'utf8')), time });
}

/** The m1 scenario with no raids and money enough to last: a season that can run to its last day. */
function calmScenario(): Scenario {
  const raw = JSON.parse(readFileSync('scenarios/m1-power.json', 'utf8'));
  raw.startMoney = 1_000_000;
  raw.tuning.emf.rumourThreshold = 1_000_000_000;
  return parseScenario(raw);
}

/** A controller on a scenario of its own; afterEach closes it like the others. */
function makeFor(forScenario: Scenario, options: { watchdogMs?: number; stepsPerBatch?: number } = {}): GameController {
  controller = new GameController({ scenario: forScenario, ...options });
  return controller;
}

/** What a few tests reach into: the progress array the controller shares with the worker, and the worker itself. */
interface Internals {
  readonly progress: Int32Array;
  readonly worker: Worker | null;
}
const inside = (c: GameController): Internals => c as unknown as Internals;

/** Firmware that spends its whole instruction budget on every tick, so a batch of steps spends most of its time inside ticks. */
const BUSY = 'function tick(io) local x = 0 for i = 1, 100000 do x = x + i end end';
const FAILING = 'function tick() error("boom") end';

/**
 * Holds the controller's syntax checker back, as it is for about 100 ms when the first deploy loads it, and lets it go on request.
 * A deploy that is checking its code is then in the window in which the season can change.
 */
function holdChecker(c: GameController): { release(): void } {
  let release = (): void => undefined;
  const gate = new Promise<{ check(code: string): string | null }>((resolve) => {
    release = () => resolve({ check: () => null });
  });
  (c as unknown as { checker: Promise<unknown> }).checker = gate;
  return { release: () => release() };
}

/** One event as a short line, so a whole sequence reads as one list. */
function line(event: ControllerEvent): string {
  switch (event.kind) {
    case 'status':
      return `status ${event.status.state}`;
    case 'snapshot':
      return `snapshot ${event.snapshot.step}`;
    case 'alerts':
      return `alerts ${event.alerts.map((a) => `${a.kind}@${a.facility}`).join(',')}`;
    case 'deploy':
      return `deploy ${event.board} v${event.version} at ${event.time.seconds} by ${event.by}`;
  }
}

describe('GameController', () => {
  it('starts a season without an agent, paused at its first step, and plays it', async () => {
    const c = make();
    await c.startSeason(1);
    expect(c.status()).toMatchObject({ state: 'paused', agent: { connected: false, clientName: null } });
    expect(c.latestSnapshot()?.step).toBe(0);
    c.play(); // an agent is a helper the player may never connect
    expect(c.status().state).toBe('running');
  });

  it("deploys through the syntax check and installs on the board's next tick", async () => {
    const c = make();
    c.setAgent(AGENT);
    await c.startSeason(1);
    await expect(c.deploy('DA', 'function tick( end')).resolves.toMatchObject({ ok: false });
    await expect(c.deploy('DA', 'function tick(io) io.log("hi") end')).resolves.toMatchObject({ ok: true, version: 1 });
    await c.runUntil({ seconds: 1 });
    const logs = (await c.inspect('DA'))?.logs;
    expect(logs?.some((l) => l.text === 'hi')).toBe(true);
  });

  it("answers the agent tools' reads", async () => {
    const c = make();
    await expect(c.listBoards()).rejects.toThrow('season');
    await c.startSeason(1);
    expect((await c.listBoards()).map((b) => b.id)).toEqual(['P', 'DA', 'DB']);
    expect(await c.install('DA', 'comm')).toEqual({ ok: true }); // the agent reaches a board through its comm module
    expect(await c.manual('DA')).toContain('DA');
    expect(await c.manual('DA')).toContain('| 클럭 | 5 Hz: 1초에 5번 틱 |');
    expect(await c.manual('ZZ')).toBeNull();
    expect((await c.statusOf()).money).toBe(scenario.startMoney - scenario.tuning.install.commPrice);
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

  it('tells of an agent that drops during a season, pauses for it as the player picked by default, and plays on without it', async () => {
    const c = make();
    c.setAgent(AGENT);
    await c.startSeason(1);
    const alerts: AlertView[] = [];
    c.onEvent((event) => {
      if (event.kind === 'alerts') alerts.push(...event.alerts);
    });
    c.play();
    c.setAgent({ connected: false, clientName: null });
    expect(c.status()).toMatchObject({ state: 'paused', agent: { connected: false } });
    expect(alerts).toEqual([
      { id: -1, kind: 'agentLost', facility: null, message: '에이전트 연결이 끊겼어요', day: 1, clock: '00:00', seconds: 0 },
    ]);
    c.play(); // nothing waits for the agent to come back
    expect(c.status().state).toBe('running');
  });

  it('tells of a drop in a paused season as well, with the time it happened, and not once the season is over', async () => {
    const short = withTime({ stepsPerSecond: 20, secondsPerDay: 10, seasonDays: 1 });
    const c = makeFor(short);
    const alerts: AlertView[] = [];
    c.onEvent((event) => {
      if (event.kind === 'alerts') alerts.push(...event.alerts.filter((a) => a.kind === 'agentLost')); // the season's own end is one too
    });
    c.setAgent(AGENT);
    await c.startSeason(1);
    await c.runUntil({ seconds: 5 });
    c.setAgent({ connected: false, clientName: null });
    expect(alerts).toEqual([{ ...timeView(short, 100), id: -1, kind: 'agentLost', facility: null, message: '에이전트 연결이 끊겼어요' }]);
    expect(alerts[0]).toMatchObject({ seconds: 5, clock: '12:00' });
    expect(c.status().state).toBe('paused'); // it was paused already
    c.setAgent(AGENT);
    await c.runUntil({});
    expect(c.status().state).toBe('ended');
    c.setAgent({ connected: false, clientName: null });
    expect(alerts).toHaveLength(1); // nothing is in play any more
  });

  it('tells of no drop while an agent stays connected, whatever it is called', async () => {
    const c = make();
    const kinds: string[] = [];
    c.onEvent((event) => {
      if (event.kind === 'alerts') kinds.push(...event.alerts.map((a) => a.kind));
    });
    c.setAgent(AGENT);
    await c.startSeason(1);
    c.play();
    c.setAgent({ connected: true, clientName: 'another-agent' });
    expect(kinds).toEqual([]);
    expect(c.status()).toMatchObject({ state: 'running', agent: { connected: true, clientName: 'another-agent' } });
  });

  it('tells of a dropped agent only when one was connected during a season, and pauses only when the player picked it', async () => {
    const c = make();
    const kinds: string[] = [];
    c.onEvent((event) => {
      if (event.kind === 'alerts') kinds.push(...event.alerts.map((a) => a.kind));
    });
    c.setAgent(AGENT);
    c.setAgent({ connected: false, clientName: null }); // no season yet
    await c.startSeason(1);
    c.setAgent({ connected: false, clientName: null }); // no agent was connected
    expect(kinds).toEqual([]);
    c.setAgent(AGENT);
    c.setAutoPause(['fire']);
    c.play();
    c.setAgent({ connected: false, clientName: null });
    expect(kinds).toEqual(['agentLost']);
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
    expect((await c.listBoards())[1]!.board!.firmwareVersion).toBeNull();
  });
});

describe('gameApi', () => {
  it('tells the agent whether the clock is paused and how fast it runs', async () => {
    const c = make();
    c.setAgent(AGENT);
    await c.startSeason(1);
    const api = gameApi(c);
    expect(await api.status()).toMatchObject({ money: 5000, run: { paused: true, speed: 1 } });
    c.setSpeed(3);
    expect((await api.status()).run).toEqual({ paused: true, speed: 3 });
    c.play();
    expect((await api.status()).run).toEqual({ paused: false, speed: 3 });
    c.setSpeed(2);
    expect((await api.status()).run).toEqual({ paused: false, speed: 2 });
    c.pause();
    expect((await api.status()).run).toEqual({ paused: true, speed: 2 });
  });

  it('reports the clock as stopped once the season has ended', async () => {
    const c = makeFor(withTime({ stepsPerSecond: 20, secondsPerDay: 1, seasonDays: 1 }));
    c.setAgent(AGENT);
    await c.startSeason(1);
    await c.runUntil({});
    expect(c.status().state).toBe('ended');
    expect(await gameApi(c).status()).toMatchObject({ ended: { kind: 'completed' }, run: { paused: true, speed: 1 } });
  });

  it('refuses a deploy once the season has ended, as every other command does, and tells nobody of one', async () => {
    const c = makeFor(withTime({ stepsPerSecond: 20, secondsPerDay: 1, seasonDays: 1 }));
    await c.startSeason(1);
    await c.runUntil({});
    expect(c.status().state).toBe('ended');
    const events: string[] = [];
    c.onEvent((event) => events.push(line(event)));
    for (const by of ['player', 'agent'] as const) {
      const refusal = await c.deploy('DA', 'function tick() end', by).catch((error: unknown) => error);
      expect(refusal).toBeInstanceOf(ToolError);
      expect((refusal as ToolError).message).toBe('the season has ended');
      expect((refusal as ToolError).refusal).toEqual({ code: 'seasonEnded' });
    }
    expect(events.filter((e) => e.startsWith('deploy'))).toEqual([]);
  });

  it('refuses a deploy to a board that does not exist with a tool error naming it, and the season goes on', async () => {
    const c = make();
    c.setAgent(AGENT);
    await c.startSeason(1);
    const api = gameApi(c);
    const refusal = await api.deploy('XX', 'function tick() end').catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(ToolError);
    expect((refusal as ToolError).message).toBe('unknown board XX; list_boards lists the boards');
    expect((refusal as ToolError).refusal).toEqual({ code: 'unknownBoard', board: 'XX' });
    expect(c.status()).toMatchObject({ state: 'paused', crash: null });
    // The worker is still there: it answers, takes a deploy for a real board (the refused one used no version), and steps.
    expect((await api.listBoards()).map((b) => b.id)).toEqual(['P', 'DA', 'DB']);
    expect(await c.install('DA', 'comm')).toEqual({ ok: true });
    await expect(api.deploy('DA', 'function tick() end')).resolves.toMatchObject({ ok: true, version: 1 });
    await c.runUntil({ seconds: 1 });
    expect(c.latestSnapshot()?.step).toBe(20);
  });

  it("reaches a board's manual, firmware, logs, and deploys only through its comm module, and tells the agent how to get one", async () => {
    const c = makeFor(m2);
    await c.startSeason(1);
    const api = gameApi(c);
    const refusalOf = (call: () => Promise<unknown>): Promise<unknown> =>
      call().then(
        () => 'answered',
        (error: unknown) => (error instanceof ToolError ? { message: error.message, refusal: error.refusal } : error),
      );
    const noComm = (id: string) => ({
      message: `${id} has no comm module: the player installs one from the board's panel`,
      refusal: { code: 'noComm', board: id },
    });
    // F1 has no board (T0); DA gets one but no comm module (T1).
    expect(await c.install('DA', 'board')).toEqual({ ok: true });
    for (const id of ['F1', 'DA']) {
      expect(await refusalOf(() => api.manual(id))).toEqual(noComm(id));
      expect(await refusalOf(() => api.firmware(id))).toEqual(noComm(id));
      expect(await refusalOf(() => api.logs(id, undefined))).toEqual(noComm(id));
      expect(await refusalOf(() => api.deploy(id, 'function tick() end'))).toEqual(noComm(id));
    }
    // An id that names no board slot (housing takes none, and ZZ is nothing) is an unknown board, as in milestone 1.
    expect(await api.manual('H1')).toBeNull();
    expect(await api.manual('ZZ')).toBeNull();
    // With the comm module (T2) the board is the agent's to work on.
    expect(await c.install('DA', 'comm')).toEqual({ ok: true });
    expect(await api.deploy('DA', 'function tick() end')).toMatchObject({ ok: true, version: 1 });
    expect(await api.firmware('DA')).toMatchObject({ version: null, pending: { version: 1 } });
    expect(await api.manual('DA')).toContain('DA');
    expect(await api.logs('DA', undefined)).toEqual(expect.any(Array));
  });
});

describe('GameController: its status and the rules of play', () => {
  it('reports its status', () => {
    const c = make();
    const idle = {
      state: 'idle',
      speed: 1,
      agent: { connected: false, clientName: null },
      crash: null,
      autoPause: ['raid', 'wrecked', 'fire', 'firmwareError', 'agentLost'],
      scenarioName: scenario.name,
      season: 0,
    };
    expect(scenario.name).not.toBe('');
    expect(c.status()).toEqual(idle);
    c.setAgent(AGENT);
    c.setSpeed(2);
    c.setAutoPause(['fire']);
    expect(c.status()).toEqual({ ...idle, speed: 2, agent: AGENT, autoPause: ['fire'] });
  });

  it('counts the seasons it starts, so that the viewer can tell a new one from the one before', async () => {
    const c = make();
    const seasons: number[] = [];
    c.onEvent((event) => {
      if (event.kind === 'status') seasons.push(event.status.season);
    });
    expect(c.status().season).toBe(0);
    await c.startSeason(1);
    expect(c.status().season).toBe(1);
    c.setSpeed(2);
    await c.startSeason(1);
    expect(c.status().season).toBe(2);
    expect(seasons).toEqual([1, 1, 2]); // the new season's status already carries its number, and a status in between keeps the old one
  });

  it('counts a season whose worker failed to start, and one that was cut short by the next', async () => {
    const failing = makeFor({ ...scenario, facilities: [] } as unknown as Scenario);
    await expect(failing.startSeason(1)).rejects.toThrow('the simulator failed');
    expect(failing.status()).toMatchObject({ state: 'crashed', season: 1 });
    failing.close();

    const c = make();
    const first = c.startSeason(1);
    const second = c.startSeason(2); // the first is cut short, and has a number of its own
    await expect(first).rejects.toThrow('a new season started');
    await second;
    expect(c.status()).toMatchObject({ state: 'paused', season: 2 });
  });

  it('plays only a paused season, and pauses only a running one', async () => {
    const c = make();
    c.setAgent(AGENT);
    expect(() => c.play()).toThrow("The season hasn't started"); // there is nothing to play, and the caller is told so
    c.pause();
    expect(c.status().state).toBe('idle');
    await c.startSeason(1);
    c.pause();
    expect(c.status().state).toBe('paused');
    c.play();
    expect(c.status().state).toBe('running');
    await expect(c.runUntil({ seconds: 1 })).rejects.toThrow('paused');
    c.pause();
    expect(c.status().state).toBe('paused');
  });

  it('does not play a season that has ended', async () => {
    const c = makeFor(withTime({ stepsPerSecond: 20, secondsPerDay: 1, seasonDays: 1 }));
    c.setAgent(AGENT);
    await c.startSeason(1);
    await c.runUntil({});
    expect(c.status().state).toBe('ended');
    c.play();
    expect(c.status().state).toBe('ended');
  });
});

describe('GameController: the clock', () => {
  // The clock is driven by hand: its interval and its reading of time are faked, while the worker and its answers stay real.
  const handClock = () => vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'performance'] });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** One tick of the clock (50 ms), then the wait for the worker's answer: the world must stand at `step`. */
  async function tick(c: GameController, step: number): Promise<void> {
    vi.advanceTimersByTime(50);
    await until(() => c.latestSnapshot()!.step >= step);
    expect(c.latestSnapshot()!.step).toBe(step);
  }

  it("turns the time that passed into steps at the scenario's rate times the speed", async () => {
    handClock();
    const c = makeFor(withTime({ stepsPerSecond: 40, secondsPerDay: 40, seasonDays: 30 }));
    c.setAgent(AGENT);
    await c.startSeason(1);
    c.setSpeed(3);
    c.play();
    await tick(c, 6); // 50 ms at 40 steps a second and 3x
    await tick(c, 12); // the steps that fell due are paid off: they do not pile up
    c.setSpeed(1);
    await tick(c, 14);
    c.pause();
    await c.runUntil({ seconds: 1 }); // a game second is 40 steps here
    expect(c.latestSnapshot()!.step).toBe(54);
  });

  it('counts the time the game stood still as no time at all', async () => {
    handClock();
    const c = make();
    c.setAgent(AGENT);
    await c.startSeason(1);
    c.setSpeed(3);
    c.play();
    c.pause(); // leaves this play's clock reading behind
    vi.advanceTimersByTime(400);
    c.play();
    await tick(c, 3); // 50 ms at 20 steps a second and 3x. A clock that kept its old reading would add the 0.4 s it stood still: 27
  });

  it('carries at most stepsPerBatch steps in a batch', async () => {
    handClock();
    const c = makeFor(scenario, { stepsPerBatch: 2 });
    c.setAgent(AGENT);
    await c.startSeason(1);
    c.setSpeed(3);
    c.play();
    await tick(c, 2); // 3 steps fall due each tick, a batch carries 2
    await tick(c, 4);
  });

  it('starts no batch while one is still on its way', async () => {
    handClock();
    const c = make();
    c.setAgent(AGENT);
    await c.startSeason(1);
    c.setSpeed(3);
    c.play();
    const sent = vi.spyOn(inside(c).worker!, 'postMessage');
    vi.advanceTimersByTime(100); // two ticks before the worker can have answered the first batch
    expect(sent.mock.calls.filter(([message]) => (message as { type: string }).type === 'advance')).toHaveLength(1);
    await until(() => c.latestSnapshot()!.step === 3);
    await tick(c, 9); // the tick that found a batch out left its time for this one: 100 ms, not 50
  });

  it('skips the time a stall took instead of running through it at once', async () => {
    handClock();
    const c = make(); // 20 steps a second
    c.setAgent(AGENT);
    await c.startSeason(1);
    c.setSpeed(3);
    c.play();
    await tick(c, 3);
    // The process stands still for 8 seconds (Ctrl+Z and fg, a debugger), with a batch out when it does. It comes back owing 480
    // steps, which used to run as batches of 200, an auto-pause landing a whole batch after its alert.
    vi.advanceTimersByTime(8000);
    await until(() => c.latestSnapshot()!.step === 6);
    await tick(c, 18); // what is owed is capped at 200 ms of the clock at this speed: 12 steps ...
    await tick(c, 21); // ... and the rest of the stall is gone, not paid back in the batches after it
  });

  it('still pays back a short overrun in full', async () => {
    handClock();
    const c = make();
    c.setAgent(AGENT);
    await c.startSeason(1);
    c.setSpeed(3);
    c.play();
    vi.advanceTimersByTime(150); // the first tick starts a batch, and the next two find it still out: a worker that took 150 ms
    await until(() => c.latestSnapshot()!.step === 3);
    await tick(c, 12); // the 150 ms the clock was kept from running are paid in full: 9 steps, within the 12 that the cap allows
  });

  it('stops a run when the player presses play during it', async () => {
    handClock();
    const c = make();
    c.setAgent(AGENT);
    await c.startSeason(1);
    const run = c.runUntil({ seconds: 600 });
    c.play();
    await run;
    expect(c.latestSnapshot()!.step).toBe(200); // the batch that was out; the run did not go on to the end of the season
  });

  it('leaves no unhandled rejection behind when a new season cuts a clock batch short', async () => {
    handClock();
    const unhandled: unknown[] = [];
    const listener = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', listener);
    try {
      const c = make();
      c.setAgent(AGENT);
      await c.startSeason(1);
      c.setSpeed(3);
      c.play();
      vi.advanceTimersByTime(50); // a clock batch is out
      await c.startSeason(2); // its promise is rejected: a new season started
      await sleep(50); // an unhandled rejection is reported a turn of the event loop later
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', listener);
    }
  });

  it('refuses a run while a clock batch is still out, and lets the clock batch finish', async () => {
    handClock();
    const c = make({ watchdogMs: 200 });
    c.setAgent(AGENT);
    await c.startSeason(1);
    c.setSpeed(3);
    c.play();
    vi.advanceTimersByTime(50); // a clock batch is out
    c.pause();
    await expect(c.runUntil({ seconds: 1 })).rejects.toThrow('already running');
    await until(() => c.latestSnapshot()!.step === 3); // the clock batch finished, and nothing ran beyond it
    await sleep(300); // longer than the limit: nothing is left armed
    expect(c.status()).toMatchObject({ state: 'paused', crash: null });
    c.play();
    await tick(c, 6); // and the clock runs again: its batch was not taken for one that never finished
  });

  it('starts no clock batch while a run has one out', async () => {
    handClock();
    const c = make();
    c.setAgent(AGENT);
    await c.startSeason(1);
    c.setSpeed(3);
    const run = c.runUntil({ seconds: 600 }); // a batch of 200 steps is out
    c.play();
    vi.advanceTimersByTime(50); // a tick while it is: it must leave the batch alone
    await run;
    expect(c.latestSnapshot()!.step).toBe(200);
    await tick(c, 206); // the skipped tick left its time for this one: 100 ms at 20 steps a second and 3x is 6
  });

  it('lets go of its timer whenever the clock stops', async () => {
    handClock();
    const a = make();
    a.setAgent(AGENT);
    await a.startSeason(1);
    expect(vi.getTimerCount()).toBe(0);
    a.play();
    expect(vi.getTimerCount()).toBe(1);
    a.pause();
    expect(vi.getTimerCount()).toBe(0);
    a.play();
    await a.startSeason(2); // a new season while the clock runs
    expect(vi.getTimerCount()).toBe(0);
    a.play();
    inside(a).worker!.emit('error', new Error('the thread died')); // the worker thread dies while the clock runs
    expect(a.status()).toMatchObject({ state: 'crashed', crash: 'the simulator failed: the thread died' });
    expect(vi.getTimerCount()).toBe(0);
    a.close();

    const b = makeFor(withTime({ stepsPerSecond: 20, secondsPerDay: 1, seasonDays: 1 })); // the season ends while the clock runs
    b.setAgent(AGENT);
    await b.startSeason(1);
    b.setSpeed(3);
    b.play();
    expect(vi.getTimerCount()).toBe(1);
    for (let step = 3; b.status().state === 'running'; step += 3) await tick(b, Math.min(step, 20));
    expect(b.status().state).toBe('ended');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps running through an alert of a type the player did not pick', async () => {
    const c = make();
    c.setAgent(AGENT);
    await c.startSeason(1);
    c.setAutoPause(['raid']);
    const raised: string[] = [];
    c.onEvent((event) => {
      if (event.kind === 'alerts') raised.push(...event.alerts.map((a) => a.kind));
    });
    await c.deploy('DA', FAILING);
    handClock();
    c.setSpeed(3);
    c.play();
    await tick(c, 3);
    await tick(c, 6); // DA's first tick falls on step 3, and its firmware fails
    expect(raised).toEqual(['firmwareError']);
    expect(c.status().state).toBe('running');
    await tick(c, 9);
  });
});

describe('GameController: events', () => {
  it('tells its listeners about every change, in order, until they stop listening', async () => {
    const c = make();
    const events: ControllerEvent[] = [];
    const stop = c.onEvent((event) => events.push(event));
    const heard = (): string[] => events.splice(0).map(line);

    c.setAgent(AGENT);
    expect(heard()).toEqual(['status idle']);
    await c.startSeason(1);
    expect(heard()).toEqual(['snapshot 0', 'status paused']);
    c.setSpeed(2);
    c.setAutoPause(['fire', 'agentLost']); // the drop at the end of this test pauses the game only because the player kept agentLost
    const statuses = events.flatMap((event) => (event.kind === 'status' ? [event.status] : []));
    expect(statuses[0]).toMatchObject({ speed: 2, autoPause: ['raid', 'wrecked', 'fire', 'firmwareError', 'agentLost'] });
    expect(statuses[1]).toMatchObject({ speed: 2, autoPause: ['fire', 'agentLost'] });
    expect(heard()).toEqual(['status paused', 'status paused']);
    await c.deploy('DA', FAILING);
    expect(heard()).toEqual(['snapshot 0', 'deploy DA v1 at 0 by player']); // a deploy changes the world: the new picture goes ahead of it
    await c.runUntil({ seconds: 1 });
    expect(heard()).toEqual(['snapshot 20', 'alerts firmwareError@DA']);
    await c.runUntil({ seconds: 1 });
    expect(heard()).toEqual(['snapshot 40']); // no alerts event for a batch that raised none
    await c.deploy('DB', 'function tick() end');
    expect(heard()).toEqual(['snapshot 40', 'deploy DB v1 at 2 by player']);
    c.play();
    c.pause();
    expect(heard()).toEqual(['status running', 'status paused']);
    c.play();
    c.setAgent({ connected: false, clientName: null });
    expect(heard()).toEqual(['status running', 'alerts agentLost@null', 'status paused']);
    c.setAgent(AGENT);
    expect(heard()).toEqual(['status paused']);

    stop();
    c.setSpeed(3);
    expect(heard()).toEqual([]);
  });

  it('tells its listeners when the season ends, and when the session fails and why', async () => {
    const c = makeFor(withTime({ stepsPerSecond: 20, secondsPerDay: 1, seasonDays: 1 }));
    const events: ControllerEvent[] = [];
    c.onEvent((event) => events.push(event));
    c.setAgent(AGENT);
    await c.startSeason(1);
    events.length = 0;
    await c.runUntil({});
    expect(events[0]).toMatchObject({ kind: 'snapshot', snapshot: { step: 20, ended: { kind: 'completed' } } });
    expect(events.at(-1)).toMatchObject({ kind: 'status', status: { state: 'ended' } });

    await c.startSeason(1);
    events.length = 0;
    inside(c).worker!.emit('error', new Error('the thread died'));
    expect(events).toMatchObject([{ kind: 'status', status: { state: 'crashed', crash: 'the simulator failed: the thread died' } }]);
  });

  it('sends a snapshot per batch, a batch being at most stepsPerBatch steps', async () => {
    const small = makeFor(scenario, { stepsPerBatch: 7 });
    const steps: number[] = [];
    small.onEvent((event) => {
      if (event.kind === 'snapshot') steps.push(event.snapshot.step);
    });
    small.setAgent(AGENT);
    await small.startSeason(1);
    await small.runUntil({ seconds: 1 });
    expect(steps).toEqual([0, 7, 14, 20]);
    small.close();

    const normal = makeFor(scenario);
    steps.length = 0;
    normal.onEvent((event) => {
      if (event.kind === 'snapshot') steps.push(event.snapshot.step);
    });
    normal.setAgent(AGENT);
    await normal.startSeason(1);
    await normal.runUntil({ seconds: 30 });
    expect(steps).toEqual([0, 200, 400, 600]);
  });

  it('stops telling its listeners once it is closed', () => {
    const c = make();
    const events: ControllerEvent[] = [];
    c.onEvent((event) => events.push(event));
    c.close();
    c.setSpeed(2);
    expect(events).toEqual([]);
  });

  // Snapshots used to come only with a batch of steps, so a game that stood still showed neither of these.
  it('sends the new picture of the world with a deploy, ahead of its answer, though no time passes', async () => {
    const c = make();
    c.setAgent(AGENT);
    await c.startSeason(1);
    const events: ControllerEvent[] = [];
    c.onEvent((event) => events.push(event));
    const heard = (): string[] => events.splice(0).map(line);
    const boardDA = () => c.latestSnapshot()!.facilities.find((f) => f.id === 'DA')!.board!;

    expect(boardDA().hasFirmware).toBe(false);
    await c.deploy('DA', 'function tick() end');
    expect(boardDA().hasFirmware).toBe(true); // already in date when the deploy is answered
    expect(c.latestSnapshot()!.step).toBe(0);
    expect(heard()).toEqual(['snapshot 0', 'deploy DA v1 at 0 by player']);

    // A request that changed nothing sends nothing.
    await expect(c.deploy('ZZ', 'function tick() end')).rejects.toBeInstanceOf(ToolError);
    expect(await c.deploy('DA', 'function tick( end')).toMatchObject({ ok: false });
    expect(heard()).toEqual([]);
  });

  it('sends the new picture of the world when a repair or a rebuild starts, though no time passes', async () => {
    const c = make();
    await c.startSeason(1);
    await c.runUntil({ alertKinds: ['wrecked'] }); // no firmware: the Luddites wreck a facility in the fifth game day
    const lost = (await c.alerts(undefined)).find((a) => a.kind === 'wrecked')!.facility!;
    const intact = ['P', 'DA', 'DB'].find((id) => id !== lost)!;
    const before = c.latestSnapshot()!;
    const events: ControllerEvent[] = [];
    c.onEvent((event) => events.push(event));

    expect(await c.repair(intact)).toMatchObject({ ok: false, refusal: { code: 'notWrecked', facility: intact } });
    expect(await c.rebuild(intact)).toMatchObject({ ok: false, refusal: { code: 'notDestroyed', board: intact } });
    expect(await c.rebuild(lost)).toMatchObject({ ok: false, refusal: { code: 'repairFirst', facility: lost } });
    expect(events).toEqual([]); // a refused command changed nothing

    expect(await c.repair(lost)).toEqual({ ok: true });
    const repairing = c.latestSnapshot()!; // already in date when the repair is answered
    expect(repairing.step).toBe(before.step);
    expect(repairing.facilities.find((f) => f.id === lost)!.condition).toBe('repairing');
    const kind = scenario.facilities.find((f) => f.id === lost)!.kind as BoardKind;
    expect(repairing.money).toBe(before.money - scenario.tuning.repair.cost[kind]);
    expect(events.map(line)).toEqual([`snapshot ${before.step}`]);

    await c.runUntil({ seconds: 21 }); // a repair takes 20 game seconds
    const repaired = c.latestSnapshot()!;
    events.length = 0;
    expect(await c.rebuild(lost)).toEqual({ ok: true });
    const after = c.latestSnapshot()!;
    expect(after.step).toBe(repaired.step);
    expect(after.facilities.find((f) => f.id === lost)!.board!.status).toBe('rebuilding');
    expect(after.money).toBe(repaired.money - scenario.tuning.rebuild.cost);
    expect(events.map(line)).toEqual([`snapshot ${repaired.step}`]);
  });

  it("carries the player's installs, hand actions, and repairs to the season, each answered after the new picture of the world", async () => {
    const c = makeFor(m2);
    await c.startSeason(1);
    const events: ControllerEvent[] = [];
    c.onEvent((event) => events.push(event));
    const facility = (id: string) => c.latestSnapshot()!.facilities.find((f) => f.id === id)!;
    expect(facility('F1').tier).toBe(0);
    expect(await c.install('F1', 'board')).toEqual({ ok: true });
    expect(facility('F1').tier).toBe(1); // already in date when the install is answered
    expect(c.latestSnapshot()!.money).toBe(m2.startMoney - m2.tuning.install.boardPrice.farm);
    expect(facility('DA').datacenter?.processing).toBe(false);
    expect(await c.hand('DA', { kind: 'process' })).toEqual({ ok: true }); // a datacenter is worked by hand without a board
    expect(facility('DA').datacenter?.processing).toBe(true); // at once, while the game stands still
    // Refused, each with the code the viewer says in Korean; none changes the world.
    expect(await c.install('F1', 'board')).toMatchObject({
      ok: false,
      refusal: { code: 'alreadyInstalled', facility: 'F1', part: 'board' },
    });
    expect(await c.install('H1', 'board')).toMatchObject({ ok: false, refusal: { code: 'takesNoBoard', facility: 'H1' } });
    expect(await c.install('ZZ', 'board')).toMatchObject({ ok: false, refusal: { code: 'unknownFacility', facility: 'ZZ' } });
    expect(await c.hand('F1', { kind: 'harvest' })).toMatchObject({ ok: false, refusal: { code: 'cannotAct', facility: 'F1' } }); // nothing is ripe yet
    expect(await c.repair('DA')).toMatchObject({ ok: false, refusal: { code: 'notWrecked', facility: 'DA' } });
    expect(events.map(line)).toEqual(['snapshot 0', 'snapshot 0']);
  });

  it('does what the player gave by hand, and says what a facility cannot do in the action it was asked for', async () => {
    const c = makeFor(m2);
    await c.startSeason(1);
    const dc = () => c.latestSnapshot()!.facilities.find((f) => f.id === 'DA')!.datacenter!;
    expect(await c.hand('DA', { kind: 'cool' })).toEqual({ ok: true });
    expect(dc()).toMatchObject({ cooling: true, processing: false });
    expect(await c.hand('DA', { kind: 'process' })).toEqual({ ok: true });
    expect(dc()).toMatchObject({ cooling: true, processing: true });
    expect(await c.hand('F1', { kind: 'harvest' })).toMatchObject({
      ok: false,
      refusal: { code: 'cannotAct', facility: 'F1', detail: 'nothing is ripe' },
    });
    expect(await c.hand('DA', { kind: 'harvest' })).toMatchObject({
      ok: false,
      refusal: { code: 'cannotAct', facility: 'DA', detail: expect.stringContaining('harvest') },
    });
  });

  it('takes a deploy from the player for any board, refuses one for a facility without a board, and says who deployed', async () => {
    const c = makeFor(m2);
    await c.startSeason(1);
    const deploys: string[] = [];
    c.onEvent((event) => {
      if (event.kind === 'deploy') deploys.push(`${event.board} v${event.version} by ${event.by}`);
    });
    const refused = await c.deploy('F1', 'function tick() end').catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(ToolError);
    expect((refused as ToolError).message).toBe('F1 has no board: install one from its panel first');
    expect((refused as ToolError).refusal).toEqual({ code: 'noBoard', facility: 'F1' });
    // Housing takes no board, and ZZ is nothing: each is an unknown board, not one that could be bought.
    for (const id of ['H1', 'ZZ']) {
      const unknown = await c.deploy(id, 'function tick() end').catch((error: unknown) => error);
      expect(unknown).toBeInstanceOf(ToolError);
      expect((unknown as ToolError).refusal).toEqual({ code: 'unknownBoard', board: id });
    }
    expect(await c.install('F1', 'board')).toEqual({ ok: true });
    expect(await c.deploy('F1', 'function tick() end')).toMatchObject({ ok: true, version: 1 });
    expect(await c.install('F1', 'comm')).toEqual({ ok: true });
    expect(await gameApi(c).deploy('F1', 'function tick() end')).toMatchObject({ ok: true, version: 2 });
    expect(deploys).toEqual(['F1 v1 by player', 'F1 v2 by agent']);
  });

  it('does not take a snapshot sent between batches for the answer to a batch', async () => {
    const c = makeFor(calmScenario(), { watchdogMs: 200 }); // a town that lives through the 600 seconds
    c.setAgent(AGENT);
    await c.startSeason(1);
    const first = c.latestSnapshot()!;
    const run = c.runUntil({ seconds: 600 }); // a batch is out
    // The worker says how the world stands between batches: the batch waiter and the watchdog belong to the batch.
    inside(c).worker!.emit('message', { type: 'snapshot', snapshot: { ...first, money: 1234 } });
    expect(c.latestSnapshot()!.money).toBe(1234);
    await expect(c.runUntil({ seconds: 1 })).rejects.toThrow('already running'); // the batch is still out
    await run;
    expect(c.status()).toMatchObject({ state: 'paused', crash: null });
    expect(c.latestSnapshot()!.step).toBe(12_000);
  });
});

describe('GameController: requests', () => {
  it('refuses a deploy, an install, and a rebuild while there is no season, and a read and each of them while one starts', async () => {
    const c = make();
    c.setAgent(AGENT);
    await expect(c.deploy('DA', 'function tick() end')).rejects.toBeInstanceOf(ToolError);
    await expect(c.rebuild('DA')).rejects.toBeInstanceOf(ToolError);
    await expect(c.install('DA', 'comm')).rejects.toBeInstanceOf(ToolError);
    const starting = c.startSeason(1);
    await expect(c.listBoards()).rejects.toBeInstanceOf(ToolError);
    await expect(c.deploy('DA', 'function tick() end')).rejects.toBeInstanceOf(ToolError);
    await expect(c.rebuild('DA')).rejects.toBeInstanceOf(ToolError);
    await expect(c.install('DA', 'comm')).rejects.toBeInstanceOf(ToolError);
    await starting;
    expect(await c.listBoards()).toHaveLength(3);
    const replacing = c.startSeason(2); // the same while a season that is paused is being replaced
    await expect(c.listBoards()).rejects.toBeInstanceOf(ToolError);
    await replacing;
    expect(await c.listBoards()).toHaveLength(3);
  });

  it('refuses a deploy whose season was replaced while its code was being checked, and the new season goes on', async () => {
    const c = make();
    c.setAgent(AGENT);
    await c.startSeason(1);
    const checking = holdChecker(c);
    const deploying = c.deploy('DA', 'function tick() end').catch((error: unknown) => error);
    const restarting = c.startSeason(2); // the first deploy of a server waits for the checker to load: the season changes meanwhile
    checking.release(); // the new worker is still starting: a deploy posted to it would crash it ("no season for deploy")
    const refusal = await deploying;
    expect(refusal).toBeInstanceOf(ToolError);
    expect((refusal as ToolError).message).toBe('A new season started while the code was being checked; deploy it again.');
    await restarting;
    expect(c.status()).toMatchObject({ state: 'paused', crash: null });
    expect(await c.listBoards()).toMatchObject([{}, { board: { firmwareVersion: null, pendingVersion: null } }, {}]); // and nothing landed in it
    await expect(c.deploy('DA', 'function tick() end')).resolves.toMatchObject({ ok: true, version: 1 });
  });

  it('refuses a deploy whose season crashed while its code was being checked, instead of waiting for ever', async () => {
    const c = make();
    c.setAgent(AGENT);
    await c.startSeason(1);
    const checking = holdChecker(c);
    const deploying = c.deploy('DA', 'function tick() end').catch((error: unknown) => error);
    inside(c).worker!.emit('error', new Error('the thread died'));
    checking.release();
    const refusal = await Promise.race([deploying, sleep(1000).then(() => 'still waiting')]);
    expect(refusal).toBeInstanceOf(ToolError);
    expect((refusal as ToolError).message).toBe(
      'The season crashed (the simulator failed: the thread died). The player can start a new season.',
    );
  });

  it('tells the agent that the season crashed, and why, where it said that the season had not started', async () => {
    const c = make({ watchdogMs: 1 });
    c.setAgent(AGENT);
    await c.startSeason(1);
    await expect(c.runUntil({ seconds: 600 })).rejects.toThrow('stopped');
    const calls = [
      () => c.listBoards(),
      () => c.manual('DA'),
      () => c.firmware('DA'),
      () => c.logs('DA', undefined),
      () => c.map(),
      () => c.statusOf(),
      () => c.alerts(undefined),
      () => c.inspect('DA'),
      () => c.deploy('DA', 'function tick() end'),
      () => c.install('DA', 'comm'),
      () => c.repair('DA'),
      () => c.rebuild('DA'),
      () => c.hand('DA', { kind: 'process' }),
    ];
    for (const call of calls) {
      const refusal = await call().catch((error: unknown) => error);
      expect(refusal).toBeInstanceOf(ToolError);
      expect((refusal as ToolError).message).toBe(
        'The season crashed (the simulator stopped responding; the session stopped). The player can start a new season.',
      );
    }
    // Before the first season, and while one starts, there is no crash to name.
    const fresh = makeFor(scenario);
    await expect(fresh.listBoards()).rejects.toThrow("The season hasn't started: ask the player to press Start.");
    await expect(fresh.deploy('DA', 'function tick() end')).rejects.toThrow("The season hasn't started: ask the player to press Start.");
  });

  it('gives each refusal the code that the viewer says in Korean: no season, and a crashed season with its reason', async () => {
    const c = make({ watchdogMs: 1 });
    const refusalOf = (error: unknown) => (error instanceof ToolError ? error.refusal : 'not a ToolError');
    const play = (): Promise<unknown> =>
      Promise.resolve()
        .then(() => c.play())
        .catch((e: unknown) => e);
    // No season yet: nothing to play, read, install, or rebuild.
    expect(refusalOf(await play())).toEqual({ code: 'noSeason' });
    expect(refusalOf(await c.listBoards().catch((e: unknown) => e))).toEqual({ code: 'noSeason' });
    expect(refusalOf(await c.rebuild('DA').catch((e: unknown) => e))).toEqual({ code: 'noSeason' });
    expect(refusalOf(await c.install('DA', 'comm').catch((e: unknown) => e))).toEqual({ code: 'noSeason' });
    // A crashed one.
    await c.startSeason(1);
    await expect(c.runUntil({ seconds: 600 })).rejects.toThrow('stopped');
    const crashed = { code: 'crashed', reason: 'the simulator stopped responding; the session stopped' };
    expect(refusalOf(await c.inspect('DA').catch((e: unknown) => e))).toEqual(crashed);
    expect(refusalOf(await play())).toEqual(crashed);
  });

  it('refuses everything after the session failed, until the next season starts', async () => {
    const c = make({ watchdogMs: 1 });
    c.setAgent(AGENT);
    await c.startSeason(1);
    await expect(c.runUntil({ seconds: 600 })).rejects.toThrow('stopped');
    await expect(c.listBoards()).rejects.toBeInstanceOf(ToolError);
    await expect(c.deploy('DA', 'function tick() end')).rejects.toBeInstanceOf(ToolError);
    expect(() => c.play()).toThrow('The season crashed');
    await c.startSeason(1);
    expect(c.status()).toMatchObject({ state: 'paused', crash: null });
    expect(await c.listBoards()).toHaveLength(3);
  });

  it('answers concurrent reads, each with its own answer', async () => {
    const c = make();
    c.setAgent(AGENT);
    await c.startSeason(1);
    expect(await c.install('DB', 'comm')).toEqual({ ok: true });
    const [boards, map, status, manual] = await Promise.all([c.listBoards(), c.map(), c.statusOf(), c.manual('DB')]);
    expect(boards).toHaveLength(3);
    expect(map.width).toBe(20);
    expect(status.time.seconds).toBe(0);
    expect(manual).toContain('DB');
    expect(manual).toContain('# DB 보드 매뉴얼');
  });

  it('answers each read of the agent tools and of the viewer from the season', async () => {
    const c = make();
    c.setAgent(AGENT);
    await c.startSeason(1);
    for (const id of ['DA', 'DB']) expect(await c.install(id, 'comm')).toEqual({ ok: true });
    await c.deploy('DA', FAILING);
    await c.deploy('DB', 'function tick(io) io.log("hello") end');
    await c.runUntil({ seconds: 5 });
    const api = gameApi(c);
    expect(await api.firmware('DA')).toEqual({ version: 1, source: FAILING, pending: null });
    expect(await api.firmware('ZZ')).toBeNull();
    expect(await api.manual('DA')).toContain('# DA 보드 매뉴얼: 데이터센터');
    expect(await api.manual('DB')).toContain('# DB 보드 매뉴얼: 데이터센터');
    expect(await api.manual('ZZ')).toBeNull();
    expect((await api.logs('DA', undefined))?.filter((l) => l.kind !== 'system').map((l) => l.kind)).toEqual(['error']);
    expect((await api.logs('DA', 1))?.map((l) => l.kind)).toEqual(['error']);
    expect(await api.logs('DA', 1000)).toEqual([]);
    expect((await api.logs('DB', undefined))?.map((l) => l.text)).toContain('hello');
    expect(await api.logs('ZZ', undefined)).toBeNull();
    expect(await api.map()).toMatchObject({ width: 20, height: 12 });
    expect((await api.map()).facilities.map((f) => f.id)).toEqual(['P', 'DA', 'DB']);
    expect((await api.alerts(undefined)).map((a) => `${a.kind}@${a.facility}`)).toEqual(['firmwareError@DA']);
    expect(await api.alerts(1000)).toEqual([]);
    const inspection = await c.inspect('DA');
    expect(inspection?.firmware).toEqual({ version: 1, source: FAILING });
    expect(inspection?.parts.clockHz).toBe(5);
    expect(await c.inspect('ZZ')).toBeNull();
  });

  it('keeps the reason a deploy failed to install in what the agent reads, where only "no tick function" used to be left', async () => {
    const c = make();
    c.setAgent(AGENT);
    await c.startSeason(1);
    await c.deploy('DA', 'local x = nil_function()\nfunction tick(io, mem) end');
    await c.runUntil({ seconds: 2 }); // DA beats every 4 steps: the install tick, then nine that find no tick()
    const why = "firmware:1: attempt to call a nil value (global 'nil_function')";
    const da = (await c.listBoards()).find((b) => b.id === 'DA')!;
    expect(da.board!.lastError).toBe(`noTick: the last deploy failed to install: ${why}`);
    const errors = (await c.inspect('DA'))!.logs.filter((l) => l.kind === 'error');
    expect(errors.map((l) => l.text)).toEqual([`runtime: ${why}`, `noTick: the last deploy failed to install: ${why}`]);
    expect(errors[1]!.repeat).toBe(9);
  });

  it("says when a deploy installs: at the board's next tick, which comes after a sleep, or after a repair and a rebuild", async () => {
    const c = make();
    await c.startSeason(1);
    const installsAt = async (board: string): Promise<string> => {
      const outcome = await c.deploy(board, 'function tick() end');
      if (!outcome.ok) throw new Error('refused');
      return outcome.installsAt;
    };
    expect(await installsAt('DB')).toBe("the board's next tick");
    // DA sleeps from its first beat (step 3) for 30 seconds.
    await c.deploy('DA', 'function tick(io) io.sleep(30) end');
    await c.runUntil({ seconds: 1 });
    expect((await c.listBoards()).find((b) => b.id === 'DA')?.board?.status).toBe('asleep');
    expect(await installsAt('DA')).toBe("the board's next tick, after it wakes");
    // No firmware elsewhere, so the Luddites wreck a facility in the fifth game day, and its board with it.
    await c.runUntil({ alertKinds: ['wrecked'] });
    const lost = (await c.alerts(undefined)).find((a) => a.kind === 'wrecked')!.facility!;
    expect(await installsAt(lost)).toBe("the board's next tick, after the player rebuilds it");
    expect(await c.repair(lost)).toEqual({ ok: true });
    await c.runUntil({ seconds: 21 }); // a repair takes 20 game seconds
    expect(await c.rebuild(lost)).toEqual({ ok: true });
    expect(await installsAt(lost)).toBe("the board's next tick, after its rebuild finishes");
  });

  it('says that a deploy to a board the grid has shed waits for its power', async () => {
    // Wind 20 feeds the plant (5) and DA (10) but not DB (13 with its transmission loss): DB is shed from the first step.
    const raw = JSON.parse(readFileSync('scenarios/m1-power.json', 'utf8'));
    raw.tuning.wind = { ...raw.tuning.wind, start: 20, maxChangePerSecond: 0 };
    const c = makeFor(parseScenario(raw));
    c.setAgent(AGENT);
    await c.startSeason(1);
    await c.runUntil({ seconds: 1 });
    const boards = await c.listBoards();
    expect(boards.map((b) => [b.id, b.board?.status, b.board?.powered])).toEqual([
      ['P', 'running', true],
      ['DA', 'running', true],
      ['DB', 'running', false],
    ]);
    const outcome = async (board: string) => (await c.deploy(board, 'function tick() end')) as { ok: true; installsAt: string };
    expect((await outcome('DA')).installsAt).toBe("the board's next tick");
    expect((await outcome('DB')).installsAt).toBe("the board's next tick, after its power returns");
  });

  it('tells when a deploy installs from what the board is doing and whether the grid supplies it', () => {
    const next = "the board's next tick";
    expect(installsAt('running', true)).toBe(next);
    expect(installsAt('running', false)).toBe(`${next}, after its power returns`);
    expect(installsAt('asleep', true)).toBe(`${next}, after it wakes`);
    expect(installsAt('asleep', false)).toBe(`${next}, after it wakes and its power returns`);
    // A board that is smashed or being rebuilt draws nothing, so the grid's flag says nothing about it: the rebuild comes first.
    for (const powered of [true, false]) {
      expect(installsAt('destroyed', powered)).toBe(`${next}, after the player rebuilds it`);
      expect(installsAt('rebuilding', powered)).toBe(`${next}, after its rebuild finishes`);
    }
  });

  it("hands over the Lua checker's message for a syntax error, and says when a deploy installs", async () => {
    const c = make();
    c.setAgent(AGENT);
    await c.startSeason(1);
    expect(await c.deploy('DA', 'function tick( end')).toMatchObject({ ok: false, error: expect.stringMatching(/^firmware:1:/) });
    expect(await c.deploy('DA', 'function tick() end')).toEqual({ ok: true, version: 1, installsAt: "the board's next tick" });
  });

  it('repairs a wrecked facility before it rebuilds its board, and says why it cannot do either for another', async () => {
    const c = make();
    await c.startSeason(1);
    expect(await c.rebuild('DA')).toEqual({ ok: false, reason: 'DA is not destroyed', refusal: { code: 'notDestroyed', board: 'DA' } });
    expect(await c.rebuild('ZZ')).toEqual({ ok: false, reason: 'unknown board ZZ', refusal: { code: 'unknownBoard', board: 'ZZ' } });
    expect(await c.repair('DA')).toEqual({ ok: false, reason: 'DA is not wrecked', refusal: { code: 'notWrecked', facility: 'DA' } });
    expect(await c.repair('ZZ')).toEqual({
      ok: false,
      reason: 'unknown facility ZZ',
      refusal: { code: 'unknownFacility', facility: 'ZZ' },
    });
    await c.runUntil({ alertKinds: ['wrecked'] }); // no firmware: the Luddites wreck a facility in the fifth game day
    const lost = (await c.alerts(undefined)).find((a) => a.kind === 'wrecked')!.facility!;
    expect((await c.listBoards()).find((b) => b.id === lost)).toMatchObject({ condition: 'wrecked', board: { status: 'destroyed' } });
    expect(await c.rebuild(lost)).toEqual({
      ok: false,
      reason: `${lost} must be repaired before its board is rebuilt`,
      refusal: { code: 'repairFirst', facility: lost },
    });
    expect(await c.repair(lost)).toEqual({ ok: true });
    expect((await c.listBoards()).find((b) => b.id === lost)?.condition).toBe('repairing');
    expect(await c.repair(lost)).toEqual({ ok: false, reason: `${lost} is not wrecked`, refusal: { code: 'notWrecked', facility: lost } });
    await c.runUntil({ seconds: 21 }); // a repair takes 20 game seconds
    expect(await c.rebuild(lost)).toEqual({ ok: true });
    expect((await c.listBoards()).find((b) => b.id === lost)?.board?.status).toBe('rebuilding');
    expect(await c.rebuild(lost)).toEqual({
      ok: false,
      reason: `${lost} is not destroyed`,
      refusal: { code: 'notDestroyed', board: lost },
    });
  });

  it('runs for the game seconds it is given from where it is, and until an alert of a picked kind', async () => {
    const c = make();
    c.setAgent(AGENT);
    await c.startSeason(1);
    await c.runUntil({ seconds: 1 });
    await c.runUntil({ seconds: 1 });
    expect(c.latestSnapshot()!.step).toBe(40);
    await c.deploy('DA', FAILING);
    await c.runUntil({ seconds: 30, alertKinds: ['fire'] }); // an error in the firmware is not a fire: all 30 seconds run
    expect(c.latestSnapshot()!.step).toBe(640);
    await c.startSeason(1);
    await c.deploy('DA', FAILING);
    await c.runUntil({ seconds: 600, alertKinds: ['firmwareError'] }); // stops with the batch that raised it
    expect(c.latestSnapshot()!.step).toBe(200);
  });

  it('starts the season from the seed it is given', async () => {
    const c = make();
    c.setAgent(AGENT);
    const winds: number[] = [];
    for (const seed of [1, 2, 1]) {
      await c.startSeason(seed);
      await c.runUntil({ seconds: 10 });
      winds.push(c.latestSnapshot()!.plant.wind);
    }
    expect(winds[1]).not.toBe(winds[0]);
    expect(winds[2]).toBe(winds[0]);
  });

  it('fails what is still waiting on the worker when it goes, so no caller hangs', async () => {
    const c = make();
    c.setAgent(AGENT);
    await c.startSeason(1);
    const read = c.listBoards();
    const run = c.runUntil({ seconds: 600 });
    const replaced = c.startSeason(2);
    await expect(read).rejects.toThrow('a new season started');
    await expect(run).rejects.toThrow('a new season started');
    await replaced;

    const first = c.startSeason(3);
    const second = c.startSeason(4);
    await expect(first).rejects.toThrow('a new season started');
    await second;

    const starting = c.startSeason(5);
    c.close();
    await expect(starting).rejects.toThrow('shutting down');
  });

  it('stops the session with the reason when the worker fails to start the season', async () => {
    const c = makeFor({ ...scenario, facilities: [] } as unknown as Scenario);
    c.setAgent(AGENT);
    await expect(c.startSeason(1)).rejects.toThrow(/the simulator failed: .*exactly one power plant is required/s);
    expect(c.status().state).toBe('crashed');
    expect(c.status().crash).toMatch(/the simulator failed: .*exactly one power plant is required/s);
    await expect(c.listBoards()).rejects.toBeInstanceOf(ToolError);
  });

  it('terminates the worker when a season is replaced, when the session fails, and when the server closes', async () => {
    const terminate = vi.spyOn(Worker.prototype, 'terminate');
    try {
      const c = make({ watchdogMs: 1 });
      c.setAgent(AGENT);
      await c.startSeason(1);
      expect(terminate).toHaveBeenCalledTimes(0);
      await c.startSeason(2);
      expect(terminate).toHaveBeenCalledTimes(1);
      await expect(c.runUntil({ seconds: 600 })).rejects.toThrow('stopped');
      expect(terminate).toHaveBeenCalledTimes(2);
      await c.startSeason(3);
      expect(terminate).toHaveBeenCalledTimes(2); // the failed session had no worker left to terminate
      c.close();
      expect(terminate).toHaveBeenCalledTimes(3);
    } finally {
      terminate.mockRestore();
    }
  });

  it('does not apply what a worker had already posted to the season that replaced it', async () => {
    const c = make();
    c.setAgent(AGENT);
    await c.startSeason(1);
    await c.runUntil({ seconds: 1 }); // the worker is warm now: a batch takes about a millisecond
    const run = c.runUntil({ seconds: 1 }).catch(() => undefined); // a batch is out
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200); // and answered while this thread is blocked: the answer waits unread
    const events: ControllerEvent[] = [];
    c.onEvent((event) => events.push(event));
    await c.startSeason(2); // Node still delivers a stopped worker's unread messages
    await run;
    await sleep(50);
    expect(events.map(line)).toEqual(['snapshot 0', 'status paused']);
    expect(c.latestSnapshot()!.step).toBe(0);
  });

  it('ignores everything a worker says as it is being stopped', async () => {
    const c = make();
    c.setAgent(AGENT);
    await c.startSeason(1);
    const stopped = inside(c).worker!;
    const last = { ...c.latestSnapshot()!, step: 999, ended: { kind: 'bankrupt' as const, step: 999 } };
    const next = c.startSeason(2); // the first worker is being stopped, the second is starting
    stopped.emit('message', { type: 'started', snapshot: last });
    stopped.emit('message', { type: 'advanced', snapshot: last, alerts: [] });
    stopped.emit('message', { type: 'fatal', message: 'the first worker died' });
    stopped.emit('error', new Error('the first worker died'));
    await next;
    expect(c.status()).toMatchObject({ state: 'paused', crash: null });
    expect(c.latestSnapshot()!.step).toBe(0);
    expect(await c.listBoards()).toHaveLength(3);
  });

  it('ignores the last answer of a worker the watchdog stopped', async () => {
    const c = make({ watchdogMs: 1 });
    c.setAgent(AGENT);
    await c.startSeason(1);
    const stopped = inside(c).worker!;
    const late = { ...c.latestSnapshot()!, step: 999, ended: { kind: 'bankrupt' as const, step: 999 } };
    const heard: ControllerEvent[] = [];
    c.onEvent((event) => {
      heard.push(event);
      // The answer to the batch that outlived the limit is delivered as the session stops.
      if (event.kind === 'status' && event.status.state === 'crashed')
        stopped.emit('message', { type: 'advanced', snapshot: late, alerts: [] });
    });
    await expect(c.runUntil({ seconds: 600 })).rejects.toThrow('stopped');
    expect(c.status().state).toBe('crashed');
    expect(c.latestSnapshot()!.step).toBe(0);
    expect(heard.map(line)).toEqual(['status crashed']);
  });
});

describe('GameController: the watchdog', () => {
  it('does not stop a session whose batch was answered while the process stood still, though the timer fell due first', async () => {
    const c = make({ watchdogMs: 100 });
    c.setAgent(AGENT);
    await c.startSeason(1);
    await c.runUntil({ seconds: 1 }); // the worker is warm now: a batch takes about a millisecond
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }); // the watchdog's timer is driven by hand
    try {
      const run = c.runUntil({ seconds: 1 }); // a batch is out
      // The process stood still: the worker answered, nothing has read the answer, and the timer is overdue. The loop that turns
      // again runs the timer first: the timers come before the poll that reads the worker's message.
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
      vi.advanceTimersByTime(100);
      await run;
    } finally {
      vi.useRealTimers();
    }
    expect(c.status()).toMatchObject({ state: 'paused', crash: null });
    expect(c.latestSnapshot()!.step).toBe(40);
  });

  it('stops a session whose batch is still out a turn of the event loop after the timer fell due', async () => {
    const c = make({ watchdogMs: 100 });
    c.setAgent(AGENT);
    await c.startSeason(1);
    const unanswered = vi.spyOn(inside(c).worker!, 'postMessage').mockImplementation(() => undefined); // the worker never hears of the batch
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const run = c.runUntil({ seconds: 1 }).catch((error: unknown) => error);
      vi.advanceTimersByTime(100);
      expect(c.status().state).toBe('paused'); // not at once: the answer, if there is one, is read first
      await expect(run).resolves.toMatchObject({ message: expect.stringContaining('stopped responding') });
    } finally {
      vi.useRealTimers();
      unanswered.mockRestore();
    }
    expect(c.status()).toMatchObject({ state: 'crashed', crash: 'the simulator stopped responding; the session stopped' });
  });

  // The process stood still (Ctrl+Z and fg, a debugger) with a batch out: the worker thread stood still with it, so when the timer, due
  // long ago, is run first on resume, the worker has not yet had the time to post its answer, and a re-check one turn later is too soon.
  // The tests stand the main thread still for real (the timer's lateness is read from the real clock) and drive the timer by hand.
  describe('after the process stood still', () => {
    const STAND_STILL_MS = 1500; // more than the limit past which a late timer is taken for a stopped process: 1 s
    const stall = (ms: number): void => void Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
    const turns = async (n = 3): Promise<void> => {
      for (let i = 0; i < n; i++) await new Promise((resolve) => setImmediate(resolve));
    };
    /** A season whose next message to the worker is held back, and the way to let it through; timers are the test's from here on. */
    async function holdingTheNextBatch(): Promise<{ c: GameController; release: () => void; run: Promise<unknown> }> {
      const c = make({ watchdogMs: 100 });
      c.setAgent(AGENT);
      await c.startSeason(1);
      const worker = inside(c).worker!;
      const post = worker.postMessage.bind(worker);
      const held: unknown[] = [];
      const hold = vi.spyOn(worker, 'postMessage').mockImplementation((message: unknown) => void held.push(message));
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const run = c.runUntil({ seconds: 1 }).catch((error: unknown) => error);
      return {
        c,
        run,
        release: () => {
          hold.mockRestore();
          for (const message of held) post(message as never);
        },
      };
    }
    afterEach(() => {
      vi.useRealTimers();
    });

    it('gives the batch a fresh period when the timer falls due long after it was due, and lets its answer land', async () => {
      const { c, release, run } = await holdingTheNextBatch();
      stall(STAND_STILL_MS);
      vi.advanceTimersByTime(100); // the timer runs 1.4 s late: the process was stopped, the worker with it
      await turns();
      expect(c.status()).toMatchObject({ state: 'paused', crash: null });
      release(); // the worker is running again, and answers
      vi.useRealTimers();
      expect(await run).toBeUndefined();
      expect(c.status()).toMatchObject({ state: 'paused', crash: null });
      expect(c.latestSnapshot()!.step).toBe(20);
    });

    it('still stops a session whose batch is out when the timer falls due only a little late', async () => {
      const { c, run } = await holdingTheNextBatch();
      stall(300); // 200 ms late: a busy moment, not a stopped process
      vi.advanceTimersByTime(100);
      expect(c.status().state).toBe('paused'); // after the re-check, as for a timer on time
      await expect(run).resolves.toMatchObject({ message: expect.stringContaining('stopped responding') });
      expect(c.status()).toMatchObject({ state: 'crashed', crash: 'the simulator stopped responding; the session stopped' });
    });

    it('stops a session whose batch is still out when the fresh period runs out on time', async () => {
      const { c, run } = await holdingTheNextBatch();
      stall(STAND_STILL_MS);
      vi.advanceTimersByTime(100); // late: the batch gets another period
      await turns();
      expect(c.status().state).toBe('paused');
      vi.advanceTimersByTime(100); // the new period runs out on time and the worker has still not answered: it hangs
      expect(c.status().state).toBe('paused'); // the re-check comes first
      await expect(run).resolves.toMatchObject({ message: expect.stringContaining('stopped responding') });
      expect(c.status()).toMatchObject({ state: 'crashed', crash: 'the simulator stopped responding; the session stopped' });
    });
  });

  it('arms a watchdog for every batch, with the limit it is given and 5 seconds by default', async () => {
    const timeouts = vi.spyOn(globalThis, 'setTimeout');
    try {
      for (const [options, limit] of [
        [{}, 5000],
        [{ watchdogMs: 1234 }, 1234],
      ] as const) {
        timeouts.mockClear();
        const c = make(options);
        c.setAgent(AGENT);
        await c.startSeason(1);
        await c.runUntil({ seconds: 1 });
        expect(timeouts.mock.calls.map((call) => call[1])).toContain(limit);
        c.close();
      }
    } finally {
      timeouts.mockRestore();
    }
  });

  it('does not mistake a long healthy run for a hang', async () => {
    // The batches of a whole 30-day season add up to more than the limit, though none comes near it: a watchdog that was
    // never disarmed would fire at the limit after the first batch.
    const c = makeFor(calmScenario(), { watchdogMs: 200 });
    c.setAgent(AGENT);
    await c.startSeason(1);
    await c.deploy('DA', BUSY);
    await c.deploy('DB', BUSY);
    await c.runUntil({});
    expect(c.status()).toMatchObject({ state: 'ended', crash: null });
    expect(c.latestSnapshot()?.ended?.kind).toBe('completed');
  });

  it('does not let the watchdog of a replaced season stop the new one', async () => {
    const c = make({ watchdogMs: 150 });
    c.setAgent(AGENT);
    await c.startSeason(1);
    await c.deploy('DA', BUSY);
    const run = c.runUntil({ seconds: 600 }).catch(() => undefined); // a batch is always on its way
    await c.startSeason(2);
    await run;
    await sleep(300); // longer than the old limit
    expect(c.status()).toMatchObject({ state: 'paused', crash: null });
  });

  it('names the board and the firmware version a tick was stuck in, and no board when none was', async () => {
    const stuck: Array<[number, number, string]> = [
      [0, 3, 'the simulator stopped responding while P ran firmware v3; the session stopped'],
      [1, 7, 'the simulator stopped responding while DA ran firmware v7; the session stopped'],
    ];
    const c = make({ watchdogMs: 1 });
    c.setAgent(AGENT);
    await c.startSeason(1);
    await expect(c.runUntil({ seconds: 600 })).rejects.toThrow('stopped');
    expect(c.status().crash).toBe('the simulator stopped responding; the session stopped');
    c.close();
    for (const [board, version, message] of stuck) {
      const d = make({ watchdogMs: 1 });
      d.setAgent(AGENT);
      await d.startSeason(1);
      // No firmware is installed, so no tick runs and nothing else writes the progress array: set what a stuck tick would have left.
      Atomics.store(inside(d).progress, 0, board);
      Atomics.store(inside(d).progress, 1, version);
      await expect(d.runUntil({ seconds: 600 })).rejects.toThrow('stopped');
      expect(d.status()).toMatchObject({ state: 'crashed', crash: message });
      d.close();
    }
  });

  it('records which board and firmware version a tick is running, where the watchdog reads it', async () => {
    const c = make();
    c.setAgent(AGENT);
    await c.startSeason(1);
    await c.deploy('DA', BUSY); // position 1 in the scenario, firmware version 1
    const progress = inside(c).progress;
    const seen = new Set<string>();
    let done = false;
    const run = c.runUntil({ seconds: 60 }).finally(() => {
      done = true;
    });
    while (!done) {
      const board = Atomics.load(progress, 0);
      if (board >= 0) seen.add(`${board}:${Atomics.load(progress, 1)}`);
      await new Promise((resolve) => setImmediate(resolve)); // let the worker's answers in
    }
    await run;
    expect(seen.has('1:1')).toBe(true);
    expect([...seen].every((pair) => pair.startsWith('1:'))).toBe(true); // no other board has firmware to run
    expect(Atomics.load(progress, 0)).toBe(-1); // idle between ticks
  });
});

describe('a season through the controller', () => {
  const careless = loadFirmwareDir('scenarios/firmware/m2/careless');
  const careful = loadFirmwareDir('scenarios/firmware/m2/careful');

  it.each([
    { name: 'careless', firmware: careless, stepsPerBatch: 200 },
    { name: 'careful', firmware: careful, stepsPerBatch: 7 },
  ])(
    'ends where the headless runner says it does ($name firmware, $stepsPerBatch steps a batch)',
    async ({ firmware, stepsPerBatch }) => {
      const boards = Object.keys(firmware).sort();
      const headless = runSeason(m2, 3, await WasmoonHost.create(), firmware, { install: boards });
      const c = makeFor(m2, { stepsPerBatch });
      await c.startSeason(3);
      for (const board of boards) expect(await c.install(board, 'board')).toEqual({ ok: true });
      for (const board of boards) await c.deploy(board, firmware[board]!);
      await c.runUntil({});
      expect(c.latestSnapshot()?.ended).toEqual(headless.ended);
      expect(c.latestSnapshot()?.money).toBe(headless.money);
    },
    60_000,
  );
});
