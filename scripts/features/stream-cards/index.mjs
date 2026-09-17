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
 * exposes a card-feed slot and a panel-section slot, which are filled here (the
 * feed at init — see onInit). With this feature absent or disabled the overlay's feed is null and
 * it clones Foundry-rendered chat cards, which is the non-PF2e path and has
 * always worked.
 */

import { Suite } from "../../core/registry.mjs";
import { CARDS_FEATURE_ID, CARDS_PREFIX, FEATURE_ID } from "../stream/constants.js";
import { registerCardFeed, registerPanelSection } from "../stream/extensions.mjs";
import { SUITE_ID, warn } from "../../core/const.mjs";
import { CARD_FLAGS, SETTINGS, registerSettings } from "./settings.js";
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

  /**
   * The roll-card half of the standalone module's stored state.
   *
   * `portraitFocus` is a per-actor flag — a GM's hand-set framing for a
   * specific picture — so it needs a sweep. World actors only: a compendium
   * actor dragged onto the canvas becomes a world actor and is re-framed there,
   * and unlinked token actors would mean walking every token on every scene for
   * a framing that was almost certainly set on the base actor.
   *
   * The key is read from `CARD_FLAGS` rather than spelled again here. The
   * standalone module spelled it in two places and this would have been the
   * third; a migration that writes a key the reader does not read restores
   * nothing, and looks like it worked.
   */
  legacy: {
    id: "gluniverse-stream",
    settings: {
      defaultRollArt: SETTINGS.defaultRollArt,
    },
    migrate: async () => {
      const OLD = "gluniverse-stream";
      for (const actor of game.actors ?? []) {
        const focus = actor.flags?.[OLD]?.portraitFocus;
        if (focus === undefined) continue;
        try {
          if (actor.getFlag(SUITE_ID, CARD_FLAGS.portraitFocus) === undefined) {
            await actor.setFlag(SUITE_ID, CARD_FLAGS.portraitFocus, focus);
          }
        } catch (e) {
          warn(`Stream cards: portrait-framing migration failed for actor ${actor.id}:`, e);
        }
      }
    },
  },

  api: { SETTINGS },
});
