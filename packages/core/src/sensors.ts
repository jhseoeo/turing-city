import { MILLI } from './fixed.ts';
import type { SensorName } from './scenario.ts';
import { gameTime } from './time.ts';
import { type BoardState, cellIndex, manhattan, type SimContext } from './world.ts';

/** Each sensor's field name in the firmware's io table. */
export const SENSOR_KEYS: Record<SensorName, string> = {
  wind: 'wind',
  demand: 'demand',
  fuelPrice: 'fuel_price',
  temp: 'temp',
  powerHeadroom: 'power_headroom',
  price: 'price',
  emf: 'emf',
  ludditeDist: 'luddite_dist',
};

function nearestLudditeDistance(ctx: SimContext, board: BoardState): number | undefined {
  let best: number | undefined;
  for (const g of ctx.world.luddites) {
    const d = manhattan(g.x, g.y, board.x, board.y);
    if (best === undefined || d < best) best = d;
  }
  return best;
}

function read(ctx: SimContext, board: BoardState, sensor: SensorName): number | undefined {
  const w = ctx.world;
  switch (sensor) {
    case 'wind':
      return w.plant.wind;
    case 'demand':
      return w.plant.demand;
    case 'fuelPrice':
      return w.plant.fuelPrice;
    case 'temp':
      return (w.datacenters[board.id]?.tempMilli ?? 0) / MILLI;
    case 'powerHeadroom':
      return w.plant.generation - w.plant.demand;
    case 'price':
      return w.jobPrice;
    case 'emf':
      return (w.emf[cellIndex(ctx.scenario, board.x, board.y)] ?? 0) / MILLI;
    case 'ludditeDist':
      return nearestLudditeDistance(ctx, board);
  }
}

/** What the board's firmware sees in io this tick: its mounted sensors, plus the day and the clock. */
export function sensorFrame(ctx: SimContext, board: BoardState): Record<string, number | undefined> {
  const time = gameTime(ctx.scenario.time, ctx.world.step);
  const frame: Record<string, number | undefined> = { day: time.day, clock: time.seconds };
  for (const sensor of board.spec.sensors) frame[SENSOR_KEYS[sensor]] = read(ctx, board, sensor);
  return frame;
}
