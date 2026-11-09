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
import { S, WHITE, hsl2rgb } from "../core/palette.mjs";
import { registerShapes, snapH } from "../core/shapes.mjs";
import { physics } from "../core/sim.mjs";
import { out, sd, still, releaseFlash, counter, flourish } from "../core/motifs.mjs";
import { dustLobes } from "./physical.mjs";

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


/* ── the bloom: a mind spike (deliveries.mjs bloom, Daze and its kin) ─── */

registerShapes({
  /**
   * The mind spike, at the head: a lance of thought driven up out of the skull
   * (white root on the hero frame only), the skull's crack running out round
   * it in jagged forks, and a four-point star at the brow. It strikes in two
   * frames, holds three, then the lance breaks off and rises as it fades.
   */
  psySpike(v, P, p) {
    const fr = Math.floor(p.age * 12); if (fr > 8) return;
    const [x, y] = v.ap(p.x, p.y, p.z), r = p.r, a = fr < 5 ? 1 : (9 - fr) / 4, top = v.kind === "top";
    const hot = p.hero && fr < 2, root = hot ? WHITE : S(p.R, 1);
    // the lance: tapered, a lit spine, a dark edge on one side so it reads on parchment
    const H = r * [0.55, 1.15, 1.35, 1.3, 1.25, 1.1, 0.95, 0.8, 0.65][fr] * (top ? 0.75 : 1), lift = fr >= 5 ? (fr - 4) * 3 : 0, W = 2 + r / 18;
    for (let j = 0; j <= H; j++) {
      const f = j / H, w = W * (1 - f) ** 0.8 + 0.3, yy = y - 5 - j - lift;
      for (let i = Math.floor(-w); i <= Math.ceil(w); i++) {
        const e = Math.abs(i) / Math.max(0.6, w); if (e > 1) continue;
        const c = e < 0.34 ? (f < 0.3 ? root : S(p.R, 0.95)) : i < 0 ? S(p.R, 0.82 - f * 0.15) : S(p.R, 0.55);
        P.dot(x + i, yy, c, a, 2);
      }
    }
    // the crack: forks running out round the head, two segments each, a branch off the elbow
    const grow = Math.min(1, (fr + 1) / 2), gone = fr > 3 ? (fr - 3) / 5 : 0, sq = top ? 0.8 : 0.45;
    for (let k = 0; k < p.n; k++) {
      const q = (k / p.n) * TAU + hash(k, p.seed) * 0.6, L = r * (0.6 + 0.45 * hash(k, p.seed, 1)) * grow;
      const kq = q + (hash(k, p.seed, 2) < 0.5 ? -0.35 : 0.35);
      const mx = x + Math.cos(q) * L * 0.5, my = y + Math.sin(q) * L * 0.5 * sq, ex = mx + Math.cos(kq) * L * 0.5, ey = my + Math.sin(kq) * L * 0.5 * sq;
      const c = (f) => (f < gone ? null : S(p.R, f < 0.4 ? 1 : f < 0.75 ? 0.88 : 0.7));
      P.line(x, y, mx, my, null, 2, a, (f) => c(f * 0.5));
      P.line(mx, my, ex, ey, null, 2, a, (f) => c(0.5 + f * 0.5));
      if (fr >= 1 && k % 2 === 0) { const bq = kq + (k % 4 ? 0.9 : -0.9); P.line(mx, my, mx + Math.cos(bq) * L * 0.3, my + Math.sin(bq) * L * 0.3 * sq, S(p.R, 0.75), 1, a); }
    }
    // the brow star
    if (fr < 4) {
      const L = [4, 7, 5, 3][fr] * (r / 22) + 1;
      P.line(x - L, y, x + L, y, null, 2, a, () => (hot ? WHITE : S(p.R, 1)));
      P.line(x, y - L, x, y + L, null, 2, a, () => (hot ? WHITE : S(p.R, 1)));
    }
  },
});

const MENTAL = "mental", ILLUSION = "illusion";
const kindOf = (M) => (M.material === MENTAL ? MENTAL : M.material === ILLUSION ? ILLUSION : "spirit");

