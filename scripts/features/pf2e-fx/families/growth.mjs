/**
 * Growth: wood, plant, fungal.
 *
 * Wood: thorny vines whip up out of the ground, splinters and bark chips fly,
 * a thorny tangle stays on the floor. Plant: leafy vines, leaves fluttering
 * down, petals, entangling tendrils on the floor. Fungal: mushrooms bloom in a
 * ring and each one puffs spores, pale mycelium threads spread underfoot.
 */

import { TAU, clamp, hash, fadeOut } from "../core/rand.mjs";
import { rotateRamp, hueOf, S } from "../core/palette.mjs";
import { registerShapes, snapH } from "../core/shapes.mjs";
import { out, sd, lobes, still, releaseFlash, counter, flourish } from "../core/motifs.mjs";
// splinters are earthwork's `sliver`, bark chips its `boulder`
import { settle } from "./earthwork.mjs";

const kindOf = (M) => (M.material === "fungal" ? "fungal" : M.material === "wood" ? "wood" : "plant");

/** Petals take the plant's ramp turned toward blossom, so a recoloured look keeps them in step. */
const PETALS = new WeakMap();
function petalRamp(R) {
  let P = PETALS.get(R);
  if (!P) { P = rotateRamp(R, (hueOf(R) + 225) % 360); PETALS.set(R, P); }
  return P;
}

/** A mushroom puffs its spores once it has opened. */
function bloom(p, s) {
  if (p.puffed || p.age < 0.25) return;
  p.puffed = true;
  const z = (p.h / s.spec.aps) * 1.2;
  s.add({ k: "smoke", x: p.x, y: p.y, z, vz: 0.35, g: -0.05, drag: 1.8, r: Math.max(2, p.w * 0.9), life: s.rand(0.7, 1), lobes: [[0, 0, 1], [0.6, 0.2, 0.6], [-0.5, 0.25, 0.55]], R: p.R, tone: 0.67, minor: p.small });
  for (let i = 0; i < 3; i++) s.add({ k: "spore", x: p.x, y: p.y, z, vx: s.rand(-0.5, 0.5), vy: s.rand(-0.3, 0.3), vz: s.rand(0.3, 0.8), g: -0.1, drag: 2, life: s.rand(0.9, 1.5), R: p.R, seed: s.R(), minor: true });
}

/** Vines round a point, whipping in over it; nearest-first for the 3D view. */
function vines(s, R, x, y, rad, mm, thorn, n) {
  const list = [], q0 = hash(s.seed, 5) * TAU;
  for (let i = 0; i < n; i++) {
    let q, d;
    if (s.take === 0) { q = (i / n) * TAU + s.rand(-0.3, 0.3); d = rad * s.rand(0.45, 0.8); }
    else if (s.take === 1) { q = s.rand(0, TAU); d = Math.sqrt(s.R()) * rad * 0.75 + 0.1; }
    else { q = q0 + s.rand(-1.1, 1.1); d = rad * s.rand(0.5, 0.85); }
    const px = x + Math.cos(q) * d, py = y + Math.sin(q) * d;
    list.push({ k: "vine", x: px, y: py, h: s.rand(16, 26) * Math.min(1.4, mm), curl: -Math.sign(px - x || 1) * s.rand(0.8, 1.4), lean: Math.cos(q) * 0.25, life: s.rand(1.2, 1.8), R, seed: sd(s), thorn, wait: d * 0.08, debris: true, update: still });
  }
  list.sort((a, b) => b.y - a.y).forEach((p) => s.add(p));
}

