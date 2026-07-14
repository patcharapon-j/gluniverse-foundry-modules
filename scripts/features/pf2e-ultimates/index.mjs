import { SUITE_ID } from "../../core/const.mjs";
import { Suite } from "../../core/registry.mjs";
import { SETTINGS } from "./constants.mjs";
import { onInit, onReady, api, refreshOverlay } from "./main.mjs";

function registerSettings() {
  game.settings.register(SUITE_ID, SETTINGS.displayMode, {
    name: "GLULT.Settings.DisplayMode.Name",
    hint: "GLULT.Settings.DisplayMode.Hint",
    scope: "world",
    config: true,
    type: String,
    choices: {
      icon: "GLULT.Settings.DisplayMode.Icon",
      overlay: "GLULT.Settings.DisplayMode.Overlay",
      both: "GLULT.Settings.DisplayMode.Both",
    },
    default: "icon",
    onChange: () => refreshOverlay(),
  });

  game.settings.register(SUITE_ID, SETTINGS.counterDefault, {
    name: "GLULT.Settings.CounterDefault.Name",
    hint: "GLULT.Settings.CounterDefault.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
    onChange: () => refreshOverlay(),
  });
}

Suite.register({
  id: "pf2e-ultimates",
  title: "GLS.feature.pf2e-ultimates.title",
  hint: "GLS.feature.pf2e-ultimates.hint",
  icon: "fa-solid fa-star",
  settingPrefix: "ult.",
  system: "pf2e",
  requires: [],
  core: false,
  defaultEnabled: false,

  registerSettings,
  onInit,
  onReady,
  api,
});

