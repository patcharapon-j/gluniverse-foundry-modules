/**
 * Diorama editor — Auto setup: a rough first draft of a scene's terrain.
 *
 * Pure and deterministic: the same map and walls always give the same draft,
 * so a GM who presses it twice gets the same thing twice and the check can pin
 * it. Heights are left at 0; heights are the GM's job. What this does:
 *
 *   1. k-means (small k, initialised from luminance quantiles, no randomness)
 *      over the per-sub-cell map colours, inside the scene rect only;
 *   2. each cluster is classed by its centroid: near-black → dark, blue/cyan
 *      with some saturation → water, anything else → floor;
 *   3. one 3×3 majority pass removes speckle (a blue banner is not a pool);
 *   4. rooms: cells are flood-filled from the scene border across grid edges no
 *      wall crosses. Whatever the flood cannot reach is enclosed by walls, i.e.
 *      a room, and a room is floor even where its art is dark;
 *   5. dark outside rooms → VOID (the black around a dungeon), water → WATER
 *      (the palette's water entry, slightly below 0), the rest floor at 0, and
 *      everything outside the scene rect VOID.
 */

import { SUB, KIND } from "../constants.mjs";
import { Terrain } from "../terrain/model.mjs";

export const AUTO = Object.freeze({
  k: 6,
  iterations: 10,
  /** Train k-means on at most this many sub-cells (strided, deterministic). */
  sample: 30000,
});

const CLS = Object.freeze({ FLOOR: 0, WATER: 1, DARK: 2 });

/** Classify one colour (0..255 channels). Exported for the check. */
export function classifyColour(r, g, b) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const v = max / 255;
  const s = max ? (max - min) / max : 0;
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  if (v < 0.16 && lum < 36) return "void";
  let hue = 0;
  if (max !== min) {
    const d = max - min;
    if (max === r) hue = 60 * (((g - b) / d) % 6);
    else if (max === g) hue = 60 * ((b - r) / d + 2);
    else hue = 60 * ((r - g) / d + 4);
    if (hue < 0) hue += 360;
  }
  if (hue >= 170 && hue <= 250 && s >= 0.25 && v >= 0.2 && b >= r) return "water";
  return "floor";
}

/** k-means over RGB points (indices into `colours`), deterministic. */
function kmeans(colours, points, k, iterations) {
  if (!points.length) return { centroids: [], assign: new Int32Array(0) };
  const lum = (p) => 0.2126 * colours[p * 3] + 0.7152 * colours[p * 3 + 1] + 0.0722 * colours[p * 3 + 2];
  const byLum = points.slice().sort((a, b) => lum(a) - lum(b) || a - b);
  const kk = Math.max(1, Math.min(k, points.length));
  const C = [];
  for (let c = 0; c < kk; c++) {
    const p = byLum[Math.min(byLum.length - 1, Math.floor(((c + 0.5) / kk) * byLum.length))];
    C.push([colours[p * 3], colours[p * 3 + 1], colours[p * 3 + 2]]);
  }
  const assign = new Int32Array(points.length);
  for (let it = 0; it < iterations; it++) {
    const sum = C.map(() => [0, 0, 0, 0]);
    for (let n = 0; n < points.length; n++) {
      const p = points[n] * 3;
      let best = 0, bestD = Infinity;
      for (let c = 0; c < C.length; c++) {
        const dr = colours[p] - C[c][0], dg = colours[p + 1] - C[c][1], db = colours[p + 2] - C[c][2];
        const d = dr * dr + dg * dg + db * db;
        if (d < bestD) { bestD = d; best = c; }
      }
      assign[n] = best;
      const s = sum[best];
      s[0] += colours[p]; s[1] += colours[p + 1]; s[2] += colours[p + 2]; s[3]++;
    }
    let moved = false;
    for (let c = 0; c < C.length; c++) {
      const s = sum[c];
      if (!s[3]) continue;                  // empty cluster keeps its centroid
      const nc = [s[0] / s[3], s[1] / s[3], s[2] / s[3]];
      if (Math.abs(nc[0] - C[c][0]) + Math.abs(nc[1] - C[c][1]) + Math.abs(nc[2] - C[c][2]) > 0.01) moved = true;
      C[c] = nc;
    }
    if (!moved) break;
  }
  return { centroids: C };
}

const nearest = (C, r, g, b) => {
  let best = 0, bestD = Infinity;
  for (let c = 0; c < C.length; c++) {
    const dr = r - C[c][0], dg = g - C[c][1], db = b - C[c][2];
    const d = dr * dr + dg * dg + db * db;
    if (d < bestD) { bestD = d; best = c; }
  }
  return best;
};

