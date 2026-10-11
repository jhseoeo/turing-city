import { type FacilityKind, type FacilityView, pathTo, type Scenario, type Snapshot } from '@turing-city/core';

export type Cell = readonly [number, number];
type Truck = Snapshot['trucks'][number];

export const FACILITY_COLORS: Record<FacilityKind, number> = {
  power: 0xf2c14e,
  datacenter: 0xc49bff,
  farm: 0x7fc97f,
  warehouse: 0xd9a066,
  housing: 0x8fb8e0,
};

/** A truck's current leg: from where it started to where it ends, cell by cell. */
export interface Route {
  readonly warehouse: string;
  readonly truck: number;
  readonly target: string;
  /** collect: to a farm and back with its food; deliver: to a housing block with food, and back empty. */
  readonly kind: 'collect' | 'deliver';
  readonly status: 'outbound' | 'returning';
  readonly cells: readonly Cell[];
}

/**
 * The leg a truck is on, as the core drives it: out from its warehouse to its target, then back, each leg along the row first and
 * then the column (pathTo). Null for an idle truck.
 */
export function legOf(snapshot: Snapshot, truck: Truck): Route | null {
  if (truck.status === 'idle' || truck.targetId === null) return null;
  const warehouse = snapshot.facilities.find((f) => f.id === truck.warehouse);
  const target = snapshot.facilities.find((f) => f.id === truck.targetId);
  if (!warehouse || !target) return null;
  const [from, to] = truck.status === 'outbound' ? [warehouse, target] : [target, warehouse];
  return {
    warehouse: warehouse.id,
    truck: truck.id,
    target: target.id,
    kind: target.kind === 'farm' ? 'collect' : 'deliver',
    status: truck.status,
    cells: [[from.x, from.y], ...pathTo(from.x, from.y, to.x, to.y)],
  };
}

/**
 * The truck routes the map draws for the selection (10-09 spec §8.2): the warehouse shows every route its trucks are on, a farm only
 * the trucks collecting from it, a housing block only the deliveries coming to it. Anything else, and nothing selected, shows none:
 * routine paths show only with a related block.
 */
export function routesFor(snapshot: Snapshot, selectedId: string | null): Route[] {
  const selected = snapshot.facilities.find((f) => f.id === selectedId);
  if (!selected) return [];
  const legs = snapshot.trucks.map((t) => legOf(snapshot, t)).filter((r): r is Route => r !== null);
  if (selected.kind === 'warehouse') return legs.filter((r) => r.warehouse === selected.id);
  if (selected.kind === 'farm' || selected.kind === 'housing') return legs.filter((r) => r.target === selected.id);
  return [];
}

/** The trucks by the cell they are in ("x,y"), so that two in one cell are drawn side by side. The idle ones wait in their warehouse's. */
export function trucksByCell(snapshot: Snapshot): Map<string, Truck[]> {
  const cells = new Map<string, Truck[]>();
  for (const t of snapshot.trucks) {
    const key = `${t.x},${t.y}`;
    cells.set(key, [...(cells.get(key) ?? []), t]);
  }
  return cells;
}

/** A truck on the map: its number, where it is going (→) or coming back from (←), and its load when it carries one. */
export function truckLabel(t: Truck): string {
  const where = t.status === 'idle' || t.targetId === null ? '' : `${t.status === 'outbound' ? '→' : '←'}${t.targetId}`;
  return `${t.id}${where}${t.load > 0 ? ` ${t.load}` : ''}`;
}

export type Tone = 'normal' | 'warn' | 'good';

/** What a facility's cell says under it. The plant says nothing: the top bar and its panel carry its numbers. */
export function cellCaption(f: FacilityView, overheatC: number): { text: string; tone: Tone } | null {
  if (f.condition === 'wrecked') return { text: '부서짐', tone: 'warn' };
  if (f.condition === 'repairing') return { text: `복구 중 ${f.repairHoursLeft ?? 0}시간`, tone: 'warn' };
  if (f.datacenter) {
    const d = f.datacenter;
    return { text: `${d.tempC}°C${d.processing ? ' ▲' : ''}${d.cooling ? ' ❄' : ''}`, tone: d.tempC >= overheatC ? 'warn' : 'normal' };
  }
  if (f.farm) return { text: `${f.farm.ripeness}% · ${f.farm.outbox}`, tone: f.farm.ripe ? 'good' : 'normal' };
  if (f.warehouse) return { text: `재고 ${f.warehouse.stock}`, tone: 'normal' };
  if (f.housing) return { text: `식량 ${f.housing.food}`, tone: f.housing.fed ? 'normal' : 'warn' };
  return null;
}

/**
 * What a consumer of the plant says on the map while the plant is selected, in two lines, one over the other: what it draws (loss
 * included) or, while it is shed, that it is cut off, and its priority. A line is shorter than a cell, so that consumers in
 * neighbouring cells never run into each other.
 */
export function consumerLabel(c: { demand: number; rank: number; shed: boolean }): readonly [string, string] {
  return [c.shed ? '정전' : `−${c.demand}`, `${c.rank}순위`];
}

/** The temperature from which the map shows a datacenter in amber: the scenario's overheat alert, in whole degrees. */
export function overheatCelsius(scenario: Scenario | null): number {
  return scenario ? Math.floor(scenario.tuning.datacenter.overheatAlertMilli / 1000) : 85;
}
