/**
 * Spellsprite — passives: abilities that never post a card of their own, and
 * the PF2e events that show them happening (docs/SPELLSPRITE_ARCHETYPES.md §4
 * row 21). Pure: read.mjs gathers the facts from the world and plays what this
 * returns; this module decides which passive an item is, which spec it plays,
 * how a trigger is keyed and who may see it.
 *
 * The events, from PF2e 8.7.0's bundle (systems/pf2e/pf2e.mjs):
 *
 *   regen   `FastHealingRuleElement#onUpdateEncounter` posts a ChatMessage at
 *           `turn-start` (fired from `CombatantPF2e#onStartTurn`): speaker =
 *           the creature, one roll `{(N)[healing]}`, flavor
 *           `PF2E.Encounter.Broadcast.FastHealing.<type>.ReceivedMessage`, mode
 *           "public" for a player-owned creature and "gm" otherwise. Nothing is
 *           applied until someone presses the roll's apply button, which posts
 *           `context.type: "damage-taken"` with `appliedDamage.isHealing`
 *           (`ActorPF2e#applyDamage`), public unless `metagame_secretDamage`.
 *   fear    Frightful Presence is an `action` with the `aura` trait and an
 *           `Aura` rule element but no effects: the frighten is the inline
 *           `@Check[will|…|options:area-effect,inflicts:frightened]`.
 *           `InlineRollLinks` rolls it on each selected creature with the item
 *           as `item`, so every save card carries `flags.pf2e.origin` = the
 *           passive (`ItemPF2e#getOriginData`) and `context.origin.token` = the
 *           creature it comes from. That save card is the moment.
 *   aura    Any other passive aura rolls its save the same way (Stench) or its
 *           damage the same way (Dragon Heat: a damage-roll card whose origin is
 *           the passive). At turn start, Foundry's `combatTurnChange` reaches
 *           every client (`Combat#_manageTurnEvents`); a visible aura pulses
 *           then, shown only to viewers PF2e itself draws the aura for
 *           (`AuraRenderers`: a GM, or a creature of the party alliance).
 */

import { damageOf, describeItem, slugOf, traitsOf } from "./semantics.mjs";

export const PASSIVE_KINDS = Object.freeze(["fear", "aura", "regen"]);

/** Fear by name, for the few that carry no `fear` trait. */
const FEAR_SLUGS = new Set(["frightful-presence", "frightful-moan", "dreadful-presence", "terrifying-presence"]);
/** Auras that are a sense, not a thing in the room: never drawn. */
const SENSE = /^(telepathy|tremorsense|scent|lifesense|wavesense|darkvision|greater-darkvision|low-light-vision|see-invisibility|truesight|echolocation)(-|$)/;
/** Item traits that mean the aura is something one can see in the room. */
const VISIBLE_TRAITS = new Set(["fire", "cold", "electricity", "acid", "poison", "void", "water", "air", "earth", "wood", "plant", "metal", "light", "darkness", "shadow"]);
/** Materials with no colour of their own: an aura in one of them is a feeling, not a light. */
const COLOURLESS = new Set(["mental", "kinetic", "neutral"]);
/** An aura's drawn radius, squares, past the creature's own edge: a bigger one would fill the screen. */
export const MAX_AURA_SQUARES = 8;

const passiveType = (item) => {
  const v = item?.system?.actionType?.value;
  return v === "passive" || (item?.type === "feat" && !v);
};

/** The `FastHealing` rule element, or null. */
function fastHealingRule(item) {
  const rules = Array.isArray(item?.system?.rules) ? item.system.rules : [];
  return rules.find((r) => r && r.key === "FastHealing" && !r.ignored) ?? null;
}

/** The radius in feet an item's `Aura` rule names, else the glossary's "N feet." lead, else null. */
export function auraFeet(item) {
  const rules = Array.isArray(item?.system?.rules) ? item.system.rules : [];
  const r = rules.find((x) => x && x.key === "Aura");
  const n = Number(r?.radius);
  if (Number.isFinite(n) && n > 0) return n;
  const d = item?.system?.description?.value ?? "";
  const m = /^\s*(?:<p>)?\s*(\d{1,3})\s*(?:feet|ft)\b/i.exec(typeof d === "string" ? d : "");
  return m ? Number(m[1]) : null;
}

/**
 * Which passive an item is, or null. Only actions and feats: a spell with the
 * aura trait posts a card and plays from it.
 * @param {object} item
 * @param {{actorLevel?: number}} [opts]
 * @returns {null | {kind: "fear"|"aura"|"regen", slug: string, rank: number, material: string, damage: boolean, visible: boolean, feet: number|null, regen?: string}}
 */
