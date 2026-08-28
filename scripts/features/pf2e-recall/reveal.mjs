/**
 * GLUniverse Suite — Recall Knowledge: resolving a band into a reveal.
 *
 * The play-time half of the feature. Given a stored ladder and the roller's
 * Flatfinder competence band, decide how deep the GM may go and how the answer
 * should be coloured. Three authored tiers become eight distinct table
 * experiences without eight lots of authoring.
 *
 * No DCs are computed anywhere, deliberately: under Proficiency-without-Level
 * the level-based DC collapses to a seven-point band across all twenty levels
 * and rarity dominates it, so the number carries almost no signal. Worse, in a
 * world using `pf2e-flatten` (which applies PWoL as a modifier on the "all"
 * selector rather than through `game.pf2e.settings.variants.pwol.enabled`), the
 * system's own `identificationDCs` are un-flattened and roughly double. A
 * number that is both meaningless and wrong is not worth showing.
 *
 * Flatfinder is SOFT-detected: `COMPETENCE_BANDS` is pure data with no
 * side effects, so importing it costs nothing when the feature is off. Without
 * a band the ladder still works as a prep document at DEFAULT_REVEAL depth.
 */

import { COMPETENCE_BANDS } from "../flatfinder/constants.js";
import { BAND_REVEAL, DEFAULT_REVEAL, TIERS, TIER_KEYS } from "./constants.mjs";
import { HEADINGS } from "./prompt.mjs";

/** Map a raw check total onto a band key, mirroring Flatfinder's own rule. */
export function bandFromTotal(total) {
  if (!Number.isFinite(total)) return null;
  let key = COMPETENCE_BANDS[0].key;
  for (const band of COMPETENCE_BANDS) if (total >= band.min) key = band.key;
  return key;
}

export const BAND_ORDER = COMPETENCE_BANDS.map((b) => b.key);

/** Localized band label, for the header of the reveal panel. */
export function bandLabel(key) {
  const band = COMPETENCE_BANDS.find((b) => b.key === key);
  return band ? game.i18n.localize(band.label) : "";
}

/**
 * Resolve what the GM may say.
 *
 * @param {object} ladder      from store.readLadder
 * @param {string} bandKey     a COMPETENCE_BANDS key, or null when unknown
 * @param {object} opts
 * @param {string} opts.mistakenName  fallback wrong answer for creatures with
 *                                    no authored Misremembered line
 * @returns {{
 *   band: string|null, mode: string, depth: number,
 *   tiers: Array<{key:string,label:string,bullets:string[]}>,
 *   wrong: string|null, wrongSource: string|null, hint: string|null
 * }}
 */
export function resolveReveal(ladder, bandKey, { mistakenName = null } = {}) {
  const rule = BAND_REVEAL[bandKey] ?? DEFAULT_REVEAL;
  const unlocked = TIERS.slice(0, rule.depth).map((tier) => ({
    key: tier.key,
    label: game.i18n.localize(tier.label),
    bullets: ladder?.tiers?.[tier.key] ?? [],
  }));

  let wrong = null;
  let wrongSource = null;
  if (rule.mode === "blank") {
    // Not a lie — a blank. The character has no frame of reference at all.
    wrong = game.i18n.localize("GLRK.reveal.nothingComesToMind");
    wrongSource = "none";
  } else if (rule.mode === "wrong") {
    // The authored line always wins: a specific lie about YOUR creature beats a
    // generic misidentification. Mistaken identity is the fallback for every
    // creature nobody prepped.
    if (ladder?.misremembered) {
      wrong = ladder.misremembered;
      wrongSource = "authored";
    } else if (mistakenName) {
      wrong = game.i18n.format("GLRK.reveal.mistakenFor", { name: mistakenName });
      wrongSource = "mistaken";
    } else {
      wrong = game.i18n.localize("GLRK.reveal.nothingComesToMind");
      wrongSource = "none";
    }
  }

  // A "lead" nudges toward the next tier without spending it; "bonus" invites
  // the GM to add their own secret on top of a ladder already fully spent.
  let hint = null;
  const nextTier = TIERS[rule.depth];
  if (rule.mode === "lead" && nextTier && (ladder?.tiers?.[nextTier.key] ?? []).length) {
    hint = game.i18n.format("GLRK.reveal.hint.lead", {
      tier: game.i18n.localize(nextTier.label),
    });
  } else if (rule.mode === "bonus") {
    hint = game.i18n.localize("GLRK.reveal.hint.bonus");
  } else if (rule.mode === "hedged") {
    hint = game.i18n.localize("GLRK.reveal.hint.hedged");
  } else if (rule.mode === "blank") {
    hint = game.i18n.localize("GLRK.reveal.hint.blank");
  }

  return {
    band: bandKey ?? null,
    mode: rule.mode,
    modeLabel: game.i18n.localize(`GLRK.mode.${rule.mode}`),
    depth: rule.depth,
    tiers: unlocked,
    wrong,
    wrongSource,
    // Precomputed for the template: the suite registers no Handlebars helpers,
    // so comparisons and key-building belong here rather than in the markup.
    isMistaken: wrongSource === "mistaken",
    hint,
  };
}

/**
 * Preview every band at once, for the Read tab. Lets a GM see the whole shape
 * of what they authored before a die is ever rolled.
 */
export function revealMatrix(ladder, opts) {
  return BAND_ORDER.map((key) => ({
    band: key,
    label: bandLabel(key),
    ...resolveReveal(ladder, key, opts),
  }));
}

/** Heading text for a tier key, for templates that render outside a reveal. */
export const tierHeading = (key) => HEADINGS[key] ?? key;

export { TIER_KEYS };
