/**
 * Spellsprite — Strikes, one timeline per delivery (docs/SPELLSPRITE_LOOK.md).
 *
 * `STRIKES[delivery](s, M, ctx)` for every melee and natural delivery
 * (constants.mjs DELIVERY_GROUPS), plus the old weapon styles as aliases
 * (slash, pierce, bludgeon, claw, bite, unarmed, ranged, thrown). ctx:
 *   caster, targets       bodies ({x, y, size, h, id, outcome})
 *   outcome(T)            "crit" | "hit" | "miss" | "neutral"
 *   release(s, M, x, y, z, pow, rad)   the family's burst plus shake
 *   linger, fire, handOf, POW          compile.mjs helpers
 *   windUp(M, caster, hand, at, dur)   the flavor's wind-up; false when there is none
 *   motif                 the motif's hooks or null (impact is called on contact)
 *
 * The delivery shapes it (a chop is a falling wedge, jaws are fangs closing),
 * `M` colours it (its ramp, its release), the props size and time it.
 *
 * The three outcomes have to read apart at a glance, on a token 26 px wide:
 *   hit    one stroke on the body, one release, a flinch
 *   crit   the same stroke, a one-frame hitstop on contact, then a second,
 *          bigger stroke across the first, a two-frame hitstop, a star and a
 *          fan of speed lines thrown out along the blow, and a heavier release
 *   miss   the stroke cuts the air BESIDE and past the body (never on it, and
 *          never on whoever stands next to it), speed lines carry on through,
 *          a scuff of dust where it ends; no flash, no flinch
 * `neutral` (a degree this viewer may not see) plays the hit, never the crit.
 *
 * Every delivery shape lands on a known sprite frame (`cf`): the contact cue
 * fires on that frame, and a crit's second stroke skips to one frame before it
 * so it lands with the crit's release.
 */

import { TAU, clamp, hash, fadeOut } from "./core/rand.mjs";
import { RAMP, S, WHITE } from "./core/palette.mjs";
import { lobes, out, releaseFlash, still, splat } from "./core/motifs.mjs";
import { registerShapes, snapH, GLYPHS } from "./core/shapes.mjs";
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

/** The crit's second impact: a star, a fan of speed lines thrown out along the blow, a ring. `k` grows it (deadly, fatal). */
function critImpact(s, M, A, T, k = 1) {
  const z = 0.6 * T.h, x = T.x - 0.05, y = T.y, base = Math.atan2(A.uy, A.ux);
  s.add({ k: "star", x, y, z, L: 9 * k * Math.min(1.4, s.m) * Math.sqrt(T.size ?? 1), life: 3 / 12, R: M.R, update: still });
  const n = 7 + Math.round((k - 1) * 8);
  for (let i = 0; i < n; i++) {
    const q = base + (i - (n - 1) / 2) * (2.1 / (n - 1)) + s.rand(-0.06, 0.06), sp = s.rand(8, 11) * k;
    s.add({ k: "streak", x, y, z, vx: Math.cos(q) * sp, vy: Math.sin(q) * sp, vz: s.rand(-1.5, 2.5), life: s.rand(0.14, 0.2), R: M.R, minor: i % 2 === 1 });
  }
  s.add({ k: "ring", x: T.x, y: T.y, r: 0.75 * k * (T.size ?? 1), life: 0.4, R: M.R, broken: true, seed: 5, update: still });
  if (k > 1.3) s.add({ k: "ring", x: T.x, y: T.y, r: 1.15 * k * (T.size ?? 1), life: 0.5, R: M.R, broken: true, seed: 9, wait: 1 / 12, update: still });
}

const hasProp = (spec, k) => { const p = spec?.props; return Array.isArray(p) ? p.includes(k) : !!p?.has?.(k); };

/**
 * How much a blow weighs: 1 for a one-handed weapon, more for a two-handed one
 * (`weapon.heavy` or the `heavy` prop) and for a powered swing (`weapon.power`
 * or `power`, Vicious Swing). Weight buys anticipation, a bigger smear, a held
 * contact and debris, never a second hit: a powered swing that misses is
 * still a miss.
 */
export const weightOf = (spec) => 1 + (spec?.weapon?.heavy || hasProp(spec, "heavy") ? 0.35 : 0) + (spec?.weapon?.power || hasProp(spec, "power") ? 0.3 : 0);

/** The props a Strike reads, once (docs/SPELLSPRITE_LOOK.md "Props"). */
function feelOf(s) {
  const p = s.props instanceof Set ? s.props : new Set(s.spec.props ?? []), has = (k) => p.has(k);
  const agile = has("agile");
  return {
    W: weightOf(s.spec), agile,
    tempo: agile ? 0.8 : 1, size: agile ? 0.85 : 1,
    reach: has("reach") ? 1.35 : 1, sweep: has("sweep") ? 1.3 : 1,
    critK: has("fatal") ? 1.5 : has("deadly") ? 1.25 : 1,
    forceful: has("forceful"), backstab: has("backstabber"), precious: has("precious"),
    magical: has("magical"), soft: has("nonlethal"), persistent: has("persistent"),
  };
}

/**
 * A heavy contact: the frame holds (no veil, that is a crit's), a hairline cut
 * through the body splits outward, grit and chips are thrown along the blow.
 * A nonlethal blow keeps the hold and the grit and loses the cut.
 */
function heavyContact(s, A, T, W, soft = false) {
  s.freeze = Math.max(s.freeze, W > 1.5 ? 2 / 12 : 1 / 12);
  s.shake = Math.max(s.shake, 0.6 + W);
  const base = Math.atan2(A.uy, A.ux);
  // the cut runs across the blow, leaning with it: a diagonal through the body
  const q = base + Math.PI / 2 - 0.55;
  if (!soft) s.add({ k: "cut", x: T.x, y: T.y, z: 0.62 * T.h, ux: Math.cos(q), uy: Math.sin(q), len: (1.1 + 0.9 * (W - 1)) * Math.sqrt(T.size ?? 1), life: 6 / 12, R: RAMP.kinetic, wait: 1 / 12, update: still });
  for (let i = 0; i < Math.round(4 + 6 * (W - 1)); i++) {
    const a = base + s.rand(-0.7, 0.7), sp = s.rand(2.5, 5);
    s.add({ k: "chunk", x: T.x + A.ux * 0.15, y: T.y + A.uy * 0.15, z: 0.4 * T.h, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vz: s.rand(1.5, 3.5), g: 9, drag: 0.8, bounce: 0.35, life: s.rand(1.6, 2.6), R: RAMP.kinetic, s: 2, wide: s.R() < 0.3, debris: true });
  }
  s.add({ k: "ring", x: T.x, y: T.y, r: 0.6 * (T.size ?? 1) * W, life: 0.45, R: RAMP.kinetic, broken: true, seed: 17, update: still });
  for (let i = 0; i < 3; i++) s.add({ k: "smoke", x: T.x + A.ux * 0.3 + s.rand(-0.25, 0.25), y: T.y + A.uy * 0.3 + s.rand(-0.2, 0.2), z: 0.1, vx: A.ux * s.rand(0.6, 1.2), vy: A.uy * s.rand(0.6, 1.2), vz: 0.2, g: -0.05, drag: 1.8, r: s.rand(2.5, 4), life: s.rand(0.7, 1.1), lobes: lobes(s), tone: 0.5, minor: i > 0 });
}

/** Weight's wind-up: the caster plants (a scuff of dust at the feet) and the weapon draws back. */
function windUp(s, M, caster, A, T, at, W) {
  if (!caster || W <= 1) return;
  s.at(Math.max(0, at - 0.24), (s2) => {
    for (let i = 0; i < 2; i++) s2.add({ k: "smoke", x: caster.x - A.ux * 0.25 + s2.rand(-0.15, 0.15), y: caster.y - A.uy * 0.25 + 0.2, z: 0.05, vx: -A.ux * 0.6, vy: -A.uy * 0.6, vz: 0.15, drag: 2, r: s2.rand(1.6, 2.4), life: 0.55, lobes: lobes(s2), tone: 0.5, minor: i > 0 });
    // the backswing: a thin dim arc on the far side, drawn the other way
    const [bx, by] = across(A, T, 180);
    s2.add({ k: "crescent", x: caster.x - A.ux * 0.1, y: caster.y - A.uy * 0.1, z: 1.1 * caster.h, from: [bx, by, 1.2], life: 3 / 12, R: M.R, flip: -1, span: 1.4, R2: 8 * W, T: 1.5, dim: true, update: still });
  });
}

/**
 * A contact's release. An element releases its family's burst; plain steel and
 * bone get a Strike-sized kinetic pop instead (a flash, a star, sparks and a
 * pinch of grit), because the physical family's smoke puffs bury the shape
 * that says what the blow was under a grey cloud.
 */
function contactRelease(s, ctx, M, x, y, z, pow, rad) {
  if (M.family !== "physical") { ctx.release(s, M, x, y, z, pow, rad); return; }
  releaseFlash(s, M, x, y, z, pow, rad, { light: 0.45, flash: 0.6 });
  const mm = Math.min(1.6, s.m * pow);
  s.add({ k: "star", x, y, z, L: 4 * mm, life: 3 / 12, R: M.R, update: still });
  for (let i = 0; i < Math.round(7 * mm); i++) s.add({ k: "spark", x, y, z, ...out(s, s.rand(3, 6.5)), g: 9, drag: 1.3, bounce: 0.4, life: s.rand(0.25, 0.5), R: M.R, minor: i % 2 === 1 });
  for (let i = 0; i < 2; i++) s.add({ k: "chunk", x, y, z, ...out(s, s.rand(1.5, 3)), g: 9, drag: 0.8, bounce: 0.35, life: s.rand(1.2, 1.8), R: M.R, s: 1, debris: true });
  if (pow > 1.2) s.add({ k: "smoke", x, y: y + 0.05, z: z * 0.5, vx: s.rand(-0.5, 0.5), vz: 0.3, drag: 2.5, g: -0.05, r: 2.5, life: 0.7, lobes: lobes(s), R: M.R, tone: 0.4, minor: true });
}

/** A miss's scuff: a puff of dust and a few grains where the blow runs out. */
function scuff(s, x, y, W) {
  for (let i = 0; i < 2; i++) s.add({ k: "smoke", x: x + s.rand(-0.12, 0.12), y: y + s.rand(-0.08, 0.08), z: 0.05, vx: s.rand(-0.6, 0.6), vy: s.rand(-0.3, 0.3), vz: 0.2, drag: 2.5, r: s.rand(1.8, 2.6) * Math.sqrt(W), life: s.rand(0.5, 0.75), lobes: lobes(s), tone: 0.45, minor: i > 0 });
  for (let i = 0; i < 3; i++) s.add({ k: "spark", x, y, z: 0.05, ...out(s, s.rand(1.5, 3)), g: 9, drag: 1.5, life: s.rand(0.2, 0.35), R: RAMP.kinetic, minor: true });
}

/** What a wound bleeds, or null: a cut on plain flesh, never a nonlethal one or an element's. */
const bleedOf = (M, F) => (F.soft ? null : M.id === "kinetic" || M.id === "neutral" ? RAMP.bleed : null);

