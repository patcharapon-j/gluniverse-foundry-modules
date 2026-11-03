/**
 * Umbra: void, unholy, shadow. Three kinds of dark:
 *
 *   void     light pulled inward: streaks spiralling into a dark core with a
 *            bright rim, a dark pool, wisps rising after (the look this family
 *            was tuned for)
 *   unholy   crimson-black and sharp: a thorned sigil cut into the floor,
 *            blood-dark spikes that punch up, ragged smoke
 *   shadow   soft dark smoke: rolling clouds that spread and settle, no hard
 *            core and almost no light
 */

import { TAU, fadeOut, hash } from "../core/rand.mjs";
import { S } from "../core/palette.mjs";
import { registerShapes } from "../core/shapes.mjs";
import { out, sd, lobes, still, releaseFlash, counter, flourish } from "../core/motifs.mjs";

registerShapes({
  /** Unholy's sigil: a ring, an inverted star and thorns, cut hard into the floor. */
  umbSigil(v, P, p) {
    const u = p.age / p.life, fr = Math.floor(p.age * 12), [cx, cy] = v.ap(p.x, p.y, 0), r = p.r * v.aps * Math.min(1, (fr + 1) / 3), sq = v.sq;
    const a = p.life >= 1e8 ? 0.75 : u < 0.1 ? u / 0.1 : fadeOut(u, 0.6);
    if (r < 2) return;
    P.ellipse(cx, cy, r, r * sq, () => ({ c: S(p.R, 0.82), a }));
    P.ellipse(cx, cy, r * 0.8, r * 0.8 * sq, (q) => (Math.floor((q / TAU) * 24) % 2 ? null : { c: S(p.R, 0.55), a }));
    for (let i = 0; i < 5; i++) {
      // pointing down: the star's tip at the bottom of the circle
      const q0 = Math.PI / 2 + (i * TAU) / 5, q1 = Math.PI / 2 + ((i + 2) * TAU) / 5;
      P.line(cx + Math.cos(q0) * r * 0.78, cy + Math.sin(q0) * r * 0.78 * sq, cx + Math.cos(q1) * r * 0.78, cy + Math.sin(q1) * r * 0.78 * sq, S(p.R, 0.95), 0, a);
    }
    for (let i = 0; i < 10; i++) {
      const q = (i * TAU) / 10 + 0.31, L = (i % 2 ? 0.18 : 0.32) * (1 + 0.3 * hash(i, p.seed));
      P.line(cx + Math.cos(q) * r, cy + Math.sin(q) * r * sq, cx + Math.cos(q) * r * (1 + L), cy + Math.sin(q) * r * (1 + L) * sq, S(p.R, 0.72), 0, a);
    }
  },
}, { flat: ["umbSigil"] });

const kindOf = (M) => (M.material === "unholy" ? "unholy" : M.material === "shadow" ? "shadow" : "void");

/*
 * `sub`: one of many eruptions across an area (area.mjs). Lighter: no ground
 * decal (the area's scar is areaFX's), no extra rings, no hero beats.
 */

function voidBurst(s, M, { x, y, z, pow, rad, sub }) {
  const R = M.R, m = s.m * pow, n = counter(s, pow, rad);
  releaseFlash(s, M, x, y, z, pow, rad);
  for (let i = 0; i < n(sub ? 8 : 16); i++) {
    const q = s.rand(0, TAU), L = rad * 1.1 + 0.4, px = x + Math.cos(q) * L, py = y + Math.sin(q) * L, pz = z + s.rand(-0.3, 0.6), life = 0.26, tq = q + Math.PI / 2;
    s.add({ k: "streak", x: px, y: py, z: pz, vx: (x - px) / life + Math.cos(tq) * 1.2, vy: (y - py) / life + Math.sin(tq) * 1.2, vz: (z - pz) / life, life, R, update(p, _s, dt) { p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; } });
  }
  s.add({ k: "core", x, y, z, life: 0.75, r: (rad * 0.3 + 0.2) * s.spec.aps * 0.6 * Math.min(1.5, m), R, seed: sd(s), update: still });
  if (!sub) s.add({ k: "darkpool", x, y, r: rad * 1.3 + 0.3, life: 1.6, R, debris: true, update: still });
  s.at(s.t + 0.25, (s2) => {
    for (let i = 0; i < n(sub ? 6 : 12); i++) s2.add({ k: "wisp", x, y, z, ...out(s2, s2.rand(1, 2.5)), drag: 2.2, g: -0.4, life: s2.rand(0.7, 1.2), s: s2.R() < 0.5 ? 2 : 3, R, minor: i % 3 === 2 });
    if (pow >= 0.5 && !sub) s2.add({ k: "ring", x, y, r: rad * 1.2 + 0.3, life: 0.5, R, broken: true, seed: 7, update: still });
  });
  flourish(s, M, x, y, z, rad, Math.round(5 * m));
}

