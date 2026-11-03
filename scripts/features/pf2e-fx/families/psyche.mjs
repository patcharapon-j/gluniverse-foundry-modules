/**
 * Psyche: mental, illusion, spirit. Three materials that share a family because
 * none of them is a substance, and each has to read as itself:
 *
 *   mental    psychic pulses: concentric violet thought-rings that ripple out,
 *             a shimmering migraine crown over a struck head, a flickering light
 *   illusion  prismatic glints and mirror shards that pop into motes; things
 *             that appear, dissolve, and come back for one beat before they go
 *             (an illusion is fake, so it never quite commits to leaving)
 *   spirit    pale blue-teal wisps on long ghostly trails, soul-flames that
 *             burn without fuel, a soft halo
 */

import { TAU, clamp, lerp, easeOut, hash, fadeOut } from "../core/rand.mjs";
import { S, hsl2rgb } from "../core/palette.mjs";
import { registerShapes, snapH } from "../core/shapes.mjs";
import { physics } from "../core/sim.mjs";
import { out, sd, still, releaseFlash, counter, flourish } from "../core/motifs.mjs";

/** The prism's fringe: six hues around the wheel, light and saturated. */
const PRISM = Object.freeze([0, 48, 120, 188, 245, 300].map((h) => Object.freeze(hsl2rgb(h, 0.85, 0.72))));

/** An illusion's envelope: on, dissolve, gone, back for a beat, gone for good. */
const fakeA = (u) => (u < 0.5 ? 1 : u < 0.64 ? 1 - (u - 0.5) / 0.14 : u < 0.72 ? 0 : u < 0.8 ? 0.75 : 0);
const env = (p) => {
  if (p.life >= 1e8) return 1;
  const u = clamp(p.age / p.life);
  return p.fake ? fakeA(u) * Math.min(1, p.age * 12) : Math.min(1, p.age * 12) * fadeOut(u, p.from ?? 0.6);
};

/** A wisp's trail is the path it actually took, sampled at 30 Hz. */
function wispMove(p, s, dt) {
  if (p.spiral) {
    p.ph += p.spin * dt; p.rr += p.grow * dt;
    p.x = p.ox + Math.cos(p.ph) * p.rr; p.y = p.oy + Math.sin(p.ph) * p.rr * 0.6; p.z += p.rise * dt;
  } else physics(p, dt, s);
  p.tick = (p.tick ?? 0) + dt;
  if (p.tick >= 1 / 30) { p.tick = 0; (p.hist ??= []).unshift([p.x, p.y, p.z]); if (p.hist.length > (p.len ?? 9)) p.hist.pop(); }
}

/** A mirror shard tumbles under physics and pops into prism motes at the end of its life. */
function shardMove(p, s, dt) {
  physics(p, dt, s);
  if (!p.popped && p.age > p.life - 0.04) {
    p.popped = true;
    for (let i = 0; i < 3; i++) s.add({ k: "psyPrism", x: p.x, y: p.y, z: p.z, ...out(s, s.rand(0.5, 1.3)), drag: 3, life: s.rand(0.25, 0.4), R: p.R, hue: Math.floor(s.R() * 6), minor: i > 0 });
  }
}

