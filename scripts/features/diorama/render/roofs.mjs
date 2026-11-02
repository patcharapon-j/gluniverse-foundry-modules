/**
 * Diorama — roofs opening and closing. See docs/DIORAMA_BUILDINGS.md.
 *
 * The view decides what each roof should show (view/roofs.mjs roofTarget);
 * this tweens every roof to it on the frame clock and adds the one rule that
 * needs the camera: a roof standing between the camera and one of the viewer's
 * own figures fades to ROOF_CAMERA_ALPHA, so a figure is never lost under the
 * eaves of the house next door.
 *
 *   const f = new RoofFader();
 *   f.set(RoofState[], Focus[]);          // view/roofs.mjs readRoofs
 *   f.frame(dt, towardCamera, snap) → bool   true while something still fades
 *   f.changed                             the shown values moved this frame
 *   f.shown(id) → { alpha, holeK, visionK, holes, seen, open, opaque }
 *                 holes as the camera sees them: [{ x, z, x2, z2, r }] (projectHole)
 *   f.propAlphas() → Map<propId, alpha>   for PropsLayer#setRoofFade
 *
 * A fade is exponential damping that lands inside TIMING.roofFade: frame-rate
 * independent and interruptible (a figure stepping in and straight out reverses
 * from wherever the roof is). With the roofFade rung shed every roof snaps.
 *
 * PURE: no world, no three.js. The check tool drives it under Node.
 */

import { TIMING } from "../constants.mjs";

/** A roof hiding one of the viewer's figures from the camera fades to this. */
export const ROOF_CAMERA_ALPHA = 0.25;
/** Damping rate: 95% of the way in TIMING.roofFade (e^-3 ≈ 0.05). */
export const ROOF_RATE = 3 / (TIMING.roofFade / 1000);
const SNAP = 0.004;

const pip = (x, z, poly) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi || 1e-12) + xi) inside = !inside;
  }
  return inside;
};

/**
 * Does the ray from p toward the camera (dir, unit, dir.y > 0) cross the plane
 * y inside the outline? p and the outline in cells.
 */
export function rayHitsRoof(p, dir, y, poly) {
  if (!(dir.y > 1e-4) || !(y > p.y)) return false;
  const t = (y - p.y) / dir.y;
  return pip(p.x + dir.x * t, p.z + dir.z * t, poly);
}

/**
 * Does a roof hide any of these figures from the camera? A figure is tested at
 * its feet and at its chest, against the roof's underside and its top; a figure
 * standing on or above the roof is never hidden by it.
 */
export function hidesFocus(roof, focus, dir) {
  if (!roof?.poly?.length) return false;
  const p = _p;
  for (const f of focus ?? []) {
    if (!(f.footY < roof.topY - 0.05)) continue;
    for (let i = 0; i < FOCUS_AT.length; i++) {
      p.x = f.x; p.z = f.z; p.y = f.footY + (f.headY - f.footY) * FOCUS_AT[i];
      if (rayHitsRoof(p, dir, roof.baseY, roof.poly) || rayHitsRoof(p, dir, roof.topY, roof.poly)) return true;
    }
  }
  return false;
}
/** Where up a figure the camera test looks: just off its feet, and its chest. */
const FOCUS_AT = [0.15, 0.6];
const _p = { x: 0, y: 0, z: 0 };

/**
 * The standee card as drawn (render/standees.mjs FIGURE_SCALE, MAX_LEAN): taller
 * than the rules height, and leaned back about its feet toward the camera's
 * pitch. Restated here to keep this module free of three.js; the check pins both.
 */
export const CARD_SCALE = 1.35;
export const CARD_MAX_LEAN = (60 * Math.PI) / 180;

/**
 * A RADIAL hole as the camera sees it: the figure's feet and the top of its
 * card carried up the view ray (dir, toward the camera) onto the roof's plane
 * y, so the hole is a capsule over the whole figure on screen rather than a
 * circle straight above its feet. A hole without a height, or a camera looking
 * flat, stays a circle.
 * @returns {{x:number, z:number, x2:number, z2:number, r:number}}
 */
