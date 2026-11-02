/**
 * Diorama editor — the painting tools.
 *
 * Pure: every function takes a Terrain (terrain/model.mjs) and sub-cell
 * coordinates (si = sub-row, sj = sub-column) and writes through the model's
 * own `set` / `paint`. No `game`, `canvas`, `foundry` or DOM, so the check tool
 * drives these exactly as the editor does.
 *
 * An `op` says what a tool writes into each sub-cell it touches:
 *
 *   { layer: n, dir? }   paint palette entry n (height, layer and kind together)
 *   { delta: q }         raise (+) or lower (−) by q, clamped to [H_MIN, H_MAX];
 *                        void is "not map" and is never raised
 *   { kind: k, dir? }    change the kind only (water, pit, void, stairs, ramp)
 *   { set: {h, layer, kind, dir} }   raw write, any field optional
 *
 * Every tool returns a Change: `{ count, box }`, where `box` is the inclusive
 * sub-cell rectangle `[si0, sj0, si1, sj1]` that was touched (null when nothing
 * changed). The 2D layer redraws only that box.
 */

import { SUB, KIND, DIR, CLIFF_MATERIALS, WALL_MATERIALS } from "../constants.mjs";
import { sanitizePaletteEntry } from "../terrain/model.mjs";

/** Height limits the editor paints between, in q (−16 to +64 cells). */
export const H_MIN = -64;
export const H_MAX = 256;
/** Largest brush radius, in sub-cells. */
export const BRUSH_MAX = 12;
/** Most palette entries a scene may carry (layer is a byte; this is a UI bound). */
export const PALETTE_MAX = 32;

const clampH = (v) => Math.max(H_MIN, Math.min(H_MAX, Math.round(v)));

/* ── change tracking ─────────────────────────────────────────────────────── */

export class Change {
  constructor() { this.count = 0; this.box = null; }

  add(si, sj) {
    this.count++;
    const b = this.box;
    if (!b) { this.box = [si, sj, si, sj]; return; }
    if (si < b[0]) b[0] = si;
    if (sj < b[1]) b[1] = sj;
    if (si > b[2]) b[2] = si;
    if (sj > b[3]) b[3] = sj;
  }
}

/** Union of two boxes (either may be null). */
export function unionBox(a, b) {
  if (!a) return b ? [...b] : null;
  if (!b) return [...a];
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
}

/* ── one sub-cell ────────────────────────────────────────────────────────── */

/**
 * Apply an op to one sub-cell.
 * @returns {boolean} whether anything changed
 */
export function applyOp(t, si, sj, op) {
  if (!op || !t.inBounds(si, sj)) return false;
  const k = t.idx(si, sj);
  const h0 = t.h[k], l0 = t.layer[k], k0 = t.kind[k];
  if (Number.isInteger(op.layer)) {
    if (!t.palette[op.layer]) return false;
    t.paint(si, sj, op.layer, op.dir);
    t.h[k] = clampH(t.h[k]);
  } else if (Number.isFinite(op.delta)) {
    if ((k0 & 0x0f) === KIND.VOID) return false;
    t.set(si, sj, { h: clampH(h0 + op.delta) });
  } else if (Number.isInteger(op.kind)) {
    t.set(si, sj, { kind: op.kind, dir: op.dir });
  } else if (op.set && typeof op.set === "object") {
    t.set(si, sj, op.set);
  } else {
    return false;
  }
  return t.h[k] !== h0 || t.layer[k] !== l0 || t.kind[k] !== k0;
}

/* ── shapes ──────────────────────────────────────────────────────────────── */

/**
 * The sub-cells a brush of `radius` covers around (si, sj). Radius 0 is the
 * single sub-cell; a circle of radius r covers dx² + dy² ≤ (r + 0.5)².
 * @returns {Array<[number, number]>}
 */
export function brushCells(si, sj, radius = 0, shape = "circle") {
  const r = Math.max(0, Math.min(BRUSH_MAX, Math.round(radius)));
  const out = [];
  const lim = (r + 0.5) * (r + 0.5);
  for (let di = -r; di <= r; di++) {
    for (let dj = -r; dj <= r; dj++) {
      if (shape !== "square" && di * di + dj * dj > lim) continue;
      out.push([si + di, sj + dj]);
    }
  }
  return out;
}

