/**
 * GLUniverse Suite — the Roleplay Chat mode flag, as every reader sees it.
 *
 * Pure: no `game`, no DOM, importable under plain Node. Three features read this one flag and none of
 * them may import another for it:
 *
 *   - `roleplay-chat` writes it on every line typed through its switch;
 *   - `stream` files a cloned chat card under its chat-filter row (`chat-filter.mjs`);
 *   - `stream-cards` reads it into a text card (`stream-cards/text/read-text.js`).
 *
 * `stream` must never import a child, and the stream readers must work in a world where Roleplay Chat
 * is switched off (its flags stay on every message it ever wrote), so the contract lives in core.
 *
 * Storage. The flag is written nested — `flags[SUITE_ID].rp.mode` — which is the shape Foundry persists
 * for `setFlag(SUITE_ID, "rp.mode", …)` and what `getFlag` reads back. A literal dotted key
 * (`flags[SUITE_ID]["rp.mode"]`) is accepted too, because Foundry does not agree with itself about the
 * shape a dotted flag key takes on the way in (see the stream director channel in CLAUDE.md), and a
 * reader that matched only one shape would read every line as untagged on the other.
 */

import { SUITE_ID } from "./const.mjs";

/** The setting/flag prefix Roleplay Chat owns. */
export const RP_PREFIX = "rp.";

/** The flag key, under SUITE_ID. */
export const RP_MODE_FLAG = `${RP_PREFIX}mode`;

/**
 * Every mode a line can carry.
 *
 *   say       spoken aloud, in character
 *   do        something the character does, narrated in the third person
 *   think     a thought, shown to everyone (the table is the audience, not the other characters)
 *   narrator  the GM speaking as nobody: scene narration
 *   ooc       table talk
 */
export const RP_MODES = Object.freeze(["say", "do", "think", "narrator", "ooc"]);

/** The modes that are in character. */
export const RP_IC_MODES = Object.freeze(["say", "do", "think", "narrator"]);

/** The mode a stored value means, or null when it is not one of ours. */
export function rpModeOf(flags) {
  const scope = flags && typeof flags === "object" ? flags[SUITE_ID] : null;
  if (!scope || typeof scope !== "object") return null;
  const value = scope.rp && typeof scope.rp === "object" ? scope.rp.mode : scope[RP_MODE_FLAG];
  return RP_MODES.includes(value) ? value : null;
}

/** The flags object a new message carries for a mode. */
export function rpModeFlags(mode) {
  if (!RP_MODES.includes(mode)) throw new Error(`Unknown roleplay mode: ${mode}`);
  return { [SUITE_ID]: { rp: { mode } } };
}
