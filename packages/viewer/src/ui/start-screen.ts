import { clear, el } from '../dom.ts';
import type { Connection } from '../net.ts';
import type { Store } from '../store.ts';
import { noticeLines } from './notice.ts';

/**
 * 10-10 spec §10.1: start a season; connecting an agent is optional (it takes over the boards that get a comm module, T2). The
 * button waits only for the server: with the socket down a click would be dropped.
 */
export function renderStartScreen(root: HTMLElement, store: Store, net: Connection): void {
  clear(root);
  const agent = store.status?.agent;
  const connected = agent?.connected === true;
  const command = store.hello?.connect ?? '서버에 연결하는 중…';
  root.append(
    el('div', { class: 'start' }, [
      el('h1', {}, ['turing-city']),
      el('p', { class: 'dim' }, [store.status?.scenarioName ?? '']),
      el('button', { class: 'start-button', disabled: !store.socketOpen, onclick: () => net.send({ type: 'startSeason' }) }, ['시즌 시작']),
      ...noticeLines(store),
      el('div', { class: 'agent-section' }, [
        el('h2', {}, ['에이전트 연결 (선택)']),
        el('p', { class: 'dim' }, [
          '통신 모듈을 단 보드(T2)는 MCP로 연결한 에이전트가 맡을 수 있어요. 에이전트 없이도 시즌을 시작할 수 있어요.',
        ]),
        el('pre', { class: 'cmd' }, [command]),
        el('div', { class: 'row' }, [
          el('button', { onclick: () => void navigator.clipboard.writeText(command) }, ['복사']),
          el('button', { onclick: () => net.send({ type: 'reissueToken' }) }, ['토큰 재발급']),
          el('span', { class: connected ? 'ok' : 'dim' }, [
            connected ? `● 에이전트 연결됨 (${agent?.clientName ?? 'agent'})` : '○ 연결된 에이전트 없음',
          ]),
        ]),
      ]),
    ]),
  );
}