/** The props' share of a contact. */
function propsOnHit(s, M, A, T, F, o, zk) {
  const z = zk * T.h;
  if (F.forceful) {
    // knocked back: speed lines past the body and a skid of dust at its feet
    for (let k = 0; k < 3; k++) s.add({ k: "streak", x: T.x + A.ux * 0.2 + A.px * (k - 1) * 0.16, y: T.y + A.uy * 0.2 + A.py * (k - 1) * 0.16, z: z + (k - 1) * 0.12, vx: A.ux * 9, vy: A.uy * 9, life: 0.16, R: M.R, wait: k * 0.02 });
    for (let k = 0; k < 2; k++) s.add({ k: "smoke", x: T.x + A.ux * 0.35, y: T.y + A.uy * 0.35 + 0.12, z: 0.05, vx: A.ux * 1.6, vy: A.uy * 1.6, vz: 0.1, drag: 3, r: s.rand(2, 3), life: 0.6, lobes: lobes(s), tone: 0.5, minor: k > 0 });
  }
  if (F.soft) {
    // nonlethal: a bigger, softer puff instead of a wound
    for (let k = 0; k < 3; k++) s.add({ k: "smoke", x: T.x + s.rand(-0.2, 0.2), y: T.y + s.rand(-0.15, 0.15), z: z * 0.7, vx: s.rand(-0.9, 0.9), vy: s.rand(-0.4, 0.4), vz: 0.35, drag: 2.2, g: -0.05, r: s.rand(4, 5.5), life: s.rand(0.8, 1.2), lobes: lobes(s), tone: 0.62, minor: k > 0 });
  }
  const B = bleedOf(M, F);
  if (o.blood && B) {
    for (let k = 0; k < 5; k++) {
      const q = Math.atan2(A.uy, A.ux) + s.rand(-0.9, 0.9), sp = s.rand(2, 4.5);
      s.add({ k: "spark", x: T.x, y: T.y, z, vx: Math.cos(q) * sp, vy: Math.sin(q) * sp, vz: s.rand(0.5, 2.5), g: 9, drag: 1.2, life: s.rand(0.25, 0.45), R: B, minor: k > 2 });
    }
  }
  if (F.persistent) {
    // a lingering bleed (or the element's own drip) off the wound
    const R = B ?? M.R, t0 = s.t;
    s.emit(t0, t0 + 1.8, (s2, u, dt) => {
      for (let i = s2.count(7 * (1 - u * 0.6), dt); i > 0; i--) s2.add({ k: "drip", x: T.x + s2.rand(-0.16, 0.16), y: T.y + s2.rand(-0.05, 0.08), z: s2.rand(0.3, 0.7) * T.h, g: 6, life: 3, R, onGround: splat });
    });
  }
  if (F.precious) s.add({ k: "glint", x: T.x - A.ux * 0.2, y: T.y - A.uy * 0.2, z: z + 0.15, life: 5 / 12, R: RAMP.metal, big: true, update: still });
  if (F.backstab) s.add({ k: "star", x: T.x + A.ux * 0.22, y: T.y + A.uy * 0.22, z, L: 3, life: 3 / 12, R: B ?? M.R, wait: 1 / 12, update: still });
}

/**
 * The shared tail of every melee delivery: the contact, a crit's second
 * stroke, the linger, or the whiff. `o`:
 *   contact   seconds from the stroke to its contact frame
 *   zk        contact height (× body height)
 *   pow, rad  the release
 *   knock     flinch strength (× the weight's)
 *   again     extra contacts after the first (a double jab, a squeeze's pulses)
 *   blood     the wound bleeds (natural cutters)
 *   onHit(s, A, T, outcome), whiff(s, A, T)   the delivery's own contact or miss beat
 */
