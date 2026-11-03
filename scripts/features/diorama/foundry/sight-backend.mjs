/**
 * Diorama — the height-aware sight and light polygon backend.
 *
 * Two halves, both answering "does the ground hide this?":
 *
 *   POLYGONS (`_identifyEdges`). For each sight or light source, the outline of
 *   all ground standing above that source's eye is added to the sweep as
 *   ordinary wall edges, so Foundry draws the hidden ground itself and the 2D
 *   canvas and the 3D view (which bakes these same polygons) agree by
 *   construction. ClockwiseSweepPolygon#_identifyEdges (clockwise-sweep.mjs
 *   L228) only collects edges; the sweep then reads `edge.intersections[level]`
 *   (L355), which Foundry precomputes for scene edges only, so the crossings
 *   between a cliff edge and everything else are recorded here on the clones.
 *
 *   POINT TESTS (`_testCollision`, L759). A collision test has a real
 *   destination height, so the 3D segment is marched over the height field
 *   instead, and the walls are tested WITHOUT the 2D cliff outline (which
 *   cannot express "a head above the lip").
 *
 * Token detection is the case that matters, and v14 does not reach the
 * backend for it: DetectionMode#_testLOS (detection-mode.mjs L161) answers a
 * same-Level test with `los.contains(point)`, the polygon, whose test points
 * all sit at the target's base elevation (TokenDocument#getVisibilityTestPoints,
 * documents/token.mjs L3364). So `_testLOS` is wrapped: the target's feet,
 * middle and head are marched in 3D, and the walls are tested through the
 * config route (`_testCollision(visionSource, test, config)`, the same call
 * Foundry makes at L168), which reaches this backend's `_testCollision` with
 * the cliffs left out.
 *
 * Imports cleanly under Node: every Foundry class is resolved inside a
 * function, never at module scope.
 */

import { warn } from "../../../core/const.mjs";
import { registerWrapper } from "../../../core/wrapper.mjs";
import { cliffEdges, rayBlocked, rayPoint } from "../terrain/occlusion.mjs";
import { distToQ } from "../terrain/model.mjs";
import { movesOverWall, wallDocOf, wallSpanQ } from "../terrain/wall-top.mjs";
import { creatureHeightDist, eyeQ } from "../rules/creature.mjs";
import { SIZE_HEIGHT } from "../constants.mjs";
import { wallContext, t } from "./context.mjs";
import { tokenLevelId } from "../terrain/levels.mjs";

/** A light sits at least this far above the ground under it (q). */
const LIGHT_LIFT_Q = 1;
/**
 * A sight polygon reveals ground where a medium creature standing on it would
 * be seen, not only ground whose floor the eye can see: its outline is the
 * ground more than this far (distance units) above the eye. Tokens are still
 * tested in 3D at their own feet, middle and head, so this reveals terrain,
 * never a creature. Lights keep the exact outline.
 */
export const SIGHT_REVEAL_DIST = SIZE_HEIGHT.med;
/** Where a target is sampled, as fractions of its height: feet, middle, head. */
export const TARGET_SAMPLES = Object.freeze([0.1, 0.5, 0.95]);

/** >0 while the detection wrapper has already done the 3D march itself. */
let _detecting = 0;

/* ------------------------------------------------------------------ */
/*  Eyes                                                               */
/* ------------------------------------------------------------------ */

const isTokenDoc = (d) => !!d && (d.documentName === "Token" || d.constructor?.documentName === "Token");

/**
 * The eye of a polygon's source in q, or null when this polygon type gets no
 * height edges (sound, move, darkness).
 * @param {{origin:{x:number,y:number,elevation?:number}, config:object}} poly
 * @param {{terrain:object, grid:{size:number, distance:number}}} live
 */
export function polygonEyeQ(poly, live) {
  const type = poly?.config?.type;
  if (type !== "sight" && type !== "light") return null;
  const { terrain, grid } = live;
  // Heights are in the Level's own frame: absolute elevations lose its base.
  const baseQ = Number(live.baseQ) || 0;
  // A token with no vision source (the GM's "view as players" sights every player
  // token, and Foundry gives a GM none for a token it has not selected) is named
  // by `dioToken`, so the eye is its own and not the origin's floor.
  const doc = poly.config.source?.object?.document ?? poly.config.dioToken;
  if (type === "sight" && isTokenDoc(doc)) return eyeQ(doc, grid) - baseQ;
  const o = poly.origin ?? {};
  const ground = terrain.groundAt(o.x ?? 0, o.y ?? 0, grid.size);
  const own = distToQ(Number(o.elevation) || 0, grid.distance) - baseQ;
  return Math.max(own, ground + LIGHT_LIFT_Q);
}

