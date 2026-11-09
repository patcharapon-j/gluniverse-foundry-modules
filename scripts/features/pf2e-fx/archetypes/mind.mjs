/**
 * Spellsprite archetypes — the mind: the hinder split (hex, fear, charm, slow, sleep, blind) and vanishing.
 * docs/SPELLSPRITE_ARCHETYPES.md says what each covers; the spellsprite-craft skill says how good it must be.
 *
 * Each drawer is (s, M, ctx) like a FORMS entry: ctx = { caster, targets, area, hand, t0, release, linger, fire, self }.
 * buildForm has drawn the caster's charge (and an area's footprint); a drawer draws what lands on each subject.
 *
 *   hex     a sigil is traced on the ground round the target, an evil-eye brand stamps onto it,
 *           dark motes are drawn up out of the body into the brand; the sigil flares and crumbles
 *   fear    the target recoils and cowers in a shake, jagged dread ripples and shock lines burst off it,
 *           a jittering "!" over the head, sweat flying
 *   charm   a thread runs from the caster to the head, hypnotic spiral rings wind in, a beating heart
 *           (or a hypnotic eye, for a command) pops over the head and throws rings; little hearts rise
 *   slow    a clock dial round the feet ticks in heavier and heavier steps, afterimages drag behind the
 *           body, the body greys out, sand sinks in slow motion
 *   sleep   lullaby motes spiral down onto the head, a soft dark veil dims the body, Zs drift up and grow
 *   blind   a glaring sunburst at the eyes, then a dark blindfold band wraps across them, glitter falls
 *   vanish  the body shimmers, dissolves bottom to top in a pixel scatter, and leaves a refracting outline
 *
 * Every one scales with the subject's size, takes the material's ramp, and reads its outcome: a crit is
 * bigger with a hero frame, a miss visibly fails (the sigil cracks, the thread snaps, the band tears, the
 * dial spins free, the sleeper starts awake, the body snaps back).
 */

import { TAU, clamp, lerp, easeOut, hash, fadeOut } from "../core/rand.mjs";
import { RAMP, S, WHITE, INK } from "../core/palette.mjs";
import { registerShapes, GLYPHS } from "../core/shapes.mjs";
import { still } from "../core/motifs.mjs";
import { areaGeom, areaPoints } from "../area.mjs";
import { ICONS } from "../conditions.mjs";

/* ── ramps derived from the material's ─────────────────────────────── */

const cache = new WeakMap();
const derived = (R, key, fn) => {
  let m = cache.get(R);
  if (!m) { m = {}; cache.set(R, m); }
  return (m[key] ??= Object.freeze(fn(R)));
};
/** The material's shadow end: dread and drain read dark with a lit rim. */
const deep = (R) => derived(R, "deep", (r) => [r[0], r[0], r[1], r[1], r[2], r[3], r[4]]);
/** The material drained of colour: what a slowed body greys towards. */
const grey = (R) => derived(R, "grey", (r) => r.map(([a, b, c]) => {
  const l = 0.3 * a + 0.59 * b + 0.11 * c;
  return [Math.round(lerp(a, l, 0.8)), Math.round(lerp(b, l, 0.8)), Math.round(lerp(c, l, 0.8))];
}));

/* ── glyphs: drawn from shape functions, so they grow without growing the art pixel ── */

/** 0 none, 1 body (edge-shaded), 2 ink, 3 highlight, 4 bright accent, 5 mid accent. */
const FORM = {
  heart(u, w) {
    const X = u * 1.12, Y = -w * 1.12 + 0.3, f = (X * X + Y * Y - 1) ** 3 - X * X * Y ** 3;
    if (f > 0) return 0;
    if (X < -0.25 && X > -0.62 && Y > 0.42 && Y < 0.8) return 3;
    return 1;
  },
  eye(u, w, p) {
    // an almond lid, a lit iris and a slit pupil; three lashes above it for the evil eye
    if (p.lash && w < -0.5 && w > -0.95) for (const lx of [-0.5, 0, 0.5]) if (Math.abs(u - lx * (1 + (w + 0.5) * 0.5)) < 0.09) return 5;
    const lid = 0.52 * (1 - u * u);
    if (Math.abs(w) > lid || Math.abs(u) > 1) return 0;
    const d = Math.hypot(u, w);
    if (d < 0.4) {
      if (p.spiral) return Math.floor((Math.atan2(w, u) / TAU) * 2 * 3 + d * 9 - p.age * 6) % 2 ? 4 : 2;
      if (Math.abs(u) < 0.1 && Math.abs(w) < 0.36) return 2;
      return d > 0.32 ? 5 : 4;
    }
    return Math.abs(w) > lid - 0.16 ? 1 : 3;
  },
  bang(u, w, p) {
    // a jagged exclamation: the stroke's edge shivers row by row
    const j = (hash(Math.floor((w + 1) * 6), Math.floor(p.age * 12), p.seed) - 0.5) * 0.12;
    if (w > -1 && w < 0.4 && Math.abs(u + j) < 0.27 - (w + 1) * 0.07) return w < -0.75 ? 3 : 1;
    if (Math.hypot(u, w - 0.75) < 0.22) return 1;
    return 0;
  },
  zed(u, w) {
    const t = 0.3;
    if (Math.abs(u) > 0.85) return 0;
    if (w >= -1 && w <= -1 + t) return w < -1 + t * 0.5 ? 3 : 1;
    if (w <= 1 && w >= 1 - t) return 1;
    // the diagonal from the top bar's right end to the bottom bar's left
    const ax = 0.85, ay = -1 + t, bx = -0.85, by = 1 - t, dx = bx - ax, dy = by - ay;
    const f = clamp(((u - ax) * dx + (w - ay) * dy) / (dx * dx + dy * dy)), px = ax + dx * f - u, py = ay + dy * f - w;
    return Math.hypot(px, py) < t * 0.62 ? 1 : 0;
  },
};

/* ── shapes ──────────────────────────────────────────────────────────── */

/** The sigil's pen path in art px round its centre: outer circle, star, inner circle, heart ring. Each point carries when the pen passes it (0..1). */
function sigilPath(rp, n, step) {
  const paths = [], circ = (r, a0) => { const N = Math.max(12, Math.ceil(r * TAU)); return Array.from({ length: N + 1 }, (_, i) => [Math.cos(a0 + (i / N) * TAU) * r, Math.sin(a0 + (i / N) * TAU) * r]); };
  paths.push(circ(rp, -Math.PI / 2));
  const star = [];
  for (let i = 0; i <= n; i++) { const a = -Math.PI / 2 + ((i * step) % n) * (TAU / n); star.push([Math.cos(a) * rp * 0.76, Math.sin(a) * rp * 0.76]); }
  paths.push(star, circ(rp * 0.76, -Math.PI / 2), circ(rp * 0.2, Math.PI / 2));
  // the pen is fast round the circles and heavier through the star
  const weight = [0.8, 1.35, 0.7, 1.2], pts = [];
  let t = 0;
  paths.forEach((path, k) => {
    for (let i = 1; i < path.length; i++) {
      const [x0, y0] = path[i - 1], [x1, y1] = path[i], L = Math.hypot(x1 - x0, y1 - y0);
      for (let d = 0; d < L; d += 0.7) { pts.push([x0 + ((x1 - x0) * d) / L, y0 + ((y1 - y0) * d) / L, t + d * weight[k]]); }
      t += L * weight[k];
    }
    t += 3;
  });
  for (const q of pts) q[2] /= t;
  return pts;
}

/** A clock's two hands: a lit core inside dark edges (it reads on a dark floor and on parchment), the long one tipped with an arrowhead. */
function clockHands(P, cx, cy, r, sq, ang = -Math.PI / 2, ang2 = -Math.PI / 2, fl, R, a, o) {
  const hand = (q, len, w, t, tip) => {
    const c = Math.cos(q), s = Math.sin(q), ex = cx + c * r * len, ey = cy + s * r * len * sq;
    for (let k = -w; k <= w; k++) P.line(cx - s * k, cy + c * k * sq, ex - s * k, ey + c * k * sq, S(R, Math.abs(k) === w ? 0.12 : k ? t - 0.2 : t), o, a);
    if (tip) for (let k = 1; k <= 4; k++) for (let j = -k; j <= k; j++) P.dot(ex + c * (2 - k * 1.2) - s * j * 0.9, ey + (s * (2 - k * 1.2) + c * j * 0.9) * sq, S(R, Math.abs(j) === k ? 0.12 : 0.95), a, o);
  };
  hand(ang2, 0.58, 1, 0.78, false);
  hand(ang, 0.95, 2, fl > 0.3 ? 1 : 0.9, true);
  for (let j = -2; j <= 2; j++) for (let k = -2; k <= 2; k++) if (j * j + k * k <= 4) P.dot(cx + j, cy + k * sq, S(R, j * j + k * k > 2 ? 0.12 : 1), a, o);
}

/** A 3×3 glyph from the suite's alphabet. */
function glyph3(P, G, x, y, c, a) {
  for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) if (G[j * 3 + k] === "1") P.dot(x - 1 + k, y - 1 + j, c, a, 1);
}

