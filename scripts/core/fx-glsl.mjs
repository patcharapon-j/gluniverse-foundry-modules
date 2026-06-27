/**
 * GLUniverse Suite — shared GLSL primitives.
 *
 * Pure, dependency-free, side-effect-free GLSL source strings + render constants
 * single-sourced here so more than one feature can run the *same* crack geometry
 * without forking the shader. The initiative tracker re-exports these from
 * `features/initiative/gl.mjs`; the etched-chat feature imports them directly for
 * its own offscreen renderer. Two features, one shader source — the crack look is
 * guaranteed identical (see specs/002-etched-chat-theme/research.md §D).
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

// Glass fracture. A dense web of shards radiating from the impact with a soft
// amber bloom (halo) around the cracks, a white-hot core and a looping energy
// flow that keeps the fracture alive — the full cinematic break look. The crack
// colors are the `uBreakAmber`/`uBreakHot` uniforms (NOT hard-coded constants) so
// the gold↔red recolor is a pure uniform swap. An analytic-AA floor
// (uThick/uTexel) de-aliases the dense shards on the supersampled render, and
// uClipCircle masks the field to a disc for round token overlays (0 for
// rectangular card portraits).
export const FX_FRAG_BREAK = `
varying vec2 vTextureCoord;
uniform sampler2D uSampler;
uniform float uTime, uSeed, uAspect, uClipCircle, uThick, uTexel;
uniform vec2 uImpact;
uniform vec3 uBreakAmber, uBreakHot;
vec2 gluHash2(vec2 p){ p=vec2(dot(p,vec2(127.1,311.7)),dot(p,vec2(269.5,183.3))); return fract(sin(p+uSeed)*43758.5453); }
float gluVoroEdge(vec2 x){
  vec2 n=floor(x), f=fract(x); float f1=9.0,f2=9.0;
  for(int j=-1;j<=1;j++) for(int i=-1;i<=1;i++){
    vec2 g=vec2(float(i),float(j)); vec2 o=gluHash2(n+g); vec2 r=g+o-f; float d=dot(r,r);
    if(d<f1){f2=f1;f1=d;} else if(d<f2){f2=d;}
  }
  return sqrt(f2)-sqrt(f1);
}
${FX_GLSL_NOISE}
void main(void){
  vec2 uv=vTextureCoord;
  vec2 d=(uv-uImpact); d.x*=uAspect; float dist=length(d);
  float ang=atan(d.y,d.x);
  float warp=0.17*gluFbm(vec2(ang*1.3+3.0,1.7))+0.09*gluFbm(vec2(ang*3.7,5.0))-0.13;
  float wdist=dist+warp;
  float scale=mix(15.0,6.0,smoothstep(0.0,0.8,dist));  // many fine shards near impact -> fewer outward
  float ce=gluVoroEdge(vec2(uv.x*uAspect,uv.y)*scale+7.0);
  // Analytic AA floor: the Voronoi edge field changes by ~scale per uv unit, so
  // one screen pixel spans ~scale*uTexel of field. Keep the smoothstep band at
  // least that wide so the dense shards stop aliasing on the supersampled render,
  // but never thinner than uThick's line weight. (uTexel = 1/render-height.)
  float aaWidth=max(uThick, 1.5*scale*uTexel);
  float edge=1.0-smoothstep(0.0,aaWidth,ce);
  float shatterT=clamp(uTime*1.4,0.0,1.0);
  float front=smoothstep(0.05,-0.06, wdist-(0.05+1.2*shatterT));
  float coverage=smoothstep(1.15,0.10,wdist)*front;    // spreads across the art behind the front
  float crack=edge*coverage;
  float settled=smoothstep(0.55,1.0,shatterT);
  float flow=pow(0.5+0.5*sin(dist*26.0-uTime*3.2),6.0); // flowing energy along the cracks
  float glowFlow=crack*flow*settled;
  float pulse=0.62+0.38*sin(uTime*2.2);
  float halo=(1.0-smoothstep(0.0,0.13,ce))*coverage*0.30*pulse;   // soft amber bloom around the shards
  float core=smoothstep(0.12,0.0,dist)*smoothstep(0.0,0.12,shatterT);
  vec3 amber=uBreakAmber, hot=uBreakHot, white=vec3(1.0);
  vec3 col=mix(amber,hot,clamp(crack*pulse,0.0,1.0));
  col=mix(col,white,clamp(core+glowFlow,0.0,1.0));
  float a=clamp(crack*0.95 + halo + core*0.7 + glowFlow*0.8, 0.0, 1.0);
  if(uClipCircle>0.5){ vec2 cc=uv-vec2(0.5); cc.x*=uAspect; a*=smoothstep(0.5,0.47,length(cc)); }
  gl_FragColor=vec4(col*a, a);
}`;