/** Vines erupting along a cone or line, in a wave that runs out from the hand. */
function vineFront(s, M, { hand, dir, half, len, dt }, thorn) {
  const st = (s.growFront ??= { t0: s.t });
  const u = (s.t - st.t0) / 0.5;
  if (u > 1) return;
  const d = 0.7 + u * (len - 0.7), rate = (len * (half > 0.3 ? 3 : 2)) / 0.5;
  for (let i = s.count(rate, dt); i > 0; i--) {
    const q = dir + s.rand(-half, half) * 0.85, dd = d + s.rand(-0.25, 0.25);
    s.add({ k: "vine", x: hand[0] + Math.cos(q) * dd, y: hand[1] + Math.sin(q) * dd, h: s.rand(12, 20) * Math.min(1.3, s.m), curl: (s.R() < 0.5 ? -1 : 1) * s.rand(0.7, 1.3), lean: s.rand(-0.2, 0.2), life: s.rand(1, 1.4), R: M.R, seed: sd(s), thorn, debris: true, update: still });
  }
}

/* ── bursts ───────────────────────────────────────────────────────────── */

function woodOrPlant(s, M, { x, y, z, pow, rad, sub }, wood) {
  const R = M.R, m = s.m * pow, mm = Math.min(1.6, m), n = counter(s, pow, rad);
  releaseFlash(s, M, x, y, z, pow, rad);
  if (sub) {
    // an area eruption: one or two vines whipping up, a tangle under some of them
    if (s.R() < 0.3) s.add({ k: "tangle", x, y, r: rad * 0.8 + 0.2, n: 4, life: 4.5, R, seed: sd(s), thorn: wood, debris: true, update: still });
    vines(s, R, x, y, rad * 0.5, Math.max(0.8, mm), wood, s.R() < 0.5 ? 1 : 2);
  } else if (pow >= 0.5) {
    s.add({ k: "tangle", x, y, r: rad * 0.9 + 0.25, n: 7, life: 4.5, R, seed: sd(s), thorn: wood, debris: true, update: still });
    vines(s, R, x, y, rad, mm, wood, Math.round((3 + rad * 2.5) * Math.min(1.4, mm)));
  }
  const n2 = (k) => (sub ? Math.ceil(n(k) / 2) : n(k));
  if (wood) {
    for (let i = 0, N = n2(14); i < N; i++) s.add({ k: "sliver", x, y, z, ...out(s, s.rand(2.5, 6)), g: 9, drag: 1, bounce: 0.3, onGround: settle, life: s.rand(2, 3), R, len: s.R() < 0.4 ? 4 : 3, seed: s.R(), debris: i % 2 === 0, minor: i % 4 === 3 });
    for (let i = 0; i < (sub ? 1 : n(3)); i++) s.add({ k: "boulder", x, y, z, ...out(s, s.rand(1.5, 3)), g: 9, drag: 0.8, bounce: 0.3, onGround: settle, life: s.rand(2.5, 3.5), R, s: 2, seed: sd(s), a0: s.rand(0, TAU), debris: true });
    for (let i = 0; i < (sub ? 0 : n(2)); i++) s.add({ k: "smoke", x: x + s.rand(-0.3, 0.3) * rad, y, z: z + 0.1, vx: s.rand(-0.5, 0.5), vz: 0.3, drag: 2, r: s.rand(3, 4.5) * Math.min(1.4, m), life: s.rand(0.6, 0.9), lobes: lobes(s), R, tone: 0.67, minor: true });
  } else {
    for (let i = 0, N = n2(14); i < N; i++) { const o = out(s, s.rand(1.5, 3.5)); o.vz = Math.abs(o.vz) + 1.2; s.add({ k: "leaf", x, y, z, ...o, g: 1.4, drag: 2.2, life: s.rand(1.8, 2.6), R, seed: s.R(), minor: i % 3 === 2 }); }
    const PR = petalRamp(R);
    for (let i = 0; i < n2(7); i++) { const o = out(s, s.rand(1, 3)); o.vz = Math.abs(o.vz) + 1; s.add({ k: "petal", x, y, z, ...o, g: 0.8, drag: 2.2, life: s.rand(1.4, 2.2), R: PR, seed: s.R(), minor: true }); }
  }
  flourish(s, M, x, y, z, rad, Math.round(5 * m));
}

