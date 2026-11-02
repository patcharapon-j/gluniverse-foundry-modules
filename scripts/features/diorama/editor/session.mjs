/**
 * Diorama editor — one editing session.
 *
 * Owns the DRAFT (an in-memory Terrain nobody else holds), the undo history,
 * the tool state, the wand selection and the pending difficult-terrain strokes.
 * The 2D layer feeds it pointer events in sub-cell coordinates and redraws
 * from what it emits; the panel reads and sets its state. Nothing here reads
 * the world or writes a document: Save lives in the app.
 *
 * Pure, so the check drives a stroke and an undo through the same code the GM
 * does.
 *
 * Events (`on(fn)`, fn(kind, detail)):
 *   terrain {box}   sub-cells changed (box null = everything)
 *   palette         the palette changed (colours, names, entries)
 *   tool            tool / option state changed
 *   mask            wand selection changed
 *   walls           wall materials or the hovered wall changed
 *   difficult       pending difficult terrain changed
 *   preview         a rectangle / stair drag preview moved
 *   history         a step was committed, undone or redone
 *   view            overlay opacity / dim / outlines changed
 *   colours         map colours became available (or failed)
 */

import { KIND, SUB, WALL_MATERIALS } from "../constants.mjs";
import {
  History, brush, brushCells, rect, fill, wandSelect, combineMask, applyMask, maskCount, lineCells,
  stairs, inferStairDir, dirFromDrag, setWallMaterial, nearestWall, floorIndex, addPaletteEntry,
  updatePaletteEntry, removePaletteEntry, replaceTerrain, BRUSH_MAX, unionBox,
} from "./tools.mjs";
import { planDifficult, cellKey } from "./difficult.mjs";

export const TOOLS = Object.freeze(["brush", "rect", "fill", "wand", "raise", "lower", "stairs", "wall", "difficult"]);
/** Tools whose shift-modifier erases to Floor. */
const ERASABLE = new Set(["brush", "rect", "fill", "raise", "lower"]);
/** Tools that use the brush footprint. */
export const BRUSHED = new Set(["brush", "raise", "lower", "stairs", "difficult"]);

export class EditorSession {
  /**
   * @param {object} o
   * @param {import("../terrain/model.mjs").Terrain} o.terrain  the draft (the session owns it)
   * @param {{size:number, cols:number, rows:number, distance:number, units:string, sceneRect:object}} o.grid
   * @param {Array<{id:string, a:number[], b:number[]}>} [o.walls]
   * @param {Array<{id:string, cells:string[], difficulty:number}>} [o.difficult]  our saved regions
   */
  constructor({ terrain, grid, walls = [], difficult = [] }) {
    this.terrain = terrain;
    this.grid = grid;
    this.walls = walls;
    this.existingDifficult = difficult;
    this.pending = [];
    this.tool = "brush";
    this.layer = Math.min(terrain.palette.length - 1, Math.max(0, terrain.palette.findIndex((p) => p.kind === KIND.FLOOR && p.h > 0)));
    this.brush = { radius: 1, shape: "circle" };
    this.wand = { tolerance: 32, contiguous: true, mode: "replace" };
    this.step = 2;                     // raise / lower, q
    this.stairKind = KIND.STAIRS;
    this.material = WALL_MATERIALS[0];
    this.difficulty = 2;               // 0 = erase
    /** paused: the capture lets the canvas through (move a token without closing the editor). */
    this.view = { opacity: 0.55, dim: false, outlines: true, overlay: true, paused: false };
    this.colours = null;               // Uint8Array RGB per sub-cell, or null
    this.coloursState = "none";        // none | loading | ready | failed
    this.mask = null;
    this.preview = null;
    this.hoverWall = null;
    this.history = new History(terrain, { aux: { pending: [] } });
    this._stroke = null;
    this._listeners = new Set();
    /** Set by the app: called when the wand needs map colours it does not have. */
    this.onNeedColours = null;
  }

  /* ── events ─────────────────────────────────────────────────────────── */

