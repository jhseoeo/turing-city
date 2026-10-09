import { describe, expect, it } from 'vitest';
import { Session } from '../src/session.ts';
import { FakeHost } from './helpers/fake-host.ts';
import { m1Scenario } from './helpers/scenarios.ts';

describe('series', () => {
  it('moves wind and job price once a second by at most their step, and redraws fuel once a day', () => {
    // Ranges far wider than the walk, so that no draw is clamped and none repeats the value it started from.
    const s = new Session(
      m1Scenario((j) => {
        j.time.secondsPerDay = 5; // a day of 100 steps keeps the run short
        j.tuning.wind = { max: 1_000_000_000, start: 500_000_000, maxChangePerSecond: 1_000_000 };
        j.tuning.jobPrice = { min: 0, max: 1_000_000_000, start: 500_000_000, maxChangePerSecond: 1_000_000 };
        j.tuning.fuelPrice = { min: 0, max: 1_000_000_000, start: 500_000_000 };
      }),
      3,
      new FakeHost(),
    );
    const changedAt = { wind: [] as number[], jobPrice: [] as number[], fuelPrice: [] as number[] };
    const wind = { last: s.world.plant.wind, deltas: [] as number[] };
    const jobPrice = { last: s.world.jobPrice, deltas: [] as number[] };
    let fuelPrice = s.world.plant.fuelPrice;
    for (let i = 0; i < 300; i++) {
      s.step(); // the step numbered i; three days of 100 steps
      if (s.world.plant.wind !== wind.last) {
        changedAt.wind.push(i);
        wind.deltas.push(s.world.plant.wind - wind.last);
        wind.last = s.world.plant.wind;
      }
      if (s.world.jobPrice !== jobPrice.last) {
        changedAt.jobPrice.push(i);
        jobPrice.deltas.push(s.world.jobPrice - jobPrice.last);
        jobPrice.last = s.world.jobPrice;
      }
      if (s.world.plant.fuelPrice !== fuelPrice) {
        changedAt.fuelPrice.push(i);
        fuelPrice = s.world.plant.fuelPrice;
      }
    }
    // The first second keeps the start values: the first draws are at step 20, then every 20 steps.
    const everySecond = Array.from({ length: 14 }, (_, k) => 20 * (k + 1));
    expect(changedAt.wind).toEqual(everySecond);
    expect(changedAt.jobPrice).toEqual(everySecond);
    expect(changedAt.fuelPrice).toEqual([100, 200]);
    for (const { deltas } of [wind, jobPrice]) {
      expect(deltas.every((d) => Math.abs(d) <= 1_000_000)).toBe(true);
      expect(deltas.some((d) => d > 500_000)).toBe(true);
      expect(deltas.some((d) => d < -500_000)).toBe(true);
    }
  });

  it('keeps wind, job price, and fuel inside their ranges, and reaches both ends of each', () => {
    const s = new Session(
      m1Scenario((j) => {
        j.time.secondsPerDay = 1; // a new fuel price every second
        j.time.seasonDays = 100_000; // so that the season outlasts the run
        j.tuning.wind = { max: 10, start: 5, maxChangePerSecond: 8 };
        j.tuning.jobPrice = { min: 18, max: 22, start: 20, maxChangePerSecond: 5 };
        j.tuning.fuelPrice = { min: 3, max: 6, start: 4 };
      }),
      3,
      new FakeHost(),
    );
    const seen = { wind: new Set<number>(), jobPrice: new Set<number>(), fuelPrice: new Set<number>() };
    for (let i = 0; i < 1000; i++) {
      s.step();
      seen.wind.add(s.world.plant.wind);
      seen.jobPrice.add(s.world.jobPrice);
      seen.fuelPrice.add(s.world.plant.fuelPrice);
    }
    const range = (values: Set<number>): [number, number] => [Math.min(...values), Math.max(...values)];
    expect(range(seen.wind)).toEqual([0, 10]);
    expect(range(seen.jobPrice)).toEqual([18, 22]);
    expect(range(seen.fuelPrice)).toEqual([3, 6]);
  });
});
