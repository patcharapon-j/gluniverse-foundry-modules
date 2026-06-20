/**
 * Promoted Clocks & Tracker sub-features.
 *
 * Trackers, Weather, Mission Support and Delving were previously buried inside
 * clocks-tracker's internal FEATURE_TREE. They are now first-class suite features
 * with their own enable/disable toggle and settings group in the Control Center,
 * gated on the core clocks-tracker engine via `requiresFeature`.
 *
 * Each one's enable state is *setting-backed*: it reads/writes the same world
 * setting (or moduleConfig blob entry) the engine already reacts to, so flipping
 * it in the Control Center fires the engine's existing onChange side-effects
 * (opening/closing HUDs, re-seating auras…) and takes effect live. The bridge in
 * ./features.js makes the engine's internal `Features.on("weather"|"support"|…)`
 * resolve to these suite toggles, so there is a single source of truth.
 */

import { Suite } from "../../core/registry.mjs";
import { SUITE_ID } from "../../core/const.mjs";
import { SETTINGS } from "./const.js";

const getSetting = (key, fallback) => {
  try {
    return game.settings.get(SUITE_ID, key);
  } catch {
    return fallback;
  }
};

/** Read/write an enable flag stored directly in a Boolean world setting. */
function settingBacked(key) {
  return {
    enableGet: () => !!getSetting(key, false),
    enableSet: async (on) => game.settings.set(SUITE_ID, key, !!on),
  };
}

/** Read/write an enable flag stored at a path inside the ct.moduleConfig blob. */
function blobBacked(path, dflt) {
  return {
    enableGet: () => {
      const blob = getSetting(SETTINGS.moduleConfig, {}) || {};
      return path in blob ? !!blob[path] : dflt;
    },
    enableSet: async (on) => {
      const blob = { ...(getSetting(SETTINGS.moduleConfig, {}) || {}) };
      blob[path] = !!on;
      await game.settings.set(SUITE_ID, SETTINGS.moduleConfig, blob);
    },
  };
}

/**
 * Register the promoted sub-features. Called explicitly from the clocks-tracker
 * adapter *after* the core feature registers, so the core appears first in the
 * Control Center with its children grouped immediately below it.
 */
export function registerSubFeatures() {
  Suite.register({
    id: "clocks-trackers",
    title: "GLS.feature.clocks-trackers.title",
    hint: "GLS.feature.clocks-trackers.hint",
    icon: "fa-solid fa-list-check",
    requiresFeature: "clocks-tracker",
    defaultEnabled: true,
    ...blobBacked("trackers", true),
  });

  Suite.register({
    id: "clocks-weather",
    title: "GLS.feature.clocks-weather.title",
    hint: "GLS.feature.clocks-weather.hint",
    icon: "fa-solid fa-cloud-bolt",
    requiresFeature: "clocks-tracker",
    defaultEnabled: false,
    ...settingBacked(SETTINGS.weatherEnabled),
  });

  Suite.register({
    id: "clocks-support",
    title: "GLS.feature.clocks-support.title",
    hint: "GLS.feature.clocks-support.hint",
    icon: "fa-solid fa-user-shield",
    requiresFeature: "clocks-tracker",
    defaultEnabled: false,
    ...settingBacked(SETTINGS.supportEnabled),
  });

  Suite.register({
    id: "clocks-delving",
    title: "GLS.feature.clocks-delving.title",
    hint: "GLS.feature.clocks-delving.hint",
    icon: "fa-solid fa-dungeon",
    requiresFeature: "clocks-tracker",
    defaultEnabled: false,
    ...settingBacked(SETTINGS.delvingEnabled),
  });
}