/**
 * Sub-cells on the straight line from a to b, inclusive (Bresenham), so a fast
 * drag that skips cells between two pointer events still paints an unbroken
 * stroke.
 */
export function lineCells(a, b) {
  let [y0, x0] = a;
  const [y1, x1] = b;
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  const out = [];
  for (let guard = 0; guard < 100000; guard++) {
    out.push([y0, x0]);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
  return out;
}

/**
 * Paint a brush dab. `visited` (a Set of sub-cell indices) makes an op apply
 * at most once per sub-cell per stroke, which is what raise / lower need: a
 * drag over the same ground must not keep stacking.
 */
export function brush(t, si, sj, radius, op, { shape = "circle", visited = null } = {}) {
  const ch = new Change();
  for (const [a, b] of brushCells(si, sj, radius, shape)) {
    if (!t.inBounds(a, b)) continue;
    if (visited) {
      const k = t.idx(a, b);
      if (visited.has(k)) continue;
      visited.add(k);
    }
    if (applyOp(t, a, b, op)) ch.add(a, b);
  }
  return ch;
}

/** Fill the inclusive rectangle between sub-cells a and b. */
export function rect(t, a, b, op) {
  const ch = new Change();
  const si0 = Math.max(0, Math.min(a[0], b[0])), si1 = Math.min(t.sh - 1, Math.max(a[0], b[0]));
  const sj0 = Math.max(0, Math.min(a[1], b[1])), sj1 = Math.min(t.sw - 1, Math.max(a[1], b[1]));
  for (let si = si0; si <= si1; si++) for (let sj = sj0; sj <= sj1; sj++) {
    if (applyOp(t, si, sj, op)) ch.add(si, sj);
  }
  return ch;
}

/**
 * The 4-connected region of sub-cells equal to (si, sj) in height, kind and
 * layer, as a mask (Uint8Array, 1 = in).
 */
export function regionMask(t, si, sj) {
  const mask = new Uint8Array(t.sw * t.sh);
  if (!t.inBounds(si, sj)) return mask;
  const start = t.idx(si, sj);
  const h0 = t.h[start], kind0 = t.kind[start] & 0x0f, l0 = t.layer[start];
  const stack = [start];
  mask[start] = 1;
  const W = t.sw;
  while (stack.length) {
    const k = stack.pop();
    const r = (k / W) | 0, c = k - r * W;
    const nb = [c > 0 ? k - 1 : -1, c < W - 1 ? k + 1 : -1, r > 0 ? k - W : -1, r < t.sh - 1 ? k + W : -1];
    for (const n of nb) {
      if (n < 0 || mask[n]) continue;
      if (t.h[n] !== h0 || (t.kind[n] & 0x0f) !== kind0 || t.layer[n] !== l0) continue;
      mask[n] = 1;
      stack.push(n);
    }
  }
  return mask;
}

/** Flood fill from (si, sj) over equal (height, kind, layer) sub-cells. */
export function fill(t, si, sj, op) {
  return applyMask(t, regionMask(t, si, sj), op);
}

/* ── magic wand ──────────────────────────────────────────────────────────── */

/** Colour distance used by the wand: the largest channel difference (0..255). */
export function colourDistance(c, i, r, g, b) {
  return Math.max(Math.abs(c[i] - r), Math.abs(c[i + 1] - g), Math.abs(c[i + 2] - b));
}

/**
 * Select sub-cells whose map colour is within `tolerance` of the colour under
 * (si, sj). Contiguous walks 4-connected neighbours from the seed; global takes
 * every match on the map.
 * @param {Uint8Array} colours  RGB per sub-cell, row-major, length w·h·3
 * @param {number} w  sub-cell columns
 * @param {number} h  sub-cell rows
 * @returns {Uint8Array} mask, 1 = selected
 */
export function wandSelect(colours, w, h, si, sj, { tolerance = 32, contiguous = true } = {}) {
  const mask = new Uint8Array(w * h);
  if (!colours || colours.length < w * h * 3) return mask;
  if (si < 0 || sj < 0 || si >= h || sj >= w) return mask;
  const seed = si * w + sj;
  const r = colours[seed * 3], g = colours[seed * 3 + 1], b = colours[seed * 3 + 2];
  const tol = Math.max(0, Math.min(255, Number(tolerance) || 0));
  const near = (k) => colourDistance(colours, k * 3, r, g, b) <= tol;
  if (!contiguous) {
    for (let k = 0; k < w * h; k++) if (near(k)) mask[k] = 1;
    return mask;
  }
  const stack = [seed];
  mask[seed] = 1;
  while (stack.length) {
    const k = stack.pop();
    const row = (k / w) | 0, c = k - row * w;
    const nb = [c > 0 ? k - 1 : -1, c < w - 1 ? k + 1 : -1, row > 0 ? k - w : -1, row < h - 1 ? k + w : -1];
    for (const n of nb) {
      if (n < 0 || mask[n] || !near(n)) continue;
      mask[n] = 1;
      stack.push(n);
    }
  }
  return mask;
}

/**
 * Combine a new selection with the current one.
 * @param {Uint8Array|null} base
 * @param {Uint8Array} next
 * @param {"replace"|"add"|"subtract"} mode
 */
export function combineMask(base, next, mode = "replace") {
  if (!base || mode === "replace" || base.length !== next.length) return next.slice();
  const out = base.slice();
  if (mode === "add") { for (let k = 0; k < out.length; k++) if (next[k]) out[k] = 1; }
  else if (mode === "subtract") { for (let k = 0; k < out.length; k++) if (next[k]) out[k] = 0; }
  return out;
}

/** Number of selected sub-cells. */
export function maskCount(mask) {
  let n = 0;
  if (mask) for (let k = 0; k < mask.length; k++) n += mask[k] ? 1 : 0;
  return n;
}

/** Apply an op to every sub-cell of a mask. */
export function applyMask(t, mask, op) {
  const ch = new Change();
  if (!mask || mask.length !== t.sw * t.sh) return ch;
  const W = t.sw;
  for (let k = 0; k < mask.length; k++) {
    if (!mask[k]) continue;
    const si = (k / W) | 0, sj = k - si * W;
    if (applyOp(t, si, sj, op)) ch.add(si, sj);
  }
  return ch;
}

/* ── raise / lower ───────────────────────────────────────────────────────── */

export const raise = (t, si, sj, radius, q = 1, opts = {}) => brush(t, si, sj, radius, { delta: Math.abs(q) }, opts);
export const lower = (t, si, sj, radius, q = 1, opts = {}) => brush(t, si, sj, radius, { delta: -Math.abs(q) }, opts);

/* ── stairs and ramps ────────────────────────────────────────────────────── */

const OPPOSITE = [DIR.S, DIR.W, DIR.N, DIR.E];

/**
 * Direction from a drag. The GM drags the way the flight CLIMBS (the way you
 * would walk up it, which is how the arrow on the 2D map points); the stored
 * DIR is the way the steps go DOWN (constants.mjs), so it is the opposite.
 * @param {number} dx  sub-columns dragged (east positive)
 * @param {number} dy  sub-rows dragged (south positive)
 */
export function dirFromDrag(dx, dy) {
  const up = Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? DIR.E : DIR.W) : (dy >= 0 ? DIR.S : DIR.N);
  return OPPOSITE[up];
}

