import { describe, expect, it } from 'vitest';
import { wreckFacility } from '../src/boards.ts';
import { pathTo } from '../src/luddites.ts';
import { alertsView, firmwareView, inspectBoard, listBoards, logsView, mapView, snapshot, statusView, timeView } from '../src/queries.ts';
import { sensorFrame } from '../src/sensors.ts';
import { Session } from '../src/session.ts';
import { findBoard, findFacility } from '../src/world.ts';
import { FakeHost } from './helpers/fake-host.ts';
import { m1Scenario, m2Scenario } from './helpers/scenarios.ts';

/** Milestone 1's town, P, DA, and DB with their boards installed, on steady wind and with no raid. */
function session(change?: NonNullable<Parameters<typeof m1Scenario>[0]>): { s: Session; host: FakeHost } {
  const host = new FakeHost();
  host.program('hello', () => ({ logs: ['hello'] }));
  const s = new Session(
    m1Scenario((j) => {
      j.tuning.wind.start = 220;
      j.tuning.wind.maxChangePerSecond = 0;
      j.tuning.emf.rumourThreshold = 1_000_000_000;
      change?.(j);
    }),
    1,
    host,
  );
  return { s, host };
}

/** Wind 20 feeds the plant (5) and DA (10) but not DB (13 with its transmission loss), so DB is shed. */
const shortOfPower = () =>
  session((j) => {
    j.tuning.wind.start = 20;
  });

/** The whole town with no board installed, on steady wind and free fuel, with no raid. Its crops ripen in a second. */
function town(change?: NonNullable<Parameters<typeof m2Scenario>[0]>): Session {
  return new Session(
    m2Scenario((j) => {
      j.tuning.wind.start = 220;
      j.tuning.wind.maxChangePerSecond = 0;
      j.tuning.fuelPrice = { start: 0, min: 0, max: 0 };
      j.tuning.emf.rumourThreshold = 1_000_000_000;
      j.tuning.farm.ripenSeconds = 1;
      change?.(j);
    }),
    1,
    new FakeHost(),
  );
}

/** Luddites reach a facility now. */
const wreck = (s: Session, id: string): void => wreckFacility(s.ctx, findFacility(s.world, id)!, s.world.step, 'luddites');

describe('views', () => {
  it('formats game time', () => {
    const { s } = session();
    expect(timeView(s.scenario, 0)).toEqual({ day: 1, clock: '00:00', seconds: 0 });
    expect(timeView(s.scenario, 800 + 400)).toEqual({ day: 2, clock: '12:00', seconds: 60 });
  });

  it('lists boards with their firmware state', () => {
    const { s } = session();
    s.deploy('DA', 'hello');
    expect(listBoards(s.world)[1]).toMatchObject({
      id: 'DA',
      kind: 'datacenter',
      tier: 1,
      board: { firmwareVersion: null, pendingVersion: 1 },
    });
    for (let i = 0; i < 4; i++) s.step();
    expect(listBoards(s.world)[1]).toMatchObject({
      board: { firmwareVersion: 1, pendingVersion: null, status: 'running', lastError: null },
    });
  });

  it('reads logs with game time, and filters by time', () => {
    const { s } = session();
    s.deploy('DA', 'hello');
    for (let i = 0; i < 40; i++) s.step(); // beats at 3, 7, ..., 39
    const all = logsView(s.ctx, 'DA')!;
    expect(all.find((l) => l.text === 'firmware v1 installed')).toMatchObject({ kind: 'system', day: 1 });
    expect(all.at(-1)).toMatchObject({ kind: 'log', text: 'hello', repeat: 10 });
    expect(logsView(s.ctx, 'DA', 1.9)).toHaveLength(1);
    expect(logsView(s.ctx, 'ZZ')).toBeNull();
  });

  it('maps facilities with distances but no EMF or Luddites', () => {
    const { s } = session();
    const m = mapView(s.ctx);
    expect(m.facilities.map((f) => [f.id, f.distanceToPlant])).toEqual([
      ['P', 0],
      ['DA', 1],
      ['DB', 16],
    ]);
    expect(JSON.stringify(m)).not.toMatch(/emf|luddite/i);
  });

  it('reports status in whole money and filters alerts by time', () => {
    const { s } = session();
    s.step();
    const st = statusView(s.ctx);
    expect(st.money).toBe(4999);
    expect(st.power.generation).toBe(220);
    expect(alertsView(s.ctx).map((a) => a.kind)).toEqual([]);
    for (let i = 0; i < 40; i++) s.step(); // two seconds in
    s.world.datacenters.DA!.tempMilli = 88_000;
    s.step();
    expect(alertsView(s.ctx, 1).map((a) => a.kind)).toEqual(['overheat']);
    expect(alertsView(s.ctx, 3)).toEqual([]);
  });

  it("snapshots what the viewer draws, including a Luddite group's path", () => {
    const { s } = session();
    s.world.luddites.push({ id: 1, x: 10, y: 0, size: 3, targetId: 'DB', quietSince: null, leaving: false, warned: [] });
    const snap = snapshot(s.ctx);
    expect(snap.grid).toEqual({ width: 20, height: 12 });
    expect(snap.emf).toHaveLength(240);
    expect(snap.luddites[0]!.path.at(-1)).toEqual([16, 8]);
    expect(snap.facilities.map((f) => f.id)).toEqual(['P', 'DA', 'DB']);
    expect(snap.facilities[1]!.datacenter!.tempC).toBe(25);
  });

  it("inspects a board for the viewer's panel", () => {
    const { s } = session();
    s.deploy('DA', 'hello');
    for (let i = 0; i < 4; i++) s.step();
    const inspection = inspectBoard(s.ctx, 'DA')!;
    expect(inspection.firmware?.source).toBe('hello');
    expect(inspection.sensors.temp).toBe(25);
    expect(inspection.logs.length).toBeGreaterThan(0);
  });
});

