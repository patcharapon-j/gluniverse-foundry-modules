/**
 * Diorama — the fog of war as dark drifting mist. Pure (no game/canvas/foundry):
 * it draws from the vision bake the renderer is handed (setLighting `vision`).
 *
 * Three parts, one look (glsl.mjs FOG_FRAG, FOG_BACKDROP_FRAG and LIT
 * dioFogOfWar):
 *   • The bank: FOG_LAYERS sheets over the board, lying along the ground
 *     blurred over a few squares (the atmosphere layer's height texture), the
 *     floor with a curtain down the board's sides to the plinth. The floor is a
 *     dark slate, dense over the unseen and fading out across the soft map; the
 *     sheets above are thin translucent wisps along the wind that reach a little
 *     past the edge.
 *   • The backdrop: ground nobody has seen draws nothing at all, so behind the
 *     bank a box over the board's whole footprint is drawn from inside at the
 *     far plane in the floor's mist (`backdrop`). It reads no terrain, so the
 *     only shape it can show is the board's bounding box; whatever is seen draws
 *     over it, and no ray into the board finds a hole. Where to paint it reads
 *     the COVERAGE map built here (fogCoverage): the unseen grown far enough
 *     that a ray's sparse taps cannot step over a narrow patch of it.
 *   • The reveal: every lit surface near unseen ground falls into shadow in the
 *     fog's colour, reaching it exactly where the floor begins, and ground out of
 *     sight now fades to its remembered look under a faint mist. Both read the
 *     SOFT map built here: the vision bake drawn down to FOG_PX per cell and
 *     blurred over most of a cell.
 *
 * The GM (no vision bake) and the flat style draw none of it: the uniforms say
 * off, the sheets discard, and the surfaces look exactly as before.
 *
 * Contract with renderer.mjs:
 *   new FogLayer(shared)
 *   .group
 *   .setGridSize(px)
 *   .setVision(canvas|null)           the vision bake (R visible, G explored), world-space
 *   .setGround(fn) / .refreshTop()    (i, j) → a cell's top (cells): the backdrop's box
 *                                     stands over the highest SEEN ground only
 *   .frame(dt, fx) → bool             true while the clouds drift
 *   .dispose()
 */

import * as THREE from "./three.mjs";
import { MATERIALS } from "./materials.mjs";
import { FOG_LAYERS, FOG_RAY_TAPS } from "./glsl.mjs";
import { TIMING } from "../constants.mjs";

export { FOG_LAYERS };
/** The soft map's resolution, px per cell. */
export const FOG_PX = 6;
/** Its blur, in cells: the width of the shadow the unseen casts into sight. */
export const FOG_BLUR = 0.75;
/** The floor of the bank over the highest ground it covers, and the step between sheets (cells). */
export const FOG_FLOOR = 0.06;
export const FOG_STEP = 0.26;
/**
 * The edge of sight (the soft map's B channel, fogEdge): the unseen grown by
 * FOG_EDGE_GROW and softened over FOG_EDGE_SOFT (cells), so the mist reaches its
 * full colour AT the hard line where the ground stops being drawn, however
 * narrow the unseen patch is. The wide blur (FOG_BLUR) alone never gets there
 * over a thin wedge behind a pillar, and the ground then ends in a hard dark cut.
 */
export const FOG_EDGE_GROW = 0.25;
export const FOG_EDGE_SOFT = 0.2;
/** Cells the fog drifts down the wind per TIMING.fogDrift (glsl.mjs dioFogNoise FOG_DRIFT_CELLS). */
export const FOG_DRIFT_CELLS = 3;
const MAX_SIDE = 2048;

/** Most vertices along a side of one sheet (a big map gets coarser cells, not more vertices). */
export const FOG_MAX_SIDE = 160;

/** The backdrop's coverage map: texels per cell, at most, and its longest side. */
export const FOG_COVER_PX = 2;
const COVER_MAX_SIDE = 1024;

