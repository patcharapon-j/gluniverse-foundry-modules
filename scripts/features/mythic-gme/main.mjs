/**
 * GLUniverse Suite — Mythic GME feature: lifecycle wiring.
 *
 * Registers the feature's settings (all prefixed `mythic.`), adds the GM-only
 * scene-control button that opens the oracle panel, and keeps a second GM's open
 * panel in sync when the shared Chaos Factor changes.
 */

import { SUITE_ID } from "../../core/const.mjs";
import { ensureSuiteGroup, bindSuiteToolClicks } from "../../core/scene-controls.mjs";
import {
  CHAOS_KEY, LOG_KEY, POS_KEY, AUTOEVENT_KEY, CHAOS_DEFAULT,
} from "./oracle.mjs";
import { MythicPanel } from "./panel.mjs";

const TOOL = "mythic-open";

function openPanel() {
  if (!game.user.isGM) return;
  MythicPanel.open();
}

export function registerSettings() {
  // Chaos Factor — shared world state (hidden; edited from the panel).
  game.settings.register(SUITE_ID, CHAOS_KEY, {
    scope: "world",
    config: false,
    type: Number,
    default: CHAOS_DEFAULT,
    onChange: () => MythicPanel.current?.refreshChaos(),
  });

  // Persisted roll log — per client (last N rolls).
  game.settings.register(SUITE_ID, LOG_KEY, {
    scope: "client",
    config: false,
    type: Array,
    default: [],
  });

  // Remembered panel position — per client.
  game.settings.register(SUITE_ID, POS_KEY, {
    scope: "client",
    config: false,
    type: Object,
    default: {},
  });

  // Auto-roll a triggered Random Event inline — surfaces in the Control Center.
  game.settings.register(SUITE_ID, AUTOEVENT_KEY, {
    name: "GLMYTHIC.settings.autoEvent.name",
    hint: "GLMYTHIC.settings.autoEvent.hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });
}

export function onInit() {
  Hooks.on("getSceneControlButtons", (controls) => {
    if (!game.user.isGM) return;
    const group = ensureSuiteGroup(controls);
    if (!group) return;
    group.tools[TOOL] = {
      name: TOOL,
      title: "GLMYTHIC.control",
      icon: "fa-solid fa-hat-wizard",
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
}

export function onReady() {
  // Panel is opened on demand from the scene-control button; nothing to mount.
}