/* ── the releases ────────────────────────────────────────────────────── */

/*
 * `sub`: one of many eruptions across an area (area.mjs). Lighter: no crown,
 * glyph, decoy or floor stain (the scar is areaFX's), fewer of everything.
 */
const lighter = (n, sub) => (sub ? (k) => Math.ceil(n(k) / 2.5) : n);

/** A mote that circles a point at a fixed height, like the stars round a dazed head. */
function orbit(cx, cy, z, r, ph, w) {
  return (p) => { const q = ph + w * p.age; p.x = cx + Math.cos(q) * r; p.y = cy + Math.sin(q) * r * 0.45; p.z = z + Math.sin(q * 2) * 0.04; };
}

function mentalBurst(s, M, { x, y, z, pow, rad, sub }) {
  const R = M.R, m = s.m * pow, mm = Math.min(1.6, m), n = lighter(counter(s, pow, rad), sub), aps = s.spec.aps;
  releaseFlash(s, M, x, y, z, pow, rad, sub ? { flash: 0.6, light: 0.22 } : undefined);
  if (!sub) s.light(x, y, z, rad * 2.4 + 1.2, S(R, 0.8), 0.6 * mm, 1.4, { flicker: true });
  // thought-rings rippling out in a train, the last ones reaching well past the target
  const rings = sub ? 2 : pow > 1.2 ? 6 : pow >= 0.5 ? 5 : 3;
  for (let i = 0; i < rings; i++) {
    s.add({ k: "psyRing", x, y, z: z + (i % 2) * 0.12, r0: 2, r1: Math.min(rad * 1.9 + 0.9, rad * 1.1 + 1.4) * aps * (0.45 + 0.55 * ((i + 1) / rings)) * (sub ? 0.6 : 1), life: 0.6 + i * 0.06, R, seed: i * 3, wait: i * 0.08, update: still });
  }
  // and the same on the floor, slower, as a decal
  if (!sub) for (let i = 0; i < 2; i++) s.add({ k: "psyRing", x, y, z: 0.02, r0: 3, r1: Math.min(rad * 2.2 + 1.1, rad * 1.1 + 1.6) * aps, life: 0.9, R, flat: 0.5, flatTop: 0.9, decal: true, dash: i === 1, seed: 7 + i, wait: 0.1 + i * 0.2, update: still });
  if (rad <= 0.5 && pow >= 0.6 && !sub) s.add({ k: "psyCrown", x, y, z: z + 0.55, r: 6 * Math.min(1.3, mm), n: pow > 1.2 ? 9 : 7, life: 1.5, R, wait: 0.08, update: still });
  if (!sub && pow >= 0.5) s.add({ k: "glyph", x, y, r: rad * 1.3 + 0.5, life: 1.3, R, glyphs: undefined, spin: -1, update: still });
  // dazed: stars that circle the head
  if (!sub && pow >= 0.5) for (let i = 0; i < 5; i++) s.add({ k: "mote", x, y, z: z + 0.45, life: 1.3, R, plus: true, wait: 0.12, update: orbit(x, y, z + 0.45, 0.32 + rad * 0.3, (i / 5) * TAU, 5) });
  for (let i = 0, N = n(22); i < N; i++) s.add({ k: "spark", x, y, z, ...out(s, s.rand(3, 8)), g: 2, drag: 2.5, life: s.rand(0.25, 0.55), R, minor: i >= (sub ? 2 : 6) });
  for (let i = 0, N = n(20); i < N; i++) s.add({ k: "mote", x: x + s.rand(-1, 1) * (rad + 0.4), y: y + s.rand(-1, 1) * (rad + 0.4) * 0.7, z: z + s.rand(-0.2, 0.4), vz: s.rand(0.2, 0.7), drag: 1.5, life: s.rand(0.6, 1.2), R, plus: s.R() < 0.35, wait: s.rand(0, 0.3), minor: i >= (sub ? 1 : 5) });
  if (sub) return;
  stain(s, M, x, y, pow, rad, "mental");
  flourish(s, M, x, y, z, rad, Math.round(5 * m));
}

