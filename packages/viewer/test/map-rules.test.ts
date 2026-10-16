import type { FacilityView, Scenario, Snapshot } from '@turing-city/core';
import { describe, expect, it } from 'vitest';
import { cellCaption, legOf, overheatCelsius, routesFor, truckLabel, trucksByCell } from '../src/map-rules.ts';

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
const town = (trucks: Truck[]): Snapshot =>
  ({
    facilities: [
      facility({ id: 'H1', kind: 'housing', x: 2, y: 1 }),
      facility({ id: 'W', kind: 'warehouse', x: 11, y: 6 }),
      facility({ id: 'F1', kind: 'farm', x: 2, y: 9 }),
      facility({ id: 'F2', kind: 'farm', x: 3, y: 9 }),
      facility({ id: 'P', kind: 'power', x: 4, y: 4 }),
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
});

describe('map rules: what a cell says', () => {
  it("says a datacenter's temperature, amber from the overheat threshold, and whether it is processing or cooling", () => {
    const dc = (tempC: number, processing = false, cooling = false) =>
      facility({ kind: 'datacenter', datacenter: { tempC, processing, cooling } });
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

  it('says nothing under the plant: the top bar and its panel carry its numbers', () => {
    expect(cellCaption(facility({ kind: 'power' }), 85)).toBeNull();
  });

  it('takes the overheat threshold from the scenario, in whole degrees, and 85 before the scenario is known', () => {
    expect(overheatCelsius({ tuning: { datacenter: { overheatAlertMilli: 80_500 } } } as unknown as Scenario)).toBe(80);
    expect(overheatCelsius(null)).toBe(85);
  });
});
