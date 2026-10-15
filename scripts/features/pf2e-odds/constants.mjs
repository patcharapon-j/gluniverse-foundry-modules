/**
 * PF2e Odds — constants. Pure: the check tool and the preview import this.
 */

export const FEATURE_ID = "pf2e-odds";
export const PREFIX = "od.";

/**
 * Raised when what a viewer KNOWS changes (the ledger, a Creaturedex reveal):
 * every mounted surface — line badges, open sheets, save prompts — redraws.
 * Namespaced under the suite id so no other feature can raise it by accident.
 */
export const KNOWLEDGE_HOOK = "gluniverse-foundry-modules.odds.knowledgeChanged";

export const SETTINGS = Object.freeze({
  ledger: "od.ledger",
  partyKnowledge: "od.partyKnowledge",
  mapReset: "od.mapResetSeconds",
  lineBadge: "od.lineBadge",
  sheet: "od.sheet",
  dialog: "od.dialog",
  savePrompt: "od.savePrompt",
  observationsMenu: "od.observations",
});

/** The socket payload kinds this feature speaks. */
export const MSG = Object.freeze({ armed: "armed", mapOverride: "map", forget: "forget" });

/** Roll option that tags a probe, so the Check.roll handler can catch it. */
export const PROBE_TAG = "gluniverse:odds-probe";

/**
 * The stats a creature's odds depend on, and what kind of number each is.
 *
 * `dc` stats are defences a PC rolls against; `mod` stats are the creature's
 * own roll bonuses, which a PC's odds depend on when the creature rolls
 * against them (its Strikes) or when it saves against the PC's spell. A save is
 * stored once, as a DC: DC = 10 + modifier, so a Will DC learned from a
 * Demoralize and a Will modifier learned from a failed Fear save are the same
 * fact.
 *
 * Every key here is DATA — it is written into `od.ledger` — so renaming one
 * forgets everything the party has observed. The check tool pins the list.
 */
export const STATS = Object.freeze({
  ac: { kind: "dc", label: "GLOD.stat.ac" },
  fortitude: { kind: "dc", label: "GLOD.stat.fortitude" },
  reflex: { kind: "dc", label: "GLOD.stat.reflex" },
  will: { kind: "dc", label: "GLOD.stat.will" },
  perception: { kind: "dc", label: "GLOD.stat.perception" },
  "spell-dc": { kind: "dc", label: "GLOD.stat.spellDc" },
  "spell-attack": { kind: "mod", label: "GLOD.stat.spellAttack" },
});

/** Strike modifiers are keyed per attack: `strike:<slug>`. */
export const STRIKE_PREFIX = "strike:";
export const strikeStat = (slug) => `${STRIKE_PREFIX}${slug}`;
export const isStrikeStat = (key) => typeof key === "string" && key.startsWith(STRIKE_PREFIX);
export const statKind = (key) => (isStrikeStat(key) ? "mod" : STATS[key]?.kind ?? null);

/** PF2e's dc.slug for a Strike is "armor"; everything else is the statistic's own slug. */
export function statForDcSlug(slug) {
  if (!slug) return null;
  const s = String(slug).replace(/-dc$/, "");
  if (s === "armor" || s === "ac") return "ac";
  if (s in STATS) return s;
  return null;
}

/** Degree keys in index order, and their stamp words. */
export const DEGREE_STAMP = Object.freeze({
  attack: ["GLOD.stamp.fumble", "GLOD.stamp.miss", "GLOD.stamp.hit", "GLOD.stamp.crit"],
  check: ["GLOD.stamp.critFail", "GLOD.stamp.fail", "GLOD.stamp.success", "GLOD.stamp.critSuccess"],
});

/**
 * The skill actions the sheet and the badge know how to price, and which
 * defence each one is rolled against. Every one carrying `attack: true` takes
 * the multiple attack penalty and counts toward it.
 */
export const SKILL_ACTIONS = Object.freeze({
  demoralize: { skill: "intimidation", against: "will", attack: false },
  feint: { skill: "deception", against: "perception", attack: false },
  "create-a-diversion": { skill: "deception", against: "perception", attack: false },
  grapple: { skill: "athletics", against: "fortitude", attack: true },
  trip: { skill: "athletics", against: "reflex", attack: true },
  shove: { skill: "athletics", against: "fortitude", attack: true },
  disarm: { skill: "athletics", against: "reflex", attack: true },
  reposition: { skill: "athletics", against: "fortitude", attack: true },
  "bon-mot": { skill: "diplomacy", against: "will", attack: false },
});

/**
 * Every literal timing the JS side schedules, in ms, before the motion scale.
 * CSS durations come from tokens; these are the beats JS sequences.
 */
export const TIMING = Object.freeze({
  /** Gap between consecutive pips resolving when a range narrows. */
  pipStagger: 38,
  /** How long the headline counts from the old range to the new. */
  count: 520,
  /** How long the degree stamp holds after a roll lands. */
  stampHold: 1500,
  /** Probe results are reused this long before PF2e is asked again. */
  probeTtl: 4000,
  /** A badge leaving: matches --gl-d-brisk, the exit it plays in CSS. */
  leave: 260,
  /** Coalesce bursts of document updates into one recompute. */
  debounce: 120,
});

/**
 * Modifiers the TABLE can see happening on a creature: its conditions (each
 * one an icon on its token, slugged like the condition) and cover. A status
 * or circumstance bonus from anything else — a spell the GM cast off-screen,
 * an aura, a hidden ability — is not public: it is neither printed as a chip
 * for a player nor treated as a witnessed delta when a stat is normalised, so
 * a player who has not seen the "secret ward" cannot read it off a badge.
 */
const PUBLIC_SLUGS = new Set([
  "off-guard", "cover", "lesser-cover", "standard-cover", "greater-cover",
  "clumsy", "drained", "enfeebled", "frightened", "sickened", "stupefied",
  "prone", "blinded", "dazzled", "fatigued", "grabbed", "restrained", "slowed",
  "stunned", "unconscious", "paralyzed", "dying", "doomed", "wounded",
]);

export function isPublicModifier(m) {
  const slug = String(m?.slug ?? "");
  if (PUBLIC_SLUGS.has(slug)) return true;
  const conditions = globalThis.CONFIG?.PF2E?.conditionTypes;
  return !!conditions && Object.hasOwn(conditions, slug);
}

/** Shed order for the line badges, cheapest loss first. */
export const SHED_ORDER = Object.freeze(["narrowBeat", "landBeat", "glass", "expanded"]);
