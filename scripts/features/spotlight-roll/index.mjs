/**
 * Spotlight Roll — a GM-called check played centre-screen on every client:
 * the roller's own Dice So Nice die tumbles in place in front of a glass
 * stele, modifiers fly into it, and PF2e's degree lands. See
 * docs/SPOTLIGHT_ROLL.md.
 *
 * Adapter only: main.mjs has no import-time side effects, so a disabled
 * feature stays inert until the registry calls in.
 */
import { Suite } from "../../core/registry.mjs";
import { FEATURE_ID, PREFIX, DSN_ID } from "./constants.mjs";
import { registerSettings, onInit, onReady, api } from "./main.mjs";

Suite.register({
  id: FEATURE_ID,
  title: "GLSR.feature.title",
  hint: "GLSR.feature.hint",
  icon: "fa-solid fa-dice-d20",
  settingPrefix: PREFIX,
  system: "pf2e",
  // Dice So Nice 6.x, which itself needs Foundry v14. The major version is
  // checked again at ready, where a 5.x install stands the feature down.
  minimumGeneration: 14,
  requires: [DSN_ID],
  defaultEnabled: false,
  registerSettings,
  onInit,
  onReady,
  api,
});