/*
 * The backdrop's coverage map (FOG_BACKDROP_FRAG reads it, nearest filtered).
 *
 * The backdrop tests a pixel's ray at FOG_RAY_TAPS points spread evenly over the
 * ray's run through the board's box, each in the middle of its own stretch. On
 * the map (x, z) that run is a segment inside the board's rectangle, so it is
 * at most the board's diagonal D long, the taps lie at most D / TAPS apart, and
 * every point of the run is within R = D / (2 · TAPS) of a tap. On a 40 × 40
 * board that is 1.18 squares: a one-square unseen patch can sit between two
 * taps that both read explored, and the backdrop would leave the room showing.
 *
 * So the map is the unseen grown by R. First every texel is marked that an
 * unseen bake pixel, widened by one bake pixel either side (the reach of the
 * bilinear lookup the ground's own discard uses), touches: any point the ground
 * discards lies in a marked texel. Then each mark is spread to every texel
 * within ceil(R / texel) on each axis, a square that holds the disc of radius R.
 * The tap nearest an unseen point is within R of it, so within that many texels
 * on both axes, so it reads a mark. Covering more is harmless: the backdrop is
 * at the far plane, and wherever something seen is drawn it draws over it.
 */

/** How many texels a mark is spread on each axis, for a board of cols × rows in a w × h map. */
export function fogCoverReach(cols, rows, w, h, taps = FOG_RAY_TAPS) {
  const r = Math.hypot(cols, rows) / (2 * Math.max(1, taps));
  return { x: Math.ceil(r / (cols / w)), z: Math.ceil(r / (rows / h)), r };
}

/**
 * @param {Uint8ClampedArray|Uint8Array} rgba  the vision bake's pixels (G explored; visible is explored)
 * @param {number} vw @param {number} vh       the bake's size, px
 * @param {number} cols @param {number} rows   the board, cells
 * @returns {{data:Uint8Array, width:number, height:number, reach:{x:number, z:number, r:number}}}
 *   one byte a texel, 255 where the backdrop may paint
 */
export function fogCoverage(rgba, vw, vh, cols, rows, taps = FOG_RAY_TAPS) {
  const w = Math.max(1, Math.min(COVER_MAX_SIDE, Math.ceil(cols * FOG_COVER_PX)));
  const h = Math.max(1, Math.min(COVER_MAX_SIDE, Math.ceil(rows * FOG_COVER_PX)));
  // the texels a bake pixel touches, widened by a bake pixel either side
  const span = (n, from, to) => {
    const lo = new Int32Array(n), hi = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      lo[i] = Math.max(0, Math.floor(((i - 1) * to) / from));
      hi[i] = Math.min(to - 1, Math.ceil(((i + 2) * to) / from) - 1);
    }
    return [lo, hi];
  };
  const [x0, x1] = span(vw, vw, w), [y0, y1] = span(vh, vh, h);
  // Unseen runs along each bake row as texel columns, then runs down each texel
  // column as texel rows. Neighbouring pixels' spans overlap end to end, so a run
  // marks exactly what its pixels would one by one, and each texel is written once
  // per run rather than once per bake pixel over it (a bake holds many per texel).
  const across = new Uint8Array(vh * w);
  for (let y = 0; y < vh; y++) {
    const row = y * vw, out = y * w;
    for (let x = 0; x < vw; x++) {
      if (rgba[(row + x) * 4 + 1] > 127) continue;
      const a = x;
      while (x + 1 < vw && rgba[(row + x + 1) * 4 + 1] <= 127) x++;
      across.fill(255, out + x0[a], out + x1[x] + 1);
    }
  }
  // the column runs are walked row by row (a run opens where the row above is clear)
  const mark = new Uint8Array(w * h);
  const start = new Int32Array(w);
  for (let y = 0; y < vh; y++) {
    const at = y * w;
    for (let tx = 0; tx < w; tx++) {
      if (!across[at + tx]) continue;
      if (y === 0 || !across[at - w + tx]) start[tx] = y;
      if (y + 1 < vh && across[at + w + tx]) continue;
      for (let ty = y0[start[tx]]; ty <= y1[y]; ty++) mark[ty * w + tx] = 255;
    }
  }
  const reach = fogCoverReach(cols, rows, w, h, taps);
  // spread each mark over a square, one axis at a time
  const grow = (src, n, lines, k, at) => {
    const out = new Uint8Array(src.length);
    for (let l = 0; l < lines; l++) {
      let last = -Infinity;
      for (let i = 0; i < n; i++) { if (src[at(l, i)]) last = i; if (i - last <= k) out[at(l, i)] = 255; }
      last = Infinity;
      for (let i = n - 1; i >= 0; i--) { if (src[at(l, i)]) last = i; if (last - i <= k) out[at(l, i)] = 255; }
    }
    return out;
  };
  const rowsDone = grow(mark, w, h, reach.x, (l, i) => l * w + i);
  const data = grow(rowsDone, h, w, reach.z, (l, i) => i * w + l);
  return { data, width: w, height: h, reach };
}

