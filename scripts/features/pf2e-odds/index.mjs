/**
 * PF2e Odds — suite adapter.
 *
 * The chance a check works, drawn where the decision is made: on the targeting
 * line, on the sheet, inside PF2e's roll dialog, and on a spell card's save
 * button. Every number is PF2e's own (probe.mjs asks PF2e for the modifiers,
 * the DC and the degree adjustments without rolling), and every number a
 * player sees is gated on what the party has actually witnessed (knowledge.mjs:
 * the Creaturedex, then this feature's own observation ledger).
 *
 * See docs/PF2E_ODDS.md.
 */

import { Suite } from "../../core/registry.mjs";
import { FEATURE_ID, PREFIX } from "./constants.mjs";
import { registerSettings } from "./settings.mjs";
import { installProbe, invalidate } from "./probe.mjs";
import { onChatMessage } from "./observe.mjs";
import { wireTracker } from "./tracker.mjs";
import { LineBadges } from "./line-badges.mjs";
import { wireSheet } from "./sheet.mjs";
import { wireDialog } from "./dialog.mjs";
import { wireSavePrompts } from "./save-prompt.mjs";
import { ObservationsMenu } from "./observations-app.mjs";
import { wireDexHint } from "./dex-hint.mjs";

let badges = null;

/** Anything a probe depends on moved: drop cached answers and redraw. */
function wireInvalidation() {
  const stale = () => {
    invalidate();
    badges?.refresh();
  };
  for (const hook of [
    "updateActor",
    "createItem",
    "updateItem",
    "deleteItem",
    "createActiveEffect",
    "updateActiveEffect",
    "deleteActiveEffect",
    "targetToken",
    "updateCombat",
  ]) {
    Hooks.on(hook, stale);
  }
  // Token movement changes flanking, cover and range; nothing else on a token does.
  Hooks.on("updateToken", (_doc, changes) => {
    if ("x" in changes || "y" in changes || "elevation" in changes || "hidden" in changes) stale();
  });
  // A new ledger value or a dex reveal changes what players know.
  Hooks.on("updateSetting", (setting) => {
    const key = String(setting?.key ?? "");
    if (key.endsWith(".od.ledger") || key.endsWith(".dex.knowledge")) badges?.refresh();
  });
}

Suite.register({
  id: FEATURE_ID,
  title: "GLS.feature.pf2e-odds.title",
  hint: "GLS.feature.pf2e-odds.hint",
  icon: "fa-solid fa-dice-d20",
  settingPrefix: PREFIX,
  system: "pf2e",
  requires: [],
  core: false,
  defaultEnabled: false,
  registerSettings,

  onInit() {
    Hooks.on("createChatMessage", onChatMessage);
    wireSheet();
    wireDialog();
    wireSavePrompts();
  },

  onReady() {
    installProbe();
    wireTracker();
    wireInvalidation();
    wireDexHint();
    badges = new LineBadges();
    badges.wire();
  },

  api: {
    get badges() {
      return badges;
    },
    openObservations: () => new (ObservationsMenu())().render(true),
  },
});
