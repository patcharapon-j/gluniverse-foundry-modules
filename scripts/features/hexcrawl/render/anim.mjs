/**
 * Hexcrawl renderer — the motion model. Pure: no PIXI, no clock of its own.
 *
 * Every duration is a TIMING entry × the motion scale, read through `dur()`;
 * nothing here or in the renderer writes a literal duration. The renderer
 * advances time only from `update(dtMs)`, so a host that freezes its ticker
 * freezes the map, and motion scale 0 snaps.
 */

import { TIMING } from "../constants.mjs";

export const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);
export const easeOutCubic = (t) => 1 - (1 - t) ** 3;
export const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
export const easeOutQuart = (t) => 1 - (1 - t) ** 4;

/** A TIMING entry scaled by the motion scale. */
export const dur = (name, scale) => (TIMING[name] ?? 0) * Math.max(0, scale);

/** Fraction of the reveal trace after which the ink begins (they overlap). */
export const INK_OVERLAP = 0.72;
/** The inked tile grows from this scale to 1. */
export const INK_FROM_SCALE = 0.94;

/**
 * Stagger order for a set of changed keys: by hex distance from the nearest
 * party hex (or the set's own centre), then by angle so a ring sweeps round
 * rather than popping at once. Returns Map<key, delayMs>.
 */
export function staggerDelays(keys, { adapter, party, cubeDistance, scale }) {
  const step = dur("revealStagger", scale);
  const out = new Map();
  if (!keys.length) return out;
  const origins = (party ?? []).map((p) => p.key).filter(Boolean);
  let ref;
  if (origins.length) ref = origins.map((k) => ({ c: adapter.toCube(k), p: adapter.center(k) }));
  else {
    let sx = 0, sy = 0;
    for (const k of keys) { const p = adapter.center(k); sx += p.x; sy += p.y; }
    const p = { x: sx / keys.length, y: sy / keys.length };
    ref = [{ c: adapter.toCube(adapter.keyAt(p)), p }];
  }
  const info = keys.map((k) => {
    const c = adapter.toCube(k);
    let best = ref[0], bd = Infinity;
    for (const r of ref) { const d = cubeDistance(c, r.c); if (d < bd) { bd = d; best = r; } }
    const p = adapter.center(k);
    const ang = (Math.atan2(p.y - best.p.y, p.x - best.p.x) + Math.PI * 2.5) % (Math.PI * 2);
    return { k, d: bd, ang };
  });
  const dmin = Math.min(...info.map((i) => i.d));
  for (const i of info) out.set(i.k, ((i.d - dmin) + (i.ang / (Math.PI * 2)) * 0.6) * step);
  return out;
}

/**
 * One hex's animation state. kind: "reveal" | "mask" | "hide".
 * `sample(t)` → { trace (0..1 drawn), traceAlpha, from (alpha), to (alpha), scale, done }
 */
export function makeHexAnim(kind, delay, scale) {
  if (kind === "reveal") {
    const A = dur("revealOutline", scale), B = dur("revealInk", scale);
    return {
      kind, delay, total: delay + A * INK_OVERLAP + B,
      sample(t) {
        const u = t - delay;
        const trace = A > 0 ? easeInOutCubic(clamp01(u / A)) : 1;
        const q = B > 0 ? easeOutCubic(clamp01((u - A * INK_OVERLAP) / B)) : 1;
        return {
          trace, traceAlpha: u < 0 ? 0 : 1 - easeInOutCubic(clamp01((q - 0.35) / 0.65)),
          from: 1 - q, to: q, scale: INK_FROM_SCALE + (1 - INK_FROM_SCALE) * q, done: t >= this.total,
        };
      },
    };
  }
  const D = dur(kind === "mask" ? "maskFade" : "hideFade", scale);
  return {
    kind, delay, total: delay + D,
    sample(t) {
      const q = D > 0 ? easeInOutCubic(clamp01((t - delay) / D)) : 1;
      return { trace: 0, traceAlpha: 0, from: 1 - q, to: q, scale: 1, done: t >= this.total };
    },
  };
}

/** Periodic pulse 0..1 on a TIMING period (a whole cosine per period, no seam). */
export function pulse(timeMs, periodName) {
  const P = TIMING[periodName] || 1;
  return 0.5 - 0.5 * Math.cos(((timeMs % P) / P) * Math.PI * 2);
}
