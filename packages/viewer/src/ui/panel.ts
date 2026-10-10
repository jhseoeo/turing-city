import { clear, el } from '../dom.ts';
import { KIND_LABELS, LED_LABELS, ledOf, moneyLabel } from '../format.ts';
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

export function renderPanel(root: HTMLElement, store: Store, net: Connection): void {
  // The panel is rebuilt on every change, so a block the player scrolled would jump back to its top: put each one back.
  const scrolled = scrollOffsets(root);
  clear(root);
  const s = store.snapshot;
  const board = s?.boards.find((b) => b.id === store.selected);
  if (!s || !board) {
    root.append(el('p', { class: 'dim' }, ['시설을 클릭하면 여기에 정보가 떠요']));
    return;
  }
  const led = ledOf(board);
  const inspection = store.inspection?.board === board.id ? store.inspection.inspection : null;
  root.append(
    el('h2', {}, [`${KIND_LABELS[board.kind]} ${board.id}`]),
    el('div', {}, [
      el('span', { class: led === 'running' ? 'ok' : led === 'error' || led === 'destroyed' ? 'bad' : 'warn' }, [`● ${LED_LABELS[led]}`]),
      el('span', { class: 'dim' }, [inspection?.firmware ? ` · 펌웨어 v${inspection.firmware.version}` : ' · 펌웨어 없음']),
    ]),
  );
  if (board.status === 'destroyed') {
    root.append(
      section(
        '재건',
        el('button', { class: 'primary', onclick: () => net.send({ type: 'rebuild', board: board.id }) }, [
          `재건 (${moneyLabel(s.rebuild.cost)} · ${s.rebuild.hours}시간)`,
        ]),
      ),
    );
  } else if (board.status === 'rebuilding') {
    root.append(section('재건', el('span', { class: 'warn' }, ['재건 중…'])));
  }
  if (board.kind === 'power') {
    root.append(
      section(
        '발전',
        kv([
          ['풍력', String(s.plant.wind)],
          ['화력', `${s.plant.thermal} (연료 ${s.plant.fuelPrice}/단위·일)`],
          ['발전 / 수요', `${s.plant.generation} / ${s.plant.demand}`],
        ]),
      ),
      section(
        '우선순위',
        kv(s.plant.priority.map((id, i): [string, string] => [`${i + 1}. ${id}`, s.plant.shed.includes(id) ? '○ 정전' : '● 공급'])),
      ),
    );
  }
  if (!inspection) {
    root.append(el('p', { class: 'dim' }, ['불러오는 중…']));
    return;
  }
  const parts = inspection.datasheet.parts;
  root.append(
    section(
      '부품',
      kv([
        ['CPU', `${parts.clockHz}Hz · 틱당 ${parts.instructionsPerTick}명령`],
        ['RAM', `${Math.round(parts.ramBytes / 1024)}KB (사용 ${((inspection.datasheet.firmware.ramUsedBytes ?? 0) / 1024).toFixed(1)}KB)`],
        ['기본 전자파', String(inspection.datasheet.baseEmfPerSecond)],
      ]),
    ),
    section(
      '실시간 센서',
      kv(
        Object.entries(inspection.sensors).map(([k, v]): [string, string] => [
          k,
          v === undefined ? 'nil' : String(Math.round(v * 100) / 100),
        ]),
      ),
    ),
    section(
      '로그',
      el('pre', { [SCROLL_KEY]: `${board.id}/log` }, [
        [...inspection.logs]
          .reverse()
          .map((l) => `${l.day}일 ${l.clock}  ${l.kind === 'log' ? '' : `[${l.kind}] `}${l.text}${l.repeat > 1 ? ` ×${l.repeat}` : ''}`)
          .join('\n') || '(없음)',
      ]),
    ),
    section(
      `펌웨어${inspection.firmware ? ` v${inspection.firmware.version}` : ''} (읽기 전용)`,
      el('pre', { [SCROLL_KEY]: `${board.id}/firmware` }, [inspection.firmware?.source ?? '(없음)']),
    ),
  );
  // Only now are the blocks in the page with a layout, which setting scrollTop needs. Another board's blocks have other keys.
  for (const pre of root.querySelectorAll<HTMLElement>(`pre[${SCROLL_KEY}]`))
    pre.scrollTop = scrolled.get(pre.getAttribute(SCROLL_KEY) ?? '') ?? 0;
}
