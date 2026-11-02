/**
 * Diorama — the environment: sun and sky for the time of day, weather
 * particles, fog and atmosphere (STUB, contract only).
 *
 * Contract with renderer.mjs:
 *   new AtmosphereLayer(shared)
 *   .group
 *   .setGridSize(px)
 *   .setTerrain(terrain|null, mesh|null)    bounds for particles and fog
 *   .setEnvironment(env|null)               resolved env (environment.mjs)
 *   .animated(fx) → bool                    true while weather or atmosphere moves
 *   .frame(t, dt, camera, fx, view) → bool  writes sun/sky/fog uniforms; true while animating
 *   .dispose()
 */

import * as THREE from "./three.mjs";

export class AtmosphereLayer {
  constructor(shared) {
    this.shared = shared;
    this.group = new THREE.Group();
    this.group.name = "dio.atmosphere";
  }
  setGridSize() {}
  setTerrain() {}
  setEnvironment() {}
  animated() { return false; }
  frame() { return false; }
  dispose() {}
}
