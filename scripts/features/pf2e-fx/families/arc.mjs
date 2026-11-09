/**
 * Arc: electricity.
 *
 * Benchmarked against pixelfx `lightning/thunderclap`, `lightning/zap-hit`
 * and `lightning/lightning-strike` (spellsprite-craft §5): a white flash,
 * forked bolts that stab out to the floor and re-strike for a third of a
 * second, a knot of tiny crackling zigzags at the core, a fern of burn marks
 * that glows outward and cools to soot, 60+ sparks that jink and bounce,
 * ozone puffs, and crackles that keep finding the floor while it discharges.
 * Shapes are prefixed `ac`.
 */

import { TAU, clamp, rng, hash } from "../core/rand.mjs";
import { RAMP, S, WHITE } from "../core/palette.mjs";
import { physics } from "../core/sim.mjs";
import { registerShapes } from "../core/shapes.mjs";
import { sd, still, releaseFlash, counter, flourish } from "../core/motifs.mjs";
import { flat, grit, subFlash } from "./flame.mjs";

/** A spark that jinks: every so often its velocity snaps through 45–90°. */
function jink(p, s, dt) {
  if (s.R() < 9 * dt) { const t = (s.R() < 0.5 ? 1 : -1) * s.rand(0.8, 1.6), c = Math.cos(t), sn = Math.sin(t), vx = p.vx; p.vx = vx * c - p.vy * sn; p.vy = vx * sn + p.vy * c; }
  physics(p, dt, s);
}

/** A bolt from a to b that holds for `life`, re-striking every 1/20 s (the bolt shape re-walks per frame). */
const bolt = (s, R, a, b, life, extra) => ({ k: "bolt", a, b, life, R, seed: sd(s), glow: true, update: still, ...extra });

const ozone = (s, R, x, y, z, extra) => ({ k: "flHaze", x, y, z, ...flat(s, s.rand(0.3, 1), 0.6), g: -0.3, drag: 2, r: s.rand(3, 5), life: s.rand(0.6, 1.1), R, tone: 0.5, toneEnd: 0.33, a: 0.36, grow: 0.8, seed: sd(s), minor: true, ...extra });

