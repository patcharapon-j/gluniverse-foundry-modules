/**
 * Diorama — how tall a wall stands.
 *
 * One statement for everything that asks: the 3D view draws a wall up to this
 * top, the sight and light backend lets an eye above it see over it, and the
 * cover line passes over it. A wall stands on the highest ground either side of
 * it and rises the terrain's wall height above that, unless the Wall Height
 * module gave it a top of its own (an absolute elevation).
 *
 * Pure: no `game`, `canvas` or `foundry`.
 */

import { distToQ } from "./model.mjs";

const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);

/**
 * Ground under a wall, in q: the highest ground either side of it, sampled at
 * three points along it a quarter cell out on both sides.
 */
export function groundUnderWall(terrain, x0, y0, x1, y1, size) {
  if (!terrain) return 0;
  const dx = x1 - x0, dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  const nx = (-dy / len) * size * 0.25, ny = (dx / len) * size * 0.25;
  let top = -Infinity;
  for (const f of [0.25, 0.5, 0.75]) {
    const x = x0 + dx * f, y = y0 + dy * f;
    top = Math.max(top, terrain.groundAt(x + nx, y + ny, size), terrain.groundAt(x - nx, y - ny, size));
  }
  return Number.isFinite(top) ? top : 0;
}

/**
 * The Wall document behind a Foundry edge, or null (scene bounds, cliffs,
 * another module's edges). v14 hands the document itself as `edge.object`.
 */
export function wallDocOf(edge) {
  const o = edge?.object;
  if (o?.documentName === "Wall") return o;
  if (o?.document?.documentName === "Wall") return o.document;
  return null;
}

/** Does this WallState (view/snapshot.mjs) stop sight? Windows and terrain walls do not here. */
export function blocksSightWall(w) {
  if (!w?.a || !w?.b) return false;
  if (w.type === "wall") return true;
  return (w.type === "door" || w.type === "secret") && w.door !== "open";
}

/**
 * Can a mover get past a wall it crosses? Only when its feet where it crosses
 * are within a step of the top: a low rail stepped over, or flying above it.
 * Climbing does not pass a wall: anyone may pick Climb, and a room wall has no
 * ceiling above it here, so every wall in a dungeon would open.
 * @param {number|null} topQ  the wall's top; null is a wall with no top
 * @param {number} feetQ  the mover's feet where it crosses
 * @param {number} stepQ  the terrain's step height
 */
export function movesOverWall(topQ, feetQ, stepQ) {
  if (!Number.isFinite(topQ) || !Number.isFinite(feetQ)) return false;
  return feetQ + Math.max(0, Number(stepQ) || 0) >= topQ;
}

/**
 * A wall's foot and top in q, in the terrain's own frame.
 * @param {{c:number[], flags?:object}} doc  a Wall document (or its data)
 * @param {object|null} terrain
 * @param {number} size  grid px
 * @param {number} distance  distance units per grid square
 * @param {number} [levelBaseQ=0]  the Level's base, taken off an absolute Wall Height top
 * @returns {{baseQ:number, topQ:number}|null}  null for a malformed wall
 */
export function wallSpanQ(doc, terrain, size, distance, levelBaseQ = 0) {
  const c = Array.isArray(doc?.c) ? doc.c.map(Number) : [];
  if (c.length < 4 || !c.slice(0, 4).every(Number.isFinite)) return null;
  const baseQ = groundUnderWall(terrain, c[0], c[1], c[2], c[3], size);
  let topQ = baseQ + Math.max(1, num(terrain?.wallHeight, 8));
  const wh = doc.flags?.["wall-height"];
  if (wh && wh.top !== null && wh.top !== undefined && wh.top !== "") {
    const top = Number(wh.top);
    if (Number.isFinite(top)) topQ = Math.max(baseQ + 1, Math.round(distToQ(top, distance)) - levelBaseQ);
  }
  return { baseQ, topQ };
}
