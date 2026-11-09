/**
 * Spellsprite archetypes — shift: a body that changes shape, folds through space, quickens or lifts.
 * docs/SPELLSPRITE_ARCHETYPES.md §4 says what each covers; the spellsprite-craft skill says how good it must be.
 *
 * Each drawer is (s, M, ctx) like a FORMS entry: ctx = { caster, targets, area, hand, t0, release, linger, fire, self }.
 * compile.mjs `buildForm` has already drawn the wind-up before `t0` and, for an area, its footprint and wave.
 *
 *   polymorph  Change Shape and every polymorph: ribbons of the material wind up the body from the
 *              feet into a cocoon, motes are pulled into it, it squeezes tight and glows, cracks with
 *              light and bursts in a flash, shedding tumbling scraps; the new form pops (the token
 *              squashes, a ring snaps out round it, sparkles at the corners). A mist form winds and
 *              bursts in vapour, a swarm form in a cloud of buzzing motes, a shadow form in dark wisps
 *              (the variant comes from the slug, then the traits).
 *   teleport   fold and step: the body crackles with gathering light, a flash, then it is pressed into
 *              a vertical seam (light streaming in from both sides) that pinches to a line, a point and
 *              pops in sparks; at the destination a point opens into a line, the seam splits wide and
 *              throws its light out, then shuts with a landing ring and a puff of dust. Foundry moves
 *              the token; with no destination both beats play on the caster a moment apart.
 *   haste      a crackling pulse through the body, a clock dial under the feet whose hands spin faster
 *              and faster, speed lines streaming off the body, bright afterimages zipping behind it,
 *              sparks off the heels; a last quick pulse as the clock flares out.
 *   fly        a gust under the feet: a downdraft ring of dust and wind arcs thrown out across the
 *              floor, a hoop of wind climbing the body, the shadow left on the floor sliding away and
 *              shrinking as the body lifts, feathers (or motes of the material) drifting down. Levitate
 *              (and feather fall) is gentler: no dust, a slow lift, a few feathers.
 */

import { TAU, clamp, lerp, easeOut, hash, fadeOut, q12, pnoise } from "../core/rand.mjs";
import { RAMP, S } from "../core/palette.mjs";
import { registerShapes } from "../core/shapes.mjs";
import { still, sd, lobes } from "../core/motifs.mjs";

const easeInOut = (u) => u * u * (3 - 2 * u);
const easeIn = (u) => u * u * u;
const backOut = (u, k = 1.7) => 1 + (k + 1) * (u - 1) ** 3 + k * (u - 1) ** 2;

/* ── shapes only the shift archetypes draw ────────────────────────────── */

