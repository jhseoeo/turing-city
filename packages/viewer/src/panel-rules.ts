import type { BoardInspection, FacilityAction, FacilityView, LogView, Snapshot } from '@turing-city/core';
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
const WRECKED = '시설이 부서져 있어요. 먼저 복구하세요.';
const REPAIRING = '시설을 복구하는 중이에요. 끝나면 할 수 있어요.';

/** Why a facility that does not stand takes nothing: a wreck waits for the player's repair, and a repair under way for its end. */
const downReason = (f: FacilityView): string => (f.condition === 'repairing' ? REPAIRING : WRECKED);

/** A board for a facility at T0 (10-10 spec §4.1): its kind's price. Housing takes none. */
export function installButton(s: Snapshot, f: FacilityView): ButtonState | null {
  if (f.kind === 'housing' || f.board !== null) return null;
  const price = s.prices.board[f.kind];
  const label = `보드 설치 (${moneyLabel(price)})`;
  if (f.condition !== 'ok') return disabled(label, downReason(f));
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
  if (f.condition !== 'ok') return disabled('수확', downReason(f));
  if (!f.farm?.ripe) return disabled('수확', `아직 익지 않았어요 (${f.farm?.ripeness ?? 0}%)`);
  return enabled('수확');
}

/** Each press runs the datacenter for a short job; mashing it keeps it running (10-10 spec §4.3). */
export function processButton(f: FacilityView): ButtonState {
  return f.condition !== 'ok' ? disabled('처리', downReason(f)) : enabled('처리');
}

/** One cooling cycle at a time: a press during one would do nothing, so the button waits for its end. */
export function coolButton(f: FacilityView): ButtonState {
  if (f.condition !== 'ok') return disabled('냉각', downReason(f));
  if (f.datacenter?.cooling) return disabled('냉각 중…', '냉각이 끝나면 다시 누를 수 있어요');
  return enabled('냉각');
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
  if (w.condition !== 'ok') return disabled(label, downReason(w));
  const idle = idleTrucks(s, w.id);
  if (idle.length === 0) return disabled(label, '대기 중인 트럭이 없어요');
  if (draft.truck === null) return disabled(label, '트럭을 고르세요');
  if (!idle.includes(draft.truck)) return disabled(label, `${draft.truck}번 트럭은 지금 나가 있어요`);
  if (draft.trip === null) return disabled(label, '어디로 갈지 고르세요');
  // The snapshot already says that a delivery has nothing to load: say so before asking how much.
  if (draft.trip.kind === 'deliver' && (w.warehouse?.stock ?? 0) < 1) return disabled(label, '창고에 보낼 식량이 없어요');
  if (draft.amount === null) return disabled(label, '얼마나 실을지 고르세요');
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

/** A board's log as [로그 복사] copies it: oldest first, one line each, the way the panel shows it. */
export function logText(logs: readonly LogView[]): string {
  return logs
    .map((l) => `${l.day}일 ${l.clock}  ${l.kind === 'log' ? '' : `[${l.kind}] `}${l.text}${l.repeat > 1 ? ` ×${l.repeat}` : ''}`)
    .join('\n');
}

/**
 * What the snapshot says of a facility of each kind: the readings a player at T0 works from. A facility that is down reads as its repair
 * will leave it (a datacenter at ambient, a crop at 0%), which is not what it holds now, so its temperature and its crop wait until it
 * stands. That follows the condition and never the value: 25 °C and 0% are real readings of a facility that stands. What a wreck leaves
 * alone (a farm's outbox, a warehouse's stock, a housing block's food) keeps its row.
 */
export function readings(s: Snapshot, f: FacilityView): Array<[string, string]> {
  const rows: Array<[string, string]> = [];
  const stands = f.condition === 'ok';
  if (f.kind === 'power') {
    rows.push(['풍력', String(s.plant.wind)], ['화력', `${s.plant.thermal} / ${s.plant.thermalMax}`]);
    rows.push(['연료비', `${s.plant.fuelPrice}/단위·일`], ['발전 / 수요', `${s.plant.generation} / ${s.plant.demand}`]);
  }
  if (f.datacenter) {
    if (stands) rows.push(['온도', `${f.datacenter.tempC}°C`]);
    rows.push(['상태', [f.datacenter.processing ? '처리 중' : '대기', ...(f.datacenter.cooling ? ['냉각 중'] : [])].join(' · ')]);
  }
  if (f.farm) {
    if (stands) rows.push(['익음', `${f.farm.ripeness}%${f.farm.ripe ? ' (수확 가능)' : ''}`]);
    rows.push(['출고함', String(f.farm.outbox)]);
  }
  if (f.warehouse) rows.push(['재고', String(f.warehouse.stock)]);
  if (f.housing) {
    rows.push(['주민', `${f.housing.residents}명`], ['식량', String(f.housing.food)]);
    rows.push(['상태', `${f.housing.fed ? '먹음' : '굶주림'} · ${f.powered ? '전기 있음' : '정전'}`]);
  }
  if (f.kind !== 'power' && f.demand > 0) rows.push(['전력', `${f.demand} 사용${f.powered ? '' : ' (끊김)'}`]);
  return rows;
}

/**
 * A board's RAM as the panel reads it: its size, and what its last tick used while the board runs. The number comes from that last
 * tick, which a sleep (it wipes the RAM), a wreck, and a rebuild leave behind as it was, so a board that does not run shows only its size.
 */
export function ramLabel(parts: BoardInspection['parts'], f: FacilityView): string {
  const size = `${Math.round(parts.ramBytes / 1024)}KB`;
  return f.board?.status === 'running' ? `${size} (사용 ${((parts.ramUsedBytes ?? 0) / 1024).toFixed(1)}KB)` : size;
}
