/** Frost: cold. Mist, tumbling shards, flakes, a frost sheet with crack ferns, ice spikes. */

import { TAU } from "../core/rand.mjs";
import { out, sd, lobes, still, releaseFlash, counter, flourish } from "../core/motifs.mjs";

export default {
  id: "frost",
  burst(s, M, { x, y, z, pow, rad }) {
    const R = M.R, m = s.m * pow, n = counter(s, pow, rad);
    releaseFlash(s, M, x, y, z, pow, rad);
    for (let i = 0; i < n(4); i++) s.add({ k: "smoke", x: x + s.rand(-0.3, 0.3) * rad, y, z: z + s.rand(0, 0.5), vx: s.rand(-0.4, 0.4), vz: 0.2, g: -0.05, drag: 1.5, r: s.rand(4, 6) * Math.min(1.5, m), life: s.rand(0.9, 1.4), lobes: lobes(s), R, tone: 0.75 });
    for (let i = 0; i < n(14); i++) s.add({ k: "shard", x, y, z, ...out(s, s.rand(2, 5)), g: 8, drag: 1, bounce: 0.3, life: s.rand(1.2, 2.2), R, seed: s.R() });
    for (let i = 0; i < n(16); i++) s.add({ k: "flake", x: x + s.rand(-1, 1) * rad, y: y + s.rand(-1, 1) * rad, z: z + s.rand(0.2, 1.2), vx: s.rand(-0.3, 0.3), vz: s.rand(-0.1, 0.2), g: 0.3, drag: 2.5, life: s.rand(1.4, 2.6), R, big: s.R() < 0.25, minor: i % 2 === 0 });
    if (pow >= 0.5) {
      s.add({ k: "frost", x, y, r: rad * 0.95 + 0.2, life: 4.5, R, seed: sd(s), debris: true, update: still });
      const N = Math.round((3 + rad * 3) * Math.min(1.4, m));
      for (let i = 0; i < N; i++) {
        const a = s.rand(0, TAU), d = Math.sqrt(s.R()) * rad * 0.85;
        s.add({ k: "crystal", x: x + Math.cos(a) * d, y: y + Math.sin(a) * d, z: 0, h: s.rand(8, 18) * Math.min(1.5, m) * (1 - (d / (rad + 0.6)) * 0.5), w: s.rand(2, 4), lean: s.rand(-3, 3), life: s.rand(2.2, 3.2), R, wait: d * 0.1, debris: true, update: still });
      }
    }
    flourish(s, M, x, y, z, rad, Math.round(5 * m));
  },
  trail(s, M, { x, y, z, dt }) {
    const R = M.R;
    for (let i = s.count(18 * s.m, dt); i > 0; i--) s.add({ k: "smoke", x, y, z, vz: 0.1, drag: 2, r: s.rand(1.5, 2.5), life: 0.45, lobes: [[0, 0, 1]], R, tone: 0.7 });
    for (let i = s.count(30 * s.m, dt); i > 0; i--) s.add({ k: "flake", x, y, z, vx: s.rand(-0.4, 0.4), vy: s.rand(-0.4, 0.4), g: 0.5, drag: 2, life: s.rand(0.5, 0.9), R, minor: true });
  },
  linger(s, M, { at }) {
    at(10, () => ({ k: "flake", z: s.rand(0.9, 1.6), vx: s.rand(-0.2, 0.2), g: 0.4, drag: 2, life: s.rand(1, 1.6), big: s.R() < 0.2, minor: true }));
    at(1, () => ({ k: "crystal", z: 0, h: s.rand(5, 9), w: 2, lean: s.rand(-1, 1), life: 1.8, update: still }));
  },
  spray(s, M, { emit }) {
    emit("smoke", 40, () => ({ drag: 1.7, life: 0.6, r: s.rand(2, 3), lobes: [[0, 0, 1], [0.5, 0.2, 0.6]], tone: 0.75 }));
    emit("flake", 50, () => ({ drag: 1.3, g: 0.3, life: 0.9, minor: true }));
    emit("shard", 22, () => ({ drag: 1.4, g: 1, life: 0.7, seed: s.R() }));
  },
  auraStart(s, M, T) {
    s.add({ k: "frost", x: T.x, y: T.y, r: 0.55 * T.size, life: 1e9, R: M.R, seed: 3, update: still });
  },
  aura(s, M, { at }) {
    at(8, () => ({ k: "flake", z: s.rand(1, 1.4), vx: s.rand(-0.2, 0.2), g: 0.4, drag: 2, life: 1.4, big: s.R() < 0.25 }));
    at(1.4, () => ({ k: "crystal", h: s.rand(4, 8), w: 2, lean: s.rand(-1, 1), life: 1.6, update: still }), false);
  },
};
