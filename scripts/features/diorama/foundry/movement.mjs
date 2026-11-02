/**
 * Diorama — movement over the height field.
 *
 *   ELEVATION IS WRITTEN. A token's elevation is the ground under its
 *   footprint plus its own altitude (token flag `dio.altitude`). The drag
 *   workflow asks Token#_getDragWaypointPosition (placeables/token.mjs L5465)
 *   for every waypoint it places, from _updateDragDestination (L5159),
 *   _addDragWaypoint (L5235) and _changeDragElevation (L5441, the mouse
 *   wheel); the wrapper puts that waypoint on the ground, so a drag animates
 *   up and down ledges. The method takes no action argument; the action the
 *   drag will use is Token#_getDragMovementAction() (L5018), read here.
 *
 *   CLIFFS BLOCK WALKING. Token#_getMovementCostFunction (L2915) returns the
 *   per-step cost function. For square grids TokenDocument calls it once per
 *   occupied cell with grid offsets {i, j, k} (documents/token.mjs L1263) and
 *   the default aggregator makes any Infinity win (config.mjs L2361), so a
 *   cell step that rises above the step height without stairs costs Infinity
 *   for ground-bound actions and Foundry's pathfinding routes round it.
 *
 *   RESYNC. Anything that moves a token without dragging (keyboard, HUD, API)
 *   is corrected by the active GM on `updateToken`, in one update tagged
 *   `dioSync` so it never loops. A correction is a `displace` waypoint, which
 *   is a teleport with no cost and no wall test (config.mjs L2439), so it does
 *   not spend anybody's movement.
 *
 *   ON PURPOSE. Two seams run on the client that makes the change, so they
 *   hold with no GM connected and land in the same write. `preUpdateToken`: an
 *   elevation set while the token stays on its square (the Token HUD's field,
 *   the token config, the keyboard's up / down, a macro) re-derives the
 *   altitude flag (max(0, elevation − ground)), so the figure keeps that height
 *   and later moves carry it. TokenDocument#_preUpdate has already turned a
 *   move into the destination's x / y / elevation by then (documents/token.mjs
 *   #preUpdateMovement), so "stays on its square" is read against `_source`.
 *   `preCreateToken`: a new token (a drop, a paste) stands on the ground under
 *   it, or keeps its altitude flag over it.
 *
 * Imports cleanly under Node: Foundry classes are reached inside functions.
 */

import { SUITE_ID, err } from "../../../core/const.mjs";
import { registerWrapper } from "../../../core/wrapper.mjs";
import { FLAG_ALTITUDE } from "../constants.mjs";
import { qToDist } from "../terrain/model.mjs";
import { isGroundAction } from "../rules/path.mjs";
import { PF2E } from "../rules/systems.mjs";
import { activeContext, anyContext, rulesOn, tokenContext } from "./context.mjs";
import { tokenLevelId } from "../terrain/levels.mjs";

const EPS = 1e-4;
const ALTITUDE_PATH = `flags.${SUITE_ID}.${FLAG_ALTITUDE}`;
const round = (n) => Math.round(n * 1e4) / 1e4;

/* ------------------------------------------------------------------ */
/*  Ground and altitude                                                */
/* ------------------------------------------------------------------ */

/**
 * Highest cell top (q) under a token footprint whose top-left is (x, y) px.
 * A big token, or one between squares, stands on the highest cell it covers.
 */
export function footprintTopQ(terrain, gridSize, x, y, wCells = 1, hCells = 1) {
  const s = gridSize || 100;
  const e = 1e-3;
  const j0 = Math.floor((x + e) / s), i0 = Math.floor((y + e) / s);
  const j1 = Math.max(j0, Math.ceil((x + Math.max(0.5, wCells) * s - e) / s) - 1);
  const i1 = Math.max(i0, Math.ceil((y + Math.max(0.5, hCells) * s - e) / s) - 1);
  return terrain.footprintTop(i0, j0, j1 - j0 + 1, i1 - i0 + 1);
}

/** Ground under a footprint, ABSOLUTE distance units: the Level's own ground plus its base. */
function groundFrom(live, x, y, w, h) {
  return round(qToDist(footprintTopQ(live.terrain, live.grid.size, x, y, w, h), live.grid.distance) + (Number(live.base) || 0));
}

/**
 * Ground under a footprint in absolute distance units (the Level's base where
 * the scene has no terrain).
 * @param {Scene} scene
 * @param {number} x  top-left px
 * @param {number} y
 * @param {number} [wCells=1]
 * @param {number} [hCells=1]
 * @param {string|null} [level]  the Level (default: the one viewed, else the initial one)
 */
