/**
 * Diorama — slabs: off-grid terrain. See docs/DIORAMA_PROPS.md.
 *
 * A slab is a prop that draws like the ground, not like an object: its top is
 * the map art projected straight down (so it lines up with the 2D map to the
 * pixel, whatever its outline), lit and graded like a terrain top, with the
 * terrain's lip (a soft bevel and one device-px hairline along the rim); its
 * sides are the terrain's own cliff program, in a cliff material. What makes
 * it a slab rather than a terrace is only that its outline is free: a
 * rectangle at any size and turn, or a polygon at any precision.
 *
 * Every slab on a board is merged into two meshes (tops, sides) and one shadow
 * caster, rebuilt when the slabs change. Per-vertex `aSlab` carries the slab's
 * ghost flag and its fade (a slab marked as a roof fades like one), so a fade
 * rewrites a range of one attribute and never a mesh.
 *
 * The top's lip needs a distance from the rim at every pixel. The outline is
 * inset by a little more than the bevel (a mitred inner ring), the band
 * between the two rings carries the distance (0 at the rim, the inset at the
 * inner ring), and the inner polygon is triangulated at the inset. A slab too
 * thin to inset cleanly (the ring would cross itself) draws with no lip.
 *
 * PURE: no world reads. `groundMin(state)` (cells) is handed in.
 */

import * as THREE from "./three.mjs";
import { CLIFF_MATERIALS } from "../constants.mjs";
import { footprintOutline, inPolygon } from "../terrain/props.mjs";

/** How far in the lip band reaches (cells): past the 0.09 bevel, so the bevel ends inside it. */
export const SLAB_INSET = 0.12;
/** terrain-mesh.mjs LIP_INSET: where a face samples the paint of the top it hangs from. */
const LIP_INSET = 0.03;
/** Neighbouring side faces closer than this (degrees) share a normal: a curve reads smooth. */
const SMOOTH_DEG = 35;

const cross2 = (ax, ay, bx, by) => ax * by - ay * bx;

/** Do segments p1-p2 and p3-p4 cross (proper intersection, shared ends excluded)? */
function segmentsCross(p1, p2, p3, p4) {
  const d1 = cross2(p4[0] - p3[0], p4[1] - p3[1], p1[0] - p3[0], p1[1] - p3[1]);
  const d2 = cross2(p4[0] - p3[0], p4[1] - p3[1], p2[0] - p3[0], p2[1] - p3[1]);
  const d3 = cross2(p2[0] - p1[0], p2[1] - p1[1], p3[0] - p1[0], p3[1] - p1[1]);
  const d4 = cross2(p2[0] - p1[0], p2[1] - p1[1], p4[0] - p1[0], p4[1] - p1[1]);
  return ((d1 > 1e-9 && d2 < -1e-9) || (d1 < -1e-9 && d2 > 1e-9)) && ((d3 > 1e-9 && d4 < -1e-9) || (d3 < -1e-9 && d4 > 1e-9));
}

function selfCrosses(ring) {
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const a = ring[i], b = ring[(i + 1) % n];
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (segmentsCross(a, b, ring[j], ring[(j + 1) % n])) return true;
    }
  }
  return false;
}

function area(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  return a / 2;
}

/** Drop repeated and collinear corners (they make zero-length faces). */
function clean(pts) {
  const out = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-4) out.push(p);
  }
  if (out.length > 1 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) <= 1e-4) out.pop();
  for (let i = 0; i < out.length && out.length > 3;) {
    const a = out[(i + out.length - 1) % out.length], b = out[i], c = out[(i + 1) % out.length];
    if (Math.abs(cross2(b[0] - a[0], b[1] - a[1], c[0] - b[0], c[1] - b[1])) < 1e-7) out.splice(i, 1);
    else i++;
  }
  return out;
}

/** Outward unit normal of every edge i → i+1, tested against the outline itself. */
function edgeNormals(ring) {
  const n = ring.length;
  return ring.map((a, i) => {
    const b = ring[(i + 1) % n];
    const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
    let nx = dy / L, ny = -dx / L;
    const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
    if (inPolygon(ring, mx + nx * 1e-3, my + ny * 1e-3)) { nx = -nx; ny = -ny; }
    return [nx, ny];
  });
}

