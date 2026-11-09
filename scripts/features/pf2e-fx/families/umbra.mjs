/**
 * Umbra: void, unholy, shadow. Three kinds of dark, benchmarked against
 * pixelfx `shadow/void-orb`, `shadow/dark-explosion`, `shadow/curse` and
 * `shadow/shadow-tendrils` (spellsprite-craft §5). They drink light: their
 * pools are dark, their lights are faint and coloured, and white is only the
 * flash.
 *
 *   void     light pulled inward: streaks and motes spiralling into a black
 *            core with a pale crawling rim, a black star across it, the dark
 *            pool spreading; then the core bursts into violet shards, wisps and
 *            curling dark smoke
 *   unholy   crimson-black and sharp: a thorned sigil cut into the floor,
 *            blood-dark spikes that punch up in a wave, ragged dark smoke,
 *            crimson sparks and embers
 *   shadow   soft dark smoke: rolling clouds that spread and settle, tendrils
 *            lashing up out of a spreading pool, no hard core and almost no
 *            light
 *
 * Shapes are prefixed `um`.
 */

import { TAU, clamp, fadeOut, hash } from "../core/rand.mjs";
import { S } from "../core/palette.mjs";
import { registerShapes } from "../core/shapes.mjs";
import { out, sd, lobes, still, releaseFlash, counter, flourish } from "../core/motifs.mjs";
import { flat, emberUpd, subFlash } from "./flame.mjs";
import { shard } from "./frost.mjs";

registerShapes({
  /** Unholy's sigil: a ring, an inverted star and thorns, cut hard into the floor. */
  umbSigil(v, P, p) {
    const u = p.age / p.life, fr = Math.floor(p.age * 12), [cx, cy] = v.ap(p.x, p.y, 0), r = p.r * v.aps * Math.min(1, (fr + 1) / 3), sq = v.sq;
    const a = p.life >= 1e8 ? 0.75 : u < 0.1 ? u / 0.1 : fadeOut(u, 0.6);
    if (r < 2) return;
    P.ellipse(cx, cy, r, r * sq, () => ({ c: S(p.R, 0.82), a }));
    P.ellipse(cx, cy, r * 0.8, r * 0.8 * sq, (q) => (Math.floor((q / TAU) * 24) % 2 ? null : { c: S(p.R, 0.55), a }));
    for (let i = 0; i < 5; i++) {
      // pointing down: the star's tip at the bottom of the circle
      const q0 = Math.PI / 2 + (i * TAU) / 5, q1 = Math.PI / 2 + ((i + 2) * TAU) / 5;
      P.line(cx + Math.cos(q0) * r * 0.78, cy + Math.sin(q0) * r * 0.78 * sq, cx + Math.cos(q1) * r * 0.78, cy + Math.sin(q1) * r * 0.78 * sq, S(p.R, 0.95), 0, a);
    }
    for (let i = 0; i < 10; i++) {
      const q = (i * TAU) / 10 + 0.31, L = (i % 2 ? 0.18 : 0.32) * (1 + 0.3 * hash(i, p.seed));
      P.line(cx + Math.cos(q) * r, cy + Math.sin(q) * r * sq, cx + Math.cos(q) * r * (1 + L), cy + Math.sin(q) * r * (1 + L) * sq, S(p.R, 0.72), 0, a);
    }
  },
}, { flat: ["umbSigil"] });

