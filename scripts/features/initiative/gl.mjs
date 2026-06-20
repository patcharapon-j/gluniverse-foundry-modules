// Shared WebGL primitives: card/marker FX shaders and PIXI mesh helpers.
// Used by both the card portrait FX (CardFXManager) and the ground token
// markers (TokenOverlayManager). Pure module-level data + helpers; PIXI is
// referenced as a runtime global inside the helpers.

// Supersample factor for the card portrait FX (renders the procedural field at
// SS× the card size, then box-downsamples on blit to de-alias the shader cracks).
// 1.25 keeps the cracks visibly clean while cutting fragment-shader work to ~1.56×
// the card area (vs 2.25× at 1.5) — a real win on mid-tier GPUs when several cards
// are broken/dying at once, with only a marginal softening of the FX edges.
export const FX_SUPERSAMPLE = 1.25;

export const FX_GLSL_NOISE = `
float gluHash1(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7))+uSeed)*43758.5453); }
float gluVNoise(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(gluHash1(i),gluHash1(i+vec2(1.0,0.0)),f.x),
             mix(gluHash1(i+vec2(0.0,1.0)),gluHash1(i+vec2(1.0,1.0)),f.x), f.y); }
float gluFbm(vec2 p){ float s=0.0,a=0.5; for(int i=0;i<5;i++){ s+=a*gluVNoise(p); p*=2.02; a*=0.5; } return s; }
`;

// Glass fracture. A dense web of shards radiating from the impact with a soft
// amber bloom (halo) around the cracks, a white-hot core and a looping energy
// flow that keeps the fracture alive — the full cinematic break look. The
// optimizations that DON'T change the look are kept: an analytic-AA floor
// (uThick/uTexel) so the dense shards de-alias on the supersampled render, and
// uClipCircle to mask the field to a disc for round token overlays (0 for
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

// Corruption veins. A domain-warped ridged-noise web of glowing violet veins
// that creep across the whole face and concentrate toward the edges, with a soft
// bloom (halo) around the strongest ridges — the full dying look. Kept cheap with
// a 3-octave noise (vs the 5-octave shared fbm) so the live per-frame token shader
// stays light; uClipCircle masks the field to a disc for round token overlays.
export const FX_FRAG_DYING = `
varying vec2 vTextureCoord;
uniform sampler2D uSampler;
uniform float uTime, uSeed, uAspect, uClipCircle;
uniform vec3 uVeinBase, uVeinHot;
float gluHashD(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7))+uSeed)*43758.5453); }
float gluVNoiseD(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(gluHashD(i),gluHashD(i+vec2(1.0,0.0)),f.x),
             mix(gluHashD(i+vec2(0.0,1.0)),gluHashD(i+vec2(1.0,1.0)),f.x), f.y); }
float gluFbmD(vec2 p){ float s=0.0,a=0.5; for(int i=0;i<3;i++){ s+=a*gluVNoiseD(p); p*=2.03; a*=0.5; } return s; }
void main(void){
  vec2 uv=vTextureCoord;
  vec2 q=vec2(gluFbmD(uv*3.0+vec2(0.0,uTime*0.05)), gluFbmD(uv*3.0+vec2(5.2,-uTime*0.04)));
  float n=gluFbmD(uv*4.5+q*1.8);                        // domain-warped for organic, wandering veins
  float ridge=1.0-abs(n*2.0-1.0);
  float veins=smoothstep(0.80,0.99,ridge);
  float eb=max(smoothstep(0.55,0.0,uv.x),smoothstep(0.45,1.0,uv.x));
  eb=max(eb,smoothstep(0.5,0.0,uv.y));
  veins*=mix(0.25,1.0,eb);                              // present across the face, densest at the edges
  float halo=smoothstep(0.6,0.99,ridge)*0.16*eb;        // soft bloom around the strongest veins
  vec3 violet=uVeinBase, vhot=uVeinHot;
  vec3 col=mix(violet,vhot,veins);
  float a=clamp(veins*0.9+halo,0.0,1.0);
  if(uClipCircle>0.5){ vec2 cc=uv-vec2(0.5); cc.x*=uAspect; a*=smoothstep(0.5,0.47,length(cc)); }
  gl_FragColor=vec4(col*a, a);
}`;

