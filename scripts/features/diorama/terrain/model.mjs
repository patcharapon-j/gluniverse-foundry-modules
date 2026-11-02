/**
 * Diorama — the terrain model.
 *
 * One height field per scene Level, painted at SUB×SUB sub-cells per grid
 * square. Each sub-cell carries:
 *
 *   h      Int16  height in quarter cells (q)
 *   layer  Uint8  index into `palette` (which decides the cliff material and the
 *                 editor colour; the height itself is free to differ)
 *   kind   Uint8  low nibble KIND, high nibble DIR (stairs / ramps)
 *
 * Grid offsets are Foundry's square-grid offsets: cell (i, j) is row i, column j,
 * covering px [j·size, (j+1)·size) × [i·size, (i+1)·size). The terrain covers
 * the whole canvas grid (`dimensions.rows × dimensions.columns`), padding
 * included; cells outside the scene rect start as VOID.
 *
 * Pure: no `game`, `canvas`, `foundry` or DOM. The check tool and the preview
 * page drive it directly; the store is the only thing that reads or writes the
 * scene flag.
 */

import { SUB, Q_PER_CELL, KIND, DIR_VEC, CLIFF_MATERIALS } from "../constants.mjs";
import { encodeI16, decodeI16, encodeU8, decodeU8 } from "./codec.mjs";

export const FORMAT_VERSION = 1;

/** Default palette for a new terrain. Heights in q. */
export function defaultPalette() {
  return [
    { name: "Floor", h: 0, color: "#9fb07a", kind: KIND.FLOOR, material: "earth" },
    { name: "Void", h: 0, color: "#20242c", kind: KIND.VOID, material: "edge" },
    { name: "Water", h: -1, color: "#3a7dbb", kind: KIND.WATER, material: "earth" },
    { name: "Pit", h: -8, color: "#4a3a2c", kind: KIND.PIT, material: "earth" },
    { name: "Ledge 5", h: 4, color: "#c9b27a", kind: KIND.FLOOR, material: "earth" },
    { name: "Ledge 10", h: 8, color: "#d8925a", kind: KIND.FLOOR, material: "stone" },
    { name: "Ledge 15", h: 12, color: "#c66a5a", kind: KIND.FLOOR, material: "stone" },
    { name: "Stairs", h: 4, color: "#b48ad0", kind: KIND.STAIRS, material: "stone" },
  ];
}

/** Sanitise one palette entry; total over any input. */
export function sanitizePaletteEntry(e, i = 0) {
  const o = e && typeof e === "object" ? e : {};
  const kind = Number.isInteger(o.kind) && o.kind >= 0 && o.kind <= KIND.VOID ? o.kind : KIND.FLOOR;
  return {
    name: String(o.name ?? `Layer ${i}`).slice(0, 40),
    h: clampQ(o.h),
    color: /^#[0-9a-f]{6}$/i.test(String(o.color)) ? String(o.color) : "#9fb07a",
    kind,
    material: CLIFF_MATERIALS.includes(o.material) ? o.material : "earth",
  };
}

const clampQ = (v) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(-32000, Math.min(32000, n)) : 0;
};

export class Terrain {
  /**
   * @param {object} o
   * @param {number} o.cols   grid columns
   * @param {number} o.rows   grid rows
   */
  constructor({ cols, rows, h = null, layer = null, kind = null, palette = null, walls = null,
    wallHeight = 8, stepHeight = 2 } = {}) {
    this.cols = Math.max(1, cols | 0);
    this.rows = Math.max(1, rows | 0);
    const n = this.sw * this.sh;
    this.h = h instanceof Int16Array && h.length === n ? h : new Int16Array(n);
    this.layer = layer instanceof Uint8Array && layer.length === n ? layer : new Uint8Array(n);
    this.kind = kind instanceof Uint8Array && kind.length === n ? kind : new Uint8Array(n);
    this.palette = (Array.isArray(palette) && palette.length ? palette : defaultPalette()).map(sanitizePaletteEntry);
    /** wall id → material key */
    this.walls = walls && typeof walls === "object" ? { ...walls } : {};
    /** default wall height and walkable rise, in q */
    this.wallHeight = Math.max(1, clampQ(wallHeight));
    this.stepHeight = Math.max(0, clampQ(stepHeight));
  }

  /** Sub-cell grid width / height. */
  get sw() { return this.cols * SUB; }
  get sh() { return this.rows * SUB; }

