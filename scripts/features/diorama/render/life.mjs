/**
 * Diorama — token life: how a standee walks, falls, lands and hovers.
 *
 * Pure: no three, no DOM, no world. The standees layer builds a plan when a
 * move starts and reads a pose from it every frame; the check tool drives the
 * same functions.
 *
 * A walk is one hop per grid step, each step timed by the move's own pace
 * (TIMING.standeeStep per step), so a hop lasts exactly as long as the step it
 * carries. The whole miniature lifts (base and all) on a gravity arc and lands
 * on the ground under the next square. A step off a ledge (a drop of more than
 * FALL_STEP) walks to the edge and falls from there under constant gravity,
 * so it accelerates and lands exactly on the ground below. Every landing is a
 * contact: it squashes the card a little, springing back over
 * TIMING.standeeSettle, and raises a dust puff sized by how hard it landed.
 * A flyer glides; an idle flyer breathes on its stand (hoverPose).
 *
 * Units: cells (world units); times in ms.
 */

import { TIMING } from "../constants.mjs";
import { clamp01, ease, lerp } from "./tween.mjs";

/** Hop height for a one-cell step (cells); scaled by the step's length. */
export const HOP_H = 0.085;
/** The old hop (token life off): a fixed |sin| bounce, card only. */
export const HOP_LEGACY = 0.14;
/** A drop of more than this between neighbouring points is a ledge (cells): the default 2.5 ft step. */
export const FALL_STEP = 0.5;
/** Card squash at a contact, as a fraction of its height. */
export const SQUASH = Object.freeze({ step: 0.025, land: 0.05, fallBase: 0.06, fallPerCell: 0.03, fallMax: 0.13, drop: 0.055, touch: 0.04 });
/** Dust strength at a contact (0 = none, 1 = a full puff). */
export const DUST = Object.freeze({ step: 0.28, land: 0.6, fallBase: 0.75, fallPerCell: 0.15, fallMax: 1.2, drop: 0.65, touch: 0.5 });
/** A flyer's hover: vertical breathe (cells) and roll (radians); BREATHS and SWAYS whole cycles per TIMING.hoverLoop. */
export const HOVER = Object.freeze({ lift: 0.045, roll: 0.02, breaths: 2, sways: 1 });
/** Feet this far above the ground are in the air (StandeesLayer.isFlying). */
const FLY_MIN = 0.25;
const TAU = Math.PI * 2;

const airborne = (p) => Number.isFinite(p.g) && p.y - p.g >= FLY_MIN - 1e-6;

/**
 * A move as segments of time. Each segment ends in a contact unless `land` is 0.
 * @param {{x:number,z:number,y:number,g?:number}} from  feet (y) and ground (g), cells
 * @param {{x:number,z:number,y:number,g?:number}} to
 * @param {{stepMs?:number, fallMs?:number, flyer?:boolean, maxSteps?:number,
 *   ground?:((x:number,z:number)=>number)|null}} [o]
 *   flyer: the figure is on its flight stand; ground: the ground (cells) at a point, or NaN.
 * @returns {{ms:number, steps:number, hops:number, flyer:boolean, from:object, to:object, segs:object[]}}
 *   seg: { kind:"hop"|"fall"|"glide", t0, t1, x0,z0,y0,g0, x1,z1,y1,g1, h, land, dust }
 */