/** The outline moved in by k (mitred, the mitre capped), or null where it would cross itself. */
function insetRing(ring, normals, k) {
  const n = ring.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    const n0 = normals[(i + n - 1) % n], n1 = normals[i];
    let mx = -(n0[0] + n1[0]), my = -(n0[1] + n1[1]);
    const L = Math.hypot(mx, my);
    if (L < 1e-6) return null;
    mx /= L; my /= L;
    const cos = -(mx * n0[0] + my * n0[1]);
    const len = Math.min(k / Math.max(cos, 0.2), k * 2.5);
    out.push([ring[i][0] + mx * len, ring[i][1] + my * len]);
  }
  const a0 = area(ring), a1 = area(out);
  if (Math.sign(a0) !== Math.sign(a1) || Math.abs(a1) >= Math.abs(a0) || selfCrosses(out)) return null;
  for (const q of out) if (!inPolygon(ring, q[0], q[1])) return null;
  return out;
}

/** Triangles of a simple polygon, as index triples, each turned to face up (+y). */
function triangulate(ring) {
  const tris = THREE.ShapeUtils.triangulateShape(ring.map(([x, y]) => new THREE.Vector2(x, y)), []);
  return tris.map(([a, b, c]) => {
    const A = ring[a], B = ring[b], C = ring[c];
    // world (x, z) = map (x, y); +y up faces the camera when (B−A)×(C−A) has y > 0
    const ny = (B[1] - A[1]) * (C[0] - A[0]) - (B[0] - A[0]) * (C[1] - A[1]);
    return ny >= 0 ? [a, b, c] : [a, c, b];
  });
}

/** A growable float buffer per attribute. */
class Writer {
  constructor(spec) { this.spec = spec; this.data = Object.fromEntries(Object.keys(spec).map((k) => [k, []])); this.count = 0; }
  push(v) { for (const k in this.spec) this.data[k].push(...v[k]); this.count++; }
  geometry() {
    const g = new THREE.BufferGeometry();
    for (const [k, n] of Object.entries(this.spec)) g.setAttribute(k, new THREE.BufferAttribute(new Float32Array(this.data[k]), n));
    return g;
  }
}

/**
 * The slabs' merged geometry.
 * @param {object[]} states  slab PropStates
 * @param {(s:object)=>number} groundMin  the lowest ground under a slab (cells)
 * @returns {{ top: THREE.BufferGeometry, side: THREE.BufferGeometry,
 *   ranges: {id:string, top:number[], side:number[], blocks:boolean, ghost:boolean, lip:boolean}[] }}
 *   ranges: each slab's vertex range [first, end) in top and side
 */
