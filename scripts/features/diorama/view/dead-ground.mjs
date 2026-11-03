/**
 * Diorama view — dead ground.
 *
 * The sight polygon cuts only ground that rises above the eye
 * (foundry/sight-backend.mjs) and drops every wall whose top is below the eye,
 * so the floor at the foot of a block, below a ledge the viewer stands on, or
 * just behind a low wall it looks over is inside it: the 2D map shows it, yet
 * nobody could see that floor. In 3D that reads as lit floor. This finds those
 * patches by asking whether the floor itself is seen: a ray from each token
 * viewer's eye to just above the ground (GROUND_LIFT), marched past the
 * terrain and past every low wall it passes under. A patch no viewer sees that
 * way is dead ground; the bake dims it to remembered (view/bake.mjs). The 2D
 * map is unchanged.
 *
 * The floor test needs no creature size. Raising a ray's far end raises every
 * point of it, so floor that is seen means every creature standing there is
 * seen past the terrain, whatever its size; a tall one on dead ground can still
 * show over the lip, as it does in 2D.
 *
 * Pure: it reads only the terrain, the walls and the viewers' polygons.
 */

import { SUB, SIZE_HEIGHT } from "../constants.mjs";
import { TARGET_SAMPLES } from "../foundry/sight-backend.mjs";
import { rayBlocked, rayPoint } from "../terrain/occlusion.mjs";
import { distToQ } from "../terrain/model.mjs";
import { blocksSightWall } from "../terrain/wall-top.mjs";

/** How far above the ground the floor is tested (distance units): the lowest feet any creature has. */
export const GROUND_LIFT = TARGET_SAMPLES[0] * SIZE_HEIGHT.tiny;

const _maxTop = new WeakMap();
function maxTop(terrain) {
  let m = _maxTop.get(terrain);
  if (m !== undefined) return m;
  m = -Infinity;
  for (let si = 0; si < terrain.sh; si++) for (let sj = 0; sj < terrain.sw; sj++) {
    if (!terrain.isVoid(si, sj)) m = Math.max(m, terrain.topAt(si, sj));
  }
  _maxTop.set(terrain, m);
  return m;
}

const bounds = (poly) => { try { return poly?.getBounds?.() ?? null; } catch { return null; } };
const inside = (poly, x, y) => { try { return !!poly?.contains?.(x, y); } catch { return false; } };

/** Where a segment crosses another, as t along the first, or null. */
function crossT(ax, ay, bx, by, cx, cy, dx, dy) {
  const rx = bx - ax, ry = by - ay, sx = dx - cx, sy = dy - cy;
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-9) return null;
  const qx = cx - ax, qy = cy - ay;
  const t = (qx * sy - qy * sx) / den, u = (qx * ry - qy * rx) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : null;
}

/**
 * The sub-cells of floor the viewers' polygons show and no viewer sees.
 * @param {object} o
 * @param {import("../terrain/model.mjs").Terrain} o.terrain  the view's absolute terrain
 * @param {{size:number, distance:number}} o.grid
 * @param {Array<{eye:number|null, origin:{x:number,y:number}, fov?:object, los?:object, blinded?:boolean}>} o.viewers
 *   what the bake drew: `eye` in q (null: not a token, so never tested and always seeing)
 * @param {object[]} [o.walls]  WallState[] in the terrain's frame (baseQ/topQ in q)
 * @param {(x:number, y:number) => boolean} [o.lit]
 * @returns {Array<[number, number]>} [si, sj]
 */
export function deadGround({ terrain, grid, viewers = [], walls = [], lit = () => false }) {
  const out = [];
  if (!terrain || !(grid?.size > 0) || !viewers.length) return out;
  const top = maxTop(terrain);
  const step = grid.size / SUB;
  const liftQ = distToQ(GROUND_LIFT, grid.distance);
  const covers = (v, x, y) => inside(v.fov, x, y) || (!v.blinded && inside(v.los, x, y) && lit(x, y));
  // The walls a viewer's polygon dropped because its eye is above their tops:
  // only those can stand between it and floor its polygon shows.
  const low = (Array.isArray(walls) ? walls : []).filter((w) => blocksSightWall(w) && Number.isFinite(w.topQ))
    .map((w) => ({ ax: +w.a[0], ay: +w.a[1], bx: +w.b[0], by: +w.b[1], topQ: +w.topQ }));
  const prepared = viewers.map((v) => ({
    ...v,
    walls: Number.isFinite(v.eye) ? low.filter((w) => v.eye > w.topQ) : [],
    from: v.origin ? rayPoint(v.origin.x, v.origin.y, v.eye, grid.size) : null,
  }));
  // A wall running through the patch itself stands at its edge, not in front of it.
  const near = step / 2;
  const underWall = (v, x, y, zQ) => v.walls.some((w) => {
    const t = crossT(v.origin.x, v.origin.y, x, y, w.ax, w.ay, w.bx, w.by);
    if (t === null || (1 - t) * Math.hypot(x - v.origin.x, y - v.origin.y) < near) return false;
    return v.eye + (zQ - v.eye) * t < w.topQ;
  });
  // Only the sub-cells some polygon can reach.
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const v of viewers) {
    for (const b of [bounds(v.fov), v.blinded ? null : bounds(v.los)]) {
      if (!b) continue;
      x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y);
      x1 = Math.max(x1, b.x + b.width); y1 = Math.max(y1, b.y + b.height);
    }
  }
  if (!(x1 > x0 && y1 > y0)) return out;
  const j0 = Math.max(0, Math.floor(x0 / step)), j1 = Math.min(terrain.sw - 1, Math.ceil(x1 / step));
  const i0 = Math.max(0, Math.floor(y0 / step)), i1 = Math.min(terrain.sh - 1, Math.ceil(y1 / step));
  for (let si = i0; si <= i1; si++) {
    for (let sj = j0; sj <= j1; sj++) {
      if (terrain.isVoid(si, sj)) continue;
      const x = (sj + 0.5) * step, y = (si + 0.5) * step;
      const by = prepared.filter((v) => covers(v, x, y));
      if (!by.length) continue;
      const zQ = terrain.topAt(si, sj) + liftQ;
      const seen = by.some((v) => {
        if (!Number.isFinite(v.eye) || !v.from) return true;
        if (underWall(v, x, y, zQ)) return false;
        // Nothing on the map stands above both ends of the ray: clear.
        if (top <= Math.min(v.eye, zQ)) return true;
        return rayBlocked(terrain, v.from, rayPoint(x, y, zQ, grid.size)) === null;
      });
      if (!seen) out.push([si, sj]);
    }
  }
  return out;
}
