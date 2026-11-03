/**
 * Spellsprite — the area language. Pure.
 *
 * An area spell has to read as the WHOLE area, the way a MOBA skill does: you
 * know where it will land before it lands, the instant it lands every square of
 * it lights at once, a shockwave carries the hit to the exact edge, the area
 * erupts square by square as the wave passes, and the ground keeps the scar.
 * That grammar is the same for every material; the family supplies the
 * eruptions (its own `burst`) and the colour.
 *
 *   zone    the footprint on the ground: the cast indicator filling up during
 *           the wind-up, the full flash on impact, the scar dissolving after
 *   shock   the front of the hit: a ring (burst, emanation), an arc sweeping
 *           out of the hand (cone), a bar running down the lane (line)
 *
 * Both are flat shapes, so in Diorama they lie on the ground under the
 * standing eruptions. Ground pixels are found by inverting the view on the
 * ground plane, which is affine in both views, so the footprint is exact in
 * the top view and in a billboard's side view alike.
 */

import { TAU, clamp, easeOut, hash } from "./core/rand.mjs";
import { S } from "./core/palette.mjs";
import { registerShapes } from "./core/shapes.mjs";
import { still } from "./core/motifs.mjs";

/* ── geometry, in squares ──────────────────────────────────────────────── */

const CONE_HALF = Math.PI / 4;

/** The area normalised: every shape carries what its metric needs. */
export function areaGeom(A) {
  const shape = A.shape === "aura" ? "emanation" : A.shape;
  if (shape === "cone") return { shape, x: A.x, y: A.y, dir: A.dir ?? 0, len: Math.max(1, A.len ?? A.r ?? 3), half: A.half ?? CONE_HALF };
  if (shape === "line") return { shape, x: A.x, y: A.y, dir: A.dir ?? 0, len: Math.max(1, A.len ?? 6), width: Math.max(0.6, A.width ?? 1) };
  return { shape: shape === "emanation" ? "emanation" : "burst", x: A.x, y: A.y, r: Math.max(0.5, A.r ?? 1) };
}

/** How far the area reaches from where its wave starts. */
export const extentOf = (G) => (G.shape === "cone" || G.shape === "line" ? G.len : G.r);

/**
 * Where a ground point sits in the area: `d` is 0 at the wave's origin and 1
 * at the far edge, `edge` the distance to the nearest edge in squares. Null
 * outside.
 */
export function areaMetric(G, wx, wy) {
  const dx = wx - G.x, dy = wy - G.y;
  if (G.shape === "cone") {
    const dist = Math.hypot(dx, dy);
    if (dist > G.len) return null;
    let q = Math.atan2(dy, dx) - G.dir;
    q = Math.atan2(Math.sin(q), Math.cos(q));
    if (Math.abs(q) > G.half) return null;
    const side = dist * Math.sin(G.half - Math.abs(q));
    return { d: dist / G.len, edge: Math.min(G.len - dist, side) };
  }
  if (G.shape === "line") {
    const c = Math.cos(G.dir), s = Math.sin(G.dir), along = dx * c + dy * s, across = -dx * s + dy * c, hw = G.width / 2;
    if (along < 0 || along > G.len || Math.abs(across) > hw) return null;
    return { d: along / G.len, edge: Math.min(G.len - along, along, hw - Math.abs(across)) };
  }
  const dist = Math.hypot(dx, dy);
  if (dist > G.r) return null;
  return { d: dist / G.r, edge: G.r - dist };
}

