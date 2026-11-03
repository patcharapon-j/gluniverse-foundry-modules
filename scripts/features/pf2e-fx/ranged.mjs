/**
 * Spellsprite — ranged-weapon Strikes, one timeline per ranged delivery
 * (constants.mjs DELIVERY_GROUPS.ranged). Pure.
 *
 * Same contract as strikes.mjs: `RANGED[delivery](s, M, ctx)` with ctx
 * `{ caster, targets, outcome, release, linger, fire, handOf, POW, windUp, motif }`.
 * compile.mjs falls back to the old `ranged` style for a delivery missing here.
 *
 * Every timeline has the same beats: an aim (the caster's flavor when there is
 * one), the shot leaving the weapon, the travel, and the landing. The three
 * outcomes read apart on a 26 px token:
 *   hit / neutral   it lands on the body, one release, a flinch
 *   crit            the same landing at crit power (a hitstop, a veil), a star
 *                   and a fan of speed lines along the shot; deadly and fatal
 *                   weapons add to it
 *   miss            it passes over the shoulder and BESIDE the body (the side
 *                   with nobody standing on it) and lands or flies on past;
 *                   no flash on the body, no flinch
 * `neutral` is drawn as a hit: a viewer who may not see the degree sees no crit.
 *
 * The axes (docs/SPELLSPRITE_LOOK.md): the substance (`M`) colours every beam,
 * flash, glob and burst; a weapon with no substance of its own (kinetic) draws
 * the energy its group is known for (a laser burns, a zap is electricity). The
 * props in `s.props` change the shot; the motif's carrier rides the projectile
 * and its impact lands with it.
 *
 * Sizes are art pixels at 26 per square.
 */

import { TAU, clamp, lerp, easeOut, hash, pnoise } from "./core/rand.mjs";
import { RAMP, S, WHITE } from "./core/palette.mjs";
import { lobes, still, splat } from "./core/motifs.mjs";
import { registerShapes } from "./core/shapes.mjs";
import { FAMILY_OF } from "./constants.mjs";
import { familyModule } from "./families/index.mjs";

const norm = (x, y) => { const l = Math.hypot(x, y) || 1; return [x / l, y / l]; };
const norm3 = (x, y, z) => { const l = Math.hypot(x, y, z) || 1; return [x / l, y / l, z / l]; };

/** A resolved material by id (compile.mjs resolveMaterial, without a look). */
function matOf(id) {
  const family = FAMILY_OF[id] ?? "physical", mod = familyModule(family);
  return { id, material: id, family, mod, R: RAMP[id] ?? RAMP.kinetic, dark: !!mod.dark, flicker: family === "arc" };
}
const DUST = matOf("kinetic");

/**
 * A weapon with no substance of its own draws the energy its group is known
 * for. A real damage type, or a look's hue, always wins.
 */
function subst(s, M, id) {
  if ((M.id !== "kinetic" && M.id !== "neutral") || Number.isFinite(s.spec.look?.hue)) return M;
  return matOf(id);
}

/** Quadratic Bézier through three points. */
const bez = (a, c, b, u) => {
  const p = (1 - u) * (1 - u), q = 2 * u * (1 - u), r = u * u;
  return [p * a[0] + q * c[0] + r * b[0], p * a[1] + q * c[1] + r * b[1], p * a[2] + q * c[2] + r * b[2]];
};
/** The control point of an arc that peaks `h` squares above the chord's middle. */
const arcCtl = (a, b, h) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2 + 2 * h];
/** The control point that makes the curve pass through `o` halfway. */
const thruCtl = (a, o, b) => [2 * o[0] - (a[0] + b[0]) / 2, 2 * o[1] - (a[1] + b[1]) / 2, 2 * o[2] - (a[2] + b[2]) / 2];

/**
 * The geometry of one shot at one target.
 *   muzzle   where it leaves the weapon
 *   body     where a hit lands
 *   over     over the shoulder and beside: every miss passes here
 *   ground   where a falling miss lands, past and beside
 *   air      where a straight miss is last seen, past and beside, still in the air
 * The side is the one with nobody standing on it.
 */
function geom(ctx, T, { past = 1.3, side = 0.75, z = 0.72 } = {}) {
  const c = ctx.caster;
  const from = c ?? { x: T.x - 3.5, y: T.y, size: 1, h: 0.9 };
  const [ux, uy] = norm(T.x - from.x, T.y - from.y);
  const muzzle = c ? [c.x + ux * 0.36 * c.size, c.y + uy * 0.36 * c.size, z * c.h] : [T.x - ux * 3.5, T.y - uy * 3.5, 0.9];
  const sz = Math.sqrt(T.size ?? 1), o = ctx.outcome(T);
  // on a tie, the north side: from above, height lifts a shot north too, so the two add up
  let px = -uy, py = ux;
  if (py > 0 || (py === 0 && px > 0)) { px = -px; py = -py; }
  const crowd = (sg) => {
    const qx = T.x + ux * past * sz + px * side * sz * sg, qy = T.y + uy * past * sz + py * side * sz * sg;
    let d = 9;
    for (const B of [...ctx.targets, ...(c ? [c] : [])]) if (B !== T) d = Math.min(d, Math.hypot(B.x - qx, B.y - qy));
    return d;
  };
  if (crowd(-1) > crowd(1) + 1e-6) { px = -px; py = -py; }
  const body = [T.x - ux * 0.12 * sz, T.y - uy * 0.12 * sz, 0.6 * T.h];
  const over = [T.x + px * 0.45 * sz, T.y + py * 0.45 * sz, 1.2 * T.h];
  const ground = [T.x + (ux * past + px * side) * sz, T.y + (uy * past + py * side) * sz, 0];
  const [dx, dy, dz] = norm3(over[0] - muzzle[0], over[1] - muzzle[1], over[2] - muzzle[2]);
  const air = [over[0] + dx * 2, over[1] + dy * 2, over[2] + dz * 2];
  return { T, o, miss: o === "miss", crit: o === "crit", ux, uy, px, py, sz, muzzle, body, over, ground, air };
}

/** A path for an arcing shot: on to the body, or over the shoulder and down past. */
function arcPath(G, arc, to = null) {
  const end = to ?? (G.miss ? G.ground : G.body);
  const ctl = G.miss ? thruCtl(G.muzzle, G.over, end) : arcCtl(G.muzzle, end, arc);
  // a miss never flies lower than a hit would
  if (G.miss) ctl[2] = Math.max(ctl[2], arcCtl(G.muzzle, end, arc)[2]);
  return { a: G.muzzle, c: ctl, b: end };
}

/**
 * A particle flown along a Bézier path over `dur`, facing its motion
 * (`dx, dy, dz`), with the motif's carrier on it. `onStep(s, p, dt, u)`.
 */
function fly(s, M, ctx, at, path, dur, part, { ease = null, onStep = null } = {}) {
  s.at(at, (s2) => {
    const p = s2.add({
      ...part, x: path.a[0], y: path.a[1], z: path.a[2], dx: 1, dy: 0, dz: 0, life: dur,
      update(q, s3, dt) {
        const u = clamp(q.age / dur), e = ease ? ease(u) : u;
        [q.x, q.y, q.z] = bez(path.a, path.c, path.b, e);
        const n = bez(path.a, path.c, path.b, Math.min(1, e + 0.03)), m = bez(path.a, path.c, path.b, Math.max(0, e - 0.03));
        [q.dx, q.dy, q.dz] = norm3(n[0] - m[0], n[1] - m[1], n[2] - m[2]);
        onStep?.(s3, q, dt, u);
      },
    });
    ctx.motif?.carrier?.(s2, M, p);
  });
}

/** Where a shot's ends are, in time: it leaves at `at` and lands `dur` later. */
const travel = (G, end, speed, lo, hi) => clamp(Math.hypot(end[0] - G.muzzle[0], end[1] - G.muzzle[1]) / speed, lo, hi);

/* ── the shared beats ───────────────────────────────────────────────── */

/**
 * The aim: the caster's flavor (a gunslinger's draw) when there is one, a
 * targeting reticle for a tech weapon, a charge for a boosted shot. Returns
 * when the first shot leaves.
 */
function aim(s, M, ctx, { lead = 0.2, boost = true } = {}) {
  const c = ctx.caster, T0 = ctx.targets[0];
  if (!T0) return lead;
  const G = geom(ctx, T0);
  let t = c && ctx.windUp?.(M, c, G.muzzle, 0, 0.26) ? 0.3 : c ? lead : 0.06;
  if (s.props.has("tech")) {
    ctx.targets.forEach((T, i) => s.at(Math.max(0, t - 0.16) + i * 0.04, (s2) => s2.add({ k: "rgReticle", x: T.x, y: T.y, z: 0.6 * T.h, r: 0.42 * Math.sqrt(T.size ?? 1), life: 0.5, R: RAMP.sonic, update: still })));
    s.phases.push("reticle");
  }
  if (boost && s.props.has("boost") && c) {
    const m = G.muzzle, d = 0.32;
    s.at(t, (s2) => {
      s2.light(m[0], m[1], m[2], 1.3, S(M.R, 0.85), 0.9, d + 0.05, { swell: true });
      s2.add({ k: "orb", x: m[0], y: m[1], z: m[2], life: d, R: M.R, dark: M.dark, r: 1, glow: true, update(p) { const u = clamp(p.age / d); p.r = 1 + 2.5 * u * u; } });
    });
    t += d;
    s.phases.push("boost");
  }
  return t;
}

/** How many rounds one Strike fires. */
const roundsOf = (s) => (s.props.has("automatic") ? 3 : 1);

/** A muzzle flash: a sharp star along the shot and a pool of light. */
function muzzleFlash(s, G, R, r, { light = 1 } = {}) {
  const m = G.muzzle, [dx, dy] = [G.ux, G.uy];
  s.add({ k: "rgMuzzle", x: m[0] + dx * 0.08, y: m[1] + dy * 0.08, z: m[2], dx, dy, dz: 0, r, life: 3 / 12, R, update: still });
  if (light > 0) s.light(m[0] + dx * 0.25, m[1] + dy * 0.25, m[2], 0.6 + r * 0.05, S(R, 0.85), 0.6 * light, 0.18);
}

/** A grey cloud of burnt powder that hangs at the barrel. */
function powderSmoke(s, G, n, big = 1) {
  const m = G.muzzle;
  for (let i = 0; i < n; i++) {
    const f = s.rand(0.05, 0.45);
    s.add({ k: "smoke", x: m[0] + G.ux * f, y: m[1] + G.uy * f, z: m[2] + s.rand(-0.05, 0.1), vx: G.ux * s.rand(0.3, 0.8) + s.rand(-0.15, 0.15), vy: G.uy * s.rand(0.3, 0.8) + s.rand(-0.15, 0.15), vz: s.rand(0.08, 0.25), g: -0.04, drag: 1.4, r: s.rand(2.5, 4) * big, life: s.rand(1.5, 2.4), lobes: lobes(s), R: RAMP.metal, tone: 0.55, minor: i > 1, wait: i * 0.03 });
  }
}

/** Kickback: the shooter is shoved back a step, dust at the heels and a backward jolt. */
function recoil(s, G, ctx, k = 1) {
  const c = ctx.caster; if (!c) return;
  s.shake = Math.max(s.shake, 0.8 * k);
  for (let i = 0; i < 2; i++) s.add({ k: "smoke", x: c.x - G.ux * 0.3 + G.px * (i - 0.5) * 0.3, y: c.y - G.uy * 0.3 + G.py * (i - 0.5) * 0.3 + 0.1, z: 0.05, vx: -G.ux * 0.8, vy: -G.uy * 0.8, vz: 0.15, drag: 2.2, r: s.rand(1.6, 2.4) * k, life: 0.6, lobes: lobes(s), R: RAMP.kinetic, tone: 0.5, minor: i > 0 });
  for (let i = 0; i < 3; i++) s.add({ k: "streak", x: c.x - G.ux * 0.25 + G.px * (i - 1) * 0.14, y: c.y - G.uy * 0.25 + G.py * (i - 1) * 0.14, z: (0.55 + i * 0.12) * c.h, vx: -G.ux * 6, vy: -G.uy * 6, vz: 0, life: 0.1, R: RAMP.kinetic, minor: i === 2, wait: i * 0.01 });
}