export function groundDistAt(scene, x, y, wCells = 1, hCells = 1, level = null) {
  const live = anyContext(scene, level);
  if (!live) return 0;
  return groundFrom(live, x, y, wCells, hCells);
}

function altitudeFlag(tokenDoc) {
  let v;
  try { v = tokenDoc?.getFlag?.(SUITE_ID, FLAG_ALTITUDE); } catch { v = undefined; }
  if (v === undefined) {
    const scope = tokenDoc?.flags?.[SUITE_ID];
    v = scope?.[FLAG_ALTITUDE] ?? scope?.dio?.altitude;
  }
  const n = Number(v);
  return v === undefined || v === null || !Number.isFinite(n) ? undefined : Math.max(0, n);
}

/** A token's altitude above the ground in distance units (0 unless it flies). */
export function altitudeOf(tokenDoc) {
  return altitudeFlag(tokenDoc) ?? 0;
}

/**
 * Decide a token's elevation, pure.
 * @param {object} o
 * @param {number} o.elevation         the elevation it has now
 * @param {string} o.action            its movement action
 * @param {number} o.ground            ground under it now
 * @param {number|undefined} o.altFlag its stored altitude, if any
 * @param {number} [o.fallbackAlt=0]   altitude to assume when none is stored
 * @param {boolean} [o.elevationChanged=false]  the elevation was just set on purpose
 * @returns {{elevation:number, altitude:number, writeElevation:boolean, writeAltitude:boolean}|null}
 */
export function planElevation({ elevation, action, ground, altFlag, fallbackAlt = 0, elevationChanged = false }) {
  if (action === "burrow") return null; // underground is the burrower's business
  const elev = Number(elevation) || 0;
  let target, alt;
  if (elevationChanged || action === "fly") {
    target = Math.max(elev, ground);
    alt = target - ground;
  } else {
    alt = altFlag ?? Math.max(0, Number(fallbackAlt) || 0);
    target = ground + alt;
  }
  target = round(target);
  alt = round(Math.max(0, alt));
  const writeElevation = Math.abs(target - elev) > EPS;
  const writeAltitude = altFlag === undefined ? alt > EPS : Math.abs(alt - altFlag) > EPS;
  if (!writeElevation && !writeAltitude) return null;
  return { elevation: target, altitude: alt, writeElevation, writeAltitude };
}

/* ------------------------------------------------------------------ */
/*  Speed                                                              */
/* ------------------------------------------------------------------ */

const PF2E_SPEED_KEY = Object.freeze({ fly: "fly", swim: "swim", climb: "climb", burrow: "burrow" });

const speedValue = (s) => {
  const v = Number(s && typeof s === "object" ? (s.value ?? s.total) : s);
  return Number.isFinite(v) && v > 0 ? v : null;
};

/**
 * A creature's Speed for an action, in distance units, or null when the system
 * has none (Daggerheart moves by range band).
 * PF2e 8.x: `system.movement.speeds.<land|fly|swim|climb|burrow>.value`
 * (its migration rewrites `attributes.speed.total` to `movement.speeds.land.value`).
 */
export function speedOf(actor, systemId, action = "walk") {
  if (!actor || systemId !== PF2E) return null;
  const speeds = actor.system?.movement?.speeds;
  const key = PF2E_SPEED_KEY[action];
  if (key) return speedValue(speeds?.[key]);
  return speedValue(speeds?.land)
    ?? speedValue(actor.system?.attributes?.speed?.total)
    ?? speedValue(actor.system?.attributes?.speed?.value);
}

/* ------------------------------------------------------------------ */
/*  Wrappers                                                           */
/* ------------------------------------------------------------------ */

/** Actions whose terrainAction was "walk" when we installed (Foundry deletes the key after init). */
const _walkLike = new Set();

export function snapshotGroundActions(actions = globalThis.CONFIG?.Token?.movement?.actions) {
  for (const [k, cfg] of Object.entries(actions ?? {})) {
    if (k !== "climb" && cfg?.terrainAction === "walk") _walkLike.add(k);
  }
  return [..._walkLike];
}

export function groundBound(action) { return isGroundAction(action, _walkLike); }

