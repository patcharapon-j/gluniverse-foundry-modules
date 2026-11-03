/**
 * Diorama view — the props a viewer sees in 3D though the ground under them is
 * hidden.
 *
 * The sight polygon hides ground more than SIGHT_REVEAL_DIST above the eye
 * (foundry/sight-backend.mjs), and the vision bake hides whatever stands on it
 * with it. That is right for the ground and wrong for a tree on a cliff's top:
 * from the cliff's foot its crown is in plain view. A token standing there is
 * asked about in 3D at its feet, middle and head (testLOSWrapper); a prop is
 * asked the same way here (columnSeen), and drawn (render/props.mjs setSeen)
 * when any viewer sees any of it. The ground under it stays hidden.
 *
 *   propsSeen({ props, grid, hidden, viewers }) → Set<propId>        pure
 *     props    PropState[] (cells): id, x, y, base, h, ghost, shape
 *     hidden   (xPx, yPx) → true where the bake does not see the ground now
 *     viewers  [{ sees({x, y} px, foot, height) → boolean }], distance units
 *
 * Pure above `bakeViewers`; the adapters below it read Foundry.
 */

import { columnSeen } from "../foundry/sight-backend.mjs";
import { eyeQ } from "../rules/creature.mjs";

/** Props that are ground, not things standing on it: hidden with the ground. */
const GROUND_SHAPES = new Set(["slab"]);

/** @returns {Set<string>} */
export function propsSeen({ props = [], grid, hidden, viewers = [] }) {
  const out = new Set();
  if (!grid?.size || !viewers.length || typeof hidden !== "function") return out;
  const dist = Number(grid.distance) || 5;
  for (const s of props) {
    if (!s || s.id === undefined || s.ghost || GROUND_SHAPES.has(s.shape)) continue;
    const x = Number(s.x) * grid.size, y = Number(s.y) * grid.size;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !hidden(x, y)) continue;
    const foot = (Number(s.base) || 0) * dist;
    const height = Math.max(0.05, Number(s.h) || 1) * dist;
    if (viewers.some((v) => v.sees({ x, y }, foot, height))) out.add(s.id);
  }
  return out;
}

/**
 * Outside a vision cone: Foundry's own test (DetectionMode._testCollision),
 * which a polygon's testCollision does not make. Within the external radius
 * every direction counts.
 * @param {{angle?:number, rotation?:number, externalRadius?:number}} cfg
 */
export function outsideCone(cfg, origin, p) {
  const { angle = 360, rotation = 0, externalRadius = 0 } = cfg ?? {};
  if (!(angle < 360)) return false;
  const dx = p.x - origin.x, dy = p.y - origin.y;
  if (dx * dx + dy * dy <= externalRadius * externalRadius) return false;
  if (angle <= 0) return true;
  const aMin = rotation + 90 - angle / 2;
  const a = (Math.atan2(dy, dx) * 180) / Math.PI;
  return ((((a - aMin) % 360) + 360) % 360) > angle;
}

/** Where the vision bake does not see the ground now (R under half). */
export function bakeHidden(vision, scale) {
  const ctx = vision?.getContext?.("2d", { willReadFrequently: true });
  if (!ctx || !(scale > 0)) return null;
  return (x, y) => {
    try { return ctx.getImageData(Math.floor(x * scale), Math.floor(y * scale), 1, 1).data[0] < 128; } catch { return false; }
  };
}

/**
 * The bake's viewers (view/bake.mjs) as `sees` tests: in sight range, or lit and
 * in light-perception range, inside the vision cone, and in clear 3D line past
 * the ground and the walls.
 * @param {{viewers?:object[], lit?:(x:number,y:number)=>boolean}} baker
 * @param {{terrain:object, grid:object}} live  the view's absolute terrain
 */
export function bakeViewers(baker, live) {
  const Backend = globalThis.CONFIG?.Canvas?.polygonBackends?.sight;
  if (typeof Backend?.testCollision !== "function" || !live?.terrain || !live?.grid) return [];
  const out = [];
  for (const v of baker?.viewers ?? []) {
    const o = v.origin;
    if (!o || !v.doc) continue;
    let eye;
    try { eye = eyeQ(v.doc, live.grid); } catch { continue; }
    if (!Number.isFinite(eye)) continue;
    const cfg = { ...(v.los?.config ?? {}) };
    delete cfg.boundingBox;
    delete cfg.boundaryShapes;
    const from = { x: o.x, y: o.y, elevation: Number(o.elevation) || 0 };
    out.push({
      sees: (p, foot, height) => {
        const d = Math.hypot(p.x - o.x, p.y - o.y);
        if (!(d <= v.range || (d <= v.lightRange && baker.lit?.(p.x, p.y)))) return false;
        if (outsideCone(cfg, o, p)) return false;
        return columnSeen(live, eye, from, p, foot, height, (elevation) => {
          try { return !!Backend.testCollision(from, { x: p.x, y: p.y, elevation }, { ...cfg, type: "sight", mode: "any" }); } catch { return true; }
        });
      },
    });
  }
  return out;
}