registerShapes({
  /** A thought-ring: an ellipse that ripples out from a point, its rim wobbling. */
  psyRing(v, P, p) {
    const u = clamp(p.age / p.life), fr = Math.floor(p.age * 12), [cx, cy] = v.ap(p.x, p.y, p.z);
    const rr = lerp(p.r0, p.r1, easeOut(u)), flat = v.kind === "top" ? p.flatTop ?? 0.9 : p.flat ?? 0.42;
    if (rr < 1) return;
    const a = p.fake ? fakeA(u) : 1 - u * u, lobes = p.lobes ?? 5;
    const n = Math.max(12, Math.ceil(TAU * rr * 1.3));
    let lx = null, ly = null;
    for (let i = 0; i < n; i++) {
      const q = (i / n) * TAU, w = 1 + 0.09 * Math.sin(q * lobes + fr * 1.3 + (p.seed ?? 0));
      const x = Math.floor(cx + Math.cos(q) * rr * w), y = Math.floor(cy + Math.sin(q) * rr * w * flat);
      if (x === lx && y === ly) continue;
      lx = x; ly = y;
      if (p.dash && (i + fr) % 4 > 1) continue;
      const fl = p.decal ? 0 : 1;
      P.dot(x, y, S(p.R, Math.sin(q) < 0 ? 0.95 : 0.78), a, fl);
      if (u < 0.45 && !p.thin) P.dot(x, y + 1, S(p.R, 0.55), a, fl);
    }
  },

  /** The migraine crown: a ring of spikes over the head that shimmer in turn. */
  psyCrown(v, P, p) {
    const fr = Math.floor(p.age * 12), [cx, cy] = v.ap(p.x, p.y, p.z), rx = p.r, ry = v.kind === "top" ? rx * 0.75 : rx * 0.34;
    const a = env(p), n = p.n ?? 7, rot = fr * 0.12;
    for (let s = 0; s <= Math.ceil(TAU * rx); s++) {
      const q = (s / Math.ceil(TAU * rx)) * TAU, far = Math.sin(q) < 0;
      P.dot(cx + Math.cos(q) * rx, cy + Math.sin(q) * ry, S(p.R, far ? 0.5 : 0.75), a, 2);
    }
    for (let i = 0; i < n; i++) {
      const q = rot + (i * TAU) / n, far = Math.sin(q) < 0, x = Math.round(cx + Math.cos(q) * rx), y = Math.round(cy + Math.sin(q) * ry);
      const h = 2 + ((i + fr) % 3 === 0 ? 2 : (i + fr) % 3 === 1 ? 1 : 0);
      for (let j = 1; j <= h; j++) P.dot(x, y - j, S(p.R, j === h ? 1 : far ? 0.6 : 0.85), a, 2);
    }
  },

  /** A prismatic glint: a tiny diamond whose fringe walks round the colour wheel. */
  psyPrism(v, P, p) {
    let [x, y] = v.ap(p.x, p.y, p.z); [x, y] = snapH(p, v, x, y);
    const fr = Math.floor(p.age * 12), a = env(p), big = p.big && fr % 4 < 2, h = (p.hue ?? 0) + fr;
    P.dot(x, y, S(p.R, 1), a, 2);
    for (let i = 0; i < 4; i++) {
      const [dx, dy] = [[1, 0], [0, 1], [-1, 0], [0, -1]][i];
      P.dot(x + dx, y + dy, PRISM[(h + i) % 6], a, 2);
      if (big) P.dot(x + dx * 2, y + dy * 2, PRISM[(h + i + 1) % 6], a, 2);
    }
  },

  /** A mirror shard: a sliver with a lit edge and a dark edge, turning in eighths. */
  psyShard(v, P, p) {
    const [x, y] = v.ap(p.x, p.y, p.z), fr = Math.floor(p.age * 12), a = env(p);
    const q = (Math.floor(fr * (p.spin ?? 1) + (p.seed ?? 0) * 8) % 8) * (TAU / 8), L = p.L ?? 4, ux = Math.cos(q), uy = Math.sin(q);
    const nx = -uy, ny = ux;
    const tx = x + ux * L * 0.5, ty = y + uy * L * 0.5, bx = x - ux * L * 0.5, by = y - uy * L * 0.5;
    P.line(bx, by, tx, ty, null, 2, a, (f) => (f > 0.75 ? S(p.R, 1) : S(p.R, 0.82)));
    P.line(bx + nx, by + ny, lerp(bx, tx, 0.55) + nx, lerp(by, ty, 0.55) + ny, S(p.R, 0.5), 2, a);
    if ((fr + Math.floor((p.seed ?? 0) * 5)) % 5 === 0) P.dot(tx, ty, PRISM[fr % 6], a, 2);
  },

  /** A ghostly wisp: a bright head dragging the long trail of where it has been. */
  psyWisp(v, P, p) {
    const a = env(p), H = p.hist ?? [];
    const [hx, hy] = v.ap(p.x, p.y, p.z);
    let px = hx, py = hy;
    for (let i = 0; i < H.length; i++) {
      const [x, y] = v.ap(...H[i]), f = i / Math.max(1, H.length - 1);
      P.line(px, py, x, y, S(p.R, 0.82 - f * 0.4), 1, a * (f > 0.65 ? 0.5 : 1));
      px = x; py = y;
    }
    const s2 = p.s ?? 2;
    for (let j = 0; j < s2; j++) for (let i = 0; i < s2; i++) P.dot(hx + i - 0.5, hy + j - 0.5, S(p.R, j === 0 ? 1 : 0.9), a, 1);
  },

  /** A soul-flame: a teardrop of cold fire, bright in the core, its tip curling as it sways. */
  psySoul(v, P, p) {
    const u = clamp(p.age / p.life), fr = Math.floor(p.age * 12), [bx, by] = v.ap(p.x, p.y, p.z);
    const grow = Math.min(1, (fr + 1) / 3) * (u > 0.7 ? 1 - (u - 0.7) / 0.3 : 1);
    const H = Math.max(2, p.h * grow * (v.kind === "top" ? 0.65 : 1)), W = p.w * (0.6 + 0.4 * grow);
    for (let j = 0; j < H; j++) {
      const f = j / H, body = f < 0.3 ? Math.sqrt(f / 0.3) : 1 - ((f - 0.3) / 0.7) ** 1.4;
      const hw = W * body * (0.85 + 0.25 * hash(j >> 1, fr, p.seed));
      const sway = Math.sin(f * 3.2 - fr * 0.9 + p.seed) * f * f * 2.6;
      for (let i = Math.floor(-hw); i <= Math.ceil(hw); i++) {
        const e = Math.abs(i) / Math.max(hw, 0.6); if (e > 1) continue;
        P.px(bx + i + sway, by - j, S(p.R, e < 0.35 && f < 0.75 ? 1 : e < 0.7 ? 0.82 : 0.6), 1);
      }
    }
  },

  /**
   * What a psyche release leaves on the floor (flame leaves its scorch): a faint
   * stain whose rim says which one it was. Mental: thought-ripples that keep
   * running outward. Illusion: a prism rim whose dots blink in and out. Spirit:
   * a pale cold patch with a breathing rim.
   */
  psyStain(v, P, p) {
    const u = p.age / p.life, a = Math.min(1, p.age * 6) * fadeOut(u, 0.45), fr = Math.floor(p.age * 12);
    const [cx, cy] = v.ap(p.x, p.y, 0), rx = p.r * v.aps, ry = rx * v.sq;
    if (rx < 2) return;
    P.shade(cx - rx, cy - ry, cx + rx, cy + ry, (x, y) => {
      const dx = (x - cx) / rx, dy = (y - cy) / ry, d = dx * dx + dy * dy;
      return d > 1 ? null : { c: S(p.R, d < 0.35 ? 0.35 : 0.22), a: a * (d < 0.35 ? 0.4 : 0.28) };
    }, 0, "mix");
    const n = Math.max(16, Math.ceil(TAU * rx * 0.8));
    if (p.mode === "mental") {
      for (let k = 0; k < 2; k++) {
        const f = ((fr / 14 + k * 0.5) % 1), r = rx * (0.25 + 0.75 * f), ra = a * (1 - f);
        P.ellipse(cx, cy, r, r * v.sq, () => ({ c: S(p.R, 0.85), a: ra }));
      }
      P.ellipse(cx, cy, rx, ry, (q) => (Math.floor((q / TAU) * n) % 3 === 2 ? null : { c: S(p.R, 0.7), a }));
    } else if (p.mode === "illusion") {
      for (let i = 0; i < n; i += 2) {
        if (hash(i, fr >> 1, p.seed) < 0.45) continue;
        const q = (i / n) * TAU;
        P.dot(cx + Math.cos(q) * rx, cy + Math.sin(q) * ry, PRISM[(i + fr) % 6], a, 1);
      }
    } else {
      const br = 0.85 + 0.15 * Math.sin(fr * 0.5);
      P.ellipse(cx, cy, rx * br, ry * br, (q) => ({ c: S(p.R, Math.sin(q) < 0 ? 0.92 : 0.75), a: a * 0.85 }));
    }
  },
}, { flat: ["psyStain"] });

