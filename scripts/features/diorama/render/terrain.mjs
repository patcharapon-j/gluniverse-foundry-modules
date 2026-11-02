/**
 * Diorama — the terrain layer: wraps terrain-mesh.mjs output in three meshes,
 * bakes the terrain field (terrain-field.mjs) the terrain shaders sample, and
 * lays the board's soft shadow on the table under it.
 */

import * as THREE from "./three.mjs";
import { buildTerrainMesh } from "./terrain-mesh.mjs";
import { buildTerrainField } from "./terrain-field.mjs";
import { MATERIALS } from "./materials.mjs";

/** Layer the key light's shadow camera renders. */
export const SHADOW_LAYER = 1;

/** How far the table shadow's plane reaches past the board, cells. */
const TABLE_MARGIN = 6;

export function geometryFrom(part) {
  const g = new THREE.BufferGeometry();
  for (const [name, size] of Object.entries(part.itemSize)) {
    g.setAttribute(name, new THREE.BufferAttribute(part[name], size));
  }
  g.setIndex(new THREE.BufferAttribute(part.index, 1));
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

export function fieldTexture(f) {
  const t = new THREE.DataTexture(f.data, f.width, f.height, THREE.RGBAFormat);
  t.flipY = false;
  t.generateMipmaps = false;
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.needsUpdate = true;
  return t;
}

export class TerrainLayer {
  constructor(shared) {
    this.shared = shared;
    this.group = new THREE.Group();
    this.group.name = "dio.terrain";
    this.materials = {
      top: MATERIALS.top(shared),
      side: MATERIALS.side(shared),
      water: MATERIALS.water(shared),
      table: MATERIALS.table(shared),
    };
    this.meshes = { top: null, side: null, water: null, table: null };
    this.mesh = null;
    this.hasWater = false;
    this.terrain = null;
    this.blankField = shared.uField.value;
    this.fieldTex = null;
    /** The lowest floor drawn under this board (a lower Level), world y; null: none. */
    this.tableFloor = null;
  }

  /**
   * Lay the table under a lower floor too: with Levels stacked beneath the
   * viewed one, its soft shadow sits under the lowest of them, never across
   * them. null puts it back under this board alone.
   * @param {number|null} y  world y
   */
  setTableFloor(y) {
    this.tableFloor = Number.isFinite(y) ? y : null;
    const table = this.meshes.table;
    if (!table || !this.mesh) return;
    table.position.y = this.tableY();
    table.updateMatrix();
  }

  tableY() {
    const base = this.mesh ? this.mesh.baseY : 0;
    return Math.min(base, this.tableFloor ?? Infinity) - 0.01;
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

    this.fieldTex = fieldTexture(buildTerrainField(terrain));
    this.shared.uField.value = this.fieldTex;
    this.shared.uFieldOn.value = 1;
    this.shared.uHeightRange.value.set(m.minY, Math.max(m.maxY, m.minY + 0.25));

    const b = m.bounds;
    const w = b.x1 - b.x0 + TABLE_MARGIN * 2, d = b.z1 - b.z0 + TABLE_MARGIN * 2;
    const plane = new THREE.PlaneGeometry(w, d);
    plane.rotateX(-Math.PI / 2);
    const table = new THREE.Mesh(plane, this.materials.table);
    table.name = "dio.terrain.table";
    table.position.set((b.x0 + b.x1) / 2, this.tableY(), (b.z0 + b.z1) / 2);
    table.updateMatrix();
    table.matrixAutoUpdate = false;
    table.renderOrder = -10;
    this.materials.table.uniforms.uBounds.value.set(b.x0, b.z0, b.x1, b.z1);
    this.meshes.table = table;
    this.group.add(table);
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
    this.fieldTex?.dispose();
    this.fieldTex = null;
    this.shared.uField.value = this.blankField;
    this.shared.uFieldOn.value = 0;
  }

  dispose() {
    this.clear();
    for (const m of Object.values(this.materials)) m.dispose();
    this.blankField?.dispose();
  }
}
