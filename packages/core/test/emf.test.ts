import { describe, expect, it } from 'vitest';
import { baseEmission, diffuse, fieldTotal, processingEmission, runEmf, tickEmission } from '../src/emf.ts';
import { type Action, countsAsAction, type TickError, type TickOutcome } from '../src/firmware-host.ts';
import type { Rng } from '../src/rng.ts';
import { Session } from '../src/session.ts';
import { isBeat } from '../src/time.ts';
import { cellIndex, findFacility } from '../src/world.ts';
import { FakeHost } from './helpers/fake-host.ts';
import { m1Scenario, m2Scenario } from './helpers/scenarios.ts';

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

/** Like powered(), but the field neither spreads nor fades, so a cell holds exactly what was emitted into it. */
function dry(host = new FakeHost(), change?: Parameters<typeof m1Scenario>[0]): Session {
  const s = new Session(
    m1Scenario((j) => {
      j.tuning.wind.start = 220;
      j.tuning.wind.maxChangePerSecond = 0;
      j.tuning.emf.diffusionPctPerSecond = 0;
      j.tuning.emf.decayPctPerSecond = 0;
      j.tuning.emf.rumourThreshold = 1_000_000_000; // no raids once Task 12 adds them
      change?.(j);
    }),
    1,
    host,
  );
  s.world.plant.thermalSetting = 300;
  return s;
}

/** The milli-EMF in the cell under a facility; the field is row-major, y * width + x. */
function cellOf(s: Session, id: string): number {
  const f = findFacility(s.world, id)!;
  return s.world.emf[f.y * s.scenario.grid.width + f.x]!;
}

/** The milestone-2 town, which starts with no board, on steady free power; its field neither spreads nor fades, and no raid comes. */
function town(): Session {
  const s = new Session(
    m2Scenario((j) => {
      j.tuning.wind.start = 220;
      j.tuning.wind.maxChangePerSecond = 0;
      j.tuning.thermal.max = 2_000;
      j.tuning.fuelPrice = { start: 0, min: 0, max: 0 };
      j.tuning.emf.diffusionPctPerSecond = 0;
      j.tuning.emf.decayPctPerSecond = 0;
      j.tuning.emf.rumourThreshold = 1_000_000_000;
    }),
    1,
    new FakeHost(),
  );
  s.world.plant.thermalSetting = 2_000;
  return s;
}

function outcomeOf(instructions: number, actions: TickOutcome['actions'] = [], error: TickError | null = null): TickOutcome {
  return { ok: error === null, instructions, actions, logs: [], error, ramUsedBytes: 0 };
}

/** One step of the field written as a gather: a cell keeps its value less what it gave, takes what its neighbours gave, then decays. */
function gatherStep(
  field: readonly number[],
  width: number,
  height: number,
  sharePct: number,
  decayPct: number,
  stepsPerSecond: number,
): number[] {
  const denom = 100 * stepsPerSecond;
  const gives = field.map((v) => Math.floor((v * sharePct) / denom)); // what a cell gives each of its neighbours
  const next: number[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const around: Array<[number, number]> = [
        [x - 1, y],
        [x + 1, y],
        [x, y - 1],
        [x, y + 1],
      ];
      const inside = around.filter(([nx, ny]) => nx >= 0 && nx < width && ny >= 0 && ny < height);
      let v = field[y * width + x]! - inside.length * gives[y * width + x]!;
      for (const [nx, ny] of inside) v += gives[ny * width + nx]!;
      next.push(v - Math.ceil((v * decayPct) / denom));
    }
  }
  return next;
}

