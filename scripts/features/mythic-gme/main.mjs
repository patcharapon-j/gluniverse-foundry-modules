/**
 * Mythic GME: lifecycle wiring.
 *
 * Registers every setting (all `mythic.`, registered whether or not the
 * feature is on, so its Control Center toggle exists), the GM's scene-control
 * button and the quick palette rows. Nothing here runs at import time.
 */

import { SUITE_ID } from "../../core/const.mjs";
import { ensureSuiteGroup, bindSuiteToolClicks } from "../../core/scene-controls.mjs";
import { registerQuickProvider } from "../../core/quick-palette.mjs";
import { matchScore } from "../../core/util.mjs";
import { CHAOS_DEFAULT, SETTINGS } from "./constants.mjs";
import { ELEMENT_TABLES } from "./catalog.mjs";
import { ODDS, fateCell } from "./rules.mjs";

const TOOL = "mythic-open";
const L = (k, d) => (d ? game.i18n.format(k, d) : game.i18n.localize(k));

/** The panel module reads `foundry.applications` at module scope, so it loads on first use. */
const panel = () => import("./app.mjs").then((m) => m.MythicPanel);
const session = async () => import("./session.mjs");

/** Redraw an open panel, if there is one. */
const redraw = () => import("./app.mjs").then((m) => m.MythicPanel.current?.render()).catch(() => {});

export function openPanel() {
  if (!game.user.isGM) return;
  panel().then((P) => P.open());
}

export function registerSettings() {
  game.settings.register(SUITE_ID, SETTINGS.chaos, {
    scope: "world",
    config: false,
    type: Number,
    default: CHAOS_DEFAULT,
    onChange: redraw,
  });
  game.settings.register(SUITE_ID, SETTINGS.log, {
    scope: "client",
    config: false,
    type: Array,
    default: [],
  });
  game.settings.register(SUITE_ID, SETTINGS.panelPos, {
    scope: "client",
    config: false,
    type: Object,
    default: {},
  });
  game.settings.register(SUITE_ID, SETTINGS.autoEvent, {
    name: "GLMYTHIC.settings.autoEvent.name",
    hint: "GLMYTHIC.settings.autoEvent.hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    onChange: redraw,
  });
  game.settings.register(SUITE_ID, SETTINGS.lists, {
    scope: "client",
    config: false,
    type: Object,
    default: {},
  });
  game.settings.register(SUITE_ID, SETTINGS.ui, {
    scope: "client",
    config: false,
    type: Object,
    default: {},
  });
  game.settings.register(SUITE_ID, SETTINGS.actions1, {
    scope: "world",
    config: false,
    type: String,
    default: "",
    onChange: redraw,
  });
}

/** Ctrl+K rows: every odds, the event, the scene check, and every elements table by name. */
function quickProvider() {
  const run = (fn) => async () => {
    openPanel();
    const s = await session();
    await fn(s);
  };
  const item = (key, title, sub, icon, fn) => ({
    key,
    title,
    sub,
    icon,
    actions: [{ id: "roll", label: "GLMYTHIC.quick.roll", icon: "fa-solid fa-dice", mod: "" }],
    run: run(fn),
  });
  return {
    id: "mythic-gme",
    order: 60,
    label: "GLMYTHIC.quick.label",
    icon: "fa-solid fa-hat-wizard",
    available: () => !!game.user?.isGM,
    search(query) {
      const cf = game.settings.get(SUITE_ID, SETTINGS.chaos);
      const items = [
        ...ODDS.map((o) =>
          item(`odds.${o.id}`, L("GLMYTHIC.quick.ask", { odds: L(`GLMYTHIC.odds.${o.id}`) }), L("GLMYTHIC.quick.chance", { yes: fateCell(o.id, cf).yes, cf }), "fa-solid fa-scale-balanced", (s) => s.rollAskFate(o.id))
        ),
        item("event", L("GLMYTHIC.event.button"), L("GLMYTHIC.title"), "fa-solid fa-bolt", (s) => s.rollEvent()),
        item("scene", L("GLMYTHIC.scene.check"), L("GLMYTHIC.title"), "fa-solid fa-clapperboard", (s) => s.rollSceneCheck()),
        ...ELEMENT_TABLES.map((e) => item(`el.${e.id}`, e.name, L(`GLMYTHIC.category.${e.category}`), "fa-solid fa-layer-group", (s) => s.rollElementTable(e.id))),
      ];
      if (!String(query ?? "").trim()) return items.slice(0, 10);
      return items
        .map((i) => ({ i, score: matchScore(i.title, `${i.title} ${i.sub} ${L("GLMYTHIC.title")}`, query) }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .map((x) => x.i);
    },
  };
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
  registerQuickProvider(quickProvider());
}

export function onReady() {
  // The panel opens on demand; nothing to mount.
}
