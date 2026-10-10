import { describe, expect, it } from 'vitest';
import { stateHash } from '../src/hash.ts';
import { facilityDemand, plantBoard, priorityOrder, runPower } from '../src/power.ts';
import { Session } from '../src/session.ts';
import { stepsForSeconds } from '../src/time.ts';
import { FakeHost } from './helpers/fake-host.ts';
import { m1Scenario } from './helpers/scenarios.ts';

/** The shortage alert's quiet time in steps: 10 seconds of the milestone-1 scenario, at 20 steps a second. */
const QUIET_STEPS = 200;

/** A session with a steady wind, for exact power arithmetic. */
function calm(wind: number): Session {
  return new Session(
    m1Scenario((j) => {
      j.tuning.wind.start = wind;
      j.tuning.wind.maxChangePerSecond = 0;
    }),
    1,
    new FakeHost(),
  );
}

/**
 * A grid that sheds DB while the thermal setting is 250 and covers every facility at 300: the wind is 100, and both datacenters
 * have a job running for ever. The quiet time can be retuned.
 */
function sheddable(quietSeconds?: number): Session {
  const s = new Session(
    m1Scenario((j) => {
      j.tuning.wind.start = 100;
      j.tuning.wind.maxChangePerSecond = 0;
      if (quietSeconds !== undefined) j.tuning.shortageQuietSeconds = quietSeconds;
    }),
    1,
    new FakeHost(),
  );
  for (const id of ['DA', 'DB']) {
    s.world.datacenters[id]!.jobFrom = 0;
    s.world.datacenters[id]!.jobUntil = 100_000;
  }
  return s;
}

/** Runs the power phase over the steps from..to (inclusive) with the grid shedding DB or not. */
function run(s: Session, from: number, to: number, shedding: boolean): void {
  s.world.plant.thermalSetting = shedding ? 250 : 300;
  for (let step = from; step <= to; step++) runPower(s.ctx, step);
}

const shortages = (s: Session) => s.world.alerts.filter((a) => a.kind === 'powerShortage');
const texts = (b: { log: ReadonlyArray<{ text: string }> }): string[] => b.log.map((l) => l.text);

