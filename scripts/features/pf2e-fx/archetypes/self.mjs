/**
 * Spellsprite archetypes — the self: rage, stance, the vital rise, drinking, light and fortune.
 * docs/SPELLSPRITE_ARCHETYPES.md says what each covers; the spellsprite-craft skill says how good it must be.
 *
 * Each drawer is (s, M, ctx) like a FORMS entry: ctx = { caster, targets, area, hand, t0, release, linger, fire, self }.
 * compile.mjs `buildForm` has already drawn the wind-up before `t0` and, for an area, its footprint and wave.
 *
 *   rise     the restore archetype (Heal, Stabilize, Soothe, every potion's healing): a bloom of
 *            petals opens on the floor, a column of warm light and a fountain of motes rise from it,
 *            a hoop climbs the body, green-gold crosses pop and float off. Gentle, warm, upward;
 *            never a holy glare. Grows with rank and with the creature.
 *   drink    a flask raised to the mouth, tipped, three gulps, the brew's colour flashing through
 *            the body, the flask spun away; then the potion's real effect (rise for a healing one).
 *   rage     a red surge erupts from the body: flame tongues, veins of light, a roar's shockwave,
 *            the floor cracking hot; then a heartbeat (lub-dub) of flares, an anger mark, steam and
 *            heat shimmer. The instinct's element recolours it; the default is a fiery red.
 *   stance   lines pulled in, a sigil stamped under the feet with a pose flash and a kiai, then an
 *            aura ring that turns at the body's rim while motes rise off it.
 *   light    sparks drawn in, an orb of light ignites beside the head and hangs there, bobbing,
 *            in a big soft pool of light, slow motes drifting through it.
 *   fortune  two strands of luck spiral up the body, a four-point star pops over the head with a
 *            soft halo, twinkles linger.
 */

import { TAU, clamp, lerp, easeOut, hash, fadeOut, rng, q12, pnoise } from "../core/rand.mjs";
import { RAMP, S } from "../core/palette.mjs";
import { registerShapes } from "../core/shapes.mjs";
import { still, sd, lobes } from "../core/motifs.mjs";
import { ICONS } from "../conditions.mjs";
import { areaGeom, areaPoints } from "../area.mjs";
import { FORMS } from "../forms.mjs";

const easeInOut = (u) => u * u * (3 - 2 * u);
const backOut = (u, k = 1.7) => 1 + (k + 1) * (u - 1) ** 3 + k * (u - 1) ** 2;

/* ── shapes only the self archetypes draw ─────────────────────────────── */

registerShapes({
  /** A hoop of light at a height: a ring round the body, its near half bright. */
  seHoop(v, P, p) {
    const u = clamp(p.age / p.life), [cx, cy] = v.ap(p.x, p.y, p.z), rx = p.r * v.aps, ry = Math.max(1, rx * (v.kind === "top" ? 1 : v.sq));
    if (rx < 1) return;
    const a = fadeOut(u, 0.7);
    P.ellipse(cx, cy, rx, ry, (q) => ({ c: S(p.R, Math.sin(q) > 0.3 ? 1 : Math.sin(q) > -0.3 ? 0.92 : 0.72), a }), 1);
    P.ellipse(cx, cy + 1, Math.max(1, rx - 0.5), ry, (q) => (Math.sin(q) > 0 ? { c: S(p.R, 0.72), a } : null), 1);
  },

  /** A translucent column of light standing on the floor, bands of light climbing it. */
  seColumn(v, P, p) {
    const u = clamp(p.age / p.life), [bx, by] = v.ap(p.x, p.y, 0), [, ty] = v.ap(p.x, p.y, p.h);
    const grow = easeOut(clamp(p.age / 0.3)), out = clamp((u - 0.55) / 0.45), fade = 1 - out;
    const w = p.w * (0.6 + 0.4 * grow) * (1 - 0.35 * out), H = (by - ty) * grow;
    if (H < 2 || fade <= 0 || w < 1) return;
    const climb = Math.floor(p.age * 36);
    P.shade(bx - w - 1, by - H, bx + w + 1, by, (x, y, ix, iy) => {
      // tapered: full width at the floor, narrowing as it rises; a grain of light climbing it
      const f = (by - y) / H, ww = w * (1 - 0.45 * f), e = Math.abs(x - bx) / ww; if (e > 1) return null;
      const k = fade * (f > 0.6 ? (1 - f) / 0.4 : 1);
      if (k <= 0.06) return null;
      // lines and light, not a fill: two edges, a bright thread up the middle, a grain climbing
      if (hash(ix, (iy + climb) >> 1, 11) > 0.92) return { c: S(p.R, 0.88), a: k };
      if (e > 0.8) return f < 0.75 ? { c: S(p.R, 0.72), a: 0.75 * k } : null;
      if (Math.abs(x - bx) < 0.6) return { c: S(p.R, 0.85), a: 0.5 * k };
      return null;
    }, 0, "mix");
  },

  /** A body flushing one colour for two frames: a rim and a wash over the whole figure. */
  seTint(v, P, p) {
    const fr = Math.floor(p.age * 12); if (fr > 2) return;
    const [cx, cy] = v.ap(p.x, p.y, p.z), r = p.r * v.aps * (1 + fr * 0.12), ry = v.kind === "top" ? r : Math.max(r, p.h * v.aps * 0.55);
    P.shade(cx - r - 1, cy - ry - 1, cx + r + 1, cy + ry + 1, (x, y) => {
      const d = Math.hypot((x - cx) / r, (y - cy) / ry); if (d > 1) return null;
      return d > 0.82 ? { c: S(p.R, 0.75), a: fr === 2 ? 0.5 : 1 } : fr ? null : { c: S(p.R, 0.62), a: 0.25 };
    }, 0, "mix");
  },

  /** Veins of light cracking out of a body: jagged branching runs from its core, flickering. */
  seVeins(v, P, p) {
    const u = clamp(p.age / p.life); if (u >= 1) return;
    const fr = Math.floor(p.age * 12), r = rng(p.seed * 17 + (fr >> 1)), [cx, cy] = v.ap(p.x, p.y, p.z), a = fadeOut(u, 0.5);
    const L = p.L * (0.55 + 0.45 * easeOut(clamp(p.age / 0.1))), sy = v.kind === "top" ? 1 : 1.25;
    for (let b = 0; b < p.n; b++) {
      let q = (b / p.n) * TAU + r() * 0.5, x = cx, y = cy;
      const len = L * (0.6 + 0.4 * r());
      for (let d = 0; d < len; d += 2) {
        q += (r() - 0.5) * 0.9;
        const nx = x + Math.cos(q) * 2, ny = y + Math.sin(q) * 2 * sy, f = d / len;
        P.line(x, y, nx, ny, S(p.R, f < 0.35 ? 1 : 0.9 - f * 0.3), 1, a);
        x = nx; y = ny;
        if (r() < 0.14) { const q2 = q + (r() < 0.5 ? -1 : 1); P.line(x, y, x + Math.cos(q2) * 4, y + Math.sin(q2) * 4 * sy, S(p.R, 0.72), 1, a); }
      }
    }
  },

  /** A short wavering line of heat haze, drifting up. */
  seShimmer(v, P, p) {
    const u = p.age / p.life, k = Math.sin(Math.PI * clamp(u)) * 0.6; if (k < 0.1) return;
    const [x, y] = v.ap(p.x, p.y, p.z), len = p.len;
    for (let d = 0; d < len; d++) {
      const w = k * (1 - Math.abs(d / len - 0.5) * 1.4);
      if (w > 0.06) P.mix(x - len / 2 + d, y + Math.round(Math.sin(d * 0.9 + p.ph + p.age * 12) * 0.8), S(p.R, d % 3 ? 0.42 : 0.28), w);
    }
  },

  /** A drinking flask: cork, lip, neck and bulb in its own tilted frame; the brew stays level in the world. */
  seFlask(v, P, p) {
    const sc = p.sc * (p.pop ?? 1); if (sc < 0.25) return;
    const [cx, cy] = v.ap(p.x, p.y, p.z), RB = 4.6 * sc, NECK = 1.6 * sc, NT = RB + 4 * sc, LIP = NT + 1.3 * sc, CORK = LIP + 2.2 * sc;
    const ca = Math.cos(p.ang ?? 0), sa = Math.sin(p.ang ?? 0), ext = CORK + 2, lev = RB * (1 - 2 * (p.fill ?? 0.7)), fr = Math.floor(p.age * 12);
    const G = RAMP.neutral, W = RAMP.wood;
    P.shade(cx - ext, cy - ext, cx + ext, cy + ext, (x, y) => {
      const wx = x - cx, wy = y - cy, fx = wx * ca + wy * sa, fy = -wx * sa + wy * ca, up = -fy, d = Math.hypot(fx, fy);
      if (up > LIP && up <= CORK && Math.abs(fx) <= NECK * 0.9) return S(W, up > CORK - 1 ? 0.95 : fx < 0 ? 0.75 : 0.55);
      if (up > NT && up <= LIP && Math.abs(fx) <= NECK + 1) return S(G, fx < 0 ? 1 : 0.72);
      const neck = up > RB - 1.5 && up <= NT && Math.abs(fx) <= NECK;
      if (d > RB && !neck) return null;
      const wall = neck ? Math.abs(fx) > NECK - 1 : d > RB - 1;
      if (wy > lev) {
        if (wall) return S(p.R, 0.62);
        if (wy - lev < 1.2) return S(p.R, 1);
        const glint = hash(Math.floor(x / 2), Math.floor(y / 2) - fr, 3) > 0.9;
        return S(p.R, 0.92 - (d / RB) * 0.3 + (glint ? 0.15 : 0));
      }
      if (wall) return S(G, fx + fy < 0 ? 0.9 : 0.55);
      if (!neck && fx < -RB * 0.15 && fy < -RB * 0.15 && d > RB * 0.4 && d < RB * 0.72) return S(G, 1);
      return S(G, 0.3);
    }, 2);
  },

  /** An orb of light: a lit ball with a soft rim, eight rays turning slowly round it. */
  seOrb(v, P, p) {
    const r = p.r; if (r < 0.8) return;
    const [cx, cy] = v.ap(p.x, p.y, p.z), tw = 1 + 0.15 * Math.sin(p.age * 9), rot = p.age * 0.6;
    for (let i = 0; i < 8; i++) {
      const q = rot + (i * TAU) / 8, L = r * (i % 2 ? 1.6 : 2.5) * tw, c = Math.cos(q), s = Math.sin(q);
      P.line(cx + c * (r + 1), cy + s * (r + 1), cx + c * L, cy + s * L, null, 1, 1, (f) => (f < 0.45 ? S(p.R, 0.75) : f < 0.85 ? S(p.R, 0.55) : null));
    }
    P.shade(cx - r - 1, cy - r - 1, cx + r + 1, cy + r + 1, (x, y) => {
      const d = Math.hypot(x - cx, y - cy) / r; if (d > 1) return null;
      if (d > 1 - 1.2 / r) return S(p.R, 0.55);
      return S(p.R, d < 0.35 ? 0.9 : d < 0.7 ? 0.75 : 0.66);
    }, 2);
  },
});

