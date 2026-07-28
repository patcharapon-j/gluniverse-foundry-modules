import { MODULE_ID, SETTINGS, LLM_TIMEOUT } from "./const.js";
import { clamp } from "../../core/util.mjs";

/** Read a registered Loot Gen setting without making callers know lifecycle order. */
export function safeSetting(key, fallback) {
  try {
    return game.settings.get(MODULE_ID, key);
  } catch {
    return fallback;
  }
}

/**
 * The GM-configured client cap for ONE sidecar call, in ms (see LLM_TIMEOUT).
 * Clamped to the setting's own range so a hand-edited world value can't disable
 * the abort entirely. Every sidecar caller reads this, so raising the setting
 * lifts flavor, shop, planning and workshop requests together.
 */
export function llmTimeoutMs() {
  const raw = Number(safeSetting(SETTINGS.llmTimeoutSec, LLM_TIMEOUT.DEFAULT_SEC));
  const sec = Number.isFinite(raw) && raw > 0 ? raw : LLM_TIMEOUT.DEFAULT_SEC;
  return clamp(sec, LLM_TIMEOUT.MIN_SEC, LLM_TIMEOUT.MAX_SEC) * 1000;
}
