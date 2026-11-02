/**
 * Diorama — spell areas as volumes over the squares they cover.
 *
 * A PF2e area is decided on the grid: the squares it covers are the rules,
 * and the smooth shape is only how it was placed. So the volume is built CELL
 * BY CELL from exactly the covered squares (the staircase footprint), and the
 * shape only sets how tall it stands over each one:
 *
 *   burst      a dome: the sphere of the burst's radius about its origin
 *   emanation  a shell: the same sphere, measured from the edge of the source's space
 *   cone       a wedge: the 3D cone along its direction, capped by its length
 *   line       a raised slab of constant height
 *   flat       anything else: a low slab
 *
 * Heights are measured from the ground at the origin, so a burst on a plateau
 * sits on the plateau and pours over its edge; a square under higher ground
 * still gets a thin skin (`SKIN`), so no covered square is ever drawn bare.
 * Every vertex lies on or inside a covered square: nothing pokes past the
 * squares the rules picked.
 *
 * Look: translucent glass in the area's own colour (pf2e-aoe's material when
 * that feature resolves one), denser toward the ground and at grazing edges,
 * with hairlines in device px where the volume meets the ground, along its
 * rim, at the footprint's corners and on 5-ft contours over a dome. A slow
 * glow band rises through it once per TIMING.areaDrift while the budget
 * allows `areaMotion`; shed, it holds still and asks for no frames.
 *
 * Shape (px / q, the contract's units), via r.setAreas([...]):
 *   { id, kind, cells:[{i,j}], origin:{x,y}, radius (cells), direction (rad, screen:
 *     0 east, clockwise), angle (rad, full), width (cells, line), base:[hw,hh]
 *     (cells, emanation: half the source's space), color, hot?, refQ? }
 *
 * PURE: plain state in, meshes out.
 */

import * as THREE from "./three.mjs";
import { TIMING } from "../constants.mjs";
import { PALETTE } from "../../../core/theme.mjs";
import { cssRgb } from "./materials.mjs";

/** Subdivisions per cell edge of the top surface (a dome needs a few to read round). */
export const AREA_N = 4;
/** The thinnest a covered square's volume gets, cells. */
export const SKIN = 0.1;
/** A line's slab, cells. */
export const LINE_H = 0.6;
/** Anything without a known shape, cells. */
export const FLAT_H = 0.25;
/** Contour spacing over a dome, cells (one square: 5 ft on a 5-ft grid). */
export const CONTOUR = 1;
/** Hairline half widths, device px. */
export const AREA_PX = Object.freeze({ rim: 0.75, contour: 0.5 });
/** Kinds the volume knows; anything else draws as `flat`. */
export const AREA_KINDS = Object.freeze(["burst", "emanation", "cone", "line", "flat"]);

const LIFT = 0.012;

/**
 * The height function of an area over the ground at its origin: cells above
 * `ref` at map point (x, z) (cells). 0 outside the shape.
 * @param {object} a  a normalised area (normalizeArea)
 */
export function heightFn(a) {
  const ox = a.ox, oz = a.oz, R = Math.max(0, a.radius);
  switch (a.kind) {
    case "burst":
      return (x, z) => Math.sqrt(Math.max(0, R * R - ((x - ox) ** 2 + (z - oz) ** 2)));
    case "emanation": {
      const [hw, hh] = a.base;
      if (!(R > 0)) return () => LINE_H;
      return (x, z) => {
        const dx = Math.max(0, Math.abs(x - ox) - hw), dz = Math.max(0, Math.abs(z - oz) - hh);
        return Math.sqrt(Math.max(0, R * R - (dx * dx + dz * dz)));
      };
    }
    case "cone": {
      const cx = Math.cos(a.direction), cz = Math.sin(a.direction);
      const tanH = Math.tan(Math.min(Math.PI / 2 - 1e-3, Math.max(1e-3, a.angle / 2)));
      return (x, z) => {
        const px = x - ox, pz = z - oz;
        const along = px * cx + pz * cz;
        if (along <= 0) return 0;
        const lat = px * cz - pz * cx;
        const r = along * tanH;
        const cone = r * r - lat * lat;
        const cap = R * R - (along * along + lat * lat);
        return Math.sqrt(Math.max(0, Math.min(cone, cap)));
      };
    }
    case "line":
      return () => LINE_H;
    default:
      return () => FLAT_H;
  }
}

/** The tallest the shape stands, cells (for the glow band's travel). */
export function peakOf(a) {
  if (a.kind === "burst" || a.kind === "cone") return Math.max(SKIN, a.radius);
  if (a.kind === "emanation") return a.radius > 0 ? a.radius : LINE_H;
  if (a.kind === "line") return LINE_H;
  return FLAT_H;
}

