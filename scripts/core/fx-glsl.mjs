/**
 * GLUniverse Suite — shared GLSL primitives.
 *
 * Pure, dependency-free, side-effect-free GLSL source strings + render constants
 * single-sourced here so more than one feature can run the *same* crack geometry
 * without forking the shader. The initiative tracker re-exports these from
 * `features/initiative/gl.mjs`; the etched-chat feature imports them directly for
 * its own offscreen renderer; the resource bars import the crack *field* on its
 * own (see FX_GLSL_BREAK_FIELD) and composite it inside their own bar shader.
 * Three features, one crack — the look is guaranteed to be the same one.
 *
 * No PIXI, no DOM, no imports. Just data.
 */

// Supersample factor for procedural card FX (render the field at SS× the card
// size, box-downsample on blit to de-alias the shader cracks).
export const FX_SUPERSAMPLE = 1.25;

// Shared value-noise helpers, interpolated into the fragment shaders below (and
// into the other initiative FX shaders that re-import this binding).
export const FX_GLSL_NOISE = `
float gluHash1(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7))+uSeed)*43758.5453); }
float gluVNoise(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(gluHash1(i),gluHash1(i+vec2(1.0,0.0)),f.x),
             mix(gluHash1(i+vec2(0.0,1.0)),gluHash1(i+vec2(1.0,1.0)),f.x), f.y); }
float gluFbm(vec2 p){ float s=0.0,a=0.5; for(int i=0;i<5;i++){ s+=a*gluVNoise(p); p*=2.02; a*=0.5; } return s; }
`;

/**
 * The glass fracture itself, as a function rather than as a whole shader.
 *
 * A dense web of shards radiating from an impact, with a soft bloom (halo)
 * around the seams, a white-hot core and a looping energy flow that keeps the
 * fracture alive. It is split out from FX_FRAG_BREAK because the third consumer
 * cannot use a whole fragment shader: a resource bar is one quad running one
 * program, and its fracture has to be clipped to the bar's own cut-corner
 * silhouette and composited *with* the fill rather than laid over it as a second
 * mesh. Sharing the field is what keeps a broken creature's token, its
 * initiative card and its health bar carrying one fracture instead of three
 * lookalikes that drift apart the first time any of them is touched.
 *
 * ── Coordinates ──
 *
 * `q` and `imp` are in an **isotropic** space — whatever units the caller likes,
 * as long as x and y are the same size in them, since the shard cells are round.
 * FX_FRAG_BREAK passes `vec2(uv.x * uAspect, uv.y)`, which is that space for a
 * quad; the resource bars pass their own `p` (one unit = the bar's height). A
 * constant offset between the two conventions only slides the cell lattice,
 * which is noise either way.
 *
 * `texel` is one device pixel in those same units, and is what de-aliases the
 * dense shards: the Voronoi edge field changes by ~`scale` per unit, so one
 * pixel spans ~`scale * texel` of field and the smoothstep band is never allowed
 * to be narrower than that. At `texel = 0` the clamp is inert and the result is
 * the unfiltered original, so a missing uniform degrades to the old look rather
 * than to a blank quad — the same contract as `core/glsl.mjs`'s prelude.
 *
 * ── The two shape parameters ──
 *
 * `dense` scales the shard count and `reach` scales how far the fracture
 * spreads from the impact. Both are 1.0 for the square-ish quads this was
 * written for, and both are exactly identity there (`x / 1.0` and `x * 1.0`), so
 * FX_FRAG_BREAK's output is unchanged by the extraction. They exist for the
 * resource bar, which is routinely 8:1: at `dense` 1 its shards land about a
 * pixel across and at `reach` 1 the fracture dies a tenth of the way along the
 * bar, so a bar that "ran the same shader" would in practice show neither the
 * crack nor the spread.
 *
 * Requires `uSeed` (a uniform, as in FX_GLSL_NOISE) and FX_GLSL_NOISE's `gluFbm`
 * to be in scope ahead of it.
 *
 * @returns vec4(crack, halo, core, glowFlow) — the four unlit terms. Colouring
 *          is the caller's, because that is the part that has to answer to what
 *          it is being drawn over.
 */
