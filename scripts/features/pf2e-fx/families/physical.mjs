/**
 * Physical: kinetic, neutral, arcane.
 *
 * Kinetic and neutral are a blow: a big impact star, a ring of shock across the
 * floor, sparks off steel (half of them hot), speed lines, grit and lit stones
 * that tumble and settle, and floor dust that rolls out low and thin, never a
 * grey cloud over the shape (spellsprite-craft §1, impacts/* in the reference).
 * Arcane is force of will: an octagon of force, a rune circle that flashes,
 * shards of light and motes in place of rock.
 *
 * Also the home of the debris kit the other material families share: `phGrit`
 * (a grain thrown and fallen) and `phDust` (a translucent puff that swells and
 * thins, lit on its top). Both are cheap, so a burst can carry a hundred.
 */

import { TAU, clamp, easeOut, hash } from "../core/rand.mjs";
import { RAMP, S } from "../core/palette.mjs";
import { registerShapes, snapH } from "../core/shapes.mjs";
import { out, sd, still, splat, releaseFlash, counter, flourish } from "../core/motifs.mjs";

/* ── the shared debris kit ────────────────────────────────────────────── */

registerShapes({
  /** A grain: one pixel (two when `s` is 2), lit by its tone, dissolving at the end. */
  phGrit(v, P, p) {
    const u = p.age / p.life;
    if (u > 0.7 && hash(Math.floor(p.age * 12), p.seed) < (u - 0.7) * 3.3) return;
    const [x, y] = v.ap(p.x, p.y, p.z), t = p.t ?? 0.5;
    // a lone grain is not outlined (on parchment that turns grit into pepper); a big one is
    const o = p.s > 1 ? 1 : 0;
    P.px(x, y, S(p.R, t), o);
    if (p.s > 1) P.px(x + 1, y, S(p.R, t - 0.17), o);
  },
  /**
   * A translucent puff of dust, mist or spores: a few lobes that swell and thin,
   * lighter on the top-left, darker underneath. True translucency (Pix.mix), so
   * a crowd of them never hides what stands inside it.
   */
  phDust(v, P, p) {
    const u = clamp(p.age / p.life);
    let [cx, cy] = v.ap(p.x, p.y, p.z); [cx, cy] = snapH(p, v, cx, cy);
    const rr = p.r * (0.5 + 0.8 * easeOut(u));
    if (rr < 1) return;
    const a = (p.a0 ?? 0.55) * (u < 0.12 ? u / 0.12 : 1 - (u - 0.12) / 0.88), R = p.R ?? RAMP.smoke, t = p.tone ?? 0.45, L = p.lobes ?? DUST_LOBES;
    if (a <= 0.03) return;
    // lobe centres and radii once per draw; the per-pixel test is plain arithmetic
    const n = Math.min(4, L.length);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < n; i++) {
      LX[i] = cx + L[i][0] * rr; LY[i] = cy + L[i][1] * rr; LR[i] = rr * L[i][2];
      x0 = Math.min(x0, LX[i] - LR[i]); x1 = Math.max(x1, LX[i] + LR[i]); y0 = Math.min(y0, LY[i] - LR[i]); y1 = Math.max(y1, LY[i] + LR[i]);
    }
    const hi = { c: S(R, t + 0.17), a }, mid = { c: S(R, t), a }, lo = { c: S(R, t - 0.17), a }, rim = { c: S(R, t), a: a * 0.6 }, rimLo = { c: S(R, t - 0.17), a: a * 0.6 };
    P.shade(x0, y0, x1, y1, (x, y) => {
      for (let i = 0; i < n; i++) {
        const lx = x - LX[i], ly = y - LY[i], lr = LR[i], d = (lx * lx + ly * ly) / (lr * lr);
        if (d > 1) continue;
        const lit = (-lx * 0.55 - ly * 0.85) / lr;
        if (d > 0.55) return lit < -0.5 ? rimLo : rim;
        return lit > 0.4 ? hi : lit < -0.5 ? lo : mid;
      }
      return null;
    }, 0, "mix");
  },
});