function land(s, M, ctx, T, at, stroke, o = {}) {
  const out = ctx.outcome(T), A = aimOf(ctx, T), F = feelOf(s), W = F.W, c = at + (o.contact ?? 0.06), zk = o.zk ?? 0.6;
  if (out === "miss") {
    whoosh(s, M, A, T, c - 0.03);
    s.at(c + 0.04, (s2) => { scuff(s2, A.x + A.ux * 0.3, A.y + A.uy * 0.3, W); o.whiff?.(s2, A, T); });
    s.phases.push("whiff");
    return;
  }
  s.at(c, (s2) => {
    // a crit's first contact is hit-sized: the hitstop marks it, and a bigger cloud would bury the second stroke
    contactRelease(s2, ctx, M, T.x - 0.1, T.y, zk * T.h, (o.pow ?? 0.75) * Math.min(1.3, W), o.rad ?? 0.32);
    s2.hit(T.id, Math.min(1.5, W) * (o.knock ?? 1) * (F.forceful ? 1.4 : 1), A.from, M.R);
    if (W > 1) heavyContact(s2, A, T, W, F.soft);
    if (out === "crit") hitstop(s2, 1 / 12);
    o.onHit?.(s2, A, T, out);
    propsOnHit(s2, M, A, T, F, o, zk);
    ctx.motif?.impact?.(s2, M, { x: T.x, y: T.y, z: zk * T.h, pow: out === "crit" ? 1.6 : 1, rad: 0.35, at: s2.t });
  });
  for (const d of o.again ?? []) s.at(c + d, (s2) => { contactRelease(s2, ctx, M, T.x - 0.1, T.y, zk * T.h, 0.5, 0.25); s2.hit(T.id, 0.7, A.from, M.R); });
  if (W > 1) s.phases.push("held contact", F.soft ? "soft" : "cut", "debris");
  if (out === "crit") {
    const tail = (o.again?.length ? Math.max(...o.again) : 0);
    s.at(c + tail + 0.14, (s2) => stroke(s2, -1, true));
    s.at(c + tail + 0.22, (s2) => { contactRelease(s2, ctx, M, T.x - 0.1, T.y, zk * T.h, 1.6, 0.4); critImpact(s2, M, A, T, F.critK); s2.hit(T.id, 1.6 * F.critK, A.from, M.R); o.onHit?.(s2, A, T, "crit2"); });
    s.phases.push("hitstop", "second stroke", "impact frames");
  }
  if (M.id !== "kinetic") ctx.linger(s, M, T.x, T.y, 0.35, c + 0.1, c + 1.25);
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

/** A magic weapon's stroke shimmers: a few faint runes along its path. */
function shimmer(s, M, A, T, at) {
  const R = M.id === "kinetic" ? RAMP.arcane : M.R;
  s.at(at, (s2) => {
    for (let i = 0; i < 3; i++) {
      const f = 0.35 + i * 0.22;
      s2.add({ k: "mlRune", x: A.from.x + (A.x - A.from.x) * f + A.px * s2.rand(-0.12, 0.12), y: A.from.y + (A.y - A.from.y) * f + A.py * s2.rand(-0.12, 0.12), z: A.z(0.6) + s2.rand(0, 0.25), life: 7 / 12, R, seed: s2.seedInt(), wait: i * 0.03, minor: i === 2, update: still });
    }
  });
}

/**
 * The driver every melee and natural delivery shares. `def`:
 *   name      the phase name
 *   at        seconds before the stroke (the wind-up's room); agile shortens it
 *   cf        the stroke's contact sprite frame
 *   stroke(s, A, T, x)   adds the stroke's particles now. x: { flip, big, sc, skip, F, W }
 *   land      options for `land`
 *   glint     a weapon's wind-up glint (false for natural attacks)
 *   period    the loop length
 */
function melee(s, M, ctx, def) {
  const F = feelOf(s), W = F.W, { caster } = ctx;
  const lead = (def.at ?? 0.3) * F.tempo + (W > 1 ? 0.14 : 0) + (F.reach > 1 ? 0.06 : 0);
  const sc0 = clamp(s.m, 0.85, 1.25) * F.size;
  if (def.glint !== false || F.precious) glint(s, F.precious ? { R: RAMP.metal } : M, caster);
  if (caster && ctx.windUp) ctx.windUp(M, caster, ctx.handOf(caster, ctx.targets[0] ?? null), 0, lead);
  const cf = def.cf ?? 1, contact = cf / 12 + 0.005;
  ctx.targets.forEach((T, i) => {
    const at = lead + i * 0.2, A = aimOf(ctx, T), sz = Math.sqrt(T.size ?? 1);
    const stroke = (s2, flip, big) => def.stroke(s2, A, T, { flip, big, sc: sc0 * sz * (big ? 1.4 * F.critK : 1), skip: big ? Math.max(0, cf - 1) : 0, F, W });
    windUp(s, M, caster, A, T, at, W);
    s.at(at, (s2) => stroke(s2, 1, false));
    if (F.magical) shimmer(s, M, A, T, at);
    land(s, M, ctx, T, at, stroke, { contact, ...def.land });
  });
  s.phases.push(def.name);
  if (W > 1) s.phases.push("wind-up plant");
  s.period = (def.period ?? 2.3) + (W > 1 ? 0.5 : 0) + (ctx.targets.length - 1) * 0.2;
}

/** The common particle fields of a stroke shape at the aim point. */
const at3 = (A, T, k) => ({ x: A.x, y: A.y, z: A.z(k), fx: A.from.x, fy: A.from.y, update: still });

/** The material's tear: kinetic bleeds, an element scars in its own colour. */
const tearOf = (M, F) => bleedOf(M, F) ?? M.R;

/* ── the deliveries ──────────────────────────────────────────────────── */

const DELIVER = {
  /** Sword: a crescent slash; weight adds a white cutting rim and a smear echo. */
  swing: (s, M, ctx) => melee(s, M, ctx, {
    name: "slash", at: 0.3, cf: 1, period: 2.4,
    stroke(s2, A, T, { flip, big, sc, W, F }) {
      const [fx, fy] = big ? across(A, T, 70) : [A.from.x, A.from.y];
      const R2 = 12 * sc * W * F.sweep, Tk = 4 * (big ? 1.5 : 1) * W * Math.min(1.5, sc);
      s2.add({ k: "crescent", x: A.x - 0.05, y: A.y, z: A.z(0.55), from: [fx, fy, big ? 1.1 : 0.6 * F.reach], life: 6 / 12, R: M.R, flip, R2, T: Tk, span: 2.3 * F.sweep, edge: W > 1 || big, update: still });
      if (W > 1) s2.add({ k: "crescent", x: A.x - 0.05, y: A.y, z: A.z(0.55), from: [fx, fy, big ? 1.1 : 0.6], life: 5 / 12, R: M.R, flip, R2: R2 * 0.8, T: Tk * 0.7, span: 2.3 * F.sweep, dim: true, wait: 1 / 12, update: still });
    },
  }),

  /** Axe: a heavy overhead wedge falling straight down, a split and chips. */
  chop: (s, M, ctx) => melee(s, M, ctx, {
    name: "chop", at: 0.34, cf: 2, period: 2.5,
    stroke(s2, A, T, { big, sc, skip, W }) {
      s2.add({ k: "mlWedge", ...at3(A, T, 0.55), L: 30 * sc * Math.min(1.3, W), w: 9 * sc * Math.min(1.3, W), life: 6 / 12, R: M.R, skip, flip: big ? -1 : 1 });
    },
    land: {
      zk: 0.5, pow: 0.7,
      onHit(s2, A, T, o) {
        if (o === "crit2") return;
        s2.add({ k: "mlSplit", x: T.x, y: T.y, z: 0.55 * T.h, L: 16 * Math.sqrt(T.size ?? 1), life: 6 / 12, R: RAMP.kinetic, update: still });
        for (let i = 0; i < 3; i++) s2.add({ k: "chunk", x: T.x, y: T.y, z: 0.5 * T.h, vx: s2.rand(-2.5, 2.5), vy: s2.rand(-1, 1), vz: s2.rand(2, 3.5), g: 9, drag: 0.8, bounce: 0.3, life: s2.rand(1.2, 2), R: RAMP.wood, s: 2, debris: true });
        s2.shake = Math.max(s2.shake, 1);
      },
    },
  }),

  /** Club and hammer: a downward arc ending in a hammer head, radial impact lines, a ground ring. */
  smash: (s, M, ctx) => melee(s, M, ctx, {
    name: "smash", at: 0.36, cf: 1, period: 2.5,
    stroke(s2, A, T, { flip, big, sc, W }) {
      const [fx, fy] = big ? across(A, T, -40) : [A.x, A.y], g = (big ? 1.2 : 1) * W;
      s2.add({ k: "crescent", x: A.x, y: A.y, z: A.z(0.7), from: [fx, fy, big ? 2.4 : 2], life: 5 / 12, R: M.R, flip, span: 1.6, R2: 10 * g * sc, T: 6 * g * Math.min(1.5, sc), update: still });
      s2.add({ k: "mlMaul", ...at3(A, T, 0.75), sc: sc * Math.min(1.3, W) * (big ? 1.1 : 1), life: 5 / 12, R: M.R });
    },
    land: {
      zk: 0.65,
      onHit(s2, A, T) {
        s2.add({ k: "mlPow", x: T.x, y: T.y, z: 0.65 * T.h, r: 5, L: 6, n: 8, life: 3 / 12, R: M.R, seed: 0.2, update: still });
        s2.add({ k: "ring", x: T.x, y: T.y, r: 0.55 * T.size, life: 0.45, R: RAMP.kinetic, broken: true, seed: 11, update: still });
        s2.shake = Math.max(s2.shake, 1.2);
      },
    },
  }),

  /** Spear: a long shaft driven in with a leaf head; reach draws it from further back. */
  thrust: (s, M, ctx) => melee(s, M, ctx, {
    name: "thrust", at: 0.28, cf: 1, period: 2.3,
    stroke(s2, A, T, { big, sc, W, F }) {
      const on = A.miss ? 0.45 : big ? 0.3 : 0;
      s2.add({ k: "mlSpear", ...at3(A, T, 0.6), x: A.x + A.ux * on, y: A.y + A.uy * on, ux: A.ux, uy: A.uy, len: (1.0 + 0.2 * (T.size ?? 1)) * F.reach * (big ? 1.3 : 1) * Math.min(1.25, W), sc, life: 5 / 12, R: M.R });
    },
    land: {
      onHit(s2, A, T) {
        // through: a spray out of the far side
        for (let k = 0; k < 4; k++) { const q = Math.atan2(A.uy, A.ux) + (k - 1.5) * 0.25, sp = s2.rand(6, 8); s2.add({ k: "streak", x: T.x + A.ux * 0.2, y: T.y + A.uy * 0.2, z: 0.6 * T.h, vx: Math.cos(q) * sp, vy: Math.sin(q) * sp, life: 0.13, R: M.R, minor: k % 2 === 1 }); }
      },
    },
  }),

  /** Polearm: a wide flat arc swept round from the wielder, passing through the body. */
  sweep: (s, M, ctx) => melee(s, M, ctx, {
    name: "sweep", at: 0.32, cf: 1, period: 2.4,
    stroke(s2, A, T, { flip, big, sc, F, W }) {
      const r = Math.max(0.9, Math.hypot(A.x - A.from.x, A.y - A.from.y)), mid = Math.atan2(A.y - A.from.y, A.x - A.from.x);
      const span = 1.5 * F.sweep * (big ? 1.25 : 1), dir = flip;
      s2.add({ k: "mlSwath", x: A.from.x, y: A.from.y, z: A.z(0.5) + (big ? 0.15 : 0), r, q0: mid - (dir * span) / 2, dir, span, th: Math.round(2 + sc * Math.min(1.3, W)), life: 6 / 12, R: M.R, edge: W > 1 || big, update: still });
    },
    land: { zk: 0.5 },
  }),

  /** Knife: a quick agile double jab. */
  stab: (s, M, ctx) => melee(s, M, ctx, {
    name: "double jab", at: 0.22, cf: 1, period: 2.1,
    stroke(s2, A, T, { big, sc }) {
      const len = 0.55 * (big ? 1.3 : 1), sh = big ? 0.25 : 0;
      s2.add({ k: "mlShiv", ...at3(A, T, 0.62), x: A.x + A.ux * sh, y: A.y + A.uy * sh, ux: A.ux, uy: A.uy, len, sc, life: 3 / 12, R: M.R });
      s2.add({ k: "mlShiv", ...at3(A, T, 0.45), x: A.x + A.ux * sh + A.px * 0.08, y: A.y + A.uy * sh + A.py * 0.08, ux: A.ux, uy: A.uy, len, sc, life: 3 / 12, R: M.R, wait: 0.1 });
    },
    land: { again: [0.1], pow: 0.6, blood: true },
  }),

  /** Pick: a narrow pointed head swung down onto one point. */
  peck: (s, M, ctx) => melee(s, M, ctx, {
    name: "peck", at: 0.3, cf: 2, period: 2.3,
    stroke(s2, A, T, { sc, skip, W, big }) {
      s2.add({ k: "mlPick", ...at3(A, T, 0.62), sc: sc * Math.min(1.3, W), life: 5 / 12, R: M.R, skip, flip: big ? -1 : 1 });
    },
    land: {
      pow: 0.6,
      onHit(s2, A, T, o) { if (o !== "crit2") s2.add({ k: "cut", x: T.x, y: T.y, z: 0.62 * T.h, ux: A.px, uy: A.py, len: 0.5, life: 5 / 12, R: RAMP.kinetic, wait: 1 / 12, update: still }); },
    },
  }),

  /** Flail: a spiked head whirled on its chain, then flung into the body. */
  flail: (s, M, ctx) => melee(s, M, ctx, {
    name: "spin and strike", at: 0.2, cf: 3, period: 2.5, glint: false,
    stroke(s2, A, T, { sc, skip, W, big }) {
      const hand = ctx.caster ? ctx.handOf(ctx.caster, T) : [A.from.x, A.from.y, 0.85];
      s2.add({ k: "mlFlail", ...at3(A, T, 0.62), fx: hand[0], fy: hand[1], fz: big ? hand[2] + 0.5 : hand[2], sc: sc * Math.min(1.3, W), q0: s2.rand(0, TAU), life: 7 / 12, R: M.R, skip });
    },
    land: {
      onHit(s2, A, T) { s2.add({ k: "mlPow", x: T.x, y: T.y, z: 0.62 * T.h, r: 4, L: 5, n: 6, life: 3 / 12, R: M.R, seed: 0.5, update: still }); },
    },
  }),

  /** Whip, tail, tentacle: a curve that unrolls and cracks at its tip. */
  lash: (s, M, ctx) => melee(s, M, ctx, {
    name: "lash", at: 0.2, cf: 3, period: 2.3, glint: false,
    stroke(s2, A, T, { sc, skip, F, big }) {
      const hand = ctx.caster ? ctx.handOf(ctx.caster, T) : [A.from.x, A.from.y, 0.85];
      // a weapon whip is a cord; a tail or a tentacle is a limb
      const thin = ["whip", "chain"].includes(s2.spec.motif) || !!s2.spec.weapon?.group;
      const reach = F.reach;
      s2.add({ k: "mlWhip", x: A.x + A.ux * 0.05 * reach, y: A.y + A.uy * 0.05 * reach, z: A.z(0.7), fx: hand[0] - A.ux * 0.2 * (reach - 1), fy: hand[1] - A.uy * 0.2 * (reach - 1), fz: hand[2] + (big ? 0.4 : 0), thick: (thin ? 1 : 1.8) * Math.min(1.3, sc), life: 7 / 12, R: M.R, skip, flip: big ? -1 : 1, update: still });
    },
    land: { zk: 0.7, pow: 0.65 },
  }),

  /** Brawling: a knuckle punch with an impact ring; a flurry is two quick ones. */
  fist: (s, M, ctx) => {
    const flurry = s.spec.flavor === "flurry";
    melee(s, M, ctx, {
      name: flurry ? "flurry" : "punch", at: flurry ? 0.18 : 0.22, cf: 1, period: 2.2, glint: false,
      stroke(s2, A, T, { big, sc }) {
        s2.add({ k: "mlKnuckle", ...at3(A, T, 0.62), sc: sc * (big ? 1.15 : 1), dy: 0, life: 5 / 12, R: M.R });
        if (flurry && !big) s2.add({ k: "mlKnuckle", ...at3(A, T, 0.5), sc: sc * 0.9, dy: 4, life: 5 / 12, R: M.R, wait: 0.13 });
      },
      land: {
        pow: 0.6, again: flurry ? [0.13] : [],
        onHit(s2, A, T, o) {
          const pop = (z, w) => s2.add({ k: "mlPop", x: T.x - A.ux * 0.1, y: T.y - A.uy * 0.1, z, r: o === "crit2" ? 3 : 2, life: 3 / 12, R: M.R, wait: w, update: still });
          pop(0.62 * T.h, 0);
          if (flurry && o !== "crit2") pop(0.5 * T.h, 0.13);
        },
      },
    });
  },

  /** Shield: the face slams flat into the body, a hard bar of light where they meet. */
  bash: (s, M, ctx) => melee(s, M, ctx, {
    name: "shield bash", at: 0.28, cf: 2, period: 2.3,
    stroke(s2, A, T, { sc, skip, W }) {
      s2.add({ k: "mlShield", ...at3(A, T, 0.55), sc: sc * Math.min(1.25, W), life: 6 / 12, R: M.R, skip });
    },
    land: { zk: 0.55, knock: 1.25, onHit(s2, A, T) { whooshPast(s2, M, A, T); } },
  }),

  /* ── natural attacks ── */

  /** Claw, talon: three tapered gashes with a hot core, leaving a torn trail. */
  rake: (s, M, ctx) => melee(s, M, ctx, {
    name: "rake", at: 0.22, cf: 1, period: 2.2, glint: false,
    stroke(s2, A, T, { flip, big, sc, F }) {
      const L = 22 * sc * (big ? 1.15 : 1), tear = tearOf(M, F);
      for (let k = -1; k <= 1; k++) s2.add({ k: "mlGash", ...at3(A, T, 0.6), lane: k, gap: 5.5 * sc, L: L * (k ? 0.82 : 1), w: 2 * Math.min(1.3, sc), flip, life: 8 / 12, R: M.R, tear, wait: (k + 1) * 0.02 });
    },
    land: { blood: true },
  }),

  /** Jaws, fangs, beak: rows of fangs snapping shut, a spray from the bite. */
  jaws: (s, M, ctx) => melee(s, M, ctx, {
    name: "bite", at: 0.2, cf: 2, period: 2.2, glint: false,
    stroke(s2, A, T, { big, sc, skip }) {
      s2.add({ k: "mlFangs", ...at3(A, T, 0.62), sc, n: big ? 4 : 3, life: 6 / 12, R: M.R, skip });
    },
    land: {
      blood: true, pow: 0.6,
      onHit(s2, A, T, o) {
        const B = bleedOf(M, feelOf(s2)) ?? M.R;
        for (let k = 0; k < (o === "crit2" ? 8 : 5); k++) {
          const q = s2.rand(0, TAU), sp = s2.rand(2.5, 4.5);
          s2.add({ k: "spark", x: T.x + Math.cos(q) * 0.08, y: T.y, z: 0.62 * T.h, vx: Math.cos(q) * sp, vy: Math.sin(q) * sp * 0.5, vz: s2.rand(0, 2.5), g: 9, drag: 1.2, life: s2.rand(0.25, 0.4), R: B, minor: k > 3 });
        }
      },
    },
  }),

  /** Horn, tusk, antler: a lunging hook that tosses upward. */
  gore: (s, M, ctx) => melee(s, M, ctx, {
    name: "gore and toss", at: 0.24, cf: 1, period: 2.3, glint: false,
    stroke(s2, A, T, { sc, skip, F }) {
      s2.add({ k: "mlHorn", ...at3(A, T, 0.5), sc: sc * (F.W > 1 ? 1.15 : 1), life: 5 / 12, R: M.R, skip });
    },
    land: {
      zk: 0.5, blood: true, knock: 1.2,
      onHit(s2, A, T) {
        // the toss: grit and lines thrown up off the hook
        for (let k = 0; k < 4; k++) s2.add({ k: "streak", x: T.x + (k - 1.5) * 0.12, y: T.y, z: 0.5 * T.h, vx: A.ux * 1.5, vy: A.uy * 1.5, vz: s2.rand(7, 9), life: 0.14, R: M.R, minor: k % 2 === 1 });
        for (let k = 0; k < 3; k++) s2.add({ k: "chunk", x: T.x, y: T.y, z: 0.05, vx: s2.rand(-1, 1), vy: s2.rand(-0.5, 0.5), vz: s2.rand(3, 4.5), g: 9, drag: 0.8, bounce: 0.3, life: s2.rand(1.2, 1.8), R: RAMP.kinetic, s: 1, debris: true });
      },
    },
  }),

  /** Stinger, barb, spine: a quick jab down from above, then venom drips from the wound. */
  sting: (s, M, ctx) => melee(s, M, ctx, {
    name: "sting", at: 0.2, cf: 1, period: 2.4, glint: false,
    stroke(s2, A, T, { sc, skip }) {
      s2.add({ k: "mlBarb", ...at3(A, T, 0.62), sc, life: 4 / 12, R: M.R, skip });
    },
    land: {
      pow: 0.5, rad: 0.22,
      onHit(s2, A, T) {
        const V = M.id === "kinetic" || M.id === "neutral" ? RAMP.poison : M.R;
        s2.add({ k: "mlPop", x: T.x, y: T.y, z: 0.62 * T.h, r: 2, life: 3 / 12, R: V, update: still });
        for (let k = 0; k < 4; k++) s2.add({ k: "drip", x: T.x + s2.rand(-0.08, 0.08), y: T.y + 0.02, z: 0.6 * T.h, vx: s2.rand(-0.4, 0.4), vz: s2.rand(0, 0.6), g: 6, life: 3, R: V, wait: 0.05 + k * 0.12, onGround: splat });
        for (let k = 0; k < 3; k++) s2.add({ k: "mote", x: T.x + s2.rand(-0.2, 0.2), y: T.y + s2.rand(-0.1, 0.1), z: s2.rand(0.4, 0.8) * T.h, vz: 0.3, life: 0.9, R: V, plus: true, wait: 0.1 + k * 0.1, minor: k > 0 });
      },
    },
  }),

  /** Hoof, foot: it comes down on the ground at the body's feet; the ground cracks and dust rings out. */
  stomp: (s, M, ctx) => melee(s, M, ctx, {
    name: "stomp", at: 0.26, cf: 2, period: 2.5, glint: false,
    stroke(s2, A, T, { sc, skip, W }) {
      const fx = A.miss ? A.x : T.x - A.ux * 0.12, fy = A.miss ? A.y : T.y - A.uy * 0.12;
      s2.add({ k: "mlHoof", x: fx, y: fy, z: 0, fx: A.from.x, fy: A.from.y, sc: sc * Math.min(1.3, W), life: 6 / 12, R: M.R, skip, update: still });
    },
    land: {
      zk: 0.25, pow: 0.6, knock: 1.2,
      onHit(s2, A, T, o) {
        const R = M.id === "kinetic" ? RAMP.earth : M.R;
        s2.add({ k: "mlCracks", x: T.x, y: T.y, r: (o === "crit2" ? 0.85 : 0.6) * (T.size ?? 1), life: 1.6, R, seed: s2.seedInt(), update: still });
        s2.add({ k: "ring", x: T.x, y: T.y, r: 0.7 * (T.size ?? 1), life: 0.45, R: RAMP.kinetic, broken: true, seed: 13, update: still });
        dustRing(s2, T.x, T.y, 6, 0.4);
        s2.shake = Math.max(s2.shake, 1.4);
      },
      whiff(s2, A) { dustRing(s2, A.x, A.y, 4, 0.3); },
    },
  }),

  /** Wing: a flap sweeps through, gusts carry past and feathers fall. */
  buffet: (s, M, ctx) => melee(s, M, ctx, {
    name: "wing buffet", at: 0.24, cf: 2, period: 2.6, glint: false,
    stroke(s2, A, T, { sc, skip, big }) {
      const back = 0.5 * Math.sqrt(T.size ?? 1);
      s2.add({ k: "mlWing", x: A.x - A.ux * back, y: A.y - A.uy * back, z: A.z(0.95), fx: A.from.x, fy: A.from.y, sc: sc * (big ? 1.1 : 1), life: 5 / 12, R: M.R, skip, update: still });
      s2.at(s2.t + (2 - skip) / 12, (s3) => {
        for (let k = 0; k < 4; k++) {
          const sp = s3.rand(5, 7), o = (k - 1.5) * 0.16;
          s3.add({ k: "mlGust", x: A.x - A.ux * 0.4 + A.px * o, y: A.y - A.uy * 0.4 + A.py * o, z: (0.35 + k * 0.17) * T.h, vx: A.ux * sp, vy: A.uy * sp, drag: 1.5, life: 0.35, R: M.R, wait: k * 0.025, minor: k === 3 });
        }
      });
    },
    land: {
      pow: 0.55, knock: 1.3,
      onHit(s2, A, T) { feathers(s2, M, T, 4); },
      whiff(s2, A, T) { feathers(s2, M, { ...T, x: A.x, y: A.y }, 2); },
    },
  }),

  /** Fist, slam, body, pseudopod: a big blunt mass that squashes on the body. */
  slam: (s, M, ctx) => melee(s, M, ctx, {
    name: "slam", at: 0.28, cf: 2, period: 2.5, glint: false,
    stroke(s2, A, T, { sc, skip, W }) {
      s2.add({ k: "mlSlab", ...at3(A, T, 0.55), sc: sc * Math.min(1.3, W) * Math.sqrt(T.size ?? 1), life: 6 / 12, R: M.R, skip });
    },
    land: {
      zk: 0.55, pow: 0.8, knock: 1.4,
      onHit(s2, A, T) {
        s2.add({ k: "mlPow", x: T.x, y: T.y, z: 0.55 * T.h, r: 7, L: 8, n: 10, life: 3 / 12, R: M.R, seed: 0.1, update: still });
        s2.add({ k: "ring", x: T.x, y: T.y, r: 0.65 * (T.size ?? 1), life: 0.45, R: RAMP.kinetic, broken: true, seed: 3, update: still });
        s2.shake = Math.max(s2.shake, 1.6);
      },
    },
  }),

  /** Pincer: two curved blades scissor shut on the body. */
  pincer: (s, M, ctx) => melee(s, M, ctx, {
    name: "pincer", at: 0.22, cf: 2, period: 2.2, glint: false,
    stroke(s2, A, T, { sc, skip }) {
      s2.add({ k: "mlPincer", ...at3(A, T, 0.6), sc, life: 5 / 12, R: M.R, skip });
    },
    land: { blood: true, pow: 0.6 },
  }),

  /** Hand, touch, seize: an open hand closes its fingers over the body. */
  grasp: (s, M, ctx) => melee(s, M, ctx, {
    name: "grasp", at: 0.22, cf: 2, period: 2.3, glint: false,
    stroke(s2, A, T, { sc, skip }) {
      s2.add({ k: "mlHand", ...at3(A, T, 0.6), sc: sc * Math.sqrt(T.size ?? 1), life: 8 / 12, R: M.R, skip });
    },
    land: { pow: 0.5, rad: 0.25, knock: 0.7 },
  }),

  /** Constrict, coil: a coil wraps the body and tightens in pulses. */
  squeeze: (s, M, ctx) => melee(s, M, ctx, {
    name: "constrict", at: 0.2, cf: 3, period: 2.8, glint: false,
    stroke(s2, A, T, { big, skip }) {
      const sz = T.size ?? 1;
      s2.add({ k: "mlCoil", x: A.x, y: A.y, z: 0, z0: (A.miss ? 0.75 : 0.15) * T.h, z1: (A.miss ? 1.2 : 0.8) * T.h, r: 0.44 * sz, q0: s2.rand(0, TAU), frames: big ? 6 : 13, pulses: big ? [2, 4] : [3, 7, 11], life: (big ? 6 : 13) / 12, R: M.R, skip, update: still });
    },
    land: { pow: 0.45, rad: 0.3, again: [4 / 12, 8 / 12], knock: 0.6 },
  }),
};

/** Dust thrown out in a low ring at the feet. */
function dustRing(s, x, y, n, r) {
  for (let i = 0; i < n; i++) {
    const q = (i / n) * TAU + s.rand(-0.2, 0.2), sp = s.rand(1.2, 2);
    s.add({ k: "smoke", x: x + Math.cos(q) * r * 0.5, y: y + Math.sin(q) * r * 0.5, z: 0.05, vx: Math.cos(q) * sp, vy: Math.sin(q) * sp, vz: 0.1, drag: 3, r: s.rand(2, 3), life: s.rand(0.6, 0.9), lobes: lobes(s), tone: 0.5, minor: i % 2 === 1 });
  }
}

/** Speed lines straight through and out the far side of the body. */
function whooshPast(s, M, A, T) {
  for (let k = 0; k < 3; k++) s.add({ k: "streak", x: T.x + A.ux * 0.25 + A.px * (k - 1) * 0.18, y: T.y + A.uy * 0.25 + A.py * (k - 1) * 0.18, z: (0.4 + k * 0.15) * T.h, vx: A.ux * 8, vy: A.uy * 8, life: 0.15, R: M.R, wait: k * 0.015, minor: k === 2 });
}

/** Loose feathers drifting down. */
function feathers(s, M, T, n) {
  for (let k = 0; k < n; k++) s.add({ k: "mlPlume", x: T.x + s.rand(-0.3, 0.3), y: T.y + s.rand(-0.15, 0.15), z: s.rand(0.6, 1.1) * T.h, vx: s.rand(-0.6, 0.6), vy: s.rand(-0.2, 0.2), vz: s.rand(0.2, 0.6), g: 0.6, drag: 2.5, life: s.rand(1.1, 1.6), R: M.R, seed: s.R(), minor: k > 1 });
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
  ...DELIVER,
  // the old weapon styles (constants.mjs WEAPON_STYLES): the looks editor and older specs
  slash: DELIVER.swing,
  pierce: DELIVER.thrust,
  bludgeon: DELIVER.smash,
  claw: DELIVER.rake,
  bite: DELIVER.jaws,
  unarmed: DELIVER.fist,
  ranged: (s, M, ctx) => ranged(s, M, ctx),
  thrown: (s, M, ctx) => ranged(s, M, ctx, { arc: 0.6, spin: true }),
});

