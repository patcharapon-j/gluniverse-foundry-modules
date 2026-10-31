/**
 * Roleplay Chat — every rule, as plain functions.
 *
 * Pure: no `game`, no `canvas`, no DOM. `tools/roleplay-chat-check.mjs` drives all of it under plain
 * Node, and the Foundry glue (`composer.mjs`, `send.mjs`, `overlay.mjs`, `log.mjs`) only gathers facts
 * and hands them in. A rule that lived in the glue would be a rule nothing checks.
 */

import { RP_IC_MODES, RP_MODES, rpModeFlags } from "../../core/rp-mode.mjs";

/* ── modes ─────────────────────────────────────────────────────────────────── */

/** What the Say / Do / Think row picks. */
export const SUB_MODES = Object.freeze(["say", "do", "think"]);

/**
 * Foundry's `CONST.CHAT_MESSAGE_STYLES`, mirrored for Node. The glue passes the live constant to
 * `buildMessage`, so this mirror only ever drives the check tool.
 */
export const CHAT_STYLES = Object.freeze({ OTHER: 0, OOC: 1, IC: 2, EMOTE: 3 });

/**
 * The chat style each mode is posted with.
 *
 * IC for anything said or thought; EMOTE for Do, which is what Foundry's own `/em` posts; OOC for table
 * talk. Narrator is IC: it is in the fiction, spoken by nobody, and IC files it under the stream's
 * speech row on every path, including one that cannot read our flag.
 */
export const MODE_STYLES = Object.freeze({ say: "IC", do: "EMOTE", think: "IC", narrator: "IC", ooc: "OOC" });

export function styleFor(mode, styles = CHAT_STYLES) {
  const key = MODE_STYLES[mode];
  if (!key) throw new Error(`Unknown roleplay mode: ${mode}`);
  return styles[key];
}

/** True for every mode that is in character. */
export function isInCharacter(mode) {
  return RP_IC_MODES.includes(mode);
}

/* ── the composer ──────────────────────────────────────────────────────────── */

/** A composer state that has never been touched: the default is decided by whether there is a speaker. */
export const DEFAULT_COMPOSER = Object.freeze({ ic: null, sub: "say" });

export function sanitizeComposer(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    ic: typeof source.ic === "boolean" ? source.ic : null,
    sub: SUB_MODES.includes(source.sub) ? source.sub : "say"
  };
}

/**
 * The mode the next typed line is posted in.
 *
 * Default is IC/Say for anyone with a speaker, else OOC. Nobody without a speaker can be in character,
 * whatever they last chose: an unassigned player's switch is locked to OOC rather than failing on send.
 */
export function effectiveMode(state, hasSpeaker) {
  const s = sanitizeComposer(state);
  if (!hasSpeaker) return "ooc";
  const ic = s.ic ?? true;
  return ic ? s.sub : "ooc";
}

/** Alt+Q. Out of character ⇄ in character, returning to the last Say/Do/Think. */
export function toggleIc(state, hasSpeaker) {
  const s = sanitizeComposer(state);
  if (!hasSpeaker) return s;
  return { ...s, ic: effectiveMode(s, true) === "ooc" };
}

/** Alt+W. Say → Do → Think → Say. From OOC it lands in character, on the mode it was last in. */
export function cycleSub(state, hasSpeaker) {
  const s = sanitizeComposer(state);
  if (!hasSpeaker) return s;
  if (effectiveMode(s, true) === "ooc") return { ...s, ic: true };
  const next = SUB_MODES[(SUB_MODES.indexOf(s.sub) + 1) % SUB_MODES.length];
  return { ...s, ic: true, sub: next };
}

/** Pick a sub-mode outright (a click on Say, Do or Think). */
export function chooseSub(state, sub) {
  const s = sanitizeComposer(state);
  return SUB_MODES.includes(sub) ? { ...s, ic: true, sub } : s;
}

/** Pick OOC or IC outright (a click on either segment). */
export function chooseIc(state, ic, hasSpeaker) {
  const s = sanitizeComposer(state);
  return { ...s, ic: Boolean(ic) && Boolean(hasSpeaker) };
}