  /**
   * A blank terrain: floor at 0 inside `inside(i, j)`, VOID elsewhere.
   * @param {number} cols
   * @param {number} rows
   * @param {(i:number, j:number) => boolean} [inside]
   */
  static blank(cols, rows, inside = () => true, opts = {}) {
    const t = new Terrain({ cols, rows, ...opts });
    const voidLayer = t.palette.findIndex((p) => p.kind === KIND.VOID);
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < cols; j++) {
        if (inside(i, j)) continue;
        for (let a = 0; a < SUB; a++) for (let b = 0; b < SUB; b++) {
          const k = t.idx(i * SUB + a, j * SUB + b);
          t.kind[k] = KIND.VOID;
          t.layer[k] = voidLayer < 0 ? 0 : voidLayer;
        }
      }
    }
    return t;
  }

  /** Index of sub-cell (si = sub-row, sj = sub-column). */
  idx(si, sj) { return si * this.sw + sj; }

  inBounds(si, sj) { return si >= 0 && sj >= 0 && si < this.sh && sj < this.sw; }

  /** Kind (low nibble) of a sub-cell; out of bounds is VOID. */
  kindAt(si, sj) { return this.inBounds(si, sj) ? (this.kind[this.idx(si, sj)] & 0x0f) : KIND.VOID; }

  /** Direction (high nibble) of a stairs / ramp sub-cell. */
  dirAt(si, sj) { return this.inBounds(si, sj) ? (this.kind[this.idx(si, sj)] >> 4) & 0x03 : 0; }

  layerAt(si, sj) { return this.inBounds(si, sj) ? this.layer[this.idx(si, sj)] : 0; }

  /**
   * Top of a sub-cell in q. VOID and out-of-bounds read as 0: a token standing
   * off the map stands at ground level, and void is "not map", never a cliff.
   */
  topAt(si, sj) {
    if (!this.inBounds(si, sj)) return 0;
    const k = this.idx(si, sj);
    return (this.kind[k] & 0x0f) === KIND.VOID ? 0 : this.h[k];
  }

  isVoid(si, sj) { return this.kindAt(si, sj) === KIND.VOID; }

  /** Write a sub-cell. Any field left undefined is kept. */
  set(si, sj, { h, layer, kind, dir } = {}) {
    if (!this.inBounds(si, sj)) return false;
    const k = this.idx(si, sj);
    if (h !== undefined) this.h[k] = clampQ(h);
    if (layer !== undefined) this.layer[k] = Math.max(0, Math.min(255, layer | 0));
    if (kind !== undefined || dir !== undefined) {
      const kk = kind !== undefined ? (kind & 0x0f) : (this.kind[k] & 0x0f);
      const dd = dir !== undefined ? (dir & 0x03) : ((this.kind[k] >> 4) & 0x03);
      this.kind[k] = kk | (dd << 4);
    }
    return true;
  }

  /** Paint a palette entry onto a sub-cell (height, layer and kind together). */
  paint(si, sj, layerIndex, dir = undefined) {
    const p = this.palette[layerIndex];
    if (!p) return false;
    return this.set(si, sj, { h: p.h, layer: layerIndex, kind: p.kind, dir });
  }

  /* ---------------- cell-level queries (grid offsets) ---------------- */

  /** Highest sub-cell top inside cell (i, j), in q. */
  cellTop(i, j) {
    let top = -Infinity;
    let any = false;
    for (let a = 0; a < SUB; a++) for (let b = 0; b < SUB; b++) {
      const si = i * SUB + a, sj = j * SUB + b;
      if (this.isVoid(si, sj)) continue;
      any = true;
      top = Math.max(top, this.topAt(si, sj));
    }
    return any ? top : 0;
  }

  /** Highest top over a w×h block of cells starting at (i, j): where a big token stands. */
  footprintTop(i, j, w = 1, h = 1) {
    let top = -Infinity;
    const W = Math.max(1, Math.ceil(w)), H = Math.max(1, Math.ceil(h));
    for (let di = 0; di < H; di++) for (let dj = 0; dj < W; dj++) top = Math.max(top, this.cellTop(i + di, j + dj));
    return Number.isFinite(top) ? top : 0;
  }

  /** True when any sub-cell of cell (i, j) is the given kind. */
  cellHasKind(i, j, kind) {
    for (let a = 0; a < SUB; a++) for (let b = 0; b < SUB; b++) {
      if (this.kindAt(i * SUB + a, j * SUB + b) === kind) return true;
    }
    return false;
  }

  /** Whether stairs or a ramp make a cell a legal way up or down. */
  cellIsStair(i, j) { return this.cellHasKind(i, j, KIND.STAIRS) || this.cellHasKind(i, j, KIND.RAMP); }

  /**
   * The heights a stairs / ramp cell connects, in q, read off its stair and
   * ramp sub-cells only: from the foot of the flight (the lower front
   * neighbour each step descends to) up to its top.
   * Null when the cell holds no stairs or ramp.
   */
  stairSpan(i, j) {
    let lo = Infinity, hi = -Infinity, any = false;
    for (let a = 0; a < SUB; a++) for (let b = 0; b < SUB; b++) {
      const si = i * SUB + a, sj = j * SUB + b;
      const k = this.kindAt(si, sj);
      if (k !== KIND.STAIRS && k !== KIND.RAMP) continue;
      any = true;
      const h = this.topAt(si, sj);
      lo = Math.min(lo, h); hi = Math.max(hi, h);
      const [dx, dz] = DIR_VEC[this.dirAt(si, sj)];
      if (this.inBounds(si + dz, sj + dx) && !this.isVoid(si + dz, sj + dx)) lo = Math.min(lo, this.topAt(si + dz, sj + dx));
    }
    return any ? { lo, hi } : null;
  }

  /**
   * One grid step for a walking creature.
   * @returns {{rise:number, climb:boolean, fall:boolean, drop:number}} rise / drop in q
   */
  step(fromI, fromJ, toI, toJ) {
    const a = this.cellTop(fromI, fromJ), b = this.cellTop(toI, toJ);
    const rise = b - a;
    // Stairs exempt only a step whose BOTH ends lie on their own flight, never a cliff beside them.
    const within = (span, h) => h >= span.lo - this.stepHeight && h <= span.hi + this.stepHeight;
    const joins = (span) => !!span && within(span, a) && within(span, b);
    const stair = joins(this.stairSpan(fromI, fromJ)) || joins(this.stairSpan(toI, toJ));
    const climb = rise > this.stepHeight && !stair;
    const fall = -rise > this.stepHeight && !stair;
    return { rise, climb, fall, drop: Math.max(0, -rise) };
  }

  /* ---------------- point queries (px) ---------------- */

  /** Sub-cell containing a px point. */
  subAt(x, y, gridSize) {
    return [Math.floor((y / gridSize) * SUB), Math.floor((x / gridSize) * SUB)];
  }

  /** Ground in q under a px point. */
  groundAt(x, y, gridSize) {
    const [si, sj] = this.subAt(x, y, gridSize);
    return this.topAt(si, sj);
  }

  /* ---------------- whole-map helpers ---------------- */

  /** Distinct sub-cell tops present, ascending (q). */
  distinctTops() {
    const s = new Set();
    for (let k = 0; k < this.h.length; k++) if ((this.kind[k] & 0x0f) !== KIND.VOID) s.add(this.h[k]);
    return [...s].sort((a, b) => a - b);
  }

  /** True when nothing has been painted (everything at 0, no special kinds but void). */
  get isFlat() {
    for (let k = 0; k < this.h.length; k++) {
      const kind = this.kind[k] & 0x0f;
      if (kind === KIND.VOID) continue;
      if (this.h[k] !== 0 || kind !== KIND.FLOOR) return false;
    }
    return true;
  }

  clone() {
    return new Terrain({
      cols: this.cols, rows: this.rows,
      h: this.h.slice(), layer: this.layer.slice(), kind: this.kind.slice(),
      palette: this.palette.map((p) => ({ ...p })), walls: { ...this.walls },
      wallHeight: this.wallHeight, stepHeight: this.stepHeight,
    });
  }

  /** Serialise for the scene flag. */
  toJSON() {
    return {
      v: FORMAT_VERSION,
      cols: this.cols,
      rows: this.rows,
      sub: SUB,
      h: encodeI16(this.h),
      layer: encodeU8(this.layer),
      kind: encodeU8(this.kind),
      palette: this.palette.map((p) => ({ ...p })),
      walls: { ...this.walls },
      wallHeight: this.wallHeight,
      stepHeight: this.stepHeight,
    };
  }

  /**
   * Rebuild from the flag. Total: anything malformed comes back as a blank
   * terrain of the given size rather than throwing inside a render.
   * @param {object} data
   * @param {{cols:number, rows:number}} [expect]  current grid size; a stored
   *   terrain of a different size is re-laid onto it from the top-left corner
   */
  static fromJSON(data, expect = null) {
    const d = data && typeof data === "object" ? data : {};
    const cols = expect?.cols ?? (d.cols | 0) ?? 1;
    const rows = expect?.rows ?? (d.rows | 0) ?? 1;
    const okSub = (d.sub ?? SUB) === SUB;
    const sCols = d.cols | 0, sRows = d.rows | 0;
    const t = new Terrain({ cols, rows, palette: d.palette, walls: d.walls,
      wallHeight: d.wallHeight, stepHeight: d.stepHeight });
    if (!okSub || sCols <= 0 || sRows <= 0) return t;
    const n = sCols * SUB * sRows * SUB;
    const h = decodeI16(d.h, n), layer = decodeU8(d.layer, n), kind = decodeU8(d.kind, n);
    if (sCols === cols && sRows === rows) {
      t.h = h; t.layer = layer; t.kind = kind;
      return t;
    }
    const ssw = sCols * SUB;
    for (let si = 0; si < Math.min(t.sh, sRows * SUB); si++) {
      for (let sj = 0; sj < Math.min(t.sw, ssw); sj++) {
        const src = si * ssw + sj, dst = t.idx(si, sj);
        t.h[dst] = h[src]; t.layer[dst] = layer[src]; t.kind[dst] = kind[src];
      }
    }
    return t;
  }
}

/* ---------------- unit helpers ---------------- */

/** q → scene distance units. */
export const qToDist = (q, gridDistance) => (q / Q_PER_CELL) * gridDistance;
/** scene distance units → q (not rounded). */
export const distToQ = (d, gridDistance) => (gridDistance ? (d / gridDistance) * Q_PER_CELL : 0);
/** q → cells (three.js world y). */
export const qToCells = (q) => q / Q_PER_CELL;

/** Neighbour offset for a stair direction. */
export const dirVec = (dir) => DIR_VEC[dir & 3];
