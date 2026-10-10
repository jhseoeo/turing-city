import { describe, expect, it } from 'vitest';
import m1 from '../../../scenarios/m1-power.json' with { type: 'json' };
import m2 from '../../../scenarios/m2-town.json' with { type: 'json' };
import { BOARD_KINDS, parseScenario, ScenarioError, takesBoard } from '../src/scenario.ts';
import { m2Scenario } from './helpers/scenarios.ts';

/** A deep copy of the milestone-1 scenario to break in one place. */
function m1Copy(): typeof m1 {
  return JSON.parse(JSON.stringify(m1)) as typeof m1;
}

/** A deep copy of the town to break in one place. */
function m2Copy(): typeof m2 {
  return JSON.parse(JSON.stringify(m2)) as typeof m2;
}

function problems(input: unknown): string {
  try {
    parseScenario(input);
  } catch (e) {
    expect(e).toBeInstanceOf(ScenarioError);
    return (e as Error).message;
  }
  throw new Error('expected parseScenario to throw');
}

describe('parseScenario', () => {
  it('accepts the milestone-1 scenario', () => {
    const s = parseScenario(m1);
    expect(s.facilities.map((f) => f.id)).toEqual(['P', 'DA', 'DB']);
    expect(s.tuning.datacenter.fireThresholdMilli).toBe(90_000);
  });

  it('rejects duplicate facility ids', () => {
    const s = m1Copy();
    s.facilities[2]!.id = 'DA';
    expect(problems(s)).toContain('facilities.2.id: duplicate facility id DA');
  });

  it('rejects a clock that does not divide the step rate', () => {
    const s = m1Copy();
    s.facilities[1]!.board.clockHz = 3;
    expect(problems(s)).toContain('facilities.1.board.clockHz: clockHz 3 must divide stepsPerSecond 20');
  });

  it('rejects a sensor the facility kind does not offer', () => {
    const s = m1Copy();
    s.facilities[1]!.board.sensors.push('wind');
    expect(problems(s)).toContain('facilities.1.board.sensors.5: a datacenter board has no wind sensor');
  });

  it('rejects a facility outside the grid or on a taken cell', () => {
    const outside = m1Copy();
    outside.facilities[2]!.x = 20;
    expect(problems(outside)).toContain('facilities.2: (20, 8) is outside the 20x12 grid');
    const taken = m1Copy();
    taken.facilities[2]!.x = 5;
    taken.facilities[2]!.y = 4;
    expect(problems(taken)).toContain('facilities.2: two facilities at (5,4)');
  });

  it('requires exactly one power plant', () => {
    const none = m1Copy();
    none.facilities = none.facilities.filter((f) => f.kind !== 'power');
    expect(problems(none)).toContain('facilities: exactly one power plant is required');
  });

  it('rejects an inverted series range or a start outside it, but accepts the edges', () => {
    const inverted = m1Copy();
    inverted.tuning.fuelPrice = { start: 7, min: 9, max: 5 };
    inverted.tuning.jobPrice.min = 80;
    inverted.tuning.jobPrice.max = 15;
    const invertedProblems = problems(inverted);
    expect(invertedProblems).toContain('tuning.fuelPrice: min 9 is above max 5');
    expect(invertedProblems).toContain('tuning.jobPrice: min 80 is above max 15');
    const outside = m1Copy();
    outside.tuning.wind.start = 230;
    outside.tuning.fuelPrice.start = 4;
    outside.tuning.jobPrice.start = 90;
    const outsideProblems = problems(outside);
    expect(outsideProblems).toContain('tuning.wind.start: start 230 is outside the range 0..220');
    expect(outsideProblems).toContain('tuning.fuelPrice.start: start 4 is outside the range 5..9');
    expect(outsideProblems).toContain('tuning.jobPrice.start: start 90 is outside the range 15..80');
    const edges = m1Copy();
    edges.tuning.wind.start = 220;
    edges.tuning.fuelPrice = { start: 7, min: 7, max: 7 };
    edges.tuning.jobPrice.start = 15;
    expect(() => parseScenario(edges)).not.toThrow();
  });

  it('reads the shortage alert quiet time as whole seconds, zero or more', () => {
    expect(parseScenario(m1).tuning.shortageQuietSeconds).toBe(10);
    const zero = m1Copy();
    zero.tuning.shortageQuietSeconds = 0;
    expect(parseScenario(zero).tuning.shortageQuietSeconds).toBe(0);
    for (const bad of [-1, 2.5]) {
      const s = m1Copy();
      s.tuning.shortageQuietSeconds = bad;
      expect(problems(s), String(bad)).toContain('tuning.shortageQuietSeconds');
    }
    const missing = m1Copy() as Record<string, unknown>;
    delete (missing.tuning as Record<string, unknown>).shortageQuietSeconds;
    expect(problems(missing)).toContain('tuning.shortageQuietSeconds');
  });

  it('names the path of a missing tuning value', () => {
    const s = m1Copy() as Record<string, unknown>;
    delete (s.tuning as Record<string, unknown>).bankruptcyDays;
    expect(problems(s)).toContain('tuning.bankruptcyDays');
    for (const group of ['farm', 'warehouse', 'housing', 'install', 'repair']) {
      const t = m1Copy() as Record<string, unknown>;
      delete (t.tuning as Record<string, unknown>)[group];
      expect(problems(t), group).toContain(`tuning.${group}`);
    }
  });
});