function fungalBurst(s, M, { x, y, z, pow, rad, sub }) {
  const R = M.R, m = s.m * pow, mm = Math.min(1.6, m), n = counter(s, pow, rad);
  releaseFlash(s, M, x, y, z, pow, rad);
  if (sub) {
    // an area eruption: one cap pushing up (sometimes a pair), threads under some of them
    if (s.R() < 0.35) s.add({ k: "mycelium", x, y, r: rad * 0.8 + 0.2, life: 5, R, seed: sd(s), debris: true, update: still });
    const list = [], N = s.R() < 0.6 ? 1 : 2, mk = Math.max(0.85, mm);
    for (let i = 0; i < N; i++) {
      const q = s.rand(0, TAU), d = i ? rad * s.rand(0.3, 0.55) : rad * s.rand(0, 0.2), sc = i ? 0.7 : s.rand(0.9, 1.25);
      list.push({ k: "mushroom", x: x + Math.cos(q) * d, y: y + Math.sin(q) * d, h: s.rand(6, 9) * mk * sc, w: s.rand(4, 5.5) * mk * sc, life: s.rand(1.8, 2.6), R, seed: sd(s), small: i > 0, wait: 0.04 + i * 0.05, debris: true, update: bloom });
    }
    list.sort((a, b) => b.y - a.y).forEach((p) => s.add(p));
  } else if (pow >= 0.5) {
    s.add({ k: "mycelium", x, y, r: rad * 0.95 + 0.25, life: 5, R, seed: sd(s), debris: true, update: still });
    const N = Math.round((4 + rad * 3) * Math.min(1.4, mm)), list = [];
    for (let i = 0; i < N; i++) {
      let q, d;
      if (s.take === 1) { q = s.rand(0, TAU); d = Math.sqrt(s.R()) * rad * 0.6; }
      else { q = (i / N) * TAU + s.rand(-0.2, 0.2); d = rad * s.rand(0.6, 0.8); } // a fairy ring
      const small = d > rad * 0.5 && s.take === 2;
      list.push({ k: "mushroom", x: x + Math.cos(q) * d, y: y + Math.sin(q) * d, h: s.rand(5, 9) * Math.min(1.3, mm) * (small ? 0.7 : 1), w: s.rand(3, 5) * Math.min(1.3, mm) * (small ? 0.7 : 1), life: s.rand(1.8, 2.6), R, seed: sd(s), small, wait: 0.05 + i * 0.03, debris: true, update: bloom });
    }
    if (s.take === 2) list.push({ k: "mushroom", x, y, h: 13 * Math.min(1.3, mm), w: 8 * Math.min(1.3, mm), life: 2.6, R, seed: sd(s), wait: 0, debris: true, update: bloom });
    list.sort((a, b) => b.y - a.y).forEach((p) => s.add(p));
  }
  for (let i = 0; i < (sub ? (s.R() < 0.4 ? 1 : 0) : n(2)); i++) s.add({ k: "smoke", x: x + s.rand(-0.3, 0.3) * rad, y: y + s.rand(-0.2, 0.2) * rad, z: z * 0.6 + 0.4, vx: s.rand(-0.4, 0.4), vy: s.rand(-0.2, 0.2), vz: s.rand(0.3, 0.5), g: -0.05, drag: 1.5, r: s.rand(3.5, 5) * Math.min(1.3, m), life: s.rand(1.1, 1.6), lobes: lobes(s), R, tone: 0.67, wait: s.rand(0.15, 0.3) });
  for (let i = 0; i < (sub ? n(7) : n(16)); i++) s.add({ k: "spore", x: x + s.rand(-0.5, 0.5) * rad, y: y + s.rand(-0.4, 0.4) * rad, z: z * 0.6 + s.rand(0.1, 0.6), vx: s.rand(-0.6, 0.6), vy: s.rand(-0.4, 0.4), vz: s.rand(0.2, 0.7), g: -0.15, drag: 2.2, life: s.rand(1.4, 2.4), R, seed: s.R(), minor: i % 3 === 2 });
  flourish(s, M, x, y, z, rad, Math.round(5 * m));
}

/* ── the family ───────────────────────────────────────────────────────── */

