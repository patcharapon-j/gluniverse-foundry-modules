/**
 * GLUniverse Suite — the Arcane Surge d20.
 *
 * A d20 whose faces are blank except for the surge glyph, and whose glyph COUNT
 * is the stability threshold. Fraying carries one glyph, Unbound four,
 * Unraveling eight — so the die a player watches tumble is the odds they are
 * facing, and landing glyph-up IS the result with no arithmetic in between.
 *
 * `CONFIG.Dice.terms` is a global single-character namespace shared with every
 * other module installed in the world. Foundry claims "d", "c", "f" and "s";
 * the suite's own destiny-dice holds "z". A collision is SILENT — the later
 * registration overwrites the earlier one and both modules keep running,
 * one of them now rolling somebody else's die. So this takes "u" only if "u"
 * is free, and otherwise falls back to a plain d20 read the same way.
 */

import { log, warn } from "../../core/const.mjs";
import { SURGE_DIE_DENOMINATION, SURGE_DIE_FALLBACK_NOTATION, SURGE_DIE_NOTATION } from "./constants.mjs";
import { glyphFaces } from "./levels.mjs";
import { levelConfig } from "./settings.mjs";

/** Set false when the denomination was already taken; the roll notation and the
 *  DSN preset both follow this rather than assuming the custom die exists. */
let registered = false;

export class ArcaneSurgeDie extends foundry.dice.terms.Die {
  constructor(termData = {}) {
    super({ ...termData, faces: 20 });
  }

  static DENOMINATION = SURGE_DIE_DENOMINATION;

  /** Chat and tooltips read the face, not the number: a blank face is nothing
   *  happening, and the number it happens to bear is noise. */
  getResultLabel(result) {
    const threshold = glyphFaces(this.options?.glasLevel ?? "unraveling", levelConfig());
    const surged = Number.isInteger(result?.result) && threshold > 0 && result.result <= threshold;
    return game.i18n.localize(surged ? "GLAS.die.surge" : "GLAS.die.blank");
  }
}

/**
 * Take the denomination if it is free.
 *
 * Called at init. Never throws: a world where "u" is occupied still gets the
 * whole feature, just with an ordinary-looking d20 behind the banner.
 */
export function registerSurgeDie() {
  const held = CONFIG.Dice.terms[SURGE_DIE_DENOMINATION];
  if (held && held !== ArcaneSurgeDie) {
    warn(
      `Arcane Surge | dice denomination "${SURGE_DIE_DENOMINATION}" is already registered by another module; ` +
      `falling back to ${SURGE_DIE_FALLBACK_NOTATION}. The surge check is unaffected.`
    );
    registered = false;
    return false;
  }
  CONFIG.Dice.terms[SURGE_DIE_DENOMINATION] = ArcaneSurgeDie;
  registered = true;
  log(`Arcane Surge | registered ${SURGE_DIE_NOTATION}`);
  return true;
}

/** True when the bespoke die is ours to roll. */
export const hasSurgeDie = () => registered;

/** The notation to roll: the custom die, or a plain d20 if the letter was taken. */
export const surgeNotation = () => (registered ? SURGE_DIE_NOTATION : SURGE_DIE_FALLBACK_NOTATION);

/** Pull the active d20 face out of an evaluated roll. */
export function readDieResult(roll) {
  const die = roll?.dice?.find((d) => d.faces === 20 && d.constructor?.DENOMINATION === SURGE_DIE_DENOMINATION)
    ?? roll?.dice?.find((d) => d.faces === 20);
  const active = die?.results?.find((r) => r.active !== false && !r.discarded);
  return Number.isInteger(active?.result) ? active.result : null;
}
