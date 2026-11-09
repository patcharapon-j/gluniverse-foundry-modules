/**
 * Spellsprite — how a harmful spell or ability travels, one timeline per harm
 * delivery (constants.mjs DELIVERY_GROUPS.harm). Pure.
 *
 * `HARM[delivery](s, M, ctx)`; ctx is compile.mjs's `harmCtx`: the bodies, the
 * outcome reader, the caster's hand and every shared helper (release, linger,
 * fire, spray, areaFX, areaMetric, areaCentroid, equivRadius, spotIn, lobSize,
 * charge, projectile, POW, SAVE_POW, windUp, motif). Set `s.period`.
 * compile.mjs falls back to its own harm timeline for a delivery missing here.
 *
 * Each delivery is its own silhouette (a beam, a ball, darts, a column from the
 * sky, a wall, a contact flare, a glare, sound, a breath, a pulse, a bloom); the
 * family supplies the matter it is made of (M.mod's burst, trail, linger,
 * spray), so a fire ray and a cold ray are the same ray. Three other axes ride
 * on top:
 *
 *   props   minor and major scale the whole effect; auditory, visual,
 *           linguistic, fear, emotion, death, incapacitation, healing and
 *           persistent each add one mark where the effect lands (`marks`)
 *   motif   `carrier` on whatever travels, `impact` where it lands, `residue`
 *           after; every hook is optional and the default always draws
 *   flavor  `ctx.windUp`, never `charge` directly
 *
 * Outcomes read apart per target: an attack's miss flies wide or grazes past
 * and never flinches; a save's success still lands, smaller (`SAVE_POW`); only
 * "crit" gets the second beat, the hitstop and the big release, so "neutral"
 * (a degree this viewer may not see) never reads as one.
 */

import { TAU, clamp, lerp, easeOut, fadeOut, hash, pnoise, rng } from "./core/rand.mjs";
import { RAMP, S, WHITE } from "./core/palette.mjs";
import { registerShapes, snapH, GLYPHS } from "./core/shapes.mjs";
import { sd, lobes, still, trailFlourish } from "./core/motifs.mjs";
import { areaGeom, areaPoints, extentOf } from "./area.mjs";

const norm = (x, y) => { const l = Math.hypot(x, y) || 1; return [x / l, y / l]; };
const PLUS = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const DIRS8 = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
/** Families whose walls stand flat-topped and solid (ice, stone, wood, steel); the rest flicker. */
const SOLID = new Set(["frost", "earthwork", "growth", "physical"]);
/** Cantrips and rank 1 are smaller, rank 7+ bigger, on top of the rank's own `s.m`. */
const SCALE = Object.freeze({ minor: 0.82, major: 1.15 });

/* ── shared beats ─────────────────────────────────────────────────────── */

/** Everything a delivery reads, once: outcome power by kind, props, the caster's facing. */
function prep(s, M, ctx) {
  const sp = s.spec, props = s.props ?? new Set();
  if (!s.dvScaled) {
    s.dvScaled = true;
    if (props.has("minor")) s.m *= SCALE.minor;
    else if (props.has("major")) s.m *= SCALE.major;
  }
  const attack = sp.kind === "attack" || sp.kind === "strike", auto = sp.kind === "auto";
  const table = attack || auto ? ctx.POW : ctx.SAVE_POW;
  const D = {
    s, M, ctx, sp, props, attack,
    caster: ctx.caster, targets: ctx.targets, area: ctx.area, hand: ctx.hand, motif: ctx.motif,
    has: (p) => props.has(p),
    oc: (T) => (auto ? "hit" : ctx.outcomeOf(T)),
    pw: (o) => table[o] ?? 1,
    /* A release over 1.2 plays the crit flash and hitstop (motifs.mjs
       releaseFlash), so only a crit may go past it. */
    rp: (o, k) => (o === "crit" ? k : Math.min(k, 1.15)),
  };
  const c = D.caster, aim = D.targets[0] ?? (D.area ? { x: ctx.areaCentroid(D.area)[0], y: ctx.areaCentroid(D.area)[1] } : null);
  D.face = c && aim && Math.hypot(aim.x - c.x, aim.y - c.y) > 0.05 ? norm(aim.x - c.x, aim.y - c.y) : [1, 0];
  return D;
}

/** A point on the caster's head leaning `lean` sizes toward the aim, at `k` × its height (eyes 0.9, mouth 0.8). */
function headOf(D, k, lean) {
  const c = D.caster;
  if (!c) return null;
  const sz = c.size ?? 1;
  return [c.x + D.face[0] * lean * sz, c.y + D.face[1] * lean * sz, k * c.h];
}

/** The wind-up (the flavor's, else the charge); returns when it ends. */
function wind(D, at, dur, opts = {}, hand = null) {
  if (!D.caster) return at;
  D.ctx.windUp(D.caster, hand ?? D.hand ?? headOf(D, 0.85, 0.3), at, dur, opts);
  D.s.phases.push("wind-up");
  return at + dur;
}

/** Where to aim with no target: the area, or a few squares ahead of the caster. */
function aims(D) {
  if (D.targets.length) return D.targets;
  const o = D.sp.outcome ?? "neutral";
  if (D.area) { const [x, y] = D.ctx.areaCentroid(D.area); return [{ id: null, x, y, size: 1, h: 0.6, outcome: o }]; }
  const c = D.caster;
  return [{ id: null, x: (c?.x ?? 0) + D.face[0] * 3, y: (c?.y ?? 0) + D.face[1] * 3, size: 1, h: 0.6, outcome: o }];
}

/** The strongest outcome among the targets: what an area's flash and shock are sized by. */
function primary(D) {
  const P = D.ctx.POW;
  return D.targets.reduce((best, T) => (P[D.oc(T)] > P[best] ? D.oc(T) : best), D.sp.outcome ?? "neutral");
}

/** A burst where the effect points when it came with no area. */
function burstAt(D, r) {
  const T = aims(D)[0];
  return { shape: "burst", x: T.x, y: T.y, r };
}

/** The perpendicular to (ux, uy) that points toward the camera's side of the floor (+y). */
function sideOf(ux, uy) {
  let px = -uy, py = ux;
  if (py < 0 || (py === 0 && px < 0)) { px = -px; py = -py; }
  return [px, py];
}

function hitstop(s, t) { s.freeze = Math.max(s.freeze, t); s.impact = Math.max(s.impact, t); }

/**
 * Record where a flying head has been, for its wake (`p.wk`, oldest first).
 * Sampled every `hdt` seconds, never more than `max` points. Not `p.hist`:
 * a motif's carrier (motif-art.mjs `ride`) keeps its own record there.
 */
export function trackWake(p, dt, hdt = 1 / 60, max = 16) {
  p.wk ??= [];
  p.wkT = (p.wkT ?? hdt) + dt;
  if (p.wkT >= hdt) { p.wkT = 0; p.wk.push([p.x, p.y, p.z]); if (p.wk.length > max) p.wk.shift(); }
}

/**
 * What a flying head sheds every step (spellsprite-craft §2: light on
 * everything, real motion): a light riding it, air peeling off its sides as
 * speed lines, and sparks of its matter dropping out of the wake. `k` scales
 * the shedding; all of it but the light is minor.
 */
export function wakeFx(s, M, p, dt, k = 1) {
  const h = p.wk?.length ? p.wk[Math.max(0, p.wk.length - 3)] : null;
  if (!h) return;
  let dx = p.x - h[0], dy = p.y - h[1], dz = p.z - h[2];
  const l = Math.hypot(dx, dy, dz);
  if (l < 1e-4) return;
  dx /= l; dy /= l; dz /= l;
  const rs = (p.r ?? 5) / 26;
  p.lt = (p.lt ?? 1) + dt;
  if (p.lt >= 1 / 30) { p.lt = 0; s.light(p.x, p.y, p.z, 0.9 + rs * 4, S(M.R, 0.9), M.dark ? 0.4 : 0.65, 0.12, { flicker: M.flicker }); }
  for (let i = s.count(30 * k, dt); i > 0; i--) {
    const sg = s.R() < 0.5 ? -1 : 1, off = rs * s.rand(1.1, 2.1) * sg, sp = s.rand(5, 8);
    s.add({ k: "streak", x: p.x - dy * off - dx * rs, y: p.y + dx * off - dy * rs, z: p.z + s.rand(-0.04, 0.04), vx: -dx * sp, vy: -dy * sp, vz: -dz * sp, life: s.rand(0.07, 0.13), R: M.R, minor: true });
  }
  for (let i = s.count(26 * k, dt); i > 0; i--) {
    s.add({ k: "spark", x: p.x - dx * rs * 1.5, y: p.y - dy * rs * 1.5, z: p.z, vx: -dx * s.rand(0.5, 2.5) + s.rand(-1.4, 1.4), vy: -dy * s.rand(0.5, 2.5) + s.rand(-1.4, 1.4), vz: s.rand(-0.5, 1.5), g: 5, drag: 2.5, life: s.rand(0.18, 0.36), R: M.R, minor: true });
  }
}

/**
 * A travelling ball: compile.mjs's projectile, but drawn as a comet (a head
 * of 10+ px and a wake of a square or more, spellsprite-craft §1) and gone
 * through the motif's `carrier` so a named object can ride it (a skull, a coin).
 */
function shot(s, D, a, b, from, dur, arc, { r = 6, big = false, scale = 1, trail = 1, wake = null, hero = false, shed = 1 } = {}) {
  const { M } = D;
  const pos = (u) => [lerp(a[0], b[0], u), lerp(a[1], b[1], u), lerp(a[2], b[2], u) + Math.sin(Math.PI * u) * arc];
  s.at(from, (s2) => {
    const R0 = r * Math.min(1.5, s2.m);
    const p = s2.add({
      k: "dlComet", x: a[0], y: a[1], z: a[2], life: dur, R: M.R, dark: M.dark, r: R0, glow: true, big, hero, wake: wake ?? R0 * 5 + 18, seed: sd(s2),
      update(p2, s3, dt) {
        const u = clamp(p2.age / dur);
        trackWake(p2, dt);
        [p2.x, p2.y, p2.z] = pos(u); p2.tail = pos(Math.max(0, u - 0.09));
        M.mod.trail?.(s3, M, { x: p2.x, y: p2.y, z: p2.z, dt: dt * trail, scale });
        trailFlourish(s3, M, p2.x, p2.y, p2.z, dt * trail);
        wakeFx(s3, M, p2, dt, shed);
        const st = Math.floor(p2.age * 20);
        if (M.mod.projectileBolt && st !== p2.last) { p2.last = st; s3.add({ k: "dlArc", a, b: [p2.x, p2.y, p2.z], life: 0.06, R: M.R, seed: st * 7 + 1, w: 1, update: still }); }
      },
    });
    D.motif?.carrier?.(s2, M, p);
  });
}

/**
 * The contact every projectile and beam shares on top of the family's own
 * release: sparks thrown out round the point 1.2+ squares (spellsprite-craft
 * §1, 150–400 px/s), a floor ring and a hot pool. `k` scales it.
 */
export function contact(s, M, x, y, z, k = 1, { dir = null } = {}) {
  const n = Math.round(10 * k);
  for (let i = 0; i < n; i++) {
    let q = s.rand(0, TAU);
    if (dir && i % 2 === 0) q = Math.atan2(dir[1], dir[0]) + s.rand(-0.7, 0.7);
    const sp = s.rand(6, 13) * Math.min(1.4, k);
    s.add({ k: "spark", x, y, z, vx: Math.cos(q) * sp, vy: Math.sin(q) * sp, vz: s.rand(-1, 4), g: 9, drag: 2.2, bounce: 0.3, life: s.rand(0.22, 0.42), R: M.R, minor: i > 3 });
  }
  s.add({ k: "ring", x, y, r: 0.85 * k + 0.3, life: 0.36, R: M.R, seed: sd(s), update: still });
  s.light(x, y, z, 1.4 * k + 0.6, S(M.R, 0.9), M.dark ? 0.5 : 0.9, 0.3, { flicker: M.flicker });
}

/**
 * Keep the marks on top: particles draw in the order they were added, and a
 * release keeps adding smoke after the marks landed, which buried them. Until
 * `to`, every step moves the `front` particles to the end of the list.
 */
function front(s, to) {
  const from = s.dvFrontTo ?? -1;
  if (to <= from) return;
  s.dvFrontTo = to;
  s.emit(Math.max(s.t, from), to, (s2) => {
    let n = 0;
    for (const p of s2.parts) if (p.front) n++;
    if (!n) return;
    const head = [], tail = [];
    for (const p of s2.parts) (p.front ? tail : head).push(p);
    s2.parts = head.concat(tail);
  });
}

