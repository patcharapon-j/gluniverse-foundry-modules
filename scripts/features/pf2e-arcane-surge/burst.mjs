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
 * unavailable. No PIXI — a two-second cosmetic beat has no business being able
 * to disturb the renderer the scene draw depends on.
 */

import { warn } from "../../core/const.mjs";
import { onThemeChange } from "../../core/theme.mjs";
import { FrameBudget, easeOut } from "./anim.mjs";
import { BURST_MS, FLOURISH_MS, TIER_FLOURISH } from "./constants.mjs";
import { bindFullscreenTriangle, buildProgram, mountCanvas, sizeToViewport, uniformLocations, webglSupported } from "./gl-host.mjs";
import { chaosFor } from "./levels.mjs";
import { rampFloats } from "./palette.mjs";
import { BLIT_FRAG, BLIT_UNIFORMS, BURST_FRAMES, BURST_FRAME_SIZE, BURST_FRAG, BURST_UNIFORMS, VERT } from "./shader.mjs";

class BurstHost {
  constructor() {
    this.canvas = null;
    this.gl = null;
    this.bakeProgram = null;
    this.blitProgram = null;
    this.bakeUniforms = {};
    this.blitUniforms = {};
    this.frames = [];
    this.bakedKey = null;
    this.budget = new FrameBudget();
    this._raf = null;
    this._onResize = () => sizeToViewport(this.canvas, this.gl);
  }

  _ensureContext() {
    if (this.gl) return true;

    const mounted = mountCanvas("glas-burst");
    if (!mounted) return false;
    this.canvas = mounted.canvas;
    this.gl = mounted.gl;

    this.bakeProgram = buildProgram(this.gl, VERT, BURST_FRAG, "burst");
    this.blitProgram = buildProgram(this.gl, VERT, BLIT_FRAG, "blit");
    if (!this.bakeProgram || !this.blitProgram) {
      this.destroy();
      return false;
    }

    bindFullscreenTriangle(this.gl, this.bakeProgram, this.blitProgram);
    this.bakeUniforms = uniformLocations(this.gl, this.bakeProgram, BURST_UNIFORMS);
    this.blitUniforms = uniformLocations(this.gl, this.blitProgram, BLIT_UNIFORMS);

    sizeToViewport(this.canvas, this.gl);
    window.addEventListener("resize", this._onResize);
    return true;
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

    const u = this.bakeUniforms;
    const ramp = rampFloats();
    gl.uniform2f(u.uRes, size, size);
    gl.uniform1f(u.uSeed, seedFor(level));
    gl.uniform1f(u.uChaos, chaos);
    gl.uniform3fv(u.uDeep, ramp.deep);
    gl.uniform3fv(u.uMid, ramp.mid);
    gl.uniform3fv(u.uHot, ramp.hot);

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

  /** A retheme invalidates every baked frame — the palette is burned into them. */
  retheme() {
    this._disposeFrames();
  }

  /* ── Playback ────────────────────────────────────────────────────── */

  play(level, { durationMs = BURST_MS, peak = 1 } = {}) {
    if (!webglSupported() || !this._ensureContext()) return;
    if (!this._bake(level)) return;

    this._stopLoop();
    sizeToViewport(this.canvas, this.gl);
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
let untheme = null;

function ensureHost() {
  host ??= new BurstHost();
  // The palette is baked INTO the frames, so a retheme has to throw them away.
  untheme ??= onThemeChange(() => host?.retheme());
  return host;
}

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
  const shape = TIER_FLOURISH[tier];
  // An unknown tier draws nothing rather than silently borrowing another tier's
  // weight — a wrong intensity here misreports how bad the result was.
  if (!shape) return;
  current.play(shape.level, { durationMs: FLOURISH_MS, peak: shape.peak });
}

export function destroyBurst() {
  untheme?.();
  untheme = null;
  host?.destroy();
  host = null;
}
