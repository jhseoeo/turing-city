import { describe, expect, it } from 'vitest';
import m1 from '../../../scenarios/m1-power.json' with { type: 'json' };
import { parseScenario, ScenarioError } from '../src/scenario.ts';

/** A deep copy of the milestone-1 scenario to break in one place. */
function m1Copy(): typeof m1 {
  return JSON.parse(JSON.stringify(m1)) as typeof m1;
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
    expect(parseScenario(m1).tuning.shortageAlertQuietSeconds).toBe(10);
    const zero = m1Copy();
    zero.tuning.shortageAlertQuietSeconds = 0;
    expect(parseScenario(zero).tuning.shortageAlertQuietSeconds).toBe(0);
    for (const bad of [-1, 2.5]) {
      const s = m1Copy();
      s.tuning.shortageAlertQuietSeconds = bad;
      expect(problems(s), String(bad)).toContain('tuning.shortageAlertQuietSeconds');
    }
    const missing = m1Copy() as Record<string, unknown>;
    delete (missing.tuning as Record<string, unknown>).shortageAlertQuietSeconds;
    expect(problems(missing)).toContain('tuning.shortageAlertQuietSeconds');
  });

  it('names the path of a missing tuning value', () => {
    const s = m1Copy() as Record<string, unknown>;
    delete (s.tuning as Record<string, unknown>).bankruptcyDays;
    expect(problems(s)).toContain('tuning.bankruptcyDays');
  });
});
