/**
 * GLUniverse Suite — Recall Knowledge: the Control panel.
 *
 * One app, two tabs. It opens on Read when a ladder exists and on Generate when
 * it does not, because those are the two moments the GM actually has: at the
 * table with a band to resolve, or in prep with a blank subject.
 *
 * GM-only by design. Nothing here posts to chat: the GM reads the band and
 * narrates it in their own voice, which is the whole point — auto-delivery turns
 * lore into a loot drop. The one thing that leaves this window is the paragraph
 * the GM is already reading, pushed to one player through Insight when they
 * press Send, carrying no more than they would have said out loud (share.mjs).
 */

import { SUITE_ID } from "../../core/const.mjs";
import { Suite } from "../../core/registry.mjs";
import { escapeHTML } from "../../core/util.mjs";
import { FEATURE_ID, PRESENTATIONS, SUBJECT_TYPES } from "./constants.mjs";
import { buildInsightMessage } from "./share.mjs";
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
  hasLadder,
  readContext,
  readLadder,
  readPresentation,
  readSeed,
  writeContext,
  writeLadder,
  writePresentation,
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

/** The Insight feature's id, for the enable check and its socket module path. */
const INSIGHT_ID = "insight";

/** Sentinel target: every active player at once, rather than one user id. */
const ALL_PLAYERS = "__all__";

/**
 * The journal an entry-or-page subject belongs to, and its pages.
 *
 * Both directions of the same relationship, because the picker offers both: a
 * GM who opened the whole entry wants to narrow to the page they actually
 * prepped, and one who arrived from a page wants to see the entry it sits in.
 * Returns null for every other document type, which is what hides the control.
 */
