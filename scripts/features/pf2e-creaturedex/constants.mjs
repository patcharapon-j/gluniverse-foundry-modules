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
  /** The book's "Party Knowledge" sidebar: one pool for the whole table. */
  party: "dex.partyKnowledge",
  /** The "It's Not a Secret" sidebar: drop the critical-failure effect. */
  noSecret: "dex.noSecretChecks",
  /** The sidebar variant: roll 1d4 for the section, player chooses on a 4. */
  randomSection: "dex.randomSection",
  /** Grant the Discerning Aid reaction as a real item on completion. */
  grantAid: "dex.grantAid",
  /** Offer the reveal on Recall Knowledge chat cards. */
  chatOffer: "dex.chatOffer",
  /** Let players open the dex and pick their own section. */
  playerAccess: "dex.playerAccess",
});

/**
 * On a Recall Knowledge chat card: the creature the roll was about and the
 * character who rolled, stamped once by the active GM.
 *
 * It lives here rather than in chat.mjs because `reveal.mjs` must read it to
 * validate an incoming request, and importing it from chat.mjs would close a
 * cycle between the two.
 */
export const SUBJECT_FLAG = "dex.subject";

export const FLAGS = Object.freeze({
  /** On a PC: they have been granted the Discerning Aid reaction. */
  aidGranted: "dex.aidGranted",
  /** On an NPC/hazard: creatures whose turn the party has observed. */
  observed: "dex.observed",
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

/** PF2e degrees of success, as the chat card reports them. */
export const OUTCOME = Object.freeze({
  critSuccess: "criticalSuccess",
  success: "success",
  failure: "failure",
  critFailure: "criticalFailure",
});
