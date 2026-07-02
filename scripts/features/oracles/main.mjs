/**
 * GLUniverse Suite — Oracles feature: lifecycle wiring.
 *
 * Registers the feature's settings (all prefixed `oracle.`): the primary
 * genre pack, one enable toggle per genre pack (only enabled packs are ever
 * imported), and the client-side log/position/context state. Adds the
 * GM-only scene-control button that opens the oracle panel.
 */

import { SUITE_ID } from "../../core/const.mjs";
import { ensureSuiteGroup, bindSuiteToolClicks } from "../../core/scene-controls.mjs";
import {
  PRIMARY_KEY, PACK_ENABLED_PREFIX, LOG_KEY, POS_KEY, CONTEXT_KEY,
  GENRE_PACKS, primaryPackChoices,
} from "./engine.mjs";
import { OraclesPanel } from "./panel.mjs";

const TOOL = "oracles-open";

function openPanel() {
  if (!game.user.isGM) return;
  OraclesPanel.open();
}

export function registerSettings() {
  // Primary genre pack — fills the panel's Tier-1 slot shortcut row.
  game.settings.register(SUITE_ID, PRIMARY_KEY, {
    name: "GLORACLE.settings.primaryPack.name",
    hint: "GLORACLE.settings.primaryPack.hint",
    scope: "world",
    config: true,
    type: String,
    choices: primaryPackChoices(),
    default: "starforged",
    onChange: () => OraclesPanel.current?.render({ force: true }),
  });

  // One enable toggle per genre pack (core is always on and has no toggle).
  for (const p of GENRE_PACKS) {
    game.settings.register(SUITE_ID, `${PACK_ENABLED_PREFIX}${p.id}`, {
      name: `GLORACLE.settings.pack.${p.id}.name`,
      hint: "GLORACLE.settings.pack.hint",
      scope: "world",
      config: true,
      type: Boolean,
      default: p.id === "starforged",
      onChange: () => OraclesPanel.current?.render({ force: true }),
    });
  }

  // Persisted roll log — per client (last N results).
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

  // Remembered context choice per pack — per client.
  game.settings.register(SUITE_ID, CONTEXT_KEY, {
    scope: "client",
    config: false,
    type: Object,
    default: {},
  });
}

export function onInit() {
  Hooks.on("getSceneControlButtons", (controls) => {
    if (!game.user.isGM) return;
    const group = ensureSuiteGroup(controls);
    if (!group) return;
    group.tools[TOOL] = {
      name: TOOL,
      title: "GLORACLE.control",
      icon: "fa-solid fa-circle-question",
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
  // Panel opens on demand from the scene-control button; packs load lazily
  // on first use — nothing to mount here.
}