/* ── slash commands ────────────────────────────────────────────────────────── */

/**
 * The commands that carry our mode for one message. Foundry already parses `/ic`, `/ooc`, `/em`,
 * `/emote` and `/me`; `/think` is new. Every other slash command — rolls, whispers, macros, a module's
 * own — is Foundry's, untouched.
 */
export const SLASH_MODES = Object.freeze({ ooc: "ooc", ic: "say", em: "do", emote: "do", me: "do", think: "think" });

const SPACE = "(?:\\s|&nbsp;|\\u00a0)";
const SLASH = new RegExp(`^\\/(${Object.keys(SLASH_MODES).join("|")})(?:${SPACE}+([\\s\\S]*))?$`, "i");

/**
 * What a typed message is.
 *
 * `html` is what Foundry's chat input hands the `chatMessage` hook: ProseMirror HTML on v14 (`<p>…</p>`),
 * plain text from a v13 textarea. The outer paragraph is stripped exactly as Foundry's own parser
 * strips it, and newlines become `<br>` exactly as its chat commands do.
 *
 * @returns {{pass: true} | {pass: false, mode: string, body: string, override: boolean}}
 *   `pass` when the message is Foundry's to handle. Otherwise the mode to post in, the content, and
 *   whether a slash command chose the mode (an override is posted publicly, as Foundry's are).
 */
export function parseInput(html, mode) {
  const source = typeof html === "string" ? html.trim() : "";
  const inner = source.replace(/^<p>|<\/p>$/gi, "");
  if (inner.startsWith("/")) {
    const match = inner.match(SLASH);
    if (!match) return { pass: true };
    return { pass: false, mode: SLASH_MODES[match[1].toLowerCase()], body: tidyBody(match[2] ?? ""), override: true };
  }
  if (!RP_MODES.includes(mode)) return { pass: true };
  return { pass: false, mode, body: tidyBody(inner), override: false };
}

/**
 * The mode a line is posted in once its speaker is known. The Narrator has one voice: anything in
 * character it says — typed, or by `/ic`, `/em` or `/think` — is narration.
 */
export function lineMode(mode, speakerKind) {
  if (!RP_MODES.includes(mode)) return "ooc";
  if (mode === "ooc") return "ooc";
  return speakerKind === "narrator" ? "narrator" : mode === "narrator" ? "say" : mode;
}

/** The composer's mode for a speaker: `effectiveMode`, with the Narrator's lines as narration. */
export function composerMode(state, speakerKind) {
  return lineMode(effectiveMode(state, Boolean(speakerKind)), speakerKind);
}

function tidyBody(html) {
  return String(html)
    .replace(/^(?:\s|&nbsp;| )+|(?:\s|&nbsp;| )+$/g, "")
    .replace(/\n/g, "<br>");
}

/** True when a body has something in it once the markup is gone. */
export function hasText(html) {
  return textOf(html).length > 0;
}

