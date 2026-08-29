/**
 * GLUniverse Suite — resource bars: the bloom pass.
 *
 * The bars emit their specular, their fill head and their impact ring *above*
 * 1.0. This filter is what turns that into light: threshold what exceeds the
 * knee, blur it at a quarter resolution, add it back.
 *
 * ── The honest caveat ──
 *
 * PIXI's filter textures are 8-bit. Everything the shader writes above 1.0 is
 * therefore clamped before this filter ever sees it, so the threshold has to
 * sit *below* 1.0 and work on what survived the clamp. That is genuinely less
 * accurate than the preview harness, which renders to RGBA16F and can threshold
 * at 1.05 — highlights there bloom in proportion to how bright they actually
 * are, and here they all arrive at exactly 1.0.
 *
 * The practical difference is that a merely-bright fill blooms a little when it
 * should not, which is why DEFAULT_THRESHOLD is as high as it is: the point is
 * to catch the specular and the impact without lifting the whole fill. If a
 * future Foundry gives us a float filter target, raising the threshold past 1.0
 * is the only change needed.
 *
 * One filter for the whole bar container, never one per token — a per-token
 * filter allocates a render texture per token per frame, which in a forty-token
 * combat is the single most expensive thing this feature could possibly do.
 */

import { PRECISION } from "./shader.mjs";
import { warn } from "../../core/const.mjs";

export const DEFAULT_THRESHOLD = 0.82;
export const DEFAULT_INTENSITY = 0.85;

const VERT = `
attribute vec2 aVertexPosition;
uniform mat3 projectionMatrix;
uniform vec4 inputSize;
uniform vec4 outputFrame;
varying vec2 vTextureCoord;
void main(void) {
  vec2 position = aVertexPosition * max(outputFrame.zw, vec2(0.0)) + outputFrame.xy;
  gl_Position = vec4((projectionMatrix * vec3(position, 1.0)).xy, 0.0, 1.0);
  vTextureCoord = aVertexPosition * (outputFrame.zw * inputSize.zw);
}`;

const BRIGHT = PRECISION + `
varying vec2 vTextureCoord;
uniform sampler2D uSampler;
uniform vec4 inputSize;
uniform float uThreshold;
uniform float uKnee;
void main(void) {
  vec4 c = texture2D(uSampler, vTextureCoord);
  float lum = max(c.r, max(c.g, c.b));
  /* Soft knee. A hard cutoff makes the bloom pop in and out as a highlight
     crosses the threshold; the knee ramps it, so a brightening highlight blooms
     progressively — which is what the eye expects light to do. */
  float soft = clamp(lum - uThreshold + uKnee, 0.0, 2.0 * uKnee);
  soft = soft * soft / (4.0 * uKnee + 0.0001);
  float w = max(soft, lum - uThreshold) / max(lum, 0.0001);
  gl_FragColor = vec4(c.rgb * w, c.a * w);
}`;

const BLUR = PRECISION + `
varying vec2 vTextureCoord;
uniform sampler2D uSampler;
uniform vec2 uDir;
void main(void) {
  vec4 c = texture2D(uSampler, vTextureCoord) * 0.227027;
  vec2 o1 = uDir * 1.3846153846;
  vec2 o2 = uDir * 3.2307692308;
  c += (texture2D(uSampler, vTextureCoord + o1) + texture2D(uSampler, vTextureCoord - o1)) * 0.3162162162;
  c += (texture2D(uSampler, vTextureCoord + o2) + texture2D(uSampler, vTextureCoord - o2)) * 0.0702702703;
  gl_FragColor = c;
}`;

const COMPOSITE = PRECISION + `
varying vec2 vTextureCoord;
uniform sampler2D uSampler;
uniform sampler2D uBloom;
uniform float uIntensity;
void main(void) {
  vec4 s = texture2D(uSampler, vTextureCoord);
  vec4 b = texture2D(uBloom, vTextureCoord) * uIntensity;
  vec3 c = s.rgb + b.rgb;
  /* Roll off only what is over the knee. A plain Reinhard compresses the whole
     range, so every fill below 1.0 — which is all of them — comes back darker
     and less saturated, and the picture reads as washed out. Below the knee
     this is the identity. */
  vec3 knee = vec3(0.88);
  vec3 over = max(c - knee, vec3(0.0));
  c = min(c, knee) + over / (1.0 + over * 0.62);
  gl_FragColor = vec4(c, clamp(s.a + max(b.r, max(b.g, b.b)) * 0.30, 0.0, 1.0));
}`;

/**
 * A four-pass bloom over whatever container it is attached to.
 *
 * Built as a PIXI.Filter subclass with a custom `apply` rather than a stack of
 * filters, because the composite needs the *original* image alongside the
 * blurred one and a filter stack only ever hands the next filter the previous
 * one's output.
 */
export function createBloomFilter({ threshold = DEFAULT_THRESHOLD, intensity = DEFAULT_INTENSITY } = {}) {
  try {
    const bright = new PIXI.Filter(VERT, BRIGHT, { uThreshold: threshold, uKnee: 0.28 });
    const blur = new PIXI.Filter(VERT, BLUR, { uDir: new Float32Array([0, 0]) });
    /* The composite is this filter's own program: overriding `apply` replaces
       the single pass PIXI would have run, it does not add to it. */
    const filter = new PIXI.Filter(VERT, COMPOSITE, { uBloom: PIXI.Texture.EMPTY, uIntensity: intensity });

    filter.apply = function (fm, input, output, clear) {
      const half = fm.getFilterTexture(input, 0.5);
      const half2 = fm.getFilterTexture(input, 0.5);
      try {
        bright.uniforms.uThreshold = this.threshold;
        fm.applyFilter(bright, input, half, PIXI.CLEAR_MODES.CLEAR);

        blur.uniforms.uDir[0] = 1 / half.width; blur.uniforms.uDir[1] = 0;
        fm.applyFilter(blur, half, half2, PIXI.CLEAR_MODES.CLEAR);
        blur.uniforms.uDir[0] = 0; blur.uniforms.uDir[1] = 1 / half.height;
        fm.applyFilter(blur, half2, half, PIXI.CLEAR_MODES.CLEAR);

        this.uniforms.uBloom = half;
        this.uniforms.uIntensity = this.intensity;
        fm.applyFilter(this, input, output, clear);
      } finally {
        /* Filter textures come from a pool. Not returning them is a leak that
           grows with every frame and shows up as memory, never as an error. */
        fm.returnFilterTexture(half);
        fm.returnFilterTexture(half2);
      }
    };

    filter.threshold = threshold;
    filter.intensity = intensity;
    return filter;
  } catch (err) {
    warn("resource-bars | bloom filter unavailable; falling back to the in-shader glow", err);
    return null;
  }
}