registerShapes({
  /** Polymorph's cocoon: ribbons wound round the body from the feet up, a glow inside that tightens. */
  shCocoon(v, P, p) {
    const a = p.age, grow = easeOut(clamp(a / p.wrap)), top = v.kind === "top", fr = Math.floor(a * 12);
    const sq = p.sq ?? 1, gone = clamp((a - (p.life - 0.08)) / 0.08);
    if (gone >= 1) return;
    const H = p.h * 1.12 * grow, r0 = 0.5 * p.size * sq, steps = 24;
    // the glow inside: a translucent body brightening as the wrap tightens
    const [bx, by] = v.ap(p.x, p.y, 0), G = v.aps;
    const gx = top ? 0.44 * p.size * sq * G : 0.28 * p.size * sq * G, gy = top ? gx : 0.55 * p.h * G * grow;
    const cy = top ? by : by - gy, ga = (0.25 + 0.5 * (p.glow ?? 0)) * (1 - gone);
    if (gx > 1 && gy > 1) P.shade(bx - gx, cy - gy, bx + gx, cy + gy, (x, y) => {
      const d = ((x - bx) / gx) ** 2 + ((y - cy) / gy) ** 2; if (d > 1) return null;
      return { c: S(p.R, d < 0.3 ? 0.85 : 0.62), a: ga };
    }, 0, "mix");
    // the ribbons, back half first and dim, front half over it and lit
    for (let pass = 0; pass < 2; pass++) for (let k = 0; k < p.n; k++) {
      const q0 = p.q0 + (k * TAU) / p.n;
      let prev = null, prevFront = false;
      for (let i = 0; i <= steps; i++) {
        const f = i / steps; if (f > grow + 0.01) break;
        const q = q0 + f * TAU * 1.2 + a * p.spin, rr = r0 * (0.5 + 0.5 * Math.sin(Math.PI * (0.12 + f * 0.82)));
        const pt = v.ap(p.x + Math.cos(q) * rr, p.y + Math.sin(q) * rr, f * H), front = Math.sin(q) > 0;
        if (prev && (pass === 1) === (front || prevFront)) {
          const hot = p.crack && hash(k, i, fr) > 0.6;
          P.line(prev[0], prev[1], pt[0], pt[1], S(p.R, hot ? 1 : pass ? (f > grow - 0.08 ? 1 : 0.88) : 0.5), pass ? 1 : 0, 1 - gone);
        }
        prev = pt; prevFront = front;
      }
    }
    // splitting: seams of light cracking up the cocoon just before it bursts
    if (p.crack) for (let k = 0; k < 3; k++) {
      const q = p.q0 + k * 2.1 + fr * 0.7, xx = Math.cos(q) * r0 * 0.6;
      let [lx, ly] = v.ap(p.x + xx, p.y + Math.sin(q) * r0 * 0.5, 0.05 * p.h);
      for (let j = 1; j <= 5; j++) {
        const [nx, ny] = v.ap(p.x + xx + (hash(k, j, fr) - 0.5) * 0.2 * p.size, p.y + Math.sin(q) * r0 * 0.5 + (top ? (j / 5 - 0.5) * 0.6 * p.size : 0), (j / 5) * H);
        P.line(lx, ly, nx, ny, S(p.R, 1), 2);
        lx = nx; ly = ny;
      }
    }
  },

  /** Teleport's seam: a vertical tear in space, a lens that pinches shut (out) or splits open (in). */
  shSeam(v, P, p) {
    const a = p.age, top = v.kind === "top", fr = Math.floor(a * 12);
    let w, hh;
    if (p.out) {
      // the body pressed flat: a lens, a line, a point
      if (a < 0.06) { w = 1; hh = 1; } else if (a < 0.2) { w = 1 - easeIn((a - 0.06) / 0.14); hh = 1; } else { w = 0; hh = 1 - (clamp((a - 0.2) / 0.09)) ** 2; }
    } else {
      // a point, a line, the seam splitting wide, then shutting
      if (a < 0.08) { hh = easeOut(a / 0.08); w = 0; } else if (a < 0.22) { hh = 1; w = backOut((a - 0.08) / 0.14, 1.2); } else { hh = 1; w = 1 - easeIn(clamp((a - 0.22) / 0.16)); }
    }
    if (hh <= 0.02) return;
    const G = v.aps, [bx, by] = v.ap(p.x, p.y, top ? 0 : 0.5 * p.h), W = p.w * w, Hh = (top ? 0.62 * p.size : 0.62 * p.h) * G * hh;
    const hero = p.out ? a < 1 / 12 : false;
    for (let j = -Math.ceil(Hh) - 3; j <= Math.ceil(Hh) + 3; j++) {
      const f = (j + Hh) / (2 * Hh);
      if (f < 0 || f > 1) {
        // the tear runs on past the lens as a thin flickering thread
        if (hash(j, fr, 3) > 0.35) P.px(bx, by + j, S(p.R, 0.75), 2);
        continue;
      }
      const hw = W * Math.sin(Math.PI * f) ** 0.6;
      if (hw < 0.5) { P.px(bx, by + j, S(p.R, 1), 2); continue; }
      for (let i = Math.floor(-hw - 1); i <= Math.ceil(hw + 1); i++) {
        const e = Math.abs(i) / hw;
        if (e > 1) { if (e < 1 + 1.4 / hw && hash(i, j, fr) > 0.5) P.px(bx + i, by + j, S(p.R, 0.62), 2); continue; }
        // out: the body as a sheet of light; in: the dark fold behind the opening, lit at its lips
        const c = hero ? S(p.R, 1) : p.out ? S(p.R, e < 0.4 ? 1 : e < 0.75 ? 0.85 : 0.68) : e > 0.72 ? S(p.R, e > 0.88 ? 1 : 0.85) : e > 0.45 ? S(p.R, 0.4) : S(p.R, 0.12);
        P.px(bx + i, by + j, c, 2);
      }
    }
  },

  /** A crackling outline of light round a body, thicker as it gathers. */
  shOutline(v, P, p) {
    const k = clamp(p.age / p.life), fr = Math.floor(p.age * 24), top = v.kind === "top", G = v.aps;
    const [bx, by] = v.ap(p.x, p.y, top ? 0 : 0.5 * p.h), rx = (top ? 0.47 : 0.3) * p.size * G, ry = top ? rx : 0.6 * p.h * G;
    const dens = 0.25 + 0.65 * k;
    P.ellipse(bx, by, rx, ry, (q) => (hash(Math.floor(q * rx), fr, 5) < dens ? S(p.R, k > 0.6 && hash(Math.floor(q * rx), 7) < 0.4 ? 1 : 0.85) : null), 1);
    if (k > 0.45) P.ellipse(bx, by, rx + 1.5, ry + 1.5, (q) => (hash(Math.floor(q * rx), fr, 9) < dens - 0.45 ? S(p.R, 0.68) : null), 1);
  },

  /** A feather drifting down, rocking as it falls. */
  shFeather(v, P, p) {
    if (v.lod && p.minor) return;
    let [x, y] = v.ap(p.x, p.y, p.z); x = Math.round(x); y = Math.round(y);
    const a = fadeOut(p.age / p.life, 0.7), tilt = Math.sin(p.age * p.rock + p.ph), dir = tilt > 0.35 ? 1 : tilt < -0.35 ? -1 : 0;
    // a shaft of three or four pixels, the vane on its upper side, a dark quill end
    for (let i = -2; i <= 2; i++) {
      const yy = y + Math.round(i * dir * 0.5);
      P.dot(x + i, yy, S(p.R, i === -2 ? 0.55 : 0.95), a, 1);
      if (i > -2 && i < 2) P.dot(x + i, yy - 1, S(p.R, 0.75), a, 1);
    }
  },

  /** A scrap of shed cocoon: a short bent strip, tumbling end over end, lit along one edge. */
  shScrap(v, P, p) {
    const [x, y] = v.ap(p.x, p.y, p.z), a = fadeOut(p.age / p.life, 0.7), q = p.seed * TAU + p.age * p.spinR * (p.z > 0.01 ? 1 : 0);
    const c = Math.cos(q), si = Math.sin(q), L = p.len ?? 2;
    for (let i = -L; i <= L; i++) {
      const bend = (i * i) / (L * 2), px = x + c * i - si * bend, py = y + si * i * 0.8 + c * bend;
      P.dot(px, py, S(p.R, Math.abs(i) === L ? 0.6 : c > 0 ? 0.95 : 0.78), a, 1);
    }
  },

  /** A speed line: a bright head and a long tail that breaks into dashes, trailing the way it flies. */
  shSpeed(v, P, p) {
    const u = clamp(p.age / p.life), [hx, hy] = v.ap(p.x, p.y, p.z), [tx, ty] = v.ap(p.x - p.ux * p.L, p.y - p.uy * p.L, p.z), a = fadeOut(u, 0.65);
    P.line(hx, hy, tx, ty, null, 1, a, (f, i) => (i < 2 ? S(p.R, 1) : f < 0.55 ? S(p.R, 0.85) : f < 0.82 ? ((i >> 1) % 2 ? null : S(p.R, 0.7)) : ((i >> 1) % 3 ? null : S(p.R, 0.55))));
  },

  /** Haste's afterimage: a body's outline in light with stripes running through it, thinning away. */
  shAfter(v, P, p) {
    const u = clamp(p.age / p.life), a = p.a * (1 - u); if (a < 0.08) return;
    const [bx, by] = v.ap(p.x, p.y, 0), fr = Math.floor(p.age * 24), G = v.aps, rim = S(p.R, 0.9), str = S(p.R, 0.72);
    if (v.kind === "top") {
      const r = 0.42 * p.size * G;
      P.shade(bx - r - 1, by - r - 1, bx + r + 1, by + r + 1, (x, y, ix, iy) => {
        const d = Math.hypot(x - bx, y - by); if (d > r) return null;
        if (d > r - 1.2) return { c: rim, a };
        return (iy + fr) % 3 === 0 ? { c: str, a: a * 0.8 } : null;
      }, 1);
      return;
    }
    const hh = p.h * G, hr = 0.13 * p.size * G, hy = by - hh * 0.86;
    P.shade(bx - 0.3 * G, hy - hr - 1, bx + 0.3 * G, by, (x, y, ix, iy) => {
      const up = (by - y) / hh, dx = Math.abs(x - bx), dh = Math.hypot(x - bx, y - hy);
      if (dh <= hr) return dh > hr - 1.2 ? { c: rim, a } : (iy + fr) % 3 === 0 ? { c: str, a: a * 0.8 } : null;
      if (up < 0.04 || up > 0.74) return null;
      const w = (up > 0.32 ? lerp(0.23, 0.17, (up - 0.32) / 0.42) : 0.12) * p.size * G;
      if (dx > w) return null;
      return dx > w - 1.2 ? { c: rim, a } : (iy + fr) % 3 === 0 ? { c: str, a: a * 0.8 } : null;
    }, 1);
  },

  /** A translucent puff of vapour: a soft disc, lit on its upper-left, swelling and thinning. */
  shVapour(v, P, p) {
    const u = clamp(p.age / p.life), [cx, cy] = v.ap(p.x, p.y, p.z), r = p.r * (0.7 + 0.6 * easeOut(u)), a = (p.a ?? 0.6) * Math.min(1, p.age / 0.08) * fadeOut(u, 0.4);
    if (r < 1 || a < 0.1) return;
    const lo = p.tone ?? 0.62;
    P.shade(cx - r, cy - r, cx + r, cy + r, (x, y) => {
      const dx = (x - cx) / r, dy = (y - cy) / r, d = dx * dx + dy * dy; if (d > 1) return null;
      return { c: S(p.R, -dx - dy > 0.55 ? lo + 0.22 : lo), a: d > 0.6 ? a * 0.6 : a };
    }, 0, "mix");
  },

  /** A buzzing mote of a swarm: a body pixel and a flickering wing. */
  shBug(v, P, p) {
    const [x, y] = v.ap(p.x, p.y, p.z), fr = Math.floor(p.age * 24), a = fadeOut(p.age / p.life, 0.8);
    P.dot(x, y, S(p.R, 0.42), a, 1);
    P.dot(x + (fr % 2 ? 1 : -1), y - 1, S(p.R, 0.92), a, 1);
  },
});

