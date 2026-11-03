/**
 * Spellsprite — forms: what a spell that does not harm looks like.
 *
 * A form is `(s, M, ctx) => void`, ctx:
 *   caster, targets, area   bodies and the area (squares)
 *   hand                    where the charge gathered, or null
 *   t0                      when the charge ends
 *   self                    true when the spell targets only its caster
 *   release, linger, fire   compile.mjs helpers
 *
 * Forms are tinted by the spell's material, so a fire ward and a cold ward are
 * the same shell in different light. Set `s.period` before returning.
 *
 *   restore    light rises through the target, plus-motes, a soft pulse
 *   support    motes spiral up the body and pop into a halo
 *   protect    a hex barrier shimmers shut round the target (Shield)
 *   hinder     a weight drops on the head, motes fall, a rune ring binds the feet
 *   control    chains cinch in, stiff shards, a binding glyph
 *   conceal    a puff, then a wavering outline where the body was
 *   detect     a radar sweep from the caster; sparkles where it finds someone
 *   summon     a circle, a column of the material, a creature-sized puff
 *   terrain    the material's linger rising across the area in wave order (on a
 *              single target with no area: a decal spreading round it)
 *
 * With an area, compile.mjs's `areaFX` draws the footprint, the flash, the
 * edge and the scar; a form only puts its own motifs on top (motes, halos,
 * glyphs), at the targets or at creature-sized points spread across the area.
 *   teleport   a slit folds the caster away and opens at the destination
 *              (the area's centre, or the first target)
 *   movement   gusts and afterimages (fly, haste, speed)
 *   transform  a cocoon of the material wraps the body and bursts
 *   neutral    a small, clean pulse
 */

import { TAU, clamp, lerp, easeOut, hash, fadeOut } from "./core/rand.mjs";
import { RAMP, S } from "./core/palette.mjs";
import { registerShapes } from "./core/shapes.mjs";
import { still, sd, lobes } from "./core/motifs.mjs";
import { ICONS } from "./conditions.mjs";
import { areaGeom, areaPoints } from "./area.mjs";

/* ── shapes only the forms draw ──────────────────────────────────────── */

const SQ3 = Math.sqrt(3);

/** Distance metric to the nearest pointy-top hex cell's edge (1 on the edge, 0 at its centre). */
function hexEdge(x, y, s) {
  const q = (SQ3 / 3 * x - y / 3) / s, r = (2 / 3 * y) / s;
  let rx = Math.round(q), rz = Math.round(r), ry = Math.round(-q - r);
  const dx = Math.abs(rx - q), dz = Math.abs(rz - r), dy = Math.abs(ry + q + r);
  if (dx > dy && dx > dz) rx = -ry - rz; else if (dz > dy) rz = -rx - ry;
  const cx = s * (SQ3 * rx + (SQ3 / 2) * rz), cy = s * 1.5 * rz, lx = Math.abs(x - cx), ly = Math.abs(y - cy), inr = s * SQ3 / 2;
  return Math.max(lx, lx * 0.5 + ly * (SQ3 / 2)) / inr;
}