/** Sub-cells of a list-or-mask argument. */
function cellsOf(t, cells) {
  if (cells instanceof Uint8Array) {
    const out = [];
    for (let k = 0; k < cells.length; k++) if (cells[k]) out.push([(k / t.sw) | 0, k % t.sw]);
    return out;
  }
  return Array.isArray(cells) ? cells : [];
}

/**
 * Infer which way a set of stair cells goes down: the side whose neighbouring
 * ground (outside the set, not void) is lowest. Defaults to south.
 */
export function inferStairDir(t, cells) {
  const list = cellsOf(t, cells);
  const inSet = new Set(list.map(([a, b]) => t.idx(a, b)));
  const sum = [0, 0, 0, 0], n = [0, 0, 0, 0];
  const vec = [[-1, 0], [0, 1], [1, 0], [0, -1]];       // N E S W as [di, dj]
  for (const [si, sj] of list) {
    for (let d = 0; d < 4; d++) {
      const a = si + vec[d][0], b = sj + vec[d][1];
      if (!t.inBounds(a, b) || inSet.has(t.idx(a, b)) || t.isVoid(a, b)) continue;
      sum[d] += t.topAt(a, b); n[d]++;
    }
  }
  let best = DIR.S, bestV = Infinity;
  for (const d of [DIR.S, DIR.E, DIR.N, DIR.W]) {
    if (!n[d]) continue;
    const v = sum[d] / n[d];
    if (v < bestV - 1e-9) { bestV = v; best = d; }
  }
  // Nothing lower on any side: the flight goes down nowhere in particular.
  return best;
}

