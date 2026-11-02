/**
 * Diorama — walls and doors.
 *
 * Each wall is extruded between baseQ and topQ, ~0.12 cell thick, in its own
 * mesh (local x along the wall from `a`, local y 0..1 scaled to the height), so
 * a camera-facing wall can drop to a stub by tweening one scale.
 *
 * "Camera-facing" needs an outward side, which a Foundry wall does not have.
 * Walls are joined into buildings by shared endpoints, and a wall's outward
 * normal is the perpendicular pointing away from its building's centroid. A
 * lone wall (a fence) has no outward side and is never cut.
 */

import * as THREE from "./three.mjs";
import { TIMING, WALL_MATERIALS } from "../constants.mjs";
import { MATERIALS } from "./materials.mjs";
import { Eased, ease } from "./tween.mjs";
import { SHADOW_LAYER } from "./terrain.mjs";

const THICK = 0.12;
const LEAF_THICK = 0.07;
const STUB = 0.22;           // cells left standing when a wall is cut
const DOOR_MAX_H = 1.6;      // a door leaf is at most this tall (cells)
const OPEN_ANGLE = Math.PI * 0.47;
const CUT_DOT = 0.25;

/** Box segments [y0, y1] (0..1 of the height) a wall type draws. */
const BODY = { wall: [[0, 1]], window: [[0, 0.38], [0.74, 1]], terrain: [[0, 1]] };

/**
 * A box from x 0..len, z ±t/2, over the given y ranges (0..1), as a geometry
 * with along / len / perp attributes. No bottom face.
 */