registerShapes({
  /** Protect: a dome of hex cells that builds bottom to top, a light band sweeping down it. */
  fmHex(v, P, p) {
    const u = clamp(p.age / p.life), [cx, cy] = v.ap(p.x, p.y, p.z), r = p.r, ry = r * (v.kind === "top" ? 1 : 1.05);
    const reveal = clamp(p.age / 0.22), a = fadeOut(u, 0.55), cell = p.cell ?? 6, band = 1.15 - ((p.age * 1.4) % 1.6);
    P.shade(cx - r - 1, cy - ry - 1, cx + r + 1, cy + ry + 1, (x, y) => {
      const dx = x - cx, dy = y - cy, d = Math.hypot(dx / r, dy / ry);
      if (d > 1) return null;
      const yy = (dy / ry + 1) / 2;
      if (1 - yy > reveal * 1.05) return null;
      if (d > 1 - 1.4 / r) return { c: S(p.R, 0.95), a };
      // the cells show where the dome curves away (its rim), where the light band
      // sweeps, and in a lit cap at the top left; the middle stays clear
      const near = Math.abs(yy - band) < 0.08, lit = (dx + dy) / r < -0.75, m = hexEdge(dx, dy, cell);
      if (m > 1 - 1.2 / (cell * 0.87)) {
        if (near) return { c: S(p.R, 1), a };
        if (d > 0.72 || lit) return { c: S(p.R, 0.82), a: a * 0.5 };
        return null;
      }
      return near || d > 0.86 ? { c: S(p.R, 0.62), a: a * 0.25 } : null;
    }, 0, "mix");
  },

  /** Teleport: a tall lens of light that folds a body away or opens one up. */
  fmSlit(v, P, p) {
    const u = clamp(p.age / p.life), fr = Math.floor(p.age * 12), [bx, by] = v.ap(p.x, p.y, 0), [, ty] = v.ap(p.x, p.y, p.h * (v.kind === "top" ? 3 : 1));
    const W = p.w * (p.open ? Math.sin(Math.PI * u) ** 0.7 : (1 - u) ** 2) * (1 + 0.12 * (fr % 2));
    const H = Math.max(3, by - ty);
    if (v.kind === "top") {
      const r = Math.max(0.5, W * 1.6);
      P.ellipse(bx, by, r, r, () => S(p.R, 1), 2);
      P.ellipse(bx, by, r + 2, r + 2, (q) => (Math.floor(q * 4 + fr) % 2 ? S(p.R, 0.72) : null), 2);
      return;
    }
    for (let j = 0; j <= H; j++) {
      const f = j / H, hw = W * Math.sin(Math.PI * f) ** 0.6;
      if (hw < 0.3) { if (W > 0.3) P.px(bx, by - j, S(p.R, 0.9), 2); continue; }
      for (let i = Math.floor(-hw); i <= Math.ceil(hw); i++) {
        const e = Math.abs(i) / hw; if (e > 1) continue;
        P.px(bx + i, by - j, S(p.R, e < 0.4 ? 1 : e < 0.75 ? 0.85 : 0.6), 2);
      }
    }
  },

  /** Movement: a translucent afterimage of a body, left behind and fading. */
  fmGhost(v, P, p) {
    const u = clamp(p.age / p.life), a = (p.a ?? 0.5) * (1 - u), [bx, by] = v.ap(p.x, p.y, 0);
    if (a < 0.1) return;
    const c = S(p.R, 0.72), rim = S(p.R, 0.92);
    if (v.kind === "top") {
      const r = 0.42 * p.size * v.aps;
      P.shade(bx - r, by - r, bx + r, by + r, (x, y) => { const d = Math.hypot(x - bx, y - by) / r; return d > 1 ? null : { c: d > 0.82 ? rim : c, a }; }, 0, "mix");
      return;
    }
    const G = v.aps, hh = p.h * G, hr = 0.13 * p.size * G, hy = by - hh * 0.86;
    P.shade(bx - 0.3 * G, hy - hr - 1, bx + 0.3 * G, by, (x, y) => {
      const up = (by - y) / hh, dx = Math.abs(x - bx);
      if (Math.hypot(x - bx, y - hy) <= hr) return { c, a };
      if (up < 0.04 || up > 0.74) return null;
      const w = (up > 0.32 ? lerp(0.23, 0.17, (up - 0.32) / 0.42) : 0.12) * p.size * G;
      return dx > w ? null : { c: dx > w - 1 ? rim : c, a };
    }, 0, "mix");
  },

  /** Transform: a cocoon wound round the body from the feet up, its wrap turning. */
  fmCocoon(v, P, p) {
    const fr = Math.floor(p.age * 12), grow = clamp(p.age / 0.4), [bx, by] = v.ap(p.x, p.y, 0);
    const G = v.aps, top = v.kind === "top";
    const cx = bx, cy = top ? by : by - p.h * G * 0.5, rx = (top ? 0.46 : 0.3) * p.size * G, ry = top ? rx : p.h * G * 0.56;
    const crack = p.age > p.life - 0.2;
    P.shade(cx - rx - 1, cy - ry - 1, cx + rx + 1, cy + ry + 1, (x, y) => {
      const dx = (x - cx) / rx, dy = (y - cy) / ry, d = dx * dx + dy * dy;
      if (d > 1) return null;
      if (!top && (1 - (dy + 1) / 2) > grow) return null;
      if (crack && Math.abs(dx * 3 + Math.sin(dy * 7) * 0.6) < 0.2) return S(p.R, 1);
      if (d > 0.82) return S(p.R, dx + dy < 0 ? 0.9 : 0.55);
      const band = (((x + y * 0.8 + fr * 1.5) % 5) + 5) % 5;
      return S(p.R, band < 2 ? 0.82 : band < 3 ? 0.62 : 0.45);
    }, 1);
  },

  /** Detect: a radar sweep, a bright arm trailing a fading wedge, inside a dashed rim. */
  fmScan(v, P, p) {
    const u = clamp(p.age / p.life), fr = Math.floor(p.age * 12), [cx, cy] = v.ap(p.x, p.y, 0), r = p.r * v.aps * easeOut(clamp(p.age / 0.3)), ry = r * v.sq;
    if (r < 2) return;
    const a = fadeOut(u, 0.7), arm = p.q0 + p.w * p.age;
    P.ellipse(cx, cy, r, ry, (q) => (Math.floor((q / TAU) * r * 0.9 + fr) % 3 === 2 ? null : { c: S(p.R, 0.85), a }));
    P.shade(cx - r, cy - ry, cx + r, cy + ry, (x, y) => {
      const dx = (x - cx) / r, dy = (y - cy) / Math.max(1, ry), d = dx * dx + dy * dy;
      if (d > 1 || d < 0.01) return null;
      const behind = ((((arm - Math.atan2(dy, dx)) % TAU) + TAU) % TAU);
      if (behind > 1.1) return null;
      return { c: S(p.R, behind < 0.12 ? 0.95 : 0.7), a: a * (behind < 0.12 ? 1 : behind < 0.5 ? 0.5 : 0.25) };
    }, 0, "mix");
  },

  /** Terrain: a patch that spreads from a point across the ground, tiled in the material. */
  fmSpread(v, P, p) {
    const u = clamp(p.age / p.life), [cx, cy] = v.ap(p.x, p.y, 0), rx = p.r * v.aps * easeOut(clamp(p.age / 0.8)), ry = rx * v.sq;
    if (rx < 2) return;
    const a = fadeOut(u, 0.65);
    P.shade(cx - rx - 3, cy - ry - 3, cx + rx + 3, cy + ry + 3, (x, y, ix, iy) => {
      const dx = (x - cx) / rx, dy = (y - cy) / Math.max(1, ry), d = Math.hypot(dx, dy), q = Math.atan2(dy, dx);
      const e = 0.82 + 0.25 * hash(Math.floor((q / TAU) * 14 + 14), 1, p.seed);
      if (d > e) return null;
      if (d > e - 0.08) return { c: S(p.R, 0.85), a };
      const cell = hash(ix >> 2, iy >> 1, p.seed), seam = (ix & 3) === 0 || (iy & 1) === 0 && cell < 0.3;
      return { c: S(p.R, seam ? 0.3 : 0.45 + cell * 0.15), a: a * (seam ? 0.5 : 0.25) };
    }, 0, "mix");
  },
}, { flat: ["fmScan", "fmSpread"] });

