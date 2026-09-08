/**
 * PF2e Variant Rules — the rules themselves, as pure functions.
 *
 * Nothing here touches a Foundry global. Everything that decides a *number* or a
 * *state* lives in this file so `tools/pf2e-variant-rules-check.mjs` can assert
 * on it directly, and so the Foundry-facing modules are left doing nothing but
 * reading documents and drawing buttons.
 *
 * Source: *Adventures+* pp. 45–46.
 */

import { DENTS_BROKEN, DENTS_DESTROYED, OUTCOME, CHIP_MINIMUM } from "./constants.mjs";

/* ══════════════════════════════════════════════════════════════════════════
   CHIP DAMAGE
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Does this outcome zero the damage in the way the rule cares about?
 *
 * The rule fires at the *highest* degree of success that deals no damage, and
 * explicitly not at any degree beyond it — the book's own example is that a
 * critical failure on a Strike deals no chip damage even though it, too, deals
 * nothing. So:
 *
 *   attack roll   failure          → chip   (critical failure does NOT)
 *   saving throw  critical success → chip   (nothing above it to exclude)
 *
 * @param {"attack-roll"|"saving-throw"|string} kind  context.type from the message
 * @param {string} outcome  context.outcome
 * @returns {boolean}
 */
export function chipTriggers(kind, outcome) {
  if (kind === "attack-roll") return outcome === OUTCOME.fail;
  if (kind === "saving-throw") return outcome === OUTCOME.critSuccess;
  return false;
}

/**
 * How much chip damage an effect deals.
 *
 * "damage equal to the level of the effect that produced it or twice its rank if
 * the effect was a spell". Clamped at CHIP_MINIMUM: a level-0 or negative-level
 * effect would otherwise chip for nothing, which reads at the table as a broken
 * button rather than as a rules edge case.
 *
 * @param {{ spellRank?: number|null, level?: number|null }} source
 * @returns {number}
 */
export function chipAmount({ spellRank = null, level = null } = {}) {
  const raw = Number.isInteger(spellRank) && spellRank > 0 ? spellRank * 2 : Number(level) || 0;
  return Math.max(CHIP_MINIMUM, Math.trunc(raw));
}

/**
 * Resolve the whole chip-damage question for one outcome.
 *
 * The damage type matters more than it looks. The rule says a creature whose
 * resistance would apply "ignores all chip damage" — negated outright, not
 * reduced — and that where an effect deals several types the *defender* chooses.
 * Any player would therefore choose a type they resist, so we choose it for
 * them; a prompt would only ever confirm the obvious while blocking combat.
 *
 * @param {object} input
 * @param {string} input.kind        context.type
 * @param {string} input.outcome     context.outcome
 * @param {number|null} [input.level]      level of the effect
 * @param {number|null} [input.spellRank]  rank, when the effect is a spell
 * @param {string[]} [input.damageTypes]   types the effect can deal
 * @param {string[]} [input.resistedTypes] types the defender resists
 * @param {boolean} [input.persistentOnly] the effect deals only persistent damage
 * @returns {{applies: boolean, amount: number, types: string[], chosen: string|null,
 *            negated: boolean, reason: string}}
 */
