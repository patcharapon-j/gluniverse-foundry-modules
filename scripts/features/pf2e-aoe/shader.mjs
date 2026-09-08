/**
 * PF2e AoE — the shader.
 *
 * ONE program serves all four passes. uPlane selects which contributions
 * composite: 0 the ground (lattice, archetype fill, skirt base), 1 the
 * atmosphere (motes and haze), 2 the boundary (the rim, drawn over
 * everything so a token standing on the edge never hides it), and 3 the SHADE.
 * Four programs would be four things to keep in sync and four things that can
 * silently fail to link.
 *
 * PLANE 3 IS THE ODD ONE and the host must blend it differently: it is drawn
 * FIRST, under everything including the tokens, with a MULTIPLY blend
 * (gl.blendFunc(DST_COLOR, ONE_MINUS_SRC_ALPHA) against a premultiplied
 * source, which resolves to dst * (1 - s * (1 - shade))). Given the wrong
 * blend it does not error; it lays a dark patch over the map.
 *
 * COORDINATE CONTRACT. Everything works in vGrid — position in GRID SQUARES,
 * origin at the area's own origin. That space is isotropic (a grid square is
 * square), which is what lets SCALE_PRELUDE's helpers work unmodified: uTexel
 * is one device pixel measured in grid units, so a hairline written as
 * uTexel * 1.15 is 1.15 device pixels at any zoom and any scene grid size.
 * Written in grid units instead it would be about 2px on a HiDPI display,
 * sub-pixel on an ordinary one, and deleted by glDetail for every player
 * without a retina monitor — with no preview at dpr 1 showing you.
 *
 * At uTexel 0 every clamp is inert and the result degrades to the unfiltered
 * original, never to a blank quad.
 *
 * THE RULES ARE NOT COMPUTED HERE. Which squares are covered comes from the
 * host's PF2e coverage resolver, uploaded as uCells. The shader reads that
 * table; it never derives it. The smooth SDF below is the true geometry ghost
 * — a visual, never an answer to "am I in it?".
 */

import { PRECISION, SCALE_PRELUDE } from "../../core/glsl.mjs";
import { FX_GLSL_NOISE } from "../../core/fx-glsl.mjs";
import { LAYOUT } from "./constants.mjs";

export { PRECISION };

/**
 * Every uniform, name -> GLSL type.
 *
 * The harness looks each one up in the linked program and fails on any that
 * resolve to null. That check is necessary and NOT sufficient: uCellOrigin and
 * uCellSize once linked perfectly while the host never wrote them, so the
 * lookup divided by zero, every square read as outside, and the entire effect
 * rendered as nothing while every check passed. The check tool must also
 * assert that the host writes each of these.
 */
export const UNIFORMS = Object.freeze({
  uTime: "float",        // seconds since birth
  uTexel: "float",       // one device pixel, in grid units. 0 = inert
  uSeed: "float",        // per-area, so two fireballs do not flicker in lockstep
  uPlane: "float",       // 0 ground | 1 atmosphere | 2 boundary | 3 shade (MULTIPLY)
  uShape: "float",       // 0 burst | 1 cone | 2 emanation | 3 line
  uRadius: "float",      // grid squares
  uDirection: "float",   // radians
  uAngle: "float",       // radians, full cone angle (PF2e: always 90 degrees)
  uBase: "vec2",         // emanation: the token footprint half-extent
  uArch: "float",        // archetype index into ARCHETYPES
  uFunction: "float",    // canonical primary function index
  uSecondary: "float",   // optional secondary function index, -1 when absent
  uBehavior: "float",    // canonical behavior index
  uEnterMode: "float",   // 0 trace | 1 inscribe | 2 ignite
  uGridless: "float",    // 1 uses continuous Region geometry without a rules lattice
  uTint: "vec3",         // the archetype's lit body colour
  uTintHot: "vec3",      // its emissive core
  uAccent: "vec3",       // function-owned semantic accent
  uAtlas: "sampler2D",   // local channel-packed material atlas
  uAtlasRect: "vec4",    // normalized atlas tile x, y, width, height
  uAtlasReady: "float",  // 0 keeps the complete procedural fallback
  uMix: "vec3",          // treatment balance: ground, air, skirt
  uChar: "vec4",         // treatment character: scorch, motes, rim, turbulence
  uPhase: "vec4",        // enter, leave, shock, eased-enter
  uFx: "vec4",           // shed gates: motes, scorch, skirt, turbulence
  uAlpha: "float",
  uCells: "sampler2D",   // R: 0 outside, 0.5 blocked, 1 covered
  uCellOrigin: "vec2",   // grid offset of texel (0,0)
  uCellSize: "vec2",     // cell texture dimensions
  uGridOffset: "vec2",   // area origin in global grid units (may be half-cell)
});

/**
 * The shipped vertex shader. `aUvs` spans the Region's padded world-space
 * bounds; `uView` maps that quad into origin-relative grid coordinates. The
 * shared PIXI vertex only exposes texture UVs, while this fragment program
 * deliberately works in grid and screen space, so the two cannot be swapped.
 */
export const VERTEX_SHADER = `
attribute vec2 aVertexPosition;
attribute vec2 aUvs;
uniform mat3 translationMatrix;
uniform mat3 projectionMatrix;
uniform vec4 uView;
varying vec2 vGrid;
varying vec2 vScreen;
void main(void) {
  vScreen = aUvs;
  vGrid = uView.xy + aUvs * uView.zw;
  gl_Position = vec4((projectionMatrix * translationMatrix * vec3(aVertexPosition, 1.0)).xy, 0.0, 1.0);
}`;

/**
 * The preview's vertex shader. No PIXI matrices — the harness draws a
 * fullscreen quad per slot and maps it into grid space itself, so what the
 * fragment stage sees is identical to what it sees in Foundry.
 */
export const PREVIEW_VERTEX_SHADER = `
attribute vec2 aVertexPosition;
uniform vec4 uView;      // xy: grid coords at quad origin, zw: grid span
varying vec2 vGrid;
varying vec2 vScreen;
void main(void) {
  vScreen = aVertexPosition * 0.5 + 0.5;
  vGrid = uView.xy + vScreen * uView.zw;
  gl_Position = vec4(aVertexPosition, 0.0, 1.0);
}`;

