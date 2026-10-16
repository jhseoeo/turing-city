/**
 * Why the server refused a command of the viewer. It travels with the English message, which agents and logs read, so that the viewer
 * can say it in Korean: every code has its text in the viewer (viewer/src/refusals.ts), where a new code is a type error until its
 * text is written. A refusal with no code is shown in a Korean sentence that carries the English one.
 */
export type Refusal =
  | { readonly code: 'noSeason' }
  | { readonly code: 'crashed'; readonly reason: string }
  | { readonly code: 'seasonEnded' }
  | { readonly code: 'unknownBoard'; readonly board: string }
  | { readonly code: 'notDestroyed'; readonly board: string }
  | { readonly code: 'tooPoor' }
  | { readonly code: 'badCommand'; readonly detail: string }
  | { readonly code: 'unknownFacility'; readonly facility: string }
  /** A board command to a facility without one. */
  | { readonly code: 'noBoard'; readonly facility: string }
  /** An install on a facility that takes no board (housing). */
  | { readonly code: 'takesNoBoard'; readonly facility: string }
  | { readonly code: 'alreadyInstalled'; readonly facility: string; readonly part: 'board' | 'comm' }
  /** A comm module for a board that is destroyed or being rebuilt. */
  | { readonly code: 'boardDown'; readonly facility: string }
  /** The facility is wrecked or being repaired. */
  | { readonly code: 'wrecked'; readonly facility: string }
  | { readonly code: 'notWrecked'; readonly facility: string }
  /** A repair of a facility whose repair is already under way. */
  | { readonly code: 'alreadyRepairing'; readonly facility: string }
  /** A board's rebuild before its facility is repaired. */
  | { readonly code: 'repairFirst'; readonly facility: string }
  /** An agent's board tool on a board below T2. */
  | { readonly code: 'noComm'; readonly board: string }
  /** A hand action that cannot apply now. */
  | { readonly code: 'cannotAct'; readonly facility: string; readonly detail: string };
