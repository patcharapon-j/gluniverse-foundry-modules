/**
 * GLUniverse Suite — Dice So Nice registration.
 *
 * NOTHING HERE PAINTS A DIE. Both rolls wear Dice So Nice's own frosted-glass
 * material, cut by bump maps and lit by emissive maps and given no albedo art at
 * all, so what the table sees is the material rather than a picture of it.
 *
 * That constraint runs into three undocumented DSN behaviours, and all three
 * look like bugs in this file until you know them:
 *
 *   A FACE'S bumpMaps AND emissiveMaps ARE DRAWN ONLY WHEN ITS LABEL IS AN
 *   IMAGE. DSN branches on whether the label resolves to an `HTMLImageElement`;
 *   the text branch writes glyphs into all three canvases and never reads those
 *   maps. So every face is labelled with `clear.png` — one fully transparent
 *   image, shared by all twenty — which buys the relief without painting
 *   anything. Replacing it with `""` silently removes the whirlpool.
 *
 *   A TEXTURE'S bump IS DRAWN ONLY INSIDE THE BLOCK THAT DRAWS ITS SOURCE. So
 *   the frost on the numbered dice cannot be a bump with no albedo; it is a bump
 *   with a PURE WHITE albedo composited `multiply`, which is the identity.
 *
 *   THE BUMP CANVAS IS ALSO THE TRANSMISSION MASK. On any transmissive material
 *   — `glass` here, and `frosted` and `resin` besides — DSN binds the finished
 *   bump canvas a second time as `transmissionMap` and reads it through
 *   `smoothstep(0.6, 0.9, r)`. So the height field decides what is glass and
 *   what is solid, and a flat level below 0.9 makes the whole die opaque while
 *   still being a perfectly reasonable height map. THAT IS HOW THESE DICE FIRST
 *   SHIPPED: a field at 141/255 put 94% of every face under the curve, and what
 *   the table got was a black solid with no albedo on it and no error anywhere.
 *   The band, and the `--check` that measures it, live in
 *   `tools/gen-surge-textures.mjs`.
 *
 * A consequence of all three: BUMP AND EMISSIVE MAPS EXIST ONLY UNDER DSN'S
 * "realistic lighting". With it off there is no normal map and no emissive map
 * at all, which for a die carrying nothing else is twenty identical faces. That
 * is what the guard in `registerDiceSoNice` is for.
 *
 * Otherwise the split is the same as it was. The surge d20 is read by its GLYPH,
 * so it needs per-face maps, and DSN keys presets by die TYPE — three different
 * face layouts for one `du` type means three DSN *systems*, selected per roll
 * through `die.options.appearance.system`. That is the same trick
 * pf2e-damage-dice uses to get several appearances out of one shape. The
 * severity d100 is read by its NUMBER: DSN builds it from two d10s, and those
 * are ordinary numbered shapes needing one frosted surface, not twenty pictures.
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

/**
 * The transparent image every face is labelled with.
 *
 * Not a placeholder. See the header: an image label is what makes DSN read a
 * face's bump and emissive maps at all, and this is the one that paints nothing
 * while doing it.
 */
const CLEAR_LABEL = facePath("clear");

/** The two maps a face actually carries now that none of them carry colour. */
const faceMaps = (base) => ({
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
    /* THESE THREE ARE NOT DECORATION, and leaving them out breaks two things
       at once — which is exactly what happened when this object was last
       rewritten.

       `addColorset` merges the argument over its own defaults and then does
       `COLORSETS[colorset.name] = colorset`, and `name` is not one of those
       defaults. Without it the theme registers under the literal key
       "undefined", so `tagRoll` naming DSN_COLORSET matches nothing and every
       die silently falls back to whatever the player picked for themselves —
       the frosted glass simply never arrives, and no part of the pipeline says
       so.

       `description` and `category` are read by `prepareColorsetList`, which
       builds the 3D-dice settings dialog: it localizes both and then sorts on
       the result. An undefined description reaches `.localeCompare` and throws,
       which does not break OUR dice — it breaks the DICE SO NICE SETTINGS
       DIALOG, for every user in the world, whether or not they ever touch this
       feature. Registering a malformed theme is a way to take somebody else's
       UI down. */
    name: DSN_COLORSET,
    description: "GLUniverse Arcane Surge",
    category: "GLUniverse",
    // White numerals, because they read at the same weight through any thickness
    // of tinted glass and a second hue would be a second thing to decode.
    foreground: PALETTE.textBright,
    /* THE BODY OF THE DIE, and it has to be a colour with light in it.
       A transmissive material carries its tint through the whole casting rather
       than painting it on the surface, so a near-black background — this was
       `ink2` — is not a dark glass die, it is a void with an opaque figure
       floating in it. The suite's teal is this feature's own `--gl-accent`, so
       the die, the banner and the HUD chip are one object. */
    background: PALETTE.teal,
    outline: PALETTE.ink0,
    edge: PALETTE.tealHot,
    // "glass" is DSN's transmissive material, and it is the point: nothing here
    // paints over it. The frost is relief only, carried by the texture's bump.
    material: "glass",
    texture: DSN_TEXTURE,
    font: DICE_FONT,
    /* The severity d100's only emission channel.
       A colorset has no emissive MAP slot — that belongs to a preset — so the
       one thing it can ask for is this, which lights DSN's own numeral canvas.
       Without it the severity roll is the one die in the feature wearing relief
       and no light, and a number cut into unlit glass is a number you hunt for.
       The surge die overrides it with real per-face maps below. */
    emissiveLabels: true,
  };
}

