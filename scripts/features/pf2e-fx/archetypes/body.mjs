/**
 * Spellsprite archetypes — the body: grabs, maneuvers and Strike preludes.
 * docs/SPELLSPRITE_ARCHETYPES.md says what each covers; the spellsprite-craft skill says how good it must be.
 *
 * Each drawer is (s, M, ctx) like a FORMS entry: ctx = { caster, targets, area, hand, t0, release, linger, fire, self }.
 *
 *   grab     a hand of force (or coils) closes round the body, squeeze rings cinch in pulses,
 *            the body is pulled a hair toward the grabber, a hold band lingers
 *   trip     a low sweep through the feet, the body drops: a thud, a dent, a dust ring, skid marks
 *   shove    a heavy palm-front impact, the body slides along the vector over dust and skid lines
 *            (Trample: the same shove along the caster's path; Throw Rock: a boulder hefted and lobbed)
 *   rend     two raking gashes cross the body, then the wound tears open with a spray
 *   charge   a dash of afterimages and speed lines to the target, ending braced in a flash
 *   flurry   a rapid count of 3-5 strike blurs round the target, accelerating, combo pips above it
 *
 * Several of these are posted beside a Strike that plays its own hit, so the
 * preludes (charge, flurry) never flinch the target hard and never throw a
 * second release on it: the Strike lands the blow.
 */

import { TAU, clamp, lerp, easeOut, hash, fadeOut } from "../core/rand.mjs";
import { RAMP, S, WHITE } from "../core/palette.mjs";
import { registerShapes } from "../core/shapes.mjs";
import { still, lobes } from "../core/motifs.mjs";
// the shapes reused here (fmGhost, stFlare, crescent, mlCracks) are registered by these modules
import "../forms.mjs";
import "../strikes.mjs";

/* ── helpers ─────────────────────────────────────────────────────────── */

const norm = (x, y) => { const l = Math.hypot(x, y) || 1; return [x / l, y / l]; };
const sizeOf = (B) => B?.size ?? 1;
const outOf = (s, T) => T.outcome ?? s.spec.outcome ?? "neutral";
/** How hard a maneuver lands by outcome: neutral plays the hit, a little lighter, never the crit. */
const POWK = Object.freeze({ crit: 1.4, hit: 1, neutral: 0.9, miss: 0.6 });
const DUST = RAMP.kinetic;
const wrapPi = (a) => ((a + Math.PI) % TAU + TAU) % TAU - Math.PI;

/**
 * Who does it to whom. With no target (a self-posted ability) the subject is a
 * point in front of the caster, flagged `virtual`: nothing is flinched there.
 */
function cast(s, ctx) {
  const C0 = ctx.caster;
  let list = ctx.self ? [] : ctx.targets.filter((T) => T && T !== C0);
  const C = C0 ?? (list[0] ? { x: list[0].x - 1.6, y: list[0].y, size: 1, h: 1, id: null, virtual: true } : { x: 0, y: 0, size: 1, h: 1, id: null, virtual: true });
  if (!list.length) {
    const cs = sizeOf(C);
    list = [{ x: C.x + 0.55 * cs + 0.6, y: C.y, size: Math.max(1, cs * 0.8), h: C.h ?? 1, id: null, outcome: "neutral", virtual: true }];
  }
  return { C, list };
}

/** The unit vector from a to b, and its left-hand perpendicular. */
function axis(a, b) {
  const [ux, uy] = norm(b.x - a.x, b.y - a.y);
  return { ux, uy, px: -uy, py: ux, q: Math.atan2(uy, ux) };
}

/** A dust puff kicked off the floor: translucent, in the floor-dust browns (the smoke ramp reads as rocks on parchment). */
function puff(s, x, y, vx, vy, r, life, minor = false, tone = 0.5) {
  s.add({ k: "smoke", x, y, z: 0.05, vx, vy, vz: 0.12, drag: 2.6, g: -0.03, r, life, lobes: lobes(s), R: DUST, tone, minor });
}

/** Dust rolling out in a ring along the floor. */
function dustRing(s, x, y, n, r, sp = 1.6, size = 1) {
  for (let i = 0; i < n; i++) {
    const q = (i / n) * TAU + s.rand(-0.2, 0.2), v = s.rand(0.75, 1.25) * sp;
    puff(s, x + Math.cos(q) * r * 0.5, y + Math.sin(q) * r * 0.5, Math.cos(q) * v, Math.sin(q) * v, s.rand(2.4, 3.6) * size, s.rand(0.6, 1), i % 2 === 1);
  }
}

/** Grit and pebbles thrown up off the floor, hopping and settling. */
function grit(s, x, y, n, q, spread, sp, R = DUST, big = 1) {
  for (let i = 0; i < n; i++) {
    const a = q + s.rand(-spread, spread), v = s.rand(0.5, 1) * sp;
    s.add({ k: "chunk", x, y, z: 0.08, vx: Math.cos(a) * v, vy: Math.sin(a) * v, vz: s.rand(1.6, 4), g: 30, drag: 1.2, bounce: 0.4, life: s.rand(0.8, 1.5), R, s: i % 4 === 0 ? 1 + big : 1, wide: s.R() < 0.3, debris: true, minor: i > 4 });
  }
}

/** Sparks thrown off a point along angle q. */
function sparks(s, x, y, z, n, q, spread, lo, hi, R) {
  for (let i = 0; i < n; i++) {
    const a = q + s.rand(-spread, spread), v = s.rand(lo, hi);
    s.add({ k: "spark", x, y, z, vx: Math.cos(a) * v, vy: Math.sin(a) * v, vz: s.rand(0.4, 2.8), g: 26, drag: 2.2, bounce: 0.4, life: s.rand(0.18, 0.4), R, minor: i % 2 === 1 });
  }
}

/** Speed lines along (ux, uy) through a point, `n` of them, fanned across `w` squares. */
function speedLines(s, R, x, y, ux, uy, n, w, z0, z1, sp = 11, wait = 0) {
  const px = -uy, py = ux;
  for (let k = 0; k < n; k++) {
    const o = n > 1 ? (k / (n - 1) - 0.5) * w : 0, v = sp * s.rand(0.85, 1.2);
    s.add({ k: "streak", x: x + px * o - ux * s.rand(0, 0.4), y: y + py * o - uy * s.rand(0, 0.4), z: lerp(z0, z1, s.R()), vx: ux * v, vy: uy * v, life: s.rand(0.14, 0.22), R, wait: wait + s.rand(0, 0.04), minor: k % 2 === 1 });
  }
}

/** The material's own dressing for a non-kinetic maneuver: its trail near a point, and its linger. */
function dress(s, M, ctx, x, y, z, at, rad = 0.4, dur = 1.1) {
  if (M.id === "kinetic" || M.id === "neutral") return;
  s.at(at, (s2) => { for (let i = 0; i < 6; i++) M.mod.trail?.(s2, M, { x: x + s2.rand(-rad, rad), y: y + s2.rand(-rad, rad) * 0.6, z: z * s2.rand(0.4, 1.2), dt: 1 / 30 }); });
  ctx.linger?.(s, M, x, y, rad, at, at + dur);
}

/** A held contact frame: the whole effect pauses (no veil; a veil is a crit's). */
const hold = (s, t, sh) => { s.freeze = Math.max(s.freeze, t); s.shake = Math.max(s.shake, sh); };

/* ── shapes ─────────────────────────────────────────────────────────── */

/** Screen centre and the squash a ring round a body takes in this view (a waist band, seen from above or from the side). */
function ringFrame(v, p) {
  const [cx, cy] = v.ap(p.x, p.y, p.z), k = v.kind === "top" ? 1 : 0.32;
  return { cx, cy, k };
}
/** A world direction's screen angle at a point, in the unsquashed ring frame. */
function screenAngle(v, p, ux, uy, k) {
  const [ax, ay] = v.ap(p.x, p.y, p.z), [bx, by] = v.ap(p.x + ux, p.y + uy, p.z), dx = bx - ax, dy = (by - ay) / k;
  return Math.hypot(dx, dy) < 2 ? (ux < 0 ? Math.PI : 0) : Math.atan2(dy, dx);
}