registerShapes({
  /** A glyph drawn from FORM at radius `r` art px (times `rs`), edge-shaded and outlined. */
  miGlyph(v, P, p) {
    const fn = FORM[p.form]; if (!fn) return;
    let [cx, cy] = v.ap(p.x, p.y, p.z);
    cx = Math.round(cx + (p.jit ? (hash(Math.floor(p.age * 24), p.seed) - 0.5) * p.jit * 2 : 0)); cy = Math.round(cy);
    const r = Math.max(2, p.r * (p.rs ?? 1)), a = (p.alpha ?? 1) * (p.inT ? Math.min(1, p.age / p.inT) : 1) * fadeOut(p.age / p.life, p.from ?? 0.7);
    if (a <= 0.02) return;
    const at = (x, y) => fn((x - cx) / r, (y - cy) / r, p);
    const R = p.R, hero = p.hero && p.age < 2 / 12;
    P.shade(cx - r - 1, cy - r - 1, cx + r + 1, cy + r + 1, (x, y) => {
      const k = at(x, y);
      if (!k) return null;
      if (p.crack && Math.abs((x - cx) / r + 0.28 * Math.sin(((y - cy) / r) * 8) - 0.05) < 0.08) return { c: INK, a };
      if (hero) return WHITE;
      let t;
      if (k === 2) return { c: INK, a };
      if (k === 3) t = 1; else if (k === 4) t = 0.95; else if (k === 5) t = 0.62;
      else t = !at(x, y - 1) || !at(x - 1, y) ? 0.9 : !at(x, y + 1) || !at(x + 1, y) ? 0.48 : 0.72 - ((y - cy) / r) * 0.08;
      return { c: S(R, t + (p.lift ?? 0)), a };
    }, 2);
  },

  /** Hex: a sigil traced on the ground by a burning pen; it holds, flares, then crumbles. */
  miSigil(v, P, p) {
    const [cx, cy] = v.ap(p.x, p.y, 0), rp = Math.max(4, p.r * v.aps), sq = v.sq, age = p.age, fr = Math.floor(age * 12);
    if (p._rp !== rp) { p._rp = rp; p._pts = sigilPath(rp, p.n, p.step); }
    const pen = clamp(age / p.trace), crack = age > p.crack ? clamp((age - p.crack) / 0.4) : 0;
    const flare = age >= p.flare && age < p.flare + 2 / 12, hold = age > p.trace ? 0.5 + 0.5 * Math.sin((age - p.trace) * 10) : 0;
    const a = fadeOut(age / p.life, 0.8), R = p.R;
    // the stained ground inside the ring, while it holds
    if (age > p.trace * 0.6 && !crack) {
      const ry = rp * sq, k = clamp((age - p.trace * 0.6) / 0.3) * 0.5;
      P.shade(cx - rp, cy - ry, cx + rp, cy + ry, (x, y) => { const dx = (x - cx) / rp, dy = (y - cy) / ry; return dx * dx + dy * dy < 0.95 ? { c: S(R, 0.15), a: k * a } : null; }, 0, "mix");
    }
    const pts = p._pts;
    for (let i = 0; i < pts.length; i++) {
      const q = pts[i]; if (q[2] > pen) break;
      if (crack && hash(i >> 2, p.seed) < crack * 1.15) continue;
      const since = (pen - q[2]) * p.trace;
      const c = flare ? (p.hero ? WHITE : S(R, 1)) : since < 0.05 ? S(R, 1) : since < 0.16 ? S(R, 0.9) : S(R, hold > 0.7 ? 0.9 : 0.75);
      P.dot(cx + q[0], cy + q[1] * sq, c, a, 1);
    }
    // the glyph band pops in glyph by glyph once the pen is done
    for (let i = 0; i < p.n; i++) {
      const t0 = p.trace * 0.85 + i * 0.05; if (age < t0 || (crack && hash(i, p.seed, 3) < crack)) continue;
      const q = -Math.PI / 2 + ((i + 0.5) * TAU) / p.n, gx = Math.round(cx + Math.cos(q) * rp * 0.88), gy = Math.round(cy + Math.sin(q) * rp * 0.88 * sq);
      glyph3(P, GLYPHS[(i + p.seed) % GLYPHS.length], gx, gy, age - t0 < 0.08 || flare ? S(R, 1) : S(R, 0.85), a);
    }
    // the pen: a hot point with a little cross of light
    if (age < p.trace) {
      const q = pts[Math.max(0, Math.min(pts.length - 1, Math.floor(pen * pts.length) - 1))], x = cx + q[0], y = cy + q[1] * sq, n = 1 + (fr % 2);
      P.px(x, y, S(R, 1), 2);
      for (let k = 1; k <= n; k++) { P.px(x + k, y, S(R, 0.9), 2); P.px(x - k, y, S(R, 0.9), 2); P.px(x, y + k, S(R, 0.9), 2); P.px(x, y - k, S(R, 0.9), 2); }
    }
  },

  /** Fear: a jagged ripple, a star-edged ring racing out (or, on a miss, collapsing in). */
  miSpikes(v, P, p) {
    const u = clamp(p.age / p.life), [cx, cy] = v.ap(p.x, p.y, 0), rr = lerp(p.r0, p.r1, easeOut(u)) * v.aps, sq = v.sq;
    if (rr < 2) return;
    const a = 1 - u * u, N = p.n * 2, fr = Math.floor(p.age * 12);
    const vert = (i, k) => {
      const q = (i / N) * TAU + p.seed, j = hash(i, p.seed, fr >> 1);
      const rad = rr * k * (i % 2 ? 0.74 + 0.08 * j : 1 + 0.2 * j);
      return [cx + Math.cos(q) * rad, cy + Math.sin(q) * rad * sq];
    };
    for (const [k, t] of [[0.9, 0.3], [1, 0.92]]) {
      let prev = vert(0, k);
      for (let i = 1; i <= N; i++) { const nx = vert(i % N, k); P.line(prev[0], prev[1], nx[0], nx[1], S(p.R, t), k === 1 ? 1 : 0, a); prev = nx; }
    }
  },

  /** Fear: manga shock lines bursting off the body, a fresh set every other frame. */
  miDread(v, P, p) {
    const [cx, cy] = v.ap(p.x, p.y, p.z), g = Math.floor(p.age * 6), a = fadeOut(p.age / p.life, 0.6), rin = p.rin * v.aps, rout = p.rout * v.aps;
    for (let i = 0; i < p.n; i++) {
      const q = hash(i, g, p.seed) * TAU, L = lerp(0.55, 1, hash(i, g, p.seed + 1)), r0 = rin * lerp(1, 1.25, hash(i, g, 7)), r1 = r0 + (rout - rin) * L;
      const c = Math.cos(q), s = Math.sin(q);
      P.line(cx + c * r0, cy + s * r0, cx + c * r1, cy + s * r1, null, 1, a, (f) => S(p.R, f < 0.35 ? 1 : f < 0.7 ? 0.8 : 0.4));
    }
  },

  /** Slow: a clock dial on the ground, ticking in heavy steps. */
  miDial(v, P, p) {
    const [cx, cy] = v.ap(p.x, p.y, 0), r = p.r * v.aps, sq = v.sq, a = (p.inT ? Math.min(1, p.age / p.inT) : 1) * fadeOut(p.age / p.life, 0.75), R = p.R;
    const fl = p.flash ?? 0, br = p.broken ?? 0;
    const ry = r * sq;
    P.shade(cx - r, cy - ry, cx + r, cy + ry, (x, y) => { const dx = (x - cx) / r, dy = (y - cy) / ry, d = dx * dx + dy * dy; return d < 0.9 ? { c: S(R, 0.3 + fl * 0.3), a: a * (d > 0.55 ? 0.3 + fl * 0.25 : 0.12 + fl * 0.2) } : null; }, 0, "mix");
    for (const [k, t] of [[0, fl > 0.4 ? 1 : 0.95], [1, 0.55], [3, 0.8]]) {
      const rk = r - k;
      P.ellipse(cx, cy, rk, rk * sq, (q) => (br && hash(Math.floor((q / TAU) * 24), p.seed) < br ? null : { c: S(R, t), a }), 1);
    }
    for (let i = 0; i < 12; i++) {
      const q = (i / 12) * TAU - Math.PI / 2, L = i % 3 === 0 ? 0.24 : 0.12, c = Math.cos(q), s = Math.sin(q);
      if (br && hash(i, p.seed, 2) < br) continue;
      P.line(cx + c * r * (0.86 - L), cy + s * r * (0.86 - L) * sq, cx + c * r * 0.86, cy + s * r * 0.86 * sq, S(R, i % 3 === 0 ? 0.95 : 0.7), 1, a);
    }
    // top-down the hands sweep over the creature (miHands, in the stand layer); a billboard keeps them on the dial
    if (v.kind !== "top") clockHands(P, cx, cy, r, sq, p.ang, p.ang2, fl, R, a, 1);
  },

  /** Slow, top-down: the dial's hands, drawn over the creature standing on it. */
  miHands(v, P, p) {
    if (v.kind !== "top") return;
    const d = p.dial, [cx, cy] = v.ap(p.x, p.y, 0), a = (d.inT ? Math.min(1, d.age / d.inT) : 1) * fadeOut(d.age / d.life, 0.75);
    clockHands(P, cx, cy, d.r * v.aps, 1, d.ang, d.ang2, d.flash ?? 0, d.R, a, 2);
  },

  /** Slow: an afterimage of a body, left behind and fading (true translucency). */
  miEcho(v, P, p) {
    const a = (p.a ?? 0.5) * (1 - clamp(p.age / p.life)), [bx, by] = v.ap(p.x, p.y, 0);
    if (a < 0.1) return;
    const c = S(p.R, 0.62), rim = S(p.R, 0.9);
    if (v.kind === "top") {
      const r = 0.44 * p.size * v.aps;
      P.shade(bx - r, by - r, bx + r, by + r, (x, y) => { const d = Math.hypot(x - bx, y - by) / r; return d > 1 ? null : { c: d > 0.8 ? rim : c, a: d > 0.8 ? a : a * 0.6 }; }, 0, "mix");
      return;
    }
    const G = v.aps, hh = p.h * G, hr = 0.13 * p.size * G, hy = by - hh * 0.86;
    P.shade(bx - 0.3 * G * p.size, hy - hr - 1, bx + 0.3 * G * p.size, by, (x, y) => {
      const up = (by - y) / hh, dx = Math.abs(x - bx);
      if (Math.hypot(x - bx, y - hy) <= hr) return { c, a };
      if (up < 0.04 || up > 0.74) return null;
      const w = (up > 0.32 ? lerp(0.23, 0.17, (up - 0.32) / 0.42) : 0.12) * p.size * G;
      return dx > w ? null : { c: dx > w - 1 ? rim : c, a };
    }, 0, "mix");
  },

  /** Slow, sleep: a translucent veil over the body (the body greys out, or dims). */
  miVeil(v, P, p) {
    const a = (p.ka ?? 0.5) * (p.inT ? Math.min(1, p.age / p.inT) : 1) * fadeOut(p.age / p.life, 0.7), [bx, by] = v.ap(p.x, p.y, 0);
    if (a < 0.05) return;
    const c = S(p.R, p.tone ?? 0.5), rim = S(p.R, p.rim ?? 0.8), fr = Math.floor(p.age * 12);
    if (v.kind === "top") {
      const r = 0.47 * p.size * v.aps;
      P.shade(bx - r, by - r, bx + r, by + r, (x, y) => { const d = Math.hypot(x - bx, y - by) / r; return d > 1 ? null : { c: d > 0.86 ? rim : c, a: d > 0.86 ? Math.min(1, a * 1.3) : a }; }, 0, "mix");
      return;
    }
    const G = v.aps, top = by - p.h * G * 1.02, w = 0.3 * p.size * G;
    P.shade(bx - w, top, bx + w, by, (x, y) => {
      const f = (by - y) / (by - top), dx = Math.abs(x - bx) / (w * (f > 0.78 ? 0.6 : 1));
      if (dx > 1) return null;
      return { c: dx > 0.82 || ((y + fr) % 4 === 0 && dx > 0.6) ? rim : c, a };
    }, 0, "mix");
  },

  /** Charm: hypnotic spiral arms turning round the target, and rings winding in. */
  miSpiral(v, P, p) {
    const [cx, cy] = v.ap(p.x, p.y, 0), r = p.r * v.aps, sq = v.sq, age = p.age, R = p.R;
    const grow = easeOut(clamp(age / 0.3)), a = fadeOut(age / p.life, 0.7) * (p.unwind && age > p.unwind ? Math.max(0, 1 - (age - p.unwind) / 0.4) : 1);
    if (a <= 0.02) return;
    const rot = (p.unwind && age > p.unwind ? -(age - p.unwind) * 9 : 0) + age * p.w, M = TAU * 1.5, rr = r * grow;
    for (let k = 0; k < p.arms; k++) {
      for (let th = 0.4; th < M;) {
        const rad = rr * (th / M), q = rot + (k * TAU) / p.arms + th;
        P.dot(cx + Math.cos(q) * rad, cy + Math.sin(q) * rad * sq, S(R, Math.floor(th * 2.2 - age * 7) % 2 ? 0.95 : 0.62), a * (th < 1.2 ? th / 1.2 : 1), 1);
        th += 0.85 / Math.max(2, rad);
      }
    }
    // rings that wind inward: the opposite of a burst
    for (let j = 0; j < 3; j++) {
      const f = (age * 1.1 + j / 3) % 1, rad = rr * (1.25 - f * 0.95);
      if (rad < 2) continue;
      P.ellipse(cx, cy, rad, rad * sq, (q) => (Math.floor((q / TAU) * 20 + age * 10) % 4 === 3 ? null : { c: S(R, f > 0.7 ? 1 : 0.8), a: a * Math.min(1, f * 3) }), 1);
    }
  },

  /** Charm: a thread from the caster's hand to the head, pulses of will running along it; it can snap. */
  miThread(v, P, p) {
    const [ax, ay] = v.ap(...p.a), [bx, by] = v.ap(...p.b), dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy);
    if (L < 2) return;
    const nx = -dy / L, ny = dx / L, age = p.age, ext = clamp(age / p.ext), a = fadeOut(age / p.life, 0.7), R = p.R;
    const snap = p.snap && age > p.snap ? age - p.snap : 0, n = Math.ceil(L * ext);
    for (let i = 0; i <= n; i++) {
      const f = i / Math.max(1, L);
      if (snap && Math.abs(f - 0.5) < snap * 1.6) continue;
      const droop = snap ? snap * snap * 60 * Math.abs(f - 0.5) : 0;
      const off = Math.sin(f * Math.PI) * p.sag + Math.sin(f * TAU * 2.5 - age * 9) * 1.6 * (1 - ext * 0.4);
      const x = ax + dx * f + nx * off, y = ay + dy * f + ny * off + droop;
      let hot = false;
      for (let j = 0; j < 3; j++) if (Math.abs(f - ((age * 1.3 + j / 3) % 1)) < 0.035) hot = true;
      const aa = a * (snap ? Math.max(0, 1 - snap / 0.45) : 1);
      P.dot(x, y, S(R, hot ? 1 : 0.78), aa, 1);
      if (p.thick) P.dot(x, y + 1, S(R, hot ? 0.9 : 0.6), aa, 1); else P.under(x, y + 1, S(R, 0.45));
    }
    if (ext < 1 && !snap) { const x = ax + dx * ext, y = ay + dy * ext; P.px(x, y, S(R, 1), 2); P.px(x + 1, y, S(R, 0.9), 2); P.px(x - 1, y, S(R, 0.9), 2); P.px(x, y - 1, S(R, 0.9), 2); P.px(x, y + 1, S(R, 0.9), 2); }
  },

  /** Blind: a glaring sunburst, long and short rays turning round a hot core. */
  miRays(v, P, p) {
    const u = clamp(p.age / p.life), [cx, cy] = v.ap(p.x, p.y, p.z), fr = Math.floor(p.age * 12), hero = p.hero && fr < 2;
    const L = p.L * v.aps * (u < 0.15 ? lerp(0.4, 1.2, u / 0.15) : lerp(1.2, 0.55, (u - 0.15) / 0.85)), a = fadeOut(u, 0.55), rot = p.rot + p.age * 0.7;
    for (let i = 0; i < p.n; i++) {
      const q = rot + (i / p.n) * TAU, len = L * (i % 2 ? 0.55 : 1) * (0.85 + 0.3 * hash(i, p.seed)), c = Math.cos(q), s = Math.sin(q);
      const col = (f) => (hero ? WHITE : S(p.R, f < 0.3 ? 1 : f < 0.65 ? 0.9 : 0.72));
      P.line(cx + c * 3, cy + s * 3, cx + c * len, cy + s * len, null, 2, a, col);
      if (i % 2 === 0) for (const k of [-1, 1]) P.line(cx + c * 3 - s * k, cy + s * 3 + c * k, cx + c * len * 0.45 - s * k, cy + s * len * 0.45 + c * k, null, 2, a, col);
    }
    const cr = 2.5 + L * 0.12;
    P.shade(cx - cr, cy - cr, cx + cr, cy + cr, (x, y) => (Math.hypot(x - cx, y - cy) <= cr ? (hero || u < 0.25 ? WHITE : S(p.R, 1)) : null), 2);
  },

  /** Blind: a dark band wrapped across the eyes, its tails fluttering; on a miss it tears. */
  miBand(v, P, p) {
    const top = v.kind === "top", age = p.age, a = fadeOut(age / p.life, 0.75), R = p.R;
    const [cx, cy] = top ? v.ap(p.x, p.y - 0.07 * p.size, 0) : v.ap(p.x, p.y, 0.84 * p.h);
    const W = (top ? 0.47 * p.size * v.aps : 0.17 * p.size * v.aps) + 3, hw = W * easeOut(clamp(age / 0.16)), H = p.th;
    const tear = p.tear && age > p.tear ? age - p.tear : 0;
    const x0 = Math.round(cx - hw), x1 = Math.round(cx + hw), y0 = Math.round(cy - H / 2), glint = x0 + ((age * 46) % Math.max(1, x1 - x0));
    for (let x = x0; x <= x1; x++) {
      const side = x < cx ? -1 : 1;
      if (tear && Math.abs(x - cx) < tear * 30) continue;
      const dy = tear ? Math.round(tear * tear * 40 + (side < 0 ? 1 : 2)) : 0, aa = a * (tear ? Math.max(0, 1 - tear / 0.5) : 1);
      for (let j = 0; j < H; j++) P.dot(x + (tear ? side * tear * 14 : 0), y0 + j + dy, Math.abs(x - glint) < 1 && j > 0 && j < H - 1 ? S(R, 0.8) : S(R, j === 0 ? 0.62 : j === H - 1 ? 0.42 : (x + j) % 5 === 0 ? 0.3 : 0.15), aa, 2);
    }
    // the knot's tails flutter off the far end
    if (hw >= W - 0.5 && !tear) for (let k = 0; k < 2; k++) {
      const len = 6 + k * 3 + Math.round(p.size * 2);
      for (let i = 1; i <= len; i++) {
        const f = i / len, y = y0 + 1 + k * 2 + Math.sin(i * 0.8 - age * 13 + k) * 1.6 * f + f * 2;
        P.dot(x1 + i * 0.9, y, S(R, i % 3 === 0 ? 0.45 : 0.15), a * (1 - f * 0.5), 2);
      }
    }
  },

  /** Vanish: the body's signal breaks up, rows torn sideways. */
  miShimmer(v, P, p) {
    const [bx, by] = v.ap(p.x, p.y, 0), fr = Math.floor(p.age * 24), a = fadeOut(p.age / p.life, 0.5) * Math.min(1, p.age / 0.06), R = p.R;
    const top = v.kind === "top", r = 0.48 * p.size * v.aps, ty = top ? by - r : by - p.h * v.aps * 1.02, yb = top ? by + r : by;
    for (let y = Math.floor(ty); y <= yb; y++) {
      const hw = top ? Math.sqrt(Math.max(0, r * r - (y - by) ** 2)) : 0.27 * p.size * v.aps * ((by - y) / (by - ty) > 0.78 ? 0.55 : 1);
      if (hw < 1) continue;
      const h = hash(y >> 1, fr, p.seed), sh = h < 0.35 ? Math.round((h - 0.17) * 30) : 0;
      if (!sh && (y + fr) % 3) continue;
      for (let x = Math.round(bx - hw); x <= bx + hw; x++) P.mix(x + sh, y, S(R, sh ? 0.95 : 0.7), a * (sh ? 0.75 : 0.35));
      if (sh) { P.px(bx - hw + sh - 1, y, S(R, 1), 1); P.px(bx + hw + sh + 1, y, S(R, 1), 1); }
    }
  },

  /** Vanish: one pixel block of a dissolving body, born as a bright outline, filling and cooling. */
  miBit(v, P, p) {
    const [x, y] = v.ap(p.x, p.y, p.z), u = p.age / p.life, fr = Math.floor(p.age * 12), n = p.s, a = fadeOut(u, 0.55), R = p.R;
    const x0 = Math.round(x), y0 = Math.round(y);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const edge = i === 0 || j === 0 || i === n - 1 || j === n - 1;
      if (fr === 0 && !edge && n > 2) continue;
      P.dot(x0 + i, y0 + j, S(R, fr === 0 ? 1 : edge ? 0.85 - u * 0.3 : 0.6 - u * 0.3), a, 1);
    }
  },

  /** Vanish: the outline of a body you cannot see, split like light through a lens. */
  miRefract(v, P, p) {
    const age = p.age, fr = Math.floor(age * 12), a = Math.min(1, age / 0.2) * fadeOut(age / p.life, 0.6) * (p.flick && hash(fr, p.seed) < 0.35 ? 0.3 : 1), R = p.R;
    if (a < 0.05) return;
    const [bx, by] = v.ap(p.x, p.y, 0);
    if (v.kind === "top") {
      const r = 0.47 * p.size * v.aps;
      for (const [k, t] of [[-1, 0.95], [1, 0.55]]) {
        const ox = k * (1 + (fr % 2)), n = Math.ceil(TAU * r * 1.3);
        for (let i = 0; i < n; i++) {
          const q = (i / n) * TAU, rr = r + Math.sin(q * 5 + age * 7 * k) * 1.1;
          if (Math.floor((q / TAU) * r * 1.6 + fr * k) % 5 === 4) continue;
          P.mix(Math.floor(bx + ox + Math.cos(q) * rr), Math.floor(by + Math.sin(q) * rr), S(R, t), a * 0.85);
        }
      }
      // the lens highlight: a bright arc inside the upper left
      for (let q = 3.6; q < 4.6; q += 0.08) P.mix(Math.floor(bx + Math.cos(q) * r * 0.68), Math.floor(by + Math.sin(q) * r * 0.68), S(R, 1), a * 0.75);
      return;
    }
    const rx = 0.24 * p.size * v.aps, hh = p.h * v.aps * 0.98, cy = by - hh * 0.5, ry = hh * 0.5, n = Math.ceil(TAU * ry * 1.4);
    for (const [k, t] of [[-1, 0.95], [1, 0.55]]) for (let i = 0; i < n; i++) {
      if ((i + fr * 2 * k) % 9 > 6) continue;
      const q = (i / n) * TAU, y = cy + Math.sin(q) * ry, wob = Math.round(Math.sin(y * 0.6 + age * 9 * k));
      P.mix(Math.floor(bx + k * (1 + (fr % 2)) + Math.cos(q) * rx * (y < cy - ry * 0.55 ? 0.6 : 1) + wob), Math.floor(y), S(R, t), a * 0.8);
    }
  },
}, { flat: ["miSigil", "miSpikes", "miDial", "miSpiral"] });