/** An area as the builder reads it: cells, finite numbers, known kind. Null when nothing is covered. */
export function normalizeArea(raw, size = 100) {
  if (!raw || !Array.isArray(raw.cells)) return null;
  const seen = new Set(), cells = [];
  for (const c of raw.cells) {
    const i = Math.round(Number(c?.i)), j = Math.round(Number(c?.j));
    if (!Number.isFinite(i) || !Number.isFinite(j)) continue;
    const k = `${i},${j}`;
    if (seen.has(k)) continue;
    seen.add(k);
    cells.push({ i, j });
  }
  if (!cells.length) return null;
  const S = size || 100;
  const n = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
  const kind = AREA_KINDS.includes(raw.kind) ? raw.kind : "flat";
  const base = Array.isArray(raw.base) ? [Math.max(0, n(raw.base[0])), Math.max(0, n(raw.base[1]))] : [0, 0];
  // without an origin, the middle of the covered squares
  let ox = n(raw.origin?.x, NaN) / S, oz = n(raw.origin?.y, NaN) / S;
  if (!Number.isFinite(ox) || !Number.isFinite(oz)) {
    ox = cells.reduce((s, c) => s + c.j + 0.5, 0) / cells.length;
    oz = cells.reduce((s, c) => s + c.i + 0.5, 0) / cells.length;
  }
  return {
    id: String(raw.id ?? ""), kind, cells, keys: seen, ox, oz,
    radius: Math.max(0, n(raw.radius)), direction: n(raw.direction), angle: n(raw.angle, Math.PI / 2),
    width: Math.max(0, n(raw.width, 1)), base,
    color: raw.color ?? PALETTE.accent, hot: raw.hot ?? null,
    refQ: Number.isFinite(Number(raw.refQ)) ? Number(raw.refQ) : null,
  };
}

/**
 * The ground the heights stand on, cells: the highest covered square touching
 * the origin (a burst on a plateau's corner sits on the plateau), else the
 * highest square touching it at all; an area with its own floor (refQ) above
 * that keeps it.
 */
export function refHeight(a, cellTopQ) {
  const eps = 1e-6;
  const is = [...new Set([Math.floor(a.oz - eps), Math.floor(a.oz + eps)])];
  const js = [...new Set([Math.floor(a.ox - eps), Math.floor(a.ox + eps)])];
  if (a.kind === "emanation") {
    // the source's own space
    is.length = 0; js.length = 0;
    for (let i = Math.floor(a.oz - a.base[1] + eps); i <= Math.floor(a.oz + a.base[1] - eps); i++) is.push(i);
    for (let j = Math.floor(a.ox - a.base[0] + eps); j <= Math.floor(a.ox + a.base[0] - eps); j++) js.push(j);
    if (!is.length) is.push(Math.floor(a.oz));
    if (!js.length) js.push(Math.floor(a.ox));
  }
  let cov = -Infinity, any = -Infinity;
  for (const i of is) for (const j of js) {
    const y = cellTopQ(i, j) / 4;
    any = Math.max(any, y);
    if (a.keys.has(`${i},${j}`)) cov = Math.max(cov, y);
  }
  let ref = Number.isFinite(cov) ? cov : Number.isFinite(any) ? any : 0;
  if (a.refQ !== null) ref = Math.max(ref, a.refQ / 4);
  return ref;
}

/**
 * Geometry of one area, pure. Positions in world units (cells; y = q / 4).
 * @returns {{position:number[], normal:number[], aWall:number[], aCorner:number[], aLift:number[], aKind:number[], index:number[],
 *   ref:number, peak:number, cells:number}}
 *   aKind 0 = top, 1 = wall; aWall (u along the edge, v base→top); aCorner (corner at u=0, at u=1);
 *   aLift = how far the top stands above its skin (contours only draw there)
 */
