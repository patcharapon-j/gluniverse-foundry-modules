import {
	MODIFIER_LABEL,
	MODIFIER_SELECTOR,
	MODIFIER_SLUG,
	ROUNDING_FUNCTIONS,
	Settings,
} from "./constants.js";
import { getSetting } from "./settings.js";

/**
 * An actor can be flattened if it is an NPC, or a PC while PC flattening is
 * enabled in the module settings.
 * @param {Actor} actor
 * @returns {boolean}
 */
export function isUpdatable(actor) {
	if (!actor) return false;
	if (actor.type === "npc") return true;
	return actor.type === "character" && getSetting(Settings.FLATTEN_PCS);
}

/**
 * Returns the PF2e custom modifier managed by this module, or `null`.
 * @param {Actor} actor
 */
function getFlattenModifier(actor) {
	const modifiers = actor?.system?.customModifiers?.[MODIFIER_SELECTOR] ?? [];
	return modifiers.find((modifier) => modifier.label === MODIFIER_LABEL) ?? null;
}

/** Whether the actor currently carries the flattening modifier. */
export const hasModifier = (actor) => getFlattenModifier(actor) !== null;

/** The value of the actor's flattening modifier, or `undefined` if absent. */
export const getFlatteningValue = (actor) => getFlattenModifier(actor)?.modifier;

/**
 * Computes the (non-positive) modifier required to flatten an actor's
 * proficiency, honouring the multiplier and rounding-mode settings.
 * @param {Actor} actor
 * @returns {number}
 */
export function computeFlatteningValue(actor) {
	const level = Number(actor?.system?.details?.level?.value) || 0;
	const multiplier = getSetting(Settings.MULTIPLIER);
	const round = ROUNDING_FUNCTIONS[getSetting(Settings.ROUNDING_MODE)] ?? Math.ceil;
	return -Math.max(round(level * multiplier), 0);
}

/**
 * Applies the flattening modifier to an actor. No-op if already flattened.
 * @param {Actor} actor
 */
export async function flattenActor(actor) {
	if (!actor || hasModifier(actor)) return;
	const value = computeFlatteningValue(actor);
	await actor.addCustomModifier(MODIFIER_SELECTOR, MODIFIER_LABEL, value, "untyped");
}

/**
 * Removes the flattening modifier from an actor. No-op if not flattened.
 * @param {Actor} actor
 */
export async function unflattenActor(actor) {
	const modifier = getFlattenModifier(actor);
	if (!modifier) return;
	await actor.removeCustomModifier(MODIFIER_SELECTOR, modifier.slug ?? MODIFIER_SLUG);
}

/**
 * Re-applies flattening when the stored value no longer matches the actor's
 * current level (e.g. after a level change).
 * @param {Actor} actor
 * @returns {Promise<boolean>} whether the modifier was refreshed
 */
export async function refreshActor(actor) {
	if (!hasModifier(actor)) return false;
	if (getFlatteningValue(actor) === computeFlatteningValue(actor)) return false;
	await unflattenActor(actor);
	await flattenActor(actor);
	return true;
}
