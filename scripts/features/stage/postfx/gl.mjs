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
 * its neutral values. The whole pass is a line-for-line transcription of
 * `shadePixel` in grade-model.mjs; the browser harness compares the two.
 */

import { loadPixelImage, markTainted } from "./asset.mjs";
import { Surfaces } from "../../../core/gl-surfaces.mjs";
import {
  LUMA,
  OKLAB,
  TONE_RATIO_CAP,
  GAMUT_STEPS,
  GAMUT_REACH,
  GAMUT_KNEE,
  SKIN_CENTRE,
  SKIN_RADIUS,
  RIM_TAPS,
  RIM_GAIN,
  GLOW_KNEE,
  GLOW_GAIN,
  DOWN_TAPS,
  bloomSizes,
  bloomWeights,
} from "./grade-model.mjs";

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

// ── The scene light ── (shared by every layer with a direction)
uniform float u_aspect;       // art width / height, so directions are isotropic
uniform vec2  u_lightDir;     // unit vector toward the light, image space (+Y down)
uniform float u_lightSoft;    // falloff half-width, in units of the art's half-extent

// ── Layer 2: gradient ──
uniform float u_gradAmount;   // 0..1
uniform vec3  u_gradColor;    // the light's colour, encoded

// ── Layer 3: wash ──
uniform float u_washAmount;   // 0..1
uniform vec3  u_washCast;     // the room's colour at unit luminance, linear
uniform float u_darkGain;     // level from the scene's darkness, 1 = untouched

// ── Layer 4: rim ──
uniform float u_rimAmount;    // 0..1
uniform vec2  u_rimOffset;    // the silhouette's shift toward the light, uv
uniform vec2  u_rimRadius;    // the shifted silhouette's blur radius, uv
uniform vec3  u_rimColor;     // encoded

// ── Layer 5: back shadow ──
uniform float u_backAmount;   // how far the far side darkens, 0..BACK_SHADOW_MAX

// ── Layer 6: glow ──
uniform float u_glowAmount;   // 0..1
uniform sampler2D u_bloom;    // the finished bloom pyramid, premultiplied

uniform float u_skin;         // how hard skin holds back colour changes, 0..1

const vec3 LUMA = vec3(${LUMA.map(f).join(", ")});

// OKLab — see the note above linearToOklab in grade-model.mjs.
const mat3 OK_TO_LMS = ${mat3(OKLAB.toLms)};
const mat3 OK_TO_LAB = ${mat3(OKLAB.toLab)};
const mat3 OK_FROM_LAB = ${mat3(OKLAB.fromLab)};
const mat3 OK_FROM_LMS = ${mat3(OKLAB.fromLms)};

const float TONE_RATIO_CAP = ${f(TONE_RATIO_CAP)};
const float GAMUT_REACH = ${f(GAMUT_REACH)};
const float GAMUT_KNEE = ${f(GAMUT_KNEE)};
const float RIM_GAIN = ${f(RIM_GAIN)};
const float GLOW_GAIN = ${f(GLOW_GAIN)};
const vec2 SKIN_CENTRE = vec2(${SKIN_CENTRE.map(f).join(", ")});
const vec2 SKIN_RADIUS = vec2(${SKIN_RADIUS.map(f).join(", ")});

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

// skinMask in grade-model.mjs — on the original art's encoded colour.
float skinMask(vec3 srgb) {
  float cb = -0.169 * srgb.r - 0.331 * srgb.g + 0.5 * srgb.b + 0.5;
  float cr = 0.5 * srgb.r - 0.419 * srgb.g - 0.081 * srgb.b + 0.5;
  float d = length((vec2(cb, cr) - SKIN_CENTRE) / SKIN_RADIUS);
  float inside = 1.0 - smoothstep(0.7, 1.3, d);
  float l = dot(srgb, LUMA);
  return inside * smoothstep(0.06, 0.18, l) * (1.0 - smoothstep(0.86, 0.98, l));
}

// guardSkin: keep the layer's change of level, hold back its change of colour.
vec3 guardSkin(vec3 before, vec3 after, float k) {
  if (k <= 0.0) return after;
  float Yb = dot(before, LUMA);
  if (Yb <= 1e-9) return after;
  float r = dot(after, LUMA) / Yb;
  return after + (before * r - after) * k;
}

