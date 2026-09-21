/**
 * Hexcrawl renderer — small geometry helpers. Pure, no PIXI import: every
 * function that draws takes the Graphics it draws into.
 */

/** Polygon shrunk towards its centre by fraction `f` of the centre distance. */
export function inset(verts, c, f) {
  const k = 1 - f;
  return verts.map((v) => ({ x: c.x + (v.x - c.x) * k, y: c.y + (v.y - c.y) * k }));
}

/** [{x,y}] → flat [x0,y0,x1,y1,…], translated by -o. */
export function flat(pts, ox = 0, oy = 0) {
  const out = new Array(pts.length * 2);
  for (let n = 0; n < pts.length; n++) { out[2 * n] = pts[n].x - ox; out[2 * n + 1] = pts[n].y - oy; }
  return out;
}

/**
 * Dashes along a segment. The period is fitted so a whole number of dashes
 * lands on the segment, and each dash is centred in its period — so the same
 * edge dashed from either end draws the same pattern, and neighbouring
 * outlines agree where they meet. `phase` (in periods) drifts the pattern.
 */
export function dashSegment(g, a, b, period, duty = 0.5, phase = 0, ox = 0, oy = 0) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len <= 0) return;
  const n = Math.max(1, Math.round(len / period));
  const p = len / n;
  const ph = ((phase % 1) + 1) % 1;
  const off = (1 - duty) / 2;
  for (let k = -1; k <= n; k++) {
    let s = (k + ph + off) * p, e = s + duty * p;
    if (e <= 0 || s >= len) continue;
    s = Math.max(0, s); e = Math.min(len, e);
    g.moveTo(a.x + dx * (s / len) - ox, a.y + dy * (s / len) - oy);
    g.lineTo(a.x + dx * (e / len) - ox, a.y + dy * (e / len) - oy);
  }
}

/** Dash every edge of a closed polygon. */
export function dashPoly(g, pts, period, duty = 0.5, phase = 0, ox = 0, oy = 0) {
  for (let n = 0; n < pts.length; n++) dashSegment(g, pts[n], pts[(n + 1) % pts.length], period, duty, phase, ox, oy);
}

/**
 * The first fraction `p` of a closed polygon's perimeter, starting from its
 * top-most vertex and running clockwise on screen.
 */
export function tracePoly(g, pts, p, ox = 0, oy = 0) {
  if (p <= 0) return;
  let start = 0;
  for (let n = 1; n < pts.length; n++) if (pts[n].y < pts[start].y - 1e-6) start = n;
  // Clockwise on screen (y down) is increasing signed area; pick the direction.
  let area = 0;
  for (let n = 0; n < pts.length; n++) { const a = pts[n], b = pts[(n + 1) % pts.length]; area += a.x * b.y - b.x * a.y; }
  const dir = area > 0 ? 1 : -1;
  const at = (n) => pts[((start + dir * n) % pts.length + pts.length) % pts.length];
  let total = 0;
  for (let n = 0; n < pts.length; n++) total += Math.hypot(at(n + 1).x - at(n).x, at(n + 1).y - at(n).y);
  let left = Math.min(1, p) * total;
  g.moveTo(at(0).x - ox, at(0).y - oy);
  for (let n = 0; n < pts.length && left > 0; n++) {
    const a = at(n), b = at(n + 1);
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const f = Math.min(1, left / len);
    g.lineTo(a.x + (b.x - a.x) * f - ox, a.y + (b.y - a.y) * f - oy);
    left -= len;
  }
}

/**
 * Diagonal hatch lines (x − y = const) clipped to a convex polygon, spaced
 * `step` apart measured perpendicular to the lines. Anchored to world space so
 * neighbouring hexes' hatching lines up into one continuous field.
 */
export function hatchPoly(g, pts, step, ox = 0, oy = 0) {
  let lo = Infinity, hi = -Infinity;
  for (const p of pts) { const d = p.x - p.y; if (d < lo) lo = d; if (d > hi) hi = d; }
  const s = step * Math.SQRT2;
  for (let d = Math.ceil(lo / s) * s; d <= hi; d += s) {
    // Line: points (t + d, t). Clip t against every edge (Cyrus–Beck on a convex polygon).
    const hits = [];
    for (let n = 0; n < pts.length; n++) {
      const a = pts[n], b = pts[(n + 1) % pts.length];
      const fa = a.x - a.y - d, fb = b.x - b.y - d;
      if ((fa < 0) === (fb < 0) && fa !== 0) continue;
      const den = fa - fb;
      if (den === 0) continue;
      const u = fa / den;
      hits.push({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u });
    }
    if (hits.length < 2) continue;
    hits.sort((p, q) => p.y - q.y);
    const A = hits[0], B = hits[hits.length - 1];
    if (Math.hypot(B.x - A.x, B.y - A.y) < 1e-3) continue;
    g.moveTo(A.x - ox, A.y - oy);
    g.lineTo(B.x - ox, B.y - oy);
  }
}

/** A filled or stroked diamond (square rotated 45°) of half-diagonal `s`. */
export const diamond = (x, y, s) => [x, y - s, x + s, y, x, y + s, x - s, y];

/** The survey "?" in glyph units (the dot is drawn separately as a disc). */
export const QMARK = "M-3.4 -3.6 Q-3.4 -8 0.2 -8 Q3.8 -8 3.8 -4.4 Q3.8 -1.8 0.9 -0.6 Q0 -0.1 0 2.2";
export const QMARK_DOT = { x: 0, y: 5.6, r: 0.95 };

/** Deterministic PRNG seeded from a string (FNV-1a → mulberry32). */
export function seeded(str) {
  let h = 2166136261;
  for (let n = 0; n < str.length; n++) { h ^= str.charCodeAt(n); h = Math.imul(h, 16777619); }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Landmark badge centres for n (1..3) landmarks, relative to the hex centre, in R. */
export function landmarkSlots(n) {
  if (n <= 1) return [{ x: 0, y: 0 }];
  if (n === 2) return [{ x: -0.25, y: 0 }, { x: 0.25, y: 0 }];
  return [{ x: -0.46, y: 0.06 }, { x: 0, y: -0.04 }, { x: 0.46, y: 0.06 }];
}
