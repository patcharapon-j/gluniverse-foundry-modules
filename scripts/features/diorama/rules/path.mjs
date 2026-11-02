/**
 * Diorama — path analysis, pure.
 *
 * Walks a grid path over the height field and says where it climbs and where
 * it falls. The movement wrapper, the 3D path preview and the readouts all
 * read the same answer from here, because they all ask `Terrain#step`.
 *
 * Nothing is applied: a fall is a hint, a climb is a mark (and Infinity cost
 * for walking, which foundry/movement.mjs decides with `isGroundAction`).
 */

import { KIND } from "../constants.mjs";
import { qToDist } from "../terrain/model.mjs";

/**
 * Movement actions that follow the ground and cannot walk up a cliff.
 * Core's `walk` and `crawl`, plus PF2e's `travel`, `drive` and `deploy`.
 * Foundry deletes `terrainAction` from the action configs after init, so
 * foundry/movement.mjs snapshots the actions whose terrainAction was "walk"
 * and passes them in as `extra`.
 */
export const GROUND_ACTIONS = Object.freeze(["walk", "crawl", "travel", "drive", "deploy"]);

/**
 * Is this a movement action a cliff stops? Climb is allowed (at its own cost),
 * and fly / burrow / swim / jump / teleports are not ground-bound here.
 * @param {string} action
 * @param {Iterable<string>} [extra]  more ground-bound action keys
 */
export function isGroundAction(action, extra = null) {
  if (!action || action === "climb") return false;
  if (GROUND_ACTIONS.includes(action)) return true;
  if (extra) for (const a of extra) if (a === action) return true;
  return false;
}

/**
 * @param {import("../terrain/model.mjs").Terrain} terrain
 * @param {Array<{i:number, j:number}>} cells  in order; the first is the start
 * @param {{distance:number}} grid
 * @returns {{
 *   steps: Array<{i:number, j:number, rise:number, climb:boolean, fall:boolean, drop:number, riseDist:number, dropDist:number}>,
 *   climbs: Array<{i:number, j:number, riseDist:number}>,
 *   falls: Array<{i:number, j:number, dropDist:number, intoWater:boolean}>
 * }}  rise / drop in q; the *Dist fields in distance units. One step per
 *     transition, keyed by the cell it arrives at.
 */
export function analyzePath(terrain, cells, grid) {
  const steps = [];
  const climbs = [];
  const falls = [];
  const d = grid?.distance || 5;
  const list = Array.isArray(cells) ? cells : [];
  for (let k = 1; k < list.length; k++) {
    const a = list[k - 1], b = list[k];
    if (!a || !b) continue;
    if (a.i === b.i && a.j === b.j) continue;
    const s = terrain.step(a.i, a.j, b.i, b.j);
    const riseDist = qToDist(Math.max(0, s.rise), d);
    const dropDist = qToDist(s.drop, d);
    steps.push({ i: b.i, j: b.j, rise: s.rise, climb: s.climb, fall: s.fall, drop: s.drop, riseDist, dropDist });
    if (s.climb) climbs.push({ i: b.i, j: b.j, riseDist });
    if (s.fall) falls.push({ i: b.i, j: b.j, dropDist, intoWater: terrain.cellHasKind(b.i, b.j, KIND.WATER) });
  }
  return { steps, climbs, falls };
}
