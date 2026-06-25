/**
 * GLUniverse Suite — feature adapter for "initiative".
 *
 * Wraps the ported standalone module (formerly "gluniverse-initiative"). All of
 * the feature's settings, hooks, sockets and UI now live behind the suite
 * lifecycle: registerSettings() runs unconditionally so the toggles exist;
 * onInit()/onReady() run only when the feature is enabled & available.
 *
 * System-agnostic, but retains internal game.system.id guards for its PF2e/5e
 * specific behaviour (e.g. the PF2e guard-break effect, 5e/PF2e dying states).
 */

import { Suite } from "../../core/registry.mjs";
import { registerSettings, onInit, onReady } from "./gluniverse-initiative.mjs";

Suite.register({
  id: "initiative",
  title: "GLS.feature.initiative.title",
  hint: "GLS.feature.initiative.hint",
  icon: "fa-solid fa-bolt",
  settingPrefix: "init.",
  system: null,
  requires: [],
  core: false,
  defaultEnabled: false,

  registerSettings() {
    registerSettings();
  },

  onInit() {
    onInit();
  },

  onReady() {
    onReady();
  },

  legacy: {
    id: "gluniverse-initiative",
    // Old standalone setting key → new suite-prefixed key. Registered under the
    // suite id ("gluniverse-foundry-modules") with the "init." prefix.
    settings: {
      enabled: "init.enabled",
      initiativeMode: "init.initiativeMode",
      edge: "init.edge",
      visibleCount: "init.visibleCount",
      showAllCombatants: "init.showAllCombatants",
      showDefeated: "init.showDefeated",
      delayedPlacement: "init.delayedPlacement",
      position: "init.position",
      uiScale: "init.uiScale",
      tokenOverlayShape: "init.tokenOverlayShape",
      turnMarkerEnabled: "init.turnMarkerEnabled",
      startMarkerEnabled: "init.startMarkerEnabled",
      startConnectorEnabled: "init.startConnectorEnabled",
      conditionBadges: "init.conditionBadges",
      conditionBadgeLayout: "init.conditionBadgeLayout",
      guardBreakSound: "init.guardBreakSound",
      guardBreakSoundVolume: "init.guardBreakSoundVolume",
      theme: "init.theme",
    },
  },

  api: null,
});
