import type {
  AlertView,
  BoardInspection,
  ControllerStatus,
  DeployedBy,
  DeployOutcome,
  Scenario,
  ServerToViewer,
  Snapshot,
  TimeView,
} from '@turing-city/core';
import { refusalText } from './refusals.ts';

export type FeedItem =
  | { readonly kind: 'alert'; readonly alert: AlertView }
  | { readonly kind: 'deploy'; readonly board: string; readonly version: number; readonly time: TimeView; readonly by: DeployedBy };

const FEED_LIMIT = 50;

/** How long the screen tells the player that the server refused a command. */
export const ERROR_SHOWN_MS = 5000;

/** Where the guide card's "다시 보지 않기" is kept. A per-browser convenience: a lost or blocked storage only shows the card again. */
export const GUIDE_DISMISSED_KEY = 'turing-city:guide-dismissed';

/** The part of localStorage the store uses; tests pass their own. */
export interface KeyValue {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** The page's localStorage, or null where there is none or it cannot be reached (Node, a blocked or private storage). */
export function browserStorage(): KeyValue | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** A trip the truck form can send: collect from a farm's outbox, or deliver to a housing block. */
export interface DispatchTrip {
  readonly kind: 'collect' | 'deliver';
  readonly target: string;
}

/** What the warehouse's truck form has picked so far. */
export interface DispatchDraft {
  readonly truck: number | null;
  readonly trip: DispatchTrip | null;
  readonly amount: number | null;
}

const NO_DRAFT: DispatchDraft = { truck: null, trip: null, amount: null };

/** What the screens read; every change notifies the subscribers. */
export class Store {
  hello: { connect: string; port: number } | null = null;
  /** The scenario the server plays, from hello: the manual and the truck form read their numbers from it. */
  scenario: Scenario | null = null;
  status: ControllerStatus | null = null;
  snapshot: Snapshot | null = null;
  feed: FeedItem[] = [];
  inspection: { board: string; inspection: BoardInspection | null } | null = null;
  error: string | null = null;
  socketOpen = false;
  selected: string | null = null;
  heatmap = false;
  guideOpen = false;
  /** What the manual window shows: a board slot's id, the index, or nothing (closed). */
  manualFor: string | 'index' | null = null;
  /** The board whose firmware the editor window edits, or null (closed). */
  editorFor: string | null = null;
  /** The server's answer to the editor's last deploy. */
  deployResult: { board: string; outcome: DeployOutcome } | null = null;
  /** The text an editor held when it was closed without a deploy, by board: reopening it brings the text back. */
  editorDrafts: Record<string, string> = {};
  dispatchDraft: DispatchDraft = NO_DRAFT;
  private readonly storage: KeyValue | null;
  /** The season counter of the last status: when it changes, a new season has started. Null until the first status. */
  private seasonSeen: number | null = null;
  private readonly listeners = new Set<() => void>();
  private errorTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(storage: KeyValue | null = browserStorage()) {
    this.storage = storage;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  apply(message: ServerToViewer): void {
    switch (message.type) {
      case 'hello':
        this.hello = { connect: message.connect, port: message.port };
        this.scenario = message.scenario;
        break;
      case 'status':
        this.status = message.status;
        // The server counts seasons (D3). A page that has seen one and now sees another is at a new season's start, whatever the snapshot's
        // step did; the snapshot case below catches the same start from the other side, and starting twice is harmless.
        if (this.seasonSeen !== null && message.status.season !== this.seasonSeen) {
          this.feed = [];
          this.seasonStarted();
        }
        this.seasonSeen = message.status.season;
        if (message.status.state === 'paused' || message.status.state === 'running') this.error = null;
        break;
      case 'snapshot': {
        const previous = this.snapshot;
        if (previous && message.snapshot.step < previous.step) this.feed = []; // a new season
        this.snapshot = message.snapshot;
        // A season starting: at its first step, seen fresh or after a later one. A page that joins a season in the middle sees no start.
        if (message.snapshot.step === 0 && (previous === null || previous.step > 0)) this.seasonStarted();
        break;
      }
      case 'alerts':
        this.push(...message.alerts.map((alert): FeedItem => ({ kind: 'alert', alert })).reverse());
        break;
      case 'deploy':
        this.push({ kind: 'deploy', board: message.board, version: message.version, time: message.time, by: message.by });
        break;
      case 'inspection':
        this.inspection = { board: message.board, inspection: message.inspection };
        break;
      case 'deployResult':
        this.deployResult = { board: message.board, outcome: message.outcome };
        // The server took the code: what the editor would bring back is now the board's own firmware, not a draft.
        if (message.outcome.ok) {
          const { [message.board]: _taken, ...rest } = this.editorDrafts;
          this.editorDrafts = rest;
        }
        break;
      case 'error':
        this.showError(refusalText(message.message, message.refusal));
        break;
    }
    this.notify();
  }

  setSocketOpen(open: boolean): void {
    this.socketOpen = open;
    this.notify();
  }

  select(id: string | null): void {
    if (id !== this.selected) this.dispatchDraft = NO_DRAFT;
    this.selected = id;
    this.inspection = null;
    this.notify();
  }

  toggleHeatmap(): void {
    this.heatmap = !this.heatmap;
    this.notify();
  }

  openGuide(): void {
    this.guideOpen = true;
    this.notify();
  }

  /** Closes the guide card; with dontShowAgain, it stays closed at the next seasons, in this browser. */
  closeGuide(dontShowAgain: boolean): void {
    this.guideOpen = false;
    if (dontShowAgain) {
      try {
        this.storage?.setItem(GUIDE_DISMISSED_KEY, '1');
      } catch {
        // A storage that refuses only means the card shows again next season.
      }
    }
    this.notify();
  }

  openManual(target: string | 'index'): void {
    this.manualFor = target;
    this.notify();
  }

  closeManual(): void {
    this.manualFor = null;
    this.notify();
  }

  openEditor(board: string): void {
    this.editorFor = board;
    this.deployResult = null;
    this.notify();
  }

  /** Closes the editor; the text it held comes back when the same board's editor opens again. */
  closeEditor(text?: string): void {
    if (this.editorFor !== null && text !== undefined) this.editorDrafts = { ...this.editorDrafts, [this.editorFor]: text };
    this.editorFor = null;
    this.notify();
  }

  setDispatchDraft(patch: Partial<DispatchDraft>): void {
    this.dispatchDraft = { ...this.dispatchDraft, ...patch };
    this.notify();
  }

  /** A new season: its boards are not the old ones, so the editor and its drafts go; the guide card shows unless dismissed. */
  private seasonStarted(): void {
    this.inspection = null; // the last season's firmware and log, until the next inspect answers
    this.editorFor = null;
    this.deployResult = null;
    this.editorDrafts = {};
    this.dispatchDraft = NO_DRAFT;
    if (!this.guideDismissed()) this.guideOpen = true;
  }

  private guideDismissed(): boolean {
    try {
      return this.storage?.getItem(GUIDE_DISMISSED_KEY) === '1';
    } catch {
      return false;
    }
  }

  /** A refusal is told for a few seconds; a newer one starts the time over. */
  private showError(text: string): void {
    this.error = text;
    if (this.errorTimer !== null) clearTimeout(this.errorTimer);
    this.errorTimer = setTimeout(() => {
      this.errorTimer = null;
      this.error = null;
      this.notify();
    }, ERROR_SHOWN_MS);
  }

  private push(...items: FeedItem[]): void {
    this.feed = [...items, ...this.feed].slice(0, FEED_LIMIT);
  }

  private notify(): void {
    for (const fn of this.listeners) fn();
  }
}