const LX = new Float64Array(4), LY = new Float64Array(4), LR = new Float64Array(4);
const DUST_LOBES = [[0, 0, 1], [-0.55, 0.2, 0.7], [0.55, 0.25, 0.65]];
/** A puff's lobes: the main one and up to three smaller ones round it. */
export function dustLobes(s) {
  const all = [[0, 0, 1], [-0.6, 0.22, 0.72], [0.6, 0.28, 0.66], [0.1, -0.5, 0.6]];
  return [all[0], ...all.slice(1).filter(() => s.R() < 0.75)];
}

/**
 * Grit thrown from a point: `N` grains fanned out at speed, falling under real
 * gravity and lying where they land a moment before they go. Everything past
 * the first few is minor.
 */
export function grit(s, R, x, y, z, N, { sp = [2, 8], up = [1, 4], life = [0.9, 1.8], tone = [0.33, 0.83], keep = 3, spread = 0 } = {}) {
  for (let i = 0; i < N; i++) {
    const q = s.rand(0, TAU), v = s.rand(sp[0], sp[1]), d = spread ? s.rand(0, spread) : 0;
    s.add({ k: "phGrit", x: x + Math.cos(q) * d, y: y + Math.sin(q) * d, z, vx: Math.cos(q) * v, vy: Math.sin(q) * v, vz: s.rand(up[0], up[1]), g: 22, drag: 1.1, bounce: 0.25, life: s.rand(life[0], life[1]), R, t: s.rand(tone[0], tone[1]), s: s.R() < 0.4 ? 2 : 1, seed: s.seedInt(), debris: true, minor: i >= keep });
  }
}

/**
 * Dust rolling out low along the floor in a ring from a point, `N` puffs,
 * translucent so the burst's own shape stays readable inside it.
 */
export function dustRing(s, R, x, y, N, { r0 = 0.2, sp = [1, 2.2], r = [5, 9], life = [0.9, 1.5], tone = 0.4, a0 = 0.5, wait = [0.02, 0.12], keep = 2 } = {}) {
  for (let i = 0; i < N; i++) {
    const q = (i / N) * TAU + s.rand(-0.3, 0.3), v = s.rand(sp[0], sp[1]);
    s.add({ k: "phDust", x: x + Math.cos(q) * r0, y: y + Math.sin(q) * r0, z: 0.04, vx: Math.cos(q) * v, vy: Math.sin(q) * v, vz: 0.05, drag: 2.4, g: -0.02, r: s.rand(r[0], r[1]), life: s.rand(life[0], life[1]), R, tone, a0, lobes: dustLobes(s), wait: s.rand(wait[0], wait[1]), minor: i >= keep });
  }
}

/* ── the family ───────────────────────────────────────────────────────── */

const isArcane = (M) => M.material === "arcane";

