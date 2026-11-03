/** Physical: kinetic, neutral, arcane. An impact star, sparks off steel, dust, a little grit. */

import { out, lobes, still, splat, releaseFlash, counter, flourish } from "../core/motifs.mjs";

export default {
  id: "physical",
  burst(s, M, { x, y, z, pow, rad }) {
    const R = M.R, m = s.m * pow, mm = Math.min(1.6, m), n = counter(s, pow, rad);
    /* The kinetic ramp is nearly white, so a crit-strength release (light,
       flash and pale smoke together) whites out the squares around it and
       hides the crit's own crossing stroke. Hold the light and the smoke down
       as power rises; the star and the sparks carry the hit.
       A heavy blow holds its contact frame (strikes.mjs heavyContact), which
       would hold that white pool on screen too, so it is damped the same way. */
    const w = s.spec.weapon, hot = pow > 1.2 || (s.spec.kind === "strike" && !!(w?.heavy || w?.power));
    releaseFlash(s, M, x, y, z, pow, rad, hot ? { light: 0.3, flash: 0.5 } : undefined);
    s.add({ k: "star", x, y, z, L: 4 * mm, life: 3 / 12, R, update: still });
    for (let i = 0; i < n(14); i++) s.add({ k: "spark", x, y, z, ...out(s, s.rand(3, 7)), g: 9, drag: 1.3, bounce: 0.4, life: s.rand(0.3, 0.6), R, minor: i % 2 === 1 });
    const puffs = hot ? Math.min(n(4), 3) : n(4);
    for (let i = 0; i < puffs; i++) s.add({ k: "smoke", x: x + s.rand(-0.3, 0.3), y: y + s.rand(-0.2, 0.2), z: 0.1, vx: s.rand(-0.8, 0.8), vy: s.rand(-0.3, 0.3), vz: 0.3, drag: 2.5, g: -0.05, r: hot ? s.rand(2.5, 3.5) : s.rand(3, 5), life: s.rand(0.8, 1.3), lobes: lobes(s), R, tone: hot ? 0.4 : 0.55 });
    for (let i = 0; i < n(4); i++) s.add({ k: "chunk", x, y, z, ...out(s, s.rand(1.5, 3.5)), g: 9, drag: 0.8, bounce: 0.35, life: s.rand(2.5, 3.5), R, s: 2, debris: true });
    flourish(s, M, x, y, z, rad, Math.round(5 * m));
  },
  trail(s, M, { x, y, z, dt }) {
    for (let i = s.count(16 * s.m, dt); i > 0; i--) s.add({ k: "smoke", x, y, z, drag: 3, r: 1.5, life: 0.3, lobes: [[0, 0, 1]], R: M.R, tone: 0.45 });
  },
  linger(s, M, { at }) {
    at(1.5, () => ({ k: "smoke", vz: 0.15, drag: 2, r: s.rand(3, 4), life: 1.2, lobes: lobes(s), tone: 0.5 }));
  },
  spray(s, M, { emit }) {
    emit("smoke", 50, () => ({ drag: 1.8, g: -0.05, life: 0.7, r: s.rand(2.5, 4), lobes: lobes(s), tone: 0.5 }));
  },
  auraStart(s, M, T) {
    s.add({ k: "puddle", x: T.x + 0.12, y: T.y + 0.15, r: 0.22 * T.size, life: 1e9, R: M.R, update: still });
  },
  aura(s, M, { at }) {
    at(6, () => ({ k: "drip", z: s.rand(0.3, 0.8), g: 6, life: 3, onGround: splat }));
  },
};