registerShapes({
  /**
   * Grab: a clamp of force round a body. A knuckled hinge sits on the
   * grabber's side and two heavy jaws, toothed on their inner edge, swing
   * round both flanks: splayed wide while open, tips nearly meeting on the far
   * side once shut. `p.grip` 0 is open, 1 shut; past 1 it squeezes (the jaws
   * bite in). `coil` swaps the jaws for two bands that wind right round (a
   * constrictor, a vine, a tongue).
   */
  boClamp(v, P, p) {
    const { cx, cy, k } = ringFrame(v, p), g = clamp(p.grip ?? 0, 0, 1.25), a = p.fade ?? 1;
    if (a <= 0.05) return;
    const pa = screenAngle(v, p, -p.ux, -p.uy, k), rr = p.r * v.aps, th = p.th, coil = !!p.coil, gc = Math.min(1, g), bite = Math.max(0, g - 1) / 0.25;
    const rB = rr * (1 - 0.1 * bite), hot = p.hero && p.age < 1 / 12, back = v.kind !== "top";
    // a jaw: [side, start, span] in radians from the hinge, open spans short and splayed
    const jaws = coil ? [[1, 0.1, 4.6], [-1, 1.0, 4.2]] : [[1, 0.2, 2.75], [-1, 0.2, 2.75]];
    const pad = rB + rr * 0.9 + th * 2 + 4, teeth = coil ? 0 : 3 + (p.hero ? 1 : 0);
    const hwOf = (f) => Math.max(1, th * (coil ? 1 - 0.3 * f : 1.25 - 0.85 * f ** 1.6));
    const radAt = (f) => (coil ? rB * (1.06 - 0.07 * Math.sin(f * 7)) : rB + (1 - gc) * rr * 0.85 * f ** 1.5 - gc * th * 0.9 * clamp((f - 0.8) / 0.2) + th * 0.35 * (1 - f));
    P.shade(cx - pad, cy - pad * k, cx + pad, cy + pad * k, (x, y) => {
      const dx = x - cx, dyu = (y - cy) / k, d = Math.hypot(dx, dyu);
      if (back && dyu < -rB * 0.25 && Math.abs(dx) < rB * 0.85) return null;
      const rel = wrapPi(Math.atan2(dyu, dx) - pa);
      // the hinge: a knuckled mass on the grabber's side, lit on its outer face
      if (!coil) {
        const pr = rB + th * 0.9, c = Math.cos(pa), n = Math.sin(pa), ox = dx - c * pr, oy = dyu - n * pr;
        const ax = (ox * c + oy * n) / (th * 2), ay = (-ox * n + oy * c) / (th * 2.9), e = ax * ax + ay * ay;
        if (e < 1) {
          if (e > 0.7) return { c: S(p.R, ax > 0 ? 1 : 0.3), a };
          const knuckle = Math.abs(((ay + 1) * 2) % 1 - 0.5) < 0.12;
          return { c: S(p.R, knuckle ? 0.45 : 0.72 + ax * 0.2), a };
        }
      }
      for (const [side, s0, span0] of jaws) {
        const span = span0 * (coil ? 0.3 + 0.7 * gc : 0.6 + 0.4 * gc);
        let f = (side * rel - s0) / span;
        if (coil && f < 0) f += TAU / span;
        if (f < 0 || f > 1) continue;
        const rad = radAt(f), w = hwOf(f), dd = d - rad;
        // teeth on the inner edge, pointing into the body
        if (teeth && dd < -w && dd > -w - th * 1.1) {
          const ft = (f * teeth) % 1, tw = 1 - Math.abs(ft - 0.5) * 2;
          if (f > 0.12 && f < 0.94 && -dd - w < th * 1.1 * tw) return { c: S(p.R, 0.95), a };
          continue;
        }
        if (Math.abs(dd) > w) continue;
        const e = dd / w;
        if (f > 0.88 && !coil) return { c: hot ? WHITE : S(p.R, 1), a };
        if (e > 0.55) return { c: S(p.R, 1), a };
        if (e < -0.6) return { c: S(p.R, 0.35), a };
        return { c: S(p.R, 0.62 + e * 0.2 + (1 - f) * 0.08), a };
      }
      return null;
    }, hot ? 2 : 1);
  },

  /** A squeeze ring round a body, contracting from r0 to r1 and fading; broken into dashes that crawl. */
  boSqueeze(v, P, p) {
    const u = clamp(p.age / p.life), { cx, cy, k } = ringFrame(v, p), rx = lerp(p.r0, p.r1, easeOut(u)) * v.aps, ry = rx * k, fr = Math.floor(p.age * 12);
    if (rx < 1.5) return;
    const a = (p.a ?? 1) * fadeOut(u, 0.55), back = v.kind !== "top", n = Math.max(10, Math.round(rx * 0.9));
    P.ellipse(cx, cy, rx, ry, (q) => {
      if (back && Math.sin(q) < -0.05) return null;
      if (p.dash && Math.floor((q / TAU) * n + fr * (p.crawl ?? 1)) % 3 === 2) return null;
      return { c: S(p.R, u < 0.2 ? 1 : 0.9), a };
    }, 2);
    if (rx > 3) P.ellipse(cx, cy + 1, rx - 1, Math.max(0.5, ry - 1), (q) => (back && Math.sin(q) < -0.05 ? null : { c: S(p.R, 0.55), a }), 1);
  },

  /** Skid marks on the floor: parallel gouges from (x, y) to (x1, y1), drawn on as `grow` runs, a bright lip on a dark groove. */
  boSkid(v, P, p) {
    const u = clamp(p.age / p.life), a = 0.9 * fadeOut(u, 0.55), g = clamp(p.age / (p.grow ?? 0.25));
    const [ax, ay] = v.ap(p.x, p.y, 0), [bx, by] = v.ap(p.x1, p.y1, 0), dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy);
    if (L < 1) return;
    const ux = dx / L, uy = dy / L, px = -uy, py = ux, n = p.n ?? 2, gap = p.gap ?? 4;
    for (let i = 0; i < n; i++) {
      const o = (i - (n - 1) / 2) * gap, j = hash(i, p.seed) * 0.25, x0 = ax + px * o + ux * L * j, y0 = ay + py * o + uy * L * j;
      const x1 = ax + px * o + ux * L * g, y1 = ay + py * o + uy * L * g;
      if (g <= j) continue;
      P.line(x0, y0, x1, y1, null, 0, a, (f) => S(p.R, f > 0.85 ? 0.85 : 0.2));
      P.line(x0 + px, y0 + py, x1 + px, y1 + py, null, 0, a * 0.8, (f) => S(p.R, f > 0.5 ? 0.62 : 0.5));
    }
  },

  /** A body's dent on the floor where it fell: a dark elongated print, lighter at its lip. */
  boDent(v, P, p) {
    const u = clamp(p.age / p.life), a = 0.8 * fadeOut(u, 0.5), [cx, cy] = v.ap(p.x, p.y, 0), L = p.L * v.aps, W = p.W * v.aps * v.sq;
    const c = Math.cos(p.q), n = Math.sin(p.q), ext = Math.max(L, W) + 2;
    P.shade(cx - ext, cy - ext, cx + ext, cy + ext, (x, y) => {
      const dx = x - cx, dy = y - cy, al = (dx * c + dy * n) / L, ac = (-dx * n + dy * c) / W, d = al * al + ac * ac;
      if (d > 1) return null;
      return { c: S(p.R, d > 0.72 ? 0.62 : 0.1), a: a * (d > 0.72 ? 1 : 0.75) };
    }, 0, "mix");
  },

  /**
   * A push front: nested bows, convex along the blow, pressing on whatever is
   * ahead of them. They travel with the body; frame 0 is the bright one.
   */
  boFront(v, P, p) {
    const u = clamp(p.age / p.life), { cx, cy, k } = ringFrame(v, p), q = screenAngle(v, p, p.ux, p.uy, k), fr = Math.floor(p.age * 12);
    const a = fadeOut(u, 0.4), R0 = p.r * v.aps, half = p.half ?? 0.95;
    for (let i = 0; i < (p.n ?? 3); i++) {
      const rr = R0 * (1 - i * 0.2) * (1 + 0.15 * easeOut(u)), ox = cx - Math.cos(q) * rr * 0.75, oy = cy - Math.sin(q) * rr * 0.75 * k;
      const col = S(p.R, fr === 0 && i === 0 ? 1 : 0.95 - i * 0.17);
      const nn = Math.ceil(rr * half * 2.4);
      for (let j = 0; j <= nn; j++) {
        const t = q - half + (2 * half * j) / nn, x = ox + Math.cos(t) * rr, y = oy + Math.sin(t) * rr * k;
        P.dot(x, y, col, a * (1 - i * 0.2), 2);
        if (i < 2) P.dot(x - Math.cos(q), y - Math.sin(q) * k, S(p.R, i ? 0.55 : 0.8), a, 2);
      }
    }
  },

  /** A boulder: a lumpy lit rock, turning; a lighter top-left, a dark rim, facets that roll with it. */
  boRock(v, P, p) {
    const [cx, cy] = v.ap(p.x, p.y, p.z), r = p.r, rot = p.rot ?? 0, sd = p.seed ?? 1;
    P.shade(cx - r - 2, cy - r - 2, cx + r + 2, cy + r + 2, (x, y) => {
      const dx = x - cx, dy = y - cy, q = Math.atan2(dy, dx), d = Math.hypot(dx, dy);
      const lump = 0.82 + 0.18 * hash(Math.floor(((q - rot) / TAU) * 7 + 70), sd);
      if (d > r * lump) return null;
      if (d > r * lump - 1.1) return S(p.R, 0.15);
      const lit = (-dx - dy) / (r * 1.4), facet = hash(Math.floor(((q - rot * 1.3) / TAU) * 5 + 50), Math.floor((d / r) * 2), sd);
      return S(p.R, 0.5 + lit * 0.32 + (facet - 0.5) * 0.18);
    }, 1);
  },

  /**
   * Rend's rake: `n` parallel claw lines across a body along (ux, uy), drawn
   * on in two frames with bright heads, then cooling to wound lines in `R2`.
   */
  boGash(v, P, p) {
    const fr = Math.floor(p.age * 12), u = clamp(p.age / p.life), a = fadeOut(u, 0.6);
    const [cx, cy] = v.ap(p.x, p.y, p.z), [ex, ey] = v.ap(p.x + p.ux, p.y + p.uy, p.z + (p.uz ?? 0));
    let dx = ex - cx, dy = ey - cy; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
    const px = -dy, py = dx, L = p.L, n = p.n ?? 3, gap = p.gap ?? 4, show = Math.min(1, (fr + 1) / 2), hot = p.hero && fr === 1;
    for (let i = 0; i < n; i++) {
      const o = (i - (n - 1) / 2) * gap, len = L * (1 - Math.abs(i - (n - 1) / 2) * 0.12), x0 = cx + px * o - dx * len * 0.5, y0 = cy + py * o - dy * len * 0.5;
      const x1 = x0 + dx * len * show, y1 = y0 + dy * len * show;
      // a claw is tapered: three pixels across in its middle, one at its ends
      const fat = (f, o) => Math.sin(Math.PI * clamp(f)) * (p.w ?? 1.6) > Math.abs(o) - 0.2;
      if (fr < 3) {
        for (const o of [-1, 1]) P.line(x0 + px * o, y0 + py * o, x1 + px * o, y1 + py * o, null, 1, 1, (f) => (fat(f * show, o) ? S(p.R, o < 0 ? 0.95 : 0.62) : null));
        P.line(x0, y0, x1, y1, null, 2, 1, (f) => (f > 0.68 ? (hot ? WHITE : S(p.R, 1)) : f < 0.06 ? null : S(p.R, 0.9)));
      } else {
        P.line(x0 - px, y0 - py, x1 - px, y1 - py, null, 1, a, (f) => (fat(f, 1) ? S(p.R2, 0.62) : null));
        P.line(x0, y0, x1, y1, null, 1, a, (f) => (f < 0.06 || f > 0.95 ? null : S(p.R2, 0.4)));
        P.line(x0 + px, y0 + py, x1 + px, y1 + py, null, 1, a, (f) => (fat(f, 1) ? S(p.R2, 0.15) : null));
      }
    }
  },

  /** Rend's tear: a jagged rip across the body that splits open, a dark wound between two bright lips. */
  boRip(v, P, p) {
    const fr = Math.floor(p.age * 12); if (fr > 7) return;
    const [cx, cy] = v.ap(p.x, p.y, p.z), [ex, ey] = v.ap(p.x + p.ux, p.y + p.uy, p.z);
    let dx = ex - cx, dy = ey - cy; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
    const px = -dy, py = dx, L = p.L, gap = [0, 1.5, 3, 4.5, 5, 5, 4.5, 4][fr] * (p.open ?? 1), hot = fr === 0 && p.hero, a = fr > 5 ? 0.6 : 1, N = Math.max(6, Math.round(L / 3));
    const pt = (i, side) => {
      const f = i / N - 0.5, j = (hash(i, p.seed) - 0.5) * 3.2, w = gap * Math.cos(f * Math.PI) * side;
      return [cx + dx * L * f + px * (j + w), cy + dy * L * f + py * (j + w)];
    };
    // the wound first, so the lips draw over its edges
    if (gap >= 1) for (let i = 1; i < N; i++) {
      const [ax, ay] = pt(i, -1), [bx, by] = pt(i, 1);
      P.line(ax, ay, bx, by, null, 1, a, (f) => S(p.R2, f < 0.3 || f > 0.7 ? 0.35 : 0.08));
    }
    for (const side of [-1, 1]) for (let i = 0; i < N; i++) {
      const [x0, y0] = pt(i, side), [x1, y1] = pt(i + 1, side);
      P.line(x0, y0, x1, y1, hot ? WHITE : S(p.R, fr < 2 ? 1 : 0.88), 2, a);
      P.line(x0 + px * side, y0 + py * side, x1 + px * side, y1 + py * side, S(p.R2, fr < 3 ? 0.8 : 0.6), 1, a);
    }
  },

  /** A flurry's count: `n` diamond pips in a row over a head, each lighting on its beat (`p.beats`, seconds of age). */
  boPips(v, P, p) {
    const u = clamp(p.age / p.life), a = fadeOut(u, 0.7), [cx, cy] = v.ap(p.x, p.y, p.z), n = p.beats.length, gap = 10;
    for (let i = 0; i < n; i++) {
      const x = Math.round(cx + (i - (n - 1) / 2) * gap), y = Math.round(cy), since = p.age - p.beats[i], on = since >= 0 && !p.dud;
      const pop = on && since < 2 / 12, r = pop ? 4 : 3;
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const d = Math.abs(dx) + Math.abs(dy); if (d > r) continue;
        const rim = d === r;
        if (!on && !rim) continue;
        P.dot(x + dx, y + dy, on ? (pop && d === 0 && p.hero ? WHITE : S(p.R, rim ? 0.75 : 1)) : S(p.R, 0.45), a, 2);
      }
    }
  },
}, { flat: ["boSkid", "boDent"] });

