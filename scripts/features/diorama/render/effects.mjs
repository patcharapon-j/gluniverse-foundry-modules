/**
 * Diorama — mirrored effects (Sequencer / JB2A and the like).
 *
 *   standing  a camera-facing quad standing on the ground at (x, y, zQ)
 *   flat      a quad lying on the ground at zQ, rotated by `rotation` (deg)
 *   beam      a quad from (x, y, zQ) to (x2, y2, z2Q), `heightPx` thick, turned
 *             about its own axis to face the camera
 *
 * The source is a video (VideoTexture, which refreshes itself every render), an
 * image or a canvas. Additive blending. An effect with `light` contributes one
 * of up to eight point lights to every lit material.
 */

import * as THREE from "./three.mjs";
import { MATERIALS, MAX_EFFECT_LIGHTS, cssRgb } from "./materials.mjs";

const isVideo = (s) => typeof HTMLVideoElement !== "undefined" && s instanceof HTMLVideoElement;
const isCanvas = (s) => (typeof HTMLCanvasElement !== "undefined" && s instanceof HTMLCanvasElement)
  || (typeof OffscreenCanvas !== "undefined" && s instanceof OffscreenCanvas);

const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3(), _m = new THREE.Matrix4();

export class EffectsLayer {
  constructor(shared) {
    this.shared = shared;
    this.group = new THREE.Group();
    this.group.name = "dio.effects";
    this.size = 100;
    this.entries = new Map();
    /** source → { texture, refs } */
    this.textures = new Map();
    this.quad = new THREE.PlaneGeometry(1, 1);
    this.beamQuad = (() => { const g = new THREE.PlaneGeometry(1, 1); g.translate(0.5, 0, 0); return g; })();
  }

  setGridSize(size) { this.size = size || 100; }

  textureFor(source) {
    let t = this.textures.get(source);
    if (!t) {
      let texture = null;
      try {
        if (isVideo(source)) texture = new THREE.VideoTexture(source);
        else if (isCanvas(source)) texture = new THREE.CanvasTexture(source);
        else if (source) { texture = new THREE.Texture(source); texture.needsUpdate = true; }
      } catch { texture = null; }
      t = { texture, refs: 0 };
      this.textures.set(source, t);
    }
    t.refs++;
    return t.texture;
  }

  releaseTexture(source) {
    const t = this.textures.get(source);
    if (!t || --t.refs > 0) return;
    t.texture?.dispose();
    this.textures.delete(source);
  }

  set(effects) {
    const seen = new Set();
    for (const fx of Array.isArray(effects) ? effects : []) {
      if (!fx || fx.id == null) continue;
      const id = String(fx.id);
      seen.add(id);
      let e = this.entries.get(id);
      if (e && (e.source !== fx.source || e.kind !== fx.kind)) { this.drop(id); e = null; }
      if (!e) {
        const texture = this.textureFor(fx.source);
        const mat = MATERIALS.unlit(this.shared, { map: texture, additive: true });
        const mesh = new THREE.Mesh(fx.kind === "beam" ? this.beamQuad : this.quad, mat);
        mesh.renderOrder = 25;
        mesh.frustumCulled = false;
        this.group.add(mesh);
        e = { id, mesh, source: fx.source, kind: fx.kind, texture };
        this.entries.set(id, e);
      } else if (isCanvas(fx.source) && e.texture) {
        e.texture.needsUpdate = true;
      }
      e.fx = fx;
      e.mesh.material.uniforms.uOpacity.value = Number.isFinite(Number(fx.alpha)) ? Number(fx.alpha) : 1;
    }
    for (const id of [...this.entries.keys()]) if (!seen.has(id)) this.drop(id);
  }

  drop(id) {
    const e = this.entries.get(id);
    if (!e) return;
    this.group.remove(e.mesh);
    e.mesh.material.dispose();
    this.releaseTexture(e.source);
    this.entries.delete(id);
  }

  /** True while any source is a playing video (it needs frames). */
  get animated() {
    for (const e of this.entries.values()) if (isVideo(e.source) && !e.source.paused && !e.source.ended) return true;
    return false;
  }

  /**
   * Fill the shared effect-light uniforms. @param {boolean} on  shed gate
   */
  writeLights(on) {
    const pos = this.shared.uEffPos.value, col = this.shared.uEffCol.value;
    let n = 0;
    if (on) {
      const S = this.size;
      for (const e of this.entries.values()) {
        const l = e.fx.light;
        if (!l || n >= MAX_EFFECT_LIGHTS) continue;
        const r = Number(l.radius);
        const [cr, cg, cb] = cssRgb(l.color, "#ffffff");
        const a = Number.isFinite(Number(e.fx.alpha)) ? Number(e.fx.alpha) : 1;
        pos[n].set(Number(e.fx.x) / S, Number(e.fx.zQ ?? 0) / 4 + 0.5, Number(e.fx.y) / S, Math.max(0.1, (Number.isFinite(r) ? r : S * 3) / S));
        col[n].set(cr * a, cg * a, cb * a);
        n++;
      }
    }
    this.shared.uEffCount.value = n;
  }

  /** Orient every quad toward the camera. */
  frame(camera) {
    const S = this.size;
    const camDir = _z.set(0, 0, 1).applyQuaternion(camera.quaternion); // toward the camera
    for (const e of this.entries.values()) {
      const fx = e.fx, m = e.mesh;
      const w = Math.max(0.01, (Number(fx.widthPx) || S) / S);
      const h = Math.max(0.01, (Number(fx.heightPx) || S) / S);
      const rot = ((Number(fx.rotation) || 0) * Math.PI) / 180;
      const x = Number(fx.x) / S, z = Number(fx.y) / S, y = Number(fx.zQ ?? 0) / 4;
      if (fx.kind === "flat") {
        m.position.set(x, y + 0.03, z);
        m.rotation.set(-Math.PI / 2, 0, -rot);
        m.scale.set(w, h, 1);
      } else if (fx.kind === "beam") {
        const x2 = Number(fx.x2) / S, z2 = Number(fx.y2) / S, y2 = Number(fx.z2Q ?? fx.zQ ?? 0) / 4;
        const a = new THREE.Vector3(x, y + 0.5, z), b = new THREE.Vector3(x2, y2 + 0.5, z2);
        const len = Math.max(0.01, a.distanceTo(b));
        _x.subVectors(b, a).normalize();
        // the face normal: camera direction with the axis component removed
        _y.copy(camDir).addScaledVector(_x, -camDir.dot(_x));
        if (_y.lengthSq() < 1e-6) _y.set(0, 1, 0);
        _y.normalize();
        const up = new THREE.Vector3().crossVectors(_y, _x).normalize();
        _m.makeBasis(_x, up, _y);
        m.quaternion.setFromRotationMatrix(_m);
        m.position.copy(a);
        m.scale.set(len, h, 1);
      } else {
        m.quaternion.copy(camera.quaternion);
        if (rot) m.rotateZ(-rot);
        m.position.set(x, y + h / 2, z);
        m.scale.set(w, h, 1);
      }
    }
  }

  dispose() {
    for (const id of [...this.entries.keys()]) this.drop(id);
    this.quad.dispose();
    this.beamQuad.dispose();
  }
}
