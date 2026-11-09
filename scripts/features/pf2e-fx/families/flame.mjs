/**
 * Flame: fire.
 *
 * Benchmarked against pixelfx `explosions/small-explosion` (spellsprite-craft
 * §5): a white flash, a churning ball of fire puffs that boil out and cool
 * through the ramp into smoke, a smoke column, sparks streaking 4–12 squares a
 * second, embers drifting up, burning brands that land and keep burning,
 * tumbling rocks and grit, floor dust rolling out under a shock band, and a
 * scorch that glows white-hot and cools to soot over five seconds.
 *
 * This file also holds the kit the other element families of its batch build
 * on (frost, arc, shock, corrode, umbra import it): the fire puff, the
 * translucent haze, the tumbling rock, grit, the floor band, and the landing
 * physics. Shapes are prefixed `fl`.
 */

import { TAU, clamp, lerp, hash, pnoise } from "../core/rand.mjs";
import { RAMP, S, WHITE } from "../core/palette.mjs";
import { physics } from "../core/sim.mjs";
import { registerShapes, snapH } from "../core/shapes.mjs";
import { sph, sd, still, releaseFlash, counter, flourish } from "../core/motifs.mjs";

/* ── kit: physics ─────────────────────────────────────────────────────── */

/** A flat-biased direction: mostly across the floor, a little up (top view reads spread, Diorama reads height). */
export function flat(s, sp, up = 0.45) {
  const a = s.rand(0, TAU), zc = s.rand(0.05, up), r = Math.sqrt(1 - zc * zc);
  return { vx: Math.cos(a) * r * sp, vy: Math.sin(a) * r * sp, vz: zc * sp };
}

/** Landing: bounce while it is fast, then settle; the first hard landing kicks a little dust. */
export function land(p, s) {
  if (Math.abs(p.vz) > 0.8 && p.bounce) {
    p.z = 0; p.vz = -p.vz * p.bounce; p.vx *= 0.6; p.vy *= 0.6;
    if (!p.dusted && p.kick) { p.dusted = true; kick(s, p.x, p.y, p.kick, 2); }
  } else { p.z = 0; p.vz = 0; p.vx *= 0.55; p.vy *= 0.55; p.rest = true; }
}

/**
 * One eruption among many across an area: a small light, a one-frame flash and
 * one tight ring. releaseFlash's broken outer ring, drawn twenty times across
 * an area, is a lattice of circles that buries the eruptions themselves.
 */
export function subFlash(s, M, x, y, z, pow, rad) {
  const mm = Math.min(1.4, s.m * pow);
  s.light(x, y, z, rad * 2.2 + 0.8, S(M.R, 0.85), (M.dark ? 0.2 : 0.32) * mm, 0.5, { flicker: M.flicker });
  s.add({ k: "flash", x, y, z, life: 1 / 12, r: (rad * 0.6 + 0.35) * s.spec.aps * 0.45, R: M.R, update: still });
  if (pow >= 0.3) s.add({ k: "ring", x, y, r: rad * 1.1 + 0.35, life: 0.3, R: M.R, seed: sd(s), update: still });
}

/** A puff or two of dust where something lands. */
export function kick(s, x, y, R, n) {
  for (let i = 0; i < n; i++) s.add({ k: "flHaze", x: x + s.rand(-0.06, 0.06), y: y + s.rand(-0.04, 0.04), z: 0.03, ...flat(s, s.rand(0.4, 1.4), 0.2), drag: 4, r: s.rand(1.6, 3), life: s.rand(0.35, 0.65), R, tone: 0.67, a: 0.6, grow: 0.8, seed: sd(s), minor: true });
}

/** Rocks spin while they fly and stop when they rest. */
export function rockUpd(p, s, dt) {
  physics(p, dt, s);
  if (!p.rest) p.a += p.va * dt;
  if (p.hot && p.trailR && !p.rest && s.R() < 18 * dt) s.add({ k: "flPuff", x: p.x, y: p.y, z: p.z, vz: 0.3, g: -1, drag: 4, r: s.rand(1.2, 2), life: s.rand(0.16, 0.3), R: p.trailR, hs: s.R(), seed: sd(s), minor: true, update: puffUpd });
}

