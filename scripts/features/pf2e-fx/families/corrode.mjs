/**
 * Corrode: acid and poison.
 *
 * Benchmarked against pixelfx `nature/acid-splash`, `nature/toxic-puddle` and
 * `nature/poison-cloud` (spellsprite-craft §5).
 *
 * Acid: a gob bursts into a crown of drops that arc out and splash into small
 * pools; the floor is eaten into a glowing, bubbling pit that smokes pale
 * fumes and spits bright beads for seconds.
 * Poison: no gobs and no puddle. Sickly gas clouds billow out green on top and
 * violet underneath, sheets of it creep along the floor, toxic bubbles rise and
 * pop inside them, and a swirling miasma lies low on the floor.
 * Shapes are prefixed `co`.
 */

import { TAU, clamp, hash, pnoise, fadeOut } from "../core/rand.mjs";
import { S } from "../core/palette.mjs";
import { registerShapes, snapH } from "../core/shapes.mjs";
import { sd, lobes, still, releaseFlash, counter, flourish } from "../core/motifs.mjs";
import { flat, subFlash } from "./flame.mjs";

const isPoison = (M) => M.material === "poison";

/* ── acid ─────────────────────────────────────────────────────────────── */

/** A drop lands: a small pool that stays a while, a crown splash, now and then a hiss of fume. */
function splat(p, s) {
  p.life = 0;
  s.add({ k: "puddle", x: p.x, y: p.y, r: s.rand(0.06, 0.12) * (p.big ? 1.4 : p.small ? 0.6 : 1), life: s.rand(1.8, 3) * (p.small ? 0.6 : 1), R: p.R, debris: true, minor: p.minor, update: still });
  s.add({ k: "coSplash", x: p.x, y: p.y, z: 0, life: 4 / 12, R: p.R, minor: p.minor, update: still });
  if (s.R() < 0.25) s.add(fume(s, p.R, p.x, p.y, 0.05, { r: s.rand(2, 3), life: s.rand(0.5, 0.8), minor: true }));
}
const drop = (s, R, x, y, z, sp, extra) => ({ k: "coDrop", x, y, z, ...flat(s, sp, 0.9), g: 18, drag: 0.6, life: 3, R, big: s.R() < 0.35, onGround: splat, ...extra });
/** Pale fume curling off: translucent, in the material's own lightest steps. */
/** A fume where the caller places it (a linger spot, a body point). */
const fumeHere = (s, R, z, extra) => { const o = fume(s, R, 0, 0, z, extra); delete o.x; delete o.y; return o; };
const fume = (s, R, x, y, z, extra) => ({ k: "flHaze", x, y, z, vx: s.rand(-0.2, 0.2), vy: s.rand(-0.3, 0), vz: s.rand(0.4, 0.9), g: -0.2, drag: 1.4, r: s.rand(3.5, 6), life: s.rand(1.1, 1.8), R, tone: 0.83, toneEnd: 0.5, a: 0.42, grow: 0.8, seed: sd(s), ...extra });
/** Bright beads spat up out of the pit. */
const bead = (s, R, x, y, extra) => ({ k: "spark", x, y, z: 0.05, vx: s.rand(-1.2, 1.2), vy: s.rand(-1.2, 1.2), vz: s.rand(2, 4.5), g: 16, drag: 1, life: s.rand(0.3, 0.6), R, minor: true, ...extra });

