import { describe, expect, it } from 'vitest';
import { wreckFacility } from '../src/boards.ts';
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

  it("lists boards with their firmware state, and the last tick's instructions and RAM", () => {
    const { s } = session();
    s.deploy('DA', 'hello');
    expect(listBoards(s.world)[1]).toMatchObject({
      id: 'DA',
      kind: 'datacenter',
      tier: 1,
      board: { firmwareVersion: null, pendingVersion: 1, lastInstructions: null, ramUsedBytes: null },
    });
    for (let i = 0; i < 4; i++) s.step();
    const da = s.world.boards[1]!;
    expect(listBoards(s.world)[1]).toMatchObject({
      board: {
        firmwareVersion: 1,
        pendingVersion: null,
        status: 'running',
        lastError: null,
        lastInstructions: da.lastTick!.instructions,
        ramUsedBytes: da.lastTick!.ramUsedBytes,
      },
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
    const tick = (i: number) => ({
      lastInstructions: s.world.boards[i]!.lastTick?.instructions ?? null,
      ramUsedBytes: s.world.boards[i]!.lastTick?.ramUsedBytes ?? null,
    });
    expect(listBoards(s.world)).toEqual([
      {
        id: 'P',
        kind: 'power',
        x: 4,
        y: 4,
        tier: 1,
        condition: 'ok',
        board: { ...board, ...tick(0), status: 'asleep', powered: true, firmwareVersion: null, lastError: null },
      },
      {
        id: 'DA',
        kind: 'datacenter',
        x: 5,
        y: 4,
        tier: 1,
        condition: 'ok',
        board: { ...board, ...tick(1), status: 'running', powered: true, firmwareVersion: 1, lastError: 'runtime: boom' },
      },
      {
        id: 'DB',
        kind: 'datacenter',
        x: 16,
        y: 8,
        tier: 1,
        condition: 'ok',
        board: { ...board, ...tick(2), status: 'running', powered: false, firmwareVersion: null, lastError: null },
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
    // step 13) plus 2% of that for one cell (3), and DB 10 + 3. DA's tick at step 7 did nothing: the job was still running.
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
    const running = { status: 'running', powered: true, hasFirmware: true, erroring: false };
    expect(snap.facilities.map((f) => [f.id, f.demand, f.board, f.datacenter])).toEqual([
      ['P', 5, running, null],
      // DA's job runs steps 4 to 13: at step 8, 6 of its 10 steps are left.
      ['DA', 163, running, { tempC: 61, processing: true, cooling: false, jobLeft: 600, coolLeft: 0 }],
      ['DB', 13, { ...running, erroring: true }, { tempC: 25, processing: false, cooling: false, jobLeft: 0, coolLeft: 0 }],
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
      datacenter: { tempC: 61, processing: true, cooling: false, jobLeft: 600, coolLeft: 0 },
      farm: null,
      warehouse: null,
      housing: null,
    });
    // A cooling cycle that covers this step, which ends the job: the datacenter shows it, and draws 10 + 400, and 2% of that (8).
    s.world.datacenters.DA!.busyUntil = 8;
    s.world.datacenters.DA!.coolFrom = 8;
    s.world.datacenters.DA!.coolUntil = 88;
    expect(snapshot(s.ctx).facilities[1]).toMatchObject({
      demand: 418,
      datacenter: { processing: false, cooling: true, jobLeft: 0, coolLeft: 1000 },
    });
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
    const running = {
      status: 'running',
      powered: true,
      firmwareVersion: null,
      pendingVersion: null,
      lastError: null,
      lastInstructions: null,
      ramUsedBytes: null,
    };
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
    w.datacenters.DA = { tempMilli: 61_999, busyFrom: 15, busyUntil: 30, coolFrom: -1, coolUntil: -1 }; // 10 of 20 steps left
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
    // DA processes on top of its board: 10 + 150, and 2% of that for one cell (3).
    expect(view('DA')).toEqual({
      ...plain,
      id: 'DA',
      kind: 'datacenter',
      x: 5,
      y: 4,
      tier: 1,
      demand: 163,
      board: { status: 'running', powered: true, hasFirmware: false, erroring: false },
      datacenter: { tempC: 61, processing: true, cooling: false, jobLeft: 500, coolLeft: 0 },
    });
    // A cooling cycle of 5 s (100 steps) that started 10 steps ago has 90% left.
    w.datacenters.DA = { tempMilli: 61_999, busyFrom: -1, busyUntil: -1, coolFrom: 10, coolUntil: 110 };
    expect(snapshot(s.ctx).facilities.find((f) => f.id === 'DA')!.datacenter).toEqual({
      tempC: 61,
      processing: false,
      cooling: true,
      jobLeft: 0,
      coolLeft: 900,
    });
    expect(view('DB')).toEqual({
      ...plain,
      id: 'DB',
      kind: 'datacenter',
      x: 16,
      y: 8,
      tier: 0,
      demand: 0,
      datacenter: { tempC: 25, processing: false, cooling: false, jobLeft: 0, coolLeft: 0 },
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
    s.step(); // paused before step 400, the step the repair is due: it still reads 1 hour, not 0
    expect(f1()).toMatchObject({ condition: 'repairing', repairHoursLeft: 1 });
    s.step(); // step 400 finishes the repair in its first phase
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