registerShapes({
  /** An expanding floor ring like core's `ring`, in a chosen step of the ramp, so a pulse is gold rather than white. */
  seRing(v, P, p) {
    const u = clamp(q12(p.age) / p.life), fr = Math.floor(p.age * 12), [cx, cy] = v.ap(p.x, p.y, 0), rx = p.r * v.aps * easeOut(u);
    if (rx < 1) return;
    const tone = p.tone ?? 0.75;
    for (let k = 0; k < (u < 0.5 ? 2 : 1); k++)
      P.ellipse(cx, cy, rx - k, Math.max(0.5, (rx - k) * v.sq), (q) => (p.broken && pnoise(q + fr * 0.15, 12, p.seed) < 0.3 ? null : { c: S(p.R, k ? tone - 0.2 : tone), a: 1 - u }), 1);
  },

  /** Rise's floor: a lotus of light petals inside a turning dashed rim, opening with a spring. */
  seBloom(v, P, p) {
    const u = clamp(p.age / p.life), [cx, cy] = v.ap(p.x, p.y, 0), open = backOut(clamp(p.age / 0.32));
    const r = p.r * v.aps * open, ry = r * v.sq; if (r < 2) return;
    const a = fadeOut(u, 0.6), n = p.n, rot = p.rot + p.age * 0.35, r0 = 0.26;
    P.shade(cx - r - 1, cy - ry - 1, cx + r + 1, cy + ry + 1, (x, y) => {
      const dx = (x - cx) / r, dy = (y - cy) / Math.max(1, ry), d = Math.hypot(dx, dy);
      if (d > 1.02) return null;
      const q = Math.atan2(dy, dx);
      if (d > 0.93) return ((Math.floor(((q - rot * 1.6) / TAU) * n * 3) % 3) + 3) % 3 === 2 ? null : { c: S(p.R, p.dim ? 0.62 : 0.78), a };
      if (d < r0) return d > r0 - 0.1 ? { c: S(p.R, 0.75), a } : null;
      const f = (d - r0) / (0.9 - r0); if (f > 1) return null;
      const ph = (((((q - rot) / TAU) * n) % 1) + 1) % 1 - 0.5, hw = 0.5 * Math.sin(Math.PI * f ** 0.6) ** 0.8 + 0.02, e = Math.abs(ph) / hw;
      if (e > 1) return null;
      // each petal is its rim, its vein and a lit tip; the floor shows through
      // opaque lines (flag 1: inked on a bright floor), dissolving as it fades
      if (f > 0.86) return { c: S(p.R, 0.9), a };
      if (e > 0.7) return { c: S(p.R, f < 0.35 ? 0.55 : 0.72), a: p.dim ? 0.6 * a : a };
      if (e < 0.12 && f > 0.15 && f < 0.8 && !p.dim) return { c: S(p.R, 0.62), a };
      return null;
    }, 1);
  },

  /** Rage's floor: hot cracks run out from the feet, flaring on every beat and cooling between. */
  seCracks(v, P, p) {
    const fade = fadeOut(clamp(p.age / p.life), 0.7), grow = clamp(p.age / 0.15);
    let heat = 0.15;
    for (const b of p.beats) { const d = p.age - b; if (d >= 0) heat = Math.max(heat, Math.exp(-d / 0.22)); }
    for (const pts of p.runs) {
      const n = Math.max(2, Math.ceil(pts.length * grow));
      for (let i = 1; i < n && i < pts.length; i++) {
        const [x0, y0] = v.ap(pts[i - 1][0], pts[i - 1][1], 0), [x1, y1] = v.ap(pts[i][0], pts[i][1], 0), hk = heat * (1 - (i / pts.length) * 0.6);
        P.line(x0, y0, x1, y1, hk > 0.6 ? S(p.H, 0.95) : hk > 0.32 ? S(p.R, 0.82) : S(p.R, 0.45), 1, fade);
      }
    }
  },

  /** Stance's sigil: a double ring with compass ticks and a turning eight-point star, slammed down from wide. */
  seSigil(v, P, p) {
    const u = clamp(p.age / p.life), [cx, cy] = v.ap(p.x, p.y, 0), slam = easeOut(clamp(p.age / 0.1));
    const r = p.r * v.aps * lerp(1.6, 1, slam), ry = r * v.sq, rot = p.rot + p.age * 0.45 * p.spin;
    const flare = p.age < 0.12, a = (0.5 + 0.5 * slam) * fadeOut(u, 0.72);
    if (flare) P.shade(cx - r, cy - ry, cx + r, cy + ry, (x, y) => (Math.hypot((x - cx) / r, (y - cy) / Math.max(1, ry)) < 1 ? { c: S(p.R, 0.6), a: 0.25 } : null), 0, "mix");
    P.ellipse(cx, cy, r, ry, () => ({ c: S(p.R, flare ? 0.9 : 0.75), a }), 1);
    P.ellipse(cx, cy, r - 2, Math.max(1, ry - 2 * v.sq), (q) => (((Math.floor(((q - rot) / TAU) * 32) % 2) + 2) % 2 ? { c: S(p.R, 0.6), a } : null), 1);
    P.ellipse(cx, cy, r * 0.62, ry * 0.62, () => ({ c: S(p.R, 0.68), a }), 1);
    for (let i = 0; i < 8; i++) {
      const q = rot + (i * TAU) / 8, c = Math.cos(q), s = Math.sin(q), L0 = i % 2 ? 0.66 : 0.62, L1 = i % 2 ? 0.82 : 1.12;
      P.line(cx + c * r * L0, cy + s * ry * L0, cx + c * r * L1, cy + s * ry * L1, S(p.R, i % 2 ? 0.6 : 0.88), 1, a);
    }
    for (const off of [0, TAU / 8]) {
      const pts = [];
      for (let i = 0; i < 4; i++) { const q = -rot * 0.7 + off + (i * TAU) / 4; pts.push([cx + Math.cos(q) * r * 0.6, cy + Math.sin(q) * ry * 0.6]); }
      for (let i = 0; i < 4; i++) { const A = pts[i], B = pts[(i + 1) % 4]; P.line(A[0], A[1], B[0], B[1], S(p.R, off ? 0.5 : 0.72), 1, a); }
    }
  },

  /** A stance's aura: two counter-turning dashed rings hugging the body's rim. */
  seAura(v, P, p) {
    const u = clamp(p.age / p.life), [cx, cy] = v.ap(p.x, p.y, 0), r = p.r * v.aps * (0.85 + 0.15 * easeOut(clamp(p.age / 0.25))), ry = r * v.sq;
    const a = Math.min(1, p.age / 0.15) * fadeOut(u, 0.65), n = Math.max(6, Math.round(r / 3)), turn = p.age * 3 * p.spin;
    P.ellipse(cx, cy, r, Math.max(1, ry), (q) => { const k = ((((q / TAU) * n + turn) % 1) + 1) % 1; return k < 0.55 ? { c: S(p.R, k < 0.18 ? 1 : 0.85), a } : null; }, 1);
    P.ellipse(cx, cy, r + 2, Math.max(1, ry + 2 * v.sq), (q) => { const k = ((((q / TAU) * n * 0.5 - turn * 0.7) % 1) + 1) % 1; return k < 0.3 ? { c: S(p.R, 0.65), a } : null; }, 0);
  },
}, { flat: ["seRing", "seBloom", "seCracks", "seSigil", "seAura"] });

