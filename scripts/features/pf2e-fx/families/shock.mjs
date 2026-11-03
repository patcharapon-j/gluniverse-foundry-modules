/**
 * Shock: force, sonic, air.
 *
 * Force: a faceted shell that snaps outward, a star, shards flung flat.
 * Sonic: concentric shells pulsing out in bright and dim bands, rings racing
 * along the floor, radiating streaks; a cone or line is sound arcs rolling
 * away from the hand.
 * Air: a vortex of spiral swirls that climbs, gusts that curl as they fly, a
 * pale dust ring kicked up off the floor. No core and no star.
 */

import { TAU, clamp, easeOut, q12, fadeOut } from "../core/rand.mjs";
import { S } from "../core/palette.mjs";
import { physics } from "../core/sim.mjs";
import { registerShapes } from "../core/shapes.mjs";
import { out, still, releaseFlash, counter, flourish } from "../core/motifs.mjs";

/* ── force (unchanged) ────────────────────────────────────────────────── */

const force = {
  burst(s, M, { x, y, z, pow, rad }) {
    const R = M.R, m = s.m * pow, mm = Math.min(1.6, m), n = counter(s, pow, rad);
    releaseFlash(s, M, x, y, z, pow, rad);
    s.add({ k: "octa", x, y, z, life: 0.4, r: (rad * 0.6 + 0.4) * s.spec.aps * 0.6 * Math.min(1.5, m), R, update: still });
    s.add({ k: "star", x, y, z, L: 4 * mm, life: 3 / 12, R, update: still });
    for (let i = 0; i < n(14); i++) s.add({ k: "shard", x, y, z, ...out(s, s.rand(3, 6)), drag: 5, life: s.rand(0.4, 0.7), R, seed: s.R() });
    flourish(s, M, x, y, z, rad, Math.round(5 * m));
  },
  trail(s, M, { x, y, z, dt }) {
    for (let i = s.count(24 * s.m, dt); i > 0; i--) s.add({ k: "shard", x, y, z, vx: s.rand(-0.6, 0.6), vy: s.rand(-0.6, 0.6), drag: 5, life: 0.3, R: M.R, seed: s.R() });
  },
  linger(s, M, { at }) {
    at(3, () => ({ k: "glint", z: s.rand(0.1, 0.8), life: 5 / 12, update: still }));
  },
  spray(s, M, { emit }) {
    emit("shard", 60, () => ({ drag: 1.2, life: 0.55, seed: s.R() }));
  },
  auraStart(s, M, T) {
    for (let i = 0; i < 3; i++) s.add({ k: "shard", x: T.x, y: T.y, z: 0.6, life: 1e9, R: M.R, seed: i * 0.3, ph: (i * TAU) / 3, update(p, _s, dt) { p.ph += dt * 2.2; p.x = T.x + Math.cos(p.ph) * 0.5 * T.size; p.y = T.y + Math.sin(p.ph) * 0.5 * T.size; p.z = 0.6 + Math.sin(p.ph * 2) * 0.15; } });
  },
  aura(s, M, { at }) {
    at(2, () => ({ k: "glint", life: 5 / 12, update: still }));
  },
};

/* ── shared ───────────────────────────────────────────────────────────── */