/** Do segments p1p2 and p3p4 intersect (touching counts)? */
export function segmentsCross(x1, y1, x2, y2, x3, y3, x4, y4) {
  const o = (ax, ay, bx, by, cx, cy) => {
    const v = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    return Math.abs(v) < 1e-9 ? 0 : Math.sign(v);
  };
  const on = (ax, ay, bx, by, cx, cy) => Math.min(ax, bx) - 1e-9 <= cx && cx <= Math.max(ax, bx) + 1e-9
    && Math.min(ay, by) - 1e-9 <= cy && cy <= Math.max(ay, by) + 1e-9;
  const d1 = o(x3, y3, x4, y4, x1, y1), d2 = o(x3, y3, x4, y4, x2, y2);
  const d3 = o(x1, y1, x2, y2, x3, y3), d4 = o(x1, y1, x2, y2, x4, y4);
  if (d1 * d2 < 0 && d3 * d4 < 0) return true;
  if (d1 === 0 && on(x3, y3, x4, y4, x1, y1)) return true;
  if (d2 === 0 && on(x3, y3, x4, y4, x2, y2)) return true;
  if (d3 === 0 && on(x1, y1, x2, y2, x3, y3)) return true;
  if (d4 === 0 && on(x1, y1, x2, y2, x4, y4)) return true;
  return false;
}

/**
 * Which grid links a wall blocks. A link joins two 4-adjacent cell centres; a
 * wall blocks it when the wall segment crosses that centre-to-centre line.
 * @returns {{east: Uint8Array, south: Uint8Array}} east[i·cols+j]: (i,j)↔(i,j+1);
 *   south[i·cols+j]: (i,j)↔(i+1,j)
 */
export function blockedLinks(walls, cols, rows, gridSize) {
  const east = new Uint8Array(cols * rows), south = new Uint8Array(cols * rows);
  for (const w of walls ?? []) {
    const ax = w.a[0] / gridSize, ay = w.a[1] / gridSize, bx = w.b[0] / gridSize, by = w.b[1] / gridSize;
    const i0 = Math.max(0, Math.floor(Math.min(ay, by) - 0.5) - 1), i1 = Math.min(rows - 1, Math.ceil(Math.max(ay, by) - 0.5) + 1);
    const j0 = Math.max(0, Math.floor(Math.min(ax, bx) - 0.5) - 1), j1 = Math.min(cols - 1, Math.ceil(Math.max(ax, bx) - 0.5) + 1);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const cx = j + 0.5, cy = i + 0.5;
        if (j + 1 < cols && segmentsCross(cx, cy, cx + 1, cy, ax, ay, bx, by)) east[i * cols + j] = 1;
        if (i + 1 < rows && segmentsCross(cx, cy, cx, cy + 1, ax, ay, bx, by)) south[i * cols + j] = 1;
      }
    }
  }
  return { east, south };
}

/**
 * Cells enclosed by walls: inside the scene and unreachable from its border.
 * @returns {Uint8Array} 1 = room cell
 */
export function enclosedCells(cols, rows, inside, links) {
  const reached = new Uint8Array(cols * rows);
  const isIn = (i, j) => i >= 0 && j >= 0 && i < rows && j < cols && inside(i, j);
  const queue = [];
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      if (!isIn(i, j)) continue;
      if (!isIn(i - 1, j) || !isIn(i + 1, j) || !isIn(i, j - 1) || !isIn(i, j + 1)) {
        reached[i * cols + j] = 1;
        queue.push(i * cols + j);
      }
    }
  }
  for (let q = 0; q < queue.length; q++) {
    const k = queue[q];
    const i = (k / cols) | 0, j = k - i * cols;
    const step = (ni, nj, blocked) => {
      if (blocked || !isIn(ni, nj)) return;
      const n = ni * cols + nj;
      if (reached[n]) return;
      reached[n] = 1;
      queue.push(n);
    };
    step(i, j + 1, links.east[k]);
    step(i + 1, j, links.south[k]);
    step(i, j - 1, j > 0 ? links.east[k - 1] : 1);
    step(i - 1, j, i > 0 ? links.south[k - cols] : 1);
  }
  const room = new Uint8Array(cols * rows);
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
    if (isIn(i, j) && !reached[i * cols + j]) room[i * cols + j] = 1;
  }
  return room;
}

/** Find (or append) the palette entries auto setup writes. */
function layersFor(t) {
  const P = t.palette;
  let floor = P.findIndex((p) => p.kind === KIND.FLOOR && p.h === 0);
  if (floor < 0) { P.push({ name: "Floor", h: 0, color: "#9fb07a", kind: KIND.FLOOR, material: "earth" }); floor = P.length - 1; }
  let vd = P.findIndex((p) => p.kind === KIND.VOID);
  if (vd < 0) { P.push({ name: "Void", h: 0, color: "#20242c", kind: KIND.VOID, material: "edge" }); vd = P.length - 1; }
  let water = P.findIndex((p) => p.kind === KIND.WATER);
  if (water < 0) { P.push({ name: "Water", h: -1, color: "#3a7dbb", kind: KIND.WATER, material: "earth" }); water = P.length - 1; }
  return { floor, void: vd, water };
}

