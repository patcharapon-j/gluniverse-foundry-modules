// module/recipients.mjs — who a quick pick in the compose window ticks, and
// what a shared card says instead of "Only you". Pure: no `game`, no `canvas`,
// so tools/insight-check.mjs drives it under plain Node.

/** Above this many other recipients a shared card counts them instead of naming them. */
export const NAMED_MAX = 2;

/**
 * The actors behind some tokens, each once. Accepts canvas Tokens (`.actor`)
 * or TokenDocuments (`.actor` too); anything without an actor is skipped.
 * @param {Iterable<{actor?: object}>} tokens
 * @returns {object[]}
 */
export function actorsOf(tokens) {
  return [...new Set([...(tokens ?? [])].map((t) => t?.actor).filter(Boolean))];
}

/**
 * The connected players who own at least one of these actors. GMs are left out:
 * a GM owns everything, so "the owners of the selected tokens" would always
 * include every co-GM.
 * @param {object[]} actors - each with `testUserPermission(user, level)`
 * @param {Iterable<{id: string, active?: boolean, isGM?: boolean}>} users
 * @returns {string[]} user ids
 */
export function playerOwners(actors, users) {
  const ids = [];
  for (const u of users ?? []) {
    if (!u?.active || u.isGM) continue;
    if (actors.some((a) => a?.testUserPermission?.(u, "OWNER"))) ids.push(u.id);
  }
  return ids;
}

/**
 * The tag a shared card carries in place of "Only you": the other recipients
 * by name, or by count once there are too many to fit the head.
 * @param {string[]} names - the other recipients' names, never this user's
 * @param {(key: string, data: object) => string} format - i18n format
 * @param {string} [lang] - for the list's "and"
 * @returns {string|null} null when there is nobody else (the card says "Only you")
 */
export function sharedLabel(names, format, lang) {
  const list = (names ?? []).filter((n) => typeof n === "string" && n.trim());
  if (!list.length) return null;
  if (list.length > NAMED_MAX) return format("INSIGHT.SharedWithCount", { count: list.length });
  let joined;
  try {
    joined = new Intl.ListFormat(lang || "en", { style: "long", type: "conjunction" }).format(list);
  } catch {
    joined = list.join(", ");
  }
  return format("INSIGHT.SharedWith", { names: joined });
}
