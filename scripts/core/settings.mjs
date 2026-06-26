/**
 * GLUniverse Suite — core settings + the unified "Feature Manager" menu.
 */

import { SUITE_ID, SETTING_MODULE_CONFIG, SETTING_MIGRATION, SETTING_UI_SCALE } from "./const.mjs";
import { Suite } from "./registry.mjs";
import { SuiteConfigApp } from "./suite-config-app.mjs";
import { clamp } from "./util.mjs";

/** Suite-wide interface-scale bounds (per-client preference). */
export const UI_SCALE_MIN = 0.6;
export const UI_SCALE_MAX = 1.6;

/**
 * Push the current (or supplied) interface scale onto the document root as the
 * `--gl-ui-scale` custom property. styles/gl-tokens.css zooms every suite UI
 * with it, and the Initiative overlay reads it for its own transform-scale. It's
 * a per-client preference, so this only ever affects the local screen.
 */
export function applyUiScale(value) {
  let v = Number(value);
  if (!Number.isFinite(v)) {
    try {
      v = Number(game.settings.get(SUITE_ID, SETTING_UI_SCALE));
    } catch {
      v = 1;
    }
  }
  v = clamp(Number.isFinite(v) ? v : 1, UI_SCALE_MIN, UI_SCALE_MAX);
  document.documentElement?.style.setProperty("--gl-ui-scale", String(v));
}

export function registerCoreSettings() {
  // Master enable/disable blob, edited via the Feature Manager menu.
  game.settings.register(SUITE_ID, SETTING_MODULE_CONFIG, {
    scope: "world",
    config: false,
    type: Object,
    default: {},
  });

  // Tracks which one-time data migrations have run.
  game.settings.register(SUITE_ID, SETTING_MIGRATION, {
    scope: "world",
    config: false,
    type: Object,
    default: {},
  });

  // Suite-wide interface scale — a per-client preference every user (GM or
  // player) can set to size every UI the suite injects. Surfaced as a pinned
  // section in the Control Center; applied live via `--gl-ui-scale`.
  game.settings.register(SUITE_ID, SETTING_UI_SCALE, {
    name: "GLS.config.uiScale.name",
    hint: "GLS.config.uiScale.hint",
    scope: "client",
    config: true,
    type: Number,
    range: { min: UI_SCALE_MIN, max: UI_SCALE_MAX, step: 0.05 },
    default: 1,
    onChange: (v) => applyUiScale(v),
  });

  // The premium etched-glass Control Center. Unrestricted so players can open it
  // to tune their own per-client preferences; it renders a focused, read-only
  // view for non-GMs (no feature toggles, no GM editors — see suite-config-app).
  game.settings.registerMenu(SUITE_ID, "featureManager", {
    name: "GLS.config.menu.name",
    label: "GLS.config.menu.label",
    hint: "GLS.config.menu.hint",
    icon: "fa-solid fa-sliders",
    type: SuiteConfigApp,
    restricted: false,
  });
}
