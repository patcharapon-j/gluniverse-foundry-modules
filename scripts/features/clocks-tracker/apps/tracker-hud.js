/**
 * TrackerHud: the floating Resource Trackers dock, a frameless ApplicationV2.
 *
 * A thin shell. The skeleton is `dockShellHTML` and the rows are a keyed
 * `TrackerList`, both pure (../trackers/tracker-render.js), drawn from the view
 * model (../trackers/view.js). This class owns what touches the world: reading
 * the store, deciding what a gesture may do, the GM's menu, dragging the dock
 * and its rows, and the client settings for position and compact mode.
 *
 * A GM manages everything. A player sees a read-only dock, except a pool the GM
 * opened to players, which they may roll. A player with nothing to see gets no
 * dock at all.
 */

import { MODULE_ID, SETTINGS } from "../const.js";
import { TrackerStore } from "../trackers/trackers.js";
import { TYPE_ICON } from "../trackers/tracker-model.js";
import { listView } from "../trackers/view.js";
import { TrackerList, dockShellHTML, paintShell, openMenu } from "../trackers/tracker-render.js";

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

const L = (k, d) => (d ? game.i18n.format(k, d) : game.i18n.localize(k));
const getSetting = (key, fallback) => { try { return game.settings.get(MODULE_ID, key); } catch { return fallback; } };

export class TrackerHud extends HandlebarsApplicationMixin(ApplicationV2) {
  static instance = null;

  static async open() {
    this.instance ??= new this();
    await this.instance.render(true);
    return this.instance;
  }

  /** Repaint from the store (the trackers setting's onChange lands here). */
  static refresh() {
    TrackerStore.announce();
    this.instance?.update();
  }

  /** Re-render the shell (a role or mode change). */
  static async refreshStructure() {
    if (this.instance?.rendered) await this.instance.render();
  }

  static DEFAULT_OPTIONS = {
    id: "glct-tracker-hud",
    // `glct-trk-skin` is the feature's scoped skin root (dock, sheet tab, editor,
    // chat card); `glct` is the module-wide hook.
    classes: ["glct", "glct-trk-skin"],
    tag: "div",
    window: { frame: false, positioned: false, minimizable: false, resizable: false },
    actions: {
      addTracker: TrackerHud.prototype._onAddTracker,
      toggleCompact: TrackerHud.prototype._onToggleCompact,
    },
  };

  static PARTS = {
    hud: { template: `modules/${MODULE_ID}/templates/clocks-tracker/tracker-hud.hbs` },
  };

  /** @type {TrackerList|null} */
  _list = null;
  _closeMenu = null;