export function buildAreaGeometry(area, cellTopQ, { n = AREA_N } = {}) {
  const out = { position: [], normal: [], aWall: [], aCorner: [], aLift: [], aKind: [], index: [], ref: 0, peak: 0, cells: 0 };
  if (!area) return out;
  const H = heightFn(area);
  // lifted off the ground by the same hair as each square's own floor
  const ref = refHeight(area, cellTopQ) + LIFT;
  out.ref = ref;
  out.peak = peakOf(area);
  out.cells = area.cells.length;
  const covered = (i, j) => area.keys.has(`${i},${j}`);
  const base = (i, j) => cellTopQ(i, j) / 4 + LIFT;
  const skin = (i, j) => base(i, j) + SKIN;
  const top = (i, j, x, z) => Math.max(ref + H(x, z), skin(i, j));
  const lift = (i, j, x, z) => Math.max(0, ref + H(x, z) - skin(i, j));

  const vert = (p, nrm, wall, corner, lf, kind) => {
    out.position.push(p[0], p[1], p[2]);
    out.normal.push(nrm[0], nrm[1], nrm[2]);
    out.aWall.push(wall[0], wall[1]);
    out.aCorner.push(corner[0], corner[1]);
    out.aLift.push(lf);
    out.aKind.push(kind);
    return out.aKind.length - 1;
  };
  const P = (v) => [out.position[v * 3], out.position[v * 3 + 1], out.position[v * 3 + 2]];
  /** Two triangles a-b-c, a-c-d, wound to face `want`. */
  const quad = (a, b, c, d, want) => {
    for (const [p, q, r] of [[a, b, c], [a, c, d]]) {
      const A = P(p), B = P(q), C = P(r);
      const u = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], w = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
      const nn = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
      const dot = nn[0] * want[0] + nn[1] * want[1] + nn[2] * want[2];
      if (dot >= 0) out.index.push(p, q, r);
      else out.index.push(p, r, q);
    }
  };
  const E = 1e-3;
  const surfNormal = (i, j, x, z) => {
    // the clamped surface's gradient, sampled inside this square
    const xa = Math.max(j, x - E), xb = Math.min(j + 1, x + E), za = Math.max(i, z - E), zb = Math.min(i + 1, z + E);
    const dx = (top(i, j, xb, z) - top(i, j, xa, z)) / Math.max(1e-6, xb - xa);
    const dz = (top(i, j, x, zb) - top(i, j, x, za)) / Math.max(1e-6, zb - za);
    const g = [-dx, 1, -dz], l = Math.hypot(...g);
    return [g[0] / l, g[1] / l, g[2] / l];
  };

  // sides: the neighbour (di, dj), the edge's two ends (x, z), the outward normal, and
  // `along`: the [di, dj] step from this square to the next one along the edge
  const SIDES = [
    { di: -1, dj: 0, a: (i, j) => [j, i], b: (i, j) => [j + 1, i], out: [0, 0, -1], along: [0, 1] },
    { di: 1, dj: 0, a: (i, j) => [j, i + 1], b: (i, j) => [j + 1, i + 1], out: [0, 0, 1], along: [0, 1] },
    { di: 0, dj: -1, a: (i, j) => [j, i], b: (i, j) => [j, i + 1], out: [-1, 0, 0], along: [1, 0] },
    { di: 0, dj: 1, a: (i, j) => [j + 1, i], b: (i, j) => [j + 1, i + 1], out: [1, 0, 0], along: [1, 0] },
  ];

  for (const { i, j } of area.cells) {
    // ── top ──
    const grid = [];
    for (let b = 0; b <= n; b++) {
      for (let a = 0; a <= n; a++) {
        const x = j + a / n, z = i + b / n;
        grid.push(vert([x, top(i, j, x, z), z], surfNormal(i, j, x, z), [0, 1], [0, 0], lift(i, j, x, z), 0));
      }
    }
    for (let b = 0; b < n; b++) for (let a = 0; a < n; a++) {
      const v0 = grid[b * (n + 1) + a], v1 = grid[b * (n + 1) + a + 1], v2 = grid[(b + 1) * (n + 1) + a + 1], v3 = grid[(b + 1) * (n + 1) + a];
      quad(v0, v1, v2, v3, [0, 1, 0]);
    }
    // ── walls ──
    for (const s of SIDES) {
      const ni = i + s.di, nj = j + s.dj;
      const [x0, z0] = s.a(i, j), [x1, z1] = s.b(i, j);
      if (!covered(ni, nj)) {
        // outer wall, ground to top; a corner where the footprint's boundary turns
        const stepI = s.along[0], stepJ = s.along[1];
        const cont = (ci, cj) => covered(ci, cj) && !covered(ci + s.di, cj + s.dj);
        const c0 = cont(i - stepI, j - stepJ) ? 0 : 1, c1 = cont(i + stepI, j + stepJ) ? 0 : 1;
        const y0 = base(i, j);
        let prev = null;
        for (let k = 0; k <= n; k++) {
          const f = k / n, x = x0 + (x1 - x0) * f, z = z0 + (z1 - z0) * f;
          const lo = vert([x, y0, z], s.out, [f, 0], [c0, c1], 0, 1);
          const hi = vert([x, top(i, j, x, z), z], s.out, [f, 1], [c0, c1], lift(i, j, x, z), 1);
          if (prev) quad(prev[0], lo, hi, prev[1], s.out);
          prev = [lo, hi];
        }
      } else if (s.di > 0 || s.dj > 0) {
        // inner step between two covered squares whose skins differ: face the lower one
        const yA = base(i, j), yB = base(ni, nj);
        if (Math.abs(yA - yB) < 1e-6) continue;
        const higher = yA > yB ? [i, j] : [ni, nj], lower = yA > yB ? [ni, nj] : [i, j];
        const want = yA > yB ? s.out : s.out.map((v) => -v);
        let prev = null, any = false;
        const ups = [];
        for (let k = 0; k <= n; k++) {
          const f = k / n, x = x0 + (x1 - x0) * f, z = z0 + (z1 - z0) * f;
          const tHi = top(higher[0], higher[1], x, z), tLo = top(lower[0], lower[1], x, z);
          ups.push([x, z, tLo, tHi]);
          if (tHi - tLo > 1e-4) any = true;
        }
        if (!any) continue;
        ups.forEach(([x, z, tLo, tHi], k) => {
          const f = k / n;
          const lo = vert([x, tLo, z], want, [f, 0], [0, 0], 0, 1);
          const hi = vert([x, Math.max(tLo, tHi), z], want, [f, 1], [0, 0], 0, 1);
          if (prev) quad(prev[0], lo, hi, prev[1], want);
          prev = [lo, hi];
        });
      }
    }
  }
  return out;
}