export function wallBoxGeometry(len, t, ranges, x0 = 0) {
  const pos = [], nor = [], along = [], lens = [], perp = [], idx = [];
  const h = t / 2;
  const face = (pts, n) => {
    const base = pos.length / 3;
    for (const p of pts) {
      pos.push(p[0], p[1], p[2]); nor.push(n[0], n[1], n[2]);
      along.push(p[0]); lens.push(len); perp.push(0, 1);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  const x1 = x0 + len;
  for (const [y0, y1] of ranges) {
    face([[x0, y0, h], [x1, y0, h], [x1, y1, h], [x0, y1, h]], [0, 0, 1]);
    face([[x1, y0, -h], [x0, y0, -h], [x0, y1, -h], [x1, y1, -h]], [0, 0, -1]);
    face([[x0, y1, h], [x1, y1, h], [x1, y1, -h], [x0, y1, -h]], [0, 1, 0]);
    face([[x1, y0, h], [x1, y0, -h], [x1, y1, -h], [x1, y1, h]], [1, 0, 0]);
    face([[x0, y0, -h], [x0, y0, h], [x0, y1, h], [x0, y1, -h]], [-1, 0, 0]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute("along", new THREE.Float32BufferAttribute(along, 1));
  g.setAttribute("len", new THREE.Float32BufferAttribute(lens, 1));
  g.setAttribute("perp", new THREE.Float32BufferAttribute(perp, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

/**
 * Outward normals (x, z) per wall id, from building centroids. Pure.
 * @param {Array<{id:string,a:number[],b:number[]}>} walls  px
 * @returns {Map<string, [number, number]>}
 */
export function outwardNormals(walls) {
  const parent = new Map();
  const find = (k) => { while (parent.get(k) !== k) { parent.set(k, parent.get(parent.get(k))); k = parent.get(k); } return k; };
  const key = (p) => `${Math.round(p[0] / 4)},${Math.round(p[1] / 4)}`;
  const add = (k) => { if (!parent.has(k)) parent.set(k, k); };
  for (const w of walls) {
    const ka = key(w.a), kb = key(w.b);
    add(ka); add(kb);
    const ra = find(ka), rb = find(kb);
    if (ra !== rb) parent.set(ra, rb);
  }
  const sum = new Map();
  for (const w of walls) {
    const r = find(key(w.a));
    const s = sum.get(r) ?? { x: 0, y: 0, n: 0, len: 0 };
    const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
    s.x += ((w.a[0] + w.b[0]) / 2) * len; s.y += ((w.a[1] + w.b[1]) / 2) * len; s.len += len; s.n++;
    sum.set(r, s);
  }
  const out = new Map();
  for (const w of walls) {
    const s = sum.get(find(key(w.a)));
    const dx = w.b[0] - w.a[0], dy = w.b[1] - w.a[1];
    const len = Math.hypot(dx, dy) || 1;
    let nx = -dy / len, ny = dx / len;
    if (!s || s.n < 3 || !s.len) { out.set(w.id, [0, 0]); continue; }
    const cx = s.x / s.len, cy = s.y / s.len;
    const mx = (w.a[0] + w.b[0]) / 2 - cx, my = (w.a[1] + w.b[1]) / 2 - cy;
    const side = nx * mx + ny * my;
    if (Math.abs(side) < 1e-6) { out.set(w.id, [0, 0]); continue; }
    if (side < 0) { nx = -nx; ny = -ny; }
    out.set(w.id, [nx, ny]);
  }
  return out;
}

export class WallsLayer {
  constructor(shared) {
    this.shared = shared;
    this.group = new THREE.Group();
    this.group.name = "dio.walls";
    /** @type {Map<string, any>} id → entry */
    this.entries = new Map();
    this.mats = new Map();
    this.cutaway = true;
    this.camDir = [Math.SQRT1_2, Math.SQRT1_2];
    this.size = 100;
  }

  material(mat, opacity = 1) {
    const k = `${mat}|${opacity}`;
    let m = this.mats.get(k);
    if (!m) { m = MATERIALS.wall(this.shared, { mat, opacity }); this.mats.set(k, m); }
    return m;
  }

  setGridSize(size) { this.size = size || 100; }

  /**
   * @param {object[]} walls WallState[]
   * @param {number} now
   * @param {boolean} animate
   */
  set(walls, now, animate = true) {
    const list = (Array.isArray(walls) ? walls : []).filter((w) => w && w.type !== "invisible"
      && Array.isArray(w.a) && Array.isArray(w.b) && Number(w.topQ) > Number(w.baseQ ?? 0));
    const outward = outwardNormals(list);
    const seen = new Set();
    for (const w of list) {
      const id = String(w.id);
      seen.add(id);
      const sig = this.signature(w);
      let e = this.entries.get(id);
      if (e && e.sig !== sig) { this.drop(id); e = null; }
      if (!e) e = this.build(w, sig, now);
      e.outward = outward.get(w.id) ?? [0, 0];
      const isDoor = w.type === "door" || w.type === "secret";
      if (e.leaf) {
        e.swing.set(isDoor && w.door === "open" ? OPEN_ANGLE : 0, now, animate);
        e.leaf.material.uniforms.uLocked.value = w.door === "locked" ? 1 : 0;
      }
      e.state = w;
    }
    for (const id of [...this.entries.keys()]) if (!seen.has(id)) this.drop(id);
    this.refreshCuts(now, animate);
  }

  /** Geometry-affecting fields only; door state tweens in place. */
  signature(w) {
    return [w.a[0], w.a[1], w.b[0], w.b[1], w.type, w.material, w.baseQ, w.topQ].join("|");
  }

  build(w, sig, now) {
    const S = this.size;
    const ax = w.a[0] / S, az = w.a[1] / S, bx = w.b[0] / S, bz = w.b[1] / S;
    const dx = bx - ax, dz = bz - az;
    const len = Math.hypot(dx, dz);
    const baseY = Number(w.baseQ ?? 0) / 4;
    const height = (Number(w.topQ) - Number(w.baseQ ?? 0)) / 4;
    const root = new THREE.Group();
    root.position.set(ax, baseY, az);
    root.rotation.y = Math.atan2(-dz, dx);
    const mat = WALL_MATERIALS.includes(w.material) ? w.material : "stone";
    const isDoor = w.type === "door" || w.type === "secret";
    const e = { id: String(w.id), sig, root, body: null, leaf: null, height, len,
      cut: new Eased(1, TIMING.wallCut, ease.inOutCubic), swing: new Eased(0, TIMING.door, ease.outCubic), outward: [0, 0] };
    const scaleNode = new THREE.Group();
    scaleNode.scale.y = height;
    root.add(scaleNode);
    e.scaleNode = scaleNode;
    if (!isDoor) {
      const ranges = BODY[w.type] ?? BODY.wall;
      const body = new THREE.Mesh(wallBoxGeometry(len, THICK, ranges), this.material(mat, w.type === "terrain" ? 0.45 : 1));
      body.renderOrder = w.type === "terrain" ? 6 : 1;
      if (w.type !== "terrain") body.layers.enable(SHADOW_LAYER);
      scaleNode.add(body);
      e.body = body;
    } else {
      const leafH = Math.min(1, DOOR_MAX_H / Math.max(height, 0.001));
      if (leafH < 0.999) {
        const lintel = new THREE.Mesh(wallBoxGeometry(len, THICK, [[leafH, 1]]), this.material(mat));
        lintel.layers.enable(SHADOW_LAYER);
        scaleNode.add(lintel);
        e.body = lintel;
      }
      const leafMat = MATERIALS.wall(this.shared, { mat: "door" });
      if (w.type === "secret") leafMat.uniforms.uTintAmt.value = 0.35;
      const leafPivot = new THREE.Group();
      scaleNode.add(leafPivot);
      const leaf = new THREE.Mesh(wallBoxGeometry(len, LEAF_THICK, [[0, leafH]]), leafMat);
      leaf.layers.enable(SHADOW_LAYER);
      leaf.userData.doorId = String(w.id);
      leafPivot.add(leaf);
      e.leaf = leaf;
      e.leafPivot = leafPivot;
    }
    this.group.add(root);
    this.entries.set(e.id, e);
    return e;
  }

  drop(id) {
    const e = this.entries.get(id);
    if (!e) return;
    this.group.remove(e.root);
    e.root.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
    if (e.leaf) e.leaf.material.dispose();
    this.entries.delete(id);
  }

  /** Camera horizontal direction (toward the camera), from its yaw. */
  setCameraYaw(yaw, now, animate = true) {
    this.camDir = [Math.sin(yaw), Math.cos(yaw)];
    this.refreshCuts(now, animate);
  }

  setCutaway(on, now, animate = true) {
    this.cutaway = !!on;
    this.refreshCuts(now, animate);
  }

  refreshCuts(now, animate = true) {
    for (const e of this.entries.values()) {
      const [nx, nz] = e.outward;
      const facing = nx * this.camDir[0] + nz * this.camDir[1] > CUT_DOT;
      const stub = Math.min(1, STUB / Math.max(e.height, 0.001));
      e.cut.set(this.cutaway && facing ? stub : 1, now, animate);
    }
    this.update(now);
  }

  /** Advance tweens. @returns {boolean} true while anything moves */
  update(now) {
    let active = false;
    for (const e of this.entries.values()) {
      const c = e.cut.update(now);
      e.scaleNode.scale.y = e.height * c;
      if (e.leafPivot) e.leafPivot.rotation.y = -e.swing.update(now);
      active = active || e.cut.active || e.swing.active;
    }
    return active;
  }

  pickables() {
    const out = [];
    for (const e of this.entries.values()) if (e.leaf) out.push(e.leaf);
    return out;
  }

  dispose() {
    for (const id of [...this.entries.keys()]) this.drop(id);
    for (const m of this.mats.values()) m.dispose();
    this.mats.clear();
  }
}
