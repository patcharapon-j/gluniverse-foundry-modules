/**
 * GLUniverse Suite — Mythic GME feature adapter.
 *
 * A GM-facing quick-roll oracle for the Mythic Game Master Emulator 2nd Edition:
 * a draggable panel with the Fate Chart, Random Events, and every Meaning /
 * Elements table, plus a persisted Chaos Factor. System-agnostic, off by default.
 * See oracle.mjs (engine), panel.mjs (UI), data/tables.mjs (bundled tables).
 */

import { Suite } from "../../core/registry.mjs";
import { FEATURE_ID } from "./oracle.mjs";
import { registerSettings, onInit, onReady } from "./main.mjs";
import { MythicPanel } from "./panel.mjs";
import * as oracle from "./oracle.mjs";

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

  registerSettings() { registerSettings(); },
  onInit() { onInit(); },
  onReady() { onReady(); },

  api: {
    open: () => MythicPanel.open(),
    rollFate: oracle.rollFate,
    rollRandomEvent: oracle.rollRandomEvent,
    rollElement: oracle.rollElement,
    getChaos: oracle.getChaos,
    setChaos: oracle.setChaos,
  },
});
