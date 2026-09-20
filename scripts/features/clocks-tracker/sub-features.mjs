/**
 * Promoted Clocks & Tracker sub-features.
 *
 * Trackers, Weather and Delving were previously buried inside
 * clocks-tracker's internal FEATURE_TREE. They are now first-class suite features
 * with their own enable/disable toggle and settings group in the Control Center.
 *
 * Resource Trackers stands ALONE: the dock, its store and the PF2e sheet tab
 * import nothing from the calendar, the time HUD or TimeEngine, so a table that
 * wants GM clocks, points and pools without an in-game clock runs it with the
 * engine switched off. It carries its own `onInit`/`onReady` for that — the
 * registry only runs a feature's own lifecycle, so a sub-feature whose wiring
 * lives in its parent's is a feature that cannot be enabled by itself.
 *
 * Weather and Delving do NOT stand alone and keep `requiresFeature`: a delve is
 * drawn inside the time HUD (`GlctHud._paintDelving`) and reads day and month
 * names off `TimeEngine.calendar`, and a weather walk is stepped by the engine's
 * `updateWorldTime` hook. Dropping their gate would leave both enabled in the
 * Control Center with nothing drawing and nothing walking.
 *
 * This module must stay importable under plain Node: the check tools load it to
 * drive the registry, and `./module.js` reaches `foundry.applications.api` at
 * module scope through the HUDs. So Resource Trackers' lifecycle is INJECTED by
 * the adapter (which imports module.js anyway) rather than imported here.
 *
 * Each one's enable state is *setting-backed*: it reads/writes the same world
 * setting (or moduleConfig blob entry) the engine already reacts to, so flipping
 * it in the Control Center fires the engine's existing onChange side-effects
 * (opening/closing HUDs, re-seating auras…) and takes effect live. The bridge in
 * ./features.js makes the engine's internal `Features.on("weather"|"delving"|…)`
 * resolve to these suite toggles, so there is a single source of truth.
 */

import { Suite } from "../../core/registry.mjs";
import { SUITE_ID } from "../../core/const.mjs";
import { SETTINGS } from "./const.js";
import { warn } from "../../core/const.mjs";

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
export function registerSubFeatures({ onTrackersInit, onTrackersReady } = {}) {
  // A missing lifecycle is a feature that registers, shows a live toggle and
  // then does nothing at all, so it is reported rather than silently accepted.
  if (typeof onTrackersInit !== "function" || typeof onTrackersReady !== "function") {
    warn("registerSubFeatures: Resource Trackers was given no lifecycle; its dock and sheet tab will not run.");
  }

  Suite.register({
    id: "clocks-trackers",
    title: "GLS.feature.clocks-trackers.title",
    hint: "GLS.feature.clocks-trackers.hint",
    icon: "fa-solid fa-list-check",
    settingPrefix: ["ct.tracker", "ct.sheetTrackers"],
    // Deliberately NO requiresFeature — see the header.
    defaultEnabled: true,

    onInit() {
      this.api = onTrackersInit?.() ?? null;
    },

    async onReady() {
      await onTrackersReady?.();
    },

    // Set during onInit. Declared here for documentation.
    api: null,

    ...blobBacked("trackers", true),
  });

  Suite.register({
    id: "clocks-weather",
    title: "GLS.feature.clocks-weather.title",
    hint: "GLS.feature.clocks-weather.hint",
    icon: "fa-solid fa-cloud-bolt",
    settingPrefix: "ct.weather",
    requiresFeature: "clocks-tracker",
    defaultEnabled: false,
    ...settingBacked(SETTINGS.weatherEnabled),
  });

  Suite.register({
    id: "clocks-delving",
    title: "GLS.feature.clocks-delving.title",
    hint: "GLS.feature.clocks-delving.hint",
    icon: "fa-solid fa-dungeon",
    settingPrefix: "ct.delving",
    requiresFeature: "clocks-tracker",
    defaultEnabled: false,
    ...settingBacked(SETTINGS.delvingEnabled),
  });
}
