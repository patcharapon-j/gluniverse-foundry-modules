/**
 * Diorama view — the tokens' resource bars, over the 3D board.
 *
 * Nothing here draws a bar of its own. The bars are the ones the 2D canvas
 * draws, placed on the standees:
 *
 *   • Resource Bars on: that feature draws them, through a second, *projected*
 *     host (resource-bars/host.mjs `projectedHost`): its readings, permissions,
 *     liquids, readouts, names and animations, decided on the same refreshToken
 *     pass as on the 2D canvas. Each token's frame is its standee's box on
 *     screen, so the stack hangs under the base exactly as it hangs under the
 *     token in 2D.
 *   • Resource Bars off: Foundry's own bar graphics (`token.bars.bar1/bar2`,
 *     drawn by `Token#_drawBar`), rendered where the standee stands: bar 1
 *     under the base, bar 2 over the head, the 2D token's bottom and top.
 *
 * Who sees a bar is Foundry's answer either way (`token.bars.visible`, read by
 * Resource Bars too). It reads the token's hover, so the view hands its own
 * hover to the 2D token (`bridgeHover`): Hover and Owner-Hover bars, the
 * readout's hover gate, Alt's highlight and the combat tracker's hover all
 * behave as on the 2D board.
 *
 * Those bars are PIXI display objects, so they are rendered by a PIXI renderer
 * on a transparent canvas laid over the 3D canvas. It is this file's, not the
 * diorama renderer's: the 3D view keeps its one three.js context, and this one
 * exists only while the view is open, drawing only when a bar or the camera
 * moves. A standee that is not drawn (unseen, cut away) has no frame and so no
 * bar.
 */

import { err } from "../../../core/const.mjs";
import { Suite } from "../../../core/registry.mjs";
import { el } from "./util.mjs";

const RESOURCE_BARS = "resource-bars";
/** Screen gap between a base (or a head) and its bar, as a fraction of a cell. */
const GAP = 0.06;

/* ═══════════════════════════ hover ═══════════════════════════ */

let _hovered = null;
/** A pointer event with no button down: all `_onHoverIn` reads of it. */
const NO_BUTTONS = Object.freeze({ buttons: 0 });

/**
 * Make the 3D view's hover the 2D token's: Foundry's own hover path, so its
 * display modes, the bars' and the readout's gates, and the tracker agree.
 * @param {Token|null} token
 */
export function bridgeHover(token) {
  const next = token && !token.destroyed ? token : null;
  if (next === _hovered) return;
  const prev = _hovered;
  _hovered = next;
  try { if (prev && !prev.destroyed && prev.hover) prev._onHoverOut(NO_BUTTONS); } catch (e) { err("diorama: hover out", e); }
  try { if (next && !next.hover) next._onHoverIn(NO_BUTTONS, { hoverOutOthers: true }); } catch (e) { err("diorama: hover in", e); }
}

/* ═══════════════════════════ the layer ═══════════════════════════ */

/**
 * Where a frame stands, in the layer's own px. Pure.
 * @param {{cx:number, footY:number, headY:number, w:number}} box  client px
 * @param {{left:number, top:number}} origin  the layer's client offset
 */
export function frameOf(box, origin) {
  if (!box) return null;
  return { x: box.cx - box.w / 2 - origin.left, y: box.footY - origin.top, w: box.w, h: 0 };
}

export class BarLayer {
  /**
   * @param {HTMLElement} root
   * @param {{r: () => object|null, after: () => HTMLElement|null, onBoard: (id:string) => boolean, shows?: (token:Token) => boolean}} o
   *   `shows`: a narrower gate of the view's own (the GM's "view as players")
   */
  constructor(root, { r, after, onBoard, shows = () => true }) {
    this.root = root;
    this.r = r;
    this.after = after;
    this.onBoard = onBoard;
    this.shows = shows;
    this.canvas = null;
    this.renderer = null;
    this.stage = null;
    this.projected = null;
    this.pxPerCell = 100;
    this._raf = 0;
    this._paused = false;
  }

  get mode() {
    return this.projected ? "resource-bars" : "foundry";
  }

  /** Build the canvas and the renderer, and pick who draws. Safe to call again. */
  mount() {
    if (this.renderer || !globalThis.PIXI?.Renderer) return;
    const c = el("canvas", { class: "gldio-bars", "aria-hidden": "true" });
    const ref = this.after?.();
    if (ref?.isConnected && ref.parentNode === this.root) ref.after(c);
    else this.root.prepend(c);
    this.canvas = c;
    const { w, h } = this.size();
    try {
      this.renderer = new PIXI.Renderer({
        view: c, width: w, height: h, resolution: globalThis.devicePixelRatio || 1, autoDensity: true,
        backgroundAlpha: 0, antialias: false, powerPreference: "low-power",
      });
    } catch (e) {
      err("diorama: the bar layer could not start", e);
      c.remove();
      this.canvas = null;
      return;
    }
    this.stage = new PIXI.Container();
    this.stage.eventMode = "none";
    this.projected = this.resourceBars();
    // a decision pass for every token, so both hosts decide what each one shows
    globalThis.canvas?.tokens?.setAllRenderFlags?.({ refreshState: true });
    this.changed();
  }

