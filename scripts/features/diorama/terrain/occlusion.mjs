/**
 * Diorama — height occlusion, pure.
 *
 * Two questions, answered from the height field alone:
 *
 *   1. CLIFF EDGES for a viewer whose eye is at `eyeQ`: the outline of every
 *      region of ground standing above that eye. The sight / light polygon
 *      backend adds these as ordinary edges, so the 2D canvas and the 3D view
 *      draw the same visible area. A 2D polygon cannot express "dead ground"
 *      below a lip, so this is the plan-view half of the answer.
 *
 *   2. A 3D RAY over the height field: does the ground rise above the segment
 *      from A to B anywhere between them? Token detection (is that creature
 *      visible?) and cover use this, because they have real target heights.
 *
 * Coordinates here are SUB-CELL units (u = px / gridSize · SUB, v likewise)
 * and heights are q. Pure: no Foundry, no DOM.
 */

import { SUB, KIND, DIR } from "../constants.mjs";

const EPS = 0.01;

/**
 * Outline of the ground standing above `eyeQ`, as merged axis-aligned
 * segments in px. The mask only changes at whole q, so callers cache on
 * `Math.floor(eyeQ)`.
 *
 * A flight of stairs or a ramp is open at its foot. Seen from below along its
 * descent, nothing on it rises above the line from the eye to someone standing
 * higher up it, so the whole flight is in view however high it climbs. Its
 * flanks are still cliffs, and where it meets high ground that is not a slope
 * (the terrace it leads up to) the outline still runs, so the top stays hidden.
 * @param {import("./model.mjs").Terrain} t
 * @param {number} eyeQ
 * @param {number} gridSize   px per cell
 * @returns {Array<[number,number,number,number]>} [x0, y0, x1, y1] in px
 */
export function cliffEdges(t, eyeQ, gridSize) {
  const sw = t.sw, sh = t.sh;
  const above = new Uint8Array(sw * sh);
  // per sub-cell: 0 not a slope, else 1 + the direction it descends (DIR)
  const slope = new Uint8Array(sw * sh);
  let any = false;
  for (let si = 0; si < sh; si++) {
    for (let sj = 0; sj < sw; sj++) {
      const k = si * sw + sj;
      const kind = t.kind[k] & 0x0f;
      if (kind === KIND.VOID) continue;
      if (kind === KIND.STAIRS || kind === KIND.RAMP) slope[k] = 1 + ((t.kind[k] >> 4) & 0x03);
      if (t.h[k] > eyeQ) { above[k] = 1; any = true; }
    }
  }
  if (!any) return [];
  const at = (si, sj) => (si >= 0 && sj >= 0 && si < sh && sj < sw ? si * sw + sj : -1);
  /** Is there an outline between sub-cells a and b? aToB / bToA: the DIR from one to the other. */
  const cut = (a, b, aToB, bToA) => {
    const ua = a >= 0 ? above[a] : 0, ub = b >= 0 ? above[b] : 0;
    const sa = a >= 0 ? slope[a] : 0, sb = b >= 0 ? slope[b] : 0;
    if (ua && ub) return !sa !== !sb;    // a flight against the high ground it climbs to
    if (ua) return sa !== 1 + aToB;      // open where a flight comes down
    if (ub) return sb !== 1 + bToA;
    return false;
  };
  const s = gridSize / SUB;
  const out = [];
  // Horizontal boundaries: between row si-1 and si, along sub-columns.
  for (let si = 0; si <= sh; si++) {
    let start = -1;
    for (let sj = 0; sj <= sw; sj++) {
      const edge = sj < sw && cut(at(si - 1, sj), at(si, sj), DIR.S, DIR.N);
      if (edge && start < 0) start = sj;
      if (!edge && start >= 0) { out.push([start * s, si * s, sj * s, si * s]); start = -1; }
    }
  }
  // Vertical boundaries: between column sj-1 and sj, along sub-rows.
  for (let sj = 0; sj <= sw; sj++) {
    let start = -1;
    for (let si = 0; si <= sh; si++) {
      const edge = si < sh && cut(at(si, sj - 1), at(si, sj), DIR.E, DIR.W);
      if (edge && start < 0) start = si;
      if (!edge && start >= 0) { out.push([sj * s, start * s, sj * s, si * s]); start = -1; }
    }
  }
  return out;
}

