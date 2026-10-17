import { describe, expect, it } from 'vitest';
import { applyFacilityAction } from '../src/actions.ts';
import { coolSteps, datacenterDraw, isCooling, isProcessing, jobSteps, runDatacenters, runFires } from '../src/datacenter.ts';
import { MICRO } from '../src/fixed.ts';
import { facilityDemand, jobPowerShort } from '../src/power.ts';
import type { Rng } from '../src/rng.ts';
import { Session } from '../src/session.ts';
import { type FacilityState, findFacility } from '../src/world.ts';
import { FakeHost } from './helpers/fake-host.ts';
import { m1Scenario, m2Scenario } from './helpers/scenarios.ts';

/**
 * Plenty of steady, free power and a steady job price: nothing is shed, fuel does not drain the money, and pay is exact.
 * The thermal module goes far above its usual maximum so that every job and every cooling cycle can run at once.
 */
function powered(seed = 1, host = new FakeHost(), change?: Parameters<typeof m1Scenario>[0]): Session {
  const s = new Session(
    m1Scenario((j) => {
      j.tuning.wind.start = 220;
      j.tuning.wind.maxChangePerSecond = 0;
      j.tuning.thermal.max = 2_000;
      j.tuning.fuelPrice = { start: 0, min: 0, max: 0 };
      j.tuning.jobPrice.maxChangePerSecond = 0;
      j.tuning.emf.rumourThreshold = 1_000_000_000; // no raids
      j.tuning.datacenter.passiveCoolingPermillePerSecond = 3; // the town's tuning; milestone 1's scenario leaks faster
      change?.(j);
    }),
    seed,
    host,
  );
  s.world.plant.thermalSetting = 2_000;
  return s;
}

/** Like powered(), but heat does not leak away: a temperature changes only by work and by cooling cycles. */
function holding(host = new FakeHost()): Session {
  return powered(1, host, (j) => {
    j.tuning.datacenter.passiveCoolingPermillePerSecond = 0;
  });
}

/** The milestone-2 town, which starts with no board at all, on the same steady, free power. */
function town(): Session {
  const s = new Session(
    m2Scenario((j) => {
      j.tuning.wind.start = 220;
      j.tuning.wind.maxChangePerSecond = 0;
      j.tuning.thermal.max = 2_000;
      j.tuning.fuelPrice = { start: 0, min: 0, max: 0 };
      j.tuning.jobPrice.maxChangePerSecond = 0;
      j.tuning.emf.rumourThreshold = 1_000_000_000;
    }),
    1,
    new FakeHost(),
  );
  s.world.plant.thermalSetting = 2_000;
  return s;
}

const fac = (s: Session, id: string): FacilityState => findFacility(s.world, id)!;

function steps(s: Session, n: number): void {
  for (let i = 0; i < n; i++) s.step();
}

/** Swaps the session's fire stream for one that records the chance of every roll and never hits. */
function recordFireRolls(s: Session): number[] {
  const rolls: number[] = [];
  const recorder: Rng = {
    nextU32: () => 0,
    int: (lo) => lo,
    chancePpm: (ppm) => {
      rolls.push(ppm);
      return false;
    },
  };
  Object.assign(s.ctx.rng, { fire: recorder });
  return rolls;
}

/** Runs the session to `lastStep`; lists the steps on which the power phase charged DA's job and the steps on which it was paid. */
function chargedAndPaid(s: Session, lastStep: number): { charged: number[]; paid: number[] } {
  s.step(); // step 0: no job yet, so the demand it reports is the idle demand
  const idle = s.world.plant.demand;
  let earned = s.world.ledger.datacenterIncome;
  const charged: number[] = [];
  const paid: number[] = [];
  for (let step = 1; step <= lastStep; step++) {
    s.step();
    if (s.world.plant.demand > idle) charged.push(step);
    if (s.world.ledger.datacenterIncome > earned) paid.push(step);
    earned = s.world.ledger.datacenterIncome;
  }
  return { charged, paid };
}

