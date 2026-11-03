/**
 * Spellsprite — Strikes, one timeline per weapon style.
 *
 * A style is `(s, M, ctx) => void` with ctx:
 *   caster, targets       bodies ({x, y, size, h, id, outcome})
 *   outcome(T)            "crit" | "hit" | "miss" | "neutral"
 *   release(s, M, x, y, z, pow, rad)   the family's burst plus shake
 *   linger, fire, handOf, POW          compile.mjs helpers
 *
 * `M` is the weapon's material: kinetic for plain steel, the rune's or the
 * look's for anything else. A plain hit releases a small kinetic star; an
 * elemental weapon releases its family's burst at Strike scale.
 *
 * The three outcomes have to read apart at a glance, on a token 26 px wide:
 *   hit    one stroke on the body, one release, a flinch
 *   crit   the same stroke, a one-frame hitstop on contact, then a second,
 *          bigger stroke across the first, a two-frame hitstop, a star and a
 *          fan of speed lines thrown out along the blow, and a heavier release
 *   miss   the stroke cuts the air BESIDE and past the body (never on it, and
 *          never on whoever stands next to it), speed lines carry on through,
 *          a scuff of dust where it ends; no flash, no flinch
 */

import { clamp } from "./core/rand.mjs";
import { RAMP, S, WHITE } from "./core/palette.mjs";
import { lobes, still } from "./core/motifs.mjs";
import physical from "./families/physical.mjs";

const DUST = { id: "kinetic", material: "kinetic", family: "physical", mod: physical, R: RAMP.kinetic, dark: false };
const norm = (x, y) => { const l = Math.hypot(x, y) || 1; return [x / l, y / l]; };

/**
 * Where a blow is aimed: on the body, or for a miss over the shoulder and on
 * past it. A sideways miss is depth on a billboard view and lands right on the
 * figure; height reads as "over" in both views, and the overshoot carries it
 * clear of the token's disc from above. `z(k)` is the height for a style
 * whose hit lands at k × the body's height.
 */
function aimOf(ctx, T) {
  const from = ctx.caster ? { x: ctx.caster.x, y: ctx.caster.y, h: ctx.caster.h } : { x: T.x - 1, y: T.y, h: 1 };
  const [ux, uy] = norm(T.x - from.x, T.y - from.y);
  let px = -uy, py = ux;
  if (py < 0 || (py === 0 && px < 0)) { px = -px; py = -py; }
  const miss = ctx.outcome(T) === "miss", sz = Math.sqrt(T.size ?? 1), side = 0.22 * sz, past = 0.5 * sz;
  return {
    from, ux, uy, px, py, miss,
    x: miss ? T.x + px * side + ux * past : T.x, y: miss ? T.y + py * side + uy * past : T.y,
    z: (k) => (miss ? 1.15 : k) * T.h,
  };
}

/** A hitstop: the whole effect holds still for `t` seconds (the sim skips its steps). */
function hitstop(s, t) { s.freeze = Math.max(s.freeze, t); s.impact = Math.max(s.impact, t); }

/** Speed lines that carry a whiff on past the target. */
function whoosh(s, M, A, T, at) {
  s.at(at, (s2) => {
    for (let k = 0; k < 4; k++) {
      const o = (k - 1.5) * 0.11, sp = s2.rand(7, 9);
      s2.add({ k: "streak", x: A.x - A.ux * 0.9 + A.px * o, y: A.y - A.uy * 0.9 + A.py * o, z: (1.0 + k * 0.08) * T.h, vx: A.ux * sp, vy: A.uy * sp, vz: 0, life: 0.14 + k * 0.02, R: M.R, minor: k > 1, wait: k * 0.015 });
    }
  });
}

