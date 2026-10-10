import { clear, el } from '../dom.ts';
import type { Connection } from '../net.ts';
import type { Store } from '../store.ts';
import { noticeLines } from './notice.ts';

/** Spec §8.1: connect your agent, then start the season. */
export function renderStartScreen(root: HTMLElement, store: Store, net: Connection): void {
  clear(root);
  const agent = store.status?.agent;
  const connected = agent?.connected === true;
  const command = store.hello?.connect ?? '서버에 연결하는 중…';
  root.append(
    el('div', { class: 'start' }, [
      el('h1', {}, ['turing-city']),
      el('p', { class: 'dim' }, [store.status?.scenarioName ?? '']),
      el('p', {}, ['에이전트를 연결하세요 (Claude Code 예시)']),
      el('pre', { class: 'cmd' }, [command]),
      el('div', { class: 'row' }, [
        el('button', { class: 'primary', onclick: () => void navigator.clipboard.writeText(command) }, ['복사']),
        el('button', { onclick: () => net.send({ type: 'reissueToken' }) }, ['토큰 재발급']),
        el('span', { class: connected ? 'ok' : 'warn' }, [
          connected ? `● 에이전트 연결됨 (${agent?.clientName ?? 'agent'})` : '◌ 에이전트를 기다리는 중…',
        ]),
      ]),
      el('button', { class: 'start-button', disabled: !connected, onclick: () => net.send({ type: 'startSeason' }) }, ['시즌 시작']),
      ...noticeLines(store),
    ]),
  );
}
