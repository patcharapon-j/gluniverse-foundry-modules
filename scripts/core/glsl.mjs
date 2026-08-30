/**
 * GLUniverse Suite — shared GLSL building blocks.
 *
 * Every suite feature that draws on the canvas works in a quad's UV space, so
 * how big a feature lands on screen depends on the scene's grid size and the
 * canvas zoom. The prelude below is the suite's shared answer to that; it was
 * written for the PF2e Ultimates token overlay and is consumed by the resource
 * bars too, so it lives here rather than inside either feature.
 *
 * Dependency-free and side-effect-free, like the rest of `core/`.
 */

/**
 * The precision qualifier every fragment shader in the suite declares for itself.
 *
 * PIXI prepends one to any shader that does not — and it prepends `mediump`.
 * That matters twice over: a bare WebGL context (a preview harness, a check
 * tool) prepends nothing at all, so the same source fails to compile there; and
 * letting PIXI supply it means the harness validates a *different program* than
 * the one Foundry runs. Declaring it pins both.
 *
 * `highp` is what an OKLab inverse and an exponential falloff want — at mediump
 * a colour ramp visibly bands — with the standard guard for hardware that cannot
 * offer it.
 */
export const PRECISION = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
`;

export const VERTEX_SHADER = `
attribute vec2 aVertexPosition;
attribute vec2 aUvs;
uniform mat3 translationMatrix;
uniform mat3 projectionMatrix;
varying vec2 vTextureCoord;
void main(void) {
  vTextureCoord = aUvs;
  gl_Position = vec4((projectionMatrix * translationMatrix * vec3(aVertexPosition, 1.0)).xy, 0.0, 1.0);
}`;

/**
 * Shared prelude: everything below is drawn in the quad's UV space, so a
 * feature's size on screen depends on how many device pixels the quad covers —
 * which changes with the scene's grid size and the canvas zoom. A rim written
 * as `exp(-|r - R| * 145.0)` is 1.4px wide on a 200px quad and 0.3px wide on a
 * 45px one (a medium token on a grid-50 map, zoomed out over a large scene),
 * where it stops being a rim and becomes noise that crawls between pixel
 * centres every frame.
 *
 * `uTexel` is one device pixel measured in that UV space (1 / quad width in
 * device pixels), refreshed from the mesh's world transform each frame. The
 * helpers use it to
 *   - widen every thin band to at least a pixel and dim it by the same factor,
 *     so its integrated brightness is preserved rather than aliased away, and
 *   - fade detail out (`glDetail`) once a feature no longer spans a pixel,
 *     instead of letting it sample at random.
 *
 * With `uTexel` left at 0 every clamp is inert and the result is bit-identical
 * to the unfiltered original, so a missing uniform degrades to the old look
 * rather than to a blank quad.
 */
export const SCALE_PRELUDE = `
uniform float uTexel;

/* The three thresholds the rest of this is tuned on, all in device pixels, all
   calibrated against a box-filtered ground truth (tools/ultimate-overlay-check.mjs):
   push them up and the effect turns to mush before it needs to; push them down
   and the buzzing comes back. */
const float GL_BAND = 0.85;      // thinnest a falloff's half-width may get
const float GL_EDGE = 1.25;      // narrowest a smoothstep transition may get
const float GL_FADE_LO = 0.8;    // detail is gone below this many pixels…
const float GL_FADE_HI = 2.2;    // …and untouched above it

/* Thin exponential band exp(-|d| * k), never narrower than a pixel. */
float glFalloff(float d, float k) {
  float w = max(1.0 / k, uTexel * GL_BAND);
  return exp(-abs(d) / w) * (1.0 / (k * w));
}

/* Thin gaussian band exp(-(d * k)^2), same treatment. */
float glGauss(float d, float k) {
  float w = max(1.0 / k, uTexel * GL_BAND);
  float x = d / w;
  return exp(-x * x) * (1.0 / (k * w));
}

/* Radially symmetric blobs: the same clamp, squared, because a point
   spreading in two dimensions loses brightness in both. */
float glPoint(float d, float k) {
  float w = max(1.0 / k, uTexel * GL_BAND);
  float s = 1.0 / (k * w);
  return exp(-abs(d) / w) * s * s;
}

float glSpot(float d, float k) {
  float w = max(1.0 / k, uTexel * GL_BAND);
  float x = d / w;
  float s = 1.0 / (k * w);
  return exp(-x * x) * s * s;
}

/* smoothstep whose transition never falls below about a pixel. Handles a
   descending edge (e1 < e0) as well, so it can stand in for either. */
float glEdge(float e0, float e1, float x) {
  float m = (e0 + e1) * 0.5;
  float h = max(abs(e1 - e0), uTexel * GL_EDGE) * 0.5;
  float s = e1 < e0 ? -1.0 : 1.0;
  return smoothstep(m - h * s, m + h * s, x);
}

/* 1 while a feature of the given UV width still spans a pixel or two, 0 once it
   does not — the fade factor for detail that cannot be filtered, only left
   out. */
float glDetail(float width) {
  return smoothstep(GL_FADE_LO, GL_FADE_HI, width / max(uTexel, 0.000001));
}

/* Ridged noise, pre-filtered. pow(1 - |2n - 1|, 2.4) crests far narrower
   than the noise cell it rides, and it is the crest — not the cell — that goes
   sub-pixel first. Soften the exponent as the crest shrinks (which keeps the
   tongues where they are, unlike dropping the octave), rescaling by the new
   mean 1/(p+1) so the flame keeps its brightness; only once the cell itself
   stops resolving does it settle to that mean. */
float glRidge(float noise, float crest, float cell) {
  float p = mix(1.6, 2.4, glDetail(crest));
  float ridge = pow(1.0 - abs(2.0 * noise - 1.0), p) * ((p + 1.0) / 3.4);
  return mix(1.0 / 3.4, ridge, glDetail(cell));
}

/* An angular lobe pow(sin a, p), widened the same way: its mean falls off as
   1/sqrt(p), so rescale by sqrt(p / p0) to spend the same light over the wider
   arc instead of brightening it. */
float glLobe(float wave, float sharpness, float width) {
  float p = mix(sharpness * 0.3, sharpness, glDetail(width));
  return pow(max(0.0, wave), p) * sqrt(p / sharpness);
}

/* Re-sharpening a mip-filtered alpha into a hard edge undoes the filtering the
   hardware just did, so widen the threshold as the quad shrinks. */
float glMask(float alpha, float lo, float hi) {
  float soft = clamp(uTexel * 3.0, 0.0, 0.30);
  return smoothstep(max(0.01, lo - soft), min(0.98, hi + soft), alpha);
}
`;

