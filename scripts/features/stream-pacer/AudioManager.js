import { MODULE_ID } from './settings.js';

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
    return game.settings.get(MODULE_ID, 'handRaiseAudioEnabled');
  }

  /**
   * Get volume from settings (0-1)
   */
  _getVolume() {
    return game.settings.get(MODULE_ID, 'handRaiseAudioVolume');
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
   * Synthesize and play a soft bell/chime sound using Web Audio API
   * Creates a pleasant two-tone chime with quick attack and natural decay
   */
  _synthesizeChime() {
    try {
      const ctx = this._getContext();
      const now = ctx.currentTime;
      const volume = this._getVolume();

      // Master gain node
      const masterGain = ctx.createGain();
      masterGain.connect(ctx.destination);
      masterGain.gain.setValueAtTime(volume * 0.3, now);

      // Create two oscillators for a richer bell sound
      const frequencies = [830, 1245]; // Roughly G5 and D#6 - pleasant bell interval
      const durations = [0.4, 0.5];

      frequencies.forEach((freq, i) => {
        // Oscillator
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now);

        // Individual gain envelope for this oscillator
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0, now);
        
        // Quick attack
        gain.gain.linearRampToValueAtTime(i === 0 ? 1 : 0.6, now + 0.01);
        
        // Natural decay
        gain.gain.exponentialRampToValueAtTime(0.001, now + durations[i]);

        // Connect: oscillator -> gain -> master
        osc.connect(gain);
        gain.connect(masterGain);

        // Start and stop
        osc.start(now);
        osc.stop(now + durations[i] + 0.1);
      });

      // Add a subtle high harmonic for shimmer
      const shimmerOsc = ctx.createOscillator();
      shimmerOsc.type = 'sine';
      shimmerOsc.frequency.setValueAtTime(2490, now); // High harmonic

      const shimmerGain = ctx.createGain();
      shimmerGain.gain.setValueAtTime(0, now);
      shimmerGain.gain.linearRampToValueAtTime(0.15, now + 0.005);
      shimmerGain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);

      shimmerOsc.connect(shimmerGain);
      shimmerGain.connect(masterGain);
      shimmerOsc.start(now);
      shimmerOsc.stop(now + 0.3);

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
