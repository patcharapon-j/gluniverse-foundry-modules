/**
 * Daggerheart chat message -> roll card model.
 *
 * Pure: no `game`, no DOM, importable under plain Node. It reads the plain snapshot built by
 * `snapshot.js` and decides what, if anything, the stream shows. The cards it describes are drawn by the
 * same `RollCard` the PF2e reader feeds; the fields only this reader sets (the duality die, an outcome
 * named by key, chips, a feature's price) are optional there.
 *
 * What the `gluniverse-daggerheart` system posts, and what each becomes here. Every roll goes through its
 * `postPlate()` (`dice/rolls.ts`) with style OTHER and the whole record in
 * `flags["gluniverse-daggerheart"] = { plate, kind, actorUuid, next, nextAct, ...extra }`:
 *
 *   kind "duality"    a Hope/Fear roll (`DualityPlate`). A check card with the split duality die. Thrown
 *                     as a reaction (`plate.rxn`) the duality is thrown away: neutral die, neutral tone.
 *   kind "adversary"  the GM's d20 (`FoePlate`). A check card with the d20 and Hit or Miss. Reactions are
 *                     whispered to the GMs by the system, so they never reach this far.
 *   kind "damage"     a damage roll (`DamagePlate`). Merged under the attack that offered it.
 *   kind "card"       a card or one of its features posted from a sheet (`sheets/post-card.ts`). The
 *                     action card: the feature's name large, its price beneath.
 *   kind "rest"       a rest summary (`apps/rest.ts`). Deliberately nothing: it is bookkeeping, and a
 *                     list of moves at roll-card weight is a second card nobody rolled.
 *   any other kind    nothing, until somebody decides what it should look like.
 *
 * And what nobody flagged: a plain `/r`, the Focus refresh, a card's "roll a d4" press (Foundry's own
 * roll card) become plain roll cards; a line somebody typed — Roleplay Chat included — becomes a text
 * card through the shared reader; everything else (another module's summary, a system card with no
 * dice) is nothing. Returning null here means the stream shows NOTHING for that message, which looks
 * exactly like the overlay being switched off, so every kind above is named on purpose.
 *
 * A plate is the system's display record: every number on it was decided before the card was drawn, and
 * a reroll rewrites it in place (`dice/reroll.ts`) rather than posting again. So this reader only reads
 * a plate and never re-derives one.
 */

import { isFocus } from "../framing/focus-math.js";
import {
  CHAT_FILTER_DETAILS,
  DEFAULT_CHAT_FILTER,
  DAGGERHEART_KIND_ROWS,
  DAGGERHEART_SYSTEM,
  allows,
  authorColumn,
  daggerheartRowOf,
  sanitizeChatFilter,
  showsDetail
} from "../../stream/chat-filter.mjs";
import { isPublicText, isTypedText, playersSeeDisplayName, readText, speakerNameHidden, textRowOf } from "../text/read-text.js";
// The plain-roll card and the whisper/blind rule are not PF2e's; they are shared rather than restated.
import { readPlainRoll, visibilityOf } from "../pf2e/read-message.js";

export const SYSTEM_ID = DAGGERHEART_SYSTEM;

/** What each reader kind draws as on the card. */
const CARD_KINDS = Object.freeze({
  duality: "check",
  adversary: "check",
  damage: "damage",
  feature: "action",
  roll: "roll",
  text: "text"
});

const OUTCOMES = new Set(["hope", "fear", "crit"]);

/** The chat-filter verdicts the "degree" detail removes. Hope, Fear and a critical stay: the dice say them. */
const VERDICTS = new Set(["Success", "Failure", "Hit", "Miss"]);

/** The GM's Fear, claimed onto a fear roll by the active GM's client (`dice/chat.ts` `applyFear`). */
export const FEAR_CHIP = Object.freeze({ id: "fear", labelKey: "PlusFear" });

/** The two buttons that roll an attack's damage. A card carrying one is a card damage merges under. */
const DAMAGE_ACTS = new Set(["roll-damage", "roll-foe-damage"]);