export default {
  id: "growth",
  burst(s, M, ctx) {
    const k = kindOf(M);
    if (k === "fungal") fungalBurst(s, M, ctx); else woodOrPlant(s, M, ctx, k === "wood");
  },
  trail(s, M, { x, y, z, dt }) {
    const R = M.R, k = kindOf(M);
    if (k === "wood") {
      for (let i = s.count(20 * s.m, dt); i > 0; i--) s.add({ k: "sliver", x, y, z, vx: s.rand(-0.8, 0.8), vy: s.rand(-0.8, 0.8), vz: s.rand(-0.2, 0.8), g: 6, drag: 1.5, len: 2, life: s.rand(0.5, 0.7), R, seed: s.R(), minor: s.R() < 0.4 });
      for (let i = s.count(8 * s.m, dt); i > 0; i--) s.add({ k: "smoke", x, y, z, vz: 0.1, drag: 2.5, r: s.rand(1.4, 2), life: 0.35, lobes: [[0, 0, 1]], R, tone: 0.67 });
    } else if (k === "plant") {
      for (let i = s.count(16 * s.m, dt); i > 0; i--) s.add({ k: "leaf", x, y, z, vx: s.rand(-0.6, 0.6), vy: s.rand(-0.6, 0.6), vz: s.rand(-0.2, 0.4), g: 1, drag: 3, life: s.rand(0.7, 1.1), R, seed: s.R(), minor: s.R() < 0.4 });
      for (let i = s.count(6 * s.m, dt); i > 0; i--) s.add({ k: "petal", x, y, z, vx: s.rand(-0.5, 0.5), g: 0.5, drag: 2.5, life: s.rand(0.8, 1.2), R: petalRamp(R), seed: s.R(), minor: true });
    } else {
      for (let i = s.count(30 * s.m, dt); i > 0; i--) s.add({ k: "spore", x: x + s.rand(-0.05, 0.05), y, z, vx: s.rand(-0.4, 0.4), vy: s.rand(-0.4, 0.4), vz: s.rand(-0.1, 0.4), g: -0.1, drag: 2.5, life: s.rand(0.7, 1.1), R, seed: s.R(), minor: s.R() < 0.4 });
      for (let i = s.count(10 * s.m, dt); i > 0; i--) s.add({ k: "smoke", x, y, z, vz: 0.15, drag: 2.2, r: s.rand(1.8, 2.5), life: 0.5, lobes: [[0, 0, 1], [0.5, 0.2, 0.6]], R, tone: 0.67 });
    }
  },
  linger(s, M, { at }) {
    const k = kindOf(M);
    if (k === "fungal") {
      at(7, () => ({ k: "spore", vz: s.rand(0.3, 0.6), g: -0.1, drag: 2, life: s.rand(1, 1.4), seed: s.R() }));
      at(0.8, () => ({ k: "smoke", z: 0.1, vz: 0.25, g: -0.03, drag: 1.6, r: s.rand(2.5, 3.5), life: 1.2, lobes: lobes(s), tone: 0.67 }));
      at(0.7, () => ({ k: "mushroom", h: s.rand(4, 6), w: s.rand(2, 3), life: 1.4, seed: sd(s), small: true, update: bloom }));
      return;
    }
    at(1.3, () => ({ k: "vine", h: s.rand(9, 14), curl: (s.R() < 0.5 ? -1 : 1) * s.rand(0.8, 1.4), lean: s.rand(-0.2, 0.2), life: s.rand(0.8, 1.1), seed: sd(s), thorn: k === "wood", update: still }));
    if (k === "plant") at(4, () => ({ k: "leaf", z: s.rand(0.8, 1.4), vx: s.rand(-0.3, 0.3), g: 0.8, drag: 2.5, life: 1.4, seed: s.R(), minor: true }));
  },
  spray(s, M, ctx) {
    const { emit } = ctx, k = kindOf(M);
    if (k === "fungal") {
      emit("smoke", 26, () => ({ drag: 1.6, g: -0.05, life: s.rand(1, 1.4), r: s.rand(3, 5), lobes: lobes(s), tone: 0.67 }));
      emit("spore", 60, () => ({ drag: 1.8, g: -0.1, life: s.rand(1.1, 1.6), seed: s.R(), minor: s.R() < 0.3 }));
      return;
    }
    vineFront(s, M, ctx, k === "wood");
    if (k === "wood") emit("sliver", 50, () => ({ g: 4, drag: 1.3, bounce: 0.3, onGround: settle, life: s.rand(0.8, 1.2), len: 3, seed: s.R() }));
    else {
      emit("leaf", 55, () => ({ g: 1, drag: 1.6, life: s.rand(1, 1.4), seed: s.R() }));
      emit("petal", 16, () => ({ g: 0.6, drag: 1.8, life: 1.2, seed: s.R(), R: petalRamp(M.R), minor: true }));
    }
  },
  auraStart(s, M, T) {
    const k = kindOf(M);
    if (k === "fungal") s.add({ k: "mycelium", x: T.x, y: T.y, r: 0.5 * T.size, life: 1e9, R: M.R, seed: 21, update: still });
    else s.add({ k: "tangle", x: T.x, y: T.y, r: 0.45 * T.size, n: 5, life: 1e9, R: M.R, seed: 21, thorn: k === "wood", update: still });
  },
  aura(s, M, { at, body }) {
    const k = kindOf(M);
    if (k === "fungal") {
      at(7, () => ({ k: "spore", vz: s.rand(0.3, 0.6), g: -0.1, drag: 2, life: 1.2, seed: s.R() }));
      at(0.6, () => ({ k: "smoke", vz: 0.2, drag: 1.6, r: s.rand(2, 3), life: 1, lobes: lobes(s), tone: 0.67 }));
      at(0.5, () => ({ k: "mushroom", h: s.rand(3, 5), w: s.rand(2, 3), life: 1.6, seed: sd(s), small: true, update: bloom }), false);
      return;
    }
    // tendrils whip up round the feet and wrap the creature
    at(1.4, () => { const b = body(false); return { k: "vine", x: b.x, y: b.y, z: 0, h: s.rand(10, 16), curl: (s.R() < 0.5 ? -1 : 1) * s.rand(1, 1.5), lean: 0, life: s.rand(0.8, 1.1), seed: sd(s), thorn: k === "wood", update: still }; }, false);
    if (k === "plant") at(2.5, () => ({ k: "leaf", g: 0.8, drag: 2.5, life: 1.2, seed: s.R() }));
  },
};