describe('power', () => {
  it("adds 2% per cell from the plant to a facility's draw", () => {
    const s = calm(120);
    const ctx = s.ctx;
    const [p, da, db] = s.world.boards;
    expect(facilityDemand(ctx, p!, 0)).toBe(5);
    expect(facilityDemand(ctx, da!, 0)).toBe(10); // 1 cell: 10 + floor(10 * 2 / 100)
    expect(facilityDemand(ctx, db!, 0)).toBe(13); // 16 cells: 10 + floor(10 * 32 / 100)
  });

  it("adds a running job and cooling to a datacenter's draw", () => {
    const s = calm(120);
    const ctx = s.ctx;
    const dc = s.world.datacenters.DA!;
    dc.jobFrom = 5;
    dc.jobUntil = 8;
    dc.cooling = 2;
    const da = s.world.boards[1]!;
    expect(facilityDemand(ctx, da, 4)).toBe(50 + 1); // 10 + 40 cooling, + 2%
    expect(facilityDemand(ctx, da, 5)).toBe(200 + 4); // + 150 for the job
  });

  it('draws only sleep power while asleep and nothing while destroyed', () => {
    const s = calm(120);
    const ctx = s.ctx;
    const db = s.world.boards[2]!;
    db.status = 'asleep';
    expect(facilityDemand(ctx, db, 0)).toBe(1); // 1 + floor(1 * 32 / 100)
    db.status = 'destroyed';
    expect(facilityDemand(ctx, db, 0)).toBe(0);
  });

  it('powers everyone when generation covers demand', () => {
    const s = calm(120);
    runPower(s.ctx, 0);
    expect(s.world.plant).toMatchObject({ generation: 120, demand: 28, shed: [] });
    expect(s.world.boards.every((b) => b.powered)).toBe(true);
  });

  it('sheds whole facilities from the lowest priority up', () => {
    const s = calm(100);
    const ctx = s.ctx;
    for (const id of ['DA', 'DB']) {
      s.world.datacenters[id]!.jobFrom = 0;
      s.world.datacenters[id]!.jobUntil = 10;
    }
    s.world.plant.thermalSetting = 250; // generation 350; demand 5 + 163 + 211 = 379
    runPower(ctx, 0);
    expect(s.world.plant).toMatchObject({ generation: 350, demand: 379, shed: ['DB'] });
    expect(s.world.boards.map((b) => b.powered)).toEqual([true, true, false]);
    s.world.plant.priority = ['DB', 'DA'];
    runPower(ctx, 0);
    expect(s.world.plant.shed).toEqual(['DA']);
  });

  it("keeps the plant's own board powered even with nothing generated", () => {
    const s = calm(0);
    runPower(s.ctx, 0);
    expect(plantBoard(s.world).powered).toBe(true);
    expect(s.world.boards.slice(1).every((b) => !b.powered)).toBe(true);
  });

  it("runs thermal only while the plant's board is running", () => {
    const s = calm(50);
    s.world.plant.thermalSetting = 200;
    plantBoard(s.world).status = 'destroyed';
    runPower(s.ctx, 0);
    expect(s.world.plant.generation).toBe(50);
  });

  it('raises a shortage alert once per episode', () => {
    const s = calm(0);
    for (let i = 0; i < 10; i++) s.step();
    expect(s.world.alerts.filter((a) => a.kind === 'powerShortage')).toHaveLength(1);
  });

  describe("a board's log of an outage", () => {
    const dbOf = (s: Session) => s.world.boards[2]!;

    it('folds the cuts of a flickering board into one "power lost" line, and logs "power back" only once it has been steady', () => {
      const s = sheddable();
      for (let step = 0; step < 100; step++) run(s, step, step, step % 2 === 0); // cut at 0, 2, ..., 98, with power at the odd steps between
      expect(dbOf(s).log).toEqual([{ step: 98, kind: 'system', text: 'power lost', repeat: 50 }]);
      run(s, 99, 98 + QUIET_STEPS - 1, false); // power since step 99: one step short of the quiet time since the last cut
      expect(texts(dbOf(s))).toEqual(['power lost']);
      run(s, 98 + QUIET_STEPS, 98 + QUIET_STEPS, false);
      expect(dbOf(s).log).toEqual([
        { step: 98, kind: 'system', text: 'power lost', repeat: 50 },
        { step: 98 + QUIET_STEPS, kind: 'system', text: 'power back (steady for 10 s)', repeat: 1 },
      ]);
      run(s, 99 + QUIET_STEPS, 98 + 3 * QUIET_STEPS, false);
      expect(dbOf(s).log).toHaveLength(2); // exactly one "power back"
      expect(s.world.boards[1]!.log).toEqual([]); // DA kept its power
      expect(plantBoard(s.world).log).toEqual([]);
    });

    it('logs each outage on its own: the cut, the steady return, and the next cut', () => {
      const s = sheddable();
      run(s, 0, 0, true);
      run(s, 1, QUIET_STEPS, false);
      run(s, QUIET_STEPS + 1, QUIET_STEPS + 1, true);
      run(s, QUIET_STEPS + 2, 2 * QUIET_STEPS + 1, false);
      expect(dbOf(s).log.map((l) => [l.step, l.text])).toEqual([
        [0, 'power lost'],
        [QUIET_STEPS, 'power back (steady for 10 s)'],
        [QUIET_STEPS + 1, 'power lost'],
        [2 * QUIET_STEPS + 1, 'power back (steady for 10 s)'],
      ]);
    });

    it('counts the quiet time from the last step the board was without power, however long the outage was', () => {
      const s = sheddable();
      run(s, 0, 150, true); // an outage longer than the quiet time itself
      run(s, 151, 150 + QUIET_STEPS - 1, false);
      expect(texts(dbOf(s))).toEqual(['power lost']);
      run(s, 150 + QUIET_STEPS, 150 + QUIET_STEPS, false);
      expect(dbOf(s).log.at(-1)).toMatchObject({ step: 150 + QUIET_STEPS, text: 'power back (steady for 10 s)' });
    });

    it('logs the outage of a board that sleeps', () => {
      const s = calm(0); // nothing is generated: every board that draws power is shed
      const [, da, db] = s.world.boards;
      da!.status = 'asleep';
      runPower(s.ctx, 0);
      expect(texts(da!)).toEqual(['power lost']);
      expect(texts(db!)).toEqual(['power lost']);
    });

    it.each(['destroyed', 'rebuilding'] as const)(
      'owes no "power back" to a board that is %s in the middle of an outage, nor to the one rebuilt',
      (status) => {
        const s = sheddable();
        run(s, 0, 4, true); // DB is cut at step 0 and stays cut
        dbOf(s).status = status; // it draws nothing now, so the grid has no one to cut off
        run(s, 5, 5 + QUIET_STEPS + 50, false);
        expect(texts(dbOf(s))).toEqual(['power lost']);
        expect(dbOf(s).lastCutStep).toBeNull(); // nothing is owed
        dbOf(s).status = 'running'; // rebuilt: it starts fresh, with power
        run(s, 6 + QUIET_STEPS + 50, 6 + 3 * QUIET_STEPS, false);
        expect(texts(dbOf(s))).toEqual(['power lost']);
      },
    );

    it('keeps the step a board was last cut in the world state, and so in the state hash, on its own', () => {
      const s = sheddable();
      expect(dbOf(s).lastCutStep).toBeNull();
      run(s, 0, 0, true);
      expect(dbOf(s).lastCutStep).toBe(0);
      run(s, 1, 1, false);
      expect(dbOf(s).lastCutStep).toBe(0); // owed until the board has been steady for the quiet time
      // Two worlds that differ in this field of one board and in nothing else.
      const a = sheddable();
      const b = sheddable();
      expect(stateHash(a.world)).toBe(stateHash(b.world));
      a.world.boards[2]!.lastCutStep = 7;
      expect(stateHash(a.world)).not.toBe(stateHash(b.world));
      b.world.boards[2]!.lastCutStep = 7;
      expect(stateHash(a.world)).toBe(stateHash(b.world));
      // It is per board: the same step on another board is another state.
      b.world.boards[2]!.lastCutStep = null;
      b.world.boards[1]!.lastCutStep = 7;
      expect(stateHash(a.world)).not.toBe(stateHash(b.world));
    });

    it('takes the time to be steady from the scenario, in the words of its log too', () => {
      const s = sheddable(3); // 3 seconds are 60 steps
      run(s, 0, 0, true);
      run(s, 1, 59, false);
      expect(texts(dbOf(s))).toEqual(['power lost']);
      run(s, 60, 60, false);
      expect(dbOf(s).log.at(-1)).toMatchObject({ step: 60, kind: 'system', text: 'power back (steady for 3 s)' });
    });

    it('logs "power back" at once, with no delay to explain, when the quiet time is zero', () => {
      const s = sheddable(0);
      run(s, 0, 0, true);
      run(s, 1, 1, false);
      expect(dbOf(s).log.map((l) => [l.step, l.text])).toEqual([
        [0, 'power lost'],
        [1, 'power back'],
      ]);
    });
  });

  it('does not tick a board whose facility was shed', () => {
    const host = new FakeHost();
    const src = host.program('noop', () => ({}));
    const s = new Session(
      m1Scenario((j) => {
        j.tuning.wind.start = 0;
        j.tuning.wind.maxChangePerSecond = 0;
      }),
      1,
      host,
    );
    s.deploy('DA', src);
    for (let i = 0; i < 20; i++) s.step();
    expect(host.calls).toEqual([]);
  });

  it('moves wind and job price within their bounds, and redraws fuel daily', () => {
    const s = new Session(
      m1Scenario((j) => {
        j.tuning.emf.rumourThreshold = 1_000_000_000; // the gauge can't fill: on default tuning a raid at step 3,179 smashes every board and ends the season at 3,640
      }),
      99,
      new FakeHost(),
    );
    const winds = new Set<number>();
    const fuel = new Set<number>();
    for (let i = 0; i < 800 * 5; i++) {
      s.step();
      winds.add(s.world.plant.wind);
      fuel.add(s.world.plant.fuelPrice);
      expect(s.world.plant.wind).toBeGreaterThanOrEqual(0);
      expect(s.world.plant.wind).toBeLessThanOrEqual(220);
      expect(s.world.jobPrice).toBeGreaterThanOrEqual(15);
      expect(s.world.jobPrice).toBeLessThanOrEqual(80);
    }
    expect(winds.size).toBeGreaterThan(20);
    expect([...fuel].every((f) => f >= 5 && f <= 9)).toBe(true);
    expect(s.world.ended, 'the season is still running at the last step').toBeNull();
  });

  it("draws a job's power through its last step and not after it", () => {
    const s = calm(120);
    const dc = s.world.datacenters.DA!;
    dc.jobFrom = 5;
    dc.jobUntil = 8;
    const da = s.world.boards[1]!;
    expect(facilityDemand(s.ctx, da, 8)).toBe(163); // 10 + 150, + floor(160 * 2 / 100)
    expect(facilityDemand(s.ctx, da, 9)).toBe(10);
  });

  it("draws nothing while the facility's board is being rebuilt", () => {
    const s = calm(120);
    const db = s.world.boards[2]!;
    db.status = 'rebuilding';
    expect(facilityDemand(s.ctx, db, 0)).toBe(0);
  });

  it('rounds the loss down, and charges it on sleep power too', () => {
    const s = new Session(
      m1Scenario((j) => {
        j.facilities[2]!.board.power = 11;
        j.tuning.sleepPower = 11;
      }),
      1,
      new FakeHost(),
    );
    const db = s.world.boards[2]!;
    expect(facilityDemand(s.ctx, db, 0)).toBe(14); // 16 cells: 11 + floor(11 * 32 / 100) = 11 + 3
    db.status = 'asleep';
    expect(facilityDemand(s.ctx, db, 0)).toBe(14);
  });

  it('powers everyone when generation exactly covers demand, and sheds when it is one short', () => {
    const exact = calm(28); // 5 for the plant's board, 10 for DA, 13 for DB
    runPower(exact.ctx, 0);
    expect(exact.world.plant).toMatchObject({ generation: 28, demand: 28, shed: [] });
    const short = calm(27);
    runPower(short.ctx, 0);
    expect(short.world.plant.shed).toEqual(['DB']);
  });

  it("stops the thermal module while the plant's board sleeps or is being rebuilt", () => {
    for (const status of ['asleep', 'rebuilding'] as const) {
      const s = calm(50);
      s.world.plant.thermalSetting = 200;
      plantBoard(s.world).status = status;
      runPower(s.ctx, 0);
      expect(s.world.plant.generation, status).toBe(50);
    }
  });

  it('raises a new shortage alert when a second shortage begins after the first has ended', () => {
    const s = calm(100);
    for (const id of ['DA', 'DB']) {
      s.world.datacenters[id]!.jobFrom = 0;
      s.world.datacenters[id]!.jobUntil = 1000; // through the quiet time that the test waits out
    }
    const shortages = () => s.world.alerts.filter((a) => a.kind === 'powerShortage');
    s.world.plant.thermalSetting = 250; // generation 350 against a demand of 379: DB is shed
    runPower(s.ctx, 0);
    runPower(s.ctx, 1); // the same episode
    expect(shortages()).toHaveLength(1);
    expect(shortages()[0]!.message).toContain('DB');
    s.world.plant.thermalSetting = 300; // generation 400 covers it
    runPower(s.ctx, 2);
    expect(s.world.plant.shed).toEqual([]);
    s.world.plant.thermalSetting = 250;
    runPower(s.ctx, 3); // a flicker, not a second shortage: the quiet time has not passed (the tests below)
    expect(shortages()).toHaveLength(1);
    s.world.plant.thermalSetting = 300;
    for (let step = 4; step <= 3 + QUIET_STEPS; step++) runPower(s.ctx, step);
    s.world.plant.thermalSetting = 250;
    runPower(s.ctx, 4 + QUIET_STEPS);
    expect(shortages()).toHaveLength(2);
  });

  describe('the quiet time of a shortage', () => {
    it('is 10 seconds in the milestone-1 scenario, which is the 200 steps these tests count', () => {
      const { time, tuning } = calm(100).scenario;
      expect(tuning.shortageQuietSeconds).toBe(10);
      expect(stepsForSeconds(time, tuning.shortageQuietSeconds)).toBe(QUIET_STEPS);
    });

    it('raises no new alert for a plant that sheds and re-powers again and again', () => {
      const s = sheddable();
      for (let step = 0; step < 100; step++) run(s, step, step, step % 2 === 0); // a flicker every step
      expect(shortages(s)).toHaveLength(1);
      expect(s.world.boards[2]!.log.filter((l) => l.text === 'power lost').reduce((n, l) => n + l.repeat, 0)).toBe(50); // each flip is still logged
    });

    it('ends the episode only after the grid has had no shed facility for the whole quiet time', () => {
      const s = sheddable();
      run(s, 0, 0, true);
      expect(shortages(s)).toHaveLength(1);
      run(s, 1, QUIET_STEPS - 1, false); // one step short of the quiet time
      run(s, QUIET_STEPS, QUIET_STEPS, true);
      expect(shortages(s)).toHaveLength(1);
      run(s, QUIET_STEPS + 1, 2 * QUIET_STEPS, false); // the quiet time, in full
      run(s, 2 * QUIET_STEPS + 1, 2 * QUIET_STEPS + 1, true);
      expect(shortages(s)).toHaveLength(2);
    });

    it('counts the quiet time from the last step something was shed, not from the first', () => {
      const s = sheddable();
      run(s, 0, 150, true); // a long shortage, longer than the quiet time itself
      run(s, 151, 150 + QUIET_STEPS - 1, false);
      run(s, 150 + QUIET_STEPS, 150 + QUIET_STEPS, true);
      expect(shortages(s)).toHaveLength(1);
    });

    it('keeps the last step of a shed in the world state, and so in the state hash, on its own', () => {
      const s = sheddable();
      expect(s.world.plant.lastShedStep).toBeNull();
      run(s, 0, 0, true);
      expect(s.world.plant.lastShedStep).toBe(0);
      run(s, 1, 1, false);
      expect(s.world.plant.lastShedStep).toBe(0); // clear steps do not move it
      run(s, 2, 2, true);
      expect(s.world.plant.lastShedStep).toBe(2);
      // Two worlds that differ in this field and in nothing else.
      const a = sheddable();
      const b = sheddable();
      expect(stateHash(a.world)).toBe(stateHash(b.world));
      a.world.plant.lastShedStep = 7;
      expect(stateHash(a.world)).not.toBe(stateHash(b.world));
      b.world.plant.lastShedStep = 7;
      expect(stateHash(a.world)).toBe(stateHash(b.world));
    });

    it('is a tuning value of the scenario: zero ends the episode as soon as nothing is shed', () => {
      const s = new Session(
        m1Scenario((j) => {
          j.tuning.shortageQuietSeconds = 0;
          j.tuning.wind.start = 100;
          j.tuning.wind.maxChangePerSecond = 0;
        }),
        1,
        new FakeHost(),
      );
      for (const id of ['DA', 'DB']) {
        s.world.datacenters[id]!.jobFrom = 0;
        s.world.datacenters[id]!.jobUntil = 100;
      }
      run(s, 0, 0, true);
      run(s, 1, 1, false);
      run(s, 2, 2, true);
      expect(shortages(s)).toHaveLength(2);
    });
  });

  it('puts the listed consumers first and the unlisted after them, and ignores ids that are not consumers', () => {
    const s = calm(120);
    const order = () => priorityOrder(s.world).map((b) => b.id);
    expect(order()).toEqual(['DA', 'DB']); // no list: the scenario order, and never the plant's board
    s.world.plant.priority = ['DB'];
    expect(order()).toEqual(['DB', 'DA']);
    s.world.plant.priority = ['P', 'ZZ', 'DB']; // the plant's own id passes through set_priority
    expect(order()).toEqual(['DB', 'DA']);
    runPower(s.ctx, 0);
    expect(s.world.plant.shed).toEqual([]);
  });

  it('does not report a destroyed facility as shed', () => {
    const s = calm(0);
    s.world.boards[2]!.status = 'destroyed'; // DB draws nothing
    runPower(s.ctx, 0);
    expect(s.world.plant).toMatchObject({ demand: 15, shed: ['DA'] });
  });

  it('counts power at the wind of the step it runs in, so the series moves first', () => {
    const s = new Session(m1Scenario(), 7, new FakeHost());
    for (let i = 0; i < 100; i++) {
      s.step();
      expect(s.world.plant.generation, `step ${i}`).toBe(s.world.plant.wind);
    }
  });

  it('counts a board that wakes in this step as awake, so the transitions come first', () => {
    const s = calm(120);
    const da = s.world.boards[1]!;
    da.status = 'asleep';
    da.wakeAt = 5;
    for (let i = 0; i < 6; i++) s.step(); // the sixth is step 5, when DA wakes
    expect(da.status).toBe('running');
    expect(s.world.plant.demand).toBe(28); // DA at 10, not at its sleep power of 1
  });

  it("cuts a board's power in the step it would have ticked, so the power phase comes before the ticks", () => {
    const host = new FakeHost();
    const src = host.program('noop', () => ({}));
    const s = new Session(
      m1Scenario((j) => {
        j.tuning.wind.maxChangePerSecond = 0;
      }),
      1,
      host,
    );
    s.deploy('DA', src);
    for (let i = 0; i < 3; i++) s.step(); // DA's first beat is step 3, and until then it is powered
    s.world.plant.wind = 0;
    s.step();
    expect(host.calls).toEqual([]);
  });
});
