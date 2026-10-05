/**
 * Theatre — the shot layer.
 *
 * PURE: PIXI is injected and nothing here reads `game`, `canvas`, `foundry`,
 * `ui` or `Hooks`. The host (../host.mjs) decides which scene, which shot and
 * when; the preview page drives this exact module with a bare PIXI.
 *
 * One quad covering the frame (the scene rect, in frame px from 0,0), drawn by
 * ONE fragment shader holding two sides — A (what is on screen) and B (what is
 * arriving). Per frame the JS works out, for each side, where its image sits
 * (cover-fit about the shot's focus, times the transition's own scale) and its Treatment, and the shader mixes the two by
 * the transition mode:
 *
 *   swap  — B replaces A at the beat (hidden behind the overlay's black / bars)
 *   push  — B dissolves in from 1.14× with a brief soft bloom; A eases back to 0.96×
 *   wipe  — a soft diagonal edge sweeps B across; A dims to 0.55
 *   cut   — a short linear crossfade
 *   none  — the image does not change
 *
 * Between cues the camera SHAKES: a slow handheld sway of both sides together,
 * the picture scaled about the frame centre just enough that the sway never
 * shows an edge (see SHAKE). It moves the picture inside the frame only, never
 * the backdrop around a fitted one. The strength eases toward its target, and
 * the sway's speed rides on the eased strength, so it always starts slow and
 * small. Its clock is a phase integrated each frame, so a change of speed never
 * jumps the picture, and it holds still (rather than easing out) when ambient
 * motion is paused or the shake is shed.
 *
 * Every time comes from the timeline (../timeline.mjs) the caller passes in,
 * already scaled by the motion scale. The constants below are SHAPES (scales,
 * easings, the bloom's size), never durations — except the shake's ease, which
 * is TIMING.shakeEase from constants.mjs.
 *
 * NEUTRAL_TREATMENT is an exact no-op: each grade step is skipped at its
 * neutral value rather than evaluated (x * 1.0 is exact, but `l + (c - l) * 1.0`
 * is not, and a one-tap "blur" is not a texture read). A side with no blur reads
 * its texture once, exactly where an unshaded sprite would.
 *
 * The BACKDROP is a second, separate mesh (`renderer.backdrop`) for a viewer whose
 * view reaches past the frame — Fit framing, or a GM zoomed out. It is the same
 * two sides under the same mix (and the same wipe line), each cover-fitted to the
 * whole view rather than the frame, blurred hard and darkened. The host mounts it
 * OUTSIDE canvas.primary, because Foundry masks that group to the scene rect and
 * the backdrop lives exactly where the scene is not.
 *
 * If the shader fails to compile or link, the layer says so in the console
 * and degrades to two plain sprites crossfading (no treatment, no wipe edge).
 * The probe runs on the first render, against the renderer PIXI hands the mesh,
 * so it needs nothing from the host.
 */

import { TIMING } from "../constants.mjs";
import { coverRect, isVideo, normalizeTreatment, resolveShake } from "../model.mjs";

/* ══════════════════════════════════════════════════════════════════════
   Shapes (not durations)
   ══════════════════════════════════════════════════════════════════════ */

/** Behaviours given up under load, cheapest to lose first. Bound to the shared
 *  frame clock by the host with Budget.ladder(). */
export const SHED_ORDER = Object.freeze(["shake", "bloom", "blur", "backdrop"]);

/** The backdrop around a fitted frame: the same picture, blurred and darker. */
export const BACKDROP = Object.freeze({
  gain: 0.55,        // brightness against the frame's own
  blur: 0.035,       // disc radius as a fraction of the view's width
  overscan: 1.08,    // cover-fitted past the view, so the blur never reaches a clamped edge
});

/** Push-in (chapter): the approved mock's numbers. */
export const PUSH = Object.freeze({
  inScale: 1.14,     // B starts this much larger and settles to 1
  outScale: 0.96,    // A eases back to this
  bloomBlur: 0.010,  // B's starting blur, disc radius as a fraction of the frame width (≈ CSS blur(10px) at 1080p)
  bloomGain: 0.3,    // B's starting brightness lift (CSS brightness(1.3))
});

/** Soft diagonal wipe (wipe). */
export const WIPE = Object.freeze({
  angleDeg: 100,     // CSS gradient angle of the mock: sweeping left → right, leaning 10° down
  soft: 0.3,         // the soft edge, as a fraction of the frame's on-screen width…
  minSoftPx: 2,      // …never narrower than this many DEVICE pixels (no aliased hairline)
  dim: 0.55,         // A's brightness at the end of the wipe
});

/**
 * Camera shake. The sway is three sines per axis at unrelated frequencies, so it
 * never visibly repeats; the weights sum to 1, so the offset stays in -1..1.
 */
export const SHAKE = Object.freeze({
  reach: 0.02,       // the furthest the picture travels at strength 1, as a fraction of the frame height
  slow: 0.6,         // sway speed at strength 0 …
  fast: 1.6,         // … and at strength 1 (speed rides on the eased strength)
  x: Object.freeze([[0.071, 0.55, 0.0], [0.153, 0.3, 1.7], [0.317, 0.15, 4.1]]),   // [Hz, weight, phase]
  y: Object.freeze([[0.059, 0.55, 2.3], [0.131, 0.3, 0.6], [0.283, 0.15, 3.3]]),
});

/** The sway at `t` seconds of shake clock: { x, y } in -1..1. */
export function shakeOffset(t) {
  const axis = (terms) => terms.reduce((v, [hz, w, ph]) => v + w * Math.sin(2 * Math.PI * hz * t + ph), 0);
  return { x: axis(SHAKE.x), y: axis(SHAKE.y) };
}

/**
 * The camera at strength `k` and sway `n` for a frame of fw × fh: the scale about
 * the frame centre and the offset, in frame px. The scale leaves exactly the
 * margin the furthest offset needs on the frame's short side (the long side has
 * more), so a covering picture still covers.
 */
