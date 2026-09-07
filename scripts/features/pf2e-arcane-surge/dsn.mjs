/**
 * GLUniverse Suite — Dice So Nice registration.
 *
 * Two different kinds of die, needing two different treatments, and conflating
 * them is what made the severity roll look wrong:
 *
 *   THE SURGE d20 is read by its GLYPH. Every face is a whole image — blank, or
 *   the whirlpool — so it gets per-face `labels`, `bumpMaps` and `emissiveMaps`.
 *   DSN keys presets by die TYPE, and we need three different face layouts for
 *   the same `du` type (one per stability level), so each level gets its own DSN
 *   *system* carrying its own preset, selected per roll through
 *   `die.options.appearance.system`. That is the same trick pf2e-damage-dice
 *   uses to get several appearances out of one shape.
 *
 *   THE SEVERITY d100 is read by its NUMBER. DSN builds it from two d10s, and
 *   those are ordinary numbered shapes: they need a frosted SURFACE under the
 *   numerals, not twenty pictures. That is a `texture` plus a colorset, and it
 *   covers every shape DSN might use without enumerating them.
 *
 * Both wear the same frosted glass and the same numerals, so the two rolls read
 * as one procedure rather than as two features.
 *
 * The face layout is derived from `glyphFaces()`, never written out beside the
 * threshold — if the two could drift, the die would show the wrong odds while
 * rolling the right ones.
 *
 * DSN is a SOFT dependency. Everything here is skipped when it is absent, and
 * the feature carries on: the banner and the beats are the mechanic, the
 * tumbling die is ceremony.
 */

import { featurePath, log, warn } from "../../core/const.mjs";
import { PALETTE } from "../../core/theme.mjs";
import { DSN_COLORSET, DSN_NAMESPACE, FACE_ASSETS, SURGE_DIE_DENOMINATION } from "./constants.mjs";
import { hasSurgeDie } from "./die.mjs";
import { glyphFaces, rollingLevels } from "./levels.mjs";
import { levelConfig } from "./settings.mjs";

let registered = false;

/**
 * The numerals.
 *
 * The same display face the time-tracker HUD uses, so a surge die and the clock
 * above it are visibly the same object. Dice So Nice reads a font by FAMILY NAME
 * into a `<canvas>`, so it never sees a CSS custom property — the literal name is
 * unavoidable here, and `--gl-display` names this same family.
 */
const DICE_FONT = "Oxanium";

const DSN_TEXTURE = "gluniverse-arcane-surge-frost";

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
 * bear it does not matter mechanically — the check compares the NUMBER against
 * the threshold — but keeping them the low faces means a player reading the die
 * and a player reading the number see the same thing.
 */
export function facesFor(level, config = levelConfig()) {
  const threshold = glyphFaces(level, config);
  return Array.from({ length: 20 }, (_, i) => faceMaps(i < threshold ? FACE_ASSETS.surge : FACE_ASSETS.blank));
}

/**
 * Tell Foundry the face already exists.
 *
 * `styles/gl-fonts.css` declares the @font-face, so the browser has it; Foundry
 * only needs to agree, and an empty `fonts` array is how core marks a face as
 * already provided. Skipping this sends Dice So Nice into `FontConfig.loadFont()`,
 * which reaches for Google's CDN — a network round-trip the suite does not make,
 * on a stack that is routinely run offline.
 */
export function registerFontDefinition() {
  CONFIG.fontDefinitions ??= {};
  CONFIG.fontDefinitions[DICE_FONT] ??= { editor: false, fonts: [] };
}

/** Rasterise the face before DSN bakes a die texture from it. */
async function ensureFontLoaded() {
  if (!document.fonts) return;
  try {
    await document.fonts.load(`700 32pt "${DICE_FONT}"`);
  } catch (e) {
    warn("Arcane Surge | could not preload the dice font:", e);
  }
}

/** Frosted glass, shared by the surge die and the severity roll. */
function colorset() {
  return {
    name: DSN_COLORSET,
    description: "GLUniverse Arcane Surge",
    category: "GLUniverse",
    // Numerals: bright enough to read through frost, in the suite's cyan.
    foreground: PALETTE.textBright,
    background: PALETTE.ink2,
    outline: PALETTE.ink0,
    edge: PALETTE.teal,
    // "glass" is DSN's transmissive material; the frost comes from the texture's
    // bump, which is where a frosted surface actually lives.
    material: "glass",
    texture: DSN_TEXTURE,
    font: DICE_FONT,
  };
}

export async function registerDiceSoNice(dice3d) {
  if (registered || !dice3d) return false;

  /* If another module already held the denomination, `du` is THEIR die. A preset
     for it would repaint their dice with our faces — far worse than having no 3D
     die of our own, and it would look like a bug in their module rather than in
     this one. The check still runs; it just rolls an ordinary d20. */
  if (!hasSurgeDie()) {
    warn("Arcane Surge | denomination unavailable; skipping Dice So Nice registration so another module's die is left alone");
    return false;
  }

  registered = true;
  await ensureFontLoaded();

  /* The frosted surface. `multiply` composites it over the colorset background,
     and the bump is what DSN's Sobel pass turns into the frost's normals — the
     albedo is deliberately bright and nearly flat, because frost is a surface
     property, not a colour. This is what dresses the severity d100 and the d10s
     DSN builds it from, without having to enumerate a preset per shape. */
  await dice3d
    .addTexture(DSN_TEXTURE, {
      name: "Arcane Frost",
      composite: "multiply",
      source: facePath("surface"),
      bump: facePath("surface", "-bump"),
      material: "glass",
    })
    .catch((e) => warn("Arcane Surge | frost texture failed to load:", e));

  await dice3d.addColorset(colorset(), "default");

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

  log(`Arcane Surge | Dice So Nice registered (frosted glass, ${DICE_FONT} numerals, ${levels.length} level presets for d${SURGE_DIE_DENOMINATION})`);
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
    die.options.appearance = {
      ...(die.options.appearance ?? {}),
      colorset: DSN_COLORSET,
      system,
      texture: DSN_TEXTURE,
      material: "glass",
      font: DICE_FONT,
    };
  }
  return roll;
}

/**
 * The severity d100 wears the same frost and the same numerals, so the two rolls
 * read as one procedure — but no system, because it is an ordinary numbered
 * shape rather than a face-art die.
 */
export function tagSeverityRoll(roll) {
  for (const die of roll?.dice ?? []) {
    die.options ??= {};
    die.options.colorset = DSN_COLORSET;
    die.options.appearance = {
      ...(die.options.appearance ?? {}),
      colorset: DSN_COLORSET,
      texture: DSN_TEXTURE,
      material: "glass",
      font: DICE_FONT,
    };
  }
  return roll;
}
