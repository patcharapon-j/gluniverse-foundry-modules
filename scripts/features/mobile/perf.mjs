/**
 * GLUniverse Suite — Mobile feature: battery helpers.
 *
 * Mobile mode does NOT change the client's canvas quality settings — the
 * player keeps whatever performance mode / FPS cap they chose. The only
 * battery lever is freezing the PIXI ticker while a non-canvas tab is
 * fronted.
 *
 * restorePerfProfile() remains solely as a one-time cleanup for clients that
 * had their settings clamped by an earlier build (stashed in mob.perfBackup).
 */

import { SUITE_ID, warn } from "../../core/const.mjs";
import { KEY_PERF_BACKUP } from "./detect.mjs";

/** One-time undo of the legacy performance clamp, if a backup exists. */
export async function restorePerfProfile() {
  try {
    const backup = game.settings.get(SUITE_ID, KEY_PERF_BACKUP) ?? {};
    if (!Object.keys(backup).length) return;
    if ("performanceMode" in backup) await game.settings.set("core", "performanceMode", backup.performanceMode);
    if ("maxFPS" in backup) await game.settings.set("core", "maxFPS", backup.maxFPS);
    await game.settings.set(SUITE_ID, KEY_PERF_BACKUP, {});
  } catch (e) {
    warn("Mobile perf settings could not be restored:", e);
  }
}

/** Freeze/resume PIXI rendering when the canvas is hidden behind another tab. */
export function setCanvasFrozen(frozen) {
  const ticker = canvas?.app?.ticker;
  if (!ticker || !canvas?.ready) return;
  if (frozen && ticker.started) ticker.stop();
  else if (!frozen && !ticker.started) ticker.start();
}