/** The crit's second impact: a star, a fan of speed lines thrown out along the shot, a ring. */
function critImpact(s, M, G, scale = 1) {
  const T = G.T, z = 0.6 * T.h, x = T.x - 0.05, y = T.y, base = Math.atan2(G.uy, G.ux);
  s.add({ k: "star", x, y, z, L: 9 * scale * Math.min(1.4, s.m) * G.sz, life: 3 / 12, R: M.R, update: still });
  for (let i = 0; i < 7; i++) {
    const q = base + (i - 3) * 0.34 + s.rand(-0.06, 0.06), sp = s.rand(8, 11) * scale;
    s.add({ k: "streak", x, y, z, vx: Math.cos(q) * sp, vy: Math.sin(q) * sp, vz: s.rand(-1.5, 2.5), life: s.rand(0.14, 0.2), R: M.R, minor: i % 2 === 1 });
  }
  s.add({ k: "ring", x: T.x, y: T.y, r: 0.75 * (T.size ?? 1) * scale, life: 0.4, R: M.R, broken: true, seed: 5, update: still });
}

/** What the props add to a landing: a shock ring, a splash on the neighbours, a glint of magic. */
function propsAt(s, M, ctx, G, at, hit) {
  const P = s.props;
  if (P.has("concussive") && hit) {
    s.add({ k: "ring", x: at[0], y: at[1], r: 1.05 * G.sz, life: 0.45, R: RAMP.air, update: still });
    s.add({ k: "rgRing", x: at[0], y: at[1], z: at[2], dx: G.ux, dy: G.uy, dz: 0, r0: 3, r: 11 * G.sz, life: 0.3, R: RAMP.air, update: still });
    s.shake = Math.max(s.shake, 1);
  }
  if (P.has("splash")) splashOn(s, M, ctx, G, at, hit ? 1 : 0.6);
  if (P.has("magical")) for (let i = 0; i < 3; i++) s.add({ k: "glint", x: at[0] + s.rand(-0.3, 0.3), y: at[1] + s.rand(-0.2, 0.2), z: Math.max(0.1, at[2] + s.rand(-0.2, 0.4)), life: 5 / 12, R: M.R, wait: i * 0.06, minor: i > 0, update: still });
}

/** Splash: a ring a square out, and a lick of the material on every creature it reaches. */
function splashOn(s, M, ctx, G, at, k) {
  s.add({ k: "ring", x: at[0], y: at[1], r: 1.0 * k, life: 0.55, R: M.R, broken: true, seed: 9, update: still });
  for (let i = 0; i < 8; i++) {
    const q = (i / 8) * TAU + s.rand(-0.2, 0.2), d = s.rand(0.55, 0.95) * k;
    s.add({ k: "splash", x: at[0] + Math.cos(q) * d, y: at[1] + Math.sin(q) * d, z: 0, life: 3 / 12, R: M.R, wait: d * 0.12, minor: i % 2 === 1, update: still });
  }
  for (const B of ctx.targets) {
    if (B === G.T) continue;
    const d = Math.hypot(B.x - at[0], B.y - at[1]);
    if (d > 1.6) continue;
    s.at(s.t + 0.06 + d * 0.05, (s2) => { ctx.release(s2, M, B.x, B.y, 0.4 * B.h, 0.35, 0.18); s2.hit(B.id, 0.35, { x: at[0], y: at[1] }, M.R); });
  }
}

/**
 * A shot landing on the body: the release, the flinch, the motif's impact,
 * and for a crit the second impact (deadly and fatal make it bigger).
 * Hit and neutral are the same; nothing here reaches crit power without a crit.
 */
function landHit(s, M, ctx, G, { pow = 0.75, rad = 0.3, at = G.body, push = 1 } = {}) {
  const P = G.crit ? 1.6 : Math.min(1.1, pow);
  ctx.release(s, M, at[0], at[1], at[2], P, rad);
  s.hit(G.T.id, G.crit ? 1.6 : push, { x: G.muzzle[0], y: G.muzzle[1] }, M.R);
  ctx.motif?.impact?.(s, M, { x: at[0], y: at[1], z: at[2], pow: P, rad, at: s.t });
  if (G.crit) {
    const fatal = s.props.has("fatal"), deadly = s.props.has("deadly");
    critImpact(s, M, G, fatal ? 1.45 : deadly ? 1.2 : 1);
    if (deadly || fatal) {
      // the extra die: a second, later bloom of the same material
      s.at(s.t + 0.1, (s2) => { ctx.release(s2, M, at[0] + G.ux * 0.1, at[1] + G.uy * 0.1, at[2] + 0.1, 1, rad * 1.2); s2.shake = Math.max(s2.shake, fatal ? 3 : 2); });
      if (fatal) s.add({ k: "flash", x: at[0], y: at[1], z: at[2], life: 2 / 12, r: 14 * G.sz, R: M.R, wait: 1 / 12, update: still });
    }
  }
  propsAt(s, M, ctx, G, at, true);
}

/** A shot landing wide: a scuff of dust where it ends, nothing on the body. */
function landMiss(s, M, ctx, G, at, { pow = 0.3, rad = 0.15 } = {}) {
  ctx.release(s, at[2] < 0.2 ? DUST : M, at[0], at[1], Math.max(0.05, at[2]), pow, rad);
  propsAt(s, M, ctx, G, at, false);
}

/** The stuck shaft of an arrow or a bolt (or a dart) that stays a while. */
function stuck(s, k, at, dir, R, extra) {
  s.add({ k, x: at[0], y: at[1], z: at[2], dx: dir[0], dy: dir[1], dz: dir[2], stuck: true, life: 1.8, R, debris: true, update: still, ...extra });
}

/** Per target, staggered; returns the last landing time. */
function perTarget(ctx, start, gap, fn) {
  let last = start;
  ctx.targets.forEach((T, i) => { last = Math.max(last, fn(T, start + i * gap, i) ?? 0); });
  return last;
}

/* ── bows, crossbows and things thrown ───────────────────────────────── */

/** A fletched arrow on an arc: it thunks in and sticks; a miss sticks in the ground past. */
function shaft(s, M, ctx, { bolt = false } = {}) {
  const t0 = aim(s, M, ctx, { lead: bolt ? 0.16 : 0.24 });
  if (ctx.caster) {
    const G0 = geom(ctx, ctx.targets[0] ?? { x: ctx.caster.x + 1, y: ctx.caster.y });
    s.at(Math.max(0, t0 - 0.12), (s2) => s2.add({ k: "glint", x: G0.muzzle[0], y: G0.muzzle[1], z: G0.muzzle[2] + 0.15, life: 5 / 12, R: M.R, big: !bolt, update: still }));
  }
  const volley = s.props.has("volley"), H = M.id === "kinetic" ? RAMP.metal : M.R, F = M.id === "kinetic" ? RAMP.linen : M.R;
  const len = bolt ? 0.36 : 0.55;
  const last = perTarget(ctx, t0, 0.16, (T, at) => {
    const G = geom(ctx, T), path = arcPath(G, bolt ? 0.04 : volley ? 0.6 : 0.16);
    const dur = travel(G, path.b, bolt ? 26 : 18, 0.1, bolt ? 0.32 : 0.5);
    s.at(at, (s2) => { if (bolt) s2.add({ k: "rgMuzzle", x: G.muzzle[0], y: G.muzzle[1], z: G.muzzle[2], dx: G.ux, dy: G.uy, dz: 0, r: 3, life: 2 / 12, R: RAMP.kinetic, update: still }); });
    fly(s, M, ctx, at, path, dur, { k: "rgArrow", len, bolt, R: M.R, H, F }, {
      onStep: M.id !== "kinetic" ? (s3, q, dt) => M.mod.trail?.(s3, M, { x: q.x, y: q.y, z: q.z, dt: dt * 0.5 }) : null,
    });
    s.at(at + dur, (s2) => {
      const e = bez(path.a, path.c, path.b, 1), e0 = bez(path.a, path.c, path.b, 0.95), dir = norm3(e[0] - e0[0], e[1] - e0[1], e[2] - e0[2]);
      if (G.miss) { landMiss(s2, M, ctx, G, path.b); stuck(s2, "rgArrow", [path.b[0], path.b[1], 0.02], dir, M.R, { len, bolt, H, F }); return; }
      landHit(s2, M, ctx, G, { pow: bolt ? 0.95 : 0.7, push: bolt ? 1.3 : 1 });
      if (bolt) { s2.shake = Math.max(s2.shake, 0.9); s2.add({ k: "ring", x: G.T.x, y: G.T.y, r: 0.5 * G.sz, life: 0.3, R: RAMP.kinetic, broken: true, seed: 3, update: still }); }
      if (!G.crit) { stuck(s2, "rgArrow", G.body, dir, M.R, { len, bolt, H, F, quiver: true, life: 1.1 }); return; }
      // driven through: the shaft comes out the far side and buries itself behind
      const out = [G.T.x + G.ux * 1.3 * G.sz, G.T.y + G.uy * 1.3 * G.sz, 0.02], z0 = G.body[2];
      const thru = { a: [G.T.x, G.T.y, z0], c: [(G.T.x + out[0]) / 2, (G.T.y + out[1]) / 2, (z0 + out[2]) / 2], b: out };
      s2.at(s2.t + 2 / 12, (s3) => fly(s3, M, ctx, s3.t, thru, 0.12, { k: "rgArrow", len, bolt, R: M.R, H, F }));
      s2.at(s2.t + 2 / 12 + 0.12, (s3) => stuck(s3, "rgArrow", out, norm3(G.ux, G.uy, -0.5), M.R, { len, bolt, H, F }));
    });
    return at + dur;
  });
  s.phases.push(bolt ? "quarrel" : volley ? "volley arc" : "arrow", "impact");
  s.period = last + 2;
}

/** A thrown weapon spinning end over end; a hit knocks it down at the target's feet. */
function thrown(s, M, ctx) {
  const t0 = aim(s, M, ctx, { lead: 0.26 });
  const H = M.id === "kinetic" ? RAMP.metal : M.R;
  const last = perTarget(ctx, t0, 0.18, (T, at) => {
    const G = geom(ctx, T), path = arcPath(G, 0.45);
    const dur = travel(G, path.b, 12, 0.22, 0.6), ang = s.rand(0, TAU);
    fly(s, M, ctx, at, path, dur, { k: "rgSpin", len: 0.5, ang, R: M.R, H, seed: s.seedInt() }, {
      onStep: M.id !== "kinetic" ? (s3, q, dt) => M.mod.trail?.(s3, M, { x: q.x, y: q.y, z: q.z, dt: dt * 0.5 }) : null,
    });
    s.at(at + dur, (s2) => {
      if (G.miss) {
        landMiss(s2, M, ctx, G, path.b);
        // it skids on and lies there
        s2.add({ k: "rgSpin", x: path.b[0], y: path.b[1], z: 0.05, vx: G.ux * 1.6, vy: G.uy * 1.6, vz: 0.6, g: 9, drag: 2.5, bounce: 0.3, dx: G.ux, dy: G.uy, dz: 0, len: 0.5, ang, spinT: 0.3, R: M.R, H, life: 1.8, debris: true });
        return;
      }
      landHit(s2, M, ctx, G, { pow: 0.8 });
      if (G.crit) { s2.add({ k: "rgSpin", x: G.body[0], y: G.body[1], z: G.body[2], dx: G.ux, dy: G.uy, dz: 0, len: 0.5, ang: 0.6, rest: true, R: M.R, H, life: 0.9, debris: true, update: still }); return; }
      // the blow lands and the weapon drops, tumbling, at the target's feet
      s2.add({ k: "rgSpin", x: G.body[0], y: G.body[1], z: G.body[2], vx: -G.ux * 0.9 + G.px * 0.5, vy: -G.uy * 0.9 + G.py * 0.5, vz: 1.8, g: 9, drag: 0.6, bounce: 0.35, dx: G.ux, dy: G.uy, dz: 0, len: 0.5, ang, spinT: 0.45, R: M.R, H, life: 1.8, debris: true });
    });
    return at + dur;
  });
  s.phases.push("throw", "spin", "impact");
  s.period = last + 2;
}