/* ── grab ───────────────────────────────────────────────────────────── */

const COILY = /coil|wrap|constrict|tentacle|tongue|vine|tendril|lasso|swallow|engulf/;
const COIL_MOTIFS = new Set(["serpent", "vine", "root", "chain", "whip", "web", "thorn"]);
/** Coils, from the spec or from the Strike it follows (spec.limb, handoff.mjs): a tongue, a tail, a tentacle. */
function coily(sp) {
  const l = sp.limb;
  if (COILY.test(sp.slug ?? "") || COIL_MOTIFS.has(sp.motif)) return true;
  return !!l && (l.delivery === "lash" || COILY.test(l.slug ?? "") || COILY.test(l.rider ?? "") || COIL_MOTIFS.has(l.motif));
}

/**
 * pixelfx grasping-hands, read top-down: the hand opens wide as it arrives,
 * snaps shut with an overshoot, strains in squeezes, and is let go. Ours lays
 * the hand round the token: palm on the grabber's side, fingers round both
 * flanks, sized to whichever is bigger, the grabber's reach or the body.
 */
function grab(s, M, ctx) {
  const { C, list } = cast(s, ctx), t0 = ctx.t0, coil = coily(s.spec);
  let end = t0;
  list.forEach((T, i) => {
    const o = outOf(s, T), K = POWK[o] ?? 1, miss = o === "miss" || T.virtual, crit = o === "crit" && !T.virtual;
    const A = axis(C, T), ts = sizeOf(T), cs = sizeOf(C), big = Math.max(ts, cs * 0.75), kk = (crit ? 1.25 : 1) * Math.min(1.3, 0.85 + s.m * 0.2);
    // a miss closes on the air beside the body, a self-posted grab in front of the grabber
    const X = miss && !T.virtual ? T.x + A.px * 0.55 * ts + A.ux * 0.35 : T.x, Y = miss && !T.virtual ? T.y + A.py * 0.55 * ts + A.uy * 0.35 : T.y;
    const at = t0 + i * 0.12, close = at + 0.14, shut = close + 0.12, z = 0.5 * T.h;
    const r = (miss ? 0.3 : 0.56) * big * kk, th = Math.max(3, 3.6 * Math.sqrt(cs) * kk);
    const pulses = miss ? [] : crit ? [0.28, 0.56, 0.84] : [0.32, 0.66];
    const life = miss ? 0.7 : 1.55 + (crit ? 0.3 : 0);
    // the reach: force streams from the grabber's hand to the body
    const hand = ctx.hand ?? [C.x + A.ux * 0.3 * cs, C.y + A.uy * 0.3 * cs, 0.85 * (C.h ?? 1)];
    s.at(at, (s2) => {
      const dist = Math.hypot(X - hand[0], Y - hand[1]), n = Math.max(6, Math.round(dist * 5));
      for (let k = 0; k < n; k++) {
        const f = k / n, life2 = 0.16;
        s2.add({ k: "streak", x: lerp(hand[0], X, f * 0.85), y: lerp(hand[1], Y, f * 0.85), z: lerp(hand[2], z, f), vx: A.ux * dist / 0.25, vy: A.uy * dist / 0.25, life: life2, R: M.R, wait: f * 0.08, minor: k % 2 === 1 });
      }
      s2.light(X, Y, z, 1.4 * big, S(M.R, 0.85), 0.35, 0.3, { swell: true });
    });
    // the hand: open as it arrives, snapping shut, squeezing on each pulse, let go at the end
    s.at(at + 0.04, (s2) => s2.add({
      k: "boClamp", x: X, y: Y, z, ux: A.ux, uy: A.uy, r, th, coil, grip: 0, fade: 0, life, R: M.R, hero: crit, update(p) {
        const t = p.age + (at + 0.04), cl = clamp((t - close) / (shut - close));
        // easeOutBack: shut overshoots and settles, the snap
        const back = cl < 1 ? 1 + 2.7 * (cl - 1) ** 3 + 1.7 * (cl - 1) ** 2 : 1;
        let g = miss ? clamp((t - close) / 0.1) * 1.25 : back;
        for (const d of pulses) { const e = t - (shut + d); if (e > 0 && e < 0.22) g += 0.22 * Math.sin((e / 0.22) * Math.PI); }
        p.grip = g;
        p.fade = clamp(p.age / 0.06) * (miss ? fadeOut(p.age / p.life, 0.45) : fadeOut(p.age / p.life, 0.78));
        // the pull: the hand drags the body a hair toward the grabber while it holds
        if (!miss) { const pull = 0.12 * ts * clamp((t - shut) / 0.4); p.x = X - A.ux * pull; p.y = Y - A.uy * pull; }
        if (p.age > 1 / 12) p.hero = false;
      },
    }));
    s.at(shut, (s2) => {
      if (miss) {
        // closes on nothing: a fist snaps shut on the air, a puff of dust and a scatter of grit
        s2.add({ k: "flash", x: X, y: Y, z, life: 1 / 12, r: 5, R: M.R, update: still });
        sparks(s2, X, Y, z, 6, A.q, 1.2, 2, 5, M.R);
        puff(s2, X, Y, A.ux * 0.6, A.uy * 0.6, 3.2 * Math.sqrt(big), 0.8);
        puff(s2, X + A.px * 0.2, Y + A.py * 0.2, -A.ux * 0.3, -A.uy * 0.3, 2.6, 0.7, true);
        s2.shake = Math.max(s2.shake, 0.5);
        return;
      }
      // the clench lands: a held frame, the body pulled toward the grabber, pressure squeezed out of the grip
      hold(s2, (crit ? 2.5 : 1.5) / 12, 1 + 0.5 * big * K);
      s2.hit(T.id, 1.25 * K, { x: T.x + A.ux * 1.5, y: T.y + A.uy * 1.5 }, M.R);
      s2.add({ k: "flash", x: T.x, y: T.y, z, life: (crit ? 2 : 1) / 12, r: (crit ? 0.55 : 0.4) * big * s2.spec.aps * 0.6, R: M.R, update: still });
      s2.light(T.x, T.y, z, 2.6 * big * K, S(M.R, 0.8), 0.3 * K, 0.5);
      s2.light(T.x - A.ux * 0.4 * ts, T.y - A.uy * 0.4 * ts, z, 0.6 * big, S(M.R, 1), 0.55, 0.1);
      for (let k = 0; k < 10 * K; k++) {
        const q = A.q + Math.PI / 2 * (k % 2 ? 1 : -1) + s2.rand(-0.5, 0.5), v = s2.rand(4, 9) * Math.sqrt(big);
        s2.add({ k: "spark", x: T.x, y: T.y, z, vx: Math.cos(q) * v, vy: Math.sin(q) * v, vz: s2.rand(0.5, 2.5), g: 26, drag: 2.4, bounce: 0.4, life: s2.rand(0.2, 0.4), R: M.R, minor: k % 2 === 1 });
      }
      // the pull drags the feet: a short skid toward the grabber, dust kicked up
      s2.add({ k: "boSkid", x: T.x + A.ux * 0.15 * ts, y: T.y + A.uy * 0.15 * ts, x1: T.x - A.ux * 0.45 * ts, y1: T.y - A.uy * 0.45 * ts, n: 2, gap: 5 * Math.sqrt(ts), grow: 0.35, life: 1.6, R: DUST, seed: 3, update: still });
      for (let k = 0; k < 4; k++) puff(s2, T.x + s2.rand(-0.25, 0.25) * ts, T.y + 0.2 * ts + s2.rand(-0.1, 0.1), -A.ux * s2.rand(0.4, 1), -A.uy * s2.rand(0.4, 1), s2.rand(2.6, 3.6) * Math.sqrt(big), 0.8, k > 1);
      s2.add({ k: "ring", x: T.x, y: T.y, r: 0.9 * big * kk, life: 0.45, R: M.R, broken: true, seed: 11, update: still });
      if (crit) {
        s2.crit();
        s2.add({ k: "star", x: T.x, y: T.y, z: z + 0.2, L: 6, life: 3 / 12, R: M.R, update: still });
        sparks(s2, T.x, T.y, z, 14, 0, Math.PI, 5, 12, M.R);
      }
    });
    // constriction: rings cinch in round the body on every squeeze, from the waist up
    if (!miss) [0, ...pulses].forEach((d, j) => s.at(shut + d, (s2) => {
      for (const [zk, w] of [[0.28, 0], [0.75, 0.04]]) {
        s2.add({ k: "boSqueeze", x: T.x, y: T.y, z: zk * T.h, r0: 0.95 * big * kk, r1: 0.5 * big, life: 0.32, R: M.R, a: j ? 0.8 : 1, wait: w, minor: zk > 0.5 && j > 0, update: still });
      }
      if (j) {
        s2.hit(T.id, 0.6 * K, { x: T.x + A.ux * 1.5, y: T.y + A.uy * 1.5 }, M.R);
        s2.shake = Math.max(s2.shake, 0.6 + 0.3 * big);
        s2.light(T.x, T.y, z, 1.6 * big, S(M.R, 0.9), 0.3, 0.2);
        sparks(s2, T.x, T.y, z, 4, A.q + Math.PI / 2, 2.6, 3, 6, M.R);
      }
    }));
    // the hold: a band stays cinched round the waist, crawling, after the hand has faded
    if (!miss) s.at(shut + 0.2, (s2) => {
      s2.add({ k: "boSqueeze", x: T.x, y: T.y, z: 0.5 * T.h, r0: 0.56 * big, r1: 0.5 * big, life: life + 0.6, dash: true, crawl: coil ? 2 : 1, R: M.R, a: 0.85, update: still });
      s2.add({ k: "boSqueeze", x: T.x, y: T.y, z: 0.06, r0: 0.62 * big, r1: 0.58 * big, life: life + 0.4, dash: true, crawl: -1, R: M.R, a: 0.6, minor: true, update: still });
    });
    if (!miss) dress(s, M, ctx, T.x, T.y, z, shut, 0.4 * big, 1.4);
    end = Math.max(end, at + life + 0.6);
  });
  s.phases.push(coil ? "grab: coils close, squeeze, hold" : "grab: a hand closes, squeezes, holds");
  s.period = end + 0.5;
}