/* ── helpers ─────────────────────────────────────────────────────────── */

const outOf = (s, T) => T.outcome ?? s.spec.outcome ?? "neutral";
/** Extent by outcome: a crit is the skill's ×1.4, a failure still reads at most of its size. */
const GAIN = Object.freeze({ crit: 1.4, hit: 1, neutral: 0.92, miss: 0.85 });
/** A glyph's radius in art px: big enough to read over a token (spellsprite-craft §1). */
const glyphR = (T, o) => Math.round(clamp(9 * Math.sqrt(T.size) * (o === "crit" ? 1.35 : 1), 8, 20));

/** Every creature an archetype lands on; with an area and nobody in it, creature-sized stand-ins (forms.mjs `subjects`). */
function subjects(s, ctx) {
  if (ctx.targets.length) return ctx.targets;
  if (ctx.area) {
    const got = areaPoints(areaGeom(ctx.area), 4, () => s.R()).pts;
    return (got.length ? got : [{ x: ctx.area.x, y: ctx.area.y }]).map((p) => ({ x: p.x, y: p.y, size: 1, h: 1, id: null }));
  }
  return ctx.caster ? [ctx.caster] : [{ x: 0, y: 0, size: 1, h: 1, id: null }];
}

/** A bolt of the material from the hand to the head; returns when it lands (at once for a self effect). */
function reach(s, M, ctx, T, at, { R = M.R, dark = M.dark, arc = 0.45, trail = "mote", rate = 46 } = {}) {
  if (ctx.self || !ctx.hand) return at;
  const h = ctx.hand, dur = Math.min(0.42, 0.16 + Math.hypot(T.x - h[0], T.y - h[1]) * 0.03);
  const pos = (u) => [lerp(h[0], T.x, u), lerp(h[1], T.y, u), lerp(h[2], 0.8 * T.h, u) + Math.sin(Math.PI * u) * arc];
  s.at(at, (s2) => s2.add({
    k: "orb", x: h[0], y: h[1], z: h[2], life: dur, R, dark, r: 3.5, glow: true,
    update(p, s3, dt) {
      const u = Math.min(1, p.age / dur);
      [p.x, p.y, p.z] = pos(u); p.tail = pos(Math.max(0, u - 0.14));
      for (let i = s3.count(rate, dt); i > 0; i--) s3.add({ k: trail, x: p.x, y: p.y, z: p.z, vx: s3.rand(-0.3, 0.3), vz: s3.rand(-0.3, 0.3), drag: 2.5, life: s3.rand(0.25, 0.5), s: 2, R, minor: true });
    },
  }));
  return at + dur;
}