/**
 * Whether DSN will draw a bump or an emissive map at all.
 *
 * Both live behind its "realistic lighting" quality setting, which Foundry's own
 * Low performance mode turns off. These dice carry NOTHING else — no albedo, by
 * design — so with it off the surge d20 is twenty identical blank faces and the
 * check it is illustrating becomes unreadable, silently. Read off the merged
 * config rather than the factory's mirror of it, because the factory is handed
 * its quality settings from the dice box and `diceSoNiceReady` does not promise
 * to fire after that.
 */
function lightingAvailable(dice3d) {
  try {
    const config = dice3d?.constructor?.CONFIG?.();
    // Unknown shape: assume the common case. The presets are right for it, and
    // guessing the other way would take the glyphs off every working table.
    return config?.bumpMapping !== false;
  } catch {
    return true;
  }
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

  /* The frost on the numbered dice: relief, and nothing else.

     `source` is a PURE WHITE image and `composite` is `multiply`, which makes
     the albedo the identity — the die keeps the glass material's own colour
     while DSN's Sobel pass turns the bump into the frost's normals. The white
     source is not decoration and not a placeholder: DSN draws a texture's bump
     only inside the block that draws its source, so removing it removes the
     frost. This dresses the severity d100 and the d10s DSN builds it from
     without enumerating a preset per shape.

     And the bump does double duty here. It lands in the same canvas DSN hands
     straight back as the transmission mask, so it is also what keeps the BODY
     of every numbered die transparent while the numerals DSN writes over it at
     #555 come out solid. It is baked wholly inside the glass band for that
     reason, and `gen-surge-textures --check` will not let one pixel of it out:
     a dark speck in a map that tiles under every face is a permanent opaque
     smear repeated across the whole table. */
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

  /* No relief and no light means no die. DSN registered its own `du` preset at
     init, labelling each face from `getResultLabel` — the words "Surge" and
     "Held" — and registering ours REPLACES it in the standard system rather
     than sitting alongside it. So on a client with realistic lighting off the
     honest thing is to register nothing and leave that one standing: a die that
     says which faces surge in words is worse-looking than one that says it in
     relief, and better than twenty blank faces. Everything else — the frost,
     the colour, the numerals, the whole severity roll — is already registered
     above and is unaffected. */
  if (!lightingAvailable(dice3d)) {
    log("Arcane Surge | Dice So Nice registered without face presets: realistic lighting is off, so the bump and emissive maps the glyph is made of would not be drawn");
    return true;
  }

  const config = levelConfig();
  const levels = rollingLevels(config);

  for (const level of levels) {
    const system = systemFor(level);
    dice3d.addSystem({ id: system, name: `GLUniverse Arcane Surge — ${level}`, group: "GLUniverse" }, "default");

    const faces = facesFor(level, config);
    dice3d.addDicePreset({
      type: `d${SURGE_DIE_DENOMINATION}`,
      // One transparent image, twenty times. It paints nothing; it is what makes
      // DSN read the two maps below. See the header before "simplifying" it.
      labels: faces.map(() => CLEAR_LABEL),
      bumpMaps: faces.map((f) => f.bump),
      // The emissive maps carry their own colour already, so the tint is white
      // and only the intensity is ours to choose. With no albedo this is the
      // only thing separating a surge face from a blank one, so it runs hot.
      emissiveMaps: faces.map((f) => f.emissive),
      emissive: 0xffffff,
      emissiveIntensity: 1.15,
      colorset: DSN_COLORSET,
      system,
    });
  }

  log(`Arcane Surge | Dice So Nice registered (bare frosted glass, ${DICE_FONT} numerals, ${levels.length} level presets for d${SURGE_DIE_DENOMINATION})`);
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
