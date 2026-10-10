import { clear, el } from '../dom.ts';
import type { Store } from '../store.ts';

/** What the player has to hear whatever screen is up: a command the server refused, and a server that is gone. */
export function noticeLines(store: Store): HTMLElement[] {
  return [
    ...(store.error ? [el('p', { class: 'bad' }, [store.error])] : []),
    ...(store.socketOpen ? [] : [el('p', { class: 'bad' }, ['게임 서버에 연결할 수 없어요. pnpm start가 돌고 있나요?'])]),
  ];
}

/** The same lines as a banner over the game screen. The start screen draws them in its own column, so the banner stays away then. */
export function renderNotice(root: HTMLElement, store: Store, inSeason: boolean): void {
  clear(root);
  const lines = inSeason ? noticeLines(store) : [];
  root.hidden = lines.length === 0;
  root.append(...lines);
}