registerShapes({
  /** An expanding floor ring in a chosen step of the ramp, optionally broken. */
  shRing(v, P, p) {
    const u = clamp(q12(p.age) / p.life), fr = Math.floor(p.age * 12), [cx, cy] = v.ap(p.x, p.y, 0), from = p.from ?? 0, rx = p.r * v.aps * (from + (1 - from) * easeOut(u));
    if (rx < 1) return;
    const tone = p.tone ?? 0.85;
    for (let k = 0; k < (u < 0.5 ? 2 : 1); k++)
      P.ellipse(cx, cy, rx - k, Math.max(0.5, (rx - k) * v.sq), (q) => (p.broken && pnoise(q + fr * 0.15, 12, p.seed) < 0.3 ? null : { c: S(p.R, k ? tone - 0.25 : tone), a: 1 - u }), 1);
  },

  /** Haste's clock: a dial under the feet, its ticks lit as two hands sweep it faster and faster. */
  shClock(v, P, p) {
    const a = p.age, u = clamp(a / p.life), [cx, cy] = v.ap(p.x, p.y, 0), open = backOut(clamp(a / 0.2), 2);
    const out = clamp((u - 0.82) / 0.18), r = p.r * v.aps * open * (1 + 0.35 * out), ry = r * v.sq, al = 1 - out;
    if (r < 2 || al <= 0) return;
    const turn = (t) => p.q0 + p.spin * (p.w0 * t + 0.5 * p.acc * t * t);
    const th = turn(a), th2 = turn(a) / 12 * 3 + p.q0;
    const pt = (q, f) => [cx + Math.cos(q) * r * f, cy + Math.sin(q) * ry * f];
    P.ellipse(cx, cy, r, ry, () => ({ c: S(p.R, 0.8), a: al }), 1);
    P.ellipse(cx, cy, r * 0.72, ry * 0.72, (q) => ((Math.floor((q / TAU) * 48) & 1) ? { c: S(p.R, 0.55), a: al } : null), 0);
    // twelve ticks; the one the hand has just passed burns bright
    for (let i = 0; i < 12; i++) {
      const q = (i * TAU) / 12, d = (((p.spin * (th - q)) % TAU) + TAU) % TAU, lit = d < 0.9, long = i % 3 === 0;
      const [x0, y0] = pt(q, long ? 0.8 : 0.86), [x1, y1] = pt(q, long ? 1.1 : 0.98);
      P.line(x0, y0, x1, y1, S(p.R, lit ? 1 : long ? 0.8 : 0.6), 1, al);
    }
    // the sweep: the long hand, a smear of fading hands behind it, the short hand
    for (let k = 3; k >= 0; k--) {
      const q = th - p.spin * k * Math.min(0.5, 0.05 + p.w0 * 0.02 + p.acc * a * 0.03), [hx, hy] = pt(q, 0.92);
      P.line(cx, cy, hx, hy, S(p.R, k ? 0.85 - k * 0.12 : 1), k ? 0 : 1, k ? al * (0.8 - k * 0.18) : al);
    }
    const [mx, my] = pt(th2, 0.55);
    P.line(cx, cy, mx, my, S(p.R, 0.85), 1, al);
    P.ellipse(cx, cy, 1.5, Math.max(1, 1.5 * v.sq), () => ({ c: S(p.R, 1), a: al }), 1);
  },

  /** The shadow a lifting body leaves on the floor: a translucent ellipse sliding away and shrinking. */
  shShadow(v, P, p) {
    const [cx, cy] = v.ap(p.x + p.ox, p.y + p.oy, 0), r = p.r * v.aps, ry = r * v.sq * 0.78, a = p.a * fadeOut(clamp(p.age / p.life), 0.75);
    if (r < 1 || a < 0.05) return;
    P.shade(cx - r, cy - ry, cx + r, cy + ry, (x, y) => {
      const d = ((x - cx) / r) ** 2 + ((y - cy) / ry) ** 2; if (d > 1) return null;
      return { c: S(RAMP.smoke, 0), a: d < 0.5 ? a : a * 0.55 };
    }, 0, "mix");
  },

  /** Wind arcs thrown out along the floor from under a body, turning as they go. */
  shGust(v, P, p) {
    const u = clamp(p.age / p.life), [cx, cy] = v.ap(p.x, p.y, 0), r = p.r * v.aps * (0.3 + 0.7 * easeOut(u)), ry = r * v.sq;
    if (r < 2) return;
    const a = fadeOut(u, 0.5), rot = p.q0 + p.spin * easeOut(u) * 1.4, n = p.n, span = 0.45;
    P.ellipse(cx, cy, r, Math.max(1, ry), (q) => {
      const f = ((((q - rot) / TAU) * n) % 1 + 1) % 1;
      return f < span ? { c: S(p.R, f > span * 0.7 ? 1 : f > span * 0.3 ? 0.85 : 0.62), a } : null;
    }, 1);
  },

  /** The air a hovering body rides on: two counter-turning dashed rings under it, breathing with the bob. */
  shHover(v, P, p) {
    const u = clamp(p.age / p.life), [cx, cy] = v.ap(p.x, p.y, 0), a = Math.min(1, p.age / 0.25) * fadeOut(u, 0.75);
    const r = p.r * v.aps * (1 + 0.08 * Math.sin(p.age * p.bob)), ry = r * v.sq, n = Math.max(5, Math.round(r / 4)), turn = p.age * 2.2 * p.spin;
    if (r < 2 || a <= 0) return;
    P.ellipse(cx, cy, r, Math.max(1, ry), (q) => { const k = ((((q / TAU) * n + turn) % 1) + 1) % 1; return k < 0.4 ? { c: S(p.R, k < 0.12 ? 1 : 0.8), a } : null; }, 1);
    P.ellipse(cx, cy, r * 0.7, Math.max(1, ry * 0.7), (q) => { const k = ((((q / TAU) * n * 0.6 - turn * 1.4) % 1) + 1) % 1; return k < 0.3 ? { c: S(p.R, 0.62), a } : null; }, 0);
  },
}, { flat: ["shRing", "shClock", "shShadow", "shGust", "shHover"] });

/* ── helpers ─────────────────────────────────────────────────────────── */

const OUT = Object.freeze({ crit: 1.4, hit: 1, miss: 0.75, neutral: 0.92 });
const outcomeOf = (s, T) => T.outcome ?? s.spec.outcome ?? "neutral";
/** How grand an archetype plays on one body: rank (s.m) times the outcome. */
const grand = (s, T) => s.m * (OUT[outcomeOf(s, T)] ?? 1);
const hued = (s) => Number.isFinite(s.spec.look?.hue);
/** A material with no colour of its own (kinetic, neutral) borrows the archetype's own. */
const rampFor = (s, M, fallback) => (!hued(s) && (M.material === "kinetic" || M.material === "neutral") ? fallback : M.R);
/** The archetype's own colour: arcane's violet-blue, or the occult tradition's spirit. */
const ownRamp = (s, arcane) => (s.spec.tradition === "occult" ? RAMP.spirit : arcane);
const words = (s) => [String(s.spec.slug ?? ""), ...[...(s.spec.traits ?? [])].map(String)];
const named = (s, rx) => words(s).some((w) => rx.test(w));

