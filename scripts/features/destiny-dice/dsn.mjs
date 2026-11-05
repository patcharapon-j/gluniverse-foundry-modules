/**
 * Dice So Nice: the fate die as black glass with its glyphs cut and lit in it.
 *
 * Every face is baked at runtime from `glyphs.mjs` by `raster.mjs`, so the die
 * prints exactly what the face table says: a GM who makes face 3 a +1
 * complication gets a +1 on the die, and a preset's tones are the same tones
 * the chat strip uses. The old version shipped painted art per preset and
 * printed +4/+2 whatever the table said.
 *
 * Four things here are Dice So Nice's behaviour, read off its sourcemap, and all
 * four look like mistakes until you know them:
 *
 *   A LABEL IS AN IMAGE ONLY IF ITS STRING ENDS IN AN IMAGE EXTENSION.
 *   `DicePreset#loadTextureType` tests `/\.(png|jpg|jpeg|gif|webp)$/i` and
 *   treats anything else as text to print. A data URL ends in base64, so each
 *   one carries a `#face.png` fragment: the browser ignores a fragment on a data
 *   URL, and DSN's test passes. Without it every face prints its own URL.
 *
 *   `emissiveIntensity: 0` IS IGNORED. DSN copies it with `if (dice.emissiveIntensity)`,
 *   so zero leaves the default of 1 and the "0 disables the glow" setting never
 *   did. Off now means no emissive maps and a black emissive, which also keeps
 *   the throw off DSN's bloom path entirely (any non-black emissive in the scene
 *   switches the whole dice canvas onto it, a second scene render plus bloom passes
 *   for the length of the throw).
 *
 *   A PRESET FOR A CUSTOM TERM NEEDS A SHAPE. `addDicePreset` looks `dz` up in
 *   the standard system and, finding nothing, looks up its `shape` argument
 *   instead; with no shape it reads `.shape` off undefined. `d6` is passed.
 *
 *   PRESETS LOAD LAZILY ON THE FIRST THROW unless `preloadPresets` is called, one
 *   await per map, mid-animation. It is called.
 */

import { log, warn } from "../../core/const.mjs";
import { PALETTE } from "../../core/theme.mjs";
import { DSN_COLORSET, DSN_NAMESPACE, FATE_DIE_DENOMINATION } from "./constants.mjs";
import { glyphSpec } from "./faces.mjs";
import { bakeClear, bakeFace, SIZE } from "./raster.mjs";
import { ownsFateDie } from "./fate-die.mjs";
import { toneOf } from "./view.mjs";
import { activePreset, emissiveIntensity, faces } from "./settings.mjs";

let registered = false;

/* What DSN is told the label image is called. Any image extension will do. */
export const IMAGE_SUFFIX = "#face.png";
export const IMAGE_TEST = /\.(png|jpg|jpeg|gif|webp)$/i;

/**
 * The die's look, one statement for every preset: black glass, steel bevels.
 * The bevels are the silhouette of a dark die, so they carry the value contrast.
 */
export function colorset() {
  return {
    name: DSN_COLORSET,
    description: "GLUniverse Destiny Dice",
    category: "GLUniverse",
    foreground: PALETTE.textBright,
    background: PALETTE.ink1,
    outline: PALETTE.ink0,
    edge: PALETTE.textDim,
    material: "glass",
    texture: "none",
  };
}

/**
 * The preset for the active face table, as plain data (the check tool and the
 * preview call this with their own `encode`).
 *
 * @param {object} args
 * @param {Array} args.faces      settings.mjs `faces()`
 * @param {string} args.preset
 * @param {number} args.intensity 0..2
 * @param {(pixels: Uint8ClampedArray, size: number) => string} args.encode  RGBA → image URL
 */
export function buildPreset({ faces: table, preset, intensity, encode }) {
  const cache = new Map();
  const glow = intensity > 0;
  const urls = (f) => {
    const spec = glyphSpec(f);
    const custom = !!f.image;
    const key = `${spec.key}|${custom ? f.image : ""}`;
    if (!cache.has(key)) {
      const maps = bakeFace(spec, { tone: PALETTE[toneOf(preset, f.kind)], custom });
      cache.set(key, {
        label: custom ? f.image : encode(spec.mark === "none" ? bakeClear(SIZE) : maps.label, SIZE) + IMAGE_SUFFIX,
        bump: encode(maps.bump, SIZE) + IMAGE_SUFFIX,
        emissive: encode(maps.emissive, SIZE) + IMAGE_SUFFIX,
      });
    }
    return cache.get(key);
  };
  const set = table.map(urls);
  return {
    type: `d${FATE_DIE_DENOMINATION}`,
    labels: set.map((s) => s.label),
    bumpMaps: set.map((s) => s.bump),
    ...(glow ? { emissiveMaps: set.map((s) => s.emissive), emissive: 0xffffff, emissiveIntensity: intensity } : { emissive: 0x000000 }),
    colorset: DSN_COLORSET,
    system: DSN_NAMESPACE,
    unique: cache.size,
  };
}

/** RGBA bytes → PNG data URL, through a canvas. Browser only. */
function canvasEncode(pixels, size) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  canvas.getContext("2d").putImageData(new ImageData(pixels, size, size), 0, 0);
  return canvas.toDataURL("image/png");
}

export async function registerDiceSoNice(dice3d) {
  if (registered || !dice3d) return false;
  if (!ownsFateDie()) {
    warn(`Destiny Dice | d${FATE_DIE_DENOMINATION} belongs to another package; leaving its Dice So Nice look alone`);
    return false;
  }
  registered = true;

  try {
    await dice3d.addColorset(colorset(), "default");
    dice3d.addSystem({ id: DSN_NAMESPACE, name: "GLUniverse Destiny Dice", group: "GLUniverse" }, "default");
    const { unique, ...preset } = buildPreset({ faces: faces(), preset: activePreset(), intensity: emissiveIntensity(), encode: canvasEncode });
    dice3d.addDicePreset(preset, "d6");
    if (typeof dice3d.preloadPresets === "function") {
      await dice3d.preloadPresets(DSN_NAMESPACE).catch((e) => warn("Destiny Dice | could not warm the Dice So Nice preset:", e));
    }
    log(`Destiny Dice | Dice So Nice preset registered (d${FATE_DIE_DENOMINATION}, ${unique} baked faces)`);
    return true;
  } catch (e) {
    warn("Destiny Dice | Dice So Nice registration failed; the fate die rolls with the default look:", e);
    return false;
  }
}