/* ── helpers ─────────────────────────────────────────────────────────── */

/**
 * Every creature a form lands on. With an area and nobody in it, a few
 * creature-sized stand-ins spread across the area in wave order: the area's
 * own footprint, flash and edge are compile.mjs's `areaFX`, so a form never
 * draws a body the size of the area (that would be a second footprint).
 */
const subjects = (ctx, s) => {
  if (ctx.targets.length) return ctx.targets;
  if (ctx.area) {
    const got = s ? areaPoints(areaGeom(ctx.area), 4, () => s.R()).pts : [];
    const pts = got.length ? got : [{ x: ctx.area.x, y: ctx.area.y }];
    return pts.map((p) => ({ x: p.x, y: p.y, size: 1, h: 1, id: null }));
  }
  return ctx.caster ? [ctx.caster] : [];
};
const norm = (x, y) => { const l = Math.hypot(x, y) || 1; return [x / l, y / l]; };
/** Hinder's weight: a kettlebell big enough to read as one over a token's head. */
const WEIGHT = Object.freeze(["..333..", ".3...3.", ".11111.", "1122211", "1211111", "1111112", ".22222."]);

/** A bright travel line from the hand to each target before the form lands, unless self. */
function reach(s, M, ctx, T, at) {
  if (ctx.self || !ctx.hand) return at;
  const dur = Math.min(0.5, 0.2 + Math.hypot(T.x - ctx.hand[0], T.y - ctx.hand[1]) * 0.03);
  s.at(at, (s2) => s2.add({
    k: "mote", x: ctx.hand[0], y: ctx.hand[1], z: ctx.hand[2], life: dur, R: M.R, plus: true, glow: true,
    update(p, s3, dt) {
      const u = Math.min(1, p.age / dur);
      p.x = ctx.hand[0] + (T.x - ctx.hand[0]) * u; p.y = ctx.hand[1] + (T.y - ctx.hand[1]) * u; p.z = ctx.hand[2] + (0.7 * T.h - ctx.hand[2]) * u + Math.sin(Math.PI * u) * 0.4;
      for (let i = s3.count(40, dt); i > 0; i--) s3.add({ k: "mote", x: p.x, y: p.y, z: p.z, vz: s3.rand(-0.2, 0.3), drag: 2, life: s3.rand(0.25, 0.45), R: M.R, minor: true });
    },
  }));
  return at + dur;
}

/** Run `land(s2, T)` on every subject when the reach arrives; returns the latest landing. */
function each(s, M, ctx, land) {
  let end = ctx.t0;
  subjects(ctx, s).forEach((T, i) => {
    const at = reach(s, M, ctx, T, ctx.t0 + i * 0.06);
    s.at(at, (s2) => land(s2, T));
    end = Math.max(end, at);
  });
  return end;
}

/* ── the forms ───────────────────────────────────────────────────────── */

function restore(s, M, ctx) {
  const end = each(s, M, ctx, (s2, T) => {
    s2.add({ k: "beam", x: T.x, y: T.y, h: 2 * T.h, w: 3 * Math.sqrt(T.size), life: 0.9, R: M.R, update: still });
    for (let i = 0; i < 16; i++) s2.add({ k: "mote", x: T.x + s2.rand(-0.4, 0.4) * T.size, y: T.y + s2.rand(-0.3, 0.3) * T.size, z: s2.rand(0, 0.4), vz: s2.rand(0.6, 1.6), g: -0.3, drag: 1.4, life: s2.rand(0.8, 1.4), R: M.R, plus: s2.R() < 0.6, minor: i % 4 === 3 });
    for (let i = 0; i < 3; i++) s2.add({ k: "icon", bm: ICONS.plus, x: T.x + (i - 1) * 0.25 * T.size, y: T.y - 0.1, z: (0.5 + (i % 2) * 0.25) * T.h, vz: 0.55, drag: 0.5, life: 1.1, R: M.R, snap: false, wait: 0.1 + i * 0.12 });
    s2.add({ k: "ring", x: T.x, y: T.y, r: 0.7 * T.size, life: 0.8, R: M.R, seed: 1, update: still });
    for (let i = 0; i < 2; i++) s2.add({ k: "halo", x: T.x, y: T.y, z: 0.05, vz: 1, drag: 0.8, life: 0.9, r: 0.45 * T.size, R: M.R, wait: i * 0.15 });
    s2.light(T.x, T.y, 0.6, 1.6 * T.size, S(M.R, 0.85), 0.5, 0.35, { swell: true });
    s2.at(s2.t + 0.35, (s3) => s3.light(T.x, T.y, 0.6, 1.6 * T.size, S(M.R, 0.85), 0.9, 1));
  });
  s.phases.push("restore: light rises, plus-motes, a soft pulse");
  s.period = end + 2;
}