/**
 * The height (q) above which ground is outlined into a polygon, or null when
 * the polygon gets no height edges. Sight reveals SIGHT_REVEAL_DIST above the eye.
 */
export function outlineFloorQ(poly, live) {
  const eye = polygonEyeQ(poly, live);
  if (eye === null || !Number.isFinite(eye)) return null;
  const lift = poly.config.type === "sight" ? distToQ(SIGHT_REVEAL_DIST, live.grid.distance) : 0;
  return Math.floor(eye + lift);
}

/* ------------------------------------------------------------------ */
/*  Wall tops                                                          */
/* ------------------------------------------------------------------ */

/**
 * The top (q, the Level's frame) of the wall behind an edge, the one the 3D
 * view draws (terrain/wall-top.mjs), or null when the edge is not a wall
 * document's (scene bounds, cliffs, another module's edges): those always block.
 */
export function edgeWallTopQ(edge, live) {
  const doc = wallDocOf(edge);
  if (!doc) return null;
  return wallSpanQ(doc, live.terrain, live.grid.size, live.grid.distance, Number(live.baseQ) || 0)?.topQ ?? null;
}

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
 * Drop the wall edges an eye can see over. A polygon (no ray) drops a wall whose
 * top is below the eye; a point test drops one the 3D ray crosses above its top.
 * @param {Set<object>} edges  the polygon's edge set, edited in place
 * @param {{terrain:object, grid:object, baseQ?:number}} live
 * @param {number} eyeQ  Level frame
 * @param {{ax:number,ay:number,bx:number,by:number,zB:number}|null} [ray]
 * @returns {number} how many were dropped
 */
export function dropWallsSeenOver(edges, live, eyeQ, ray = null) {
  let n = 0;
  for (const e of [...edges]) {
    const top = edgeWallTopQ(e, live);
    if (top === null) continue;
    let over;
    if (!ray) over = eyeQ > top;
    else {
      const t = crossT(ray.ax, ray.ay, ray.bx, ray.by, e.a.x, e.a.y, e.b.x, e.b.y);
      over = t !== null && eyeQ + (ray.zB - eyeQ) * t > top;
    }
    if (over) { edges.delete(e); n++; }
  }
  return n;
}

/**
 * Drop the wall edges a move gets past (terrain/wall-top.mjs movesOverWall):
 * its feet where it crosses are within the terrain's step of the wall's top.
 * @param {Set<object>} edges  the polygon's edge set, edited in place
 * @param {{terrain:object, grid:object, baseQ?:number}} live
 * @param {{ax:number,ay:number,bx:number,by:number,fromQ:number,toQ:number}} move  feet in q, the Level's frame
 * @returns {number} how many were dropped
 */
export function dropWallsMovedOver(edges, live, move) {
  const stepQ = Number(live.terrain?.stepHeight) || 0;
  let n = 0;
  for (const e of [...edges]) {
    const top = edgeWallTopQ(e, live);
    if (top === null) continue;
    const t = crossT(move.ax, move.ay, move.bx, move.by, e.a.x, e.a.y, e.b.x, e.b.y);
    if (t === null) continue;
    if (movesOverWall(top, move.fromQ + (move.toQ - move.fromQ) * t, stepQ)) { edges.delete(e); n++; }
  }
  return n;
}

/**
 * A move collision test's feet, in q in the Level's frame. Foundry tests a move
 * from the token's movement origin, which sits half its depth above its feet
 * (TokenDocument#getMovementOrigin).
 */
export function moveFeetQ(elevation, tokenDoc, live) {
  const half = ((Number(tokenDoc?.depth) || Number(tokenDoc?.width) || 1) * live.grid.distance) / 2;
  return distToQ((Number(elevation) || 0) - half, live.grid.distance) - (Number(live.baseQ) || 0);
}

/* ------------------------------------------------------------------ */
/*  Cliff edges, cached per terrain per whole q                        */
/* ------------------------------------------------------------------ */

let _edgeCache = new WeakMap(); // Terrain → Map<floorQ, Edge[]>

/** Drop every cached cliff edge (terrain change, teardown). */
export function clearSightCache() { _edgeCache = new WeakMap(); }

function senses() {
  const S = globalThis.CONST?.EDGE_SENSE_TYPES;
  return { NONE: S?.NONE ?? 0, NORMAL: S?.NORMAL ?? 20 };
}

/**
 * The cliff outline above `floorQ` as Edge instances (shared, never mutated:
 * the sweep only ever touches clones).
 */
