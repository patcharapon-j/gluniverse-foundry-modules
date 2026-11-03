/**
 * Earthwork: earth, metal.
 *
 * Earth: stone spikes burst out of a cracked crater, boulders with weight arc,
 * bounce and settle, dust rolls out low along the ground, grit trickles after.
 * Metal: a ringing clang, glinting shrapnel that tumbles and then lies still,
 * hot sparks off steel, iron filings snapped into field lines, thin blades.
 */

import { TAU, hash, pnoise, inPoly, rng, fadeOut } from "../core/rand.mjs";
import { RAMP, S, WHITE } from "../core/palette.mjs";
import { registerShapes } from "../core/shapes.mjs";
import { out, sd, lobes, still, releaseFlash, counter, flourish } from "../core/motifs.mjs";

/* ── physics helpers ──────────────────────────────────────────────────── */

/** Bounce while fast, then rest. `restAt` freezes the tumble, so a resting piece stops turning. */
export function settle(p, s) {
  if (p.bounce && Math.abs(p.vz) > 0.9) {
    p.z = 0; p.vz = -p.vz * p.bounce; p.vx *= 0.5; p.vy *= 0.5;
    if (p.thud && !p.landed) { p.landed = true; p.thud(p, s); }
  } else { p.z = 0; p.vz = 0; p.vx *= 0.6; p.vy *= 0.6; p.restAt ??= p.age; }
}

/** A heavy rock's first landing kicks up a puff. */
function thud(p, s) {
  s.add({ k: "smoke", x: p.x, y: p.y, z: 0.05, vx: p.vx * 0.2, vz: 0.15, drag: 2.5, r: 2.5, life: 0.5, lobes: [[0, 0, 1], [0.6, 0.2, 0.6]], R: p.R, tone: 0.5, minor: true });
}

/** A spike crumbles as it sinks: a few pebbles fall off it. */
function crumble(p, s) {
  if (p.crumbled || p.age < p.life * 0.72) return;
  p.crumbled = true;
  for (let i = 0; i < 3; i++) s.add({ k: "boulder", x: p.x + s.rand(-0.08, 0.08), y: p.y, z: s.rand(0.15, 0.35), vx: s.rand(-0.8, 0.8), vy: s.rand(-0.3, 0.3), vz: s.rand(0.3, 1), g: 9, bounce: 0.25, onGround: settle, life: s.rand(1.2, 2), R: p.R, s: s.R() < 0.4 ? 2 : 1, seed: sd(s), a0: s.rand(0, TAU), debris: true, minor: i > 0 });
}

const isMetal = (M) => M.material === "metal";

/** A cluster of spikes for a release, nearest-first for the 3D view. */
function spikes(s, R, x, y, rad, mm, sharp, sub = false) {
  // an area eruption raises one or two, so a field of them reads as stone coming up, not a thicket
  const N = sub ? (s.R() < 0.55 ? 1 : 2) : Math.round((3 + rad * 2.2) * Math.min(1.4, mm) * (sharp ? 0.8 : 1)), list = [], q0 = hash(s.seed, 3) * TAU;
  for (let i = 0; i < N; i++) {
    let q, d;
    if (sub) { q = s.rand(0, TAU); d = rad * s.rand(0, 0.5); }
    else if (s.take === 0) { q = (i / N) * TAU + s.rand(-0.25, 0.25); d = rad * s.rand(0.4, 0.75); }
    else if (s.take === 1) { q = s.rand(0, TAU); d = Math.sqrt(s.R()) * rad * 0.8; }
    else { q = q0 + ((i % 3) / 3) * TAU + s.rand(-0.12, 0.12); d = rad * (0.25 + (0.65 * (Math.floor(i / 3) + 1)) / Math.ceil(N / 3)); }
    const k = 1 - (d / (rad + 0.6)) * 0.45;
    list.push({ k: "rockspike", x: x + Math.cos(q) * d, y: y + Math.sin(q) * d, h: s.rand(12, 20) * mm * k, w: (sharp ? s.rand(1.4, 2.2) : s.rand(3, 4.8)) * Math.min(1.3, mm), lean: Math.cos(q) * s.rand(1, 4), life: s.rand(1.7, 2.4), R, seed: sd(s), sharp, wait: d * 0.12, debris: true, update: crumble });
  }
  if (s.take === 1 && !sharp && !sub) list.push({ k: "rockspike", x, y, h: 22 * mm, w: 5 * Math.min(1.3, mm), lean: s.rand(-2, 2), life: 2.4, R, seed: sd(s), wait: 0, debris: true, update: crumble });
  // farther first: in the 3D view a larger y stands further back
  list.sort((a, b) => b.y - a.y).forEach((p) => s.add(p));
}