export function shakeCamera(k, n, fw, fh) {
  const r = SHAKE.reach * Math.max(0, Math.min(1, Number(k) || 0));
  if (!(r > 0)) return null;
  const reach = r * Math.min(fw, fh);
  return { over: 1 + 2 * r, dx: n.x * reach, dy: n.y * reach };
}

/** Treatment ranges the shader works in. */
export const TREATMENT = Object.freeze({
  blurMax: 0.02,     // blur 1 = a disc this fraction of the frame width
  tapSpacing: 3.5,   // device px between blur taps, for the mip bias
});

/** The vignette's ellipse (matches the mock's radial-gradient). Constants in GLSL. */
export const VIGNETTE = Object.freeze({ cx: 0.5, cy: 0.48, rx: 0.75, ry: 0.70, inner: 0.55 });

/** Blur taps on a golden-angle spiral (plus the centre). */
export const BLUR_TAPS = 12;

/* ══════════════════════════════════════════════════════════════════════
   Pure maths (exported for the check tool)
   ══════════════════════════════════════════════════════════════════════ */

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

/** CSS cubic-bezier(x1, y1, x2, y2) as a function of 0..1. Exact at 0 and 1. */
export function cubicBezier(x1, y1, x2, y2) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const X = (t) => ((ax * t + bx) * t + cx) * t;
  const Y = (t) => ((ay * t + by) * t + cy) * t;
  const dX = (t) => (3 * ax * t + 2 * bx) * t + cx;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) {
      const e = X(t) - x;
      if (Math.abs(e) < 1e-6) return Y(t);
      const d = dX(t);
      if (Math.abs(d) < 1e-6) break;
      t -= e / d;
    }
    let lo = 0, hi = 1;
    t = x;
    for (let i = 0; i < 40; i++) {
      const v = X(t);
      if (Math.abs(v - x) < 1e-6) break;
      if (v < x) lo = t; else hi = t;
      t = (lo + hi) / 2;
    }
    return Y(t);
  };
}

/** The mock's easings: E (expo-ish out) and SHARP (in-out). */
export const EASE = Object.freeze({
  out: cubicBezier(0.16, 1, 0.3, 1),
  sharp: cubicBezier(0.7, 0, 0.1, 1),
  linear: (x) => clamp01(x),
});

/**
 * Where the image beat of a cue stands `t` ms after the cue's start.
 * @param {{mode:string, at:number, dur:number}} image  timeline.image (scaled)
 * @param {number} t
 * @returns {{ mode, started, done, w, scaleA, scaleB, bloomB, dimA, wipe }}
 *   w      — weight of B (0..1); for a wipe, the edge's progress
 *   scaleA / scaleB — the transition's own scale about the frame centre
 *   bloomB — 1..0, the push-in's soft bloom on B
 *   dimA   — A's brightness multiplier
 */
export function imageBeat(image, t) {
  const mode = image?.mode ?? "swap";
  const at = Number(image?.at) || 0, dur = Math.max(0, Number(image?.dur) || 0);
  const out = { mode, started: false, done: false, w: 0, scaleA: 1, scaleB: 1, bloomB: 0, dimA: 1, wipe: false };
  if (mode === "none") { out.started = true; out.done = true; return out; }
  if (t < at) return out;
  out.started = true;
  const raw = dur > 0 ? clamp01((t - at) / dur) : 1;
  out.done = raw >= 1;
  switch (mode) {
    case "push": {
      const e = EASE.out(raw);
      out.w = e;
      out.scaleA = 1 + (PUSH.outScale - 1) * e;
      out.scaleB = PUSH.inScale + (1 - PUSH.inScale) * e;
      out.bloomB = 1 - e;
      break;
    }
    case "wipe": {
      const e = EASE.sharp(raw);
      out.w = e;
      out.wipe = !out.done;
      out.dimA = 1 + (WIPE.dim - 1) * e;
      break;
    }
    case "cut":
      out.w = raw;
      break;
    case "swap":
    default:
      out.w = 1;
      out.done = true;
      break;
  }
  return out;
}

/**
 * A side's image rect in frame px: cover-fit about the focus, then the
 * transition's scale and the shake's (`cam`, from shakeCamera) about the frame
 * centre, then the shake's offset.
 */
export function placeRect(iw, ih, fw, fh, focus, tScale = 1, cam = null) {
  const base = coverRect(iw, ih, fw, fh, focus ?? { x: 0.5, y: 0.5 });
  const cx = fw / 2, cy = fh / 2;
  const s = tScale * (cam?.over ?? 1);
  return {
    x: cx + (base.x - cx) * s + (cam?.dx ?? 0),
    y: cy + (base.y - cy) * s + (cam?.dy ?? 0),
    width: base.width * s,
    height: base.height * s,
  };
}

/** Wipe line in frame px: unit direction and the edge's position at progress p. */
export function wipeLine(p, fw, fh, soft) {
  const a = (WIPE.angleDeg * Math.PI) / 180;
  const dx = Math.sin(a), dy = -Math.cos(a);   // CSS angle: 90deg points right, 180deg down (y down)
  const s = [0, dx * fw, dy * fh, dx * fw + dy * fh];
  const smin = Math.min(...s), smax = Math.max(...s);
  return { dx, dy, edge: (smin - soft / 2) + (smax - smin + soft) * clamp01(p) };
}

/** Exposure (stops) and the transient multipliers as one gain. */
export const gainOf = (exposure, dim = 1, bloom = 0) =>
  (exposure === 0 ? 1 : Math.pow(2, exposure)) * dim * (bloom > 0 ? 1 + PUSH.bloomGain * bloom : 1);

/** Tint colour pre-divided by its own luminance, so a wash keeps the pixel's level. */
export function tintVector(hex) {
  const n = parseInt(String(hex ?? "#000000").slice(1), 16) || 0;
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return l > 1e-3 ? [r / l, g / l, b / l] : [0, 0, 0];
}

/* ══════════════════════════════════════════════════════════════════════
   GLSL
   ══════════════════════════════════════════════════════════════════════ */

const f = (n) => (Number.isInteger(n) ? `${n}.0` : String(n));

