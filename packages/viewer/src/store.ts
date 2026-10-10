import type { AlertView, BoardInspection, ControllerStatus, ServerToViewer, Snapshot, TimeView } from '@turing-city/core';

export type FeedItem =
  | { readonly kind: 'alert'; readonly alert: AlertView }
  | { readonly kind: 'deploy'; readonly board: string; readonly version: number; readonly time: TimeView };

const FEED_LIMIT = 50;

/** What the screens read; every change notifies the subscribers. */
export class Store {
  hello: { connect: string; port: number } | null = null;
  status: ControllerStatus | null = null;
  snapshot: Snapshot | null = null;
  feed: FeedItem[] = [];
  inspection: { board: string; inspection: BoardInspection | null } | null = null;
  error: string | null = null;
  socketOpen = false;
  selected: string | null = null;
  heatmap = false;
  private readonly listeners = new Set<() => void>();

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  apply(message: ServerToViewer): void {
    switch (message.type) {
      case 'hello':
        this.hello = { connect: message.connect, port: message.port };
        break;
      case 'status':
        this.status = message.status;
        if (message.status.state === 'paused' || message.status.state === 'running') this.error = null;
        break;
      case 'snapshot':
        if (this.snapshot && message.snapshot.step < this.snapshot.step) this.feed = []; // a new season
        this.snapshot = message.snapshot;
        break;
      case 'alerts':
        this.push(...message.alerts.map((alert): FeedItem => ({ kind: 'alert', alert })).reverse());
        break;
      case 'deploy':
        this.push({ kind: 'deploy', board: message.board, version: message.version, time: message.time });
        break;
      case 'inspection':
        this.inspection = { board: message.board, inspection: message.inspection };
        break;
      case 'error':
        this.error = message.message;
        break;
    }
    this.notify();
  }

  setSocketOpen(open: boolean): void {
    this.socketOpen = open;
    this.notify();
  }

  select(id: string | null): void {
    this.selected = id;
    this.inspection = null;
    this.notify();
  }

  toggleHeatmap(): void {
    this.heatmap = !this.heatmap;
    this.notify();
  }

  private push(...items: FeedItem[]): void {
    this.feed = [...items, ...this.feed].slice(0, FEED_LIMIT);
  }

  private notify(): void {
    for (const fn of this.listeners) fn();
  }
}