/** A cone or line of spikes erupting in a wave that runs out from the hand. */
function spikeFront(s, M, { hand, dir, half, len, dt }, sharp) {
  const st = (s.ewFront ??= { t0: s.t });
  const u = (s.t - st.t0) / 0.5;
  if (u > 1) return;
  const d = 0.7 + u * (len - 0.7), rate = (len * (half > 0.3 ? 4 : 2.6) * (sharp ? 0.7 : 1)) / 0.5;
  for (let i = s.count(rate, dt); i > 0; i--) {
    const q = dir + s.rand(-half, half) * 0.85, dd = d + s.rand(-0.25, 0.25);
    s.add({ k: "rockspike", x: hand[0] + Math.cos(q) * dd, y: hand[1] + Math.sin(q) * dd, h: s.rand(8, 14) * Math.min(1.4, s.m), w: sharp ? s.rand(1.3, 2) : s.rand(2.2, 3.6), lean: Math.cos(q) * s.rand(1, 3), life: s.rand(1.2, 1.7), R: M.R, seed: sd(s), sharp, debris: true, update: crumble });
  }
}

/* ── earth ────────────────────────────────────────────────────────────── */

function earthBurst(s, M, { x, y, z, pow, rad, sub }) {
  const R = M.R, m = s.m * pow, mm = Math.min(1.6, m), n = counter(s, pow, rad);
  releaseFlash(s, M, x, y, z, pow, rad);
  if (pow >= 0.5 || sub) {
    if (!sub || s.R() < 0.4) s.add({ k: "fissure", x, y, r: rad * (sub ? 0.7 : 0.95) + 0.25, life: 5, R, seed: sd(s), debris: true, update: still });
    spikes(s, R, x, y, rad, sub ? s.rand(0.5, 0.75) : mm, false, sub);
  }
  for (let i = 0, N = sub ? n(3) : n(7); i < N; i++) {
    const o = out(s, s.rand(1.8, 4.2)), big = i < 2;
    o.vz = Math.abs(o.vz) + s.rand(2, 3.5);
    s.add({ k: "boulder", x, y, z: Math.max(0.1, z * 0.5), ...o, g: 11, drag: 0.5, bounce: 0.3, onGround: settle, thud: big ? thud : null, life: s.rand(3, 4.5), R, s: big ? s.rand(3.5, 5) * Math.min(1.3, mm) : s.rand(1, 3), seed: sd(s), a0: s.rand(0, TAU), spin: s.R() < 0.5 ? -1 : 1, debris: true, minor: !big && i % 3 === 2 });
  }
  // dust rolls out low from the rim, leaving the spikes clear
  const nd = sub ? Math.min(2, n(5)) : n(5);
  for (let i = 0; i < nd; i++) {
    const q = (i / nd) * TAU + s.rand(-0.3, 0.3), sp = s.rand(1, 1.8) * (0.6 + rad * 0.4), d = rad * 0.75;
    s.add({ k: "smoke", x: x + Math.cos(q) * d, y: y + Math.sin(q) * d, z: 0.05, vx: Math.cos(q) * sp, vy: Math.sin(q) * sp, vz: 0.1, g: -0.03, drag: 2.6, r: s.rand(3, 4.5) * Math.min(1.4, m), life: s.rand(0.8, 1.2), lobes: lobes(s), R, tone: 0.33, wait: s.rand(0.06, 0.14) });
  }
  if (!sub) s.add({ k: "smoke", x, y: y + 0.05, z: 0.2, vz: 0.7, g: -0.1, drag: 1.6, r: s.rand(3.5, 4.5) * Math.min(1.3, m), life: 1, lobes: lobes(s), R, tone: 0.5, wait: 0.18 });
  if (pow >= 0.8 && !sub) s.shake = Math.max(s.shake, 1 + pow);
  flourish(s, M, x, y, z, rad, Math.round(5 * m));
}

