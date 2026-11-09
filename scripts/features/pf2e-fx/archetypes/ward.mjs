/**
 * Spellsprite archetypes — ward. docs/SPELLSPRITE_ARCHETYPES.md §4 says what each covers;
 * the spellsprite-craft skill says how good it must be.
 *
 * Each drawer is (s, M, ctx) like a FORMS entry: ctx = { caster, targets, area, hand, t0, release, linger, fire, self }.
 * compile.mjs `buildForm` has already drawn the wind-up before `t0` and, for an area, its footprint and wave.
 *
 *   ward     Ward, shield, Shield Block, dodge, counterspell: one ward core, a hex lattice raised round
 *            or in front of the subject. Its forms, by slug:
 *              dome     (protective wards, Sanctuary, Resist Energy, last stand): motes drawn in, a
 *                       hex-lattice dome snaps up from a floor seal, a ripple runs over it from the
 *                       threat's side, its rim bright, twinkling cells, motes off the rim; it blinks
 *                       out cell by cell. A miss cracks and breaks early.
 *              disc     (the Shield cantrip): a floating disc of force raised in front of the body,
 *                       tilted back, its lattice lit by a sweeping sheen, a boss at its centre.
 *              block    (Shield Block, parry, deflect, dodge): the disc snaps up, a blow lands on it:
 *                       a held frame, a flash, sparks glancing off, chips, cracks, a ripple, recoil.
 *              counter  (counterspell): a hostile glyph flies in, the disc catches it, the glyph
 *                       shatters and the ward pops in a ring of sparkles.
 *            It faces the threat: the first target that is not the subject, else away from the caster.
 *   dispel   Dispel: the target's magic unweaves. Its runes orbit it and flare; glowing threads are
 *            pulled out of the body toward the caster, stretch, tremble and snap, sparks at each break,
 *            the loose ends whipping away; the aura greys out and sinks as ash. A failed dispel
 *            (miss) snaps back into the body and the aura flares brighter.
 *   detect   Detect: brief and readable, never a screen-filler. An eye glyph opens over the caster, a
 *            pulse ring sweeps out across the floor (the area's radius, else about 3 squares, out to
 *            any target), and each creature it crosses pings: brackets snap on, a glint, a small ring.
 */

import { TAU, clamp, lerp, easeOut, hash, fadeOut, rng } from "../core/rand.mjs";
import { RAMP, S } from "../core/palette.mjs";
import { registerShapes, GLYPHS } from "../core/shapes.mjs";
import { still, sd } from "../core/motifs.mjs";
import { areaGeom, areaPoints } from "../area.mjs";

const SQ3 = Math.sqrt(3);
const backOut = (u, k = 1.7) => 1 + (k + 1) * (u - 1) ** 3 + k * (u - 1) ** 2;

/** The nearest pointy-top hex cell: [edge metric (1 on the edge, 0 at the centre), cell id]. Reuses one array. */
const HC = [0, 0];
function hexCell(x, y, s) {
  const q = (SQ3 / 3 * x - y / 3) / s, r = (2 / 3 * y) / s;
  let rx = Math.round(q), rz = Math.round(r);
  const ry = Math.round(-q - r), dx = Math.abs(rx - q), dz = Math.abs(rz - r), dy = Math.abs(ry + q + r);
  if (dx > dy && dx > dz) rx = -ry - rz; else if (dz > dy) rz = -rx - ry;
  const cx = s * (SQ3 * rx + (SQ3 / 2) * rz), cy = s * 1.5 * rz, lx = Math.abs(x - cx), ly = Math.abs(y - cy);
  HC[0] = Math.max(lx, lx * 0.5 + ly * (SQ3 / 2)) / (s * SQ3 / 2);
  HC[1] = rx * 97 + rz * 13;
  return HC;
}

/** A "mix" shader whose opaque pixels are written straight, and its rim (`o: 1`) as a shape, so a bright floor inks only the rim. */
const inked = (P, fn) => (x, y, ix, iy) => {
  const r = fn(x, y);
  if (r && r.a >= 1) { P.px(ix, iy, r.c, r.o ?? 0); return null; }
  return r;
};

/** One rune glyph: its 3×3 strokes lit, a dim glow round them where nothing is drawn. */
function rune(P, x, y, G, c, c2, a, o = 1) {
  x = Math.round(x); y = Math.round(y);
  for (let j = -1; j <= 3; j++) for (let k = -1; k <= 3; k++) {
    const on = j >= 0 && j < 3 && k >= 0 && k < 3 && G[j * 3 + k] === "1";
    if (on) P.dot(x - 1 + k, y - 1 + j, c, a, o);
    else if ((j === -1 || j === 3) !== (k === -1 || k === 3)) P.dot(x - 1 + k, y - 1 + j, c2, a * 0.6, 0);
  }
}

/* ── shapes only the ward archetypes draw ─────────────────────────────── */