/* ── trip ───────────────────────────────────────────────────────────── */

/**
 * pixelfx spear-sweep + heavy-landing: a low arc scythes through the feet,
 * then the body comes down: the frame holds, the floor dents along the fall,
 * dust rolls out in two rings, pebbles hop, and the fall skids on.
 */
function trip(s, M, ctx) {
  const { C, list } = cast(s, ctx), t0 = ctx.t0;
  let end = t0;
  list.forEach((T, i) => {
    const o = outOf(s, T), K = POWK[o] ?? 1, miss = o === "miss" || T.virtual, crit = o === "crit" && !T.virtual;
    const A = axis(C, T), ts = sizeOf(T), cs = sizeOf(C), big = Math.max(ts, cs * 0.7), kk = crit ? 1.35 : 1;
    const at = t0 + i * 0.14, cut = at + 2 / 12, fall = cut + 0.16;
    // the sweep: a flat smear swung low across the feet, its band running through the body halfway along
    const Rr = (0.6 * big + 0.45) * kk, dir = hash(s.seed, i) < 0.5 ? 1 : -1, span = 2.6, ox = T.x - A.ux * Rr * 0.92, oy = T.y - A.uy * Rr * 0.92;
    const e1 = [A.ux * Rr, A.uy * Rr, 0], e2 = [A.px * Rr * dir, A.py * Rr * dir, 0];
    s.at(at, (s2) => {
      s2.add({ k: "stSlash", x: T.x, y: T.y, z: 0.12, cx: ox, cy: oy, cz: 0.12, e1, e2, th0: -span * 0.45, dir: 1, span, W: (11 + 3 * Math.sqrt(big)) * kk, life: 7 / 12, R: M.R, edge: crit, update: still });
      s2.add({ k: "stSlash", x: T.x, y: T.y, z: 0.1, cx: ox, cy: oy, cz: 0.1, e1: e1.map((q) => q * 0.8), e2: e2.map((q) => q * 0.8), th0: -span * 0.4, dir: 1, span: span * 0.85, W: 5 * kk, dim: true, life: 6 / 12, R: M.R, wait: 0.04, minor: true, update: still });
      // speed lines off the sweep's head, low along the floor
      const hq = span * 0.55, tx = -Math.sin(hq) * e1[0] + Math.cos(hq) * e2[0], ty = -Math.sin(hq) * e1[1] + Math.cos(hq) * e2[1], [hx, hy] = norm(tx, ty);
      speedLines(s2, M.R, T.x, T.y, hx, hy, 5, 0.5 * Math.sqrt(big), 0.04, 0.25, 10, 1 / 12);
      // the sweep drags the floor: dust thrown off its arc along its travel
      for (let k = 0; k < 9; k++) {
        const th = -span * 0.45 + span * (k / 8), c = Math.cos(th), n = Math.sin(th), x = ox + e1[0] * c + e2[0] * n, y = oy + e1[1] * c + e2[1] * n;
        const tx = -n * e1[0] + c * e2[0], ty = -n * e1[1] + c * e2[1], [vx, vy] = norm(tx, ty);
        puff(s2, x, y, vx * 1.6, vy * 1.6, s2.rand(2.2, 3.2) * Math.sqrt(big), s2.rand(0.5, 0.8), k % 2 === 1);
        if (k % 2 === 0) s2.add({ k: "chunk", x, y, z: 0.05, vx: vx * s2.rand(2, 4), vy: vy * s2.rand(2, 4), vz: s2.rand(1, 2.5), g: 30, drag: 1.5, bounce: 0.35, life: s2.rand(0.5, 0.9), R: DUST, s: 1, minor: k > 4 });
      }
      s2.light(T.x, T.y, 0.15, 1.8 * big, S(M.R, 0.9), 0.5, 0.25);
    });
    if (miss) {
      // it sweeps through and the body stays up: speed lines carry on, the feet scuff, no fall
      s.at(cut, (s2) => {
        speedLines(s2, M.R, T.x + A.px * dir * 0.4, T.y + A.py * dir * 0.4, A.px * dir, A.py * dir, 4, 0.5, 0.05, 0.2, 9);
        for (let k = 0; k < 3; k++) puff(s2, T.x + s2.rand(-0.3, 0.3) * ts, T.y + 0.2 * ts, s2.rand(-0.5, 0.5), 0.2, 2.6, 0.7, k > 0);
      });
      end = Math.max(end, cut + 1.2);
      return;
    }
    // the legs go: a jolt along the sweep
    s.at(cut, (s2) => s2.hit(T.id, 0.8 * K, { x: T.x - A.px * dir, y: T.y - A.py * dir }, M.R));
    // the fall: the frame holds on the thud; the floor takes the body
    s.at(fall, (s2) => {
      hold(s2, (crit ? 2.5 : 1.6) / 12, 1.2 + 0.6 * big * K);
      s2.hit(T.id, 1.45 * K, { x: T.x, y: T.y - 1 }, M.R);
      if (crit) s2.crit();
      // the print the body leaves, laid out along the fall
      const fq = Math.atan2(A.py * dir + A.uy * 0.6, A.px * dir + A.ux * 0.6);
      s2.add({ k: "boDent", x: T.x + Math.cos(fq) * 0.2 * ts, y: T.y + Math.sin(fq) * 0.2 * ts, q: fq, L: 0.62 * big, W: 0.36 * big, life: 2.4, R: DUST, update: still });
      s2.add({ k: "mlCracks", x: T.x, y: T.y, r: 0.75 * big * kk, life: 1.8, R: DUST, seed: s2.seedInt(), update: still });
      // two rings of dust roll out along the floor, one after the other
      s2.add({ k: "ring", x: T.x, y: T.y, r: 1.25 * big * kk, life: 0.5, R: DUST, seed: 13, update: still });
      s2.add({ k: "ring", x: T.x, y: T.y, r: 1.9 * big * kk, life: 0.7, R: DUST, broken: true, seed: 19, wait: 2 / 12, update: still });
      dustRing(s2, T.x, T.y, Math.round(10 * kk), 0.7 * big, 1.8 * Math.sqrt(big), Math.sqrt(big));
      s2.at(s2.t + 0.12, (s3) => dustRing(s3, T.x, T.y, 8, 1 * big, 1.1 * Math.sqrt(big), Math.sqrt(big) * 1.15));
      grit(s2, T.x, T.y, Math.round(12 * kk * Math.sqrt(big)), 0, Math.PI, 4.5 * Math.sqrt(big), DUST);
      // impact lines thrown out along the floor from under the body
      for (let k = 0; k < 10; k++) {
        const q = (k / 10) * TAU + s2.rand(-0.15, 0.15), v = s2.rand(7, 10) * Math.sqrt(big) * kk;
        s2.add({ k: "streak", x: T.x + Math.cos(q) * 0.35 * ts, y: T.y + Math.sin(q) * 0.35 * ts, z: 0.04, vx: Math.cos(q) * v, vy: Math.sin(q) * v, drag: 4, life: 0.2, R: M.R, minor: k % 2 === 1 });
      }
      // the thud flash on the floor: a hero frame only on a crit, a pale pop otherwise
      s2.add({ k: "flash", x: T.x, y: T.y, z: 0.1, life: (crit ? 2 : 1) / 12, r: 0.5 * big * kk * s2.spec.aps * 0.6, R: crit ? M.R : DUST, update: still });
      s2.light(T.x, T.y, 0.1, 2.4 * big * kk, S(M.R, 0.85), 0.6 * K, 0.6);
      // the fall skids on: two gouges past the body, along the sweep
      s2.add({ k: "boSkid", x: T.x - Math.cos(fq) * 0.15 * ts, y: T.y - Math.sin(fq) * 0.15 * ts, x1: T.x + Math.cos(fq) * 0.85 * ts * kk, y1: T.y + Math.sin(fq) * 0.85 * ts * kk, n: 3, gap: 5 * Math.sqrt(ts), grow: 0.3, life: 2, R: DUST, seed: 7, update: still });
      // "prone": a row of stars knocked out over the head, tumbling down to the floor
      for (let k = 0; k < (crit ? 5 : 3); k++) {
        const q = (k / (crit ? 5 : 3)) * TAU + s2.rand(-0.3, 0.3);
        s2.add({ k: "glint", x: T.x + Math.cos(q) * 0.35 * ts, y: T.y + Math.sin(q) * 0.2 * ts, z: 0.55 * T.h, life: 5 / 12, R: M.R, big: k === 0, wait: 0.06 + k * 0.07, minor: k > 1, update: still });
      }
    });
    dress(s, M, ctx, T.x, T.y, 0.3 * T.h, fall, 0.4 * big, 1.2);
    end = Math.max(end, fall + 2.2);
  });
  s.phases.push("trip: a sweep through the feet, the body drops, dust and a skid");
  s.period = end + 0.4;
}

