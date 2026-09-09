/**
 * Dents — the table's configuration sheet.
 *
 * The book gives one pair of thresholds and one modifier. Everything else a
 * table might want — which kinds of thing dent at all, whether a high-grade or
 * adamantine item survives longer — is a ruling, and rulings belong in a sheet
 * rather than in a constant somebody has to fork the module to change.
 *
 * Three things this sheet is careful about.
 *
 * **It writes one object, not sixteen settings.** A per-material setting would
 * put twenty-two rows in the Control Center and each would need its own i18n
 * pair; as one object it is a single key with a single label, and adding a
 * material later costs nothing.
 *
 * **Material and grade labels come from PF2e, not from us.** They are looked up
 * as `PF2E.PreciousMaterial*`, which is the same string the item sheet shows —
 * restating them here would leave the two disagreeing the first time the system
 * renamed one, and only in our sheet.
 *
 * **Zero is the default everywhere it can be.** A GM who never opens this sheet
 * plays the printed rule exactly, and a GM who opens it and changes nothing
 * writes a config that is indistinguishable from never having opened it.
 */

import { SUITE_ID, warn } from "../../core/const.mjs";
import {
  DEFAULT_DENT_CONFIG,
  DENT_GRADES,
  DENT_MATERIALS,
  DENT_TYPES,
  SETTINGS,
} from "./constants.mjs";

/**
 * The class is built on first use, not at import time.
 *
 * `settings.mjs` is reached transitively by pure modules the check tool loads
 * under plain Node, where `foundry` does not exist. Evaluating
 * `class extends HandlebarsApplicationMixin(ApplicationV2)` at module scope
 * therefore takes the whole tool down with a ReferenceError that names this file
 * and explains nothing about why a rules check is loading an application.
 * Building it inside the factory keeps this module importable anywhere and costs
 * one memoised call at registration, when Foundry is certainly present.
 */
let _app = null;

const L = (key, fallback) => {
  const s = game.i18n.localize(key);
  return s === key ? (fallback ?? key) : s;
};

/** PF2e's own label for a material key, falling back to the key itself. */
const materialLabel = (key) => {
  const camel = key
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
  return L(`PF2E.PreciousMaterial${camel}`, key);
};

const gradeLabel = (key) => L(`PF2E.Item.Physical.MaterialGrade.${key}.Label`, key);

const typeLabel = (key) => L(`TYPES.Item.${key}`, key);

const int = (value, fallback = 0) => {
  const n = Math.trunc(Number(value));
  return Number.isFinite(n) ? n : fallback;
};

/** Read the stored config, filled out with the defaults. */
export function readDentConfig() {
  let stored = null;
  try {
    stored = game.settings.get(SUITE_ID, SETTINGS.dentsConfig);
  } catch {
    stored = null;
  }
  if (!stored || typeof stored !== "object") stored = {};
  return {
    ...DEFAULT_DENT_CONFIG,
    ...stored,
    types: { ...DEFAULT_DENT_CONFIG.types, ...(stored.types ?? {}) },
    grades: { ...DEFAULT_DENT_CONFIG.grades, ...(stored.grades ?? {}) },
    materials: { ...(stored.materials ?? {}) },
  };
}

export function DentConfigApp() {
  if (_app) return _app;
  const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

  _app = class DentConfigApp extends HandlebarsApplicationMixin(ApplicationV2) {
    static DEFAULT_OPTIONS = {
      // The glass treatment lives on `.glvr-cfg-root` inside `.window-content`,
      // never on the frame: Foundry sets `.application { position: absolute }`
      // inside `@layer applications`, and an unlayered utility that declares
      // `position` beats it outright, dropping the window into normal flow.
      id: "glvr-dent-config",
      classes: ["glvr", "glvr-dent-config"],
      tag: "form",
      window: { title: "GLVR.dentConfig.title", icon: "fa-solid fa-shield-halved", resizable: true },
      position: { width: 620, height: 700 },
      form: { handler: DentConfigApp.#save, submitOnChange: false, closeOnSubmit: true },
      actions: { reset: DentConfigApp.prototype._onReset },
    };

    static PARTS = {
      main: { template: `modules/${SUITE_ID}/templates/pf2e-variant-rules/dent-config.hbs` },
    };

    async _prepareContext(options) {
      const context = await super._prepareContext(options);
      const cfg = readDentConfig();
      return {
        ...context,
        broken: cfg.broken,
        destroyed: cfg.destroyed,
        sturdyMultiplier: cfg.sturdyMultiplier,
        types: DENT_TYPES.map((key) => ({ key, label: typeLabel(key), on: !!cfg.types[key] })),
        grades: DENT_GRADES.map((key) => ({ key, label: gradeLabel(key), value: int(cfg.grades[key]) })),
        materials: DENT_MATERIALS.map((key) => ({ key, label: materialLabel(key), value: int(cfg.materials[key]) })),
      };
    }

    /**
     * Save.
     *
     * Only non-zero grade and material rows are stored. Twenty-two zeroes in the
     * database is not configuration, it is noise that has to be migrated the next
     * time PF2e adds a material — and a sparse object reads back through
     * `?? 0` identically.
     */
    static async #save(event, form, formData) {
      const data = foundry.utils.expandObject(formData.object);
      const config = {
        broken: Math.max(1, int(data.broken, DEFAULT_DENT_CONFIG.broken)),
        destroyed: Math.max(2, int(data.destroyed, DEFAULT_DENT_CONFIG.destroyed)),
        sturdyMultiplier: Math.max(1, int(data.sturdyMultiplier, DEFAULT_DENT_CONFIG.sturdyMultiplier)),
        types: Object.fromEntries(DENT_TYPES.map((k) => [k, !!data.types?.[k]])),
        grades: Object.fromEntries(DENT_GRADES.map((k) => [k, int(data.grades?.[k])]).filter(([, v]) => v !== 0)),
        materials: Object.fromEntries(
          DENT_MATERIALS.map((k) => [k, int(data.materials?.[k])]).filter(([, v]) => v !== 0)
        ),
      };

      // The broken rung has to stay strictly below the destroyed one. Equal or
      // above deletes the broken state entirely, which renders perfectly and
      // means a shield goes straight from working to gone.
      if (config.broken >= config.destroyed) config.broken = config.destroyed - 1;

      try {
        await game.settings.set(SUITE_ID, SETTINGS.dentsConfig, config);
      } catch (error) {
        warn("pf2e-variant-rules | could not save the dent configuration", error);
      }
    }

    async _onReset() {
      try {
        await game.settings.set(SUITE_ID, SETTINGS.dentsConfig, foundry.utils.deepClone(DEFAULT_DENT_CONFIG));
      } catch (error) {
        warn("pf2e-variant-rules | could not reset the dent configuration", error);
      }
      await this.render();
    }
  };

  return _app;
}
