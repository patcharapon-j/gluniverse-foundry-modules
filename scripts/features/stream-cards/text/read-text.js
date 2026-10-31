/**
 * A chat message somebody typed -> the text half of a stream card. System-agnostic.
 *
 * Pure: no `game`, no DOM, importable under plain Node. Every system reader builds its card from this
 * (the PF2e reader in `../pf2e/read-message.js` today), so a line of speech reads the same on every
 * kind of world and a filter row means the same thing on all of them.
 *
 * What a reader hands in is the plain message (`raw`) and the identity it has already decided for the
 * speaker (`actor`), including whether that name is hidden. What comes back is the card's text model,
 * or null when the stream must not show this message at all.
 *
 *   import { readText, isTypedText, textRowOf, speakerNameHidden } from "../text/read-text.js";
 *
 *   if (!isTypedText(raw)) return null;                          // not something a person typed
 *   if (!allows(filter, textRowOf(raw), author)) return null;     // the GM's chat filter
 *   const text = readText(raw, { actor, authorName });           // null for a whisper or a blind line
 *
 * `raw` is the shape `pf2e/snapshot.js` captures: `{ style, content, speaker: { alias }, flags,
 * whisper: string[], blind: boolean }`. Nothing else is read.
 *
 * `actor` is a card identity: `{ name: string|null, isNpc, img, imgKind, focus }`. A `name` of null
 * means the reader decided players may not see it (use `speakerNameHidden` to decide), and nothing
 * here fills it back in — the card shows "Unknown" through `nameKey` instead, with the art kept.
 */

import { rpModeOf } from "../../../core/rp-mode.mjs";

/**
 * Foundry's chat styles, and the label each one headlines with.
 *
 * Only these three become cards. Style OTHER (0) is the default every *document* carries — every roll,
 * every PF2e item card, every module's status summary — so accepting it would put the whole of a
 * session's chat traffic on the stream, at roll-card weight, with nothing to switch off but the
 * feature. A message someone typed carries IC, EMOTE or OOC, and that is the whole test.
 *
 * `row` is the stream chat filter's row (`stream/chat-filter.mjs`), `key` the card's label key
 * (`GLUNIVERSE_STREAM.rollCard.<key>`), `name` the quote's `data-style`.
 */
export const TEXT_STYLES = Object.freeze({
  1: { row: "ooc", key: "OutOfCharacter", name: "ooc" },
  2: { row: "speech", key: "Says", name: "speech" },
  3: { row: "emote", key: "Emotes", name: "emote" }
});

/**
 * A Roleplay Chat line, by the mode flag it carries (`core/rp-mode.mjs`). The flag wins over the style:
 * Think is posted as IC and would otherwise read as speech, and Narrator as IC with no actor.
 *
 * `tone` is the card's `data-tone`; its colour lives in `styles/roleplay-chat.css`, beside the rest of
 * that feature's mode hues, not in the card sheet.
 */
export const RP_TEXT = Object.freeze({
  say: Object.freeze({ row: "speech", key: "Says", name: "speech", tone: "say" }),
  do: Object.freeze({ row: "emote", key: "Does", name: "emote", tone: "do" }),
  think: Object.freeze({ row: "thought", key: "Thinks", name: "thought", tone: "think" }),
  narrator: Object.freeze({ row: "speech", key: "Narration", name: "narration", tone: "narrator", narrator: true }),
  ooc: Object.freeze({ row: "ooc", key: "OutOfCharacter", name: "ooc", tone: null })
});

/** A quote longer than this is cut: the card is a glance, and it has three lines to give. */
export const MAX_QUOTE = 240;

/** The name a narrator line shows when its message somehow carries no alias. */
const NARRATOR_FALLBACK = "Narrator";

/** Token display modes a player can read a name under: HOVER (30) and ALWAYS (50). Mirrors CONST. */
const PUBLIC_NAME_MODES = Object.freeze([30, 50]);

/** The style entry a message reads with, or null when nobody typed it. */
export function textStyleOf(raw) {
  const mode = rpModeOf(raw?.flags);
  if (mode) return RP_TEXT[mode];
  return TEXT_STYLES[raw?.style] ?? null;
}

/** True when this is a line somebody typed with something in it. */
export function isTypedText(raw) {
  return Boolean(textStyleOf(raw) && plainText(raw?.content));
}