/* ── shapes ───────────────────────────────────────────────────────────── */

registerShapes({
  /**
   * A vine that whips up out of the ground: it lashes out in three frames with
   * its tip lagging, sways, then draws back down. Thorns (wood) or leaves (plant).
   */
  vine(v, P, p) {
    const fr = Math.floor(p.age * 12), u = p.age / p.life, R = p.R;
    const grow = [0.3, 0.7, 1.1, 1][Math.min(3, fr)], back = u > 0.78 ? (u - 0.78) / 0.22 : 0;
    const full = p.h * (v.kind === "top" ? 0.6 : 1), L = full * grow * (1 - back);
    if (L < 1) return;
    const [bx, by] = v.ap(p.x, p.y, 0), whip = fr < 2 ? 1.8 : fr < 3 ? 1.3 : 1, sway = Math.sin(fr * 0.8 + (p.seed % 13)) * 0.15;
    let x = bx, y = by;
    for (let j = 0; j <= L; j++) {
      const f = j / full, th = (p.lean ?? 0) + p.curl * (f ** 1.5 * 2.2 * whip + sway * f), c = Math.cos(th), sn = Math.sin(th);
      // wood is a stiff barked branch: thicker, with a bright edge and pale thorns
      const w = p.thorn, thick = j < L * (w ? 0.8 : 0.6), base = j < L * (w ? 0.45 : 0.3), tip = j > L - 2;
      if (tip) P.px(x, y, S(R, 0.83), 1);
      else if (base) { P.px(x - 1, y, S(R, w ? 0.83 : 0.67), 1); P.px(x, y, S(R, 0.5), 1); P.px(x + 1, y, S(R, 0.33), 1); }
      else if (thick) { P.px(x, y, S(R, w ? 0.83 : 0.67), 1); P.px(x + 1, y, S(R, 0.33), 1); }
      else P.px(x, y, S(R, 0.5), 1);
      if (j > 2 && j < L - 2) {
        const side = (j >> 2) & 1 ? 1 : -1, off = thick && side > 0 ? 2 : 1;
        if (p.thorn && j % 4 === 2) { P.px(x + c * side * off, y + sn * side * off - 1, S(R, 0.83), 1); P.px(x + c * side * (off + 1), y + sn * side * (off + 1) - 2, S(R, 1), 1); }
        if (!p.thorn && j % 5 === 3) { P.px(x + c * side * (off + 0.5), y - 1, S(R, 0.83), 1); P.px(x + c * side * (off + 1.5), y - 2, S(R, 0.67), 1); }
      }
      x += sn; y -= c;
    }
  },
  /** A leaf turning as it falls: broad, tilted, edge-on, tilted back. */
  leaf(v, P, p) {
    let [x, y] = v.ap(p.x, p.y, p.z); [x, y] = snapH(p, v, x, y);
    const f = (Math.floor(p.age * 12) + Math.floor(p.seed * 4)) & 3, a = fadeOut(p.age / p.life, 0.75), R = p.R;
    const c1 = S(R, 0.83), c2 = S(R, 0.5), c3 = S(R, 0.33);
    const F = [
      [[-2, 0, c1], [-1, 0, c1], [0, 0, c2], [1, 0, c2], [-1, -1, c1], [0, 1, c3]],
      [[-1, -1, c1], [0, 0, c1], [1, 1, c2], [0, -1, c1], [1, 0, c3]],
      [[-1, 0, c2], [0, 0, c2], [1, 0, c3]],
      [[-1, 1, c1], [0, 0, c1], [1, -1, c2], [0, 1, c1], [1, 0, c3]],
    ][f];
    for (const [dx, dy, c] of F) P.dot(x + dx, y + dy, c, a, 1);
  },
  /** A spore: a soft 2×2 mote that twinkles now and then. */
  spore(v, P, p) {
    let [x, y] = v.ap(p.x, p.y, p.z); [x, y] = snapH(p, v, x, y);
    const a = fadeOut(p.age / p.life, 0.6), R = p.R, tw = (Math.floor(p.age * 12) + Math.floor(p.seed * 6)) % 6;
    if (tw === 0) { P.dot(x, y, S(R, 1), a, 1); for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) P.dot(x + dx, y + dy, S(R, 0.83), a, 1); return; }
    P.dot(x, y, S(R, 1), a, 1); P.dot(x + 1, y, S(R, 0.83), a, 1); P.dot(x, y + 1, S(R, 0.83), a, 1); P.dot(x + 1, y + 1, S(R, 0.67), a, 1);
  },
  /** A mushroom that pops up (overshoot), stands, and wilts back down. */
  mushroom(v, P, p) {
    const fr = Math.floor(p.age * 12), u = p.age / p.life, R = p.R;
    const grow = [0.3, 0.7, 1.15, 0.95, 1][Math.min(4, fr)], wilt = u > 0.75 ? (u - 0.75) / 0.25 : 0, sc = grow * (1 - wilt * 0.7);
    const H = p.h * sc * (v.kind === "top" ? 0.6 : 1), W = p.w * sc;
    if (W < 1) return;
    const [bx, by] = v.ap(p.x, p.y, 0), droop = Math.round(wilt * H * 0.4);
    for (let j = 0; j < H; j++) { P.px(bx, by - j, S(R, 0.83), 1); if (W >= 3) P.px(bx + 1, by - j, S(R, 0.67), 1); }
    const capH = Math.max(2, Math.round(W * 0.7)), cy0 = by - H + droop;
    for (let r = 0; r <= capH; r++) {
      const hw = W * Math.sqrt(1 - (r / (capH + 0.5)) ** 2);
      for (let i = Math.floor(-hw); i <= Math.ceil(hw); i++) {
        if (Math.abs(i) > hw + 0.3) continue;
        let t = r === 0 ? 0.17 : i < -hw * 0.3 && r > capH * 0.35 ? 0.67 : 0.5;
        if (r > 0 && r < capH && hash(i >> 1, r >> 1, p.seed) > 0.8) t = 1;
        P.px(bx + 0.5 + i, cy0 - r, S(R, t), 1);
      }
    }
  },
});