/** Every body an archetype lands on: the targets, else the caster. */
const bodiesOf = (ctx) => (ctx.targets.length ? ctx.targets : ctx.caster ? [ctx.caster] : []);

/** A bright mote from the hand to a body before the archetype lands there, unless it is the caster's own. */
function reach(s, ctx, T, at, R) {
  const h = ctx.hand;
  if (ctx.self || !h || T === ctx.caster || Math.hypot(T.x - h[0], T.y - h[1]) < 0.6) return at;
  const dur = Math.min(0.45, 0.18 + Math.hypot(T.x - h[0], T.y - h[1]) * 0.03);
  s.at(at, (s2) => s2.add({
    k: "mote", x: h[0], y: h[1], z: h[2], life: dur, R, plus: true, glow: true,
    update(p, s3, dt) {
      const u = Math.min(1, p.age / dur);
      p.x = lerp(h[0], T.x, u); p.y = lerp(h[1], T.y, u); p.z = lerp(h[2], 0.7 * T.h, u) + Math.sin(Math.PI * u) * 0.4;
      for (let i = s3.count(40, dt); i > 0; i--) s3.add({ k: "mote", x: p.x, y: p.y, z: p.z, vz: s3.rand(-0.2, 0.3), drag: 2, life: s3.rand(0.25, 0.45), R, minor: true });
    },
  }));
  return at + dur;
}

/** Run `on(s2, T, i)` on every body when its reach arrives; returns the latest landing. */
function landOn(s, ctx, R, gap, on) {
  let end = ctx.t0;
  bodiesOf(ctx).forEach((T, i) => {
    const at = reach(s, ctx, T, ctx.t0 + i * gap, R);
    s.at(at, (s2) => on(s2, T, i));
    end = Math.max(end, at);
  });
  return end;
}

/** A ring of floor dust kicked out from a body's rim. */
function dust(s, T, n, sp, minorFrom = 3, R = RAMP.smoke, tone = 0.58) {
  const sz = T.size, sq = Math.sqrt(sz);
  for (let k = 0; k < n; k++) {
    const q = (k / n) * TAU + s.rand(-0.2, 0.2), c = Math.cos(q), si = Math.sin(q);
    s.add({ k: "smoke", x: T.x + c * 0.4 * sz, y: T.y + si * 0.4 * sz, z: 0.03, vx: c * sp * sz, vy: si * sp * sz, vz: 0.2, drag: 3.6, r: s.rand(2.4, 3.6) * sq, life: s.rand(0.45, 0.75), lobes: lobes(s), R, tone, minor: k >= minorFrom });
  }
}

/** Light streaming in from round a body to one point (its seam or its core). */
function gather(s, R, T, n, dur, rad, toZ = null) {
  for (let i = 0; i < n; i++) {
    const q = s.rand(0, TAU), d = s.rand(0.65, 1.2) * rad, life = s.rand(dur * 0.6, dur), px = T.x + Math.cos(q) * d, py = T.y + Math.sin(q) * d, pz = s.rand(0.05, 1.1) * T.h;
    const tz = toZ ?? s.rand(0.15, 0.95) * T.h;
    s.add({ k: "streak", x: px, y: py, z: pz, vx: (T.x - px) / life, vy: (T.y - py) / life, vz: (tz - pz) / life, life, R, wait: s.rand(0, dur - life), minor: i >= 10, update(p, _s, dt) { p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; } });
  }
}

/* ── polymorph ───────────────────────────────────────────────────────── */

const MIST = /(^|-)(mist|misty|gaseous|vapou?r|fog|smoke|cloud)(-|$)/;
const SWARM = /(^|-)(swarm|swarming|insects?|vermin|locusts?|bats|rats|ravens|crows)(-|$)/;
const SHADOW = /(^|-)(shadow|shadows|umbral|shade|shadowy)(-|$)/;

function variantOf(s, M) {
  const pick = (k, fallback) => ({ k, R: rampFor(s, M, fallback) });
  if (named(s, MIST)) return pick("mist", RAMP.air);
  if (named(s, SWARM)) return pick("swarm", RAMP.wood);
  if (named(s, SHADOW)) return pick("shadow", RAMP.shadow);
  return pick("cocoon", ownRamp(s, RAMP.arcane));
}

