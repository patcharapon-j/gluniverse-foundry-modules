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
 *
 * LEVELS. One entry per scene per v14 Level (terrain/levels.mjs). An entry's
 * terrains are in the Level's OWN frame (q 0 = the Level's floor); `base` is
 * the Level's base elevation (distance units, 0 in a one-Level scene) and
 * `baseQ` the same in q, so a rule that holds an absolute elevation subtracts
 * `base` first. `absolute()` hands the 3D view the same terrains moved up to
 * the base (shiftTerrain), built once per entry. Without a Level asked for,
 * the entry is the Level in question (viewed, else initial).
 */

import { SUITE_ID } from "../../../core/const.mjs";
import { TerrainStore, gridOf, supportsScene, levelIdOf } from "./store.mjs";
import { PropStore } from "./props-store.mjs";
import { resolveProps } from "./props.mjs";
import { distToQ } from "./model.mjs";
import { levelBaseDist, shiftTerrain } from "./levels.mjs";

/** World setting: solid props stamp into the rules terrain. */
export const PROPS_BLOCK = "dio.propsBlock";

const _cache = new Map(); // `${scene id}|${level id}` → entry
const _listeners = new Set();

/** Whether solid props block (dio.propsBlock). Defaults on outside Foundry. */
export function propsBlock() {
  try { return globalThis.game?.settings?.get(SUITE_ID, PROPS_BLOCK) !== false; } catch { return true; }
}

/**
 * @param {Scene} scene
 * @param {string|{id:string}|null} [level]  the Level (default: the Level in question)
 * @returns {{terrain: import("./model.mjs").Terrain, ground: import("./model.mjs").Terrain,
 *   props: object[], grid: ReturnType<typeof gridOf>, saved: boolean,
 *   levelId: string, base: number, baseQ: number,
 *   absolute: () => {terrain: import("./model.mjs").Terrain, ground: import("./model.mjs").Terrain}}|null}
 *   null when the scene is not one Diorama supports
 */
export function liveTerrain(scene, level = null) {
  if (!scene || !supportsScene(scene)) return null;
  const levelId = levelIdOf(scene, level);
  const key = `${scene.id}|${levelId}`;
  let e = _cache.get(key);
  if (!e) {
    const ground = TerrainStore.read(scene, levelId);
    const stored = PropStore.read(scene, levelId);
    const res = resolveProps(ground, stored, { stamp: propsBlock() });
    const grid = gridOf(scene);
    const base = levelBaseDist(scene, levelId);
    let abs = null;
    e = {
      terrain: res.terrain,
      ground,
      props: res.props,
      grid,
      saved: TerrainStore.has(scene, levelId) || stored.length > 0,
      levelId,
      base,
      baseQ: distToQ(base, grid.distance),
      absolute() {
        abs ??= { terrain: shiftTerrain(this.terrain, this.baseQ), ground: shiftTerrain(this.ground, this.baseQ) };
        return abs;
      },
    };
    _cache.set(key, e);
  }
  return e;
}

/** Drop the cached terrain of a scene (or all scenes) and notify listeners. */
export function invalidate(scene = null) {
  if (scene) {
    const head = `${scene.id}|`;
    for (const k of [..._cache.keys()]) if (k.startsWith(head)) _cache.delete(k);
  } else _cache.clear();
  for (const fn of _listeners) {
    try { fn(scene); } catch (e) { console.error(e); }
  }
}

/** @param {(scene: Scene|null) => void} fn @returns {() => void} unsubscribe */
export function onTerrainChange(fn) {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}
