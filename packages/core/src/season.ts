import type { FirmwareHost } from './firmware-host.ts';
import { idiv, MICRO } from './fixed.ts';
import { stateHash } from './hash.ts';
import { type Scenario, takesBoard } from './scenario.ts';
import { Session } from './session.ts';
import { gameTime, stepsPerDay } from './time.ts';
import { findBoard, findFacility, type Ledger, type Stats, type WorldState } from './world.ts';

export interface SeasonOptions {
  /** Stop at the end of this day instead of the season's. */
  readonly untilDay?: number;
  /** Stand in for the human: repair each wrecked facility, then rebuild its board, as soon as the money allows. */
  readonly autoRebuild?: boolean;
  /**
   * Boards to install, and pay for, at step 0 before the firmware is deployed: every facility that takes one ('all'), or these ids.
   * Firmware runs only on an installed board. A board the scenario installed already is left as it is.
   */
  readonly install?: 'all' | readonly string[];
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

/** The player of a headless season: repairs what is wrecked, then rebuilds its board, each as soon as the money allows. */
export function standInForThePlayer(session: Session): void {
  const w = session.world;
  const t = session.scenario.tuning;
  for (const f of w.facilities) {
    if (f.condition === 'wrecked' && takesBoard(f.kind) && w.money >= t.repair.cost[f.kind] * MICRO) session.repair(f.id);
  }
  for (const b of w.boards) {
    const standing = findFacility(w, b.id)?.condition === 'ok';
    if (b.status === 'destroyed' && standing && w.money >= t.rebuild.cost * MICRO) session.rebuild(b.id);
  }
}

/** Installs the boards, deploys the firmware at step 0, and runs to the end (or to untilDay). Closes the host. */
export function runSeason(
  scenario: Scenario,
  seed: number,
  host: FirmwareHost,
  firmware: Readonly<Record<string, string>>,
  options: SeasonOptions = {},
): SeasonResult {
  const session = new Session(scenario, seed, host);
  try {
    const install =
      options.install === 'all' ? scenario.facilities.filter((f) => f.board !== null).map((f) => f.id) : (options.install ?? []);
    for (const id of install) {
      if (findBoard(session.world, id)) continue;
      const result = session.install(id, 'board');
      if (!result.ok) throw new Error(`cannot install a board in ${id}: ${result.reason}`);
    }
    for (const boardId of Object.keys(firmware).sort()) session.deploy(boardId, firmware[boardId]!);
    const stop = options.untilDay === undefined ? Number.POSITIVE_INFINITY : options.untilDay * stepsPerDay(scenario.time);
    while (!session.world.ended && session.world.step < stop) {
      if (options.autoRebuild) standInForThePlayer(session);
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
