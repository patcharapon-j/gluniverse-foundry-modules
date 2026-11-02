/**
 * Diorama — the scene's Levels, read the way Foundry v14 reads them. Pure.
 *
 * A v14 Scene holds embedded Level documents (common/documents/level.mjs):
 * each has `elevation.{bottom, top}` (null bottom = -Infinity, null top =
 * +Infinity), its own `background.src`, and `visibility.levels`, the other
 * Levels drawn while this one is viewed. The client prepares
 * `elevation.base` (client/documents/level.mjs prepareBaseData): the bottom
 * when it is finite, else min(top, 0). A token belongs to exactly one Level
 * (`TokenDocument#level`, a document id, defaulting to the scene's initial
 * Level), and its elevation is ABSOLUTE. The canvas views one Level at a time:
 * `scene._view` holds its id while that scene is on the canvas (canvas/board.mjs
 * `#scene._view = nextLevel.id`), and switching Level redraws the canvas
 * (Scene#view → canvas.draw), so canvasReady fires.
 *
 * Diorama keys its terrain and props by Level id, and stores heights RELATIVE
 * to the Level's base: q 0 is the Level's floor. Every reader here adds the
 * base back where an absolute height is needed.
 *
 * Two rules keep old worlds unchanged, with no migration:
 *   • With no Level asked for, the Level in question is the one viewed on the
 *     canvas, else the scene's initial Level, else "default" (no Levels at
 *     all: a fixture, or a v13 scene). In a one-Level scene all three agree.
 *   • A scene with one Level has base 0, whatever its Level's bottom says, so
 *     a single-Level scene behaves exactly as it did before Levels were read.
 *
 * Takes plain objects or live documents; reads no globals.
 */

import { KIND } from "../constants.mjs";
import { distToQ } from "./model.mjs";

/** The key a scene with no Levels at all is stored under. */
export const DEFAULT_LEVEL = "default";

const idOf = (l) => (typeof l === "string" ? l : (l && typeof l === "object" && typeof l.id === "string" ? l.id : null));

/** Every Level document of a scene, as an array (any collection shape). */
function levelDocs(scene) {
  const c = scene?.levels;
  if (!c) return [];
  if (Array.isArray(c)) return c;
  if (Array.isArray(c.contents)) return c.contents;
  if (typeof c.values === "function") return [...c.values()];
  return [];
}

/** A Level document by id, or null. */
export function levelDoc(scene, id) {
  if (!id) return null;
  const c = scene?.levels;
  if (c && typeof c.get === "function") return c.get(id) ?? null;
  return levelDocs(scene).find((l) => l?.id === id) ?? null;
}

const finite = (v) => (v === null || v === undefined || v === "" ? null : (Number.isFinite(Number(v)) ? Number(v) : null));

/** A Level's base elevation, distance units, as v14 prepares it. */
export function baseOfLevel(level) {
  const e = level?.elevation ?? {};
  if (Number.isFinite(e.base)) return e.base;
  const bottom = finite(e.bottom), top = finite(e.top);
  if (bottom !== null) return bottom;
  return Math.min(top ?? Infinity, 0);
}

const toSet = (v) => {
  if (v instanceof Set) return v;
  if (Array.isArray(v)) return new Set(v);
  if (v && typeof v[Symbol.iterator] === "function") return new Set(v);
  return new Set();
};

/**
 * The scene's Levels, lowest base first (ties by sort, then id).
 * @returns {Array<{id:string, name:string, bottom:number, top:number, base:number, sort:number,
 *   src:string|null, visible:Set<string>}>}
 */