/**
 * The props' marks on a creature the effect reached. Cheap, one or two shapes
 * each, and never on an attack that missed.
 */
function marks(s, D, T, o) {
  const P = D.props, M = D.M;
  if (!P.size || (o === "miss" && D.attack)) return;
  const sz = Math.sqrt(T.size ?? 1);
  front(s, s.t + 2.2);
  const put = (p) => s.add(Object.assign(p, { front: true }));
  if (P.has("auditory")) for (let k = 0; k < 2; k++) put({ k: "halo", x: T.x, y: T.y, z: 0.62 * T.h, r: (0.38 + k * 0.24) * sz, life: 0.45, R: M.R, wait: k * 0.09, update: still });
  if (P.has("visual")) {
    s.add({ k: "flash", x: T.x, y: T.y, z: 0.9 * T.h, life: 2 / 12, r: 6 * sz, R: M.R, update: still });
    put({ k: "glint", x: T.x + 0.12, y: T.y - 0.05, z: 0.95 * T.h, life: 5 / 12, R: M.R, big: true, wait: 1 / 12, update: still });
  }
  if (P.has("linguistic")) for (let k = 0; k < 3; k++) {
    const q = (k / 3) * TAU + s.rand(-0.3, 0.3);
    put({ k: "dvWord", glyph: GLYPHS[(k + sd(s)) % GLYPHS.length], x: T.x + Math.cos(q) * 0.32 * sz, y: T.y + Math.sin(q) * 0.2 * sz, z: s.rand(0.55, 0.9) * T.h, vx: Math.cos(q) * 0.25, vy: Math.sin(q) * 0.15, vz: 0.55, drag: 1.5, life: 0.85, R: M.R, wait: k * 0.05 });
  }
  if (P.has("fear") || P.has("emotion")) put({ k: "dvWaver", x: T.x, y: T.y, z: 0.92 * T.h, sz, life: 1.3, R: M.R, seed: sd(s), wait: 0.08, update: still });
  if (P.has("death") && o === "crit") put({ k: "dvSkull", x: T.x, y: T.y, z: 1.2 * T.h, life: 1.1, R: RAMP.kinetic, wait: 0.12, update: still });
  if (P.has("incapacitation") && o !== "miss") put({ k: "dvDaze", x: T.x, y: T.y, z: 1.08 * T.h, sz, life: 1.6, R: M.R, wait: 0.1, update: still });
  if (P.has("healing")) for (let k = 0; k < 3; k++) put({ k: "mote", plus: true, x: T.x + s.rand(-0.25, 0.25) * sz, y: T.y + s.rand(-0.1, 0.1), z: s.rand(0.4, 0.8) * T.h, vz: s.rand(0.5, 0.8), g: -0.2, drag: 1.2, life: 0.9, R: M.R, wait: k * 0.08 });
  if (P.has("persistent") && o !== "miss") D.ctx.linger(s, M, T.x, T.y, 0.3 * sz, s.t + 0.25, s.t + 2.8);
}

/** One creature taking the effect: the release, the flinch, the motif's impact and residue, the marks. */
function land(s, D, T, o, from, { x = T.x - 0.08, y = T.y, z = 0.6 * T.h, rad = 0.4, k = 1, spray = 1 } = {}) {
  const pow = D.pw(o), M = D.M;
  D.ctx.release(s, M, x, y, z, D.rp(o, pow * k), rad);
  if (spray > 0) contact(s, M, x, y, z, spray * (o === "crit" ? 1.4 : 1) * Math.sqrt(T.size ?? 1), { dir: [x - from[0], y - from[1]] });
  s.hit(T.id, pow, { x: from[0], y: from[1] }, M.R);
  D.motif?.impact?.(s, M, { x, y, z, pow, rad, at: s.t });
  D.motif?.residue?.(s, M, { x: T.x, y: T.y, at: s.t + 0.35 });
  marks(s, D, T, o);
}

/** Every target inside an area is hit when its wave reaches it. */
function areaHits(s, D, G, from, start, shockDur, { burst = false } = {}) {
  const { M, ctx } = D;
  D.targets.forEach((T, i) => {
    const m = ctx.areaMetric(G, T.x, T.y), d = m ? m.d : 1, o = D.oc(T), pow = D.pw(o);
    s.at(start + d * shockDur * 0.95 + 0.02 * (i + 1), (s2) => {
      if (burst) M.mod.burst(s2, M, { x: T.x, y: T.y, z: 0.6 * T.h, pow: Math.min(pow, o === "crit" ? 1.3 : 0.8), rad: 0.35 });
      s2.hit(T.id, pow, { x: from[0], y: from[1] - 0.01 }, M.R);
      marks(s2, D, T, o);
    });
  });
}

/** The area's own landing: the motif's impact at its middle, its residue once the wave has passed. */
function areaMotif(s, D, x, y, z, pow, rad, at, after) {
  if (D.motif?.impact) s.at(at, (s2) => D.motif.impact(s2, D.M, { x, y, z, pow, rad, at }));
  if (D.motif?.residue) s.at(after, (s2) => D.motif.residue(s2, D.M, { x, y, at: after }));
}

/* ── ray: a beam from the hand that holds a few frames and lands ──────── */

function ray(s, M, ctx) {
  const D = prep(s, M, ctx), list = aims(D);
  const t0 = wind(D, 0, 0.4);
  let last = t0;
  list.forEach((T, i) => {
    const o = D.oc(T), at = t0 + i * 0.16, a = D.hand ?? [T.x - 2.2, T.y - 0.4, 1.4];
    const [ux, uy] = norm(T.x - a[0], T.y - a[1]), [px, py] = sideOf(ux, uy), sz = Math.sqrt(T.size ?? 1);
    const miss = o === "miss" && D.attack, crit = o === "crit";
    const hitP = [T.x - ux * 0.12 * sz, T.y - uy * 0.12 * sz, 0.6 * T.h];
    // a miss grazes over the shoulder and carries on past
    const end = miss ? [T.x + px * 0.45 * sz + ux * 1.8, T.y + py * 0.45 * sz + uy * 1.8, 1.3 * T.h] : hitP;
    // a beam a third of a square thick (crit half), not a streak: spellsprite-craft §1
    const hold = crit ? 0.55 : miss ? 0.32 : 0.45, w = (crit ? 4.6 : miss ? 2.2 : 3.4) * Math.min(1.4, s.m);
    s.at(at, (s2) => {
      const p = s2.add({ k: "dvRay", x: a[0], y: a[1], z: a[2], a, b: end, w, life: hold, R: M.R, dark: M.dark, seed: sd(s2), hit: !miss, update: still });
      D.motif?.carrier?.(s2, M, p);
      // a strip of light along the floor under the beam, not a row of pools
      const L = Math.hypot(end[0] - a[0], end[1] - a[1]), n = clamp(Math.ceil(L / 0.8), 3, 10);
      for (let k = 0; k < n; k++) { const f = (k + 0.5) / n; s2.light(lerp(a[0], end[0], f), lerp(a[1], end[1], f), lerp(a[2], end[2], f), 1.7, S(M.R, 0.88), M.dark ? 0.4 : 0.62, hold + 0.12, { flicker: M.flicker }); }
      s2.light(a[0], a[1], a[2], 1.6, S(M.R, 1), M.dark ? 0.4 : 0.9, hold + 0.05);
    });
    // the beam sheds its family's matter along its length while it holds, and throws sparks off its sides
    s.emit(at + 1 / 12, at + hold, (s2, _u, dt) => {
      const f = s2.rand(0.15, 1);
      M.mod.trail?.(s2, M, { x: lerp(a[0], end[0], f), y: lerp(a[1], end[1], f), z: lerp(a[2], end[2], f), dt: dt * 0.9 });
      for (let i = s2.count(46, dt); i > 0; i--) {
        const g = s2.rand(0.1, 1), sg = s2.R() < 0.5 ? -1 : 1, sp = s2.rand(2, 5);
        s2.add({ k: "spark", x: lerp(a[0], end[0], g), y: lerp(a[1], end[1], g), z: lerp(a[2], end[2], g), vx: px * sg * sp + ux * s2.rand(0, 2), vy: py * sg * sp + uy * s2.rand(0, 2), vz: s2.rand(-0.5, 2), g: 6, drag: 2.5, life: s2.rand(0.2, 0.38), R: M.R, minor: i > 1 });
      }
      if (M.mod.projectileBolt && s2.R() < 14 * dt) s2.add({ k: "dlArc", a, b: end, life: 0.07, R: M.R, seed: sd(s2), w: 1, update: still });
    });
    s.at(at + 2 / 12, (s2) => {
      if (miss) { ctx.release(s2, M, end[0], end[1], end[2], 0.3, 0.22); return; }
      land(s2, D, T, o, a, { x: hitP[0], y: hitP[1], z: hitP[2], rad: 0.45, k: crit ? 1 : 0.9 });
      if (crit) hitstop(s2, 1 / 12);
    });
    // the beam keeps pouring into the body while it holds: a second, smaller pop
    if (!miss) s.at(at + hold * 0.7, (s2) => contact(s2, M, hitP[0], hitP[1], hitP[2], 0.7, { dir: [ux, uy] }));
    if (crit) s.at(at + 2 / 12 + 0.16, (s2) => {
      // the beam surges: wider, white, and the second release
      s2.add({ k: "dvRay", x: a[0], y: a[1], z: a[2], a, b: hitP, w: w * 1.5, full: true, hit: true, life: 0.24, R: M.R, dark: M.dark, seed: sd(s2), update: still });
      ctx.release(s2, M, hitP[0], hitP[1], hitP[2], 1.6, 0.55);
      s2.add({ k: "star", x: hitP[0], y: hitP[1], z: hitP[2], L: 15 * Math.min(1.4, s2.m) * sz, life: 3 / 12, R: M.R, update: still });
      s2.hit(T.id, 1.6, { x: a[0], y: a[1] }, M.R);
    });
    if (!miss) ctx.linger(s, M, hitP[0], hitP[1], 0.35, at + 0.3, at + 1.8);
    last = at;
  });
  s.phases.push("beam", "hold", "land");
  s.period = last + 2.4;
}

/* ── orb: one projectile per target with the family's trail ───────────── */

function orb(s, M, ctx) {
  const D = prep(s, M, ctx);
  if (D.area && !D.targets.length) return lob(s, M, ctx);
  const list = aims(D), t0 = wind(D, 0, 0.4);
  let last = t0;
  list.forEach((T, i) => {
    const o = D.oc(T), t = t0 + i * 0.12, a = D.hand ?? [T.x - 1, T.y, 0.8];
    const aim = [T.x - 0.1, T.y, 0.62 * T.h], [ux, uy] = norm(T.x - a[0], T.y - a[1]);
    const miss = o === "miss" && D.attack;
    const end = miss ? [T.x + ux * 1.2 - uy * 1.4, T.y + uy * 1.2 + ux * 1.4, 0.8] : aim;
    const dist = Math.hypot(end[0] - a[0], end[1] - a[1]), dur = clamp(0.25 + dist * 0.035, 0.3, 0.7);
    // a ball you can see from across the table: 13 px across, a crit 16, a wake of 1.5 squares
    shot(s, D, a, end, t, dur, Math.min(0.6, dist * 0.04), { r: o === "crit" ? 8 : miss ? 5.5 : 6.5, hero: o === "crit" });
    s.at(t + dur, (s2) => {
      if (miss) { ctx.release(s2, M, end[0], end[1], end[2], 0.3, 0.25); contact(s2, M, end[0], end[1], end[2], 0.5); }
      else land(s2, D, T, o, a, { x: aim[0], y: aim[1], z: aim[2], rad: 0.5 });
    });
    ctx.linger(s, M, end[0], end[1], miss ? 0.25 : 0.45, t + dur, t + dur + 2);
    last = Math.max(last, t + dur);
  });
  s.phases.push("travel", "impact");
  s.period = last + 2.6;
}

/* ── darts: several small projectiles curving in on their own paths ───── */