/** Damage type to icon. Daggerheart has two, and neither is a PF2e damage type the card would know. */
const DAMAGE_ICONS = Object.freeze({ physical: "sword", magic: "wand-sparkles" });

/**
 * A feature's price, read off the payment steps of its actions, in the order it is printed. Hope and
 * Fear are spent; Stress, Armor Slots and Hit Points are marked.
 */
const PRICE_UNITS = Object.freeze([
  ["hope", "Spend", "Hope", "Hope"],
  ["fear", "Spend", "Fear", "Fear"],
  ["stress", "Mark", "Stress", "Stress"],
  ["armor", "Mark", "ArmorSlot", "ArmorSlots"],
  ["hitPoints", "Mark", "HitPoint", "HitPoints"]
]);

const DEFAULT_ICON = /(^|\/)icons\/svg\/mystery-man\.svg$/;

/**
 * @param {{raw: object, derived: object}} snapshot
 * @returns {object|null} a RollCardModel, or null when the stream must not show this message.
 */
export function readMessage(snapshot) {
  const raw = snapshot?.raw;
  const derived = snapshot?.derived;
  if (!raw || !derived) return null;

  // Whispers never; a blind roll only for the player who made it. An adversary reaction is whispered to
  // the GMs by the system itself, because its Difficulty is a number the GM invented: it stops here.
  const visibility = visibilityOf(raw, derived);
  if (!visibility) return null;

  const flags = systemFlags(raw.flags);
  const kind = kindOf(flags, derived, raw);
  if (!kind) return null;
  if (kind === "text" && !isPublicText(raw)) return null;

  const filter = filterOf(derived);
  const author = authorColumn(!!derived.authorIsGM);
  if (!allows(filter, rowOf(kind, flags, raw), author)) return null;
  const model = applyDetails(buildModel(kind, raw, flags, derived, visibility), filter, author);
  return visibility === "ownBlind" ? withoutResult(model) : model;
}

/** The system's flags on a message, or an empty object. */
export function systemFlags(flags) {
  const scope = flags && typeof flags === "object" ? flags[SYSTEM_ID] : null;
  return scope && typeof scope === "object" ? scope : {};
}

/**
 * Which card a message is, or null for one the stream deliberately does not draw.
 *
 * A message the system flagged is read by its kind and nothing else: a rest summary carries no dice and
 * no typed style, but it is the system's, and it is skipped by name rather than by falling through.
 */
export function kindOf(flags, derived, raw) {
  const kind = typeof flags?.kind === "string" ? flags.kind : null;
  if (kind) {
    if (!(kind in DAGGERHEART_KIND_ROWS)) return null;
    if (kind === "card") return isObject(flags.card) ? "feature" : null;
    return isObject(flags.plate) ? kind : null;
  }
  if ((derived?.rollCount ?? 0) > 0) return "roll";
  return isTypedText(raw) ? "text" : null;
}

/** The chat-filter row a card answers to. One vocabulary with the cloned-card path's `classifyMessage`. */
export function rowOf(kind, flags, raw) {
  switch (kind) {
    case "duality":
    case "adversary":
    case "damage":
      return daggerheartRowOf(flags?.kind, Boolean(flags?.plate?.rxn));
    case "feature":
      return daggerheartRowOf("card");
    case "roll":
      return "roll";
    case "text":
      return textRowOf(raw);
    default:
      return null;
  }
}

