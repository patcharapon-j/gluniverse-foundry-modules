/**
 * Combat Intro — the WebGL2 backdrop: one full-screen pass, a shared PRELUDE
 * and a skin's fragment.
 *
 * Pure: no game/canvas/foundry. main.mjs registers the canvas with
 * core/gl-surfaces.mjs and compiles from an idle callback; the preview page
 * drives the same class.
 *
 * Compiling polls KHR_parallel_shader_compile's COMPLETION_STATUS on a TIMER,
 * never on animation frames: a background tab starves rAF, and a warm-up that
 * waits on it never finishes (CLAUDE.md, Spotlight Roll). After linking it
 * draws once at 1×1 and reads the pixel back, because drivers specialise a
 * program on its first draw and that first draw would otherwise be the frame
 * the whole table is watching.
 *
 * A program that fails to compile leaves `ok` false and the director drops
 * the sequence to CSS (`data-render="css"`); nothing throws.
 */
import { PRECISION } from "../../core/glsl.mjs";

export const MAX_ANCHORS = 12;

/** The prelude's uniforms, in declaration order. A skin may ignore any of them. */
export const PRELUDE_UNIFORMS = Object.freeze([
  "uRes", "uTime", "uPhase", "uBeat", "uBeatT", "uPhaseT", "uAnchors", "uAnchorN",
  "uAccent", "uHot", "uInk", "uWarn", "uShed", "uIntensity",
]);

export const PRELUDE = `#version 300 es
${PRECISION}
uniform vec2  uRes;
uniform float uTime;
uniform float uPhase;
uniform float uBeat;
uniform float uBeatT;
uniform float uPhaseT;
uniform vec4  uAnchors[${MAX_ANCHORS}];
uniform float uAnchorN;
uniform vec3  uAccent; uniform vec3 uHot; uniform vec3 uInk; uniform vec3 uWarn;
uniform float uShed;
uniform float uIntensity;
out vec4 outColor;
`;

const VERT = `#version 300 es
in vec2 aPos;
void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }`;

const GLSL_TYPE = { float: "float", vec2: "vec2", vec3: "vec3", vec4: "vec4" };

/**
 * The GLSL declarations for a skin's own uniforms. A skin may declare them in
 * its fragment itself or leave it to the `uniforms` list; one it already
 * declares is skipped, since a second declaration fails the compile.
 */
export function skinDeclarations(skin) {
  const src = skin?.fragment ?? "";
  return (skin?.uniforms ?? [])
    .filter((u) => !new RegExp(`\\buniform\\s+\\w+\\s+${u.name}\\b`).test(src))
    .map((u) => `uniform ${GLSL_TYPE[u.type] ?? "float"} ${u.name}${u.count ? `[${u.count}]` : ""};`).join("\n");
}

/** The full fragment source a skin compiles to. */
export function fragmentSource(skin) {
  return `${PRELUDE}${skinDeclarations(skin)}\n${skin?.fragment ?? "void main(){ outColor = vec4(0.0); }"}`;
}

/** Every uniform name a skin's program can read: the prelude's, then the skin's own. */
export function programUniforms(skin) {
  return [...PRELUDE_UNIFORMS, ...(skin?.uniforms ?? []).map((u) => u.name)];
}

export class Backdrop {
  /** @param {HTMLCanvasElement} canvas */
  constructor(canvas) {
    this.canvas = canvas;
    this.prog = null;
    this.loc = new Map();
    this.ok = false;
    this.report = "";
    this.error = null;
    this.skin = null;
    this.dpr = 1;
    this._init();
  }

  _init() {
    const opts = { premultipliedAlpha: true, alpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false };
    this.gl = this.canvas?.getContext?.("webgl2", opts) ?? null;
    if (!this.gl) return;
    const gl = this.gl;
    this.buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    this.parallel = gl.getExtension("KHR_parallel_shader_compile");
  }

  /**
   * Link and warm a skin's program. Resolves to `ok`.
   * @param {object} skin  a skin module (fragment + uniforms)
   * @param {{ wait?: () => Promise<void>, deadline?: number }} [opts]
   */
  async compile(skin, { wait = () => new Promise((r) => setTimeout(r, 16)), deadline = 4000 } = {}) {
    this.skin = skin;
    this.ok = false;
    const gl = this.gl;
    if (!gl) { this.report = "no WebGL2"; return false; }
    const t0 = performance.now();
    const vs = gl.createShader(gl.VERTEX_SHADER); gl.shaderSource(vs, VERT); gl.compileShader(vs);
    const fs = gl.createShader(gl.FRAGMENT_SHADER); gl.shaderSource(fs, fragmentSource(skin)); gl.compileShader(fs);
    const p = gl.createProgram();
    gl.attachShader(p, vs); gl.attachShader(p, fs); gl.bindAttribLocation(p, 0, "aPos"); gl.linkProgram(p);
    if (this.parallel) {
      const DONE = this.parallel.COMPLETION_STATUS_KHR;
      const give = performance.now() + deadline;
      while (!gl.getProgramParameter(p, DONE) && performance.now() < give) {
        if (gl.isContextLost()) { this.report = "context lost"; return false; }
        await wait();
      }
    }
    if (this.skin !== skin) return false;            // a newer compile superseded this one
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      this.error = gl.getShaderInfoLog(fs) || gl.getProgramInfoLog(p) || "link failed";
      this.report = "backdrop failed to compile";
      gl.deleteProgram(p); gl.deleteShader(vs); gl.deleteShader(fs);
      return false;
    }
    gl.deleteShader(vs); gl.deleteShader(fs);
    if (this.prog) gl.deleteProgram(this.prog);
    this.prog = p;
    this.loc.clear();
    for (const name of programUniforms(skin)) this.loc.set(name, gl.getUniformLocation(p, name));
    const linked = performance.now();
    gl.viewport(0, 0, 1, 1);
    this._draw({});
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    this.report = `${this.parallel ? "parallel" : "serial"} link ${Math.round(linked - t0)}ms · warm ${Math.round(performance.now() - linked)}ms`;
    this.error = null;
    return (this.ok = true);
  }

  /** Free the context (Surfaces release). `restore()` rebuilds on a fresh canvas. */
  release() {
    try { this.gl?.getExtension("WEBGL_lose_context")?.loseContext(); } catch { /* already gone */ }
    this.gl = null; this.prog = null; this.ok = false; this.loc.clear();
  }

  /** A lost context stays lost on its canvas: rebuild on a new one. */
  async restore(freshCanvas) {
    if (freshCanvas) this.canvas = freshCanvas;
    this._init();
    if (this.skin) await this.compile(this.skin);
    return this.ok;
  }

  resize(width, height, dpr = 1) {
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
    for (const k in u) {
      const loc = this.loc.get(k);
      if (loc == null) continue;
      const v = u[k];
      if (typeof v === "number") { gl.uniform1f(loc, v); continue; }
      const type = this._typeOf(k);
      if (type === "vec2") gl.uniform2fv(loc, v);
      else if (type === "vec3") gl.uniform3fv(loc, v);
      else if (type === "vec4") gl.uniform4fv(loc, v);
      else gl.uniform1fv(loc, v);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  _typeOf(name) {
    if (name === "uRes") return "vec2";
    if (name === "uAnchors") return "vec4";
    if (name === "uAccent" || name === "uHot" || name === "uInk" || name === "uWarn") return "vec3";
    return this.skin?.uniforms?.find((u) => u.name === name)?.type ?? "float";
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