/* ── the shapes only Strikes draw ─────────────────────────────────────── */

/** Screen height of a standing thing: the top-down view lifts height only a little, so it is drawn shorter. */
const UP = (v) => (v.kind === "top" ? 0.6 : 1);
/** The unit screen direction from a shape's source (fx, fy) to its point. */
function sdir(v, p) {
  const [ax, ay] = v.ap(p.fx ?? p.x - 1, p.fy ?? p.y, p.z), [bx, by] = v.ap(p.x, p.y, p.z), dx = bx - ax, dy = by - ay, l = Math.hypot(dx, dy);
  return l < 1 ? [1, 0] : [dx / l, dy / l];
}
/** Which way a blow travels across the screen: 1 to the right, -1 to the left. */
const sideOf = (v, p) => (sdir(v, p)[0] < -0.15 ? -1 : 1);
/** The sprite frame, skipped ahead for a crit's second stroke. */
const frame = (p) => Math.floor(p.age * 12) + (p.skip ?? 0);
/** Fade-out alpha over the last frames of a shape. */
const tailA = (fr, last) => (fr < last - 1 ? 1 : fr === last - 1 ? 0.6 : 0.3);

/**
 * A tapered stroke along a polyline: `hw(f)` its half-width at f ∈ [0, 1] along
 * it, `col(f, e, side)` the colour at f, e = distance / half-width, side the
 * signed side of the line (null to skip the pixel).
 */