function unholyBurst(s, M, { x, y, z, pow, rad, sub }) {
  const R = M.R, m = s.m * pow, mm = Math.min(1.6, m), n = counter(s, pow, rad);
  releaseFlash(s, M, x, y, z, pow, rad);
  if (!sub) s.add({ k: "core", x, y, z, life: 0.5, r: (rad * 0.25 + 0.15) * s.spec.aps * 0.6 * Math.min(1.5, m), R, seed: sd(s), update: still });
  if (pow >= 0.5 && !sub) s.add({ k: "umbSigil", x, y, r: rad * 1.05 + 0.35, life: 2.2, R, seed: sd(s), debris: true, update: still });
  // thorns punch up through the sigil, sharpest at the centre
  const N = sub ? 2 : pow >= 0.5 ? Math.round((3 + rad * 4) * Math.min(1.4, mm)) : 2;
  for (let i = 0; i < N; i++) {
    const a = s.rand(0, TAU), d = Math.sqrt(s.R()) * (rad * 0.9 + 0.15);
    s.add({ k: "crystal", x: x + Math.cos(a) * d, y: y + Math.sin(a) * d, z: 0, h: s.rand(9, 17) * Math.min(1.4, mm) * (1 - (d / (rad + 0.6)) * 0.4), w: s.rand(1.5, 2.5), lean: Math.cos(a) * s.rand(1, 4), life: s.rand(1, 1.5), R, wait: 0.05 + d * 0.08, debris: true, update: still });
  }
  for (let i = 0; i < n(sub ? 5 : 10); i++) s.add({ k: "shard", x, y, z, ...out(s, s.rand(2.5, 5)), g: 8, drag: 1.2, bounce: 0.3, life: s.rand(0.6, 1.1), R, seed: s.R(), minor: i % 2 === 1 });
  for (let i = 0; i < n(sub ? 2 : 4); i++) s.add({ k: "smoke", x: x + s.rand(-0.4, 0.4) * rad, y: y + s.rand(-0.3, 0.3) * rad, z: z + s.rand(0, 0.5), vz: s.rand(0.3, 0.6), g: -0.15, drag: 1.5, r: s.rand(3.5, 5.5) * Math.min(1.4, m), life: s.rand(1, 1.5), lobes: lobes(s), R, tone: 0.22, wait: s.rand(0.1, 0.25) });
  flourish(s, M, x, y, z, rad, Math.round(5 * m));
}

function shadowBurst(s, M, { x, y, z, pow, rad, sub }) {
  const R = M.R, m = s.m * pow, mm = Math.min(1.6, m), n = counter(s, pow, rad);
  // no hero flash: shadow arrives, it does not explode
  s.light(x, y, z, rad * 2 + 1, S(R, 0.85), 0.35 * mm, 0.9);
  if (pow > 1.2 && !sub) s.crit();
  const nc = n(sub ? 4 : 9);
  for (let i = 0; i < nc; i++) {
    const q = (i / nc) * TAU + s.rand(-0.3, 0.3), sp = s.rand(0.6, 1.6) * (0.6 + rad * 0.4);
    s.add({ k: "smoke", x: x + Math.cos(q) * 0.1, y: y + Math.sin(q) * 0.1, z: Math.max(0.1, z * s.rand(0.3, 1)), vx: Math.cos(q) * sp, vy: Math.sin(q) * sp * 0.7, vz: s.rand(-0.1, 0.25), drag: 2.2, g: 0.05, r: s.rand(4, 6.5) * Math.min(1.4, mm), life: s.rand(1.2, 1.9), lobes: lobes(s), R, tone: s.R() < 0.5 ? 0.3 : 0.45, wait: s.rand(0, 0.12) });
  }
  if (!sub) s.add({ k: "darkpool", x, y, r: rad * 1.4 + 0.35, life: 2.4, R, debris: true, update: still });
  for (let i = 0; i < n(sub ? 3 : 8); i++) s.add({ k: "wisp", x: x + s.rand(-1, 1) * rad * 0.6, y: y + s.rand(-1, 1) * rad * 0.5, z: 0.05, vz: s.rand(0.3, 0.7), vx: s.rand(-0.4, 0.4), g: -0.1, drag: 1.5, life: s.rand(0.8, 1.3), s: 2, R, wait: s.rand(0.2, 0.5), minor: i % 2 === 1 });
  if (pow >= 0.5 && !sub) s.add({ k: "ring", x, y, r: rad * 1.2 + 0.3, life: 0.7, R, broken: true, seed: sd(s), update: still });
  flourish(s, M, x, y, z, rad, Math.round(5 * m));
}