export function cliffEdgeObjects(terrain, floorQ, gridSize, Edge) {
  let byFloor = _edgeCache.get(terrain);
  if (!byFloor) { byFloor = new Map(); _edgeCache.set(terrain, byFloor); }
  let list = byFloor.get(floorQ);
  if (list) return list;
  const S = senses();
  list = cliffEdges(terrain, floorQ, gridSize).map(([x0, y0, x1, y1], k) => new Edge(
    { x: x0, y: y0 }, { x: x1, y: y1 },
    { id: `dio.cliff.${floorQ}.${k}`, type: "wall", sight: S.NORMAL, light: S.NORMAL,
      move: S.NONE, sound: S.NONE, darkness: S.NONE },
  ));
  byFloor.set(floorQ, list);
  return list;
}

function inBox(e, box) {
  if (!box) return true;
  const x0 = Math.min(e.a.x, e.b.x), x1 = Math.max(e.a.x, e.b.x);
  const y0 = Math.min(e.a.y, e.b.y), y1 = Math.max(e.a.y, e.b.y);
  return x1 >= box.x && x0 <= box.x + box.width && y1 >= box.y && y0 <= box.y + box.height;
}

/**
 * Record crossings between the added cliff clones and every other edge in the
 * set (including each other). Foundry only precomputes these for scene edges.
 */
export function recordCliffIntersections(edges, cliffs, levelId) {
  if (!cliffs.length) return;
  const isCliff = new Set(cliffs);
  const all = [...edges].sort((a, b) => (a.nw.x - b.nw.x) || (a.se.x - b.se.x));
  for (let i = 0; i < all.length; i++) {
    const e1 = all[i];
    const e1y0 = Math.min(e1.a.y, e1.b.y), e1y1 = Math.max(e1.a.y, e1.b.y);
    for (let j = i + 1; j < all.length; j++) {
      const e2 = all[j];
      if (e2.nw.x > e1.se.x) break;
      if (!isCliff.has(e1) && !isCliff.has(e2)) continue;
      if (Math.max(e2.a.y, e2.b.y) < e1y0 || Math.min(e2.a.y, e2.b.y) > e1y1) continue;
      e1.recordIntersections(e2, levelId);
    }
  }
}

/* ------------------------------------------------------------------ */
/*  The polygon class                                                  */
/* ------------------------------------------------------------------ */

/**
 * Build the subclass over any ClockwiseSweepPolygon-shaped base.
 * @param {typeof ClockwiseSweepPolygon} Base
 * @param {object} deps
 * @param {typeof Edge} deps.Edge
 * @param {() => typeof PolygonVertex} deps.Vertex
 * @param {(poly:object) => ({terrain:object, grid:object}|null)} deps.context
 */