export default {
  id: "arc",
  burst(s, M, { x, y, z, pow, rad, sub }) {
    const R = M.R, m = s.m * pow, mm = Math.min(1.7, m), n = counter(s, pow, rad), crit = pow > 1.2;
    if (sub) subFlash(s, M, x, y, z, pow, rad); else releaseFlash(s, M, x, y, z, pow, rad);
    const zz = Math.max(0.15, z);
    if (sub) {
      for (let i = 0; i < 2; i++) { const a = s.rand(0, TAU), d = s.rand(0.4, 0.9) * (rad + 0.3); s.add(bolt(s, R, [x, y, zz + 0.4], [x + Math.cos(a) * d, y + Math.sin(a) * d, 0], s.rand(0.12, 0.22), { wait: i * 0.05, glow: i === 0 })); }
      for (let i = 0, N = n(10); i < N; i++) s.add({ k: "spark", x, y, z: zz, ...flat(s, s.rand(4, 9), 0.8), g: 14, drag: 2, bounce: 0.5, life: s.rand(0.2, 0.45), R, update: jink, minor: i % 2 === 1 });
      s.add({ k: "acKnot", x, y, z: zz, r: 6, life: 0.25, R, seed: sd(s), update: still });
      return;
    }
    // forked bolts stab out to the floor; each re-strikes, a second wave follows
    const NB = Math.round((5 + rad * 3) * Math.min(1.4, pow) * (crit ? 1.3 : 1));
    for (let i = 0; i < NB; i++) {
      const a = (i / NB) * TAU + s.rand(-0.35, 0.35), d = s.rand(0.8, 1.5) * (rad + 0.6) * Math.min(1.3, mm), w = i < NB / 2 ? s.rand(0, 0.05) : s.rand(0.1, 0.22);
      const bx = x + Math.cos(a) * d, by = y + Math.sin(a) * d;
      s.add(bolt(s, R, [x, y, zz], [bx, by, 0], s.rand(0.22, 0.38), { wait: w, glow: i % 2 === 0 }));
      s.at(s.t + w, (s2) => { s2.light(bx, by, 0.05, 1.1, S(R, 0.83), 0.32, 0.22); for (let j = 0; j < 3; j++) s2.add({ k: "spark", x: bx, y: by, z: 0.05, ...flat(s2, s2.rand(2, 6), 0.9), g: 14, drag: 2, bounce: 0.5, life: s2.rand(0.15, 0.4), R, update: jink, minor: j > 1 }); });
      if (s.R() < 0.6) s.add({ k: "acFern", x: bx, y: by, r: s.rand(0.35, 0.6), life: 2.6, R, seed: sd(s), wait: w, debris: true, minor: true, update: still });
    }
    // the knot: tiny zigzags crackling round the core
    s.add({ k: "acKnot", x, y, z: zz, r: (6 + rad * 7) * Math.min(1.4, mm), life: 0.55, R, seed: sd(s), update: still });
    s.add({ k: "star", x, y, z: zz, L: 7 * mm, life: 3 / 12, R, update: still });
    // sparks: a fast spray that jinks and bounces
    for (let i = 0, N = n(30); i < N; i++) s.add({ k: "spark", x, y, z: zz, ...flat(s, s.rand(5, 13) * Math.min(1.3, pow), 0.8), g: 16, drag: 2.2, bounce: 0.5, life: s.rand(0.2, 0.6), R, update: jink, minor: i % 3 !== 0 });
    // streaks flung straight out
    for (let i = 0, N = n(10); i < N; i++) { const q = (i / N) * TAU + s.rand(-0.2, 0.2), sp = s.rand(7, 11); s.add({ k: "streak", x, y, z: zz, vx: Math.cos(q) * sp, vy: Math.sin(q) * sp, vz: s.rand(-0.3, 0.5), drag: 3.5, life: s.rand(0.18, 0.3), R, minor: i % 2 === 1 }); }
    // the floor: a burn fern under the core, grit thrown, ozone curling up
    s.add({ k: "acFern", x, y, r: rad * 1.2 + 0.55, life: 3.6, R, seed: sd(s), debris: true, update: still });
    s.light(x, y, 0.05, rad * 1.4 + 1, S(R, 0.67), 0.3, 2.2, { flicker: true });
    // the charge bleeding off: sparks still spitting from the scorch for two seconds
    for (let i = 0, N = n(8); i < N; i++) { const a = s.rand(0, TAU), d = s.rand(0, rad + 0.4); s.add({ k: "spark", x: x + Math.cos(a) * d, y: y + Math.sin(a) * d, z: 0.05, vx: s.rand(-2, 2), vy: s.rand(-2, 2), vz: s.rand(1.5, 3.5), g: 14, drag: 1.5, bounce: 0.4, life: s.rand(0.25, 0.45), R, wait: s.rand(0.4, 2.2), update: jink, minor: i % 2 === 1 }); }
    for (let i = 0, N = n(12); i < N; i++) s.add(grit(s, x, y, 0.05, s.rand(2, 6), RAMP.kinetic));
    for (let i = 0, N = n(5); i < N; i++) s.add(ozone(s, R, x + s.rand(-0.4, 0.4) * rad, y + s.rand(-0.4, 0.4) * rad, zz, { wait: s.rand(0.1, 0.4) }));
    s.add({ k: "flBand", x, y, r: rad * 1.5 + 1.5 * Math.min(1.3, mm), life: 0.4, R, dust: RAMP.kinetic, th: 2 + rad * 1.5, update: still });
    // after-crackle: bolts that keep finding the floor while it discharges
    const after = Math.round(5 + rad * 4);
    for (let i = 0; i < after; i++) {
      const t = s.rand(0.35, 2.1), a = s.rand(0, TAU), d = s.rand(0.3, 1) * (rad + 0.5), a2 = a + s.rand(-1.2, 1.2), d2 = d * s.rand(0.3, 0.9);
      s.add(bolt(s, R, [x + Math.cos(a) * d, y + Math.sin(a) * d, 0.05], [x + Math.cos(a2) * d2, y + Math.sin(a2) * d2, 0.05], 0.1, { wait: t, glow: false, minor: true }));
      s.at(s.t + t, (s2) => s2.light(x + Math.cos(a) * d, y + Math.sin(a) * d, 0.05, 0.9, S(R, 0.83), 0.3, 0.12));
    }
    flourish(s, M, x, y, z, rad, Math.round(6 * m));
  },
  trail(s, M, { x, y, z, dt }) {
    const R = M.R;
    for (let i = s.count(46 * s.m, dt); i > 0; i--) s.add({ k: "spark", x, y, z, vx: s.rand(-3, 3), vy: s.rand(-3, 3), vz: s.rand(-1, 2.5), g: 8, drag: 1.5, life: s.rand(0.15, 0.4), R, update: jink, minor: i % 2 === 0 });
    if (s.R() < 14 * dt) { const a = s.rand(0, TAU), d = s.rand(0.3, 0.7); s.add(bolt(s, R, [x, y, z], [x + Math.cos(a) * d, y + Math.sin(a) * d, Math.max(0, z + s.rand(-0.5, 0.2))], 0.08, { glow: false, minor: true })); }
    for (let i = s.count(5 * s.m, dt); i > 0; i--) s.add(ozone(s, R, x, y, z, { r: s.rand(2, 3), life: s.rand(0.4, 0.7) }));
  },
  /** The projectile draws a live bolt back to the hand. */
  projectileBolt: true,
  linger(s, M, { at, spot, k, dt }) {
    const R = M.R;
    if (s.R() < 6 * k * dt) {
      const a = spot(), b = spot();
      s.add(bolt(s, R, [a[0], a[1], 0.05], [b[0], b[1], 0.05], 0.14, { glow: false }));
      s.light(a[0], a[1], 0.05, 1, S(R, 0.83), 0.5, 0.14);
    }
    at(9, () => ({ k: "spark", vx: s.rand(-2, 2), vy: s.rand(-2, 2), vz: s.rand(1, 3), g: 10, life: s.rand(0.25, 0.45), update: jink, minor: true }));
    at(1, () => ({ k: "flHaze", z: 0.2, vz: 0.3, g: -0.2, drag: 1.5, r: s.rand(3, 5), life: s.rand(0.8, 1.2), tone: 0.5, toneEnd: 0.33, a: 0.4, grow: 0.8, seed: sd(s), minor: true }));
  },
  spray(s, M, { emit, hand, dir, half, len, dt }) {
    const R = M.R;
    if (s.R() < 22 * dt) {
      const q = dir + s.rand(-half, half), d = s.rand(len * 0.5, len * 0.95), b = [hand[0] + Math.cos(q) * d, hand[1] + Math.sin(q) * d, s.rand(0.05, 0.6)];
      s.add(bolt(s, R, hand, b, s.rand(0.1, 0.16), { glow: s.R() < 0.4 }));
      s.light(b[0], b[1], 0.1, 1.2, S(R, 0.83), 0.55, 0.16);
      for (let j = 0; j < 3; j++) s.add({ k: "spark", x: b[0], y: b[1], z: b[2], ...flat(s, s.rand(2, 5), 0.9), g: 12, drag: 2, bounce: 0.5, life: s.rand(0.15, 0.35), R, update: jink, minor: true });
    }
    emit("spark", 50, () => ({ drag: 1.4, g: 3, life: s.rand(0.35, 0.6), update: jink, minor: true }));
    emit("streak", 14, () => ({ drag: 2, life: 0.3 }));
  },
  aura(s, M, { at, body, dt }) {
    const R = M.R;
    if (s.R() < 7 * dt) { const a = body(true), b = body(true); s.add(bolt(s, R, [a.x, a.y, a.z], [b.x, b.y, b.z], 0.1, { glow: false })); }
    if (s.R() < 1.5 * dt) { const a = body(true), b = body(false); s.add(bolt(s, R, [a.x, a.y, a.z], [b.x, b.y, 0.02], 0.12)); s.light(b.x, b.y, 0.05, 0.8, S(R, 0.83), 0.45, 0.12); }
    at(9, () => ({ k: "spark", vx: s.rand(-2, 2), vy: s.rand(-2, 2), vz: s.rand(0, 2.5), g: 9, life: s.rand(0.25, 0.4), update: jink }));
  },
};

