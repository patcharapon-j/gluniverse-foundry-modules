import { SUITE_ID } from "../../core/const.mjs";
import { Suite } from "../../core/registry.mjs";
import { FEATURE_ID, PREFIX, SETTINGS, TIMING } from "./constants.mjs";
import { onInit, onReady, api } from "./main.mjs";

/**
 * Sounds are the GM's call (a table streaming its session may want silence
 * for everybody); how loud they are, and how long a hover waits before the
 * tooltip opens, are each person's own.
 */
function registerSettings() {
  game.settings.register(SUITE_ID, SETTINGS.sounds, {
    name: "GLHEX.settings.sounds.name",
    hint: "GLHEX.settings.sounds.hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });
  game.settings.register(SUITE_ID, SETTINGS.volume, {
    name: "GLHEX.settings.volume.name",
    hint: "GLHEX.settings.volume.hint",
    scope: "client",
    config: true,
    type: Number,
    range: { min: 0, max: 1, step: 0.05 },
    default: 0.5,
  });
  game.settings.register(SUITE_ID, SETTINGS.tooltipDelay, {
    name: "GLHEX.settings.tooltipDelay.name",
    hint: "GLHEX.settings.tooltipDelay.hint",
    scope: "client",
    config: true,
    type: Number,
    range: { min: 0, max: 2000, step: 50 },
    default: TIMING.tooltipDelay,
  });
}

Suite.register({
  id: FEATURE_ID,
  title: "GLS.feature.hexcrawl.title",
  hint: "GLS.feature.hexcrawl.hint",
  icon: "fa-solid fa-map-location-dot",
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
