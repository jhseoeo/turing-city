import { clear, el } from '../dom.ts';
import { endingLabel, moneyLabel } from '../format.ts';
import type { Connection } from '../net.ts';
import type { Store } from '../store.ts';

/** A lost agent, a crashed session, or the season's end. Hidden otherwise. */
export function renderOverlay(root: HTMLElement, store: Store, net: Connection): void {
  clear(root);
  const status = store.status;
  const s = store.snapshot;
  // A new season needs an agent, as the start screen's button does: the server refuses it otherwise, and this screen would not show it.
  const hasAgent = status?.agent.connected === true;
  const newSeason = el('button', { class: 'primary', disabled: !hasAgent, onclick: () => net.send({ type: 'startSeason' }) }, ['새 시즌']);
  const needsAgent = hasAgent ? '' : el('p', { class: 'dim' }, ['에이전트가 연결되면 새 시즌을 시작할 수 있어요']);
  let box: HTMLElement | null = null;
  if (status?.state === 'crashed') {
    box = el('div', { class: 'box bad' }, [
      el('h2', { class: 'bad' }, ['시뮬레이터가 멈췄어요']),
      el('p', {}, [status.crash ?? '']),
      newSeason,
      needsAgent,
    ]);
  } else if (status?.state === 'ended' && s?.ended) {
    box = el('div', { class: 'box' }, [
      el('h2', {}, [endingLabel(s.ended.kind)]),
      el('p', {}, [`최종 자금 ${moneyLabel(s.money)}`]),
      el('p', { class: 'dim' }, ['시즌 결산 화면(내역과 지난 시즌 목록)은 마일스톤 2에서 붙어요.']),
      newSeason,
      needsAgent,
    ]);
  } else if (status && status.state === 'paused' && status.blockedByAgent) {
    box = el('div', { class: 'box bad' }, [
      el('h2', { class: 'bad' }, ['⏸ 에이전트 연결이 끊겼어요']),
      el('p', {}, ['게임이 멈췄어요. 다시 연결될 때까지 재생할 수 없어요.']),
      el('p', { class: 'dim' }, ['Claude Code를 다시 켜거나 /mcp에서 재연결하세요.']),
    ]);
  }
  root.hidden = box === null;
  if (box) root.append(box);
}
