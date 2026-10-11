import {
  FACILITY_KINDS,
  type FacilityView,
  NullHost,
  parseScenario,
  type Scenario,
  Session,
  type Snapshot,
  snapshot,
} from '@turing-city/core';
import { describe, expect, it } from 'vitest';
import townJson from '../../../scenarios/m2-town.json' with { type: 'json' };
import {
  type Cell,
  cellCaption,
  consumerLabel,
  FACILITY_COLORS,
  legOf,
  overheatCelsius,
  type Route,
  routesFor,
  truckLabel,
  trucksByCell,
} from '../src/map-rules.ts';

type Truck = Snapshot['trucks'][number];

const facility = (over: Partial<FacilityView>): FacilityView => ({
  id: 'X',
  kind: 'farm',
  x: 0,
  y: 0,
  tier: 0,
  condition: 'ok',
  repairHoursLeft: null,
  powered: true,
  demand: 0,
  board: null,
  datacenter: null,
  farm: null,
  warehouse: null,
  housing: null,
  ...over,
});
const truck = (over: Partial<Truck>): Truck => ({ warehouse: 'W', id: 1, x: 11, y: 6, status: 'idle', load: 0, targetId: null, ...over });

/** The small town's warehouse, two farms and a housing block, at their places in m2-town.json. */
const town = (trucks: Truck[], more: FacilityView[] = []): Snapshot =>
  ({
    facilities: [
      facility({ id: 'H1', kind: 'housing', x: 2, y: 1 }),
      facility({ id: 'W', kind: 'warehouse', x: 11, y: 6 }),
      facility({ id: 'F1', kind: 'farm', x: 2, y: 9 }),
      facility({ id: 'F2', kind: 'farm', x: 3, y: 9 }),
      facility({ id: 'P', kind: 'power', x: 4, y: 4 }),
      ...more,
    ],
    trucks,
  }) as unknown as Snapshot;

describe('map rules: truck routes', () => {
  it('draws an outbound leg from the warehouse to the target, along the row first and then the column', () => {
    const route = legOf(town([]), truck({ status: 'outbound', targetId: 'F1', x: 9, y: 6 }));
    expect(route).toMatchObject({ warehouse: 'W', truck: 1, target: 'F1', kind: 'collect', status: 'outbound' });
    expect(route?.cells[0]).toEqual([11, 6]);
    expect(route?.cells[1]).toEqual([10, 6]); // the row first
    expect(route?.cells.at(-1)).toEqual([2, 9]);
    expect(route?.cells).toHaveLength(1 + 9 + 3);
  });

  it('draws a returning leg from the target back to the warehouse, again along the row first', () => {
    const route = legOf(town([]), truck({ status: 'returning', targetId: 'H1', x: 2, y: 1 }));
    expect(route).toMatchObject({ target: 'H1', kind: 'deliver', status: 'returning' });
    expect(route?.cells[0]).toEqual([2, 1]);
    expect(route?.cells[1]).toEqual([3, 1]);
    expect(route?.cells.at(-1)).toEqual([11, 6]);
  });

  it('has no leg for an idle truck', () => {
    expect(legOf(town([]), truck({}))).toBeNull();
  });

  it('has no leg for a truck whose warehouse or target is not on the map', () => {
    expect(legOf(town([]), truck({ status: 'outbound', targetId: 'ZZ' }))).toBeNull();
    expect(legOf(town([]), truck({ warehouse: 'ZZ', status: 'outbound', targetId: 'F1' }))).toBeNull();
  });

  it('shows the warehouse every route its trucks are on, a farm only the trucks collecting from it, housing only the deliveries to it', () => {
    const trucks = [
      truck({ id: 1, status: 'outbound', targetId: 'F1', x: 8, y: 6 }),
      truck({ id: 2, status: 'returning', targetId: 'H1', x: 4, y: 1 }),
    ];
    const s = town(trucks);
    expect(routesFor(s, 'W').map((r) => r.truck)).toEqual([1, 2]);
    expect(routesFor(s, 'F1').map((r) => r.truck)).toEqual([1]);
    expect(routesFor(s, 'F2')).toEqual([]);
    expect(routesFor(s, 'H1').map((r) => r.truck)).toEqual([2]);
    expect(routesFor(s, 'P')).toEqual([]); // the plant draws its consumers instead (format.consumersOf)
    expect(routesFor(s, null)).toEqual([]);
  });

  it("leaves out the idle trucks and another warehouse's trucks, and shows a datacenter no routes", () => {
    const s = town(
      [
        truck({ id: 1, status: 'outbound', targetId: 'F1', x: 8, y: 6 }),
        truck({ id: 2 }), // idle in W
        truck({ warehouse: 'W2', id: 1, status: 'outbound', targetId: 'H1', x: 14, y: 2 }),
      ],
      [facility({ id: 'W2', kind: 'warehouse', x: 15, y: 2 }), facility({ id: 'DA', kind: 'datacenter', x: 5, y: 4 })],
    );
    expect(routesFor(s, 'W').map((r) => [r.warehouse, r.truck])).toEqual([['W', 1]]);
    expect(routesFor(s, 'W2').map((r) => [r.warehouse, r.truck])).toEqual([['W2', 1]]);
    expect(routesFor(s, 'DA')).toEqual([]);
  });

  it('groups the trucks by cell, so that two in one cell are drawn side by side', () => {
    const cells = trucksByCell(
      town([truck({ id: 1 }), truck({ id: 2 }), truck({ id: 3, x: 5, y: 6, status: 'outbound', targetId: 'F1' })]),
    );
    expect(cells.get('11,6')?.map((t) => t.id)).toEqual([1, 2]);
    expect(cells.get('5,6')?.map((t) => t.id)).toEqual([3]);
  });

  it('labels a truck by its number, where it is going, and its load', () => {
    expect(truckLabel(truck({}))).toBe('1');
    expect(truckLabel(truck({ status: 'outbound', targetId: 'F1' }))).toBe('1→F1');
    expect(truckLabel(truck({ status: 'returning', targetId: 'F1', load: 24 }))).toBe('1←F1 24');
  });

  it('labels a truck that carries a load on its way out too', () => {
    expect(truckLabel(truck({ status: 'outbound', targetId: 'H1', load: 30 }))).toBe('1→H1 30');
  });
});

