/**
 * Central appearance controller — single fixed "Arcane Glass" theme.
 *
 * There is no longer a family/preset selector: the look is fixed. The full
 * palette lives in CSS (:root); this class re-stamps the accent and Dire Peril
 * custom properties from one source of truth so the WebGL danger field and the
 * CSS stay in sync, and exposes the derived Dire Peril color bed for the
 * renderer.
 */

/** The one and only theme — cool "Arcane Glass" chrome with a warm amber accent. */
export const DEFAULT_THEME = { accent: '#e4b055', peril: '#d6184a' };

function clamp8(n) {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(String(hex || '').trim());
  if (!m) return { r: 228, g: 176, b: 85 };
  return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
}

function rgbToHex({ r, g, b }) {
  const h = (v) => clamp8(v).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

/** Mix two rgb objects; t=0 → a, t=1 → b. */
function mix(a, b, t) {
  return {
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t
  };
}

function lighten(rgb, t) {
  return mix(rgb, { r: 255, g: 255, b: 255 }, t);
}

function darken(rgb, t) {
  return mix(rgb, { r: 0, g: 0, b: 0 }, t);
}

function rgba(rgb, a) {
  return `rgba(${clamp8(rgb.r)}, ${clamp8(rgb.g)}, ${clamp8(rgb.b)}, ${a})`;
}

class ThemeManagerClass {
  constructor() {
    this._styleEl = null;
    this._peril = null; // cached { deep, mid, hot } as 0..1 rgb arrays
  }

  /** Build the accent + Dire Peril custom-property map from the fixed theme. */
  _buildPalette() {
    const a = hexToRgb(DEFAULT_THEME.accent);
    const p = hexToRgb(DEFAULT_THEME.peril);

    // Derived accent tone — a softer, brighter sibling for highlights.
    const accentSoft = lighten(a, 0.18);

    // Derived peril tones — a deep near-black bed, a bright highlight, and a
    // hot "alert red" pushed toward saturated red-orange for the danger read.
    const perilDeep = darken(p, 0.82);
    const perilBright = lighten(p, 0.62);
    const perilHot = mix(p, { r: 255, g: 30, b: 48 }, 0.5);
    const perilGhost = lighten(mix(p, { r: 120, g: 220, b: 255 }, 0.6), 0.1);

    const vars = {
      '--sp-amber': rgbToHex(a),
      '--sp-amber-soft': rgbToHex(accentSoft),
      '--sp-amber-dim': rgba(a, 0.22),
      '--sp-amber-glow': rgba(a, 0.4),

      '--sp-peril': rgbToHex(p),
      '--sp-peril-deep': rgbToHex(perilDeep),
      '--sp-peril-bright': rgbToHex(perilBright),
      '--sp-peril-glow': rgba(lighten(p, 0.15), 0.6),
      '--sp-peril-red': rgbToHex(perilHot),
      '--sp-peril-red-glow': rgba(perilHot, 0.6),
      '--sp-peril-ghost': rgba(perilGhost, 0.35)
    };

    // WebGL color bed: 0..1 normalized rgb arrays.
    const norm = ({ r, g, b }) => [r / 255, g / 255, b / 255];
    this._peril = {
      deep: norm(darken(p, 0.6)),
      mid: norm(p),
      hot: norm(lighten(perilHot, 0.25))
    };

    return vars;
  }

  /** Write the fixed palette onto :root via a managed <style> element. */
  apply() {
    const vars = this._buildPalette();
    const body = Object.entries(vars)
      .map(([k, v]) => `  ${k}: ${v};`)
      .join('\n');
    const css = `:root {\n${body}\n}`;

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
    const norm = ({ r, g, b }) => [r / 255, g / 255, b / 255];
    return {
      // A warm ember-brown bed rather than the near-black CSS deep, so the base
      // of the flame reads as glowing coals instead of mud.
      deep: norm(hexToRgb('#6e2a08')),
      mid: norm(hexToRgb('#ff7a26')),
      hot: norm(hexToRgb('#ffe6ad'))
    };
  }

  initialize() {
    this.apply();
  }
}

export const ThemeManager = new ThemeManagerClass();
