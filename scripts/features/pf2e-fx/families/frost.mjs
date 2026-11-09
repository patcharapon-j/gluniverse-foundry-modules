/**
 * Frost: cold.
 *
 * Benchmarked against pixelfx `ice/frost-nova` and `ice/ice-shatter`
 * (spellsprite-craft §5): a white flash and a six-armed snowflake at the core,
 * a front of mist rolling out along the floor, 20+ ice shards that tumble,
 * bounce and skid in a puff of ice dust, flakes drifting down, a frost sheet
 * with crack ferns, and three rings of crystals that punch up in a wave from
 * the centre outward, glint while they hold, then melt back into the floor.
 * Shapes are prefixed `fr`.
 */

import { TAU, clamp, hash } from "../core/rand.mjs";
import { S, WHITE } from "../core/palette.mjs";
import { physics } from "../core/sim.mjs";
import { registerShapes } from "../core/shapes.mjs";
import { sd, still, releaseFlash, counter, flourish } from "../core/motifs.mjs";
import { flat, land, kick, subFlash } from "./flame.mjs";

/** A shard spins while it flies, skids when it lands. */
function shardUpd(p, s, dt) { physics(p, dt, s); if (!p.rest) p.a += p.va * dt; }
export const shard = (s, R, x, y, z, sp, extra) => ({ k: "frShard", x, y, z, ...flat(s, sp, 0.8), g: 25, drag: 0.6, bounce: 0.3, life: s.rand(0.9, 1.6), R, a: s.rand(0, TAU), va: s.rand(-20, 20), L: 2 + Math.floor(s.R() * 3), kick: R, onGround: land, update: shardUpd, ...extra });

/** A mist puff: pale, translucent, lit on top. */
// a step down the ramp and thinner than it was: twenty pale puffs stacked into an opaque lid over the targets
const mist = (s, R, extra) => ({ k: "flHaze", R, tone: 0.6, toneEnd: 0.45, a: 0.34, grow: 0.8, seed: sd(s), ...extra });

/** Three rings of crystals: tall near the centre, short at the rim (frost-nova's RINGS, read top-down). */
const RINGS = [{ q: [0.12, 0.26], h: [20, 28], w: [3.5, 5], n: 4 }, { q: [0.34, 0.55], h: [12, 18], w: [2.5, 3.5], n: 6 }, { q: [0.6, 0.92], h: [6, 11], w: [2, 2.8], n: 9 }];

function crystals(s, R, x, y, reach, scale, mm, life, start) {
  RINGS.forEach((ring, ri) => {
    const N = Math.max(1, Math.round(ring.n * scale));
    for (let i = 0; i < N; i++) {
      const a = ((i + s.rand(0.15, 0.85)) / N) * TAU + ri * 0.4, q = s.rand(...ring.q), d = q * reach;
      const h = s.rand(...ring.h) * Math.min(1.4, mm), w = s.rand(...ring.w), wait = start + q * 0.32 + s.rand(0, 0.03);
      const cx = x + Math.cos(a) * d, cy = y + Math.sin(a) * d, lean = Math.cos(a) * h * s.rand(0.1, 0.25);
      s.add({ k: "crystal", x: cx, y: cy, z: 0, h, w, lean, life, R, wait, debris: true, minor: ri === 2 && i % 2 === 1, update: still });
      // a child crystal leaning off the big ones
      if (ri < 2) s.add({ k: "crystal", x: cx + Math.cos(a + 1.6) * 0.12, y: cy + Math.sin(a + 1.6) * 0.12, z: 0, h: h * s.rand(0.4, 0.6), w: w * 0.65, lean: -lean * 1.5 + s.rand(-2, 2), life: life - 0.1, R, wait: wait + 0.03, debris: true, minor: true, update: still });
      // glints walking up the faces while they hold
      if (ri < 2 || i % 2 === 0) s.add({ k: "glint", x: cx, y: cy, z: h / 26 * 0.55, life: 5 / 12, R, wait: wait + s.rand(0.25, life * 0.6), minor: true, update: still });
      // ice dust where it breaks the floor
      if (ri === 0) s.add(mist(s, R, { x: cx, y: cy, z: 0.03, ...flat(s, s.rand(0.5, 1.2), 0.2), drag: 3, r: s.rand(2.5, 4), life: s.rand(0.5, 0.9), wait, minor: true }));
    }
  });
}

