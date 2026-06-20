import { MODULE_ID, Multiplier, RoundingMode, Settings, SUITE_ID } from "./constants.js";

/**
 * Registers every world setting exposed by the module. Choice labels are passed
 * as i18n keys; Foundry localizes them automatically when the form is rendered.
 */
export function registerSettings() {
	game.settings.register(SUITE_ID, Settings.AUTO_FLATTEN, {
		name: `${MODULE_ID}.settings.autoflatten.name`,
		hint: `${MODULE_ID}.settings.autoflatten.hint`,
		scope: "world",
		config: true,
		type: Boolean,
		default: false,
	});

	game.settings.register(SUITE_ID, Settings.FLATTEN_PCS, {
		name: `${MODULE_ID}.settings.flattenPcs.name`,
		hint: `${MODULE_ID}.settings.flattenPcs.hint`,
		scope: "world",
		config: true,
		type: Boolean,
		default: false,
	});

	game.settings.register(SUITE_ID, Settings.MULTIPLIER, {
		name: `${MODULE_ID}.settings.multiplier.name`,
		hint: `${MODULE_ID}.settings.multiplier.hint`,
		scope: "world",
		config: true,
		type: Number,
		default: Multiplier.NONE,
		choices: {
			[Multiplier.HALF]: `${MODULE_ID}.settings.multiplier.half`,
			[Multiplier.NONE]: `${MODULE_ID}.settings.multiplier.none`,
		},
	});

	game.settings.register(SUITE_ID, Settings.ROUNDING_MODE, {
		name: `${MODULE_ID}.settings.roundingMode.name`,
		hint: `${MODULE_ID}.settings.roundingMode.hint`,
		scope: "world",
		config: true,
		type: Number,
		default: RoundingMode.CEIL,
		choices: {
			[RoundingMode.CEIL]: `${MODULE_ID}.settings.roundingMode.ceil`,
			[RoundingMode.FLOOR]: `${MODULE_ID}.settings.roundingMode.floor`,
		},
	});
}

/** Convenience accessor for one of the module's settings. */
export const getSetting = (key) => game.settings.get(SUITE_ID, key);
