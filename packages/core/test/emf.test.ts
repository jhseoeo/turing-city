import { describe, expect, it } from 'vitest';
import { diffuse, fieldTotal, tickEmission } from '../src/emf.ts';
import { Session } from '../src/session.ts';
import { cellIndex } from '../src/world.ts';
import { FakeHost } from './helpers/fake-host.ts';
import { m1Scenario } from './helpers/scenarios.ts';

function powered(host = new FakeHost()): Session {
  const s = new Session(
    m1Scenario((j) => {
      j.tuning.wind.start = 220;
      j.tuning.wind.maxChangePerSecond = 0;
    }),
    1,
    host,
  );
  s.world.plant.thermalSetting = 300;
  return s;
}

describe('EMF', () => {
  it('turns instructions and actions into emission', () => {
    const s = powered();
    const outcome = {
      ok: true,
      instructions: 500,
      actions: [{ kind: 'process' as const }, { kind: 'cool' as const, level: 1 }],
      logs: [],
      error: null,
      ramUsedBytes: 0,
    };
    expect(tickEmission(s.ctx, outcome)).toBe(5_000 + 20_000);
  });

  it('shares 0.5% per step with each neighbour and decays 0.5% per step', () => {
    const field = new Array<number>(25).fill(0);
    field[12] = 1_000_000; // the middle of 5 x 5
    diffuse(field, 5, 5, 10, 10, 20);
    expect(field[12]).toBe(975_100); // 1,000,000 - 4 x 5,000, then - 4,900
    for (const n of [7, 11, 13, 17]) expect(field[n]).toBe(4_975);
    expect(field.reduce((a, b) => a + b, 0)).toBe(995_000);
  });

  it('shares only with neighbours inside the map', () => {
    const field = new Array<number>(9).fill(0);
    field[0] = 1_000_000; // a corner of 3 x 3
    diffuse(field, 3, 3, 10, 10, 20);
    expect(field[1]).toBe(4_975);
    expect(field[3]).toBe(4_975);
    expect(field[0]).toBe(985_050); // 1,000,000 - 2 x 5,000, then - 4,950
  });

  it('adds base EMF for awake, powered boards only', () => {
    const s = powered();
    s.world.boards[2]!.status = 'asleep';
    s.step();
    const at = (id: string) => {
      const b = s.world.boards.find((x) => x.id === id)!;
      return s.world.emf[cellIndex(s.scenario, b.x, b.y)]!;
    };
    expect(at('P')).toBeGreaterThan(0);
    expect(at('DA')).toBeGreaterThan(0);
    expect(at('DB')).toBe(0);
  });

  it('makes a busy board louder than an idle one', () => {
    const host = new FakeHost();
    const busy = host.program('busy', () => ({ instructions: 1800, actions: [{ kind: 'process' }] }));
    const idle = host.program('idle', () => ({ instructions: 30 }));
    const s = powered(host);
    s.deploy('DA', busy);
    s.deploy('DB', idle);
    for (let i = 0; i < 20 * 30; i++) s.step();
    const cell = (id: string) => {
      const b = s.world.boards.find((x) => x.id === id)!;
      return s.world.emf[cellIndex(s.scenario, b.x, b.y)]!;
    };
    expect(cell('DA')).toBeGreaterThan(cell('DB') * 3);
    expect(fieldTotal(s.world)).toBeGreaterThan(0);
  });

  it('lets the field fade when the boards go quiet', () => {
    const s = powered();
    for (let i = 0; i < 200; i++) s.step();
    const loud = fieldTotal(s.world);
    for (const b of s.world.boards) b.status = 'asleep';
    for (let i = 0; i < 20 * 60; i++) s.step();
    expect(fieldTotal(s.world)).toBeLessThan(loud / 10);
  });

  it("feeds the emf sensor from the board's cell", () => {
    const host = new FakeHost();
    let seen: number | undefined;
    const probe = host.program('probe', (sensors) => {
      seen = sensors.emf;
      return {};
    });
    const s = powered(host);
    s.deploy('DA', probe);
    for (let i = 0; i < 40; i++) s.step();
    const da = s.world.boards[1]!;
    expect(seen).toBeGreaterThan(0);
    expect(seen).toBeLessThanOrEqual(s.world.emf[cellIndex(s.scenario, da.x, da.y)]! / 1000 + 1);
  });
});
