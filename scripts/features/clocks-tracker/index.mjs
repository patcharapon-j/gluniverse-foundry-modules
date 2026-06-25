/**
 * GLUniverse Suite — Clocks & Tracker feature adapter.
 *
 * The base / core feature of the suite (always enabled, system-agnostic). It
 * keeps its own internal feature-toggle tree (see ./features.js, backed by the
 * `ct.moduleConfig` world setting and the Module Configuration editor) which
 * governs its sub-features (timeHud / trackers / weather / support / delving).
 * That internal system is intact; this adapter only wires the suite lifecycle.
 *
 * The ported entry module (./module.js) exposes:
 *   - registerSettings()  — register every setting + menu (runs unconditionally)
 *   - onInit()            — wire styles, sheet tab, calendar, keybindings, hooks
 *   - onReady()           — open HUDs, register GM persistence handlers
 *   - getApi()            — the public API object for macros / other modules
 */

import { Suite } from "../../core/registry.mjs";
import { registerSettings, onInit, onReady, getApi } from "./module.js";
import { registerSubFeatures } from "./sub-features.mjs";

const OLD_ID = "gluniverse-clocks-and-tracker";

/**
 * Old standalone setting key → new suite key (already `ct.`-prefixed). The old
 * module registered every key unprefixed under its own id; the suite registers
 * them prefixed under `gluniverse-foundry-modules`. NOTE: the old `moduleConfig` (this
 * feature's internal feature-tree blob) maps to `ct.moduleConfig` — distinct
 * from the suite core's own `moduleConfig`.
 */
const LEGACY_SETTINGS = {
  moduleConfig: "ct.moduleConfig",
  calendarId: "ct.calendarId",
  calendarConfig: "ct.calendarConfig",
  events: "ct.events",
  shiftNames: "ct.shiftNames",
  shiftLevelMode: "ct.shiftLevelMode",
  mission: "ct.mission",
  hudCollapsed: "ct.hudCollapsed",
  hudPosition: "ct.hudPosition",
  hudGlitch: "ct.hudGlitch",
  sceneTint: "ct.sceneTint",
  yearLabel: "ct.yearLabel",
  trackers: "ct.trackers",
  trackerHudPosition: "ct.trackerHudPosition",
  trackerHudHidden: "ct.trackerHudHidden",
  trackerHudCompact: "ct.trackerHudCompact",
  sheetTrackersEnabled: "ct.sheetTrackersEnabled",
  weatherEnabled: "ct.weatherEnabled",
  weather: "ct.weather",
  weatherCadenceMode: "ct.weatherCadenceMode",
  weatherCadencePeriod: "ct.weatherCadencePeriod",
  weatherPlayerFlowerVisible: "ct.weatherPlayerFlowerVisible",
  weatherShowDice: "ct.weatherShowDice",
  weatherCardVisibility: "ct.weatherCardVisibility",
  weatherHudPosition: "ct.weatherHudPosition",
  weatherHudHidden: "ct.weatherHudHidden",
  supportEnabled: "ct.supportEnabled",
  supports: "ct.supports",
  supportHudVisibleToPlayers: "ct.supportHudVisibleToPlayers",
  supportHudPosition: "ct.supportHudPosition",
  supportHudHidden: "ct.supportHudHidden",
  supportPassiveTokenIcon: "ct.supportPassiveTokenIcon",
  delvingEnabled: "ct.delvingEnabled",
  delving: "ct.delving",
};

Suite.register({
  id: "clocks-tracker",
  title: "GLS.feature.clocks-tracker.title",
  hint: "GLS.feature.clocks-tracker.hint",
  icon: "fa-solid fa-hourglass-half",
  // Engine catch-all prefix; the promoted sub-features below declare the more
  // specific ct.weather/ct.support/ct.delving/ct.tracker prefixes and claim
  // those keys first (catalog routing resolves longest prefix first).
  settingPrefix: "ct.",
  system: null,
  requires: [],
  core: true,
  defaultEnabled: true,

  registerSettings() {
    registerSettings();
  },

  onInit() {
    // Publish the public API on the feature definition; the registry exposes it
    // at game.modules.get(SUITE_ID).api.features["clocks-tracker"].
    this.api = onInit();
  },

  async onReady() {
    await onReady();
  },

  legacy: {
    id: OLD_ID,
    settings: LEGACY_SETTINGS,
    /**
     * Move per-PC private trackers off the old flag scope. They lived at
     * `actor.flags[OLD_ID].trackers`; they now live at
     * `actor.flags[gluniverse-foundry-modules].ct.trackers`. Best-effort & idempotent:
     * only copies when the new location is empty and the old one has data.
     */
    async migrate({ SUITE_ID }) {
      const actors = game.actors?.contents ?? [];
      for (const actor of actors) {
        try {
          const old = actor.getFlag(OLD_ID, "trackers");
          if (!Array.isArray(old) || !old.length) continue;
          const current = actor.getFlag(SUITE_ID, "ct.trackers");
          if (Array.isArray(current) && current.length) continue; // already migrated
          await actor.setFlag(SUITE_ID, "ct.trackers", old);
        } catch {
          /* best-effort per actor */
        }
      }
    },
  },

  // Set during onInit (see above). Declared here for documentation.
  api: null,
});

// Promote the engine's sub-features to first-class suite features, registered
// *after* the core above so they group beneath it in the Control Center.
registerSubFeatures();
