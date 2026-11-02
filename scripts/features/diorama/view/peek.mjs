/**
 * Diorama view — the "2D map" window: a framed hole in the 3D overlay through
 * which the LIVE Foundry canvas shows and takes input.
 *
 * Nothing here draws the 2D map. The overlay root gets an evenodd clip-path
 * with a rectangle cut out of it, so the real #board under the overlay shows
 * through, and because a clipped-out region is not hit-tested, every pointer
 * and wheel event inside it lands on Foundry's canvas exactly as it does in 2D
 * (Foundry's wheel handler asks `elementFromPoint`, which honours the clip
 * too). The 3D view's own input is bound to its canvas, which never sees them.
 *
 * The frame (a glass header and a hairline rim) is drawn by the overlay around
 * the hole: dragged by the header, resized from the top-left corner (the window
 * docks bottom-right, so that corner is the free one), and remembered per
 * client in localStorage. Pure geometry is exported for the check tools; the
 * Peek class is DOM only and never touches `canvas`: the overlay pans.
 */

import { SUITE_ID } from "../../../core/const.mjs";
import { el, t } from "./util.mjs";

/** Layout constants, CSS px. `head` and `rim` are handed to the stylesheet as custom properties. */
export const PEEK = Object.freeze({ widthFrac: 0.32, aspect: 16 / 10, minW: 240, minH: 140, margin: 12, head: 32, rim: 2 });

const STORE_KEY = `${SUITE_ID}.dio.peek`;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * Keep a hole rect on screen with room for its frame.
 * @param {{x:number, y:number, w:number, h:number}} r  the hole, client px
 * @param {number} vw @param {number} vh  viewport
 */
export function clampRect(r, vw, vh) {
  const { margin: m, head, rim, minW, minH } = PEEK;
  const w = Math.round(clamp(r.w, minW, Math.max(minW, vw - 2 * m - 2 * rim)));
  const h = Math.round(clamp(r.h, minH, Math.max(minH, vh - 2 * m - head - rim)));
  const x = Math.round(clamp(r.x, m + rim, Math.max(m + rim, vw - m - rim - w)));
  const y = Math.round(clamp(r.y, m + head, Math.max(m + head, vh - m - rim - h)));
  return { x, y, w, h };
}

/**
 * The first-time window: ~32% of the viewport wide, 16:10, docked bottom-right
 * inside `avoid` (the sidebar's left edge, the hotbar's top), so it opens beside
 * Foundry's UI rather than under it.
 * @param {number} vw @param {number} vh
 * @param {{right?:number, bottom?:number}} [avoid]  client px
 */
export function defaultRect(vw, vh, avoid = {}) {
  const right = Number.isFinite(avoid.right) ? Math.min(vw, avoid.right) : vw;
  const bottom = Number.isFinite(avoid.bottom) ? Math.min(vh, avoid.bottom) : vh;
  const w = Math.round(vw * PEEK.widthFrac);
  const h = Math.round(w / PEEK.aspect);
  return clampRect({ x: right - PEEK.margin - PEEK.rim - w, y: bottom - PEEK.margin - PEEK.rim - h, w, h }, vw, vh);
}

/** Stored as gaps to the right and bottom edges, so the window stays docked when the window resizes. */
export function toStored(r, vw, vh) {
  return { r: vw - (r.x + r.w), b: vh - (r.y + r.h), w: r.w, h: r.h };
}

/** A stored window back on this viewport, or null if what was stored is not one. */
export function fromStored(s, vw, vh) {
  if (!s || typeof s !== "object") return null;
  const n = [s.r, s.b, s.w, s.h].map(Number);
  if (!n.every(Number.isFinite) || n[2] <= 0 || n[3] <= 0) return null;
  const [r, b, w, h] = n;
  return clampRect({ x: vw - r - w, y: vh - b - h, w, h }, vw, vh);
}

