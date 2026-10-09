import { describe, expect, it } from 'vitest';
import { datasheet } from '../src/datasheet.ts';
import { alertsView, inspectBoard, listBoards, logsView, mapView, snapshot, statusView, timeView } from '../src/queries.ts';
import { Session } from '../src/session.ts';
import { FakeHost } from './helpers/fake-host.ts';
import { m1Scenario } from './helpers/scenarios.ts';

function session(): { s: Session; host: FakeHost } {
  const host = new FakeHost();
  host.program('hello', () => ({ logs: ['hello'] }));
  const s = new Session(
    m1Scenario((j) => {
      j.tuning.wind.start = 220;
      j.tuning.wind.maxChangePerSecond = 0;
      j.tuning.emf.rumourThreshold = 1_000_000_000;
    }),
    1,
    host,
  );
  return { s, host };
}

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
    // One short key phrase per point; the behavior itself is pinned by the firmware package's tests.
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
