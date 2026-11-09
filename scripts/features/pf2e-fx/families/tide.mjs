/**
 * Tide: water.
 *
 * A splash crown that rises and throws its tips, droplets in arcs that land
 * as ripples, a wet sheen left on the floor, a curling crest that rolls down a
 * cone or a line, bubbles rising round a soaked creature, and a projectile
 * that spins a double ribbon of water behind it.
 */

import { TAU, clamp, easeOut, hash, pnoise, fadeOut } from "../core/rand.mjs";
import { S } from "../core/palette.mjs";
import { registerShapes, snapH } from "../core/shapes.mjs";
import { sd, still, releaseFlash, counter, flourish } from "../core/motifs.mjs";
import { dustRing, dustLobes } from "./physical.mjs";

/** A drop that lands: a ripple, a two-frame splash, and now and then a wet spot. */
function wet(p, s) {
  p.life = 0;
  s.add({ k: "ripple", x: p.x, y: p.y, r: s.rand(0.16, 0.28) * (p.big ? 1.4 : 1), n: 1, life: 0.55, R: p.R, debris: true, minor: p.minor, update: still });
  s.add({ k: "splash", x: p.x, y: p.y, z: 0, life: 3 / 12, R: p.R, minor: p.minor, update: still });
  if (!p.minor && s.R() < 0.4) s.add({ k: "sheen", x: p.x, y: p.y, r: s.rand(0.06, 0.1), life: s.rand(1.6, 2.6), R: p.R, seed: sd(s), small: true, debris: true, update: still });
}

/**
 * The direction a trail's head is moving: each call is matched to the nearest
 * head seen on an earlier step, so several projectiles in one sim keep apart.
 */
