/**
 * Diorama — landing dust: a small stylized puff where a standee lands.
 *
 * A fixed pool, built once: DUST_PUFFS puffs of up to DUST_MOTES soft motes
 * each, every mote a camera-facing quad on the shared unlit program (no new
 * program, nothing compiled at the first landing). emit() takes a free puff,
 * or the oldest one when all are busy; frame() moves the live motes outward
 * along the ground, lets them rise a little, grow and fade. Nothing is
 * allocated after construction: every per-mote value lives in typed arrays.
 *
 * The motes are tinted from the palette and dimmed with the scene's ambient,
 * so a puff at night is not a glowing cloud. Lifetime: TIMING.dustLife,
 * shorter for a light footfall. Shed as "standeeDust" (the layer clears it).
 */

import * as THREE from "./three.mjs";
import { TIMING } from "../constants.mjs";
import { PALETTE, hexToRgbFloat, mix } from "../../../core/theme.mjs";
import { MATERIALS } from "./materials.mjs";
import { dustCanvas } from "./art.mjs";
import { clamp01, ease } from "./tween.mjs";

export const DUST_PUFFS = 12;
export const DUST_MOTES = 6;
/**
 * Pale warm dust, from the palette (never a hardcoded suite colour): light
 * enough to read over grey stone and dark earth alike.
 */
const DUST_RGB = hexToRgbFloat(mix(PALETTE.text, PALETTE.warn, 0.18));
/** Peak mote opacity for a full-strength puff. */
const PEAK = 0.7;
const TAU = Math.PI * 2;

export class DustLayer {
  /** @param {object} shared  the lit uniforms (uAmbient is read for the tint) */
  constructor(shared) {
    this.shared = shared;
    this.group = new THREE.Group();
    this.group.name = "dio.dust";
    const c = dustCanvas();
    this.texture = c ? new THREE.CanvasTexture(c) : null;
    this.geo = new THREE.PlaneGeometry(1, 1);
    const n = DUST_PUFFS * DUST_MOTES;
    // per puff
    this.t0 = new Float64Array(DUST_PUFFS);
    this.life = new Float32Array(DUST_PUFFS);
    this.at = new Float32Array(DUST_PUFFS * 4);       // x, y, z, radius
    this.strength = new Float32Array(DUST_PUFFS);
    this.count = new Uint8Array(DUST_PUFFS);           // motes in use; 0 = free
    // per mote
    this.ang = new Float32Array(n);
    this.spd = new Float32Array(n);
    this.size = new Float32Array(n);
    this.mats = [];
    this.motes = [];
    for (let p = 0; p < DUST_PUFFS; p++) {
      const mat = MATERIALS.unlit(shared, { map: this.texture, color: "#ffffff", opacity: 0 });
      this.mats.push(mat);
      for (let m = 0; m < DUST_MOTES; m++) {
        const mesh = new THREE.Mesh(this.geo, mat);
        mesh.visible = false;
        mesh.renderOrder = 5;
        mesh.frustumCulled = false;
        mesh.raycast = noRaycast;
        this.motes.push(mesh);
        this.group.add(mesh);
      }
    }
    this.seq = 0;
    this.live = 0;
  }

  /**
   * A puff at (x, y, z) (cells; y is the ground), around a base of `radius`
   * cells, `strength` 0..1.2, starting at `now` (ms; the moment of contact,
   * which may be a little before this frame).
   */
  emit(x, y, z, radius, strength, now) {
    if (!(strength > 0)) return;
    let slot = -1, oldest = Infinity;
    for (let p = 0; p < DUST_PUFFS; p++) {
      if (this.count[p] === 0) { slot = p; break; }
      if (this.t0[p] < oldest) { oldest = this.t0[p]; slot = p; }
    }
    if (this.count[slot] === 0) this.live++;
    const k = Math.min(1.2, strength);
    this.t0[slot] = now;
    this.life[slot] = TIMING.dustLife * (0.55 + 0.45 * Math.min(1, k));
    this.at[slot * 4] = x; this.at[slot * 4 + 1] = y; this.at[slot * 4 + 2] = z; this.at[slot * 4 + 3] = Math.max(0.12, radius);
    this.strength[slot] = k;
    const motes = Math.max(2, Math.min(DUST_MOTES, Math.round(2 + 4 * k)));
    this.count[slot] = motes;
    const turn = hash01(++this.seq, 0) * TAU;
    for (let m = 0; m < DUST_MOTES; m++) {
      const i = slot * DUST_MOTES + m;
      this.motes[i].visible = false;
      if (m >= motes) continue;
      this.ang[i] = turn + (m / motes) * TAU + (hash01(this.seq, m + 1) - 0.5) * 0.7;
      this.spd[i] = 0.7 + 0.6 * hash01(this.seq, m + 11);
      this.size[i] = 0.8 + 0.4 * hash01(this.seq, m + 23);
    }
  }

  /**
   * Move every live mote to `now`. @returns {boolean} true while any puff lives
   */
  frame(now, camera) {
    if (this.live === 0) return false;
    const amb = this.shared?.uAmbient?.value ?? 1;
    const tint = 0.35 + 0.65 * Math.max(0, Math.min(1, amb));
    for (let p = 0; p < DUST_PUFFS; p++) {
      const n = this.count[p];
      if (n === 0) continue;
      const v = (now - this.t0[p]) / this.life[p];
      if (v >= 1) { this.free(p); continue; }
      const k = this.strength[p];
      const w = clamp01(v);
      const grow = ease.outCubic(w);
      const u = this.mats[p].uniforms;
      // a quick swell, a hold while it spreads, then the fade. A footfall is
      // fainter than a landing, but never so faint that it vanishes on pale stone.
      u.uOpacity.value = PEAK * (0.35 + 0.65 * Math.min(1, k)) * Math.min(1, w / 0.08) * (1 - w * w);
      u.uColor.value.set(DUST_RGB[0] * tint, DUST_RGB[1] * tint, DUST_RGB[2] * tint);
      const x = this.at[p * 4], y = this.at[p * 4 + 1], z = this.at[p * 4 + 2], r = this.at[p * 4 + 3];
      for (let m = 0; m < n; m++) {
        const i = p * DUST_MOTES + m;
        const mesh = this.motes[i];
        // from under the base's rim outward, so the puff reads around the figure, not behind it
        const reach = r * (1.1 + (0.5 + 0.6 * k) * this.spd[i] * grow);
        const s = this.size[i] * (0.17 + 0.13 * k) * (0.7 + 0.7 * grow);
        const rise = (0.03 + 0.1 * k) * this.spd[i] * ease.outQuad(w);
        mesh.position.set(x + Math.cos(this.ang[i]) * reach, y + s * 0.4 + rise, z + Math.sin(this.ang[i]) * reach);
        mesh.scale.set(s, s, 1);
        mesh.quaternion.copy(camera.quaternion);
        mesh.visible = true;
      }
    }
    return this.live > 0;
  }

  free(p) {
    for (let m = 0; m < DUST_MOTES; m++) this.motes[p * DUST_MOTES + m].visible = false;
    if (this.count[p] !== 0) this.live--;
    this.count[p] = 0;
  }

  /** Drop every puff at once (shed, or token life switched off). */
  clear() {
    for (let p = 0; p < DUST_PUFFS; p++) this.free(p);
  }

  dispose() {
    this.clear();
    for (const m of this.mats) m.dispose();
    this.geo.dispose();
    this.texture?.dispose();
  }
}

function noRaycast() {}

/** A stable pseudo-random 0..1 from two integers (no state, no allocation). */
function hash01(a, b) {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be59b, 0xc2b2ae35);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}