function support(s, M, ctx) {
  const end = each(s, M, ctx, (s2, T) => {
    const N = 14, rise = 0.55;
    for (let i = 0; i < N; i++) {
      const ph = (i / N) * TAU * 2, z0 = (i / N) * 0.2;
      s2.add({ k: "mote", x: T.x, y: T.y, z: z0, life: rise, R: M.R, plus: i % 3 === 0, wait: (i / N) * 0.12, update(p) {
        const f = clamp(p.age / rise), q = ph + f * TAU * 1.5, r = (0.42 - 0.3 * f) * T.size;
        p.x = T.x + Math.cos(q) * r; p.y = T.y + Math.sin(q) * r * 0.5; p.z = z0 + f * 1.15 * T.h;
      } });
    }
    s2.at(s2.t + rise + 0.1, (s3) => {
      s3.add({ k: "halo", x: T.x, y: T.y, z: 1.15 * T.h, life: 0.75, r: 0.26 * T.size, R: M.R, update: still });
      s3.add({ k: "glint", x: T.x, y: T.y, z: 1.2 * T.h, life: 5 / 12, R: M.R, big: true, update: still });
      for (let i = 0; i < 6; i++) { const q = (i * TAU) / 6; s3.add({ k: "mote", x: T.x, y: T.y, z: 1.15 * T.h, vx: Math.cos(q) * 1.4, vy: Math.sin(q) * 0.6, vz: s3.rand(-0.2, 0.4), drag: 3, life: 0.5, R: M.R, minor: i % 2 === 1 }); }
      s3.add({ k: "ring", x: T.x, y: T.y, r: 0.55 * T.size, life: 0.6, R: M.R, seed: 4, update: still });
      s3.light(T.x, T.y, 1, 1.3 * T.size, S(M.R, 0.85), 0.7, 0.8);
    });
  });
  s.phases.push("support: a spiral of motes, a halo pops");
  s.period = end + 2;
}

function protect(s, M, ctx) {
  const end = each(s, M, ctx, (s2, T) => {
    const r = 0.62 * Math.sqrt(T.size) * s2.spec.aps;
    s2.add({ k: "fmHex", x: T.x, y: T.y, z: 0.5 * T.h, r, life: 1.2, R: M.R, update: still });
    s2.add({ k: "ring", x: T.x, y: T.y, r: 0.62 * T.size, life: 0.6, R: M.R, seed: 5, update: still });
    for (let i = 0; i < 4; i++) {
      const q = -Math.PI / 2 + (i - 1.5) * 0.7;
      s2.add({ k: "glint", x: T.x + Math.cos(q) * 0.5 * T.size, y: T.y - 0.05, z: 0.5 * T.h - Math.sin(q) * 0.45 * T.h, life: 5 / 12, R: M.R, wait: 0.18 + i * 0.07, update: still });
    }
    s2.light(T.x, T.y, 0.6, 1.2 * T.size, S(M.R, 0.85), 0.55, 1);
  });
  s.phases.push("protect: a hex barrier shimmers shut");
  s.period = end + 1.8;
}

function hinder(s, M, ctx) {
  const end = each(s, M, ctx, (s2, T) => {
    const top = 2.1 * T.h, land = 1.18 * T.h;
    s2.add({ k: "icon", bm: WEIGHT, x: T.x, y: T.y - 0.28 * T.size, z: top, life: 1.3, R: M.R, snap: false, from: 0.75, update(p, s3) {
      const f = clamp(p.age / 0.22);
      p.z = f < 1 ? lerp(top, land, f * f) : land + Math.max(0, 0.06 - (p.age - 0.22) * 0.4) * Math.abs(Math.sin((p.age - 0.22) * 30));
      if (f >= 1 && !p.thud) { p.thud = true; s3.hit(T.id, 0.5, { x: T.x, y: T.y - 1 }, M.R); s3.shake = Math.max(s3.shake, 0.8); }
    } });
    for (let i = 0; i < 12; i++) s2.add({ k: "wisp", x: T.x + s2.rand(-0.3, 0.3) * T.size, y: T.y + s2.rand(-0.2, 0.2), z: s2.rand(0.7, 1.3) * T.h, vz: -s2.rand(0.5, 1), drag: 1.2, life: s2.rand(0.6, 1), s: 2, R: M.R, wait: 0.2 + s2.rand(0, 0.3) });
    s2.add({ k: "glyph", x: T.x, y: T.y, r: 0.52 * T.size, life: 1.5, R: M.R, spin: -0.5, wait: 0.2, update: still });
  });
  s.phases.push("hinder: a weight drops, motes fall, a rune ring binds");
  s.period = end + 2;
}

function control(s, M, ctx) {
  const end = each(s, M, ctx, (s2, T) => {
    for (const [z, r] of [[0.32, 0.3], [0.64, 0.27]]) {
      const r0 = r + 0.5;
      s2.add({ k: "cnBand", style: "chain", x: T.x, y: T.y, z: z * T.h, r: r0 * T.size, life: 1.6, R: M.R, topSkip: z > 0.5, update(p) { p.r = lerp(r0, r, easeOut(clamp(p.age / 0.28))) * T.size; } });
    }
    s2.add({ k: "glyph", x: T.x, y: T.y, r: 0.55 * T.size, life: 1.6, R: M.R, star: true, spin: -1, update: still });
    for (let i = 0; i < 5; i++) {
      const q = (i / 5) * TAU + 0.5;
      s2.add({ k: "icon", bm: ICONS.spike, x: T.x + Math.cos(q) * 0.36 * T.size, y: T.y + Math.sin(q) * 0.1, z: (0.25 + (i % 3) * 0.22) * T.h, life: 1.3, R: M.R, wait: 0.28 + i * 0.03, update: still });
    }
    s2.at(s2.t + 0.28, (s3) => { s3.hit(T.id, 0.4, { x: T.x, y: T.y - 1 }, M.R); s3.light(T.x, T.y, 0.6, 1.1 * T.size, S(M.R, 0.85), 0.6, 0.6); });
  });
  s.phases.push("control: chains cinch, stiff shards, a binding glyph");
  s.period = end + 2.1;
}

