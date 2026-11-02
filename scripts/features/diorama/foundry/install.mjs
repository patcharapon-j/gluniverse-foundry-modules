/**
 * Diorama — wiring for the height rules.
 *
 *   installRules()  at init: the sight / light backend, the detection wrapper
 *                   and the two Token movement wrappers. Does nothing when the
 *                   world setting `dio.rules` is off (it requires a reload).
 *   readyRules()    at ready: elevation sync on `updateToken`, the altitude
 *                   re-derived from an elevation edit on `preUpdateToken`, a
 *                   new token seated on `preCreateToken`, and on a terrain
 *                   change the edge cache drop, the perception refresh and the
 *                   active GM's batched resync.
 *
 * Every hook is registered inside these two functions, never at import.
 */

import { log } from "../../../core/const.mjs";
import { onTerrainChange } from "../terrain/live.mjs";
import { activeContext, anyContext, isFlatCached, rulesSetting, setRulesOn } from "./context.mjs";
import { installSightBackend, clearSightCache, refreshPerception, reportBackendConflicts } from "./sight-backend.mjs";
import { installMovement, onPreCreateToken, onPreUpdateToken, onUpdateToken, resyncScene } from "./movement.mjs";

let _installed = false;
let _ready = false;
let _unsubscribe = null;

/** Terrain each scene had last time we looked: the resync needs the ground before a repaint. */
const _known = new Map(); // scene id → Terrain

function remember(scene) {
  if (!scene) return;
  const live = anyContext(scene);
  if (live) _known.set(scene.id, live.terrain);
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
  const wasActive = !!old && !isFlatCached(old);
  if (wasActive || activeContext(scene)) resyncScene(scene, old);
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
  Hooks.on("preUpdateToken", (doc, changes, options) => { onPreUpdateToken(doc, changes, options); });
  Hooks.on("preCreateToken", (doc, data, options) => { onPreCreateToken(doc, data, options); });
  _unsubscribe = onTerrainChange(onChange);
}

/** For tests and teardown. */
export function rulesInstalled() { return { installed: _installed, ready: _ready, listening: !!_unsubscribe }; }
