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
import { leadJoint } from "./model.mjs";

const esc = (value) => escapeHTML(value ?? "");

/* ── shared pieces ─────────────────────────────────────────────────────────── */

/** A round portrait, or a monogram where there is none (the Narrator, a creature with no art). */
export function avatarHTML({ img, name, cls = "glrp-avatar" }) {
  if (img) return `<img class="${cls}" src="${esc(img)}" alt="" draggable="false">`;
  const initial = String(name ?? "").trim().charAt(0).toUpperCase() || "·";
  return `<span class="${cls} glrp-mono" aria-hidden="true">${esc(initial)}</span>`;
}

/** The speaker's name in bold, then the rest of a Do line. */
export function leadHTML(name, restHTML) {
  return `<b class="glrp-lead">${esc(name)}</b>${leadJoint(restHTML)}${restHTML}`;
}

/* ── the switch ────────────────────────────────────────────────────────────── */

/**
 * The composer bar that sits above Foundry's chat box.
 *
 * @param {object} s
 * @param {string} s.mode              the effective mode: say | do | think | narrator | ooc
 * @param {boolean} s.canIc            false locks the switch to OOC (no speaker)
 * @param {string} s.sub               say | do | think
 * @param {object|null} s.speaker      `{ name, img, source: "auto"|"pinned"|null, narrator, offScene }`
 * @param {boolean} s.pickerOpen
 * @param {object|null} s.picker       from `pickerModel`
 * @param {object} L                   localized strings
 */
export function barHTML(s, L) {
  const ic = s.mode !== "ooc";
  const segs = `<div class="glrp-seg" role="group" aria-label="${esc(L.switchLabel)}">`
    + `<button type="button" class="glrp-seg-btn" data-glrp-action="ooc" aria-pressed="${!ic}">${esc(L.ooc)}</button>`
    + `<button type="button" class="glrp-seg-btn" data-glrp-action="ic" aria-pressed="${ic}" ${s.canIc ? "" : "disabled"}>${esc(L.ic)}</button>`
    + `</div>`;
  const chip = ic && s.speaker ? speakerChipHTML(s.speaker, L, s.pickerOpen) : "";
  const picker = ic && s.pickerOpen && s.picker ? pickerHTML(s.picker, L) : "";
  // Narrator speaks in one voice; the Say / Do / Think row is a character's.
  const subs = ic && !s.speaker?.narrator
    ? `<div class="glrp-seg glrp-sub" role="group" aria-label="${esc(L.subLabel)}">${["say", "do", "think"]
      .map((m) => `<button type="button" class="glrp-seg-btn" data-glrp-action="sub" data-glrp-sub="${m}" aria-pressed="${s.sub === m}">${esc(L.sub[m])}</button>`)
      .join("")}</div>`
    : "";
  return `<div class="glrp-row">${segs}${chip}${picker}</div>${subs}`;
}

function speakerChipHTML(speaker, L, open) {
  // The GM's AUTO / PINNED sits under the name: beside it, a 300px sidebar has no room left for the name.
  const tag = speaker.source ? `<small class="glrp-chip-tag">${esc(L.source[speaker.source] ?? "")}</small>` : "";
  return `<button type="button" class="glrp-chip" data-glrp-action="picker" aria-haspopup="listbox" aria-expanded="${Boolean(open)}"`
    + ` title="${esc(L.chipTitle)}">${avatarHTML({ img: speaker.img, name: speaker.name })}`
    + `<span class="glrp-chip-text"><span class="glrp-chip-name">${esc(speaker.name)}</span>${tag}</span>`
    + `<i class="glrp-chip-caret fa-solid fa-caret-down" aria-hidden="true"></i></button>`;
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

/** The line under the chat box: the shortcuts, or why the switch is locked. */
export function hintHTML({ canIc, toggle, cycle }, L) {
  if (!canIc) return esc(L.noSpeaker);
  const parts = [];
  if (toggle) parts.push(`<kbd>${esc(toggle)}</kbd> ${esc(L.toggleHint)}`);
  if (cycle) parts.push(`<kbd>${esc(cycle)}</kbd> ${esc(L.cycleHint)}`);
  return parts.join(" · ");
}

/* ── the chat log ──────────────────────────────────────────────────────────── */

/**
 * The head of an in-character entry in the chat log, which replaces Foundry's sender line.
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
  return `<div class="glrp-balloon"><span class="glrp-balloon-who">${esc(name)}</span><span class="glrp-balloon-txt">${esc(text)}</span></div>`;
}

/** What hangs under a stack of balloons: a tail for Say, two puffs for Think. */
export function bubbleTailHTML(mode) {
  if (mode === "think") return `<div class="glrp-puffs" aria-hidden="true"><i></i><i></i></div>`;
  if (mode === "say") return `<div class="glrp-tail" aria-hidden="true"></div>`;
  return "";
}

/** A line in the caption lane at the bottom of the screen. */
export function laneLineHTML({ mode, name, img, text }) {
  if (mode === "narrator") return `<div class="glrp-line glrp-line--narr"><div class="glrp-line-txt">${esc(text)}</div></div>`;
  const txt = mode === "do" ? leadHTML(name, esc(text)) : esc(text);
  const who = mode === "do" ? "" : `<div class="glrp-line-who">${esc(name)}</div>`;
  return `<div class="glrp-line">${avatarHTML({ img, name, cls: "glrp-line-art" })}<div class="glrp-line-body">${who}<div class="glrp-line-txt">${txt}</div></div></div>`;
}
