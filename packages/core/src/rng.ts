/** A deterministic random stream (sfc32, seeded through splitmix32). */
export interface Rng {
  /** The next unsigned 32-bit integer. */
  nextU32(): number;
  /** An integer in [lo, hi], both inclusive. */
  int(lo: number, hi: number): number;
  /** True with probability ppm / 1,000,000. */
  chancePpm(ppm: number): boolean;
}

function splitmix32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x9e3779b9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
    return (z ^ (z >>> 16)) >>> 0;
  };
}

export function createRng(seed: number): Rng {
  const sm = splitmix32(seed);
  let a = sm();
  let b = sm();
  let c = sm();
  let d = sm();
  const nextU32 = (): number => {
    const t = (((a + b) >>> 0) + d) >>> 0;
    d = (d + 1) >>> 0;
    a = (b ^ (b >>> 9)) >>> 0;
    b = (c + (c << 3)) >>> 0;
    c = ((c << 21) | (c >>> 11)) >>> 0;
    c = (c + t) >>> 0;
    return t;
  };
  return {
    nextU32,
    int(lo, hi) {
      const range = hi - lo + 1;
      if (!Number.isInteger(lo) || !Number.isInteger(hi) || range < 1 || range > 0x1_0000_0000) {
        throw new RangeError(`bad range ${lo}..${hi}`);
      }
      return lo + (nextU32() % range);
    },
    chancePpm(ppm) {
      return ppm > 0 && nextU32() % 1_000_000 < ppm;
    },
  };
}

/** A seed for a sub-stream: FNV-1a over the labels, mixed with the parent seed. */
export function deriveSeed(seed: number, ...labels: readonly (string | number)[]): number {
  let h = (0x811c9dc5 ^ (seed >>> 0)) >>> 0;
  for (const label of labels) {
    const s = String(label);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    h ^= 0xff;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