const MENTAL = "mental", ILLUSION = "illusion";
const kindOf = (M) => (M.material === MENTAL ? MENTAL : M.material === ILLUSION ? ILLUSION : "spirit");

/* ── the releases ────────────────────────────────────────────────────── */

/*
 * `sub`: one of many eruptions across an area (area.mjs). Lighter: no crown,
 * glyph, decoy or floor stain (the scar is areaFX's), fewer of everything.
 */
const lighter = (n, sub) => (sub ? (k) => Math.ceil(n(k) / 2) : n);

function mentalBurst(s, M, { x, y, z, pow, rad, sub }) {
  const R = M.R, m = s.m * pow, mm = Math.min(1.6, m), n = lighter(counter(s, pow, rad), sub), aps = s.spec.aps;
  releaseFlash(s, M, x, y, z, pow, rad);
  if (!sub) s.light(x, y, z, rad * 1.6 + 0.8, S(R, 0.8), 0.5 * mm, 1.1, { flicker: true });
  const rings = sub ? 1 : pow > 1.2 ? 4 : pow >= 0.5 ? 3 : 2;
  for (let i = 0; i < rings; i++) {
    s.add({ k: "psyRing", x, y, z: z + (i % 2) * 0.12, r0: 2, r1: (rad * 1.05 + 0.4) * aps * (0.55 + 0.45 * ((i + 1) / rings)), life: 0.55 + i * 0.05, R, seed: i * 3, wait: i * 0.09, update: still });
  }
  if (rad <= 0.5 && pow >= 0.6 && !sub) s.add({ k: "psyCrown", x, y, z: z + 0.55, r: 5 * Math.min(1.3, mm), n: pow > 1.2 ? 9 : 7, life: 1.4, R, wait: 0.08, update: still });
  if (rad > 0.5 && !sub) s.add({ k: "glyph", x, y, r: rad * 0.85, life: 1.1, R, glyphs: undefined, spin: -1, update: still });
  for (let i = 0; i < n(10); i++) s.add({ k: "spark", x, y, z, ...out(s, s.rand(2.5, 5)), g: 2, drag: 2.5, life: s.rand(0.25, 0.45), R, minor: i % 2 === 1 });
  for (let i = 0; i < n(8); i++) s.add({ k: "mote", x: x + s.rand(-1, 1) * rad * 0.6, y: y + s.rand(-1, 1) * rad * 0.6, z: z + s.rand(-0.2, 0.3), vz: s.rand(0.2, 0.6), drag: 1.5, life: s.rand(0.6, 1), R, plus: s.R() < 0.3, minor: i % 3 === 2 });
  if (sub) return;
  stain(s, M, x, y, pow, rad, "mental");
  flourish(s, M, x, y, z, rad, Math.round(5 * m));
}

