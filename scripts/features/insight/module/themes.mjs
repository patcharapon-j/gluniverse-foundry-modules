// module/themes.mjs — Tone presets for Insight notifications.
//
// These are NOT alternate themes. Insight wears Ink and Signal (DESIGN.md): a
// black plate, paper type, and one tone that every lit part of the arrival
// reads through `--insight-tone` (the edge, the rim, the cut, the tag, the
// control). A preset sets that tone, the per-hue correction of the edge, and
// how the body is set, and nothing else; the plate, the type and the shape
// are shared and live in styles/insight.css.
//
// Hue is a signal in Ink and Signal, so a tone is one of core's `--gl-is-*`
// signals, never a colour of its own. Violet (the old Dreadlight) is gone with
// Etched Glass: Dreadlight is paper now, white light out of a black room.
//
// Each preset also names a sound profile (see sound.mjs), which is why this is
// a user-facing choice rather than a constant.

import { SUITE_ID } from "../../../core/const.mjs";

/** The only properties a preset may set. Everything else would fork the skin. */
export const PRESET_VARS = Object.freeze([
  "--insight-tone",
  "--insight-burn",
  "--insight-reach-y",
  "--insight-reach-x",
  "--insight-body-style",
]);

/** The tones a shipped preset may take: core's paper and signal hues. */
export const PRESET_TONES = Object.freeze([
  "var(--gl-is-paper)",
  "var(--gl-is-amber)",
  "var(--gl-is-red)",
  "var(--gl-is-green)",
  "var(--gl-is-ember)",
  "var(--gl-is-info)",
  "var(--gl-is-steel)",
]);

const PRESETS = {
  dreadlight: {
    label: "Dreadlight",
    vars: {
      // Paper: the light is white and the room is black. The quiet default,
      // which reads the same in a horror one-shot and a sci-fi deck.
      "--insight-tone": "var(--gl-is-paper)",
      "--insight-body-style": "normal",
      // White carries further than any hue over a lit map, so its edge
      // burns lower than the shared default.
      "--insight-burn": "0.5",
      "--insight-reach-y": "18%",
      "--insight-reach-x": "14%",
    },
  },

  fantasy: {
    label: "Fantasy",
    vars: {
      // Amber: the system's call tone, warm arcane ceremony.
      "--insight-tone": "var(--gl-is-amber)",
      "--insight-body-style": "italic",
      // Amber sits far higher on the luminance ramp than a cool hue, and over
      // a cool map yellow carries much further than a matched luminance would
      // predict. Left on the shared burn, this preset washes the whole frame
      // rather than lighting its edges. The edge is the one place the tone
      // covers a whole viewport, so it is the one place corrected per hue.
      "--insight-burn": "0.42",
      "--insight-reach-y": "19%",
      "--insight-reach-x": "15%",
    },
  },
};

/**
 * The preset table itself. Exported so tools/insight-preview.mjs can drive
 * the real presets rather than a mirror — a hand-copied table there drifts
 * the moment one is retuned, and the preview then flatters a look that no
 * player will ever see.
 * @returns {Record<string, {label: string, vars: Record<string,string>}>}
 */
export function getPresets() {
  return PRESETS;
}

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
 * Register a custom tone preset. Called by other modules/systems.
 * A preset may set only PRESET_VARS. A preset written against the Etched Glass
 * accent channel (`--gl-accent`) still lands: that value is read as the tone.
 * @param {string} id - Unique preset identifier
 * @param {object} config - Config with `label` and `vars` properties
 */
export function registerTheme(id, config) {
  if (!config?.label || !config?.vars || typeof config.vars !== "object") {
    console.error(`Insight | Invalid preset config for "${id}": needs label and vars`);
    return;
  }
  // Held to the same rule as the shipped presets (tools/insight-check.mjs).
  const vars = {};
  for (const [prop, value] of Object.entries(config.vars)) {
    if (PRESET_VARS.includes(prop)) vars[prop] = String(value);
    else if (prop === "--gl-accent") vars["--insight-tone"] ??= String(value);
    else console.warn(`Insight | Preset "${id}" may not set ${prop}; ignored.`);
  }
  PRESETS[id] = { label: config.label, vars };
}