function darts(s, M, ctx) {
  const D = prep(s, M, ctx), list = D.targets.length ? D.targets : null;
  const rank = clamp(D.sp.rank ?? 1, 1, 10);
  const n = D.has("minor") ? 3 : Math.min(7, 3 + Math.floor((rank - 1) / 2));
  const t0 = wind(D, 0, 0.36);
  const spot = !list && D.area ? ctx.spotIn(s, areaGeom(D.area)) : null;
  const pts = list ?? (spot ? Array.from({ length: n }, () => { const [x, y] = spot(); return { id: null, x, y, size: 1, h: 0.5, outcome: D.sp.outcome }; }) : aims(D));
  const per = new Map();
  let last = t0;
  for (let j = 0; j < n; j++) {
    const T = pts[j % pts.length], o = D.oc(T), t = t0 + j * 0.06;
    const a = D.hand ?? [T.x - 2, T.y - 0.3, 1.1], [ux, uy] = norm(T.x - a[0], T.y - a[1]), [px, py] = sideOf(ux, uy);
    const miss = o === "miss" && D.attack, sz = Math.sqrt(T.size ?? 1);
    const end = miss ? [T.x + px * 0.55 * sz + ux * 0.9, T.y + py * 0.55 * sz + uy * 0.9, 0.15] : [T.x - ux * 0.1, T.y - uy * 0.1, s.rand(0.45, 0.7) * T.h];
    const dist = Math.hypot(end[0] - a[0], end[1] - a[1]);
    // each dart leaves the hand on its own heading and curves in: alternate sides, fanned
    const side = (j % 2 ? 1 : -1) * (0.5 + 0.35 * Math.floor(j / 2) / Math.max(1, (n - 1) / 2));
    const ctl = [lerp(a[0], end[0], 0.4) + px * side * dist * 0.45, lerp(a[1], end[1], 0.4) + py * side * dist * 0.45, a[2] + 0.5 + s.rand(0, 0.5)];
    const dur = clamp(0.32 + dist * 0.03, 0.36, 0.7) + s.rand(0, 0.05);
    const bez = (u) => { const v = 1 - u; return [0, 1, 2].map((k) => v * v * a[k] + 2 * v * u * ctl[k] + u * u * end[k]); };
    s.at(t, (s2) => {
      // a magic missile: a 9 px orb with glints circling it and a ribbon of its curve behind it (pixelfx magic-missile)
      const p = s2.add({
        k: "dlComet", x: a[0], y: a[1], z: a[2], life: dur, R: M.R, dark: M.dark, r: (o === "crit" ? 5 : 4.2) * Math.min(1.3, s2.m), wake: 44, ww: 0.5, orbit: true, glow: true, seed: sd(s2), hero: o === "crit",
        update(p2, s3, dt) {
          const u = clamp(p2.age / dur);
          trackWake(p2, dt, 1 / 45, 14);
          [p2.x, p2.y, p2.z] = bez(u);
          M.mod.trail?.(s3, M, { x: p2.x, y: p2.y, z: p2.z, dt: dt * 0.3 });
          wakeFx(s3, M, p2, dt, 0.35);
        },
      });
      D.motif?.carrier?.(s2, M, p);
    });
    const lastFor = j + pts.length >= n;
    s.at(t + dur, (s2) => {
      if (miss) { ctx.release(s2, M, end[0], end[1], end[2], 0.25, 0.15); contact(s2, M, end[0], end[1], end[2], 0.35); return; }
      const pow = D.pw(o);
      if (lastFor) land(s2, D, T, o, a, { x: end[0], y: end[1], z: end[2], rad: o === "crit" ? 0.45 : 0.3, k: o === "crit" ? 1 : 0.7, spray: 0.8 });
      else { ctx.release(s2, M, end[0], end[1], end[2], D.rp(o, pow * 0.5), 0.2); contact(s2, M, end[0], end[1], end[2], 0.5, { dir: [ux, uy] }); s2.hit(T.id, pow * 0.6, { x: a[0], y: a[1] }, M.R); }
    });
    per.set(T, end);
    last = Math.max(last, t + dur);
  }
  for (const [T, end] of per) if (D.oc(T) !== "miss" || !D.attack) ctx.linger(s, M, end[0], end[1], 0.3, last, last + 1.6);
  s.phases.push(`${n} darts`, "curve in", "impacts");
  s.period = last + 2.4;
}

/* ── lob: the big ball arcs and bursts into the area wave ─────────────── */

function lob(s, M, ctx) {
  const D = prep(s, M, ctx), A = D.area ?? burstAt(D, 1);
  if (A.shape === "cone" || A.shape === "line") return pour(s, M, ctx);
  if (A.shape === "emanation" || A.shape === "aura") return emanation(s, M, ctx);
  const rad = Math.max(0.5, A.r ?? 1), prim = primary(D), pow = D.pw(prim), size = ctx.lobSize(rad);
  const t0 = wind(D, 0, 0.5, { size });
  const c = [A.x, A.y, 0.35];
  let landAt = t0;
  if (D.hand) {
    const dist = Math.hypot(c[0] - D.hand[0], c[1] - D.hand[1]), dur = clamp(0.35 + dist * 0.04, 0.45, 0.9);
    // a lob carries the whole area: it is drawn at a size that promises it (a fireball, not a spark)
    shot(s, D, D.hand, c, t0, dur, Math.min(2, 0.6 + dist * 0.12), { r: size, big: true, scale: size / 3, wake: size * 5 + 26, hero: prim === "crit", shed: 1.4 });
    landAt = t0 + dur;
    s.phases.push("lob");
  }
  const { G, shockDur } = ctx.areaFX(s, M, A, { tele0: Math.min(0.12, t0), hitAt: landAt, pow });
  s.at(landAt, (s2) => ctx.release(s2, M, c[0], c[1], c[2], D.rp(prim, pow * 1.1), Math.min(rad, 1.4)));
  areaMotif(s, D, c[0], c[1], c[2], pow, rad, landAt, landAt + shockDur);
  areaHits(s, D, G, c, landAt, shockDur);
  ctx.linger(s, M, c[0], c[1], ctx.equivRadius(G), landAt + shockDur, landAt + 2.8, ctx.spotIn(s, G));
  s.phases.push(`${A.shape} ${Math.round(rad * 5)} ft`, "linger");
  s.period = landAt + 3.6;
}

/* ── fall: a streak or column drops out of the sky, then the wave ─────── */

/** One drop from the sky onto (x, y) landing at `at`: a falling ball (a bolt for lightning) and a column of light. */
function column(s, D, x, y, at, rad, { small = false } = {}) {
  const M = D.M, sc = small ? 0.55 : 1, sky = 7;
  const drop = small ? 0.26 : 0.34;
  // the sky opens first: a thin shaft marks where it will come down
  if (!small) s.at(Math.max(0, at - drop - 0.12), (s2) => s2.add({ k: "beam", x, y, h: sky + 1, w: 3, life: drop + 0.14, R: M.R, update: still }));
  if (M.mod.projectileBolt) {
    // lightning has no head: the bolt itself is the fall, flickering down three times
    for (let k = 0; k < 3; k++) s.at(Math.max(0, at - 0.05 + k * 0.05), (s2) => s2.add({ k: "dlArc", a: [x + s2.rand(-0.3, 0.3), y - 0.4, sky], b: [x, y, 0.05], life: 0.08, R: M.R, seed: sd(s2), w: small ? 1 : 2, glow: true, r: 6, update: still }));
  } else {
    const r = small ? 4.5 : clamp(5 + rad * 1.6, 6, 11);
    shot(s, D, [x - 0.7 * sc, y - 0.35 * sc, sky], [x, y, 0.15], Math.max(0, at - drop), drop, 0, { r, big: !small, scale: r / 3, trail: small ? 0.5 : 1, shed: small ? 0.4 : 1 });
  }
  s.at(at, (s2) => {
    s2.add({ k: "beam", x, y, h: 6 * sc, w: (3.5 + Math.min(rad, 3) * 2) * sc * Math.min(1.3, s2.m), life: small ? 0.36 : 0.55, R: M.R, update: still });
    s2.add({ k: "ring", x, y, r: (rad * 0.8 + 0.5) * sc, life: 0.45, R: M.R, broken: true, seed: sd(s2), update: still });
    s2.add({ k: "ring", x, y, r: (rad * 0.45 + 0.3) * sc, life: 0.3, R: M.R, seed: sd(s2), update: still });
    if (small) { s2.minorScope = true; try { M.mod.burst(s2, M, { x, y, z: 0.15, pow: 0.6, rad: 0.45, sub: true }); } finally { s2.minorScope = false; } }
  });
}

function fall(s, M, ctx) {
  const D = prep(s, M, ctx), A = D.area;
  if (A && (A.shape === "cone" || A.shape === "line")) return pour(s, M, ctx);
  // the hand goes up: whatever comes is called down from the sky
  const up = D.caster ? [D.caster.x + D.face[0] * 0.12, D.caster.y - 0.05, 1.3 * D.caster.h] : null;
  const t0 = wind(D, 0, 0.45, {}, up), hitAt = t0 + 0.34;
  if (!A) {
    const list = aims(D);
    list.forEach((T, i) => {
      const at = hitAt + i * 0.1, o = D.oc(T);
      column(s, D, T.x, T.y, at, 0.5 * Math.sqrt(T.size ?? 1));
      s.at(at, (s2) => land(s2, D, T, o, [T.x, T.y - 1], { rad: 0.45 }));
      ctx.linger(s, M, T.x, T.y, 0.4, at + 0.2, at + 2);
    });
    s.phases.push("from above", "column");
    s.period = hitAt + (list.length - 1) * 0.1 + 2.6;
    return;
  }
  const rad = Math.max(0.5, A.r ?? 1), prim = primary(D), pow = D.pw(prim);
  const { G, shockDur } = ctx.areaFX(s, M, A, { tele0: Math.min(0.15, t0), hitAt, pow });
  column(s, D, A.x, A.y, hitAt, rad);
  // a big or hard fall brings more of it down: satellites inside the area
  const extra = Math.min(5, (D.has("major") ? 3 : 0) + (prim === "crit" ? 2 : 0) + (rad >= 3 ? 2 : 0));
  const spot = ctx.spotIn(s, G);
  for (let k = 0; k < extra; k++) { const [x, y] = spot(); column(s, D, x, y, hitAt + 0.08 * (k + 1), 0.5, { small: true }); }
  s.at(hitAt, (s2) => ctx.release(s2, M, A.x, A.y, 0.25, D.rp(prim, pow * 1.1), Math.min(rad, 1.4)));
  areaMotif(s, D, A.x, A.y, 0.25, pow, rad, hitAt, hitAt + shockDur);
  areaHits(s, D, G, [A.x, A.y], hitAt, shockDur);
  ctx.linger(s, M, A.x, A.y, ctx.equivRadius(G), hitAt + shockDur, hitAt + 2.8, spot);
  s.phases.push("from above", "column", `${A.shape} ${Math.round(rad * 5)} ft`);
  s.period = hitAt + 3.5;
}

/* ── burst: the ground stirs, then erupts (a hazard, a trap) ──────────── */

