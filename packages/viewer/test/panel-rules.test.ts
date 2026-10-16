import type { FacilityView, LogView, Snapshot } from '@turing-city/core';
import { describe, expect, it } from 'vitest';
import {
  amountChoices,
  commButton,
  coolButton,
  datacenterGauge,
  dispatchAction,
  harvestButton,
  idleTrucks,
  installButton,
  logText,
  movedInPriority,
  processButton,
  rebuildButton,
  repairButton,
  sendButton,
  tripChoices,
  truckStatusLabel,
} from '../src/panel-rules.ts';

type Truck = Snapshot['trucks'][number];

const facility = (over: Partial<FacilityView>): FacilityView => ({
  id: 'DA',
  kind: 'datacenter',
  x: 5,
  y: 4,
  tier: 0,
  condition: 'ok',
  repairHoursLeft: null,
  powered: true,
  demand: 0,
  board: null,
  datacenter: { tempC: 30, processing: false, cooling: false, jobLeft: 0, coolLeft: 0 },
  farm: null,
  warehouse: null,
  housing: null,
  ...over,
});
const withBoard = (status: NonNullable<FacilityView['board']>['status'] = 'running'): FacilityView['board'] => ({
  status,
  powered: true,
  hasFirmware: false,
  erroring: false,
});
const truck = (over: Partial<Truck>): Truck => ({ warehouse: 'W', id: 1, x: 11, y: 6, status: 'idle', load: 0, targetId: null, ...over });

/** The small town as the panel reads it: money, prices, two farms, a housing block, the warehouse and its trucks. */
const snapshotWith = (money: number, facilities: FacilityView[] = [], trucks: Truck[] = []): Snapshot =>
  ({
    money,
    prices: {
      board: { farm: 200, warehouse: 400, power: 400, datacenter: 600 },
      comm: 300,
      repair: { farm: 150, warehouse: 300, power: 300, datacenter: 500 },
      repairHours: 12,
      rebuild: 500,
      rebuildHours: 12,
    },
    facilities,
    trucks,
  }) as unknown as Snapshot;

describe('panel rules: the hardware', () => {
  it('offers a board at T0 for its price, and not to housing or a facility that has one', () => {
    expect(installButton(snapshotWith(5000), facility({}))).toEqual({ label: '보드 설치 (600)', disabled: false, reason: null });
    expect(installButton(snapshotWith(5000), facility({ kind: 'farm', datacenter: null }))?.label).toBe('보드 설치 (200)');
    expect(installButton(snapshotWith(5000), facility({ kind: 'housing', datacenter: null }))).toBeNull();
    expect(installButton(snapshotWith(5000), facility({ tier: 1, board: withBoard() }))).toBeNull();
  });

  it('disables the board with the reason: too little money, or a wrecked facility', () => {
    expect(installButton(snapshotWith(450), facility({}))).toEqual({
      label: '보드 설치 (600)',
      disabled: true,
      reason: '자금이 모자라요 (필요 600, 보유 450)',
    });
    expect(installButton(snapshotWith(5000), facility({ condition: 'wrecked' }))?.reason).toBe('시설이 부서져 있어요. 먼저 복구하세요.');
    expect(installButton(snapshotWith(5000), facility({ condition: 'repairing' }))?.reason).toBe('시설을 복구하는 중이에요.');
  });

  it('offers a comm module at T1 only, and not while the board is down', () => {
    expect(commButton(snapshotWith(5000), facility({ tier: 1, board: withBoard() }))).toEqual({
      label: '통신 모듈 (300)',
      disabled: false,
      reason: null,
    });
    expect(commButton(snapshotWith(5000), facility({}))).toBeNull(); // T0
    expect(commButton(snapshotWith(5000), facility({ tier: 2, board: withBoard() }))).toBeNull(); // T2 already
    expect(commButton(snapshotWith(5000), facility({ tier: 1, board: withBoard('rebuilding') }))?.reason).toBe('보드가 부서져 있어요.');
    expect(commButton(snapshotWith(100), facility({ tier: 1, board: withBoard() }))?.disabled).toBe(true);
  });

  it('offers the repair of a wrecked facility, then the rebuild of its board once it stands', () => {
    const wrecked = facility({ tier: 1, condition: 'wrecked', board: withBoard('destroyed') });
    expect(repairButton(snapshotWith(5000), wrecked)).toEqual({ label: '시설 복구 (500 · 12시간)', disabled: false, reason: null });
    expect(rebuildButton(snapshotWith(5000), wrecked)).toBeNull(); // the facility first
    const repaired = facility({ tier: 1, board: withBoard('destroyed') });
    expect(repairButton(snapshotWith(5000), repaired)).toBeNull();
    expect(rebuildButton(snapshotWith(5000), repaired)).toEqual({ label: '보드 재건 (500 · 12시간)', disabled: false, reason: null });
    expect(rebuildButton(snapshotWith(499), repaired)?.reason).toBe('자금이 모자라요 (필요 500, 보유 499)');
    expect(repairButton(snapshotWith(5000), facility({ condition: 'repairing' }))).toBeNull();
  });
});

