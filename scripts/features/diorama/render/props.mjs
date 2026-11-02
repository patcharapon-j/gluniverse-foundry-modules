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
 *   .casters                      Object3D[] drawn into the shadow map
 *   .dispose()
 */

import * as THREE from "./three.mjs";

export class PropsLayer {
  constructor(shared) {
    this.shared = shared;
    this.group = new THREE.Group();
    this.group.name = "dio.props";
    this.casters = [];
  }
  setGridSize() {}
  setTerrain() {}
  setEnvironment() {}
  set() {}
  animated() { return false; }
  frame() { return false; }
  dispose() {}
}
