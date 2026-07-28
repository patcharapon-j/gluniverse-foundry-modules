import { MODULE_ID, SAFETY_STATUS } from './settings.js';

/**
 * AudioManager - Handles audio notifications for Stream Pacer
 * Uses Web Audio API to synthesize a soft chime sound
 * Includes per-player cooldown to prevent spam
 */
export class AudioManager {
  constructor() {
    this._audioContext = null;
    this._cooldowns = new Map(); // userId -> timestamp
    this._cooldownDuration = 3000; // 3 seconds
  }

  /**
   * Lazy-initialize AudioContext (required by browsers after user interaction)
   */
  _getContext() {
    if (!this._audioContext) {
      this._audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    // Resume if suspended (browser autoplay policy)
    if (this._audioContext.state === 'suspended') {
      this._audioContext.resume();
    }
    return this._audioContext;
  }

  /**
   * Check if audio is enabled in settings
   */
  _isEnabled() {
    return game.settings.get(MODULE_ID, 'sp.handRaiseAudioEnabled');
  }

  /**
   * Get volume from settings (0-1)
   */
  _getVolume() {
    return game.settings.get(MODULE_ID, 'sp.handRaiseAudioVolume');
  }

  /**
   * Check if a player is on cooldown
   */
  _isOnCooldown(userId) {
    const lastPlayed = this._cooldowns.get(userId);
    if (!lastPlayed) return false;
    return (Date.now() - lastPlayed) < this._cooldownDuration;
  }

  /**
   * Set cooldown for a player
   */
  _setCooldown(userId) {
    this._cooldowns.set(userId, Date.now());
  }

  /**
   * Play hand raise chime notification
   * @param {string} userId - The user who raised their hand
   */
  playHandRaiseChime(userId) {
    // Only play for GM
    if (!game.user.isGM) return;

    // Check if enabled
    if (!this._isEnabled()) return;

    // Check cooldown
    if (this._isOnCooldown(userId)) return;

    // Set cooldown
    this._setCooldown(userId);

    // Play the chime
    this._synthesizeChime();
  }

  /**
   * Play the safety-light escalation cue (GM only). Yellow gets a soft
   * two-tone attention chime; red gets a lower, slower, unmistakably serious
   * one. Green never rings — lowering a light is good news, not an alert.
   * @param {string} status - A SAFETY_STATUS value
   */
  playSafetyChime(status) {
    if (!game.user.isGM) return;
    if (status !== SAFETY_STATUS.YELLOW && status !== SAFETY_STATUS.RED) return;
    if (!game.settings.get(MODULE_ID, 'sp.safetyAudioEnabled')) return;

    const isRed = status === SAFETY_STATUS.RED;
    // A safety escalation is never spam — no cooldown here, but the red cue
    // is deliberately distinct so two colours can't be confused.
    this._synthesizeChime(isRed
      ? { frequencies: [392, 262], durations: [1.1, 1.3], gain: 0.5, shimmer: false, repeat: 3, spacing: 0.34 }
      : { frequencies: [660, 880], durations: [0.5, 0.6], gain: 0.36, shimmer: false, repeat: 2, spacing: 0.26 });
  }

  /**
   * Synthesize and play a soft bell/chime sound using Web Audio API
   * Creates a pleasant two-tone chime with quick attack and natural decay
   */
  _synthesizeChime({
    frequencies = [830, 1245],   // Roughly G5 and D#6 — pleasant bell interval
    durations = [0.4, 0.5],
    gain = 0.3,
    shimmer = true,
    repeat = 1,
    spacing = 0
  } = {}) {
    try {
      const ctx = this._getContext();
      const now = ctx.currentTime;
      const volume = this._getVolume();

      // Master gain node
      const masterGain = ctx.createGain();
      masterGain.connect(ctx.destination);
      masterGain.gain.setValueAtTime(volume * gain, now);

      // One strike of the bell: the two-tone body plus optional shimmer.
      const strike = (at) => {
        frequencies.forEach((freq, i) => {
          // Oscillator
          const osc = ctx.createOscillator();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, at);

          // Individual gain envelope for this oscillator
          const voiceGain = ctx.createGain();
          voiceGain.gain.setValueAtTime(0, at);

          // Quick attack
          voiceGain.gain.linearRampToValueAtTime(i === 0 ? 1 : 0.6, at + 0.01);

          // Natural decay
          voiceGain.gain.exponentialRampToValueAtTime(0.001, at + durations[i]);

          // Connect: oscillator -> gain -> master
          osc.connect(voiceGain);
          voiceGain.connect(masterGain);

          // Start and stop
          osc.start(at);
          osc.stop(at + durations[i] + 0.1);
        });

        if (!shimmer) return;

        // Add a subtle high harmonic for shimmer
        const shimmerOsc = ctx.createOscillator();
        shimmerOsc.type = 'sine';
        shimmerOsc.frequency.setValueAtTime(2490, at); // High harmonic

        const shimmerGain = ctx.createGain();
        shimmerGain.gain.setValueAtTime(0, at);
        shimmerGain.gain.linearRampToValueAtTime(0.15, at + 0.005);
        shimmerGain.gain.exponentialRampToValueAtTime(0.001, at + 0.2);

        shimmerOsc.connect(shimmerGain);
        shimmerGain.connect(masterGain);
        shimmerOsc.start(at);
        shimmerOsc.stop(at + 0.3);
      };

      for (let i = 0; i < Math.max(1, repeat); i++) strike(now + i * spacing);

    } catch (e) {
      console.warn(`${MODULE_ID} | Failed to play audio notification:`, e);
    }
  }

  /**
   * Clean up resources
   */
  destroy() {
    if (this._audioContext) {
      this._audioContext.close();
      this._audioContext = null;
    }
    this._cooldowns.clear();
  }
}