// Hand-derived numbers: the m1 town has P (4, 4), DA (5, 4) and DB (16, 8), 20 steps a second and 800 steps a day. A board's
// beat is every `period` steps from its phase: P at steps 0, 5, 10, ...; DA at 3, 7, 11, ...; DB at 2, 6, 10, ...
describe('views in detail', () => {
  it('lists every board with its position, state, power, and latest error', () => {
    const { s, host } = shortOfPower();
    host.program('boom', () => ({ error: { kind: 'runtime', message: 'boom' } }));
    s.deploy('DA', 'boom');
    for (let i = 0; i < 4; i++) s.step();
    s.world.boards[0]!.status = 'asleep';
    const board = { pendingVersion: null };
    expect(listBoards(s.world)).toEqual([
      {
        id: 'P',
        kind: 'power',
        x: 4,
        y: 4,
        tier: 1,
        condition: 'ok',
        board: { ...board, status: 'asleep', powered: true, firmwareVersion: null, lastError: null },
      },
      {
        id: 'DA',
        kind: 'datacenter',
        x: 5,
        y: 4,
        tier: 1,
        condition: 'ok',
        board: { ...board, status: 'running', powered: true, firmwareVersion: 1, lastError: 'runtime: boom' },
      },
      {
        id: 'DB',
        kind: 'datacenter',
        x: 16,
        y: 8,
        tier: 1,
        condition: 'ok',
        board: { ...board, status: 'running', powered: false, firmwareVersion: null, lastError: null },
      },
    ]);
  });

  it('shows the installed firmware and the one waiting for the next tick', () => {
    const { s, host } = session();
    host.program('v2', () => ({}));
    expect(firmwareView(s.world, 'DA')).toEqual({ version: null, source: null, pending: null });
    s.deploy('DA', 'hello');
    expect(firmwareView(s.world, 'DA')).toEqual({ version: null, source: null, pending: { version: 1, source: 'hello' } });
    for (let i = 0; i < 4; i++) s.step();
    expect(firmwareView(s.world, 'DA')).toEqual({ version: 1, source: 'hello', pending: null });
    s.deploy('DA', 'v2');
    expect(firmwareView(s.world, 'DA')).toEqual({ version: 1, source: 'hello', pending: { version: 2, source: 'v2' } });
    expect(firmwareView(s.world, 'ZZ')).toBeNull();
  });

  it('stamps a log line with the game time of its latest occurrence, and keeps only the lines after "since"', () => {
    const { s } = session();
    s.deploy('P', 'hello');
    for (let i = 0; i < 21; i++) s.step(); // P beats at steps 0, 5, 10, 15, 20: the fifth "hello" is at second 1
    const lines = logsView(s.ctx, 'P')!;
    const installed = lines.find((l) => l.text === 'firmware v1 installed');
    const hello = lines.find((l) => l.text === 'hello')!;
    expect(installed).toEqual({ day: 1, clock: '00:00', seconds: 0, kind: 'system', text: 'firmware v1 installed', repeat: 1 });
    expect(hello).toEqual({ day: 1, clock: '00:36', seconds: 1, kind: 'log', text: 'hello', repeat: 5 });
    expect(logsView(s.ctx, 'P', 0)).toEqual([hello]); // "after" is exclusive: the lines at second 0 are out
    expect(logsView(s.ctx, 'P', 0.95)).toEqual([hello]);
    expect(logsView(s.ctx, 'P', 1)).toEqual([]);
  });

  // The power phase skips a board that draws nothing, so its flag keeps the value it had: a smashed board stays "powered".
  it('reports a destroyed or a rebuilding board as unpowered, and a running or sleeping one by the grid', () => {
    const { s } = session();
    s.step(); // the grid covers everyone
    const [p, da, db] = s.world.boards;
    for (const board of [p!, da!, db!]) expect(board.powered).toBe(true);
    da!.status = 'destroyed';
    db!.status = 'rebuilding';
    p!.status = 'asleep';
    const seen = () => [
      listBoards(s.world).map((b) => [b.id, b.board?.status, b.board?.powered]),
      snapshot(s.ctx).facilities.map((f) => [f.id, f.board?.status, f.board?.powered]),
    ];
    for (const view of seen()) {
      expect(view).toEqual([
        ['P', 'asleep', true],
        ['DA', 'destroyed', false],
        ['DB', 'rebuilding', false],
      ]);
    }
    // The map shows the facilities, which stand and have the grid's power whatever their boards do.
    expect(mapView(s.ctx).facilities.map((f) => [f.id, f.powered])).toEqual([
      ['P', true],
      ['DA', true],
      ['DB', true],
    ]);
    // A board that is working and shed is unpowered as before, and powered again with the grid.
    da!.status = 'running';
    da!.powered = false;
    expect(listBoards(s.world)[1]!.board!.powered).toBe(false);
    da!.powered = true;
    expect(listBoards(s.world)[1]!.board!.powered).toBe(true);
  });

  it('reports the time, the season length, the power, the food, the residents, and how the season ended', () => {
    const { s } = shortOfPower();
    for (let i = 0; i < 20; i++) s.step();
    // Power: 20 generated against 5 + 10 + 13 requested, so DB is shed. Money: 5000 less 20 steps of upkeep (37,500 micro-units each).
    // The m1 town has no warehouse and no housing.
    expect(statusView(s.ctx)).toEqual({
      time: { day: 1, clock: '00:36', seconds: 1 },
      seasonDays: 30,
      money: 4999,
      power: { generation: 20, demand: 28, shed: ['DB'] },
      food: { warehouse: 0, housing: 0 },
      population: { fed: 0, hungry: 0, unpowered: 0 },
      ended: null,
    });
    // The end is told in game time, as the time is: a step means nothing to an agent (1,400 of them were read as 70 seconds).
    s.world.ended = { kind: 'bankrupt', step: 1_400 };
    expect(statusView(s.ctx).ended).toEqual({ kind: 'bankrupt', time: { day: 2, clock: '18:00', seconds: 70 } }); // a day is 800 steps
    s.world.ended = { kind: 'completed', step: 800 * 30 - 1 };
    expect(statusView(s.ctx).ended).toEqual({ kind: 'completed', time: { day: 30, clock: '23:58', seconds: 1199.95 } });
    // The viewer's snapshot keeps the step.
    expect(snapshot(s.ctx).ended).toEqual({ kind: 'completed', step: 800 * 30 - 1 });
  });

  it('lists an alert with its facility, message, and game time, and keeps only the alerts after "since"', () => {
    const { s } = session();
    for (let i = 0; i < 40; i++) s.step();
    s.world.datacenters.DA!.tempMilli = 88_000;
    s.step(); // the alert is raised at step 40, second 2
    const alerts = alertsView(s.ctx);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ id: 1, kind: 'overheat', facility: 'DA', day: 1, clock: '01:12', seconds: 2 });
    expect(alerts[0]!.message).toContain('DA');
    expect(alertsView(s.ctx, 1.95)).toEqual(alerts);
    expect(alertsView(s.ctx, 2)).toEqual([]); // "after" is exclusive
  });

  it('snapshots the plant and every facility of a busy town', () => {
    const { s, host } = session();
    host.program('plant', () => ({
      actions: [
        { kind: 'setThermal', output: 100 },
        { kind: 'setPriority', order: ['DB'] },
      ],
    }));
    host.program('busy', () => ({ actions: [{ kind: 'process' }] }));
    host.program('boom', () => ({ error: { kind: 'runtime', message: 'boom' } }));
    s.deploy('P', 'plant');
    s.deploy('DA', 'busy');
    s.deploy('DB', 'boom');
    for (let i = 0; i < 8; i++) s.step();
    s.world.datacenters.DA!.tempMilli = 61_999;
    const snap = snapshot(s.ctx);
    // Phase 3 of step 7: 220 wind + 100 thermal against P 5, DA 10 + 150 (the job its tick at step 3 started runs through
    // step 13) plus 2% of that for one cell (3), and DB 10 + 3. DA's tick at step 7 renewed the job, which covers step 8 too.
    expect(snap.plant).toEqual({
      wind: 220,
      thermal: 100,
      thermalMax: 300,
      fuelPrice: s.world.plant.fuelPrice,
      generation: 320,
      demand: 181,
      shed: [],
      priority: ['DB', 'DA'],
    });
    expect(snap.plant.fuelPrice).toBeGreaterThan(0);
    expect(snap.jobPrice).toBe(s.world.jobPrice); // what a second of work pays: the panel shows it at T0, where no board reads it
    const running = { status: 'running', powered: true, hasFirmware: true, erroring: false };
    expect(snap.facilities.map((f) => [f.id, f.demand, f.board, f.datacenter])).toEqual([
      ['P', 5, running, null],
      ['DA', 163, running, { tempC: 61, processing: true, cooling: false }],
      ['DB', 13, { ...running, erroring: true }, { tempC: 25, processing: false, cooling: false }],
    ]);
    expect(snap.facilities[1]).toEqual({
      id: 'DA',
      kind: 'datacenter',
      x: 5,
      y: 4,
      tier: 1,
      condition: 'ok',
      repairHoursLeft: null,
      powered: true,
      demand: 163,
      board: running,
      datacenter: { tempC: 61, processing: true, cooling: false },
      farm: null,
      warehouse: null,
      housing: null,
    });
    // A cooling cycle that covers this step: the datacenter shows it, and draws its 400 on top: 560, and 2% of that (11).
    s.world.datacenters.DA!.coolFrom = 8;
    s.world.datacenters.DA!.coolUntil = 88;
    expect(snapshot(s.ctx).facilities[1]).toMatchObject({ demand: 571, datacenter: { processing: true, cooling: true } });
    expect(snap.trucks).toEqual([]);
    expect(snap.town).toEqual({ food: 0, population: { fed: 0, hungry: 0, unpowered: 0 } });
  });

  it('snapshots which facilities the plant sheds, the state and power of every facility and board, and whole money rounded down', () => {
    const { s } = shortOfPower();
    s.step();
    wreck(s, 'DA');
    s.world.money = 4_999_999_999; // 4999.999999 money units
    const snap = snapshot(s.ctx);
    expect(snap.plant).toMatchObject({ wind: 20, thermal: 0, generation: 20, demand: 28, shed: ['DB'] });
    // A wrecked facility shows no power, whatever the grid's flag says, and its board is destroyed with it.
    expect(snap.facilities.map((f) => [f.id, f.condition, f.powered, f.board?.status, f.board?.powered])).toEqual([
      ['P', 'ok', true, 'running', true],
      ['DA', 'wrecked', false, 'destroyed', false],
      ['DB', 'ok', false, 'running', false],
    ]);
    expect(snap.money).toBe(4999);
  });

  it('snapshots the step, the money, the season, the EMF in whole units, and each Luddite group', () => {
    const { s } = session();
    for (let i = 0; i < 20; i++) s.step();
    s.world.luddites.push(
      { id: 1, x: 10, y: 0, size: 3, targetId: 'DB', quietSince: null, leaving: false, warned: [] },
      { id: 2, x: 0, y: 5, size: 4, targetId: null, quietSince: 100, leaving: true, warned: [] },
    );
    s.world.emf[0] = 7_000;
    s.world.emf[23] = 2_999; // (3, 1)
    s.world.emf[24] = 3_000; // (4, 1)
    s.world.ended = { kind: 'completed', step: 19 };
    const snap = snapshot(s.ctx);
    expect(snap).toMatchObject({
      step: 20,
      time: { day: 1, clock: '00:36', seconds: 1 },
      seasonDays: 30,
      money: 4999,
      ended: { kind: 'completed', step: 19 },
      grid: { width: 20, height: 12 },
    });
    expect([snap.emf[0], snap.emf[23], snap.emf[24]]).toEqual([7, 2, 3]);
    expect(snap.luddites).toEqual([
      {
        id: 1,
        x: 10,
        y: 0,
        size: 3,
        targetId: 'DB',
        leaving: false,
        path: [...[11, 12, 13, 14, 15, 16].map((x) => [x, 0]), ...[1, 2, 3, 4, 5, 6, 7, 8].map((y) => [16, y])],
      },
      { id: 2, x: 0, y: 5, size: 4, targetId: null, leaving: true, path: [] },
    ]);
  });

  it('tells the viewer the prices of boards, comm modules, repairs, and rebuilds, and the game hours a repair and a rebuild take, rounded down', () => {
    expect(snapshot(session().s.ctx).prices).toEqual({
      board: { farm: 200, warehouse: 400, power: 400, datacenter: 600 },
      comm: 300,
      repair: { farm: 150, warehouse: 300, power: 300, datacenter: 500 },
      repairHours: 12,
      rebuild: 500,
      rebuildHours: 12,
    });
    const { s } = session((j) => {
      j.time.secondsPerDay = 70;
      j.tuning.repair.seconds = 30;
      j.tuning.rebuild = { cost: 120, seconds: 20 };
    });
    // 30 s and 20 s of a 70 s day are 10.3 and 6.9 hours.
    expect(snapshot(s.ctx).prices).toMatchObject({ repairHours: 10, rebuild: 120, rebuildHours: 6 });
  });

  it('counts a firmware that waits for its first tick as the board having firmware', () => {
    const { s } = session();
    const has = () => snapshot(s.ctx).facilities.map((f) => f.board?.hasFirmware);
    expect(has()).toEqual([false, false, false]);
    s.deploy('DA', 'hello');
    expect(has()).toEqual([false, true, false]);
    for (let i = 0; i < 4; i++) s.step();
    expect(has()).toEqual([false, true, false]);
  });

  it("shows the viewer's panel the board's parts, its waiting firmware, its last 50 log lines, and its readings", () => {
    const { s, host } = session();
    host.program('count', (_sensors, mem) => {
      mem.n = ((mem.n as number | undefined) ?? 0) + 1;
      return { logs: [`line ${mem.n}`] };
    });
    // No tick yet, so no RAM reading.
    expect(inspectBoard(s.ctx, 'DA')!.parts).toEqual({ clockHz: 5, instructionsPerTick: 2000, ramBytes: 8192, ramUsedBytes: null });
    s.deploy('DA', 'count');
    for (let i = 0; i < 240; i++) s.step(); // DA beats at 3, 7, ..., 239: the install line, then sixty log lines
    s.deploy('DA', 'hello');
    const panel = inspectBoard(s.ctx, 'DA')!;
    expect(panel.parts).toEqual({ clockHz: 5, instructionsPerTick: 2000, ramBytes: 8192, ramUsedBytes: 0 });
    expect(panel.baseEmfPerSecond).toBe(25);
    expect(panel.firmware).toEqual({ version: 1, source: 'count' });
    expect(panel.pending).toEqual({ version: 2, source: 'hello' });
    expect(panel.logs).toHaveLength(50);
    expect(panel.logs[0]!.text).toBe('line 11');
    expect(panel.logs.at(-1)!.text).toBe('line 60');
    expect(panel.sensors).toEqual(sensorFrame(s.ctx, findBoard(s.world, 'DA')!));
    expect(inspectBoard(s.ctx, 'ZZ')).toBeNull();
  });
});

