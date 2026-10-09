import type { FirmwareHost } from './firmware-host.ts';
import { idiv, MICRO } from './fixed.ts';
import { stateHash } from './hash.ts';
import type { Scenario } from './scenario.ts';
import { Session } from './session.ts';
import { gameTime, stepsPerDay } from './time.ts';
import type { Ledger, Stats, WorldState } from './world.ts';

export interface SeasonOptions {
  /** Stop at the end of this day instead of the season's. */
  readonly untilDay?: number;
  /** Stand in for the human: rebuild each destroyed board as soon as the money allows. */
  readonly autoRebuild?: boolean;
}

export interface SeasonResult {
  /** null when the run stopped at untilDay before the season ended. */
  readonly ended: WorldState['ended'];
  readonly day: number;
  /** Whole money units. */
  readonly money: number;
  /** Micro-units. */
  readonly ledger: Ledger;
  readonly stats: Stats;
  readonly hash: string;
}

/** Deploys the firmware at step 0 and runs to the end (or to untilDay). Closes the host. */
export function runSeason(
  scenario: Scenario,
  seed: number,
  host: FirmwareHost,
  firmware: Readonly<Record<string, string>>,
  options: SeasonOptions = {},
): SeasonResult {
  const session = new Session(scenario, seed, host);
  try {
    for (const boardId of Object.keys(firmware).sort()) session.deploy(boardId, firmware[boardId]!);
    const stop = options.untilDay === undefined ? Number.POSITIVE_INFINITY : options.untilDay * stepsPerDay(scenario.time);
    const rebuildCost = scenario.tuning.rebuild.cost * MICRO;
    while (!session.world.ended && session.world.step < stop) {
      if (options.autoRebuild) {
        for (const b of session.world.boards) {
          if (b.status === 'destroyed' && session.world.money >= rebuildCost) session.rebuild(b.id);
        }
      }
      session.step();
    }
    const w = session.world;
    return {
      ended: w.ended,
      day: gameTime(scenario.time, Math.max(0, w.step - 1)).day, // the day of the last step run
      money: idiv(w.money, MICRO),
      ledger: { ...w.ledger },
      stats: { ...w.stats },
      hash: stateHash(w),
    };
  } finally {
    session.close();
  }
}