  on(fn) { this._listeners.add(fn); return () => this._listeners.delete(fn); }
  emit(kind, detail = {}) {
    for (const fn of this._listeners) {
      try { fn(kind, detail); } catch (e) { console.error(e); }
    }
  }

  get dirty() { return this.history.dirty; }
  get canUndo() { return this.history.canUndo; }
  get canRedo() { return this.history.canRedo; }
  get stroking() { return !!this._stroke; }
  get selectionCount() { return maskCount(this.mask); }

  /* ── state ──────────────────────────────────────────────────────────── */

  setTool(tool) {
    if (!TOOLS.includes(tool) || tool === this.tool) return;
    this.cancelStroke();
    this.tool = tool;
    this.emit("tool");
    this.emit("walls");
  }

  setLayer(i) {
    const n = Math.max(0, Math.min(this.terrain.palette.length - 1, i | 0));
    if (n === this.layer) return;
    this.layer = n;
    this.emit("tool");
  }

  /** `live` marks a slider still being dragged: the panel must not re-render under it. */
  setOption(group, patch, { live = false } = {}) {
    const target = { brush: this.brush, wand: this.wand, view: this.view }[group];
    if (!target) return;
    Object.assign(target, patch);
    if (group === "brush") this.brush.radius = Math.max(0, Math.min(BRUSH_MAX, Math.round(this.brush.radius)));
    if (group === "wand") this.wand.tolerance = Math.max(0, Math.min(255, Math.round(this.wand.tolerance)));
    if (group === "view") this.view.opacity = Math.max(0, Math.min(1, Number(this.view.opacity) || 0));
    this.emit(group === "view" ? "view" : "tool", { live });
  }

  set(key, value) {
    if (!["step", "stairKind", "material", "difficulty"].includes(key)) return;
    this[key] = value;
    this.emit("tool");
  }

  setColours(colours, state = colours ? "ready" : "failed") {
    this.colours = colours ?? null;
    this.coloursState = state;
    this.emit("colours");
    this.emit("tool");
  }

  setWalls(walls) {
    this.walls = walls ?? [];
    if (this.hoverWall && !this.walls.some((w) => w.id === this.hoverWall)) this.hoverWall = null;
    this.emit("walls");
  }

  /* ── ops ────────────────────────────────────────────────────────────── */

  get floorLayer() { return floorIndex(this.terrain.palette); }