/** The crit's second impact: a star, a fan of speed lines thrown out along the blow, a ring. */
function critImpact(s, M, A, T) {
  const z = 0.6 * T.h, x = T.x - 0.05, y = T.y, base = Math.atan2(A.uy, A.ux);
  s.add({ k: "star", x, y, z, L: 9 * Math.min(1.4, s.m) * Math.sqrt(T.size ?? 1), life: 3 / 12, R: M.R, update: still });
  for (let i = 0; i < 7; i++) {
    const q = base + (i - 3) * 0.34 + s.rand(-0.06, 0.06), sp = s.rand(8, 11);
    s.add({ k: "streak", x, y, z, vx: Math.cos(q) * sp, vy: Math.sin(q) * sp, vz: s.rand(-1.5, 2.5), life: s.rand(0.14, 0.2), R: M.R, minor: i % 2 === 1 });
  }
  s.add({ k: "ring", x: T.x, y: T.y, r: 0.75 * (T.size ?? 1), life: 0.4, R: M.R, broken: true, seed: 5, update: still });
}

/**
 * How much a blow weighs: 1 for a one-handed weapon, more for a two-handed one
 * (`weapon.heavy`) and for a powered swing (`weapon.power`, Vicious Swing).
 * Weight buys anticipation, a bigger smear, a held contact and debris, never
 * a second hit: a powered swing that misses is still a miss.
 */
export const weightOf = (spec) => 1 + (spec?.weapon?.heavy ? 0.35 : 0) + (spec?.weapon?.power ? 0.3 : 0);

/**
 * A heavy contact: the frame holds (no veil, that is a crit's), a hairline cut
 * through the body splits outward, grit and chips are thrown along the blow.
 */
function heavyContact(s, A, T, W) {
  s.freeze = Math.max(s.freeze, W > 1.5 ? 2 / 12 : 1 / 12);
  s.shake = Math.max(s.shake, 0.6 + W);
  const base = Math.atan2(A.uy, A.ux);
  // the cut runs across the blow, leaning with it: a diagonal through the body
  const q = base + Math.PI / 2 - 0.55;
  s.add({ k: "cut", x: T.x, y: T.y, z: 0.62 * T.h, ux: Math.cos(q), uy: Math.sin(q), len: (1.1 + 0.9 * (W - 1)) * Math.sqrt(T.size ?? 1), life: 6 / 12, R: RAMP.kinetic, wait: 1 / 12, update: still });
  for (let i = 0; i < Math.round(4 + 6 * (W - 1)); i++) {
    const a = base + s.rand(-0.7, 0.7), sp = s.rand(2.5, 5);
    s.add({ k: "chunk", x: T.x + A.ux * 0.15, y: T.y + A.uy * 0.15, z: 0.4 * T.h, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vz: s.rand(1.5, 3.5), g: 9, drag: 0.8, bounce: 0.35, life: s.rand(1.6, 2.6), R: RAMP.kinetic, s: 2, wide: s.R() < 0.3, debris: true });
  }
  s.add({ k: "ring", x: T.x, y: T.y, r: 0.6 * (T.size ?? 1) * W, life: 0.45, R: RAMP.kinetic, broken: true, seed: 17, update: still });
  for (let i = 0; i < 3; i++) s.add({ k: "smoke", x: T.x + A.ux * 0.3 + s.rand(-0.25, 0.25), y: T.y + A.uy * 0.3 + s.rand(-0.2, 0.2), z: 0.1, vx: A.ux * s.rand(0.6, 1.2), vy: A.uy * s.rand(0.6, 1.2), vz: 0.2, g: -0.05, drag: 1.8, r: s.rand(2.5, 4), life: s.rand(0.7, 1.1), lobes: lobes(s), tone: 0.5, minor: i > 0 });
}

/** Weight's wind-up: the caster plants (a scuff of dust at the feet) and the blade draws back. */
function windUp(s, M, caster, A, T, at, W) {
  if (!caster || W <= 1) return;
  s.at(Math.max(0, at - 0.24), (s2) => {
    for (let i = 0; i < 2; i++) s2.add({ k: "smoke", x: caster.x - A.ux * 0.25 + s2.rand(-0.15, 0.15), y: caster.y - A.uy * 0.25 + 0.2, z: 0.05, vx: -A.ux * 0.6, vy: -A.uy * 0.6, vz: 0.15, drag: 2, r: s2.rand(1.6, 2.4), life: 0.55, lobes: lobes(s2), tone: 0.5, minor: i > 0 });
    // the backswing: a thin dim arc on the far side, drawn the other way
    const [bx, by] = across(A, T, 180);
    s2.add({ k: "crescent", x: caster.x - A.ux * 0.1, y: caster.y - A.uy * 0.1, z: 1.1 * caster.h, from: [bx, by, 1.2], life: 3 / 12, R: M.R, flip: -1, span: 1.4, R2: 8 * W, T: 1.5, dim: true, update: still });
  });
}

