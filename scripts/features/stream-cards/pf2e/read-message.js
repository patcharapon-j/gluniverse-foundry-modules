/**
 * PF2e chat message -> roll card model.
 *
 * Pure: no `game`, no DOM. It reads the plain snapshot built by `snapshot.js` (the same shape the
 * fixtures in tests/fixtures/pf2e were captured in) and decides what, if anything, the stream shows.
 */

import { isFocus } from "../framing/focus-math.js";

export const DEGREES = ["criticalFailure", "failure", "success", "criticalSuccess"];

/**
 * The check types the stream draws, each with the label key the card falls back to.
 *
 * A check whose chat flavor carries no heading — an inline `@Check[flat|dc:11]` off a condition card,
 * a macro-rolled check — used to headline with PF2e's raw context type, so the stream read
 * "flat-check" in the card's second-largest type. The reader hands over a *key* instead: it is pure,
 * so it cannot localise, and a raw system identifier is not a phrase to put on a stream.
 */
export const CHECK_TYPE_KEYS = Object.freeze({
  "attack-roll": "AttackRoll",
  "skill-check": "SkillCheck",
  "saving-throw": "SavingThrow",
  "perception-check": "PerceptionCheck",
  "flat-check": "FlatCheck",
  initiative: "Initiative",
  "counteract-check": "CounteractCheck",
  check: "Check"
});

const CHECK_TYPES = new Set(Object.keys(CHECK_TYPE_KEYS));

/**
 * The two kinds of message that are not PF2e's: a plain dice roll and something a person typed.
 *
 * In a PF2e world the overlay hands *every* new message to this feed and never clones a chat card, so
 * a `/r 2d6+3` and a line of speech used to reach the stream as nothing at all — the reader returned
 * null and no card was built, which looks exactly like the overlay being switched off. They are cards
 * now, behind these switches.
 *
 * The defaults live here, beside the gates that read them, rather than in `settings.js`: the reader is
 * the only thing that consults a row, and a row whose default said one thing here and another there
 * would be a switch that reads as off in a world that never stored it. `settings.js` re-exports this
 * object and its sanitizer rebuilds from these keys.
 */
export const DEFAULT_BASIC_CARDS = Object.freeze({
  /** Draw either kind at all. */
  enabled: true,
  /** A plain dice roll: `/r 2d6+3`, a macro roll, anything PF2e did not claim as a check or damage. */
  rolls: true,
  /** In-character speech. */
  speech: true,
  /** `/emote`. */
  emotes: true,
  /** Out-of-character chatter. */
  ooc: true,
  /** Messages the GM typed. Their own switch: a table may want the narration and not the table talk. */
  gm: true
});

/**
 * Foundry's chat styles, and the label each one headlines with.
 *
 * Only these three become cards. Style OTHER (0) is the default every *document* carries — every roll,
 * every PF2e item card, every module's status summary — so accepting it would put the whole of a PF2e
 * session's chat traffic on the stream, at roll-card weight, with nothing to switch off but the
 * feature. A message someone typed carries IC, EMOTE or OOC, and that is the whole test.
 */
export const TEXT_STYLES = Object.freeze({
  1: { gate: "ooc", key: "OutOfCharacter", name: "ooc" },
  2: { gate: "speech", key: "Says", name: "speech" },
  3: { gate: "emotes", key: "Emotes", name: "emote" }
});

/** A quote longer than this is cut: the card is a glance, and it has three lines to give. */
const MAX_QUOTE = 240;
/** A formula longer than this is cut: it sits on one line in the result column beside the total. */
const MAX_FORMULA = 22;
/** Individual dice shown under a plain roll before the rest are summarised away. */
const MAX_DICE_SHOWN = 8;

const DEFAULT_TOKEN_ICON = /(^|\/)(icons\/svg\/mystery-man\.svg|systems\/pf2e\/icons\/default-icons\/)/;

/**
 * @param {{raw: object, derived: object}} snapshot
 * @returns {RollCardModel|null} null when the stream must not show this message.
 */
