/**
 * Stage character grade — the GPU pass.
 *
 * One WebGL context for the whole feature, deliberately *not* Foundry's. A
 * cosmetic overlay has no business being able to corrupt renderer state the
 * scene draw depends on, and the isolation costs one context rather than one
 * per slot (browsers cap out around sixteen).
 *
 * Characters are rendered into this single shared canvas one at a time and the
 * result is copied into each slot's own 2D canvas. Rendering is event-driven —
 * it happens when the grade, the art, or the slot state actually changes, never
 * on a per-frame ticker.
 *
 * Raw WebGL rather than PIXI: this file then depends on nothing but the browser,
 * so it is immune to PIXI API churn across Foundry releases.
 *
 * The context is a suite Surface (core/gl-surfaces.mjs) with no element and no
 * loop: the canvas never enters the DOM, and a render is an event, so there is
 * nothing to pause and a render is never skipped (a skipped one would leave a
 * slot stale until something else changed). What the registry can do is free
 * the context once the stage has sat unrendered past the Performance policy's
 * limit; the next `prepare()` rebuilds it and re-uploads art on demand. Every
 * prepared handle carries the generation of the context its textures live in,
 * and `draw` refuses one from an older context rather than binding a texture
 * the new context has never seen.
 *
 * The fragment shader is organised as the layer stack in grade-model.mjs. Each
 * layer is its own block, applied in stack order, and each is an exact no-op at
 * its neutral values. The basic-correction block is a line-for-line
 * transcription of `gradePixel`; the browser harness compares the two.
 */

import { loadPixelImage, markTainted } from "./asset.mjs";
import { Surfaces } from "../../../core/gl-surfaces.mjs";
import { LUMA, OKLAB, TONE_RATIO_CAP, GAMUT_STEPS, GAMUT_REACH, GAMUT_KNEE } from "./grade-model.mjs";

// ── Constants, written into the GLSL from the model's own statement of them ──
// A number copied by hand into a shader is a number that drifts; these are
// emitted from grade-model.mjs, so the shader and gradePixel cannot disagree
// about them.

/** A float literal GLSL will accept (always carries a decimal point). */
const f = (n) => {
  const s = String(n);
  return /[.eE]/.test(s) ? s : `${s}.0`;
};

/** A row-major 3×3 as a GLSL mat3, which is column-major. */
const mat3 = (rows) => `mat3(${[0, 1, 2].map((c) => rows.map((r) => f(r[c])).join(", ")).join(", ")})`;

const VERT = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = vec2(a_pos.x * 0.5 + 0.5, 0.5 - a_pos.y * 0.5);
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

export const FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

varying vec2 v_uv;

uniform sampler2D u_art;      // the character art, uploaded premultiplied
uniform float u_intensity;    // master strength, 0..1

// ── Layer 1: basic correction ── (see BASIC_DIALS in grade-model.mjs)
uniform float u_gain;         // exposure, as a linear gain
uniform float u_lift;         // brightness, as a black lift in encoded light
uniform float u_gamma;        // midtone power
uniform float u_contrast;     // S-curve exponent about mid-grey
uniform float u_sat;          // chroma scale
uniform vec2  u_hue;          // (cos, sin) of the hue rotation

const vec3 LUMA = vec3(${LUMA.map(f).join(", ")});

// OKLab — see the note above linearToOklab in grade-model.mjs.
const mat3 OK_TO_LMS = ${mat3(OKLAB.toLms)};
const mat3 OK_TO_LAB = ${mat3(OKLAB.toLab)};
const mat3 OK_FROM_LAB = ${mat3(OKLAB.fromLab)};
const mat3 OK_FROM_LMS = ${mat3(OKLAB.fromLms)};

const float TONE_RATIO_CAP = ${f(TONE_RATIO_CAP)};
const float GAMUT_REACH = ${f(GAMUT_REACH)};
const float GAMUT_KNEE = ${f(GAMUT_KNEE)};

vec3 toLinear(vec3 c) { return pow(max(c, 0.0), vec3(2.2)); }
vec3 toSRGB(vec3 c) { return pow(max(c, 0.0), vec3(1.0 / 2.2)); }
float toLinear1(float c) { return pow(max(c, 0.0), 2.2); }
float toSRGB1(float c) { return pow(max(c, 0.0), 1.0 / 2.2); }