export function projectHole(h, y, dir) {
  const x = Number(h.x), z = Number(h.z), r = Math.max(0, Number(h.r) || 0);
  const foot = Number(h.footY), head = Number(h.headY);
  if (!dir || !(dir.y > 0.05) || !Number.isFinite(foot) || !Number.isFinite(head) || !Number.isFinite(y)) return { x, z, x2: x, z2: z, r };
  const onRoof = (px, py, pz) => { const t = Math.max(0, y - py) / dir.y; return [px + dir.x * t, pz + dir.z * t]; };
  // the card's top: its drawn height, leaned back away from the camera
  const lean = Math.min(CARD_MAX_LEAN, Math.asin(Math.min(1, dir.y)));
  const hl = Math.hypot(dir.x, dir.z);
  const H = Math.max(0, head - foot) * CARD_SCALE, back = hl > 1e-6 ? (Math.sin(lean) * H) / hl : 0;
  const [fx, fz] = onRoof(x, foot, z);
  const [tx, tz] = onRoof(x - dir.x * back, foot + Math.cos(lean) * H, z - dir.z * back);
  return { x: fx, z: fz, x2: tx, z2: tz, r };
}

export class RoofFader {
  constructor() {
    /** id → { state, alpha, holeK, visionK, target } */
    this.roofs = new Map();
    this.focus = [];
    this.changed = false;
    /** The last toward-camera direction (frame), for projectHole. */
    this.dir = null;
    this._props = new Map();
  }

  /** @param {object[]} roofs RoofState[]  @param {object[]} focus */
  set(roofs, focus = []) {
    const next = new Map();
    for (const s of roofs ?? []) {
      if (!s?.id) continue;
      const was = this.roofs.get(s.id);
      // a roof first seen starts at its target: opening the view never plays a fade
      const a0 = was ? was.alpha : Math.max(0, Math.min(1, Number(s.alpha ?? 1)));
      next.set(s.id, {
        state: s,
        alpha: a0,
        holeK: was ? was.holeK : (s.holes?.length ? 1 : 0),
        visionK: was ? was.visionK : (s.vision ? 1 : 0),
        holes: s.holes?.length ? s.holes : (was?.holes ?? []),
        target: a0,
      });
    }
    this.roofs = next;
    this.focus = Array.isArray(focus) ? focus : [];
    this.changed = true;
  }

  get size() { return this.roofs.size; }

  /**
   * @param {number} dt   seconds
   * @param {{x:number,y:number,z:number}} dir  unit vector toward the camera
   * @param {boolean} snap  the roofFade rung is shed: land at once
   * @returns {boolean} true while some roof is still on its way
   */
  frame(dt, dir, snap = false) {
    let moving = false;
    // a turned camera moves every RADIAL hole (projectHole), so they are drawn again
    if (dir && (!this.dir || Math.abs(dir.x - this.dir.x) + Math.abs(dir.y - this.dir.y) + Math.abs(dir.z - this.dir.z) > 1e-4)) {
      this.dir ??= { x: 0, y: 1, z: 0 };
      this.dir.x = dir.x; this.dir.y = dir.y; this.dir.z = dir.z;
      for (const r of this.roofs.values()) if (r.holes?.length) { this.changed = true; break; }
    }
    const k = snap ? 1 : 1 - Math.exp(-ROOF_RATE * Math.max(0, Number(dt) || 0));
    for (const r of this.roofs.values()) {
      const s = r.state;
      let target = Math.max(0, Math.min(1, Number(s.alpha ?? 1)));
      if (hidesFocus(s, this.focus, dir)) target = Math.min(target, ROOF_CAMERA_ALPHA);
      r.target = target;
      const holeT = s.holes?.length ? 1 : 0, visT = s.vision ? 1 : 0;
      if (s.holes?.length) r.holes = s.holes;
      if (this.step(r, "alpha", target, k)) moving = true;
      if (this.step(r, "holeK", holeT, k)) moving = true;
      if (this.step(r, "visionK", visT, k)) moving = true;
    }
    return moving;
  }

  /** Move one shown value toward its target; true while it has not arrived. */
  step(r, key, t, k) {
    const v = r[key];
    if (v === t) return false;
    let n = v + (t - v) * k;
    if (Math.abs(t - n) < SNAP) n = t;
    r[key] = n;
    this.changed = true;
    return n !== t;
  }

  /** What a roof shows now. `opaque`: fully shut, so it writes depth and casts. */
  shown(id) {
    const r = this.roofs.get(id);
    if (!r) return null;
    const s = r.state;
    return {
      alpha: r.alpha, holeK: r.holeK, visionK: r.visionK,
      holes: (r.holes ?? []).map((h) => projectHole(h, Number(s.baseY), this.dir)),
      seen: Number(s.seen ?? 1), open: Number(s.open ?? 0),
      opaque: r.alpha >= 0.999 && r.holeK <= 0 && r.visionK <= 0 && r.target >= 0.999,
    };
  }

  /** Every prop roof's alpha now (reused map). */
  propAlphas() {
    const m = this._props;
    m.clear();
    for (const [id, r] of this.roofs) if (r.state.source === "prop") m.set(id, r.alpha);
    return m;
  }
}