// The whole town: H1 (2, 1), H2 (17, 1), P (4, 4), DA (5, 4), W (11, 6), DB (16, 8), F1 (2, 9), F2 (3, 9), F3 (4, 9).
describe('views of the whole town', () => {
  it('lists every facility that takes a board, with its tier, its condition, and its board when it has one', () => {
    const s = town();
    expect(s.install('DA', 'board')).toEqual({ ok: true });
    expect(s.install('DA', 'comm')).toEqual({ ok: true });
    expect(s.install('F1', 'board')).toEqual({ ok: true });
    const running = { status: 'running', powered: true, firmwareVersion: null, pendingVersion: null, lastError: null };
    const bare = (id: string, kind: string, x: number, y: number) => ({ id, kind, x, y, tier: 0, condition: 'ok', board: null });
    expect(listBoards(s.world)).toEqual([
      bare('P', 'power', 4, 4),
      { id: 'DA', kind: 'datacenter', x: 5, y: 4, tier: 2, condition: 'ok', board: running },
      bare('W', 'warehouse', 11, 6),
      bare('DB', 'datacenter', 16, 8),
      { id: 'F1', kind: 'farm', x: 2, y: 9, tier: 1, condition: 'ok', board: running },
      bare('F2', 'farm', 3, 9),
      bare('F3', 'farm', 4, 9),
    ]);
    // Luddites wreck F1, board and all: the farm no longer stands, and its board is down, at the tier it had.
    wreck(s, 'F1');
    expect(listBoards(s.world)[4]).toEqual({
      id: 'F1',
      kind: 'farm',
      x: 2,
      y: 9,
      tier: 1,
      condition: 'wrecked',
      board: { ...running, status: 'destroyed', powered: false },
    });
  });

  it('maps every facility of the town with its tier, its condition, its power, and its distance to the plant', () => {
    const s = town();
    s.install('DA', 'board');
    s.install('DA', 'comm');
    s.install('W', 'board');
    wreck(s, 'DB');
    const at = (id: string, kind: string, x: number, y: number, distanceToPlant: number, more = {}) => ({
      id,
      kind,
      x,
      y,
      tier: 0,
      condition: 'ok',
      powered: true,
      distanceToPlant,
      ...more,
    });
    expect(mapView(s.ctx)).toEqual({
      width: 20,
      height: 12,
      facilities: [
        at('H1', 'housing', 2, 1, 5),
        at('H2', 'housing', 17, 1, 16),
        at('P', 'power', 4, 4, 0),
        at('DA', 'datacenter', 5, 4, 1, { tier: 2 }),
        at('W', 'warehouse', 11, 6, 9, { tier: 1 }),
        at('DB', 'datacenter', 16, 8, 16, { condition: 'wrecked', powered: false }),
        at('F1', 'farm', 2, 9, 7),
        at('F2', 'farm', 3, 9, 6),
        at('F3', 'farm', 4, 9, 5),
      ],
    });
    expect(JSON.stringify(mapView(s.ctx))).not.toMatch(/emf|luddite/i);
  });

  it('reports the food in the warehouse and in the housing, in whole units, and the residents by how they stand', () => {
    const s = town();
    s.world.warehouses.W!.stockMilli = 12_999;
    s.world.housing.H1!.foodMilli = 100_500;
    s.world.housing.H2!.foodMilli = 0;
    s.world.housing.H2!.fed = false;
    expect(statusView(s.ctx)).toMatchObject({
      food: { warehouse: 12, housing: 100 },
      population: { fed: 40, hungry: 40, unpowered: 0 },
    });
    // Residents who eat but have no power count apart: they pay no tax.
    findFacility(s.world, 'H1')!.powered = false;
    expect(statusView(s.ctx).population).toEqual({ fed: 0, hungry: 40, unpowered: 40 });
  });

  it("snapshots each kind of facility with its own readings, the trucks, and the town's food and people", () => {
    const s = town();
    s.install('DA', 'board');
    for (let i = 0; i < 20; i++) s.step(); // a second: the crops planted at step 0 are ripe
    const w = s.world;
    w.datacenters.DA = { tempMilli: 61_999, busyFrom: 20, busyUntil: 30, coolFrom: 20, coolUntil: 100 };
    w.farms.F2!.plantedAt = 10; // half ripe
    w.farms.F3!.outbox = 33;
    w.warehouses.W!.stockMilli = 12_999;
    Object.assign(w.warehouses.W!.trucks[1]!, {
      status: 'outbound',
      job: { kind: 'deliver', targetId: 'H2', amount: 20 },
      x: 12,
      y: 6,
      load: 20,
    });
    w.housing.H1!.foodMilli = 100_500;
    w.housing.H2!.foodMilli = 0;
    w.housing.H2!.fed = false;
    const snap = snapshot(s.ctx);
    const view = (id: string) => snap.facilities.find((f) => f.id === id)!;
    expect(snap.facilities.map((f) => f.id)).toEqual(['H1', 'H2', 'P', 'DA', 'W', 'DB', 'F1', 'F2', 'F3']);
    const plain = {
      condition: 'ok',
      repairHoursLeft: null,
      powered: true,
      board: null,
      datacenter: null,
      farm: null,
      warehouse: null,
      housing: null,
    };
    // DA processes and cools on top of its board: 10 + 150 + 250, and 2% of that for one cell (8).
    expect(view('DA')).toEqual({
      ...plain,
      id: 'DA',
      kind: 'datacenter',
      x: 5,
      y: 4,
      tier: 1,
      demand: 418,
      board: { status: 'running', powered: true, hasFirmware: false, erroring: false },
      datacenter: { tempC: 61, processing: true, cooling: true },
    });
    expect(view('DB')).toEqual({
      ...plain,
      id: 'DB',
      kind: 'datacenter',
      x: 16,
      y: 8,
      tier: 0,
      demand: 0,
      datacenter: { tempC: 25, processing: false, cooling: false },
    });
    expect(view('F1')).toEqual({
      ...plain,
      id: 'F1',
      kind: 'farm',
      x: 2,
      y: 9,
      tier: 0,
      demand: 0,
      farm: { ripeness: 100, ripe: true, outbox: 0 },
    });
    expect(view('F2').farm).toEqual({ ripeness: 50, ripe: false, outbox: 0 });
    expect(view('F3').farm).toEqual({ ripeness: 100, ripe: true, outbox: 33 });
    expect(view('W')).toEqual({ ...plain, id: 'W', kind: 'warehouse', x: 11, y: 6, tier: 0, demand: 0, warehouse: { stock: 12 } });
    // A housing block draws 70, plus 2% for each cell from the plant: 5 cells for H1, 16 for H2.
    expect(view('H1')).toEqual({
      ...plain,
      id: 'H1',
      kind: 'housing',
      x: 2,
      y: 1,
      tier: 0,
      demand: 77,
      housing: { food: 100, residents: 40, fed: true },
    });
    expect(view('H2')).toMatchObject({ demand: 92, housing: { food: 0, residents: 40, fed: false } });
    expect(view('P')).toEqual({ ...plain, id: 'P', kind: 'power', x: 4, y: 4, tier: 0, demand: 0 });
    expect(snap.trucks).toEqual([
      { warehouse: 'W', id: 1, x: 11, y: 6, status: 'idle', load: 0, targetId: null },
      { warehouse: 'W', id: 2, x: 12, y: 6, status: 'outbound', load: 20, targetId: 'H2' },
    ]);
    expect(snap.town).toEqual({ food: 12, population: { fed: 40, hungry: 40, unpowered: 0 } });
    expect(snap.plant).toMatchObject({ thermalMax: 300, priority: ['H1', 'H2', 'DA', 'W', 'DB', 'F1', 'F2', 'F3'] });
  });

  it('counts the game hours a repair has left, rounded up, and shows a facility under repair, and its board, without power', () => {
    const s = town((j) => {
      j.time.secondsPerDay = 70;
    });
    s.install('F1', 'board');
    wreck(s, 'F1');
    const f1 = () => snapshot(s.ctx).facilities.find((f) => f.id === 'F1')!;
    expect(f1()).toMatchObject({
      condition: 'wrecked',
      repairHoursLeft: null,
      powered: false,
      demand: 0,
      board: { status: 'destroyed', powered: false },
    });
    expect(s.repair('F1')).toEqual({ ok: true });
    // 20 s of a 70 s day is 6.86 hours, which reads 7: a repair never reads 0 hours while it has time left.
    expect(f1()).toMatchObject({ condition: 'repairing', repairHoursLeft: 7, powered: false });
    for (let i = 0; i < 399; i++) s.step(); // one step left
    expect(f1().repairHoursLeft).toBe(1);
    for (let i = 0; i < 2; i++) s.step(); // step 400 finishes the repair in its first phase
    expect(f1()).toMatchObject({ condition: 'ok', repairHoursLeft: null, powered: true, board: { status: 'destroyed' } });
  });

  it("gives a board's base EMF with its comm module's and its readings as its firmware gets them, and no inspection without a board", () => {
    const s = town();
    s.install('W', 'board');
    expect(inspectBoard(s.ctx, 'W')!.baseEmfPerSecond).toBe(15);
    s.install('W', 'comm');
    const panel = inspectBoard(s.ctx, 'W')!;
    expect(panel.baseEmfPerSecond).toBe(20);
    expect(panel.parts).toEqual({ clockHz: 2, instructionsPerTick: 3000, ramBytes: 16_384, ramUsedBytes: null });
    expect(panel.sensors).toEqual(sensorFrame(s.ctx, findBoard(s.world, 'W')!));
    expect(panel.sensors.farms).toEqual([
      { id: 'F1', outbox: 0, distance: 12 },
      { id: 'F2', outbox: 0, distance: 11 },
      { id: 'F3', outbox: 0, distance: 10 },
    ]);
    expect(panel.sensors.trucks).toEqual([
      { id: 1, status: 'idle', x: 11, y: 6, load: 0 },
      { id: 2, status: 'idle', x: 11, y: 6, load: 0 },
    ]);
    for (const id of ['H1', 'F2', 'ZZ']) expect(inspectBoard(s.ctx, id), id).toBeNull();
  });
});

