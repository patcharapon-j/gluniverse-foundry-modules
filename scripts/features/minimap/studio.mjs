/**
 * GLUniverse Suite — Map Studio.
 *
 * The GM authoring app: a map library rail, an SVG canvas editor (reusing
 * MapRenderer), and a properties panel. All edits mutate the draft library
 * (mm.maps); nothing reaches players until the GM pushes (silent / broadcast).
 * The controller supplies the activate / push / refresh callbacks.
 */

import {
  MODULE_ID, MAP_W, MAP_H, PALETTE, ICON_CATALOG, VIEW_MODES, MARKER_KINDS, makeId,
  DEFAULT_ROOM_COLOR, DEFAULT_MARKER_COLOR, DEFAULT_ELEMENT_COLOR, DEFAULT_PARTY_COLOR, safeIconClass
} from "./const.mjs";
import { MapStore } from "./data.mjs";
import { MapRenderer } from "./render.mjs";
import * as Ctl from "./controller.mjs";

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;
const SVGNS = "http://www.w3.org/2000/svg";

const TOOLS = [
  { id: "select", icon: "fa-arrow-pointer", t: "GLMM.tool.select" },
  { id: "rect", icon: "fa-square", t: "GLMM.tool.rect" },
  { id: "ellipse", icon: "fa-circle", t: "GLMM.tool.ellipse" },
  { id: "polygon", icon: "fa-draw-polygon", t: "GLMM.tool.polygon" },
  { id: "connector", icon: "fa-share-nodes", t: "GLMM.tool.connector" },
  { id: "label", icon: "fa-font", t: "GLMM.tool.label" },
  { id: "icon", icon: "fa-icons", t: "GLMM.tool.icon" },
  { id: "marker", icon: "fa-location-dot", t: "GLMM.tool.marker" }
];

