import { describe, expect, it } from 'vitest';
import { Session } from '../src/session.ts';
import { FakeHost } from './helpers/fake-host.ts';
import { m1Scenario } from './helpers/scenarios.ts';

/** A town in which DA's firmware asks, at its first beat (step 3), to sleep for `seconds`; stepped through that beat. */
function napping(seconds: number, maxSleepSeconds?: number): { s: Session; da: Session['world']['boards'][number] } {
  const host = new FakeHost();
  let ticks = 0; // the board naps once: after it wakes, its firmware does nothing
  const source = host.program('nap', () => (ticks++ === 0 ? { actions: [{ kind: 'sleep', seconds }] } : {}));
  const s = new Session(
    m1Scenario((j) => {
      j.tuning.wind.start = 220;
      j.tuning.wind.maxChangePerSecond = 0;
      j.tuning.emf.rumourThreshold = 1_000_000_000; // no raids in the way
      if (maxSleepSeconds !== undefined) j.tuning.maxSleepSeconds = maxSleepSeconds;
    }),
    1,
    host,
  );
  s.deploy('DA', source);
  for (let i = 0; i <= 3; i++) s.step();
  return { s, da: s.world.boards[1]! };
}

describe('io.sleep', () => {
  // The scenario's longest sleep is 40 seconds, which is 800 steps at 20 a second.
  it.each([
    { asked: 5, slept: 5 },
    { asked: 40, slept: 40 },
    { asked: 41, slept: 40 },
    { asked: 1e9, slept: 40 }, // a firmware must not be able to put its board to sleep for the whole season
    { asked: Number.POSITIVE_INFINITY, slept: 1 }, // not a number a board can count: the shortest sleep, not the longest
    { asked: 0, slept: 1 },
    { asked: -7, slept: 1 },
    { asked: 2.9, slept: 2 },
    { asked: Number.NaN, slept: 1 },
  ])('puts a board to sleep for $slept s when it asks for $asked s', ({ asked, slept }) => {
    const { da } = napping(asked);
    expect(da.status).toBe('asleep');
    expect(da.wakeAt).toBe(3 + slept * 20);
    expect(da.log.at(-1)).toMatchObject({ kind: 'system', text: `sleeping ${slept} s (RAM wiped)` });
  });

  it('wakes a board that asked for a sleep of 10^9 seconds when the longest sleep is over, not at the end of the season', () => {
    const { s, da } = napping(1e9);
    while (s.world.step < 3 + 40 * 20) s.step(); // one step short of the wake-up at step 803
    expect(da.status).toBe('asleep');
    s.step();
    expect(da.status).toBe('running');
    expect(da.log.map((l) => l.text)).toContain('woke up');
    expect(da.wakeAt).toBeNull();
  });

  it("takes the longest sleep from the scenario's tuning", () => {
    expect(napping(1e9, 25).da.wakeAt).toBe(3 + 25 * 20);
    expect(napping(1e9, 1).da.wakeAt).toBe(3 + 20);
  });
});
