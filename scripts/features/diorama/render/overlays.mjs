/**
 * Diorama — ground overlays: the move path, highlighted cells, the ruler,
 * pings and the hovered cell. All drawn just above the ground, after it.
 *
 * Shapes (all px / q, the contract's units):
 *   path    { points:[{x,y,zQ,color?}], color? } or a bare points array.
 *           Segment i→i+1 takes points[i+1].color, else path.color.
 *   cells   [{i,j,zQ?,color?,alpha?}] or { cells:[...], color? }.
 *           zQ defaults to the terrain's top of that cell.
 *   ruler   { a:{x,y,zQ}, b:{x,y,zQ}, color? } or { points:[...], color? } or null.
 *   pings   [{id?, x, y, zQ?, color?}]. A ping plays once (TIMING.ping) from the
 *           moment its key first appears; keep it in the list or drop it.
 *   hover   { i, j, zQ?, color? } or null.
 *   reach   { cells:[{i,j,band}], start?:{i,j,w,h}, colors? } or null: one
 *           creature's squares by Strides (band 1..3), drawn under the rest.
 *   los     [{ id, a, b, pieces, color, strength? }]: lines of sight (render/tactics.mjs)
 *   falls   [{ id, a, b, pieces, color, cap? }]: drops off a ledge on the path, same shape
 */

import * as THREE from "./three.mjs";
import { TIMING } from "../constants.mjs";
import { PALETTE } from "../../../core/theme.mjs";
import { MATERIALS, cssRgb } from "./materials.mjs";
import { clamp01, ease } from "./tween.mjs";
import { tacticsMeshes } from "./tactics.mjs";

const LIFT = 0.035;
const PATH_W = 0.11;
const STEP = 0.25;

export class OverlaysLayer {
  constructor(shared) {
    this.shared = shared;
    this.group = new THREE.Group();
    this.group.name = "dio.overlays";
    this.static = new THREE.Group();
    this.group.add(this.static);
    this.size = 100;
    this.ground = () => 0;      // (x, z) cells → y cells
    this.cellTopQ = () => 0;    // (i, j) → q
    this.flat = (() => { const g = new THREE.PlaneGeometry(1, 1); g.rotateX(-Math.PI / 2); return g; })();
    /** key → { mesh, t0 } */
    this.pings = new Map();
  }

  setGridSize(size) { this.size = size || 100; }

  /** @param {{ground:(x:number,z:number)=>number, cellTopQ:(i:number,j:number)=>number}} f */
  setGround(f) {
    this.ground = f.ground;
    this.cellTopQ = f.cellTopQ;
  }

  clearStatic() {
    for (const o of [...this.static.children]) {
      this.static.remove(o);
      o.geometry !== this.flat && o.geometry.dispose();
      o.material.dispose();
    }
  }

