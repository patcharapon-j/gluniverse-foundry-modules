/**
 * Diorama — the fog of war as cloud. Pure (no game/canvas/foundry): it draws
 * from the vision bake the renderer is handed (setLighting `vision`).
 *
 * Two parts, one look (glsl.mjs FOG_FRAG and LIT dioFogOfWar):
 *   • The bank: FOG_LAYERS sheets over the board, draped over the highest
 *     ground around each vertex (the atmosphere layer's height texture), the
 *     floor with a curtain down the board's sides to the plinth. The floor is
 *     opaque on every point the bake says nobody has seen (the same threshold
 *     the surfaces discard by), so nothing under it is drawn or shows through;
 *     the sheets above are cloud tops, thinner and pulled back from the edge.
 *   • The shoulder: every lit surface near unseen ground fades into the same
 *     cloud colour, reaching it exactly where the floor begins, and seen-before
 *     ground gets a thin low mist. Both read the SOFT map built here: the vision
 *     bake drawn down to FOG_PX per cell and blurred about half a cell.
 *
 * The GM (no vision bake) and the flat style draw none of it: the uniforms say
 * off, the sheets discard, and the surfaces look exactly as before.
 *
 * Contract with renderer.mjs:
 *   new FogLayer(shared)
 *   .group
 *   .setGridSize(px)
 *   .setVision(canvas|null)           the vision bake (R visible, G explored), world-space
 *   .frame(dt, fx) → bool             true while the clouds drift
 *   .dispose()
 */

import * as THREE from "./three.mjs";
import { MATERIALS } from "./materials.mjs";
import { FOG_LAYERS } from "./glsl.mjs";
import { TIMING } from "../constants.mjs";

export { FOG_LAYERS };
/** The soft map's resolution, px per cell. */
export const FOG_PX = 6;
/** Its blur, in cells (about half a cell either side of the edge of sight). */
export const FOG_BLUR = 0.42;
/** The floor of the bank over the highest ground it covers, and the step between sheets (cells). */
export const FOG_FLOOR = 0.06;
export const FOG_STEP = 0.22;
/** Cloud features per cell in the floor's noise (FOG_FRAG dioCloudNoise: xz × 0.42). */
const NOISE_PER_CELL = 0.42;
const MAX_SIDE = 2048;

/** Most vertices along a side of one sheet (a big map gets coarser cells, not more vertices). */
export const FOG_MAX_SIDE = 160;

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
    this._blank = shared.uFogMap.value;
    this.soft = null;
    this.texture = null;
    this.hasVision = false;
    this._t = 0;
  }

  setGridSize(px) { this.gridSize = px || 100; }

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
      return;
    }
    const ws = this.shared.uWorldSize.value;
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
    if ("filter" in g) {
      g.filter = `blur(${(FOG_BLUR * ppc).toFixed(2)}px)`;
      g.drawImage(vision, 0, 0, w, h);
      g.filter = "none";
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
    const s = this.shared.uFogStyle.value;
    s.x = on ? 1 : 0;
    // the clock is in cloud features: one (1 / NOISE_PER_CELL cells) drifts by per TIMING.fogDrift
    const drift = this.animated(fx);
    if (drift) this._t += (dt * 1000) / TIMING.fogDrift;
    s.y = this._t;
    return drift;
  }

  /** Cells the floor's clouds drift per second (for the docs and the check). */
  static cellsPerSecond() {
    return 1000 / TIMING.fogDrift / NOISE_PER_CELL;
  }

  dispose() {
    this.group.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.texture?.dispose();
    this.shared.uFogMap.value = this._blank;
    this._blank.dispose();
  }
}
