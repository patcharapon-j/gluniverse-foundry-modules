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
 */

/** The view that makes the scene rect cover the viewport. */
export function coverView(sceneRect, screenW, screenH) {
  const r = sceneRect;
  if (!r || !(r.width > 0 && r.height > 0) || !(screenW > 0 && screenH > 0)) return null;
  return {
    x: r.x + r.width / 2,
    y: r.y + r.height / 2,
    scale: Math.max(screenW / r.width, screenH / r.height),
  };
}

const WRAP = Symbol.for("gluniverse.theatre.cameraWrap");

class Camera {
  constructor() {
    this.locked = false;
    /** The scene the lock belongs to; any other scene's view is never touched. */
    this.sceneId = null;
    this._hook = null;
    this._fitting = false;
  }

  /** The fitted view for the live canvas, or null. */
  view() {
    const c = globalThis.canvas;
    if (!c?.ready || !c.dimensions?.sceneRect) return null;
    if (this.sceneId && c.scene?.id !== this.sceneId) return null;
    const [sw, sh] = c.screenDimensions ?? [c.app?.renderer?.screen?.width, c.app?.renderer?.screen?.height];
    return coverView(c.dimensions.sceneRect, sw || globalThis.innerWidth, sh || globalThis.innerHeight);
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
