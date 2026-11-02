/**
 * Diorama editor — Auto setup: a first draft of a scene's terrain, heights
 * included, read off the map art and the walls.
 *
 * Pure and deterministic: no randomness, no `game`, `canvas` or DOM, so the
 * same map, walls and options always give the same draft, a GM who presses it
 * twice gets the same thing twice, and the check and the eval tool
 * (tools/diorama-auto-eval.mjs) drive exactly what the editor runs. Method
 * (docs/DIORAMA_AUTO_SETUP.md):
 *
 *   1. classes. k-means over the per-sub-cell colours (initialised from
 *      luminance quantiles), each cluster classed by its centroid: near-black
 *      is dark, blue/teal is water; one majority pass removes speckle.
 *   2. rooms. Cells are flood-filled from the scene border across grid links no
 *      wall crosses; what the flood cannot reach is a room, and a room is floor
 *      even where its art is dark. Dark outside rooms is VOID.
 *   3. regions. A graph segmentation (Felzenszwalb) of the sub-cells on colour
 *      plus the strongest fine-raster edge across each border, never merging
 *      across a wall. Water and planting are decided per region.
 *   4. light. Battle maps shade consistently: a raised thing casts a dark band
 *      on the ground on its far side from the light, starting sharp at its edge
 *      and fading out. Each region border is probed with a ray through the
 *      fine raster for that band, for each of the 8 compass directions; the
 *      direction whose bands outweigh its opposite's is the map's light (or the
 *      GM's override). Too little asymmetry means no light, and no heights.
 *   5. heights. Every band gives "the region on the light side is higher than
 *      the region the band falls on, by about the band's width" (times the
 *      height scale). A weighted least-squares solve over the region graph
 *      (those cues, plus a pull towards equal heights across every border, plus
 *      a weak pull to 0) gives one height per region; quantised to the level
 *      step, the largest level becomes 0, clamped. Uncertain stays flat.
 *   6. water sits below its lowest bank; planting beds rise one step above the
 *      ground around them.
 *   7. stairs. Periodic parallel stripes (autocorrelation of the fine raster's
 *      profile across them) between two different levels become a flight that
 *      descends towards the lower one, so the route stays walkable.
 */

import { SUB, KIND, DIR } from "../constants.mjs";
import { Terrain, distToQ } from "../terrain/model.mjs";

export const AUTO = Object.freeze({
  k: 6,
  iterations: 10,
  /** Train k-means on at most this many sub-cells (strided, deterministic). */
  sample: 30000,
});

/** Where the light comes FROM: "auto", or a compass point (north is up). */
export const LIGHT_DIRS = Object.freeze(["auto", "N", "NE", "E", "SE", "S", "SW", "W", "NW"]);
/**
 * Which side of raised ground the art draws its face on, for maps painted in a
 * slight oblique view (the walls of a terrace show below its edge): "none", or
 * the compass side the faces show on.
 */
export const FACE_SIDES = Object.freeze(["none", "N", "E", "S", "W"]);
/** Level steps a GM can pick, ft. */
export const LEVEL_STEPS = Object.freeze([1.25, 2.5, 5]);

/** The options a GM sets (auto-dialog.mjs); feet are scene units. */
export const AUTO_DEFAULTS = Object.freeze({
  /** Read heights from the art; off gives the flat classes-only draft. */
  heights: true,
  /** "auto" or the compass point the light comes from. */
  light: "auto",
  /** "none" or the side raised ground shows its drawn face on (FACE_SIDES). */
  faces: "none",
  /** How tall a shadow reads: ft of height per ft of shadow width (1 = a 45° sun). */
  heightScale: 1,
  /** Heights are rounded to this many ft. */
  step: 2.5,
});

/** Tuning that is not a GM's choice. Distances in squares, heights in ft. */
const TUNE = Object.freeze({
  /** Felzenszwalb scale (larger: bigger regions) and smallest region, sub-cells. */
  segK: 1.3,
  minRegion: 8,
  /** Weight of the strongest fine edge across a border in the segmentation distance. */
  edgeWeight: 1.2,
  /** Lightness weight against chroma in the segmentation distance (shadows mostly darken). */
  lightWeight: 0.35,
  /** Ray: how far back across the border and how far into the shadow, squares. */
  rayBack: 0.5,
  rayFwd: 3,
  /** A band must darken by at least this (0..1 luma) at its edge, and recover by this. */
  minDrop: 0.045,
  minRecover: 0.03,
  /** Light: smallest (E(d) − E(−d)) / (E(d) + E(−d)) to believe a light at all. */
  minConfidence: 0.12,
  /** A band this soft at its far end (0..1) is shadow-shaped. */
  softShape: 0.5,
  /** Weight of a band sharp at both ends (a strip: a rail, an outline, a drawn face) against a shadow-shaped one. */
  stripWeight: 0.5,
  /** Weight of the bands falling towards the light, which argue against the pairs they cross. */
  counterWeight: 1,
  /** Weight of a band falling the way the GM says faces show (times the strip weight it already carries). */
  faceWeight: 2,
  /** Solve: cue weight per unit of band evidence, smoothness per border sub-cell, anchor per sub-cell. */
  cueWeight: 6,
  smooth: 0.08,
  /** Smoothness is up to 1 + sameBoost times stronger between regions whose chroma (OKLab a, b) is within ~sameChroma. */
  sameBoost: 6,
  sameChroma: 0.012,
  anchor: 0.0005,
  sweeps: 400,
  /** One cue never claims more than this, ft; the whole draft stays inside ±maxHeight. */
  maxEdge: 15,
  maxHeight: 60,
  /** The ground (0) is the lowest level holding at least this share of the land. */
  groundShare: 0.12,
  /** Green regions rise as beds only while green is at most this share of the ground. */
  bedsShare: 0.35,
  /** Water below its lowest bank, ft. */
  waterDrop: 2.5,
  /** Stairs: autocorrelation peak and the share of the window's variance across the stripes. */
  stairPeak: 0.45,
  stairShare: 0.55,
  /** Tread period range, squares. */
  stairPeriod: [0.15, 0.6],
});

