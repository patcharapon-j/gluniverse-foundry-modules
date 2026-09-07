/**
 * GLUniverse Suite — the stability cracks.
 *
 * The instability the party is standing in, drawn as glass splintering out of
 * the label that names it in the time-tracker HUD. It is the standing cost of
 * the feature — it runs for as long as the party is somewhere unstable, which
 * can be a whole session — and everything here is shaped by that.
 *
 * This replaced a full-screen veil, and the reason is the useful part: a
 * session-long layer over the board fights the map for the middle of the
 * screen, which is the one part of the screen the play is happening in. Making
 * it quiet enough to live with made it read as haze; making it read as a threat
 * made it something a GM had to look through for three hours. A strip of
 * cracking glass beside the word "Unraveling" says the same thing, is never in
 * anybody's way, and costs about a thousandth of the fill rate.
 *
 * Two lifecycle facts drive the rest of it:
 *
 *   THE HUD REBUILDS ITS OWN DOM on every clock tick. So the canvas is created
 *   once and re-parented into each fresh chip rather than remounted — a new
 *   context every minute would recompile the program every minute.
 *
 *   THE CHIP IS NOT THERE AT LOAD. So the context is stood up DETACHED and
 *   warmed off-screen, then attached whenever the chip first appears.
 *
 * Stable renders NOTHING: the shader's alpha is scaled by chaos, so it is
 * exactly inert there rather than very faint. The warmed context is kept
 * anyway, so moving off Stable mid-session costs no stutter.
 */

import { onThemeChange } from "../../core/theme.mjs";
import { FrameBudget } from "./anim.mjs";
import { bindFullscreenTriangle, buildProgram, mountCanvas, sizeToElement, uniformLocations, webglSupported } from "./gl-host.mjs";
import { chaosFor } from "./levels.mjs";
import { levelFloats } from "./palette.mjs";
import { CRACK_FRAG, CRACK_UNIFORMS, VERT } from "./shader.mjs";
import { ambientEnabled, isConcealed, visibleLevel } from "./settings.mjs";

/** How long the cracks take to spread or close when the GM changes the level.
 *  A cut would announce the change; a spread lets people notice it. */
const FADE_MS = 1100;

/**
 * How far past the chip's own box the canvas reaches, in CSS pixels.
 *
 * Without it every outermost shard is clipped to the same four straight lines
 * and the fracture reads as a filled panel rather than as something breaking
 * out of the label.
 */
const BLEED = 10;

class CrackHost {
  constructor() {
    this.canvas = null;
    this.gl = null;
    this.program = null;
    this.uniforms = {};
    this.budget = new FrameBudget();
    this.chaos = 0;
    this.level = "stable";
    this.fade = 0;
    this.target = 0;
    this.warmed = false;
    this.seed = Math.random() * 100;
    this._raf = null;
    this._start = 0;
    this._last = 0;
    this._size = null;
    this._observer = null;
    this._onVisibility = () => this._syncPause();
  }

  /** Stand the context up detached — the chip it belongs in may not exist yet. */
  _ensureContext() {
    if (this.gl) return true;

    const mounted = mountCanvas("glas-cracks", null);
    if (!mounted) return false;
    this.canvas = mounted.canvas;
    this.gl = mounted.gl;

    this.program = buildProgram(this.gl, VERT, CRACK_FRAG, "cracks");
    if (!this.program) {
      this.destroy();
      return false;
    }

    bindFullscreenTriangle(this.gl, this.program);
    this.uniforms = uniformLocations(this.gl, this.program, CRACK_UNIFORMS);
    this._pushRamp();

    document.addEventListener("visibilitychange", this._onVisibility);
    return true;
  }