export function readMessage(snapshot) {
  const raw = snapshot?.raw;
  const derived = snapshot?.derived;
  if (!raw || !derived) return null;

  const visibility = visibilityOf(raw, derived);
  if (!visibility) return null;

  const pf2e = raw.flags?.pf2e ?? {};
  const context = pf2e.context ?? null;
  const gates = gatesOf(derived);
  const kind = kindOf(pf2e, context, derived, raw, gates);
  if (!kind) return null;

  const base = {
    id: raw._id,
    kind,
    originKey: originKeyOf(pf2e.origin),
    isReroll: !!derived.isReroll,
    visibility,
    actor: actorOf(derived),
    player: derived.authorIsGM ? null : { name: derived.authorName ?? "" },
    target: isSelfTarget(raw, context) ? null : targetOf(derived),
    action: null,
    roll: null,
    spell: null,
    damage: null,
    text: null,
    fx: null
  };

  if (kind === "check") return { ...base, ...readCheck(raw, context, derived) };
  if (kind === "damage") return { ...base, ...readDamage(raw, derived) };
  if (kind === "cast") return { ...base, ...readCast(pf2e, derived) };
  if (kind === "roll") return { ...base, ...readPlainRoll(raw, derived) };
  if (kind === "text") return { ...base, ...readText(raw, derived, base) };
  const cost = derived.item?.actionCost ?? null;
  return {
    ...base,
    action: {
      label: derived.item?.name ?? headingText(raw.content) ?? "",
      labelKey: null,
      sub: null,
      map: 0,
      cost: cost ? { type: cost.type ?? "action", value: cost.value ?? null } : null
    }
  };
}

/** "public", "ownBlind" (a player's own blind roll), or null for anything the stream must not show. */
export function visibilityOf(raw, derived) {
  const whispered = (raw.whisper?.length ?? 0) > 0;
  if (raw.blind) return derived.authorIsGM ? null : "ownBlind";
  if (whispered) return null;
  return "public";
}

/**
 * The switches, with the defaults standing in for a snapshot that carries none.
 *
 * The fixtures were captured before these existed and the check tools drive the reader directly, so an
 * absent `basicCards` must read as the shipped defaults rather than as an object of `undefined` — every
 * gate below would read that as off, which is the feature silently not existing.
 */
function gatesOf(derived) {
  const stored = derived?.basicCards;
  return stored && typeof stored === "object" ? { ...DEFAULT_BASIC_CARDS, ...stored } : DEFAULT_BASIC_CARDS;
}

function kindOf(pf2e, context, derived, raw, gates) {
  const type = context?.type;
  if (type && CHECK_TYPES.has(type)) return derived.rollCount > 0 ? "check" : null;
  if (type === "damage-roll") return derived.rollCount > 0 ? "damage" : null;
  if (type === "spell-cast" || pf2e.casting) return "cast";
  if (!type && pf2e.origin && derived.rollCount === 0 && /^(action|feat)$/.test(pf2e.origin.type ?? "")) return "action";
  // Anything left that carries dice is a plain roll: `/r 2d6+3`, a macro, a system PF2e has no context
  // type for. Anything left that carries none is a card only if a person typed it.
  if (derived.rollCount > 0) return gates.enabled && gates.rolls ? "roll" : null;
  return textKind(raw, derived, gates);
}

/** A typed message, or null. Style is the whole test — see TEXT_STYLES. */
function textKind(raw, derived, gates) {
  if (!gates.enabled) return null;
  const style = TEXT_STYLES[raw.style];
  if (!style || !gates[style.gate]) return null;
  if (derived.authorIsGM && !gates.gm) return null;
  return plainText(raw.content) ? "text" : null;
}

/**
 * A plain dice roll.
 *
 * It says the three things such a roll has to say and nothing else: what was rolled (the formula), what
 * each die came up (the faces), and the total. There is no degree of success because PF2e resolved
 * none — the card is deliberately silent about outcome rather than inventing one, exactly as a check
 * against no DC is.
 *
 * The natural d20 is shown only when the roll has exactly one d20 rolling exactly once, i.e. the
 * classic `1d20+N`. A `10d20` has no "natural" and a die drawn with one of its ten results on it would
 * be a lie about the roll.
 */
