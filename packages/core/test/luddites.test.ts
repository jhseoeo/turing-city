import { describe, expect, it } from 'vitest';
import { pathTo, runLuddites, spawnRaid, strongestTarget } from '../src/luddites.ts';
import { Session } from '../src/session.ts';
import { cellIndex, type LudditeGroup } from '../src/world.ts';
import { FakeHost } from './helpers/fake-host.ts';
import { m1Scenario } from './helpers/scenarios.ts';

function session(change?: Parameters<typeof m1Scenario>[0], host = new FakeHost(), seed = 3): Session {
  const s = new Session(
    m1Scenario((j) => {
      j.tuning.wind.start = 220;
      j.tuning.wind.maxChangePerSecond = 0;
      change?.(j);
    }),
    seed,
    host,
  );
  s.world.plant.thermalSetting = 300;
  return s;
}

function setEmf(s: Session, id: string, units: number): void {
  const b = s.world.boards.find((x) => x.id === id)!;
  s.world.emf[cellIndex(s.scenario, b.x, b.y)] = units * 1000;
}

function group(s: Session, x: number, y: number): LudditeGroup {
  const g: LudditeGroup = { id: s.world.nextLudditeId++, x, y, size: 3, targetId: null, quietSince: null, leaving: false, warned: [] };
  s.world.luddites.push(g);
  return g;
}

describe('Luddites', () => {
  it('walks row first, then column', () => {
    expect(pathTo(2, 1, 4, 3)).toEqual([
      [3, 1],
      [4, 1],
      [4, 2],
      [4, 3],
    ]);
    expect(pathTo(4, 3, 4, 3)).toEqual([]);
  });

  it('targets the intact board with the strongest detectable EMF', () => {
    const s = session();
    s.world.emf.fill(0);
    setEmf(s, 'DA', 30);
    setEmf(s, 'DB', 50);
    expect(strongestTarget(s.ctx)?.id).toBe('DB');
    s.world.boards[2]!.status = 'destroyed';
    expect(strongestTarget(s.ctx)?.id).toBe('DA');
    setEmf(s, 'DA', 4); // below the threshold of 5
    setEmf(s, 'P', 0);
    expect(strongestTarget(s.ctx)).toBeNull();
  });

  it('spawns a raid on the map edge when the rumour gauge fills', () => {
    const s = session((j) => {
      j.tuning.emf.rumourThreshold = 200;
    });
    let steps = 0;
    while (s.world.stats.raids === 0 && steps < 20 * 120) {
      s.step();
      steps += 1;
    }
    expect(s.world.stats.raids).toBe(1);
    const g = s.world.luddites[0]!;
    // The gauge fills on a second's last step and groups move on its first, so it hasn't moved yet.
    expect(g.x === 0 || g.y === 0 || g.x === 19 || g.y === 11).toBe(true);
    expect(s.world.alerts.some((a) => a.kind === 'raid')).toBe(true);
    expect(s.world.rumour).toBeLessThan(200);
  });

  it('spawns at the same place for the same seed', () => {
    const a = session();
    const b = session();
    expect(spawnRaid(a.ctx, 0)).toEqual(spawnRaid(b.ctx, 0));
  });

  it('steps one cell a second toward its target and smashes it on arrival', () => {
    const s = session();
    const g = group(s, 16, 4); // DB is at (16, 8): four cells down
    for (let second = 0; second < 6; second++) {
      s.world.emf.fill(0);
      setEmf(s, 'DB', 50);
      runLuddites(s.ctx, second * 20);
    }
    expect(s.world.boards[2]!.status).toBe('destroyed');
    expect(g).toMatchObject({ x: 16, y: 8 });
    expect(s.world.alerts.filter((a) => a.kind === 'boardDestroyed')).toHaveLength(1);
  });

  it('moves only on its beat', () => {
    const s = session();
    const g = group(s, 16, 4);
    setEmf(s, 'DB', 50);
    runLuddites(s.ctx, 7); // not a multiple of 20
    expect(g).toMatchObject({ x: 16, y: 4 });
  });

  it('raises one approach alert per board', () => {
    const s = session();
    group(s, 16, 1);
    for (let second = 0; second < 6; second++) {
      setEmf(s, 'DB', 50);
      runLuddites(s.ctx, second * 20);
    }
    const near = s.world.alerts.filter((a) => a.kind === 'ludditesNear');
    expect(near).toHaveLength(1);
    expect(near[0]!.facilityId).toBe('DB');
  });

  it('gives up after 10 quiet seconds and leaves by the nearest edge', () => {
    const s = session();
    const g = group(s, 10, 2);
    for (let second = 0; second < 30 && s.world.luddites.length > 0; second++) {
      s.world.emf.fill(0);
      runLuddites(s.ctx, second * 20);
    }
    expect(g.leaving).toBe(true);
    expect(s.world.luddites).toHaveLength(0);
  });

  it('lets a board that sleeps escape', () => {
    const host = new FakeHost();
    const hider = host.program('hide', (sensors) => {
      const d = sensors.luddite_dist;
      return d !== undefined && d < 9
        ? { actions: [{ kind: 'sleep', seconds: 40 }] }
        : { instructions: 1500, actions: [{ kind: 'process' }] };
    });
    // Only the group this test places: no raid from the gauge.
    const s = session((j) => {
      j.tuning.emf.rumourThreshold = 1_000_000_000;
    }, host);
    s.deploy('DB', hider);
    for (let i = 0; i < 20 * 20; i++) s.step(); // let DB get loud
    group(s, 16, 0); // 8 cells from DB: it hides at once, and its cell fades before the group gets there
    for (let i = 0; i < 20 * 60; i++) s.step();
    expect(s.world.boards[2]!.status).not.toBe('destroyed');
  });
});