registerShapes({
  /** A black star: four long dark blades with a lit edge, cutting across the flash for a few frames. */
  umStar(v, P, p) {
    const fr = Math.floor(p.age * 12); if (fr > 3) return;
    const [x, y] = v.ap(p.x, p.y, p.z), L = p.L * [0.7, 1.2, 1, 0.6][fr], q0 = p.q ?? 0.3;
    for (let k = 0; k < 4; k++) {
      const q = q0 + (k * TAU) / 4, c = Math.cos(q), s = Math.sin(q), n = Math.ceil(L * (k % 2 ? 0.6 : 1));
      for (let i = 0; i <= n; i++) {
        const f = i / n, w = Math.max(0, Math.round((1 - f) * 1.6));
        for (let j = -w; j <= w; j++) P.px(x + c * i - s * j, y + s * i + c * j, j === -w && w > 0 ? S(p.R, 0.67) : S(p.R, 0), 2);
      }
    }
  },
  /** A tendril lashing up out of the floor: dark, swaying, a lit edge on one side; grows then sinks. */
  umTendril(v, P, p) {
    const u = clamp(p.age / p.life), fr = Math.floor(p.age * 12), grow = Math.sin(Math.PI * Math.min(1, u * 1.1));
    const h = p.h * grow * (v.kind === "top" ? 0.55 : 1); if (h < 1.5) return;
    const [bx, by] = v.ap(p.x, p.y, 0);
    for (let j = 0; j < h; j++) {
      const f = j / h, sway = Math.sin(f * 4 + fr * 0.7 + p.seed) * f * (p.amp ?? 3), w = Math.max(0, Math.round((1 - f) * (p.w ?? 1.5)));
      for (let i = -w; i <= w; i++) P.px(bx + sway + i, by - j, i === w && w > 0 ? S(p.R, 0.5) : S(p.R, f > 0.85 ? 0.33 : 0.08), 1);
    }
  },
});


registerShapes({
  /**
   * The void pulse: a band of dark rolling out from the body, black in the
   * middle of the band with a pale crawling rim outside and a violet one
   * inside, thick as it leaves and thinning to a line at the rim. Standing (it
   * is drawn at the body's height), squashed onto the floor like a ripple.
   */
  umPulse(v, P, p) {
    const u = clamp(p.age / p.life), fr = Math.floor(p.age * 12), e = 1 - (1 - u) ** 2.4, [cx, cy] = v.ap(p.x, p.y, p.z);
    const rr = p.r0 + (p.r - p.r0) * e, th = Math.max(1, Math.round(p.th * (1 - u * 0.8))), fl = v.kind === "top" ? 0.86 : 0.4, a = u < 0.75 ? 1 : (1 - u) / 0.25;
    if (rr < 2) return;
    for (let j = 0; j <= th + 1; j++) {
      const R2 = rr - j, c = j === 0 ? S(p.R, 0.85) : j === th + 1 ? S(p.R, 0.62) : j === 1 ? S(p.R, 0.33) : S(p.R, 0);
      if (R2 < 1) break;
      P.ellipse(cx, cy, R2, R2 * fl, (q) => (j === 0 && hash(Math.floor(q * 7 + fr), fr >> 1, p.seed) < 0.3 ? null : { c, a }), j === 0 || j === th + 1 ? 2 : 1);
    }
  },
  /** The pupil: a black point at the body that the light falls into, ringed pale, for the first frames. */
  umPupil(v, P, p) {
    const fr = Math.floor(p.age * 12); if (fr > 3) return;
    const [x, y] = v.ap(p.x, p.y, p.z), r = p.r * [0.6, 1, 0.8, 0.45][fr];
    P.shade(x - r - 2, y - r - 2, x + r + 2, y + r + 2, (px, py) => {
      const d = Math.hypot(px - x, py - y);
      return d > r + 1.2 ? null : d > r ? S(p.R, fr < 2 ? 1 : 0.85) : S(p.R, 0);
    }, 2);
  },
});

const kindOf = (M) => (M.material === "unholy" ? "unholy" : M.material === "shadow" ? "shadow" : "void");

/** Dark smoke: translucent, low in the ramp, lit only at the cap. */
const murk = (s, R, extra) => ({ k: "flHaze", R, tone: 0.33, toneEnd: 0.17, a: 0.72, grow: 0.7, seed: sd(s), lump: 0.32, ...extra });

/** A mote spiralling inward to (cx, cy) over its life. */
function spiralIn(p, s, dt) {
  const u = clamp(p.age / p.life), d = p.d0 * (1 - u * u), a = p.a0 + p.w * u;
  p.vx = p.x; p.vy = p.y;
  p.x = p.cx + Math.cos(a) * d; p.y = p.cy + Math.sin(a) * d * 0.8; p.z = p.cz + (p.z0 - p.cz) * (1 - u);
  p.vx = (p.x - p.vx) / Math.max(dt, 1e-4); p.vy = (p.y - p.vy) / Math.max(dt, 1e-4); p.vz = 0;
}

