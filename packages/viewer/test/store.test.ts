import type { AlertView, BoardInspection, ControllerStatus, Scenario, ServerToViewer, Snapshot } from '@turing-city/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { browserStorage, ERROR_SHOWN_MS, GUIDE_DISMISSED_KEY, type KeyValue, Store } from '../src/store.ts';

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

/** A status of a season: the store tells a new season from the one before by the season counter in it. */
const status = (state: ControllerStatus['state'], season = 1): ServerToViewer => ({
  type: 'status',
  status: { state, speed: 1, agent: { connected: false, clientName: null }, crash: null, autoPause: [], scenarioName: 'm2', season },
});

/** A snapshot at a step: the store reads nothing of it here. */
const snapshotAt = (step: number): ServerToViewer => ({ type: 'snapshot', snapshot: { step } as unknown as Snapshot });

/** What the server sends when a season starts: its first snapshot, then, in the same turn, the status that carries the new number. */
function startSeason(store: Store, season: number): void {
  store.apply(snapshotAt(0));
  store.apply(status('paused', season));
}

const alert = (over: Partial<AlertView>): AlertView => ({
  day: 1,
  clock: '00:00',
  seconds: 0,
  id: 0,
  kind: 'fire',
  facility: null,
  message: 'fire',
  ...over,
});

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

  it('keeps every alert a message brings, newest first, though every agentLost alert carries the same id', () => {
    const store = new Store(null);
    const lost = (message: string): AlertView => alert({ kind: 'agentLost', id: -1, message });
    store.apply({ type: 'alerts', alerts: [lost('first'), lost('second')] });
    store.apply({ type: 'alerts', alerts: [lost('third')] });
    expect(store.feed.map((item) => (item.kind === 'alert' ? item.alert.message : ''))).toEqual(['third', 'second', 'first']);
  });
});

describe('Store: what it keeps', () => {
  it('keeps the latest snapshot and board inspection, and drops the inspection when another facility is selected', () => {
    const store = new Store(null);
    store.apply(snapshotAt(11));
    const snapshot = { step: 12 } as unknown as Snapshot;
    store.apply({ type: 'snapshot', snapshot });
    expect(store.snapshot).toBe(snapshot);
    const inspection = { baseEmfPerSecond: 3 } as unknown as BoardInspection;
    store.apply({ type: 'inspection', board: 'DA', inspection });
    expect(store.inspection).toEqual({ board: 'DA', inspection });
    store.select('DB');
    expect(store.inspection).toBeNull();
  });

  it('keeps the newest 50 items of the feed', () => {
    const store = new Store(null);
    store.apply({ type: 'alerts', alerts: Array.from({ length: 60 }, (_, i) => alert({ message: `a${i}` })) });
    expect(store.feed).toHaveLength(50);
    expect(store.feed[0]).toMatchObject({ alert: { message: 'a59' } });
    expect(store.feed[49]).toMatchObject({ alert: { message: 'a10' } });
  });
});

