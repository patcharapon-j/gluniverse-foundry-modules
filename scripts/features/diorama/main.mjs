/**
 * Diorama — onInit / onReady wiring and the feature api.
 *
 * Nothing runs at import: index.mjs imports this to hand the registry its
 * lifecycle, and a disabled feature never reaches onInit. The view itself
 * (view/overlay.mjs, and through it three.js) is imported only when something
 * opens it; the socket half (view/sync.mjs) is light and wired at ready.
 *
 *   init   the height rules (sight/light backend, movement), keybindings,
 *          the suite scene-control buttons, terrain cache invalidation.
 *   ready  the rules' ready half, the invite / summon socket, the "3D view"
 *          entry chip on the 2D board (view/entry.mjs).
 */

import { SUITE_ID, warn, err } from "../../core/const.mjs";
import { ensureSuiteGroup, bindSuiteToolClicks } from "../../core/scene-controls.mjs";
import { TerrainStore, supportsScene } from "./terrain/store.mjs";
import { invalidate, PROPS_BLOCK } from "./terrain/live.mjs";
import { PropStore } from "./terrain/props-store.mjs";
import { installRules, readyRules } from "./foundry/install.mjs";
import { wireSocket } from "./view/sync.mjs";
import { watchTargetLines } from "./integrations/target-lines.mjs";
import { registerReadout } from "../perf/readouts.mjs";
import { readoutRows } from "./view/readout.mjs";
import { wireStandee } from "./view/standee-app.mjs";
import { EntryChip } from "./view/entry.mjs";

export const TOOL_VIEW = "gldio-view";
export const TOOL_EDIT = "gldio-edit";

let _viewP = null;
let _view = null;
/** The "3D view" chip on the 2D board, built at ready. */
let _entry = null;

/** The overlay module, imported on first use. */
function loadView() {
  _viewP ??= import("./view/overlay.mjs").then((m) => {
    m.onOpenChange?.(() => refreshEntry());
    return (_view = m);
  });
  return _viewP;
}

const isOpen = () => _view?.isOpen() ?? false;

export const api = {
  open: () => loadView().then((m) => m.openView()),
  close: () => (_view ? _view.closeView() : false),
  toggle: () => loadView().then((m) => m.toggleView()),
  isOpen,
  /**
   * Where a scene point shows on screen while the 3D view covers the canvas,
   * for any feature that hangs DOM over the board (client px), or null when
   * the view is closed and the 2D stage transform still applies.
   * @param {number} x  scene px   @param {number} y  scene px
   * @param {number} [elevation]  scene distance units
   */
  project: (x, y, elevation = 0) => (_view?.isOpen() ? _view.projectPoint(x, y, elevation) : null),
  /** A token's on-screen anchor above its standee's head, or null when closed. */
  tokenAnchor: (tokenId) => (_view?.isOpen() ? _view.tokenAnchor(tokenId) : null),
  /**
   * Write a layout (docs/DIORAMA_LAYOUT.md) to a scene and place its tokens.
   * GM only. Resolves `{ ok, errors, warnings, moved, missing }`.
   * @param {object|string} layout  @param {{scene?: Scene, tokens?: boolean}} [o]
   */
  importLayout: (layout, o) => import("./editor/layout-import.mjs").then((m) => m.importLayout(layout, o)),
};

/* A `button` tool fires onChange only when the active tool changes, so clicks
   are also bound directly and can arrive through both roads; a toggle run
   twice is a dead button, so each action runs once per short window. */
const DEDUPE_MS = 250;
const _lastRun = new Map();
const once = (name, fn) => () => {
  const now = performance.now();
  if (now - (_lastRun.get(name) ?? -Infinity) < DEDUPE_MS) return;
  _lastRun.set(name, now);
  Promise.resolve().then(fn).catch((e) => warn(`diorama | ${name} failed`, e));
};

const toggleOnce = once(TOOL_VIEW, () => api.toggle());
const editOnce = once(TOOL_EDIT, async () => (await loadView()).editTerrain(globalThis.canvas?.scene));
/* Foundry also calls a tool's onChange with active = false when it is
   deactivated; only a press may open or close anything, so a layer or tool
   switch never closes the view. */
const pressed = (fn) => (_event, active) => { if (active !== false) fn(); };

/** May this client see the view's button on the viewed scene? */
function offeredHere() {
  const scene = globalThis.canvas?.scene;
  if (!scene || !supportsScene(scene)) return false;
  return game.user.isGM || !TerrainStore.isOff(scene);
}

/**
 * The 2D entry chip: shown where the view is offered, the scene is not
 * switched off (the GM keeps the scene-control button there), and the view is
 * not already open.
 */
function refreshEntry() {
  if (!_entry) return;
  const scene = globalThis.canvas?.scene;
  const show = !!globalThis.canvas?.ready && offeredHere() && !TerrainStore.isOff(scene) && !isOpen();
  _entry.set(show);
}

function onGetSceneControlButtons(controls) {
  if (!offeredHere()) return;
  const group = ensureSuiteGroup(controls);
  if (!group) return;
  group.tools[TOOL_VIEW] = {
    name: TOOL_VIEW,
    title: "GLDIO.controls.view",
    icon: "fa-solid fa-cubes",
    order: Object.keys(group.tools).length,
    button: true,
    visible: true,
    onChange: pressed(toggleOnce),
  };
  if (game.user.isGM) {
    group.tools[TOOL_EDIT] = {
      name: TOOL_EDIT,
      title: "GLDIO.controls.edit",
      icon: "fa-solid fa-mountain",
      order: Object.keys(group.tools).length,
      button: true,
      visible: true,
      onChange: pressed(editOnce),
    };
  }
}