const acid = {
  burst(s, M, { x, y, z, pow, rad, sub }) {
    const R = M.R, m = s.m * pow, mm = Math.min(1.7, m), n = counter(s, pow, rad), zz = Math.max(0.15, z);
    if (sub) subFlash(s, M, x, y, z, pow, rad); else releaseFlash(s, M, x, y, z, pow, rad);
    if (sub) {
      s.add({ k: "blob", x, y, z: zz, vz: 0.3, drag: 2, r: s.rand(3, 5) * Math.min(1.3, mm), life: s.rand(0.3, 0.45), R, cool: -1, seed: sd(s) });
      for (let i = 0, N = n(8); i < N; i++) s.add(drop(s, R, x, y, zz, s.rand(1.5, 3.5), { vz: s.rand(1.5, 3.5), minor: i % 2 === 1 }));
      if (s.R() < 0.5) s.add(fume(s, R, x, y, 0.1, { minor: true }));
      return;
    }
    // the gob: bursts, white for a frame
    for (let i = 0, N = n(4); i < N; i++) s.add({ k: "blob", x: x + s.rand(-0.3, 0.3) * rad, y: y + s.rand(-0.2, 0.2) * rad, z: zz + s.rand(0, 0.3), ...flat(s, s.rand(0.5, 2), 0.6), drag: 2.5, r: (4 + s.rand(0, 4)) * Math.min(1.5, mm), life: s.rand(0.35, 0.6), R, cool: -1, seed: sd(s), hero: i === 0 });
    // the crown: drops arc out and splash into pools
    for (let i = 0, N = n(24); i < N; i++) s.add(drop(s, R, x, y, zz, s.rand(2, 6) * Math.min(1.3, pow), { vz: s.rand(2, 5), minor: i % 2 === 1 }));
    // a fine spray of beads
    for (let i = 0, N = n(14); i < N; i++) s.add({ k: "spark", x, y, z: zz, ...flat(s, s.rand(3, 8), 0.8), g: 16, drag: 2, bounce: 0.3, life: s.rand(0.25, 0.55), R, minor: i % 2 === 1 });
    // the pit, eaten into the floor, glowing and bubbling; fumes and beads coming off it for seconds
    if (pow >= 0.5) {
      const pr = rad * 0.95 + 0.4 * Math.min(1.3, mm);
      s.add({ k: "coPit", x, y, r: pr, life: 4.6, R, seed: sd(s), debris: true, update: still });
      s.light(x, y, 0.1, pr * 2 + 0.8, S(R, 0.83), 0.45, 3, { flicker: true });
      for (let i = 0, N = n(6); i < N; i++) { const a = s.rand(0, TAU), d = s.rand(0, pr * 0.7); s.add(fume(s, R, x + Math.cos(a) * d, y + Math.sin(a) * d, 0.1, { r: s.rand(4, 7) * Math.min(1.3, mm), wait: s.rand(0.15, 1.6), minor: i % 2 === 1 })); }
      for (let i = 0, N = n(8); i < N; i++) { const a = s.rand(0, TAU), d = s.rand(0, pr * 0.7); s.add(bead(s, R, x + Math.cos(a) * d, y + Math.sin(a) * d, { wait: s.rand(0.3, 2.6) })); }
    }
    s.add({ k: "ring", x, y, r: rad * 1.3 + 0.9, life: 0.45, R, broken: true, seed: sd(s), update: still });
    flourish(s, M, x, y, z, rad, Math.round(6 * m));
  },
  trail(s, M, { x, y, z, dt }) {
    const R = M.R;
    for (let i = s.count(18 * s.m, dt); i > 0; i--) s.add({ k: "coDrop", x, y, z, vx: s.rand(-0.4, 0.4), vy: s.rand(-0.4, 0.4), g: 10, life: 3, R, small: true, onGround: splat, minor: i % 2 === 0 });
    for (let i = s.count(14 * s.m, dt); i > 0; i--) s.add(fume(s, R, x, y, z, { vz: 0.2, r: s.rand(2, 3.2), life: s.rand(0.5, 0.8), tone: 0.67 }));
    for (let i = s.count(8 * s.m, dt); i > 0; i--) s.add({ k: "spark", x, y, z, ...flat(s, s.rand(1, 2.5), 0.5), g: 8, drag: 2, life: s.rand(0.15, 0.3), R, minor: true });
  },
  linger(s, M, { at }) {
    const R = M.R;
    at(8, () => ({ k: "toxbubble", z: 0.02, vz: s.rand(0.05, 0.2), drag: 2, r: s.R() < 0.35 ? 2 : 1, life: s.rand(0.4, 0.8), seed: sd(s), minor: true }));
    at(1.8, () => fumeHere(s, R, 0.05));
    at(3, () => ({ k: "spark", z: 0.05, vx: s.rand(-1, 1), vy: s.rand(-1, 1), vz: s.rand(2, 4), g: 16, drag: 1, life: s.rand(0.3, 0.5), minor: true }));
  },
  spray(s, M, { emit }) {
    const R = M.R;
    emit("coDrop", 80, () => ({ vz: s.rand(1.5, 3.5), g: 8, drag: 0.8, life: 1.5, big: s.R() < 0.3, onGround: splat }));
    emit("flHaze", 14, () => ({ drag: 1.6, life: s.rand(0.8, 1.2), r: s.rand(3.5, 5.5), tone: 0.83, toneEnd: 0.5, a: 0.4, grow: 0.9, seed: sd(s), minor: true }));
    emit("spark", 24, () => ({ drag: 1.6, g: 6, life: s.rand(0.3, 0.5), minor: true }));
  },
  auraStart(s, M, T) {
    s.add({ k: "puddle", x: T.x + 0.12, y: T.y + 0.15, r: 0.26 * T.size, life: 1e9, R: M.R, update: still });
  },
  aura(s, M, { at, T, dt }) {
    const R = M.R;
    at(8, () => ({ k: "coDrop", g: 8, life: 3, onGround: splat }));
    if (s.R() < 5 * dt) s.add({ k: "toxbubble", x: T.x + 0.12 + s.rand(-0.14, 0.14), y: T.y + 0.15 + s.rand(-0.07, 0.07), z: 0, life: s.rand(0.4, 0.7), r: s.R() < 0.3 ? 2 : 1, R, seed: sd(s), update: still });
    at(1.2, () => fumeHere(s, R, 0.3, { r: s.rand(2.5, 4), life: s.rand(0.8, 1.2) }));
  },
};

