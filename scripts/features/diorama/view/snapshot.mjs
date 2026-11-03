/**
 * Diorama view — the Foundry snapshot the renderer is fed.
 *
 * The renderer is pure (docs/DIORAMA.md "Renderer contract"); everything it
 * knows about the world comes through here. The decisions are pure functions
 * (`wallKind`, `wallState`, `tokenArtFor`, `pathCellsTo`, …) that the check
 * tool drives on fixtures; the `read*` functions only gather their inputs.
 *
 * Two rules that are easy to break and invisible on the GM's own screen:
 *   • A secret door is a plain wall to a player (an open one is just an open
 *     door, since the gap is visible anyway).
 *   • Standee art is the actor portrait for every viewer, so a bestiary
 *     creature stands as its full art. The one exception is a disguise: to a
 *     viewer who cannot Observe the actor, a token whose image was deliberately
 *     changed from the prototype's (a mimic's chest token) shows that token
 *     image, so it stays disguised. The GM's `dio.standee` override always wins.
 */

import { SUITE_ID } from "../../../core/const.mjs";
import { FLAG_STANDEE, WALL_MATERIALS } from "../constants.mjs";
import { distToQ } from "../terrain/model.mjs";
import { groundUnderWall, wallSpanQ } from "../terrain/wall-top.mjs";
import { artMarksOf, standeeMarks } from "../rules/creature.mjs";
import { canViewMode, barsFor } from "../integrations/bars.mjs";
import { conditionsFor } from "../integrations/conditions.mjs";
import { userColor } from "./util.mjs";

export const DEFAULT_ART = "icons/svg/mystery-man.svg";

/** v14 numbers, used when CONST is absent (the check tool). */
const SENSE = { NONE: 0, LIMITED: 10, NORMAL: 20, PROXIMITY: 30, DISTANCE: 40 };
const DOOR = { NONE: 0, DOOR: 1, SECRET: 2 };
const DS = { CLOSED: 0, OPEN: 1, LOCKED: 2 };

const C = () => globalThis.CONST ?? {};
const sense = () => C().EDGE_SENSE_TYPES ?? SENSE;
const doorTypes = () => C().WALL_DOOR_TYPES ?? DOOR;
const doorStates = () => C().WALL_DOOR_STATES ?? DS;
const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);

/* ───────────────────────────── walls ───────────────────────────── */

/**
 * What a wall document looks like to this viewer, or null when it is not a
 * wall at all (nothing blocked).
 * @param {{door?:number, ds?:number, sight?:number, move?:number}} doc
 * @param {boolean} isGM
 * @returns {{type:string, door:string}|null}
 */
export function wallKind(doc, isGM) {
  const S = sense(), D = doorTypes(), DSt = doorStates();
  const doorType = num(doc?.door, D.NONE);
  const ds = num(doc?.ds, DSt.CLOSED);
  const state = ds === DSt.OPEN ? "open" : ds === DSt.LOCKED ? "locked" : "closed";
  if (doorType === D.SECRET) {
    if (isGM) return { type: "secret", door: state };
    if (state === "open") return { type: "door", door: "open" };
    return { type: "wall", door: "none" };
  }
  if (doorType === D.DOOR) return { type: "door", door: state };
  const sight = num(doc?.sight, S.NORMAL), move = num(doc?.move, S.NORMAL);
  if (sight === S.NONE && move === S.NONE) return null;
  if (sight === S.NONE) return { type: "invisible", door: "none" };
  if (sight === S.LIMITED) return { type: "terrain", door: "none" };
  if (sight >= S.PROXIMITY) return { type: "window", door: "none" };
  return { type: "wall", door: "none" };
}

export { groundUnderWall };

/**
 * The renderer's WallState for one wall document.
 * @param {{id:string, c:number[], door?:number, ds?:number, sight?:number, move?:number, flags?:object}} doc
 * @param {{isGM:boolean, terrain:object|null, size:number, distance:number, defaultMaterial:string}} o
 */
export function wallState(doc, { isGM, terrain, size, distance, defaultMaterial }) {
  const k = wallKind(doc, isGM);
  if (!k) return null;
  const c = Array.isArray(doc?.c) ? doc.c.map(Number) : [];
  if (c.length < 4 || !c.slice(0, 4).every(Number.isFinite)) return null;
  const [x0, y0, x1, y1] = c;
  const pick = (m) => (WALL_MATERIALS.includes(m) ? m : null);
  const material = pick(terrain?.walls?.[doc.id]) ?? pick(defaultMaterial) ?? WALL_MATERIALS[0];
  // The same top sight and cover use (terrain/wall-top.mjs).
  const { baseQ, topQ } = wallSpanQ(doc, terrain, size, distance);
  return { id: doc.id, a: [x0, y0], b: [x1, y1], type: k.type, door: k.door, material, baseQ, topQ };
}