function burst(s, M, ctx) {
  const D = prep(s, M, ctx), A = D.area ?? burstAt(D, 1);
  if (A.shape === "cone" || A.shape === "line") return pour(s, M, ctx);
  const G0 = areaGeom(A), rad = extentOf(G0), prim = primary(D), pow = D.pw(prim);
  const t0 = D.caster ? wind(D, 0, 0.3) : 0, hitAt = t0 + 0.5;
  const spot = ctx.spotIn(s, G0);
  // grit hops off the floor and a glow swells up from under the area
  s.emit(t0 + 0.05, hitAt, (s2, u, dt) => {
    for (let i = s2.count(30 * (0.4 + u) * Math.min(2, rad), dt); i > 0; i--) {
      const [x, y] = spot();
      s2.add({ k: "chunk", x, y, z: 0.01, vz: s2.rand(0.8, 1.8), g: 9, life: 0.32, R: RAMP.kinetic, s: s2.R() < 0.3 ? 2 : 1, minor: i > 1 });
    }
    // cracks of the material's light stab up through the floor
    for (let i = s2.count(18 * u * Math.min(2, rad), dt); i > 0; i--) {
      const [x, y] = spot();
      s2.add({ k: "spark", x, y, z: 0.02, vx: s2.rand(-0.4, 0.4), vy: s2.rand(-0.3, 0.3), vz: s2.rand(3, 5), g: 9, drag: 1, life: 0.3, R: M.R, minor: true });
    }
  });
  s.at(t0 + 0.05, (s2) => s2.light(A.x, A.y, 0.1, rad * 1.3 + 0.8, S(M.R, 0.85), 0.9, hitAt - t0 - 0.05, { swell: true }));
  const { G, shockDur } = ctx.areaFX(s, M, A, { tele0: t0, hitAt, pow });
  // spouts: the area erupts from the floor up as the wave passes
  const { pts } = areaPoints(G, clamp(Math.round(4 + rad * 3), 5, 14), () => s.R());
  pts.forEach((pt, i) => s.at(hitAt + pt.d * shockDur * 0.95, (s2) => {
    s2.minorScope = i % 2 === 1;
    try {
      // a geyser of the material: a column a square and more high, sparks thrown up out of it, a floor ring
      s2.add({ k: "beam", x: pt.x, y: pt.y, h: s2.rand(2, 3.2) * Math.min(1.3, s2.m), w: s2.rand(3, 4.5), life: 0.4, R: M.R, update: still });
      s2.add({ k: "ring", x: pt.x, y: pt.y, r: s2.rand(0.45, 0.65), life: 0.32, R: M.R, broken: true, seed: sd(s2), update: still });
      for (let k = 0; k < 5; k++) s2.add({ k: "spark", x: pt.x, y: pt.y, z: 0.05, vx: s2.rand(-1.4, 1.4), vy: s2.rand(-1, 1), vz: s2.rand(5, 9), g: 9, drag: 0.5, life: s2.rand(0.4, 0.6), R: M.R, minor: k > 1 });
      s2.light(pt.x, pt.y, 0.6, 1.1, S(M.R, 0.9), 0.6, 0.35);
    } finally { s2.minorScope = false; }
  }));
  s.at(hitAt, (s2) => {
    // no column (that is a fall): the floor itself breaks and throws its grit up
    ctx.release(s2, M, A.x, A.y, 0.12, D.rp(prim, pow), Math.min(rad, 1.4));
    for (let k = 0; k < 14; k++) {
      const q = s2.rand(0, TAU), sp = s2.rand(0.8, 2.6);
      s2.add({ k: "chunk", x: A.x + Math.cos(q) * 0.25, y: A.y + Math.sin(q) * 0.25, z: 0.05, vx: Math.cos(q) * sp, vy: Math.sin(q) * sp, vz: s2.rand(4, 7.5), g: 9, drag: 0.6, bounce: 0.3, life: s2.rand(1.4, 2.2), R: RAMP.kinetic, s: k % 4 === 0 ? 3 : 2, wide: k % 3 === 0, debris: true, minor: k > 5 });
    }
  });
  areaMotif(s, D, A.x, A.y, 0.12, pow, rad, hitAt, hitAt + shockDur);
  areaHits(s, D, G, [A.x, A.y], hitAt, shockDur);
  ctx.linger(s, M, A.x, A.y, ctx.equivRadius(G), hitAt + shockDur, hitAt + 2.8, spot);
  s.phases.push("ground stirs", "eruption", `${G.shape} ${Math.round(rad * 5)} ft`);
  s.period = hitAt + 3.4;
}

/* ── cone, line, breath: a pour from the hand (or the mouth) ──────────── */

function pour(s, M, ctx, { breath = false } = {}) {
  const D = prep(s, M, ctx), c = D.caster;
  let A = D.area;
  if (!A || (A.shape !== "cone" && A.shape !== "line")) {
    if (A?.shape === "emanation" || A?.shape === "aura") return emanation(s, M, ctx, breath ? { windDur: 0.6 } : {});
    if (!c) return burst(s, M, ctx);
    // no cone placed: pour toward the first target, just past it
    const T = aims(D)[0], len = Math.max(2, Math.hypot(T.x - c.x, T.y - c.y) + 1);
    A = { shape: "cone", x: c.x, y: c.y, len, r: len, dir: Math.atan2(T.y - c.y, T.x - c.x) };
  }
  const prim = primary(D), pow = D.pw(prim);
  const mouth = breath ? headOf(D, 0.85, 0.35) : null;
  const origin = mouth ?? D.hand ?? [A.x, A.y, 0.6];
  let t0;
  if (breath && c) {
    // the rear-up: the head draws back and up, the feet dig in, then it all comes out at once
    const up = [origin[0] - D.face[0] * 0.25, origin[1] - D.face[1] * 0.25, origin[2] + 0.3];
    t0 = wind(D, 0, 0.62, { size: 4.5 }, up);
    s.at(0.38, (s2) => {
      for (let k = 0; k < 2; k++) s2.add({ k: "smoke", x: c.x - D.face[0] * 0.3 + s2.rand(-0.2, 0.2), y: c.y - D.face[1] * 0.3 + 0.2, z: 0.05, vx: -D.face[0] * 0.7, vy: -D.face[1] * 0.7, vz: 0.15, drag: 2, r: s2.rand(2, 3), life: 0.6, lobes: lobes(s2), tone: 0.5, minor: k > 0 });
    });
    s.at(t0, (s2) => { s2.shake = Math.max(s2.shake, 1.5); });
  } else t0 = wind(D, 0, 0.4);
  const flow = breath ? 0.95 : 0.55;
  const { G, shockDur } = ctx.areaFX(s, M, A, { tele0: 0, hitAt: t0, pow });
  ctx.spray(s, M, origin, A, t0, t0 + flow);
  if (breath) ctx.spray(s, M, origin, A, t0 + 0.1, t0 + flow);
  const L = A.len ?? 6, dir = A.dir ?? 0, far = [A.x + Math.cos(dir) * L, A.y + Math.sin(dir) * L, 0.45];
  const half = A.shape === "line" ? Math.atan2((A.width ?? 1) / 2, L) * 0.7 : (A.half ?? Math.PI / 4) * 0.9;
  // jets: hot streaks racing the length of the pour, the white-hot core near the source (pixelfx flamethrower)
  s.emit(t0, t0 + flow, (s2, u, dt) => {
    for (let i = s2.count((breath ? 90 : 70) * (1 - u * 0.4), dt); i > 0; i--) {
      const q = dir + s2.rand(-half, half) * s2.rand(0.3, 1), life = s2.rand(0.22, 0.34), sp = (L * s2.rand(0.75, 1)) / life;
      s2.add({ k: i % 3 ? "streak" : "spark", x: origin[0], y: origin[1], z: origin[2] - 0.15, vx: Math.cos(q) * sp, vy: Math.sin(q) * sp, vz: s2.rand(-0.6, 0.3), drag: 1.2, life, R: M.R, minor: i > 1 });
    }
  });
  // the hand or the mouth flares as the pour leaves it, and stays lit while it pours
  s.at(t0, (s2) => {
    s2.add({ k: "flash", x: origin[0], y: origin[1], z: origin[2], life: 2 / 12, r: breath ? 13 : 9, R: M.R, update: still });
    s2.add({ k: "star", x: origin[0], y: origin[1], z: origin[2], L: breath ? 12 : 9, life: 3 / 12, R: M.R, update: still });
    s2.light(origin[0], origin[1], origin[2], breath ? 2.2 : 1.6, S(M.R, 0.95), 1, flow, { flicker: M.flicker });
  });
  if (A.shape === "line") {
    // a line has a head: the front runs down the lane with the wave and leaves the family's wake
    shot(s, D, origin, far, t0, shockDur, 0, { r: breath ? 7 : 6, trail: 0.8, wake: 60, shed: 0.6 });
    s.at(t0 + shockDur, (s2) => { M.mod.burst(s2, M, { x: far[0], y: far[1], z: 0.3, pow: 0.6, rad: 0.45, sub: true }); contact(s2, M, far[0], far[1], 0.3, 0.8, { dir: [Math.cos(dir), Math.sin(dir)] }); });
  }
  areaHits(s, D, G, origin, t0, shockDur, { burst: true });
  if (breath) {
    // a breath keeps coming: everyone in it is hit again as the pour thins
    D.targets.forEach((T) => {
      const o = D.oc(T);
      if (o === "miss" || !ctx.areaMetric(G, T.x, T.y)) return;
      s.at(t0 + flow * 0.75, (s2) => { M.mod.burst(s2, M, { x: T.x, y: T.y, z: 0.5 * T.h, pow: 0.5, rad: 0.3, sub: true }); s2.hit(T.id, D.pw(o) * 0.6, { x: origin[0], y: origin[1] }, M.R); });
    });
  }
  const [cx, cy] = ctx.areaCentroid(A);
  areaMotif(s, D, cx, cy, 0.3, pow, ctx.equivRadius(G), t0 + shockDur * 0.6, t0 + shockDur);
  ctx.linger(s, M, cx, cy, ctx.equivRadius(G), t0 + shockDur, t0 + (breath ? 3.4 : 2.6), ctx.spotIn(s, G));
  if (breath) s.phases.push("rear up");
  s.phases.push(`${A.shape} ${breath ? "breath" : "spray"}`, "hits by distance", "linger");
  s.period = t0 + (breath ? 4 : 3.2);
}

/* ── emanation: a ring that expands out of the caster ─────────────────── */

function emanation(s, M, ctx, { windDur = 0.35 } = {}) {
  const D = prep(s, M, ctx), c = D.caster;
  const A = D.area ?? (c ? { shape: "emanation", x: c.x, y: c.y, r: 1.5 + (c.size ?? 1) / 2 } : burstAt(D, 2));
  const body = c ? [c.x, c.y, 0.55 * c.h] : [A.x, A.y, 0.5];
  const prim = primary(D), pow = D.pw(prim);
  const t0 = wind(D, 0, windDur, {}, body);
  const { G, shockDur } = ctx.areaFX(s, M, A, { tele0: Math.min(0.1, t0), hitAt: t0, pow });
  const r = extentOf(G), h = c?.h ?? 1;
  s.at(t0, (s2) => {
    // the body flares, then the wave stands up off the floor and runs out
    s2.add({ k: "flash", x: body[0], y: body[1], z: body[2], life: 2 / 12, r: 13 * Math.min(1.4, s2.m), R: M.R, update: still });
    s2.add({ k: "star", x: body[0], y: body[1], z: body[2], L: 12 * Math.min(1.4, s2.m), life: 3 / 12, R: M.R, update: still });
    s2.light(body[0], body[1], body[2], 1.8, S(M.R, 1), M.dark ? 0.5 : 1, 0.3);
    for (let k = 0; k < (prim === "crit" ? 3 : 2); k++) s2.add({ k: "dvPulse", x: A.x, y: A.y, r, h, life: shockDur * (1.4 + k * 0.45), wait: k * 0.09, R: M.R, seed: sd(s2), update: still });
    // the body throws sparks out with the wave, to its edge
    const n = Math.round(clamp(10 + r * 6, 14, 30));
    for (let k = 0; k < n; k++) {
      const q = (k / n) * TAU + s2.rand(-0.15, 0.15), sp = (r / (shockDur * 1.3)) * s2.rand(0.75, 1.05);
      s2.add({ k: "spark", x: A.x + Math.cos(q) * 0.3, y: A.y + Math.sin(q) * 0.3, z: s2.rand(0.1, 0.6) * h, vx: Math.cos(q) * sp, vy: Math.sin(q) * sp, vz: s2.rand(0, 2), g: 4, drag: 0.6, life: shockDur * 1.3, R: M.R, minor: k % 3 !== 0 });
    }
  });
  areaMotif(s, D, body[0], body[1], body[2], pow, r, t0, t0 + shockDur);
  areaHits(s, D, G, [A.x, A.y], t0, shockDur, { burst: true });
  ctx.linger(s, M, A.x, A.y, ctx.equivRadius(G), t0 + shockDur, t0 + 2.4, ctx.spotIn(s, G));
  s.phases.push("emanation", "pulse out");
  s.period = t0 + 3;
}

/* ── wall: it rises along its line, segment by segment ────────────────── */

/** The wall's footprint as segments in rising order: a line, a ring round a burst, or across the first target. */
function wallSegments(D) {
  const A = D.area, segs = [];
  const run = (x0, y0, dir, len) => {
    const n = Math.max(2, Math.round(len / 0.9)), c = Math.cos(dir), sn = Math.sin(dir);
    for (let i = 0; i < n; i++) {
      const f0 = (i / n) * len, f1 = ((i + 1) / n) * len;
      segs.push({ a: [x0 + c * f0, y0 + sn * f0], b: [x0 + c * f1, y0 + sn * f1], x: x0 + c * (f0 + f1) / 2, y: y0 + sn * (f0 + f1) / 2 });
    }
  };
  if (A && (A.shape === "line" || A.shape === "cone")) run(A.x, A.y, A.dir ?? 0, A.len ?? 6);
  else if (A) {
    const r = Math.max(0.8, A.r ?? 1), n = clamp(Math.round((TAU * r) / 0.9), 6, 24);
    for (let i = 0; i < n; i++) {
      const q0 = (i / n) * TAU, q1 = ((i + 1) / n) * TAU, qm = (q0 + q1) / 2;
      segs.push({ a: [A.x + Math.cos(q0) * r, A.y + Math.sin(q0) * r], b: [A.x + Math.cos(q1) * r, A.y + Math.sin(q1) * r], x: A.x + Math.cos(qm) * r, y: A.y + Math.sin(qm) * r });
    }
  } else {
    // no wall placed: one across the first target, square to the caster's aim
    const T = aims(D)[0], [px, py] = sideOf(D.face[0], D.face[1]);
    run(T.x - px * 2, T.y - py * 2, Math.atan2(py, px), 4);
  }
  return segs;
}

