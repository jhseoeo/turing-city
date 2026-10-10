import type { AlertKind } from '@turing-city/core';
import { clear, el } from '../dom.ts';
import { ALERT_LABELS } from '../format.ts';
import type { Connection } from '../net.ts';
import type { Store } from '../store.ts';

const TOGGLABLE: readonly AlertKind[] = [
  'raid',
  'ludditesNear',
  'boardDestroyed',
  'fire',
  'overheat',
  'powerShortage',
  'firmwareError',
  'moneyBelowZero',
];

export function renderFeed(root: HTMLElement, store: Store, net: Connection): void {
  clear(root);
  for (const item of store.feed.slice(0, 12)) {
    if (item.kind === 'deploy') {
      root.append(
        el('div', { class: 'item', onclick: () => store.select(item.board) }, [
          el('span', { class: 't' }, [`${item.time.day}일 ${item.time.clock}`]),
          el('span', { style: 'color:#7fb6ff' }, [`에이전트: ${item.board}에 펌웨어 v${item.version} 배포`]),
        ]),
      );
    } else {
      const a = item.alert;
      const cls = a.kind === 'raid' || a.kind === 'boardDestroyed' || a.kind === 'fire' ? 'bad' : 'warn';
      root.append(
        el('div', { class: 'item', onclick: () => store.select(a.facility) }, [
          el('span', { class: 't' }, [`${a.day}일 ${a.clock}`]),
          el('span', { class: cls }, [a.message]),
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
  toggles.append(el('label', {}, [el('input', { type: 'checkbox', checked: true, disabled: true }), ' 연결 끊김 (항상)']));
  root.append(toggles);
}