// Delay (token only): a calm blue energy scan drifting at the edges, center
// clear. uClipCircle masks to a disc for round token overlays.
export const FX_FRAG_DELAY = `
varying vec2 vTextureCoord;
uniform sampler2D uSampler;
uniform float uTime, uSeed, uAspect, uClipCircle;
uniform vec3 uDelayBase, uDelayHot;
${FX_GLSL_NOISE}
void main(void){
  vec2 uv=vTextureCoord;
  float flow=gluFbm(vec2(uv.x*3.0, uv.y*3.0 - uTime*0.4));
  float bands=0.5+0.5*sin((uv.y*8.0 - uTime*1.2) + flow*3.0);
  float lines=smoothstep(0.74,1.0,bands);
  float edge=smoothstep(0.28,0.5,length(uv-vec2(0.5)));
  float v=lines*mix(0.18,0.7,edge);
  vec3 blue=uDelayBase, ice=uDelayHot;
  vec3 col=mix(blue,ice,lines);
  float a=v*0.55;
  if(uClipCircle>0.5){ vec2 cc=uv-vec2(0.5); cc.x*=uAspect; a*=smoothstep(0.5,0.47,length(cc)); }
  gl_FragColor=vec4(col*a, a);
}`;

// Mystery scramble (initiative card only): a glitchy scanline + datamosh wash in
// violet/cyan that sits over the "?" mark on a hidden/mystery card so the slot
// reads as deliberately obscured rather than empty. Cheap — a few hash lookups,
// no fbm — and stepped in time (floor(uTime*12)) for a choppy digital feel.
export const FX_FRAG_SCRAMBLE = `
varying vec2 vTextureCoord;
uniform sampler2D uSampler;
uniform float uTime, uSeed, uAspect;
uniform vec3 uMysteryA, uMysteryB;
float gluH(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7))+uSeed)*43758.5453); }
void main(void){
  vec2 uv=vTextureCoord;
  float rows=14.0;
  float row=floor(uv.y*rows);
  float t=floor(uTime*12.0);
  // occasional horizontal glitch shift per scanline row
  float g=gluH(vec2(row,t));
  float glitch=step(0.82,g)*(gluH(vec2(row,t+1.0))-0.5)*0.3;
  vec2 suv=uv; suv.x+=glitch;
  float blocks=gluH(floor(suv*vec2(34.0,rows))+t*0.5);
  float scan=0.5+0.5*sin(uv.y*rows*6.2831);
  float noise=gluH(floor(suv*120.0)+t);
  float intensity=mix(0.25,0.6,blocks)*mix(0.6,1.0,scan);
  vec3 violet=uMysteryA, cyan=uMysteryB;
  vec3 col=mix(violet, cyan, step(0.7,noise));
  float a=intensity*0.5 + step(0.93,noise)*0.4 + step(0.82,g)*0.15;
  gl_FragColor=vec4(col*clamp(a,0.0,1.0), clamp(a,0.0,1.0));
}`;