/** Run `land(s2, T, o)` on every subject when its reach arrives; returns the latest landing. */
function each(s, M, ctx, land, opts) {
  let end = ctx.t0;
  subjects(s, ctx).forEach((T, i) => {
    const at = reach(s, M, ctx, T, ctx.t0 + i * 0.06, opts);
    s.at(at, (s2) => land(s2, T, outOf(s2, T)));
    end = Math.max(end, at);
  });
  return end;
}

/** Where the caster stands relative to T, for recoils and drags (a unit vector from the caster to T). */
function awayFrom(ctx, T) {
  const c = ctx.caster;
  if (!c || ctx.self) return [1, 0];
  const dx = T.x - c.x, dy = T.y - c.y, l = Math.hypot(dx, dy) || 1;
  return [dx / l, dy / l];
}

/** Streaks racing in to a point from a ring: power drawn into the effect (the anticipation beat). */
function gather(s, M, x, y, z, rad, n, life = 0.26, R = M.R) {
  for (let i = 0; i < n; i++) {
    const q = s.rand(0, TAU), d = rad * s.rand(0.8, 1.2), px = x + Math.cos(q) * d, py = y + Math.sin(q) * d, pz = Math.max(0.05, z + s.rand(-0.3, 0.5)), L = life * s.rand(0.85, 1.15);
    s.add({ k: "streak", x: px, y: py, z: pz, vx: (x - px) / L, vy: (y - py) / L, vz: (z - pz) / L, life: L, R, wait: s.rand(0, 0.08), minor: i > n / 2, update(p, _s, dt) { p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; } });
  }
}