describe('panel rules: the hand', () => {
  it('lets the farm harvest only a ripe crop, and nothing while the farm is wrecked', () => {
    const farm = (ripeness: number, ripe: boolean, condition: FacilityView['condition'] = 'ok') =>
      facility({ kind: 'farm', datacenter: null, condition, farm: { ripeness, ripe, outbox: 0 } });
    expect(harvestButton(farm(100, true))).toEqual({ label: '수확', disabled: false, reason: null });
    expect(harvestButton(farm(64, false))).toEqual({ label: '수확', disabled: true, reason: '아직 익지 않았어요 (64%)' });
    expect(harvestButton(farm(100, true, 'wrecked')).disabled).toBe(true);
  });

  it('lets the datacenter process at any press, and cool only between cycles', () => {
    expect(processButton(facility({}))).toEqual({ label: '처리', disabled: false, reason: null });
    expect(processButton(facility({ condition: 'repairing' })).disabled).toBe(true);
    expect(coolButton(facility({}))).toEqual({ label: '냉각', disabled: false, reason: null });
    const coolingNow = { tempC: 70, processing: false, cooling: true, jobLeft: 0, coolLeft: 600 };
    expect(coolButton(facility({ datacenter: coolingNow }))).toEqual({
      label: '냉각 중…',
      disabled: true,
      reason: '냉각이 끝나면 다시 누를 수 있어요',
    });
    // Processing waits for the cycle: the game would refuse the press.
    expect(processButton(facility({ datacenter: coolingNow }))).toEqual({
      label: '처리',
      disabled: true,
      reason: '냉각하는 동안에는 처리할 수 없어요',
    });
    const working = { tempC: 70, processing: true, cooling: false, jobLeft: 450, coolLeft: 0 };
    // One gauge, for what runs now, filling up: 450 left of a job is 550 done.
    expect(datacenterGauge(facility({ datacenter: working }))).toEqual({ label: '처리', kind: 'job', done: 550 });
    expect(datacenterGauge(facility({ datacenter: coolingNow }))).toEqual({ label: '냉각', kind: 'cool', done: 400 });
    const idle = { tempC: 30, processing: false, cooling: false, jobLeft: 0, coolLeft: 0 };
    expect(datacenterGauge(facility({ datacenter: idle }))).toEqual({ label: '대기', kind: 'idle', done: 0 });
    expect(datacenterGauge(facility({ kind: 'farm', datacenter: null }))).toBeNull();
  });

  it("moves a facility up or down the plant's supply order, and leaves the order alone at its ends", () => {
    const order = ['H1', 'H2', 'DA', 'W'];
    expect(movedInPriority(order, 'DA', -1)).toEqual(['H1', 'DA', 'H2', 'W']);
    expect(movedInPriority(order, 'DA', 1)).toEqual(['H1', 'H2', 'W', 'DA']);
    expect(movedInPriority(order, 'H1', -1)).toEqual(order);
    expect(movedInPriority(order, 'W', 1)).toEqual(order);
  });
});

