/**
 * Radiance: vitality, holy, light. One family, three temperaments:
 *
 *   holy      gold: a pillar of light, rising motes and crosses, halos, and a
 *             turning sunburst of rays (the look this family was tuned for)
 *   vitality  warm green-gold life: motes that rise in a fountain and leaves of
 *             light that tumble up and away; no pillar, no halo
 *   light     plain white-gold glare: a long anamorphic flare, a hot core, a
 *             few sparks; nothing sacred about it
 */

import { TAU, clamp, fadeOut, hash } from "../core/rand.mjs";
import { S, rotateRamp } from "../core/palette.mjs";
import { registerShapes, snapH } from "../core/shapes.mjs";
import { still, releaseFlash, counter, flourish } from "../core/motifs.mjs";

const hex = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
/** Leaves of light: vitality's second ramp, green under gold, rotated with the look's hue. */
const LEAF = Object.freeze(["#10200c", "#24401a", "#3e6a1e", "#6e9a26", "#a8c83a", "#e2ec7a", "#fbffd0"].map(hex));
const leafRamp = (s) => (Number.isFinite(s.spec.look?.hue) ? rotateRamp(LEAF, s.spec.look.hue) : LEAF);

/** A leaf turning in the air: four poses, a lit blade and a darker vein. */
const LEAF_POSE = [
  [[0, 0, 0.95], [1, -1, 0.95], [-1, 1, 0.62], [1, 0, 0.72]],
  [[0, 0, 0.95], [1, 0, 0.95], [-1, 0, 0.62], [0, -1, 0.72]],
  [[0, 0, 0.95], [-1, -1, 0.95], [1, 1, 0.62], [-1, 0, 0.72]],
  [[0, 0, 0.85], [0, -1, 0.95], [0, 1, 0.62]],
];

registerShapes({
  radLeaf(v, P, p) {
    let [x, y] = v.ap(p.x, p.y, p.z); [x, y] = snapH(p, v, x, y);
    const fr = Math.floor(p.age * 8 + p.seed * 4) % 4, a = Math.min(1, p.age * 10) * fadeOut(p.age / p.life, 0.65);
    for (const [dx, dy, t] of LEAF_POSE[fr]) P.dot(x + dx, y + dy, S(p.R, t), a, 1);
  },

  /** Holy's sunburst: long and short rays turning slowly about a point. */
  radRays(v, P, p) {
    const u = clamp(p.age / p.life), fr = Math.floor(p.age * 12), [cx, cy] = v.ap(p.x, p.y, p.z);
    const grow = Math.min(1, (fr + 1) / 3), a = fadeOut(u, 0.45), n = p.n ?? 12, rot = fr * 0.05;
    for (let i = 0; i < n; i++) {
      const q = rot + (i * TAU) / n, L = p.L * grow * (i % 2 ? 0.55 : 1), r0 = p.L * 0.22;
      P.line(cx + Math.cos(q) * r0, cy + Math.sin(q) * r0 * p.flat, cx + Math.cos(q) * L, cy + Math.sin(q) * L * p.flat, null, 1, a, (f) => S(p.R, f < 0.5 ? 0.95 : 0.72));
    }
  },

  /** Light's glare: a hot core and an anamorphic flare, long across, short up. */
  radGlare(v, P, p) {
    const fr = Math.floor(p.age * 12); if (fr > 6) return;
    const [x, y] = v.ap(p.x, p.y, p.z), k = [0.6, 1, 1.15, 1, 0.8, 0.55, 0.3][fr], L = p.L * k;
    const hot = fr < 2 ? S(p.R, 1) : S(p.R, 0.95), warm = S(p.R, 0.8), dim = S(p.R, 0.6);
    for (let i = -Math.round(L * 2.4); i <= Math.round(L * 2.4); i++) { const e = Math.abs(i) / (L * 2.4); P.px(x + i, y, e < 0.4 ? hot : e < 0.75 ? warm : dim, 2); }
    for (let j = 1; j <= L; j++) { const c = j < L * 0.5 ? hot : warm; P.px(x, y - j, c, 2); P.px(x, y + j, c, 2); }
    for (let d = 1; d <= L * 0.4; d++) { P.px(x + d, y + d, warm, 2); P.px(x - d, y - d, warm, 2); P.px(x + d, y - d, warm, 2); P.px(x - d, y + d, warm, 2); }
    const c = Math.max(1, Math.round(L * 0.25));
    for (let j = -c; j <= c; j++) for (let i = -c; i <= c; i++) if (Math.abs(i) + Math.abs(j) <= c) P.px(x + i, y + j, hot, 2);
  },

  /**
   * What a release leaves on the floor. Vitality: a green patch where sprouts
   * push up and sway. Light: an afterglow pool, hot in the middle, that cools.
   */
  radPool(v, P, p) {
    const u = p.age / p.life, a = Math.min(1, p.age * 6) * fadeOut(u, p.glow ? 0.25 : 0.5), fr = Math.floor(p.age * 12);
    const [cx, cy] = v.ap(p.x, p.y, 0), rx = p.r * v.aps, ry = rx * v.sq;
    if (rx < 2) return;
    P.shade(cx - rx, cy - ry, cx + rx, cy + ry, (x, y) => {
      const dx = (x - cx) / rx, dy = (y - cy) / ry, d = dx * dx + dy * dy;
      if (d > 1) return null;
      return p.glow ? { c: S(p.R, d < 0.3 ? 0.95 : 0.8), a: a * (d < 0.3 ? 0.5 : 0.3) } : { c: S(p.R, d < 0.4 ? 0.5 : 0.38), a: a * (d < 0.4 ? 0.42 : 0.3) };
    }, 0, "mix");
    if (p.glow) { P.ellipse(cx, cy, rx, ry, (q) => ({ c: S(p.R, Math.sin(q) < 0 ? 0.95 : 0.8), a: a * 0.7 })); return; }
    const n = Math.round(4 + rx * 0.35), grow = Math.min(1, (fr + 1) / 6);
    for (let i = 0; i < n; i++) {
      const q = hash(i, p.seed) * TAU, d = Math.sqrt(hash(i, p.seed, 1)) * 0.85;
      const x = Math.round(cx + Math.cos(q) * rx * d), y = Math.round(cy + Math.sin(q) * ry * d), h = Math.ceil((2 + (i % 2)) * grow);
      const lean = ((fr >> 2) + i) % 4 === 0 ? 1 : 0;
      for (let j = 0; j < h; j++) P.dot(x + (j === h - 1 ? lean : 0), y - j, S(p.R, j === h - 1 ? 0.92 : 0.62), a, 1);
    }
  },
}, { flat: ["radPool"] });

