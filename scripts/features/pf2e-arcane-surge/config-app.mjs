/**
 * GLUniverse Suite — Arcane Surge odds and eligibility editor.
 *
 * The four stability levels are fixed — their names carry setting fiction and
 * each has hand-tuned visuals behind it — but every NUMBER is the GM's: the d20
 * threshold per level, the severity band boundaries per row, and the six
 * eligibility switches.
 *
 * Changing a threshold changes the die: the face layout is derived from it, so
 * a level set to 6 bakes six glyph faces. That is the whole reason the die is
 * worth having, and it is also why `tools/arcane-surge-check.mjs` refuses to let
 * the two drift.
 *
 * Bands are entered as cumulative upper bounds, exactly as the draft's table
 * reads them. A tier whose bound equals the tier above it has zero width and
 * simply never comes up — which is how Fraying expresses "no Catastrophic".
 */

import { SUITE_ID } from "../../core/const.mjs";
import { MAX_THRESHOLD, ROWS, SETTINGS, TIERS } from "./constants.mjs";
import { resolveConfig, tierWindow } from "./levels.mjs";
import { eligibility, rowLabel, tierLabel } from "./settings.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const TEMPLATE = `modules/${SUITE_ID}/templates/pf2e-arcane-surge/config.hbs`;
const t = (key) => game.i18n.localize(key);

export class ArcaneSurgeConfigApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "glas-config",
    tag: "form",
    classes: ["gls-scope", "glas-config-app", "gl-type"],
    window: {
      title: "GLAS.config.title",
      icon: "fa-solid fa-wand-sparkles",
      contentClasses: ["standard-form"],
      resizable: true,
    },
    position: { width: 720, height: 700 },
    form: { handler: ArcaneSurgeConfigApp.#submit, closeOnSubmit: false },
    actions: { reset: ArcaneSurgeConfigApp.#reset },
  };

  static PARTS = { form: { template: TEMPLATE } };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const config = resolveConfig(readStored());
    const rules = eligibility();

    return Object.assign(context, {
      intro: t("GLAS.config.intro"),
      maxThreshold: MAX_THRESHOLD,
      rows: ROWS.map((row) => ({
        id: row,
        label: rowLabel(row),
        // The invited row is never rolled against with a d20 — it is only a
        // severity row — so its threshold field is meaningless and hidden.
        showThreshold: row !== "invitedUnraveling",
        threshold: config[row].threshold,
        tiers: TIERS.map((tier) => {
          const window = tierWindow(tier, config[row].bands);
          return {
            id: tier,
            label: tierLabel(tier),
            bound: config[row].bands[tier],
            // Shown beside the field so a GM can see at a glance which tiers
            // they have just made unreachable.
            window: window ? `${window[0]}–${window[1]}` : t("GLAS.config.unreachable"),
            unreachable: !window,
          };
        }),
      })),
      eligibility: [
        { id: "cantrips", on: rules.cantrips },
        { id: "focus", on: rules.focus },
        { id: "innate", on: rules.innate },
        { id: "fromItems", on: rules.fromItems },
        { id: "rituals", on: rules.rituals },
        { id: "npcCasters", on: rules.npcCasters },
      ].map((entry) => ({ ...entry, label: t(`GLAS.config.eligibility.${entry.id}`), hint: t(`GLAS.config.eligibilityHint.${entry.id}`) })),
      minRank: rules.minRank,
      labels: {
        odds: t("GLAS.config.odds"),
        threshold: t("GLAS.config.threshold"),
        thresholdHint: t("GLAS.config.thresholdHint"),
        bands: t("GLAS.config.bands"),
        bandsHint: t("GLAS.config.bandsHint"),
        eligibility: t("GLAS.config.eligibilityTitle"),
        minRank: t("GLAS.config.minRank"),
        minRankHint: t("GLAS.config.minRankHint"),
        save: t("GLAS.config.save"),
        reset: t("GLAS.config.reset"),
      },
    });
  }

  static async #submit(_event, _form, formData) {
    const expanded = foundry.utils.expandObject(formData.object);

    const levelConfig = {};
    for (const row of ROWS) {
      const entry = expanded.rows?.[row] ?? {};
      const bands = {};
      for (const tier of TIERS) bands[tier] = Number(entry.bands?.[tier]);
      levelConfig[row] = { threshold: Number(entry.threshold), bands };
    }

    const rules = expanded.eligibility ?? {};
    // `resolveConfig` repairs whatever this produces on the way back out, so a
    // GM cannot save a table that makes a tier silently unreachable by accident
    // — only deliberately, by setting equal bounds.
    await game.settings.set(SUITE_ID, SETTINGS.levelConfig, resolveConfig(levelConfig));
    await game.settings.set(SUITE_ID, SETTINGS.eligibility, {
      cantrips: !!rules.cantrips,
      focus: !!rules.focus,
      innate: !!rules.innate,
      fromItems: !!rules.fromItems,
      rituals: !!rules.rituals,
      npcCasters: !!rules.npcCasters,
      minRank: Number(expanded.minRank),
    });

    ui.notifications?.info(t("GLAS.config.saved"));
    this.render();
  }

  static async #reset() {
    await game.settings.set(SUITE_ID, SETTINGS.levelConfig, {});
    await game.settings.set(SUITE_ID, SETTINGS.eligibility, {});
    this.render();
  }
}

function readStored() {
  try {
    return game.settings.get(SUITE_ID, SETTINGS.levelConfig) ?? {};
  } catch {
    return {};
  }
}