/** Every wall on the canvas, as WallState. */
export function readWalls({ isGM, terrain, grid, defaultMaterial }) {
  const out = [];
  for (const w of globalThis.canvas?.walls?.placeables ?? []) {
    const s = wallState(w.document, { isGM, terrain, size: grid.size, distance: grid.distance, defaultMaterial });
    if (s) out.push(s);
  }
  return out;
}

/* ───────────────────────────── tokens ───────────────────────────── */

/** A prototype token image that picks a file per token: not a deliberate choice of this token's. */
const isWildcard = (src) => /[*?]/.test(String(src ?? ""));

/**
 * Is this token disguised? Its own image was deliberately changed from the
 * actor's prototype token image (and the prototype does not pick a random or
 * wildcard image, where every token differs anyway).
 * @param {{tokenImg?:string|null, protoImg?:string|null, protoRandom?:boolean}} o
 */
export function isDisguised({ tokenImg = null, protoImg = null, protoRandom = false }) {
  if (!tokenImg || !protoImg || protoRandom || isWildcard(protoImg)) return false;
  return String(tokenImg) !== String(protoImg);
}

/**
 * Standee art. The GM's override, else the actor portrait (for every viewer),
 * except a disguised token to a viewer who cannot Observe the actor, which
 * shows its token image. A missing or mystery-man portrait falls back to the
 * token image.
 * @param {{standee?:string|null, canObserve:boolean, actorImg?:string|null, tokenImg?:string|null,
 *   protoImg?:string|null, protoRandom?:boolean}} o
 */
export function tokenArtFor({ standee = null, canObserve = false, actorImg = null, tokenImg = null, protoImg = null, protoRandom = false }) {
  if (standee) return String(standee);
  if (!canObserve && isDisguised({ tokenImg, protoImg, protoRandom })) return String(tokenImg);
  if (actorImg && actorImg !== DEFAULT_ART) return actorImg;
  return tokenImg || actorImg || DEFAULT_ART;
}

/** The standee art an actor shows an observer, with no token: what the Standee window marks. */
export function actorArtFor(actor) {
  return tokenArtFor({
    standee: standeeOf(actor), canObserve: true, actorImg: actor?.img ?? null,
    tokenImg: actor?.prototypeToken?.texture?.src ?? null,
  });
}

export function standeeOf(actor) {
  try {
    const v = actor?.getFlag?.(SUITE_ID, FLAG_STANDEE);
    return typeof v === "string" && v.trim() ? v.trim() : null;
  } catch {
    return null;
  }
}

/** Whether any non-GM user may Observe an actor (the "view as players" art rule). */
function playersObserve(actor) {
  try {
    return game.users.some((u) => !u.isGM && actor.testUserPermission(u, "OBSERVER"));
  } catch {
    return false;
  }
}

/**
 * The renderer's TokenState for every token this viewer may see.
 * @param {object} o
 * @param {boolean} o.isGM
 * @param {boolean} o.asPlayers       GM "view as players"
 * @param {{size:number, distance:number, units?:string}} o.grid
 * @param {string|null} o.hoveredId
 * @param {{current:string|null, next:string|null}} o.turns
 * @param {(actor:object, doc:object, units?:string) => number} o.heightOf  distance units
 * @param {((doc:object) => number)|null} [o.groundOf]  ground under the footprint, distance units
 * @param {((x:number, y:number) => boolean)|null} o.seen      player-view sight test (asPlayers)
 * @param {string} o.systemId
 * @param {boolean} [o.halo]          conditions ring the base (true) or sit on the plate
 */