// Apex (PF2e-Flatfinder solo boss). A menacing heat layer over the portrait:
// rising embers (drifting bright sparks, densest at the bottom), a soft corona
// vignette breathing around the face, and a low heat-shimmer. uPhase (1..3) is
// the HP phase — it scales both the ember speed and the overall intensity so the
// card visibly escalates as the boss is bloodied (composed → enraged → desperate).
// Kept cheap (a handful of hash/value-noise lookups, 3 ember layers) since at most
// a few apex cards exist at once; uClipCircle masks the field to a disc for round
// token overlays (0 for rectangular card portraits).
export const FX_FRAG_APEX = `
varying vec2 vTextureCoord;
uniform sampler2D uSampler;
uniform float uTime, uSeed, uAspect, uClipCircle, uPhase;
uniform vec3 uApexBase, uApexHot;
float gluHAx(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7))+uSeed)*43758.5453); }
float gluVNAx(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(gluHAx(i),gluHAx(i+vec2(1.0,0.0)),f.x),
             mix(gluHAx(i+vec2(0.0,1.0)),gluHAx(i+vec2(1.0,1.0)),f.x), f.y); }
void main(void){
  vec2 uv=vTextureCoord;
  float phase=clamp(uPhase,1.0,3.0);
  float t01=(phase-1.0)/2.0;
  float intensity=mix(0.55,1.25,t01);
  float speed=mix(0.55,1.35,t01);
  // Rising embers: three drifting cell layers of sparse bright points.
  float embers=0.0;
  for(int i=0;i<3;i++){
    float fi=float(i);
    vec2 g=vec2(uv.x*mix(11.0,17.0,fi*0.5), uv.y*6.0 + uTime*(0.6+0.55*speed) + fi*4.3);
    vec2 cell=floor(g); vec2 f=fract(g);
    float h=gluHAx(cell+fi*13.0);
    float pt=length(f-vec2(0.5+0.32*(h-0.5),0.5));
    embers+=smoothstep(0.18,0.0,pt)*step(0.85,h);
  }
  embers*=smoothstep(1.0,0.22,uv.y);                 // brightest low, burning upward
  // Breathing corona concentrated low-centre (behind the face's lower half).
  float vig=smoothstep(0.18,0.66,length((uv-vec2(0.5,0.64))*vec2(1.0,1.15)));
  float corona=vig*(0.16+0.10*sin(uTime*1.8));
  // Low heat-shimmer drifting up.
  float heat=gluVNAx(vec2(uv.x*5.0, uv.y*5.0 - uTime*1.1*speed));
  float shimmer=smoothstep(0.62,1.0,heat)*smoothstep(1.0,0.35,uv.y)*0.22;
  vec3 col=mix(uApexBase,uApexHot,clamp(embers*1.2+shimmer,0.0,1.0));
  float a=clamp((embers*0.95 + corona + shimmer)*intensity, 0.0, 1.0);
  if(uClipCircle>0.5){ vec2 cc=uv-vec2(0.5); cc.x*=uAspect; a*=smoothstep(0.5,0.47,length(cc)); }
  gl_FragColor=vec4(col*a, a);
}`;