export default {
  id: "umbra",
  dark: true,
  burst(s, M, o) {
    const k = kindOf(M);
    if (k === "unholy") unholyBurst(s, M, o); else if (k === "shadow") shadowBurst(s, M, o); else voidBurst(s, M, o);
  },
  trail(s, M, { x, y, z, dt }) {
    const k = kindOf(M);
    if (k === "shadow") {
      for (let i = s.count(22 * s.m, dt); i > 0; i--) s.add({ k: "smoke", x, y, z, vx: s.rand(-0.2, 0.2), vz: s.rand(0, 0.2), drag: 2.5, r: s.rand(1.8, 2.8), life: s.rand(0.4, 0.6), lobes: [[0, 0, 1], [0.5, 0.2, 0.65]], R: M.R, tone: 0.35 });
      return;
    }
    for (let i = s.count(40 * s.m, dt); i > 0; i--) s.add({ k: "wisp", x, y, z, vx: s.rand(-0.3, 0.3), vy: s.rand(-0.3, 0.3), g: -0.4, drag: 2, life: s.rand(0.35, 0.55), s: 2, R: M.R });
    if (k === "unholy") for (let i = s.count(12 * s.m, dt); i > 0; i--) s.add({ k: "spark", x, y, z, vx: s.rand(-1.5, 1.5), vy: s.rand(-1.5, 1.5), vz: s.rand(0, 1.5), g: 6, drag: 1, life: s.rand(0.2, 0.35), R: M.R, minor: true });
  },
  linger(s, M, { at }) {
    const k = kindOf(M);
    if (k === "shadow") { at(2.5, () => ({ k: "smoke", z: 0.15, vz: 0.12, vx: s.rand(-0.3, 0.3), drag: 1.5, r: s.rand(3.5, 5), life: s.rand(1.3, 1.8), lobes: lobes(s), tone: 0.35 })); return; }
    at(7, () => ({ k: "wisp", vz: s.rand(0.3, 0.7), g: -0.3, drag: 1.5, life: s.rand(0.8, 1.2), s: 2 }));
    if (k === "unholy") at(1.2, () => ({ k: "crystal", z: 0, h: s.rand(5, 9), w: 1.5, lean: s.rand(-2, 2), life: 1.2, debris: true, update: still }));
  },
  spray(s, M, { emit }) {
    const k = kindOf(M);
    if (k === "shadow") { emit("smoke", 45, () => ({ drag: 1.8, life: 0.8, r: s.rand(3, 4.5), lobes: lobes(s), tone: 0.35 })); return; }
    emit("wisp", 70, () => ({ drag: 1.6, g: -0.2, life: 0.6, s: 2 }));
    if (k === "unholy") emit("shard", 26, () => ({ drag: 1.4, g: 2, life: 0.6, seed: s.R() }));
  },
  aura(s, M, { at }) {
    const k = kindOf(M);
    if (k === "shadow") { at(2, () => ({ k: "smoke", vz: 0.15, drag: 1.5, r: s.rand(2.5, 3.5), life: 1.2, lobes: lobes(s), tone: 0.35 })); return; }
    at(10, () => ({ k: "wisp", vz: s.rand(0.3, 0.6), g: -0.3, drag: 1.5, life: s.rand(0.8, 1.2), s: s.R() < 0.5 ? 2 : 3 }));
  },
  auraStart(s, M, T) {
    if (kindOf(M) === "unholy") s.add({ k: "umbSigil", x: T.x, y: T.y, r: 0.55 * T.size, life: 1e9, R: M.R, seed: 3, update: still });
  },
};