/* ── bitmaps (conditions.mjs drawIcon: "#" bevelled, "h" highlight) ───── */

/** The healing cross, bevelled and big enough to read over a token. */
const CROSS = Object.freeze(["..###..", "..#h#..", "###h###", "#hhhhh#", "###h###", "..#h#..", "..###.."]);
/** Fortune's four-point star. */
const STAR4 = Object.freeze([
  "......#......", "......#......", ".....###.....", ".....###.....", "....##h##....", "..###hhh###..", "####hhhhh####",
  "..###hhh###..", "....##h##....", ".....###.....", ".....###.....", "......#......", "......#......",
]);
/** The anger mark at the temple, small and swollen. */
const MARK = Object.freeze(["..#.#..", ".##.##.", "##...##", ".......", "##...##", ".##.##.", "..#.#.."]);
const MARK_BIG = Object.freeze(["...#.#...", "..##.##..", ".##...##.", "##.....##", ".........", "##.....##", ".##...##.", "..##.##..", "...#.#..."]);

/* ── helpers ─────────────────────────────────────────────────────────── */

const OUT = Object.freeze({ crit: 1.4, hit: 1, miss: 0.75, neutral: 0.92 });
const outcomeOf = (s, T) => T.outcome ?? s.spec.outcome ?? "neutral";
/** How grand an archetype plays on one body: rank (s.m) times the outcome. */
const grand = (s, T) => s.m * (OUT[outcomeOf(s, T)] ?? 1);
const hued = (s) => Number.isFinite(s.spec.look?.hue);
/** A material with no colour of its own (kinetic, neutral) borrows the archetype's own. */
const rampFor = (s, M, fallback) => (!hued(s) && (M.material === "kinetic" || M.material === "neutral") ? fallback : M.R);

/** Every body an archetype lands on: the targets, else creature-sized points across the area, else the caster. */
function bodies(s, ctx, n = 4) {
  if (ctx.targets.length) return ctx.targets;
  if (ctx.area) {
    const got = areaPoints(areaGeom(ctx.area), n, () => s.R()).pts;
    return (got.length ? got : [{ x: ctx.area.x, y: ctx.area.y }]).map((p) => ({ x: p.x, y: p.y, size: 1, h: 1, id: null }));
  }
  return ctx.caster ? [ctx.caster] : [];
}

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
  bodies(s, ctx).forEach((T, i) => {
    const at = reach(s, ctx, T, ctx.t0 + i * gap, R);
    s.at(at, (s2) => on(s2, T, i));
    end = Math.max(end, at);
  });
  return end;
}

