/**
 * GLUniverse Suite — Timer feature: synthesized urgency audio.
 *
 * No bundled sound files (keeps with the suite's no-build ethos): a soft tick in
 * the final 10 seconds (pitch rising as it drains) and a two-tone alarm at zero,
 * generated live with WebAudio so they stay locked to the visual countdown.
 * Gated per-client by the `timer.sound` setting; honored automatically by the
 * HUD only while the countdown is actually advancing.
 */

import { SUITE_ID } from "../../core/const.mjs";
import { SOUND_KEY } from "./state.mjs";

let _ctx = null;

function ctx() {
  if (_ctx) return _ctx;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    _ctx = AC ? new AC() : null;
  } catch {
    _ctx = null;
  }
  return _ctx;
}

export function soundEnabled() {
  try {
    return game.settings.get(SUITE_ID, SOUND_KEY) !== false;
  } catch {
    return true;
  }
}

function tone(freq, dur, { when = 0, type = "sine", gain = 0.16 } = {}) {
  const c = ctx();
  if (!c) return;
  if (c.state === "suspended") c.resume().catch(() => {});
  const t = c.currentTime + when;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(c.destination);
  osc.start(t);
  osc.stop(t + dur + 0.03);
}

/** Tick for the final 10 s; `secondsLeft` (1..10) raises the pitch as it drops. */
export function playTick(secondsLeft) {
  if (!soundEnabled()) return;
  const n = Math.max(1, Math.min(10, secondsLeft));
  tone(700 + (10 - n) * 55, 0.07, { type: "triangle", gain: 0.13 });
}

/** Two-tone alarm at zero. */
export function playAlarm() {
  if (!soundEnabled()) return;
  tone(880, 0.18, { type: "square", gain: 0.16 });
  tone(660, 0.18, { when: 0.17, type: "square", gain: 0.16 });
  tone(880, 0.34, { when: 0.36, type: "square", gain: 0.18 });
}
