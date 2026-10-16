import type { FacilityView, Snapshot } from '@turing-city/core';
import { describe, expect, it } from 'vitest';
import {
  ALERT_LABELS,
  consumersOf,
  endingLabel,
  firmwareLabel,
  heatAlpha,
  KIND_LABELS,
  ledOf,
  moneyLabel,
  populationLabel,
  sensorLabel,
  timeLabel,
} from '../src/format.ts';

const facility = (over: Partial<FacilityView>): FacilityView => ({
  id: 'DA',
  kind: 'datacenter',
  x: 5,
  y: 4,
  tier: 1,
  condition: 'ok',
  repairHoursLeft: null,
  powered: true,
  demand: 10,
  board: { status: 'running', powered: true, hasFirmware: true, erroring: false },
  datacenter: { tempC: 40, processing: false, cooling: false, jobLeft: 0, coolLeft: 0, lastPay: null },
  farm: null,
  warehouse: null,
  housing: null,
  ...over,
});
const board = (over: Partial<NonNullable<FacilityView['board']>>): FacilityView['board'] => ({
  status: 'running',
  powered: true,
  hasFirmware: true,
  erroring: false,
  ...over,
});

describe('format', () => {
  it('labels money and time', () => {
    expect(moneyLabel(12400)).toBe('12,400');
    expect(moneyLabel(-30)).toBe('-30');
    expect(timeLabel({ day: 7, clock: '14:20', seconds: 0 }, 30)).toBe('7일차 14:20 / 30일');
  });

  it('gives a light only to a facility with a board', () => {
    expect(ledOf(facility({ board: null, tier: 0 }))).toBeNull();
    expect(ledOf(facility({ kind: 'housing', board: null, tier: 0 }))).toBeNull();
  });

  it('picks a status light: destroyed, asleep, unpowered, error, no firmware, running', () => {
    expect(ledOf(facility({ board: board({ status: 'destroyed' }) }))).toBe('destroyed');
    expect(ledOf(facility({ board: board({ status: 'rebuilding' }) }))).toBe('destroyed');
    expect(ledOf(facility({ board: board({ status: 'asleep' }) }))).toBe('asleep');
    expect(ledOf(facility({ board: board({ powered: false }) }))).toBe('unpowered');
    expect(ledOf(facility({ board: board({ erroring: true }) }))).toBe('error');
    expect(ledOf(facility({ board: board({ hasFirmware: false }) }))).toBe('off');
    expect(ledOf(facility({}))).toBe('running');
  });

  it('shows a board as down with its wrecked or repairing facility, whatever its own state says', () => {
    expect(ledOf(facility({ condition: 'wrecked' }))).toBe('destroyed');
    expect(ledOf(facility({ condition: 'repairing', board: board({ status: 'destroyed' }) }))).toBe('destroyed');
  });

  // A board's last tick keeps its error after the board is smashed, put to sleep, or shed, so the states really do overlap.
  it('keeps that order when states overlap: each light wins over the ones after it', () => {
    const everythingWrong = { powered: false, erroring: true, hasFirmware: false };
    expect(ledOf(facility({ board: board({ ...everythingWrong, status: 'destroyed' }) }))).toBe('destroyed');
    expect(ledOf(facility({ board: board({ ...everythingWrong, status: 'asleep' }) }))).toBe('asleep');
    expect(ledOf(facility({ board: board(everythingWrong) }))).toBe('unpowered');
    expect(ledOf(facility({ board: board({ erroring: true, hasFirmware: false }) }))).toBe('error');
  });

  it('names the firmware a board runs and the deploy waiting to install on it', () => {
    expect(firmwareLabel(null, null)).toBe('펌웨어 없음');
    expect(firmwareLabel(2, null)).toBe('펌웨어 v2');
    expect(firmwareLabel(null, 1)).toBe('설치 대기 v1');
    expect(firmwareLabel(2, 3)).toBe('펌웨어 v2 · 설치 대기 v3');
  });

  it('shades the heatmap from 1 EMF up, capped', () => {
    expect(heatAlpha(0)).toBe(0);
    expect(heatAlpha(1)).toBeCloseTo(1 / 166, 5);
    expect(heatAlpha(50)).toBeCloseTo(0.3);
    expect(heatAlpha(10_000)).toBe(0.6);
  });

  it("lists the plant's consumers that draw power or are cut off, with draw, priority, and shedding, only when the plant is selected", () => {
    const snapshot = {
      facilities: [
        facility({ id: 'P', kind: 'power' }),
        facility({ id: 'H1', kind: 'housing', board: null, tier: 0, demand: 72 }),
        facility({ id: 'DA', demand: 163 }),
        facility({ id: 'F1', kind: 'farm', board: null, tier: 0, demand: 0 }), // draws nothing: not drawn
        facility({ id: 'DB', demand: 0 }), // cut off: drawn, though it asks for nothing now
      ],
      plant: { priority: ['H1', 'DA', 'F1', 'DB'], shed: ['DB'] },
    } as unknown as Snapshot;
    expect(consumersOf(snapshot, 'P')).toEqual([
      { id: 'H1', demand: 72, rank: 1, shed: false },
      { id: 'DA', demand: 163, rank: 2, shed: false },
      { id: 'DB', demand: 0, rank: 4, shed: true },
    ]);
    expect(consumersOf(snapshot, 'DA')).toBeNull();
    expect(consumersOf(snapshot, null)).toBeNull();
  });

  it('has a Korean name for every facility kind and every alert kind, and two endings', () => {
    expect(Object.values(KIND_LABELS)).toEqual(['발전소', '데이터센터', '밭', '물류창고', '주거지']);
    expect(ALERT_LABELS.wrecked).toBe('시설 파괴');
    expect(ALERT_LABELS.agentLost).toBe('에이전트 끊김');
    expect(ALERT_LABELS.hunger).toBe('굶주림');
    expect(endingLabel('completed')).toBe('시즌 완주');
    expect(endingLabel('bankrupt')).toBe('파산');
  });

  it('says how many people are fed, out of all, and names the hungry and those without power only when there are some', () => {
    expect(populationLabel({ fed: 80, hungry: 0, unpowered: 0 })).toBe('80/80');
    expect(populationLabel({ fed: 40, hungry: 40, unpowered: 0 })).toBe('40/80 · 굶주림 40');
    expect(populationLabel({ fed: 0, hungry: 40, unpowered: 40 })).toBe('0/80 · 굶주림 40 · 정전 40');
  });

  it('shows a sensor value: numbers rounded, nil for none, strings as they are, lists one item a line', () => {
    expect(sensorLabel(81.256)).toBe('81.26');
    expect(sensorLabel(undefined)).toBe('nil');
    expect(sensorLabel('idle')).toBe('idle');
    expect(
      sensorLabel([
        { id: 'F1', outbox: 12, distance: 12 },
        { id: 'F2', outbox: 0, distance: 11 },
      ]),
    ).toBe('id=F1 outbox=12 distance=12\nid=F2 outbox=0 distance=11');
  });
});