export function resolveChip({
  kind,
  outcome,
  level = null,
  spellRank = null,
  damageTypes = [],
  resistedTypes = [],
  persistentOnly = false,
} = {}) {
  const none = (reason) => ({ applies: false, amount: 0, types: [], chosen: null, negated: false, reason });

  if (!chipTriggers(kind, outcome)) return none("outcome");
  // Persistent damage does not chip. `bleed` is persistent whether or not the
  // flavor says so, which the caller is responsible for having folded in.
  if (persistentOnly) return none("persistent");

  const types = damageTypes.filter(Boolean);
  const amount = chipAmount({ spellRank, level });

  // A resisted type negates the whole thing, so it is always the right choice.
  const resisted = types.find((t) => resistedTypes.includes(t)) ?? null;
  if (resisted) {
    return { applies: true, amount: 0, types, chosen: resisted, negated: true, reason: "resisted" };
  }

  return {
    applies: true,
    amount,
    types,
    chosen: types[0] ?? "untyped",
    negated: false,
    reason: "chip",
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   DENTS
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Dents inflicted by one blow against an item's Hardness.
 *
 * "When an item takes damage less than its Hardness, the item is unaffected as
 * normal. If the item takes more damage than its Hardness, it instead takes a
 * dent. If an object takes more than twice its Hardness in damage, it takes 2
 * dents instead of 1."
 *
 * Damage exactly equal to Hardness deals none — PF2e's own hardness maths
 * reduces it to zero, so treating it as a dent would make this rule harsher
 * than the system it sits on.
 */
export function dentsFromDamage(damage, hardness) {
  const dmg = Math.max(0, Number(damage) || 0);
  const hard = Math.max(0, Number(hardness) || 0);
  if (dmg <= hard) return 0;
  if (dmg > hard * 2) return 2;
  return 1;
}

/**
 * The dent thresholds for one item.
 *
 * A sturdy shield doubles both rungs (2→4 broken, 4→8 destroyed), which the
 * book states outright. Everything else uses the base pair.
 */
export function dentThresholds({ sturdy = false } = {}) {
  const scale = sturdy ? 2 : 1;
  return { broken: DENTS_BROKEN * scale, destroyed: DENTS_DESTROYED * scale };
}

/** Which of the four states a dent count puts an item in. */
export function dentState(dents, opts = {}) {
  const n = Math.max(0, Math.trunc(Number(dents) || 0));
  const { broken, destroyed } = dentThresholds(opts);
  if (n >= destroyed) return "destroyed";
  if (n >= broken) return "broken";
  if (n > 0) return "dented";
  return "intact";
}

/**
 * The item HP that makes PF2e agree with a dent count.
 *
 * Dents are authoritative and live in our own flag, but PF2e derives
 * `isBroken` / `isDestroyed` straight off HP (`hp.value === 0` is destroyed,
 * `hp.value <= floor(max / 2)` is broken), and shields read those getters to
 * decide whether they still grant an AC bonus. Writing a matching HP is what
 * keeps every existing rule about broken items working.
 *
 * The rounding is load-bearing and must be `floor`. PF2e's broken threshold is
 * `floor(max / 2)`, so on an item with odd max HP — say 15, threshold 7 —
 * rounding 15 × 0.5 to 8 leaves a two-dent item one point *above* the threshold
 * and PF2e never calls it broken. The bug would appear only on odd-HP items,
 * which is exactly the kind of thing that survives a play session unnoticed.
 */
export function hpForDents(dents, maxHp, opts = {}) {
  const max = Math.max(0, Math.trunc(Number(maxHp) || 0));
  if (max === 0) return 0;
  const { destroyed } = dentThresholds(opts);
  const n = Math.max(0, Math.trunc(Number(dents) || 0));
  if (n >= destroyed) return 0;
  const fraction = 1 - n / destroyed;
  return Math.min(max, Math.max(0, Math.floor(max * fraction)));
}

/** Dents removed by a Repair check. 1 on a success, 2 on a critical success. */
export function dentsRepaired(outcome) {
  if (outcome === OUTCOME.critSuccess) return 2;
  if (outcome === OUTCOME.success) return 1;
  return 0;
}

/* ══════════════════════════════════════════════════════════════════════════
   CAREFUL CONSUMPTION
   ══════════════════════════════════════════════════════════════════════════ */

/** Action costs that leave room for the activity's extra action. */
const CAREFUL_COSTS = new Set(["free", "reaction", 1, "1"]);

/**
 * Does this item qualify for Careful Consumption?
 *
 * "You Activate an Item that can be consumed that takes 1-action or less to
 * Activate." The action gate is mechanically load-bearing rather than flavour:
 * the activity costs two actions in total, so anything already costing two
 * would put the whole turn into one sip.
 *
 * @param {{type?: string, actionCost?: number|string|null,
 *          formula?: string|null, kind?: string|null}} item
 * @param {{healingOnly?: boolean}} [opts]
 */
export function carefulQualifies(item, { healingOnly = false } = {}) {
  if (!item || item.type !== "consumable") return false;
  if (!hasDie(item.formula)) return false;
  if (healingOnly && item.kind !== "healing") return false;

  const cost = item.actionCost;
  // A null cost is PF2e's "no action / passive" — inside "1 action or less".
  if (cost === null || cost === undefined) return true;
  return CAREFUL_COSTS.has(typeof cost === "number" ? cost : String(cost));
}

/** Does a formula actually roll something? "6" is already maximal. */
export function hasDie(formula) {
  return typeof formula === "string" && /\d*d\d+/i.test(formula);
}

/* ══════════════════════════════════════════════════════════════════════════
   LASTING WOUNDS
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * The two penalties a wounded value carries under this rule.
 *
 * "The wounded condition also imposes a circumstance penalty equal to its value
 * on Medicine checks that target the wounded creature and apply a status penalty
 * equal to twice its value to Hit Points restored from healing effects."
 *
 * Both are returned as the negative numbers PF2e expects for a penalty, so a
 * caller never has to remember which way round the sign goes.
 */
export function woundPenalties(woundedValue) {
  const n = Math.max(0, Math.trunc(Number(woundedValue) || 0));
  return { medicine: -n, healing: -n * 2, wounded: n };
}
