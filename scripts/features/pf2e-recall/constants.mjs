/**
 * GLUniverse Suite — Recall Knowledge: the band model.
 *
 * The feature stores one short read-aloud paragraph per Flatfinder competence
 * band and hands the GM exactly the one their player's roll landed in. It
 * deliberately computes NO DCs: under Proficiency-without-Level the level-based
 * DC collapses to a seven-point band across levels 0-20 and rarity dominates
 * it, so the number carries almost no signal. The band does.
 *
 * v1 stored three cumulative tiers of bullets, named after the "Everyone knows
 * / One might know / Very few know" device from Stonetop by Jeremy Strandberg
 * (Lampblack & Brimstone). Those headings are retired, but the shape of the
 * climb they describe still governs what each band is about, and the credit
 * stands; see docs/RECALL_KNOWLEDGE.md.
 */

export const FEATURE_ID = "pf2e-recall";
export const FEATURE_PREFIX = "rk";

/** Flag key holding the authored ladder (scope SUITE_ID). */
export const FLAG_LADDER = "rk.ladder";
/** Flag key holding the persisted free-text generation context. */
export const FLAG_CONTEXT = "rk.context";
/** Flag key caching this actor's mistaken-identity pick, so a lie stays stable. */
export const FLAG_MISTAKEN = "rk.mistaken";

/**
 * The v1 tier keys, kept only so a stored v1 ladder can still be read and a v1
 * reply can still be pasted. Nothing renders them: v2 authors the eight bands
 * below directly. See parse.mjs parseLegacyLadder() and store.mjs
 * bandsFromLegacy().
 */
export const TIER_KEYS = Object.freeze(["everyone", "might", "few"]);


/**
 * The eight authored bands — the v2 model, and the one the payload asks for.
 *
 * v1 authored three cumulative tiers of bullets and derived eight table
 * experiences from them. That worked on paper and failed at the table: at the
 * top bands the GM was handed nine or ten bullets to read out mid-combat, which
 * is not something anyone does. v2 authors ONE self-contained paragraph per
 * band, so whatever the roll, the GM reads exactly one paragraph aloud.
 *
 * Order mirrors COMPETENCE_BANDS in features/flatfinder/constants.js, shallowest
 * first. It is duplicated here rather than imported so this module stays free of
 * cross-feature dependencies; tools/recall-check.mjs asserts the two agree.
 */
export const BAND_KEYS = Object.freeze([
  "disastrous",
  "inept",
  "poor",
  "passable",
  "solid",
  "impressive",
  "remarkable",
  "phenomenal",
]);

/**
 * Word budget for one band paragraph, [min, max].
 *
 * The upper bound is the load-bearing one: this is read aloud, and roughly
 * seventy words is about fifteen seconds of speech. Past that a GM starts
 * skimming and paraphrasing, which is exactly the failure v1 had.
 */
export const PARAGRAPH_WORDS = Object.freeze([25, 70]);

/**
 * Competence band -> how the answer is DELIVERED.
 *
 * In v2 the band no longer selects content — every band has its own authored
 * paragraph, and that paragraph is the answer. What survives here is delivery:
 *   blank  - nothing came to mind at all
 *   wrong  - a confidently wrong belief
 *   hedged - true in outline, uncertain in detail
 *   clean  - said plainly
 *   lead   - said plainly, with a sense that more exists
 *   bonus  - said plainly, and the GM is invited to add their own secret
 *
 * Modes repeat across bands and that is correct now: three bands deliver
 * "clean" and are still entirely distinct, because they are three different
 * paragraphs. In v1 the mode had to carry that distinctness alone, which is why
 * the check used to assert every (depth, mode) pair was unique. Depth is gone;
 * the uniqueness that matters is now between the paragraphs themselves.
 *
 * Band keys mirror COMPETENCE_BANDS in features/flatfinder/constants.js. That
 * module already maps a PF2e skill-check total onto a band (with Lore +1,
 * nat 20 +1, nat 1 -1); this table is the only thing added on top.
 *
 * `blank` vs `wrong` follows Flatfinder's own band flavour rather than
 * collapsing the bottom two: "Unbelievably bad" is comically disconnected from
 * the question, where "Gross" is wrong but engaged. Giving nothing at all is
 * also explicitly permitted by the remaster on a critical failure, so the
 * bottom rung stays rules-legal as well as distinct. In practice a trained
 * character cannot reach `blank` at all — which is the point: it is what
 * happens when someone is entirely out of their depth.
 */
export const BAND_REVEAL = Object.freeze({
  disastrous: Object.freeze({ mode: "blank" }),
  inept: Object.freeze({ mode: "wrong" }),
  poor: Object.freeze({ mode: "hedged" }),
  passable: Object.freeze({ mode: "clean" }),
  solid: Object.freeze({ mode: "clean" }),
  impressive: Object.freeze({ mode: "lead" }),
  remarkable: Object.freeze({ mode: "clean" }),
  phenomenal: Object.freeze({ mode: "bonus" }),
});

/** Fallback when Flatfinder is absent or the band is unrecognised. */
export const DEFAULT_REVEAL = Object.freeze({ mode: "clean" });

/** Document types the feature can build a ladder for. */
export const SUBJECT_TYPES = Object.freeze(["Actor", "JournalEntry", "Item", "Scene"]);

/**
 * Hard ceiling on extracted prose per subject, in characters.
 *
 * A long journal will happily serialise to 50k+ characters, which produces
 * mush rather than lore. Truncation is always announced in the payload so the
 * GM knows the model did not see everything.
 */
export const EXTRACT_CHAR_CAP = 8000;

/** Grammar version stamped into the payload and checked on parse. */
export const GRAMMAR_VERSION = 2;