describe('EMF', () => {
  it('turns instructions and machine labor into emission', () => {
    const s = powered();
    const outcome = outcomeOf(500, [{ kind: 'process' }, { kind: 'cool' }, { kind: 'sleep', seconds: 5 }]);
    expect(tickEmission(s.ctx, outcome)).toBe(5_000 + 10_000); // 5 EMF of instructions, 10 for cool(); process() and sleep() count none
  });

  it('counts no emission for log lines: io.log is not an action', () => {
    const s = powered();
    expect(tickEmission(s.ctx, { ...outcomeOf(500), logs: ['a', 'b', 'c', 'd'] })).toBe(5_000);
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
      seen = sensors.emf as number | undefined;
      return {};
    });
    const s = powered(host);
    s.deploy('DA', probe);
    for (let i = 0; i < 40; i++) s.step();
    const da = s.world.boards[1]!;
    expect(seen).toBeGreaterThan(0);
    expect(seen).toBeLessThanOrEqual(s.world.emf[cellIndex(s.scenario, da.x, da.y)]! / 1000 + 1);
  });

  it('rounds the instruction part of a tick down to a whole milli-EMF', () => {
    const s = new Session(
      m1Scenario((j) => {
        j.tuning.emf.instructionsPerUnit = 7;
      }),
      1,
      new FakeHost(),
    );
    expect(tickEmission(s.ctx, outcomeOf(10))).toBe(1_428); // 10,000 / 7 = 1,428.6
    expect(tickEmission(s.ctx, outcomeOf(3))).toBe(428); // 3,000 / 7 = 428.6
    expect(tickEmission(s.ctx, outcomeOf(1, [{ kind: 'cool' }]))).toBe(142 + 10_000); // 142.9, and an action is a whole 10 EMF
  });

  it('adds each awake board its datasheet base EMF over a second, split over the steps and rounded down', () => {
    const second = dry();
    for (let i = 0; i < 20; i++) runEmf(second.ctx, []);
    expect([cellOf(second, 'P'), cellOf(second, 'DA'), cellOf(second, 'DB')]).toEqual([20_000, 25_000, 25_000]); // 20, 25 and 25 EMF
    const fast = dry(new FakeHost(), (j) => {
      j.time.stepsPerSecond = 60;
    });
    runEmf(fast.ctx, []);
    expect([cellOf(fast, 'P'), cellOf(fast, 'DA'), cellOf(fast, 'DB')]).toEqual([333, 416, 416]); // 20,000 / 60 = 333.3, 25,000 / 60 = 416.7
  });

  it('adds no base EMF for a board that sleeps, is destroyed, is being rebuilt, or is shed', () => {
    for (const status of ['asleep', 'destroyed', 'rebuilding'] as const) {
      const s = dry();
      s.world.boards[2]!.status = status;
      runEmf(s.ctx, []);
      expect(cellOf(s, 'DB'), `DB while ${status}`).toBe(0);
      expect(cellOf(s, 'DA'), `DA while DB is ${status}`).toBe(1_250);
    }
    const shed = dry();
    shed.world.plant.thermalSetting = 0;
    shed.world.plant.wind = 0; // the wind won't move: maxChangePerSecond is 0
    shed.step(); // the power phase switches both datacenters off; the plant's own board is never shed
    expect([cellOf(shed, 'P'), cellOf(shed, 'DA'), cellOf(shed, 'DB')]).toEqual([1_000, 0, 0]);
  });

  it("adds a tick's emission to the cell of its own board", () => {
    const s = dry();
    const da = s.world.boards[1]!;
    const db = s.world.boards[2]!;
    runEmf(s.ctx, [
      { board: da, outcome: outcomeOf(1_800, [{ kind: 'process' }, { kind: 'cool' }]) },
      { board: db, outcome: outcomeOf(250) },
    ]);
    // base EMF for the step is 1,000, 1,250 and 1,250; DA's tick adds 18 + 10 EMF (for cool(), not process()), and DB's adds 2.5
    expect([cellOf(s, 'P'), cellOf(s, 'DA'), cellOf(s, 'DB')]).toEqual([1_000, 1_250 + 28_000, 1_250 + 2_500]);
    expect(s.world.emf.reduce((a, b) => a + b, 0)).toBe(1_000 + 29_250 + 3_750); // nothing in any other cell
  });

  it('counts a tick that failed for the instructions it ran, a capped one for the whole cap', () => {
    const host = new FakeHost();
    const loop = host.program('loop', () => ({ instructions: 2_000, error: { kind: 'cpu', message: 'CPU limit exceeded' } }));
    const s = dry(host);
    s.deploy('DA', loop);
    const da = s.world.boards[1]!;
    let before = 0;
    while (da.lastTick === null) {
      before = cellOf(s, 'DA');
      s.step();
    }
    expect(da.lastTick.error?.kind).toBe('cpu');
    expect(cellOf(s, 'DA') - before).toBe(1_250 + 20_000); // the step's base EMF, and the cap's 20 EMF
  });

  it('shares first and decays after: shares round down and the decay rounds up', () => {
    const field = new Array<number>(9).fill(0);
    field[4] = 1_999; // the middle of 3 x 3
    diffuse(field, 3, 3, 10, 10, 20);
    // each neighbour gets floor(19,990 / 2,000) = 9; the middle keeps 1,999 - 36 = 1,963 and loses ceil(9.8) = 10; a neighbour loses ceil(0.045) = 1
    expect(field).toEqual([0, 8, 0, 8, 1_953, 8, 0, 8, 0]);
  });

  it('lets a value too small to share fade away, one step at a time', () => {
    const lone = [199]; // a 1 x 1 map has no neighbour, and the decay is ceil(1,990 / 2,000) = 1
    diffuse(lone, 1, 1, 10, 10, 20);
    expect(lone).toEqual([198]);
    for (let n = 0; n < 198; n++) diffuse(lone, 1, 1, 10, 10, 20);
    expect(lone).toEqual([0]);
  });

  it('matches a plain gather model on maps that are not square, at every edge and corner', () => {
    const shapes = [
      [5, 3],
      [3, 5],
      [2, 6],
    ] as const;
    const rates = [
      [20, 10, 20],
      [10, 20, 20],
      [15, 7, 30],
    ] as const; // share and decay percents a second, and steps a second
    for (const [width, height] of shapes) {
      for (const [share, decay, stepsPerSecond] of rates) {
        const field = Array.from({ length: width * height }, (_, i) => 1_000 + ((i * 7_919) % 9_000));
        for (let step = 1; step <= 3; step++) {
          const expected = gatherStep(field, width, height, share, decay, stepsPerSecond);
          diffuse(field, width, height, share, decay, stepsPerSecond);
          expect(field, `${width} x ${height}, ${share}% and ${decay}% at ${stepsPerSecond} steps, step ${step}`).toEqual(expected);
        }
      }
    }
  });

  it("diffuses and decays the field with the scenario's own rates, map size, and step rate", () => {
    for (const [stepsPerSecond, middle, neighbour] of [
      [20, 955_200, 9_950],
      [40, 977_550, 4_987],
    ] as const) {
      const s = dry(new FakeHost(), (j) => {
        j.time.stepsPerSecond = stepsPerSecond;
        j.tuning.emf.diffusionPctPerSecond = 20;
        j.tuning.emf.decayPctPerSecond = 10;
      });
      for (const b of s.world.boards) b.status = 'asleep'; // no base EMF: only the cell set by hand
      const width = s.scenario.grid.width; // the map is 20 x 12
      s.world.emf[6 * width + 10] = 1_000_000;
      runEmf(s.ctx, []);
      const cross: Array<[number, number]> = [
        [10, 6],
        [9, 6],
        [11, 6],
        [10, 5],
        [10, 7],
      ];
      expect(
        cross.map(([x, y]) => s.world.emf[y * width + x]),
        `${stepsPerSecond} steps a second`,
      ).toEqual([middle, neighbour, neighbour, neighbour, neighbour]);
      expect(s.world.emf.reduce((a, b) => a + b, 0)).toBe(middle + 4 * neighbour);
    }
  });

  it('totals the whole field in whole EMF units, rounded down', () => {
    const s = dry();
    expect(fieldTotal(s.world)).toBe(0);
    s.world.emf[0] = 1_000;
    s.world.emf[5] = 2_100;
    s.world.emf[s.world.emf.length - 1] = 2_500;
    expect(fieldTotal(s.world)).toBe(5); // 5,600 milli-EMF
  });

  it('counts the tick of a board that goes to sleep, but neither its sleep() nor its base EMF, in that step', () => {
    const host = new FakeHost();
    const nap = host.program('nap', () => ({ instructions: 1_800, actions: [{ kind: 'sleep', seconds: 5 }] }));
    const s = dry(host);
    s.deploy('DA', nap);
    const da = s.world.boards[1]!;
    let before = 0;
    while (da.lastTick === null) {
      before = cellOf(s, 'DA');
      s.step();
    }
    expect(da.status).toBe('asleep');
    expect(cellOf(s, 'DA') - before).toBe(18_000); // 18 EMF of instructions; sleep() is no labor, and an asleep board has no base EMF
  });

  it('counts the base EMF of a datacenter that burns down in this step, since the fires come after the field', () => {
    const s = dry();
    const sure: Rng = { nextU32: () => 0, int: (lo) => lo, chancePpm: () => true };
    Object.assign(s.ctx.rng, { fire: sure });
    s.world.datacenters.DA!.tempMilli = 140_000;
    s.step();
    expect(s.world.boards[1]!.status).toBe('destroyed');
    expect(cellOf(s, 'DA')).toBe(1_250);
  });

  it('shows the firmware the cell as it stood when its tick began, in EMF units', () => {
    const host = new FakeHost();
    const seen: Array<number | undefined> = [];
    const probe = host.program('probe', (sensors) => {
      seen.push(sensors.emf as number | undefined);
      return {};
    });
    const s = dry(host);
    s.deploy('DA', probe);
    const da = s.world.boards[1]!;
    while (!isBeat(s.world.step, da.period, da.phase)) s.step();
    const at = da.y * s.scenario.grid.width + da.x;
    s.world.emf[at] = 7_500;
    s.world.emf[at - 1] = 4_000; // its neighbours carry other values
    s.world.emf[at + 1] = 3_000;
    s.world.emf[at - s.scenario.grid.width] = 6_000;
    s.world.emf[at + s.scenario.grid.width] = 5_000;
    s.step();
    expect(seen).toEqual([7.5]);
  });

  it('counts machine labor as actions, and neither process() nor sleep()', () => {
    const kinds: Array<Action['kind']> = ['harvest', 'dispatch', 'setThermal', 'setPriority', 'cool', 'process', 'sleep'];
    expect(kinds.map((kind) => countsAsAction(kind))).toEqual([true, true, true, true, true, false, false]);
  });

  it("adds a comm module's base EMF to its board's, every second it runs", () => {
    const s = dry();
    s.world.boards[1]!.comm = true;
    for (let i = 0; i < 20; i++) runEmf(s.ctx, []);
    expect([cellOf(s, 'P'), cellOf(s, 'DA'), cellOf(s, 'DB')]).toEqual([20_000, 30_000, 25_000]); // DA: 25, and the module's 5
    expect(baseEmission(s.ctx, s.world.boards[1]!)).toBe(1_500);
  });

  it('gives off processing EMF on every step a datacenter works, and none while it is shed or wrecked', () => {
    const working = dry();
    working.world.datacenters.DA!.busyFrom = 0;
    working.world.datacenters.DA!.busyUntil = 1_000; // these direct calls stay at the world's step 0, inside the job
    for (let i = 0; i < 20; i++) runEmf(working.ctx, []);
    expect(processingEmission(working.ctx)).toBe(2_500); // 50 a second at 20 steps a second
    expect(cellOf(working, 'DA')).toBe(25_000 + 50_000); // a second of base EMF and a second of processing

    const shed = dry();
    shed.world.datacenters.DA!.busyFrom = 0;
    shed.world.datacenters.DA!.busyUntil = 1_000;
    findFacility(shed.world, 'DA')!.powered = false;
    shed.world.boards[1]!.powered = false;
    runEmf(shed.ctx, []);
    expect(cellOf(shed, 'DA'), 'shed').toBe(0);

    const wrecked = dry();
    wrecked.world.datacenters.DA!.busyFrom = 0;
    wrecked.world.datacenters.DA!.busyUntil = 1_000;
    findFacility(wrecked.world, 'DA')!.condition = 'wrecked';
    wrecked.world.boards[1]!.status = 'destroyed';
    runEmf(wrecked.ctx, []);
    expect(cellOf(wrecked, 'DA'), 'wrecked').toBe(0);
  });

  it('makes noise at a datacenter worked by hand, with no board anywhere in town', () => {
    const s = town();
    expect(s.hand('DA', { kind: 'process' })).toEqual({ ok: true });
    s.step(); // the press applies in step 0: the job covers steps 1 to 10
    for (let i = 0; i < 10; i++) s.step();
    expect(cellOf(s, 'DA')).toBe(10 * 2_500); // half a second of processing EMF
    expect(s.world.emf.reduce((a, b) => a + b, 0)).toBe(25_000); // and nothing anywhere else
  });

  it('stays silent with no board in town and the datacenters idle', () => {
    const s = town();
    for (let i = 0; i < 400; i++) s.step();
    expect(fieldTotal(s.world)).toBe(0);
    expect(s.world.rumour).toBe(0);
  });
});
