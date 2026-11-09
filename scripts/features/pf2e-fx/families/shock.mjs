/**
 * Shock: force, sonic, air.
 *
 * Benchmarked against pixelfx `arcane/mana-burst`, `lightning/thunderclap`
 * and `nature/tornado` (spellsprite-craft §5). All three shove: a floor band
 * races out raising dust and grit, and what they throw skids.
 *
 * Force: a faceted shell that snaps outward and shatters into glassy shards,
 * a star, streaks radiating, glints holding where the shell broke.
 * Sonic: concentric shells pulsing out in bright and dim bands, rings racing
 * along the floor, radiating streaks; a cone or line is sound arcs rolling
 * away from the hand, dust shaken up under them.
 * Air: a vortex of spiral swirls that climbs, gusts that curl as they fly,
 * grit whirled outward on the spin, a pale dust ring kicked up off the floor.
 * No core and no star.
 */

import { TAU, clamp, easeOut, q12, fadeOut } from "../core/rand.mjs";
import { RAMP, S } from "../core/palette.mjs";
import { physics } from "../core/sim.mjs";
import { registerShapes } from "../core/shapes.mjs";
import { out, sd, still, releaseFlash, counter, flourish } from "../core/motifs.mjs";
import { flat, grit, subFlash } from "./flame.mjs";
import { shard } from "./frost.mjs";

/** Dust shoved outward along the floor: translucent, in the kinetic ramp so it reads as the floor's own. */
function shove(s, x, y, r0, N, sp, size, extra) {
  for (let i = 0; i < N; i++) {
    const a = (i / N) * TAU + s.rand(-0.3, 0.3), v = s.rand(sp * 0.5, sp);
    s.add({ k: "flHaze", x: x + Math.cos(a) * r0, y: y + Math.sin(a) * r0, z: 0.04, vx: Math.cos(a) * v, vy: Math.sin(a) * v, vz: 0.1, drag: 3, r: s.rand(size * 0.7, size), life: s.rand(0.9, 1.6), R: RAMP.kinetic, tone: 0.5, toneEnd: 0.33, a: 0.4, grow: 0.9, seed: sd(s), wait: s.rand(0.02, 0.08), minor: i % 2 === 1, ...extra });
  }
}

/* ── force ────────────────────────────────────────────────────────────── */