/**
 * March a 3D segment across the height field.
 * @param {import("./model.mjs").Terrain} t
 * @param {{u:number, v:number, z:number}} a   start, sub-cell units + q
 * @param {{u:number, v:number, z:number}} b   end
 * @returns {number|null} the parameter t ∈ (0,1) where the ground first rises
 *   above the segment, or null when the segment is clear
 */
export function rayBlocked(t, a, b) {
  const du = b.u - a.u, dv = b.v - a.v, dz = b.z - a.z;
  let cu = Math.floor(a.u), cv = Math.floor(a.v);
  const eu = Math.floor(b.u), ev = Math.floor(b.v);
  const stepU = du > 0 ? 1 : du < 0 ? -1 : 0;
  const stepV = dv > 0 ? 1 : dv < 0 ? -1 : 0;
  const tDeltaU = stepU ? Math.abs(1 / du) : Infinity;
  const tDeltaV = stepV ? Math.abs(1 / dv) : Infinity;
  let tMaxU = stepU ? ((stepU > 0 ? cu + 1 - a.u : a.u - cu) * tDeltaU) : Infinity;
  let tMaxV = stepV ? ((stepV > 0 ? cv + 1 - a.v : a.v - cv) * tDeltaV) : Infinity;
  let t0 = 0;
  const guard = Math.abs(eu - cu) + Math.abs(ev - cv) + 4;
  for (let n = 0; n < guard; n++) {
    const t1 = Math.min(1, tMaxU, tMaxV);
    const atEnd = cu === eu && cv === ev;
    const atStart = n === 0;
    // Endpoint cells never block: a creature's own square and its target's.
    if (!atStart && !atEnd && !t.isVoid(cv, cu)) {
      const zMin = Math.min(a.z + dz * t0, a.z + dz * t1);
      if (t.topAt(cv, cu) > zMin + EPS) return Math.max(EPS, t0);
    }
    if (atEnd || t1 >= 1) return null;
    if (tMaxU < tMaxV) { cu += stepU; t0 = tMaxU; tMaxU += tDeltaU; }
    else { cv += stepV; t0 = tMaxV; tMaxV += tDeltaV; }
  }
  return null;
}

/** px + q → sub-cell ray point. */
export function rayPoint(x, y, zQ, gridSize) {
  return { u: (x / gridSize) * SUB, v: (y / gridSize) * SUB, z: zQ };
}

/**
 * Cover the terrain gives a target against an attacker.
 * Rays go from the attacker's eye to five points on the target: feet, middle,
 * head, and the middle of each flank. Shown only, never applied.
 * @param {import("./model.mjs").Terrain} t
 * @param {{x:number,y:number,eyeQ:number}} from   px + q
 * @param {{x:number,y:number,footQ:number,heightQ:number,radiusPx:number}} to
 * @param {number} gridSize
 * @returns {{blocked:number, total:number, cover:"none"|"standard"|"greater", lineOfSight:boolean}}
 */
export function coverBetween(t, from, to, gridSize) {
  const A = rayPoint(from.x, from.y, from.eyeQ, gridSize);
  const dx = to.x - from.x, dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const px = (-dy / len) * to.radiusPx * 0.7, py = (dx / len) * to.radiusPx * 0.7;
  const mid = to.footQ + to.heightQ * 0.5;
  const targets = [
    [to.x, to.y, to.footQ + to.heightQ * 0.1],
    [to.x, to.y, mid],
    [to.x, to.y, to.footQ + to.heightQ * 0.95],
    [to.x + px, to.y + py, mid],
    [to.x - px, to.y - py, mid],
  ];
  let blocked = 0;
  for (const [x, y, z] of targets) if (rayBlocked(t, A, rayPoint(x, y, z, gridSize)) !== null) blocked++;
  const total = targets.length;
  const lineOfSight = blocked < total;
  const frac = blocked / total;
  const cover = !lineOfSight ? "greater" : frac >= 0.6 ? "greater" : frac > 0 ? "standard" : "none";
  return { blocked, total, cover, lineOfSight };
}
