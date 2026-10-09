import { clamp } from './fixed.ts';
import { stepsPerDay } from './time.ts';
import type { SimContext } from './world.ts';

/** Phase 2: wind and the job price take a random step every second; fuel is redrawn every day. */
export function runSeries(ctx: SimContext, step: number): void {
  if (step === 0) return;
  const { time, tuning: t } = ctx.scenario;
  const w = ctx.world;
  if (step % time.stepsPerSecond === 0) {
    const dw = ctx.rng.weather.int(-t.wind.maxChangePerSecond, t.wind.maxChangePerSecond);
    w.plant.wind = clamp(w.plant.wind + dw, 0, t.wind.max);
    const dp = ctx.rng.market.int(-t.jobPrice.maxChangePerSecond, t.jobPrice.maxChangePerSecond);
    w.jobPrice = clamp(w.jobPrice + dp, t.jobPrice.min, t.jobPrice.max);
  }
  if (step % stepsPerDay(time) === 0) {
    w.plant.fuelPrice = ctx.rng.market.int(t.fuelPrice.min, t.fuelPrice.max);
  }
}