const kindOf = (M) => (M.material === "vitality" ? "vitality" : M.material === "light" ? "light" : "holy");

/*
 * `sub`: one of many eruptions across an area (area.mjs). Lighter: no pillar,
 * no sunburst, no glare, no floor decal (the scar is areaFX's), fewer motes.
 */

function holyBurst(s, M, { x, y, z, pow, rad, sub }) {
  const R = M.R, m = s.m * pow, mm = Math.min(1.6, m), n0 = counter(s, pow, rad), n = sub ? (k) => Math.ceil(n0(k) / 2) : n0;
  releaseFlash(s, M, x, y, z, pow, rad);
  if (sub) {
    for (let i = 0; i < n(22); i++) s.add({ k: "mote", x: x + s.rand(-1, 1) * rad * 0.7, y: y + s.rand(-1, 1) * rad * 0.7, z: s.rand(0, 0.6), vz: s.rand(0.6, 1.8), g: -0.3, drag: 1.4, life: s.rand(0.8, 1.5), R, plus: s.R() < 0.5, minor: i % 3 === 2 });
    s.add({ k: "halo", x, y, z: 0.05, vz: 1, drag: 0.8, life: 0.8, r: rad * 0.55 + 0.2, R });
    return;
  }
  s.add({ k: "beam", x, y, h: 2.4 * Math.min(1.4, m), w: 4 * mm * (0.7 + rad * 0.3), life: 0.9, R, update: still });
  if (pow >= 0.5) s.add({ k: "radRays", x, y, z: z + 0.15, L: (8 + rad * 6) * Math.min(1.3, mm), n: pow > 1.2 ? 16 : 12, flat: 0.75, life: 0.8, R, wait: 0.04, update: still });
  for (let i = 0; i < n(22); i++) s.add({ k: "mote", x: x + s.rand(-1, 1) * rad * 0.7, y: y + s.rand(-1, 1) * rad * 0.7, z: s.rand(0, 0.6), vz: s.rand(0.6, 1.8), g: -0.3, drag: 1.4, life: s.rand(0.8, 1.5), R, plus: s.R() < 0.5, minor: i % 3 === 2 });
  for (let i = 0; i < 3; i++) s.add({ k: "halo", x, y, z: 0.05, vz: s.rand(0.9, 1.2), drag: 0.8, life: 0.9, r: rad * 0.55 + 0.25, R, wait: i * 0.14 });
  for (let i = 0; i < n(4); i++) s.add({ k: "glint", x: x + s.rand(-1, 1) * rad * 0.6, y: y + s.rand(-1, 1) * rad * 0.6, z: s.rand(0.2, 1), life: 5 / 12, R, wait: s.rand(0, 0.4), update: still });
  flourish(s, M, x, y, z, rad, Math.round(5 * m));
}