function polymorphOn(s, V, T, g, crit) {
  const R = V.R, sz = T.size, sg = Math.sqrt(g), h = T.h, t = s.t, x = T.x, y = T.y, aps = s.spec.aps, spin = s.R() < 0.5 ? 1 : -1;
  const WRAP = 0.55, SQZ = 0.3, BURST = WRAP + SQZ;
  // the wrap: ribbons (or vapour, bugs, tendrils) wind up the body, light pulled into it
  if (V.k !== "swarm") {
    s.add({ k: "shCocoon", x, y, size: sz, h, n: V.k === "shadow" ? 5 : V.k === "mist" ? 3 : 4, q0: s.rand(0, TAU), spin: 7 * spin, wrap: WRAP, life: BURST, R, update(p) {
      const k = clamp((p.age - WRAP) / SQZ);
      p.sq = 1 - 0.32 * easeInOut(k) + 0.06 * Math.sin(p.age * 40) * k; p.glow = k; p.spin = (7 + 14 * k) * spin; p.crack = p.age > BURST - 0.12;
    } });
  }
  if (V.k === "mist") {
    s.emit(t, t + BURST - 0.05, (s2, u, dt) => {
      for (let k = s2.count(60 * sg, dt); k > 0; k--) {
        const q0 = s2.rand(0, TAU), zf = s2.rand(0, 1), r0 = (0.6 - 0.22 * u) * sz;
        s2.add({ k: "shVapour", x, y, z: zf * h, r: s2.rand(3, 4.6) * Math.sqrt(sz), a: 0.5, life: s2.rand(0.3, 0.45), R, tone: 0.62 + 0.15 * u, minor: k > 1, update(p) {
          const q = q0 + p.age * 9 * spin, rr = r0 * (1 - 0.3 * p.age); p.x = x + Math.cos(q) * rr; p.y = y + Math.sin(q) * rr;
        } });
      }
    });
  }
  if (V.k === "swarm") {
    for (let i = 0; i < Math.round(56 * sg); i++) {
      const q0 = s.rand(0, TAU), zf = s.rand(0.05, 1.1), w = s.rand(6, 11) * spin, r0 = s.rand(0.7, 1.1) * sz;
      s.add({ k: "shBug", x, y, z: 0, life: BURST, R, wait: s.rand(0, 0.15), minor: i > 14, update(p) {
        const k = clamp(p.age / WRAP), rr = lerp(r0, 0.38 * sz, easeOut(k)) * (1 - 0.25 * clamp((p.age - WRAP) / SQZ)), q = q0 + p.age * w;
        p.x = x + Math.cos(q) * rr + (hash(i, Math.floor(p.age * 24)) - 0.5) * 0.06; p.y = y + Math.sin(q) * rr; p.z = zf * h * (0.4 + 0.6 * k);
      } });
    }
  }
  if (V.k === "shadow") {
    s.emit(t, t + BURST, (s2, _u, dt) => {
      for (let k = s2.count(30 * sg, dt); k > 0; k--) s2.add({ k: "shVapour", x: x + s2.rand(-0.45, 0.45) * sz, y: y + s2.rand(-0.35, 0.35) * sz, z: s2.rand(0, 0.9) * h, vz: s2.rand(0.4, 0.9), drag: 1.5, r: s2.rand(2.5, 3.8) * Math.sqrt(sz), a: 0.5, tone: 0.42, life: s2.rand(0.35, 0.6), R, minor: k > 1 });
    });
  }
  gather(s, R, T, Math.round(18 * sg), WRAP, 1.3 * sz * sg);
  s.light(x, y, 0.5 * h, 1.6 * sz * sg, S(R, 0.62), 0.5, BURST, { swell: true });
  // the squeeze: a tremble, a tight bright core
  s.at(t + WRAP, (s2) => {
    s2.add({ k: "shRing", x, y, r: 1.2 * sz * sg, from: 1, life: SQZ, R, tone: 0.7, broken: true, seed: sd(s2), update(p) { p.r = lerp(1.2, 0.5, easeIn(clamp(p.age / SQZ))) * sz * sg; } });
    s2.shake = Math.max(s2.shake, 0.5);
  });
  // the burst: a hero flash, scraps shed and tumbling, sparks, a wide ring, a pool of light
  s.at(t + BURST, (s2) => {
    s2.add({ k: "flash", x, y, z: 0.55 * h, life: (crit ? 2 : 1) / 12 + 1 / 12, r: 0.42 * sz * aps * sg, R, update: still });
    s2.add({ k: "star", x, y, z: 0.6 * h, L: 7 * sg, life: 3 / 12, R, update: still });
    s2.add({ k: "shRing", x, y, r: 2 * sz * sg, life: 0.55, R, seed: sd(s2), update: still });
    s2.add({ k: "shRing", x, y, r: 1.3 * sz * sg, life: 0.38, R, tone: 1, update: still });
    s2.light(x, y, 0.5 * h, 3 * sz * sg, S(R, 0.62), 0.7, 0.6);
    s2.light(x, y, 0.5 * h, 0.9 * sz, S(R, 0.85), 0.55, 0.12);
    s2.shake = Math.max(s2.shake, 1.2 + (crit ? 1 : 0));
    const nS = Math.round(26 * g);
    for (let i = 0; i < nS; i++) {
      const q = s2.rand(0, TAU), sp = s2.rand(1.6, 4.2) * Math.sqrt(sz) * sg;
      const scrap = V.k === "swarm" ? { k: "shBug" } : V.k === "mist" ? null : { k: "shScrap", seed: s2.R(), spinR: s2.rand(10, 18) };
      if (scrap) s2.add({ ...scrap, x, y, z: s2.rand(0.2, 1) * h, vx: Math.cos(q) * sp, vy: Math.sin(q) * sp, vz: s2.rand(0.8, 3), g: 9, drag: 1.4, bounce: 0.35, life: s2.rand(0.7, 1.3), R, minor: i > 12 });
    }
    for (let i = Math.round(36 * g); i > 0; i--) {
      const q = s2.rand(0, TAU), sp = s2.rand(3, 9) * sg;
      s2.add({ k: "spark", x, y, z: 0.55 * h, vx: Math.cos(q) * sp, vy: Math.sin(q) * sp, vz: s2.rand(-1, 3), g: 12, drag: 2.5, life: s2.rand(0.25, 0.5), R, minor: i > 14 });
    }
    if (V.k === "mist") for (let i = 0; i < 16; i++) {
      const q = (i / 16) * TAU + s2.rand(-0.15, 0.15), sp = s2.rand(2.2, 3.6) * sz * sg;
      s2.add({ k: "shVapour", x, y, z: s2.rand(0.1, 0.7) * h, vx: Math.cos(q) * sp, vy: Math.sin(q) * sp, vz: 0.2, drag: 1.6, r: s2.rand(4, 6) * Math.sqrt(sz), a: 0.55, life: s2.rand(1.1, 1.8), R, tone: 0.7, minor: i > 7 });
    }
    if (V.k === "shadow") for (let i = 0; i < 18; i++) {
      const q = s2.rand(0, TAU), sp = s2.rand(1, 2.2) * sz;
      s2.add({ k: "shVapour", x, y, z: s2.rand(0.2, 1) * h, vx: Math.cos(q) * sp * 1.6, vy: Math.sin(q) * sp * 1.6, vz: s2.rand(0.3, 1.2), drag: 2, r: s2.rand(3, 5) * Math.sqrt(sz), a: 0.55, tone: 0.45, life: s2.rand(0.8, 1.3), R, minor: i > 8 });
    }
    // the new form pops: the token squashes and flashes, a ring snaps out round it, corner sparkles
    s2.hit(T.id, 0.9 * sg, { x, y }, R);
    s2.add({ k: "shRing", x, y, r: 0.78 * sz, from: 0.35, life: 0.32, R, tone: 1, wait: 0.06, update(p) { p.r = 0.78 * sz * backOut(clamp(p.age / 0.2), 3); } });
    for (let i = 0; i < 4; i++) {
      const q = TAU / 8 + (i * TAU) / 4;
      s2.add({ k: "glint", x: x + Math.cos(q) * 0.55 * sz, y: y + Math.sin(q) * 0.55 * sz, z: (i < 2 ? 0.95 : 0.3) * h, life: 5 / 12, R, big: i === 0, wait: 0.1 + i * 0.05, update: still });
    }
  });
  // follow-through: motes swirl off the new form, scraps settle
  s.emit(t + BURST + 0.1, t + BURST + 1.5, (s2, u, dt) => {
    for (let k = s2.count(16 * g * (1 - u), dt); k > 0; k--) {
      const q = s2.rand(0, TAU), d = s2.rand(0.3, 0.6) * sz;
      s2.add({ k: V.k === "swarm" ? "shBug" : "mote", x: x + Math.cos(q) * d, y: y + Math.sin(q) * d, z: s2.rand(0.1, 0.9) * h, vx: -Math.sin(q) * 0.5 * spin, vy: Math.cos(q) * 0.5 * spin, vz: s2.rand(0.3, 0.8), drag: 1.2, life: s2.rand(0.6, 1), R, plus: s2.R() < 0.25, minor: k > 1 });
    }
  });
  s.at(t + BURST + 0.6, (s2) => s2.light(x, y, 0.3, 1.5 * sz * sg, S(R, 0.62), 0.45, 1.1));
  return t + BURST;
}

function polymorph(s, M, ctx) {
  const V = variantOf(s, M);
  const end = landOn(s, ctx, V.R, 0.08, (s2, T) => polymorphOn(s2, V, T, grand(s2, T), outcomeOf(s2, T) === "crit"));
  s.phases.push(`polymorph: a ${V.k} wraps, squeezes and bursts; the new form pops`);
  s.period = end + 0.85 + 2;
}

/* ── teleport ────────────────────────────────────────────────────────── */

