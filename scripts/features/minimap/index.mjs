/**
 * GLUniverse Suite — Minimap feature adapter.
 *
 * Registers the feature, its world/client settings, the Control Center "Open
 * Map Studio" menu, the scene-control tools, and a toggle keybinding. All
 * runtime orchestration lives in controller.mjs (wired at onReady).
 */

import { Suite } from "../../core/registry.mjs";
import { MODULE_ID, FEATURE_ID, SETTINGS } from "./const.mjs";
import { MapStore } from "./data.mjs";
import { MapStudio } from "./studio.mjs";
import * as Controller from "./controller.mjs";

function defaultLibrary() {
  return { schemaVersion: 1, maps: {}, activeMapId: null, rev: 0 };
}

function registerSettings() {
  // GM's authoritative library + draft (never rendered by players directly).
  game.settings.register(MODULE_ID, SETTINGS.maps, {
    scope: "world",
    config: false,
    type: Object,
    default: defaultLibrary()
  });

  // Player-visible snapshot of the active map (hidden elements stripped).
  game.settings.register(MODULE_ID, SETTINGS.published, {
    scope: "world",
    config: false,
    type: Object,
    default: null
  });

  // Per-client floating viewer geometry/state.
  game.settings.register(MODULE_ID, SETTINGS.viewer, {
    scope: "client",
    config: false,
    type: Object,
    default: {}
  });

  // Control Center → "Open Map Studio" button (GM only).
  game.settings.registerMenu(MODULE_ID, "mm.studio", {
    name: "GLMM.studio.menuName",
    label: "GLMM.studio.menuLabel",
    hint: "GLMM.studio.menuHint",
    icon: "fa-solid fa-pen-ruler",
    type: MapStudio,
    restricted: true
  });
}

function onInit() {
  Hooks.on("getSceneControlButtons", onGetSceneControlButtons);

  game.keybindings.register(MODULE_ID, "mm.toggleViewer", {
    name: "GLMM.keybind.toggleViewer",
    editable: [{ key: "KeyM", modifiers: ["Alt"] }],
    onDown: () => {
      if (game.user?.isGM || MapStore.activeMapId()) Controller.toggleViewer();
      return true;
    },
    restricted: false
  });
}

function onReady() {
  Controller.wire();
}

/** v13+ scene controls: add Minimap tools to the token group (the suite's
 *  established home for cross-feature toggles). */
function onGetSceneControlButtons(controls) {
  const group = controls.tokens ?? controls.notes ?? Object.values(controls)[0];
  if (!group?.tools) return;
  const order = Object.keys(group.tools).length;

  if (game.user?.isGM) {
    group.tools["glmm-studio"] = {
      name: "glmm-studio",
      title: "GLMM.control.studio",
      icon: "fa-solid fa-pen-ruler",
      order,
      button: true,
      onChange: () => Controller.openStudio()
    };
    group.tools["glmm-viewer"] = {
      name: "glmm-viewer",
      title: "GLMM.control.viewer",
      icon: "fa-solid fa-map-location-dot",
      order: order + 1,
      button: true,
      onChange: () => Controller.toggleViewer()
    };
  } else if (MapStore.activeMapId()) {
    group.tools["glmm-viewer"] = {
      name: "glmm-viewer",
      title: "GLMM.control.viewer",
      icon: "fa-solid fa-map-location-dot",
      order,
      button: true,
      onChange: () => Controller.toggleViewer()
    };
  }
}

Suite.register({
  id: FEATURE_ID,
  title: "GLMM.feature.title",
  hint: "GLMM.feature.hint",
  icon: "fa-solid fa-map-location-dot",
  settingPrefix: "mm.",
  system: null,
  requires: [],
  core: false,
  defaultEnabled: false,

  registerSettings,
  onInit,
  onReady,

  get api() { return Controller.api; }
});
