/**
 * Theatre — the camera lock.
 *
 * A locked viewer sees the frame (the scene rect) cover the whole viewport:
 * centred, scaled so no edge of the canvas shows, no pan, no zoom.
 *
 * Every road that moves Foundry's view ends in `Canvas#pan` — the wheel zoom
 * (`_onMouseWheel` → pan), right-drag (`_onDragRightMove` → pan), keyboard and
 * edge panning (`animatePan` → `CanvasAnimation` ticking pan), a pulled ping,
 * a window resize (`_onResize` → pan), another module's camera. That is true on
 * v13 and v14 alike, so the lock is ONE instance-level wrapper on `canvas.pan`
 * that substitutes the fitted view while locked, plus one on `animatePan` that
 * skips the animation (a locked view has nowhere to animate to). Wrapping the
 * instance rather than patching the prototype keeps it to this canvas, and the
 * wrapper stays installed but transparent when unlocked, so a later wrapper by
 * another module is never cut out of the chain by an unwrap.
 *
 * A `canvasPan` listener re-fits too, for anything that moved the stage pivot
 * without going through pan.
 *
 * Fill or fit is the viewer's own choice (a client setting), so two players on
 * different displays can frame the same scene differently.
 *
 * The frame is laid out in the part of the screen the viewer can actually see:
 * an expanded chat sidebar covers the right of the canvas, so the frame is
 * fitted to the screen left of it (frameView), and follows the sidebar as it
 * slides open or shut (`followSidebar`). Those fits can go below Foundry's
 * minimum zoom, so the locked pan bypasses its clamp (`_panExact`).
 */

import { PADDING_MAX } from "./constants.mjs";

/** How long the follow loop may run after a sidebar toggle (Foundry slides it over 250ms). */
const SIDEBAR_FOLLOW_MS = 600;

/**
 * The locked view of the scene rect on a screen.
 *   fill — the rect covers the visible screen (cropped where the aspects differ),
 *          except that a sidebar never crops more of its sides than the whole
 *          screen would: there it shrinks and the backdrop shows above and below
 *   fit  — the whole rect is shown inside the screen less `padding` per cent of
 *          its shorter side on every edge; the backdrop fills what is left
 * `right` is the width covered by the UI on the right (the expanded sidebar).
 * Fill centres the frame in the `screenW - right` strip left of it. Fit keeps
 * the left margin it has with the sidebar shut and shrinks the frame until its
 * right edge clears the sidebar by the padding, so opening the sidebar never
 * pushes the frame against (or off) the left edge.
 * `screenX` is where the frame's centre lands on screen (the titles centre on it).
 */
export function frameView(sceneRect, screenW, screenH, { mode = "fill", padding = 0 } = {}, { right = 0 } = {}) {
  const r = sceneRect;
  if (!r || !(r.width > 0 && r.height > 0) || !(screenW > 0 && screenH > 0)) return null;
  const inset = Math.max(0, Math.min(Number(right) || 0, screenW / 2));
  const w = screenW - inset;
  let scale, left;
  if (mode === "fit") {
    // The padding is of the whole screen, so it does not change as the sidebar opens.
    const pad = (Math.max(0, Math.min(PADDING_MAX, Number(padding) || 0)) / 100) * Math.min(screenW, screenH);
    const shut = Math.min(Math.max(1, screenW - 2 * pad) / r.width, Math.max(1, screenH - 2 * pad) / r.height);
    left = (screenW - r.width * shut) / 2;
    scale = Math.min(shut, Math.max(1, w - pad - left) / r.width);
  } else {
    scale = Math.max(w / r.width, screenH / r.height);
    // The sidebar never crops more of the frame's sides than the whole screen
    // would: past that the frame shrinks to fit beside it and the backdrop
    // fills above and below, rather than its left edge falling off the screen.
    const overflow = Math.max(0, r.width * Math.max(screenW / r.width, screenH / r.height) - screenW);
    scale = Math.min(scale, (w + overflow) / r.width);
    left = (w - r.width * scale) / 2;
  }
  // The pivot sits at the screen's centre: offset it by how far left of the
  // centre the frame's own centre lands.
  const screenX = left + (r.width * scale) / 2;
  return { x: r.x + r.width / 2 + (screenW / 2 - screenX) / scale, y: r.y + r.height / 2, scale, screenX };
}

/**
 * The width (CSS px) the expanded sidebar covers at the right of the screen, 0
 * when it is collapsed or the interface is hidden. v13+/v14: `#sidebar-content`
 * slides off the right edge when collapsed, so its left edge is the boundary,
 * mid-slide included. The tab strip beside it is not counted: it is there
 * either way.
 */
export function sidebarInset() {
  const el = globalThis.document?.getElementById?.("sidebar-content");
  if (!el) return 0;
  const r = el.getBoundingClientRect();
  if (!(r.width > 0 && r.height > 0)) return 0;   // the interface is hidden
  const sw = globalThis.innerWidth || 0;
  return Math.max(0, Math.min(sw - r.left, sw / 2));
}

const WRAP = Symbol.for("gluniverse.theatre.cameraWrap");

class Camera {
  constructor() {
    this.locked = false;
    /** The scene the lock belongs to; any other scene's view is never touched. */
    this.sceneId = null;
    this._hook = null;
    this._fitting = false;
    this._exact = false;
    this._follow = 0;
    this.framing = { mode: "fill", padding: 0 };
  }

