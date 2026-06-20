/**
 * Resolves the active calendar definition and installs it into CONFIG.time so
 * Foundry's native GameTime/CalendarData drives all date math.
 */

import { PRESETS, DEFAULT_PRESET } from "./presets.js";
import { MODULE_ID, SETTINGS, HOOKS } from "../const.js";

function safeGet(key, fallback) {
  try { return game.settings.get(MODULE_ID, key); }
  catch { return fallback; }
}

/** A stored custom config (from the editor) wins; otherwise the chosen preset. */
export function getActiveCalendarConfig() {
  const custom = safeGet(SETTINGS.calendarConfig, null);
  if (custom && typeof custom === "object" && custom.days?.values?.length) return custom;
  const id = safeGet(SETTINGS.calendarId, DEFAULT_PRESET);
  return PRESETS[id] ?? PRESETS[DEFAULT_PRESET];
}

/**
 * Install the active calendar. Call in `init` (before GameTime is built) and
 * again after the GM changes the definition (with reinitialize:true).
 */
export function applyCalendar({ reinitialize = false } = {}) {
  const cfg = foundry.utils.deepClone(getActiveCalendarConfig());
  CONFIG.time.worldCalendarConfig = cfg;
  if (reinitialize) game.time?.initializeCalendar?.();
  Hooks.callAll(HOOKS.calendarChanged, cfg);
  return cfg;
}