/* ── poison ───────────────────────────────────────────────────────────── */

/** A gas puff: translucent, green on top, violet underneath, with a curl turning inside it. */
const gas = (s, extra) => ({ k: "toxcloud", lobes: lobes(s), seed: sd(s), spin: s.R() < 0.5 ? 1 : -1, ...extra });

const poison = {
  burst(s, M, { x, y, z, pow, rad, sub }) {
    const R = M.R, m = s.m * pow, n = counter(s, pow, rad), cz = z > 0.3 && !sub ? z * 0.6 : Math.min(z, 0.3);
    releaseFlash(s, M, x, y, z, pow, rad);
    // an area eruption is one or two clouds welling up; overlapping, they make the bank
    for (let i = 0, N = sub ? (s.R() < 0.5 ? 1 : 2) : Math.min(7, n(4)); i < N; i++) {
      const q = (i / N) * TAU + s.rand(-0.4, 0.4), d = s.rand(0.1, 0.4) * rad, sp = s.rand(0.3, 0.6) * (0.6 + rad * 0.4);
      s.add(gas(s, { x: x + Math.cos(q) * d, y: y + Math.sin(q) * d, z: cz + s.rand(0.1, 0.35), vx: Math.cos(q) * sp, vy: Math.sin(q) * sp, vz: s.rand(0.05, 0.2), g: -0.03, drag: 1.3, r: s.rand(8, 11.5) * Math.min(1.4, m) * (0.7 + rad * 0.2) * (sub ? 0.8 : 1), life: s.rand(2.2, 3.2), R, wait: s.rand(0, 0.12), minor: !sub && i > 5 && i % 2 === 1 }));
    }
    if (!sub) {
      // sheets of gas creeping out along the floor, curling at their tips
      for (let i = 0, N = n(6); i < N; i++) {
        const q = (i / N) * TAU + s.rand(-0.3, 0.3), sp = s.rand(1.6, 3) * (0.6 + rad * 0.3);
        s.add({ k: "flHaze", x: x + Math.cos(q) * rad * 0.3, y: y + Math.sin(q) * rad * 0.3, z: 0.04, vx: Math.cos(q) * sp, vy: Math.sin(q) * sp, vz: 0.02, drag: 1.8, r: s.rand(6, 9) * Math.min(1.4, m), life: s.rand(1.8, 2.6), R, tone: 0.5, toneEnd: 0.33, a: 0.6, grow: 0.9, lump: 0.35, seed: sd(s), wait: s.rand(0.05, 0.2), minor: i % 2 === 1 });
      }
      // a spatter of venom drops
      for (let i = 0, N = n(8); i < N; i++) s.add(drop(s, R, x, y, Math.max(0.15, z), s.rand(1.5, 4.5), { vz: s.rand(1.5, 3.5), minor: i % 2 === 1 }));
      s.light(x, y, 0.2, rad * 1.8 + 1, S(R, 0.83), 0.35, 2.4);
    }
    for (let i = 0; i < (sub ? n(4) : n(14)); i++) s.add({ k: "toxbubble", x: x + s.rand(-0.5, 0.5) * rad, y: y + s.rand(-0.4, 0.4) * rad, z: cz + s.rand(0, 0.3), vz: s.rand(0.3, 0.7), g: -0.05, drag: 1.5, r: s.R() < 0.4 ? 2 : 1, life: s.rand(0.6, 1.2), R, seed: sd(s), wait: s.rand(0.1, 0.6), minor: i % 3 === 2 });
    for (let i = 0; i < (sub ? n(3) : n(12)); i++) s.add({ k: "mote", x: x + s.rand(-0.6, 0.6) * rad, y: y + s.rand(-0.5, 0.5) * rad, z: cz + s.rand(0.1, 0.6), vx: s.rand(-0.3, 0.3), vz: s.rand(0.1, 0.4), g: -0.05, drag: 2, life: s.rand(1, 1.8), R, minor: true });
    if (sub ? s.R() < 0.3 : pow >= 0.5) s.add({ k: "miasma", x, y, r: rad * (sub ? 0.9 : 1.1) + (sub ? 0.2 : 0.45), life: 5.4, R, seed: sd(s), debris: true, update: still });
    flourish(s, M, x, y, z, rad, Math.round(5 * m));
  },
  trail(s, M, { x, y, z, dt }) {
    for (let i = s.count(26 * s.m, dt); i > 0; i--) s.add(gas(s, { x, y, z, vx: s.rand(-0.3, 0.3), vy: s.rand(-0.3, 0.3), vz: 0.15, drag: 2, r: s.rand(2.6, 4), life: s.rand(0.6, 0.9), lobes: [[0, 0, 1], [0.55, 0.2, 0.6]], R: M.R }));
    for (let i = s.count(6 * s.m, dt); i > 0; i--) s.add({ k: "toxbubble", x, y, z, vz: 0.3, drag: 2, r: 1, life: 0.5, R: M.R, seed: sd(s), minor: true });
  },
  linger(s, M, { at }) {
    at(2.8, () => gas(s, { z: 0.05, vx: s.rand(-0.3, 0.3), vy: s.rand(-0.2, 0.2), vz: 0.08, g: -0.02, drag: 1.2, r: s.rand(5, 8), life: s.rand(1.6, 2.2) }));
    at(3, () => ({ k: "mote", z: s.rand(0.1, 0.5), vz: s.rand(0.1, 0.3), drag: 2, life: s.rand(0.8, 1.3), minor: true }));
    at(4, () => ({ k: "toxbubble", z: 0.02, vz: s.rand(0.2, 0.45), drag: 1, r: s.R() < 0.3 ? 2 : 1, life: s.rand(0.5, 0.9), seed: sd(s) }));
  },
  spray(s, M, { emit }) {
    emit("toxcloud", 18, () => gas(s, { drag: 1.5, g: -0.04, life: s.rand(1.2, 1.7), r: s.rand(8, 11) }));
    emit("flHaze", 12, () => ({ drag: 1.6, life: s.rand(1, 1.5), r: s.rand(5, 8), tone: 0.5, toneEnd: 0.33, a: 0.55, grow: 0.9, lump: 0.35, seed: sd(s), minor: true }));
    emit("mote", 12, () => ({ drag: 2, g: -0.1, life: s.rand(0.8, 1.2), minor: true }));
    emit("toxbubble", 22, () => ({ drag: 1.8, g: -0.2, r: 1, life: 0.8, seed: sd(s), minor: true }));
  },
  auraStart(s, M, T) {
    s.add({ k: "miasma", x: T.x, y: T.y + 0.05, r: 0.55 * T.size, life: 1e9, R: M.R, seed: 17, strong: true, update: still });
  },
  aura(s, M, { at }) {
    at(2.4, () => gas(s, { vz: s.rand(0.12, 0.3), g: -0.04, drag: 1.5, r: s.rand(5, 7), life: s.rand(1.5, 2) }));
    at(5, () => ({ k: "toxbubble", vz: s.rand(0.3, 0.6), g: -0.05, drag: 1.2, r: s.R() < 0.3 ? 2 : 1, life: s.rand(0.6, 1), seed: sd(s) }));
  },
};