// Ground turn-indicator. A cinematic energy disc drawn BENEATH the token, larger
// than the token footprint so it reads as a glowing pedestal rather than a status
// frame on the art. Procedural and disposition-coloured (uColor / uColorHi):
// a clear centre (token shows through), a bright torus band, drifting concentric
// rings, rotating radial ticks, an orbiting comet sweep with a white-hot head and
// flowing fbm energy. The "next" ring (uActive < 0.5) is NOT just a dimmer copy —
// it switches to a thin, cool, marching dashed perimeter ("on deck" / queued read)
// so it's formally distinct from the active plasma pedestal. uReduced freezes
// motion for the reduced animation tier.
export const FX_FRAG_TURN = `
varying vec2 vTextureCoord;
uniform sampler2D uSampler;
uniform float uTime, uSeed, uActive, uReduced, uHigh;
uniform vec3 uColor, uColorHi;
${FX_GLSL_NOISE}
#define TAU 6.28318530718
void main(void){
  vec2 uv = vTextureCoord - 0.5;
  float dist = length(uv) * 2.0;            // 0 centre .. ~1 at sprite edge
  float ang = atan(uv.y, uv.x);
  float spin = uReduced > 0.5 ? 1.7 : uTime;   // frozen-but-posed when reduced

  // Energy torus: clear centre (token shows), bright mid, soft outer fade.
  float rMid = 0.62;
  float band = smoothstep(0.30, rMid, dist) * (1.0 - smoothstep(rMid, 0.94, dist));

  // Crisp hairline rims give the disc a defined, machined edge instead of a soft
  // blob — the main lever for "polished, not generic". Thin gaussian rings.
  float innerRim = exp(-pow((dist - 0.34) / 0.030, 2.0));
  float outerRim = exp(-pow((dist - 0.84) / 0.040, 2.0));

  // Drifting concentric hairline rings (tighter, sharper than before).
  float rings = pow(0.5 + 0.5 * sin(dist * 46.0 - spin * 2.0), 9.0) * band;

  // Rotating radial ticks around the outer band.
  float ticks = pow(0.5 + 0.5 * cos(ang * 36.0 + spin * 1.3), 20.0)
              * smoothstep(0.54, 0.72, dist) * (1.0 - smoothstep(0.78, 0.93, dist));

  // Orbiting comet sweep with a bright leading head.
  float head = mod(ang - spin * 1.1, TAU);
  float sweep = pow(smoothstep(2.0, 0.0, head), 1.7) * band;
  float headGlow = pow(smoothstep(0.4, 0.0, head), 2.2) * band;

  // Flowing fbm energy so the band shimmers like plasma (slightly calmer).
  float flow = gluFbm(vec2(ang * 3.0 + spin * 0.5, dist * 5.0 - spin));
  float energy = (0.5 + 0.5 * flow) * band;

  // A whisper of inner glow keeps the centre subtly lit without hiding the art.
  float core = (1.0 - smoothstep(0.0, rMid, dist)) * 0.12;

  float ringsW = uHigh > 0.5 ? 0.85 : 0.55;
  float ticksW = uHigh > 0.5 ? 0.8 : 0.45;

  // --- ACTIVE: the full plasma pedestal with crisp rims ---------------------
  float activeI = band * (0.4 + 0.55 * energy)
                + rings * ringsW + ticks * ticksW + sweep * 0.65
                + outerRim * 0.95 + innerRim * 0.45 + core;

  // --- NEXT: a clean marching dashed ring sitting just OUTSIDE the token -----
  // Pushed to the disc's outer edge so it reads as a crisp "on deck" outline
  // ringing the token, never a dim copy of the active disc hidden under the art.
  float nextBand = smoothstep(0.68, 0.78, dist) * (1.0 - smoothstep(0.84, 0.95, dist));
  float dashes = 0.5 + 0.5 * sin(ang * 26.0 - spin * 0.5);
  dashes = smoothstep(0.5, 0.82, dashes);           // crisper gaps between dashes
  float nextRim = exp(-pow((dist - 0.90) / 0.035, 2.0));   // thin defining outer line
  float nextI = nextBand * dashes * (0.8 + 0.2 * flow) + nextRim * 0.55;

  float intensity = mix(nextI, activeI, step(0.5, uActive));

  float pulse = uReduced > 0.5 ? 1.0 : (0.85 + 0.15 * sin(uTime * (uActive > 0.5 ? 3.0 : 1.6)));
  intensity *= pulse;

  // Active leans bright/white-hot at its highlights; next stays cool, close to its
  // base hue so it never competes with the live token's glowing pedestal.
  vec3 activeCol = mix(uColor, uColorHi, clamp(rings + ticks + sweep * 0.5 + headGlow + outerRim * 0.6, 0.0, 1.0));
  activeCol = mix(activeCol, vec3(1.0), clamp(headGlow * 0.85, 0.0, 1.0));   // white-hot comet tip
  vec3 nextCol = mix(uColor, uColorHi, clamp(dashes * 0.4 + nextRim * 0.5, 0.0, 1.0));
  vec3 col = mix(nextCol, activeCol, step(0.5, uActive));

  float a = clamp(intensity, 0.0, 1.0) * (uActive > 0.5 ? 0.96 : 0.86);
  a *= smoothstep(1.0, 0.9, dist);          // clip to the disc; corners transparent
  gl_FragColor = vec4(col * a, a);
}`;