function wall(s, M, ctx) {
  const D = prep(s, M, ctx), segs = wallSegments(D);
  const t0 = wind(D, 0, 0.4), rise0 = t0 + 0.08, step = 0.065;
  const prim = primary(D), pow = D.pw(prim), solid = SOLID.has(M.family), h = 1.5 * Math.min(1.3, s.m);
  /* Only the footprint, marked during the wind-up: the wall itself is the
     event, and the area wave's floor flash drowns it from above. */
  const A = D.area;
  if (A?.shape === "line") s.add({ k: "lane", x: A.x, y: A.y, dir: A.dir ?? 0, len: A.len ?? 6, width: Math.max(0.6, A.width ?? 1), life: rise0 + segs.length * 0.065, R: M.R, update: still });
  else if (A) s.add({ k: "mark", x: A.x, y: A.y, r: Math.max(0.8, A.r ?? 1), life: rise0 + 0.4, R: M.R, update: still });
  segs.forEach((g, i) => s.at(rise0 + i * step, (s2) => {
    s2.add({ k: "dvWall", x: g.x, y: g.y, a: g.a, b: g.b, h, life: 2.6 - i * 0.02, R: M.R, dark: M.dark, ragged: !solid, seed: sd(s2), update: still });
    s2.minorScope = i % 2 === 1;
    try {
      M.mod.burst(s2, M, { x: g.x, y: g.y, z: 0.1, pow: 0.5, rad: 0.35, sub: true });
      // the crest throws sparks off as it shoots up
      for (let k = 0; k < 3; k++) s2.add({ k: "spark", x: g.x + s2.rand(-0.3, 0.3), y: g.y, z: h * 0.8, vx: s2.rand(-1.5, 1.5), vy: s2.rand(-0.8, 0.8), vz: s2.rand(3, 6), g: 9, drag: 1, life: s2.rand(0.35, 0.55), R: M.R, minor: true });
    } finally { s2.minorScope = false; }
    s2.light(g.x, g.y, 0.6, 1.5, S(M.R, 0.88), 0.62, 2.2, { flicker: M.flicker });
  }));
  // each creature is hit as the stretch of wall nearest it comes up
  D.targets.forEach((T) => {
    let j = 0, best = Infinity;
    segs.forEach((g, i) => { const d = Math.hypot(g.x - T.x, g.y - T.y); if (d < best) { best = d; j = i; } });
    if (best > 1.5) return;
    const o = D.oc(T);
    s.at(rise0 + j * step + 0.05, (s2) => {
      M.mod.burst(s2, M, { x: T.x, y: T.y, z: 0.6 * T.h, pow: Math.min(D.pw(o), o === "crit" ? 1.3 : 0.8), rad: 0.35 });
      s2.hit(T.id, D.pw(o), { x: segs[j].x, y: segs[j].y - 0.01 }, M.R);
      D.motif?.impact?.(s2, M, { x: T.x, y: T.y, z: 0.6 * T.h, pow: D.pw(o), rad: 0.35, at: s2.t });
      marks(s2, D, T, o);
    });
  });
  const mid = segs[Math.floor(segs.length / 2)], end = rise0 + segs.length * step;
  if (D.motif?.residue) s.at(end, (s2) => D.motif.residue(s2, M, { x: mid.x, y: mid.y, at: end }));
  ctx.linger(s, M, mid.x, mid.y, 1, rise0 + 0.3, end + 2, () => { const g = segs[Math.floor(s.R() * segs.length)], f = s.R(); return [lerp(g.a[0], g.b[0], f), lerp(g.a[1], g.b[1], f)]; });
  s.phases.push(`wall of ${segs.length}`, "rises in order");
  s.period = end + 2.8;
}

/* ── touch: hand to body, a contact flare, no projectile ──────────────── */

function touch(s, M, ctx) {
  const D = prep(s, M, ctx), list = aims(D), t0 = wind(D, 0, 0.25);
  let last = t0;
  list.forEach((T, i) => {
    const o = D.oc(T), at = t0 + 0.06 + i * 0.2, a = D.hand ?? [T.x - 0.8, T.y, 0.7];
    const [ux, uy] = norm(T.x - a[0], T.y - a[1]), [px, py] = sideOf(ux, uy), sz = Math.sqrt(T.size ?? 1);
    const miss = o === "miss" && D.attack, crit = o === "crit";
    const cp = miss ? [T.x - ux * 0.2 * sz + px * 0.45 * sz, T.y - uy * 0.2 * sz + py * 0.45 * sz, 0.85 * T.h] : [T.x - ux * 0.3 * sz, T.y - uy * 0.3 * sz, 0.6 * T.h];
    // the reach is the hand's motion, not a missile: three short speed lines into the touch
    s.at(Math.max(0, at - 0.09), (s2) => {
      // the reach: the hand's own motion as speed lines into the touch, and the matter gathering in the palm
      for (let k = 0; k < 5; k++) s2.add({ k: "streak", x: cp[0] - ux * 0.75 + px * (k - 2) * 0.09, y: cp[1] - uy * 0.75 + py * (k - 2) * 0.09, z: cp[2] + (k - 2) * 0.05, vx: ux * 9, vy: uy * 9, life: 0.08, R: M.R, minor: k !== 2 });
      s2.light(cp[0], cp[1], cp[2], 1.1, S(M.R, 0.9), 0.7, 0.1, { swell: true });
    });
    s.at(at, (s2) => {
      // a real contact burst: a white disc, rays thrown out past a square, sparks, a ring on the floor
      s2.add({ k: "dvTouch", x: cp[0], y: cp[1], z: cp[2], r: (miss ? 7 : crit ? 15 : 12) * Math.min(1.4, s2.m) * sz, life: 6 / 12, R: M.R, dark: M.dark, seed: sd(s2), update: still });
      if (miss) { ctx.release(s2, M, cp[0], cp[1], cp[2], 0.3, 0.2); contact(s2, M, cp[0], cp[1], cp[2], 0.45); return; }
      land(s2, D, T, o, a, { x: cp[0], y: cp[1], z: cp[2], rad: 0.4, k: crit ? 1 : 0.85, spray: 1.2 });
      s2.freeze = Math.max(s2.freeze, crit ? 0 : 1 / 30);
      if (crit) hitstop(s2, 1 / 12);
    });
    if (crit) s.at(at + 0.14, (s2) => {
      s2.add({ k: "dvTouch", x: cp[0], y: cp[1], z: cp[2], r: 21 * Math.min(1.4, s2.m) * sz, life: 6 / 12, R: M.R, dark: M.dark, seed: sd(s2), update: still });
      ctx.release(s2, M, T.x, T.y, 0.6 * T.h, 1.6, 0.5);
      s2.add({ k: "ring", x: T.x, y: T.y, r: 1.1 * (T.size ?? 1), life: 0.45, R: M.R, broken: true, seed: 5, update: still });
      s2.hit(T.id, 1.6, { x: a[0], y: a[1] }, M.R);
    });
    if (!miss) ctx.linger(s, M, cp[0], cp[1], 0.3, at + 0.2, at + 1.6);
    last = at;
  });
  s.phases.push("reach", "contact flare");
  s.period = last + 2.2;
}

/* ── gaze: the eyes flare, a glare reaches each target ────────────────── */

function gaze(s, M, ctx) {
  const D = prep(s, M, ctx), list = aims(D), c = D.caster;
  const eyes = headOf(D, 1.0, 0.18);
  // the wind-up gathers at the chest, so nothing covers the eyes
  const t0 = wind(D, 0, 0.28, {}, headOf(D, 0.55, 0.2));
  if (eyes) s.at(Math.max(0, t0 - 0.1), (s2) => {
    s2.add({ k: "dvEyes", x: eyes[0], y: eyes[1], z: eyes[2], sz: Math.sqrt(c.size ?? 1), life: 1, R: M.R, dark: M.dark, update: still });
    s2.light(eyes[0], eyes[1], eyes[2], 1.4, S(M.R, 0.95), 1, 0.6);
  });
  if (D.area) ctx.areaFX(s, M, D.area, { tele0: Math.min(0.1, t0), hitAt: t0 + 0.05, pow: D.pw(primary(D)), erupt: false, linger: 1.2 });
  list.forEach((T, i) => {
    const o = D.oc(T), at = t0 + 0.05 + i * 0.05, from = eyes ?? [T.x - 2, T.y - 0.5, 1.2], to = [T.x, T.y, 0.85 * T.h];
    const miss = o === "miss";
    s.at(at, (s2) => {
      s2.add({ k: "dvGlare", x: from[0], y: from[1], z: from[2], a: from, b: to, reach: miss ? 0.7 : 1, life: 0.45, R: M.R, dark: M.dark, update: still });
      const n = 4;
      for (let k = 0; k < n; k++) { const f = (k + 0.5) / n * (miss ? 0.7 : 1); s2.light(lerp(from[0], to[0], f), lerp(from[1], to[1], f), lerp(from[2], to[2], f), 1.2, S(M.R, 0.9), M.dark ? 0.35 : 0.5, 0.45); }
    });
    s.at(at + 0.12, (s2) => {
      if (miss && D.attack) {
        // looked away: the glare breaks short and spits a spark
        const f = 0.7, x = lerp(from[0], to[0], f), y = lerp(from[1], to[1], f), z = lerp(from[2], to[2], f);
        s2.add({ k: "glint", x, y, z, life: 5 / 12, R: M.R, update: still });
        return;
      }
      land(s2, D, T, o, from, { z: 0.82 * T.h, rad: 0.32, k: miss ? 0.6 : 0.85, spray: miss ? 0.5 : 0.8 });
      // the glare burns in: a ring round the head
      s2.add({ k: "halo", x: T.x, y: T.y, z: 0.85 * T.h, r: 0.55 * Math.sqrt(T.size ?? 1), life: 0.45, R: M.R, update: still });
    });
  });
  s.phases.push("eyes flare", "glare");
  s.period = t0 + (list.length - 1) * 0.05 + 2.4;
}

/* ── voice: sound rings or glyph-words out of the mouth ───────────────── */