/** The fold out: crackle, flash, pressed into a seam, pinched to a point, popped. Returns the pop. */
function foldOut(s, R, T, t, g) {
  const sz = T.size, sg = Math.sqrt(g), h = T.h, x = T.x, y = T.y, aps = s.spec.aps, OUTT = 0.3;
  s.at(t, (s2) => {
    s2.add({ k: "shOutline", x, y, size: sz, h, life: OUTT, R, update: still });
    gather(s2, R, T, Math.round(22 * sg), OUTT, 1.4 * sz * sg);
    s2.light(x, y, 0.5 * h, 1.8 * sz * sg, S(R, 0.62), 0.7, OUTT, { swell: true });
  });
  s.at(t + OUTT, (s2) => {
    s2.add({ k: "shSeam", x, y, size: sz, h, w: 0.42 * sz * aps, out: true, life: 0.3, R, update: still });
    s2.light(x, y, 0.5 * h, 2.2 * sz * sg, S(R, 0.62), 0.9, 0.3);
    s2.light(x, y, 0.5 * h, 0.8 * sz, S(R, 0.85), 0.8, 0.1);
    // pixels sucked sideways into the seam from both sides
    for (let i = 0; i < Math.round(28 * sg); i++) {
      const side = i % 2 ? 1 : -1, d = s2.rand(0.35, 0.95) * sz * sg, life = s2.rand(0.1, 0.2), px = x + side * d, pz = s2.rand(0.05, 1) * h, py = y + s2.rand(-0.35, 0.35) * sz;
      s2.add({ k: "streak", x: px, y: py, z: pz, vx: (x - px) / life, vy: (y - py) / life * 0.6, vz: 0, life, R, wait: s2.rand(0, 0.12), minor: i >= 12, update(p, _s, dt) { p.x += p.vx * dt; p.y += p.vy * dt; } });
    }
  });
  const pop = t + OUTT + 0.29;
  s.at(pop, (s2) => {
    // the pop: the seam bursts into sparks and bits of light thrown sideways, stars, a ring
    s2.add({ k: "star", x, y, z: 0.5 * h, L: 6 * sg, life: 3 / 12, R, update: still });
    s2.add({ k: "shRing", x, y, r: 1.5 * sz * sg, life: 0.5, R, seed: sd(s2), update: still });
    s2.add({ k: "fmGhost", x, y, size: sz, h, a: 0.55, life: 0.6, R, update: still });
    for (let i = Math.round(40 * g); i > 0; i--) {
      const side = i % 2 ? 1 : -1;
      s2.add({ k: "mote", x: x + s2.rand(-0.04, 0.04), y: y + s2.rand(-0.2, 0.2) * sz, z: s2.rand(0.05, 1) * h, vx: side * s2.rand(1, 4) * sz * sg, vy: s2.rand(-0.6, 0.6), vz: s2.rand(-0.4, 2), g: 1.5, drag: 2.6, life: s2.rand(0.45, 0.85), R, plus: i % 6 === 0, minor: i > 14 });
    }
    for (let i = Math.round(18 * g); i > 0; i--) {
      const q = s2.rand(0, TAU), sp = s2.rand(3, 9) * sg;
      s2.add({ k: "spark", x, y, z: 0.5 * h, vx: Math.cos(q) * sp, vy: Math.sin(q) * sp, vz: s2.rand(-1, 3), g: 12, drag: 2.5, life: s2.rand(0.2, 0.45), R, minor: i > 8 });
    }
    for (let i = 0; i < 4; i++) s2.add({ k: "glint", x: x + s2.rand(-0.5, 0.5) * sz, y: y + s2.rand(-0.4, 0.4) * sz, z: s2.rand(0.3, 1.1) * h, life: 5 / 12, R, wait: 0.05 + i * 0.06, minor: i > 1, update: still });
    s2.light(x, y, 0.5 * h, 2.6 * sz * sg, S(R, 0.62), 0.9, 0.45);
  });
  return pop;
}

/** The fold in: a point, a line, the seam split open throwing light out, shut with a landing ring. */
function foldIn(s, R, T, t, g) {
  const sz = T.size, sg = Math.sqrt(g), h = T.h, x = T.x, y = T.y, aps = s.spec.aps;
  s.at(t, (s2) => {
    s2.add({ k: "shSeam", x, y, size: sz, h, w: 0.46 * sz * aps, out: false, life: 0.4, R, update: still });
    s2.light(x, y, 0.5 * h, 2 * sz * sg, S(R, 0.62), 0.8, 0.4, { swell: true });
  });
  s.at(t + 0.1, (s2) => {
    // the seam splits and throws its light out sideways
    for (let i = Math.round(44 * g); i > 0; i--) {
      const side = i % 2 ? 1 : -1;
      s2.add({ k: i % 3 ? "mote" : "streak", x: x + side * 0.05, y: y + s2.rand(-0.25, 0.25) * sz, z: s2.rand(0.05, 1) * h, vx: side * s2.rand(2, 6) * sz * sg, vy: s2.rand(-0.5, 0.5), vz: s2.rand(-0.3, 1), drag: 3.4, life: s2.rand(0.3, 0.6), R, plus: i % 7 === 0, wait: s2.rand(0, 0.12), minor: i > 16, update: i % 3 ? undefined : (p, _s, dt) => { p.vx *= Math.exp(-3.4 * dt); p.x += p.vx * dt; p.y += p.vy * dt; } });
    }
    s2.light(x, y, 0.5 * h, 2.4 * sz * sg, S(R, 0.62), 0.9, 0.35);
  });
  const land = t + 0.36;
  s.at(land, (s2) => {
    // the landing: the seam shuts in a flash, a ring snaps out, dust puffs off the floor
    s2.add({ k: "flash", x, y, z: 0.5 * h, life: 1 / 12, r: 0.3 * sz * aps, R, update: still });
    s2.add({ k: "shRing", x, y, r: 1.7 * sz * sg, life: 0.55, R, seed: sd(s2), update: still });
    s2.add({ k: "shRing", x, y, r: 1.05 * sz * sg, life: 0.4, R, tone: 1, update: still });
    dust(s2, T, 10, 1.8, 5);
    for (let i = 0; i < 12; i++) {
      const q = (i / 12) * TAU, sp = s2.rand(1, 2) * sz;
      s2.add({ k: "mote", x, y, z: 0.05, vx: Math.cos(q) * sp, vy: Math.sin(q) * sp, vz: s2.rand(0.3, 1.2), drag: 2.6, life: s2.rand(0.5, 0.85), R, plus: i % 3 === 0, minor: i % 2 === 1 });
    }
    s2.light(x, y, 0.2, 2.6 * sz * sg, S(R, 0.62), 0.75, 0.6);
    s2.shake = Math.max(s2.shake, 0.6);
  });
  // afterglow: a few motes and glints settle where it landed
  s.emit(land + 0.1, land + 1.1, (s2, u, dt) => {
    for (let k = s2.count(10 * g * (1 - u), dt); k > 0; k--) s2.add({ k: "mote", x: x + s2.rand(-0.5, 0.5) * sz, y: y + s2.rand(-0.5, 0.5) * sz, z: s2.rand(0.1, 1) * h, vz: s2.rand(-0.3, 0.2), drag: 1, life: s2.rand(0.6, 1), R, plus: s2.R() < 0.2, minor: true });
  });
  return land;
}

