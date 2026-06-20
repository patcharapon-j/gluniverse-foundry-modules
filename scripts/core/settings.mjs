/**
 * GLUniverse Suite — core settings + the unified "Feature Manager" menu.
 */

import { SUITE_ID, SETTING_MODULE_CONFIG, SETTING_MIGRATION } from "./const.mjs";
import { Suite } from "./registry.mjs";
import { SuiteConfigApp } from "./suite-config-app.mjs";

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

  // The premium etched-glass feature toggle UI.
  game.settings.registerMenu(SUITE_ID, "featureManager", {
    name: "GLS.config.menu.name",
    label: "GLS.config.menu.label",
    hint: "GLS.config.menu.hint",
    icon: "fa-solid fa-sliders",
    type: SuiteConfigApp,
    restricted: true,
  });
}
