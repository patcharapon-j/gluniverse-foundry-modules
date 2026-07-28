/**
 * GLUniverse Suite — PF2e Damage Dice: settings.
 *
 * All client-scoped: what a die looks like is a per-player preference, and the
 * appearance is resolved locally on every client that renders the roll (see
 * `apply.mjs`), so a GM's choice never has to travel.
 *
 * `dmg.glow` is `requiresReload` because emissive intensity is baked into the
 * Dice So Nice *preset* at registration time — there is no per-roll knob for
 * it, only a per-preset one.
 */

import { SUITE_ID } from "../../core/const.mjs";
import { clampNumber } from "../../core/util.mjs";

export const KEY = {
  appearance: "dmg.appearance",
  font: "dmg.font",
  glow: "dmg.glow",
  persistent: "dmg.persistent",
};

/** How much of the damage-type treatment to apply. */
export const APPEARANCE = {
  /** Colour, texture, bump map *and* emission map. Swaps the die's system. */
  full: "full",
  /** Colour, texture and bump map. Leaves the player's own dice system alone. */
  surface: "surface",
  /** Colour only — no texture, no relief, no glow. */
  tint: "tint",
};

const get = (key, fallback) => {
  try {
    return game.settings.get(SUITE_ID, key);
  } catch {
    return fallback;
  }
};

export function registerSettings() {
  game.settings.register(SUITE_ID, KEY.appearance, {
    name: "GLDMG.settings.appearance.name",
    hint: "GLDMG.settings.appearance.hint",
    scope: "client",
    config: true,
    type: String,
    default: APPEARANCE.full,
    choices: {
      [APPEARANCE.full]: "GLDMG.settings.appearance.full",
      [APPEARANCE.surface]: "GLDMG.settings.appearance.surface",
      [APPEARANCE.tint]: "GLDMG.settings.appearance.tint",
    },
  });

  game.settings.register(SUITE_ID, KEY.font, {
    name: "GLDMG.settings.font.name",
    hint: "GLDMG.settings.font.hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: true,
    requiresReload: true,
  });

  game.settings.register(SUITE_ID, KEY.glow, {
    name: "GLDMG.settings.glow.name",
    hint: "GLDMG.settings.glow.hint",
    scope: "client",
    config: true,
    type: Number,
    default: 1,
    range: { min: 0, max: 2, step: 0.1 },
    requiresReload: true,
  });

  game.settings.register(SUITE_ID, KEY.persistent, {
    name: "GLDMG.settings.persistent.name",
    hint: "GLDMG.settings.persistent.hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: true,
  });
}

export const appearanceMode = () => {
  const mode = get(KEY.appearance, APPEARANCE.full);
  return Object.values(APPEARANCE).includes(mode) ? mode : APPEARANCE.full;
};

export const useDiceFont = () => get(KEY.font, true) !== false;

export const glowScale = () => clampNumber(get(KEY.glow, 1), 0, 2, 1);

export const markPersistent = () => get(KEY.persistent, true) !== false;
