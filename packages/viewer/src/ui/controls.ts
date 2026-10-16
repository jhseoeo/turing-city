import type { FacilityAction, FacilityView, Snapshot } from '@turing-city/core';
import { el } from '../dom.ts';
import type { GameLink } from '../net.ts';
import {
  amountChoices,
  type ButtonState,
  coolButton,
  dispatchAction,
  harvestButton,
  movedInPriority,
  processButton,
  sendButton,
  tripChoices,
  truckStatusLabel,
} from '../panel-rules.ts';
import type { Store } from '../store.ts';

/** A button from its state: disabled with its reason as the tooltip, and the reason on a line under it. */
export function stateButton(state: ButtonState, onclick: () => void, cls = ''): HTMLElement[] {
  const button = el('button', { class: cls, disabled: state.disabled, title: state.reason ?? '', onclick }, [state.label]);
  return state.reason ? [button, el('p', { class: 'dim reason' }, [state.reason])] : [button];
}

const choice = (label: string, on: boolean, onclick: () => void, off = false): HTMLElement =>
  el('button', { class: on ? 'on' : '', disabled: off, onclick }, [label]);

/** The plant: the thermal output on a slider (sent when the player lets go), and the supply order with ↑ and ↓. */
function plantControls(s: Snapshot, f: FacilityView, net: GameLink): HTMLElement[] {
  const shown = el('b', {}, [String(s.plant.thermal)]);
  const slider = el('input', { type: 'range', min: '0', max: String(s.plant.thermalMax), step: '10', value: String(s.plant.thermal) });
  // While the pointer drags it, the page holds its renders; the number follows the thumb, and the server hears the value on release.
  slider.addEventListener('input', () => {
    shown.textContent = slider.value;
  });
  slider.addEventListener('change', () =>
    net.send({ type: 'hand', facility: f.id, action: { kind: 'setThermal', output: Number(slider.value) } }),
  );
  const order = s.plant.priority;
  const rows = order.map((id, i) =>
    el('div', { class: 'prio-row' }, [
      el('span', {}, [`${i + 1}. ${id}`]),
      el('span', { class: s.plant.shed.includes(id) ? 'dim' : 'ok' }, [s.plant.shed.includes(id) ? '○ 정전' : '● 공급']),
      el(
        'button',
        {
          disabled: i === 0,
          onclick: () => net.send({ type: 'hand', facility: f.id, action: { kind: 'setPriority', order: movedInPriority(order, id, -1) } }),
        },
        ['↑'],
      ),
      el(
        'button',
        {
          disabled: i === order.length - 1,
          onclick: () => net.send({ type: 'hand', facility: f.id, action: { kind: 'setPriority', order: movedInPriority(order, id, 1) } }),
        },
        ['↓'],
      ),
    ]),
  );
  return [
    el('div', { class: 'thermal' }, ['화력 ', shown, ` / ${s.plant.thermalMax}`, slider]),
    el('div', { class: 'label' }, ['공급 순서 (전력이 모자라면 아래부터 끊겨요)']),
    ...rows,
  ];
}

/** The warehouse: its trucks, and a form that picks a truck, a trip, and an amount from buttons that survive the page's renders. */
function warehouseControls(s: Snapshot, f: FacilityView, store: Store, net: GameLink): HTMLElement[] {
  const draft = store.dispatchDraft;
  const trucks = s.trucks.filter((t) => t.warehouse === f.id);
  const capacity = store.scenario?.tuning.warehouse.truckCapacity ?? 40;
  const send = () => {
    const action = dispatchAction(draft, f.id);
    if (!action) return;
    net.send({ type: 'hand', facility: f.id, action });
    store.setDispatchDraft({ truck: null });
  };
  return [
    ...trucks.map((t) => el('div', { class: 'dim' }, [truckStatusLabel(t)])),
    el('div', { class: 'label' }, ['트럭 보내기']),
    el(
      'div',
      { class: 'choices' },
      trucks.map((t) => choice(`${t.id}번 트럭`, draft.truck === t.id, () => store.setDispatchDraft({ truck: t.id }), t.status !== 'idle')),
    ),
    el(
      'div',
      { class: 'choices' },
      tripChoices(s, f.id).map((c) =>
        choice(c.label, draft.trip?.kind === c.trip.kind && draft.trip.target === c.trip.target, () =>
          store.setDispatchDraft({ trip: c.trip }),
        ),
      ),
    ),
    el(
      'div',
      { class: 'choices' },
      amountChoices(capacity).map((a) => choice(String(a), draft.amount === a, () => store.setDispatchDraft({ amount: a }))),
    ),
    ...stateButton(sendButton(s, f, draft), send, 'primary'),
  ];
}

/** The hand controls of a standing facility (10-10 spec §4.3); null for a kind that has none (housing). */
export function renderControls(s: Snapshot, f: FacilityView, store: Store, net: GameLink): HTMLElement | null {
  const hand = (action: FacilityAction) => net.send({ type: 'hand', facility: f.id, action });
  let children: HTMLElement[];
  if (f.kind === 'farm') children = stateButton(harvestButton(f), () => hand({ kind: 'harvest' }), 'primary');
  else if (f.kind === 'datacenter') {
    // Two buttons the player presses again and again: their reasons share one line under them, always there, so neither moves.
    const process = processButton(f);
    const cool = coolButton(f);
    const button = (state: ButtonState, action: FacilityAction, cls = ''): HTMLElement =>
      el('button', { class: cls, disabled: state.disabled, title: state.reason ?? '', onclick: () => hand(action) }, [state.label]);
    children = [
      el('div', { class: 'choices' }, [button(process, { kind: 'process' }, 'primary'), button(cool, { kind: 'cool' })]),
      el('p', { class: 'dim reason' }, [
        process.reason ?? cool.reason ?? (f.powered ? '\u00a0' : '전력이 끊겨서 처리도 냉각도 하지 못해요'),
      ]),
    ];
  } else if (f.kind === 'power') children = plantControls(s, f, net);
  else if (f.kind === 'warehouse') children = warehouseControls(s, f, store, net);
  else return null;
  return el('div', { class: 'controls' }, children);
}