  get compact() { return !!getSetting(SETTINGS.trackerHudCompact, false); }
  get isGM() { return game.user?.isGM ?? false; }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    return Object.assign(context, { shell: dockShellHTML({ canWrite: this.isGM, compact: this.compact }, L) });
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    this._list?.destroy();
    const host = this.element.querySelector("[data-rows]");
    this._list = new TrackerList(host, { L, variant: "dock", onAction: (a) => this._onAction(a) });
    this._applyPosition();
    this._wireViewport();
    this._wireDrag();
    this.update({ animate: false });
  }

  async _onClose(options) {
    this._closeMenu?.();
    this._list?.destroy();
    this._list = null;
    if (this._onResize) window.removeEventListener("resize", this._onResize);
    if (this._resizeRAF) cancelAnimationFrame(this._resizeRAF);
    this._resizeRAF = null;
    this._endDrag?.();
    await super._onClose(options);
  }

  /* ------------------------------ painting ------------------------------ */

  update({ animate = true } = {}) {
    if (!this.rendered || !this._list) return;
    const view = listView(TrackerStore.all, { isGM: this.isGM, canWrite: this.isGM, compact: this.compact });
    // A row being dragged keeps its place until the drop writes the new order.
    if (this._dragging) return;
    this._list.update(view, { animate });
    paintShell(this.element, view);
    this.element.hidden = !view.show;
  }

  /* ------------------------------ gestures ------------------------------ */

  _onAction({ act, id, ev, row }) {
    const t = TrackerStore.get(id);
    if (!t) return;
    const gm = this.isGM;
    switch (act) {
      case "inc": if (gm) TrackerStore.step(id, +1); break;
      case "dec": if (gm) TrackerStore.step(id, -1); break;
      case "roll": TrackerStore.rollPool(id); break;
      case "reset": if (gm) TrackerStore.resetPool(id); break;
      case "menu": if (gm) this._openMenu(t, ev, row); break;
      case "grip": if (gm) this._beginReorder(ev, row); break;
    }
  }

  _menuItems(t) {
    const items = [{ icon: "fa-solid fa-pen", label: L("GLCT.tracker.edit"), run: () => this._edit(t.id) }];
    items.push({ icon: "fa-solid fa-clone", label: L("GLCT.tracker.ctx.duplicate"), run: () => TrackerStore.duplicate(t.id) });
    if (t.type !== "separator") {
      items.push({
        icon: t.prominent ? "fa-solid fa-down-left-and-up-right-to-center" : "fa-solid fa-up-right-and-down-left-from-center",
        label: L(t.prominent ? "GLCT.tracker.ctx.unpromote" : "GLCT.tracker.ctx.promote"),
        run: () => TrackerStore.setProminent(t.id, !t.prominent),
      });
    }
    items.push({
      icon: t.visibleToPlayers ? "fa-solid fa-eye-slash" : "fa-solid fa-eye",
      label: L(t.visibleToPlayers ? "GLCT.tracker.ctx.hide" : "GLCT.tracker.ctx.show"),
      run: () => TrackerStore.setVisibility(t.id, !t.visibleToPlayers),
    });
    const values = valueItems(t, TrackerStore);
    if (values.length) items.push({ sep: true }, ...values);
    items.push({ sep: true });
    items.push({ icon: "fa-solid fa-trash", label: L("GLCT.tracker.delete"), danger: true, run: () => this._delete(t.id) });
    return items;
  }

  _openMenu(t, ev, row) {
    this._closeMenu?.();
    let x = ev?.clientX, y = ev?.clientY;
    if (!Number.isFinite(x) || (x === 0 && y === 0)) {
      const r = row.getBoundingClientRect();
      x = r.right - 8; y = r.top + r.height / 2;
    }
    const root = this.element.querySelector(".glct-trk-root") ?? this.element;
    this._closeMenu = openMenu(root, x, y, this._menuItems(t));
  }

  /* --------------------------- row reorder (GM) --------------------------- */

  _beginReorder(ev, row) {
    ev.preventDefault();
    const host = this._list.host;
    const startY = ev.clientY;
    let moved = false;
    row.classList.add("is-dragging");
    this._dragging = true;
    const move = (e) => {
      if (!moved && Math.abs(e.clientY - startY) < 3) return;
      moved = true;
      const after = [...host.querySelectorAll(".trk-row:not(.is-dragging)")].find((c) => {
        const r = c.getBoundingClientRect();
        return e.clientY < r.top + r.height / 2;
      });
      if (after) { if (after !== row.nextSibling) host.insertBefore(row, after); }
      else if (host.lastChild !== row) host.append(row);
    };
    const end = async (commit) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      this._endDrag = null;
      row.classList.remove("is-dragging");
      this._dragging = false;
      if (commit && moved) {
        const ids = [...host.querySelectorAll(".trk-row")].map((r) => r.dataset.id);
        const wrote = await TrackerStore.reorder(ids);
        if (!wrote) this.update({ animate: false });
      } else {
        this.update({ animate: false });     // put a cancelled drag back
      }
    };
    const up = () => end(true);
    const cancel = () => end(false);
    this._endDrag = () => end(false);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
  }

  /* ------------------------------ the dock ------------------------------ */

  async _onToggleCompact() {
    this._closeMenu?.();
    try { await game.settings.set(MODULE_ID, SETTINGS.trackerHudCompact, !this.compact); } catch { /* client setting */ }
    await this.render();
  }

  _wireDrag() {
    const head = this.element.querySelector("[data-drag]");
    if (!head) return;
    head.addEventListener("pointerdown", (ev) => this._onDragDock(ev));
    head.addEventListener("dblclick", (ev) => {
      if (ev.target.closest("button")) return;
      ev.preventDefault();
      this._onToggleCompact();
    });
  }

  _onDragDock(ev) {
    if (ev.button !== 0 || ev.target.closest("button")) return;
    ev.preventDefault();
    const el = this.element;
    const rect = el.getBoundingClientRect();
    const ox = ev.clientX - rect.left, oy = ev.clientY - rect.top;
    const sx = ev.clientX, sy = ev.clientY;
    let moved = false;
    const move = (e) => {
      if (!moved && Math.hypot(e.clientX - sx, e.clientY - sy) < 4) return;
      if (!moved) { moved = true; el.classList.add("is-moving"); }
      el.style.right = "auto";
      el.style.left = `${Math.round(e.clientX - ox)}px`;
      el.style.top = `${Math.round(e.clientY - oy)}px`;
      this._clamp();
    };
    const up = async () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      el.classList.remove("is-moving");
      if (!moved) return;
      const r = el.getBoundingClientRect();
      try { await game.settings.set(MODULE_ID, SETTINGS.trackerHudPosition, { left: Math.round(r.left), top: Math.round(r.top) }); } catch { /* ignore */ }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }

  _applyPosition() {
    const el = this.element;
    el.style.position = "fixed";
    const pos = getSetting(SETTINGS.trackerHudPosition, {}) ?? {};
    if (Number.isFinite(pos.left) && Number.isFinite(pos.top)) {
      el.style.left = `${pos.left}px`; el.style.top = `${pos.top}px`; el.style.right = "auto";
      this._clamp();
    } else {
      el.style.right = ""; el.style.left = ""; el.style.top = "";
    }
  }

  /** Keep a left-anchored dock wholly on screen. The default anchor (CSS,
   *  right-hand side) is fluid and needs nothing. */
  _clamp() {
    const el = this.element;
    if (!el || el.style.right !== "auto") return;
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) return;
    const m = 6;
    el.style.left = `${Math.round(Math.min(Math.max(r.left, m), Math.max(m, window.innerWidth - m - r.width)))}px`;
    el.style.top = `${Math.round(Math.min(Math.max(r.top, m), Math.max(m, window.innerHeight - m - Math.min(r.height, 48))))}px`;
  }

  _wireViewport() {
    this._onResize ??= () => {
      if (this._resizeRAF) return;
      this._resizeRAF = requestAnimationFrame(() => { this._resizeRAF = null; if (this.rendered) this._applyPosition(); });
    };
    window.removeEventListener("resize", this._onResize);
    window.addEventListener("resize", this._onResize);
  }

  /* ------------------------------ CRUD ------------------------------ */

  async _onAddTracker() {
    if (!this.isGM) return;
    const { TrackerEditor } = await import("./tracker-editor.js");
    TrackerEditor.create(TrackerStore);
  }

  async _edit(id) {
    const { TrackerEditor } = await import("./tracker-editor.js");
    TrackerEditor.edit(TrackerStore, id);
  }

  async _delete(id) {
    if (await confirmDelete(TrackerStore.get(id))) await TrackerStore.delete(id);
  }
}