describe('map rules: what a cell says', () => {
  const dc = (tempC: number, processing = false, cooling = false) =>
    facility({ kind: 'datacenter', datacenter: { tempC, processing, cooling } });

  it("says a datacenter's temperature, amber from the overheat threshold, and whether it is processing or cooling", () => {
    expect(cellCaption(dc(40), 85)).toEqual({ text: '40°C', tone: 'normal' });
    expect(cellCaption(dc(85, true), 85)).toEqual({ text: '85°C ▲', tone: 'warn' });
    expect(cellCaption(dc(60, false, true), 85)).toEqual({ text: '60°C ❄', tone: 'normal' });
  });

  it("says a farm's ripeness and outbox, good when it is ripe", () => {
    expect(cellCaption(facility({ farm: { ripeness: 40, ripe: false, outbox: 0 } }), 85)).toEqual({ text: '40% · 0', tone: 'normal' });
    expect(cellCaption(facility({ farm: { ripeness: 100, ripe: true, outbox: 24 } }), 85)).toEqual({ text: '100% · 24', tone: 'good' });
  });

  it("says a warehouse's stock and a housing block's food, warning when its people go hungry", () => {
    expect(cellCaption(facility({ kind: 'warehouse', warehouse: { stock: 31 } }), 85)).toEqual({ text: '재고 31', tone: 'normal' });
    expect(cellCaption(facility({ kind: 'housing', housing: { food: 0, residents: 40, fed: false } }), 85)).toEqual({
      text: '식량 0',
      tone: 'warn',
    });
  });

  it('says a wrecked or repairing facility is so, whatever else it is', () => {
    const wrecked = facility({ kind: 'datacenter', condition: 'wrecked', datacenter: { tempC: 92, processing: false, cooling: false } });
    expect(cellCaption(wrecked, 85)).toEqual({ text: '부서짐', tone: 'warn' });
    expect(cellCaption(facility({ condition: 'repairing', repairHoursLeft: 7 }), 85)).toEqual({ text: '복구 중 7시간', tone: 'warn' });
  });

  it('says a wrecked or repairing facility is so, whatever readings its kind has', () => {
    const readings: Array<Partial<FacilityView>> = [
      { kind: 'datacenter', datacenter: { tempC: 25, processing: false, cooling: false } },
      { kind: 'farm', farm: { ripeness: 0, ripe: false, outbox: 12 } },
      { kind: 'warehouse', warehouse: { stock: 31 } },
      { kind: 'housing', housing: { food: 5, residents: 40, fed: true } },
    ];
    for (const r of readings) {
      expect(cellCaption(facility({ ...r, condition: 'wrecked' }), 85)).toEqual({ text: '부서짐', tone: 'warn' });
      expect(cellCaption(facility({ ...r, condition: 'repairing', repairHoursLeft: 3 }), 85)).toEqual({
        text: '복구 중 3시간',
        tone: 'warn',
      });
    }
  });

  it('says a datacenter is both processing and cooling when it is', () => {
    expect(cellCaption(dc(70, true, true), 85)).toEqual({ text: '70°C ▲ ❄', tone: 'normal' });
  });

  it('turns a datacenter amber at the threshold it is given, and not a degree before', () => {
    expect(cellCaption(dc(84), 85)?.tone).toBe('normal');
    expect(cellCaption(dc(79), 80)?.tone).toBe('normal');
    expect(cellCaption(dc(80), 80)?.tone).toBe('warn');
  });

  it('says nothing is wrong with a housing block that has eaten', () => {
    expect(cellCaption(facility({ kind: 'housing', housing: { food: 120, residents: 40, fed: true } }), 85)).toEqual({
      text: '식량 120',
      tone: 'normal',
    });
  });

  it('says nothing under the plant: the top bar and its panel carry its numbers', () => {
    expect(cellCaption(facility({ kind: 'power' }), 85)).toBeNull();
  });

  it('takes the overheat threshold from the scenario, in whole degrees, and 85 before the scenario is known', () => {
    expect(overheatCelsius({ tuning: { datacenter: { overheatAlertMilli: 80_500 } } } as unknown as Scenario)).toBe(80);
    expect(overheatCelsius(null)).toBe(85);
  });
});

