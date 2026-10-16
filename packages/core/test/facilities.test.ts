import { describe, expect, it } from 'vitest';
import { MICRO } from '../src/fixed.ts';
import { stateHash } from '../src/hash.ts';
import { priorityOrder } from '../src/power.ts';
import { replay, Session } from '../src/session.ts';
import { findBoard, findFacility } from '../src/world.ts';
import { FakeHost } from './helpers/fake-host.ts';
import { m1Scenario, m2Scenario } from './helpers/scenarios.ts';

const DAY = 800;

/** The town, with no raids and a steady wind that powers everything, so that only what a test does changes it. */
function town(host = new FakeHost()): Session {
  return new Session(
    m2Scenario((j) => {
      j.tuning.emf.rumourThreshold = 1_000_000_000;
      j.tuning.wind.start = 220;
      j.tuning.wind.maxChangePerSecond = 0;
    }),
    1,
    host,
  );
}

function steps(s: Session, n: number): void {
  for (let i = 0; i < n; i++) s.step();
}

describe('facilities and installed boards', () => {
  it('lays out every facility of the town, each one working and powered, with no board until one is installed', () => {
    const s = town();
    expect(s.world.facilities.map((f) => [f.id, f.kind, f.condition, f.powered])).toEqual([
      ['H1', 'housing', 'ok', true],
      ['H2', 'housing', 'ok', true],
      ['P', 'power', 'ok', true],
      ['DA', 'datacenter', 'ok', true],
      ['W', 'warehouse', 'ok', true],
      ['DB', 'datacenter', 'ok', true],
      ['F1', 'farm', 'ok', true],
      ['F2', 'farm', 'ok', true],
      ['F3', 'farm', 'ok', true],
    ]);
    expect(s.world.facilities.map((f) => f.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(findFacility(s.world, 'H1')!.boardSpec).toBeNull();
    expect(findFacility(s.world, 'F1')!.boardSpec).toMatchObject({ clockHz: 1, instructionCap: 500, ramKb: 2 });
    expect(s.world.boards).toEqual([]);
  });

  it('starts the test scenario with its three boards installed, in scenario order', () => {
    const s = new Session(m1Scenario(), 1, new FakeHost());
    expect(s.world.boards.map((b) => [b.id, b.index, b.status, b.comm])).toEqual([
      ['P', 0, 'running', false],
      ['DA', 1, 'running', false],
      ['DB', 2, 'running', false],
    ]);
  });

  it('installs a board for its price: running, with no firmware, the facility worked by hand until a deploy', () => {
    const s = town();
    expect(s.install('F1', 'board')).toEqual({ ok: true });
    expect(s.world.money).toBe((5000 - 200) * MICRO);
    expect(s.world.ledger.installs).toBe(200 * MICRO);
    expect(findBoard(s.world, 'F1')).toMatchObject({
      id: 'F1',
      index: 6,
      kind: 'farm',
      status: 'running',
      comm: false,
      firmware: null,
      pending: null,
      period: 20,
      phase: 6,
    });
    expect(findBoard(s.world, 'F1')!.log.map((l) => l.text)).toEqual(['board installed']);
  });

  it("keeps the boards in the town's order, whatever order they were installed in", () => {
    const s = town();
    for (const id of ['F1', 'DB', 'P', 'W']) expect(s.install(id, 'board'), id).toEqual({ ok: true });
    expect(s.world.boards.map((b) => b.id)).toEqual(['P', 'W', 'DB', 'F1']);
  });

  it("ticks a board installed later on the beats its facility's place gives it, and names every facility to its firmware", () => {
    const host = new FakeHost();
    const src = host.program('noop', () => ({}));
    const s = town(host);
    s.install('DA', 'board'); // DA is facility 3: 5 Hz, period 4, phase 3 -> beats at steps 1, 5, 9, ...
    s.deploy('DA', src);
    steps(s, 1);
    expect(host.calls).toEqual([]);
    steps(s, 1);
    expect(host.calls).toEqual(['boot:DA', 'tick:DA']);
    expect(host.boots[0]!.facilityIds).toEqual(['H1', 'H2', 'P', 'DA', 'W', 'DB', 'F1', 'F2', 'F3']);
  });

  it('installs a comm module on a board for its price', () => {
    const s = town();
    s.install('P', 'board');
    expect(s.install('P', 'comm')).toEqual({ ok: true });
    expect(findBoard(s.world, 'P')!.comm).toBe(true);
    expect(s.world.money).toBe((5000 - 400 - 300) * MICRO);
    expect(s.world.ledger.installs).toBe(700 * MICRO);
    expect(findBoard(s.world, 'P')!.log.map((l) => l.text)).toEqual(['board installed', 'comm module installed']);
  });

  it('refuses an install it cannot make, with a code for the viewer, and changes nothing', () => {
    const s = town();
    s.install('P', 'board');
    s.install('P', 'comm');
    s.install('DB', 'board');
    findBoard(s.world, 'DB')!.status = 'destroyed';
    findFacility(s.world, 'W')!.condition = 'wrecked';
    const before = stateHash(s.world);
    expect(s.install('ZZ', 'board')).toEqual({
      ok: false,
      reason: 'unknown facility ZZ',
      refusal: { code: 'unknownFacility', facility: 'ZZ' },
    });
    expect(s.install('H1', 'board')).toEqual({ ok: false, reason: 'H1 takes no board', refusal: { code: 'takesNoBoard', facility: 'H1' } });
    expect(s.install('H1', 'comm')).toEqual({ ok: false, reason: 'H1 takes no board', refusal: { code: 'takesNoBoard', facility: 'H1' } });
    expect(s.install('P', 'board')).toEqual({
      ok: false,
      reason: 'P already has a board',
      refusal: { code: 'alreadyInstalled', facility: 'P', part: 'board' },
    });
    expect(s.install('P', 'comm')).toEqual({
      ok: false,
      reason: 'P already has a comm module',
      refusal: { code: 'alreadyInstalled', facility: 'P', part: 'comm' },
    });
    expect(s.install('F1', 'comm')).toEqual({ ok: false, reason: 'F1 has no board', refusal: { code: 'noBoard', facility: 'F1' } });
    expect(s.install('DB', 'comm')).toEqual({ ok: false, reason: "DB's board is down", refusal: { code: 'boardDown', facility: 'DB' } });
    expect(s.install('W', 'board')).toEqual({ ok: false, reason: 'W is wrecked', refusal: { code: 'wrecked', facility: 'W' } });
    expect(stateHash(s.world)).toBe(before);
    const money = s.world.money;
    s.world.money = 199 * MICRO;
    const poor = stateHash(s.world);
    expect(s.install('F1', 'board')).toEqual({ ok: false, reason: 'not enough money', refusal: { code: 'tooPoor' } });
    expect(stateHash(s.world)).toBe(poor);
    s.world.money = money;
    expect(s.record.inputs.filter((i) => i.kind === 'install')).toHaveLength(3); // only the three that went through
  });

  it('refuses an install once the season has ended', () => {
    const s = new Session(
      m2Scenario((j) => {
        j.time.secondsPerDay = 1;
        j.time.seasonDays = 1;
      }),
      1,
      new FakeHost(),
    );
    steps(s, 20);
    expect(s.world.ended?.kind).toBe('completed');
    expect(s.install('P', 'board')).toEqual({ ok: false, reason: 'the season has ended', refusal: { code: 'seasonEnded' } });
  });

  it('takes no firmware for a facility without a board, and records who deployed', () => {
    const s = town();
    expect(() => s.deploy('F1', 'x')).toThrow('F1 has no board');
    expect(() => s.deploy('ZZ', 'x')).toThrow('unknown board ZZ');
    s.install('F1', 'board');
    s.deploy('F1', 'a');
    s.deploy('F1', 'b', 'agent');
    expect(s.record.inputs.filter((i) => i.kind === 'deploy').map((i) => (i.kind === 'deploy' ? i.by : null))).toEqual(['player', 'agent']);
  });

  it('charges upkeep for installed boards only', () => {
    const bare = town();
    steps(bare, DAY);
    expect(bare.world.ledger.upkeep).toBe(0);
    const two = town();
    two.install('F1', 'board');
    two.install('F2', 'board');
    steps(two, DAY);
    expect(two.world.ledger.upkeep).toBe(20 * MICRO);
  });

  it('counts every facility but the plant as a consumer, in the order of the town', () => {
    const s = town();
    expect(priorityOrder(s.world).map((f) => f.id)).toEqual(['H1', 'H2', 'DA', 'W', 'DB', 'F1', 'F2', 'F3']);
    s.world.plant.priority = ['F3', 'DA'];
    expect(priorityOrder(s.world).map((f) => f.id)).toEqual(['F3', 'DA', 'H1', 'H2', 'W', 'DB', 'F1', 'F2']);
  });

  it('gives a board the power of its facility', () => {
    const s = new Session(
      m2Scenario((j) => {
        j.tuning.wind.start = 0;
        j.tuning.wind.maxChangePerSecond = 0;
      }),
      1,
      new FakeHost(),
    );
    s.install('F1', 'board');
    steps(s, 1);
    expect(findFacility(s.world, 'F1')!.powered).toBe(false);
    expect(findBoard(s.world, 'F1')!.powered).toBe(false);
    expect(s.world.plant.shed).toEqual(['H1', 'H2', 'F1']); // housing draws power of its own
  });

  it('does not end the season of a town that has no boards', () => {
    const s = town();
    steps(s, 10);
    expect(s.world.ended).toBeNull();
  });

  it('replays installs into the same state', () => {
    const live = town();
    live.install('P', 'board');
    steps(live, 10);
    live.install('P', 'comm');
    live.install('DA', 'board');
    steps(live, 30);
    const again = replay(live.scenario, live.seed, live.record, new FakeHost(), live.world.step);
    expect(stateHash(again.world)).toBe(stateHash(live.world));
    expect(live.record.inputs).toEqual([
      { step: 0, kind: 'install', facilityId: 'P', part: 'board' },
      { step: 10, kind: 'install', facilityId: 'P', part: 'comm' },
      { step: 10, kind: 'install', facilityId: 'DA', part: 'board' },
    ]);
  });
});