/** The shared tail of every melee style: impact, crit second stroke, linger, or the whiff. */
function meleeLand(s, M, ctx, T, at, stroke) {
  const o = ctx.outcome(T), A = aimOf(ctx, T), W = weightOf(s.spec);
  if (o === "miss") {
    whoosh(s, M, A, T, at + 0.03);
    s.at(at + 0.1, (s2) => ctx.release(s2, DUST, A.x + A.ux * 0.3, A.y + A.uy * 0.3, 0.05, 0.3 * W, 0.18 * W));
    s.phases.push("whiff");
    return;
  }
  s.at(at + 0.06, (s2) => {
    // a crit's first contact is hit-sized: the hitstop marks it, and a bigger cloud would bury the second stroke
    ctx.release(s2, M, T.x - 0.1, T.y, 0.6 * T.h, 0.75 * Math.min(1.3, W), 0.32);
    s2.hit(T.id, Math.min(1.5, W), A.from, M.R);
    if (W > 1) heavyContact(s2, A, T, W);
    if (o === "crit") hitstop(s2, 1 / 12);
  });
  if (W > 1) s.phases.push("held contact", "cut", "debris");
  if (o === "crit") {
    s.at(at + 0.2, (s2) => stroke(s2, -1, true));
    s.at(at + 0.28, (s2) => { ctx.release(s2, M, T.x - 0.1, T.y, 0.6 * T.h, 1.6, 0.4); critImpact(s2, M, A, T); s2.hit(T.id, 1.6, A.from, M.R); });
    s.phases.push("hitstop", "second stroke", "impact frames");
  }
  if (M.id !== "kinetic") ctx.linger(s, M, T.x, T.y, 0.35, at + 0.15, at + 1.3);
}

function glint(s, M, caster, at = 0.02) {
  if (!caster) return;
  s.at(at, (s2) => s2.add({ k: "glint", x: caster.x + 0.28, y: caster.y - 0.12, z: 1.15 * caster.h, life: 5 / 12, R: M.R, big: true, update: still }));
}

/** A point turned about the target, so a second stroke comes in across the first. */
const across = (A, T, deg) => {
  const q = (deg * Math.PI) / 180, dx = A.from.x - T.x, dy = A.from.y - T.y;
  return [T.x + dx * Math.cos(q) - dy * Math.sin(q), T.y + dx * Math.sin(q) + dy * Math.cos(q)];
};

function slash(s, M, ctx) {
  const { caster } = ctx, W = weightOf(s.spec);
  glint(s, M, caster);
  ctx.targets.forEach((T, i) => {
    const at = (W > 1 ? 0.44 : 0.3) + i * 0.2, A = aimOf(ctx, T);
    const stroke = (s2, flip, big) => {
      const [fx, fy] = big ? across(A, T, 70) : [A.from.x, A.from.y], g = (big ? 1.6 : 1) * W;
      const R2 = 12 * g * Math.min(1.4, s2.m) * Math.sqrt(T.size), Tk = 4 * (big ? 1.5 : 1) * W * Math.min(1.5, s2.m);
      s2.add({ k: "crescent", x: A.x - 0.05, y: A.y, z: A.z(0.55), from: [fx, fy, big ? 1.1 : 0.6], life: 6 / 12, R: M.R, flip, R2, T: Tk, edge: W > 1, update: still });
      // a heavy blade leaves a smear: a dimmer echo of the arc, a frame behind and inside it
      if (W > 1) s2.add({ k: "crescent", x: A.x - 0.05, y: A.y, z: A.z(0.55), from: [fx, fy, big ? 1.1 : 0.6], life: 5 / 12, R: M.R, flip, R2: R2 * 0.8, T: Tk * 0.7, dim: true, wait: 1 / 12, update: still });
    };
    windUp(s, M, caster, A, T, at, W);
    s.at(at, (s2) => stroke(s2, 1));
    meleeLand(s, M, ctx, T, at, stroke);
  });
  s.phases.push("wind-up glint", W > 1 ? "heavy slash" : "slash");
  s.period = 2.4 + (W > 1 ? 0.6 : 0);
}

