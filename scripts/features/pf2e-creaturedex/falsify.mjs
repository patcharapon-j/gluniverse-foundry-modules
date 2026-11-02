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
 * this creature's name. Fast, and the lie is a *real* stat block, so its
 * numbers agree with each other because they were always somebody's numbers.
 *
 * **Doctor** perturbs this creature's own section. Bounded drift, never zero,
 * and it will not touch immunities in either direction; see `doctorSection`.
 *
 * Either way the draft sits **row by row beside the truth** and is editable
 * before it is sent. A GM who can see exactly what changed is a GM who catches
 * the lie that is accidentally lethal, and no automatic pass is good enough to
 * skip that step. Sending posts the same notice a true reveal posts.
 *
 * The class is built in a memoised factory rather than at module scope:
 * `foundry.applications` does not exist under plain Node, and this module is
 * reached transitively by the check tool.
 */

import { SETTINGS } from "./constants.mjs";
import { falsifyModel, harvestDraft } from "./model.mjs";
import { afterHandover } from "./notice.mjs";
import { falsifyHTML } from "./render.mjs";
import { doctorSection } from "./rules.mjs";
import { buildSections } from "./sections.mjs";
import { get, revealFalse } from "./store.mjs";

const t = (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key));

let _app = null;

export function FalsifyApp() {
  if (_app) return _app;
  const { ApplicationV2 } = foundry.applications.api;

  _app = class FalsifyApp extends ApplicationV2 {
    static DEFAULT_OPTIONS = {
      id: "gldex-falsify",
      classes: ["gldex", "gldex-falsify-app"],
      tag: "div",
      window: { title: "GLDEX.falsify.title", icon: "fa-solid fa-mask", resizable: true },
      position: { width: 600, height: "auto" },
      actions: {
        generate: FalsifyApp.prototype._onGenerate,
        setMode: FalsifyApp.prototype._onSetMode,
        send: FalsifyApp.prototype._onSend,
      },
    };

    #ctx = null;
    #mode = "borrow";
    #sourceId = null;
    #draft = null;

    constructor(options = {}) {
      super(options);
      this.#ctx = options.ctx ?? null;
      // With nothing to borrow from, doctoring is the only road.
      if (!this.candidates.length && this.#ctx?.truth) this.#mode = "doctor";
    }

    /** Point a reused dialog at a different section, starting over. */
    retarget(ctx) {
      this.#ctx = ctx;
      this.#draft = null;
      this.#mode = !this.candidates.length && ctx?.truth ? "doctor" : "borrow";
    }

    /** Creatures whose matching section could stand in for this one. */
    get candidates() {
      const want = this.#ctx?.kind === "hazard" ? "hazard" : "npc";
      return (game.actors ?? [])
        .filter((a) => a.type === want && a.id !== this.#ctx?.actorId)
        .map((a) => ({ id: a.id, name: a.name, level: a.system?.details?.level?.value ?? null }))
        .sort((a, b) => a.name.localeCompare(b.name));
    }

    async _prepareContext() {
      const candidates = this.candidates;
      if (!candidates.some((c) => c.id === this.#sourceId)) this.#sourceId = candidates[0]?.id ?? null;
      return falsifyModel({
        ctx: this.#ctx ?? {},
        mode: this.#mode,
        candidates,
        sourceId: this.#sourceId,
        draft: this.#draft,
        truth: this.#ctx?.truth ?? null,
        iwr: !!get(SETTINGS.doctorIwr, false),
      });
    }

    async _renderHTML(context) {
      return falsifyHTML(context, { t });
    }

    _replaceHTML(result, content) {
      content.innerHTML = result;
    }

    _onRender(context, options) {
      super._onRender?.(context, options);
      const root = this.element;
      root?.querySelector("select[name='source']")?.addEventListener("change", (ev) => {
        this.#sourceId = ev.currentTarget.value;
      });
      // Mark what differs from the truth as the GM types, without a re-render.
      for (const input of root?.querySelectorAll("[data-row-key]") ?? []) {
        input.addEventListener("input", () => this.#recount());
      }
    }

    #recount() {
      const inputs = [...(this.element?.querySelectorAll("[data-row-key]") ?? [])];
      let changed = 0;
      for (const input of inputs) {
        const differs = input.value.replace(/\s+/g, " ").trim() !== (input.dataset.truth ?? "");
        input.closest(".gldex-lie-row")?.classList.toggle("is-changed", differs);
        if (differs) changed += 1;
      }
      const diff = this.element?.querySelector(".gldex-lie-diff");
      if (diff) diff.textContent = t("GLDEX.falsify.changed", { n: changed, total: inputs.length });
    }

    async _onSetMode(event, target) {
      const next = target?.dataset?.mode === "doctor" ? "doctor" : "borrow";
      if (next === this.#mode) return;
      this.#mode = next;
      this.#draft = null;
      await this.render();
    }

    /** Build a fresh lie. Pressing this again genuinely rerolls it. */
    async _onGenerate() {
      if (this.#mode === "doctor") {
        const truth = this.#ctx?.truth ?? null;
        if (!truth) {
          ui.notifications?.warn(t("GLDEX.falsify.noTruth"));
          return;
        }
        this.#draft = doctorSection(truth, { iwr: !!get(SETTINGS.doctorIwr, false) });
      } else {
        const source = game.actors?.get(this.#sourceId) ?? null;
        const found = source ? buildSections(source).sections.find((s) => s.key === this.#ctx?.section) : null;
        if (!found) {
          ui.notifications?.warn(t("GLDEX.falsify.noSection", { name: source?.name ?? "" }));
          return;
        }
        this.#draft = JSON.parse(JSON.stringify(found));
      }
      await this.render();
    }

    async _onSend() {
      if (!game.user.isGM || !this.#draft || !this.#ctx) return;
      const edits = {};
      for (const input of this.element?.querySelectorAll("[data-row-key]") ?? []) edits[input.dataset.rowKey] = input.value;
      const snapshot = harvestDraft(this.#draft, edits);
      const ctx = this.#ctx;
      const source = this.#mode === "borrow" ? (game.actors?.get(this.#sourceId)?.uuid ?? null) : null;
      const wrote = await revealFalse(ctx.dexKey, ctx.owners, ctx.section, snapshot, source, ctx.meta ?? null);
      if (!wrote) {
        ui.notifications?.warn(t("GLDEX.falsify.refused", { section: t(`GLDEX.section.${ctx.section}`) }));
        return;
      }
      await this.close();
      const owners = (ctx.owners ?? []).map((id) => game.actors?.get(id)).filter(Boolean);
      await afterHandover({ subject: ctx.dexKey, section: ctx.section, owners, everyone: !!ctx.everyone });
    }

    /**
     * `new this(...)`, never `new (FalsifyApp())(...)`: inside a named class
     * expression the class's own binding shadows the outer factory.
     *
     * One dialog at a time. A second Falsify reuses the open one rather than
     * mounting a second window under the same id, which would orphan the first.
     */
    static open(ctx) {
      const existing = foundry.applications.instances.get("gldex-falsify");
      if (existing instanceof this) {
        existing.retarget(ctx);
        return existing.render({ force: true });
      }
      return new this({ ctx }).render({ force: true });
    }
  };

  return _app;
}

/** Open the authoring dialog for one section of one subject. */
export const openFalsify = (ctx) => FalsifyApp().open(ctx);