/*
 * `sub`: one of many eruptions across an area (area.mjs). Lighter: no ground
 * decal (the area's scar is areaFX's), no extra rings, no hero beats.
 */

function voidBurst(s, M, { x, y, z, pow, rad, sub }) {
  const R = M.R, m = s.m * pow, mm = Math.min(1.7, m), n = counter(s, pow, rad), zz = Math.max(0.15, z);
  if (sub) subFlash(s, M, x, y, z, pow, rad); else releaseFlash(s, M, x, y, z, pow, rad);
  // light pulled inward: streaks and motes spiralling into the core
  const L = sub ? rad * 1.1 + 0.4 : rad * 1.6 + 0.9;
  for (let i = 0, N = sub ? n(6) : n(18); i < N; i++) {
    const q = s.rand(0, TAU), px = x + Math.cos(q) * L, py = y + Math.sin(q) * L, pz = zz + s.rand(-0.3, 0.6), life = s.rand(0.24, 0.32), tq = q + Math.PI / 2;
    s.add({ k: "streak", x: px, y: py, z: pz, vx: (x - px) / life + Math.cos(tq) * 1.6, vy: (y - py) / life + Math.sin(tq) * 1.6, vz: (zz - pz) / life, life, R, minor: i % 3 === 2, update(p, _s, dt) { p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; } });
  }
  if (!sub) for (let i = 0, N = n(14); i < N; i++) s.add({ k: "mote", x, y, z: zz, cx: x, cy: y, cz: zz, z0: zz + s.rand(-0.2, 0.7), d0: s.rand(0.7, 1.2) * L, a0: s.rand(0, TAU), w: s.rand(2.5, 4.5), life: s.rand(0.4, 0.75), R, plus: s.R() < 0.3, minor: i % 2 === 1, update: spiralIn });
  s.add({ k: "core", x, y, z: zz, life: sub ? 0.6 : 0.95, r: (rad * 0.45 + 0.3) * s.spec.aps * 0.6 * Math.min(1.5, mm) * (sub ? 0.7 : 1), R, seed: sd(s), update: still });
  if (!sub) {
    s.add({ k: "umStar", x, y, z: zz, L: (9 + rad * 7) * Math.min(1.4, mm), q: s.rand(0, 1), life: 4 / 12, R, wait: 0.05, update: still });
    s.add({ k: "darkpool", x, y, r: rad * 1.7 + 0.6, life: 2.6, R, debris: true, update: still });
  }
  // the core gives: shards, wisps and dark smoke thrown out, a ring of it rolling over the floor
  s.at(s.t + (sub ? 0.2 : 0.32), (s2) => {
    for (let i = 0, N = sub ? n(3) : n(12); i < N; i++) s2.add(shard(s2, R, x, y, zz, s2.rand(3, 8), { minor: sub || i % 2 === 1 }));
    for (let i = 0, N = n(sub ? 6 : 16); i < N; i++) s2.add({ k: "wisp", x, y, z: zz, ...out(s2, s2.rand(1, 3)), drag: 2.2, g: -0.4, life: s2.rand(0.8, 1.5), s: s2.R() < 0.5 ? 2 : 3, R, minor: sub || i % 3 === 2 });
    if (!sub) {
      for (let i = 0, N = n(6); i < N; i++) { const a = (i / N) * TAU + s2.rand(-0.3, 0.3), sp = s2.rand(1.5, 3.5); s2.add(murk(s2, R, { x: x + Math.cos(a) * 0.2, y: y + Math.sin(a) * 0.2, z: zz * 0.5, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.8, vz: s2.rand(0.1, 0.5), g: -0.1, drag: 2, r: s2.rand(6, 9) * Math.min(1.4, mm), life: s2.rand(1.4, 2.2), minor: i % 2 === 1 })); }
      for (let i = 0, N = n(14); i < N; i++) s2.add({ k: "spark", x, y, z: zz, ...flat(s2, s2.rand(4, 9), 0.7), g: 10, drag: 2.4, life: s2.rand(0.2, 0.45), R, minor: i % 3 !== 0 });
      if (pow >= 0.5) s2.add({ k: "ring", x, y, r: rad * 1.5 + 0.6, life: 0.55, R, broken: true, seed: 7, update: still });
      s2.add({ k: "flBand", x, y, r: rad * 1.6 + 1.4 * Math.min(1.3, mm), life: 0.5, R, dust: R, th: 2 + rad * 2, update: still });
    }
  });
  flourish(s, M, x, y, z, rad, Math.round(6 * m));
}