/** A ring of creature-dust kicked out from a body's rim. */
function dust(s, T, n, sp, minorFrom = 3) {
  const sz = T.size, sq = Math.sqrt(sz);
  for (let k = 0; k < n; k++) {
    const q = (k / n) * TAU + s.rand(-0.2, 0.2), c = Math.cos(q), si = Math.sin(q);
    s.add({ k: "smoke", x: T.x + c * 0.4 * sz, y: T.y + si * 0.4 * sz, z: 0.03, vx: c * sp * sz, vy: si * sp * sz, vz: 0.2, drag: 3.6, r: s.rand(2.4, 3.6) * sq, life: s.rand(0.45, 0.75), lobes: lobes(s), R: RAMP.smoke, tone: 0.58, minor: k >= minorFrom });
  }
}

/* ── rise ────────────────────────────────────────────────────────────── */

function riseOn(s, R, R2, T, g, crit) {
  const sz = T.size, sg = Math.sqrt(g), h = T.h, t = s.t, rr = 0.8 * sz * sg, x = T.x, y = T.y;
  // the floor: a lotus of light under the feet, a warm pool, the body lit from below
  s.add({ k: "seBloom", x, y, r: rr, n: 8, rot: s.rand(0, TAU), life: 2.1, R, update: still });
  if (g >= 1.12) s.add({ k: "seBloom", x, y, r: rr * 1.45, n: 12, rot: s.rand(0, TAU), life: 1.8, R, dim: true, wait: 0.12, update: still });
  s.add({ k: "seRing", x, y, r: 1.6 * sz * sg, life: 0.75, R, seed: sd(s), update: still });
  s.light(x, y, 0.1, 2.8 * sz * sg, S(R, 0.5), 0.55, 0.35, { swell: true });
  s.at(t + 0.35, (s2) => s2.light(x, y, 0.1, 2.8 * sz * sg, S(R, 0.5), 0.65, 2));
  s.light(x, y, 0.05, 1.1 * sz, S(R, 0.62), 0.4, 1.5);
  // the column, and a hoop climbing the body that leaves sparkles where it passes
  s.add({ k: "seColumn", x, y, h: 2.4 * h * sg, w: 0.3 * sz * s.spec.aps * sg, life: 1.6, R, update: still });
  s.add({ k: "seHoop", x, y, z: 0, r: 0.6 * sz, life: 0.72, R, wait: 0.08, update(p, s3, dt) {
    const f = easeInOut(clamp(p.age / 0.62));
    p.z = f * 1.12 * h; p.r = lerp(0.62, 0.36, f) * sz;
    for (let i = s3.count(14 * sg, dt); i > 0; i--) {
      const q = s3.rand(0, TAU);
      s3.add({ k: "glint", x: x + Math.cos(q) * p.r * 0.8, y: y + Math.sin(q) * p.r * 0.8, z: p.z, vz: 0.5, drag: 3, life: 5 / 12, R: s3.R() < 0.3 ? R2 : R, minor: i > 1 });
    }
  } });
  // the fountain: motes boil up off the bloom and spread, rays climb the column
  s.emit(t + 0.05, t + 1.05, (s2, u, dt) => {
    for (let k = s2.count(74 * g * (1 - u * 0.5), dt); k > 0; k--) {
      const q = s2.rand(0, TAU), d = s2.rand(0.36, 0.66) * sz, spread = s2.rand(0.15, 0.75) * sz;
      s2.add({ k: "mote", x: x + Math.cos(q) * d, y: y + Math.sin(q) * d, z: 0.04, vx: Math.cos(q) * spread, vy: Math.sin(q) * spread, vz: s2.rand(1.4, 2.9) * Math.sqrt(sz) * sg, g: -0.3, drag: 1.3, life: s2.rand(0.8, 1.5), R: s2.R() < 0.22 ? R2 : R, plus: s2.R() < 0.35, minor: k > 1 });
    }
    for (let k = s2.count(14 * g, dt); k > 0; k--) s2.add({ k: "streak", x: x + s2.rand(-0.3, 0.3) * sz, y: y + s2.rand(-0.15, 0.15) * sz, z: s2.rand(0, 0.5) * h, vz: s2.rand(4, 6.5) * sg, life: s2.rand(0.18, 0.3), R, minor: true, update(p, _s, dt2) { p.z += p.vz * dt2; } });
  });
  // crosses pop out of the column and float off
  const nC = Math.round(3 + 3 * g);
  for (let k = 0; k < nC; k++) {
    const q = (k / nC) * TAU + s.rand(-0.3, 0.3), d = s.rand(0.15, 0.5) * sz;
    s.add({ k: "icon", bm: k % 2 ? ICONS.plus : CROSS, x: x + Math.cos(q) * d, y: y + Math.sin(q) * d, z: s.rand(0.5, 1.1) * h, vx: Math.cos(q) * 0.3, vy: Math.sin(q) * 0.3, vz: s.rand(0.6, 1.1), drag: 0.9, life: s.rand(0.95, 1.3), R: k % 3 === 1 ? R2 : R, snap: false, wait: 0.28 + k * 0.08, minor: k > 3 });
  }
  // the crest: a sparkle over the head, a ring of light thrown out, a soft swell (a crit adds one hero frame)
  s.at(t + 0.72, (s2) => {
    const zt = 1.2 * h;
    s2.add({ k: "glint", x, y, z: zt, life: 5 / 12, R, big: true, update: still });
    if (crit) s2.add({ k: "flash", x, y, z: zt, life: 2 / 12, r: 0.3 * sz * s2.spec.aps, R, update: still });
    s2.add({ k: "halo", x, y, z: zt - 0.1, vz: 0.4, drag: 1, life: 0.85, r: 0.3 * sz, R });
    s2.add({ k: "seRing", x, y, r: 1.15 * sz * sg, life: 0.5, R, seed: sd(s2), update: still });
    const n = Math.round(14 * g);
    for (let i = 0; i < n; i++) {
      const q = (i / n) * TAU + s2.rand(-0.15, 0.15), sp = s2.rand(1.1, 2) * sz;
      s2.add({ k: "mote", x, y, z: zt, vx: Math.cos(q) * sp, vy: Math.sin(q) * sp, vz: s2.rand(-0.2, 0.8), drag: 2.6, life: s2.rand(0.55, 0.9), R: i % 3 ? R : R2, plus: i % 2 === 0, minor: i % 3 === 2 });
    }
    s2.light(x, y, zt, 1.7 * sz * sg, S(R, 0.6), 0.6, 0.55);
  });
  // afterglow: a few motes still drifting up
  s.emit(t + 1.05, t + 2.2, (s2, u, dt) => {
    for (let k = s2.count(12 * g * (1 - u), dt); k > 0; k--) s2.add({ k: "mote", x: x + s2.rand(-0.45, 0.45) * sz, y: y + s2.rand(-0.45, 0.45) * sz, z: s2.rand(0.05, 0.6) * h, vz: s2.rand(0.4, 0.9), drag: 1.2, life: s2.rand(0.7, 1.1), R, plus: s2.R() < 0.3, minor: true });
  });
}

