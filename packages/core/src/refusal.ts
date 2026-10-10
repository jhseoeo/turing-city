/**
 * Why the server refused a command of the viewer. It travels with the English message, which agents and logs read, so that the viewer
 * can say it in Korean: every code has its text in the viewer (viewer/src/refusals.ts), where a new code is a type error until its
 * text is written. A refusal with no code is shown in a Korean sentence that carries the English one.
 */
export type Refusal =
  | { readonly code: 'noAgent' }
  | { readonly code: 'noSeason' }
  | { readonly code: 'crashed'; readonly reason: string }
  | { readonly code: 'seasonEnded' }
  | { readonly code: 'unknownBoard'; readonly board: string }
  | { readonly code: 'notDestroyed'; readonly board: string }
  | { readonly code: 'tooPoor' }
  | { readonly code: 'badCommand'; readonly detail: string };