/** The value entries of a tracker's menu, shared with the sheet tab. */
export function valueItems(t, store) {
  const items = [];
  if (t.type === "pool") {
    items.push({ icon: TYPE_ICON.pool, label: L("GLCT.tracker.roll"), run: () => store.rollPool(t.id) });
    items.push({ icon: "fa-solid fa-rotate-left", label: L("GLCT.tracker.ctx.refill"), run: () => store.resetPool(t.id) });
  } else if (t.type !== "separator") {
    const hasMax = t.type !== "point" || (t.max !== null && t.max !== undefined);
    items.push({ icon: "fa-solid fa-backward-fast", label: L("GLCT.tracker.ctx.clear"), run: () => store.setTo(t.id, "min") });
    if (hasMax) items.push({ icon: "fa-solid fa-forward-fast", label: L("GLCT.tracker.ctx.fill"), run: () => store.setTo(t.id, "max") });
  }
  return items;
}

/** Ask before deleting a tracker. */
export async function confirmDelete(t) {
  if (!t) return false;
  const label = t.name || t.title || t.label || L(`GLCT.tracker.types.${t.type}`);
  return DialogV2.confirm({
    window: { title: L("GLCT.tracker.delete"), icon: "fa-solid fa-trash" },
    classes: ["glct-trk-skin", "glct-trk-dialog"],
    content: `<p class="trk-confirm">${foundry.utils.escapeHTML(L("GLCT.tracker.confirmDelete", { name: label }))}</p>`,
    rejectClose: false,
  });
}