/** A dart or a shuriken: small, fast, spinning; it sticks. */
function dart(s, M, ctx) {
  const t0 = aim(s, M, ctx, { lead: 0.16 });
  const H = M.id === "kinetic" ? RAMP.metal : M.R;
  const last = perTarget(ctx, t0, 0.12, (T, at) => {
    const G = geom(ctx, T), path = arcPath(G, 0.08), dur = travel(G, path.b, 22, 0.12, 0.35);
    fly(s, M, ctx, at, path, dur, { k: "rgStar", R: M.R, H }, {
      onStep: M.id !== "kinetic" ? (s3, q, dt) => M.mod.trail?.(s3, M, { x: q.x, y: q.y, z: q.z, dt: dt * 0.4 }) : null,
    });
    s.at(at + dur, (s2) => {
      if (G.miss) { landMiss(s2, M, ctx, G, path.b, { pow: 0.2, rad: 0.1 }); s2.add({ k: "rgStar", x: path.b[0], y: path.b[1], z: 0.04, stuck: true, life: 1.8, R: M.R, H, debris: true, update: still }); return; }
      landHit(s2, M, ctx, G, { pow: 0.55, rad: 0.22 });
      s2.add({ k: "rgStar", x: G.body[0], y: G.body[1], z: G.body[2], stuck: true, life: 0.9, R: M.R, H, update: still });
    });
    return at + dur;
  });
  s.phases.push("dart", "impact");
  s.period = last + 1.9;
}

/** A sling: the stone whips round the hand twice, a small lob, a bonk. */
function stone(s, M, ctx) {
  let t0 = aim(s, M, ctx, { lead: 0.04 });
  const R = M.id === "kinetic" ? RAMP.earth : M.R, c = ctx.caster;
  if (c && ctx.targets[0]) {
    const G0 = geom(ctx, ctx.targets[0]), hx = c.x + G0.ux * 0.15, hy = c.y + G0.uy * 0.15, hz = 1.05 * c.h, d = 0.36;
    s.at(t0, (s2) => s2.add({
      k: "rgPebble", x: hx, y: hy, z: hz, life: d, R, whirl: true,
      update(p) { const q = (p.age / d) * TAU * 2 + Math.atan2(G0.uy, G0.ux) + Math.PI; p.x = hx + Math.cos(q) * 0.3; p.y = hy + Math.sin(q) * 0.3 * 0.6; p.z = hz + Math.sin(q) * 0.06; },
    }));
    s.at(t0 + d * 0.5, (s2) => s2.add({ k: "ring", x: hx, y: hy, r: 0.32, life: d * 0.6, R: RAMP.kinetic, broken: true, seed: 2, update: still }));
    t0 += d;
    s.phases.push("whirl");
  }
  const last = perTarget(ctx, t0, 0.2, (T, at) => {
    const G = geom(ctx, T, { z: 0.95 }), path = arcPath(G, 0.32), dur = travel(G, path.b, 16, 0.16, 0.45);
    fly(s, M, ctx, at, path, dur, { k: "rgPebble", R });
    s.at(at + dur, (s2) => {
      if (G.miss) {
        landMiss(s2, M, ctx, G, path.b);
        s2.add({ k: "rgPebble", x: path.b[0], y: path.b[1], z: 0.05, vx: G.ux * 2, vy: G.uy * 2, vz: 1.2, g: 9, drag: 1.5, bounce: 0.4, life: 1.6, R, debris: true });
        return;
      }
      landHit(s2, M, ctx, G, { pow: 0.6, rad: 0.22, at: [G.body[0], G.body[1], 0.85 * G.T.h] });
      // bonk: a little star on the head and the stone bouncing off
      s2.add({ k: "star", x: G.T.x, y: G.T.y, z: 1.05 * G.T.h, L: 4, life: 3 / 12, R: RAMP.light, update: still });
      s2.add({ k: "rgPebble", x: G.body[0], y: G.body[1], z: 0.85 * G.T.h, vx: -G.ux * 1.4 + G.px * 0.6, vy: -G.uy * 1.4 + G.py * 0.6, vz: 2.4, g: 9, drag: 0.6, bounce: 0.4, life: 1.6, R, debris: true });
    });
    return at + dur;
  });
  s.phases.push("lob", "bonk");
  s.period = last + 1.8;
}

/** A boulder lobbed high: it lands, the ground shakes, debris flies. */
function rock(s, M, ctx) {
  const t0 = aim(s, M, ctx, { lead: 0.3 });
  const R = M.id === "kinetic" ? RAMP.earth : M.R, ground = matOf("earth");
  const last = perTarget(ctx, t0, 0.22, (T, at) => {
    const G = geom(ctx, T, { z: 1.05 }), body = [G.body[0], G.body[1], 0.7 * T.h];
    const path = arcPath(G, 1.5, G.miss ? G.ground : body), dur = travel(G, path.b, 9, 0.4, 0.9);
    const r = 6.5 * Math.sqrt(ctx.caster?.size ?? 1);
    fly(s, M, ctx, at, path, dur, { k: "rgBoulder", r, R, seed: s.seedInt() });
    s.at(at + dur, (s2) => {
      const spot = G.miss ? path.b : [T.x - G.ux * 0.25, T.y - G.uy * 0.25, 0];
      s2.shake = Math.max(s2.shake, G.miss ? 1.4 : 2.2);
      s2.add({ k: "ring", x: spot[0], y: spot[1], r: 1.1, life: 0.5, R: RAMP.earth, broken: true, seed: 13, update: still });
      for (let i = 0; i < 8; i++) {
        const q = s2.rand(0, TAU), sp = s2.rand(1.5, 3.8);
        s2.add({ k: "chunk", x: spot[0], y: spot[1], z: 0.1, vx: Math.cos(q) * sp, vy: Math.sin(q) * sp, vz: s2.rand(1.5, 3.5), g: 9, drag: 0.8, bounce: 0.3, life: s2.rand(1.4, 2.2), R: RAMP.earth, s: 2, wide: i % 3 === 0, debris: true, minor: i > 5 });
      }
      for (let i = 0; i < 3; i++) s2.add({ k: "smoke", x: spot[0] + s2.rand(-0.4, 0.4), y: spot[1] + s2.rand(-0.2, 0.2), z: 0.05, vx: s2.rand(-0.8, 0.8), vy: s2.rand(-0.3, 0.3), vz: 0.2, drag: 2, r: s2.rand(3, 5), life: s2.rand(0.9, 1.3), lobes: lobes(s2), R: RAMP.earth, tone: 0.5, minor: i > 1 });
      if (G.miss) landMiss(s2, ground, ctx, G, path.b, { pow: 0.45, rad: 0.3 });
      else landHit(s2, M.id === "kinetic" ? ground : M, ctx, G, { pow: 0.95, rad: 0.4, at: body, push: 1.4 });
      // the boulder rolls on and settles
      const fall = G.miss ? path.b : body;
      s2.add({ k: "rgBoulder", x: fall[0], y: fall[1], z: Math.max(0.1, fall[2] * 0.4), vx: G.ux * (G.miss ? 1.6 : 0.5), vy: G.uy * (G.miss ? 1.6 : 0.5), vz: 0.8, g: 9, drag: 1.6, bounce: 0.25, r, R, seed: 3, life: 1.6, debris: true });
    });
    return at + dur;
  });
  s.phases.push("heave", "quake", "debris");
  s.period = last + 2;
}

/** An alchemical flask: it arcs, shatters and splashes its material. */
function bomb(s, M0, ctx) {
  const M = subst(s, M0, "fire");
  const t0 = aim(s, M, ctx, { lead: 0.22 });
  const last = perTarget(ctx, t0, 0.18, (T, at) => {
    const G = geom(ctx, T, { z: 0.95 }), path = arcPath(G, 0.7), dur = travel(G, path.b, 11, 0.3, 0.7);
    fly(s, M, ctx, at, path, dur, { k: "rgFlask", R: M.R }, { onStep: (s3, q, dt) => { if (s3.R() < dt * 30) s3.add({ k: "ember", x: q.x, y: q.y, z: q.z + 0.15, vz: 0.3, life: 0.4, R: M.R, seed: s3.seedInt(), minor: true }); } });
    s.at(at + dur, (s2) => {
      const at2 = G.miss ? path.b : G.body;
      for (let i = 0; i < 7; i++) {
        const q = s2.rand(0, TAU), sp = s2.rand(2, 4.5);
        s2.add({ k: "shard", x: at2[0], y: at2[1], z: Math.max(0.1, at2[2]), vx: Math.cos(q) * sp, vy: Math.sin(q) * sp, vz: s2.rand(0.5, 2.5), g: 9, drag: 1, bounce: 0.3, life: s2.rand(0.6, 1.1), R: RAMP.air, seed: s2.R(), minor: i > 3 });
      }
      if (G.miss) {
        // a miss still splashes where the flask breaks
        ctx.release(s2, M, at2[0], at2[1], 0.1, 0.45, 0.3);
        if (!s2.props.has("splash")) splashOn(s2, M, ctx, G, at2, 0.6);
        propsAt(s2, M, ctx, G, at2, false);
        return;
      }
      landHit(s2, M, ctx, G, { pow: 0.85, rad: 0.35 });
      if (!s2.props.has("splash")) s2.add({ k: "ring", x: G.T.x, y: G.T.y, r: 0.7, life: 0.45, R: M.R, broken: true, seed: 7, update: still });
      ctx.linger(s2, M, G.T.x, G.T.y, 0.4, s2.t + 0.1, s2.t + 1.2);
    });
    return at + dur;
  });
  s.phases.push("flask arc", "shatter", "splash");
  s.period = last + 2.2;
}

