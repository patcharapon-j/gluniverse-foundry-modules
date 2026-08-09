/**
 * GLUniverse Suite — Locations feature adapter.
 *
 * Theatre-of-mind backdrop travel: the party stays on one scene and the GM
 * changes *where they are* by swapping the scene's background behind a
 * cinematic curtain, with a location name card on the reveal.
 *
 * The load-bearing decision is that travel writes the **real** background field
 * on the document rather than inventing a parallel state channel. Foundry
 * replicates it to every client for free, and Stage re-grades the cast off its
 * own hooks — so the two features stay in sync without one line of code between
 * them. See `deck.mjs` for where that field actually lives (it moved in v14),
 * and `travel.mjs` for the curtain.
 */

import { Suite } from "../../core/registry.mjs";
import { SUITE_ID } from "../../core/const.mjs";
import { ensureSuiteGroup, bindSuiteToolClicks } from "../../core/scene-controls.mjs";
import {
  FEATURE_ID, FLAG_CURRENT, SETTING_DECK, SETTING_MOTION, SETTING_PACE, SETTING_RECENTER, SETTING_SETTLE,
  findEntry, getCurrent, listEntries,
} from "./deck.mjs";
import { STYLES, announce, goHome, initSocket, isTravelling, preview, travel } from "./travel.mjs";
import { LocationsPanel } from "./panel.mjs";

const TOOL = "locations-open";

function openPanel() {
  if (!game.user.isGM) return;
  LocationsPanel.open();
}

/**
 * A backdrop change we did not cause means the GM edited the scene by hand, so
 * the deck's "you are here" marker is stale. Clearing it is cosmetic — it keeps
 * the panel honest rather than highlighting a place the scene left.
 */
function forgetCurrentOnForeignEdit(scene, changed) {
  if (!game.user.isGM) return;
  if (!scene || scene.id !== canvas?.scene?.id) return;
  if (isTravelling() || !changed) return;
  if (!getCurrent(scene)) return;
  scene.unsetFlag(SUITE_ID, FLAG_CURRENT);
}

Suite.register({
  id: FEATURE_ID,
  title: "GLLOC.title",
  hint: "GLLOC.hint",
  icon: "fa-solid fa-map-location-dot",
  settingPrefix: "loc.",
  system: null,
  requires: [],
  core: false,
  defaultEnabled: false,

  registerSettings() {
    // The deck itself — data, never a config row.
    game.settings.register(SUITE_ID, SETTING_DECK, {
      scope: "world",
      config: false,
      type: Object,
      default: { entries: [] },
      onChange: () => LocationsPanel.refresh(),
    });

    game.settings.register(SUITE_ID, SETTING_PACE, {
      name: "GLLOC.setting.pace.name",
      hint: "GLLOC.setting.pace.hint",
      scope: "world",
      config: true,
      type: Number,
      range: { min: 0.5, max: 2, step: 0.1 },
      default: 1,
    });

    // A taste call, not a tuning constant — see SETTLE_DEFAULT_MS in travel.mjs.
    game.settings.register(SUITE_ID, SETTING_SETTLE, {
      name: "GLLOC.setting.settle.name",
      hint: "GLLOC.setting.settle.hint",
      scope: "world",
      config: true,
      type: Number,
      range: { min: 0, max: 1500, step: 50 },
      default: 700,
    });

    game.settings.register(SUITE_ID, SETTING_RECENTER, {
      name: "GLLOC.setting.recenter.name",
      hint: "GLLOC.setting.recenter.hint",
      scope: "world",
      config: true,
      type: Boolean,
      default: true,
    });

    // Client-scoped and explicitly chosen — the suite does not sniff the OS
    // reduced-motion preference, so a player who wants less gets to say so.
    game.settings.register(SUITE_ID, SETTING_MOTION, {
      name: "GLLOC.setting.motion.name",
      hint: "GLLOC.setting.motion.hint",
      scope: "client",
      config: true,
      type: String,
      choices: {
        full: "GLLOC.setting.motion.full",
        reduced: "GLLOC.setting.motion.reduced",
        off: "GLLOC.setting.motion.off",
      },
      default: "full",
    });
  },

  onInit() {
    Hooks.on("getSceneControlButtons", (controls) => {
      if (!game.user.isGM) return;
      const group = ensureSuiteGroup(controls);
      if (!group) return;
      group.tools[TOOL] = {
        name: TOOL,
        title: "GLLOC.control",
        icon: "fa-solid fa-map-location-dot",
        order: Object.keys(group.tools).length,
        button: true,
        visible: true,
        onChange: () => openPanel(),
      };
    });
    Hooks.on("renderSceneControls", (_app, html) => {
      if (!game.user.isGM) return;
      bindSuiteToolClicks(html, { [TOOL]: openPanel });
    });

    // v13 keeps the backdrop on the Scene; v14 moved it to an embedded Level.
    Hooks.on("updateScene", (scene, changes) => {
      LocationsPanel.refresh();
      forgetCurrentOnForeignEdit(scene, "background" in changes);
    });
    Hooks.on("updateLevel", (level, changes) => {
      forgetCurrentOnForeignEdit(level?.parent, "background" in changes);
    });
  },

  onReady() {
    initSocket();
  },

  api: {
    /**
     * Travel to a deck entry by id, or to an ad-hoc `{img, name, subtitle, …}`.
     * Resolves when the reveal has finished, so a macro can sequence narration
     * after it.
     */
    async goto(target, opts = {}) {
      const entry = typeof target === "string" ? findEntry(target) : target;
      if (!entry) return void console.warn(`GLUniverse Suite | No location "${target}".`);
      return travel(entry, opts);
    },
    /** Show the name card without changing anything — the constant case. */
    announce,
    home: goHome,
    preview,
    list: listEntries,
    styles: () => Object.keys(STYLES),
  },
});