describe('Store: the guide card', () => {
  it('opens when a season starts, and not for a page that joins a season in the middle', () => {
    const joining = new Store(memoryStorage());
    joining.apply(status('running', 3)); // its first status: a season that was going before the page came
    joining.apply(snapshotAt(1234));
    expect(joining.guideOpen).toBe(false);

    const starting = new Store(memoryStorage());
    starting.apply(status('idle', 0)); // the page was open on the start screen
    startSeason(starting, 1);
    expect(starting.guideOpen).toBe(true);
  });

  it('opens again at the next season, until the player says not to show it again, and that is remembered', () => {
    const storage = memoryStorage();
    const store = new Store(storage);
    store.apply(status('idle', 0));
    startSeason(store, 1);
    store.closeGuide(false);
    expect(store.guideOpen).toBe(false);
    expect(storage.data[GUIDE_DISMISSED_KEY]).toBeUndefined(); // closing without the tick keeps nothing
    store.apply(status('ended', 1));
    startSeason(store, 2); // a new season
    expect(store.guideOpen).toBe(true);
    store.closeGuide(true);
    expect(storage.data[GUIDE_DISMISSED_KEY]).toBe('1');
    startSeason(store, 3);
    expect(store.guideOpen).toBe(false);
    // Another page of the same browser reads it too.
    const later = new Store(storage);
    later.apply(status('idle', 0));
    startSeason(later, 1);
    expect(later.guideOpen).toBe(false);
  });

  it('stays as the player left it while the same season goes on: pausing, playing, and the end are no new season', () => {
    const store = new Store(memoryStorage());
    store.apply(status('idle', 0));
    startSeason(store, 1);
    store.closeGuide(false);
    for (const state of ['running', 'paused', 'ended'] as const) store.apply(status(state, 1));
    expect(store.guideOpen).toBe(false);
  });

  it('still opens from the help button after the player dismissed it', () => {
    const store = new Store(memoryStorage({ [GUIDE_DISMISSED_KEY]: '1' }));
    store.apply(status('idle', 0));
    startSeason(store, 1);
    expect(store.guideOpen).toBe(false);
    store.openGuide();
    expect(store.guideOpen).toBe(true);
  });

  it.each([
    ['no storage at all', null],
    ['a storage that refuses every call', throwingStorage],
  ])('works with %s: the card shows, and closing it does not throw', (_name, storage) => {
    const store = new Store(storage);
    store.apply(status('idle', 0));
    startSeason(store, 1);
    expect(store.guideOpen).toBe(true);
    expect(() => store.closeGuide(true)).not.toThrow();
    expect(store.guideOpen).toBe(false);
    startSeason(store, 2);
    expect(store.guideOpen).toBe(true); // nothing was kept
  });
});

describe('browserStorage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is null where the page has no localStorage, as in Node', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(browserStorage()).toBeNull();
  });

  it("is the page's localStorage where there is one", () => {
    const storage = memoryStorage();
    vi.stubGlobal('localStorage', storage);
    expect(browserStorage()).toBe(storage);
  });

  it('is null where reaching localStorage throws, as it can in a blocked or private window', () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get: () => {
        throw new Error('blocked');
      },
    });
    try {
      expect(browserStorage()).toBeNull();
    } finally {
      if (original) Object.defineProperty(globalThis, 'localStorage', original);
      else Reflect.deleteProperty(globalThis, 'localStorage');
    }
  });
});