export function buildSlabGeometry(states, groundMin = () => 0) {
  const top = new Writer({ position: 3, normal: 3, aEdge: 1, aSlab: 2 });
  const side = new Writer({ position: 3, normal: 3, lip: 2, depth: 1, drop: 1, along: 1, mat: 1, flag: 1, aSlab: 2 });
  const ranges = [];
  const cosSmooth = Math.cos(SMOOTH_DEG * Math.PI / 180);
  for (const s of states) {
    const ring = clean(footprintOutline(s));
    if (ring.length < 3 || Math.abs(area(ring)) < 1e-4) continue;
    const yTop = s.base + s.h;
    const yBot = Math.min(yTop - 0.01, s.floats ? s.base : groundMin(s) - 0.02);
    const slab = [s.ghost ? 1 : 0, 1];
    const t0 = top.count, s0 = side.count;
    const normals = edgeNormals(ring);

    // ── the top: a lip band and the triangulated inside ──
    let inner = null, k = SLAB_INSET;
    for (let tries = 0; tries < 4 && !inner; tries++, k /= 2) inner = insetRing(ring, normals, k);
    const up = [0, 1, 0];
    const vt = (p, e) => top.push({ position: [p[0], yTop, p[1]], normal: up, aEdge: [e], aSlab: slab });
    const triUp = (A, B, C, ea, eb, ec) => {
      const ny = (B[1] - A[1]) * (C[0] - A[0]) - (B[0] - A[0]) * (C[1] - A[1]);
      if (ny >= 0) { vt(A, ea); vt(B, eb); vt(C, ec); } else { vt(A, ea); vt(C, ec); vt(B, eb); }
    };
    if (inner) {
      const kk = k * 2;   // the loop halved k once past the inset that worked
      const n = ring.length;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        triUp(ring[i], ring[j], inner[j], 0, 0, kk);
        triUp(ring[i], inner[j], inner[i], 0, kk, kk);
      }
      for (const [a, b, c] of triangulate(inner)) { vt(inner[a], kk); vt(inner[b], kk); vt(inner[c], kk); }
    } else {
      for (const [a, b, c] of triangulate(ring)) { vt(ring[a], 1); vt(ring[b], 1); vt(ring[c], 1); }
    }

    // ── the sides: one face per edge, down to the ground (or the base, floating) ──
    const mat = Math.max(0, CLIFF_MATERIALS.indexOf(s.cliff ?? "stone"));
    const n = ring.length;
    let along = 0;
    for (let i = 0; i < n; i++) {
      const A = ring[i], B = ring[(i + 1) % n], nn = normals[i];
      const len = Math.hypot(B[0] - A[0], B[1] - A[1]);
      const np = normals[(i + n - 1) % n], nx = normals[(i + 1) % n];
      const blend = (o) => {
        if (o[0] * nn[0] + o[1] * nn[1] < cosSmooth) return [nn[0], 0, nn[1]];
        const x = o[0] + nn[0], z = o[1] + nn[1], L = Math.hypot(x, z) || 1;
        return [x / L, 0, z / L];
      };
      const nA = blend(np), nB = blend(nx);
      const v = (p, y, nrm, al) => ({
        position: [p[0], y, p[1]], normal: nrm, lip: [p[0] - nn[0] * LIP_INSET, p[1] - nn[1] * LIP_INSET],
        depth: [yTop - y], drop: [yTop - yBot], along: [al], mat: [mat], flag: [1], aSlab: slab,
      });
      const q = [v(A, yTop, nA, along), v(B, yTop, nB, along + len), v(B, yBot, nB, along + len), v(A, yBot, nA, along)];
      // front faces wind counter-clockwise seen from outside: test against the face normal
      const [p0, p1, p2] = [q[0].position, q[1].position, q[2].position];
      const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2];
      const wx = p2[0] - p0[0], wy = p2[1] - p0[1], wz = p2[2] - p0[2];
      const fx = uy * wz - uz * wy, fz = ux * wy - uy * wx;
      const out = fx * nn[0] + fz * nn[1] >= 0;
      const order = out ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2];
      for (const o of order) side.push(q[o]);
      along += len;
    }
    ranges.push({ id: s.id, top: [t0, top.count], side: [s0, side.count], blocks: !!s.blocks, ghost: !!s.ghost, lip: !!inner });
  }
  return { top: top.geometry(), side: side.geometry(), ranges };
}

/**
 * The slabs on the board: two meshes and a caster, owned by the PropsLayer.
 *   .set(states, groundMin)   rebuild (states: slab PropStates)
 *   .setFade(Map<id, 0..1>)   → true when the casters changed
 *   .pick(raycaster)          → { id, point, blocks } | null
 */
export class SlabSet {
  /**
   * @param {{top: () => THREE.Material, side: () => THREE.Material}} make  material factories
   * @param {THREE.Group} group  @param {THREE.Scene} casters  @param {THREE.Material} casterMat
   */
  constructor(make, group, casters, casterMat) {
    this.make = make;
    this.group = group;
    this.castersScene = casters;
    this.casterMat = casterMat;
    this.top = null;
    this.side = null;
    this.caster = null;
    this.ranges = [];
    this.fade = new Map();
    this.topMat = null;
    this.sideMat = null;
  }

  get count() { return this.ranges.length; }

