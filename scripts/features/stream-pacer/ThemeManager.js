/**
 * Stream Pacer appearance controller.
 *
 * The look is fixed — Etched Glass, like the rest of the suite. This class only
 * exists because the Dire Peril and Campfire effects are WebGL: a fragment
 * shader cannot read a CSS custom property, so the same colours have to be
 * derived once and handed to the renderer as 0..1 rgb arrays.
 *
 * What changed in the design-system refactor: this used to own two literal
 * hexes and stamp a dozen `--sp-*` properties onto GLOBAL `:root` through an
 * injected <style> element, which put a feature's palette in everyone's scope
 * and bypassed the token layer entirely. Now:
 *   • the source colours come from the shared palette (scripts/core/theme.mjs),
 *   • the derived properties are written to the feature's own scope, and
 *   • the colour maths uses the shared helpers instead of a private copy.
 */

import { PALETTE, lighten, darken, mix, withAlpha, hexToRgbFloat }
  from "../../core/theme.mjs";

/**
 * Stream Pacer's source colours, taken from the shared palette.
 *
 * `accent` was a bespoke brass amber (#e4b055) sitting a few degrees off the
 * suite's signal amber for no semantic reason — exactly the drift this refactor
 * removes, so it now uses the canonical token. `peril` keeps its exact original
 * crimson, promoted into the palette as `--gl-peril` / `PALETTE.peril` because
 * "escalation beyond hazard" is a real semantic other features can reuse.
 */
export const DEFAULT_THEME = {
  accent: PALETTE.signal,
  peril: PALETTE.peril,
};

class ThemeManagerClass {
  constructor() {
    this._styleEl = null;
    this._peril = null; // cached { deep, mid, hot } as 0..1 rgb arrays
  }

  /** Build the accent + Dire Peril custom-property map. */
  _buildPalette() {
    const a = DEFAULT_THEME.accent;
    const p = DEFAULT_THEME.peril;

    // Derived accent tone — a softer, brighter sibling for highlights.
    const accentSoft = lighten(a, 0.18);

    // Derived peril tones — a deep near-black bed, a bright highlight, and a
    // hot "alert red" pushed toward saturated red-orange for the danger read.
    const perilDeep = darken(p, 0.82);
    const perilBright = lighten(p, 0.62);
    const perilHot = mix(p, '#ff1e30', 0.5);
    const perilGhost = lighten(mix(p, '#78dcff', 0.6), 0.1);

    const vars = {
      '--sp-amber': a,
      '--sp-amber-soft': accentSoft,
      '--sp-amber-dim': withAlpha(a, 0.22),
      '--sp-amber-glow': withAlpha(a, 0.4),

      '--sp-peril': p,
      '--sp-peril-deep': perilDeep,
      '--sp-peril-bright': perilBright,
      '--sp-peril-glow': withAlpha(lighten(p, 0.15), 0.6),
      '--sp-peril-red': perilHot,
      '--sp-peril-red-glow': withAlpha(perilHot, 0.6),
      '--sp-peril-ghost': withAlpha(perilGhost, 0.35),
    };

    // WebGL color bed: 0..1 normalized rgb arrays.
    this._peril = {
      deep: hexToRgbFloat(darken(p, 0.6)),
      mid: hexToRgbFloat(p),
      hot: hexToRgbFloat(lighten(perilHot, 0.25)),
    };

    return vars;
  }

  /**
   * Write the derived palette onto the feature's own roots.
   *
   * Scoped deliberately: `:root` is shared with Foundry, the game system and
   * every other module, so a feature publishing its palette there is a global
   * side effect. Stream Pacer mounts several detached roots (HUD, overlay,
   * peril stage, hand bar), hence the selector list rather than one element.
   */
  apply() {
    const vars = this._buildPalette();
    const body = Object.entries(vars)
      .map(([k, v]) => `  ${k}: ${v};`)
      .join('\n');

    const scopes = [
      '#stream-pacer-hud',
      '#stream-pacer-overlay',
      '#stream-pacer-hand-bar',
      '#stream-pacer-appearance',
      '#stream-pacer-exempt-users',
      '.stream-pacer-peril-stage',
      '.stream-pacer-peril-indicator-wrap',
      '.stream-pacer-campfire-bar-wrap',
    ].join(',\n');

    const css = `${scopes} {\n${body}\n}`;

    if (!this._styleEl) {
      this._styleEl = document.createElement('style');
      this._styleEl.id = 'stream-pacer-theme-vars';
      document.head.appendChild(this._styleEl);
    }
    this._styleEl.textContent = css;
  }

  /** Normalized peril colors for the WebGL shader. */
  getPerilWebGLColors() {
    if (!this._peril) this._buildPalette();
    return this._peril;
  }

  /**
   * Normalized color bed for the Campfire WebGL fire (deep → mid → hot), kept in
   * sync with the static `--sp-campfire*` CSS palette. Returned as 0..1 rgb
   * arrays so the fragment shader can ramp cool embers up to a bright hearth.
   */
  getCampfireWebGLColors() {
    // A warm ember-brown bed rather than the near-black CSS deep, so the base
    // of the flame reads as glowing coals instead of mud.
    return {
      deep: hexToRgbFloat(darken(PALETTE.warnDeep, 0.62)),
      mid: hexToRgbFloat(PALETTE.warnDeep),
      hot: hexToRgbFloat(PALETTE.signalPale),
    };
  }

  initialize() {
    this.apply();
  }
}

export const ThemeManager = new ThemeManagerClass();
