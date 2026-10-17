import { clear, el } from '../dom.ts';
import type { Store } from '../store.ts';

const SERVER_GONE = '게임 서버에 연결할 수 없어요. pnpm start가 돌고 있나요?';

/** What the player has to hear whatever screen is up: a command the server refused, and a server that is gone. */
export function noticeLines(store: Store): HTMLElement[] {
  return [
    ...(store.error ? [el('p', { class: 'bad' }, [store.error])] : []),
    ...(store.socketOpen ? [] : [el('p', { class: 'bad' }, [SERVER_GONE])]),
  ];
}

/**
 * A server that is gone, as a banner over the game screen; a refusal goes to the stack on the right there. The start screen draws
 * both in its own column, so the banner stays away then.
 */
export function renderNotice(root: HTMLElement, store: Store, inSeason: boolean): void {
  clear(root);
  const lines = inSeason && !store.socketOpen ? [el('p', { class: 'bad' }, [SERVER_GONE])] : [];
  root.hidden = lines.length === 0;
  root.append(...lines);
}
