import { describe, expect, it } from 'vitest';
import { stateHash } from '../src/hash.ts';
import { pathTo, runLuddites, spawnRaid, strongestTarget } from '../src/luddites.ts';
import type { Rng } from '../src/rng.ts';
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

/** Puts an exact amount of milli-EMF in the cell under a board. */
function setMilli(s: Session, id: string, milli: number): void {
  const b = s.world.boards.find((x) => x.id === id)!;
  s.world.emf[cellIndex(s.scenario, b.x, b.y)] = milli;
}

/** Like session(), but the field neither spreads nor fades, and the gauge is out of reach unless a test lowers it. */
function dry(change?: Parameters<typeof m1Scenario>[0]): Session {
  return session((j) => {
    j.tuning.emf.diffusionPctPerSecond = 0;
    j.tuning.emf.decayPctPerSecond = 0;
    j.tuning.emf.rumourThreshold = 1_000_000_000;
    change?.(j);
  });
}

/** A luddites stream that answers int() from a script and records the bounds it was asked for. */
function scripted(answers: number[]): { rng: Rng; asked: Array<[number, number]> } {
  const asked: Array<[number, number]> = [];
  const rng: Rng = {
    nextU32: () => 0,
    int: (lo, hi) => {
      asked.push([lo, hi]);
      const answer = answers.shift();
      if (answer === undefined) throw new Error('the scripted stream has no answer left');
      return answer;
    },
    chancePpm: () => false,
  };
  return { rng, asked };
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

  it('walks left and up as well as right and down', () => {
    expect(pathTo(4, 3, 2, 1)).toEqual([
      [3, 3],
      [2, 3],
      [2, 2],
      [2, 1],
    ]);
    expect(pathTo(2, 3, 4, 1)).toEqual([
      [3, 3],
      [4, 3],
      [4, 2],
      [4, 1],
    ]);
    expect(pathTo(4, 1, 2, 3)).toEqual([
      [3, 1],
      [2, 1],
      [2, 2],
      [2, 3],
    ]);
  });

  it('puts a raid on the side the stream picks and the place it picks along that side, and names the side', () => {
    const cases = [
      { word: '북쪽', side: 0, along: 15, at: [15, 0], bounds: [0, 19] },
      { word: '남쪽', side: 1, along: 15, at: [15, 11], bounds: [0, 19] },
      { word: '서쪽', side: 2, along: 9, at: [0, 9], bounds: [0, 11] },
      { word: '동쪽', side: 3, along: 9, at: [19, 9], bounds: [0, 11] },
    ];
    for (const c of cases) {
      const s = session();
      const { rng, asked } = scripted([c.side, c.along]);
      Object.assign(s.ctx.rng, { luddites: rng });
      const g = spawnRaid(s.ctx, 7);
      expect(asked, c.word).toEqual([[0, 3], c.bounds]); // the side, then the place along a side as long as it is
      expect(g, c.word).toEqual({ id: 1, x: c.at[0], y: c.at[1], size: 3, targetId: null, quietSince: null, leaving: false, warned: [] });
      expect(s.world.luddites, c.word).toEqual([g]);
      expect(s.world.stats.raids, c.word).toBe(1);
      expect(s.world.alerts, c.word).toMatchObject([{ kind: 'raid', step: 7, facilityId: null }]);
      expect(s.world.alerts[0]!.message, c.word).toContain(c.word); // the side it came from
      expect(s.world.alerts[0]!.message, c.word).toContain('3명');
    }
  });

  it('gives every group the next id and the size the tuning sets', () => {
    const s = session((j) => {
      j.tuning.luddites.groupSize = 5;
    });
    const a = spawnRaid(s.ctx, 0);
    const b = spawnRaid(s.ctx, 0);
    expect([a.id, b.id, a.size, b.size]).toEqual([1, 2, 5, 5]);
    expect(s.world.luddites.map((g) => g.id)).toEqual([1, 2]);
    expect(s.world.stats.raids).toBe(2);
    expect(s.world.alerts[0]!.message).toContain('5명');
  });

  it('lets the seed choose the spawn point', () => {
    const spots = new Set<string>();
    for (let seed = 1; seed <= 12; seed++) {
      const g = spawnRaid(session(undefined, new FakeHost(), seed).ctx, 0);
      spots.add(`${g.x},${g.y}`);
    }
    expect(spots.size).toBeGreaterThan(5);
  });

  it('collects the field total once a second, after the EMF phase, and empties the gauge on a raid', () => {
    // Base EMF only, 3.5 EMF a step in all, and nothing spreads or fades: the field holds 70 EMF after a second, 140 after two.
    const s = dry((j) => {
      j.tuning.emf.rumourThreshold = 200;
    });
    const rumour: number[] = [];
    for (let i = 0; i < 60; i++) {
      s.step();
      rumour.push(s.world.rumour);
    }
    // 70 at step 19, 70 + 140 = 210 at step 39 (a raid, and an empty gauge), 210 again at step 59.
    expect(rumour).toEqual([...new Array<number>(19).fill(0), ...new Array<number>(20).fill(70), ...new Array<number>(21).fill(0)]);
    expect(s.world.alerts.filter((a) => a.kind === 'raid').map((a) => a.step)).toEqual([39, 59]);
    expect(s.world.stats.raids).toBe(2);
    expect(s.world.luddites.map((g) => g.id)).toEqual([1, 2]);
  });

  it('brings a raid when the gauge reaches the threshold exactly, and not a unit short of it', () => {
    for (const [threshold, raids] of [
      [210, 1],
      [211, 0],
    ] as const) {
      const s = dry((j) => {
        j.tuning.emf.rumourThreshold = threshold;
      });
      for (let i = 0; i < 40; i++) s.step(); // the gauge collects 70 at step 19 and 140 more at step 39
      expect(s.world.stats.raids, `threshold ${threshold}`).toBe(raids);
      expect(s.world.rumour, `threshold ${threshold}`).toBe(raids === 1 ? 0 : 210);
    }
  });

  it('detects a board at exactly the detection threshold of the tuning, and not a milli-unit below it', () => {
    const s = session((j) => {
      j.tuning.emf.detectionThreshold = 8;
    });
    s.world.emf.fill(0);
    setMilli(s, 'DB', 7_999);
    expect(strongestTarget(s.ctx)).toBeNull();
    setMilli(s, 'DB', 8_000);
    expect(strongestTarget(s.ctx)?.id).toBe('DB');
  });

  it('keeps hunting a sleeping board while its cell is loud, but not a board that is being rebuilt', () => {
    const s = session();
    s.world.emf.fill(0);
    setEmf(s, 'DB', 50);
    s.world.boards[2]!.status = 'asleep';
    expect(strongestTarget(s.ctx)?.id).toBe('DB');
    s.world.boards[2]!.status = 'rebuilding';
    expect(strongestTarget(s.ctx)).toBeNull();
  });

  it('walks its path one cell a beat, left and up as well as right and down, and smashes on the last cell', () => {
    const s = session();
    const g = group(s, 7, 6); // P is at (4, 4): left along the row, then up the column
    const trail: Array<[number, number]> = [];
    const standing: string[] = [];
    for (let beat = 0; beat < 5; beat++) {
      s.world.emf.fill(0);
      setEmf(s, 'P', 40);
      runLuddites(s.ctx, beat * 20);
      trail.push([g.x, g.y]);
      standing.push(s.world.boards[0]!.status);
    }
    expect(trail).toEqual([
      [6, 6],
      [5, 6],
      [4, 6],
      [4, 5],
      [4, 4],
    ]);
    expect(standing).toEqual(['running', 'running', 'running', 'running', 'destroyed']);
    expect(s.world.boards[0]!.log.at(-1)).toMatchObject({ kind: 'system', text: 'smashed by Luddites' });
    expect(s.world.alerts.filter((a) => a.kind === 'boardDestroyed')).toMatchObject([{ step: 80, facilityId: 'P' }]);
  });

  it('re-aims at every cell: when another board gets louder it turns toward that one', () => {
    const s = session();
    const g = group(s, 10, 6);
    s.world.emf.fill(0);
    setEmf(s, 'DA', 30); // (5, 4)
    setEmf(s, 'DB', 40); // (16, 8)
    runLuddites(s.ctx, 0);
    expect([g.x, g.y, g.targetId]).toEqual([11, 6, 'DB']); // along the row, to the right
    setEmf(s, 'DA', 60);
    runLuddites(s.ctx, 20);
    expect([g.x, g.y, g.targetId]).toEqual([10, 6, 'DA']); // and back to the left
  });

  it('heads on for the next strongest board after a smash', () => {
    const s = session();
    const g = group(s, 16, 7);
    const loud = () => {
      s.world.emf.fill(0);
      setEmf(s, 'DB', 50);
      setEmf(s, 'DA', 30);
    };
    loud();
    runLuddites(s.ctx, 0); // one cell down: DB is smashed
    expect(s.world.boards[2]!.status).toBe('destroyed');
    loud();
    runLuddites(s.ctx, 20); // DB's cell is still the loudest, but DB is gone: DA is next, along the row to the left
    expect([g.x, g.y, g.targetId]).toEqual([15, 8, 'DA']);
  });

  it('moves at the beat the cells-per-second tuning sets', () => {
    const s = session((j) => {
      j.tuning.luddites.cellsPerSecond = 4; // a beat every 5 steps
    });
    const g = group(s, 16, 0);
    setEmf(s, 'DB', 50);
    const rows: number[] = [];
    for (let step = 0; step < 12; step++) {
      runLuddites(s.ctx, step);
      rows.push(g.y);
    }
    expect(rows).toEqual([1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 3, 3]);
  });

  it("follows the scenario's steps a second: the gauge collects on a second's last step, and the groups move once a second", () => {
    const s = dry((j) => {
      j.time.stepsPerSecond = 40; // the boards' clocks of 4 and 5 Hz still divide it
    });
    const g = group(s, 16, 0);
    setEmf(s, 'DB', 50);
    const collected: number[] = [];
    const moved: number[] = [];
    for (let i = 0; i < 120; i++) {
      const before = { rumour: s.world.rumour, row: g.y };
      s.step();
      if (s.world.rumour !== before.rumour) collected.push(i);
      if (g.y !== before.row) moved.push(i);
    }
    expect(collected).toEqual([39, 79, 119]);
    expect(moved).toEqual([0, 40, 80]);
  });

  it("counts the quiet time in the scenario's seconds, whatever its steps a second", () => {
    const s = session((j) => {
      j.time.stepsPerSecond = 40;
      j.tuning.luddites.quietSecondsToLeave = 3;
    });
    const g = group(s, 10, 2);
    s.world.emf.fill(0);
    const leaving: boolean[] = [];
    for (let beat = 0; beat < 4; beat++) {
      runLuddites(s.ctx, beat * 40); // a beat every 40 steps
      leaving.push(g.leaving);
    }
    expect(leaving).toEqual([false, false, false, true]);
  });

  it('raises the approach alert when the group comes within the reach of the tuning, by the distance in cells', () => {
    const s = session((j) => {
      j.tuning.luddites.approachCells = 4;
    });
    group(s, 10, 5); // DB is at (16, 8): 9 cells away, then 8, 7, 6, 5, and 4 after the fifth move
    setEmf(s, 'DB', 50);
    const alerts: number[] = [];
    for (let beat = 0; beat < 6; beat++) {
      runLuddites(s.ctx, beat * 20);
      alerts.push(s.world.alerts.filter((a) => a.kind === 'ludditesNear').length);
    }
    expect(alerts).toEqual([0, 0, 0, 0, 1, 1]);
    const near = s.world.alerts.find((a) => a.kind === 'ludditesNear');
    expect(near).toMatchObject({ step: 80, facilityId: 'DB' });
    expect(near!.message).toContain('4칸'); // the distance it was raised at
  });

  it('raises no approach alert for a board that is destroyed or being rebuilt', () => {
    const s = session();
    s.world.boards[0]!.status = 'destroyed'; // P at (4, 4)
    s.world.boards[1]!.status = 'rebuilding'; // DA at (5, 4)
    group(s, 7, 4); // after its first step it is 4 cells from P and 3 from DA, on its way to DB
    setEmf(s, 'DB', 50);
    runLuddites(s.ctx, 0);
    expect(s.world.alerts.filter((a) => a.kind === 'ludditesNear')).toEqual([]);
  });

  it('leaves after exactly the quiet time of the tuning, by whichever edge is nearest', () => {
    const s = session((j) => {
      j.tuning.luddites.quietSecondsToLeave = 3;
    });
    s.world.emf.fill(0);
    const groups = [group(s, 10, 2), group(s, 3, 9), group(s, 17, 5), group(s, 2, 5)]; // nearest edges: north, south, east, west
    const leaving: boolean[][] = [];
    const where: string[][] = [];
    for (let beat = 0; beat < 7; beat++) {
      runLuddites(s.ctx, beat * 20);
      leaving.push(groups.map((g) => g.leaving));
      where.push(s.world.luddites.map((g) => `${g.x},${g.y}`));
    }
    // quiet since step 0: not leaving at 0, 1 and 2 seconds, leaving at 3 s; one cell a beat from the next beat on
    const stay = [false, false, false, false];
    const go = [true, true, true, true];
    expect(leaving).toEqual([stay, stay, stay, go, go, go, go]);
    expect(where).toEqual([
      ['10,2', '3,9', '17,5', '2,5'],
      ['10,2', '3,9', '17,5', '2,5'],
      ['10,2', '3,9', '17,5', '2,5'],
      ['10,2', '3,9', '17,5', '2,5'],
      ['10,1', '3,10', '18,5', '1,5'],
      ['10,0', '3,11', '19,5', '0,5'],
      [], // standing on the edge, every group is gone on the next beat
    ]);
  });

  it('removes the group that has reached the edge, and no other', () => {
    const s = session();
    const staying = group(s, 10, 8); // on its way to DB
    const gone = group(s, 0, 5); // already leaving, and on the west edge
    gone.leaving = true;
    s.world.emf.fill(0);
    setEmf(s, 'DB', 50);
    runLuddites(s.ctx, 0);
    expect(s.world.luddites).toEqual([staying]);
    expect([staying.x, staying.y]).toEqual([11, 8]);
  });

  it('starts the quiet time over whenever a board is loud again', () => {
    const s = session((j) => {
      j.tuning.luddites.quietSecondsToLeave = 3;
    });
    const g = group(s, 10, 2);
    s.world.emf.fill(0);
    for (let beat = 0; beat < 3; beat++) runLuddites(s.ctx, beat * 20);
    expect(g).toMatchObject({ leaving: false, quietSince: 0, targetId: null });
    setEmf(s, 'DB', 50);
    runLuddites(s.ctx, 60); // 3 s on, a board is loud: a step toward it instead of leaving
    expect(g).toMatchObject({ leaving: false, quietSince: null, targetId: 'DB', x: 11, y: 2 });
    s.world.emf.fill(0);
    for (let beat = 4; beat < 7; beat++) runLuddites(s.ctx, beat * 20);
    expect(g).toMatchObject({ leaving: false, quietSince: 80, targetId: null }); // quiet again since step 80, for 2 s
    runLuddites(s.ctx, 140);
    expect(g.leaving).toBe(true);
  });

  it('keeps leaving once it has set out, even when a board gets loud', () => {
    const s = session((j) => {
      j.tuning.luddites.quietSecondsToLeave = 1;
    });
    const g = group(s, 10, 2);
    s.world.emf.fill(0);
    runLuddites(s.ctx, 0);
    runLuddites(s.ctx, 20);
    expect(g.leaving).toBe(true);
    setEmf(s, 'DB', 80);
    runLuddites(s.ctx, 40);
    expect(g).toMatchObject({ x: 10, y: 1, leaving: true }); // one cell toward the north edge, not toward DB
  });

  it('smashes a board it already stands on, without taking a step', () => {
    const s = session();
    const g = group(s, 16, 8); // on DB
    setEmf(s, 'DB', 50);
    runLuddites(s.ctx, 0);
    expect(g).toMatchObject({ x: 16, y: 8 });
    expect(s.world.boards[2]!.status).toBe('destroyed');
  });

  it('has a second group choose its target after the first has smashed', () => {
    const s = session();
    const first = group(s, 15, 8); // one cell from DB
    const second = group(s, 10, 8);
    s.world.emf.fill(0);
    setEmf(s, 'DB', 50);
    setEmf(s, 'DA', 40);
    setEmf(s, 'P', 30);
    runLuddites(s.ctx, 0);
    expect(s.world.boards[2]!.status).toBe('destroyed');
    expect([first.x, first.y]).toEqual([16, 8]);
    expect([second.x, second.y, second.targetId]).toEqual([9, 8, 'DA']); // on for DA, not toward the board that is gone
  });

  it('walks a cell a second as the world steps, on its beats and once on each', () => {
    const s = dry();
    const g = group(s, 16, 5); // DB is at (16, 8)
    setEmf(s, 'DB', 50);
    const moved: number[] = [];
    for (let i = 0; i < 60; i++) {
      const before = g.y;
      s.step();
      if (g.y !== before) moved.push(i);
    }
    expect(moved).toEqual([0, 20, 40]);
    expect(s.world.alerts.find((a) => a.kind === 'boardDestroyed')).toMatchObject({ step: 40, facilityId: 'DB' });
  });

  it("looks at the field as this step's EMF phase left it", () => {
    const s = dry();
    group(s, 16, 7); // one cell above DB
    setMilli(s, 'DB', 4_000); // under the 5 EMF threshold until this step's base EMF of 1.25 is added
    s.step(); // step 0 is a beat
    expect(s.world.boards[2]!.status).toBe('destroyed');
  });

  it('moves a group in the step it appears when that step is a beat: the gauge comes first', () => {
    const s = dry((j) => {
      j.tuning.luddites.cellsPerSecond = 20; // a beat on every step
      j.tuning.emf.rumourThreshold = 70; // the first second's 75 EMF fills it, at step 19
      j.facilities[2]!.board.baseEmfPerSecond = 30; // DB is the loudest, so the group heads for it
    });
    const { rng } = scripted([2, 9]); // the west edge, at row 9
    Object.assign(s.ctx.rng, { luddites: rng });
    for (let i = 0; i < 19; i++) s.step();
    expect(s.world.luddites).toHaveLength(0);
    s.step();
    expect(s.world.luddites).toHaveLength(1);
    expect(s.world.luddites[0]).toMatchObject({ x: 1, y: 9 }); // already one cell in along the row
  });

  it('smashes before the fires roll, so a board smashed in a step does not also burn', () => {
    const s = dry();
    const sure: Rng = { nextU32: () => 0, int: (lo) => lo, chancePpm: () => true };
    Object.assign(s.ctx.rng, { fire: sure });
    s.world.datacenters.DB!.tempMilli = 140_000; // far above the fire threshold: a sure fire if the board still stands
    group(s, 16, 7);
    setEmf(s, 'DB', 50);
    s.step();
    expect(s.world.boards[2]!.log.at(-1)?.text).toBe('smashed by Luddites');
    expect(s.world.alerts.some((a) => a.kind === 'fire')).toBe(false);
  });

  it('replays its raids: the same seed gives the same world at every step', () => {
    const run = () =>
      session((j) => {
        j.tuning.emf.rumourThreshold = 200;
      });
    const a = run();
    const b = run();
    for (let i = 0; i < 20 * 60; i++) {
      a.step();
      b.step();
      expect(stateHash(b.world), `step ${i}`).toBe(stateHash(a.world));
    }
    expect(a.world.stats.raids).toBeGreaterThanOrEqual(2);
  });
});
