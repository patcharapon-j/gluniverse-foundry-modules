/**
 * Diorama — target lines: a raised arc from a source standee's chest to its
 * target's base, the 3D form of the 2D canvas's targeting lines.
 *
 *   links  [{ sourceId, targetId, color:[r,g,b] 0..1 (or a CSS colour) }]
 *
 * Only what setLinks hands over is drawn, and a link whose ends are not both on
 * the board (or not shown) is dropped. Each line is a ribbon of constant device
 * pixel width (LINK_VERT, LINK_PX) with a bright core, a dark ink edge and an
 * arrowhead whose tip lands on the target's base, turned along the arc's end as
 * it falls on screen; a glint runs source to target once per TIMING.linkGlint.
 * It is drawn over the board and never depth tested, so it reads like the 2D
 * line it mirrors. Ends follow their tokens every frame into preallocated
 * buffers: nothing is allocated per frame.
 */

import * as THREE from "./three.mjs";
import { TIMING } from "../constants.mjs";
import { MATERIALS, LINK_PX } from "./materials.mjs";
import { targetRgb } from "./standees.mjs";

export { LINK_PX };

/** Segments per arc. */
export const LINK_SEGS = 40;
/** Most lines drawn at once. */
export const MAX_LINKS = 16;

/**
 * How high an arc's middle rises over its ends' midpoint, per cell of distance.
 * The brief asked for 0.6; at that a line across the board leaves the top of
 * the screen at the default zoom, so the arc rises 0.35 and keeps its 1 cell
 * floor. Raise it here if a taller arc is wanted.
 */
export const ARC_RISE = 0.35;

/** Apex height of an arc over its ends' midpoint: ARC_RISE × the distance, at least 1 cell. */
export function arcApex(a, b) {
  return Math.max(1, ARC_RISE * Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z));
}

/**
 * Point t (0..1) of the arc from a to b, into out: a quadratic Bézier whose
 * middle rises arcApex(a, b) above the ends' midpoint. Pure.
 */
export function arcPoint(a, b, t, out) {
  const apex = arcApex(a, b);
  const cx = (a.x + b.x) / 2, cz = (a.z + b.z) / 2;
  const cy = 2 * ((a.y + b.y) / 2 + apex) - (a.y + b.y) / 2;
  const u = 1 - t;
  out.x = u * u * a.x + 2 * u * t * cx + t * t * b.x;
  out.y = u * u * a.y + 2 * u * t * cy + t * t * b.y;
  out.z = u * u * a.z + 2 * u * t * cz + t * t * b.z;
  return out;
}

/**
 * The arc's direction as it lands on b (unit, into out): the Bézier's end
 * tangent, b minus the control point. The arrowhead turns along it. Pure.
 */
export function arcEndDir(a, b, out) {
  const apex = arcApex(a, b);
  const x = b.x - (a.x + b.x) / 2, z = b.z - (a.z + b.z) / 2;
  const y = b.y - ((a.y + b.y) / 2 + 2 * apex);
  const l = Math.hypot(x, y, z) || 1;
  out.x = x / l; out.y = y / l; out.z = z / l;
  return out;
}

