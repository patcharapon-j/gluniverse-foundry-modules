/**
 * GLUniverse Stream — what the chat overlay is allowed to show.
 *
 * Pure: no `game`, no DOM, importable under plain Node. One vocabulary of content types, each switched
 * separately for what a **player** posted and what the **GM** posted, read by every path that puts a card
 * on the stream:
 *
 *   - the cloned chat card (`chat-overlay.js`), which every world without roll cards uses;
 *   - the PF2e roll card reader (`stream-cards/pf2e/read-message.js`);
 *   - the Daggerheart roll card reader (`stream-cards/daggerheart/read-message.js`);
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

/** The game systems with a reader of their own. Their ids are the `systems` tags below. */
export const PF2E_SYSTEM = "pf2e";
export const DAGGERHEART_SYSTEM = "gluniverse-daggerheart";

/**
 * The systems the stream's roll cards are drawn for (`stream-cards`). In these worlds the overlay clones
 * no chat card, so the finer "card details" below apply; anywhere else they are a switch that does
 * nothing and the page does not offer them.
 */
export const ROLL_CARD_SYSTEMS = Object.freeze([PF2E_SYSTEM, DAGGERHEART_SYSTEM]);

const PF2E = Object.freeze([PF2E_SYSTEM]);
const DAGGERHEART = Object.freeze([DAGGERHEART_SYSTEM]);

/**
 * Every row, grouped as the settings page lays them out. A row tagged with `systems` only ever matches in
 * a world running one of them, so the page offers it nowhere else; an untagged row can match anywhere.
 * `other` only ever matches on the cloned-card path, since roll cards never draw a card they cannot read.
 * `defaults` is per column.
 */
export const CHAT_FILTER_GROUPS = Object.freeze([
  {
    id: "checks",
    rows: [
      { id: "attack", systems: PF2E },
      { id: "skill", systems: PF2E },
      { id: "save", systems: PF2E },
      { id: "perception", systems: PF2E },
      { id: "initiative", systems: PF2E },
      { id: "flat", systems: PF2E },
      { id: "counteract", systems: PF2E },
      { id: "check", systems: PF2E },
      // Daggerheart: a Hope/Fear roll, the same dice thrown as a reaction, and the GM's d20.
      { id: "duality", systems: DAGGERHEART },
      { id: "reaction", systems: DAGGERHEART },
      { id: "adversary", systems: DAGGERHEART }
    ]
  },
  {
    id: "actions",
    rows: [
      // One meaning in both systems: a damage roll, merged under the attack that caused it.
      { id: "damage", systems: Object.freeze([PF2E_SYSTEM, DAGGERHEART_SYSTEM]) },
      { id: "spell", systems: PF2E },
      { id: "action", systems: PF2E },
      // A card or one of its features posted from a Daggerheart sheet.
      { id: "feature", systems: DAGGERHEART }
    ]
  },
  {
    id: "dice",
    rows: [{ id: "roll" }]
  },
  {
    id: "chat",
    rows: [
      // A Roleplay Chat Narrator line files here too: it is something said, by nobody in particular.
      { id: "speech" },
      { id: "emote" },
      // A Roleplay Chat Think line. Visible to the whole table, so it is the stream's to show.
      { id: "thought" },
      // Table talk is the table's, not the broadcast's: off until a GM decides otherwise.
      { id: "ooc", defaults: { player: false, gm: false } }
    ]
  },
  {
    id: "status",
    rows: [
      { id: "condition", systems: PF2E },
      // There are a great many effects — every spell effect, stance and feat effect — so they start off.
      { id: "effect", systems: PF2E, defaults: { player: false, gm: false } }
    ]
  },
  {
    id: "other",
    rows: [{ id: "other" }]
  }
]);

export const CHAT_FILTER_ROWS = Object.freeze(CHAT_FILTER_GROUPS.flatMap((group) => group.rows.map((row) => ({ ...row, group: group.id }))));

/** Whether a row can match in a world running `systemId`. An untagged row matches everywhere. */
export function rowAppliesTo(row, systemId) {
  return !Array.isArray(row?.systems) || row.systems.includes(systemId);
}

/** Whether the stream draws its own roll cards in a world running `systemId`. */
export function hasRollCards(systemId) {
  return ROLL_CARD_SYSTEMS.includes(systemId);
}

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
 * A Roleplay Chat line's mode (`core/rp-mode.mjs`), and its row. The mode wins over the style: Think is
 * posted as IC and would otherwise file as speech. Kept in step with `RP_TEXT` in
 * `stream-cards/text/read-text.js`, which the roll-card path reads; the tests hold the two together.
 */
export const RP_MODE_ROWS = Object.freeze({ say: "speech", narrator: "speech", do: "emote", think: "thought", ooc: "ooc" });

/**
 * A Daggerheart message's `kind` flag (`flags["gluniverse-daggerheart"].kind`), and its row. A duality
 * roll thrown as a reaction files under `reaction` instead (see `daggerheartRowOf`). Kinds missing here —
 * the rest summary, anything the system adds later — are `other`: a roll card is never drawn for them.
 * Kept in step with the Daggerheart reader (`stream-cards/daggerheart/read-message.js`); the tests hold
 * the two together.
 */
export const DAGGERHEART_KIND_ROWS = Object.freeze({ duality: "duality", damage: "damage", adversary: "adversary", card: "feature" });

/** The row a Daggerheart message files under, or null when its kind is not one the stream reads. */
export function daggerheartRowOf(kind, reaction = false) {
  const row = DAGGERHEART_KIND_ROWS[kind] ?? null;
  return row === "duality" && reaction ? "reaction" : row;
}

/**
 * The row a chat message belongs to on the cloned-card path, from plain facts about it.
 *
 * PF2e's own context type is honoured when it is there, so a PF2e world without roll cards still files
 * an attack under Attacks; a Daggerheart message is filed by its kind the same way; any other system's
 * dice are a plain roll; a Roleplay Chat line is filed by its mode; a line somebody typed is filed by its
 * style; and everything else — item cards, system summaries, module messages — is `other`.
 *
 * @param {{style?: number, rollCount?: number, contextType?: string|null, casting?: boolean, originType?: string|null, rpMode?: string|null, dhKind?: string|null, dhReaction?: boolean}} facts
 */
export function classifyMessage({ style = 0, rollCount = 0, contextType = null, casting = false, originType = null, rpMode = null, dhKind = null, dhReaction = false } = {}) {
  if (contextType && PF2E_CHECK_ROWS[contextType]) return PF2E_CHECK_ROWS[contextType];
  if (contextType === "damage-roll") return "damage";
  if (contextType === "spell-cast" || casting) return "spell";
  if (!contextType && rollCount === 0 && /^(action|feat)$/.test(originType ?? "")) return "action";
  if (dhKind) return daggerheartRowOf(dhKind, dhReaction) ?? "other";
  if (rollCount > 0) return "roll";
  if (rpMode && RP_MODE_ROWS[rpMode]) return RP_MODE_ROWS[rpMode];
  return TEXT_STYLE_ROWS[style] ?? "other";
}
