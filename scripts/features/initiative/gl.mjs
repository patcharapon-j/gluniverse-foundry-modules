// Shared WebGL primitives: card/marker FX shaders and PIXI mesh helpers.
// Used by both the card portrait FX (CardFXManager) and the ground token
// markers (TokenOverlayManager). Pure module-level data + helpers; PIXI is
// referenced as a runtime global inside the helpers.

// FX_SUPERSAMPLE, FX_GLSL_NOISE and FX_FRAG_BREAK now live in the dependency-free
// core/fx-glsl.mjs so the etched-chat feature can single-source the *same* crack
// geometry without a feature→feature import (research.md §D). They are imported
// and re-exported here unchanged so initiative's existing consumers — and the
// other FX shaders below that interpolate `${FX_GLSL_NOISE}` — keep working with
// zero behavior change. The crack colors remain uBreakAmber/uBreakHot uniforms.
import { FX_SUPERSAMPLE, FX_GLSL_NOISE, FX_FRAG_BREAK } from "../../core/fx-glsl.mjs";
export { FX_SUPERSAMPLE, FX_GLSL_NOISE, FX_FRAG_BREAK };

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

// Ground turn-indicator. A cinematic energy disc drawn BENEATH the token, larger
// than the token footprint so it reads as a glowing pedestal rather than a status
// frame on the art. Procedural and disposition-coloured (uColor / uColorHi):
// a clear centre (token shows through), a bright torus band, drifting concentric
// rings, rotating radial ticks, an orbiting comet sweep with a white-hot head and
// flowing fbm energy. The "next" ring (uActive < 0.5) is NOT just a dimmer copy —
// it switches to a thin, cool, marching dashed perimeter ("on deck" / queued read)
// so it's formally distinct from the active plasma pedestal. uReduced freezes
// motion for the reduced animation tier.
// Boss presence (initiative card only): a slow, viscous liquid filling the whole
// card, with pale filaments folding through it. It is drawn UNDERNEATH the
// portrait — the host parks this canvas below the portrait layer and the boss's
// portrait is masked so the creature dissolves into it at the edges — so this is
// the card's material rather than an overlay on the art. The creature is standing
// in the thing, not in front of it.
//
// This replaces a sigil of two counter-rotating tick rings. Rings are cheap in
// the literal sense: concentric marks on a rectangular card read as a target
// pasted onto it, they carry no information the card doesn't already state, and
// at rail size two of them are just a smudge with a hole in the middle. A
// material has no such problem — there is nothing to centre and nothing to miss.
//
// How the liquid is made: the field is warped by a flow of its own before it is
// sampled (`gluTyrantFlow` produces the offset, `body` samples the warped
// point). One level of that is marble; feeding the warp back into the sample
// point is what makes it fold into itself, which is what separates a liquid
// from a cloud. Both the flow and the sample drift, at different rates and on
// different axes, so the pattern never repeats and never obviously loops.
//
// Three deliberate choices about cost. The octave count is local (3) rather than
// gluFbm's 5: this is a soft body with no fine structure to resolve, and the two
// extra octaves are invisible under a portrait while doubling the sample count
// on a card that is on screen for the whole encounter. There are four noise
// calls, not the six a two-level warp wants. And there is no uTexel anywhere:
// nothing here is *struck*, so nothing here needs a hairline sized in device
// pixels. The filaments are a power of the fold, so their width is set by the
// field's gradient in card space — they gain pixels on a HiDPI display rather
// than losing them, which is the failure mode the uTexel rule exists to prevent.
//
// uIntensity carries the tier: a Supreme boss is the same liquid, deeper. Hue
// says "boss", amount says "how much of one", which leaves --gl-tyrant free to
// mean exactly one thing on the rail.
export const FX_FRAG_TYRANT = `
varying vec2 vTextureCoord;
uniform sampler2D uSampler;
uniform float uTime, uSeed, uAspect, uIntensity;
uniform vec3 uTyrantBase, uTyrantMid, uTyrantHot;
${FX_GLSL_NOISE}
// Three octaves, and each one is rotated as well as scaled. Doubling alone
// stacks every octave's lattice on the same axes, which shows up in a slow field
// as a faint square grain; the offset breaks the alignment for free.
float gluTyrantFbm(vec2 p){
  float s=0.0,a=0.5;
  for(int i=0;i<3;i++){ s+=a*gluVNoise(p); p=p*2.03+vec2(1.7,9.2); a*=0.5; }
  return s;
}
// The flow: how far a point is dragged, and in which direction. The two
// components read the field at unrelated offsets and drift on opposite axes, so
// the drag is a circulation rather than a uniform slide.
vec2 gluTyrantFlow(vec2 p, float t){
  return vec2(gluTyrantFbm(p + vec2(0.0, -t)),
              gluTyrantFbm(p + vec2(4.7, 2.3) + vec2(t*0.6, 0.0)));
}
void main(void){
  vec2 uv=vTextureCoord;
  // Card space, corrected so the liquid's cells are round on a card three times
  // as wide as it is tall rather than stretched into bands down the rail.
  vec2 p=vec2(uv.x*uAspect, uv.y);
  // A boss holds two or three slots of every round, so anything quick here would
  // be the loudest thing on screen for half the encounter. At this rate the card
  // is never quite still and you never catch it moving.
  float t=uTime*0.055;

  vec2 flow=gluTyrantFlow(p*2.2, t);
  float body=gluTyrantFbm(p*2.2 + 2.9*flow + vec2(0.0, t*0.35));
  // A second, much larger-scale read of the same flow, running the other way.
  // This is what gives the card depth: without it the liquid is one even
  // agitation everywhere, which reads as static however fast it moves.
  float veil=gluTyrantFbm(p*1.05 - 1.6*flow - vec2(t*0.5, 0.0));

  // Ridged. The fold lines are where the warped field passes through its middle,
  // so this is the *surface* of the liquid rather than its density, and raising
  // it to a power leaves only the crests: thin pale filaments over a dark body.
  float fold=1.0-abs(body*2.0-1.0);
  float film=pow(clamp(fold,0.0,1.0),6.0);
  float pool=smoothstep(0.28,0.88,veil);

  // Liquid settles. A gentle vertical bias costs nothing and stops the card
  // looking like a texture swatch cropped to a rectangle.
  float settle=mix(0.74,1.16,smoothstep(0.05,0.95,uv.y));
  float breath=0.88+0.12*sin(uTime*0.31+uSeed*1.7);

  float a=clamp((0.20+pool*0.36+film*0.42)*settle*breath*uIntensity, 0.0, 0.90);
  // Held short of the full mid tone. At the full mix the card is an even, fairly
  // vivid purple, which is pretty rather than ominous; stopping the ramp early
  // keeps the body in shadow and lets the filaments be the only bright thing.
  vec3 col=mix(uTyrantBase, uTyrantMid, pool*0.72);
  col=mix(col, uTyrantHot, film*0.85);
  gl_FragColor=vec4(col*a, a);
}`;

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