export function planMove(from, to, o = {}) {
  const stepMs = o.stepMs ?? TIMING.standeeStep;
  const fallMs = o.fallMs ?? TIMING.standeeFall;
  const maxSteps = o.maxSteps ?? 12;
  const ground = typeof o.ground === "function" ? o.ground : null;
  const fg = Number.isFinite(from.g) ? from.g : from.y, tg = Number.isFinite(to.g) ? to.g : to.y;
  const d = Math.hypot(to.x - from.x, to.z - from.z);
  const steps = Math.max(1, Math.min(maxSteps, Math.round(d)));
  const plan = { ms: 0, steps, hops: d >= 0.5 ? steps : 0, flyer: false, from, to, segs: [] };
  const toAir = airborne({ y: to.y, g: tg });
  let t = 0;
  const seg = (s) => { s.t0 = t; t += s.ms; s.t1 = t; plan.segs.push(s); };

  // A flyer glides (and lands softly if it comes down to the ground).
  if (o.flyer || toAir) {
    plan.flyer = true;
    const landed = !toAir;
    seg({ kind: "glide", ms: stepMs * steps, x0: from.x, z0: from.z, y0: from.y, g0: fg, x1: to.x, z1: to.z, y1: to.y, g1: tg,
      h: 0, land: landed ? SQUASH.touch : 0, dust: landed ? DUST.touch : 0 });
    plan.ms = t;
    return plan;
  }

  // A walker: the ground under every step, from the terrain where it is known.
  const at = (k) => ({ x: lerp(from.x, to.x, k), z: lerp(from.z, to.z, k) });
  const heights = new Array(steps + 1);
  heights[0] = from.y;
  heights[steps] = to.y;
  const drop = from.y - to.y;
  for (let i = 1; i < steps; i++) {
    const p = at(i / steps);
    const gi = ground ? ground(p.x, p.z) : NaN;
    // Unknown ground: a drop past a step happens at the last step (walk, then step off).
    heights[i] = Number.isFinite(gi) ? gi : drop > FALL_STEP ? from.y : lerp(from.y, to.y, i / steps);
  }
  const len = d / steps;
  for (let i = 0; i < steps; i++) {
    const a = at(i / steps), b = at((i + 1) / steps);
    const y0 = heights[i], y1 = heights[i + 1];
    const last = i === steps - 1;
    const edge = y0 - y1 > FALL_STEP + 1e-6 ? ledgeAt(ground, at, i, steps, y0, y1, len) : -1;
    if (edge >= 0) {
      // A ledge: walk to its edge, then fall under gravity onto the ground below.
      let f = edge;
      if (len < 0.5) f = 0;   // a nudge off an edge: just drop
      const ex = lerp(a.x, b.x, f), ez = lerp(a.z, b.z, f);
      if (f > 0.05) seg({ kind: "hop", ms: stepMs * f, x0: a.x, z0: a.z, y0, g0: y0, x1: ex, z1: ez, y1: y0, g1: y0,
        h: HOP_H * Math.max(0.35, len * f), land: 0, dust: 0 });
      const h = y0 - y1;
      seg({ kind: "fall", ms: fallMs * Math.sqrt(h), x0: ex, z0: ez, y0, g0: y0, x1: b.x, z1: b.z, y1, g1: y1,
        h: 0, land: Math.min(SQUASH.fallMax, SQUASH.fallBase + SQUASH.fallPerCell * h),
        dust: Math.min(DUST.fallMax, DUST.fallBase + DUST.fallPerCell * h) });
      continue;
    }
    // A hop: a gravity arc from this square's ground to the next one's, high
    // enough to clear a rise.
    const rise = Math.max(0, y1 - y0);
    seg({ kind: "hop", ms: stepMs, x0: a.x, z0: a.z, y0, g0: y0, x1: b.x, z1: b.z, y1, g1: y1,
      h: HOP_H * Math.min(1.4, Math.max(0.35, len)) + rise * 0.5,
      land: last ? SQUASH.land : SQUASH.step, dust: last ? DUST.land : DUST.step });
  }
  plan.ms = t;
  return plan;
}

/**
 * Where along step i (0..1) a walker steps off a ledge, or -1 when the step
 * only goes down stairs or a ramp (no single drop past FALL_STEP). Without the
 * terrain, half way. The edge is found by bisection, and the fall starts just
 * past it, so the figure's centre is over the drop before it drops.
 */
function ledgeAt(ground, at, i, steps, y0, y1, len) {
  if (!ground || len <= 1e-6) return 0.5;
  const N = 8;
  const gAt = (f) => {
    if (f >= 1) return y1;
    const q = at((i + f) / steps);
    const v = ground(q.x, q.z);
    return Number.isFinite(v) ? v : y0;
  };
  let prev = y0;
  for (let j = 1; j <= N; j++) {
    const cur = gAt(j / N);
    if (prev - cur > FALL_STEP + 1e-6) {
      const top = prev;
      let a = (j - 1) / N, b = j / N;
      for (let k = 0; k < 8; k++) { const m = (a + b) / 2; if (top - gAt(m) > FALL_STEP + 1e-6) b = m; else a = m; }
      return Math.min(0.95, b + 0.02);
    }
    prev = cur;
  }
  return -1;
}