describe('the town', () => {
  it('has the nine facilities of the map, every one of them without a board at the start', () => {
    const s = parseScenario(m2);
    expect(s.facilities.map((f) => `${f.id}:${f.kind}`)).toEqual([
      'H1:housing',
      'H2:housing',
      'P:power',
      'DA:datacenter',
      'W:warehouse',
      'DB:datacenter',
      'F1:farm',
      'F2:farm',
      'F3:farm',
    ]);
    expect(s.facilities.filter((f) => f.board === null).map((f) => f.id)).toEqual(['H1', 'H2']);
    expect(s.facilities.some((f) => f.board?.startsInstalled)).toBe(false);
    expect(s.tuning.install.boardPrice).toEqual({ farm: 200, warehouse: 400, power: 400, datacenter: 600 });
    expect(s.tuning.farm).toEqual({ ripenSeconds: 40, rotSeconds: 20, yield: 40, outboxCapacity: 80 });
    expect(s.tuning.housing.startFood).toBe(120);
    expect(s.tuning.datacenter.coolingPower).toBe(250);
    expect(s.tuning.emf.rumourThreshold).toBe(200_000);
    expect(m2Scenario().id).toBe('m2-town');
  });

  it('starts the test scenario with its three boards installed', () => {
    expect(parseScenario(m1).facilities.map((f) => f.board?.startsInstalled)).toEqual([true, true, true]);
  });

  it('takes a board on every kind but housing', () => {
    expect(BOARD_KINDS.filter((k) => takesBoard(k))).toEqual(['power', 'datacenter', 'farm', 'warehouse']);
    expect(takesBoard('housing')).toBe(false);
  });

  it('refuses a board on housing, and a board kind without one', () => {
    const housed = m2Copy();
    Object.assign(housed.facilities[0]!, { board: housed.facilities[6]!.board });
    expect(problems(housed)).toContain('facilities.0.board: a housing takes no board');
    const bare = m2Copy();
    Object.assign(bare.facilities[6]!, { board: null });
    expect(problems(bare)).toContain('facilities.6.board: a farm needs a board');
  });

  it('refuses a sensor a farm or the warehouse does not offer', () => {
    const s = m2Copy();
    s.facilities[6]!.board!.sensors.push('temp');
    s.facilities[4]!.board!.sensors.push('ripeness');
    const text = problems(s);
    expect(text).toContain('facilities.6.board.sensors.2: a farm board has no temp sensor');
    expect(text).toContain('facilities.4.board.sensors.4: a warehouse board has no ripeness sensor');
  });

  it('allows at most one warehouse', () => {
    const s = m2Copy();
    s.facilities.push({ ...s.facilities[4]!, id: 'W2', x: 12, y: 6 });
    expect(problems(s)).toContain('facilities: at most one warehouse is allowed');
  });

  it('needs a press, a cooling cycle, and a truck cell to last whole steps', () => {
    const s = m2Copy();
    s.tuning.datacenter.jobMs = 525; // 10.5 steps at 20 a second
    s.tuning.datacenter.coolingCycleMs = 4010;
    s.tuning.warehouse.truckCellsPerSecond = 3;
    const text = problems(s);
    expect(text).toContain('tuning.datacenter.jobMs: jobMs 525 is not a whole number of steps at 20 steps per second');
    expect(text).toContain('tuning.datacenter.coolingCycleMs: coolingCycleMs 4010 is not a whole number of steps at 20 steps per second');
    expect(text).toContain('tuning.warehouse.truckCellsPerSecond: truckCellsPerSecond 3 must divide stepsPerSecond 20');
  });
});
