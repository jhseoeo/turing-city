import type { ControllerStatus, Scenario, ServerToViewer, Snapshot } from '@turing-city/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ERROR_SHOWN_MS, GUIDE_DISMISSED_KEY, type KeyValue, Store } from '../src/store.ts';

/** A storage in memory, the way localStorage behaves. */
function memoryStorage(initial: Record<string, string> = {}): KeyValue & { readonly data: Record<string, string> } {
  const data: Record<string, string> = { ...initial };
  return {
    data,
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => {
      data[key] = value;
    },
  };
}

/** A storage that refuses every call, as a blocked or private one can. */
const throwingStorage: KeyValue = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('blocked');
  },
};

const status = (state: ControllerStatus['state'], season = 1): ServerToViewer => ({
  type: 'status',
  status: { state, speed: 1, agent: { connected: false, clientName: null }, crash: null, autoPause: [], scenarioName: 'm2', season },
});

/** A snapshot at a step: the store reads only its step here. */
const snapshotAt = (step: number): ServerToViewer => ({ type: 'snapshot', snapshot: { step } as unknown as Snapshot });

describe('Store: a command the server refused', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('is told for a few seconds and then goes away by itself, drawing the screen again', () => {
    const store = new Store(null);
    let draws = 0;
    store.subscribe(() => {
      draws += 1;
    });
    store.apply({ type: 'error', message: 'DA is not destroyed', refusal: { code: 'notDestroyed', board: 'DA' } });
    expect(store.error).toBe("'DA' 보드는 부서진 상태가 아니라서 재건할 수 없어요.");
    expect(draws).toBe(1);

    vi.advanceTimersByTime(ERROR_SHOWN_MS - 1);
    expect(store.error).toBe("'DA' 보드는 부서진 상태가 아니라서 재건할 수 없어요.");
    vi.advanceTimersByTime(1);
    expect(store.error).toBeNull();
    expect(draws).toBe(2); // the screen is told it is gone
  });

  it('starts the time over when another refusal comes, so the newer one is not cut short by the older one', () => {
    const store = new Store(null);
    store.apply({ type: 'error', message: 'first' });
    vi.advanceTimersByTime(ERROR_SHOWN_MS - 1000);
    store.apply({ type: 'error', message: 'second' });
    vi.advanceTimersByTime(ERROR_SHOWN_MS - 1000); // the first one's time is up, the second one's is not
    expect(store.error).toContain('second');
    vi.advanceTimersByTime(1000);
    expect(store.error).toBeNull();
  });

  it("shows a refusal in Korean: by its code when it has one, and in a Korean sentence that carries the server's text when it has none", () => {
    const store = new Store(null);
    store.apply({ type: 'error', message: 'not enough money', refusal: { code: 'tooPoor' } });
    expect(store.error).toBe('자금이 모자라요.');
    store.apply({ type: 'error', message: 'a new season started' });
    expect(store.error).toBe('서버가 명령을 받아들이지 않았어요: a new season started');
  });

  it('goes away at once when a season is up and running, as before', () => {
    const store = new Store(null);
    store.apply({ type: 'error', message: 'not enough money', refusal: { code: 'tooPoor' } });
    store.apply(status('paused'));
    expect(store.error).toBeNull();
  });
});

describe('Store: what the server says', () => {
  it('keeps the scenario that hello carries, for the manual and the truck form', () => {
    const store = new Store(null);
    const scenario = { id: 'm2-town', name: '작은 마을' } as unknown as Scenario;
    store.apply({ type: 'hello', connect: 'claude mcp add …', port: 7840, scenario });
    expect(store.hello).toEqual({ connect: 'claude mcp add …', port: 7840 });
    expect(store.scenario).toBe(scenario);
  });

  it('says in the feed who deployed: the player from the editor, or the agent over MCP', () => {
    const store = new Store(null);
    const time = { day: 1, clock: '00:00', seconds: 0 };
    store.apply({ type: 'deploy', board: 'DA', version: 1, time, by: 'player' });
    store.apply({ type: 'deploy', board: 'DA', version: 2, time, by: 'agent' });
    expect(store.feed.map((item) => (item.kind === 'deploy' ? `${item.by} v${item.version}` : ''))).toEqual(['agent v2', 'player v1']);
  });

  it("keeps the editor's last deploy result, and forgets the board's draft once the server took a deploy", () => {
    const store = new Store(null);
    store.openEditor('DA');
    store.closeEditor('function tick(io) io.process( end');
    expect(store.editorDrafts.DA).toBe('function tick(io) io.process( end');
    store.apply({ type: 'deployResult', board: 'DA', outcome: { ok: false, error: "firmware:1: ')' expected near 'end'" } });
    expect(store.deployResult?.outcome.ok).toBe(false);
    expect(store.editorDrafts.DA).toBe('function tick(io) io.process( end'); // a refused deploy keeps the draft
    store.apply({ type: 'deployResult', board: 'DA', outcome: { ok: true, version: 3, installsAt: "the board's next tick" } });
    expect(store.editorDrafts.DA).toBeUndefined();
  });
});