export class MapStudio extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(callbacks = {}) {
    super();
    // Default to the live controller actions so the studio works whether it is
    // opened by the controller (scene control / viewer) or constructed directly
    // by the Control Center menu (which passes no callbacks).
    this.cb = {
      activate: (id) => Ctl.activate(id),
      deactivate: () => Ctl.deactivate(),
      push: (mode) => Ctl.push(mode),
      refreshViewer: () => Ctl.refreshGM(),
      pendingCount: () => Ctl.pendingCount(),
      ...callbacks
    };
    this.renderer = null;
    this._editId = null;
    this._tool = "select";
    this._selId = null;          // primary selection (for single-element props)
    this._selIds = new Set();    // full selection set (marquee / shift-click)
    this._poly = null;           // in-progress polygon/connector points
    this._fitMapId = null;       // map whose first fit has run
    this._space = false;         // space held → pan gesture
  }

  static DEFAULT_OPTIONS = {
    id: "glmm-studio",
    classes: ["glmm", "glmm-studio-app"],
    tag: "div",
    position: { width: 1140, height: 740 },
    window: { title: "GLMM.studio.title", icon: "fa-solid fa-pen-ruler", resizable: true, minimizable: true }
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/minimap/studio.hbs` }
  };

  /* ------------------------------- lifecycle ----------------------------- */

  async _prepareContext(options) {
    return Object.assign(await super._prepareContext(options), {});
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    const root = this.element;
    this._libEl = root.querySelector("[data-library]");
    this._toolbarEl = root.querySelector("[data-toolbar]");
    this._canvasEl = root.querySelector("[data-canvas]");
    this._propsEl = root.querySelector("[data-props]");
    this._statusEl = root.querySelector("[data-status]");

    if (!this._editId) this._editId = MapStore.activeMapId() ?? MapStore.list()[0]?.id ?? null;

    this.renderer = new MapRenderer(this._canvasEl, { isGM: true, interactive: false });
    this._buildToolbar();
    this._wireCanvas();
    this._key = (ev) => this._onKey(ev);
    this._keyUp = (ev) => this._onKeyUp(ev);
    window.addEventListener("keydown", this._key);
    window.addEventListener("keyup", this._keyUp);

    this.refresh();
  }

  async _onClose(options) {
    this.renderer?.destroy();
    if (this._key) window.removeEventListener("keydown", this._key);
    if (this._keyUp) window.removeEventListener("keyup", this._keyUp);
    await super._onClose(options);
  }

  /** Full re-paint of every panel from the current draft. */
  refresh() {
    this._buildLibrary();
    this._renderCanvas();
    this._buildProps();
    this._buildStatus();
    this.cb.refreshViewer?.();
  }

  editMap() { return this._editId ? MapStore.get(this._editId) : null; }
  selEl() { const m = this.editMap(); return m ? (m.elements ?? []).find((e) => e.id === this._selId) ?? null : null; }

  /* ------------------------------- library ------------------------------- */

  _buildLibrary() {
    const el = this._libEl;
    el.replaceChildren();

    const head = document.createElement("div");
    head.className = "glmm-st-libhead";
    head.innerHTML = `<span>${game.i18n.localize("GLMM.studio.library")}</span>`;
    const add = document.createElement("button");
    add.className = "glmm-st-newmap";
    add.innerHTML = `<i class="fa-solid fa-plus"></i>`;
    add.title = game.i18n.localize("GLMM.studio.newMap");
    add.addEventListener("click", () => this._newMap());
    head.appendChild(add);
    el.appendChild(head);

    const list = document.createElement("div");
    list.className = "glmm-st-maplist";
    const maps = MapStore.list();
    const activeId = MapStore.activeMapId();
    if (!maps.length) {
      const empty = document.createElement("div");
      empty.className = "glmm-st-empty";
      empty.textContent = game.i18n.localize("GLMM.studio.noMaps");
      list.appendChild(empty);
    }
    for (const m of maps) {
      const row = document.createElement("div");
      row.className = "glmm-st-maprow" + (m.id === this._editId ? " is-editing" : "") + (m.id === activeId ? " is-active" : "");
      const name = document.createElement("button");
      name.className = "glmm-st-mapname";
      name.textContent = m.name;
      name.addEventListener("click", () => { this._editId = m.id; this._selId = null; this.refresh(); });
      row.appendChild(name);

      if (m.id === activeId) {
        const badge = document.createElement("span");
        badge.className = "glmm-st-livebadge";
        badge.textContent = game.i18n.localize("GLMM.studio.live");
        row.appendChild(badge);
      }

      const tools = document.createElement("div");
      tools.className = "glmm-st-maptools";
      const act = mkIconBtn(m.id === activeId ? "fa-stop" : "fa-play", m.id === activeId ? "GLMM.studio.deactivate" : "GLMM.studio.activate");
      act.addEventListener("click", async (ev) => {
        ev.stopPropagation();
        if (m.id === activeId) await this.cb.deactivate?.();
        else await this.cb.activate?.(m.id);
        this.refresh();
      });
      const ren = mkIconBtn("fa-pen", "GLMM.studio.rename");
      ren.addEventListener("click", (ev) => { ev.stopPropagation(); this._renameMap(m); });
      const del = mkIconBtn("fa-trash", "GLMM.studio.delete");
      del.addEventListener("click", (ev) => { ev.stopPropagation(); this._deleteMap(m); });
      tools.append(act, ren, del);
      row.appendChild(tools);
      list.appendChild(row);
    }
    el.appendChild(list);

    // view-mode selector for the edited map
    const m = this.editMap();
    if (m) {
      const vm = document.createElement("div");
      vm.className = "glmm-st-viewmode";
      vm.appendChild(mkLabel(game.i18n.localize("GLMM.studio.viewMode")));
      const sel = document.createElement("select");
      sel.className = "gls-input gls-select";
      for (const mode of VIEW_MODES) {
        const o = document.createElement("option");
        o.value = mode; o.textContent = game.i18n.localize(`GLMM.viewMode.${mode}`);
        if (m.viewMode === mode) o.selected = true;
        sel.appendChild(o);
      }
      sel.addEventListener("change", async () => { await MapStore.setViewMode(m.id, sel.value); this.refresh(); });
      vm.appendChild(sel);
      const hint = document.createElement("div");
      hint.className = "glmm-st-vmhint";
      hint.textContent = game.i18n.localize(`GLMM.viewMode.hint.${m.viewMode}`);
      vm.appendChild(hint);
      el.appendChild(vm);
    }
  }

  async _newMap() {
    const name = await promptText(game.i18n.localize("GLMM.studio.newMap"), game.i18n.localize("GLMM.studio.newMapName"));
    if (name === null) return;
    this._editId = await MapStore.createMap(name);
    this._selId = null;
    this.refresh();
  }

  async _renameMap(m) {
    const name = await promptText(game.i18n.localize("GLMM.studio.rename"), m.name);
    if (name === null) return;
    await MapStore.renameMap(m.id, name);
    this.refresh();
  }

  async _deleteMap(m) {
    const ok = await DialogV2.confirm({
      window: { title: game.i18n.localize("GLMM.studio.delete") },
      content: `<p>${game.i18n.format("GLMM.studio.deleteConfirm", { name: m.name })}</p>`
    });
    if (!ok) return;
    await MapStore.deleteMap(m.id);
    if (this._editId === m.id) this._editId = MapStore.list()[0]?.id ?? null;
    this._selId = null;
    this.refresh();
  }

  /* ------------------------------- toolbar ------------------------------- */

  _buildToolbar() {
    const el = this._toolbarEl;
    el.replaceChildren();
    const left = document.createElement("div");
    left.className = "glmm-st-tb-left";

    const group = document.createElement("div");
    group.className = "glmm-st-tools";
    for (const t of TOOLS) {
      const b = document.createElement("button");
      b.className = "glmm-st-tool" + (this._tool === t.id ? " is-on" : "");
      b.dataset.tool = t.id;
      b.title = game.i18n.localize(t.t);
      b.innerHTML = `<i class="fa-solid ${t.icon}"></i>`;
      b.addEventListener("click", () => this._setTool(t.id));
      group.appendChild(b);
    }
    left.appendChild(group);

    // undo / redo
    const hist = document.createElement("div");
    hist.className = "glmm-st-tools glmm-st-hist";
    const undo = document.createElement("button");
    undo.className = "glmm-st-tool";
    undo.title = game.i18n.localize("GLMM.studio.undo");
    undo.disabled = !MapStore.canUndo();
    undo.innerHTML = `<i class="fa-solid fa-rotate-left"></i>`;
    undo.addEventListener("click", () => this._undo());
    const redo = document.createElement("button");
    redo.className = "glmm-st-tool";
    redo.title = game.i18n.localize("GLMM.studio.redo");
    redo.disabled = !MapStore.canRedo();
    redo.innerHTML = `<i class="fa-solid fa-rotate-right"></i>`;
    redo.addEventListener("click", () => this._redo());
    hist.append(undo, redo);
    left.appendChild(hist);
    el.appendChild(left);

    const right = document.createElement("div");
    right.className = "glmm-st-tb-right";
    const fit = document.createElement("button");
    fit.className = "gls-btn glmm-st-fit";
    fit.innerHTML = `<i class="fa-solid fa-expand"></i> ${game.i18n.localize("GLMM.studio.fit")}`;
    fit.addEventListener("click", () => this.renderer?.fit());
    // broadcast presentation style toggle (prominent | normal)
    const style = Ctl.getBroadcastStyle?.() ?? "prominent";
    const styleBtn = document.createElement("button");
    styleBtn.className = "gls-btn glmm-st-style is-" + style;
    styleBtn.title = game.i18n.localize("GLMM.studio.broadcastStyleHint");
    styleBtn.innerHTML = `<i class="fa-solid ${style === "normal" ? "fa-arrows-to-dot" : "fa-arrows-to-circle"}"></i> ${game.i18n.localize(`GLMM.broadcastStyle.${style}`)}`;
    styleBtn.addEventListener("click", () => { Ctl.cycleBroadcastStyle?.(); this._buildToolbar(); });
    const silent = document.createElement("button");
    silent.className = "gls-btn glmm-st-push";
    silent.innerHTML = `<i class="fa-solid fa-eye-low-vision"></i> ${game.i18n.localize("GLMM.viewer.tool.silent")}`;
    silent.addEventListener("click", () => this.cb.push?.("silent"));
    const bc = document.createElement("button");
    bc.className = "gls-btn gls-btn-accent glmm-st-push";
    bc.innerHTML = `<i class="fa-solid fa-tower-broadcast"></i> ${game.i18n.localize("GLMM.viewer.tool.broadcast")}`;
    bc.addEventListener("click", () => this.cb.push?.("broadcast"));
    right.append(fit, styleBtn, silent, bc);
    el.appendChild(right);
  }

  _setTool(id) {
    this._tool = id;
    this._poly = null;
    this.renderer?.clearFx();
    this._toolbarEl.querySelectorAll(".glmm-st-tool[data-tool]").forEach((b) => b.classList.toggle("is-on", b.dataset.tool === id));
    this._canvasEl.dataset.tool = id;
  }

  /* ------------------------------ undo / redo ---------------------------- */

  async _undo() { if (await MapStore.undo()) { this._selId = null; this._selIds.clear(); this.refresh(); } }
  async _redo() { if (await MapStore.redo()) { this._selId = null; this._selIds.clear(); this.refresh(); } }

  _buildStatus() {
    if (!this._statusEl) return;
    const m = this.editMap();
    const pending = this.cb.pendingCount?.() ?? 0;
    const parts = [];
    if (m) parts.push(game.i18n.format("GLMM.studio.status", { n: (m.elements ?? []).length }));
    if (pending > 0) parts.push(game.i18n.format("GLMM.viewer.pending", { n: pending }));
    this._statusEl.textContent = parts.join("  ·  ");
    this._statusEl.classList.toggle("has-pending", pending > 0);
    this._syncHistButtons();
  }

  /** Keep the undo/redo buttons' enabled state current without rebuilding the bar. */
  _syncHistButtons() {
    const tb = this._toolbarEl;
    if (!tb) return;
    const [u, r] = tb.querySelectorAll(".glmm-st-hist .glmm-st-tool");
    if (u) u.disabled = !MapStore.canUndo();
    if (r) r.disabled = !MapStore.canRedo();
  }

  /* -------------------------------- canvas ------------------------------- */

  _renderCanvas() {
    const m = this.editMap();
    if (!m) { this.renderer.setSnapshot(null); this._clearSelection(); this._fitMapId = null; return; }
    const snap = { mapId: m.id, name: m.name, w: m.w ?? MAP_W, h: m.h ?? MAP_H, viewMode: m.viewMode, elements: m.elements ?? [], rev: -1 };
    this.renderer.setSnapshot(snap);
    // prune any stale selection ids that no longer exist
    const live = new Set((m.elements ?? []).map((e) => e.id));
    for (const id of [...this._selIds]) if (!live.has(id)) this._selIds.delete(id);
    // mark hidden elements (they remain editable in the studio) + multi-selection
    for (const e of m.elements ?? []) if (e.hidden) this.renderer.nodeFor(e.id)?.classList.add("is-hidden-el");
    for (const id of this._selIds) this.renderer.nodeFor(id)?.classList.add("is-multi-sel");
    // First time we show this map, frame it (endless canvas → fit to content).
    if (m.id !== this._fitMapId) { this._fitMapId = m.id; this.renderer.fit(); }
    this._drawSelection();
  }

  _wireCanvas() {
    const c = this._canvasEl;
    c.addEventListener("wheel", (ev) => {
      ev.preventDefault();
      this.renderer.zoomAt(ev.deltaY < 0 ? 1.12 : 1 / 1.12, ev.clientX, ev.clientY);
      this._drawSelection();
    }, { passive: false });
    c.addEventListener("pointerdown", (ev) => this._onCanvasDown(ev));
    c.addEventListener("dblclick", () => this._finishPoly());
    c.addEventListener("contextmenu", (ev) => ev.preventDefault()); // right-drag pans
  }

  _onCanvasDown(ev) {
    if (ev.button === 2) return; // right reserved
    // Endless-canvas panning: middle-button, right-button, or space + left-drag.
    if (ev.button === 1 || (ev.button === 0 && this._space)) { ev.preventDefault(); return this._startPan(ev); }
    if (ev.button !== 0) return;
    const pt = this.renderer.toLogical(ev.clientX, ev.clientY);
    const x = Math.round(pt.x), y = Math.round(pt.y); // endless canvas: no clamping

    switch (this._tool) {
      case "select": return this._selectAt(ev);
      case "rect": case "ellipse": return this._dragCreateRoom(ev, this._tool, x, y);
      case "polygon": case "connector": return this._addPolyPoint(x, y);
      case "label": return this._createAndSelect({ type: "label", x, y, text: game.i18n.localize("GLMM.default.label"), size: 28, color: "#f3fbff" });
      case "icon": return this._createAndSelect({ type: "icon", x, y, icon: ICON_CATALOG[0].cls, label: "", size: 42, color: DEFAULT_ELEMENT_COLOR });
      case "marker": return this._createAndSelect({ type: "marker", kind: "member", x, y, r: 16, label: "", color: DEFAULT_MARKER_COLOR });
    }
  }

  /** Drag the endless canvas (keeps the grabbed logical point under the cursor). */
  _startPan(ev) {
    const c = this._canvasEl;
    const grab = this.renderer.toLogical(ev.clientX, ev.clientY);
    c.setPointerCapture(ev.pointerId);
    c.classList.add("is-panning");
    const move = (e) => this.renderer.panGrab(grab, e.clientX, e.clientY);
    const up = () => {
      c.releasePointerCapture?.(ev.pointerId);
      c.removeEventListener("pointermove", move);
      c.removeEventListener("pointerup", up);
      c.classList.remove("is-panning");
    };
    c.addEventListener("pointermove", move);
    c.addEventListener("pointerup", up);
  }

  async _createAndSelect(el) {
    const m = this.editMap();
    if (!m) return ui.notifications?.warn(game.i18n.localize("GLMM.studio.needMap"));
    el.id = makeId(el.type);
    await MapStore.addElement(m.id, el);
    this._selId = el.id;
    this._selIds = new Set([el.id]);
    this._setTool("select");
    this.refresh();
  }

  _dragCreateRoom(ev, shape, x0, y0) {
    const c = this._canvasEl;
    c.setPointerCapture(ev.pointerId);
    const preview = document.createElementNS(SVGNS, shape === "ellipse" ? "ellipse" : "rect");
    preview.setAttribute("class", "glmm-st-preview");
    this.renderer.layers.fx.appendChild(preview);
    let x1 = x0, y1 = y0;
    const draw = () => {
      const x = Math.min(x0, x1), y = Math.min(y0, y1), w = Math.abs(x1 - x0), h = Math.abs(y1 - y0);
      if (shape === "ellipse") { preview.setAttribute("cx", x + w / 2); preview.setAttribute("cy", y + h / 2); preview.setAttribute("rx", w / 2); preview.setAttribute("ry", h / 2); }
      else { preview.setAttribute("x", x); preview.setAttribute("y", y); preview.setAttribute("width", w); preview.setAttribute("height", h); preview.setAttribute("rx", 8); }
    };
    draw();
    const move = (e) => { const p = this.renderer.toLogical(e.clientX, e.clientY); x1 = p.x; y1 = p.y; draw(); };
    const up = async () => {
      c.releasePointerCapture?.(ev.pointerId);
      c.removeEventListener("pointermove", move);
      c.removeEventListener("pointerup", up);
      preview.remove();
      let x = Math.min(x0, x1), y = Math.min(y0, y1), w = Math.abs(x1 - x0), h = Math.abs(y1 - y0);
      if (w < 16 || h < 16) { w = 160; h = 110; x = x0 - 80; y = y0 - 55; } // a click → default room
      await this._createAndSelect({ type: "room", shape, x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h), label: "", color: DEFAULT_ROOM_COLOR });
    };
    c.addEventListener("pointermove", move);
    c.addEventListener("pointerup", up);
  }

  _addPolyPoint(x, y) {
    if (!this.editMap()) return ui.notifications?.warn(game.i18n.localize("GLMM.studio.needMap"));
    this._poly ??= [];
    this._poly.push({ x: Math.round(x), y: Math.round(y) });
    this._drawPolyPreview();
  }

  _drawPolyPreview() {
    this.renderer.clearFx();
    if (!this._poly?.length) return;
    const closed = this._tool === "polygon";
    const pts = this._poly.map((p) => `${p.x},${p.y}`).join(" ");
    const line = document.createElementNS(SVGNS, closed ? "polygon" : "polyline");
    line.setAttribute("class", "glmm-st-preview is-line");
    line.setAttribute("points", pts);
    line.setAttribute("fill", "none");
    this.renderer.layers.fx.appendChild(line);
    for (const p of this._poly) {
      const dot = document.createElementNS(SVGNS, "circle");
      dot.setAttribute("class", "glmm-st-prevdot");
      dot.setAttribute("cx", p.x); dot.setAttribute("cy", p.y); dot.setAttribute("r", 6);
      this.renderer.layers.fx.appendChild(dot);
    }
  }

  async _finishPoly() {
    if (!this._poly) return;
    const pts = this._poly;
    this._poly = null;
    this.renderer.clearFx();
    if (this._tool === "polygon" && pts.length >= 3) {
      await this._createAndSelect({ type: "room", shape: "polygon", points: pts, label: "", color: DEFAULT_ROOM_COLOR });
    } else if (this._tool === "connector" && pts.length >= 2) {
      await this._createAndSelect({ type: "connector", points: pts, dashed: false, color: DEFAULT_ELEMENT_COLOR });
    }
  }

  /* ----------------------------- select / move --------------------------- */

  selEls() {
    const m = this.editMap();
    if (!m) return [];
    const byId = new Map((m.elements ?? []).map((e) => [e.id, e]));
    return [...this._selIds].map((id) => byId.get(id)).filter(Boolean);
  }

  _selectAt(ev) {
    // handle drag-resize first
    if (ev.target.dataset?.handle) return this._startResize(ev);
    const node = ev.target.closest?.(".glmm-el");
    const id = node?.dataset.id ?? null;

    if (!id) {
      // empty space → rubber-band marquee (shift keeps the current selection)
      if (!ev.shiftKey) { this._selId = null; this._selIds.clear(); this._buildProps(); this._drawSelection(); }
      return this._startMarquee(ev);
    }

    if (ev.shiftKey) {
      if (this._selIds.has(id)) { this._selIds.delete(id); if (this._selId === id) this._selId = [...this._selIds].at(-1) ?? null; }
      else { this._selIds.add(id); this._selId = id; }
      this._buildProps();
      this._refreshSelectionVisn();
      return;
    }

    if (!this._selIds.has(id)) this._selIds = new Set([id]);
    this._selId = id;
    this._buildProps();
    this._refreshSelectionVisn();
    this._startMove(ev, id);
  }

  /** Drag-move every selected element together. */
  _startMove(ev, id) {
    const c = this._canvasEl;
    const els = this.selEls();
    if (!els.length) return;
    const start = this.renderer.toLogical(ev.clientX, ev.clientY);
    c.setPointerCapture(ev.pointerId);
    let moved = false, delta = { x: 0, y: 0 };
    const nodes = els.map((el) => this.renderer.nodeFor(el.id)).filter(Boolean);
    const move = (e) => {
      const cur = this.renderer.toLogical(e.clientX, e.clientY);
      delta = { x: cur.x - start.x, y: cur.y - start.y };
      if (Math.hypot(delta.x, delta.y) > 2) moved = true;
      for (const node of nodes) node.style.transform = `translate(${delta.x}px, ${delta.y}px)`;
      this._moveSelGroup(delta);
    };
    const up = async () => {
      c.releasePointerCapture?.(ev.pointerId);
      c.removeEventListener("pointermove", move);
      c.removeEventListener("pointerup", up);
      for (const node of nodes) node.style.transform = "";
      if (moved) await this._commitMove(els, delta);
    };
    c.addEventListener("pointermove", move);
    c.addEventListener("pointerup", up);
  }

  async _commitMove(els, delta) {
    const dx = Math.round(delta.x), dy = Math.round(delta.y);
    if (!dx && !dy) return;
    const patches = {};
    for (const el of els) {
      if ((el.type === "room" && el.shape === "polygon") || el.type === "connector") {
        patches[el.id] = { points: el.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) };
      } else {
        patches[el.id] = { x: (el.x ?? 0) + dx, y: (el.y ?? 0) + dy };
      }
    }
    await MapStore.updateElements(this._editId, patches);
    this.refresh();
  }

  /** Rubber-band selection over empty canvas. */
  _startMarquee(ev) {
    const c = this._canvasEl;
    const start = this.renderer.toLogical(ev.clientX, ev.clientY);
    c.setPointerCapture(ev.pointerId);
    const rect = document.createElementNS(SVGNS, "rect");
    rect.setAttribute("class", "glmm-st-marquee");
    this.renderer.layers.fx.appendChild(rect);
    let cur = start, moved = false;
    const draw = () => {
      const x = Math.min(start.x, cur.x), y = Math.min(start.y, cur.y);
      rect.setAttribute("x", x); rect.setAttribute("y", y);
      rect.setAttribute("width", Math.abs(cur.x - start.x)); rect.setAttribute("height", Math.abs(cur.y - start.y));
    };
    draw();
    const move = (e) => { cur = this.renderer.toLogical(e.clientX, e.clientY); if (Math.hypot(cur.x - start.x, cur.y - start.y) > 3) moved = true; draw(); };
    const up = () => {
      c.releasePointerCapture?.(ev.pointerId);
      c.removeEventListener("pointermove", move);
      c.removeEventListener("pointerup", up);
      rect.remove();
      if (!moved) return;
      const box = { x: Math.min(start.x, cur.x), y: Math.min(start.y, cur.y), w: Math.abs(cur.x - start.x), h: Math.abs(cur.y - start.y) };
      const hits = this._elementsInBox(box);
      if (ev.shiftKey) for (const id of hits) this._selIds.add(id);
      else this._selIds = new Set(hits);
      this._selId = [...this._selIds].at(-1) ?? null;
      this._buildProps();
      this._refreshSelectionVisn();
    };
    c.addEventListener("pointermove", move);
    c.addEventListener("pointerup", up);
  }

  _elementsInBox(box) {
    const m = this.editMap();
    if (!m) return [];
    const hit = [];
    for (const el of m.elements ?? []) {
      const b = this.bboxOf(el);
      if (!b) continue;
      if (b.x < box.x + box.w && b.x + b.w > box.x && b.y < box.y + box.h && b.y + b.h > box.y) hit.push(el.id);
    }
    return hit;
  }

  _startResize(ev) {
    ev.stopPropagation();
    const el = this.selEl();
    if (!el || el.type !== "room" || el.shape === "polygon") return;
    const c = this._canvasEl;
    c.setPointerCapture(ev.pointerId);
    const x0 = el.x ?? 0, y0 = el.y ?? 0;
    const move = (e) => {
      const p = this.renderer.toLogical(e.clientX, e.clientY);
      const w = Math.max(24, Math.round(p.x - x0));
      const h = Math.max(24, Math.round(p.y - y0));
      const node = this.renderer.nodeFor(el.id)?.querySelector(".glmm-room-shape");
      if (node) {
        if (el.shape === "ellipse") { node.setAttribute("cx", x0 + w / 2); node.setAttribute("cy", y0 + h / 2); node.setAttribute("rx", w / 2); node.setAttribute("ry", h / 2); }
        else { node.setAttribute("width", w); node.setAttribute("height", h); }
      }
      this._pendingResize = { w, h };
      this._drawSelection({ w, h });
    };
    const up = async () => {
      c.releasePointerCapture?.(ev.pointerId);
      c.removeEventListener("pointermove", move);
      c.removeEventListener("pointerup", up);
      if (this._pendingResize) { await MapStore.updateElement(this._editId, el.id, this._pendingResize); this._pendingResize = null; this.refresh(); }
    };
    c.addEventListener("pointermove", move);
    c.addEventListener("pointerup", up);
  }

  /* --------------------------- selection overlay ------------------------- */

  bboxOf(el, override = {}) {
    if (!el) return null;
    if (el.type === "room" && el.shape !== "polygon") return { x: el.x ?? 0, y: el.y ?? 0, w: override.w ?? el.w ?? 0, h: override.h ?? el.h ?? 0 };
    if ((el.type === "room" && el.shape === "polygon") || el.type === "connector") {
      const xs = el.points.map((p) => p.x), ys = el.points.map((p) => p.y);
      return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
    }
    const r = el.type === "marker" ? (el.r ?? 16) * 1.6 : (el.size ?? 36) * 0.9;
    return { x: (el.x ?? 0) - r, y: (el.y ?? 0) - r, w: r * 2, h: r * 2 };
  }

  _clearSelection() { this._selGroup?.remove(); this._selGroup = null; }

  /** Update selection highlighting + overlay without rebuilding the canvas. */
  _refreshSelectionVisn() {
    this.renderer.svg.querySelectorAll(".glmm-el.is-multi-sel").forEach((n) => n.classList.remove("is-multi-sel"));
    for (const id of this._selIds) this.renderer.nodeFor(id)?.classList.add("is-multi-sel");
    this._drawSelection();
  }

  _drawSelection(override = {}) {
    this._clearSelection();
    const els = this.selEls();
    if (!els.length) return;
    const single = els.length === 1;
    const g = document.createElementNS(SVGNS, "g");
    g.setAttribute("class", "glmm-st-sel");
    const pad = 8;
    for (const el of els) {
      const b = this.bboxOf(el, single ? override : {});
      if (!b) continue;
      const rect = document.createElementNS(SVGNS, "rect");
      rect.setAttribute("class", "glmm-st-selbox");
      rect.setAttribute("x", b.x - pad); rect.setAttribute("y", b.y - pad);
      rect.setAttribute("width", b.w + pad * 2); rect.setAttribute("height", b.h + pad * 2);
      g.appendChild(rect);
      if (single && el.type === "room" && el.shape !== "polygon") {
        const handle = document.createElementNS(SVGNS, "rect");
        handle.setAttribute("class", "glmm-st-handle");
        handle.dataset.handle = "se";
        handle.setAttribute("x", b.x + b.w - 7); handle.setAttribute("y", b.y + b.h - 7);
        handle.setAttribute("width", 14); handle.setAttribute("height", 14);
        g.appendChild(handle);
      }
    }
    this.renderer.svg.appendChild(g);
    this._selGroup = g;
  }

  _moveSelGroup(delta) {
    if (this._selGroup) this._selGroup.setAttribute("transform", `translate(${delta.x} ${delta.y})`);
  }

  /* ------------------------------- properties ---------------------------- */

  _buildProps() {
    const el = this._propsEl;
    el.replaceChildren();
    if (this._selIds.size > 1) return this._buildGroupProps();
    const sel = this.selEl();
    if (!sel) { this._buildMapProps(); return; }

    el.appendChild(mkPropHead(game.i18n.localize(`GLMM.element.${sel.type}`), () => this._deleteSel()));

    // color
    el.appendChild(this._swatchRow(sel.color, (c) => this._patch({ color: c })));

    if (sel.type === "label") {
      el.appendChild(this._textRow("GLMM.props.text", sel.text ?? "", (v) => this._patch({ text: v })));
      el.appendChild(this._rangeRow("GLMM.props.size", sel.size ?? 28, 12, 90, (v) => this._patch({ size: v })));
    }
    if (sel.type === "room") {
      el.appendChild(this._textRow("GLMM.props.label", sel.label ?? "", (v) => this._patch({ label: v })));
    }
    if (sel.type === "icon") {
      el.appendChild(this._textRow("GLMM.props.label", sel.label ?? "", (v) => this._patch({ label: v })));
      el.appendChild(this._rangeRow("GLMM.props.size", sel.size ?? 42, 18, 110, (v) => this._patch({ size: v })));
      el.appendChild(this._iconPicker(sel.icon, (c) => this._patch({ icon: c })));
    }
    if (sel.type === "marker") {
      const kind = sel.kind ?? "member";
      el.appendChild(this._kindRow(kind, (v) => {
        const patch = { kind: v };
        if (v === "party" && (!sel.color || sameColor(sel.color, DEFAULT_MARKER_COLOR))) patch.color = DEFAULT_PARTY_COLOR;
        this._patch(patch);
        this._buildProps();
      }));
      if (kind !== "party") {
        el.appendChild(this._userRow(sel.userId ?? "", (v) => this._patch({ userId: v || null })));
      }
      el.appendChild(this._textRow("GLMM.props.nameOverride", sel.label ?? "", (v) => this._patch({ label: v })));
      el.appendChild(this._rangeRow("GLMM.props.size", sel.r ?? 16, 8, 48, (v) => this._patch({ r: v })));
    }
    if (sel.type === "connector") {
      el.appendChild(this._toggleRow("GLMM.props.dashed", !!sel.dashed, (v) => this._patch({ dashed: v })));
    }

    // notes (player-visible + GM-only)
    el.appendChild(this._textareaRow("GLMM.props.note", sel.note ?? "", (v) => this._patch({ note: v })));
    el.appendChild(this._textareaRow("GLMM.props.gmnote", sel.noteGM ?? "", (v) => this._patch({ noteGM: v })));

    // visibility (fog)
    el.appendChild(this._toggleRow("GLMM.props.hidden", !!sel.hidden, (v) => this._patch({ hidden: v })));

    // z-order
    const z = document.createElement("div");
    z.className = "glmm-prop-row glmm-prop-z";
    const back = mkIconBtn("fa-arrow-down", "GLMM.props.back");
    back.addEventListener("click", async () => { await MapStore.reorderElement(this._editId, sel.id, -1); this.refresh(); });
    const fwd = mkIconBtn("fa-arrow-up", "GLMM.props.front");
    fwd.addEventListener("click", async () => { await MapStore.reorderElement(this._editId, sel.id, 1); this.refresh(); });
    z.append(mkLabel(game.i18n.localize("GLMM.props.order")), back, fwd);
    el.appendChild(z);
  }

  _buildMapProps() {
    const el = this._propsEl;
    const m = this.editMap();
    if (!m) {
      const d = document.createElement("div");
      d.className = "glmm-prop-hint";
      d.textContent = game.i18n.localize("GLMM.studio.pickOrCreate");
      el.appendChild(d);
      return;
    }
    el.appendChild(mkPropHead(m.name, null));
    const hint = document.createElement("div");
    hint.className = "glmm-prop-hint";
    hint.textContent = game.i18n.localize("GLMM.studio.selectHint");
    el.appendChild(hint);
  }

  /** Properties for a multi-element selection (group recolour + delete). */
  _buildGroupProps() {
    const el = this._propsEl;
    el.appendChild(mkPropHead(game.i18n.format("GLMM.props.multi", { n: this._selIds.size }), () => this._deleteSel()));
    const hint = document.createElement("div");
    hint.className = "glmm-prop-hint";
    hint.textContent = game.i18n.localize("GLMM.props.multiHint");
    el.appendChild(hint);
    el.appendChild(this._swatchRow(null, (c) => this._patchGroup({ color: c })));
  }

  async _patch(patch) {
    const sel = this.selEl();
    if (!sel) return;
    await MapStore.updateElement(this._editId, sel.id, patch);
    this._renderCanvas();
    this._buildStatus();
    this.cb.refreshViewer?.();
  }

  async _deleteSel() {
    if (this._selIds.size > 1) {
      await MapStore.removeElements(this._editId, [...this._selIds]);
    } else {
      const sel = this.selEl();
      if (!sel) return;
      await MapStore.removeElement(this._editId, sel.id);
    }
    this._selId = null;
    this._selIds.clear();
    this.refresh();
  }

  /** Apply one patch to every selected element (single undo step). */
  async _patchGroup(patch) {
    if (!this._selIds.size) return;
    const patches = {};
    for (const id of this._selIds) patches[id] = { ...patch };
    await MapStore.updateElements(this._editId, patches);
    this._renderCanvas();
    this._buildStatus();
    this.cb.refreshViewer?.();
  }

  _onKey(ev) {
    if (!this.rendered) return;
    const mod = ev.ctrlKey || ev.metaKey;
    if (mod && (ev.key === "z" || ev.key === "Z")) {
      if (isTyping(ev)) return;
      ev.preventDefault();
      if (ev.shiftKey) this._redo(); else this._undo();
      return;
    }
    if (mod && (ev.key === "y" || ev.key === "Y")) { if (isTyping(ev)) return; ev.preventDefault(); this._redo(); return; }
    if (ev.code === "Space" && !isTyping(ev)) { this._space = true; this._canvasEl?.classList.add("can-pan"); }
    if ((ev.key === "Delete" || ev.key === "Backspace") && (this._selId || this._selIds.size) && !isTyping(ev)) { ev.preventDefault(); this._deleteSel(); }
    if (ev.key === "Escape") {
      if (this._poly) { this._poly = null; this.renderer.clearFx(); }
      else if (this._selIds.size) { this._selId = null; this._selIds.clear(); this._buildProps(); this._refreshSelectionVisn(); }
    }
    if (ev.key === "Enter" && this._poly) { ev.preventDefault(); this._finishPoly(); }
  }

  _onKeyUp(ev) {
    if (ev.code === "Space") { this._space = false; this._canvasEl?.classList.remove("can-pan"); }
  }

  /* --------------------------- prop control builders --------------------- */

  _swatchRow(current, onPick) {
    const row = mkRow("GLMM.props.color");
    const wrap = document.createElement("div");
    wrap.className = "glmm-swatches";
    for (const c of PALETTE) {
      const b = document.createElement("button");
      b.className = "glmm-swatch" + (sameColor(c, current) ? " is-on" : "");
      b.style.background = c;
      b.addEventListener("click", () => { onPick(c); this._buildProps(); });
      wrap.appendChild(b);
    }
    const custom = document.createElement("input");
    custom.type = "color";
    custom.className = "glmm-swatch-custom";
    custom.value = toHex6(current);
    custom.addEventListener("input", () => onPick(custom.value));
    wrap.appendChild(custom);
    row.appendChild(wrap);
    return row;
  }

  _textRow(labelKey, value, onChange) {
    const row = mkRow(labelKey);
    const i = document.createElement("input");
    i.type = "text"; i.className = "gls-input"; i.value = value;
    i.addEventListener("change", () => onChange(i.value));
    row.appendChild(i);
    return row;
  }

  _textareaRow(labelKey, value, onChange) {
    const row = mkRow(labelKey, true);
    const a = document.createElement("textarea");
    a.className = "gls-input glmm-textarea"; a.rows = 2; a.value = value;
    a.addEventListener("change", () => onChange(a.value));
    row.appendChild(a);
    return row;
  }

  _rangeRow(labelKey, value, min, max, onChange) {
    const row = mkRow(labelKey);
    const wrap = document.createElement("div");
    wrap.className = "gls-range";
    const r = document.createElement("input");
    r.type = "range"; r.min = min; r.max = max; r.value = value;
    const v = document.createElement("span"); v.className = "gls-range-val"; v.textContent = value;
    r.addEventListener("input", () => { v.textContent = r.value; });
    r.addEventListener("change", () => onChange(Number(r.value)));
    wrap.append(r, v);
    row.appendChild(wrap);
    return row;
  }

  _toggleRow(labelKey, on, onChange) {
    const row = mkRow(labelKey);
    const b = document.createElement("button");
    b.type = "button";
    b.className = "gls-switch gls-switch-sm" + (on ? " is-on" : "");
    b.innerHTML = `<span class="gls-switch-track"><span class="gls-switch-thumb"></span></span>`;
    b.setAttribute("aria-pressed", String(on));
    b.addEventListener("click", () => { const next = b.getAttribute("aria-pressed") !== "true"; b.classList.toggle("is-on", next); b.setAttribute("aria-pressed", String(next)); onChange(next); });
    row.appendChild(b);
    return row;
  }

  _kindRow(current, onChange) {
    const row = mkRow("GLMM.props.markerKind");
    const sel = document.createElement("select");
    sel.className = "gls-input gls-select";
    for (const k of MARKER_KINDS) {
      const o = document.createElement("option");
      o.value = k; o.textContent = game.i18n.localize(`GLMM.markerKind.${k}`);
      if (current === k) o.selected = true;
      sel.appendChild(o);
    }
    sel.addEventListener("change", () => onChange(sel.value));
    row.appendChild(sel);
    return row;
  }

  _userRow(current, onChange) {
    const row = mkRow("GLMM.props.bindUser");
    const sel = document.createElement("select");
    sel.className = "gls-input gls-select";
    const none = document.createElement("option");
    none.value = ""; none.textContent = game.i18n.localize("GLMM.props.noUser");
    sel.appendChild(none);
    for (const u of game.users ?? []) {
      const o = document.createElement("option");
      o.value = u.id; o.textContent = u.name + (u.isGM ? " (GM)" : "");
      if (u.id === current) o.selected = true;
      sel.appendChild(o);
    }
    sel.addEventListener("change", () => onChange(sel.value));
    row.appendChild(sel);
    return row;
  }

  _iconPicker(current, onPick) {
    const row = mkRow("GLMM.props.icon", true);
    const grid = document.createElement("div");
    grid.className = "glmm-iconpick";
    for (const ic of ICON_CATALOG) {
      const b = document.createElement("button");
      b.className = "glmm-iconpick-b" + (current === ic.cls ? " is-on" : "");
      b.title = game.i18n.localize(`GLMM.icon.${ic.key}`);
      b.innerHTML = `<i class="${ic.cls}"></i>`;
      b.addEventListener("click", () => { onPick(ic.cls); this._buildProps(); });
      grid.appendChild(b);
    }
    row.appendChild(grid);
    const free = document.createElement("input");
    free.type = "text"; free.className = "gls-input glmm-iconfree";
    free.placeholder = "fa-solid fa-...";
    free.value = current ?? "";
    free.addEventListener("change", () => onPick(safeIconClass(free.value)));
    row.appendChild(free);
    return row;
  }
}

/* ------------------------------- DOM helpers ------------------------------ */

function mkRow(labelKey, stacked = false) {
  const row = document.createElement("div");
  row.className = "glmm-prop-row" + (stacked ? " is-stacked" : "");
  row.appendChild(mkLabel(game.i18n.localize(labelKey)));
  return row;
}
function mkLabel(text) { const l = document.createElement("label"); l.className = "glmm-prop-label"; l.textContent = text; return l; }
function mkIconBtn(icon, titleKey) {
  const b = document.createElement("button");
  b.type = "button"; b.className = "glmm-icobtn"; b.title = game.i18n.localize(titleKey);
  b.innerHTML = `<i class="fa-solid ${icon}"></i>`;
  return b;
}
function mkPropHead(title, onDelete) {
  const h = document.createElement("div");
  h.className = "glmm-prop-head";
  const t = document.createElement("span"); t.className = "glmm-prop-title"; t.textContent = title;
  h.appendChild(t);
  if (onDelete) {
    const d = mkIconBtn("fa-trash", "GLMM.props.deleteEl");
    d.classList.add("is-danger");
    d.addEventListener("click", onDelete);
    h.appendChild(d);
  }
  return h;
}

async function promptText(title, initial) {
  try {
    return await DialogV2.prompt({
      window: { title },
      content: `<input type="text" name="v" value="${foundry.utils.escapeHTML?.(initial ?? "") ?? initial ?? ""}" style="width:100%">`,
      ok: { label: game.i18n.localize("GLMM.ok"), callback: (ev, btn) => btn.form.elements.v.value.trim() }
    });
  } catch {
    return null;
  }
}

const toHex6 = (c) => { const s = String(c ?? "#6b86d6"); return /^#[0-9a-f]{6}$/i.test(s) ? s : "#6b86d6"; };
const sameColor = (a, b) => String(a ?? "").toLowerCase() === String(b ?? "").toLowerCase();
function isTyping(ev) { const t = ev.target; return t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable); }
