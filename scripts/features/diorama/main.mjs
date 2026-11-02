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
 *   ready  the rules' ready half, the invite / summon socket.
 */

import { SUITE_ID, warn, err } from "../../core/const.mjs";
import { ensureSuiteGroup, bindSuiteToolClicks } from "../../core/scene-controls.mjs";
import { TerrainStore, supportsScene } from "./terrain/store.mjs";
import { invalidate, PROPS_BLOCK } from "./terrain/live.mjs";
import { PropStore } from "./terrain/props-store.mjs";
import { installRules, readyRules } from "./foundry/install.mjs";
import { wireSocket } from "./view/sync.mjs";
import { watchTargetLines } from "./integrations/target-lines.mjs";

export const TOOL_VIEW = "gldio-view";
export const TOOL_EDIT = "gldio-edit";

let _viewP = null;
let _view = null;

/** The overlay module, imported on first use. */
function loadView() {
  _viewP ??= import("./view/overlay.mjs").then((m) => (_view = m));
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

/** May this client see the view's button on the viewed scene? */
function offeredHere() {
  const scene = globalThis.canvas?.scene;
  if (!scene || !supportsScene(scene)) return false;
  return game.user.isGM || !TerrainStore.isOff(scene);
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
    onChange: toggleOnce,
  };
  if (game.user.isGM) {
    group.tools[TOOL_EDIT] = {
      name: TOOL_EDIT,
      title: "GLDIO.controls.edit",
      icon: "fa-solid fa-mountain",
      order: Object.keys(group.tools).length,
      button: true,
      visible: true,
      onChange: editOnce,
    };
  }
}

function onRenderSceneControls(_app, html) {
  bindSuiteToolClicks(html, { [TOOL_VIEW]: toggleOnce, [TOOL_EDIT]: editOnce });
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
}

function onUpdateScene(scene, changes) {
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
  Hooks.on("getSceneControlButtons", onGetSceneControlButtons);
  Hooks.on("renderSceneControls", onRenderSceneControls);
  Hooks.on("updateScene", onUpdateScene);
  Hooks.on("updateSetting", onUpdateSetting);
  Hooks.on("canvasReady", onCanvasReady);
}

export function onReady() {
  try {
    const p = readyRules();
    if (p && typeof p.catch === "function") p.catch((e) => err("diorama: readyRules failed", e));
  } catch (e) {
    err("diorama: readyRules failed", e);
  }
  wireSocket(loadView, isOpen);
}