export const FX_GLSL_BREAK_FIELD = `
vec2 gluHash2(vec2 p){ p=vec2(dot(p,vec2(127.1,311.7)),dot(p,vec2(269.5,183.3))); return fract(sin(p+uSeed)*43758.5453); }
float gluVoroEdge(vec2 x){
  vec2 n=floor(x), f=fract(x); float f1=9.0,f2=9.0;
  for(int j=-1;j<=1;j++) for(int i=-1;i<=1;i++){
    vec2 g=vec2(float(i),float(j)); vec2 o=gluHash2(n+g); vec2 r=g+o-f; float d=dot(r,r);
    if(d<f1){f2=f1;f1=d;} else if(d<f2){f2=d;}
  }
  return sqrt(f2)-sqrt(f1);
}
vec4 gluBreakField(vec2 q, vec2 imp, float time, float thick, float texel, float dense, float reach){
  vec2 d=q-imp;
  float dist=length(d)/reach;
  float ang=atan(d.y,d.x);
  float warp=0.17*gluFbm(vec2(ang*1.3+3.0,1.7))+0.09*gluFbm(vec2(ang*3.7,5.0))-0.13;
  float wdist=dist+warp;
  float scale=mix(15.0,6.0,smoothstep(0.0,0.8,dist))*dense;  // fine shards near the impact -> fewer outward
  float ce=gluVoroEdge(q*scale+7.0);
  float aaWidth=max(thick, 1.5*scale*texel);
  float edge=1.0-smoothstep(0.0,aaWidth,ce);
  float shatterT=clamp(time*1.4,0.0,1.0);
  float front=smoothstep(0.05,-0.06, wdist-(0.05+1.2*shatterT));
  float coverage=smoothstep(1.15,0.10,wdist)*front;    // spreads across the art behind the front
  float crack=edge*coverage;
  float settled=smoothstep(0.55,1.0,shatterT);
  float flow=pow(0.5+0.5*sin(dist*26.0-time*3.2),6.0); // flowing energy along the cracks
  float glowFlow=crack*flow*settled;
  float pulse=0.62+0.38*sin(time*2.2);
  float halo=(1.0-smoothstep(0.0,0.13,ce))*coverage*0.30*pulse;   // soft amber bloom around the shards
  float core=smoothstep(0.12,0.0,dist)*smoothstep(0.0,0.12,shatterT);
  return vec4(crack, halo, core, glowFlow);
}
`;

/** The fracture's own breathing, so every consumer pulses on one clock. */
export const FX_GLSL_BREAK_PULSE = `float gluBreakPulse(float time){ return 0.62+0.38*sin(time*2.2); }`;

// Glass fracture, as a whole fragment shader: the field above, coloured. The
// crack colors are the `uBreakAmber`/`uBreakHot` uniforms (NOT hard-coded
// constants) so the gold<->red recolor is a pure uniform swap, and uClipCircle
// masks the field to a disc for round token overlays (0 for rectangular card
// portraits).
export const FX_FRAG_BREAK = `
varying vec2 vTextureCoord;
uniform sampler2D uSampler;
uniform float uTime, uSeed, uAspect, uClipCircle, uThick, uTexel;
uniform vec2 uImpact;
uniform vec3 uBreakAmber, uBreakHot;
${FX_GLSL_NOISE}
${FX_GLSL_BREAK_FIELD}
${FX_GLSL_BREAK_PULSE}
void main(void){
  vec2 uv=vTextureCoord;
  vec4 f=gluBreakField(vec2(uv.x*uAspect,uv.y), vec2(uImpact.x*uAspect,uImpact.y),
                       uTime, uThick, uTexel, 1.0, 1.0);
  float crack=f.x, halo=f.y, core=f.z, glowFlow=f.w;
  float pulse=gluBreakPulse(uTime);
  vec3 amber=uBreakAmber, hot=uBreakHot, white=vec3(1.0);
  vec3 col=mix(amber,hot,clamp(crack*pulse,0.0,1.0));
  col=mix(col,white,clamp(core+glowFlow,0.0,1.0));
  float a=clamp(crack*0.95 + halo + core*0.7 + glowFlow*0.8, 0.0, 1.0);
  if(uClipCircle>0.5){ vec2 cc=uv-vec2(0.5); cc.x*=uAspect; a*=smoothstep(0.5,0.47,length(cc)); }
  gl_FragColor=vec4(col*a, a);
}`;