const force = {
  burst(s, M, { x, y, z, pow, rad, sub }) {
    const R = M.R, m = s.m * pow, mm = Math.min(1.7, m), n = counter(s, pow, rad), aps = s.spec.aps, zz = Math.max(0.15, z);
    if (sub) subFlash(s, M, x, y, z, pow, rad); else releaseFlash(s, M, x, y, z, pow, rad);
    if (sub) {
      s.add({ k: "octa", x, y, z: zz, life: 0.3, r: (rad * 0.5 + 0.3) * aps * 0.6, R, update: still });
      for (let i = 0, N = n(4); i < N; i++) s.add(shard(s, R, x, y, zz, s.rand(3, 7), { minor: i % 2 === 1 }));
      for (let i = 0, N = n(5); i < N; i++) { const q = (i / N) * TAU + s.rand(-0.3, 0.3), sp = s.rand(6, 9); s.add({ k: "streak", x, y, z: zz, vx: Math.cos(q) * sp, vy: Math.sin(q) * sp, drag: 3.5, life: s.rand(0.15, 0.25), R, minor: i % 2 === 1 }); }
      return;
    }
    // the shell: snaps out, a second one behind it, then it breaks
    s.add({ k: "octa", x, y, z: zz, life: 0.42, r: (rad * 0.9 + 0.7) * aps * 0.6 * Math.min(1.5, mm), R, update: still });
    s.add({ k: "octa", x, y, z: zz, life: 0.36, r: (rad * 1.3 + 1) * aps * 0.6 * Math.min(1.5, mm), R, wait: 0.07, update: still });
    s.add({ k: "star", x, y, z: zz, L: 7 * mm, life: 3 / 12, R, update: still });
    // the broken shell hangs a moment, dissolving
    s.add({ k: "octa", x, y, z: zz, life: 1.3, r: (rad * 1.1 + 0.9) * aps * 0.6 * Math.min(1.5, mm), R, wait: 0.3, update: still });
    s.light(x, y, zz, rad * 1.4 + 1, S(R, 0.67), 0.3, 1.8);
    // glassy shards of the shell flung out, skidding on the floor
    for (let i = 0, N = n(16); i < N; i++) s.add(shard(s, R, x, y, zz, s.rand(4, 10) * Math.min(1.3, pow), { L: 2 + Math.floor(s.R() * 4), minor: i % 2 === 1 }));
    for (let i = 0, N = n(16); i < N; i++) { const q = (i / N) * TAU + s.rand(-0.15, 0.15), sp = s.rand(8, 13); s.add({ k: "streak", x, y, z: zz + s.rand(-0.1, 0.2), vx: Math.cos(q) * sp, vy: Math.sin(q) * sp, vz: s.rand(-0.3, 0.6), drag: 3.5, life: s.rand(0.2, 0.32), R, wait: s.rand(0, 0.05), minor: i % 3 === 2 }); }
    for (let i = 0, N = n(20); i < N; i++) s.add({ k: "spark", x, y, z: zz, ...flat(s, s.rand(5, 11), 0.7), g: 12, drag: 2.4, bounce: 0.4, life: s.rand(0.2, 0.5), R, minor: i % 3 !== 0 });
    // glints hang where the shell broke
    for (let i = 0, N = n(9); i < N; i++) { const a = s.rand(0, TAU), d = s.rand(0.3, 1) * (rad + 0.5); s.add({ k: "glint", x: x + Math.cos(a) * d, y: y + Math.sin(a) * d, z: zz + s.rand(-0.2, 0.4), life: 5 / 12, R, big: i === 0, wait: s.rand(0.15, 1.8), minor: i > 2, update: still }); }
    // the floor: a band, dust shoved out, grit
    s.add({ k: "flBand", x, y, r: rad * 1.7 + 1.7 * Math.min(1.3, mm), life: 0.45, R, dust: RAMP.kinetic, th: 3 + rad * 2, update: still });
    shove(s, x, y, rad * 0.4, n(6), 6 * Math.min(1.3, pow), 7 * Math.min(1.3, mm));
    for (let i = 0, N = n(14); i < N; i++) s.add(grit(s, x, y, 0.05, s.rand(2, 6), RAMP.kinetic));
    flourish(s, M, x, y, z, rad, Math.round(6 * m));
  },
  trail(s, M, { x, y, z, dt }) {
    const R = M.R;
    for (let i = s.count(26 * s.m, dt); i > 0; i--) s.add(shard(s, R, x, y, z, s.rand(0.5, 1.5), { g: 0, drag: 4, life: s.rand(0.3, 0.5), minor: i % 2 === 0 }));
    for (let i = s.count(10 * s.m, dt); i > 0; i--) s.add({ k: "glint", x: x + s.rand(-0.1, 0.1), y: y + s.rand(-0.1, 0.1), z, life: 5 / 12, R, minor: true, update: still });
  },
  linger(s, M, { at }) {
    at(4, () => ({ k: "glint", z: s.rand(0.1, 0.8), life: 5 / 12, update: still }));
    at(0.8, () => ({ k: "octa", z: 0.3, life: 0.35, r: s.rand(6, 10), update: still }));
    at(5, () => ({ k: "mote", z: s.rand(0.1, 0.6), vz: s.rand(0.2, 0.5), drag: 2, life: s.rand(0.6, 1), plus: s.R() < 0.3, minor: true }));
  },
  spray(s, M, { emit }) {
    const R = M.R;
    emit("frShard", 56, () => ({ drag: 1.2, g: 2, bounce: 0.3, life: s.rand(0.5, 0.7), a: s.rand(0, TAU), va: s.rand(-20, 20), L: 2 + Math.floor(s.R() * 3), seed: s.R() }));
    emit("streak", 34, () => ({ drag: 1.6, life: s.rand(0.25, 0.4), vz: s.rand(-0.2, 0.2) }));
    emit("flHaze", 8, () => ({ drag: 2, life: s.rand(0.8, 1.2), r: s.rand(4, 6), z: 0.05, vz: 0.1, R: RAMP.kinetic, tone: 0.5, toneEnd: 0.33, a: 0.45, grow: 0.9, seed: sd(s), minor: true }));
    emit("glint", 6, () => ({ life: 5 / 12, update: still, minor: true }));
  },
  auraStart(s, M, T) {
    for (let i = 0; i < 3; i++) s.add({ k: "shard", x: T.x, y: T.y, z: 0.6, life: 1e9, R: M.R, seed: i * 0.3, ph: (i * TAU) / 3, update(p, _s, dt) { p.ph += dt * 2.2; p.x = T.x + Math.cos(p.ph) * 0.5 * T.size; p.y = T.y + Math.sin(p.ph) * 0.5 * T.size; p.z = 0.6 + Math.sin(p.ph * 2) * 0.15; } });
  },
  aura(s, M, { at }) {
    at(3, () => ({ k: "glint", life: 5 / 12, update: still }));
    at(1, () => ({ k: "octa", life: 0.35, r: s.rand(6, 9), update: still }));
  },
  tick(s, M, T) {
    s.add({ k: "octa", x: T.x, y: T.y, z: 0.5 * T.h, life: 0.4, r: 14 * Math.min(1.5, T.size), R: M.R, update: still });
    for (let i = 0; i < 6; i++) s.add(shard(s, M.R, T.x, T.y, 0.5 * T.h, s.rand(2, 5), { minor: i % 2 === 1 }));
  },
};