/* ── shove (and trample, and throw rock) ─────────────────────────────── */

const TRAMPLE = /trample|stampede|overrun|rolling/;
const ROCK = /rock|boulder|hurl|fling/;

/**
 * A body slid along a vector: a translucent afterimage of it travelling from
 * where it stood to where it lands, dust thrown off its feet, gouges under
 * it, speed lines past it and a dashed mark where it stops.
 */
function slide(s, M, T, ux, uy, D, at, dur, R = M.R) {
  const ts = sizeOf(T), x0 = T.x, y0 = T.y, x1 = x0 + ux * D, y1 = y0 + uy * D;
  s.at(at, (s2) => {
    for (let k = 0; k < 3; k++) s2.add({ k: "fmGhost", x: x0, y: y0, size: ts, h: T.h ?? 1, a: 0.7 - k * 0.18, life: dur + 0.35, R, wait: k * 0.05, update(p) {
      const f = easeOut(clamp((p.age) / dur)); p.x = lerp(x0, x1, f); p.y = lerp(y0, y1, f);
    } });
    s2.add({ k: "boSkid", x: x0 - ux * 0.2 * ts, y: y0 - uy * 0.2 * ts, x1: x1 + ux * 0.1, y1: y1 + uy * 0.1, n: 2, gap: 6 * Math.sqrt(ts), grow: dur, life: 2.4, R: DUST, seed: 5, update: still });
    speedLines(s2, R, x0 + ux * 0.3, y0 + uy * 0.3, ux, uy, 6, 0.8 * ts, 0.15 * (T.h ?? 1), 0.85 * (T.h ?? 1), 9 + D * 3);
  });
  s.emit(at, at + dur, (s2, u, dt) => {
    const f = easeOut(u), x = lerp(x0, x1, f), y = lerp(y0, y1, f);
    for (let i = s2.count(26 * (1 - u * 0.7), dt); i > 0; i--) puff(s2, x - ux * 0.25 * ts + s2.rand(-0.2, 0.2) * ts, y - uy * 0.25 * ts + 0.15 * ts, -ux * s2.rand(0.3, 0.9) + s2.rand(-0.4, 0.4), -uy * s2.rand(0.3, 0.9) + s2.rand(-0.3, 0.3), s2.rand(2.2, 3.4) * Math.sqrt(ts), s2.rand(0.55, 0.85), i > 1);
  });
  s.at(at + dur, (s2) => {
    for (let k = 0; k < 5; k++) puff(s2, x1 + ux * 0.3 * ts + s2.rand(-0.25, 0.25) * ts, y1 + uy * 0.3 * ts + s2.rand(-0.2, 0.2) * ts, ux * s2.rand(0.6, 1.4), uy * s2.rand(0.6, 1.4), s2.rand(2.8, 3.8) * Math.sqrt(ts), s2.rand(0.7, 1), k > 2);
    grit(s2, x1 + ux * 0.3 * ts, y1 + uy * 0.3 * ts, 6, Math.atan2(uy, ux), 0.8, 3.5, DUST);
    s2.add({ k: "mark", x: x1, y: y1, r: 0.46 * ts, life: 1.6, R, update: still });
  });
}

/** The shove's impact: a push front slamming into the body's near side, a flare along the blow, a lamp and a held frame. */
function shoveImpact(s, M, C, T, A, K, crit, D = 0, dur = 0.4) {
  const ts = sizeOf(T), big = Math.max(ts, sizeOf(C) * 0.7), z = 0.5 * (T.h ?? 1), cx = T.x - A.ux * 0.4 * ts, cy = T.y - A.uy * 0.4 * ts;
  hold(s, (crit ? 2.5 : 1.5) / 12, 1.2 + 0.5 * big * K);
  // the push front: bows pressed into the body's near side, riding it as it slides
  s.add({ k: "boFront", x: cx, y: cy, z, ux: A.ux, uy: A.uy, r: 0.8 * big * (crit ? 1.3 : 1), n: 3, half: 1.05, life: dur + 0.2, R: M.R, update(p) { const f = easeOut(clamp(p.age / dur)); p.x = cx + A.ux * D * f; p.y = cy + A.uy * D * f; } });
  s.add({ k: "stFlare", x: cx, y: cy, z, ux: A.ux, uy: A.uy, L: 36 * Math.min(1.5, Math.sqrt(big) * K), life: 4 / 12, R: M.R, seed: s.R(), update: still });
  s.add({ k: "flash", x: cx, y: cy, z, life: (crit ? 2 : 1) / 12, r: 0.3 * big * s.spec.aps * 0.6, R: M.R, update: still });
  s.light(cx, cy, z, 2.4 * big * K, S(M.R, 0.85), 0.45 * K, 0.5);
  s.light(cx, cy, z, 0.6 * big, S(M.R, 1), 0.6, 0.1);
  sparks(s, cx, cy, z, Math.round(10 * K), A.q, 0.7, 6, 13, M.R);
  s.add({ k: "ring", x: cx, y: cy, r: 0.8 * big, life: 0.35, R: M.R, seed: 21, update: still });
  if (crit) { s.crit(); s.add({ k: "stBurst", x: cx, y: cy, z, ux: A.ux, uy: A.uy, L: 15 * Math.sqrt(big), n: 12, life: 5 / 12, R: M.R, seed: s.R(), update: still }); }
}

function shove(s, M, ctx) {
  const slug = s.spec.slug ?? "";
  if (TRAMPLE.test(slug)) return trample(s, M, ctx);
  if (ROCK.test(slug)) return throwRock(s, M, ctx);
  const { C, list } = cast(s, ctx), t0 = ctx.t0;
  let end = t0;
  list.forEach((T, i) => {
    const o = outOf(s, T), K = POWK[o] ?? 1, miss = o === "miss" || T.virtual, crit = o === "crit" && !T.virtual;
    const A = axis(C, T), ts = sizeOf(T), cs = sizeOf(C), at = t0 + i * 0.12, hit = at + 0.12;
    // the lunge: speed lines from the shover into the body
    s.at(at, (s2) => {
      speedLines(s2, M.R, lerp(C.x, T.x, 0.35), lerp(C.y, T.y, 0.35), A.ux, A.uy, 5, 0.6 * cs, 0.3 * (C.h ?? 1), 0.9 * (C.h ?? 1), 12);
      puff(s2, C.x - A.ux * 0.3 * cs, C.y - A.uy * 0.3 * cs + 0.15, -A.ux * 1.2, -A.uy * 1.2, 2.8 * Math.sqrt(cs), 0.7);
    });
    if (miss) {
      // the body braces and does not budge: the front breaks on it, dust at its planted feet
      s.at(hit, (s2) => {
        s2.add({ k: "boFront", x: T.x - A.ux * 0.45 * ts, y: T.y - A.uy * 0.45 * ts, z: 0.5 * (T.h ?? 1), ux: A.ux, uy: A.uy, r: 0.45 * ts, n: 2, half: 0.7, life: 0.25, R: M.R, update: still });
        s2.light(T.x, T.y, 0.5, 1.2 * ts, S(M.R, 0.85), 0.35, 0.3);
        for (let k = 0; k < 4; k++) puff(s2, T.x + A.px * (k - 1.5) * 0.18 * ts, T.y + A.py * (k - 1.5) * 0.18 * ts + 0.15, s2.rand(-0.6, 0.6), 0.3, 2.6, 0.7, k > 1);
        sparks(s2, T.x - A.ux * 0.45 * ts, T.y - A.uy * 0.45 * ts, 0.5, 5, A.q + Math.PI, 1.1, 2, 5, M.R);
        s2.shake = Math.max(s2.shake, 0.7);
      });
      end = Math.max(end, hit + 1.3);
      return;
    }
    const D = (crit ? 2 : 1) * Math.max(1, Math.sqrt(cs / ts)) * (o === "neutral" ? 0.85 : 1);
    const dur = 0.32 + 0.12 * D;
    s.at(hit, (s2) => { shoveImpact(s2, M, C, T, A, K, crit, D, dur); s2.hit(T.id, 1.5 * K, { x: C.x, y: C.y }, M.R); });
    slide(s, M, T, A.ux, A.uy, D, hit + 0.02, dur);
    dress(s, M, ctx, T.x, T.y, 0.5 * T.h, hit, 0.35 * ts, 1);
    end = Math.max(end, hit + 2.4);
  });
  s.phases.push("shove: a push front, the body slides on dust and skid marks");
  s.period = end + 0.3;
}

