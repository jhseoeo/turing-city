import type { FacilityView, LogView, Snapshot } from '@turing-city/core';
import { describe, expect, it } from 'vitest';
import {
  amountChoices,
  commButton,
  coolButton,
  datacenterStatus,
  dispatchAction,
  harvestButton,
  idleTrucks,
  installButton,
  logText,
  movedInPriority,
  processButton,
  ramLabel,
  readings,
  rebuildButton,
  repairButton,
  sendButton,
  tripChoices,
  truckStatusLabel,
} from '../src/panel-rules.ts';
import type { DispatchTrip } from '../src/store.ts';

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
  datacenter: { tempC: 30, processing: false, cooling: false },
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
    jobPrice: 40,
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

  it('opens each purchase at exactly its price', () => {
    expect(installButton(snapshotWith(600), facility({}))?.disabled).toBe(false);
    expect(installButton(snapshotWith(599), facility({}))?.disabled).toBe(true);
    expect(commButton(snapshotWith(300), facility({ tier: 1, board: withBoard() }))?.disabled).toBe(false);
    expect(commButton(snapshotWith(299), facility({ tier: 1, board: withBoard() }))?.disabled).toBe(true);
    const wrecked = facility({ tier: 1, condition: 'wrecked', board: withBoard('destroyed') });
    expect(repairButton(snapshotWith(500), wrecked)?.disabled).toBe(false);
    expect(repairButton(snapshotWith(499), wrecked)).toEqual({
      label: '시설 복구 (500 · 12시간)',
      disabled: true,
      reason: '자금이 모자라요 (필요 500, 보유 499)',
    });
    expect(rebuildButton(snapshotWith(500), facility({ tier: 1, board: withBoard('destroyed') }))?.disabled).toBe(false);
  });

  it('prices the repair by the kind of facility, and offers none for housing', () => {
    const wreck = (kind: FacilityView['kind']) => facility({ kind, condition: 'wrecked', datacenter: null });
    expect(repairButton(snapshotWith(5000), wreck('farm'))?.label).toBe('시설 복구 (150 · 12시간)');
    expect(repairButton(snapshotWith(5000), wreck('warehouse'))?.label).toBe('시설 복구 (300 · 12시간)');
    expect(repairButton(snapshotWith(5000), wreck('power'))?.label).toBe('시설 복구 (300 · 12시간)');
    expect(repairButton(snapshotWith(5000), wreck('datacenter'))?.label).toBe('시설 복구 (500 · 12시간)');
    expect(repairButton(snapshotWith(5000), wreck('housing'))).toBeNull();
  });

  it('offers the board rebuild only once its facility stands: not while it is wrecked, and not while it is being repaired', () => {
    const destroyed = (condition: FacilityView['condition']) => facility({ tier: 1, condition, board: withBoard('destroyed') });
    expect(rebuildButton(snapshotWith(5000), destroyed('wrecked'))).toBeNull();
    expect(rebuildButton(snapshotWith(5000), destroyed('repairing'))).toBeNull();
    expect(rebuildButton(snapshotWith(5000), destroyed('ok'))?.disabled).toBe(false);
    // A board that stands or is being rebuilt, and a facility with no board, have nothing to rebuild.
    for (const status of ['running', 'asleep', 'rebuilding'] as const) {
      expect(rebuildButton(snapshotWith(5000), facility({ tier: 1, board: withBoard(status) }))).toBeNull();
    }
    expect(rebuildButton(snapshotWith(5000), facility({}))).toBeNull();
  });

  it('puts a facility that is down ahead of too little money, and treats a sleeping board as one that runs', () => {
    expect(installButton(snapshotWith(0), facility({ condition: 'wrecked' }))?.reason).toBe('시설이 부서져 있어요. 먼저 복구하세요.');
    // A facility that is down takes no comm module whatever its board says; a board that sleeps takes one.
    const down = facility({ tier: 1, condition: 'wrecked', board: withBoard('running') });
    expect(commButton(snapshotWith(5000), down)?.reason).toBe('보드가 부서져 있어요.');
    expect(commButton(snapshotWith(5000), facility({ tier: 1, board: withBoard('asleep') }))?.disabled).toBe(false);
  });

  it('offers no comm module for a board that is destroyed, even though its facility stands again', () => {
    const repaired = facility({ tier: 1, board: withBoard('destroyed') });
    expect(commButton(snapshotWith(5000), repaired)).toEqual({ label: '통신 모듈 (300)', disabled: true, reason: '보드가 부서져 있어요.' });
  });

  it('names the hours of each payment: the repair its own, the rebuild its own', () => {
    const s = snapshotWith(5000);
    const own = { ...s, prices: { ...s.prices, repairHours: 12, rebuildHours: 8 } } as Snapshot;
    expect(repairButton(own, facility({ tier: 1, condition: 'wrecked', board: withBoard('destroyed') }))?.label).toBe(
      '시설 복구 (500 · 12시간)',
    );
    expect(rebuildButton(own, facility({ tier: 1, board: withBoard('destroyed') }))?.label).toBe('보드 재건 (500 · 8시간)');
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
    expect(coolButton(facility({ datacenter: { tempC: 70, processing: true, cooling: true } }))).toEqual({
      label: '냉각 중…',
      disabled: true,
      reason: '냉각이 끝나면 다시 누를 수 있어요',
    });
  });

  it('lets a datacenter cool while it processes, and process while it cools: the two run side by side', () => {
    expect(coolButton(facility({ datacenter: { tempC: 70, processing: true, cooling: false } })).disabled).toBe(false);
    expect(processButton(facility({ datacenter: { tempC: 70, processing: false, cooling: true } })).disabled).toBe(false);
  });

  it("moves a facility up or down the plant's supply order, and leaves the order alone at its ends", () => {
    const order = ['H1', 'H2', 'DA', 'W'];
    expect(movedInPriority(order, 'DA', -1)).toEqual(['H1', 'DA', 'H2', 'W']);
    expect(movedInPriority(order, 'DA', 1)).toEqual(['H1', 'H2', 'W', 'DA']);
    expect(movedInPriority(order, 'H1', -1)).toEqual(order);
    expect(movedInPriority(order, 'W', 1)).toEqual(order);
  });

  it('moves a facility into the first place, and leaves the order alone for an id it does not hold', () => {
    const order = ['H1', 'H2', 'DA', 'W'];
    expect(movedInPriority(order, 'H2', -1)).toEqual(['H2', 'H1', 'DA', 'W']);
    expect(movedInPriority(order, 'ZZ', 1)).toEqual(order);
    expect(movedInPriority(order, 'ZZ', -1)).toEqual(order);
    expect(order).toEqual(['H1', 'H2', 'DA', 'W']); // the given order is never changed
  });

  it('tells a wrecked facility, which waits for the player to repair it, from one being repaired, which waits for its repair', () => {
    const wrecked = '시설이 부서져 있어요. 먼저 복구하세요.';
    const repairing = '시설을 복구하는 중이에요. 끝나면 할 수 있어요.';
    const farm = (condition: FacilityView['condition']) =>
      facility({ kind: 'farm', datacenter: null, condition, farm: { ripeness: 0, ripe: false, outbox: 0 } });
    expect(installButton(snapshotWith(5000), facility({ condition: 'wrecked' }))?.reason).toBe(wrecked);
    expect(installButton(snapshotWith(5000), facility({ condition: 'repairing' }))?.reason).toBe(repairing);
    expect(harvestButton(farm('wrecked')).reason).toBe(wrecked);
    expect(harvestButton(farm('repairing')).reason).toBe(repairing);
    expect(processButton(facility({ condition: 'wrecked' })).reason).toBe(wrecked);
    expect(processButton(facility({ condition: 'repairing' })).reason).toBe(repairing);
    expect(coolButton(facility({ condition: 'wrecked' })).reason).toBe(wrecked);
    expect(coolButton(facility({ condition: 'repairing' })).reason).toBe(repairing);
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

  it('lists every idle truck of the warehouse, in order', () => {
    const s = town(0, [truck({ id: 1 }), truck({ id: 2 }), truck({ id: 3, status: 'returning', targetId: 'F1' })]);
    expect(idleTrucks(s, 'W')).toEqual([1, 2]);
    expect(idleTrucks(s, 'W2')).toEqual([]);
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

  it('sends no dispatch for a form that is not complete, and carries the amount it holds', () => {
    const collect: DispatchTrip = { kind: 'collect', target: 'F1' };
    expect(dispatchAction({ truck: null, trip: collect, amount: 20 }, 'W')).toBeNull();
    expect(dispatchAction({ truck: 1, trip: collect, amount: null }, 'W')).toBeNull();
    expect(dispatchAction({ truck: 2, trip: collect, amount: 15 }, 'W')).toEqual({
      kind: 'dispatch',
      truck: 2,
      from: 'F1',
      to: 'W',
      amount: 15,
    });
    expect(dispatchAction({ truck: 2, trip: { kind: 'deliver', target: 'H1' }, amount: 15 }, 'W')).toEqual({
      kind: 'dispatch',
      truck: 2,
      from: 'W',
      to: 'H1',
      amount: 15,
    });
  });

  it('says what a truck is doing', () => {
    expect(truckStatusLabel(truck({}))).toBe('1번 트럭: 대기');
    expect(truckStatusLabel(truck({ status: 'outbound', targetId: 'F1' }))).toBe('1번 트럭: F1(으)로 가는 중');
    expect(truckStatusLabel(truck({ status: 'returning', targetId: 'F1', load: 24 }))).toBe('1번 트럭: F1에서 돌아오는 중 · 24 실음');
    // A delivery carries its load out.
    expect(truckStatusLabel(truck({ status: 'outbound', targetId: 'H1', load: 20 }))).toBe('1번 트럭: H1(으)로 가는 중 · 20 실음');
  });

  it('says that no truck is idle, whatever the form holds, when every truck is out or there are none', () => {
    const out = [truck({ id: 1, status: 'outbound', targetId: 'F1' }), truck({ id: 2, status: 'returning', targetId: 'F1', load: 24 })];
    const reason = '대기 중인 트럭이 없어요';
    for (const trucks of [out, []]) {
      const s = town(40, trucks);
      expect(sendButton(s, warehouse(s), { truck: null, trip: null, amount: null })).toEqual({ label: '보내기', disabled: true, reason });
      const complete = { truck: 1, trip: { kind: 'collect', target: 'F1' }, amount: 20 } as const;
      expect(sendButton(s, warehouse(s), complete)).toEqual({ label: '보내기', disabled: true, reason });
    }
  });

  it('sends a delivery only when the warehouse holds a whole unit to load, and a collection whatever it holds', () => {
    const send = (stock: number, trip: DispatchTrip) => {
      const s = town(stock, [truck({ id: 1 })]);
      return sendButton(s, warehouse(s), { truck: 1, trip, amount: 20 });
    };
    const deliver: DispatchTrip = { kind: 'deliver', target: 'H1' };
    expect(send(0, deliver)).toEqual({ label: '보내기', disabled: true, reason: '창고에 보낼 식량이 없어요' });
    expect(send(1, deliver)).toEqual({ label: '보내기', disabled: false, reason: null });
    expect(send(0, { kind: 'collect', target: 'F1' })).toEqual({ label: '보내기', disabled: false, reason: null });
  });

  it('says that a delivery has nothing to load as soon as it is picked, before it asks how much', () => {
    const empty = town(0, [truck({ id: 1 })]);
    const stocked = town(5, [truck({ id: 1 })]);
    const deliver: DispatchTrip = { kind: 'deliver', target: 'H1' };
    expect(sendButton(empty, warehouse(empty), { truck: 1, trip: deliver, amount: null }).reason).toBe('창고에 보낼 식량이 없어요');
    // A collection needs no stock, and a delivery with food in stock asks how much.
    expect(sendButton(empty, warehouse(empty), { truck: 1, trip: { kind: 'collect', target: 'F1' }, amount: null }).reason).toBe(
      '얼마나 실을지 고르세요',
    );
    expect(sendButton(stocked, warehouse(stocked), { truck: 1, trip: deliver, amount: null }).reason).toBe('얼마나 실을지 고르세요');
  });

  it('does not send from a warehouse that is down, even with a form that is complete and possible', () => {
    const s = town(40, [truck({ id: 1 })]);
    const complete = { truck: 1, trip: { kind: 'collect', target: 'F1' }, amount: 20 } as const;
    const down = (condition: FacilityView['condition']): FacilityView => ({ ...warehouse(s), condition });
    expect(sendButton(s, warehouse(s), complete).disabled).toBe(false);
    expect(sendButton(s, down('wrecked'), complete)).toEqual({
      label: '보내기',
      disabled: true,
      reason: '시설이 부서져 있어요. 먼저 복구하세요.',
    });
    expect(sendButton(s, down('repairing'), complete).reason).toBe('시설을 복구하는 중이에요. 끝나면 할 수 있어요.');
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

describe('panel rules: the readings', () => {
  const read = (f: FacilityView) => readings(snapshotWith(0), f);
  const farm = (over: Partial<FacilityView> = {}) =>
    facility({ id: 'F1', kind: 'farm', datacenter: null, farm: { ripeness: 64, ripe: false, outbox: 12 }, ...over });
  const DOWN = ['wrecked', 'repairing'] as const;

  it("reads a standing datacenter's temperature, ambient included, and what it is doing", () => {
    expect(read(facility({ datacenter: { tempC: 25, processing: false, cooling: false } }))).toEqual([
      ['온도', '25°C'],
      ['단가', '40/초'],
      ['상태', '대기'],
      ['전력', '0 사용'],
    ]);
    expect(read(facility({ demand: 408, datacenter: { tempC: 70, processing: true, cooling: true } }))).toEqual([
      ['온도', '70°C'],
      ['단가', '40/초'],
      ['상태', '처리 중 · 냉각 중'],
      ['전력', '408 사용'],
    ]);
  });

  it('says a job the grid does not power has stopped, not that the datacenter waits', () => {
    // The press asked for power (demand) and the grid shed it: no income and no heat, which a plain 대기 would hide.
    const shed = facility({ demand: 153, powered: false, datacenter: { tempC: 25, processing: false, cooling: false } });
    expect(read(shed)).toContainEqual(['상태', '멈춤 (정전)']);
    expect(read(shed)).toContainEqual(['전력', '153 사용 (끊김)']);
  });

  it('keeps the same rows whatever the datacenter does, so that nothing under them moves', () => {
    const keys = (f: FacilityView) => read(f).map(([k]) => k);
    const idle = keys(facility({ datacenter: { tempC: 25, processing: false, cooling: false } }));
    expect(keys(facility({ demand: 153, datacenter: { tempC: 40, processing: true, cooling: false } }))).toEqual(idle);
    expect(keys(facility({ demand: 153, powered: false, datacenter: { tempC: 40, processing: false, cooling: false } }))).toEqual(idle);
  });

  it("hides a datacenter's temperature while its facility is down, whatever the snapshot reads, and keeps what it is doing", () => {
    // A down facility reads ambient (25), but 25 is a real reading of one that stands: the rule follows the condition, not the value.
    for (const condition of DOWN) {
      for (const tempC of [25, 70]) {
        const rows = read(facility({ condition, powered: false, datacenter: { tempC, processing: false, cooling: false } }));
        expect(rows).toEqual([
          ['단가', '40/초'],
          ['상태', '대기'],
          ['전력', '0 사용'],
        ]);
      }
    }
  });

  it("reads a standing farm's crop, a crop of 0% included, and its outbox", () => {
    expect(read(farm())).toEqual([
      ['익음', '64%'],
      ['출고함', '12'],
      ['전력', '0 사용'],
    ]);
    expect(read(farm({ farm: { ripeness: 100, ripe: true, outbox: 0 } })).slice(0, 2)).toEqual([
      ['익음', '100% (수확 가능)'],
      ['출고함', '0'],
    ]);
    expect(read(farm({ farm: { ripeness: 0, ripe: false, outbox: 40 } })).slice(0, 2)).toEqual([
      ['익음', '0%'],
      ['출고함', '40'],
    ]);
  });

  it("hides a farm's crop while its facility is down, whatever the snapshot reads, and keeps its outbox", () => {
    for (const condition of DOWN) {
      for (const crop of [
        { ripeness: 0, ripe: false },
        { ripeness: 100, ripe: true },
      ]) {
        expect(read(farm({ condition, powered: false, farm: { ...crop, outbox: 12 } }))).toEqual([
          ['출고함', '12'],
          ['전력', '0 사용'],
        ]);
      }
    }
  });

  it("keeps a warehouse's stock and a housing block's food through a wreck", () => {
    for (const condition of ['ok', ...DOWN] as const) {
      expect(read(facility({ id: 'W', kind: 'warehouse', datacenter: null, condition, warehouse: { stock: 31 } }))).toEqual([
        ['재고', '31'],
        ['전력', '0 사용'],
      ]);
      const home = facility({ id: 'H1', kind: 'housing', datacenter: null, condition, housing: { food: 7, residents: 40, fed: true } });
      expect(read({ ...home, powered: true })).toEqual([
        ['주민', '40명'],
        ['식량', '7'],
        ['상태', '먹음 · 전기 있음'],
        ['전력', '0 사용'],
      ]);
    }
  });

  it('reads a housing block that is hungry and without power, and what a facility draws from the grid', () => {
    const home = facility({ id: 'H1', kind: 'housing', datacenter: null, housing: { food: 0, residents: 40, fed: false } });
    expect(read({ ...home, powered: false, demand: 70 })).toEqual([
      ['주민', '40명'],
      ['식량', '0'],
      ['상태', '굶주림 · 정전'],
      ['전력', '70 사용 (끊김)'],
    ]);
    expect(read({ ...home, powered: true, demand: 70 }).at(-1)).toEqual(['전력', '70 사용']);
    expect(read(facility({ demand: 0 })).at(-1)).toEqual(['전력', '0 사용']); // there at 0 too, so that nothing under it moves
  });

  it("reads the plant's wind, thermal output, fuel price, and generation against demand, and no draw of its own", () => {
    const plant = { wind: 120, thermal: 80, thermalMax: 300, fuelPrice: 3, generation: 200, demand: 180, shed: [], priority: [] };
    const s = { ...snapshotWith(0), plant } as unknown as Snapshot;
    expect(readings(s, facility({ id: 'P', kind: 'power', datacenter: null, demand: 50 }))).toEqual([
      ['풍력', '120'],
      ['화력', '80 / 300'],
      ['연료비', '3/단위·일'],
      ['발전 / 수요', '200 / 180'],
    ]);
  });
});

describe("panel rules: the board's RAM", () => {
  const parts = { clockHz: 1000, instructionsPerTick: 5000, ramBytes: 65_536, ramUsedBytes: 12_288 };
  const board = (status: NonNullable<FacilityView['board']>['status']) => facility({ tier: 1, board: withBoard(status) });

  it('gives the RAM in use only while the board runs', () => {
    expect(ramLabel(parts, board('running'))).toBe('64KB (사용 12.0KB)');
    // A sleep wipes the RAM, a wreck destroys it, and neither clears the number the last tick left.
    for (const status of ['asleep', 'destroyed', 'rebuilding'] as const) expect(ramLabel(parts, board(status))).toBe('64KB');
  });

  it('reads a running board that has not ticked yet as using none', () => {
    expect(ramLabel({ ...parts, ramUsedBytes: null }, board('running'))).toBe('64KB (사용 0.0KB)');
  });
});

describe("panel rules: the datacenter's status line", () => {
  const status = (f: FacilityView) => datacenterStatus(snapshotWith(0), f, 0.5);
  const dc = (over: Partial<NonNullable<FacilityView['datacenter']>> = {}) => ({ tempC: 30, processing: false, cooling: false, ...over });

  it('says what a press does and what it pays while the datacenter waits', () => {
    expect(status(facility({ datacenter: dc() }))).toEqual({ text: '누를 때마다 0.5초 처리해요 · 지금 단가 40/초', tone: 'dim' });
  });

  it('says the job runs and what it earns, cooling too', () => {
    expect(status(facility({ demand: 153, datacenter: dc({ processing: true }) }))).toEqual({ text: '처리 중 · 초당 +40', tone: 'ok' });
    expect(status(facility({ demand: 408, datacenter: dc({ processing: true, cooling: true }) })).text).toBe(
      '처리 중 · 초당 +40 · 냉각 중',
    );
  });

  it('says why a press did nothing when the grid sheds the job, and where to fix it', () => {
    expect(status(facility({ id: 'DA', demand: 153, powered: false, datacenter: dc() }))).toEqual({
      text: '전력이 모자라 멈췄어요. 발전소에서 화력을 올리거나 공급 순서에서 DA를 올리세요.',
      tone: 'bad',
    });
  });

  it('says a cooling cycle is under way, and why a facility that is down takes no press', () => {
    expect(status(facility({ demand: 255, datacenter: dc({ cooling: true }) })).text).toBe('냉각 중… 끝나면 다시 누를 수 있어요');
    expect(status(facility({ condition: 'wrecked', datacenter: dc() }))).toEqual({
      text: '시설이 부서져 있어요. 먼저 복구하세요.',
      tone: 'bad',
    });
  });
});
