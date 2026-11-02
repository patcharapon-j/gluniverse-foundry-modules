/**
 * Diorama — props: primitive objects placed on the board (STUB, contract only).
 *
 * Contract with renderer.mjs:
 *   new PropsLayer(shared)        shared = createShared() uniforms
 *   .group                        THREE.Group added to the scene
 *   .setGridSize(px)
 *   .setTerrain(terrain|null)     for standing props on the ground
 *   .setEnvironment(env|null)     wind for sway, snow cover, wetness
 *   .set(PropState[], now, animate)
 *   .animated(fx) → bool          true while something sways (uses the shared uTime)
 *   .frame(t, dt, camera, fx) → bool  true while it needs more frames
 *   .dispose()
 * Shadows: opaque prop meshes enable SHADOW_LAYER (post.mjs) like the terrain,
 * and the shadow pass draws them with its depth override. Set
 * renderer.shadow.dirty when props move (setProps already does).
 */

import * as THREE from "./three.mjs";

export class PropsLayer {
  constructor(shared) {
    this.shared = shared;
    this.group = new THREE.Group();
    this.group.name = "dio.props";
  }
  setGridSize() {}
  setTerrain() {}
  setEnvironment() {}
  set() {}
  animated() { return false; }
  frame() { return false; }
  dispose() {}
}
