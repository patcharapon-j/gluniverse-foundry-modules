/**
 * GLUniverse Suite — Timer feature: shared state + GM operations.
 *
 * The single active countdown lives in ONE world setting (`timer.state`), which
 * is the durable source of truth and — via its `onChange` — the propagation
 * channel to every client. While a timer runs no per-second writes happen: each
 * client self-ticks from `anchor` + `remainingMs`; the GM only persists on real
 * transitions (start/pause/adjust/expire) plus a low-frequency checkpoint that
 * keeps the stored value fresh enough to reconcile a cold boot.
 */

import { SUITE_ID } from "../../core/const.mjs";

export const FEATURE_ID = "timer";

/** World-scoped functional state blob (the one active timer). */
export const STATE_KEY = "timer.state";
/** Per-client toggle for the synthesized tick/alarm. */
export const SOUND_KEY = "timer.sound";

/** Urgency thresholds (ms). At/under URGENT the display flips to SS.cc. */
export const URGENT_MS = 60_000;
export const CRITICAL_MS = 10_000;

/** GM persists a checkpoint this often while running; a load-time gap larger
 *  than COLD_BOOT_GAP_MS means the world wasn't running continuously. */
export const CHECKPOINT_MS = 10_000;
export const COLD_BOOT_GAP_MS = 25_000;

export const DEFAULT_STATE = Object.freeze({
  active: false,       // a timer exists → HUD visible
  running: false,      // the timer's OWN run flag (false = timer-paused)
  worldPaused: false,  // mirrors game.paused, frozen authoritatively by the GM
  remainingMs: 0,      // remaining at the `anchor` moment
  anchor: 0,           // Date.now() when remainingMs was last written
  totalMs: 0,          // original duration
  expired: false,      // reached zero, holding at 00.00
});

/** Current authoritative state (defaults-merged, never throws). */
export function getState() {
  try {
    const s = game.settings.get(SUITE_ID, STATE_KEY);
    return { ...DEFAULT_STATE, ...(s && typeof s === "object" ? s : {}) };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

/** GM-only writer (Foundry restricts world-setting writes to the GM). */
async function write(patch) {
  return game.settings.set(SUITE_ID, STATE_KEY, { ...getState(), ...patch });
}

/** Remaining ms for a state at wall-clock `now`. Frozen unless freely running. */
export function remainingOf(state, now = Date.now()) {
  if (!state?.active) return 0;
  const rem = Number(state.remainingMs) || 0;
  const live = state.running && !state.worldPaused && !state.expired;
  if (!live) return Math.max(0, rem);
  return Math.max(0, rem - (now - (Number(state.anchor) || 0)));
}

/** True when the countdown should be visually advancing (ignores game.paused —
 *  the HUD layers that on locally for an instant freeze). */
export function isLive(state) {
  return !!(state?.active && state.running && !state.worldPaused && !state.expired);
}

/** GM-side operations. Every one re-anchors so clients stay consistent. */
export const TimerCtrl = {
  async start(totalMs) {
    const ms = Math.max(0, Math.round(totalMs));
    if (ms <= 0) return;
    await write({
      active: true, running: true, worldPaused: !!game.paused,
      remainingMs: ms, anchor: Date.now(), totalMs: ms, expired: false,
    });
  },

  async pause() {
    const s = getState();
    if (!s.active || !s.running) return;
    await write({ running: false, remainingMs: remainingOf(s) });
  },

  async resume() {
    const s = getState();
    if (!s.active || s.expired) return;
    await write({ running: true, anchor: Date.now(), remainingMs: remainingOf(s), worldPaused: !!game.paused });
  },

  /** Ad-hoc add/remove time. Clamps at 0; re-arms an expired timer if positive. */
  async adjust(deltaMs) {
    const s = getState();
    if (!s.active) return;
    const next = Math.max(0, remainingOf(s) + deltaMs);
    const patch = { remainingMs: next, anchor: Date.now() };
    if (s.expired && next > 0) { patch.expired = false; patch.running = true; }
    if (next <= 0) { patch.expired = true; patch.running = false; }
    await write(patch);
  },

  async clear() {
    await write({ ...DEFAULT_STATE });
  },

  async markExpired() {
    await write({ expired: true, running: false, remainingMs: 0 });
  },

  /** Authoritatively freeze/thaw against the world pause state. */
  async setWorldPaused(paused) {
    const s = getState();
    if (!s.active) return;
    if (paused) await write({ worldPaused: true, remainingMs: remainingOf(s) });
    else await write({ worldPaused: false, anchor: Date.now() });
  },

  /** Cold-boot restore: freeze the timer at its last *stored* remaining (the
   *  last checkpoint) WITHOUT subtracting elapsed time, since that elapsed span
   *  was downtime the countdown must not consume. */
  async restorePaused() {
    const s = getState();
    if (!s.active) return;
    await write({ running: false, worldPaused: false });
  },

  /** Low-frequency persistence so a cold boot can restore near the true value. */
  async checkpoint() {
    const s = getState();
    if (!isLive(s)) return;
    await write({ remainingMs: remainingOf(s), anchor: Date.now() });
  },
};
