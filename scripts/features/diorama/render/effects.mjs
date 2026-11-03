/**
 * Diorama — mirrored effects (Sequencer / JB2A and the like, and Spellsprite).
 *
 *   standing  a camera-facing quad standing on the ground at (x, y, zQ)
 *   flat      a quad lying on the ground at zQ, rotated by `rotation` (deg)
 *   beam      a quad from (x, y, zQ) to (x2, y2, z2Q), `heightPx` thick, turned
 *             about its own axis to face the camera
 *
 * The source is a video (VideoTexture, which refreshes itself every render), an
 * image or a canvas. Additive blending. An effect with `light` contributes one
 * of up to eight point lights to every lit material.
 *
 * The PIXEL family is pixel art (Spellsprite, integrations/spellsprite.mjs),
 * drawn with NORMAL alpha blending: an outline or a smoke underside is darker
 * than the ground, and additive light would lose it.
 *
 *   pixel-standing  a camera-facing quad; art pixel (anchor.ax, anchor.ay) of the
 *                   painted buffer stands on the world point (x, y, zQ)
 *   pixel-flat      a decal lying on the ground at zQ; (anchor.ax, anchor.ay)
 *                   lies on (x, y)
 *   pixel-light     as pixel-flat, additive: the light pool. Its `lights`
 *                   ([{x, y, zQ, z, r, color:[r,g,b] 0..1, k}], px / q / cells)
 *                   join the effect point lights, which light standees too.
 *
 * A pixel state carries its canvas (`source`), `version` (a new value re-uploads
 * the texture in place: never a new texture per frame), `box` {x, y, w, h} (the
 * drawn part of the buffer, in art pixels; the canvas holds it at its own
 * (0, 0)) and `aps` (art pixels per cell). A standing quad is box.w / aps cells
 * wide, so a host that picks aps = (device px per cell) / k draws every art
 * pixel as exactly k device pixels. NEAREST sampling, no mipmaps.
 */

import * as THREE from "./three.mjs";
import { MATERIALS, MAX_EFFECT_LIGHTS, cssRgb } from "./materials.mjs";
import { CARD_DEPTH_NUDGE } from "./glsl.mjs";

/**
 * How far (cells) a standing pixel quad is slid toward the camera beyond its
 * ground clearance. A standee card writes its depth on its stand plane nudged
 * CARD_DEPTH_NUDGE toward the camera, so anything less puts a creature's own
 * effect (a hit, a burning condition) behind the creature it is on.
 */
export const PIXEL_PUSH = CARD_DEPTH_NUDGE + 0.15;

const isVideo = (s) => typeof HTMLVideoElement !== "undefined" && s instanceof HTMLVideoElement;
const isCanvas = (s) => (typeof HTMLCanvasElement !== "undefined" && s instanceof HTMLCanvasElement)
  || (typeof OffscreenCanvas !== "undefined" && s instanceof OffscreenCanvas);

/** The pixel kinds (render order: decals, then light, then standing). */
export const PIXEL_KINDS = Object.freeze(["pixel-standing", "pixel-flat", "pixel-light"]);
export const isPixelKind = (k) => PIXEL_KINDS.includes(k);

const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3(), _m = new THREE.Matrix4();
const _r = new THREE.Vector3(), _u = new THREE.Vector3();

