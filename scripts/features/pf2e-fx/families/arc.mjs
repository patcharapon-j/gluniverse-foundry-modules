/** Arc: electricity. Bolts that walk in 45° runs, a flaring star, bouncing sparks. */

import { TAU } from "../core/rand.mjs";
import { out, sd, still, releaseFlash, counter, flourish } from "../core/motifs.mjs";

export default {
  id: "arc",
  burst(s, M, { x, y, z, pow, rad }) {
    const R = M.R, m = s.m * pow, mm = Math.min(1.6, m), n = counter(s, pow, rad);
    releaseFlash(s, M, x, y, z, pow, rad);
    for (let i = 0; i < n(4); i++) {
      const a = s.rand(0, TAU), d = s.rand(0.6, 1.3) * (rad + 0.4);
      s.add({ k: "bolt", a: [x, y, z], b: [x + Math.cos(a) * d, y + Math.sin(a) * d, Math.max(0, z + s.rand(-0.6, 0.3))], life: s.rand(0.2, 0.35), R, seed: sd(s), glow: true, update: still });
    }
    s.add({ k: "star", x, y, z, L: 5 * mm, life: 3 / 12, R, update: still });
    for (let i = 0; i < n(18); i++) s.add({ k: "spark", x, y, z, ...out(s, s.rand(3, 8)), g: 9, drag: 1.2, bounce: 0.5, life: s.rand(0.25, 0.6), R, minor: i % 2 === 1 });
    if (pow >= 0.5) s.add({ k: "scorch", x, y, r: rad * 0.4 + 0.1, life: 3.5, seed: sd(s), debris: true, update: still });
    flourish(s, M, x, y, z, rad, Math.round(5 * m));
  },
  trail(s, M, { x, y, z, dt }) {
    for (let i = s.count(40 * s.m, dt); i > 0; i--) s.add({ k: "spark", x, y, z, vx: s.rand(-2.5, 2.5), vy: s.rand(-2.5, 2.5), vz: s.rand(-1, 2.5), g: 6, life: s.rand(0.15, 0.35), R: M.R, minor: true });
  },
  /** The projectile draws a live bolt back to the hand. */
  projectileBolt: true,
  linger(s, M, { at, spot, k, dt }) {
    if (s.R() < 4 * k * dt) { const a = spot(), b = spot(); s.add({ k: "bolt", a: [a[0], a[1], 0.05], b: [b[0], b[1], 0.05], life: 0.12, R: M.R, seed: sd(s), glow: true, update: still }); }
    at(6, () => ({ k: "spark", vx: s.rand(-1.5, 1.5), vy: s.rand(-1.5, 1.5), vz: s.rand(1, 2.5), g: 8, life: 0.35, minor: true }));
  },
  spray(s, M, { emit, hand, dir, half, len, dt }) {
    if (s.R() < 14 * dt) {
      const q = dir + s.rand(-half, half), d = s.rand(len * 0.4, len * 0.9);
      s.add({ k: "bolt", a: hand, b: [hand[0] + Math.cos(q) * d, hand[1] + Math.sin(q) * d, s.rand(0.3, 0.8)], life: 0.12, R: M.R, seed: sd(s), glow: true, update: still });
    }
    emit("spark", 35, () => ({ drag: 1.4, g: 3, life: 0.5, minor: true }));
  },
  aura(s, M, { at, body, dt }) {
    if (s.R() < 6 * dt) { const a = body(true), b = body(true); s.add({ k: "bolt", a: [a.x, a.y, a.z], b: [b.x, b.y, b.z], life: 0.1, R: M.R, seed: sd(s), update: still }); }
    at(7, () => ({ k: "spark", vx: s.rand(-1.5, 1.5), vy: s.rand(-1.5, 1.5), vz: s.rand(0, 2), g: 7, life: 0.3 }));
  },
};