function journalScope(doc) {
  const entry =
    doc?.documentName === "JournalEntry"
      ? doc
      : doc?.documentName === "JournalEntryPage"
        ? doc.parent
        : null;
  if (!entry) return null;
  const pages = [...(entry.pages?.contents ?? entry.pages ?? [])].sort(
    (a, b) => (a.sort ?? 0) - (b.sort ?? 0)
  );
  if (!pages.length) return null;
  return { entry, pages };
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
    // Frame classes stay feature-prefixed. Never put `.gl-glass` (or any
    // utility that declares `position`) on an ApplicationV2 frame: Foundry
    // sets `.application { position: absolute }` inside `@layer applications`,
    // and the suite's sheets are unlayered, so an unlayered `position:
    // relative` wins outright and the window falls into normal document flow.
    // The glass treatment belongs on `.glrk-root`, inside `.window-content`.
    id: "glrk-app",
    classes: ["glrk", "glrk-app"],
    tag: "div",
    window: { title: "GLRK.app.title", icon: "fa-solid fa-book-open-reader", resizable: true },
    position: { width: 560, height: 640 },
    actions: {
      setTab: RecallApp.prototype._onSetTab,
      setBand: RecallApp.prototype._onSetBand,
      usePreset: RecallApp.prototype._onUsePreset,
      copyPayload: RecallApp.prototype._onCopyPayload,
      importLadder: RecallApp.prototype._onImportLadder,
      clearLadder: RecallApp.prototype._onClearLadder,
      sendInsight: RecallApp.prototype._onSendInsight,
    },
  };

  /**
   * The last player a band was sent to, shared across subjects.
   *
   * Static on purpose: a GM resolving a round of Recall Knowledge sends to the
   * same player for several creatures in a row, and re-picking them in every
   * window is the kind of friction that stops a feature being used mid-combat.
   */
  static _lastInsightTarget = null;

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
    const presentation = readPresentation(doc);

    // What the stored paragraphs were authored under, versus what the box says
    // now. The GM's own words are the honest label — a ladder with no stamp
    // predates presentations, and reads as unknown rather than stale.
    const authoredAs = ladder?.presentation?.text?.trim() || null;
    const reveal = this.band ? resolveReveal(ladder, this.band, { mistakenName }) : null;

    return Object.assign(context, {
      scope: this._scopeContext(),
      insight: this._insightContext(reveal),
      // Presets are buttons that FILL the box, not a value the box holds. They
      // carry their sentence in a data attribute so the click needs no lookup.
      presets: PRESENTATIONS.map((p) => ({
        key: p.key,
        label: L(`GLRK.presentation.${p.key}`, p.label),
        text: p.text,
        active: p.text === presentation.text,
      })),
      presentationText: presentation.text,
      presentationKey: presentation.key,
      authoredAs,
      presentationStale: !!authoredAs && authoredAs !== presentation.text.trim(),
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
      reveal,
      matrix: this.band ? null : revealMatrix(ladder, { mistakenName }),
      generatedAt: ladder?.generatedAt
        ? new Date(ladder.generatedAt).toLocaleString()
        : null,
    });
  }

  /**
   * The journal-page picker, or null.
   *
   * A gazetteer entry is thirty places in thirty pages, and one ladder across
   * the whole thing is a brief that is mostly about the other twenty-nine. The
   * picker is what makes the page the unit of prep without making the GM hunt
   * for the right right-click: it is offered from the entry and from every page
   * in it, so whichever one they opened, the other is one control away.
   *
   * A select rather than a row of chips because journals run long — a thirty-
   * page entry would push the tabs off the top of the panel.
   */
  _scopeContext() {
    const scope = journalScope(this.document);
    if (!scope) return null;
    const current = this.document.uuid;
    return {
      entry: {
        uuid: scope.entry.uuid,
        name: scope.entry.name,
        active: scope.entry.uuid === current,
        hasLadder: hasLadder(scope.entry),
      },
      pages: scope.pages.map((page) => ({
        uuid: page.uuid,
        name: page.name,
        active: page.uuid === current,
        hasLadder: hasLadder(page),
      })),
    };
  }

  /**
   * The Insight hand-off, or null when there is nothing to hand off.
   *
   * Gated three ways, and each gate is the honest one: the Insight feature has
   * to be enabled (it owns the notification and the socket), a band has to be
   * selected (the GM sends one answer, never a ladder), and that band has to
   * resolve to something a player may see. A control that renders when any of
   * those is false is a button that does nothing.
   */
  _insightContext(reveal) {
    if (!Suite.enabled(INSIGHT_ID)) return null;
    if (!reveal || !buildInsightMessage(reveal)) return null;
    const last = RecallApp._lastInsightTarget;
    const users = game.users
      .filter((u) => u.active && u.id !== game.user.id)
      .map((u) => ({ id: u.id, name: u.name, isGM: u.isGM, selected: u.id === last }))
      .sort((a, b) => (a.isGM === b.isGM ? a.name.localeCompare(b.name) : a.isGM ? 1 : -1));
    return { users, all: ALL_PLAYERS, allSelected: last === ALL_PLAYERS, empty: !users.length };
  }

  /** Resolve (and cache) the fallback wrong answer, only when one is needed. */
  _mistakenName(ladder) {
    const doc = this.document;
    if (!game.settings.get(SUITE_ID, "rk.mistakenIdentity")) return null;
    // Only needed when the Inept band was never authored: an authored paragraph
    // about YOUR creature always beats a generic misidentification.
    if (doc?.documentName !== "Actor" || ladder?.bands?.inept) return null;
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

  /**
   * The scope picker is a `<select>`, so it changes rather than clicks and
   * cannot be an ApplicationV2 action. Bound on every render because the frame
   * is rebuilt each time.
   */
  _onRender(context, options) {
    super._onRender?.(context, options);
    const picker = this.element?.querySelector("[name=glrk-scope]");
    picker?.addEventListener("change", (event) => this._onPickScope(event.currentTarget.value));
  }

  /**
   * Switch the panel to another subject in the same journal.
   *
   * The old window is closed rather than left behind: instances are keyed by
   * uuid, so without this a GM stepping through six pages ends up with six
   * panels, five of them stale.
   */
  async _onPickScope(uuid) {
    if (!uuid || uuid === this.document?.uuid) return;
    const resolve = foundry.utils?.fromUuid ?? globalThis.fromUuid;
    const doc = await resolve(uuid);
    if (!doc) return;
    await RecallApp.show(doc);
    await this.close();
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

  /**
   * A preset click writes its sentence into the box and nothing else.
   *
   * Deliberately not a mode switch: the box stays editable, the GM can write
   * over what lands there, and what they leave in it is what gets used. The
   * key is remembered alongside so the payload can still offer that preset's
   * scaffolding behind their words.
   */
  async _onUsePreset(event, target) {
    const box = this.element.querySelector("[name=glrk-presentation]");
    if (!box) return;
    box.value = target.dataset.text ?? "";
    await writePresentation(this.document, {
      key: target.dataset.preset,
      text: box.value,
    });
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

    const presentation = {
      key: this.element.querySelector("[name=glrk-presentation]")?.dataset.preset,
      text: this.element.querySelector("[name=glrk-presentation]")?.value ?? "",
    };
    await writePresentation(doc, presentation);

    const extras = [];
    for (const box of this.element.querySelectorAll("[name=glrk-extra]:checked")) {
      const block = await this._renderExtra(box.value);
      if (block) extras.push(block);
    }

    const payload = buildPayload(brief, {
      context: contextText,
      extras,
      seed: readSeed(doc),
      presentation,
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

    // The box is the truth at import time: the GM copied a payload built from
    // it, so that is what the reply was authored under. Persisting it before the
    // write means the stamp records the words actually used, even if the box was
    // edited and re-copied since.
    const presentationBox = this.element.querySelector("[name=glrk-presentation]");
    if (presentationBox) {
      await writePresentation(this.document, {
        key: presentationBox.dataset.preset,
        text: presentationBox.value,
      });
    }
    await writeLadder(this.document, { ...result, name: result.name || this.document.name });
    for (const warning of result.warnings) ui.notifications.warn(L(warning, warning));
    if (box) box.value = "";
    this.tab = "read";
    this.render();
    ui.notifications.info(L("GLRK.notify.imported", "Ladder stored."));
  }

  /**
   * Push the selected band's paragraph to a player through Insight.
   *
   * The one thing here that is not obvious: the reveal is resolved AGAIN rather
   * than reused from the render. A GM keeps this panel open across a scene, and
   * a re-read is what guarantees the card carries the ladder as it stands now
   * rather than as it stood when the window last drew itself.
   *
   * What goes out is built by share.mjs and is only ever the paragraph — no
   * band, no mode, no subject name. See that module for why: every one of those
   * hands the player their die result in words.
   */
  async _onSendInsight() {
    if (!Suite.enabled(INSIGHT_ID)) {
      ui.notifications.warn(L("GLRK.notify.insightOff", "Enable the Insight feature to send this to a player."));
      return;
    }
    const ladder = readLadder(this.document);
    const reveal = this.band
      ? resolveReveal(ladder, this.band, { mistakenName: this._mistakenName(ladder) })
      : null;
    const message = buildInsightMessage(reveal);
    if (!message) {
      ui.notifications.warn(L("GLRK.notify.insightNothing", "There is nothing written for that band to send."));
      return;
    }

    const picked = this.element.querySelector("[name=glrk-insight-target]")?.value ?? "";
    // "All players" means every active non-GM: a co-GM watching the table does
    // not need the card, and sending it to them reads as a mis-click.
    const targets =
      picked === ALL_PLAYERS
        ? game.users.filter((u) => u.active && !u.isGM).map((u) => u.id)
        : [picked].filter(Boolean);
    if (!targets.length) {
      ui.notifications.warn(L("GLRK.notify.insightNoTarget", "Pick a connected player first."));
      return;
    }

    let sendNotification;
    try {
      // Imported on use, not at module load: Insight is a sibling feature that
      // may be switched off, and this feature must not pull its socket, queue
      // and renderer into memory to render a panel that never sends anything.
      ({ sendNotification } = await import("../insight/module/socket.mjs"));
    } catch {
      ui.notifications.error(L("GLRK.notify.insightFailed", "Insight could not be reached; nothing was sent."));
      return;
    }

    for (const target of targets) sendNotification({ target, ...message });
    RecallApp._lastInsightTarget = picked;
    ui.notifications.info(
      game.i18n.format("GLRK.notify.insightSent", { count: targets.length })
    );
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