export const SHOT_VERT = `
attribute vec2 aVertexPosition;
attribute vec2 aFrame;
uniform mat3 translationMatrix;
uniform mat3 projectionMatrix;
varying vec2 vFrame;
void main() {
  vFrame = aFrame;
  gl_Position = vec4((projectionMatrix * translationMatrix * vec3(aVertexPosition, 1.0)).xy, 0.0, 1.0);
}`;

export const SHOT_FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 vFrame;              // 0..1 across the frame
uniform sampler2D uTexA;          // A: on screen
uniform sampler2D uTexB;          // B: arriving
uniform vec4 uPlaceA;             // image rect in frame-normalised units (x, y, w, h)
uniform vec4 uPlaceB;
uniform vec4 uCropA;              // the texture's frame inside its base texture (uv x, y, w, h)
uniform vec4 uCropB;
uniform vec4 uGradeA;             // gain, saturation, tint amount, vignette
uniform vec4 uGradeB;
uniform vec3 uTintA;              // tint / luma(tint)
uniform vec3 uTintB;
uniform vec3 uBlurA;              // blur radius in image uv (x, y), mip bias
uniform vec3 uBlurB;
uniform vec2 uHas;                // 1 where a side has a texture (A, B)
uniform float uMix;               // weight of B (non-wipe modes)
uniform float uWipe;              // 1 while the weight is the wipe edge
uniform vec3 uWipeLine;           // wipe: unit direction (x, y), edge position — frame px
uniform float uWipeSoft;          // wipe: soft edge width — frame px (floored in device px by the host)
uniform vec2 uSize;               // frame size, frame px

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
const vec2 VIG_C = vec2(${f(VIGNETTE.cx)}, ${f(VIGNETTE.cy)});
const vec2 VIG_R = vec2(${f(VIGNETTE.rx)}, ${f(VIGNETTE.ry)});
const float VIG_IN = ${f(VIGNETTE.inner)};
const float GOLDEN = 2.39996323;

vec3 tap(sampler2D tex, vec2 uv, vec4 crop, float bias) {
  return texture2D(tex, crop.xy + clamp(uv, 0.0, 1.0) * crop.zw, bias).rgb;
}

vec3 shade(sampler2D tex, vec4 place, vec4 crop, vec4 grade, vec3 tint, vec3 blur) {
  vec2 uv = (vFrame - place.xy) / place.zw;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return vec3(0.0);
  vec3 c;
  if (blur.x > 0.0 || blur.y > 0.0) {
    // Golden-angle disc; taps read a mip level matched to their spacing, so the
    // disc is filled rather than drawn as ${BLUR_TAPS} ghost copies.
    c = tap(tex, uv, crop, blur.z);
    for (int i = 1; i <= ${BLUR_TAPS}; i++) {
      float fi = float(i);
      float r = sqrt(fi / ${f(BLUR_TAPS)});
      float a = fi * GOLDEN;
      c += tap(tex, uv + vec2(cos(a), sin(a)) * r * blur.xy, crop, blur.z);
    }
    c /= ${f(BLUR_TAPS + 1)};
  } else {
    c = texture2D(tex, crop.xy + uv * crop.zw).rgb;
  }
  // Each step is skipped at neutral: NEUTRAL_TREATMENT is bit-exact.
  if (grade.x != 1.0) c *= grade.x;
  if (grade.y != 1.0) { float l = dot(c, LUMA); c = max(vec3(l) + (c - vec3(l)) * grade.y, 0.0); }
  if (grade.z > 0.0) c = mix(c, tint * dot(c, LUMA), grade.z);
  if (grade.w > 0.0) c *= 1.0 - grade.w * smoothstep(VIG_IN, 1.0, length((vFrame - VIG_C) / VIG_R));
  return c;
}

void main() {
  float w = uMix;
  if (uWipe > 0.5) {
    float s = dot(vFrame * uSize, uWipeLine.xy);
    w = 1.0 - smoothstep(uWipeLine.z - 0.5 * uWipeSoft, uWipeLine.z + 0.5 * uWipeSoft, s);
  }
  vec3 a = vec3(0.0);
  vec3 b = vec3(0.0);
  if (w < 1.0 && uHas.x > 0.5) a = shade(uTexA, uPlaceA, uCropA, uGradeA, uTintA, uBlurA);
  if (w > 0.0 && uHas.y > 0.5) b = shade(uTexB, uPlaceB, uCropB, uGradeB, uTintB, uBlurB);
  vec3 col = w <= 0.0 ? a : (w >= 1.0 ? b : mix(a, b, w));
  gl_FragColor = vec4(col, 1.0);
}`;

/** Every uniform the fragment program declares (the host writes all of them). */
export const SHOT_UNIFORMS = Object.freeze([
  "uTexA", "uTexB", "uPlaceA", "uPlaceB", "uCropA", "uCropB", "uGradeA", "uGradeB",
  "uTintA", "uTintB", "uBlurA", "uBlurB", "uHas", "uMix", "uWipe", "uWipeLine", "uWipeSoft", "uSize",
]);

export const BACK_FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 vFrame;              // frame-normalised: 0..1 is the frame, the view reaches past it
uniform sampler2D uTexA;
uniform sampler2D uTexB;
uniform vec4 uPlaceA;             // image rect in frame-normalised units, cover-fitted to the VIEW
uniform vec4 uPlaceB;
uniform vec4 uCropA;
uniform vec4 uCropB;
uniform vec3 uGradeA;             // gain (already darkened), saturation, tint amount
uniform vec3 uGradeB;
uniform vec3 uTintA;
uniform vec3 uTintB;
uniform vec3 uBlurA;              // blur radius in image uv (x, y), mip bias
uniform vec3 uBlurB;
uniform vec2 uHas;
uniform float uMix;
uniform float uWipe;
uniform vec3 uWipeLine;
uniform float uWipeSoft;
uniform vec2 uSize;
uniform float uTaps;              // 1: the full disc; 0: one tap at a deep mip (shed)

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
const float GOLDEN = 2.39996323;

vec3 tap(sampler2D tex, vec2 uv, vec4 crop, float bias) {
  return texture2D(tex, crop.xy + clamp(uv, 0.0, 1.0) * crop.zw, bias).rgb;
}

vec3 shade(sampler2D tex, vec4 place, vec4 crop, vec3 grade, vec3 tint, vec3 blur) {
  vec2 uv = (vFrame - place.xy) / place.zw;
  vec3 c = tap(tex, uv, crop, blur.z);
  if (uTaps > 0.5) {
    for (int i = 1; i <= ${BLUR_TAPS}; i++) {
      float fi = float(i);
      float r = sqrt(fi / ${f(BLUR_TAPS)});
      float a = fi * GOLDEN;
      c += tap(tex, uv + vec2(cos(a), sin(a)) * r * blur.xy, crop, blur.z);
    }
    c /= ${f(BLUR_TAPS + 1)};
  }
  c *= grade.x;
  if (grade.y != 1.0) { float l = dot(c, LUMA); c = max(vec3(l) + (c - vec3(l)) * grade.y, 0.0); }
  if (grade.z > 0.0) c = mix(c, tint * dot(c, LUMA), grade.z);
  return c;
}

void main() {
  float w = uMix;
  if (uWipe > 0.5) {
    float s = dot(vFrame * uSize, uWipeLine.xy);
    w = 1.0 - smoothstep(uWipeLine.z - 0.5 * uWipeSoft, uWipeLine.z + 0.5 * uWipeSoft, s);
  }
  vec3 a = vec3(0.0);
  vec3 b = vec3(0.0);
  if (w < 1.0 && uHas.x > 0.5) a = shade(uTexA, uPlaceA, uCropA, uGradeA, uTintA, uBlurA);
  if (w > 0.0 && uHas.y > 0.5) b = shade(uTexB, uPlaceB, uCropB, uGradeB, uTintB, uBlurB);
  vec3 col = w <= 0.0 ? a : (w >= 1.0 ? b : mix(a, b, w));
  gl_FragColor = vec4(col, 1.0);
}`;