export default {
  id: "physical",
  burst(s, M, { x, y, z, pow, rad, sub }) {
    const R = M.R, m = s.m * pow, mm = Math.min(1.6, m), n0 = counter(s, pow, rad), n = sub ? (k) => Math.ceil(n0(k) / 2.5) : n0;
    /* The kinetic ramp is nearly white, so a crit-strength release (light,
       flash and pale smoke together) whites out the squares around it and
       hides the crit's own crossing stroke. Hold the light and the dust down
       as power rises; the star, the sparks and the debris carry the hit.
       A heavy blow holds its contact frame (strikes.mjs heavyContact), which
       would hold that white pool on screen too, so it is damped the same way. */
    const w = s.spec.weapon, hot = pow > 1.2 || (s.spec.kind === "strike" && !!(w?.heavy || w?.power));
    const arc = isArcane(M), stone = arc ? R : RAMP.kinetic;
    releaseFlash(s, M, x, y, z, pow, rad, hot ? { light: 0.3, flash: 0.5 } : sub ? { flash: 0.6, light: 0.22 } : undefined);
    // the impact frame: a big star, then a second turned a beat later
    s.add({ k: "star", x, y, z, L: (sub ? 4 : 7) * mm * (0.8 + rad * 0.5), life: 3 / 12, R, update: still });
    if (!sub) s.add({ k: "star", x, y, z, L: 4.5 * mm, life: 3 / 12, R, wait: 0.06, update: still });
    // shock across the floor: a fast thin ring to the rim, a broken one behind
    if (!sub) {
      s.add({ k: "ring", x, y, r: Math.min(rad * 2.4 + 0.9, rad * 1.1 + 1.4) * Math.min(1.3, mm), life: 0.42, R, seed: sd(s), update: still });
      s.add({ k: "ring", x, y, r: Math.min(rad * 1.6 + 0.6, rad * 1.1 + 1.1) * Math.min(1.3, mm), life: 0.6, R, broken: true, seed: sd(s), wait: 0.05, update: still });
    }
    // sparks off steel: long fast streaks, a share of them hot when it is steel
    for (let i = 0, N = n(36); i < N; i++) s.add({ k: "spark", x, y, z, ...out(s, s.rand(4.5, 12)), g: 14, drag: 2.2, bounce: 0.4, life: s.rand(0.25, 0.6), R: !arc && i % 3 === 0 ? RAMP.fire : R, minor: i >= 8 });
    // speed lines: straight streaks running out of the impact
    for (let i = 0, N = sub ? 0 : n(6); i < N; i++) {
      const q = (i / N) * TAU + s.rand(-0.2, 0.2), sp = s.rand(9, 14);
      s.add({ k: "streak", x: x + Math.cos(q) * 0.15, y: y + Math.sin(q) * 0.15, z, vx: Math.cos(q) * sp, vy: Math.sin(q) * sp * 0.75, vz: s.rand(-0.5, 0.8), drag: 6, life: s.rand(0.12, 0.2), R, minor: i % 2 === 1 });
    }
    if (arc) {
      // force of will: an octagon of force, a rune circle that flashes, shards and motes
      if (!sub) s.add({ k: "octa", x, y, z, r: (8 + rad * 14) * Math.min(1.4, mm), squash: true, life: 0.45, R, update: still });
      if (!sub && pow >= 0.5) s.add({ k: "glyph", x, y, r: rad * 1.3 + 0.45, life: 1.1, R, star: true, glyphs: undefined, spin: -1, update: still });
      for (let i = 0, N = n(14); i < N; i++) s.add({ k: "shard", x, y, z, ...out(s, s.rand(2.5, 6.5)), g: 7, drag: 1.4, bounce: 0.35, life: s.rand(0.5, 0.9), R, seed: s.R(), minor: i >= 4 });
      for (let i = 0, N = n(16); i < N; i++) s.add({ k: "mote", x: x + s.rand(-1, 1) * (rad + 0.3), y: y + s.rand(-1, 1) * (rad + 0.3) * 0.7, z: z + s.rand(-0.2, 0.4), vz: s.rand(0.3, 0.9), drag: 1.5, life: s.rand(0.6, 1.2), R, plus: s.R() < 0.4, wait: s.rand(0, 0.25), minor: i >= 4 });
    } else {
      // lit stones that tumble, bounce and settle; grit fanned out round them
      for (let i = 0, N = n(9); i < N; i++) s.add({ k: "chunk", x, y, z, ...out(s, s.rand(2, 6)), g: 14, drag: 0.8, bounce: 0.35, life: s.rand(1.6, 2.6), R: stone, s: i < 3 ? 2 : 1, wide: s.R() < 0.4, debris: true, minor: i >= 3 });
      grit(s, stone, x, y, Math.max(0.05, z * 0.6), n(30), { sp: [2, 8.5], up: [1, 4.5], keep: 4 });
    }
    // floor dust rolling out thin and low, held back on a hot blow so the shape reads
    const nd = hot ? Math.min(3, n(4)) : sub ? Math.min(2, n(3)) : n(5);
    dustRing(s, arc ? R : RAMP.kinetic, x, y, nd, { r0: rad * 0.4, sp: [1.2, 2.6], r: hot ? [4, 6] : [5, 8], tone: 0.5, a0: hot ? 0.35 : 0.45, keep: 1 });
    for (let i = 0, N = sub ? 0 : n(3); i < N; i++) s.add({ k: "glint", x: x + s.rand(-1, 1) * (rad + 0.4), y: y + s.rand(-1, 1) * (rad + 0.4) * 0.7, z: s.rand(0.05, 0.6), life: 5 / 12, R, wait: s.rand(0.1, 0.5), minor: i >= 1, update: still });
    if (!sub && pow >= 0.8) s.shake = Math.max(s.shake, 0.6 + pow * 0.6);
    flourish(s, M, x, y, z, rad, Math.round(5 * m));
  },
  trail(s, M, { x, y, z, dt }) {
    const R = M.R, arc = isArcane(M);
    for (let i = s.count(26 * s.m, dt); i > 0; i--) s.add({ k: "phDust", x: x + s.rand(-0.04, 0.04), y: y + s.rand(-0.04, 0.04), z, vz: 0.1, drag: 3, r: s.rand(2, 3.2), life: s.rand(0.3, 0.45), R: arc ? R : RAMP.kinetic, tone: 0.5, a0: 0.5, lobes: DUST_LOBES });
    for (let i = s.count(22 * s.m, dt); i > 0; i--) s.add({ k: arc ? "mote" : "spark", x, y, z, vx: s.rand(-1.2, 1.2), vy: s.rand(-1.2, 1.2), vz: s.rand(-0.4, 0.8), g: arc ? 0 : 6, drag: 2.5, life: s.rand(0.2, 0.4), R, minor: true });
    for (let i = s.count(5, dt); i > 0; i--) s.add({ k: "glint", x, y, z, life: 5 / 12, R, minor: true, update: still });
  },
  linger(s, M, { at }) {
    const arc = isArcane(M);
    at(arc ? 1 : 2.8, () => ({ k: "phDust", vx: s.rand(-0.3, 0.3), vz: 0.1, drag: 1.6, r: s.rand(5, 8), life: s.rand(1.2, 1.7), R: arc ? M.R : RAMP.kinetic, tone: 0.5, a0: 0.38, lobes: dustLobes(s) }));
    at(arc ? 4 : 14, () => ({ k: "phGrit", z: s.rand(0.4, 1), g: 18, bounce: 0.2, life: s.rand(0.8, 1.3), R: arc ? M.R : RAMP.kinetic, t: s.rand(0.4, 0.8), s: 1, seed: s.seedInt(), debris: true, minor: true }));
    at(arc ? 12 : 4, () => ({ k: arc ? "mote" : "glint", z: s.rand(0.05, 0.5), vz: arc ? s.rand(0.3, 0.7) : 0, drag: 1.2, life: arc ? s.rand(0.6, 1) : 5 / 12, plus: s.R() < 0.4, update: arc ? undefined : still, minor: true }));
    if (arc) at(0.7, () => ({ k: "octa", z: s.rand(0.1, 0.5), r: s.rand(4, 7), squash: true, life: 0.45, update: still }));
    if (arc) at(3, () => ({ k: "glint", z: s.rand(0.1, 0.7), life: 5 / 12, update: still, minor: true }));
  },
  spray(s, M, { emit }) {
    const arc = isArcane(M);
    emit("phDust", 44, () => ({ R: arc ? M.R : RAMP.kinetic, drag: 2, g: -0.04, life: s.rand(0.6, 0.95), r: s.rand(4, 7), tone: 0.5, a0: 0.45, lobes: dustLobes(s) }));
    emit(arc ? "shard" : "phGrit", 70, () => ({ g: arc ? 3 : 10, drag: 1.4, bounce: 0.25, life: s.rand(0.6, 1), R: arc ? M.R : RAMP.kinetic, t: s.rand(0.33, 0.83), s: s.R() < 0.4 ? 2 : 1, seed: arc ? s.R() : s.seedInt(), minor: true }));
    emit("spark", 30, () => ({ R: arc ? M.R : RAMP.fire, drag: 2, g: 6, life: s.rand(0.25, 0.45), minor: true }));
  },
  auraStart(s, M, T) {
    s.add({ k: "puddle", x: T.x + 0.12, y: T.y + 0.15, r: 0.26 * T.size, life: 1e9, R: M.R, update: still });
  },
  aura(s, M, { at }) {
    at(9, () => ({ k: "drip", z: s.rand(0.3, 0.9), g: 6, life: 3, onGround: splat }));
    at(3, () => ({ k: "phGrit", z: s.rand(0.3, 0.8), vx: s.rand(-0.4, 0.4), g: 10, life: s.rand(0.5, 0.8), t: s.rand(0.5, 0.83), s: 1, seed: s.seedInt(), minor: true }));
  },
};
