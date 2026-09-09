/**
 * PF2e Variant Rules — shared constants.
 *
 * Five optional rules from *Adventures+* (pp. 45–55), each a promoted
 * sub-feature with its own Control Center toggle:
 *
 *   Careful Consumption  a 2-action Activate that takes the maximum instead of rolling
 *   Chip Damage          a damaging effect that deals no damage still deals a little
 *   Dents                item durability as a dent count rather than a broken threshold
 *   Lasting Wounds       the wounded condition survives a night's rest and bites harder
 *   Boss Creatures       an NPC promoted to a multi-turn solo threat with Downfalls
 *
 * A fifth rule from the same section, Belts, ships no code: a PF2e container
 * with `system.stowing = false` already holds four items at full Bulk, and the
 * free-action draw is a table agreement rather than something to automate.
 *
 * This module is dependency-free and side-effect-free so the check tool can
 * import it without a Foundry global in scope.
 */

export const FEATURE_ID = "pf2e-variant-rules";

/** Parent catch-all prefix. Sub-features claim longer prefixes nested inside it. */
export const PREFIX = "vr.";

/**
 * The four promoted sub-features.
 *
 * `prefix` must stay strictly longer than PREFIX so the catalog — which sorts
 * routing rules longest-first — hands the child its own keys before the parent's
 * catch-all claims them.
 */
export const RULES = Object.freeze({
  careful: Object.freeze({
    id: "vr-careful-consumption",
    prefix: "vr.careful",
    icon: "fa-solid fa-flask-vial",
  }),
  chip: Object.freeze({
    id: "vr-chip-damage",
    prefix: "vr.chip",
    icon: "fa-solid fa-bolt",
  }),
  dents: Object.freeze({
    id: "vr-dents",
    prefix: "vr.dent",
    icon: "fa-solid fa-shield-halved",
  }),
  wounds: Object.freeze({
    id: "vr-lasting-wounds",
    prefix: "vr.wound",
    icon: "fa-solid fa-heart-crack",
  }),
  boss: Object.freeze({
    id: "vr-boss-creatures",
    prefix: "vr.boss",
    icon: "fa-solid fa-crown",
  }),
});

/** Setting keys. Every one begins with a sub-feature prefix or the parent's. */
export const SETTINGS = Object.freeze({
  // Enable flags. `config: false` — the Control Center toggle is the only UI for
  // these; a second checkbox inside the group would be two switches for one state.
  carefulEnabled: "vr.careful.enabled",
  chipEnabled: "vr.chip.enabled",
  dentsEnabled: "vr.dent.enabled",
  woundsEnabled: "vr.wound.enabled",
  bossEnabled: "vr.boss.enabled",

  // Careful Consumption
  carefulHealingOnly: "vr.careful.healingOnly",
  carefulPostRoll: "vr.careful.postRoll",

  // Chip Damage
  chipAutoApply: "vr.chip.autoApply",
  chipUseFlattened: "vr.chip.useFlattenedLevel",

  // Dents
  dentsRepair: "vr.dent.repairButton",
  dentsConfig: "vr.dent.config",

  // Lasting Wounds
  woundsBlockRest: "vr.wound.blockRest",
  woundsMedicine: "vr.wound.medicinePenalty",
  woundsHealing: "vr.wound.healingPenalty",

  // Boss Creatures
  bossXp: "vr.boss.xpBudget",
  bossIncapacitation: "vr.boss.incapacitation",
  bossExtraTurns: "vr.boss.extraTurns",
});

/** Flag keys, scope SUITE_ID. */
export const FLAGS = Object.freeze({
  /** Integer dent count on a physical item. */
  dents: "vr.dents",
  /** Chip-damage offer state on a chat message, so a re-render regenerates it. */
  chip: "vr.chip",
  /** Careful Consumption: set on a card once its result has been maximized. */
  careful: "vr.careful",
});

/**
 * Dent thresholds.
 *
 * Base rule: 2 dents broken, 4 destroyed. A *sturdy* shield doubles both, which
 * the book states explicitly (2→4 and 4→8). Objects use a size table instead;
 * it ships as help text rather than code — see the scope note in CLAUDE.md.
 */
export const DENTS_BROKEN = 2;
export const DENTS_DESTROYED = 4;

/**
 * The physical item types a dent track can be drawn on.
 *
 * PF2e's own list of physical types, in the order the config sheet shows them.
 * Which of them a table actually uses is a setting — see `DEFAULT_DENT_CONFIG`
 * — because "does a potion dent" is a ruling, not a fact about the data model.
 */
export const DENT_TYPES = Object.freeze([
  "weapon",
  "armor",
  "shield",
  "equipment",
  "backpack",
  "book",
  "consumable",
  "treasure",
  "ammo",
]);

/** PF2e item grades, low to high. A grade is the "tier" of a made thing. */
export const DENT_GRADES = Object.freeze(["low", "standard", "high"]);

/**
 * PF2e's precious materials, keyed exactly as `system.material.type` stores
 * them so a config row can be looked up with no translation step. Labels come
 * from PF2e's own `PF2E.PreciousMaterial*` keys rather than being restated
 * here, so a material renamed by the system renames itself in our sheet.
 */
export const DENT_MATERIALS = Object.freeze([
  "abysium",
  "adamantine",
  "cold-iron",
  "dawnsilver",
  "djezet",
  "dragonhide",
  "dreamweb",
  "duskwood",
  "grisantian-pelt",
  "inubrix",
  "keep-stone",
  "noqual",
  "orichalcum",
  "peachwood",
  "siccatite",
  "silver",
  "sisterstone",
  "sisterstone-dusk",
  "sisterstone-scarlet",
  "sloughstone",
  "sovereign-steel",
  "warpglass",
]);

/**
 * The table's dent configuration, as it ships.
 *
 * The defaults are the book and nothing else: 2/4, doubled for a sturdy shield,
 * on the gear the rule is written for. Every other row is zero, so a GM who
 * never opens the config sheet plays exactly the printed rule.
 *
 * `grades` and `materials` are *extra dents on the destroyed rung*. Adamantine
 * armour taking two more hits before it is scrap is the obvious use, and it
 * composes with the sturdy multiplier rather than replacing it — a sturdy
 * adamantine shield is both.
 */
export const DEFAULT_DENT_CONFIG = Object.freeze({
  broken: DENTS_BROKEN,
  destroyed: DENTS_DESTROYED,
  sturdyMultiplier: 2,
  types: Object.freeze({
    weapon: true,
    armor: true,
    shield: true,
    equipment: true,
    backpack: true,
    book: true,
    consumable: false,
    treasure: false,
    ammo: false,
  }),
  grades: Object.freeze({ low: 0, standard: 0, high: 0 }),
  materials: Object.freeze({}),
});

/** Degrees of success, as PF2e spells them in `flags.pf2e.context.outcome`. */
export const OUTCOME = Object.freeze({
  critFail: "criticalFailure",
  fail: "failure",
  success: "success",
  critSuccess: "criticalSuccess",
});

/**
 * Chip damage never applies below this. A level-0 or negative-level effect in a
 * Proficiency-Without-Level world would otherwise chip for nothing at all, which
 * reads at the table as a button that does not work rather than as a rules edge.
 */
export const CHIP_MINIMUM = 1;

/** i18n namespace for this feature. */
export const I18N = "GLVR";
