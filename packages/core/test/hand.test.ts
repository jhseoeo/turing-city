import { describe, expect, it } from 'vitest';
import { applyFacilityAction } from '../src/actions.ts';
import { wreckFacility } from '../src/boards.ts';
import { type Action, countsAsAction } from '../src/firmware-host.ts';
import { MICRO } from '../src/fixed.ts';
import { stateHash } from '../src/hash.ts';
import { snapshot } from '../src/queries.ts';
import { replay, Session } from '../src/session.ts';
import { findFacility } from '../src/world.ts';
import { FakeHost } from './helpers/fake-host.ts';
import { m1Scenario, m2Scenario } from './helpers/scenarios.ts';

/** The test scenario with a steady wind and job price, no raids, and plenty of power from the plant's setting. */
function quiet(host = new FakeHost()): Session {
  const s = new Session(
    m1Scenario((j) => {
      j.tuning.wind.start = 220;
      j.tuning.wind.maxChangePerSecond = 0;
      j.tuning.jobPrice.maxChangePerSecond = 0;
      j.tuning.emf.rumourThreshold = 1_000_000_000;
      j.tuning.thermal.max = 2000;
    }),
    1,
    host,
  );
  s.world.plant.thermalSetting = 1000;
  return s;
}

function steps(s: Session, n: number): void {
  for (let i = 0; i < n; i++) s.step();
}

const windows = (s: Session, id: string) => {
  const dc = s.world.datacenters[id]!;
  return { busy: [dc.busyFrom, dc.busyUntil], cool: [dc.coolFrom, dc.coolUntil] };
};