/** Points across the area, wave order, for the eruptions. Never more than `max`. */
export function areaPoints(G, max, R) {
  const area = G.shape === "cone" ? G.half * G.len * G.len : G.shape === "line" ? G.len * G.width : Math.PI * G.r * G.r;
  const step = Math.max(0.85, Math.sqrt(area / Math.max(1, max)));
  const jit = () => (R() - 0.5) * step * 0.5;
  const pts = [];
  if (G.shape === "cone") {
    for (let r = step * 0.9; r <= G.len - step * 0.2; r += step) {
      const n = Math.max(1, Math.round((2 * G.half * r) / step));
      for (let i = 0; i < n; i++) {
        const q = G.dir - G.half + G.half * 2 * ((i + 0.5) / n), rr = r + jit() * 0.6;
        pts.push({ x: G.x + Math.cos(q) * rr, y: G.y + Math.sin(q) * rr, d: rr / G.len });
      }
    }
  } else if (G.shape === "line") {
    const c = Math.cos(G.dir), s = Math.sin(G.dir), rows = Math.max(1, Math.round(G.width / step));
    for (let a = step * 0.6; a <= G.len - step * 0.2; a += step) {
      for (let j = 0; j < rows; j++) {
        const off = (j + 0.5) / rows * G.width - G.width / 2 + jit() * 0.3, al = a + jit() * 0.5;
        pts.push({ x: G.x + c * al - s * off, y: G.y + s * al + c * off, d: al / G.len });
      }
    }
  } else {
    const inner = G.shape === "emanation" ? Math.min(G.r * 0.5, 0.7) : step * 0.85;
    for (let r = inner; r <= G.r - step * 0.25; r += step) {
      const n = Math.max(3, Math.round((TAU * r) / step)), q0 = R() * TAU;
      for (let i = 0; i < n; i++) {
        const q = q0 + (i / n) * TAU, rr = r + jit() * 0.5;
        pts.push({ x: G.x + Math.cos(q) * rr, y: G.y + Math.sin(q) * rr, d: rr / G.r });
      }
    }
  }
  pts.sort((a, b) => a.d - b.d);
  if (pts.length <= max) return { pts, step };
  /* Thin evenly rather than cutting the rim off. */
  const out = [];
  for (let i = 0; i < max; i++) out.push(pts[Math.floor((i * pts.length) / max)]);
  return { pts: out, step };
}

/* ── painting ──────────────────────────────────────────────────────────── */

/** The ground plane through a view, inverted: art pixel → world square. */
function groundInverse(v, ox, oy) {
  const [ax, ay] = v.ap(ox, oy, 0), [bx, by] = v.ap(ox + 1, oy, 0), [cx, cy] = v.ap(ox, oy + 1, 0);
  const m00 = bx - ax, m10 = by - ay, m01 = cx - ax, m11 = cy - ay, det = m00 * m11 - m01 * m10;
  if (Math.abs(det) < 1e-9) return null;
  return (px, py) => {
    const u = px - ax, w = py - ay;
    return [ox + (m11 * u - m01 * w) / det, oy + (-m10 * u + m00 * w) / det];
  };
}

/** The footprint's art-pixel box. */
function boxOf(v, G) {
  const pts = [];
  if (G.shape === "cone") {
    pts.push([G.x, G.y]);
    for (let i = 0; i <= 8; i++) { const q = G.dir - G.half + (2 * G.half * i) / 8; pts.push([G.x + Math.cos(q) * G.len, G.y + Math.sin(q) * G.len]); }
  } else if (G.shape === "line") {
    const c = Math.cos(G.dir), s = Math.sin(G.dir), hw = G.width / 2;
    for (const [f, side] of [[0, -1], [0, 1], [1, -1], [1, 1]]) pts.push([G.x + c * G.len * f - s * hw * side, G.y + s * G.len * f + c * hw * side]);
  } else {
    for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) pts.push([G.x + a * G.r, G.y + b * G.r]);
  }
  const ap = pts.map(([x, y]) => v.ap(x, y, 0));
  return [Math.min(...ap.map((p) => p[0])) - 1, Math.min(...ap.map((p) => p[1])) - 1, Math.max(...ap.map((p) => p[0])) + 1, Math.max(...ap.map((p) => p[1])) + 1];
}

/** Chunky value per 4×4 art pixels, for the scar's dissolve: blocks, never speckle. */
const grain = (wx, wy, aps, seed) => hash(Math.floor((wx * aps) / 4), Math.floor((wy * aps) / 4), seed);

