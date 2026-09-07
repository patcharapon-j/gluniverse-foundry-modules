/**
 * GLUniverse Suite — Arcane Surge settings access.
 *
 * Every read goes through here so a stored value is sanitised in exactly one
 * place. World settings are GM-written and therefore trusted only as far as
 * `levels.resolveConfig()` will repair them.
 *
 * Note what does NOT need a socket: the stability level is a world setting, and
 * a world setting's `onChange` fires on every connected client already. The
 * suite's weather does the same thing for the same reason. The socket in this
 * feature exists for exactly one job — a GM releasing a held NPC surge — and
 * nothing else should reach for it.
 */

import { SUITE_ID, warn } from "../../core/const.mjs";
import { clamp, toInt } from "../../core/util.mjs";
import { DEFAULT_ELIGIBILITY, LEVELS, SETTINGS } from "./constants.mjs";
import { isLevel, resolveConfig } from "./levels.mjs";

const get = (key, fallback) => {
  try {
    return game.settings.get(SUITE_ID, key);
  } catch {
    return fallback;
  }
};

/* ── Stability level ───────────────────────────────────────────────── */

/** The area's stability. One world-global value the GM sets by hand. */
export function currentLevel() {
  const stored = get(SETTINGS.level, "stable");
  return isLevel(stored) ? stored : "stable";
}

/** GM-only. Players changing this would be setting their own difficulty. */
export async function setLevel(level) {
  if (!game.user.isGM) return;
  if (!isLevel(level)) return warn(`Arcane Surge | ignoring unknown stability level "${level}"`);
  await game.settings.set(SUITE_ID, SETTINGS.level, level);
}

/** The live, repaired odds table. */
export const levelConfig = () => resolveConfig(get(SETTINGS.levelConfig, {}));

/* ── Concealment ───────────────────────────────────────────────────── */

/**
 * While concealed the chip and the ambient overlay are hidden and the
 * MECHANICS KEEP RUNNING. A surge still fires and still animates — the party
 * finds out the hard way, which is the point. The draft calls for exactly this:
 * exceptional concealment, established deliberately.
 */
export const isConcealed = () => !!get(SETTINGS.conceal, false);

/** What a given user should believe the level is. */
export const visibleLevel = () => (isConcealed() && !game.user.isGM ? "stable" : currentLevel());

/* ── Eligibility ───────────────────────────────────────────────────── */

export function eligibility() {
  const stored = get(SETTINGS.eligibility, {}) ?? {};
  return {
    cantrips: bool(stored.cantrips, DEFAULT_ELIGIBILITY.cantrips),
    focus: bool(stored.focus, DEFAULT_ELIGIBILITY.focus),
    innate: bool(stored.innate, DEFAULT_ELIGIBILITY.innate),
    fromItems: bool(stored.fromItems, DEFAULT_ELIGIBILITY.fromItems),
    rituals: bool(stored.rituals, DEFAULT_ELIGIBILITY.rituals),
    npcCasters: bool(stored.npcCasters, DEFAULT_ELIGIBILITY.npcCasters),
    minRank: clamp(toInt(stored.minRank ?? DEFAULT_ELIGIBILITY.minRank, DEFAULT_ELIGIBILITY.minRank), 0, 10),
  };
}

const bool = (value, fallback) => (typeof value === "boolean" ? value : fallback);

/* ── Client preferences ────────────────────────────────────────────── */

/** Per-client: the session-long overlay is the first thing a laptop wants off. */
export const ambientEnabled = () => !!get(SETTINGS.ambient, true);

/** "always" | "surge" | "never" — when the 3D die is thrown. */
export function dieVisibility() {
  const stored = get(SETTINGS.dieVisibility, "always");
  return ["always", "surge", "never"].includes(stored) ? stored : "always";
}

/* ── The armed next-cast choice ────────────────────────────────────── */

export const ARM_MODES = Object.freeze(["none", "steadied", "invited"]);

/**
 * Steady the Spell / Invite the Surge are player declarations made BEFORE the
 * cast, so nothing in a chat message can tell us about them. The player arms one
 * on their character sheet's spellcasting tab and it applies to that actor's
 * next eligible casting only.
 *
 * Stored as `{ actor, mode }`, client-scoped. Both halves matter:
 *
 *   - Client, because it is that player's declaration about their own casting
 *     and must never leak into anybody else's.
 *   - Actor, because the control lives on a specific sheet. A player running two
 *     characters who steadies one would otherwise silently steady the other's
 *     next spell, which is a rules error the table would never spot.
 */
export function armedState() {
  const stored = get(SETTINGS.armed, null);
  const mode = ARM_MODES.includes(stored?.mode) ? stored.mode : "none";
  const actor = typeof stored?.actor === "string" ? stored.actor : null;
  if (mode === "none" || !actor) return { actor: null, mode: "none" };
  // Inviting requires actual instability. If the GM stabilised the world after
  // the player armed it, the choice quietly lapses rather than misfiring.
  if (mode === "invited" && currentLevel() === "stable") return { actor: null, mode: "none" };
  return { actor, mode };
}

/** The mode that applies to a given actor's casting — "none" for any other. */
export function armedMode(actorId = null) {
  const state = armedState();
  if (!state.actor) return "none";
  if (actorId && state.actor !== actorId) return "none";
  return state.mode;
}

export async function setArmedMode(mode, actorId = null) {
  const next = ARM_MODES.includes(mode) ? mode : "none";
  await game.settings.set(SUITE_ID, SETTINGS.armed, next === "none" ? null : { actor: actorId, mode: next });
}

/** Called after one eligible casting consumes the choice, and on scene change:
 *  an armed state a player set an hour ago is a trap, not a declaration. */
export const clearArmedMode = () => setArmedMode("none");

/* ── Localisation helpers for the runtime-built key families ───────── */

export const levelLabel = (level) => game.i18n.localize(`GLAS.level.${isLevel(level) ? level : "stable"}`);
export const levelHint = (level) => game.i18n.localize(`GLAS.levelHint.${isLevel(level) ? level : "stable"}`);
export const tierLabel = (tier) => game.i18n.localize(`GLAS.tier.${tier}`);
export const rowLabel = (row) => game.i18n.localize(`GLAS.row.${row}`);
export const modeLabel = (mode) => game.i18n.localize(`GLAS.mode.${ARM_MODES.includes(mode) ? mode : "none"}`);

/** Every level, for the GM's picker. */
export const allLevels = () => LEVELS.slice();
