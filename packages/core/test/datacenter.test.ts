import { describe, expect, it } from 'vitest';
import { MICRO } from '../src/fixed.ts';
import { Session } from '../src/session.ts';
import { FakeHost } from './helpers/fake-host.ts';
import { m1Scenario } from './helpers/scenarios.ts';

/** Plenty of steady power, so nothing is shed unless a test wants it. */
function powered(seed = 1): Session {
  const s = new Session(
    m1Scenario((j) => {
      j.tuning.wind.start = 220;
      j.tuning.wind.maxChangePerSecond = 0;
      j.tuning.jobPrice.maxChangePerSecond = 0;
      j.tuning.emf.rumourThreshold = 1_000_000_000; // no raids once Task 12 adds them
    }),
    seed,
    new FakeHost(),
  );
  s.world.plant.thermalSetting = 300;
  return s;
}

function steps(s: Session, n: number): void {
  for (let i = 0; i < n; i++) s.step();
}

describe('datacenters', () => {
  it('earns the job price per second of processing, pro rata', () => {
    const s = powered();
    const dc = s.world.datacenters.DA!;
    dc.jobFrom = 0;
    dc.jobUntil = 3; // four steps = 0.2 s at price 40 -> 8
    steps(s, 4);
    expect(s.world.ledger.datacenterIncome).toBe(8 * MICRO);
    steps(s, 4);
    expect(s.world.ledger.datacenterIncome).toBe(8 * MICRO);
  });

  it('heats while processing and cools toward ambient after', () => {
    const s = powered();
    const dc = s.world.datacenters.DA!;
    dc.jobFrom = 0;
    dc.jobUntil = 20 * 10 - 1; // 10 s of work
    steps(s, 200);
    const hot = dc.tempMilli;
    expect(hot).toBeGreaterThan(25_000 + 15_000); // ~+20 °C minus passive loss
    expect(hot).toBeLessThan(25_000 + 20_000);
    steps(s, 200);
    expect(dc.tempMilli).toBeLessThan(hot);
    expect(dc.tempMilli).toBeGreaterThanOrEqual(25_000);
  });

  it('cools faster with cooling on, never below ambient', () => {
    const plain = powered();
    const cooled = powered();
    for (const s of [plain, cooled]) s.world.datacenters.DA!.tempMilli = 80_000;
    cooled.world.datacenters.DA!.cooling = 3;
    steps(plain, 100);
    steps(cooled, 100);
    expect(cooled.world.datacenters.DA!.tempMilli).toBeLessThan(plain.world.datacenters.DA!.tempMilli);
    steps(cooled, 2000);
    expect(cooled.world.datacenters.DA!.tempMilli).toBe(25_000);
  });

  it('does not process or heat while its facility is shed', () => {
    const s = powered();
    s.world.plant.thermalSetting = 0;
    s.world.plant.wind = 0; // the wind won't move: maxChangePerSecond is 0
    const dc = s.world.datacenters.DA!;
    dc.jobFrom = 0;
    dc.jobUntil = 100;
    steps(s, 50);
    expect(s.world.ledger.datacenterIncome).toBe(0);
    expect(dc.tempMilli).toBe(25_000);
  });

  it('raises an overheat alert at 85 °C, once until it falls below 80 °C', () => {
    const s = powered();
    const dc = s.world.datacenters.DA!;
    dc.tempMilli = 86_000;
    steps(s, 5);
    dc.tempMilli = 86_000;
    steps(s, 5);
    expect(s.world.alerts.filter((a) => a.kind === 'overheat')).toHaveLength(1);
    dc.tempMilli = 70_000;
    steps(s, 1);
    dc.tempMilli = 86_000;
    steps(s, 1);
    expect(s.world.alerts.filter((a) => a.kind === 'overheat')).toHaveLength(2);
  });

  it('can catch fire above 90 °C and destroy the board, the same way for the same seed', () => {
    const burnStep = (seed: number): number | null => {
      const s = powered(seed);
      const dc = s.world.datacenters.DA!;
      for (let i = 0; i < 2000; i++) {
        dc.tempMilli = 140_000; // about 12,500 ppm per step
        s.step();
        if (s.world.boards[1]!.status === 'destroyed') return i;
      }
      return null;
    };
    const first = burnStep(5);
    expect(first).not.toBeNull();
    expect(burnStep(5)).toBe(first);
    const s = powered(5);
    for (let i = 0; i <= first!; i++) {
      s.world.datacenters.DA!.tempMilli = 140_000;
      s.step();
    }
    expect(s.world.alerts.map((a) => a.kind)).toEqual(expect.arrayContaining(['fire', 'boardDestroyed']));
  });

  it('never catches fire at or below 90 °C', () => {
    const s = powered();
    for (let i = 0; i < 5000; i++) {
      s.world.datacenters.DA!.tempMilli = 90_000;
      s.step();
    }
    expect(s.world.boards[1]!.status).toBe('running');
  });
});