const BODY = `
uniform float uTime, uSeed, uPlane, uShape, uRadius, uDirection, uAngle, uArch, uFunction, uSecondary, uBehavior, uAlpha, uEnterMode, uGridless, uAtlasReady;
uniform vec2 uBase, uCellOrigin, uCellSize, uGridOffset;
uniform vec3 uTint, uTintHot, uAccent;
uniform vec4 uAtlasRect;
uniform vec4 uPhase, uFx, uChar;
uniform vec3 uMix;
uniform sampler2D uCells;
uniform sampler2D uAtlas;

varying vec2 vGrid;
varying vec2 vScreen;

const float SEAM_PX = ${LAYOUT.latticeSeamPx.toFixed(3)};
const float RIM_PX  = ${LAYOUT.rimWidthPx.toFixed(3)};
const float SKIRT_RISE = ${LAYOUT.skirtRise.toFixed(3)};
const float SKIRT_FADE = ${LAYOUT.skirtFadeIn.toFixed(3)};
const float SCORCH_SPREAD = ${LAYOUT.scorchSpread.toFixed(3)};
const float MOTE_DENSITY = ${LAYOUT.moteDensity.toFixed(3)};
const float MOTE_RISE = ${LAYOUT.moteRise.toFixed(3)};
/* The frame. Hairlines in DEVICE PIXELS (px), reaches in grid squares. */
const float RULE_PX = ${LAYOUT.rulePx.toFixed(3)};
const float RULE_IN = ${LAYOUT.ruleInset.toFixed(3)};
const float ORBIT_PX = ${LAYOUT.orbitPx.toFixed(3)};
const float ORBIT_OUT = ${LAYOUT.orbitOut.toFixed(3)};
const float ORBIT_SEGMENTS = ${LAYOUT.orbitSegments.toFixed(1)};
const float FRES_REACH = ${LAYOUT.fresnelReach.toFixed(3)};
const float GLOW_REACH = ${LAYOUT.glowReach.toFixed(3)};
const float TICK_IN = ${LAYOUT.tickIn.toFixed(3)};
const float TICK_OUT = ${LAYOUT.tickOut.toFixed(3)};
const float DOT_PX = ${LAYOUT.dotPx.toFixed(3)};
const float SCAN_PERIOD = ${LAYOUT.scanPeriod.toFixed(3)};
const float LAND_REACH = ${LAYOUT.landReach.toFixed(3)};
const float ATLAS_INSET = ${LAYOUT.atlasInset.toFixed(5)};
const float ATLAS_SCALE_A = ${LAYOUT.atlasScaleA.toFixed(3)};
const float ATLAS_SCALE_B = ${LAYOUT.atlasScaleB.toFixed(3)};
const float GL_PI = 3.14159265;
const float GL_TAU = 6.28318531;

/* A hairline of a given DEVICE-PIXEL width, expressed in grid units. The floor
   keeps uTexel 0 inert rather than a divide by zero. */
float hairline(float d, float px) {
  return glFalloff(d, 1.0 / max(uTexel * px, 0.004));
}

/* ---- The true geometry ghost. A visual. Never a rules answer. ------------ */

float sdBurst(vec2 p, float r) { return length(p) - r; }

float sdEmanation(vec2 p, vec2 b, float r) {
  vec2 d = abs(p) - b;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - r;
}

float sdCone(vec2 p, float r, float dir, float ang) {
  float a = atan(p.y, p.x) - dir;
  a = atan(sin(a), cos(a));
  float wedge = (abs(a) - ang * 0.5) * max(length(p), 0.001);
  return max(wedge, length(p) - r);
}

float sdLine(vec2 p, float len, float w, float dir) {
  vec2 d = vec2(cos(dir), sin(dir));
  vec2 q = vec2(dot(p, d), dot(p, vec2(-d.y, d.x)));
  vec2 e = abs(vec2(q.x - len * 0.5, q.y)) - vec2(len * 0.5, w * 0.5);
  return length(max(e, 0.0)) + min(max(e.x, e.y), 0.0);
}

float areaSdf(vec2 p) {
  if (uShape < 0.5) return sdBurst(p, uRadius);
  if (uShape < 1.5) return sdCone(p, uRadius, uDirection, uAngle);
  if (uShape < 2.5) return sdEmanation(p, uBase, uRadius);
  return sdLine(p, uRadius, max(uBase.x, 0.01), uDirection);
}

/* Where a point sits along the OUTER BOUNDARY, 0 to 1, going round once. Only
   meaningful near the boundary itself, which is all the edge pen needs: it
   gates hairlines that live there and nothing else.

   A burst and an emanation are star-shaped about their own origin, so the angle
   from that origin traverses their perimeter monotonically and IS the
   parameterisation. A CONE is the exception, and the reason this function
   exists: two of its three boundary segments are radial lines from the apex, so
   every point along one shares a single angle and the entire edge lights at
   once — a laser rather than a stroke. Those two are parameterised by radius
   instead, and the three segments are stitched in proportion to their true
   lengths (all measured in units of the radius) so the pen travels at one
   constant speed the whole way round rather than crawling the arc and jumping
   the edges. */
float perimeterOrd(vec2 p) {
  float ang = atan(p.y, p.x) - uDirection;
  ang = atan(sin(ang), cos(ang));

  if (uShape > 0.5 && uShape < 1.5) {
    float halfA = max(uAngle, 0.001) * 0.5;
    float rr = clamp(length(p) / max(uRadius, 0.001), 0.0, 1.0);
    float aa = clamp(ang / (halfA * 2.0) + 0.5, 0.0, 1.0);
    float arcLen = uAngle;
    float total = 2.0 + arcLen;
    /* Which of the three segments is nearest. The edge distances are scaled by
       rr because an angular error close to the apex is a small real distance. */
    float dArc = abs(rr - 1.0);
    float dA = abs(ang + halfA) * rr;
    float dB = abs(ang - halfA) * rr;
    if (dArc <= dA && dArc <= dB) return (1.0 + aa * arcLen) / total;
    if (dA < dB) return rr / total;
    return (1.0 + arcLen + (1.0 - rr)) / total;
  }

  if (uShape > 2.5) {
    /* A line's origin sits at one END, so the same degeneracy applies to its
       near cap. Run down one long side, across the far end, and back up the
       other; the caps fold into the sides, which is invisible at a width of one
       square. */
    float L = max(uRadius, 0.001);
    vec2 dv = vec2(cos(uDirection), sin(uDirection));
    vec2 q = vec2(dot(p, dv), dot(p, vec2(-dv.y, dv.x)));
    float u = clamp(q.x / L, 0.0, 1.0);
    float total = 2.0 * L + 2.0;
    if (q.y < 0.0) return (u * L) / total;
    return (L + 1.0 + (1.0 - u) * L) / total;
  }

  return clamp(ang / GL_TAU + 0.5, 0.0, 1.0);
}

/* Domain warping: displace the coordinates by a second noise field before
   sampling the first. It is the cheapest way to turn fbm — which always looks
   like fbm — into something with filaments, eddies and folds, and it is most of
   the difference between a noise field that reads as a material and one that
   reads as a stain.

   The warp is ADVECTED, not evolved: the field translates and its structure
   persists. Evolving the noise in place is what makes an effect look like a
   lava lamp, because nothing keeps its identity from one second to the next. */
/* ---- gradient noise ------------------------------------------------------
   The shared pool's value noise interpolates HEIGHTS at lattice points, and
   its blobs sit on that lattice — which is the "cloud filter" look, and the
   single strongest cheap signal in the old fill. Gradient noise interpolates
   SLOPES: its features fall between lattice points, at every scale, and it
   is what every material here that has to read as matter is built on now. */
vec2 aoeGrad(vec2 i) {
  float a = gluHash1(i) * GL_TAU;
  return vec2(cos(a), sin(a));
}
float aoeGnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = dot(aoeGrad(i), f);
  float b = dot(aoeGrad(i + vec2(1.0, 0.0)), f - vec2(1.0, 0.0));
  float c = dot(aoeGrad(i + vec2(0.0, 1.0)), f - vec2(0.0, 1.0));
  float d = dot(aoeGrad(i + vec2(1.0, 1.0)), f - vec2(1.0, 1.0));
  return clamp(0.5 + 0.72 * mix(mix(a, b, u.x), mix(c, d, u.x), u.y), 0.0, 1.0);
}
float aoeFbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * aoeGnoise(p); p = p * 2.03 + 7.1; a *= 0.5; }
  return s / 0.9375;
}

vec2 gluWarp(vec2 p, vec2 flow, float amp) {
  float a = aoeFbm(p * 0.75 + flow);
  float b = aoeFbm(p * 0.75 + flow.yx + 5.23);
  return p + vec2(a - 0.5, b - 0.5) * amp;
}

/* The scene remains the shadow stop. Only genuinely energetic detail moves
   from the archetype tint through its hot colour toward white. This keeps the
   overlay transparent without flattening every material into one colour. */
/* Three stops, not two. The bottom of the ramp is a DEEP stop — the tint
   squared, which is darker and more saturated — so the body of an area sits
   in a rich version of its own hue and the boundary rises out of it through
   the tint to the hot stop. A ramp that starts at the tint has nowhere to go
   but brighter, and everything in it drifts toward one pale wash. */
vec3 archRamp(float x) {
  x = clamp(x, 0.0, 1.0);
  vec3 deep = mix(uTint * uTint, uTint, 0.35);
  vec3 c = mix(deep, uTint, smoothstep(0.0, 0.40, x));
  c = mix(c, uTintHot, smoothstep(0.48, 0.90, x));
  return mix(c, vec3(1.0), smoothstep(0.93, 1.0, x) * 0.30);
}

/* An ordered-ish dither, one 255th of a unit. Every gradient here is a long
   smooth ramp across many pixels, which is exactly where 8-bit banding shows;
   a sub-quantum of noise costs nothing and removes all of it. */
float gluDither(vec2 fc) {
  return (fract(sin(dot(fc, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
}

/* ---- The rules table, read not derived ---------------------------------- */

float cellAt(vec2 cell) {
  vec2 uv = (cell - uCellOrigin + 0.5) / uCellSize;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return 0.0;
  return texture2D(uCells, uv).r;
}

/* ---- Archetype behaviour -------------------------------------------------
   Twelve material branches live here, one per damage family, plus the Generic
   utility field and Warning Zone telegraph.
   intentionally flat field. The question this first set of three existed to
   answer was whether material branches were justified at all: if ember, frost and arc read as one effect in three
   colours, then colour is the entire axis and the other nine branches are cost
   with no payoff.

   So they are written to differ in the one thing colour cannot carry — how the
   matter behaves over time:
     ember  continuous and rising. Ridged noise advected upward; it boils.
     frost  still. Faceted plates that hold their shape and creep; the opposite
            of boiling, and near-motionless on purpose.
     arc    intermittent. Filaments that strike and die with dead air between,
            so most frames are quiet and the ones that are not are violent.

   This matters beyond taste. PF2e's cold and electricity are neighbours in hue
   and no palette honestly separates them, so if the two are to be told apart
   across a table it has to be done here.

   Every branch must return a value a flat plate can stand in for: uFx.w mixes
   the whole thing against a constant when turbulence is shed, and readability
   is not a quality tier. */

float emberFill(vec2 p, float t) {
  float rise = t * 0.62;
  float n1 = aoeFbm(p * 0.85 + vec2(0.0, -rise));
  float n2 = aoeFbm(p * 2.05 + vec2(rise * 0.28, -rise * 1.7));
  float cell = 1.0 / 0.85;
  float ridge = glRidge(n1, cell * 0.35, cell);
  float churn = mix(ridge, n2, 0.35);
  return clamp(churn * 1.25, 0.0, 1.6);
}

/* One family of noise-warped parallel creases. Kept as a SECONDARY term only:
   on its own it reads as crackle or as a spider web, not as ice.

   The crease distance is divided back into GRID UNITS before it reaches
   glEdge, because glEdge widens by uTexel — one device pixel measured in grid
   units — and handing it a value in cycles widens by the wrong factor at every
   zoom, which no single-zoom preview will show you. */
float frostShard(vec2 p, float ang, float freq, float seed) {
  vec2 d = vec2(cos(ang), sin(ang));
  float x = dot(p, d) * freq + gluVNoise(p * 0.8 + seed) * 2.2;
  float r = abs(fract(x) - 0.5) / freq;
  return 1.0 - glEdge(0.05, 0.24, r);
}

/* Frost on glass grows DENDRITICALLY, outward from nucleation points, with the
   six-fold symmetry ice actually has. That radial growth is the whole reason a
   frost pattern is recognisable as frost, and it is the thing neither of the
   two earlier attempts had: quantised smooth noise gave rounded contours that
   read as marble, and crossed crease families gave an even mesh that read as
   crackle. Both are isotropic. Ice is not — it points away from where it
   started.

   Three by three cells because an arm reaches past its own cell and a nucleus
   just outside the one you are in still has to contribute; drop to the centre
   cell and the pattern breaks into visible squares. */
float frostFlower(vec2 g, float seed) {
  vec2 ci = floor(g);
  float acc = 0.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 cell = ci + vec2(float(i), float(j));
      float h  = gluHash1(cell + seed);
      float h2 = gluHash1(cell + seed + 17.0);
      vec2 d = g - (cell + vec2(h, h2));
      float r = length(d);
      if (r > 1.25) continue;
      float th = atan(d.y, d.x) + h * 6.283;
      /* The arms sharpen with distance from the nucleus. Held sharp all the
         way in, the angular frequency at the centre outruns the pixel grid and
         the core buzzes; this is the same problem glDetail solves for a ridge,
         in the angular domain. */
      float sharp = mix(4.0, 15.0, smoothstep(0.04, 0.45, r));
      float arms = pow(abs(cos(th * 3.0)), sharp);
      /* Side branches: the same six arms, phase-shifted along the radius, which
         is what makes a dendrite rather than a star. */
      float branch = pow(abs(cos(th * 3.0 + sin(r * 8.5) * 0.95)), sharp * 0.55) * 0.45;
      float fall = exp(-r * 2.5) * (1.0 - glEdge(0.95, 1.25, r));
      acc = max(acc, (arms + branch) * fall);
    }
  }
  return acc;
}

float frostFill(vec2 p, float t) {
  /* Frost does not flow, it accretes, so nothing here is advected: the field
     creeps an order of magnitude slower than ember rises and that is the only
     motion in it.

     The body term is deliberately THIN. Frost is the structure, not the space
     between it, and a filled slab does two bad things at once: it saturates
     toward the hot colour so the whole area reads white, and it drowns the
     lattice seams and the rim — which on the grounded treatment are the first
     thing anyone is meant to read. */
  float creep = t * 0.05;
  vec2 q = p + vec2(creep * 0.18, creep * 0.12);
  float flower = frostFlower(q * 0.55, 0.0);
  /* A finer second generation growing in the gaps left by the first. */
  float fine = frostFlower(q * 1.35 + 31.0, 57.0) * 0.42;
  /* Two long fractures for some straight structure among the dendrites. Pure
     dendrites read as feathers; these are what say the surface is hard. */
  float fr = max(frostShard(q, 0.35, 0.55, 5.0),
                 frostShard(q, 2.05, 0.55, 61.0)) * 0.26;
  float body = 0.09 + 0.13 * gluFbm(q * 0.9);
  return clamp(body + flower * 1.20 + fine + fr, 0.0, 1.7);
}

float arcFill(vec2 p, float t) {
  /* Strikes, not a flow. An area of electricity that glows steadily is a fire
     with a different palette, so the envelope has a hard attack, a short decay
     and dead time after it, and the filament path is RE-SEEDED each slot so
     the discharge lands somewhere new rather than pulsing in place. */
  float rate = 3.4;
  float slot = floor(t * rate);
  float ph = fract(t * rate);
  float sd = gluHash1(vec2(slot, 3.0));
  float strike = exp(-ph * 9.0);

  float n = gluFbm(p * 1.5 + vec2(sd * 37.0, sd * 19.0));
  float cell = 1.0 / 1.5;
  float fil = glRidge(n, cell * 0.16, cell);
  fil = fil * fil * fil;

  /* The floor the strike sits on. Without it the area is invisible between
     discharges, and "which squares am I in" would depend on catching a frame. */
  /* Raised once the ramp gained a dark shadow stop: at 0.20 the idle sat below
     the ramp's first knee and arc turned into a muddy near-black rectangle
     between strikes, which is not the same thing as quiet. */
  float glow = 0.30 + 0.14 * gluFbm(p * 0.7 + vec2(0.0, -t * 0.3));

  /* A faint always-on filament under the strike. Without it the quiet frames
     are a flat wash and the effect looks switched off between discharges
     rather than idling.

     FAINT is the operative word, and 0.35 was already too much: the whole
     identity of this archetype is the contrast between the quiet and the
     discharge, and an idle bright enough to compete with the strike costs more
     than the flat wash it fixes. It reads as texture, not as activity. */
  return clamp(glow + fil * 0.20 + fil * strike * 5.5, 0.0, 1.8);
}

/* A hexagonal cell boundary distance. Force is the one archetype that must not
   look organic at all: it is a constructed thing, so it gets a constructed
   tessellation rather than any noise field. */
/* The hexagonal "radius" of a point within its cell: 0 at the centre, 0.5 on
   the edge. max of the axis distance and the projection onto the 30-degree
   normal is what gives six sides rather than four. */
float hexRadius(vec2 p) {
  p = abs(p);
  return max(dot(p, vec2(0.5, 0.8660254)), p.x);
}

/* Distance to the nearest hex cell EDGE. Two interleaved rectangular lattices
   offset by half a cell give the hex packing; whichever centre is nearer owns
   the point.

   The first version took a min of two axis distances and produced diagonal
   herringbone stripes — plausible-looking, completely not hexagons, and
   nothing about it was visible except by rendering it. */
float hexEdge(vec2 p) {
  const vec2 r = vec2(1.0, 1.7320508);
  vec2 h = r * 0.5;
  vec2 a = mod(p, r) - h;
  vec2 b = mod(p - h, r) - h;
  vec2 gv = dot(a, a) < dot(b, b) ? a : b;
  return 0.5 - hexRadius(gv);
}

float causticFill(vec2 p, float t) {
  /* Acid does not burn, it EATS: bubbles swell out of a pool and pop, and the
     pop is the readable event. The cut at the end of a bubble's life is
     deliberate — one that fades out reads as a soft glow, not as something
     bursting.

     One bubble per cell, all the same size, is the DOT SCREEN failure again in
     a different coat: it came out as polka dots. A quarter of the cells carry
     nothing, the survivors vary in size by a factor of two, and their phases
     are independent. */
  vec2 bp = p * 1.9;
  vec2 bc = floor(bp);
  float h = gluHash1(bc), h2 = gluHash1(bc + 13.0), h3 = gluHash1(bc + 57.0);
  float alive = step(0.26, h3);
  float life = fract(h + t * (0.35 + h2 * 0.30));
  float rad = (0.09 + 0.30 * life) * mix(0.55, 1.30, h3);
  float pop = 1.0 - glEdge(0.80, 0.98, life);
  vec2 c = fract(bp) - vec2(0.24 + h * 0.52, 0.24 + h2 * 0.52);
  float d = length(c);
  float bub = (1.0 - glEdge(rad * 0.65, rad, d)) * pop * alive;
  float rim = glGauss(d - rad, 9.0) * pop * alive * 0.75;
  float pool = 0.24 + 0.34 * gluFbm(p * 0.8 + vec2(0.0, t * 0.10));
  return clamp(pool + bub * 0.50 + rim, 0.0, 1.7);
}

float resonanceFill(vec2 p, float t) {
  /* Sound is a WAVE and the only honest way to draw one is to let it travel.
     Two slightly different wavelengths beat against each other; a single ring
     spacing reads as a target painted on the floor rather than as anything
     propagating. Damped near the origin, where the ring spacing outruns the
     pixel grid. */
  float r = length(p);
  float w1 = sin((r - t * 2.2) * 4.2);
  float w2 = sin((r - t * 1.7) * 6.1);
  float ring = max(0.0, w1 * 0.60 + w2 * 0.40);
  ring = ring * ring * glDetail(0.24);
  float body = 0.20 + 0.10 * gluFbm(p * 1.1 + t * 0.2);
  return clamp(body + ring * 0.95, 0.0, 1.6);
}

float radianceFill(vec2 p, float t) {
  /* Light does not churn. Rays from the centre, breathing slowly, and a core
     that is genuinely brightest at the origin — the one archetype where the
     middle of the area is the loudest part of it. */
  float r = length(p);
  float a = atan(p.y, p.x);
  float rays = 0.5 + 0.5 * sin(a * 9.0 + gluVNoise(p * 0.5) * 2.0);
  rays = pow(rays, 2.2) * smoothstep(0.0, 0.9, r);
  float breathe = 0.84 + 0.16 * sin(t * 1.1);
  float core = exp(-r * 0.38);
  return clamp((0.30 + rays * 0.44) * breathe + core * 0.38, 0.0, 1.6);
}

float umbraFill(vec2 p, float t) {
  /* Void has to read as something OCCLUDING, not as something glowing, so the
     ridge is inverted: what is bright here is the gaps between the tendrils.
     Its emissive contribution is low on purpose and most of its presence comes
     from the shade pass — this is the one archetype that is mostly subtraction. */
  float n = aoeFbm(p * 0.9 + vec2(t * 0.10, -t * 0.16));
  float n2 = aoeFbm(p * 2.2 - vec2(t * 0.20, t * 0.05));
  float tendril = 1.0 - glRidge(n, 0.40, 1.1);
  /* Raised from a near-black field: void is meant to be the darkest archetype,
     not an unlit one. Its darkness is the shade pass's job (0.86, the highest
     here); this still has to show what it is made of. */
  return clamp(0.20 + tendril * 0.52 + n2 * 0.20, 0.0, 1.3);
}

float spiritFill(vec2 p, float t) {
  /* Wisps: slower than flame, softer than frost, drifting laterally rather
     than climbing, and nothing here has a hard edge.

     "No hard edges" is not the same as "no structure", which is what the first
     version came out as — an even green haze that could have been any of four
     other archetypes at a glance. Two ridge generations at different scales
     and different drifts give it something to be, while the flat veil under
     them drops to almost nothing. */
  float drift = t * 0.16;
  float n  = aoeFbm(p * 0.70 + vec2(sin(t * 0.25) * 0.40, -drift));
  float n2 = aoeFbm(p * 1.55 + vec2(-drift * 0.70, -drift * 1.50) + 19.0);
  float wisp = glRidge(n, 0.50, 1.40);
  float fine = glRidge(n2, 0.22, 0.65) * 0.55;
  float veil = 0.09 + 0.10 * gluFbm(p * 2.2 + vec2(drift * 0.3, -drift));
  return clamp(veil + wisp * 0.88 + fine, 0.0, 1.5);
}

float forceFill(vec2 p, float t) {
  /* Constructed, not grown. A hex tessellation with cells that shimmer out of
     phase with each other, and deliberately no noise in the structure itself —
     the only randomness is which cell is bright. */
  float e = hexEdge(p * 1.25) / 1.25;
  float lattice = 1.0 - glEdge(0.03, 0.13, e);
  float cellPhase = gluHash1(floor(p * 1.25 * 1.6));
  float shimmer = 0.5 + 0.5 * sin(t * 1.6 + cellPhase * 6.283);
  return clamp(0.14 + lattice * (0.68 + 0.42 * shimmer), 0.0, 1.6);
}

float kineticFill(vec2 p, float t) {
  /* Debris neither flows nor glows. It is scattered, hard-edged, and it
     SETTLES: the motion runs out, which is unique here and is most of what
     makes it read as physical rather than elemental. */
  float settle = min(t * 0.30, 1.0);
  vec2 q = p + vec2(0.0, settle * 0.35);
  float grit = gluVNoise(q * 5.5);
  float chunk = 1.0 - glEdge(0.55, 0.72, grit);
  float dust = gluFbm(q * 1.6) * 0.35;
  return clamp(0.20 + chunk * 0.55 + dust, 0.0, 1.5);
}

float verdantFill(vec2 p, float t) {
  /* Grease, web, entangling terrain: matte, fibrous, no emissive core at all.
     Reuses frostShard's creases as STRANDS — the same construction reads as
     fibre at a high frequency and as fracture at a low one, and one well-tested
     helper beats a second one that aliases differently.

     The mulch under them is kept LOW. At a higher value the strands drowned in
     it and the whole archetype came out as a flat green disc, which is the one
     outcome that makes a twelfth branch pointless. Four families rather than
     three, at spread frequencies, so the weave has a scale to it. */
  float sway = sin(t * 0.5) * 0.06;
  vec2 q = p + vec2(sway, 0.0);
  float coarse = max(frostShard(q, 0.9, 1.5, 3.0),
                     frostShard(q, 2.4, 1.3, 71.0));
  float fine = max(frostShard(q, 1.7, 3.4, 129.0),
                   frostShard(q, 0.3, 3.9, 211.0));
  float mulch = 0.14 + 0.16 * gluFbm(q * 1.1);
  return clamp(mulch + coarse * 0.62 + fine * 0.42, 0.0, 1.5);
}

float arcaneFill(vec2 p, float t) {
  /* The fallback: untyped damage, and every area that deals none. It has to say
     "an area is here" while claiming NO element, so it is geometric, quiet and
     slow — a diagram rather than a substance. */
  float r = length(p);
  float rings = 1.0 - glEdge(0.03, 0.11, abs(fract(r * 1.1 - t * 0.10) - 0.5) / 1.1);
  float a = atan(p.y, p.x);
  float spokes = 1.0 - glEdge(0.04, 0.14, abs(fract(a * 1.9099 + 0.5) - 0.5) * max(r, 0.4));
  return clamp(0.16 + rings * 0.34 + spokes * 0.30, 0.0, 1.4);
}

float genericFill(vec2 p, float t) {
  /* Deliberately featureless. Generic is the GM's ad-hoc colour field, not a
     thirteenth fictional substance. The rules lattice and boundary provide all
     of its structure; p and t are accepted only to keep the branch signature
     uniform. */
  return 0.52 + 0.0 * (p.x + t);
}

/* Warning Zone is a game telegraph, not a fictional substance. Every moving
   part shares this clock: the field breathes, one radial scanner turns, and an
   inward countdown ring closes. Keeping those on one phase makes the motion
   feel intentional instead of like three unrelated warning animations. */
float warningBeat(float t) {
  return 0.5 + 0.5 * sin(t * 4.4879895); /* one 1.4-second cycle */
}

float warningFill(vec2 p, float t) {
  float phase = fract(t / 1.4);
  float extent = max(max(uRadius, uBase.x), max(uBase.y, 0.5));
  float r = length(p) / extent;
  float angle = atan(p.y, p.x) / GL_TAU + 0.5;
  float scanD = abs(fract(angle - phase + 0.5) - 0.5);
  float scanner = 1.0 - glEdge(0.010, 0.055, scanD);
  scanner *= glEdge(0.06, 0.22, r);

  float countdownRadius = mix(0.92, 0.10, phase);
  float countdown = 1.0 - glEdge(0.014, 0.050, abs(r - countdownRadius));
  float sectorWake = 1.0 - glEdge(0.04, 0.22, scanD);
  float beat = warningBeat(t);

  return clamp(0.22 + beat * 0.20 + sectorWake * 0.12
             + scanner * 0.50 + countdown * 0.42, 0.0, 1.45);
}

/* What the area does to the FLOOR, as a colour to multiply toward and a
   strength. This exists entirely because of bright maps.

   Every other pass composites OVER. On a dark floor that is enough: the effect
   out-lights what is under it and contrast is free. On a lit flagstone map it
   is not — a partly transparent orange over pale stone is DIMMER than the
   stone, so the area reads as a wash laid on the map instead of as fire on a
   floor. Real fire on a pale floor takes its contrast from both directions at
   once: the floor darkens where it burns and the flame out-lights what is
   left. The over-passes do the second; this does the first, and it cannot be
   folded into them, because darkening needs the destination and one over-blend
   cannot both subtract from and add to it.

   Multiply is self-limiting, which is why it is safe to leave on everywhere: on
   a dark map the destination is already dark and this changes almost nothing.

   Not every archetype marks the floor. Light and sound do not, and their
   strength is near zero by design. */
vec4 archShade(vec2 p, float t) {
  if (uArch <  0.5) return vec4(0.34, 0.15, 0.08, 0.66);  /* ember      burnt */
  if (uArch <  1.5) return vec4(0.55, 0.80, 0.96, 0.60);  /* frost      cooled, barely darkened */
  if (uArch <  2.5) return vec4(0.44, 0.52, 0.88, 0.52);  /* arc        lightly seared */
  if (uArch <  3.5) return vec4(0.32, 0.40, 0.10, 0.72);  /* caustic    eaten */
  if (uArch <  4.5) return vec4(0.72, 0.62, 0.82, 0.24);  /* resonance  sound marks nothing */
  if (uArch <  5.5) return vec4(0.98, 0.94, 0.82, 0.14);  /* radiance   light marks nothing */
  if (uArch <  6.5) return vec4(0.10, 0.07, 0.16, 0.86);  /* umbra      this IS the effect */
  if (uArch <  7.5) return vec4(0.72, 0.86, 0.82, 0.20);  /* spirit     a chill, no more */
  if (uArch <  8.5) return vec4(0.74, 0.82, 0.94, 0.22);  /* force      a construct, not a mark */
  if (uArch <  9.5) return vec4(0.38, 0.30, 0.26, 0.58);  /* kinetic    dust and debris */
  if (uArch < 10.5) return vec4(0.30, 0.38, 0.22, 0.70);  /* verdant    covers the floor */
  if (uArch < 11.5) return vec4(0.62, 0.60, 0.78, 0.32);  /* arcane     a light stain */
  if (uArch < 12.5) return vec4(0.76, 0.78, 0.86, 0.18);  /* generic    neutral contact */
  return vec4(0.34, 0.04, 0.06, 0.42);                    /* warning    hazard contrast */
}

float archFill(vec2 p, float t) {
  if (uArch <  0.5) return emberFill(p, t);
  if (uArch <  1.5) return frostFill(p, t);
  if (uArch <  2.5) return arcFill(p, t);
  if (uArch <  3.5) return causticFill(p, t);
  if (uArch <  4.5) return resonanceFill(p, t);
  if (uArch <  5.5) return radianceFill(p, t);
  if (uArch <  6.5) return umbraFill(p, t);
  if (uArch <  7.5) return spiritFill(p, t);
  if (uArch <  8.5) return forceFill(p, t);
  if (uArch <  9.5) return kineticFill(p, t);
  if (uArch < 10.5) return verdantFill(p, t);
  if (uArch < 11.5) return arcaneFill(p, t);
  if (uArch < 12.5) return genericFill(p, t);
  return warningFill(p, t);
}

/* The particulate standing in the air, which has to change with the archetype
   for the same reason the fill does: embers rise and gutter, frost does not
   rise at all, and electricity throws sparks only when it discharges. One
   rising-mote model tinted across every material is exactly the failure this review was
   meant to catch.

   FOUR CLASSES, NOT ONE PER MATERIAL. Near-identical mote models would be
   things to keep in sync for a difference nobody can see; what has to differ
   is the class of motion, and there are four of those. The fill carries the
   rest of each archetype's identity. */
int moteClass() {
  if (uArch <  0.5) return 0;   /* ember      rise  */
  if (uArch <  1.5) return 1;   /* frost      glint */
  if (uArch <  2.5) return 2;   /* arc        spark */
  if (uArch <  3.5) return 3;   /* caustic    fall  */
  if (uArch <  4.5) return 2;   /* resonance  spark */
  if (uArch <  5.5) return 0;   /* radiance   rise  */
  if (uArch <  6.5) return 3;   /* umbra      fall  */
  if (uArch <  7.5) return 0;   /* spirit     rise  */
  if (uArch <  8.5) return 1;   /* force      glint */
  if (uArch <  9.5) return 3;   /* kinetic    fall  */
  if (uArch < 10.5) return 3;   /* verdant    fall  */
  if (uArch < 11.5) return 1;   /* arcane     glint */
  if (uArch < 12.5) return 4;   /* generic    none  */
  return 4;                     /* warning    none: its telegraph is disciplined */
}

float archMotes(vec2 p, float t) {
  vec2 mp = p * MOTE_DENSITY;
  vec2 mc = floor(mp);
  float mh  = gluHash1(mc);
  float mh2 = gluHash1(mc + 31.7);
  float mh3 = gluHash1(mc + 91.3);
  /* One per noise cell, all the same size and brightness, is a DOT SCREEN —
     and this effect already sits on a lattice, so a second regular one over it
     reads as an artefact instantly. A third of the cells carry nothing, the
     survivors jitter on both axes, and size and brightness vary per mote. */
  float alive = step(0.34, mh3);
  int cls = moteClass();

  if (cls == 4) return 0.0;

  if (cls == 1) {
    /* glint — sits on the plate and catches the light rather than climbing off
       it, so the air above the area stays still. */
    float tw = 0.5 + 0.5 * sin(t * (1.1 + mh * 1.7) + mh2 * 6.283);
    vec2 gp = fract(mp) - vec2(0.30 + mh2 * 0.42, 0.30 + mh * 0.42);
    return glSpot(length(gp) - 0.01, mix(20.0, 34.0, mh2))
         * alive * pow(tw, 4.0) * mix(0.5, 1.0, mh3);
  }

  if (cls == 2) {
    /* spark — on the discharge and gone. Same clock as arcFill's strike,
       deliberately: two independent flicker rates read as two effects. */
    float rate = 3.4;
    float slot = floor(t * rate);
    float ph = fract(t * rate);
    float live = step(mh, 0.26) * exp(-ph * 13.0);
    vec2 sp = fract(mp) - vec2(0.5 + (mh2 - 0.5) * 0.8, 0.5 + (mh3 - 0.5) * 0.8);
    return glSpot(length(sp) - 0.01, 26.0) * live * alive * gluHash1(mc + slot);
  }

  if (cls == 3) {
    /* fall — ash, spores, sediment. Downward and slowing, the opposite of an
       ember, and the difference is legible at a glance in a way that a change
       of hue is not. */
    float life = fract(mh + t * (0.18 + mh * 0.14));
    vec2 mpos = fract(mp) - vec2(0.5 + (mh2 - 0.5) * 0.70, 1.0 - life);
    return glSpot(length(mpos) - 0.02, mix(16.0, 30.0, mh2))
         * (1.0 - life * 0.5) * alive * mix(0.35, 0.90, mh3);
  }

  /* rise — embers and motes of light. They do not climb a plumb line. */
  float life = fract(mh + t * (0.26 + mh * 0.22));
  vec2 mpos = fract(mp) - vec2(0.5 + (mh2 - 0.5) * 0.72, life);
  mpos.x += (mh3 - 0.5) * 0.22 * sin(t * 1.6 + mh * 6.283);
  return glSpot(length(mpos) - 0.02, mix(15.0, 30.0, mh2)) * (1.0 - life)
       * alive * mix(0.40, 1.0, mh3);
}

/* ---- the tactical frame ---------------------------------------------------
   Everything below is what turned this from a coloured disc into a projected
   instrument: a boundary drawn as a FRAME (one crisp rule on the rules edge,
   corner brackets on its convex corners, a finer inset rule, a wide soft glow
   outside and a fresnel band falling away inside), a dashed orbit ring on the
   true geometry that turns at the behaviour's own pace, direction chevrons on
   cones and lines, and a scan pulse that runs from the origin to the edge. It
   is the language of a targeting overlay — Endfield's grid decals, Star Rail's
   attack indicators — and it does what a translucent tint never can: it says
   "this is a precise thing that has been placed" before it says what it is
   made of. */

float sdBox(vec2 p, float b) {
  vec2 d = abs(p) - b;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}

/* Signed distance to the AREA — the covered-plus-blocked set of squares — from
   the 3×3 squares around p. Negative inside. Exact within a square, which is
   all the frame's bands reach, and clamped at 2 beyond. This is what lets a
   band be drawn AGAINST THE STAIRCASE PF2e actually uses rather than against
   the smooth ghost: a glow that follows the circle while the rule follows the
   squares reads as two shapes disagreeing, and on a rules lattice that is a
   bug, not a style. */
float latticeSdf(vec2 p, vec2 cell, float inside) {
  float dIn = 2.0, dOut = 2.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 c = cell + vec2(float(i), float(j));
      float s = step(0.25, cellAt(c));
      float d = sdBox(p - (c + 0.5), 0.5);
      dOut = min(dOut, mix(2.0, d, s));
      dIn  = min(dIn,  mix(d, 2.0, s));
    }
  }
  return mix(dOut, -dIn, inside);
}

/* 1 near a CONVEX corner of the area: the square is inside and both of the
   squares across that corner's two edges are not. Bracket marks live there. */
float cornerTick(vec2 p, vec2 cell, float inside) {
  vec2 f = fract(p + uGridOffset);
  vec2 side = step(0.5, f) * 2.0 - 1.0;
  vec2 corner = cell + step(0.5, f);
  float nx = step(0.25, cellAt(cell + vec2(side.x, 0.0)));
  float ny = step(0.25, cellAt(cell + vec2(0.0, side.y)));
  float convex = inside * (1.0 - nx) * (1.0 - ny);
  return convex * (1.0 - glEdge(TICK_IN, TICK_OUT, length(p - corner)));
}

/* Behaviour sets the pace of every idle motion in the frame, so the rhythm a
   profile declares is visible in the frame as well as in the material. */
float behaviourPace() {
  if (uBehavior < 0.5) return 1.20;   /* impact  */
  if (uBehavior < 1.5) return 1.00;   /* pulse   */
  if (uBehavior < 2.5) return 0.85;   /* flow    */
  if (uBehavior < 3.5) return 0.55;   /* grow    */
  if (uBehavior < 4.5) return 0.35;   /* contain */
  if (uBehavior < 5.5) return 1.60;   /* sweep   */
  if (uBehavior < 6.5) return 0.45;   /* linger  */
  if (uBehavior < 7.5) return 0.40;   /* sustain */
  if (uBehavior < 8.5) return 1.30;   /* trigger */
  return 0.0;                         /* static  */
}

/* The dashed ring on the true geometry, a little outside it, turning. 60% duty
   so it reads as a segmented reticle rather than a dotted line. */
float orbitRing(vec2 p, float sdf, float t) {
  float pace = behaviourPace();
  float seg = fract(perimeterOrd(p) * ORBIT_SEGMENTS - t * pace * 0.045);
  float on = glEdge(0.0, 0.07, seg) * (1.0 - glEdge(0.56, 0.63, seg));
  return hairline(sdf - ORBIT_OUT, ORBIT_PX) * on;
}

/* Direction chevrons for cones and lines: one per square along the axis, the
   arms trailing the tip, drifting outward at the behaviour's pace. */
float chevrons(vec2 p, float t) {
  if (uShape < 0.5 || (uShape > 1.5 && uShape < 2.5)) return 0.0;
  vec2 d = vec2(cos(uDirection), sin(uDirection));
  vec2 q = vec2(dot(p, d), dot(p, vec2(-d.y, d.x)));
  float halfW = uShape > 2.5 ? min(0.42, max(uBase.x, 0.2) * 0.45) : 0.42;
  float k = q.x - t * behaviourPace() * 0.35;
  float m = abs(fract(k + abs(q.y) * 0.8 + 0.5) - 0.5);
  float mark = 1.0 - glEdge(0.0, 0.05, m);
  float gate = (1.0 - glEdge(halfW - 0.06, halfW, abs(q.y))) * glEdge(0.7, 1.1, q.x);
  return mark * gate;
}

void main(void) {
  float eased = uPhase.w;      /* the nib's position along its stroke, 0 -> 1 */
  float enter = uPhase.x;      /* the same entrance, linear */
  vec2 p = vGrid;
  float t = uTime;
  bool onGround = uPlane < 0.5;
  bool onAir = uPlane > 0.5 && uPlane < 1.5;
  bool onEdge = uPlane > 1.5 && uPlane < 2.5;
  bool onShade = uPlane > 2.5;

  float sdf = areaSdf(p);
  /* PF2e cone and line origins may sit on edge midpoints. The global grid
     phase keeps those half-cell origins aligned with the texture uploaded by
     the host; floor(vGrid) alone shifts their rules lattice by half a square. */
  vec2 cell = floor(vGrid + uGridOffset) - uGridOffset;
  float state = cellAt(cell);

  /* Neighbour states: the lattice boundary is where the covered set ends, and
     is a different thing from the smooth SDF edge. Both are drawn; they carry
     different information and PF2e's squares genuinely diverge from geometry. */
  float nL = cellAt(cell + vec2(-1.0, 0.0));
  float nR = cellAt(cell + vec2( 1.0, 0.0));
  float nD = cellAt(cell + vec2( 0.0,-1.0));
  float nU = cellAt(cell + vec2( 0.0, 1.0));

  vec2 f = fract(vGrid + uGridOffset);
  float dEdge = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y));

  /* Interior seams only: a covered square meeting a blocked one. The seam
     against the outside is the frame's job now, and drawing it twice was
     most of what made the old edge read as fuzzy. */
  float diff = 0.0;
  diff = max(diff, abs(nL - state) * (1.0 - smoothstep(0.0, 0.5, f.x)));
  diff = max(diff, abs(nR - state) * (1.0 - smoothstep(0.0, 0.5, 1.0 - f.x)));
  diff = max(diff, abs(nD - state) * (1.0 - smoothstep(0.0, 0.5, f.y)));
  diff = max(diff, abs(nU - state) * (1.0 - smoothstep(0.0, 0.5, 1.0 - f.y)));
  float diffIn = step(0.25, diff) * (1.0 - step(0.75, diff));

  float covered = step(0.75, state);
  float blocked = step(0.25, state) * (1.0 - covered);
  float inside = covered + blocked;

  /* Gridless Scenes have no rules lattice to communicate. Use the Region's
     continuous shape instead, and suppress all square-cell structure. The
     small floor keeps the edge antialiased in diagnostic renders where
     uTexel intentionally defaults to zero. */
  float shapeEdge = max(uTexel, 0.002);
  float shapeCovered = 1.0 - glEdge(-shapeEdge, shapeEdge, sdf);
  covered = mix(covered, shapeCovered, uGridless);
  inside = mix(inside, shapeCovered, uGridless);
  blocked *= 1.0 - uGridless;
  diffIn *= 1.0 - uGridless;

  /* The frame's own distance: against the staircase on a grid, against the
     true shape when there is no grid. */
  float sdL = mix(latticeSdf(p, cell, step(0.25, state)), sdf, uGridless);

  /* ---- the entrance: the template is DRAWN, never scaled and never faded --
     A template is a rules object sitting on a lattice. Scaling it means that
     for the length of the entrance it covers squares it does not cover, and
     fading the quad means the finished squares dim back out while later ones
     are still arriving — both fight the grid the whole area is defined on.

     So the geometry is FINAL from frame one and only the INK moves. Two
     ordinals order the writing:
       ordRadial  per CELL, 0 at the origin to 1 at the far edge. Quantised to
                  the square deliberately: a whole square lands at once, which
                  is what makes it read as written on the grid rather than as a
                  gradient passing over it.
       ordAngle   per fragment, 0 to 1 around the perimeter — remapped to the
                  cone's own wedge, or the pen spends most of its travel outside
                  the shape it is supposedly drawing.

     Three modes, and the three differ in WHEN THE EXTENT IS KNOWABLE, which is
     the thing that actually matters at a table:
       0 trace    a nib runs the perimeter and the fill lands behind it. Most
                  literally drawn; the extent is only complete at the end.
       1 inscribe written outward square by square, seams striking a beat ahead
                  of their own fill. The extent grows.
       2 ignite   the whole wireframe strikes at once, then floods from the
                  origin. The extent is legible on frame one.                  */
  float cellFront = uRadius + areaSdf(cell + 0.5);
  float ordRadial = clamp(cellFront / max(uRadius, 0.5), 0.0, 1.0);
  /* The same ordinal WITHOUT the quantisation. The fill has to snap to whole
     squares or it stops reading as written on the grid, but the nib must not:
     a writing head quantised to the lattice is a whole ring of squares going
     white together, which reads as the area flashing rather than as a stroke
     travelling. Fill takes ordRadial; the nib takes this.

     NOT CLAMPED ABOVE 1, and that is the whole point. Clamped, every pixel
     outside the area — the entire rest of the canvas — shares the single value
     1, so the moment the write front reached the edge the nib's gaussian fired
     across all of it at once and the screen flashed orange. Left unclamped, a
     pixel a long way out has a correspondingly large ordinal and is never
     within a gaussian width of anything. */
  float ordFrag = max((uRadius + sdf) / max(uRadius, 0.5), 0.0);
  ordRadial = mix(ordRadial, clamp(ordFrag, 0.0, 1.0), uGridless);

  /* And a mask, because the unclamped ordinal alone still lets the front sweep
     through the band just outside the boundary as it lands. The nib is a pen
     writing INSIDE the area; it has no business past its own edge. */
  float nibRegion = 1.0 - glEdge(0.0, 0.5, sdf);

  float ordAngle = perimeterOrd(p);
  float ordAngleCell = mix(perimeterOrd(cell + 0.5), ordAngle, uGridless);

  float pen = eased;
  float inkFill = 1.0;   /* how much of this square's FILL has been laid */
  float inkSeam = 1.0;   /* how much of its INTERIOR lattice has been struck */
  float inkEdge = 1.0;   /* how much of the OUTER boundary has been drawn */
  float nib     = 0.0;   /* the head writing the interior */
  float edgeNib = 0.0;   /* the head drawing the outer boundary */

  /* THE OUTER EDGE IS ALWAYS TRACED, in all three modes.
     It is the single line that answers "where does this end", so it is the one
     worth watching get drawn — and it gives the eye something to follow into
     the shape, which a boundary that simply appears whole does not. It runs
     ahead of the interior (1.25x) so ink never lands outside a boundary that
     has not been drawn yet, and it finishes at 0.8 of the stroke so the last
     beat belongs to the fill settling rather than to the pen.

     EVERY PEN BELOW OVERRUNS 1, and none of them may be clamped to it. A gate
     of the form glEdge(0, w, pen - ord) is only HALF open when pen equals ord,
     so a pen that stops exactly at 1 leaves every square at ordinal 1 — the
     last ring written, and for the edge pen the seam where the lap closes —
     permanently unfinished. That does not read as an animation that stopped
     early; it reads as the area missing squares it should cover, which is a
     rules bug as far as anyone at the table can tell. Each multiplier is set so
     that at pen = 1 the argument clears its own transition width outright. */
  float edgePen = pen * 1.30;
  inkEdge = glEdge(0.0, 0.045, edgePen - ordAngle);
  /* The nib itself still dies when its lap CLOSES, at pen 0.77, leaving the
     last quarter of the stroke to the fill settling rather than to the pen. */
  float edgeFade = 1.0 - pow(min(edgePen, 1.0), 2.0);
  edgeNib = glGauss(ordAngle - edgePen, 26.0) * exp(-abs(sdf) * 1.6) * edgeFade;

  /* The three modes differ ONLY in how the interior arrives behind it. */
  if (uEnterMode < 0.5) {
    /* trace — the interior follows the same pen round. */
    inkSeam = glEdge(0.0, 0.06, pen * 1.24 - ordAngle);
    inkFill = glEdge(0.0, 0.17, pen * 1.24 - ordAngleCell);
  } else if (uEnterMode < 1.5) {
    /* inscribe — written outward, square by square, seams a beat ahead. */
    float d = pen * 1.40 - ordRadial;
    inkSeam = glEdge(0.0, 0.09, d);
    inkFill = glEdge(0.0, 0.21, d - 0.11);
    nib = glGauss(ordFrag - pen * 1.40, 13.0) * nibRegion;
  } else {
    /* ignite — the interior lattice strikes whole, then floods from the
       origin. 0.10 of a 520ms stroke is ~50ms: a strike, not a discontinuity,
       and short enough that the shape is there before anyone looks for it. */
    inkSeam = glEdge(0.0, 0.10, pen);
    inkFill = glEdge(0.0, 0.25, pen * 1.38 - ordRadial);
    nib = glGauss(ordFrag - pen * 1.38, 14.0) * inkSeam * nibRegion;
  }
  /* Both heads are writing tools, not light sources: they must be gone once
     the stroke lands, or they read as permanent hot rings. */
  nib *= (1.0 - pen * pen);

  /* The LANDING. When the edge pen closes its lap the frame flares once and a
     single ring leaves the boundary outward — the one beat that says the
     placement is now final. Both are gone by the time enter reaches 1, so
     a settled area carries neither. */
  float flare = exp(-pow((enter - 0.84) * 14.0, 2.0)) * step(enter, 0.999);
  float landR = max(enter - 0.80, 0.0) * LAND_REACH * 5.0;
  float landRing = hairline(sdf - landR, RIM_PX * 2.0) * step(0.80, enter)
                 * (1.0 - smoothstep(0.84, 1.0, enter)) * step(enter, 0.999);

  float presence = uPhase.y;      /* the EXIT only; the entrance is the ink above */
  float shock = uPhase.z;
  float pace = behaviourPace();

  /* Treatment character. The grounded treatment passes all ones, so it is
     bit-identical with this in place. */
  float chScorch = uChar.x, chMotes = uChar.y, chRim = uChar.z, chTurb = uChar.w;

  /* ---- the material, only where a plane reads it ------------------------
     The fill is the expensive thing here — frost runs two 3×3 dendrite
     searches — and only the ground and the shade use it. Three of four passes
     used to pay for it and throw it away. */
  float fill = 0.46, turb = 0.46, detail = 0.0, sheen = 0.0;
  if (onGround || onShade) {
    fill = archFill(p, t);
    /* The atlas is a DETAIL texture: it tiles at two rotated scales so the
       repeat never lines up with the lattice, and its channels are read for
       what they are — a body variation, a structure mask and the crests. Half
       a texel inside the tile so linear filtering never leaks a neighbour. */
    vec2 inset = vec2(ATLAS_INSET);
    vec2 span = uAtlasRect.zw - inset * 2.0;
    vec2 uvA = uAtlasRect.xy + inset + fract(p * ATLAS_SCALE_A + vec2(uSeed * 0.13, 0.0)) * span;
    vec2 pr = vec2(p.x * 0.866 - p.y * 0.5, p.x * 0.5 + p.y * 0.866);
    vec2 uvB = uAtlasRect.xy + inset + fract(pr * ATLAS_SCALE_B + vec2(0.0, uSeed * 0.07)) * span;
    vec4 tA = texture2D(uAtlas, uvA);
    vec4 tB = texture2D(uAtlas, uvB);
    float bodyVar = mix(tA.r, tB.r, 0.5);
    float structure = max(tA.g, tB.g * 0.8);
    float crest = max(tA.b, tB.b * 0.7);
    float surfaced = fill * (0.74 + bodyVar * 0.34) + structure * 0.26 + crest * 0.36;
    fill = mix(fill, surfaced, clamp(uAtlasReady, 0.0, 1.0) * 0.62);
    turb = mix(0.46, fill * chTurb, uFx.w);
    detail = smoothstep(0.52, 1.10, fill);
    sheen = detail * detail * covered * inkFill * 0.34;
  }

  float topology = 0.0;
  if (onGround || (onEdge && abs(uFunction - 3.0) < 0.5)) {
    topology = semanticTopology(p, sdf, t) * covered * inkFill
             * (1.0 + step(0.0, uSecondary) * 0.08);
  }

  /* ---- ground ---------------------------------------------------------
     The ground plane is the RULES read: a thin veil, a fresnel band lifting
     toward the edge, the lattice's own marks. The floor stays a floor; the
     material shows through as structure, not as a slab. */
  float ground = 0.0, seam = 0.0;
  if (onGround) {
    float body = covered * inkFill * (0.04 + turb * 0.17);
    /* A blocked square is INSIDE the area but out of line of effect. It has to
       read as a third state, not as absence: dim, cool, and gradient-shadowed
       away from the boundary it lost the line to. */
    float blockShade = 0.30 + 0.34 * (1.0 - glEdge(0.0, 1.6, abs(sdf)));
    body += blocked * inkFill * (0.10 + turb * 0.16) * blockShade;

    /* The fresnel: bright at the edge, falling away over most of a square.
       This one term is most of the difference between a lit plate and a
       coloured wash — it gives the area an inside face. */
    float fres = pow(1.0 - clamp(-sdL / FRES_REACH, 0.0, 1.0), 2.6) * covered * inkEdge * chRim;
    /* A blocked square has no lit face; it carries a 45° hatch instead — the
       oldest "no line of effect" mark there is, in the material's own tint. */
    float hatch = (1.0 - glEdge(0.0, 0.05, abs(fract((p.x + p.y) * 2.0) - 0.5))) * blocked * inkFill;
    /* The glow outside, in the body colour, reaching a third of a square. */
    float glow = exp(-max(sdL, 0.0) / GLOW_REACH) * (1.0 - inside) * inkEdge * chRim;
    /* Cell centre marks: the lattice as an instrument rather than a fence. */
    float dots = glSpot(length(f - 0.5), 1.0 / max(uTexel * DOT_PX, 0.004))
               * covered * inkFill * (1.0 - uGridless);
    /* The scan pulse: origin to edge, at the behaviour's cadence. */
    float ph = fract(t * pace / SCAN_PERIOD);
    float scan = glGauss((ordFrag - ph) * max(uRadius, 1.0), 3.2) * (1.0 - ph * ph)
               * covered * inkFill * step(0.01, pace);
    float chev = chevrons(p, t) * covered * inkFill;

    seam = hairline(dEdge, SEAM_PX) * (0.10 + 0.55 * diffIn)
         * (covered + blocked * 0.7) * inkSeam * (1.0 - uGridless);
    float scorch = uFx.y * chScorch * covered * inkFill * 0.14
                 * (1.0 - glEdge(0.0, SCORCH_SPREAD, abs(sdf)));

    /* The skirt fakes vertical by brightening toward the boundary and fading
       inward. True occlusion (flame in front of the legs, behind the head) is
       not achievable in Foundry's 2D sort, and this does not pretend otherwise. */
    float toEdge = clamp(1.0 + sdf / max(SKIRT_RISE, 0.001), 0.0, 1.0);
    float skirt = uFx.z * uMix.z * covered * inkFill * pow(toEdge, 2.2) * mix(1.0, turb, 0.6)
                * (1.0 - SKIRT_FADE * (1.0 - toEdge));

    ground = clamp(body + fres * 0.62 + hatch * 0.30 + glow * 0.50 + dots * 0.30 + scan * 0.22 + chev * 0.26
                 + skirt * 0.30 + scorch + sheen + topology * 0.14, 0.0, 1.0) * uMix.x;
  }

  /* ---- atmosphere ------------------------------------------------------
     The air plane is the SPECTACLE read: soft, volumetric, organic, and
     deliberately NOT tiled. It has to differ from the ground in character and
     not merely in brightness, or the ground-versus-air treatment axis is just
     an opacity slider wearing a hat. */
  float air = 0.0, mote = 0.0;
  if (onAir) {
    mote = archMotes(p, t) * covered * inkFill * uFx.x * chMotes * 1.15;
    mote *= glDetail(MOTE_RISE / MOTE_DENSITY);

    /* A soft column standing off the plate: unstructured, drifting upward, with
       none of the ground plane's grid discipline. Two generations through a
       warped domain: the warp gives it eddies and folds. */
    vec2 wq = gluWarp(p * 0.62, vec2(0.0, -t * 0.24), 0.85);
    float colA = aoeFbm(wq + vec2(0.0, -t * 0.30));
    float colB = aoeFbm(wq * 2.15 + vec2(t * 0.10, -t * 0.55));
    float colN = colA * (0.55 + 0.65 * colB);

    /* Concentrated toward the boundary rather than spread evenly over the
       plate: that is what makes the air read as a column standing on the area
       instead of a second, brighter copy of the ground. */
    float lift = pow(clamp(1.0 + sdf / 2.2, 0.0, 1.0), 1.7);
    float haze = covered * inkFill * (0.08 + colN * 0.58) * lift * 0.34;

    /* A wide, dim inner glow pooled well inside the boundary — the volume's
       core, so the area has a middle instead of being uniform out to the edge. */
    float pool = covered * inkFill * pow(clamp(-sdf / max(uRadius, 0.5), 0.0, 1.0), 0.7) * 0.22;

    air = (mote * 0.8 + haze + pool) * uMix.y;
  }

  /* ---- boundary: the frame -------------------------------------------- */
  float boundary = 0.0, core = 0.0;
  if (onEdge) {
    /* ONE rule on the rules edge. On a grid that is the staircase; gridless it
       is the shape. Brighter and a little wider at every convex corner, which
       is what makes the squares read as bracketed rather than fenced. */
    float tick = cornerTick(p, cell, step(0.25, state)) * (1.0 - uGridless);
    /* The rule never drops below half weight whatever the treatment says: the
       frame is the area's identity now, and an airborne cloud with no edge is
       a cloud nobody can measure. */
    float ruleWeight = 0.55 + 0.45 * chRim;
    core = hairline(sdL, RIM_PX) * inkEdge * ruleWeight;
    float bracket = hairline(sdL, RIM_PX * 2.4) * tick * inkEdge * ruleWeight;
    /* The inset rule: finer, dimmer, a fixed distance inside the first. Two
       parallel rules are the oldest trick in technical drawing and still the
       cheapest way to say "engineered". */
    float rule = hairline(sdL + RULE_IN, RULE_PX) * inside * inkEdge * chRim;
    /* The orbit ring, on the TRUE geometry — the intent the squares were cut
       from — dashed and turning so it reads as a reticle rather than as a
       second edge disagreeing with the first. */
    float orbit = orbitRing(p, sdf, t) * inkEdge * chRim * step(0.01, pace + uGridless);
    float ring = shock * hairline(sdf + shock * uRadius * 0.9, RIM_PX * 2.2);

    boundary = core * 1.00 + bracket * 0.85 + rule * 0.34 + orbit * 0.48 + ring * 1.4
             + nib * 0.85 + edgeNib * 1.15 + landRing * 0.8;
    boundary *= 1.0 + flare * 1.0;
    if (abs(uFunction - 3.0) < 0.5) boundary += topology * 0.34;
    /* Warning's boundary breathes on the exact same clock as its scanner and
       countdown ring. It never vanishes: the minimum remains a readable rule
       edge even at the quiet point of the pulse. */
    if (uArch > 12.5) boundary *= 0.82 + warningBeat(t) * 0.46;
  }

  /* ---- the shade pass, and nothing else on this plane ------------------- */
  if (onShade) {
    vec4 sh = archShade(p, t);
    /* Modulated by the fill so the darkening follows the material rather than
       being a flat disc, and gated by the ink so it draws on with everything
       else. Deeper toward the edge, where the fresnel needs something dark to
       stand against. */
    float edgeDeep = 0.7 + 0.5 * pow(1.0 - clamp(-sdL / FRES_REACH, 0.0, 1.0), 2.0);
    float s = sh.a * inside * inkFill * (0.74 + 0.26 * clamp(turb, 0.0, 1.2)) * edgeDeep;
    /* Scaled by the treatment's scorch character, but NEVER to zero: an
       airborne treatment marks no floor by design, and that is a look, whereas
       being illegible on a lit map is a bug. It also deliberately ignores the
       uFx.y shed gate for the same reason — this is readability, not
       decoration, and readability is not a quality tier. */
    s *= 0.42 + 0.58 * chScorch;
    s = clamp(s, 0.0, 1.0) * 0.36 * presence * uAlpha;
    gl_FragColor = vec4(sh.rgb * s, s);
    return;
  }

  /* ---- composite ------------------------------------------------------- */
  float amount = (onGround ? ground + seam : 0.0) + (onAir ? air : 0.0) + (onEdge ? boundary : 0.0);

  /* The trigger beat contributes ONCE here; the ring above carries the rest. */
  amount += shock * covered * 0.16 * float(onGround);
  /* The nib bleeds a little onto the floor it is writing on, so the stroke has
     contact rather than floating over the plate. */
  amount += (nib + edgeNib) * 0.20 * float(onGround);
  amount *= presence;

  /* Alpha and energy are deliberately separate. The interior can remain a
     translucent veil while its sparse crests and boundary run hot: the rule
     and the brackets sit at the top of the ramp, the fresnel a step below,
     and the body stays in the tint. */
  float temp = clamp(amount * 0.50 + sheen * 0.75 + shock * 0.18
                   + float(onEdge) * (0.42 + core * 0.45 + flare * 0.3), 0.0, 1.0);
  vec3 col = mix(archRamp(temp), uAccent, topology * 0.34);

  /* Each plane has a different optical job: the ground preserves the map, the
     atmosphere is barely there, and the boundary stays crisp. */
  float planeAlpha = onGround ? 0.54 : (onAir ? 0.24 : 0.96);
  float a = clamp(amount, 0.0, 1.0) * planeAlpha * uAlpha;
  /* Sub-quantum dither. Every gradient here runs over many pixels, which is
     exactly where 8-bit banding shows, and it costs one hash. */
  a = clamp(a + gluDither(gl_FragCoord.xy), 0.0, 1.0);
  vec3 rgb = col * a;

  gl_FragColor = vec4(rgb, a);
}
`;