const CLS = Object.freeze({ FLOOR: 0, WATER: 1, DARK: 2 });
/** Unit vectors (x east, y south) TOWARDS each compass point. */
const COMPASS = Object.freeze({
  N: [0, -1], NE: [Math.SQRT1_2, -Math.SQRT1_2], E: [1, 0], SE: [Math.SQRT1_2, Math.SQRT1_2],
  S: [0, 1], SW: [-Math.SQRT1_2, Math.SQRT1_2], W: [-1, 0], NW: [-Math.SQRT1_2, -Math.SQRT1_2],
});
const POINTS = Object.freeze(["N", "NE", "E", "SE", "S", "SW", "W", "NW"]);
const OPPOSITE = Object.freeze({ N: "S", NE: "SW", E: "W", SE: "NW", S: "N", SW: "NE", W: "E", NW: "SE" });

/** Sanitise options; total over any input. */
export function autoOptions(o = {}) {
  const src = o && typeof o === "object" ? o : {};
  const num = (v, d) => (typeof v === "number" && Number.isFinite(v) ? v : d);
  return {
    heights: src.heights === undefined ? AUTO_DEFAULTS.heights : !!src.heights,
    light: LIGHT_DIRS.includes(src.light) ? src.light : AUTO_DEFAULTS.light,
    faces: FACE_SIDES.includes(src.faces) ? src.faces : AUTO_DEFAULTS.faces,
    heightScale: Math.max(0.25, Math.min(4, num(src.heightScale, AUTO_DEFAULTS.heightScale))),
    step: Math.max(0.5, Math.min(10, num(src.step, AUTO_DEFAULTS.step))),
  };
}

/* ── colour ─────────────────────────────────────────────────────────── */

const hueOf = (r, g, b) => {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (max === min) return 0;
  const d = max - min;
  let hue;
  if (max === r) hue = 60 * (((g - b) / d) % 6);
  else if (max === g) hue = 60 * ((b - r) / d + 2);
  else hue = 60 * ((r - g) / d + 4);
  return hue < 0 ? hue + 360 : hue;
};

/** Classify one colour (0..255 channels). Exported for the check. */
export function classifyColour(r, g, b) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const v = max / 255;
  const s = max ? (max - min) / max : 0;
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  if (v < 0.16 && lum < 36) return "void";
  const hue = hueOf(r, g, b);
  if (hue >= 165 && hue <= 250 && s >= 0.25 && v >= 0.2 && v <= 0.85 && b >= r) return "water";
  // Murky green-teal water (ponds, swamps): bluer than foliage and darker than teal stone.
  if (hue >= 140 && hue < 165 && s >= 0.42 && v >= 0.2 && v <= 0.7 && b >= r) return "water";
  if (hue >= 65 && hue <= 165 && s >= 0.3 && v >= 0.15 && g >= r && g >= b) return "green";
  return "floor";
}

const srgbLin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
/** OKLab of an sRGB colour, L in 0..1. */
function oklab(r, g, b) {
  const R = srgbLin(r), G = srgbLin(g), B = srgbLin(b);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return [
    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  ];
}

