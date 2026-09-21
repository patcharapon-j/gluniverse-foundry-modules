/**
 * Hexcrawl — GM painting input.
 *
 * While the palette is open and its brush tool is anything but "select", a
 * transparent capture container sits over the scene in canvas.interface (above
 * the token layer's hit-testing, so a stroke never selects or drags a token)
 * and turns left-button strokes into brush patches.
 *
 * One stroke is ONE write: hexes are collected (deduped) as the pointer moves,
 * previewed locally through store.previewPatch() at most once per frame, and
 * written as a single undoable store.applyPatch() on pointerup. Never one scene
 * update per pointermove — that is a database write per mouse event, broadcast
 * to every client.
 *
 * Right-click on a hex (a click, not a pan-drag) opens the hex editor whenever
 * the palette is open, whatever the tool; right-button events are never
 * swallowed, so panning still works mid-paint.
 */

import { warn } from "../../core/const.mjs";
import { line, range } from "./hex-math.mjs";
import { HexStore } from "./store.mjs";

/** Pixels a right-button press may travel and still count as a click. */
const CLICK_SLOP = 5;
/** Capture container z-index inside canvas.interface (above tokens' hit area). */
const CAPTURE_Z = 10000;

let apps = null;
const loadApps = async () => (apps ??= await import("./apps/index.mjs"));

/**
 * Is the palette open? The palette reports it through store.setPaletteOpen();
 * as a fallback, look for a rendered ApplicationV2 of the feature whose class
 * name says it is the palette (the apps half's own markup carries glhex-).
 */
export function isPaletteOpen(store = HexStore.current) {
  if (store?.paletteOpen) return true;
  try {
    for (const app of foundry.applications.instances?.values?.() ?? []) {
      if (!app?.rendered) continue;
      const name = app.constructor?.name ?? "";
      const cls = app.element?.className ?? "";
      if (/palette/i.test(name) && /glhex/.test(`${cls} ${app.id ?? ""}`)) return true;
    }
  } catch { /* instances registry absent */ }
  return false;
}

const brushKeys = (store, key) => {
  const size = Math.max(0, Math.min(6, Number(store.brush?.size) || 0));
  return size ? range(store.adapter, key, size) : [key];
};

class Input {
  constructor() {
    this.capture = null;
    this.stroke = null;          // { keys:Set, last:key, staged:boolean }
    this._raf = null;
    this._onStore = null;
    this._rightDown = null;
    this._stageRight = null;
    this._stageRightDown = null;
    this._store = null;
  }

  attach(store) {
    this.detach();
    if (!game.user.isGM || !store) return;
    this._store = store;
    this._onStore = (_s, d) => { if (["brush", "palette", "all"].includes(d.kind)) this.sync(); };
    store.on("change", this._onStore);

    // Right-click → hex editor. On the stage, so it works with or without the capture.
    this._stageRightDown = (ev) => {
      if (ev.button !== 2) return;
      this._rightDown = { x: ev.global.x, y: ev.global.y, target: ev.target };
    };
    this._stageRight = (ev) => {
      const down = this._rightDown; this._rightDown = null;
      if (!down || ev.button !== 2) return;
      if (Math.hypot(ev.global.x - down.x, ev.global.y - down.y) > CLICK_SLOP) return;   // a pan
      const t = down.target;
      if (t !== canvas.stage && t !== this.capture) return;     // a token's own context menu
      const s = HexStore.current;
      if (!s || !isPaletteOpen(s)) return;
      const p = canvas.stage.toLocal(ev.global);
      const key = s.adapter.keyAt(p);
      if (!s.adapter.inBounds(key)) return;
      loadApps().then((a) => a.openHexEditor?.(key)).catch((e) => warn("hexcrawl | hex editor failed", e));
    };
    canvas.stage.on("pointerdown", this._stageRightDown);
    canvas.stage.on("pointerup", this._stageRight);
    this.sync();
  }

