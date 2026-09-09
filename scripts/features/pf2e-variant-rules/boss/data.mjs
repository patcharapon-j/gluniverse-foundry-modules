/**
 * Boss Creatures — the ability catalogue.
 *
 * Source: *Adventures+* pp. 51–55. Every Boss Ability in the book is here.
 *
 * Two things this file deliberately does *not* hold. It holds no rule text: the
 * prose lives in `lang/pf2e-variant-rules.en.json` under
 * `GLVR.boss.ability.<id>.text`, so it can be translated, and every number
 * inside it arrives as a format placeholder rather than being baked in. And it
 * holds no arithmetic: each entry names the `scale` keys it needs and
 * `rules.mjs` computes them, so the figure printed in an ability's description
 * and the figure the check tool asserts on come from one function.
 *
 * `cost` is PF2e's `system.actionType.value` plus an action count:
 *   { type: "action", count: 1|2|3 }  { type: "free" }  { type: "passive" }
 * A range in the book ("◆ TO ◆◆◆") stores its lower bound and says so in the
 * text, because PF2e models no variable-cost action.
 *
 * The book prints two glyph shapes and no reaction arrow. Retaliate settles
 * which is which — its own text calls it "the Retaliate free action" while
 * carrying the hollow glyph — so hollow is `free`, filled is `action`.
 *
 * Traits come in two lists and the split is load-bearing. `traits` holds only
 * traits PF2e itself knows, and is what gets written to `system.traits.value`.
 * `bookTraits` holds the book's own new ones — `boss`, `telegraph` — which the
 * system has no entry for. PF2e's trait field is a tagify widget built with
 * `enforceWhitelist`, so an unknown trait survives an `update()` and is then
 * silently dropped the first time a GM so much as touches the traits on that
 * item: the ability quietly stops being a telegraph ability and nothing says so.
 * Book traits are printed in the description instead, where nothing can eat
 * them. (`traversal` is in the `traits` list because PF2e does know it.)
 */

import { ABILITY_KIND } from "./constants.mjs";

const { augmentive, devastation, passive } = ABILITY_KIND;

/** Shorthands for the cost shapes, so a typo in one is a typo everywhere. */
const actions = (count) => Object.freeze({ type: "action", count });
const free = Object.freeze({ type: "free", count: null });
const inert = Object.freeze({ type: "passive", count: null });

/**
 * Every Boss Ability, in the book's own order within each kind.
 *
 * `scale` names the values `rules.mjs` must compute for this entry's text; the
 * check tool refuses an entry whose text uses a placeholder the entry does not
 * declare, and refuses a declared key the resolver cannot produce. That pin is
 * the whole reason the two lists are written separately.
 */