/** Fire puffs rise and wobble; a puff marked `smokes` leaves smoke behind when it dies. */
export function puffUpd(p, s, dt) {
  p.vx += Math.sin(s.t * 17 + p.seed) * 0.9 * dt;
  physics(p, dt, s);
  if (p.smokes && p.age >= p.life) {
    s.add({ k: "flHaze", x: p.x, y: p.y, z: p.z, vx: p.vx * 0.6, vy: p.vy * 0.6, vz: Math.max(0.15, p.vz * 0.5), g: -0.5, drag: 1.4, r: p.r * s.rand(0.8, 1.05), life: s.rand(1.3, 2.3), R: p.smokeR ?? RAMP.smoke, tone: 0.67, toneEnd: 0.33, a: 0.72, grow: 0.6, seed: p.seed, minor: p.minor });
  }
}

/** Embers: drift up, wander, slow. */
export function emberUpd(p, s, dt) {
  p.vx += Math.cos(s.t * 2.3 + p.seed) * 1.6 * dt;
  p.vy += Math.sin(s.t * 1.9 + p.seed * 0.7) * 1.2 * dt;
  physics(p, dt, s);
}

/** Grit: a fleck thrown up that drops and stops dead. */
export const grit = (s, x, y, z, sp, R, extra) => ({ k: "flGrit", x, y, z, ...flat(s, sp, 0.85), g: 30, drag: 0.8, life: s.rand(1.1, 2), R, t: [0.33, 0.5, 0.5, 0.67][Math.floor(s.R() * 4)], big: s.R() < 0.4, minor: true, ...extra });

/** A tumbling rock: `hot` ones glow down the fire ramp before they cool to stone. */
export const rock = (s, x, y, z, sp, R, extra) => ({ k: "flRock", x, y, z, ...flat(s, sp, 0.9), g: 30, drag: 0.5, bounce: 0.32, life: s.rand(2.2, 3.4), R, sz: 1 + Math.floor(s.R() * 3), a: s.rand(0, TAU), va: s.rand(-16, 16), kick: RAMP.kinetic, onGround: land, update: rockUpd, debris: true, ...extra });

/* ── fire ─────────────────────────────────────────────────────────────── */

/** One fire puff flung out of the fireball. */
const puff = (s, R, x, y, z, sp, r, life, extra) => ({ k: "flPuff", x, y, z, ...flat(s, sp, 0.7), g: -1.4, drag: 3.6, r, life, R, hs: s.R(), seed: sd(s), glow: true, update: puffUpd, ...extra });

