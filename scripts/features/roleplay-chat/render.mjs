/**
 * Roleplay Chat — every piece of markup this feature draws, as strings.
 *
 * Pure: no `game`, no `canvas`, no DOM. The Foundry glue and `tools/roleplay-chat-preview.mjs` both
 * build from these, so the preview page shows exactly what ships; a preview built on a second copy of
 * the markup flatters whichever copy was touched last.
 *
 * Every value that reaches markup here is escaped. A chat body is arbitrary markup from any client in
 * the world, so the overlays never take it as HTML: they draw `textOf(body)`, escaped. Only the chat
 * log keeps the body's markup, and that is Foundry's own enriched content, already in the log.
 */

import { escapeHTML } from "../../core/util.mjs";
import { asideRuns, leadJoint, modeTabs, quoteEdges } from "./model.mjs";

const esc = (value) => escapeHTML(value ?? "");

/* ── shared pieces ─────────────────────────────────────────────────────────── */

/** A cut-corner portrait, or a monogram where there is none (the Narrator, a creature with no art). */
export function avatarHTML({ img, name, cls = "glrp-avatar" }) {
  if (img) return `<img class="${cls}" src="${esc(img)}" alt="" draggable="false">`;
  const initial = String(name ?? "").trim().charAt(0).toUpperCase() || "·";
  return `<span class="${cls} glrp-mono" aria-hidden="true">${esc(initial)}</span>`;
}

/**
 * Plain text for an overlay, escaped, with a Say line's `*asides*` set apart as actions. Only Say has
 * asides: a Do line is all action already, and in a thought the stars are the writer's own emphasis.
 */
export function lineHTML(mode, text) {
  if (mode !== "say") return esc(text);
  return asideRuns(String(text ?? "")).map((run) => (run.aside ? asideHTML(run) : esc(run.text))).join("");
}

/** One aside. `data-closes` / `data-opens`: words before / after it, where a quoted line draws a mark. */
export function asideHTML(run) {
  return `<span class="glrp-aside"${run.closes ? " data-closes" : ""}${run.opens ? " data-opens" : ""}>${esc(run.text)}</span>`;
}

/** The attributes a quoted Say line takes when it starts or ends on an aside rather than on words. */
export function quoteEdgeAttrs(mode, text) {
  if (mode !== "say") return "";
  const edges = quoteEdges(asideRuns(String(text ?? "")));
  return `${edges.opens ? "" : " data-glrp-open=\"aside\""}${edges.closes ? "" : " data-glrp-close=\"aside\""}`;
}

/** The speaker's name in bold, then the rest of a Do line. */
export function leadHTML(name, restHTML) {
  return `<b class="glrp-lead">${esc(name)}</b>${leadJoint(restHTML)}${restHTML}`;
}

/* ── the switch ────────────────────────────────────────────────────────────── */

/** One glyph per tab, so the deliveries read apart at a glance and without colour. */
export const SUB_ICONS = Object.freeze({ say: "fa-comment", do: "fa-hand", think: "fa-cloud" });
export const MODE_ICONS = Object.freeze({ ...SUB_ICONS, ooc: "fa-mug-hot", narrator: "fa-feather" });

/**
 * The composer: one plate above Foundry's chat box. The top row is who is speaking (the chip, or why
 * nobody can be); the bottom row is the mode strip, one tab per thing a line can be. The pressed tab
 * sits on a slab of the mode's tone (`.glrp-ink`, placed under tab `--glrp-at`), which the composer
 * slides from the old tab when the mode changes.
 *
 * @param {object} s
 * @param {string} s.mode              the effective mode: say | do | think | narrator | ooc
 * @param {boolean} s.canIc            false locks the strip to OOC (no speaker)
 * @param {string} s.sub               say | do | think
 * @param {object|null} s.speaker      `{ name, img, source: "auto"|"pinned"|null, narrator }`
 * @param {boolean} s.pickerOpen
 * @param {object|null} s.picker       from `pickerModel`
 * @param {{toggle?: string, cycle?: string}} [s.keys]   the configured bindings, humanized
 * @param {object} L                   localized strings
 */
export function barHTML(s, L) {
  const tabs = modeTabs({ mode: s.mode, canIc: s.canIc, narrator: Boolean(s.speaker?.narrator) });
  const keys = s.keys ?? {};
  const top = s.canIc && s.speaker
    ? speakerChipHTML(s.speaker, L, s.pickerOpen) + (s.pickerOpen && s.picker ? pickerHTML(s.picker, L) : "")
    : `<p class="glrp-locked"><i class="fa-solid fa-lock" aria-hidden="true"></i><span>${esc(L.noSpeaker)}</span></p>`;
  const at = tabs.findIndex((t) => t.pressed);
  const strip = tabs.map((t) => {
    const key = t.id === "ooc" || t.id === "narrator" ? keys.toggle : keys.cycle;
    const hint = t.id === "ooc" || t.id === "narrator" ? L.toggleHint : L.cycleHint;
    const tip = key ? `${key} · ${hint}` : hint;
    const action = t.id === "ooc" ? "ooc" : t.id === "narrator" ? "ic" : "sub";
    return `<button type="button" class="glrp-mode" data-glrp-action="${action}"${action === "sub" ? ` data-glrp-sub="${t.id}"` : ""}`
      + ` data-glrp-tone="${t.id}" aria-pressed="${t.pressed}"${t.disabled ? " disabled" : ""}`
      + ` data-tooltip="${esc(tip)}"${key ? ` aria-keyshortcuts="${esc(key.replace(/\s/g, ""))}"` : ""}>`
      + `<i class="glrp-ico fa-solid ${MODE_ICONS[t.id]}" aria-hidden="true"></i><span>${esc(t.id === "narrator" ? L.narrate : t.id === "ooc" ? L.ooc : L.sub[t.id])}</span></button>`;
  }).join("");
  const ink = at >= 0 ? `<span class="glrp-ink" style="--glrp-at: ${at}" aria-hidden="true"></span>` : "";
  return `<div class="glrp-row">${top}</div>`
    + `<div class="glrp-modes" role="group" aria-label="${esc(L.switchLabel)}" data-at="${at}" style="--glrp-tabs: ${tabs.length}">${ink}${strip}</div>`;
}

