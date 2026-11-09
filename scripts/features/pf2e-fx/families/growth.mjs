/**
 * Growth: wood, plant, fungal. Things that grow and snap.
 *
 * Wood: thorny branches lash up out of the cracked floor, splinters and bark
 * chips fly with a crack, dirt and grit are thrown from the roots, a thorny
 * tangle stays on the floor. Plant: leafy vines whip up in a ring, leaves and
 * petals burst out and flutter down, pollen glitters up, tendrils spread
 * underfoot (nature/vine-whip, nature/thorns, nature/root-snare). Fungal:
 * mushrooms pop up in a ring and each one puffs a cloud of spores, the
 * clouds are translucent and drift, pale mycelium spreads (nature/spore-burst).
 */

import { TAU, clamp, hash, fadeOut } from "../core/rand.mjs";
import { RAMP, rotateRamp, hueOf, S } from "../core/palette.mjs";
import { registerShapes, snapH } from "../core/shapes.mjs";
import { out, sd, still, releaseFlash, counter, flourish } from "../core/motifs.mjs";
// splinters are earthwork's `sliver`, bark chips its `boulder`
import { settle } from "./earthwork.mjs";
import { grit, dustRing, dustLobes } from "./physical.mjs";

const kindOf = (M) => (M.material === "fungal" ? "fungal" : M.material === "wood" ? "wood" : "plant");

/** Petals take the plant's ramp turned toward blossom, so a recoloured look keeps them in step. */
const PETALS = new WeakMap();
function petalRamp(R) {
  let P = PETALS.get(R);
  if (!P) { P = rotateRamp(R, (hueOf(R) + 225) % 360); PETALS.set(R, P); }
  return P;
}
/** The soil a root tears out of: earth, unless a look recolours the whole effect. */
const soil = (s, M) => (Number.isFinite(s.spec.look?.hue) ? M.R : RAMP.earth);

/** A mushroom puffs its spores once it has opened: a translucent cloud and a fistful of spores. */
function bloom(p, s) {
  if (p.puffed || p.age < 0.25) return;
  p.puffed = true;
  const z = (p.h / s.spec.aps) * 1.2;
  s.add({ k: "phDust", x: p.x, y: p.y, z, vx: s.rand(-0.2, 0.2), vz: 0.4, g: -0.05, drag: 1.8, r: Math.max(3, p.w * 1.3), life: s.rand(0.9, 1.3), lobes: dustLobes(s), R: p.R, tone: 0.67, a0: 0.5, minor: p.small });
  for (let i = 0, N = p.small ? 3 : 6; i < N; i++) s.add({ k: "spore", x: p.x, y: p.y, z, vx: s.rand(-0.8, 0.8), vy: s.rand(-0.5, 0.5), vz: s.rand(0.4, 1.1), g: -0.1, drag: 2, life: s.rand(1, 1.7), R: p.R, seed: s.R(), minor: i > 0 });
}

/** Vines round a point, whipping in over it; each tears a little soil out at its root. Nearest-first for the 3D view. */
function vines(s, M, R, x, y, rad, mm, thorn, n) {
  const list = [], q0 = hash(s.seed, 5) * TAU, dirt = soil(s, M);
  for (let i = 0; i < n; i++) {
    let q, d;
    if (s.take === 0) { q = (i / n) * TAU + s.rand(-0.3, 0.3); d = (rad + 0.4) * s.rand(0.55, 1); }
    else if (s.take === 1) { q = s.rand(0, TAU); d = Math.sqrt(s.R()) * (rad + 0.4) + 0.12; }
    else { q = q0 + s.rand(-1.1, 1.1); d = (rad + 0.4) * s.rand(0.55, 1); }
    const px = x + Math.cos(q) * d, py = y + Math.sin(q) * d, wait = d * 0.08;
    list.push({ k: "vine", x: px, y: py, h: s.rand(24, 38) * Math.min(1.4, mm), curl: -Math.sign(px - x || 1) * s.rand(0.8, 1.4), lean: Math.cos(q) * 0.25, life: s.rand(1.3, 2), R, seed: sd(s), thorn, wait, debris: true, update: still });
    s.at(s.t + wait, (s2) => grit(s2, dirt, px, py, 0.05, 6, { sp: [0.8, 3], up: [1.5, 3.5], life: [0.6, 1.1], keep: 1 }));
  }
  list.sort((a, b) => b.y - a.y).forEach((p) => s.add(p));
}

