/**
 * Spellsprite — motifs every family shares: the charge, the projectile, the
 * flourish, and the small physics helpers families build their bursts from.
 *
 * `M` is the resolved material: `{ id, family, R }` where `R` is its ramp
 * (already rotated by a custom look's hue).
 */

import { TAU, clamp, lerp } from "./rand.mjs";
import { S } from "./palette.mjs";

/** A random direction, biased upward (z ≥ -0.2). */
export function sph(s) {
  const a = s.rand(0, TAU), zc = s.rand(-0.2, 1), r = Math.sqrt(1 - zc * zc);
  return [Math.cos(a) * r, Math.sin(a) * r, zc];
}
export const out = (s, sp) => { const d = sph(s); return { vx: d[0] * sp, vy: d[1] * sp, vz: d[2] * sp }; };
export const sd = (s) => s.seedInt();

/** Smoke lobes: a main puff and up to four smaller ones. */
export function lobes(s) {
  const all = [[0, 0, 1], [-0.62, 0.22, 0.72], [0.6, 0.28, 0.68], [0.08, -0.55, 0.62], [-0.3, -0.38, 0.55]];
  return [all[0], ...all.slice(1).filter(() => s.R() < 0.7)];
}

/** A drop that lands: a puddle that stays a while and a two-frame splash. */
export function splat(p, s) {
  p.life = 0;
  s.add({ k: "puddle", x: p.x, y: p.y, r: s.rand(0.05, 0.1), life: s.rand(1.6, 2.6), R: p.R, debris: true, update() {} });
  s.add({ k: "splash", x: p.x, y: p.y, z: 0, life: 3 / 12, R: p.R, update() {} });
}

/** Particles that hold still and only age (decals, glints, beams). */
export const still = () => {};

/** The custom look's flourish around a release. */
export function flourish(s, M, x, y, z, rad, n) {
  const f = s.spec.look?.flourish;
  if (!f || f === "none") return;
  if (f === "runes") { s.add({ k: "glyph", x, y, r: rad * 1.1 + 0.35, life: 1.3, R: M.R, star: true, update: still }); return; }
  for (let i = 0; i < n; i++) {
    if (f === "sparkles") s.add({ k: "glint", x: x + s.rand(-1, 1) * (rad + 0.2), y: y + s.rand(-1, 1) * (rad + 0.2), z: Math.max(0.05, z + s.rand(-0.3, 0.8)), life: 5 / 12, R: M.R, wait: s.rand(0, 0.35), minor: true, update: still });
    if (f === "petals") s.add({ k: "petal", x, y, z, ...out(s, s.rand(0.8, 2.2)), g: 0.5, drag: 2, life: s.rand(1.2, 2.0), seed: s.R(), R: M.R, minor: true });
  }
}

/** The flourish's share of a trail, per frame. */
export function trailFlourish(s, M, x, y, z, dt) {
  const f = s.spec.look?.flourish;
  if (f === "sparkles") for (let i = s.count(8, dt); i > 0; i--) s.add({ k: "glint", x, y, z, life: 5 / 12, R: M.R, minor: true, update: still });
  if (f === "petals") for (let i = s.count(14, dt); i > 0; i--) s.add({ k: "petal", x, y, z, vx: s.rand(-0.5, 0.5), g: 0.4, drag: 2, life: s.rand(0.8, 1.3), seed: s.R(), R: M.R, minor: true });
}

/** Glyphs per tradition: the charge circle's alphabet. */
export const TRADITION_GLYPHS = Object.freeze({
  arcane: ["010111010", "101010101", "111101111", "110011010", "011110011", "100111001"],
  divine: ["010111010", "010010111", "111010010", "010111010", "101010101", "010010010"],
  occult: ["111101111", "100010001", "001010100", "101000101", "110101011", "011101110"],
  primal: ["010101010", "011110100", "001011110", "100110011", "010110010", "110010011"],
});