function illusionBurst(s, M, { x, y, z, pow, rad, sub }) {
  const R = M.R, m = s.m * pow, mm = Math.min(1.6, m), n = lighter(counter(s, pow, rad), sub), aps = s.spec.aps;
  releaseFlash(s, M, x, y, z, pow, rad, sub ? { flash: 0.6, light: 0.22 } : undefined);
  // mirrors close in on the spot from a ring round it, then everything shatters
  if (!sub) for (let i = 0; i < 8; i++) {
    const q = (i / 8) * TAU, d = rad + 0.55, life = 0.22;
    s.add({ k: "psyShard", x: x + Math.cos(q) * d, y: y + Math.sin(q) * d * 0.7, z, vx: -Math.cos(q) * d / life, vy: -Math.sin(q) * d * 0.7 / life, life, R, L: 6, seed: i / 8, spin: i % 2 ? 1 : -1, update: shardMove, minor: i % 2 === 1 });
  }
  for (let i = 0, N = n(22); i < N; i++) s.add({ k: "psyShard", x, y, z, ...out(s, s.rand(2, 5.5)), g: 3, drag: 2, life: s.rand(0.5, 0.95), R, L: s.R() < 0.4 ? 6 : 4, seed: s.R(), spin: s.R() < 0.5 ? 1 : -1, wait: sub ? 0 : 0.2, update: shardMove, minor: i >= (sub ? 2 : 7) });
  for (let i = 0, N = n(20); i < N; i++) s.add({ k: "psyPrism", x: x + s.rand(-1, 1) * (rad + 0.5), y: y + s.rand(-1, 1) * (rad + 0.5) * 0.7, z: Math.max(0.05, z + s.rand(-0.3, 0.7)), life: s.rand(0.7, 1.2), R, hue: i, big: s.R() < 0.4, fake: true, wait: s.rand(0.1, 0.4), minor: i >= (sub ? 2 : 6) });
  if (sub) return;
  // two decoys: false releases beside the real one that dissolve, come back for a beat, and are gone
  for (let j = 0; j < 2; j++) {
    const q = s.rand(0, TAU) + j * Math.PI, d = rad * 0.7 + 0.6, fx = x + Math.cos(q) * d, fy = y + Math.sin(q) * d * 0.6;
    s.add({ k: "psyRing", x: fx, y: fy, z, r0: 2, r1: Math.min(rad * 0.8 + 0.4, rad * 1.1 + 0.9) * aps, life: 1.2, R, dash: true, fake: true, wait: 0.12 + j * 0.08, update: still });
    s.add({ k: "psyCrown", x: fx, y: fy, z: z * 0.8, r: 4 * Math.min(1.3, mm), n: 6, life: 1.2, R, fake: true, wait: 0.12 + j * 0.08, update: still });
    for (let i = 0; i < 5; i++) s.add({ k: "psyPrism", x: fx + s.rand(-0.25, 0.25), y: fy + s.rand(-0.15, 0.15), z: z + s.rand(-0.1, 0.5), life: 1.1, R, hue: i * 2 + j, fake: true, big: i === 0, wait: 0.12 + j * 0.08, minor: i >= 2, update: still });
  }
  s.add({ k: "psyRing", x, y, z, r0: 3, r1: Math.min(rad * 1.9 + 0.9, rad * 1.1 + 1.4) * aps, life: 0.65, R, dash: true, update: still });
  s.add({ k: "psyRing", x, y, z: 0.02, r0: 3, r1: Math.min(rad * 2.2 + 1, rad * 1.1 + 1.5) * aps, life: 1, R, dash: true, fake: true, flat: 0.5, flatTop: 0.9, decal: true, wait: 0.15, update: still });
  stain(s, M, x, y, pow, rad, "illusion");
  flourish(s, M, x, y, z, rad, Math.round(5 * m));
}