  /**
   * The sidebar was toggled: re-fit every frame while it slides, so the frame
   * moves with it rather than jumping when it lands. `onFrame(inset)` lets the
   * caller move the DOM half (the titles) in step; `inset` is `titleInset()`. Ends once the slide has
   * settled, or after SIDEBAR_FOLLOW_MS.
   */
  followSidebar(onFrame = null) {
    cancelAnimationFrame(this._follow);
    const start = performance.now();
    let last = null, still = 0;
    const step = () => {
      this._follow = 0;
      const inset = sidebarInset();
      this.fit();
      try { onFrame?.(this.titleInset()); } catch { /* the caller's own */ }
      still = last !== null && Math.abs(inset - last) < 0.5 ? still + 1 : 0;
      last = inset;
      // Past half the window and still for a few frames: the slide has landed.
      const t = performance.now() - start;
      if (t < SIDEBAR_FOLLOW_MS && (t < SIDEBAR_FOLLOW_MS / 2 || still < 4)) this._follow = requestAnimationFrame(step);
    };
    this._follow = requestAnimationFrame(step);
  }

  /** Fill or fit, and the fit's padding. Re-fits a locked view at once. */
  setFraming({ mode = "fill", padding = 0 } = {}) {
    this.framing = { mode: mode === "fit" ? "fit" : "fill", padding: Number(padding) || 0 };
    this.fit();
  }

  /** The fitted view for the live canvas, or null. */
  view() {
    const c = globalThis.canvas;
    if (!c?.ready || !c.dimensions?.sceneRect) return null;
    if (this.sceneId && c.scene?.id !== this.sceneId) return null;
    const [sw, sh] = c.screenDimensions ?? [c.app?.renderer?.screen?.width, c.app?.renderer?.screen?.height];
    return frameView(c.dimensions.sceneRect, sw || globalThis.innerWidth, sh || globalThis.innerHeight, this.framing, { right: sidebarInset() });
  }

  /**
   * How far right of the titles' centre the screen's own right edge is, as the
   * width a right-hand UI would have to cover to put the centre there: the
   * overlay centres titles in `screenW - inset`. Locked, that is the frame's
   * centre; unlocked (Canvas mode, a GM's free pan), the screen left of the sidebar.
   */
  titleInset() {
    const v = this.locked ? this.view() : null;
    const c = globalThis.canvas;
    const sw = c?.screenDimensions?.[0] || globalThis.innerWidth || 0;
    if (!v || !(sw > 0)) return sidebarInset();
    return Math.max(0, sw - 2 * v.screenX);
  }

  /**
   * Pan to a fitted view exactly. Foundry clamps a pan's zoom to its minimum —
   * the scene plus a grid square of padding fitting the window — which a fit
   * beside an open sidebar goes below, so the zoom would hold while the centre
   * moved and push the frame off the left edge. `_exact` lets the one pan
   * through unclamped.
   */
  _panExact(c, pan, v) {
    this._exact = true;
    try { return pan.call(c, v); } finally { this._exact = false; }
  }

  _install(c) {
    if (!c || c[WRAP]) return;
    const self = this;
    const pan = c.pan;
    const animatePan = c.animatePan;
    const constrainView = c._constrainView;
    c.pan = function theatrePan(position = {}) {
      const v = self.locked ? self.view() : null;
      return v ? self._panExact(this, pan, v) : pan.call(this, position);
    };
    c.animatePan = function theatreAnimatePan(opts = {}) {
      if (self.locked) {
        const v = self.view();
        if (v) { self._panExact(this, pan, v); return Promise.resolve(true); }
      }
      return animatePan.call(this, opts);
    };
    if (typeof constrainView === "function") {
      c._constrainView = function theatreConstrainView(view = {}) {
        if (self._exact && Number.isFinite(view.x) && Number.isFinite(view.y) && view.scale > 0) return { x: view.x, y: view.y, scale: view.scale };
        return constrainView.call(this, view);
      };
    }
    c[WRAP] = { pan, animatePan, constrainView };
  }

  /** Lock (true) or release (false). Locking fits immediately and binds the
   *  lock to the scene on the canvas now. */
  lock(on) {
    const want = !!on;
    this.sceneId = want ? (globalThis.canvas?.scene?.id ?? null) : null;
    if (want) this._install(globalThis.canvas);
    if (want === this.locked) { if (want) this.fit(); return; }
    this.locked = want;
    if (want) {
      this._hook = Hooks.on("canvasPan", () => this._onPan());
      this.fit();
    } else if (this._hook !== null) {
      Hooks.off("canvasPan", this._hook);
      this._hook = null;
    }
  }

  /** Fit now (attach, resize, a locked user's stray pan). No animation. */
  fit() {
    if (!this.locked || this._fitting) return;
    const c = globalThis.canvas;
    const v = this.view();
    if (!c || !v) return;
    this._fitting = true;
    try { this._panExact(c, c[WRAP]?.pan ?? c.pan, v); } finally { this._fitting = false; }
  }

  _onPan() {
    if (!this.locked || this._fitting) return;
    const c = globalThis.canvas, v = this.view();
    if (!c?.stage || !v) return;
    const p = c.stage.pivot, s = c.stage.scale.x;
    if (Math.abs(p.x - v.x) > 0.5 || Math.abs(p.y - v.y) > 0.5 || Math.abs(s - v.scale) > 1e-4) this.fit();
  }

  /** Release and forget (canvas teardown). The transparent wrapper stays. */
  reset() {
    this.lock(false);
  }
}

export const camera = new Camera();
