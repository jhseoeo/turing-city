import { clear, el } from '../dom.ts';
import { endingLabel, moneyLabel } from '../format.ts';
import type { Connection } from '../net.ts';
import type { Store } from '../store.ts';

/** A crashed session, or the season's end. Hidden otherwise. */
export function renderOverlay(root: HTMLElement, store: Store, net: Connection): void {
  clear(root);
  const status = store.status;
  const s = store.snapshot;
  const newSeason = el('button', { class: 'primary', onclick: () => net.send({ type: 'startSeason' }) }, ['새 시즌']);
  let box: HTMLElement | null = null;
  if (status?.state === 'crashed') {
    box = el('div', { class: 'box bad' }, [
      el('h2', { class: 'bad' }, ['시뮬레이터가 멈췄어요']),
      el('p', {}, [status.crash ?? '']),
      newSeason,
    ]);
  } else if (status?.state === 'ended' && s?.ended) {
    box = el('div', { class: 'box' }, [
      el('h2', {}, [endingLabel(s.ended.kind)]),
      el('p', {}, [`최종 자금 ${moneyLabel(s.money)}`]),
      el('p', { class: 'dim' }, ['시즌 결산 화면(내역과 지난 시즌 목록)은 마일스톤 2에서 붙어요.']),
      newSeason,
    ]);
  }
  root.hidden = box === null;
  if (box) root.append(box);
}
