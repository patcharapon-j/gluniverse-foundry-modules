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

  /** Normalize a field that may be a string or string[] into an array. */
  _list(v) {
    return v == null ? [] : Array.isArray(v) ? v : [v];
  },

  /** A feature is *available* when its required system + modules + sibling
   *  features are present. `requiresFeature` lets a promoted sub-feature gate on
   *  its parent (e.g. weather requires the clocks-tracker engine). */
  available(def) {
    if (typeof def === "string") def = this.get(def);
    if (!def) return false;
    if (def.system) {
      const need = this._list(def.system);
      if (!need.includes(game.system?.id)) return false;
    }
    for (const modId of def.requires ?? []) {
      if (!game.modules.get(modId)?.active) return false;
    }
    for (const featId of this._list(def.requiresFeature)) {
      if (!this.enabled(featId)) return false;
    }
    return true;
  },

  /** Reason a feature is unavailable (for the config UI), or null. */
  unavailableReason(def) {
    if (typeof def === "string") def = this.get(def);
    if (!def) return game.i18n.localize("GLS.config.lock.unknown");
    if (def.system) {
      const need = this._list(def.system);
      if (!need.includes(game.system?.id)) return game.i18n.format("GLS.config.lock.system", { systems: need.join(" / ") });
    }
    for (const modId of def.requires ?? []) {
      if (!game.modules.get(modId)?.active) return game.i18n.format("GLS.config.lock.module", { module: modId });
    }
    for (const featId of this._list(def.requiresFeature)) {
      if (!this.enabled(featId)) {
        const parent = this.get(featId);
        const label = parent ? game.i18n.localize(parent.title) : featId;
        return game.i18n.format("GLS.config.lock.feature", { feature: label });
      }
    }
    return null;
  },

  /** Raw stored toggle (ignores availability), falling back to default.
   *  A feature may supply `enableGet()` to back its toggle on an existing world
   *  setting (used by the promoted clocks-tracker sub-features) instead of the
   *  shared moduleConfig blob. */
  _stored(id) {
    const def = this.get(id);
    if (!def) return false;
    if (def.core) return true;
    if (typeof def.enableGet === "function") {
      try {
        return !!def.enableGet();
      } catch {
        return !!def.defaultEnabled;
      }
    }
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

  /** Persist a toggle. Setting-backed features (enableSet) write through to
   *  their world setting so its onChange side-effects still fire; the rest write
   *  the shared moduleConfig blob. */
  async setEnabled(id, on) {
    const def = this.get(id);
    if (!def || def.core) return;
    if (typeof def.enableSet === "function") {
      await def.enableSet(!!on);
      return;
    }
    const blob = { ...(game.settings.get(SUITE_ID, SETTING_MODULE_CONFIG) ?? {}) };
    blob[id] = !!on;
    await game.settings.set(SUITE_ID, SETTING_MODULE_CONFIG, blob);
  },

  /** True when a feature's enable toggle applies live (no reload needed). The
   *  promoted clocks-tracker sub-features run their own onChange side-effects, so
   *  flipping them takes effect immediately. */
  appliesLive(id) {
    const def = this.get(id);
    return !!def && typeof def.enableSet === "function";
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