/** Plain text of a chat body, for lifetimes and for the overlays, which never take markup. */
export function textOf(html) {
  if (typeof html !== "string") return "";
  return html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/(p|div|li)>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (m, e) => ({ amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", nbsp: " " })[e])
    .replace(/\s+/g, " ")
    .trim();
}

/* ── visibility of what is posted ──────────────────────────────────────────── */

/**
 * The message mode (`CONFIG.ChatMessage.modes`) a line is posted under.
 *
 * Exactly what Foundry does with typed text: a plain line follows the user's message-mode buttons (so
 * "Private GM" whispers it), and a slash command is public. Foundry's own "In character" mode is
 * this feature's switch now and is hidden while it runs; a client still holding it posts publicly.
 */
export function visibilityMode(coreMode, override) {
  if (override) return "public";
  if (!coreMode || coreMode === "ic") return "public";
  return coreMode;
}

/* ── Do lines and the speaker's name ───────────────────────────────────────── */

/**
 * A Do line is stored without its speaker's name in front, and every surface puts the name back.
 *
 * Stored with the name baked in, a line from a creature whose name is hidden would carry that name in
 * its content to every client, and the chat log, the bubble and the stream card would each have to
 * find it and cut it out again. Stored without it, each surface prefixes whichever name its viewer may
 * see — the name, or "Unknown".
 *
 * So the writer may type the name or not. "Seri draws her blade", "Seri Valen draws her blade" and
 * "draws her blade" all store "draws her blade" for a speaker called Seri Valen. The first word only
 * counts when the name has more than one; "Seri's eyes narrow" keeps its "'s".
 *
 * Only a name at the very start of the markup is cut: one wrapped in a tag is left exactly as typed.
 *
 * @returns {{body: string, matched: "full"|"first"|null}}
 */
export function stripLeadName(name, html) {
  const body = typeof html === "string" ? html : "";
  const full = typeof name === "string" ? name.trim() : "";
  if (!full) return { body, matched: null };
  const candidates = [["full", full]];
  const first = full.split(/\s+/)[0];
  if (first && first !== full) candidates.push(["first", first]);
  for (const [kind, candidate] of candidates) {
    for (const spelled of new Set([candidate, escapeText(candidate)])) {
      if (body.length < spelled.length) continue;
      if (body.slice(0, spelled.length).toLowerCase() !== spelled.toLowerCase()) continue;
      const rest = body.slice(spelled.length);
      if (rest && !BOUNDARY.test(rest)) continue;
      return { body: rest.replace(/^(?:\s|&nbsp;| )+/, ""), matched: kind };
    }
  }
  return { body, matched: null };
}

/** What may follow a name for it to be the whole name: the end, a space, punctuation or a possessive. */
const BOUNDARY = /^(?:\s|&nbsp;| |[.,;:!?…'’)\]-]|<br)/i;

/** The joint between the bold name and the rest of a Do line: none before punctuation or a possessive. */
export function leadJoint(rest) {
  return /^[.,;:!?…'’)\]]/.test(typeof rest === "string" ? rest : "") ? "" : " ";
}

function escapeText(text) {
  return text.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
}

/* ── building the message ──────────────────────────────────────────────────── */

/**
 * The ChatMessage data and create options for a line.
 *
 * @param {object} p
 * @param {string} p.mode           say | do | think | narrator | ooc
 * @param {string} p.body           content HTML as typed (a Do line's name is cut here)
 * @param {object|null} p.speaker   `ChatMessage.getSpeaker(...)` for an actor or token; for Narrator,
 *                                  `{ scene, actor: null, token: null, alias }`; ignored for OOC
 * @param {string} p.authorId
 * @param {string} p.messageMode    from `visibilityMode`
 * @param {object} [p.styles]       `CONST.CHAT_MESSAGE_STYLES`
 */
export function buildMessage({ mode, body, speaker, authorId, messageMode, styles = CHAT_STYLES }) {
  if (!RP_MODES.includes(mode)) throw new Error(`Unknown roleplay mode: ${mode}`);
  const content = mode === "do" ? stripLeadName(speaker?.alias ?? "", body).body : body;
  const data = { author: authorId, content, style: styleFor(mode, styles), flags: rpModeFlags(mode) };
  // OOC is the author talking, so it carries no speaker — exactly as Foundry's own /ooc deletes it.
  if (mode !== "ooc" && speaker) data.speaker = { ...speaker };
  // `chatBubble: false` is explicit because Foundry defaults it on for its own IC mode: this feature
  // draws its own bubbles, and a core bubble beside one would say every line twice.
  return { data, options: { messageMode, chatBubble: false } };
}

/** The speaker data a Narrator line is posted under: nobody, on the scene being viewed. */
export function narratorSpeaker(sceneId, alias) {
  return { scene: sceneId ?? null, actor: null, token: null, alias };
}

/* ── who speaks ────────────────────────────────────────────────────────────── */

/**
 * A player's speaker: the actor they picked if they still own it, else their assigned character, else
 * the first actor they own. None at all and the switch is locked to OOC.
 *
 * @param {{choice?: string|null, character?: {id: string}|null, owned: {id: string}[]}} p
 * @returns {{id: string, source: "chosen"|"assigned"|"owned"}|null}
 */
export function resolvePlayerSpeaker({ choice = null, character = null, owned = [] } = {}) {
  const list = Array.isArray(owned) ? owned : [];
  if (choice && list.some((a) => a.id === choice)) return { id: choice, source: choice === character?.id ? "assigned" : "chosen" };
  if (character?.id) return { id: character.id, source: "assigned" };
  return list.length ? { id: list[0].id, source: "owned" } : null;
}

/**
 * A GM's speaker. A pin wins while what it names still exists; otherwise the chip follows the
 * controlled token, and falls back to Narrator with nothing controlled.
 *
 * @param {{pin?: object|null, pinExists?: boolean, controlled?: {tokenId: string, sceneId: string}|null}} p
 * @returns {{kind: "narrator"|"token", source: "auto"|"pinned", sceneId?: string, tokenId?: string}}
 */
export function resolveGmSpeaker({ pin = null, pinExists = false, controlled = null } = {}) {
  const p = sanitizePin(pin);
  if (p?.kind === "narrator") return { kind: "narrator", source: "pinned" };
  if (p?.kind === "token" && pinExists) return { kind: "token", source: "pinned", sceneId: p.sceneId, tokenId: p.tokenId };
  if (controlled?.tokenId) return { kind: "token", source: "auto", sceneId: controlled.sceneId ?? null, tokenId: controlled.tokenId };
  return { kind: "narrator", source: "auto" };
}

export function sanitizePin(value) {
  if (!value || typeof value !== "object") return null;
  if (value.kind === "narrator") return { kind: "narrator" };
  if (value.kind === "token" && typeof value.tokenId === "string" && value.tokenId) {
    return { kind: "token", sceneId: typeof value.sceneId === "string" ? value.sceneId : null, tokenId: value.tokenId };
  }
  return null;
}

/* ── privacy ───────────────────────────────────────────────────────────────── */

/**
 * Whether a viewer may read a line at all. The message's own visibility, exactly: Foundry's
 * `ChatMessage#isContentVisible`. A bubble, a caption or a restyled entry is the message, drawn
 * somewhere else, so it shows to exactly the people the message shows to and to nobody more.
 */
export function canView({ whisper = [], blind = false, authorId = null, viewerId = null, viewerIsGM = false } = {}) {
  const recipients = Array.isArray(whisper) ? whisper : [];
  if (authorId && authorId === viewerId) return !(blind && !viewerIsGM);
  if (recipients.length && !recipients.includes(viewerId)) return false;
  return true;
}

/**
 * The name a viewer is shown for a speaker. A GM always reads the name (and is told it is hidden);
 * anybody else reads "Unknown" when `speakerNameHidden` said so. The art is never part of this.
 *
 * @returns {{name: string|null, unknown: boolean, hiddenFromPlayers: boolean}}  null name = print "Unknown"
 */
export function nameFor({ name, hidden, viewerIsGM }) {
  if (hidden && !viewerIsGM) return { name: null, unknown: true, hiddenFromPlayers: true };
  return { name: name ?? "", unknown: false, hiddenFromPlayers: Boolean(hidden) };
}

/* ── where a line is drawn ─────────────────────────────────────────────────── */

/**
 * Where a line goes on one viewer's screen.
 *
 *   "balloon"  over the token (Say, Think)
 *   "under"    a caption under the token (Do)
 *   "caption"  the caption lane: Narrator, an off-scene speaker, a token this viewer cannot see, or one
 *              off the edge of their screen
 *   null       not drawn: OOC, a line this viewer may not read, overlays off here, or the stream login
 *              with bubbles suppressed (its card already shows the line)
 */
export function routeLine({ mode, canRead, overlaysOn, suppressed, token = null }) {
  if (!isInCharacter(mode) || !canRead || !overlaysOn || suppressed) return null;
  if (mode === "narrator") return "caption";
  if (!token || !token.onScene || !token.visible || !token.onScreen) return "caption";
  return mode === "do" ? "under" : "balloon";
}

/** How long a line stays up: 4s, plus 60ms a character, never more than 12s. */
export const LIFETIME = Object.freeze({ base: 4000, perChar: 60, max: 12000 });

export function lifetimeMs(text) {
  const chars = typeof text === "string" ? text.length : 0;
  return Math.min(LIFETIME.max, LIFETIME.base + LIFETIME.perChar * chars);
}

/** How many lines a token holds above or below it, and the caption lane holds. */
export const STACK = Object.freeze({ token: 2, lane: 3 });

/**
 * A new line joins a stack; the oldest leaves when it is full. The list runs oldest first.
 * @returns {{list: any[], evicted: any[]}}
 */
export function pushStack(list, entry, max) {
  const next = [...(Array.isArray(list) ? list : []), entry];
  const over = Math.max(0, next.length - Math.max(1, max));
  return { list: next.slice(over), evicted: next.slice(0, over) };
}

/**
 * The scale an overlay over the canvas is drawn at for a canvas zoom: it follows the zoom a little so
 * a bubble belongs to its token, and is clamped so it stays readable zoomed out and never swamps the
 * scene zoomed in.
 */
export const ZOOM_CLAMP = Object.freeze({ min: 0.8, max: 1.15 });

export function overlayScale(zoom) {
  const z = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  return Math.min(ZOOM_CLAMP.max, Math.max(ZOOM_CLAMP.min, Math.sqrt(z)));
}

/** Whether a point lies within the viewport, with a margin so a token at the very edge counts as off. */
export function onScreen(point, viewport, margin = 24) {
  if (!point || !viewport) return false;
  return point.x >= viewport.left + margin && point.x <= viewport.right - margin
    && point.y >= viewport.top + margin && point.y <= viewport.bottom - margin;
}

/* ── keyboard ──────────────────────────────────────────────────────────────── */

/**
 * Whether a keydown matches a Foundry keybinding (`{ key: KeyboardEvent.code, modifiers: [...] }`).
 *
 * Foundry runs no keybinding while a text input has focus, and the chat box always has it while
 * somebody is typing, so the chat box checks its own keydowns against the *configured* bindings with
 * this. Every modifier the binding names must be held, and no other: Alt+Q is not Ctrl+Alt+Q. Meta
 * counts as Control, as it does in Foundry.
 */
export function bindingMatches(event, binding) {
  if (!event || !binding?.key || event.code !== binding.key) return false;
  const want = new Set((binding.modifiers ?? []).map((m) => String(m)));
  const held = { Alt: Boolean(event.altKey), Control: Boolean(event.ctrlKey || event.metaKey), Shift: Boolean(event.shiftKey) };
  return Object.entries(held).every(([mod, down]) => down === want.has(mod));
}

/** "Alt+Q" for `{ key: "KeyQ", modifiers: ["Alt"] }`. */
export function humanizeBinding(binding) {
  if (!binding?.key) return "";
  const key = String(binding.key).replace(/^Key/, "").replace(/^Digit/, "").replace(/^Numpad/, "Num ");
  return [...(binding.modifiers ?? []).map((m) => (m === "Control" ? "Ctrl" : m)), key].join("+");
}

/** A string as a CSS string literal, for the chat box's placeholder custom property. */
export function cssString(text) {
  return `"${String(text ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\A ")}"`;
}

/* ── i18n ──────────────────────────────────────────────────────────────────── */

/**
 * Every runtime-built key family, so the check tool can resolve each against the lang file. A key
 * built at runtime that is missing renders as the key itself, on every screen, with nothing reported.
 */
export const I18N = Object.freeze({
  /** The label a line carries in the log and over the bubble: Says, Does, Thinks, Narrator, OOC. */
  label: (mode) => `GLRP.label.${mode}`,
  /** The Say / Do / Think buttons. */
  sub: (sub) => `GLRP.switch.${sub}`,
  /** The chat box's placeholder per mode. */
  placeholder: (mode) => `GLRP.placeholder.${mode}`,
  /** The chip's source tag: AUTO, PINNED. */
  source: (source) => `GLRP.chip.${source}`
});

export const I18N_FAMILIES = Object.freeze({
  label: RP_MODES,
  sub: SUB_MODES,
  placeholder: ["say", "do", "think", "narrator", "ooc"],
  source: ["auto", "pinned"]
});
