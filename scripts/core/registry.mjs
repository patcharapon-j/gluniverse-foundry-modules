/**
 * GLUniverse Suite — feature registry.
 *
 * Each feature provides a definition object (see docs/FEATURE_CONTRACT.md):
 *   {
 *     id:        string            unique short id, also its folder name
 *     title:     string            i18n key or literal for the config UI
 *     hint:      string            i18n key or literal
 *     icon:      string            Font Awesome class
 *     system:    null | string | string[]   required game system id(s)
 *     requires:  string[]          required *other* active module ids
 *     core:      boolean           true → cannot be disabled (base experience)
 *     defaultEnabled: boolean
 *     registerSettings()           always run at init (so toggles/menus exist)
 *     onInit()                     run at init *only when enabled & available*
 *     onReady()                    run at ready *only when enabled & available*
 *   }
 */

import { SUITE_ID, SETTING_MODULE_CONFIG, warn, err } from "./const.mjs";

const _features = [];

export const Suite = {
  /** Register a feature definition. Order here drives UI order. */
  register(def) {
    if (!def?.id) return warn("Ignoring feature with no id", def);
    if (_features.some((f) => f.id === def.id)) return warn(`Duplicate feature id: ${def.id}`);
    _features.push(def);
    return def;
  },

  all() {
    return _features.slice();
  },

  get(id) {
    return _features.find((f) => f.id === id) ?? null;
  },

  /** A feature is *available* when its required system + modules are present. */
  available(def) {
    if (typeof def === "string") def = this.get(def);
    if (!def) return false;
    if (def.system) {
      const need = Array.isArray(def.system) ? def.system : [def.system];
      if (!need.includes(game.system?.id)) return false;
    }
    for (const modId of def.requires ?? []) {
      if (!game.modules.get(modId)?.active) return false;
    }
    return true;
  },

  /** Reason a feature is unavailable (for the config UI), or null. */
  unavailableReason(def) {
    if (typeof def === "string") def = this.get(def);
    if (!def) return "Unknown feature";
    if (def.system) {
      const need = Array.isArray(def.system) ? def.system : [def.system];
      if (!need.includes(game.system?.id)) return `Requires system: ${need.join(" / ")}`;
    }
    for (const modId of def.requires ?? []) {
      if (!game.modules.get(modId)?.active) return `Requires module: ${modId}`;
    }
    return null;
  },

  /** Raw stored toggle (ignores availability), falling back to default. */
  _stored(id) {
    const def = this.get(id);
    if (!def) return false;
    if (def.core) return true;
    let blob = {};
    try {
      blob = game.settings.get(SUITE_ID, SETTING_MODULE_CONFIG) ?? {};
    } catch {
      /* settings not ready */
    }
    return id in blob ? !!blob[id] : !!def.defaultEnabled;
  },

  /** True when the feature should actually run (enabled AND available). */
  enabled(id) {
    const def = this.get(id);
    if (!def) return false;
    if (!this.available(def)) return false;
    return def.core || this._stored(id);
  },

  /** Persist a toggle into the master blob. */
  async setEnabled(id, on) {
    const def = this.get(id);
    if (!def || def.core) return;
    const blob = { ...(game.settings.get(SUITE_ID, SETTING_MODULE_CONFIG) ?? {}) };
    blob[id] = !!on;
    await game.settings.set(SUITE_ID, SETTING_MODULE_CONFIG, blob);
  },

  /** Run a lifecycle phase ("onInit" | "onReady") for every enabled feature. */
  async runPhase(phase) {
    for (const def of _features) {
      if (!this.enabled(def.id)) continue;
      const fn = def[phase];
      if (typeof fn !== "function") continue;
      try {
        await fn.call(def);
      } catch (e) {
        err(`Feature "${def.id}" failed during ${phase}:`, e);
      }
    }
  },

  /** Always-run settings registration (so toggles/menus exist even when off). */
  registerAllSettings() {
    for (const def of _features) {
      if (typeof def.registerSettings !== "function") continue;
      try {
        def.registerSettings.call(def);
      } catch (e) {
        err(`Feature "${def.id}" failed to register settings:`, e);
      }
    }
  },
};

/** Convenience global mirror so feature code can gate on `Features.on(id)`. */
export const Features = {
  on: (id) => Suite.enabled(id),
};