describe('Store: a new season', () => {
  it('starts the feed, the editor, and the truck form over when the season counter moves, even before the season took a step', () => {
    const store = new Store(null);
    const time = { day: 1, clock: '00:00', seconds: 0 };
    store.apply(snapshotAt(0));
    store.apply(status('paused', 1));
    store.apply({ type: 'alerts', alerts: [alert({ kind: 'fire', id: 7 })] });
    store.apply({ type: 'deploy', board: 'DA', version: 1, time, by: 'player' });
    store.select('W');
    store.setDispatchDraft({ truck: 1 });
    store.openEditor('DA');
    store.closeEditor('-- unsaved');
    store.openEditor('DB');
    store.apply({ type: 'deployResult', board: 'DB', outcome: { ok: false, error: "firmware:1: ')' expected near 'end'" } });
    expect(store.feed).toHaveLength(2);

    // Both seasons are at step 0 (one restarted before it took a step), so only the counter tells the new one from the old.
    startSeason(store, 2);
    expect(store.feed).toEqual([]);
    expect(store.editorFor).toBeNull();
    expect(store.editorDrafts).toEqual({});
    expect(store.deployResult).toBeNull();
    expect(store.dispatchDraft).toEqual({ truck: null, trip: null, amount: null });
  });

  it('leaves all of it alone for a status of the season that goes on', () => {
    const store = new Store(null);
    store.apply(status('paused', 4));
    store.apply({ type: 'alerts', alerts: [alert({ kind: 'fire', id: 7 })] });
    store.select('W');
    store.setDispatchDraft({ truck: 1 });
    store.openEditor('DA');
    store.closeEditor('-- unsaved');
    store.openEditor('DB');
    store.apply({ type: 'deployResult', board: 'DB', outcome: { ok: false, error: 'a syntax error' } });
    for (const state of ['running', 'paused', 'ended'] as const) store.apply(status(state, 4));
    expect(store.feed).toHaveLength(1);
    expect(store.editorFor).toBe('DB');
    expect(store.editorDrafts).toEqual({ DA: '-- unsaved' });
    expect(store.deployResult?.board).toBe('DB');
    expect(store.dispatchDraft).toEqual({ truck: 1, trip: null, amount: null });
  });

  it('counts a counter that went back too: a server that restarted has none of the old season', () => {
    const store = new Store(null);
    store.apply(status('running', 3));
    store.apply({ type: 'alerts', alerts: [alert({ kind: 'fire', id: 7 })] });
    store.apply(status('idle', 0));
    expect(store.feed).toEqual([]);
  });

  it('counts a start that failed too: the season before it is gone all the same', () => {
    const store = new Store(null);
    store.apply(status('running', 1));
    store.apply({ type: 'alerts', alerts: [alert({ kind: 'fire', id: 7 })] });
    store.openEditor('DA');
    store.closeEditor('-- unsaved');
    store.apply(status('crashed', 2));
    expect(store.feed).toEqual([]);
    expect(store.editorDrafts).toEqual({});
    // The crash overlay is on screen: the guide card does not open behind it.
    expect(store.guideOpen).toBe(false);
  });

  it('forgets a deploy in flight: the old season will not answer it', () => {
    const store = new Store(null);
    store.apply(status('running', 1));
    store.openEditor('DA');
    store.startDeploy('DA');
    store.apply(status('paused', 2));
    expect(store.deployInFlight).toBeNull();
  });
});

describe('Store: a deploy in flight', () => {
  const refusal = (): ServerToViewer => ({
    type: 'error',
    message: "no board on 'DA'",
    refusal: { code: 'noBoard', facility: 'DA' },
  });

  it('remembers the board from the moment the editor sends, and drops the answer to an earlier deploy', () => {
    const store = new Store(null);
    store.openEditor('DA');
    store.apply({ type: 'deployResult', board: 'DA', outcome: { ok: false, error: 'a syntax error' } });
    expect(store.deployInFlight).toBeNull();
    store.startDeploy('DA');
    expect(store.deployInFlight).toBe('DA');
    expect(store.deployResult).toBeNull();
  });

  it("ends with the server's answer, a syntax error included", () => {
    const store = new Store(null);
    store.startDeploy('DA');
    store.apply({ type: 'deployResult', board: 'DA', outcome: { ok: false, error: "firmware:1: ')' expected near 'end'" } });
    expect(store.deployInFlight).toBeNull();
    expect(store.deployResult?.outcome.ok).toBe(false);
  });

  it("turns the server's refusal into the board's answer, in Korean, so the editor does not wait for one that never comes", () => {
    const store = new Store(null);
    store.startDeploy('DA');
    store.apply(refusal());
    expect(store.deployInFlight).toBeNull();
    expect(store.deployResult).toEqual({
      board: 'DA',
      outcome: { ok: false, error: "'DA'에는 보드가 없어요. 먼저 보드를 설치하세요." },
    });
  });

  it('leaves the answer alone when the refusal is of a command that was not a deploy', () => {
    const store = new Store(null);
    store.apply(refusal());
    expect(store.deployResult).toBeNull();
  });

  it('takes only the first refusal after a deploy for its answer', () => {
    const store = new Store(null);
    store.startDeploy('DA');
    store.apply(refusal());
    store.apply({ type: 'error', message: 'later', refusal: { code: 'noSeason' } });
    expect(store.deployResult?.board).toBe('DA');
    expect(store.deployResult?.outcome).toEqual({ ok: false, error: "'DA'에는 보드가 없어요. 먼저 보드를 설치하세요." });
  });

  it('gives up on an answer when the socket closes: it will not come over a new one', () => {
    const store = new Store(null);
    store.setSocketOpen(true);
    store.startDeploy('DA');
    store.setSocketOpen(false);
    expect(store.deployInFlight).toBeNull();
    expect(store.deployResult?.board).toBe('DA');
    expect(store.deployResult?.outcome.ok).toBe(false);
  });

  it('does not touch the answer to a deploy that was over when the socket closed', () => {
    const store = new Store(null);
    store.apply({ type: 'deployResult', board: 'DA', outcome: { ok: true, version: 2, installsAt: "the board's next tick" } });
    store.setSocketOpen(false);
    expect(store.deployResult?.outcome.ok).toBe(true);
  });
});

