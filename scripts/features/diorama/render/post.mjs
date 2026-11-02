/**
 * Diorama — the key light's shadow map and the tilt-shift blur.
 */

import * as THREE from "./three.mjs";
import { MATERIALS } from "./materials.mjs";
import { SHADOW_LAYER } from "./terrain.mjs";

const SHADOW_SIZE = 2048;

/**
 * Depth-only shadow map from the fixed key light over the whole diorama.
 * Terrain and walls cast; standees have a contact shadow instead. Re-rendered
 * only when what casts changes (marked dirty), not every frame.
 */
export class ShadowPass {
  constructor(shared) {
    this.shared = shared;
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
    this.camera.layers.set(SHADOW_LAYER);
    this.material = MATERIALS.depth();
    this.target = null;
    this.dirty = true;
    this.bounds = { x1: 1, z1: 1, y0: 0, y1: 1 };
  }

  ensureTarget() {
    if (this.target) return this.target;
    const depth = new THREE.DepthTexture(SHADOW_SIZE, SHADOW_SIZE);
    depth.type = THREE.UnsignedIntType;
    depth.minFilter = depth.magFilter = THREE.NearestFilter;
    this.target = new THREE.WebGLRenderTarget(SHADOW_SIZE, SHADOW_SIZE, {
      depthTexture: depth, depthBuffer: true, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
    });
    this.shared.uShadowMap.value = depth;
    return this.target;
  }

  /** @param {{x1:number,z1:number,y0:number,y1:number}} b  world extents (cells) */
  setBounds(b) {
    this.bounds = b;
    this.dirty = true;
  }

  fit() {
    const { x1, z1, y0, y1 } = this.bounds;
    const k = this.shared.uKeyDir.value;
    const cx = x1 / 2, cz = z1 / 2, cy = (y0 + y1) / 2;
    const R = Math.hypot(x1, z1, y1 - y0) / 2 + 2;
    const c = this.camera;
    c.position.set(cx + k.x * R * 2, cy + k.y * R * 2, cz + k.z * R * 2);
    c.up.set(0, 1, 0);
    c.lookAt(cx, cy, cz);
    c.left = -R; c.right = R; c.top = R; c.bottom = -R;
    c.near = 0.1; c.far = R * 4;
    c.updateProjectionMatrix();
    c.updateMatrixWorld(true);
    this.shared.uShadowMatrix.value.multiplyMatrices(c.projectionMatrix, c.matrixWorldInverse);
    this.shared.uShadowTexel.value.set(1 / SHADOW_SIZE, 1 / SHADOW_SIZE);
  }

  /**
   * @param {THREE.Scene|THREE.Scene[]} [casters]  drawn after the scene with
   *   their own (alpha-tested, instanced) materials, into the same depth,
   *   without clearing. The standees' cards and the props each own one.
   * @returns {boolean} true when the map was drawn (it was dirty)
   */
  render(renderer, scene, casters = null) {
    if (!this.dirty) return false;
    this.dirty = false;
    const target = this.ensureTarget();
    this.fit();
    const prevOverride = scene.overrideMaterial, prevTarget = renderer.getRenderTarget();
    const prevBg = scene.background;
    scene.overrideMaterial = this.material;
    scene.background = null;
    renderer.setRenderTarget(target);
    renderer.clear(true, true, false);
    renderer.render(scene, this.camera);
    const extra = Array.isArray(casters) ? casters : [casters];
    if (extra.some((c) => c?.children.length)) {
      const prevAuto = renderer.autoClear;
      renderer.autoClear = false;
      this.camera.layers.enableAll();
      for (const c of extra) if (c?.children.length) renderer.render(c, this.camera);
      this.camera.layers.set(SHADOW_LAYER);
      renderer.autoClear = prevAuto;
    }
    renderer.setRenderTarget(prevTarget);
    scene.overrideMaterial = prevOverride;
    scene.background = prevBg;
    return true;
  }

  dispose() {
    this.target?.depthTexture?.dispose();
    this.target?.dispose();
    this.target = null;
    this.material.dispose();
    this.shared.uShadowMap.value = null;
  }
}

/**
 * Tilt-shift: the scene into a target, a horizontal then a vertical gaussian
 * whose radius grows away from a horizontal focus band.
 */
export class TiltShift {
  constructor() {
    this.material = MATERIALS.blur();
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.quad.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.quad);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.a = null;
    this.b = null;
    this.w = 0;
    this.h = 0;
  }

  ensure(w, h) {
    if (this.a && this.w === w && this.h === h) return;
    this.a?.dispose(); this.b?.dispose();
    const opts = { depthBuffer: true, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, samples: 4 };
    this.a = new THREE.WebGLRenderTarget(w, h, opts);
    this.b = new THREE.WebGLRenderTarget(w, h, { ...opts, depthBuffer: false, samples: 0 });
    this.w = w; this.h = h;
  }

  /** Render `scene` through the blur to the screen. */
  render(renderer, scene, camera) {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const w = Math.max(1, Math.floor(size.x)), h = Math.max(1, Math.floor(size.y));
    this.ensure(w, h);
    const u = this.material.uniforms;
    renderer.setRenderTarget(this.a);
    renderer.clear();
    renderer.render(scene, camera);
    u.uTexel.value.set(1 / w, 1 / h);
    u.uStrength.value = Math.min(2.2, h / 540);
    u.uTex.value = this.a.texture; u.uDir.value.set(1, 0);
    renderer.setRenderTarget(this.b);
    renderer.render(this.scene, this.camera);
    u.uTex.value = this.b.texture; u.uDir.value.set(0, 1);
    renderer.setRenderTarget(null);
    renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.a?.dispose(); this.b?.dispose();
    this.a = this.b = null;
    this.quad.geometry.dispose();
    this.material.dispose();
  }
}
