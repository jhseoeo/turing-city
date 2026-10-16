import type { FacilityAction, FacilityView, LogView, Snapshot } from '@turing-city/core';
import { moneyLabel } from './format.ts';
import type { DispatchDraft, DispatchTrip } from './store.ts';

type Truck = Snapshot['trucks'][number];

/** What a button says, whether it can be pressed, and why not. */
export interface ButtonState {
  readonly label: string;
  readonly disabled: boolean;
  readonly reason: string | null;
}

const enabled = (label: string): ButtonState => ({ label, disabled: false, reason: null });
const disabled = (label: string, reason: string): ButtonState => ({ label, disabled: true, reason });
const shortOf = (need: number, have: number): string => `자금이 모자라요 (필요 ${moneyLabel(need)}, 보유 ${moneyLabel(have)})`;
const DOWN = '시설이 부서져 있어요. 먼저 복구하세요.';

/** A board for a facility at T0 (10-10 spec §4.1): its kind's price. Housing takes none. */
export function installButton(s: Snapshot, f: FacilityView): ButtonState | null {
  if (f.kind === 'housing' || f.board !== null) return null;
  const price = s.prices.board[f.kind];
  const label = `보드 설치 (${moneyLabel(price)})`;
  if (f.condition === 'repairing') return disabled(label, '시설을 복구하는 중이에요.');
  if (f.condition !== 'ok') return disabled(label, DOWN);
  if (s.money < price) return disabled(label, shortOf(price, s.money));
  return enabled(label);
}

/** A comm module for a board at T1, which lets an agent reach it (T2). A board that is down takes none. */
export function commButton(s: Snapshot, f: FacilityView): ButtonState | null {
  if (f.board === null || f.tier !== 1) return null;
  const label = `통신 모듈 (${moneyLabel(s.prices.comm)})`;
  if (f.condition !== 'ok' || f.board.status === 'destroyed' || f.board.status === 'rebuilding')
    return disabled(label, '보드가 부서져 있어요.');
  if (s.money < s.prices.comm) return disabled(label, shortOf(s.prices.comm, s.money));
  return enabled(label);
}

/** The repair of a wrecked facility: the first of the two payments that bring it back (10-10 spec §6). */
export function repairButton(s: Snapshot, f: FacilityView): ButtonState | null {
  if (f.condition !== 'wrecked' || f.kind === 'housing') return null;
  const cost = s.prices.repair[f.kind];
  const label = `시설 복구 (${moneyLabel(cost)} · ${s.prices.repairHours}시간)`;
  return s.money < cost ? disabled(label, shortOf(cost, s.money)) : enabled(label);
}

/** The rebuild of a destroyed board, once its facility stands again: the second payment. */
export function rebuildButton(s: Snapshot, f: FacilityView): ButtonState | null {
  if (f.condition !== 'ok' || f.board?.status !== 'destroyed') return null;
  const label = `보드 재건 (${moneyLabel(s.prices.rebuild)} · ${s.prices.rebuildHours}시간)`;
  return s.money < s.prices.rebuild ? disabled(label, shortOf(s.prices.rebuild, s.money)) : enabled(label);
}

export function harvestButton(f: FacilityView): ButtonState {
  if (f.condition !== 'ok') return disabled('수확', DOWN);
  if (!f.farm?.ripe) return disabled('수확', `아직 익지 않았어요 (${f.farm?.ripeness ?? 0}%)`);
  return enabled('수확');
}

/**
 * Each press runs the datacenter for one job, to its end: the button waits for it (a press during one would do nothing). Not while a
 * cooling cycle runs either: the two never run at once, and the game refuses the press.
 */
export function processButton(f: FacilityView): ButtonState {
  if (f.condition !== 'ok') return disabled('처리', DOWN);
  if ((f.datacenter?.coolLeft ?? 0) > 0) return disabled('처리', '냉각하는 동안에는 처리할 수 없어요');
  if ((f.datacenter?.jobLeft ?? 0) > 0) return disabled('처리 중…', '처리가 끝나면 다시 누를 수 있어요');
  return enabled('처리');
}

/** One cooling cycle at a time: a press during one would do nothing, so the button waits for its end. */
export function coolButton(f: FacilityView): ButtonState {
  if (f.condition !== 'ok') return disabled('냉각', DOWN);
  if ((f.datacenter?.coolLeft ?? 0) > 0) return disabled('냉각 중…', '냉각이 끝나면 다시 누를 수 있어요');
  return enabled('냉각');
}

/**
 * A datacenter's one gauge: what it does now (a job or a cooling cycle, never both) and how far it has got, in per mille, filling
 * up as the time passes; idle and empty when it does neither. Null for any other facility.
 */
