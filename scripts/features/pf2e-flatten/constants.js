/**
 * Shared constants for the PF2e Flatten feature (ported into GLUniverse Suite).
 */

/** Suite package id — the only namespace allowed for settings/flags/sockets. */
export const SUITE_ID = "gluniverse-suite";

/** Short feature prefix for this feature's settings keys. */
export const FEATURE_PREFIX = "flatten";

/**
 * The original module's i18n key namespace. Localization keys are merged into
 * the suite's single lang file under this prefix and must not be renamed.
 */
export const MODULE_ID = "pf2e-flatten";

/** Label used for the PF2e custom modifier that applies the flattening. */
export const MODIFIER_LABEL = "Flattened Level Proficiency";

/** Slug PF2e derives from {@link MODIFIER_LABEL}; used as a fallback on removal. */
export const MODIFIER_SLUG = "flattened-level-proficiency";

/** Statistic selector that applies the modifier to every roll ("all"). */
export const MODIFIER_SELECTOR = "all";

/** Raw (unprefixed) setting keys, as used by the original standalone module. */
export const LegacySettings = {
	AUTO_FLATTEN: "autoflatten",
	FLATTEN_PCS: "flattenPcs",
	MULTIPLIER: "multiplier",
	ROUNDING_MODE: "roundingMode",
};

/**
 * Setting keys registered by the feature, prefixed with the feature prefix to
 * avoid collisions with other suite features.
 */
export const Settings = {
	AUTO_FLATTEN: `${FEATURE_PREFIX}.autoflatten`,
	FLATTEN_PCS: `${FEATURE_PREFIX}.flattenPcs`,
	MULTIPLIER: `${FEATURE_PREFIX}.multiplier`,
	ROUNDING_MODE: `${FEATURE_PREFIX}.roundingMode`,
};

/** Proficiency multipliers offered by the "reduced proficiency" setting. */
export const Multiplier = {
	HALF: 0.5,
	NONE: 1,
};

/** Rounding modes for the half-level calculation. */
export const RoundingMode = {
	CEIL: 0,
	FLOOR: 1,
};

/** Maps a {@link RoundingMode} to its rounding function. */
export const ROUNDING_FUNCTIONS = {
	[RoundingMode.CEIL]: Math.ceil,
	[RoundingMode.FLOOR]: Math.floor,
};