/** Radial sparks off a point. */
function sparks(s, R, x, y, z, n, sp, minorFrom = 0) {
  for (let i = 0; i < n; i++) {
    const q = s.rand(0, TAU), v = s.rand(sp * 0.5, sp);
    s.add({ k: "spark", x, y, z, vx: Math.cos(q) * v, vy: Math.sin(q) * v * 0.7, vz: s.rand(-0.5, 1.6), g: 3, drag: 2.5, life: s.rand(0.22, 0.45), R, minor: i >= minorFrom });
  }
}

/* ── hex: the catch-all hinder ───────────────────────────────────────── */

function hex(s, M, ctx) {
  const end = each(s, M, ctx, (s2, T, o) => {
    const g = GAIN[o], miss = o === "miss", crit = o === "crit", R = M.R, sz = T.size, m = 0.85 + 0.15 * s2.m;
    const r = 0.98 * sz * g * m, head = 1.15 * T.h, by = T.y - 0.12 * sz;
    gather(s2, M, T.x, T.y, 0.5 * T.h, r * 1.5, 18);
    s2.add({ k: "miSigil", x: T.x, y: T.y, r, n: 7, step: 3, trace: 0.42, flare: miss ? 9 : 1.05, crack: miss ? 0.62 : 1.2, life: miss ? 1.1 : 1.7, hero: crit, R, seed: s2.seedInt() % 97, update: still });
    s2.light(T.x, T.y, 0.3, r * 2.2, S(R, 0.85), M.dark ? 0.35 : 0.55, 0.45, { swell: true });
    // the brand: an evil eye drops from above the head and stamps on
    const top = head + 0.9, gr = glyphR(T, o);
    s2.at(s2.t + 0.3, (s3) => s3.add({
      k: "miGlyph", form: "eye", lash: true, x: T.x, y: by, z: top, r: gr, life: miss ? 0.75 : 1.45, R, seed: 3, hero: crit, from: 0.78, inT: 0.06, crack: false,
      update(p, s4) {
        if (miss) { p.z = top - 0.35 * easeOut(clamp(p.age / 0.3)); p.jit = p.age > 0.35 ? 1.5 : 0; p.crack = p.age > 0.45; return; }
        const f = clamp(p.age / 0.12);
        p.z = f < 1 ? lerp(top, head, f * f) : head;
        p.rs = f < 1 ? 1 : 1 + 0.25 * Math.exp(-(p.age - 0.12) * 14);
        p.lift = p.age > 0.5 ? 0.06 * Math.sin((p.age - 0.5) * 12) : 0;
        if (f >= 1 && !p.thud) {
          p.thud = true;
          s4.hit(T.id, 0.75 * g, { x: T.x, y: T.y - 1 }, R);
          s4.add({ k: "flash", x: T.x, y: by, z: head, life: (crit ? 2 : 1) / 12, r: gr * 0.9, R, update: still });
          s4.add({ k: "ring", x: T.x, y: T.y, r: 0.72 * sz * g, life: 0.4, R, seed: 5, update: still });
          s4.add({ k: "ring", x: T.x, y: T.y, r: 1.25 * r, life: 0.55, R, broken: true, seed: 6, update: still });
          s4.light(T.x, T.y, head, 1.6 * sz * g, S(R, 0.85), M.dark ? 0.6 : 0.9, 0.5);
          sparks(s4, R, T.x, by, head, crit ? 22 : 12, 3.5, 6);
          if (crit) s4.crit(); else s4.shake = Math.max(s4.shake, 0.8);
        }
      },
    }));
    if (miss) {
      // the brand never lands: it shivers, cracks and bursts in sparks over the head
      s2.at(s2.t + 1.0, (s3) => { sparks(s3, R, T.x, by, top - 0.35, 14, 3, 5); s3.add({ k: "flash", x: T.x, y: by, z: top - 0.35, life: 1 / 12, r: gr * 0.6, R, update: still }); });
    } else {
      // the drain: dark motes are drawn up out of the body, spiralling into the brand
      const DR = deep(R);
      s2.add({ k: "darkpool", x: T.x, y: T.y, r: 0.55 * sz * g, life: 1.6, R, wait: 0.4, update: still });
      s2.emit(s2.t + 0.45, s2.t + 1.45, (s3, u, dt) => {
        for (let i = s3.count(44 * g * sz, dt); i > 0; i--) {
          const q0 = s3.rand(0, TAU), d0 = s3.rand(0.2, 0.42) * sz, z0 = s3.rand(0.05, 0.6) * T.h, life = s3.rand(0.45, 0.7), spin = s3.R() < 0.5 ? -1 : 1;
          s3.add({ k: i % 2 ? "wisp" : "mote", plus: i % 4 === 0, s: i % 3 ? 2 : 3, x: T.x + Math.cos(q0) * d0, y: by + Math.sin(q0) * d0 * 0.6, z: z0, life, R: i % 2 ? DR : R, minor: i % 3 === 2, update(p) {
            const f = easeOut(clamp(p.age / p.life)), q = q0 + spin * f * 3.5, d = d0 * (1 - f);
            p.x = T.x + Math.cos(q) * d; p.y = by + Math.sin(q) * d * 0.6; p.z = lerp(z0, head, f);
          } });
        }
        if (s3.R() < dt * 6) s3.light(T.x, T.y, head, 0.8 * sz, S(R, 0.85), 0.35, 0.25);
      });
    }
    // the sigil crumbles: burning fragments of the ring fall and bounce
    s2.at(s2.t + (miss ? 0.62 : 1.2), (s3) => {
      const n = Math.round(22 * g * Math.sqrt(sz));
      for (let i = 0; i < n; i++) {
        const q = (i / n) * TAU, rr = i % 2 ? r : r * 0.76;
        s3.add({ k: i % 3 ? "ember" : "shard", x: T.x + Math.cos(q) * rr, y: T.y + Math.sin(q) * rr, z: 0.08, vx: s3.rand(-0.4, 0.4), vy: s3.rand(-0.4, 0.4), vz: s3.rand(0.6, 1.6), g: 4, drag: 1.5, bounce: 0.3, life: s3.rand(0.5, 0.9), seed: s3.R(), R, minor: i % 2 === 1 });
      }
      if (!miss) s3.light(T.x, T.y, 0.3, r * 2.4, S(R, 0.85), M.dark ? 0.5 : 0.8, 0.45);
    });
  }, { R: M.R, trail: "wisp", rate: 36 });
  s.phases.push("hex: a sigil is traced, an evil eye stamps, dark motes drain into it");
  s.period = end + 2;
}

/* ── fear ────────────────────────────────────────────────────────────── */