// A wreck stops a facility where it stood, and its repair resets it: a datacenter cools to ambient and a farm plants a new crop. Until
// then the world still holds what the wreck froze (a datacenter's heat, a field planted long ago), and the views must not show it as live.
describe('views of a facility that is down', () => {
  it('shows a wrecked or repairing datacenter at ambient and not at the heat it froze at, and a standing one by its own', () => {
    const s = town();
    const dc = () => snapshot(s.ctx).facilities.find((f) => f.id === 'DB')!.datacenter;
    s.world.datacenters.DB!.tempMilli = 91_500; // no step runs, so no roll for fire
    expect(dc()).toEqual({ tempC: 91, processing: false, cooling: false });
    wreck(s, 'DB');
    expect(s.world.datacenters.DB!.tempMilli).toBe(91_500); // the world keeps it
    expect(dc()).toEqual({ tempC: 25, processing: false, cooling: false });
    expect(s.repair('DB')).toEqual({ ok: true });
    for (let i = 0; i < 399; i++) s.step(); // one step of the repair left
    expect(findFacility(s.world, 'DB')!.condition).toBe('repairing');
    expect(s.world.datacenters.DB!.tempMilli).toBe(91_500);
    expect(dc()).toEqual({ tempC: 25, processing: false, cooling: false });
    for (let i = 0; i < 2; i++) s.step(); // step 400 finishes the repair, which resets the temperature: the reading does not jump
    expect(findFacility(s.world, 'DB')!.condition).toBe('ok');
    expect(s.world.datacenters.DB!.tempMilli).toBe(25_000);
    expect(dc()).toEqual({ tempC: 25, processing: false, cooling: false });
  });

  it('shows a wrecked or repairing farm with no crop though its field keeps the old planting, and keeps the food in its outbox', () => {
    const s = town();
    for (let i = 0; i < 20; i++) s.step(); // a second: the crops planted at step 0 are ripe
    s.world.farms.F1!.outbox = 33;
    const f1 = () => snapshot(s.ctx).facilities.find((f) => f.id === 'F1')!.farm;
    expect(f1()).toEqual({ ripeness: 100, ripe: true, outbox: 33 });
    wreck(s, 'F1');
    expect(s.world.farms.F1!.plantedAt).toBe(0); // the field is as it was
    expect(f1()).toEqual({ ripeness: 0, ripe: false, outbox: 33 });
    expect(s.repair('F1')).toEqual({ ok: true }); // from step 20: done at step 420
    for (let i = 0; i < 400; i++) s.step(); // world step 420: the repair is one step from its end
    expect(findFacility(s.world, 'F1')!.condition).toBe('repairing');
    expect(s.world.farms.F1!.plantedAt).toBe(0);
    expect(f1()).toEqual({ ripeness: 0, ripe: false, outbox: 33 });
    // Step 420 finishes the repair in its first phase and plants the new crop; the field grows from there, 5% to the step.
    s.step();
    expect(findFacility(s.world, 'F1')!.condition).toBe('ok');
    expect(s.world.farms.F1!.plantedAt).toBe(420);
    expect(f1()).toEqual({ ripeness: 5, ripe: false, outbox: 33 });
    for (let i = 0; i < 10; i++) s.step();
    expect(f1()).toEqual({ ripeness: 55, ripe: false, outbox: 33 });
  });

  it('gives a destroyed board the sensors its facility reads while it is down, and as they are once the facility stands again', () => {
    const s = town();
    s.install('F1', 'board');
    s.install('DB', 'board');
    for (let i = 0; i < 20; i++) s.step(); // F1's crop is ripe
    s.world.datacenters.DB!.tempMilli = 91_500;
    wreck(s, 'F1');
    wreck(s, 'DB');
    // The frame is what firmware reads from the world as the wreck left it. No firmware runs on a destroyed board; the panel shows the
    // facility's own readings, as the snapshot does.
    expect(sensorFrame(s.ctx, findBoard(s.world, 'F1')!)).toMatchObject({ ripeness: 100, outbox: 0 });
    expect(sensorFrame(s.ctx, findBoard(s.world, 'DB')!).temp).toBe(91.5);
    expect(inspectBoard(s.ctx, 'F1')!.sensors).toMatchObject({ ripeness: 0, outbox: 0 });
    expect(inspectBoard(s.ctx, 'DB')!.sensors.temp).toBe(25);
    // Only the readings the board has: a farm's board gets no temperature, and a datacenter's no ripeness.
    expect(inspectBoard(s.ctx, 'F1')!.sensors).toEqual({ ...sensorFrame(s.ctx, findBoard(s.world, 'F1')!), ripeness: 0 });
    expect(inspectBoard(s.ctx, 'DB')!.sensors).toEqual({ ...sensorFrame(s.ctx, findBoard(s.world, 'DB')!), temp: 25 });
    // Under repair it reads the same: the field still holds the old planting.
    expect(s.repair('F1')).toEqual({ ok: true });
    for (let i = 0; i < 100; i++) s.step();
    expect(findFacility(s.world, 'F1')!.condition).toBe('repairing');
    expect(inspectBoard(s.ctx, 'F1')!.sensors.ripeness).toBe(0);
    // Repaired, F1 stands with its board still destroyed: its sensors are its crop's again.
    for (let i = 0; i < 311; i++) s.step(); // done at step 420; the new crop is 10 steps old at step 431
    expect(findBoard(s.world, 'F1')!.status).toBe('destroyed');
    expect(inspectBoard(s.ctx, 'F1')!.sensors).toEqual(sensorFrame(s.ctx, findBoard(s.world, 'F1')!));
    expect(inspectBoard(s.ctx, 'F1')!.sensors.ripeness).toBe(55);
    // DB is still wrecked, and still reads ambient.
    expect(inspectBoard(s.ctx, 'DB')!.sensors.temp).toBe(25);
  });
});