registerShapes({
  /**
   * The footprint. `tele` seconds of cast indicator (fill sweeping from the
   * wave's origin to the edge), then the hit: a full flash stepping down the
   * ramp on the 12 fps clock, then the scar dissolving until `life`.
   */
  zone(v, P, p) {
    const G = p.geom, inv = groundInverse(v, G.x, G.y);
    if (!inv) return;
    const aps = v.aps, rimW = 1.4 / aps, tele = p.tele ?? 0, k = p.age - tele, gentle = !!p.gentle;
    const spread = p.spread ?? 0, scarLen = Math.max(0.2, p.life - tele - spread - 0.42);
    const march = Math.floor(p.age * 12), prog = clamp(p.age / Math.max(0.05, tele));
    /* Every stage, resolved once per frame: the colours do not depend on the pixel. */
    const C = {
      teleRim: { c: S(p.R, 0.85), a: 1 }, teleRimOff: { c: S(p.R, 0.55), a: 0.5 },
      teleOn: { c: S(p.R, 0.62), a: 0.5 }, teleOff: { c: S(p.R, 0.45), a: 0.25 },
      hot: { c: S(p.R, gentle ? 0.85 : 1), a: gentle ? 0.5 : 1 }, hotRim: { c: S(p.R, 1), a: 1 },
      warm: { c: S(p.R, 0.85), a: gentle ? 0.5 : 0.75 }, warmRim: { c: S(p.R, 0.95), a: 1 },
      glow: { c: S(p.R, 0.62), a: gentle ? 0.25 : 0.5 }, glowRim: { c: S(p.R, 0.85), a: 1 },
      scarRim: { c: S(p.R, 0.7), a: 1 },
    };
    const [x0, y0, x1, y1] = boxOf(v, G);
    P.shade(x0, y0, x1, y1, (px, py) => {
      const [wx, wy] = inv(px, py), m = areaMetric(G, wx, wy);
      if (!m) return null;
      const rimmed = m.edge < rimW;
      /* Each square is hit when the wave reaches it, not when the spell lands. */
      const kl = k - m.d * spread;
      if (kl < 0) {
        if (rimmed) return ((Math.floor((wx + wy) * aps / 3) + march) & 3) < 2 ? C.teleRim : C.teleRimOff;
        return k < 0 && m.d > prog ? C.teleOff : C.teleOn;
      }
      const fr = Math.floor(kl * 12);
      if (fr <= 0) return rimmed ? C.hotRim : C.hot;
      if (fr === 1) return rimmed ? C.warmRim : C.warm;
      if (fr <= 4) return rimmed ? C.glowRim : C.glow;
      const u = clamp((kl - 5 / 12) / scarLen);
      if (rimmed) return u < 0.5 ? C.scarRim : null;
      /* The scar burns out in chunks, the rim first and the middle last. */
      if (grain(wx, wy, aps, p.seed) * 0.75 + (1 - m.d) * 0.25 < u * 1.05) return null;
      return { c: S(p.scarR ?? p.R, gentle ? 0.55 : 0.35), a: gentle ? 0.25 : u < 0.5 ? 0.5 : 0.25 };
    }, 0, "mix");
  },

  /** The front of the hit, travelling from the origin to the exact edge over `dur`. */
  shock(v, P, p) {
    const G = p.geom, u = clamp(p.age / p.dur), f = easeOut(u), ext = extentOf(G), aps = v.aps;
    const at = f * ext, fade = u < 0.85 ? 1 : 1 - (u - 0.85) / 0.15;
    if (fade <= 0) return;
    const bands = [[0, S(p.R, 1)], [1, S(p.R, 0.95)], [2, S(p.R, 0.75)], [3, S(p.R, 0.6)]].slice(0, p.thick ?? 4);
    const o = 1;
    if (G.shape === "cone" || G.shape === "line") {
      for (const [b, c] of bands) {
        const r = at - b / aps;
        if (r <= 0) continue;
        if (G.shape === "cone") {
          const n = Math.max(6, Math.ceil(G.half * 2 * r * aps / 2));
          let prev = null;
          for (let i = 0; i <= n; i++) {
            const q = G.dir - G.half + (2 * G.half * i) / n, pt = v.ap(G.x + Math.cos(q) * r, G.y + Math.sin(q) * r, 0);
            if (prev) P.line(prev[0], prev[1], pt[0], pt[1], c, o, fade);
            prev = pt;
          }
        } else {
          const cs = Math.cos(G.dir), sn = Math.sin(G.dir), hw = G.width / 2;
          const A = v.ap(G.x + cs * r + sn * hw, G.y + sn * r - cs * hw, 0), B = v.ap(G.x + cs * r - sn * hw, G.y + sn * r + cs * hw, 0);
          P.line(A[0], A[1], B[0], B[1], c, o, fade);
        }
      }
      return;
    }
    const [cx, cy] = v.ap(G.x, G.y, 0);
    for (const [b, c] of bands) {
      const rx = at * aps - b;
      if (rx < 1) continue;
      P.ellipse(cx, cy, rx, Math.max(0.5, rx * v.sq), (q) => (p.broken && hash(Math.floor(q * 10), p.seed) < 0.15 ? null : { c, a: fade }), o);
    }
  },
}, { flat: ["zone", "shock"] });