/** Pierce: a thrust. A hard white line that extends in two frames and snaps back. */
function pierce(s, M, ctx) {
  const { caster } = ctx, W = weightOf(s.spec);
  glint(s, M, caster);
  ctx.targets.forEach((T, i) => {
    const at = (W > 1 ? 0.4 : 0.28) + i * 0.2, A = aimOf(ctx, T);
    windUp(s, M, caster, A, T, at, W);
    const stroke = (s2, _flip, big) => {
      // a miss runs on past the body; a crit's second thrust drives through it
      const on = A.miss ? 0.45 : big ? 0.35 : 0;
      s2.add({ k: "thrust", x: A.x + A.ux * on, y: A.y + A.uy * on, z: A.z(0.6), ux: A.ux, uy: A.uy, len: (0.9 + 0.2 * T.size) * (big ? 1.45 : 1) * W, life: 5 / 12, R: M.R, update: still });
    };
    s.at(at, (s2) => stroke(s2, 1));
    meleeLand(s, M, ctx, T, at, stroke);
  });
  s.phases.push("thrust");
  s.period = 2.3;
}

/** Bludgeon: a heavy downward arc, a ground ring and grit on hit. */
function bludgeon(s, M, ctx) {
  const { caster } = ctx, W = weightOf(s.spec);
  glint(s, M, caster, 0.05);
  ctx.targets.forEach((T, i) => {
    const at = (W > 1 ? 0.46 : 0.36) + i * 0.22, A = aimOf(ctx, T);
    windUp(s, M, caster, A, T, at, W);
    const stroke = (s2, flip, big) => {
      const [fx, fy] = big ? across(A, T, -40) : [A.x, A.y], g = (big ? 1.5 : 1) * W;
      s2.add({ k: "crescent", x: A.x, y: A.y, z: A.z(0.7), from: [fx, fy, big ? 2.4 : 2], life: 5 / 12, R: M.R, flip, span: 1.6, R2: 10 * g * Math.min(1.4, s2.m) * Math.sqrt(T.size), T: 6 * g * Math.min(1.5, s2.m), update: still });
    };
    s.at(at, (s2) => stroke(s2, 1));
    if (!A.miss) s.at(at + 0.06, (s2) => {
      s2.add({ k: "ring", x: T.x, y: T.y, r: 0.55 * T.size, life: 0.45, R: RAMP.kinetic, broken: true, seed: 11, update: still });
      s2.shake = Math.max(s2.shake, 1.2);
    });
    meleeLand(s, M, ctx, T, at, stroke);
  });
  s.phases.push("heavy swing");
  s.period = 2.5;
}

/** Claw: three parallel rakes in two frames. */
function claw(s, M, ctx) {
  ctx.targets.forEach((T, i) => {
    const at = 0.22 + i * 0.2, A = aimOf(ctx, T);
    const stroke = (s2, flip, big) => { for (let k = 0; k < 3; k++) s2.add({ k: "rake", x: A.x + (k - 1) * (big ? 0.2 : 0.13), y: A.y, z: A.z(0.6), flip, len: 0.55 * Math.sqrt(T.size) * (big ? 1.55 : 1), life: 5 / 12, R: M.R, wait: k * 0.02, update: still }); };
    s.at(at, (s2) => stroke(s2, 1));
    meleeLand(s, M, ctx, T, at, stroke);
  });
  s.phases.push("rake");
  s.period = 2.2;
}