function unholyBurst(s, M, { x, y, z, pow, rad, sub }) {
  const R = M.R, m = s.m * pow, mm = Math.min(1.7, m), n = counter(s, pow, rad), zz = Math.max(0.15, z);
  if (sub) subFlash(s, M, x, y, z, pow, rad); else releaseFlash(s, M, x, y, z, pow, rad);
  if (!sub) {
    s.add({ k: "core", x, y, z: zz, life: 0.6, r: (rad * 0.35 + 0.22) * s.spec.aps * 0.6 * Math.min(1.5, mm), R, seed: sd(s), update: still });
    s.add({ k: "umStar", x, y, z: zz, L: (7 + rad * 5) * Math.min(1.4, mm), q: Math.PI / 4, life: 3 / 12, R, update: still });
  }
  if (pow >= 0.5 && !sub) s.add({ k: "umbSigil", x, y, r: rad * 1.3 + 0.55, life: 2.6, R, seed: sd(s), debris: true, update: still });
  // thorns punch up through the sigil in a wave, sharpest at the centre
  const N = sub ? 2 : pow >= 0.5 ? Math.round((5 + rad * 6) * Math.min(1.4, mm)) : 3;
  for (let i = 0; i < N; i++) {
    const a = s.rand(0, TAU), d = Math.sqrt(s.R()) * (rad * 1.1 + 0.25);
    s.add({ k: "crystal", x: x + Math.cos(a) * d, y: y + Math.sin(a) * d, z: 0, h: s.rand(11, 22) * Math.min(1.4, mm) * (1 - (d / (rad + 0.8)) * 0.4), w: s.rand(1.5, 2.8), lean: Math.cos(a) * s.rand(1, 5), life: s.rand(1.2, 1.8), R, wait: 0.05 + d * 0.1, debris: true, minor: i > 8 && i % 2 === 1, update: still });
  }
  for (let i = 0; i < n(sub ? 4 : 12); i++) s.add(shard(s, R, x, y, zz, s.rand(3, 7), { minor: sub || i % 2 === 1 }));
  for (let i = 0; i < n(sub ? 4 : 16); i++) s.add({ k: "spark", x, y, z: zz, ...flat(s, s.rand(4, 10), 0.8), g: 14, drag: 2.2, bounce: 0.4, life: s.rand(0.2, 0.5), R, minor: sub || i % 3 !== 0 });
  for (let i = 0; i < n(sub ? 2 : 6); i++) s.add(murk(s, R, { x: x + s.rand(-0.5, 0.5) * rad, y: y + s.rand(-0.4, 0.4) * rad, z: zz + s.rand(0, 0.4), vx: s.rand(-0.6, 0.6), vy: s.rand(-0.6, 0.2), vz: s.rand(0.4, 0.9), g: -0.2, drag: 1.6, r: s.rand(4.5, 7.5) * Math.min(1.4, m), life: s.rand(1.3, 2), tone: 0.17, toneEnd: 0.08, a: 0.75, wait: s.rand(0.1, 0.3), minor: sub }));
  if (!sub) {
    for (let i = 0, N2 = n(10); i < N2; i++) s.add({ k: "ember", x: x + s.rand(-0.5, 0.5) * rad, y: y + s.rand(-0.5, 0.5) * rad, z: zz, ...flat(s, s.rand(1, 3), 0.9), g: -0.6, drag: 1.6, life: s.rand(1.2, 2.2), R, seed: sd(s), update: emberUpd, minor: i % 2 === 1 });
    s.add({ k: "flBand", x, y, r: rad * 1.6 + 1.4 * Math.min(1.3, mm), life: 0.45, R, dust: R, th: 2 + rad * 2, update: still });
    s.light(x, y, 0.1, rad * 1.6 + 1, S(R, 0.67), 0.3, 2.2, { flicker: true });
  }
  flourish(s, M, x, y, z, rad, Math.round(6 * m));
}

