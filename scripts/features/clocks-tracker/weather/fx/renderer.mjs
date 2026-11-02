/**
 * Weather FX — the one WebGL2 context every weather and delving surface shares.
 *
 * The HUD bar, the bar's delving edge, the weather window's hero, and the two
 * editors' previews can all be on screen at once. One context each would be
 * five of the browser's ~sixteen, for strips a few hundred pixels across, and a
 * browser that runs out drops the OLDEST silently — which can be Foundry's own
 * canvas. So there is one context on a detached canvas: each surface draws its
 * frame into the corner of it and copies that corner onto its own 2D canvas in
 * the same task (`drawImage` of a WebGL canvas reads the frame just drawn).
 *
 * Programs are compiled per look, lazily, the first time a look is drawn; a
 * program that fails to compile is reported once and that look draws nothing
 * (the host's CSS-only tint stays), rather than throwing every frame.
 *
 * Pure: no `game`, no `canvas`, no `foundry`. The preview page drives it as is.
 */

import { VERT, UNIFORMS, fragmentShader } from "./shaders.mjs";
import { BOLT } from "./looks.mjs";

const TAG = "gluniverse-foundry-modules | clocks-tracker | weather fx";

export class FxRenderer {
  constructor() {
    this.canvas = null;
    this.gl = null;
    this.vao = null;
    this.programs = new Map();      // look → { prog, loc } | null (failed)
    this._lost = false;
    this._onLost = (ev) => { ev.preventDefault?.(); this._lost = true; };
  }

  /** Whether this browser can give us a WebGL2 context at all. */
  static supported() {
    try {
      if (typeof document === "undefined") return false;
      const c = document.createElement("canvas");
      const gl = c.getContext("webgl2");
      const ok = !!gl;
      gl?.getExtension("WEBGL_lose_context")?.loseContext();
      return ok;
    } catch { return false; }
  }

  get live() { return !!this.gl && !this._lost; }

  /** Build the context if there is none (or the last one was lost). */
  ensure() {
    if (this.gl && !this._lost) return true;
    this._drop();
    if (typeof document === "undefined") return false;
    const canvas = document.createElement("canvas");
    canvas.width = 2; canvas.height = 2;
    const gl = canvas.getContext("webgl2", {
      alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false,
      preserveDrawingBuffer: false, powerPreference: "low-power"
    });
    if (!gl) return false;
    canvas.addEventListener("webglcontextlost", this._onLost);
    this.canvas = canvas;
    this.gl = gl;
    this._lost = false;
    this.vao = gl.createVertexArray();
    gl.disable(gl.BLEND);
    return true;
  }

  _compile(look) {
    const gl = this.gl;
    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) {
        console.warn(`${TAG} | ${look} shader failed to compile`, gl.getShaderInfoLog(s));
        gl.deleteShader(s);
        return null;
      }
      return s;
    };
    const vs = sh(gl.VERTEX_SHADER, VERT);
    const fs = sh(gl.FRAGMENT_SHADER, fragmentShader(look));
    if (!vs || !fs) return null;
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS) && !gl.isContextLost()) {
      console.warn(`${TAG} | ${look} program failed to link`, gl.getProgramInfoLog(prog));
      gl.deleteProgram(prog);
      return null;
    }
    const loc = {};
    for (const name of UNIFORMS) loc[name] = gl.getUniformLocation(prog, name === "uBolt" ? "uBolt[0]" : name);
    return { prog, loc };
  }

  program(look) {
    if (!this.programs.has(look)) this.programs.set(look, this._compile(look));
    return this.programs.get(look);
  }

  /**
   * Draw one frame of `look` at `w × h` device px. Returns the source rect on
   * this.canvas to copy from, or null when nothing could be drawn.
   * @param {string} look
   * @param {object} u  every uniform in UNIFORMS, by name
   */
  draw(look, u, w, h) {
    if (!this.ensure()) return null;
    const gl = this.gl;
    const p = this.program(look);
    if (!p) return null;
    // Grow the backing store to fit the largest surface; never shrink per
    // frame, or two surfaces of different sizes would reallocate it twice a frame.
    if (this.canvas.width < w || this.canvas.height < h) {
      this.canvas.width = Math.max(this.canvas.width, w);
      this.canvas.height = Math.max(this.canvas.height, h);
    }
    gl.viewport(0, 0, w, h);
    gl.disable(gl.SCISSOR_TEST);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(p.prog);
    const L = p.loc;
    if (L.uHost) gl.uniform2f(L.uHost, u.uHost[0], u.uHost[1]);
    if (L.uSpan0) gl.uniform1f(L.uSpan0, u.uSpan0);
    if (L.uPx) gl.uniform1f(L.uPx, u.uPx);
    if (L.uPhase) gl.uniform1f(L.uPhase, u.uPhase);
    if (L.uI) gl.uniform1f(L.uI, u.uI);
    if (L.uTint) gl.uniform3fv(L.uTint, u.uTint);
    if (L.uGlow) gl.uniform3fv(L.uGlow, u.uGlow);
    if (L.uDir) gl.uniform2fv(L.uDir, u.uDir);
    if (L.uSeed) gl.uniform1f(L.uSeed, u.uSeed);
    if (L.uShed) gl.uniform4fv(L.uShed, u.uShed);
    if (L.uP) gl.uniform4fv(L.uP, u.uP);
    if (L.uFlash) gl.uniform1f(L.uFlash, u.uFlash);
    if (L.uBolt) gl.uniform2fv(L.uBolt, u.uBolt);
    if (L.uBoltA) gl.uniform1f(L.uBoltA, u.uBoltA);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    return { canvas: this.canvas, sx: 0, sy: this.canvas.height - h, w, h };
  }

  /** Free the context; the next draw rebuilds it (programs recompile). */
  release() { this._drop(); }

  _drop() {
    try {
      if (this.gl && !this.gl.isContextLost()) {
        for (const p of this.programs.values()) if (p) this.gl.deleteProgram(p.prog);
        this.gl.getExtension("WEBGL_lose_context")?.loseContext();
      }
    } catch { /* already gone */ }
    this.canvas?.removeEventListener("webglcontextlost", this._onLost);
    this.programs.clear();
    this.canvas = null; this.gl = null; this.vao = null;
    this._lost = false;
  }
}

/** An empty bolt (every slot the "no point" sentinel). */
export const NO_BOLT = new Float32Array(BOLT.points * 2).fill(-1);