// The art with the upload's premultiply divided back out. Everything below wants
// the colour the artist painted, not that colour faded toward black by its own
// coverage. The floor is a hair under one 8-bit step.
vec4 artAt(vec2 uv) {
  vec4 t = texture2D(u_art, uv);
  return vec4(t.rgb / max(t.a, 0.0039), t.a);
}

// Each step is skipped at its neutral value rather than evaluated there: pow(t,
// 1.0) is exp2(log2(t)) on a GPU and is not exactly t.
float toneCurve(float y) {
  float t = y;
  if (u_lift != 0.0) t = clamp(t + u_lift * (1.0 - t), 0.0, 1.0);
  if (u_gamma != 1.0) t = pow(t, 1.0 / u_gamma);
  if (u_contrast != 1.0) {
    t = clamp(t, 0.0, 1.0);
    t = t < 0.5 ? 0.5 * pow(2.0 * t, u_contrast)
                : 1.0 - 0.5 * pow(2.0 - 2.0 * t, u_contrast);
  }
  return t;
}

// How far toward grey one channel needs pulling to land back in [0, 1].
float fitScale(float x, float Y) {
  if (x > 1.0) return (1.0 - Y) / (x - Y);
  if (x < 0.0) return Y / (Y - x);
  return 1.0;
}

vec3 gamutFit(vec3 c) {
  float Y = dot(c, LUMA);
  if (Y >= 1.0) return vec3(1.0);
  if (Y <= 0.0) return vec3(0.0);
  float k = min(min(fitScale(c.r, Y), fitScale(c.g, Y)), fitScale(c.b, Y));
  if (k >= 1.0) return c;
  return vec3(Y) + (c - vec3(Y)) * k;
}

vec3 linearToOklab(vec3 c) {
  vec3 lms = OK_TO_LMS * max(c, 0.0);
  return OK_TO_LAB * pow(lms, vec3(1.0 / 3.0));
}

vec3 oklabToLinear(vec3 o) {
  vec3 lms = OK_FROM_LAB * o;
  return OK_FROM_LMS * (lms * lms * lms);
}

bool inGamut(vec3 c) {
  return all(greaterThanEqual(c, vec3(0.0))) && all(lessThanEqual(c, vec3(1.0)));
}

// chromaAdjust in grade-model.mjs: rotate and scale the OKLab chroma vector,
// then compress it softly against the most chroma this hue can display.
vec3 chromaAdjust(vec3 c) {
  vec3 lab = linearToOklab(c);
  vec2 ab = vec2(lab.y * u_hue.x - lab.z * u_hue.y, lab.y * u_hue.y + lab.z * u_hue.x) * u_sat;
  if (length(ab) < 1e-7) return clamp(oklabToLinear(vec3(lab.x, 0.0, 0.0)), 0.0, 1.0);

  float lo = 0.0;
  float hi = GAMUT_REACH;
  if (inGamut(oklabToLinear(vec3(lab.x, ab * hi)))) {
    lo = hi;
  } else {
    for (int i = 0; i < ${GAMUT_STEPS}; i++) {
      float mid = (lo + hi) * 0.5;
      if (inGamut(oklabToLinear(vec3(lab.x, ab * mid)))) lo = mid;
      else hi = mid;
    }
  }

  float knee = GAMUT_KNEE * lo;
  float k = 1.0;
  if (k > knee) {
    float width = lo - knee;
    float excess = k - knee;
    k = width > 0.0 ? knee + excess / (1.0 + excess / width) : lo;
  }
  return clamp(oklabToLinear(vec3(lab.x, ab * k)), 0.0, 1.0);
}

vec3 basicCorrection(vec3 lin) {
  vec3 c = lin * u_gain;

  float y = dot(c, LUMA);
  float ye = toSRGB1(y);
  float yt = toneCurve(ye);
  if (yt != ye) {
    float Yt = toLinear1(yt);
    float Yl = toLinear1(ye);
    float r = Yl > 1e-9 ? min(Yt / Yl, TONE_RATIO_CAP) : 0.0;
    c = c * r + vec3(max(Yt - Yl * r, 0.0));
  }

  c = gamutFit(c);

  // Skipped at neutral: the OKLab round trip is not exact, and the identity is.
  if (u_sat != 1.0 || u_hue.x != 1.0 || u_hue.y != 0.0) c = chromaAdjust(c);
  return c;
}

