/**
 * GLUniverse Stream Roll Cards — the crit crack, composed from the suite's field.
 *
 * The standalone module shipped a *verbatim fork* of `core/fx-glsl.mjs` — its
 * own header said so, naming the commit it was copied from. The three shared
 * GLSL blocks were byte-identical, and the whole fork existed to change two
 * things in the wrapper: `dense` and `reach` needed to be uniforms rather than
 * literals, and the circular clip was unwanted on a rectangular card.
 *
 * Neither needed a fork. `gluBreakField` already takes `dense` and `reach` as
 * **arguments**, precisely so `features/resource-bars` can pass values other
 * than 1.0, and the clip is a branch this wrapper simply does not write. So the
 * field, the noise and the pulse are imported and this file contributes only
 * the wrapper — which is what the fork should have been.
 *
 * That matters because the alternative is silent. A fourth copy of a shader
 * that is currently byte-identical to the original is the worst possible state:
 * it looks correct forever, and then one day the creature's Broken crack and
 * the stream's critical crack are subtly different cracks and nothing reports
 * it.
 */

import {
  FX_BREAK_COLORS,
  FX_GLSL_BREAK_FIELD,
  FX_GLSL_BREAK_PULSE,
  FX_GLSL_NOISE,
} from "../../../core/fx-glsl.mjs";

/**
 * The card crack.
 *
 * Differs from `FX_FRAG_BREAK` in exactly two ways, both deliberate:
 *   - `uDense` / `uReach` are uniforms, so a card can be cracked harder or
 *     further than a token overlay. The field has always accepted them.
 *   - no `uClipCircle` branch: a roll card is a rectangle, and the token
 *     overlay's disc mask has nothing to do here.
 * Everything else — the colour mix, the alpha accumulation, the pulse — is the
 * suite's, unchanged.
 */
export const FX_FRAG_ROLL_CARD_BREAK = `
varying vec2 vTextureCoord;
uniform sampler2D uSampler;
uniform float uTime, uSeed, uAspect, uThick, uTexel, uDense, uReach;
uniform vec2 uImpact;
uniform vec3 uBreakAmber, uBreakHot;
${FX_GLSL_NOISE}
${FX_GLSL_BREAK_FIELD}
${FX_GLSL_BREAK_PULSE}
void main(void){
  vec2 uv=vTextureCoord;
  vec4 f=gluBreakField(vec2(uv.x*uAspect,uv.y), vec2(uImpact.x*uAspect,uImpact.y),
                       uTime, uThick, uTexel, uDense, uReach);
  float crack=f.x, halo=f.y, core=f.z, glowFlow=f.w;
  float pulse=gluBreakPulse(uTime);
  vec3 amber=uBreakAmber, hot=uBreakHot, white=vec3(1.0);
  vec3 col=mix(amber,hot,clamp(crack*pulse,0.0,1.0));
  col=mix(col,white,clamp(core+glowFlow,0.0,1.0));
  float a=clamp(crack*0.95 + halo + core*0.7 + glowFlow*0.8, 0.0, 1.0);
  gl_FragColor=vec4(col*a, a);
}`;

/** Re-exported under the fork's old name so the renderer reads unchanged. */
export const CRACK_COLORS = FX_BREAK_COLORS;

/** How a card cracks, as opposed to a token: thinner, sparser, further-reaching. */
export const ROLL_CARD_CRACK_SHAPE = Object.freeze({ thick: 0.045, dense: 0.42, reach: 2.2 });