function buildModel(kind, raw, flags, derived, visibility) {
  const plate = isObject(flags.plate) ? flags.plate : null;
  const actor = actorOf(derived, plate);
  const base = {
    id: raw._id,
    kind: CARD_KINDS[kind],
    /** The reader's own kind, which the feed merges and rewrites by. The card reads `kind`. */
    dhKind: kind,
    originKey: originKeyOf(flags, raw),
    isReroll: false,
    visibility,
    actor,
    badgeKey: actor.isNpc ? badgeOf(derived.actor) : null,
    player: derived.authorIsGM ? null : { name: derived.authorName ?? "" },
    target: null,
    action: null,
    roll: null,
    spell: null,
    damage: null,
    text: null,
    duality: null,
    chips: [],
    rerolls: rerollCountOf(plate),
    opensDamage: false,
    tone: null,
    fx: null
  };

  if (kind === "duality") return { ...base, ...readDuality(plate, flags, derived) };
  if (kind === "adversary") return { ...base, ...readFoe(plate, flags, derived) };
  if (kind === "damage") return { ...base, ...readDamage(plate) };
  if (kind === "feature") return { ...base, ...readFeature(flags) };
  if (kind === "roll") return { ...base, ...readPlainRoll(raw, derived) };
  return { ...base, ...readText(raw, { actor: base.actor, authorName: derived.authorName ?? null }) };
}

/**
 * A duality roll: Hope's die against Fear's, the total, and what the plate says came of it.
 *
 * The outcome headlines — With Hope, With Fear, Critical — because that is the roll. Success or Failure
 * and the Difficulty ride under it only when the players could see that Difficulty. The system prints a
 * plate's Difficulty to the whole table, but a GM's roll is the GM's business (the same rule the PF2e
 * reader holds a GM's DC to), so it shows on a player's roll alone.
 *
 * A reaction rolls the same two dice and throws the duality away: the die is neutral, the tone is
 * neutral, and the headline is the verdict itself. A critical stays a critical either way.
 */
function readDuality(plate, flags, derived) {
  const hope = finite(plate.h);
  const fear = finite(plate.f);
  const out = OUTCOMES.has(plate.out) ? plate.out : outcomeOf(hope, fear);
  const reaction = Boolean(plate.rxn);
  const crit = out === "crit";
  const dc = finite(plate.dc);
  const hit = crit || Boolean(plate.hit);
  const dcVisible = dc !== null && !derived.authorIsGM;
  const verdict = hit ? "Success" : "Failure";
  return {
    action: actionOf(plate, reaction ? "ReactionRoll" : "DualityRoll"),
    roll: {
      natural: null,
      total: finite(plate.total),
      dc,
      dcVisible,
      degree: null,
      outcomeKey: crit ? "Critical" : reaction ? (dcVisible ? verdict : null) : out === "hope" ? "WithHope" : "WithFear",
      // Beside the Difficulty, never without it, and not a second time when it is already the headline.
      verdictKey: dcVisible && !(reaction && !crit) ? verdict : null,
      dcKey: "DC"
    },
    duality: {
      hope,
      fear,
      hopeDie: typeof plate.hd === "string" ? plate.hd : "d12",
      fearDie: typeof plate.fd === "string" ? plate.fd : "d12",
      out: reaction ? "none" : out
    },
    chips: !reaction && out === "fear" && claimed(flags, "fear") ? [FEAR_CHIP] : [],
    // The attack's "Roll damage" button. Cards posted before the system stored it carried a weapon id.
    opensDamage: DAMAGE_ACTS.has(flags.nextAct) || (!flags.nextAct && typeof flags.weaponId === "string" && Boolean(flags.weaponId)),
    tone: crit ? "crit-success" : reaction ? "none" : out,
    fx: crit ? "gold" : null
  };
}

/**
 * The GM's d20: the adversary's attack, with its kept die, the total and Hit or Miss.
 *
 * The number it was measured against is the target's Evasion when the GM had one creature targeted. It
 * is printed only when that creature is a player character whose own Evasion it is — a number already on
 * their sheet. Aimed at anything else, it is the GM's number and stays off the stream, as does the
 * target's name. No target, no verdict: the system resolved nothing.
 */
