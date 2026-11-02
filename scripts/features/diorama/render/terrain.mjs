/**
 * Diorama — the terrain layer: wraps terrain-mesh.mjs output in three meshes.
 */

import * as THREE from "./three.mjs";
import { buildTerrainMesh } from "./terrain-mesh.mjs";
import { MATERIALS } from "./materials.mjs";

/** Layer the key light's shadow camera renders. */
export const SHADOW_LAYER = 1;

function geometryFrom(part) {
  const g = new THREE.BufferGeometry();
  for (const [name, size] of Object.entries(part.itemSize)) {
    g.setAttribute(name, new THREE.BufferAttribute(part[name], size));
  }
  g.setIndex(new THREE.BufferAttribute(part.index, 1));
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

export class TerrainLayer {
  constructor(shared) {
    this.group = new THREE.Group();
    this.group.name = "dio.terrain";
    this.materials = {
      top: MATERIALS.top(shared),
      side: MATERIALS.side(shared),
      water: MATERIALS.water(shared),
    };
    this.meshes = { top: null, side: null, water: null };
    this.mesh = null;
    this.hasWater = false;
    this.terrain = null;
  }

  /** @param {import("../terrain/model.mjs").Terrain|null} terrain */
  set(terrain) {
    this.clear();
    this.terrain = terrain;
    if (!terrain) return;
    const m = buildTerrainMesh(terrain);
    this.mesh = m;
    for (const [key, part, order] of [["top", m.tops, 0], ["side", m.sides, 0], ["water", m.water, 5]]) {
      if (!part.count) continue;
      const mesh = new THREE.Mesh(geometryFrom(part), this.materials[key]);
      mesh.name = `dio.terrain.${key}`;
      mesh.renderOrder = order;
      mesh.matrixAutoUpdate = false;
      if (key !== "water") mesh.layers.enable(SHADOW_LAYER);
      mesh.userData.pick = key === "water" ? null : key;
      this.meshes[key] = mesh;
      this.group.add(mesh);
    }
    this.hasWater = !!m.water.count;
  }

  /** Meshes the ground pick ray tests. */
  pickables() {
    return [this.meshes.top, this.meshes.side].filter(Boolean);
  }

  clear() {
    for (const key of Object.keys(this.meshes)) {
      const mesh = this.meshes[key];
      if (!mesh) continue;
      this.group.remove(mesh);
      mesh.geometry.dispose();
      this.meshes[key] = null;
    }
    this.mesh = null;
    this.hasWater = false;
  }

  dispose() {
    this.clear();
    for (const m of Object.values(this.materials)) m.dispose();
  }
}