function fear(s, M, ctx) {
  const end = each(s, M, ctx, (s2, T, o) => {
    const g = GAIN[o], miss = o === "miss", crit = o === "crit", R = M.R, DR = deep(R), sz = T.size, [ux, uy] = awayFrom(ctx, T);
    const head = 1.2 * T.h, by = T.y - 0.12 * sz;
    if (miss) {
      // the dread closes in, and breaks on someone who does not flinch
      for (let k = 0; k < 2; k++) s2.add({ k: "miSpikes", x: T.x, y: T.y, r0: 1.6 * sz, r1: 0.5 * sz, n: 12, life: 0.4, R, seed: 11 + k, wait: k * 0.14, update: still });
      s2.at(s2.t + 0.45, (s3) => {
        s3.add({ k: "ring", x: T.x, y: T.y, r: 0.55 * sz, life: 0.4, R, seed: 2, update: still });
        for (let i = 0; i < 14; i++) { const q = (i / 14) * TAU; s3.add({ k: "mote", x: T.x + Math.cos(q) * 0.5 * sz, y: T.y + Math.sin(q) * 0.5 * sz, z: 0.4 * T.h, vx: Math.cos(q) * 1.8, vy: Math.sin(q) * 1.2, vz: s3.rand(0, 0.8), drag: 3, life: 0.5, R, minor: i % 2 === 1 }); }
        s3.light(T.x, T.y, 0.6, 1.2 * sz, S(R, 0.85), 0.5, 0.35);
      });
      s2.add({ k: "miGlyph", form: "bang", x: T.x, y: by, z: head, r: glyphR(T, o) * 0.8, life: 0.5, R, seed: 9, inT: 0.05, alpha: 0.85, jit: 0.5, from: 0.4, wait: 0.1, update: still });
      return;
    }
    // the recoil: shoved back from the caster, then a cowering shake
    s2.hit(T.id, 1.1 * g, { x: T.x - ux, y: T.y - uy }, R);
    for (let k = 0; k < 7; k++) s2.at(s2.t + 0.14 + k * 0.1, (s3) => s3.hit(T.id, 0.42 * g * (1 - k / 8), { x: T.x - uy * (k % 2 ? 1 : -1), y: T.y + ux * (k % 2 ? 1 : -1) }, R));
    if (crit) s2.crit(); else s2.shake = Math.max(s2.shake, 1.2);
    s2.add({ k: "flash", x: T.x, y: by, z: 0.6 * T.h, life: (crit ? 2 : 1) / 12, r: 0.38 * sz * s2.spec.aps * g, R, update: still });
    // jagged dread ripples racing out, one after another
    const n = crit ? 4 : 3;
    for (let k = 0; k < n; k++) s2.add({ k: "miSpikes", x: T.x, y: T.y, r0: 0.4 * sz, r1: (1.75 - k * 0.22) * sz * g, n: 13 + k, life: 0.6, R: k % 2 ? DR : R, seed: 21 + k * 5, wait: k * 0.17, update: still });
    s2.add({ k: "miDread", x: T.x, y: T.y, z: 0.55 * T.h, rin: 0.5 * sz, rout: 1.35 * sz * g, n: crit ? 16 : 11, life: 0.95, R, seed: 4, update: still });
    // the scream mark over the head, shivering
    const gr = glyphR(T, o);
    for (const [ox, w] of [[-0.18, 0.04], [0.18, 0.12]]) s2.add({ k: "miGlyph", form: "bang", x: T.x + ox * sz, y: by, z: head + 0.15, r: gr, life: 1.4, R, seed: 9 + w * 100, inT: 0.05, jit: 1.2, from: 0.75, hero: crit, wait: w,
      update(p) { p.rs = 1 + 0.35 * Math.exp(-p.age * 10); p.z = head + 0.15 + 0.06 * Math.exp(-p.age * 6); } });
    // sweat flying off
    for (let i = 0; i < (crit ? 8 : 5); i++) {
      const side = i % 2 ? 1 : -1;
      s2.add({ k: "icon", bm: ICONS.drop, x: T.x + side * 0.2 * sz, y: by, z: 0.95 * T.h, vx: side * s2.rand(0.9, 1.6), vy: s2.rand(-0.4, 0.4), vz: s2.rand(0.8, 1.6), g: 4.5, drag: 0.6, life: 0.7, R, snap: false, wait: 0.05 + i * 0.07, minor: i > 2 });
    }
    s2.add({ k: "darkpool", x: T.x, y: T.y, r: 0.7 * sz * g, life: 1.5, R, update: still });
    s2.light(T.x, T.y, 0.6, 1.8 * sz * g, S(R, 0.85), M.dark ? 0.5 : 0.8, 0.5);
    // the cower: a dark shiver round the feet
    s2.emit(s2.t + 0.1, s2.t + 1.1, (s3, _u, dt) => {
      for (let i = s3.count(18 * sz, dt); i > 0; i--) { const q = s3.rand(0, TAU); s3.add({ k: "wisp", s: 2, x: T.x + Math.cos(q) * 0.42 * sz, y: T.y + Math.sin(q) * 0.3 * sz, z: s3.rand(0, 0.4) * T.h, vx: Math.cos(q) * 0.6, vy: Math.sin(q) * 0.4, vz: 0.4, drag: 2, life: s3.rand(0.35, 0.6), R: DR, minor: true }); }
    });
  }, { trail: "streak", R: deep(M.R), rate: 30, arc: 0.2 });
  s.phases.push("fear: a recoil and a cowering shake, jagged dread ripples, a shivering ! over the head");
  s.period = end + 1.9;
}

/* ── charm: the mind-control split ───────────────────────────────────── */

const HEARTY = /charm|enthrall|beguil|captivat|fascinat|heart|love|adore|infatuat|seduc|allure|swoon/;

function charm(s, M, ctx) {
  const heart = HEARTY.test(String(s.spec.slug ?? ""));
  let end = ctx.t0;
  subjects(s, ctx).forEach((T, i) => {
    const o = outOf(s, T), g = GAIN[o], miss = o === "miss", crit = o === "crit", R = M.R, sz = T.size;
    const head = 1.18 * T.h, by = T.y - 0.12 * sz, at = ctx.t0 + i * 0.06;
    // the thread is the reach: it runs from the hand to the head
    const tether = !ctx.self && ctx.hand;
    const ext = tether ? Math.min(0.4, 0.18 + Math.hypot(T.x - ctx.hand[0], T.y - ctx.hand[1]) * 0.03) : 0;
    if (tether) s.at(at, (s2) => s2.add({ k: "miThread", a: ctx.hand, b: [T.x, by, head * 0.92], ext, sag: 3 + sz, life: miss ? 1.1 : 1.9, snap: miss ? ext + 0.45 : 0, thick: crit, R, update: still }));
    const land = at + ext;
    end = Math.max(end, land);
    s.at(land, (s2) => {
      const r = 1.05 * sz * g * (0.85 + 0.15 * s2.m), gr = glyphR(T, o) + (heart ? 1 : 3);
      s2.add({ k: "miSpiral", x: T.x, y: T.y, r, arms: 3, w: 2.2, life: miss ? 1.0 : 1.8, unwind: miss ? 0.45 : 0, R, update: still });
      s2.light(T.x, T.y, 0.6, r * 2, S(R, 0.85), 0.5, 0.4, { swell: true });
      s2.hit(T.id, miss ? 0.2 : 0.4 * g, ctx.caster && !ctx.self ? { x: ctx.caster.x, y: ctx.caster.y } : { x: T.x - 1, y: T.y }, R);
      // the glyph pops over the head and beats twice, throwing a ring each time
      const beats = miss ? [] : crit ? [0.2, 0.42, 0.75, 0.97] : [0.2, 0.42, 0.85];
      s2.add({ k: "miGlyph", form: heart ? "heart" : "eye", spiral: !heart, x: T.x, y: by, z: head + 0.1, r: gr, life: miss ? 0.85 : 1.6, R, seed: 2, inT: 0.05, from: 0.72, hero: crit,
        update(p) {
          const pop = Math.exp(-p.age * 9) * Math.sin(p.age * 20) * 0.35;
          let th = 0;
          for (const b of beats) th = Math.max(th, Math.exp(-(((p.age - b) / 0.06) ** 2)));
          p.rs = (p.age < 0.08 ? lerp(0.3, 1.2, p.age / 0.08) : 1 + pop) + 0.22 * th;
          if (miss) { p.crack = p.age > 0.35; p.z = head + 0.1 - Math.max(0, p.age - 0.4) * 0.8; }
        } });
      for (const b of beats) s2.at(s2.t + b, (s3) => {
        s3.add({ k: "ring", x: T.x, y: T.y, r: 0.8 * sz * g, life: 0.45, R, seed: 3, update: still });
        s3.light(T.x, by, head, 1.3 * sz, S(R, 0.85), 0.75, 0.3);
        for (let k = 0; k < 4; k++) s3.add({ k: "glint", x: T.x + s3.rand(-0.5, 0.5) * sz, y: by, z: head + s3.rand(-0.2, 0.4), life: 5 / 12, R, minor: k > 1, update: still });
      });
      if (crit) s2.at(s2.t + 0.2, (s3) => s3.crit());
      if (miss) {
        s2.at(s2.t + 0.45, (s3) => { sparks(s3, R, T.x, by, head + 0.1, 12, 3, 4); s3.light(T.x, by, head, 1, S(R, 0.85), 0.5, 0.25); });
        return;
      }
      // little hearts (or sparkles, for a command) float up round the head
      for (let k = 0; k < (crit ? 8 : 5); k++) {
        const side = k % 2 ? 1 : -1, x0 = T.x + side * s2.rand(0.2, 0.5) * sz, ph = s2.rand(0, TAU);
        s2.add({ k: heart ? "miGlyph" : "mote", form: "heart", plus: true, x: x0, y: by, z: s2.rand(0.6, 1) * T.h, r: s2.rand(2.5, 3.6), life: s2.rand(1, 1.4), R, seed: k, inT: 0.08, from: 0.6, wait: 0.15 + k * 0.12, minor: k > 2,
          update(p, _s, dt) { p.z += 0.45 * dt; p.x = x0 + Math.sin(ph + p.age * 4) * 0.08; } });
      }
    });
  });
  s.phases.push(`charm: a thread, spiral rings winding in, a beating ${heart ? "heart" : "hypnotic eye"}`);
  s.period = end + 2.1;
}

/* ── slow (and paralyze, petrify, entangle, web) ─────────────────────── */