describe("map rules: what the plant's consumers say", () => {
  it('says what a consumer draws and its priority, one line each', () => {
    expect(consumerLabel({ demand: 77, rank: 1, shed: false })).toEqual(['−77', '1순위']);
    expect(consumerLabel({ demand: 163, rank: 12, shed: false })).toEqual(['−163', '12순위']);
  });

  it('says a shed consumer is cut off in place of its draw, and still gives its priority', () => {
    expect(consumerLabel({ demand: 77, rank: 4, shed: true })).toEqual(['정전', '4순위']);
  });
});

describe('map rules: the colours', () => {
  it('gives every kind of facility a colour of its own', () => {
    expect(Object.keys(FACILITY_COLORS).sort()).toEqual([...FACILITY_KINDS].sort());
    expect(new Set(Object.values(FACILITY_COLORS)).size).toBe(FACILITY_KINDS.length);
  });
});

describe('map rules: the legs the core drives', () => {
  /** Sends truck 1 by hand, steps the real core until it stands idle again, and keeps the cells it stood in and the legs drawn for it. */
  function trip(s: Session, from: string, to: string): { visited: Cell[]; legs: Route[] } {
    expect(s.hand('W', { kind: 'dispatch', truck: 1, from, to, amount: 10 })).toEqual({ ok: true });
    const visited: Cell[] = [];
    const legs: Route[] = [];
    for (let i = 0; i < 3_000; i++) {
      const snap = snapshot(s.ctx);
      const t = snap.trucks.find((candidate) => candidate.id === 1)!;
      const last = visited.at(-1);
      if (!last || last[0] !== t.x || last[1] !== t.y) visited.push([t.x, t.y]);
      const leg = legOf(snap, t);
      if (leg === null) return { visited, legs };
      const drawn = legs.at(-1);
      if (drawn?.status === leg.status) {
        expect(leg.cells).toEqual(drawn.cells); // the line stays put while the truck moves along it
      } else {
        legs.push(leg);
      }
      s.step();
    }
    throw new Error('the truck never got home');
  }

  it('draws the cells a real truck drives, out along one L and back along another, for a collection and a delivery', () => {
    const s = new Session(parseScenario(townJson), 1, new NullHost());
    for (let i = 0; i < 5_000 && !snapshot(s.ctx).facilities.find((f) => f.id === 'F1')?.farm?.ripe; i++) s.step();
    expect(s.hand('F1', { kind: 'harvest' })).toEqual({ ok: true });

    for (const [from, to, kind] of [
      ['F1', 'W', 'collect'],
      ['W', 'H1', 'deliver'],
    ] as const) {
      const { visited, legs } = trip(s, from, to);
      expect(legs.map((l) => [l.kind, l.status])).toEqual([
        [kind, 'outbound'],
        [kind, 'returning'],
      ]);
      // The whole trip: the outbound leg, then the returning one from the cell the first ended in.
      expect(visited).toEqual([...legs[0]!.cells, ...legs[1]!.cells.slice(1)]);
    }
  });
});
