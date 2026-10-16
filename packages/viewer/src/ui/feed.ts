import { ALERT_KINDS, type AlertKind } from '@turing-city/core';
import { clear, el } from '../dom.ts';
import { ALERT_LABELS } from '../format.ts';
import type { GameLink } from '../net.ts';
import type { Store } from '../store.ts';

/** Every alert kind can pause the game but the season's end, which ends it. A lost agent is one of them now, on by default. */
const TOGGLABLE: readonly AlertKind[] = ALERT_KINDS.filter((kind) => kind !== 'seasonEnd');
const SEVERE: readonly AlertKind[] = ['raid', 'wrecked', 'fire', 'hunger', 'agentLost'];

export function renderFeed(root: HTMLElement, store: Store, net: GameLink): void {
  clear(root);
  for (const item of store.feed.slice(0, 12)) {
    if (item.kind === 'deploy') {
      root.append(
        el('div', { class: 'item', onclick: () => store.select(item.board) }, [
          el('span', { class: 't' }, [`${item.time.day}일 ${item.time.clock}`]),
          el('span', { class: 'deploy' }, [
            `${item.by === 'agent' ? '에이전트' : '플레이어'}: ${item.board}에 펌웨어 v${item.version} 배포`,
          ]),
        ]),
      );
    } else {
      const a = item.alert;
      root.append(
        el('div', { class: 'item', onclick: () => store.select(a.facility) }, [
          el('span', { class: 't' }, [`${a.day}일 ${a.clock}`]),
          el('span', { class: SEVERE.includes(a.kind) ? 'bad' : 'warn' }, [a.message]),
        ]),
      );
    }
  }
  const auto = store.status?.autoPause ?? [];
  const toggles = el('div', { class: 'toggles' }, ['자동 정지: ']);
  for (const kind of TOGGLABLE) {
    const box = el('input', { type: 'checkbox', checked: auto.includes(kind) });
    box.addEventListener('change', () => {
      const next = box.checked ? [...auto, kind] : auto.filter((k) => k !== kind);
      net.send({ type: 'autoPause', kinds: next });
    });
    toggles.append(el('label', {}, [box, ` ${ALERT_LABELS[kind]}`]));
  }
  root.append(toggles);
}