function rise(s, M, ctx) {
  const R = rampFor(s, M, RAMP.vitality);
  // vitality's crosses come in two colours: its own gold and a living green
  const R2 = M.material === "vitality" && !hued(s) ? RAMP.plant : R;
  const end = landOn(s, ctx, R, 0.07, (s2, T) => riseOn(s2, R, R2, T, grand(s2, T), outcomeOf(s2, T) === "crit"));
  s.phases.push("rise: a bloom, a column and a fountain of motes, crosses");
  s.period = end + 2.5;
}

/* ── drink ───────────────────────────────────────────────────────────── */

/** The flask raised, tipped, gulped, its colour through the body, spun away. Returns when the brew takes. */
function quaff(s, R, T, t0, side) {
  const sz = T.size, h = T.h, sc = 1.2 * Math.sqrt(sz);
  const hx = T.x + 0.4 * sz * side, hz = 0.5 * h, mx = T.x + 0.2 * sz * side, mz = 0.95 * h;
  const RAISE = 0.26, TIP = 0.14, GULP = 0.42, AWAY = 0.32, t2 = t0 + RAISE + TIP, t3 = t2 + GULP;
  const lift = (u) => [lerp(hx, mx, u), lerp(hz, mz, u)];
  s.at(t0, (s2) => {
    s2.add({ k: "glint", x: hx, y: T.y, z: hz, life: 5 / 12, R, update: still });
    s2.add({ k: "seFlask", x: hx, y: T.y + 0.02, z: hz, sc, ang: 0, fill: 0.72, pop: 0, life: RAISE + TIP + GULP + AWAY, R, update(p, s3) {
      const a = p.age, f1 = easeInOut(clamp(a / RAISE)), f2 = easeInOut(clamp((a - RAISE) / TIP)), f3 = clamp((a - RAISE - TIP) / GULP), f4 = clamp((a - RAISE - TIP - GULP) / AWAY);
      [p.x, p.z] = lift(f1);
      p.pop = Math.min(1.1, backOut(clamp(a / 0.12), 2));
      p.ang = side * (-0.25 * f1 - 1.7 * f2 + 0.1 * Math.sin(f3 * Math.PI * 6) * (1 - f4));
      p.fill = 0.72 * (1 - f3);
      if (f4 > 0) {
        // empty: spun up and away, shrinking into sparkles
        p.ang += side * f4 * 7; p.z += f4 * 0.7 * h; p.x += side * f4 * 0.55 * sz; p.pop = 1 - f4 * f4;
        if (!p.gone && f4 > 0.85) { p.gone = true; for (let i = 0; i < 6; i++) s3.add({ k: "glint", x: p.x + s3.rand(-0.15, 0.15), y: T.y, z: p.z + s3.rand(-0.1, 0.15), life: 5 / 12, R, wait: i * 0.04, minor: i > 2, update: still }); }
      }
    } });
  });
  // three gulps: a glint at the mouth, the brew's light pulsing, a bubble or two rising
  for (let k = 0; k < 3; k++) s.at(t2 + 0.07 + k * 0.13, (s2) => {
    s2.add({ k: "glint", x: mx - side * 0.08 * sz, y: T.y, z: mz + 0.03, life: 5 / 12, R, big: k === 2, update: still });
    for (let i = 0; i < 3; i++) s2.add({ k: "mote", x: mx - side * 0.1 * sz, y: T.y, z: mz, vx: s2.rand(-0.3, 0.3), vz: s2.rand(0.5, 1), drag: 2, life: s2.rand(0.35, 0.55), R, plus: i === 0, minor: i > 0 });
    s2.light(T.x, T.y, mz, 1 * sz, S(R, 0.62), 0.55, 0.25);
  });
  // the brew takes: its colour flashes through the whole body
  s.at(t3, (s2) => {
    s2.add({ k: "seTint", x: T.x, y: T.y, z: 0.55 * h, r: 0.5 * sz, h, life: 3 / 12, R, update: still });
    s2.add({ k: "seRing", x: T.x, y: T.y, r: 1.1 * sz, life: 0.45, R, seed: sd(s2), update: still });
    s2.add({ k: "halo", x: T.x, y: T.y, z: 0.1, vz: 1.3, drag: 1, life: 0.6, r: 0.42 * sz, R });
    for (let i = 0; i < 10; i++) {
      const q = (i / 10) * TAU, sp = s2.rand(1.2, 2) * sz;
      s2.add({ k: "mote", x: T.x, y: T.y, z: 0.55 * h, vx: Math.cos(q) * sp, vy: Math.sin(q) * sp, vz: s2.rand(-0.2, 0.6), drag: 3, life: s2.rand(0.4, 0.65), R, plus: i % 3 === 0, minor: i % 2 === 1 });
    }
    s2.light(T.x, T.y, 0.6 * h, 1.8 * sz, S(R, 0.62), 0.9, 0.6);
  });
  return t3 + 0.04;
}

function drink(s, M, ctx) {
  const R = M.R, drinkers = ctx.targets.length ? ctx.targets : bodies(s, ctx);
  let after = ctx.t0;
  drinkers.forEach((T, i) => {
    const side = ctx.caster && T !== ctx.caster && ctx.caster.x > T.x ? -1 : 1;
    after = Math.max(after, quaff(s, R, T, ctx.t0 + i * 0.1, side));
  });
  s.phases.push("drink: the flask raised, tipped, gulped");
  // then the potion's real effect on the drinker: a healing one is the vital rise
  const next = { ...ctx, targets: drinkers, area: null, self: true, t0: after };
  const func = s.spec.func;
  if (func === "restore") rise(s, M, next);
  else (FORMS[func] ?? FORMS.support)(s, M, next);
  s.period = Math.max(s.period, after + 1.2);
}

/* ── rage ────────────────────────────────────────────────────────────── */

/** Materials that rage in its own red: a barbarian's fury, a plain berserk. Any other element is the instinct's. */
const RAGE_RED = new Set(["kinetic", "neutral", "fire", "arcane", "unholy"]);
/** Rage's own red: blood-red through to a crimson flame, with fire's gold for its hottest two steps. */
const RAGE_RAMP = Object.freeze([...RAMP.bleed.slice(0, 5), RAMP.fire[5], RAMP.fire[6]]);
/** The eruption, then a heartbeat: lub-dub, three times. */
const BEATS = Object.freeze([0, 0.62, 0.84, 1.42, 1.64, 2.22, 2.44]);
const beatK = (t) => BEATS.slice(1).reduce((m, b, i) => Math.max(m, (i % 2 ? 0.65 : 1) * Math.exp(-(((t - b) / 0.07) ** 2))), 0);

/** Jagged runs out from under the feet, in squares. */
function cracks(s, T) {
  const sz = T.size, runs = [];
  for (let k = 0; k < 6; k++) {
    let q = (k / 6) * TAU + s.rand(-0.35, 0.35), x = T.x + Math.cos(q) * 0.12 * sz, y = T.y + Math.sin(q) * 0.12 * sz;
    const pts = [[x, y]], n = 6 + Math.floor(s.R() * 4);
    for (let i = 0; i < n; i++) {
      q += s.rand(-0.5, 0.5);
      const st = s.rand(0.07, 0.12) * sz;
      x += Math.cos(q) * st; y += Math.sin(q) * st; pts.push([x, y]);
      if (i > 1 && s.R() < 0.3) { const q2 = q + (s.R() < 0.5 ? -0.8 : 0.8), L = s.rand(0.08, 0.16) * sz; runs.push([[x, y], [x + Math.cos(q2) * L, y + Math.sin(q2) * L]]); }
    }
    runs.push(pts);
  }
  return runs;
}