function teleport(s, M, ctx) {
  const R = rampFor(s, M, ownRamp(s, RAMP.arcane));
  const src = ctx.caster ?? ctx.targets[0];
  if (!src) { s.period = 1; return; }
  const g = grand(s, src);
  // where it lands: the area's point, or another creature it steps to; else the same spot a moment later
  const cand = ctx.area ? { x: ctx.area.x, y: ctx.area.y, size: src.size ?? 1, h: src.h ?? 1, id: null } : ctx.targets.find((T) => T !== src) ?? null;
  const dst = cand ?? src;
  const pop = foldOut(s, R, src, ctx.t0, g);
  if (cand && ctx.hand) {
    // a thread of light along the fold, from where it left to where it opens
    s.at(pop, (s2) => {
      const n = Math.max(4, Math.round(Math.hypot(dst.x - src.x, dst.y - src.y) * 1.6));
      for (let i = 0; i < n; i++) {
        const f = i / n;
        s2.add({ k: i % 2 ? "mote" : "glint", x: lerp(src.x, dst.x, f), y: lerp(src.y, dst.y, f), z: 0.5 * src.h + Math.sin(Math.PI * f) * 0.6, life: i % 2 ? 0.3 : 5 / 12, R, plus: true, wait: f * 0.16, minor: i % 2 === 1, update: still });
      }
    });
  }
  const land = foldIn(s, R, dst, pop + (cand ? 0.16 : 0.32), g);
  s.phases.push(cand ? "teleport: fold out into a seam, open at the destination, land" : "teleport: fold out, fold back in place");
  s.period = land + 1.6;
}

/* ── haste ───────────────────────────────────────────────────────────── */

function hasteOn(s, R, T, g, crit, dir) {
  const sz = T.size, sg = Math.sqrt(g), h = T.h, t = s.t, x = T.x, y = T.y, aps = s.spec.aps, [dx, dy] = dir, spin = dx >= 0 ? 1 : -1, LIFE = 1.9;
  const pulse = (s2, k) => {
    // the lightning-quick pulse: a crackle through the body and a snapped ring
    if (!k || crit) s2.add({ k: "flash", x, y, z: 0.55 * h, life: (k ? 2 : 1) / 12, r: 0.2 * sz * aps * sg, R, update: still });
    s2.add({ k: "star", x, y, z: 0.55 * h, L: 5 * sg, life: 3 / 12, R, update: still });
    for (let i = 0; i < 3; i++) {
      const q = s2.rand(0, TAU), L = s2.rand(0.45, 0.8) * sz * sg;
      s2.add({ k: "bolt", x, y, a: [x, y, 0.55 * h], b: [x + Math.cos(q) * L, y + Math.sin(q) * L, s2.rand(0.1, 1.1) * h], seed: sd(s2), life: 0.16, R, minor: i > 1, update: still });
    }
    s2.add({ k: "shRing", x, y, r: (k ? 1.9 : 1.4) * sz * sg, life: 0.32, R, tone: 1, update: still });
    s2.light(x, y, 0.5 * h, 2.2 * sz * sg, S(R, 0.62), 0.6, 0.25);
  };
  s.at(t, (s2) => pulse(s2, 0));
  // the clock under the feet, its hands accelerating
  s.add({ k: "shClock", x, y, r: 0.85 * sz * sg, q0: -Math.PI / 2, spin, w0: 4, acc: 22, life: LIFE, R, wait: 0.04, update: still });
  s.light(x, y, 0.1, 1.5 * sz * sg, S(R, 0.62), 0.45, LIFE);
  // speed lines streaming off behind, afterimages zipping, sparks off the heels
  s.emit(t + 0.06, t + LIFE - 0.25, (s2, u, dt) => {
    const k0 = 0.6 + 0.4 * u;
    for (let k = s2.count(70 * g * k0, dt); k > 0; k--) {
      const off = s2.rand(-0.5, 0.5) * sz, sp = s2.rand(10, 17) * Math.sqrt(sz), z = s2.rand(0.1, 1.05) * h;
      s2.add({ k: "shSpeed", x: x + dx * 0.45 * sz - dy * off, y: y + dy * 0.45 * sz + dx * off, z, ux: -dx, uy: -dy, L: s2.rand(0.55, 1.3) * Math.sqrt(sz), vx: -dx * sp, vy: -dy * sp, life: s2.rand(0.1, 0.18), R, minor: k > 2, update(p, _s, dt2) { p.x += p.vx * dt2; p.y += p.vy * dt2; } });
    }
    for (let k = s2.count(10 * g, dt); k > 0; k--) {
      const side = s2.R() < 0.5 ? 1 : -1;
      s2.add({ k: "spark", x: x - dx * 0.25 * sz - dy * side * 0.2 * sz, y: y - dy * 0.25 * sz + dx * side * 0.2 * sz, z: 0.03, vx: -dx * s2.rand(2, 5) + s2.rand(-1, 1), vy: -dy * s2.rand(2, 5) + s2.rand(-1, 1), vz: s2.rand(0.5, 2.5), g: 12, drag: 2, life: s2.rand(0.18, 0.32), R, minor: true });
    }
    if (s2.count(3.5 * g, dt) > 0) s2.add({ k: "smoke", x: x - dx * 0.3 * sz, y: y - dy * 0.3 * sz, z: 0.04, vx: -dx * s2.rand(1, 2), vy: -dy * s2.rand(1, 2), vz: 0.15, drag: 3, r: s2.rand(2, 3) * Math.sqrt(sz), life: 0.5, lobes: lobes(s2), R: RAMP.smoke, tone: 0.58, minor: true });
  });
  for (let i = 0; i < 6; i++) {
    const at = t + 0.12 + i * 0.22, jit = (i % 2 ? 1 : -1) * 0.12 * sz;
    s.at(at, (s2) => {
      for (let j = 0; j < 3; j++) s2.add({ k: "shAfter", x: x - dx * 0.32 * (j + 1) * sz - dy * jit, y: y - dy * 0.32 * (j + 1) * sz + dx * jit, size: sz, h, a: 1 - j * 0.25, life: 0.26, R, wait: j * 0.02, minor: j > 1, update(p, _s, dt) { p.x -= dx * 1.2 * dt; p.y -= dy * 1.2 * dt; } });
    });
  }
  // a heartbeat of quick flares as the clock winds up, then the last pulse as it flares out
  for (let i = 1; i <= 4; i++) s.at(t + i * 0.32, (s2) => s2.light(x, y, 0.4 * h, 1.4 * sz * sg, S(R, 0.75), 0.55, 0.12));
  s.at(t + LIFE - 0.3, (s2) => {
    pulse(s2, 1);
    for (let i = 0; i < 12; i++) {
      const q = (i / 12) * TAU, sp = s2.rand(1.4, 2.4) * sz * sg;
      s2.add({ k: "mote", x, y, z: 0.5 * h, vx: Math.cos(q) * sp, vy: Math.sin(q) * sp, vz: s2.rand(0, 0.8), drag: 3, life: s2.rand(0.4, 0.7), R, plus: i % 3 === 0, minor: i % 2 === 1 });
    }
    s2.add({ k: "glint", x, y, z: 1.15 * h, life: 5 / 12, R, big: true, update: still });
  });
}

function haste(s, M, ctx) {
  const R = rampFor(s, M, s.spec.tradition === "occult" ? RAMP.spirit : RAMP.holy);
  const end = landOn(s, ctx, R, 0.07, (s2, T, i) => {
    // it faces where it was sent (from the caster), else the way the table reads: right
    const d = ctx.caster && T !== ctx.caster ? [T.x - ctx.caster.x, T.y - ctx.caster.y] : [1, 0], L = Math.hypot(d[0], d[1]) || 1;
    hasteOn(s2, R, T, grand(s2, T), outcomeOf(s2, T) === "crit", [d[0] / L, d[1] / L], i);
  });
  s.phases.push("haste: a pulse, a quickening clock, speed lines and afterimages");
  s.period = end + 2.2;
}

/* ── fly ─────────────────────────────────────────────────────────────── */