function conceal(s, M, ctx) {
  const end = each(s, M, ctx, (s2, T) => {
    for (let i = 0; i < 4; i++) s2.add({ k: "smoke", x: T.x + s2.rand(-0.3, 0.3) * T.size, y: T.y + s2.rand(-0.2, 0.2), z: s2.rand(0.1, 0.7) * T.h, vx: s2.rand(-0.5, 0.5), vz: 0.2, drag: 2.5, r: s2.rand(3, 4.5) * Math.sqrt(T.size), life: s2.rand(0.4, 0.55), lobes: [[0, 0, 1], [0.5, 0.2, 0.7], [-0.4, 0.3, 0.6]], R: M.R, tone: 0.5 });
    s2.add({ k: "cnOutline", x: T.x, y: T.y, size: T.size, h: T.h, life: 1.6, R: M.R, wait: 0.25, update: still });
    for (let i = 0; i < 8; i++) s2.add({ k: "glint", x: T.x + s2.rand(-0.4, 0.4) * T.size, y: T.y + s2.rand(-0.2, 0.2), z: s2.rand(0.2, 1) * T.h, life: 5 / 12, R: M.R, wait: s2.rand(0.3, 1.1), minor: i % 2 === 1, update: still });
  });
  s.phases.push("conceal: a puff, then only a shimmer");
  s.period = end + 2.1;
}

function detect(s, M, ctx) {
  const o = ctx.caster ?? subjects(ctx, s)[0];
  if (!o) { s.period = 1; return; }
  const r = Math.max(2, ctx.area?.r ?? 6), w = TAU / 0.9, q0 = -Math.PI / 2, life = 1.8;
  s.at(ctx.t0, (s2) => {
    s2.add({ k: "fmScan", x: o.x, y: o.y, r, q0, w, life, R: M.R, update: still });
    // with an area, areaFX already draws its edge
    if (!ctx.area) s2.add({ k: "ring", x: o.x, y: o.y, r, life: 0.7, R: M.R, seed: 1, update: still });
    s2.light(o.x, o.y, 0.6, 1.6, S(M.R, 0.85), 0.7, 1);
  });
  for (const T of ctx.targets) {
    if (T === o) continue;
    const d = Math.hypot(T.x - o.x, T.y - o.y); if (d > r) continue;
    const ang = Math.atan2(T.y - o.y, T.x - o.x), at = ctx.t0 + ((((ang - q0) % TAU) + TAU) % TAU) / w;
    s.at(at, (s2) => {
      s2.add({ k: "glint", x: T.x, y: T.y, z: 1.1 * T.h, life: 5 / 12, R: M.R, big: true, update: still });
      for (let i = 0; i < 4; i++) s2.add({ k: "glint", x: T.x + s2.rand(-0.35, 0.35), y: T.y, z: s2.rand(0.2, 0.9) * T.h, life: 5 / 12, R: M.R, wait: 0.05 + i * 0.06, minor: true, update: still });
      s2.add({ k: "ring", x: T.x, y: T.y, r: 0.5 * T.size, life: 0.5, R: M.R, seed: 2, update: still });
      s2.light(T.x, T.y, 0.8, 0.9 * T.size, S(M.R, 0.85), 0.6, 0.5);
    });
  }
  s.phases.push("detect: a sweep, sparkles where it finds someone");
  s.period = ctx.t0 + life + 0.4;
}

function summon(s, M, ctx) {
  // the circle is creature-sized, never area-sized: the area's footprint is areaFX's
  const T = ctx.area ? { x: ctx.area.x, y: ctx.area.y, size: 1, h: 1 } : subjects(ctx, s)[0];
  if (!T) { s.period = 1; return; }
  const t1 = ctx.t0 + 0.3, sz = Math.sqrt(T.size);
  s.add({ k: "glyph", x: T.x, y: T.y, r: 0.72 * T.size, life: t1 + 1.5, R: M.R, star: true, update: still });
  s.emit(ctx.t0, t1 + 0.35, (s2, u, dt) => {
    // the column: the material's own trail, rising
    M.mod.trail?.(s2, M, { x: T.x + s2.rand(-0.15, 0.15) * sz, y: T.y + s2.rand(-0.1, 0.1), z: 0.1 + u * 1.6, dt });
    for (let i = s2.count(30, dt); i > 0; i--) s2.add({ k: "mote", x: T.x + s2.rand(-0.3, 0.3) * sz, y: T.y + s2.rand(-0.15, 0.15), z: 0.05, vz: s2.rand(1.5, 2.6), drag: 0.5, life: 0.6, R: M.R, minor: i > 1 });
  });
  s.at(ctx.t0 + 0.05, (s2) => s2.add({ k: "beam", x: T.x, y: T.y, h: 2.6, w: 5 * sz, life: 0.75, R: M.R, update: still }));
  s.at(t1 + 0.35, (s2) => {
    s2.add({ k: "flash", x: T.x, y: T.y, z: 0.6, life: 2 / 12, r: 0.5 * T.size * s2.spec.aps, R: M.R, update: still });
    for (let i = 0; i < 10; i++) {
      const q = (i / 10) * TAU;
      s2.add({ k: "smoke", x: T.x + Math.cos(q) * 0.15 * T.size, y: T.y + Math.sin(q) * 0.1 * T.size, z: 0.15 + (i % 3) * 0.25, vx: Math.cos(q) * 1.4 * sz, vy: Math.sin(q) * 0.7 * sz, vz: 0.25, drag: 3, r: s2.rand(3.5, 5) * sz, life: s2.rand(0.7, 1), lobes: lobes(s2), R: M.R, tone: 0.55 });
    }
    s2.add({ k: "ring", x: T.x, y: T.y, r: 0.75 * T.size, life: 0.6, R: M.R, seed: 8, update: still });
    s2.light(T.x, T.y, 0.6, 2 * T.size, S(M.R, 0.85), 1, 1.2);
    s2.shake = Math.max(s2.shake, 1);
  });
  s.phases.push("summon: a circle, a column of the material, a puff");
  s.period = t1 + 2.4;
}