  set(states, groundMin) {
    this.clear();
    if (!states.length) return;
    const g = buildSlabGeometry(states, groundMin);
    this.ranges = g.ranges;
    if (!this.ranges.length) { g.top.dispose(); g.side.dispose(); return; }
    this.topMat ??= this.make.top();
    this.sideMat ??= this.make.side();
    for (const geo of [g.top, g.side]) { geo.computeBoundingSphere(); geo.computeBoundingBox(); }
    this.top = new THREE.Mesh(g.top, this.topMat);
    this.top.name = "dio.prop.slab.top";
    this.side = new THREE.Mesh(g.side, this.sideMat);
    this.side.name = "dio.prop.slab.side";
    this.top.frustumCulled = this.side.frustumCulled = false;
    this.group.add(this.top, this.side);
    this.applyFade();
  }

  /** Write the fades into aSlab and rebuild the caster (a faded slab casts nothing). */
  setFade(map) {
    let changed = false;
    for (const r of this.ranges) {
      const a = map?.get(r.id) ?? 1;
      if ((this.fade.get(r.id) ?? 1) !== a) { changed = true; break; }
    }
    this.fade = map ?? new Map();
    if (!changed) return false;
    return this.applyFade();
  }

  applyFade() {
    if (!this.top) return false;
    const ta = this.top.geometry.getAttribute("aSlab"), sa = this.side.geometry.getAttribute("aSlab");
    for (const r of this.ranges) {
      const a = Math.max(0, Math.min(1, this.fade.get(r.id) ?? 1));
      for (let i = r.top[0]; i < r.top[1]; i++) ta.setY(i, a);
      for (let i = r.side[0]; i < r.side[1]; i++) sa.setY(i, a);
    }
    ta.needsUpdate = sa.needsUpdate = true;
    this.buildCaster();
    return true;
  }

  /** One caster for every slab that is solid to the eye (not a ghost, not faded below half). */
  buildCaster() {
    if (this.caster) { this.castersScene.remove(this.caster); this.caster.geometry.dispose(); this.caster = null; }
    const keep = this.ranges.filter((r) => !r.ghost && (this.fade.get(r.id) ?? 1) >= 0.5);
    if (!keep.length) return;
    let n = 0;
    for (const r of keep) n += r.top[1] - r.top[0] + r.side[1] - r.side[0];
    const pos = new Float32Array(n * 3);
    const tp = this.top.geometry.getAttribute("position").array, sp = this.side.geometry.getAttribute("position").array;
    let o = 0;
    for (const r of keep) {
      pos.set(tp.subarray(r.top[0] * 3, r.top[1] * 3), o); o += (r.top[1] - r.top[0]) * 3;
      pos.set(sp.subarray(r.side[0] * 3, r.side[1] * 3), o); o += (r.side[1] - r.side[0]) * 3;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.computeBoundingSphere();
    this.caster = new THREE.Mesh(g, this.casterMat);
    this.caster.name = "dio.prop.slab.caster";
    this.caster.frustumCulled = false;
    this.castersScene.add(this.caster);
  }

  /** The slab under a ray, nearest first: { id, point, blocks, distance }. */
  pick(raycaster) {
    if (!this.top) return null;
    const hits = raycaster.intersectObjects([this.top, this.side], false);
    for (const h of hits) {
      const v = h.faceIndex * 3;
      const key = h.object === this.top ? "top" : "side";
      const r = this.ranges.find((x) => v >= x[key][0] && v < x[key][1]);
      if (r && !r.ghost && (this.fade.get(r.id) ?? 1) >= 0.5) return { id: r.id, point: h.point.clone(), blocks: r.blocks, distance: h.distance };
    }
    return null;
  }

  clear() {
    for (const m of [this.top, this.side]) if (m) { this.group.remove(m); m.geometry.dispose(); }
    if (this.caster) { this.castersScene.remove(this.caster); this.caster.geometry.dispose(); }
    this.top = this.side = this.caster = null;
    this.ranges = [];
  }

  dispose() {
    this.clear();
    this.topMat?.dispose();
    this.sideMat?.dispose();
    this.topMat = this.sideMat = null;
  }
}
