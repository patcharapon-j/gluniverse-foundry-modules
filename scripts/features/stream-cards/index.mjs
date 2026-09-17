/**
 * GLUniverse Stream: PF2e Roll Cards — suite adapter.
 *
 * In PF2e worlds the stream's chat overlay shows compact roll cards instead of
 * cloned chat cards: player, character, check, target, natural d20, DC, total
 * and degree of success, over character art framed on the face.
 *
 * A promoted sub-feature of `stream`: the cards render into that feature's
 * overlay and have nowhere to draw without it, so `requiresFeature` gates them
 * and `stream.card` nests inside the parent's `stream.` catch-all. Registered
 * after the parent in `features/index.mjs` so the Control Center groups it
 * beneath — registration order is what drives that.
 *
 * The dependency points one way. `stream` never imports this feature; it
 * exposes a card-feed slot and a panel-section slot, which are filled here from
 * `onReady`. With this feature absent or disabled the overlay's feed is null and
 * it clones Foundry-rendered chat cards, which is the non-PF2e path and has
 * always worked.
 */

import { Suite } from "../../core/registry.mjs";
import { CARDS_FEATURE_ID, CARDS_PREFIX, FEATURE_ID } from "../stream/constants.js";
import { registerCardFeed, registerPanelSection } from "../stream/extensions.mjs";
import { SETTINGS, registerSettings } from "./settings.js";
import { claimAction, claimChange, renderSection } from "./panel.js";
import { registerFramingSheetHeader } from "./framing/sheet-header.js";
import { RollCardFeed } from "./pf2e/roll-card-feed.js";

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

  registerSettings() { registerSettings(); },

  onInit() {
    // The actor-sheet "Frame For Stream" header button is this feature's, not
    // the stream client's — the standalone module registered it from its own
    // entry point, which would have made `stream` import a child.
    registerFramingSheetHeader();

    // The feed factory MUST be registered at init, not ready. `stream` builds
    // its ChatOverlay during *its* onReady, and the overlay asks for a feed in
    // its constructor; phases run in registration order, so this feature's
    // onReady is too late and the overlay would be built with a null feed —
    // falling back to cloned chat cards forever, with nothing reported.
    registerCardFeed((overlay) => new RollCardFeed(overlay));
  },

  onReady() {
    registerPanelSection({
      id: CARDS_FEATURE_ID,
      order: 20,
      render: renderSection,
      change: claimChange,
      action: claimAction
    });
  },

  api: { SETTINGS },
});
