/**
 * GLUniverse Suite — Recall Knowledge: the Control panel.
 *
 * One app, two tabs. It opens on Read when a ladder exists and on Generate when
 * it does not, because those are the two moments the GM actually has: at the
 * table with a band to resolve, or in prep with a blank subject.
 *
 * GM-only by design for v1. Nothing here posts to chat: the GM reads the tier
 * and narrates it in their own voice, which is the whole point — auto-delivery
 * turns lore into a loot drop.
 */

import { SUITE_ID } from "../../core/const.mjs";
import { escapeHTML } from "../../core/util.mjs";
import { FEATURE_ID, SUBJECT_TYPES } from "./constants.mjs";
import { subjectBrief } from "./extract.mjs";
import { buildPayload } from "./prompt.mjs";
import { parseLadder } from "./parse.mjs";
import {
  cacheMistakenIdentity,
  cachedMistakenIdentity,
  pickMistakenIdentity,
} from "./mistaken.mjs";
import {
  clearLadder,
  readContext,
  readLadder,
  readSeed,
  writeContext,
  writeLadder,
} from "./store.mjs";
import { BAND_ORDER, bandLabel, resolveReveal, revealMatrix } from "./reveal.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const L = (k, d) => {
  const s = game.i18n.localize(k);
  return s === k ? (d ?? k) : s;
};

/**
 * Candidate pool for mistaken identity: world NPCs only.
 *
 * Compendium indexes do not carry creature traits without a full load, and
 * loading a bestiary pack to answer one failed roll is not a trade worth
 * making. A world with imported bestiary actors gives a good pool; a thin one
 * yields "nothing comes to mind", which critical failure explicitly permits.
 */
function candidatePool(target) {
  return game.actors.filter((a) => a.type === "npc" && a.id !== target?.id);
}

export class RecallApp extends HandlebarsApplicationMixin(ApplicationV2) {
  /** One app per document, so two open sheets do not fight over one instance. */
  static _instances = new Map();

  static async show(doc) {
    if (!game.user.isGM || !doc) return null;
    if (!SUBJECT_TYPES.includes(doc.documentName)) return null;
    const key = doc.uuid;
    let app = this._instances.get(key);
    if (!app) {
      // The id must be unique per subject or Foundry reuses one window for two
      // documents. It is passed as an option rather than overridden via a
      // getter, because ApplicationV2 resolves the id during initialization.
      app = new this({ document: doc, id: `glrk-app-${key.replace(/[^A-Za-z0-9]+/g, "-")}` });
      this._instances.set(key, app);
    }
    await app.render(true);
    return app;
  }

  constructor(options = {}) {
    super(options);
    this.document = options.document;
    this.tab = readLadder(this.document) ? "read" : "generate";
    this.band = null;
  }

  static DEFAULT_OPTIONS = {
    id: "glrk-app",
    classes: ["glrk", "gl-glass", "gl-type"],
    tag: "div",
    window: { title: "GLRK.app.title", icon: "fa-solid fa-book-open-reader", resizable: true },
    position: { width: 560, height: 640 },
    actions: {
      setTab: RecallApp.prototype._onSetTab,
      setBand: RecallApp.prototype._onSetBand,
      copyPayload: RecallApp.prototype._onCopyPayload,
      importLadder: RecallApp.prototype._onImportLadder,
      clearLadder: RecallApp.prototype._onClearLadder,
    },
  };

  static PARTS = {
    main: { template: `modules/${SUITE_ID}/templates/pf2e-recall/app.hbs` },
  };

  get title() {
    return `${L("GLRK.app.title", "Recall Knowledge")} — ${this.document?.name ?? ""}`;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const doc = this.document;
    const ladder = readLadder(doc);
    const mistakenName = this._mistakenName(ladder);

    return Object.assign(context, {
      docName: doc?.name ?? "",
      docType: doc?.documentName ?? "",
      hasLadder: !!ladder,
      tab: this.tab,
      isRead: this.tab === "read",
      contextText: readContext(doc),
      seedCount: readSeed(doc).length,
      bands: BAND_ORDER.map((key) => ({
        key,
        label: bandLabel(key),
        active: key === this.band,
      })),
      reveal: this.band ? resolveReveal(ladder, this.band, { mistakenName }) : null,
      matrix: this.band ? null : revealMatrix(ladder, { mistakenName }),
      generatedAt: ladder?.generatedAt
        ? new Date(ladder.generatedAt).toLocaleString()
        : null,
    });
  }

