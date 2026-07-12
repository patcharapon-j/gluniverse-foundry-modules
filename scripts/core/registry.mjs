/**
 * GLUniverse Suite — feature registry.
 *
 * Each feature provides a definition object (see docs/FEATURE_CONTRACT.md):
 *   {
 *     id:        string            unique short id, also its folder name
 *     title:     string            i18n key or literal for the config UI
 *     hint:      string            i18n key or literal
 *     icon:      string            Font Awesome class
 *     settingPrefix: string|string[]   the setting/menu key prefix(es) this
 *                                  feature owns (e.g. "init." or "ct.weather").
 *                                  The catalog uses these to route every setting
 *                                  into this feature's Control Center section and
 *                                  hide it from Foundry's native sheet, so a
 *                                  feature's config is always attributed to it.
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
const _availabilityStack = new Set();

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

  /** Validate the completed roster once before lifecycle execution. */
  validate() {
    const known = new Set(_features.map((feature) => feature.id));
    const visiting = new Set();
    const visited = new Set();
    const visit = (feature) => {
      if (visited.has(feature.id)) return;
      if (visiting.has(feature.id)) throw new Error(`Cyclic feature dependency at "${feature.id}".`);
      visiting.add(feature.id);
      for (const id of this._list(feature.requiresFeature)) {
        if (!known.has(id)) throw new Error(`Feature "${feature.id}" requires unknown feature "${id}".`);
        visit(this.get(id));
      }
      visiting.delete(feature.id);
      visited.add(feature.id);
    };
    for (const feature of _features) visit(feature);
    return true;
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
    if (_availabilityStack.has(def.id)) {
      warn(`Cyclic feature dependency detected at "${def.id}".`);
      return false;
    }
    _availabilityStack.add(def.id);
    try {
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
    } finally {
      _availabilityStack.delete(def.id);
    }
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
        const started = performance.now();
        await fn.call(def);
        const elapsed = performance.now() - started;
        if (elapsed > 500) warn(`${phase} for "${def.id}" took ${Math.round(elapsed)}ms.`);
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
