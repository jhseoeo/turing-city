import m1 from '../../../../scenarios/m1-power.json' with { type: 'json' };
import { parseScenario, type Scenario } from '../../src/scenario.ts';

/** The milestone-1 scenario, optionally changed by a callback on a deep copy of its JSON. */
export function m1Scenario(change?: (json: typeof m1) => void): Scenario {
  const json = JSON.parse(JSON.stringify(m1)) as typeof m1;
  change?.(json);
  return parseScenario(json);
}