/**
 * The soft map's edge channel: how near a texel is to ground nobody has seen,
 * 0..255. The never-seen (255 − G) is grown by `grow` texels (a square max
 * filter: more mist, never less) then softened by two box blurs of `soften`
 * texels. Only ever widens the unseen, so it cannot show anything the bake hides.
 * @param {Uint8ClampedArray|Uint8Array} rgba  the bake drawn down to the soft map's size
 * @returns {Uint8ClampedArray} one byte a texel
 */
export function fogEdge(rgba, w, h, grow, soften) {
  const n = w * h;
  let a = new Uint8ClampedArray(n);
  for (let k = 0; k < n; k++) a[k] = 255 - rgba[k * 4 + 1];
  // one pass along each row (dx) or column, by a running window (max or mean)
  const pass = (src, r, along, op) => {
    if (r <= 0) return src;
    const out = new Uint8ClampedArray(n);
    const lines = along ? h : w, len = along ? w : h;
    const at = along ? (l, i) => l * w + i : (l, i) => i * w + l;
    for (let l = 0; l < lines; l++) {
      for (let i = 0; i < len; i++) {
        const i0 = Math.max(0, i - r), i1 = Math.min(len - 1, i + r);
        let v = 0;
        if (op === "max") { for (let q = i0; q <= i1; q++) { const s = src[at(l, q)]; if (s > v) v = s; } }
        else { for (let q = i0; q <= i1; q++) v += src[at(l, q)]; v /= i1 - i0 + 1; }
        out[at(l, i)] = v;
      }
    }
    return out;
  };
  a = pass(pass(a, grow, true, "max"), grow, false, "max");
  for (let k = 0; k < 2; k++) a = pass(pass(a, soften, true, "mean"), soften, false, "mean");
  return a;
}

/**
 * The cells the party has seen any of (one byte a cell, 1 seen): the cells that
 * hold an explored bake pixel. Never widened, so no unseen cell is counted.
 * @returns {Uint8Array} cols × rows, row-major
 */
export function fogSeenCells(rgba, vw, vh, cols, rows) {
  const out = new Uint8Array(Math.max(1, cols * rows));
  const cx = new Int32Array(vw);
  for (let x = 0; x < vw; x++) cx[x] = Math.min(cols - 1, Math.floor((x * cols) / vw));
  for (let y = 0; y < vh; y++) {
    const cy = Math.min(rows - 1, Math.floor((y * rows) / vh)) * cols, row = y * vw;
    for (let x = 0; x < vw; x++) if (rgba[(row + x) * 4 + 1] > 127) out[cy + cx[x]] = 1;
  }
  return out;
}

/**
 * The highest ground the party has seen (cells), the top of the mist backdrop's
 * box: -Infinity when they have seen none. Unseen ground is never read, so the
 * box cannot stand as tall as a tower hidden in it.
 * @param {Uint8Array} seen   fogSeenCells
 * @param {(i:number, j:number) => number} cellTop   a cell's top, cells (row i, column j)
 */
export function fogSeenTop(seen, cols, rows, cellTop) {
  let top = -Infinity;
  if (!seen || typeof cellTop !== "function") return top;
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
    if (!seen[i * cols + j]) continue;
    const h = Number(cellTop(i, j));
    if (Number.isFinite(h) && h > top) top = h;
  }
  return top;
}