export function passiveOf(item, opts = {}) {
  if (!item || typeof item !== "object") return null;
  if (item.type !== "action" && item.type !== "feat") return null;
  const slug = slugOf(item);
  const fh = fastHealingRule(item);
  if (fh) return { kind: "regen", slug, rank: 1, material: "vitality", damage: false, visible: true, feet: null, regen: fh.type === "regeneration" ? "regeneration" : "fast-healing" };
  const traits = traitsOf(item);
  const rules = Array.isArray(item.system?.rules) ? item.system.rules : [];
  if (!traits.has("aura") && !rules.some((r) => r?.key === "Aura")) return null;
  if (!passiveType(item) || SENSE.test(slug)) return null;
  const desc = describeItem(item, { use: "action", actorLevel: opts.actorLevel });
  const rank = Math.max(1, Math.min(10, Math.round(Number(desc?.rank) || 1)));
  const feet = auraFeet(item);
  if (FEAR_SLUGS.has(slug) || traits.has("fear")) return { kind: "fear", slug, rank, material: "mental", damage: false, visible: false, feet };
  const damage = damageOf(item).some((e) => e.kinds.has("damage"));
  let material = desc?.material ?? "neutral";
  // a stench has no damage type to colour it: it is a smell, drawn as fumes
  if (traits.has("olfactory") && COLOURLESS.has(material)) material = "poison";
  const visible = damage || (!COLOURLESS.has(material) && [...traits].some((t) => VISIBLE_TRAITS.has(t)));
  return { kind: "aura", slug, rank, material, damage, visible, feet };
}

/* ── specs ─────────────────────────────────────────────────────────────── */

/** The look axes every spec carries, blank. */
// passive: nobody cast it, so compile.mjs draws no spell charge before it
const AXES = { passive: true, accent: null, tradition: null, weapon: null, condition: null, craft: null, motif: null, props: [], flavor: null, silent: null };

/** Frightful Presence: the `fear` archetype from the creature onto everyone who saved. */
export function fearDesc(p) {
  return { ...AXES, kind: "save", func: "hinder", material: "mental", rank: p.rank, arch: "fear", delivery: null, slug: p.slug };
}

/** An aura: HARM.aura's three soft beats round the creature, in the aura's material. */
export function auraDesc(p) {
  return { ...AXES, kind: "area", func: "harm", material: p.material, rank: p.rank, arch: null, delivery: "aura", slug: p.slug };
}

/** Regeneration / Fast Healing: a small `rise` on the creature (rank 1, no charge: nobody cast it). */
export function regenDesc(p, { undead = false } = {}) {
  return { ...AXES, kind: "auto", func: "restore", material: undead ? "void" : "vitality", rank: 1, arch: "rise", delivery: null, slug: p.slug };
}

/**
 * The aura's emanation round a body, squares. `feet` null: a 10-foot aura.
 * @param {{x:number,y:number,size:number}} body
 */
export function auraArea(body, feet, gridDistance = 5) {
  const sq = Math.min(MAX_AURA_SQUARES, Math.max(1, (Number(feet) || 10) / (Number(gridDistance) || 5)));
  return { shape: "emanation", x: body.x, y: body.y, r: sq + (body.size ?? 1) / 2, dir: 0 };
}

/** The aura to pulse for a creature at its turn start: the damaging one first, else the first visible one. */
export function turnPulse(passives) {
  const list = (passives ?? []).filter((p) => p?.kind === "aura" && p.visible);
  return list.find((p) => p.damage) ?? list[0] ?? null;
}

/* ── keys and timing ───────────────────────────────────────────────────── */

/** One play per creature per round: `pas:<kind>:<tokenId>:<round>`. */
export const passiveKey = (kind, tokenId, round) => `pas:${kind}:${tokenId}:${round}`;

/** One open join of a passive's saves per SOURCE TOKEN: two tokens of one linked actor share the item uuid. */
export const passiveJoinKey = (tokenId, originUuid) => `${tokenId ?? ""}|${originUuid ?? ""}`;

/** Did the turn move forward? Rewinding, or a re-sort that lands on the same turn, plays nothing. */
export function turnAdvanced(prior, current) {
  if (!current || !(current.round > 0) || !current.combatantId) return false;
  if (!prior || !(prior.round > 0)) return true;
  if (current.round !== prior.round) return current.round > prior.round;
  return current.turn > prior.turn;
}

/** A bounded set of keys already played: a second claim of a key fails. */
export class Seen {
  constructor(limit = 256) { this.limit = limit; this.keys = new Set(); }
  claim(key) {
    if (!key || this.keys.has(key)) return false;
    this.keys.add(key);
    while (this.keys.size > this.limit) this.keys.delete(this.keys.values().next().value);
    return true;
  }
  has(key) { return this.keys.has(key); }
  clear() { this.keys.clear(); }
}

/* ── who may see it ────────────────────────────────────────────────────── */

/**
 * A trigger that comes from a document change rather than a chat message has
 * no message to ask, so it takes the status cards' rule (stream-cards
 * `status-snapshot.js` `observable`): a player-owned creature always, anything
 * else only while its token on the scene is not hidden. A viewer who sees the
 * truth (the GM, never the stream login) sees their own hidden creatures.
 */
export function observable({ truth = false, playerOwned = false, hidden = true, onScene = false } = {}) {
  if (!onScene) return false;
  if (truth) return true;
  if (playerOwned) return true;
  return hidden === false;
}

/** PF2e draws an aura only for a GM or for a creature of the party alliance (`AuraRenderers`). */
export const auraShown = ({ truth = false, party = false } = {}) => !!(truth || party);