/** A grenade: it arcs, bounces once, beeps and blows. */
function grenade(s, M0, ctx) {
  const M = subst(s, M0, "fire");
  const t0 = aim(s, M, ctx, { lead: 0.24 });
  const last = perTarget(ctx, t0, 0.2, (T, at) => {
    const G = geom(ctx, T, { z: 0.95 });
    // it comes to rest at the target's feet, or past and beside it
    const rest = G.miss ? G.ground : [T.x - G.ux * 0.42 * G.sz, T.y - G.uy * 0.42 * G.sz, 0.04];
    const bounce = [rest[0] - G.ux * 0.7, rest[1] - G.uy * 0.7, 0.04];
    const p1 = arcPath(G, 0.8, bounce), d1 = travel(G, bounce, 10, 0.3, 0.6);
    if (G.miss) p1.c = thruCtl(G.muzzle, [G.over[0] - G.ux * 0.6, G.over[1] - G.uy * 0.6, G.over[2] + 0.2], bounce);
    const p2 = { a: bounce, c: arcCtl(bounce, rest, 0.22), b: rest }, d2 = 0.22, beep = 0.42;
    const look = { k: "rgGrenade", R: M.R };
    fly(s, M, ctx, at, p1, d1, look);
    s.at(at + d1, (s2) => s2.add({ k: "ring", x: bounce[0], y: bounce[1], r: 0.18, life: 0.25, R: RAMP.kinetic, update: still }));
    fly(s, M, ctx, at + d1, p2, d2, look);
    const t3 = at + d1 + d2;
    s.at(t3, (s2) => {
      s2.add({ k: "rgGrenade", x: rest[0], y: rest[1], z: rest[2], dx: G.ux, dy: G.uy, dz: 0, beep: true, life: beep, R: M.R, update: still });
      for (let k = 0; k < 3; k++) s2.at(t3 + k * beep / 3, (s3) => s3.light(rest[0], rest[1], 0.1, 0.6, S(RAMP.unholy, 0.9), 0.7, 0.08));
    });
    s.at(t3 + beep, (s2) => {
      const at2 = [rest[0], rest[1], 0.25];
      s2.shake = Math.max(s2.shake, G.miss ? 1.2 : 1.8);
      s2.add({ k: "ring", x: rest[0], y: rest[1], r: 1.05, life: 0.5, R: M.R, broken: true, seed: 21, update: still });
      for (let i = 0; i < 3; i++) s2.add({ k: "smoke", x: rest[0] + s2.rand(-0.3, 0.3), y: rest[1] + s2.rand(-0.2, 0.2), z: 0.3, vx: s2.rand(-0.5, 0.5), vz: s2.rand(0.4, 0.8), g: -0.1, drag: 1.5, r: s2.rand(4, 6), life: s2.rand(1.2, 1.8), lobes: lobes(s2), R: RAMP.metal, tone: 0.45, wait: 0.15, minor: i > 1 });
      if (G.miss) { ctx.release(s2, M, ...at2, 0.6, 0.35); propsAt(s2, M, ctx, G, at2, false); return; }
      ctx.release(s2, M, ...at2, G.crit ? 1.6 : 1.05, 0.5);
      s2.hit(T.id, G.crit ? 1.6 : 1.2, { x: rest[0], y: rest[1] + 0.01 }, M.R);
      ctx.motif?.impact?.(s2, M, { x: at2[0], y: at2[1], z: at2[2], pow: G.crit ? 1.6 : 1.05, rad: 0.5, at: s2.t });
      if (G.crit) critImpact(s2, M, G, s2.props.has("fatal") ? 1.4 : 1.1);
      propsAt(s2, M, ctx, G, G.body, true);
    });
    return t3 + beep;
  });
  s.phases.push("lob", "bounce", "beep", "blast");
  s.period = last + 2;
}

/* ── guns ────────────────────────────────────────────────────────────── */

/**
 * Which kind of gun: a black-powder firearm (PF2e) leaves a cloud of smoke; a
 * kinetic SF2e projectile weapon is clean and throws out a casing. The spec's
 * weapon group decides when it carries one; otherwise an SF2e trait does.
 */
function sfGun(s) {
  const g = s.spec.weapon?.group ?? s.spec.group;
  if (g) return g !== "firearm";
  return ["tech", "automatic", "boost", "area"].some((p) => s.props.has(p));
}

/** A tracer from `a` to `b` taking `dur`, its tail `span` of the path long. */
function tracer(s, M, ctx, at, a, b, dur, { span = 0.3, R = M.R, w = 1, lag = null, tdur = null, trail = false } = {}) {
  s.at(at, (s2) => {
    const p = s2.add({ k: "rgTracer", x: b[0], y: b[1], z: b[2], a, b, dur, span, lag: lag ?? dur * 0.6, tdur: tdur ?? dur, w, life: (lag ?? dur * 0.6) + (tdur ?? dur), R, hot: true, update: still });
    ctx.motif?.carrier?.(s2, M, p);
  });
  if (trail && M.id !== "kinetic") s.emit(at, at + dur, (s2, u, dt) => M.mod.trail?.(s2, M, { x: lerp(a[0], b[0], u), y: lerp(a[1], b[1], u), z: lerp(a[2], b[2], u), dt: dt * 0.6 }));
}

/** A bullet: a muzzle flash, a near-instant tracer, a puff of sparks. */
function bullet(s, M, ctx) {
  if (s.props.has("scatter")) { pellets(s, M, ctx); return; }
  const sf = sfGun(s), t0 = aim(s, M, ctx, { lead: 0.2 }), n = roundsOf(s), kick = s.props.has("kickback") || s.props.has("unwieldy");
  const flashR = M.id !== "kinetic" ? M.R : sf ? RAMP.light : RAMP.fire, tr = M.id !== "kinetic" ? M.R : sf ? RAMP.light : RAMP.vitality;
  const boosted = s.props.has("boost");
  const last = perTarget(ctx, t0, 0.24, (T, at) => {
    const G = geom(ctx, T);
    let end = at;
    for (let r = 0; r < n; r++) {
      const ta = at + r * 0.09, final = r === n - 1;
      const to = G.miss ? [G.air[0] + G.px * r * 0.12, G.air[1] + G.py * r * 0.12, G.air[2] + r * 0.06] : [G.body[0], G.body[1], G.body[2] + (r - (n - 1) / 2) * 0.1];
      const dur = travel(G, to, 70, 0.03, 0.09);
      s.at(ta, (s2) => {
        muzzleFlash(s2, G, flashR, sf ? 5 : 8, { light: sf ? 0.6 : 1 });
        if (!sf) powderSmoke(s2, G, r === 0 ? 4 : 1, kick ? 1.25 : 1);
        else {
          s2.add({ k: "smoke", x: G.muzzle[0] + G.ux * 0.1, y: G.muzzle[1] + G.uy * 0.1, z: G.muzzle[2], vz: 0.3, drag: 2, r: 1.5, life: 0.4, lobes: [[0, 0, 1]], R: RAMP.metal, tone: 0.6, minor: true });
          s2.add({ k: "rgCasing", x: G.muzzle[0] - G.ux * 0.2, y: G.muzzle[1] - G.uy * 0.2, z: G.muzzle[2], vx: G.px * s2.rand(1.2, 1.8) - G.ux * 0.4, vy: G.py * s2.rand(1.2, 1.8) - G.uy * 0.4, vz: s2.rand(2, 2.8), g: 9, drag: 0.6, bounce: 0.45, life: 1.4, debris: true, minor: r > 0 });
        }
        if (kick && r === 0) recoil(s2, G, ctx, s2.props.has("unwieldy") ? 1.3 : 1);
      });
      tracer(s, M, ctx, ta, G.muzzle, to, dur, { span: 0.35, R: tr, w: boosted ? 2 : 1, trail: true });
      s.at(ta + dur, (s2) => {
        if (G.miss) {
          // it cracks past the shoulder and kicks up dust somewhere behind
          if (r === 0) s2.at(s2.t + 0.05, (s3) => landMiss(s3, M, ctx, G, G.ground, { pow: 0.25, rad: 0.12 }));
          return;
        }
        if (final) landHit(s2, M, ctx, G, { pow: 0.7, rad: 0.26 });
        else { ctx.release(s2, M, to[0], to[1], to[2], 0.45, 0.18); s2.hit(T.id, 0.7, { x: G.muzzle[0], y: G.muzzle[1] }, M.R); }
      });
      end = ta + dur;
    }
    return end;
  });
  s.phases.push(sf ? "projectile" : "black powder", n > 1 ? "burst of three" : "shot", "tracer", "impact");
  s.period = last + (sf ? 1.8 : 2.4);
}

/** A scatter of short tracers in a cone; `area` (SF2e area-cone) widens it. */
function pellets(s, M, ctx) {
  const sf = sfGun(s), t0 = aim(s, M, ctx, { lead: 0.22 }), wide = s.props.has("area");
  const N = wide ? 9 : 6, half = wide ? 0.34 : 0.17, kick = s.props.has("kickback") || s.props.has("unwieldy");
  const flashR = M.id !== "kinetic" ? M.R : sf ? RAMP.light : RAMP.fire, tr = M.id !== "kinetic" ? M.R : sf ? RAMP.light : RAMP.vitality;
  const last = perTarget(ctx, t0, 0.26, (T, at) => {
    const G = geom(ctx, T), dist = Math.hypot(T.x - G.muzzle[0], T.y - G.muzzle[1]), base = Math.atan2(G.uy, G.ux);
    // a miss sends the whole cone past the clear side
    const off = G.miss ? Math.sign(G.px * -G.uy + G.py * G.ux || 1) * (half + Math.atan2(0.6 * G.sz, dist)) : 0;
    s.at(at, (s2) => {
      muzzleFlash(s2, G, flashR, wide ? 11 : 9);
      if (!sf) powderSmoke(s2, G, 5, 1.3);
      if (kick) recoil(s2, G, ctx, 1.2);
    });
    let land = at;
    for (let i = 0; i < N; i++) {
      const q = base + off + (i / (N - 1) - 0.5) * 2 * half + s.rand(-0.04, 0.04);
      const onBody = !G.miss && Math.abs(Math.sin(q - base)) * dist < 0.36 * G.sz;
      const L = onBody ? dist - 0.1 : dist + s.rand(0.6, 1.6);
      const to = [G.muzzle[0] + Math.cos(q) * L, G.muzzle[1] + Math.sin(q) * L, onBody ? G.body[2] + s.rand(-0.15, 0.15) : G.miss ? G.over[2] + s.rand(0, 0.5) : s.rand(0.05, 0.5)];
      const dur = travel(G, to, 55, 0.04, 0.12), ta = at + s.rand(0, 0.02);
      tracer(s, M, ctx, ta, G.muzzle, to, dur, { span: 0.25, R: tr });
      if (!onBody) s.at(ta + dur, (s2) => s2.add({ k: "spark", x: to[0], y: to[1], z: Math.max(0.05, to[2]), vx: s2.rand(-1, 1), vy: s2.rand(-1, 1), vz: s2.rand(1, 2), g: 9, life: 0.25, R: RAMP.kinetic, minor: i % 2 === 1 }));
      land = Math.max(land, ta + dur);
    }
    s.at(at + 0.06, (s2) => {
      if (G.miss) { landMiss(s2, M, ctx, G, G.ground, { pow: 0.3, rad: 0.25 }); return; }
      landHit(s2, M, ctx, G, { pow: 0.75, rad: 0.32 });
      for (let i = 0; i < 3; i++) s2.add({ k: "spark", x: G.body[0] + s2.rand(-0.2, 0.2), y: G.body[1] + s2.rand(-0.15, 0.15), z: G.body[2] + s2.rand(-0.2, 0.2), vx: G.ux * s2.rand(2, 4), vy: G.uy * s2.rand(2, 4), vz: s2.rand(0.5, 2), g: 9, drag: 1, life: 0.3, R: M.R, minor: i > 0 });
    });
    return land;
  });
  s.phases.push("scatter", wide ? "wide cone" : "cone");
  s.period = last + 2.2;
}

