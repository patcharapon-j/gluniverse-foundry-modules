import { MODULE_ID } from "./const.js";

/** Read a registered Loot Gen setting without making callers know lifecycle order. */
export function safeSetting(key, fallback) {
  try {
    return game.settings.get(MODULE_ID, key);
  } catch {
    return fallback;
  }
}
