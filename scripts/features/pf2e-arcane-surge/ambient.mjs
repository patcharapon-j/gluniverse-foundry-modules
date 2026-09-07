/**
 * GLUniverse Suite — the ambient instability overlay.
 *
 * This is the standing cost of the feature: it runs for as long as the party is
 * somewhere unstable, which can be a whole session. Everything about it is
 * shaped by that. The shader is two octaves and one warp. It sits at
 * `--gl-z-sticky`, above the board but BELOW every piece of Foundry chrome, so a
 * session-long veil never lands on the sidebar or the hotbar. It hugs the four
 * EDGES of the screen and leaves the middle of the board alone, because that is
 * where the play is. It pauses itself when the tab is hidden. It freezes rather
 * than disappears when the frame budget is exceeded, because what degrades under
 * load must be the motion and never the state — a player on a struggling machine
 * should not stop being able to see that the world is coming apart.
 *
 * Stable renders NOTHING. Not a very faint something: the shader's alpha is
 * scaled by chaos so it is exactly inert at Stable. The compiled context is
 * nonetheless KEPT once warmed, so moving off Stable mid-session costs no
 * stutter.
 *
 * The lifecycle discipline is borrowed from clocks-tracker's `EffectField` — own
 * context, no autostart, pause on hidden, resize-aware — but not the class
 * itself, which is a particle system. Instability is not precipitation.
 */

import { onThemeChange } from "../../core/theme.mjs";
import { FrameBudget } from "./anim.mjs";
import { bindFullscreenTriangle, buildProgram, mountCanvas, sizeToViewport, uniformLocations, webglSupported } from "./gl-host.mjs";
import { chaosFor } from "./levels.mjs";
import { rampFloats } from "./palette.mjs";
import { AMBIENT_FRAG, AMBIENT_UNIFORMS, VERT } from "./shader.mjs";
import { ambientEnabled, isConcealed, visibleLevel } from "./settings.mjs";

/** How long the veil takes to arrive or leave when the GM changes the level.
 *  A cut would announce the change; a cross-fade lets people notice it. */
const FADE_MS = 1400;

/**
 * Full device resolution.
 *
 * An earlier pass rendered this at half and argued the veil was too soft to
 * show it. That was true of the soft cloud it used to be; it is not true of the
 * ridged filaments it is now, which are thin, high-contrast and the first thing
 * to crawl when they are undersampled. The field is two octaves and one warp —
 * cheap enough to afford honestly.
 */
const RESOLUTION_SCALE = 1;

class AmbientHost {
  constructor() {
    this.canvas = null;
    this.gl = null;
    this.program = null;
    this.uniforms = {};
    this.budget = new FrameBudget();
    this.chaos = 0;
    this.fade = 0;
    this.target = 0;
    this.warmed = false;
    this._raf = null;
    this._start = 0;
    this._last = 0;
    this._onResize = () => sizeToViewport(this.canvas, this.gl, RESOLUTION_SCALE);
    this._onVisibility = () => this._syncPause();
  }

  _ensureContext() {
    if (this.gl) return true;

    const mounted = mountCanvas("glas-ambient");
    if (!mounted) return false;
    this.canvas = mounted.canvas;
    this.gl = mounted.gl;

    this.program = buildProgram(this.gl, VERT, AMBIENT_FRAG, "ambient");
    if (!this.program) {
      this.destroy();
      return false;
    }

    bindFullscreenTriangle(this.gl, this.program);
    this.uniforms = uniformLocations(this.gl, this.program, AMBIENT_UNIFORMS);
    this._pushRamp();

    sizeToViewport(this.canvas, this.gl, RESOLUTION_SCALE);
    window.addEventListener("resize", this._onResize);
    document.addEventListener("visibilitychange", this._onVisibility);
    return true;
  }

  /** The three ramp colours, re-read from the palette rather than remembered,
   *  so a retheme reaches the veil on the next repaint. */
  _pushRamp() {
    if (!this.gl || !this.program) return;
    const ramp = rampFloats();
    this.gl.useProgram(this.program);
    this.gl.uniform3fv(this.uniforms.uDeep, ramp.deep);
    this.gl.uniform3fv(this.uniforms.uMid, ramp.mid);
    this.gl.uniform3fv(this.uniforms.uHot, ramp.hot);
  }

  /** Re-read the world's state and cross-fade toward it. */
  sync() {
    const level = visibleLevel();
    const wanted = ambientEnabled() && !(isConcealed() && !game.user.isGM) ? chaosFor(level) : 0;

    if (wanted <= 0) {
      this.target = 0;
      // Nothing is torn down yet — the fade still has to run out.
      if (this.fade <= 0) this._teardownIfIdle();
      else this._ensureLoop();
      return;
    }
    if (!webglSupported() || !this._ensureContext()) return;
    this.chaos = wanted;
    this.target = 1;
    this._ensureLoop();
  }

  /** Repaint after a theme change, without disturbing the fade. */
  retheme() {
    this._pushRamp();
  }

  /**
   * Compile and draw once at load, invisibly.
   *
   * The overlay is torn down at Stable, so without this the first time the GM
   * moves the world off Stable the veil's program compiles mid-fade — a stutter
   * at the exact moment the party is supposed to notice something changed. One
   * off-screen draw at zero opacity costs a frame now and none later.
   */
  warm() {
    if (this.warmed) return false;
    if (!webglSupported() || !this._ensureContext()) return false;
    this.warmed = true;

    const gl = this.gl;
    gl.useProgram(this.program);
    gl.uniform1f(this.uniforms.uTime, 0);
    gl.uniform2f(this.uniforms.uRes, this.canvas.width, this.canvas.height);
    gl.uniform1f(this.uniforms.uChaos, 1);
    gl.uniform1f(this.uniforms.uDrift, 1);
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

    const gl = this.gl;
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.program);
    gl.uniform1f(this.uniforms.uTime, (now - this._start) / 1000);
    gl.uniform2f(this.uniforms.uRes, this.canvas.width, this.canvas.height);
    gl.uniform1f(this.uniforms.uChaos, this.chaos);
    // Shedding drift stops the clock, not the veil.
    gl.uniform1f(this.uniforms.uDrift, this.budget.allows("drift") ? 1 : 0);
    gl.uniform1f(this.uniforms.uFade, this.fade);
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
     exists to prevent. Only the render loop stops. */
  _teardownIfIdle() {
    if (this.target > 0 || this.fade > 0) return;
    if (this.warmed) return;
    this.destroy();
  }

  destroy() {
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
    window.removeEventListener("resize", this._onResize);
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
    this.budget.reset();
  }
}

let host = null;
let untheme = null;

/** Bring the overlay into line with the current level, settings and permissions. */
export function syncAmbient() {
  host ??= new AmbientHost();
  // Canvas and WebGL cannot read a CSS custom property, so a retheme has to be
  // pushed to the uniforms by hand or the veil keeps the old palette forever.
  untheme ??= onThemeChange(() => host?.retheme());
  host.sync();
}

export function warmAmbient() {
  host ??= new AmbientHost();
  host.warm();
}

export function destroyAmbient() {
  untheme?.();
  untheme = null;
  host?.destroy();
  host = null;
}
