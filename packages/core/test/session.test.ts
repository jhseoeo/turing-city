import { describe, expect, it } from 'vitest';
import { MICRO } from '../src/fixed.ts';
import { stateHash } from '../src/hash.ts';
import { replay, Session } from '../src/session.ts';
import { FakeHost } from './helpers/fake-host.ts';
import { m1Scenario } from './helpers/scenarios.ts';

const SEED = 1234;

function run(session: Session, steps: number): void {
  for (let i = 0; i < steps; i++) session.step();
}

describe('Session', () => {
  it('starts with the scenario money and runs no firmware until a deploy', () => {
    const host = new FakeHost();
    const s = new Session(m1Scenario(), SEED, host);
    expect(s.world.money).toBe(5000 * MICRO);
    run(s, 40);
    expect(s.world.step).toBe(40);
    expect(host.calls).toEqual([]);
  });

  it('boots a board and installs a deploy on its next beat', () => {
    const host = new FakeHost();
    const src = host.program('noop', () => ({}));
    const s = new Session(m1Scenario(), SEED, host);
    // DA is facility 1: clock 5 Hz -> period 4, phase 1 -> beats at steps 3, 7, 11, ...
    expect(s.deploy('DA', src)).toEqual({ version: 1 });
    run(s, 3);
    expect(host.calls).toEqual([]);
    run(s, 1);
    expect(host.calls).toEqual(['boot:DA', 'tick:DA']);
    const da = s.world.boards[1]!;
    expect(da.firmware).toEqual({ version: 1, source: 'noop' });
    expect(da.pending).toBeNull();
    expect(s.world.stats.deploys).toBe(1);
    expect(da.log.at(-1)).toMatchObject({ kind: 'system', text: 'firmware v1 installed' });
  });

  it('hot-reloads: a second deploy keeps the VM and its mem', () => {
    const host = new FakeHost();
    const v1 = host.program('count', (_s, mem) => {
      mem.n = ((mem.n as number | undefined) ?? 0) + 1;
      return {};
    });
    const v2 = host.program('read', (_s, mem) => ({ logs: [`n=${String(mem.n)}`] }));
    const s = new Session(m1Scenario(), SEED, host);
    s.deploy('DA', v1);
    run(s, 12); // beats at 3, 7, 11
    s.deploy('DA', v2);
    run(s, 4); // beat at 15
    expect(host.calls.filter((c) => c === 'boot:DA')).toHaveLength(1);
    expect(s.world.boards[1]!.log.some((l) => l.kind === 'log' && l.text === 'n=3')).toBe(true);
  });

  it('logs firmware errors, folds repeats, and alerts once per streak', () => {
    const host = new FakeHost();
    const src = host.program('boom', () => ({ error: { kind: 'runtime', message: 'firmware:1: boom' } }));
    const s = new Session(m1Scenario(), SEED, host);
    s.deploy('DA', src);
    run(s, 12);
    const errors = s.world.boards[1]!.log.filter((l) => l.kind === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ text: 'runtime: firmware:1: boom', repeat: 3 });
    expect(s.world.alerts.filter((a) => a.kind === 'firmwareError')).toHaveLength(1);
  });

  it('applies the action setters within the scenario limits', () => {
    const host = new FakeHost();
    const plant = host.program('plant', () => ({
      actions: [
        { kind: 'setThermal', output: 999 },
        { kind: 'setPriority', order: ['DB', 'DA'] },
      ],
    }));
    const dc = host.program('dc', () => ({ actions: [{ kind: 'cool', level: 7 }, { kind: 'process' }, { kind: 'process' }] }));
    const s = new Session(m1Scenario(), SEED, host);
    s.deploy('P', plant);
    s.deploy('DA', dc);
    run(s, 4); // P beats at 0, DA at 3
    expect(s.world.plant.thermalSetting).toBe(300);
    expect(s.world.plant.priority).toEqual(['DB', 'DA']);
    expect(s.world.datacenters.DA).toMatchObject({ cooling: 3, jobFrom: 4, jobUntil: 7 });
  });

  it('sleeps a board, wipes its VM, and reboots it with the same firmware', () => {
    const host = new FakeHost();
    let ticks = 0;
    const src = host.program('nap', (_s, mem) => {
      ticks += 1;
      mem.seen = true;
      return ticks === 1 ? { actions: [{ kind: 'sleep', seconds: 2 }] } : {};
    });
    const s = new Session(m1Scenario(), SEED, host);
    s.deploy('DA', src);
    run(s, 4); // first beat at step 3 -> sleep 2 s = 40 steps -> wakes at step 43
    const da = s.world.boards[1]!;
    expect(da.status).toBe('asleep');
    expect(host.calls).toEqual(['boot:DA', 'tick:DA', 'shutdown:DA']);
    run(s, 40); // up to step 44: woke at 43, next beat 43 -> reboot + tick
    expect(da.status).toBe('running');
    expect(host.calls.slice(3)).toEqual(['boot:DA', 'tick:DA']);
    expect(da.log.map((l) => l.text)).toContain('sleeping 2 s (RAM wiped)');
    expect(host.boots[1]!.seed).not.toBe(host.boots[0]!.seed);
  });

  it('ends the season after its last step', () => {
    const s = new Session(
      m1Scenario((j) => {
        j.time.secondsPerDay = 1;
        j.time.seasonDays = 1;
      }),
      SEED,
      new FakeHost(),
    );
    run(s, 25);
    expect(s.world.ended).toEqual({ kind: 'completed', step: 19 });
    expect(s.world.step).toBe(20);
    expect(s.world.alerts.at(-1)?.kind).toBe('seasonEnd');
  });

  it('replays a record into the same state', () => {
    const makeHost = (): FakeHost => {
      const h = new FakeHost();
      h.program('a', () => ({ actions: [{ kind: 'process' }], logs: ['a'] }));
      h.program('b', () => ({ actions: [{ kind: 'cool', level: 2 }] }));
      return h;
    };
    const live = new Session(m1Scenario(), SEED, makeHost());
    run(live, 10);
    live.deploy('DA', 'a');
    run(live, 30);
    live.mark('pause');
    live.deploy('DB', 'b');
    live.deploy('DA', 'b');
    run(live, 50);
    const again = replay(m1Scenario(), SEED, live.record, makeHost(), live.world.step);
    expect(stateHash(again.world)).toBe(stateHash(live.world));
    expect(again.record.inputs).toEqual(live.record.inputs);
  });

  it('rejects a deploy to an unknown board', () => {
    const s = new Session(m1Scenario(), SEED, new FakeHost());
    expect(() => s.deploy('ZZ', 'x')).toThrow('unknown board ZZ');
  });
});