function readFoe(plate, flags, derived) {
  const dice = (Array.isArray(plate.d20) ? plate.d20 : []).filter(Number.isFinite);
  const kept = dice.length ? (plate.neg ? Math.min(...dice) : Math.max(...dice)) : null;
  const reaction = Boolean(plate.rxn);
  const crit = !reaction && kept === 20;
  const dc = finite(plate.dc);
  const resolved = !reaction && dc !== null;
  const hit = crit || Boolean(plate.hit);
  const pcTarget = derived.foeTarget?.isPc === true;
  const targetName = typeof plate.target === "string" ? plate.target.trim() : "";
  return {
    action: actionOf(plate, "AttackRoll", { sub: false }),
    target: pcTarget && targetName ? { name: targetName } : null,
    roll: {
      natural: kept,
      total: finite(plate.total),
      dc,
      dcVisible: resolved && pcTarget,
      degree: null,
      outcomeKey: crit ? "Critical" : resolved ? (hit ? "Hit" : "Miss") : null,
      verdictKey: null,
      dcKey: "Evasion"
    },
    opensDamage: DAMAGE_ACTS.has(flags.nextAct),
    tone: crit ? "crit-success" : resolved ? (hit ? "hit" : "miss") : "none",
    fx: crit ? "gold" : null
  };
}

/**
 * A damage roll: the total, physical or magic, and whether it was a critical — which in this system
 * awards each die's maximum on top of the roll, so it is labelled a critical rather than "×2".
 */
function readDamage(plate) {
  const groups = [plate, ...(Array.isArray(plate.extra) ? plate.extra : [])];
  const crit = groups.some((group) => Array.isArray(group?.max));
  const said = String(plate.dtype ?? "").trim().toLowerCase() || "physical";
  const type = /\bmagic/.test(said) ? "magic" : "physical";
  const total = finite(plate.total);
  return {
    action: actionOf(plate, "Damage", { sub: false }),
    damage: {
      total,
      parts: total === null ? [] : [{ type, amount: total, label: said, icon: DAMAGE_ICONS[type] }],
      crit,
      critKey: "CritMax"
    },
    fx: crit ? "pop" : null
  };
}

/**
 * A card posted from a sheet. A single feature posted off a card names the feature large and the card
 * beside the verb; a whole card names itself. The price line is the feature's cost when the card has one
 * unambiguous cost — several buttons at several prices print none rather than the wrong one.
 */
function readFeature(flags) {
  const card = flags.card;
  const feature = text(flags.feature);
  const name = text(card.name);
  return {
    action: {
      label: feature || name || "",
      labelKey: null,
      sub: feature && name && name !== feature ? name : null,
      map: 0,
      verbKey: "UsesFeature",
      cost: null,
      price: priceOf(flags.cardActions)
    }
  };
}

/**
 * The price a card's priced buttons agree on, or [] when there is none or no agreement.
 *
 * The system posts a feature's price as up to two buttons (`addPrice` in `sheets/post-card.ts`): what the
 * character pays, and the GM's Fear on a button of its own, because Fear is the one currency a player's
 * client may not spend. One of each is one price, printed whole.
 */
export function priceOf(actions) {
  if (!Array.isArray(actions)) return [];
  const own = new Map();
  const fear = new Map();
  for (const action of actions) {
    if (!isObject(action)) continue;
    const chain = [action, ...(Array.isArray(action.steps) ? action.steps : [])];
    const sum = Object.fromEntries(PRICE_UNITS.map(([key]) => [key, 0]));
    for (const step of chain) {
      if (step?.kind !== "pay-cost") continue;
      for (const [key] of PRICE_UNITS) sum[key] += Math.max(0, Math.floor(Number(step[key]) || 0));
    }
    if (!PRICE_UNITS.some(([key]) => sum[key] > 0)) continue;
    const fearOnly = PRICE_UNITS.every(([key]) => key === "fear" || sum[key] === 0);
    (fearOnly ? fear : own).set(JSON.stringify(sum), sum);
  }
  if (own.size > 1 || fear.size > 1) return [];
  const total = Object.fromEntries(PRICE_UNITS.map(([key]) => [key, 0]));
  for (const sum of [...own.values(), ...fear.values()]) for (const [key] of PRICE_UNITS) total[key] += sum[key];
  return PRICE_UNITS
    .filter(([key]) => total[key] > 0)
    .map(([key, verbKey, one, many]) => ({ n: total[key], verbKey, unitKey: total[key] === 1 ? one : many }));
}

