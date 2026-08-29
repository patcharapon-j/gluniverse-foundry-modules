/**
 * GLUniverse Suite — Recall Knowledge: resolving a band into a reveal.
 *
 * The play-time half of the feature. Given a stored ladder and the roller's
 * Flatfinder competence band, hand the GM the one paragraph they read aloud.
 *
 * v2 authors all eight bands directly, so this is a lookup rather than a
 * derivation. What is left here is the fallback behaviour for a band nobody
 * wrote, and the delivery colouring the panel uses.
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
 * a band the ladder still works as a prep document, and every paragraph stays
 * readable from the matrix.
 */

import { COMPETENCE_BANDS } from "../flatfinder/constants.js";
import { BAND_KEYS, BAND_REVEAL, DEFAULT_REVEAL } from "./constants.mjs";
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
 * v2 is a direct lookup: one authored paragraph per band, read aloud as it
 * stands. `mode` survives from v1 because it still earns its place — it colours
 * the panel, it selects the mistaken-identity fallback when a creature has no
 * authored Inept line, and it drives the GM-facing hint. It no longer selects
 * *content*; the paragraph is the content.
 *
 * @param {object} ladder      from store.readLadder (already normalised to bands)
 * @param {string} bandKey     a COMPETENCE_BANDS key, or null when unknown
 * @param {object} opts
 * @param {string} opts.mistakenName  fallback wrong answer for creatures with
 *                                    no authored Inept paragraph
 * @returns {{
 *   band: string|null, mode: string, text: string|null,
 *   wrong: string|null, wrongSource: string|null, hint: string|null
 * }}
 */
export function resolveReveal(ladder, bandKey, { mistakenName = null } = {}) {
  const rule = BAND_REVEAL[bandKey] ?? DEFAULT_REVEAL;
  const key = bandKey && BAND_KEYS.includes(bandKey) ? bandKey : null;
  const text = key ? (ladder?.bands?.[key] ?? null) : null;

  // The authored paragraph always wins. The fallbacks below only fire for a
  // band nobody wrote — an un-prepped creature, or a partial paste.
  let wrong = null;
  let wrongSource = null;
  if (!text && rule.mode === "blank") {
    wrong = game.i18n.localize("GLRK.reveal.nothingComesToMind");
    wrongSource = "none";
  } else if (!text && rule.mode === "wrong") {
    // A specific lie about YOUR creature beats a generic misidentification, so
    // mistaken identity is only reached when the Inept paragraph is missing.
    if (mistakenName) {
      wrong = game.i18n.format("GLRK.reveal.mistakenFor", { name: mistakenName });
      wrongSource = "mistaken";
    } else {
      wrong = game.i18n.localize("GLRK.reveal.nothingComesToMind");
      wrongSource = "none";
    }
  }

  let hint = null;
  if (rule.mode === "bonus") hint = game.i18n.localize("GLRK.reveal.hint.bonus");
  else if (rule.mode === "hedged") hint = game.i18n.localize("GLRK.reveal.hint.hedged");
  else if (rule.mode === "blank") hint = game.i18n.localize("GLRK.reveal.hint.blank");
  else if (rule.mode === "lead") hint = game.i18n.localize("GLRK.reveal.hint.lead");

  return {
    band: bandKey ?? null,
    mode: rule.mode,
    modeLabel: game.i18n.localize(`GLRK.mode.${rule.mode}`),
    text,
    hasText: !!text,
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

/** Heading text for a band key, for templates that render outside a reveal. */
export const bandHeading = (key) => HEADINGS[key] ?? key;