  /** Mount or unmount the capture to match the palette + tool. */
  sync() {
    const s = this._store;
    const want = !!s && s === HexStore.current && isPaletteOpen(s) && (s.brush?.tool ?? "select") !== "select";
    if (want && !this.capture) this._mount();
    else if (!want && this.capture) this._unmount();
  }

  _mount() {
    const layer = canvas?.interface;
    if (!layer) return;
    const c = new PIXI.Container();
    const r = canvas.dimensions.sceneRect;
    c.hitArea = new PIXI.Rectangle(r.x, r.y, r.width, r.height);
    c.eventMode = "static";
    c.cursor = "crosshair";
    c.zIndex = CAPTURE_Z;
    c.on("pointerdown", (ev) => this._down(ev));
    c.on("pointermove", (ev) => this._move(ev));
    c.on("pointerup", (ev) => this._up(ev));
    c.on("pointerupoutside", (ev) => this._up(ev));
    layer.addChild(c);
    if (layer.sortableChildren === false) layer.sortChildren?.();
    this.capture = c;
  }

  _unmount() {
    this._cancelStroke();
    try { this.capture?.destroy(); } catch { /* torn down */ }
    this.capture = null;
  }

  _keyAt(ev) {
    const s = this._store;
    const p = canvas.stage.toLocal(ev.global);
    const k = s.adapter.keyAt(p);
    return s.adapter.inBounds(k) ? k : null;
  }

  _down(ev) {
    if (ev.button !== 0) return;              // right/middle fall through (pan, editor)
    ev.stopPropagation();
    const s = this._store;
    const staged = !!s.brush.stage && s.brush.tool === "state" && s.brush.value === "revealed";
    this.stroke = { keys: new Set(), last: null, staged };
    this._addAt(ev);
  }

  _move(ev) {
    if (!this.stroke) return;
    ev.stopPropagation();
    this._addAt(ev);
  }

  _addAt(ev) {
    const s = this._store, st = this.stroke;
    const k = this._keyAt(ev);
    if (!k || k === st.last) return;
    // A fast drag skips hexes between two events; walk the line so the stroke is unbroken.
    const path = st.last ? line(s.adapter, st.last, k) : [k];
    st.last = k;
    const added = [];
    for (const p of path) for (const b of brushKeys(s, p)) {
      if (!s.adapter.inBounds(b) || st.keys.has(b)) continue;
      st.keys.add(b); added.push(b);
    }
    if (!added.length) return;
    if (st.staged) { s.stage(added); return; }
    this._schedulePreview();
  }

  _schedulePreview() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => {
      this._raf = null;
      const s = this._store, st = this.stroke;
      if (!s || !st || st.staged) return;
      s.previewPatch(s.brushPatchFor([...st.keys]));
    });
  }

  async _up(ev) {
    const st = this.stroke;
    if (!st) return;
    if (ev?.button !== undefined && ev.button !== 0 && ev.type !== "pointerupoutside") return;
    ev?.stopPropagation?.();
    this.stroke = null;
    if (this._raf) { cancelAnimationFrame(this._raf); this._raf = null; }
    if (st.staged || !st.keys.size) return;
    const s = this._store;
    const patch = s.brushPatchFor([...st.keys]);
    try {
      await s.applyPatch(patch, { label: s.brush.tool });
    } catch (e) {
      warn("hexcrawl | paint stroke failed", e);
      s.previewPatch(null);
    }
  }

  _cancelStroke() {
    if (this._raf) { cancelAnimationFrame(this._raf); this._raf = null; }
    if (this.stroke && !this.stroke.staged) this._store?.previewPatch(null);
    this.stroke = null;
  }

  detach() {
    this._unmount();
    if (this._store && this._onStore) this._store.off("change", this._onStore);
    this._onStore = null;
    try {
      if (this._stageRightDown) canvas?.stage?.off("pointerdown", this._stageRightDown);
      if (this._stageRight) canvas?.stage?.off("pointerup", this._stageRight);
    } catch { /* stage gone */ }
    this._stageRightDown = this._stageRight = null;
    this._store = null;
  }
}

export const input = new Input();