registerShapes({
  /**
   * The dome: a hex lattice over a half sphere. Top view: a disc seen from above, built from the rim in;
   * side view: a half ellipse built from the floor up. The lattice shows at its rim (where it turns
   * away), on a ripple running from the hit side, and in cells that twinkle; the middle stays clear.
   */
  waDome(v, P, p) {
    const top = v.kind === "top", age = p.age, fr = Math.floor(age * 12);
    const [cx, cy] = v.ap(p.x, p.y, top ? 0.4 * p.h : 0), rx = p.r * v.aps, ry = top ? rx : Math.max(3, p.h * v.aps);
    const grow = easeOut(clamp(age / p.snap)), out = clamp((age - (p.life - p.fade)) / p.fade), flash = age < 1 / 12;
    const cell = p.cell, edge = 1 - 0.62 / (cell * 0.87), rimW = 1.4 / Math.min(rx, ry), R = p.R;
    // the hit point in the shape's unit coordinates: on the near rim facing the threat (top), at that side's shoulder (side)
    const hu = top ? p.ux * 0.82 : p.ux * 0.7, hw = top ? p.uy * 0.82 : (p.ux || p.uy ? 0.45 : 1);
    const sh = p.sheen ? ((age * 0.9) % 1.6) * 2.4 - 1.4 : 9, crestW = 0.55 / Math.min(rx, ry);
    P.shade(cx - rx - 1, cy - ry - 1, cx + rx + 1, top ? cy + ry + 1 : cy + 1, inked(P, (x, y) => {
      const u = (x - cx) / rx, w = top ? (y - cy) / ry : (cy - y) / ry;
      if (!top && w < 0) return null;
      const q = u * u + w * w; if (q > 1 || (p.shell && q < 0.6)) return null;
      if (top ? Math.sqrt(q) < 1 - grow * 1.03 : w > grow * 1.03) return null;
      const z = Math.sqrt(1 - q), g = 1 / (0.35 + 0.65 * z);
      const [m, id] = hexCell(u * g * rx, w * g * ry, cell);
      const k = hash(id, 7, p.seed);
      if (out > 0 && k < out - 0.08) return null;
      const dying = out > 0 && k < out;
      // the ripples: lattice lines lit where a front passes, and the front itself a thin bright line
      let rip = 0, crest = false;
      for (const r0 of p.rip) {
        const kk = age - r0; if (kk < 0 || kk > 0.55) continue;
        const dd = Math.hypot(u - hu, w - hw), front = kk * 3.4, off = Math.abs(dd - front);
        if (off < 0.18) { rip = Math.max(rip, 1 - kk / 0.55); if (off < crestW) crest = true; }
      }
      const line = m > edge;
      const d = Math.sqrt(q);
      if (d > 1 - rimW) return { c: S(R, flash || rip > 0.3 || dying ? 1 : 0.95), a: 1, o: 1 };
      if (d > 1 - rimW * 2.2) return { c: S(R, 0.75), a: 0.75 };
      if (dying) return line ? { c: S(R, 1), a: 1 } : null;
      if (p.crack && line && hash(id, 3, p.seed) < p.crack) return { c: S(R, 1), a: 1 };
      if (crest && rip > 0.25) return { c: S(R, rip > 0.6 ? 0.95 : 0.85), a: 1 };
      // the lit cap: the shoulder toward the light keeps its lattice, so the dome reads as curved
      const cap = top ? u + w < -0.75 && z < 0.85 : u < -0.15 && w > 0.45 && z < 0.8;
      const shine = Math.abs((u - w) * 0.7 - sh) < 0.1;
      if (line) {
        if (rip > 0.3) return { c: S(R, rip > 0.6 ? 1 : 0.9), a: 1 };
        if (shine || hash(id, fr >> 1, p.seed) > 0.965) return { c: S(R, 0.95), a: 1 };
        if (cap) return { c: S(R, 0.88), a: 1 };
        if (z < 0.55) return { c: S(R, 0.82), a: z < 0.3 ? 1 : 0.75 };
        return { c: S(R, 0.72), a: 0.25 };
      }
      if (z < 0.36) return { c: S(R, 0.62), a: 0.25 };
      return null;
    }), 0, "mix");
  },

  /**
   * A disc of force standing in the world, tilted back from its facing (ux, uy): drawn by inverting its
   * projected axes, so one disc reads as a raised shield top-down and face-on in the Diorama.
   */
  waDisc(v, P, p) {
    const sc = p.pop ?? 1; if (sc < 0.12) return;
    const age = p.age, fr = Math.floor(age * 12), R = p.R, R0 = p.r * sc, ct = Math.cos(p.tilt), st = Math.sin(p.tilt);
    const C = v.ap(p.x, p.y, p.z), A = v.ap(p.x - p.uy * R0, p.y + p.ux * R0, p.z), B = v.ap(p.x - p.ux * st * R0, p.y - p.uy * st * R0, p.z + ct * R0);
    const a1x = A[0] - C[0], a1y = A[1] - C[1], a2x = B[0] - C[0], a2y = B[1] - C[1], det = a1x * a2y - a1y * a2x;
    const out = clamp((age - (p.life - p.fade)) / p.fade), flash = age < 1 / 12 || (p.hitAt != null && age >= p.hitAt && age < p.hitAt + 1 / 12);
    const at = (s, t) => [C[0] + s * a1x + t * a2x, C[1] + s * a1y + t * a2y];
    if (Math.abs(det) < 6) {
      // edge-on: a bright bar
      const [x0, y0] = at(-1, 0), [x1, y1] = at(1, 0);
      P.line(x0, y0, x1, y1, S(R, 0.95), 1, 1 - out);
      return;
    }
    const L = Math.max(Math.hypot(a1x, a1y), Math.hypot(a2x, a2y)), minor = Math.abs(det) / L, rimW = 1.3 / minor;
    const cell = p.cell * sc, edge = 1 - 0.62 / (cell * 0.87), Rpx = p.r * v.aps * sc;
    const ex = Math.abs(a1x) + Math.abs(a2x) + 1, ey = Math.abs(a1y) + Math.abs(a2y) + 1;
    const hk = p.hitAt == null ? -1 : age - p.hitAt, sh = ((age * 1.1) % 1.5) * 2.6 - 1.4;
    P.shade(C[0] - ex, C[1] - ey, C[0] + ex, C[1] + ey, inked(P, (x, y) => {
      const dx = x - C[0], dy = y - C[1], s = (dx * a2y - dy * a2x) / det, t = (a1x * dy - a1y * dx) / det, q = s * s + t * t;
      if (q > 1) return null;
      const d = Math.sqrt(q), [m, id] = hexCell(s * Rpx, t * Rpx, cell), k = hash(id, 5, p.seed);
      if (out > 0 && k < out - 0.1) return null;
      const dying = out > 0 && k < out, line = m > edge;
      if (d > 1 - rimW) return { c: S(R, flash || dying || t > 0.25 ? 1 : 0.88), a: 1, o: 1 };
      if (d > 1 - rimW * 2.4) return { c: S(R, 0.7), a: 0.75 };
      if (dying) return line ? { c: S(R, 1), a: 1 } : null;
      // the boss at the centre: a ring and a lit stud, so the disc reads as a shield
      if (d < 0.2 && d > 0.2 - rimW * 1.3) return { c: S(R, 0.9), a: 1 };
      if (d < 0.07) return { c: S(R, 1), a: 1 };
      let rip = 0;
      if (hk >= 0 && hk < 0.5) { const dd = Math.hypot(s - p.hs, t - p.ht), front = hk * 3.6; if (Math.abs(dd - front) < 0.16) rip = 1 - hk / 0.5; else if (dd < front) rip = 0.25 * (1 - hk / 0.5); }
      if (flash) return line ? { c: S(R, 1), a: 1 } : d > 0.55 ? { c: S(R, 0.8), a: 0.5 } : null;
      const shine = Math.abs((s - t) * 0.7 - sh) < 0.12;
      if (line) {
        if (rip > 0.3 || shine || hash(id, fr >> 1, p.seed) > 0.97) return { c: S(R, 1), a: 1 };
        if (d > 0.62 || t > 0.55) return { c: S(R, 0.85), a: 1 };
        return { c: S(R, 0.75), a: 0.25 };
      }
      if (rip > 0.3) return { c: S(R, 0.82), a: 0.25 };
      // the film: thin glass, thicker toward the rim; the sheen crossing it
      return shine ? { c: S(R, 0.8), a: 0.25 } : d > 0.7 ? { c: S(R, 0.62), a: 0.25 } : null;
    }), 0, "mix");
    // cracks from the blow, run out once it lands
    if (p.cracks && hk >= 0) {
      const g = clamp(hk / 0.07);
      for (const run of p.cracks) {
        const n = Math.max(2, Math.ceil(run.length * g));
        for (let i = 1; i < n && i < run.length; i++) {
          const [x0, y0] = at(run[i - 1][0], run[i - 1][1]), [x1, y1] = at(run[i][0], run[i][1]);
          P.line(x0, y0, x1, y1, S(R, i < 2 ? 1 : 0.95), 1, 1 - out * 0.8);
        }
      }
    }
  },

  /** A glowing thread from a (on the body) to b (pulled out), trembling; a rune where it ends. */
  waThread(v, P, p) {
    const a = p.alpha ?? 1; if (a < 0.08) return;
    const [x0, y0] = v.ap(p.a[0], p.a[1], p.a[2]), [x1, y1] = v.ap(p.b[0], p.b[1], p.b[2]);
    const len = Math.hypot(x1 - x0, y1 - y0); if (len < 1) return;
    const nx = -(y1 - y0) / len, ny = (x1 - x0) / len, n = Math.max(3, Math.ceil(len / 3)), R = p.R;
    const wob = p.amp * Math.sin(p.age * 26 + p.ph), dash = p.tension > 0.55;
    let lx = x0, ly = y0;
    for (let i = 1; i <= n; i++) {
      const f = i / n, off = Math.sin(Math.PI * f) * wob + Math.sin(f * 9 + p.ph + p.age * 14) * 0.6 * p.tension;
      const x = lerp(x0, x1, f) + nx * off, y = lerp(y0, y1, f) + ny * off;
      if (!(dash && i % 3 === 0)) P.line(lx, ly, x, y, S(R, f > 0.7 ? 1 : f > 0.35 ? 0.88 : 0.75), 1, a);
      lx = x; ly = y;
    }
    if (p.big) {
      // a hostile sigil: the glyph at double size inside a turning dashed ring
      const G = GLYPHS[p.g % GLYPHS.length], gx = Math.round(lx), gy = Math.round(ly), rot = p.age * 9;
      for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) if (G[j * 3 + k] === "1") for (let e = 0; e < 4; e++) P.px(gx - 3 + k * 2 + (e & 1), gy - 3 + j * 2 + (e >> 1), S(R, 1), 2);
      P.ellipse(gx, gy, 6, 6, (q) => ((Math.floor(((q + rot) / TAU) * 12) & 1) ? S(R, 0.82) : S(R, 0.6)), 2);
    } else if (p.rune) rune(P, lx, ly, GLYPHS[p.g % GLYPHS.length], S(R, 1), S(R, 0.7), a, 2);
  },

  /** The target's own magic: runes orbiting it on an ellipse at mid-height, greying as `grey` rises. */
  waAura(v, P, p) {
    const u = clamp(p.age / p.life), a = Math.min(1, p.age / 0.12) * fadeOut(u, 0.7), fr = Math.floor(p.age * 12);
    if (a <= 0) return;
    const [cx, cy] = v.ap(p.x, p.y, p.z - p.sink), rx = p.r * v.aps, ry = Math.max(2, rx * (v.kind === "top" ? 0.55 : v.sq + 0.1)), rot = p.rot + p.age * p.spin;
    const G = RAMP.neutral;
    P.ellipse(cx, cy, rx, ry, (q) => { const grey = hash(Math.floor(q * 4), 9, p.seed) < p.grey; return (Math.floor((q / TAU) * rx * 0.8 + fr) % 3 === 2) ? null : { c: grey ? S(G, 0.55) : S(p.R, p.flare ? 0.95 : 0.78), a }; }, 1);
    for (let i = 0; i < p.n; i++) {
      const q = rot + (i * TAU) / p.n, grey = hash(i, 4, p.seed) < p.grey, back = Math.sin(q) < -0.2 && v.kind !== "top";
      const x = cx + Math.cos(q) * rx, y = cy + Math.sin(q) * ry;
      const Gl = GLYPHS[(i + (fr >> 2)) % GLYPHS.length];
      rune(P, x, y, Gl, grey ? S(G, 0.62) : S(p.R, back ? 0.7 : p.flare ? 1 : 0.92), grey ? S(G, 0.4) : S(p.R, 0.6), back ? a * 0.6 : a, 1);
    }
  },

  /** The seer's eye over the caster: lids opening into an almond, an iris, a lit pupil glint, short rays. */
  waEye(v, P, p) {
    const u = clamp(p.age / p.life), op = p.open ?? 0, a = fadeOut(u, 0.7);
    const [cx, cy] = v.ap(p.x, p.y, p.z), W = p.w, H = Math.max(0.6, p.hh * op), R = p.R, fr = Math.floor(p.age * 12);
    for (let i = -W; i <= W; i++) {
      const f = Math.cos((i / W) * (Math.PI / 2)), yt = Math.round(-H * f), yb = Math.round(H * f * 0.85);
      P.dot(cx + i, cy + yt, S(R, 0.95), a, 2);
      if (op > 0.25) P.dot(cx + i, cy + yb, S(R, 0.8), a, 2);
    }
    if (op > 0.45) {
      const ir = Math.min(2.6, H);
      P.shade(cx - ir, cy - ir, cx + ir, cy + ir, (x, y) => { const d = Math.hypot(x - cx - 0.5, y - cy - 0.5); return d > ir ? null : { c: S(R, d < 1 ? 0.25 : 0.72), a }; }, 2);
      P.dot(cx - 1, cy - 1, S(R, 1), a, 2);
      if (op > 0.9 && fr % 4 !== 3) for (const [dx, dy] of [[0, -1], [-0.7, -0.7], [0.7, -0.7], [-1, 0], [1, 0]]) {
        const r0 = W + 2, r1 = W + 4.5;
        P.line(cx + dx * r0, cy + dy * (H + 2), cx + dx * r1, cy + dy * (H + 4), S(R, 0.75), 1, a * 0.8);
      }
    }
  },

  /** Ping brackets: four corners snapping in round a creature. */
  waMark(v, P, p) {
    const u = clamp(p.age / p.life), a = fadeOut(u, 0.6), snap = easeOut(clamp(p.age / 0.1));
    const [cx, cy] = v.ap(p.x, p.y, p.z), hw = p.r * v.aps * lerp(1.6, 1, snap), hh = v.kind === "top" ? hw : Math.max(hw, p.h * v.aps * 0.55), L = Math.max(3, Math.round(hw * 0.4));
    const c = S(p.R, p.age < 1 / 12 ? 1 : 0.9);
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      const x = Math.round(cx + sx * hw), y = Math.round(cy + sy * hh);
      P.line(x, y, x - sx * L, y, c, 2, a);
      P.line(x, y, x, y - sy * L, c, 2, a);
    }
  },
});