/**
 * "Agility", or "Longsword" over "Attack roll": the plate's own kind (`kind` in the system's
 * `dice/actions.ts`, always lower case there) only when it says something the label does not. An
 * adversary's "adversary attack" never does — the badge in the player slot already says it.
 */
function actionOf(plate, fallbackKey, { sub = true } = {}) {
  const label = text(plate.label);
  const kind = text(plate.kind).toLowerCase();
  const redundant = !sub || !kind || !label || kind === `${label.toLowerCase()} roll` || kind === "duality roll";
  return {
    label: label || null,
    labelKey: label ? null : fallbackKey,
    sub: redundant ? null : kind.charAt(0).toUpperCase() + kind.slice(1),
    map: 0
  };
}

/**
 * What a shown card may say. Each detail the GM switched off is removed from the model rather than hidden
 * by the card, so nothing downstream can draw it.
 *
 * A detail is applied only for the column it has: a GM roll has no "DC" switch, and the one number a GM
 * roll here may print — a player character's own Evasion — was already decided in `readFoe`.
 */
function applyDetails(model, filter, author) {
  if (!model) return model;
  const out = { ...model };
  if (out.roll) {
    const roll = { ...out.roll };
    if (hasColumn("degree", author) && !showsDetail(filter, "degree", author)) {
      roll.verdictKey = null;
      if (VERDICTS.has(roll.outcomeKey)) roll.outcomeKey = null;
      if (out.tone === "hit" || out.tone === "miss") out.tone = "none";
    }
    if (roll.dcVisible && hasColumn("dc", author) && !showsDetail(filter, "dc", author)) roll.dcVisible = false;
    out.roll = roll;
  }
  if (out.target && hasColumn("target", author) && !showsDetail(filter, "target", author)) out.target = null;
  if (out.player && hasColumn("playerName", author) && !showsDetail(filter, "playerName", author)) out.player = null;
  return out;
}

function hasColumn(detailId, author) {
  return Boolean(CHAT_FILTER_DETAILS.find((detail) => detail.id === detailId)?.authors.includes(author));
}

/** A player's own blind roll: that they rolled, and nothing of how it went. See the PF2e reader. */
function withoutResult(model) {
  if (!model) return model;
  const out = { ...model, fx: null, duality: null, chips: [] };
  if (out.roll) out.roll = { ...out.roll, natural: null, total: null, dc: null, dcVisible: false, degree: null, outcomeKey: null, verdictKey: null };
  if (out.damage) out.damage = { ...out.damage, total: null, parts: [], crit: false };
  if (out.kind === "roll" && out.action) out.action = { ...out.action, sub: null };
  if (out.tone && out.kind !== "text") out.tone = "none";
  return out;
}

/**
 * The GM's chat filter, with the defaults standing in for a snapshot that carries none — an absent
 * filter must read as the shipped defaults rather than as rows of `undefined`, which every gate would
 * read as off.
 */
function filterOf(derived) {
  const stored = derived?.chatFilter;
  return stored && typeof stored === "object" ? sanitizeChatFilter(stored) : DEFAULT_CHAT_FILTER;
}

/**
 * Who rolled, as the card shows them.
 *
 * The name players read is the token's; a creature the GM runs whose nameplate players cannot read is
 * "Unknown", with its art kept — the shared rule (`speakerNameHidden`), fed by the token's own display
 * mode because this system has no world switch for hiding names. The plate's `who` is the actor's name,
 * so it is a fallback only for a name that is not hidden.
 *
 * The art is the portrait first and the token second, the system's own rule (`portraitOf` in
 * `dice/rolls.ts`): one picture framed for a panel, the same one the player framed on their sheet.
 */