/** Bite: two crescents closing like jaws. */
function bite(s, M, ctx) {
  ctx.targets.forEach((T, i) => {
    const at = 0.25 + i * 0.2, A = aimOf(ctx, T);
    const stroke = (s2, _flip, big) => {
      const g = big ? 1.5 : 1, y = A.y, z = A.z(0.6), R2 = 9 * g * Math.sqrt(T.size), Tk = big ? 4 : 3;
      s2.add({ k: "crescent", x: A.x, y: y - 0.2 * g, z, from: [A.x, y - 2, 0.6], life: 5 / 12, R: M.R, flip: 1, span: 1.9, R2, T: Tk, update: still });
      s2.add({ k: "crescent", x: A.x, y: y + 0.2 * g, z, from: [A.x, y + 2, 0.6], life: 5 / 12, R: M.R, flip: -1, span: 1.9, R2, T: Tk, update: still });
    };
    s.at(at, (s2) => stroke(s2));
    meleeLand(s, M, ctx, T, at, stroke);
  });
  s.phases.push("jaws");
  s.period = 2.2;
}

/** Ranged: an arrow or bolt. A thin streak with a bright head; a crit drives through and out. */
function ranged(s, M, ctx, { arc = 0.15, spin = false } = {}) {
  const { caster } = ctx;
  ctx.targets.forEach((T, i) => {
    const o = ctx.outcome(T), t0 = 0.18 + i * 0.16;
    const from = caster ? [caster.x + 0.3, caster.y, 0.85 * caster.h] : [T.x - 3, T.y, 1];
    const [ux, uy] = norm(T.x - from[0], T.y - from[1]);
    const end = o === "miss" ? [T.x + ux * 1.5 - uy * 0.9, T.y + uy * 1.5 + ux * 0.9, 0.2] : [T.x - ux * 0.15, T.y - uy * 0.15, 0.6 * T.h];
    const dist = Math.hypot(end[0] - from[0], end[1] - from[1]), dur = clamp(0.12 + dist * 0.025, 0.15, 0.5);
    s.at(t0, (s2) => s2.add({
      k: spin ? "spinner" : "arrow", x: from[0], y: from[1], z: from[2], life: dur, R: M.R, ux, uy, spin,
      update(p, s3) {
        const u = clamp(p.age / dur);
        p.x = from[0] + (end[0] - from[0]) * u; p.y = from[1] + (end[1] - from[1]) * u; p.z = from[2] + (end[2] - from[2]) * u + Math.sin(Math.PI * u) * arc * dist * 0.1;
        if (M.id !== "kinetic") M.mod.trail?.(s3, M, { x: p.x, y: p.y, z: p.z, dt: 1 / 120 * 0.5 });
      },
    }));
    s.at(t0 + dur, (s2) => {
      if (o === "miss") { ctx.release(s2, DUST, end[0], end[1], 0.05, 0.3, 0.15); s2.add({ k: "arrow", x: end[0], y: end[1], z: 0.05, ux, uy, stuck: true, life: 2.5, R: M.R, debris: true, update: still }); return; }
      ctx.release(s2, M, T.x, T.y, 0.6 * T.h, o === "crit" ? 1.6 : 0.7, 0.3);
      s2.hit(T.id, o === "crit" ? 1.6 : 1, { x: from[0], y: from[1] }, M.R);
      if (o !== "crit") return;
      const A = { ux, uy };
      critImpact(s2, M, A, T);
      // driven through: the shaft comes out the far side and buries itself behind
      const out = [T.x + ux * 1.3, T.y + uy * 1.3, 0.1], z0 = 0.6 * T.h;
      s2.add({
        k: spin ? "spinner" : "arrow", x: T.x, y: T.y, z: z0, life: 0.12, R: M.R, ux, uy, spin, wait: 2 / 12,
        update(p) { const u = clamp(p.age / 0.12); p.x = T.x + (out[0] - T.x) * u; p.y = T.y + (out[1] - T.y) * u; p.z = z0 + (out[2] - z0) * u; },
      });
      s2.add({ k: "arrow", x: out[0], y: out[1], z: 0.05, ux, uy, stuck: true, life: 2.2, R: M.R, wait: 2 / 12 + 0.12, debris: true, update: still });
    });
  });
  s.phases.push(spin ? "throw" : "shot", "impact");
  s.period = 2.2;
}