/** Cells between two vertices of the bank for a board this size. */
export function fogCell(cols, rows) {
  return Math.max(1, Math.ceil(Math.max(cols, rows, 1) / FOG_MAX_SIDE));
}

/**
 * The bank: FOG_LAYERS grids over [0, cols] × [0, rows] (the vertex shader
 * drapes each over the ground), floor first, the floor followed by its curtain
 * down the board's four sides (`skirt` 1 on the curtain's foot).
 */
export function fogGeometry(cols, rows, cell = fogCell(cols, rows)) {
  const g = new THREE.BufferGeometry();
  const nx = Math.max(1, Math.ceil(cols / cell)), nz = Math.max(1, Math.ceil(rows / cell));
  const xs = Array.from({ length: nx + 1 }, (_, i) => Math.min(cols, i * cell));
  const zs = Array.from({ length: nz + 1 }, (_, j) => Math.min(rows, j * cell));
  const pos = [], layer = [], skirt = [], index = [];
  const vert = (x, z, k, s) => { pos.push(x, 0, z); layer.push(k); skirt.push(s); return layer.length - 1; };
  for (let k = 0; k < FOG_LAYERS; k++) {
    const b = layer.length;
    for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) vert(xs[i], zs[j], k, 0);
    const at = (i, j) => b + j * (nx + 1) + i;
    // wound to face up (+y), drawn in layer order
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      index.push(at(i, j), at(i, j + 1), at(i + 1, j + 1), at(i, j), at(i + 1, j + 1), at(i + 1, j));
    }
    if (k !== 0) continue;
    // the curtain: a strip down each side, a hair inside the board so it samples the board's vision
    const e = 1e-3;
    const side = (pts) => {
      for (let n = 0; n + 1 < pts.length; n++) {
        const [x0, z0] = pts[n], [x1, z1] = pts[n + 1];
        const a = vert(x0, z0, 0, 0), c = vert(x1, z1, 0, 0), d = vert(x1, z1, 0, 1), f = vert(x0, z0, 0, 1);
        index.push(a, c, d, a, d, f);
      }
    };
    side(xs.map((x) => [x, e]));
    side(xs.map((x) => [x, rows - e]));
    side(zs.map((z) => [e, z]));
    side(zs.map((z) => [cols - e, z]));
  }
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute("layer", new THREE.BufferAttribute(new Float32Array(layer), 1));
  g.setAttribute("skirt", new THREE.BufferAttribute(new Float32Array(skirt), 1));
  g.setIndex(index);
  return g;
}

export class FogLayer {
  /**
   * @param {object} shared
   * @param {{height?:{value:any}, heightInfo?:{value:any}}} [ground]  the atmosphere layer's
   *   ground lookup (AtmosphereLayer.height / .heightInfo), by reference
   */
  constructor(shared, { height, heightInfo } = {}) {
    this.shared = shared;
    this.group = new THREE.Group();
    this.group.name = "dio.fog";
    this.gridSize = 100;
    this._size = [0, 0];
    this.cell = { value: 1 };
    this.material = MATERIALS.fog(shared, { layers: FOG_LAYERS, height, heightInfo, cell: this.cell });
    this.material.uniforms.uFogLevel.value.set(FOG_FLOOR, FOG_STEP);
    this.mesh = new THREE.Mesh(fogGeometry(1, 1), this.material);
    this.mesh.name = "dio.fog.bank";
    this.mesh.frustumCulled = false;
    // after the board and the water, before effects, flames and weather
    this.mesh.renderOrder = 18;
    this.group.add(this.mesh);
    // a unit box the vertex shader stretches over the board (FOG_BACKDROP_VERT)
    const box = new THREE.BoxGeometry(1, 1, 1);
    box.translate(0.5, 0.5, 0.5);
    this.backdrop = new THREE.Mesh(box, MATERIALS.fogBackdrop(shared));
    // the coverage map (fogCoverage); until there is one, nothing is hidden
    this.cover = this.backdrop.material.uniforms.uFogCover;
    this._noCover = this.cover.value;
    this.coverTexture = null;
    // the box's top: the highest ground seen (fogSeenTop), written each frame
    this.top = this.backdrop.material.uniforms.uFogTop;
    /** (i, j) → a cell's top (cells), the drawn ground; the renderer sets it. */
    this.cellTop = null;
    this._seenCells = null;
    this._seenDims = [0, 0];
    this._seenTop = -Infinity;
    this.backdrop.name = "dio.fog.backdrop";
    this.backdrop.frustumCulled = false;
    this.backdrop.raycast = () => {};
    this.backdrop.renderOrder = -900;   // after the room's own backdrop, which draws over everything it follows
    this.backdrop.visible = false;
    this.group.add(this.backdrop);
    this._blank = shared.uFogMap.value;
    this.soft = null;
    this.texture = null;
    this.hasVision = false;
    this._t = 0;
  }

