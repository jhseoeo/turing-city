import { describe, expect, it } from 'vitest';
import { MICRO } from '../src/fixed.ts';
import { runSeason } from '../src/season.ts';
import { FakeHost } from './helpers/fake-host.ts';
import { m1Scenario, m2Scenario } from './helpers/scenarios.ts';

describe('runSeason', () => {
  it('installs and pays for the boards it is told to at step 0, before it deploys the firmware onto them', () => {
    const scenario = m2Scenario();
    const host = new FakeHost();
    // The wind alone cannot power the whole town: the plant's firmware burns fuel, so DA and F1 have the power to tick.
    const firmware = {
      P: host.program('p', () => ({ actions: [{ kind: 'setThermal', output: scenario.tuning.thermal.max }] })),
      DA: host.program('da', () => ({})),
      F1: host.program('f1', () => ({})),
    };
    const result = runSeason(scenario, 1, host, firmware, { install: ['P', 'DA', 'F1'], untilDay: 1 });
    const prices = scenario.tuning.install.boardPrice;
    expect(result.ledger.installs).toBe((prices.power + prices.datacenter + prices.farm) * MICRO);
    expect(result.stats.deploys).toBe(3); // each installed on its board's first tick
  });

  it("installs a board in every facility that takes one with 'all'", () => {
    const scenario = m2Scenario();
    const prices = scenario.tuning.install.boardPrice;
    const result = runSeason(scenario, 1, new FakeHost(), {}, { install: 'all', untilDay: 1 });
    expect(result.ledger.installs).toBe((prices.power + 2 * prices.datacenter + prices.warehouse + 3 * prices.farm) * MICRO);
  });

  it('leaves a board the scenario installed as it is, and refuses firmware for a board that is not installed', () => {
    // The milestone-1 test scenario starts with its three boards installed.
    expect(runSeason(m1Scenario(), 1, new FakeHost(), {}, { install: 'all', untilDay: 1 }).ledger.installs).toBe(0);
    const host = new FakeHost();
    expect(() => runSeason(m2Scenario(), 1, host, { DA: host.program('da', () => ({})) }, { untilDay: 1 })).toThrow();
  });

  it('stands in for the player: repairs every wrecked facility, then rebuilds its board, as the money allows', () => {
    // A town raided early and often, with the money to repair it.
    const raided = m1Scenario((json) => {
      json.startMoney = 100_000;
      json.tuning.emf.rumourThreshold = 5_000;
    });
    const alone = runSeason(raided, 1, new FakeHost(), {}, { untilDay: 10 });
    expect(alone.stats.wrecks).toBeGreaterThan(0);
    expect(alone.ledger.repairs).toBe(0);
    expect(alone.ledger.rebuild).toBe(0);
    const helped = runSeason(raided, 1, new FakeHost(), {}, { untilDay: 10, autoRebuild: true });
    expect(helped.ledger.repairs).toBeGreaterThan(0);
    expect(helped.ledger.rebuild).toBeGreaterThan(0);
  });
});