registerShapes({
  /** The floor seal under a dome: a bright circle, a dashed inner ring, small hexagons turning on it. */
  waSeal(v, P, p) {
    const u = clamp(p.age / p.life), [cx, cy] = v.ap(p.x, p.y, 0), r = p.r * v.aps * backOut(clamp(p.age / 0.16), 1.2), ry = r * v.sq;
    if (r < 2) return;
    const a = Math.min(1, p.age / 0.06) * fadeOut(u, 0.65), rot = p.rot + p.age * 0.5, R = p.R;
    P.ellipse(cx, cy, r, Math.max(1, ry), () => ({ c: S(R, 0.9), a }), 0);
    P.ellipse(cx, cy, r * 0.8, Math.max(1, ry * 0.8), (q) => ((((Math.floor(((q - rot) / TAU) * 24) % 2) + 2) % 2) ? { c: S(R, 0.62), a } : null), 0);
    const hx = Math.max(2, r * 0.09);
    for (let i = 0; i < p.n; i++) {
      const q = rot + (i * TAU) / p.n, x = cx + Math.cos(q) * r * 0.9, y = cy + Math.sin(q) * ry * 0.9;
      for (let k = 0; k < 6; k++) {
        const q0 = (k * TAU) / 6 + Math.PI / 6, q1 = ((k + 1) * TAU) / 6 + Math.PI / 6;
        P.line(x + Math.cos(q0) * hx, y + Math.sin(q0) * hx * v.sq, x + Math.cos(q1) * hx, y + Math.sin(q1) * hx * v.sq, S(R, 0.85), 0, a);
      }
    }
  },

  /**
   * Detect's pulse: a ring running out across the floor (fast, then slowing), a bright two-pixel edge,
   * a thin translucent wash trailing it and ticks riding just outside.
   */
  waPulse(v, P, p) {
    const k = clamp(p.age / p.dur), [cx, cy] = v.ap(p.x, p.y, 0), r = p.r * v.aps * easeOut(k), ry = r * v.sq;
    if (r < 2) return;
    const a = (p.tone ?? 1) * (1 - clamp((p.age - p.dur) / p.tail)), R = p.R; if (a <= 0.05) return;
    P.ellipse(cx, cy, r, Math.max(1, ry), () => ({ c: S(R, 0.98), a }), p.thin ? 0 : 1);
    P.ellipse(cx, cy, r - 1, Math.max(1, ry - v.sq), () => ({ c: S(R, 0.8), a }), 0);
    // the wash: an annulus behind the edge, row by row
    const band = Math.min(r - 2, Math.max(4, p.band * v.aps)), ri = r - band;
    if (band > 1 && !p.thin) {
      const y0 = Math.ceil(cy - ry), y1 = Math.floor(cy + ry), sq = v.sq || 1;
      for (let y = y0; y <= y1; y++) {
        const dy = (y + 0.5 - cy) / sq, dy2 = dy * dy, ox = Math.sqrt(Math.max(0, r * r - dy2)) - 1.5, ix = dy2 < ri * ri ? Math.sqrt(ri * ri - dy2) : 0;
        for (const side of [-1, 1]) {
          for (let x = Math.ceil(ix); x <= ox; x++) {
            // a radial falloff: faint at the inner edge of the band, stronger toward the leading edge
            const f = (Math.sqrt(x * x + dy2) - ri) / band, w = 0.5 * f * f * a;
            if (w > 0.12) P.mix(Math.floor(cx + side * x + (side < 0 ? 0 : 0)), y, S(R, 0.7), w);
          }
        }
      }
    }
    const n = p.n, rot = p.rot + p.age * 0.6;
    for (let i = 0; i < n; i++) {
      const q = rot + (i * TAU) / n, c = Math.cos(q), s = Math.sin(q);
      P.line(cx + c * (r + 2), cy + s * (ry + 2 * v.sq), cx + c * (r + 4), cy + s * (ry + 4 * v.sq), S(R, 0.75), 0, a);
    }
  },
}, { flat: ["waSeal", "waPulse"] });