/** Every uniform the backdrop program declares (the renderer writes all of them). */
export const BACK_UNIFORMS = Object.freeze([...SHOT_UNIFORMS, "uTaps"]);

/**
 * The backdrop's image rect for an image of iw×ih, cover-fitted (with overscan)
 * to the view rect `v`, in frame px.
 */
export function backdropRect(iw, ih, v, focus) {
  const k = BACKDROP.overscan;
  const bw = v.width * k, bh = v.height * k;
  const r = coverRect(iw, ih, bw, bh, focus ?? { x: 0.5, y: 0.5 });
  return { x: v.x - (bw - v.width) / 2 + r.x, y: v.y - (bh - v.height) / 2 + r.y, width: r.width, height: r.height };
}

/** True when the view rect (frame px) shows anything past the frame. */
export const viewOverhangs = (v, W, H, eps = 0.5) =>
  !!v && (v.x < -eps || v.y < -eps || v.x + v.width > W + eps || v.y + v.height > H + eps);

/**
 * Compile and link the program on `gl` without touching PIXI's state.
 * @returns {{ ok: boolean, log: string }}
 */
export function probeProgram(gl, vert = SHOT_VERT, frag = SHOT_FRAG) {
  if (!gl?.createShader) return { ok: true, log: "" };
  const made = [];
  const compile = (type, src) => {
    const sh = gl.createShader(type);
    made.push(sh);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    return gl.getShaderParameter(sh, gl.COMPILE_STATUS) ? "" : String(gl.getShaderInfoLog(sh) || "compile failed");
  };
  let log = compile(gl.VERTEX_SHADER, `precision highp float;\n${vert}`) + compile(gl.FRAGMENT_SHADER, frag);
  let prog = null;
  if (!log) {
    prog = gl.createProgram();
    for (const sh of made) gl.attachShader(prog, sh);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) log = String(gl.getProgramInfoLog(prog) || "link failed");
  }
  if (gl.isContextLost?.()) log = "";   // a lost context reports failure for everything; not our shader
  for (const sh of made) gl.deleteShader(sh);
  if (prog) gl.deleteProgram(prog);
  return { ok: !log, log };
}

/* ══════════════════════════════════════════════════════════════════════
   The renderer
   ══════════════════════════════════════════════════════════════════════ */

/** One side of the mix: a shot and its texture. */
function makeSide(shot) {
  return {
    shot: shot ?? null,
    src: shot?.src ?? "",
    treatment: normalizeTreatment(shot?.treatment),
    focus: shot?.focus ?? { x: 0.5, y: 0.5 },
  };
}

export class ShotRenderer {
  /**
   * @param {typeof import("pixi.js")} PIXI
   * @param {object} o
   * @param {number} o.width   frame width (scene rect), frame px
   * @param {number} o.height  frame height
   * @param {(src:string) => Promise<any>} [o.loadTexture]  image loader (the host passes Foundry's,
   *        which shares its cache and handles S3/CORS). Videos are always loaded here.
   * @param {(...a:any[]) => void} [o.warn]
   * @param {number} [o.resolution]  device px per CSS px of the PIXI renderer
   */
  constructor(PIXI, { width, height, loadTexture = null, warn = null, resolution = 1 } = {}) {
    this.PIXI = PIXI;
    this.width = width;
    this.height = height;
    this._loadImage = loadTexture;
    this._warn = warn ?? ((...a) => console.warn("Theatre |", ...a));
    this.resolution = resolution || 1;
    this.motion = 1;
    this.shed = 0;
    /** The GM's default shake strength (0..1), for a shot without its own. */
    this.shakeDefault = 0;
    this.shakeEnabled = true;
    this._shakeK = 0;          // eased strength: starts at 0, so a scene's shake always eases in
    this._shakeT = 0;          // shake clock, seconds (integrated, so a speed change never jumps)
    this._shakeAt = null;      // performance.now() of the last update
    this._cam = null;
    /** src → Promise<entry>; entry = { tex, video, owned } | null */
    this._cache = new Map();
    /** src → entry, once resolved */
    this._ready = new Map();
    this.a = makeSide(null);
    this.b = null;
    this._tr = null;          // { image, startAt }
    this._lastW = 0;
    this._fallback = false;
    this._probed = false;
    this._destroyed = false;
    /** The viewer's view in frame px (the host's); the backdrop covers it. */
    this.view = { x: 0, y: 0, width, height };
    this._backFailed = false;
    this._backProbed = false;

    this.container = new PIXI.Container();
    this.container.eventMode = "none";
    this.container.interactiveChildren = false;

    this._buildMesh();
    this._buildFallback();
    this._buildBackdrop();
  }