function slow(s, M, ctx) {
  const end = each(s, M, ctx, (s2, T, o) => {
    const g = GAIN[o], miss = o === "miss", crit = o === "crit", R = M.R, GR = grey(R), sz = T.size, [ux, uy] = awayFrom(ctx, T);
    const r = 0.92 * sz * g * (0.85 + 0.15 * s2.m), life = crit ? 2.4 : miss ? 1.3 : 2.1;
    // each tick waits longer than the last: time is thickening
    const ticks = miss ? [0.12, 0.42] : crit ? [0.12, 0.38, 0.72, 1.15, 1.7] : [0.12, 0.4, 0.78, 1.3];
    const step = TAU / 12, free = miss ? 0.62 : Infinity;
    const dial = s2.add({ k: "miDial", x: T.x, y: T.y, r, life, inT: 0.1, R, seed: 7, ang: -Math.PI / 2, ang2: -Math.PI / 2,
      update(p) {
        let n = 0, since = 9;
        for (const t of ticks) if (p.age >= t) { n++; since = p.age - t; }
        const snap = since < 0.12 ? 1 + 0.25 * Math.sin((since / 0.12) * Math.PI) : 1;
        p.ang = -Math.PI / 2 + Math.max(0, n - 1 + (since < 0.12 ? easeOut(since / 0.12) : 1)) * step * 2.5 + (snap - 1) * 0.3;
        p.ang2 = -Math.PI / 2 + n * step * 0.5;
        p.flash = Math.exp(-since * 9);
        if (p.age > free) { p.ang += (p.age - free) ** 2 * 40; p.ang2 -= (p.age - free) * 12; p.broken = clamp((p.age - free - 0.2) / 0.4); }
      } });
    s2.add({ k: "miHands", x: T.x, y: T.y, dial, life, update: still });
    for (const t of ticks) s2.at(s2.t + t, (s3) => {
      s3.add({ k: "ring", x: T.x, y: T.y, r: r * 1.15, life: 0.45, R, seed: 9, update: still });
      s3.light(T.x, T.y, 0.3, r * 2, S(R, 0.85), 0.6, 0.3);
      if (!miss) s3.hit(T.id, 0.28 * g, { x: T.x - ux, y: T.y - uy }, R);
    });
    s2.light(T.x, T.y, 0.3, r * 2.2, S(R, 0.85), M.dark ? 0.35 : 0.5, 0.5, { swell: true });
    if (miss) {
      // the hand spins free and the dial breaks apart
      s2.at(s2.t + free + 0.25, (s3) => {
        for (let i = 0; i < 16; i++) { const q = (i / 16) * TAU; s3.add({ k: "shard", x: T.x + Math.cos(q) * r, y: T.y + Math.sin(q) * r, z: 0.08, vx: Math.cos(q) * 1.6, vy: Math.sin(q) * 1.6, vz: s3.rand(0.5, 1.4), g: 4, drag: 1.5, bounce: 0.3, life: s3.rand(0.4, 0.7), seed: s3.R(), R, minor: i % 2 === 1 }); }
        s3.light(T.x, T.y, 0.3, r * 2, S(R, 0.85), 0.6, 0.3);
      });
      return;
    }
    // the drag: afterimages lag behind the body, toward where it came from
    for (let k = 0; k < (crit ? 5 : 4); k++) {
      const d = (0.14 + k * 0.13) * sz;
      s2.add({ k: "miEcho", x: T.x - ux * d, y: T.y - uy * d, size: sz, h: T.h, a: 0.75 - k * 0.12, life: 1.2 + k * 0.15, R: GR, wait: 0.08 + k * 0.1, update: still });
    }
    // the grey-out
    s2.add({ k: "miVeil", x: T.x, y: T.y, size: sz, h: T.h, ka: crit ? 0.75 : 0.55, inT: 0.5, tone: 0.55, rim: 0.85, life: life - 0.1, R: GR, update: still });
    if (crit) s2.at(s2.t + ticks.at(-1), (s3) => { s3.crit(); s3.add({ k: "flash", x: T.x, y: T.y, z: 0.6 * T.h, life: 2 / 12, r: 0.7 * sz * s3.spec.aps, R, update: still }); });
    // sand sinks in slow motion round the body
    s2.emit(s2.t + 0.1, s2.t + life - 0.4, (s3, _u, dt) => {
      for (let i = s3.count(16 * sz, dt); i > 0; i--) s3.add({ k: "mote", x: T.x + s3.rand(-0.5, 0.5) * sz, y: T.y + s3.rand(-0.35, 0.35) * sz, z: s3.rand(0.8, 1.3) * T.h, vz: -0.32, life: s3.rand(0.9, 1.4), R, minor: i > 1 });
    });
  }, { trail: "mote", rate: 30, arc: 0.3 });
  s.phases.push("slow: a dial ticks ever slower, afterimages drag, the body greys out");
  s.period = end + 2.5;
}

/* ── sleep ───────────────────────────────────────────────────────────── */

function sleep(s, M, ctx) {
  const end = each(s, M, ctx, (s2, T, o) => {
    const g = GAIN[o], miss = o === "miss", crit = o === "crit", R = M.R, sz = T.size;
    const head = 1.15 * T.h, by = T.y - 0.12 * sz;
    // the lullaby: motes spiral lazily down onto the head
    for (let i = 0; i < 18; i++) {
      const q0 = (i / 18) * TAU * 2, d0 = (0.5 + (i % 3) * 0.12) * sz, life = 0.55 + (i % 4) * 0.06;
      s2.add({ k: "mote", plus: i % 3 === 0, x: T.x, y: by, z: head + 1, life, R, wait: (i / 18) * 0.25, minor: i % 2 === 1, update(p) {
        const f = clamp(p.age / p.life), q = q0 + f * 3, d = d0 * (1 - f * 0.85);
        p.x = T.x + Math.cos(q) * d; p.y = by + Math.sin(q) * d * 0.55; p.z = head + 1.1 * (1 - f);
      } });
    }
    s2.light(T.x, T.y, head, 1.4 * sz * g, S(R, 0.85), 0.45, 0.9, { swell: true });
    s2.add({ k: "ring", x: T.x, y: T.y, r: 0.85 * sz * g, life: 0.7, R, seed: 4, wait: 0.3, update: still });
    // the veil dims the body; on a miss it never settles
    const life = miss ? 0.9 : crit ? 2.4 : 2;
    s2.add({ k: "miVeil", x: T.x, y: T.y, size: sz, h: T.h, ka: 0.6 * Math.min(1.25, g), inT: miss ? 0.3 : 0.7, tone: 0.05, rim: 0.4, life, R, wait: 0.2, update(p) { p.ka = 0.6 * Math.min(1.25, g) * (1 + 0.15 * Math.sin(p.age * 3.2)); } });
    s2.add({ k: "darkpool", x: T.x, y: T.y, r: 0.9 * sz * g, life: life + 0.3, R, wait: 0.2, update: still });
    s2.at(s2.t + 0.3, (s3) => s3.hit(T.id, 0.3, { x: T.x, y: T.y - 1 }, R));
    // Zs drift up off the head one after another, growing and swaying
    const nz = miss ? 1 : crit ? 6 : 4, zr = glyphR(T, o);
    for (let k = 0; k < nz; k++) {
      const x0 = T.x + 0.1 * sz, ph = k * 1.3, big = k % 2 === 1;
      s2.add({ k: "miGlyph", form: "zed", x: x0, y: by, z: head, r: zr * (big ? 1 : 0.78), life: miss ? 0.55 : 1.6, R, seed: k, inT: 0.1, from: 0.6, hero: crit && k === 0, wait: 0.35 + k * 0.32, minor: k > 3,
        update(p, _s, dt) { p.z += 0.5 * dt; p.x = x0 + p.age * 0.3 * sz + Math.sin(ph + p.age * 3) * 0.08; p.rs = 0.65 + 0.5 * clamp(p.age / 1.1); } });
    }
    if (miss) {
      // they start awake: the Z pops and a mark of surprise snaps up
      s2.at(s2.t + 0.85, (s3) => { sparks(s3, R, T.x + 0.15 * sz, by, head + 0.3, 10, 2.5, 4); s3.hit(T.id, 0.5, { x: T.x, y: T.y + 1 }, R); });
      s2.add({ k: "miGlyph", form: "bang", x: T.x - 0.1 * sz, y: by, z: head + 0.15, r: glyphR(T, o) * 0.8, life: 0.6, R, seed: 5, inT: 0.04, jit: 0.6, wait: 0.85, update: still });
      return;
    }
    // dream motes drift round the sleeper while it holds
    s2.emit(s2.t + 0.5, s2.t + life, (s3, _u, dt) => {
      for (let i = s3.count(7 * sz, dt); i > 0; i--) s3.add({ k: i % 2 ? "glint" : "mote", x: T.x + s3.rand(-0.55, 0.55) * sz, y: by + s3.rand(-0.3, 0.3) * sz, z: s3.rand(0.4, 1.3) * T.h, vz: 0.15, life: i % 2 ? 5 / 12 : 1, R, minor: true, update: i % 2 ? still : undefined });
    });
    if (crit) s2.at(s2.t + 0.35, (s3) => { s3.add({ k: "flash", x: T.x, y: by, z: head, life: 2 / 12, r: 0.6 * sz * s3.spec.aps, R, update: still }); s3.freeze = 2 / 12; });
  }, { trail: "mote", rate: 26, arc: 0.6 });
  s.phases.push("sleep: lullaby motes, a soft dimming veil, Zs drift up");
  s.period = end + 2.8;
}

