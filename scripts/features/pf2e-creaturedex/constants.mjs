/**
 * Creaturedexing — *Adventures+* pp. 77–79. Identity, keys and the section map.
 *
 * The whole feature turns on one idea from the book: a stat block is not one
 * fact but **three**, and Recall Knowledge buys them one at a time.
 *
 *   "All creatures are divided into three sections of abilities,
 *    Characteristics, Defense, and Offence. When a character successfully uses
 *    Recall Knowledge on a creature, they choose which of the three stat blocks
 *    to reveal."
 *
 * The three colours below are the book's own — Characteristics green, Defense
 * blue, Offense red — routed through the suite's semantic tokens rather than
 * restated as hexes, so a retheme carries them.
 *
 * `SECTIONS` is DATA. A key here is written into world knowledge the moment a
 * GM reveals anything, so renaming one silently forgets every creature the
 * party has ever learned. Add keys; never rename them.
 */

export const FEATURE_ID = "pf2e-creaturedex";

/** Setting/flag prefix. Longer than `vr.` on purpose — see the catalog note. */
export const PREFIX = "dex.";

/*
 * No `enabled` key. This feature has no sub-features and nothing reads its
 * enable state at call time — the hooks are only wired when it is on — so the
 * registry owns the toggle, as it does for every other top-level feature. A
 * setting-backed toggle here would be a second store to keep in step with the
 * first for no read that needs it.
 */
export const SETTINGS = Object.freeze({
  /**
   * The book's "Party Knowledge" sidebar: one pool for the whole table.
   *
   * On by default. The sidebar presents sharing as the collaborative option,
   * and a per-player dex locks the one player who missed a session out of
   * knowledge their character was standing next to.
   */
  party: "dex.partyKnowledge",
  /** Grant the Discerning Aid reaction as a real item on completion. */
  grantAid: "dex.grantAid",
  /** Let players open the dex at all. */
  playerAccess: "dex.playerAccess",
  /**
   * How a Recall Knowledge check is answered when `pf2e-recall` is also on.
   *
   * The two features answer the same roll in different currencies: the prose is
   * what the GM reads aloud, the section is what the player consults. Layered
   * they compose; unmanaged they are two answers to one roll, and the prose
   * saying "you sense it is dangerous" beside a card printing AC 24 is the
   * failure. One setting so a table never gets that by surprise.
   */
  delivery: "dex.delivery",
  /**
   * May the doctoring pass alter immunities, weaknesses and resistances?
   *
   * Off by default. A lie about AC costs a turn, which is the rule working; a
   * lie about a weakness costs a spell slot, which is also fine. Hiding an
   * immunity costs a character concept, so removal is refused outright even
   * with this on -- see `doctorSection`.
   */
  doctorIwr: "dex.doctorIwr",
});

/** The values `SETTINGS.delivery` may take. */
export const DELIVERY = Object.freeze({ prose: "prose", sections: "sections", both: "both" });

export const FLAGS = Object.freeze({
  /** On a PC: they have been granted the Discerning Aid reaction. */
  aidGranted: "dex.aidGranted",
  /** On an item: this ability's section, overriding what PF2e says. */
  section: "dex.section",
});

/** The shared owner key used when the Party Knowledge sidebar is in play. */
export const PARTY_KEY = "party";

/** Every section carries a colour, an order and the rows it is made of. */
export const SECTIONS = Object.freeze({
  creature: Object.freeze([
    Object.freeze({ key: "characteristics", accent: "--gl-good" }),
    Object.freeze({ key: "defense", accent: "--gl-cyan" }),
    Object.freeze({ key: "offense", accent: "--gl-hazard" }),
  ]),
  hazard: Object.freeze([
    Object.freeze({ key: "complexity", accent: "--gl-good" }),
    Object.freeze({ key: "disable", accent: "--gl-cyan" }),
    Object.freeze({ key: "routine", accent: "--gl-hazard" }),
  ]),
});

/** Section keys for a subject kind, in the book's printed order. */
export const sectionKeys = (kind) => SECTIONS[kind === "hazard" ? "hazard" : "creature"].map((s) => s.key);

/** Every key either table can produce, for validating stored knowledge. */
export const ALL_SECTION_KEYS = Object.freeze([
  ...SECTIONS.creature.map((s) => s.key),
  ...SECTIONS.hazard.map((s) => s.key),
]);

/**
 * PF2e degrees of success.
 *
 * Nothing in this feature reads a Recall Knowledge roll -- reveals are the GM's
 * click, by design. These are here for Discerning Aid, whose bonus is keyed on
 * the degree of success of the *Aid* check the ally's helper makes.
 */
export const OUTCOME = Object.freeze({
  critSuccess: "criticalSuccess",
  success: "success",
  failure: "failure",
  critFailure: "criticalFailure",
});
