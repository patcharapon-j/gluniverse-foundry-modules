/**
 * Radiance: vitality, holy, light. One family, three temperaments that must
 * never be mistaken for each other:
 *
 *   holy      judgment: a glint marks the spot, a pillar of gold drops like a
 *             hammer, a sigil burns on the floor, a shockwave and stone chips,
 *             gold sparks, a turning sunburst of rays, halos and rising crosses
 *             (holy/smite, holy/holy-pillar, holy/sunburst)
 *   vitality  healing, warm and gentle: a lotus of light opens under the feet,
 *             motes ride a slow spiral up and pop into tiny hearts, leaves of
 *             light tumble up, a sprouting patch stays; no sparks, no shake,
 *             nothing that strikes (holy/heal, nature/healing-bloom)
 *   light     plain glare: a long anamorphic flare, lens ghosts down the axis,
 *             a hot core, fast white sparks and glints; nothing sacred about it
 */

import { TAU, clamp, fadeOut, hash, easeOut } from "../core/rand.mjs";
import { RAMP, S, WHITE, rotateRamp } from "../core/palette.mjs";
import { registerShapes, snapH } from "../core/shapes.mjs";
import { out, still, releaseFlash, counter, flourish } from "../core/motifs.mjs";
import { grit } from "./physical.mjs";

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