function vitalityBurst(s, M, { x, y, z, pow, rad, sub }) {
  const R = M.R, L = leafRamp(s), m = s.m * pow, n0 = counter(s, pow, rad), n = sub ? (k) => Math.ceil(n0(k) / 2) : n0;
  releaseFlash(s, M, x, y, z, pow, rad);
  // a fountain: motes rise in a slow spiral, leaves of light tumble up and outward
  const nm = n(20);
  for (let i = 0; i < nm; i++) {
    const q = (i / nm) * TAU * 2, r = s.rand(0.1, 0.5) * (rad + 0.3);
    s.add({ k: "mote", x: x + Math.cos(q) * r, y: y + Math.sin(q) * r * 0.6, z: s.rand(0, 0.3), vx: -Math.sin(q) * 0.5, vy: Math.cos(q) * 0.3, vz: s.rand(0.8, 1.9), g: -0.2, drag: 1.3, life: s.rand(0.8, 1.4), R: i % 3 ? R : L, plus: s.R() < 0.55, wait: s.rand(0, 0.15), minor: i % 3 === 2 });
  }
  for (let i = 0; i < n(12); i++) {
    const q = s.rand(0, TAU), sp = s.rand(0.6, 1.6);
    s.add({ k: "radLeaf", x: x + s.rand(-0.2, 0.2) * rad, y: y + s.rand(-0.2, 0.2) * rad, z: z * 0.5, vx: Math.cos(q) * sp, vy: Math.sin(q) * sp * 0.6, vz: s.rand(1, 2.2), g: 0.9, drag: 2, life: s.rand(1, 1.7), R: L, seed: s.R(), wait: s.rand(0, 0.12) });
  }
  if (sub) return;
  if (pow >= 0.5) s.add({ k: "ring", x, y, r: rad * 1.1 + 0.3, life: 0.7, R: L, seed: sd0(s), update: still });
  if (pow >= 0.5) s.add({ k: "radPool", x, y, r: rad * 0.8 + 0.15, life: 4.5, R: L, seed: sd0(s), debris: true, update: still });
  s.light(x, y, z, rad * 2 + 1, S(L, 0.85), 0.5 * Math.min(1.6, m), 1);
  flourish(s, M, x, y, z, rad, Math.round(5 * m));
}

function lightBurst(s, M, { x, y, z, pow, rad, sub }) {
  const R = M.R, m = s.m * pow, mm = Math.min(1.6, m), n = counter(s, pow, rad);
  releaseFlash(s, M, x, y, z, pow, rad);
  if (sub) {
    for (let i = 0; i < 3; i++) s.add({ k: "glint", x: x + s.rand(-1, 1) * (rad + 0.1), y: y + s.rand(-1, 1) * (rad + 0.1) * 0.6, z: Math.max(0.05, z + s.rand(-0.2, 0.4)), life: 5 / 12, R, wait: s.rand(0, 0.2), minor: i > 0, update: still });
    for (let i = 0; i < 3; i++) { const q = s.rand(0, TAU), sp = s.rand(2, 4); s.add({ k: "spark", x, y, z, vx: Math.cos(q) * sp, vy: Math.sin(q) * sp * 0.5, vz: s.rand(0, 1.2), drag: 3, life: 0.25, R, minor: true }); }
    return;
  }
  s.add({ k: "radGlare", x, y, z, L: (5 + rad * 4) * Math.min(1.4, mm), life: 7 / 12, R, update: still });
  s.light(x, y, z, rad * 2.6 + 1.4, S(R, 0.9), 0.9 * mm, 0.6);
  if (pow >= 0.5) s.add({ k: "radPool", x, y, r: rad * 0.75 + 0.15, life: 2.8, R, glow: true, seed: sd0(s), debris: true, update: still });
  for (let i = 0; i < n(8); i++) { const q = s.rand(0, TAU), sp = s.rand(3, 6); s.add({ k: "spark", x, y, z, vx: Math.cos(q) * sp, vy: Math.sin(q) * sp * 0.5, vz: s.rand(-0.5, 1.5), drag: 3, life: s.rand(0.2, 0.35), R, minor: i % 2 === 1 }); }
  for (let i = 0; i < n(5); i++) s.add({ k: "glint", x: x + s.rand(-1, 1) * (rad + 0.2), y: y + s.rand(-1, 1) * (rad + 0.2) * 0.6, z: Math.max(0.05, z + s.rand(-0.3, 0.5)), life: 5 / 12, R, wait: s.rand(0.05, 0.3), minor: i > 2, update: still });
  flourish(s, M, x, y, z, rad, Math.round(5 * m));
}