/* ── helpers ─────────────────────────────────────────────────────────── */

const OUT = Object.freeze({ crit: 1.35, hit: 1, miss: 0.85, neutral: 1 });
const outcomeOf = (s, T) => T?.outcome ?? s.spec.outcome ?? "neutral";
const hued = (s) => Number.isFinite(s.spec.look?.hue);
/** A material with no colour of its own (kinetic, neutral) borrows force's blue. */
const rampFor = (s, M, fallback) => (!hued(s) && (M.material === "kinetic" || M.material === "neutral") ? fallback : M.R);
const norm = (x, y) => { const l = Math.hypot(x, y); return l > 1e-6 ? [x / l, y / l] : null; };
/** The facing when nothing says where the threat is: toward the camera's right, so the disc reads in both views. */
const FRONT = Object.freeze([0.8, 0.6]);

/** Every body a ward or dispel lands on: the targets, else creature-sized points across the area, else the caster. */
function bodies(s, ctx, n = 4) {
  if (ctx.targets.length) return ctx.targets;
  if (ctx.area) {
    const got = areaPoints(areaGeom(ctx.area), n, () => s.R()).pts;
    return (got.length ? got : [{ x: ctx.area.x, y: ctx.area.y }]).map((p) => ({ x: p.x, y: p.y, size: 1, h: 1, id: null }));
  }
  return ctx.caster ? [ctx.caster] : [];
}

/** A bright mote from the hand to a body before the drawer lands there, unless it is the caster's own. */
function reach(s, ctx, T, at, R) {
  const h = ctx.hand;
  if (ctx.self || !h || T === ctx.caster || Math.hypot(T.x - h[0], T.y - h[1]) < 0.6) return at;
  const dur = Math.min(0.42, 0.16 + Math.hypot(T.x - h[0], T.y - h[1]) * 0.03);
  s.at(at, (s2) => s2.add({
    k: "mote", x: h[0], y: h[1], z: h[2], life: dur, R, plus: true, glow: true,
    update(p, s3, dt) {
      const u = Math.min(1, p.age / dur);
      p.x = lerp(h[0], T.x, u); p.y = lerp(h[1], T.y, u); p.z = lerp(h[2], 0.6 * T.h, u) + Math.sin(Math.PI * u) * 0.35;
      for (let i = s3.count(40, dt); i > 0; i--) s3.add({ k: "mote", x: p.x, y: p.y, z: p.z, vz: s3.rand(-0.2, 0.3), drag: 2, life: s3.rand(0.25, 0.4), R, minor: true });
    },
  }));
  return at + dur;
}

/* ── ward ────────────────────────────────────────────────────────────── */

const DISC = /^shield$|^(?:reactive|raise|lesser|greater|major|true)?-?shield(?:-spell)?$/;
const BLOCK = /block|parry|deflect|dodge|ward-off|interpose/;
const COUNTER = /counter/;
const formOf = (slug) => (COUNTER.test(slug) ? "counter" : BLOCK.test(slug) ? "block" : DISC.test(slug) ? "disc" : "dome");

/** Where the threat is from the subject: the first other target, else away from the caster, else FRONT. */
function facing(ctx, T, threat) {
  if (threat) { const u = norm(threat.x - T.x, threat.y - T.y); if (u) return u; }
  if (ctx.caster && T !== ctx.caster) { const u = norm(T.x - ctx.caster.x, T.y - ctx.caster.y); if (u) return u; }
  return FRONT;
}

/** Motes drawn in from a wide ring to the body: the anticipation before a ward snaps up. */
function gather(s, R, T, n, dur) {
  for (let i = 0; i < n; i++) {
    const q = (i / n) * TAU + s.rand(-0.2, 0.2), d0 = s.rand(1.1, 1.5) * T.size, z0 = s.rand(0.1, 0.9) * T.h, x0 = T.x + Math.cos(q) * d0, y0 = T.y + Math.sin(q) * d0;
    s.add({ k: "mote", x: x0, y: y0, z: z0, life: dur, R, plus: i % 3 === 0, minor: i % 2 === 1, update(p) {
      const f = easeOut(clamp(p.age / dur)), dd = lerp(d0, 0.45 * T.size, f);
      p.x = T.x + Math.cos(q + f * 0.6) * dd; p.y = T.y + Math.sin(q + f * 0.6) * dd; p.z = lerp(z0, 0.5 * T.h, f);
    } });
  }
}

/** Sparkles thrown off a ward as it goes. */
function sparkleOut(s, R, x, y, z, rad, n, spread = 1.4) {
  for (let i = 0; i < n; i++) {
    const q = (i / n) * TAU + s.rand(-0.2, 0.2), sp = s.rand(0.6, 1.4) * spread;
    s.add({ k: i % 3 ? "mote" : "glint", x: x + Math.cos(q) * rad, y: y + Math.sin(q) * rad * 0.7, z: z + s.rand(-0.2, 0.3), vx: Math.cos(q) * sp, vy: Math.sin(q) * sp * 0.6, vz: s.rand(0, 0.8), drag: 2.4, life: i % 3 ? s.rand(0.4, 0.7) : 5 / 12, R, plus: i % 4 === 0, minor: i % 2 === 1, ...(i % 3 ? {} : { update: still }) });
  }
}

/** Sparks glancing off a surface at (x, y, z) whose outward normal is (nx, ny), mostly along it and up. */
function glance(s, R, x, y, z, nx, ny, n, sp0, sp1) {
  for (let i = 0; i < n; i++) {
    const side = i % 2 ? 1 : -1, q = Math.atan2(ny, nx) + side * s.rand(0.5, 1.5), sp = s.rand(sp0, sp1);
    s.add({ k: "spark", x, y, z, vx: Math.cos(q) * sp, vy: Math.sin(q) * sp, vz: s.rand(1, 4.5), g: 14, drag: 2.2, bounce: 0.35, life: s.rand(0.25, 0.55), R, minor: i >= 10 });
  }
}