function terrain(s, M, ctx) {
  if (ctx.area) {
    // areaFX draws the footprint and the scar; the form brings the material up through it, in wave order
    const G = areaGeom(ctx.area), got = areaPoints(G, 8, () => s.R()).pts;
    const pts = got.length ? got : [{ x: G.x, y: G.y, d: 0 }];
    pts.forEach((p) => {
      const at = ctx.t0 + 0.25 + p.d * 0.5;
      s.at(at, (s2) => {
        s2.light(p.x, p.y, 0.3, 1.1, S(M.R, 0.85), 0.35, 0.9);
        M.mod.burst(s2, M, { x: p.x, y: p.y, z: 0.2, pow: 0.4, rad: 0.35, sub: true });
      });
      ctx.linger(s, M, p.x, p.y, 0.5, at, at + 2.2);
    });
    s.phases.push("terrain: the material rises across the area");
    s.period = ctx.t0 + 3.4;
    return;
  }
  const A = ctx.targets[0] ? { x: ctx.targets[0].x, y: ctx.targets[0].y, r: 1 } : null;
  if (!A) { s.period = 1; return; }
  const rad = Math.max(0.6, A.r ?? 1);
  s.at(ctx.t0, (s2) => {
    s2.add({ k: "fmSpread", x: A.x, y: A.y, r: rad, life: 3.4, R: M.R, seed: sd(s2), update: still });
    s2.add({ k: "ring", x: A.x, y: A.y, r: rad, life: 0.9, R: M.R, broken: true, seed: 3, update: still });
    s2.light(A.x, A.y, 0.3, rad * 1.6 + 0.6, S(M.R, 0.85), 0.5, 1.2);
  });
  ctx.linger(s, M, A.x, A.y, rad, ctx.t0 + 0.3, ctx.t0 + 2.8);
  s.phases.push("terrain: the ground changes, spreading out");
  s.period = ctx.t0 + 3.6;
}

function teleport(s, M, ctx) {
  const src = ctx.caster ?? subjects(ctx, s)[0];
  if (!src) { s.period = 1; return; }
  const cand = ctx.area ? { x: ctx.area.x, y: ctx.area.y, size: src.size ?? 1, h: src.h ?? 1, id: null } : ctx.targets.find((T) => T !== src) ?? null;
  const dst = cand ?? src, t1 = ctx.t0 + 0.38, W = 0.32 * (src.size ?? 1) * s.spec.aps;
  s.at(ctx.t0, (s2) => {
    s2.add({ k: "fmSlit", x: src.x, y: src.y, h: 1.05 * src.h, w: W, life: 0.3, R: M.R, update: still });
    for (let i = 0; i < 14; i++) {
      const q = s2.rand(0, TAU), L = 0.7, px = src.x + Math.cos(q) * L, py = src.y + Math.sin(q) * L * 0.6, pz = s2.rand(0.1, 1.1) * src.h, life = 0.22;
      s2.add({ k: "streak", x: px, y: py, z: pz, vx: (src.x - px) / life, vy: (src.y - py) / life, vz: (0.5 * src.h - pz) / life, life, R: M.R, minor: i % 3 === 2, update(p, _s, dt) { p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; } });
    }
    s2.light(src.x, src.y, 0.6, 1.2, S(M.R, 0.85), 0.7, 0.4);
  });
  s.at(ctx.t0 + 0.3, (s2) => s2.add({ k: "star", x: src.x, y: src.y, z: 0.5 * src.h, L: 4, life: 3 / 12, R: M.R, update: still }));
  s.at(t1, (s2) => {
    s2.add({ k: "fmSlit", x: dst.x, y: dst.y, h: 1.05 * (dst.h ?? 1), w: W, open: true, life: 0.42, R: M.R, update: still });
    s2.add({ k: "ring", x: dst.x, y: dst.y, r: 0.6 * (dst.size ?? 1), life: 0.55, R: M.R, seed: 6, update: still });
    for (let i = 0; i < 12; i++) { const q = s2.rand(0, TAU), sp = s2.rand(1.2, 2.4); s2.add({ k: "mote", x: dst.x, y: dst.y, z: s2.rand(0.1, 1) * (dst.h ?? 1), vx: Math.cos(q) * sp, vy: Math.sin(q) * sp * 0.6, vz: s2.rand(-0.2, 0.6), drag: 3, life: s2.rand(0.5, 0.8), R: M.R, plus: i % 4 === 0, minor: i % 3 === 2 }); }
    s2.light(dst.x, dst.y, 0.6, 1.4, S(M.R, 0.85), 0.9, 0.7);
  });
  s.phases.push(cand ? "teleport: fold away, open at the destination" : "teleport: blink in place");
  s.period = t1 + 1.4;
}