/** A texture for pixel art: nearest, no mipmaps, uploaded from the canvas as is. */
export function pixelTexture(source) {
  const t = new THREE.CanvasTexture(source);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

export class EffectsLayer {
  constructor(shared) {
    this.shared = shared;
    this.group = new THREE.Group();
    this.group.name = "dio.effects";
    this.size = 100;
    /** setEffects' entries */
    this.entries = new Map();
    /** the pixel source's entries, replaced every frame (setPixels) */
    this.pixels = new Map();
    /** source → { texture, refs } */
    this.textures = new Map();
    this.quad = new THREE.PlaneGeometry(1, 1);
    this.beamQuad = (() => { const g = new THREE.PlaneGeometry(1, 1); g.translate(0.5, 0, 0); return g; })();
    /** True while the pixel source says its effects are running. */
    this.pixelLive = false;
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
    this.reconcile(this.entries, effects);
  }

  /** The pixel source's states for this frame (renderer.setPixelSource). */
  setPixels(states) {
    this.reconcile(this.pixels, states);
  }

  reconcile(map, effects) {
    const seen = new Set();
    for (const fx of Array.isArray(effects) ? effects : []) {
      if (!fx || fx.id == null) continue;
      const id = String(fx.id);
      seen.add(id);
      let e = map.get(id);
      if (e && (e.source !== fx.source || e.kind !== fx.kind)) { this.drop(id, map); e = null; }
      if (!e) {
        e = isPixelKind(fx.kind) ? this.buildPixel(id, fx) : this.build(id, fx);
        map.set(id, e);
      } else if (e.pixel) {
        this.refreshPixel(e, fx);
      } else if (isCanvas(fx.source) && e.texture) {
        e.texture.needsUpdate = true;
      }
      e.fx = fx;
      e.mesh.material.uniforms.uOpacity.value = Number.isFinite(Number(fx.alpha)) ? Number(fx.alpha) : 1;
    }
    for (const id of [...map.keys()]) if (!seen.has(id)) this.drop(id, map);
  }

  build(id, fx) {
    const texture = this.textureFor(fx.source);
    const mat = MATERIALS.unlit(this.shared, { map: texture, additive: true });
    const mesh = new THREE.Mesh(fx.kind === "beam" ? this.beamQuad : this.quad, mat);
    mesh.renderOrder = 25;
    mesh.frustumCulled = false;
    this.group.add(mesh);
    return { id, mesh, source: fx.source, kind: fx.kind, texture };
  }

  /** A pixel quad owns its texture: one canvas per quad, re-uploaded in place. */
  buildPixel(id, fx) {
    const texture = isCanvas(fx.source) ? pixelTexture(fx.source) : null;
    const mat = MATERIALS.pixel(this.shared, { map: texture, additive: fx.kind === "pixel-light" });
    const mesh = new THREE.Mesh(this.quad, mat);
    mesh.renderOrder = fx.kind === "pixel-standing" ? 25 : 24;
    mesh.frustumCulled = false;
    this.group.add(mesh);
    const e = { id, mesh, source: fx.source, kind: fx.kind, texture, pixel: true, version: null, cw: 0, ch: 0 };
    this.refreshPixel(e, fx);
    return e;
  }

  refreshPixel(e, fx) {
    const src = fx.source;
    if (!src) return;
    // A canvas that grew (its size bucket changed) needs new storage: a new texture.
    if (e.texture && (src.width !== e.cw || src.height !== e.ch) && e.cw) {
      e.texture.dispose();
      e.texture = pixelTexture(src);
      e.mesh.material.uniforms.uTex.value = e.texture;
      e.version = null;
    }
    e.cw = src.width; e.ch = src.height;
    if (e.texture && fx.version !== e.version) { e.texture.needsUpdate = true; e.version = fx.version; }
    const b = fx.box ?? { x: 0, y: 0, w: e.cw, h: e.ch };
    const sx = Math.max(1, b.w) / Math.max(1, e.cw), sy = Math.max(1, b.h) / Math.max(1, e.ch);
    // flipY: v = 1 is the canvas's top row
    e.mesh.material.uniforms.uBox.value.set(sx, sy, 0, 1 - sy);
  }

  drop(id, map = this.entries) {
    const e = map.get(id);
    if (!e) return;
    this.group.remove(e.mesh);
    e.mesh.material.dispose();
    if (e.pixel) e.texture?.dispose();
    else this.releaseTexture(e.source);
    map.delete(id);
  }

  /** True while any source is a playing video (it needs frames), or pixel effects run. */
  get animated() {
    if (this.pixelLive) return true;
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
      // pixel lights first: they move and they are what lights a struck figure
      for (const e of this.pixels.values()) {
        for (const l of e.fx.lights ?? []) {
          if (n >= MAX_EFFECT_LIGHTS) break;
          const k = Number(l.k) || 0, c = l.color;
          if (!(k > 0.01) || !Array.isArray(c)) continue;
          pos[n].set(Number(l.x) / S, Number(l.zQ ?? 0) / 4 + (Number(l.z) || 0) + 0.3, Number(l.y) / S, Math.max(0.1, Number(l.r) / S));
          col[n].set(c[0] * k, c[1] * k, c[2] * k);
          n++;
        }
      }
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
    const camDir = _z.set(0, 0, 1).applyQuaternion(camera.quaternion); // toward the camera
    for (const e of this.entries.values()) this.place(e, camera, camDir);
    for (const e of this.pixels.values()) this.place(e, camera, camDir);
  }

  place(e, camera, camDir) {
    const S = this.size;
    const fx = e.fx, m = e.mesh;
    if (e.pixel) { this.placePixel(e, camera, camDir); return; }
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

  /**
   * A pixel quad. Standing: in the camera's own plane (an orthographic camera
   * maps it 1:1 to the screen), the anchor art pixel on the world point, then
   * slid toward the camera, which moves nothing on screen, until its lowest art
   * pixel is above the ground there: the ground in front would otherwise clip
   * everything the painter drew below the anchor (the near half of a burst).
   */
  placePixel(e, camera, camDir) {
    const S = this.size, fx = e.fx, m = e.mesh;
    const aps = Math.max(1e-3, Number(fx.aps) || 1);
    const b = fx.box ?? { x: 0, y: 0, w: e.cw, h: e.ch };
    const an = fx.anchor ?? { ax: 0, ay: 0 };
    const w = Math.max(1, b.w) / aps, h = Math.max(1, b.h) / aps;
    const cx = (b.x + b.w / 2 - an.ax) / aps, cy = (b.y + b.h / 2 - an.ay) / aps;
    const x = Number(fx.x) / S, z = Number(fx.y) / S, y = Number(fx.zQ ?? 0) / 4;
    m.visible = !!(fx.source && b.w > 0 && b.h > 0);
    if (fx.kind === "pixel-standing") {
      m.quaternion.copy(camera.quaternion);
      _r.set(1, 0, 0).applyQuaternion(camera.quaternion);
      _u.set(0, 1, 0).applyQuaternion(camera.quaternion);
      // screen down from the anchor to the lowest art pixel, in cells
      const below = Math.max(0, (b.y + b.h - an.ay) / aps);
      const tanP = Math.max(0.2, camDir.y / Math.max(1e-3, Math.hypot(camDir.x, camDir.z)));
      const push = below / tanP + PIXEL_PUSH;
      m.position.set(x, y, z).addScaledVector(_r, cx).addScaledVector(_u, -cy).addScaledVector(camDir, push);
      m.scale.set(w, h, 1);
    } else {
      m.position.set(x + cx, y + (fx.kind === "pixel-light" ? 0.036 : 0.032), z + cy);
      m.rotation.set(-Math.PI / 2, 0, 0);
      m.scale.set(w, h, 1);
    }
  }

  dispose() {
    for (const id of [...this.entries.keys()]) this.drop(id, this.entries);
    for (const id of [...this.pixels.keys()]) this.drop(id, this.pixels);
    this.quad.dispose();
    this.beamQuad.dispose();
  }
}
