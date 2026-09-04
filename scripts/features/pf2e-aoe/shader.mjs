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
  uEnterMode: "float",   // 0 trace | 1 inscribe | 2 ignite
  uGridless: "float",    // 1 uses continuous Region geometry without a rules lattice
  uTint: "vec3",         // the archetype's lit body colour
  uTintHot: "vec3",      // its emissive core
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
uniform float uTime, uSeed, uPlane, uShape, uRadius, uDirection, uAngle, uArch, uAlpha, uEnterMode, uGridless;
uniform vec2 uBase, uCellOrigin, uCellSize, uGridOffset;
uniform vec3 uTint, uTintHot;
uniform vec4 uPhase, uFx, uChar;
uniform vec3 uMix;
uniform sampler2D uCells;

varying vec2 vGrid;
varying vec2 vScreen;

const float SEAM_PX = ${LAYOUT.latticeSeamPx.toFixed(3)};
const float RIM_PX  = ${LAYOUT.rimWidthPx.toFixed(3)};
const float SKIRT_RISE = ${LAYOUT.skirtRise.toFixed(3)};
const float SKIRT_FADE = ${LAYOUT.skirtFadeIn.toFixed(3)};
const float SCORCH_SPREAD = ${LAYOUT.scorchSpread.toFixed(3)};
const float MOTE_DENSITY = ${LAYOUT.moteDensity.toFixed(3)};
const float MOTE_RISE = ${LAYOUT.moteRise.toFixed(3)};
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
  return sdLine(p, uRadius, 1.0, uDirection);
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
vec2 gluWarp(vec2 p, vec2 flow, float amp) {
  float a = gluFbm(p * 0.75 + flow);
  float b = gluFbm(p * 0.75 + flow.yx + 5.23);
  return p + vec2(a - 0.5, b - 0.5) * amp;
}

/* The scene remains the shadow stop. Only genuinely energetic detail moves
   from the archetype tint through its hot colour toward white. This keeps the
   overlay transparent without flattening every material into one colour. */