/**
 * Mark sub-cells as stairs (or a ramp) going down `dir`. Heights and layers are
 * kept: the flight joins whatever was painted at either end.
 */
export function stairs(t, cells, dir, kind = KIND.STAIRS) {
  const ch = new Change();
  const k = kind === KIND.RAMP ? KIND.RAMP : KIND.STAIRS;
  for (const [si, sj] of cellsOf(t, cells)) {
    if (!t.inBounds(si, sj) || t.isVoid(si, sj)) continue;
    if (applyOp(t, si, sj, { kind: k, dir: dir & 3 })) ch.add(si, sj);
  }
  return ch;
}

/* ── walls ───────────────────────────────────────────────────────────────── */

/** Assign a wall material (null / unknown clears it back to the world default). */
export function setWallMaterial(t, wallId, material) {
  if (!wallId) return false;
  const had = t.walls[wallId];
  if (WALL_MATERIALS.includes(material)) t.walls[wallId] = material;
  else delete t.walls[wallId];
  return had !== t.walls[wallId];
}

/** Distance from point p to segment ab, px. */
export function segmentDistance(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let u = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  u = Math.max(0, Math.min(1, u));
  return Math.hypot(px - (ax + u * dx), py - (ay + u * dy));
}

/** The wall nearest a px point within `tol` px, or null. walls: [{id, a:[x,y], b:[x,y]}]. */
export function nearestWall(walls, x, y, tol) {
  let best = null, bestD = tol;
  for (const w of walls ?? []) {
    const d = segmentDistance(x, y, w.a[0], w.a[1], w.b[0], w.b[1]);
    if (d <= bestD) { bestD = d; best = w; }
  }
  return best;
}

/* ── palette ─────────────────────────────────────────────────────────────── */

/** The plain floor entry (kind FLOOR at height 0), else the first FLOOR, else 0. */
export function floorIndex(palette) {
  const i = palette.findIndex((p) => p.kind === KIND.FLOOR && p.h === 0);
  if (i >= 0) return i;
  const j = palette.findIndex((p) => p.kind === KIND.FLOOR);
  return j >= 0 ? j : 0;
}

/** First entry of a kind, or -1. */
export const indexOfKind = (palette, kind) => palette.findIndex((p) => p.kind === kind);

/**
 * Append a palette entry (sanitised). Returns its index, or -1 when full.
 */
export function addPaletteEntry(t, entry = {}) {
  if (t.palette.length >= PALETTE_MAX) return -1;
  const top = t.palette.reduce((m, p) => (p.kind === KIND.FLOOR ? Math.max(m, p.h) : m), 0);
  const e = sanitizePaletteEntry({ name: `Height ${t.palette.length}`, h: top + 4, kind: KIND.FLOOR,
    material: "earth", color: "#8fa6c8", ...entry }, t.palette.length);
  t.palette.push(e);
  return t.palette.length - 1;
}

/**
 * Edit a palette entry. A palette entry is a NAMED HEIGHT: moving its height
 * moves every sub-cell painted with it by the same amount (so a cell the GM
 * nudged with raise / lower keeps its offset), and changing its kind changes
 * the kind of every sub-cell painted with it (stair directions kept).
 * @returns {Change}
 */
export function updatePaletteEntry(t, index, patch = {}) {
  const ch = new Change();
  const old = t.palette[index];
  if (!old) return ch;
  const next = sanitizePaletteEntry({ ...old, ...patch }, index);
  next.h = clampH(next.h);
  if (!CLIFF_MATERIALS.includes(next.material)) next.material = old.material;
  t.palette[index] = next;
  const dh = next.h - old.h;
  const kindChanged = next.kind !== old.kind;
  if (!dh && !kindChanged) return ch;
  const W = t.sw;
  for (let k = 0; k < t.layer.length; k++) {
    if (t.layer[k] !== index) continue;
    const si = (k / W) | 0, sj = k - si * W;
    const before = t.h[k], kb = t.kind[k];
    if (dh) t.h[k] = clampH(t.h[k] + dh);
    if (kindChanged) t.kind[k] = (next.kind & 0x0f) | (t.kind[k] & 0xf0);
    if (t.h[k] !== before || t.kind[k] !== kb) ch.add(si, sj);
  }
  return ch;
}