function ribbon(P, pts, hw, col, o = 1) {
  const n = pts.length; if (n < 2) return;
  const cum = [0];
  for (let i = 1; i < n; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const tot = cum[n - 1] || 1;
  let wm = 0, x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let k = 0; k <= 8; k++) wm = Math.max(wm, hw(k / 8));
  for (const [x, y] of pts) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  const pad = wm + 1;
  P.shade(x0 - pad, y0 - pad, x1 + pad, y1 + pad, (x, y) => {
    let best = Infinity, bf = 0, side = 0;
    for (let i = 0; i < n - 1; i++) {
      const ax = pts[i][0], ay = pts[i][1], dx = pts[i + 1][0] - ax, dy = pts[i + 1][1] - ay, L2 = dx * dx + dy * dy || 1e-6;
      const t = clamp(((x - ax) * dx + (y - ay) * dy) / L2), qx = ax + dx * t - x, qy = ay + dy * t - y, d2 = qx * qx + qy * qy;
      if (d2 < best) { best = d2; bf = (cum[i] + t * Math.sqrt(L2)) / tot; side = dx * (y - ay) - dy * (x - ax); }
    }
    const w = hw(bf) + 0.5, d = Math.sqrt(best);
    return d > w ? null : col(bf, d / w, side);
  }, o);
}

/** A filled ellipse-ish blob in screen space, through a per-pixel colour. */
function blobAt(P, cx, cy, rx, ry, col, o = 1) {
  P.shade(cx - rx - 1, cy - ry - 1, cx + rx + 1, cy + ry + 1, (x, y) => {
    const dx = (x - cx) / rx, dy = (y - cy) / ry, e = dx * dx + dy * dy;
    return e > 1 ? null : col(dx, dy, e);
  }, o);
}

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

/* The melee and natural deliveries' own shapes. All are in art pixels at 26
   per square, scaled by `sc`, and step on the 12 fps sprite clock. */