function readPlainRoll(raw, derived) {
  const roll = derived.rolls[0] ?? {};
  const natural = singleD20Of(roll);
  const heading = headingText(raw.flavor) || plainText(raw.flavor) || null;
  return {
    action: { label: heading, labelKey: heading ? null : "PlainRoll", sub: diceFaces(roll), map: 0 },
    roll: {
      natural,
      total: Number.isFinite(roll.total) ? roll.total : null,
      dc: null,
      dcVisible: false,
      degree: null,
      // Only a plain roll carries this. A check's `roll` keeps the shape PF2e gives it, and the card
      // draws the formula box from this field's presence alone.
      formula: shorten(roll.formula, MAX_FORMULA)
    },
    fx: fxOf(null, natural)
  };
}

/**
 * Something a person typed.
 *
 * The body is plain text, extracted here rather than in the card, because the card renders it through
 * `textContent`: a message is arbitrary HTML from any client in the world, and the stream is the one
 * screen in a session nobody is watching for a script tag.
 *
 * A speaker with no actor behind it — a player typing with nothing selected — still has a name, so the
 * identity falls back to the speaker's alias and then to the author. A name the GM has hidden stays
 * hidden: `actorOf` answers null there and nothing below may fill it back in.
 */
function readText(raw, derived, base) {
  const style = TEXT_STYLES[raw.style];
  const alias = typeof raw.speaker?.alias === "string" ? raw.speaker.alias.trim() : "";
  const actor = base.actor.name === null
    ? base.actor
    : { ...base.actor, name: base.actor.name || alias || derived.authorName || "" };
  return {
    actor,
    action: { label: null, labelKey: style.key, sub: null, map: 0 },
    text: { body: plainText(raw.content), style: style.name },
    fx: null
  };
}

/** The d20 a plain `1d20+N` came up, or null when the roll is not that shape. */
export function singleD20Of(roll) {
  const d20s = (roll?.dice ?? []).filter((d) => d.faces === 20 && Array.isArray(d.results));
  if (d20s.length !== 1 || d20s[0].results.length !== 1) return null;
  const result = d20s[0].results[0];
  return Number.isFinite(result) ? result : null;
}