  /* ── construction ──────────────────────────────────────────────────── */

  _geometry() {
    const { width: w, height: h } = this;
    const g = new this.PIXI.Geometry();
    g.addAttribute("aVertexPosition", new Float32Array([0, 0, w, 0, w, h, 0, h]), 2);
    g.addAttribute("aFrame", new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2);
    g.addIndex(new Uint16Array([0, 1, 2, 0, 2, 3]));
    return g;
  }

  _buildMesh() {
    const PIXI = this.PIXI;
    const empty = PIXI.Texture.EMPTY ?? PIXI.Texture.WHITE;
    this.shader = PIXI.Shader.from(SHOT_VERT, SHOT_FRAG, {
      uTexA: empty, uTexB: empty,
      uPlaceA: new Float32Array([0, 0, 1, 1]), uPlaceB: new Float32Array([0, 0, 1, 1]),
      uCropA: new Float32Array([0, 0, 1, 1]), uCropB: new Float32Array([0, 0, 1, 1]),
      uGradeA: new Float32Array([1, 1, 0, 0]), uGradeB: new Float32Array([1, 1, 0, 0]),
      uTintA: new Float32Array(3), uTintB: new Float32Array(3),
      uBlurA: new Float32Array(3), uBlurB: new Float32Array(3),
      uHas: new Float32Array(2),
      uMix: 0, uWipe: 0, uWipeLine: new Float32Array([1, 0, 0]), uWipeSoft: 1,
      uSize: new Float32Array([this.width, this.height]),
    });
    this.mesh = new PIXI.Mesh(this._geometry(), this.shader);
    // Probe the program on the first real render, with the renderer PIXI hands
    // us. PIXI itself only logs a failed link and then draws nothing, forever.
    const render = this.mesh._render;
    this.mesh._render = (renderer) => {
      if (!this._probed) {
        this._probed = true;
        const { ok, log } = probeProgram(renderer?.gl);
        if (!ok) { this._enterFallback(log); return; }
      }
      render.call(this.mesh, renderer);
    };
    this.container.addChild(this.mesh);
  }

  _backGeometry() {
    const v = this.view, W = this.width, H = this.height;
    const x0 = v.x, y0 = v.y, x1 = v.x + v.width, y1 = v.y + v.height;
    const g = new this.PIXI.Geometry();
    g.addAttribute("aVertexPosition", new Float32Array([x0, y0, x1, y0, x1, y1, x0, y1]), 2);
    g.addAttribute("aFrame", new Float32Array([x0 / W, y0 / H, x1 / W, y0 / H, x1 / W, y1 / H, x0 / W, y1 / H]), 2);
    g.addIndex(new Uint16Array([0, 1, 2, 0, 2, 3]));
    return g;
  }

  _buildBackdrop() {
    const PIXI = this.PIXI;
    const empty = PIXI.Texture.EMPTY ?? PIXI.Texture.WHITE;
    this.backShader = PIXI.Shader.from(SHOT_VERT, BACK_FRAG, {
      uTexA: empty, uTexB: empty,
      uPlaceA: new Float32Array([0, 0, 1, 1]), uPlaceB: new Float32Array([0, 0, 1, 1]),
      uCropA: new Float32Array([0, 0, 1, 1]), uCropB: new Float32Array([0, 0, 1, 1]),
      uGradeA: new Float32Array([1, 1, 0]), uGradeB: new Float32Array([1, 1, 0]),
      uTintA: new Float32Array(3), uTintB: new Float32Array(3),
      uBlurA: new Float32Array(3), uBlurB: new Float32Array(3),
      uHas: new Float32Array(2),
      uMix: 0, uWipe: 0, uWipeLine: new Float32Array([1, 0, 0]), uWipeSoft: 1,
      uSize: new Float32Array([this.width, this.height]),
      uTaps: 1,
    });
    this.backMesh = new PIXI.Mesh(this._backGeometry(), this.backShader);
    const render = this.backMesh._render;
    this.backMesh._render = (renderer) => {
      if (!this._backProbed) {
        this._backProbed = true;
        const { ok, log } = probeProgram(renderer?.gl, SHOT_VERT, BACK_FRAG);
        if (!ok) {
          this._backFailed = true;
          this.backdrop.renderable = false;
          this._warn("the backdrop shader failed to compile; a fitted frame will sit on plain black.", log);
          return;
        }
      }
      render.call(this.backMesh, renderer);
    };
    this.backdrop = new PIXI.Container();
    this.backdrop.eventMode = "none";
    this.backdrop.interactiveChildren = false;
    this.backdrop.renderable = false;
    this.backdrop.addChild(this.backMesh);
  }

  /**
   * The viewer's view, in frame px (it may reach past the frame on every side).
   * The backdrop draws only while it does.
   */
  setView(v) {
    if (!v || !(v.width > 0 && v.height > 0)) return;
    const o = this.view;
    if (Math.abs(o.x - v.x) < 0.25 && Math.abs(o.y - v.y) < 0.25 && Math.abs(o.width - v.width) < 0.25 && Math.abs(o.height - v.height) < 0.25) return;
    this.view = { x: v.x, y: v.y, width: v.width, height: v.height };
    this._rebuildBack();
  }

  _rebuildBack() {
    const old = this.backMesh.geometry;
    this.backMesh.geometry = this._backGeometry();
    try { old.destroy(); } catch { /* shared */ }
  }