describe('datacenters', () => {
  it('runs half a second of work from the step of a press by hand, and pays the job price for it at its last step', () => {
    const s = powered();
    expect(jobSteps(s.ctx)).toBe(10); // 500 ms at 20 steps a second
    expect(s.hand('DA', { kind: 'process' })).toEqual({ ok: true });
    const paid: number[] = [];
    let earned = 0;
    for (let step = 0; step < 15; step++) {
      s.step();
      if (s.world.ledger.datacenterIncome > earned) paid.push(step);
      earned = s.world.ledger.datacenterIncome;
    }
    // The hand applies at once, between steps: the job is steps 0 to 9, and pays all of it at step 9.
    expect(paid).toEqual([9]);
    expect(s.world.ledger.datacenterIncome).toBe(20 * MICRO); // 40 a second for half a second
    expect(s.world.datacenters.DA).toMatchObject({ paidStep: 9, paidMicro: 20 * MICRO });
  });

  it('runs a job to its end: a press while it runs is refused, and one after it starts the next job', () => {
    const s = powered();
    const dc = s.world.datacenters.DA!;
    s.hand('DA', { kind: 'process' }); // applies at step 0: steps 0 to 9
    steps(s, 5);
    expect(s.hand('DA', { kind: 'process' })).toEqual({
      ok: false,
      reason: 'DA: a job is running',
      refusal: { code: 'cannotAct', facility: 'DA', detail: 'a job is running' },
    }); // at step 5, mid-job: refused, and the job still ends after step 9
    applyFacilityAction(s.ctx, fac(s, 'DA'), { kind: 'process' }, 6); // the same call from firmware is refused, and changes nothing
    expect([dc.busyFrom, dc.busyUntil]).toEqual([0, 10]);
    steps(s, 5); // through step 9, the job's last
    expect(s.hand('DA', { kind: 'process' })).toEqual({ ok: true }); // at step 10: the next job, steps 10 to 19
    expect([dc.busyFrom, dc.busyUntil]).toEqual([10, 20]);
    steps(s, 20);
    expect(s.world.ledger.datacenterIncome).toBe(2 * 20 * MICRO); // two whole jobs, 20 each
  });

  it('charges and pays one process() call for half a second, longer than the tick period', () => {
    const host = new FakeHost();
    let calls = 0;
    const once = host.program('once', () => ({ actions: calls++ === 0 ? [{ kind: 'process' }] : [] }));
    const s = holding(host);
    s.deploy('DA', once);
    const { charged, paid } = chargedAndPaid(s, 20);
    const job = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13]; // DA's first beat is step 3: the call applies there, and the job runs 4 to 13
    expect(charged).toEqual(job);
    expect(paid).toEqual([13]);
  });

  it('starts the next job on the first beat after one ends, while firmware calls process() on every beat', () => {
    const host = new FakeHost();
    const work = host.program('work', () => ({ actions: [{ kind: 'process' }] }));
    const s = holding(host);
    s.deploy('DA', work);
    const { charged, paid } = chargedAndPaid(s, 40);
    // Beats at steps 3, 7, 11, ... apply a step later. A job of 10 steps from step 4 ends after 13: the calls applying at 8 and 12
    // do nothing, and the one at 16 starts the next job.
    const job = (from: number): number[] => Array.from({ length: 10 }, (_, i) => from + i);
    const working = [...job(4), ...job(16), ...job(28), 40];
    expect(charged).toEqual(working);
    expect(paid).toEqual([13, 25, 37]); // each job pays at its last step
  });

  it("lets a job end and pay on its last step when firmware's next call comes on that step's beat", () => {
    const host = new FakeHost();
    const work = host.program('work', () => ({ actions: [{ kind: 'process' }] }));
    // A job of 8 steps, two beats of DA's 5 Hz clock: the beat at step 11 falls on the last step of the job from step 4.
    const s = powered(1, host, (j) => {
      j.tuning.datacenter.jobMs = 400;
    });
    s.deploy('DA', work);
    const { charged, paid } = chargedAndPaid(s, 36);
    // The call at step 11 finds the job still running and does nothing; the one at step 15 starts the next job at 16.
    const job = (from: number): number[] => Array.from({ length: 8 }, (_, i) => from + i);
    expect(charged).toEqual([...job(4), ...job(16), ...job(28)]);
    expect(paid).toEqual([11, 23, 35]);
  });

  it("lets a cooling cycle take off all its drop when firmware's next call comes on its last step's beat", () => {
    const host = new FakeHost();
    const chill = host.program('chill', () => ({ actions: [{ kind: 'cool' }] }));
    const s = powered(1, host, (j) => {
      j.tuning.datacenter.coolingCycleMs = 400; // 8 steps: the beat at step 11 falls on the last step of the cycle from step 4
      j.tuning.datacenter.passiveCoolingPermillePerSecond = 0;
    });
    const dc = s.world.datacenters.DA!;
    dc.tempMilli = 80_000;
    s.deploy('DA', chill);
    steps(s, 12); // the cycle runs steps 4 to 11
    expect(dc.tempMilli).toBe(80_000 - s.scenario.tuning.datacenter.coolingDropMilli);
    expect([dc.coolFrom, dc.coolUntil]).toEqual([4, 12]);
  });

  it('earns the job price and gains the tuned heat for every second of work', () => {
    const s = holding();
    const dc = s.world.datacenters.DA!;
    const { ambientMilli, heatMilliPerSecond } = s.scenario.tuning.datacenter;
    for (const seconds of [1, 2, 3]) {
      for (let job = 0; job < 2; job++) {
        expect(s.hand('DA', { kind: 'process' })).toEqual({ ok: true }); // two jobs of half a second, back to back
        steps(s, jobSteps(s.ctx));
      }
      expect(s.world.ledger.datacenterIncome, `income after ${seconds} s`).toBe(seconds * s.world.jobPrice * MICRO);
      expect(dc.tempMilli, `temperature after ${seconds} s`).toBe(ambientMilli + seconds * heatMilliPerSecond);
    }
  });

  it("takes a cooling cycle's drop off in even parts over its steps, exactly", () => {
    const s = holding();
    const dc = s.world.datacenters.DA!;
    expect(coolSteps(s.ctx)).toBe(80); // 4,000 ms at 20 steps a second
    dc.tempMilli = 80_000;
    expect(s.hand('DA', { kind: 'cool' })).toEqual({ ok: true });
    const temps: number[] = [dc.tempMilli]; // temps[i] is the temperature before step i; the press applies at once: the cycle is steps 0 to 79
    for (let step = 0; step <= 80; step++) {
      s.step();
      temps.push(dc.tempMilli);
    }
    expect(temps[0]).toBe(80_000);
    const drops = Array.from({ length: 80 }, (_, i) => temps[i]! - temps[i + 1]!);
    expect(new Set(drops)).toEqual(new Set([187, 188])); // 15,000 over 80 steps is 187.5 a step
    expect(temps[80]).toBe(65_000); // all of coolingDropMilli, to the milli-degree
    expect(temps[81]).toBe(65_000); // and nothing after it
  });

  it('starts no job without the power for it: a press is refused and changes nothing, and one with just enough power starts it', () => {
    const s = town(); // no boards: the homes come before DA in the map's order
    s.world.plant.thermalSetting = 0;
    s.world.plant.wind = 50; // the wind won't move
    const short = jobPowerShort(s.ctx, fac(s, 'DA'), s.world.step);
    // H1 and H2, then DA with its job, against the wind alone.
    const homes = facilityDemand(s.ctx, fac(s, 'H1'), 0) + facilityDemand(s.ctx, fac(s, 'H2'), 0);
    const job = facilityDemand(s.ctx, fac(s, 'DA'), 0, s.scenario.tuning.datacenter.processPower);
    expect(short).toBe(homes + job - 50);
    s.world.plant.thermalSetting = short - 1;
    expect(s.hand('DA', { kind: 'process' })).toEqual({
      ok: false,
      reason: 'DA: not enough power',
      refusal: { code: 'cannotAct', facility: 'DA', detail: 'not enough power' },
    });
    expect(s.world.datacenters.DA!.busyUntil).toBe(-1);
    s.world.plant.thermalSetting = short;
    expect(s.hand('DA', { kind: 'process' })).toEqual({ ok: true });
  });

  it('counts only the facilities above the datacenter in the supply order: those below it would be shed first', () => {
    const s = town();
    s.world.plant.thermalSetting = 0;
    s.world.plant.wind = 50;
    const behindHomes = jobPowerShort(s.ctx, fac(s, 'DA'), 0);
    expect(s.hand('P', { kind: 'setPriority', order: ['DA'] })).toEqual({ ok: true });
    const job = facilityDemand(s.ctx, fac(s, 'DA'), 0, s.scenario.tuning.datacenter.processPower);
    expect(jobPowerShort(s.ctx, fac(s, 'DA'), 0)).toBe(job - 50);
    expect(jobPowerShort(s.ctx, fac(s, 'DA'), 0)).toBeLessThan(behindHomes);
  });

  it("ignores firmware's process() without the power for it, and says so with one alert until a job starts again", () => {
    const host = new FakeHost();
    const work = host.program('work', () => ({ actions: [{ kind: 'process' }] }));
    const s = holding(host);
    s.deploy('DA', work);
    steps(s, 1);
    // Just enough for the town and its boards, not for a job: the boards still tick.
    const lean = s.world.plant.demand - s.world.plant.wind + 10;
    s.world.plant.thermalSetting = lean;
    const said = (): number => s.world.alerts.filter((a) => a.kind === 'powerShortage' && a.facilityId === 'DA').length;
    steps(s, 40);
    expect(s.world.datacenters.DA!.busyUntil).toBe(-1);
    expect(said()).toBe(1);
    expect(s.world.alerts.find((a) => a.facilityId === 'DA')?.message).toBe('DA 전력이 모자라 처리를 시작하지 못했어요');
    s.world.plant.thermalSetting = 2_000; // a job starts, and the episode is over
    steps(s, 8);
    expect(s.world.datacenters.DA!.busyUntil).toBeGreaterThan(0);
    s.world.plant.thermalSetting = lean;
    steps(s, 40);
    expect(said()).toBe(2);
    // A job the hand starts ends the episode too: firmware meets that job running, not a success of its own.
    s.world.plant.thermalSetting = 2_000;
    expect(s.hand('DA', { kind: 'process' })).toEqual({ ok: true });
    s.world.plant.thermalSetting = lean;
    steps(s, 60);
    expect(said()).toBe(3);
  });

  it('refuses a press during a cooling cycle and starts a new cycle after it', () => {
    const s = holding();
    const dc = s.world.datacenters.DA!;
    s.hand('DA', { kind: 'cool' }); // applies at step 0: steps 0 to 79
    steps(s, 10);
    expect(s.hand('DA', { kind: 'cool' }).ok).toBe(false); // at step 10, inside the cycle: refused, nothing changes
    steps(s, 1);
    expect([dc.coolFrom, dc.coolUntil]).toEqual([0, 80]);
    steps(s, 69); // through step 79, the cycle's last
    s.hand('DA', { kind: 'cool' }); // applies at step 80: a new cycle, steps 80 to 159
    steps(s, 1);
    expect([dc.coolFrom, dc.coolUntil]).toEqual([80, 160]);
  });

  it('never works and cools at once: a cooling cycle stops the job, and no job starts while it runs', () => {
    const s = holding();
    const dc = s.world.datacenters.DA!;
    dc.tempMilli = 80_000;
    expect(s.hand('DA', { kind: 'process' })).toEqual({ ok: true }); // a job from step 0, steps 0 to 9
    steps(s, 4); // steps 0 to 3 work
    expect(s.hand('DA', { kind: 'cool' })).toEqual({ ok: true }); // a cycle from step 4 stops the job there
    expect([dc.busyFrom, dc.busyUntil, dc.coolFrom, dc.coolUntil]).toEqual([0, 4, 4, 84]);
    // A press while it cools is refused, and changes nothing; so is the same call from firmware.
    expect(s.hand('DA', { kind: 'process' })).toEqual({
      ok: false,
      reason: 'DA: a cooling cycle is running',
      refusal: { code: 'cannotAct', facility: 'DA', detail: 'a cooling cycle is running' },
    });
    applyFacilityAction(s.ctx, fac(s, 'DA'), { kind: 'process' }, 5);
    expect([dc.busyFrom, dc.busyUntil]).toEqual([0, 4]);
    steps(s, 10); // steps 4 to 13 cool and don't work
    // Four steps of work (+100 each), then ten parts of the cycle: 15,000 x 10 / 80 = 1,875.
    expect(dc.tempMilli).toBe(80_000 + 400 - 1_875);
    expect(s.world.ledger.datacenterIncome).toBe(0); // the cycle cut the job short: it pays nothing
    expect(isProcessing(s.ctx, 'DA', 13)).toBe(false);
    steps(s, 70); // the cycle's last step is 83
    expect(s.hand('DA', { kind: 'process' })).toEqual({ ok: true }); // at step 84 it works again
  });

  it('draws processing power on the steps of its job and cooling power on the steps of its cycle', () => {
    const s = powered();
    const da = fac(s, 'DA');
    const dc = s.world.datacenters.DA!;
    const { processPower, coolingPower } = s.scenario.tuning.datacenter;
    dc.busyFrom = 5;
    dc.busyUntil = 8; // steps 5, 6 and 7
    dc.coolFrom = 7;
    dc.coolUntil = 10; // steps 7, 8 and 9
    expect([4, 5, 6, 7, 8, 9, 10].map((step) => datacenterDraw(s.ctx, da, step))).toEqual([
      0,
      processPower,
      processPower,
      processPower + coolingPower,
      coolingPower,
      coolingPower,
      0,
    ]);
    // With its board's own 10, and 2% for the one cell between it and the plant: 10 + 150 + 400 = 560, + 11
    expect(facilityDemand(s.ctx, da, 7)).toBe(571);
  });

  it('counts a step as processing exactly when the power phase charges the job for it', () => {
    const s = powered();
    const da = fac(s, 'DA');
    const dc = s.world.datacenters.DA!;
    for (const [from, until] of [
      [5, 9],
      [5, 6],
      [-1, -1],
    ] as const) {
      for (let step = 3; step <= 10; step++) {
        da.powered = true;
        dc.busyFrom = from;
        dc.busyUntil = until;
        const where = `job ${from} to ${until - 1}, step ${step}`;
        expect(isProcessing(s.ctx, 'DA', step), where).toBe(datacenterDraw(s.ctx, da, step) > 0);
        da.powered = false; // shed: the job drew its power, but no work was done
        expect(isProcessing(s.ctx, 'DA', step), `${where}, shed`).toBe(false);
      }
    }
    expect(isProcessing(s.ctx, 'P', 0)).toBe(false); // the plant has no datacenter
    expect(isProcessing(s.ctx, 'ZZ', 0)).toBe(false);
  });

  it('works by hand with no board at all', () => {
    const s = town();
    expect(s.world.boards).toEqual([]); // the milestone-2 town starts with no board
    s.hand('DA', { kind: 'process' });
    steps(s, 19); // a job of 1 s covers steps 0 to 19
    expect(s.world.ledger.datacenterIncome).toBe(0);
    steps(s, 1); // and pays its 40 at step 19
    expect(s.world.ledger.datacenterIncome).toBe(40 * MICRO);
    expect(s.world.datacenters.DA!.tempMilli).toBeGreaterThan(25_000);
  });

  it('goes on with a job started by hand while its board sleeps', () => {
    const s = powered();
    s.world.boards[1]!.status = 'asleep'; // DA's board; with no wake-up time set, it stays asleep
    s.hand('DA', { kind: 'process' });
    steps(s, 12);
    expect(s.world.ledger.datacenterIncome).toBe(20 * MICRO);
  });

  it('does not work, earn, heat, or cool while shed: only the passive leak goes on', () => {
    const tempAfter = (busy: boolean): number => {
      const s = powered();
      s.world.plant.thermalSetting = 0;
      s.world.plant.wind = 0; // the wind won't move: maxChangePerSecond is 0
      const dc = s.world.datacenters.DA!;
      dc.tempMilli = 60_000;
      if (busy) {
        dc.busyFrom = 0;
        dc.busyUntil = 100;
        dc.coolFrom = 0;
        dc.coolUntil = 100;
      }
      steps(s, 50);
      expect(s.world.ledger.datacenterIncome).toBe(0);
      return dc.tempMilli;
    };
    expect(tempAfter(true)).toBe(tempAfter(false));
    expect(tempAfter(false)).toBe(59_750); // 50 steps of the passive leak alone, 5 milli-degrees each
  });

  it('does nothing and requests nothing while wrecked or being repaired', () => {
    for (const condition of ['wrecked', 'repairing'] as const) {
      const s = powered();
      const da = fac(s, 'DA');
      const dc = s.world.datacenters.DA!;
      dc.busyFrom = 0;
      dc.busyUntil = 100;
      dc.coolFrom = 0;
      dc.coolUntil = 100;
      dc.tempMilli = 60_000;
      da.condition = condition;
      expect(datacenterDraw(s.ctx, da, 5), condition).toBe(0);
      expect(isProcessing(s.ctx, 'DA', 5), condition).toBe(false);
      expect(isCooling(s.ctx, 'DA', 5), condition).toBe(false);
      runDatacenters(s.ctx, 5);
      expect(s.world.ledger.datacenterIncome, condition).toBe(0);
      expect(dc.tempMilli, condition).toBe(60_000);
    }
  });

  it('lets heat leak away by the tuned permille of its excess each second, split over the steps and rounded down', () => {
    const s = powered();
    const dc = s.world.datacenters.DA!;
    dc.tempMilli = 80_030; // 55,030 over ambient: 3 permille a second over 20 steps is 8.25, taken as 8
    runDatacenters(s.ctx, 0);
    expect(dc.tempMilli).toBe(80_022);
  });

  it('cools very slowly when left alone: ten degrees off 85 °C take more than a minute', () => {
    const s = powered();
    const dc = s.world.datacenters.DA!;
    dc.tempMilli = 85_000;
    let step = 0;
    while (dc.tempMilli > 75_000) runDatacenters(s.ctx, step++);
    expect(step).toBeGreaterThan(60 * s.scenario.time.stepsPerSecond); // 1,310 steps, 65.5 s, at 0.3% a second
  });

  it('pays every datacenter that finishes a job into the town money and the ledger alike', () => {
    const s = powered();
    for (const id of ['DA', 'DB']) Object.assign(s.world.datacenters[id]!, { busyFrom: 0, busyUntil: 10, workedSteps: 9 });
    const before = s.world.money;
    runDatacenters(s.ctx, 9); // each job's last step: 40 a second for half a second
    expect(s.world.money - before).toBe(40 * MICRO);
    expect(s.world.ledger.datacenterIncome).toBe(40 * MICRO);
  });

  it('pays a job only for the steps the grid supplied, at its last step', () => {
    const s = powered();
    const da = fac(s, 'DA');
    const dc = s.world.datacenters.DA!;
    s.hand('DA', { kind: 'process' }); // steps 0 to 9
    steps(s, 5);
    da.powered = false; // shed at step 5: the job's time goes on, but it does no work
    runDatacenters(s.ctx, 5);
    da.powered = true;
    for (let step = 6; step <= 8; step++) runDatacenters(s.ctx, step);
    expect(s.world.ledger.datacenterIncome).toBe(0); // nothing until the job's last step
    runDatacenters(s.ctx, 9);
    expect(dc.workedSteps).toBe(9);
    expect(s.world.ledger.datacenterIncome).toBe(18 * MICRO); // nine of its ten steps, at 2 a step
    expect(dc).toMatchObject({ paidStep: 9, paidMicro: 18 * MICRO });
  });

  it('pays nothing for a job that a cooling cycle from firmware cuts short, on the step the cycle comes', () => {
    const s = holding();
    const dc = s.world.datacenters.DA!;
    s.hand('DA', { kind: 'process' }); // steps 0 to 9
    steps(s, 5);
    applyFacilityAction(s.ctx, fac(s, 'DA'), { kind: 'cool' }, 6); // firmware's call during step 5: the job ends after step 5
    expect([dc.busyFrom, dc.busyUntil]).toEqual([0, 6]);
    steps(s, 10);
    expect(s.world.ledger.datacenterIncome).toBe(0);
  });

  it('raises the overheat alert at exactly 85 °C and not a milli-degree below', () => {
    const s = holding();
    const dc = s.world.datacenters.DA!;
    const alerts = () => s.world.alerts.filter((a) => a.kind === 'overheat');
    dc.tempMilli = 84_999;
    runDatacenters(s.ctx, 0);
    expect(alerts()).toHaveLength(0);
    dc.tempMilli = 85_000;
    runDatacenters(s.ctx, 1);
    expect(alerts()).toHaveLength(1);
  });

  it('ends an overheat episode only below 80 °C, not at 80 °C and not between 80 and 85', () => {
    const s = holding();
    const dc = s.world.datacenters.DA!;
    const alerts = () => s.world.alerts.filter((a) => a.kind === 'overheat');
    const phase = (tempMilli: number, step: number): void => {
      dc.tempMilli = tempMilli;
      runDatacenters(s.ctx, step);
    };
    phase(86_000, 0);
    phase(80_000, 1);
    phase(86_000, 2);
    expect(alerts()).toHaveLength(1); // 80 °C is not below 80 °C: the episode goes on
    phase(84_000, 3);
    phase(86_000, 4);
    expect(alerts()).toHaveLength(1); // nor is anything between 80 and 85
    phase(79_999, 5);
    phase(86_000, 6);
    expect(alerts()).toHaveLength(2); // a milli-degree below 80 °C ends it
  });

  it('gives each datacenter its own overheat alert, naming it and the step', () => {
    const s = holding();
    s.world.datacenters.DA!.tempMilli = 86_000;
    s.world.datacenters.DB!.tempMilli = 87_000;
    runDatacenters(s.ctx, 7);
    expect(s.world.alerts.map((a) => [a.kind, a.facilityId, a.step])).toEqual([
      ['overheat', 'DA', 7],
      ['overheat', 'DB', 7],
    ]);
  });

  it('rolls a fire chance that grows with the degrees over 90 °C, and none at or below it', () => {
    const s = holding();
    const rolls = recordFireRolls(s);
    for (const tempMilli of [89_999, 90_000, 91_000, 100_000, 140_000]) {
      s.world.datacenters.DA!.tempMilli = tempMilli;
      runFires(s.ctx, 0);
    }
    // (milli-degrees over 90 °C) x 5 permille a degree each second, over 20 steps: 1 °C -> 250 ppm, 10 °C -> 2,500, 50 °C -> 12,500
    expect(rolls).toEqual([250, 2_500, 12_500]);
  });

  it('rolls for fire on the temperature the step ends with, so the datacenter phase comes first', () => {
    const s = holding();
    const rolls = recordFireRolls(s);
    const dc = s.world.datacenters.DA!;
    dc.busyFrom = 0;
    dc.busyUntil = 1; // step 0's work
    dc.tempMilli = 89_950; // the work's heat for one step is 100 milli-degrees: 90,050 by the fire phase
    s.step();
    expect(rolls).toEqual([12]); // 50 milli-degrees x 5 permille a degree each second / 20 steps = 12.5, rounded down
  });

  it('rolls for a hot datacenter asleep, shed, or with no board, but not for one wrecked or being repaired', () => {
    const rollsOf = (s: Session, prepare: () => void): number[] => {
      const rolls = recordFireRolls(s);
      prepare();
      s.world.datacenters.DA!.tempMilli = 140_000;
      runFires(s.ctx, 0);
      return rolls;
    };
    const wrecked = holding();
    expect(
      rollsOf(wrecked, () => {
        fac(wrecked, 'DA').condition = 'wrecked';
      }),
      'wrecked',
    ).toEqual([]);
    const repairing = holding();
    expect(
      rollsOf(repairing, () => {
        fac(repairing, 'DA').condition = 'repairing';
      }),
      'repairing',
    ).toEqual([]);
    const asleep = holding();
    expect(
      rollsOf(asleep, () => {
        asleep.world.boards[1]!.status = 'asleep';
      }),
      'asleep',
    ).toEqual([12_500]);
    const shed = holding();
    expect(
      rollsOf(shed, () => {
        fac(shed, 'DA').powered = false;
      }),
      'shed',
    ).toEqual([12_500]);
    expect(
      rollsOf(town(), () => {}),
      'no board',
    ).toEqual([12_500]);
  });

  it('wrecks a datacenter that burns, and its board with it, once', () => {
    const s = powered(5);
    const dc = s.world.datacenters.DA!;
    for (let i = 0; i < 1000; i++) {
      dc.tempMilli = 140_000;
      s.step();
    }
    expect(fac(s, 'DA').condition).toBe('wrecked');
    expect(s.world.boards.map((b) => b.status)).toEqual(['running', 'destroyed', 'running']);
    expect(s.world.boards[1]!.log.at(-1)).toMatchObject({ kind: 'system', text: 'destroyed by fire' });
    expect(s.world.stats.wrecks).toBe(1);
    const burned = s.world.alerts.filter((a) => a.kind === 'fire' || a.kind === 'wrecked');
    expect(burned.map((a) => [a.kind, a.facilityId])).toEqual([
      ['fire', 'DA'],
      ['wrecked', 'DA'],
    ]);
  });

  it('burns the same way for the same seed', () => {
    const burnStep = (seed: number): number | null => {
      const s = powered(seed);
      const dc = s.world.datacenters.DA!;
      for (let i = 0; i < 2000; i++) {
        dc.tempMilli = 140_000; // about 12,500 ppm a step
        s.step();
        if (fac(s, 'DA').condition === 'wrecked') return i;
      }
      return null;
    };
    const first = burnStep(5);
    expect(first).not.toBeNull();
    expect(burnStep(5)).toBe(first);
  });

  it('never catches fire at or below 90 °C', () => {
    const s = powered();
    for (let i = 0; i < 5000; i++) {
      s.world.datacenters.DA!.tempMilli = 90_000;
      s.step();
    }
    expect(fac(s, 'DA').condition).toBe('ok');
    expect(s.world.ended, 'the season is still running at the last step').toBeNull();
  });
});
