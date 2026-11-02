/**
 * Diorama — the only reader and writer of the terrain scene flag.
 *
 * Stored at `scene.flags[SUITE_ID].dio.terrain.levels[<levelId>]` (the flag key
 * `dio.terrain` resolves to that nested path through getProperty), one entry
 * per v14 Level, heights relative to that Level's base (terrain/levels.mjs).
 * Every call takes an optional Level; without one it is the Level in question
 * (`resolveLevelId`: the one viewed on the canvas, else the initial Level), so
 * a one-Level scene and an old world read exactly the entry they always did.
 *
 * Every write is a FORCED replacement of one Level's entry: a plain nested
 * update merges, so a palette that lost an entry or a wall-material map that
 * lost a key would keep the old value forever while the write "succeeds".
 *
 * The flag reaches every client. This is a display rule, never a secrecy
 * boundary (docs/DIORAMA.md).
 */

import { SUITE_ID } from "../../../core/const.mjs";
import { FLAG_TERRAIN, FLAG_OFF, SETTINGS } from "../constants.mjs";
import { Terrain, distToQ } from "./model.mjs";
import { resolveLevelId } from "./levels.mjs";

const TERRAIN_PATH = `flags.${SUITE_ID}.${FLAG_TERRAIN}`;

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

/**
 * The Level id terrain is keyed on: `level` when the scene holds it, else the
 * Level viewed on the canvas, else the initial Level, else "default".
 * @param {Scene} scene
 * @param {string|{id:string}|null} [level]
 */
export function levelIdOf(scene, level = null) {
  return resolveLevelId(scene, level);
}

/** Grid facts the terrain is laid out on. */
export function gridOf(scene) {
  const d = scene?.dimensions ?? {};
  return {
    cols: d.columns ?? Math.ceil((d.width ?? 0) / (d.size || 100)),
    rows: d.rows ?? Math.ceil((d.height ?? 0) / (d.size || 100)),
    size: d.size ?? scene?.grid?.size ?? 100,
    distance: d.distance ?? scene?.grid?.distance ?? 5,
    units: scene?.grid?.units ?? "ft",
    sceneRect: d.sceneRect ?? { x: 0, y: 0, width: d.width ?? 0, height: d.height ?? 0 },
  };
}

/** Whether the scene's grid is one Diorama supports (square only). */
export function supportsScene(scene) {
  const T = globalThis.CONST?.GRID_TYPES;
  const type = scene?.grid?.type;
  return T ? type === T.SQUARE : type === 1;
}

function readRaw(scene, level = null) {
  const all = scene?.getFlag?.(SUITE_ID, FLAG_TERRAIN);
  return all?.levels?.[levelIdOf(scene, level)] ?? null;
}

/** The Level ids that have saved terrain. */
export function savedLevelIds(scene) {
  const all = scene?.getFlag?.(SUITE_ID, FLAG_TERRAIN)?.levels;
  return all && typeof all === "object" ? Object.keys(all).filter((k) => all[k]) : [];
}

function setting(key, fallback) {
  try { return game.settings.get(SUITE_ID, key); } catch { return fallback; }
}

/** A blank terrain for a scene: floor inside the scene rect, void outside. */
export function blankFor(scene) {
  const g = gridOf(scene);
  const r = g.sceneRect;
  const inside = (i, j) => {
    const cx = (j + 0.5) * g.size, cy = (i + 0.5) * g.size;
    return cx >= r.x && cx < r.x + r.width && cy >= r.y && cy < r.y + r.height;
  };
  return Terrain.blank(g.cols, g.rows, inside, {
    wallHeight: Math.round(distToQ(Number(setting(SETTINGS.wallHeight, 10)) || 10, g.distance)),
    stepHeight: Math.round(distToQ(Number(setting(SETTINGS.stepHeight, 2.5)) || 0, g.distance)),
  });
}

/** The update a write sends: a forced replacement of one Level's entry (exported for the check tool). */
export function terrainUpdate(scene, terrain, level = null) {
  return forceSet({}, `${TERRAIN_PATH}.levels.${levelIdOf(scene, level)}`, terrain.toJSON());
}

export const TerrainStore = {
  /** Is terrain saved for this Level (default: the Level in question)? */
  has(scene, level = null) {
    return !!readRaw(scene, level);
  },

  /** The saved terrain of a Level, or a flat blank one. Never throws. */
  read(scene, level = null) {
    const raw = readRaw(scene, level);
    if (!raw) return blankFor(scene);
    const g = gridOf(scene);
    try {
      return Terrain.fromJSON(raw, { cols: g.cols, rows: g.rows });
    } catch {
      return blankFor(scene);
    }
  },

  /** Save a terrain (GM only). Forced replacement of this Level's entry. */
  async write(scene, terrain, level = null) {
    if (!game.user?.isGM || !scene) return false;
    await scene.update(terrainUpdate(scene, terrain, level));
    return true;
  },

  /** Remove a Level's terrain (back to flat). */
  async clear(scene, level = null) {
    if (!game.user?.isGM || !scene) return false;
    await scene.update(forceDelete({}, `${TERRAIN_PATH}.levels.${levelIdOf(scene, level)}`));
    return true;
  },

  /** GM marked the scene "3D off". */
  isOff(scene) {
    return scene?.getFlag?.(SUITE_ID, FLAG_OFF) === true;
  },

  async setOff(scene, off) {
    if (!game.user?.isGM || !scene) return;
    await scene.setFlag(SUITE_ID, FLAG_OFF, !!off);
  },

  /** True when an updateScene change touched our flags. */
  touched(changes) {
    const f = changes?.flags?.[SUITE_ID];
    if (!f) return false;
    return "dio" in f || Object.keys(f).some((k) => k.startsWith("dio.") || k.startsWith("==dio") || k.startsWith("-=dio"));
  },
};
