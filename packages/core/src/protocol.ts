import type { DeployOutcome } from './agent-tools.ts';
import type { FacilityAction } from './firmware-host.ts';
import type { AlertView, BoardInspection, Snapshot, TimeView } from './queries.ts';
import type { Refusal } from './refusal.ts';
import type { Scenario } from './scenario.ts';
import type { DeployedBy, InstallPart } from './session.ts';
import type { AlertKind } from './world.ts';

/** A read the main thread asks the worker for. manual, firmware, and logs are the agent's: they reach a board with a comm module only. */
export type Query =
  | { readonly kind: 'listBoards' }
  | { readonly kind: 'manual'; readonly board: string }
  | { readonly kind: 'firmware'; readonly board: string }
  | { readonly kind: 'logs'; readonly board: string; readonly since: number | null }
  | { readonly kind: 'map' }
  | { readonly kind: 'status' }
  | { readonly kind: 'alerts'; readonly since: number | null }
  | { readonly kind: 'inspect'; readonly board: string };

export type WorkerRequest =
  | { readonly type: 'start'; readonly scenario: unknown; readonly seed: number }
  | { readonly type: 'advance'; readonly steps: number }
  | { readonly type: 'deploy'; readonly id: number; readonly board: string; readonly code: string; readonly by: DeployedBy }
  | { readonly type: 'install'; readonly id: number; readonly facility: string; readonly part: InstallPart }
  | { readonly type: 'repair'; readonly id: number; readonly facility: string }
  | { readonly type: 'rebuild'; readonly id: number; readonly board: string }
  | { readonly type: 'hand'; readonly id: number; readonly facility: string; readonly action: FacilityAction }
  | { readonly type: 'mark'; readonly kind: 'pause' | 'resume' }
  | { readonly type: 'query'; readonly id: number; readonly query: Query };

export type WorkerResponse =
  | { readonly type: 'started'; readonly snapshot: Snapshot }
  | { readonly type: 'advanced'; readonly snapshot: Snapshot; readonly alerts: readonly AlertView[] }
  /**
   * How the world stands after a deploy, an install, a repair, a rebuild, or a hand action changed it between batches, sent ahead of
   * that request's answer. It is not the answer to a batch: it resolves none and disarms no watchdog.
   */
  | { readonly type: 'snapshot'; readonly snapshot: Snapshot }
  | { readonly type: 'reply'; readonly id: number; readonly value: unknown }
  /**
   * The request with this id threw (a deploy to an unknown board, an agent's read of a board with no comm module). Only that request
   * fails; the season goes on. A refusal the viewer can say in Korean carries its code.
   */
  | { readonly type: 'refused'; readonly id: number; readonly message: string; readonly refusal?: Refusal }
  | { readonly type: 'fatal'; readonly message: string };

export type GameState = 'idle' | 'paused' | 'running' | 'ended' | 'crashed';

export interface AgentStatus {
  readonly connected: boolean;
  readonly clientName: string | null;
}

export interface ControllerStatus {
  readonly state: GameState;
  readonly speed: 1 | 2 | 3;
  readonly agent: AgentStatus;
  /** Why the session stopped (the watchdog, or the worker failing), when it did. */
  readonly crash: string | null;
  readonly autoPause: readonly AlertKind[];
  readonly scenarioName: string;
  /**
   * How many seasons were started: 0 before the first, then one more at each start. The viewer starts its per-season state over when
   * it changes.
   */
  readonly season: number;
}

export type ControllerEvent =
  | { readonly kind: 'status'; readonly status: ControllerStatus }
  | { readonly kind: 'snapshot'; readonly snapshot: Snapshot }
  | { readonly kind: 'alerts'; readonly alerts: readonly AlertView[] }
  | { readonly kind: 'deploy'; readonly board: string; readonly version: number; readonly time: TimeView; readonly by: DeployedBy };

/** Server to viewer, over the WebSocket. */
export type ServerToViewer =
  /** The connect command, the port, and the game's scenario: the viewer renders the boards' manuals from it. */
  | { readonly type: 'hello'; readonly connect: string; readonly port: number; readonly scenario: Scenario }
  | { readonly type: 'status'; readonly status: ControllerStatus }
  | { readonly type: 'snapshot'; readonly snapshot: Snapshot }
  | { readonly type: 'alerts'; readonly alerts: readonly AlertView[] }
  | { readonly type: 'deploy'; readonly board: string; readonly version: number; readonly time: TimeView; readonly by: DeployedBy }
  /** The answer to this viewer's deploy: accepted, with when it installs, or the syntax error with its line. */
  | { readonly type: 'deployResult'; readonly board: string; readonly outcome: DeployOutcome }
  | { readonly type: 'inspection'; readonly board: string; readonly inspection: BoardInspection | null }
  /** The English message is for agents and logs; the viewer says the refusal in Korean from its code, when it has one. */
  | { readonly type: 'error'; readonly message: string; readonly refusal?: Refusal };

/**
 * Viewer to server: the player's commands. The server's viewer hub accepts exactly these and refuses anything else, so a
 * new command also goes into its schema (viewer-hub.ts).
 */
export type ViewerToServer =
  | { readonly type: 'startSeason' }
  | { readonly type: 'play' }
  | { readonly type: 'pause' }
  | { readonly type: 'speed'; readonly speed: 1 | 2 | 3 }
  | { readonly type: 'deploy'; readonly board: string; readonly code: string }
  | { readonly type: 'hand'; readonly facility: string; readonly action: FacilityAction }
  | { readonly type: 'install'; readonly facility: string; readonly part: InstallPart }
  | { readonly type: 'repair'; readonly facility: string }
  | { readonly type: 'rebuild'; readonly board: string }
  | { readonly type: 'autoPause'; readonly kinds: readonly AlertKind[] }
  | { readonly type: 'reissueToken' }
  | { readonly type: 'inspect'; readonly board: string };

export type { BoardInspection, DeployOutcome };