/** A sniper's slug: a crack ring at the muzzle, a tracer the whole way in one frame, a hard impact. */
function slug(s, M, ctx) {
  const sf = sfGun(s), t0 = aim(s, M, ctx, { lead: 0.32 }), tr = M.id !== "kinetic" ? M.R : RAMP.light;
  const last = perTarget(ctx, t0, 0.3, (T, at) => {
    const G = geom(ctx, T), to = G.miss ? G.air : G.body;
    s.at(at, (s2) => {
      muzzleFlash(s2, G, M.id !== "kinetic" ? M.R : RAMP.light, 7);
      s2.add({ k: "rgRing", x: G.muzzle[0] + G.ux * 0.12, y: G.muzzle[1] + G.uy * 0.12, z: G.muzzle[2], dx: G.ux, dy: G.uy, dz: 0, r0: 2, r: 9, life: 0.3, R: RAMP.air, update: still });
      s2.add({ k: "rgRing", x: G.muzzle[0] + G.ux * 0.4, y: G.muzzle[1] + G.uy * 0.4, z: G.muzzle[2], dx: G.ux, dy: G.uy, dz: 0, r0: 1, r: 6, life: 0.25, R: RAMP.air, wait: 1 / 12, minor: true, update: still });
      if (!sf) powderSmoke(s2, G, 2);
      s2.shake = Math.max(s2.shake, 0.6);
      if (s2.props.has("kickback") || s2.props.has("unwieldy")) recoil(s2, G, ctx, 1.2);
    });
    // the whole distance in a frame, held two, then the tail runs in
    tracer(s, M, ctx, at, G.muzzle, to, 1 / 120, { span: 1, R: tr, w: 2, lag: 2 / 12, tdur: 3 / 12, trail: true });
    s.at(at + 0.02, (s2) => {
      if (G.miss) { s2.at(s2.t + 0.04, (s3) => landMiss(s3, M, ctx, G, G.ground, { pow: 0.35, rad: 0.18 })); return; }
      landHit(s2, M, ctx, G, { pow: 1.0, rad: 0.3, push: 1.5 });
      s2.shake = Math.max(s2.shake, 1.3);
      // it goes on out the far side: a spray of grit along the shot
      for (let i = 0; i < 6; i++) {
        const q = Math.atan2(G.uy, G.ux) + s2.rand(-0.35, 0.35), sp = s2.rand(4, 7);
        s2.add({ k: "spark", x: G.T.x + G.ux * 0.2, y: G.T.y + G.uy * 0.2, z: G.body[2], vx: Math.cos(q) * sp, vy: Math.sin(q) * sp, vz: s2.rand(-0.5, 1.5), g: 6, drag: 1.5, life: s2.rand(0.2, 0.35), R: RAMP.kinetic, minor: i % 2 === 1 });
      }
    });
    return at + 0.3;
  });
  s.phases.push("crack", "slug", "impact");
  s.period = last + 2;
}

/* ── energy weapons ──────────────────────────────────────────────────── */

/** A laser: an instant straight beam held a few frames, a hot core, a scorch. */
function laser(s, M0, ctx) {
  const M = subst(s, M0, "fire"), t0 = aim(s, M, ctx, { lead: 0.2 }), n = roundsOf(s), boosted = s.props.has("boost");
  const last = perTarget(ctx, t0, 0.24, (T, at) => {
    const G = geom(ctx, T);
    let end = at;
    for (let r = 0; r < n; r++) {
      const ta = at + r * (n > 1 ? 0.12 : 0), final = r === n - 1, pulse = n > 1;
      const to = G.miss ? [G.air[0] + G.px * r * 0.1, G.air[1] + G.py * r * 0.1, G.air[2]] : [G.body[0], G.body[1], G.body[2] + (r - (n - 1) / 2) * 0.08];
      const hold = (pulse ? 2 : G.crit ? 6 : 4) / 12;
      s.at(ta, (s2) => {
        s2.add({ k: "rgMuzzle", x: G.muzzle[0], y: G.muzzle[1], z: G.muzzle[2], dx: G.ux, dy: G.uy, dz: 0, r: 3, life: 2 / 12, R: M.R, update: still });
        const p = s2.add({ k: "rgBeam", x: to[0], y: to[1], z: to[2], a: G.muzzle, b: to, w: boosted || (G.crit && final) ? 2 : 1, hold, life: hold + 2 / 12, R: M.R, glow: true, r: 3, update: still });
        ctx.motif?.carrier?.(s2, M, p);
        s2.light(G.muzzle[0], G.muzzle[1], G.muzzle[2], 1, S(M.R, 0.85), 0.6, hold + 0.1);
        if (!G.miss) s2.light(to[0], to[1], to[2], 1.3, S(M.R, 0.85), 0.8, hold + 0.15);
      });
      s.at(ta + 1 / 60, (s2) => {
        if (G.miss) return;
        if (final) landHit(s2, M, ctx, G, { pow: 0.65, rad: 0.24, at: to });
        else { ctx.release(s2, M, to[0], to[1], to[2], 0.4, 0.16); s2.hit(T.id, 0.6, { x: G.muzzle[0], y: G.muzzle[1] }, M.R); }
        for (let i = 0; i < 2; i++) s2.add({ k: "ember", x: to[0] + s2.rand(-0.1, 0.1), y: to[1] + s2.rand(-0.06, 0.06), z: to[2] + s2.rand(-0.1, 0.1), vz: s2.rand(0.3, 0.7), g: -0.3, drag: 1, life: s2.rand(0.5, 0.8), R: M.R, seed: s2.seedInt(), minor: i > 0 });
        if (final) s2.add({ k: "scorch", x: T.x + G.ux * 0.12, y: T.y + G.uy * 0.12 + 0.12, r: 0.2, life: 2.2, R: RAMP.smoke, seed: 4, debris: true, update: still });
      });
      // a miss scorches a line on the floor where the beam's end dips past
      if (G.miss && final) s.at(ta + 0.02, (s2) => s2.add({ k: "scorch", x: G.ground[0], y: G.ground[1], r: 0.18, life: 2, R: RAMP.smoke, seed: 6, debris: true, update: still }));
      end = ta + hold;
    }
    return end;
  });
  s.phases.push(n > 1 ? "three pulses" : "beam", "scorch");
  s.period = last + 1.8;
}

/** Plasma: a glowing glob, bright and wobbling, that splashes. */
function plasma(s, M0, ctx) {
  const M = subst(s, M0, "electricity"), t0 = aim(s, M, ctx, { lead: 0.22 }), n = roundsOf(s), r0 = s.props.has("boost") ? 6 : 4.8;
  const last = perTarget(ctx, t0, 0.22, (T, at) => {
    const G = geom(ctx, T);
    let end = at;
    for (let r = 0; r < n; r++) {
      const ta = at + r * 0.11, final = r === n - 1;
      const path = arcPath(G, 0.06), dur = travel(G, path.b, 16, 0.16, 0.45);
      s.at(ta, (s2) => { s2.add({ k: "rgMuzzle", x: G.muzzle[0], y: G.muzzle[1], z: G.muzzle[2], dx: G.ux, dy: G.uy, dz: 0, r: 4, life: 2 / 12, R: M.R, update: still }); s2.light(G.muzzle[0], G.muzzle[1], G.muzzle[2], 1, S(M.R, 0.85), 0.7, 0.2); });
      fly(s, M, ctx, ta, path, dur, { k: "rgGlob", r: final ? r0 : r0 * 0.75, R: M.R, hot: true, seed: s.seedInt(), glow: true }, {
        onStep: (s3, q, dt) => {
          M.mod.trail?.(s3, M, { x: q.x, y: q.y, z: q.z, dt: dt * 0.5 });
          if (s3.R() < dt * 60) s3.add({ k: "rgGlob", x: q.x - q.dx * 0.12, y: q.y - q.dy * 0.12, z: q.z, vz: -0.2, drag: 3, r: 2.2, life: 0.16, R: M.R, hot: true, seed: s3.seedInt(), minor: true });
        },
      });
      s.at(ta + dur, (s2) => {
        const at2 = G.miss ? path.b : G.body;
        for (let i = 0; i < 5; i++) {
          const q = s2.rand(0, TAU), sp = s2.rand(1.5, 3.2);
          s2.add({ k: "rgGlob", x: at2[0], y: at2[1], z: Math.max(0.1, at2[2]), vx: Math.cos(q) * sp, vy: Math.sin(q) * sp, vz: s2.rand(0.5, 2), g: 8, drag: 1, r: 1.2, life: s2.rand(0.4, 0.7), R: M.R, hot: true, seed: s2.seedInt(), minor: i > 2 });
        }
        if (G.miss) { landMiss(s2, M, ctx, G, at2, { pow: 0.45, rad: 0.25 }); return; }
        if (final) landHit(s2, M, ctx, G, { pow: 0.85, rad: 0.33 });
        else { ctx.release(s2, M, ...at2, 0.45, 0.2); s2.hit(T.id, 0.6, { x: G.muzzle[0], y: G.muzzle[1] }, M.R); }
        if (final) s2.add({ k: "ring", x: T.x, y: T.y, r: 0.55, life: 0.4, R: M.R, update: still });
      });
      end = ta + dur;
    }
    return end;
  });
  s.phases.push("plasma glob", "splash");
  s.period = last + 2;
}

/** A shock weapon: a jagged arc from the muzzle to the target. */
function zap(s, M0, ctx) {
  const M = subst(s, M0, "electricity"), t0 = aim(s, M, ctx, { lead: 0.2 }), n = roundsOf(s);
  const last = perTarget(ctx, t0, 0.2, (T, at) => {
    const G = geom(ctx, T, { side: 1.0 });
    let end = at;
    for (let r = 0; r < n; r++) {
      const ta = at + r * 0.1, final = r === n - 1, to = G.miss ? G.over : G.body, life = G.crit && final ? 0.34 : 0.22;
      s.at(ta, (s2) => {
        const p = s2.add({ k: "bolt", x: to[0], y: to[1], z: to[2], a: G.muzzle, b: to, life, R: M.R, seed: s2.seedInt(), glow: true, update: still });
        ctx.motif?.carrier?.(s2, M, p);
        if (G.crit && final) s2.add({ k: "bolt", x: to[0], y: to[1], z: to[2], a: G.muzzle, b: [to[0], to[1], to[2] + 0.15], life, R: M.R, seed: s2.seedInt(), update: still });
        // a miss arcs over the shoulder and grounds itself in the floor past
        if (G.miss) s2.add({ k: "bolt", x: G.ground[0], y: G.ground[1], z: 0.05, a: to, b: [G.ground[0], G.ground[1], 0.05], life, R: M.R, seed: s2.seedInt(), glow: true, update: still });
        s2.light(G.muzzle[0], G.muzzle[1], G.muzzle[2], 1.2, S(M.R, 0.85), 0.9, life, { flicker: true });
        s2.light(to[0], to[1], to[2], 1.4, S(M.R, 0.85), 0.9, life + 0.1, { flicker: true });
        for (let i = 0; i < 3; i++) s2.add({ k: "spark", x: G.muzzle[0], y: G.muzzle[1], z: G.muzzle[2], vx: G.ux * s2.rand(1, 3) + s2.rand(-1.5, 1.5), vy: G.uy * s2.rand(1, 3) + s2.rand(-1.5, 1.5), vz: s2.rand(0, 2), g: 7, life: 0.25, R: M.R, minor: i > 0 });
      });
      s.at(ta + 0.03, (s2) => {
        if (G.miss) { landMiss(s2, M, ctx, G, G.ground, { pow: 0.35, rad: 0.18 }); s2.add({ k: "scorch", x: G.ground[0], y: G.ground[1], r: 0.2, life: 2, seed: 8, debris: true, update: still }); return; }
        if (final) landHit(s2, M, ctx, G, { pow: 0.75, rad: 0.28 });
        else { ctx.release(s2, M, ...to, 0.4, 0.15); s2.hit(T.id, 0.6, { x: G.muzzle[0], y: G.muzzle[1] }, M.R); }
      });
      end = ta + life;
    }
    return end;
  });
  s.phases.push("arc", "impact");
  s.period = last + 1.8;
}

