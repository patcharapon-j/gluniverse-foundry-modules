/**
 * GLUniverse Suite — Flatfinder feature adapter.
 *
 * Ported from the standalone `pf2e-flatfinder` module. Registers the feature
 * with the suite registry; the registry owns the Foundry lifecycle and only
 * runs onInit/onReady when the feature is enabled and the pf2e system is present.
 */

import { Suite } from "../../core/registry.mjs";
import { registerSettings, onInit, onReady } from "./flatfinder.js";
import { apexApi } from "./apex.js";

Suite.register({
  id: "flatfinder",
  title: "GLS.feature.flatfinder.title",
  hint: "GLS.feature.flatfinder.hint",
  icon: "fa-solid fa-dice-d20",
  system: "pf2e",
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
    id: "pf2e-flatfinder",
    settings: {
      competenceBadge: "ff.competenceBadge",
      incapacitation: "ff.incapacitation",
      flattenDc: "ff.flattenDc",
      eliteWeakLevel: "ff.eliteWeakLevel",
      apexTurns: "ff.apexTurns",
      apexPerTurnGuard: "ff.apexPerTurnGuard",
      apexPhases: "ff.apexPhases",
      encounterBudget: "ff.encounterBudget",
    },
  },

  api: apexApi,
});