/** The overlay's clip: the whole root, minus the hole (evenodd), in root = client px. */
export function holeClip(r) {
  const x1 = r.x, y1 = r.y, x2 = r.x + r.w, y2 = r.y + r.h;
  return `polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${x1}px ${y1}px, ${x2}px ${y1}px, ${x2}px ${y2}px, ${x1}px ${y2}px, ${x1}px ${y1}px)`;
}

/** Is a client point inside the hole? */
export function inRect(r, x, y) {
  return !!r && x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
}

/**
 * The 2D pivot that puts scene point `pt` at client point `at`, given the
 * stage's screen position (Foundry keeps it at the viewport centre) and scale.
 */
export function pivotToShow(pt, at, stagePos, scale) {
  return { x: pt.x - (at.x - stagePos.x) / scale, y: pt.y - (at.y - stagePos.y) / scale };
}

/** The scene point under client point `at` for a 2D view (inverse of pivotToShow). */
export function sceneAt(at, stagePos, pivot, scale) {
  return { x: pivot.x + (at.x - stagePos.x) / scale, y: pivot.y + (at.y - stagePos.y) / scale };
}

function readStored() {
  try { return JSON.parse(globalThis.localStorage?.getItem(STORE_KEY) ?? "null"); } catch { return null; }
}

function writeStored(v) {
  try { globalThis.localStorage?.setItem(STORE_KEY, JSON.stringify(v)); } catch { /* private mode, quota: the next open uses the default */ }
}

export class Peek {
  /**
   * @param {HTMLElement} root  the overlay root (fixed, inset 0): it carries the clip
   * @param {{onCentre:() => void, onSwitch:() => void, onClose:() => void, avoid?:() => object}} o
   */
  constructor(root, { onCentre, onSwitch, onClose, avoid }) {
    this.root = root;
    this.cb = { onCentre, onSwitch, onClose };
    this.avoid = avoid ?? (() => ({}));
    this.rect = null;
    this.open = false;
    this.hovered = false;
    this.frame = null;
    this._gesture = null;
    this._track = (ev) => { this.hovered = inRect(this.rect, ev.clientX, ev.clientY); };
  }

  /** Build the frame on first use. */
  _build() {
    if (this.frame) return;
    const button = (cls, icon, key, run) => {
      const label = t(key);
      const b = el("button", { type: "button", class: `gldio-peek-btn gl-btn ${cls}`, title: label, "aria-label": label },
        [el("i", { class: icon, "aria-hidden": "true" })]);
      b.addEventListener("click", (ev) => { ev.stopPropagation(); run?.(); });
      return b;
    };
    const head = el("header", { class: "gldio-peek-head gl-glass" }, [
      el("i", { class: "gldio-peek-icon fa-solid fa-map", "aria-hidden": "true" }),
      el("span", { class: "gldio-peek-title", text: t("GLDIO.peek.title") }),
      button("gldio-peek-centre", "fa-solid fa-location-crosshairs", "GLDIO.peek.centre", () => this.cb.onCentre?.()),
      button("gldio-peek-switch gl-btn-accent", "fa-solid fa-expand", "GLDIO.peek.switch", () => this.cb.onSwitch?.()),
      button("gldio-peek-close", "fa-solid fa-xmark", "GLDIO.peek.close", () => this.cb.onClose?.()),
    ]);
    const grip = el("div", { class: "gldio-peek-grip", title: t("GLDIO.peek.resize"), "aria-hidden": "true" });
    const rim = el("div", { class: "gldio-peek-rim", "aria-hidden": "true" });
    const frame = el("section", { class: "gldio-peek", "aria-label": t("GLDIO.peek.title") }, [rim, head, grip]);
    frame.style.setProperty("--gldio-peek-head", `${PEEK.head}px`);
    frame.style.setProperty("--gldio-peek-rim", `${PEEK.rim}px`);
    head.addEventListener("pointerdown", (ev) => { if (!ev.target.closest("button")) this._start(ev, "move", head); });
    grip.addEventListener("pointerdown", (ev) => this._start(ev, "size", grip));
    // the rim and header swallow clicks, so nothing reaches the 3D board under them
    for (const n of [rim, head, grip]) n.addEventListener("contextmenu", (ev) => ev.preventDefault());
    this.frame = frame;
  }

