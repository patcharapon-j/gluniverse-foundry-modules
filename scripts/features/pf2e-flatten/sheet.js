import { MODIFIER_LABEL, MODIFIER_SLUG, MODULE_ID } from "./constants.js";
import { getFlatteningValue, hasModifier, isUpdatable } from "./flatten.js";

/** Whether a modifier entry is this module's (active) flattening modifier. */
const isFlattenModifier = (modifier) =>
	(modifier?.slug === MODIFIER_SLUG || modifier?.label === MODIFIER_LABEL) &&
	modifier?.enabled !== false &&
	!modifier?.ignored;

/** Whether the flattening modifier is actually applied to a given statistic. */
function flattenApplies(statistic) {
	const lists = [statistic?.modifiers, statistic?.check?.modifiers, statistic?.dc?.modifiers];
	return lists.some((list) => Array.isArray(list) && list.some(isFlattenModifier));
}

/**
 * PF2e NPC sheets colour a statistic red (or green) when its total drops below
 * (or rises above) the value written on the actor. Flattening lowers nearly
 * every statistic, which would otherwise paint the whole sheet red.
 *
 * This shifts each statistic's comparison baseline down by the flattening
 * amount, so the colour reflects only changes *beyond* flattening: a negative
 * condition/effect still turns the number red, a buff still turns it green, and
 * a value that is merely flattened keeps its normal colour.
 *
 * @param {Actor} actor
 * @param {object} context  The data object returned by the sheet's getData().
 */
function rebaseAdjustedFlags(actor, context) {
	if (!isUpdatable(actor) || !hasModifier(actor)) return;

	const flatten = getFlatteningValue(actor);
	if (!Number.isFinite(flatten) || flatten === 0) return;

	const system = context?.data;
	if (!system) return;
	const source = actor._source?.system ?? {};

	const recolor = (stat, total, base, shift) => {
		if (!stat || typeof total !== "number" || base === undefined || base === null) return;
		const baseline = Number(base) + shift;
		stat.adjustedHigher = total > baseline;
		stat.adjustedLower = total < baseline;
	};

	// The "all" custom modifier always reaches checks: saves, skills, perception.
	for (const save of Object.values(system.saves ?? {})) {
		recolor(save, save?.totalModifier, save?.base, flatten);
	}
	for (const skill of Object.values(system.skills ?? {})) {
		recolor(skill, skill?.value, skill?.base, flatten);
	}
	recolor(system.perception, system.perception?.totalModifier, source.perception?.mod, flatten);

	// Armour Class is a DC; only rebase it when flattening actually reaches it.
	const acShift = flattenApplies(actor.armorClass) ? flatten : 0;
	recolor(system.attributes?.ac, system.attributes?.ac?.value, source.attributes?.ac?.value, acShift);
}

const patched = new WeakSet();

/** Wraps a sheet class's getData() to rebase its adjustment colouring. */
function patchSheetClass(cls) {
	if (!cls?.prototype || patched.has(cls)) return;
	const original = cls.prototype.getData;
	if (typeof original !== "function") return;

	cls.prototype.getData = async function (...args) {
		const context = await original.apply(this, args);
		try {
			rebaseAdjustedFlags(this.actor, context);
		} catch (error) {
			console.error(`${MODULE_ID} | Failed to rebase sheet colouring`, error);
		}
		return context;
	};
	patched.add(cls);
}

/** Finds a registered actor sheet class for a type by its constructor name. */
function findSheetClass(type, className) {
	const registered = CONFIG.Actor?.sheetClasses?.[type] ?? {};
	for (const entry of Object.values(registered)) {
		if (entry?.cls?.name === className) return entry.cls;
	}
	return null;
}

/**
 * Patches the PF2e NPC sheets so that flattening on its own no longer colours
 * statistics red. Safe to call once the system has registered its sheets.
 */
export function patchActorSheets() {
	patchSheetClass(findSheetClass("npc", "NPCSheetPF2e"));
	patchSheetClass(findSheetClass("npc", "SimpleNPCSheet"));
}