export const AREA_VERT = /* glsl */ `
attribute vec2 aWall;
attribute vec2 aCorner;
attribute float aLift;
attribute float aKind;
varying vec2 vWall;
varying vec2 vCorner;
varying float vLift;
varying float vKind;
varying float vY;
varying vec3 vN;
varying vec3 vNw;
void main() {
  vWall = aWall;
  vCorner = aCorner;
  vLift = aLift;
  vKind = aKind;
  vY = position.y;
  vNw = normal;
  vN = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const AREA_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uHot;
uniform vec3 uKeyDir;
uniform float uRef;
uniform float uPeak;
uniform float uPhase;
uniform float uMotion;
uniform float uContour;
uniform float uRimPx;
uniform float uContourPx;
uniform float uOpacity;
varying vec2 vWall;
varying vec2 vCorner;
varying float vLift;
varying float vKind;
varying float vY;
varying vec3 vN;
varying vec3 vNw;
float hair(float d, float w) { return 1.0 - smoothstep(w - 0.5, w + 0.5, d); }
void main() {
  bool wall = vKind > 0.5;
  // grazing edges read denser, as glass does (orthographic: the view is +z)
  float fres = 1.0 - abs(normalize(vN).z);
  float body = 0.16 + 0.24 * fres * fres;
  if (wall) body += 0.12 * (1.0 - vWall.y);
  float lit = 0.8 + 0.3 * max(0.0, dot(normalize(vNw), normalize(uKeyDir)));
  vec3 col = uColor * lit;
  // hairlines, device px
  float line = 0.0;
  if (wall) {
    float fv = max(fwidth(vWall.y), 1e-6), fu = max(fwidth(vWall.x), 1e-6);
    float d = min(vWall.y / fv, (1.0 - vWall.y) / fv);
    if (vCorner.x > 0.5) d = min(d, vWall.x / fu);
    if (vCorner.y > 0.5) d = min(d, (1.0 - vWall.x) / fu);
    line = hair(d, uRimPx);
  } else {
    float h = (vY - uRef) / uContour;
    float fh = fwidth(h);
    if (fh > 1e-5 && vLift > 0.0) {
      float c = fract(h);
      line = hair(min(c, 1.0 - c) / fh, uContourPx) * 0.55 * smoothstep(0.0, 0.08, vLift);
    }
  }
  // the glow band rising through the volume
  float band = 0.0;
  if (uMotion > 0.5) {
    float y = uRef + uPhase * max(uPeak, 0.2);
    float g = (vY - y) / 0.16;
    band = exp(-g * g) * sin(3.14159265 * uPhase);
  }
  col = mix(col, uHot, clamp(line + band * 0.6, 0.0, 1.0));
  float a = max(body + band * 0.18, line * 0.85) * uOpacity;
  if (a <= 0.004) discard;
  gl_FragColor = vec4(col, min(a, 1.0));
}
`;