/* ── shapes ───────────────────────────────────────────────────────────── */

const DIRS8 = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];

registerShapes({
  /** A knot of tiny zigzags crackling inside radius r: re-drawn every frame at 20 fps, white while young. */
  acKnot(v, P, p) {
    const u = clamp(p.age / p.life), fr = Math.floor(p.age * 20), r = rng(p.seed + fr * 131), [cx, cy] = v.ap(p.x, p.y, p.z), rr = p.r * (0.6 + 0.4 * u);
    const N = Math.round(5 + p.r * 0.5), a = 1 - u * u;
    for (let i = 0; i < N; i++) {
      let x = cx + (r() - 0.5) * rr * 1.4, y = cy + (r() - 0.5) * rr * 1.4, d = DIRS8[Math.floor(r() * 8)];
      const L = 3 + Math.floor(r() * 5);
      for (let s = 0; s < L; s++) {
        if (r() < 0.35) d = DIRS8[(DIRS8.indexOf(d) + (r() < 0.5 ? 1 : 7)) % 8];
        x += d[0]; y += d[1];
        P.dot(x, y, u < 0.25 && s < 2 ? WHITE : S(p.R, s < L / 2 ? 1 : 0.83), a, 2);
      }
    }
  },
}, {});

registerShapes({
  /** A fern of burn marks: branches walked out in 45° steps, glowing hot then cooling to soot. */
  acFern(v, P, p) {
    const t = p.age, fade = clamp((p.life - t) / 0.8), grow = clamp(t / 0.12), heat = clamp(1 - t / 2), [cx, cy] = v.ap(p.x, p.y, 0), r = rng(p.seed), rr = p.r * v.aps;
    const N = 5 + Math.floor(r() * 3), soot = RAMP.smoke;
    for (let b = 0; b < N; b++) {
      let x = cx, y = cy, di = Math.floor((b / N) * 8 + r() * 1.5) % 8;
      const L = Math.round(rr * (0.55 + r() * 0.45) * grow);
      for (let s = 0; s < L; s++) {
        const rv = r(); if (rv < 0.25) di = (di + 7) % 8; else if (rv > 0.75) di = (di + 1) % 8;
        x += DIRS8[di][0]; y += DIRS8[di][1] * v.sq;
        const f = s / Math.max(1, L), hot = heat * (1 - f * 0.7);
        const c = hot > 0.55 ? S(p.R, 1) : hot > 0.25 ? S(p.R, 0.67) : hot > 0.08 ? S(p.R, 0.33) : S(soot, 0.17);
        P.dot(x, y, c, fade * (hot > 0.08 ? 1 : 0.7));
        // side twigs
        if (s > 2 && hash(b, s, p.seed) < 0.12) { const tw = DIRS8[(di + (hash(s, b, p.seed) < 0.5 ? 2 : 6)) % 8]; for (let k = 1; k <= 2; k++) P.dot(x + tw[0] * k, y + tw[1] * k * v.sq, c, fade * 0.8); }
      }
    }
  },
}, { flat: ["acFern"] });