/**
 * Auto setup with its working: the draft plus what it decided.
 * @param {object} o
 * @param {Uint8Array} o.colours   RGB averages per sub-cell, row-major over (rows·SUB)×(cols·SUB)
 * @param {number} o.cols
 * @param {number} o.rows
 * @param {Array<{a:number[], b:number[]}>} [o.walls]  wall segments, px
 * @param {number} o.gridSize
 * @param {(i:number, j:number) => boolean} [o.sceneInside]
 * @param {object[]} [o.palette]   palette to keep (the draft's); default palette otherwise
 * @param {number} [o.wallHeight] @param {number} [o.stepHeight]
 */
export function autoSetupDetailed({ colours, cols, rows, walls = [], gridSize, sceneInside = () => true,
  palette = null, wallHeight, stepHeight } = {}) {
  const t = new Terrain({ cols, rows, palette, wallHeight, stepHeight });
  const L = layersFor(t);
  const sw = t.sw, sh = t.sh, n = sw * sh;
  const subInside = new Uint8Array(n);
  for (let si = 0; si < sh; si++) for (let sj = 0; sj < sw; sj++) {
    if (sceneInside(Math.floor(si / SUB), Math.floor(sj / SUB))) subInside[si * sw + sj] = 1;
  }

  // 1–2. Cluster and class.
  const cls = new Uint8Array(n);
  let clusters = [];
  const haveColours = colours && colours.length >= n * 3;
  if (haveColours) {
    const all = [];
    for (let k = 0; k < n; k++) if (subInside[k]) all.push(k);
    const stride = Math.max(1, Math.ceil(all.length / AUTO.sample));
    const train = stride === 1 ? all : all.filter((_, i) => i % stride === 0);
    const { centroids } = kmeans(colours, train, AUTO.k, AUTO.iterations);
    const classOf = centroids.map(([r, g, b]) => classifyColour(r, g, b));
    const code = { floor: CLS.FLOOR, water: CLS.WATER, void: CLS.DARK };
    const counts = new Array(centroids.length).fill(0);
    for (const k of all) {
      const c = nearest(centroids, colours[k * 3], colours[k * 3 + 1], colours[k * 3 + 2]);
      counts[c]++;
      cls[k] = code[classOf[c]];
    }
    clusters = centroids.map((rgb, c) => ({ rgb: rgb.map((v) => Math.round(v)), class: classOf[c], count: counts[c] }));
  }

  // 3. One majority pass over the inside sub-cells.
  const smooth = cls.slice();
  for (let si = 0; si < sh; si++) {
    for (let sj = 0; sj < sw; sj++) {
      const k = si * sw + sj;
      if (!subInside[k]) continue;
      const tally = [0, 0, 0];
      for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
        const a = si + di, b = sj + dj;
        if (a < 0 || b < 0 || a >= sh || b >= sw || !subInside[a * sw + b]) continue;
        tally[cls[a * sw + b]]++;
      }
      let best = cls[k];
      for (let c = 0; c < 3; c++) if (tally[c] >= 5 && tally[c] > tally[best]) best = c;
      smooth[k] = best;
    }
  }

  // 4. Rooms.
  const links = blockedLinks(walls, cols, rows, gridSize);
  const room = enclosedCells(cols, rows, sceneInside, links);

  // 5. Write the draft.
  let nWater = 0, nVoid = 0, nRoom = 0;
  for (let k = 0; k < room.length; k++) nRoom += room[k];
  for (let si = 0; si < sh; si++) {
    for (let sj = 0; sj < sw; sj++) {
      const k = si * sw + sj;
      const i = Math.floor(si / SUB), j = Math.floor(sj / SUB);
      let layer = L.floor;
      if (!subInside[k]) layer = L.void;
      else if (smooth[k] === CLS.WATER) layer = L.water;
      else if (smooth[k] === CLS.DARK && !room[i * cols + j]) layer = L.void;
      t.paint(si, sj, layer);
      if (layer === L.water) nWater++;
      else if (layer === L.void && subInside[k]) nVoid++;
    }
  }

  return { terrain: t, clusters, rooms: room, stats: { roomCells: nRoom, water: nWater, void: nVoid, sampled: haveColours } };
}

/** Auto setup: the draft only. */
export function autoSetup(input) {
  return autoSetupDetailed(input).terrain;
}
