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
// Boss presence (initiative card only): a slowly counter-rotating engraved
// sigil behind the creature, with a dark aura pooled at the edges of the card.
//
// Deliberately built from nothing this file already uses. Every other effect
// here is value noise: the guard-break shards, the dying veins and the delay
// bands are all fbm, and a fourth fbm effect would read as a variant of the
// third however it were tuned — the same soft, wandering texture in a different
// hue. This one has no noise in it at all. It is two rings of radial ticks and
// a radial falloff, so it is hard-edged, concentric and obviously struck rather
// than grown, which is also what Etched Glass is: engraving, not weather.
//
// The rings turn against each other at a fifth and a tenth of a revolution a
// minute. A boss holds two or three slots of every round, so anything faster
// would be the loudest thing on screen for half the encounter; at this rate the
// card is never quite still and you never catch it moving.
//
// Every ring is struck through uTexel — device pixels, not card units — because
// a hairline written in geometry units is ~2px on a HiDPI display and vanishes
// on an ordinary one, and no preview run on one machine shows you the other.
//
// uIntensity carries the tier: a Supreme boss is the same sigil, cut deeper.
// Hue says "boss", amount says "how much of one", which leaves --gl-tyrant free
// to mean exactly one thing on the rail.
export const FX_FRAG_TYRANT = `
varying vec2 vTextureCoord;
uniform sampler2D uSampler;
uniform float uTime, uSeed, uAspect, uTexel, uIntensity;
uniform vec3 uTyrantBase, uTyrantHot;
// One tick ring: count marks around a circle of radius rad, turning at spin,
// each mark duty of its own arc. w is the stroke width, in device pixels.
float gluTickRing(vec2 p, float rad, float count, float spin, float duty, float w){
  float r=length(p);
  float band=smoothstep(w,0.0,abs(r-rad));
  float ang=atan(p.y,p.x)+spin;
  float marks=smoothstep(duty-0.12,duty+0.12,abs(sin(ang*count*0.5)));
  return band*marks;
}
void main(void){
  vec2 uv=vTextureCoord;
  // Card space, corrected so the sigil is round on a card three times as wide
  // as it is tall rather than an ellipse the width of the rail.
  vec2 p=uv-vec2(0.5); p.x*=uAspect;
  float r=length(p);
  float px=uTexel*1.6;                                  // one hairline, in device pixels
  float turn=uTime*0.10+uSeed;
  float ringA=gluTickRing(p,0.30,24.0, turn,      0.55, px*1.6);
  float ringB=gluTickRing(p,0.42,40.0,-turn*0.55, 0.68, px*1.2);
  // A continuous hairline under each tick ring, so the marks read as struck on
  // a circle rather than as loose dashes.
  float hair=smoothstep(px,0.0,abs(r-0.30))*0.34+smoothstep(px,0.0,abs(r-0.42))*0.22;
  // The aura. Clear over the middle of the card, which is where the creature's
  // face is, and pooled into the corners the portrait has least to say in.
  float aura=smoothstep(0.26,0.78,r);
  float breath=0.86+0.14*sin(uTime*0.45+uSeed*1.7);
  float strokes=clamp(ringA+ringB+hair,0.0,1.0);
  float a=clamp((aura*0.30+strokes*0.55)*breath*uIntensity,0.0,0.74);
  vec3 col=mix(uTyrantBase,uTyrantHot,clamp(strokes*1.4,0.0,1.0));
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