describe('Store: the agent deploys over the player', () => {
  const time = { day: 1, clock: '00:00', seconds: 0 };

  it("drops that board's draft, so the editor opens on the agent's firmware and [배포] cannot overwrite it unseen", () => {
    const store = new Store(null);
    store.openEditor('DA');
    store.closeEditor('-- mine, DA');
    store.openEditor('DB');
    store.closeEditor('-- mine, DB');
    store.apply({ type: 'deploy', board: 'DA', version: 4, time, by: 'agent' });
    expect(store.editorDrafts).toEqual({ DB: '-- mine, DB' });
  });

  it("keeps the draft when the player's own deploy comes back as a feed item", () => {
    const store = new Store(null);
    store.openEditor('DA');
    store.closeEditor('-- mine');
    store.apply({ type: 'deploy', board: 'DA', version: 4, time, by: 'player' });
    expect(store.editorDrafts).toEqual({ DA: '-- mine' });
  });
});

describe('Store: windows and drafts', () => {
  it('starts the truck form over when another facility is selected, and keeps it when the same one is', () => {
    const store = new Store(null);
    store.select('W');
    store.setDispatchDraft({ truck: 2, amount: 20 });
    store.select('W');
    expect(store.dispatchDraft).toEqual({ truck: 2, trip: null, amount: 20 });
    store.select('F1');
    expect(store.dispatchDraft).toEqual({ truck: null, trip: null, amount: null });
  });

  it('builds the truck form up one pick at a time, each pick keeping the ones before it', () => {
    const store = new Store(null);
    store.select('W');
    store.setDispatchDraft({ truck: 2 });
    store.setDispatchDraft({ trip: { kind: 'collect', target: 'F1' } });
    store.setDispatchDraft({ amount: 20 });
    expect(store.dispatchDraft).toEqual({ truck: 2, trip: { kind: 'collect', target: 'F1' }, amount: 20 });
  });

  it("brings an editor's text back for its board only, and keeps one draft for each board", () => {
    const store = new Store(null);
    store.openEditor('DA');
    expect(store.editorFor).toBe('DA');
    store.closeEditor('-- a');
    expect(store.editorFor).toBeNull();
    store.openEditor('DB');
    store.closeEditor('-- b');
    expect(store.editorDrafts).toEqual({ DA: '-- a', DB: '-- b' });
    // A deploy the server took ends that board's draft, and no other.
    store.apply({ type: 'deployResult', board: 'DB', outcome: { ok: true, version: 1, installsAt: "the board's next tick" } });
    expect(store.editorDrafts).toEqual({ DA: '-- a' });
    // Closing with nothing to keep, or with no editor open, adds no draft.
    store.openEditor('DC');
    store.closeEditor();
    store.closeEditor('-- nobody');
    expect(store.editorDrafts).toEqual({ DA: '-- a' });
  });

  it("opens an editor without the answer to an earlier deploy: it is not the new editor's", () => {
    const store = new Store(null);
    store.openEditor('DA');
    store.apply({ type: 'deployResult', board: 'DA', outcome: { ok: false, error: 'a syntax error' } });
    expect(store.deployResult?.board).toBe('DA');
    store.closeEditor();
    store.openEditor('DA');
    expect(store.deployResult).toBeNull();
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