describe('Store: the guide card', () => {
  it('opens when a season starts, and not for a page that joins a season in the middle', () => {
    const joining = new Store(memoryStorage());
    joining.apply(snapshotAt(1234));
    expect(joining.guideOpen).toBe(false);

    const starting = new Store(memoryStorage());
    starting.apply(snapshotAt(0));
    expect(starting.guideOpen).toBe(true);
  });

  it('opens again at the next season, until the player says not to show it again, and that is remembered', () => {
    const storage = memoryStorage();
    const store = new Store(storage);
    store.apply(snapshotAt(0));
    store.closeGuide(false);
    expect(store.guideOpen).toBe(false);
    store.apply(snapshotAt(900));
    store.apply(snapshotAt(0)); // a new season
    expect(store.guideOpen).toBe(true);
    store.closeGuide(true);
    expect(storage.data[GUIDE_DISMISSED_KEY]).toBe('1');
    store.apply(snapshotAt(900));
    store.apply(snapshotAt(0));
    expect(store.guideOpen).toBe(false);
    // Another page of the same browser reads it too.
    const later = new Store(storage);
    later.apply(snapshotAt(0));
    expect(later.guideOpen).toBe(false);
  });

  it('still opens from the help button after the player dismissed it', () => {
    const store = new Store(memoryStorage({ [GUIDE_DISMISSED_KEY]: '1' }));
    store.apply(snapshotAt(0));
    expect(store.guideOpen).toBe(false);
    store.openGuide();
    expect(store.guideOpen).toBe(true);
  });

  it('works with a storage that refuses every call: the card shows, and closing it does not throw', () => {
    const store = new Store(throwingStorage);
    store.apply(snapshotAt(0));
    expect(store.guideOpen).toBe(true);
    expect(() => store.closeGuide(true)).not.toThrow();
    expect(store.guideOpen).toBe(false);
  });
});

describe('Store: windows and drafts', () => {
  it('closes the editor and forgets its drafts when a new season starts: its boards are not the old ones', () => {
    const store = new Store(null);
    store.apply(snapshotAt(500));
    store.openEditor('DA');
    store.closeEditor('-- unsaved');
    store.openEditor('DB');
    store.setDispatchDraft({ truck: 1 });
    store.apply(snapshotAt(0));
    expect(store.editorFor).toBeNull();
    expect(store.editorDrafts).toEqual({});
    expect(store.deployResult).toBeNull();
    expect(store.dispatchDraft).toEqual({ truck: null, trip: null, amount: null });
  });

  it('starts the truck form over when another facility is selected, and keeps it when the same one is', () => {
    const store = new Store(null);
    store.select('W');
    store.setDispatchDraft({ truck: 2, amount: 20 });
    store.select('W');
    expect(store.dispatchDraft).toEqual({ truck: 2, trip: null, amount: 20 });
    store.select('F1');
    expect(store.dispatchDraft).toEqual({ truck: null, trip: null, amount: null });
  });

  it("keeps an editor's text as its board's draft when another board's editor takes its place", () => {
    const store = new Store(null);
    store.openEditor('DA');
    store.keepDraft('DA', '-- half typed');
    store.openEditor('DB');
    expect(store.editorDrafts).toEqual({ DA: '-- half typed' });
  });

  it("forgets the editor's last deploy answer when the editor sends again", () => {
    const store = new Store(null);
    store.apply({ type: 'deployResult', board: 'DA', outcome: { ok: false, error: 'firmware:1: boom' } });
    expect(store.deployResult).not.toBeNull();
    let notified = 0;
    store.subscribe(() => notified++);
    store.clearDeployResult();
    expect(store.deployResult).toBeNull();
    expect(notified).toBe(1);
  });

  it('opens the manual on a board or on the index, and closes it', () => {
    const store = new Store(null);
    store.openManual('DA');
    expect(store.manualFor).toBe('DA');
    store.openManual('index');
    expect(store.manualFor).toBe('index');
    store.closeManual();
    expect(store.manualFor).toBeNull();
  });
});

describe('Store: the server counts seasons', () => {
  const alert = (id: number): ServerToViewer => ({
    type: 'alerts',
    alerts: [{ id, kind: 'raid', message: 'raid', day: 1, clock: '00:00', seconds: 0, facility: null }],
  });

  it('starts over when the season counter changes, even if the snapshot does not show a step going back', () => {
    const store = new Store(memoryStorage());
    store.apply(status('paused', 1));
    store.apply(snapshotAt(0));
    store.closeGuide(false);
    store.apply(alert(1));
    store.openEditor('DA');
    store.closeEditor('-- unsaved');
    store.select('W');
    store.setDispatchDraft({ truck: 1 });
    // Season 2 begins at step 0, as season 1 did: no step went back.
    store.apply(snapshotAt(0));
    store.apply(status('paused', 2));
    expect(store.guideOpen).toBe(true);
    expect(store.feed).toEqual([]);
    expect(store.editorDrafts).toEqual({});
    expect(store.dispatchDraft).toEqual({ truck: null, trip: null, amount: null });
  });

  it('keeps everything while the counter stays the same, and for a page whose first status is a later season', () => {
    const store = new Store(memoryStorage());
    store.apply(status('running', 3)); // joined at season 3: nothing started here
    store.apply(snapshotAt(400));
    store.apply(alert(1));
    store.openEditor('DA');
    store.closeEditor('-- unsaved');
    store.apply(status('paused', 3));
    expect(store.guideOpen).toBe(false);
    expect(store.feed).toHaveLength(1);
    expect(store.editorDrafts).toEqual({ DA: '-- unsaved' });
  });
});
