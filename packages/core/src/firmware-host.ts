import type { BoardKind, BoardSpec } from './scenario.ts';

/** What a facility can be told to do, by its board's firmware or by the player's hand (10-10 §4.3). */
export type FacilityAction =
  | { readonly kind: 'process' }
  /** One cooling cycle: it has no level. */
  | { readonly kind: 'cool' }
  | { readonly kind: 'setThermal'; readonly output: number }
  | { readonly kind: 'setPriority'; readonly order: readonly string[] }
  | { readonly kind: 'harvest' }
  | { readonly kind: 'dispatch'; readonly truck: number; readonly from: string; readonly to: string; readonly amount: number };

/** What firmware can ask for during one tick: the facility actions, plus sleep. */
export type Action = FacilityAction | { readonly kind: 'sleep'; readonly seconds: number };

/**
 * Takes one action of a board's firmware at the moment it is called, mid-tick: the game applies it at once and answers null, or why
 * it did not take it (then nothing changed). The call returns that to the firmware (the user, 2026-10-17).
 */
export type Act = (action: Action) => string | null;

/** The actions that count toward a board's action EMF, machine labor: all but process and sleep (10-10 §5). */
export function countsAsAction(kind: Action['kind']): boolean {
  return kind !== 'process' && kind !== 'sleep';
}

/** A sensor reading as firmware sees it in io: a number, a string, nil, or a list or record of them. */
export type SensorValue = number | string | undefined | readonly SensorValue[] | { readonly [key: string]: SensorValue };

export type TickErrorKind = 'runtime' | 'cpu' | 'ram' | 'noTick';

export interface TickError {
  readonly kind: TickErrorKind;
  readonly message: string;
}

export interface BootInfo {
  readonly boardId: string;
  readonly kind: BoardKind;
  readonly spec: BoardSpec;
  /** Every facility id in the scenario, in order: firmware names facilities by id. */
  readonly facilityIds: readonly string[];
  readonly seed: number;
}

export interface TickInput {
  /** Sensor values by their Lua name; undefined reads as nil. */
  readonly sensors: Readonly<Record<string, SensorValue>>;
  /** Firmware to install before this tick: a deploy, or the board's image after a reboot. */
  readonly newSource: string | null;
}

export interface TickOutcome {
  readonly ok: boolean;
  /** Instructions counted; equal to the cap when the tick hit it. */
  readonly instructions: number;
  /** The actions the game took, as they were called: a failed tick's too, as far as it got. */
  readonly actions: readonly Action[];
  /** io.log lines, kept even when the tick failed. */
  readonly logs: readonly string[];
  /** How many io.log lines the tick asked for past the limit; the core says so in the board's log. */
  readonly droppedLogs?: number;
  readonly error: TickError | null;
  readonly ramUsedBytes: number;
}

/**
 * Runs board firmware. The core calls it only from inside Session.step(), so every
 * call happens at a deterministic point of the schedule.
 */
export interface FirmwareHost {
  boot(info: BootInfo): void;
  /** Runs one tick; each action it calls goes to `act` at once, and its answer back to the firmware. */
  tick(boardId: string, input: TickInput, act: Act): TickOutcome;
  /** Drops the board's VM: sleep and destruction wipe its RAM. */
  shutdown(boardId: string): void;
  close(): void;
}

/** A host without a firmware runtime: every tick reports that nothing is installed. */
export class NullHost implements FirmwareHost {
  boot(): void {}
  tick(): TickOutcome {
    return {
      ok: false,
      instructions: 0,
      actions: [],
      logs: [],
      error: { kind: 'noTick', message: 'no firmware runtime' },
      ramUsedBytes: 0,
    };
  }
  shutdown(): void {}
  close(): void {}
}