export function readTokens({ isGM, asPlayers, grid, hoveredId, turns, heightOf, groundOf = null, seen, systemId, halo = false }) {
  const out = [];
  const gmView = isGM && !asPlayers;
  for (const token of globalThis.canvas?.tokens?.placeables ?? []) {
    const doc = token.document;
    if (!doc) continue;
    let visible = !!token.isVisible;
    if (asPlayers) visible = !doc.hidden && (!seen || seen(token.center?.x ?? 0, token.center?.y ?? 0));
    if (!visible) continue;
    const ghost = gmView && !!doc.hidden;
    const actor = token.actor ?? null;
    const isOwner = asPlayers ? !!actor?.hasPlayerOwner : !!doc.isOwner;
    const hovered = token.id === hoveredId;
    const isSecret = asPlayers ? doc.disposition === -2 && !isOwner : !!(doc.isSecret ?? (doc.disposition === -2 && !doc.isOwner));
    const canObserve = actor ? (asPlayers ? playersObserve(actor) : actor.testUserPermission(game.user, "OBSERVER")) : false;
    const center = token.center ?? { x: doc.x + (token.w ?? 0) / 2, y: doc.y + (token.h ?? 0) / 2 };
    const targets = [];
    for (const u of token.targeted ?? []) { const c = userColor(u); if (c) targets.push(c); }
    const heightDist = heightOf ? heightOf(actor, doc, grid.units) : 6;
    const footQ = distToQ(Number(doc.elevation) || 0, grid.distance);
    const groundD = groundOf ? Number(groundOf(doc)) : NaN;
    const proto = actor?.prototypeToken ?? null;
    const art = tokenArtFor({
      standee: standeeOf(actor), canObserve, actorImg: actor?.img ?? null, tokenImg: doc.texture?.src ?? null,
      protoImg: proto?.texture?.src ?? null, protoRandom: !!proto?.randomImg,
    });
    // The head and feet lines, only on the art they were marked on.
    const marks = standeeMarks(artMarksOf(actor), art);
    out.push({
      id: token.id,
      x: center.x,
      y: center.y,
      footQ,
      // The ground under it: a flyer gets a glass stand down to here.
      groundQ: Number.isFinite(groundD) ? distToQ(groundD, grid.distance) : footQ,
      heightQ: distToQ(heightDist, grid.distance),
      widthCells: Number(doc.width) || 1,
      art,
      artTop: marks ? marks.top : null,
      artBottom: marks ? marks.bottom : null,
      disposition: doc.disposition,
      visible: true,
      ghost,
      controlled: !asPlayers && !!token.controlled,
      hovered,
      targets: asPlayers ? [] : targets,
      turn: token.id === turns.current ? "current" : token.id === turns.next ? "next" : null,
      conditions: conditionsFor(token, systemId, { halo }),
      halo: !!halo,
      bars: barsFor(token, { hovered, isSecret }),
      name: !isSecret && canViewMode(doc.displayName, { controlled: !!token.controlled, hovered, isOwner }) ? doc.name : "",
    });
  }
  return out;
}

/* ───────────────────────────── scene ───────────────────────────── */

/** The map art of the scene's (initial) Level. */
export function backgroundSrc(scene) {
  let lvl = scene?.initialLevel;
  if (typeof lvl === "string") lvl = scene?.levels?.get?.(lvl) ?? null;
  const fromLevel = lvl && typeof lvl === "object" ? lvl.background?.src : null;
  if (fromLevel) return fromLevel;
  if (lvl && typeof lvl === "object") return null; // v14: no level art means no art
  return scene?.background?.src ?? null;
}

const VIDEO_RE = /\.(webm|mp4|m4v|ogv|mov)(\?|$)/i;

/**
 * Load the map art as something three.js can upload: an <img>, or a still of
 * a video's first frame on a <canvas>. Resolves null when it will not load.
 */
export function loadArt(src) {
  if (!src) return Promise.resolve(null);
  return new Promise((resolve) => {
    if (VIDEO_RE.test(src)) {
      const v = document.createElement("video");
      v.crossOrigin = "anonymous";
      v.muted = true;
      v.preload = "auto";
      v.onloadeddata = () => {
        try {
          const c = document.createElement("canvas");
          c.width = v.videoWidth; c.height = v.videoHeight;
          c.getContext("2d").drawImage(v, 0, 0);
          resolve(c);
        } catch { resolve(null); }
      };
      v.onerror = () => resolve(null);
      v.src = src;
      return;
    }
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/* ───────────────────────────── paths ───────────────────────────── */

/**
 * Cells from `a` to `b` inclusive of `b`, exclusive of `a`, 8-connected (a
 * diagonal step where both axes move), so a fast drag still leaves a
 * contiguous path.
 * @param {{i:number, j:number}} a
 * @param {{i:number, j:number}} b
 */
export function cellsBetween(a, b) {
  const out = [];
  let i = a.i, j = a.j;
  let guard = 0;
  while ((i !== b.i || j !== b.j) && guard++ < 10000) {
    i += Math.sign(b.i - i);
    j += Math.sign(b.j - j);
    out.push({ i, j });
  }
  return out;
}

/**
 * Extend a drag path to a new cell: walk to it, and cut back to any cell the
 * path already passed through (dragging back over the path un-draws it).
 * @param {Array<{i:number, j:number}>} path  first entry is the start
 * @param {{i:number, j:number}} to
 * @returns {Array<{i:number, j:number}>} a new array
 */
export function pathCellsTo(path, to) {
  const list = path.slice();
  if (!list.length) return [{ i: to.i, j: to.j }];
  for (const c of cellsBetween(list[list.length - 1], to)) {
    const k = list.findIndex((p) => p.i === c.i && p.j === c.j);
    if (k >= 0) list.length = k + 1;
    else list.push(c);
  }
  return list;
}