function domeOn(s, R, ctx, T, g, crit, miss, threat) {
  const sz = T.size, sg = Math.sqrt(g), x = T.x, y = T.y, h = T.h, [ux, uy] = facing(ctx, T, threat);
  const r = 0.92 * sz * Math.min(sg, 1.12), H = 1.35 * h * Math.min(sg, 1.12), life = miss ? 1.05 : 1.9 + 0.3 * g, t = s.t, snap = 0.16;
  gather(s, R, T, Math.round(10 * g), 0.14);
  s.at(t + 0.14, (s2) => {
    s2.add({ k: "waSeal", x, y, r: r * 1.05, n: 6, rot: s2.rand(0, TAU), life: life + 0.1, R, update: still });
    s2.add({ k: "waDome", x, y, r, h: H, snap, cell: 8 * Math.sqrt(sz), ux, uy, rip: [0.12, 0.3, ...(crit ? [0.55] : [])], sheen: true, fade: 0.42, life, R, seed: sd(s2), update: miss ? (p) => { p.crack = clamp((p.age - 0.45) / 0.3) * 0.5; } : still });
    if (crit) s2.add({ k: "waDome", x, y, r: r * 1.28, h: H * 1.18, snap: 0.22, cell: 10 * Math.sqrt(sz), ux, uy, rip: [0.2], fade: 0.5, shell: true, life: life * 0.8, R, seed: sd(s2), wait: 0.05, minor: true, update: still });
    // the snap: a flash at the hit side, a ring thrown out, light
    s2.add({ k: "flash", x: x + ux * r * 0.8, y: y + uy * r * 0.8, z: 0.5 * h, life: 2 / 12, r: (crit ? 6 : 4) * Math.sqrt(sz), R, update: still });
    s2.add({ k: "ring", x, y, r: r * 1.9, life: 0.45, R, seed: sd(s2), update: still });
    s2.light(x, y, 0.5 * h, 2.6 * r + 0.6, S(R, 0.7), 0.6, 0.3);
    s2.light(x, y, 0.1, 2.4 * r + 0.4, S(R, 0.55), 0.3, life - 0.3, { swell: true });
    s2.shake = Math.max(s2.shake, crit ? 1.4 : 0.6);
    // the hold: motes lift off the rim, glints wink on the lattice
    s2.emit(s2.t + 0.15, s2.t + life - 0.35, (s3, u, dt) => {
      for (let i = s3.count(18 * g, dt); i > 0; i--) {
        const q = s3.rand(0, TAU);
        s3.add({ k: "mote", x: x + Math.cos(q) * r * 0.97, y: y + Math.sin(q) * r * 0.97, z: s3.rand(0, 0.25) * h, vz: s3.rand(0.5, 1.1), drag: 1.4, life: s3.rand(0.5, 0.9), R, plus: s3.R() < 0.2, minor: i > 1 });
      }
      for (let i = s3.count(5 * g, dt); i > 0; i--) {
        const q = s3.rand(0, TAU), d = s3.rand(0.55, 0.95) * r;
        s3.add({ k: "glint", x: x + Math.cos(q) * d, y: y + Math.sin(q) * d, z: s3.rand(0.2, 1) * H * 0.9, life: 5 / 12, R, minor: true, update: still });
      }
    });
    if (miss) {
      // the ward does not hold: it cracks and breaks into shards
      s2.at(s2.t + 0.78, (s3) => {
        for (let i = 0; i < 12; i++) { const q = (i / 12) * TAU + s3.rand(-0.2, 0.2); s3.add({ k: "shard", x: x + Math.cos(q) * r * 0.8, y: y + Math.sin(q) * r * 0.8, z: s3.rand(0.2, 0.9) * H, vx: Math.cos(q) * s3.rand(1.5, 3), vy: Math.sin(q) * s3.rand(1, 2), vz: s3.rand(0.5, 2), g: 10, drag: 0.8, bounce: 0.3, life: s3.rand(0.45, 0.75), R, seed: s3.R(), minor: i % 2 === 1 }); }
        s3.add({ k: "ring", x, y, r: r * 1.3, life: 0.35, R, broken: true, seed: sd(s3), update: still });
        s3.light(x, y, 0.5 * h, 2 * r, S(R, 0.7), 0.6, 0.25);
      });
    } else s2.at(s2.t + life - 0.3, (s3) => sparkleOut(s3, R, x, y, 0.5 * h, r * 0.8, Math.round(10 * g)));
  });
  return t + 0.14 + life;
}