/* ── shared ───────────────────────────────────────────────────────────── */

/** Which way a travelling head is going, matched against last step's heads (several projectiles may fly at once). */
function heading(s, x, y, z) {
  const list = (s.shockHeads ??= []);
  let best = -1, bd = 0.3;
  for (let i = 0; i < list.length; i++) {
    const h = list[i]; if (h.t === s.t) continue;
    const d = Math.hypot(h.x - x, h.y - y, h.z - z); if (d < bd) { bd = d; best = i; }
  }
  let dir = null;
  if (best >= 0) {
    const h = list[best], L = Math.hypot(x - h.x, y - h.y, z - h.z);
    if (L > 1e-4) dir = [(x - h.x) / L, (y - h.y) / L, (z - h.z) / L];
    list.splice(best, 1);
  }
  for (let i = list.length - 1; i >= 0; i--) if (s.t - list[i].t > 0.1) list.splice(i, 1);
  list.push({ x, y, z, t: s.t });
  return dir;
}

/** The half-width (squares) a spray covers at distance d: a cone widens, a line does not. */
function spanAt(half, len, d) {
  const cone = half > Math.PI / 4 - 0.01, hw = cone ? Infinity : Math.tan(half / 0.6) * len;
  return Math.max(Math.min(half * 0.92, Math.atan2(hw, d)), Math.atan2(0.4, Math.max(d, 0.01)));
}

/** A gust's flight: its velocity turns at `p.turn` rad/s, then ordinary physics. */
function curve(p, s, dt) {
  const c = Math.cos(p.turn * dt), sn = Math.sin(p.turn * dt), vx = p.vx;
  p.vx = vx * c - p.vy * sn; p.vy = vx * sn + p.vy * c;
  physics(p, dt, s);
}

/* ── sonic ────────────────────────────────────────────────────────────── */

