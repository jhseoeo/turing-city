import { describe, expect, it } from 'vitest';
import { applyFacilityAction } from '../src/actions.ts';
import { wreckFacility } from '../src/boards.ts';
import { isCooling } from '../src/datacenter.ts';
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

/** The steps from `from` up to, not including, `to`. */
const range = (from: number, to: number): number[] => Array.from({ length: to - from }, (_, i) => from + i);

/** What the town requests while no datacenter works or cools. */
function idleDemand(): number {
  const s = quiet();
  s.step();
  return s.world.plant.demand;
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
    expect(snapshot(s.ctx).boards[1]!.processing).toBe(true); // a paused game shows it before the next step
    const before = s.world.ledger.datacenterIncome;
    steps(s, 12);
    expect(s.world.ledger.datacenterIncome - before).toBe(20 * MICRO); // 40 a second for half a second
  });

  it('does not stack presses: a press while the job runs ends it half a second after that press', () => {
    const s = quiet();
    s.hand('DA', { kind: 'process' });
    steps(s, 5);
    s.hand('DA', { kind: 'process' });
    expect(windows(s, 'DA').busy).toEqual([0, 15]);
  });

  it('starts a cooling cycle at once, ignores a press during it, goes on with a new one from its end, and starts afresh after a gap', () => {
    const s = quiet();
    // The steps still to come that the datacenter phase cools, whatever the bookkeeping of the cycle's window.
    const cooling = () => range(s.world.step, 400).filter((step) => isCooling(s.ctx, 'DA', step));
    expect(s.hand('DA', { kind: 'cool' })).toEqual({ ok: true });
    expect(cooling()).toEqual(range(0, 80)); // 4 s
    steps(s, 10);
    expect(s.hand('DA', { kind: 'cool' })).toEqual({ ok: true });
    expect(cooling()).toEqual(range(10, 80)); // a press inside the cycle changes nothing
    steps(s, 70); // the cycle's last step is 79
    s.hand('DA', { kind: 'cool' });
    expect(cooling()).toEqual(range(80, 160)); // a press at its end goes on with it: a whole new cycle from step 80
    steps(s, 100);
    expect(cooling()).toEqual([]); // the cycle ended at 160, and the world is at step 180
    s.hand('DA', { kind: 'cool' });
    expect(cooling()).toEqual(range(180, 260)); // a press after the gap starts a cycle of its own
  });

  it("applies firmware's actions the same way, from the step after its tick", () => {
    const host = new FakeHost();
    const both = host.program('both', () => ({ actions: [{ kind: 'process' }, { kind: 'cool' }] }));
    const s = quiet(host);
    s.deploy('DA', both);
    steps(s, 4); // DA's first beat is step 3
    expect(windows(s, 'DA')).toEqual({ busy: [4, 14], cool: [4, 84] });
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
    steps(s, 12);
    expect(s.world.ledger.datacenterIncome).toBe(20 * MICRO);
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
    // Under repair it is the same code, worded for the state it is in (Task 3's refuseNotStanding).
    expect(s.hand('DB', { kind: 'cool' })).toEqual({
      ok: false,
      reason: 'DB is being repaired',
      refusal: { code: 'wrecked', facility: 'DB' },
    });
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

  // The three tests below pin rules the brief states and its tests above leave open: each fails with its rule switched off.

  it('keeps the thermal setting whole and between 0 and the scenario maximum, from the hand and from firmware', () => {
    const host = new FakeHost();
    let output = 0;
    const plant = host.program('plant', () => ({ actions: [{ kind: 'setThermal', output }] }));
    const s = quiet(host); // the maximum is 2000
    s.deploy('P', plant);
    const cases: Array<[number, number]> = [
      [-50, 0],
      [99_999, 2000],
      [12.9, 12],
      [Number.NaN, 0],
      [Number.POSITIVE_INFINITY, 0],
    ];
    for (const [asked, kept] of cases) {
      s.world.plant.thermalSetting = 1000;
      s.hand('P', { kind: 'setThermal', output: asked });
      expect(s.world.plant.thermalSetting, `by hand: ${asked}`).toBe(kept);
      s.world.plant.thermalSetting = 1000;
      output = asked;
      steps(s, 5); // P's clock is 4 Hz: one beat in every 5 steps
      expect(s.world.plant.thermalSetting, `by firmware: ${asked}`).toBe(kept);
    }
  });

  it('applies what firmware asked before a sleep and drops what it asked after it', () => {
    const host = new FakeHost();
    const nap = host.program('nap', () => ({ actions: [{ kind: 'process' }, { kind: 'sleep', seconds: 5 }, { kind: 'cool' }] }));
    const s = quiet(host);
    s.deploy('DA', nap);
    steps(s, 4); // DA's first beat is step 3
    expect(s.world.boards[1]!.status).toBe('asleep');
    expect(windows(s, 'DA')).toEqual({ busy: [4, 14], cool: [-1, -1] });
  });

  it('ignores an action asked of a facility of another kind, or one under repair, whoever sends it', () => {
    const host = new FakeHost();
    // The datacenter's board asks for the plant's settings, and the plant's board for a datacenter's work.
    const meddle = host.program('meddle', () => ({
      actions: [{ kind: 'setThermal', output: 500 }, { kind: 'setPriority', order: ['DB'] }, { kind: 'harvest' }],
    }));
    const trespass = host.program('trespass', () => ({ actions: [{ kind: 'process' }, { kind: 'cool' }] }));
    const s = quiet(host);
    s.deploy('DA', meddle);
    s.deploy('P', trespass);
    steps(s, 4); // P beats at step 0, DA at step 3
    expect(s.world.plant.thermalSetting).toBe(1000);
    expect(s.world.plant.priority).toBeNull();
    for (const id of ['DA', 'DB']) expect(windows(s, id), id).toEqual({ busy: [-1, -1], cool: [-1, -1] });
    const db = findFacility(s.world, 'DB')!;
    db.condition = 'repairing'; // as startRepair leaves it
    applyFacilityAction(s.ctx, db, { kind: 'process' }, 4);
    applyFacilityAction(s.ctx, db, { kind: 'cool' }, 4);
    expect(windows(s, 'DB')).toEqual({ busy: [-1, -1], cool: [-1, -1] });
  });

  // No step is lost where firmware's press meets the end of a job or a cycle: it acts in phase 5, after the power phase charged the
  // step it ticks in and before the datacenter phase pays, heats, and cools that step.

  it('pays and heats the last step of a hand job that firmware presses on, a step the power phase already charged', () => {
    const idle = idleDemand();
    const host = new FakeHost();
    let beats = 0;
    // DA beats at steps 3, 7, 11, 15: its firmware calls process() on the fourth beat only, on the last step of the hand's job
    const late = host.program('late', () => ({ actions: ++beats === 4 ? [{ kind: 'process' }] : [] }));
    const s = quiet(host);
    s.deploy('DA', late);
    steps(s, 6);
    s.hand('DA', { kind: 'process' }); // the job is steps 6 to 15
    const dc = s.world.datacenters.DA!;
    const charged: number[] = [];
    const paid: number[] = [];
    const heated: number[] = [];
    for (let step = 6; step < 32; step++) {
      const income = s.world.ledger.datacenterIncome;
      const temp = dc.tempMilli;
      s.step();
      if (s.world.plant.demand > idle) charged.push(step);
      if (s.world.ledger.datacenterIncome > income) paid.push(step);
      if (dc.tempMilli > temp) heated.push(step);
    }
    // the press at step 15 goes on with the job, so it runs 6 to 25 whole: every step charged, paid, and heated alike
    expect(charged).toEqual(range(6, 26));
    expect(paid).toEqual(range(6, 26));
    expect(heated).toEqual(range(6, 26));
  });

  it('cools every step for a firmware that calls cool() on every beat, the last step of each cycle included', () => {
    const idle = idleDemand();
    // DA beats at steps 3, 7, 11, ...: a beat lands on the last step of every cycle. The first cycle is steps 4 to 83 when firmware
    // starts it, and steps 0 to 79 when a hand press at step 0 does; the beats at 83, 163, ... or at 79, 159, ... are the ones to watch.
    for (const [firstStep, byHand] of [[4, false] as const, [0, true] as const]) {
      const host = new FakeHost();
      const cool = host.program('cool', () => ({ actions: [{ kind: 'cool' }] }));
      const s = quiet(host);
      s.deploy('DA', cool);
      if (byHand) s.hand('DA', { kind: 'cool' });
      const charged: number[] = [];
      const cooled: number[] = [];
      for (let step = 0; step <= 330; step++) {
        s.step();
        if (s.world.plant.demand > idle) charged.push(step);
        if (isCooling(s.ctx, 'DA', step)) cooled.push(step); // what the datacenter phase of this step used
      }
      const label = byHand ? 'started by hand' : 'started by firmware';
      expect(charged, `charged, ${label}`).toEqual(range(firstStep, 331));
      expect(cooled, `cooled, ${label}`).toEqual(range(firstStep, 331));
    }
  });

  it('leaves a real gap where a beat skips cool(): nothing in it is charged or cooled, and the next cycle starts after its call', () => {
    const idle = idleDemand();
    const host = new FakeHost();
    let beats = 0;
    // calls cool() on beats 1 and 22 (steps 3 and 87): the first cycle is steps 4 to 83, so 84 to 87 are idle, and the call at 87
    // starts the next cycle at 88
    const patchy = host.program('patchy', () => ({ actions: ++beats === 1 || beats === 22 ? [{ kind: 'cool' }] : [] }));
    const s = quiet(host);
    s.deploy('DA', patchy);
    const charged: number[] = [];
    const cooled: number[] = [];
    for (let step = 0; step <= 175; step++) {
      s.step();
      if (s.world.plant.demand > idle) charged.push(step);
      if (isCooling(s.ctx, 'DA', step)) cooled.push(step);
    }
    const expected = [...range(4, 84), ...range(88, 168)];
    expect(charged).toEqual(expected);
    expect(cooled).toEqual(expected);
  });
});
