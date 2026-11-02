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
import { creatureHeightDist, eyeQ } from "../rules/creature.mjs";
import { activeContext, t } from "./context.mjs";

/** A light sits at least this far above the ground under it (q). */
const LIGHT_LIFT_Q = 1;
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
  const doc = poly.config.source?.object?.document;
  if (type === "sight" && isTokenDoc(doc)) return eyeQ(doc, grid);
  const o = poly.origin ?? {};
  const ground = terrain.groundAt(o.x ?? 0, o.y ?? 0, grid.size);
  const own = distToQ(Number(o.elevation) || 0, grid.distance);
  return Math.max(own, ground + LIGHT_LIFT_Q);
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

    /** @override */
    _identifyEdges() {
      super._identifyEdges();
      if (this._dioNoCliffs) return;
      const live = context(this);
      if (!live) return;
      const eye = polygonEyeQ(this, live);
      if (eye === null || !Number.isFinite(eye)) return;
      const list = cliffEdgeObjects(live.terrain, Math.floor(eye), live.grid.size, Edge);
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
      let hit = null;
      const live = _detecting ? null : context(this);
      if (live && tMin < tMax) {
        const eye = polygonEyeQ(this, live);
        if (eye !== null && Number.isFinite(eye)) {
          const { terrain, grid } = live;
          const ox = ray.A?.x ?? this.origin.x, oy = ray.A?.y ?? this.origin.y;
          const bx = ray.B?.x ?? destination.x, by = ray.B?.y ?? destination.y;
          const zB = distToQ(Number(destination?.elevation ?? this.origin.elevation) || 0, grid.distance);
          const at = (s) => rayPoint(ox + (bx - ox) * s, oy + (by - oy) * s, eye + (zB - eye) * s, grid.size);
          const s = rayBlocked(terrain, at(tMin), at(tMax));
          if (s !== null) {
            if (mode === "any") return true;
            const tt = tMin + s * (tMax - tMin);
            hit = { x: ox + (bx - ox) * tt, y: oy + (by - oy) * tt, t: tt };
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

function defaultContext(poly) {
  let scene;
  try { scene = poly.scene; } catch { return null; }
  return activeContext(scene);
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
  const { terrain, grid } = live;
  const A = rayPoint(from.x, from.y, eyeQv, grid.size);
  for (const f of TARGET_SAMPLES) {
    const z = distToQ(footDist + f * heightDist, grid.distance);
    if (rayBlocked(terrain, A, rayPoint(point.x, point.y, z, grid.size)) === null) return true;
  }
  return false;
}

/** MIXED wrapper for DetectionMode#_testLOS. */
function testLOSWrapper(wrapped, visionSource, mode, target, test) {
  if (!this.walls) return wrapped(visionSource, mode, target, test);
  const tgt = target?.document;
  const src = visionSource?.object?.document;
  if (!isTokenDoc(tgt) || !isTokenDoc(src)) return wrapped(visionSource, mode, target, test);
  if (visionSource.level !== test.level) return wrapped(visionSource, mode, target, test);
  const live = activeContext(src.parent);
  if (!live || !visionSource.los) return wrapped(visionSource, mode, target, test);

  // Foundry caches only on its own angle-constrained branch; keep that.
  const cacheable = !(!this.angle && (visionSource.data.angle < 360));
  if (cacheable) {
    const c = test.los.get(visionSource);
    if (c !== undefined) return c;
  }
  let has = false;
  const eye = eyeQ(src, live.grid);
  const foot = Number(tgt.elevation) || 0;
  const h = creatureHeightDist(tgt.actor ?? null, tgt);
  if (targetInClearLine(live, eye, visionSource.origin, test.point, foot, h)) {
    const cfg = { ...visionSource.los.config };
    delete cfg.boundingBox; // recomputed for the ray, not the whole LOS
    if (!this.angle) cfg.angle = 360;
    _detecting++;
    try { has = !this.constructor._testCollision(visionSource, test, cfg); }
    finally { _detecting--; }
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
  for (const type of _conflicts) warn(t("GLDIO.rules.backendConflict", { type }));
}

/**
 * Install the backend for sight and light, and the detection wrapper.
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
  for (const type of ["sight", "light"]) {
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