const sonic = {
  burst(s, M, { x, y, z, pow, rad, sub }) {
    const R = M.R, m = s.m * pow, mm = Math.min(1.7, m), n = counter(s, pow, rad), aps = s.spec.aps, zz = Math.max(0.15, z);
    if (sub) subFlash(s, M, x, y, z, pow, rad); else releaseFlash(s, M, x, y, z, pow, rad);
    // an area eruption is a single pulse: one shell, one ring, a few streaks
    if (!sub) s.add({ k: "star", x, y, z: zz, L: 4 * mm, life: 2 / 12, R, update: still });
    const N = sub ? 1 : s.take === 1 ? 5 : 4;
    for (let i = 0; i < N; i++) s.add({ k: "soundshell", x, y, z: zz, r: (rad * 1.1 + 0.8) * aps * Math.min(1.5, mm) * (1 - i * 0.1) * (sub ? s.rand(0.55, 0.75) : 1), life: 0.55 - i * 0.04, wait: i * 0.08, R, thin: sub, update: still });
    for (let i = 0; i < (sub ? 1 : 3); i++) s.add({ k: "ring", x, y, r: (rad * (1.2 + i * 0.35) + 0.5) * (sub ? 0.8 : Math.min(1.3, mm)), life: 0.6, wait: 0.04 + i * 0.1, R, update: still });
    for (let i = 0, M2 = sub ? n(5) : n(16); i < M2; i++) {
      const q = (i / M2) * TAU + s.rand(-0.15, 0.15), sp = s.rand(7, 11);
      s.add({ k: "streak", x, y, z: zz + s.rand(-0.1, 0.2), vx: Math.cos(q) * sp, vy: Math.sin(q) * sp, vz: s.rand(-0.3, 0.6), drag: 3.5, life: s.rand(0.22, 0.34), R, wait: s.rand(0, 0.06), minor: i % 3 === 2 });
    }
    if (!sub) {
      // the floor shakes: a heavy band, dust shoved out, grit jumping, motes hanging in the shaken air
      s.add({ k: "flBand", x, y, r: rad * 1.9 + 1.8 * Math.min(1.3, mm), life: 0.55, R, dust: RAMP.kinetic, th: 3 + rad * 2.5, update: still });
      s.add({ k: "flBand", x, y, r: rad * 1.3 + 1.2 * Math.min(1.3, mm), life: 0.45, R, dust: RAMP.kinetic, th: 2, wait: 0.12, update: still });
      shove(s, x, y, rad * 0.5, n(7), 6.5 * Math.min(1.3, pow), 7 * Math.min(1.3, mm));
      for (let i = 0, N2 = n(16); i < N2; i++) s.add(grit(s, x + s.rand(-0.5, 0.5) * rad, y + s.rand(-0.5, 0.5) * rad, 0.03, s.rand(1, 4), RAMP.kinetic, { g: 34 }));
      // the echo: the shell comes back fainter, three times
      for (let e = 1; e <= 3; e++) {
        s.add({ k: "soundshell", x, y, z: zz, r: (rad * 1.1 + 0.8) * aps * Math.min(1.5, mm) * (1 - e * 0.15), life: 0.5, wait: 0.3 + e * 0.35, R, thin: e > 1, update: still });
        s.add({ k: "ring", x, y, r: (rad * 1.2 + 0.5) * Math.min(1.3, mm) * (1 - e * 0.12), life: 0.55, wait: 0.34 + e * 0.35, R, broken: true, seed: sd(s), update: still });
        s.at(s.t + 0.3 + e * 0.35, (s2) => s2.light(x, y, zz, rad * 1.5 + 1, S(R, 0.83), 0.4 / e, 0.4));
      }
      for (let i = 0, N2 = n(10); i < N2; i++) s.add({ k: "mote", x: x + s.rand(-1, 1) * (rad + 0.5), y: y + s.rand(-1, 1) * (rad + 0.5), z: zz + s.rand(-0.1, 0.6), vx: s.rand(-0.5, 0.5), vy: s.rand(-0.5, 0.5), vz: s.rand(0, 0.4), drag: 2, life: s.rand(0.7, 1.3), R, plus: s.R() < 0.3, wait: s.rand(0.1, 0.4), minor: true });
    }
    flourish(s, M, x, y, z, rad, Math.round(6 * m));
  },
  trail(s, M, { x, y, z, dt }) {
    for (let i = s.count(12 * s.m, dt); i > 0; i--) s.add({ k: "soundshell", x, y, z, r: s.rand(6, 9), life: 0.34, R: M.R, thin: true, update: still });
    for (let i = s.count(10 * s.m, dt); i > 0; i--) s.add({ k: "mote", x, y, z, vx: s.rand(-0.5, 0.5), vy: s.rand(-0.5, 0.5), vz: s.rand(-0.3, 0.3), drag: 3, life: 0.4, R: M.R, minor: true });
  },
  linger(s, M, { at }) {
    at(2.2, () => ({ k: "ring", r: s.rand(0.4, 0.8), life: 0.6, update: still }));
    at(4, () => ({ k: "mote", z: s.rand(0.1, 0.6), vz: s.rand(0.1, 0.4), drag: 2, life: s.rand(0.6, 1), plus: s.R() < 0.3, minor: true }));
    at(1.6, () => ({ k: "soundshell", z: s.rand(0.2, 0.6), r: s.rand(8, 13), life: 0.45, thin: true, update: still }));
  },
  spray(s, M, { emit, hand, dir, half, len, dt }) {
    // sound arcs rolling out from the hand, widening with the cone (or holding the line's width)
    for (let i = s.count(9 * s.m, dt); i > 0; i--) {
      s.add({ k: "soundarc", x: hand[0], y: hand[1], z: Math.max(0.3, hand[2] - 0.2), ox: hand[0], oy: hand[1], dir, half, len, d: 0.15, sp: s.rand(6.5, 8) * (len / 6), life: 0.75, R: M.R,
        update(p, _s, dt2) { p.d += p.sp * dt2; p.x = p.ox + Math.cos(p.dir) * p.d; p.y = p.oy + Math.sin(p.dir) * p.d; p.z = Math.max(0.15, p.z - 0.2 * dt2); } });
    }
    emit("streak", 40, () => ({ drag: 1.5, life: s.rand(0.3, 0.42), vz: s.rand(-0.2, 0.2), minor: true }));
    emit("flHaze", 9, () => ({ drag: 2.2, life: s.rand(0.8, 1.2), r: s.rand(4, 6.5), z: 0.04, vz: 0.1, R: RAMP.kinetic, tone: 0.5, toneEnd: 0.33, a: 0.42, grow: 0.9, seed: sd(s), minor: true }));
    emit("flGrit", 16, () => ({ g: 30, drag: 1.2, z: 0.05, vz: s.rand(1, 3), life: s.rand(0.8, 1.4), R: RAMP.kinetic, t: 0.5, big: s.R() < 0.3, minor: true }));
  },
  auraStart() {},
  aura(s, M, { T, dt }) {
    if (s.R() < 1.3 * s.m * dt) s.add({ k: "soundshell", x: T.x, y: T.y, z: 0.85 * T.h, r: s.rand(6, 9) * Math.min(1.4, T.size), life: 0.45, R: M.R, thin: true, update: still });
  },
  tick(s, M, T) {
    s.add({ k: "soundshell", x: T.x, y: T.y, z: 0.5 * T.h, r: 12 * Math.min(1.5, T.size), life: 0.45, R: M.R, update: still });
  },
};

