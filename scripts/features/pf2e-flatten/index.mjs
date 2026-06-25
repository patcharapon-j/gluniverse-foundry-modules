/**
 * GLUniverse Suite — feature adapter for "pf2e-flatten".
 *
 * Applies the Proficiency Without Level variant rule to PF2e actors: flatten /
 * unflatten NPCs (and optionally PCs) from the sidebar, optional auto-flatten of
 * compendium-dragged actors, and half-level proficiency support.
 */
import { Suite } from "../../core/registry.mjs";
import { onInit, onReady, registerSettings } from "./pf2e-flatten.js";

Suite.register({
  id: "pf2e-flatten",
  title: "GLS.feature.pf2e-flatten.title",
  hint: "GLS.feature.pf2e-flatten.hint",
  icon: "fa-solid fa-level-down-alt",
  settingPrefix: "flatten.",
  system: "pf2e",
  requires: [],
  core: false,
  defaultEnabled: false,

  // Always register settings so the toggles exist even when the feature is off.
  registerSettings() {
    registerSettings();
  },

  // Wire actor-directory / lifecycle hooks (enabled & available only).
  onInit() {
    onInit();
  },

  // Patch PF2e NPC sheets so flattening doesn't paint statistics red.
  onReady() {
    onReady();
  },

  // Migration from the standalone "pf2e-flatten" module. Maps each old (raw)
  // setting key to its new, feature-prefixed suite key. No document flags to
  // move — the flattening modifier lives on actor system data, not in flags.
  legacy: {
    id: "pf2e-flatten",
    settings: {
      autoflatten: "flatten.autoflatten",
      flattenPcs: "flatten.flattenPcs",
      multiplier: "flatten.multiplier",
      roundingMode: "flatten.roundingMode",
    },
  },

  api: null,
});
