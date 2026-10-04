import { SUITE_ID } from "../../core/const.mjs";
import { Suite } from "../../core/registry.mjs";
import { DEFAULT_FACE, DEFAULT_STYLE, FACE_KEYS, FEATURE_ID, PREFIX, SETTINGS, STYLES } from "./constants.mjs";
import { onInit, onReady, api } from "./main.mjs";

/**
 * All three are the GM's: what a new Theatre scene starts with, and whether a
 * cut leaves a line in chat. Every scene can override style and face in its own
 * config, and every shot can override those again.
 */
function registerSettings() {
  game.settings.register(SUITE_ID, SETTINGS.chatOnCut, {
    name: "GLTH.settings.chatOnCut.name",
    hint: "GLTH.settings.chatOnCut.hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
  });
  game.settings.register(SUITE_ID, SETTINGS.defaultStyle, {
    name: "GLTH.settings.defaultStyle.name",
    hint: "GLTH.settings.defaultStyle.hint",
    scope: "world",
    config: true,
    type: String,
    choices: Object.fromEntries(STYLES.map((k) => [k, `GLTH.style.${k}.name`])),
    default: DEFAULT_STYLE,
  });
  game.settings.register(SUITE_ID, SETTINGS.defaultFace, {
    name: "GLTH.settings.defaultFace.name",
    hint: "GLTH.settings.defaultFace.hint",
    scope: "world",
    config: true,
    type: String,
    choices: Object.fromEntries(FACE_KEYS.map((k) => [k, `GLTH.face.${k}`])),
    default: DEFAULT_FACE,
  });
}

Suite.register({
  id: FEATURE_ID,
  title: "GLS.feature.theatre.title",
  hint: "GLS.feature.theatre.hint",
  icon: "fa-solid fa-clapperboard",
  settingPrefix: PREFIX,
  system: null,
  requires: [],
  core: false,
  defaultEnabled: false,

  registerSettings,
  onInit,
  onReady,
  api,
});