export const ABILITIES = Object.freeze([
  /* ── Augmentive ──────────────────────────────────────────────────────── */
  {
    id: "area-strike",
    kind: augmentive,
    cost: actions(2),
    traits: ["attack"],
    bookTraits: ["telegraph"],
    frequency: "round",
    scale: ["dc"],
  },
  {
    id: "big-spell",
    kind: augmentive,
    cost: actions(1),
    traits: ["spellshape"],
    bookTraits: ["telegraph"],
    frequency: "round",
    scale: ["dc"],
  },
  {
    id: "buffeting-area",
    kind: augmentive,
    cost: actions(1),
    traits: [],
    bookTraits: ["telegraph"],
    frequency: "round",
    prerequisites: "flySwim",
    scale: ["dc"],
  },
  {
    id: "furious-combo",
    kind: augmentive,
    cost: actions(1),
    costMax: 3,
    traits: [],
    bookTraits: ["telegraph"],
    frequency: "round",
    scale: [],
  },
  {
    id: "kinetic-trample",
    kind: augmentive,
    cost: actions(3),
    traits: [],
    bookTraits: ["telegraph"],
    frequency: "round",
    scale: ["hazardDamage"],
  },
  {
    id: "quick-rush",
    kind: augmentive,
    cost: actions(1),
    traits: ["traversal"],
    bookTraits: ["telegraph"],
    frequency: "round",
    scale: [],
  },
  {
    id: "reactive-slam",
    kind: augmentive,
    cost: free,
    traits: ["traversal"],
    bookTraits: ["telegraph"],
    frequency: "round",
    trigger: true,
    requirements: true,
    scale: [],
  },
  {
    id: "smash-landing",
    kind: augmentive,
    cost: actions(1),
    traits: ["traversal"],
    bookTraits: [],
    frequency: "round",
    scale: ["dc", "d10"],
  },
  {
    id: "trap-prey",
    kind: augmentive,
    cost: free,
    traits: ["traversal"],
    bookTraits: ["telegraph"],
    frequency: "round",
    trigger: true,
    scale: ["dc"],
  },
  {
    id: "vicious-charge",
    kind: augmentive,
    cost: actions(2),
    traits: ["attack", "move"],
    bookTraits: ["telegraph"],
    frequency: "round",
    scale: ["dc"],
  },

  /* ── Devastation ─────────────────────────────────────────────────────── */
  {
    id: "billowing-cloud",
    kind: devastation,
    cost: actions(2),
    traits: [],
    bookTraits: ["telegraph"],
    frequency: "round",
    scale: ["dc", "d6", "conditionValue"],
  },
  {
    id: "consume-underling",
    kind: devastation,
    cost: actions(2),
    traits: ["death"],
    bookTraits: ["telegraph"],
    frequency: "round",
    requirements: true,
    scale: ["consumeHealing"],
  },
  {
    id: "command-underling",
    kind: devastation,
    cost: actions(1),
    traits: [],
    bookTraits: ["telegraph"],
    frequency: "round",
    scale: ["dc"],
  },
  {
    id: "duplicate",
    kind: devastation,
    cost: actions(1),
    traits: [],
    bookTraits: ["telegraph"],
    frequency: "round",
    scale: [],
  },
  {
    id: "flashy-escape",
    kind: devastation,
    cost: actions(3),
    traits: ["move"],
    bookTraits: ["telegraph"],
    frequency: "day",
    scale: [],
  },
  {
    id: "grasping-appendages",
    kind: devastation,
    cost: actions(3),
    traits: [],
    bookTraits: ["telegraph"],
    frequency: "round",
    scale: ["dc", "appendages", "d8"],
  },
  {
    id: "hazardous-spew",
    kind: devastation,
    cost: actions(1),
    traits: [],
    bookTraits: ["telegraph"],
    frequency: "round",
    scale: ["hazardDamage"],
  },
  {
    id: "reinforcements",
    kind: devastation,
    cost: actions(3),
    traits: [],
    bookTraits: ["telegraph"],
    frequency: "round",
    requirements: true,
    scale: ["reinforcements"],
  },
  {
    id: "retaliatory-stance",
    kind: devastation,
    cost: actions(1),
    traits: ["stance"],
    bookTraits: ["telegraph"],
    frequency: "round",
    scale: [],
  },
  {
    id: "targeted-assault",
    kind: devastation,
    cost: actions(2),
    traits: [],
    bookTraits: ["telegraph"],
    frequency: "round",
    scale: ["assaultDice"],
  },
  {
    id: "thrash",
    kind: devastation,
    cost: actions(2),
    traits: [],
    bookTraits: ["telegraph"],
    frequency: "tenMinutes",
    scale: ["dc", "d10"],
  },
  {
    id: "unleash",
    kind: devastation,
    cost: actions(1),
    traits: [],
    bookTraits: ["telegraph"],
    frequency: null,
    requirements: true,
    scale: ["dc", "tempHp"],
  },
  {
    id: "violent-throw",
    kind: devastation,
    cost: actions(1),
    traits: [],
    bookTraits: ["telegraph"],
    frequency: "round",
    scale: ["dc", "d10", "baseLevel"],
  },

  /* ── Passive ─────────────────────────────────────────────────────────── */
  {
    id: "chained",
    kind: passive,
    cost: inert,
    traits: [],
    bookTraits: [],
    frequency: null,
    scale: [],
    /** Grants Unleash plus one more ability of the GM's choice. */
    grants: ["unleash"],
  },
  {
    id: "duo",
    kind: passive,
    cost: inert,
    traits: [],
    bookTraits: [],
    frequency: null,
    scale: [],
  },
  {
    id: "covert",
    kind: passive,
    cost: inert,
    traits: [],
    bookTraits: [],
    frequency: null,
    scale: ["modifier"],
  },
  {
    id: "impenetrable",
    kind: passive,
    cost: inert,
    traits: [],
    bookTraits: [],
    frequency: null,
    scale: ["resistance"],
  },
  {
    id: "infused",
    kind: passive,
    cost: inert,
    traits: [],
    bookTraits: [],
    frequency: null,
    scale: ["weakness", "d8"],
  },
  {
    id: "fearful-knowledge",
    kind: passive,
    cost: inert,
    traits: [],
    bookTraits: [],
    frequency: null,
    scale: [],
  },
  {
    id: "retributive-mind",
    kind: passive,
    cost: inert,
    traits: [],
    bookTraits: [],
    frequency: null,
    scale: [],
  },
  {
    id: "phase-change",
    kind: passive,
    cost: inert,
    traits: [],
    bookTraits: [],
    frequency: null,
    scale: [],
  },
  {
    id: "spawn",
    kind: passive,
    cost: inert,
    traits: [],
    bookTraits: [],
    frequency: null,
    scale: [],
  },
  {
    id: "stature",
    kind: passive,
    cost: inert,
    traits: [],
    bookTraits: [],
    frequency: null,
    scale: ["dc"],
  },
]);

/**
 * The two actions every boss has, regardless of which abilities it took.
 *
 * Telegraph carries the hollow glyph and a Trigger that fires on the boss's own
 * turn ending, so it is a free action rather than a reaction — a boss that spent
 * its reaction on signalling could not also make a Reactive Strike, which every
 * ability keyed on Reactive Strike assumes it can.
 */
export const CORE_ACTIONS = Object.freeze([
  {
    id: "telegraph",
    cost: free,
    traits: [],
    bookTraits: ["boss"],
    frequency: null,
    trigger: true,
    scale: [],
  },
  {
    id: "shrug-it-off",
    cost: actions(1),
    traits: ["concentrate", "manipulate"],
    bookTraits: ["boss"],
    frequency: "turn",
    scale: [],
  },
]);

/** Look one ability up by id. */
export const abilityById = (id) => ABILITIES.find((entry) => entry.id === id) ?? null;

/** Every ability of one kind, in book order. */
export const abilitiesOfKind = (kind) => ABILITIES.filter((entry) => entry.kind === kind);

/**
 * The Infused elements and the damage type each takes a weakness to.
 *
 * Verbatim from the table on p. 54. Water and Earth both map to bludgeoning and
 * Air and Wood both to piercing, which looks like a transcription slip and is
 * not one.
 */
export const INFUSED = Object.freeze({
  acid: "acid",
  air: "piercing",
  cold: "cold",
  earth: "bludgeoning",
  electricity: "electricity",
  fire: "fire",
  metal: "slashing",
  water: "bludgeoning",
  wood: "piercing",
});

/** Billowing Cloud's two closed choice lists. */
export const CLOUD_CONDITIONS = Object.freeze(["clumsy", "enfeebled", "stupefied"]);
export const CLOUD_DAMAGE = Object.freeze(["acid", "cold", "fire", "poison"]);
