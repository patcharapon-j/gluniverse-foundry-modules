/**
 * The GM's "Spotlight a roll" builder.
 *
 * Rollers come from the selected tokens (and can be added to or struck off);
 * a targeted token makes the check opposed against one of its statistic DCs.
 * Layout is derived, never chosen: one roller and a defender is a face-off,
 * several rollers are a colonnade, one roller alone is the hero shot.
 *
 * Built in a memoised factory, not at module scope: `foundry` does not exist
 * under the check tool.
 */
import { SUITE_ID } from "../../core/const.mjs";
import { CHECK_KINDS, AUDIENCES, DC_MODES, FORTUNE, SAVES, MAX_ROLLERS } from "./constants.mjs";
import { formulaDice } from "./request-model.mjs";

let _app = null;
let _open = null;

const L = (k) => game.i18n.localize(k);

function skillChoices(actors) {
  const out = Object.entries(CONFIG.PF2E?.skills ?? {}).map(([slug, v]) => ({ slug, label: L(v?.label ?? v) }));
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

function loreChoices(actors) {
  const seen = new Map();
  for (const a of actors) {
    for (const [slug, stat] of Object.entries(a.skills ?? {})) if (stat?.lore) seen.set(slug, stat.label);
  }
  return [...seen].map(([slug, label]) => ({ slug, label })).sort((a, b) => a.label.localeCompare(b.label));
}

function defenderChoices(actor) {
  const list = SAVES.map((slug) => ({ slug, label: actor?.saves?.[slug]?.label ?? slug }));
  list.push({ slug: "perception", label: actor?.perception?.label ?? L("PF2E.PerceptionLabel") });
  for (const [slug, stat] of Object.entries(actor?.skills ?? {})) list.push({ slug, label: stat.label });
  return list;
}

const tokensOf = (list) => list.filter((t) => t?.actor).slice(0, MAX_ROLLERS);

export const RequestApp = {
  open({ conductor }) {
    const App = factory();
    if (_open?.rendered) { _open.bringToFront?.(); return _open; }
    _open = new App({ conductor });
    _open.render({ force: true });
    return _open;
  },
};

function factory() {
  if (_app) return _app;
  const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

  _app = class SpotlightRequestApp extends HandlebarsApplicationMixin(ApplicationV2) {
    static DEFAULT_OPTIONS = {
      id: "glsr-request",
      classes: ["glsr-app"],
      tag: "form",
      window: { title: "GLSR.app.title", icon: "fa-solid fa-dice-d20", resizable: true },
      position: { width: 460, height: "auto" },
      form: { handler: SpotlightRequestApp.#submit, submitOnChange: false, closeOnSubmit: true },
      actions: {
        addSelected: SpotlightRequestApp.prototype._addSelected,
        addParty: SpotlightRequestApp.prototype._addParty,
        removeRoller: SpotlightRequestApp.prototype._removeRoller,
        clearDefender: SpotlightRequestApp.prototype._clearDefender,
      },
    };

    static PARTS = { main: { template: `modules/${SUITE_ID}/templates/spotlight-roll/request.hbs` } };

    constructor({ conductor, ...options } = {}) {
      super(options);
      this.conductor = conductor;
      this.rollers = tokensOf(canvas?.tokens?.controlled ?? []).map((t) => ({ actor: t.actor, token: t }));
      const target = game.user.targets?.first?.();
      this.defender = target?.actor && !this.rollers.some((r) => r.actor === target.actor) ? { actor: target.actor, token: target } : null;
      this.form = { kind: "skill", slug: "athletics", formula: "1d20", title: "", dc: "", dcMode: "hidden", audience: "all", fortune: "none", bonus: 0, statistic: "fortitude" };
    }

    async _prepareContext(options) {
      const ctx = await super._prepareContext(options);
      const actors = this.rollers.map((r) => r.actor);
      const f = this.form;
      return {
        ...ctx,
        f,
        rollers: this.rollers.map((r, i) => ({ i, name: r.token?.name ?? r.actor.name, img: r.actor.img })),
        canAdd: this.rollers.length < MAX_ROLLERS,
        kinds: CHECK_KINDS.map((k) => ({ k, label: L(`GLSR.app.kind.${k}`), sel: f.kind === k })),
        slugs: (f.kind === "skill" ? skillChoices(actors) : f.kind === "lore" ? loreChoices(actors) : f.kind === "save" ? SAVES.map((slug) => ({ slug, label: L(`GLSR.app.save.${slug}`) })) : [])
          .map((o) => ({ ...o, sel: o.slug === f.slug })),
        needsSlug: ["skill", "lore", "save"].includes(f.kind),
        isFormula: f.kind === "formula",
        defender: this.defender ? { name: this.defender.token?.name ?? this.defender.actor.name, img: this.defender.actor.img } : null,
        defenderStats: this.defender ? defenderChoices(this.defender.actor).map((o) => ({ ...o, sel: o.slug === f.statistic })) : [],
        dcModes: DC_MODES.map((m) => ({ m, label: L(`GLSR.app.dcMode.${m}`), sel: f.dcMode === m })),
        audiences: AUDIENCES.map((a) => ({ a, label: L(`GLSR.app.audience.${a}`), sel: f.audience === a })),
        fortunes: FORTUNE.map((v) => ({ v, label: L(`GLSR.app.fortune.${v}`), sel: f.fortune === v })),
      };
    }

    _onRender(context, options) {
      super._onRender?.(context, options);
      if (this._bound) return;
      this._bound = true;
      // Keep the form state as the GM edits, so re-renders (adding a roller,
      // switching the kind) never lose what was typed.
      this.element.addEventListener("change", (e) => {
        const el = e.target;
        if (!el.name) return;
        this.form[el.name] = el.value;
        if (el.name === "kind") {
          this.form.slug = el.value === "save" ? "fortitude" : el.value === "skill" ? "athletics" : "";
          this.render();
        }
      });
    }

    _addSelected() {
      for (const t of canvas?.tokens?.controlled ?? []) {
        if (!t.actor || this.rollers.length >= MAX_ROLLERS || this.rollers.some((r) => r.token === t)) continue;
        this.rollers.push({ actor: t.actor, token: t });
      }
      this.render();
    }

    _addParty() {
      const party = game.actors.party?.members ?? game.users.filter((u) => !u.isGM && u.character).map((u) => u.character);
      for (const actor of party) {
        if (!actor || this.rollers.length >= MAX_ROLLERS || this.rollers.some((r) => r.actor === actor)) continue;
        this.rollers.push({ actor, token: actor.getActiveTokens?.()[0] ?? null });
      }
      this.render();
    }

    _removeRoller(_e, target) {
      this.rollers.splice(Number(target.dataset.index), 1);
      this.render();
    }

    _clearDefender() {
      this.defender = null;
      this.render();
    }

    static async #submit(_event, _form, formData) {
      const d = formData.object;
      if (!this.rollers.length) { ui.notifications.warn(L("GLSR.warn.noRollers")); return; }
      const kind = CHECK_KINDS.includes(d.kind) ? d.kind : "skill";
      if (kind === "formula" && !formulaDice(d.formula)) { ui.notifications.warn(L("GLSR.warn.formula")); return; }
      const dc = d.dc === "" || d.dc == null ? null : Math.trunc(Number(d.dc));
      if (kind === "flat" && !Number.isFinite(dc)) { ui.notifications.warn(L("GLSR.warn.flatDc")); return; }
      const actors = this.rollers.map((r) => r.actor);
      const label = kind === "perception" ? L("GLSR.app.kind.perception")
        : kind === "flat" ? L("GLSR.app.kind.flat")
          : kind === "formula" ? String(d.formula)
            : kind === "save" ? L(`GLSR.app.save.${d.slug}`)
              : (actors[0]?.skills?.[d.slug]?.label ?? d.slug);
      const defender = this.defender && this.rollers.length === 1 ? { ...this.defender, statistic: d.statistic || "fortitude" } : null;
      const spec = {
        layout: this.rollers.length > 1 ? "group" : defender ? "opposed" : "single",
        check: { kind, slug: kind === "perception" ? "perception" : d.slug ?? "", label, formula: kind === "formula" ? String(d.formula) : null, traits: [] },
        title: String(d.title ?? "").trim(),
        dc: { value: Number.isFinite(dc) ? dc : null, mode: DC_MODES.includes(d.dcMode) ? d.dcMode : "shown" },
        audience: AUDIENCES.includes(d.audience) ? d.audience : "all",
        fortune: FORTUNE.includes(d.fortune) ? d.fortune : "none",
        bonus: Math.trunc(Number(d.bonus) || 0),
        rollers: this.rollers,
        defender,
      };
      try {
        await this.conductor.open(spec);
      } catch (e) {
        ui.notifications.error(e.message);
      }
    }
  };
  return _app;
}