function voice(s, M, ctx) {
  const D = prep(s, M, ctx), c = D.caster, A = D.area;
  const mouth = headOf(D, 0.8, 0.25);
  const t0 = wind(D, 0, 0.3, {}, mouth);
  const words = D.has("linguistic"), rings = !words || D.has("auditory");
  const m = Math.min(1.4, s.m);
  if (A) {
    const prim = primary(D), pow = D.pw(prim);
    const { G, shockDur } = ctx.areaFX(s, M, A, { tele0: Math.min(0.1, t0), hitAt: t0, pow });
    const fan = G.shape === "cone" || G.shape === "line";
    const ctr = fan ? (mouth ?? [G.x, G.y, 0.6]) : [G.x, G.y, c ? 0.6 * c.h : 0.5];
    const ext = extentOf(G);
    if (fan) {
      // a shout down a cone: arcs that open as they travel
      const dir = G.dir, to = [G.x + Math.cos(dir) * ext, G.y + Math.sin(dir) * ext, 0.5];
      const wide = G.shape === "cone" ? Math.tan(G.half) * ext : G.width / 2;
      for (let k = 0; k < 5; k++) s.at(t0 + k * 0.09, (s2) => s2.add({ k: "dvSound", x: ctr[0], y: ctr[1], z: ctr[2], from: ctr, to, r0: 5, r1: Math.min(44, wide * s2.spec.aps * 1.0), ux: Math.cos(dir), uy: Math.sin(dir), life: shockDur * 1.25, R: M.R, bands: 3, update: travel }));
    } else if (rings) {
      for (let k = 0; k < 4; k++) s.at(t0 + k * 0.11, (s2) => s2.add({ k: "dvPulse", x: G.x, y: G.y, r: ext, h: 0.45, life: shockDur * 1.3, R: M.R, seed: sd(s2), thin: k > 0, update: still }));
    }
    if (words) {
      const n = Math.round(clamp(4 + ext * 2, 5, 10));
      for (let k = 0; k < n; k++) {
        const q = fan ? G.dir + s.rand(-0.5, 0.5) * (G.shape === "cone" ? G.half * 2 : 0.2) : (k / n) * TAU;
        const to = [ctr[0] + Math.cos(q) * ext * 0.9, ctr[1] + Math.sin(q) * ext * 0.9, 0.5];
        s.at(t0 + k * 0.03, (s2) => s2.add({ k: "dvWord", glyph: GLYPHS[k % GLYPHS.length], x: ctr[0], y: ctr[1], z: ctr[2], from: ctr, to, wob: s2.rand(0, TAU), life: shockDur * 1.1, R: M.R, update: wordFly }));
      }
    }
    areaMotif(s, D, ctr[0], ctr[1], ctr[2], pow, ext, t0, t0 + shockDur);
    areaHits(s, D, G, ctr, t0, shockDur, { burst: true });
    s.phases.push(words ? "words" : "sound", `${G.shape} ${Math.round(ext * 5)} ft`);
    s.period = t0 + 2.8;
    return;
  }
  let last = t0;
  aims(D).forEach((T, i) => {
    const o = D.oc(T), from = mouth ?? [T.x - 2, T.y - 0.4, 1];
    const [ux, uy] = norm(T.x - from[0], T.y - from[1]), [px, py] = sideOf(ux, uy), miss = o === "miss" && D.attack;
    const to = miss ? [T.x + px * 0.6 + ux * 1.2, T.y + py * 0.6 + uy * 1.2, 0.9 * T.h] : [T.x - ux * 0.15, T.y - uy * 0.15, 0.7 * T.h];
    const dist = Math.hypot(to[0] - from[0], to[1] - from[1]), dur = clamp(0.2 + dist * 0.05, 0.28, 0.6), at = t0 + i * 0.1;
    if (rings) for (let k = 0; k < 4; k++) s.at(at + k * 0.08, (s2) => {
      const p = s2.add({ k: "dvSound", x: from[0], y: from[1], z: from[2], from, to, r0: 6, r1: (20 + k * 4) * m * Math.sqrt(T.size ?? 1), ux, uy, life: dur, R: M.R, bands: 3, glow: k === 0, update: travel });
      if (k === 0) D.motif?.carrier?.(s2, M, p);
    });
    if (words) for (let k = 0; k < 4; k++) s.at(at + 0.02 + k * 0.07, (s2) => {
      const p = s2.add({ k: "dvWord", glyph: GLYPHS[(i + k) % GLYPHS.length], x: from[0], y: from[1], z: from[2], from, to, wob: s2.rand(0, TAU), life: dur + 0.05, R: M.R, update: wordFly });
      if (k === 0 && !rings) D.motif?.carrier?.(s2, M, p);
    });
    s.at(at + dur, (s2) => {
      if (miss) { s2.add({ k: "halo", x: to[0], y: to[1], z: to[2], r: 0.45, life: 0.35, R: M.R, update: still }); return; }
      land(s2, D, T, o, from, { x: to[0], y: to[1], z: to[2], rad: 0.4, k: 0.8, spray: 0.7 });
      // the sound shakes the body: rings round it, a beat apart
      for (let k = 0; k < 2; k++) s2.add({ k: "halo", x: T.x, y: T.y, z: 0.6 * T.h, r: (0.6 + k * 0.3) * Math.sqrt(T.size ?? 1), life: 0.4, R: M.R, wait: 0.1 + k * 0.1, update: still });
    });
    last = Math.max(last, at + dur);
  });
  if (rings) s.phases.push("sound rings");
  if (words) s.phases.push("words");
  s.phases.push("to the target");
  s.period = last + 2.2;
}

/** Moves a particle from `from` to `to` over its life and grows it from r0 to r1. */
function travel(p) {
  const u = clamp(p.age / p.life), e = easeOut(u);
  p.x = lerp(p.from[0], p.to[0], u); p.y = lerp(p.from[1], p.to[1], u); p.z = lerp(p.from[2], p.to[2], u);
  p.r = lerp(p.r0, p.r1, e);
}

/** A word flying from `from` to `to`, weaving as it goes. */
function wordFly(p) {
  const u = clamp(p.age / p.life), w = Math.sin(u * TAU + p.wob) * 0.22;
  const dx = p.to[0] - p.from[0], dy = p.to[1] - p.from[1], l = Math.hypot(dx, dy) || 1;
  p.x = lerp(p.from[0], p.to[0], u) - (dy / l) * w; p.y = lerp(p.from[1], p.to[1], u) + (dx / l) * w;
  p.z = lerp(p.from[2], p.to[2], u) + Math.cos(u * TAU * 1.5 + p.wob) * 0.12;
}

/* ── breath: a heavier, longer pour from the mouth ────────────────────── */

const breath = (s, M, ctx) => pour(s, M, ctx, { breath: true });

/* ── aura: a persistent pulse round the creature ──────────────────────── */

function aura(s, M, ctx) {
  const D = prep(s, M, ctx), c = D.caster;
  const A = D.area ?? (c ? { shape: "emanation", x: c.x, y: c.y, r: 1.5 + (c.size ?? 1) / 2 } : burstAt(D, 1.5));
  const G = areaGeom(A), r = extentOf(G), prim = primary(D), pow = D.pw(prim), h = c?.h ?? 1;
  // an aura is always there: a soft footprint, never a blast
  ctx.areaFX(s, M, A, { tele0: 0, hitAt: 0.15, pow, gentle: true, erupt: false, linger: 2.4 });
  // three slow beats: the aura breathes out round its creature
  [0.15, 1.0, 1.85].forEach((t, k) => s.at(t, (s2) => {
    s2.add({ k: "dvPulse", x: A.x, y: A.y, r, h: h * 0.8, life: 0.85, R: M.R, seed: sd(s2), soft: k === 2, update: still });
    s2.light(A.x, A.y, 0.4, r * 1.2 + 0.8, S(M.R, 0.88), k ? 0.6 : 0.9, 0.75, { flicker: M.flicker });
    if (c) for (let j = 0; j < 2; j++) s2.add({ k: "halo", x: c.x, y: c.y, z: (0.35 + j * 0.3) * c.h, r: (0.55 + j * 0.15) * Math.sqrt(c.size ?? 1), life: 0.55, R: M.R, wait: j * 0.08, update: still });
  }));
  areaMotif(s, D, A.x, A.y, 0.3, pow, r, 0.15, 1.2);
  areaHits(s, D, G, [A.x, A.y], 0.15, 0.45, { burst: true });
  ctx.linger(s, M, A.x, A.y, ctx.equivRadius(G), 0.2, 2.6, ctx.spotIn(s, G));
  s.phases.push("aura", "three beats");
  s.period = 3;
}

/* ── bloom: it opens on the target itself, from inside it out ─────────── */

function bloom(s, M, ctx) {
  const D = prep(s, M, ctx), list = aims(D), t0 = wind(D, 0, 0.35);
  if (D.area && D.targets.length) ctx.areaFX(s, M, D.area, { tele0: Math.min(0.1, t0), hitAt: t0 + 0.17, pow: D.pw(primary(D)), erupt: false, linger: 1.6 });
  let last = t0;
  list.forEach((T, i) => {
    const o = D.oc(T), at = t0 + i * 0.1, sz = Math.sqrt(T.size ?? 1), ctr = [T.x, T.y, 0.55 * T.h], from = D.hand ?? [T.x - 1, T.y, 0.8];
    const crit = o === "crit", saved = o === "miss";
    // marked: the floor under it is chosen before anything happens to it
    s.at(Math.max(0, at - 0.3), (s2) => s2.add({ k: "mark", x: T.x, y: T.y, r: 0.65 * (T.size ?? 1), life: 0.55, R: M.R, update: still }));
    // drawn in: matter gathers inside the body
    s.at(at, (s2) => {
      for (let k = 0; k < 12; k++) {
        const q = (k / 12) * TAU, d = 0.85 * sz;
        s2.add({ k: "streak", x: ctr[0] + Math.cos(q) * d, y: ctr[1] + Math.sin(q) * d * 0.6, z: ctr[2] + Math.sin(q) * 0.25, vx: -Math.cos(q) * d / 0.16, vy: -Math.sin(q) * d * 0.6 / 0.16, vz: -Math.sin(q) * 0.25 / 0.16, life: 0.16, R: M.R, minor: k % 2 === 1 });
      }
      s2.light(ctr[0], ctr[1], ctr[2], 1.3, S(M.R, 0.9), 0.85, 0.2, { swell: true });
    });
    const b = at + 0.17;
    // the spokes open first; the matter bursts out along them a frame later
    s.at(b, (s2) => s2.add({ k: "dvBloom", x: ctr[0], y: ctr[1], z: ctr[2], r: (crit ? 24 : saved ? 13 : 20) * Math.min(1.4, s2.m) * sz, n: saved ? 6 : 10, life: 0.6, R: M.R, dark: M.dark, seed: sd(s2), update: still }));
    s.at(b + 1 / 12, (s2) => {
      land(s2, D, T, o, from, { x: ctr[0], y: ctr[1], z: ctr[2], rad: saved ? 0.28 : 0.4, k: saved ? 0.55 : 0.75, spray: saved ? 0.6 : 1 });
      if (crit) hitstop(s2, 1 / 12);
    });
    if (crit) s.at(b + 0.15, (s2) => {
      s2.add({ k: "dvBloom", x: ctr[0], y: ctr[1], z: ctr[2], r: 28 * Math.min(1.4, s2.m) * sz, n: 12, life: 0.5, R: M.R, dark: M.dark, seed: sd(s2), update: still });
      ctx.release(s2, M, ctr[0], ctr[1], ctr[2], 1.6, 0.5);
      s2.hit(T.id, 1.6, { x: from[0], y: from[1] }, M.R);
    });
    ctx.linger(s, M, T.x, T.y, saved ? 0.25 : 0.4, b + 0.2, b + 1.8);
    last = b;
  });
  s.phases.push("marked", "drawn in", "bloom");
  s.period = last + 2.3;
}

export const HARM = {
  ray, orb, darts, lob, fall, burst,
  cone: (s, M, ctx) => pour(s, M, ctx),
  line: (s, M, ctx) => pour(s, M, ctx),
  emanation: (s, M, ctx) => emanation(s, M, ctx),
  wall, touch, gaze, voice, breath, aura, bloom,
};

/* ── the shapes only these deliveries draw ────────────────────────────── */

const SKULL = [".###.", "#####", "#.#.#", "#####", ".#.#."];

