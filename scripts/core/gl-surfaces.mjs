/**
 * GLUniverse Suite — lifecycle for the suite's own WebGL surfaces.
 *
 * Beside Foundry's canvas the suite holds several WebGL contexts of its own
 * (stream-pacer ×2, stage, arcane-surge, initiative, the weather and critical
 * PIXI apps). A browser caps live contexts at around sixteen and drops the
 * oldest SILENTLY when it runs out — which, on a table running a few other
 * modules, can be Foundry's own canvas. Every one of them also costs GPU memory
 * and compositor work while it sits there doing nothing.
 *
 * This registry does two things to each surface, and nothing else:
 *
 *   • PAUSE while nobody can see it — its element is off-screen or
 *     `display: none`, or the page is hidden (unless this client is a capture
 *     client: an OBS browser source is "hidden" while it records).
 *   • RELEASE the context once it has gone unused for the policy's
 *     `glRelease` seconds. The feature rebuilds on its next `use()`.
 *
 * The feature keeps every decision about WHAT to draw; the registry only ever
 * calls the four callbacks it was handed. With the `perf` feature off, the
 * policy's `glRelease` is 0 (never release) and `pauseHidden` false, and
 * off-screen pausing is the only thing that happens — which is what every one
 * of these surfaces should have been doing anyway.
 *
 * Dependency-free apart from the budget; importable under Node, where it does
 * nothing until a surface registers and never touches `document` at import.
 */

import { Budget } from "./budget.mjs";

/**
 * @typedef {object} SurfaceSpec
 * @property {string} id
 * @property {() => (Element|null)} element  the element whose visibility gates it
 * @property {() => void} [pause]    stop the feature's own loop
 * @property {() => void} [resume]   restart it
 * @property {() => void} [release]  free the GPU context; must be rebuildable
 * @property {() => void} [restore]  rebuild after a release (else the feature
 *                                   rebuilds lazily inside its own draw path)
 */

const _surfaces = new Set();
let _io = null;
let _timer = 0;
let _wired = false;

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

function pageHidden() {
  return typeof document !== "undefined" && document.hidden === true;
}

function ensureWired() {
  if (_wired || typeof document === "undefined") return;
  _wired = true;
  document.addEventListener("visibilitychange", () => {
    for (const s of _surfaces) s._sync();
  });
  Budget.onChange((why) => {
    if (why === "policy") for (const s of _surfaces) s._sync();
  });
  if (typeof IntersectionObserver === "function") {
    _io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        for (const s of _surfaces) {
          if (s._observed !== e.target) continue;
          s._onScreen = e.isIntersecting;
          s._sync();
        }
      }
    });
  }
  _timer = setInterval(sweep, 5000);
}

/** Release anything idle past the policy's limit. */
function sweep() {
  const limit = Number(Budget.policy.glRelease) || 0;
  if (limit <= 0) return;
  const t = now();
  for (const s of _surfaces) {
    if (!s._released && t - s._lastUse > limit * 1000) s._release();
  }
}

class Surface {
  /** @param {SurfaceSpec} spec */
  constructor(spec) {
    this.spec = spec;
    this._lastUse = now();
    this._released = false;
    this._paused = false;
    this._onScreen = true;
    this._observed = null;
  }

  get id() {
    return this.spec.id;
  }

  get released() {
    return this._released;
  }

  get paused() {
    return this._paused;
  }

  /** Whether the feature should be drawing at all right now. */
  get visible() {
    if (!this._onScreen) return false;
    if (Budget.policy.pauseHidden && pageHidden()) return false;
    return true;
  }

  /**
   * Call before drawing. Rebuilds a released context (through `restore`, if
   * one was given) and marks the surface used. Returns false while the surface
   * should not draw — the feature skips the frame rather than drawing to a
   * canvas nobody can see.
   */
  use() {
    this._lastUse = now();
    this._observe();
    if (this._released) {
      this._released = false;
      try { this.spec.restore?.(); } catch (e) { console.error(`GLUniverse Suite | surface "${this.id}" restore failed`, e); }
    }
    return this.visible;
  }

  /** Mark as used without asking to draw (a state change that will draw soon). */
  touch() {
    this._lastUse = now();
  }

  /** Re-point the visibility observer (the feature replaced its element). */
  observe() {
    this._observe(true);
  }

  _observe(force = false) {
    if (!_io) return;
    let el = null;
    try { el = this.spec.element?.() ?? null; } catch { el = null; }
    if (el === this._observed && !force) return;
    if (this._observed) _io.unobserve(this._observed);
    this._observed = el;
    this._onScreen = true;
    if (el) _io.observe(el);
  }

  _sync() {
    const shouldRun = this.visible;
    if (shouldRun && this._paused) {
      this._paused = false;
      try { this.spec.resume?.(); } catch (e) { console.error(`GLUniverse Suite | surface "${this.id}" resume failed`, e); }
    } else if (!shouldRun && !this._paused) {
      this._paused = true;
      try { this.spec.pause?.(); } catch (e) { console.error(`GLUniverse Suite | surface "${this.id}" pause failed`, e); }
    }
  }

  _release() {
    if (this._released || typeof this.spec.release !== "function") return;
    this._released = true;
    try { this.spec.release(); } catch (e) { console.error(`GLUniverse Suite | surface "${this.id}" release failed`, e); }
  }

  dispose() {
    if (this._observed && _io) _io.unobserve(this._observed);
    this._observed = null;
    _surfaces.delete(this);
  }
}

export const Surfaces = {
  /**
   * Register a surface. Keep the returned handle and call `use()` before each
   * draw, `dispose()` when the feature tears the surface down for good.
   * @param {SurfaceSpec} spec
   */
  register(spec) {
    ensureWired();
    const s = new Surface(spec);
    _surfaces.add(s);
    s._observe();
    return s;
  },

  /** Every live surface, for the overlay. */
  list() {
    return [..._surfaces].map((s) => ({ id: s.id, paused: s._paused, released: s._released, idleMs: Math.round(now() - s._lastUse) }));
  },

  /** Test seam: run the idle sweep now. */
  _sweep: sweep,

  /** Test seam. */
  _reset() {
    for (const s of [..._surfaces]) s.dispose();
    if (_timer) clearInterval(_timer);
    _timer = 0;
    _io?.disconnect();
    _io = null;
    _wired = false;
  },
};