function spiritBurst(s, M, { x, y, z, pow, rad, sub }) {
  const R = M.R, m = s.m * pow, mm = Math.min(1.6, m), n = lighter(counter(s, pow, rad), sub);
  releaseFlash(s, M, x, y, z, pow, rad, sub ? { flash: 0.6, light: 0.22 } : undefined);
  // wisps spiral out from the spot on long ghostly trails
  const nw = n(13);
  for (let i = 0; i < nw; i++) s.add({ k: "psyWisp", x, y, z, ox: x, oy: y, spiral: true, ph: (i / nw) * TAU + s.rand(-0.3, 0.3), rr: 0.05, grow: s.rand(1, 1.9) * (0.7 + rad * 0.45), spin: (i % 2 ? 1 : -1) * s.rand(3, 4.5), rise: s.rand(0.3, 1), life: s.rand(0.9, 1.5), len: 14, R, glow: i < 2, minor: i >= (sub ? 2 : 5), update: wispMove });
  // soul-flames burning without fuel round the spot
  const ns = sub ? 1 : pow >= 0.5 ? Math.max(2, Math.round((2 + rad * 3) * Math.min(1.3, mm))) : 1;
  for (let i = 0; i < ns; i++) {
    const a = s.rand(0, TAU), d = i ? Math.sqrt(s.R()) * (rad + 0.4) : 0;
    s.add({ k: "psySoul", x: x + Math.cos(a) * d, y: y + Math.sin(a) * d * 0.7, z: i ? 0 : Math.max(0, z - 0.45), h: (i ? s.rand(12, 18) : 22) * Math.min(1.3, mm), w: i ? 2.6 : 3.8, life: s.rand(1, 1.5), R, seed: s.R() * 10, wait: i * 0.05, glow: !i, minor: i >= 3, update: still });
  }
  // cold mist and motes drifting up
  for (let i = 0, N = sub ? 0 : n(3); i < N; i++) s.add({ k: "phDust", x: x + s.rand(-0.3, 0.3) * rad, y: y + s.rand(-0.2, 0.2) * rad, z: 0.1, vx: s.rand(-0.5, 0.5), vy: s.rand(-0.3, 0.3), vz: s.rand(0.2, 0.5), drag: 1.5, r: s.rand(7, 10), life: s.rand(1.2, 1.7), R, tone: 0.75, a0: 0.3, lobes: dustLobes(s), wait: s.rand(0.05, 0.2), minor: i >= 1 });
  for (let i = 0, N = n(22); i < N; i++) s.add({ k: "mote", x: x + s.rand(-1, 1) * (rad + 0.4), y: y + s.rand(-1, 1) * (rad + 0.4) * 0.6, z: s.rand(0.05, 0.6), vz: s.rand(0.5, 1.2), g: -0.2, drag: 1.4, life: s.rand(0.9, 1.6), R, minor: i >= (sub ? 1 : 6) });
  if (sub) return;
  for (let i = 0; i < 2; i++) s.add({ k: "halo", x, y, z: 0.05, vz: 0.9, drag: 0.8, life: 1.1, r: rad * 0.6 + 0.3, R, wait: 0.1 + i * 0.2 });
  s.add({ k: "ring", x, y, r: Math.min(rad * 2 + 0.9, rad * 1.1 + 1.4) * Math.min(1.3, mm), life: 0.6, R, broken: true, seed: sd(s), update: still });
  stain(s, M, x, y, pow, rad, "spirit");
  flourish(s, M, x, y, z, rad, Math.round(5 * m));
}