  setGridSize(px) { this.gridSize = px || 100; }

  /**
   * Where the ground is, for the backdrop's height: (i, j) → a cell's top in
   * cells. Called again when the terrain changes.
   * @param {((i:number, j:number) => number)|null} fn
   */
  setGround(fn) {
    this.cellTop = typeof fn === "function" ? fn : null;
    this.refreshTop();
  }

  /** The highest seen ground, from the last bake's seen cells and the ground. */
  refreshTop() {
    const [c, r] = this._seenDims;
    this._seenTop = this._seenCells ? fogSeenTop(this._seenCells, c, r, this.cellTop) : -Infinity;
  }

  /** Rebuild the bank's quads when the board's size changes. */
  fitBoard() {
    const ws = this.shared.uWorldSize.value;
    if (ws.x === this._size[0] && ws.y === this._size[1]) return;
    this._size = [ws.x, ws.y];
    const cols = Math.max(1, ws.x), rows = Math.max(1, ws.y);
    this.cell.value = fogCell(cols, rows);
    this.mesh.geometry.dispose();
    this.mesh.geometry = fogGeometry(cols, rows, this.cell.value);
  }

  /**
   * The vision bake changed (or went away). Builds the soft map: the bake
   * drawn down to FOG_PX per cell, then blurred over itself, so the board's
   * own edge keeps its value instead of fading to nothing.
   * @param {HTMLCanvasElement|null} vision
   */
  setVision(vision) {
    this.hasVision = !!vision;
    if (!vision || typeof document === "undefined") {
      this.shared.uFogMap.value = this._blank;
      this.cover.value = this._noCover;
      return;
    }
    const ws = this.shared.uWorldSize.value;
    this.setCoverage(vision, ws.x, ws.y);
    const ppc = Math.max(2, Math.min(FOG_PX, Math.floor(MAX_SIDE / Math.max(ws.x, ws.y, 1))));
    const w = Math.max(1, Math.round(ws.x * ppc)), h = Math.max(1, Math.round(ws.y * ppc));
    if (!this.soft) this.soft = document.createElement("canvas");
    const c = this.soft;
    if (c.width !== w || c.height !== h) {
      c.width = w; c.height = h;
      this.texture?.dispose();
      this.texture = null;
    }
    const g = c.getContext("2d");
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = "source-over";
    g.imageSmoothingEnabled = true;
    g.filter = "none";
    g.drawImage(vision, 0, 0, w, h);
    // B: the edge of sight, from the bake as drawn down (before the wide blur)
    let edge = null;
    try {
      edge = fogEdge(g.getImageData(0, 0, w, h).data, w, h,
        Math.max(1, Math.round(FOG_EDGE_GROW * ppc)), Math.max(1, Math.round(FOG_EDGE_SOFT * ppc)));
    } catch (e) { edge = null; }
    if ("filter" in g) {
      g.filter = `blur(${(FOG_BLUR * ppc).toFixed(2)}px)`;
      g.drawImage(vision, 0, 0, w, h);
      g.filter = "none";
    }
    if (edge) {
      const img = g.getImageData(0, 0, w, h);
      const d = img.data;
      for (let k = 0; k < edge.length; k++) d[k * 4 + 2] = edge[k];
      g.putImageData(img, 0, 0);
    }
    if (!this.texture) {
      const t = new THREE.CanvasTexture(c);
      t.flipY = false;
      t.generateMipmaps = false;
      t.minFilter = THREE.LinearFilter;
      t.magFilter = THREE.LinearFilter;
      t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
      this.texture = t;
    } else {
      this.texture.needsUpdate = true;
    }
    this.shared.uFogMap.value = this.texture;
  }

