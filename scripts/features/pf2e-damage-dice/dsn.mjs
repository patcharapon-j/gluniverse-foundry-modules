/**
 * GLUniverse Suite — PF2e Damage Dice: Dice So Nice registration.
 *
 * Three layers go in, in this order, because each depends on the last:
 *
 *   1. A **texture** per damage type — `source` (albedo, composited `multiply`
 *      over the die colour) plus `bump` (height, which DSN runs through a Sobel
 *      pass to build the normal map). Baked by `tools/gen-damage-textures.mjs`.
 *
 *   2. A **colorset** per damage type, plus a hidden "persistent" variant. This
 *      carries colour, the texture from (1), the shader material and the label
 *      font. A colorset alone is enough to recolour and re-surface a die.
 *
 *   3. A **system** per *glowing* damage type, holding one dice preset per die
 *      shape. This exists for exactly one reason: the emission map. Dice So
 *      Nice reads emissive maps off the *preset* and never off the texture, so
 *      a self-lit damage type needs presets of its own — there is no
 *      texture-level emissive channel to hang them on.
 *
 * Everything registers unconditionally, whatever the player's appearance mode.
 * Registration is cheap (presets load their images lazily, on the first die
 * that actually uses one) and doing it up front means `dmg.appearance` takes
 * effect the moment it changes instead of on the next reload — `apply.mjs`
 * decides how much of the stack to reach for, per roll.
 *
 * ── Why persistent damage is a colorset and not a system ──
 * The obvious way to make persistent damage burn hotter is a second system with
 * a higher `emissiveIntensity`. That would double the preset count and add 12
 * more entries to the player's dice-system dropdown, for a difference the eye
 * mostly reads off the *edges* anyway. So persistent is a colorset variant with
 * a hotter edge, outline and label — one extra object per type, none of the
 * clutter. It also sets `emissiveLabels`, which lights the numerals on the four
 * types that have no emission system at all.
 */

import { SUITE_ID, featurePath, log, warn } from "../../core/const.mjs";
import { lighten, mix } from "../../core/theme.mjs";
import {
  DAMAGE_TYPES,
  DAMAGE_TYPE_IDS,
  DICE_FONT,
  TEXTURE_DIR,
  colorsetName,
  systemName,
  textureName,
} from "./damage-types.mjs";
import { glowScale, useDiceFont } from "./settings.mjs";

/** Group header in Dice So Nice's own colorset and system selectors. */
const CATEGORY = "GLDMG.dsn.category";

/**
 * Die shapes we register presets for, with the label set Dice So Nice's own
 * `standard` system uses. PF2e rolls damage on d4–d12 in practice; d2/d3 turn
 * up on a few effects and d20 on a handful more. Wider dice (d24, d30, d100)
 * never carry a damage type, so they keep the player's own dice and simply
 * never enter the emission path — see `SUPPORTED_FACES`.
 *
 * These labels must match `standard` exactly or the numerals change under the
 * player: note d10 ending in "0", not "10".
 */
const numerals = (n) => Array.from({ length: n }, (_, i) => String(i + 1));

const DIE_PRESETS = Object.freeze({
  d2: numerals(2),
  d3: numerals(3),
  d4: numerals(4),
  d5: numerals(5),
  d6: numerals(6),
  d8: numerals(8),
  d10: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"],
  d12: numerals(12),
  d20: numerals(20),
});

/** Face counts that can be handed an emission system. Read by `apply.mjs`. */
export const SUPPORTED_FACES = Object.freeze(
  new Set(Object.keys(DIE_PRESETS).map((t) => Number(t.slice(1))))
);

/** Damage types that carry an emission map, and therefore a system. */
export const GLOWING_TYPES = Object.freeze(
  DAMAGE_TYPE_IDS.filter((id) => DAMAGE_TYPES[id].emissive > 0)
);

const texturePath = (file) => featurePath("pf2e-damage-dice", `assets/${TEXTURE_DIR}/${file}`);

/** Colorset name for the "still burning" variant of a type. */
export const persistentColorsetName = (id) => `${colorsetName(id)}-persistent`;

let registered = false;

/**
 * Make the bundled face visible to Foundry *without* loading it again.
 *
 * `styles/gl-fonts.css` already declares the @font-face, so the browser has it;
 * Foundry only needs to agree that it exists, and an empty `fonts` array is how
 * core marks a face as already provided. Skipping this sends Dice So Nice into
 * `FontConfig.loadFont()`, which reaches for Google's CDN — a network
 * round-trip the suite does not make, on a stack that is routinely run offline.
 */
export function registerFontDefinition() {
  if (!useDiceFont()) return;
  CONFIG.fontDefinitions ??= {};
  CONFIG.fontDefinitions[DICE_FONT] ??= { editor: false, fonts: [] };
}

/** Rasterise the face before Dice So Nice bakes a die texture from it. */
async function ensureFontLoaded() {
  if (!useDiceFont() || !document.fonts) return;
  try {
    await document.fonts.load(`700 32pt "${DICE_FONT}"`);
  } catch (e) {
    warn("pf2e-damage-dice | could not preload the dice font:", e);
  }
}