function earthTrail(s, M, { x, y, z, dt }) {
  const R = M.R;
  // the boulder riding the projectile's head (one frame long, replaced every step)
  s.add({ k: "boulder", x, y, z, s: 3.5 * Math.min(1.4, s.m), life: dt * 1.5, R, seed: 5, rot: Math.floor(s.t * 12) * 0.85, update: still });
  for (let i = s.count(26 * s.m, dt); i > 0; i--) s.add({ k: "boulder", x: x + s.rand(-0.06, 0.06), y: y + s.rand(-0.06, 0.06), z, vx: s.rand(-0.4, 0.4), vy: s.rand(-0.3, 0.3), vz: s.rand(-0.5, 0.5), g: 9, drag: 0.6, bounce: 0.25, onGround: settle, life: s.rand(1.2, 2), R, s: 1, seed: sd(s), debris: true, minor: s.R() < 0.5 });
  for (let i = s.count(12 * s.m, dt); i > 0; i--) s.add({ k: "smoke", x, y, z, vz: 0.1, drag: 2.5, r: s.rand(1.5, 2.4), life: s.rand(0.35, 0.5), lobes: [[0, 0, 1]], R, tone: 0.5 });
}

/* ── metal ────────────────────────────────────────────────────────────── */

function metalBurst(s, M, { x, y, z, pow, rad, sub }) {
  const R = M.R, m = s.m * pow, mm = Math.min(1.6, m), n = counter(s, pow, rad);
  releaseFlash(s, M, x, y, z, pow, rad);
  s.add({ k: "clang", x, y, z, r: Math.round(3 + 2 * mm), life: 5 / 12, R, update: still });
  for (let i = 0, N = sub ? n(8) : n(16); i < N; i++) s.add({ k: "sliver", x, y, z, ...out(s, s.rand(3, 7)), g: 9, drag: 1.1, bounce: 0.35, onGround: settle, life: s.rand(1.8, 2.8), R, len: s.R() < 0.4 ? 4 : 3, seed: s.R(), glint: true, debris: i % 2 === 0, minor: i % 4 === 3 });
  for (let i = 0; i < n(8); i++) s.add({ k: "spark", x, y, z, ...out(s, s.rand(4, 8)), g: 9, drag: 1.4, bounce: 0.4, life: s.rand(0.25, 0.5), R: RAMP.fire, minor: i % 2 === 1 });
  if (pow >= 0.5 || sub) {
    if (!sub || s.R() < 0.3) s.add({ k: "filings", x, y, r: rad * (sub ? 0.7 : 0.95) + 0.25, life: 4.5, R, seed: sd(s), debris: true, update: still });
    spikes(s, R, x, y, rad, sub ? s.rand(0.55, 0.8) : mm, true, sub);
  }
  flourish(s, M, x, y, z, rad, Math.round(5 * m));
}

function metalTrail(s, M, { x, y, z, dt }) {
  const R = M.R;
  s.add({ k: "sliver", x, y, z, len: 5, turn: Math.floor(s.t * 24) & 3, life: dt * 1.5, R, seed: 0, glint: true, update: still });
  for (let i = s.count(22 * s.m, dt); i > 0; i--) s.add({ k: "sliver", x, y, z, vx: s.rand(-0.6, 0.6), vy: s.rand(-0.6, 0.6), vz: s.rand(-0.3, 0.6), g: 4, drag: 2, len: 2, life: s.rand(0.4, 0.6), R, seed: s.R(), glint: true, minor: s.R() < 0.5 });
  for (let i = s.count(4, dt); i > 0; i--) s.add({ k: "glint", x, y, z, life: 5 / 12, R, minor: true, update: still });
}

/* ── the family ───────────────────────────────────────────────────────── */

