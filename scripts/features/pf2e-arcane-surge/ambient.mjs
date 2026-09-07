/**
 * GLUniverse Suite — the ambient instability overlay.
 *
 * This is the standing cost of the feature: it runs for as long as the party is
 * somewhere unstable, which can be a whole session. Everything about it is
 * shaped by that. The shader is two octaves and one warp. It sits at
 * `--gl-z-sticky`, above the board but BELOW every piece of Foundry chrome, so a
 * session-long veil never lands on the sidebar or the hotbar. It pauses itself
 * when the tab is hidden. It freezes rather than disappears when the frame
 * budget is exceeded, because what degrades under load must be the motion and
 * never the state — a player on a struggling machine should not stop being able
 * to see that the world is coming apart.
 *
 * Stable renders NOTHING. Not a very faint something: the overlay is torn down
 * entirely, so the common case costs nothing at all.
 *
 * The lifecycle discipline is borrowed from clocks-tracker's `EffectField` — own
 * context, no autostart, pause on hidden, resize-aware — but not the class
 * itself, which is a particle system. Instability is not precipitation.
 */

import { warn } from "../../core/const.mjs";
import { FrameBudget, RAMP } from "./anim.mjs";
import { chaosFor } from "./levels.mjs";
import { AMBIENT_FRAG, VERT } from "./shader.mjs";
import { ambientEnabled, isConcealed, visibleLevel } from "./settings.mjs";

/** How long the veil takes to arrive or leave when the GM changes the level.
 *  A cut would announce the change; a cross-fade lets people notice it. */
const FADE_MS = 1400;

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
    this._raf = null;
    this._start = 0;
    this._last = 0;
    this._supported = null;
    this._onResize = () => this._resize();
    this._onVisibility = () => this._syncPause();
  }

  isSupported() {
    if (this._supported !== null) return this._supported;
    try {
      const probe = document.createElement("canvas");
      this._supported = !!(probe.getContext("webgl") || probe.getContext("experimental-webgl"));
    } catch {
      this._supported = false;
    }
    return this._supported;
  }

  _ensureContext() {
    if (this.gl) return true;

    const canvas = document.createElement("canvas");
    canvas.className = "glas-ambient";
    document.body.appendChild(canvas);
    this.canvas = canvas;

    const gl = canvas.getContext("webgl", { alpha: true, antialias: false, premultipliedAlpha: true })
      || canvas.getContext("experimental-webgl");
    if (!gl) {
      canvas.remove();
      this.canvas = null;
      return false;
    }
    this.gl = gl;

    this.program = this._build(VERT, AMBIENT_FRAG);
    if (!this.program) {
      this.destroy();
      return false;
    }
    gl.useProgram(this.program);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(this.program, "aPos");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    this.uniforms = {
      uTime: gl.getUniformLocation(this.program, "uTime"),
      uRes: gl.getUniformLocation(this.program, "uRes"),
      uChaos: gl.getUniformLocation(this.program, "uChaos"),
      uDrift: gl.getUniformLocation(this.program, "uDrift"),
      uFade: gl.getUniformLocation(this.program, "uFade"),
      uDeep: gl.getUniformLocation(this.program, "uDeep"),
      uMid: gl.getUniformLocation(this.program, "uMid"),
      uHot: gl.getUniformLocation(this.program, "uHot"),
    };

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.uniform3fv(this.uniforms.uDeep, RAMP.deep);
    gl.uniform3fv(this.uniforms.uMid, RAMP.mid);
    gl.uniform3fv(this.uniforms.uHot, RAMP.hot);

    this._resize();
    window.addEventListener("resize", this._onResize);
    document.addEventListener("visibilitychange", this._onVisibility);
    return true;
  }

  /** Both statuses are checked because a failure here is silent: no overlay
   *  ever appears and nothing anywhere reports why. */
  _build(vertexSource, fragmentSource) {
    const gl = this.gl;
    const compile = (type, source) => {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        warn("Arcane Surge | ambient shader compile failed:", gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
      }
      return shader;
    };
    const vs = compile(gl.VERTEX_SHADER, vertexSource);
    const fs = compile(gl.FRAGMENT_SHADER, fragmentSource);
    if (!vs || !fs) return null;
    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      warn("Arcane Surge | ambient program link failed:", gl.getProgramInfoLog(program));
      return null;
    }
    return program;
  }

  _resize() {
    if (!this.gl || !this.canvas) return;
    // Half resolution: this is a soft, low-alpha veil with no hard edge in it,
    // and it runs all session. Full device pixels here would be paid for every
    // frame and read identically.
    const dpr = Math.min(window.devicePixelRatio || 1, 2) * 0.5;
    const w = Math.max(1, Math.floor(window.innerWidth * dpr));
    const h = Math.max(1, Math.floor(window.innerHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.gl.viewport(0, 0, w, h);
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
    if (!this.isSupported() || !this._ensureContext()) return;
    this.chaos = wanted;
    this.target = 1;
    this._ensureLoop();
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

  _teardownIfIdle() {
    if (this.target > 0 || this.fade > 0) return;
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
    this.budget.reset();
  }
}

let host = null;

/** Bring the overlay into line with the current level, settings and permissions. */
export function syncAmbient() {
  host ??= new AmbientHost();
  host.sync();
}

export function destroyAmbient() {
  host?.destroy();
  host = null;
}
