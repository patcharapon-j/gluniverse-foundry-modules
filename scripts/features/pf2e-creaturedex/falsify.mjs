/**
 * Creaturedexing — authoring a lie.
 *
 *   "On a critical failure … the GM also reveals an incorrect stat block for
 *    the creature or hazard of your choice (either by modifying the existing
 *    stat block or giving one for another creature)."
 *
 * The book names both methods and this dialog is both of them:
 *
 * **Borrow** takes another creature's corresponding section and files it under
 * this creature's name. It is fast, and the lie is a *real* stat block, so it
 * is internally coherent in a way no generated one can be — the numbers agree
 * with each other because they were always somebody's numbers.
 *
 * **Doctor** perturbs this creature's own section. Bounded drift, and it will
 * not touch immunities in either direction; see `doctorSection`.
 *
 * Either way the result is **editable before it is sent**. A GM who can see the
 * lie about to land is a GM who can catch the one that is accidentally lethal,
 * and no automatic pass is good enough to skip that step.
 *
 * The class is built in a memoised factory rather than at module scope:
 * `foundry.applications` does not exist under plain Node, and this module is
 * reached transitively by the check tool.
 */

import { SUITE_ID } from "../../core/const.mjs";
import { doctorSection } from "./rules.mjs";
import { SETTINGS } from "./constants.mjs";
import { buildSections } from "./sections.mjs";
import { get, revealFalse } from "./store.mjs";

const L = (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key));

let _app = null;

export function FalsifyApp() {
  if (_app) return _app;
  const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

  _app = class FalsifyApp extends HandlebarsApplicationMixin(ApplicationV2) {
    static DEFAULT_OPTIONS = {
      id: "gldex-falsify",
      classes: ["gldex", "gldex-falsify-app"],
      tag: "div",
      window: { title: "GLDEX.falsify.title", icon: "fa-solid fa-mask", resizable: true },
      position: { width: 560, height: 640 },
      actions: {
        generate: FalsifyApp.prototype._onGenerate,
        setMode: FalsifyApp.prototype._onSetMode,
        send: FalsifyApp.prototype._onSend,
      },
    };

    static PARTS = { main: { template: `modules/${SUITE_ID}/templates/pf2e-creaturedex/falsify.hbs` } };

    #ctx = null;
    #mode = "borrow";
    #sourceId = null;
    #draft = null;

    constructor(options = {}) {
      super(options);
      this.#ctx = options.ctx ?? null;
    }

    /** Creatures whose matching section could stand in for this one. */
    get candidates() {
      const kind = this.#ctx?.kind ?? "creature";
      const want = kind === "hazard" ? "hazard" : "npc";
      return (game.actors ?? [])
        .filter((a) => a.type === want && a.id !== this.#ctx?.actorId)
        .map((a) => ({ id: a.id, name: a.name, level: a.system?.details?.level?.value ?? null }))
        .sort((a, b) => a.name.localeCompare(b.name));
    }

    async _prepareContext(options) {
      const context = await super._prepareContext(options);
      const candidates = this.candidates;
      if (!this.#sourceId && candidates.length) this.#sourceId = candidates[0].id;
      return {
        ...context,
        subjectName: this.#ctx?.name ?? "",
        sectionLabel: L(`GLDEX.section.${this.#ctx?.section}`),
        borrow: this.#mode === "borrow",
        doctor: this.#mode === "doctor",
        iwr: !!get(SETTINGS.doctorIwr, false),
        candidates: candidates.map((c) => ({ ...c, selected: c.id === this.#sourceId })),
        // Labels are precomputed: this repo ships no `concat` helper, and a missing
        // subexpression helper throws inside the render and takes the window down.
        rows: (this.#draft?.rows ?? []).map((r) => ({ ...r, label: L(`GLDEX.row.${r.key}`) })),
        extras: this.#extras(),
        ready: !!this.#draft,
      };
    }

    /**
     * What the lie carries beyond its editable rows.
     *
     * Strikes, spells and abilities come through as generated and are not
     * offered as text inputs — a stat block's prose is not something anyone
     * rewrites in a dialog while four players wait. Naming them keeps the GM
     * from believing the rows are the whole lie.
     */
    #extras() {
      const d = this.#draft;
      if (!d) return [];
      const out = [];
      const melee = d.strikes?.melee?.length ?? 0;
      const ranged = d.strikes?.ranged?.length ?? 0;
      if (melee + ranged) out.push(L("GLDEX.falsify.extraStrikes", { n: melee + ranged }));
      if (d.spells?.length) out.push(L("GLDEX.falsify.extraSpells", { n: d.spells.length }));
      if (d.abilities?.length) out.push(L("GLDEX.falsify.extraAbilities", { n: d.abilities.length }));
      return out;
    }

    async _onSetMode(event, target) {
      this.#mode = target?.dataset?.mode === "doctor" ? "doctor" : "borrow";
      this.#draft = null;
      await this.render();
    }

    /** Build a fresh lie. Pressing this again genuinely rerolls it. */
    async _onGenerate() {
      const select = this.element?.querySelector("[name='source']");
      if (select) this.#sourceId = select.value;

      if (this.#mode === "doctor") {
        const truth = this.#ctx?.truth ?? null;
        if (!truth) {
          ui.notifications?.warn(L("GLDEX.falsify.noTruth"));
          return;
        }
        this.#draft = doctorSection(truth, { iwr: !!get(SETTINGS.doctorIwr, false) });
      } else {
        const source = game.actors?.get(this.#sourceId) ?? null;
        const found = source ? buildSections(source).sections.find((s) => s.key === this.#ctx?.section) : null;
        if (!found) {
          ui.notifications?.warn(L("GLDEX.falsify.noSection", { name: source?.name ?? "" }));
          return;
        }
        this.#draft = foundry.utils.deepClone(found);
      }
      await this.render();
    }

    /** Read the GM's edits back off the form before anything is written. */
    #harvest() {
      if (!this.#draft) return null;
      const out = foundry.utils.deepClone(this.#draft);
      for (const input of this.element?.querySelectorAll("[data-row-key]") ?? []) {
        const row = out.rows?.find((r) => r.key === input.dataset.rowKey);
        if (row) row.value = input.value;
      }
      return out;
    }

    async _onSend() {
      const snapshot = this.#harvest();
      if (!snapshot || !this.#ctx) return;
      const source = this.#mode === "borrow" ? (game.actors?.get(this.#sourceId)?.uuid ?? null) : null;
      await revealFalse(this.#ctx.dexKey, this.#ctx.owners, this.#ctx.section, snapshot, source, this.#ctx.meta ?? null);
      this.#ctx.onDone?.();
      await this.close();
    }

    /**
     * `new this(...)`, never `new (FalsifyApp())(...)`.
     *
     * Inside a named class expression the class's own binding shadows the outer
     * factory of the same name, so `FalsifyApp()` here would call the class
     * without `new` and throw.
     */
    static open(ctx) {
      return new this({ ctx }).render(true);
    }
  };

  return _app;
}

/** Open the authoring dialog for one section of one subject. */
export const openFalsify = (ctx) => FalsifyApp().open(ctx);
