/**
 * GLUniverse Suite — Reflavor: the dialog.
 *
 * Right-click an actor (world or compendium) → pick a rung → describe what you
 * want it to become → copy a self-contained payload → paste it into any Claude
 * chat → paste the reply back into the importer.
 *
 * Nothing here calls a model and nothing imports automatically. The GM reviews
 * what came back, in the importer's own preview, exactly as they would for a
 * hand-written stat block. See docs/REFLAVOR.md.
 */

import { escapeHTML as escapeHtml } from "../../core/util.mjs";
import { exportActorToMarkdown, openImporterForReflavor, resolveDirectoryDocument } from "./importer.js";
import { buildReflavorPayload, rungByKey, rungsFor } from "./reflavor-prompt.js";

const MODULE_ID = "gluniverse-foundry-modules";
const PREFIX = "sbi.";
/** {context, rung, level} — the GM's intent, so redoing one is not retyping it. */
const FLAG_REFLAVOR = `${PREFIX}reflavor`;

const SUBJECT_TYPES = ["npc", "hazard"];

const L = (key, fallback) => {
  const s = game.i18n.localize(key);
  return s === key ? (fallback ?? key) : s;
};

/** Head statistics the benchmark block reads. Null means "no row for this". */
function headStats(actor) {
  const system = actor.system ?? {};
  const strikes = actor.items.filter((item) => item.type === "melee");
  const bonuses = strikes
    .map((item) => Number(item.system?.bonus?.value))
    .filter((n) => Number.isFinite(n));
  const dcs = actor.items
    .filter((item) => item.type === "spellcastingEntry")
    .map((entry) => Number(entry.system?.spelldc?.dc))
    .filter((n) => Number.isFinite(n));
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
  return {
    ac: num(system.attributes?.ac?.value),
    fortitude: num(system.saves?.fortitude?.value),
    reflex: num(system.saves?.reflex?.value),
    will: num(system.saves?.will?.value),
    perception: num(system.perception?.mod),
    // The best strike is the one a tier reads from; a creature's weakest strike
    // is often deliberately off-tier and would misclassify the whole creature.
    strikeBonus: bonuses.length ? Math.max(...bonuses) : null,
    hasStrikes: strikes.length > 0,
    spellDC: dcs.length ? Math.max(...dcs) : null,
  };
}

const readState = (actor) => {
  const stored = actor?.getFlag?.(MODULE_ID, FLAG_REFLAVOR);
  return {
    context: typeof stored?.context === "string" ? stored.context : "",
    rung: typeof stored?.rung === "string" ? stored.rung : "reskin",
    level: Number.isFinite(Number(stored?.level)) ? Number(stored.level) : null,
  };
};

/**
 * Persist the GM's intent — world actors only.
 *
 * A compendium source is usually a locked bestiary pack, and writing a GM's
 * private prep into a shared pack would be wrong even when it is unlocked. The
 * cost is that reflavouring the same compendium entry twice means retyping the
 * concept; that is the better half of the trade.
 */
async function writeState(actor, state) {
  if (!actor || actor.pack) return;
  try {
    await actor.setFlag(MODULE_ID, FLAG_REFLAVOR, state);
  } catch (error) {
    console.warn("GLUniverse Suite | reflavor state not saved:", error);
  }
}

export class ReflavorApp extends foundry.applications.api.ApplicationV2 {
  /** One window per subject, so two open sources cannot fight over one app. */
  static _instances = new Map();

  static async show(actor) {
    if (!game.user.isGM || !actor) return null;
    if (!SUBJECT_TYPES.includes(actor.type)) {
      ui.notifications.warn(L("GLSBI.reflavor.notify.targetTypeOnly", "Reflavor works on NPC and hazard actors."));
      return null;
    }
    const key = actor.uuid;
    let app = this._instances.get(key);
    if (!app) {
      // The id must be unique per subject, and ApplicationV2 resolves it during
      // initialization — so it is passed as an option, not overridden by getter.
      app = new this({ actor, id: `gluni-reflavor-${key.replace(/[^A-Za-z0-9]+/g, "-")}` });
      this._instances.set(key, app);
    }
    await app.render({ force: true });
    return app;
  }

  constructor(options = {}) {
    super(options);
    this.actor = options.actor;
    const state = readState(this.actor);
    this.rung = state.rung;
    this.concept = state.context;
    this.targetLevel = state.level ?? (this.actor?.system?.details?.level?.value ?? 1);
  }