describe('facility actions from the hand and from firmware', () => {
  it('counts every action toward action EMF but process and sleep', () => {
    const kinds: Action['kind'][] = ['process', 'cool', 'setThermal', 'setPriority', 'harvest', 'dispatch', 'sleep'];
    expect(kinds.filter(countsAsAction)).toEqual(['cool', 'setThermal', 'setPriority', 'harvest', 'dispatch']);
  });

  it('runs a press of [처리] at once, from the step the world is at, for half a second', () => {
    const s = quiet();
    steps(s, 6);
    expect(s.hand('DA', { kind: 'process' })).toEqual({ ok: true });
    expect(windows(s, 'DA').busy).toEqual([6, 16]); // 500 ms at 20 steps a second, from step 6
    expect(snapshot(s.ctx).facilities[1]!.datacenter!.processing).toBe(true); // a paused game shows it before the next step
    const before = s.world.ledger.datacenterIncome;
    steps(s, 12);
    expect(s.world.ledger.datacenterIncome - before).toBe(20 * MICRO); // 40 a second for half a second
  });

  it('refuses a press while the job runs: the job runs to its end, half a second after the first press', () => {
    const s = quiet();
    s.hand('DA', { kind: 'process' });
    steps(s, 5);
    expect(s.hand('DA', { kind: 'process' })).toMatchObject({ ok: false, refusal: { code: 'cannotAct', detail: 'a job is running' } });
    expect(windows(s, 'DA').busy).toEqual([0, 10]);
  });

  it('starts a cooling cycle at once, ignores a press during it, and starts a new one after it', () => {
    const s = quiet();
    expect(s.hand('DA', { kind: 'cool' })).toEqual({ ok: true });
    expect(windows(s, 'DA').cool).toEqual([0, 80]); // 4 s
    steps(s, 10);
    expect(s.hand('DA', { kind: 'cool' })).toEqual({ ok: true });
    expect(windows(s, 'DA').cool).toEqual([0, 80]);
    steps(s, 70); // the cycle's last step is 79
    s.hand('DA', { kind: 'cool' });
    expect(windows(s, 'DA').cool).toEqual([80, 160]);
  });

  it("applies firmware's actions the same way, from the step after its tick: a cooling cycle stops the job it meets", () => {
    const host = new FakeHost();
    const both = host.program('both', () => ({ actions: [{ kind: 'process' }, { kind: 'cool' }] }));
    const s = quiet(host);
    s.deploy('DA', both);
    steps(s, 4); // DA's first beat is step 3
    expect(windows(s, 'DA')).toEqual({ busy: [4, 4], cool: [4, 84] }); // the job started at 4 ends where the cycle starts
  });

  it('lets the last writer win, in the order things happen: the hand after a tick, and the next tick after the hand', () => {
    const host = new FakeHost();
    const plant = host.program('plant', () => ({ actions: [{ kind: 'setThermal', output: 100 }] }));
    const s = quiet(host);
    s.deploy('P', plant);
    s.step(); // P's beat at step 0 sets 100
    expect(s.world.plant.thermalSetting).toBe(100);
    expect(s.hand('P', { kind: 'setThermal', output: 250 })).toEqual({ ok: true });
    expect(s.world.plant.thermalSetting).toBe(250);
    steps(s, 4); // steps 1 to 4: P has no beat
    expect(s.world.plant.generation).toBe(220 + 250);
    s.step(); // P's beat at step 5 writes after the hand
    expect(s.world.plant.thermalSetting).toBe(100);
  });

  it('works the town by hand with no board at all', () => {
    const s = new Session(
      m2Scenario((j) => {
        j.tuning.wind.start = 220;
        j.tuning.wind.maxChangePerSecond = 0;
        j.tuning.jobPrice.maxChangePerSecond = 0;
        j.tuning.emf.rumourThreshold = 1_000_000_000;
      }),
      1,
      new FakeHost(),
    );
    expect(s.world.boards).toEqual([]);
    // The wind alone can't carry both housing blocks and the job: the plant's thermal module, set by hand, makes up the rest.
    expect(s.hand('P', { kind: 'setThermal', output: 200 })).toEqual({ ok: true });
    expect(s.hand('DA', { kind: 'process' })).toEqual({ ok: true });
    steps(s, 12); // a job of 1 s covers steps 0 to 19: all twelve pay 40 / 20 a step
    expect(s.world.ledger.datacenterIncome).toBe(24 * MICRO);
    expect(s.world.plant.shed).toEqual([]);
  });

  it('refuses an action the facility cannot take, says why, and records and changes nothing', () => {
    const s = quiet();
    wreckFacility(s.ctx, findFacility(s.world, 'DB')!, 0, 'luddites');
    const before = stateHash(s.world);
    expect(s.hand('ZZ', { kind: 'process' })).toEqual({
      ok: false,
      reason: 'unknown facility ZZ',
      refusal: { code: 'unknownFacility', facility: 'ZZ' },
    });
    expect(s.hand('DB', { kind: 'process' })).toEqual({ ok: false, reason: 'DB is wrecked', refusal: { code: 'wrecked', facility: 'DB' } });
    expect(s.hand('P', { kind: 'process' })).toEqual({
      ok: false,
      reason: "P: process is a datacenter's action",
      refusal: { code: 'cannotAct', facility: 'P', detail: "process is a datacenter's action" },
    });
    expect(s.hand('DA', { kind: 'setThermal', output: 100 })).toMatchObject({
      refusal: { detail: "setThermal is a power plant's action" },
    });
    expect(s.hand('DA', { kind: 'harvest' })).toMatchObject({ refusal: { detail: "harvest is a farm's action" } });
    expect(s.hand('P', { kind: 'dispatch', truck: 1, from: 'F1', to: 'W', amount: 10 })).toMatchObject({
      refusal: { detail: "dispatch is a warehouse's action" },
    });
    expect(stateHash(s.world)).toBe(before);
    s.repair('DB');
    expect(s.hand('DB', { kind: 'cool' })).toEqual({ ok: false, reason: 'DB is wrecked', refusal: { code: 'wrecked', facility: 'DB' } });
    expect(s.record.inputs.map((i) => i.kind)).toEqual(['repair']);
    expect(s.world.stats.handActions).toBe(0);
  });

  it('refuses a hand action once the season has ended', () => {
    const s = new Session(
      m1Scenario((j) => {
        j.time.secondsPerDay = 1;
        j.time.seasonDays = 1;
      }),
      1,
      new FakeHost(),
    );
    steps(s, 20);
    expect(s.hand('DA', { kind: 'process' })).toEqual({ ok: false, reason: 'the season has ended', refusal: { code: 'seasonEnded' } });
  });

  it('ignores every action on a facility that is not standing, whoever sends it', () => {
    const s = quiet();
    const da = findFacility(s.world, 'DA')!;
    wreckFacility(s.ctx, da, 0, 'fire');
    applyFacilityAction(s.ctx, da, { kind: 'process' }, 0);
    applyFacilityAction(s.ctx, da, { kind: 'cool' }, 0);
    expect(windows(s, 'DA')).toEqual({ busy: [-1, -1], cool: [-1, -1] });
  });

  it('records hand actions at the step they were made, counts them, and replays them into the same state', () => {
    const program = () => ({ actions: [{ kind: 'process' } as const] });
    const host = new FakeHost();
    const live = quiet(host);
    // The helper's thermal setting is no input: the hand sets it again, so that the replay starts from the same plant.
    live.hand('P', { kind: 'setThermal', output: 1000 });
    live.deploy('DB', host.program('work', program));
    steps(live, 3);
    live.hand('DA', { kind: 'process' });
    live.hand('DA', { kind: 'cool' });
    steps(live, 20);
    live.hand('P', { kind: 'setPriority', order: ['DB', 'DA'] });
    steps(live, 10);
    expect(live.world.stats.handActions).toBe(4);
    expect(live.record.inputs.filter((i) => i.kind === 'hand')).toEqual([
      { step: 0, kind: 'hand', facilityId: 'P', action: { kind: 'setThermal', output: 1000 } },
      { step: 3, kind: 'hand', facilityId: 'DA', action: { kind: 'process' } },
      { step: 3, kind: 'hand', facilityId: 'DA', action: { kind: 'cool' } },
      { step: 23, kind: 'hand', facilityId: 'P', action: { kind: 'setPriority', order: ['DB', 'DA'] } },
    ]);
    const replayHost = new FakeHost();
    replayHost.program('work', program);
    const again = replay(live.scenario, live.seed, live.record, replayHost, live.world.step);
    expect(stateHash(again.world)).toBe(stateHash(live.world));
  });
});
