/**
 * Diorama — the live (saved) terrain of a scene, cached.
 *
 * Everything that reads terrain at runtime (the sight backend, movement, the
 * 3D view) asks here, so a scene's terrain is decoded once per save rather
 * than once per polygon. The cache is invalidated by `invalidate(scene)`,
 * which main.mjs calls from `updateScene` when TerrainStore.touched(changes),
 * and by a canvas redraw.
 *
 * Listeners (`onTerrainChange`) are told after an invalidation so the sight
 * backend can drop its edge cache and re-initialise perception, and an open
 * view can rebuild its meshes.
 */

import { TerrainStore, gridOf, supportsScene } from "./store.mjs";

const _cache = new Map(); // scene id → { terrain, grid }
const _listeners = new Set();

/**
 * @param {Scene} scene
 * @returns {{terrain: import("./model.mjs").Terrain, grid: ReturnType<typeof gridOf>, saved: boolean}|null}
 *   null when the scene is not one Diorama supports
 */
export function liveTerrain(scene) {
  if (!scene || !supportsScene(scene)) return null;
  let e = _cache.get(scene.id);
  if (!e) {
    e = { terrain: TerrainStore.read(scene), grid: gridOf(scene), saved: TerrainStore.has(scene) };
    _cache.set(scene.id, e);
  }
  return e;
}

/** Drop the cached terrain of a scene (or all scenes) and notify listeners. */
export function invalidate(scene = null) {
  if (scene) _cache.delete(scene.id);
  else _cache.clear();
  for (const fn of _listeners) {
    try { fn(scene); } catch (e) { console.error(e); }
  }
}

/** @param {(scene: Scene|null) => void} fn @returns {() => void} unsubscribe */
export function onTerrainChange(fn) {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}
