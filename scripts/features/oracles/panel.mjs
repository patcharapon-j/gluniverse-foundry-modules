/**
 * GLUniverse Suite — Oracles feature: the GM oracle panel.
 *
 * A draggable, GM-only floating panel. A fixed top zone (Ask the Oracle
 * yes/no row + the primary pack's Tier-1 slot shortcuts), a searchable
 * browser of every enabled pack's tables (with a context selector on packs
 * that declare an axis), and a persisted result log. Results are trees:
 * auto-resolved refs/composes render nested; manual refs render as
 * "roll →" drill buttons; shift-click any roll to expand everything.
 *
 * Rolls are silent (engine.mjs); each log entry has "send to chat"
 * (GM whisper). The log DOM is prepended directly so search/scroll state
 * survives — the panel only full-re-renders when packs/settings change.
 */

import { SUITE_ID, featurePath } from "../../core/const.mjs";
import { escapeHTML } from "../../core/util.mjs";
import {
  FEATURE_ID, LOG_KEY, POS_KEY, LOG_MAX, ODDS,
  askOracle, rollTable, packViews, slotButtons, primaryPackId,
  setContextChoice, sanitizeLog, GENRE_PACKS,
} from "./engine.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const L = (k, d) => { const s = game.i18n.localize(k); return s === k ? (d ?? k) : s; };
const uid = () => `o${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;

/* ── Result tree → HTML (one code path for restore + live prepend) ──────── */

const matchBadge = () =>
  `<span class="glo-match" title="${escapeHTML(L("GLORACLE.match.hint", "Match — envision an extreme result or twist"))}">${escapeHTML(L("GLORACLE.match.label", "MATCH"))}</span>`;

function nodeHTML(node, depth = 0) {
  if (!node) return "";
  const meta = node.roll != null ? `d${node.dieSize} = ${node.roll}` : "";
  const kids = (node.children || []).map((c) => nodeHTML(c, depth + 1)).join("");
  const pend = (node.pending || []).map((p) =>
    `<button type="button" class="glo-drill" data-action="drill" data-ref="${escapeHTML(p.ref)}">
      <i class="fa-solid fa-arrow-turn-down"></i> ${escapeHTML(p.label)}</button>`).join("");
  if (depth === 0) {
    // Root node body: text + meta live in the entry chrome, not here.
    return `${kids}${pend ? `<div class="glo-pend">${pend}</div>` : ""}`;
  }
  return `<div class="glo-node">
    <span class="glo-node-label">${escapeHTML(node.tableName)}</span>
    <span class="glo-node-result">${escapeHTML(node.text)}</span>
    ${meta ? `<span class="glo-node-meta">${escapeHTML(meta)}</span>` : ""}
    ${node.isMatch ? matchBadge() : ""}
    ${kids}${pend ? `<div class="glo-pend">${pend}</div>` : ""}
  </div>`;
}

function entryHTML(e) {
  const meta = e.meta ? `<div class="glo-entry-meta">${escapeHTML(e.meta)}</div>` : "";
  return `<li class="glo-entry glo-in" data-id="${e.id}" data-tone="${e.tone || "neutral"}">
    <div class="glo-entry-head">
      <i class="${e.icon || "fa-solid fa-dice"}"></i>
      <span class="glo-entry-label">${escapeHTML(e.label)}</span>
      ${e.isMatch ? matchBadge() : ""}
      <button type="button" class="glo-icon-btn" data-action="sendChat" data-id="${e.id}"
        title="${escapeHTML(L("GLORACLE.log.toChat", "Send to chat"))}"><i class="fa-solid fa-comment-dots"></i></button>
    </div>
    <div class="glo-entry-result">${escapeHTML(e.result)}</div>
    ${meta}
    ${e.tree ? nodeHTML(e.tree, 0) : ""}
  </li>`;
}

/** Flatten a result tree to plain chat text. */
function flatText(node, indent = "") {
  if (!node) return "";
  const meta = node.roll != null ? ` (d${node.dieSize} = ${node.roll}${node.isMatch ? " · MATCH" : ""})` : "";
  let out = `${indent}${node.tableName}: ${node.text}${meta}`;
  for (const c of node.children || []) out += `\n${flatText(c, indent + "  ↳ ")}`;
  return out;
}

export class OraclesPanel extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "glo-panel",
    classes: ["glo-panel"],
    window: { title: "GLORACLE.title", icon: "fa-solid fa-circle-question", resizable: true },
    position: { width: 320, height: 480 },
    actions: {
      ask: OraclesPanel.prototype._onAsk,
      rollTable: OraclesPanel.prototype._onRollTable,
      drill: OraclesPanel.prototype._onDrill,
      sendChat: OraclesPanel.prototype._onSendChat,
      clearLog: OraclesPanel.prototype._onClearLog,
    },
  };

  static PARTS = { main: { template: featurePath(FEATURE_ID, "templates/panel.hbs") } };

  /** In-memory log, newest first. Mirrored to the client setting. */
  _entries = [];

  /** Open (or bring to front) the single panel instance. Idempotent. */
  static open() {
    if (!game.user.isGM) return null;
    const existing = foundry.applications.instances.get("glo-panel");
    if (existing) { existing.render({ force: true }); return existing; }
    const panel = new OraclesPanel();
    panel.render({ force: true });
    return panel;
  }

  /** Live handle to the currently-open panel, or null. */
  static get current() {
    return foundry.applications.instances.get("glo-panel") ?? null;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const primary = primaryPackId();
    const primaryLabel = GENRE_PACKS.find((p) => p.id === primary)?.label ?? primary;
    const slots = (await slotButtons()).map((s) => ({
      ...s,
      label: L(`GLORACLE.slot.${s.slot}`, s.slot),
    }));
    return Object.assign(context, {
      odds: ODDS.map((o) => ({ id: o.id, label: L(`GLORACLE.odds.${o.id}`, o.id), selected: o.id === "fifty-fifty" })),
      slots,
      primaryLabel,
      packs: await packViews(),
    });
  }

  async _onRender(context, options) {
    await super._onRender(context, options);

    // Restore persisted position (per client) on first mount.
    if (!this._posRestored) {
      this._posRestored = true;
      const pos = game.settings.get(SUITE_ID, POS_KEY);
      if (pos && Number.isFinite(pos.left) && Number.isFinite(pos.top)) {
        this.setPosition({ left: pos.left, top: pos.top });
      }
    }

    // Load and paint the persisted log.
    this._entries = sanitizeLog(game.settings.get(SUITE_ID, LOG_KEY));
    this._paintLog();

    // Browser search filter.
    const search = this.element.querySelector("[data-search]");
    search?.addEventListener("input", (ev) => this._filter(ev.target.value));

    // Context selectors (per pack that declares an axis).
    for (const sel of this.element.querySelectorAll("[data-ctx-pack]")) {
      sel.addEventListener("change", (ev) =>
        setContextChoice(ev.target.dataset.ctxPack, ev.target.value));
    }
  }

  /* ── log plumbing ──────────────────────────────────────────────────── */

  get _logEl() { return this.element?.querySelector("[data-log]"); }

  _paintLog() {
    const log = this._logEl;
    if (!log) return;
    log.innerHTML = this._entries.map(entryHTML).join("");
    this._toggleEmpty();
  }

  _toggleEmpty() {
    const empty = this.element?.querySelector("[data-empty]");
    if (empty) empty.style.display = this._entries.length ? "none" : "";
  }

  async _persist() {
    this._entries = this._entries.slice(0, LOG_MAX);
    try { await game.settings.set(SUITE_ID, LOG_KEY, this._entries); } catch (_e) { /* client full — non-fatal */ }
  }

  /** Push an entry: prepend to DOM (animated) + array, then persist. */
  _push(entry) {
    entry.id = uid();
    this._entries.unshift(entry);
    const log = this._logEl;
    if (log) {
      log.insertAdjacentHTML("afterbegin", entryHTML(entry));
      while (log.children.length > LOG_MAX) log.lastElementChild?.remove();
      log.scrollTop = 0;
    }
    this._toggleEmpty();
    this._persist();
  }

  /** Wrap a result tree in a log entry and push it. */
  _pushResult(tree, { icon, labelPrefix } = {}) {
    if (!tree) return;
    const entry = {
      icon: icon || "fa-solid fa-dice",
      label: labelPrefix ? `${labelPrefix}${tree.tableName}` : tree.tableName,
      result: tree.text,
      tone: tree.isMatch ? "match" : "neutral",
      isMatch: tree.isMatch,
      meta: tree.roll != null ? `d${tree.dieSize} = ${tree.roll}` : "",
      tree,
      chat: flatText(tree),
    };
    this._push(entry);
  }

  /* ── rolls ─────────────────────────────────────────────────────────── */

  _onAsk(event) {
    const sel = this.element.querySelector("[data-odds]");
    const oddsId = sel?.value || "fifty-fifty";
    const r = askOracle(oddsId);
    const oddsLabel = L(`GLORACLE.odds.${r.oddsId}`, r.oddsId);
    const verdict = r.yes ? L("GLORACLE.ask.yes", "Yes") : L("GLORACLE.ask.no", "No");
    const entry = {
      icon: "fa-solid fa-circle-question",
      label: `${L("GLORACLE.ask.label", "Ask the Oracle")} · ${oddsLabel}`,
      result: verdict,
      tone: r.yes ? "yes" : "no",
      isMatch: r.isMatch,
      meta: `d100 = ${r.roll} · ${L("GLORACLE.ask.yesIf", "yes ≤")} ${r.threshold}`,
      tree: null,
      chat: `${L("GLORACLE.ask.label", "Ask the Oracle")} (${oddsLabel}): ${verdict} — d100 = ${r.roll}${r.isMatch ? " · MATCH" : ""}`,
    };
    this._push(entry);
  }

  async _onRollTable(event, target) {
    const id = target?.dataset?.table;
    if (!id) return;
    const tree = await rollTable(id, { expandAll: !!event?.shiftKey });
    this._pushResult(tree);
  }

  async _onDrill(event, target) {
    const ref = target?.dataset?.ref;
    if (!ref) return;
    const tree = await rollTable(ref, { expandAll: !!event?.shiftKey });
    this._pushResult(tree, { labelPrefix: "↳ " });
    target.classList.add("glo-drilled");
  }

  /* ── chat + clear ──────────────────────────────────────────────────── */

  async _onSendChat(event, target) {
    const id = target?.dataset?.id;
    const entry = this._entries.find((e) => e.id === id);
    if (!entry) return;
    const body = escapeHTML(entry.chat || entry.result).replace(/\n/g, "<br>");
    await ChatMessage.create({
      content: `<div class="glo-chat"><strong>${escapeHTML(entry.label)}</strong><br>${body}</div>`,
      whisper: ChatMessage.getWhisperRecipients("GM").map((u) => u.id),
      speaker: { alias: L("GLORACLE.chat.alias", "Oracle") },
    });
    ui.notifications?.info(L("GLORACLE.log.sent", "Sent to GM chat."));
  }

  async _onClearLog() {
    this._entries = [];
    await this._persist();
    this._paintLog();
  }

  /* ── search ────────────────────────────────────────────────────────── */

  _filter(q) {
    const needle = (q || "").trim().toLowerCase();
    for (const btn of this.element.querySelectorAll(".glo-el")) {
      const hit = !needle || btn.textContent.toLowerCase().includes(needle);
      btn.style.display = hit ? "" : "none";
    }
    for (const grp of this.element.querySelectorAll("[data-group]")) {
      const any = grp.querySelector('.glo-el:not([style*="display: none"])');
      grp.style.display = any ? "" : "none";
    }
    for (const packEl of this.element.querySelectorAll("[data-pack]")) {
      const any = packEl.querySelector('[data-group]:not([style*="display: none"])');
      packEl.style.display = any ? "" : "none";
    }
  }

  /* ── persist position on close ─────────────────────────────────────── */

  async close(options) {
    try {
      const p = this.position;
      if (p) await game.settings.set(SUITE_ID, POS_KEY, { left: p.left, top: p.top });
    } catch (_e) { /* non-fatal */ }
    return super.close(options);
  }
}