/* ── the timeline ──────────────────────────────────────────────────────── */

/**
 * Lay an area's whole grammar onto a sim.
 * @param {object} o
 * @param {number} o.tele0     when the cast indicator appears
 * @param {number} o.hitAt     when the hit lands (the indicator fills until then)
 * @param {number} o.pow       the effect's power at its strongest target
 * @param {boolean} [o.gentle] a helpful area: no scar, softer flash, no shake
 * @param {boolean} [o.erupt]  false to skip the family's eruptions across the area
 * @returns {{ G, shockDur: number, pointsAt: (d: number) => number }}
 */
export function areaFX(s, M, A, { tele0, hitAt, pow, gentle = false, erupt = true, linger = 2.2 }) {
  const G = areaGeom(A), ext = extentOf(G);
  const shockDur = clamp(0.16 + ext * 0.055, 0.22, 0.62);
  const crit = pow > 1.3;
  const seed = Math.floor(s.R() * 1e6);
  const tele = Math.max(0, hitAt - tele0);
  const spread = shockDur * 0.95;
  s.at(tele0, (s2) => s2.add({ k: "zone", x: G.x, y: G.y, geom: G, tele, spread, life: tele + spread + 0.42 + linger, R: M.R, gentle, seed, update: still }));
  s.at(hitAt, (s2) => {
    s2.add({ k: "shock", x: G.x, y: G.y, geom: G, dur: shockDur, life: shockDur, R: M.R, thick: gentle ? 2 : 4, seed, update: still });
    if (crit) s2.add({ k: "shock", x: G.x, y: G.y, geom: G, dur: shockDur * 1.5, life: shockDur * 1.5, R: M.R, thick: 2, broken: true, seed: seed + 1, wait: 0.08, update: still });
    /* Light the whole area, then the front as it travels. */
    if (G.shape === "cone" || G.shape === "line") {
      /* Light that follows the footprint, not a disc round its middle. */
      for (const f of [0.22, 0.55, 0.85]) {
        const r = G.shape === "line" ? G.width * 0.9 + 0.5 : Math.tan(G.half) * G.len * f + 0.6;
        s2.light(G.x + Math.cos(G.dir) * G.len * f, G.y + Math.sin(G.dir) * G.len * f, 0.4, r, S(M.R, 0.9), gentle ? 0.5 : 0.85, 0.55 + shockDur * (0.5 + f));
      }
    } else {
      s2.light(G.x, G.y, 0.4, ext * 0.95 + 0.6, S(M.R, 0.9), gentle ? 0.6 : 1, 0.55 + shockDur);
    }
    if (!gentle && !M.mod.gentle) s2.shake = Math.max(s2.shake, Math.min(5, 1 + ext * 0.45 * pow));
  });
  if (erupt) {
    const R = () => s.R();
    const max = Math.round(clamp(6 + ext * 3.2, 8, crit ? 26 : 20));
    const { pts, step } = areaPoints(G, max, R);
    const sub = Math.min(0.85, (gentle ? 0.45 : 0.6) * Math.max(0.6, pow));
    pts.forEach((pt, i) => {
      s.at(hitAt + pt.d * shockDur * 0.95 + R() * 0.03, (s2) => {
        /* Every other eruption is "minor": a loaded table sheds half the
           crowd and keeps the coverage. */
        s2.minorScope = i % 2 === 1;
        try { M.mod.burst(s2, M, { x: pt.x, y: pt.y, z: 0.25 + R() * 0.2, pow: sub, rad: clamp(step * 0.42, 0.3, 0.6), sub: true }); }
        finally { s2.minorScope = false; }
      });
    });
  }
  s.phases.push(`${G.shape} area: indicator, flash, shock, eruptions`);
  return { G, shockDur };
}
