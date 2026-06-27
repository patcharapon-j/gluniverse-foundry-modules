/**
 * GLUniverse Suite — Etched-Glass Chat Theme: per-card fracture renderer.
 *
 * A FEATURE-LOCAL offscreen PIXI renderer running FX_FRAG_BREAK from
 * core/fx-glsl.mjs, blitted to a per-card 2D <canvas> — never a per-card WebGL
 * context. Mirrors the initiative CardFXManager mechanism (one shared renderer,
 * N cheap 2D canvases) but with a one-shot "animate then settle to a static
 * cracked still" lifecycle instead of an indefinite loop. Two WebGL contexts
 * total across the suite (initiative + etched-chat); see
 * specs/002-etched-chat-theme/contracts/fx-surface.md.
 *
 * When WebGL/PIXI is unavailable, `supported` is false and callers fall back to
 * the pure-CSS crack (style.mjs / .glec-crack-css).
 */

import { FX_FRAG_BREAK, FX_SUPERSAMPLE } from "../../core/fx-glsl.mjs";

// color → [uBreakAmber, uBreakHot] (warm crack body, hot core).
const PALETTE = {
  // initiative's signature warm gold / white-hot.
  gold: { amber: [1.0, 0.72, 0.26], hot: [1.0, 0.95, 0.82] },
  // bad-beat valence: deep red shards with a violet/purple white-hot core.
  red: { amber: [0.86, 0.16, 0.22], hot: [0.66, 0.32, 0.95] },
};

const DEFAULT_DURATION_MS = 1000;
// Settled crack: shatterT = clamp(uTime*1.4,0,1) saturates near uTime≈0.71, so a
// static frame rendered past that shows the fully-formed fracture.
const SETTLE_TIME = 1.3;

class EtchedFractureRenderer {
  constructor() {
    this.supported = false;
    this._initTried = false;
    this.renderer = null;
    this.sprite = null;
    this.filter = null;
    this.entries = new Map(); // canvasEl -> entry
    this.ticking = false;
    this.tickFn = this._tick.bind(this);
    this._frameMs = 1000 / 30;
    this._lastDraw = 0;
  }

  ensureRenderer() {
    if (this._initTried) return this.supported;
    this._initTried = true;
    try {
      if (!globalThis.PIXI?.Renderer || !globalThis.PIXI?.Filter || !globalThis.PIXI?.Sprite) return false;
      this.renderer = new PIXI.Renderer({ width: 256, height: 160, backgroundAlpha: 0, antialias: true });
      this.sprite = new PIXI.Sprite(PIXI.Texture.WHITE);
      this.filter = new PIXI.Filter(undefined, FX_FRAG_BREAK, {
        uTime: 0,
        uSeed: 0,
        uAspect: 1,
        uClipCircle: 0,
        // Thinner crack lines read as a finer, more intricate shatter. This is
        // etched-chat's OWN filter instance, so it does not affect initiative's
        // fracture (which keeps the shared GLSL default).
        uThick: 0.05,
        uTexel: 0,
        uImpact: [0.65, 0.34],
        uBreakAmber: [...PALETTE.gold.amber],
        uBreakHot: [...PALETTE.gold.hot],
      });
      this.filter.padding = 0;
      // Force the GLSL program to compile now so the first fracture doesn't stall.
      try {
        this.sprite.width = 4;
        this.sprite.height = 4;
        this.sprite.filters = [this.filter];
        this.renderer.render(this.sprite);
        this.sprite.filters = null;
      } catch {
        /* compiles on demand if the warm-up render fails */
      }
      this.supported = true;
    } catch (e) {
      console.warn("gluniverse-foundry-modules | etched-chat | fracture FX unavailable, using CSS fallback", e);
      this.supported = false;
      this.renderer = null;
    }
    return this.supported;
  }

  /** @returns {boolean} */
  get isSupported() {
    return this.ensureRenderer();
  }

  _makeEntry(canvasEl, opts, mode) {
    const color = opts?.color === "red" ? "red" : "gold";
    return {
      canvas: canvasEl,
      ctx: canvasEl.getContext("2d"),
      color,
      mode, // "animate" | "static"
      seed: Math.random() * 100,
      // Origin in top-right quadrant (uv 0,0 = top-left): the fracture nucleates
      // at the upper-right corner and the CSS mask fades it across the card so it
      // never blankets the readable content.
      impact: opts?.impact ?? [0.82 + Math.random() * 0.14, 0.08 + Math.random() * 0.16],
      durationMs: Number(opts?.durationMs) || DEFAULT_DURATION_MS,
      // The animation clock does NOT start until the first frame that actually
      // paints (the card may have zero layout size for a frame or two right after
      // renderChatMessageHTML). Otherwise a fresh crit could burn its whole ~1s
      // window before the element is laid out and never visibly fracture.
      started: false,
      t0: 0,
    };
  }