  set(o = {}, now = 0) {
    this.clearStatic();
    const S = this.size;
    const pt = (p) => ({ x: Number(p.x) / S, z: Number(p.y) / S, y: Number(p.zQ ?? NaN) / 4 });
    // path
    const path = o.path;
    const points = Array.isArray(path) ? path : path?.points;
    if (Array.isArray(points) && points.length) {
      const base = path?.color ?? PALETTE.info;
      const pts = points.map((p) => ({ ...pt(p), color: p.color }));
      for (const p of pts) if (!Number.isFinite(p.y)) p.y = this.ground(p.x, p.z);
      const segs = [];
      for (let i = 0; i + 1 < pts.length; i++) segs.push({ a: pts[i], b: pts[i + 1], color: pts[i + 1].color ?? base });
      this.static.add(this.ribbon(segs, PATH_W * 2.1, PALETTE.ink0, 0.55, 0));
      this.static.add(this.ribbon(segs, PATH_W, null, 1, 1));
      pts.forEach((p, i) => {
        const col = i === 0 ? base : (p.color ?? base);
        this.static.add(this.dot(p, col, i === pts.length - 1 ? 0.34 : 0.2, i === pts.length - 1));
      });
    }
    // reach: under everything else
    if (Array.isArray(o.reach?.cells) && o.reach.cells.length) this.static.add(this.reachMesh(o.reach));
    // cells
    const cellsIn = Array.isArray(o.cells) ? o.cells : o.cells?.cells;
    if (Array.isArray(cellsIn) && cellsIn.length) {
      const def = o.cells?.color ?? PALETTE.accent;
      this.static.add(this.cellsMesh(cellsIn, def));
    }
    // ruler
    const r = o.ruler;
    if (r) {
      const rp = Array.isArray(r.points) ? r.points : r.a && r.b ? [r.a, r.b] : null;
      if (rp && rp.length >= 2) {
        const col = r.color ?? PALETTE.signal;
        const pts = rp.map(pt);
        for (const p of pts) if (!Number.isFinite(p.y)) p.y = this.ground(p.x, p.z);
        const segs = [];
        for (let i = 0; i + 1 < pts.length; i++) segs.push({ a: pts[i], b: pts[i + 1], color: col });
        this.static.add(this.ribbon(segs, PATH_W * 1.8, PALETTE.ink0, 0.5, 0, false));
        this.static.add(this.ribbon(segs, PATH_W * 0.7, null, 1, 1, false));
        this.static.add(this.dot(pts[0], col, 0.22, false));
        this.static.add(this.dot(pts[pts.length - 1], col, 0.22, false));
      }
    }
    // hover
    const h = o.hover;
    if (h && Number.isFinite(Number(h.i)) && Number.isFinite(Number(h.j))) {
      const col = h.color ?? PALETTE.textBright;
      this.static.add(this.cellsMesh([{ i: h.i, j: h.j, zQ: h.zQ, color: col, alpha: 0.12 }], col, 0.07));
    }
    // line of sight and drops (render/tactics.mjs): device-px lines over everything
    const tactical = [...(Array.isArray(o.los) ? o.los : []), ...(Array.isArray(o.falls) ? o.falls : [])];
    if (tactical.length) for (const m of tacticsMeshes(tactical, S)) this.static.add(m);
    // pings
    const seen = new Set();
    for (const p of Array.isArray(o.pings) ? o.pings : []) {
      if (!p) continue;
      const key = String(p.id ?? `${p.x},${p.y},${p.color ?? ""}`);
      seen.add(key);
      if (this.pings.has(key)) continue;
      const q = pt(p);
      if (!Number.isFinite(q.y)) q.y = this.ground(q.x, q.z);
      const mesh = new THREE.Mesh(this.flat, MATERIALS.ring(this.shared, { color: p.color ?? PALETTE.signal, inner: 0.82, outer: 0.96, soft: 0.05, additive: true }));
      mesh.position.set(q.x, q.y + LIFT, q.z);
      mesh.renderOrder = 22;
      this.group.add(mesh);
      this.pings.set(key, { mesh, t0: now, done: false });
    }
    for (const [key, p] of this.pings) {
      if (seen.has(key)) continue;
      this.group.remove(p.mesh);
      p.mesh.material.dispose();
      this.pings.delete(key);
    }
  }

