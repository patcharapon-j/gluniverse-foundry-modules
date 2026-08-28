/**
 * GLUniverse Suite — Recall Knowledge: the tier model and the band mapping.
 *
 * The feature stores a three-tier lore ladder per document and reveals a
 * progressively deeper slice of it as the roller's Flatfinder competence band
 * rises. It deliberately computes NO DCs: under Proficiency-without-Level the
 * level-based DC collapses to a seven-point band across levels 0-20 and rarity
 * dominates it, so the number carries almost no signal. The band does.
 *
 * Tier naming follows the "Everyone knows / One might know / Very few know"
 * device from Stonetop by Jeremy Strandberg (Lampblack & Brimstone), used here
 * as a structural idiom with credit; see docs/RECALL_KNOWLEDGE.md.
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
 * The three authored tiers, shallowest first.
 *
 * Ordering note: mechanics sit in the MIDDLE, not at the top. Both the
 * community's best-known DC ladder (which puts ecology/society at the hardest
 * rung) and Stonetop's own structure agree that the deepest tier is story, not
 * statistics. Because tier 2 is the typical outcome, Paizo's "answers must be
 * actionable" standard is met on the common roll while the rare roll buys lore.
 */
export const TIERS = Object.freeze([
  Object.freeze({
    key: "everyone",
    label: "GLRK.tier.everyone.label",
    brief: "GLRK.tier.everyone.brief",
    bullets: [3, 4],
  }),
  Object.freeze({
    key: "might",
    label: "GLRK.tier.might.label",
    brief: "GLRK.tier.might.brief",
    bullets: [2, 3],
  }),
  Object.freeze({
    key: "few",
    label: "GLRK.tier.few.label",
    brief: "GLRK.tier.few.brief",
    bullets: [1, 2],
  }),
]);

export const TIER_KEYS = Object.freeze(TIERS.map((t) => t.key));

/**
 * Competence band -> what the GM may reveal.
 *
 * `depth` is how many tiers are unlocked (0 = none). `mode` colours the
 * delivery so all eight bands feel distinct even though only three tiers are
 * ever authored:
 *   blank  - no information at all
 *   wrong  - the misremembered variant, or a mistaken-identity read
 *   hedged - tier 1, delivered with visible uncertainty
 *   clean  - exactly what the tier says
 *   lead   - clean, plus a nudge that something deeper exists
 *   bonus  - everything, plus the GM's own secret or a hook
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
  disastrous: Object.freeze({ depth: 0, mode: "blank" }),
  inept: Object.freeze({ depth: 0, mode: "wrong" }),
  poor: Object.freeze({ depth: 1, mode: "hedged" }),
  passable: Object.freeze({ depth: 1, mode: "clean" }),
  solid: Object.freeze({ depth: 2, mode: "clean" }),
  impressive: Object.freeze({ depth: 2, mode: "lead" }),
  remarkable: Object.freeze({ depth: 3, mode: "clean" }),
  phenomenal: Object.freeze({ depth: 3, mode: "bonus" }),
});

/** Fallback when Flatfinder is absent or the band is unrecognised. */
export const DEFAULT_REVEAL = Object.freeze({ depth: 1, mode: "clean" });

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
export const GRAMMAR_VERSION = 1;
