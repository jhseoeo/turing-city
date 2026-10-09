import { describe, expect, it } from 'vitest';
import { clamp, idiv, MICRO, mulDiv } from '../src/fixed.ts';

describe('idiv', () => {
  it('floors exactly for positive and negative numbers', () => {
    expect(idiv(7, 2)).toBe(3);
    expect(idiv(-7, 2)).toBe(-4);
    expect(idiv(6, 3)).toBe(2);
    expect(idiv(-6, 3)).toBe(-2);
    expect(idiv(0, 5)).toBe(0);
  });
  it('stays exact near the top of the safe range', () => {
    const big = 2 ** 51 + 1;
    expect(idiv(big, 1)).toBe(big);
    expect(idiv(big * 2 - 1, 2)).toBe(big - 1);
  });
});

describe('mulDiv', () => {
  it('computes floor(a * b / d)', () => {
    expect(mulDiv(40, MICRO, 20)).toBe(2_000_000);
    expect(mulDiv(300 * 9, MICRO, 800)).toBe(3_375_000);
    expect(mulDiv(-5, 3, 2)).toBe(-8);
  });
});

describe('clamp', () => {
  it('keeps a value inside the range', () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-1, 0, 3)).toBe(0);
    expect(clamp(2, 0, 3)).toBe(2);
  });
});