export function createHeightSweepClass(Base, { Edge, Vertex, context }) {
  return class HeightSweepPolygon extends Base {
    /** True while a collision test runs: the 2D cliff outline stays out. */
    _dioNoCliffs = false;
    /** A point test's ray, for dropping the walls it passes over. */
    _dioRay = null;
    /** A move collision test's segment and feet, for dropping the walls it gets past. */
    _dioMove = null;

    /** @override */
    _identifyEdges() {
      super._identifyEdges();
      const live = context(this);
      if (!live) return;
      if (this._dioMove) { dropWallsMovedOver(this.edges, live, this._dioMove); return; }
      // An eye above a wall's top sees over it: the polygon by the eye, a point test by its ray.
      const eye = polygonEyeQ(this, live);
      if (eye !== null && Number.isFinite(eye)) {
        if (!this._dioNoCliffs) dropWallsSeenOver(this.edges, live, eye);
        else if (this._dioRay) dropWallsSeenOver(this.edges, live, eye, this._dioRay);
      }
      if (this._dioNoCliffs) return;
      const floorQ = outlineFloorQ(this, live);
      if (floorQ === null) return;
      const list = cliffEdgeObjects(live.terrain, floorQ, live.grid.size, Edge);
      if (!list.length) return;
      const box = this.config.boundingBox;
      const added = [];
      for (const e of list) {
        if (!inBox(e, box)) continue;
        if (!this._testEdgeInclusion(e, this._edgeTypes)) continue;
        const c = e.clone();
        this.edges.add(c);
        added.push(c);
      }
      recordCliffIntersections(this.edges, added, this.level?.id);
    }

    /** @override */
    _testCollision(ray, mode, destination, tMin, tMax) {
      this._dioNoCliffs = true;
      this._dioRay = null;
      this._dioMove = null;
      let hit = null;
      const live = context(this);
      if (live && tMin < tMax && this.config?.type === "move") {
        // A move gets past a wall its feet clear within a step (flying over, a low rail).
        const doc = this.config.source?.object?.document ?? null;
        this._dioMove = {
          ax: ray.A?.x ?? this.origin.x, ay: ray.A?.y ?? this.origin.y,
          bx: ray.B?.x ?? destination.x, by: ray.B?.y ?? destination.y,
          fromQ: moveFeetQ(this.origin.elevation, doc, live),
          toQ: moveFeetQ(destination?.elevation ?? this.origin.elevation, doc, live),
        };
      }
      else if (live && tMin < tMax) {
        const eye = polygonEyeQ(this, live);
        if (eye !== null && Number.isFinite(eye)) {
          const { terrain, grid } = live;
          const ox = ray.A?.x ?? this.origin.x, oy = ray.A?.y ?? this.origin.y;
          const bx = ray.B?.x ?? destination.x, by = ray.B?.y ?? destination.y;
          const zB = distToQ(Number(destination?.elevation ?? this.origin.elevation) || 0, grid.distance) - (Number(live.baseQ) || 0);
          // Walls this ray passes over are dropped when super collects the edges.
          this._dioRay = { ax: ox, ay: oy, bx, by, zB };
          // The detection wrapper has already marched the ground for this ray.
          if (!_detecting) {
            const at = (s) => rayPoint(ox + (bx - ox) * s, oy + (by - oy) * s, eye + (zB - eye) * s, grid.size);
            const s = rayBlocked(terrain, at(tMin), at(tMax));
            if (s !== null) {
              if (mode === "any") return true;
              const tt = tMin + s * (tMax - tMin);
              hit = { x: ox + (bx - ox) * tt, y: oy + (by - oy) * tt, t: tt };
            }
          }
        }
      }
      const res = super._testCollision(ray, mode, destination, tMin, tMax);
      if (!hit) return res;
      const V = Vertex();
      const v = new V(hit.x, hit.y, { distance: hit.t });
      if (mode === "closest") return (res && res._distance <= hit.t) ? res : v;
      const all = Array.isArray(res) ? res.slice() : [];
      all.push(v);
      all.sort((a, b) => a._distance - b._distance);
      return all;
    }
  };
}

/** The polygon's own Level (PointSourcePolygon#level, config.level ??= canvas.level). */
function defaultContext(poly) {
  let scene, level;
  try { scene = poly.scene; level = poly.level ?? poly.config?.level ?? null; } catch { return null; }
  // Flat saved terrain included: its ground adds nothing, but its walls have tops.
  return wallContext(scene, level?.id ?? level);
}

let _cls = null;

/** The installed subclass, built on first use (Foundry must be loaded). */
export function heightSweepClass() {
  if (_cls) return _cls;
  const G = foundry.canvas.geometry;
  _cls = createHeightSweepClass(G.ClockwiseSweepPolygon, {
    Edge: G.edges.Edge,
    Vertex: () => foundry.canvas.geometry.edges.PolygonVertex,
    context: defaultContext,
  });
  return _cls;
}

/* ------------------------------------------------------------------ */
/*  Token detection                                                    */
/* ------------------------------------------------------------------ */

/**
 * Does the ground hide every sampled height of a target from a vision source?
 * @returns {boolean} true when at least one sample is in clear 3D line
 */
export function targetInClearLine(live, eyeQv, from, point, footDist, heightDist) {
  return clearSampleHeights(live, eyeQv, from, point, footDist, heightDist).length > 0;
}

/**
 * The sampled heights of a target (distance units, the Level's frame) the
 * ground leaves in clear 3D line, feet first.
 */
export function clearSampleHeights(live, eyeQv, from, point, footDist, heightDist) {
  const { terrain, grid } = live;
  const A = rayPoint(from.x, from.y, eyeQv, grid.size);
  const out = [];
  for (const f of TARGET_SAMPLES) {
    const d = footDist + f * heightDist;
    if (rayBlocked(terrain, A, rayPoint(point.x, point.y, distToQ(d, grid.distance), grid.size)) === null) out.push(d);
  }
  return out;
}

/**
 * Does an eye see a column standing at a point (a prop), the way a token
 * standing there is seen (testLOSWrapper)? The ground is marched in 3D at the
 * column's feet, middle and top, and each height it leaves clear is one wall
 * ray (`collides`, the installed backend with the cliffs left out). The cliff
 * outline hides the ground the column stands on, never the column.
 * @param {{terrain:object, grid:object, base?:number}} live
 * @param {number} eye  q, the Level's frame
 * @param {{x:number,y:number}} from   px
 * @param {{x:number,y:number}} point  px
 * @param {number} foot    distance units, the Level's frame
 * @param {number} height  distance units
 * @param {(elevation:number) => boolean} collides  a wall stands between the eye and the point at this elevation
 * @returns {boolean}
 */
