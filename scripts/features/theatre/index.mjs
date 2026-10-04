import { SUITE_ID } from "../../core/const.mjs";
import { Suite } from "../../core/registry.mjs";
import { DEFAULT_FACE, DEFAULT_FRAMING, DEFAULT_STYLE, FACE_KEYS, FEATURE_ID, FRAMING_CHOICES, FRAMINGS, PADDING_MAX, PREFIX, SETTINGS, STYLES } from "./constants.mjs";
import { onInit, onReady, api, applyFraming } from "./main.mjs";

/**
 * Framing: the GM sets a default fill/fit and padding for everyone (world), and
 * each viewer may override both for their own display (client). The rest are
 * the GM's: what a new Theatre scene starts with, and whether a cut leaves a line in chat. Every scene can override style and face in its own
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
  // How the 16:9 frame meets a display: the GM's default for everyone…
  game.settings.register(SUITE_ID, SETTINGS.defaultFraming, {
    name: "GLTH.settings.defaultFraming.name",
    hint: "GLTH.settings.defaultFraming.hint",
    scope: "world",
    config: true,
    type: String,
    choices: Object.fromEntries(FRAMINGS.map((k) => [k, `GLTH.framing.${k}`])),
    default: DEFAULT_FRAMING,
    onChange: () => applyFraming(),
  });
  game.settings.register(SUITE_ID, SETTINGS.defaultPadding, {
    name: "GLTH.settings.defaultPadding.name",
    hint: "GLTH.settings.defaultPadding.hint",
    scope: "world",
    config: true,
    type: Number,
    range: { min: 0, max: PADDING_MAX, step: 1 },
    default: 0,
    onChange: () => applyFraming(),
  });
  // …and each viewer's own override for THIS display.
  game.settings.register(SUITE_ID, SETTINGS.framing, {
    name: "GLTH.settings.framing.name",
    hint: "GLTH.settings.framing.hint",
    scope: "client",
    config: true,
    type: String,
    choices: Object.fromEntries(FRAMING_CHOICES.map((k) => [k, `GLTH.framing.${k}`])),
    default: "default",
    onChange: () => applyFraming(),
  });
  game.settings.register(SUITE_ID, SETTINGS.padding, {
    name: "GLTH.settings.padding.name",
    hint: "GLTH.settings.padding.hint",
    scope: "client",
    config: true,
    type: Number,
    range: { min: 0, max: PADDING_MAX, step: 1 },
    default: 0,
    onChange: () => applyFraming(),
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
