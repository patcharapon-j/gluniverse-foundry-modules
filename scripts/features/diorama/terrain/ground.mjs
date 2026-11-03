/**
 * Diorama — the 3D ground image: the only reader and writer of FLAG_GROUND.
 *
 * A scene may carry a separate image for the 3D view to draw as its ground,
 * instead of the Level's background, over the same scene rect. A Map Maker
 * Diorama Bundle (docs/DIORAMA_BUNDLE.md) brings one: the painted map with its
 * standing props removed, so the 3D models stand on clean floor rather than on
 * their own 3/4-view paint. The 2D canvas never reads it and keeps the full art.
 *
 * Stored at `scene.flags[SUITE_ID].dio.ground.levels[<levelId>]` as a path
 * string, keyed by Level like the terrain (terrain/store.mjs levelIdOf: the
 * Level asked for, else the viewed one, else the initial one, else "default").
 *
 *   GroundStore.read(scene, level?) → string|null
 *   GroundStore.write(scene, src|null, level?)          GM only; null clears
 *   GroundStore.touched(changes) → bool                 an updateScene diff moved FLAG_GROUND
 *   groundUpdate(scene, src|null, level?)               the update a write sends
 */

import { SUITE_ID } from "../../../core/const.mjs";
import { FLAG_GROUND } from "../constants.mjs";
import { levelIdOf } from "./store.mjs";

const GROUND_PATH = `flags.${SUITE_ID}.${FLAG_GROUND}`;
const [HEAD, TAIL] = FLAG_GROUND.split(".");   // "dio", "ground"

/** The longest path kept; a cut path would load nothing, so a longer one is dropped. */
export const GROUND_SRC_MAX = 2048;

/** A usable image path, or null. */
export function normalizeGroundSrc(src) {
  if (typeof src !== "string") return null;
  const s = src.trim();
  // eslint-disable-next-line no-control-regex
  if (!s || s.length > GROUND_SRC_MAX || /[\u0000-\u001f]/.test(s)) return null;
  return s;
}

function rawAll(scene) {
  let all = null;
  try { all = scene?.getFlag?.(SUITE_ID, FLAG_GROUND); } catch { all = null; }
  return all ?? scene?.flags?.[SUITE_ID]?.[HEAD]?.[TAIL] ?? null;
}

const operators = () => globalThis.foundry?.data?.operators ?? null;

/** The update a write sends (exported for the check tool). Null clears the Level's entry. */
export function groundUpdate(scene, src, level = null) {
  const path = `${GROUND_PATH}.levels.${levelIdOf(scene, level)}`;
  const value = normalizeGroundSrc(src);
  if (value) return { [path]: value };
  const O = operators();
  if (O?.ForcedDeletion) return { [path]: new O.ForcedDeletion() };
  const i = path.lastIndexOf(".");
  return { [`${path.slice(0, i)}.-=${path.slice(i + 1)}`]: null };
}

export const GroundStore = {
  /** The Level's 3D ground image, or null (the 3D view then draws the background). */
  read(scene, level = null) {
    const all = rawAll(scene);
    return normalizeGroundSrc(all?.levels?.[levelIdOf(scene, level)]);
  },

  /** Set (or with null, clear) the Level's 3D ground image. GM only. */
  async write(scene, src, level = null) {
    if (!game.user?.isGM || !scene) return false;
    await scene.update(groundUpdate(scene, src, level));
    return true;
  },

  /** True when an updateScene change touched FLAG_GROUND, in either shape. */
  touched(changes) {
    const f = changes?.flags?.[SUITE_ID];
    if (!f || typeof f !== "object") return false;
    for (const k of Object.keys(f)) {
      const bare = k.replace(/^(==|-=)/, "");
      if (bare === FLAG_GROUND || bare.startsWith(`${FLAG_GROUND}.`)) return true;
    }
    const nested = f[HEAD];
    if (nested && typeof nested === "object") {
      return Object.keys(nested).some((k) => k.replace(/^(==|-=)/, "") === TAIL);
    }
    return false;
  },
};

/**
 * The image the 3D view draws as a Level's ground: its 3D ground when set,
 * else `fallback` (the Level's background, which the caller already resolves).
 */
export function groundArtSrc(scene, level, fallback) {
  return GroundStore.read(scene, level) ?? fallback ?? null;
}