export default {
  id: "frost",
  burst(s, M, { x, y, z, pow, rad, sub }) {
    const R = M.R, m = s.m * pow, mm = Math.min(1.7, m), n = counter(s, pow, rad), crit = pow > 1.2;
    if (sub) subFlash(s, M, x, y, z, pow, rad); else releaseFlash(s, M, x, y, z, pow, rad);
    const zz = Math.max(0.2, z);
    if (sub) {
      for (let i = 0, N = n(4); i < N; i++) s.add(shard(s, R, x, y, zz, s.rand(3, 7), { minor: i % 2 === 1 }));
      for (let i = 0, N = n(3); i < N; i++) s.add({ k: "flake", x: x + s.rand(-0.4, 0.4), y: y + s.rand(-0.4, 0.4), z: zz + s.rand(0, 0.6), vx: s.rand(-0.4, 0.4), g: 0.4, drag: 2.5, life: s.rand(1, 1.8), R, big: s.R() < 0.4, minor: true });
      if (s.R() < 0.5) s.add(mist(s, R, { x, y, z: 0.05, ...flat(s, 0.6, 0.3), drag: 2, r: s.rand(4, 6), life: s.rand(0.7, 1.1), minor: true }));
      // a cluster of crystals punching up: across an area they make the nova's field
      for (let i = 0, N = 2 + (s.R() < 0.5 ? 1 : 0); i < N; i++) {
        const a = s.rand(0, TAU), d = i ? s.rand(0.12, 0.3) : s.rand(0, 0.1), h = s.rand(13, 24) * Math.min(1.4, mm) * (i ? 0.6 : 1);
        s.add({ k: "crystal", x: x + Math.cos(a) * d, y: y + Math.sin(a) * d, z: 0, h, w: s.rand(2.6, 4) * (i ? 0.7 : 1), lean: Math.cos(a) * h * s.rand(0.1, 0.3), life: s.rand(1.8, 2.4), R, wait: 0.03 + i * 0.03, debris: true, minor: i === 2, update: still });
      }
      s.add({ k: "glint", x, y, z: 0.3, life: 5 / 12, R, wait: s.rand(0.3, 1.2), minor: true, update: still });
      return;
    }
    // the core: a six-armed snowflake spinning out of the flash
    s.add({ k: "frSnow", x, y, z: zz, L: (7 + rad * 6) * Math.min(1.4, mm) * (crit ? 1.25 : 1), life: 0.55, R, spin: s.R() < 0.5 ? 1 : -1, glow: true, r: 4, update: still });
    // the front: mist rolling out along the floor, flakes kicked up on it
    for (let i = 0, N = Math.min(10, n(5)); i < N; i++) {
      const a = (i / N) * TAU + s.rand(-0.2, 0.2), sp = s.rand(2.5, 5.5) * Math.min(1.3, pow);
      s.add(mist(s, R, { x: x + Math.cos(a) * rad * 0.3, y: y + Math.sin(a) * rad * 0.3, z: 0.05, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vz: 0.15, drag: 3, r: s.rand(4.5, 7.5) * Math.min(1.3, mm), life: s.rand(0.8, 1.4), wait: s.rand(0, 0.05), minor: i % 2 === 1 }));
    }
    // a hanging cloud over the core that thins slowly
    for (let i = 0, N = Math.min(3, n(2)); i < N; i++) s.add(mist(s, R, { x: x + s.rand(-0.3, 0.3) * rad, y: y + s.rand(-0.3, 0.3) * rad, z: zz + s.rand(0, 0.3), vx: s.rand(-0.4, 0.4), vy: s.rand(-0.3, 0.1), vz: 0.15, g: -0.05, drag: 1.5, r: s.rand(6, 9) * Math.min(1.3, mm), life: s.rand(1.6, 2.4), tone: 0.6, toneEnd: 0.33, a: 0.3, wait: s.rand(0.05, 0.2) }));
    // shards flung, tumbling, bouncing and skidding
    for (let i = 0, N = n(14); i < N; i++) s.add(shard(s, R, x, y, zz, s.rand(4, 10) * Math.min(1.3, pow), { L: 2 + Math.floor(s.R() * 4), minor: i % 2 === 1 }));
    // sparkling ice spray: short bright streaks
    for (let i = 0, N = n(20); i < N; i++) s.add({ k: "spark", x, y, z: zz, ...flat(s, s.rand(4, 10), 0.8), g: 12, drag: 2.4, bounce: 0.4, life: s.rand(0.2, 0.5), R, minor: i % 3 !== 0 });
    // flakes drifting down for seconds
    for (let i = 0, N = n(12); i < N; i++) s.add({ k: "flake", x: x + s.rand(-1, 1) * (rad + 0.4), y: y + s.rand(-1, 1) * (rad + 0.4), z: zz + s.rand(0.3, 1.4), vx: s.rand(-0.4, 0.4), vy: s.rand(-0.2, 0.2), vz: s.rand(-0.1, 0.3), g: 0.3, drag: 2.5, life: s.rand(1.6, 3), R, big: s.R() < 0.3, minor: i % 2 === 0 });
    s.add({ k: "flBand", x, y, r: rad * 1.7 + 1.6 * Math.min(1.3, mm), life: 0.55, R, dust: R, th: 3 + rad * 2, update: still });
    if (pow >= 0.5) {
      const reach = rad * 1.4 + 0.9 * Math.min(1.3, mm);
      s.add({ k: "frost", x, y, r: reach * 0.95, life: 4.5, R, seed: sd(s), debris: true, update: still });
      crystals(s, R, x, y, reach, Math.min(1.4, (0.6 + rad * 0.4) * pow), mm, s.rand(2.3, 2.8), 0.02);
      s.light(x, y, 0.2, reach + 0.8, S(R, 0.83), 0.35 * Math.min(1.3, mm), 2.6);
    }
    flourish(s, M, x, y, z, rad, Math.round(6 * m));
  },
  trail(s, M, { x, y, z, dt, scale = 1 }) {
    const R = M.R, k = Math.max(1, scale), q = Math.sqrt(k), j = () => s.rand(-0.08, 0.08) * k;
    for (let i = s.count(26 * s.m * q, dt); i > 0; i--) s.add(mist(s, R, { x: x + j(), y: y + j(), z: z + j(), vz: 0.1, drag: 2, r: s.rand(2.2, 3.6) * q, life: s.rand(0.5, 0.8), minor: i % 2 === 0 }));
    for (let i = s.count(36 * s.m * k, dt); i > 0; i--) s.add({ k: "flake", x: x + j(), y: y + j(), z, vx: s.rand(-0.5, 0.5), vy: s.rand(-0.5, 0.5), g: 0.5, drag: 2, life: s.rand(0.6, 1.1), R, big: s.R() < 0.2, minor: true });
    for (let i = s.count(8 * s.m, dt); i > 0; i--) s.add({ k: "glint", x: x + j(), y: y + j(), z: z + j(), life: 5 / 12, R, minor: true, update: still });
    for (let i = s.count(6 * s.m, dt); i > 0; i--) s.add(shard(s, R, x, y, z, s.rand(0.8, 2), { life: s.rand(0.4, 0.7), minor: true }));
  },
  linger(s, M, { at }) {
    const R = M.R;
    at(12, () => ({ k: "flake", z: s.rand(0.9, 1.8), vx: s.rand(-0.25, 0.25), g: 0.4, drag: 2, life: s.rand(1.1, 1.8), big: s.R() < 0.25, minor: true }));
    at(1.6, () => ({ k: "crystal", z: 0, h: s.rand(6, 12), w: s.rand(2, 3), lean: s.rand(-2, 2), life: s.rand(1.6, 2.2), debris: true, update: still }));
    at(2.4, () => mist(s, R, { z: 0.05, vx: s.rand(-0.3, 0.3), vy: s.rand(-0.2, 0.1), drag: 1.5, r: s.rand(4, 6.5), life: s.rand(1.2, 1.8), a: 0.45 }));
    at(3, () => ({ k: "glint", z: s.rand(0.05, 0.4), life: 5 / 12, minor: true, update: still }));
  },
  spray(s, M, { emit, hand, dir, half, len, dt }) {
    const R = M.R;
    // frost breath: a pale stream of vapour, swelling as it goes, full of flakes and shards
    emit("flHaze", 46, () => ({ drag: 1.8, g: -0.05, life: s.rand(0.6, 0.95), r: s.rand(3.5, 6), tone: 0.83, toneEnd: 0.67, a: 0.55, grow: 1.2, seed: sd(s) }));
    emit("flake", 60, () => ({ drag: 1.3, g: 0.3, life: s.rand(0.8, 1.2), big: s.R() < 0.3, minor: true }));
    emit("frShard", 26, () => ({ drag: 1.4, g: 4, bounce: 0.3, life: s.rand(0.6, 0.9), a: s.rand(0, TAU), va: s.rand(-20, 20), L: 2 + Math.floor(s.R() * 3), onGround: land, kick: R, update: shardUpd }));
    emit("spark", 22, () => ({ drag: 1.8, g: 3, life: s.rand(0.3, 0.5), minor: true }));
    if (s.R() < 6 * dt) { const f = s.rand(0.2, 0.9), q = dir + s.rand(-half, half) * 0.6; s.light(hand[0] + Math.cos(q) * len * f, hand[1] + Math.sin(q) * len * f, 0.3, 0.9 + len * f * 0.3, S(R, 0.83), 0.35, 0.4); }
  },
  /**
   * The crystal snap (spellsprite-craft §5 ice/ice-shatter, ice/freeze): cold
   * pulls in as frost creeps out over the floor, then ice blades snap out of
   * the body in a six-pointed star and a cage of crystals spears up round its
   * feet; a beat later it all cracks and shatters, shards tumbling and
   * skidding away, flakes and mist hanging where it stood.
   */
  bloom(s, M, B) {
    const R = M.R, aps = s.spec.aps, { x, y, z, r, sz } = B, rs = r / aps, snap = B.saved ? 0.22 : 0.34;
    s.at(B.at, (s2) => {
      s2.add({ k: "frost", x, y, r: rs * 0.7 + 0.15, life: 3.2, R, seed: sd(s2), debris: true, update: still });
      for (let i = 0; i < 10; i++) { const q = (i / 10) * TAU + s2.rand(-0.2, 0.2), d = rs * 1.5 + 0.3, life = 0.17; s2.add({ k: "flake", x: x + Math.cos(q) * d, y: y + Math.sin(q) * d * 0.7, z: z + s2.rand(-0.3, 0.4), vx: -Math.cos(q) * d / life, vy: -Math.sin(q) * d * 0.7 / life, life, R, big: i % 3 === 0, minor: i % 2 === 1, update(p, _s, dt) { p.x += p.vx * dt; p.y += p.vy * dt; } }); }
      s2.light(x, y, 0.1, rs * 1.5 + 0.5, S(R, 0.83), 0.45, 0.2, { swell: true });
    });
    const cage = [];
    s.at(B.b, (s2) => {
      s2.add({ k: "frSnap", x, y, z, r: r * 1.25, n: 6, snap, hero: B.crit, life: snap + 0.4, R, seed: sd(s2), update: still });
      s2.light(x, y, 0.1, rs * 2.2 + 0.7, S(R, 0.9), 0.45 * B.k, 0.5);
      s2.light(x, y, 0.1, rs * 1.6 + 0.5, S(R, 0.83), 0.25, 2.2);
      if (B.crit) s2.crit();
      // the cage: crystals spearing up round the feet, tall near the body
      for (let i = 0, N = B.saved ? 4 : Math.round(7 * B.k); i < N; i++) {
        const q = (i / N) * TAU + s2.rand(-0.25, 0.25), d = rs * s2.rand(0.42, 0.62), h = s2.rand(14, 22) * Math.min(1.4, B.k) * sz;
        const cx = x + Math.cos(q) * d, cy = y + Math.sin(q) * d * 0.85;
        cage.push([cx, cy, h]);
        s2.add({ k: "crystal", x: cx, y: cy, z: 0, h, w: s2.rand(2.6, 3.8), lean: Math.cos(q) * h * s2.rand(0.15, 0.3), life: snap + 0.05, R, wait: i * 0.012, minor: i > 4, update: still });
      }
      for (let i = 0, N = Math.round(10 * B.k); i < N; i++) s2.add({ k: "spark", x, y, z, ...flat(s2, s2.rand(4, 9), 0.8), g: 12, drag: 2.4, bounce: 0.4, life: s2.rand(0.2, 0.45), R, minor: i > 3 });
    });
    // the snap: the cage and the star break, everything thrown out
    s.at(B.b + snap, (s2) => {
      for (const [cx, cy, h] of cage) for (let j = 0; j < 3; j++) s2.add(shard(s2, R, cx, cy, (h / aps) * 0.4 * (j + 1) / 3, s2.rand(2, 5) * B.k, { L: 2 + j, minor: j > 0 }));
      for (let i = 0, N = Math.round(12 * B.k); i < N; i++) s2.add(shard(s2, R, x, y, z, s2.rand(4, 9) * B.k, { L: 2 + Math.floor(s2.R() * 4), minor: i > 5 }));
      for (let i = 0, N = Math.round(9 * B.k); i < N; i++) s2.add({ k: "flake", x: x + s2.rand(-1, 1) * rs, y: y + s2.rand(-0.8, 0.8) * rs, z: z + s2.rand(0, 0.8), vx: s2.rand(-0.4, 0.4), g: 0.4, drag: 2.5, life: s2.rand(1, 1.8), R, big: i % 3 === 0, minor: i > 3 });
      for (let i = 0; i < (B.saved ? 1 : 3); i++) s2.add(mist(s2, R, { x: x + s2.rand(-0.3, 0.3) * sz, y: y + s2.rand(-0.2, 0.2) * sz, z: 0.1, ...flat(s2, s2.rand(0.6, 1.4), 0.3), drag: 2.5, r: s2.rand(5, 7) * sz, life: s2.rand(0.9, 1.3), minor: i > 0 }));
      for (let i = 0; i < 3; i++) s2.add({ k: "glint", x: x + s2.rand(-0.6, 0.6) * rs, y: y + s2.rand(-0.5, 0.5) * rs, z: z + s2.rand(-0.2, 0.5), life: 5 / 12, R, big: i === 0, wait: i * 0.06, update: still });
      s2.add({ k: "ring", x, y, r: rs * 1.6 + 0.4, life: 0.4, R, broken: true, seed: sd(s2), update: still });
      s2.light(x, y, z, rs + 0.5, S(R, 1), 0.4, 0.15);
    });
  },
  auraStart(s, M, T) {
    s.add({ k: "frost", x: T.x, y: T.y, r: 0.6 * T.size, life: 1e9, R: M.R, seed: 3, update: still });
  },
  aura(s, M, { at, T, dt }) {
    const R = M.R;
    at(9, () => ({ k: "flake", z: s.rand(1, 1.5), vx: s.rand(-0.2, 0.2), g: 0.4, drag: 2, life: 1.5, big: s.R() < 0.25 }));
    at(1.8, () => ({ k: "crystal", h: s.rand(5, 9), w: 2, lean: s.rand(-1.5, 1.5), life: 1.7, update: still }), false);
    at(1.4, () => mist(s, R, { vz: 0.15, drag: 1.5, r: s.rand(3, 4.5), life: s.rand(1, 1.4), a: 0.45, minor: true }));
    at(2, () => ({ k: "glint", life: 5 / 12, minor: true, update: still }));
  },
  tick(s, M, T) {
    for (let i = 0; i < 6; i++) s.add(shard(s, M.R, T.x, T.y, 0.6 * T.h, s.rand(2, 4.5), { minor: i % 2 === 1 }));
  },
};