const LEVITATE = /(^|-)(levitate|levitation|feather|float|floating|hover|hovering)(-|$)/;
const FEATHERY = new Set(["air", "kinetic", "neutral", "holy", "light", "vitality", "spirit"]);

function flyOn(s, R, F, T, g, soft) {
  const sz = T.size, sg = Math.sqrt(g), h = T.h, t = s.t, x = T.x, y = T.y, spin = s.R() < 0.5 ? 1 : -1;
  const LIFT = soft ? 1.1 : 0.55, HOLD = soft ? 2.4 : 2.1, hgt = soft ? 0.35 : 0.7;
  // the shadow on the floor: it slides away down-right and shrinks as the body rises, bobbing while it hovers
  s.add({ k: "shShadow", x, y, ox: 0, oy: 0, r: 0.44 * sz, a: soft ? 0.5 : 0.62, life: LIFT + HOLD, update(p) {
    const f = easeInOut(clamp(p.age / LIFT)), bob = Math.sin(Math.max(0, p.age - LIFT) * (soft ? 2.6 : 3.6)) * 0.12 * f, lift = hgt * (f + bob);
    p.ox = 0.45 * lift * sz; p.oy = 0.62 * lift * sz; p.r = 0.44 * sz * (1 - 0.3 * lift); p.a = (soft ? 0.5 : 0.62) * (1 - 0.35 * lift);
  } });
  // the gust: wind arcs thrown out along the floor, a downdraft ring of dust (levitate: a breath of it)
  s.add({ k: "shGust", x, y, r: (soft ? 1.3 : 2) * sz * sg, n: soft ? 3 : 5, q0: s.rand(0, TAU), spin, life: soft ? 0.9 : 0.65, R, update: still });
  s.add({ k: "shGust", x, y, r: (soft ? 0.95 : 1.4) * sz * sg, n: soft ? 2 : 4, q0: s.rand(0, TAU), spin: -spin, life: soft ? 0.8 : 0.5, R, wait: 0.05, minor: true, update: still });
  if (!soft) {
    s.add({ k: "shRing", x, y, r: 1.7 * sz * sg, life: 0.5, R, broken: true, seed: sd(s), update: still });
    dust(s, T, 12, 2.6, 6, RAMP.smoke, 0.75);
    s.shake = Math.max(s.shake, 0.5);
  } else s.add({ k: "shRing", x, y, r: 1.1 * sz * sg, life: 0.7, R, tone: 0.7, broken: true, seed: sd(s), update: still });
  s.light(x, y, 0.2, 1.8 * sz * sg, S(R, 0.62), soft ? 0.4 : 0.6, 0.5);
  // the lift: hoops of wind climbing the body, streaks of air rising past it
  for (let k = 0; k < (soft ? 2 : 3); k++) s.add({ k: "halo", x, y, z: 0, r: 0.5 * sz, life: LIFT * 0.9, R, wait: k * (soft ? 0.35 : 0.14), minor: k > 1, update(p) {
    const f = easeOut(clamp(p.age / p.life)); p.z = f * 1.2 * h; p.r = lerp(0.55, 0.35, f) * sz;
  } });
  s.emit(t, t + LIFT + 0.3, (s2, u, dt) => {
    for (let k = s2.count((soft ? 14 : 34) * g * (1 - u * 0.6), dt); k > 0; k--) {
      const q = s2.rand(0, TAU), d = s2.rand(0.35, 0.6) * sz;
      s2.add({ k: "streak", x: x + Math.cos(q) * d, y: y + Math.sin(q) * d, z: s2.rand(0, 0.4) * h, vz: s2.rand(3.5, 6) * (soft ? 0.6 : 1), life: s2.rand(0.14, 0.24), R, minor: k > 1, update(p, _s, dt2) { p.z += p.vz * dt2; } });
    }
  });
  // feathers (or motes of the material) shed as it rises, drifting down and rocking
  const nF = Math.round((soft ? 5 : 12) * g);
  for (let i = 0; i < nF; i++) {
    const q = s.rand(0, TAU), d = s.rand(0.2, 0.7) * sz, z0 = s.rand(0.7, 1.4) * h, fx = x + Math.cos(q) * d, fy = y + Math.sin(q) * d, sw = s.rand(0.25, 0.5) * sz, ph = s.rand(0, TAU);
    const base = { x: fx, y: fy, z: z0, life: s.rand(1.6, 2.4), R: F.R, wait: s.rand(0.1, LIFT + 0.8), minor: i > 5 };
    if (F.feather) s.add({ k: "shFeather", ...base, rock: s.rand(4, 6), ph, update(p, _s, dt) {
      p.z = Math.max(0.02, p.z - dt * 0.42); p.x = fx + Math.sin(p.age * 2.4 + ph) * sw; p.y = fy + Math.sin(p.age * 1.3 + ph) * sw * 0.3 + p.age * 0.05;
    } });
    else s.add({ k: "mote", ...base, plus: i % 3 === 0, update(p, _s, dt) { p.z = Math.max(0.02, p.z - dt * 0.35); p.x = fx + Math.sin(p.age * 2.4 + ph) * sw; } });
  }
  // aloft: the air it rides on turning under it, a soft light, the downdraft still puffing
  s.add({ k: "shHover", x, y, r: 0.72 * sz * sg, spin, bob: soft ? 2.6 : 3.6, life: HOLD + 0.2, R, wait: LIFT * 0.6, update: still });
  for (let i = 1; i <= (soft ? 2 : 4); i++) s.at(t + LIFT + i * (soft ? 0.8 : 0.45), (s2) => s2.add({ k: "shGust", x, y, r: (soft ? 0.9 : 1.15) * sz * sg, n: 3, q0: s2.rand(0, TAU), spin, life: 0.5, R, minor: i > 2, update: still }));
  s.at(t + LIFT, (s2) => {
    s2.add({ k: "glint", x, y, z: 1.2 * h, life: 5 / 12, R, big: !soft, update: still });
    s2.light(x, y, 0.5 * h, 1.4 * sz * sg, S(R, 0.62), 0.45, HOLD);
  });
  s.emit(t + LIFT, t + LIFT + HOLD - 0.3, (s2, _u, dt) => {
    for (let k = s2.count((soft ? 6 : 10) * g, dt); k > 0; k--) {
      const q0 = s2.rand(0, TAU), rr = s2.rand(0.45, 0.65) * sz, z = s2.rand(0.02, 0.25) * h;
      s2.add({ k: "mote", x, y, z, life: s2.rand(0.5, 0.8), R, minor: k > 1 || s2.R() < 0.5, update(p) { const q = q0 + p.age * 5 * spin; p.x = x + Math.cos(q) * rr; p.y = y + Math.sin(q) * rr; } });
    }
  });
}

function fly(s, M, ctx) {
  const R = rampFor(s, M, RAMP.air), soft = named(s, LEVITATE);
  const feather = !hued(s) && FEATHERY.has(M.material);
  const F = { feather, R: feather ? (M.material === "holy" || M.material === "light" || M.material === "vitality" ? M.R : RAMP.linen) : R };
  const end = landOn(s, ctx, R, 0.08, (s2, T) => flyOn(s2, R, F, T, grand(s2, T), soft));
  s.phases.push(soft ? "levitate: a breath of wind, a gentle lift, a few feathers" : "fly: a downdraft, the shadow left below, feathers drifting");
  s.period = end + (soft ? 3.6 : 2.8);
}

export default { polymorph, teleport, haste, fly };
