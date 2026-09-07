/**
 * GLUniverse Suite — the surge burst.
 *
 * A fullscreen fracture that fires the instant a surge happens. It is BAKED,
 * never run live: `initiative`'s break splash already paid to learn that a
 * full-screen procedural Voronoi field costs a visible hiccup per frame, and
 * the one moment this effect exists for is the one moment a hitch is least
 * forgivable. So the shader runs once into a set of frame textures, and playback
 * is one textured triangle per frame.
 *
 * It is scaled by STABILITY LEVEL, not by severity. Severity is rolled later on
 * its own card — by then the burst is over — so the thing the burst can honestly
 * express is the state of the world, which the module already knows. The tier
 * gets its own shorter second beat when the card resolves (`playFlourish`).
 *
 * Modelled on `stream-pacer/PerilWebGL`: raw WebGL, its own canvas on `<body>`,
 * its own RAF loop, its own resize listener, and a clean no-op when WebGL is
 * unavailable. No PIXI — a three-second cosmetic beat has no business being able
 * to disturb the renderer the scene draw depends on.
 */

import { warn } from "../../core/const.mjs";
import { FrameBudget, RAMP, easeOut } from "./anim.mjs";
import { BURST_MS, FLOURISH_MS } from "./constants.mjs";
import { chaosFor } from "./levels.mjs";
import {
  BLIT_FRAG,
  BURST_FRAMES,
  BURST_FRAME_SIZE,
  BURST_FRAG,
  VERT,
} from "./shader.mjs";

class BurstHost {
  constructor() {
    this.canvas = null;
    this.gl = null;
    this.bakeProgram = null;
    this.blitProgram = null;
    this.blitUniforms = {};
    this.frames = [];
    this.bakedKey = null;
    this.budget = new FrameBudget();
    this._raf = null;
    this._supported = null;
    this._onResize = () => this._resize();
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

  /* ── Context ─────────────────────────────────────────────────────── */

  _ensureContext() {
    if (this.gl) return true;

    const canvas = document.createElement("canvas");
    canvas.className = "glas-burst";
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

    this.bakeProgram = this._program(VERT, BURST_FRAG);
    this.blitProgram = this._program(VERT, BLIT_FRAG);
    if (!this.bakeProgram || !this.blitProgram) {
      this.destroy();
      return false;
    }

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    for (const program of [this.bakeProgram, this.blitProgram]) {
      const loc = gl.getAttribLocation(program, "aPos");
      gl.useProgram(program);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    }

    this.blitUniforms = {
      uFrame: gl.getUniformLocation(this.blitProgram, "uFrame"),
      uOpacity: gl.getUniformLocation(this.blitProgram, "uOpacity"),
    };

    gl.enable(gl.BLEND);
    // Frames are stored premultiplied, so this is the correct blend for them.
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    this._resize();
    window.addEventListener("resize", this._onResize);
    return true;
  }

  /**
   * Compile and link, reporting either failure.
   *
   * A shader that will not compile degrades to NOTHING here rather than
   * throwing — the burst simply never appears and the feature looks merely
   * disappointing instead of broken. That is exactly why both statuses are
   * checked and logged.
   */
  _program(vertexSource, fragmentSource) {
    const gl = this.gl;
    const compile = (type, source) => {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        warn("Arcane Surge | burst shader compile failed:", gl.getShaderInfoLog(shader));
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
      warn("Arcane Surge | burst program link failed:", gl.getProgramInfoLog(program));
      return null;
    }
    return program;
  }

  _resize() {
    if (!this.gl || !this.canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.floor(window.innerWidth * dpr);
    const h = Math.floor(window.innerHeight * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  /* ── Baking ──────────────────────────────────────────────────────── */

  /**
   * Render the fracture into `BURST_FRAMES` textures once per stability level.
   *
   * Baking is the expensive moment, so it happens on the first surge at a given
   * level and is then reused for the rest of the session. The seed is derived
   * from the level rather than randomised, so a re-bake produces the same
   * fracture and a player does not see the "same" surge look different.
   */
  _bake(level) {
    const chaos = chaosFor(level);
    const key = `${level}:${chaos.toFixed(3)}`;
    if (this.bakedKey === key && this.frames.length === BURST_FRAMES) return true;

    const gl = this.gl;
    this._disposeFrames();

    const size = BURST_FRAME_SIZE;
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, size, size);
    gl.useProgram(this.bakeProgram);

    const u = {
      uTime: gl.getUniformLocation(this.bakeProgram, "uTime"),
      uRes: gl.getUniformLocation(this.bakeProgram, "uRes"),
      uSeed: gl.getUniformLocation(this.bakeProgram, "uSeed"),
      uChaos: gl.getUniformLocation(this.bakeProgram, "uChaos"),
      uDeep: gl.getUniformLocation(this.bakeProgram, "uDeep"),
      uMid: gl.getUniformLocation(this.bakeProgram, "uMid"),
      uHot: gl.getUniformLocation(this.bakeProgram, "uHot"),
    };
    gl.uniform2f(u.uRes, size, size);
    gl.uniform1f(u.uSeed, seedFor(level));
    gl.uniform1f(u.uChaos, chaos);
    gl.uniform3fv(u.uDeep, RAMP.deep);
    gl.uniform3fv(u.uMid, RAMP.mid);
    gl.uniform3fv(u.uHot, RAMP.hot);

    for (let i = 0; i < BURST_FRAMES; i++) {
      const texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);

      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
        warn("Arcane Surge | burst framebuffer incomplete; the burst will not play");
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.deleteFramebuffer(fbo);
        this._disposeFrames();
        return false;
      }

      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform1f(u.uTime, i / (BURST_FRAMES - 1));
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      this.frames.push(texture);
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fbo);
    this.bakedKey = key;
    return true;
  }

  _disposeFrames() {
    if (this.gl) for (const texture of this.frames) this.gl.deleteTexture(texture);
    this.frames = [];
    this.bakedKey = null;
  }

  /* ── Playback ────────────────────────────────────────────────────── */

  play(level, { durationMs = BURST_MS, peak = 1 } = {}) {
    if (!this.isSupported() || !this._ensureContext()) return;
    if (!this._bake(level)) return;

    this._stopLoop();
    this._resize();
    this.canvas.classList.add("glas-visible");

    const gl = this.gl;
    const start = performance.now();
    let last = start;

    const step = () => {
      const now = performance.now();
      this.budget.sample(now - last);
      last = now;

      const t = Math.min(1, (now - start) / durationMs);
      const frame = this.frames[Math.min(this.frames.length - 1, Math.floor(t * this.frames.length))];

      // In hard then out soft: the fracture should arrive faster than it leaves.
      const envelope = t < 0.12 ? easeOut(t / 0.12) : 1 - easeOut((t - 0.12) / 0.88);

      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(this.blitProgram);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, frame);
      gl.uniform1i(this.blitUniforms.uFrame, 0);
      gl.uniform1f(this.blitUniforms.uOpacity, envelope * peak);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      if (t >= 1) {
        this.canvas.classList.remove("glas-visible");
        this._raf = null;
        return;
      }
      this._raf = requestAnimationFrame(step);
    };
    this._raf = requestAnimationFrame(step);
  }