  _buildFallback() {
    const PIXI = this.PIXI;
    this.fb = new PIXI.Container();
    this.fb.renderable = false;
    this.fbBack = new PIXI.Graphics();
    this.fbMask = new PIXI.Graphics();
    this.fbA = new PIXI.Sprite(PIXI.Texture.EMPTY);
    this.fbB = new PIXI.Sprite(PIXI.Texture.EMPTY);
    this._drawFallbackRects();
    this.fb.addChild(this.fbBack, this.fbA, this.fbB, this.fbMask);
    this.fb.mask = this.fbMask;
    this.container.addChild(this.fb);
  }

  _drawFallbackRects() {
    for (const g of [this.fbBack, this.fbMask]) {
      g.clear();
      g.beginFill(0x000000, 1).drawRect(0, 0, this.width, this.height).endFill();
    }
  }

  _enterFallback(log) {
    if (this._fallback) return;
    this._fallback = true;
    this._warn("the shot shader failed to compile; falling back to plain crossfades (no treatment, no wipe edge).", log);
    this.mesh.renderable = false;
    this.fb.renderable = true;
  }

  /** True when the shader is unavailable and sprites are drawing instead. */
  get degraded() { return this._fallback; }

  /* ── textures ──────────────────────────────────────────────────────── */

  /**
   * Load (once) and cache a shot source. Resolves to a PIXI.Texture, or null on
   * any failure — never rejects. Videos are muted, looping and playing.
   */
  load(src) {
    const key = String(src ?? "");
    if (!key) return Promise.resolve(null);
    let p = this._cache.get(key);
    if (!p) {
      p = (isVideo(key) ? this._loadVideo(key) : this._loadImageEntry(key))
        .catch((e) => { this._warn(`could not load ${key}`, e); return null; })
        .then((entry) => {
          if (this._destroyed) { this._release(entry); return null; }
          if (entry) this._ready.set(key, entry);
          this._syncVideos();
          return entry;
        });
      this._cache.set(key, p);
    }
    return p.then((entry) => entry?.tex ?? null);
  }

  /** Fire-and-forget load of many sources. */
  preload(srcs) {
    for (const s of srcs ?? []) this.load(s);
  }

  async _loadImageEntry(src) {
    const PIXI = this.PIXI;
    let tex = null, owned = false;
    if (this._loadImage) tex = await this._loadImage(src);
    else { tex = await (PIXI.Assets?.load ? PIXI.Assets.load(src) : PIXI.Texture.fromURL(src)); owned = !PIXI.Assets?.load; }
    if (!tex || !tex.baseTexture || !(tex.width > 1 && tex.height > 1)) return null;
    // Mipmaps: the frame is usually drawn at half its texels, and the blur taps
    // read a mip level matched to their spacing.
    const bt = tex.baseTexture;
    const ON = PIXI.MIPMAP_MODES?.ON ?? 1;
    if (bt.mipmap !== ON) { bt.mipmap = ON; bt.update?.(); }
    return { tex, video: null, owned };
  }

  _loadVideo(src) {
    const PIXI = this.PIXI;
    return new Promise((resolve) => {
      const v = document.createElement("video");
      v.muted = true;
      v.defaultMuted = true;
      v.loop = true;
      v.playsInline = true;
      v.autoplay = true;
      v.preload = "auto";
      v.crossOrigin = "anonymous";
      let done = false;
      const finish = (ok) => {
        if (done) return;
        done = true;
        if (!ok || !v.videoWidth) { try { v.removeAttribute("src"); v.load(); } catch { /* gone */ } resolve(null); return; }
        const tex = PIXI.Texture.from(v, { resourceOptions: { autoPlay: false } });
        resolve({ tex, video: v, owned: true });
      };
      v.addEventListener("loadeddata", () => finish(true), { once: true });
      v.addEventListener("error", () => finish(false), { once: true });
      v.src = src;
    });
  }

  _release(entry) {
    if (!entry || !entry.owned) return;
    try {
      if (entry.video) { entry.video.pause(); entry.video.removeAttribute("src"); entry.video.load(); }
      entry.tex.destroy(true);
    } catch { /* already gone */ }
  }

  /** Play the videos on screen, pause the rest. */
  _syncVideos() {
    const live = new Set([this.a?.src, this.b?.src].filter(Boolean));
    for (const [src, entry] of this._ready) {
      const v = entry?.video;
      if (!v) continue;
      if (live.has(src)) { if (v.paused) v.play?.()?.catch?.(() => {}); }
      else if (!v.paused) v.pause();
    }
  }

  _tex(side) {
    return side?.src ? this._ready.get(side.src)?.tex ?? null : null;
  }

  /* ── playback ──────────────────────────────────────────────────────── */

  /**
   * Begin a transition to `shot` (a normalized Shot, or null for black).
   * @param {object|null} shot
   * @param {object} o
   * @param {object} [o.timeline]  scaled timeline (timelineFor → scaleTimeline); its `image` beat is used
   * @param {number} [o.startAt]   performance.now()-based ms the cue starts
   * @param {boolean} [o.settle]   jump straight to the end state
   */
  show(shot, { timeline = null, startAt = performance.now(), settle = false } = {}) {
    const image = timeline?.image ?? { mode: "swap", at: 0, dur: 0 };
    const sameShot = (side) => side && (side.shot?.id ?? null) === (shot?.id ?? null) && side.src === (shot?.src ?? "");

    // The shot already arriving, asked for again (a repeated feed of the same
    // cue): refresh its data, keep the transition running — never restart it.
    if (this._tr && !settle && sameShot(this.b)) {
      this.b = makeSide(shot);
      return;
    }

    // A transition still running is committed to whichever side holds the screen.
    if (this._tr) {
      if (this._lastW >= 0.5 && this.b) this.a = this.b;
      this.b = null;
      this._tr = null;
    }

    // The same shot again (a re-announce, an edit): refresh its data in place —
    // the picture does not restart.
    if (sameShot(this.a)) {
      this.a = makeSide(shot);
      this._syncVideos();
      return;
    }
    if (image.mode === "none" && this.a.shot) return;   // interlude: the image does not change

    const side = makeSide(shot);
    if (side.src) this.load(side.src);
    if (settle || image.mode === "none") {
      this.a = side;
      this.b = null;
    } else {
      this.b = side;
      this._tr = { image, startAt: Number(startAt) || performance.now() };
    }
    this._lastW = 0;
    this._syncVideos();
  }

