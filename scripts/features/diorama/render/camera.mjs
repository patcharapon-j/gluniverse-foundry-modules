/**
 * Diorama — the camera rig.
 *
 * Orthographic. Logical state: { yawStep, pitchIndex, zoom, target:{x,y,zQ} }
 * (target in px / q). Yaw = 45° + yawStep·45°, so step 0 is the classic
 * diagonal; pitch = CAMERA.pitches[pitchIndex]; at zoom 1 the view is
 * VIEW_CELLS cells tall. Every change tweens (TIMING.camera) unless told not to.
 */

import * as THREE from "./three.mjs";
import { CAMERA, TIMING } from "../constants.mjs";
import { Tween, angleDelta, ease, lerp } from "./tween.mjs";

export const VIEW_CELLS = 12;
const DISTANCE = 160;
const DEG = Math.PI / 180;

export const yawOf = (step) => (45 + step * (360 / CAMERA.yawSteps)) * DEG;
export const pitchOf = (i) => (CAMERA.pitches[Math.max(0, Math.min(CAMERA.pitches.length - 1, i | 0))] ?? 30) * DEG;
const clampZoom = (z) => Math.max(CAMERA.minZoom, Math.min(CAMERA.maxZoom, Number(z) || 1));

export class CameraRig {
  constructor() {
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, DISTANCE * 3);
    this.camera.layers.enable(0);
    this.aspect = 1;
    this.size = 100;
    this.state = { yawStep: 0, pitchIndex: CAMERA.defaultPitch, zoom: 1, target: { x: 0, y: 0, zQ: 0 } };
    // the eased "view" values: yaw, pitch rad; zoom; target cells
    this.view = { yaw: yawOf(0), pitch: pitchOf(CAMERA.defaultPitch), zoom: 1, tx: 0, ty: 0, tz: 0 };
    this.tween = null;
    /** A transient screen-space nudge (cells along the camera's right and up): an effect's shake. */
    this.shake = { x: 0, y: 0 };
    this.apply();
  }

  /** Nudge the view by (x, y) cells along the screen; (0, 0) puts it back. Never part of the state. */
  setShake(x = 0, y = 0) {
    x = Number.isFinite(x) ? x : 0; y = Number.isFinite(y) ? y : 0;
    if (x === this.shake.x && y === this.shake.y) return false;
    this.shake.x = x; this.shake.y = y;
    this.apply();
    return true;
  }

  setGridSize(size) {
    this.size = size || 100;
  }

  setAspect(aspect) {
    this.aspect = aspect > 0 ? aspect : 1;
    this.apply();
  }

  /** Logical state (a copy). */
  get() {
    const s = this.state;
    return { yawStep: s.yawStep, pitchIndex: s.pitchIndex, zoom: s.zoom, target: { ...s.target } };
  }

  /**
   * @param {object} next  partial logical state
   * @param {number} now
   * @param {boolean} animate
   */
  set(next = {}, now = 0, animate = true) {
    const s = this.state;
    if (next.yawStep !== undefined && Number.isFinite(Number(next.yawStep))) {
      s.yawStep = ((Math.round(Number(next.yawStep)) % CAMERA.yawSteps) + CAMERA.yawSteps) % CAMERA.yawSteps;
    }
    if (next.pitchIndex !== undefined && Number.isFinite(Number(next.pitchIndex))) {
      s.pitchIndex = Math.max(0, Math.min(CAMERA.pitches.length - 1, Math.round(Number(next.pitchIndex))));
    }
    if (next.zoom !== undefined) s.zoom = clampZoom(next.zoom);
    if (next.target) {
      const t = next.target;
      s.target = {
        x: Number.isFinite(Number(t.x)) ? Number(t.x) : s.target.x,
        y: Number.isFinite(Number(t.y)) ? Number(t.y) : s.target.y,
        zQ: Number.isFinite(Number(t.zQ)) ? Number(t.zQ) : s.target.zQ,
      };
    }
    const to = {
      yaw: yawOf(s.yawStep), pitch: pitchOf(s.pitchIndex), zoom: s.zoom,
      tx: s.target.x / this.size, ty: s.target.zQ / 4, tz: s.target.y / this.size,
    };
    if (!animate) {
      this.tween = null;
      Object.assign(this.view, to);
    } else {
      const from = { ...this.view };
      // shortest way round
      to.yaw = from.yaw + angleDelta(from.yaw, to.yaw);
      this.tween = { from, to, tw: new Tween(0, 1, TIMING.camera, now, ease.inOutCubic) };
    }
    this.apply();
  }

  /** @returns {boolean} true while tweening */
  update(now) {
    if (!this.tween) return false;
    const { from, to, tw } = this.tween;
    const k = tw.value(now);
    const v = this.view;
    v.yaw = lerp(from.yaw, to.yaw, k);
    v.pitch = lerp(from.pitch, to.pitch, k);
    v.zoom = Math.exp(lerp(Math.log(from.zoom), Math.log(to.zoom), k));
    v.tx = lerp(from.tx, to.tx, k); v.ty = lerp(from.ty, to.ty, k); v.tz = lerp(from.tz, to.tz, k);
    if (tw.done(now)) this.tween = null;
    this.apply();
    return true;
  }

  get animating() { return !!this.tween; }

  /** Yaw the camera is heading for (radians), for cutaway decisions. */
  get targetYaw() { return yawOf(this.state.yawStep); }

  apply() {
    const v = this.view, c = this.camera;
    const halfH = VIEW_CELLS / 2 / v.zoom, halfW = halfH * this.aspect;
    c.left = -halfW; c.right = halfW; c.top = halfH; c.bottom = -halfH;
    const cp = Math.cos(v.pitch);
    c.position.set(v.tx + DISTANCE * cp * Math.sin(v.yaw), v.ty + DISTANCE * Math.sin(v.pitch), v.tz + DISTANCE * cp * Math.cos(v.yaw));
    c.up.set(0, 1, 0);
    c.lookAt(v.tx, v.ty, v.tz);
    if (this.shake && (this.shake.x || this.shake.y)) { c.translateX(this.shake.x); c.translateY(this.shake.y); }
    c.updateProjectionMatrix();
    c.updateMatrixWorld(true);
  }
}