  static DEFAULT_OPTIONS = {
    // Frame classes stay feature-prefixed, and carry no utility that declares
    // `position`: Foundry sets `.application { position: absolute }` inside
    // `@layer applications`, and this suite's sheets are unlayered, so an
    // unlayered `position: relative` would win outright and drop the window
    // into normal document flow. The glass treatment lives on `.gluni-reflavor`
    // inside `.window-content`.
    id: "gluni-reflavor",
    classes: ["gluni-reflavor-frame"],
    tag: "div",
    window: {
      title: "GLSBI.reflavor.window.title",
      icon: "fa-solid fa-masks-theater",
      resizable: true,
    },
    position: { width: 620, height: 700 },
  };

  get title() {
    return `${L("GLSBI.reflavor.window.title", "Reflavor")} — ${this.actor?.name ?? ""}`;
  }

  onClose() {
    ReflavorApp._instances.delete(this.actor?.uuid);
  }

  async close(options) {
    this.onClose();
    return super.close(options);
  }

  async _renderHTML() {
    const element = document.createElement("div");
    element.className = "gluni-reflavor";
    element.innerHTML = this.#renderAppHtml();
    return element;
  }

  _replaceHTML(result, element) {
    element.replaceChildren(result);
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    const root = this.element;
    root.querySelector("select[name='rung']")?.addEventListener("change", (event) => {
      this.rung = event.currentTarget.value;
      this.render();
    });
    root.querySelector("textarea[name='concept']")?.addEventListener("input", (event) => {
      this.concept = event.currentTarget.value;
    });
    root.querySelector("input[name='targetLevel']")?.addEventListener("input", (event) => {
      this.targetLevel = Number(event.currentTarget.value);
    });
    root.querySelector("button[data-action='copy']")?.addEventListener("click", () => this.#copyPayload());
    root.querySelector("button[data-action='openImporter']")?.addEventListener("click", () => this.#openImporter());
  }

  #renderAppHtml() {
    const actor = this.actor;
    const t = (key, fallback) => escapeHtml(L(key, fallback));
    const rungs = rungsFor(actor.type);
    const active = rungByKey(this.rung) ?? rungs[0];
    const isRetune = active.order >= 4;
    const level = actor.system?.details?.level?.value ?? 1;

    const options = rungs
      .map(
        (r) =>
          `<option value="${escapeHtml(r.key)}" ${r.key === active.key ? "selected" : ""}>${escapeHtml(
            L(`GLSBI.reflavor.rung.${r.key}`, r.summary)
          )}</option>`
      )
      .join("");

    const hazardNote =
      actor.type === "hazard"
        ? `<p class="gluni-reflavor-note"><i class="fa-solid fa-circle-info"></i> ${t(
            "GLSBI.reflavor.hint.hazardRungs",
            "Retune is unavailable for hazards: the Building Creatures hazard tables are not carried by this module, so there is nothing to retune against."
          )}</p>`
        : "";

    return `
      <header class="gluni-reflavor-header">
        <p class="gluni-kicker">${t("GLSBI.reflavor.kicker", "GLU·SB // REFLAVOR")}</p>
        <h1><i class="fa-solid fa-masks-theater"></i> ${escapeHtml(actor.name)}</h1>
        <p class="gluni-reflavor-subtitle">${t("GLSBI.reflavor.subtitle", "Copy a prompt, paste it into Claude, bring the answer back to the importer.")}</p>
      </header>

      <div class="gluni-reflavor-body">
        <label class="gluni-field">
          <span class="gluni-label">${t("GLSBI.reflavor.label.rung", "How much may change")}</span>
          <select name="rung">${options}</select>
        </label>

        <ul class="gluni-reflavor-rules">
          ${active.permits.map((line) => `<li class="is-allowed"><i class="fa-solid fa-check"></i> ${escapeHtml(line)}</li>`).join("")}
          ${active.freezes.map((line) => `<li class="is-frozen"><i class="fa-solid fa-lock"></i> ${escapeHtml(line)}</li>`).join("")}
        </ul>

        ${hazardNote}

        ${
          isRetune
            ? `<label class="gluni-field gluni-reflavor-level">
                 <span class="gluni-label">${t("GLSBI.reflavor.label.targetLevel", "Target level")}</span>
                 <input type="number" name="targetLevel" min="-1" max="24" step="1" value="${escapeHtml(String(this.targetLevel))}">
                 <span class="gluni-reflavor-from">${escapeHtml(game.i18n.format("GLSBI.reflavor.label.fromLevel", { level }))}</span>
               </label>`
            : ""
        }

        <label class="gluni-field gluni-field-grow">
          <span class="gluni-label">${t("GLSBI.reflavor.label.concept", "What should it become?")}${
            active.order >= 2 ? ` <em class="gluni-required">${t("GLSBI.reflavor.label.required", "required")}</em>` : ""
          }</span>
          <textarea name="concept" spellcheck="true" placeholder="${t(
            "GLSBI.reflavor.placeholder.concept",
            "A bog-cult flagellant: waterlogged, chanting, wrapped in weighted chains."
          )}">${escapeHtml(this.concept)}</textarea>
        </label>

        <div class="gluni-reflavor-actions">
          <button class="gluni-primary" type="button" data-action="copy"><i class="fa-solid fa-clipboard"></i> ${t("GLSBI.reflavor.action.copy", "Copy prompt")}</button>
          <button type="button" data-action="openImporter"><i class="fa-solid fa-file-import"></i> ${t("GLSBI.reflavor.action.openImporter", "Open importer")}</button>
        </div>

        <p class="gluni-reflavor-note">
          <i class="fa-solid fa-triangle-exclamation"></i>
          ${t(
            "GLSBI.reflavor.hint.newActor",
            "Create a new actor rather than updating this one. A reflavour usually renames abilities, and the importer matches items by name — updating in place leaves the old kit sitting beside the new one."
          )}
        </p>
        <p class="gluni-reflavor-note">
          <i class="fa-solid fa-book-open-reader"></i>
          ${t(
            "GLSBI.reflavor.hint.loreLadder",
            "A Recall Knowledge lore ladder does not travel with a reflavour: it lives on a flag the exporter cannot see. The new creature starts without one."
          )}
        </p>

        <label class="gluni-field gluni-reflavor-fallback" hidden>
          <span class="gluni-label">${t("GLSBI.reflavor.label.fallback", "Copy this manually")}</span>
          <textarea name="fallback" spellcheck="false" readonly></textarea>
        </label>
      </div>
    `;
  }

  #buildPayload() {
    const actor = this.actor;
    const spec = rungByKey(this.rung) ?? rungsFor(actor.type)[0];
    return buildReflavorPayload({
      markdown: exportActorToMarkdown(actor),
      name: actor.name,
      kind: actor.type === "hazard" ? "hazard" : "npc",
      level: actor.system?.details?.level?.value ?? 1,
      rung: spec.key,
      concept: this.concept,
      targetLevel: spec.order >= 4 ? this.targetLevel : null,
      stats: headStats(actor),
    });
  }

