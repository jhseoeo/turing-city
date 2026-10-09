import type { BoardSpec, FacilityKind } from './scenario.ts';

/** An action a board's firmware asked for during one tick. */
export type Action =
  | { readonly kind: 'process' }
  | { readonly kind: 'cool'; readonly level: number }
  | { readonly kind: 'setThermal'; readonly output: number }
  | { readonly kind: 'setPriority'; readonly order: readonly string[] }
  | { readonly kind: 'sleep'; readonly seconds: number };

export type TickErrorKind = 'runtime' | 'cpu' | 'ram' | 'noTick';

export interface TickError {
  readonly kind: TickErrorKind;
  readonly message: string;
}

export interface BootInfo {
  readonly boardId: string;
  readonly kind: FacilityKind;
  readonly spec: BoardSpec;
  /** Every facility id in the scenario, in order: firmware names facilities by id. */
  readonly facilityIds: readonly string[];
  readonly seed: number;
}

export interface TickInput {
  /** Sensor values by their Lua name; undefined reads as nil. */
  readonly sensors: Readonly<Record<string, number | undefined>>;
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
