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
 * fitted to (and centred in) the screen left of it, and follows the sidebar as
 * it slides open or shut (`followSidebar`).
 */

import { PADDING_MAX } from "./constants.mjs";

/** How long the follow loop may run after a sidebar toggle (Foundry slides it over 250ms). */
const SIDEBAR_FOLLOW_MS = 600;

/**
 * The locked view of the scene rect on a screen.
 *   fill — the rect covers the visible screen (cropped where the aspects differ),
 *          except that a sidebar never crops more of its sides than the whole
 *          screen would: there it shrinks and the backdrop shows above and below
 *   fit  — the whole rect is shown inside the visible screen less `padding` per
 *          cent of its shorter side on every edge; the backdrop fills what is left
 * `right` is the width covered by the UI on the right (the expanded sidebar):
 * the visible screen is the `screenW - right` strip at the left, and the frame
 * is centred in it.
 */
export function frameView(sceneRect, screenW, screenH, { mode = "fill", padding = 0 } = {}, { right = 0 } = {}) {
  const r = sceneRect;
  if (!r || !(r.width > 0 && r.height > 0) || !(screenW > 0 && screenH > 0)) return null;
  const inset = Math.max(0, Math.min(Number(right) || 0, screenW / 2));
  const w = screenW - inset;
  let scale;
  if (mode === "fit") {
    const pad = (Math.max(0, Math.min(PADDING_MAX, Number(padding) || 0)) / 100) * Math.min(w, screenH);
    scale = Math.min(Math.max(1, w - 2 * pad) / r.width, Math.max(1, screenH - 2 * pad) / r.height);
  } else {
    scale = Math.max(w / r.width, screenH / r.height);
    // The sidebar never crops more of the frame's sides than the whole screen
    // would: past that the frame shrinks to fit beside it and the backdrop
    // fills above and below, rather than its left edge falling off the screen.
    const overflow = Math.max(0, r.width * Math.max(screenW / r.width, screenH / r.height) - screenW);
    scale = Math.min(scale, (w + overflow) / r.width);
  }
  // The pivot sits at the screen's centre; the frame's centre sits half the inset left of it.
  return { x: r.x + r.width / 2 + inset / 2 / scale, y: r.y + r.height / 2, scale };
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
    this._follow = 0;
    this.framing = { mode: "fill", padding: 0 };
  }

  /**
   * The sidebar was toggled: re-fit every frame while it slides, so the frame
   * moves with it rather than jumping when it lands. `onFrame(inset)` lets the
   * caller move the DOM half (the titles) in step. Ends once the slide has
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
      try { onFrame?.(inset); } catch { /* the caller's own */ }
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

  _install(c) {
    if (!c || c[WRAP]) return;
    const self = this;
    const pan = c.pan;
    const animatePan = c.animatePan;
    c.pan = function theatrePan(position = {}) {
      const v = self.locked ? self.view() : null;
      return pan.call(this, v ?? position);
    };
    c.animatePan = function theatreAnimatePan(opts = {}) {
      if (self.locked) {
        const v = self.view();
        if (v) { pan.call(this, v); return Promise.resolve(true); }
      }
      return animatePan.call(this, opts);
    };
    c[WRAP] = { pan, animatePan };
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
    try { (c[WRAP]?.pan ?? c.pan).call(c, v); } finally { this._fitting = false; }
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