function onRenderSceneControls(_app, html) {
  bindSuiteToolClicks(html, { [TOOL_VIEW]: toggleOnce, [TOOL_EDIT]: editOnce });
  // the controls change width with the active tool set
  _entry?.place();
}

function registerKeybindings() {
  const priority = CONST.KEYBINDING_PRECEDENCE?.PRIORITY ?? 0;
  game.keybindings.register(SUITE_ID, "dio.toggle", {
    name: "GLDIO.keys.toggle",
    hint: "GLDIO.keys.toggleHint",
    editable: [{ key: "KeyV", modifiers: ["Shift"] }],
    restricted: false,
    onDown: () => { toggleOnce(); return true; },
  });
  // The 2D map window inside the 3D view. Acts only while the view is open.
  game.keybindings.register(SUITE_ID, "dio.peek", {
    name: "GLDIO.keys.peek",
    hint: "GLDIO.keys.peekHint",
    editable: [{ key: "KeyM", modifiers: ["Shift"] }],
    restricted: false,
    onDown: () => _view?.togglePeek() ?? false,
  });
  // The camera keys act only while the view is open; returning false hands
  // the key on to whatever else is bound to it.
  game.keybindings.register(SUITE_ID, "dio.yawLeft", {
    name: "GLDIO.keys.yawLeft",
    editable: [{ key: "KeyQ" }],
    restricted: false,
    precedence: priority,
    onDown: () => _view?.rotate(-1) ?? false,
  });
  game.keybindings.register(SUITE_ID, "dio.yawRight", {
    name: "GLDIO.keys.yawRight",
    editable: [{ key: "KeyE" }],
    restricted: false,
    precedence: priority,
    onDown: () => _view?.rotate(1) ?? false,
  });
  game.keybindings.register(SUITE_ID, "dio.pitch", {
    name: "GLDIO.keys.pitch",
    editable: [{ key: "KeyR" }],
    restricted: false,
    precedence: priority,
    onDown: () => _view?.cyclePitch() ?? false,
  });
  // The GM's "cut away roofs" (docs/DIORAMA_BUILDINGS.md). No default key.
  game.keybindings.register(SUITE_ID, "dio.roofs", {
    name: "GLDIO.keys.roofs",
    hint: "GLDIO.keys.roofsHint",
    editable: [],
    restricted: true,
    onDown: () => { if (!_view?.isOpen?.()) return false; _view.toggleRoofs(); return true; },
  });
}

function onUpdateScene(scene, changes) {
  // the grid type or the "3D off" switch may have moved: re-gate the 2D chip
  if (scene === globalThis.canvas?.scene) refreshEntry();
  // Props are part of the rules terrain (stamped while dio.propsBlock is on),
  // so a props save drops the same cache a terrain save does.
  if (!TerrainStore.touched(changes) && !PropStore.touched(changes)) return;
  invalidate(scene);
  if (scene !== globalThis.canvas?.scene) return;
  // "3D off" toggled: re-gate the button, and close a player's open view.
  ui.controls?.render?.();
  if (!game.user.isGM && TerrainStore.isOff(scene) && isOpen()) {
    _view.closeView();
    ui.notifications?.info(game.i18n.localize("GLDIO.view.off"));
  }
}

/** Switching dio.propsBlock re-stamps (or un-stamps) every scene's rules terrain. */
function onUpdateSetting(setting) {
  if (setting?.key === `${SUITE_ID}.${PROPS_BLOCK}`) invalidate();
}

function onCanvasReady() {
  invalidate();
  _view?.onCanvasReady();
  refreshEntry();
}

/** The scene is going away: no chip until the next one is drawn and gated. */
function onCanvasTearDown() {
  _entry?.set(false);
}

/** A Level's elevation sets where its terrain stands: a Level change drops the scene's cache. */
function onLevelChange(level) {
  const scene = level?.parent;
  if (scene?.documentName === "Scene" || scene?.levels) invalidate(scene);
}

export function onInit() {
  try {
    const p = installRules();
    if (p && typeof p.catch === "function") p.catch((e) => err("diorama: installRules failed", e));
  } catch (e) {
    err("diorama: installRules failed", e);
  }
  registerKeybindings();
  watchTargetLines();
  wireStandee();
  Hooks.on("getSceneControlButtons", onGetSceneControlButtons);
  Hooks.on("renderSceneControls", onRenderSceneControls);
  Hooks.on("updateScene", onUpdateScene);
  Hooks.on("updateSetting", onUpdateSetting);
  Hooks.on("canvasReady", onCanvasReady);
  for (const h of ["createLevel", "updateLevel", "deleteLevel"]) Hooks.on(h, onLevelChange);
  Hooks.on("canvasTearDown", onCanvasTearDown);
}

export function onReady() {
  try {
    const p = readyRules();
    if (p && typeof p.catch === "function") p.catch((e) => err("diorama: readyRules failed", e));
  } catch (e) {
    err("diorama: readyRules failed", e);
  }
  wireSocket(loadView, isOpen);
  // The perf overlay's Diorama section: only while the view is open (it reads
  // nothing otherwise, and the renderer times frames only while the overlay is up).
  registerReadout(game.i18n.localize("GLDIO.graphics.readout.section"), () => {
    const r = _view?.isOpen?.() ? _view.viewRenderer?.() : null;
    return r ? readoutRows(r.profile(), (k) => game.i18n.localize(k)) : null;
  });
  // The way in, labelled, on the 2D board (the scene-control button and Shift+V stay).
  _entry = new EntryChip({ onOpen: toggleOnce });
  refreshEntry();
}