registerShapes({
  /** Chop: an axe falling overhead. A fan of smear from the grip widens into a solid head with a curved bit. */
  mlWedge(v, P, p) {
    const fr = frame(p); if (fr > 5) return;
    const [cx, cy] = v.ap(p.x, p.y, p.z), sx = sideOf(v, p) * (p.flip ?? 1), L = p.L * UP(v);
    // the arc's pivot (the wielder's grip) is high and a little behind: the head falls nearly straight down
    const ax = cx - sx * p.L * 0.22, ay = cy - L, reach = [0.38, 0.8, 1, 1, 1, 1][fr];
    const hx = ax + (cx - ax) * reach, hy = ay + (cy - ay) * reach, len = Math.hypot(hx - ax, hy - ay) || 1, ux = (hx - ax) / len, uy = (hy - ay) / len;
    const w = p.w, head = Math.min(len * 0.45, 6.5 * (p.w / 8)), gone = [0, 0, 0, 0.45, 0.75, 0.95][fr], hero = fr === 2, a = tailA(fr, 6);
    // the haft back up to the grip, then the head and its smear
    if (fr < 4) P.line(ax, ay, hx - ux * head, hy - uy * head, S(p.R, 0.45), 1, a);
    P.shade(Math.min(ax, hx) - w - 4, Math.min(ay, hy) - w - 4, Math.max(ax, hx) + w + 4, Math.max(ay, hy) + w + 4, (x, y) => {
      const rx = x - ax, ry = y - ay, al = rx * ux + ry * uy, pe = rx * uy - ry * ux, f = al / len, ap = Math.abs(pe);
      if (al < 0) return null;
      // the blade: a block the full width, its bit curving out ahead of it
      if (al > len - head) {
        if (fr > 3) return null;
        const bit = 2.5 * (1 - Math.min(1, ap / w) ** 2);
        if (ap > w + 0.5 || al > len + bit) return null;
        if (al > len - 1.2) return hero ? WHITE : S(p.R, 1);
        // the beard: the back corner of the blade is cut away toward the haft
        if (pe * sx > w * 0.55 && al < len - head * 0.55) return null;
        return ap > w - 1 ? S(p.R, 0.55) : pe * sx < 0 ? S(p.R, 0.92) : S(p.R, 0.74);
      }
      // the smear: a dithered fan from the grip, widening to the blade, erased from the grip as it fades
      if (f < gone) return null;
      const half = w * f;
      if (ap > half + 0.5) return null;
      return (Math.floor(x) + Math.floor(y)) % 2 ? S(p.R, f > 0.6 ? 0.78 : 0.6) : null;
    }, 1);
  },
  /** A chop's split: a vertical hairline through the body that parts up and down. */
  mlSplit(v, P, p) {
    const fr = Math.floor(p.age * 12); if (fr > 5) return;
    const [cx, cy] = v.ap(p.x, p.y, p.z), half = (p.L * UP(v)) / 2, gap = [0, 0.12, 0.25, 0.4, 0.55, 0.7][fr];
    for (const side of [-1, 1]) {
      const y0 = cy + side * half * gap, y1 = cy + side * half * (1 + gap * 0.3);
      P.line(cx, y0, cx + side * 0.6, y1, null, 1, 1, (f) => (fr < 2 ? WHITE : f < 0.5 ? S(p.R, 0.9) : S(p.R, 0.6)));
    }
  },
  /** Smash: the hammer head at the end of its arc, a block with a lit face. */
  mlMaul(v, P, p) {
    const fr = Math.floor(p.age * 12); if (fr < 1 || fr > 3) return;
    const [cx, cy] = v.ap(p.x, p.y, p.z), sx = sideOf(v, p), sc = p.sc, w = Math.round(3 * sc), h = Math.round(5 * sc), lift = fr === 1 ? -2 : 0;
    const x0 = Math.round(cx - sx * 2), y0 = Math.round(cy - h - 1 + lift);
    for (let j = 0; j <= h; j++) for (let i = -w; i <= w; i++) {
      const face = j === h, c = face ? (fr === 1 ? WHITE : S(p.R, 1)) : i * sx < 0 ? S(p.R, 0.82) : S(p.R, 0.6);
      P.dot(x0 + i, y0 + j, c, fr === 3 ? 0.5 : 1, 1);
    }
    // the haft, back toward the wielder
    P.line(x0 - sx * (w + 1), y0 + h * 0.4, x0 - sx * (w + 1 + 5 * sc), y0 + h * 0.4 - 4 * sc, S(p.R, 0.5), 1, fr === 3 ? 0.5 : 1);
  },
  /** Radial impact lines, alternating long and short. */
  mlPow(v, P, p) {
    const fr = Math.floor(p.age * 12); if (fr > 2) return;
    const [cx, cy] = v.ap(p.x, p.y, p.z), n = p.n ?? 8, r0 = p.r * [0.6, 0.9, 1.2][fr], L = p.L * [1, 1, 0.5][fr], up = UP(v);
    for (let i = 0; i < n; i++) {
      const q = (i / n) * TAU + p.seed, Li = L * (i % 2 ? 0.55 : 1), c = fr === 0 ? WHITE : S(p.R, i % 2 ? 0.8 : 0.95);
      P.line(cx + Math.cos(q) * r0, cy + Math.sin(q) * r0 * up, cx + Math.cos(q) * (r0 + Li), cy + Math.sin(q) * (r0 + Li) * up, c, 2);
    }
  },
  /** Thrust: a spear driven along the blow, its leaf head bright, its shaft trailing back. */
  mlSpear(v, P, p) {
    const fr = Math.floor(p.age * 12); if (fr > 4) return;
    const ext = [0.55, 1, 1, 0.7, 0.35][fr], back = (1 - ext) * 0.35;
    const tx0 = p.x - p.ux * back, ty0 = p.y - p.uy * back, [tx, ty] = v.ap(tx0, ty0, p.z), [bx, by] = v.ap(tx0 - p.ux * p.len, ty0 - p.uy * p.len, p.z);
    const dx = tx - bx, dy = ty - by, l = Math.hypot(dx, dy) || 1, ux = dx / l, uy = dy / l, hl = 6 * p.sc, hw = 1.7 * p.sc, a = fr > 3 ? 0.5 : 1;
    // the shaft
    P.line(bx, by, tx - ux * hl, ty - uy * hl, null, 1, a, (f) => (f < 0.25 ? null : S(p.R, 0.45 + f * 0.15)));
    if (fr < 2) P.line(bx + uy * 2, by - ux * 2, tx - ux * hl + uy * 2, ty - uy * hl - ux * 2, null, 0, 0.6, (f) => (f > 0.4 && (Math.floor(f * 12) % 2) ? S(p.R, 0.6) : null));
    // the head: a leaf, widest a third of the way back from the point
    ribbon(P, [[tx - ux * hl, ty - uy * hl], [tx, ty]], (f) => hw * Math.sin(Math.PI * Math.min(1, (f * 0.75 + 0.25))) * (1 - f * 0.6), (f, e) => (f > 0.8 && fr === 1 ? WHITE : e < 0.5 ? S(p.R, 1) : S(p.R, 0.72)));
  },
  /** Sweep: a wide flat arc round the wielder at waist height, its head bright, its tail breaking up. */
  mlSwath(v, P, p) {
    const fr = Math.floor(p.age * 12); if (fr > 5) return;
    const head = [0.5, 1, 1, 1, 1, 1][fr], tail = [0, 0, 0.35, 0.6, 0.8, 0.92][fr], N = Math.max(12, Math.ceil(p.r * v.aps * p.span * 1.6));
    for (let i = 0; i <= N; i++) {
      const f = i / N; if (f < tail || f > head) continue;
      const q = p.q0 + p.dir * f * p.span, [x, y] = v.ap(p.x + Math.cos(q) * p.r, p.y + Math.sin(q) * p.r, p.z), lead = head - f;
      const back = Math.sin(q) < -0.2 && v.kind === "side";
      if (lead < 0.1 && fr < 2) { for (let k = 0; k < p.th + 1; k++) P.px(x, y - k + 1, fr === 1 || p.edge ? WHITE : S(p.R, 1), 2); continue; }
      const old = f - tail < 0.22;
      for (let k = 0; k < p.th; k++) {
        const c = k === 0 ? S(p.R, back ? 0.62 : 0.95) : S(p.R, back ? 0.45 : old ? 0.6 : 0.78);
        if (old && (Math.floor(x) + Math.floor(y) + k) % 2) continue;
        P.px(x, y - k + 1, c, 1);
      }
    }
  },
  /** Stab: a short knife jab, in and out in two frames. */
  mlShiv(v, P, p) {
    const fr = Math.floor(p.age * 12); if (fr > 2) return;
    const ext = [1, 0.45, 0.15][fr], back = (1 - ext) * 0.25;
    const ex = p.x - p.ux * back, ey = p.y - p.uy * back, [tx, ty] = v.ap(ex, ey, p.z), [bx, by] = v.ap(ex - p.ux * p.len, ey - p.uy * p.len, p.z);
    ribbon(P, [[bx, by], [tx, ty]], (f) => (f > 0.7 ? 1.1 * p.sc * (1 - f) / 0.3 : 0.3), (f) => (f > 0.85 && fr === 0 ? WHITE : f > 0.6 ? S(p.R, 1) : (Math.floor(f * 9) % 2 ? S(p.R, 0.62) : null)));
  },
  /** Peck: a pick's narrow spike swinging down round its grip onto one point. */
  mlPick(v, P, p) {
    const fr = frame(p); if (fr > 4) return;
    const [cx, cy] = v.ap(p.x, p.y, p.z), sx = sideOf(v, p) * (p.flip ?? 1), sc = p.sc, up = UP(v);
    const px = cx - sx * 9 * sc, py = cy - 9 * sc * up, rx = cx - px, ry = cy - py, ang = [-1.5, -0.65, 0, 0, 0][fr] * sx;
    const hx = px + rx * Math.cos(ang) - ry * Math.sin(ang), hy = py + rx * Math.sin(ang) + ry * Math.cos(ang);
    // the spike points along its swing (the tangent), the haft runs back to the grip
    let tx = -(hy - py), ty = hx - px; const tl = Math.hypot(tx, ty) || 1; tx = (tx / tl) * sx; ty = (ty / tl) * sx;
    const a = tailA(fr, 5), L = 8 * sc;
    P.line(px, py, hx, hy, S(p.R, 0.45), 1, a);
    ribbon(P, [[hx - tx * L * 0.35, hy - ty * L * 0.35], [hx + tx * L * 0.65, hy + ty * L * 0.65]], (f) => 1.4 * sc * (1 - f) + 0.1, (f, e) => (f > 0.8 && fr === 2 ? WHITE : e < 0.5 ? S(p.R, 1) : S(p.R, 0.68)));
    if (fr < 2) for (let k = 1; k <= 4; k++) {
      const q = ang - sx * 0.22 * k, ax = px + rx * Math.cos(q) - ry * Math.sin(q), ay = py + rx * Math.sin(q) + ry * Math.cos(q);
      P.dot(ax, ay, S(p.R, 0.7), 0.6);
    }
  },
  /** Flail: a spiked head whirled round the hand on its chain, then flung into the body. */
  mlFlail(v, P, p) {
    const fr = frame(p); if (fr > 6) return;
    const [hx, hy] = v.ap(p.fx, p.fy, p.fz), [tx, ty] = v.ap(p.x, p.y, p.z), sc = p.sc, R = 12 * sc, a = tailA(fr, 7);
    const orbit = (k) => { const q = p.q0 + k * 2.3; return [hx + Math.cos(q) * R, hy + Math.sin(q) * R * 0.65 - 2 * sc]; };
    let bx, by;
    if (fr < 3) [bx, by] = orbit(fr);
    else { const back = [0, 0, 0, 0, 0.12, 0.2, 0.26][fr]; bx = tx + (hx - tx) * back; by = ty + (hy - ty) * back + (fr > 3 ? (fr - 3) * 1.5 : 0); }
    if (fr < 3) for (let k = 1; k <= 5; k++) { const [ox, oy] = orbit(fr - k * 0.12); P.dot(ox, oy, S(p.R, 0.62), 0.7); }
    P.line(hx, hy, bx, by, null, 0, a, (_f, i) => (i % 2 ? S(p.R, 0.72) : S(p.R, 0.42)));
    const r = 3.4 * sc, hero = fr === 3;
    blobAt(P, bx, by, r, r, (dx, dy, e) => (hero ? (e > 0.5 ? WHITE : S(p.R, 1)) : e > 0.6 ? S(p.R, 0.55) : dx + dy < -0.3 ? S(p.R, 1) : S(p.R, 0.8)), 1);
    const sp = fr % 2 ? [[1, 1], [-1, 1], [1, -1], [-1, -1]] : [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (const [dx, dy] of sp) for (let k = 0; k < 2; k++) P.dot(bx + dx * (r + 1 + k), by + dy * (r + 1 + k), S(p.R, 0.95), a, 1);
  },
  /** Lash: a whip unrolling from the hand; a wave runs down it and its tip cracks. */
  mlWhip(v, P, p) {
    const fr = frame(p); if (fr > 6) return;
    const [hx, hy] = v.ap(p.fx, p.fy, p.fz), [tx, ty] = v.ap(p.x, p.y, p.z);
    let dx = tx - hx, dy = ty - hy; const len = Math.hypot(dx, dy) || 1; dx /= len; dy /= len;
    let nx = -dy, ny = dx; if (ny > 0 || (ny === 0 && nx < 0)) { nx = -nx; ny = -ny; }
    nx *= p.flip ?? 1; ny *= p.flip ?? 1;
    const [ext, amp, waves] = [[0.42, 0.45, 1], [0.72, 0.32, 1], [0.92, 0.16, 2], [1.04, 0.06, 3], [0.97, -0.08, 1], [0.82, -0.12, 1], [0.62, -0.1, 1]][fr];
    const pts = [];
    for (let i = 0; i <= 16; i++) {
      const u = i / 16, o = len * amp * Math.sin(Math.PI * u * waves) * (waves > 1 ? u : 1);
      pts.push([hx + dx * len * ext * u + nx * o, hy + dy * len * ext * u + ny * o]);
    }
    const a = tailA(fr, 7), th = p.thick;
    ribbon(P, pts, (f) => th * (1.1 * (1 - f) + 0.15), (f, e) => {
      const c = f > 0.82 ? S(p.R, 1) : e < 0.45 ? S(p.R, 0.85) : S(p.R, 0.62);
      return a < 1 ? { c, a } : c;
    });
    const [ex, ey] = pts[16];
    if (fr === 3) {
      P.px(ex, ey, WHITE, 2);
      for (let k = 1; k <= 3; k++) {
        const c = k < 3 ? WHITE : S(p.R, 1);
        P.px(ex + k, ey + k, c, 2); P.px(ex - k, ey - k, c, 2); P.px(ex + k, ey - k, c, 2); P.px(ex - k, ey + k, c, 2);
        if (k < 3) { P.px(ex + k + 1, ey, S(p.R, 1), 2); P.px(ex - k - 1, ey, S(p.R, 1), 2); P.px(ex, ey - k - 1, S(p.R, 1), 2); P.px(ex, ey + k + 1, S(p.R, 1), 2); }
      }
    } else if (fr === 4) for (const [ox, oy] of [[5, 0], [-5, 0], [0, 4], [0, -4], [4, 3], [-4, -3]]) P.px(ex + ox, ey + oy, S(p.R, 0.85), 1);
  },
  /** Fist: a knuckled fist punched in along the blow, squashing on contact. */
  mlKnuckle(v, P, p) {
    const fr = Math.floor(p.age * 12); if (fr > 4) return;
    const [cx, cy0] = v.ap(p.x, p.y, p.z), sx = sideOf(v, p), sc = p.sc, cy = cy0 + (p.dy ?? 0) * sc;
    const back = [8, 0, 2, 3, 3][fr] * sc, sq = fr === 1 ? 0.75 : 1, w = Math.round(6 * sc * sq), h = Math.round(5 * sc / sq), a = tailA(fr, 5);
    const lead = Math.round(cx - sx * back), y0 = Math.round(cy - h / 2);
    for (let i = 0; i < w; i++) for (let j = 0; j < h; j++) {
      const x = lead - sx * i;
      let c;
      if (i === 0) c = j % 2 && j < h - 1 ? S(p.R, 0.7) : fr === 1 ? WHITE : S(p.R, 1);
      else if (j === 0) c = S(p.R, 0.9);
      else if (j === h - 1) c = S(p.R, 0.5);
      else if (j === Math.round(h * 0.6) && i > w * 0.4) c = S(p.R, 0.55);
      else c = S(p.R, 0.75);
      P.dot(x, y0 + j, c, a, 1);
    }
    if (fr === 0) for (let k = 0; k < 3; k++) P.line(lead - sx * (w + 1), y0 + k * (h / 2), lead - sx * (w + 1 + 6 * sc), y0 + k * (h / 2), S(p.R, 0.65), 0, 0.8);
  },
  /** A small ring popping out from a knuckle hit or a puncture, standing. */
  mlPop(v, P, p) {
    const fr = Math.floor(p.age * 12); if (fr > 2) return;
    const [cx, cy] = v.ap(p.x, p.y, p.z), r = p.r * [1.5, 2.5, 3.3][fr];
    P.ellipse(cx, cy, r, r * 0.85, () => (fr === 0 ? WHITE : S(p.R, fr === 1 ? 0.95 : 0.75)), 2);
  },
  /** Bash: a heater shield driven face-first into the body. */
  mlShield(v, P, p) {
    const fr = frame(p); if (fr > 5) return;
    const [cx, cy] = v.ap(p.x, p.y, p.z), sx = sideOf(v, p), sc = p.sc, a = tailA(fr, 6);
    const back = [13, 5, 0, 1, 2, 2][fr] * sc, w = Math.round(5.5 * sc), h = Math.round(13 * sc * UP(v)), hero = fr === 2;
    const sxc = Math.round(cx - sx * (back + w * 0.6)), y0 = Math.round(cy - h * 0.5);
    for (let j = 0; j <= h; j++) {
      const hw = j < h * 0.55 ? w : Math.round(w * (1 - (j - h * 0.55) / (h * 0.45 + 0.5)));
      for (let i = -hw; i <= hw; i++) {
        const rim = Math.abs(i) >= hw - 0.5 || j === 0;
        const c = rim ? (hero ? WHITE : S(p.R, 1)) : Math.abs(i) < 1 ? S(p.R, 0.92) : i * sx > 0 ? S(p.R, 0.72) : S(p.R, 0.56);
        P.dot(sxc + i, y0 + j, c, a, 1);
      }
    }
    P.px(sxc, y0 + Math.round(h * 0.35), hero ? WHITE : S(p.R, 1), 1);
    if (hero) P.line(cx - sx, cy - h * 0.7, cx - sx, cy + h * 0.6, WHITE, 2);
    if (fr < 2) for (let k = 0; k < 3; k++) P.line(sxc - sx * (w + 2), y0 + h * (0.2 + k * 0.25), sxc - sx * (w + 2 + 7 * sc), y0 + h * (0.2 + k * 0.25), S(p.R, 0.62), 0, 0.8);
  },
  /** Rake: one claw gash. A tapered stroke with a hot core, drawn down in two frames, left as a torn line. */
  mlGash(v, P, p) {
    const fr = Math.floor(p.age * 12); if (fr > 7) return;
    const [cx, cy] = v.ap(p.x, p.y, p.z), L = p.L, up = UP(v), fl = p.flip, off = p.lane * p.gap;
    const x0 = cx - L * 0.4 * fl + off, y0 = cy - L * 0.5 * up + Math.abs(p.lane) * 1.5, x1 = cx + L * 0.4 * fl + off, y1 = cy + L * 0.5 * up - Math.abs(p.lane) * 1.5;
    const show = fr === 0 ? 0.6 : 1, tear = fr >= 3, erode = tear ? (fr - 3) / 5 : 0;
    const nx = -(y1 - y0) / L, ny = (x1 - x0) / L, pts = [];
    for (let i = 0; i <= 6; i++) { const u = (i / 6) * show, b = 1.6 * Math.sin(Math.PI * u); pts.push([x0 + (x1 - x0) * u + nx * b, y0 + (y1 - y0) * u + ny * b]); }
    if (tear) {
      ribbon(P, pts, () => 0.35, (f) => (f < erode ? null : S(p.tear, f > 0.5 ? 0.7 : 0.55)), 1);
      return;
    }
    ribbon(P, pts, (f) => p.w * Math.sin(Math.PI * (0.06 + 0.88 * f)) ** 0.7, (f, e) => (e < 0.45 ? (fr <= 1 ? WHITE : S(p.R, 1)) : e < 0.8 ? S(p.R, 0.85) : S(p.R, 0.6)));
  },
  /** Jaws: two curved rows of fangs snap shut, interlocking, with a white bite line. */
  mlFangs(v, P, p) {
    const fr = frame(p); if (fr > 5) return;
    const [cx, cy] = v.ap(p.x, p.y, p.z), sc = p.sc * 1.15, w = Math.round(9 * sc), gap = [9, 4, 0, 0, 0, 0][fr] * sc * UP(v) + (fr > 3 ? 1 : 0);
    const a = tailA(fr, 6), n = p.n ?? 3, hero = fr === 2;
    for (const row of [-1, 1]) {
      const yb = (dx) => cy + row * (gap + 2 + 2.5 * (dx / w) ** 2);
      // the gum: a lip curving back at the corners
      for (let dx = -w - 1; dx <= w + 1; dx++) { P.dot(cx + dx, yb(dx) + row, S(p.R, 0.5), a, 1); P.dot(cx + dx, yb(dx), S(p.R, 0.75), a, 1); }
      const count = row < 0 ? n : n - 1;
      for (let i = 0; i < count; i++) {
        const fx = row < 0 ? cx - w + ((2 * w) / n) * (i + 0.5) : cx - w + ((2 * w) / n) * (i + 1), t = Math.abs(fx - cx) / w;
        const fl = Math.round(sc * (row < 0 ? 4 + 2.5 * t : 3.5 + 2 * t)), hb = 1.6 * sc, by = yb(fx - cx);
        for (let j = 0; j <= fl; j++) {
          const hw = hb * (1 - j / (fl + 1)), y = by - row * j;
          for (let i2 = Math.floor(-hw); i2 <= Math.ceil(hw); i2++) {
            if (Math.abs(i2) > hw + 0.25) continue;
            const c = j >= fl - 1 ? (hero ? WHITE : S(p.R, 1)) : i2 < 0 ? S(p.R, 0.95) : S(p.R, 0.72);
            P.dot(fx + i2, y, c, a, 1);
          }
        }
      }
    }
    if (hero) P.line(cx - w + 1, cy, cx + w - 1, cy, WHITE, 2);
  },
  /** Gore: a curved horn lunging in low, then hooking up and tossing. */
  mlHorn(v, P, p) {
    const fr = frame(p); if (fr > 4) return;
    const [cx, cy] = v.ap(p.x, p.y, p.z), sx = sideOf(v, p), sc = p.sc, up = UP(v), L = 17 * sc, a = tailA(fr, 5);
    const back = [13, 2, -1, -2, -3][fr] * sc, rise = [0, 0, 5, 9, 11][fr] * sc * up, tilt = [0.1, 0, -0.75, -1.05, -1.15][fr];
    const bx = cx - sx * (back + L * 0.8), by = cy - rise + 2 * sc, pts = [[bx, by]];
    let x = bx, y = by;
    for (let i = 1; i <= 8; i++) {
      const u = i / 8, q = tilt - 0.65 * u;
      x += sx * Math.cos(q) * (L / 8); y += Math.sin(q) * (L / 8); pts.push([x, y]);
    }
    ribbon(P, pts, (f) => 3.2 * sc * (1 - f) ** 0.9 + 0.15, (f, e, side) => {
      const c = f > 0.84 ? (fr === 1 ? WHITE : S(p.R, 1)) : e > 0.7 ? S(p.R, 0.5) : side * sx < 0 ? S(p.R, 0.95) : S(p.R, 0.72);
      return a < 1 ? { c, a } : c;
    });
    if (fr === 0) for (let k = 0; k < 2; k++) P.line(bx - sx * 2, by - 2 + k * 5, bx - sx * (2 + 8 * sc), by - 2 + k * 5, S(p.R, 0.6), 0, 0.8);
    // the toss: a dim arc swept up from the contact point, a quarter circle round the horn's base
    if (fr >= 2 && fr <= 3) for (let k = 0; k < 7; k++) {
      const q = (k / 6) * (Math.PI / 2), r = 11 * sc;
      P.dot(bx + sx * Math.cos(q) * r, by - Math.sin(q) * r * up, S(p.R, 0.62), fr === 2 ? 0.8 : 0.45);
    }
  },
  /** Sting: a barbed stinger jabbing down from above and behind, in and out. */
  mlBarb(v, P, p) {
    const fr = frame(p); if (fr > 3) return;
    const [cx, cy] = v.ap(p.x, p.y, p.z), sx = sideOf(v, p), sc = p.sc * 1.25, up = UP(v), L = 16 * sc;
    let ux = sx * 0.62, uy = 0.78 * up; const ul = Math.hypot(ux, uy); ux /= ul; uy /= ul;
    const ext = [0.6, 1, 0.5, 0.2][fr], tx = cx - ux * (1 - ext) * L * 0.5, ty = cy - uy * (1 - ext) * L * 0.5;
    // the tail it hangs from: a curve back up and over
    const pts = [];
    for (let i = 0; i <= 6; i++) { const u = i / 6, bend = Math.sin(Math.PI * u) * 3 * sc; pts.push([tx - ux * L * (1 - u) - sx * bend * 0.4, ty - uy * L * (1 - u) - bend]); }
    const a = tailA(fr, 4);
    ribbon(P, pts, (f) => 0.9 * sc * (0.6 + 0.4 * (1 - f)), (_f, e) => { const c = e < 0.5 ? S(p.R, 0.62) : S(p.R, 0.45); return a < 1 ? { c, a } : c; });
    // the head: a dark bulb and a bright needle, with a barb off its back
    const hx = tx - ux * 4 * sc, hy = ty - uy * 4 * sc;
    blobAt(P, hx, hy, 2 * sc, 2 * sc, (_dx, _dy, e) => (e > 0.55 ? S(p.R, 0.45) : S(p.R, 0.7)), 1);
    ribbon(P, [[hx, hy], [tx, ty]], (f) => 1.2 * sc * (1 - f) + 0.1, (f) => (f > 0.7 && fr === 1 ? WHITE : S(p.R, 1)));
    P.line(hx + ux * 1.5 * sc, hy + uy * 1.5 * sc, hx + ux * 1.5 * sc - sx * 2 * sc, hy + uy * 1.5 * sc + 1.5 * sc, S(p.R, 0.9), 1, a);
  },
  /** Stomp: a hoof dropping onto the ground, squashing wide on contact. */
  mlHoof(v, P, p) {
    const fr = frame(p); if (fr > 5) return;
    const [gx, gy] = v.ap(p.x, p.y, 0), sc = p.sc, up = UP(v), lift = [34, 15, 0, 0, 0, 0][fr] * sc * up, flat = fr === 2 ? 1.3 : 1;
    const w = Math.round(7.5 * sc * flat), h = Math.round((10 * sc) / flat), a = tailA(fr, 6), by = Math.round(gy - lift);
    for (let j = 0; j < h; j++) for (let i = -w; i <= w; i++) {
      const e = Math.abs(i) / w;
      if ((j >= h - 3 && e > 0.72 - (j - h + 3) * 0.12) || (j === 0 && e > 0.9)) continue;
      if (j < 4 && Math.abs(i) < 1) continue; // cloven
      const c = j < 2 ? (fr === 2 ? WHITE : S(p.R, 0.5)) : j === h - 1 ? S(p.R, 0.92) : i < -w * 0.3 ? S(p.R, 0.82) : S(p.R, 0.64);
      P.dot(gx + i, by - j, c, a, 1);
    }
    // the leg above it, and speed lines while it falls
    if (fr < 4) for (let j = h; j < h + 6 * sc; j++) for (let i = -Math.round(w * 0.45); i <= Math.round(w * 0.45); i++) P.dot(gx + i, by - j, i < 0 ? S(p.R, 0.7) : S(p.R, 0.55), a * (1 - (j - h) / (6 * sc)), 1);
    if (fr < 2) for (const k of [-1, 1]) P.line(gx + k * (w + 2), by - h, gx + k * (w + 2), by - h - 9 * sc, S(p.R, 0.7), 0, 0.8);
  },
  /** Ground cracks from a stomp: jagged lines out from the impact, lying on the floor. */
  mlCracks(v, P, p) {
    const fr = Math.floor(p.age * 12), u = p.age / p.life, a = fadeOut(u, 0.55), grow = Math.min(1, (fr + 1) / 3), [cx, cy] = v.ap(p.x, p.y, 0), r = p.r * v.aps;
    for (let i = 0; i < 7; i++) {
      const q = (i / 7) * TAU + hash(i, p.seed) * 0.5, L = r * (0.55 + 0.45 * hash(i, p.seed, 1)) * grow, q2 = q + (hash(i, p.seed, 2) - 0.5) * 0.8;
      const mx = cx + Math.cos(q) * L * 0.5, my = cy + Math.sin(q) * L * 0.5 * v.sq, ex = mx + Math.cos(q2) * L * 0.5, ey = my + Math.sin(q2) * L * 0.5 * v.sq;
      P.line(cx, cy, mx, my, S(p.R, 0.85), 0, a);
      P.line(mx, my, ex, ey, S(p.R, 0.62), 0, a);
    }
  },
  /** Buffet: a wing flapping down through the body, a fan of feathers off a bony leading edge. */
  mlWing(v, P, p) {
    const fr = frame(p); if (fr > 4) return;
    const [px0, py0] = v.ap(p.x, p.y, p.z), sx = sideOf(v, p), sc = p.sc, up = UP(v), a = tailA(fr, 5);
    const base = [-1.9, -1.15, -0.35, 0.25, 0.55][fr], armA = base * 0.7;
    const ax = px0 + sx * Math.cos(armA) * 8 * sc, ay = py0 + Math.sin(armA) * 8 * sc * up;
    P.line(px0, py0, ax, ay, S(p.R, 0.9), 1, a);
    P.line(px0, py0 + 1, ax, ay + 1, S(p.R, 0.6), 1, a);
    for (let i = 0; i < 7; i++) {
      // primaries fan off the wrist, longest in the middle; the coverts along the arm are shorter
      const q = base + (i - 1) * 0.24, Lf = (11 + 8 * Math.sin((i / 6) * Math.PI)) * sc;
      const ox = px0 + (ax - px0) * Math.min(1, 0.45 + i * 0.15), oy = py0 + (ay - py0) * Math.min(1, 0.45 + i * 0.15);
      const ex = ox + sx * Math.cos(q) * Lf, ey = oy + Math.sin(q) * Lf * up;
      const hero = fr === 2 && i === 3;
      P.line(ox, oy, ex, ey, null, 1, a, (f) => (f > 0.7 ? (hero ? WHITE : S(p.R, 1)) : S(p.R, 0.78)));
      P.line(ox, oy + 1, ex, ey + 1, null, 1, a, (f) => (f < 0.8 ? S(p.R, 0.55) : null));
    }
    if (fr === 2) for (let k = 0; k < 3; k++) P.dot(ax + sx * (16 + k * 3) * sc, ay + (k - 1) * 5 * sc, S(p.R, 0.75), 0.7);
  },
  /** A gust: a wind line with a curl at its head, carried along its velocity. */
  mlGust(v, P, p) {
    const [hx, hy] = v.ap(p.x, p.y, p.z), [tx, ty] = v.ap(p.x - p.vx * 0.08, p.y - p.vy * 0.08, p.z), a = fadeOut(p.age / p.life, 0.5), sx = hx >= tx ? 1 : -1;
    P.line(tx, ty, hx, hy, null, 0, a, (f) => (f > 0.55 ? S(p.R, 0.95) : Math.floor(f * 10) % 2 ? S(p.R, 0.7) : null));
    P.dot(hx + sx, hy - 1, S(p.R, 0.95), a); P.dot(hx + sx, hy - 2, S(p.R, 0.8), a); P.dot(hx, hy - 3, S(p.R, 0.7), a);
  },
  /** A loose feather rocking as it falls. */
  mlPlume(v, P, p) {
    if (v.lod) return;
    let [x, y] = v.ap(p.x, p.y, p.z); [x, y] = snapH(p, v, x, y);
    const f = (Math.floor(p.age * 12) + Math.floor(p.seed * 4)) % 4, a = fadeOut(p.age / p.life, 0.7), d = [[1, -1], [1, 0], [1, 1], [1, 0]][f];
    for (let k = -2; k <= 1; k++) P.dot(x + d[0] * k, y + d[1] * k, k === 1 ? S(p.R, 1) : S(p.R, 0.72), a, 1);
  },
  /** Slam: a big blunt mass driving in, squashing flat against the body, a white leading face. */
  mlSlab(v, P, p) {
    const fr = frame(p); if (fr > 5) return;
    const [cx, cy] = v.ap(p.x, p.y, p.z), [dx, dy] = sdir(v, p), sc = p.sc, a = tailA(fr, 6);
    const back = [15, 6, 0, 2, 3, 3][fr] * sc, sq = fr === 2 ? 1.4 : fr === 3 ? 1.12 : 1, r = 9 * sc, ra = r / sq, rp = r * sq;
    const mx = cx - dx * (back + ra * 0.85), my = cy - dy * (back + ra * 0.85);
    // the limb behind the mass, back toward whatever swung it
    const lx = mx - dx * (ra + 12 * sc), ly = my - dy * (ra + 12 * sc) - 3 * sc * UP(v);
    if (fr < 4) ribbon(P, [[lx, ly], [mx - dx * ra * 0.3, my - dy * ra * 0.3]], (f) => r * (0.4 + 0.25 * f), (_f, e, side) => {
      const c = e > 0.75 ? S(p.R, 0.42) : side * dx > 0 ? S(p.R, 0.72) : S(p.R, 0.58);
      return a < 1 ? { c, a } : c;
    });
    P.shade(mx - r * 1.6, my - r * 1.6, mx + r * 1.6, my + r * 1.6, (x, y) => {
      const rx = x - mx, ry = y - my, al = rx * dx + ry * dy, pe = rx * -dy + ry * dx, e = (al / ra) ** 2 + (pe / rp) ** 2;
      if (e > 1) return null;
      let c;
      if (al > ra * 0.55) c = fr === 2 ? WHITE : S(p.R, 1);
      else if (e > 0.72) c = S(p.R, 0.48);
      else c = ry < -r * 0.25 ? S(p.R, 0.88) : S(p.R, 0.7);
      return a < 1 ? { c, a } : c;
    }, 1);
    if (fr < 2) for (let k = -1; k <= 1; k++) {
      const ox = mx - dx * (ra + 2) + -dy * k * rp * 0.55, oy = my - dy * (ra + 2) + dx * k * rp * 0.55;
      P.line(ox, oy, ox - dx * 8 * sc, oy - dy * 8 * sc, S(p.R, 0.62), 0, 0.8);
    }
  },
  /** Pincer: two curved blades hinged behind the body, scissoring shut on it. */
  mlPincer(v, P, p) {
    const fr = frame(p); if (fr > 4) return;
    const [cx, cy] = v.ap(p.x, p.y, p.z), [dx, dy] = sdir(v, p), sc = p.sc * 1.2, L = 15 * sc, open = [1.0, 0.5, 0, 0, 0][fr], a = tailA(fr, 5);
    const hx = cx - dx * L * 0.8, hy = cy - dy * L * 0.8, th = Math.atan2(dy, dx);
    for (const sgn of [-1, 1]) {
      const pts = [[hx, hy]]; let x = hx, y = hy;
      for (let i = 1; i <= 8; i++) { const u = i / 8, q = th + sgn * (open + 0.55 - 1.2 * u); x += Math.cos(q) * (L / 8); y += Math.sin(q) * (L / 8); pts.push([x, y]); }
      ribbon(P, pts, (f) => 2.4 * sc * Math.sin(Math.PI * (0.18 + 0.82 * f)) ** 0.6 + 0.1, (f, e, side) => {
        const inner = side * sgn > 0;
        const c = f > 0.86 ? (fr === 2 ? WHITE : S(p.R, 1)) : e > 0.65 ? (inner && Math.floor(f * 16) % 2 ? S(p.R, 0.4) : S(p.R, 0.55)) : sgn < 0 ? S(p.R, 0.92) : S(p.R, 0.74);
        return a < 1 ? { c, a } : c;
      });
    }
    blobAt(P, hx, hy, 2 * sc, 2 * sc, (_x, _y, e) => (e > 0.5 ? S(p.R, 0.45) : S(p.R, 0.8)), 1);
    if (fr === 2) for (const [ox, oy] of [[0, 0], [2, 0], [-2, 0], [0, 2], [0, -2], [3, -3], [-3, 3]]) P.px(cx + ox, cy + oy, WHITE, 2);
  },
  /** Grasp: an open hand coming down over the body, its fingers curling shut. */
  mlHand(v, P, p) {
    const fr = frame(p); if (fr > 7) return;
    const [cx, cy] = v.ap(p.x, p.y, p.z), sx = sideOf(v, p), sc = p.sc * 1.45, up = UP(v), a = tailA(fr, 8);
    const drop = [-6, -2, 0, 0, 0, 0, 0, 0][fr] * sc, pulse = fr === 4 ? 1 : 0;
    const pcx = cx, pcy = cy - 6 * sc * up + drop;
    blobAt(P, pcx, pcy, 4.5 * sc - pulse * 0.5, 3.6 * sc, (dx, dy, e) => { const c = e > 0.7 ? S(p.R, 0.5) : dx * sx + dy < -0.4 ? S(p.R, 0.95) : S(p.R, 0.75); return a < 1 ? { c, a } : c; }, 1);
    const spread = [1, 0.6, 0.28, 0.2, 0.15, 0.2, 0.2, 0.2][fr], closed = fr >= 2;
    for (let i = 0; i < 4; i++) {
      const bx = pcx + (i - 1.5) * 2.3 * sc, by = pcy + 2.8 * sc, q = Math.PI / 2 + (i - 1.5) * 0.45 * spread;
      const l1 = (closed ? 4.5 : 7.5) * sc * up, mx = bx + Math.cos(q) * l1, my = by + Math.sin(q) * l1;
      const ex = closed ? mx + (cx - mx) * 0.45 : mx, ey = closed ? my + 1.5 * sc : my;
      for (const o of [0, 1]) { P.line(bx + o, by, mx + o, my, S(p.R, 0.8), 1, a); P.line(mx + o, my, ex + o, ey, S(p.R, 0.8), 1, a); }
      P.dot(ex, ey, fr === 2 ? WHITE : S(p.R, 1), a, 1);
    }
    // the thumb, out to the wielder's side
    const tq = closed ? 0.4 : 0.9, tbx = pcx - sx * 4.5 * sc, tby = pcy + sc;
    P.line(tbx, tby, tbx - sx * Math.cos(tq) * 5 * sc, tby + Math.sin(tq) * 5 * sc, S(p.R, 0.85), 1, a);
    if (fr >= 2 && fr <= 4) for (const k of [-1, 1]) P.line(cx + k * (7 * sc + 2), cy - 2, cx + k * (7 * sc + 4), cy - 2, S(p.R, 0.9), 0, 0.8);
  },
  /** Squeeze: a coil wrapping down the body and tightening in pulses; the back of each loop is dim. */
  mlCoil(v, P, p) {
    const fr = frame(p); if (fr >= p.frames) return;
    const pulses = p.pulses.filter((k) => k <= fr).length, hit = p.pulses.includes(fr);
    const tight = 1 - 0.05 * Math.min(fr, 3) - 0.05 * pulses - (hit ? 0.12 : 0), r = p.r * Math.max(0.55, tight);
    const wrap = Math.min(1, (fr + 1) / 3), loops = 2.25, a = fr >= p.frames - 2 ? (fr === p.frames - 2 ? 0.6 : 0.3) : 1;
    const N = Math.max(24, Math.ceil(r * v.aps * TAU * loops * 1.3));
    for (const front of [false, true]) {
      for (let i = 0; i <= N * wrap; i++) {
        const u = i / N, q = p.q0 + u * loops * TAU, isFront = Math.sin(q) > 0;
        if (isFront !== front) continue;
        const z = p.z1 - (p.z1 - p.z0) * u, [x, y] = v.ap(p.x + Math.cos(q) * r, p.y + Math.sin(q) * r, z);
        if (front) { P.dot(x, y, hit ? WHITE : S(p.R, 0.92), a, 1); P.dot(x, y + 1, S(p.R, 0.62), a, 1); }
        else P.dot(x, y, S(p.R, 0.45), a * 0.75, 1);
      }
    }
    if (hit) {
      const [lx, ly] = v.ap(p.x - r, p.y, (p.z0 + p.z1) / 2), [rx, ry] = v.ap(p.x + r, p.y, (p.z0 + p.z1) / 2);
      for (const k of [-2, 0, 2]) { P.line(lx - 2, ly + k, lx - 5, ly + k * 1.5, S(p.R, 0.95), 1); P.line(rx + 2, ry + k, rx + 5, ry + k * 1.5, S(p.R, 0.95), 1); }
    }
  },
  /** A faint rune on a magic weapon's stroke. */
  mlRune(v, P, p) {
    const fr = Math.floor(p.age * 12); if (fr > 6) return;
    const [x, y] = v.ap(p.x, p.y, p.z), G = GLYPHS[Math.floor(p.seed) % GLYPHS.length], a = fr < 2 ? 0.9 : 0.9 - (fr - 1) * 0.15;
    for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) if (G[j * 3 + k] === "1") P.dot(x - 1 + k, y - 1 + j, S(p.R, fr === 0 ? 1 : 0.85), a);
  },
});
