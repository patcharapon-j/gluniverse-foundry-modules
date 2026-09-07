/**
 * GLUniverse Suite — Dice So Nice registration for the surge die.
 *
 * DSN keys a preset by die TYPE, and we need three different face layouts for
 * the same `du` type — one per stability level. The suite already solved this
 * in pf2e-damage-dice: register one DSN *system* per variant, give each system
 * its own preset for the type, and select between them per roll through
 * `die.options.appearance.system`.
 *
 * The face layout is derived from `glyphFaces()`, never written out beside the
 * threshold. If the two could drift, the die would show the wrong odds while
 * rolling the right ones — the failure `tools/arcane-surge-check.mjs` exists to
 * make impossible.
 *
 * DSN is a SOFT dependency. Everything here is skipped when it is absent, and
 * the feature carries on: the banner and the burst are the mechanic, the
 * tumbling die is ceremony.
 */

import { featurePath, log } from "../../core/const.mjs";
import { PALETTE } from "../../core/theme.mjs";
import { DSN_COLORSET, DSN_NAMESPACE, FACE_ASSETS, SURGE_DIE_DENOMINATION } from "./constants.mjs";
import { glyphFaces, rollingLevels } from "./levels.mjs";
import { levelConfig } from "./settings.mjs";

let registered = false;

const facePath = (base, suffix = "") => featurePath("pf2e-arcane-surge", `assets/dice/${base}${suffix}.png`);

/** The three maps DSN wants for one face. */
const faceMaps = (base) => ({
  image: facePath(base),
  bump: facePath(base, "-bump"),
  emissive: facePath(base, "-emissive"),
});

/** One DSN system per stability level. */
export const systemFor = (level) => `${DSN_NAMESPACE}-${level}`;

/**
 * Face art for a level, in DSN's face order (index 0 is face 1).
 *
 * Faces 1..threshold carry the glyph; the rest are blank. Which specific faces
 * bear the glyph does not matter mechanically — the check compares the NUMBER
 * against the threshold — but keeping them the low faces means a player reading
 * the die and a player reading the number see the same thing.
 */
export function facesFor(level, config = levelConfig()) {
  const threshold = glyphFaces(level, config);
  return Array.from({ length: 20 }, (_, i) => faceMaps(i < threshold ? FACE_ASSETS.surge : FACE_ASSETS.blank));
}

export function registerDiceSoNice(dice3d) {
  if (registered || !dice3d) return false;
  registered = true;

  dice3d.addColorset({
    name: DSN_COLORSET,
    description: "GLUniverse Arcane Surge",
    category: "GLUniverse",
    // The die is read by its glyph, not its numerals, so the foreground is the
    // faint etch on a blank face rather than a legible number colour.
    foreground: PALETTE.tealHot,
    background: PALETTE.ink2,
    outline: PALETTE.ink0,
    edge: PALETTE.teal,
    material: "glass",
    font: "Signika",
  });

  const config = levelConfig();
  const levels = rollingLevels(config);

  for (const level of levels) {
    const system = systemFor(level);
    dice3d.addSystem({ id: system, name: `GLUniverse Arcane Surge — ${level}`, group: "GLUniverse" }, "default");

    const faces = facesFor(level, config);
    dice3d.addDicePreset({
      type: `d${SURGE_DIE_DENOMINATION}`,
      labels: faces.map((f) => f.image),
      bumpMaps: faces.map((f) => f.bump),
      // The emissive maps carry their own colour already, so the tint is white
      // and only the intensity is ours to choose.
      emissiveMaps: faces.map((f) => f.emissive),
      emissive: 0xffffff,
      emissiveIntensity: 0.9,
      colorset: DSN_COLORSET,
      system,
    });
  }

  log(`Arcane Surge | Dice So Nice registered (${levels.length} level presets for d${SURGE_DIE_DENOMINATION})`);
  return true;
}

/**
 * Point one evaluated roll's dice at the preset for `level`.
 *
 * Mirrors pf2e-damage-dice's `tagDie`: both `colorset` and `appearance` are
 * written, because DSN reads them at different points and setting only one
 * leaves the die half-themed.
 */
export function tagRoll(roll, level) {
  const system = systemFor(level);
  for (const die of roll?.dice ?? []) {
    die.options ??= {};
    die.options.colorset = DSN_COLORSET;
    die.options.appearance = { ...(die.options.appearance ?? {}), colorset: DSN_COLORSET, system };
  }
  return roll;
}

/** The severity d100 wears the same colorset so the two rolls read as one
 *  procedure — but no system, since it is an ordinary shape with numerals. */
export function tagSeverityRoll(roll) {
  for (const die of roll?.dice ?? []) {
    die.options ??= {};
    die.options.colorset = DSN_COLORSET;
    die.options.appearance = { ...(die.options.appearance ?? {}), colorset: DSN_COLORSET };
  }
  return roll;
}