/** A disc of force raised in front: `form` is disc, block or counter. Returns when it is gone. */
function discOn(s, R, ctx, T, g, crit, form, threat) {
  const sz = T.size, sg = Math.sqrt(g), h = T.h, [ux, uy] = facing(ctx, T, threat), t = s.t;
  const r = 0.62 * Math.sqrt(sz) * sg, dist = 0.5 * sz + 0.15, x = T.x + ux * dist, y = T.y + uy * dist, z = 0.58 * h, tilt = 0.6;
  const raise = form === "disc" ? 0.2 : 0.1, hitAt = form === "block" ? 0.3 : form === "counter" ? 0.42 : null;
  const life = form === "disc" ? 1.9 + 0.3 * g : form === "block" ? 1.25 : 1.05;
  const R2 = R === RAMP.unholy || R === RAMP.fire || R === RAMP.bleed ? RAMP.arcane : RAMP.unholy;
  // the hit point on the disc's face, and where that is in the world
  const hs = s.rand(-0.25, 0.25), ht = s.rand(0.05, 0.3), st = Math.sin(tilt), ct = Math.cos(tilt);
  const wx = x - uy * r * hs - ux * st * r * ht, wy = y + ux * r * hs - uy * st * r * ht, wz = z + ct * r * ht;
  const cracks = [];
  if (form === "block") {
    const rr = rng(sd(s)), nC = crit ? 7 : 4;
    for (let k = 0; k < nC; k++) {
      let q = (k / nC) * TAU + rr() * 0.6, cs = hs, ctt = ht;
      const run = [[cs, ctt]], n = 3 + Math.floor(rr() * 3);
      for (let i = 0; i < n; i++) { q += (rr() - 0.5) * 0.9; cs += Math.cos(q) * 0.16; ctt += Math.sin(q) * 0.16; if (cs * cs + ctt * ctt > 0.85) break; run.push([cs, ctt]); }
      cracks.push(run);
    }
  }
  if (form === "disc") gather(s, R, T, Math.round(8 * g), 0.16);
  s.at(t + (form === "disc" ? 0.12 : 0), (s2) => {
    s2.add({ k: "waDisc", x: T.x, y: T.y, z: 0.3 * h, ux, uy, r, tilt, cell: 6.5, hs, ht, hitAt, cracks: cracks.length ? cracks : null, pop: 0, fade: crit && form === "block" ? 0.2 : 0.4, life, R, seed: sd(s2), update(p) {
      const f = clamp(p.age / raise), kick = hitAt != null && p.age > hitAt ? Math.exp(-(p.age - hitAt) / 0.12) * 0.14 : 0;
      p.pop = backOut(f, 2.2);
      const d = lerp(0.2 * sz, dist, easeOut(f)) - kick;
      p.x = T.x + ux * d; p.y = T.y + uy * d; p.z = lerp(0.3 * h, z, easeOut(f));
    } });
    s2.add({ k: "star", x, y, z, L: 5 * sg, life: 3 / 12, R, wait: raise * 0.7, update: still });
    s2.light(x, y, z, 1.8 * sz * sg, S(R, 0.7), 0.7, 0.3);
    s2.light(x, y, z, 1.4 * sz * sg, S(R, 0.6), 0.4, life - 0.2, { swell: true });
    // a faint arc on the floor under it, the ward's footprint
    s2.add({ k: "ring", x: T.x, y: T.y, r: 0.85 * sz, life: 0.45, R, broken: true, seed: sd(s2), update: still });
    // the hold: motes drift off the face
    s2.emit(s2.t + raise, s2.t + life - 0.25, (s3, u, dt) => {
      for (let i = s3.count(14 * g, dt); i > 0; i--) {
        const a = s3.rand(0, TAU), rr = s3.rand(0.6, 1) * r;
        s3.add({ k: "mote", x: x - uy * Math.cos(a) * rr, y: y + ux * Math.cos(a) * rr, z: z + Math.sin(a) * rr * ct, vx: ux * s3.rand(0.2, 0.6), vy: uy * s3.rand(0.2, 0.6), vz: s3.rand(0.3, 0.8), drag: 1.6, life: s3.rand(0.4, 0.7), R, plus: s3.R() < 0.2, minor: i > 1 });
      }
    });
  });
  if (form === "block") {
    const hit = t + hitAt;
    // the blow: a heavy streak driving in along the facing
    s.at(hit - 2 / 12, (s2) => {
      for (let i = 0; i < 3; i++) {
        const off = (i - 1) * 0.12, sx = wx + ux * 1.4 - uy * off, sy = wy + uy * 1.4 + ux * off, life2 = 2 / 12;
        s2.add({ k: "streak", x: sx, y: sy, z: wz + 0.1, vx: -ux * 8.4, vy: -uy * 8.4, vz: -0.6, life: life2, R: RAMP.kinetic, minor: i !== 1, update(p, _s, dt) { p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; } });
      }
    });
    s.at(hit, (s2) => {
      s2.freeze = Math.max(s2.freeze, crit ? 0.12 : 0.08);
      s2.add({ k: "flash", x: wx, y: wy, z: wz, life: 2 / 12, r: (crit ? 9 : 6) * Math.sqrt(sz), R, update: still });
      s2.add({ k: "star", x: wx, y: wy, z: wz, L: crit ? 10 : 7, life: 3 / 12, R, update: still });
      glance(s2, crit ? RAMP.fire : RAMP.vitality, wx, wy, wz, ux, uy, crit ? 20 : 14, 5, 11);
      for (let i = 0; i < (crit ? 10 : 6); i++) {
        const q = Math.atan2(uy, ux) + s2.rand(-1.1, 1.1), sp = s2.rand(1.5, 3.5);
        s2.add({ k: "shard", x: wx, y: wy, z: wz, vx: Math.cos(q) * sp, vy: Math.sin(q) * sp, vz: s2.rand(1, 2.5), g: 11, drag: 0.8, bounce: 0.35, life: s2.rand(0.5, 0.9), R, seed: s2.R(), minor: i > 3 });
      }
      s2.add({ k: "ring", x: wx, y: wy, r: 0.75 * Math.sqrt(sz), life: 0.3, R, seed: sd(s2), update: still });
      s2.light(wx, wy, wz, 1.6 * sz, S(RAMP.vitality, 0.7), 0.7, 0.2);
      s2.light(wx, wy, wz, 0.8, S(R, 0.9), 0.8, 0.08);
      s2.shake = Math.max(s2.shake, crit ? 2.4 : 1.5);
      if (crit) s2.at(s2.t + life - hitAt - 0.22, (s3) => {
        // a critical blow breaks the shield: the disc shatters
        for (let i = 0; i < 14; i++) { const q = (i / 14) * TAU; s3.add({ k: "shard", x: x - uy * Math.cos(q) * r * 0.7, y: y + ux * Math.cos(q) * r * 0.7, z: z + Math.sin(q) * r * 0.6, vx: ux * s3.rand(-1, 1.5) - uy * Math.cos(q) * 1.5, vy: uy * s3.rand(-1, 1.5) + ux * Math.cos(q) * 1.5, vz: s3.rand(0.5, 2), g: 10, drag: 0.8, bounce: 0.3, life: s3.rand(0.5, 0.8), R, seed: s3.R(), minor: i % 2 === 1 }); }
      });
      else s2.at(s2.t + life - hitAt - 0.3, (s3) => sparkleOut(s3, R, x, y, z, r * 0.7, 8, 1));
    });
  } else if (form === "counter") {
    // the hostile glyph flies in from the threat's side and is caught
    const fly = 0.3, from = threat ? { x: lerp(x, threat.x, 0.75), y: lerp(y, threat.y, 0.75) } : { x: x + ux * 2.6, y: y + uy * 2.6 };
    const g0 = Math.floor(s.R() * GLYPHS.length);
    s.at(t + hitAt - fly, (s2) => s2.add({ k: "waThread", a: [from.x, from.y, z + 0.2], b: [from.x, from.y, z + 0.2], amp: 0, ph: 0, tension: 0, R: R2, rune: true, big: true, g: g0, life: fly, update(p, s3, dt) {
      const f = clamp(p.age / fly), e = f * f;
      p.b = [lerp(from.x, wx, e), lerp(from.y, wy, e), lerp(z + 0.2, wz, e)];
      const tl = Math.max(0, e - 0.25);
      p.a = [lerp(from.x, wx, tl), lerp(from.y, wy, tl), lerp(z + 0.2, wz, tl)];
      for (let i = s3.count(60, dt); i > 0; i--) s3.add({ k: "mote", x: p.b[0] + s3.rand(-0.12, 0.12), y: p.b[1] + s3.rand(-0.12, 0.12), z: p.b[2], vz: s3.rand(-0.2, 0.3), drag: 2, life: s3.rand(0.2, 0.4), R: R2, minor: i > 1 });
      if (!p.lit) { p.lit = true; s3.light(p.b[0], p.b[1], p.b[2], 1, S(R2, 0.75), 0.6, fly); }
    } }));
    s.at(t + hitAt, (s2) => {
      s2.freeze = Math.max(s2.freeze, 0.06);
      s2.add({ k: "flash", x: wx, y: wy, z: wz, life: 2 / 12, r: (crit ? 8 : 6) * Math.sqrt(sz), R, update: still });
      s2.add({ k: "star", x: wx, y: wy, z: wz, L: 8, life: 3 / 12, R: R2, update: still });
      // the glyph shatters: its strokes fly apart in its own colour
      for (let i = 0; i < 12; i++) {
        const q = (i / 12) * TAU + s2.rand(-0.2, 0.2), sp = s2.rand(1.5, 3.2);
        s2.add({ k: i % 3 ? "shard" : "spark", x: wx, y: wy, z: wz, vx: Math.cos(q) * sp + ux * 1.2, vy: Math.sin(q) * sp * 0.7 + uy * 1.2, vz: s2.rand(0.5, 2.5), g: 9, drag: 1, bounce: 0.3, life: s2.rand(0.4, 0.75), R: R2, seed: s2.R(), minor: i % 2 === 1 });
      }
      glance(s2, R, wx, wy, wz, ux, uy, 10, 4, 9);
      s2.add({ k: "ring", x: wx, y: wy, r: 0.9, life: 0.35, R: R2, broken: true, seed: sd(s2), update: still });
      s2.light(wx, wy, wz, 2 * sz, S(R2, 0.75), 0.9, 0.25);
      s2.shake = Math.max(s2.shake, 1.2);
      // the ward pops once its work is done
      s2.at(s2.t + life - hitAt - 0.25, (s3) => { sparkleOut(s3, R, x, y, z, r * 0.8, 12, 1.6); s3.add({ k: "ring", x: T.x, y: T.y, r: 1.2 * sz, life: 0.4, R, seed: sd(s3), update: still }); });
    });
  } else s.at(t + 0.12 + life - 0.3, (s2) => sparkleOut(s2, R, x, y, z, r * 0.7, Math.round(8 * g), 1));
  return t + (form === "disc" ? 0.12 : 0) + life;
}

