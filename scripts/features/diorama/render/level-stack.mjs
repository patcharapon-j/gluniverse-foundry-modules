/**
 * Diorama — the lower Levels of a multi-Level scene, drawn under the viewed one.
 *
 * The viewed Level is the renderer's own terrain (TerrainLayer): it is lit,
 * shadowed, walked on and picked. Every Level below it that the viewer may see
 * is drawn here as a quieter floor at its own base height: its own ground
 * (already moved into the absolute frame, terrain/levels.mjs shiftTerrain),
 * its own map art and its own terrain field, through the very same top, side
 * and water programs (each floor's material only swaps the uniforms that are
 * its own, so nothing new compiles). A lower floor is dimmed (`dim`), casts no
 * shadow and receives none: the viewed floor's shadow map does not cover it.
 * Levels above the viewed one are never handed in (the cutaway, view/levels.mjs).
 *
 * PURE: plain state in, meshes out. Nothing here reads the world.
 *
 *   layer.set([{ id, terrain, image, rect, dim }], grid)   // lowest first
 *   layer.lowestY   // the lowest plinth drawn, world y (null: none)
 *   layer.dispose()
 */

import * as THREE from "./three.mjs";
import { buildTerrainMesh } from "./terrain-mesh.mjs";
import { buildTerrainField } from "./terrain-field.mjs";
import { MATERIALS } from "./materials.mjs";
import { geometryFrom, fieldTexture } from "./terrain.mjs";

/** True when the drawable can be uploaded to WebGL (not tainted). */
function uploadable(img) {
  if (typeof document === "undefined") return false;
  try {
    const c = document.createElement("canvas");
    c.width = c.height = 1;
    const g = c.getContext("2d");
    g.drawImage(img, 0, 0, 1, 1);
    g.getImageData(0, 0, 1, 1);
    return true;
  } catch {
    return false;
  }
}

function artTexture(image, aniso) {
  if (!image || !uploadable(image)) return null;
  const t = new THREE.Texture(image);
  t.flipY = false;
  t.anisotropy = aniso;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.needsUpdate = true;
  return t;
}

const rectKey = (r) => (r ? `${r.x},${r.y},${r.width},${r.height}` : "");

export class LevelStackLayer {
  /** @param {Record<string,{value:any}>} shared  @param {{maxAniso?:number}} [o] */
  constructor(shared, { maxAniso = 1 } = {}) {
    this.shared = shared;
    this.maxAniso = maxAniso;
    this.group = new THREE.Group();
    this.group.name = "dio.levels";
    /** @type {Map<string, object>} */
    this.entries = new Map();
    this.lowestY = null;
    this.grid = { size: 100, cols: 1, rows: 1 };
  }

  /** Ids drawn, lowest first (the check tool reads it). */
  get ids() { return [...this.entries.keys()]; }

  /**
   * @param {Array<{id:string, terrain:object, image?:any, rect?:object|null, dim?:number}>} levels
   * @param {{size:number, cols:number, rows:number}} grid
   */
  set(levels, grid) {
    if (grid) this.grid = { size: grid.size || 100, cols: grid.cols || 1, rows: grid.rows || 1 };
    const want = new Map((levels ?? []).filter((l) => l?.id && l.terrain).map((l) => [l.id, l]));
    for (const [id, e] of this.entries) {
      const w = want.get(id);
      if (!w || w.terrain !== e.terrain || (w.image ?? null) !== e.image || rectKey(w.rect) !== e.rect) this.drop(id);
    }
    for (const [id, l] of want) {
      const e = this.entries.get(id) ?? this.build(l);
      e.dim = Math.max(0, Math.min(1, Number(l.dim ?? 1)));
    }
    // Keep lowest-first order for whoever reads `ids`.
    const order = [...want.keys()];
    this.entries = new Map(order.map((id) => [id, this.entries.get(id)]).filter(([, e]) => e));
    let low = Infinity;
    for (const e of this.entries.values()) low = Math.min(low, e.baseY);
    this.lowestY = Number.isFinite(low) ? low : null;
  }

  build(l) {
    const m = buildTerrainMesh(l.terrain);
    const tex = artTexture(l.image ?? null, this.maxAniso);
    const field = fieldTexture(buildTerrainField(l.terrain));
    const g = this.grid, r = l.rect ?? { x: 0, y: 0, width: g.cols * g.size, height: g.rows * g.size };
    const shared = this.shared;
    const e = { terrain: l.terrain, image: l.image ?? null, rect: rectKey(l.rect), baseY: m.baseY, tex, field, meshes: [], materials: [], dim: 1 };
    // Each floor's own uniforms; everything else is the shared object, by reference.
    const own = {
      ...shared,
      uMap: { value: tex },
      uHasMap: { value: tex ? 1 : 0 },
      uMapRect: { value: new THREE.Vector4(r.x / g.size, r.y / g.size, Math.max(1e-3, r.width / g.size), Math.max(1e-3, r.height / g.size)) },
      uField: { value: field },
      uFieldOn: { value: 1 },
      uHeightRange: { value: new THREE.Vector2(m.minY, Math.max(m.maxY, m.minY + 0.25)) },
      // the viewed floor's shadow map does not reach down here
      uShadowMode: { value: 0 },
      // a quieter floor: the scene's light, dimmed (read every frame through the getter)
      uAmbient: { get value() { return (shared.uAmbient?.value ?? 1) * e.dim; }, set value(_v) { /* derived */ } },
    };
    for (const [key, part, order] of [["top", m.tops, -2], ["side", m.sides, -2], ["water", m.water, 4]]) {
      if (!part.count) continue;
      const mat = MATERIALS[key](own);
      const mesh = new THREE.Mesh(geometryFrom(part), mat);
      mesh.name = `dio.levels.${l.id}.${key}`;
      mesh.renderOrder = order;
      mesh.matrixAutoUpdate = false;
      e.meshes.push(mesh);
      e.materials.push(mat);
      this.group.add(mesh);
    }
    this.entries.set(l.id, e);
    return e;
  }

  drop(id) {
    const e = this.entries.get(id);
    if (!e) return;
    for (const mesh of e.meshes) { this.group.remove(mesh); mesh.geometry.dispose(); }
    for (const mat of e.materials) mat.dispose();
    e.tex?.dispose();
    e.field?.dispose();
    this.entries.delete(id);
  }

  clear() {
    for (const id of [...this.entries.keys()]) this.drop(id);
    this.lowestY = null;
  }

  dispose() { this.clear(); }
}