/**
 * Trample: the creature drives through every body on its path. Its own
 * afterimages run the line, each footfall stamps dust and cracks, and every
 * body it passes is shoved off to the side it was standing on.
 */
function trample(s, M, ctx) {
  const { C, list } = cast(s, ctx), t0 = ctx.t0, cs = sizeOf(C);
  const cx = list.reduce((a, T) => a + T.x, 0) / list.length, cy = list.reduce((a, T) => a + T.y, 0) / list.length;
  const A = axis(C, { x: cx, y: cy });
  const far = Math.max(...list.map((T) => (T.x - C.x) * A.ux + (T.y - C.y) * A.uy)) + 0.6 * cs + 0.6;
  const E = { x: C.x + A.ux * far, y: C.y + A.uy * far }, dur = clamp(0.25 + far * 0.06, 0.35, 0.8);
  // the run: afterimages strung along the path, speed lines, a rumble
  s.at(t0, (s2) => {
    const n = Math.max(4, Math.round(far * 1.1));
    for (let k = 0; k <= n; k++) {
      const f = k / n;
      s2.add({ k: "fmGhost", x: lerp(C.x, E.x, f), y: lerp(C.y, E.y, f), size: cs, h: C.h ?? 1, a: 0.3 + 0.5 * f, life: 0.5 + 0.3 * f, R: M.R, wait: f * dur });
    }
    speedLines(s2, M.R, C.x + A.ux * 0.5, C.y + A.uy * 0.5, A.ux, A.uy, 8, 0.9 * cs, 0.2, 1.1 * (C.h ?? 1), 14);
    dustRing(s2, C.x, C.y, 6, 0.5 * cs, 1.2, Math.sqrt(cs));
    s2.shake = Math.max(s2.shake, 1);
  });
  // footfalls: a stamp every stride along the path
  const stride = 0.75 * Math.sqrt(cs), steps = Math.max(2, Math.floor(far / stride));
  for (let k = 1; k <= steps; k++) {
    const f = k / steps, x = lerp(C.x, E.x, f) + A.px * (k % 2 ? 0.18 : -0.18) * cs, y = lerp(C.y, E.y, f) + A.py * (k % 2 ? 0.18 : -0.18) * cs;
    s.at(t0 + f * dur, (s2) => {
      s2.add({ k: "ring", x, y, r: 0.5 * Math.sqrt(cs), life: 0.35, R: DUST, broken: true, seed: k, update: still });
      for (let j = 0; j < 3; j++) puff(s2, x + s2.rand(-0.15, 0.15), y + s2.rand(-0.1, 0.1), s2.rand(-0.8, 0.8), s2.rand(-0.5, 0.5), 2.6 * Math.sqrt(cs), 0.7, j > 0);
      grit(s2, x, y, 3, 0, Math.PI, 3, DUST);
      if (k % 2 === 0) s2.add({ k: "mlCracks", x, y, r: 0.4 * Math.sqrt(cs), life: 1.4, R: DUST, seed: s2.seedInt(), minor: true, update: still });
      s2.shake = Math.max(s2.shake, 0.8 + 0.2 * cs);
    });
  }
  s.add({ k: "boSkid", x: C.x, y: C.y, x1: E.x, y1: E.y, n: 2, gap: 9 * Math.sqrt(cs), grow: dur, life: 2.6, R: DUST, seed: 9, update: still });
  let end = t0 + dur;
  list.forEach((T) => {
    if (T.virtual) return;
    const o = outOf(s, T), K = POWK[o] ?? 1, miss = o === "miss", crit = o === "crit";
    const d = (T.x - C.x) * A.ux + (T.y - C.y) * A.uy, at = t0 + clamp((d - 0.4 * cs) / far, 0, 1) * dur;
    const side = (T.x - C.x) * A.px + (T.y - C.y) * A.py >= 0 ? 1 : -1, ox = A.px * side * 0.6 + A.ux * 0.4, oy = A.py * side * 0.6 + A.uy * 0.4, [sx, sy] = norm(ox, oy);
    const B = { ux: sx, uy: sy, px: -sy, py: sx, q: Math.atan2(sy, sx) };
    if (miss) {
      // dodged: the herd passes, dust at the feet of a body that stepped aside
      s.at(at, (s2) => { for (let k = 0; k < 3; k++) puff(s2, T.x, T.y + 0.2, sx * 0.8, sy * 0.8, 2.6, 0.7, k > 0); });
      return;
    }
    const D = crit ? 1.2 : 0.75;
    s.at(at, (s2) => { shoveImpact(s2, M, { x: T.x - sx, y: T.y - sy, size: cs }, T, B, K, crit, D, 0.3); s2.hit(T.id, 1.5 * K, { x: T.x - sx, y: T.y - sy }, M.R); });
    slide(s, M, T, sx, sy, D, at + 0.02, 0.3);
    end = Math.max(end, at + 0.4);
  });
  s.phases.push("trample: a run of afterimages, footfalls, bodies shoved aside");
  s.period = end + 2.2;
}

/**
 * Throw Rock (pixelfx boulder + dirt-explosion): the creature tears a boulder
 * out of the floor, hefts it, and lobs it end over end; it lands in a burst
 * of dirt, chunks tumbling out and dust rolling over the body.
 */
function throwRock(s, M, ctx) {
  const { C, list } = cast(s, ctx), t0 = ctx.t0, cs = sizeOf(C);
  const R = M.id === "kinetic" || M.id === "neutral" ? RAMP.earth : M.R, T = list[0];
  const o = outOf(s, T), K = POWK[o] ?? 1, miss = o === "miss" || T.virtual, crit = o === "crit" && !T.virtual, ts = sizeOf(T);
  const A = axis(C, T), r = (6 + 4.5 * Math.sqrt(cs)) * (crit ? 1.2 : 1), seed = s.seedInt();
  // the heft: the floor bursts where the rock is torn up, the rock rises to the hand
  const gx = C.x + A.ux * 0.45 * cs, gy = C.y + A.uy * 0.45 * cs, top = 1.15 * (C.h ?? 1) + 0.2 * cs;
  s.at(t0, (s2) => {
    grit(s2, gx, gy, 10, 0, Math.PI, 3.5, R);
    dustRing(s2, gx, gy, 6, 0.4, 1.2, Math.sqrt(cs));
    s2.add({ k: "mlCracks", x: gx, y: gy, r: 0.45 * Math.sqrt(cs), life: 1.6, R: DUST, seed, update: still });
    s2.shake = Math.max(s2.shake, 0.6);
  });
  const lift = 0.3, hold0 = t0 + lift, throwAt = hold0 + 0.12;
  const end = miss ? { x: T.x + A.ux * 1.1 * ts + A.px * 0.8 * ts, y: T.y + A.uy * 1.1 * ts + A.py * 0.8 * ts, z: 0.1 } : { x: T.x, y: T.y, z: 0.5 * (T.h ?? 1) };
  const dist = Math.hypot(end.x - gx, end.y - gy), dur = clamp(0.4 + dist * 0.05, 0.5, 0.9), arc = 1 + dist * 0.18;
  s.at(t0, (s2) => s2.add({
    k: "boRock", x: gx, y: gy, z: 0, r, R, seed, rot: 0, life: lift + 0.12 + dur, update(p, s3, dt) {
      const t = p.age;
      if (t < lift + 0.12) { const f = easeOut(clamp(t / lift)); p.z = f * top; p.rot += dt * 2; return; }
      const u = clamp((t - lift - 0.12) / dur);
      p.x = lerp(gx, end.x, u); p.y = lerp(gy, end.y, u); p.z = lerp(top, end.z, u) + Math.sin(Math.PI * u) * arc; p.rot += dt * 9;
      // dust and grit shed off the tumbling rock
      for (let i = s3.count(30, dt); i > 0; i--) s3.add({ k: "mote", x: p.x + s3.rand(-0.1, 0.1), y: p.y, z: p.z, vx: s3.rand(-0.3, 0.3), vz: -s3.rand(0.2, 0.8), drag: 2, life: s3.rand(0.3, 0.6), R: DUST, minor: i > 0 });
      if (s3.R() < dt * 10) s3.add({ k: "chunk", x: p.x, y: p.y, z: p.z, vx: s3.rand(-1, 1), vy: s3.rand(-0.5, 0.5), vz: 0, g: 26, drag: 0.6, bounce: 0.3, life: 0.8, R, s: 1, minor: true });
    },
  }));
  // its shadow on the floor, tracking under it, tightening as it falls
  s.at(throwAt, (s2) => s2.add({ k: "darkpool", x: gx, y: gy, r: 0.3 * Math.sqrt(cs), life: dur, R: RAMP.smoke, update(p) { const u = clamp(p.age / dur); p.x = lerp(gx, end.x, u); p.y = lerp(gy, end.y, u); p.r = (0.3 + 0.25 * u) * Math.sqrt(cs); } }));
  s.at(hold0, (s2) => s2.add({ k: "glint", x: gx, y: gy, z: top + r / 26, life: 5 / 12, R: RAMP.kinetic, big: true, update: still }));
  const land = throwAt + dur;
  s.at(land, (s2) => {
    const x = end.x, y = end.y, k = miss ? 0.7 : K, big = Math.sqrt(Math.max(ts, cs * 0.7)) * k;
    // the rock breaks: its big pieces tumble out, grit sprays, dirt rolls over the floor
    for (let i = 0; i < Math.round(22 * k); i++) {
      const q = s2.rand(0, TAU), v = s2.rand(2, 7) * big;
      s2.add({ k: "chunk", x, y, z: end.z * 0.5 + 0.1, vx: Math.cos(q) * v, vy: Math.sin(q) * v, vz: s2.rand(2, 5.5), g: 30, drag: 1, bounce: 0.4, life: s2.rand(1, 1.8), R, s: i < 5 ? 3 : i % 3 ? 1 : 2, wide: s2.R() < 0.4, debris: true, minor: i > 10 });
    }
    for (let i = 0; i < Math.round(9 * k); i++) {
      const q = s2.rand(0, TAU), v = s2.rand(0.5, 1.8) * big;
      s2.add({ k: "smoke", x: x + Math.cos(q) * 0.2, y: y + Math.sin(q) * 0.2, z: s2.rand(0.05, 0.4), vx: Math.cos(q) * v, vy: Math.sin(q) * v, vz: s2.rand(0.2, 0.6), g: -0.05, drag: 2.2, r: s2.rand(3.5, 5.5) * big, life: s2.rand(0.8, 1.3), lobes: lobes(s2), R, tone: 0.45, minor: i > 4 });
    }
    dustRing(s2, x, y, 10, 0.6 * big, 2 * big, big);
    s2.add({ k: "ring", x, y, r: 1.3 * big, life: 0.45, R: DUST, seed: 31, update: still });
    s2.add({ k: "ring", x, y, r: 2 * big, life: 0.65, R: DUST, broken: true, seed: 37, wait: 1 / 12, minor: true, update: still });
    s2.add({ k: "mlCracks", x, y, r: 0.8 * big, life: 1.8, R: DUST, seed: s2.seedInt(), update: still });
    s2.add({ k: "flash", x, y, z: end.z, life: (crit ? 2 : 1) / 12, r: 0.45 * big * s2.spec.aps * 0.6, R, update: still });
    s2.light(x, y, end.z, 2.4 * big, S(R, 0.9), 0.55, 0.6);
    hold(s2, (crit ? 2.5 : 1.5) / 12, 1.5 + big);
    if (!miss) s2.hit(T.id, 1.5 * K, { x: gx, y: gy }, R);
    if (crit) s2.crit();
  });
  if (!miss) dress(s, M, ctx, T.x, T.y, 0.5 * T.h, land, 0.4 * ts, 1);
  s.phases.push("throw rock: torn up, hefted, lobbed, a dirt burst");
  s.period = land + 2.2;
}