const flame = {
  id: "flame",
  burst(s, M, { x, y, z, pow, rad, sub }) {
    const R = M.R, m = s.m * pow, mm = Math.min(1.7, m), n = counter(s, pow, rad), crit = pow > 1.2;
    if (sub) subFlash(s, M, x, y, z, pow, rad); else releaseFlash(s, M, x, y, z, pow, rad);
    const zz = Math.max(0.2, z), body = (rad * 0.55 + 0.25) * (crit ? 1.25 : 1);
    if (sub) {
      // one eruption among many: a knot of puffs, sparks and embers; the area's scar is the area's own
      for (let i = 0, N = n(4); i < N; i++) {
        const a = s.rand(0, TAU), d = s.rand(0, body);
        s.add(puff(s, R, x + Math.cos(a) * d, y + Math.sin(a) * d * 0.8, zz, s.rand(1, 3.5), s.rand(3.5, 6.5) * Math.min(1.3, mm), s.rand(0.45, 0.9), { glow: i === 0, smokes: i % 2 === 0, wait: s.rand(0, 0.05) }));
      }
      for (let i = 0, N = n(12); i < N; i++) s.add({ k: "spark", x, y, z: zz, ...flat(s, s.rand(4, 9), 0.8), g: 16, drag: 2.2, bounce: 0.45, life: s.rand(0.2, 0.55), R, minor: i % 2 === 1 });
      for (let i = 0, N = n(5); i < N; i++) s.add({ k: "ember", x: x + s.rand(-0.4, 0.4) * rad, y: y + s.rand(-0.4, 0.4) * rad, z: zz, ...flat(s, s.rand(0.8, 2.5), 0.9), g: -0.5, drag: 1.6, life: s.rand(1, 2), R, seed: sd(s), update: emberUpd, minor: true });
      return;
    }
    // the fireball: a hot white core, then 25+ puffs boiling out; about half leave smoke when they die
    for (let i = 0; i < 5; i++) s.add(puff(s, R, x + s.rand(-0.08, 0.08), y + s.rand(-0.08, 0.08), zz, s.rand(0.3, 1), (rad * 9 + 7) * Math.min(1.4, mm), s.rand(0.35, 0.6), { hs: 0, slow: 0.55, hero: i === 0 }));
    for (let i = 0, N = n(16); i < N; i++) {
      const a = s.rand(0, TAU), d = s.rand(0, body), sp = s.rand(1.5, 8) * Math.min(1.4, pow);
      s.add(puff(s, R, x + Math.cos(a) * d, y + Math.sin(a) * d * 0.8, zz + s.rand(-0.1, 0.3), sp, s.rand(4.5, 9.5) * Math.min(1.4, mm) * (0.8 + rad * 0.3), s.rand(0.55, 1.15), { glow: i % 3 === 0, slow: 0.75, smokes: s.R() < 0.5, minor: i > 18 && i % 2 === 1, wait: s.rand(0, 0.06) }));
    }
    // the stem: a few hot puffs shoved upward (height in Diorama, a lean on the 2D floor)
    for (let i = 0; i < 5; i++) s.add(puff(s, R, x + s.rand(-0.2, 0.2) * rad, y, zz, 1, s.rand(5, 8) * Math.min(1.4, mm), s.rand(0.8, 1.3), { vx: s.rand(-0.4, 0.4), vy: s.rand(-0.9, -0.3), vz: s.rand(3.5, 6.5), drag: 3, smokes: s.R() < 0.6, wait: s.rand(0, 0.1) }));
    // the smoke column, dark and billowing, arriving as the fire cools
    for (let i = 0, N = n(7); i < N; i++) {
      const a = s.rand(0, TAU), d = s.rand(0, body * 1.2), sp = s.rand(0.5, 3.5);
      s.add({ k: "flHaze", x: x + Math.cos(a) * d, y: y + Math.sin(a) * d * 0.8, z: zz + s.rand(0, 0.3), vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.7 - 0.4, vz: s.rand(0.8, 2), g: -0.6, drag: 1.4, r: s.rand(6, 10) * Math.min(1.4, mm) * (0.8 + rad * 0.3), life: s.rand(1.8, 2.8), R: RAMP.smoke, tone: 0.5, toneEnd: 0.17, a: 0.72, grow: 0.55, seed: sd(s), wait: s.rand(0.12, 0.45), minor: i % 2 === 1 });
    }
    // sparks: a fast spray that streaks, falls and bounces
    for (let i = 0, N = n(45); i < N; i++) s.add({ k: "spark", x, y, z: zz, ...flat(s, s.rand(5, 13) * Math.min(1.3, pow), 0.8), g: 16, drag: 2.2, bounce: 0.45, life: s.rand(0.18, 0.6), R, minor: i % 3 !== 0 });
    // embers lifting off and drifting for seconds
    for (let i = 0, N = n(22); i < N; i++) {
      const a = s.rand(0, TAU);
      s.add({ k: "ember", x: x + Math.cos(a) * body * 0.7, y: y + Math.sin(a) * body * 0.7, z: zz, ...flat(s, s.rand(1.2, 5.5), 0.9), g: -0.9, drag: 1.6, life: s.rand(1.2, 2.6), R, seed: sd(s), update: emberUpd, minor: i % 2 === 1 });
    }
    // burning brands: arc out trailing flame, land and keep burning a moment
    for (let i = 0, N = Math.round(n(4) * Math.max(0.4, pow - 0.3)); i < N; i++) s.add(rock(s, x, y, zz, s.rand(4, 8), RAMP.kinetic, { hot: 1, trailR: R, R2: R, sz: 1, life: s.rand(1.6, 2.4), onGround: brandLand }));
    // rocks and grit thrown up; a third of the rocks still glowing
    for (let i = 0, N = n(14); i < N; i++) s.add(rock(s, x + s.rand(-0.3, 0.3) * rad, y + s.rand(-0.3, 0.3) * rad, 0.1, s.rand(2.5, 7), RAMP.kinetic, { hot: s.R() < 0.35 ? 1 : 0, R2: R, minor: i % 2 === 1 }));
    for (let i = 0, N = n(30); i < N; i++) s.add(grit(s, x + s.rand(-0.3, 0.3) * rad, y + s.rand(-0.3, 0.3) * rad, 0.05, s.rand(2, 7), RAMP.kinetic));
    // floor dust rolling outward under the band
    for (let i = 0, N = n(6); i < N; i++) {
      const a = (i / N) * TAU + s.rand(-0.3, 0.3), sp = s.rand(2, 6.5) * Math.min(1.3, pow);
      s.add({ k: "flHaze", x: x + Math.cos(a) * body * 0.6, y: y + Math.sin(a) * body * 0.6, z: 0.04, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vz: 0.1, drag: 3, r: s.rand(5, 8) * Math.min(1.3, mm), life: s.rand(1.1, 2), R: RAMP.kinetic, tone: 0.5, toneEnd: 0.33, a: 0.5, grow: 0.9, seed: sd(s), wait: 0.03, minor: i % 2 === 1 });
    }
    s.add({ k: "flBand", x, y, r: rad * 1.6 + 1.6 * Math.min(1.3, mm), life: 0.5, R, dust: RAMP.kinetic, th: 2 + rad * 2, update: still });
    // the floor: white-hot, cooling through the ramp to soot; a warm pool while it burns
    s.add({ k: "flScorch", x, y, r: rad * 1.1 + 0.45, life: 5.4, cool: 2.4 + rad, R, seed: sd(s), debris: true, update: still });
    s.light(x, y, 0.1, rad * 1.6 + 1.2, S(R, 0.67), 0.4 * Math.min(1.3, mm), 2.6, { flicker: true });
    flourish(s, M, x, y, z, rad, Math.round(6 * m));
  },
  trail(s, M, { x, y, z, dt, scale = 1 }) {
    // scale: a lobbed fireball sheds a wake its own size, and it lasts long enough to read as a path
    const R = M.R, k = Math.max(1, scale), q = Math.sqrt(k), j = () => s.rand(-0.1, 0.1) * k;
    for (let i = s.count(46 * s.m * q, dt); i > 0; i--) s.add({ k: "flPuff", x: x + j(), y: y + j(), z: z + j(), vx: s.rand(-0.3, 0.3), vy: s.rand(-0.3, 0.3), vz: s.rand(0.2, 0.7), g: -1, drag: 3, r: s.rand(2.6, 4.6) * q, life: s.rand(0.3, 0.55) * (k > 1 ? 1.4 : 1), R, hs: s.R() * 0.5, slow: 0.72, glow: i % 4 === 0, seed: sd(s), smokes: s.R() < 0.25, update: puffUpd, minor: i % 2 === 0 });
    for (let i = s.count(20 * s.m * k, dt); i > 0; i--) s.add({ k: "ember", x: x + j(), y: y + j(), z, vx: s.rand(-0.6, 0.6) * k, vy: s.rand(-0.6, 0.6) * k, vz: s.rand(0, 0.8), g: -0.6, drag: 1.2, life: s.rand(0.6, 1.2), R, seed: sd(s), update: emberUpd, minor: true });
    for (let i = s.count(12 * s.m, dt); i > 0; i--) s.add({ k: "spark", x, y, z, ...flat(s, s.rand(2, 4), 0.6), g: 10, drag: 2.2, life: s.rand(0.15, 0.3), R, minor: true });
    for (let i = s.count((k > 1 ? 7 * k : 4) * s.m, dt); i > 0; i--) s.add({ k: "flHaze", x: x + j(), y: y + j(), z, vz: s.rand(0.2, 0.5), g: -0.2, drag: 1.5, r: s.rand(2.5, 4.2) * q, life: s.rand(0.7, 1.1), R: RAMP.smoke, tone: 0.5, toneEnd: 0.17, a: 0.62, grow: 0.7, seed: sd(s), minor: true });
  },
  linger(s, M, { at, k, dt, x, y, rad, spot }) {
    const R = M.R;
    at(10, () => ({ k: "tongue", h: s.rand(8, 15) * Math.min(1.4, s.m), w: s.rand(2, 3.4), life: s.rand(0.45, 0.85), seed: Math.floor(s.R() * 1000), glow: true, r: 2.5, update: still }));
    at(9, () => ({ k: "flPuff", z: 0.1, vx: s.rand(-0.2, 0.2), vy: s.rand(-0.5, -0.1), vz: s.rand(0.6, 1.4), g: -1, drag: 3, r: s.rand(2.5, 4.5), life: s.rand(0.35, 0.7), hs: s.R(), seed: sd(s), smokes: s.R() < 0.3, update: puffUpd, minor: true }));
    at(7, () => ({ k: "ember", z: 0.2, vz: s.rand(0.6, 1.6), vx: s.rand(-0.4, 0.4), g: -0.4, drag: 1.2, life: s.rand(0.9, 1.7), seed: sd(s), update: emberUpd, minor: true }));
    at(1.6, () => ({ k: "flHaze", z: 0.4, vz: 0.6, vy: -0.2, g: -0.2, drag: 1, r: s.rand(4.5, 7), life: s.rand(1.6, 2.4), R: RAMP.smoke, tone: 0.5, toneEnd: 0.17, a: 0.62, grow: 0.6, seed: sd(s) }));
    // the ground heat: a few flickering pools that come and go
    if (s.R() < 3 * k * dt) { const [px, py] = spot(); s.light(px, py, 0.1, s.rand(0.9, 1.5), S(R, 0.67), 0.4, s.rand(0.5, 0.9), { flicker: true }); }
  },
  spray(s, M, { emit, hand, dir, half, len, dt }) {
    const R = M.R;
    // the breath: puffs pouring out, swelling as they go, cooling to smoke at the far end
    emit("flPuff", 90, () => ({ drag: 1.9, g: -0.8, life: s.rand(0.45, 0.75), r: s.rand(3, 5.5), hs: s.R() * 0.6, slow: 0.85, seed: sd(s), glow: s.R() < 0.08, smokes: s.R() < 0.3, update: puffUpd, grow: true }));
    emit("spark", 45, () => ({ drag: 1.6, g: 6, life: s.rand(0.3, 0.6), minor: true }));
    emit("ember", 26, () => ({ drag: 1.8, g: -0.6, life: s.rand(0.7, 1.2), seed: sd(s), update: emberUpd, minor: true }));
    emit("flHaze", 10, () => ({ drag: 1.8, g: -0.3, life: s.rand(1, 1.5), r: s.rand(4, 6.5), R: RAMP.smoke, tone: 0.5, toneEnd: 0.17, a: 0.6, grow: 0.7, seed: sd(s), minor: true }));
    // heat pools along the stream
    if (s.R() < 6 * dt) { const f = s.rand(0.2, 0.9), q = dir + s.rand(-half, half) * 0.6; s.light(hand[0] + Math.cos(q) * len * f, hand[1] + Math.sin(q) * len * f, 0.3, 0.9 + len * f * 0.3, S(R, 0.83), 0.35, 0.35, { flicker: true }); }
  },
  aura(s, M, { at, T, dt }) {
    at(14, () => ({ k: "tongue", h: s.rand(6, 12), w: s.rand(1.6, 2.6), life: s.rand(0.4, 0.75), seed: Math.floor(s.R() * 1000), update: still }));
    at(6, () => ({ k: "flPuff", vz: s.rand(0.6, 1.2), g: -1, drag: 3, r: s.rand(2, 3.4), life: s.rand(0.3, 0.55), hs: s.R(), seed: sd(s), smokes: s.R() < 0.25, update: puffUpd, minor: true }));
    at(7, () => ({ k: "ember", vz: s.rand(0.7, 1.4), g: -0.6, drag: 1, life: s.rand(0.7, 1.2), seed: sd(s), update: emberUpd }));
    at(1, () => ({ k: "flHaze", z: 1, vz: 0.5, g: -0.1, drag: 1, r: s.rand(3.5, 5), life: 1.7, R: RAMP.smoke, tone: 0.5, toneEnd: 0.17, a: 0.55, grow: 0.6, seed: sd(s) }));
    if (s.R() < 2 * dt) s.light(T.x, T.y, 0.4 * T.h, 1.2 * T.size, S(M.R, 0.83), 0.4, 0.5, { flicker: true });
  },
};