export function levelsOf(scene) {
  return levelDocs(scene).filter((l) => idOf(l)).map((l) => {
    const e = l.elevation ?? {};
    const bottom = finite(e.bottom), top = finite(e.top);
    return {
      id: l.id,
      name: String(l.name ?? l.id),
      bottom: bottom ?? -Infinity,
      top: top ?? Infinity,
      base: baseOfLevel(l),
      sort: Number(l.sort) || 0,
      src: l.background?.src || null,
      visible: toSet(l.visibility?.levels),
    };
  }).sort((a, b) => (a.base - b.base) || (a.sort - b.sort) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** True when the scene has more than one Level. */
export function isMultiLevel(scene) {
  return levelDocs(scene).length > 1;
}

/** The scene's initial Level id, or null (v14: `scene.initialLevel` falls back to the first). */
export function initialLevelId(scene) {
  return idOf(scene?.initialLevel) ?? (scene?._source?.initialLevel || null);
}

/** The Level viewed on the canvas while this scene is on it, else null. */
export function viewedLevelId(scene) {
  const v = scene?._view;
  return typeof v === "string" && v && (levelDoc(scene, v) || !levelDocs(scene).length) ? v : null;
}

/**
 * The Level in question. An asked-for Level that the scene holds wins; else
 * the viewed Level; else the initial Level; else DEFAULT_LEVEL.
 * @param {object} scene
 * @param {string|{id:string}|null} [level]
 */
export function resolveLevelId(scene, level = null) {
  const asked = idOf(level);
  const docs = levelDocs(scene);
  // A scene with no Level collection cannot say no; one with Levels must hold it.
  if (asked && (!docs.length || levelDoc(scene, asked))) return asked;
  return viewedLevelId(scene) ?? initialLevelId(scene) ?? DEFAULT_LEVEL;
}

/** The Level a token stands on (its stored `level`, v14 TokenDocument#level). */
export function tokenLevelId(doc) {
  const d = doc?.document ?? doc;
  const v = d?._source?.level ?? d?.level;
  return typeof v === "string" && v ? v : null;
}

/**
 * The base a Level's terrain stands on, distance units. 0 in a scene with one
 * Level (or none), so single-Level scenes never move.
 */
export function levelBaseDist(scene, level = null) {
  if (!isMultiLevel(scene)) return 0;
  const doc = levelDoc(scene, resolveLevelId(scene, level));
  const b = doc ? baseOfLevel(doc) : 0;
  return Number.isFinite(b) ? b : 0;
}

/** The same base in q (not rounded). */
export function levelBaseQ(scene, level, gridDistance) {
  return distToQ(levelBaseDist(scene, level), gridDistance);
}

/** A Level's own background art (v14 Levels carry their own), or null. */
export function levelBackgroundSrc(scene, level = null) {
  const doc = levelDoc(scene, resolveLevelId(scene, level));
  if (doc) return doc.background?.src || null;
  return scene?.background?.src ?? null;
}

/**
 * A terrain moved up by `dq` q, for drawing in the 3D view's absolute frame:
 * every live sub-cell's height plus dq (rounded: heights are whole q). Void is
 * left as it is (it draws nothing). dq 0 returns the same terrain.
 * @param {import("./model.mjs").Terrain|null} t
 * @param {number} dq
 */
export function shiftTerrain(t, dq) {
  const d = Math.round(Number(dq) || 0);
  if (!t || !d) return t;
  const out = t.clone();
  const h = out.h, kind = out.kind;
  for (let k = 0; k < h.length; k++) {
    if ((kind[k] & 0x0f) === KIND.VOID) continue;
    h[k] = Math.max(-32000, Math.min(32000, h[k] + d));
  }
  return out;
}

/**
 * PropStates moved into another frame: up by `dCells` cells, ids tagged with
 * the Level, and (for a Level other than the viewed one) no longer blocking,
 * so the renderer stamps nothing of another floor into the viewed one's ground.
 * @param {object[]} states  terrain/props.mjs propStates()
 * @param {{dCells?:number, tag?:string|null, blocks?:boolean}} [o]
 */
export function shiftPropStates(states, { dCells = 0, tag = null, blocks = true } = {}) {
  if (!dCells && !tag && blocks) return states ?? [];
  return (states ?? []).map((s) => ({
    ...s,
    id: tag ? `${tag}:${s.id}` : s.id,
    base: (Number(s.base) || 0) + dCells,
    blocks: blocks ? s.blocks : false,
  }));
}