/* ── the family ───────────────────────────────────────────────────────── */

const pick = (name) => (s, M, ctx) => (isPoison(M) ? poison : acid)[name](s, M, ctx);

export default {
  id: "corrode",
  burst: pick("burst"),
  trail: pick("trail"),
  linger: pick("linger"),
  spray: pick("spray"),
  auraStart(s, M, T) { (isPoison(M) ? poison : acid).auraStart(s, M, T); },
  aura: pick("aura"),
};

/* ── shapes ───────────────────────────────────────────────────────────── */

const RINGS = {
  1: [[-1, 0], [1, 0], [0, -1], [0, 1]],
  2: [[-1, -2], [0, -2], [1, -2], [2, -1], [2, 0], [2, 1], [1, 2], [0, 2], [-1, 2], [-2, 1], [-2, 0], [-2, -1]],
};

registerShapes({
  /**
   * A poison cloud. Unlike smoke it is see-through: a mixed body with a lit
   * rim, a violet belly and a pale curl that turns at 12 fps, so it reads as gas
   * hanging in the air rather than as a lump.
   */
  toxcloud(v, P, p) {
    const u = Math.min(1, p.age / p.life), fr = Math.floor(p.age * 12);
    let [cx, cy] = v.ap(p.x, p.y, p.z); [cx, cy] = snapH(p, v, cx, cy);
    const rr = p.r * (0.6 + 0.6 * Math.min(1, u * 2.5)), fade = fadeOut(u, 0.45), R = p.R, rot = fr * 0.35 * (p.spin || 1);
    const FL = 0.72; // gas hangs wide, not tall
    P.shade(cx - rr * 1.9, cy - rr * 1.2, cx + rr * 1.9, cy + rr * 1.1, (x, y) => {
      let best = -1, lr = 1, top = false;
      for (const [ox, oy, sc] of p.lobes) {
        const ax = (x - (cx + ox * rr * 1.25)) , ay = (y - (cy + oy * rr * FL)) / FL, ar = rr * sc, e = 1 - Math.hypot(ax, ay) / ar;
        if (e > best) { best = e; lr = ar; top = ay < 0; }
      }
      if (best < 0) return null;
      // dissolve from the edge inward as it thins
      if (fade < 1 && hash(x, y, fr >> 1) > fade * 1.6 - best * 0.8) return null;
      // a fuzzy fringe: the outer pixels are a checker dither, so the gas has no hard line
      if (best * lr < Math.min(1.8, lr * 0.25) && ((x + y + (fr >> 2)) & 1)) return null;
      const h = (y - cy) / (rr * FL);
      const d = Math.hypot((x - cx) / 1.25, (y - cy) / FL) / rr, q = Math.atan2((y - cy) / FL, (x - cx) / 1.25);
      const arm = ((q - rot) / TAU + d * 0.6) * 2, curl = d > 0.15 && d < 0.95 && arm - Math.floor(arm) < 0.14;
      const crown = top && h < -0.2;
      if (curl) return { c: S(R, crown ? 0.83 : 0.67), a: 0.8 * fade };
      return crown ? { c: S(R, 0.5), a: 0.78 * fade } : { c: S(R, h > 0.45 ? 0.17 : 0.33), a: (h > 0.45 ? 0.62 : 0.75) * fade };
    }, 0, "mix");
  },
  /** A toxic bubble: a wobbling ring, sickly green on top and violet below, that pops. */
  toxbubble(v, P, p) {
    let [x, y] = v.ap(p.x, p.y, p.z); [x, y] = snapH(p, v, x, y);
    const u = p.age / p.life, fr = Math.floor(p.age * 12), r = p.r > 1.5 ? 2 : 1, R = p.R;
    if (u > 0.86) { const d = r + 1; for (const [ox, oy] of [[-d, -d], [d, -d], [-d, d], [d, d], [0, -d - 1]]) P.px(x + ox, y + oy, S(R, 0.67), 1); return; }
    const wob = r > 1 && (fr >> 1) % 2 ? 1 : 0;
    for (const [ox, oy] of RINGS[r]) P.px(x + ox + (oy < 0 ? wob : 0), y + oy, S(R, oy < 0 ? 0.83 : oy > 0 ? 0.33 : 0.67), 1);
    if (r > 1) { P.px(x - 1 + wob, y - 1, S(R, 1), 1); P.px(x, y, S(R, 0.5), 1); P.px(x + 1, y + 1, S(R, 0.33), 1); }
  },
});

