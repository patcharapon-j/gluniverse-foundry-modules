/**
 * Combat Intro — a cinematic, full-screen start to a PF2e encounter: the
 * roster, the title and the threat, then every PC rolls initiative on their
 * own Dice So Nice die, the hostiles answer in one volley, and the cards sort
 * into PF2e's order and land as the initiative rail. See docs/COMBAT_INTRO.md.
 *
 * Adapter only: main.mjs has no import-time side effects, so a disabled
 * feature stays inert until the registry calls in.
 */
import { Suite } from "../../core/registry.mjs";
import { FEATURE_ID, PREFIX, DSN_ID } from "./constants.mjs";
import { registerSettings, onInit, onReady, api } from "./main.mjs";

Suite.register({
  id: FEATURE_ID,
  title: "GLCI.feature.title",
  hint: "GLCI.feature.hint",
  icon: "fa-solid fa-clapperboard",
  settingPrefix: PREFIX,
  system: "pf2e",
  // Dice So Nice 6.x needs Foundry v14; the major version is checked again at
  // ready, where a 5.x install stands the feature down.
  minimumGeneration: 14,
  requires: [DSN_ID],
  // The Start button, the arrival and the skin all live in the initiative rail.
  requiresFeature: "initiative",
  defaultEnabled: false,
  registerSettings,
  onInit,
  onReady,
  api,
});