/** Charge: a glyph under the caster, lines gathering at the hand, a light swelling. */
export function charge(s, M, hand, caster, from, to, { size = null } = {}) {
  const tradition = s.spec.tradition;
  // the orb swells to what leaves the hand: a lob's own size, or a spark
  const top = (size ?? 4.5) * Math.min(1.5, s.m) - 1;
  s.add({ k: "glyph", x: caster.x, y: caster.y, r: 0.62 * Math.max(1, caster.size ?? 1), life: to - from + 0.5, R: M.R, star: s.spec.look?.flourish === "runes", glyphs: TRADITION_GLYPHS[tradition] ?? undefined, spin: tradition === "occult" ? -1 : 1, update: still });
  s.at(from, (s2) => {
    s2.light(hand[0], hand[1], hand[2], 1.5, S(M.R, 0.85), 0.9, to - from + 0.06, { swell: true });
    s2.add({ k: "orb", x: hand[0], y: hand[1], z: hand[2], life: to - from, R: M.R, dark: M.dark, r: 1, big: size != null, update(p) { const u = clamp(p.age / p.life); p.r = 1 + top * u * u * (3 - 2 * u); } });
  });
  s.emit(from, to, (s2, _u, dt) => {
    for (let i = s2.count(40, dt); i > 0; i--) {
      const a = s2.rand(0, TAU), b = s2.rand(-1, 1), d = s2.rand(0.5, 0.9), life = s2.rand(0.18, 0.3);
      const px = hand[0] + Math.cos(a) * d, py = hand[1] + Math.sin(a) * d * 0.6, pz = Math.max(0.05, hand[2] + b * d * 0.6);
      s2.add({ k: "streak", x: px, y: py, z: pz, vx: (hand[0] - px) / life, vy: (hand[1] - py) / life, vz: (hand[2] - pz) / life, life, R: M.R, minor: i > 1, update(p, _s, dt2) { p.x += p.vx * dt2; p.y += p.vy * dt2; p.z += p.vz * dt2; } });
    }
  });
}

/**
 * A projectile from `a` to `b` over `dur`, starting at `from`, arcing `arc`
 * squares high. `trail(s, x, y, z, dt)` sheds the family's trail.
 */
/**
 * A flying ball from a to b. `head` names the shape it draws (default the
 * plain orb), `props` adds fields that shape reads, and `step(p, s, dt)`
 * runs every step after the move: compile.mjs passes deliveries.mjs's comet
 * head and its wake, which this core module cannot import.
 */
export function projectile(s, M, a, b, from, dur, arc, trail, { r = 4.5, bolt = false, big = false, head = "orb", props = null, step = null } = {}) {
  const pos = (u) => [lerp(a[0], b[0], u), lerp(a[1], b[1], u), lerp(a[2], b[2], u) + Math.sin(Math.PI * u) * arc];
  s.at(from, (s2) => s2.add({
    k: head, x: a[0], y: a[1], z: a[2], life: dur, R: M.R, dark: M.dark, r: r * Math.min(1.5, s2.m), glow: true, big, ...(props?.(s2) ?? {}),
    update(p, s3, dt) {
      const u = clamp(p.age / dur);
      [p.x, p.y, p.z] = pos(u); p.tail = pos(Math.max(0, u - 0.09));
      step?.(p, s3, dt);
      trail?.(s3, p.x, p.y, p.z, dt);
      trailFlourish(s3, M, p.x, p.y, p.z, dt);
      const st = Math.floor(p.age * 20);
      if (bolt && st !== p.last) { p.last = st; s3.add({ k: "bolt", a, b: [p.x, p.y, p.z], life: 0.06, R: M.R, seed: st * 7 + 1, update: still }); }
    },
  }));
}

/** The light-and-flash every release shares, scaled by power. */
export function releaseFlash(s, M, x, y, z, pow, rad, { light = 1, flash = 1 } = {}) {
  const mm = Math.min(1.6, s.m * pow), aps = s.spec.aps;
  // a big soft pool at low strength and a tight hot one at the core (spellsprite-craft §1)
  // capped: a lobbed area (rad 1.4) would otherwise light six squares round it
  s.light(x, y, z, Math.min(rad * 3.2 + 1.5, rad + 3), S(M.R, 0.85), (M.dark ? 0.45 : 0.85) * mm * light, 0.8 + 0.3 * s.m * pow, { flicker: M.flicker });
  if (!M.dark) s.light(x, y, z, rad * 1.1 + 0.6, S(M.R, 1), 0.9 * light, 0.18);
  // the white core is the detonation, not the footprint: capped in squares, or a fireball's
  // flash (and its ring frame) whited out the whole area, and everything in it, for two frames
  if (pow > 1.2) {
    s.add({ k: "flash", x, y, z, life: 2 / 12, r: Math.min(rad * 0.85 + 0.45, 1.1) * aps * 0.8 * flash, R: M.R, update: still });
    s.crit();
  } else s.add({ k: "flash", x, y, z, life: 1 / 12, r: Math.min(rad * 0.6 + 0.35, 0.8) * aps * 0.7 * flash, R: M.R, update: still });
  if (pow >= 0.3) s.add({ k: "ring", x, y, r: rad * 1.7 + 0.6, life: 0.55, R: M.R, broken: true, seed: sd(s), update: still });
  if (pow >= 0.8) s.add({ k: "ring", x, y, r: rad * 1.15 + 0.4, life: 0.32, R: M.R, seed: sd(s), update: still });
}

/** How many of something a release makes: scales with power, rank and radius. */
// twice the old density: a burst reads as a burst (spellsprite-craft §1); families mark the excess minor
export const counter = (s, pow, rad) => (k) => Math.max(1, Math.round(2 * k * s.m * pow * (0.6 + rad * 0.45)));