/* ── rend ───────────────────────────────────────────────────────────── */

/**
 * pixelfx claw-swipe, twice and crossed, then a tear: two rakes of three
 * claw lines cut across each other through the body, the wound they leave
 * rips open between them with a held frame and sprays out both sides.
 */
function rend(s, M, ctx) {
  const { C, list } = cast(s, ctx), t0 = ctx.t0;
  const W = M.id === "kinetic" || M.id === "neutral" ? RAMP.bleed : M.R;
  let end = t0;
  list.forEach((T, i) => {
    const o = outOf(s, T), K = POWK[o] ?? 1, miss = o === "miss" || T.virtual, crit = o === "crit" && !T.virtual;
    const A = axis(C, T), ts = sizeOf(T), cs = sizeOf(C), big = Math.max(ts, cs * 0.75), kk = crit ? 1.35 : 1;
    const at = t0 + i * 0.14, z = 0.55 * (T.h ?? 1), L = (42 + 10 * Math.sqrt(big)) * Math.sqrt(big) * kk, gap = 6 + Math.sqrt(big) * 2;
    const X = miss ? T.x + A.px * 0.5 * ts + A.ux * 0.3 : T.x, Y = miss ? T.y + A.py * 0.5 * ts + A.uy * 0.3 : T.y;
    // two rakes, each down a diagonal, crossing in the middle of the body
    const rakes = [[0.75, 1], [-0.75, -1]];
    rakes.forEach(([tq, uz], j) => {
      const q = A.q + Math.PI / 2 + tq, ux = Math.cos(q), uy = Math.sin(q), t = at + j * 0.15;
      s.at(t, (s2) => {
        s2.add({ k: "boGash", x: X, y: Y, z, ux, uy, uz: uz * 0.35, L, n: 3 + (crit ? 1 : 0), gap, w: 1.6 * Math.sqrt(big), life: 1.4, R: M.R, R2: W, hero: crit && j === 1, update: still });
        // the claws' travel: speed lines carried on past the body along the rake
        speedLines(s2, M.R, X + ux * 0.2, Y + uy * 0.2, ux, uy, 3, gap * 2 / 26, z - 0.1, z + 0.1, 12);
        s2.light(X, Y, z, 1.8 * big, S(M.R, 0.9), 0.55, 0.2);
        if (!miss) {
          s2.hit(T.id, (0.55 + 0.2 * j) * K, { x: X - ux, y: Y - uy }, M.R);
          sparks(s2, X + ux * 0.3, Y + uy * 0.3, z, 6, q, 0.5, 4, 9, W);
          s2.shake = Math.max(s2.shake, 0.6);
        }
      });
    });
    if (miss) { end = Math.max(end, at + 1.4); return; }
    // the tear: the wound rips open across both rakes, the frame holds, it sprays out both sides
    const rip = at + 0.42, rq = A.q + Math.PI / 2;
    s.at(rip, (s2) => {
      hold(s2, (crit ? 2.5 : 1.6) / 12, 1.2 + 0.5 * big * K);
      s2.hit(T.id, 1.35 * K, { x: C.x, y: C.y }, M.R);
      s2.add({ k: "boRip", x: T.x, y: T.y, z, ux: Math.cos(rq), uy: Math.sin(rq), L: L * 1.1, open: Math.sqrt(big) * kk, life: 8 / 12, R: M.R, R2: W, hero: true, seed: s2.seedInt(), update: still });
      s2.add({ k: "flash", x: T.x, y: T.y, z, life: (crit ? 2 : 1) / 12, r: 0.38 * big * s2.spec.aps * 0.6, R: M.R, update: still });
      s2.light(T.x, T.y, z, 2.6 * big * K, S(W, 0.8), 0.7 * K, 0.6);
      for (const sd of [-1, 1]) {
        const base = A.q + sd * 0.9;
        for (let k = 0; k < Math.round(12 * K * Math.sqrt(big)); k++) {
          const a = base + s2.rand(-0.6, 0.6), v = s2.rand(3, 8) * Math.sqrt(big);
          s2.add({ k: "spark", x: T.x, y: T.y, z, vx: Math.cos(a) * v, vy: Math.sin(a) * v, vz: s2.rand(0.5, 3), g: 14, drag: 1.4, bounce: 0.2, life: s2.rand(0.3, 0.6), R: W, minor: k % 2 === 1 });
        }
      }
      // drops of the wound fall and splat around the feet
      for (let k = 0; k < Math.round(8 * K); k++) {
        const a = s2.rand(0, TAU), v = s2.rand(0.8, 2.4) * Math.sqrt(big);
        s2.add({ k: "drip", x: T.x, y: T.y, z, vx: Math.cos(a) * v, vy: Math.sin(a) * v, vz: s2.rand(0.5, 2), g: 12, drag: 0.8, life: 2, R: W, onGround: splatOf(W), minor: k > 4 });
      }
      if (crit) { s2.crit(); s2.add({ k: "stBurst", x: T.x, y: T.y, z, ux: A.ux, uy: A.uy, L: 14 * Math.sqrt(big), n: 12, life: 5 / 12, R: M.R, seed: s2.R(), update: still }); }
    });
    dress(s, M, ctx, T.x, T.y, z, rip, 0.35 * ts, 1.1);
    end = Math.max(end, rip + 1.8);
  });
  s.phases.push("rend: two rakes cross, the wound tears, a spray");
  s.period = end + 0.4;
}

/** A drop landing in its own colour: a little puddle and a two-frame splash. */
const splatOf = (R) => (p, s) => {
  p.life = 0;
  s.add({ k: "puddle", x: p.x, y: p.y, r: s.rand(0.05, 0.1), life: s.rand(1.4, 2.2), R, debris: true, minor: true, update() {} });
  s.add({ k: "splash", x: p.x, y: p.y, z: 0, life: 3 / 12, R, minor: true, update() {} });
};

/* ── charge ─────────────────────────────────────────────────────────── */

/**
 * pixelfx dash-strike, up to the cut: a crouch kicks dust back, the body is
 * across the floor in a string of afterimages and speed lines, and it lands
 * braced in front of the target with a flash and a front of force. The Strike
 * that follows lands the blow, so nothing flinches the target here.
 */
