/**
 * Diorama — creature height, pure.
 *
 * How tall a creature stands, and where its eye is. The sight backend, cover
 * and the 3D view all ask here, so one creature has one height everywhere.
 *
 *   1. The actor flag `dio.height` (distance units), when a GM set one.
 *   2. A size key on the actor (`system.traits.size.value`: PF2e, and any
 *      system that shares its keys).
 *   3. The token's footprint (Daggerheart and every other system).
 *   4. Medium (6 ft).
 *
 * Pure: takes the documents it is handed and reads no globals.
 */

import { SUITE_ID } from "../../../core/const.mjs";
import { SIZE_HEIGHT, EYE_FRACTION, FLAG_CREATURE_HEIGHT } from "../constants.mjs";
import { distToQ } from "../terrain/model.mjs";

const MEDIUM = SIZE_HEIGHT.med;

const positive = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** Height in distance units for a size key; unknown keys read as Medium. */
export function heightForSize(sizeKey) {
  const k = String(sizeKey ?? "").toLowerCase();
  return Object.prototype.hasOwnProperty.call(SIZE_HEIGHT, k) ? SIZE_HEIGHT[k] : MEDIUM;
}

/** Size key a token footprint (in grid squares) stands for. */
export function sizeForFootprint(widthCells, heightCells = widthCells) {
  const w = Math.max(Number(widthCells) || 1, Number(heightCells) || 1);
  if (w < 1) return "tiny";
  if (w <= 1) return "med";
  if (w <= 2) return "lg";
  if (w <= 3) return "huge";
  return "grg";
}

function flagHeight(actor) {
  if (!actor) return null;
  let v;
  try { v = actor.getFlag?.(SUITE_ID, FLAG_CREATURE_HEIGHT); } catch { v = undefined; }
  if (v === undefined) {
    // Plain objects (fixtures, snapshots): the flag key is a dotted path.
    const scope = actor.flags?.[SUITE_ID];
    v = scope?.[FLAG_CREATURE_HEIGHT] ?? scope?.dio?.height;
  }
  return positive(v);
}

/**
 * A creature's height in distance units.
 * @param {object|null} actor
 * @param {object|null} [tokenDoc]
 */
export function creatureHeightDist(actor, tokenDoc = null) {
  const a = actor ?? tokenDoc?.actor ?? null;
  const flagged = flagHeight(a);
  if (flagged !== null) return flagged;
  const size = a?.system?.traits?.size?.value;
  if (typeof size === "string" && Object.prototype.hasOwnProperty.call(SIZE_HEIGHT, size.toLowerCase())) {
    return SIZE_HEIGHT[size.toLowerCase()];
  }
  if (tokenDoc && (tokenDoc.width !== undefined || tokenDoc.height !== undefined)) {
    return heightForSize(sizeForFootprint(tokenDoc.width, tokenDoc.height));
  }
  return MEDIUM;
}

/**
 * The eye of a token, in q: its elevation (its feet) plus EYE_FRACTION of its
 * height. Uses the prepared elevation, which follows a token's animation.
 * @param {object} tokenDoc
 * @param {{distance:number}} grid
 */
export function eyeQ(tokenDoc, grid) {
  const feet = Number(tokenDoc?.elevation) || 0;
  const h = creatureHeightDist(tokenDoc?.actor ?? null, tokenDoc);
  return distToQ(feet + EYE_FRACTION * h, grid?.distance || 5);
}
