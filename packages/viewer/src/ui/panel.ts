import type { FacilityView, Snapshot } from '@turing-city/core';
import { clear, el } from '../dom.ts';
import { CONDITION_LABELS, firmwareLabel, KIND_LABELS, LED_LABELS, ledOf, sensorLabel, TIER_LABELS } from '../format.ts';
import type { Connection } from '../net.ts';
import type { Store } from '../store.ts';

const section = (label: string, ...children: Array<Node | string>): HTMLElement =>
  el('div', { class: 'sec' }, [el('div', { class: 'label' }, [label]), ...children]);

const kv = (pairs: Array<[string, string]>): HTMLElement =>
  el(
    'div',
    { class: 'kv' },
    pairs.flatMap(([k, v]) => [el('span', { class: 'dim' }, [k]), el('span', {}, [v])]),
  );

const SCROLL_KEY = 'data-scroll';

/** The scroll offsets of the panel's scrollable blocks, by their keys. */
function scrollOffsets(root: HTMLElement): Map<string, number> {
  const offsets = new Map<string, number>();
  for (const pre of root.querySelectorAll<HTMLElement>(`pre[${SCROLL_KEY}]`))
    offsets.set(pre.getAttribute(SCROLL_KEY) ?? '', pre.scrollTop);
  return offsets;
}

/** What the snapshot says of a facility of each kind: the readings a player at T0 works from. */
function readings(s: Snapshot, f: FacilityView): Array<[string, string]> {
  const rows: Array<[string, string]> = [];
  if (f.kind === 'power') {
    rows.push(['풍력', String(s.plant.wind)], ['화력', `${s.plant.thermal} / ${s.plant.thermalMax}`]);
    rows.push(['연료비', `${s.plant.fuelPrice}/단위·일`], ['발전 / 수요', `${s.plant.generation} / ${s.plant.demand}`]);
  }
  if (f.datacenter) {
    rows.push(['온도', `${f.datacenter.tempC}°C`]);
    rows.push(['상태', [f.datacenter.processing ? '처리 중' : '대기', ...(f.datacenter.cooling ? ['냉각 중'] : [])].join(' · ')]);
  }
  if (f.farm) rows.push(['익음', `${f.farm.ripeness}%${f.farm.ripe ? ' (수확 가능)' : ''}`], ['출고함', String(f.farm.outbox)]);
  if (f.warehouse) rows.push(['재고', String(f.warehouse.stock)]);
  if (f.housing) {
    rows.push(['주민', `${f.housing.residents}명`], ['식량', String(f.housing.food)]);
    rows.push(['상태', `${f.housing.fed ? '먹음' : '굶주림'} · ${f.powered ? '전기 있음' : '정전'}`]);
  }
  return rows;
}

export function renderPanel(root: HTMLElement, store: Store, _net: Connection): void {
  // The panel is rebuilt on every change, so a block the player scrolled would jump back to its top: put each one back.
  const scrolled = scrollOffsets(root);
  clear(root);
  const s = store.snapshot;
  const f = s?.facilities.find((x) => x.id === store.selected);
  if (!s || !f) {
    root.append(el('p', { class: 'dim' }, ['시설을 클릭하면 여기에 정보가 떠요']));
    return;
  }
  const led = ledOf(f);
  const inspection = store.inspection?.board === f.id ? store.inspection.inspection : null;
  const state =
    f.condition !== 'ok'
      ? el('span', { class: 'bad' }, [`● ${CONDITION_LABELS[f.condition]}`])
      : led === null
        ? el('span', { class: 'dim' }, ['손으로 운영'])
        : el('span', { class: led === 'running' ? 'ok' : led === 'error' || led === 'destroyed' ? 'bad' : 'warn' }, [
            `● ${LED_LABELS[led]}`,
          ]);
  root.append(
    el('h2', {}, [`${KIND_LABELS[f.kind]} ${f.id}`]),
    el('div', {}, [
      el('span', { class: 'tier' }, [TIER_LABELS[f.tier]]),
      ' ',
      state,
      f.board
        ? el('span', { class: 'dim' }, [` · ${firmwareLabel(inspection?.firmware?.version ?? null, inspection?.pending?.version ?? null)}`])
        : '',
    ]),
    section('현재', kv(readings(s, f))),
  );
  if (!f.board) return;
  if (!inspection) {
    root.append(el('p', { class: 'dim' }, ['불러오는 중…']));
    return;
  }
  const parts = inspection.parts;
  root.append(
    section(
      '부품',
      kv([
        ['CPU', `${parts.clockHz}Hz · 틱당 ${parts.instructionsPerTick}명령`],
        ['RAM', `${Math.round(parts.ramBytes / 1024)}KB (사용 ${((parts.ramUsedBytes ?? 0) / 1024).toFixed(1)}KB)`],
        ['기본 전자파', String(inspection.baseEmfPerSecond)],
      ]),
    ),
    section('실시간 센서', kv(Object.entries(inspection.sensors).map(([k, v]): [string, string] => [k, sensorLabel(v)]))),
    section(
      '로그',
      el('pre', { [SCROLL_KEY]: `${f.id}/log` }, [
        [...inspection.logs]
          .reverse()
          .map((l) => `${l.day}일 ${l.clock}  ${l.kind === 'log' ? '' : `[${l.kind}] `}${l.text}${l.repeat > 1 ? ` ×${l.repeat}` : ''}`)
          .join('\n') || '(없음)',
      ]),
    ),
    // A deploy installs at the board's next tick, which for a board that is asleep or smashed is a while off: until then it shows here.
    ...(inspection.pending
      ? [
          section(
            `설치 대기 중인 펌웨어 v${inspection.pending.version} (읽기 전용)`,
            el('pre', { [SCROLL_KEY]: `${f.id}/pending` }, [inspection.pending.source]),
          ),
        ]
      : []),
    section(
      `펌웨어${inspection.firmware ? ` v${inspection.firmware.version}` : ''} (읽기 전용)`,
      el('pre', { [SCROLL_KEY]: `${f.id}/firmware` }, [inspection.firmware?.source ?? '(없음)']),
    ),
  );
  // Only now are the blocks in the page with a layout, which setting scrollTop needs. Another facility's blocks have other keys.
  for (const pre of root.querySelectorAll<HTMLElement>(`pre[${SCROLL_KEY}]`))
    pre.scrollTop = scrolled.get(pre.getAttribute(SCROLL_KEY) ?? '') ?? 0;
}