  /** The shot the layer is showing (or arriving at). */
  get shot() { return (this.b ?? this.a)?.shot ?? null; }

  /** True while a transition is running. */
  get transitioning() { return !!this._tr; }

  /** Budget hook: how many entries of SHED_ORDER are shed. */
  setShed(level) { this.shed = Math.max(0, Number(level) || 0); }

  /** Device px per CSS px of the PIXI renderer. */
  setResolution(r) { this.resolution = r > 0 ? r : 1; }

  /** The motion scale; >1 slows the transitions. */
  setMotionScale(k) { this.motion = Number.isFinite(k) && k >= 0 ? k : 1; }

  /** The GM's default shake strength, 0..1. A shot's own wins. */
  setShakeDefault(v) { const n = Number(v); this.shakeDefault = Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0; }

  /** False holds the shake still where it is (ambient motion paused). */
  setShakeEnabled(on) { this.shakeEnabled = !!on; }

  /** The shake strength the shot on screen (or arriving) asks for. */
  get shakeTarget() {
    const shot = (this.b ?? this.a)?.shot;
    return shot && this.motion > 0 ? resolveShake(shot, this.shakeDefault) : 0;
  }

  /** True while the shake clock runs this frame. */
  get _shaking() {
    return this.shakeEnabled && this.allows("shake") && (this._shakeK > 1e-4 || this.shakeTarget > 0);
  }

  allows(name) {
    const i = SHED_ORDER.indexOf(name);
    return i < 0 || i >= this.shed;
  }

  /** True while anything here moves on its own (the host claims motion with it). */
  get animating() {
    if (this._tr || this._shaking) return true;
    return [this.a, this.b].some((s) => s?.src && this._ready.get(s.src)?.video && !this._ready.get(s.src).video.paused);
  }

  /* ── per frame ─────────────────────────────────────────────────────── */

  /** Cue time is performance.now(); the shake integrates its own clock off it. */
  update() {
    if (this._destroyed) return;
    this._stepShake(performance.now());
    let beat = null;
    if (this._tr) {
      beat = imageBeat(this._tr.image, performance.now() - this._tr.startAt);
      if (beat.done) {
        this.a = this.b ?? makeSide(null);
        this.b = null;
        this._tr = null;
        beat = null;
        this._syncVideos();
      }
    }
    this._lastW = beat?.w ?? 0;

    const A = this._sideState(this.a, beat ? beat.scaleA : 1, beat ? beat.dimA : 1, 0);
    const B = this.b ? this._sideState(this.b, beat?.scaleB ?? 1, 1, beat?.bloomB ?? 0) : null;
    if (this._fallback) this._drawFallback(A, B, beat);
    else this._writeUniforms(A, B, beat);
    this._updateBackdrop();
  }

  /**
   * Advance the shake: ease the strength toward the shot's, then run the clock
   * at a speed that rides on it. Paused or shed, both hold where they are.
   */
  _stepShake(t) {
    const dt = this._shakeAt === null ? 0 : Math.max(0, Math.min(100, t - this._shakeAt));
    this._shakeAt = t;
    if (this._shaking && dt > 0) {
      const target = this.shakeTarget;
      const tau = (TIMING.shakeEase * this.motion) / 3;   // ~95% of the way in shakeEase
      this._shakeK = tau > 0 ? target + (this._shakeK - target) * Math.exp(-dt / tau) : target;
      if (this._shakeK < 1e-4 && target === 0) this._shakeK = 0;
      const rate = SHAKE.slow + (SHAKE.fast - SHAKE.slow) * this._shakeK;
      if (this.motion > 0) this._shakeT += (dt / 1000) * (rate / this.motion);
    }
    this._cam = shakeCamera(this._shakeK, shakeOffset(this._shakeT), this.width, this.height);
  }

  /** The backdrop follows the frame's mix and wipe line exactly; only placement, blur and level differ. */
  _updateBackdrop() {
    const on = !this._backFailed && !this._fallback && viewOverhangs(this.view, this.width, this.height);
    this.backdrop.renderable = on;
    if (!on) return;
    const u = this.backShader.uniforms;
    const W = this.width, H = this.height, v = this.view;
    const wt = this.backdrop.worldTransform;
    const dev = this.resolution * (wt ? Math.hypot(wt.a, wt.b) || 1 : 1);
    const full = this.allows("backdrop");
    const rFrame = BACKDROP.blur * v.width;
    const empty = this.PIXI.Texture.EMPTY ?? this.PIXI.Texture.WHITE;
    const side = (s, k) => {
      const tex = this._tex(s);
      if (!s?.shot || !tex) { u[`uTex${k}`] = empty; return 0; }
      const r = backdropRect(tex.width, tex.height, v, s.focus);
      const place = u[`uPlace${k}`], crop = u[`uCrop${k}`], grade = u[`uGrade${k}`], tint = u[`uTint${k}`], blur = u[`uBlur${k}`];
      u[`uTex${k}`] = tex;
      place[0] = r.x / W; place[1] = r.y / H; place[2] = r.width / W; place[3] = r.height / H;
      const bt = tex.baseTexture, fr = tex.frame, bw = bt.width || 1, bh = bt.height || 1;
      crop[0] = fr.x / bw; crop[1] = fr.y / bh; crop[2] = fr.width / bw; crop[3] = fr.height / bh;
      const t = s.treatment;
      grade[0] = gainOf(t.exposure) * BACKDROP.gain;
      grade[1] = t.saturation;
      grade[2] = t.tintAmount;
      const tv = t.tintAmount > 0 ? tintVector(t.tint) : [0, 0, 0];
      tint[0] = tv[0]; tint[1] = tv[1]; tint[2] = tv[2];
      blur[0] = rFrame / r.width;
      blur[1] = rFrame / r.height;
      // The full disc reads a mip matched to its tap spacing; shed, one tap reads the mip the whole disc spans.
      blur[2] = Math.max(0, Math.log2((rFrame * dev) / (full ? TREATMENT.tapSpacing : 1)));
      return 1;
    };
    u.uHas[0] = side(this.a, "A");
    u.uHas[1] = side(this.b, "B");
    u.uTaps = full ? 1 : 0;
    const m = this.shader.uniforms;
    u.uMix = m.uMix;
    u.uWipe = m.uWipe;
    u.uWipeLine[0] = m.uWipeLine[0]; u.uWipeLine[1] = m.uWipeLine[1]; u.uWipeLine[2] = m.uWipeLine[2];
    u.uWipeSoft = m.uWipeSoft;
  }