registerShapes({
  /**
   * The crystal snap, on the body (deliveries.mjs bloom): blades of ice
   * snapping out of a hollow middle, each a long diamond with a lit face and a
   * shaded one, a bright spine and a white tip on the hero frame. At `snap`
   * a crack runs through them and they break: each blade splits in two and
   * the halves slide outward as they fade.
   */
  frSnap(v, P, p) {
    const t = p.age, fr = Math.floor(t * 12), [x, y] = v.ap(p.x, p.y, p.z), sq = v.kind === "top" ? 0.85 : 0.55, R = p.R;
    const broke = t >= p.snap, bu = broke ? clamp((t - p.snap) / (p.life - p.snap)) : 0, a = broke ? 1 - bu : 1;
    const grow = Math.min(1, (fr + 1) / 2), r0 = Math.max(5, p.r * 0.26);
    for (let k = 0; k < p.n; k++) {
      const q = (k / p.n) * TAU + 0.26 + (p.seed % 7) * 0.05, long = k % 2 === 0, L = p.r * grow * (long ? 1 : 0.72) * (0.9 + 0.2 * hash(k, p.seed));
      const c = Math.cos(q), sn = Math.sin(q), W = (long ? 3.4 : 2.6) * Math.min(1.3, p.r / 22), n = Math.ceil(L - r0);
      for (let j = 0; j <= n; j++) {
        const f = j / Math.max(1, n), half = f < 0.5 ? 0 : 1;
        if (broke && f > 0.46 && f < 0.56) continue;
        const slide = broke ? bu * p.r * 0.5 * (half ? 1.3 : 0.6) : 0, d = r0 + j + slide, drop = broke ? bu * bu * 6 * (half + 0.5) : 0;
        const w = W * (f < 0.3 ? f / 0.3 : 1 - (f - 0.3) / 0.7) + 0.4, cx = x + c * d, cy = y + sn * d * sq + drop;
        for (let i = Math.floor(-w); i <= Math.ceil(w); i++) {
          const e = Math.abs(i) / Math.max(0.6, w); if (e > 1) continue;
          const col = e < 0.3 ? (p.hero && fr < 2 && f > 0.8 ? WHITE : S(R, 1)) : i < 0 ? S(R, 0.83) : S(R, 0.5);
          P.dot(cx - sn * i, cy + c * i * sq, col, a, 1);
        }
      }
    }
    // the crack: a bright jagged line across the star the frame it breaks
    if (broke && bu < 0.25) {
      let px = x - p.r * 0.9, py = y;
      for (let k = 1; k <= 6; k++) { const nx = x - p.r * 0.9 + (p.r * 1.8 * k) / 6, ny = y + (hash(k, p.seed) - 0.5) * 6; P.line(px, py, nx, ny, S(R, 1), 2, 1); px = nx; py = ny; }
    }
  },
  /** A tumbling sliver of ice: a bright edge, a cold body, a dark tail; turns on the 12 fps clock. */
  frShard(v, P, p) {
    const [x, y] = v.ap(p.x, p.y, p.z), a = Math.round((p.a ?? 0) / (TAU / 8)) * (TAU / 8), L = p.L ?? 3, fade = clamp((p.life - p.age) / 0.4);
    const dx = Math.cos(a) * L * 0.5, dy = Math.sin(a) * L * 0.5;
    P.line(x - dx, y - dy, x + dx, y + dy, null, 1, fade, (f) => S(p.R, f > 0.7 ? 1 : f > 0.3 ? 0.83 : 0.5));
    if (L > 3) P.dot(x - dy * 0.4, y + dx * 0.4, S(p.R, 0.67), fade, 1);
  },
  /** A six-armed snowflake spinning out of the flash, branches on the long arms; white at its centre while young. */
  frSnow(v, P, p) {
    const u = clamp(p.age / p.life), fr = Math.floor(p.age * 12), [x, y] = v.ap(p.x, p.y, p.z);
    const L = p.L * (u < 0.3 ? 0.4 + u * 2 : 1 - (u - 0.3) * 0.6), spin = fr * 0.18 * (p.spin ?? 1), a = 1 - Math.max(0, (u - 0.6) / 0.4);
    if (L < 1) return;
    for (let i = 0; i < 6; i++) {
      const q = spin + (i * TAU) / 6, c = Math.cos(q), sn = Math.sin(q);
      P.line(x, y, x + c * L, y + sn * L, null, 2, a, (f) => (f < 0.35 && fr < 2 ? WHITE : S(p.R, f < 0.7 ? 1 : 0.83)));
      if (L > 4) for (const sg of [-1, 1]) {
        const bx = x + c * L * 0.6, by = y + sn * L * 0.6, ba = q + sg * 0.9;
        P.line(bx, by, bx + Math.cos(ba) * L * 0.32, by + Math.sin(ba) * L * 0.32, S(p.R, 0.83), 1, a);
      }
    }
    if (fr < 2) P.px(x, y, WHITE, 2);
  },
});