/** "4 · 6 · 3" — what each die actually came up, under the headline. */
export function diceFaces(roll) {
  const faces = [];
  for (const die of roll?.dice ?? []) {
    for (const result of die?.results ?? []) {
      if (!Number.isFinite(result)) continue;
      if (faces.length >= MAX_DICE_SHOWN) return `${faces.join(" · ")} …`;
      faces.push(String(result));
    }
  }
  return faces.length ? faces.join(" · ") : null;
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

function shorten(value, max) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

function readCheck(raw, context, derived) {
  const roll = derived.rolls[0] ?? {};
  const natural = naturalOf(roll);
  const dcValue = Number.isFinite(context.dc?.value) ? context.dc.value : null;
  const degree = degreeOf(context, roll, dcValue);
  const heading = headingText(raw.flavor);
  const isSpellAttack = context.type === "attack-roll" && derived.item?.type === "spell";
  const map = mapOf(context.options);
  return {
    action: {
      label: isSpellAttack ? derived.item.name : heading ?? null,
      labelKey: isSpellAttack || heading ? null : CHECK_TYPE_KEYS[context.type] ?? null,
      sub: isSpellAttack ? heading : null,
      map
    },
    roll: {
      natural,
      total: roll.total ?? null,
      dc: dcValue,
      dcVisible: dcValue !== null && !derived.authorIsGM,
      degree
    },
    fx: fxOf(degree, natural)
  };
}

function readDamage(raw, derived) {
  const roll = derived.rolls[0] ?? {};
  const parts = (roll.instances ?? [])
    .filter((i) => !i.kinds || i.kinds.includes("damage"))
    .map((i) => ({ type: i.type ?? "untyped", amount: i.total ?? 0, persistent: !!i.persistent }));
  const crit = roll.degreeOfSuccess === 3;
  return {
    action: { label: headingText(raw.flavor) ?? derived.item?.name ?? "", labelKey: null, sub: null, map: 0 },
    damage: { total: roll.total ?? 0, parts, crit },
    fx: crit ? "pop" : null
  };
}

function readCast(pf2e, derived) {
  const item = derived.item ?? {};
  const defense = item.defense ?? {};
  const save = defense.save ?? null;
  const isAttack = !save && defense.passive?.statistic === "ac";
  return {
    action: { label: item.name ?? "", labelKey: null, sub: null, map: 0 },
    spell: {
      name: item.name ?? "",
      tradition: pf2e.casting?.tradition ?? null,
      rank: item.rank ?? null,
      isCantrip: !!item.isCantrip,
      dc: save ? item.spellDC ?? null : null,
      save: save ? { statistic: save.statistic, basic: !!save.basic } : null,
      attackBonus: isAttack ? item.spellAttack ?? null : null
    }
  };
}

/** The d20 that counted. Post-roll options are not used: a reroll copies them from the original roll. */
export function naturalOf(roll) {
  const results = roll?.d20Results;
  if (!Array.isArray(results)) return null;
  const active = results.filter((r) => r.active !== false);
  return active.length ? active[active.length - 1].result : null;
}

/**
 * The degree of success the card shows, or null when PF2e resolved none.
 *
 * It is deliberately **not** gated on a DC being in the message's context. PF2e resolves the outcome
 * itself and records it on the message and on the roll; where it puts the DC is its own business, and
 * a flat check — the DC 11 off a Concealed card, the DC 5 off Stupefied, a recovery check — is the
 * case where the two part company. Requiring `context.dc` there left every flat check on the stream
 * with no Success and no Failure on it, which is the one thing a flat check has to say, while the card
 * rendered perfectly.
 *
 * With a DC and a total but no outcome from the system, a **flat check** is still answerable: the
 * rules give it no critical degrees, so the comparison is the whole answer. Every other check type is
 * left alone — PF2e's ±10 bands and its natural-20 shift are the system's to apply, and guessing them
 * here would put a degree on the stream that the player's own chat card does not carry.
 */
export function degreeOf(context, roll, dcValue) {
  const resolved = degreeIndex(context?.outcome ?? roll?.degreeOfSuccess);
  if (resolved !== null) return resolved;
  if (context?.type !== "flat-check" || dcValue === null || !Number.isFinite(roll?.total)) return null;
  return roll.total >= dcValue ? 2 : 1;
}

export function degreeIndex(value) {
  if (typeof value === "number") return value >= 0 && value <= 3 ? value : null;
  const index = DEGREES.indexOf(value);
  return index === -1 ? null : index;
}

/** Cracks: gold on a critical success, red on a critical failure. With no DC, a natural 20 or 1 decides. */
export function fxOf(degree, natural) {
  if (degree === 3) return "gold";
  if (degree === 0) return "red";
  if (degree === null && natural === 20) return "gold";
  if (degree === null && natural === 1) return "red";
  return null;
}

function mapOf(options = []) {
  const option = options.find((o) => o.startsWith("map:increases:"));
  return option ? Number(option.split(":")[2]) || 0 : 0;
}

/** The origin item's UUID (it embeds the actor) is the merge key: damage joins the card whose roll came from the same weapon or spell. */
function originKeyOf(origin) {
  if (!origin?.uuid) return null;
  return origin.uuid;
}

function actorOf(derived) {
  const actor = derived.actor ?? {};
  const token = derived.token ?? {};
  const isNpc = !!derived.authorIsGM && !actor.hasPlayerOwner;
  const hiddenName = isNpc && !!derived.nameVisibilitySetting && token.playersCanSeeName === false;
  const tokenImg = usable(token.textureSrc);
  const own = artFor(actor.img, token.textureSrc, isNpc);
  // A GM roll with nothing of its own to show falls back to the world's default roll art.
  const fallback = own ? null : defaultArtOf(derived.authorIsGM ? derived.defaultArt : null);
  const img = own ?? fallback?.src ?? null;
  return {
    name: hiddenName ? null : token.name ?? actor.name ?? "",
    isNpc,
    img,
    imgKind: (img ? img === tokenImg : isNpc) ? "token" : "portrait",
    focus: fallback ? fallback.focus : focusFor(actor.focusOverrides, img)
  };
}

/** The world's picture for GM rolls with no art, with the framing the GM set for it. */
function defaultArtOf(defaultArt) {
  const src = typeof defaultArt?.src === "string" ? defaultArt.src.trim() : "";
  if (!src) return null;
  const focus = defaultArt.focus;
  return { src, focus: isFocus(focus) ? { x: focus.x, y: focus.y, w: focus.w } : null };
}

/** A GM's framing for this exact image, if one was set. */
function focusFor(overrides, img) {
  if (!img || !Array.isArray(overrides)) return null;
  const match = overrides.find(o => o?.src === img && isFocus(o));
  return match ? { x: match.x, y: match.y, w: match.w } : null;
}

/** PF2e records the roller as the target of their own saves and checks. */
function isSelfTarget(raw, context) {
  const token = context?.target?.token;
  const own = raw.speaker?.token;
  return !!token && !!own && token.endsWith(`Token.${own}`);
}

function targetOf(derived) {
  const target = derived.target;
  if (!target) return null;
  const hidden = !!derived.nameVisibilitySetting && target.playersCanSeeName === false;
  return { name: hidden ? null : target.tokenName ?? target.actorName ?? null };
}

/** The art a card shows: creatures lead with their token, characters with their portrait. Default icons never count. */
export function artFor(actorImg, tokenImg, preferToken) {
  const portrait = usable(actorImg);
  const token = usable(tokenImg);
  return preferToken ? token ?? portrait : portrait ?? token;
}

function usable(src) {
  return src && !DEFAULT_TOKEN_ICON.test(src) ? src : null;
}

/** Text of the first heading in PF2e's flavor or content HTML ("Reflex Saving Throw", "Melee Strike: Club"). */
export function headingText(html) {
  if (typeof html !== "string") return null;
  const match = html.match(/<h[34][^>]*>([\s\S]*?)<\/h[34]>/i);
  if (!match) return null;
  const inner = match[1].replace(/<span[^>]*(?:pf2-icon|action-glyph)[^>]*>[\s\S]*?<\/span>/gi, " ");
  const text = decodeEntities(inner.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").replace(/\(\s+/g, "(").replace(/\s+\)/g, ")").trim();
  return text || null;
}

function decodeEntities(text) {
  return text.replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (m, e) => ({ amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", nbsp: " " })[e]);
}

/**
 * @typedef {object} RollCardModel
 * @property {string} id
 * @property {"check"|"damage"|"cast"|"action"|"roll"|"text"} kind
 * @property {string|null} originKey
 * @property {boolean} isReroll
 * @property {"public"|"ownBlind"} visibility
 * @property {{name: string|null, isNpc: boolean, img: string|null, imgKind: "token"|"portrait", focus: {x: number, y: number, w: number}|null}} actor
 * @property {{name: string}|null} player
 * @property {{name: string|null}|null} target
 * @property {{label: string|null, labelKey: string|null, sub: string|null, map: number, cost?: {type: string, value: number|null}|null}|null} action
 * @property {{natural: number|null, total: number|null, dc: number|null, dcVisible: boolean, degree: 0|1|2|3|null, formula?: string|null}|null} roll
 * @property {{name: string, tradition: string|null, rank: number|null, isCantrip: boolean, dc: number|null, save: {statistic: string, basic: boolean}|null, attackBonus: number|null}|null} spell
 * @property {{total: number, parts: {type: string, amount: number, persistent: boolean}[], crit: boolean}|null} damage
 * @property {{body: string, style: "speech"|"emote"|"ooc"}|null} text
 * @property {"gold"|"red"|"pop"|null} fx
 */
