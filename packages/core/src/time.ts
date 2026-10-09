import { idiv } from './fixed.ts';

export interface TimeConfig {
  readonly stepsPerSecond: number;
  readonly secondsPerDay: number;
  readonly seasonDays: number;
}

/** Game time for people: day 1 is the season's first day. */
export interface GameTime {
  readonly step: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  /** Seconds of game time since the season started. */
  readonly seconds: number;
}

export function stepsPerDay(t: TimeConfig): number {
  return t.stepsPerSecond * t.secondsPerDay;
}

export function seasonSteps(t: TimeConfig): number {
  return stepsPerDay(t) * t.seasonDays;
}

export function stepsForSeconds(t: TimeConfig, seconds: number): number {
  return Math.round(seconds * t.stepsPerSecond);
}

export function gameTime(t: TimeConfig, step: number): GameTime {
  const spd = stepsPerDay(t);
  const minuteOfDay = idiv((step % spd) * 1440, spd);
  return {
    step,
    day: idiv(step, spd) + 1,
    hour: idiv(minuteOfDay, 60),
    minute: minuteOfDay % 60,
    seconds: step / t.stepsPerSecond,
  };
}

/** Steps between two beats of a board's clock. Scenario validation makes it an integer. */
export function beatPeriod(t: TimeConfig, clockHz: number): number {
  return t.stepsPerSecond / clockHz;
}

/** Whether a board with this period and phase ticks at this step. */
export function isBeat(step: number, period: number, phase: number): boolean {
  return (step + phase) % period === 0;
}
