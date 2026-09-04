import { SUITE_ID } from "../../core/const.mjs";
import { Suite } from "../../core/registry.mjs";
import { MOTION_TIER_DEFAULT } from "../../core/theme.mjs";
import { DEFAULT_STYLE_COLORS } from "./data.mjs";
import { FEATURE_ID, PREFIX, SETTINGS } from "./constants.mjs";
import { api, onInit, onReady, reconfigure } from "./main.mjs";
import { AoeStyleDefaultsApp } from "./style-app.mjs";

function registerSettings() {
  game.settings.register(SUITE_ID, SETTINGS.motionTier, {
    name: "GLAOE.Settings.MotionTier.Name",
    hint: "GLAOE.Settings.MotionTier.Hint",
    scope: "client",
    config: true,
    type: String,
    choices: {
      default: "GLAOE.Settings.MotionTier.Default",
      reduced: "GLAOE.Settings.MotionTier.Reduced",
      none: "GLAOE.Settings.MotionTier.None",
    },
    default: MOTION_TIER_DEFAULT,
    onChange: reconfigure,
  });

  game.settings.register(SUITE_ID, SETTINGS.maxConcurrent, {
    name: "GLAOE.Settings.MaxConcurrent.Name",
    hint: "GLAOE.Settings.MaxConcurrent.Hint",
    scope: "client",
    config: true,
    type: Number,
    range: { min: 1, max: 64, step: 1 },
    default: 24,
    onChange: reconfigure,
  });

  game.settings.register(SUITE_ID, SETTINGS.styleDefaults, {
    name: "GLAOE.Settings.StyleDefaults.Name",
    hint: "GLAOE.Settings.StyleDefaults.Hint",
    scope: "world",
    config: false,
    type: Object,
    default: { ...DEFAULT_STYLE_COLORS },
    onChange: reconfigure,
  });

  game.settings.registerMenu(SUITE_ID, `${PREFIX}styleDefaultsMenu`, {
    name: "GLAOE.Settings.StyleDefaults.Name",
    label: "GLAOE.Settings.StyleDefaults.Label",
    hint: "GLAOE.Settings.StyleDefaults.Hint",
    icon: "fa-solid fa-palette",
    type: AoeStyleDefaultsApp,
    restricted: true,
  });
}

Suite.register({
  id: FEATURE_ID,
  title: "GLS.feature.pf2e-aoe.title",
  hint: "GLS.feature.pf2e-aoe.hint",
  icon: "fa-solid fa-bullseye",
  settingPrefix: PREFIX,
  system: "pf2e",
  minimumGeneration: 14,
  requires: [],
  core: false,
  defaultEnabled: false,
  registerSettings,
  onInit,
  onReady,
  api,
});
