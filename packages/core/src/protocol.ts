import type { DeployOutcome } from './agent-tools.ts';
import type { AlertView, BoardInspection, Snapshot, TimeView } from './queries.ts';
import type { AlertKind } from './world.ts';

/** A read the main thread asks the worker for. */
export type Query =
  | { readonly kind: 'listBoards' }
  | { readonly kind: 'datasheet'; readonly board: string }
  | { readonly kind: 'firmware'; readonly board: string }
  | { readonly kind: 'logs'; readonly board: string; readonly since: number | null }
  | { readonly kind: 'map' }
  | { readonly kind: 'status' }
  | { readonly kind: 'alerts'; readonly since: number | null }
  | { readonly kind: 'inspect'; readonly board: string };

export type WorkerRequest =
  | { readonly type: 'start'; readonly scenario: unknown; readonly seed: number }
  | { readonly type: 'advance'; readonly steps: number }
  | { readonly type: 'deploy'; readonly id: number; readonly board: string; readonly code: string }
  | { readonly type: 'rebuild'; readonly id: number; readonly board: string }
  | { readonly type: 'mark'; readonly kind: 'pause' | 'resume' }
  | { readonly type: 'query'; readonly id: number; readonly query: Query };

export type WorkerResponse =
  | { readonly type: 'started'; readonly snapshot: Snapshot }
  | { readonly type: 'advanced'; readonly snapshot: Snapshot; readonly alerts: readonly AlertView[] }
  | { readonly type: 'reply'; readonly id: number; readonly value: unknown }
  /** The request with this id threw (a deploy to an unknown board, say). Only that request fails; the season goes on. */
  | { readonly type: 'refused'; readonly id: number; readonly message: string }
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
  /** Play is refused because no agent is connected. */
  readonly blockedByAgent: boolean;
  /** Why the session stopped (the watchdog, or the worker failing), when it did. */
  readonly crash: string | null;
  readonly autoPause: readonly AlertKind[];
  readonly scenarioName: string;
}

export type ControllerEvent =
  | { readonly kind: 'status'; readonly status: ControllerStatus }
  | { readonly kind: 'snapshot'; readonly snapshot: Snapshot }
  | { readonly kind: 'alerts'; readonly alerts: readonly AlertView[] }
  | { readonly kind: 'deploy'; readonly board: string; readonly version: number; readonly time: TimeView };

/** Server to viewer, over the WebSocket. */
export type ServerToViewer =
  | { readonly type: 'hello'; readonly connect: string; readonly port: number }
  | { readonly type: 'status'; readonly status: ControllerStatus }
  | { readonly type: 'snapshot'; readonly snapshot: Snapshot }
  | { readonly type: 'alerts'; readonly alerts: readonly AlertView[] }
  | { readonly type: 'deploy'; readonly board: string; readonly version: number; readonly time: TimeView }
  | { readonly type: 'inspection'; readonly board: string; readonly inspection: BoardInspection | null }
  | { readonly type: 'error'; readonly message: string };

/** Viewer to server: the player's commands. */
export type ViewerToServer =
  | { readonly type: 'startSeason' }
  | { readonly type: 'play' }
  | { readonly type: 'pause' }
  | { readonly type: 'speed'; readonly speed: 1 | 2 | 3 }
  | { readonly type: 'rebuild'; readonly board: string }
  | { readonly type: 'autoPause'; readonly kinds: readonly AlertKind[] }
  | { readonly type: 'reissueToken' }
  | { readonly type: 'inspect'; readonly board: string };

export type { BoardInspection, DeployOutcome };