  /** Device px per frame px, from the container's on-screen scale. */
  _devicePerFrame() {
    const wt = this.container.worldTransform;
    const s = wt ? Math.hypot(wt.a, wt.b) : 1;
    return (s > 0 ? s : 1) * this.resolution;
  }

  _sideState(side, tScale, dim, bloom) {
    const tex = this._tex(side);
    if (!side?.shot || !tex) return null;
    const W = this.width, H = this.height;
    const rect = placeRect(tex.width, tex.height, W, H, side.focus, tScale, this._cam);
    const t = side.treatment;
    const blurFrac = (this.allows("blur") ? t.blur * TREATMENT.blurMax : 0) + (this.allows("bloom") ? bloom * PUSH.bloomBlur : 0);
    return { tex, rect, t, dim, bloom, blurFrac };
  }

  _writeUniforms(A, B, beat) {
    const u = this.shader.uniforms;
    const W = this.width, H = this.height;
    const dev = this._devicePerFrame();
    const empty = this.PIXI.Texture.EMPTY ?? this.PIXI.Texture.WHITE;
    const side = (S, k) => {
      const place = u[`uPlace${k}`], crop = u[`uCrop${k}`], grade = u[`uGrade${k}`], tint = u[`uTint${k}`], blur = u[`uBlur${k}`];
      if (!S) { u[`uTex${k}`] = empty; return 0; }
      u[`uTex${k}`] = S.tex;
      place[0] = S.rect.x / W; place[1] = S.rect.y / H; place[2] = S.rect.width / W; place[3] = S.rect.height / H;
      const bt = S.tex.baseTexture, fr = S.tex.frame;
      const bw = bt.width || 1, bh = bt.height || 1;
      crop[0] = fr.x / bw; crop[1] = fr.y / bh; crop[2] = fr.width / bw; crop[3] = fr.height / bh;
      grade[0] = gainOf(S.t.exposure, S.dim, S.bloom);
      grade[1] = S.t.saturation;
      grade[2] = S.t.tintAmount;
      grade[3] = S.t.vignette;
      const tv = S.t.tintAmount > 0 ? tintVector(S.t.tint) : [0, 0, 0];
      tint[0] = tv[0]; tint[1] = tv[1]; tint[2] = tv[2];
      if (S.blurFrac > 0) {
        const rFrame = S.blurFrac * W;   // disc radius, frame px
        blur[0] = rFrame / S.rect.width;
        blur[1] = rFrame / S.rect.height;
        blur[2] = Math.max(0, Math.log2((rFrame * dev) / TREATMENT.tapSpacing));
      } else { blur[0] = 0; blur[1] = 0; blur[2] = 0; }
      return 1;
    };
    u.uHas[0] = side(A, "A");
    u.uHas[1] = side(B, "B");
    const w = B || beat ? (beat?.w ?? 0) : 0;
    u.uMix = w;
    if (beat?.wipe) {
      const soft = Math.max(WIPE.soft * W, WIPE.minSoftPx / dev);
      const line = wipeLine(w, W, H, soft);
      u.uWipe = 1;
      u.uWipeLine[0] = line.dx; u.uWipeLine[1] = line.dy; u.uWipeLine[2] = line.edge;
      u.uWipeSoft = soft;
    } else u.uWipe = 0;
  }

  _drawFallback(A, B, beat) {
    const put = (sprite, S, alpha) => {
      if (!S) { sprite.visible = false; return; }
      sprite.visible = true;
      if (sprite.texture !== S.tex) sprite.texture = S.tex;
      sprite.position.set(S.rect.x, S.rect.y);
      sprite.width = S.rect.width;
      sprite.height = S.rect.height;
      sprite.alpha = alpha;
    };
    const w = beat?.w ?? 0;
    put(this.fbA, A, 1);
    put(this.fbB, B, B ? w : 0);
  }

  /* ── lifecycle ─────────────────────────────────────────────────────── */

  resize(width, height) {
    if (!(width > 0 && height > 0) || (width === this.width && height === this.height)) return;
    this.width = width;
    this.height = height;
    const old = this.mesh.geometry;
    this.mesh.geometry = this._geometry();
    try { old.destroy(); } catch { /* shared */ }
    this.shader.uniforms.uSize[0] = width;
    this.shader.uniforms.uSize[1] = height;
    this.backShader.uniforms.uSize[0] = width;
    this.backShader.uniforms.uSize[1] = height;
    this._rebuildBack();
    this._drawFallbackRects();
  }

  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    for (const entry of this._ready.values()) this._release(entry);
    this._ready.clear();
    this._cache.clear();
    try { this.container.parent?.removeChild(this.container); } catch { /* torn down */ }
    try { this.mesh.geometry?.destroy(); } catch { /* torn down */ }
    try { this.container.destroy({ children: true }); } catch { /* torn down */ }
    try { this.backdrop.parent?.removeChild(this.backdrop); } catch { /* torn down */ }
    try { this.backMesh.geometry?.destroy(); } catch { /* torn down */ }
    try { this.backdrop.destroy({ children: true }); } catch { /* torn down */ }
    this.a = makeSide(null);
    this.b = null;
    this._tr = null;
  }
}
