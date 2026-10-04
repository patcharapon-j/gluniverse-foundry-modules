/**
 * GLUniverse Stream — what the chat overlay is allowed to show.
 *
 * Pure: no `game`, no DOM, importable under plain Node. One vocabulary of content types, each switched
 * separately for what a **player** posted and what the **GM** posted, read by every path that puts a card
 * on the stream:
 *
 *   - the cloned chat card (`chat-overlay.js`), which every non-PF2e world uses;
 *   - the PF2e roll card reader (`stream-cards/pf2e/read-message.js`);
 *   - the PF2e status card reader (`stream-cards/pf2e/read-status.js`), where the column is whose
 *     creature it is rather than who posted, since a condition is posted by nobody.
 *
 * The rows are one statement here. A row that one reader classified and another did not would be a
 * switch that works on one kind of world and silently does nothing on the other.
 *
 * Whispers and other players' blind rolls are not rows: they never reach the stream whatever is ticked
 * here, because a setting that could put a private message on a broadcast is not a preference.
 */

/** The two columns. `player` is anyone who is not a GM. */
export const CHAT_FILTER_AUTHORS = Object.freeze(["player", "gm"]);

/**
 * Every row, grouped as the settings page lays them out. `pf2e: true` rows only ever match in a PF2e
 * world; `other` only ever matches on the cloned-card path, since PF2e roll cards never draw a card they
 * cannot read. `defaults` is per column.
 */
export const CHAT_FILTER_GROUPS = Object.freeze([
  {
    id: "checks",
    rows: [
      { id: "attack", pf2e: true },
      { id: "skill", pf2e: true },
      { id: "save", pf2e: true },
      { id: "perception", pf2e: true },
      { id: "initiative", pf2e: true },
      { id: "flat", pf2e: true },
      { id: "counteract", pf2e: true },
      { id: "check", pf2e: true }
    ]
  },
  {
    id: "actions",
    rows: [
      { id: "damage", pf2e: true },
      { id: "spell", pf2e: true },
      { id: "action", pf2e: true }
    ]
  },
  {
    id: "dice",
    rows: [{ id: "roll" }]
  },
  {
    id: "chat",
    rows: [{ id: "speech" }, { id: "emote" }, { id: "ooc" }]
  },
  {
    id: "status",
    rows: [
      { id: "condition", pf2e: true },
      // There are a great many effects — every spell effect, stance and feat effect — so they start off.
      { id: "effect", pf2e: true, defaults: { player: false, gm: false } }
    ]
  },
  {
    id: "other",
    rows: [{ id: "other" }]
  }
]);

export const CHAT_FILTER_ROWS = Object.freeze(CHAT_FILTER_GROUPS.flatMap((group) => group.rows.map((row) => ({ ...row, group: group.id }))));

/**
 * Finer controls on what a card says, as opposed to whether it appears. Each is per column, and a column
 * a detail cannot apply to is absent rather than a switch that does nothing: a GM roll never shows its DC
 * and never names a player, so those two have no GM column.
 */
export const CHAT_FILTER_DETAILS = Object.freeze([
  { id: "degree", authors: ["player", "gm"] },
  { id: "dc", authors: ["player"] },
  { id: "target", authors: ["player", "gm"] },
  { id: "playerName", authors: ["player"] }
]);

export const DEFAULT_CHAT_FILTER = Object.freeze({
  rows: Object.freeze(Object.fromEntries(CHAT_FILTER_ROWS.map((row) => [row.id, Object.freeze({ player: true, gm: true, ...(row.defaults ?? {}) })]))),
  details: Object.freeze(Object.fromEntries(CHAT_FILTER_DETAILS.map((d) => [d.id, Object.freeze(Object.fromEntries(d.authors.map((a) => [a, true])))])))
});

/**
 * Rebuilt from the defaults' keys, so a row this module no longer reads drops out on the next save and a
 * row a world has never stored arrives at its default rather than as `undefined` — which every gate below
 * would read as "off", hiding a content type nobody switched off.
 */
export function sanitizeChatFilter(value) {
  const source = value && typeof value === "object" ? value : {};
  const rows = {};
  for (const [id, fallback] of Object.entries(DEFAULT_CHAT_FILTER.rows)) {
    rows[id] = pickAuthors(source.rows?.[id], fallback);
  }
  const details = {};
  for (const [id, fallback] of Object.entries(DEFAULT_CHAT_FILTER.details)) {
    details[id] = pickAuthors(source.details?.[id], fallback);
  }
  return { rows, details };
}

function pickAuthors(stored, fallback) {
  const out = {};
  for (const [author, value] of Object.entries(fallback)) {
    out[author] = stored && typeof stored === "object" && author in stored ? Boolean(stored[author]) : value;
  }
  return out;
}

/** Which column a message falls in. */
export function authorColumn(isGM) {
  return isGM ? "gm" : "player";
}

/** True when a row is shown for an author. An unknown row is refused: it is nothing the GM could switch. */
export function allows(filter, rowId, author) {
  const row = (filter ?? DEFAULT_CHAT_FILTER).rows?.[rowId];
  return Boolean(row && row[author]);
}

/** True when a detail is shown for an author. A detail with no column for that author is never shown. */
export function showsDetail(filter, detailId, author) {
  const detail = (filter ?? DEFAULT_CHAT_FILTER).details?.[detailId];
  return Boolean(detail && detail[author]);
}

/** PF2e's check context types, and the row each belongs to. */
export const PF2E_CHECK_ROWS = Object.freeze({
  "attack-roll": "attack",
  "skill-check": "skill",
  "saving-throw": "save",
  "perception-check": "perception",
  initiative: "initiative",
  "flat-check": "flat",
  "counteract-check": "counteract",
  check: "check"
});

/** Foundry's chat styles a person typed, and their row. Style OTHER (0) is every document's default. */
export const TEXT_STYLE_ROWS = Object.freeze({ 1: "ooc", 2: "speech", 3: "emote" });

/**
 * The row a chat message belongs to on the cloned-card path, from plain facts about it.
 *
 * PF2e's own context type is honoured when it is there, so a PF2e world without roll cards still files
 * an attack under Attacks; any other system's dice are a plain roll; a line somebody typed is filed by
 * its style; and everything else — item cards, system summaries, module messages — is `other`.
 *
 * @param {{style?: number, rollCount?: number, contextType?: string|null, casting?: boolean, originType?: string|null}} facts
 */
export function classifyMessage({ style = 0, rollCount = 0, contextType = null, casting = false, originType = null } = {}) {
  if (contextType && PF2E_CHECK_ROWS[contextType]) return PF2E_CHECK_ROWS[contextType];
  if (contextType === "damage-roll") return "damage";
  if (contextType === "spell-cast" || casting) return "spell";
  if (!contextType && rollCount === 0 && /^(action|feat)$/.test(originType ?? "")) return "action";
  if (rollCount > 0) return "roll";
  return TEXT_STYLE_ROWS[style] ?? "other";
}