  /** The Resource Bars feature's projected host, or null when that feature is not drawing. */
  resourceBars() {
    try {
      if (!Suite.enabled(RESOURCE_BARS)) return null;
      const api = Suite.get(RESOURCE_BARS)?.api;
      return api?.project?.({
        layer: () => this.stage,
        tokens: () => globalThis.canvas?.tokens?.placeables ?? [],
        grid: () => this.pxPerCell,
        frame: (token) => this.frame(token),
        zoom: () => 1,
        renderer: () => this.renderer,
        ticker: () => globalThis.canvas?.app?.ticker ?? null,
        changed: () => this.changed(),
      }) ?? null;
    } catch (e) {
      err("diorama: Resource Bars could not draw in 3D", e);
      return null;
    }
  }

  size() {
    return { w: Math.max(1, this.root.clientWidth || globalThis.innerWidth || 1), h: Math.max(1, this.root.clientHeight || globalThis.innerHeight || 1) };
  }

  /** A token's box in this layer's px, or null when its standee is not drawn. */
  frame(token) {
    const id = token?.id;
    if (!id || !this.onBoard(id) || !this.shows(token)) return null;
    const box = this.r()?.standeeBox?.(id);
    if (!box) return null;
    if (box.pxPerCell > 0) this.pxPerCell = box.pxPerCell;
    return frameOf(box, this.root.getBoundingClientRect());
  }

  /** The 3D frame was drawn: every standee may stand somewhere else. */
  follow() {
    if (!this.renderer) return;
    this.projected?.relayout();
    this.changed();
  }

  /** Something on the layer moved: draw once, on the next animation frame. */
  changed() {
    if (!this.renderer || this._raf || this._paused) return;
    this._raf = requestAnimationFrame(() => { this._raf = 0; this.draw(); });
  }

  draw() {
    const rd = this.renderer;
    if (!rd || this._paused) return;
    try {
      if (this.projected) { rd.render(this.stage); return; }
      this.drawFoundry(rd);
    } catch (e) {
      err("diorama: drawing the bars failed", e);
    }
  }

  /**
   * Foundry's own bars, each rendered where its standee stands. The graphics
   * are Foundry's (their geometry, colours and sizes); only the transform is
   * ours, handed to the render and gone after it, so the 2D token is untouched.
   */
  drawFoundry(rd) {
    rd.render(this.stage, { clear: true });
    const origin = this.root.getBoundingClientRect();
    const M = (this._m ??= new PIXI.Matrix());
    for (const token of globalThis.canvas?.tokens?.placeables ?? []) {
      const bars = token?.bars;
      if (!bars?.visible || token.document?.isSecret || !this.onBoard(token.id) || !this.shows(token)) continue;
      const box = this.r()?.standeeBox?.(token.id);
      if (!box || !(token.w > 0)) continue;
      const s = box.w / token.w;
      const x = box.cx - box.w / 2 - origin.left;
      const gap = GAP * box.pxPerCell;
      for (const [key, top] of [["bar1", false], ["bar2", true]]) {
        const bar = bars[key];
        if (!bar?.visible || bar.destroyed) continue;
        const bh = (bar.height || 0) * s;
        const y = top ? box.headY - origin.top - gap - bh : box.footY - origin.top + gap;
        // place the bar's own top-left (it sits at bar.position inside the token) at (x, y)
        M.set(s, 0, 0, s, x - bar.position.x * s, y - bar.position.y * s);
        rd.render(bar, { clear: false, transform: M });
      }
    }
  }

  resize() {
    if (!this.renderer) return;
    const { w, h } = this.size();
    this.renderer.resize(w, h);
    this.follow();
  }

  pause() {
    this._paused = true;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = 0;
  }

  resume() {
    this._paused = false;
    this.follow();
  }

  dispose() {
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = 0;
    bridgeHover(null);
    try { this.projected?.dispose(); } catch (e) { err("diorama: bar layer", e); }
    this.projected = null;
    try { this.stage?.destroy({ children: false }); } catch { /* gone */ }
    try { this.renderer?.destroy(false); } catch { /* gone */ }
    this.canvas?.remove();
    this.stage = null;
    this.renderer = null;
    this.canvas = null;
  }
}