/** The chat-filter row a typed line answers to, or null. */
export function textRowOf(raw) {
  return textStyleOf(raw)?.row ?? null;
}

/**
 * A typed line reaches the stream only when everybody could read it. A whisper is a whisper whoever it
 * is to, and a blind line is one its own author cannot read — unlike a blind *roll*, there is no
 * "that they rolled" to show without the content, so nothing of it may be shown.
 */
export function isPublicText(raw) {
  return !raw?.blind && !(Array.isArray(raw?.whisper) && raw.whisper.length > 0);
}

/**
 * Whether a speaker's name is hidden from players. One rule for every card and every Roleplay Chat
 * surface, so a name hidden on the stream is never printed over the token.
 *
 * A creature the GM runs (posted by a GM, owned by no player) whose token players cannot read the name
 * of, in a world that hides names at all. PF2e supplies `nameVisibility` (its "hide token names"
 * setting) and `playersCanSeeName` (its token getter). Elsewhere there is no world switch, so a reader
 * passes `nameVisibility: true` and `playersCanSeeName: playersSeeDisplayName(token.displayName)` — the
 * token's own nameplate setting.
 *
 * A missing answer reads as visible (`playersCanSeeName` must be exactly false): a speaker with no
 * token has no nameplate to hide behind.
 */
export function speakerNameHidden({ authorIsGM, hasPlayerOwner, nameVisibility, playersCanSeeName } = {}) {
  return Boolean(authorIsGM) && !hasPlayerOwner && Boolean(nameVisibility) && playersCanSeeName === false;
}

/** Whether a token's nameplate mode lets a player read it. Null when the mode is unknown. */
export function playersSeeDisplayName(displayName) {
  return Number.isFinite(displayName) ? PUBLIC_NAME_MODES.includes(displayName) : null;
}

/**
 * The text half of a card: identity, headline, quote and tone.
 *
 * @param {object} raw  the plain message (see the module comment)
 * @param {object} [context]
 * @param {object|null} [context.actor]      the reader's identity for the speaker; `name: null` = hidden
 * @param {string|null} [context.authorName] the posting user, the last name a speaker falls back to
 * @returns {{actor: object, action: object, text: {body: string, style: string}, tone: string|null, fx: null}|null}
 *   null when the line is not public, nobody typed it, or there is nothing in it.
 *
 * A speaker with no actor behind it — a player typing with nothing selected — still has a name, so the
 * identity falls back to the speaker's alias and then to the author. A narrator line is nobody: it
 * shows the alias it was posted under and no art, whatever the message's actor resolves to.
 */
export function readText(raw, { actor = null, authorName = null } = {}) {
  if (!isPublicText(raw)) return null;
  const style = textStyleOf(raw);
  if (!style) return null;
  const body = plainText(raw?.content);
  if (!body) return null;
  const alias = typeof raw?.speaker?.alias === "string" ? raw.speaker.alias.trim() : "";
  const base = actor ?? { name: "", isNpc: false, img: null, imgKind: "portrait", focus: null };
  let identity;
  if (style.narrator) identity = { name: alias || NARRATOR_FALLBACK, isNpc: false, img: null, imgKind: "portrait", focus: null };
  else if (base.name === null) identity = { ...base, name: null, nameKey: "Unknown" };
  else identity = { ...base, name: base.name || alias || authorName || "" };
  return {
    actor: identity,
    action: { label: null, labelKey: style.key, sub: null, map: 0 },
    text: { body, style: style.name },
    tone: style.tone ?? null,
    fx: null
  };
}

/** Plain text out of chat HTML, collapsed and cut to length. Never returns null; "" means nothing to show. */
export function plainText(html) {
  if (typeof html !== "string") return "";
  const text = decodeEntities(
    html
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<\/(p|div|li|tr|h[1-6])>/gi, " ")
      .replace(/<[^>]+>/g, "")
  )
    .replace(/\s+/g, " ")
    .trim();
  return shorten(text, MAX_QUOTE) ?? "";
}

/** Trimmed and cut to `max` characters with an ellipsis, or null when empty. */
export function shorten(value, max) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** The handful of entities chat HTML actually carries. */
export function decodeEntities(text) {
  return text.replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (m, e) => ({ amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", nbsp: " " })[e]);
}
