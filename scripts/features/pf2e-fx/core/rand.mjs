/**
 * Spellsprite — small pure maths: seeded randomness, value noise, easing.
 * Everything an effect draws is a function of its seed, so every client draws
 * the same take of the same effect.
 */

export const TAU = Math.PI * 2;
export const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const easeOut = (u) => 1 - (1 - u) ** 3;
/** Quantise a time to the 12 fps sprite clock. */
export const q12 = (t) => Math.floor(t * 12) / 12;
export const fadeOut = (u, from) => (u > from ? (1 - u) / (1 - from) : 1);

/** mulberry32: a fast seeded generator, `() => [0, 1)`. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Integer hash of up to three numbers to [0, 1). */
export function hash(a, b = 0, c = 0) {
  let h = (Math.floor(a) * 374761393 + Math.floor(b) * 668265263 + Math.floor(c) * 1274126177) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** A string to a 32-bit seed (FNV-1a). */
export function seedOf(text) {
  let h = 2166136261;
  for (const ch of String(text ?? "")) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** Periodic value noise around a circle: N cells, seed s. */
export function pnoise(ang, N, s) {
  const x = (((ang / TAU) % 1) + 1) % 1 * N, i = Math.floor(x), f = x - i, sm = f * f * (3 - 2 * f);
  return lerp(hash(i % N, s), hash((i + 1) % N, s), sm);
}

export function inPoly(P, x, y) {
  let inside = false;
  for (let k = 0, l = P.length - 1; k < P.length; l = k++) {
    const [xi, yi] = P[k], [xl, yl] = P[l];
    if (yi > y !== yl > y && x < ((xl - xi) * (y - yi)) / (yl - yi) + xi) inside = !inside;
  }
  return inside;
}