  /** Resolve (and cache) the fallback wrong answer, only when one is needed. */
  _mistakenName(ladder) {
    const doc = this.document;
    if (!game.settings.get(SUITE_ID, "rk.mistakenIdentity")) return null;
    if (doc?.documentName !== "Actor" || ladder?.misremembered) return null;
    const cached = cachedMistakenIdentity(doc);
    if (cached?.name) return cached.name;
    const pick = pickMistakenIdentity(doc, candidatePool(doc));
    if (pick) {
      // Fire-and-forget: the name is already in hand for this render.
      cacheMistakenIdentity(doc, pick).catch(() => {});
      return pick.name;
    }
    return null;
  }

  /* ------------------------------------------------ actions ------------ */

  async _onSetTab(event, target) {
    this.tab = target.dataset.tab === "read" ? "read" : "generate";
    this.render();
  }

  async _onSetBand(event, target) {
    const key = target.dataset.band;
    this.band = this.band === key ? null : key;
    this.render();
  }

  async _onCopyPayload() {
    const doc = this.document;
    const brief = subjectBrief(doc);
    if (!brief) {
      ui.notifications.warn(L("GLRK.notify.unsupported", "That document type cannot be summarised."));
      return;
    }

    const contextText = this.element.querySelector("[name=glrk-context]")?.value ?? "";
    await writeContext(doc, contextText);

    const extras = [];
    for (const box of this.element.querySelectorAll("[name=glrk-extra]:checked")) {
      const block = await this._renderExtra(box.value);
      if (block) extras.push(block);
    }

    const payload = buildPayload(brief, {
      context: contextText,
      extras,
      seed: readSeed(doc),
    });

    try {
      await navigator.clipboard.writeText(payload);
      ui.notifications.info(
        game.i18n.format("GLRK.notify.copied", { chars: payload.length })
      );
    } catch {
      // Clipboard access can be refused (insecure origin, denied permission).
      // Falling back to a selectable textarea beats losing the payload.
      const box = this.element.querySelector("[name=glrk-paste]");
      if (box) {
        box.value = payload;
        box.select();
      }
      ui.notifications.warn(L("GLRK.notify.copyFailed", "Clipboard blocked — payload placed in the paste box; copy it manually."));
    }
  }

  /** Render one opted-in extra context block. */
  async _renderExtra(kind) {
    const doc = this.document;
    if (kind === "folder" && doc.folder) {
      const siblings = doc.folder.contents
        .filter((d) => d.id !== doc.id)
        .map((d) => `- ${d.name}`)
        .slice(0, 40);
      if (!siblings.length) return null;
      return `## Also in the folder "${doc.folder.name}"\n${siblings.join("\n")}`;
    }
    if (kind === "scene" && game.scenes.current) {
      return `## Current scene\n${game.scenes.current.name}`;
    }
    return null;
  }

  async _onImportLadder() {
    const box = this.element.querySelector("[name=glrk-paste]");
    const raw = box?.value ?? "";
    if (!raw.trim()) {
      ui.notifications.warn(L("GLRK.notify.pasteEmpty", "Paste the reply first."));
      return;
    }

    const result = parseLadder(raw);
    if (!result.ok) {
      ui.notifications.error(
        `${L("GLRK.notify.parseFailed", "Could not read that as a ladder.")} ${result.errors
          .map((e) => L(e, e))
          .join(" ")}`
      );
      return;
    }

    if (readLadder(this.document)) {
      const proceed = await foundry.applications.api.DialogV2.confirm({
        window: { title: L("GLRK.confirm.overwrite.title", "Replace the existing ladder?") },
        content: `<p>${escapeHTML(
          L("GLRK.confirm.overwrite.body", "This subject already has a ladder. Replacing it cannot be undone.")
        )}</p>`,
      });
      if (!proceed) return;
    }

    await writeLadder(this.document, { ...result, name: result.name || this.document.name });
    for (const warning of result.warnings) ui.notifications.warn(L(warning, warning));
    if (box) box.value = "";
    this.tab = "read";
    this.render();
    ui.notifications.info(L("GLRK.notify.imported", "Ladder stored."));
  }

  async _onClearLadder() {
    const proceed = await foundry.applications.api.DialogV2.confirm({
      window: { title: L("GLRK.confirm.clear.title", "Delete this ladder?") },
      content: `<p>${escapeHTML(L("GLRK.confirm.clear.body", "The stored lore for this subject will be removed."))}</p>`,
    });
    if (!proceed) return;
    await clearLadder(this.document);
    this.tab = "generate";
    this.render();
  }

  _onClose(options) {
    RecallApp._instances.delete(this.document?.uuid);
    return super._onClose?.(options);
  }
}

export const FEATURE = FEATURE_ID;
