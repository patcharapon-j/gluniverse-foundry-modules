/**
 * GLUniverse Suite — Recall Knowledge: mistaken identity.
 *
 * On a badly failed roll (bands 0-1) the GM needs a wrong answer. The authored
 * "Misremembered" line wins whenever the ladder has one; this module is the
 * fallback for every creature nobody has prepped, so the GM never has to
 * improvise a convincing lie mid-combat — the most-cited complaint about
 * Recall Knowledge in the whole community record.
 *
 * The trick, borrowed with credit from GlassSpiderTV's `spider-vibes` (MIT):
 * rather than inventing a falsehood, find a REAL creature that resembles this
 * one and answer as though the target were that instead. The lie is then
 * internally consistent, plausible, and free.
 *
 * The pick is cached on the target actor so the same creature stays mistaken
 * for the same thing all campaign. A wrong belief that changes every time it is
 * recalled is not a belief, it is a glitch.
 *
 * Unique creatures are excluded as candidates: "you think that's Treerazer"
 * is not a misidentification, it is a plot event.
 */

import { SUITE_ID } from "../../core/const.mjs";
import { FLAG_MISTAKEN } from "./constants.mjs";

/** Traits that carry no identifying signal and would inflate every overlap. */
const NOISE_TRAITS = new Set(["common", "uncommon", "rare", "unique", "minion", "mindless"]);

/** The comparable shape both the target and every candidate are reduced to. */
export function identityProfile(actor) {
  const sys = actor?.system ?? {};
  return {
    uuid: actor?.uuid ?? null,
    name: actor?.name ?? "",
    level: Number(sys.details?.level?.value ?? 0),
    rarity: sys.traits?.rarity ?? "common",
    size: sys.traits?.size?.value ?? null,
    traits: (Array.isArray(sys.traits?.value) ? sys.traits.value : []).filter(
      (t) => t && !NOISE_TRAITS.has(t)
    ),
  };
}

/** Size ladder, so "one step off" can be told from "nothing like it". */
const SIZES = ["tiny", "sm", "med", "lg", "huge", "grg"];
const SIZE_ALIAS = { small: "sm", medium: "med", large: "lg", gargantuan: "grg" };

function sizeIndex(size) {
  const key = SIZE_ALIAS[size] ?? size;
  const i = SIZES.indexOf(key);
  return i === -1 ? null : i;
}

/** A believable mistake is one the character has plausibly heard of. */
const RARITY_BONUS = { common: 3, uncommon: 1, rare: 0 };

/**
 * Score how good a mistaken-identity candidate is for a target.
 * Higher is better; `null` rejects the candidate outright.
 *
 * The weighting encodes three claims about how people misremember:
 *
 *  1. **Kind matters most.** Shared traits dominate at 10 points each, so a
 *     troll is mistaken for another troll long before it is mistaken for
 *     something merely the same level. Zero overlap is rejected outright — the
 *     GM would rather say "nothing comes to mind" (which critical failure
 *     explicitly permits) than name something absurd.
 *  2. **Silhouette is what a witness actually sees.** Size gates before
 *     anything else: same size scores, one step off is penalised, two steps
 *     off is rejected however many traits it shares. A huge thing is never
 *     mistaken for a small one.
 *  3. **You misremember toward the familiar.** A common creature beats a rare
 *     one, because the character has plausibly heard the story.
 *
 * Level proximity is deliberately the weakest term (1/level), because level is
 * the one property a witness cannot actually perceive — how dangerous something
 * is has no silhouette. It breaks ties between equally plausible kin rather than
 * steering the choice: nine levels of distance still costs less than a single
 * shared trait, so a famous elder troll stays a better mistake than a same-level
 * ogre. "How much have you heard of it" is carried by rarity, which is the
 * honest proxy for that.
 */
export function scoreCandidate(target, candidate) {
  const shared = target.traits.filter((t) => candidate.traits.includes(t)).length;
  if (!shared) return null;

  const ti = sizeIndex(target.size);
  const ci = sizeIndex(candidate.size);
  let sizeTerm = 0;
  if (ti != null && ci != null) {
    const gap = Math.abs(ti - ci);
    if (gap > 1) return null;
    sizeTerm = gap === 0 ? 4 : -4;
  }

  return (
    shared * 10 +
    sizeTerm +
    (RARITY_BONUS[candidate.rarity] ?? 0) -
    Math.abs(target.level - candidate.level)
  );
}

/**
 * Choose the best candidate for a target, or null when nothing qualifies.
 * Ties break on the lower level, then alphabetically, so the pick is stable
 * across clients even before it is cached.
 */
export function pickMistakenIdentity(target, candidates) {
  const t = identityProfile(target);
  const scored = [];

  for (const candidate of candidates ?? []) {
    const c = identityProfile(candidate);
    if (!c.uuid || c.uuid === t.uuid) continue;
    if (c.rarity === "unique") continue;
    const score = scoreCandidate(t, c);
    if (score == null || !Number.isFinite(score)) continue;
    scored.push({ profile: c, score });
  }

  if (!scored.length) return null;
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      a.profile.level - b.profile.level ||
      a.profile.name.localeCompare(b.profile.name)
  );
  return scored[0].profile;
}

/** Read the cached pick, if this actor already has one. */
export function cachedMistakenIdentity(actor) {
  return actor?.getFlag?.(SUITE_ID, FLAG_MISTAKEN) ?? null;
}

/** Cache a pick so the same creature stays mistaken for the same thing. */
export async function cacheMistakenIdentity(actor, profile) {
  if (!actor || !profile) return null;
  await actor.setFlag(SUITE_ID, FLAG_MISTAKEN, {
    uuid: profile.uuid,
    name: profile.name,
  });
  return profile;
}