registerShapes({
  /**
   * A beam from `a` to `b`: it reaches the end in two frames, holds at full
   * width with a flickering ragged rim, and thins out over its last two.
   */
  dvRay(v, P, p) {
    const fr = Math.floor(p.age * 12), n = Math.max(2, Math.round(p.life * 12)), left = n - 1 - fr;
    const ext = p.full ? 1 : Math.min(1, (fr + 1) / 2);
    const [ax, ay] = v.ap(p.a[0], p.a[1], p.a[2]), [ex, ey] = v.ap(p.b[0], p.b[1], p.b[2]);
    const bx = ax + (ex - ax) * ext, by = ay + (ey - ay) * ext, L = Math.hypot(bx - ax, by - ay);
    if (L < 1) return;
    const sx = (bx - ax) / L, sy = (by - ay) / L, nx = -sy, ny = sx;
    const env = fr === 0 ? 0.45 : left <= 0 ? 0.3 : left === 1 ? 0.65 : 1;
    const W = p.w * env * (1 + 0.14 * ((fr + p.seed) & 1)), hot = fr <= 1 && !p.dark, dark = !!p.dark;
    // a pulse of light running down the core from the hand to the end, twice a hold
    const pulse = ((p.age * 6) % 1) * L;
    // the body: a hot core, a lit middle, a ragged flickering rim; the core thins near the hand
    for (let k = -W - 1; k <= W + 1.01; k += 0.5) {
      const e = Math.abs(k) / (W + 1);
      const c = dark ? (e < 0.55 ? S(p.R, 0.05) : e < 0.8 ? S(p.R, 0.62) : S(p.R, 0.9)) : e < 0.32 ? (hot ? WHITE : S(p.R, 1)) : e < 0.62 ? S(p.R, 0.88) : e < 0.82 ? S(p.R, 0.72) : S(p.R, 0.55);
      const seed = p.seed + Math.round(k * 2);
      const fn = e >= 0.62
        ? (_f, i) => (hash(i >> 1, fr, seed) < 0.28 ? null : c)
        : e < 0.32 && !dark ? (f) => (Math.abs(f * L - pulse) < 3 ? WHITE : c) : () => c;
      P.line(ax + nx * k, ay + ny * k, bx + nx * k, by + ny * k, null, 1, 1, fn);
    }
    // two strands winding round the beam, outside it: the energy it is made of
    const amp = W + 2.5, lam = 22;
    for (let i = 0; i <= L; i++) {
      const q = (i / lam) * TAU - p.age * 26, y1 = Math.sin(q) * amp, fade = Math.min(1, i / 6);
      if (fade < 0.5) continue;
      const front = Math.cos(q) > 0;
      P.px(ax + sx * i + nx * y1, ay + sy * i + ny * y1, S(p.R, front ? (dark ? 0.85 : 1) : 0.62), front ? 1 : 0);
      P.px(ax + sx * i - nx * y1, ay + sy * i - ny * y1, S(p.R, !front ? (dark ? 0.85 : 0.95) : 0.55), !front ? 1 : 0);
    }
    // rings of air shearing off the end and sliding back up the beam (pixelfx ice-lance)
    for (let r = 0; r < 3; r++) {
      const u = (p.age * 3 + r / 3) % 1; if (u > 0.85) continue;
      const cx = bx - sx * u * L * 0.8, cy = by - sy * u * L * 0.8, ry = W + 2 + u * 7, rx = 1.2 + u * 2;
      for (let j = 0; j < 28; j++) {
        const an = (j / 28) * TAU, ca = Math.cos(an), sa = Math.sin(an);
        if (Math.abs(sa) * ry < W + 0.5) continue;
        P.dot(cx + sx * ca * rx + nx * sa * ry, cy + sy * ca * rx + ny * sa * ry, S(p.R, ca > 0 ? (u < 0.35 && !dark ? 1 : 0.9) : 0.66), 1 - u, 1);
      }
    }
    // the source flares where the beam leaves the hand: a star of rays
    const fl = Math.round(W + 4), sc = S(p.R, dark ? 0.85 : 1);
    for (let i = -fl; i <= fl; i++) { P.px(ax + i, ay, sc, 1); P.px(ax, ay + i, sc, 1); }
    for (let i = -Math.round(fl * 0.6); i <= Math.round(fl * 0.6); i++) { P.px(ax + i, ay + i, S(p.R, 0.85), 1); P.px(ax + i, ay - i, S(p.R, 0.85), 1); }
    // and splashes where it lands: a hot disc wider than the beam, rays round it
    if (p.hit && ext >= 1) {
      const R2 = W + 3 + (fr & 1), hc = hot ? WHITE : dark ? S(p.R, 0.05) : S(p.R, 1);
      P.shade(bx - R2 - 1, by - R2 - 1, bx + R2 + 1, by + R2 + 1, (x, y) => {
        const d = Math.hypot(x - bx, y - by); if (d > R2) return null;
        return d < R2 * 0.5 ? hc : d > R2 - 1.2 ? S(p.R, 0.7) : S(p.R, dark ? 0.85 : 0.95);
      }, 1);
      for (let k = 0; k < 8; k++) {
        const q = (k / 8) * TAU + fr * 0.4, r0 = R2 + 1, r1 = R2 + (k & 1 ? 4 : 8);
        P.line(bx + Math.cos(q) * r0, by + Math.sin(q) * r0, bx + Math.cos(q) * r1, by + Math.sin(q) * r1, null, 1, 1, (f) => S(p.R, f < 0.5 ? 1 : 0.75));
      }
    }
  },

  /**
   * A flying head and its wake. The head is a ball swept back along its
   * flight (white-hot heart on a crit, a dark core for a dark material, a dark
   * rim and churn on a `big` one so it reads as a ball on either floor); the
   * wake is a ribbon along where it has been (`wk`, oldest first), `r` wide at
   * the head, tapering and cooling over `wake` art px and breaking into
   * flicker at its end. `orbit`: glints circling the head (a magic missile).
   */
  dlComet(v, P, p) {
    const fr = Math.floor(p.age * 12), [hx, hy] = v.ap(p.x, p.y, p.z), r = p.r, dark = !!p.dark;
    const pts = [[hx, hy]], cum = [0];
    let Lw = 0;
    const wk = p.wk ?? [];
    for (let i = wk.length - 1; i >= 0 && Lw < p.wake; i--) {
      const q = v.ap(wk[i][0], wk[i][1], wk[i][2]), l0 = pts[pts.length - 1], d = Math.hypot(q[0] - l0[0], q[1] - l0[1]);
      if (d < 0.5) continue;
      Lw += d; pts.push(q); cum.push(Lw);
    }
    Lw = Math.min(Lw, p.wake);
    // flight direction on screen, for the swept head
    let ux = 1, uy = 0;
    if (pts.length > 1) { const dx = hx - pts[1][0], dy = hy - pts[1][1], l = Math.hypot(dx, dy); if (l > 0.3) { ux = dx / l; uy = dy / l; } }
    let x0 = hx - r * 1.6 - 2, y0 = hy - r * 1.6 - 2, x1 = hx + r * 1.6 + 2, y1 = hy + r * 1.6 + 2;
    for (const q of pts) { x0 = Math.min(x0, q[0] - r - 1); y0 = Math.min(y0, q[1] - r - 1); x1 = Math.max(x1, q[0] + r + 1); y1 = Math.max(y1, q[1] + r + 1); }
    const n = pts.length, big = p.big && r >= 4, heart = p.hero && fr < 3;
    P.shade(x0, y0, x1, y1, (x, y) => {
      const rx = x - hx, ry = y - hy, dh = Math.hypot(rx, ry);
      // the head, swept back: its rim reaches further behind than ahead
      const back = dh > 0 ? Math.max(0, -(rx * ux + ry * uy) / dh) : 0, rim = r * (1 + 0.5 * back * back);
      if (dh <= rim) {
        const d = dh / rim;
        if (dark) return d < 0.7 ? S(p.R, 0) : S(p.R, 0.85);
        if (d > 1 - 1.2 / rim) return big ? S(p.R, 0.42) : S(p.R, 0.7);
        if (d < 0.3) return heart ? WHITE : S(p.R, 1);
        const churn = big ? hash(Math.floor((rx + fr * 1.7) / 2), Math.floor((ry - fr * 1.3) / 2), 7) : 0;
        return S(p.R, 0.95 - d * 0.36 - back * 0.14 - (churn > 0.62 ? 0.14 : 0));
      }
      if (n < 2 || Lw < 1) return null;
      // the wake: nearest point of the flown path, and how far back along it
      let best = 1e9, at = 0;
      for (let i = 1; i < n; i++) {
        const a = pts[i - 1], b = pts[i], ex = b[0] - a[0], ey = b[1] - a[1], ll = ex * ex + ey * ey;
        let t = ll > 0 ? ((x - a[0]) * ex + (y - a[1]) * ey) / ll : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const qx = a[0] + ex * t - x, qy = a[1] + ey * t - y, d2 = qx * qx + qy * qy;
        if (d2 < best) { best = d2; at = cum[i - 1] + (cum[i] - cum[i - 1]) * t; }
      }
      const f = at / Lw;
      if (f >= 1) return null;
      const w = r * (p.ww ?? 0.85) * (1 - f) ** 0.7 * (0.85 + 0.3 * hash(Math.floor(at / 3), fr, p.seed)) + 0.6, d = Math.sqrt(best);
      if (d > w) return null;
      if (f > 0.5 && hash(Math.floor(at / 2), Math.floor(d), fr + p.seed) < (f - 0.5) * 1.5) return null;
      const e = d / w;
      if (dark) return e < 0.55 ? S(p.R, 0.05 + f * 0.2) : S(p.R, 0.75 - f * 0.25);
      return S(p.R, e < 0.34 && f < 0.25 ? 1 : e < 0.4 ? 0.88 - f * 0.2 : e < 0.75 ? 0.75 - f * 0.25 : 0.6 - f * 0.2);
    }, 1);
    if (heart || !dark) P.px(hx, hy, heart ? WHITE : S(p.R, 1), 2);
    if (p.orbit) for (let i = 0; i < 3; i++) {
      const q = p.age * 14 + (i * TAU) / 3;
      P.px(hx + Math.cos(q) * (r + 3), hy + Math.sin(q) * (r + 3) * 0.6, S(p.R, i ? 0.95 : 1), 2);
    }
  },

  /**
   * Lightning thick enough to read at 1x: a jagged eight-way path (re-rolled
   * on a 20 fps clock) drawn `w` px wide with a coloured halo under it and
   * branches forking off; white on its first frames.
   */
  dlArc(v, P, p) {
    const fr = Math.floor(p.age * 20), r = rng(p.seed * 31 + fr);
    let [x, y] = v.ap(...p.a); const [tx, ty] = v.ap(...p.b);
    x = Math.round(x); y = Math.round(y);
    const X = Math.round(tx), Y = Math.round(ty), path = [[x, y]];
    for (let g = 0; g < 900 && (Math.abs(X - x) > 1 || Math.abs(Y - y) > 1); g++) {
      let di = Math.round(Math.atan2(Y - y, X - x) / (TAU / 8));
      const rv = r(); if (rv < 0.22) di--; else if (rv > 0.78) di++;
      const d = DIRS8[((di % 8) + 8) % 8], run = 1 + Math.floor(r() * 3);
      for (let s = 0; s < run; s++) { x += d[0]; y += d[1]; path.push([x, y]); }
    }
    const a = fadeOut(p.age / p.life, 0.6), hot = Math.floor(p.age * 12) < 1, w = p.w ?? 2;
    const core = hot ? WHITE : S(p.R, 1), mid = S(p.R, 0.9), halo = S(p.R, 0.62);
    for (const [px, py] of path) {
      P.dot(px, py, core, a, 2);
      if (w >= 2) { P.dot(px + 1, py, mid, a, 1); P.dot(px, py + 1, mid, a, 1); }
    }
    for (const [px, py] of path) for (const [dx, dy] of PLUS) { P.under(px + dx * (w >= 2 ? 2 : 1), py + dy * (w >= 2 ? 2 : 1), halo); P.under(px + dx, py + dy, halo); }
    for (let b = 0; b < 3 && path.length > 6; b++) {
      let [bx, by] = path[2 + Math.floor(r() * (path.length - 4))];
      const d = DIRS8[Math.floor(r() * 8)], L = 4 + Math.floor(r() * 8);
      for (let s = 0; s < L; s++) { const d2 = r() < 0.3 ? DIRS8[Math.floor(r() * 8)] : d; bx += d2[0]; by += d2[1]; P.dot(bx, by, s < L / 2 ? mid : halo, a, 1); }
    }
  },

  /**
   * One stretch of a wall standing on the floor from `a` to `b`: it shoots up
   * in three frames (white crest on the way), stands, and sinks at the end.
   * `ragged`: fire and its kin flicker along the top; ice and stone stand flat.
   */
  dvWall(v, P, p) {
    const fr = Math.floor(p.age * 12), u = p.age / p.life;
    const rise = Math.min(1, (fr + 1) / 3), sink = u > 0.85 ? (1 - u) / 0.15 : 1, H = p.h * rise * sink;
    if (H <= 0.02) return;
    const [ax, ay] = v.ap(p.a[0], p.a[1], 0), [bx, by] = v.ap(p.b[0], p.b[1], 0), hp = ay - v.ap(p.a[0], p.a[1], H)[1];
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(bx - ax), Math.abs(by - ay))));
    const crest = fr < 3 && !p.dark ? WHITE : S(p.R, p.dark ? 0.85 : 0.98);
    for (let i = 0; i <= n; i++) {
      const x = Math.floor(ax + ((bx - ax) * i) / n), y = Math.floor(ay + ((by - ay) * i) / n);
      const top = Math.max(1, Math.round(hp * (p.ragged ? 0.72 + 0.4 * hash(i >> 1, fr, p.seed) : (i >> 1) % 3 === 2 ? 0.86 : 1)));
      for (let j = 0; j < top; j++) {
        const f = j / top;
        const c = j >= top - 1 ? crest : p.dark ? S(p.R, f > 0.6 ? 0.35 : 0.1) : f > 0.66 ? S(p.R, 0.82) : f > 0.25 ? S(p.R, 0.62) : S(p.R, 0.42);
        P.px(x, y - j, c, 1);
      }
    }
  },

  /** A contact flare: a white disc on contact, then rays thrown out round it. */
  dvTouch(v, P, p) {
    const fr = Math.floor(p.age * 12); if (fr > 5) return;
    const [x, y] = v.ap(p.x, p.y, p.z), r = p.r * [0.55, 1, 1.25, 1.4, 1.5, 1.55][fr], a = fr < 3 ? 1 : (6 - fr) / 4;
    if (fr < 3) {
      // the white disc on contact, a ring of the material round it while it cools
      const d0 = r * [0.6, 0.42, 0.3][fr];
      P.shade(x - d0 - 2, y - d0 - 2, x + d0 + 2, y + d0 + 2, (px, py) => {
        const d = Math.hypot(px - x, py - y); if (d > d0 + 1.5) return null;
        if (d > d0) return S(p.R, p.dark ? 0.85 : 0.9);
        return p.dark ? S(p.R, 0.05) : fr === 0 ? WHITE : S(p.R, 1);
      }, 2);
    }
    // twelve rays, two pixels thick, thrown out round it in two lengths
    for (let k = 0; k < 12; k++) {
      const q = (k / 12) * TAU + (fr & 1) * 0.13 + p.seed * 0.01, r0 = r * (fr < 2 ? 0.45 : 0.62), r1 = r * (k % 3 ? 0.72 : 1.05);
      const c = (f) => S(p.R, f > 0.6 ? (fr < 2 ? 1 : 0.85) : 0.65), x0 = x + Math.cos(q) * r0, y0 = y + Math.sin(q) * r0, x1 = x + Math.cos(q) * r1, y1 = y + Math.sin(q) * r1;
      P.line(x0, y0, x1, y1, null, 1, a, c);
      if (k % 3 === 0) { const [ox, oy] = Math.abs(x1 - x0) > Math.abs(y1 - y0) ? [0, 1] : [1, 0]; P.line(x0 + ox, y0 + oy, x1 + ox, y1 + oy, null, 1, a, (f) => (f > 0.85 ? null : c(f))); }
    }
  },

  /** Two eyes: slits that flare white with a glint across them, then burn in the ramp. */
  dvEyes(v, P, p) {
    const fr = Math.floor(p.age * 12), [x, y] = v.ap(p.x, p.y, p.z), u = p.age / p.life, a = fadeOut(u, 0.6);
    const gap = Math.max(2, Math.round(3 * (p.sz ?? 1))), lit = p.dark ? S(p.R, 0.95) : fr < 2 ? WHITE : S(p.R, 1);
    for (const sx of [-1, 1]) {
      const ex = x + sx * gap;
      // an almond: four across, the outer corner tipped up, a lit lid under it
      P.dot(ex, y, lit, a, 2); P.dot(ex + sx, y, lit, a, 2); P.dot(ex + sx * 2, y, lit, a, 2); P.dot(ex + sx * 3, y - 1, lit, a, 2);
      P.dot(ex, y - 1, S(p.R, 0.85), a, 1); P.dot(ex + sx, y - 1, lit, a, 2);
      P.dot(ex, y + 1, S(p.R, 0.7), a, 1); P.dot(ex + sx, y + 1, S(p.R, 0.62), a, 1); P.dot(ex + sx * 2, y + 1, S(p.R, 0.5), a, 1);
    }
    if (fr < 4) {
      // the glint across them, and a vertical flare for the first frames
      const L = [9, 16, 12, 6][fr];
      P.line(x - gap - L, y, x + gap + L, y, null, 2, 1, (f) => (Math.abs(f - 0.5) < 0.12 ? null : S(p.R, fr < 2 ? 1 : 0.9)));
      if (fr < 2) for (const sx of [-1, 1]) P.line(x + sx * (gap + 1), y - L * 0.45, x + sx * (gap + 1), y + L * 0.45, null, 2, 1, () => S(p.R, 0.95));
    }
  },

  /** A glare: a dashed line racing from the eyes to the target (stopping short at `reach`). */
  dvGlare(v, P, p) {
    const fr = Math.floor(p.age * 12), u = p.age / p.life, a = fadeOut(u, 0.55);
    const [ax, ay] = v.ap(p.a[0], p.a[1], p.a[2]), [ex, ey] = v.ap(p.b[0], p.b[1], p.b[2]);
    const ext = Math.min(1, (fr + 1) / 2) * p.reach, bx = ax + (ex - ax) * ext, by = ay + (ey - ay) * ext;
    const L = Math.hypot(bx - ax, by - ay) || 1, nx = -(by - ay) / L, ny = (bx - ax) / L;
    // a band of dashes three wide racing out, a solid hot thread through it, a dim fringe either side
    P.line(ax, ay, bx, by, null, 2, a, () => S(p.R, p.dark ? 0.7 : fr < 2 ? 1 : 0.95));
    for (const sg of [-1.2, 1.2]) P.line(ax + nx * sg, ay + ny * sg, bx + nx * sg, by + ny * sg, null, 1, a, (_f, i) => ((i + fr * 2) % 5 < 3 ? S(p.R, p.dark ? 0.85 : 0.9) : null));
    for (const sg of [-2.4, 2.4]) P.line(ax + nx * sg, ay + ny * sg, bx + nx * sg, by + ny * sg, null, 0, a * 0.8, (_f, i) => ((i + fr * 2) % 5 < 3 ? null : S(p.R, 0.62)));
    // where it bites: a flare on the head
    if (ext >= p.reach && p.reach >= 1) for (let k = 0; k < 4; k++) { const q = (k / 4) * TAU + fr * 0.5; P.line(bx, by, bx + Math.cos(q) * 6, by + Math.sin(q) * 6, null, 2, a, (f) => S(p.R, f < 0.5 ? 1 : 0.75)); }
  },

  /** A sound arc facing its travel; head-on (no screen direction) it draws as a whole ring. */
  dvSound(v, P, p) {
    const [cx, cy] = v.ap(p.x, p.y, p.z), [dx, dy] = v.ap(p.x + p.ux, p.y + p.uy, p.z);
    const sx = dx - cx, sy = dy - cy, flat = Math.hypot(sx, sy) < v.aps * 0.25, ang = Math.atan2(sy, sx);
    const u = clamp(p.age / p.life), a = 1 - u * 0.6, r = Math.max(1.5, p.r ?? p.r0 ?? 2);
    for (let b = 0; b < (p.bands ?? 2); b++) {
      const rr = r - b, c = S(p.R, b === 0 ? (u < 0.2 ? 1 : 0.95) : b === 1 ? 0.78 : 0.6);
      if (rr < 1) continue;
      P.ellipse(cx, cy, rr, flat ? rr * 0.45 : rr, (q) => {
        if (!flat) { const d = Math.atan2(Math.sin(q - ang), Math.cos(q - ang)); if (Math.abs(d) > 0.95) return null; }
        return { c, a };
      }, b ? 0 : 1);
    }
  },

  /** A word: a 3×3 glyph, always outlined so it reads on any floor. */
  dvWord(v, P, p) {
    let [x, y] = v.ap(p.x, p.y, p.z); [x, y] = snapH(p, v, x, y);
    const a = fadeOut(p.age / p.life, 0.7), c = S(p.R, Math.floor(p.age * 12) % 4 === 0 ? 1 : 0.9);
    for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) if (p.glyph[j * 3 + k] === "1") P.dot(x - 1 + k, y - 1 + j, c, a, 2);
  },

  /** A bloom: spokes open from the body's middle, white on the first frame, branching once. */
  dvBloom(v, P, p) {
    const fr = Math.floor(p.age * 12); if (fr > 6) return;
    const [x, y] = v.ap(p.x, p.y, p.z), grow = [0.35, 0.7, 1, 1.1, 1.15, 1.18, 1.2][fr], a = fr < 4 ? 1 : (7 - fr) / 4;
    const hot = fr === 0 && !p.dark;
    if (fr < 3) {
      const d0 = p.r * [0.3, 0.42, 0.3][fr];
      P.shade(x - d0, y - d0, x + d0, y + d0, (px, py) => (Math.hypot(px - x, py - y) <= d0 ? (hot ? WHITE : p.dark ? S(p.R, 0.05) : S(p.R, 1)) : null), 2);
    }
    for (let k = 0; k < p.n; k++) {
      const q = (k / p.n) * TAU + hash(k, p.seed) * 0.5, L = p.r * grow * (0.7 + 0.3 * hash(k, p.seed, 1)), gone = fr > 3 ? (fr - 3) / 4 : 0;
      const x1 = x + Math.cos(q) * L, y1 = y + Math.sin(q) * L, col = (f) => (f < gone ? null : hot ? WHITE : S(p.R, f > 0.7 ? 1 : f > 0.35 ? 0.88 : 0.68));
      // three pixels thick at the root, so a spoke reads over the release it opens into
      P.line(x, y, x1, y1, null, 2, a, col);
      const [ox, oy] = Math.abs(x1 - x) > Math.abs(y1 - y) ? [0, 1] : [1, 0];
      P.line(x + ox, y + oy, x1 + ox, y1 + oy, null, 1, a, (f) => (f > 0.85 ? null : col(f)));
      P.line(x - ox, y - oy, x1 - ox, y1 - oy, null, 1, a, (f) => (f > 0.5 ? null : col(f)));
      if (fr >= 1) {
        const mx = lerp(x, x1, 0.6), my = lerp(y, y1, 0.6), qb = q + (hash(k, p.seed, 2) < 0.5 ? -0.7 : 0.7), Lb = L * 0.3;
        P.line(mx, my, mx + Math.cos(qb) * Lb, my + Math.sin(qb) * Lb, S(p.R, 0.8), 1, a);
      }
    }
  },

  /**
   * A wave standing up off the floor: three stacked rings running out from the
   * middle to `r`, so it reads as a wall of force in both views. `thin` (a
   * voice) draws one band; `soft` (an aura's later beats) draws it dimmer.
   */
  dvPulse(v, P, p) {
    const u = clamp(p.age / p.life), rr = p.r * v.aps * easeOut(u), fr = Math.floor(p.age * 12);
    if (rr < 1.5) return;
    const a = (1 - u) * (p.soft ? 0.6 : 1), bands = p.thin ? 1 : 3;
    for (let k = 0; k < bands; k++) {
      const [cx, cy] = v.ap(p.x, p.y, k * 0.22 * p.h), c = S(p.R, [u < 0.2 ? 1 : 0.95, 0.75, 0.55][k]);
      // the leading band is two pixels thick, so the wall of force reads at 1x
      for (let j = 0; j < (k ? 1 : 2); j++) P.ellipse(cx, cy, rr - j, Math.max(0.5, (rr - j) * v.sq), (q) => (pnoise(q + fr * 0.2, 14, p.seed + k) < 0.25 ? null : { c: j ? S(p.R, 0.8) : c, a }), k ? 0 : 1);
    }
  },

  /** Fear: wavering lines beside the head, quivering on the sprite clock. */
  dvWaver(v, P, p) {
    const fr = Math.floor(p.age * 12), [x, y] = v.ap(p.x, p.y, p.z), a = fadeOut(p.age / p.life, 0.6), off = Math.round(6 * (p.sz ?? 1));
    for (const sx of [-1, 1]) for (let j = 0; j < 6; j++) {
      const wob = Math.round(Math.sin(j * 1.4 + fr * 1.9 + sx + p.seed) * 1.2);
      P.dot(x + sx * off + wob, y - 3 + j, S(p.R, j % 3 === 0 ? 0.95 : 0.7), a, 1);
    }
  },

  /** Death on a critical failure: a skull flickering over the head. */
  dvSkull(v, P, p) {
    const fr = Math.floor(p.age * 12);
    if (fr % 4 === 3) return;
    const [x, y] = v.ap(p.x, p.y, p.z), a = fadeOut(p.age / p.life, 0.6);
    for (let j = 0; j < 5; j++) for (let k = 0; k < 5; k++) if (SKULL[j][k] === "#") P.dot(x - 2 + k, y - 2 + j - (fr < 2 ? 0 : 1), S(p.R, j === 0 ? 1 : 0.88), a, 2);
  },

  /** Incapacitation: three motes circling over the head. */
  dvDaze(v, P, p) {
    const [x, y] = v.ap(p.x, p.y, p.z), a = fadeOut(p.age / p.life, 0.7), rx = 5 * (p.sz ?? 1), q0 = Math.floor(p.age * 12) * 0.5;
    for (let k = 0; k < 3; k++) {
      const q = q0 + (k * TAU) / 3, dx = Math.round(Math.cos(q) * rx), dy = Math.round(Math.sin(q) * rx * 0.35);
      P.dot(x + dx, y + dy, S(p.R, 1), a, 2);
      if (Math.sin(q) > 0) for (const [ox, oy] of PLUS) P.dot(x + dx + ox, y + dy + oy, S(p.R, 0.75), a, 1);
    }
  },
});