export default {
  id: "earthwork",
  burst(s, M, ctx) { (isMetal(M) ? metalBurst : earthBurst)(s, M, ctx); },
  trail(s, M, ctx) { (isMetal(M) ? metalTrail : earthTrail)(s, M, ctx); },
  linger(s, M, { at }) {
    if (isMetal(M)) {
      at(2.5, () => ({ k: "glint", z: s.rand(0.05, 0.5), life: 5 / 12, update: still }));
      return;
    }
    at(1.4, () => ({ k: "smoke", z: 0.1, vx: s.rand(-0.3, 0.3), vz: 0.15, g: -0.03, drag: 1.5, r: s.rand(3, 4.5), life: s.rand(1, 1.4), lobes: lobes(s), tone: 0.5 }));
    at(4, () => ({ k: "boulder", z: s.rand(0.5, 1), g: 9, bounce: 0.3, onGround: settle, life: 1.6, s: 1, seed: sd(s), debris: true, minor: true }));
  },
  spray(s, M, ctx) {
    const { emit } = ctx;
    if (isMetal(M)) {
      spikeFront(s, M, ctx, true);
      emit("sliver", 55, () => ({ g: 3, drag: 1.3, bounce: 0.3, onGround: settle, life: s.rand(0.8, 1.2), len: 3, seed: s.R(), glint: true }));
      emit("spark", 18, () => ({ R: RAMP.fire, drag: 1.5, g: 4, life: 0.4, minor: true }));
      return;
    }
    spikeFront(s, M, ctx, false);
    emit("boulder", 22, () => ({ g: 7, drag: 1.2, bounce: 0.3, onGround: settle, life: s.rand(1.5, 2.5), s: s.rand(1, 3), seed: sd(s), a0: s.rand(0, TAU), debris: true }));
    emit("smoke", 30, () => ({ drag: 2, g: -0.05, life: s.rand(0.7, 1), r: s.rand(2.5, 4), lobes: lobes(s), tone: 0.5 }));
  },
  auraStart(s, M, T) {
    if (isMetal(M)) s.add({ k: "filings", x: T.x, y: T.y, r: 0.5 * T.size, life: 1e9, R: M.R, seed: 13, update: still });
    else s.add({ k: "fissure", x: T.x, y: T.y, r: 0.45 * T.size, life: 1e9, R: M.R, seed: 13, update: still });
  },
  aura(s, M, { at }) {
    if (isMetal(M)) {
      at(2, () => ({ k: "glint", life: 5 / 12, update: still }));
      at(3, () => ({ k: "sliver", g: 1.5, drag: 3, len: 2, life: 1.1, seed: s.R(), glint: true, minor: true }));
      return;
    }
    at(5, () => ({ k: "boulder", g: 6, bounce: 0.2, onGround: settle, life: 1.4, s: 1, seed: sd(s), debris: true }));
    at(0.9, () => ({ k: "smoke", z: 0.1, vz: 0.2, drag: 1.5, r: s.rand(2.5, 3.5), life: 1.1, lobes: lobes(s), tone: 0.5 }), false);
  },
  tick(s, M, T) {
    if (isMetal(M)) { s.add({ k: "clang", x: T.x, y: T.y, z: 0.6 * T.h, r: 3, life: 5 / 12, R: M.R, update: still }); return; }
    for (let i = 0; i < 3; i++) {
      const q = (i / 3) * TAU + 0.4;
      s.add({ k: "rockspike", x: T.x + Math.cos(q) * 0.35 * T.size, y: T.y + Math.sin(q) * 0.3 * T.size, h: 8, w: 2.4, lean: Math.cos(q) * 2, life: 0.9, R: M.R, seed: sd(s), wait: i * 0.04, update: crumble });
    }
  },
};

/* ── shapes ───────────────────────────────────────────────────────────── */

/** Fissures in polar units, so one set reads in both views. */
function fissures(seed) {
  const r = rng(seed * 7 + 1), N = 6 + Math.floor(r() * 3), out = [];
  for (let i = 0; i < N; i++) {
    let q = (i / N) * TAU + (r() - 0.5) * 0.6;
    const L = 0.7 + r() * 0.35, pts = [[q, 0.36]];
    for (let d = 0.36; d < L;) { d = Math.min(L, d + 0.08 + r() * 0.06); q += (r() - 0.5) * 0.28; pts.push([q, d]); }
    out.push(pts);
    if (r() < 0.5) {
      const [bq, bd] = pts[Math.min(pts.length - 1, 2)], dir = r() < 0.5 ? -1 : 1, br = [[bq, bd]];
      let qq = bq;
      for (let k = 0, d = bd; k < 3; k++) { d += 0.07; qq += dir * 0.18; br.push([qq, d]); }
      out.push(br);
    }
  }
  return out;
}

