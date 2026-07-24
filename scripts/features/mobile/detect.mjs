/**
 * GLUniverse Suite — Mobile feature: device detection + activation state.
 *
 * "Mobile mode" targets players on phones: a touch-capable device whose
 * smaller viewport dimension is phone-sized. Tablets (touch + large viewport)
 * deliberately keep the desktop UI. A per-client override can force the mode
 * on or off regardless of the heuristic.
 */

import { SUITE_ID } from "../../core/const.mjs";

export const FEATURE_ID = "mobile";
export const KEY_MODE = "mob.mode"; // "auto" | "on" | "off" (client)
export const KEY_PERF_BACKUP = "mob.perfBackup"; // client: legacy clamp stash (restore-only)

/** Smaller viewport dimension at or below this reads as a phone. */
const PHONE_MAX_DIM = 820;

/** Touch-capable client, regardless of viewport size. */
export function touchCapable() {
  return (navigator.maxTouchPoints ?? 0) > 0 || matchMedia("(pointer: coarse)").matches;
}

/** Pure heuristic: touch-capable AND phone-sized viewport. */
export function detectPhone() {
  const dim = Math.min(window.innerWidth, window.innerHeight);
  return touchCapable() && dim <= PHONE_MAX_DIM;
}

/** Resolved activation: the client override wins, otherwise the heuristic. */
export function mobileActive() {
  let mode = "auto";
  try {
    mode = game.settings.get(SUITE_ID, KEY_MODE) ?? "auto";
  } catch {
    /* settings not ready */
  }
  if (mode === "on") return true;
  if (mode === "off") return false;
  return detectPhone();
}
