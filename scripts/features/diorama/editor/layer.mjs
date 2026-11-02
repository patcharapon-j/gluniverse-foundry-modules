/**
 * Diorama editor — the 2D paint layer on Foundry's canvas.
 *
 * One container in `canvas.interface` at a high zIndex (above the token
 * layer's hit-testing, so a stroke never selects or drags a token; the same
 * slot the hexcrawl paint capture uses). It draws, over the map:
 *
 *   • the draft as a translucent colour per sub-cell: ONE texture at one texel
 *     per sub-cell, scaled up with nearest filtering, so a stroke rewrites the
 *     few texels it touched (putImageData on the dirty box) instead of
 *     rebuilding geometry;
 *   • hairline outlines wherever two neighbouring sub-cells differ in height,
 *     and an arrow on every stairs / ramp cell pointing the way it climbs;
 *   • difficult terrain (saved regions plus pending strokes), the wand
 *     selection, wall highlights for the material tool, the brush cursor and
 *     the rectangle / stair drag preview.
 *
 * Input: left drag runs the session's tool, shift erases to Floor, alt is the
 * eyedropper, a right CLICK picks the palette entry under the cursor. Right and
 * middle drags are never swallowed, so panning works mid-edit; the sidebar and
 * every other DOM surface are outside the canvas and untouched.
 *
 * Every line is a native (1 device px) line or sized in screen px divided by
 * the stage zoom, rebuilt past a 6% zoom change: a width in world units is a
 * slab zoomed in and gone zoomed out.
 */

import { SUB, KIND } from "../constants.mjs";
import { PALETTE, hexToInt, hexToRgb } from "../../../core/theme.mjs";
import { parseKey } from "./difficult.mjs";
import { BRUSHED } from "./session.mjs";
import { footprintCorners, footprintOutline, kitParts, worldOf, SHAPE_DEFAULTS } from "../terrain/props.mjs";
import { snapCentre } from "./props-tool.mjs";

const CAPTURE_Z = 10000;
const CLICK_SLOP = 5;
const WALL_TOL_PX = 10;
const ZOOM_REBUILD = 0.06;
/** A cell whose height differs from its palette entry is shaded by this much per q. */
const SHADE_PER_Q = 1 / 16;
const SHADE_MAX = 0.35;

/** Wall material → suite hue (theme mirror keys). */
const MATERIAL_HUE = Object.freeze({
  stone: "textDim", plaster: "signalPale", palisade: "warn", hedge: "good", cave: "violet", map: "cyan",
});

const col = (key) => hexToInt(PALETTE[key] ?? PALETTE.text);

export class EditorLayer {
  /** @param {import("./session.mjs").EditorSession} session */
  constructor(session) {
    this.session = session;
    this.root = null;
    this._raf = 0;
    this._box = null;
    this._full = false;
    this._need = new Set();
    this._zoom = 1;
    this._hover = null;          // last pointer sample
    this._right = null;
    this._mods = { shift: false, alt: false, ctrl: false };
    this._off = null;
    this._panHook = null;
  }

  get attached() { return !!this.root && !this.root.destroyed; }

