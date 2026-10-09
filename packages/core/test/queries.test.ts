import { describe, expect, it } from 'vitest';
import { type Datasheet, datasheet } from '../src/datasheet.ts';
import { alertsView, firmwareView, inspectBoard, listBoards, logsView, mapView, snapshot, statusView, timeView } from '../src/queries.ts';
import { sensorFrame } from '../src/sensors.ts';
import { Session } from '../src/session.ts';
import { FakeHost } from './helpers/fake-host.ts';
import { m1Scenario } from './helpers/scenarios.ts';

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

describe('views', () => {
  it('formats game time', () => {
    const { s } = session();
    expect(timeView(s.scenario, 0)).toEqual({ day: 1, clock: '00:00', seconds: 0 });
    expect(timeView(s.scenario, 800 + 400)).toEqual({ day: 2, clock: '12:00', seconds: 60 });
  });

  it('lists boards with their firmware state', () => {
    const { s } = session();
    s.deploy('DA', 'hello');
    expect(listBoards(s.world)[1]).toMatchObject({ id: 'DA', kind: 'datacenter', firmwareVersion: null, pendingVersion: 1 });
    for (let i = 0; i < 4; i++) s.step();
    expect(listBoards(s.world)[1]).toMatchObject({ firmwareVersion: 1, pendingVersion: null, status: 'running', lastError: null });
  });

  it('describes a datacenter board completely enough to program it', () => {
    const { s } = session();
    const d = datasheet(s.ctx, 'DA')!;
    expect(d.parts).toMatchObject({ clockHz: 5, instructionsPerTick: 2000, ramBytes: 8192 });
    expect(d.io.reads.map((r) => r.name)).toEqual(['temp', 'power_headroom', 'price', 'emf', 'luddite_dist', 'day', 'clock']);
    expect(d.io.actions.map((a) => a.call)).toEqual(['io.process()', 'io.cool(level)', 'io.log(...)', 'io.sleep(seconds)']);
    expect(d.baseEmfPerSecond).toBe(25);
    expect(d.rules.join('\n')).toContain('string.find');
    expect(datasheet(s.ctx, 'P')!.io.actions.map((a) => a.call)).toContain('io.set_priority({ids})');
    expect(datasheet(s.ctx, 'ZZ')).toBeNull();
  });

  it("tells the agent how the sandbox behaves after its hardening, in the datasheet's rules", () => {
    const { s } = session();
    const rules = datasheet(s.ctx, 'DA')!.rules.join('\n');
    // One short key phrase per point. This pins that the agent is told; what the sandbox does is the firmware package's to test.
    const points: Array<[string, string]> = [
      ['only mem carries over a deploy, and each install gets a fresh io', 'fresh io'],
      ["RAM counts the firmware's data above a baseline, and its code doesn't count", "Code doesn't count"],
      ['mem keeps its data after "out of RAM", so a deploy should free it first thing', 'frees what it no longer needs'],
      ['the first tick of that deploy gets a little extra room', 'extra room'],
      ['string.format refuses %p', 'refuses %p'],
      ['tostring never shows an address', 'never shows an address'],
      ['coroutine.close is not available', "coroutine.close isn't available"],
      ['a coroutine that errors is never closed, so its <close> handlers do not run', "<close> handlers don't run"],
      ['an xpcall handler runs after the stack has unwound', 'after the stack has unwound'],
    ];
    const missing = points.filter(([, phrase]) => !rules.includes(phrase)).map(([point]) => point);
    expect(missing).toEqual([]);
  });

  it('says that io.log is not an action, and what an aborted tick drops and what it keeps', () => {
    const { s } = session();
    const sheet = datasheet(s.ctx, 'DA')!;
    const log = sheet.io.actions.find((a) => a.call === 'io.log(...)')!.meaning; // io.log stays in the list of calls
    const rules = sheet.rules.join('\n');
    const points: Array<[string, string, string]> = [
      ['io.log is not an action', log, 'It is not an action'],
      ['it adds no action EMF', log, 'adds no action EMF'],
      ['its lines are kept when the tick fails', log, 'kept when the tick fails'],
      ['the EMF per action leaves io.log out', rules, "(io.log isn't one)"],
      [
        'an aborted tick drops its actions but keeps its log lines and its writes to mem',
        rules,
        'its log lines and the writes it made to mem stay',
      ],
    ];
    const missing = points.filter(([, text, phrase]) => !text.includes(phrase)).map(([point]) => point);
    expect(missing).toEqual([]);
  });

  it('reads logs with game time, and filters by time', () => {
    const { s } = session();
    s.deploy('DA', 'hello');
    for (let i = 0; i < 40; i++) s.step(); // beats at 3, 7, ..., 39
    const all = logsView(s.ctx, 'DA')!;
    expect(all[0]).toMatchObject({ kind: 'system', text: 'firmware v1 installed', day: 1 });
    expect(all[1]).toMatchObject({ kind: 'log', text: 'hello', repeat: 10 });
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
    s.world.boards[2]!.status = 'destroyed';
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
    expect(snap.rebuild).toEqual({ cost: 500, hours: 12 });
    expect(snap.emf).toHaveLength(240);
    expect(snap.luddites[0]!.path.at(-1)).toEqual([16, 8]);
    expect(snap.boards.map((b) => b.id)).toEqual(['P', 'DA', 'DB']);
    expect(snap.boards[1]!.tempC).toBe(25);
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
    expect(listBoards(s.world)).toEqual([
      { id: 'P', kind: 'power', x: 4, y: 4, status: 'asleep', powered: true, firmwareVersion: null, pendingVersion: null, lastError: null },
      {
        id: 'DA',
        kind: 'datacenter',
        x: 5,
        y: 4,
        status: 'running',
        powered: true,
        firmwareVersion: 1,
        pendingVersion: null,
        lastError: 'runtime: boom',
      },
      {
        id: 'DB',
        kind: 'datacenter',
        x: 16,
        y: 8,
        status: 'running',
        powered: false,
        firmwareVersion: null,
        pendingVersion: null,
        lastError: null,
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
    const [installed, hello] = logsView(s.ctx, 'P')!;
    expect(installed).toEqual({ day: 1, clock: '00:00', seconds: 0, kind: 'system', text: 'firmware v1 installed', repeat: 1 });
    expect(hello).toEqual({ day: 1, clock: '00:36', seconds: 1, kind: 'log', text: 'hello', repeat: 5 });
    expect(logsView(s.ctx, 'P', 0)).toEqual([hello]); // "after" is exclusive: the line at second 0 is out
    expect(logsView(s.ctx, 'P', 0.95)).toEqual([hello]);
    expect(logsView(s.ctx, 'P', 1)).toEqual([]);
  });

  it('maps each facility with its position, state, power, and distance to the plant', () => {
    const { s } = shortOfPower();
    s.step();
    s.world.boards[1]!.status = 'destroyed';
    expect(mapView(s.ctx)).toEqual({
      width: 20,
      height: 12,
      facilities: [
        { id: 'P', kind: 'power', x: 4, y: 4, status: 'running', powered: true, distanceToPlant: 0 },
        { id: 'DA', kind: 'datacenter', x: 5, y: 4, status: 'destroyed', powered: true, distanceToPlant: 1 },
        { id: 'DB', kind: 'datacenter', x: 16, y: 8, status: 'running', powered: false, distanceToPlant: 16 },
      ],
    });
  });

  it('reports the time, the season length, the power, and how the season ended', () => {
    const { s } = shortOfPower();
    for (let i = 0; i < 20; i++) s.step();
    // Power: 20 generated against 5 + 10 + 13 requested, so DB is shed. Money: 5000 less 20 steps of upkeep (37,500 micro-units each).
    expect(statusView(s.ctx)).toEqual({
      time: { day: 1, clock: '00:36', seconds: 1 },
      seasonDays: 30,
      money: 4999,
      power: { generation: 20, demand: 28, shed: ['DB'] },
      ended: null,
    });
    s.world.ended = { kind: 'bankrupt', step: 20 };
    expect(statusView(s.ctx).ended).toEqual({ kind: 'bankrupt', step: 20 });
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

  it('snapshots the plant and every board of a busy town', () => {
    const { s, host } = session();
    host.program('plant', () => ({
      actions: [
        { kind: 'setThermal', output: 100 },
        { kind: 'setPriority', order: ['DB'] },
      ],
    }));
    host.program('busy', () => ({
      actions: [{ kind: 'process' }, { kind: 'cool', level: 2 }],
    }));
    host.program('boom', () => ({ error: { kind: 'runtime', message: 'boom' } }));
    s.deploy('P', 'plant');
    s.deploy('DA', 'busy');
    s.deploy('DB', 'boom');
    for (let i = 0; i < 8; i++) s.step();
    s.world.datacenters.DA!.tempMilli = 61_999;
    const snap = snapshot(s.ctx);
    // Phase 3 of step 7: 220 wind + 100 thermal against P 5, DA 10 + 150 (its job runs through step 7) + 2 x 20 cooling, plus 2% of that
    // for one cell (4), and DB 10 + 3. The job that DA renewed at step 7 covers step 8 too.
    expect(snap.plant).toEqual({
      wind: 220,
      thermal: 100,
      fuelPrice: s.world.plant.fuelPrice,
      generation: 320,
      demand: 222,
      shed: [],
      priority: ['DB', 'DA'],
    });
    expect(snap.plant.fuelPrice).toBeGreaterThan(0);
    expect(snap.boards).toEqual([
      {
        id: 'P',
        kind: 'power',
        x: 4,
        y: 4,
        status: 'running',
        powered: true,
        hasFirmware: true,
        erroring: false,
        tempC: null,
        processing: false,
        cooling: 0,
        demand: 5,
      },
      {
        id: 'DA',
        kind: 'datacenter',
        x: 5,
        y: 4,
        status: 'running',
        powered: true,
        hasFirmware: true,
        erroring: false,
        tempC: 61,
        processing: true,
        cooling: 2,
        demand: 204,
      },
      {
        id: 'DB',
        kind: 'datacenter',
        x: 16,
        y: 8,
        status: 'running',
        powered: true,
        hasFirmware: true,
        erroring: true,
        tempC: 25,
        processing: false,
        cooling: 0,
        demand: 13,
      },
    ]);
  });

  it('snapshots which facilities the plant sheds, the state and power of every board, and whole money rounded down', () => {
    const { s } = shortOfPower();
    s.step();
    s.world.boards[1]!.status = 'destroyed';
    s.world.money = 4_999_999_999; // 4999.999999 money units
    const snap = snapshot(s.ctx);
    expect(snap.plant).toMatchObject({ wind: 20, thermal: 0, generation: 20, demand: 28, shed: ['DB'] });
    expect(snap.boards.map((b) => [b.id, b.status, b.powered])).toEqual([
      ['P', 'running', true],
      ['DA', 'destroyed', true],
      ['DB', 'running', false],
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

  it("tells the viewer what a rebuild costs and how many game hours it takes, rounded down, from the scenario's day", () => {
    const { s } = session((j) => {
      j.time.secondsPerDay = 70;
      j.tuning.rebuild = { cost: 120, seconds: 20 };
    });
    expect(snapshot(s.ctx).rebuild).toEqual({ cost: 120, hours: 6 }); // 20 s of a 70 s day is 6.86 hours
  });

  it('counts a firmware that waits for its first tick as the board having firmware', () => {
    const { s } = session();
    const has = () => snapshot(s.ctx).boards.map((b) => b.hasFirmware);
    expect(has()).toEqual([false, false, false]);
    s.deploy('DA', 'hello');
    expect(has()).toEqual([false, true, false]);
    for (let i = 0; i < 4; i++) s.step();
    expect(has()).toEqual([false, true, false]);
  });

  it("shows the viewer's panel the board's own datasheet, its waiting firmware, and its last 50 log lines", () => {
    const { s, host } = session();
    host.program('count', (_sensors, mem) => {
      mem.n = ((mem.n as number | undefined) ?? 0) + 1;
      return { logs: [`line ${mem.n}`] };
    });
    s.deploy('DA', 'count');
    for (let i = 0; i < 240; i++) s.step(); // DA beats at 3, 7, ..., 239: the install line, then sixty log lines
    s.deploy('DA', 'hello');
    const panel = inspectBoard(s.ctx, 'DA')!;
    expect(panel.datasheet.board).toBe('DA');
    expect(panel.firmware).toEqual({ version: 1, source: 'count' });
    expect(panel.pending).toEqual({ version: 2, source: 'hello' });
    expect(panel.logs).toHaveLength(50);
    expect(panel.logs[0]!.text).toBe('line 11');
    expect(panel.logs.at(-1)!.text).toBe('line 60');
    expect(inspectBoard(s.ctx, 'ZZ')).toBeNull();
  });

  it('describes where a board stands, what it draws now, and the state of its firmware', () => {
    const { s, host } = session();
    host.program('busy', () => ({ actions: [{ kind: 'process' }], instructions: 321 }));
    expect(datasheet(s.ctx, 'DA')).toMatchObject({
      facility: { kind: 'datacenter', x: 5, y: 4, distanceToPlant: 1 },
      powerDrawNow: 10,
      firmware: { version: null, pendingVersion: null, lastInstructions: null, lastError: null, ramUsedBytes: null },
    });
    s.deploy('DA', 'busy');
    for (let i = 0; i < 4; i++) s.step(); // the first tick at step 3 starts a job that covers step 4: 10 + 150, and 2% of that for one cell
    s.deploy('DA', 'hello');
    expect(datasheet(s.ctx, 'DA')).toMatchObject({
      powerDrawNow: 163,
      firmware: { version: 1, pendingVersion: 2, lastInstructions: 321, lastError: null, ramUsedBytes: 0 },
    });
  });

  it('describes a board far from the plant, and what its last error was', () => {
    const { s, host } = session();
    host.program('boom', () => ({ error: { kind: 'runtime', message: 'boom' } }));
    s.deploy('DB', 'boom');
    for (let i = 0; i < 3; i++) s.step(); // DB beats at step 2
    expect(datasheet(s.ctx, 'DB')).toMatchObject({
      facility: { kind: 'datacenter', x: 16, y: 8, distanceToPlant: 16 },
      powerDrawNow: 13,
      firmware: { version: 1, lastError: 'runtime: boom' },
    });
    expect(datasheet(s.ctx, 'P')).toMatchObject({ facility: { kind: 'power', x: 4, y: 4, distanceToPlant: 0 }, powerDrawNow: 5 });
  });

  it('names the io fields the board really gets, and documents each one on its own', () => {
    const { s } = session();
    for (const board of s.world.boards) {
      const reads = datasheet(s.ctx, board.id)!.io.reads;
      expect(reads.map((r) => r.name).sort(), board.id).toEqual(Object.keys(sensorFrame(s.ctx, board)).sort());
      for (const r of reads) {
        expect(r.unit, `${board.id} ${r.name}`).not.toBe('');
        expect(r.meaning, `${board.id} ${r.name}`).not.toBe('');
      }
      expect(new Set(reads.map((r) => r.meaning)).size, board.id).toBe(reads.length);
    }
    expect(datasheet(s.ctx, 'P')!.io.reads.map((r) => r.name)).toEqual(['wind', 'demand', 'fuel_price', 'day', 'clock']);
    expect(datasheet(s.ctx, 'P')!.io.actions.map((a) => a.call)).toEqual([
      'io.set_thermal(output)',
      'io.set_priority({ids})',
      'io.log(...)',
      'io.sleep(seconds)',
    ]);
  });
});

// The datasheet is the agent's only source for what a call costs and does, so the numbers in its text are the scenario's.
describe('the datasheet text and the scenario', () => {
  const callOf = (sheet: Datasheet, call: string): string => sheet.io.actions.find((a) => a.call === call)!.meaning;
  const readOf = (sheet: Datasheet, name: string): string => sheet.io.reads.find((r) => r.name === name)!.meaning;

  it('writes the numbers of the m1 scenario as the text always read', () => {
    const { s } = session();
    const da = datasheet(s.ctx, 'DA')!;
    const plant = datasheet(s.ctx, 'P')!;
    expect(callOf(da, 'io.process()')).toContain('draws 150 power, and heats the datacenter (+2 °C/s)');
    expect(callOf(da, 'io.cool(level)')).toContain('level 0-3; each level takes 0.8 °C/s off and draws 20 power');
    expect(readOf(da, 'temp')).toContain('above 90 it can catch fire');
    expect(callOf(plant, 'io.set_thermal(output)')).toContain('0-300 power units');
    expect(callOf(da, 'io.sleep(seconds)')).toContain('deep sleep for 1-40 s');
    const rules = da.rules.join('\n');
    expect(rules).toContain('EMF per tick = instructions / 100 + 10 per action');
    expect(rules).toContain("A facility's power draw grows 2% for each cell between it and the plant");
  });

  it('writes the numbers of the scenario it describes, so a retuned town reads differently', () => {
    const { s } = session((j) => {
      j.tuning.datacenter.processPower = 170;
      j.tuning.datacenter.heatMilliPerSecond = 3_500;
      j.tuning.datacenter.maxCoolingLevel = 5;
      j.tuning.datacenter.coolingMilliPerLevelPerSecond = 50;
      j.tuning.datacenter.coolingPowerPerLevel = 30;
      j.tuning.datacenter.fireThresholdMilli = 95_050;
      j.tuning.thermal.max = 400;
      j.tuning.maxSleepSeconds = 25;
      j.tuning.emf.instructionsPerUnit = 50;
      j.tuning.emf.perAction = 7;
      j.tuning.transmissionLossPctPerCell = 3;
    });
    const da = datasheet(s.ctx, 'DA')!;
    const plant = datasheet(s.ctx, 'P')!;
    expect(callOf(da, 'io.process()')).toContain('draws 170 power, and heats the datacenter (+3.5 °C/s)');
    expect(callOf(da, 'io.cool(level)')).toContain('level 0-5; each level takes 0.05 °C/s off and draws 30 power');
    expect(readOf(da, 'temp')).toContain('above 95.05 it can catch fire');
    expect(callOf(plant, 'io.set_thermal(output)')).toContain('0-400 power units');
    expect(callOf(da, 'io.sleep(seconds)')).toContain('deep sleep for 1-25 s');
    const rules = da.rules.join('\n');
    expect(rules).toContain('EMF per tick = instructions / 50 + 7 per action');
    expect(rules).toContain("A facility's power draw grows 3% for each cell between it and the plant");
  });
});
