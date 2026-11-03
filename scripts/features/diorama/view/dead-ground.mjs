/**
 * Diorama view — dead ground.
 *
 * The sight polygon cuts only ground that rises above the eye
 * (foundry/sight-backend.mjs), so the floor at the foot of a block, or below a
 * ledge the viewer stands on, is inside it: the 2D map shows it, and a creature
 * standing there is still hidden by the 3D test (testLOSWrapper). In 3D that
 * reads as lit floor nobody could see. This finds those patches the same way a
 * creature is found: a medium creature standing on the ground there, its feet,
 * middle and head marched in 3D against the terrain from each viewer's eye. A
 * patch no viewer would see that way is dead ground; the bake dims it to
 * remembered (view/bake.mjs). The 2D map is unchanged.
 *
 * Pure: it reads only the terrain and the viewers' polygons.
 */

import { SUB, SIZE_HEIGHT } from "../constants.mjs";
import { clearSampleHeights } from "../foundry/sight-backend.mjs";
import { distToQ } from "../terrain/model.mjs";

/** The creature a patch of ground is tested with (distance units). */
export const DEAD_GROUND_HEIGHT = SIZE_HEIGHT.med;

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

/**
 * The sub-cells of ground the viewers' polygons show and no viewer would see a
 * creature standing on.
 * @param {object} o
 * @param {import("../terrain/model.mjs").Terrain} o.terrain  the view's absolute terrain
 * @param {{size:number, distance:number}} o.grid
 * @param {Array<{eye:number|null, origin:{x:number,y:number}, fov?:object, los?:object, blinded?:boolean}>} o.viewers
 *   what the bake drew: `eye` in q (null: not a token, so never tested and always seeing)
 * @param {(x:number, y:number) => boolean} [o.lit]
 * @returns {Array<[number, number]>} [si, sj]
 */
export function deadGround({ terrain, grid, viewers = [], lit = () => false }) {
  const out = [];
  if (!terrain || !(grid?.size > 0) || !viewers.length) return out;
  const top = maxTop(terrain);
  const step = grid.size / SUB;
  const covers = (v, x, y) => inside(v.fov, x, y) || (!v.blinded && inside(v.los, x, y) && lit(x, y));
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
  const live = { terrain, grid };
  const height = DEAD_GROUND_HEIGHT;
  const heightQ = distToQ(height, grid.distance);
  for (let si = i0; si <= i1; si++) {
    for (let sj = j0; sj <= j1; sj++) {
      if (terrain.isVoid(si, sj)) continue;
      const x = (sj + 0.5) * step, y = (si + 0.5) * step;
      const by = viewers.filter((v) => covers(v, x, y));
      if (!by.length) continue;
      const footQ = terrain.topAt(si, sj);
      const foot = (footQ / distToQ(1, grid.distance));
      const seen = by.some((v) => {
        if (!Number.isFinite(v.eye)) return true;
        // Nothing on the map stands above both ends of the lowest ray: clear.
        if (top <= Math.min(v.eye, footQ + 0.1 * heightQ)) return true;
        return clearSampleHeights(live, v.eye, v.origin, { x, y }, foot, height).length > 0;
      });
      if (!seen) out.push([si, sj]);
    }
  }
  return out;
}
