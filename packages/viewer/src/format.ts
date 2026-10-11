import type { AlertKind, EndKind, FacilityCondition, FacilityKind, FacilityView, SensorValue, Snapshot, TimeView } from '@turing-city/core';

export function moneyLabel(n: number): string {
  return n.toLocaleString('en-US');
}

export function timeLabel(t: TimeView, seasonDays: number): string {
  return `${t.day}일차 ${t.clock} / ${seasonDays}일`;
}

export type Led = 'running' | 'asleep' | 'unpowered' | 'error' | 'destroyed' | 'off';

/**
 * A facility's status light. Only a facility with a board has one: the light is the board's, and a facility at T0 is a plain
 * building. A wrecked or repairing facility's board is down with it, whatever its own state says.
 */
export function ledOf(f: FacilityView): Led | null {
  const b = f.board;
  if (!b) return null;
  if (f.condition !== 'ok' || b.status === 'destroyed' || b.status === 'rebuilding') return 'destroyed';
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

export const KIND_LABELS: Record<FacilityKind, string> = {
  power: '발전소',
  datacenter: '데이터센터',
  farm: '밭',
  warehouse: '물류창고',
  housing: '주거지',
};

/** What each tier means to the player: by hand, a board, a board an agent can reach. */
export const TIER_LABELS: Record<0 | 1 | 2, string> = { 0: 'T0 손으로', 1: 'T1 보드', 2: 'T2 통신 모듈' };

export const CONDITION_LABELS: Record<FacilityCondition, string> = { ok: '정상', wrecked: '부서짐', repairing: '복구 중' };

/** The firmware a board runs and the deploy waiting to install on it, by version: '펌웨어 v2 · 설치 대기 v3'. */
export function firmwareLabel(installed: number | null, pending: number | null): string {
  const parts: string[] = [];
  if (installed !== null) parts.push(`펌웨어 v${installed}`);
  if (pending !== null) parts.push(`설치 대기 v${pending}`);
  return parts.length > 0 ? parts.join(' · ') : '펌웨어 없음';
}

/** Heatmap opacity for a cell's EMF: nothing under 1, at most 0.6. */
export function heatAlpha(units: number): number {
  if (units < 1) return 0;
  return Math.min(0.6, units / 166);
}

/**
 * When the power plant is selected: the facilities it supplies, with their draw, priority rank, and whether they're shed. A
 * facility that draws nothing (a farm with no board, an idle datacenter) is left out unless the grid has it cut off.
 */
export function consumersOf(
  snapshot: Snapshot,
  selectedId: string | null,
): Array<{ id: string; demand: number; rank: number; shed: boolean }> | null {
  const selected = snapshot.facilities.find((f) => f.id === selectedId);
  if (selected?.kind !== 'power') return null;
  return snapshot.facilities
    .filter((f) => f.kind !== 'power' && (f.demand > 0 || snapshot.plant.shed.includes(f.id)))
    .map((f) => ({
      id: f.id,
      demand: f.demand,
      rank: snapshot.plant.priority.indexOf(f.id) + 1,
      shed: snapshot.plant.shed.includes(f.id),
    }));
}

export const ALERT_LABELS: Record<AlertKind, string> = {
  raid: '러다이트 출현',
  ludditesNear: '러다이트 접근',
  wrecked: '시설 파괴',
  fire: '화재',
  overheat: '과열',
  powerShortage: '정전',
  hunger: '굶주림',
  firmwareError: '펌웨어 에러',
  moneyBelowZero: '자금 마이너스',
  seasonEnd: '시즌 종료',
  agentLost: '에이전트 끊김',
};

export function endingLabel(kind: EndKind): string {
  return kind === 'completed' ? '시즌 완주' : '파산';
}

/** The town's people in one line: the fed out of everyone, then the hungry and those without power, when there are some. */
export function populationLabel(p: Snapshot['town']['population']): string {
  const parts = [`${p.fed}/${p.fed + p.hungry + p.unpowered}`];
  if (p.hungry > 0) parts.push(`굶주림 ${p.hungry}`);
  if (p.unpowered > 0) parts.push(`정전 ${p.unpowered}`);
  return parts.join(' · ');
}

/** A sensor value as the panel shows it: numbers to two decimals, nil for a missing one, strings as they are, one list item a line. */
export function sensorLabel(v: SensorValue): string {
  if (v === undefined) return 'nil';
  if (typeof v === 'number') return String(Math.round(v * 100) / 100);
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.map((item: SensorValue) => sensorLabel(item)).join('\n');
  return Object.entries(v)
    .map(([key, item]) => `${key}=${sensorLabel(item)}`)
    .join(' ');
}
