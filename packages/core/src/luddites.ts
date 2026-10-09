import { raiseAlert } from './alerts.ts';
import { destroyBoard } from './boards.ts';
import { fieldTotal } from './emf.ts';
import { idiv, MILLI } from './fixed.ts';
import { type BoardState, cellIndex, type LudditeGroup, manhattan, type SimContext } from './world.ts';

const SIDES = ['북쪽', '남쪽', '서쪽', '동쪽'] as const;

/** The cells from one point to another, along the row first, then the column. */
export function pathTo(fromX: number, fromY: number, toX: number, toY: number): Array<[number, number]> {
  const path: Array<[number, number]> = [];
  let x = fromX;
  let y = fromY;
  while (x !== toX) {
    x += Math.sign(toX - x);
    path.push([x, y]);
  }
  while (y !== toY) {
    y += Math.sign(toY - y);
    path.push([x, y]);
  }
  return path;
}

export function spawnRaid(ctx: SimContext, step: number): LudditeGroup {
  const { width, height } = ctx.scenario.grid;
  const r = ctx.rng.luddites;
  const side = r.int(0, 3);
  const along = side < 2 ? r.int(0, width - 1) : r.int(0, height - 1);
  const [x, y] = side === 0 ? [along, 0] : side === 1 ? [along, height - 1] : side === 2 ? [0, along] : [width - 1, along];
  const size = ctx.scenario.tuning.luddites.groupSize;
  const group: LudditeGroup = { id: ctx.world.nextLudditeId++, x, y, size, targetId: null, quietSince: null, leaving: false, warned: [] };
  ctx.world.luddites.push(group);
  ctx.world.stats.raids += 1;
  raiseAlert(ctx.world, step, 'raid', null, `러다이트 ${size}명이 나타났어요 (${SIDES[side]} 가장자리)`);
  return group;
}

/** Once a second the gauge collects the field's total; a full gauge brings a raid. */
export function runRumour(ctx: SimContext, step: number): void {
  const sps = ctx.scenario.time.stepsPerSecond;
  if (step % sps !== sps - 1) return;
  ctx.world.rumour += fieldTotal(ctx.world);
  if (ctx.world.rumour >= ctx.scenario.tuning.emf.rumourThreshold) {
    ctx.world.rumour = 0;
    spawnRaid(ctx, step);
  }
}

/** The intact board whose cell carries the strongest EMF at or above the detection threshold. */
export function strongestTarget(ctx: SimContext): BoardState | null {
  const threshold = ctx.scenario.tuning.emf.detectionThreshold * MILLI;
  let best: BoardState | null = null;
  let bestValue = -1;
  for (const b of ctx.world.boards) {
    if (b.status === 'destroyed' || b.status === 'rebuilding') continue;
    const v = ctx.world.emf[cellIndex(ctx.scenario, b.x, b.y)]!;
    if (v >= threshold && v > bestValue) {
      best = b;
      bestValue = v;
    }
  }
  return best;
}

function nearestEdgeStep(ctx: SimContext, g: LudditeGroup): [number, number] | null {
  const { width, height } = ctx.scenario.grid;
  const options: Array<[number, number, number]> = [
    [g.x, -1, 0],
    [width - 1 - g.x, 1, 0],
    [g.y, 0, -1],
    [height - 1 - g.y, 0, 1],
  ];
  let best = options[0]!;
  for (const o of options) if (o[0] < best[0]) best = o;
  return best[0] === 0 ? null : [best[1], best[2]];
}

function warnNearby(ctx: SimContext, g: LudditeGroup, step: number): void {
  const reach = ctx.scenario.tuning.luddites.approachCells;
  for (const b of ctx.world.boards) {
    if (b.status === 'destroyed' || b.status === 'rebuilding' || g.warned.includes(b.id)) continue;
    const d = manhattan(g.x, g.y, b.x, b.y);
    if (d <= reach) {
      g.warned.push(b.id);
      raiseAlert(ctx.world, step, 'ludditesNear', b.id, `러다이트가 ${b.id}에 다가오고 있어요 (${d}칸)`);
    }
  }
}

/** Phase 8: every group moves one cell on its beat, smashes what it reaches, or gives up and leaves. */
export function runLuddites(ctx: SimContext, step: number): void {
  const t = ctx.scenario.tuning.luddites;
  const sps = ctx.scenario.time.stepsPerSecond;
  if (step % idiv(sps, t.cellsPerSecond) !== 0) return;
  for (const g of [...ctx.world.luddites]) {
    if (g.leaving) {
      const dir = nearestEdgeStep(ctx, g);
      if (dir === null) ctx.world.luddites.splice(ctx.world.luddites.indexOf(g), 1);
      else {
        g.x += dir[0];
        g.y += dir[1];
      }
      continue;
    }
    const target = strongestTarget(ctx);
    if (!target) {
      g.targetId = null;
      g.quietSince ??= step;
      if (step - g.quietSince >= t.quietSecondsToLeave * sps) g.leaving = true;
      continue;
    }
    g.quietSince = null;
    g.targetId = target.id;
    const next = pathTo(g.x, g.y, target.x, target.y)[0];
    if (next) {
      g.x = next[0];
      g.y = next[1];
    }
    warnNearby(ctx, g, step);
    if (g.x === target.x && g.y === target.y) destroyBoard(ctx, target, step, 'luddites');
  }
}