/*
 * Assembly order is load-bearing. FX_GLSL_NOISE's gluHash1 reads uSeed, so the
 * uniform block has to be in scope before it — and SCALE_PRELUDE declares
 * uTexel itself, so the block must sit after that rather than redeclare it.
 * Concatenating in the obvious order fails to compile, and a shader that fails
 * to compile degrades silently rather than erroring.
 */
const TOPOLOGY_GLSL = `
float semanticTopology(vec2 p, float sdf, float t) {
  float r = length(p), a = atan(p.y, p.x), clock = t;
  if (uBehavior < 0.5) clock *= 1.8;
  else if (uBehavior < 1.5) clock *= 1.15;
  else if (uBehavior < 2.5) clock *= 0.45;
  else if (uBehavior < 3.5) clock *= 0.32;
  else if (uBehavior < 4.5) clock *= 0.18;
  else if (uBehavior < 5.5) clock *= 0.72;
  else if (uBehavior < 8.5) clock *= 0.24;
  else clock = 0.0;
  float mark = 0.0;
  if (uFunction < 0.5) mark = smoothstep(0.88, 0.99, abs(sin(a * 7.0 + r * 1.8 - clock * 2.2))) * smoothstep(0.2, 1.3, r);
  else if (uFunction < 1.5) mark = smoothstep(0.82, 0.98, sin(r * 5.4 - clock * 1.4) * 0.5 + 0.5);
  else if (uFunction < 2.5) { vec2 q = abs(fract(p * 0.72) - 0.5); mark = smoothstep(0.14, 0.02, length(q)) + smoothstep(0.045, 0.0, min(q.x, q.y)); }
  else if (uFunction < 3.5) mark = smoothstep(0.07, 0.0, abs(abs(sdf) - 0.28)) + smoothstep(0.92, 0.99, abs(sin(a * 4.0))) * smoothstep(0.7, 0.0, abs(sdf));
  else if (uFunction < 4.5) mark = smoothstep(0.82, 0.98, sin((p.x + p.y) * 5.0) * sin((p.x - p.y) * 2.5));
  else if (uFunction < 5.5) mark = smoothstep(0.88, 0.99, cos(r * 4.0)) * (0.55 + 0.45 * smoothstep(0.75, 0.98, abs(cos(a * 4.0))));
  else if (uFunction < 6.5) mark = smoothstep(0.58, 0.82, gluFbm(p * 1.2 + vec2(clock * 0.08, 0.0))) * smoothstep(-1.2, 0.0, sdf);
  else if (uFunction < 7.5) mark = smoothstep(0.87, 0.98, sin((p.x + gluFbm(p * 0.45) * 1.2) * 4.2) * 0.5 + 0.5);
  else if (uFunction < 8.5) mark = 1.0 - smoothstep(0.0, 0.16, abs(sin(a - clock * 0.9))) + smoothstep(0.08, 0.0, abs(fract(r * 0.55) - 0.5));
  else if (uFunction < 9.5) mark = smoothstep(0.90, 0.99, abs(cos(a * 3.0))) * smoothstep(0.08, 0.0, abs(fract(r * 0.48 - clock * 0.08) - 0.5));
  else if (uFunction < 10.5) { float c = abs(fract((p.x + abs(p.y)) * 1.4 - clock * 0.35) - 0.5); mark = smoothstep(0.10, 0.02, c) * (0.7 + 0.3 * sin(clock * 4.0)); }
  else { vec2 q = abs(fract(p * 0.5) - 0.5); mark = smoothstep(0.025, 0.0, min(q.x, q.y)); }
  return clamp(mark, 0.0, 1.0);
}
`;

const DECL_END = BODY.indexOf("const float SEAM_PX");
const DECLS = BODY.slice(0, DECL_END);
const REST = BODY.slice(DECL_END).replace("\nvoid main(void) {", `${TOPOLOGY_GLSL}\nvoid main(void) {`);

export const FRAGMENT_SHADER = PRECISION + SCALE_PRELUDE + DECLS + FX_GLSL_NOISE + REST;