function shadowBurst(s, M, { x, y, z, pow, rad, sub }) {
  const R = M.R, m = s.m * pow, mm = Math.min(1.7, m), n = counter(s, pow, rad);
  // no hero flash: shadow arrives, it does not explode
  s.light(x, y, z, rad * 2.4 + 1.2, S(R, 0.85), 0.35 * mm, 1.1);
  if (pow > 1.2 && !sub) s.crit();
  const nc = n(sub ? 3 : 10);
  for (let i = 0; i < nc; i++) {
    const q = (i / nc) * TAU + s.rand(-0.3, 0.3), sp = s.rand(0.8, 2.2) * (0.6 + rad * 0.4);
    s.add(murk(s, R, { x: x + Math.cos(q) * 0.1, y: y + Math.sin(q) * 0.1, z: Math.max(0.1, z * s.rand(0.3, 1)), vx: Math.cos(q) * sp, vy: Math.sin(q) * sp * 0.8, vz: s.rand(-0.1, 0.25), drag: 2, g: 0.05, r: s.rand(6, 10) * Math.min(1.4, mm) * (sub ? 0.75 : 1), life: s.rand(1.5, 2.4), tone: s.R() < 0.5 ? 0.33 : 0.5, toneEnd: 0.17, a: 0.78, wait: s.rand(0, 0.12), minor: i > 6 && i % 2 === 1 }));
  }
  if (!sub) {
    s.add({ k: "darkpool", x, y, r: rad * 1.7 + 0.5, life: 3, R, debris: true, update: still });
    // tendrils lash up out of the pool's edge, one after another
    for (let i = 0, N = Math.round(4 + rad * 4); i < N; i++) {
      const a = (i / N) * TAU + s.rand(-0.3, 0.3), d = s.rand(0.4, 1) * (rad * 1.3 + 0.4);
      s.add({ k: "umTendril", x: x + Math.cos(a) * d, y: y + Math.sin(a) * d, z: 0, h: s.rand(14, 26) * Math.min(1.4, mm), w: s.rand(1.2, 2.2), amp: s.rand(2, 4), life: s.rand(0.8, 1.3), R, seed: sd(s) % 100, wait: s.rand(0.05, 0.6), minor: i % 3 === 2, update: still });
    }
    // a floor ring of murk rolling out
    for (let i = 0, N = n(6); i < N; i++) { const a = (i / N) * TAU + s.rand(-0.3, 0.3), sp = s.rand(2, 4); s.add(murk(s, R, { x, y, z: 0.04, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vz: 0.05, drag: 2.6, r: s.rand(5, 7.5) * Math.min(1.3, mm), life: s.rand(1.2, 1.8), tone: 0.17, toneEnd: 0.08, a: 0.7, minor: i % 2 === 1 })); }
    if (pow >= 0.5) s.add({ k: "ring", x, y, r: rad * 1.5 + 0.5, life: 0.8, R, broken: true, seed: sd(s), update: still });
  }
  for (let i = 0; i < n(sub ? 3 : 10); i++) s.add({ k: "wisp", x: x + s.rand(-1, 1) * rad * 0.7, y: y + s.rand(-1, 1) * rad * 0.6, z: 0.05, vz: s.rand(0.3, 0.8), vx: s.rand(-0.5, 0.5), g: -0.1, drag: 1.5, life: s.rand(0.9, 1.5), s: 2, R, wait: s.rand(0.2, 0.6), minor: sub || i % 2 === 1 });
  flourish(s, M, x, y, z, rad, Math.round(6 * m));
}