registerShapes({
  /** A tumbling rock: a lumpy hexagon, lit from the top left, that stops turning when it rests. */
  boulder(v, P, p) {
    const [x, y] = v.ap(p.x, p.y, p.z), a = fadeOut(p.age / p.life, 0.8), R = p.R, r = p.s;
    if (r < 1.5) { P.dot(x, y, S(R, 0.67), a, 1); P.dot(x + 1, y, S(R, 0.33), a, 1); return; }
    const fr = Math.floor(Math.min(p.age, p.restAt ?? Infinity) * 12), ang = p.rot ?? (p.a0 ?? 0) + fr * 0.85 * (p.spin ?? 1), pts = [];
    for (let i = 0; i < 6; i++) { const q = ang + (i * TAU) / 6, rr = r * (0.72 + 0.4 * hash(i, p.seed)); pts.push([x + Math.cos(q) * rr, y + Math.sin(q) * rr * 0.85]); }
    P.shade(x - r - 1, y - r - 1, x + r + 1, y + r + 1, (px, py) => {
      if (!inPoly(pts, px, py)) return null;
      const lit = (-(px - x) - (py - y)) / r, t = lit > 0.45 ? 0.83 : lit > -0.1 ? 0.5 : lit > -0.6 ? 0.33 : 0.17;
      return a < 1 ? { c: S(R, t), a } : S(R, t);
    }, 1);
  },
  /** A spike of stone (or, `sharp`, a blade of metal) that pops out of the ground and sinks back. */
  rockspike(v, P, p) {
    const fr = Math.floor(p.age * 12), u = p.age / p.life;
    const pop = fr === 0 ? 0.5 : fr === 1 ? 1.15 : 1, sink = u > 0.72 ? (u - 0.72) / 0.28 : 0;
    const hh = p.h * pop * (1 - sink) * (v.kind === "top" ? 0.55 : 1);
    if (hh < 1) return;
    const [bx, by] = v.ap(p.x, p.y, 0), R = p.R, sharp = !!p.sharp;
    // the broken ground it burst from
    const rw = p.w + 1.5;
    for (let i = Math.floor(-rw); i <= Math.ceil(rw); i++) {
      P.px(bx + i, by, S(R, 0.33), 1);
      if (hash(i, p.seed) > 0.45 && Math.abs(i) < rw - 0.5) P.px(bx + i, by - 1, S(R, 0.5), 1);
    }
    for (let j = 0; j < hh; j++) {
      const f = j / hh, jag = sharp ? 1 : 0.8 + 0.35 * hash(j >> 1, p.seed), hw = Math.max(0.5, p.w * (1 - f) ** (sharp ? 1 : 0.8) * jag), cx = bx + p.lean * f;
      for (let i = Math.floor(-hw); i <= Math.ceil(hw); i++) {
        if (Math.abs(i) > hw + 0.3) continue;
        let t;
        if (sharp) t = Math.abs(i) < 0.6 ? 1 : i < 0 ? 0.83 : 0.5;
        else {
          t = i < -hw * 0.2 ? 0.67 : i > hw * 0.3 ? 0.33 : 0.5;
          if ((j + (p.seed % 5)) % 5 === 0 && i > -hw * 0.2) t -= 0.17; // strata
        }
        if (j >= hh - 1.5) t = sharp ? 1 : 0.83;
        P.px(cx + i, by - 1 - j, S(R, t), 1);
      }
    }
  },
  /** Metal struck: a hard white diamond, then two rings of ticks shivering outward. */
  clang(v, P, p) {
    const fr = Math.floor(p.age * 12); if (fr > 4) return;
    const [x, y] = v.ap(p.x, p.y, p.z), r = p.r, R = p.R;
    if (fr === 0) {
      for (let j = -r; j <= r; j++) { const w = r - Math.abs(j); for (let i = -w; i <= w; i++) P.px(x + i, y + j, WHITE, 2); }
      return;
    }
    for (let ring = 0; ring < 2; ring++) {
      const rr = r * (0.9 + fr * 0.55) + ring * 3, off = (fr + ring) % 2 ? TAU / 16 : 0, L = ring ? 2 : 3;
      for (let i = 0; i < 8; i++) {
        const q = off + (i * TAU) / 8, c = Math.cos(q), sn = Math.sin(q);
        P.line(x + c * rr, y + sn * rr, x + c * (rr + L), y + sn * (rr + L), S(R, ring ? 0.67 : 1), 2);
      }
    }
    if (fr < 3) { const w = Math.max(1, Math.round(r / 2) - fr + 1); for (let j = -w; j <= w; j++) { const k = w - Math.abs(j); for (let i = -k; i <= k; i++) P.px(x + i, y + j, S(R, 1), 2); } }
  },
  /** A shard of steel (or a wood splinter) tumbling through four angles; a glint when it catches the light. */
  sliver(v, P, p) {
    const [x, y] = v.ap(p.x, p.y, p.z), a = fadeOut(p.age / p.life, 0.8), R = p.R, L = p.len ?? 3;
    const fr = Math.floor(Math.min(p.age, p.restAt ?? Infinity) * 12), k = p.turn ?? (fr + Math.floor(p.seed * 4)) & 3;
    const d = [[1, 0], [1, -1], [0, -1], [1, 1]][k];
    for (let i = 0; i < L; i++) {
      const f = i / (L - 1 || 1), o = i - (L >> 1);
      P.dot(x + d[0] * o, y + d[1] * o, S(R, f > 0.7 ? 0.83 : f < 0.3 ? 0.33 : 0.6), a, 1);
    }
    if (!p.glint) return;
    const live = Math.floor(p.age * 12);
    if ((p.restAt == null && k === 1) || (p.restAt != null && hash(live, p.seed * 977) > 0.93)) {
      P.dot(x, y, S(R, 1), a, 2);
      if (L > 2) { P.dot(x - 1, y, S(R, 0.83), a, 2); P.dot(x + 1, y, S(R, 0.83), a, 2); P.dot(x, y - 1, S(R, 0.83), a, 2); P.dot(x, y + 1, S(R, 0.83), a, 2); }
    }
  },
});

