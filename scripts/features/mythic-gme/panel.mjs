/**
 * GLUniverse Suite — Mythic GME feature: the GM oracle panel.
 *
 * A draggable, GM-only floating panel. A fixed top zone (Chaos Factor, Fate Chart
 * odds picker, Random Event / Action / Description) plus a searchable, categorized
 * list of the ~40 Elements meaning tables. Results stream into an in-panel log
 * (persisted, last ~50) with a per-roll "send to chat" GM whisper.
 *
 * Rolls are silent (oracle.mjs). The panel never full-re-renders after opening —
 * new results are prepended to the log DOM directly so scroll/search state and the
 * log itself survive interaction.
 */

import { SUITE_ID, featurePath } from "../../core/const.mjs";
import { escapeHTML } from "../../core/util.mjs";
import {
  FEATURE_ID, LOG_KEY, POS_KEY, AUTOEVENT_KEY, LOG_MAX,
  ODDS, getChaos, adjustChaos,
  rollFate, rollRandomEvent, rollActions, rollDescriptions, rollElement,
  elementGroups,
} from "./oracle.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const L = (k, d) => { const s = game.i18n.localize(k); return s === k ? d : s; };
const uid = () => `m${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;

/* ── Log entry → HTML (one code path for restore + live prepend) ─────────── */

function subHTML(s) {
  return `<div class="gmyth-sub" data-tone="${s.tone || "neutral"}">
    <span class="gmyth-sub-label">${escapeHTML(s.label)}</span>
    <span class="gmyth-sub-result">${escapeHTML(s.result)}</span>
    ${s.meta ? `<span class="gmyth-sub-meta">${escapeHTML(s.meta)}</span>` : ""}
  </div>`;
}

function entryHTML(e) {
  return `<li class="gmyth-entry gmyth-in" data-id="${e.id}" data-tone="${e.tone || "neutral"}">
    <div class="gmyth-entry-head">
      <i class="${e.icon || "fa-solid fa-dice"}"></i>
      <span class="gmyth-entry-label">${escapeHTML(e.label)}</span>
      <button type="button" class="gmyth-icon-btn" data-action="sendChat" data-id="${e.id}"
        title="${escapeHTML(L("GLMYTHIC.log.toChat", "Send to chat"))}"><i class="fa-solid fa-comment-dots"></i></button>
    </div>
    <div class="gmyth-entry-result">${escapeHTML(e.result)}</div>
    ${e.meta ? `<div class="gmyth-entry-meta">${escapeHTML(e.meta)}</div>` : ""}
    ${(e.subs || []).map(subHTML).join("")}
  </li>`;
}

export class MythicPanel extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "gmyth-panel",
    classes: ["gmyth-panel"],
    window: { title: "GLMYTHIC.title", icon: "fa-solid fa-hat-wizard", resizable: true },
    position: { width: 296, height: 420 },
    actions: {
      cfDown: MythicPanel.prototype._onCfDown,
      cfUp: MythicPanel.prototype._onCfUp,
      askFate: MythicPanel.prototype._onAskFate,
      rollEvent: MythicPanel.prototype._onRollEvent,
      rollAction: MythicPanel.prototype._onRollAction,
      rollDesc: MythicPanel.prototype._onRollDesc,
      rollElement: MythicPanel.prototype._onRollElement,
      sendChat: MythicPanel.prototype._onSendChat,
      clearLog: MythicPanel.prototype._onClearLog,
    },
  };

  static PARTS = { main: { template: featurePath(FEATURE_ID, "templates/panel.hbs") } };

  /** In-memory log, newest first. Mirrored to the client setting. */
  _entries = [];

  /** Open (or bring to front) the single panel instance. Idempotent — a scene
   *  button click can reach us twice, so never toggle-close here. */
  static open() {
    if (!game.user.isGM) return null;
    const existing = foundry.applications.instances.get("gmyth-panel");
    if (existing) { existing.render({ force: true }); return existing; }
    const panel = new MythicPanel();
    panel.render({ force: true });
    return panel;
  }

  /** Live handle to the currently-open panel, or null. */
  static get current() {
    return foundry.applications.instances.get("gmyth-panel") ?? null;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    return Object.assign(context, {
      chaos: getChaos(),
      odds: ODDS.map((o) => ({ id: o.id, label: L(`GLMYTHIC.odds.${o.id}`, o.id), selected: o.id === "fifty-fifty" })),
      groups: elementGroups(),
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
    const saved = game.settings.get(SUITE_ID, LOG_KEY);
    this._entries = Array.isArray(saved) ? saved.slice(0, LOG_MAX) : [];
    this._paintLog();

    // Elements search filter.
    const search = this.element.querySelector("[data-search]");
    search?.addEventListener("input", (ev) => this._filter(ev.target.value));

    // Paint the chaos meter fill from the current value.
    this.refreshChaos();
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
      // Trim overflow nodes to match LOG_MAX.
      while (log.children.length > LOG_MAX) log.lastElementChild?.remove();
      log.scrollTop = 0;
    }
    this._toggleEmpty();
    this._persist();
  }

  /* ── Chaos Factor ──────────────────────────────────────────────────── */

  async _onCfDown() { await adjustChaos(-1); this.refreshChaos(); }
  async _onCfUp() { await adjustChaos(1); this.refreshChaos(); }

  /** Reflect the current chaos factor into the meter (called on local change and
   *  on the world-setting onChange so a second GM's panel stays in sync). */
  refreshChaos() {
    const cf = getChaos();
    const val = this.element?.querySelector("[data-cf]");
    if (val) {
      val.textContent = String(cf);
      val.classList.remove("gmyth-bump");
      void val.offsetWidth; // restart the bump animation
      val.classList.add("gmyth-bump");
    }
    const fill = this.element?.querySelector("[data-cf-fill]");
    if (fill) fill.style.width = `${(cf / 9) * 100}%`;
  }

  /* ── rolls ─────────────────────────────────────────────────────────── */

  _onAskFate() {
    const sel = this.element.querySelector("[data-odds]");
    const oddsId = sel?.value || "fifty-fifty";
    const cf = getChaos();
    const r = rollFate(oddsId, cf);
    const oddsLabel = L(`GLMYTHIC.odds.${oddsId}`, oddsId);

    const entry = {
      icon: "fa-solid fa-scale-balanced",
      label: `${L("GLMYTHIC.fate.label", "Fate")} · ${oddsLabel}`,
      result: L(`GLMYTHIC.verdict.${r.key}`, r.verdict),
      tone: r.key,
      meta: `d100 = ${r.roll} · ${L("GLMYTHIC.cf.abbr", "CF")} ${cf}`,
      subs: [],
    };

    let chat = `${entry.label} — ${entry.result} (${entry.meta})`;

    // Auto-roll the triggered Random Event inline (feature default: on).
    if (r.eventTriggered && game.settings.get(SUITE_ID, AUTOEVENT_KEY)) {
      const ev = rollRandomEvent();
      entry.subs.push(
        { label: L("GLMYTHIC.event.triggered", "Random Event"), result: ev.focus.focus, tone: "event", meta: `d100 = ${ev.focus.roll}` },
        { label: L("GLMYTHIC.event.meaning", "Meaning"), result: ev.meaning.words.join(" · "), tone: "neutral", meta: `${ev.meaning.rolls.join(" / ")}` },
      );
      chat += `\n⚠ ${L("GLMYTHIC.event.triggered", "Random Event")}: ${ev.focus.focus} — ${ev.meaning.words.join(" · ")}`;
    } else if (r.eventTriggered) {
      entry.subs.push({ label: L("GLMYTHIC.event.triggered", "Random Event"), result: L("GLMYTHIC.event.flagged", "triggered — roll it"), tone: "event", meta: "" });
      chat += `\n⚠ ${L("GLMYTHIC.event.triggered", "Random Event")} ${L("GLMYTHIC.event.flagged", "triggered")}`;
    }

    entry.chat = chat;
    this._push(entry);
  }

  _onRollEvent() {
    const ev = rollRandomEvent();
    const entry = {
      icon: "fa-solid fa-bolt",
      label: L("GLMYTHIC.event.label", "Random Event"),
      result: ev.focus.focus,
      tone: "event",
      meta: `${L("GLMYTHIC.event.focus", "Focus")} d100 = ${ev.focus.roll}`,
      subs: [{ label: L("GLMYTHIC.event.meaning", "Meaning"), result: ev.meaning.words.join(" · "), tone: "neutral", meta: `${ev.meaning.rolls.join(" / ")}` }],
    };
    entry.chat = `${entry.label}: ${ev.focus.focus} — ${ev.meaning.words.join(" · ")} (${entry.meta})`;
    this._push(entry);
  }

  _onRollAction() {
    const a = rollActions();
    const entry = {
      icon: "fa-solid fa-bolt-lightning",
      label: L("GLMYTHIC.meaning.action", "Meaning · Action"),
      result: a.words.join(" · "),
      tone: "neutral",
      meta: `d100 = ${a.rolls.join(" / ")}`,
    };
    entry.chat = `${entry.label}: ${entry.result} (${entry.meta})`;
    this._push(entry);
  }

  _onRollDesc() {
    const dd = rollDescriptions();
    const entry = {
      icon: "fa-solid fa-feather",
      label: L("GLMYTHIC.meaning.description", "Meaning · Description"),
      result: dd.words.join(" · "),
      tone: "neutral",
      meta: `d100 = ${dd.rolls.join(" / ")}`,
    };
    entry.chat = `${entry.label}: ${entry.result} (${entry.meta})`;
    this._push(entry);
  }

  _onRollElement(event, target) {
    const id = target?.dataset?.el;
    const res = rollElement(id);
    if (!res) return;
    const entry = {
      icon: "fa-solid fa-layer-group",
      label: res.name,
      result: res.word,
      tone: "neutral",
      meta: `d100 = ${res.roll}`,
    };
    entry.chat = `${res.name}: ${res.word} (d100 = ${res.roll})`;
    this._push(entry);
  }

  /* ── chat + clear ──────────────────────────────────────────────────── */

  async _onSendChat(event, target) {
    const id = target?.dataset?.id;
    const entry = this._entries.find((e) => e.id === id);
    if (!entry) return;
    await ChatMessage.create({
      content: `<div class="gmyth-chat"><strong>${escapeHTML(entry.label)}</strong><br>${escapeHTML(entry.chat || entry.result)}</div>`,
      whisper: ChatMessage.getWhisperRecipients("GM").map((u) => u.id),
      speaker: { alias: L("GLMYTHIC.chat.alias", "Mythic Oracle") },
    });
    ui.notifications?.info(L("GLMYTHIC.log.sent", "Sent to GM chat."));
  }

  async _onClearLog() {
    this._entries = [];
    await this._persist();
    this._paintLog();
  }

  /* ── search ────────────────────────────────────────────────────────── */

  _filter(q) {
    const needle = (q || "").trim().toLowerCase();
    for (const btn of this.element.querySelectorAll("[data-el]")) {
      const hit = !needle || btn.textContent.toLowerCase().includes(needle);
      btn.style.display = hit ? "" : "none";
    }
    // Hide category headers with no visible tables.
    for (const grp of this.element.querySelectorAll("[data-group]")) {
      const any = grp.querySelector('[data-el]:not([style*="display: none"])');
      grp.style.display = any ? "" : "none";
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