// Bake variant of FX_FRAG_TURN. Two changes vs. the live shader:
//   1. Animation is driven by uPhase in [0, TAU) instead of free-running uTime,
//      and every phase-dependent term is made periodic over that range (integer
//      angular rates; the drifting plasma flow becomes a closed circular orbit)
//      so the rendered frame sequence loops with NO seam — frame[N] == frame[0].
//   2. It is tint-agnostic: instead of a final colour it outputs the two MIX
//      FACTORS the live shader used (base->hi in R, ->white-hot in G) plus the
//      alpha in A. The playback shader reconstructs the per-disposition colour
//      from those masks, so one baked sheet serves every disposition.
export const FX_FRAG_TURN_BAKE = `
varying vec2 vTextureCoord;
uniform float uPhase, uActive, uHigh;
${FX_GLSL_NOISE}
#define TAU 6.28318530718
void main(void){
  vec2 uv = vTextureCoord - 0.5;
  float dist = length(uv) * 2.0;
  float ang = atan(uv.y, uv.x);
  float spin = uPhase;

  float rMid = 0.62;
  float band = smoothstep(0.30, rMid, dist) * (1.0 - smoothstep(rMid, 0.94, dist));
  float innerRim = exp(-pow((dist - 0.34) / 0.030, 2.0));
  float outerRim = exp(-pow((dist - 0.84) / 0.040, 2.0));

  // Rings: rate 2 is already integer-periodic over [0, TAU).
  float rings = pow(0.5 + 0.5 * sin(dist * 46.0 - spin * 2.0), 9.0) * band;
  // Ticks: rate rounded 1.3 -> 1.0 so the ring lands back on itself at TAU.
  float ticks = pow(0.5 + 0.5 * cos(ang * 36.0 + spin * 1.0), 20.0)
              * smoothstep(0.54, 0.72, dist) * (1.0 - smoothstep(0.78, 0.93, dist));
  // Comet: rate rounded 1.1 -> 1.0 so it orbits exactly once per loop.
  float head = mod(ang - spin * 1.0, TAU);
  float sweep = pow(smoothstep(2.0, 0.0, head), 1.7) * band;
  float headGlow = pow(smoothstep(0.4, 0.0, head), 2.2) * band;
  // Plasma flow on a closed circular path so the shimmer loops seamlessly.
  float flow = gluFbm(vec2(ang * 3.0 + 0.6 * cos(spin), dist * 5.0 + 0.6 * sin(spin)));
  float energy = (0.5 + 0.5 * flow) * band;
  float core = (1.0 - smoothstep(0.0, rMid, dist)) * 0.12;

  float ringsW = uHigh > 0.5 ? 0.85 : 0.55;
  float ticksW = uHigh > 0.5 ? 0.8 : 0.45;

  float activeI = band * (0.4 + 0.55 * energy)
                + rings * ringsW + ticks * ticksW + sweep * 0.65
                + outerRim * 0.95 + innerRim * 0.45 + core;

  float nextBand = smoothstep(0.68, 0.78, dist) * (1.0 - smoothstep(0.84, 0.95, dist));
  // Dash rate rounded 0.5 -> 1.0 for a clean single-orbit loop.
  float dashes = 0.5 + 0.5 * sin(ang * 26.0 - spin * 1.0);
  dashes = smoothstep(0.5, 0.82, dashes);
  float nextRim = exp(-pow((dist - 0.90) / 0.035, 2.0));
  float nextI = nextBand * dashes * (0.8 + 0.2 * flow) + nextRim * 0.55;

  float intensity = mix(nextI, activeI, step(0.5, uActive));
  // Breathing pulse, integer rate so it loops; active beats faster than next.
  float pulse = 0.85 + 0.15 * sin(uPhase * (uActive > 0.5 ? 3.0 : 2.0));
  intensity *= pulse;

  // base->hi mix factor (R) and ->white-hot factor (G), matching the live shader.
  float mixHi = mix(
    clamp(dashes * 0.4 + nextRim * 0.5, 0.0, 1.0),
    clamp(rings + ticks + sweep * 0.5 + headGlow + outerRim * 0.6, 0.0, 1.0),
    step(0.5, uActive));
  float white = clamp(headGlow * 0.85, 0.0, 1.0) * step(0.5, uActive);

  float a = clamp(intensity, 0.0, 1.0) * (uActive > 0.5 ? 0.96 : 0.86);
  a *= smoothstep(1.0, 0.9, dist);
  // Written verbatim (bake disables blending): NOT premultiplied — these are data.
  gl_FragColor = vec4(mixHi, white, 0.0, a);
}`;

// Playback shader for the baked turn-marker sheet. Samples two adjacent baked
// frames and cross-fades them (uMix) for smooth motion between sparse frames,
// then reconstructs the live two-tone + white-hot look from the mask channels
// using the disposition colours. Costs two texture reads + two mixes per pixel
// instead of the full procedural plasma field — the whole point of the bake.
export const FX_FRAG_TURN_PLAY = `
varying vec2 vTextureCoord;
uniform sampler2D uSampler;    // baked frame A
uniform sampler2D uFrameB;     // baked frame B (next in the loop)
uniform float uMix;            // 0..1 A->B
uniform vec3 uColor, uColorHi;
void main(void){
  vec4 s = mix(texture2D(uSampler, vTextureCoord), texture2D(uFrameB, vTextureCoord), uMix);
  vec3 col = mix(uColor, uColorHi, clamp(s.r, 0.0, 1.0));
  col = mix(col, vec3(1.0), clamp(s.g, 0.0, 1.0));
  float a = s.a;
  gl_FragColor = vec4(col * a, a);   // premultiplied, matching the live shader
}`;

