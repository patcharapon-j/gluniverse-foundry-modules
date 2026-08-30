/**
 * GLUniverse Suite — token conditions: the classification PF2e does not ship.
 *
 * The system knows a slug and nothing else. `CONDITION_SLUGS` is a flat set of
 * 44 strings, an `EffectPF2e` carries a name, an image, a duration and a bag of
 * traits, and *nothing anywhere* says whether any of it is good news. So colour
 * on a token can mean nothing at all until we decide what it means — and that
 * decision outlives the geometry, because a GM learns "violet means an action
 * was taken away" exactly once and then reads it for years.
 *
 * Six tones, held to two rules:
 *
 *   1. Every tone has to survive at a 16px plate on a dark map, which is what
 *      rules out putting two of them on neighbouring ambers.
 *   2. None of them may be the suite's gold. Gold is the ceremony colour, it is
 *      spent on chrome, and the resource bar spends it in exactly one place.
 *      A tone that borrows it makes the whole HUD's warmest note mean two
 *      unrelated things.
 *
 * Everything here is data. Nothing in this file touches Foundry, so the check
 * tool can import it and the preview can render every tone without a world.
 */

import { PALETTE } from "../../core/theme.mjs";

/**
 * The tones, in rank order. `rank` is what sorts a rail: the worst thing a
 * creature has is always at the top, so a sweep of the map is one glance per
 * token rather than a read of each.
 */
export const TONES = Object.freeze({
  peril:   { body: PALETTE.hazard,   hot: PALETTE.hazardHot,  rank: 0 },
  impair:  { body: PALETTE.warnDeep, hot: PALETTE.warn,       rank: 1 },
  control: { body: PALETTE.violet,   hot: PALETTE.violetHot,  rank: 2 },
  sense:   { body: PALETTE.cyan,     hot: PALETTE.cyanHot,    rank: 3 },
  burden:  { body: "#8593ad",        hot: "#cfd7e4",          rank: 4 },
  boon:    { body: PALETTE.good,     hot: PALETTE.goodHot,    rank: 5 },
});

export const TONE_KEYS = Object.freeze(Object.keys(TONES));
export const DEFAULT_TONE = "burden";

/**
 * Every PF2e condition slug that reaches a token, mapped to a tone.
 *
 * The four omitted from `CONDITION_SLUGS` are the attitudes — friendly,
 * helpful, hostile, indifferent, unfriendly — plus `observed`, which is the
 * absence of a detection state rather than a state. None of them is a thing
 * that has happened *to* a creature, and a token that permanently wears
 * "INDIFFERENT" has one plate of pure noise on it forever.
 *
 * `malevolence` and `cursebound` are here because they are real conditions with
 * real art; they are also the two most likely to be missing from a world that
 * has not installed their source, which is why the lookup falls through to
 * DEFAULT_TONE rather than throwing.
 */
export const CONDITION_TONES = Object.freeze({
  /* The death track. Nothing else may outrank it. */
  "dying": "peril",
  "wounded": "peril",
  "doomed": "peril",
  "persistent-damage": "peril",
  "unconscious": "peril",
  "petrified": "peril",
  "paralyzed": "peril",

  /* A number gets worse. Valued, almost always. */
  "clumsy": "impair",
  "drained": "impair",
  "enfeebled": "impair",
  "frightened": "impair",
  "sickened": "impair",
  "stupefied": "impair",
  "cursebound": "impair",

  /* Actions are taken away. */
  "confused": "control",
  "controlled": "control",
  "fleeing": "control",
  "grabbed": "control",
  "immobilized": "control",
  "malevolence": "control",
  "prone": "control",
  "restrained": "control",
  "slowed": "control",
  "stunned": "control",

  /* What can be seen, heard or found. */
  "blinded": "sense",
  "concealed": "sense",
  "dazzled": "sense",
  "deafened": "sense",
  "fascinated": "sense",
  "hidden": "sense",
  "invisible": "sense",
  "undetected": "sense",
  "unnoticed": "sense",

  /* True, and rarely the thing you act on. */
  "broken": "burden",
  "encumbered": "burden",
  "fatigued": "burden",
  "off-guard": "burden",

  /* The only tone that is good news. */
  "quickened": "boon",
});