  mountAnimated(canvasEl, opts) {
    if (!this.ensureRenderer() || !canvasEl) return () => {};
    this.entries.set(canvasEl, this._makeEntry(canvasEl, opts, "animate"));
    this._start();
    return () => this.unmount(canvasEl);
  }

  mountStatic(canvasEl, opts) {
    if (!this.ensureRenderer() || !canvasEl) return () => {};
    this.entries.set(canvasEl, this._makeEntry(canvasEl, opts, "static"));
    this._start();
    return () => this.unmount(canvasEl);
  }

  unmount(canvasEl) {
    this.entries.delete(canvasEl);
    if (!this.entries.size) this._stop();
  }

  _start() {
    if (this.ticking) return;
    this.ticking = true;
    requestAnimationFrame(this.tickFn);
  }

  _stop() {
    this.ticking = false;
  }

  _renderEntry(entry, uTime) {
    const cv = entry.canvas;
    if (!cv.isConnected || !entry.ctx) return false;
    const cw = cv.clientWidth || cv.offsetWidth;
    const ch = cv.clientHeight || cv.offsetHeight;
    if (!cw || !ch) return false; // not laid out yet; retry next frame
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pw = Math.max(1, Math.round(cw * dpr));
    const ph = Math.max(1, Math.round(ch * dpr));
    if (cv.width !== pw || cv.height !== ph) {
      cv.width = pw;
      cv.height = ph;
      entry.ctx.imageSmoothingEnabled = true;
      entry.ctx.imageSmoothingQuality = "high";
    }
    const rw = Math.max(1, Math.round(pw * FX_SUPERSAMPLE));
    const rh = Math.max(1, Math.round(ph * FX_SUPERSAMPLE));
    try {
      if (this.renderer.width < rw || this.renderer.height < rh) {
        this.renderer.resize(Math.max(this.renderer.width, rw), Math.max(this.renderer.height, rh));
      }
      const pal = PALETTE[entry.color] ?? PALETTE.gold;
      const u = this.filter.uniforms;
      u.uTime = uTime;
      u.uSeed = entry.seed;
      u.uAspect = rw / rh;
      u.uTexel = 1 / rh;
      u.uImpact = entry.impact;
      u.uBreakAmber = pal.amber;
      u.uBreakHot = pal.hot;
      this.sprite.width = rw;
      this.sprite.height = rh;
      this.sprite.filters = [this.filter];
      this.renderer.render(this.sprite);
      entry.ctx.clearRect(0, 0, pw, ph);
      entry.ctx.drawImage(this.renderer.view, 0, 0, rw, rh, 0, 0, pw, ph);
      return true;
    } catch {
      return false; // leave the canvas transparent; the portrait shows through
    }
  }

  _tick() {
    if (!this.ticking) return;
    const now = performance.now();
    if (now - this._lastDraw < this._frameMs) {
      requestAnimationFrame(this.tickFn);
      return;
    }
    this._lastDraw = now;
    for (const [cv, entry] of [...this.entries]) {
      if (!cv.isConnected) {
        this.entries.delete(cv);
        continue;
      }
      if (entry.mode === "static") {
        // Render the frozen cracked still once; if it painted, drop from the loop.
        if (this._renderEntry(entry, SETTLE_TIME)) this.entries.delete(cv);
        continue;
      }
      // Animated: the clock starts on the first frame that actually paints.
      if (!entry.started) {
        if (this._renderEntry(entry, 0)) {
          entry.started = true;
          entry.t0 = now;
        }
        continue; // wait for layout; retry next frame if it didn't paint
      }
      const elapsed = now - entry.t0;
      if (elapsed >= entry.durationMs) {
        this._renderEntry(entry, Math.max(elapsed / 1000, SETTLE_TIME)); // settled frame stays painted
        this.entries.delete(cv);
      } else {
        this._renderEntry(entry, elapsed / 1000);
      }
    }
    if (this.entries.size && this.ticking) requestAnimationFrame(this.tickFn);
    else this._stop();
  }

  destroy() {
    this.entries.clear();
    this._stop();
    try {
      this.renderer?.destroy();
    } catch {
      /* ignore */
    }
    this.renderer = null;
    this.sprite = null;
    this.filter = null;
    this.supported = false;
    this._initTried = false;
  }
}

/** Single feature-local renderer instance (lazy; one WebGL context per client). */
export const fxRenderer = new EtchedFractureRenderer();
