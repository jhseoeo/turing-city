import { clear, el } from '../dom.ts';
import { moneyLabel, populationLabel, timeLabel } from '../format.ts';
import type { GameLink } from '../net.ts';
import type { Store } from '../store.ts';

export function renderTopBar(root: HTMLElement, store: Store, net: GameLink): void {
  const s = store.snapshot;
  const status = store.status;
  if (!s || !status) return;
  clear(root);
  const running = status.state === 'running';
  const speedButton = (speed: 1 | 2 | 3) =>
    el('button', { class: status.speed === speed ? 'on' : '', onclick: () => net.send({ type: 'speed', speed }) }, [`${speed}×`]);
  const short = s.plant.generation < s.plant.demand;
  const people = s.town.population;
  const agent = status.agent;
  root.append(
    el('span', {}, [el('b', {}, [timeLabel(s.time, s.seasonDays)])]),
    el('span', { class: 'speed' }, [
      el('button', { class: running ? '' : 'on', onclick: () => net.send({ type: running ? 'pause' : 'play' }) }, [running ? '⏸' : '▶']),
      speedButton(1),
      speedButton(2),
      speedButton(3),
    ]),
    el('span', {}, ['자금 ', el('b', { class: s.money < 0 ? 'bad' : '' }, [moneyLabel(s.money)])]),
    el('span', {}, ['식량 ', el('b', {}, [moneyLabel(s.town.food)])]),
    el('span', {}, ['인구 ', el('b', { class: people.hungry > 0 || people.unpowered > 0 ? 'bad' : '' }, [populationLabel(people)])]),
    el('span', {}, [
      '전력 ',
      el('b', { class: short ? 'bad' : '' }, [`${s.plant.generation} / ${s.plant.demand}`]),
      el('span', { class: 'dim' }, [' 발전/수요']),
    ]),
    el('span', {}, ['풍력 ', el('b', {}, [String(s.plant.wind)]), ' · 화력 ', el('b', {}, [String(s.plant.thermal)])]),
    el('span', { class: 'tools' }, [
      el('button', { onclick: () => store.openManual('index') }, ['매뉴얼']),
      el('button', { onclick: () => store.openGuide() }, ['도움말']),
    ]),
    // The web demo has no MCP server: no agent can connect, so there is nothing to tell.
    store.webDemo
      ? el('span', { class: 'agent dim' }, ['웹 데모'])
      : el('span', { class: `agent ${agent.connected ? 'ok' : 'dim'}` }, [
          agent.connected ? `● 에이전트 연결 (${agent.clientName ?? 'agent'})` : '○ 에이전트 없음',
        ]),
  );
}