export const STRIKES = Object.freeze({
  slash,
  pierce,
  bludgeon,
  claw,
  bite,
  unarmed: bludgeon,
  ranged: (s, M, ctx) => ranged(s, M, ctx),
  thrown: (s, M, ctx) => ranged(s, M, ctx, { arc: 0.6, spin: true }),
});

/* ── the shapes only Strikes draw ─────────────────────────────────────── */

import { registerShapes } from "./core/shapes.mjs";

registerShapes({
  /** A heavy blow's cut: a hairline across the body that lands whole, then splits outward from its middle. */
  cut(v, P, p) {
    const fr = Math.floor(p.age * 12); if (fr > 5) return;
    const half = p.len / 2, gap = [0, 0.08, 0.22, 0.4, 0.6, 0.8][fr], reach = [1, 1.08, 1.12, 1.1, 1, 0.9][fr];
    for (const side of [-1, 1]) {
      const a0 = side * half * gap, a1 = side * half * reach;
      const [x0, y0] = v.ap(p.x + p.ux * a0, p.y + p.uy * a0, p.z), [x1, y1] = v.ap(p.x + p.ux * a1, p.y + p.uy * a1, p.z);
      P.line(x0, y0, x1, y1, null, 1, 1, (f) => (fr === 0 ? WHITE : f < 0.5 ? (fr < 3 ? WHITE : S(p.R, 0.85)) : S(p.R, fr < 3 ? 0.9 : 0.6)));
      if (fr < 2) P.line(x0, y0 + 1, x1, y1 + 1, null, 1, 1, (f) => (f < 0.7 ? S(p.R, 0.55) : null));
    }
  },
  thrust(v, P, p) {
    const fr = Math.floor(p.age * 12); if (fr > 4) return;
    const ext = [0.5, 1, 1, 0.6, 0.25][fr], [tx, ty] = v.ap(p.x, p.y, p.z);
    const [bx, by] = v.ap(p.x - p.ux * p.len * ext, p.y - p.uy * p.len * ext, p.z);
    P.line(bx, by, tx, ty, null, 1, 1, (f) => (f > 0.8 ? [255, 255, 255] : S(p.R, 0.7 + f * 0.25)));
    P.line(bx, by + 1, tx, ty + 1, null, 1, 1, (f) => (f > 0.3 ? S(p.R, 0.5) : null));
  },
  rake(v, P, p) {
    const fr = Math.floor(p.age * 12); if (fr > 4) return;
    const [cx, cy] = v.ap(p.x, p.y, p.z), L = p.len * v.aps, show = Math.min(1, (fr + 1) / 2), gone = fr >= 3 ? (fr - 2) / 3 : 0;
    const x0 = cx - L * 0.4 * p.flip, y0 = cy - L * 0.5, x1 = cx + L * 0.4 * p.flip, y1 = cy + L * 0.5;
    P.line(x0, y0, x0 + (x1 - x0) * show, y0 + (y1 - y0) * show, null, 1, 1, (f) => (f < gone ? null : f > 0.5 ? S(p.R, 1) : S(p.R, 0.75)));
  },
  arrow(v, P, p) {
    const [hx, hy] = v.ap(p.x, p.y, p.z), [tx, ty] = v.ap(p.x - p.ux * 0.4, p.y - p.uy * 0.4, p.z);
    P.line(tx, ty, hx, hy, null, 1, 1, (f) => (f > 0.85 ? S(p.R, 1) : f < 0.15 ? S(p.R, 0.8) : S(RAMP.wood, 0.55)));
  },
  spinner(v, P, p) {
    const fr = Math.floor(p.age * 24) % 4, [x, y] = v.ap(p.x, p.y, p.z), c = S(p.R, 0.95), c2 = S(p.R, 0.6);
    const arms = [[[-2, 0], [2, 0]], [[-2, -2], [2, 2]], [[0, -2], [0, 2]], [[-2, 2], [2, -2]]][fr];
    P.line(x + arms[0][0], y + arms[0][1], x + arms[1][0], y + arms[1][1], c, 1);
    P.px(x, y, c2, 1);
  },
});