// Trivial passthrough used to downsample a supersampled bake. With the source at
// LINEAR filtering and a 2x render scale, sampling it at the target resolution
// box-averages each 2x2 block — anti-aliasing the shader's high-frequency detail
// (ticks/dashes/rims), which polygon MSAA cannot do. Samples raw (texture2D) and
// writes verbatim (blend disabled), so the tint-mask data isn't premultiplied.
export const FX_FRAG_DOWNSAMPLE = `
varying vec2 vTextureCoord;
uniform sampler2D uSampler;
void main(void){ gl_FragColor = texture2D(uSampler, vTextureCoord); }`;

// Supersample factor for the bake (render at SS× the stored size, average down).

export function rgbFloat(hex) {
  return [((hex >> 16) & 0xff) / 255, ((hex >> 8) & 0xff) / 255, (hex & 0xff) / 255];
}

// Vertex shader for rendering the procedural FX as a world-space Mesh instead of a
// screen-space Filter. A filter samples the object's SCREEN bounds, so its UVs
// (and thus the procedural pattern) rescale as you zoom — the effect never stays
// locked to the token. A Mesh transforms its own geometry by the projection +
// translation matrices and reads UVs straight from the geometry (always 0..1), so
// the effect tracks the token perfectly at every zoom level. The varying is named
// `vTextureCoord` so the existing FX_FRAG_* fragment shaders work unchanged.
export const FX_VERT_MESH = `
attribute vec2 aVertexPosition;
attribute vec2 aUvs;
uniform mat3 translationMatrix;
uniform mat3 projectionMatrix;
varying vec2 vTextureCoord;
void main(void){
  vTextureCoord = aUvs;
  gl_Position = vec4((projectionMatrix * translationMatrix * vec3(aVertexPosition, 1.0)).xy, 0.0, 1.0);
}`;

// Builds a quad Mesh carrying one of the FX_FRAG_* fragment shaders. Size is set
// later via setFxMeshQuad so the geometry can be resized in place without
// recompiling the shader program (PIXI caches the program by source).
export function makeFxMesh(frag, uniforms) {
  const geometry = new PIXI.Geometry()
    .addAttribute("aVertexPosition", [0, 0, 1, 0, 1, 1, 0, 1], 2)
    .addAttribute("aUvs", [0, 0, 1, 0, 1, 1, 0, 1], 2)
    .addIndex([0, 1, 2, 0, 2, 3]);
  const shader = PIXI.Shader.from(FX_VERT_MESH, frag, uniforms);
  const mesh = new PIXI.Mesh(geometry, shader);
  mesh.eventMode = "none";
  return mesh;
}

// Resizes the quad in place (local coordinates). `centered` anchors it on its own
// origin (for the centred ground disc); otherwise it spans the top-left corner
// (for the token-local status overlays drawn in 0..w / 0..h space).
export function setFxMeshQuad(mesh, w, h, centered) {
  const x0 = centered ? -w / 2 : 0;
  const y0 = centered ? -h / 2 : 0;
  const x1 = x0 + w;
  const y1 = y0 + h;
  const buf = mesh.geometry.getBuffer("aVertexPosition");
  const d = buf.data;
  d[0] = x0; d[1] = y0; d[2] = x1; d[3] = y0;
  d[4] = x1; d[5] = y1; d[6] = x0; d[7] = y1;
  buf.update();
}

export function destroyFxMesh(mesh) {
  if (!mesh || mesh.destroyed) return;
  const shader = mesh.shader;
  if (mesh.parent) mesh.parent.removeChild(mesh);
  try { mesh.destroy({ children: true, geometry: true }); } catch {}
  try { shader?.destroy?.(); } catch {}   // PIXI.Mesh.destroy leaves the shader alone
}

