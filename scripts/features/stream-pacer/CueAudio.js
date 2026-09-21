import { MODULE_ID } from './settings.js';

/**
 * CueAudio — the sounds a pacing signal makes when it arrives on a player's
 * screen. Synthesised with Web Audio (no files ship), one short cue per
 * signal so an ear can tell them apart without looking:
 *
 *   soft       — a soft two-note fall: "time to start wrapping up"
 *   countdown  — a sharp two-step rise, then a tick for each of the last 5s
 *   readyCheck — a bright rising ping: a question, not an alarm
 *   campfire   — a low warm chord that swells and fades
 *   allReady   — GM only: a major arpeggio once every player is Ready
 *
 * Player cues read the client-scoped `sp.cueAudio*` settings; the GM's
 * all-ready chime rides the GM notification settings (`sp.handRaiseAudio*`),
 * which is where a GM already turned their other pacer sounds up or down.
 */
const CUES = {
  soft: [
    { freq: 784, at: 0, dur: 0.5, type: 'sine', gain: 0.8 },
    { freq: 587, at: 0.2, dur: 0.75, type: 'sine', gain: 0.75 }
  ],
  countdown: [
    { freq: 988, at: 0, dur: 0.14, type: 'triangle', gain: 0.9 },
    { freq: 1319, at: 0.11, dur: 0.34, type: 'triangle', gain: 0.9 },
    { freq: 2637, at: 0.11, dur: 0.12, type: 'sine', gain: 0.18 }
  ],
  tick: [
    { freq: 1568, at: 0, dur: 0.07, type: 'square', gain: 0.22 }
  ],
  tickFinal: [
    { freq: 2093, at: 0, dur: 0.16, type: 'square', gain: 0.26 },
    { freq: 1046, at: 0, dur: 0.2, type: 'sine', gain: 0.5 }
  ],
  readyCheck: [
    { freq: 660, at: 0, dur: 0.22, type: 'sine', gain: 0.75 },
    { freq: 880, at: 0.09, dur: 0.26, type: 'sine', gain: 0.75 },
    { freq: 1320, at: 0.18, dur: 0.55, type: 'sine', gain: 0.8 },
    { freq: 2640, at: 0.18, dur: 0.2, type: 'sine', gain: 0.12 }
  ],
  campfire: [
    { freq: 196, at: 0, dur: 1.8, type: 'triangle', gain: 0.7, attack: 0.18 },
    { freq: 294, at: 0.06, dur: 1.7, type: 'triangle', gain: 0.5, attack: 0.2 },
    { freq: 392, at: 0.12, dur: 1.4, type: 'sine', gain: 0.25, attack: 0.24 }
  ],
  allReady: [
    { freq: 523, at: 0, dur: 0.35, type: 'sine', gain: 0.7 },
    { freq: 659, at: 0.08, dur: 0.35, type: 'sine', gain: 0.7 },
    { freq: 784, at: 0.16, dur: 0.4, type: 'sine', gain: 0.7 },
    { freq: 1047, at: 0.24, dur: 0.7, type: 'sine', gain: 0.75 }
  ]
};

// Loudness of each cue relative to the user's volume. The ticks sit well under
// the arrival cues: five of them in a row should count down, not nag.
const LEVEL = {
  soft: 0.32, countdown: 0.3, tick: 0.26, tickFinal: 0.3,
  readyCheck: 0.32, campfire: 0.36, allReady: 0.3
};

class CueAudioClass {
  constructor() {
    this._ctx = null;
  }

  _context() {
    if (!this._ctx) {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return null;
      this._ctx = new Ctor();
    }
    // Browsers suspend a context until the page has had a user gesture; any
    // click in Foundry counts, so by the time a GM sends a signal this resumes.
    if (this._ctx.state === 'suspended') this._ctx.resume();
    return this._ctx;
  }

  /** A player-side cue: plays only for non-GM clients with cues enabled. */
  play(name) {
    if (game.user.isGM) return;
    if (!game.settings.get(MODULE_ID, 'sp.cueAudioEnabled')) return;
    this._render(name, game.settings.get(MODULE_ID, 'sp.cueAudioVolume'));
  }

  /** The GM's "everyone is ready" chime. */
  playAllReady() {
    if (!game.user.isGM) return;
    if (!game.settings.get(MODULE_ID, 'sp.handRaiseAudioEnabled')) return;
    this._render('allReady', game.settings.get(MODULE_ID, 'sp.handRaiseAudioVolume'));
  }

  _render(name, volume) {
    const voices = CUES[name];
    if (!voices || !(volume > 0)) return;
    try {
      const ctx = this._context();
      if (!ctx) return;
      const now = ctx.currentTime;
      const master = ctx.createGain();
      master.gain.setValueAtTime(volume * (LEVEL[name] ?? 0.3), now);
      master.connect(ctx.destination);

      for (const v of voices) {
        const at = now + v.at;
        const attack = v.attack ?? 0.008;
        const osc = ctx.createOscillator();
        osc.type = v.type;
        osc.frequency.setValueAtTime(v.freq, at);
        const env = ctx.createGain();
        env.gain.setValueAtTime(0, at);
        env.gain.linearRampToValueAtTime(v.gain, at + attack);
        env.gain.exponentialRampToValueAtTime(0.001, at + Math.max(attack + 0.02, v.dur));
        osc.connect(env);
        env.connect(master);
        osc.start(at);
        osc.stop(at + v.dur + 0.05);
      }
    } catch (e) {
      console.warn(`${MODULE_ID} | Failed to play pacer cue "${name}":`, e);
    }
  }
}

export const CueAudio = new CueAudioClass();
