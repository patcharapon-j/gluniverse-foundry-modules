import { SUITE_ID } from "../../core/const.mjs";
import { Suite } from "../../core/registry.mjs";
import { FEATURE_ID, PREFIX, SETTINGS } from "./constants.mjs";
import { api, onInit, onReady, reconfigure } from "./main.mjs";
import { rulesAppClass } from "./looks-app.mjs";

function registerSettings() {
  const world = (key, name, def = true) => game.settings.register(SUITE_ID, key, {
    name: `GLFX.Settings.${name}.Name`, hint: `GLFX.Settings.${name}.Hint`,
    scope: "world", config: true, type: Boolean, default: def,
  });
  world(SETTINGS.spells, "Spells");
  world(SETTINGS.strikes, "Strikes");
  world(SETTINGS.actions, "Actions");
  world(SETTINGS.conditions, "Conditions");
  world(SETTINGS.standDown, "StandDown");

  game.settings.register(SUITE_ID, SETTINGS.floor, {
    name: "GLFX.Settings.Floor.Name", hint: "GLFX.Settings.Floor.Hint",
    scope: "client", config: true, type: String,
    choices: { auto: "GLFX.Floor.auto", dark: "GLFX.Floor.dark", bright: "GLFX.Floor.bright" },
    default: "auto", onChange: reconfigure,
  });
  game.settings.register(SUITE_ID, SETTINGS.impactFrames, {
    name: "GLFX.Settings.ImpactFrames.Name", hint: "GLFX.Settings.ImpactFrames.Hint",
    scope: "client", config: true, type: Boolean, default: true,
  });
  game.settings.register(SUITE_ID, SETTINGS.shake, {
    name: "GLFX.Settings.Shake.Name", hint: "GLFX.Settings.Shake.Hint",
    scope: "client", config: true, type: Boolean, default: true,
  });
  game.settings.register(SUITE_ID, SETTINGS.maxConcurrent, {
    name: "GLFX.Settings.MaxConcurrent.Name", hint: "GLFX.Settings.MaxConcurrent.Hint",
    scope: "client", config: true, type: Number, range: { min: 1, max: 32, step: 1 },
    default: 12, onChange: reconfigure,
  });
  game.settings.register(SUITE_ID, SETTINGS.rules, {
    scope: "world", config: false, type: Object, default: {},
  });
  game.settings.registerMenu(SUITE_ID, SETTINGS.rulesMenu, {
    name: "GLFX.Settings.Rules.Name",
    label: "GLFX.Settings.Rules.Label",
    hint: "GLFX.Settings.Rules.Hint",
    icon: "fa-solid fa-wand-magic-sparkles",
    type: rulesAppClass(),
    restricted: true,
  });
}

Suite.register({
  id: FEATURE_ID,
  title: "GLS.feature.pf2e-fx.title",
  hint: "GLS.feature.pf2e-fx.hint",
  icon: "fa-solid fa-wand-magic-sparkles",
  settingPrefix: PREFIX,
  system: "pf2e",
  minimumGeneration: 13,
  requires: [],
  core: false,
  defaultEnabled: false,
  registerSettings,
  onInit,
  onReady,
  api,
});