  /** Build on the live canvas. @returns {boolean} */
  attach() {
    this.detach();
    if (!globalThis.canvas?.ready || !canvas.interface) return false;
    const s = this.session, t = s.terrain, size = s.grid.size;
    const sub = size / SUB;
    const dims = canvas.dimensions;

    const root = new PIXI.Container();
    root.zIndex = CAPTURE_Z;
    root.sortableChildren = false;
    root.eventMode = s.view.paused ? "none" : "static";
    root.cursor = "crosshair";
    root.hitArea = new PIXI.Rectangle(0, 0, dims.width, dims.height);

    this.dim = new PIXI.Graphics();
    this.dim.eventMode = "none";

    // The draft, one texel per sub-cell.
    this._cv = document.createElement("canvas");
    this._cv.width = t.sw; this._cv.height = t.sh;
    this._ctx = this._cv.getContext("2d");
    this._img = this._ctx.createImageData(t.sw, t.sh);
    this._tex = PIXI.Texture.from(this._cv, { scaleMode: PIXI.SCALE_MODES.NEAREST });
    this.fill = new PIXI.Sprite(this._tex);
    this.fill.scale.set(sub, sub);
    this.fill.eventMode = "none";

    // The wand selection, same layout.
    this._mcv = document.createElement("canvas");
    this._mcv.width = t.sw; this._mcv.height = t.sh;
    this._mctx = this._mcv.getContext("2d");
    this._mtex = PIXI.Texture.from(this._mcv, { scaleMode: PIXI.SCALE_MODES.NEAREST });
    this.mask = new PIXI.Sprite(this._mtex);
    this.mask.scale.set(sub, sub);
    this.mask.eventMode = "none";

    this.outlines = new PIXI.Graphics();
    this.marks = new PIXI.Graphics();
    this.difficult = new PIXI.Graphics();
    this.walls = new PIXI.Graphics();
    this.preview = new PIXI.Graphics();
    this.cursor = new PIXI.Graphics();
    this.props = new PIXI.Graphics();
    for (const g of [this.outlines, this.marks, this.difficult, this.walls, this.preview, this.cursor, this.props]) g.eventMode = "none";

    root.addChild(this.dim, this.fill, this.outlines, this.marks, this.difficult, this.mask, this.walls, this.props, this.preview, this.cursor);
    root.on("pointerdown", (ev) => this.#down(ev));
    root.on("pointermove", (ev) => this.#move(ev));
    root.on("pointerup", (ev) => this.#up(ev));
    root.on("pointerupoutside", (ev) => this.#up(ev, true));
    root.on("pointerleave", () => { this._hover = null; this.#drawCursor(); });

    canvas.interface.addChild(root);
    canvas.interface.sortChildren?.();
    this.root = root;
    this._zoom = canvas.stage.scale.x;

    this._off = s.on((kind, d) => this.#onSession(kind, d));
    this._panHook = Hooks.on("canvasPan", (_c, pos) => {
      const z = pos?.scale ?? canvas.stage.scale.x;
      if (Math.abs(z - this._zoom) / this._zoom > ZOOM_REBUILD) { this._zoom = z; this.#queue("walls", "preview", "cursor"); }
    });

    this.#paintAll();
    this.#queue("outlines", "difficult", "mask", "walls", "dim", "view", "props");
    return true;
  }

  detach() {
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = 0;
    this._off?.();
    this._off = null;
    if (this._panHook != null) Hooks.off("canvasPan", this._panHook);
    this._panHook = null;
    try { if (this.root && !this.root.destroyed) this.root.destroy({ children: true }); } catch { /* torn down with the canvas */ }
    for (const tex of [this._tex, this._mtex]) { try { tex?.destroy(true); } catch { /* gone */ } }
    this.root = null;
    this._tex = this._mtex = null;
    this._cv = this._mcv = this._ctx = this._mctx = this._img = null;
    this._need.clear();
    this._box = null;
  }

  /** Modifier keys changed without the pointer moving (the panel's key handler calls this). */
  setModifiers(mods) {
    this._mods = { ...this._mods, ...mods };
    this.#drawCursor();
  }

  /* ── session → redraw ───────────────────────────────────────────────── */

  #onSession(kind, d = {}) {
    switch (kind) {
      case "terrain":
        if (!d.box) this._full = true;
        else this._box = this._box ? [Math.min(this._box[0], d.box[0]), Math.min(this._box[1], d.box[1]),
          Math.max(this._box[2], d.box[2]), Math.max(this._box[3], d.box[3])] : [...d.box];
        this.#queue("texels", "outlines");
        break;
      case "palette": this._full = true; this.#queue("texels"); break;
      case "mask": this.#queue("mask"); break;
      case "walls": this.#queue("walls"); break;
      case "difficult": this.#queue("difficult"); break;
      case "preview": this.#queue("preview"); break;
      case "tool": this.#queue("cursor", "walls"); break;
      case "view": this.#queue("view", "dim", "outlines"); break;
      case "props": case "mode": this.#queue("props", "cursor"); break;
    }
  }

  #queue(...what) {
    for (const w of what) this._need.add(w);
    if (this._raf || !this.attached) return;
    this._raf = requestAnimationFrame(() => {
      this._raf = 0;
      if (!this.attached) return;
      const need = new Set(this._need);
      this._need.clear();
      try {
        if (need.has("texels")) this.#flushTexels();
        if (need.has("outlines")) this.#drawOutlines();
        if (need.has("difficult")) this.#drawDifficult();
        if (need.has("mask")) this.#drawMask();
        if (need.has("walls")) this.#drawWalls();
        if (need.has("preview")) this.#drawPreview();
        if (need.has("props")) this.#drawProps();
        if (need.has("dim")) this.#drawDim();
        if (need.has("view")) this.#applyView();
        if (need.has("cursor")) this.#drawCursor();
      } catch (e) {
        console.error("GLUniverse Suite | diorama editor layer", e);
      }
    });
  }

  #applyView() {
    const v = this.session.view;
    this.fill.visible = v.overlay !== false;
    this.fill.alpha = v.opacity;
    this.outlines.visible = this.marks.visible = v.outlines !== false;
    this.root.eventMode = v.paused ? "none" : "static";
    this.cursor.visible = !v.paused;
  }

  #drawDim() {
    const g = this.dim;
    g.clear();
    if (!this.session.view.dim) return;
    const r = canvas.dimensions.rect;
    g.beginFill(col("ink0"), 0.6).drawRect(r.x, r.y, r.width, r.height).endFill();
  }

  /* ── texels ─────────────────────────────────────────────────────────── */

  #paintAll() { this._full = true; this.#flushTexels(); }

  #flushTexels() {
    const t = this.session.terrain;
    const box = this._full ? [0, 0, t.sh - 1, t.sw - 1] : this._box;
    this._full = false;
    this._box = null;
    if (!box) return;
    const rgb = t.palette.map((p) => hexToRgb(p.color));
    const px = this._img.data, W = t.sw;
    const si0 = Math.max(0, box[0]), sj0 = Math.max(0, box[1]);
    const si1 = Math.min(t.sh - 1, box[2]), sj1 = Math.min(t.sw - 1, box[3]);
    for (let si = si0; si <= si1; si++) {
      for (let sj = sj0; sj <= sj1; sj++) {
        const k = si * W + sj, o = k * 4;
        const l = t.layer[k];
        const c = rgb[l] ?? rgb[0];
        const p = t.palette[l] ?? t.palette[0];
        let f = 1;
        if ((t.kind[k] & 0x0f) !== KIND.VOID) {
          f = 1 + Math.max(-SHADE_MAX, Math.min(SHADE_MAX, (t.h[k] - p.h) * SHADE_PER_Q));
        }
        px[o] = Math.min(255, c.r * f); px[o + 1] = Math.min(255, c.g * f); px[o + 2] = Math.min(255, c.b * f);
        px[o + 3] = 255;
      }
    }
    this._ctx.putImageData(this._img, 0, 0, sj0, si0, sj1 - sj0 + 1, si1 - si0 + 1);
    this._tex.baseTexture.update();
  }

  /* ── outlines + stair arrows ────────────────────────────────────────── */

  #drawOutlines() {
    const s = this.session, t = s.terrain, g = this.outlines, m = this.marks;
    g.clear(); m.clear();
    if (s.view.outlines === false) return;
    const sub = s.grid.size / SUB;
    const top = (k) => ((t.kind[k] & 0x0f) === KIND.VOID ? -99999 : t.h[k]);
    g.lineStyle({ width: 1, color: col("textBright"), alpha: 0.55, native: true });
    // Horizontal boundaries (between rows si-1 and si), run-merged along sj.
    for (let si = 1; si < t.sh; si++) {
      let run = -1;
      for (let sj = 0; sj <= t.sw; sj++) {
        const diff = sj < t.sw && top((si - 1) * t.sw + sj) !== top(si * t.sw + sj);
        if (diff && run < 0) run = sj;
        else if (!diff && run >= 0) { g.moveTo(run * sub, si * sub).lineTo(sj * sub, si * sub); run = -1; }
      }
    }
    for (let sj = 1; sj < t.sw; sj++) {
      let run = -1;
      for (let si = 0; si <= t.sh; si++) {
        const diff = si < t.sh && top(si * t.sw + sj - 1) !== top(si * t.sw + sj);
        if (diff && run < 0) run = si;
        else if (!diff && run >= 0) { g.moveTo(sj * sub, run * sub).lineTo(sj * sub, si * sub); run = -1; }
      }
    }
    // One arrow per stairs / ramp cell, pointing the way it climbs (opposite of DIR).
    const size = s.grid.size;
    m.lineStyle({ width: 1, color: col("signal"), alpha: 0.95, native: true });
    const UP = [[0, 1], [-1, 0], [0, -1], [1, 0]];      // DIR N/E/S/W go down → climb S/W/N/E as [dx, dy]
    for (let i = 0; i < t.rows; i++) {
      for (let j = 0; j < t.cols; j++) {
        let found = -1, kind = 0;
        for (let a = 0; a < SUB && found < 0; a++) for (let b = 0; b < SUB; b++) {
          const kk = t.kindAt(i * SUB + a, j * SUB + b);
          if (kk === KIND.STAIRS || kk === KIND.RAMP) { found = t.dirAt(i * SUB + a, j * SUB + b); kind = kk; break; }
        }
        if (found < 0) continue;
        const [dx, dy] = UP[found];
        const cx = (j + 0.5) * size, cy = (i + 0.5) * size, L = size * 0.32, w = size * 0.18;
        const tx = cx + dx * L, ty = cy + dy * L;
        const nx = -dy, ny = dx;
        m.moveTo(tx - dx * w + nx * w, ty - dy * w + ny * w).lineTo(tx, ty).lineTo(tx - dx * w - nx * w, ty - dy * w - ny * w);
        if (kind === KIND.RAMP) {
          m.moveTo(cx - dx * L, cy - dy * L).lineTo(tx, ty);
        } else {
          for (const f of [-0.5, 0, 0.5]) {
            const bx = cx + dx * L * f - dx * w * 0.4, by = cy + dy * L * f - dy * w * 0.4;
            m.moveTo(bx + nx * w, by + ny * w).lineTo(bx - nx * w, by - ny * w);
          }
        }
      }
    }
  }

  /* ── difficult terrain ──────────────────────────────────────────────── */

  #drawDifficult() {
    const s = this.session, g = this.difficult, size = s.grid.size;
    g.clear();
    const map = s.difficultMap;
    for (const [k, d] of map) {
      const [i, j] = parseKey(k);
      const c = d >= 3 ? col("hazard") : col("warn");
      g.beginFill(c, 0.16).drawRect(j * size, i * size, size, size).endFill();
      g.lineStyle({ width: 1, color: c, alpha: 0.7, native: true });
      for (const f of [0.25, 0.5, 0.75]) {
        g.moveTo(j * size, i * size + size * f).lineTo(j * size + size * f, i * size);
        g.moveTo(j * size + size * f, (i + 1) * size).lineTo((j + 1) * size, i * size + size * f);
      }
      g.lineStyle(0);
    }
  }

  /* ── wand selection ─────────────────────────────────────────────────── */

  #drawMask() {
    const s = this.session, t = s.terrain;
    const img = this._mctx.createImageData(t.sw, t.sh);
    const c = hexToRgb(PALETTE.cyan);
    if (s.mask) {
      for (let k = 0; k < s.mask.length; k++) {
        if (!s.mask[k]) continue;
        const o = k * 4;
        img.data[o] = c.r; img.data[o + 1] = c.g; img.data[o + 2] = c.b; img.data[o + 3] = 120;
      }
    }
    this._mctx.putImageData(img, 0, 0);
    this._mtex.baseTexture.update();
  }

