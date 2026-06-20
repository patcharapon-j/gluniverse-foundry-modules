// module/themes.mjs — Theme presets for the "Etched Glass" accent channel
//
// Under the GL Universe design language, surfaces are near-monochrome ink and
// meaning arrives through ONE accent channel (`--gl-accent`). A theme therefore
// only swaps the accent (and a flavor toggle); the glass material, etching and
// typography are shared and live in styles/insight.css.

import { SUITE_ID } from "../../../core/const.mjs";

const THEMES = {
  dreadlight: {
    label: "Dreadlight",
    vars: {
      // Mystery violet — hidden insight, secret reveals (§2.4)
      "--gl-accent": "#b497ff",
      "--insight-body-style": "normal",
    },
  },

  fantasy: {
    label: "Fantasy",
    vars: {
      // Signal amber — warm arcane ceremony (§2.4 the Endfield yellow)
      "--gl-accent": "#ffd24a",
      "--insight-body-style": "italic",
    },
  },
};

/**
 * Apply a theme's CSS custom properties to a DOM element.
 * @param {HTMLElement} element - The notification container element
 * @param {string} [themeId] - Theme ID. Defaults to the module setting.
 */
export function applyTheme(element, themeId) {
  const id = themeId ?? game.settings.get(SUITE_ID, "insight.theme");
  const theme = THEMES[id] ?? THEMES.dreadlight;
  for (const [prop, value] of Object.entries(theme.vars)) {
    element.style.setProperty(prop, value);
  }
}

/**
 * Get the current theme ID from settings.
 * @returns {string}
 */
export function getCurrentTheme() {
  return game.settings.get(SUITE_ID, "insight.theme");
}

/**
 * Get all registered theme IDs.
 * @returns {string[]}
 */
export function getThemeIds() {
  return Object.keys(THEMES);
}

/**
 * Register a custom theme. Called by other modules/systems to add themes.
 * A theme only needs to set `--gl-accent` (plus any flavor overrides).
 * @param {string} id - Unique theme identifier
 * @param {object} config - Theme config with `label` and `vars` properties
 */
export function registerTheme(id, config) {
  if (!config.label || !config.vars) {
    console.error(`Insight | Invalid theme config for "${id}": needs label and vars`);
    return;
  }
  THEMES[id] = config;
  console.log(`Insight | Registered custom theme: ${config.label}`);
}
