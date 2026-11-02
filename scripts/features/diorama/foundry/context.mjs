/**
 * Diorama — when the height rules apply, and the grid facts they use.
 *
 * Every Foundry seam in this folder asks `activeContext(scene)` first. It is
 * non-null only when the rules are installed (setting `dio.rules`), the scene
 * is one Diorama supports, its terrain is SAVED (players never get a draft)
 * and that terrain is not flat. A flat or unsaved scene therefore runs
 * Foundry's own code path untouched.
 *
 * Imports cleanly under Node: nothing here touches a Foundry global at module
 * scope.
 */

import { SUITE_ID } from "../../../core/const.mjs";
import { SETTINGS } from "../constants.mjs";
import { liveTerrain } from "../terrain/live.mjs";

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

/** Live terrain whether or not it is active (the elevation resync needs the flat case too). */
export function anyContext(scene) {
  if (!scene) return null;
  try { return liveTerrain(scene); } catch { return null; }
}

/**
 * @param {Scene} scene
 * @returns {{terrain: import("../terrain/model.mjs").Terrain, grid: object, saved: boolean}|null}
 */
export function activeContext(scene) {
  if (!_rulesOn || !scene) return null;
  const live = anyContext(scene);
  if (!live?.saved || isFlatCached(live.terrain)) return null;
  return live;
}

/** Localise at call time: `t(key)` / `t(key, data)`. */
export function t(key, data) {
  const i18n = globalThis.game?.i18n;
  if (!i18n) return key;
  return data ? i18n.format(key, data) : i18n.localize(key);
}
