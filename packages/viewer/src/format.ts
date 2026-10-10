import type { AlertKind, EndKind, FacilityKind, Snapshot, TimeView } from '@turing-city/core';

type Board = Snapshot['boards'][number];

export function moneyLabel(n: number): string {
  return n.toLocaleString('en-US');
}

export function timeLabel(t: TimeView, seasonDays: number): string {
  return `${t.day}일차 ${t.clock} / ${seasonDays}일`;
}

export type Led = 'running' | 'asleep' | 'unpowered' | 'error' | 'destroyed' | 'off';

export function ledOf(b: Board): Led {
  if (b.status === 'destroyed' || b.status === 'rebuilding') return 'destroyed';
  if (b.status === 'asleep') return 'asleep';
  if (!b.powered) return 'unpowered';
  if (b.erroring) return 'error';
  if (!b.hasFirmware) return 'off';
  return 'running';
}

export const LED_COLORS: Record<Led, number> = {
  running: 0x3fd07a,
  asleep: 0xe6d34a,
  unpowered: 0x596370,
  error: 0xff4d4d,
  destroyed: 0x000000,
  off: 0x2a313a,
};

export const LED_LABELS: Record<Led, string> = {
  running: '동작',
  asleep: '휴면',
  unpowered: '정전',
  error: '에러',
  destroyed: '파괴',
  off: '펌웨어 없음',
};

export const KIND_LABELS: Record<FacilityKind, string> = { power: '발전소', datacenter: '데이터센터' };

/** Heatmap opacity for a cell's EMF: nothing under 1, at most 0.6. */
export function heatAlpha(units: number): number {
  if (units < 1) return 0;
  return Math.min(0.6, units / 166);
}

/** When the power plant is selected: every board it powers, with its draw, priority rank, and whether it's shed. */
export function consumersOf(
  snapshot: Snapshot,
  selectedId: string | null,
): Array<{ id: string; demand: number; rank: number; shed: boolean }> | null {
  const selected = snapshot.boards.find((b) => b.id === selectedId);
  if (selected?.kind !== 'power') return null;
  return snapshot.boards
    .filter((b) => b.kind !== 'power')
    .map((b) => ({
      id: b.id,
      demand: b.demand,
      rank: snapshot.plant.priority.indexOf(b.id) + 1,
      shed: snapshot.plant.shed.includes(b.id),
    }));
}

export const ALERT_LABELS: Record<AlertKind, string> = {
  raid: '러다이트 출현',
  ludditesNear: '러다이트 접근',
  boardDestroyed: '보드 파괴',
  fire: '화재',
  overheat: '과열',
  powerShortage: '정전',
  firmwareError: '펌웨어 에러',
  moneyBelowZero: '자금 마이너스',
  seasonEnd: '시즌 종료',
};

export function endingLabel(kind: EndKind): string {
  return kind === 'completed' ? '시즌 완주' : kind === 'bankrupt' ? '파산' : '함락';
}