function movement(s, M, ctx) {
  const end = each(s, M, ctx, (s2, T) => {
    const [dx, dy] = ctx.caster && T !== ctx.caster ? norm(T.x - ctx.caster.x, T.y - ctx.caster.y) : [1, 0];
    for (let i = 0; i < 3; i++) s2.add({ k: "fmGhost", x: T.x - dx * 0.16 * (i + 1), y: T.y - dy * 0.16 * (i + 1), size: T.size, h: T.h, a: 0.75 - i * 0.25, life: 0.55 + i * 0.1, R: M.R, wait: i * 0.05, update(p, _s, dt) { p.x -= dx * 0.4 * dt; p.y -= dy * 0.4 * dt; } });
    for (let i = 0; i < 14; i++) {
      const z = s2.rand(0.05, 1) * T.h, off = s2.rand(-0.35, 0.35) * T.size, sp = s2.rand(5, 8);
      s2.add({ k: "streak", x: T.x - dx * 0.6 - dy * off, y: T.y - dy * 0.6 + dx * off * 0.5, z, vx: dx * sp, vy: dy * sp, life: s2.rand(0.14, 0.22), R: M.R, wait: s2.rand(0, 0.35), minor: i % 3 === 2, update(p, _s, dt) { p.x += p.vx * dt; p.y += p.vy * dt; } });
    }
    for (let i = 0; i < 3; i++) s2.add({ k: "smoke", x: T.x - dx * 0.2, y: T.y + 0.1, z: 0.04, vx: -dx * s2.rand(0.6, 1.2) + s2.rand(-0.3, 0.3), vy: -dy * 0.5, vz: 0.15, drag: 3, r: s2.rand(2, 3), life: 0.6, lobes: lobes(s2), R: M.R, tone: 0.55 });
    s2.add({ k: "ring", x: T.x, y: T.y, r: 0.55 * T.size, life: 0.5, R: M.R, broken: true, seed: 12, update: still });
    s2.light(T.x, T.y, 0.5, 1 * T.size, S(M.R, 0.85), 0.45, 0.6);
  });
  s.phases.push("movement: gusts and afterimages");
  s.period = end + 1.5;
}

function transform(s, M, ctx) {
  const end = each(s, M, ctx, (s2, T) => {
    const life = 0.85;
    s2.add({ k: "fmCocoon", x: T.x, y: T.y, size: T.size, h: T.h, life, R: M.R, update: still });
    s2.light(T.x, T.y, 0.6, 1.2 * T.size, S(M.R, 0.85), 0.7, life, { swell: true });
    s2.emit(s2.t, s2.t + 0.4, (s3, u, dt) => { for (let i = s3.count(40, dt); i > 0; i--) { const q = s3.rand(0, TAU); s3.add({ k: "mote", x: T.x + Math.cos(q) * 0.5 * T.size, y: T.y + Math.sin(q) * 0.25, z: u * T.h, vx: -Math.cos(q) * 1.2, vy: -Math.sin(q) * 0.6, drag: 2, life: 0.3, R: M.R, minor: i > 1 }); } });
    s2.at(s2.t + life, (s3) => {
      M.mod.burst(s3, M, { x: T.x, y: T.y, z: 0.6 * T.h, pow: 0.8, rad: 0.4 * T.size });
      for (let i = 0; i < 8; i++) { const q = (i / 8) * TAU; s3.add({ k: "shard", x: T.x, y: T.y, z: 0.5 * T.h, vx: Math.cos(q) * 3, vy: Math.sin(q) * 1.5, vz: s3.rand(0.5, 2), g: 8, drag: 1, bounce: 0.3, life: s3.rand(0.5, 0.8), R: M.R, seed: s3.R(), minor: i % 2 === 1 }); }
    });
  });
  s.phases.push("transform: a cocoon, then a burst");
  s.period = end + 0.85 + 2;
}

function neutral(s, M, ctx) {
  const end = each(s, M, ctx, (s2, T) => {
    s2.add({ k: "ring", x: T.x, y: T.y, r: 0.55 * T.size, life: 0.55, R: M.R, seed: 2, update: still });
    s2.add({ k: "halo", x: T.x, y: T.y, z: 0.1, vz: 0.9, drag: 1.2, life: 0.7, r: 0.38 * T.size, R: M.R });
    for (let i = 0; i < 6; i++) s2.add({ k: "mote", x: T.x + s2.rand(-0.3, 0.3) * T.size, y: T.y + s2.rand(-0.2, 0.2), z: s2.rand(0.1, 0.6) * T.h, vz: s2.rand(0.4, 0.9), drag: 1.5, life: s2.rand(0.6, 0.9), R: M.R, minor: i % 2 === 1 });
    s2.add({ k: "glint", x: T.x, y: T.y, z: 1.1 * T.h, life: 5 / 12, R: M.R, big: true, update: still });
    s2.light(T.x, T.y, 0.6, 1 * T.size, S(M.R, 0.85), 0.45, 0.6);
  });
  s.phases.push("a pulse");
  s.period = end + 1.4;
}

export const FORMS = Object.freeze({ restore, support, protect, hinder, control, conceal, detect, summon, terrain, teleport, movement, transform, neutral });

