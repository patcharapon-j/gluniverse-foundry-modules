/**
 * Diorama — the props of a scene: the only reader and writer of FLAG_PROPS.
 *
 * Stored at `scene.flags[SUITE_ID].dio.props.levels[<levelId>]` as
 * `{ v, props: Prop[] }` (the shape is terrain/props.mjs's), keyed by Level
 * like the terrain so a multi-Level scene is an addition, not a migration.
 *
 * Every write is a FORCED replacement of one Level's entry: a plain nested
 * update merges arrays by index, so a deleted prop would come back from the
 * old value while the write "succeeds".
 *
 *   PropStore.read(scene) → Prop[]                     normalised
 *   PropStore.write(scene, Prop[])                     GM only
 *   PropStore.clear(scene)                             GM only
 *   PropStore.touched(changes) → bool                  an updateScene diff moved FLAG_PROPS
 *   PropStore.states(scene, { isGM }) → PropState[]    what the renderer draws
 *
 * `touched` matches both shapes Foundry hands over: `setFlag` sends the literal
 * dotted key (`flags[SUITE_ID]["dio.props"]`), a nested update sends
 * `flags[SUITE_ID].dio.props`, and a forced write sends `==props` / `-=props`
 * beneath either.
 *
 * The flag reaches every client. A hidden prop is withheld from a player's
 * renderer and from the rules, which is a display rule, not a secrecy boundary
 * (docs/DIORAMA_PROPS.md).
 */

import { SUITE_ID } from "../../../core/const.mjs";
import { FLAG_PROPS } from "../constants.mjs";
import { levelIdOf } from "./store.mjs";
import { normalizeProps, propStates, propToJSON, PROP_FORMAT } from "./props.mjs";
import { liveTerrain } from "./live.mjs";

const PROPS_PATH = `flags.${SUITE_ID}.${FLAG_PROPS}`;
const [HEAD, TAIL] = FLAG_PROPS.split(".");   // "dio", "props"

const operators = () => globalThis.foundry?.data?.operators ?? null;

function forceSet(upd, path, value) {
  const O = operators();
  if (O?.ForcedReplacement) { upd[path] = O.ForcedReplacement.create(value); return upd; }
  const i = path.lastIndexOf(".");
  upd[`${path.slice(0, i)}.==${path.slice(i + 1)}`] = value;
  return upd;
}

function forceDelete(upd, path) {
  const O = operators();
  if (O?.ForcedDeletion) { upd[path] = new O.ForcedDeletion(); return upd; }
  const i = path.lastIndexOf(".");
  upd[`${path.slice(0, i)}.-=${path.slice(i + 1)}`] = null;
  return upd;
}

// `level` (every call, optional): the Level whose entry is meant; without one,
// the Level in question (terrain/store.mjs levelIdOf: viewed, else initial).
function readRaw(scene, level = null) {
  const all = scene?.getFlag?.(SUITE_ID, FLAG_PROPS);
  const e = all?.levels?.[levelIdOf(scene, level)];
  return e && typeof e === "object" ? e : null;
}

/** The update object a write sends (exported for the check tool). */
export function propsUpdate(scene, props, level = null) {
  const list = normalizeProps(props).map(propToJSON);
  return forceSet({}, `${PROPS_PATH}.levels.${levelIdOf(scene, level)}`, { v: PROP_FORMAT, props: list });
}

export const PropStore = {
  /** Is anything stored for this scene's Level? */
  has(scene, level = null) {
    return (readRaw(scene, level)?.props?.length ?? 0) > 0;
  },

  /** The saved props, normalised. Never throws. */
  read(scene, level = null) {
    try {
      return normalizeProps(readRaw(scene, level)?.props);
    } catch {
      return [];
    }
  },

  /** Save a Level's props (GM only). Forced replacement of its entry. */
  async write(scene, props, level = null) {
    if (!game.user?.isGM || !scene) return false;
    await scene.update(propsUpdate(scene, props, level));
    return true;
  },

  /** Remove this Level's props. */
  async clear(scene, level = null) {
    if (!game.user?.isGM || !scene) return false;
    await scene.update(forceDelete({}, `${PROPS_PATH}.levels.${levelIdOf(scene, level)}`));
    return true;
  },

  /** True when an updateScene change touched FLAG_PROPS, in either shape. */
  touched(changes) {
    const f = changes?.flags?.[SUITE_ID];
    if (!f || typeof f !== "object") return false;
    for (const k of Object.keys(f)) {
      const bare = k.replace(/^(==|-=)/, "");
      if (bare === FLAG_PROPS || bare.startsWith(`${FLAG_PROPS}.`)) return true;
    }
    const nested = f[HEAD];
    if (nested && typeof nested === "object") {
      return Object.keys(nested).some((k) => k.replace(/^(==|-=)/, "") === TAIL);
    }
    return false;
  },

  /**
   * What the renderer draws for this viewer, resolved against the live terrain
   * (bases stand on the ground or on solid props placed earlier). A player
   * never receives a hidden prop.
   */
  states(scene, { isGM = false, level = null } = {}) {
    const live = liveTerrain(scene, level);
    if (!live) return [];
    return propStates(live.props, { isGM });
  },
};