export default {
  id: "umbra",
  dark: true,
  burst(s, M, o) {
    const k = kindOf(M);
    if (k === "unholy") unholyBurst(s, M, o); else if (k === "shadow") shadowBurst(s, M, o); else voidBurst(s, M, o);
  },
  trail(s, M, { x, y, z, dt }) {
    const k = kindOf(M), R = M.R;
    if (k === "shadow") {
      for (let i = s.count(26 * s.m, dt); i > 0; i--) s.add(murk(s, R, { x, y, z, vx: s.rand(-0.3, 0.3), vy: s.rand(-0.3, 0.3), vz: s.rand(0, 0.2), drag: 2.5, r: s.rand(2.4, 3.8), life: s.rand(0.5, 0.8), minor: i % 2 === 0 }));
      return;
    }
    for (let i = s.count(46 * s.m, dt); i > 0; i--) s.add({ k: "wisp", x, y, z, vx: s.rand(-0.4, 0.4), vy: s.rand(-0.4, 0.4), g: -0.4, drag: 2, life: s.rand(0.4, 0.65), s: s.R() < 0.7 ? 2 : 3, R, minor: i % 2 === 0 });
    for (let i = s.count(8 * s.m, dt); i > 0; i--) s.add(murk(s, R, { x, y, z, vz: 0.1, drag: 2.5, r: s.rand(2, 3.2), life: s.rand(0.5, 0.7), minor: true }));
    if (k === "unholy") for (let i = s.count(14 * s.m, dt); i > 0; i--) s.add({ k: "spark", x, y, z, vx: s.rand(-1.5, 1.5), vy: s.rand(-1.5, 1.5), vz: s.rand(0, 1.5), g: 6, drag: 1, life: s.rand(0.2, 0.35), R, minor: true });
    else for (let i = s.count(10 * s.m, dt); i > 0; i--) s.add({ k: "mote", x: x + s.rand(-0.15, 0.15), y: y + s.rand(-0.15, 0.15), z, vx: s.rand(-0.3, 0.3), vy: s.rand(-0.3, 0.3), drag: 2, life: s.rand(0.4, 0.7), R, minor: true });
  },
  linger(s, M, { at }) {
    const k = kindOf(M), R = M.R;
    if (k === "shadow") {
      at(2.8, () => murk(s, R, { z: 0.15, vz: 0.12, vx: s.rand(-0.3, 0.3), drag: 1.5, r: s.rand(5, 7.5), life: s.rand(1.5, 2.1) }));
      at(1.4, () => ({ k: "umTendril", z: 0, h: s.rand(10, 18), w: 1.4, amp: s.rand(2, 3.5), life: s.rand(0.8, 1.2), seed: sd(s) % 100, update: still }));
      return;
    }
    at(8, () => ({ k: "wisp", vz: s.rand(0.3, 0.7), g: -0.3, drag: 1.5, life: s.rand(0.9, 1.4), s: 2 }));
    at(1.2, () => murk(s, R, { z: 0.1, vz: 0.25, drag: 1.5, r: s.rand(4, 6), life: s.rand(1.2, 1.7), minor: true }));
    if (k === "unholy") {
      at(1.6, () => ({ k: "crystal", z: 0, h: s.rand(7, 12), w: 1.6, lean: s.rand(-2, 2), life: 1.3, debris: true, update: still }));
      at(3, () => ({ k: "ember", z: 0.1, vz: s.rand(0.5, 1.2), g: -0.4, drag: 1.2, life: s.rand(0.9, 1.5), seed: sd(s), update: emberUpd, minor: true }));
    } else at(4, () => ({ k: "mote", z: s.rand(0.1, 0.6), vz: s.rand(0.1, 0.4), drag: 2, life: s.rand(0.6, 1.1), plus: s.R() < 0.25, minor: true }));
  },
  spray(s, M, { emit }) {
    const k = kindOf(M), R = M.R;
    if (k === "shadow") {
      emit("flHaze", 44, () => ({ drag: 1.8, life: s.rand(0.9, 1.3), r: s.rand(4, 6.5), tone: 0.33, toneEnd: 0.17, a: 0.72, grow: 0.9, seed: sd(s), lump: 0.32 }));
      emit("wisp", 20, () => ({ drag: 1.6, g: -0.2, life: 0.7, s: 2, minor: true }));
      return;
    }
    emit("wisp", 80, () => ({ drag: 1.6, g: -0.2, life: s.rand(0.6, 0.85), s: s.R() < 0.7 ? 2 : 3 }));
    emit("flHaze", 12, () => ({ drag: 1.8, life: s.rand(0.8, 1.2), r: s.rand(3.5, 5.5), tone: 0.33, toneEnd: 0.17, a: 0.65, grow: 0.9, seed: sd(s), minor: true }));
    if (k === "unholy") {
      emit("frShard", 28, () => ({ drag: 1.4, g: 3, life: s.rand(0.5, 0.7), a: s.rand(0, TAU), va: s.rand(-20, 20), L: 2 + Math.floor(s.R() * 3) }));
      emit("spark", 24, () => ({ drag: 1.6, g: 4, life: s.rand(0.3, 0.5), minor: true }));
    } else emit("mote", 20, () => ({ drag: 2, life: s.rand(0.5, 0.8), minor: true }));
  },
  aura(s, M, { at }) {
    const k = kindOf(M), R = M.R;
    if (k === "shadow") {
      at(2.2, () => murk(s, R, { vz: 0.15, drag: 1.5, r: s.rand(3, 4.5), life: s.rand(1.2, 1.6) }));
      at(0.9, () => ({ k: "umTendril", z: 0, h: s.rand(8, 14), w: 1.2, amp: 2, life: s.rand(0.8, 1.1), seed: sd(s) % 100, update: still }), false);
      return;
    }
    at(11, () => ({ k: "wisp", vz: s.rand(0.3, 0.6), g: -0.3, drag: 1.5, life: s.rand(0.8, 1.2), s: s.R() < 0.5 ? 2 : 3 }));
    at(0.8, () => murk(s, R, { vz: 0.2, drag: 1.5, r: s.rand(2.5, 3.5), life: 1.2, minor: true }));
    if (k === "unholy") at(2, () => ({ k: "ember", vz: s.rand(0.5, 1), g: -0.4, drag: 1.2, life: s.rand(0.8, 1.2), seed: sd(s), update: emberUpd, minor: true }));
  },
  /**
   * The void pulse (spellsprite-craft §5 shadow/void-orb, shadow/life-steal):
   * light and motes are dragged into the body for the drawn-in beat, a black
   * pupil opens there with a black star across it, then the dark rolls out in
   * bands to well past the creature while the floor darkens under it and
   * shards and wisps are thrown out. Unholy punches crimson thorns up round it,
   * shadow lashes tendrils up out of the pool. Harm on the living plays this.
   */
  bloom(s, M, B) {
    const R = M.R, k = kindOf(M), aps = s.spec.aps, { x, y, z, r, sz } = B, rs = r / aps;
    s.at(B.at, (s2) => {
      const L = rs * 1.8 + 0.4;
      for (let i = 0; i < 14; i++) {
        const q = (i / 14) * TAU + s2.rand(-0.2, 0.2), px = x + Math.cos(q) * L, py = y + Math.sin(q) * L * 0.75, pz = z + s2.rand(-0.3, 0.5), life = s2.rand(0.15, 0.19), tq = q + Math.PI / 2;
        s2.add({ k: "streak", x: px, y: py, z: pz, vx: (x - px) / life + Math.cos(tq) * 2, vy: (y - py) / life + Math.sin(tq) * 2, vz: (z - pz) / life, life, R, minor: i % 2 === 1, update(p, _s, dt) { p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; } });
      }
      for (let i = 0; i < 8; i++) s2.add({ k: "mote", x, y, z, cx: x, cy: y, cz: z, z0: z + s2.rand(-0.2, 0.6), d0: s2.rand(0.8, 1.2) * L, a0: s2.rand(0, TAU), w: s2.rand(2.5, 4), life: s2.rand(0.17, 0.24), R, plus: i % 3 === 0, minor: i > 3, update: spiralIn });
      s2.light(x, y, 0.1, L + 0.5, S(R, 0.75), 0.3, 0.2, { swell: true });
    });
    s.at(B.b, (s2) => {
      s2.add({ k: "umPupil", x, y, z, r: Math.max(3, r * 0.2), life: 0.34, R, update: still });
      s2.add({ k: "umStar", x, y, z, L: r * 0.85, q: s2.rand(0, 1), life: 4 / 12, R, wait: 1 / 12, update: still });
      const n = B.saved ? 2 : B.crit ? 4 : 3;
      for (let i = 0; i < n; i++) s2.add({ k: "umPulse", x, y, z: z * (1 - i * 0.25), r0: r * 0.25, r: r * (1.45 + i * 0.28), th: (B.saved ? 3 : 5) * Math.min(1.3, B.k) - i, life: 0.55 + i * 0.1, R, seed: sd(s2), wait: 1 / 12 + i * 0.09, update: still });
      s2.add({ k: "darkpool", x, y, r: rs * 1.25 + 0.3, life: 2.2, R, debris: true, update: still });
      s2.add({ k: "flBand", x, y, r: rs * 1.8 + 0.4, life: 0.5, R, dust: R, th: 3, wait: 0.06, update: still });
      s2.light(x, y, 0.1, rs * 2.4 + 0.8, S(R, 0.67), 0.35 * B.k, 1.4, { flicker: true });
      if (B.crit) s2.crit();
    });
    s.at(B.b + 0.12, (s2) => {
      for (let i = 0, N = Math.round(8 * B.k); i < N; i++) s2.add(shard(s2, R, x, y, z, s2.rand(3, 7) * B.k, { minor: i > 3 }));
      for (let i = 0, N = Math.round(12 * B.k); i < N; i++) s2.add({ k: "wisp", x, y, z, ...out(s2, s2.rand(1.2, 3) * B.k), drag: 2.2, g: -0.4, life: s2.rand(0.8, 1.4), s: i % 2 ? 2 : 3, R, minor: i > 4 });
      for (let i = 0, N = B.saved ? 2 : 4; i < N; i++) { const a = (i / N) * TAU + s2.rand(-0.4, 0.4), sp = s2.rand(1.2, 2.4); s2.add(murk(s2, R, { x, y, z: z * 0.6, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.8, vz: s2.rand(0.1, 0.4), g: -0.1, drag: 2, r: s2.rand(5, 7) * sz, life: s2.rand(1.1, 1.6), minor: i > 1 })); }
      if (k === "unholy") for (let i = 0, N = B.saved ? 3 : Math.round(6 * B.k); i < N; i++) {
        const a = (i / N) * TAU + s2.rand(-0.3, 0.3), d = rs * s2.rand(0.75, 1.15) + 0.15;
        s2.add({ k: "crystal", x: x + Math.cos(a) * d, y: y + Math.sin(a) * d, z: 0, h: s2.rand(12, 20) * B.k * sz, w: s2.rand(1.6, 2.6), lean: Math.cos(a) * s2.rand(2, 5), life: s2.rand(1, 1.4), R, wait: i * 0.025, debris: true, minor: i > 3, update: still });
      } else if (k === "shadow") for (let i = 0, N = B.saved ? 2 : Math.round(5 * B.k); i < N; i++) {
        const a = (i / N) * TAU + s2.rand(-0.3, 0.3), d = rs * s2.rand(0.6, 1.1) + 0.15;
        s2.add({ k: "umTendril", x: x + Math.cos(a) * d, y: y + Math.sin(a) * d, z: 0, h: s2.rand(16, 26) * B.k * sz, w: s2.rand(1.4, 2.2), amp: s2.rand(2, 4), life: s2.rand(0.8, 1.2), R, seed: sd(s2) % 100, wait: i * 0.05, minor: i > 2, update: still });
      }
    });
  },
  auraStart(s, M, T) {
    if (kindOf(M) === "unholy") s.add({ k: "umbSigil", x: T.x, y: T.y, r: 0.6 * T.size, life: 1e9, R: M.R, seed: 3, update: still });
  },
};