describe('what the viewer reads of the trucks and of the grid', () => {
  // The way back is not the way out: pathTo goes along the row first, from wherever the leg starts, so the viewer draws each leg from the
  // truck's status, the warehouse, and the target it names.
  it('tells the viewer where a truck is bound on its way out and on its way back, which are different routes, and nothing once it is home', () => {
    const s = town();
    s.world.farms.F1!.outbox = 30;
    const truck = () => snapshot(s.ctx).trucks[0]!;
    const out = pathTo(11, 6, 2, 9); // from W (11, 6) to F1 (2, 9)
    const back = pathTo(2, 9, 11, 6);
    expect(s.hand('W', { kind: 'dispatch', truck: 1, from: 'F1', to: 'W', amount: 40 })).toEqual({ ok: true });
    expect(truck()).toEqual({ warehouse: 'W', id: 1, x: 11, y: 6, status: 'outbound', load: 0, targetId: 'F1' });
    for (let i = 0; i < 61; i++) s.step(); // a cell every 10 steps: step 60 is the sixth, (5, 6)
    expect(truck()).toEqual({ warehouse: 'W', id: 1, x: 5, y: 6, status: 'outbound', load: 0, targetId: 'F1' });
    expect(out).toContainEqual([5, 6]);
    expect(back).not.toContainEqual([5, 6]);
    for (let i = 0; i < 60; i++) s.step(); // step 120 is the twelfth: at the farm, it takes the outbox and turns back
    expect(truck()).toEqual({ warehouse: 'W', id: 1, x: 2, y: 9, status: 'returning', load: 30, targetId: 'F1' });
    for (let i = 0; i < 50; i++) s.step(); // step 170: the fifth cell of the way back, (7, 9)
    expect(truck()).toEqual({ warehouse: 'W', id: 1, x: 7, y: 9, status: 'returning', load: 30, targetId: 'F1' });
    expect(back).toContainEqual([7, 9]);
    expect(out).not.toContainEqual([7, 9]);
    expect(snapshot(s.ctx).town.food).toBe(0); // the load is still aboard
    for (let i = 0; i < 71; i++) s.step(); // step 240: home, where the load goes into the stock
    expect(truck()).toEqual({ warehouse: 'W', id: 1, x: 11, y: 6, status: 'idle', load: 0, targetId: null });
    expect(snapshot(s.ctx).town.food).toBe(30);
  });

  it('maps a facility that stands and is shed by the plant as unpowered', () => {
    const { s } = shortOfPower();
    s.step();
    expect(mapView(s.ctx).facilities.map((f) => [f.id, f.condition, f.powered])).toEqual([
      ['P', 'ok', true],
      ['DA', 'ok', true],
      ['DB', 'ok', false],
    ]);
  });
});