  /* ── walls ──────────────────────────────────────────────────────────── */

  #drawWalls() {
    const s = this.session, g = this.walls;
    g.clear();
    if (s.tool !== "wall") return;
    const z = canvas.stage.scale.x || 1;
    for (const w of s.walls) {
      const m = s.terrain.walls[w.id];
      const hover = w.id === s.hoverWall;
      const c = m ? col(MATERIAL_HUE[m] ?? "text") : col("textDim");
      if (hover) {
        g.lineStyle({ width: 9 / z, color: col("textBright"), alpha: 0.35 });
        g.moveTo(w.a[0], w.a[1]).lineTo(w.b[0], w.b[1]);
      }
      g.lineStyle({ width: (m ? 4 : 2) / z, color: c, alpha: m ? 0.95 : 0.55 });
      g.moveTo(w.a[0], w.a[1]).lineTo(w.b[0], w.b[1]);
    }
  }

  /* ── props ──────────────────────────────────────────────────────────── */

  /**
   * Every prop's footprint, in hairlines: brighter in Props mode, the selected
   * one in the signal colour with its front marked, a GM-only one in violet.
   * In Terrain mode they stay faintly visible so a brush stroke is not made
   * blind under a crate.
   */
  #drawProps() {
    const s = this.session, g = this.props, size = s.grid.size;
    g.clear();
    const on = s.mode === "props";
    const sel = s.propTool.selected;
    for (const p of s.props) {
      // a slab's or an extrusion's own outline, the w × d box of everything else
      const pts = footprintOutline(p).map(([x, y]) => [x * size, y * size]);
      const picked = on && p.id === sel;
      const c = picked ? col("signal") : p.hidden ? col("violet") : col("textBright");
      g.beginFill(c, picked ? 0.24 : on ? 0.12 : 0.05);
      g.lineStyle({ width: 1, color: c, alpha: on ? 0.95 : 0.4, native: true });
      g.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
      g.lineTo(pts[0][0], pts[0][1]);
      g.endFill();
      if (picked && p.shape === "kit") {
        // a kit: each of its parts, faint, inside its box
        g.lineStyle({ width: 1, color: c, alpha: 0.6, native: true });
        for (const q of kitParts(p)) {
          const qs = footprintOutline(q).map(([x, y]) => [x * size, y * size]);
          g.moveTo(qs[0][0], qs[0][1]);
          for (let i = 1; i < qs.length; i++) g.lineTo(qs[i][0], qs[i][1]);
          g.lineTo(qs[0][0], qs[0][1]);
        }
      }
      if (picked && !p.points) {
        // the front edge (local +y): where a wedge runs down, where a card faces
        const [a, b] = [worldOf(p, -0.35, 0.5), worldOf(p, 0.35, 0.5)];
        g.lineStyle({ width: 1, color: col("signal"), alpha: 1, native: true });
        g.moveTo(a[0] * size, a[1] * size).lineTo(b[0] * size, b[1] * size);
      }
    }
    g.lineStyle(0);
  }

  /* ── drag preview ───────────────────────────────────────────────────── */

  #drawPreview() {
    const s = this.session, g = this.preview, p = s.preview;
    g.clear();
    if (!p) return;
    const sub = s.grid.size / SUB, size = s.grid.size;
    if (p.type === "rect") {
      const si0 = Math.min(p.a[0], p.b[0]), si1 = Math.max(p.a[0], p.b[0]) + 1;
      const sj0 = Math.min(p.a[1], p.b[1]), sj1 = Math.max(p.a[1], p.b[1]) + 1;
      const entry = s.terrain.palette[p.erase ? s.floorLayer : s.layer];
      const c = entry ? hexToInt(entry.color) : col("text");
      g.beginFill(c, 0.35).drawRect(sj0 * sub, si0 * sub, (sj1 - sj0) * sub, (si1 - si0) * sub).endFill();
      g.lineStyle({ width: 1, color: col(p.erase ? "hazard" : "textBright"), alpha: 0.9, native: true });
      g.drawRect(sj0 * sub, si0 * sub, (sj1 - sj0) * sub, (si1 - si0) * sub);
    } else if (p.type === "stairs") {
      g.beginFill(col("signal"), 0.22);
      for (const [si, sj] of p.cells) g.drawRect(sj * sub, si * sub, sub, sub);
      g.endFill();
      if (p.dir != null) {
        const z = canvas.stage.scale.x || 1;
        const ax = (p.a[1] + 0.5) * sub, ay = (p.a[0] + 0.5) * sub, bx = (p.b[1] + 0.5) * sub, by = (p.b[0] + 0.5) * sub;
        g.lineStyle({ width: 3 / z, color: col("signal"), alpha: 0.95 });
        g.moveTo(ax, ay).lineTo(bx, by);
        const ang = Math.atan2(by - ay, bx - ax), h = 14 / z;
        g.moveTo(bx - Math.cos(ang - 0.5) * h, by - Math.sin(ang - 0.5) * h).lineTo(bx, by)
          .lineTo(bx - Math.cos(ang + 0.5) * h, by - Math.sin(ang + 0.5) * h);
      }
    } else if (p.type === "difficult") {
      const c = p.difficulty === 0 ? col("textDim") : p.difficulty >= 3 ? col("hazard") : col("warn");
      g.beginFill(c, 0.28);
      for (const k of p.cells) { const [i, j] = parseKey(k); g.drawRect(j * size, i * size, size, size); }
      g.endFill();
    }
  }

  /* ── cursor ─────────────────────────────────────────────────────────── */

  #drawCursor() {
    const g = this.cursor;
    if (!g || g.destroyed) return;
    g.clear();
    const s = this.session, h = this._hover;
    if (!h || s.view.paused) return;
    const sub = s.grid.size / SUB, size = s.grid.size;
    const erase = this._mods.shift && ["brush", "rect", "fill", "raise", "lower"].includes(s.tool);
    const c = this._mods.alt ? col("cyan") : erase ? col("hazard") : col("textBright");
    g.lineStyle({ width: 1, color: c, alpha: 0.95, native: true });
    if (s.mode === "props") {
      // where a click would put the next prop (its default footprint, snapped)
      const d = SHAPE_DEFAULTS[s.propTool.shape] ?? SHAPE_DEFAULTS.box;
      const cx = h.x / size, cy = h.y / size;
      const x = s.propTool.snap ? snapCentre(cx, d.w) : cx, y = s.propTool.snap ? snapCentre(cy, d.d) : cy;
      g.drawRect((x - d.w / 2) * size, (y - d.d / 2) * size, d.w * size, d.d * size);
      return;
    }
    if (s.tool === "wall") {
      g.drawCircle(h.x, h.y, WALL_TOL_PX / (canvas.stage.scale.x || 1));
      return;
    }
    if (s.tool === "difficult") {
      const i = Math.floor(h.si / SUB), j = Math.floor(h.sj / SUB), r = Math.floor(s.brush.radius / SUB);
      if (s.brush.shape === "square") g.drawRect((j - r) * size, (i - r) * size, (2 * r + 1) * size, (2 * r + 1) * size);
      else g.drawCircle((j + 0.5) * size, (i + 0.5) * size, (r + 0.5) * size);
      return;
    }
    if (BRUSHED.has(s.tool)) {
      const r = s.brush.radius;
      const cx = (h.sj + 0.5) * sub, cy = (h.si + 0.5) * sub;
      if (s.brush.shape === "square") g.drawRect((h.sj - r) * sub, (h.si - r) * sub, (2 * r + 1) * sub, (2 * r + 1) * sub);
      else g.drawCircle(cx, cy, (r + 0.5) * sub);
      return;
    }
    g.drawRect(h.sj * sub, h.si * sub, sub, sub);
  }

  /* ── pointer ────────────────────────────────────────────────────────── */

  #sample(ev) {
    const p = canvas.stage.toLocal(ev.global);
    const size = this.session.grid.size;
    this._mods = { shift: !!ev.shiftKey, alt: !!ev.altKey, ctrl: !!(ev.ctrlKey || ev.metaKey) };
    return {
      x: p.x, y: p.y,
      si: Math.floor((p.y / size) * SUB), sj: Math.floor((p.x / size) * SUB),
      ...this._mods,
      tolPx: WALL_TOL_PX / (canvas.stage.scale.x || 1),
    };
  }

  #down(ev) {
    if (ev.button === 2) { this._right = { x: ev.global.x, y: ev.global.y }; return; }   // never swallowed: pan
    if (ev.button !== 0) return;
    ev.stopPropagation();
    const p = this.#sample(ev);
    this._hover = p;
    this.session.down(p);
    this.#drawCursor();
  }

  #move(ev) {
    const p = this.#sample(ev);
    const prev = this._hover;
    this._hover = p;
    if (this.session.stroking) ev.stopPropagation();
    this.session.move(p);
    if (!prev || prev.si !== p.si || prev.sj !== p.sj || this.session.tool === "wall") this.#drawCursor();
  }

  #up(ev, outside = false) {
    if (ev.button === 2) {
      const r = this._right;
      this._right = null;
      if (!r || outside) return;
      if (Math.hypot(ev.global.x - r.x, ev.global.y - r.y) > CLICK_SLOP) return;   // that was a pan
      this.session.pick(this.#sample(ev));
      return;
    }
    if (!this.session.stroking) return;
    ev.stopPropagation();
    this.session.up(outside ? null : this.#sample(ev));
  }
}