export function columnSeen(live, eye, from, point, foot, height, collides) {
  const clear = clearSampleHeights(live, eye, from, point, foot, height);
  if (!clear.length) return false;
  const base = Number(live.base) || 0;
  _detecting++;
  try { return clear.some((d) => !collides(base + d)); } finally { _detecting--; }
}

/** MIXED wrapper for DetectionMode#_testLOS. */
function testLOSWrapper(wrapped, visionSource, mode, target, test) {
  if (!this.walls) return wrapped(visionSource, mode, target, test);
  const tgt = target?.document;
  const src = visionSource?.object?.document;
  if (!isTokenDoc(tgt) || !isTokenDoc(src)) return wrapped(visionSource, mode, target, test);
  if (visionSource.level !== test.level) return wrapped(visionSource, mode, target, test);
  // Same Level (Foundry's own cross-Level test is left to Foundry): that Level's ground.
  const lvl = visionSource.level ?? test.level ?? null;
  const live = wallContext(src.parent, lvl?.id ?? lvl ?? tokenLevelId(src));
  if (!live || !visionSource.los) return wrapped(visionSource, mode, target, test);

  // Foundry caches only on its own angle-constrained branch; keep that.
  const cacheable = !(!this.angle && (visionSource.data.angle < 360));
  if (cacheable) {
    const c = test.los.get(visionSource);
    if (c !== undefined) return c;
  }
  let has = false;
  const eye = eyeQ(src, live.grid) - (Number(live.baseQ) || 0);
  const foot = (Number(tgt.elevation) || 0) - (Number(live.base) || 0);
  const h = creatureHeightDist(tgt.actor ?? null, tgt);
  const clear = clearSampleHeights(live, eye, visionSource.origin, test.point, foot, h);
  if (clear.length) {
    const cfg = { ...visionSource.los.config };
    delete cfg.boundingBox; // recomputed for the ray, not the whole LOS
    if (!this.angle) cfg.angle = 360;
    const base = Number(live.base) || 0;
    _detecting++;
    try {
      // Walls have a top, so each height the ground left clear is its own ray:
      // a low wall can hide the feet and not the head.
      for (const d of clear) {
        const point = { ...test.point, elevation: base + d };
        if (!this.constructor._testCollision(visionSource, { ...test, point }, cfg)) { has = true; break; }
      }
    } finally { _detecting--; }
  }
  if (cacheable) test.los.set(visionSource, has);
  return has;
}

/* ------------------------------------------------------------------ */
/*  Install                                                            */
/* ------------------------------------------------------------------ */

let _installed = false;
const _conflicts = [];

/** Backend types another module had already replaced (we stood down for those). */
export function backendConflicts() { return [..._conflicts]; }

/** Say which backends we stood down for. Called at ready, once i18n is loaded. */
export function reportBackendConflicts() {
  for (const type of _conflicts) {
    warn(t(type === "move" ? "GLDIO.rules.backendConflictMove" : "GLDIO.rules.backendConflict", { type }));
  }
}

/**
 * Install the backend for sight, light and movement, and the detection wrapper.
 * Movement uses it only for walls: a wall's top lets a move over it.
 * Stands down per type when another module already replaced Foundry's class.
 * @returns {string[]} the backend types installed
 */
export function installSightBackend() {
  if (_installed) return [];
  _installed = true;
  const base = foundry.canvas.geometry.ClockwiseSweepPolygon;
  const backends = CONFIG.Canvas.polygonBackends;
  const cls = heightSweepClass();
  const done = [];
  for (const type of ["sight", "light", "move"]) {
    if (backends[type] === base) {
      backends[type] = cls;
      done.push(type);
    } else if (backends[type] !== cls) {
      _conflicts.push(type);
    }
  }
  if (done.includes("sight")) {
    registerWrapper("foundry.canvas.perception.DetectionMode.prototype._testLOS", testLOSWrapper);
  }
  return done;
}

/** Re-cut every sight and light polygon on the viewed scene. */
export function refreshPerception(scene = null) {
  const c = globalThis.canvas;
  if (!c?.ready || !c.perception) return;
  if (scene && c.scene && scene.id !== c.scene.id) return;
  c.perception.update({ initializeVision: true, initializeLighting: true });
}