// litWeight: 1 on the lit side of the art, 0 on the far side.
float litWeight(vec2 uv) {
  vec2 p = vec2((uv.x - 0.5) * u_aspect, uv.y - 0.5);
  float half_ = 0.5 * (abs(u_lightDir.x) * u_aspect + abs(u_lightDir.y));
  float t = dot(p, u_lightDir) / max(half_, 1e-6);
  return smoothstep(-u_lightSoft, u_lightSoft, t);
}

// ringAlpha / rimMask in grade-model.mjs: the blurred silhouette here, minus
// the blurred silhouette shifted toward the light — the edge that faces it.
float ringAlpha(vec2 c) {
  float sum = texture2D(u_art, c).a;
  for (int i = 0; i < ${RIM_TAPS}; i++) {
    float a = float(i) * 6.283185307179586 / ${f(RIM_TAPS)};
    sum += texture2D(u_art, c + vec2(cos(a), sin(a)) * u_rimRadius).a;
  }
  return sum / ${f(RIM_TAPS + 1)};
}

float rimMask(vec2 uv, float alpha) {
  float here = ringAlpha(uv);
  float shifted = ringAlpha(uv + u_rimOffset);
  return alpha * clamp((here - shifted) * RIM_GAIN, 0.0, 1.0);
}

vec3 screen(vec3 b, vec3 s) {
  return vec3(1.0) - (vec3(1.0) - b) * (vec3(1.0) - s);
}

// glowFrom in grade-model.mjs: the finished bloom, scaled, dimmed by the
// room's darkness like everything else the light does.
vec3 glowAt(vec2 uv) {
  return clamp(texture2D(u_bloom, uv).rgb * (u_glowAmount * GLOW_GAIN * u_darkGain), 0.0, 1.0);
}

// W3C soft-light, on encoded values.
float softLight1(float b, float s) {
  if (s <= 0.5) return b - (1.0 - 2.0 * s) * b * (1.0 - b);
  float d = b <= 0.25 ? ((16.0 * b - 12.0) * b + 4.0) * b : sqrt(b);
  return b + (2.0 * s - 1.0) * (d - b);
}

vec3 softLight(vec3 b, vec3 s) {
  return vec3(softLight1(b.r, s.r), softLight1(b.g, s.g), softLight1(b.b, s.b));
}

void main() {
  vec4 art = artAt(v_uv);

  // ── Layer 6: glow ── computed first, because it is the one layer that draws
  // outside the art's coverage.
  vec3 G = vec3(0.0);
  bool glowing = u_glowAmount > 0.0;
  if (glowing) G = glowAt(v_uv);

  if (art.a <= 0.0) {
    // Premultiplied emission: colour G at coverage max(G), whose premultiplied
    // value is G itself. Zero, exactly, whenever the glow is off.
    float ga = max(max(G.r, G.g), G.b);
    gl_FragColor = glowing ? vec4(G, ga) * u_intensity : vec4(0.0);
    return;
  }

  vec3 linIn = toLinear(art.rgb);
  float guard = u_skin * skinMask(art.rgb);

  // ── Layer 1: basic correction ──
  vec3 lin = basicCorrection(linIn);

  // ── Layer 2: gradient ──
  if (u_gradAmount > 0.0) {
    float w = u_gradAmount * litWeight(v_uv);
    if (w > 0.0) {
      vec3 e = toSRGB(lin);
      vec3 lit = e + (softLight(clamp(e, 0.0, 1.0), u_gradColor) - e) * w;
      lin = guardSkin(lin, toLinear(lit), guard);
    }
  }

  // ── Layer 3: wash ──
  if (u_washAmount > 0.0) {
    lin = guardSkin(lin, lin * (vec3(1.0) + (u_washCast - vec3(1.0)) * u_washAmount), guard);
  }
  if (u_darkGain != 1.0) lin *= u_darkGain;

  // ── Layer 4: rim ──
  if (u_rimAmount > 0.0) {
    float w = u_rimAmount * rimMask(v_uv, art.a);
    if (w > 0.0) {
      vec3 e = toSRGB(lin);
      lin = toLinear(e + (screen(clamp(e, 0.0, 1.0), u_rimColor) - e) * w);
    }
  }

  // ── Layer 5: back shadow ──
  if (u_backAmount > 0.0) {
    float k = 1.0 - u_backAmount * (1.0 - litWeight(v_uv));
    if (k != 1.0) lin *= k;
  }

  lin = gamutFit(lin);

  // Formed as a difference from the input so an untouched pixel is exactly the
  // input: both encodes come from the same expression and cancel.
  vec3 graded = clamp(art.rgb + (toSRGB(lin) - toSRGB(linIn)), 0.0, 1.0);
  if (glowing) graded = screen(clamp(graded, 0.0, 1.0), G);
  vec3 outc = art.rgb + (graded - art.rgb) * u_intensity;

  // On a partly covered edge pixel the glow also lands on what is behind it.
  if (glowing && art.a < 1.0) {
    float ga = max(max(G.r, G.g), G.b) * u_intensity;
    gl_FragColor = vec4(outc * art.a + G * u_intensity * (1.0 - art.a), art.a + ga * (1.0 - art.a));
    return;
  }

  // Premultiplied — the context is created with premultipliedAlpha.
  gl_FragColor = vec4(outc * art.a, art.a);
}
`;

// ── The bloom pyramid ── (see "Bloom" in grade-model.mjs)

const PRECISION = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
`;