/** Which way a travelling head is going, matched against last step's heads (several projectiles may fly at once). */
function heading(s, x, y, z) {
  const list = (s.shockHeads ??= []);
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

/** The half-width (squares) a spray covers at distance d: a cone widens, a line does not. */
function spanAt(half, len, d) {
  const cone = half > Math.PI / 4 - 0.01, hw = cone ? Infinity : Math.tan(half / 0.6) * len;
  return Math.max(Math.min(half * 0.92, Math.atan2(hw, d)), Math.atan2(0.4, Math.max(d, 0.01)));
}

/** A gust's flight: its velocity turns at `p.turn` rad/s, then ordinary physics. */
function curve(p, s, dt) {
  const c = Math.cos(p.turn * dt), sn = Math.sin(p.turn * dt), vx = p.vx;
  p.vx = vx * c - p.vy * sn; p.vy = vx * sn + p.vy * c;
  physics(p, dt, s);
}

/* ── sonic ────────────────────────────────────────────────────────────── */

const sonic = {
  burst(s, M, { x, y, z, pow, rad, sub }) {
    const R = M.R, m = s.m * pow, mm = Math.min(1.6, m), n = counter(s, pow, rad), aps = s.spec.aps;
    releaseFlash(s, M, x, y, z, pow, rad);
    // an area eruption is a single pulse: one shell, one ring, a few streaks
    if (!sub) s.add({ k: "star", x, y, z, L: 2.5 * mm, life: 2 / 12, R, update: still });
    const N = sub ? 1 : s.take === 1 ? 4 : 3;
    for (let i = 0; i < N; i++) s.add({ k: "soundshell", x, y, z, r: (rad * 0.7 + 0.45) * aps * Math.min(1.4, mm) * (1 - i * 0.12) * (sub ? s.rand(0.8, 1.1) : 1), life: 0.5 - i * 0.04, wait: i * 0.09, R, thin: sub, update: still });
    for (let i = 0; i < (sub ? 1 : 3); i++) s.add({ k: "ring", x, y, r: rad * (0.95 + i * 0.22) + 0.3, life: 0.55, wait: 0.04 + i * 0.1, R, update: still });
    for (let i = 0, M2 = sub ? n(5) : n(12); i < M2; i++) {
      const q = (i / M2) * TAU + s.rand(-0.15, 0.15), sp = s.rand(6, 9);
      s.add({ k: "streak", x, y, z: z + s.rand(-0.1, 0.2), vx: Math.cos(q) * sp, vy: Math.sin(q) * sp, vz: s.rand(-0.3, 0.6), drag: 3.5, life: s.rand(0.22, 0.32), R, wait: s.rand(0, 0.06), minor: i % 3 === 2 });
    }
    flourish(s, M, x, y, z, rad, Math.round(5 * m));
  },
  trail(s, M, { x, y, z, dt }) {
    for (let i = s.count(9 * s.m, dt); i > 0; i--) s.add({ k: "soundshell", x, y, z, r: s.rand(5, 7), life: 0.3, R: M.R, thin: true, update: still });
    for (let i = s.count(10 * s.m, dt); i > 0; i--) s.add({ k: "mote", x, y, z, vx: s.rand(-0.5, 0.5), vy: s.rand(-0.5, 0.5), vz: s.rand(-0.3, 0.3), drag: 3, life: 0.4, R: M.R, minor: true });
  },
  linger(s, M, { at }) {
    at(1.6, () => ({ k: "ring", r: s.rand(0.35, 0.6), life: 0.55, update: still }));
    at(1.2, () => ({ k: "soundshell", z: s.rand(0.2, 0.6), r: s.rand(6, 9), life: 0.4, thin: true, update: still }));
  },
  spray(s, M, { emit, hand, dir, half, len, dt }) {
    // sound arcs rolling out from the hand, widening with the cone (or holding the line's width)
    for (let i = s.count(7 * s.m, dt); i > 0; i--) {
      s.add({ k: "soundarc", x: hand[0], y: hand[1], z: Math.max(0.3, hand[2] - 0.2), ox: hand[0], oy: hand[1], dir, half, len, d: 0.15, sp: s.rand(6.5, 8) * (len / 6), life: 0.75, R: M.R,
        update(p, _s, dt2) { p.d += p.sp * dt2; p.x = p.ox + Math.cos(p.dir) * p.d; p.y = p.oy + Math.sin(p.dir) * p.d; p.z = Math.max(0.15, p.z - 0.2 * dt2); } });
    }
    emit("streak", 30, () => ({ drag: 1.5, life: 0.35, vz: s.rand(-0.2, 0.2), minor: true }));
  },
  auraStart() {},
  aura(s, M, { T, dt }) {
    if (s.R() < 1.3 * s.m * dt) s.add({ k: "soundshell", x: T.x, y: T.y, z: 0.85 * T.h, r: s.rand(6, 9) * Math.min(1.4, T.size), life: 0.45, R: M.R, thin: true, update: still });
  },
  tick(s, M, T) {
    s.add({ k: "soundshell", x: T.x, y: T.y, z: 0.5 * T.h, r: 12 * Math.min(1.5, T.size), life: 0.45, R: M.R, update: still });
  },
};

/* ── air ──────────────────────────────────────────────────────────────── */

/** Kicked-up dust: drawn with corrode's see-through `toxcloud` in the air ramp, so it reads as haze, not stones. */
const DUST = [[0, 0, 1], [0.6, 0.2, 0.6]];

/** A gust flung outward in a random direction; `at` (when given) is where it starts. */
const gustOut = (s, at, sp, extra) => {
  const q = s.rand(0, TAU);
  return { k: "gust", ...at, vx: Math.cos(q) * sp, vy: Math.sin(q) * sp, vz: s.rand(-0.1, 0.4), turn: (s.R() < 0.5 ? 1 : -1) * s.rand(2.5, 4.5), drag: 2, life: s.rand(0.5, 0.75), len: s.rand(0.7, 1), seed: s.seedInt(), update: curve, ...extra };
};

const air = {
  burst(s, M, { x, y, z, pow, rad, sub }) {
    const R = M.R, m = s.m * pow, mm = Math.min(1.6, m), n = counter(s, pow, rad), z0 = z > 0.3 ? z * 0.6 : 0.1;
    releaseFlash(s, M, x, y, z, pow, rad);
    // an area's eruptions are small whirls; the full vortex and its dust ring are the release's alone
    const spin = s.R() < 0.5 ? 1 : -1, H = sub ? 2 : s.take === 2 ? 5 : 4;
    for (let i = 0; i < H; i++) s.add({ k: "windswirl", x, y, z: z0 + i * 0.32 * (0.7 + rad * 0.3), vz: 0.5, drag: 1, r: (5 + i * 2.6) * mm * (0.7 + rad * 0.25), life: s.rand(0.8, 1.05), spin, R, wait: i * 0.05, seed: s.seedInt(), update(p, _s, dt) { p.z += p.vz * dt; } });
    for (let i = 0; i < (sub ? Math.min(3, n(7)) : n(7)); i++) s.add(gustOut(s, { x, y, z: z0 + s.rand(0, 0.6) }, s.rand(4, 6.5), { R, turn: spin * s.rand(2.5, 4.5), wait: s.rand(0, 0.12) }));
    for (let i = 0, N = sub ? 0 : n(8); i < N; i++) {
      const q = (i / N) * TAU + s.rand(-0.2, 0.2), d = rad * 0.55;
      s.add({ k: "toxcloud", x: x + Math.cos(q) * d, y: y + Math.sin(q) * d, z: 0.05, vx: Math.cos(q) * 2.4, vy: Math.sin(q) * 2.4, vz: 0.15, drag: 2.4, r: s.rand(3.5, 5), life: s.rand(0.6, 0.9), lobes: DUST, seed: s.seedInt(), spin, R, wait: s.rand(0.03, 0.1), minor: true });
    }
    if (pow >= 0.5) s.add({ k: "ring", x, y, r: rad * 1.05 + 0.3, life: 0.7, R, broken: true, seed: s.seedInt(), wait: 0.08, update: still });
    flourish(s, M, x, y, z, rad, Math.round(5 * m));
  },
  trail(s, M, { x, y, z, dt }) {
    const d = heading(s, x, y, z) ?? [1, 0, 0];
    for (let i = s.count(16 * s.m, dt); i > 0; i--) {
      const sp = s.rand(1, 2);
      s.add({ k: "gust", x: x + s.rand(-0.08, 0.08), y: y + s.rand(-0.08, 0.08), z: z + s.rand(-0.08, 0.08), vx: -d[0] * sp, vy: -d[1] * sp, vz: -d[2] * sp + s.rand(-0.2, 0.2), turn: s.rand(-3, 3), drag: 2, life: s.rand(0.3, 0.45), len: s.rand(0.3, 0.45), seed: s.seedInt(), R: M.R, update: curve });
    }
    for (let i = s.count(4 * s.m, dt); i > 0; i--) s.add({ k: "windswirl", x, y, z, r: s.rand(3, 4.5), life: 0.35, spin: 1, R: M.R, seed: s.seedInt(), minor: true, update: still });
  },
  linger(s, M, { at }) {
    at(1.4, () => gustOut(s, null, s.rand(1.5, 2.5), { z: s.rand(0.05, 0.4), drag: 1, life: s.rand(0.6, 0.9) }));
    at(0.6, () => ({ k: "windswirl", z: 0.1, vz: 0.4, r: s.rand(4, 6), life: 0.8, spin: s.R() < 0.5 ? 1 : -1, seed: s.seedInt(), update(p, _s, dt) { p.z += p.vz * dt; } }));
  },
  spray(s, M, { emit }) {
    emit("gust", 42, () => ({ drag: 0.9, life: s.rand(0.55, 0.75), len: s.rand(0.45, 0.7), turn: s.rand(-1.6, 1.6), seed: s.seedInt(), update: curve }));
    emit("toxcloud", 8, () => ({ drag: 1.8, life: 0.6, r: s.rand(3, 4.5), z: 0.1, vz: 0.1, lobes: DUST, seed: s.seedInt(), spin: 1, minor: true }));
  },
  auraStart() {},
  aura(s, M, { T, dt }) {
    for (let i = s.count(5 * s.m, dt); i > 0; i--) {
      const dirn = s.R() < 0.5 ? 1 : -1, rr = s.rand(0.35, 0.5) * T.size;
      s.add({ k: "gust", x: T.x, y: T.y, z: s.rand(0.1, 0.8) * T.h, vx: 0, vy: 0, vz: 0, ph: s.rand(0, TAU), w: dirn * s.rand(3.5, 5), rr, rise: s.rand(0.1, 0.35), life: s.rand(0.5, 0.8), len: s.rand(0.35, 0.55), seed: s.seedInt(), R: M.R,
        update(p, _s, dt2) { p.ph += p.w * dt2; p.x = T.x + Math.cos(p.ph) * p.rr; p.y = T.y + Math.sin(p.ph) * p.rr * 0.6; p.z += p.rise * dt2; p.vx = -Math.sin(p.ph) * p.w * p.rr; p.vy = Math.cos(p.ph) * p.w * p.rr * 0.6; p.vz = p.rise; } });
    }
  },
  tick(s, M, T) {
    s.add({ k: "windswirl", x: T.x, y: T.y, z: 0.45 * T.h, r: 9 * Math.min(1.5, T.size), life: 0.5, spin: 1, R: M.R, seed: s.seedInt(), update: still });
  },
};

/* ── the family ───────────────────────────────────────────────────────── */

const look = (M) => (M.material === "sonic" ? sonic : M.material === "air" ? air : force);
const pick = (name) => (s, M, ctx) => look(M)[name](s, M, ctx);

export default {
  id: "shock",
  burst: pick("burst"),
  trail: pick("trail"),
  linger: pick("linger"),
  spray: pick("spray"),
  auraStart(s, M, T) { look(M).auraStart(s, M, T); },
  aura: pick("aura"),
  tick(s, M, T) { look(M).tick?.(s, M, T); },
  gentle: true,
};

/* ── shapes ───────────────────────────────────────────────────────────── */

registerShapes({
  /** Concentric sound bands: a bright front, a dim band and a faint one behind it, broken by a travelling rhythm. */
  soundshell(v, P, p) {
    const u = clamp(q12(p.age) / p.life), fr = Math.floor(p.age * 12), [cx, cy] = v.ap(p.x, p.y, p.z);
    const rx = p.r * (0.25 + 0.75 * easeOut(u)), a = 1 - u * u, sq = v.kind === "top" ? 1 : 0.88, N = 18;
    if (rx < 1.5) { P.px(cx, cy, S(p.R, 1), 1); return; }
    const gap = (q, k) => (Math.floor((q / TAU) * N) + fr + k * 2) % 6 === 0;
    P.ellipse(cx, cy, rx, rx * sq, (q) => (gap(q, 0) ? null : { c: S(p.R, 0.95), a }), 1);
    if (rx > 4) P.ellipse(cx, cy, rx - 2, (rx - 2) * sq, (q) => (gap(q, 1) ? null : { c: S(p.R, 0.62), a }), 0);
    if (!p.thin && rx > 7) P.ellipse(cx, cy, rx - 4, (rx - 4) * sq, (q) => (gap(q, 2) ? null : { c: S(p.R, 0.83), a: a * 0.6 }), 0);
  },
  /** One sound arc rolling away from the hand: a bright crescent and a dim one behind it. */
  soundarc(v, P, p) {
    const u = clamp(p.age / p.life), a = fadeOut(u, 0.55), fr = Math.floor(p.age * 12);
    for (let k = 0; k < 2; k++) {
      const d = p.d - k * 0.14; if (d <= 0.05) continue;
      const span = spanAt(p.half, p.len, d), n = Math.max(6, Math.ceil(span * d * v.aps * 2.2));
      let lx = null, ly = null;
      for (let i = 0; i <= n; i++) {
        const t = -span + (2 * span * i) / n, q = p.dir + t, [x, y] = v.ap(p.ox + Math.cos(q) * d, p.oy + Math.sin(q) * d, p.z);
        const X = Math.floor(x), Y = Math.floor(y); if (X === lx && Y === ly) continue; lx = X; ly = Y;
        if (((i >> 2) + fr) % 7 === 0) continue;
        const edge = Math.abs(t) / span > 0.82;
        P.dot(X, Y, S(p.R, k ? 0.55 : edge ? 0.7 : 0.95), k ? a * 0.8 : a, k ? 0 : 1);
      }
    }
  },
  /** A wind line: a wavy streak trailing back along its flight with a curl hooked at the head. */
  gust(v, P, p) {
    const u = clamp(p.age / p.life), fr = Math.floor(p.age * 12), a = fadeOut(u, 0.6);
    const vl = Math.hypot(p.vx, p.vy, p.vz) || 1, L = (p.len ?? 0.5) * Math.min(1, 0.4 + u * 4) * (1 - 0.4 * u);
    const [hx, hy] = v.ap(p.x, p.y, p.z), [tx, ty] = v.ap(p.x - (p.vx / vl) * L, p.y - (p.vy / vl) * L, p.z - (p.vz / vl) * L);
    const dx = hx - tx, dy = hy - ty, sl = Math.hypot(dx, dy); if (sl < 1) { P.px(hx, hy, S(p.R, 0.95), 1); return; }
    const nx = -dy / sl, ny = dx / sl, n = Math.ceil(sl * 1.4), ph = (p.seed % 7) + fr * 0.9, amp = Math.min(1.2, sl * 0.07);
    let lx = null, ly = null;
    for (let i = 0; i <= n; i++) {
      const f = i / n, w = Math.sin(f * TAU * 0.8 + ph) * amp * (1 - f * 0.7);
      const X = Math.floor(tx + dx * f + nx * w), Y = Math.floor(ty + dy * f + ny * w); if (X === lx && Y === ly) continue; lx = X; ly = Y;
      if (f < 0.35) { if ((i + fr) & 1) P.dot(X, Y, S(p.R, 0.5), a * 0.8, 0); }
      else P.dot(X, Y, S(p.R, f > 0.72 ? 0.95 : 0.75), a, 1);
    }
    // the curl: three quarters of a small loop off the head, turning the way the gust turns (on about half of them)
    if (sl < 7 || p.seed % 2) return;
    const sg = (p.turn ?? 1) >= 0 ? 1 : -1, cr = sl > 16 ? 3 : 2, ccx = hx + nx * cr * sg, ccy = hy + ny * cr * sg, th0 = Math.atan2(-ny * sg, -nx * sg);
    for (let i = 1; i <= 8; i++) {
      const t = th0 + sg * (i / 8) * TAU * 0.72;
      P.dot(ccx + Math.cos(t) * cr, ccy + Math.sin(t) * cr, S(p.R, i < 6 ? 1 : 0.75), a, 1);
    }
  },
  /** A two-armed spiral turning at 12 fps: flat in top view, an oblique ellipse from the side. */
  windswirl(v, P, p) {
    const u = clamp(p.age / p.life), fr = Math.floor(p.age * 12), a = fadeOut(u, 0.55), [cx, cy] = v.ap(p.x, p.y, p.z);
    const rr = p.r * (0.5 + 0.5 * Math.min(1, u * 4)), sq = v.kind === "top" ? 1 : 0.42, rot = fr * 0.55 * (p.spin || 1) + (p.seed % 13);
    const n = Math.max(8, Math.ceil(rr * 3.2));
    for (let arm = 0; arm < 2; arm++) {
      let lx = null, ly = null;
      for (let i = 0; i <= n; i++) {
        const t = i / n, ang = rot + arm * Math.PI + (p.spin || 1) * t * TAU * 0.7, rad = rr * (0.2 + 0.8 * t);
        const X = Math.floor(cx + Math.cos(ang) * rad), Y = Math.floor(cy + Math.sin(ang) * rad * sq); if (X === lx && Y === ly) continue; lx = X; ly = Y;
        if (t < 0.3) { if (i & 1) P.dot(X, Y, S(p.R, 0.5), a * 0.8, 0); }
        else P.dot(X, Y, S(p.R, t > 0.72 ? 0.95 : 0.75), a, 1);
      }
    }
  },
});