function speakerChipHTML(speaker, L, open) {
  const tag = speaker.source ? `<small class="glrp-chip-tag">${esc(L.source[speaker.source] ?? "")}</small>` : "";
  return `<button type="button" class="glrp-chip" data-glrp-action="picker" aria-haspopup="listbox" aria-expanded="${Boolean(open)}"`
    + ` data-tooltip="${esc(L.chipTitle)}" aria-label="${esc(L.chipTitle)}">${avatarHTML({ img: speaker.img, name: speaker.name })}`
    + `<span class="glrp-chip-as">${esc(L.as)}</span><span class="glrp-chip-name">${esc(speaker.name)}</span>${tag}`
    + `<i class="glrp-chip-caret fa-solid fa-chevron-up" aria-hidden="true"></i></button>`;
}

/**
 * The speaker picker.
 * @param {{groups: {heading: string, rows: {key: string, name: string, img: string|null, selected: boolean, tag?: string}[]}[]}} picker
 */
export function pickerHTML(picker, L) {
  const groups = (picker.groups ?? []).filter((g) => g.rows?.length);
  const body = groups.map((g) => `<h4 class="glrp-picker-head">${esc(g.heading)}</h4>${g.rows.map((r) => (
    `<button type="button" class="glrp-picker-row" role="option" data-glrp-action="pick" data-glrp-key="${esc(r.key)}" aria-selected="${Boolean(r.selected)}">`
    + `${avatarHTML({ img: r.img, name: r.name })}<span class="glrp-picker-name">${esc(r.name)}</span>`
    + `${r.tag ? `<small class="glrp-picker-tag">${esc(r.tag)}</small>` : ""}</button>`
  )).join("")}`).join("");
  return `<div class="glrp-picker" role="listbox" aria-label="${esc(L.pickerLabel)}">${body}</div>`;
}

/* ── the chat log ──────────────────────────────────────────────────────────── */

/**
 * The head of an in-character entry in the chat log, which replaces Foundry's sender line: the
 * portrait, then the name and what kind of line it is on one line.
 *
 * @param {object} v
 * @param {string} v.mode    say | do | think | narrator
 * @param {string} v.name    what this viewer may read: the name, or "Unknown"
 * @param {string|null} v.img
 * @param {string} v.label   Says, Does, Thinks, Narrator
 * @param {boolean} [v.hiddenFromPlayers]  GM only: players read "Unknown" for this speaker
 * @param {string} [v.hiddenHint]
 */
export function logHeadHTML(v) {
  if (v.mode === "narrator") return `<div class="glrp-rule">${esc(v.label)}</div>`;
  const hidden = v.hiddenFromPlayers
    ? ` <i class="glrp-hidden fa-solid fa-eye-slash" data-tooltip="${esc(v.hiddenHint ?? "")}" aria-label="${esc(v.hiddenHint ?? "")}"></i>`
    : "";
  return `<div class="glrp-head">${avatarHTML({ img: v.img, name: v.name, cls: "glrp-portrait" })}`
    + `<div class="glrp-who"><span class="glrp-name">${esc(v.name)}${hidden}</span><span class="glrp-label">${esc(v.label)}</span></div></div>`;
}

/** The small OOC tag beside an out-of-character entry's sender. */
export function oocTagHTML(label) {
  return `<span class="glrp-ooc-tag">${esc(label)}</span>`;
}

/* ── over the canvas ───────────────────────────────────────────────────────── */

/**
 * One line over a token: a balloon for Say and Think, a caption for Do.
 * `text` is plain text; it is escaped here.
 */
export function bubbleLineHTML({ mode, name, text }) {
  if (mode === "do") return `<div class="glrp-cap-line">${leadHTML(name, esc(text))}</div>`;
  return `<div class="glrp-balloon"><span class="glrp-balloon-who">${esc(name)}</span><span class="glrp-balloon-txt">${lineHTML(mode, text)}</span></div>`;
}

/** What hangs under a stack of balloons: a tail for Say, two beads for Think. */
export function bubbleTailHTML(mode) {
  if (mode === "think") return `<div class="glrp-puffs" aria-hidden="true"><i></i><i></i></div>`;
  if (mode === "say") return `<div class="glrp-tail" aria-hidden="true"></div>`;
  return "";
}

/** The "…" over a token while its player is writing in character. Carries no text at all. */
export function typingHTML() {
  return `<div class="glrp-typing" aria-hidden="true"><i></i><i></i><i></i></div>`;
}

/** A line in the caption lane at the bottom of the screen. */
export function laneLineHTML({ mode, name, img, text }) {
  if (mode === "narrator") return `<div class="glrp-line glrp-line--narr"><div class="glrp-line-txt">${esc(text)}</div></div>`;
  const txt = mode === "do" ? leadHTML(name, esc(text)) : lineHTML(mode, text);
  const who = mode === "do" ? "" : `<div class="glrp-line-who">${esc(name)}</div>`;
  return `<div class="glrp-line">${avatarHTML({ img, name, cls: "glrp-line-art" })}<div class="glrp-line-body">${who}<div class="glrp-line-txt"${quoteEdgeAttrs(mode, text)}>${txt}</div></div></div>`;
}
