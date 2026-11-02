/**
 * Diorama — wiring for the height rules.
 *
 *   installRules()  at init: the sight / light backend, the detection wrapper
 *                   and the two Token movement wrappers. Does nothing when the
 *                   world setting `dio.rules` is off (it requires a reload).
 *   readyRules()    at ready: elevation sync on `updateToken`, and on a terrain
 *                   change the edge cache drop, the perception refresh and the
 *                   active GM's batched resync.
 *
 * Every hook is registered inside these two functions, never at import.
 */

import { log } from "../../../core/const.mjs";
import { onTerrainChange } from "../terrain/live.mjs";
import { levelIdOf } from "../terrain/store.mjs";
import { levelsOf } from "../terrain/levels.mjs";
import { activeContext, anyContext, isFlatCached, rulesSetting, setRulesOn } from "./context.mjs";
import { installSightBackend, clearSightCache, refreshPerception, reportBackendConflicts } from "./sight-backend.mjs";
import { installMovement, onUpdateToken, resyncScene } from "./movement.mjs";

let _installed = false;
let _ready = false;
let _unsubscribe = null;

/** Terrain each scene's Levels had last time we looked: the resync needs the ground before a repaint. */
const _known = new Map(); // scene id → Map<level id, Terrain>

/** Every Level id of a scene the rules read (the one fallback id when it has none). */
function levelIds(scene) {
  const ids = levelsOf(scene).map((l) => l.id);
  return ids.length ? ids : [levelIdOf(scene)];
}

function remember(scene) {
  if (!scene) return;
  const byLevel = new Map();
  for (const id of levelIds(scene)) {
    const live = anyContext(scene, id);
    if (live) byLevel.set(live.levelId, live.terrain);
  }
  if (byLevel.size) _known.set(scene.id, byLevel);
}

/**
 * The Levels a repaint has to re-seat: those whose terrain was active before
 * or is now. Pure over its inputs (the check tool drives it).
 * @param {string[]} ids
 * @param {Map<string, object>|null} old  Level id → terrain before
 * @param {(id:string) => boolean} activeNow
 * @param {(t:object) => boolean} flat
 */
export function levelsToResync(ids, old, activeNow, flat) {
  const out = new Set();
  for (const id of ids) {
    const before = old?.get(id);
    if ((before && !flat(before)) || activeNow(id)) out.add(id);
  }
  return out;
}

/** At init. Idempotent. */
export function installRules() {
  if (_installed) return true;
  if (!rulesSetting()) return false;
  _installed = true;
  setRulesOn(true);
  const types = installSightBackend();
  installMovement();
  log(`Diorama height rules installed (polygon backends: ${types.join(", ") || "none"})`);
  return true;
}

function onChange(scene) {
  clearSightCache();
  refreshPerception(scene);
  if (!scene) { remember(globalThis.canvas?.scene); return; } // a redraw, not a repaint
  const old = _known.get(scene.id) ?? null;
  remember(scene);
  const ids = levelIds(scene).map((id) => levelIdOf(scene, id));
  const levels = levelsToResync(ids, old, (id) => !!activeContext(scene, id), isFlatCached);
  if (levels.size) resyncScene(scene, old, { levels });
}

/** At ready. Idempotent. */
export function readyRules() {
  if (!_installed || _ready) return;
  _ready = true;
  reportBackendConflicts();
  remember(globalThis.canvas?.scene);
  Hooks.on("canvasReady", (c) => remember(c?.scene));
  Hooks.on("updateToken", (doc, changes, options) => {
    remember(doc.parent);
    onUpdateToken(doc, changes, options);
  });
  _unsubscribe = onTerrainChange(onChange);
}

/** For tests and teardown. */
export function rulesInstalled() { return { installed: _installed, ready: _ready, listening: !!_unsubscribe }; }