function ward(s, M, ctx) {
  const R = rampFor(s, M, RAMP.force), slug = String(s.spec.slug ?? ""), form = formOf(slug);
  // a raised shield is the caster's own: a reaction targets the threat, never the subject
  const reactive = form !== "dome" && ctx.caster;
  const subjects = reactive ? [ctx.caster] : bodies(s, ctx);
  const threat = reactive ? ctx.targets.find((o) => o !== ctx.caster) ?? null : null;
  let end = ctx.t0;
  subjects.forEach((T, i) => {
    const at = reactive ? ctx.t0 : reach(s, ctx, T, ctx.t0 + i * 0.07, R);
    const o = outcomeOf(s, T), g = s.m * (OUT[o] ?? 1);
    s.at(at, (s2) => { end = Math.max(end, form === "dome" ? domeOn(s2, R, ctx, T, g, o === "crit", o === "miss", threat) : discOn(s2, R, ctx, T, g, o === "crit", form, threat)); });
    end = Math.max(end, at + (form === "dome" ? 2.5 : 2.1));
  });
  s.phases.push(`ward: ${form === "dome" ? "a hex dome snaps up, ripples, blinks out" : form === "disc" ? "a disc of force raised in front" : form === "block" ? "a shield raised, a blow caught on it" : "a ward catches a glyph and shatters it"}`);
  s.period = end + 0.6;
}

/* ── dispel ──────────────────────────────────────────────────────────── */

function dispelOn(s, R, ctx, T, g, crit, fail) {
  const sz = T.size, sg = Math.sqrt(g), h = T.h, x = T.x, y = T.y, t = s.t, G = RAMP.neutral;
  const [tx, ty] = ctx.caster && ctx.caster !== T ? (norm(ctx.caster.x - x, ctx.caster.y - y) ?? FRONT) : [-FRONT[0], -FRONT[1]];
  const PULL = 0.5, SNAP = PULL + 0.12, n = Math.round((crit ? 8 : 6) * Math.min(1.25, g));
  // the target's magic shows itself: an orbit of runes flaring round it
  s.add({ k: "waAura", x, y, z: 0.55 * h, sink: 0, r: 0.52 * sz, n: Math.round(5 + 2 * g), rot: s.rand(0, TAU), spin: 2.2, grey: 0, flare: false, life: fail ? 1.7 : 1.9, R, seed: sd(s), update(p) {
    p.flare = fail ? p.age > SNAP && p.age < SNAP + 0.5 : p.age < SNAP;
    if (!fail) { p.grey = clamp((p.age - SNAP) / 0.35); p.sink = clamp((p.age - SNAP - 0.2) / 1) * 0.45 * h; p.spin = p.age > SNAP ? 0.6 : 2.2; }
    else p.spin = p.age > SNAP ? 3.6 : 2.2;
  } });
  s.light(x, y, 0.55 * h, 1.5 * sz, S(R, 0.62), 0.5, SNAP + 0.1, { swell: true });
  // the threads: pulled out of the body toward the caster, stretching thin and trembling
  for (let i = 0; i < n; i++) {
    const q = Math.atan2(ty, tx) + ((i + 0.5) / n - 0.5) * 2.4 + s.rand(-0.15, 0.15), az = s.rand(0.3, 0.85) * h;
    const ax = x + Math.cos(q) * 0.18 * sz, ay = y + Math.sin(q) * 0.18 * sz, L = s.rand(1, 1.5) * sz * sg, lz = s.rand(-0.1, 0.4);
    const bx = x + Math.cos(q) * L, by = y + Math.sin(q) * L, bz = az + lz, ph = s.rand(0, TAU), gl = Math.floor(s.R() * GLYPHS.length);
    const brk = s.rand(0.4, 0.6), snapAt = SNAP + i * 0.035;
    s.add({ k: "waThread", a: [ax, ay, az], b: [ax, ay, az], amp: 1.6, ph, tension: 0, R, rune: true, g: gl, life: snapAt + (fail ? 0.32 : 0), wait: i * 0.03, update(p) {
      const a = p.age;
      if (a < PULL) {
        const f = easeOut(clamp(a / PULL));
        p.b = [lerp(ax, bx, f), lerp(ay, by, f), lerp(az, bz, f)]; p.tension = f; p.amp = lerp(1.6, 0.8, f);
      } else if (fail && a > snapAt) {
        // it holds: the thread snaps back into the body like a rubber band
        const f = clamp((a - snapAt) / 0.18), e = f * f;
        p.b = [lerp(bx, ax, e), lerp(by, ay, e), lerp(bz, az, e)]; p.tension = 1 - f; p.amp = 2.2 * (1 - f);
      } else { p.amp = 0.6 + 0.8 * Math.sin(a * 40); p.tension = 1; }
    } });
    if (fail) continue;
    // the snap: the thread breaks; the loose end whips away and fades, the stub recoils into the body
    s.at(t + i * 0.03 + snapAt, (s2) => {
      const mx = lerp(ax, bx, brk), my = lerp(ay, by, brk), mz = lerp(az, bz, brk);
      s2.add({ k: "waThread", a: [mx, my, mz], b: [bx, by, bz], amp: 2.4, ph, tension: 1, R, rune: true, g: gl, life: 0.38, alpha: 1, update(p) {
        const f = clamp(p.age / 0.38), e = easeOut(f), out = 0.9 * sz;
        p.a = [mx + Math.cos(q) * out * e, my + Math.sin(q) * out * e, mz + e * 0.3]; p.b = [bx + Math.cos(q) * out * 1.4 * e, by + Math.sin(q) * out * 1.4 * e, bz + e * 0.5];
        p.alpha = 1 - f; p.R = f > 0.45 ? G : R;
      } });
      s2.add({ k: "waThread", a: [ax, ay, az], b: [mx, my, mz], amp: 1.5, ph, tension: 0.3, R, rune: false, g: 0, life: 0.22, alpha: 1, update(p) {
        const f = clamp(p.age / 0.22), e = f * f;
        p.b = [lerp(mx, ax, e), lerp(my, ay, e), lerp(mz, az, e)]; p.alpha = 1 - f * 0.6;
      } });
      for (let k = 0; k < 7; k++) {
        const qq = s2.rand(0, TAU), sp = s2.rand(3, 7);
        s2.add({ k: "spark", x: mx, y: my, z: mz, vx: Math.cos(qq) * sp, vy: Math.sin(qq) * sp, vz: s2.rand(0.5, 3.5), g: 12, drag: 2.4, life: s2.rand(0.2, 0.4), R, minor: k > 3 });
      }
      s2.add({ k: "glint", x: mx, y: my, z: mz, life: 5 / 12, R, update: still });
      s2.light(mx, my, mz, 0.9, S(R, 0.8), 0.6, 0.15);
    });
  }
  if (fail) {
    // the magic holds and flares back brighter
    s.at(t + SNAP + 0.2, (s2) => {
      s2.add({ k: "ring", x, y, r: 1.1 * sz * sg, life: 0.4, R, seed: sd(s2), update: still });
      s2.add({ k: "halo", x, y, z: 0.1, vz: 1.2, drag: 1, life: 0.6, r: 0.48 * sz, R });
      sparkleOut(s2, R, x, y, 0.55 * h, 0.4 * sz, 10, 1.6);
      s2.light(x, y, 0.55 * h, 2 * sz, S(R, 0.75), 0.9, 0.5);
      s2.hit(T.id, 0.2, { x: x + tx, y: y + ty }, R);
    });
    s.phases.push("dispel: threads pulled, they snap back, the magic holds");
    return t + SNAP + 1.2;
  }
  // unwoven: one bright beat, then the aura greys and sinks as ash
  s.at(t + SNAP + n * 0.035 + 0.05, (s2) => {
    if (crit) s2.add({ k: "flash", x, y, z: 0.55 * h, life: 2 / 12, r: 0.3 * sz * s2.spec.aps, R, update: still });
    s2.add({ k: "star", x, y, z: 0.6 * h, L: crit ? 9 : 6, life: 3 / 12, R, update: still });
    s2.add({ k: "ring", x, y, r: 1.4 * sz * sg, life: 0.45, R, seed: sd(s2), update: still });
    if (crit) s2.add({ k: "ring", x, y, r: 2 * sz * sg, life: 0.6, R, broken: true, seed: sd(s2), wait: 0.08, update: still });
    s2.add({ k: "ring", x, y, r: 0.8 * sz, life: 0.9, R: G, broken: true, seed: sd(s2), wait: 0.2, update: still });
    s2.light(x, y, 0.55 * h, 1.8 * sz * sg, S(R, 0.62), 0.7, 0.25);
    s2.hit(T.id, 0.3, { x: x + tx, y: y + ty }, R);
    s2.shake = Math.max(s2.shake, crit ? 1.6 : 0.8);
    s2.emit(s2.t + 0.1, s2.t + 1.1, (s3, u, dt) => {
      for (let i = s3.count(22 * g * (1 - u * 0.5), dt); i > 0; i--) s3.add({ k: s3.R() < 0.7 ? "ember" : "mote", x: x + s3.rand(-0.45, 0.45) * sz, y: y + s3.rand(-0.3, 0.3) * sz, z: s3.rand(0.3, 1) * h, vz: s3.rand(-0.6, -0.2), vx: s3.rand(-0.2, 0.2), drag: 1.2, life: s3.rand(0.5, 0.9), R: s3.R() < 0.75 ? G : RAMP.smoke, seed: s3.R(), minor: i > 1 });
    });
  });
  s.phases.push("dispel: threads pulled out, stretched, snapped; the aura greys");
  return t + SNAP + 1.5;
}