  _stopLoop() {
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
  }

  destroy() {
    this._stopLoop();
    window.removeEventListener("resize", this._onResize);
    this._disposeFrames();
    if (this.canvas) {
      this.canvas.remove();
      this.canvas = null;
    }
    this.gl = null;
    this.bakeProgram = null;
    this.blitProgram = null;
  }
}

/** A level's fracture is stable across a session rather than random per surge. */
function seedFor(level) {
  let hash = 0;
  for (let i = 0; i < level.length; i++) hash = (hash * 31 + level.charCodeAt(i)) % 9973;
  return hash / 9973;
}

let host = null;
const ensureHost = () => (host ??= new BurstHost());

/** The full beat, scaled by the world's state. */
export function playBurst(level) {
  ensureHost().play(level, { durationMs: BURST_MS, peak: 1 });
}

/**
 * The shorter second beat, when the severity card resolves.
 *
 * This is the most ornamental thing the feature draws, so it is the first thing
 * shed when the frame budget is under pressure — the tier is already legible on
 * the card, and a struggling machine should spend its frames on the game.
 */
export function playFlourish(tier) {
  const current = ensureHost();
  if (!current.budget.allows("flourish")) return;
  const peak = { minor: 0.35, major: 0.55, catastrophic: 0.8, breach: 1 }[tier] ?? 0.4;
  const level = { minor: "fraying", major: "unbound", catastrophic: "unraveling", breach: "unraveling" }[tier] ?? "fraying";
  current.play(level, { durationMs: FLOURISH_MS, peak });
}

export function destroyBurst() {
  host?.destroy();
  host = null;
}
