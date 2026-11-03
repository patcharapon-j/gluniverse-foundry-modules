/**
 * Corrode: acid and poison.
 *
 * Acid: gobs that burst into drops, drops that splash and pool, fumes.
 * Poison: no gobs and no puddle. Sickly gas clouds billow out green on top and
 * violet underneath, toxic bubbles rise and pop inside them, and a swirling
 * miasma lies low on the floor.
 */

import { TAU, hash, pnoise, fadeOut } from "../core/rand.mjs";
import { S } from "../core/palette.mjs";
import { registerShapes, snapH } from "../core/shapes.mjs";
import { out, sd, lobes, still, splat, releaseFlash, counter, flourish } from "../core/motifs.mjs";

const isPoison = (M) => M.material === "poison";

/* ── acid (unchanged) ─────────────────────────────────────────────────── */

const acid = {
  burst(s, M, { x, y, z, pow, rad }) {
    const R = M.R, m = s.m * pow, n = counter(s, pow, rad);
    releaseFlash(s, M, x, y, z, pow, rad);
    for (let i = 0; i < n(4); i++) s.add({ k: "blob", x: x + s.rand(-0.3, 0.3) * rad, y, z: z + s.rand(0, 0.3), vz: 0.3, drag: 2, r: (3 + s.rand(0, 3)) * Math.min(1.5, m), life: s.rand(0.35, 0.55), R, cool: -1, seed: sd(s), hero: i === 0 });
    for (let i = 0; i < n(22); i++) { const o = out(s, s.rand(1.5, 3.8)); o.vz += 1.5; s.add({ k: "drip", x, y, z, ...o, g: 8, drag: 0.6, life: 3, R, onGround: splat }); }
    for (let i = 0; i < n(3); i++) s.add({ k: "smoke", x: x + s.rand(-0.3, 0.3) * rad, y, z: z + 0.2, vz: 0.4, g: -0.1, drag: 1.5, r: s.rand(3, 5), life: s.rand(1, 1.5), lobes: lobes(s), R, tone: 0.5 });
    if (pow >= 0.5) s.add({ k: "puddle", x, y, r: rad * 0.75 + 0.15, life: 4.5, R, debris: true, update: still });
    flourish(s, M, x, y, z, rad, Math.round(5 * m));
  },
  trail(s, M, { x, y, z, dt }) {
    for (let i = s.count(24 * s.m, dt); i > 0; i--) s.add({ k: "drip", x, y, z, vx: s.rand(-0.3, 0.3), g: 7, life: 3, R: M.R, onGround: splat });
    for (let i = s.count(14 * s.m, dt); i > 0; i--) s.add({ k: "smoke", x, y, z, vz: 0.2, drag: 2, r: s.rand(1.5, 2.2), life: 0.4, lobes: [[0, 0, 1]], R: M.R, tone: 0.5 });
  },
  linger(s, M, { at }) {
    at(9, () => ({ k: "bubble", life: 5 / 12, update: still }));
  },
  spray(s, M, { emit }) {
    emit("drip", 70, () => ({ vz: 2.5, g: 6, drag: 0.8, life: 1.5, onGround: splat }));
    emit("smoke", 14, () => ({ drag: 1.6, life: 0.6, r: 2.2, lobes: [[0, 0, 1]], tone: 0.5 }));
  },
  auraStart(s, M, T) {
    s.add({ k: "puddle", x: T.x + 0.12, y: T.y + 0.15, r: 0.22 * T.size, life: 1e9, R: M.R, update: still });
  },
  aura(s, M, { at, T, dt }) {
    at(7, () => ({ k: "drip", g: 6, life: 3, onGround: splat }));
    if (s.R() < 4 * dt) s.add({ k: "bubble", x: T.x + 0.12 + s.rand(-0.12, 0.12), y: T.y + 0.15 + s.rand(-0.06, 0.06), z: 0, life: 5 / 12, R: M.R, update: still });
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
    for (let i = 0, N = sub ? (s.R() < 0.5 ? 1 : 2) : n(4); i < N; i++) {
      const q = (i / N) * TAU + s.rand(-0.4, 0.4), d = s.rand(0.1, 0.4) * rad, sp = s.rand(0.3, 0.6) * (0.6 + rad * 0.4);
      s.add(gas(s, { x: x + Math.cos(q) * d, y: y + Math.sin(q) * d, z: cz + s.rand(0.1, 0.35), vx: Math.cos(q) * sp, vy: Math.sin(q) * sp, vz: s.rand(0.05, 0.2), g: -0.03, drag: 1.3, r: s.rand(7, 10) * Math.min(1.5, m) * (0.7 + rad * 0.2), life: s.rand(1.9, 2.7), R, wait: s.rand(0, 0.12) }));
    }
    for (let i = 0; i < (sub ? n(4) : n(10)); i++) s.add({ k: "toxbubble", x: x + s.rand(-0.5, 0.5) * rad, y: y + s.rand(-0.4, 0.4) * rad, z: cz + s.rand(0, 0.3), vz: s.rand(0.3, 0.7), g: -0.05, drag: 1.5, r: s.R() < 0.4 ? 2 : 1, life: s.rand(0.6, 1.2), R, seed: sd(s), wait: s.rand(0.1, 0.6), minor: i % 3 === 2 });
    for (let i = 0; i < (sub ? n(3) : n(8)); i++) s.add({ k: "mote", x: x + s.rand(-0.6, 0.6) * rad, y: y + s.rand(-0.5, 0.5) * rad, z: cz + s.rand(0.1, 0.6), vx: s.rand(-0.3, 0.3), vz: s.rand(0.1, 0.4), g: -0.05, drag: 2, life: s.rand(1, 1.8), R, minor: true });
    if (sub ? s.R() < 0.3 : pow >= 0.5) s.add({ k: "miasma", x, y, r: rad * (sub ? 0.9 : 0.85) + 0.2, life: 5, R, seed: sd(s), debris: true, update: still });
    flourish(s, M, x, y, z, rad, Math.round(5 * m));
  },
  trail(s, M, { x, y, z, dt }) {
    for (let i = s.count(22 * s.m, dt); i > 0; i--) s.add(gas(s, { x, y, z, vx: s.rand(-0.2, 0.2), vy: s.rand(-0.2, 0.2), vz: 0.15, drag: 2, r: s.rand(2, 3), life: s.rand(0.5, 0.75), lobes: [[0, 0, 1], [0.55, 0.2, 0.6]], R: M.R }));
    for (let i = s.count(6 * s.m, dt); i > 0; i--) s.add({ k: "toxbubble", x, y, z, vz: 0.3, drag: 2, r: 1, life: 0.5, R: M.R, seed: sd(s), minor: true });
  },
  linger(s, M, { at }) {
    at(2.2, () => gas(s, { z: 0.05, vx: s.rand(-0.25, 0.25), vy: s.rand(-0.15, 0.15), vz: 0.08, g: -0.02, drag: 1.2, r: s.rand(4, 6), life: s.rand(1.4, 1.9) }));
    at(4, () => ({ k: "toxbubble", z: 0.02, vz: s.rand(0.2, 0.45), drag: 1, r: s.R() < 0.3 ? 2 : 1, life: s.rand(0.5, 0.9), seed: sd(s) }));
  },
  spray(s, M, { emit }) {
    emit("toxcloud", 22, () => gas(s, { drag: 1.5, g: -0.04, life: s.rand(1.1, 1.5), r: s.rand(7, 10.5) }));
    emit("toxbubble", 16, () => ({ drag: 1.8, g: -0.2, r: 1, life: 0.8, seed: sd(s), minor: true }));
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
}, { flat: ["miasma"] });