/** A sonic weapon: concentric sound rings travelling to the target. */
function sonicwave(s, M0, ctx) {
  const M = subst(s, M0, "sonic"), t0 = aim(s, M, ctx, { lead: 0.2 }), n = s.props.has("boost") ? 5 : 4;
  const last = perTarget(ctx, t0, 0.2, (T, at) => {
    const G = geom(ctx, T), to = G.miss ? G.air : G.body, dur = travel(G, to, 14, 0.18, 0.5);
    for (let k = 0; k < n; k++) {
      const ta = at + k * 0.06;
      s.at(ta, (s2) => {
        const p = s2.add({
          k: "rgArc", x: G.muzzle[0], y: G.muzzle[1], z: G.muzzle[2], dx: G.ux, dy: G.uy, dz: 0, r: 3, life: dur, R: M.R, minor: k === n - 1,
          update(q) { const u = clamp(q.age / dur); q.x = lerp(G.muzzle[0], to[0], u); q.y = lerp(G.muzzle[1], to[1], u); q.z = lerp(G.muzzle[2], to[2], u); q.r = 4 + 8 * u; },
        });
        if (k === 0) ctx.motif?.carrier?.(s2, M, p);
      });
    }
    s.at(at, (s2) => s2.add({ k: "rgRing", x: G.muzzle[0] + G.ux * 0.1, y: G.muzzle[1] + G.uy * 0.1, z: G.muzzle[2], dx: G.ux, dy: G.uy, dz: 0, r0: 2, r: 6, life: 0.25, R: M.R, update: still }));
    s.at(at + dur, (s2) => {
      if (G.miss) { landMiss(s2, M, ctx, G, G.ground, { pow: 0.25, rad: 0.15 }); return; }
      landHit(s2, M, ctx, G, { pow: 0.75, rad: 0.3 });
      for (let k = 0; k < 3; k++) s2.add({ k: "rgRing", x: G.body[0], y: G.body[1], z: G.body[2], dx: G.ux, dy: G.uy, dz: 0, r0: 4, r: 12 * G.sz, life: 0.35, R: M.R, wait: k * 0.07, minor: k === 2, update: still });
    });
    return at + dur + (n - 1) * 0.06;
  });
  s.phases.push("sound rings", "impact");
  s.period = last + 1.8;
}

/** How long a jet's stream takes from the nozzle to its reach, seconds. */
const FLOW = 0.4;

/** A spray stream (flamethrower, cryo, corrosive, poison) using the family's own spray. */
function jet(s, M0, ctx) {
  const M = subst(s, M0, "fire"), t0 = aim(s, M, ctx, { lead: 0.18 }), wide = s.props.has("area");
  const last = perTarget(ctx, t0, 0.22, (T, at) => {
    const G = geom(ctx, T), dist = Math.hypot(T.x - G.muzzle[0], T.y - G.muzzle[1]);
    const half = wide ? 0.3 : 0.09, base = Math.atan2(G.uy, G.ux);
    const dir = G.miss ? base + Math.sign(G.px * -G.uy + G.py * G.ux || 1) * (half + Math.atan2(0.75 * G.sz, dist)) : base;
    const len = G.miss ? dist + 1.2 : dist + 0.3, d = 0.5, hand = G.muzzle;
    s.emit(at, at + d, (s2, _u, dt) => {
      const emit = (k, rate, mk) => {
        // a weapon's stream runs at an even speed and dies exactly at its reach
        for (let i = s2.count(rate * 0.9, dt); i > 0; i--) {
          const q = dir + s2.rand(-half, half), life = FLOW * s2.rand(0.9, 1.1), sp = len / life;
          s2.add({ k, x: hand[0], y: hand[1], z: hand[2] - 0.1, R: M.R, ...mk(), vx: Math.cos(q) * sp, vy: Math.sin(q) * sp, vz: s2.rand(-0.15, 0.15), drag: 0, life });
        }
      };
      M.mod.spray?.(s2, M, { emit, hand, dir, half, len, dt });
    });
    s.at(at, (s2) => { s2.add({ k: "rgMuzzle", x: hand[0], y: hand[1], z: hand[2], dx: G.ux, dy: G.uy, dz: 0, r: 4, life: 3 / 12, R: M.R, update: still }); s2.light(hand[0], hand[1], hand[2], 1.4, S(M.R, 0.85), 0.8, d); });
    const reach = at + FLOW * (dist / len);
    s.at(reach, (s2) => {
      if (G.miss) { landMiss(s2, M, ctx, G, G.ground, { pow: 0.35, rad: 0.25 }); return; }
      landHit(s2, M, ctx, G, { pow: 0.75, rad: 0.32 });
    });
    if (!G.miss) ctx.linger(s, M, T.x, T.y, 0.35, reach + 0.1, reach + 1.3);
    return at + d;
  });
  s.phases.push(wide ? "wide spray" : "stream", "impact");
  s.period = last + 2;
}

/** A psychic beam: a doubled wavy strand with ripples where it lands. */
function mindbeam(s, M0, ctx) {
  const M = subst(s, M0, "mental"), t0 = aim(s, M, ctx, { lead: 0.24 });
  const last = perTarget(ctx, t0, 0.22, (T, at) => {
    const G = geom(ctx, T, { z: 0.9 }), to = G.miss ? G.air : [G.body[0], G.body[1], 0.82 * T.h], hold = G.crit ? 0.55 : 0.4;
    s.at(at, (s2) => {
      const p = s2.add({ k: "rgWave", x: to[0], y: to[1], z: to[2], a: G.muzzle, b: to, dur: 0.12, hold, life: hold + 0.2, amp: G.crit ? 4 : 3, lambda: 15, R: M.R, glow: true, r: 2, update: still });
      ctx.motif?.carrier?.(s2, M, p);
      s2.add({ k: "rgRing", x: G.muzzle[0], y: G.muzzle[1], z: G.muzzle[2], dx: G.ux, dy: G.uy, dz: 0, r0: 2, r: 5, life: 0.3, R: M.R, update: still });
    });
    s.at(at + 0.12, (s2) => {
      if (G.miss) { s2.add({ k: "rgRing", x: to[0], y: to[1], z: to[2], dx: G.ux, dy: G.uy, dz: 0, r0: 2, r: 6, life: 0.3, R: M.R, update: still }); return; }
      landHit(s2, M, ctx, G, { pow: 0.65, rad: 0.26, at: to });
      // ripples run out round the head
      for (let k = 0; k < 3; k++) s2.add({ k: "halo", x: T.x, y: T.y, z: 1.05 * T.h, r: 0.25 + k * 0.08, life: 0.45, R: M.R, wait: k * 0.1, minor: k === 2, update: still });
    });
    return at + hold;
  });
  s.phases.push("psychic beam", "ripples");
  s.period = last + 1.8;
}

/** A gob of spit arcing and splatting. */
function spit(s, M0, ctx) {
  const M = subst(s, M0, "acid"), t0 = aim(s, M, ctx, { lead: 0.2 });
  const last = perTarget(ctx, t0, 0.18, (T, at) => {
    const G = geom(ctx, T, { z: 0.85 }), path = arcPath(G, 0.5), dur = travel(G, path.b, 12, 0.22, 0.55);
    fly(s, M, ctx, at, path, dur, { k: "rgGlob", r: 2.6, R: M.R, spit: true, seed: s.seedInt() }, {
      onStep: (s3, q, dt) => { if (s3.R() < dt * 18) s3.add({ k: "drip", x: q.x, y: q.y, z: q.z, vx: q.dx * 0.5, vy: q.dy * 0.5, g: 6, life: 2, R: M.R, onGround: splat, minor: true }); },
    });
    s.at(at + dur, (s2) => {
      const at2 = G.miss ? path.b : G.body;
      for (let i = 0; i < 5; i++) {
        const q = s2.rand(0, TAU), sp = s2.rand(1, 2.4);
        s2.add({ k: "drip", x: at2[0], y: at2[1], z: Math.max(0.1, at2[2]), vx: Math.cos(q) * sp, vy: Math.sin(q) * sp, vz: s2.rand(0.5, 1.6), g: 7, life: 2, R: M.R, onGround: splat, minor: i > 2 });
      }
      if (G.miss) { landMiss(s2, M, ctx, G, at2, { pow: 0.25, rad: 0.15 }); s2.add({ k: "puddle", x: at2[0], y: at2[1], r: 0.18, life: 2, R: M.R, debris: true, update: still }); return; }
      landHit(s2, M, ctx, G, { pow: 0.65, rad: 0.25 });
      s2.add({ k: "puddle", x: T.x + 0.1, y: T.y + 0.18, r: 0.2, life: 2, R: M.R, debris: true, update: still });
    });
    return at + dur;
  });
  s.phases.push("gob", "splat");
  s.period = last + 2;
}

/** A net or a web: it flies open and wraps the target; a miss lies on the floor. */
function net(s, M, ctx) {
  const t0 = aim(s, M, ctx, { lead: 0.24 }), R = M.id === "kinetic" ? RAMP.linen : M.R;
  const last = perTarget(ctx, t0, 0.2, (T, at) => {
    const G = geom(ctx, T, { z: 0.95 }), path = arcPath(G, 0.4), dur = travel(G, path.b, 10, 0.25, 0.6);
    fly(s, M, ctx, at, path, dur, { k: "rgNet", mode: "fly", open: 0, R }, { onStep: (_s, q, _dt, u) => { q.open = Math.min(1, u * 1.4); } });
    s.at(at + dur, (s2) => {
      if (G.miss) { landMiss(s2, M, ctx, G, path.b, { pow: 0.2, rad: 0.1 }); s2.add({ k: "rgNet", x: path.b[0], y: path.b[1], z: 0, mode: "ground", layer: "flat", r: 0.42, life: 1.8, R, debris: true, update: still }); return; }
      landHit(s2, M, ctx, G, { pow: 0.45, rad: 0.2, push: 0.8 });
      s2.add({ k: "rgNet", x: T.x, y: T.y, z: 0, mode: "wrap", r: 0.4 * G.sz, h: T.h, tight: G.crit ? 0.3 : 0.15, life: G.crit ? 2.2 : 1.8, R, update: still });
    });
    return at + dur;
  });
  s.phases.push("net opens", "wrap");
  s.period = last + 2.2;
}

/** A rocket: a launch kick, a smoke trail, a big blast. */
function missile(s, M0, ctx) {
  const M = subst(s, M0, "fire"), t0 = aim(s, M, ctx, { lead: 0.24 });
  const last = perTarget(ctx, t0, 0.24, (T, at) => {
    const G = geom(ctx, T, { z: 0.95, past: 1.6, side: 0.9 }), path = arcPath(G, 0.35), dur = travel(G, path.b, 9, 0.35, 0.8);
    s.at(at, (s2) => {
      for (let i = 0; i < 3; i++) s2.add({ k: "smoke", x: G.muzzle[0] - G.ux * 0.35, y: G.muzzle[1] - G.uy * 0.35, z: G.muzzle[2], vx: -G.ux * s2.rand(1, 2), vy: -G.uy * s2.rand(1, 2), vz: 0.2, drag: 2.5, r: s2.rand(2.5, 3.5), life: 0.8, lobes: lobes(s2), R: RAMP.metal, tone: 0.55, minor: i > 0 });
      s2.add({ k: "rgMuzzle", x: G.muzzle[0] - G.ux * 0.3, y: G.muzzle[1] - G.uy * 0.3, z: G.muzzle[2], dx: -G.ux, dy: -G.uy, dz: 0, r: 5, life: 3 / 12, R: RAMP.fire, update: still });
      if (s2.props.has("kickback") || s2.props.has("unwieldy")) recoil(s2, G, ctx, 1);
    });
    fly(s, M, ctx, at, path, dur, { k: "rgRocket", R: M.R }, {
      ease: (u) => u * u * (0.6 + 0.4 * u) / 1,
      onStep: (s3, q, dt) => {
        for (let i = s3.count(60, dt); i > 0; i--) { const b = 0.3 + s3.rand(0, 0.25); s3.add({ k: "smoke", x: q.x - q.dx * b, y: q.y - q.dy * b, z: q.z - q.dz * b, vz: 0.12, drag: 2, r: s3.rand(1.8, 2.8), life: s3.rand(0.8, 1.2), lobes: [[0, 0, 1], [0.4, 0.2, 0.6]], R: RAMP.metal, tone: 0.6, minor: i > 1 }); }
      },
    });
    s.at(at + dur, (s2) => {
      const at2 = G.miss ? [path.b[0], path.b[1], 0.15] : G.body;
      s2.shake = Math.max(s2.shake, G.miss ? 1.4 : 2.2);
      s2.add({ k: "ring", x: at2[0], y: at2[1], r: 1.2, life: 0.55, R: M.R, broken: true, seed: 31, update: still });
      for (let i = 0; i < 4; i++) s2.add({ k: "smoke", x: at2[0] + s2.rand(-0.35, 0.35), y: at2[1] + s2.rand(-0.2, 0.2), z: 0.3, vx: s2.rand(-0.6, 0.6), vz: s2.rand(0.4, 0.9), g: -0.1, drag: 1.4, r: s2.rand(4, 6.5), life: s2.rand(1.4, 2), lobes: lobes(s2), R: RAMP.metal, tone: 0.45, wait: 0.15, minor: i > 1 });
      if (G.miss) { ctx.release(s2, M, ...at2, 0.7, 0.35); propsAt(s2, M, ctx, G, at2, false); return; }
      landHit(s2, M, ctx, G, { pow: 1.1, rad: 0.6, push: 1.4 });
    });
    return at + dur;
  });
  s.phases.push("launch", "smoke trail", "blast");
  s.period = last + 2.3;
}

