import type { FacilityView, Snapshot } from '@turing-city/core';
import { clear, el } from '../dom.ts';
import { CONDITION_LABELS, firmwareLabel, KIND_LABELS, LED_LABELS, ledOf, sensorLabel, TIER_LABELS } from '../format.ts';
import type { GameLink } from '../net.ts';
import { commButton, datacenterGauges, installButton, logText, rebuildButton, repairButton } from '../panel-rules.ts';
import type { Store } from '../store.ts';
import { renderControls, stateButton } from './controls.ts';

const section = (label: string, ...children: Array<Node | string>): HTMLElement =>
  el('div', { class: 'sec' }, [el('div', { class: 'label' }, [label]), ...children]);

/** A labelled bar that empties as the time it shows runs out. */
const gaugeRow = (g: { label: string; kind: 'job' | 'cool'; left: number }): HTMLElement =>
  el('div', { class: 'gauge-row' }, [
    el('span', { class: 'dim' }, [g.label]),
    el('div', { class: `gauge ${g.kind}` }, [el('i', { style: `width: ${g.left / 10}%` })]),
  ]);

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
    rows.push(['상태', f.datacenter.cooling ? '냉각 중' : f.datacenter.processing ? '처리 중' : '대기']);
  }
  if (f.farm) rows.push(['익음', `${f.farm.ripeness}%${f.farm.ripe ? ' (수확 가능)' : ''}`], ['출고함', String(f.farm.outbox)]);
  if (f.warehouse) rows.push(['재고', String(f.warehouse.stock)]);
  if (f.housing) {
    rows.push(['주민', `${f.housing.residents}명`], ['식량', String(f.housing.food)]);
    rows.push(['상태', `${f.housing.fed ? '먹음' : '굶주림'} · ${f.powered ? '전기 있음' : '정전'}`]);
  }
  // Always there, 0 too: a row that came and went with a datacenter's job would move the hand controls under the pointer.
  if (f.kind !== 'power') rows.push(['전력', `${f.demand} 사용${f.powered ? '' : ' (끊김)'}`]);
  return rows;
}

/** The facility's state in a word: its damage, its board's light, or that it runs by hand. */
function stateOf(f: FacilityView): HTMLElement {
  if (f.condition !== 'ok') return el('span', { class: 'bad' }, [`● ${CONDITION_LABELS[f.condition]}`]);
  const led = ledOf(f);
  if (led === null) return el('span', { class: 'dim' }, ['손으로 운영']);
  return el('span', { class: led === 'running' ? 'ok' : led === 'error' || led === 'destroyed' ? 'bad' : 'warn' }, [
    `● ${LED_LABELS[led]}`,
  ]);
}

export function renderPanel(root: HTMLElement, store: Store, net: GameLink): void {
  // The panel is rebuilt on every change, so a block the player scrolled would jump back to its top: put each one back.
  const scrolled = scrollOffsets(root);
  clear(root);
  const s = store.snapshot;
  const f = s?.facilities.find((x) => x.id === store.selected);
  if (!s || !f) {
    root.append(el('p', { class: 'dim' }, ['시설을 클릭하면 여기에 정보가 떠요']));
    return;
  }
  const inspection = store.inspection?.board === f.id ? store.inspection.inspection : null;
  root.append(
    el('h2', {}, [`${KIND_LABELS[f.kind]} ${f.id}`]),
    el('div', {}, [
      el('span', { class: 'tier' }, [TIER_LABELS[f.tier]]),
      ' ',
      stateOf(f),
      f.board
        ? el('span', { class: 'dim' }, [` · ${firmwareLabel(inspection?.firmware?.version ?? null, inspection?.pending?.version ?? null)}`])
        : '',
    ]),
  );

  // The hand controls first, right under the title: nothing above them may change height from one snapshot to the next (a reading,
  // a reason line that comes and goes with the money), or the button the player keeps pressing moves away from the pointer.
  const controls = f.condition === 'ok' ? renderControls(s, f, store, net) : null;
  // A datacenter's gauges sit under its buttons, always both, so that nothing above the buttons moves.
  if (controls) root.append(section('손으로', controls, ...datacenterGauges(f).map(gaugeRow)));

  // Damage: a wrecked facility is repaired, then its board is rebuilt; each is paid for on its own (10-10 spec §6).
  const repair = repairButton(s, f);
  if (repair) root.append(section('피해', ...stateButton(repair, () => net.send({ type: 'repair', facility: f.id }), 'primary')));
  if (f.condition === 'repairing')
    root.append(section('피해', el('span', { class: 'warn' }, [`복구 중… (${f.repairHoursLeft ?? 0}시간 남음)`])));
  const rebuild = rebuildButton(s, f);
  if (rebuild) root.append(section('보드', ...stateButton(rebuild, () => net.send({ type: 'rebuild', board: f.id }), 'primary')));
  if (f.condition === 'ok' && f.board?.status === 'rebuilding') root.append(section('보드', el('span', { class: 'warn' }, ['재건 중…'])));

  root.append(section('현재', kv(readings(s, f))));

  const install = installButton(s, f);
  const comm = store.webDemo ? null : commButton(s, f); // no agent to hand the board to
  const hardware = [
    ...(install ? stateButton(install, () => net.send({ type: 'install', facility: f.id, part: 'board' })) : []),
    ...(comm ? stateButton(comm, () => net.send({ type: 'install', facility: f.id, part: 'comm' })) : []),
  ];
  if (hardware.length > 0) root.append(section('부품', ...hardware));

  if (f.kind !== 'housing') {
    root.append(
      el('div', { class: 'row' }, [
        el('button', { onclick: () => store.openManual(f.id) }, ['매뉴얼']),
        ...(f.board
          ? [
              el('button', { onclick: () => store.openEditor(f.id) }, ['편집']),
              el(
                'button',
                {
                  disabled: !inspection,
                  onclick: () => {
                    if (!inspection) return;
                    navigator.clipboard.writeText(logText(inspection.logs)).then(
                      () => store.noteLogCopy(f.id, true),
                      () => store.noteLogCopy(f.id, false),
                    );
                  },
                },
                [store.logCopy?.board === f.id ? (store.logCopy.ok ? '복사했어요' : '복사하지 못했어요') : '로그 복사'],
              ),
            ]
          : []),
      ]),
    );
  }

  if (!f.board) return;
  if (!inspection) {
    root.append(el('p', { class: 'dim' }, ['불러오는 중…']));
    return;
  }
  const parts = inspection.parts;
  root.append(
    section(
      '보드 부품',
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