function dispel(s, M, ctx) {
  const R = rampFor(s, M, RAMP.arcane);
  let end = ctx.t0;
  bodies(s, ctx).forEach((T, i) => {
    const at = reach(s, ctx, T, ctx.t0 + i * 0.08, R), o = outcomeOf(s, T);
    s.at(at, (s2) => { end = Math.max(end, dispelOn(s2, R, ctx, T, s2.m * (OUT[o] ?? 1), o === "crit", o === "miss")); });
    end = Math.max(end, at + 2);
  });
  s.period = end + 0.5;
}

/* ── detect ──────────────────────────────────────────────────────────── */

function detect(s, M, ctx) {
  const R = rampFor(s, M, RAMP.arcane), o = ctx.caster ?? bodies(s, ctx)[0];
  if (!o) { s.period = 1; return; }
  const others = ctx.targets.filter((T) => T !== o);
  const far = others.reduce((m, T) => Math.max(m, Math.hypot(T.x - o.x, T.y - o.y) + 0.5 * (T.size ?? 1)), 0);
  const ar = ctx.area ? (ctx.area.r ?? ctx.area.len ?? 3) : 0;
  const r = ar ? clamp(ar, 2, 8) : clamp(far, 3, 4.5), dur = 0.55 + r * 0.05, t0 = ctx.t0, sg = Math.sqrt(s.m), oz = 1.35 * o.h + 0.12;
  // the eye opens over the caster, then the pulse goes out
  s.at(t0, (s2) => {
    s2.add({ k: "waEye", x: o.x, y: o.y, z: oz, w: 8, hh: 4, open: 0, life: dur + 0.65, R, update(p) { p.open = backOut(clamp(p.age / 0.16), 1.4); if (p.age > p.life - 0.15) p.open = clamp((p.life - p.age) / 0.15); } });
    s2.add({ k: "glint", x: o.x, y: o.y, z: oz, life: 5 / 12, R, big: true, wait: 0.12, update: still });
    s2.light(o.x, o.y, oz, 1.1, S(R, 0.75), 0.6, dur + 0.4);
  });
  s.at(t0 + 0.12, (s2) => {
    s2.add({ k: "waPulse", x: o.x, y: o.y, r, dur, tail: 0.3, band: 0.55, n: 16, rot: s2.rand(0, TAU), life: dur + 0.32, R, update: still });
    if (s2.m >= 1.1) s2.add({ k: "waPulse", x: o.x, y: o.y, r: r * 0.97, dur: dur * 1.1, tail: 0.25, band: 0.3, n: 0, rot: 0, tone: 0.55, thin: true, life: dur * 1.1 + 0.27, R, wait: 0.12, minor: true, update: still });
    s2.add({ k: "ring", x: o.x, y: o.y, r: 0.6 * o.size, life: 0.3, R, seed: sd(s2), update: still });
    s2.light(o.x, o.y, 0.3, 1.6 * o.size, S(R, 0.7), 0.7, 0.3);
  });
  // where the pulse finds someone: brackets snap on, a glint, a small ring
  const at = (d) => t0 + 0.12 + (1 - Math.cbrt(1 - clamp(d / r))) * dur;
  for (const T of others) {
    // a creature past the ring is still found: it pings as the sweep ends
    const d = Math.hypot(T.x - o.x, T.y - o.y);
    s.at(at(Math.min(d, r)), (s2) => {
      s2.add({ k: "waMark", x: T.x, y: T.y, z: 0.5 * T.h, r: 0.5 * T.size, h: T.h, life: 0.75, R, update: still });
      s2.add({ k: "glint", x: T.x, y: T.y, z: 1.15 * T.h, life: 5 / 12, R, big: true, update: still });
      s2.add({ k: "ring", x: T.x, y: T.y, r: 0.55 * T.size, life: 0.4, R, seed: sd(s2), update: still });
      for (let i = 0; i < 3; i++) s2.add({ k: "mote", x: T.x + s2.rand(-0.3, 0.3) * T.size, y: T.y + s2.rand(-0.2, 0.2), z: s2.rand(0.3, 1) * T.h, vz: s2.rand(0.3, 0.7), drag: 1.5, life: 0.5, R, minor: true });
      s2.light(T.x, T.y, 0.6 * T.h, 1.1 * T.size, S(R, 0.75), 0.6, 0.4);
    });
  }
  // a few traces the sweep turns up on the floor as it passes
  const nTr = Math.round(3 * sg);
  for (let i = 0; i < nTr; i++) {
    const q = s.rand(0, TAU), d = s.rand(0.4, 0.9) * r;
    s.at(at(d), (s2) => s2.add({ k: "glint", x: o.x + Math.cos(q) * d, y: o.y + Math.sin(q) * d, z: 0.05, life: 5 / 12, R, minor: true, update: still }));
  }
  s.phases.push("detect: an eye opens, a pulse sweeps out, what it finds pings");
  s.period = t0 + 0.12 + dur + 0.5;
}

export default { ward, dispel, detect };