registerShapes({
  /** Tendrils spiralling out across the floor, lit on top, thorned or leafed. */
  tangle(v, P, p) {
    const fr = Math.floor(p.age * 12), u = p.age / p.life, a = fadeOut(u, 0.7), g = Math.min(1, (fr + 1) / 5);
    const [cx, cy] = v.ap(p.x, p.y, 0), rx = p.r * v.aps, ry = rx * v.sq, R = p.R, N = p.n ?? 6, K = 14;
    for (let i = 0; i < N; i++) {
      const q0 = (i / N) * TAU + hash(i, p.seed) * 0.8, tw = (i % 2 ? 1 : -1) * (1.4 + hash(i, p.seed, 1)), reach = 0.7 + 0.3 * hash(i, p.seed, 2);
      let prev = null;
      for (let k = 0; k <= K; k++) {
        const t = k / K; if (t > g) break;
        const ang = q0 + tw * t + Math.sin(fr * 0.25 + i) * 0.04, rr = 0.12 + t * reach * 0.88;
        const X = cx + Math.cos(ang) * rr * rx, Y = cy + Math.sin(ang) * rr * ry;
        if (prev) { P.line(prev[0], prev[1], X, Y, S(R, 0.33), 1, a); P.line(prev[0], prev[1] - 1, X, Y - 1, S(R, 0.67), 1, a); }
        if (k % 3 === 2) {
          if (p.thorn) P.dot(X + 1, Y - 2, S(R, 0.83), a, 1);
          else { P.dot(X + 1, Y - 2, S(R, 0.83), a, 1); P.dot(X + 2, Y - 2, S(R, 0.67), a, 1); }
        }
        prev = [X, Y];
      }
    }
  },
  /** Pale fungal threads branching out underfoot. */
  mycelium(v, P, p) {
    const fr = Math.floor(p.age * 12), u = p.age / p.life, a = fadeOut(u, 0.65) * 0.9, g = Math.min(1, (fr + 1) / 6);
    const [cx, cy] = v.ap(p.x, p.y, 0), rx = p.r * v.aps, ry = rx * v.sq, R = p.R, N = 9;
    const walk = (q, t0, t1, i, c) => {
      let prev = null;
      for (let t = t0; t <= t1 + 1e-6; t += 0.09) {
        if (t > 0.1 + 0.9 * g) break;
        const ang = q + (hash(i, Math.round(t * 20), p.seed) - 0.5) * 0.25;
        const X = cx + Math.cos(ang) * t * rx, Y = cy + Math.sin(ang) * t * ry;
        if (prev) P.line(prev[0], prev[1], X, Y, c, 0, a);
        prev = [X, Y];
      }
    };
    // a soft stain where the threads meet, under them
    P.shade(cx - rx * 0.25, cy - ry * 0.25, cx + rx * 0.25, cy + ry * 0.25, (x, y) => { const dx = (x - cx) / (rx * 0.25), dy = (y - cy) / (ry * 0.25); return dx * dx + dy * dy < 1 ? { c: S(R, 0.33), a: a * 0.5 * clamp(g * 2) } : null; }, 0, "mix");
    for (let i = 0; i < N; i++) {
      const q = (i / N) * TAU + hash(i, p.seed) * 0.5, L = 0.65 + 0.35 * hash(i, p.seed, 1);
      walk(q, 0.1, L, i, S(R, 0.83));
      walk(q + (i % 2 ? 0.35 : -0.35), 0.4, L * 0.8, i + 50, S(R, 0.67));
    }
  },
}, { flat: ["tangle", "mycelium"] });
