import { describe, expect, it } from 'vitest';
import { createRng, deriveSeed } from '../src/rng.ts';

describe('createRng', () => {
  it('produces the same sequence for the same seed', () => {
    const a = createRng(42);
    expect([a.nextU32(), a.nextU32(), a.nextU32()]).toEqual([3910993901, 1565048137, 3362278356]);
    const b = createRng(42);
    expect(Array.from({ length: 5 }, () => b.int(1, 6))).toEqual([6, 2, 1, 2, 6]);
  });
  it('differs between seeds', () => {
    expect(createRng(1).nextU32()).not.toBe(createRng(2).nextU32());
  });
  it('keeps int() inside its bounds and spreads it evenly', () => {
    const r = createRng(7);
    const counts = [0, 0, 0, 0, 0, 0];
    for (let i = 0; i < 60_000; i++) {
      const v = r.int(0, 5);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(5);
      counts[v] = (counts[v] ?? 0) + 1;
    }
    expect(counts).toEqual([9878, 9953, 10091, 10112, 9860, 10106]);
  });
  it('rejects an empty or non-integer range', () => {
    const r = createRng(1);
    expect(() => r.int(3, 2)).toThrow(RangeError);
    expect(() => r.int(0.5, 2)).toThrow(RangeError);
  });
  it('chancePpm is never true at 0 and always true at a million', () => {
    const r = createRng(3);
    for (let i = 0; i < 1000; i++) {
      expect(r.chancePpm(0)).toBe(false);
      expect(r.chancePpm(1_000_000)).toBe(true);
    }
  });
});

describe('deriveSeed', () => {
  it('is stable and separates labels', () => {
    expect(deriveSeed(42, 'DA', 0)).toBe(1746765016);
    expect(deriveSeed(42, 'DA', 1)).toBe(1746514753);
    expect(deriveSeed(42, 'weather')).toBe(2560665826);
  });
});