/** MIXED wrapper: Token#_getDragWaypointPosition(current, changes, options). */
function dragWaypointWrapper(wrapped, current, changes, options) {
  const pos = wrapped(current, changes, options);
  try {
    const doc = this.document;
    // v14 puts a drag waypoint on the Level it lands in (the viewed one): read that Level's ground.
    const fromLevel = current?.level ?? tokenLevelId(doc);
    const live = activeContext(doc?.parent, pos?.level ?? fromLevel);
    if (!live || !pos) return pos;
    const action = this._getDragMovementAction?.() ?? doc.movementAction;
    if (action === "burrow") return pos;
    const src = doc._source ?? doc;
    const w = src.width ?? 1, h = src.height ?? 1;
    const ground = groundFrom(live, pos.x, pos.y, w, h);
    if (changes && changes.elevation !== undefined) {
      // An explicit change (the mouse wheel): anything above ground is altitude.
      pos.elevation = round(Math.max(ground, Number(changes.elevation) || 0));
    } else if (action === "fly") {
      pos.elevation = round(Math.max(Number(pos.elevation) || 0, ground));
    } else {
      const from = live.levelId === fromLevel ? live : (anyContext(doc.parent, fromLevel) ?? live);
      const was = groundFrom(from, current?.x ?? src.x, current?.y ?? src.y, w, h);
      const alt = Math.max(0, (Number(current?.elevation ?? pos.elevation) || 0) - was);
      pos.elevation = round(ground + alt);
    }
  } catch (e) {
    err("Diorama: drag waypoint elevation failed", e);
  }
  return pos;
}

/** MIXED wrapper: Token#_getMovementCostFunction(options). */
function costFunctionWrapper(wrapped, options) {
  const fn = wrapped(options);
  const live = tokenContext(this.document);
  if (!live) return fn;
  const terrain = live.terrain;
  return (from, to, distance, segment) => {
    if (from && to && (from.i !== to.i || from.j !== to.j) && groundBound(segment?.action)
      && terrain.step(from.i, from.j, to.i, to.j).climb) return Infinity;
    return fn ? fn(from, to, distance, segment) : distance;
  };
}

let _installed = false;

/** Wrap the two Token seams. Idempotent. */
export function installMovement() {
  if (_installed) return;
  _installed = true;
  snapshotGroundActions();
  registerWrapper("foundry.canvas.placeables.Token.prototype._getDragWaypointPosition", dragWaypointWrapper);
  registerWrapper("foundry.canvas.placeables.Token.prototype._getMovementCostFunction", costFunctionWrapper);
}

/* ------------------------------------------------------------------ */
/*  Elevation sync (active GM only)                                    */
/* ------------------------------------------------------------------ */

const isActiveGM = () => !!globalThis.game?.users?.activeGM?.isSelf;

/** The update a token needs, or null. `fallbackGround`: ground before a repaint. */
export function planToken(doc, live, { elevationChanged = false, fallbackGround } = {}) {
  const src = doc._source ?? doc;
  const ground = groundFrom(live, src.x, src.y, src.width ?? 1, src.height ?? 1);
  const elevation = Number(src.elevation) || 0;
  const fallbackAlt = fallbackGround === undefined ? 0 : Math.max(0, elevation - fallbackGround);
  const p = planElevation({ elevation, action: doc.movementAction, ground, altFlag: altitudeFlag(doc),
    fallbackAlt, elevationChanged });
  if (!p) return null;
  const update = { _id: doc.id };
  if (p.writeElevation) update.elevation = p.elevation;
  if (p.writeAltitude) update[ALTITUDE_PATH] = p.altitude;
  return { update, elevation: p.writeElevation ? p.elevation : null, x: src.x, y: src.y };
}

/** Update options for a batch of corrections: each elevation write is a displace. */
export function correctionOptions(plans) {
  const movement = {};
  for (const p of plans) {
    if (p.elevation === null) continue;
    movement[p.update._id] = {
      waypoints: [{ x: p.x, y: p.y, elevation: p.elevation, action: "displace",
        snapped: false, explicit: false, checkpoint: true }],
      method: "api", autoRotate: false, showRuler: false,
    };
  }
  return Object.keys(movement).length ? { dioSync: true, movement } : { dioSync: true };
}

/** `updateToken` hook. */
export function onUpdateToken(doc, changes, options) {
  if (options?.dioSync || !changes) return;
  // A change of Level is a move: the token now stands on another Level's ground.
  const moved = ["x", "y", "width", "height", "level"].some((k) => k in changes);
  const elevationChanged = "elevation" in changes;
  if (!moved && !elevationChanged) return;
  if (!isActiveGM()) return;
  const live = tokenContext(doc);
  if (!live) return;
  if (doc.movement?.state === "pending") return; // correct once, when the move lands
  const plan = planToken(doc, live, { elevationChanged });
  if (!plan) return;
  const { _id, ...data } = plan.update;
  doc.update(data, correctionOptions([plan])).catch((e) => err("Diorama: elevation sync failed", e));
}

/**
 * Is this update an elevation set on purpose, with the token staying where it
 * is? Pure. `changes` are the candidate changes (a move's destination already in them).
 */