describe('views at the edges', () => {
  it("keeps what a wreck leaves alone: a warehouse's stock and a housing block's food, which the top bar and the status still count", () => {
    const s = town();
    s.world.warehouses.W!.stockMilli = 12_999;
    s.world.housing.H1!.foodMilli = 100_500;
    wreck(s, 'W');
    wreck(s, 'H1');
    const snap = snapshot(s.ctx);
    const view = (id: string) => snap.facilities.find((f) => f.id === id)!;
    expect(view('W')).toMatchObject({ condition: 'wrecked', demand: 0, warehouse: { stock: 12 } });
    expect(view('H1')).toMatchObject({ condition: 'wrecked', demand: 0, housing: { food: 100, residents: 40, fed: true } });
    expect(snap.town.food).toBe(12);
    expect(statusView(s.ctx).food).toEqual({ warehouse: 12, housing: 220 }); // H2 still has its 120
  });

  it('counts the hours a repair has left up to the whole hour: an exact number of hours reads as itself, and a repair that is done reads none', () => {
    const s = town(); // 800 steps a day, so a repair of 20 s is 400 steps: exactly 12 hours
    wreck(s, 'F1');
    expect(s.repair('F1')).toEqual({ ok: true });
    const left = () => {
      const f = snapshot(s.ctx).facilities.find((x) => x.id === 'F1')!;
      return [f.condition, f.repairHoursLeft];
    };
    const at = (step: number) => {
      while (s.world.step < step) s.step();
      return left();
    };
    expect(left()).toEqual(['repairing', 12]);
    expect(at(299)).toEqual(['repairing', 4]); // 101 steps left: 3.03 hours
    expect(at(300)).toEqual(['repairing', 3]); // 100 steps left: exactly 3 hours
    expect(at(399)).toEqual(['repairing', 1]);
    expect(at(400)).toEqual(['repairing', 0]); // nothing left: the repair finishes in the next step
    expect(at(401)).toEqual(['ok', null]);
  });

  it("adds up the housing blocks' food by the whole units each one shows", () => {
    const s = town();
    s.world.housing.H1!.foodMilli = 100_600;
    s.world.housing.H2!.foodMilli = 7_600;
    expect(snapshot(s.ctx).facilities.flatMap((f) => (f.housing ? [f.housing.food] : []))).toEqual([100, 7]);
    expect(statusView(s.ctx).food.housing).toBe(107); // not 108, which the milli-units add up to
  });

  // The views read the world as it stands between two steps: at the step that comes next.
  it("reads a datacenter's job and cooling at the step the world is at: a window draws power from its first step to its last, and no more", () => {
    const s = town();
    s.install('DA', 'board');
    for (let i = 0; i < 20; i++) s.step();
    s.world.datacenters.DA = { tempMilli: 25_000, busyFrom: 10, busyUntil: 21, coolFrom: 10, coolUntil: 21 };
    const da = () => snapshot(s.ctx).facilities.find((f) => f.id === 'DA')!;
    const idle = { demand: 10, datacenter: { processing: false, cooling: false } }; // the board's 10, and 2% of it for one cell is nothing
    const working = { demand: 418, datacenter: { processing: true, cooling: true } }; // plus the job's 150 and the cooling's 250, and 2% of 410 (8)
    s.world.step = 9;
    expect(da()).toMatchObject(idle);
    s.world.step = 10;
    expect(da()).toMatchObject(working);
    s.world.step = 20;
    expect(da()).toMatchObject(working);
    s.world.step = 21;
    expect(da()).toMatchObject(idle);
  });

  it('shows a datacenter that the plant sheds as neither processing nor cooling, though it still requests its power', () => {
    const s = town();
    s.install('DA', 'board');
    for (let i = 0; i < 20; i++) s.step();
    s.world.datacenters.DA = { tempMilli: 25_000, busyFrom: 10, busyUntil: 30, coolFrom: 10, coolUntil: 30 };
    findFacility(s.world, 'DA')!.powered = false;
    expect(snapshot(s.ctx).facilities.find((f) => f.id === 'DA')).toMatchObject({
      powered: false,
      demand: 418,
      datacenter: { processing: false, cooling: false },
    });
  });

  it('reads a crop as ripe from the step it has grown for the ripening time, and not a step before', () => {
    const s = town(); // a crop ripens in a second: 20 steps, and F1 was planted at step 0
    const f1 = () => snapshot(s.ctx).facilities.find((f) => f.id === 'F1')!.farm;
    s.world.step = 19;
    expect(f1()).toEqual({ ripeness: 95, ripe: false, outbox: 0 });
    s.world.step = 20;
    expect(f1()).toEqual({ ripeness: 100, ripe: true, outbox: 0 });
  });

  it('names the warehouse each truck belongs to', () => {
    const s = town((j) => {
      j.facilities.find((f) => f.id === 'W')!.id = 'STORE';
    });
    expect(snapshot(s.ctx).trucks.map((t) => [t.warehouse, t.id])).toEqual([
      ['STORE', 1],
      ['STORE', 2],
    ]);
  });
});