/** Flame tongues round a body's rim. */
function tongues(s, R, T, n, hMin, hMax, life, minorFrom) {
  const sz = T.size, rim = 0.42 * sz, sq = Math.sqrt(sz);
  for (let k = 0; k < n; k++) {
    const q = (k / n) * TAU + s.rand(-0.25, 0.25);
    s.add({ k: "tongue", x: T.x + Math.cos(q) * rim, y: T.y + Math.sin(q) * rim, z: 0, h: s.rand(hMin, hMax) * sq, w: s.rand(2, 3.2) * sq, life: s.rand(life * 0.7, life), R, seed: s.rand(0, 9), wait: s.rand(0, 0.06), minor: k >= minorFrom, update: still });
  }
}

function rageOn(s, R, H, T, g, crit) {
  const sz = T.size, sg = Math.sqrt(g), sq = Math.sqrt(sz), h = T.h, t = s.t, x = T.x, y = T.y, aps = s.spec.aps;
  // the eruption: the body flushes, light cracks out of it, flames burst up round it
  s.add({ k: "seTint", x, y, z: 0.55 * h, r: 0.5 * sz, h, life: 3 / 12, R, update: still });
  s.add({ k: "flash", x, y, z: 0.6 * h, life: (crit ? 2 : 1) / 12, r: 0.3 * sz * aps, R, update: still });
  s.add({ k: "seVeins", x, y, z: 0.55 * h, L: 16 * sq * sg, n: 7, seed: sd(s), life: 0.55, R: H, update: still });
  tongues(s, R, T, Math.round(10 + 6 * g), 12 * sg, 22 * sg, 0.7, 8);
  // the roar: a shockwave on the floor and one at the head, dust thrown out, the floor cracking hot
  s.add({ k: "seRing", x, y, r: 2.1 * sz * sg, life: 0.5, R, seed: sd(s), update: still });
  s.add({ k: "seRing", x, y, r: 1.35 * sz * sg, life: 0.32, R: H, seed: sd(s), update: still });
  s.add({ k: "seHoop", x, y, z: 0.9 * h, r: 0.4 * sz, life: 0.4, R, update(p) { p.r = (0.4 + easeOut(clamp(p.age / p.life)) * 1.5 * sg) * sz; } });
  dust(s, T, 10, 2.4, 5);
  s.add({ k: "seCracks", x, y, runs: cracks(s, T), beats: BEATS, life: 2.9, R, H, update: still });
  s.shake = Math.max(s.shake, 1.6 + (crit ? 1 : 0));
  s.light(x, y, 0.6 * h, 2.7 * sz * sg, S(R, 0.62), 1, 0.7);
  s.light(x, y, 0.6 * h, 1 * sz, S(H, 1), 0.85, 0.2);
  // steam jetting off the shoulders
  for (let i = 0; i < 8; i++) {
    const side = i % 2 ? 1 : -1;
    s.add({ k: "smoke", x: x + side * 0.22 * sz, y, z: 0.85 * h, vx: side * s.rand(0.4, 0.9) * sq, vz: s.rand(1.6, 2.5) * sq, drag: 2.2, r: s.rand(1.6, 2.6) * sq, life: s.rand(0.5, 0.8), wait: (i >> 1) * 0.06, lobes: lobes(s), R: RAMP.linen, tone: 0.82, minor: i > 3 });
  }
  // the anger mark throbbing at the temple, swollen on every lub
  s.add({ k: "icon", bm: (p) => (beatK(p.age + 0.5) > 0.4 ? MARK_BIG : MARK), x: x + 0.3 * sz, y: y - 0.05, z: 1.05 * h, life: 2.3, R, snap: false, wait: 0.5, inT: 0.05, from: 0.85, update: still });
  s.light(x, y, 0.3 * h, 1.6 * sz * sg, S(R, 0.62), 0.5, 2.7, { flicker: true });
  // the heartbeat
  BEATS.slice(1).forEach((b, k) => s.at(t + b, (s2) => {
    const lub = k % 2 === 0, pk = lub ? 1 : 0.65;
    s2.light(x, y, 0.5 * h, 2.1 * sz * sg, S(R, 0.62), 0.85 * pk, 0.35);
    s2.add({ k: "seRing", x, y, r: (lub ? 1.05 : 0.8) * sz * sg, life: 0.3, R, broken: true, seed: sd(s2), update: still });
    if (lub) {
      s2.add({ k: "seVeins", x, y, z: 0.55 * h, L: 11 * sq * sg, n: 5, seed: sd(s2), life: 0.25, R: H, update: still });
      s2.add({ k: "seHoop", x, y, z: 0, r: 0.55 * sz, life: 0.3, R, update(p) { const f = easeOut(clamp(p.age / p.life)); p.z = f * 1.15 * h; p.r = lerp(0.58, 0.32, f) * sz; } });
    }
    tongues(s2, R, T, Math.round(6 * pk * sg), 8 * sg, 15 * sg, 0.4, 3);
    for (let i = Math.round(8 * g * pk); i > 0; i--) s2.add({ k: "ember", x: x + s2.rand(-0.6, 0.6) * sz, y: y + s2.rand(-0.6, 0.6) * sz, z: 0.02, vx: s2.rand(-0.4, 0.4), vy: s2.rand(-0.4, 0.4), vz: s2.rand(1.5, 3), g: 3, drag: 1, life: s2.rand(0.5, 0.9), R: H, seed: s2.R() * 9, minor: i > 3 });
    for (const side of [-1, 1]) s2.add({ k: "smoke", x: x + side * 0.22 * sz, y, z: 0.85 * h, vx: side * 0.7 * sq, vz: 2.2 * sq, drag: 2.4, r: s2.rand(1.4, 2.2) * sq, life: 0.45, lobes: lobes(s2), R: RAMP.linen, tone: 0.82, minor: !lub });
    s2.shake = Math.max(s2.shake, 0.6 * pk);
  }));
  // held: heat shimmering up round the body, low flames licking the rim, embers
  s.emit(t + 0.3, t + 2.7, (s2, _u, dt) => {
    for (let k = s2.count(10 * sg, dt); k > 0; k--) s2.add({ k: "seShimmer", x: x + s2.rand(-0.55, 0.55) * sz, y: y + s2.rand(-0.3, 0.3) * sz, z: s2.rand(0.1, 0.8) * h, vz: s2.rand(0.5, 0.9), life: s2.rand(0.7, 1.1), len: 5 + Math.floor(s2.R() * 6), ph: s2.rand(0, TAU), R, minor: true });
    if (s2.count(14 * g, dt) > 0) tongues(s2, R, T, 1, 7 * sg, 14 * sg, 0.4, 0);
    for (let k = s2.count(5 * g, dt); k > 0; k--) s2.add({ k: "ember", x: x + s2.rand(-0.45, 0.45) * sz, y: y + s2.rand(-0.45, 0.45) * sz, z: s2.rand(0.1, 0.5) * h, vx: s2.rand(-0.2, 0.2), vz: s2.rand(0.6, 1.2), drag: 1, life: s2.rand(0.6, 1), R: H, seed: s2.R() * 9, minor: true });
  });
}