/** Vines erupting along a cone or line, in a wave that runs out from the hand. */
function vineFront(s, M, { hand, dir, half, len, dt }, thorn) {
  const st = (s.growFront ??= { t0: s.t });
  const u = (s.t - st.t0) / 0.55;
  if (u > 1) return;
  const d = 0.7 + u * (len - 0.7), rate = (len * (half > 0.3 ? 4 : 2.6)) / 0.55, dirt = soil(s, M);
  for (let i = s.count(rate, dt); i > 0; i--) {
    const q = dir + s.rand(-half, half) * 0.85, dd = d + s.rand(-0.25, 0.25), px = hand[0] + Math.cos(q) * dd, py = hand[1] + Math.sin(q) * dd;
    s.add({ k: "vine", x: px, y: py, h: s.rand(16, 28) * Math.min(1.3, s.m), curl: (s.R() < 0.5 ? -1 : 1) * s.rand(0.7, 1.3), lean: s.rand(-0.2, 0.2), life: s.rand(1.1, 1.6), R: M.R, seed: sd(s), thorn, debris: true, update: still });
    grit(s, dirt, px, py, 0.05, 4, { sp: [0.8, 3], up: [1.5, 3.5], life: [0.5, 0.9], keep: 0 });
  }
}

/* ── bursts ───────────────────────────────────────────────────────────── */

function woodOrPlant(s, M, { x, y, z, pow, rad, sub }, wood) {
  const R = M.R, m = s.m * pow, mm = Math.min(1.6, m), n0 = counter(s, pow, rad), n = sub ? (k) => Math.ceil(n0(k) / 2.5) : n0;
  releaseFlash(s, M, x, y, z, pow, rad, sub ? { flash: 0.6, light: 0.22 } : undefined);
  if (sub) {
    // an area eruption: one or two vines whipping up, a tangle under some of them
    if (s.R() < 0.3) s.add({ k: "tangle", x, y, r: rad * 1 + 0.25, n: 5, life: 4.5, R, seed: sd(s), thorn: wood, debris: true, update: still });
    vines(s, M, R, x, y, rad * 0.5, Math.max(0.8, mm), wood, s.R() < 0.5 ? 1 : 2);
  } else if (pow >= 0.5) {
    s.add({ k: "tangle", x, y, r: rad * 1.5 + 0.4, n: 9, life: 4.5, R, seed: sd(s), thorn: wood, debris: true, update: still });
    vines(s, M, R, x, y, rad, mm, wood, Math.round((4 + rad * 3) * Math.min(1.4, mm)));
  }
  if (!sub) s.add({ k: "ring", x, y, r: Math.min(rad * 2 + 0.9, rad * 1.1 + 1.4) * Math.min(1.3, mm), life: 0.5, R, broken: true, seed: sd(s), update: still });
  // soil torn up at the middle, dust rolled out low
  grit(s, soil(s, M), x, y, Math.max(0.05, z * 0.3), n(20), { sp: [1.2, 5], up: [2, 4.5], keep: 2 });
  dustRing(s, soil(s, M), x, y, sub ? 1 : n(4), { r0: rad * 0.5, r: [5, 8], tone: 0.5, a0: 0.38, keep: 1 });
  if (wood) {
    // a crack: splinters and bark chips burst out, a star where the wood snapped
    if (!sub) s.add({ k: "star", x, y, z, L: 5 * mm, life: 3 / 12, R, update: still });
    for (let i = 0, N = n(26); i < N; i++) s.add({ k: "sliver", x, y, z, ...out(s, s.rand(3, 8)), g: 13, drag: 1, bounce: 0.3, onGround: settle, life: s.rand(1.8, 2.8), R, len: s.R() < 0.4 ? 5 : 3, seed: s.R(), debris: i % 2 === 0, minor: i >= (sub ? 2 : 6) });
    for (let i = 0, N = sub ? 1 : n(6); i < N; i++) s.add({ k: "boulder", x, y, z, ...out(s, s.rand(2, 4.5)), g: 12, drag: 0.8, bounce: 0.3, onGround: settle, life: s.rand(2.5, 3.5), R, s: i < 2 ? 3 : 2, seed: sd(s), a0: s.rand(0, TAU), debris: true, minor: i >= 2 });
    for (let i = 0, N = sub ? 0 : n(4); i < N; i++) s.add({ k: "leaf", x, y, z, ...out(s, s.rand(1.5, 3.5)), g: 1.4, drag: 2.2, life: s.rand(1.6, 2.4), R: RAMP.plant, seed: s.R(), minor: i >= 1 });
  } else {
    // a burst of leaves and petals that flutter down, and pollen glittering up
    for (let i = 0, N = n(28); i < N; i++) { const o = out(s, s.rand(1.8, 4.8)); o.vz = Math.abs(o.vz) + 1.4; s.add({ k: "leaf", x, y, z, ...o, g: 1.5, drag: 2.2, life: s.rand(1.8, 2.8), R, seed: s.R(), minor: i >= (sub ? 2 : 8) }); }
    const PR = petalRamp(R);
    for (let i = 0, N = n(14); i < N; i++) { const o = out(s, s.rand(1.2, 3.8)); o.vz = Math.abs(o.vz) + 1.2; s.add({ k: "petal", x, y, z, ...o, g: 0.8, drag: 2.2, life: s.rand(1.6, 2.6), R: PR, seed: s.R(), minor: i >= 2 }); }
    for (let i = 0, N = sub ? 0 : n(8); i < N; i++) s.add({ k: "spore", x: x + s.rand(-1, 1) * (rad + 0.2), y: y + s.rand(-1, 1) * (rad + 0.2) * 0.7, z: s.rand(0.1, 0.5), vx: s.rand(-0.3, 0.3), vz: s.rand(0.4, 1), g: -0.15, drag: 1.6, life: s.rand(1.2, 2), R, seed: s.R(), wait: s.rand(0.1, 0.4), minor: i >= 2 });
  }
  if (!sub && pow >= 0.8) s.shake = Math.max(s.shake, 0.6 + pow * 0.5);
  flourish(s, M, x, y, z, rad, Math.round(5 * m));
}