function buildColorset(id, { persistent }) {
  const type = DAMAGE_TYPES[id];
  const base = {
    name: persistent ? persistentColorsetName(id) : colorsetName(id),
    description: type.label,
    category: CATEGORY,
    foreground: type.foreground,
    background: type.background,
    outline: type.outline,
    edge: type.edge,
    texture: textureName(id),
    material: type.material,
    // The persistent variants are bound to a roll, never chosen by hand — the
    // same way Dice So Nice hides `coin_default` and `spectrum_default`.
    visibility: persistent ? "hidden" : "visible",
  };
  if (useDiceFont()) base.font = DICE_FONT;
  if (!persistent) return base;

  return {
    ...base,
    // Hot, not pale: the edge is pulled toward the type's own label colour
    // rather than toward white, which would only wash a dark edge out to grey.
    foreground: lighten(type.foreground, 0.4),
    outline: mix(type.outline, type.edge, 0.45),
    edge: mix(type.edge, type.foreground, 0.55),
    emissiveLabels: true,
  };
}

const appearanceCache = new Map();

/**
 * The colour half of a per-roll appearance payload.
 *
 * Naming the colorset is *not* enough on its own. `DiceFactory` reads
 * foreground / background / outline / edge / material / font off the appearance
 * object, never off the colorset the appearance names — the colorset only
 * supplies `emissiveLabels`, the composite modes, and fallbacks for fields
 * marked "custom". So when a die also swaps system, DSN re-merges that system's
 * preset colorset over the appearance, and anything we left implicit is lost.
 * That is precisely how the persistent variant's hot edge disappears.
 *
 * Spelling every field out means our payload — which merges last — wins on all
 * of them, whatever else got applied on the way through.
 */
export function appearanceFields(id, persistent) {
  const key = `${id}:${persistent ? 1 : 0}`;
  const hit = appearanceCache.get(key);
  if (hit) return hit;

  const cs = buildColorset(id, { persistent });
  const fields = {
    colorset: cs.name,
    foreground: cs.foreground,
    background: cs.background,
    outline: cs.outline,
    edge: cs.edge,
    texture: cs.texture,
    material: cs.material,
  };
  if (cs.font) fields.font = cs.font;
  appearanceCache.set(key, fields);
  return fields;
}

/** Register the emission-map presets for one glowing damage type. */
function registerEmissiveSystem(dice3d, id) {
  const type = DAMAGE_TYPES[id];
  const system = systemName(id);
  const emission = texturePath(`${id}-emissive.png`);
  const intensity = Number((type.emissive * glowScale()).toFixed(3));
  if (intensity <= 0) return false;

  dice3d.addSystem({ id: system, name: type.label, group: CATEGORY }, "default");

  for (const [dieType, labels] of Object.entries(DIE_PRESETS)) {
    const perFace = labels.map(() => emission);
    dice3d.addDicePreset({
      type: dieType,
      labels,
      // `emissiveMaps` is never drawn for *text* labels — but `registerFaces`
      // only builds the emissive tab at all when this array is non-empty, and
      // it is that tab's slot 0 (the `backgrounds` layer) that actually reaches
      // a numeral-labelled face. Dropping either half costs the whole glow,
      // silently.
      emissiveMaps: perFace,
      backgrounds: { emissiveMaps: perFace },
      emissive: 0xffffff,
      emissiveIntensity: intensity,
      colorset: colorsetName(id),
      system,
    });
  }
  return true;
}

/**
 * Called from the `diceSoNiceReady` hook. Safe to call twice — the second call
 * is a no-op rather than a duplicate registration.
 */
export async function registerDiceSoNice(dice3d) {
  if (registered) return;
  registered = true;

  await ensureFontLoaded();

  await Promise.all(
    DAMAGE_TYPE_IDS.map((id) =>
      dice3d
        .addTexture(textureName(id), {
          name: DAMAGE_TYPES[id].label,
          composite: "multiply",
          source: texturePath(`${id}.png`),
          bump: texturePath(`${id}-bump.png`),
          material: DAMAGE_TYPES[id].material,
        })
        .catch((e) => warn(`pf2e-damage-dice | texture "${id}" failed to load:`, e))
    )
  );

  for (const id of DAMAGE_TYPE_IDS) {
    await dice3d.addColorset(buildColorset(id, { persistent: false }), "default");
    await dice3d.addColorset(buildColorset(id, { persistent: true }), "default");
  }

  let systems = 0;
  for (const id of GLOWING_TYPES) if (registerEmissiveSystem(dice3d, id)) systems++;

  log(
    `PF2e Damage Dice | ${DAMAGE_TYPE_IDS.length} damage types registered with Dice So Nice ` +
    `(${systems} with emission maps${useDiceFont() ? `, numerals in ${DICE_FONT}` : ""})`
  );
}

/** Exposed on the suite api so a GM can sanity-check a fresh install. */
export function describeRegistration() {
  return {
    module: SUITE_ID,
    types: DAMAGE_TYPE_IDS.length,
    glowing: GLOWING_TYPES.length,
    dieShapes: Object.keys(DIE_PRESETS),
    font: useDiceFont() ? DICE_FONT : null,
    glowScale: glowScale(),
    registered,
  };
}
