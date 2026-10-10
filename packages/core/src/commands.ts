import { z } from 'zod';
import type { FacilityAction } from './firmware-host.ts';
import type { InstallPart } from './session.ts';

// The shapes of a firmware source and of the player's commands, checked at the server's doors (MCP and the viewer's socket) before
// the game sees them. These check what a command is; the game checks what it means (an unknown facility, a truck already out).

/**
 * A firmware source: up to 64 KB, counted in characters (UTF-16 units). A board's Lua state takes the source as a C string, which ends
 * at the first NUL byte: the code after it would vanish without an error, and a syntax error behind it would pass the check.
 */
export const FIRMWARE_SOURCE = z
  .string()
  .max(65_536)
  .refine(
    (source) => !source.includes('\u0000'),
    'the source contains a NUL byte (\\u0000); the board would cut the code off there, so remove it',
  );

/** A facility's id as a command names it: bounded, so that no message carries a huge one. The game refuses an id it does not know. */
const facilityId = z.string().min(1).max(32);

/** A facility action for the player's hand: exactly the shapes of FacilityAction, with bounded numbers. */
export const FACILITY_ACTION: z.ZodType<FacilityAction> = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('process') }),
  z.strictObject({ kind: z.literal('cool') }),
  z.strictObject({ kind: z.literal('setThermal'), output: z.number().int().min(0).max(1_000_000) }),
  z.strictObject({ kind: z.literal('setPriority'), order: z.array(facilityId).max(64) }),
  z.strictObject({ kind: z.literal('harvest') }),
  z.strictObject({
    kind: z.literal('dispatch'),
    truck: z.number().int().min(1).max(64),
    from: facilityId,
    to: facilityId,
    amount: z.number().int().min(1).max(1_000_000),
  }),
]);

/** What the player installs in a facility: a board (T1) or a comm module (T2). */
export const INSTALL_PART: z.ZodType<InstallPart> = z.enum(['board', 'comm']);
