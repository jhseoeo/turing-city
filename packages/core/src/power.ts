import { clearFlag, raiseOnce } from './alerts.ts';
import { appendLog } from './boards.ts';
import { mulDiv } from './fixed.ts';
import { type BoardState, manhattan, type SimContext, type WorldState } from './world.ts';

export function plantBoard(world: WorldState): BoardState {
  const plant = world.boards.find((b) => b.kind === 'power');
  if (!plant) throw new Error('the scenario has no power plant');
  return plant;
}

/** What a facility requests this step, transmission loss included. */
export function facilityDemand(ctx: SimContext, board: BoardState, step: number): number {
  const t = ctx.scenario.tuning;
  let base: number;
  if (board.status === 'destroyed' || board.status === 'rebuilding') return 0;
  if (board.status === 'asleep') {
    base = t.sleepPower;
  } else {
    base = board.spec.power;
    const dc = ctx.world.datacenters[board.id];
    if (dc) {
      if (step >= dc.jobFrom && step <= dc.jobUntil) base += t.datacenter.processPower;
      base += dc.cooling * t.datacenter.coolingPowerPerLevel;
    }
  }
  const plant = plantBoard(ctx.world);
  const distance = manhattan(board.x, board.y, plant.x, plant.y);
  return base + mulDiv(base, t.transmissionLossPctPerCell * distance, 100);
}

/** Consumers (every board but the plant's), highest priority first. */
export function priorityOrder(world: WorldState): BoardState[] {
  const consumers = world.boards.filter((b) => b.kind !== 'power');
  const listed = world.plant.priority ?? [];
  const first = listed.map((id) => consumers.find((b) => b.id === id)).filter((b): b is BoardState => b !== undefined);
  return [...first, ...consumers.filter((b) => !first.includes(b))];
}

/** Phase 3: generation, demand, and shedding. */
export function runPower(ctx: SimContext, step: number): void {
  const w = ctx.world;
  const plant = plantBoard(w);
  const thermal = plant.status === 'running' ? w.plant.thermalSetting : 0;
  const generation = w.plant.wind + thermal;
  const plantDraw = facilityDemand(ctx, plant, step);
  const order = priorityOrder(w);
  const demands = order.map((b) => facilityDemand(ctx, b, step));
  const available = generation - plantDraw;
  let load = demands.reduce((a, b) => a + b, 0);
  const powered = order.map(() => true);
  for (let i = order.length - 1; i >= 0 && load > available; i--) {
    if (demands[i] === 0) continue;
    powered[i] = false;
    load -= demands[i]!;
  }
  plant.powered = true;
  order.forEach((b, i) => {
    const was = b.powered;
    b.powered = powered[i]!;
    // A board that works finds out its power was cut or came back from its log (a destroyed one has no one to tell).
    if (was !== b.powered && (b.status === 'running' || b.status === 'asleep'))
      appendLog(b, step, 'system', b.powered ? 'power back' : 'power lost');
  });
  w.plant.generation = generation;
  w.plant.demand = plantDraw + demands.reduce((a, b) => a + b, 0);
  w.plant.shed = order.filter((_, i) => !powered[i] && demands[i]! > 0).map((b) => b.id);
  if (w.plant.shed.length > 0) {
    raiseOnce(w, 'shortage', step, 'powerShortage', null, `전력 부족: ${w.plant.shed.join(', ')} 정전`);
  } else {
    clearFlag(w, 'shortage');
  }
}