/** The floor stain, as flame leaves its scorch: only a real release leaves one. */
function stain(s, M, x, y, pow, rad, mode) {
  if (pow >= 0.5) s.add({ k: "psyStain", x, y, r: rad * 1.3 + 0.35, life: 4.5, R: M.R, mode, seed: sd(s), debris: true, update: still });
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
      for (let i = s.count(14 * s.m, dt); i > 0; i--) s.add({ k: "psyRing", x, y, z, r0: 1, r1: 9, life: 0.35, R, thin: true, flat: 0.9, update: still });
      for (let i = s.count(34 * s.m, dt); i > 0; i--) s.add({ k: "mote", x, y, z, vx: s.rand(-0.4, 0.4), vy: s.rand(-0.4, 0.4), drag: 2, life: s.rand(0.35, 0.6), R, plus: s.R() < 0.2, minor: s.R() < 0.7 });
    } else if (k === ILLUSION) {
      for (let i = s.count(26 * s.m, dt); i > 0; i--) s.add({ k: "psyPrism", x: x + s.rand(-0.08, 0.08), y: y + s.rand(-0.08, 0.08), z, life: s.rand(0.35, 0.6), R, hue: Math.floor(s.R() * 6), fake: true, minor: s.R() < 0.6, update: still });
      for (let i = s.count(12 * s.m, dt); i > 0; i--) s.add({ k: "psyShard", x, y, z, vx: s.rand(-0.8, 0.8), vy: s.rand(-0.8, 0.8), vz: s.rand(0, 0.6), g: 2, drag: 2, life: 0.4, L: 3, R, seed: s.R(), update: shardMove, minor: true });
    } else {
      for (let i = s.count(40 * s.m, dt); i > 0; i--) s.add({ k: "mote", x, y, z, vx: s.rand(-0.3, 0.3), vy: s.rand(-0.3, 0.3), vz: s.rand(0, 0.3), drag: 1.5, life: s.rand(0.4, 0.7), R, minor: s.R() < 0.7 });
      for (let i = s.count(9 * s.m, dt); i > 0; i--) s.add(wisp(s, R, { x, y, z, vx: s.rand(-0.8, 0.8), vy: s.rand(-0.8, 0.8), vz: s.rand(0.1, 0.6), drag: 2, life: s.rand(0.45, 0.7), len: 7, s: 1, minor: s.R() < 0.5 }));
    }
  },

  linger(s, M, { at }) {
    const k = kindOf(M);
    if (k === MENTAL) {
      at(4.5, () => ({ k: "psyRing", r0: 1, r1: 12, life: 0.8, flat: 0.5, flatTop: 0.9, z: 0.05, decal: true, update: still }));
      at(10, () => ({ k: "mote", vz: s.rand(0.3, 0.8), drag: 1.2, life: s.rand(0.6, 1.1), plus: s.R() < 0.3, minor: s.R() < 0.5 }));
    } else if (k === ILLUSION) {
      at(13, () => ({ k: "psyPrism", z: s.rand(0.1, 0.8), life: s.rand(0.6, 1.1), hue: Math.floor(s.R() * 6), fake: s.R() < 0.4, big: s.R() < 0.35, minor: s.R() < 0.5, update: still }));
      at(3.5, () => ({ k: "psyShard", z: 0.1, vz: s.rand(0.4, 0.9), g: -0.1, drag: 1.5, life: s.rand(0.6, 1), L: s.R() < 0.4 ? 5 : 3, seed: s.R(), update: shardMove }));
      at(1, () => ({ k: "psyRing", z: 0.05, r0: 1, r1: 9, life: 0.9, dash: true, fake: true, flat: 0.5, decal: true, update: still }));
    } else {
      at(4.5, () => ({ k: "psySoul", z: 0, h: s.rand(9, 14), w: 2.2, life: s.rand(0.8, 1.2), seed: s.R() * 10, update: still }));
      at(6, () => wisp(s, M.R, { z: 0.1, vz: s.rand(0.4, 0.9), vx: s.rand(-0.3, 0.3), drag: 1, life: s.rand(0.8, 1.2), len: 10 }));
      at(6, () => ({ k: "mote", vz: s.rand(0.4, 0.9), g: -0.2, drag: 1.3, life: s.rand(0.7, 1.1), minor: true }));
    }
  },

  spray(s, M, { emit }) {
    const k = kindOf(M);
    if (k === MENTAL) {
      emit("psyRing", 34, () => ({ drag: 1.4, r0: 2, r1: 11, life: 0.6, flat: 0.8, thin: true, update(p, _s, dt) { physics(p, dt, _s); } }));
      emit("mote", 60, () => ({ drag: 1.6, life: s.rand(0.6, 0.9), plus: s.R() < 0.2, minor: s.R() < 0.6 }));
      emit("spark", 20, () => ({ drag: 2, g: 1, life: 0.35, minor: true }));
    } else if (k === ILLUSION) {
      emit("psyShard", 48, () => ({ drag: 1.5, g: 1, life: s.rand(0.5, 0.8), L: s.R() < 0.3 ? 6 : 4, seed: s.R(), update: shardMove, minor: s.R() < 0.5 }));
      emit("psyPrism", 46, () => ({ drag: 1.8, life: s.rand(0.5, 0.8), hue: Math.floor(s.R() * 6), fake: true, big: s.R() < 0.25, minor: true, update(p, _s, dt) { physics(p, dt, _s); } }));
    } else {
      emit("psyWisp", 38, () => ({ drag: 1.3, g: -0.3, life: s.rand(0.6, 0.95), len: 12, update: wispMove, minor: s.R() < 0.5 }));
      emit("mote", 60, () => ({ drag: 1.6, g: -0.3, life: s.rand(0.6, 0.9), minor: s.R() < 0.6 }));
    }
  },

  /**
   * A mind spike (spellsprite-craft §5 status/confused, shadow/soul-drain):
   * needles of thought converge on the head, the spike is driven up out of it
   * with the skull's crack forking round, thought-rings ripple out at head
   * height to well past the creature and on the floor, and stars circle the
   * dazed head. Illusion breaks into mirror shards and prism glints, spirit
   * into wisps.
   */
  bloom(s, M, B) {
    const R = M.R, k = kindOf(M), aps = s.spec.aps, { x, y, head, r, sz } = B, rs = r / aps;
    s.at(B.at, (s2) => {
      for (let i = 0; i < 12; i++) {
        const q = (i / 12) * TAU + s2.rand(-0.15, 0.15), d = rs * 1.7 + 0.3, life = 0.17, zz = head + s2.rand(-0.15, 0.45);
        s2.add({ k: "streak", x: x + Math.cos(q) * d, y: y + Math.sin(q) * d * 0.7, z: zz, vx: -Math.cos(q) * d / life, vy: -Math.sin(q) * d * 0.7 / life, vz: (head - zz) / life, life, R, minor: i % 2 === 1, update(p, _s, dt) { p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; } });
      }
      s2.light(x, y, 0.2, rs * 1.6 + 0.6, S(R, 0.9), 0.5, 0.2, { swell: true });
    });
    s.at(B.b, (s2) => {
      s2.add({ k: "psySpike", x, y, z: head, r, n: B.saved ? 4 : B.crit ? 8 : 6, hero: B.crit, life: 0.8, R, seed: sd(s2), update: still });
      s2.light(x, y, head, rs * 1.4 + 0.5, S(R, 0.95), B.crit ? 0.75 : 0.45, 0.3, { flicker: true });
      s2.light(x, y, 0.1, rs * 2.6 + 0.8, S(R, 0.8), 0.45, 1.3);
      // thought-rings at head height, the last reaching well past the creature; two more on the floor
      const rings = B.saved ? 2 : B.crit ? 5 : 4;
      for (let i = 0; i < rings; i++) s2.add({ k: "psyRing", x, y, z: head - i * 0.06, r0: 3, r1: r * (0.9 + 0.32 * i), life: 0.5 + i * 0.06, R, seed: i * 3, dash: k === ILLUSION && i % 2 === 1, wait: i * 0.06, thin: i > 1, update: still });
      for (let i = 0; i < (B.saved ? 1 : 2); i++) s2.add({ k: "psyRing", x, y, z: 0.02, r0: 3, r1: r * (1.5 + i * 0.4), life: 0.9, R, flat: 0.5, flatTop: 0.9, decal: true, dash: i === 1, seed: 7 + i, wait: 0.06 + i * 0.14, update: still });
      // sparks thrown out of the crack, flat and fast
      for (let i = 0, N = Math.round(14 * B.k); i < N; i++) {
        const q = s2.rand(0, TAU), sp = s2.rand(5, 11) * B.k;
        s2.add({ k: "spark", x, y, z: head, vx: Math.cos(q) * sp, vy: Math.sin(q) * sp * 0.8, vz: s2.rand(-0.5, 2.5), g: 3, drag: 2.6, life: s2.rand(0.22, 0.45), R, minor: i > 4 });
      }
      if (k === ILLUSION) for (let i = 0, N = Math.round(10 * B.k); i < N; i++) s2.add({ k: "psyShard", x, y, z: head, ...out(s2, s2.rand(2.5, 5.5) * B.k), g: 3, drag: 2, life: s2.rand(0.5, 0.9), R, L: i % 3 ? 4 : 6, seed: s2.R(), spin: i % 2 ? 1 : -1, update: shardMove, minor: i > 3 });
      else if (k === "spirit") for (let i = 0, N = Math.round(7 * B.k); i < N; i++) s2.add(wisp(s2, R, { x, y, z: head, ox: x, oy: y, spiral: true, ph: (i / N) * TAU, rr: 0.05, grow: s2.rand(1.1, 1.8) * rs, spin: (i % 2 ? 1 : -1) * s2.rand(3, 4.5), rise: s2.rand(0.3, 0.7), life: s2.rand(0.7, 1.1), len: 10, minor: i > 2 }));
      else for (let i = 0, N = Math.round(8 * B.k); i < N; i++) s2.add({ k: "mote", x: x + s2.rand(-1, 1) * rs, y: y + s2.rand(-0.7, 0.7) * rs, z: head + s2.rand(-0.3, 0.3), vz: s2.rand(0.3, 0.8), drag: 1.5, life: s2.rand(0.6, 1.1), R, plus: i % 3 === 0, minor: i > 2 });
    });
    // dazed: stars round the head once the spike has gone in
    if (!B.saved || k === MENTAL) s.at(B.b + 0.22, (s2) => {
      const n = B.saved ? 3 : B.crit ? 6 : 5;
      for (let i = 0; i < n; i++) s2.add({ k: k === ILLUSION ? "psyPrism" : "mote", x, y, z: head + 0.3, life: B.saved ? 0.8 : 1.3, R, plus: true, hue: i, big: i === 0, update: orbit(x, y, head + 0.28 * sz, 0.3 * sz + rs * 0.25, (i / n) * TAU, 5) });
    });
    if (!B.saved) s.at(B.b + 0.1, (s2) => stain(s2, M, x, y, 1, rs * 0.7, kindOf(M)));
  },

  auraStart(s, M, T) {
    if (kindOf(M) === MENTAL) s.add({ k: "psyCrown", x: T.x, y: T.y - 0.3 * T.size, z: 1.12 * T.h, r: 6 * Math.sqrt(T.size), life: 1e9, R: M.R, update: still });
  },

  aura(s, M, { at, T }) {
    const k = kindOf(M);
    if (k === MENTAL) {
      at(1.4, () => ({ k: "psyRing", x: T.x, y: T.y, z: s.rand(0.3, 0.8) * T.h, r0: 3, r1: 0.75 * T.size * s.spec.aps, life: 0.65, thin: true, update: still }));
      at(5, () => ({ k: "mote", vz: s.rand(0.2, 0.5), drag: 1.5, life: s.rand(0.6, 0.9), plus: s.R() < 0.3, minor: true }));
    } else if (k === ILLUSION) {
      at(7, () => ({ k: "psyPrism", life: s.rand(0.6, 1), hue: Math.floor(s.R() * 6), fake: true, update: still }));
      at(1.6, () => ({ k: "psyShard", vz: s.rand(0.3, 0.6), g: -0.1, drag: 1.5, life: 0.7, L: 3, seed: s.R(), update: shardMove }));
    } else {
      at(2.4, () => ({ k: "psySoul", z: 0, h: s.rand(7, 12), w: 2.2, life: s.rand(0.7, 1), seed: s.R() * 10, update: still }), false);
      at(3, () => wisp(s, M.R, { vz: s.rand(0.4, 0.8), vx: s.rand(-0.3, 0.3), drag: 1, life: s.rand(0.7, 1.1), len: 9 }));
    }
  },
};
