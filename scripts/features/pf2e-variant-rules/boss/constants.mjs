/**
 * Boss Creatures — shared constants.
 *
 * Dependency-free and side-effect-free: `rules.mjs`, the check tool, and the two
 * *other* features that read a boss profile (initiative, flatfinder) all import
 * from here, so nothing in this file may touch a Foundry global.
 */

/** The two boss grades. Stored verbatim in the actor flag. */
export const BOSS_TIER = Object.freeze({
  greater: "greater",
  supreme: "supreme",
});

/** The three kinds of Boss Ability the book sorts its list into. */
export const ABILITY_KIND = Object.freeze({
  augmentive: "augmentive",
  devastation: "devastation",
  passive: "passive",
});

/**
 * Downfall trigger types, verbatim from DOWNFALL TRIGGERS (p. 52).
 *
 * These are the vocabulary of the feature, not display strings — the i18n key
 * for each is built by appending the id, so adding one here without adding
 * `GLVR.boss.trigger.<id>` renders an empty label and nothing reports it.
 */
export const DOWNFALL_TRIGGER = Object.freeze({
  action: "action",
  area: "area",
  condition: "condition",
  environmental: "environmental",
  protective: "protective",
  trait: "trait",
  weakness: "weakness",
  /**
   * Not one of the book's seven. The page states separately that a critical
   * success against one of the boss's defences — or a critical failure on the
   * boss's own save — "should trigger a Downfall even if the downfall would not
   * normally be triggered by the effect or action", so it is a real trigger that
   * every boss carries and it needs somewhere to live.
   */
  critical: "critical",
});

/** Flag keys under this feature's own namespace, scope SUITE_ID. */
export const BOSS_FLAGS = Object.freeze({
  /**
   * The boss profile on an NPC actor:
   *   { tier, baseLevel, baseHp, abilities: [id], downfalls: [{id, type, note}] }
   * `baseLevel` and `baseHp` are the *pre-boss* figures, kept so unmarking a
   * boss restores exactly what was there rather than a number derived back out
   * of the inflated one.
   */
  profile: "vr.boss",
  /**
   * Live encounter state on a Combatant:
   *   { turnSerial, roundSerial, fired: {<downfallId>: roundSerial}, lastTurn,
   *     telegraph: {ability, target} | null }
   */
  state: "vr.bossState",
  /** Marks an extra initiative entry as a boss's Nth turn: { of, index }. */
  turn: "vr.bossTurn",
});

/**
 * The slug of the effect carrying a triggered Downfall's defence penalty.
 *
 * A slug rather than a label: PF2e's `addCustomModifier` refuses a duplicate
 * *label* but `StatisticModifier#push` dedupes by slug, and the penalty is
 * rewritten on every trigger as it climbs from −1 to −3.
 */
export const DOWNFALL_SLUG = "glvr-boss-downfall";

/** Selectors the Downfall penalty applies to: "all its defenses". */
export const DEFENCE_SELECTORS = Object.freeze([
  "ac",
  "fortitude",
  "reflex",
  "will",
]);

/** i18n namespace shared with the rest of the variant rules. */
export const BOSS_I18N = "GLVR.boss";
