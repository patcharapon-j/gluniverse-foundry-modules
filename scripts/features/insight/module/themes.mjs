// module/themes.mjs — Accent presets for Insight notifications.
//
// These are NOT alternate themes. Etched Glass is the suite's single theme; the
// design system's sanctioned way to give a feature or a mood its own identity
// is to remap the ONE accent channel (`--gl-accent`) on a scoped element and
// let every derived surface, glow and rim follow. That is all a preset does
// here — the glass material, etching and typography are shared and live in
// styles/gl-tokens.css + styles/insight.css.
//
// Each preset also names a sound profile (see sound.mjs), which is why this is
// a user-facing choice rather than a constant.
//
// Colours reference the shared semantic tokens rather than literal hexes, so a
// retheme that moves --gl-violet moves this with it.

import { SUITE_ID } from "../../../core/const.mjs";

const PRESETS = {
  dreadlight: {
    label: "Dreadlight",
    vars: {
      // Mystery violet — hidden insight, secret reveals.
      "--gl-accent": "var(--gl-violet)",
      "--insight-body-style": "normal",
    },
  },

  fantasy: {
    label: "Fantasy",
    vars: {
      // Signal amber — warm arcane ceremony.
      "--gl-accent": "var(--gl-signal)",
      "--insight-body-style": "italic",
    },
  },
};

/** Resolve a preset id to its config, falling back to the default. */
function resolve(id) {
  return PRESETS[id] ?? PRESETS.dreadlight;
}

/**
 * Apply a preset's CSS custom properties to a DOM element.
 * @param {HTMLElement} element - The notification container element
 * @param {string} [presetId] - Preset ID. Defaults to the module setting.
 */
export function applyTheme(element, presetId) {
  const id = presetId ?? game.settings.get(SUITE_ID, "insight.theme");
  for (const [prop, value] of Object.entries(resolve(id).vars)) {
    element.style.setProperty(prop, value);
  }
}

/**
 * Get the current preset ID from settings.
 * @returns {string}
 */
export function getCurrentTheme() {
  return game.settings.get(SUITE_ID, "insight.theme");
}

/**
 * Get all registered preset IDs.
 * @returns {string[]}
 */
export function getThemeIds() {
  return Object.keys(PRESETS);
}

/**
 * Register a custom accent preset. Called by other modules/systems.
 * A preset should only set `--gl-accent` (plus any flavor overrides) — it must
 * not repaint surfaces or swap typefaces, which would fork the theme.
 * @param {string} id - Unique preset identifier
 * @param {object} config - Config with `label` and `vars` properties
 */
export function registerTheme(id, config) {
  if (!config.label || !config.vars) {
    console.error(`Insight | Invalid preset config for "${id}": needs label and vars`);
    return;
  }
  PRESETS[id] = config;
  console.log(`Insight | Registered custom accent preset: ${config.label}`);
}