  #paintOp(erase) {
    if (this.tool === "raise" && !erase) return { delta: Math.abs(this.step) };
    if (this.tool === "lower" && !erase) return { delta: -Math.abs(this.step) };
    return { layer: erase ? this.floorLayer : this.layer };
  }

  /** Grid cells under a difficult-terrain dab. */
  #difficultCells(si, sj) {
    const i = Math.floor(si / SUB), j = Math.floor(sj / SUB);
    const r = Math.floor(this.brush.radius / SUB);
    return brushCells(i, j, r, this.brush.shape)
      .filter(([a, b]) => a >= 0 && b >= 0 && a < this.terrain.rows && b < this.terrain.cols);
  }

  /** The cells the difficult map shows: saved regions with pending strokes applied. */
  get difficultMap() {
    return planDifficult(this.existingDifficult, this.pending).final;
  }

  /* ── pointer ────────────────────────────────────────────────────────── */

  /**
   * @param {{si:number, sj:number, x?:number, y?:number, shift?:boolean, alt?:boolean, ctrl?:boolean, tolPx?:number}} p
   */
  down(p) {
    this.cancelStroke();
    const t = this.terrain;
    if (p.alt) { this.pick(p); return; }
    const erase = !!p.shift && ERASABLE.has(this.tool);
    switch (this.tool) {
      case "brush": case "raise": case "lower": {
        const st = this._stroke = { tool: this.tool, op: this.#paintOp(erase), last: [p.si, p.sj], visited: new Set(), box: null, cells: [] };
        this.#dab(st, p.si, p.sj);
        break;
      }
      case "rect":
        this._stroke = { tool: "rect", a: [p.si, p.sj], b: [p.si, p.sj], erase };
        this.preview = { type: "rect", a: [p.si, p.sj], b: [p.si, p.sj], erase };
        this.emit("preview");
        break;
      case "fill": {
        const ch = fill(t, p.si, p.sj, this.#paintOp(erase));
        if (ch.box) this.emit("terrain", { box: ch.box });
        this.commit("fill");
        break;
      }
      case "wand": {
        if (!this.colours) { this.onNeedColours?.(p); return; }
        const mode = p.shift ? "add" : p.ctrl ? "subtract" : this.wand.mode;
        const next = wandSelect(this.colours, t.sw, t.sh, p.si, p.sj, this.wand);
        this.mask = combineMask(this.mask, next, mode);
        this.emit("mask");
        this.emit("tool");
        break;
      }
      case "stairs": {
        const st = this._stroke = { tool: "stairs", a: [p.si, p.sj], b: [p.si, p.sj], last: [p.si, p.sj], cells: new Map() };
        this.#stairDab(st, p.si, p.sj);
        break;
      }
      case "wall": {
        const w = nearestWall(this.walls, p.x, p.y, p.tolPx ?? 12);
        if (!w) return;
        if (setWallMaterial(t, w.id, p.shift ? null : this.material)) {
          this.emit("walls");
          this.commit("wall");
        }
        break;
      }
      case "difficult": {
        const st = this._stroke = { tool: "difficult", last: [p.si, p.sj], cells: new Set(), difficulty: p.shift ? 0 : this.difficulty };
        this.#difficultDab(st, p.si, p.sj);
        break;
      }
    }
  }

  move(p) {
    const st = this._stroke;
    if (!st) {
      if (this.tool === "wall") this.#hoverWall(p);
      return;
    }
    const at = [p.si, p.sj];
    switch (st.tool) {
      case "brush": case "raise": case "lower":
        if (at[0] === st.last[0] && at[1] === st.last[1]) return;
        for (const [a, b] of lineCells(st.last, at).slice(1)) this.#dab(st, a, b);
        st.last = at;
        break;
      case "rect":
        if (at[0] === st.b[0] && at[1] === st.b[1]) return;
        st.b = at;
        this.preview = { type: "rect", a: st.a, b: at, erase: st.erase };
        this.emit("preview");
        break;
      case "stairs":
        if (at[0] === st.last[0] && at[1] === st.last[1]) return;
        for (const [a, b] of lineCells(st.last, at).slice(1)) this.#stairDab(st, a, b);
        st.last = at;
        st.b = at;
        this.#stairPreview(st);
        break;
      case "difficult":
        if (at[0] === st.last[0] && at[1] === st.last[1]) return;
        for (const [a, b] of lineCells(st.last, at).slice(1)) this.#difficultDab(st, a, b);
        st.last = at;
        break;
    }
  }

  up(p = null) {
    const st = this._stroke;
    if (!st) return;
    this._stroke = null;
    const t = this.terrain;
    switch (st.tool) {
      case "brush": case "raise": case "lower": {
        // A stroke painted with a stairs / ramp entry gets its direction from the ground around it.
        const entry = st.op.layer != null ? t.palette[st.op.layer] : null;
        if (entry && (entry.kind === KIND.STAIRS || entry.kind === KIND.RAMP) && st.cells.length) {
          const ch = stairs(t, st.cells, inferStairDir(t, st.cells), entry.kind);
          if (ch.box) this.emit("terrain", { box: ch.box });
        }
        this.commit(st.tool);
        break;
      }
      case "rect": {
        const b = p ? [p.si, p.sj] : st.b;
        this.preview = null;
        this.emit("preview");
        const ch = rect(t, st.a, b, this.#paintOp(st.erase));
        if (ch.box) this.emit("terrain", { box: ch.box });
        this.commit("rect");
        break;
      }
      case "stairs": {
        this.preview = null;
        this.emit("preview");
        const cells = [...st.cells.values()];
        const dx = st.b[1] - st.a[1], dy = st.b[0] - st.a[0];
        const dir = Math.hypot(dx, dy) >= 2 ? dirFromDrag(dx, dy) : inferStairDir(t, cells);
        const ch = stairs(t, cells, dir, this.stairKind);
        if (ch.box) this.emit("terrain", { box: ch.box });
        this.commit("stairs");
        break;
      }
      case "difficult": {
        this.preview = null;
        this.emit("preview");
        if (st.cells.size) {
          this.pending = [...this.pending, { cells: [...st.cells].sort(), difficulty: st.difficulty }];
          this.emit("difficult");
          this.commit("difficult");
        }
        break;
      }
    }
  }

  cancelStroke() {
    const st = this._stroke;
    if (!st) return;
    this._stroke = null;
    if (this.preview) { this.preview = null; this.emit("preview"); }
    // Brush strokes already wrote into the draft; keep what was painted as one step.
    if (st.tool === "brush" || st.tool === "raise" || st.tool === "lower") this.commit(st.tool);
    if (st.tool === "difficult" && st.cells.size) {
      this.pending = [...this.pending, { cells: [...st.cells].sort(), difficulty: st.difficulty }];
      this.emit("difficult");
      this.commit("difficult");
    }
  }

  #dab(st, si, sj) {
    const ch = brush(this.terrain, si, sj, this.brush.radius, st.op, { shape: this.brush.shape, visited: st.visited });
    if (!ch.box) return;
    st.box = unionBox(st.box, ch.box);
    if (st.op.layer != null) {
      for (const [a, b] of brushCells(si, sj, this.brush.radius, this.brush.shape)) {
        if (this.terrain.inBounds(a, b) && this.terrain.layerAt(a, b) === st.op.layer) st.cells.push([a, b]);
      }
    }
    this.emit("terrain", { box: ch.box });
  }

  #stairDab(st, si, sj) {
    for (const [a, b] of brushCells(si, sj, this.brush.radius, this.brush.shape)) {
      if (!this.terrain.inBounds(a, b) || this.terrain.isVoid(a, b)) continue;
      st.cells.set(this.terrain.idx(a, b), [a, b]);
    }
    this.#stairPreview(st);
  }

  #stairPreview(st) {
    const dx = st.b[1] - st.a[1], dy = st.b[0] - st.a[0];
    const dir = Math.hypot(dx, dy) >= 2 ? dirFromDrag(dx, dy) : null;
    this.preview = { type: "stairs", a: st.a, b: st.b, dir, cells: [...st.cells.values()] };
    this.emit("preview");
  }

  #difficultDab(st, si, sj) {
    let added = false;
    for (const [i, j] of this.#difficultCells(si, sj)) {
      const k = cellKey(i, j);
      if (st.cells.has(k)) continue;
      st.cells.add(k);
      added = true;
    }
    if (added) {
      this.preview = { type: "difficult", cells: [...st.cells], difficulty: st.difficulty };
      this.emit("preview");
    }
  }

  #hoverWall(p) {
    const w = nearestWall(this.walls, p.x, p.y, p.tolPx ?? 12);
    const id = w?.id ?? null;
    if (id === this.hoverWall) return;
    this.hoverWall = id;
    this.emit("walls");
  }

  /** Eyedropper: take the palette entry (or, with the wall tool, the material) under the cursor. */
  pick(p) {
    if (this.tool === "wall") {
      const w = nearestWall(this.walls, p.x, p.y, p.tolPx ?? 12);
      const m = w ? this.terrain.walls[w.id] : null;
      if (m) { this.material = m; this.emit("tool"); }
      return;
    }
    if (!this.terrain.inBounds(p.si, p.sj)) return;
    this.layer = this.terrain.layerAt(p.si, p.sj);
    if (!["brush", "rect", "fill"].includes(this.tool)) this.tool = "brush";
    this.emit("tool");
    this.emit("walls");
  }

  /* ── wand selection ─────────────────────────────────────────────────── */

  clearMask() {
    if (!this.mask) return;
    this.mask = null;
    this.emit("mask");
    this.emit("tool");
  }

  invertMask() {
    const n = this.terrain.sw * this.terrain.sh;
    const m = new Uint8Array(n);
    for (let k = 0; k < n; k++) m[k] = this.mask?.[k] ? 0 : 1;
    this.mask = m;
    this.emit("mask");
    this.emit("tool");
  }

  /** Apply something to the selection: "layer" | "floor" | "raise" | "lower" | "void". */
  applySelection(what) {
    if (!this.mask) return false;
    const ops = {
      layer: { layer: this.layer },
      floor: { layer: this.floorLayer },
      raise: { delta: Math.abs(this.step) },
      lower: { delta: -Math.abs(this.step) },
    };
    let op = ops[what];
    if (what === "void") {
      const v = this.terrain.palette.findIndex((e) => e.kind === KIND.VOID);
      op = v >= 0 ? { layer: v } : { kind: KIND.VOID };
    }
    if (!op) return false;
    const ch = applyMask(this.terrain, this.mask, op);
    if (ch.box) this.emit("terrain", { box: ch.box });
    return this.commit(`selection:${what}`);
  }

  /* ── palette ────────────────────────────────────────────────────────── */

  addEntry(entry = {}) {
    const i = addPaletteEntry(this.terrain, entry);
    if (i < 0) return -1;
    this.layer = i;
    this.emit("palette");
    this.emit("tool");
    this.commit("palette");
    return i;
  }

  /** Edit an entry. `commit: false` previews (a slider being dragged). */
  updateEntry(i, patch, { commit = true } = {}) {
    const ch = updatePaletteEntry(this.terrain, i, patch);
    this.emit("terrain", { box: ch.box ?? null, palette: true });
    this.emit("palette", { live: !commit });
    if (commit) this.commit("palette");
  }

  removeEntry(i) {
    const before = this.terrain.palette.length;
    removePaletteEntry(this.terrain, i);
    if (this.terrain.palette.length === before) return false;
    if (this.layer > i) this.layer--;
    this.layer = Math.max(0, Math.min(this.terrain.palette.length - 1, this.layer));
    this.emit("terrain", { box: null });
    this.emit("palette");
    this.emit("tool");
    this.commit("palette");
    return true;
  }

  /* ── whole draft ────────────────────────────────────────────────────── */

  /** Replace the draft wholesale (auto setup, copy, clear all). Undoable. */
  replace(src, label = "replace", opts = {}) {
    this.cancelStroke();
    replaceTerrain(this.terrain, src, opts);
    this.layer = Math.max(0, Math.min(this.terrain.palette.length - 1, this.layer));
    this.mask = null;
    this.emit("mask");
    this.emit("terrain", { box: null });
    this.emit("palette");
    this.emit("walls");
    return this.commit(label);
  }

  /* ── history ────────────────────────────────────────────────────────── */

  commit(label = "") {
    const did = this.history.commit(this.terrain, label, { pending: this.pending });
    if (did) this.emit("history", { label });
    return did;
  }

  undo() { return this.#step("undo"); }
  redo() { return this.#step("redo"); }

  #step(which) {
    this.cancelStroke();
    const r = this.history[which](this.terrain);
    if (!r) return false;
    if (r.aux !== undefined) { this.pending = r.aux?.pending ?? []; this.emit("difficult"); }
    this.layer = Math.max(0, Math.min(this.terrain.palette.length - 1, this.layer));
    if (r.change.box) this.emit("terrain", { box: r.change.box });
    if (r.meta) { this.emit("palette"); this.emit("walls"); this.emit("terrain", { box: null }); }
    this.emit("history", { label: r.label, undo: which === "undo" });
    this.emit("tool");
    return true;
  }

  /** After a save: the draft is the new baseline; pending strokes are now documents. */
  saved({ difficult = this.existingDifficult } = {}) {
    this.pending = [];
    this.existingDifficult = difficult;
    this.history.reset(this.terrain, { pending: [] });
    this.emit("difficult");
    this.emit("history", { label: "save" });
    this.emit("tool");
  }
}