const sd0 = (s) => s.seedInt();

export default {
  id: "radiance",
  burst(s, M, o) {
    const k = kindOf(M);
    if (k === "vitality") vitalityBurst(s, M, o); else if (k === "light") lightBurst(s, M, o); else holyBurst(s, M, o);
  },
  trail(s, M, { x, y, z, dt }) {
    const k = kindOf(M);
    for (let i = s.count((k === "light" ? 30 : 50) * s.m, dt); i > 0; i--) s.add({ k: "mote", x, y, z, vx: s.rand(-0.3, 0.3), vy: s.rand(-0.3, 0.3), g: -0.8, drag: 1, life: s.rand(0.4, 0.7), R: M.R, plus: s.R() < 0.3, minor: true });
    if (k === "vitality") for (let i = s.count(9 * s.m, dt); i > 0; i--) s.add({ k: "radLeaf", x, y, z, vx: s.rand(-0.5, 0.5), vy: s.rand(-0.4, 0.4), vz: s.rand(0.2, 0.7), g: 0.6, drag: 2, life: s.rand(0.6, 1), R: leafRamp(s), seed: s.R(), minor: true });
    if (k === "light") for (let i = s.count(6 * s.m, dt); i > 0; i--) s.add({ k: "glint", x, y, z, life: 5 / 12, R: M.R, minor: true, update: still });
  },
  linger(s, M, { at }) {
    const k = kindOf(M);
    at(k === "light" ? 3 : 9, () => ({ k: "mote", vz: s.rand(0.5, 1.2), g: -0.3, drag: 1, life: s.rand(0.7, 1.2), plus: s.R() < 0.4 }));
    if (k === "vitality") at(3, () => ({ k: "radLeaf", z: 0.1, vz: s.rand(0.5, 1), vx: s.rand(-0.3, 0.3), g: 0.25, drag: 1.5, life: s.rand(1, 1.5), R: leafRamp(s), seed: s.R() }));
    if (k === "light") at(2, () => ({ k: "glint", z: s.rand(0.1, 0.6), life: 5 / 12, big: s.R() < 0.3, update: still }));
  },
  spray(s, M, { emit }) {
    const k = kindOf(M);
    emit("mote", k === "light" ? 60 : 90, () => ({ drag: 1.6, g: -0.4, life: 0.7, plus: s.R() < 0.3 }));
    if (k === "vitality") emit("radLeaf", 30, () => ({ drag: 1.8, g: 0.3, life: 0.9, R: leafRamp(s), seed: s.R() }));
    if (k === "light") emit("spark", 40, () => ({ drag: 1.2, life: 0.35, minor: true }));
  },
  aura(s, M, { at }) {
    const k = kindOf(M);
    at(k === "light" ? 6 : 12, () => ({ k: "mote", vz: s.rand(0.5, 1.1), g: -0.3, drag: 1, life: s.rand(0.7, 1.2), plus: s.R() < 0.5 }));
    if (k === "vitality") at(2.5, () => ({ k: "radLeaf", vz: s.rand(0.4, 0.8), vx: s.rand(-0.3, 0.3), g: 0.2, drag: 1.5, life: s.rand(0.9, 1.3), R: leafRamp(s), seed: s.R() }));
    if (k === "light") at(1.5, () => ({ k: "glint", life: 5 / 12, update: still }));
  },
  tick(s, M, T) {
    const k = kindOf(M);
    if (k === "light") { s.add({ k: "radGlare", x: T.x, y: T.y, z: 0.7 * T.h, L: 5, life: 7 / 12, R: M.R, update: still }); return; }
    if (k === "vitality") {
      for (let i = 0; i < 6; i++) s.add({ k: "radLeaf", x: T.x + s.rand(-0.2, 0.2), y: T.y, z: 0.2, vx: s.rand(-0.6, 0.6), vz: s.rand(1, 1.6), g: 0.8, drag: 2, life: 1.1, R: leafRamp(s), seed: s.R() });
      s.add({ k: "ring", x: T.x, y: T.y, r: 0.5 * T.size, life: 0.6, R: leafRamp(s), seed: 4, update: still });
      return;
    }
    s.add({ k: "halo", x: T.x, y: T.y, z: 0.05, vz: 1.1, drag: 0.8, life: 0.9, r: 0.45 * T.size, R: M.R });
    s.add({ k: "beam", x: T.x, y: T.y, h: 1.8, w: 3, life: 0.7, R: M.R, update: still });
  },
  /** A tick here is good news: no flinch. */
  gentle: true,
};