/* ── air ──────────────────────────────────────────────────────────────── */

/** Kicked-up dust: drawn with corrode's see-through `toxcloud` in the air ramp, so it reads as haze, not stones. */
const DUST = [[0, 0, 1], [0.6, 0.2, 0.6]];

/** A gust flung outward in a random direction; `at` (when given) is where it starts. */
const gustOut = (s, at, sp, extra) => {
  const q = s.rand(0, TAU);
  return { k: "gust", ...at, vx: Math.cos(q) * sp, vy: Math.sin(q) * sp, vz: s.rand(-0.1, 0.4), turn: (s.R() < 0.5 ? 1 : -1) * s.rand(2.5, 4.5), drag: 2, life: s.rand(0.5, 0.75), len: s.rand(0.7, 1), seed: s.seedInt(), update: curve, ...extra };
};

const air = {
  burst(s, M, { x, y, z, pow, rad, sub }) {
    const R = M.R, m = s.m * pow, mm = Math.min(1.7, m), n = counter(s, pow, rad), z0 = z > 0.3 ? z * 0.6 : 0.1;
    if (sub) subFlash(s, M, x, y, z, pow, rad); else releaseFlash(s, M, x, y, z, pow, rad);
    // an area's eruptions are small whirls; the full vortex and its dust ring are the release's alone
    const spin = s.R() < 0.5 ? 1 : -1, H = sub ? 2 : s.take === 2 ? 6 : 5;
    for (let i = 0; i < H; i++) s.add({ k: "windswirl", x, y, z: z0 + i * 0.32 * (0.7 + rad * 0.3), vz: 0.6, drag: 1, r: (6 + i * 3.2) * mm * (0.75 + rad * 0.3) * (sub ? 0.7 : 1), life: s.rand(0.9, 1.25), spin, R, wait: i * 0.05, seed: s.seedInt(), update(p, _s, dt) { p.z += p.vz * dt; } });
    for (let i = 0; i < (sub ? Math.min(3, n(5)) : n(10)); i++) s.add(gustOut(s, { x, y, z: z0 + s.rand(0, 0.7) }, s.rand(4.5, 8), { R, turn: spin * s.rand(2.5, 4.5), len: s.rand(0.8, 1.3), wait: s.rand(0, 0.15), minor: i % 3 === 2 }));
    if (!sub) {
      for (let i = 0, N = n(9); i < N; i++) {
        const q = (i / N) * TAU + s.rand(-0.2, 0.2), d = rad * 0.55;
        s.add({ k: "toxcloud", x: x + Math.cos(q) * d, y: y + Math.sin(q) * d, z: 0.05, vx: Math.cos(q) * 3, vy: Math.sin(q) * 3, vz: 0.15, drag: 2.4, r: s.rand(4.5, 6.5) * Math.min(1.3, mm), life: s.rand(0.8, 1.2), lobes: DUST, seed: s.seedInt(), spin, R, wait: s.rand(0.03, 0.1), minor: i % 2 === 1 });
      }
      // grit and chaff caught on the spin and flung outward
      for (let i = 0, N = n(16); i < N; i++) s.add(grit(s, x + s.rand(-0.3, 0.3) * rad, y + s.rand(-0.3, 0.3) * rad, 0.1, s.rand(3, 6), RAMP.kinetic, { g: 6, drag: 1.4, vz: s.rand(1, 3), turn: spin * s.rand(2.5, 5), life: s.rand(0.9, 1.6), update: curve }));
      shove(s, x, y, rad * 0.5, n(6), 5.5 * Math.min(1.3, pow), 6.5 * Math.min(1.3, mm));
      s.add({ k: "flBand", x, y, r: rad * 1.8 + 1.6 * Math.min(1.3, mm), life: 0.6, R, dust: RAMP.kinetic, th: 2 + rad * 2, update: still });
    }
    if (pow >= 0.5) s.add({ k: "ring", x, y, r: rad * 1.25 + 0.5, life: 0.75, R, broken: true, seed: s.seedInt(), wait: 0.08, update: still });
    flourish(s, M, x, y, z, rad, Math.round(6 * m));
  },
  trail(s, M, { x, y, z, dt }) {
    const d = heading(s, x, y, z) ?? [1, 0, 0];
    for (let i = s.count(22 * s.m, dt); i > 0; i--) {
      const sp = s.rand(1, 2.2);
      s.add({ k: "gust", x: x + s.rand(-0.08, 0.08), y: y + s.rand(-0.08, 0.08), z: z + s.rand(-0.08, 0.08), vx: -d[0] * sp, vy: -d[1] * sp, vz: -d[2] * sp + s.rand(-0.2, 0.2), turn: s.rand(-3, 3), drag: 2, life: s.rand(0.3, 0.45), len: s.rand(0.3, 0.45), seed: s.seedInt(), R: M.R, update: curve });
    }
    for (let i = s.count(4 * s.m, dt); i > 0; i--) s.add({ k: "windswirl", x, y, z, r: s.rand(3, 4.5), life: 0.35, spin: 1, R: M.R, seed: s.seedInt(), minor: true, update: still });
  },
  linger(s, M, { at }) {
    at(2.2, () => gustOut(s, null, s.rand(1.8, 3), { z: s.rand(0.05, 0.4), drag: 1, life: s.rand(0.6, 0.9) }));
    at(0.6, () => ({ k: "windswirl", z: 0.1, vz: 0.4, r: s.rand(4, 6), life: 0.8, spin: s.R() < 0.5 ? 1 : -1, seed: s.seedInt(), update(p, _s, dt) { p.z += p.vz * dt; } }));
  },
  spray(s, M, { emit }) {
    emit("gust", 56, () => ({ drag: 0.9, life: s.rand(0.6, 0.85), len: s.rand(0.6, 0.95), turn: s.rand(-1.6, 1.6), seed: s.seedInt(), update: curve }));
    emit("flGrit", 18, () => ({ g: 4, drag: 1, life: s.rand(0.8, 1.3), R: RAMP.kinetic, t: 0.5, big: s.R() < 0.3, turn: s.rand(-3, 3), update: curve, minor: true }));
    emit("toxcloud", 12, () => ({ drag: 1.8, life: s.rand(0.7, 1), r: s.rand(4, 6), z: 0.1, vz: 0.1, lobes: DUST, seed: s.seedInt(), spin: 1, minor: true }));
  },
  auraStart() {},
  aura(s, M, { T, dt }) {
    for (let i = s.count(5 * s.m, dt); i > 0; i--) {
      const dirn = s.R() < 0.5 ? 1 : -1, rr = s.rand(0.35, 0.5) * T.size;
      s.add({ k: "gust", x: T.x, y: T.y, z: s.rand(0.1, 0.8) * T.h, vx: 0, vy: 0, vz: 0, ph: s.rand(0, TAU), w: dirn * s.rand(3.5, 5), rr, rise: s.rand(0.1, 0.35), life: s.rand(0.5, 0.8), len: s.rand(0.35, 0.55), seed: s.seedInt(), R: M.R,
        update(p, _s, dt2) { p.ph += p.w * dt2; p.x = T.x + Math.cos(p.ph) * p.rr; p.y = T.y + Math.sin(p.ph) * p.rr * 0.6; p.z += p.rise * dt2; p.vx = -Math.sin(p.ph) * p.w * p.rr; p.vy = Math.cos(p.ph) * p.w * p.rr * 0.6; p.vz = p.rise; } });
    }
  },
  tick(s, M, T) {
    s.add({ k: "windswirl", x: T.x, y: T.y, z: 0.45 * T.h, r: 9 * Math.min(1.5, T.size), life: 0.5, spin: 1, R: M.R, seed: s.seedInt(), update: still });
  },
};