vec3 archRamp(float x) {
  x = clamp(x, 0.0, 1.0);
  vec3 c = mix(uTint, uTintHot, smoothstep(0.52, 0.96, x));
  return mix(c, vec3(1.0), smoothstep(0.97, 1.0, x) * 0.24);
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
  float n1 = gluFbm(p * 0.85 + vec2(0.0, -rise));
  float n2 = gluFbm(p * 2.05 + vec2(rise * 0.28, -rise * 1.7));
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
  float n = gluFbm(p * 0.9 + vec2(t * 0.10, -t * 0.16));
  float n2 = gluFbm(p * 2.2 - vec2(t * 0.20, t * 0.05));
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
  float n  = gluFbm(p * 0.70 + vec2(sin(t * 0.25) * 0.40, -drift));
  float n2 = gluFbm(p * 1.55 + vec2(-drift * 0.70, -drift * 1.50) + 19.0);
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

void main(void) {
  float eased = uPhase.w;      /* the nib's position along its stroke, 0 -> 1 */
  vec2 p = vGrid;
  float t = uTime;

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

  float diff = 0.0;
  diff = max(diff, abs(nL - state) * (1.0 - smoothstep(0.0, 0.5, f.x)));
  diff = max(diff, abs(nR - state) * (1.0 - smoothstep(0.0, 0.5, 1.0 - f.x)));
  diff = max(diff, abs(nD - state) * (1.0 - smoothstep(0.0, 0.5, f.y)));
  diff = max(diff, abs(nU - state) * (1.0 - smoothstep(0.0, 0.5, 1.0 - f.y)));

  float covered = step(0.75, state);
  float blocked = step(0.25, state) * (1.0 - covered);

  /* Gridless Scenes have no rules lattice to communicate. Use the Region's
     continuous shape instead, and suppress all square-cell structure. The
     small floor keeps the edge antialiased in diagnostic renders where
     uTexel intentionally defaults to zero. */
  float shapeEdge = max(uTexel, 0.002);
  float shapeCovered = 1.0 - glEdge(-shapeEdge, shapeEdge, sdf);
  covered = mix(covered, shapeCovered, uGridless);
  blocked *= 1.0 - uGridless;
  diff *= 1.0 - uGridless;

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

  float presence = uPhase.y;      /* the EXIT only; the entrance is the ink above */
  float shock = uPhase.z;

  /* Treatment character. The grounded treatment passes all ones, so it is
     bit-identical with this in place. */
  float chScorch = uChar.x, chMotes = uChar.y, chRim = uChar.z, chTurb = uChar.w;

  /* ---- ground ---------------------------------------------------------
     The ground plane is the RULES read: crisp, tiled, unambiguous. Its
     turbulence is deliberately lower-contrast than the atmosphere's so the
     floor stays legible as a floor. */
  /* The map is the low-frequency body of the material. The shader adds a thin
     veil plus selective emissive structure; it does not replace the scene with
     a lit slab. One fill evaluation is enough, avoids plastic normal-map relief,
     and halves the worst-case cost of frost. */
  float fill = archFill(p, t);
  float turb = mix(0.46, fill * chTurb, uFx.w);
  float detail = smoothstep(0.48, 1.05, fill);
  float body = covered * inkFill * (0.16 + turb * 0.34);

  /* A blocked square is INSIDE the area but out of line of effect. It has to
     read as a third state, not as absence: dim, cool, and gradient-shadowed
     away from the boundary it lost the line to. At 0.16 of the fill it was
     invisible and looked exactly like "outside", which defeats the whole
     reason for expressing this in the effect's own language. */
  float blockShade = 0.30 + 0.34 * (1.0 - glEdge(0.0, 1.6, abs(sdf)));
  body += blocked * inkFill * (0.12 + turb * 0.20) * blockShade;

  float seam = hairline(dEdge, SEAM_PX) * (0.16 + 0.62 * diff)
             * (covered + blocked * 0.7) * inkSeam * (1.0 - uGridless);
  float scorch = uFx.y * chScorch * covered * inkFill * 0.16
               * (1.0 - glEdge(0.0, SCORCH_SPREAD, abs(sdf)));

  /* The skirt fakes vertical by brightening toward the boundary and fading
     inward. True occlusion (flame in front of the legs, behind the head) is
     not achievable in Foundry's 2D sort, and this does not pretend otherwise. */
  float toEdge = clamp(1.0 + sdf / max(SKIRT_RISE, 0.001), 0.0, 1.0);
  float skirt = uFx.z * uMix.z * covered * inkFill * pow(toEdge, 2.2) * mix(1.0, turb, 0.6)
              * (1.0 - SKIRT_FADE * (1.0 - toEdge));

  /* A sparse hot-detail layer supplies fidelity without increasing the opacity
     of the entire area. It follows each archetype's own structure and never
     darkens a pixel—the multiply shade pass already handles contrast. */
  float sheen = detail * detail * covered * inkFill * 0.30;

  float ground = clamp(body + skirt * 0.46 + scorch + sheen, 0.0, 1.0) * uMix.x;

  /* ---- atmosphere ------------------------------------------------------
     The air plane is the SPECTACLE read: soft, volumetric, organic, and
     deliberately NOT tiled. It has to differ from the ground in character and
     not merely in brightness, or the ground-versus-air treatment axis is just
     an opacity slider wearing a hat. */
  float mote = archMotes(p, t) * covered * inkFill * uFx.x * chMotes * 1.15;
  mote *= glDetail(MOTE_RISE / MOTE_DENSITY);

  /* A soft column standing off the plate: unstructured, drifting upward, with
     none of the ground plane's grid discipline.

     Two generations through a warped domain rather than a product of two plain
     fbms. The warp gives it eddies and folds; the plain product gave it the
     even lumpiness that is the visual signature of "somebody multiplied two
     noise fields", which is most of what made the atmosphere read as cheap. */
  vec2 wq = gluWarp(p * 0.62, vec2(0.0, -t * 0.24), 0.85);
  float colA = gluFbm(wq + vec2(0.0, -t * 0.30));
  float colB = gluFbm(wq * 2.15 + vec2(t * 0.10, -t * 0.55));
  float colN = colA * (0.55 + 0.65 * colB);

  /* Concentrated toward the boundary rather than spread evenly over the plate:
     that is what makes the air read as a column standing on the area instead of
     a second, brighter copy of the ground. Spread evenly it merely raises the
     exposure of the whole square, which is how the treatments ended up
     differing in blow-out speed rather than in character. */
  float lift = pow(clamp(1.0 + sdf / 2.2, 0.0, 1.0), 1.7);
  float haze = covered * inkFill * (0.10 + colN * 0.62) * lift * 0.42;

  /* A wide, dim inner glow pooled well inside the boundary. It carries almost
     no detail on purpose — its whole job is to give the volume a core to be
     brightest at, so the area has a middle instead of being uniform out to a
     hot edge. */
  float pool = covered * inkFill * pow(clamp(-sdf / max(uRadius, 0.5), 0.0, 1.0), 0.7) * 0.30;

  float air = (mote * 0.8 + haze + pool) * uMix.y;

  /* ---- boundary -------------------------------------------------------- */
  /* Both of these ARE the outer edge — one as true geometry, one as the
     staircase of squares PF2e actually uses — so both trace in behind the edge
     pen rather than behind the interior's own schedule. */
  float rimTrue = hairline(sdf, RIM_PX) * inkEdge * chRim;
  float rimGrid = hairline(dEdge, RIM_PX) * diff * inkEdge * chRim;
  float ring = shock * hairline(sdf + shock * uRadius * 0.9, RIM_PX * 2.2);
  /* The nib is NOT multiplied by chRim: a treatment may draw a soft boundary
     and still be written by a bright pen, and an airborne area whose entrance
     is invisible has no entrance. */
  /* The nib is weighted so it reads as a moving front, not as a tube: wide
     enough to bloom, narrow enough that the ink already laid behind it stays
     visible. At half this width and twice this weight it hid its own work. */
  /* edgeNib is NOT scaled by chRim: a treatment may draw a soft boundary and
     still be written by a bright pen, and an entrance nobody can see is not an
     entrance. */
  /* An inner lip: a soft band of light just inside the true edge, falling away
     over about a third of a square. A hairline rim alone reads as a drawn
     outline; the lip under it is what makes the boundary read as the lit face
     of something with thickness. */
  float lip = pow(clamp(1.0 + sdf / 0.55, 0.0, 1.0), 3.0) * covered * inkEdge * chRim;

  float boundary = rimTrue * 0.80 + rimGrid * 0.60 + ring * 1.4
                 + nib * 0.85 + edgeNib * 1.15 + lip * 0.42;
  /* Warning's boundary breathes on the exact same clock as its scanner and
     countdown ring. It never vanishes: the minimum remains a readable rule
     edge even at the quiet point of the pulse. */
  if (uArch > 12.5) boundary *= 0.82 + warningBeat(t) * 0.46;

  /* ---- the shade pass, and nothing else on this plane ------------------- */
  if (uPlane > 2.5) {
    vec4 sh = archShade(p, t);
    /* Modulated by the fill so the darkening follows the material rather than
       being a flat disc, and gated by the ink so it draws on with everything
       else. */
    float s = sh.a * covered * inkFill * (0.55 + 0.45 * clamp(turb, 0.0, 1.2));
    /* Scaled by the treatment's scorch character, but NEVER to zero: an
       airborne treatment marks no floor by design, and that is a look, whereas
       being illegible on a lit map is a bug. It also deliberately ignores the
       uFx.y shed gate for the same reason — this is readability, not
       decoration, and readability is not a quality tier. */
    s *= 0.42 + 0.58 * chScorch;
    /* This is a contact shadow, not an opaque decal. Its archetype strength is
       intentionally compressed so bright maps gain contrast without dark maps
       turning muddy. Umbra remains the strongest because subtraction is its
       visual identity. */
    s = clamp(s, 0.0, 1.0) * 0.38 * presence * uAlpha;
    gl_FragColor = vec4(sh.rgb * s, s);
    return;
  }

  /* ---- composite ------------------------------------------------------- */
  float amount =
      step(uPlane, 0.5) * (ground + seam)
    + step(0.5, uPlane) * step(uPlane, 1.5) * air
    + step(1.5, uPlane) * boundary;

  /* The trigger beat contributed three times over — here, in the colour mix,
     and again through bloom — and the three compounded into a white blob. It
     gets ONE contribution now, and the ring above carries the rest. */
  amount += shock * covered * 0.16 * step(uPlane, 0.5);
  /* The nib bleeds a little onto the floor it is writing on, so the stroke has
     contact rather than floating over the plate. */
  amount += (nib + edgeNib) * 0.20 * step(uPlane, 0.5);
  amount *= presence;

  /* Alpha and energy are deliberately separate. The interior can remain a
     translucent veil while its sparse crests and boundary run hot. */
  float temp = clamp(amount * 0.58 + sheen * 0.78 + shock * 0.18
                   + step(1.5, uPlane) * 0.28, 0.0, 1.0);
  vec3 col = archRamp(temp);

  /* Each plane has a different optical job: the ground preserves the map, the
     atmosphere is barely there, and the boundary stays crisp. Three equally
     opaque passes were the source of the lava-slab failure. */
  float planeAlpha =
      step(uPlane, 0.5) * 0.48
    + step(0.5, uPlane) * step(uPlane, 1.5) * 0.24
    + step(1.5, uPlane) * 0.86;
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
const DECL_END = BODY.indexOf("const float SEAM_PX");
const DECLS = BODY.slice(0, DECL_END);
const REST = BODY.slice(DECL_END);

export const FRAGMENT_SHADER = PRECISION + SCALE_PRELUDE + DECLS + FX_GLSL_NOISE + REST;
