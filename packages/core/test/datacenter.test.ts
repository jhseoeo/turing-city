import { describe, expect, it } from 'vitest';
import { isProcessing, runDatacenters, runFires } from '../src/datacenter.ts';
import { MICRO } from '../src/fixed.ts';
import { facilityDemand } from '../src/power.ts';
import type { Rng } from '../src/rng.ts';
import { Session } from '../src/session.ts';
import { FakeHost } from './helpers/fake-host.ts';
import { m1Scenario } from './helpers/scenarios.ts';

/** Plenty of steady power, so nothing is shed unless a test wants it. */
function powered(seed = 1): Session {
  const s = new Session(
    m1Scenario((j) => {
      j.tuning.wind.start = 220;
      j.tuning.wind.maxChangePerSecond = 0;
      j.tuning.jobPrice.maxChangePerSecond = 0;
      j.tuning.emf.rumourThreshold = 1_000_000_000; // no raids once Task 12 adds them
    }),
    seed,
    new FakeHost(),
  );
  s.world.plant.thermalSetting = 300;
  return s;
}

function steps(s: Session, n: number): void {
  for (let i = 0; i < n; i++) s.step();
}

/** Like powered(), but heat does not leak away: a temperature set by hand stays until a phase changes it. */
function holding(host = new FakeHost()): Session {
  const s = new Session(
    m1Scenario((j) => {
      j.tuning.wind.start = 220;
      j.tuning.wind.maxChangePerSecond = 0;
      j.tuning.jobPrice.maxChangePerSecond = 0;
      j.tuning.emf.rumourThreshold = 1_000_000_000; // no raids once Task 12 adds them
      j.tuning.datacenter.passiveCoolingPctPerSecond = 0;
    }),
    1,
    host,
  );
  s.world.plant.thermalSetting = 300;
  return s;
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
  s.step(); // step 0: no job yet, so the power demand it reports is the idle demand
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
  it('earns the job price per second of processing, pro rata', () => {
    const s = powered();
    const dc = s.world.datacenters.DA!;
    dc.jobFrom = 0;
    dc.jobUntil = 3; // four steps = 0.2 s at price 40 -> 8
    steps(s, 4);
    expect(s.world.ledger.datacenterIncome).toBe(8 * MICRO);
    steps(s, 4);
    expect(s.world.ledger.datacenterIncome).toBe(8 * MICRO);
  });

  it('heats while processing and cools toward ambient after', () => {
    const s = powered();
    const dc = s.world.datacenters.DA!;
    dc.jobFrom = 0;
    dc.jobUntil = 20 * 10 - 1; // 10 s of work
    steps(s, 200);
    const hot = dc.tempMilli;
    expect(hot).toBeGreaterThan(25_000 + 15_000); // ~+20 °C minus passive loss
    expect(hot).toBeLessThan(25_000 + 20_000);
    steps(s, 200);
    expect(dc.tempMilli).toBeLessThan(hot);
    expect(dc.tempMilli).toBeGreaterThanOrEqual(25_000);
  });

  it('cools faster with cooling on, never below ambient', () => {
    const plain = powered();
    const cooled = powered();
    for (const s of [plain, cooled]) s.world.datacenters.DA!.tempMilli = 80_000;
    cooled.world.datacenters.DA!.cooling = 3;
    steps(plain, 100);
    steps(cooled, 100);
    expect(cooled.world.datacenters.DA!.tempMilli).toBeLessThan(plain.world.datacenters.DA!.tempMilli);
    steps(cooled, 2000);
    expect(cooled.world.datacenters.DA!.tempMilli).toBe(25_000);
  });

  it('does not process or heat while its facility is shed', () => {
    const s = powered();
    s.world.plant.thermalSetting = 0;
    s.world.plant.wind = 0; // the wind won't move: maxChangePerSecond is 0
    const dc = s.world.datacenters.DA!;
    dc.jobFrom = 0;
    dc.jobUntil = 100;
    steps(s, 50);
    expect(s.world.ledger.datacenterIncome).toBe(0);
    expect(dc.tempMilli).toBe(25_000);
  });

  it('raises an overheat alert at 85 °C, once until it falls below 80 °C', () => {
    const s = powered();
    const dc = s.world.datacenters.DA!;
    dc.tempMilli = 86_000;
    steps(s, 5);
    dc.tempMilli = 86_000;
    steps(s, 5);
    expect(s.world.alerts.filter((a) => a.kind === 'overheat')).toHaveLength(1);
    dc.tempMilli = 70_000;
    steps(s, 1);
    dc.tempMilli = 86_000;
    steps(s, 1);
    expect(s.world.alerts.filter((a) => a.kind === 'overheat')).toHaveLength(2);
  });

  it('can catch fire above 90 °C and destroy the board, the same way for the same seed', () => {
    const burnStep = (seed: number): number | null => {
      const s = powered(seed);
      const dc = s.world.datacenters.DA!;
      for (let i = 0; i < 2000; i++) {
        dc.tempMilli = 140_000; // about 12,500 ppm per step
        s.step();
        if (s.world.boards[1]!.status === 'destroyed') return i;
      }
      return null;
    };
    const first = burnStep(5);
    expect(first).not.toBeNull();
    expect(burnStep(5)).toBe(first);
    const s = powered(5);
    for (let i = 0; i <= first!; i++) {
      s.world.datacenters.DA!.tempMilli = 140_000;
      s.step();
    }
    expect(s.world.alerts.map((a) => a.kind)).toEqual(expect.arrayContaining(['fire', 'boardDestroyed']));
  });

  it('never catches fire at or below 90 °C', () => {
    const s = powered();
    for (let i = 0; i < 5000; i++) {
      s.world.datacenters.DA!.tempMilli = 90_000;
      s.step();
    }
    expect(s.world.boards[1]!.status).toBe('running');
  });

  it('counts a step as processing exactly when the power phase charges the job for it', () => {
    const s = powered();
    const da = s.world.boards[1]!;
    const dc = s.world.datacenters.DA!;
    for (const status of ['running', 'asleep', 'destroyed', 'rebuilding'] as const) {
      for (const [from, until] of [
        [5, 8],
        [5, 5],
        [-1, -1],
      ] as const) {
        for (let step = 3; step <= 10; step++) {
          da.status = status;
          da.powered = true;
          dc.jobFrom = from;
          dc.jobUntil = until;
          const charged = facilityDemand(s.ctx, da, step);
          dc.jobFrom = -1;
          dc.jobUntil = -1;
          const idle = facilityDemand(s.ctx, da, step);
          dc.jobFrom = from;
          dc.jobUntil = until;
          const where = `${status}, job ${from}..${until}, step ${step}`;
          expect(isProcessing(s.ctx, 'DA', step), where).toBe(charged > idle);
          da.powered = false; // shed: the job drew its power, but nothing was done
          expect(isProcessing(s.ctx, 'DA', step), `${where}, shed`).toBe(false);
        }
      }
    }
  });

  it('is not processing for the plant, which has no datacenter, or for an id nobody has', () => {
    const s = powered();
    expect(isProcessing(s.ctx, 'P', 0)).toBe(false);
    expect(isProcessing(s.ctx, 'ZZ', 0)).toBe(false);
  });

  it('charges and pays the job of one process() call on the same steps: one tick period, no more', () => {
    const host = new FakeHost();
    let calls = 0;
    const once = host.program('once', () => ({ actions: calls++ === 0 ? [{ kind: 'process' }] : [] }));
    const s = holding(host);
    s.deploy('DA', once);
    s.step();
    const idle = s.world.plant.demand; // nothing runs yet at step 0
    let earned = s.world.ledger.datacenterIncome;
    const charged: number[] = [];
    const paid: number[] = [];
    for (let step = 1; step < 16; step++) {
      s.step();
      if (s.world.plant.demand > idle) charged.push(step);
      if (s.world.ledger.datacenterIncome > earned) paid.push(step);
      earned = s.world.ledger.datacenterIncome;
    }
    expect(charged).toEqual([4, 5, 6, 7]); // DA's first beat is step 3, and its next is step 7
    expect(paid).toEqual([4, 5, 6, 7]);
  });

  it('charges and pays a process()-every-beat firmware on exactly the same steps, period after period', () => {
    const host = new FakeHost();
    const work = host.program('work', () => ({ actions: [{ kind: 'process' }] }));
    const s = holding(host);
    s.deploy('DA', work);
    const { charged, paid } = chargedAndPaid(s, 40);
    // DA's first beat is step 3, so the job runs from step 4; each later beat (7, 11, ...) carries it on without losing a step
    const working = Array.from({ length: 37 }, (_, i) => i + 4);
    expect(charged).toEqual(working);
    expect(paid).toEqual(working);
  });

  it('earns the job price and gains the tuned heat for every second a process()-every-beat firmware works', () => {
    const host = new FakeHost();
    const work = host.program('work', () => ({ actions: [{ kind: 'process' }] }));
    const s = holding(host);
    const dc = s.world.datacenters.DA!;
    const { ambientMilli, heatMilliPerSecond } = s.scenario.tuning.datacenter;
    s.deploy('DA', work);
    steps(s, 4); // DA's first beat is step 3, so the job starts at step 4
    for (const seconds of [1, 2, 3]) {
      steps(s, s.scenario.time.stepsPerSecond);
      expect(s.world.ledger.datacenterIncome, `income after ${seconds} s of work`).toBe(seconds * s.world.jobPrice * MICRO);
      // nothing cools it here, so all of spec 10's +2 °C a second shows
      expect(dc.tempMilli, `temperature after ${seconds} s of work`).toBe(ambientMilli + seconds * heatMilliPerSecond);
    }
  });

  it('leaves a real gap where a beat skips process(): nothing in it is charged or paid, and the next job starts after its call', () => {
    const host = new FakeHost();
    let beats = 0;
    // calls process() on beats 1, 3 and 4 (steps 3, 11 and 15), skipping beat 2 (step 7) and every beat after the fourth
    const patchy = host.program('patchy', () => ({ actions: ++beats === 2 || beats > 4 ? [] : [{ kind: 'process' }] }));
    const s = holding(host);
    s.deploy('DA', patchy);
    const { charged, paid } = chargedAndPaid(s, 24);
    // the first job ends at 7 and the skipped beat leaves 8 to 11 idle; the call at 11 starts at 12, and the one at 15 goes on to 19
    const expected = [4, 5, 6, 7, 12, 13, 14, 15, 16, 17, 18, 19];
    expect(charged).toEqual(expected);
    expect(paid).toEqual(expected);
  });

  it('pays every working datacenter into the town money and the ledger alike', () => {
    const s = powered();
    for (const id of ['DA', 'DB']) {
      s.world.datacenters[id]!.jobFrom = 0;
      s.world.datacenters[id]!.jobUntil = 3;
    }
    const before = s.world.money;
    runDatacenters(s.ctx, 0); // each pays 40 a second for a twentieth of a second
    expect(s.world.money - before).toBe(4 * MICRO);
    expect(s.world.ledger.datacenterIncome).toBe(4 * MICRO);
  });

  it('cools actively only while its board is running and powered', () => {
    const tempAfter = (level: number, prepare: (s: Session) => void): number => {
      const s = powered();
      prepare(s);
      const dc = s.world.datacenters.DA!;
      dc.tempMilli = 80_000;
      dc.cooling = level;
      steps(s, 10);
      return dc.tempMilli;
    };
    const working = (): void => {};
    expect(tempAfter(3, working)).toBeLessThan(tempAfter(0, working));
    const notWorking: Record<string, (s: Session) => void> = {
      shed: (s) => {
        s.world.plant.thermalSetting = 0;
        s.world.plant.wind = 0;
      },
      asleep: (s) => {
        s.world.boards[1]!.status = 'asleep';
      },
      destroyed: (s) => {
        s.world.boards[1]!.status = 'destroyed';
      },
      rebuilding: (s) => {
        s.world.boards[1]!.status = 'rebuilding';
      },
    };
    for (const [name, prepare] of Object.entries(notWorking)) {
      expect(tempAfter(3, prepare), name).toBe(tempAfter(0, prepare));
    }
  });

  it('takes the tuned heat per level out each second, in proportion to the level and none at level 0', () => {
    const rate = m1Scenario().tuning.datacenter.coolingMilliPerLevelPerSecond;
    const droppedInASecond = (level: number): number => {
      const s = holding();
      const dc = s.world.datacenters.DA!;
      dc.tempMilli = 80_000;
      dc.cooling = level;
      for (let i = 0; i < s.scenario.time.stepsPerSecond; i++) runDatacenters(s.ctx, i);
      return 80_000 - dc.tempMilli;
    };
    expect([0, 1, 2, 3].map(droppedInASecond)).toEqual([0, rate, 2 * rate, 3 * rate]);
  });

  it('lets heat leak away by the tuned percent of its excess each second, split over the steps and rounded down', () => {
    const s = powered();
    const dc = s.world.datacenters.DA!;
    dc.tempMilli = 80_030; // 55,030 over ambient: 2% a second over 20 steps is 55.03, taken as 55
    runDatacenters(s.ctx, 0);
    expect(dc.tempMilli).toBe(79_975);
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
    dc.jobFrom = 0;
    dc.jobUntil = 0;
    dc.tempMilli = 89_950; // the job's heat for one step is 100 milli-degrees: 90,050 by the fire phase
    s.step();
    expect(rolls).toEqual([12]); // 50 milli-degrees x 5 permille a degree each second / 20 steps = 12.5, rounded down
  });

  it('does not roll for a destroyed or rebuilding board, but a hot datacenter burns asleep or shed too', () => {
    const rollsOf = (prepare: (s: Session) => void): number[] => {
      const s = holding();
      const rolls = recordFireRolls(s);
      prepare(s);
      s.world.datacenters.DA!.tempMilli = 140_000;
      runFires(s.ctx, 0);
      return rolls;
    };
    expect(
      rollsOf((s) => {
        s.world.boards[1]!.status = 'destroyed';
      }),
      'destroyed',
    ).toEqual([]);
    expect(
      rollsOf((s) => {
        s.world.boards[1]!.status = 'rebuilding';
      }),
      'rebuilding',
    ).toEqual([]);
    expect(
      rollsOf((s) => {
        s.world.boards[1]!.status = 'asleep';
      }),
      'asleep',
    ).toEqual([12_500]);
    expect(
      rollsOf((s) => {
        s.world.boards[1]!.powered = false;
      }),
      'shed',
    ).toEqual([12_500]);
  });

  it('burns one board once: the alerts name it, its log says why, and a hot wreck does not catch fire again', () => {
    const s = powered(5);
    const dc = s.world.datacenters.DA!;
    for (let i = 0; i < 1000; i++) {
      dc.tempMilli = 140_000;
      s.step();
    }
    expect(s.world.boards.map((b) => b.status)).toEqual(['running', 'destroyed', 'running']);
    expect(s.world.stats.boardsLost).toBe(1);
    const burned = s.world.alerts.filter((a) => a.kind === 'fire' || a.kind === 'boardDestroyed');
    expect(burned.map((a) => [a.kind, a.facilityId])).toEqual([
      ['fire', 'DA'],
      ['boardDestroyed', 'DA'],
    ]);
    expect(s.world.boards[1]!.log.at(-1)).toMatchObject({ kind: 'system', text: 'destroyed by fire' });
  });
});