/* ── the family ───────────────────────────────────────────────────────── */

const look = (M) => (M.material === "sonic" ? sonic : M.material === "air" ? air : force);
const pick = (name) => (s, M, ctx) => look(M)[name](s, M, ctx);

export default {
  id: "shock",
  burst: pick("burst"),
  trail: pick("trail"),
  linger: pick("linger"),
  spray: pick("spray"),
  auraStart(s, M, T) { look(M).auraStart(s, M, T); },
  aura: pick("aura"),
  tick(s, M, T) { look(M).tick?.(s, M, T); },
  gentle: true,
};

/* ── shapes ───────────────────────────────────────────────────────────── */

registerShapes({
  /** Concentric sound bands: a bright front, a dim band and a faint one behind it, broken by a travelling rhythm. */
  soundshell(v, P, p) {
    const u = clamp(q12(p.age) / p.life), fr = Math.floor(p.age * 12), [cx, cy] = v.ap(p.x, p.y, p.z);
    const rx = p.r * (0.25 + 0.75 * easeOut(u)), a = 1 - u * u, sq = v.kind === "top" ? 1 : 0.88, N = 18;
    if (rx < 1.5) { P.px(cx, cy, S(p.R, 1), 1); return; }
    const gap = (q, k) => (Math.floor((q / TAU) * N) + fr + k * 2) % 6 === 0;
    P.ellipse(cx, cy, rx, rx * sq, (q) => (gap(q, 0) ? null : { c: S(p.R, 0.95), a }), 1);
    if (rx > 4) P.ellipse(cx, cy, rx - 2, (rx - 2) * sq, (q) => (gap(q, 1) ? null : { c: S(p.R, 0.62), a }), 0);
    if (!p.thin && rx > 7) P.ellipse(cx, cy, rx - 4, (rx - 4) * sq, (q) => (gap(q, 2) ? null : { c: S(p.R, 0.83), a: a * 0.6 }), 0);
  },
  /** One sound arc rolling away from the hand: a bright crescent and a dim one behind it. */
  soundarc(v, P, p) {
    const u = clamp(p.age / p.life), a = fadeOut(u, 0.55), fr = Math.floor(p.age * 12);
    for (let k = 0; k < 2; k++) {
      const d = p.d - k * 0.14; if (d <= 0.05) continue;
      const span = spanAt(p.half, p.len, d), n = Math.max(6, Math.ceil(span * d * v.aps * 2.2));
      let lx = null, ly = null;
      for (let i = 0; i <= n; i++) {
        const t = -span + (2 * span * i) / n, q = p.dir + t, [x, y] = v.ap(p.ox + Math.cos(q) * d, p.oy + Math.sin(q) * d, p.z);
        const X = Math.floor(x), Y = Math.floor(y); if (X === lx && Y === ly) continue; lx = X; ly = Y;
        if (((i >> 2) + fr) % 7 === 0) continue;
        const edge = Math.abs(t) / span > 0.82;
        P.dot(X, Y, S(p.R, k ? 0.55 : edge ? 0.7 : 0.95), k ? a * 0.8 : a, k ? 0 : 1);
      }
    }
  },
  /** A wind line: a wavy streak trailing back along its flight with a curl hooked at the head. */
  gust(v, P, p) {
    const u = clamp(p.age / p.life), fr = Math.floor(p.age * 12), a = fadeOut(u, 0.6);
    const vl = Math.hypot(p.vx, p.vy, p.vz) || 1, L = (p.len ?? 0.5) * Math.min(1, 0.4 + u * 4) * (1 - 0.4 * u);
    const [hx, hy] = v.ap(p.x, p.y, p.z), [tx, ty] = v.ap(p.x - (p.vx / vl) * L, p.y - (p.vy / vl) * L, p.z - (p.vz / vl) * L);
    const dx = hx - tx, dy = hy - ty, sl = Math.hypot(dx, dy); if (sl < 1) { P.px(hx, hy, S(p.R, 0.95), 1); return; }
    const nx = -dy / sl, ny = dx / sl, n = Math.ceil(sl * 1.4), ph = (p.seed % 7) + fr * 0.9, amp = Math.min(1.2, sl * 0.07);
    let lx = null, ly = null;
    for (let i = 0; i <= n; i++) {
      const f = i / n, w = Math.sin(f * TAU * 0.8 + ph) * amp * (1 - f * 0.7);
      const X = Math.floor(tx + dx * f + nx * w), Y = Math.floor(ty + dy * f + ny * w); if (X === lx && Y === ly) continue; lx = X; ly = Y;
      if (f < 0.35) { if ((i + fr) & 1) P.dot(X, Y, S(p.R, 0.5), a * 0.8, 0); }
      else P.dot(X, Y, S(p.R, f > 0.72 ? 0.95 : 0.75), a, 1);
    }
    // the curl: three quarters of a small loop off the head, turning the way the gust turns (on about half of them)
    if (sl < 7 || p.seed % 2) return;
    const sg = (p.turn ?? 1) >= 0 ? 1 : -1, cr = sl > 16 ? 3 : 2, ccx = hx + nx * cr * sg, ccy = hy + ny * cr * sg, th0 = Math.atan2(-ny * sg, -nx * sg);
    for (let i = 1; i <= 8; i++) {
      const t = th0 + sg * (i / 8) * TAU * 0.72;
      P.dot(ccx + Math.cos(t) * cr, ccy + Math.sin(t) * cr, S(p.R, i < 6 ? 1 : 0.75), a, 1);
    }
  },
  /** A two-armed spiral turning at 12 fps: flat in top view, an oblique ellipse from the side. */
  windswirl(v, P, p) {
    const u = clamp(p.age / p.life), fr = Math.floor(p.age * 12), a = fadeOut(u, 0.55), [cx, cy] = v.ap(p.x, p.y, p.z);
    const rr = p.r * (0.5 + 0.5 * Math.min(1, u * 4)), sq = v.kind === "top" ? 1 : 0.42, rot = fr * 0.55 * (p.spin || 1) + (p.seed % 13);
    const n = Math.max(8, Math.ceil(rr * 3.2));
    for (let arm = 0; arm < 2; arm++) {
      let lx = null, ly = null;
      for (let i = 0; i <= n; i++) {
        const t = i / n, ang = rot + arm * Math.PI + (p.spin || 1) * t * TAU * 0.7, rad = rr * (0.2 + 0.8 * t);
        const X = Math.floor(cx + Math.cos(ang) * rad), Y = Math.floor(cy + Math.sin(ang) * rad * sq); if (X === lx && Y === ly) continue; lx = X; ly = Y;
        if (t < 0.3) { if (i & 1) P.dot(X, Y, S(p.R, 0.5), a * 0.8, 0); }
        else P.dot(X, Y, S(p.R, t > 0.72 ? 0.95 : 0.75), a, 1);
      }
    }
  },
});