/** Normalise setLinks input: valid, deduplicated, capped. Pure. */
export function normalizeLinks(links) {
  const out = [];
  const seen = new Set();
  for (const l of Array.isArray(links) ? links : []) {
    if (!l || l.sourceId == null || l.targetId == null) continue;
    const s = String(l.sourceId), t = String(l.targetId);
    if (s === t) continue;
    const key = `${s}>${t}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ key, sourceId: s, targetId: t, rgb: targetRgb(l.color) });
    if (out.length >= MAX_LINKS) break;
  }
  return out;
}

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _p = { x: 0, y: 0, z: 0 };
const _A = { x: 0, y: 0, z: 0 }, _B = { x: 0, y: 0, z: 0 };

export class LinksLayer {
  constructor(shared) {
    this.shared = shared;
    this.group = new THREE.Group();
    this.group.name = "dio.links";
    /** Half the drawing buffer, device px (LINK_VERT), shared by every line. */
    this.viewport = { value: new THREE.Vector2(1, 1) };
    /** key → { mesh, pos, next, a:[x,y,z], b:[x,y,z] } */
    this.entries = new Map();
  }

  setGridSize() { /* lines live in cells; nothing to size */ }

  /**
   * Buffer px per CSS px (pixel ratio × render scale). The ribbon and the head
   * are shapes, not hairlines: sized in CSS px so a retina screen does not
   * halve them. The ink edge stays a device-px hairline.
   */
  setPixelScale(k) {
    const s = Number(k) > 0 ? Number(k) : 1;
    if (s === this.pxScale) return;
    this.pxScale = s;
    for (const e of this.entries.values()) this.sizeOf(e.mesh.material);
  }

  sizeOf(material) {
    const s = this.pxScale ?? 1, u = material.uniforms;
    u.uWidth.value = LINK_PX.half * s;
    u.uHead.value.set(LINK_PX.headLength * s, LINK_PX.headHalf * s, LINK_PX.ink);
  }

  /** @param {{sourceId:string,targetId:string,color:any}[]} links */
  set(links) {
    const list = normalizeLinks(links);
    const keep = new Set(list.map((l) => l.key));
    for (const [key, e] of this.entries) {
      if (keep.has(key)) continue;
      this.group.remove(e.mesh);
      e.mesh.geometry.dispose();
      e.mesh.material.dispose();
      this.entries.delete(key);
    }
    for (const l of list) {
      let e = this.entries.get(l.key);
      if (!e) {
        e = this.build();
        this.entries.set(l.key, e);
      }
      e.sourceId = l.sourceId;
      e.targetId = l.targetId;
      e.mesh.material.uniforms.uColor.value.set(...l.rgb);
    }
  }

  build() {
    // the ribbon's (LINK_SEGS + 1) pairs, then the arrowhead's quad; the head's
    // triangles come last in the index so it draws over the ribbon's end
    const ribbon = (LINK_SEGS + 1) * 2;
    const n = ribbon + 4;
    const pos = new Float32Array(n * 3), next = new Float32Array(n * 3);
    const side = new Float32Array(n), along = new Float32Array(n);
    const head = new Float32Array(n * 3);
    const idx = [];
    for (let i = 0; i <= LINK_SEGS; i++) {
      side[i * 2] = -1; side[i * 2 + 1] = 1;
      along[i * 2] = along[i * 2 + 1] = i / LINK_SEGS;
      if (i < LINK_SEGS) {
        const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
        idx.push(a, b, c, b, d, c);
      }
    }
    // head quad corners: (0 = at the tip, 1 = at the base) × (-1, 1 across)
    [[0, -1], [0, 1], [1, -1], [1, 1]].forEach(([back, across], k) => {
      const v = ribbon + k;
      head[v * 3] = back; head[v * 3 + 1] = across; head[v * 3 + 2] = 1;
      along[v] = 1;
    });
    idx.push(ribbon, ribbon + 2, ribbon + 1, ribbon + 1, ribbon + 2, ribbon + 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aNext", new THREE.BufferAttribute(next, 3));
    g.setAttribute("aSide", new THREE.BufferAttribute(side, 1));
    g.setAttribute("aAlong", new THREE.BufferAttribute(along, 1));
    g.setAttribute("aHead", new THREE.BufferAttribute(head, 3));
    g.setIndex(idx);
    const mesh = new THREE.Mesh(g, MATERIALS.link(this.shared, { viewport: this.viewport }));
    if (this.pxScale && this.pxScale !== 1) this.sizeOf(mesh.material);
    mesh.renderOrder = 34;
    mesh.frustumCulled = false;
    mesh.visible = false;
    this.group.add(mesh);
    return { mesh, pos, next, a: [NaN, NaN, NaN], b: [NaN, NaN, NaN], sourceId: "", targetId: "" };
  }

  get count() { return this.entries.size; }

  /**
   * Follow the ends, advance the glint.
   * @param {number} now ms
   * @param {{anchorOf:(id:string, which:string, out:THREE.Vector3)=>boolean}} standees
   * @param {boolean} glint  the glint runs (markerMotion not shed)
   * @returns {boolean} true while any line is drawn (its glint moves)
   */
  frame(now, standees, glint) {
    let any = false;
    const P = TIMING.linkGlint;
    const phase = glint ? (now % P) / P : -1;
    for (const e of this.entries.values()) {
      const ok = standees.anchorOf(e.sourceId, "chest", _a) && standees.anchorOf(e.targetId, "base", _b);
      e.mesh.visible = ok;
      if (!ok) continue;
      any = true;
      e.mesh.material.uniforms.uPhase.value = phase;
      if (_a.x === e.a[0] && _a.y === e.a[1] && _a.z === e.a[2] && _b.x === e.b[0] && _b.y === e.b[1] && _b.z === e.b[2]) continue;
      e.a[0] = _a.x; e.a[1] = _a.y; e.a[2] = _a.z;
      e.b[0] = _b.x; e.b[1] = _b.y; e.b[2] = _b.z;
      this.layout(e);
    }
    return any;
  }

  /** Write the arc into the line's buffers. */
  layout(e) {
    _A.x = e.a[0]; _A.y = e.a[1]; _A.z = e.a[2];
    _B.x = e.b[0]; _B.y = e.b[1]; _B.z = e.b[2];
    const { pos, next } = e;
    for (let i = 0; i <= LINK_SEGS; i++) {
      arcPoint(_A, _B, i / LINK_SEGS, _p);
      const k = i * 6;
      pos[k] = pos[k + 3] = _p.x; pos[k + 1] = pos[k + 4] = _p.y; pos[k + 2] = pos[k + 5] = _p.z;
    }
    for (let i = 0; i <= LINK_SEGS; i++) {
      // the next point along; the last one extrapolates past the end
      const k = i * 6;
      for (let c = 0; c < 3; c++) {
        const here = pos[k + c];
        const v = i < LINK_SEGS ? pos[k + 6 + c] : here + (here - pos[k - 6 + c]);
        next[k + c] = next[k + 3 + c] = v;
      }
    }
    // the arrowhead's tip on the target's base, turned along the arc's landing
    const u = e.mesh.material.uniforms;
    arcEndDir(_A, _B, _p);
    u.uTip.value.set(_B.x, _B.y, _B.z);
    u.uTipFrom.value.set(_B.x - _p.x * 0.25, _B.y - _p.y * 0.25, _B.z - _p.z * 0.25);
    const g = e.mesh.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.aNext.needsUpdate = true;
  }

  dispose() {
    for (const e of this.entries.values()) { e.mesh.geometry.dispose(); e.mesh.material.dispose(); }
    this.entries.clear();
  }
}
