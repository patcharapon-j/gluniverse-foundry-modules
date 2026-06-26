/**
 * GLUniverse Suite — Minimap floating viewer.
 *
 * A frameless, draggable, resizable ApplicationV2 that everyone sees. It hosts a
 * MapRenderer and morphs between a compact dock and an expanded panel (same
 * window, animated). The GM sees the live draft (with hidden elements ghosted)
 * and can quick-drag markers (staged, never live), push, and draw attention;
 * players see the published snapshot read-only and can ping. A broadcast expands
 * the window, animates the diff, then collapses back.
 *
 * Geometry is per-client (mm.viewerState). All authoritative data flows through
 * the controller via the `actions` callbacks passed in.
 */

import {
  MODULE_ID, SETTINGS, VIEWER_COMPACT, VIEWER_EXPANDED, BROADCAST, MAP_W, MAP_H
} from "./const.mjs";
import { MapStore } from "./data.mjs";
import { MapRenderer } from "./render.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const PRESS_PING_MS = 430;
const MOVE_CANCEL_PX = 6;

export class MinimapViewer extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(actions = {}) {
    super();
    this.actions = actions;
    this.renderer = null;
    this._payload = null;     // last present() payload (re-applied on re-render)
    this._displayed = null;   // snapshot currently shown (diff base)
    this._free = false;       // player broke out of GM/auto framing
    this._armAttention = false;
    this._geom = this._loadGeom();
    this._expanded = this._geom.isExpanded;
  }

  static DEFAULT_OPTIONS = {
    id: "glmm-viewer",
    classes: ["glmm", "glmm-viewer-app"],
    tag: "div",
    window: { frame: false, positioned: false, minimizable: false, resizable: false }
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/minimap/viewer.hbs` }
  };

  get isGM() { return !!game.user?.isGM; }

  /* ------------------------------- geometry ------------------------------ */

  _loadGeom() {
    let saved = {};
    try { saved = game.settings.get(MODULE_ID, SETTINGS.viewer) ?? {}; } catch { /* not ready */ }
    const w = window.innerWidth, h = window.innerHeight;
    const compact = Object.assign(
      { width: VIEWER_COMPACT.width, height: VIEWER_COMPACT.height, left: w - VIEWER_COMPACT.width - 20, top: 90 },
      saved.compact
    );
    const expanded = Object.assign(
      { width: VIEWER_EXPANDED.width, height: VIEWER_EXPANDED.height, left: Math.max(20, (w - VIEWER_EXPANDED.width) / 2), top: Math.max(20, (h - VIEWER_EXPANDED.height) / 2) },
      saved.expanded
    );
    return { compact, expanded, isExpanded: !!saved.isExpanded };
  }

  _saveGeom() {
    this._geomSaveT && clearTimeout(this._geomSaveT);
    this._geomSaveT = setTimeout(() => {
      try {
        game.settings.set(MODULE_ID, SETTINGS.viewer, {
          compact: this._geom.compact,
          expanded: this._geom.expanded,
          isExpanded: this._expanded
        });
      } catch { /* ignore */ }
    }, 350);
  }

  _curGeom() { return this._expanded ? this._geom.expanded : this._geom.compact; }

  _applyGeom(animate = false) {
    const el = this.element;
    if (!el) return;
    const g = this._curGeom();
    const W = window.innerWidth, H = window.innerHeight;
    g.left = Math.min(Math.max(0, g.left), Math.max(0, W - 80));
    g.top = Math.min(Math.max(0, g.top), Math.max(0, H - 60));
    el.classList.toggle("is-animating", animate);
    el.style.position = "fixed";
    el.style.left = `${g.left}px`;
    el.style.top = `${g.top}px`;
    el.style.width = `${g.width}px`;
    el.style.height = `${g.height}px`;
    el.dataset.state = this._expanded ? "expanded" : "compact";
    if (animate) {
      clearTimeout(this._animT);
      this._animT = setTimeout(() => el.classList.remove("is-animating"), 560);
    }
  }

  /* ------------------------------- lifecycle ----------------------------- */

  async _prepareContext(options) {
    const ctx = await super._prepareContext(options);
    return Object.assign(ctx, { isGM: this.isGM });
  }

  async open() {
    if (!this.rendered) await this.render(true);
    return this;
  }

  async ensureRendered() {
    if (!this.rendered) await this.render(true);
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    const root = this.element;
    this._stageEl = root.querySelector("[data-stage]");
    this._toolsEl = root.querySelector("[data-tools]");
    this._modeEl = root.querySelector("[data-mode]");
    this._titleEl = root.querySelector("[data-title]");
    this._panelEl = root.querySelector("[data-panel]");
    this._pendingEl = root.querySelector("[data-pending]");
    this._freeEl = root.querySelector("[data-freelook]");
    this._stageEl.dataset.empty = game.i18n.localize("GLMM.viewer.empty");
    root.querySelector("[data-resize]")?.setAttribute("title", game.i18n.localize("GLMM.viewer.tool.expand"));

    this.renderer = new MapRenderer(this._stageEl, {
      isGM: this.isGM,
      interactive: true
    });

    this._buildTools();
    this._wireChrome(root);
    this._wireStage();
    this._applyGeom(false);

    if (this._payload) this._apply(this._payload);
  }

  async _onClose(options) {
    this._saveGeom();
    this.renderer?.destroy();
    if (this._onWinResize) window.removeEventListener("resize", this._onWinResize);
    clearTimeout(this._animT);
    await super._onClose(options);
  }

  /* -------------------------------- chrome ------------------------------- */

  _buildTools() {
    const tools = [];
    if (this.isGM) {
      tools.push(
        { a: "studio", i: "fa-pen-ruler", t: "GLMM.viewer.tool.studio" },
        { a: "attention", i: "fa-bullseye", t: "GLMM.viewer.tool.attention", toggle: true },
        { a: "silent", i: "fa-eye-low-vision", t: "GLMM.viewer.tool.silent" },
        { a: "broadcast", i: "fa-tower-broadcast", t: "GLMM.viewer.tool.broadcast", accent: true }
      );
    }
    tools.push(
      { a: "recenter", i: "fa-crosshairs", t: "GLMM.viewer.tool.recenter" },
      { a: "expand", i: "fa-up-right-and-down-left-from-center", t: "GLMM.viewer.tool.expand" },
      { a: "close", i: "fa-xmark", t: "GLMM.viewer.tool.close" }
    );
    this._toolsEl.replaceChildren();
    for (const tdef of tools) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "glmm-vtool" + (tdef.accent ? " is-accent" : "");
      b.dataset.action = tdef.a;
      b.title = game.i18n.localize(tdef.t);
      b.setAttribute("aria-label", b.title);
      const ic = document.createElement("i");
      ic.className = `fa-solid ${tdef.i}`;
      b.appendChild(ic);
      b.addEventListener("click", (ev) => { ev.stopPropagation(); this._onTool(tdef.a, b); });
      this._toolsEl.appendChild(b);
    }
  }

  _onTool(action, btn) {
    switch (action) {
      case "studio": this.actions.openStudio?.(); break;
      case "attention":
        this._armAttention = !this._armAttention;
        btn.classList.toggle("is-armed", this._armAttention);
        this.element.classList.toggle("is-arming", this._armAttention);
        break;
      case "silent": this.actions.pushSilent?.(); break;
      case "broadcast": this.actions.pushBroadcast?.(); break;
      case "recenter": this._free = false; this._updateFreeChip(); this.actions.recenterRequest?.(); this._frameForView(); break;
      case "expand": this.toggleExpand(); break;
      case "close": this.close(); break;
    }
  }

  _wireChrome(root) {
    const drag = root.querySelector("[data-drag]");
    if (drag) this._wireDrag(drag);
    const grip = root.querySelector("[data-resize]");
    if (grip) this._wireResize(grip);
    this._freeEl?.addEventListener("click", () => { this._free = false; this._updateFreeChip(); this._frameForView(); });
    this._onWinResize = () => this._applyGeom(false);
    window.addEventListener("resize", this._onWinResize);
  }

  _wireDrag(handle) {
    handle.addEventListener("pointerdown", (ev) => {
      if (ev.target.closest(".glmm-vtool")) return;
      ev.preventDefault();
      const g = this._curGeom();
      const sx = ev.clientX, sy = ev.clientY, l0 = g.left, t0 = g.top;
      handle.setPointerCapture(ev.pointerId);
      const move = (e) => { g.left = l0 + (e.clientX - sx); g.top = t0 + (e.clientY - sy); this._applyGeom(false); };
      const up = (e) => {
        handle.releasePointerCapture?.(ev.pointerId);
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", up);
        this._saveGeom();
      };
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", up);
    });
  }

  _wireResize(grip) {
    grip.addEventListener("pointerdown", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const g = this._curGeom();
      const sx = ev.clientX, sy = ev.clientY, w0 = g.width, h0 = g.height;
      grip.setPointerCapture(ev.pointerId);
      const move = (e) => {
        g.width = Math.max(220, w0 + (e.clientX - sx));
        g.height = Math.max(170, h0 + (e.clientY - sy));
        this._applyGeom(false);
      };
      const up = () => {
        grip.releasePointerCapture?.(ev.pointerId);
        grip.removeEventListener("pointermove", move);
        grip.removeEventListener("pointerup", up);
        this._saveGeom();
      };
      grip.addEventListener("pointermove", move);
      grip.addEventListener("pointerup", up);
    });
  }

  /* ----------------------------- expand / morph -------------------------- */

  setExpanded(on, { persist = true } = {}) {
    if (this._expanded === on) return;
    this._expanded = on;
    this.element?.querySelector('[data-action="expand"] i')?.setAttribute(
      "class",
      `fa-solid ${on ? "fa-down-left-and-up-right-to-center" : "fa-up-right-and-down-left-from-center"}`
    );
    this._applyGeom(true);
    this._updatePanel();
    if (persist) this._saveGeom();
  }

  toggleExpand() { this.setExpanded(!this._expanded); }

  /* ------------------------------- content ------------------------------- */

  /** Immediate (non-animated) content set. payload: {snapshot, ghosts, isGM, viewMode, pending}. */
  present(payload) {
    this._payload = payload;
    if (this.rendered) this._apply(payload);
  }

  _apply(payload) {
    const snap = payload.snapshot ?? null;
    this.renderer.opts.isGM = !!payload.isGM;
    this.renderer.setSnapshot(snap, { ghosts: payload.ghosts ?? [] });
    this._displayed = snap;
    this._viewMode = payload.viewMode ?? snap?.viewMode ?? "shared";
    this._titleEl.textContent = snap?.name ?? game.i18n.localize("GLMM.viewer.empty");
    this._updateMode();
    this._updatePanel();
    this.setPending(payload.pending ?? 0);
    this._free = false;
    this._updateFreeChip();
    this._frameForView();
    this.element.classList.toggle("is-empty", !snap);
  }

  /** Player path: swap to a new published snapshot, animating the diff on broadcast. */
  applyPublished(snap, mode) {
    if (!this.rendered) { this._payload = { snapshot: snap, isGM: false, viewMode: snap?.viewMode }; return; }
    const diff = MapStore.diff(this._displayed, snap);
    if (mode === "broadcast" && MapStore.hasChanges(diff)) {
      this._broadcastSequence(snap, diff);
    } else {
      this.renderer.setSnapshot(snap, { ghosts: [] });
      this._displayed = snap;
      this._viewMode = snap?.viewMode ?? "shared";
      this._titleEl.textContent = snap?.name ?? "";
      this._updateMode();
      this._updatePanel();
      this._frameForView();
    }
  }

  async _broadcastSequence(snap, diff) {
    const wasExpanded = this._expanded;
    this.element.classList.add("is-broadcasting");
    if (!wasExpanded) this.setExpanded(true, { persist: false });

    await this._wait(wasExpanded ? 60 : BROADCAST.expand);

    // Frame the action: centre on the moved/added elements.
    this._frameForChange(snap, diff);
    await this._wait(BROADCAST.settle);

    await this.renderer.animateDiff(this._displayed, snap, diff);
    this._displayed = snap;
    this._viewMode = snap?.viewMode ?? "shared";
    this._titleEl.textContent = snap?.name ?? "";
    this._updateMode();
    this._updatePanel();

    await this._wait(BROADCAST.hold);
    if (!wasExpanded) this.setExpanded(false, { persist: false });
    this.element.classList.remove("is-broadcasting");
    this._frameForView();
  }

  _wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

  /* ------------------------------- framing ------------------------------- */

  _selfAnchor() {
    const el = (this._displayed?.elements ?? []).find((e) => e.type === "marker" && e.userId === game.user?.id);
    return el ? this.renderer.anchorOf?.(el) ?? { x: el.x, y: el.y } : null;
  }

  /** Apply the view-mode default framing (unless the user is free-looking). */
  _frameForView() {
    if (!this.renderer || this._free) return;
    const mode = this._viewMode ?? "shared";
    if (mode === "follow") {
      const a = this._selfAnchor();
      if (a) { this.renderer.animateView({ x: a.x, y: a.y }, 1.9, 480); return; }
    }
    // shared (initial) and freeform both default to fit-all
    this.renderer.fit();
  }

  _frameForChange(snap, diff) {
    const pts = [];
    for (const m of diff.moved ?? []) { pts.push(m.from, m.to); }
    for (const el of [...(diff.added ?? []), ...(diff.changed ?? [])]) pts.push(MapStore.anchorOf(el));
    if (!pts.length) { this.renderer.fit(); return; }
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const spanX = Math.max(120, Math.max(...xs) - Math.min(...xs));
    const spanY = Math.max(120, Math.max(...ys) - Math.min(...ys));
    const zoom = Math.min(2.4, Math.max(1, Math.min((snap.w ?? MAP_W) / (spanX * 1.6), (snap.h ?? MAP_H) / (spanY * 1.6))));
    this.renderer.animateView({ x: cx, y: cy }, zoom, 420);
  }

  /* ----------------------------- mode / panel / pending ------------------ */

  _updateMode() {
    if (!this._modeEl) return;
    const map = { shared: "fa-users-viewfinder", freeform: "fa-arrows-up-down-left-right", follow: "fa-location-crosshairs" };
    const mode = this._viewMode ?? "shared";
    this._modeEl.innerHTML = "";
    const i = document.createElement("i");
    i.className = `fa-solid ${map[mode] ?? "fa-users-viewfinder"}`;
    const span = document.createElement("span");
    span.textContent = game.i18n.localize(`GLMM.viewMode.${mode}`);
    this._modeEl.append(i, span);
  }

  _updatePanel() {
    if (!this._panelEl) return;
    const show = this._expanded;
    this._panelEl.hidden = !show;
    if (!show || !this.renderer) return;
    const leg = this.renderer.legend();
    this._panelEl.replaceChildren();

    const mkHead = (txt) => { const d = document.createElement("div"); d.className = "glmm-panel-head"; d.textContent = txt; return d; };

    if (leg.markers.length) {
      this._panelEl.appendChild(mkHead(game.i18n.localize("GLMM.legend.roster")));
      for (const m of leg.markers) {
        const row = document.createElement("button");
        row.type = "button";
        row.className = "glmm-roster-row" + (m.isSelf ? " is-self" : "");
        row.style.setProperty("--c", m.color);
        row.innerHTML = `<span class="glmm-roster-dot"></span><span class="glmm-roster-name"></span>`;
        row.querySelector(".glmm-roster-name").textContent = m.name + (m.isSelf ? " ★" : "");
        row.addEventListener("click", () => {
          const el = (this._displayed?.elements ?? []).find((e) => e.id === m.id);
          if (el) { this._free = true; this._updateFreeChip(); this.renderer.animateView({ x: el.x, y: el.y }, 2.2, 420); this.renderer.nodeFor(m.id)?.classList.add("is-flash"); setTimeout(() => this.renderer.nodeFor(m.id)?.classList.remove("is-flash"), 1200); }
        });
        this._panelEl.appendChild(row);
      }
    }
    if (leg.icons.length) {
      this._panelEl.appendChild(mkHead(game.i18n.localize("GLMM.legend.key")));
      for (const ic of leg.icons) {
        const row = document.createElement("div");
        row.className = "glmm-legend-row";
        row.style.setProperty("--c", ic.color);
        row.innerHTML = `<i class="${ic.cls}"></i><span></span>`;
        row.querySelector("span").textContent = ic.label;
        this._panelEl.appendChild(row);
      }
    }
    if (!leg.markers.length && !leg.icons.length) {
      const d = document.createElement("div");
      d.className = "glmm-panel-empty";
      d.textContent = game.i18n.localize("GLMM.legend.empty");
      this._panelEl.appendChild(d);
    }
  }

  setPending(n) {
    if (!this._pendingEl) return;
    const has = this.isGM && n > 0;
    this._pendingEl.hidden = !has;
    if (has) this._pendingEl.textContent = game.i18n.format("GLMM.viewer.pending", { n });
  }

  _updateFreeChip() {
    if (!this._freeEl) return;
    const show = this._free && this._viewMode !== "freeform";
    this._freeEl.hidden = !show;
    if (show) this._freeEl.textContent = game.i18n.localize("GLMM.viewer.freelook");
  }

  /* --------------------------------- FX ---------------------------------- */

  ping(x, y, opts) {
    this.renderer?.ping(x, y, opts);
    if (!this._expanded) {
      this.element.classList.remove("glmm-attn");
      void this.element.offsetWidth;
      this.element.classList.add("glmm-attn");
    }
  }

  attention(x, y, { color, expand } = {}) {
    if (!this.renderer) return;
    this.renderer.attention(x, y, { color });
    this._free = true;
    this._updateFreeChip();
    this.renderer.animateView({ x, y }, 2.0, 520);
    if (expand && !this._expanded) {
      this.setExpanded(true, { persist: false });
      clearTimeout(this._attnT);
      this._attnT = setTimeout(() => { this.setExpanded(false, { persist: false }); this._free = false; this._updateFreeChip(); this._frameForView(); }, 4200);
    }
  }

  followViewport(pan, zoom) {
    if (this._free || !this.renderer) return;
    this.renderer.animateView(pan, zoom, 280);
  }

  /* ---------------------------- stage interaction ------------------------ */

  _wireStage() {
    const stage = this._stageEl;
    stage.addEventListener("wheel", (ev) => {
      ev.preventDefault();
      this.renderer.zoomAt(ev.deltaY < 0 ? 1.15 : 1 / 1.15, ev.clientX, ev.clientY);
      this._afterUserView();
    }, { passive: false });

    stage.addEventListener("pointerdown", (ev) => this._onStageDown(ev));
  }

  _onStageDown(ev) {
    if (ev.button !== 0) return;
    const stage = this._stageEl;
    const logical = this.renderer.toLogical(ev.clientX, ev.clientY);
    const elNode = ev.target.closest?.(".glmm-el");
    const elId = elNode?.dataset.id;
    const elType = elNode?.dataset.type;

    // GM: armed "draw attention" → place beacon
    if (this._armAttention && this.isGM) {
      this._armAttention = false;
      this.element.querySelector('[data-action="attention"]')?.classList.remove("is-armed");
      this.element.classList.remove("is-arming");
      this.actions.drawAttention?.(logical.x, logical.y);
      return;
    }

    // GM: drag a marker (staged)
    if (this.isGM && elType === "marker" && elId) {
      this._startMarkerDrag(elId, ev);
      return;
    }

    // Everyone: pan vs long-press ping
    this._startPanOrPing(ev, logical);
  }

  _startMarkerDrag(elId, ev) {
    const stage = this._stageEl;
    const base = (this._displayed?.elements ?? []).find((e) => e.id === elId);
    if (!base) return;
    const node = this.renderer.nodeFor(elId);
    const start = this.renderer.toLogical(ev.clientX, ev.clientY);
    node?.classList.add("is-dragging");
    stage.setPointerCapture(ev.pointerId);
    let last = { x: base.x ?? 0, y: base.y ?? 0 };
    const move = (e) => {
      const cur = this.renderer.toLogical(e.clientX, e.clientY);
      const dx = cur.x - start.x, dy = cur.y - start.y;
      if (node) node.style.transform = `translate(${dx}px, ${dy}px)`;
      last = { x: (base.x ?? 0) + dx, y: (base.y ?? 0) + dy };
    };
    const up = () => {
      stage.releasePointerCapture?.(ev.pointerId);
      stage.removeEventListener("pointermove", move);
      stage.removeEventListener("pointerup", up);
      node?.classList.remove("is-dragging");
      if (node) node.style.transform = "";
      const cx = Math.max(0, Math.min(this._displayed?.w ?? MAP_W, last.x));
      const cy = Math.max(0, Math.min(this._displayed?.h ?? MAP_H, last.y));
      this.actions.stageMarkerMove?.(elId, Math.round(cx), Math.round(cy));
    };
    stage.addEventListener("pointermove", move);
    stage.addEventListener("pointerup", up);
  }

  _startPanOrPing(ev, logical) {
    const stage = this._stageEl;
    const sx = ev.clientX, sy = ev.clientY;
    const grab = { x: logical.x, y: logical.y };
    let panning = false, moved = false;
    stage.setPointerCapture(ev.pointerId);

    const pressT = setTimeout(() => {
      if (!moved && !panning) this.actions.ping?.(logical.x, logical.y);
    }, PRESS_PING_MS);

    const move = (e) => {
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (!moved && Math.hypot(dx, dy) > MOVE_CANCEL_PX) { moved = true; clearTimeout(pressT); panning = true; }
      if (panning) {
        this.renderer.panGrab(grab, e.clientX, e.clientY);
        this._afterUserView();
      }
    };
    const up = () => {
      clearTimeout(pressT);
      stage.releasePointerCapture?.(ev.pointerId);
      stage.removeEventListener("pointermove", move);
      stage.removeEventListener("pointerup", up);
    };
    stage.addEventListener("pointermove", move);
    stage.addEventListener("pointerup", up);
  }

  /** After a user-initiated pan/zoom: GM shared mode pushes the viewport;
   *  players break out into free-look. */
  _afterUserView() {
    if (this.isGM && this._viewMode === "shared") {
      this.actions.viewportChanged?.(this.renderer.view.pan, this.renderer.view.zoom);
    } else if (this._viewMode !== "freeform") {
      if (!this._free) { this._free = true; this._updateFreeChip(); }
    }
  }
}