function rage(s, M, ctx) {
  const own = hued(s) || !RAGE_RED.has(M.material), R = own ? M.R : RAGE_RAMP, H = own ? M.R : RAMP.fire;
  let end = ctx.t0;
  bodies(s, ctx).forEach((T, i) => {
    const at = ctx.t0 + i * 0.05;
    s.at(at, (s2) => rageOn(s2, R, H, T, grand(s2, T), outcomeOf(s2, T) === "crit"));
    end = Math.max(end, at);
  });
  s.phases.push("rage: an eruption, a roar, a heartbeat of flares");
  s.period = end + 3;
}

/* ── stance ──────────────────────────────────────────────────────────── */

function stanceOn(s, R, T, g, crit) {
  const sz = T.size, sg = Math.sqrt(g), h = T.h, t = s.t, x = T.x, y = T.y, aps = s.spec.aps, spin = s.R() < 0.5 ? 1 : -1;
  // the set: lines pulled in to the feet
  for (let i = 0; i < 10; i++) {
    const q = (i / 10) * TAU + s.rand(-0.2, 0.2), d = 1.1 * sz * sg, life = 0.12, px = x + Math.cos(q) * d, py = y + Math.sin(q) * d;
    s.add({ k: "streak", x: px, y: py, z: 0.05, vx: (x - px) / life, vy: (y - py) / life, life, R, minor: i % 2 === 1, update(p, _s, dt) { p.x += p.vx * dt; p.y += p.vy * dt; } });
  }
  s.at(t + 0.12, (s2) => {
    // the stamp: the sigil slams down, the body flashes in its pose, a kiai of lines, dust
    s2.add({ k: "seSigil", x, y, r: 0.9 * sz * sg, rot: s2.rand(0, TAU), spin, life: 2.4, R, update: still });
    s2.add({ k: "seRing", x, y, r: 1.7 * sz * sg, life: 0.4, R, seed: sd(s2), update: still });
    s2.add({ k: "seTint", x, y, z: 0.55 * h, r: 0.46 * sz, h, life: 2 / 12, R, update: still });
    s2.add({ k: "flash", x, y, z: 0.62 * h, life: (crit ? 2 : 1) / 12, r: 0.3 * sz * aps, R, update: still });
    for (let i = 0; i < 8; i++) {
      const q = (i / 8) * TAU + 0.2;
      s2.add({ k: "streak", x: x + Math.cos(q) * 0.35 * sz, y: y + Math.sin(q) * 0.35 * sz, z: 0.6 * h, vx: Math.cos(q) * 7 * sg, vy: Math.sin(q) * 7 * sg, life: 0.13, R, minor: i % 2 === 1, update(p, _s, dt) { p.x += p.vx * dt; p.y += p.vy * dt; } });
    }
    dust(s2, T, 8, 2, 4);
    s2.shake = Math.max(s2.shake, 0.9);
    s2.light(x, y, 0.3, 2.3 * sz * sg, S(R, 0.62), 0.65, 0.45);
    s2.light(x, y, 0.6 * h, 0.8 * sz, S(R, 0.85), 0.6, 0.12);
    // held: the aura ring at the body's rim, a soft light
    s2.add({ k: "seAura", x, y, r: 0.58 * sz, life: 2.2, spin: -spin, R, wait: 0.06, update: still });
    s2.light(x, y, 0.2, 1.4 * sz * sg, S(R, 0.62), 0.45, 2.2);
  });
  // motes and thin rays rising off the aura
  s.emit(t + 0.2, t + 2.3, (s2, u, dt) => {
    for (let k = s2.count(18 * g * (1 - u * 0.5), dt); k > 0; k--) {
      const q = s2.rand(0, TAU), d = 0.58 * sz;
      s2.add({ k: "mote", x: x + Math.cos(q) * d, y: y + Math.sin(q) * d, z: 0.05, vz: s2.rand(0.7, 1.4) * Math.sqrt(sz), drag: 1, life: s2.rand(0.6, 1), R, plus: s2.R() < 0.2, minor: k > 1 });
    }
    for (let k = s2.count(7 * g, dt); k > 0; k--) {
      const q = s2.rand(0, TAU), d = 0.58 * sz;
      s2.add({ k: "streak", x: x + Math.cos(q) * d, y: y + Math.sin(q) * d, z: 0.05, vz: s2.rand(2.5, 3.5), life: s2.rand(0.16, 0.24), R, minor: true, update(p, _s, dt2) { p.z += p.vz * dt2; } });
    }
  });
}

function stance(s, M, ctx) {
  const R = rampFor(s, M, RAMP.holy);
  let end = ctx.t0;
  bodies(s, ctx).forEach((T, i) => {
    const at = ctx.t0 + i * 0.05;
    s.at(at, (s2) => stanceOn(s2, R, T, grand(s2, T), outcomeOf(s2, T) === "crit"));
    end = Math.max(end, at);
  });
  s.phases.push("stance: a sigil stamped, a pose flash, an aura ring");
  s.period = end + 2.6;
}

/* ── light ───────────────────────────────────────────────────────────── */