export function isElevationEdit(src, changes) {
  if (!src || !changes || !("elevation" in changes)) return false;
  const e = Number(changes.elevation);
  if (!Number.isFinite(e) || Math.abs(e - (Number(src.elevation) || 0)) <= EPS) return false;
  for (const k of ["x", "y", "width", "height"]) {
    if (k in changes && Math.abs((Number(changes[k]) || 0) - (Number(src[k]) || 0)) > EPS) return false;
  }
  return true;
}

/** `preUpdateToken` hook: an elevation set on purpose re-derives the altitude flag in the same update. */
export function onPreUpdateToken(doc, changes, options) {
  if (options?.dioSync) return;
  try {
    const src = doc?._source;
    if (!isElevationEdit(src, changes)) return;
    const fu = globalThis.foundry?.utils;
    if (!fu || fu.hasProperty(changes, ALTITUDE_PATH) || ALTITUDE_PATH in changes) return; // an explicit altitude wins
    // Not only where the rules run: the 3D view moves a token at ground + altitude on a flat or
    // unprepared scene too, so an edit there must land in the flag or the next drag drops it.
    if (!rulesOn()) return;
    const ground = groundDistAt(doc.parent, src.x, src.y, src.width ?? 1, src.height ?? 1, tokenLevelId(doc));
    const p = planElevation({ elevation: changes.elevation, action: doc.movementAction, ground,
      altFlag: altitudeFlag(doc), elevationChanged: true });
    if (p?.writeAltitude) fu.setProperty(changes, ALTITUDE_PATH, p.altitude);
  } catch (e) {
    err("Diorama: altitude from an elevation edit failed", e);
  }
}

/**
 * `preCreateToken` hook: a new token stands on the ground under it. With an
 * altitude flag (a pasted flyer) it keeps that altitude over the new ground;
 * without one, an elevation above the ground is taken as its altitude.
 */
export function onPreCreateToken(doc, _data, options) {
  if (options?.dioSync) return;
  try {
    const src = doc?._source;
    // A new token stands on the Level it is created on.
    const live = src ? activeContext(doc.parent, tokenLevelId(doc)) : null;
    if (!live || !src) return;
    const altFlag = altitudeFlag(doc);
    let action;
    try { action = doc.movementAction; } catch { action = src.movementAction; }
    const p = planElevation({ elevation: src.elevation, action, altFlag, elevationChanged: altFlag === undefined,
      ground: groundFrom(live, src.x, src.y, src.width ?? 1, src.height ?? 1) });
    if (!p) return;
    const patch = {};
    if (p.writeElevation) patch.elevation = p.elevation;
    if (p.writeAltitude) globalThis.foundry.utils.setProperty(patch, ALTITUDE_PATH, p.altitude);
    doc.updateSource(patch);
  } catch (e) {
    err("Diorama: seating a new token failed", e);
  }
}

/**
 * The corrections a repaint needs, pure over its inputs: every token on a
 * Level in `levels` (all when null) re-seated on its OWN Level's ground.
 * @param {Iterable<object>} tokens
 * @param {(levelId:string|null) => object|null} liveOf  a Level's live terrain
 * @param {{old?: Map<string, object>|object|null, levels?: Set<string>|null}} [o]
 *   old: terrain before the repaint (per Level id, or one for every Level)
 */
export function planResync(tokens, liveOf, { old = null, levels = null } = {}) {
  const plans = [];
  for (const doc of tokens ?? []) {
    if (doc.movement?.state === "pending") continue;
    const live = liveOf(tokenLevelId(doc));
    if (!live || (levels && !levels.has(live.levelId))) continue;
    const before = old instanceof Map ? old.get(live.levelId) : old;
    const src = doc._source ?? doc;
    const fallbackGround = before
      ? groundFrom({ terrain: before, grid: live.grid, base: live.base }, src.x, src.y, src.width ?? 1, src.height ?? 1)
      : undefined;
    const p = planToken(doc, live, { fallbackGround });
    if (p) plans.push(p);
  }
  return plans;
}

/**
 * Re-seat the tokens of a scene on repainted ground, in ONE batched update.
 * @param {Scene} scene
 * @param {Map<string, import("../terrain/model.mjs").Terrain>|import("../terrain/model.mjs").Terrain|null} [oldTerrain]
 *   terrain before the repaint, per Level id: used for tokens with no stored altitude
 * @param {{levels?: Set<string>|null}} [o]  only tokens on these Levels (null: all)
 */
export async function resyncScene(scene, oldTerrain = null, { levels = null } = {}) {
  if (!isActiveGM() || !scene) return;
  const plans = planResync(scene.tokens ?? [], (id) => anyContext(scene, id), { old: oldTerrain, levels });
  if (!plans.length) return;
  try {
    await scene.updateEmbeddedDocuments("Token", plans.map((p) => p.update), correctionOptions(plans));
  } catch (e) {
    err("Diorama: terrain resync failed", e);
  }
}
