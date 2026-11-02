/**
 * The chat overlay's settings, made safe to read.
 *
 * `stream.chatSettings` is an Object setting a director edits a field at a time, so any one field can
 * arrive blank, as a string, or from an older world without it. Each field falls back to its default
 * rather than to a value that quietly breaks the overlay: a blank lifetime used to read as 0, which
 * retired every card the moment it landed, and a blank "max visible" or an unknown corner did the same
 * kind of thing to the stack.
 *
 * Pure: no Foundry, no DOM. `settings.js` reads and writes through it, and the tests drive it directly.
 */

import { CARD_SCALE_RANGE, CHAT_POSITIONS, DEFAULT_CHAT_SETTINGS } from "./constants.js";

/** The ranges the Control Room offers. A stored value outside one is clamped onto it. */
export const CHAT_LIMITS = Object.freeze({
  lifetimeMs: { min: 1000, max: 600000 },
  maxVisible: { min: 1, max: 12 },
  offset: { min: -2000, max: 2000 },
  critLifetimeMultiplier: { min: 1, max: 5 }
});

const clamp = (value, { min, max }) => Math.min(max, Math.max(min, value));

function positive(value, fallback) {
  // A blank field arrives as "" or null, and Number("") is 0: both mean "unset", never zero.
  if (value === "" || value === null || value === undefined) return fallback;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function finite(value, fallback) {
  if (value === "" || value === null || value === undefined) return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function sanitizeChatSettings(value) {
  const source = value && typeof value === "object" ? value : {};
  const settings = { ...DEFAULT_CHAT_SETTINGS, ...source };
  const d = DEFAULT_CHAT_SETTINGS;
  settings.position = CHAT_POSITIONS.includes(settings.position) ? settings.position : d.position;
  settings.offsetX = clamp(finite(settings.offsetX, d.offsetX), CHAT_LIMITS.offset);
  settings.offsetY = clamp(finite(settings.offsetY, d.offsetY), CHAT_LIMITS.offset);
  settings.lifetimeMs = Math.round(clamp(positive(settings.lifetimeMs, d.lifetimeMs), CHAT_LIMITS.lifetimeMs));
  settings.maxVisible = Math.round(clamp(positive(settings.maxVisible, d.maxVisible), CHAT_LIMITS.maxVisible));
  settings.critLifetimeMultiplier = clamp(positive(settings.critLifetimeMultiplier, d.critLifetimeMultiplier), CHAT_LIMITS.critLifetimeMultiplier);
  // A blank, missing or zero scale means "unset", not "invisible", so it falls back to the default.
  settings.cardScale = clamp(positive(settings.cardScale, d.cardScale), CARD_SCALE_RANGE);
  return settings;
}
