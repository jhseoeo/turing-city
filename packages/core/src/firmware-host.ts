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
  /** Empty when the tick failed. */
  readonly actions: readonly Action[];
  /** io.log lines, kept even when the tick failed. */
  readonly logs: readonly string[];
  readonly error: TickError | null;
  readonly ramUsedBytes: number;
}

/**
 * Runs board firmware. The core calls it only from inside Session.step(), so every
 * call happens at a deterministic point of the schedule.
 */
export interface FirmwareHost {
  boot(info: BootInfo): void;
  tick(boardId: string, input: TickInput): TickOutcome;
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
