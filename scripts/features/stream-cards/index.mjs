/**
 * GLUniverse Stream: PF2e Roll Cards — suite adapter.
 *
 * In PF2e worlds the stream's chat overlay shows compact roll cards instead of
 * cloned chat cards: player, character, check, target, natural d20, DC, total
 * and degree of success, with character art framed on the face.
 *
 * A promoted sub-feature of `stream`: the cards render into that feature's
 * overlay and have nowhere to draw without it, so `requiresFeature` gates them
 * and `stream.card` nests inside the parent's `stream.` catch-all. Registered
 * after the parent in `features/index.mjs` so the Control Center groups it
 * beneath — registration order is what drives that.
 */

import { Suite } from "../../core/registry.mjs";
import { CARDS_FEATURE_ID, CARDS_PREFIX, FEATURE_ID } from "../stream/constants.js";

Suite.register({
  id: CARDS_FEATURE_ID,
  title: "GLS.feature.stream-cards.title",
  hint: "GLS.feature.stream-cards.hint",
  icon: "fa-solid fa-address-card",
  settingPrefix: CARDS_PREFIX,
  system: "pf2e",
  requiresFeature: FEATURE_ID,
  requires: [],
  core: false,
  defaultEnabled: false,

  registerSettings() {},
  onInit() {},
  onReady() {},

  api: null,
});
