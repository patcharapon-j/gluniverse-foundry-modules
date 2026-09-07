/**
 * GLUniverse Suite — Arcane Surge constants.
 *
 * The Sea of Stars makes magic unreliable. An eligible casting in an unstable
 * area rolls one d20 against the area's stability threshold; rolling at or under
 * it surges. A surge posts a severity card, which a d100 reads against the row
 * for the effective level. Theme collections are deliberately OUTSIDE this
 * feature — the card names the tier and stops.
 *
 * Everything numeric here is a DEFAULT. The GM edits thresholds and band
 * boundaries from the Control Center; `levels.mjs` resolves the live values.
 */

export const FEATURE_ID = "pf2e-arcane-surge";
export const PREFIX = "surge.";

/** Foundry setting keys (all prefixed, per the suite's one-id namespacing). */
export const SETTINGS = Object.freeze({
  level: `${PREFIX}level`,
  levelConfig: `${PREFIX}levelConfig`,
  eligibility: `${PREFIX}eligibility`,
  conceal: `${PREFIX}conceal`,
  ambient: `${PREFIX}ambient`,
  dieVisibility: `${PREFIX}dieVisibility`,
  motionTier: `${PREFIX}motionTier`,
  armed: `${PREFIX}armed`,
});

/** Chat-message flag keys. */
export const FLAGS = Object.freeze({
  check: `${PREFIX}check`,
  severity: `${PREFIX}severity`,
});

/* ══════════════════════════════════════════════════════════════════════
   Stability levels
   ══════════════════════════════════════════════════════════════════════ */

/** Ordered weakest→worst. Index is the step used by Steady the Spell. */
export const LEVELS = Object.freeze(["stable", "fraying", "unbound", "unraveling"]);

/** The invited-in-Unraveling severity row. Not a stability level — a row id. */
export const ROW_INVITED_UNRAVELING = "invitedUnraveling";

/** Every severity row id, in the order the config UI lists them. */
export const ROWS = Object.freeze(["fraying", "unbound", "unraveling", ROW_INVITED_UNRAVELING]);

/** Severity tiers, ordered mildest→worst. Index is the escalation order. */
export const TIERS = Object.freeze(["minor", "major", "catastrophic", "breach"]);

/**
 * Default per-level configuration.
 *
 * `threshold` is the inclusive d20 result that surges (0 = never). It is also
 * the number of glyph faces baked onto that level's die, so the die you watch
 * tumble is literally the odds you are facing — `tools/arcane-surge-check.mjs`
 * pins those two together.
 *
 * `bands` are CUMULATIVE upper bounds on a d100. A tier whose bound equals the
 * previous tier's has zero width and is unreachable, which is exactly how the
 * draft's table expresses "None" for Fraying's Catastrophic column.
 */
export const DEFAULT_LEVEL_CONFIG = Object.freeze({
  stable: Object.freeze({ threshold: 0, bands: null }),
  fraying: Object.freeze({
    threshold: 1,
    bands: Object.freeze({ minor: 90, major: 100, catastrophic: 100, breach: 100 }),
  }),
  unbound: Object.freeze({
    threshold: 4,
    bands: Object.freeze({ minor: 55, major: 90, catastrophic: 100, breach: 100 }),
  }),
  unraveling: Object.freeze({
    threshold: 8,
    bands: Object.freeze({ minor: 20, major: 65, catastrophic: 99, breach: 100 }),
  }),
  [ROW_INVITED_UNRAVELING]: Object.freeze({
    threshold: 0, // never rolled against — an invited casting surges outright
    bands: Object.freeze({ minor: 20, major: 65, catastrophic: 95, breach: 100 }),
  }),
});

/** The maximum surge threshold a GM may configure (a d20 has 20 faces). */
export const MAX_THRESHOLD = 20;

/* ══════════════════════════════════════════════════════════════════════
   Eligibility
   ══════════════════════════════════════════════════════════════════════ */

/**
 * Defaults follow the draft: non-cantrip spells of every tradition, including
 * focus, innate and item spells; cantrips and rituals excluded; NPCs included.
 */
export const DEFAULT_ELIGIBILITY = Object.freeze({
  cantrips: false,
  focus: true,
  innate: true,
  fromItems: true,
  rituals: false,
  npcCasters: true,
  minRank: 1,
});

/* ══════════════════════════════════════════════════════════════════════
   The die
   ══════════════════════════════════════════════════════════════════════ */

/**
 * `CONFIG.Dice.terms` is a GLOBAL single-character namespace shared with every
 * other module in the world, and a collision is silent — the later registration
 * simply overwrites the earlier one. "u" (unbound / unraveling) is ours, but
 * `die.mjs` checks before taking it and falls back to a plain d20 rather than
 * clobbering somebody else's term.
 */
export const SURGE_DIE_DENOMINATION = "u";
export const SURGE_DIE_NOTATION = "1du";
export const SURGE_DIE_FALLBACK_NOTATION = "1d20";
export const SEVERITY_NOTATION = "1d100";

export const DSN_NAMESPACE = "gluniverse-arcane-surge";
export const DSN_COLORSET = "gluniverse-arcane-surge";

/** Baked face art. `blank` is the inert face; `surge` carries the glyph. */
export const FACE_ASSETS = Object.freeze({
  blank: "blank",
  surge: "surge",
});

/* ══════════════════════════════════════════════════════════════════════
   Timing
   ══════════════════════════════════════════════════════════════════════
   These mirror the CSS duration tokens they are paired with. A value that
   drifts from its token desynchronises the JS teardown from the animation it
   is meant to outlast, which reads as a flicker — `arcane-surge-check.mjs`
   pins each pair. */

/** `--gl-d-cinematic` (1200ms) × the burst's own multiple. */
export const BURST_MS = 2400;
/** `--gl-d-splash` (720ms) — the shorter second beat on the severity roll. */
export const FLOURISH_MS = 720;
/** A freshly-written banner plays its reveal; scrollback renders settled. */
export const REVEAL_WINDOW_MS = 4000;
/** One casting can only check once inside this window (see check.mjs). */
export const DEDUP_WINDOW_MS = 6000;