/* ── crafts: mundane skills that must not read as magic ─────────────── */

/** The healing cross, thick enough to read over a token: flat, no glow. */
const CROSS = Object.freeze(["..11..", "..21..", "112211", "111111", "..11..", "..11.."]);

/**
 * Medicine (Battle Medicine, Treat Wounds, First Aid): a kit, not a spell.
 * No charge circle, no light, no glow, no halo. The medic tosses a roll of
 * bandage in a low arc; it winds round the patient in two turns, cinches with
 * a tug, and a flat green cross pops up and drifts off. The green cross is the
 * suite's one healing sign; the cloth is what says nobody cast anything.
 */
function tend(s, M, ctx) {
  const L = RAMP.linen, G = RAMP.salve, medic = ctx.caster;
  let end = 0;
  ctx.targets.forEach((T, i) => {
    const t0 = 0.12 + i * 0.25, self = !medic || T === medic || (Math.abs(T.x - medic.x) < 1e-6 && Math.abs(T.y - medic.y) < 1e-6);
    let land = t0;
    if (!self) {
      const a = [medic.x, medic.y, 0.7 * medic.h], b = [T.x, T.y, 0.65 * T.h], dur = clamp(0.18 + Math.hypot(b[0] - a[0], b[1] - a[1]) * 0.05, 0.22, 0.45);
      s.at(t0, (s2) => s2.add({
        k: "chunk", x: a[0], y: a[1], z: a[2], s: 2, wide: true, life: dur, R: L,
        update(p) { const u = clamp(p.age / dur); p.x = lerp(a[0], b[0], u); p.y = lerp(a[1], b[1], u); p.z = lerp(a[2], b[2], u) + Math.sin(Math.PI * u) * 0.35; },
      }));
      land = t0 + dur;
    }
    const wrap = 0.42;
    s.at(land, (s2) => s2.add({ k: "fmWrap", x: T.x, y: T.y, z: 0.5 * T.h, r: 0.44 * Math.sqrt(T.size), h: 0.3 * T.h, life: 1.7, wind: wrap, R: L, seed: sd(s2), update: still }));
    s.at(land + wrap, (s2) => {
      // the tug: a hop of cloth ends, then the cross
      for (let k = 0; k < 2; k++) s2.add({ k: "streak", x: T.x + 0.38 * Math.sqrt(T.size), y: T.y, z: 0.55 * T.h, vx: 1.6, vy: k ? 0.7 : -0.7, vz: 0, life: 0.12, R: L, minor: k > 0 });
      s2.add({ k: "icon", bm: CROSS, x: T.x, y: T.y - 0.05, z: 0.95 * T.h, vz: 0.45, drag: 0.6, life: 1.2, R: G, snap: false, update(p, _s, dt) { p.vz *= Math.exp(-dt * 0.6); p.z += p.vz * dt; } });
      for (let k = 0; k < 4; k++) s2.add({ k: "icon", bm: ICONS.plus, x: T.x + (k - 1.5) * 0.22 * T.size, y: T.y, z: (0.3 + (k % 2) * 0.25) * T.h, vz: 0.5 + 0.1 * k, drag: 0.6, life: 0.9, R: G, snap: false, wait: 0.1 + k * 0.07, minor: k > 1, update(p, _s, dt) { p.z += p.vz * dt; } });
      s2.add({ k: "ring", x: T.x, y: T.y, r: 0.6 * T.size, life: 0.5, R: G, broken: true, seed: 3, update: still });
    });
    end = Math.max(end, land + wrap);
  });
  s.phases.push("toss", "wrap", "cinch", "cross");
  s.period = end + 1.8;
}

/** Forms for a spec's `craft`: skills drawn as what they are, before any material. */
export const CRAFTS = Object.freeze({ medicine: tend });

registerShapes({
  /**
   * A bandage winding round a body: two turns revealed over `wind` seconds,
   * held, then unravelled from the loose end as it fades. Top-down it is two
   * rings hugging the token's rim; from the side, a spiral whose far half the
   * body hides.
   */
  fmWrap(v, P, p) {
    const top = v.kind === "top", [cx, cy] = v.ap(p.x, p.y, p.z), rx = p.r * v.aps * (top ? 1.3 : 1), ry = top ? rx : Math.max(1.5, rx * 0.32);
    const turns = 2, shown = clamp(p.age / p.wind), fade = clamp((p.age - p.life * 0.6) / (p.life * 0.4));
    const pitch = top ? 0 : p.h * v.aps / turns, n = Math.max(24, Math.ceil(TAU * rx * 1.3 * turns));
    const cinch = p.age >= p.wind && p.age < p.wind + 2 / 12;
    let lx = null, ly = null, k = 0;
    for (let i = 0; i < n * shown * (1 - fade); i++) {
      const q = (i / n) * TAU * turns, turn = Math.floor(q / TAU);
      const rr = top ? 1 + turn * 0.13 : 1, x = Math.floor(cx + Math.cos(q) * rx * rr), y = Math.floor(cy + Math.sin(q) * ry * rr - pitch * (q / TAU - 1));
      if (x === lx && y === ly) continue;
      lx = x; ly = y; k++;
      if (!top && Math.sin(q) < -0.05) continue;
      const fold = (k + p.seed) % 6 === 0;
      P.dot(x, y, S(p.R, cinch ? 1 : fold ? 0.6 : 0.95), 1, 2);
      P.dot(x, y + 1, S(p.R, fold ? 0.4 : 0.7), 1, 2);
    }
  },
});