function fungalBurst(s, M, { x, y, z, pow, rad, sub }) {
  const R = M.R, m = s.m * pow, mm = Math.min(1.6, m), n0 = counter(s, pow, rad), n = sub ? (k) => Math.ceil(n0(k) / 2.5) : n0;
  releaseFlash(s, M, x, y, z, pow, rad, sub ? { flash: 0.6, light: 0.22 } : undefined);
  if (sub) {
    // an area eruption: one cap pushing up (sometimes a pair), threads under some of them
    if (s.R() < 0.35) s.add({ k: "mycelium", x, y, r: rad * 1 + 0.25, life: 5, R, seed: sd(s), debris: true, update: still });
    const list = [], N = s.R() < 0.6 ? 1 : 2, mk = Math.max(0.9, mm);
    for (let i = 0; i < N; i++) {
      const q = s.rand(0, TAU), d = i ? rad * s.rand(0.3, 0.55) : rad * s.rand(0, 0.2), sc = i ? 0.7 : s.rand(0.9, 1.25);
      list.push({ k: "mushroom", x: x + Math.cos(q) * d, y: y + Math.sin(q) * d, h: s.rand(8, 12) * mk * sc, w: s.rand(5, 7) * mk * sc, life: s.rand(1.8, 2.6), R, seed: sd(s), small: i > 0, wait: 0.04 + i * 0.05, debris: true, update: bloom });
    }
    list.sort((a, b) => b.y - a.y).forEach((p) => s.add(p));
  } else if (pow >= 0.5) {
    s.add({ k: "mycelium", x, y, r: rad * 1.5 + 0.4, life: 5, R, seed: sd(s), debris: true, update: still });
    const N = Math.round((5 + rad * 4) * Math.min(1.4, mm)), list = [];
    for (let i = 0; i < N; i++) {
      let q, d;
      if (s.take === 1) { q = s.rand(0, TAU); d = Math.sqrt(s.R()) * rad * 0.8 + 0.1; }
      else { q = (i / N) * TAU + s.rand(-0.2, 0.2); d = (rad + 0.35) * s.rand(0.75, 1); } // a fairy ring
      const small = d > rad * 0.5 && s.take === 2;
      list.push({ k: "mushroom", x: x + Math.cos(q) * d, y: y + Math.sin(q) * d, h: s.rand(8, 13) * Math.min(1.3, mm) * (small ? 0.7 : 1), w: s.rand(5, 8) * Math.min(1.3, mm) * (small ? 0.7 : 1), life: s.rand(1.8, 2.6), R, seed: sd(s), small, wait: 0.05 + i * 0.03, debris: true, update: bloom });
    }
    if (s.take !== 0 || rad <= 0.5) list.push({ k: "mushroom", x, y, h: 17 * Math.min(1.3, mm), w: 10 * Math.min(1.3, mm), life: 2.6, R, seed: sd(s), wait: 0, debris: true, update: bloom });
    list.sort((a, b) => b.y - a.y).forEach((p) => s.add(p));
  }
  if (!sub) s.add({ k: "ring", x, y, r: Math.min(rad * 2 + 0.9, rad * 1.1 + 1.4) * Math.min(1.3, mm), life: 0.55, R, broken: true, seed: sd(s), update: still });
  // the spore cloud: translucent puffs that swell and drift, the spores inside them
  for (let i = 0, N = sub ? (s.R() < 0.5 ? 1 : 0) : n(4); i < N; i++) s.add({ k: "phDust", x: x + s.rand(-0.4, 0.4) * rad, y: y + s.rand(-0.3, 0.3) * rad, z: z * 0.6 + 0.3, vx: s.rand(-0.6, 0.6), vy: s.rand(-0.4, 0.4), vz: s.rand(0.3, 0.6), g: -0.05, drag: 1.5, r: s.rand(7, 11) * Math.min(1.3, m), life: s.rand(1.4, 2), lobes: dustLobes(s), R, tone: 0.67, a0: 0.45, wait: s.rand(0.1, 0.3), minor: i >= 2 });
  dustRing(s, R, x, y, sub ? 0 : n(4), { r0: rad * 0.5, r: [6, 9], tone: 0.6, a0: 0.38, keep: 1 });
  for (let i = 0, N = n(36); i < N; i++) { const q = s.rand(0, TAU), v = s.rand(0.4, 2.4); s.add({ k: "spore", x: x + s.rand(-0.4, 0.4) * rad, y: y + s.rand(-0.3, 0.3) * rad, z: z * 0.6 + s.rand(0.1, 0.6), vx: Math.cos(q) * v, vy: Math.sin(q) * v * 0.7, vz: s.rand(0.2, 0.9), g: -0.15, drag: 2, life: s.rand(1.4, 2.6), R, seed: s.R(), minor: i >= (sub ? 2 : 8) }); }
  flourish(s, M, x, y, z, rad, Math.round(5 * m));
}


