import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ERROR_SHOWN_MS, Store } from '../src/store.ts';

describe('Store: a command the server refused', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('is told for a few seconds and then goes away by itself, drawing the screen again', () => {
    const store = new Store();
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
    const store = new Store();
    store.apply({ type: 'error', message: 'first' });
    vi.advanceTimersByTime(ERROR_SHOWN_MS - 1000);
    store.apply({ type: 'error', message: 'second' });
    vi.advanceTimersByTime(ERROR_SHOWN_MS - 1000); // the first one's time is up, the second one's is not
    expect(store.error).toContain('second');
    vi.advanceTimersByTime(1000);
    expect(store.error).toBeNull();
  });

  it("shows a refusal in Korean: by its code when it has one, and in a Korean sentence that carries the server's text when it has none", () => {
    const store = new Store();
    store.apply({ type: 'error', message: 'connect an agent first', refusal: { code: 'noAgent' } });
    expect(store.error).toBe('에이전트가 연결돼 있지 않아요. 에이전트를 연결한 뒤에 다시 해보세요.');
    store.apply({ type: 'error', message: 'a new season started' });
    expect(store.error).toBe('서버가 명령을 받아들이지 않았어요: a new season started');
  });

  it('goes away at once when a season is up and running, as before', () => {
    const store = new Store();
    store.apply({ type: 'error', message: 'connect an agent first', refusal: { code: 'noAgent' } });
    store.apply({
      type: 'status',
      status: {
        state: 'paused',
        speed: 1,
        agent: { connected: true, clientName: 'agent' },
        blockedByAgent: false,
        crash: null,
        autoPause: [],
        scenarioName: 'm1',
      },
    });
    expect(store.error).toBeNull();
  });
});