/**
 * Remove a palette entry. Sub-cells painted with it are repainted with the
 * fallback entry (the floor), and every layer index above it shifts down one.
 * The last entry can never be removed.
 * @returns {Change}
 */
export function removePaletteEntry(t, index) {
  const ch = new Change();
  if (t.palette.length <= 1 || !t.palette[index]) return ch;
  const removed = t.palette[index];
  t.palette.splice(index, 1);
  let fb = floorIndex(t.palette);
  if (removed.kind === KIND.VOID) {
    const v = indexOfKind(t.palette, KIND.VOID);
    if (v >= 0) fb = v;
  }
  const W = t.sw;
  for (let k = 0; k < t.layer.length; k++) {
    const l = t.layer[k];
    if (l === index) {
      const si = (k / W) | 0, sj = k - si * W;
      if (removed.kind === KIND.VOID && t.palette[fb]?.kind !== KIND.VOID) {
        t.layer[k] = fb;          // no void entry left: keep the cell void, recolour it
      } else {
        t.paint(si, sj, fb);
      }
      ch.add(si, sj);
    } else if (l > index) {
      t.layer[k] = l - 1;
    }
  }
  return ch;
}

/* ── whole-draft replacement ─────────────────────────────────────────────── */

/**
 * Copy another terrain of the same size into `t` (the draft object stays the
 * same instance, so every holder of it sees the change).
 * @param {object} [o]
 * @param {boolean} [o.palette=true]  take the source palette too
 * @param {boolean} [o.walls=true]    take the source wall materials
 */
export function replaceTerrain(t, src, { palette = true, walls = true } = {}) {
  if (src.cols !== t.cols || src.rows !== t.rows) throw new Error("replaceTerrain: size mismatch");
  t.h.set(src.h);
  t.layer.set(src.layer);
  t.kind.set(src.kind);
  if (palette) t.palette = src.palette.map((p) => ({ ...p }));
  if (walls) t.walls = { ...src.walls };
  t.wallHeight = src.wallHeight;
  t.stepHeight = src.stepHeight;
  return [0, 0, t.sh - 1, t.sw - 1];
}

/**
 * A cleared copy of `t`: same size, palette, walls and heights settings; floor
 * at 0 inside `inside(i, j)` (grid cells), void elsewhere.
 */
export function blankLike(t, inside = () => true) {
  const out = t.clone();
  const fl = floorIndex(out.palette);
  const vd = indexOfKind(out.palette, KIND.VOID);
  for (let si = 0; si < out.sh; si++) {
    for (let sj = 0; sj < out.sw; sj++) {
      if (inside(Math.floor(si / SUB), Math.floor(sj / SUB))) out.set(si, sj, { h: 0, layer: fl, kind: KIND.FLOOR, dir: 0 });
      else out.set(si, sj, { h: 0, layer: vd >= 0 ? vd : fl, kind: KIND.VOID, dir: 0 });
    }
  }
  return out;
}

/* ── history ─────────────────────────────────────────────────────────────── */

const metaOf = (t) => JSON.stringify({ palette: t.palette, walls: t.walls, wallHeight: t.wallHeight, stepHeight: t.stepHeight });
const auxOf = (aux) => (aux === undefined ? undefined : JSON.stringify(aux ?? null));

/**
 * Undo / redo over Terrain diffs, bounded.
 *
 * The history keeps one private copy of the last committed state (`base`).
 * `commit` diffs the live draft against it, so a 50-step history of brush
 * strokes costs the cells those strokes touched, not 50 copies of the map.
 * Palette, wall materials and an optional caller `aux` value (the editor's
 * pending difficult-terrain strokes) ride along as JSON when they changed.
 */
export class History {
  /**
   * @param {import("../terrain/model.mjs").Terrain} t
   * @param {{limit?: number, aux?: any}} [o]
   */
  constructor(t, { limit = 50, aux = null } = {}) {
    this.limit = Math.max(1, limit | 0);
    this.reset(t, aux);
  }

  /** Forget every step; the draft as it is now is the new base (and is "saved"). */
  reset(t, aux = null) {
    this.base = { h: t.h.slice(), layer: t.layer.slice(), kind: t.kind.slice(), meta: metaOf(t), aux: auxOf(aux) };
    this.done = [];
    this.undone = [];
    this._serial = 0;
    this._saved = 0;
  }