  /**
   * Rebuild the backdrop's coverage map from the bake's own pixels (fogCoverage).
   * A bake that cannot be read leaves every texel marked: the mist then fills
   * the whole box behind whatever is seen, which hides nothing it should show.
   */
  setCoverage(vision, cols, rows) {
    let cov;
    try {
      const vw = vision.width, vh = vision.height;
      let g = vision.getContext?.("2d");
      if (!g) {
        const tmp = document.createElement("canvas");
        tmp.width = vw; tmp.height = vh;
        g = tmp.getContext("2d");
        g.drawImage(vision, 0, 0);
      }
      const px = g.getImageData(0, 0, vw, vh).data;
      const C = Math.max(1, Math.round(cols)), R = Math.max(1, Math.round(rows));
      cov = fogCoverage(px, vw, vh, Math.max(1, cols), Math.max(1, rows));
      this._seenCells = fogSeenCells(px, vw, vh, C, R);
      this._seenDims = [C, R];
    } catch (e) {
      console.warn("GLUniverse Suite | diorama: fog coverage fell back to the whole board", e);
      cov = { data: new Uint8Array([255]), width: 1, height: 1 };
      // nothing known to be seen: the box stays on the lowest ground
      this._seenCells = null;
    }
    this.refreshTop();
    let t = this.coverTexture;
    if (!t || t.image.width !== cov.width || t.image.height !== cov.height) {
      t?.dispose();
      t = new THREE.DataTexture(cov.data, cov.width, cov.height, THREE.RedFormat, THREE.UnsignedByteType);
      t.unpackAlignment = 1;   // rows of one byte a texel, any width
      t.flipY = false;
      t.generateMipmaps = false;
      t.minFilter = t.magFilter = THREE.NearestFilter;
      t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
      this.coverTexture = t;
    } else {
      t.image.data = cov.data;
    }
    t.needsUpdate = true;
    this.cover.value = t;
  }

  /** Whether the clouds are drawn, and drift, this frame. */
  on(fx) { return !!fx?.fog && this.hasVision; }
  animated(fx) { return this.on(fx) && fx.fogDrift !== false; }

  /**
   * @param {number} dt  seconds
   * @param {object} fx  effectiveFx(): fog (0 flat / 1 clouds), fogDrift
   * @returns {boolean} true while the clouds drift
   */
  frame(dt, fx) {
    this.fitBoard();
    const on = this.on(fx);
    this.mesh.visible = on;
    this.backdrop.visible = on;
    const s = this.shared.uFogStyle.value;
    s.x = on ? 1 : 0;
    // the box's top: the highest SEEN ground, inside the board's own range; none seen, the lowest
    const hr = this.shared.uHeightRange?.value;
    const lo = hr ? hr.x : 0, hi = hr ? hr.y : 1;
    this.top.value = Number.isFinite(this._seenTop) ? Math.min(hi, Math.max(lo, this._seenTop)) : lo;
    // the clock ticks once per TIMING.fogDrift; the shader moves FOG_DRIFT_CELLS per tick
    const drift = this.animated(fx);
    if (drift) this._t += (dt * 1000) / TIMING.fogDrift;
    s.y = this._t;
    return drift;
  }

  /** Cells the floor's mist drifts per second (for the docs and the check). */
  static cellsPerSecond() {
    return (FOG_DRIFT_CELLS * 1000) / TIMING.fogDrift;
  }

  dispose() {
    this.group.remove(this.mesh, this.backdrop);
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.backdrop.geometry.dispose();
    this.backdrop.material.dispose();
    this.coverTexture?.dispose();
    this._noCover?.dispose?.();
    this.texture?.dispose();
    this.shared.uFogMap.value = this._blank;
    this._blank.dispose();
  }
}
