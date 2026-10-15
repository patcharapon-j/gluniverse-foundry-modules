/**
 * Save Resolution — suite adapter.
 *
 * One flow for every save spell: who is in the area (or targeted), each
 * creature's save rolled through PF2e itself, the damage rolled once and
 * applied per creature through PF2e's own IWR at its degree's multiplier, the
 * spell's conditions applied by degree, and every Apply revertible. The GM is
 * the only writer. See docs/PF2E_ODDS.md, "Save Resolution".
 *
 * Adapter only: main.mjs has no import-time side effects, so a disabled
 * feature stays inert until the registry calls in.
 */

import { Suite } from "../../core/registry.mjs";
import { FEATURE_ID, PREFIX } from "./constants.mjs";
import { api, onInit, onReady, registerSettings } from "./main.mjs";

Suite.register({
  id: FEATURE_ID,
  title: "GLS.feature.pf2e-saves.title",
  hint: "GLS.feature.pf2e-saves.hint",
  icon: "fa-solid fa-list-check",
  settingPrefix: PREFIX,
  system: "pf2e",
  requires: [],
  core: false,
  defaultEnabled: false,
  registerSettings,
  onInit,
  onReady,
  api,
});