  /**
   * The ramp, re-read rather than remembered.
   *
   * `mid` is the LEVEL's own hue, so the cracks and the chip's marker two pixels
   * away are the same colour. `LEVEL_KEYS` and the `.glas-level-*` accent
   * remaps are the two halves of that, and the check tool holds them together.
   */
  _pushRamp() {
    if (!this.gl || !this.program) return;
    const ramp = levelFloats(this.level);
    this.gl.useProgram(this.program);
    this.gl.uniform3fv(this.uniforms.uDeep, ramp.deep);
    this.gl.uniform3fv(this.uniforms.uMid, ramp.mid);
    this.gl.uniform3fv(this.uniforms.uHot, ramp.hot);
  }

  /**
   * Put the canvas inside this chip, and watch the chip for resizing.
   *
   * Called after every HUD repaint. Re-parenting an existing canvas keeps its
   * context and its compiled program; only the element moves.
   */
  attach(container) {
    if (!container) return;
    if (!webglSupported() || !this._ensureContext()) return;
    if (this.canvas.parentElement !== container) {
      container.appendChild(this.canvas);
      this._observer?.disconnect();
      if (typeof ResizeObserver === "function") {
        // The chip's width is the level's own NAME, so it changes when the
        // level does — and the HUD is draggable, collapsible and re-laid-out.
        this._observer = new ResizeObserver(() => this._measure());
        this._observer.observe(container);
      }
    }
    this._measure();
  }

  /* `_size` doubles as "is there anywhere to draw". Clearing it when the canvas
     has no parent is what stops the loop rendering into a detached buffer after
     the HUD is closed — which costs nothing visible and would never be noticed. */
  _measure() {
    if (!this.gl) return;
    const parent = this.canvas?.parentElement;
    this._size = parent ? sizeToElement(this.canvas, this.gl, parent, BLEED) : null;
  }

  /** Re-read the world's state and spread or close toward it. */
  sync() {
    const level = visibleLevel();
    const wanted = ambientEnabled() && !(isConcealed() && !game.user.isGM) ? chaosFor(level) : 0;

    if (wanted <= 0) {
      this.target = 0;
      if (this.fade <= 0) this._teardownIfIdle();
      else this._ensureLoop();
      return;
    }
    if (!webglSupported() || !this._ensureContext()) return;
    if (level !== this.level) {
      this.level = level;
      this._pushRamp();
    }
    this.chaos = wanted;
    this.target = 1;
    this._measure();
    this._ensureLoop();
  }

  /** Repaint after a theme change, without disturbing the spread. */
  retheme() {
    this._pushRamp();
  }

  /**
   * Compile and draw once at load, off-screen.
   *
   * A GL program is not really compiled when `linkProgram` returns — drivers
   * specialize on first draw. Left cold, the first time the GM moves the world
   * off Stable the cracks compile mid-fade, at the exact moment the party is
   * supposed to notice something changed. One draw into a detached canvas costs
   * a frame now and none later.
   */
  warm() {
    if (this.warmed) return false;
    if (!webglSupported() || !this._ensureContext()) return false;
    this.warmed = true;

    const gl = this.gl;
    // The detached canvas has no layout, so it is given a plausible strip to
    // rasterise. The size only has to be non-degenerate for the driver to do
    // the specialization work; attach() measures the real one.
    this.canvas.width = 256;
    this.canvas.height = 48;
    gl.viewport(0, 0, 256, 48);

    gl.useProgram(this.program);
    gl.uniform1f(this.uniforms.uTime, 0);
    gl.uniform2f(this.uniforms.uRes, 256, 48);
    gl.uniform1f(this.uniforms.uChaos, 1);
    gl.uniform1f(this.uniforms.uDrift, 1);
    gl.uniform1f(this.uniforms.uSeed, this.seed);
    gl.uniform1f(this.uniforms.uTexel, 1 / 48);
    // Zero fade: the shader runs in full, the compositor shows nothing.
    gl.uniform1f(this.uniforms.uFade, 0);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.finish();
    return true;
  }

  _ensureLoop() {
    if (this._raf || !this.gl) return;
    this._start = performance.now();
    this._last = this._start;
    this._raf = requestAnimationFrame(() => this._frame());
  }

