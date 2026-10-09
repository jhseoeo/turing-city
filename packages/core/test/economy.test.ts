import { describe, expect, it } from 'vitest';
import { MICRO } from '../src/fixed.ts';
import { stateHash } from '../src/hash.ts';
import { replay, Session } from '../src/session.ts';
import { FakeHost } from './helpers/fake-host.ts';
import { m1Scenario } from './helpers/scenarios.ts';

const DAY = 800;

function calm(host = new FakeHost(), change?: Parameters<typeof m1Scenario>[0]): Session {
  return new Session(
    m1Scenario((j) => {
      j.tuning.wind.start = 220;
      j.tuning.wind.maxChangePerSecond = 0;
      j.tuning.fuelPrice = { start: 7, min: 7, max: 7 };
      j.tuning.emf.rumourThreshold = 1_000_000_000; // no raids
      change?.(j);
    }),
    1,
    host,
  );
}

function steps(s: Session, n: number): void {
  for (let i = 0; i < n; i++) s.step();
}

describe('economy', () => {
  it('charges 10 a day of upkeep for each intact board', () => {
    const s = calm();
    steps(s, DAY);
    expect(s.world.money).toBe((5000 - 30) * MICRO);
    expect(s.world.ledger.upkeep).toBe(30 * MICRO);
  });

  it("charges fuel for the thermal output at the day's price", () => {
    const s = calm();
    s.world.plant.thermalSetting = 100;
    steps(s, DAY);
    expect(s.world.ledger.fuel).toBe(700 * MICRO);
  });

  it("burns no fuel while the plant's board is down", () => {
    const s = calm();
    s.world.plant.thermalSetting = 100;
    s.world.boards[0]!.status = 'destroyed';
    steps(s, DAY);
    expect(s.world.ledger.fuel).toBe(0);
  });

  it('rebuilds a destroyed board for 500 over half a day, with its firmware and empty mem', () => {
    const host = new FakeHost();
    const src = host.program('count', (_s, mem) => {
      mem.n = ((mem.n as number | undefined) ?? 0) + 1;
      return { logs: [`n=${String(mem.n)}`] };
    });
    const s = calm(host);
    s.deploy('DA', src);
    steps(s, 12); // n = 3
    const da = s.world.boards[1]!;
    expect(s.rebuild('DA')).toEqual({ ok: false, reason: 'DA is not destroyed' });
    da.status = 'destroyed';
    da.vmBooted = false;
    const before = s.world.money;
    expect(s.rebuild('DA')).toEqual({ ok: true });
    expect(s.world.money).toBe(before - 500 * MICRO);
    expect(da.status).toBe('rebuilding');
    steps(s, 400); // ready at step 12 + 400 = 412, which this hasn't computed yet
    expect(da.status).toBe('rebuilding');
    steps(s, 1);
    expect(da.status).toBe('running');
    steps(s, 4);
    expect(da.log.filter((l) => l.kind === 'log').at(-1)?.text).toBe('n=1');
  });

  it("refuses a rebuild it can't pay for", () => {
    const s = calm();
    s.world.boards[2]!.status = 'destroyed';
    s.world.money = 100 * MICRO;
    expect(s.rebuild('DB')).toEqual({ ok: false, reason: 'not enough money' });
  });

  it('goes bankrupt after 3 days below zero, and recovering resets the clock', () => {
    const s = calm();
    s.world.money = -1;
    steps(s, DAY);
    s.world.money = 1 * MICRO; // back above zero for a step
    steps(s, 1);
    s.world.money = -1;
    steps(s, 3 * DAY - 1);
    expect(s.world.ended).toBeNull();
    steps(s, 1);
    expect(s.world.ended?.kind).toBe('bankrupt');
    expect(s.world.alerts.filter((a) => a.kind === 'moneyBelowZero')).toHaveLength(2);
  });

  it('falls when every firmware board is destroyed at once', () => {
    const s = calm();
    for (const b of s.world.boards) b.status = 'destroyed';
    s.step();
    expect(s.world.ended?.kind).toBe('fallen');
    expect(s.world.alerts.at(-1)).toMatchObject({ kind: 'seasonEnd', message: '마을이 함락됐어요' });
  });

  it('replays a rebuild', () => {
    const live = calm();
    steps(live, 5);
    live.world.boards[2]!.status = 'destroyed';
    // Destruction comes from the world in a real session; set it up the same way in the replay.
    live.rebuild('DB');
    steps(live, 500);
    const again = replay(live.scenario, live.seed, { ...live.record, inputs: [] }, new FakeHost(), 5);
    again.world.boards[2]!.status = 'destroyed';
    again.rebuild('DB');
    steps(again, 500);
    expect(stateHash(again.world)).toBe(stateHash(live.world));
    expect(live.record.inputs).toEqual([{ step: 5, kind: 'rebuild', boardId: 'DB' }]);
  });
});