function illusionBurst(s, M, { x, y, z, pow, rad, sub }) {
  const R = M.R, m = s.m * pow, n = lighter(counter(s, pow, rad), sub), aps = s.spec.aps;
  releaseFlash(s, M, x, y, z, pow, rad);
  for (let i = 0; i < n(10); i++) s.add({ k: "psyShard", x, y, z, ...out(s, s.rand(1.8, 4)), g: 3, drag: 2.2, life: s.rand(0.45, 0.8), R, L: s.R() < 0.4 ? 5 : 4, seed: s.R(), spin: s.R() < 0.5 ? 1 : -1, update: shardMove });
  for (let i = 0; i < n(9); i++) s.add({ k: "psyPrism", x: x + s.rand(-1, 1) * (rad + 0.2), y: y + s.rand(-1, 1) * (rad + 0.2) * 0.7, z: Math.max(0.05, z + s.rand(-0.3, 0.6)), life: s.rand(0.7, 1.1), R, hue: i, big: s.R() < 0.4, fake: true, wait: s.rand(0, 0.3), update: still });
  if (sub) return;
  // the decoy: a second, false release beside the real one that dissolves, comes back for a beat, and is gone
  const q = s.rand(0, TAU), d = rad * 0.6 + 0.45, fx = x + Math.cos(q) * d, fy = y + Math.sin(q) * d * 0.6;
  s.add({ k: "psyRing", x: fx, y: fy, z, r0: 2, r1: (rad * 0.6 + 0.3) * aps, life: 1.1, R, dash: true, fake: true, wait: 0.05, update: still });
  for (let i = 0; i < 4; i++) s.add({ k: "psyPrism", x: fx + s.rand(-0.2, 0.2), y: fy + s.rand(-0.15, 0.15), z: z + s.rand(-0.1, 0.4), life: 1, R, hue: i * 2, fake: true, wait: 0.05, update: still });
  s.add({ k: "psyRing", x, y, z, r0: 3, r1: (rad * 1.1 + 0.4) * aps, life: 0.6, R, dash: true, update: still });
  stain(s, M, x, y, pow, rad, "illusion");
  flourish(s, M, x, y, z, rad, Math.round(5 * m));
}