export const RANGED = Object.freeze({
  arrow: (s, M, ctx) => shaft(s, M, ctx),
  bolt: (s, M, ctx) => shaft(s, M, ctx, { bolt: true }),
  bullet, pellets, slug, stone, dart, thrown, rock, bomb, grenade,
  laser, plasma, zap, sonicwave, jet, mindbeam, spit, net, missile,
});

/* ── the shapes only ranged Strikes draw ─────────────────────────────── */

/** The screen direction of a world direction at a particle, unit (a fallback when it points at the camera). */
function scr(v, p, dx, dy, dz) {
  const [ax, ay] = v.ap(p.x, p.y, p.z), [bx, by] = v.ap(p.x + dx * 0.3, p.y + dy * 0.3, p.z + dz * 0.3), l = Math.hypot(bx - ax, by - ay);
  return l < 0.4 ? [1, 0, ax, ay] : [(bx - ax) / l, (by - ay) / l, ax, ay];
}
/** The one-pixel step across a line running (dx, dy): thick lines without gaps. */
const across = (dx, dy) => (Math.abs(dx) >= Math.abs(dy) ? [0, 1] : [1, 0]);

/** Small bitmaps turned in quarter turns. */
function stamp(P, x, y, rows, pal, turn = 0, o = 1) {
  const h = rows.length, w = rows[0].length, cx = (w - 1) / 2, cy = (h - 1) / 2;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const c = pal[rows[j][i]]; if (!c) continue;
    let dx = i - cx, dy = j - cy;
    for (let k = 0; k < turn; k++) [dx, dy] = [-dy, dx];
    P.px(Math.round(x + dx), Math.round(y + dy), c, o);
  }
}

const FLASK = ["...c...", "..ggg..", "...g...", "..glg..", ".glllg.", "glllhlg", "gllllld", ".gdddg."];
const GRENADE = [".bb.", "bppb", "bmmb", "bppb", ".bb."];
const PEBBLE = [".hm.", "hmmd", "mmdd", ".dd."];