/* ── blind ───────────────────────────────────────────────────────────── */

function blind(s, M, ctx) {
  const end = each(s, M, ctx, (s2, T, o) => {
    const g = GAIN[o], miss = o === "miss", crit = o === "crit", R = M.R, sz = T.size;
    const eyes = 0.9 * T.h, by = T.y - 0.1 * sz, aps = s2.spec.aps;
    // the glare
    s2.add({ k: "miRays", x: T.x, y: by, z: eyes, L: 1.25 * sz * g, n: crit ? 16 : 12, rot: 0.2, life: 0.65, R, hero: crit, seed: 3, update: still });
    s2.add({ k: "flash", x: T.x, y: by, z: eyes, life: (crit ? 2 : 1) / 12, r: 0.42 * sz * aps * g, R, update: still });
    s2.add({ k: "star", x: T.x, y: by, z: eyes, L: Math.round(10 * Math.sqrt(sz) * g), life: 3 / 12, R, update: still });
    s2.add({ k: "ring", x: T.x, y: T.y, r: 1.3 * sz * g, life: 0.45, R, seed: 2, update: still });
    s2.light(T.x, T.y, eyes, 3.2 * sz * g, S(R, 1), 1, 0.55);
    s2.light(T.x, T.y, eyes, 1.2 * sz, S(R, 1), 1, 0.18);
    sparks(s2, R, T.x, by, eyes, crit ? 26 : 16, 4.5, 8);
    s2.hit(T.id, (miss ? 0.4 : 0.8) * g, ctx.caster && !ctx.self ? { x: ctx.caster.x, y: ctx.caster.y } : { x: T.x - 1, y: T.y }, R);
    if (crit) s2.crit();
    // then the dark band wraps across the eyes
    const DR = deep(R);
    // dark smoke curls off the band (added first, so the band draws over it)
    for (let i = 0; i < (miss ? 2 : 4); i++) s2.add({ k: "smoke", x: T.x + (i - 1.5) * 0.2 * sz, y: by, z: eyes + 0.15, vx: (i - 1.5) * 0.3, vz: 0.35, drag: 2.2, r: s2.rand(2.5, 3.5) * Math.sqrt(sz), life: s2.rand(0.5, 0.75), lobes: [[0, 0, 1], [0.5, 0.2, 0.7], [-0.4, 0.3, 0.6]], R: DR, tone: 0.45, wait: 0.34 + i * 0.05, minor: i > 1 });
    s2.add({ k: "miBand", x: T.x, y: T.y, size: sz, h: T.h, th: Math.max(5, Math.round(4.4 * Math.sqrt(sz) * (crit ? 1.3 : 1))), life: miss ? 0.95 : 1.8, tear: miss ? 0.4 : 0, R: DR, wait: 0.28, update: still });
    if (miss) {
      s2.at(s2.t + 0.7, (s3) => {
        for (let i = 0; i < 12; i++) s3.add({ k: "mote", x: T.x + s3.rand(-0.4, 0.4) * sz, y: by, z: eyes, vx: s3.rand(-1.4, 1.4), vz: s3.rand(-0.2, 0.8), drag: 2.5, life: 0.5, R, minor: i % 2 === 1 });
        s3.light(T.x, by, eyes, 0.9, S(R, 0.85), 0.5, 0.25);
      });
      return;
    }
    // glitter falls round the blinded creature
    s2.emit(s2.t + 0.2, s2.t + 1.4, (s3, _u, dt) => {
      for (let i = s3.count(22 * sz, dt); i > 0; i--) s3.add({ k: i % 3 ? "mote" : "glint", x: T.x + s3.rand(-0.6, 0.6) * sz, y: by + s3.rand(-0.35, 0.35) * sz, z: s3.rand(0.6, 1.3) * T.h, vz: -0.6, life: i % 3 ? 0.8 : 5 / 12, R, minor: i > 1, update: i % 3 ? undefined : still });
    });
  }, { trail: "glint", rate: 18, arc: 0.3 });
  s.phases.push("blind: a glaring sunburst, then a dark band across the eyes");
  s.period = end + 2.1;
}

/* ── vanish (Invisibility): self or a target ─────────────────────────── */

function vanish(s, M, ctx) {
  const end = each(s, M, ctx, (s2, T, o) => {
    const g = GAIN[o], miss = o === "miss", crit = o === "crit", R = M.R, sz = T.size, rad = 0.4 * sz;
    s2.add({ k: "miShimmer", x: T.x, y: T.y, size: sz, h: T.h, life: 0.55, R, seed: 5, update: still });
    s2.light(T.x, T.y, 0.6, 1.4 * sz, S(R, 0.85), 0.55, 0.9, { swell: true });
    // the dissolve: a seam climbs the body, and the body breaks into blocks of light above it
    const t1 = 0.18, t2 = 0.85;
    s2.emit(s2.t + t1, s2.t + t2, (s3, u, dt) => {
      const z = u * T.h;
      for (let i = s3.count(150 * sz * g, dt); i > 0; i--) {
        const q = s3.rand(0, TAU), d = Math.sqrt(s3.R()) * rad, big = s3.R() < 0.35, sp = s3.rand(0.5, 2.8) * Math.sqrt(sz) * g;
        s3.add({ k: "miBit", s: big ? 3 : s3.R() < 0.5 ? 2 : 1, x: T.x + Math.cos(q) * d, y: T.y + Math.sin(q) * d * 0.7, z, vx: Math.cos(q) * sp, vy: Math.sin(q) * sp * 0.7, vz: s3.rand(0.4, 1.6), drag: 1.6, life: s3.rand(0.5, 1), R, minor: !big && i > 1,
          update: miss ? (p, s4, dt2) => { if (p.age > 0.25) { p.x += (T.x - p.x) * dt2 * 6; p.y += (T.y - p.y) * dt2 * 6; p.z += (0.5 * T.h - p.z) * dt2 * 6; } else { p.x += p.vx * dt2; p.y += p.vy * dt2; p.z += p.vz * dt2; } } : undefined });
      }
      // the seam itself: a bright band at its height
      for (let i = s3.count(60 * sz, dt); i > 0; i--) { const q = s3.rand(0, TAU); s3.add({ k: "ember", x: T.x + Math.cos(q) * rad, y: T.y + Math.sin(q) * rad * 0.6, z, life: 0.2, seed: s3.R(), R, minor: i > 1, update: still }); }
    });
    s2.at(s2.t + t2, (s3) => {
      s3.add({ k: "flash", x: T.x, y: T.y, z: 0.6 * T.h, life: (crit ? 2 : 1) / 12, r: 0.55 * sz * s3.spec.aps * g, R, update: still });
      s3.add({ k: "ring", x: T.x, y: T.y, r: 0.85 * sz * g, life: 0.5, R, seed: 4, update: still });
      s3.add({ k: "ring", x: T.x, y: T.y, r: 1.5 * sz * g, life: 0.75, R, broken: true, seed: 8, update: still });
      for (let k = 0; k < 8; k++) { const q = (k / 8) * TAU + 0.3; s3.add({ k: "star", x: T.x + Math.cos(q) * 0.75 * sz * g, y: T.y + Math.sin(q) * 0.6 * sz * g, z: s3.rand(0.2, 1) * T.h, L: 3 + (k % 2) * 2, life: 3 / 12, R, wait: k * 0.04, minor: k % 2 === 1, update: still }); }
      s3.light(T.x, T.y, 0.6, 1.8 * sz * g, S(R, 0.85), 0.8, 0.5);
      if (crit) s3.freeze = 2 / 12;
      if (miss) { s3.hit(T.id, 0.5, { x: T.x, y: T.y - 1 }, R); sparks(s3, R, T.x, T.y, 0.6 * T.h, 12, 3, 4); }
    });
    // what is left: an outline that bends the light
    s2.add({ k: "miRefract", x: T.x, y: T.y, size: sz, h: T.h, life: miss ? 0.5 : crit ? 2.1 : 1.7, flick: miss, R, seed: 6, wait: miss ? t2 - 0.1 : t2 - 0.25, update: still });
    if (!miss) for (let i = 0; i < 10; i++) {
      const q = (i / 10) * TAU;
      s2.add({ k: "glint", x: T.x + Math.cos(q) * 0.47 * sz, y: T.y + Math.sin(q) * 0.47 * sz, z: s2.rand(0.1, 0.9) * T.h, life: 5 / 12, R, wait: t2 + s2.rand(0, 1.2), minor: i % 2 === 1, update: still });
    }
  }, { trail: "glint", rate: 16 });
  s.phases.push("vanish: a shimmer, a pixel dissolve, a refracting outline");
  s.period = end + 2.4;
}

export default { hex, fear, charm, slow, sleep, blind, vanish };
