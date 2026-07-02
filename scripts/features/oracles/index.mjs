/**
 * GLUniverse Suite — Oracles feature adapter.
 *
 * A GM-facing multi-genre oracle library: Ironsworn-style yes/no oracle
 * (5 odds + match), the universal Action/Theme/Descriptor/Focus prompts,
 * and swappable genre packs (Starforged sci-fi, Fantasy, Dark Fantasy,
 * Modern Occult, Urban Gothic, Dieselpunk, Arcanepunk), each filling the
 * same eight Tier-1 slots plus its own signature generators. Pack data
 * loads lazily — only enabled packs are ever imported. System-agnostic,
 * off by default. See engine.mjs (resolver), panel.mjs (UI), data/ (packs).
 *
 * CC-BY 4.0 attribution: ported packs contain material from Ironsworn and
 * Ironsworn: Starforged by Shawn Tomkin (ironswornrpg.com); see each pack's
 * data-file header. Ironsworn and Starforged are trademarks of Shawn Tomkin.
 */

import { Suite } from "../../core/registry.mjs";
import { FEATURE_ID, askOracle, rollTable, packViews, primaryPackId } from "./engine.mjs";
import { registerSettings, onInit, onReady } from "./main.mjs";
import { OraclesPanel } from "./panel.mjs";

Suite.register({
  id: FEATURE_ID,
  title: "GLORACLE.title",
  hint: "GLORACLE.hint",
  icon: "fa-solid fa-circle-question",
  settingPrefix: "oracle.",
  system: null,
  requires: [],
  core: false,
  defaultEnabled: false,

  registerSettings() { registerSettings(); },
  onInit() { onInit(); },
  onReady() { onReady(); },

  api: {
    open: () => OraclesPanel.open(),
    ask: askOracle,
    roll: rollTable,
    packs: packViews,
    primaryPack: primaryPackId,
  },
});
