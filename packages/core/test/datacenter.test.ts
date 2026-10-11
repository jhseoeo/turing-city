import { describe, expect, it } from 'vitest';
import { coolingDrop, coolSteps, datacenterDraw, isCooling, isProcessing, jobSteps, runDatacenters, runFires } from '../src/datacenter.ts';
import { MICRO } from '../src/fixed.ts';
import { facilityDemand } from '../src/power.ts';
import type { Rng } from '../src/rng.ts';
import { Session } from '../src/session.ts';
import { type FacilityState, findFacility } from '../src/world.ts';
import { FakeHost } from './helpers/fake-host.ts';
import { m1Scenario, m2Scenario } from './helpers/scenarios.ts';

/**
 * Plenty of steady, free power and a steady job price: nothing is shed, fuel does not drain the money, and pay is exact.
 * The thermal module goes far above its usual maximum so that every job and every cooling cycle can run at once.
 * Passive cooling is the town's 0.3% a second: m1-power.json keeps milestone 1's 2% for its season checks.
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
      j.tuning.datacenter.passiveCoolingPermillePerSecond = 3;
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
  it('runs half a second of work from the step of a press, and pays the job price for that time', () => {
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
    expect(paid).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]); // the press acts between steps, at step 0: the job is steps 0 to 9
    expect(s.world.ledger.datacenterIncome).toBe(20 * MICRO); // 40 a second for half a second
  });

  it('does not stack presses: a press while it runs starts its half second over from that step', () => {
    const s = powered();
    const dc = s.world.datacenters.DA!;
    s.hand('DA', { kind: 'process' }); // at step 0: steps 0 to 9
    steps(s, 5);
    s.hand('DA', { kind: 'process' }); // at step 5, mid-job: now until step 14, not step 19
    steps(s, 20);
    expect([dc.busyFrom, dc.busyUntil]).toEqual([0, 15]);
    expect(s.world.ledger.datacenterIncome).toBe(15 * 2 * MICRO); // steps 0 to 14, at 2 a step
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
    expect(paid).toEqual(job);
  });

  it('runs without a gap while firmware calls process() on every beat', () => {
    const host = new FakeHost();
    const work = host.program('work', () => ({ actions: [{ kind: 'process' }] }));
    const s = holding(host);
    s.deploy('DA', work);
    const { charged, paid } = chargedAndPaid(s, 40);
    const working = Array.from({ length: 37 }, (_, i) => i + 4); // from step 4 on: each beat, 4 steps apart, moves the end on
    expect(charged).toEqual(working);
    expect(paid).toEqual(working);
  });

  it('earns the job price and gains the tuned heat for every second of work', () => {
    const host = new FakeHost();
    const work = host.program('work', () => ({ actions: [{ kind: 'process' }] }));
    const s = holding(host);
    const dc = s.world.datacenters.DA!;
    const { ambientMilli, heatMilliPerSecond } = s.scenario.tuning.datacenter;
    s.deploy('DA', work);
    steps(s, 4); // the job starts at step 4
    for (const seconds of [1, 2, 3]) {
      steps(s, s.scenario.time.stepsPerSecond);
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
    const temps: number[] = [dc.tempMilli]; // temps[i]: the temperature before step i
    for (let step = 0; step <= 80; step++) {
      s.step();
      temps.push(dc.tempMilli);
    }
    expect(temps[0]).toBe(80_000); // the press acts between steps, at step 0: the cycle is steps 0 to 79
    const drops = Array.from({ length: 80 }, (_, i) => temps[i]! - temps[i + 1]!);
    expect(new Set(drops)).toEqual(new Set([187, 188])); // 15,000 over 80 steps is 187.5 a step
    expect(temps[80]).toBe(65_000); // all of coolingDropMilli, to the milli-degree
    expect(temps[81]).toBe(65_000); // and nothing after it
  });

  it('ignores a press during a cooling cycle and goes on with a new one from its end', () => {
    const s = holding();
    const dc = s.world.datacenters.DA!;
    s.hand('DA', { kind: 'cool' }); // at step 0: steps 0 to 79
    steps(s, 10);
    s.hand('DA', { kind: 'cool' }); // at step 10, inside the cycle: nothing changes
    expect([dc.coolFrom, dc.coolUntil]).toEqual([0, 80]);
    steps(s, 70); // through step 79, the cycle's last
    s.hand('DA', { kind: 'cool' }); // at step 80, the step after its last: the cycle goes on, steps 80 to 159, in the same window
    expect([dc.coolFrom, dc.coolUntil]).toEqual([0, 160]);
  });

  it('spreads every cycle of a window that holds two the same way, so that a press at its end and a press after a step leave one temperature', () => {
    // A press on the step after a cycle's last goes on with it, one window of two cycles; a press a step later starts a window of its
    // own. Each cycle takes off coolingDropMilli, spread over coolSteps from the window's start or from the press, so both end at
    // the same temperature once both cycles are done. A cycle spread over its whole window would take off half as much in the first.
    const run = (secondPress: number): { drops: number[]; temp: number } => {
      const s = holding();
      const dc = s.world.datacenters.DA!;
      dc.tempMilli = 80_000;
      s.hand('DA', { kind: 'cool' });
      const drops: number[] = [];
      for (let step = 0; step < 240; step++) {
        if (step === secondPress) s.hand('DA', { kind: 'cool' });
        const before = dc.tempMilli;
        s.step();
        drops.push(before - dc.tempMilli);
      }
      return { drops, temp: dc.tempMilli };
    };
    const continued = run(80);
    const fresh = run(81);
    expect(continued.temp).toBe(50_000); // 80,000 less two whole drops of 15,000
    expect(fresh.temp).toBe(50_000);
    expect(continued.drops.slice(80, 160)).toEqual(continued.drops.slice(0, 80)); // the second cycle spreads like the first
  });

  it('takes nothing off outside its cool window, and the whole drop off each cycle inside it', () => {
    const s = holding();
    const dc = s.world.datacenters.DA!;
    Object.assign(dc, { coolFrom: 100, coolUntil: 260 }); // two back-to-back cycles
    const taken = (from: number, until: number): number => {
      let sum = 0;
      for (let step = from; step < until; step++) sum += coolingDrop(s.ctx, dc, step);
      return sum;
    };
    expect(taken(0, 100)).toBe(0);
    expect(taken(100, 180)).toBe(15_000);
    expect(taken(180, 260)).toBe(15_000);
    expect(taken(260, 400)).toBe(0);
  });

  it('never cools below ambient, whatever a cycle would take off', () => {
    const s = holding();
    const dc = s.world.datacenters.DA!;
    dc.tempMilli = 30_000; // 5 °C over ambient, and a cycle takes 15 °C off
    s.hand('DA', { kind: 'cool' });
    steps(s, 80);
    expect(dc.tempMilli).toBe(25_000);
  });

  it('does one thing at a time: a press of the other button while a job or a cycle runs does nothing', () => {
    const working = holding();
    const a = working.world.datacenters.DA!;
    a.tempMilli = 80_000;
    working.hand('DA', { kind: 'process' });
    working.hand('DA', { kind: 'cool' }); // during the job: nothing
    steps(working, 10); // the job's steps 0 to 9
    expect(a.tempMilli).toBe(80_000 + 1_000); // +100 a step of work, and no cooling
    expect(working.world.ledger.datacenterIncome).toBe(20 * MICRO);

    const cooling = holding();
    const b = cooling.world.datacenters.DA!;
    b.tempMilli = 80_000;
    cooling.hand('DA', { kind: 'cool' });
    cooling.hand('DA', { kind: 'process' }); // during the cycle: nothing
    steps(cooling, 10);
    expect(b.tempMilli).toBe(80_000 - ((15_000 * 10) / cooling.scenario.tuning.datacenter.coolingCycleMs) * 50); // the cycle's first ten parts
    expect(cooling.world.ledger.datacenterIncome).toBe(0);
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
    expect(datacenterDraw(s.ctx, fac(s, 'P'), 7)).toBe(0); // the plant has no datacenter work to draw for
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
    steps(s, 12);
    expect(s.world.ledger.datacenterIncome).toBe(20 * MICRO);
    expect(s.world.datacenters.DA!.tempMilli).toBeGreaterThan(25_000);
  });

  it('goes on with a job started by hand while its board sleeps', () => {
    const s = powered();
    s.world.boards[1]!.status = 'asleep'; // DA's board; with no wake-up time set, it stays asleep
    s.hand('DA', { kind: 'process' });
    steps(s, 12);
    expect(s.world.ledger.datacenterIncome).toBe(20 * MICRO);
  });

  it('works, cools, and draws power the same whatever its board is doing, and with no board at all: the work is the facility', () => {
    const withBoard = (status: 'running' | 'asleep' | 'destroyed' | 'rebuilding') => (): Session => {
      const s = powered();
      s.world.boards[1]!.status = status; // DA's board
      return s;
    };
    const cases: Array<[string, () => Session]> = [
      ['running', withBoard('running')],
      ['asleep', withBoard('asleep')],
      ['destroyed', withBoard('destroyed')],
      ['rebuilding', withBoard('rebuilding')],
      ['no board', town],
    ];
    for (const [name, make] of cases) {
      const s = make();
      const { processPower, coolingPower } = s.scenario.tuning.datacenter;
      Object.assign(s.world.datacenters.DA!, { busyFrom: 0, busyUntil: 100, coolFrom: 0, coolUntil: 100 });
      expect(datacenterDraw(s.ctx, fac(s, 'DA'), 5), name).toBe(processPower + coolingPower);
      expect(isProcessing(s.ctx, 'DA', 5), name).toBe(true);
      expect(isCooling(s.ctx, 'DA', 5), name).toBe(true);
    }
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

  it('pays every working datacenter into the town money and the ledger alike', () => {
    const s = powered();
    for (const id of ['DA', 'DB']) {
      s.world.datacenters[id]!.busyFrom = 0;
      s.world.datacenters[id]!.busyUntil = 4;
    }
    const before = s.world.money;
    runDatacenters(s.ctx, 0); // each pays 40 a second for a twentieth of a second
    expect(s.world.money - before).toBe(4 * MICRO);
    expect(s.world.ledger.datacenterIncome).toBe(4 * MICRO);
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
