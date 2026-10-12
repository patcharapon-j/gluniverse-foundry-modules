/**
 * Stage — settings. All registered unconditionally (the feature contract), all
 * under the suite id with the `stage.` prefix.
 *
 * Every stored value is read back through a normalizer in model.mjs; nothing
 * outside store.mjs reads these keys.
 */

import { SUITE_ID } from "../../core/const.mjs";

export const KEY = Object.freeze({
  cast: "stage.cast",
  state: "stage.state",
  layout: "stage.layout",
  comms: "stage.comms",
  commsLayout: "stage.commsLayout",
  quality: "stage.quality",
  breath: "stage.breath",
  migrated: "stage.migrated",
  // The old Stage's stored values, registered only so migration can read them.
  legacyLibrary: "stage.actorLibrary",
  legacyComms: "stage.commsState",
  legacyState: "stage.stageState",
  legacyCommsTheme: "stage.commsTheme",
  legacyCommsEdge: "stage.commsEdge",
  legacyCommsVAlign: "stage.commsVAlign",
  legacyCommsWidth: "stage.commsFrameWidth",
  legacyCommsInset: "stage.commsEdgeOffset",
  legacyCommsTop: "stage.commsTopOffset",
});

/** What a client does with the stage. */
export const QUALITY = Object.freeze(["full", "lite"]);

const listeners = new Set();

/** Subscribe to stored changes: fn(kind) with kind one of cast|state|layout|comms|commsLayout|quality|breath. */
export function onStageSetting(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(kind) {
  for (const fn of listeners) {
    try { fn(kind); } catch (e) { console.error(`${SUITE_ID} | stage listener`, e); }
  }
}

export function registerSettings() {
  const hidden = (key, type, def, kind) => game.settings.register(SUITE_ID, key, {
    scope: "world", config: false, type, default: def,
    onChange: kind ? () => emit(kind) : undefined,
  });
  hidden(KEY.cast, Array, [], "cast");
  hidden(KEY.state, Object, {}, "state");
  hidden(KEY.layout, Object, {}, "layout");
  hidden(KEY.comms, Object, {}, "comms");
  hidden(KEY.commsLayout, Object, {}, "commsLayout");
  hidden(KEY.migrated, Number, 0, null);
  hidden(KEY.legacyLibrary, Array, [], null);
  hidden(KEY.legacyComms, Object, {}, null);
  hidden(KEY.legacyState, Object, {}, null);
  hidden(KEY.legacyCommsTheme, String, "", null);
  hidden(KEY.legacyCommsEdge, String, "", null);
  hidden(KEY.legacyCommsVAlign, String, "", null);
  hidden(KEY.legacyCommsWidth, Number, 0, null);
  hidden(KEY.legacyCommsInset, Number, 0, null);
  hidden(KEY.legacyCommsTop, Number, 0, null);

  game.settings.register(SUITE_ID, KEY.quality, {
    name: "GLSTAGE.settings.quality.name",
    hint: "GLSTAGE.settings.quality.hint",
    scope: "client",
    config: true,
    type: String,
    choices: {
      full: "GLSTAGE.settings.quality.full",
      lite: "GLSTAGE.settings.quality.lite",
    },
    default: "full",
    onChange: () => emit("quality"),
  });

  game.settings.register(SUITE_ID, KEY.breath, {
    name: "GLSTAGE.settings.breath.name",
    hint: "GLSTAGE.settings.breath.hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
    onChange: () => emit("breath"),
  });

  game.settings.registerMenu(SUITE_ID, "stage.director", {
    name: "GLSTAGE.settings.director.name",
    label: "GLSTAGE.settings.director.label",
    hint: "GLSTAGE.settings.director.hint",
    icon: "fa-solid fa-theater-masks",
    type: DirectorMenu(),
    restricted: true,
  });
}

/**
 * The settings-menu entry opens the Director. Built lazily: registerMenu needs
 * a real ApplicationV2 subclass, and the app module touches `foundry` at
 * module scope.
 */
let _menu = null;
function DirectorMenu() {
  if (_menu) return _menu;
  const { ApplicationV2 } = foundry.applications.api;
  _menu = class StageDirectorMenu extends ApplicationV2 {
    async render() {
      const { openDirector } = await import("./apps/director-app.mjs");
      openDirector();
      return this;
    }
  };
  return _menu;
}

export const get = (key) => game.settings.get(SUITE_ID, key);
export const set = (key, value) => game.settings.set(SUITE_ID, key, value);