function spiritBurst(s, M, { x, y, z, pow, rad, sub }) {
  const R = M.R, m = s.m * pow, mm = Math.min(1.6, m), n = lighter(counter(s, pow, rad), sub);
  releaseFlash(s, M, x, y, z, pow, rad);
  const nw = n(7);
  for (let i = 0; i < nw; i++) s.add({ k: "psyWisp", x, y, z, ox: x, oy: y, spiral: true, ph: (i / nw) * TAU + s.rand(-0.3, 0.3), rr: 0.05, grow: s.rand(0.9, 1.6) * (0.6 + rad * 0.4), spin: (i % 2 ? 1 : -1) * s.rand(3, 4.5), rise: s.rand(0.3, 0.9), life: s.rand(0.8, 1.3), len: 11, R, glow: i < 2, minor: i % 4 === 3, update: wispMove });
  const ns = sub ? 1 : pow >= 0.5 ? Math.max(1, Math.round((1 + rad * 2) * Math.min(1.3, mm))) : 1;
  for (let i = 0; i < ns; i++) {
    const a = s.rand(0, TAU), d = i ? Math.sqrt(s.R()) * rad * 0.7 : 0;
    s.add({ k: "psySoul", x: x + Math.cos(a) * d, y: y + Math.sin(a) * d * 0.7, z: i ? 0 : Math.max(0, z - 0.45), h: (i ? s.rand(9, 14) : 16) * Math.min(1.3, mm), w: i ? 2.2 : 3, life: s.rand(0.9, 1.3), R, seed: s.R() * 10, wait: i * 0.05, glow: !i, update: still });
  }
  for (let i = 0; i < n(10); i++) s.add({ k: "mote", x: x + s.rand(-1, 1) * rad * 0.7, y: y + s.rand(-1, 1) * rad * 0.5, z: s.rand(0.05, 0.6), vz: s.rand(0.4, 1), g: -0.2, drag: 1.4, life: s.rand(0.8, 1.4), R, minor: i % 2 === 1 });
  if (sub) return;
  s.add({ k: "halo", x, y, z: 0.05, vz: 0.8, drag: 0.8, life: 1, r: rad * 0.5 + 0.25, R, wait: 0.1 });
  stain(s, M, x, y, pow, rad, "spirit");
  flourish(s, M, x, y, z, rad, Math.round(5 * m));
}