/** A brand that lands keeps burning: a tongue and a short-lived blaze that feeds puffs. */
function brandLand(p, s) {
  p.life = 0;
  const R = p.trailR, life = s.rand(0.9, 1.5);
  s.add({ k: "tongue", x: p.x, y: p.y, z: 0, h: s.rand(5, 8), w: 1.6, life, R, seed: sd(s), glow: true, r: 2, debris: true, update(q, s2, dt) { if (s2.R() < 14 * dt * (1 - q.age / q.life)) s2.add({ k: "flPuff", x: q.x + s2.rand(-0.05, 0.05), y: q.y, z: 0.05, vz: s2.rand(0.5, 1.1), vy: -0.2, g: -1, drag: 3, r: s2.rand(1.4, 2.6), life: s2.rand(0.25, 0.5), R, hs: s2.R(), seed: sd(s2), smokes: s2.R() < 0.3, update: puffUpd, minor: true }); } });
  s.light(p.x, p.y, 0.05, 0.7, S(R, 0.83), 0.35, life, { flicker: true });
}

export default flame;

/* ── kit: shapes ──────────────────────────────────────────────────────── */

registerShapes({
  /**
   * A ball of flame cooling down the ramp as it ages (`hs` jitters its heat): a
   * darker rim, a lit core sitting up and left, a tongue on top, a hot spot
   * while young; past the last steps it thins as a translucent disc.
   */
  flPuff(v, P, p) {
    const k = 1 - clamp(p.age / p.life), age = 1 - k, fr = Math.floor(p.age * 12);
    const heat = Math.min(0.999, age ** 0.62 * (p.slow ?? 1) + (p.hs ?? 0) * 0.12);
    const g = p.grow ? 0.7 + age * 0.9 : (0.55 + 0.45 * Math.min(1, age * 7)) * (1 - age * 0.55);
    const r = p.r * g;
    if (r < 0.6) return;
    let [cx, cy] = v.ap(p.x, p.y, p.z);
    if (r > 3) [cx, cy] = snapH(p, v, cx, cy);
    const R = p.R, t = 1 - heat, st = 1 / 6, white = p.hero && fr === 0;
    if (heat > 0.84) {
      // smouldering: a thin translucent disc in the deep steps
      const c = S(R, t), a = Math.min(1, k * 3) * 0.8;
      P.shade(cx - r - 1, cy - r - 1, cx + r + 1, cy + r + 1, (x, y) => ((x - cx) ** 2 + (y - cy) ** 2 <= r * r ? { c, a } : null), 0, "mix");
      return;
    }
    const tongue = r > 1.6, hot = heat < 0.45 && r > 1.8, r2 = r * r, ri = (r * 0.78) ** 2, rt = (r * 0.42) ** 2, rh = (r * 0.36) ** 2;
    const rim = S(R, t - 2 * st), body = S(R, t), core = S(R, t + st), top = cy - r * 0.9 - r * 0.42 - 1;
    P.shade(cx - r - 1, top, cx + r + 1, cy + r + 1, (x, y) => {
      const dx = x - cx, dy = y - cy, d2 = dx * dx + dy * dy;
      const inT = tongue && dx * dx + (dy + r * 0.9) ** 2 <= rt;
      if (d2 > r2 && !inT) return null;
      if (white) return WHITE;
      if (hot && (dx + r * 0.28) ** 2 + (dy + r * 0.34) ** 2 <= rh) return core;
      if (inT || (dx + r * 0.16) ** 2 + (dy + r * 0.22) ** 2 <= ri) return body;
      return rim;
    }, 1);
  },
  /**
   * A translucent volume (smoke, steam, dust, gas): a soft body, a denser core
   * sitting low, a lit cap while young, a lumpy edge. True translucency
   * (`Pix.mix`), swelling as it ages and walking from `tone` to `toneEnd`.
   */
  flHaze(v, P, p) {
    const u = clamp(p.age / p.life);
    let [cx, cy] = v.ap(p.x, p.y, p.z); [cx, cy] = snapH(p, v, cx, cy);
    const r = p.r * (0.65 + Math.min(1, u * 2.5) * 0.45 + u * (p.grow ?? 0.5));
    const a = Math.min(1, u * 10) * Math.min(1, (1 - u) * 2.4) * (p.a ?? 0.7);
    if (a < 0.12 || r < 1) return;
    const R = p.R, t = lerp(p.tone ?? 0.5, p.toneEnd ?? p.tone ?? 0.5, u), body = S(R, t), cap = S(R, t + 0.17), sh = S(R, t - 0.17);
    const seed = p.seed ?? 1, ro = r * 0.74, ro2 = ro * ro, rc = (r * 0.5) ** 2, capOn = u < 0.5, lump = p.lump ?? 0.28;
    P.shade(cx - r - 1, cy - r - 1, cx + r + 1, cy + r + 1, (x, y) => {
      const dx = x - cx, dy = y - cy, d2 = dx * dx + dy * dy;
      if (d2 > r * r) return null;
      const e = r * (1 - lump + lump * pnoise(Math.atan2(dy, dx), 7, seed));
      if (d2 > e * e) return null;
      if (capOn && (dx + r * 0.22) ** 2 + (dy + r * 0.3) ** 2 <= rc) return { c: cap, a: a * 0.6 * (1 - u * 2) + a * 0.2 };
      const cx2 = dx - r * 0.05, cy2 = dy - r * 0.08;
      if (cx2 * cx2 + cy2 * cy2 <= ro2) return { c: cy2 > ro * 0.45 ? sh : body, a: a * 0.66 };
      return { c: body, a: a * 0.4 };
    }, 0, "mix");
  },
  /** A tumbling rock: a lit side, a shaded side, an outline; a hot one glows down `R2` before it cools to stone. */
  flRock(v, P, p) {
    const [x, y] = v.ap(p.x, p.y, p.z), r = 0.6 + p.sz * 0.75, fade = Math.min(1, (p.life - p.age) / 0.5);
    const lx = Math.cos(p.a), ly = Math.sin(p.a);
    const heat = p.hot ? clamp(1 - p.age / 1.6) : 0, H = p.R2 ?? p.R;
    const light = heat > 0.15 ? S(H, 0.5 + heat * 0.5) : S(p.R, 0.83), bodyC = heat > 0.15 ? S(H, 0.33 + heat * 0.5) : S(p.R, 0.5), shade = heat > 0.4 ? S(H, 0.33) : S(p.R, 0.33);
    P.shade(x - r - 1, y - r - 1, x + r + 1, y + r + 1, (px, py) => {
      const dx = px - x, dy = py - y, d = Math.hypot(dx * 1.15, dy);
      if (d > r + 0.6) return null;
      const lit = (dx * lx + dy * ly) / Math.max(0.5, r);
      const c = d > r - 0.4 ? S(p.R, 0.17) : lit < -0.3 ? light : lit > 0.45 ? shade : bodyC;
      return fade < 1 ? { c, a: fade } : c;
    }, 1);
  },
  /** Grit: a single fleck, or a 2×2 one. */
  flGrit(v, P, p) {
    const u = p.age / p.life; if (u > 0.85 && (Math.floor(p.age * 12) & 1)) return;
    const [x, y] = v.ap(p.x, p.y, p.z), c = S(p.R, p.t ?? 0.5);
    P.px(x, y, c);
    if (p.big) { P.px(x + 1, y, c); P.px(x, y + 1, S(p.R, (p.t ?? 0.5) - 0.17)); P.px(x + 1, y + 1, S(p.R, (p.t ?? 0.5) - 0.33)); }
  },
}, {});

