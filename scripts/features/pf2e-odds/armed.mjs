/**
 * The armed action's shape — the pure half of tracker.mjs, so the check tool
 * can drive it under plain Node.
 *
 * `map` is the multiple-attack-penalty button the player hovered or clicked
 * (0, 1, 2), present only when they pointed at one; absent means the first
 * attack, which is also what PF2e's own first button rolls.
 */

const MAPS = [0, 1, 2];

const mapOk = (a) => a.map === undefined || MAPS.includes(a.map);

export const validArmed = (a) =>
  !!a &&
  mapOk(a) &&
  ((a.kind === "strike" && (a.slug == null || typeof a.slug === "string")) ||
    (a.kind === "skill" && typeof a.action === "string") ||
    (a.kind === "spell" && typeof a.uuid === "string" && (a.mode === "attack" || a.mode === "save")));

/** The MAP index an armed action prices at. */
export const mapOf = (armed) => (armed && MAPS.includes(armed.map) ? armed.map : 0);