registerShapes({
  /**
   * The thorn burst, on a body (deliveries.mjs bloom): barbed thorns spear
   * out of a hollow middle, curving as they go, a barb on alternate sides,
   * lit along one edge; they hold, then wither back from the tip. `bud`: over
   * the head a bud swells for three frames and opens into five petals in the
   * blossom ramp `PR`, its heart lit. `wood` thorns are thicker and darker.
   */
  grBurst(v, P, p) {
    const fr = Math.floor(p.age * 12), u = p.age / p.life, [x, y] = v.ap(p.x, p.y, p.z), top = v.kind === "top", sq = top ? 0.85 : 0.5, R = p.R;
    const a = u < 0.75 ? 1 : (1 - u) / 0.25, grow = Math.min(1, (fr + 1) / 2.5), wilt = u > 0.55 ? (u - 0.55) / 0.45 : 0, r0 = Math.max(6, p.r * 0.28);
    for (let k = 0; k < p.n; k++) {
      const q = (k / p.n) * TAU + hash(k, p.seed) * 0.5, bend = (hash(k, p.seed, 1) - 0.5) * 0.9, L = (p.r - r0) * (0.7 + 0.45 * hash(k, p.seed, 2)) * grow * (1 - wilt * 0.6);
      const W = (p.wood ? 3.6 : 2.8) * Math.min(1.4, p.r / 24), steps = Math.ceil(L);
      for (let j = 0; j <= steps; j++) {
        const f = j / Math.max(1, steps), qq = q + bend * f * f, d = r0 + j, cx = x + Math.cos(qq) * d, cy = y + Math.sin(qq) * d * sq - (top ? 0 : f * f * 4);
        const w = W * (1 - f) + 0.3, nx = -Math.sin(qq), ny = Math.cos(qq) * sq;
        for (let i = Math.floor(-w); i <= Math.ceil(w); i++) {
          if (Math.abs(i) > w + 0.2) continue;
          const col = Math.abs(i) >= w - 0.6 && w > 1.2 ? S(R, 0.33) : i < 0 ? S(R, p.wood ? 0.83 : 1) : f > 0.85 ? S(R, 1) : S(R, p.wood ? 0.5 : 0.67);
          P.dot(cx + nx * i, cy + ny * i, col, a, 1);
        }
        // barbs on alternate sides, every few pixels
        if (j > 2 && j % 4 === 0 && f < 0.85) { const sg = (j / 4) % 2 ? 1 : -1, bx = cx + nx * sg * (w + 2.5) + Math.cos(qq) * 1.5, by = cy + ny * sg * (w + 2.5) + Math.sin(qq) * 1.5 * sq; P.line(cx + nx * sg * w, cy + ny * sg * w, bx, by, S(R, 0.83), 1, a); }
      }
    }
    if (!p.bud) return;
    // the bud over the head: swells, then opens into five petals
    const [hx, hy0] = v.ap(p.x, p.y, p.hz), hy = hy0 - (top ? 6 : 0), open = clamp((p.age - 0.12) / 0.3), PR = p.PR, pr = (4 + p.r * 0.18) * (0.5 + 0.5 * Math.min(1, p.age / 0.12));
    for (let k = 0; k < 5; k++) {
      const q = -Math.PI / 2 + (k / 5) * TAU + open * 0.3, d = pr * 0.9 * open, cx = hx + Math.cos(q) * d, cy = hy - 6 + Math.sin(q) * d * (top ? 0.85 : 0.6), pw = pr * (0.55 + 0.25 * open);
      P.shade(cx - pw - 1, cy - pw - 1, cx + pw + 1, cy + pw + 1, (px, py) => {
        const dx = px - cx, dy = py - cy, along = dx * Math.cos(q) + dy * Math.sin(q), across = -dx * Math.sin(q) + dy * Math.cos(q), e = (along / pw) ** 2 + (across / (pw * 0.62)) ** 2;
        if (e > 1) return null;
        const col = e > 0.7 ? S(PR, 0.5) : along < 0 ? S(PR, 0.83) : S(PR, 1);
        return a < 1 ? { c: col, a } : col;
      }, 2);
    }
    P.dot(hx, hy - 6, S(R, 1), a, 2); P.dot(hx + 1, hy - 6, S(R, 0.83), a, 2); P.dot(hx, hy - 5, S(R, 0.67), a, 2);
  },
});

