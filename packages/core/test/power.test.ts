import { describe, expect, it } from 'vitest';
import { facilityDemand, plantBoard, priorityOrder, runPower } from '../src/power.ts';
import { Session } from '../src/session.ts';
import { FakeHost } from './helpers/fake-host.ts';
import { m1Scenario } from './helpers/scenarios.ts';

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
    const s = new Session(m1Scenario(), 99, new FakeHost());
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
      s.world.datacenters[id]!.jobUntil = 10;
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
    runPower(s.ctx, 3);
    expect(shortages()).toHaveLength(2);
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
