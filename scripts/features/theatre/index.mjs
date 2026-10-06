import { SUITE_ID } from "../../core/const.mjs";
import { Suite } from "../../core/registry.mjs";
import { DEFAULT_FACE, DEFAULT_FRAMING, DEFAULT_MODE, DEFAULT_SHAKE, DEFAULT_STYLE, FACE_KEYS, FEATURE_ID, FRAMING_CHOICES, FRAMINGS, MODES, PADDING_MAX, PREFIX, SETTINGS, STYLES } from "./constants.mjs";
import { BACKDROP } from "./render/shot-renderer.mjs";
import { onInit, onReady, api, applyBackdropBlur, applyFace, applyFraming, applyShake } from "./main.mjs";

/**
 * Framing: the GM sets a default fill/fit and padding for everyone (world), and
 * each viewer may override both for their own display (client). The rest are
 * the GM's: the mode and transition a new Theatre scene starts with, the typeface and
 * camera shake every scene uses unless it picks its own, and whether a cut
 * leaves a line in chat. A scene can pick its own style and face, and every shot
 * can override style, face and shake again.
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
  game.settings.register(SUITE_ID, SETTINGS.defaultMode, {
    name: "GLTH.settings.defaultMode.name",
    hint: "GLTH.settings.defaultMode.hint",
    scope: "world",
    config: true,
    type: String,
    choices: Object.fromEntries(MODES.map((k) => [k, `GLTH.mode.${k}.name`])),
    default: DEFAULT_MODE,
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
    onChange: () => applyFace(),
  });
  game.settings.register(SUITE_ID, SETTINGS.defaultShake, {
    name: "GLTH.settings.defaultShake.name",
    hint: "GLTH.settings.defaultShake.hint",
    scope: "world",
    config: true,
    type: Number,
    range: { min: 0, max: 100, step: 5 },
    default: Math.round(DEFAULT_SHAKE * 100),
    onChange: () => applyShake(),
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
  game.settings.register(SUITE_ID, SETTINGS.backdropBlur, {
    name: "GLTH.settings.backdropBlur.name",
    hint: "GLTH.settings.backdropBlur.hint",
    scope: "world",
    config: true,
    type: Number,
    range: { min: 0, max: 100, step: 5 },
    default: Math.round(BACKDROP.blur * 100),
    onChange: () => applyBackdropBlur(),
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
