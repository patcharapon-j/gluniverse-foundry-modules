import { SUITE_ID } from "../../core/const.mjs";
import { Suite } from "../../core/registry.mjs";
import { MOTION_TIER_DEFAULT } from "../../core/theme.mjs";
import { FEATURE_ID, PREFIX, SETTINGS } from "./constants.mjs";
import { api, onInit, onReady, reconfigure } from "./main.mjs";
import { AoeProfilesApp } from "./profile-app.mjs";

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
    default: {},
    onChange: reconfigure,
  });

  game.settings.register(SUITE_ID, SETTINGS.intensity, {
    name: "GLAOE.Settings.Intensity.Name",
    hint: "GLAOE.Settings.Intensity.Hint",
    scope: "world",
    config: true,
    type: String,
    choices: {
      subtle: "GLAOE.Intensity.subtle",
      balanced: "GLAOE.Intensity.balanced",
      cinematic: "GLAOE.Intensity.cinematic",
    },
    default: "balanced",
    onChange: reconfigure,
  });

  game.settings.register(SUITE_ID, SETTINGS.quality, {
    name: "GLAOE.Settings.Quality.Name",
    hint: "GLAOE.Settings.Quality.Hint",
    scope: "client",
    config: true,
    type: String,
    choices: {
      auto: "GLAOE.Quality.auto",
      low: "GLAOE.Quality.low",
      medium: "GLAOE.Quality.medium",
      high: "GLAOE.Quality.high",
    },
    default: "auto",
    onChange: reconfigure,
  });

  /* Schema-v2 development data is registered before the renderer cutover so
     worlds can exercise pure classification/migration tooling without changing
     what players see on the canvas. */
  game.settings.register(SUITE_ID, SETTINGS.schemaVersion, {
    scope: "world",
    config: false,
    type: Number,
    default: 0,
  });

  game.settings.register(SUITE_ID, SETTINGS.profiles, {
    scope: "world",
    config: false,
    type: Object,
    default: { schema: 1, profiles: [] },
    onChange: reconfigure,
  });

  game.settings.registerMenu(SUITE_ID, `${PREFIX}profilesMenu`, {
    name: "GLAOE.Settings.Profiles.Name",
    label: "GLAOE.Settings.Profiles.Label",
    hint: "GLAOE.Settings.Profiles.Hint",
    icon: "fa-solid fa-sparkles",
    type: AoeProfilesApp,
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