  _frame() {
    if (!this.gl) return;
    const now = performance.now();
    const dt = now - this._last;
    this._last = now;
    this.budget.sample(dt);

    const stepped = dt / FADE_MS;
    this.fade = this.target > this.fade
      ? Math.min(this.target, this.fade + stepped)
      : Math.max(this.target, this.fade - stepped);

    if (this.fade <= 0 && this.target <= 0) {
      this._raf = null;
      this._teardownIfIdle();
      return;
    }

    // No layout yet (the HUD is collapsed, or the chip has not been painted):
    // keep the fade clock running so the state is right when it reappears, but
    // draw nothing into a zero-sized buffer.
    if (!this._size) {
      this._measure();
      if (!this._size) {
        this._raf = requestAnimationFrame(() => this._frame());
        return;
      }
    }

    const gl = this.gl;
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.program);
    gl.uniform1f(this.uniforms.uTime, (now - this._start) / 1000);
    gl.uniform2f(this.uniforms.uRes, this.canvas.width, this.canvas.height);
    gl.uniform1f(this.uniforms.uChaos, this.chaos);
    // Shedding drift stops the clock, not the cracks.
    gl.uniform1f(this.uniforms.uDrift, this.budget.allows("drift") ? 1 : 0);
    gl.uniform1f(this.uniforms.uFade, this.fade);
    gl.uniform1f(this.uniforms.uSeed, this.seed);
    /* One device pixel in field units. The shared field's shard edges are the
       finest thing in the suite and this strip is the smallest place any of
       them has been drawn, so without this they crawl on every repaint. At 0
       the clamp inside the field is inert, so a missing uniform degrades to
       the unfiltered look rather than to a blank strip. */
    gl.uniform1f(this.uniforms.uTexel, 1 / Math.max(1, this.canvas.height));
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    this._raf = requestAnimationFrame(() => this._frame());
  }

  /** A hidden tab renders nothing; a background window should cost nothing. */
  _syncPause() {
    if (document.hidden) {
      if (this._raf) cancelAnimationFrame(this._raf);
      this._raf = null;
    } else if (this.fade > 0 || this.target > 0) {
      this._ensureLoop();
    }
  }

  /* A warmed context is deliberately KEPT at Stable. Tearing it down would
     discard the compiled program and hand the stutter back to the moment the
     GM next moves the world off Stable, which is the whole thing warming
     exists to prevent. Only the render loop stops, and the strip is cleared so
     nothing is left standing on the chip. */
  _teardownIfIdle() {
    if (this.target > 0 || this.fade > 0) return;
    if (this.warmed) {
      if (this.gl && this._size) {
        this.gl.clearColor(0, 0, 0, 0);
        this.gl.clear(this.gl.COLOR_BUFFER_BIT);
      }
      return;
    }
    this.destroy();
  }

  destroy() {
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
    this._observer?.disconnect();
    this._observer = null;
    document.removeEventListener("visibilitychange", this._onVisibility);
    if (this.canvas) {
      this.canvas.remove();
      this.canvas = null;
    }
    this.gl = null;
    this.program = null;
    this.fade = 0;
    this.target = 0;
    this.warmed = false;
    this._size = null;
    this.budget.reset();
  }
}

let host = null;
let untheme = null;

/**
 * Bring the cracks into line with the current level, settings and permissions.
 *
 * `container` is the freshly painted `.glas-stability` the chip now lives in;
 * omitted, the canvas stays where it is.
 */
export function syncCracks(container = null) {
  host ??= new CrackHost();
  // Canvas and WebGL cannot read a CSS custom property, so a retheme has to be
  // pushed to the uniforms by hand or the cracks keep the old palette forever.
  untheme ??= onThemeChange(() => host?.retheme());
  if (container) host.attach(container);
  host.sync();
}

export function warmCracks() {
  host ??= new CrackHost();
  host.warm();
}

export function destroyCracks() {
  untheme?.();
  untheme = null;
  host?.destroy();
  host = null;
}