  async #copyPayload() {
    const spec = rungByKey(this.rung) ?? rungsFor(this.actor.type)[0];
    if (spec.order >= 2 && !this.concept.trim()) {
      ui.notifications.warn(
        L(
          "GLSBI.reflavor.notify.conceptRequired",
          "Describe what it should become. Above the first rung, a reflavour without a concept is just an unpredictable rewrite."
        )
      );
      return;
    }

    await writeState(this.actor, {
      context: this.concept,
      rung: spec.key,
      level: spec.order >= 4 ? this.targetLevel : null,
    });

    const payload = this.#buildPayload();
    try {
      await navigator.clipboard.writeText(payload);
      ui.notifications.info(
        game.i18n.format("GLSBI.reflavor.notify.copied", { chars: payload.length })
      );
    } catch {
      // Clipboard access is refused on insecure origins and by permission
      // policy. Surfacing the payload in a selectable box beats losing it.
      const field = this.element.querySelector(".gluni-reflavor-fallback");
      const box = field?.querySelector("textarea[name='fallback']");
      if (box) {
        field.hidden = false;
        box.value = payload;
        box.select();
      }
      ui.notifications.warn(
        L("GLSBI.reflavor.notify.copyFailed", "Clipboard blocked — the payload is in the box below; copy it manually.")
      );
    }
  }

  #openImporter() {
    const spec = rungByKey(this.rung) ?? rungsFor(this.actor.type)[0];
    openImporterForReflavor(this.actor, spec.key);
  }
}

/**
 * Wire the right-click entries.
 *
 * Called from the feature adapter rather than from `importer.js` so the
 * dependency runs one way only: this module imports the importer, never the
 * reverse. A cycle here would be a class-initialization hazard, not a warning.
 */
export function onReflavorInit() {
  const NAME = "GLSBI.reflavor.contextMenu.open";
  const entry = (app) => ({
    name: NAME,
    icon: '<i class="fa-solid fa-masks-theater"></i>',
    condition: () => game.user?.isGM && game.system.id === "pf2e",
    callback: (target) => {
      const li = target instanceof HTMLElement ? target : target?.[0];
      resolveDirectoryDocument(app, li).then((actor) => {
        if (!actor) {
          ui.notifications.warn(L("GLSBI.reflavor.notify.notFound", "Could not resolve that actor."));
          return;
        }
        ReflavorApp.show(actor);
      });
    },
  });
  Hooks.on("getActorContextOptions", (app, options) => {
    if (options.some((o) => o.name === NAME)) return;
    // A fresh object per menu: v14 ContextMenu writes `element` onto the entry
    // it renders and matches clicks by that identity, so one shared object
    // across the sidebar and a compendium would resolve to the wrong row.
    options.push(entry(app));
  });
}