/** The floor stain, as flame leaves its scorch: only a real release leaves one. */
function stain(s, M, x, y, pow, rad, mode) {
  if (pow >= 0.5) s.add({ k: "psyStain", x, y, r: rad * 0.8 + 0.15, life: 4.5, R: M.R, mode, seed: sd(s), debris: true, update: still });
}

const wisp = (s, R, extra) => ({ k: "psyWisp", R, update: wispMove, ...extra });

export default {
  id: "psyche",

  burst(s, M, o) {
    const k = kindOf(M);
    if (k === MENTAL) mentalBurst(s, M, o); else if (k === ILLUSION) illusionBurst(s, M, o); else spiritBurst(s, M, o);
  },

  trail(s, M, { x, y, z, dt }) {
    const R = M.R, k = kindOf(M);
    if (k === MENTAL) {
      for (let i = s.count(9 * s.m, dt); i > 0; i--) s.add({ k: "psyRing", x, y, z, r0: 1, r1: 6, life: 0.3, R, thin: true, flat: 0.9, update: still });
      for (let i = s.count(20 * s.m, dt); i > 0; i--) s.add({ k: "mote", x, y, z, vx: s.rand(-0.3, 0.3), vy: s.rand(-0.3, 0.3), drag: 2, life: s.rand(0.3, 0.5), R, minor: true });
    } else if (k === ILLUSION) {
      for (let i = s.count(16 * s.m, dt); i > 0; i--) s.add({ k: "psyPrism", x: x + s.rand(-0.06, 0.06), y: y + s.rand(-0.06, 0.06), z, life: s.rand(0.35, 0.55), R, hue: Math.floor(s.R() * 6), fake: true, update: still });
      for (let i = s.count(7 * s.m, dt); i > 0; i--) s.add({ k: "psyShard", x, y, z, vx: s.rand(-0.6, 0.6), vy: s.rand(-0.6, 0.6), vz: s.rand(0, 0.6), g: 2, drag: 2, life: 0.35, L: 3, R, seed: s.R(), update: shardMove, minor: true });
    } else {
      for (let i = s.count(26 * s.m, dt); i > 0; i--) s.add({ k: "mote", x, y, z, vx: s.rand(-0.25, 0.25), vy: s.rand(-0.25, 0.25), vz: s.rand(0, 0.3), drag: 1.5, life: s.rand(0.35, 0.6), R, minor: true });
      for (let i = s.count(5 * s.m, dt); i > 0; i--) s.add(wisp(s, R, { x, y, z, vx: s.rand(-0.6, 0.6), vy: s.rand(-0.6, 0.6), vz: s.rand(0.1, 0.5), drag: 2, life: s.rand(0.4, 0.6), len: 6, s: 1 }));
    }
  },

  linger(s, M, { at }) {
    const k = kindOf(M);
    if (k === MENTAL) {
      at(3.5, () => ({ k: "psyRing", r0: 1, r1: 9, life: 0.7, flat: 0.5, flatTop: 0.9, z: 0.05, decal: true, update: still }));
      at(8, () => ({ k: "mote", vz: s.rand(0.3, 0.7), drag: 1.2, life: s.rand(0.6, 1), plus: s.R() < 0.3, minor: s.R() < 0.5 }));
    } else if (k === ILLUSION) {
      at(10, () => ({ k: "psyPrism", z: s.rand(0.1, 0.7), life: s.rand(0.6, 1), hue: Math.floor(s.R() * 6), fake: s.R() < 0.4, big: s.R() < 0.35, update: still }));
      at(2.5, () => ({ k: "psyShard", z: 0.1, vz: s.rand(0.4, 0.8), g: -0.1, drag: 1.5, life: s.rand(0.6, 0.9), L: s.R() < 0.4 ? 4 : 3, seed: s.R(), update: shardMove }));
      at(0.7, () => ({ k: "psyRing", z: 0.05, r0: 1, r1: 7, life: 0.9, dash: true, fake: true, flat: 0.5, decal: true, update: still }));
    } else {
      at(3.5, () => ({ k: "psySoul", z: 0, h: s.rand(7, 11), w: 2, life: s.rand(0.7, 1.1), seed: s.R() * 10, update: still }));
      at(5, () => wisp(s, M.R, { z: 0.1, vz: s.rand(0.4, 0.8), vx: s.rand(-0.3, 0.3), drag: 1, life: s.rand(0.7, 1.1), len: 8 }));
      at(5, () => ({ k: "mote", vz: s.rand(0.4, 0.9), g: -0.2, drag: 1.3, life: s.rand(0.7, 1.1), minor: true }));
    }
  },

  spray(s, M, { emit }) {
    const k = kindOf(M);
    if (k === MENTAL) {
      emit("psyRing", 24, () => ({ drag: 1.4, r0: 2, r1: 8, life: 0.55, flat: 0.8, thin: true, update(p, _s, dt) { physics(p, dt, _s); } }));
      emit("mote", 40, () => ({ drag: 1.6, life: 0.6, minor: true }));
    } else if (k === ILLUSION) {
      emit("psyShard", 34, () => ({ drag: 1.5, g: 1, life: s.rand(0.5, 0.75), L: 4, seed: s.R(), update: shardMove }));
      emit("psyPrism", 30, () => ({ drag: 1.8, life: 0.6, hue: Math.floor(s.R() * 6), fake: true, minor: true, update(p, _s, dt) { physics(p, dt, _s); } }));
    } else {
      emit("psyWisp", 26, () => ({ drag: 1.3, g: -0.3, life: s.rand(0.6, 0.85), len: 10, update: wispMove }));
      emit("mote", 40, () => ({ drag: 1.6, g: -0.3, life: 0.7, minor: true }));
    }
  },

  auraStart(s, M, T) {
    if (kindOf(M) === MENTAL) s.add({ k: "psyCrown", x: T.x, y: T.y - 0.3 * T.size, z: 1.12 * T.h, r: 5 * Math.sqrt(T.size), life: 1e9, R: M.R, update: still });
  },

  aura(s, M, { at, T }) {
    const k = kindOf(M);
    if (k === MENTAL) {
      at(1.1, () => ({ k: "psyRing", x: T.x, y: T.y, z: s.rand(0.3, 0.8) * T.h, r0: 3, r1: 0.6 * T.size * s.spec.aps, life: 0.6, thin: true, update: still }));
      at(4, () => ({ k: "mote", vz: s.rand(0.2, 0.5), drag: 1.5, life: s.rand(0.6, 0.9), minor: true }));
    } else if (k === ILLUSION) {
      at(5, () => ({ k: "psyPrism", life: s.rand(0.6, 1), hue: Math.floor(s.R() * 6), fake: true, update: still }));
      at(1.2, () => ({ k: "psyShard", vz: s.rand(0.3, 0.6), g: -0.1, drag: 1.5, life: 0.7, L: 3, seed: s.R(), update: shardMove }));
    } else {
      at(2, () => ({ k: "psySoul", z: 0, h: s.rand(6, 10), w: 2, life: s.rand(0.7, 1), seed: s.R() * 10, update: still }), false);
      at(2.5, () => wisp(s, M.R, { vz: s.rand(0.4, 0.8), vx: s.rand(-0.3, 0.3), drag: 1, life: s.rand(0.7, 1.1), len: 8 }));
    }
  },
};