function actorOf(derived, plate) {
  const actor = derived.actor ?? {};
  const token = derived.token ?? {};
  const isNpc = !!derived.authorIsGM && !actor.hasPlayerOwner;
  const hidden = speakerNameHidden({
    authorIsGM: derived.authorIsGM,
    hasPlayerOwner: actor.hasPlayerOwner,
    nameVisibility: true,
    playersCanSeeName: playersSeeDisplayName(token.displayName)
  });
  const tokenImg = usable(token.textureSrc);
  const own = usable(actor.img) ?? tokenImg ?? usable(plate?.img);
  const fallback = own ? null : defaultArtOf(derived.authorIsGM ? derived.defaultArt : null);
  const img = own ?? fallback?.src ?? null;
  return {
    name: hidden ? null : text(token.name) || text(actor.name) || text(plate?.who) || "",
    ...(hidden ? { nameKey: "Unknown" } : {}),
    isNpc,
    img,
    imgKind: img && img === tokenImg ? "token" : "portrait",
    focus: fallback ? fallback.focus : focusFor(actor.focusOverrides, img)
  };
}

/** The word in the player slot for the GM's side. An environment is not an adversary. */
function badgeOf(actor) {
  return actor?.type === "environment" ? "Environment" : "Adversary";
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
  const match = overrides.find((o) => o?.src === img && isFocus(o));
  return match ? { x: match.x, y: match.y, w: match.w } : null;
}

function usable(src) {
  return typeof src === "string" && src && !DEFAULT_ICON.test(src) ? src : null;
}

/**
 * The merge key: whose roll this is. A Daggerheart damage plate names no attack — the damage button reads
 * the weapon off the attack message and rolls a new one — so damage joins the latest card of the same
 * actor that offered it (see the feed).
 */
function originKeyOf(flags, raw) {
  if (typeof flags.actorUuid === "string" && flags.actorUuid) return flags.actorUuid;
  const speaker = raw.speaker ?? {};
  if (speaker.token) return `token:${speaker.scene ?? ""}.${speaker.token}`;
  if (speaker.actor) return `actor:${speaker.actor}`;
  return null;
}

/**
 * Whether a claim has been taken. The system writes it with `setFlag(id, "claimed.fear", true)`, which is
 * stored nested; the literal dotted key is accepted too, because Foundry does not agree with itself about
 * the shape a dotted flag key takes on the way in (see `core/rp-mode.mjs`).
 */
export function claimed(flags, key) {
  const claims = flags?.claimed;
  if (isObject(claims) && claims[key]) return true;
  return Boolean(flags?.[`claimed.${key}`]);
}

/** How many faces a reroll has set aside on this plate (`plate.rr`). A reroll only ever adds one. */
export function rerollCountOf(plate) {
  const rr = plate?.rr;
  if (!isObject(rr)) return 0;
  return Object.values(rr).reduce((n, list) => n + (Array.isArray(list) ? list.length : 0), 0);
}

function outcomeOf(hope, fear) {
  if (hope === null || fear === null) return "hope";
  return hope === fear ? "crit" : hope > fear ? "hope" : "fear";
}

function finite(value) {
  const n = Number(value);
  return value !== null && value !== undefined && value !== "" && Number.isFinite(n) ? n : null;
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * The fields this reader adds to a RollCardModel (see `../pf2e/read-message.js` for the rest):
 *
 * @typedef {object} DaggerheartModelFields
 * @property {"duality"|"adversary"|"damage"|"feature"|"roll"|"text"} dhKind
 * @property {string|null} badgeKey   the player slot's word for the GM's side ("Adversary")
 * @property {{id: string, labelKey: string}[]} chips   beside the player name ("+1 Fear")
 * @property {{hope: number|null, fear: number|null, hopeDie: string, fearDie: string, out: "hope"|"fear"|"crit"|"none"}|null} duality
 * @property {number} rerolls        faces a reroll has set aside; a rise is a reroll
 * @property {boolean} opensDamage   the card offered "Roll damage"; damage from the same actor merges under it
 * @property {string|null} tone      hope | fear | crit-success | hit | miss | none
 *
 * `roll` may carry `outcomeKey` (the headline's label key), `verdictKey` (Success/Failure beside the
 * Difficulty) and `dcKey` ("DC" or "Evasion"). `damage` may carry `critKey`, and a part `label` and
 * `icon`. A feature's `action` carries `verbKey` and `price: {n, verbKey, unitKey}[]`.
 */