function lightOn(s, R, T, g, crit, i) {
  const sz = T.size, sg = Math.sqrt(g), h = T.h, t = s.t, side = i % 2 ? -1 : 1, life = 3;
  const ox = T.x + 0.32 * sz * side, oy = T.y - 0.12 * sz, oz = 1.15 * h, r0 = 5.2 * Math.sqrt(sz) * sg;
  // the ignition: sparks drawn in to a point
  for (let k = 0; k < 8; k++) {
    const q = (k / 8) * TAU + s.rand(-0.2, 0.2), d = 0.75 * sz, dur = 0.14, px = ox + Math.cos(q) * d, py = oy + Math.sin(q) * d, pz = oz + s.rand(-0.35, 0.35);
    s.add({ k: "streak", x: px, y: py, z: pz, vx: (ox - px) / dur, vy: (oy - py) / dur, vz: (oz - pz) / dur, life: dur, R, minor: k % 2 === 1, update(p, _s, dt) { p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; } });
  }
  s.at(t + 0.14, (s2) => {
    s2.add({ k: "flash", x: ox, y: oy, z: oz, life: (crit ? 2 : 1) / 12, r: r0 * 1.7, R, update: still });
    s2.add({ k: "star", x: ox, y: oy, z: oz, L: 5 * sg, life: 3 / 12, R, update: still });
    s2.add({ k: "seRing", x: ox, y: oy, r: 1.4 * sz * sg, life: 0.6, R, seed: sd(s2), update: still });
    s2.add({ k: "seOrb", x: ox, y: oy, z: oz, r: 1, life, R, glow: true, update(p) {
      const a = p.age, pop = a < 0.24 ? backOut(a / 0.24, 2.4) : 1, out = clamp((a - (life - 0.4)) / 0.4);
      p.r = r0 * pop * (1 - out * out) * (1 + 0.06 * Math.sin(a * 7));
      p.z = oz + Math.sin(a * 2.2) * 0.09;
    } });
    for (let k = 0; k < 10; k++) {
      const q = (k / 10) * TAU, sp = s2.rand(1, 1.8) * sz;
      s2.add({ k: "mote", x: ox, y: oy, z: oz, vx: Math.cos(q) * sp, vy: Math.sin(q) * sp, vz: s2.rand(-0.4, 0.4), drag: 2.8, life: s2.rand(0.45, 0.7), R, plus: k % 3 === 0, minor: k % 2 === 1 });
    }
    s2.light(ox, oy, oz, 3.6 * sz * sg, S(R, 0.5), 0.75, 0.26, { swell: true });
    s2.light(ox, oy, oz, 1 * sz, S(R, 0.75), 0.8, 0.3);
  });
  // the pool holds while it burns: overlapping lights, each fading as the next arrives
  for (let j = 0; j < 6; j++) s.at(t + 0.38 + j * 0.45, (s2) => {
    s2.light(ox, oy, oz, 3.6 * sz * sg, S(R, 0.5), j === 5 ? 0.55 : 0.5, j === 5 ? 0.9 : 0.95);
    s2.light(ox, oy, oz, 1.2 * sz, S(R, 0.66), 0.4, 0.95);
  });
  // slow motes drifting in the light, the odd twinkle
  s.emit(t + 0.3, t + life, (s2, u, dt) => {
    const k0 = 1 - Math.max(0, u - 0.8) / 0.2;
    for (let k = s2.count(14 * g * k0, dt); k > 0; k--) {
      const q = s2.rand(0, TAU), d = s2.rand(0.2, 0.95) * sz * sg;
      s2.add({ k: "mote", x: ox + Math.cos(q) * d, y: oy + Math.sin(q) * d, z: Math.max(0.05, oz + s2.rand(-0.7, 0.3) * h), vx: s2.rand(-0.12, 0.12), vy: s2.rand(-0.12, 0.12), vz: s2.rand(0.05, 0.25), drag: 0.4, life: s2.rand(1.2, 2.2), R, plus: s2.R() < 0.15, minor: k > 1 });
    }
    if (s2.count(2 * g * k0, dt) > 0) { const q = s2.rand(0, TAU), d = s2.rand(0.3, 0.8) * sz; s2.add({ k: "glint", x: ox + Math.cos(q) * d, y: oy + Math.sin(q) * d, z: oz + s2.rand(-0.4, 0.3), life: 5 / 12, R, minor: true, update: still }); }
  });
}

function light(s, M, ctx) {
  const R = rampFor(s, M, RAMP.light);
  const end = landOn(s, ctx, R, 0.08, (s2, T, i) => lightOn(s2, R, T, grand(s2, T), outcomeOf(s2, T) === "crit", i));
  s.phases.push("light: an orb ignites in a pool of light");
  s.period = end + 3.3;
}

/* ── fortune ─────────────────────────────────────────────────────────── */

function fortuneOn(s, R, T, g, crit) {
  const sz = T.size, sg = Math.sqrt(g), h = T.h, t = s.t, x = T.x, y = T.y, rise = 0.7, top = 1.3 * h, N = Math.round(10 * g);
  // two strands of luck spiralling up the body, twinkling as they go
  for (let st = 0; st < 2; st++) for (let i = 0; i < N; i++) {
    const ph = st * Math.PI + (i / N) * 0.9;
    s.add({ k: "mote", x, y, z: 0, life: rise, R, plus: i % 2 === 0, glow: i % 4 === 0, wait: (i / N) * 0.35, minor: i % 3 === 2, update(p, s2, dt) {
      const f = clamp(p.age / rise), q = ph + f * TAU * 1.6, r = (0.58 - 0.34 * f) * sz;
      p.x = x + Math.cos(q) * r; p.y = y + Math.sin(q) * r; p.z = f * top;
      if (s2.count(24, dt) > 0) s2.add({ k: "mote", x: p.x, y: p.y, z: p.z, vz: -0.1, drag: 3, life: 0.35, R, minor: true });
      if (i % 3 === 0 && s2.count(3, dt) > 0) s2.add({ k: "glint", x: p.x, y: p.y, z: p.z, life: 5 / 12, R, minor: true, update: still });
    } });
  }
  s.light(x, y, 0.6 * h, 1.3 * sz * sg, S(R, 0.62), 0.5, rise, { swell: true });
  // the pop: a star over the head, a soft halo, sparkles thrown out
  s.at(t + rise + 0.05, (s2) => {
    s2.add({ k: "star", x, y, z: top, L: 6 * sg, life: 3 / 12, R, update: still });
    if (crit) s2.add({ k: "flash", x, y, z: top, life: 2 / 12, r: 0.3 * sz * s2.spec.aps, R, update: still });
    s2.add({ k: "icon", bm: STAR4, x, y: y - 0.02, z: top + 0.12, vz: 0.3, drag: 1.2, life: 1.35, R, snap: false, from: 0.6 });
    s2.add({ k: "halo", x, y, z: 1.12 * h, life: 1.4, r: 0.32 * sz, R, update: still });
    s2.add({ k: "seRing", x, y, r: 1 * sz * sg, life: 0.6, R, seed: sd(s2), update: still });
    const n = Math.round(12 * g);
    for (let i = 0; i < n; i++) {
      const q = (i / n) * TAU + s2.rand(-0.15, 0.15), sp = s2.rand(1, 1.8) * sz;
      s2.add({ k: "mote", x, y, z: top, vx: Math.cos(q) * sp, vy: Math.sin(q) * sp, vz: s2.rand(-0.4, 0.6), drag: 2.4, life: s2.rand(0.5, 0.85), R, plus: i % 2 === 0, minor: i % 3 === 2 });
    }
    for (let i = Math.round(8 * g); i > 0; i--) s2.add({ k: "glint", x: x + s2.rand(-0.5, 0.5) * sz, y: y + s2.rand(-0.5, 0.5) * sz, z: s2.rand(0.2, 1.2) * h, life: 5 / 12, R, wait: s2.rand(0.1, 1.2), minor: i > 3, update: still });
    s2.light(x, y, top, 1.9 * sz * sg, S(R, 0.62), 0.85, 0.75);
    s2.light(x, y, 0.1, 1.2 * sz * sg, S(R, 0.62), 0.4, 1.4);
  });
}

function fortune(s, M, ctx) {
  const R = rampFor(s, M, RAMP.holy);
  const end = landOn(s, ctx, R, 0.07, (s2, T) => fortuneOn(s2, R, T, grand(s2, T), outcomeOf(s2, T) === "crit"));
  s.phases.push("fortune: luck spirals up, a star pops, a halo");
  s.period = end + 2.4;
}

export default { rage, stance, rise, drink, light, fortune };