/* Shapes the remaster added: the lotus, the heart, the lens ghosts. */
const HEART = ["0110110", "1111111", "1111111", "0111110", "0011100", "0001000"];
registerShapes({
  /**
   * The sunburst round a body (deliveries.mjs bloom, after pixelfx
   * holy/sunburst): long and short tapered rays by turns about a hollow
   * corona, turning slowly and breathing, a lit spine down each and a glint
   * running out along the long ones that winks at the tip. The spine roots
   * are white on the first frame (two on a crit); `warm` never goes white
   * and keeps its rays softer and shorter.
   */
  raSun(v, P, p) {
    const fr = Math.floor(p.age * 12), u = clamp(p.age / p.life), [x, y] = v.ap(p.x, p.y, p.z), sq = v.kind === "top" ? 0.85 : 0.5, R = p.R;
    const open = 1 - (1 - Math.min(1, u * 4)) ** 2, a = u < 0.7 ? 1 : (1 - u) / 0.3, rot = fr * 0.035 + (p.seed % 9) * 0.07, r0 = Math.max(5, p.r * 0.26);
    const hot = !p.warm && fr < (p.hero ? 2 : 1), N = p.n * 2;
    for (let i = 0; i < N; i++) {
      const long = i % 2 === 0, q = rot + (i / N) * TAU, br = 0.86 + 0.14 * Math.sin(q * 3 - p.age * 9);
      const L = (p.r - r0) * open * br * (long ? 1 : 0.55) * (p.warm ? 0.85 : 1), W = (long ? 3.4 : 2.2) * Math.min(1.3, p.r / 26) * (p.warm ? 0.8 : 1);
      const c = Math.cos(q), sn = Math.sin(q), steps = Math.ceil(L);
      for (let j = 0; j <= steps; j++) {
        const f = j / Math.max(1, steps), w = (W / 2) * (1 - f * 0.85) + 0.25, d = r0 + j, cx = x + c * d, cy = y + sn * d * sq;
        for (let k = Math.floor(-w); k <= Math.ceil(w); k++) {
          const e = Math.abs(k) / Math.max(0.6, w); if (e > 1) continue;
          const col = e < 0.4 ? (hot && f < 0.4 ? WHITE : S(R, f < 0.75 ? 1 : 0.83)) : e > 0.75 && w > 0.9 ? S(R, 0.5) : S(R, f < 0.5 ? 0.83 : 0.67);
          P.dot(cx - sn * k, cy + c * k * sq, col, f > 0.72 ? a * (1 - (f - 0.72) / 0.28) * 1.2 : a, 1);
        }
      }
      if (long && open > 0.9) {
        const g = (p.age * 2.2 + i * 0.13) % 1, d = r0 + g * L, gx = x + c * d, gy = y + sn * d * sq;
        if (g < 0.88) P.dot(gx, gy, S(R, 1), a, 2);
        else for (const [ox, oy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) P.dot(gx + ox, gy + oy, S(R, ox || oy ? 0.83 : 1), a, 2);
      }
    }
    // the corona: a ring round the hollow, not a disc, so the creature shows through
    P.ellipse(x, y, r0, r0 * sq, (q) => ({ c: S(R, Math.floor((q / TAU) * 10 + fr) % 2 ? 1 : 0.83), a }), 1);
    P.ellipse(x, y, r0 + 1, (r0 + 1) * sq, () => ({ c: S(R, 0.67), a: a * 0.8 }), 1);
  },
  /** A tiny heart a healing mote pops into: it swells in one frame, floats up and fades. */
  raHeart(v, P, p) {
    let [x, y] = v.ap(p.x, p.y, p.z); [x, y] = snapH(p, v, x, y);
    const fr = Math.floor(p.age * 12), a = fadeOut(p.age / p.life, 0.55), small = fr === 0;
    const rows = small ? ["0101", "1111", "0110"] : HEART, w = rows[0].length;
    for (let j = 0; j < rows.length; j++) for (let i = 0; i < w; i++) {
      if (rows[j][i] !== "1") continue;
      const edge = j === 0 || i === 0 || rows[j][i - 1] !== "1" || rows[j][i + 1] !== "1" || !rows[j + 1] || rows[j + 1][i] !== "1";
      P.dot(x + i - (w >> 1), y + j - 3, j < 2 && i < 3 && !edge ? WHITE : S(p.R, edge ? 0.62 : 0.92), a, 1);
    }
  },
  /** Light's lens ghosts: rings of different sizes strung along the flare's axis, fading out. */
  raGhosts(v, P, p) {
    const u = clamp(p.age / p.life); if (u >= 1) return;
    const [cx, cy] = v.ap(p.x, p.y, p.z), a = (u < 0.15 ? u / 0.15 : 1 - (u - 0.15) / 0.85);
    const G = [[-2.2, 3], [-1.2, 5], [1.4, 2], [2.4, 7], [3.4, 3]];
    for (const [f, r] of G) {
      const gx = cx + f * p.L, gy = cy + f * p.L * 0.18, rr = r * p.gk;
      P.ellipse(gx, gy, rr, rr, (q) => ({ c: S(p.R, Math.sin(q) < 0 ? 0.95 : 0.75), a }));
    }
  },
});

registerShapes({
  /**
   * The healing lotus: petals of light that open one after another round the
   * spot, lean out as they open and fold away at the end. A lit rim, a white
   * tip, a warm translucent body.
   */
  raLotus(v, P, p) {
    const [cx, cy] = v.ap(p.x, p.y, 0), N = p.n ?? 8, R0 = p.r * v.aps, sq = v.sq, t = p.age, rot = t * 0.35;
    const close = clamp((t - p.life + 0.45) / 0.45);
    const bl = new Float64Array(N);
    let any = false;
    for (let k = 0; k < N; k++) {
      const t0 = ((k * 3) % N) * 0.035, b = clamp((t - t0) / 0.3);
      bl[k] = (b < 1 ? easeOut(b) * (1 + 0.25 * Math.sin(Math.PI * b)) : 1) * (1 - close);
      if (bl[k] > 0.03) any = true;
    }
    if (!any) return;
    const rb = R0 * 0.22, ext = R0 * 1.15 + 2;
    const rim = S(p.R, 0.95), body = S(p.R, 0.62), deep = S(p.R, 0.45), vein = S(p.R, 0.85);
    P.shade(cx - ext, cy - ext * sq, cx + ext, cy + ext * sq, (x, y) => {
      const dx = x - cx, dy = (y - cy) / sq, d = Math.hypot(dx, dy);
      if (d < rb) return null;
      let q = Math.atan2(dy, dx) - rot; q = ((q % TAU) + TAU) % TAU;
      const k = Math.floor((q / TAU) * N + 0.5) % N, b = bl[k];
      if (b <= 0.03) return null;
      const rt = rb + (R0 - rb) * Math.min(1.15, b), u = (d - rb) / (rt - rb);
      if (u > 1) return null;
      let off = q - (k / N) * TAU; if (off > Math.PI) off -= TAU;
      const hw = (TAU / N) * 0.5 * Math.min(1, b) * Math.sqrt(Math.sin(Math.PI * Math.sqrt(u))) + 0.02, e = Math.abs(off) * d / Math.max(1, hw * d);
      if (e > 1) return null;
      if (u > 0.88) return { c: WHITE, a: 1 };
      if (e > 0.72) return { c: u < 0.35 ? body : rim, a: 1 };
      if (e < 0.18 && u > 0.15) return { c: vein, a: 0.75 };
      return { c: u < 0.45 ? deep : body, a: 0.5 };
    }, 0, "mix");
  },
}, { flat: ["raLotus"] });

const kindOf = (M) => (M.material === "vitality" ? "vitality" : M.material === "light" ? "light" : "holy");
const sd0 = (s) => s.seedInt();

/*
 * `sub`: one of many eruptions across an area (area.mjs). Lighter: no pillar,
 * no sunburst, no glare, no floor decal (the scar is areaFX's), fewer motes.
 */

function holyBurst(s, M, { x, y, z, pow, rad, sub }) {
  const R = M.R, m = s.m * pow, mm = Math.min(1.6, m), n0 = counter(s, pow, rad), n = sub ? (k) => Math.ceil(n0(k) / 2.5) : n0;
  releaseFlash(s, M, x, y, z, pow, rad, sub ? { flash: 0.6, light: 0.22 } : undefined);
  const rise = (i) => ({ x: x + s.rand(-1, 1) * (rad + 0.35), y: y + s.rand(-1, 1) * (rad + 0.35) * 0.7, z: s.rand(0, 0.6), vz: s.rand(0.7, 2), g: -0.3, drag: 1.4, life: s.rand(0.9, 1.6), R, plus: s.R() < 0.55, wait: s.rand(0, 0.25), minor: i >= (sub ? 2 : 8) });
  if (sub) {
    for (let i = 0; i < n(30); i++) s.add({ k: "mote", ...rise(i) });
    s.add({ k: "halo", x, y, z: 0.05, vz: 1, drag: 0.8, life: 0.8, r: rad * 0.6 + 0.25, R });
    for (let i = 0, N = n(14); i < N; i++) s.add({ k: "spark", x, y, z, ...out(s, s.rand(3, 8)), g: 6, drag: 2, life: s.rand(0.2, 0.45), R, minor: i >= 2 });
    return;
  }
  // the hammer: a pillar of gold dropped on the spot, a thinner shaft that stays a beat longer
  s.add({ k: "beam", x, y, h: 3.4 * Math.min(1.4, m), w: 6 * mm * (0.75 + rad * 0.35), life: 0.9, R, update: still });
  s.add({ k: "beam", x, y, h: 3.8 * Math.min(1.4, m), w: 2.2 * mm, life: 1.5, R, wait: 0.1, update: still });
  // judgment on the floor: a burning sigil, cracks that glow and cool, a shockwave
  if (pow >= 0.5) {
    s.add({ k: "glyph", x, y, r: rad * 1.5 + 0.55, life: 1.6, R, star: true, glyphs: undefined, update: still });
    s.add({ k: "fissure", x, y, r: rad * 1.2 + 0.35, life: 3, R, seed: sd0(s), debris: true, update: still });
  }
  s.add({ k: "ring", x, y, r: Math.min(rad * 2.4 + 1, rad * 1.1 + 1.5) * Math.min(1.3, mm), life: 0.5, R, seed: sd0(s), update: still });
  s.add({ k: "ring", x, y, r: Math.min(rad * 1.6 + 0.7, rad * 1.1 + 1.2) * Math.min(1.3, mm), life: 0.65, R, broken: true, seed: sd0(s), wait: 0.06, update: still });
  if (pow >= 0.5) s.add({ k: "radRays", x, y, z: z + 0.15, L: (14 + rad * 10) * Math.min(1.3, mm), n: pow > 1.2 ? 16 : 12, flat: 0.75, life: 0.9, R, wait: 0.04, update: still });
  // gold sparks thrown out and stone chips knocked loose by the blow
  for (let i = 0, N = n(32); i < N; i++) s.add({ k: "spark", x, y, z: Math.max(0.1, z * 0.4), ...out(s, s.rand(4, 11)), g: 10, drag: 2, bounce: 0.35, life: s.rand(0.25, 0.6), R, minor: i >= 8 });
  grit(s, RAMP.kinetic, x, y, 0.1, n(14), { sp: [1.5, 5.5], up: [2, 4], keep: 2 });
  // what rises after: motes and crosses, halos climbing, glints winking
  for (let i = 0; i < n(30); i++) s.add({ k: "mote", ...rise(i) });
  for (let i = 0; i < 3; i++) s.add({ k: "halo", x, y, z: 0.05, vz: s.rand(0.9, 1.3), drag: 0.8, life: 1, r: rad * 0.65 + 0.3, R, wait: 0.1 + i * 0.14 });
  for (let i = 0; i < n(6); i++) s.add({ k: "glint", x: x + s.rand(-1, 1) * (rad + 0.4), y: y + s.rand(-1, 1) * (rad + 0.4) * 0.7, z: s.rand(0.2, 1.2), life: 5 / 12, R, big: i === 0, wait: s.rand(0.05, 0.6), minor: i >= 2, update: still });
  if (pow >= 0.8) s.shake = Math.max(s.shake, 0.8 + pow * 0.6);
  flourish(s, M, x, y, z, rad, Math.round(5 * m));
}

/** A healing mote: it rides a slow spiral up round the spot and pops into a heart (some of them). */
function spiralMote(x, y, r0, ph, w, rise, life, heart) {
  return function (p, s) {
    const a = p.age, f = clamp(a / life), q = ph + w * a, r = r0 * (1 - 0.45 * f);
    p.x = x + Math.cos(q) * r; p.y = y + Math.sin(q) * r * 0.6; p.z = p.z0 + rise * a;
    if (heart && !p.popped && a > life - 0.03) { p.popped = true; s.add({ k: "raHeart", x: p.x, y: p.y, z: p.z, vz: 0.4, drag: 1, life: 0.6, R: p.R, minor: p.minor }); }
  };
}

function vitalityBurst(s, M, { x, y, z, pow, rad, sub }) {
  const R = M.R, L = leafRamp(s), m = s.m * pow, n0 = counter(s, pow, rad), n = sub ? (k) => Math.ceil(n0(k) / 2.5) : n0;
  releaseFlash(s, M, x, y, z, pow, rad, sub ? { flash: 0.5, light: 0.22 } : { flash: 0.8 });
  // a lotus of light opens under the feet
  if (!sub && pow >= 0.4) s.add({ k: "raLotus", x, y, r: Math.min(1.35, rad * 1.1 + 0.55), n: 8, life: 1.7, R, update: still });
  // motes ride a slow spiral up and some pop into tiny hearts
  const nm = n(26);
  for (let i = 0; i < nm; i++) {
    const ph = (i / nm) * TAU * 2, r0 = s.rand(0.35, 0.8) * (rad + 0.45), life = s.rand(0.8, 1.3), z0 = s.rand(0, 0.25);
    s.add({ k: "mote", x, y, z: z0, z0, life, R: i % 3 ? R : L, plus: s.R() < 0.55, wait: s.rand(0, 0.3), minor: i >= (sub ? 2 : 8), update: spiralMote(x, y, r0, ph, (i % 2 ? 1 : -1) * s.rand(3, 4.5), s.rand(0.9, 1.6), life, !sub && i % 4 === 0) });
  }
  // leaves of light tumble up and outward
  for (let i = 0; i < n(18); i++) {
    const q = s.rand(0, TAU), sp = s.rand(0.8, 2.2);
    s.add({ k: "radLeaf", x: x + s.rand(-0.3, 0.3) * rad, y: y + s.rand(-0.3, 0.3) * rad, z: z * 0.5, vx: Math.cos(q) * sp, vy: Math.sin(q) * sp * 0.6, vz: s.rand(1, 2.4), g: 0.9, drag: 2, life: s.rand(1.1, 1.9), R: L, seed: s.R(), wait: s.rand(0, 0.15), minor: i >= 4 });
  }
  for (let i = 0, N = sub ? 1 : n(5); i < N; i++) s.add({ k: "glint", x: x + s.rand(-1, 1) * (rad + 0.4), y: y + s.rand(-1, 1) * (rad + 0.4) * 0.6, z: s.rand(0.2, 1.1), life: 5 / 12, R, wait: s.rand(0.2, 0.9), minor: i >= 1, update: still });
  if (sub) return;
  if (pow >= 0.5) s.add({ k: "ring", x, y, r: rad * 1.8 + 0.6, life: 0.9, R: L, seed: sd0(s), update: still });
  if (pow >= 0.5) s.add({ k: "radPool", x, y, r: rad * 1.2 + 0.35, life: 4.5, R: L, seed: sd0(s), debris: true, update: still });
  // a warm pool that swells and holds while the lotus is open
  s.light(x, y, z, rad * 2.6 + 1.4, S(R, 0.85), 0.55 * Math.min(1.6, m), 1.4, { swell: true });
  s.light(x, y, z, rad * 2.2 + 1.2, S(L, 0.85), 0.5 * Math.min(1.6, m), 1.8);
  flourish(s, M, x, y, z, rad, Math.round(5 * m));
}

function lightBurst(s, M, { x, y, z, pow, rad, sub }) {
  const R = M.R, m = s.m * pow, mm = Math.min(1.6, m), n0 = counter(s, pow, rad), n = sub ? (k) => Math.ceil(n0(k) / 2.5) : n0;
  releaseFlash(s, M, x, y, z, pow, rad, sub ? { flash: 0.6, light: 0.22 } : undefined);
  const fan = (i, N, sp) => { const q = (i / N) * TAU + s.rand(-0.15, 0.15), v = s.rand(sp[0], sp[1]); return { vx: Math.cos(q) * v, vy: Math.sin(q) * v * 0.55, vz: s.rand(-0.5, 1.5) }; };
  for (let i = 0, N = n(28); i < N; i++) s.add({ k: "spark", x, y, z, ...fan(i, N, [5, 13]), drag: 3, life: s.rand(0.18, 0.4), R, minor: i >= (sub ? 2 : 8) });
  for (let i = 0, N = n(8); i < N; i++) s.add({ k: "glint", x: x + s.rand(-1, 1) * (rad + 0.5), y: y + s.rand(-1, 1) * (rad + 0.5) * 0.6, z: Math.max(0.05, z + s.rand(-0.3, 0.6)), life: 5 / 12, R, big: i === 0, wait: s.rand(0.03, 0.45), minor: i >= 2, update: still });
  if (sub) return;
  // the glare: a long flare across, lens ghosts down its axis, streaks shot sideways
  s.add({ k: "radGlare", x, y, z, L: (9 + rad * 7) * Math.min(1.4, mm), life: 7 / 12, R, update: still });
  s.add({ k: "raGhosts", x, y, z, L: (8 + rad * 8) * Math.min(1.3, mm), gk: Math.min(1.3, mm), life: 0.75, R, update: still });
  for (let i = 0; i < 6; i++) { const side = i % 2 ? 1 : -1, v = s.rand(10, 16); s.add({ k: "streak", x, y: y + s.rand(-0.06, 0.06), z: z + s.rand(-0.1, 0.1), vx: side * v, vy: s.rand(-0.4, 0.4), drag: 7, life: s.rand(0.12, 0.2), R, minor: i >= 2 }); }
  s.add({ k: "ring", x, y, r: Math.min(rad * 2.4 + 1, rad * 1.1 + 1.5) * Math.min(1.3, mm), life: 0.4, R, seed: sd0(s), update: still });
  s.light(x, y, z, rad * 3.2 + 1.6, S(R, 0.9), 0.9 * mm, 0.7);
  if (pow >= 0.5) s.add({ k: "radPool", x, y, r: rad * 1.2 + 0.3, life: 2.8, R, glow: true, seed: sd0(s), debris: true, update: still });
  flourish(s, M, x, y, z, rad, Math.round(5 * m));
}

export default {
  id: "radiance",
  burst(s, M, o) {
    const k = kindOf(M);
    if (k === "vitality") vitalityBurst(s, M, o); else if (k === "light") lightBurst(s, M, o); else holyBurst(s, M, o);
  },
  trail(s, M, { x, y, z, dt }) {
    const k = kindOf(M);
    for (let i = s.count((k === "light" ? 40 : 70) * s.m, dt); i > 0; i--) s.add({ k: "mote", x, y, z, vx: s.rand(-0.4, 0.4), vy: s.rand(-0.4, 0.4), g: k === "vitality" ? -0.8 : -0.4, drag: 1, life: s.rand(0.45, 0.8), R: M.R, plus: s.R() < 0.3, minor: s.R() < 0.7 });
    if (k === "vitality") for (let i = s.count(14 * s.m, dt); i > 0; i--) s.add({ k: "radLeaf", x, y, z, vx: s.rand(-0.5, 0.5), vy: s.rand(-0.4, 0.4), vz: s.rand(0.2, 0.7), g: 0.6, drag: 2, life: s.rand(0.6, 1), R: leafRamp(s), seed: s.R(), minor: true });
    if (k === "holy") for (let i = s.count(16 * s.m, dt); i > 0; i--) s.add({ k: "spark", x, y, z, vx: s.rand(-1.5, 1.5), vy: s.rand(-1.5, 1.5), vz: s.rand(-0.5, 1), g: 4, drag: 2.5, life: s.rand(0.15, 0.3), R: M.R, minor: true });
    if (k === "light") for (let i = s.count(26 * s.m, dt); i > 0; i--) s.add({ k: "spark", x, y, z, vx: s.rand(-2, 2), vy: s.rand(-1, 1), drag: 3, life: s.rand(0.12, 0.25), R: M.R, minor: true });
    for (let i = s.count(k === "light" ? 12 : 7, dt); i > 0; i--) s.add({ k: "glint", x, y, z, life: 5 / 12, R: M.R, minor: true, update: still });
  },
  linger(s, M, { at }) {
    const k = kindOf(M);
    at(k === "light" ? 8 : 12, () => ({ k: "mote", vz: s.rand(0.5, 1.3), g: -0.3, drag: 1, life: s.rand(0.8, 1.4), plus: s.R() < 0.4, minor: s.R() < 0.5 }));
    if (k === "holy") at(0.5, () => ({ k: "beam", h: s.rand(1.6, 2.4), w: s.rand(1.2, 2), life: s.rand(0.6, 0.9), update: still }));
    if (k === "vitality") at(4, () => ({ k: "radLeaf", z: 0.1, vz: s.rand(0.5, 1), vx: s.rand(-0.3, 0.3), g: 0.25, drag: 1.5, life: s.rand(1, 1.5), R: leafRamp(s), seed: s.R() }));
    if (k === "light") { at(7, () => ({ k: "glint", z: s.rand(0.1, 0.7), life: 5 / 12, big: s.R() < 0.3, update: still })); at(5, () => ({ k: "spark", z: 0.1, vx: s.rand(-1, 1), vy: s.rand(-0.6, 0.6), vz: s.rand(1, 2.5), g: 2, drag: 2, life: s.rand(0.3, 0.5), minor: true })); }
  },
  spray(s, M, { emit }) {
    const k = kindOf(M);
    emit("mote", k === "light" ? 70 : 110, () => ({ drag: 1.6, g: -0.4, life: s.rand(0.6, 0.9), plus: s.R() < 0.3, minor: s.R() < 0.6 }));
    if (k === "vitality") emit("radLeaf", 40, () => ({ drag: 1.8, g: 0.3, life: s.rand(0.9, 1.2), R: leafRamp(s), seed: s.R(), minor: s.R() < 0.5 }));
    if (k === "holy") emit("spark", 40, () => ({ drag: 1.6, g: 2, life: s.rand(0.3, 0.45), minor: true }));
    if (k === "light") emit("spark", 70, () => ({ drag: 1.2, life: s.rand(0.3, 0.45), minor: true }));
    emit("glint", 8, () => ({ drag: 3, life: 5 / 12, minor: true }));
  },
  /**
   * The sunburst (spellsprite-craft §5 holy/sunburst, holy/smite): light
   * gathers into the body, then a sun opens round it: long and short tapered
   * rays turning slowly about a hollow corona, a glint running out along each
   * long ray and winking at its tip, twinkles round it. Holy drops a thin
   * shaft of gold on it, light throws a glare across. Vitality stays healing
   * warm: no white anywhere, softer rays, a lotus under the feet and motes
   * spiralling up into hearts (Heal on the undead).
   */
  bloom(s, M, B) {
    const R = M.R, k = kindOf(M), warm = k === "vitality", aps = s.spec.aps, { x, y, z, r, sz } = B, rs = r / aps;
    s.at(B.at, (s2) => {
      for (let i = 0; i < 12; i++) { const q = (i / 12) * TAU + s2.rand(-0.15, 0.15), d = rs * 1.6 + 0.3, life = 0.17; s2.add({ k: "mote", x: x + Math.cos(q) * d, y: y + Math.sin(q) * d * 0.7, z: z + s2.rand(-0.3, 0.4), vx: -Math.cos(q) * d / life, vy: -Math.sin(q) * d * 0.7 / life, life, R, plus: i % 3 === 0, minor: i % 2 === 1, update(p, _s, dt) { p.x += p.vx * dt; p.y += p.vy * dt; } }); }
      s2.light(x, y, 0.1, rs * 1.4 + 0.5, S(R, 0.9), warm ? 0.4 : 0.22, 0.2, { swell: true });
    });
    s.at(B.b, (s2) => {
      s2.add({ k: "raSun", x, y, z, r: r * (warm ? 1.05 : 1.25), n: B.saved ? 6 : B.crit ? 10 : 8, warm, hero: B.crit, life: B.saved ? 0.6 : 0.9, R, seed: sd0(s2), update: still });
      s2.light(x, y, 0.1, rs * 2.6 + 0.8, S(R, 0.9), (warm ? 0.5 : 0.3) * B.k, 0.9, { swell: warm });
      if (B.crit) s2.crit();
      for (let i = 0, N = Math.round(8 * B.k); i < N; i++) { const a = s2.rand(0, TAU), d = rs * s2.rand(0.6, 1.3); s2.add({ k: "glint", x: x + Math.cos(a) * d, y: y + Math.sin(a) * d * 0.7, z: z + s2.rand(-0.3, 0.6), life: 5 / 12, R, big: i === 0, wait: s2.rand(0.05, 0.5), minor: i > 2, update: still }); }
      for (let i = 0, N = Math.round((warm ? 6 : 12) * B.k); i < N; i++) s2.add({ k: "spark", x, y, z, ...out(s2, s2.rand(6, 11)), g: 6, drag: 2.2, life: s2.rand(0.2, 0.45), R, minor: i > 3 });
      if (warm) {
        const L = leafRamp(s2);
        if (!B.saved) s2.add({ k: "raLotus", x, y, r: rs * 0.8 + 0.2, n: 8, life: 1.5, R, update: still });
        for (let i = 0, N = Math.round(12 * B.k); i < N; i++) { const ph = (i / N) * TAU * 2, r0 = s2.rand(0.4, 0.8) * (rs + 0.2), life = s2.rand(0.8, 1.2), z0 = s2.rand(0, 0.25); s2.add({ k: "mote", x, y, z: z0, z0, life, R: i % 3 ? R : L, plus: i % 2 === 0, wait: s2.rand(0, 0.2), minor: i > 4, update: spiralMote(x, y, r0, ph, (i % 2 ? 1 : -1) * s2.rand(3, 4.5), s2.rand(0.9, 1.5), life, i % 4 === 0) }); }
        for (let i = 0, N = Math.round(6 * B.k); i < N; i++) { const q = s2.rand(0, TAU), sp = s2.rand(0.8, 2); s2.add({ k: "radLeaf", x, y, z: z * 0.5, vx: Math.cos(q) * sp, vy: Math.sin(q) * sp * 0.6, vz: s2.rand(1, 2.2), g: 0.9, drag: 2, life: s2.rand(1.1, 1.7), R: L, seed: s2.R(), minor: i > 2 }); }
      } else if (k === "holy") {
        s2.add({ k: "beam", x, y, h: 3.4 * Math.min(1.3, B.k), w: 2.6 * Math.min(1.3, B.k) * sz, life: 0.7, R, update: still });
        for (let i = 0; i < (B.saved ? 1 : 2); i++) s2.add({ k: "halo", x, y, z: 0.05, vz: s2.rand(0.9, 1.3), drag: 0.8, life: 0.9, r: rs * 0.5 + 0.2, R, wait: 0.12 + i * 0.14 });
      } else s2.add({ k: "radGlare", x, y, z, L: r * 0.75, life: 7 / 12, R, update: still });
      if (warm && !B.saved) s2.add({ k: "radPool", x, y, r: rs * 0.9 + 0.2, life: 2.8, R: leafRamp(s2), seed: sd0(s2), debris: true, update: still });
      s2.add({ k: "ring", x, y, r: rs * 1.7 + 0.4, life: warm ? 0.8 : 0.45, R, seed: sd0(s2), update: still });
    });
  },
  aura(s, M, { at }) {
    const k = kindOf(M);
    at(k === "light" ? 8 : 14, () => ({ k: "mote", vz: s.rand(0.5, 1.1), g: -0.3, drag: 1, life: s.rand(0.7, 1.2), plus: s.R() < 0.5, minor: s.R() < 0.4 }));
    if (k === "vitality") at(3, () => ({ k: "radLeaf", vz: s.rand(0.4, 0.8), vx: s.rand(-0.3, 0.3), g: 0.2, drag: 1.5, life: s.rand(0.9, 1.3), R: leafRamp(s), seed: s.R() }));
    if (k === "light") at(2, () => ({ k: "glint", life: 5 / 12, update: still }));
    if (k === "holy") at(1.5, () => ({ k: "glint", life: 5 / 12, update: still, minor: true }));
  },
  tick(s, M, T) {
    const k = kindOf(M);
    if (k === "light") { s.add({ k: "radGlare", x: T.x, y: T.y, z: 0.7 * T.h, L: 7, life: 7 / 12, R: M.R, update: still }); return; }
    if (k === "vitality") {
      s.add({ k: "raLotus", x: T.x, y: T.y, r: 0.55 * T.size, n: 6, life: 1, R: M.R, update: still });
      for (let i = 0; i < 6; i++) s.add({ k: "radLeaf", x: T.x + s.rand(-0.2, 0.2), y: T.y, z: 0.2, vx: s.rand(-0.6, 0.6), vz: s.rand(1, 1.6), g: 0.8, drag: 2, life: 1.1, R: leafRamp(s), seed: s.R() });
      s.add({ k: "raHeart", x: T.x, y: T.y - 0.05, z: 1.05 * T.h, vz: 0.4, drag: 1, life: 0.7, R: M.R });
      return;
    }
    s.add({ k: "halo", x: T.x, y: T.y, z: 0.05, vz: 1.1, drag: 0.8, life: 0.9, r: 0.5 * T.size, R: M.R });
    s.add({ k: "beam", x: T.x, y: T.y, h: 2.4, w: 4, life: 0.7, R: M.R, update: still });
  },
  /** A tick here is good news: no flinch. */
  gentle: true,
};
