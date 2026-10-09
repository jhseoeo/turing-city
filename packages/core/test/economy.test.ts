import { describe, expect, it } from 'vitest';
import { destroyBoard } from '../src/boards.ts';
import type { Action } from '../src/firmware-host.ts';
import { MICRO } from '../src/fixed.ts';
import { stateHash } from '../src/hash.ts';
import { replay, Session } from '../src/session.ts';
import { cellIndex } from '../src/world.ts';
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

/** What a thermal setting of 100 costs a step at a fuel price of 7: 100 * 7 over a day's 800 steps, in micro-units. */
const FUEL_PER_STEP = 875_000;

/** A calm session whose plant firmware does `action` at its first beat (step 0), after the thermal setting stood at `setting`. */
function plantDoing(action: Action, setting: number): Session {
  const host = new FakeHost();
  host.program('plant', () => ({ actions: [action] }));
  const s = calm(host);
  s.world.plant.thermalSetting = setting;
  s.deploy('P', 'plant');
  return s;
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

  it("burns no fuel while the plant's board sleeps or is being rebuilt", () => {
    for (const status of ['asleep', 'rebuilding'] as const) {
      const s = calm();
      s.world.plant.thermalSetting = 100;
      s.world.boards[0]!.status = status;
      steps(s, 40);
      expect(s.world.ledger.fuel, status).toBe(0);
    }
  });

  // The thermal module is paid for what the power phase (phase 3) made, which is not always what the plant is by the end of the
  // step: its firmware acts in phase 5 and Luddites smash in phase 8. Each case is the step of such a change.
  it("charges nothing for the step in which the plant's firmware raises the thermal setting: the power phase ran before it", () => {
    const s = plantDoing({ kind: 'setThermal', output: 100 }, 0);
    s.step();
    expect(s.world.plant.thermalSetting).toBe(100);
    expect(s.world.ledger.fuel).toBe(0);
    s.step();
    expect(s.world.ledger.fuel).toBe(FUEL_PER_STEP);
  });

  it("still charges the step in which the plant's firmware lowers the thermal setting: the power phase made the output", () => {
    const s = plantDoing({ kind: 'setThermal', output: 0 }, 100);
    s.step();
    expect(s.world.plant.thermalSetting).toBe(0);
    expect(s.world.ledger.fuel).toBe(FUEL_PER_STEP);
    steps(s, 5);
    expect(s.world.ledger.fuel).toBe(FUEL_PER_STEP);
  });

  it("still charges the step in which the plant's firmware puts its board to sleep", () => {
    const s = plantDoing({ kind: 'sleep', seconds: 1 }, 100);
    s.step();
    expect(s.world.boards[0]!.status).toBe('asleep');
    expect(s.world.ledger.fuel).toBe(FUEL_PER_STEP);
    steps(s, 5);
    expect(s.world.ledger.fuel).toBe(FUEL_PER_STEP);
  });

  it("still charges the step in which Luddites smash the plant's board", () => {
    const s = calm();
    const plant = s.world.boards[0]!;
    s.world.plant.thermalSetting = 100;
    // A group stands next to the plant, whose cell is the loudest, and step 0 is a Luddite beat.
    s.world.luddites.push({
      id: s.world.nextLudditeId++,
      x: plant.x - 1,
      y: plant.y,
      size: 3,
      targetId: null,
      quietSince: null,
      leaving: false,
      warned: [],
    });
    s.world.emf[cellIndex(s.scenario, plant.x, plant.y)] = 100_000;
    s.step();
    expect(plant.status).toBe('destroyed');
    expect(s.world.ledger.fuel).toBe(FUEL_PER_STEP);
    steps(s, 5);
    expect(s.world.ledger.fuel).toBe(FUEL_PER_STEP);
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

  it('brings a rebuilt datacenter back as new hardware: ambient temperature, no cooling, and no fire roll', () => {
    const s = calm(new FakeHost(), (j) => {
      // Below the file's 25,000: the temperature phase lifts anything under ambient back up, so only a lower ambient shows where the reset read it.
      j.tuning.datacenter.ambientMilli = 20_000;
    });
    const da = s.world.boards[1]!;
    const wreck = s.world.datacenters.DA!;
    const other = s.world.datacenters.DB!;
    wreck.tempMilli = 140_000; // far above 122 °C: after the rebuild's 400 steps of leaking heat it is still above 90 °C
    wreck.cooling = 3;
    other.tempMilli = 80_000;
    destroyBoard(s.ctx, da, 0, 'fire');
    expect(s.rebuild('DA')).toEqual({ ok: true });
    Object.assign(s.ctx.rng, { fire: { nextU32: () => 0, int: (lo: number) => lo, chancePpm: () => true } }); // any fire roll burns the board
    steps(s, 401); // the board is back at step 400
    expect(wreck.tempMilli).toBe(20_000);
    expect(wreck.cooling).toBe(0);
    expect(da.status).toBe('running');
    steps(s, 5);
    expect(da.status).toBe('running');
    expect(s.world.alerts.some((a) => a.kind === 'fire')).toBe(false);
    expect(other.tempMilli).toBeGreaterThan(20_000); // only the rebuilt board starts over
  });

  it('rebuilds the power plant too, which has no datacenter state to reset', () => {
    const s = calm();
    const plant = s.world.boards[0]!;
    destroyBoard(s.ctx, plant, 0, 'luddites');
    expect(s.rebuild('P')).toEqual({ ok: true });
    steps(s, 401);
    expect(plant.status).toBe('running');
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

  it('applies a recorded rebuild when it replays a session', () => {
    const makeHost = (): FakeHost => {
      const host = new FakeHost();
      host.program('burn', () => ({ actions: [{ kind: 'process' }] }));
      return host;
    };
    // The world has to destroy the board, since a replay applies only recorded inputs: a board that heats 20 °C a step burns
    // for certain above 90 °C, so DA under a firmware that never stops processing burns at step 7.
    const live = calm(makeHost(), (j) => {
      j.tuning.datacenter.heatMilliPerSecond = 400_000;
      j.tuning.datacenter.firePermillePerDegreePerSecond = 1_000_000;
    });
    live.deploy('DA', 'burn');
    steps(live, 40);
    expect(live.world.boards[1]!.status).toBe('destroyed');
    expect(live.rebuild('DA')).toEqual({ ok: true });
    steps(live, 440); // back at step 440 with its last firmware, which burns it again
    expect(live.world.stats.boardsLost).toBe(2);
    expect(live.record.inputs.map((i) => [i.step, i.kind])).toEqual([
      [0, 'deploy'],
      [40, 'rebuild'],
    ]);

    const again = replay(live.scenario, live.seed, live.record, makeHost(), live.world.step);
    expect(stateHash(again.world)).toBe(stateHash(live.world));
    expect(again.record.inputs).toEqual(live.record.inputs);
    // The hash has to tell the two apart, or the equality above proves nothing.
    const withoutRebuild = { ...live.record, inputs: live.record.inputs.filter((i) => i.kind !== 'rebuild') };
    const skipped = replay(live.scenario, live.seed, withoutRebuild, makeHost(), live.world.step);
    expect(skipped.world.boards[1]!.status).toBe('destroyed');
    expect(stateHash(skipped.world)).not.toBe(stateHash(live.world));
  });

  // The rules below are the ones the titles of the first tests name but their numbers (m1's own 10, 7, 500, 3 days) cannot
  // tell from a value hard-coded to match, or that a board's state in them never exercises.

  it('charges upkeep at the scenario rate for a board that runs or sleeps, and none for one destroyed or being rebuilt', () => {
    const s = calm(new FakeHost(), (j) => {
      j.tuning.boardUpkeepPerDay = 25;
    });
    s.world.boards[0]!.status = 'asleep';
    s.world.boards[1]!.status = 'destroyed';
    s.world.boards[2]!.status = 'rebuilding';
    steps(s, DAY);
    expect(s.world.ledger.upkeep).toBe(25 * MICRO);
  });

  it("spreads fuel and upkeep over the scenario's day, a step at a time, rounded down, and pays both out of the money", () => {
    const s = calm(new FakeHost(), (j) => {
      j.time.secondsPerDay = 21; // 420 steps a day, which neither 100 * 7 million nor 30 million divides
    });
    s.world.plant.thermalSetting = 100;
    steps(s, 420);
    const fuel = 420 * 1_666_666; // 700 million / 420 = 1,666,666.67 a step
    const upkeep = 420 * 71_428; // 30 million / 420 = 71,428.57 a step
    expect(s.world.ledger.fuel).toBe(fuel);
    expect(s.world.ledger.upkeep).toBe(upkeep);
    expect(s.world.money).toBe(5000 * MICRO - fuel - upkeep);
  });

  it("charges fuel at the day's price, not at the price the season started with", () => {
    const s = calm();
    s.world.plant.thermalSetting = 100;
    s.world.plant.fuelPrice = 9; // the file's start price is 7, and the series redraws only at the end of the day
    steps(s, DAY);
    expect(s.world.ledger.fuel).toBe(900 * MICRO);
  });

  it("goes bankrupt after the scenario's days below zero, in the scenario's day length, and says so", () => {
    const s = calm(new FakeHost(), (j) => {
      j.time.secondsPerDay = 10; // 200 steps a day
      j.tuning.bankruptcyDays = 2;
    });
    s.world.money = -1;
    steps(s, 2 * 200 - 1);
    expect(s.world.ended).toBeNull();
    s.step();
    expect(s.world.ended).toEqual({ kind: 'bankrupt', step: 399 });
    expect(s.world.alerts.at(-1)).toMatchObject({ kind: 'seasonEnd', facilityId: null, message: '파산했어요' });
    expect(s.world.alerts.find((a) => a.kind === 'moneyBelowZero')).toMatchObject({
      step: 0,
      facilityId: null,
      message: '자금이 바닥났어요',
    });
  });

  it("treats exactly zero as not below zero, and judges the money after the step's own charges", () => {
    const upkeepStep = 37_500; // 30 a day over 800 steps, in micro-units
    const exact = calm();
    exact.world.money = upkeepStep; // this step's upkeep takes it to exactly zero
    exact.step();
    expect(exact.world.money).toBe(0);
    expect(exact.world.belowZeroSince).toBeNull();
    expect(exact.world.alerts.some((a) => a.kind === 'moneyBelowZero')).toBe(false);
    const under = calm();
    under.world.money = upkeepStep - 1; // and a micro-unit less takes it below zero in this very step
    under.step();
    expect(under.world.belowZeroSince).toBe(0);
    expect(under.world.alerts.filter((a) => a.kind === 'moneyBelowZero')).toHaveLength(1);
  });

  it('counts a board being rebuilt as lost when the town falls, and a board asleep as still standing', () => {
    const lost = calm();
    lost.world.boards[0]!.status = 'destroyed';
    lost.world.boards[1]!.status = 'rebuilding';
    lost.world.boards[2]!.status = 'destroyed';
    lost.step();
    expect(lost.world.ended?.kind).toBe('fallen');
    const standing = calm();
    standing.world.boards[0]!.status = 'destroyed';
    standing.world.boards[1]!.status = 'destroyed';
    standing.world.boards[2]!.status = 'asleep';
    standing.step();
    expect(standing.world.ended).toBeNull();
  });

  it('ends the season as bankrupt, not fallen, when both are true on the same step', () => {
    const s = calm();
    for (const b of s.world.boards) b.status = 'destroyed';
    s.world.money = -1;
    s.world.belowZeroSince = -(3 * DAY - 1); // the third day below zero ends with this step
    s.step();
    expect(s.world.ended).toEqual({ kind: 'bankrupt', step: 0 });
  });

  it('ends the season as fallen, not completed, when the last board goes on the last step', () => {
    const s = calm(new FakeHost(), (j) => {
      j.time.secondsPerDay = 1;
      j.time.seasonDays = 1; // 20 steps
    });
    steps(s, 19);
    for (const b of s.world.boards) b.status = 'destroyed';
    s.step();
    expect(s.world.ended).toEqual({ kind: 'fallen', step: 19 });
    expect(s.world.alerts.at(-1)).toMatchObject({ kind: 'seasonEnd', message: '마을이 함락됐어요' });
  });

  it('ends a season that nothing ruins as completed, and says so', () => {
    const s = calm(new FakeHost(), (j) => {
      j.time.secondsPerDay = 1;
      j.time.seasonDays = 1;
    });
    steps(s, 20);
    expect(s.world.ended).toEqual({ kind: 'completed', step: 19 });
    expect(s.world.alerts.at(-1)).toMatchObject({ kind: 'seasonEnd', facilityId: null, message: '시즌이 끝났어요' });
  });

  it('rebuilds only a destroyed board, and a refusal costs nothing and is not recorded', () => {
    const s = calm();
    s.world.boards[1]!.status = 'rebuilding';
    s.world.boards[2]!.status = 'asleep';
    for (const id of ['P', 'DA', 'DB']) expect(s.rebuild(id), id).toEqual({ ok: false, reason: `${id} is not destroyed` });
    expect(s.rebuild('ZZ')).toEqual({ ok: false, reason: 'unknown board ZZ' });
    s.world.boards[0]!.status = 'destroyed';
    s.world.money = 100 * MICRO;
    expect(s.rebuild('P')).toEqual({ ok: false, reason: 'not enough money' });
    expect(s.world.money).toBe(100 * MICRO);
    expect(s.world.ledger.rebuild).toBe(0);
    expect(s.world.boards[0]!.status).toBe('destroyed');
    expect(s.record.inputs).toEqual([]);
  });

  it('refuses a rebuild once the season has ended, however it ended, and charges and records nothing', () => {
    // Money is the score, and a replay stops where the season ended, so a rebuild after it would change one and could not be replayed.
    const endings: Record<string, (s: Session) => void> = {
      completed: (s) => steps(s, 20),
      fallen: (s) => {
        for (const b of s.world.boards) b.status = 'destroyed';
        s.step();
      },
      bankrupt: (s) => {
        s.world.money = -1;
        steps(s, 20);
      },
    };
    for (const [kind, end] of Object.entries(endings)) {
      const s = calm(new FakeHost(), (j) => {
        j.time.secondsPerDay = 1;
        j.time.seasonDays = 1; // 20 steps
        j.tuning.bankruptcyDays = 1;
      });
      s.world.boards[2]!.status = 'destroyed'; // a board that could be rebuilt, were the season still on
      end(s);
      expect(s.world.ended?.kind, kind).toBe(kind);
      const money = s.world.money;
      expect(s.rebuild('DB'), kind).toEqual({ ok: false, reason: 'the season has ended' });
      expect(s.world.money, kind).toBe(money);
      expect(s.world.ledger.rebuild, kind).toBe(0);
      expect(s.world.boards[2]!.status, kind).toBe('destroyed');
      expect(s.record.inputs, kind).toEqual([]);
    }
  });

  it("rebuilds for exactly the scenario's cost and time, with no money to spare, and books it", () => {
    const s = calm(new FakeHost(), (j) => {
      j.tuning.rebuild = { cost: 200, seconds: 10 };
    });
    s.world.boards[2]!.status = 'destroyed';
    s.world.money = 200 * MICRO - 1;
    expect(s.rebuild('DB')).toEqual({ ok: false, reason: 'not enough money' });
    s.world.money = 200 * MICRO;
    expect(s.rebuild('DB')).toEqual({ ok: true });
    expect(s.world.money).toBe(0);
    expect(s.world.ledger.rebuild).toBe(200 * MICRO);
    expect(s.world.boards[2]!.readyAt).toBe(200); // 10 s at 20 steps a second, from step 0
  });
});