  /** Open the window where this client left it (or docked bottom-right the first time). */
  show() {
    if (this.open) return;
    this._build();
    const vw = this._vw(), vh = this._vh();
    this.rect = fromStored(readStored(), vw, vh) ?? defaultRect(vw, vh, this.avoid());
    this.root.append(this.frame);
    this.open = true;
    window.addEventListener("pointermove", this._track, { capture: true, passive: true });
    this._apply();
  }

  hide() {
    if (!this.open) return;
    this._end();
    this.open = false;
    this.hovered = false;
    window.removeEventListener("pointermove", this._track, { capture: true });
    this.frame?.remove();
    this.root.style.removeProperty("clip-path");
  }

  /** The window was resized: keep the hole on screen. */
  layout() {
    if (!this.open || !this.rect) return;
    this.rect = clampRect(this.rect, this._vw(), this._vh());
    this._apply();
  }

  /** The hole's centre, client px. */
  centre() {
    const r = this.rect;
    return r ? { x: r.x + r.w / 2, y: r.y + r.h / 2 } : null;
  }

  dispose() {
    this.hide();
    this.frame = null;
  }

  _vw() { return this.root.clientWidth || globalThis.innerWidth || 1280; }
  _vh() { return this.root.clientHeight || globalThis.innerHeight || 800; }

  _apply() {
    const r = this.rect;
    if (!r || !this.frame) return;
    const { head, rim } = PEEK;
    Object.assign(this.frame.style, {
      left: `${r.x - rim}px`, top: `${r.y - head}px`, width: `${r.w + 2 * rim}px`, height: `${r.h + head + rim}px`,
    });
    this.root.style.clipPath = holeClip(r);
  }

  /* ── drag (header) and resize (top-left grip) ── */

  _start(ev, kind, node) {
    if (ev.button !== 0) return;
    ev.preventDefault();
    ev.stopPropagation();
    this._end();
    try { node.setPointerCapture(ev.pointerId); } catch { /* fine */ }
    const g = { kind, node, id: ev.pointerId, x0: ev.clientX, y0: ev.clientY, r0: { ...this.rect } };
    g.move = (e) => this._drag(e);
    g.up = () => this._end(true);
    node.addEventListener("pointermove", g.move);
    node.addEventListener("pointerup", g.up);
    node.addEventListener("pointercancel", g.up);
    this._gesture = g;
    this.frame.dataset.gesture = kind;
  }

  _drag(ev) {
    const g = this._gesture;
    if (!g || ev.pointerId !== g.id) return;
    const dx = ev.clientX - g.x0, dy = ev.clientY - g.y0;
    const r0 = g.r0;
    let next;
    if (g.kind === "move") next = { ...r0, x: r0.x + dx, y: r0.y + dy };
    else {
      // the bottom-right corner stays put; the top-left follows the pointer
      const w = Math.max(PEEK.minW, r0.w - dx), h = Math.max(PEEK.minH, r0.h - dy);
      next = { x: r0.x + r0.w - w, y: r0.y + r0.h - h, w, h };
    }
    this.rect = clampRect(next, this._vw(), this._vh());
    this._apply();
  }

  _end(save = false) {
    const g = this._gesture;
    if (!g) return;
    this._gesture = null;
    g.node.removeEventListener("pointermove", g.move);
    g.node.removeEventListener("pointerup", g.up);
    g.node.removeEventListener("pointercancel", g.up);
    try { g.node.releasePointerCapture(g.id); } catch { /* gone */ }
    if (this.frame) delete this.frame.dataset.gesture;
    if (save && this.rect) writeStored(toStored(this.rect, this._vw(), this._vh()));
  }
}