registerShapes({
  /** The floor's shock band: a thick ring racing out, banded dust and colour, thinning as it goes. */
  flBand(v, P, p) {
    const u = clamp(p.age / p.life), e = 1 - (1 - u) ** 3, [cx, cy] = v.ap(p.x, p.y, 0), rx = p.r * v.aps * e;
    if (rx < 2) return;
    const th = Math.max(1, Math.round((p.th ?? 3) * (1 - u))), a = Math.min(1, (1.15 - u) * 1.2), fr = Math.floor(p.age * 12), D = p.dust ?? p.R;
    for (let k = 0; k < th; k++) {
      const rr = rx - k, cols = k === 0 ? S(p.R, 1) : k === 1 ? S(p.R, 0.67) : k === 2 ? S(D, 0.83) : S(D, 0.5);
      P.ellipse(cx, cy, rr, rr * v.sq, (q) => (hash(Math.floor(q * 9), fr >> 1, k) < 0.12 ? null : { c: cols, a: k > 1 ? a * 0.7 : a }), k < 2 ? 1 : 0);
    }
  },
  /** Scorched floor: white-hot at first, cooling through the ramp to soot, then fading. */
  flScorch(v, P, p) {
    const t = p.age, fade = clamp((p.life - t) / 1.2), [cx, cy] = v.ap(p.x, p.y, 0), rx = p.r * v.aps * Math.min(1, t / 0.1), ry = rx * v.sq, R = p.R;
    if (rx < 1.5 || fade <= 0) return;
    const cool = Math.pow(clamp(1 - t / p.cool), 1.4), soot = RAMP.smoke, seed = p.seed;
    P.shade(cx - rx - 1, cy - ry - 1, cx + rx + 1, cy + ry + 1, (x, y) => {
      const dx = (x - cx) / rx, dy = (y - cy) / ry, d = Math.hypot(dx, dy);
      const e = 0.82 + pnoise(Math.atan2(dy, dx), 9, seed) * 0.3;
      if (d > e) return null;
      const n = hash(Math.floor(x / 3), Math.floor(y / 3), seed), T = cool * (1.25 - d / e) - n * 0.18;
      if (T > 0.06) return { c: S(R, Math.min(1, T)), a: fade };
      return { c: S(soot, d < e * 0.55 ? 0 : 0.17), a: fade * (d < e * 0.88 ? 0.85 : 0.5) };
    }, 0, "mix");
  },
}, { flat: ["flBand", "flScorch"] });