registerShapes({
  /** A drop in flight: a short streak along its velocity, lit at the head. */
  coDrop(v, P, p) {
    const [hx, hy] = v.ap(p.x, p.y, p.z), [tx, ty] = v.ap(p.x - p.vx * 0.035, p.y - p.vy * 0.035, p.z - p.vz * 0.035);
    P.line(tx, ty, hx, hy, null, 1, 1, (f) => S(p.R, f > 0.7 ? 0.83 : 0.5));
    P.px(hx, hy, S(p.R, 1), 1);
    if (p.big) { P.px(hx + 1, hy, S(p.R, 0.67), 1); P.px(hx, hy + 1, S(p.R, 0.33), 1); P.px(hx + 1, hy + 1, S(p.R, 0.5), 1); }
  },
  /** A crown splash: droplets thrown out in a ring over four frames. */
  coSplash(v, P, p) {
    const fr = Math.floor(p.age * 12); if (fr > 3) return;
    const [x, y] = v.ap(p.x, p.y, 0), r = 1.2 + fr * 1.3, c = S(p.R, fr < 2 ? 1 : 0.67);
    for (let i = 0; i < 6; i++) { const q = (i / 6) * TAU + 0.3; P.px(x + Math.cos(q) * r, y + Math.sin(q) * r * v.sq - (fr < 2 ? fr : 3 - fr), c, 1); }
    if (fr < 2) P.px(x, y - 1 - fr, S(p.R, 0.83), 1);
  },
  /** A low swirl of poison on the floor: banded green and violet, slowly turning. */
  miasma(v, P, p) {
    const u = p.age / p.life, a = Math.min(1, p.age / 0.3) * fadeOut(u, 0.55) * (p.strong ? 1.6 : 1), fr = Math.floor(p.age * 12);
    const [cx, cy] = v.ap(p.x, p.y, 0), rx = p.r * v.aps, ry = rx * v.sq, R = p.R, rot = fr * 0.04;
    P.shade(cx - rx - 1, cy - ry - 1, cx + rx + 1, cy + ry + 1, (x, y) => {
      const dx = (x - cx) / rx, dy = (y - cy) / ry, d = Math.hypot(dx, dy), q = Math.atan2(dy, dx), e = 0.8 + pnoise(q + rot, 8, p.seed) * 0.35;
      if (d > e) return null;
      if (d > e - 1.5 / ry) return { c: S(R, 0.67), a: a * 0.5 };
      // three swirl arms winding in toward the centre, turning slowly
      const arm = (q - rot) / TAU * 3 + d * 1.4 + pnoise(q, 7, p.seed + 1) * 0.3, f = arm - Math.floor(arm);
      if (f < 0.07) return { c: S(R, 0.67), a: a * 0.45 };
      if (f < 0.3) return { c: S(R, 0.5), a: a * 0.32 };
      return { c: S(R, 0.17), a: a * 0.38 };
    }, 0, "mix");
    // a few bubbles breaking the surface
    for (let i = 0; i < 4; i++) {
      const k = Math.floor(p.age * 3 + i * 0.37), h = hash(i, k, p.seed), q = h * TAU, dd = 0.2 + 0.5 * hash(i, k, p.seed + 3);
      const ph = Math.floor(p.age * 12) % 4;
      if (ph > 2) continue;
      const bx = cx + Math.cos(q) * dd * rx, by = cy + Math.sin(q) * dd * ry, c = S(R, 0.83);
      if (ph === 0) P.dot(bx, by, c, a); else for (const [ox, oy] of RINGS[1]) P.dot(bx + ox * ph, by + oy, c, a);
    }
  },
  /** An acid pit eaten into the floor: a dark wet heart, a glowing rim that cools, bubbles doming and popping. */
  coPit(v, P, p) {
    const t = p.age, u = t / p.life, fade = clamp((p.life - t) / 1.2), grow = Math.min(1, t / 0.15), [cx, cy] = v.ap(p.x, p.y, 0), rx = p.r * v.aps * grow, ry = rx * v.sq, R = p.R, fr = Math.floor(t * 12);
    if (rx < 1.5) return;
    const heat = clamp(1 - u * 1.3), rim = S(R, 0.5 + heat * 0.5), wet = S(R, 0.33), deep = S(R, 0.17), seed = p.seed;
    P.shade(cx - rx - 1, cy - ry - 1, cx + rx + 1, cy + ry + 1, (x, y) => {
      const dx = (x - cx) / rx, dy = (y - cy) / ry, d = Math.hypot(dx, dy), e = 0.82 + pnoise(Math.atan2(dy, dx), 9, seed) * 0.3;
      if (d > e) return null;
      if (d > e - 1.6 / Math.max(4, ry)) return { c: rim, a: fade };
      if (d > e * 0.72) return { c: wet, a: fade * 0.85 };
      // an oily sheen drifting across the heart
      const sh = ((x * 0.35 + y * 0.6 + fr * 0.25) % 6 + 6) % 6 < 0.9 && hash(x >> 2, y >> 2, seed) < 0.5;
      return { c: sh ? S(R, 0.67) : deep, a: fade * 0.9 };
    }, 0, "mix");
    // bubbles dome, swell and pop
    for (let i = 0; i < 6; i++) {
      const k = Math.floor(t * 2.5 + i * 0.41), h = hash(i, k, seed), q = h * TAU, dd = 0.15 + 0.5 * hash(i, k, seed + 3), ph = Math.floor((t * 2.5 + i * 0.41 - k) * 6);
      const bx = cx + Math.cos(q) * dd * rx, by = cy + Math.sin(q) * dd * ry, c = S(R, 0.83 + heat * 0.17);
      if (ph < 2) P.dot(bx, by, c, fade); else if (ph < 4) { for (const [ox, oy] of RINGS[1]) P.dot(bx + ox, by + oy, c, fade); P.dot(bx - 1, by - 1, S(R, 1), fade); } else if (ph === 4) for (const [ox, oy] of [[-2, -1], [2, -1], [0, -2]]) P.dot(bx + ox, by + oy, S(R, 0.67), fade);
    }
  },
}, { flat: ["miasma", "coPit"] });