/**
 * The bloom passes' vertex shader. Unlike the main pass it does not flip Y:
 * a render target stores its rows bottom-up, so a pass that wrote at the
 * flipped coordinate would mirror the image, and every pass after it would
 * mirror it back. Kept unflipped, every level holds image row y at texture
 * coordinate y — the same convention as the art texture, which is what lets the
 * main pass sample the finished bloom at its own v_uv.
 */
const BLOOM_VERT = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

/** Down: the four-tap box; on the first level, the bright pass per tap. */
export const BLOOM_DOWN_FRAG = `${PRECISION}
varying vec2 v_uv;
uniform sampler2D u_src;
uniform vec2  u_srcTexel;     // one texel of the source, uv
uniform float u_bright;       // 1 on the first level: apply the bright pass
uniform float u_threshold;

const vec3 LUMA = vec3(${LUMA.map(f).join(", ")});
const float GLOW_KNEE = ${f(GLOW_KNEE)};

vec4 tap(vec2 uv) {
  vec4 t = texture2D(u_src, uv);
  if (u_bright < 0.5) return t;
  vec3 c = t.rgb / max(t.a, 0.0039);
  float k = smoothstep(u_threshold, u_threshold + GLOW_KNEE, dot(c, LUMA)) * t.a;
  return vec4(c * k, k);
}

void main() {
  gl_FragColor = 0.25 * (
${DOWN_TAPS.map(([x, y]) => `      tap(v_uv + vec2(${f(x)}, ${f(y)}) * u_srcTexel)`).join(" +\n")});
}
`;

/** Up: this level mixed toward a 3×3 tent of the level below. */
export const BLOOM_UP_FRAG = `${PRECISION}
varying vec2 v_uv;
uniform sampler2D u_fine;
uniform sampler2D u_coarse;
uniform vec2  u_coarseTexel;  // one texel of the coarser level, uv
uniform float u_weight;       // bloomWeights for this level

void main() {
  vec4 tent = vec4(0.0);
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      float w = (i == 0 ? 2.0 : 1.0) * (j == 0 ? 2.0 : 1.0) / 16.0;
      tent += texture2D(u_coarse, v_uv + vec2(float(i), float(j)) * u_coarseTexel) * w;
    }
  }
  vec4 fine = texture2D(u_fine, v_uv);
  gl_FragColor = fine + (tent - fine) * u_weight;
}
`;

