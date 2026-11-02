/**
 * Diorama — the live (saved) terrain of a scene, cached.
 *
 * Everything that reads terrain at runtime (the sight backend, movement, the
 * 3D view) asks here, so a scene's terrain is decoded once per save rather
 * than once per polygon. The cache is invalidated by `invalidate(scene)`,
 * which main.mjs calls from `updateScene` when TerrainStore.touched(changes)
 * or PropStore.touched(changes), when the world setting dio.propsBlock
 * changes, and on a canvas redraw.
 *
 * Two terrains come back:
 *   terrain  the RULES terrain: the saved ground with every solid, visible
 *            prop stamped into it while dio.propsBlock is on. Movement, sight,
 *            cover and standing height read this.
 *   ground   the saved ground alone. The 3D view draws this (the props draw
 *            themselves) and the editor edits it.
 * `props` is the scene's props resolved against the ground (terrain/props.mjs
 * resolveProps): each carries its base and top in q.
 *
 * Listeners (`onTerrainChange`) are told after an invalidation so the sight
 * backend can drop its edge cache and re-initialise perception, and an open
 * view can rebuild its meshes.
 */

import { SUITE_ID } from "../../../core/const.mjs";
import { TerrainStore, gridOf, supportsScene } from "./store.mjs";
import { PropStore } from "./props-store.mjs";
import { resolveProps } from "./props.mjs";

/** World setting: solid props stamp into the rules terrain. */
export const PROPS_BLOCK = "dio.propsBlock";

const _cache = new Map(); // scene id → entry
const _listeners = new Set();

/** Whether solid props block (dio.propsBlock). Defaults on outside Foundry. */
export function propsBlock() {
  try { return globalThis.game?.settings?.get(SUITE_ID, PROPS_BLOCK) !== false; } catch { return true; }
}

/**
 * @param {Scene} scene
 * @returns {{terrain: import("./model.mjs").Terrain, ground: import("./model.mjs").Terrain,
 *   props: object[], grid: ReturnType<typeof gridOf>, saved: boolean}|null}
 *   null when the scene is not one Diorama supports
 */
export function liveTerrain(scene) {
  if (!scene || !supportsScene(scene)) return null;
  let e = _cache.get(scene.id);
  if (!e) {
    const ground = TerrainStore.read(scene);
    const stored = PropStore.read(scene);
    const res = resolveProps(ground, stored, { stamp: propsBlock() });
    e = {
      terrain: res.terrain,
      ground,
      props: res.props,
      grid: gridOf(scene),
      saved: TerrainStore.has(scene) || stored.length > 0,
    };
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
