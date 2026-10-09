/**
 * Integer helpers. The simulation stores only integers: money in micro-units,
 * temperatures and EMF in milli-units. Every value stays below 2^53, so plain
 * numbers hold them exactly; these helpers keep division exact too.
 */
export const MICRO = 1_000_000;
export const MILLI = 1_000;

/**
 * Exact floor(x / d) for integers with |x| < 2^53 and d > 0. The quotient of two such integers
 * never rounds across an integer, so Math.floor needs no correction; checking the remainder
 * (x - q * d) would itself leave the exact range for x near -2^53.
 */
export function idiv(x: number, d: number): number {
  return Math.floor(x / d);
}

/** floor(a * b / d). The product a * b must stay below 2^53. */
export function mulDiv(a: number, b: number, d: number): number {
  return idiv(a * b, d);
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