export function datacenterGauge(f: FacilityView): { label: string; kind: 'job' | 'cool' | 'idle'; done: number } | null {
  if (!f.datacenter) return null;
  const { jobLeft, coolLeft } = f.datacenter;
  if (coolLeft > 0) return { label: '냉각', kind: 'cool', done: 1000 - coolLeft };
  if (jobLeft > 0) return { label: '처리', kind: 'job', done: 1000 - jobLeft };
  return { label: '대기', kind: 'idle', done: 0 };
}

/** A trip the form offers, with what its source holds now. */
export interface TripChoice {
  readonly trip: DispatchTrip;
  readonly label: string;
  readonly available: number;
}

/** Collect from each farm (its outbox), or deliver to each housing block (from the warehouse's stock), in the scenario's order. */
export function tripChoices(s: Snapshot, warehouseId: string): TripChoice[] {
  const stock = s.facilities.find((f) => f.id === warehouseId)?.warehouse?.stock ?? 0;
  const choices: TripChoice[] = [];
  for (const f of s.facilities) {
    if (f.kind === 'farm') {
      const outbox = f.farm?.outbox ?? 0;
      choices.push({ trip: { kind: 'collect', target: f.id }, label: `${f.id}에서 회수 (출고함 ${outbox})`, available: outbox });
    }
  }
  for (const f of s.facilities) {
    if (f.kind === 'housing') {
      choices.push({ trip: { kind: 'deliver', target: f.id }, label: `${f.id}에 전달 (식량 ${f.housing?.food ?? 0})`, available: stock });
    }
  }
  return choices;
}

export function idleTrucks(s: Snapshot, warehouseId: string): number[] {
  return s.trucks.filter((t) => t.warehouse === warehouseId && t.status === 'idle').map((t) => t.id);
}

/** Loads by tens up to a truck's capacity. A truck takes what is there, so the largest choice empties an outbox. */
export function amountChoices(capacity: number): number[] {
  const out: number[] = [];
  for (let amount = 10; amount < capacity; amount += 10) out.push(amount);
  out.push(capacity);
  return out;
}

export function sendButton(s: Snapshot, w: FacilityView, draft: DispatchDraft): ButtonState {
  const label = '보내기';
  if (w.condition !== 'ok') return disabled(label, DOWN);
  if (draft.truck === null) return disabled(label, '트럭을 고르세요');
  if (!idleTrucks(s, w.id).includes(draft.truck)) return disabled(label, `${draft.truck}번 트럭은 지금 나가 있어요`);
  if (draft.trip === null) return disabled(label, '어디로 갈지 고르세요');
  if (draft.amount === null) return disabled(label, '얼마나 실을지 고르세요');
  if (draft.trip.kind === 'deliver' && (w.warehouse?.stock ?? 0) < 1) return disabled(label, '창고에 보낼 식량이 없어요');
  return enabled(label);
}

/** The core's dispatch for a complete form (contract §9): a collection goes from the farm to the warehouse, a delivery the other way. */
export function dispatchAction(draft: DispatchDraft, warehouseId: string): FacilityAction | null {
  if (draft.truck === null || draft.trip === null || draft.amount === null) return null;
  const { kind, target } = draft.trip;
  return kind === 'collect'
    ? { kind: 'dispatch', truck: draft.truck, from: target, to: warehouseId, amount: draft.amount }
    : { kind: 'dispatch', truck: draft.truck, from: warehouseId, to: target, amount: draft.amount };
}

export function truckStatusLabel(t: Truck): string {
  const load = t.load > 0 ? ` · ${t.load} 실음` : '';
  if (t.status === 'outbound') return `${t.id}번 트럭: ${t.targetId}(으)로 가는 중${load}`;
  if (t.status === 'returning') return `${t.id}번 트럭: ${t.targetId}에서 돌아오는 중${load}`;
  return `${t.id}번 트럭: 대기${load}`;
}

/** The plant's supply order with one facility moved up (-1) or down (1); at either end, the order as it was. */
export function movedInPriority(order: readonly string[], id: string, delta: -1 | 1): string[] {
  const next = [...order];
  const i = next.indexOf(id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= next.length) return next;
  next[i] = next[j]!;
  next[j] = id;
  return next;
}

/** A board's log as [로그 복사] copies it: oldest first, one line each (the panel lists it newest first). */
export function logText(logs: readonly LogView[]): string {
  return logs
    .map((l) => `${l.day}일 ${l.clock}  ${l.kind === 'log' ? '' : `[${l.kind}] `}${l.text}${l.repeat > 1 ? ` ×${l.repeat}` : ''}`)
    .join('\n');
}