/** k-means over RGB points (indices into `colours`), deterministic. */
function kmeans(colours, points, k, iterations) {
  if (!points.length) return { centroids: [] };
  const lum = (p) => 0.2126 * colours[p * 3] + 0.7152 * colours[p * 3 + 1] + 0.0722 * colours[p * 3 + 2];
  const byLum = points.slice().sort((a, b) => lum(a) - lum(b) || a - b);
  const kk = Math.max(1, Math.min(k, points.length));
  const C = [];
  for (let c = 0; c < kk; c++) {
    const p = byLum[Math.min(byLum.length - 1, Math.floor(((c + 0.5) / kk) * byLum.length))];
    C.push([colours[p * 3], colours[p * 3 + 1], colours[p * 3 + 2]]);
  }
  for (let it = 0; it < iterations; it++) {
    const sum = C.map(() => [0, 0, 0, 0]);
    for (let n = 0; n < points.length; n++) {
      const p = points[n] * 3;
      const best = nearest(C, colours[p], colours[p + 1], colours[p + 2]);
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

function nearest(C, r, g, b) {
  let best = 0, bestD = Infinity;
  for (let c = 0; c < C.length; c++) {
    const dr = r - C[c][0], dg = g - C[c][1], db = b - C[c][2];
    const d = dr * dr + dg * dg + db * db;
    if (d < bestD) { bestD = d; best = c; }
  }
  return best;
}

/* ── walls ──────────────────────────────────────────────────────────── */

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

/* ── the fine raster ────────────────────────────────────────────────── */

/**
 * Luma of the fine raster (0..1), or of the colours themselves at 1 px per
 * sub-cell when there is no fine raster.
 */
function fineLuma(fine, colours, sw, sh) {
  const ok = fine && fine.data && fine.px >= 1 && fine.w >= sw * fine.px && fine.h >= sh * fine.px
    && fine.data.length >= fine.w * fine.h * 3;
  const src = ok ? fine.data : colours;
  const w = ok ? fine.w : sw, h = ok ? fine.h : sh, px = ok ? fine.px | 0 : 1;
  const L = new Float32Array(w * h);
  for (let p = 0; p < w * h; p++) L[p] = (0.2126 * src[p * 3] + 0.7152 * src[p * 3 + 1] + 0.0722 * src[p * 3 + 2]) / 255;
  return { L, w, h, px };
}

/* ── segmentation ───────────────────────────────────────────────────── */

/**
 * Felzenszwalb–Huttenlocher graph segmentation of the sub-cell grid.
 * Deterministic: edges sorted by weight, ties by index.
 * @returns {{label: Int32Array, count: number}} label −1 outside `use`
 */
function segment(sw, sh, use, weightE, weightS, k, minSize) {
  const n = sw * sh;
  const parent = new Int32Array(n), size = new Int32Array(n), inner = new Float32Array(n);
  for (let p = 0; p < n; p++) { parent[p] = p; size[p] = 1; }
  const find = (p) => { while (parent[p] !== p) { parent[p] = parent[parent[p]]; p = parent[p]; } return p; };
  const ea = [], eb = [], ew = [];
  for (let si = 0; si < sh; si++) for (let sj = 0; sj < sw; sj++) {
    const p = si * sw + sj;
    if (!use[p]) continue;
    if (sj + 1 < sw && use[p + 1] && weightE[p] < Infinity) { ea.push(p); eb.push(p + 1); ew.push(weightE[p]); }
    if (si + 1 < sh && use[p + sw] && weightS[p] < Infinity) { ea.push(p); eb.push(p + sw); ew.push(weightS[p]); }
  }
  const order = Array.from(ea.keys()).sort((x, y) => ew[x] - ew[y] || x - y);
  for (const e of order) {
    const a = find(ea[e]), b = find(eb[e]);
    if (a === b) continue;
    const w = ew[e];
    if (w <= Math.min(inner[a] + k / size[a], inner[b] + k / size[b])) {
      const [big, small] = size[a] >= size[b] ? [a, b] : [b, a];
      parent[small] = big; size[big] += size[small]; inner[big] = Math.max(inner[big], inner[small], w);
    }
  }
  for (const e of order) {
    const a = find(ea[e]), b = find(eb[e]);
    if (a === b || (size[a] >= minSize && size[b] >= minSize)) continue;
    const [big, small] = size[a] >= size[b] ? [a, b] : [b, a];
    parent[small] = big; size[big] += size[small];
  }
  const label = new Int32Array(n).fill(-1);
  const ids = new Map();
  for (let p = 0; p < n; p++) {
    if (!use[p]) continue;
    const r = find(p);
    if (!ids.has(r)) ids.set(r, ids.size);
    label[p] = ids.get(r);
  }
  return { label, count: ids.size };
}

/* ── light and shadow bands ─────────────────────────────────────────── */

/**
 * Probe one ray for a cast-shadow band: a sharp darkening near t = 0 that
 * recovers further on. Returns null, or {strength, width, t0, t1} in fine px.
 * `prof` is scratch of length ≥ back + fwd + 1.
 */
function probeBand(Lf, x0, y0, dx, dy, back, fwd, prof) {
  const { L, w, h } = Lf;
  const n = back + fwd + 1;
  for (let i = 0; i < n; i++) {
    const t = i - back;
    const x = Math.round(x0 + dx * t), y = Math.round(y0 + dy * t);
    prof[i] = x < 0 || y < 0 || x >= w || y >= h ? -1 : L[y * w + x];
  }
  // Sharpest drop within the border's uncertainty (± back).
  let best = 0, at = -1;
  for (let i = 2; i <= Math.min(2 * back, n - 3); i++) {
    const a = prof[i - 2], b = prof[i + 2];
    if (a < 0 || b < 0) continue;
    const d = a - b;
    if (d > best) { best = d; at = i; }
  }
  if (at < 0 || best < TUNE.minDrop) return null;
  let lo = Infinity;
  for (let i = at; i <= Math.min(n - 1, at + 3); i++) if (prof[i] >= 0) lo = Math.min(lo, prof[i]);
  const hi = Math.max(prof[at - 2], prof[at - 1]);
  // The lit ground beyond: a high quantile of the rest of the ray.
  const rest = [];
  for (let i = at + 3; i < n; i++) if (prof[i] >= 0) rest.push(prof[i]);
  if (rest.length < 4) return null;
  rest.sort((a, b) => a - b);
  const ref = rest[Math.floor(rest.length * 0.8)];
  if (ref - lo < TUNE.minRecover) return null;
  const target = lo + 0.7 * (ref - lo);
  let end = -1;
  for (let i = at + 1; i < n; i++) if (prof[i] >= target) { end = i; break; }
  if (end < 0) return null;
  const strength = Math.min(best, ref - lo, hi - lo);
  if (strength < TUNE.minDrop) return null;
  // Shape: a cast shadow or contact shadow is sharp at the thing casting it and
  // fades away from it; a dark strip (a rail, an outline, a face) is sharp at both ends.
  let rise = 0;
  for (let i = at + 2; i <= Math.min(n - 3, end + 2); i++) {
    const a = prof[i - 2], b = prof[i + 2];
    if (a >= 0 && b >= 0) rise = Math.max(rise, b - a);
  }
  const soft = 1 - Math.min(1, rise / Math.max(1e-6, best));
  return { strength, width: end - at, t0: at - back, t1: end - back, soft };
}

/* ── stairs ─────────────────────────────────────────────────────────── */

/**
 * How stair-like the fine raster is around sub-cell (si, sj): parallel stripes
 * with a regular tread. Returns {score, axis: "rows"|"cols"} where axis is the
 * way the flight runs ("rows": stripes lie east–west, the flight runs N–S).
 */
function stripeAt(Lf, si, sj, px, scratch) {
  const { L, w, h } = Lf;
  const win = Math.max(8, Math.round(px * 3));          // 1.5 squares
  const cx = Math.round((sj + 0.5) * px), cy = Math.round((si + 0.5) * px);
  const x0 = cx - (win >> 1), y0 = cy - (win >> 1);
  if (x0 < 0 || y0 < 0 || x0 + win > w || y0 + win > h) return { score: 0, axis: null };
  const rowP = scratch.row, colP = scratch.col;
  rowP.fill(0, 0, win); colP.fill(0, 0, win);
  let sum = 0, sum2 = 0;
  for (let y = 0; y < win; y++) {
    const o = (y0 + y) * w + x0;
    for (let x = 0; x < win; x++) {
      const v = L[o + x];
      rowP[y] += v; colP[x] += v; sum += v; sum2 += v * v;
    }
  }
  const N = win * win, mean = sum / N, varAll = sum2 / N - mean * mean;
  if (varAll < 1e-4) return { score: 0, axis: null };
  const lo = Math.max(2, Math.round(TUNE.stairPeriod[0] * 2 * px)), hiP = Math.min(win >> 1, Math.round(TUNE.stairPeriod[1] * 2 * px));
  const one = (P) => {
    let m = 0;
    for (let i = 0; i < win; i++) { P[i] /= win; m += P[i]; }
    m /= win;
    let v = 0;
    for (let i = 0; i < win; i++) { P[i] -= m; v += P[i] * P[i]; }
    v /= win;
    if (v < 1e-6) return { peak: 0, share: 0 };
    let peak = 0;
    for (let k = lo; k <= hiP; k++) {
      let c = 0;
      for (let i = 0; i + k < win; i++) c += P[i] * P[i + k];
      c /= (win - k) * v;
      // A real tread is a peak with a trough at half its period.
      let half = 0;
      const hk = k >> 1;
      if (hk >= 1) { for (let i = 0; i + hk < win; i++) half += P[i] * P[i + hk]; half /= (win - hk) * v; }
      peak = Math.max(peak, c - Math.max(0, half));
    }
    return { peak, share: v / varAll };
  };
  const r = one(rowP), c = one(colP);
  // Stripes lying east–west vary down the rows: the row profile carries them.
  const sr = r.share >= TUNE.stairShare && r.peak >= TUNE.stairPeak && c.share < r.share * 0.5 ? r.peak * r.share : 0;
  const sc = c.share >= TUNE.stairShare && c.peak >= TUNE.stairPeak && r.share < c.share * 0.5 ? c.peak * c.share : 0;
  if (!sr && !sc) return { score: 0, axis: null };
  return sr >= sc ? { score: sr, axis: "rows" } : { score: sc, axis: "cols" };
}

/* ── palette ────────────────────────────────────────────────────────── */

const fmtFt = (ft) => `${ft > 0 ? "+" : ""}${Math.round(ft * 100) / 100}`;
const PALETTE_MAX = 32;

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

/** A floor (or stairs) entry for height `q`: an existing one at that height, else a new one, else the nearest. */
function levelLayer(t, q, kind, distance, cache) {
  const key = `${kind}:${q}`;
  if (cache.has(key)) return cache.get(key);
  const P = t.palette;
  let i = P.findIndex((p) => p.kind === kind && p.h === q);
  if (i < 0 && P.length < PALETTE_MAX) {
    const ft = (q / 4) * distance;
    const warm = Math.max(0, Math.min(1, q / 48));
    const stairs = kind === KIND.STAIRS;
    const shade = (a, b) => Math.round(a + (b - a) * warm).toString(16).padStart(2, "0");
    P.push({
      name: stairs ? `Stairs ${fmtFt(ft)} ft` : (q ? `Level ${fmtFt(ft)} ft` : "Floor"),
      h: q,
      color: stairs ? "#b48ad0" : `#${shade(0x9f, 0xd8)}${shade(0xb0, 0x8a)}${shade(0x7a, 0x5a)}`,
      kind,
      material: stairs || q >= 8 ? "stone" : "earth",
    });
    i = P.length - 1;
  }
  if (i < 0) {
    let best = -1, bd = Infinity;
    P.forEach((p, n) => { if (p.kind === kind && Math.abs(p.h - q) < bd) { bd = Math.abs(p.h - q); best = n; } });
    i = best >= 0 ? best : P.findIndex((p) => p.kind === KIND.FLOOR);
  }
  cache.set(key, i);
  return i;
}

/* ── the draft ──────────────────────────────────────────────────────── */

/**
 * Auto setup with its working: the draft plus what it decided.
 * @param {object} o
 * @param {Uint8Array} o.colours   RGB averages per sub-cell, row-major over (rows·SUB)×(cols·SUB)
 * @param {{data: Uint8Array, w: number, h: number, px: number}} [o.fine]  the fine raster (sample.mjs)
 * @param {number} o.cols
 * @param {number} o.rows
 * @param {Array<{a:number[], b:number[]}>} [o.walls]  wall segments, px
 * @param {number} o.gridSize
 * @param {number} [o.distance]  scene units (ft) per square
 * @param {(i:number, j:number) => boolean} [o.sceneInside]
 * @param {object[]} [o.palette]   palette to keep (the draft's); default palette otherwise
 * @param {number} [o.wallHeight] @param {number} [o.stepHeight]
 * @param {object} [o.options]  AUTO_DEFAULTS shape
 */
export function autoSetupDetailed({ colours, fine = null, cols, rows, walls = [], gridSize, distance = 5,
  sceneInside = () => true, palette = null, wallHeight, stepHeight, options = {} } = {}) {
  const opt = autoOptions(options);
  const dist = typeof distance === "number" && distance > 0 ? distance : 5;
  const ftToQ = (ft) => distToQ(ft, dist);
  const t = new Terrain({ cols, rows, palette, wallHeight, stepHeight });
  const L = layersFor(t);
  const sw = t.sw, sh = t.sh, n = sw * sh;
  const subInside = new Uint8Array(n);
  for (let si = 0; si < sh; si++) for (let sj = 0; sj < sw; sj++) {
    if (sceneInside(Math.floor(si / SUB), Math.floor(sj / SUB))) subInside[si * sw + sj] = 1;
  }

  // 1. Cluster and class.
  const cls = new Uint8Array(n);
  let clusters = [];
  const haveColours = !!colours && colours.length >= n * 3;
  if (haveColours) {
    const all = [];
    for (let k = 0; k < n; k++) if (subInside[k]) all.push(k);
    const stride = Math.max(1, Math.ceil(all.length / AUTO.sample));
    const train = stride === 1 ? all : all.filter((_, i) => i % stride === 0);
    const { centroids } = kmeans(colours, train, AUTO.k, AUTO.iterations);
    const classOf = centroids.map(([r, g, b]) => classifyColour(r, g, b));
    const code = { floor: CLS.FLOOR, green: CLS.FLOOR, water: CLS.WATER, void: CLS.DARK };
    const counts = new Array(centroids.length).fill(0);
    for (const k of all) {
      const c = nearest(centroids, colours[k * 3], colours[k * 3 + 1], colours[k * 3 + 2]);
      counts[c]++;
      cls[k] = code[classOf[c]];
    }
    clusters = centroids.map((rgb, c) => ({ rgb: rgb.map((v) => Math.round(v)), class: classOf[c], count: counts[c] }));
  }
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

  // 2. Rooms.
  const links = blockedLinks(walls, cols, rows, gridSize);
  const room = enclosedCells(cols, rows, sceneInside, links);
  let nRoom = 0;
  for (let k = 0; k < room.length; k++) nRoom += room[k];
  const isVoid = new Uint8Array(n);
  for (let si = 0; si < sh; si++) for (let sj = 0; sj < sw; sj++) {
    const k = si * sw + sj;
    if (!subInside[k] || (smooth[k] === CLS.DARK && !room[Math.floor(si / SUB) * cols + Math.floor(sj / SUB)])) isVoid[k] = 1;
  }

  // Ground: what is neither void nor (yet) decided.
  const hq = new Float64Array(n);                 // height, q (float until written)
  const kindOf = new Uint8Array(n).fill(KIND.FLOOR);
  const dirOf = new Uint8Array(n);
  let info = { light: null, confidence: 0, regions: 0, cues: 0, stairs: 0 };

  if (haveColours) {
    const res = draftHeights({ colours, fine, sw, sh, cols, isVoid, smooth, links, opt, dist, ftToQ, hq, kindOf, dirOf });
    info = res;
  } else {
    for (let k = 0; k < n; k++) if (smooth[k] === CLS.WATER) kindOf[k] = KIND.WATER;
  }

  // Write the draft.
  let nWater = 0, nVoid = 0, nRaised = 0;
  const cache = new Map();
  const step = Math.max(1, Math.round(ftToQ(opt.step)));
  for (let si = 0; si < sh; si++) {
    for (let sj = 0; sj < sw; sj++) {
      const k = si * sw + sj;
      if (isVoid[k]) {
        t.paint(si, sj, L.void);
        if (subInside[k]) nVoid++;
        continue;
      }
      const kind = kindOf[k];
      if (kind === KIND.WATER) {
        const q = haveColours && opt.heights ? Math.round(hq[k]) : t.palette[L.water].h;
        t.set(si, sj, { h: q, layer: L.water, kind: KIND.WATER, dir: 0 });
        nWater++;
        continue;
      }
      if (kind === KIND.STAIRS) {
        const q = Math.round(hq[k]);
        t.set(si, sj, { h: q, layer: levelLayer(t, Math.round(q / step) * step, KIND.STAIRS, dist, cache), kind: KIND.STAIRS, dir: dirOf[k] });
        continue;
      }
      const q = Math.round(hq[k]);
      if (q) nRaised++;
      const layer = q === 0 ? L.floor : levelLayer(t, q, KIND.FLOOR, dist, cache);
      t.set(si, sj, { h: q, layer, kind: KIND.FLOOR, dir: 0 });
    }
  }

  return {
    terrain: t, clusters, rooms: room,
    stats: { roomCells: nRoom, water: nWater, void: nVoid, raised: nRaised, sampled: haveColours,
      light: info.light, confidence: info.confidence, energy: info.energy ?? null, regions: info.regions, cues: info.cues, stairs: info.stairs },
  };
}

/**
 * Steps 3–7: regions, light, heights, water, planting, stairs. Writes hq (q),
 * kindOf, dirOf for every non-void sub-cell.
 */
function draftHeights({ colours, fine, sw, sh, cols, isVoid, smooth, links, opt, dist, ftToQ, hq, kindOf, dirOf }) {
  const n = sw * sh;
  const Lf = fineLuma(fine, colours, sw, sh);
  const px = Lf.px;

  // Per-sub-cell colour.
  const lab = new Float32Array(n * 3);
  const isGreen = new Uint8Array(n), isWet = new Uint8Array(n);
  for (let k = 0; k < n; k++) {
    if (isVoid[k]) continue;
    const r = colours[k * 3], g = colours[k * 3 + 1], b = colours[k * 3 + 2];
    const [l, a, bb] = oklab(r, g, b);
    lab[k * 3] = l; lab[k * 3 + 1] = a; lab[k * 3 + 2] = bb;
    const c = classifyColour(r, g, b);
    if (c === "green") isGreen[k] = 1;
    // A sub-cell is wet when its own colour reads as water, or its k-means class did.
    if (c === "water" || smooth[k] === CLS.WATER) isWet[k] = 1;
  }

  // 3. Segmentation weights: colour distance plus the strongest fine edge across the border.
  const use = new Uint8Array(n);
  for (let k = 0; k < n; k++) use[k] = isVoid[k] ? 0 : 1;
  const wE = new Float32Array(n).fill(Infinity), wS = new Float32Array(n).fill(Infinity);
  const edgeAcross = (si, sj, horizontal) => {
    // Strongest step across the border, averaged along it (fine px).
    if (px < 2) return 0;
    const { L, w } = Lf;
    let total = 0, cnt = 0;
    const half = Math.max(1, px >> 1);
    if (horizontal) {           // border between (si,sj) and (si,sj+1): vertical line x = (sj+1)·px
      const xb = (sj + 1) * px;
      for (let y = si * px; y < (si + 1) * px; y++) {
        let m = 0;
        for (let x = xb - half; x < xb + half - 1; x++) m = Math.max(m, Math.abs(L[y * w + x + 1] - L[y * w + x]));
        total += m; cnt++;
      }
    } else {
      const yb = (si + 1) * px;
      for (let x = sj * px; x < (sj + 1) * px; x++) {
        let m = 0;
        for (let y = yb - half; y < yb + half - 1; y++) m = Math.max(m, Math.abs(L[(y + 1) * w + x] - L[y * w + x]));
        total += m; cnt++;
      }
    }
    return cnt ? total / cnt : 0;
  };
  const dLab = (a, b) => {
    const dl = (lab[a * 3] - lab[b * 3]) * TUNE.lightWeight, da = lab[a * 3 + 1] - lab[b * 3 + 1], db = lab[a * 3 + 2] - lab[b * 3 + 2];
    return Math.sqrt(dl * dl + da * da + db * db);
  };
  const wallBetween = (si, sj, si2, sj2) => {
    const i = Math.floor(si / SUB), j = Math.floor(sj / SUB), i2 = Math.floor(si2 / SUB), j2 = Math.floor(sj2 / SUB);
    if (i === i2 && j === j2) return false;
    if (i === i2) return !!links.east[i * cols + Math.min(j, j2)];
    return !!links.south[Math.min(i, i2) * cols + j];
  };
  for (let si = 0; si < sh; si++) for (let sj = 0; sj < sw; sj++) {
    const p = si * sw + sj;
    if (!use[p]) continue;
    if (sj + 1 < sw && use[p + 1] && !wallBetween(si, sj, si, sj + 1)) wE[p] = dLab(p, p + 1) * 10 + TUNE.edgeWeight * edgeAcross(si, sj, true);
    if (si + 1 < sh && use[p + sw] && !wallBetween(si, sj, si + 1, sj)) wS[p] = dLab(p, p + sw) * 10 + TUNE.edgeWeight * edgeAcross(si, sj, false);
  }
  const seg = segment(sw, sh, use, wE, wS, TUNE.segK, TUNE.minRegion);
  const { label } = seg;
  const R = seg.count;

  // Region stats.
  const area = new Float64Array(R), wat = new Float64Array(R), grn = new Float64Array(R);
  const regLab = new Float64Array(R * 3);
  for (let k = 0; k < n; k++) {
    const r = label[k];
    if (r < 0) continue;
    area[r]++;
    for (let c = 0; c < 3; c++) regLab[r * 3 + c] += lab[k * 3 + c];
    if (isWet[k]) wat[r]++;
    if (isGreen[k]) grn[r]++;
  }
  const regWater = new Uint8Array(R), regGreen = new Uint8Array(R);
  for (let r = 0; r < R; r++) for (let c = 0; c < 3; c++) regLab[r * 3 + c] /= Math.max(1, area[r]);
  for (let r = 0; r < R; r++) {
    regWater[r] = wat[r] >= area[r] * 0.5 ? 1 : 0;
    regGreen[r] = !regWater[r] && grn[r] >= area[r] * 0.5 ? 1 : 0;
  }

  // Region adjacency: shared border length.
  const adj = new Map();                              // key a*R+b (a<b) → border sub-cells
  const addAdj = (a, b) => {
    if (a === b || a < 0 || b < 0) return;
    const key = a < b ? a * R + b : b * R + a;
    adj.set(key, (adj.get(key) ?? 0) + 1);
  };
  for (let si = 0; si < sh; si++) for (let sj = 0; sj < sw; sj++) {
    const p = si * sw + sj;
    if (label[p] < 0) continue;
    if (sj + 1 < sw) addAdj(label[p], label[p + 1]);
    if (si + 1 < sh) addAdj(label[p], label[p + sw]);
  }

  // 4. Light: probe every border sub-cell pair for bands in each of the 8 directions.
  const back = Math.max(2, Math.round(TUNE.rayBack * SUB * px));
  const fwd = Math.max(6, Math.round(TUNE.rayFwd * SUB * px));
  const prof = new Float32Array(back + fwd + 2);
  const borders = [];                                 // [p, q, horizontal]
  for (let si = 0; si < sh; si++) for (let sj = 0; sj < sw; sj++) {
    const p = si * sw + sj;
    if (label[p] < 0) continue;
    if (sj + 1 < sw && label[p + 1] >= 0 && label[p + 1] !== label[p]) borders.push(p, p + 1, 1);
    if (si + 1 < sh && label[p + sw] >= 0 && label[p + sw] !== label[p]) borders.push(p, p + sw, 0);
  }
  const labelAtFine = (x, y) => {
    const sj = Math.floor(x / px), si = Math.floor(y / px);
    if (si < 0 || sj < 0 || si >= sh || sj >= sw) return -1;
    return label[si * sw + sj];
  };
  /**
   * Bands for one shadow direction: per border, the region on the light side
   * (higher if this is a shadow), the region the band falls on, its strength,
   * width and shape. `soft` totals the strength of the shadow-shaped ones.
   */
  const bandsFor = (point) => {
    const [dx, dy] = COMPASS[point];
    const out = [];                                   // [x0, y0, t0, t1, strength, width, soft] per band
    let soft = 0;
    for (let e = 0; e < borders.length; e += 3) {
      const p = borders[e], horiz = borders[e + 2];
      const si = Math.floor(p / sw), sj = p - si * sw;
      // Crossing p → q is east (horiz) or south; the ray runs along d either way.
      const dot = horiz ? dx : dy;
      if (Math.abs(dot) < 1e-6) continue;
      const x0 = horiz ? (sj + 1) * px : (sj + 0.5) * px;
      const y0 = horiz ? (si + 0.5) * px : (si + 1) * px;
      const b = probeBand(Lf, x0, y0, dx, dy, back, fwd, prof);
      if (!b) continue;
      const isSoft = b.soft >= TUNE.softShape;
      if (isSoft) soft += b.strength;
      out.push(x0, y0, b.t0, b.t1, b.strength, b.width, isSoft ? 1 : 0);
    }
    return { point, out, soft };
  };

  let light = null, confidence = 0, energy = null;
  /** [up, down, weight, width px] per cue, labelled once the shadow regions are known. */
  const bands = [];
  const shadowRegion = new Uint8Array(R);
  if (opt.heights) {
    const cache = {};
    const get = (pt) => (cache[pt] ??= bandsFor(pt));
    let fall = null;
    if (opt.light === "auto") {
      const E = {};
      for (const pt of POINTS) E[pt] = get(pt).soft;
      // The way shadows fall is the direction whose bands most outweigh its opposite's.
      let bestPt = null, bestC = 0, bestD = 0;
      for (const pt of POINTS) {
        const a = E[pt], b = E[OPPOSITE[pt]];
        if (a - b > bestD) { bestD = a - b; bestPt = pt; bestC = (a - b) / (a + b); }
      }
      confidence = bestC;
      energy = E;
      if (bestPt && bestC >= TUNE.minConfidence) fall = bestPt;
    } else {
      fall = OPPOSITE[opt.light];
      confidence = 1;
    }
    // [band set, weight for shadow-shaped, weight for strips]
    const sets = [];
    if (fall) {
      light = OPPOSITE[fall];                          // shadows fall away from the light
      sets.push([get(fall), 1, TUNE.stripWeight]);
      // Bands falling the other way cannot be shadows from this light: a dark
      // strip shows one from each side, and those cancel pair by pair below.
      // A shadow-shaped band falling towards the light is no evidence of anything.
      sets.push([get(OPPOSITE[fall]), 0, TUNE.counterWeight * TUNE.stripWeight]);
    }
    if (opt.faces !== "none") {
      // The GM says raised ground shows its drawn face on this side (an oblique
      // view): every band falling that way is a face, the far side is higher.
      sets.push([get(opt.faces), TUNE.faceWeight * TUNE.stripWeight, TUNE.faceWeight * TUNE.stripWeight]);
    }
    // Shadow regions: mostly covered by the light's own bands. They are ground
    // in shadow, cut out by the segmentation, never a level of their own.
    if (fall) {
      const [dx, dy] = COMPASS[fall];
      const cover = new Uint8Array(n);
      const o = get(fall).out;
      for (let i = 0; i < o.length; i += 7) {
        // The band runs to its 70 % recovery; its tail is shadow too.
        for (let t = Math.max(0, o[i + 2]), end = o[i + 3] + ((o[i + 3] - o[i + 2]) >> 1); t <= end; t++) {
          const sj = Math.floor((o[i] + dx * t) / px), si = Math.floor((o[i + 1] + dy * t) / px);
          if (si >= 0 && sj >= 0 && si < sh && sj < sw) cover[si * sw + sj] = 1;
        }
      }
      const cov = new Float64Array(R);
      for (let k = 0; k < n; k++) if (cover[k] && label[k] >= 0) cov[label[k]]++;
      for (let r = 0; r < R; r++) if (!regWater[r] && cov[r] >= area[r] * 0.6) shadowRegion[r] = 1;
    }
    for (const [set, wSoft, wStrip] of sets) {
      const [dx, dy] = COMPASS[set.point];
      const o = set.out;
      for (let i = 0; i < o.length; i += 7) {
        const x0 = o[i], y0 = o[i + 1], t0 = o[i + 2], t1 = o[i + 3];
        // The caster just before the band; the ground past its end, walking on
        // through any shadow region.
        const up = labelAtFine(x0 + dx * (t0 - 2), y0 + dy * (t0 - 2));
        let t = t1 + 2, down = labelAtFine(x0 + dx * t, y0 + dy * t);
        while (down >= 0 && shadowRegion[down] && t < t1 + fwd) { t += 2; down = labelAtFine(x0 + dx * t, y0 + dy * t); }
        if (up < 0 || down < 0 || up === down || shadowRegion[up] || shadowRegion[down]) continue;
        const w = o[i + 4] * (o[i + 6] ? wSoft : wStrip);
        if (w > 0) bands.push(up, down, w, o[i + 5]);
      }
    }
  }

  // 5. Heights per region (ft), least squares.
  const hR = new Float64Array(R);
  let cueCount = 0;
  if (bands.length) {
    // A square is SUB·px fine px and `dist` ft.
    const ftPerPx = dist / (SUB * px);
    const cue = new Map();                             // key up*R+down → [weight, Σw·delta]
    for (let i = 0; i < bands.length; i += 4) {
      const up = bands[i], down = bands[i + 1], s = bands[i + 2], width = bands[i + 3];
      const ft = Math.max(opt.step, Math.min(TUNE.maxEdge, width * ftPerPx * opt.heightScale));
      const key = up * R + down;
      const c = cue.get(key) ?? [0, 0];
      c[0] += s; c[1] += s * ft;
      cue.set(key, c);
    }
    // Net opposing cues on the same pair.
    const pairs = [];
    for (const [key, [w, wd]] of cue) {
      const up = Math.floor(key / R), down = key - up * R;
      const rev = cue.get(down * R + up);
      if (rev && (rev[0] > w || (rev[0] === w && down < up))) continue;
      const net = w - (rev ? rev[0] : 0);
      if (net <= 0) continue;
      pairs.push(up, down, net * TUNE.cueWeight, wd / w);
      cueCount++;
    }
    // Neighbour lists.
    const nb = Array.from({ length: R }, () => []);
    for (const [key, len] of adj) {
      const a = Math.floor(key / R), b = key - a * R;
      if (shadowRegion[a] || shadowRegion[b]) continue;
      // A border with a cue across it follows the cue alone.
      if (cue.has(a * R + b) || cue.has(b * R + a)) continue;
      // The same material on both sides (a dimmer patch of one floor) holds together harder.
      const da = regLab[a * 3 + 1] - regLab[b * 3 + 1], db = regLab[a * 3 + 2] - regLab[b * 3 + 2];
      const same = Math.exp(-Math.sqrt(da * da + db * db) / TUNE.sameChroma);
      const w = TUNE.smooth * len * (1 + TUNE.sameBoost * same);
      nb[a].push(b, w, 0); nb[b].push(a, w, 0);
    }
    for (let i = 0; i < pairs.length; i += 4) {
      const up = pairs[i], down = pairs[i + 1], w = pairs[i + 2], d = pairs[i + 3];
      nb[up].push(down, w, d); nb[down].push(up, w, -d);
    }
    for (let it = 0; it < TUNE.sweeps; it++) {
      let moved = 0;
      for (let r = 0; r < R; r++) {
        const list = nb[r];
        let num = 0, den = TUNE.anchor * area[r];
        for (let i = 0; i < list.length; i += 3) { num += list[i + 1] * (hR[list[i]] + list[i + 2]); den += list[i + 1]; }
        const v = den > 0 ? num / den : 0;
        moved = Math.max(moved, Math.abs(v - hR[r]));
        hR[r] = v;
      }
      if (moved < 1e-4) break;
    }
  }

  // Quantise. The ground is 0: the lowest level that holds a real share of the
  // map, so raised things rise from it and nothing big reads as a pit.
  const stepFt = opt.step;
  const lvl = new Float64Array(R);
  for (let r = 0; r < R; r++) lvl[r] = Math.round(hR[r] / stepFt) * stepFt;
  const byLevel = new Map();
  let landArea = 0;
  for (let r = 0; r < R; r++) if (!regWater[r] && !shadowRegion[r]) { byLevel.set(lvl[r], (byLevel.get(lvl[r]) ?? 0) + area[r]); landArea += area[r]; }
  let datum = 0;
  for (const [v, a] of [...byLevel].sort((x, y) => x[0] - y[0])) if (a >= landArea * TUNE.groundShare) { datum = v; break; }
  for (let r = 0; r < R; r++) lvl[r] = Math.max(-TUNE.maxHeight, Math.min(TUNE.maxHeight, lvl[r] - datum));
  const nbrs = Array.from({ length: R }, () => []);
  for (const [key, len] of adj) { const a = Math.floor(key / R), b = key - a * R; nbrs[a].push(b, len); nbrs[b].push(a, len); }
  // A shadow region lies on the lowest ground beside it.
  for (let r = 0; r < R; r++) {
    if (!shadowRegion[r]) continue;
    let low = Infinity;
    for (let i = 0; i < nbrs[r].length; i += 2) {
      const o = nbrs[r][i];
      if (!shadowRegion[o] && !regWater[o]) low = Math.min(low, lvl[o]);
    }
    lvl[r] = Number.isFinite(low) ? low : 0;
  }

  // 6. Water below its lowest bank; planting one step above its surroundings.
  const final = lvl.slice();
  for (let r = 0; r < R; r++) {
    if (!regWater[r]) continue;
    let bank = Infinity;
    for (let i = 0; i < nbrs[r].length; i += 2) if (!regWater[nbrs[r][i]]) bank = Math.min(bank, lvl[nbrs[r][i]]);
    final[r] = (Number.isFinite(bank) ? bank : 0) - TUNE.waterDrop;
  }
  // Beds and planters are green islands in other ground. Where green is most of
  // the map (a meadow, a forest floor) it is the ground itself.
  let groundArea = 0, greenArea = 0;
  for (let r = 0; r < R; r++) { if (regWater[r]) continue; groundArea += area[r]; if (regGreen[r]) greenArea += area[r]; }
  const bedsRise = greenArea <= groundArea * TUNE.bedsShare;
  for (let r = 0; r < R; r++) {
    if (!bedsRise || !regGreen[r] || area[r] > groundArea * 0.1) continue;
    let tot = 0, base = 0;
    for (let i = 0; i < nbrs[r].length; i += 2) {
      const o = nbrs[r][i];
      if (regWater[o]) continue;
      tot += nbrs[r][i + 1]; base += nbrs[r][i + 1] * lvl[o];
    }
    const around = tot ? Math.round(base / tot / stepFt) * stepFt : 0;
    final[r] = Math.max(final[r], around + stepFt);
  }

  for (let k = 0; k < n; k++) {
    const r = label[k];
    if (r < 0) continue;
    hq[k] = ftToQ(final[r]);
    kindOf[k] = regWater[r] ? KIND.WATER : KIND.FLOOR;
  }

  // 7. Stairs.
  let stairCells = 0;
  if (opt.heights && px >= 4) stairCells = findStairs({ Lf, sw, sh, px, label, regWater, final, hq, kindOf, dirOf, ftToQ, stepFt });

  return { light, confidence: Math.round(confidence * 1000) / 1000, energy, regions: R, cues: cueCount, stairs: stairCells };
}

/**
 * Stair-striped sub-cells, grouped; a group whose two ends (along its axis)
 * sit on different levels becomes a flight descending to the lower end.
 */
function findStairs({ Lf, sw, sh, px, label, regWater, final, hq, kindOf, dirOf, ftToQ, stepFt }) {
  const n = sw * sh;
  const win = Math.max(8, Math.round(px * 3));
  const scratch = { row: new Float32Array(win), col: new Float32Array(win) };
  const axis = new Int8Array(n);                      // 1 rows (flight N–S), 2 cols (flight E–W)
  for (let si = 0; si < sh; si++) for (let sj = 0; sj < sw; sj++) {
    const k = si * sw + sj;
    if (label[k] < 0 || regWater[label[k]]) continue;
    const s = stripeAt(Lf, si, sj, px, scratch);
    if (s.score > 0) axis[k] = s.axis === "rows" ? 1 : 2;
  }
  const seen = new Uint8Array(n);
  let total = 0;
  for (let k0 = 0; k0 < n; k0++) {
    if (!axis[k0] || seen[k0]) continue;
    const ax = axis[k0];
    const cells = [k0];
    seen[k0] = 1;
    for (let q = 0; q < cells.length; q++) {
      const k = cells[q], si = Math.floor(k / sw), sj = k - si * sw;
      for (const [a, b] of [[si - 1, sj], [si + 1, sj], [si, sj - 1], [si, sj + 1]]) {
        if (a < 0 || b < 0 || a >= sh || b >= sw) continue;
        const m = a * sw + b;
        if (seen[m] || axis[m] !== ax) continue;
        seen[m] = 1; cells.push(m);
      }
    }
    if (cells.length < SUB * SUB) continue;           // at least a square's worth
    let i0 = Infinity, i1 = -Infinity, j0 = Infinity, j1 = -Infinity;
    for (const k of cells) { const si = Math.floor(k / sw), sj = k - si * sw; i0 = Math.min(i0, si); i1 = Math.max(i1, si); j0 = Math.min(j0, sj); j1 = Math.max(j1, sj); }
    // Levels just beyond each end of the flight, along its axis (median over the cross-section).
    const endLevel = (side) => {
      const vals = [];
      for (const k of cells) {
        const si = Math.floor(k / sw), sj = k - si * sw;
        let a = si, b = sj;
        do {
          if (ax === 1) a += side; else b += side;
        } while (a >= 0 && b >= 0 && a < sh && b < sw && axis[a * sw + b] === ax && seen[a * sw + b]);
        if (a < 0 || b < 0 || a >= sh || b >= sw) continue;
        const m = a * sw + b;
        if (label[m] < 0 || regWater[label[m]]) continue;
        vals.push(final[label[m]]);
      }
      if (!vals.length) return null;
      vals.sort((x, y) => x - y);
      return vals[vals.length >> 1];
    };
    const a = endLevel(-1), b = endLevel(1);
    if (a === null || b === null || Math.abs(a - b) < stepFt - 1e-6) continue;
    // Down points to the lower end: N/S for a flight along the rows, W/E along the columns.
    const dir = ax === 1 ? (a < b ? DIR.N : DIR.S) : (a < b ? DIR.W : DIR.E);
    const hiFt = Math.max(a, b), loFt = Math.min(a, b);
    const len = ax === 1 ? i1 - i0 + 1 : j1 - j0 + 1;
    for (const k of cells) {
      const si = Math.floor(k / sw), sj = k - si * sw;
      // Steps from the top end: fraction of the way down.
      const pos = ax === 1 ? (dir === DIR.S ? si - i0 : i1 - si) : (dir === DIR.E ? sj - j0 : j1 - sj);
      const ft = hiFt - ((hiFt - loFt) * (pos + 1)) / (len + 1);
      hq[k] = ftToQ(ft);
      kindOf[k] = KIND.STAIRS;
      dirOf[k] = dir;
      total++;
    }
  }
  return total;
}

/** Auto setup: the draft only. */
export function autoSetup(input) {
  return autoSetupDetailed(input).terrain;
}