  /** Ribbon over segments; rgba per vertex. */
  ribbon(segs, width, color, alpha, order, hug = true) {
    const pos = [], rgba = [], idx = [];
    const push = (x, y, z, c) => { pos.push(x, y, z); rgba.push(c[0], c[1], c[2], alpha); return pos.length / 3 - 1; };
    for (const s of segs) {
      const c = cssRgb(color ?? s.color, PALETTE.info);
      const dx = s.b.x - s.a.x, dz = s.b.z - s.a.z;
      const len = Math.hypot(dx, dz);
      if (len < 1e-5) continue;
      const px = (-dz / len) * width / 2, pz = (dx / len) * width / 2;
      const n = Math.max(1, Math.ceil(len / STEP));
      let prev = null;
      for (let k = 0; k <= n; k++) {
        const f = k / n;
        const x = s.a.x + dx * f, z = s.a.z + dz * f;
        let y = s.a.y + (s.b.y - s.a.y) * f;
        if (hug) y = Math.max(y, this.ground(x, z));
        y += LIFT + order * 0.004;
        const l = push(x + px, y, z + pz, c), r = push(x - px, y, z - pz, c);
        if (prev) idx.push(prev[0], prev[1], r, prev[0], r, l);
        prev = [l, r];
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("rgba", new THREE.Float32BufferAttribute(rgba, 4));
    g.setIndex(idx);
    const m = new THREE.Mesh(g, MATERIALS.ribbon(this.shared));
    m.renderOrder = 20 + order;
    m.frustumCulled = false;
    return m;
  }

  dot(p, color, r, end) {
    const m = new THREE.Mesh(this.flat, MATERIALS.ring(this.shared, {
      color, inner: end ? 0.55 : 0, outer: 0.92, soft: 0.08, fill: end ? 0 : 1,
    }));
    m.scale.set(r * 2, 1, r * 2);
    m.position.set(p.x, p.y + LIFT + 0.006, p.z);
    m.renderOrder = 21;
    return m;
  }

  cellsMesh(list, def, inset = 0.03) {
    const pos = [], rgba = [], idx = [];
    const quad = (x0, z0, x1, z1, y, c, a) => {
      const b = pos.length / 3;
      pos.push(x0, y, z0, x0, y, z1, x1, y, z1, x1, y, z0);
      for (let i = 0; i < 4; i++) rgba.push(c[0], c[1], c[2], a);
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    };
    for (const cell of list) {
      if (!cell) continue;
      const i = Number(cell.i), j = Number(cell.j);
      if (!Number.isFinite(i) || !Number.isFinite(j)) continue;
      const q = Number.isFinite(Number(cell.zQ)) && cell.zQ !== null ? Number(cell.zQ) : this.cellTopQ(i, j);
      const y = q / 4 + LIFT * 0.6;
      const c = cssRgb(cell.color ?? def, PALETTE.accent);
      const a = Number.isFinite(Number(cell.alpha)) ? Number(cell.alpha) : 0.26;
      const x0 = j + inset, z0 = i + inset, x1 = j + 1 - inset, z1 = i + 1 - inset;
      quad(x0, z0, x1, z1, y, c, a);
      const w = 0.045;
      quad(x0, z0, x1, z0 + w, y + 0.002, c, 0.92);
      quad(x0, z1 - w, x1, z1, y + 0.002, c, 0.92);
      quad(x0, z0 + w, x0 + w, z1 - w, y + 0.002, c, 0.92);
      quad(x1 - w, z0 + w, x1, z1 - w, y + 0.002, c, 0.92);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("rgba", new THREE.Float32BufferAttribute(rgba, 4));
    g.setIndex(idx);
    const m = new THREE.Mesh(g, MATERIALS.ribbon(this.shared));
    m.renderOrder = 19;
    m.frustumCulled = false;
    return m;
  }

  /**
   * A creature's reach: each square tinted by its band (one, two, three
   * Strides), and a hairline traced only where a band ends, so the field
   * reads as nested regions rather than a checkerboard.
   * @param {{cells:{i:number,j:number,band:number}[], start?:{i:number,j:number,w?:number,h?:number}, colors?:string[]}} reach
   */
  reachMesh(reach) {
    const colors = reach.colors ?? [PALETTE.info, PALETTE.warn, PALETTE.hazard];
    const bandAt = new Map();
    for (const c of reach.cells) bandAt.set(`${c.i},${c.j}`, c.band);
    const s = reach.start;
    if (s) for (let di = 0; di < (s.h ?? 1); di++) for (let dj = 0; dj < (s.w ?? 1); dj++) bandAt.set(`${s.i + di},${s.j + dj}`, 1);
    const pos = [], rgba = [], idx = [];
    const quad = (x0, z0, x1, z1, y, c, a) => {
      const b = pos.length / 3;
      pos.push(x0, y, z0, x0, y, z1, x1, y, z1, x1, y, z0);
      for (let k = 0; k < 4; k++) rgba.push(c[0], c[1], c[2], a);
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    };
    // The first Stride reads strongest; the later ones recede, so three bands
    // over terraced ground stay one picture instead of a web of lines.
    const fill = [0.22, 0.13, 0.09];
    const line = [0.95, 0.7, 0.5];
    const w = 0.04;
    const ends = (band, i, j) => { const n = bandAt.get(`${i},${j}`) ?? 0; return n === 0 || n > band; };
    for (const cell of reach.cells) {
      const { i, j, band } = cell;
      const c = cssRgb(colors[band - 1] ?? colors.at(-1), PALETTE.info);
      const y = this.cellTopQ(i, j) / 4 + LIFT * 0.45;
      quad(j + 0.02, i + 0.02, j + 0.98, i + 0.98, y, c, fill[band - 1] ?? 0.1);
      const e = y + 0.002, la = line[band - 1] ?? 0.5;
      if (ends(band, i - 1, j)) quad(j, i, j + 1, i + w, e, c, la);
      if (ends(band, i + 1, j)) quad(j, i + 1 - w, j + 1, i + 1, e, c, la);
      if (ends(band, i, j - 1)) quad(j, i, j + w, i + 1, e, c, la);
      if (ends(band, i, j + 1)) quad(j + 1 - w, i, j + 1, i + 1, e, c, la);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("rgba", new THREE.Float32BufferAttribute(rgba, 4));
    g.setIndex(idx);
    const m = new THREE.Mesh(g, MATERIALS.ribbon(this.shared));
    m.renderOrder = 18;
    m.frustumCulled = false;
    return m;
  }

  /** @returns {boolean} true while a ping is expanding */
  frame(now) {
    let active = false;
    for (const p of this.pings.values()) {
      const k = clamp01((now - p.t0) / TIMING.ping);
      const e = ease.outCubic(k);
      const r = 0.3 + e * 1.6;
      p.mesh.scale.set(r * 2, 1, r * 2);
      p.mesh.material.uniforms.uOpacity.value = (1 - k) * 0.95;
      p.mesh.visible = k < 1;
      if (k < 1) active = true;
    }
    return active;
  }

  dispose() {
    this.clearStatic();
    for (const p of this.pings.values()) p.mesh.material.dispose();
    this.pings.clear();
    this.flat.dispose();
  }
}