export const BLOOM_DOWN_UNIFORMS = Object.freeze(["src", "srcTexel", "bright", "threshold"]);
export const BLOOM_UP_UNIFORMS = Object.freeze(["fine", "coarse", "coarseTexel", "weight"]);

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
  "aspect",
  "lightDir",
  "gradAmount",
  "gradColor",
  "washAmount",
  "washCast",
  "darkGain",
  "lightSoft",
  "rimAmount",
  "rimOffset",
  "rimRadius",
  "rimColor",
  "backAmount",
  "glowAmount",
  "bloom",
  "skin",
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
  constructor({ onLost = null, bloomFormat = "auto" } = {}) {
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
    // "auto" renders the bloom in half float where the GPU can, 8-bit
    // otherwise; "u8" forces 8-bit, which the harness uses to read it back.
    this._bloomFormat = bloomFormat === "u8" ? "u8" : "auto";
    this._bloom = null; // { key, type, levels: [{ w, h, down, up }] }
    this._blank = null; // 1×1 transparent texture for u_bloom when not glowing
    this._onLost = (event) => {
      event.preventDefault();
      this._lost = true;
      this._dropTextures();
      this._bloom = null;
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
    const downProgram = this._buildProgram(gl, BLOOM_VERT, BLOOM_DOWN_FRAG);
    const upProgram = this._buildProgram(gl, BLOOM_VERT, BLOOM_UP_FRAG);
    if (!downProgram || !upProgram) return false;

    canvas.addEventListener("webglcontextlost", this._onLost);

    gl.useProgram(program);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    // Single oversized triangle — no index buffer, no second vertex.
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

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
    gl.uniform1i(this.uniforms.bloom, 1);

    this._down = { program: downProgram, u: {} };
    for (const name of BLOOM_DOWN_UNIFORMS) this._down.u[name] = gl.getUniformLocation(downProgram, `u_${name}`);
    this._up = { program: upProgram, u: {} };
    for (const name of BLOOM_UP_UNIFORMS) this._up.u[name] = gl.getUniformLocation(upProgram, `u_${name}`);
    gl.useProgram(downProgram);
    gl.uniform1i(this._down.u.src, 0);
    gl.useProgram(upProgram);
    gl.uniform1i(this._up.u.fine, 0);
    gl.uniform1i(this._up.u.coarse, 1);
    gl.useProgram(program);

    this._blank = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this._blank);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    this._bloomType = this._pickBloomType(gl);
    return true;
  }

  /**
   * Half float where the GPU can render to it and filter it, 8-bit otherwise.
   * 8-bit works — the pyramid never leaves 0..1 — but a wide soft glow bands in
   * it, so it is the fallback, not the choice.
   */
  _pickBloomType(gl) {
    if (this._bloomFormat === "u8") return gl.UNSIGNED_BYTE;
    const half = gl.getExtension("OES_texture_half_float");
    const linear = gl.getExtension("OES_texture_half_float_linear");
    if (!half || !linear) return gl.UNSIGNED_BYTE;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 4, 4, 0, gl.RGBA, half.HALF_FLOAT_OES, null);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fbo);
    gl.deleteTexture(tex);
    return ok ? half.HALF_FLOAT_OES : gl.UNSIGNED_BYTE;
  }

  /** A render target: a linearly filtered, edge-clamped texture and its FBO. */
  _target(gl, w, h) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, this._bloomType, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return { tex, fbo };
  }

  /** The pyramid's targets for art of this size, reused while the size holds. */
  _bloomTargets(gl, width, height) {
    const key = `${width}x${height}`;
    if (this._bloom?.key === key) return this._bloom;
    this._dropBloom();
    const levels = bloomSizes(width, height).map(([w, h]) => ({
      w,
      h,
      down: this._target(gl, w, h),
      up: this._target(gl, w, h),
    }));
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this._bloom = { key, levels };
    return this._bloom;
  }

  _dropBloom() {
    const gl = this.gl;
    if (gl && this._bloom) {
      for (const level of this._bloom.levels) {
        for (const t of [level.down, level.up]) {
          gl.deleteFramebuffer(t.fbo);
          gl.deleteTexture(t.tex);
        }
      }
    }
    this._bloom = null;
  }

  /**
   * Run the pyramid for one piece of art. Synchronous, like the draw it is
   * part of. Returns the texture holding the finished bloom.
   */
  _renderBloom(gl, art, params) {
    const pyr = this._bloomTargets(gl, art.width, art.height);
    const { levels } = pyr;

    const d = this._down;
    gl.useProgram(d.program);
    gl.uniform1f(d.u.threshold, params.glowThreshold);
    gl.activeTexture(gl.TEXTURE0);
    let srcTex = art.tex;
    let srcW = art.width;
    let srcH = art.height;
    levels.forEach((level, i) => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, level.down.fbo);
      gl.viewport(0, 0, level.w, level.h);
      gl.bindTexture(gl.TEXTURE_2D, srcTex);
      gl.uniform2f(d.u.srcTexel, 1 / srcW, 1 / srcH);
      gl.uniform1f(d.u.bright, i === 0 ? 1 : 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      srcTex = level.down.tex;
      srcW = level.w;
      srcH = level.h;
    });

    const weights = bloomWeights(levels.length, params.glowSpread);
    const u = this._up;
    gl.useProgram(u.program);
    let coarse = levels[levels.length - 1];
    let coarseTex = coarse.down.tex;
    for (let i = levels.length - 2; i >= 0; i--) {
      const level = levels[i];
      gl.bindFramebuffer(gl.FRAMEBUFFER, level.up.fbo);
      gl.viewport(0, 0, level.w, level.h);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, level.down.tex);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, coarseTex);
      gl.uniform2f(u.u.coarseTexel, 1 / coarse.w, 1 / coarse.h);
      gl.uniform1f(u.u.weight, weights[i]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      coarse = level;
      coarseTex = level.up.tex;
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.useProgram(this.program);
    return levels.length > 1 ? levels[0].up.tex : levels[0].down.tex;
  }

  /**
   * The finished bloom of the last draw, read back as a premultiplied float
   * image. For the browser harness only, and only for a context made with
   * `bloomFormat: "u8"` — WebGL1 cannot read a half-float target back.
   */
  readBloom() {
    const gl = this.gl;
    if (!gl || !this._bloom || this._bloomType !== gl.UNSIGNED_BYTE) return null;
    const { levels } = this._bloom;
    const level = levels[0];
    const target = levels.length > 1 ? level.up : level.down;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    const bytes = new Uint8Array(level.w * level.h * 4);
    gl.readPixels(0, 0, level.w, level.h, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const data = new Float32Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) data[i] = bytes[i] / 255;
    return { width: level.w, height: level.h, data };
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
    // Every program draws the same triangle from attribute 0.
    gl.bindAttribLocation(program, 0, "a_pos");
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
   * @param {object} params    `{ intensity }` plus the fields of `stackParams`.
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
    // The bloom renders into its own targets first; the main pass then reads it.
    const bloomTex = params.glowAmount > 0 ? this._renderBloom(gl, art, params) : this._blank;

    gl.viewport(0, 0, width, height);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, bloomTex);
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
    gl.uniform1f(u.aspect, params.aspect);
    gl.uniform2fv(u.lightDir, params.lightDir);
    gl.uniform1f(u.gradAmount, params.gradAmount);
    gl.uniform1f(u.lightSoft, params.lightSoft);
    gl.uniform3fv(u.gradColor, params.gradColor);
    gl.uniform1f(u.washAmount, params.washAmount);
    gl.uniform3fv(u.washCast, params.washCast);
    gl.uniform1f(u.darkGain, params.darkGain);
    gl.uniform1f(u.rimAmount, params.rimAmount);
    gl.uniform2fv(u.rimOffset, params.rimOffset);
    gl.uniform2fv(u.rimRadius, params.rimRadius);
    gl.uniform3fv(u.rimColor, params.rimColor);
    gl.uniform1f(u.backAmount, params.backAmount);
    gl.uniform1f(u.glowAmount, params.glowAmount);
    gl.uniform1f(u.skin, params.skin);

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
    this._dropBloom();
    if (gl) {
      if (this._buffer) gl.deleteBuffer(this._buffer);
      if (this.program) gl.deleteProgram(this.program);
      if (this._down) gl.deleteProgram(this._down.program);
      if (this._up) gl.deleteProgram(this._up.program);
      if (this._blank) gl.deleteTexture(this._blank);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    }
    this.canvas?.removeEventListener("webglcontextlost", this._onLost);
    this.canvas = null;
    this.gl = null;
    this.program = null;
    this.uniforms = null;
    this._down = null;
    this._up = null;
    this._blank = null;
    this._buffer = null;
    this._lost = false;
  }
}
