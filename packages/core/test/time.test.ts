import { describe, expect, it } from 'vitest';
import { beatPeriod, gameTime, isBeat, seasonSteps, stepsForSeconds, stepsPerDay, type TimeConfig } from '../src/time.ts';

const T: TimeConfig = { stepsPerSecond: 20, secondsPerDay: 40, seasonDays: 30 };

describe('time', () => {
  it('converts steps to days and clock time', () => {
    expect(stepsPerDay(T)).toBe(800);
    expect(seasonSteps(T)).toBe(24_000);
    expect(gameTime(T, 0)).toEqual({ step: 0, day: 1, hour: 0, minute: 0, seconds: 0 });
    expect(gameTime(T, 400)).toMatchObject({ day: 1, hour: 12, minute: 0, seconds: 20 });
    expect(gameTime(T, 800)).toMatchObject({ day: 2, hour: 0, minute: 0 });
    expect(gameTime(T, 799)).toMatchObject({ day: 1, hour: 23, minute: 58 });
  });
  it('turns seconds into steps', () => {
    expect(stepsForSeconds(T, 20)).toBe(400);
    expect(stepsForSeconds(T, 0.5)).toBe(10);
  });
  it('places board beats on a fixed schedule', () => {
    expect(beatPeriod(T, 5)).toBe(4);
    expect(beatPeriod(T, 1)).toBe(20);
    const beats = Array.from({ length: 12 }, (_, s) => s).filter((s) => isBeat(s, 4, 1));
    expect(beats).toEqual([3, 7, 11]);
  });
});
