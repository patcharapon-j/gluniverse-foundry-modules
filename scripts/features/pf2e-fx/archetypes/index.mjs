/**
 * Spellsprite archetypes: the drawers, by archetype id (archetypes/rules.mjs
 * picks the id). One file per group so each can be drawn on its own.
 */

import { ARCH_VOCAB } from "./rules.mjs";
import mind from "./mind.mjs";
import body from "./body.mjs";
import self from "./self.mjs";
import shift from "./shift.mjs";
import ward from "./ward.mjs";
import veil from "./veil.mjs";

export const ARCH_DRAW = Object.freeze({ ...mind, ...body, ...self, ...shift, ...ward, ...veil });

/** Archetypes with no drawer, for fx-check. */
export const missingArch = () => ARCH_VOCAB.filter((a) => typeof ARCH_DRAW[a] !== "function");
