import { describe, expect, it } from 'vitest';
import { MICRO } from '../src/fixed.ts';
import { runSeason } from '../src/season.ts';
import { FakeHost } from './helpers/fake-host.ts';
import { m1Scenario, m2Scenario } from './helpers/scenarios.ts';

describe('runSeason', () => {
  it('installs and pays for the boards it is told to at step 0, before it deploys the firmware onto them', () => {
    // A full wind: with the thermal module off, the wind of 120 carries only H1, and the grid sheds DA and F1, whose boards then
    // never tick.
    const scenario = m2Scenario((json) => {
      json.tuning.wind.start = 220;
    });
    const host = new FakeHost();
    const firmware = { DA: host.program('da', () => ({})), F1: host.program('f1', () => ({})) };
    const result = runSeason(scenario, 1, host, firmware, { install: ['DA', 'F1'], untilDay: 1 });
    const prices = scenario.tuning.install.boardPrice;
    expect(result.ledger.installs).toBe((prices.datacenter + prices.farm) * MICRO);
    expect(result.stats.deploys).toBe(2); // both installed on their boards' first tick
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

  it('pays only for the boards the scenario did not install, and goes on past the ones it did', () => {
    // DA starts installed, in the middle of the list: stopping at it, or refusing it, would leave the boards after it bare.
    const scenario = m2Scenario((json) => {
      Object.assign(json.facilities.find((f) => f.id === 'DA')!.board!, { startsInstalled: true });
    });
    const prices = scenario.tuning.install.boardPrice;
    const all = runSeason(scenario, 1, new FakeHost(), {}, { install: 'all', untilDay: 1 });
    // Everything but DA's board: P, DB, W, and the three farms.
    expect(all.ledger.installs).toBe((prices.power + prices.datacenter + prices.warehouse + 3 * prices.farm) * MICRO);
    const listed = runSeason(scenario, 1, new FakeHost(), {}, { install: ['DA', 'P'], untilDay: 1 });
    expect(listed.ledger.installs).toBe(prices.power * MICRO);
  });

  it('refuses to start a season whose boards it cannot install, and says which and why', () => {
    const install =
      (ids: string[], startMoney = 5000) =>
      () => {
        const scenario = m2Scenario((json) => {
          json.startMoney = startMoney;
        });
        runSeason(scenario, 1, new FakeHost(), {}, { install: ids, untilDay: 1 });
      };
    const price = m2Scenario().tuning.install.boardPrice.datacenter;
    expect(install(['ZZ'])).toThrow('cannot install a board in ZZ: unknown facility ZZ');
    expect(install(['H1'])).toThrow('cannot install a board in H1: H1 takes no board');
    expect(install(['DA'], price - 1)).toThrow('cannot install a board in DA: not enough money');
    expect(install(['DA'], price)).not.toThrow(); // the last unit of money buys it
  });

  it("buys the boards of 'all' in the scenario's order, and names the first it cannot pay for", () => {
    const prices = m2Scenario().tuning.install.boardPrice;
    const money = prices.power + prices.datacenter; // P and DA come first in the town, and then there is nothing left for W
    const scenario = m2Scenario((json) => {
      json.startMoney = money;
    });
    expect(() => runSeason(scenario, 1, new FakeHost(), {}, { install: 'all', untilDay: 1 })).toThrow(
      'cannot install a board in W: not enough money',
    );
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