/**
 * Conditions another feature of this suite already draws, so they never surface
 * here as a second, smaller copy of themselves.
 *
 * `dying` is the interesting one and it is deliberately NOT in this set. The
 * initiative feature draws a dying gauge on the *combat card*, which a player
 * looking at the map is not looking at; the token is where the information is
 * needed. Two representations of one state are only a problem when they are in
 * the same place.
 */
export const COVERED_SLUGS = Object.freeze(new Set(["dead"]));

/**
 * Traits that settle an effect's tone on their own.
 *
 * This is the whole of what PF2e will tell us about an effect's valence, and it
 * is worth being honest about how little that is: a trait says what an effect
 * *is made of*, not whether the creature wearing it is better or worse off. A
 * `healing` effect is good news; a `curse` is not; a `magical` one could be
 * either and most of them are `magical`. So the table is deliberately short and
 * everything it does not name falls through to the origin test below.
 */
const TRAIT_TONES = Object.freeze({
  curse: "peril",
  death: "peril",
  disease: "peril",
  poison: "peril",
  incapacitation: "control",
  misfortune: "impair",
  fear: "impair",
  emotion: null,          // both ways — inspire courage and cause fear share it
  healing: "boon",
  fortune: "boon",
  aura: "sense",
});

/**
 * The tone of an effect item.
 *
 * The order matters. A named trait wins, because it is the system's own word.
 * Failing that we fall back to **who applied it**, which is knowable where
 * valence is not: an effect a creature put on itself, or that came from a
 * friendly actor, is overwhelmingly a buff, and one that arrived from a hostile
 * actor is overwhelmingly not. That is a heuristic and it will be wrong
 * sometimes — a cleric's `Effect: Heal` cast on an enemy undead is a real
 * counterexample — so it is a *default*, and the GM can overrule any single
 * effect with a flag rather than argue with the classifier.
 *
 * `disposition` is the token's own, not the actor's, because a polymorphed or
 * mind-controlled creature's token is what the table is looking at.
 */
export function effectTone(item, { selfUuid = null, disposition = null, originDisposition = null } = {}) {
  const override = readToneOverride(item);
  if (override) return override;

  const traits = item?.system?.traits?.value;
  if (Array.isArray(traits)) {
    for (const trait of traits) {
      const tone = TRAIT_TONES[trait];
      if (tone) return tone;
    }
  }

  const originUuid = item?.system?.context?.origin?.actor ?? null;
  /* Self-applied: no origin recorded at all, or an origin that is this actor. */
  if (!originUuid || (selfUuid && originUuid === selfUuid)) return "boon";

  /* From somebody else. Same side of the fight is a buff; the other side is not.
     A null disposition on either end means we genuinely do not know, and
     guessing "bad" would paint every ally's aid red on a scene whose tokens have
     not been given a disposition. */
  if (disposition !== null && originDisposition !== null) {
    return disposition === originDisposition ? "boon" : "impair";
  }
  return DEFAULT_TONE;
}

/**
 * A GM's per-effect override, read from this package's flag scope.
 *
 * The classifier above is a default and this is the escape hatch, which is the
 * only honest way to ship a heuristic: anyone who disagrees with one plate's
 * colour can fix that plate instead of turning the whole channel off.
 */
export function readToneOverride(item) {
  const raw = item?.flags?.["gluniverse-foundry-modules"]?.["tc.tone"];
  return typeof raw === "string" && raw in TONES ? raw : null;
}

/** The tone of a condition slug. */
export function conditionTone(slug) {
  return CONDITION_TONES[slug] ?? DEFAULT_TONE;
}

/** Rank for sorting; unknown tones sort last but before nothing. */
export function toneRank(tone) {
  return TONES[tone]?.rank ?? TONES[DEFAULT_TONE].rank;
}