void main() {
  vec4 art = artAt(v_uv);
  if (art.a <= 0.0) { gl_FragColor = vec4(0.0); return; }

  vec3 linIn = toLinear(art.rgb);
  vec3 lin = basicCorrection(linIn);

  // Formed as a difference from the input so an untouched pixel is exactly the
  // input: both encodes come from the same expression and cancel.
  vec3 graded = clamp(art.rgb + (toSRGB(lin) - toSRGB(linIn)), 0.0, 1.0);
  vec3 outc = art.rgb + (graded - art.rgb) * u_intensity;

  // Premultiplied — the context is created with premultipliedAlpha.
  gl_FragColor = vec4(outc * art.a, art.a);
}
`;

/**
 * Every uniform the fragment shader declares, in one list, so the context
 * looks each one up and the check tool can compare the list against the GLSL.
 * A name in the shader and not here holds its initial value forever; a name
 * here and not in the shader is a location of null that every write ignores.
 */
export const UNIFORMS = Object.freeze([
  "art",
  "intensity",
  "gain",
  "lift",
  "gamma",
  "contrast",
  "sat",
  "hue",
]);

/** Longest edge of the render target, before display scaling. Stage art shows at
 *  roughly 40vh, so this only has to beat the tallest viewport that will ever
 *  display it — but on a HiDPI panel that is twice the CSS height, and rendering
 *  below the display size is the one softness the effect cannot hide. */
const BASE_RENDER_DIM = 1280;

/** Hard ceiling. Nothing is gained past this and the upload cost is quadratic. */
const MAX_RENDER_DIM = 2048;

/** Art textures are GPU memory; bounded. */
const TEXTURE_LIMIT = 24;

function renderDim() {
  const dpr = Math.min(2, Math.max(1, globalThis.devicePixelRatio || 1));
  return Math.min(MAX_RENDER_DIM, Math.round(BASE_RENDER_DIM * dpr));
}

/**
 * Downscale oversized art *before* upload rather than letting the GPU do it at
 * sample time.
 *
 * WebGL1 can't mipmap a non-power-of-two texture, so minifying a 4000px portrait
 * into a 1280px render is a single bilinear tap — it samples 4 of every 9 source
 * pixels and drops the rest. On hair, lace and fine outlines that reads as
 * crawling aliasing. The browser's own resampler is a proper filter, and doing
 * it once at decode also cuts the texture to a fraction of the VRAM.
 */
async function fitForUpload(img, maxDim) {
  const nw = img.naturalWidth || img.width || 0;
  const nh = img.naturalHeight || img.height || 0;
  const scale = Math.min(1, maxDim / Math.max(nw, nh, 1));
  if (scale >= 1 || typeof createImageBitmap !== "function") {
    return { source: img, width: nw, height: nh, close: false };
  }
  const width = Math.max(1, Math.round(nw * scale));
  const height = Math.max(1, Math.round(nh * scale));
  try {
    const bitmap = await createImageBitmap(img, {
      resizeWidth: width,
      resizeHeight: height,
      resizeQuality: "high",
    });
    return { source: bitmap, width, height, close: true };
  } catch (_e) {
    // Older engines reject the resize options — upload the element as-is.
    return { source: img, width: nw, height: nh, close: false };
  }
}

export class StageGL {
  /**
   * @param {object} [opts]
   * @param {() => void} [opts.onLost]  Called when the context is lost. The next
   *   `prepare()` builds a fresh one, so the owner only has to ask for another
   *   render — without that, a GPU reset leaves every slot on the CSS fallback
   *   until something unrelated happens to re-render the stage.
   */
  constructor({ onLost = null } = {}) {
    this.canvas = null;
    this.gl = null;
    this.program = null;
    this.uniforms = null;
    this._renderDim = BASE_RENDER_DIM;
    this._artTextures = new Map(); // src → { tex, width, height }
    this._supported = null;
    this._lost = false;
    this._surface = null;
    this._generation = 0; // bumped per context; see the header
    this._onLostCallback = onLost;
    this._onLost = (event) => {
      event.preventDefault();
      this._lost = true;
      this._dropTextures();
      try { this._onLostCallback?.(); } catch (_e) { /* the owner's problem, not the context's */ }
    };
  }

  isSupported() {
    if (this._supported !== null) return this._supported;
    try {
      const probe = document.createElement("canvas");
      const ctx = probe.getContext("webgl") || probe.getContext("experimental-webgl");
      this._supported = !!ctx;
      // The probe is a real context; free it instead of leaving it for the GC.
      try { ctx?.getExtension("WEBGL_lose_context")?.loseContext(); } catch (_e) { /* already gone */ }
    } catch (_e) {
      this._supported = false;
    }
    return this._supported;
  }

  /** Create the context on first real use — never at import or onReady, so a
   *  disabled or unopened stage costs nothing. */
  _ensureContext() {
    if (this.gl && !this._lost) return true;
    if (this._lost) this._freeContext();
    if (!this.isSupported()) return false;

    const canvas = document.createElement("canvas");
    canvas.width = 2;
    canvas.height = 2;

    const opts = {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: true, // we copy out with drawImage after each draw
    };
    const gl = canvas.getContext("webgl", opts) || canvas.getContext("experimental-webgl", opts);
    if (!gl) return false;

    const program = this._buildProgram(gl, VERT, FRAG);
    if (!program) return false;

    canvas.addEventListener("webglcontextlost", this._onLost);

    gl.useProgram(program);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    // Single oversized triangle — no index buffer, no second vertex.
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const posLoc = gl.getAttribLocation(program, "a_pos");
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 0);

    this.canvas = canvas;
    this.gl = gl;
    this.program = program;
    this._lost = false;
    this._buffer = buffer;
    this._generation++;
    if (!this._surface) {
      this._surface = Surfaces.register({
        id: "stage.postfx",
        element: () => null,
        release: () => this._freeContext(),
      });
    }
    // Resolved once per context rather than per render, so the art textures and
    // the viewport can never be sized against different values.
    this._renderDim = renderDim();

    this.uniforms = {};
    for (const name of UNIFORMS) this.uniforms[name] = gl.getUniformLocation(program, `u_${name}`);
    gl.uniform1i(this.uniforms.art, 0);
    return true;
  }

  _buildProgram(gl, vsrc, fsrc) {
    const compile = (type, src) => {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, src);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error("gluniverse | stage postfx shader compile failed:", gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
      }
      return shader;
    };

    const vs = compile(gl.VERTEX_SHADER, vsrc);
    if (!vs) return null;
    const fs = compile(gl.FRAGMENT_SHADER, fsrc);
    if (!fs) {
      gl.deleteShader(vs);
      return null;
    }

    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error("gluniverse | stage postfx program link failed:", gl.getProgramInfoLog(program));
      gl.deleteProgram(program);
      return null;
    }
    return program;
  }

  _touch(map, key) {
    const value = map.get(key);
    if (value === undefined) return undefined;
    map.delete(key);
    map.set(key, value);
    return value;
  }

  _evict(map, deleteTex) {
    while (map.size > TEXTURE_LIMIT) {
      const oldest = map.keys().next().value;
      const value = map.get(oldest);
      map.delete(oldest);
      deleteTex(value);
    }
  }

  /** Upload the character art through the shared loader, which decides once per
   *  asset how (and whether) its pixels can be read. */
  async _artTexture(src) {
    const cached = this._touch(this._artTextures, src);
    if (cached) return cached;

    const gl = this.gl;
    const img = await loadPixelImage(src);
    const fitted = await fitForUpload(img, this._renderDim);
    // Released or lost while decoding: a texture made on that context would be
    // cached into the next one's map and bound there as garbage.
    if (this.gl !== gl || this._lost) {
      if (fitted.close) fitted.source.close();
      return null;
    }

    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    // Premultiplied on upload, divided back out at every sample — see artAt().
    // Bilinear filtering blends whatever is *stored*, and in straight alpha the
    // transparent pixels of a cut-out PNG are almost always rgb 0,0,0.
    // Interpolating against them darkens every texel on the boundary into a
    // black rind that is nowhere in the asset. Premultiplied is the space
    // interpolation is correct in.
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, fitted.source);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (fitted.close) fitted.source.close();

    const entry = { tex, width: fitted.width, height: fitted.height };
    this._artTextures.set(src, entry);
    this._evict(this._artTextures, (v) => gl.deleteTexture(v.tex));
    return entry;
  }

  /**
   * Get everything one character needs onto the GPU.
   *
   * Split from {@link draw} deliberately. Uploading art is asynchronous — it may
   * still have to be fetched and decoded — and the draw target is shared by
   * every slot, so the two must not be one call: an `await` between a draw and
   * the copy-out is enough to hand one character's pixels to another. Everything
   * that can suspend lives here; everything that touches the shared canvas lives
   * in `draw`.
   *
   * @returns {Promise<object|null>} A handle for `draw`, or null when grading
   *                                 isn't possible.
   */
  async prepare(src) {
    if (!src) return null;
    // Rebuilds a released context. The visibility answer is ignored on purpose:
    // there is no loop to catch up on a skipped render.
    this._surface?.use();
    if (!this._ensureContext()) return null;
    const generation = this._generation;

    let art;
    try {
      art = await this._artTexture(src);
    } catch (err) {
      // `texImage2D` rejects a tainted image the same way `getImageData` does.
      // Record it so the next render goes straight to the fallback.
      if (err?.name === "SecurityError") markTainted(src);
      return null;
    }
    // The context can be lost (or released) while the art texture is in flight.
    if (!art || !this.gl || this._lost || this._generation !== generation) return null;

    return { generation, src, art };
  }

  /**
   * Grade one prepared character and return the shared canvas holding the
   * result. The caller must copy it out *before returning to the event loop* —
   * not merely before the next `draw`.
   *
   * Synchronous on purpose, and it has to stay that way. One canvas serves every
   * slot, so the only thing keeping one character's pixels out of another's slot
   * is that nothing else gets a turn between this draw and that copy.
   *
   * @param {object} prepared  From `prepare`.
   * @param {object} params    `{ intensity }` plus the fields of `basicParams`.
   * @returns {HTMLCanvasElement|null} null when grading isn't possible.
   */
  draw(prepared, params) {
    if (!prepared || !this.gl || this._lost || prepared.generation !== this._generation) return null;
    this._surface?.touch();

    const gl = this.gl;
    const { art } = prepared;

    const scale = Math.min(1, this._renderDim / Math.max(art.width, art.height, 1));
    const width = Math.max(1, Math.round(art.width * scale));
    const height = Math.max(1, Math.round(art.height * scale));

    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    gl.viewport(0, 0, width, height);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, art.tex);

    const u = this.uniforms;
    gl.uniform1f(u.intensity, params.intensity);
    gl.uniform1f(u.gain, params.gain);
    gl.uniform1f(u.lift, params.lift);
    gl.uniform1f(u.gamma, params.gamma);
    gl.uniform1f(u.contrast, params.contrast);
    gl.uniform1f(u.sat, params.sat);
    gl.uniform2f(u.hue, params.hueCos, params.hueSin);

    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    return this.canvas;
  }

  _dropTextures() {
    const gl = this.gl;
    if (gl) {
      for (const entry of this._artTextures.values()) gl.deleteTexture(entry.tex);
    }
    this._artTextures.clear();
  }

  /** Drop one asset's GPU copy — used when an actor's image changes. */
  invalidate(src) {
    const art = this._artTextures.get(src);
    if (art) {
      this.gl?.deleteTexture(art.tex);
      this._artTextures.delete(src);
    }
  }

  /** Release the context. Without this a module reload leaks one per cycle. */
  destroy() {
    this._freeContext();
    this._surface?.dispose();
    this._surface = null;
  }

  /** Free the context and every texture in it. Rebuildable: the next
   *  `prepare()` makes a new one. Also the surface registry's release. */
  _freeContext() {
    const gl = this.gl;
    this._dropTextures();
    if (gl) {
      if (this._buffer) gl.deleteBuffer(this._buffer);
      if (this.program) gl.deleteProgram(this.program);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    }
    this.canvas?.removeEventListener("webglcontextlost", this._onLost);
    this.canvas = null;
    this.gl = null;
    this.program = null;
    this.uniforms = null;
    this._buffer = null;
    this._lost = false;
  }
}
