/**
 * Diorama — onInit / onReady wiring and the feature api.
 *
 * Nothing runs at import: index.mjs imports this to hand the registry its
 * lifecycle, and a disabled feature never reaches onInit. The view itself
 * (view/overlay.mjs, and through it three.js) is imported only when something
 * opens it; the socket half (view/sync.mjs) is light and wired at ready.
 *
 *   init   the height rules (sight/light backend, movement), keybindings,
 *          the scene controls, terrain cache invalidation.
 *   ready  the rules' ready half, the invite / summon socket, the stream
 *          Control Room's 2D / 3D switch (stream-bridge.mjs).
 *
 * The way in and out is ONE toggle in Foundry's Token Controls ("3D view",
 * pressed while the view is open). While it is open the view's own tools sit
 * under it in the same column (VIEW_TOOLS, view/hud.mjs); nothing of the view's
 * is pinned on the board. The suite group keeps the GM's Edit terrain.
 */

import { SUITE_ID, warn, err } from "../../core/const.mjs";
import { ensureSuiteGroup, bindSuiteToolClicks } from "../../core/scene-controls.mjs";
import { TerrainStore, supportsScene } from "./terrain/store.mjs";
import { invalidate, PROPS_BLOCK } from "./terrain/live.mjs";
import { PropStore } from "./terrain/props-store.mjs";
import { installRules, readyRules } from "./foundry/install.mjs";
import { wireSocket } from "./view/sync.mjs";
import { watchTargetLines } from "./integrations/target-lines.mjs";
import { wireStandee } from "./view/standee-app.mjs";
import { VIEW_TOOLS } from "./view/hud.mjs";
import { keyHint } from "./view/util.mjs";
import { wireStreamBridge, reportViewToStream } from "./stream-bridge.mjs";

export const TOOL_VIEW = "gldio-view";
export const TOOL_EDIT = "gldio-edit";

let _viewP = null;
let _view = null;

/** The overlay module, imported on first use. */
function loadView() {
  _viewP ??= import("./view/overlay.mjs").then((m) => {
    m.onOpenChange?.(() => onViewOpenChange());
    m.onToolsChange?.(() => syncTools());
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
  /**
   * Import a Map Maker Diorama Bundle (docs/DIORAMA_BUNDLE.md) from a folder
   * Foundry serves: its layout as importLayout writes one, with every model
   * read from the folder, and the Level's 3D ground. GM only. Resolves
   * `{ ok, errors, warnings, ground, props, moved, missing }`.
   * @param {string} folder  @param {{scene?: Scene, tokens?: boolean}} [o]
   */
  importBundle: (folder, o) => import("./editor/bundle-import.mjs").then((m) => m.importBundle(folder, o)),
  /**
   * Set (or with null, clear) a scene Level's 3D ground image: the 3D view
   * draws it instead of the background, over the same rect. GM only.
   * @param {string|null} src  @param {{scene?: Scene, level?: string}} [o]
   */
  setGround: (src, { scene = globalThis.canvas?.scene, level = null } = {}) =>
    import("./terrain/ground.mjs").then((m) => m.GroundStore.write(scene, src, level)),
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

/** The Token Controls' tool names: prefixed, so they never meet Foundry's or another module's. */
const toolName = (act) => `gldio-${act}`;

/** The view opened or closed: the Token Controls gain or lose the view's tools, the stream hears it. */
function onViewOpenChange() {
  try {
    ui.controls?.render?.({ reset: true });
    // the view's tools are in the Token Controls, and the view keeps that layer active
    if (isOpen() && globalThis.canvas?.ready && ui.controls?.control?.name !== "tokens") globalThis.canvas.tokens?.activate?.();
  } catch (e) { warn("diorama | scene controls", e); }
  reportViewToStream(isOpen());
}

/**
 * Put every toggle's pressed state back on Foundry's buttons without
 * re-rendering the controls (a key, Escape or a setting moved one). Foundry
 * draws a toggle from `tool.active`, so the record is written too.
 */
function syncTools() {
  const tools = ui.controls?.controls?.tokens?.tools;
  const state = _view?.viewToolState?.();
  if (!tools) return;
  const set = (name, on) => {
    const tool = tools[name];
    if (!tool) return;
    tool.active = !!on;
    ui.controls.element?.querySelector?.(`button.tool[data-tool="${name}"]`)?.setAttribute("aria-pressed", on ? "true" : "false");
  };
  set(TOOL_VIEW, isOpen());
  if (!state) return;
  for (const b of VIEW_TOOLS) if (b.toggle) set(toolName(b.act), state[b.act]);
}

/** A tool title with its current keys, when it has any. */
function titled(key, bind) {
  const label = game.i18n.localize(key);
  const keys = bind ? keyHint(bind) : "";
  return keys ? `${label} (${keys})` : label;
}

function onGetSceneControlButtons(controls) {
  if (!offeredHere()) return;
  // The way in and out: one toggle among the Token Controls, pressed while the view is open.
  const tokens = controls.tokens;
  if (tokens?.tools && (game.user.isGM || !TerrainStore.isOff(globalThis.canvas?.scene))) {
    const base = 100;
    tokens.tools[TOOL_VIEW] = {
      name: TOOL_VIEW,
      title: titled(isOpen() ? "GLDIO.controls.viewOn" : "GLDIO.controls.view", "dio.toggle"),
      icon: "fa-solid fa-cubes",
      order: base,
      toggle: true,
      active: isOpen(),
      visible: true,
      onChange: (_event, on) => setView(on),
    };
    if (isOpen()) {
      const state = _view?.viewToolState?.() ?? {};
      VIEW_TOOLS.forEach((b, k) => {
        if (b.gm && !game.user.isGM) return;
        const name = toolName(b.act);
        tokens.tools[name] = {
          name,
          title: titled(b.key, b.bind),
          icon: b.icon,
          order: base + 1 + k,
          visible: true,
          ...(b.toggle
            ? { toggle: true, active: !!state[b.act], onChange: (_event, on) => _view?.runViewTool(b.act, on) }
            : { button: true, onChange: () => _view?.runViewTool(b.act) }),
        };
      });
    }
  }
  if (game.user.isGM) {
    const group = ensureSuiteGroup(controls);
    if (!group) return;
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

/**
 * The toggle was pressed: open or close to match it. A view that cannot open
 * (no scene, a hex grid) puts the button back up.
 * @param {boolean} on
 */
function setView(on) {
  if (!!on === isOpen()) return;
  if (on) {
    api.open().then((ok) => { if (!ok) syncTools(); }).catch((e) => { warn("diorama | open", e); syncTools(); });
  } else {
    api.close();
  }
}

function onRenderSceneControls(_app, html) {
  bindSuiteToolClicks(html, { [TOOL_EDIT]: editOnce });
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
  // the stream client: a new scene may not offer the view at all
  reportViewToStream();
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
}

export function onReady() {
  try {
    const p = readyRules();
    if (p && typeof p.catch === "function") p.catch((e) => err("diorama: readyRules failed", e));
  } catch (e) {
    err("diorama: readyRules failed", e);
  }
  wireSocket(loadView, isOpen);
  // A director's 2D / 3D switch for the stream capture (stream's Control Room).
  wireStreamBridge({ open: () => api.open(), close: () => api.close(), isOpen, offered: () => offeredHere() && !TerrainStore.isOff(globalThis.canvas?.scene) });
}
