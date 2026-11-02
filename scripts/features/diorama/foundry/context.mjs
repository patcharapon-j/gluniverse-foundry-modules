/**
 * Diorama — when the height rules apply, and the grid facts they use.
 *
 * Every Foundry seam in this folder asks `activeContext(scene)` first. It is
 * non-null only when the rules are installed (setting `dio.rules`), the scene
 * is one Diorama supports, its terrain is SAVED (players never get a draft)
 * and that terrain is not flat. A flat or unsaved scene therefore runs
 * Foundry's own code path untouched. Contexts are per v14 Level: a token
 * reads the Level it stands on (`tokenContext`), so a flat Level runs
 * Foundry's own path while the one above it has cliffs.
 *
 * Imports cleanly under Node: nothing here touches a Foundry global at module
 * scope.
 */

import { SUITE_ID } from "../../../core/const.mjs";
import { SETTINGS } from "../constants.mjs";
import { liveTerrain } from "../terrain/live.mjs";
import { tokenLevelId } from "../terrain/levels.mjs";
import { distToQ } from "../terrain/model.mjs";

let _rulesOn = false;

/** Set by installRules once the `dio.rules` setting has been read. */
export function setRulesOn(on) { _rulesOn = !!on; }
export function rulesOn() { return _rulesOn; }

/** Read the world setting (true when it cannot be read). */
export function rulesSetting() {
  try { return game.settings.get(SUITE_ID, SETTINGS.rules) !== false; } catch { return true; }
}

const _flat = new WeakMap(); // Terrain → boolean; a new terrain object per save

/** `Terrain#isFlat` walks every sub-cell; ask it once per decoded terrain. */
export function isFlatCached(terrain) {
  if (!terrain) return true;
  let v = _flat.get(terrain);
  if (v === undefined) { v = terrain.isFlat; _flat.set(terrain, v); }
  return v;
}

/**
 * Live terrain whether or not it is active (the elevation resync needs the flat case too).
 * @param {Scene} scene
 * @param {string|{id:string}|null} [level]  the Level (a token's own: `tokenContext`)
 */
export function anyContext(scene, level = null) {
  if (!scene) return null;
  try { return liveTerrain(scene, level); } catch { return null; }
}

/**
 * Every context is one Level's: its terrain is in that Level's own frame and
 * `base` (distance units) / `baseQ` lift it to absolute elevation.
 * @param {Scene} scene
 * @param {string|{id:string}|null} [level]
 * @returns {{terrain: import("../terrain/model.mjs").Terrain, grid: object, saved: boolean, base: number, baseQ: number, levelId: string}|null}
 */
export function activeContext(scene, level = null) {
  if (!_rulesOn || !scene) return null;
  const live = anyContext(scene, level);
  if (!live?.saved || isFlatCached(live.terrain)) return null;
  return live;
}

/** The active context of the Level a token stands on (v14 TokenDocument#level). */
export function tokenContext(doc, level = null) {
  const d = doc?.document ?? doc;
  return activeContext(d?.parent, level ?? tokenLevelId(d));
}

/** An absolute elevation (distance units) in a context's own frame, q. */
export function localQ(live, elevation) {
  return distToQ((Number(elevation) || 0) - (live?.base || 0), live?.grid?.distance ?? 5);
}

/** Localise at call time: `t(key)` / `t(key, data)`. */
export function t(key, data) {
  const i18n = globalThis.game?.i18n;
  if (!i18n) return key;
  return data ? i18n.format(key, data) : i18n.localize(key);
}