/* ── the family ───────────────────────────────────────────────────────── */

export default {
  id: "growth",
  /**
   * The thorn and bud burst (spellsprite-craft §5 nature/thorns,
   * nature/spore-burst): soil hops and shoots wriggle for the drawn-in beat,
   * then the growth bursts out of the body: barbed thorns spearing out of a
   * hollow middle, and over the head a bud that swells and opens into a
   * flower; leaves and petals flutter, vines whip up round the feet. Wood is
   * all thorn and splinter; fungal throws up a ring of caps that puff spores.
   */
  bloom(s, M, B) {
    const R = M.R, k = kindOf(M), aps = s.spec.aps, { x, y, z, head, r, sz } = B, rs = r / aps, dirt = soil(s, M);
    s.at(B.at, (s2) => {
      grit(s2, dirt, x, y, 0.04, 8, { sp: [0.3, 1.2], up: [1.5, 3], life: [0.25, 0.4], keep: 2, spread: rs * 0.7 });
      for (let i = 0; i < 6; i++) s2.add({ k: "spore", x: x + s2.rand(-0.3, 0.3) * sz, y: y + s2.rand(-0.2, 0.2), z: z + s2.rand(-0.3, 0.4), vx: s2.rand(-0.3, 0.3), vz: s2.rand(-0.6, 0.2), drag: 2, life: 0.2, R, seed: s2.R(), minor: i > 2 });
      s2.light(x, y, 0.1, rs * 1.3 + 0.5, S(R, 0.83), 0.35, 0.2, { swell: true });
    });
    s.at(B.b, (s2) => {
      s2.add({ k: "grBurst", x, y, z, hz: head, r: r * 1.15, n: B.saved ? 5 : B.crit ? 9 : 7, bud: k === "plant" && !B.saved, PR: petalRamp(R), wood: k === "wood", hero: B.crit, life: 1.1, R, seed: sd(s2), update: still });
      s2.light(x, y, 0.1, rs * 2 + 0.7, S(R, 0.83), 0.45 * B.k, 0.8);
      if (B.crit) s2.crit();
      // vines whipping up round the feet
      vines(s2, M, R, x, y, rs * 0.45, Math.min(1.3, B.k) * 0.8 * sz, k === "wood", B.saved ? 2 : Math.round(3 * B.k));
      grit(s2, dirt, x, y, 0.05, Math.round(12 * B.k), { sp: [1.2, 4.5], up: [2, 4.5], keep: 2 });
      if (k === "wood") for (let i = 0, N = Math.round(14 * B.k); i < N; i++) s2.add({ k: "sliver", x, y, z, ...out(s2, s2.rand(3, 8) * B.k), g: 13, drag: 1, bounce: 0.3, onGround: settle, life: s2.rand(1.4, 2.2), R, len: i % 3 ? 3 : 5, seed: s2.R(), debris: true, minor: i > 4 });
      else if (k === "fungal") {
        const list = [];
        for (let i = 0, N = B.saved ? 3 : Math.round(5 * B.k); i < N; i++) { const q = (i / N) * TAU + s2.rand(-0.3, 0.3), d = rs * s2.rand(0.55, 0.8) + 0.1; list.push({ k: "mushroom", x: x + Math.cos(q) * d, y: y + Math.sin(q) * d * 0.85, h: s2.rand(8, 12) * Math.min(1.3, B.k) * sz, w: s2.rand(5, 7) * sz, life: s2.rand(1.6, 2.2), R, seed: sd(s2), small: i > 2, wait: 0.03 + i * 0.03, debris: true, update: bloom }); }
        list.sort((a, b) => b.y - a.y).forEach((p) => s2.add(p));
        for (let i = 0, N = Math.round(20 * B.k); i < N; i++) { const q = s2.rand(0, TAU), v = s2.rand(0.5, 2.6); s2.add({ k: "spore", x, y, z: head * s2.rand(0.5, 1), vx: Math.cos(q) * v, vy: Math.sin(q) * v * 0.8, vz: s2.rand(0.2, 1), g: -0.1, drag: 1.8, life: s2.rand(1, 1.8), R, seed: s2.R(), minor: i > 6 }); }
        s2.add({ k: "phDust", x, y, z: head, vz: 0.3, g: -0.05, drag: 1.8, r: 8 * sz, life: 1.2, lobes: dustLobes(s2), R, tone: 0.67, a0: 0.45, wait: 0.1 });
      }
      if (k !== "wood") for (let i = 0, N = Math.round(12 * B.k); i < N; i++) { const o = out(s2, s2.rand(1.6, 4) * B.k); o.vz = Math.abs(o.vz) + 1.4; s2.add({ k: i % 3 === 0 && k === "plant" ? "petal" : "leaf", x, y, z: head, ...o, g: 1.5, drag: 2.2, life: s2.rand(1.6, 2.4), R: i % 3 === 0 && k === "plant" ? petalRamp(R) : R, seed: s2.R(), minor: i > 4 }); }
      if (!B.saved) s2.add({ k: k === "fungal" ? "mycelium" : "tangle", x, y, r: rs * 1.1 + 0.25, n: 7, life: 3.4, R, seed: sd(s2), thorn: k === "wood", debris: true, update: still });
      s2.add({ k: "ring", x, y, r: rs * 1.6 + 0.4, life: 0.45, R, broken: true, seed: sd(s2), update: still });
    });
  },

  burst(s, M, ctx) {
    const k = kindOf(M);
    if (k === "fungal") fungalBurst(s, M, ctx); else woodOrPlant(s, M, ctx, k === "wood");
  },
  trail(s, M, { x, y, z, dt }) {
    const R = M.R, k = kindOf(M);
    if (k === "wood") {
      for (let i = s.count(34 * s.m, dt); i > 0; i--) s.add({ k: "sliver", x, y, z, vx: s.rand(-1, 1), vy: s.rand(-1, 1), vz: s.rand(-0.2, 1), g: 8, drag: 1.5, len: s.R() < 0.3 ? 3 : 2, life: s.rand(0.5, 0.8), R, seed: s.R(), minor: s.R() < 0.6 });
      for (let i = s.count(8 * s.m, dt); i > 0; i--) s.add({ k: "leaf", x, y, z, vx: s.rand(-0.6, 0.6), vy: s.rand(-0.6, 0.6), vz: s.rand(-0.2, 0.4), g: 1, drag: 3, life: s.rand(0.7, 1.1), R: RAMP.plant, seed: s.R(), minor: true });
      for (let i = s.count(10 * s.m, dt); i > 0; i--) s.add({ k: "phDust", x, y, z, vz: 0.1, drag: 2.5, r: s.rand(2.5, 3.5), life: 0.4, R, tone: 0.6, a0: 0.4, minor: true });
    } else if (k === "plant") {
      for (let i = s.count(30 * s.m, dt); i > 0; i--) s.add({ k: "leaf", x, y, z, vx: s.rand(-0.8, 0.8), vy: s.rand(-0.8, 0.8), vz: s.rand(-0.2, 0.5), g: 1, drag: 3, life: s.rand(0.8, 1.3), R, seed: s.R(), minor: s.R() < 0.6 });
      for (let i = s.count(12 * s.m, dt); i > 0; i--) s.add({ k: "petal", x, y, z, vx: s.rand(-0.6, 0.6), g: 0.5, drag: 2.5, life: s.rand(0.9, 1.4), R: petalRamp(R), seed: s.R(), minor: true });
      for (let i = s.count(10 * s.m, dt); i > 0; i--) s.add({ k: "spore", x, y, z, vx: s.rand(-0.3, 0.3), vy: s.rand(-0.3, 0.3), vz: s.rand(0, 0.4), g: -0.1, drag: 2, life: s.rand(0.6, 1), R, seed: s.R(), minor: true });
    } else {
      for (let i = s.count(46 * s.m, dt); i > 0; i--) s.add({ k: "spore", x: x + s.rand(-0.05, 0.05), y, z, vx: s.rand(-0.5, 0.5), vy: s.rand(-0.5, 0.5), vz: s.rand(-0.1, 0.5), g: -0.1, drag: 2.5, life: s.rand(0.8, 1.3), R, seed: s.R(), minor: s.R() < 0.6 });
      for (let i = s.count(14 * s.m, dt); i > 0; i--) s.add({ k: "phDust", x, y, z, vz: 0.15, drag: 2.2, r: s.rand(3, 4.5), life: s.rand(0.5, 0.7), lobes: dustLobes(s), R, tone: 0.67, a0: 0.45, minor: s.R() < 0.4 });
    }
  },
  linger(s, M, { at }) {
    const k = kindOf(M);
    if (k === "fungal") {
      at(10, () => ({ k: "spore", vz: s.rand(0.3, 0.7), g: -0.1, drag: 2, life: s.rand(1, 1.6), seed: s.R(), minor: s.R() < 0.5 }));
      at(1.1, () => ({ k: "phDust", z: 0.1, vz: 0.25, g: -0.03, drag: 1.6, r: s.rand(5, 8), life: s.rand(1.2, 1.7), lobes: dustLobes(s), tone: 0.67, a0: 0.4 }));
      at(0.9, () => ({ k: "mushroom", h: s.rand(5, 8), w: s.rand(3, 4.5), life: 1.4, seed: sd(s), small: true, update: bloom }));
      return;
    }
    at(1.8, () => ({ k: "vine", h: s.rand(12, 20), curl: (s.R() < 0.5 ? -1 : 1) * s.rand(0.8, 1.4), lean: s.rand(-0.2, 0.2), life: s.rand(0.9, 1.2), seed: sd(s), thorn: k === "wood", update: still }));
    at(5, () => ({ k: k === "plant" ? "leaf" : "sliver", z: s.rand(0.8, 1.4), vx: s.rand(-0.3, 0.3), g: k === "plant" ? 0.8 : 6, drag: 2.5, life: 1.4, len: 2, seed: s.R(), minor: true }));
    if (k === "plant") at(2, () => ({ k: "petal", z: s.rand(0.6, 1.2), vx: s.rand(-0.3, 0.3), g: 0.5, drag: 2.5, life: 1.4, R: petalRamp(M.R), seed: s.R(), minor: true }));
  },
  spray(s, M, ctx) {
    const { emit } = ctx, k = kindOf(M);
    if (k === "fungal") {
      emit("phDust", 22, () => ({ drag: 1.6, g: -0.05, life: s.rand(1, 1.5), r: s.rand(5, 8), lobes: dustLobes(s), tone: 0.67, a0: 0.42, minor: s.R() < 0.5 }));
      emit("spore", 100, () => ({ drag: 1.8, g: -0.1, life: s.rand(1.1, 1.8), seed: s.R(), minor: s.R() < 0.6 }));
      return;
    }
    vineFront(s, M, ctx, k === "wood");
    if (k === "wood") {
      emit("sliver", 70, () => ({ g: 5, drag: 1.3, bounce: 0.3, onGround: settle, life: s.rand(0.8, 1.3), len: s.R() < 0.3 ? 5 : 3, seed: s.R(), minor: s.R() < 0.6 }));
      emit("leaf", 14, () => ({ g: 1, drag: 1.6, life: s.rand(1, 1.4), R: RAMP.plant, seed: s.R(), minor: true }));
    } else {
      emit("leaf", 80, () => ({ g: 1, drag: 1.6, life: s.rand(1.1, 1.6), seed: s.R(), minor: s.R() < 0.6 }));
      emit("petal", 28, () => ({ g: 0.6, drag: 1.8, life: s.rand(1.1, 1.5), seed: s.R(), R: petalRamp(M.R), minor: true }));
    }
  },
  auraStart(s, M, T) {
    const k = kindOf(M);
    if (k === "fungal") s.add({ k: "mycelium", x: T.x, y: T.y, r: 0.6 * T.size, life: 1e9, R: M.R, seed: 21, update: still });
    else s.add({ k: "tangle", x: T.x, y: T.y, r: 0.55 * T.size, n: 6, life: 1e9, R: M.R, seed: 21, thorn: k === "wood", update: still });
  },
  aura(s, M, { at, body }) {
    const k = kindOf(M);
    if (k === "fungal") {
      at(10, () => ({ k: "spore", vz: s.rand(0.3, 0.6), g: -0.1, drag: 2, life: 1.3, seed: s.R(), minor: s.R() < 0.4 }));
      at(0.8, () => ({ k: "phDust", vz: 0.2, drag: 1.6, r: s.rand(4, 6), life: 1.2, lobes: dustLobes(s), tone: 0.67, a0: 0.4 }));
      at(0.6, () => ({ k: "mushroom", h: s.rand(4, 7), w: s.rand(2.5, 4), life: 1.6, seed: sd(s), small: true, update: bloom }), false);
      return;
    }
    // tendrils whip up round the feet and wrap the creature
    at(1.8, () => { const b = body(false); return { k: "vine", x: b.x, y: b.y, z: 0, h: s.rand(13, 20), curl: (s.R() < 0.5 ? -1 : 1) * s.rand(1, 1.5), lean: 0, life: s.rand(0.8, 1.1), seed: sd(s), thorn: k === "wood", update: still }; }, false);
    at(3, () => ({ k: k === "plant" ? "leaf" : "sliver", g: k === "plant" ? 0.8 : 5, drag: 2.5, life: 1.2, len: 2, seed: s.R(), minor: true }));
  },
  tick(s, M, T) {
    const k = kindOf(M);
    if (k === "fungal") {
      for (let i = 0; i < 3; i++) { const q = (i / 3) * TAU + 0.3; s.add({ k: "mushroom", x: T.x + Math.cos(q) * 0.38 * T.size, y: T.y + Math.sin(q) * 0.3 * T.size, h: 8, w: 5, life: 1.3, R: M.R, seed: sd(s), small: i > 0, wait: i * 0.05, update: bloom }); }
      return;
    }
    for (let i = 0; i < 3; i++) { const q = (i / 3) * TAU + 0.6; s.add({ k: "vine", x: T.x + Math.cos(q) * 0.36 * T.size, y: T.y + Math.sin(q) * 0.3 * T.size, h: 18, curl: (i % 2 ? 1 : -1) * 1.2, lean: 0, life: 0.9, R: M.R, seed: sd(s), thorn: k === "wood", wait: i * 0.04, update: still }); }
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