function charge(s, M, ctx) {
  const { C, list } = cast(s, ctx), t0 = ctx.t0, cs = sizeOf(C), T = list[0];
  const o = outOf(s, T), crit = o === "crit" && !T.virtual, miss = o === "miss", ts = sizeOf(T), kk = crit ? 1.3 : 1;
  const A = axis(C, T), stand = 0.45 * ts + 0.5 * cs + (miss ? 0.45 : 0);
  const dist0 = Math.hypot(T.x - C.x, T.y - C.y), reach = Math.max(T.virtual ? 2.6 * Math.sqrt(cs) : 0.4, dist0 - stand);
  const E = { x: C.x + A.ux * reach, y: C.y + A.uy * reach }, dur = clamp(0.12 + reach * 0.035, 0.16, 0.38), arrive = t0 + 0.08 + dur, h = C.h ?? 1;
  // the push-off: dust and grit kicked back from the feet
  s.at(t0, (s2) => {
    for (let k = 0; k < 6; k++) puff(s2, C.x - A.ux * 0.25 * cs + s2.rand(-0.15, 0.15), C.y - A.uy * 0.25 * cs + 0.1, -A.ux * s2.rand(1, 2.4) + s2.rand(-0.5, 0.5), -A.uy * s2.rand(1, 2.4) + s2.rand(-0.4, 0.4), s2.rand(2.6, 3.8) * Math.sqrt(cs), s2.rand(0.6, 0.9), k > 2);
    grit(s2, C.x - A.ux * 0.25 * cs, C.y - A.uy * 0.25 * cs, 6, A.q + Math.PI, 0.7, 4, DUST);
    s2.add({ k: "ring", x: C.x, y: C.y, r: 0.6 * cs, life: 0.35, R: DUST, broken: true, seed: 41, update: still });
    s2.shake = Math.max(s2.shake, 0.6);
  });
  // the dash: afterimages strung along the path, brightest at the front, speed lines streaming past
  const n = Math.max(4, Math.round(reach * 1.8)) + (crit ? 2 : 0);
  s.at(t0 + 0.08, (s2) => {
    for (let k = 1; k <= n; k++) {
      const f = k / n;
      s2.add({ k: "fmGhost", x: lerp(C.x, E.x, f), y: lerp(C.y, E.y, f), size: cs, h, a: 0.2 + 0.55 * f, life: 0.35 + 0.35 * f, R: M.R, wait: f * dur });
    }
    for (let k = 0; k < 12 * kk; k++) {
      const f = s2.R(), o2 = s2.rand(-0.45, 0.45) * cs, v = s2.rand(14, 22);
      s2.add({ k: "streak", x: lerp(C.x, E.x, f) + A.px * o2, y: lerp(C.y, E.y, f) + A.py * o2, z: s2.rand(0.1, 1) * h, vx: A.ux * v, vy: A.uy * v, life: s2.rand(0.12, 0.22), R: M.R, wait: f * dur * 0.8, minor: k % 2 === 1 });
    }
    s2.add({ k: "boSkid", x: C.x, y: C.y, x1: E.x, y1: E.y, n: 2, gap: 6 * Math.sqrt(cs), grow: dur, life: 1.6, R: DUST, seed: 43, minor: true, update: still });
  });
  // footfall dust along the path, and the material's own trail
  s.emit(t0 + 0.08, arrive, (s2, u, dt) => {
    const x = lerp(C.x, E.x, u), y = lerp(C.y, E.y, u);
    for (let i = s2.count(30, dt); i > 0; i--) puff(s2, x + s2.rand(-0.2, 0.2) * cs, y + 0.12 * cs, -A.ux * s2.rand(0.4, 1.2), -A.uy * s2.rand(0.4, 1.2), s2.rand(2, 3) * Math.sqrt(cs), s2.rand(0.45, 0.7), i > 0);
    if (M.id !== "kinetic" && M.id !== "neutral") M.mod.trail?.(s2, M, { x, y, z: 0.5 * h, dt });
  });
  // braced: a flash and a front of force at the meeting point, the feet skid to a stop
  s.at(arrive, (s2) => {
    const fx = E.x + A.ux * 0.35 * cs, fy = E.y + A.uy * 0.35 * cs, z = 0.6 * h;
    s2.add({ k: "boFront", x: fx, y: fy, z, ux: A.ux, uy: A.uy, r: 0.8 * cs * kk, n: miss ? 2 : 3, half: 1.1, life: 0.4, R: M.R, update: still });
    s2.add({ k: "fmGhost", x: E.x, y: E.y, size: cs, h, a: 0.85, life: 0.5, R: M.R });
    s2.add({ k: "flash", x: fx, y: fy, z, life: (crit ? 2 : 1) / 12, r: (miss ? 0.3 : 0.5) * cs * kk * s2.spec.aps * 0.6, R: M.R, update: still });
    s2.add({ k: "ring", x: E.x, y: E.y, r: 1.1 * cs * kk, life: 0.4, R: DUST, broken: true, seed: 51, update: still });
    grit(s2, E.x + A.ux * 0.2 * cs, E.y + A.uy * 0.2 * cs, 6, A.q, 0.6, 4, DUST);
    s2.light(fx, fy, z, 2.2 * cs * kk, S(M.R, 0.85), miss ? 0.4 : 0.7, 0.45);
    s2.light(fx, fy, z, 0.7 * cs, S(M.R, 1), 0.8, 0.1);
    if (!miss) speedLines(s2, M.R, fx, fy, A.ux, A.uy, 7, 0.8 * cs, 0.2 * h, 1 * h, 12);
    for (let k = 0; k < 5; k++) puff(s2, E.x + A.ux * 0.2 * cs + A.px * (k - 2) * 0.15 * cs, E.y + A.uy * 0.2 * cs + A.py * (k - 2) * 0.15 * cs + 0.12, A.ux * s2.rand(0.8, 1.8), A.uy * s2.rand(0.8, 1.8), s2.rand(2.6, 3.6) * Math.sqrt(cs), 0.8, k > 2);
    s2.add({ k: "boSkid", x: E.x - A.ux * 0.55 * cs, y: E.y - A.uy * 0.55 * cs, x1: E.x + A.ux * 0.1, y1: E.y + A.uy * 0.1, n: 2, gap: 6 * Math.sqrt(cs), grow: 0.15, life: 1.8, R: DUST, seed: 47, update: still });
    hold(s2, (crit ? 2 : 1) / 12, 0.9 + 0.3 * cs);
    if (crit) {
      s2.add({ k: "stFlare", x: fx, y: fy, z, ux: A.ux, uy: A.uy, L: 44 * Math.sqrt(cs), life: 4 / 12, R: M.R, seed: s2.R(), update: still });
      s2.add({ k: "ring", x: fx, y: fy, r: 1 * cs, life: 0.4, R: M.R, seed: 49, update: still });
    }
  });
  s.phases.push("charge: push-off, a dash of afterimages, braced in a flash");
  s.period = arrive + 1.8;
}

/* ── flurry ─────────────────────────────────────────────────────────── */

/**
 * pixelfx dagger-flurry: a run of quick small cuts at every angle, each with
 * a flick of sparks, the beats closing up, a beat of rest and a bigger finish.
 * Ours puts the attacker's afterimage on a new side of the body for every
 * beat and keeps the count over the head, one pip per blow. Each Strike plays
 * its own hit; this is the rhythm, so the body only flinches on the finish.
 */
function flurry(s, M, ctx) {
  const { C, list } = cast(s, ctx), t0 = ctx.t0, cs = sizeOf(C), T = list[0];
  const o = outOf(s, T), crit = o === "crit" && !T.virtual, miss = o === "miss", ts = sizeOf(T), big = Math.max(ts, cs * 0.75);
  const A = axis(C, T), n = clamp(3 + (s.m >= 0.95 ? 1 : 0) + (crit ? 1 : 0), 3, 5), h = T.h ?? 1;
  // the beats close up: each gap ~3/4 of the last
  const beats = []; let t = t0 + 0.1, gap = 0.17;
  for (let k = 0; k < n; k++) { beats.push(t); t += gap; gap *= 0.74; }
  const fin = t + 0.06;
  s.at(t0, (s2) => s2.add({ k: "boPips", x: T.x, y: T.y, z: 1.25 * h + 0.25, beats: beats.map((b) => b - t0), dud: miss, hero: crit, life: fin - t0 + 1.1, R: M.R, update: still }));
  beats.forEach((b, k) => {
    // each blow comes from a new side: round the near half of the body, alternating
    const side = k % 2 ? 1 : -1, q = A.q + Math.PI + side * (0.45 + 0.35 * ((k >> 1) % 2)) + (hash(k, s.seed) - 0.5) * 0.3;
    const gx = T.x + Math.cos(q) * (0.5 * ts + 0.45 * cs), gy = T.y + Math.sin(q) * (0.5 * ts + 0.45 * cs);
    const X = miss ? T.x + A.px * side * 0.55 * ts : T.x, Y = miss ? T.y + A.py * side * 0.55 * ts : T.y, z = (0.45 + 0.12 * (k % 3)) * h;
    s.at(b, (s2) => {
      s2.add({ k: "fmGhost", x: gx, y: gy, size: cs, h: C.h ?? 1, a: 0.6, life: 0.26, R: M.R });
      s2.add({ k: "crescent", x: X, y: Y, z, from: [gx, gy, z + 0.25], life: 4 / 12, R: M.R, flip: side, span: 2.1, R2: (20 + 4 * Math.sqrt(big)) * Math.sqrt(big), T: 5, update: still });
      const cx = lerp(gx, X, 0.75), cy = lerp(gy, Y, 0.75), [bx, by] = norm(X - gx, Y - gy);
      s2.add({ k: "stFlare", x: cx, y: cy, z, ux: bx, uy: by, L: (16 + 3 * k) * Math.sqrt(big), life: 3 / 12, R: M.R, seed: s2.R(), update: still });
      s2.add({ k: "glint", x: cx, y: cy, z: z + 0.15, life: 5 / 12, R: M.R, big: k === n - 1, update: still });
      sparks(s2, cx, cy, z, 5, Math.atan2(Y - gy, X - gx), 0.6, 4, 10, M.R);
      s2.light(cx, cy, z, 1.4 * big, S(M.R, 0.9), 0.5, 0.12);
      speedLines(s2, M.R, gx, gy, ...norm(X - gx, Y - gy), 2, 0.25, z - 0.15, z + 0.15, 10);
    });
  });
  // the finish: the count pops, a ring and a lamp; the body flinches once
  s.at(fin, (s2) => {
    const z = 0.55 * h;
    s2.add({ k: "ring", x: T.x, y: T.y, r: 0.9 * big * (crit ? 1.35 : 1), life: 0.4, R: M.R, seed: 53, update: still });
    s2.light(T.x, T.y, z, 2.2 * big, S(M.R, 0.85), miss ? 0.35 : 0.65, 0.5);
    if (miss) return;
    s2.add({ k: "flash", x: T.x, y: T.y, z, life: (crit ? 2 : 1) / 12, r: 0.35 * big * s2.spec.aps * 0.6, R: M.R, update: still });
    if (!T.virtual) s2.hit(T.id, crit ? 0.9 : 0.5, { x: C.x, y: C.y }, M.R);
    hold(s2, (crit ? 2 : 1) / 12, 0.8);
    if (crit) {
      s2.add({ k: "stFlare", x: T.x, y: T.y, z, ux: A.ux, uy: A.uy, L: 40 * Math.sqrt(big), life: 4 / 12, R: M.R, seed: s2.R(), update: still });
      sparks(s2, T.x, T.y, z, 14, 0, Math.PI, 5, 12, M.R);
    }
  });
  if (!miss) dress(s, M, ctx, T.x, T.y, 0.5 * h, fin, 0.3 * ts, 0.9);
  s.phases.push(`flurry: ${n} blows round the body, accelerating`);
  s.period = fin + 1.4;
}

/* Maneuvers: compile.mjs buildForm skips the spell charge for these (unless a spell plays one). */
export default Object.fromEntries(Object.entries({ grab, trip, shove, rend, charge, flurry }).map(([k, f]) => [k, Object.assign(f, { noCharge: true })]));