  get canUndo() { return this.done.length > 0; }
  get canRedo() { return this.undone.length > 0; }
  get top() { return this.done.length ? this.done[this.done.length - 1].id : 0; }
  get dirty() { return this.top !== this._saved; }
  markSaved() { this._saved = this.top; }
  /** The aux value of the current state. */
  get aux() { return this.base.aux === undefined ? null : JSON.parse(this.base.aux); }

  /**
   * Record what changed since the last commit.
   * @returns {boolean} false when nothing changed
   */
  commit(t, label = "", aux = undefined) {
    const B = this.base;
    const idx = [];
    for (let k = 0; k < t.h.length; k++) {
      if (t.h[k] !== B.h[k] || t.layer[k] !== B.layer[k] || t.kind[k] !== B.kind[k]) idx.push(k);
    }
    const meta = metaOf(t);
    const auxJson = aux === undefined ? B.aux : auxOf(aux);
    const metaChanged = meta !== B.meta, auxChanged = auxJson !== B.aux;
    if (!idx.length && !metaChanged && !auxChanged) return false;
    const n = idx.length;
    const e = {
      id: ++this._serial,
      label,
      idx: Uint32Array.from(idx),
      before: { h: new Int16Array(n), layer: new Uint8Array(n), kind: new Uint8Array(n) },
      after: { h: new Int16Array(n), layer: new Uint8Array(n), kind: new Uint8Array(n) },
      meta: metaChanged ? [B.meta, meta] : null,
      aux: auxChanged ? [B.aux, auxJson] : null,
    };
    for (let i = 0; i < n; i++) {
      const k = idx[i];
      e.before.h[i] = B.h[k]; e.before.layer[i] = B.layer[k]; e.before.kind[i] = B.kind[k];
      e.after.h[i] = t.h[k]; e.after.layer[i] = t.layer[k]; e.after.kind[i] = t.kind[k];
      B.h[k] = t.h[k]; B.layer[k] = t.layer[k]; B.kind[k] = t.kind[k];
    }
    B.meta = meta;
    B.aux = auxJson;
    this.done.push(e);
    this.undone.length = 0;
    while (this.done.length > this.limit) this.done.shift();
    return true;
  }

  #apply(t, e, side) {
    const v = side === "before" ? e.before : e.after;
    const W = t.sw;
    const ch = new Change();
    for (let i = 0; i < e.idx.length; i++) {
      const k = e.idx[i];
      t.h[k] = v.h[i]; t.layer[k] = v.layer[i]; t.kind[k] = v.kind[i];
      this.base.h[k] = v.h[i]; this.base.layer[k] = v.layer[i]; this.base.kind[k] = v.kind[i];
      const si = (k / W) | 0;
      ch.add(si, k - si * W);
    }
    const pick = side === "before" ? 0 : 1;
    if (e.meta) {
      const m = JSON.parse(e.meta[pick]);
      t.palette = m.palette; t.walls = m.walls; t.wallHeight = m.wallHeight; t.stepHeight = m.stepHeight;
      this.base.meta = e.meta[pick];
    }
    if (e.aux) this.base.aux = e.aux[pick];
    return { label: e.label, change: ch, meta: !!e.meta, aux: e.aux ? this.aux : undefined };
  }

  /** Step back. Uncommitted edits are discarded first. @returns {object|null} */
  undo(t) {
    this.#discardUncommitted(t);
    const e = this.done.pop();
    if (!e) return null;
    this.undone.push(e);
    return this.#apply(t, e, "before");
  }

  redo(t) {
    this.#discardUncommitted(t);
    const e = this.undone.pop();
    if (!e) return null;
    this.done.push(e);
    return this.#apply(t, e, "after");
  }

  #discardUncommitted(t) {
    const B = this.base;
    t.h.set(B.h); t.layer.set(B.layer); t.kind.set(B.kind);
    const m = JSON.parse(B.meta);
    t.palette = m.palette; t.walls = m.walls; t.wallHeight = m.wallHeight; t.stepHeight = m.stepHeight;
  }
}

/* ── misc ────────────────────────────────────────────────────────────────── */

/** Sub-cell → grid cell. */
export const cellOfSub = (si, sj) => [Math.floor(si / SUB), Math.floor(sj / SUB)];