describe('panel rules: the truck form', () => {
  const town = (stock: number, trucks: Truck[]) =>
    snapshotWith(
      5000,
      [
        facility({ id: 'H1', kind: 'housing', datacenter: null, housing: { food: 7, residents: 40, fed: true } }),
        facility({ id: 'W', kind: 'warehouse', datacenter: null, warehouse: { stock } }),
        facility({ id: 'F1', kind: 'farm', datacenter: null, farm: { ripeness: 10, ripe: false, outbox: 24 } }),
        facility({ id: 'F2', kind: 'farm', datacenter: null, farm: { ripeness: 90, ripe: false, outbox: 0 } }),
      ],
      trucks,
    );
  const warehouse = (s: Snapshot): FacilityView => s.facilities.find((f) => f.id === 'W')!;

  it('offers to collect from every farm and to deliver to every housing block, saying what each holds', () => {
    expect(tripChoices(town(31, []), 'W')).toEqual([
      { trip: { kind: 'collect', target: 'F1' }, label: 'F1에서 회수 (출고함 24)', available: 24 },
      { trip: { kind: 'collect', target: 'F2' }, label: 'F2에서 회수 (출고함 0)', available: 0 },
      { trip: { kind: 'deliver', target: 'H1' }, label: 'H1에 전달 (식량 7)', available: 31 },
    ]);
  });

  it('lists the idle trucks of the warehouse, and offers amounts by tens up to the capacity', () => {
    const s = town(0, [truck({ id: 1 }), truck({ id: 2, status: 'outbound', targetId: 'F1' }), truck({ warehouse: 'W2', id: 3 })]);
    expect(idleTrucks(s, 'W')).toEqual([1]);
    expect(amountChoices(40)).toEqual([10, 20, 30, 40]);
    expect(amountChoices(24)).toEqual([10, 20, 24]);
  });

  it('sends only a complete, possible trip, and says what is missing', () => {
    const s = town(0, [truck({ id: 1 }), truck({ id: 2, status: 'returning', targetId: 'F1' })]);
    const w = warehouse(s);
    const reason = (draft: Parameters<typeof sendButton>[2]) => sendButton(s, w, draft).reason;
    expect(reason({ truck: null, trip: null, amount: null })).toBe('트럭을 고르세요');
    expect(reason({ truck: 2, trip: null, amount: null })).toBe('2번 트럭은 지금 나가 있어요');
    expect(reason({ truck: 1, trip: null, amount: null })).toBe('어디로 갈지 고르세요');
    expect(reason({ truck: 1, trip: { kind: 'collect', target: 'F1' }, amount: null })).toBe('얼마나 실을지 고르세요');
    expect(reason({ truck: 1, trip: { kind: 'deliver', target: 'H1' }, amount: 20 })).toBe('창고에 보낼 식량이 없어요');
    expect(sendButton(s, w, { truck: 1, trip: { kind: 'collect', target: 'F1' }, amount: 20 })).toEqual({
      label: '보내기',
      disabled: false,
      reason: null,
    });
  });

  it('turns a complete form into the dispatch the core takes: from a farm to the warehouse, or from the warehouse to housing', () => {
    expect(dispatchAction({ truck: 1, trip: { kind: 'collect', target: 'F1' }, amount: 20 }, 'W')).toEqual({
      kind: 'dispatch',
      truck: 1,
      from: 'F1',
      to: 'W',
      amount: 20,
    });
    expect(dispatchAction({ truck: 2, trip: { kind: 'deliver', target: 'H1' }, amount: 40 }, 'W')).toEqual({
      kind: 'dispatch',
      truck: 2,
      from: 'W',
      to: 'H1',
      amount: 40,
    });
    expect(dispatchAction({ truck: 1, trip: null, amount: 20 }, 'W')).toBeNull();
  });

  it('says what a truck is doing', () => {
    expect(truckStatusLabel(truck({}))).toBe('1번 트럭: 대기');
    expect(truckStatusLabel(truck({ status: 'outbound', targetId: 'F1' }))).toBe('1번 트럭: F1(으)로 가는 중');
    expect(truckStatusLabel(truck({ status: 'returning', targetId: 'F1', load: 24 }))).toBe('1번 트럭: F1에서 돌아오는 중 · 24 실음');
  });
});

describe('panel rules: the log', () => {
  it('copies the log oldest first, one line each, as the panel shows it', () => {
    const line = (seconds: number, kind: LogView['kind'], text: string, repeat = 1): LogView =>
      ({ day: 1, clock: `00:0${seconds}`, seconds, kind, text, repeat }) as LogView;
    expect(logText([line(1, 'system', 'board installed'), line(2, 'log', 'temp 31'), line(3, 'error', 'runtime: boom', 4)])).toBe(
      '1일 00:01  [system] board installed\n1일 00:02  temp 31\n1일 00:03  [error] runtime: boom ×4',
    );
  });
});
