/** Flame: fire. Banded fireballs that cool into smoke, flame tongues, embers, scorch. */

import { TAU } from "../core/rand.mjs";
import { RAMP } from "../core/palette.mjs";
import { sph, out, sd, lobes, still, releaseFlash, counter, flourish } from "../core/motifs.mjs";

export default {
  id: "flame",
  burst(s, M, { x, y, z, pow, rad }) {
    const R = M.R, m = s.m * pow, mm = Math.min(1.6, m), n = counter(s, pow, rad);
    releaseFlash(s, M, x, y, z, pow, rad);
    const nb = n(5);
    for (let i = 0; i < nb; i++) {
      let px, py, pz;
      if (s.take === 0) { const d = sph(s), L = s.rand(0, rad * 0.45); px = x + d[0] * L; py = y + d[1] * L * 0.7; pz = Math.max(0.15, z + Math.abs(d[2]) * L); }
      else if (s.take === 1) { const q = (i / nb) * TAU + s.rand(-0.3, 0.3); px = x + Math.cos(q) * rad * 0.5; py = y + Math.sin(q) * rad * 0.5; pz = 0.25 + s.rand(0, 0.3); }
      else { px = x + s.rand(-0.15, 0.15) * rad; py = y; pz = 0.2 + (i / Math.max(1, nb - 1)) * rad * 1.1; }
      s.add({ k: "blob", x: px, y: py, z: pz, vz: s.take === 2 ? 0.6 : s.rand(0.1, 0.6), g: -0.4, drag: 2, r: (4 + s.rand(0, 4)) * mm * (0.7 + rad * 0.25), life: s.rand(0.5, 0.85), R, cool: 0.2, seed: sd(s), wait: s.rand(0, 0.08), glow: true, hero: i === 0 });
    }
    if (s.take === 2) for (let i = 0; i < 3; i++) s.add({ k: "blob", x: x + (i - 1) * rad * 0.35, y, z: 0.3 + rad * 1.15, vz: 0.4, drag: 2, r: (4 + s.rand(0, 3)) * mm, life: s.rand(0.55, 0.8), R, cool: 0.2, seed: sd(s), wait: 0.06, glow: true });
    for (let i = 0; i < n(4); i++) s.add({ k: "smoke", x: x + s.rand(-0.4, 0.4) * rad, y: y + s.rand(-0.3, 0.3) * rad, z: z + s.rand(0.2, 0.8) * rad, vx: s.rand(-0.2, 0.2), vz: s.rand(0.3, 0.7), g: -0.2, drag: 1.5, r: s.rand(4, 7) * Math.min(1.5, m), life: s.rand(1.6, 2.4), lobes: lobes(s), wait: s.rand(0.3, 0.5), tone: 0.4 });
    for (let i = 0; i < n(12); i++) s.add({ k: "spark", x, y, z, ...out(s, s.rand(3, 7)), g: 9, drag: 1.4, bounce: 0.35, life: s.rand(0.35, 0.8), R, minor: i % 2 === 1 });
    for (let i = 0; i < n(5); i++) s.add({ k: "chunk", x, y, z, ...out(s, s.rand(2, 4.5)), g: 9, drag: 0.8, bounce: 0.35, life: s.rand(3, 4.2), R: RAMP.kinetic, s: 2, wide: s.R() < 0.4, debris: true });
    for (let i = 0; i < n(8); i++) s.add({ k: "ember", x: x + s.rand(-0.5, 0.5) * rad, y: y + s.rand(-0.5, 0.5) * rad, z: z + s.rand(0, 0.6), vx: s.rand(-0.4, 0.4), vy: s.rand(-0.3, 0.3), vz: s.rand(0.4, 1.2), g: -0.3, drag: 1.2, life: s.rand(1.2, 2.4), R, seed: sd(s), minor: i % 3 === 2 });
    if (pow >= 0.5) s.add({ k: "scorch", x, y, r: rad * 0.8 + 0.15, life: 5, seed: sd(s), debris: true, update: still });
    flourish(s, M, x, y, z, rad, Math.round(5 * m));
  },
  trail(s, M, { x, y, z, dt, scale = 1 }) {
    // scale: a lobbed fireball sheds a wake its own size, and it lasts long enough to read as a path
    const R = M.R, k = Math.max(1, scale), j = () => s.rand(-0.04, 0.04) * k;
    for (let i = s.count(40 * s.m * Math.sqrt(k), dt); i > 0; i--) s.add({ k: "blob", x: x + j(), y: y + j(), z: z + j(), vz: s.rand(0.1, 0.5), g: -0.6, drag: 3, r: s.rand(1.5, 2.6) * Math.sqrt(k), life: s.rand(0.2, 0.35) * (k > 1 ? 1.4 : 1), R, cool: 0.25, seed: sd(s) });
    for (let i = s.count(16 * s.m * k, dt); i > 0; i--) s.add({ k: "ember", x: x + j(), y: y + j(), z, vx: s.rand(-0.4, 0.4) * k, vy: s.rand(-0.4, 0.4) * k, vz: s.rand(0, 0.6), g: -0.6, drag: 1, life: s.rand(0.5, 0.9), R, seed: sd(s), minor: true });
    if (k > 1) for (let i = s.count(5 * k, dt); i > 0; i--) s.add({ k: "smoke", x: x + j(), y: y + j(), z, vz: s.rand(0.2, 0.4), g: -0.1, drag: 1.5, r: s.rand(2.5, 4) * Math.sqrt(k), life: s.rand(0.5, 0.8), lobes: lobes(s), tone: 0.4, minor: true });
  },
  linger(s, M, { at }) {
    at(9, () => ({ k: "tongue", h: s.rand(6, 12) * Math.min(1.4, s.m), w: s.rand(1.6, 2.8), life: s.rand(0.45, 0.8), seed: Math.floor(s.R() * 1000), glow: true, r: 2, update: still }));
    at(5, () => ({ k: "ember", z: 0.2, vz: s.rand(0.4, 1), vx: s.rand(-0.2, 0.2), g: -0.3, drag: 1, life: s.rand(0.8, 1.4), seed: sd(s), minor: true }));
    at(1.2, () => ({ k: "smoke", z: 0.5, vz: 0.4, g: -0.1, drag: 1, r: s.rand(3, 5), life: 1.8, lobes: lobes(s), tone: 0.4, R: RAMP.smoke }));
  },
  spray(s, M, { emit }) {
    emit("blob", 70, () => ({ drag: 1.7, g: -0.5, life: s.rand(0.5, 0.7), r: s.rand(2, 3.5), cool: 0.2, seed: sd(s) }));
    emit("ember", 20, () => ({ drag: 1.5, g: -0.4, life: 0.8, seed: sd(s), minor: true }));
  },
  aura(s, M, { at }) {
    at(12, () => ({ k: "tongue", h: s.rand(5, 10), w: s.rand(1.4, 2.4), life: s.rand(0.4, 0.7), seed: Math.floor(s.R() * 1000), update: still }));
    at(5, () => ({ k: "ember", vz: s.rand(0.5, 1.1), g: -0.5, drag: 1, life: s.rand(0.6, 1), seed: sd(s) }));
    at(0.8, () => ({ k: "smoke", z: 1, vz: 0.4, g: -0.1, drag: 1, r: s.rand(3, 4), life: 1.6, lobes: lobes(s), tone: 0.4, R: RAMP.smoke }));
  },
};