registerShapes({
  /** An arrow (or a heavier crossbow quarrel): a shaft, a metal head, fletching. Stuck ones quiver. */
  rgArrow(v, P, p) {
    const fr = Math.floor(p.age * 12);
    const [sx, sy, hx, hy] = scr(v, p, p.dx, p.dy, p.dz);
    let [tx, ty] = v.ap(p.x - p.dx * p.len, p.y - p.dy * p.len, p.z - p.dz * p.len);
    if (p.quiver && fr < 6) { const w = (fr % 2 ? 1 : -1) * (fr < 3 ? 1.5 : 0.8); tx += -sy * w; ty += sx * w; }
    const [ax, ay] = across(sx, sy), head = S(p.H, 0.95), shaftC = S(RAMP.wood, p.bolt ? 0.45 : 0.6), shaftHi = S(RAMP.wood, 0.75);
    P.line(tx, ty, hx, hy, null, 1, 1, (f) => (f > 0.82 ? head : shaftC));
    if (p.bolt) P.line(tx + ax, ty + ay, hx - sx * 2 + ax, hy - sy * 2 + ay, null, 1, 1, () => shaftHi);
    // the head: a point and two barbs
    const qx = -sy, qy = sx, bx = hx - sx * 2, by = hy - sy * 2;
    P.px(hx, hy, p.stuck ? head : WHITE, 1);
    P.px(bx + qx * 1.2, by + qy * 1.2, S(p.H, 0.7), 1); P.px(bx - qx * 1.2, by - qy * 1.2, S(p.H, 0.7), 1);
    // fletching at the tail
    const F1 = S(p.F, 0.85), F2 = S(p.F, 0.6);
    for (const k of p.bolt ? [0.5] : [0.5, 2]) {
      const fx = tx + sx * k, fy = ty + sy * k;
      P.px(fx + qx * 1.4, fy + qy * 1.4, k < 1 ? F2 : F1, 1); P.px(fx - qx * 1.4, fy - qy * 1.4, k < 1 ? F2 : F1, 1);
    }
  },
  /** A tracer: a white-hot head and a coloured tail; `w` 2 is a heavy round. */
  rgTracer(v, P, p) {
    const h = clamp(p.age / p.dur), tl = clamp((p.age - p.lag) / p.tdur);
    if (tl >= 1) return;
    const pt = (u) => v.ap(lerp(p.a[0], p.b[0], u), lerp(p.a[1], p.b[1], u), lerp(p.a[2], p.b[2], u));
    const [hx, hy] = pt(h), [tx, ty] = pt(Math.max(tl, h - p.span)), fr = Math.floor(p.age * 12);
    const body = fr === 0 ? S(p.R, 1) : S(p.R, 0.9), tail = S(p.R, 0.62);
    P.line(tx, ty, hx, hy, null, 1, 1, (f) => (f > 0.8 ? WHITE : f > 0.35 ? body : tail));
    if (p.w > 1) { const [ax, ay] = across(hx - tx, hy - ty); P.line(tx + ax, ty + ay, hx + ax, hy + ay, null, 1, 1, (f) => (f > 0.25 ? (fr === 0 ? WHITE : S(p.R, 0.75)) : null)); }
  },
  /** A muzzle flash: a sharp star thrown along the barrel, white for one frame. */
  rgMuzzle(v, P, p) {
    const fr = Math.floor(p.age * 12); if (fr > 2) return;
    const [sx, sy, x0, y0] = scr(v, p, p.dx, p.dy, p.dz), x = Math.round(x0), y = Math.round(y0), qx = -sy, qy = sx;
    const k = p.r * [1, 0.75, 0.4][fr], c0 = fr === 0 ? WHITE : S(p.R, fr === 1 ? 1 : 0.75), c1 = S(p.R, fr === 0 ? 1 : 0.7);
    const ray = (dx, dy, L) => P.line(x, y, x + dx * L, y + dy * L, null, 2, 1, (f) => (f < 0.45 ? c0 : c1));
    ray(sx, sy, k);
    ray(qx, qy, k * 0.4); ray(-qx, -qy, k * 0.4);
    ray((sx + qx) * 0.7, (sy + qy) * 0.7, k * 0.55); ray((sx - qx) * 0.7, (sy - qy) * 0.7, k * 0.55);
    ray(-sx, -sy, k * 0.2);
    if (fr === 0) for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) if (Math.abs(i) + Math.abs(j) < 2) P.px(x + i, y + j, WHITE, 2);
  },
  /** A spent casing: a brass sliver tumbling. */
  rgCasing(v, P, p) {
    const [x, y] = v.ap(p.x, p.y, p.z), fr = Math.floor(p.age * 24), c = S(RAMP.holy, 0.8), c2 = S(RAMP.holy, 0.5);
    const lying = p.z <= 0.001 && Math.abs(p.vz) < 0.01;
    P.px(x, y, c, 1);
    if (lying || fr % 2) P.px(x + 1, y, c2, 1); else P.px(x, y - 1, c2, 1);
  },
  /** A thrown weapon turning end over end: a haft and a head. */
  rgSpin(v, P, p) {
    const turning = !p.rest && (p.spinT == null || p.age < p.spinT);
    const th = turning ? Math.floor(p.age * 24) * (TAU / 8) + p.ang : (p.spinT != null ? Math.floor(p.spinT * 24) * (TAU / 8) + p.ang : p.ang);
    const [gx, gy] = norm(p.dx, p.dy), L = p.len / 2;
    const e = v.kind === "side" ? [0, 0, 1] : [-gy, gx, 0];
    const ax = Math.cos(th) * gx + Math.sin(th) * e[0], ay = Math.cos(th) * gy + Math.sin(th) * e[1], az = Math.sin(th) * e[2];
    const [x0, y0] = v.ap(p.x - ax * L, p.y - ay * L, p.z - az * L), [x1, y1] = v.ap(p.x + ax * L, p.y + ay * L, p.z + az * L);
    P.line(x0, y0, x1, y1, null, 1, 1, (f) => (f > 0.72 ? S(p.H, 0.9) : S(RAMP.wood, 0.55)));
    const l = Math.hypot(x1 - x0, y1 - y0) || 1, qx = -(y1 - y0) / l, qy = (x1 - x0) / l;
    for (let k = 1; k <= 2; k++) { P.px(x1 + qx * k, y1 + qy * k, S(p.H, k === 1 ? 0.8 : 0.6), 1); P.px(x1 - (x1 - x0) / l + qx * k, y1 - (y1 - y0) / l + qy * k, S(p.H, 0.55), 1); }
    if (turning && Math.floor(p.age * 12) % 3 === 0) P.px(x1, y1, WHITE, 1);
  },
  /** A shuriken or a dart: four points turning; a stuck one is still. */
  rgStar(v, P, p) {
    const [x0, y0] = v.ap(p.x, p.y, p.z), x = Math.round(x0), y = Math.round(y0), turn = p.stuck ? 1 : Math.floor(p.age * 24) % 2;
    const arms = turn ? [[1, 1], [-1, 1], [1, -1], [-1, -1]] : [[1, 0], [-1, 0], [0, 1], [0, -1]];
    P.px(x, y, S(p.H, 0.45), 1);
    for (const [dx, dy] of arms) { P.px(x + dx, y + dy, S(p.H, 0.95), 1); P.px(x + dx * 2, y + dy * 2, S(p.H, 0.7), 1); }
  },
  /** A sling stone. */
  rgPebble(v, P, p) {
    const [x, y] = v.ap(p.x, p.y, p.z);
    stamp(P, x, y, PEBBLE, { h: S(p.R, 0.95), m: S(p.R, 0.7), d: S(p.R, 0.45) }, p.whirl ? 0 : Math.floor(p.age * 12) % 4);
  },
  /** A boulder: lit from the top left, chipped, turning as it flies. */
  rgBoulder(v, P, p) {
    const [cx, cy] = v.ap(p.x, p.y, p.z), r = p.r, fr = Math.floor(p.age * 12), rolling = Math.abs(p.vx) + Math.abs(p.vy) > 0.05 || !!p.update;
    const th = rolling ? fr * 0.55 : 0, c = Math.cos(th), sn = Math.sin(th);
    P.shade(cx - r - 1, cy - r - 1, cx + r + 1, cy + r + 1, (x, y) => {
      const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy), e = r * (0.88 + 0.18 * pnoise(Math.atan2(dy, dx) - th, 7, p.seed));
      if (d > e) return null;
      if (d > e - 1.1) return S(p.R, 0.25);
      const lx = dx * c + dy * sn, ly = -dx * sn + dy * c, chip = hash(Math.floor(lx / 2.5 + 9), Math.floor(ly / 2.5 + 9), p.seed) > 0.78;
      const lit = (-dx - dy) / (r * 1.4);
      return S(p.R, 0.5 + lit * 0.35 - (chip ? 0.17 : 0));
    }, 1);
  },
  /** An alchemist's flask: liquid, a glass neck, a cork, tumbling in quarter turns. */
  rgFlask(v, P, p) {
    const [x, y] = v.ap(p.x, p.y, p.z), turn = Math.floor(p.age * 16) % 4;
    stamp(P, x, y, FLASK, { c: S(RAMP.wood, 0.6), g: S(RAMP.air, 0.9), l: S(p.R, 0.75), h: WHITE, d: S(p.R, 0.5) }, turn, 2);
  },
  /** A grenade, its band in the material's colour; when it lies beeping, a light blinks faster. */
  rgGrenade(v, P, p) {
    const [x, y] = v.ap(p.x, p.y, p.z), fr = Math.floor(p.age * 12);
    const on = p.beep ? fr % (fr < 3 ? 3 : 2) === 0 : false;
    stamp(P, x, y, GRENADE, { b: S(RAMP.metal, 0.6), p: S(RAMP.metal, 0.85), m: S(p.R, 0.75) }, p.beep ? 0 : Math.floor(p.age * 16) % 4, 2);
    P.px(Math.round(x), Math.round(y) - 3, on ? WHITE : S(RAMP.unholy, p.beep ? 0.55 : 0.4), 2);
    if (on) { P.px(Math.round(x) - 1, Math.round(y) - 3, S(RAMP.unholy, 0.9), 2); P.px(Math.round(x) + 1, Math.round(y) - 3, S(RAMP.unholy, 0.9), 2); P.px(Math.round(x), Math.round(y) - 4, S(RAMP.unholy, 0.9), 2); }
  },
  /** A glob: plasma (a white-hot core) or spit (a wet highlight), its rim wobbling. */
  rgGlob(v, P, p) {
    const [cx, cy] = v.ap(p.x, p.y, p.z), fr = Math.floor(p.age * 12), r = p.r;
    if (r <= 1.3) { P.px(cx, cy, p.hot ? S(p.R, 1) : S(p.R, 0.8), 1); P.px(cx + 1, cy, S(p.R, 0.6), 1); return; }
    P.shade(cx - r - 2, cy - r - 2, cx + r + 2, cy + r + 2, (x, y) => {
      const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy), q = Math.atan2(dy, dx), e = r * (1 + 0.1 * Math.sin(2 * q + fr * 1.9 + p.seed) + 0.06 * Math.sin(3 * q - fr * 2.3));
      if (d > e) return null;
      if (p.hot) return d < e * 0.42 ? WHITE : d > e - 1.1 ? S(p.R, 0.62) : S(p.R, 0.92);
      if (dx < -r * 0.15 && dy < -r * 0.15 && d < e * 0.6) return S(p.R, 1);
      return d > e - 1.1 ? S(p.R, 0.35) : S(p.R, 0.65);
    }, 1);
  },
  /** A sound front: an arc bulging the way it travels. */
  rgArc(v, P, p) {
    const [sx, sy, x, y] = scr(v, p, p.dx, p.dy, p.dz), qx = -sy, qy = sx, R = p.r, a = 1 - clamp(p.age / p.life) * 0.6;
    const n = Math.ceil(R * 3);
    for (let i = 0; i <= n; i++) {
      const q = -1.15 + (2.3 * i) / n, cq = Math.cos(q), sq = Math.sin(q);
      for (const [k, t] of [[0, 0.95], [1, 0.62]]) P.dot(x + sx * cq * (R - k) * 0.45 + qx * sq * (R - k), y + sy * cq * (R - k) * 0.45 + qy * sq * (R - k), S(p.R, t), a, 1);
    }
  },
  /** A ring standing across the shot (a muzzle crack, a concussive shock, a ripple). */
  rgRing(v, P, p) {
    const u = clamp(p.age / p.life), [sx, sy, x, y] = scr(v, p, p.dx, p.dy, p.dz), qx = -sy, qy = sx, R = p.r0 + (p.r - p.r0) * easeOut(u);
    const n = Math.ceil(TAU * R * 1.2);
    for (let i = 0; i < n; i++) {
      const q = (i / n) * TAU, cq = Math.cos(q), sq = Math.sin(q);
      P.dot(x + qx * cq * R + sx * sq * R * 0.35, y + qy * cq * R + sy * sq * R * 0.35, S(p.R, sq > 0 ? 0.95 : 0.65), 1 - u, 1);
    }
  },
  /** A laser beam: a white core, coloured edges, a dithered outer glow; it narrows out. */
  rgBeam(v, P, p) {
    const fr = Math.floor(p.age * 12), [ax, ay] = v.ap(...p.a), [bx, by] = v.ap(...p.b), [ox, oy] = across(bx - ax, by - ay);
    const fade = p.age > p.hold ? (p.age - p.hold) / Math.max(1e-3, p.life - p.hold) : 0;
    const w = fade > 0.5 ? 0 : fade > 0 ? Math.min(1, p.w) : p.w;
    if (w >= 2) for (const sg of [-2, 2]) P.line(ax + ox * sg, ay + oy * sg, bx + ox * sg, by + oy * sg, null, 0, 1, (f, i) => ((i + fr) % 2 ? S(p.R, 0.5) : null));
    if (w >= 1) for (const sg of [-1, 1]) P.line(ax + ox * sg, ay + oy * sg, bx + ox * sg, by + oy * sg, null, 1, 1, () => (fr === 0 ? S(p.R, 1) : S(p.R, 0.7)));
    P.line(ax, ay, bx, by, null, 2, 1, () => (fade > 0.5 ? S(p.R, 0.95) : WHITE));
    if (fade === 0) for (let j = -w - 1; j <= w + 1; j++) P.px(bx + ox * j, by + oy * j, j === 0 ? WHITE : S(p.R, 1), 2);
  },
  /** A psychic beam: two strands winding round each other, a white node where they cross. */
  rgWave(v, P, p) {
    const fr = Math.floor(p.age * 12), [ax, ay] = v.ap(...p.a), [bx, by] = v.ap(...p.b), L = Math.hypot(bx - ax, by - ay);
    if (L < 1) return;
    const sx = (bx - ax) / L, sy = (by - ay) / L, qx = -sy, qy = sx;
    const reach = clamp(p.age / p.dur) * L, gone = p.age > p.hold ? clamp((p.age - p.hold) / Math.max(1e-3, p.life - p.hold)) * L : 0;
    for (let i = Math.floor(gone); i <= reach; i++) {
      const env = Math.min(1, i / 4, (L - i) / 4 + 0.5), y1 = Math.sin((i / p.lambda) * TAU - fr * 1.7) * p.amp * env;
      const x0 = ax + sx * i, y0 = ay + sy * i;
      P.px(x0 + qx * y1, y0 + qy * y1, S(p.R, 0.95), 1);
      P.px(x0 - qx * y1, y0 - qy * y1, S(p.R, 0.65), 1);
      if (Math.abs(y1) < 0.5) P.px(x0, y0, WHITE, 1);
    }
  },
  /** A net or a web: a diamond lattice flying open, wrapped round a creature, or lying flat. */
  rgNet(v, P, p) {
    const fr = Math.floor(p.age * 12), [cx, cy] = v.ap(p.x, p.y, p.z), rope = S(p.R, 0.78), knot = S(p.R, 0.95);
    const cell = (ix, iy, cx2, cy2, sp) => {
      const a = ((ix - cx2) - (iy - cy2)) % sp, b = ((ix - cx2) + (iy - cy2)) % sp;
      const on1 = a === 0, on2 = b === 0;
      return on1 && on2 ? knot : on1 || on2 ? rope : null;
    };
    if (p.mode === "fly") {
      const half = Math.round(2 + p.open * 7), X = Math.round(cx), Y = Math.round(cy);
      P.shade(X - half, Y - half, X + half, Y + half, (_x, _y, ix, iy) => (Math.abs(ix - X) + Math.abs(iy - Y) <= half ? (Math.abs(ix - X) + Math.abs(iy - Y) === half ? knot : cell(ix, iy, X, Y, 3)) : null), 1);
      return;
    }
    const a = fadeIn(p.age, p.life);
    if (p.mode === "ground") {
      const rx = p.r * v.aps, ry = Math.max(2, rx * v.sq), X = Math.round(cx), Y = Math.round(cy);
      P.shade(X - rx, Y - ry, X + rx, Y + ry, (_x, _y, ix, iy) => {
        const dx = (ix - X) / rx, dy = (iy - Y) / ry; if (dx * dx + dy * dy > 1) return null;
        const c = cell(ix, iy, X, Y, 3); return c ? { c, a } : null;
      }, 0);
      return;
    }
    // wrapped: the lattice over the body, cinching in for the first frames
    const [, ty] = v.ap(p.x, p.y, p.h * 0.95), tight = Math.min(1, fr / 3) * p.tight, W = Math.round(p.r * v.aps * (1 - tight)), X = Math.round(cx), Y0 = Math.round(ty), Y1 = Math.round(cy);
    P.shade(X - W, Y0, X + W, Y1, (_x, _y, ix, iy) => {
      const edge = Math.abs(ix - X) === W || iy === Y0;
      const c = edge ? (iy % 2 ? rope : null) : cell(ix, iy, X, Y1, 4);
      return c ? { c, a } : null;
    }, 1);
  },
  /** A rocket: a nose, a body, fins and a flickering exhaust. */
  rgRocket(v, P, p) {
    const fr = Math.floor(p.age * 12), [sx, sy, x0, y0] = scr(v, p, p.dx, p.dy, p.dz), x = Math.round(x0), y = Math.round(y0), qx = -sy, qy = sx;
    const [ox, oy] = across(sx, sy);
    P.line(x - sx * 7, y - sy * 7, x, y, null, 1, 1, (f) => (f > 0.85 ? S(p.R, 0.9) : S(RAMP.metal, 0.85)));
    P.line(x - sx * 7 + ox, y - sy * 7 + oy, x - sx + ox, y - sy + oy, null, 1, 1, (f) => (f > 0.8 ? S(p.R, 0.7) : S(RAMP.metal, 0.55)));
    for (const k of [-1.6, 2.6]) P.px(x - sx * 7 + qx * k, y - sy * 7 + qy * k, S(RAMP.metal, 0.45), 1);
    const L = 3 + (fr % 2) * 2;
    P.line(x - sx * 8, y - sy * 8, x - sx * (8 + L), y - sy * (8 + L), null, 2, 1, (f) => (f < 0.4 ? WHITE : S(RAMP.fire, 0.85)));
  },
  /** A tech weapon's lock: four corner brackets closing on the target, blinking. */
  rgReticle(v, P, p) {
    const fr = Math.floor(p.age * 12); if (fr % 4 === 3) return;
    const [x0, y0] = v.ap(p.x, p.y, p.z), x = Math.round(x0), y = Math.round(y0), h = Math.round(p.r * v.aps * (1 + 0.6 * Math.max(0, 1 - fr / 2))), c = S(p.R, 0.95);
    for (const [sx, sy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      const cx = x + sx * h, cy = y + sy * h;
      P.px(cx, cy, c, 2); P.px(cx - sx, cy, c, 2); P.px(cx - sx * 2, cy, c, 2); P.px(cx, cy - sy, c, 2); P.px(cx, cy - sy * 2, c, 2);
    }
    if (fr >= 2) P.px(x, y, c, 2);
  },
}, { flat: [] });

/** A decal's alpha: in over two frames, out over its last third. */
function fadeIn(age, life) {
  const u = age / life;
  return Math.min(1, (Math.floor(age * 12) + 1) / 2) * (u > 0.66 ? 1 - (u - 0.66) / 0.34 : 1);
}