registerShapes({
  /** Earth: a crater dish with a lit far lip, and jagged fissures that run out from it. */
  fissure(v, P, p) {
    const u = p.age / p.life, a = fadeOut(u, 0.6), fr = Math.floor(p.age * 12), g = Math.min(1, (fr + 1) / 3);
    const [cx, cy] = v.ap(p.x, p.y, 0), rx = p.r * v.aps, ry = rx * v.sq, R = p.R;
    const crx = Math.max(2, rx * 0.3), cry = Math.max(1.5, crx * v.sq);
    P.shade(cx - crx - 1, cy - cry - 1, cx + crx + 1, cy + cry + 1, (x, y) => {
      const dx = (x - cx) / crx, dy = (y - cy) / cry, d = Math.hypot(dx, dy), e = 0.85 + pnoise(Math.atan2(dy, dx), 7, p.seed) * 0.3;
      if (d > e) return null;
      if (d > e - 1.5 / crx) return { c: S(R, dy > 0.3 ? 0.5 : 0.17), a: a * 0.75 };
      return { c: S(R, 0), a: a * 0.5 };
    }, 0, "mix");
    p.fis ??= fissures(p.seed);
    for (const pts of p.fis) {
      let prev = null;
      for (const [q, d] of pts) {
        if (d > 0.36 + 0.7 * g) break;
        const X = cx + Math.cos(q) * d * rx, Y = cy + Math.sin(q) * d * ry;
        if (prev) {
          P.line(prev[0], prev[1] + 1, X, Y + 1, S(R, 0.5), 0, a);
          P.line(prev[0], prev[1], X, Y, S(R, 0), 0, a);
        }
        prev = [X, Y];
      }
    }
  },
  /** Metal: iron filings snapped into curved field lines around the impact. */
  filings(v, P, p) {
    const u = p.age / p.life, a = fadeOut(u, 0.6), fr = Math.floor(p.age * 12), g = Math.min(1, (fr + 1) / 4);
    const [cx, cy] = v.ap(p.x, p.y, 0), rx = p.r * v.aps, ry = rx * v.sq, R = p.R, N = 14;
    for (let i = 0; i < N; i++) {
      const q0 = (i / N) * TAU + hash(i, p.seed) * 0.3, bend = (i % 2 ? 1 : -1) * 0.5;
      for (let k = 0; k < 6; k++) {
        const t = 0.25 + k * 0.13; if (t > 0.25 + 0.75 * g) break;
        if (hash(i, k, p.seed) < 0.2) continue;
        const q = q0 + bend * (t - 0.25) ** 2 * 2, X = cx + Math.cos(q) * t * rx, Y = cy + Math.sin(q) * t * ry;
        const tq = q + bend * 0.6, dx = Math.round(Math.cos(tq)), dy = Math.round(Math.sin(tq) * v.sq);
        P.dot(X, Y, S(R, 0.33), a); P.dot(X + dx, Y + dy, S(R, 0.67), a);
      }
    }
  },
}, { flat: ["fissure", "filings"] });