/**
 * Where a planned move is `tms` ms in, written into `out` (no allocation).
 * out.y is the ground path (the feet on the ground), out.lift the hop's arc
 * above it (the whole miniature rises), out.hop the old card-only bounce
 * (token life off), out.seg the segment index.
 * @param {ReturnType<typeof planMove>} plan
 * @param {number} tms
 * @param {object} out
 * @param {boolean} [life]  false: the old linear move with a fixed |sin| hop
 */
export function poseAt(plan, tms, out, life = true) {
  out.lift = 0; out.hop = 0;
  if (!life) {
    const k = plan.ms > 0 ? clamp01(tms / plan.ms) : 1;
    const { from, to } = plan;
    const fg = Number.isFinite(from.g) ? from.g : from.y, tg = Number.isFinite(to.g) ? to.g : to.y;
    out.x = lerp(from.x, to.x, k); out.z = lerp(from.z, to.z, k);
    out.y = lerp(from.y, to.y, k); out.g = lerp(fg, tg, k);
    if (plan.hops) out.hop = HOP_LEGACY * Math.abs(Math.sin(Math.PI * plan.hops * k));
    out.seg = -1;
    return out;
  }
  const segs = plan.segs;
  let i = 0;
  while (i < segs.length - 1 && tms >= segs[i].t1) i++;
  const s = segs[i];
  const u = s.t1 > s.t0 ? clamp01((tms - s.t0) / (s.t1 - s.t0)) : 1;
  out.seg = i;
  if (s.kind === "fall") {
    // constant gravity: y = y0 − drop·u², so it accelerates and lands exactly on y1
    const w = ease.outQuad(u);
    out.x = lerp(s.x0, s.x1, w); out.z = lerp(s.z0, s.z1, w);
    out.y = u >= 1 ? s.y1 : s.y0 - (s.y0 - s.y1) * u * u;
    out.g = out.y;
  } else if (s.kind === "glide") {
    const w = ease.inOutCubic(u);
    out.x = lerp(s.x0, s.x1, w); out.z = lerp(s.z0, s.z1, w);
    out.y = lerp(s.y0, s.y1, w); out.g = lerp(s.g0, s.g1, w);
  } else {
    out.x = lerp(s.x0, s.x1, u); out.z = lerp(s.z0, s.z1, u);
    out.y = u >= 1 ? s.y1 : lerp(s.y0, s.y1, u); out.g = out.y;
    // a gravity arc: zero at both feet, the apex mid-step
    out.lift = 4 * s.h * u * (1 - u);
  }
  return out;
}

/**
 * The card's squash `ms` after a contact of strength `amp`: the full squash at
 * the contact, springing back (ease-out) to none over TIMING.standeeSettle.
 */
export function squashAt(amp, ms) {
  if (!(amp > 0) || !(ms >= 0)) return 0;
  const v = ms / TIMING.standeeSettle;
  return v >= 1 ? 0 : amp * (1 - ease.outCubic(v));
}

/**
 * A flyer's hover at `now` (ms): a slow breathe up and down and a slight roll,
 * whole cycles per TIMING.hoverLoop so the loop never snaps. `phase` (radians)
 * keeps two flyers from breathing in step. Written into `out`.
 * @returns {{dy:number, roll:number}}
 */
export function hoverPose(now, phase, out = { dy: 0, roll: 0 }) {
  const P = TIMING.hoverLoop;
  const u = (((now % P) + P) % P) / P;
  out.dy = HOVER.lift * Math.sin(u * TAU * HOVER.breaths + phase);
  out.roll = HOVER.roll * Math.sin(u * TAU * HOVER.sways + phase * 1.7);
  return out;
}
