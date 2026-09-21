/**
 * Hexcrawl — the two sounds. Each client plays its own (no socket): the reveal
 * when its store sees hexes rise, the step when a party token moves. Gated on
 * the world switch `hex.sounds` and scaled by the client's `hex.volume`.
 *
 * Throttled per sound, because a reveal of forty hexes arrives as one scene
 * update but a staged commit, a paint preview settling and the move that caused
 * it can all land inside the same second — and forty whooshes is not a reveal.
 */

import { featurePath } from "../../core/const.mjs";
import { FEATURE_ID, SETTINGS } from "./constants.mjs";
import { setting } from "./labels.mjs";

export const SOUNDS = Object.freeze({
  reveal: featurePath(FEATURE_ID, "assets/reveal.wav"),
  step: featurePath(FEATURE_ID, "assets/step.wav"),
});

/** Minimum gap between two plays of the same sound, ms. */
const THROTTLE = Object.freeze({ reveal: 900, step: 120 });
/** Per-sound trim under the user's volume (the whoosh is the louder file). */
const TRIM = Object.freeze({ reveal: 0.8, step: 0.6 });

const last = new Map();

export function playSound(id) {
  try {
    if (!setting(SETTINGS.sounds, true)) return;
    const vol = Math.max(0, Math.min(1, Number(setting(SETTINGS.volume, 0.5)) || 0));
    if (vol <= 0) return;
    const now = performance.now();
    if (now - (last.get(id) ?? -Infinity) < THROTTLE[id]) return;
    last.set(id, now);
    const helper = foundry?.audio?.AudioHelper ?? globalThis.AudioHelper;
    helper?.play({ src: SOUNDS[id], volume: vol * (TRIM[id] ?? 1), autoplay: true, loop: false }, false);
  } catch { /* audio is decoration; never let it break a move */ }
}