function heading(s, x, y, z) {
  const list = (s.tideHeads ??= []);
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

/** The crest rolls out from the hand, widening with the cone, throwing foam off its lip. */
function rollCrest(p, s, dt) {
  const u = clamp(p.age / (p.life * 0.8));
  p.d = 0.6 + easeOut(u) * (p.len - 0.6);
  p.x = p.ox + Math.cos(p.dir) * p.d; p.y = p.oy + Math.sin(p.dir) * p.d;
  p.hw = Math.max(0.45, Math.tan(p.half) * p.d * 0.95);
  const c = Math.cos(p.dir), sn = Math.sin(p.dir);
  for (let i = s.count(45, dt); i > 0; i--) {
    const f = s.rand(-1, 1) * p.hw;
    s.add({ k: "droplet", x: p.x - sn * f, y: p.y + c * f, z: 0.4, vx: c * s.rand(1, 2.5), vy: sn * s.rand(1, 2.5), vz: s.rand(1, 2.4), g: 8, drag: 0.8, life: 2, R: p.R, onGround: wet, minor: s.R() < 0.4 });
  }
}

/** Mist rolling out low over the water: translucent, pale, gone in a second. */
const mist = (s, R, x, y, N, o = {}) => dustRing(s, R, x, y, N, { sp: [0.9, 2], r: [6, 10], life: [0.8, 1.3], tone: 0.83, a0: 0.32, wait: [0.04, 0.12], keep: 1, ...o });

/** Foam: white flecks flung off the crown that fall fast and vanish. */
function foam(s, R, x, y, z, N, sp = [1.5, 4.5]) {
  for (let i = 0; i < N; i++) {
    const q = s.rand(0, TAU), v = s.rand(sp[0], sp[1]);
    s.add({ k: "flake", x: x + Math.cos(q) * 0.15, y: y + Math.sin(q) * 0.15, z: z + s.rand(0.1, 0.5), vx: Math.cos(q) * v, vy: Math.sin(q) * v, vz: s.rand(1, 3.5), g: 12, drag: 1.6, life: s.rand(0.4, 0.8), R, big: s.R() < 0.2, minor: i >= 3 });
  }
}

export default {
  id: "tide",
  burst(s, M, { x, y, z, pow, rad, sub }) {
    const R = M.R, m = s.m * pow, mm = Math.min(1.6, m), n0 = counter(s, pow, rad), n = sub ? (k) => Math.ceil(n0(k) / 2.5) : n0;
    releaseFlash(s, M, x, y, z, pow, rad, sub ? { flash: 0.6, light: 0.22 } : undefined);
    // an area eruption is one splash each, varied in size, over a pool that only sometimes lies down
    const cr = (rad * 0.62 + 0.3) * Math.min(1.3, mm) * (sub ? s.rand(0.7, 1) : 1), ch = 20 * mm * (sub ? s.rand(0.6, 0.9) : 1), cz = z > 0.3 && !sub ? z * 0.5 : 0;
    if (s.take === 1 && rad > 0.6 && !sub) for (let i = 0; i < 3; i++) {
      const q = (i / 3) * TAU + 0.5;
      s.add({ k: "crown", x: x + Math.cos(q) * rad * 0.6, y: y + Math.sin(q) * rad * 0.6, z: 0, r: cr * 0.6, h: ch * 0.75, n: 10, life: 7 / 12, R, seed: sd(s), wait: 0.06 + i * 0.06, update: still });
    }
    // the crown, and a second smaller ring of it thrown up inside as the first falls
    s.add({ k: "crown", x, y, z: cz, r: cr, h: ch, n: sub ? 10 : 16, life: 7 / 12, R, seed: sd(s), update: still });
    if (!sub) s.add({ k: "crown", x, y, z: cz, r: cr * 0.45, h: ch * 1.25, n: 8, life: 7 / 12, R, seed: sd(s), wait: 0.2, update: still });
    // the shock of the water hitting: a ring thrown across the floor
    if (!sub) s.add({ k: "ring", x, y, r: Math.min(rad * 2.2 + 1, rad * 1.1 + 1.5) * Math.min(1.3, mm), life: 0.5, R, seed: sd(s), update: still });
    if (s.take === 2 && !sub) for (let i = 0; i < n(18); i++) {
      // a geyser: a column thrown straight up that rains back down
      s.add({ k: "droplet", x: x + s.rand(-0.1, 0.1), y: y + s.rand(-0.05, 0.05), z: cz, vx: s.rand(-0.8, 0.8), vy: s.rand(-0.5, 0.5), vz: s.rand(5, 9) * Math.min(1.3, mm), g: 11, drag: 0.3, life: 3, R, big: true, onGround: wet, wait: s.rand(0, 0.15), minor: i >= 6 });
    }
    // droplets in arcs: they land as rings and plinks across a couple of squares
    for (let i = 0, N = n(32); i < N; i++) {
      const q = s.rand(0, TAU), v = s.rand(1.6, 5.5);
      s.add({ k: "droplet", x, y, z: cz + 0.1, vx: Math.cos(q) * v, vy: Math.sin(q) * v, vz: s.rand(2.5, 5.5), g: 13, drag: 0.5, life: 3, R, big: s.R() < 0.35, onGround: wet, minor: i >= (sub ? 3 : 10) });
    }
    foam(s, R, x, y, cz, n(18));
    mist(s, R, x, y, sub ? Math.min(2, n(4)) : n(7), { r0: rad * 0.5 });
    for (let i = 0, N = sub ? 0 : n(4); i < N; i++) s.add({ k: "glint", x: x + s.rand(-1, 1) * (rad + 0.4), y: y + s.rand(-1, 1) * (rad + 0.4) * 0.7, z: s.rand(0.05, 0.7), life: 5 / 12, R, wait: s.rand(0.1, 0.6), minor: i >= 1, update: still });
    if (sub) {
      if (s.R() < 0.35) s.add({ k: "sheen", x, y, r: rad * 0.9 + 0.2, life: 5, R, seed: sd(s), debris: true, update: still });
      s.add({ k: "ripple", x, y, r: rad * 1.6 + 0.3, n: 2, life: 1, R, update: still });
    } else if (pow >= 0.5) {
      s.add({ k: "sheen", x, y, r: rad * 1.4 + 0.35, life: 5, R, seed: sd(s), debris: true, update: still });
      for (let i = 0; i < 3; i++) s.add({ k: "ripple", x, y, r: Math.min(rad * 2 + 0.8, rad * 1.1 + 1.3) * (1 - i * 0.15), n: 2, life: 1.3, R, wait: i * 0.28, update: still });
    }
    flourish(s, M, x, y, z, rad, Math.round(5 * m));
  },
  trail(s, M, { x, y, z, dt }) {
    const R = M.R, dir = heading(s, x, y, z) ?? [1, 0, 0];
    let px = -dir[1], py = dir[0];
    const pl = Math.hypot(px, py) || 1; px /= pl; py /= pl;
    const ph = s.t * 26;
    for (let k = 0; k < 2; k++) {
      const a = ph + k * Math.PI, ox = Math.sin(a) * 0.18, oz = Math.cos(a) * 0.18;
      for (let i = s.count(120 * s.m, dt); i > 0; i--) s.add({ k: "droplet", x: x + px * ox, y: y + py * ox, z: z + oz, vx: -dir[0] * 0.5, vy: -dir[1] * 0.5, g: 1.2, drag: 3, life: s.rand(0.22, 0.34), R, tone: k ? 0.67 : 0.95, minor: k === 1 && i % 2 === 0 });
    }
    for (let i = s.count(16 * s.m, dt); i > 0; i--) s.add({ k: "droplet", x, y, z, vx: s.rand(-0.8, 0.8), vy: s.rand(-0.8, 0.8), vz: s.rand(-0.3, 0.8), g: 9, drag: 0.5, life: 3, R, onGround: wet, minor: s.R() < 0.5 });
    for (let i = s.count(10 * s.m, dt); i > 0; i--) s.add({ k: "phDust", x, y, z, vz: 0.1, drag: 2.5, r: s.rand(2.5, 4), life: s.rand(0.35, 0.5), R, tone: 0.83, a0: 0.35, minor: true });
  },
  linger(s, M, { at }) {
    at(4, () => ({ k: "ripple", n: 1, r: s.rand(0.18, 0.36), life: 0.8, update: still }));
    at(4, () => ({ k: "droplet", vz: s.rand(1.5, 2.6), vx: s.rand(-0.4, 0.4), g: 10, life: 2, onGround: wet, minor: true }));
    at(3, () => ({ k: "waterbubble", vz: 0.3, drag: 1, r: s.R() < 0.3 ? 2 : 1, life: s.rand(0.4, 0.8), seed: sd(s) }));
    at(0.5, () => ({ k: "crown", z: 0, r: s.rand(0.12, 0.2), h: s.rand(7, 11), n: 8, life: 7 / 12, seed: sd(s), update: still }));
  },
  spray(s, M, { emit, hand, dir, half, len }) {
    if (!s.tideCrest) {
      s.tideCrest = true;
      s.add({ k: "crest", ox: hand[0], oy: hand[1], x: hand[0], y: hand[1], dir, half, len, h: 22 * Math.min(1.4, s.m), life: 0.85, R: M.R, seed: sd(s), update: rollCrest });
    }
    emit("droplet", 90, () => ({ g: 8, drag: 1, life: 2, big: s.R() < 0.3, onGround: wet, minor: s.R() < 0.6 }));
    emit("flake", 40, () => ({ g: 6, drag: 1.6, life: s.rand(0.4, 0.7), big: s.R() < 0.2, minor: true }));
    emit("phDust", 14, () => ({ drag: 1.8, life: s.rand(0.6, 0.9), r: s.rand(4, 7), tone: 0.83, a0: 0.32, lobes: dustLobes(s), minor: s.R() < 0.5 }));
  },
  auraStart(s, M, T) {
    s.add({ k: "sheen", x: T.x + 0.05, y: T.y + 0.12, r: 0.4 * T.size, life: 1e9, R: M.R, seed: 4, update: still });
  },
  aura(s, M, { at }) {
    at(7, () => ({ k: "waterbubble", vz: s.rand(0.3, 0.6), g: -0.1, drag: 1.2, r: s.R() < 0.35 ? 2 : 1, life: s.rand(0.7, 1.1), seed: sd(s) }));
    at(4, () => ({ k: "droplet", g: 7, life: 2, onGround: wet }));
    at(1, () => ({ k: "ripple", n: 1, r: s.rand(0.3, 0.45), life: 0.9, update: still }), false);
  },
  tick(s, M, T) {
    s.add({ k: "crown", x: T.x, y: T.y, z: 0, r: 0.38 * T.size, h: 14, n: 12, life: 7 / 12, R: M.R, seed: sd(s), update: still });
    for (let i = 0; i < 10; i++) { const q = s.rand(0, TAU), v = s.rand(1, 2.5); s.add({ k: "droplet", x: T.x, y: T.y, z: 0.2, vx: Math.cos(q) * v, vy: Math.sin(q) * v, vz: s.rand(2, 3.5), g: 12, life: 2, R: M.R, onGround: wet, minor: i > 3 }); }
  },
};

/* ── shapes ───────────────────────────────────────────────────────────── */

const RINGS = {
  1: [[-1, 0], [1, 0], [0, -1], [0, 1]],
  2: [[-1, -2], [0, -2], [1, -2], [2, -1], [2, 0], [2, 1], [1, 2], [0, 2], [-1, 2], [-2, 1], [-2, 0], [-2, -1]],
  3: [[-1, -3], [0, -3], [1, -3], [2, -2], [3, -1], [3, 0], [3, 1], [2, 2], [1, 3], [0, 3], [-1, 3], [-2, 2], [-3, 1], [-3, 0], [-3, -1], [-2, -2]],
};

registerShapes({
  /** A splash crown: a rim and a ring of columns that rise, throw their tips, and fall. */
  crown(v, P, p) {
    const fr = Math.floor(p.age * 12);
    const prof = [0.5, 1, 1.15, 1, 0.75, 0.45, 0.2][fr], spread = [0.55, 0.8, 0.95, 1.05, 1.12, 1.18, 1.22][fr];
    if (prof == null) return;
    const [cx, cy] = v.ap(p.x, p.y, p.z ?? 0), r = p.r * v.aps * spread, sy = v.kind === "top" ? 1 : v.sq, top = v.kind === "top" ? 0.45 : 1, R = p.R, N = p.n ?? 10;
    // back half first, so the near columns stand in front
    const cols = [];
    for (let k = 0; k < N; k++) { const q = (k / N) * TAU + (p.seed % 7) * 0.3; cols.push([q, Math.sin(q)]); }
    cols.sort((a, b) => a[1] - b[1]);
    // the water thrown up: a sheet inside the rim while the crown stands
    if (fr < 4) {
      const ry = Math.max(1, r * sy);
      P.shade(cx - r, cy - ry, cx + r, cy + ry, (x, y) => { const dx = (x - cx) / r, dy = (y - cy) / ry; return dx * dx + dy * dy < 1 ? { c: S(R, dy < -0.3 ? 0.67 : 0.5), a: 0.75 - fr * 0.15 } : null; }, 0, "mix");
    }
    P.ellipse(cx, cy, r, Math.max(1, r * sy), (q) => ({ c: S(R, Math.sin(q) > 0 ? 0.5 : 0.83) }), 1);
    P.ellipse(cx, cy + 1, r, Math.max(1, r * sy), (q) => (Math.sin(q) > 0 ? { c: S(R, 0.33) } : null), 1);
    for (const [q] of cols) {
      const bx = cx + Math.cos(q) * r, by = cy + Math.sin(q) * r * sy, hh = p.h * prof * top * (0.7 + 0.5 * hash(Math.round(q * 10), p.seed)), lean = Math.cos(q) * 0.45;
      for (let j = 0; j < hh; j++) {
        const g = j / hh, t = j > hh - 2 ? 0.95 : Math.cos(q) < -0.2 ? 0.83 : 0.67;
        P.px(bx + lean * j, by - j, S(R, t), 1);
        if (g < 0.65) P.px(bx + lean * j + 1, by - j, S(R, 0.5), 1);
        if (g < 0.25) P.px(bx + lean * j - 1, by - j, S(R, 0.83), 1);
      }
      if (fr >= 2) {
        // the tip breaks off as a drop and arcs out
        const k = fr - 2, ty = by - hh - 2 - k * 2 + k * k * 1.2, tx = bx + lean * (hh + 2 + k * 2);
        P.px(tx, ty, S(R, 0.95), 1); P.px(tx + 1, ty, S(R, 0.67), 1); P.px(tx, ty + 1, S(R, 0.67), 1); P.px(tx + 1, ty + 1, S(R, 0.5), 1);
      }
    }
  },
  /** A drop: a lit head and a tail pointing back along its flight. */
  droplet(v, P, p) {
    const [x, y] = v.ap(p.x, p.y, p.z), [tx, ty] = v.ap(p.x - p.vx * 0.03, p.y - p.vy * 0.03, p.z - p.vz * 0.03), R = p.R;
    const dx = Math.round(Math.sign(tx - x) * (Math.abs(tx - x) > 0.4)), dy = Math.round(Math.sign(ty - y) * (Math.abs(ty - y) > 0.4));
    const head = S(R, p.tone ?? 0.95), body = S(R, 0.67), tail = S(R, 0.5);
    if (p.big) {
      P.px(x, y, head, 1); P.px(x + 1, y, body, 1); P.px(x, y + 1, body, 1); P.px(x + 1, y + 1, tail, 1);
      if (dx || dy) P.px(x + (dx > 0 ? 2 : dx), y + (dy > 0 ? 2 : dy), tail, 1);
      return;
    }
    P.px(x, y, head, 1);
    if (dx || dy) P.px(x + dx, y + dy, body, 1);
  },
  /** A rising bubble: a hollow ring with a highlight; it pops at the end. */
  waterbubble(v, P, p) {
    let [x, y] = v.ap(p.x, p.y, p.z); [x, y] = snapH(p, v, x, y);
    const u = p.age / p.life, fr = Math.floor(p.age * 12), r = Math.max(1, Math.min(3, Math.round(p.r ?? 1))), R = p.R;
    if (u > 0.88) { const d = r + 1; for (const [ox, oy] of [[-d, -d], [d, -d], [-d, d], [d, d]]) P.px(x + ox, y + oy, S(R, 0.83), 1); return; }
    const wob = r > 1 && (fr >> 1) % 2 ? 1 : 0;
    for (const [ox, oy] of RINGS[r]) P.px(x + ox + wob * (oy < 0 ? 1 : 0), y + oy, S(R, oy < 0 || ox < 0 ? 0.83 : 0.5), 1);
    if (r > 1) P.px(x - 1 + wob, y - 1, S(R, 1), 1);
  },
  /**
   * A rolling crest along an arc round the hand. From above it is a band of
   * deep water with a foam lip on its leading edge; from the side, a wall of
   * water whose lip curls forward.
   */
  crest(v, P, p) {
    const fr = Math.floor(p.age * 12), u = p.age / p.life, R = p.R, d = p.d ?? 0.6, hw = p.hw ?? 0.45;
    const span = Math.max(Math.min(p.half * 0.92, Math.atan2(hw, d)), Math.atan2(0.45, d)), top = v.kind === "top";
    const H = (u < 0.75 ? Math.min(1, 0.35 + u * 3) : 1 - (u - 0.75) / 0.25) * (top ? 1 : p.h);
    const at = (q, dd) => v.ap(p.ox + Math.cos(q) * dd, p.oy + Math.sin(q) * dd, 0);
    const A = at(p.dir - span, d), B = at(p.dir + span, d);
    const N = Math.max(3, Math.ceil(Math.hypot(B[0] - A[0], B[1] - A[1]) * 1.3));
    for (let i = 0; i <= N; i++) {
      const f = i / N, q = p.dir - span + 2 * span * f, e = Math.abs(2 * f - 1), wob = 0.8 + 0.35 * hash(i >> 1, fr >> 1, p.seed);
      const [bx, by] = at(q, d), [nx, ny] = at(q, d + 0.25);
      let fx = nx - bx, fy = ny - by; const fl = Math.hypot(fx, fy) || 1; fx /= fl; fy /= fl;
      if (top) {
        const T = Math.round((7 * Math.min(1.4, p.h / 15)) * H * (1 - e ** 3) * wob);
        for (let k = -T; k <= 0; k++) {
          const t = k === 0 ? 1 : k === -1 ? 0.83 : k > -4 ? 0.5 : 0.33;
          P.px(bx + fx * k, by + fy * k, S(R, t), 1);
        }
        if (T > 2 && hash(i, fr, p.seed) > 0.7) P.px(bx + fx * 2, by + fy * 2, S(R, 0.95), 1);
        continue;
      }
      const hc = H * (1 - e ** 3) * wob;
      if (hc < 1) continue;
      for (let j = 0; j < hc; j++) {
        const g = j / hc, curl = g > 0.6 ? (g - 0.6) * 7 : 0;
        const t = g > 0.86 ? 1 : g > 0.66 ? 0.83 : g < 0.25 ? 0.33 : 0.5;
        P.px(bx + fx * curl, by - j + fy * curl, S(R, t), 1);
      }
    }
  },
});

registerShapes({
  /** Rings spreading on the water: lit on the far side, shaded on the near. */
  ripple(v, P, p) {
    const u = clamp(p.age / p.life), [cx, cy] = v.ap(p.x, p.y, 0), R = p.R, n = p.n ?? 2;
    for (let k = 0; k < n; k++) {
      const uk = u - k * 0.28; if (uk <= 0 || uk >= 1) continue;
      const rx = p.r * v.aps * easeOut(uk); if (rx < 1) continue;
      P.ellipse(cx, cy, rx, Math.max(0.5, rx * v.sq), (q) => ({ c: S(R, Math.sin(q) > 0 ? 0.5 : 0.9), a: 1 - uk }));
    }
  },
  /** A wet sheen: a translucent pool with a bright rim and two highlight streaks that shimmer. */
  sheen(v, P, p) {
    const u = p.age / p.life, a = fadeOut(u, 0.55), fr = Math.floor(p.age * 12), g = Math.min(1, (fr + 1) / 3);
    const [cx, cy] = v.ap(p.x, p.y, 0), rx = Math.max(1.5, p.r * v.aps * g), ry = Math.max(1, rx * v.sq * 0.9), R = p.R, sh = (fr >> 2) % 2;
    P.shade(cx - rx - 1, cy - ry - 1, cx + rx + 1, cy + ry + 1, (x, y) => {
      const dx = (x - cx) / rx, dy = (y - cy) / ry, d = Math.hypot(dx, dy), e = 0.8 + pnoise(Math.atan2(dy, dx), 9, p.seed) * 0.3;
      if (d > e) return null;
      if (d > e - 1.2 / ry) return { c: S(R, 0.67), a: a * 0.75 };
      if (!p.small) {
        const row = Math.floor(y - cy);
        if ((row === Math.floor(-ry * 0.35) && dx > -0.55 + sh * 0.1 && dx < -0.05 + sh * 0.1) || (row === Math.floor(-ry * 0.05) && dx > -0.25 - sh * 0.1 && dx < 0.15 - sh * 0.1)) return { c: S(R, 0.95), a: a * 0.75 };
      }
      return { c: S(R, 0.33), a: a * 0.5 };
    }, 0, "mix");
  },
}, { flat: ["ripple", "sheen"] });
