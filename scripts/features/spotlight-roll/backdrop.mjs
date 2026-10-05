/**
 * The spotlight's WebGL backdrop: one full-screen fragment program, compiled
 * and WARMED long before anyone throws.
 *
 * Pure: no game/canvas/foundry. The feature registers the canvas with
 * `Surfaces` and calls `compile()` from an idle callback at ready; the preview
 * page drives the same class.
 *
 * Why warm and not just compile: drivers finish specialising a program on its
 * first DRAW, not on link, so a program that has only been linked still hitches
 * the first frame it is used — which here is the frame the table is watching.
 * `compile()` links (in parallel where KHR_parallel_shader_compile exists,
 * polling COMPLETION_STATUS instead of blocking), then draws once at 1×1 and
 * reads that pixel back so the draw has really finished.
 *
 * A program that fails to compile leaves `ok` false; the director then runs
 * the CSS backdrop, which carries every beat on its own.
 */
import { PRECISION } from "../../core/glsl.mjs";
import { FX_GLSL_NOISE, FX_GLSL_BREAK_FIELD } from "../../core/fx-glsl.mjs";

export const MAX_DICE = 6;

/** Every uniform the director writes. A fragment may ignore any of them. */
export const UNIFORMS = Object.freeze([
  "uRes", "uDpr", "uTime", "uT", "uArrive", "uRate", "uDie", "uDieR", "uAccent", "uDegColor",
  "uDegree", "uNatural", "uThrowT", "uLandT", "uNatT", "uDcT", "uTallyT", "uTallyN", "uDegT", "uOutT",
  "uSeed", "uCrit", "uFortT", "uDiceA", "uDiceB", "uDiceN", "uShed",
]);

export const PRELUDE = `${PRECISION}
uniform vec2 uRes; uniform float uDpr; uniform float uTime; uniform float uT; uniform float uArrive; uniform float uRate;
uniform vec2 uDie; uniform float uDieR; uniform vec3 uAccent; uniform vec3 uDegColor;
uniform float uDegree; uniform float uNatural; uniform float uCrit;
uniform float uThrowT; uniform float uLandT; uniform float uNatT; uniform float uDcT; uniform float uTallyT; uniform float uTallyN;
uniform float uDegT; uniform float uOutT; uniform float uFortT; uniform float uSeed;
uniform vec4 uDiceA[${MAX_DICE}]; uniform vec4 uDiceB[${MAX_DICE}]; uniform float uDiceN; uniform float uShed;
${FX_GLSL_NOISE}
${FX_GLSL_BREAK_FIELD}
`;

const VERT = `attribute vec2 aPos; void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }`;

export class Backdrop {
  /** @param {HTMLCanvasElement} canvas */
  constructor(canvas) {
    this.canvas = canvas;
    this.prog = null;
    this.loc = {};
    this.extra = new Map();
    this.ok = false;
    this.report = "";
    this.dpr = 1;
    this._init();
  }

  _init() {
    const opts = { premultipliedAlpha: true, alpha: true, antialias: false, depth: false, stencil: false };
    this.gl = this.canvas.getContext("webgl2", opts) || this.canvas.getContext("webgl", opts);
    if (!this.gl) return;
    const gl = this.gl;
    this.buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    this.parallel = gl.getExtension("KHR_parallel_shader_compile");
  }

  /**
   * Link and warm `fragment` (prelude prepended). Resolves to `ok`.
   * @param {string} fragment
   * @param {{ wait?: () => Promise<void>, deadline?: number }} [opts]
   *   how to wait between polls, and how long to poll before simply blocking.
   *   Polling is on a timer, not animation frames: a hidden or throttled tab
   *   (a background tab, an embedded pane) starves rAF, and a warm-up that
   *   waits on it never finishes — the spotlight then waits on the warm-up.
   */
  async compile(fragment, { wait = () => new Promise((r) => setTimeout(r, 16)), deadline = 4000 } = {}) {
    const gl = this.gl;
    this.fragment = fragment;
    if (!gl) { this.report = "no WebGL"; return (this.ok = false); }
    const t0 = performance.now();
    const p = gl.createProgram();
    const vs = gl.createShader(gl.VERTEX_SHADER); gl.shaderSource(vs, VERT); gl.compileShader(vs);
    const fs = gl.createShader(gl.FRAGMENT_SHADER); gl.shaderSource(fs, PRELUDE + fragment); gl.compileShader(fs);
    gl.attachShader(p, vs); gl.attachShader(p, fs); gl.bindAttribLocation(p, 0, "aPos"); gl.linkProgram(p);
    if (this.parallel) {
      const DONE = this.parallel.COMPLETION_STATUS_KHR;
      const give = performance.now() + deadline;
      while (!gl.getProgramParameter(p, DONE) && performance.now() < give) {
        if (gl.isContextLost()) return (this.ok = false);
        await wait();
      }
    }
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      this.error = gl.getShaderInfoLog(fs) || gl.getProgramInfoLog(p) || "link failed";
      this.report = "backdrop failed to compile";
      return (this.ok = false);
    }
    gl.deleteShader(vs); gl.deleteShader(fs);
    this.prog = p;
    this.loc = Object.fromEntries(UNIFORMS.map((u) => [u, gl.getUniformLocation(p, u)]));
    this.extra.clear();
    const linked = performance.now();
    gl.viewport(0, 0, 1, 1);
    this._draw({});
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    this.report = `${this.parallel ? "parallel" : "serial"} link ${Math.round(linked - t0)}ms · warm ${Math.round(performance.now() - linked)}ms`;
    return (this.ok = true);
  }

  /** Free the context (Surfaces release). `restore()` rebuilds on a new canvas. */
  release() {
    this.gl?.getExtension("WEBGL_lose_context")?.loseContext();
    this.gl = null; this.prog = null; this.ok = false;
  }

  /** A lost context stays lost on its canvas: rebuild on a fresh one. */
  async restore(freshCanvas) {
    this.canvas = freshCanvas;
    this._init();
    if (this.fragment) await this.compile(this.fragment);
    return this.ok;
  }

  resize(width, height, dpr) {
    this.dpr = dpr;
    const w = Math.max(1, Math.round(width * dpr)), h = Math.max(1, Math.round(height * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
  }

  _draw(u) {
    const gl = this.gl;
    gl.useProgram(this.prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    for (const [k, v] of Object.entries(u)) {
      let loc = this.loc[k];
      if (loc === undefined) {
        if (!this.extra.has(k)) this.extra.set(k, gl.getUniformLocation(this.prog, k));
        loc = this.extra.get(k);
      }
      if (loc == null) continue;
      if (typeof v === "number") gl.uniform1f(loc, v);
      else if (v.length > 4) gl.uniform4fv(loc, v);
      else if (v.length === 2) gl.uniform2fv(loc, v);
      else if (v.length === 3) gl.uniform3fv(loc, v);
      else if (v.length === 4) gl.uniform4fv(loc, v);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /** Draw one frame. Returns false when there is nothing to draw with. */
  frame(u) {
    const gl = this.gl;
    if (!gl || !this.ok || gl.isContextLost()) return false;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    this._draw(u);
    return true;
  }
}
