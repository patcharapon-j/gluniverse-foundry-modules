// module/sound.mjs — Procedural sound generation via Web Audio API

import { SUITE_ID } from "../../../core/const.mjs";

/**
 * Sound profiles per theme. Each has a `line` and `reveal` function
 * that create and play a short procedural sound.
 */
const PROFILES = {
  dreadlight: {
    /** Stage 1: Low eerie tone with slight detuning */
    line(ctx, gain) {
      const osc = ctx.createOscillator();
      const oscSub = ctx.createOscillator();
      const filter = ctx.createBiquadFilter();
      const env = ctx.createGain();

      osc.type = "sine";
      osc.frequency.setValueAtTime(180, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(120, ctx.currentTime + 0.8);

      oscSub.type = "sine";
      oscSub.frequency.setValueAtTime(183, ctx.currentTime);
      oscSub.frequency.exponentialRampToValueAtTime(122, ctx.currentTime + 0.8);
      oscSub.detune.setValueAtTime(8, ctx.currentTime);

      filter.type = "lowpass";
      filter.frequency.setValueAtTime(600, ctx.currentTime);

      env.gain.setValueAtTime(0, ctx.currentTime);
      env.gain.linearRampToValueAtTime(gain * 0.4, ctx.currentTime + 0.1);
      env.gain.linearRampToValueAtTime(gain * 0.25, ctx.currentTime + 0.5);
      env.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.8);

      osc.connect(filter);
      oscSub.connect(filter);
      filter.connect(env);
      env.connect(ctx.destination);

      osc.start(ctx.currentTime);
      oscSub.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.9);
      oscSub.stop(ctx.currentTime + 0.9);
    },

    /** Stage 2: Atmospheric swell with harmonic overtones */
    reveal(ctx, gain) {
      const osc = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const filter = ctx.createBiquadFilter();
      const env = ctx.createGain();

      osc.type = "triangle";
      osc.frequency.setValueAtTime(220, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(260, ctx.currentTime + 0.6);
      osc.frequency.exponentialRampToValueAtTime(200, ctx.currentTime + 1.2);

      osc2.type = "sine";
      osc2.frequency.setValueAtTime(330, ctx.currentTime);
      osc2.frequency.exponentialRampToValueAtTime(390, ctx.currentTime + 0.6);
      osc2.frequency.exponentialRampToValueAtTime(310, ctx.currentTime + 1.2);

      filter.type = "lowpass";
      filter.frequency.setValueAtTime(400, ctx.currentTime);
      filter.frequency.linearRampToValueAtTime(900, ctx.currentTime + 0.6);
      filter.frequency.linearRampToValueAtTime(300, ctx.currentTime + 1.2);

      env.gain.setValueAtTime(0, ctx.currentTime);
      env.gain.linearRampToValueAtTime(gain * 0.3, ctx.currentTime + 0.3);
      env.gain.linearRampToValueAtTime(gain * 0.2, ctx.currentTime + 0.8);
      env.gain.linearRampToValueAtTime(0, ctx.currentTime + 1.2);

      osc.connect(filter);
      osc2.connect(filter);
      filter.connect(env);
      env.connect(ctx.destination);

      osc.start(ctx.currentTime);
      osc2.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 1.3);
      osc2.stop(ctx.currentTime + 1.3);
    },
  },

  fantasy: {
    /** Stage 1: Soft mystical chime */
    line(ctx, gain) {
      const osc = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const env = ctx.createGain();

      osc.type = "sine";
      osc.frequency.setValueAtTime(880, ctx.currentTime);

      osc2.type = "sine";
      osc2.frequency.setValueAtTime(1320, ctx.currentTime);

      env.gain.setValueAtTime(0, ctx.currentTime);
      env.gain.linearRampToValueAtTime(gain * 0.25, ctx.currentTime + 0.02);
      env.gain.exponentialRampToValueAtTime(gain * 0.08, ctx.currentTime + 0.3);
      env.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.6);

      osc.connect(env);
      osc2.connect(env);
      env.connect(ctx.destination);

      osc.start(ctx.currentTime);
      osc2.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.7);
      osc2.stop(ctx.currentTime + 0.7);
    },

    /** Stage 2: Warm arcane shimmer */
    reveal(ctx, gain) {
      const notes = [523.25, 659.25, 783.99]; // C5, E5, G5 major chord
      const oscs = notes.map(freq => {
        const osc = ctx.createOscillator();
        osc.type = "sine";
        osc.frequency.setValueAtTime(freq, ctx.currentTime);
        return osc;
      });

      const env = ctx.createGain();
      env.gain.setValueAtTime(0, ctx.currentTime);
      env.gain.linearRampToValueAtTime(gain * 0.2, ctx.currentTime + 0.1);
      env.gain.linearRampToValueAtTime(gain * 0.15, ctx.currentTime + 0.5);
      env.gain.linearRampToValueAtTime(0, ctx.currentTime + 1.0);

      oscs.forEach(osc => {
        osc.connect(env);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 1.1);
      });

      env.connect(ctx.destination);
    },
  },
};

/** @type {AudioContext|null} */
let audioCtx = null;

/**
 * Get or create the shared AudioContext.
 * @returns {AudioContext}
 */
function getContext() {
  if (!audioCtx) audioCtx = new AudioContext();
  return audioCtx;
}

/**
 * Play a notification sound.
 * @param {"line"|"reveal"} stage - Which stage sound to play
 * @param {string} [themeId] - Theme ID. Defaults to the module setting.
 */
export function playSound(stage, themeId) {
  if (!game.settings.get(SUITE_ID, "insight.soundEnabled")) return;

  const id = themeId ?? game.settings.get(SUITE_ID, "insight.theme");
  const profile = PROFILES[id] ?? PROFILES.dreadlight;
  const fn = profile[stage];
  if (!fn) return;

  const ctx = getContext();
  if (ctx.state === "suspended") ctx.resume();

  const volume = game.settings.get(SUITE_ID, "insight.soundVolume");
  fn(ctx, volume);
}

/**
 * Play a custom sound file using FoundryVTT's audio API.
 * @param {string} src - Path to the audio file
 */
export function playCustomSound(src) {
  if (!game.settings.get(SUITE_ID, "insight.soundEnabled")) return;
  const volume = game.settings.get(SUITE_ID, "insight.soundVolume");
  foundry.audio.AudioHelper.play({ src, volume, loop: false }, false);
}