/** The uniforms the area program declares, with their resting values. */
export function areaUniforms(shared = null) {
  return {
    uColor: { value: new THREE.Vector3(1, 1, 1) },
    uHot: { value: new THREE.Vector3(1, 1, 1) },
    uKeyDir: shared?.uKeyDir ?? { value: new THREE.Vector3(0.4, 0.8, 0.3) },
    uRef: { value: 0 },
    uPeak: { value: 1 },
    uPhase: { value: 0 },
    uMotion: { value: 0 },
    uContour: { value: CONTOUR },
    uRimPx: { value: AREA_PX.rim },
    uContourPx: { value: AREA_PX.contour },
    uOpacity: { value: 1 },
  };
}

const signature = (list) => JSON.stringify((list ?? []).map((a) => a && [a.id, a.kind, a.color, a.hot, a.refQ,
  a.origin?.x, a.origin?.y, a.radius, a.direction, a.angle, a.width, a.base, (a.cells ?? []).map((c) => `${c.i},${c.j}`).join(";")]));

export class AreasLayer {
  constructor(shared) {
    this.shared = shared;
    this.group = new THREE.Group();
    this.group.name = "dio.areas";
    this.size = 100;
    this.cellTopQ = () => 0;
    this.model = () => null;
    this.meshes = [];
    this._sig = "";
    this._model = undefined;
    this._list = [];
    this._motion = null;
  }

  setGridSize(size) {
    if ((size || 100) === this.size) return;
    this.size = size || 100;
    this._sig = "";
  }

  /** @param {{cellTopQ:(i:number,j:number)=>number, model?:()=>object}} f  model: identity of the ground, so a new terrain rebuilds */
  setGround(f) {
    this.cellTopQ = f.cellTopQ;
    if (f.model) this.model = f.model;
  }

  get count() { return this.meshes.length; }

  clear() {
    for (const m of this.meshes) {
      this.group.remove(m);
      m.geometry.dispose();
      m.material.dispose();
    }
    this.meshes = [];
  }

  /** @param {object[]} list  the shape above  @returns {boolean} true when it built anything new */
  set(list) {
    this._list = Array.isArray(list) ? list : [];
    return this.rebuild();
  }

  /** Build again when the areas or the ground under them changed. */
  rebuild(force = false) {
    const sig = signature(this._list);
    const model = this.model();
    if (!force && sig === this._sig && model === this._model) return false;
    this._sig = sig;
    this._model = model;
    this.clear();
    for (const raw of this._list) {
      const a = normalizeArea(raw, this.size);
      if (!a) continue;
      const g = buildAreaGeometry(a, this.cellTopQ);
      if (!g.index.length) continue;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(g.position, 3));
      geo.setAttribute("normal", new THREE.Float32BufferAttribute(g.normal, 3));
      geo.setAttribute("aWall", new THREE.Float32BufferAttribute(g.aWall, 2));
      geo.setAttribute("aCorner", new THREE.Float32BufferAttribute(g.aCorner, 2));
      geo.setAttribute("aLift", new THREE.Float32BufferAttribute(g.aLift, 1));
      geo.setAttribute("aKind", new THREE.Float32BufferAttribute(g.aKind, 1));
      geo.setIndex(g.index);
      geo.computeBoundingSphere();
      const u = areaUniforms(this.shared);
      const body = cssRgb(a.color, PALETTE.accent);
      const hot = a.hot ? cssRgb(a.hot, PALETTE.accent) : body.map((c) => c + (1 - c) * 0.55);
      u.uColor.value.set(...body);
      u.uHot.value.set(...hot);
      u.uRef.value = g.ref;
      u.uPeak.value = g.peak;
      const mat = new THREE.ShaderMaterial({
        name: "dio.area",
        vertexShader: AREA_VERT,
        fragmentShader: AREA_FRAG,
        uniforms: u,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        side: THREE.FrontSide,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.renderOrder = 16;
      mesh.userData.areaId = a.id;
      this.group.add(mesh);
      this.meshes.push(mesh);
    }
    this._motion = null;
    return true;
  }

  /**
   * @param {number} now  ms
   * @param {{areaVolumes:boolean, areaMotion:boolean}} fx
   * @returns {boolean} true while the glow band moves
   */
  frame(now, fx) {
    const on = fx?.areaVolumes !== false;
    this.group.visible = on;
    // a new terrain or grid under the same areas
    if (on && this._list.length && (this.model() !== this._model || !this._sig)) this.rebuild();
    if (!on || !this.meshes.length) return false;
    const motion = fx?.areaMotion !== false;
    const P = TIMING.areaDrift;
    const phase = motion ? (now % P) / P : 0;
    if (motion || this._motion !== motion) {
      for (const m of this.meshes) {
        m.material.uniforms.uPhase.value = phase;
        m.material.uniforms.uMotion.value = motion ? 1 : 0;
      }
      this._motion = motion;
    }
    return motion;
  }

  dispose() {
    this.clear();
  }
}
