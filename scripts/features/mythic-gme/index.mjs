/**
 * GLUniverse Suite: Mythic GME feature adapter.
 *
 * A GM's oracle for the Mythic Game Master Emulator 2nd Edition: the Fate
 * Chart against a persisted Chaos Factor, Random Events, scene checks, the
 * Threads and Characters lists, and every bundled meaning table. System
 * agnostic, off by default. See docs/MYTHIC_GME.md.
 *
 *   rules.mjs    the rules, pure          catalog.mjs  the meaning tables, pure
 *   oracle.mjs   a roll as a log entry    lists.mjs    lists and panel memory
 *   model.mjs    what is shown, pure      render.mjs   the markup, pure
 *   store.mjs    settings, the one reader and writer
 *   session.mjs  roll and log            chat.mjs     post a card
 *   app.mjs      the panel                main.mjs     settings and wiring
 */

import { Suite } from "../../core/registry.mjs";
import { FEATURE_ID } from "./constants.mjs";
import { registerSettings, onInit, onReady, openPanel } from "./main.mjs";
import { rollElement } from "./catalog.mjs";
import { rollFate } from "./rules.mjs";
import { endScene, rollAskFate, rollEvent, rollSceneCheck } from "./session.mjs";
import { getChaos, setChaos } from "./store.mjs";

Suite.register({
  id: FEATURE_ID,
  title: "GLMYTHIC.title",
  hint: "GLMYTHIC.hint",
  icon: "fa-solid fa-hat-wizard",
  settingPrefix: "mythic.",
  system: null,
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

  api: {
    open: () => openPanel(),
    /** Silent and unlogged, as before the remake: `{ oddsId, cf, roll, key, yes, threshold, eventTriggered }`. */
    rollFate: (oddsId, cf) => rollFate(oddsId, cf ?? getChaos()),
    rollElement: (id) => rollElement(id),
    getChaos: () => getChaos(),
    setChaos: (v) => setChaos(v),
    /** Logged rolls: each lands in this client's panel log and resolves to its entry. */
    askFate: (oddsId, question) => rollAskFate(oddsId, question),
    rollRandomEvent: () => rollEvent(),
    checkScene: () => rollSceneCheck(),
    endScene: (inControl) => endScene(!!inControl),
  },
});
