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
import { FEATURE_ID, KNOWLEDGE_HOOK, PREFIX, SETTINGS } from "./constants.mjs";
import { get, registerSettings } from "./settings.mjs";
import { installProbe, invalidate } from "./probe.mjs";
import { onChatMessage, onForgetIntent } from "./observe.mjs";
import { clearKnowledgeCache } from "./knowledge.mjs";
import { setForgetHandler, wireTracker } from "./tracker.mjs";
import { LineBadges } from "./line-badges.mjs";
import { wireSheet } from "./sheet.mjs";
import { wireDialog } from "./dialog.mjs";
import { wireSavePrompts } from "./save-prompt.mjs";
import { ObservationsMenu } from "./observations-app.mjs";
import { wireDexHint } from "./dex-hint.mjs";
import { wireLanding } from "./dice-highlight.mjs";
import { motionScale } from "../../core/theme.mjs";
import { saveButtonModel } from "./view.mjs";
import { inlineHTML } from "./render.mjs";

let badges = null;

/** Anything a probe depends on moved: drop cached answers and redraw. */
function wireInvalidation() {
  const stale = (uuids = null) => {
    invalidate(uuids);
    badges?.refresh();
  };
  // A document on one actor stales only that actor's answers: as a roller (its
  // actor uuid) and as a target (each of its tokens' uuids).
  const actorKeys = (actor) => (actor ? [actor.uuid, ...(actor.getActiveTokens?.(false, true) ?? []).map((t) => t.uuid)] : null);
  const ownerOf = (doc) => (doc?.documentName === "Actor" ? doc : doc?.parent?.documentName === "Actor" ? doc.parent : doc?.actor ?? null);
  for (const hook of ["updateActor", "createItem", "updateItem", "deleteItem", "createActiveEffect", "updateActiveEffect", "deleteActiveEffect"]) {
    Hooks.on(hook, (doc) => {
      const actor = ownerOf(doc);
      stale(actor ? actorKeys(actor) : null);
    });
  }
  for (const hook of ["targetToken", "updateCombat"]) Hooks.on(hook, () => stale());
  // Token movement changes flanking, cover and range; nothing else on a token does.
  Hooks.on("updateToken", (_doc, changes) => {
    if ("x" in changes || "y" in changes || "elevation" in changes || "hidden" in changes) stale();
  });
  // A new ledger value or a dex reveal changes what players know.
  Hooks.on("updateSetting", (setting) => {
    const key = String(setting?.key ?? "");
    if (key.endsWith(".od.ledger") || key.includes(".dex.")) {
      clearKnowledgeCache();
      Hooks.callAll(KNOWLEDGE_HOOK);
    }
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
    setForgetHandler(onForgetIntent);
    wireTracker();
    wireInvalidation();
    wireDexHint();
    badges = new LineBadges();
    badges.wire();
    Hooks.on(KNOWLEDGE_HOOK, () => badges?.refresh());
    wireLanding({
      badges: () => badges,
      motion: () => {
        try {
          return motionScale(document.body);
        } catch {
          return 1;
        }
      },
    });
  },

  api: {
    get badges() {
      return badges;
    },
    openObservations: () => new (ObservationsMenu())().render(true),
    /**
     * The inline odds for one creature's save, as the current user may see
     * them ("" when there is nothing to show). Save Resolution draws it on
     * each unrolled row; one model, so a row and a spell card's save button
     * never disagree.
     */
    saveOdds: async ({ saver, save, dc, origin = null, item = null }) => {
      if (!Suite.enabled(FEATURE_ID) || !get(SETTINGS.savePrompt, true)) return "";
      return inlineHTML(await saveButtonModel({ saver, save, dc, origin, item })) ?? "";
    },
  },
});
