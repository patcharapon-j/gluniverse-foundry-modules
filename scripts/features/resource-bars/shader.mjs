/**
 * GLUniverse Suite — resource bars: the fragment shader.
 *
 * One quad per bar, everything computed per-pixel: the recessed well, the
 * health fill and its cylindrical shading, the chip trail, the temp-HP overlay,
 * the segment ticks, the low-health breath, the change wave, the impact and its
 * debris, the specular sweep, and the chamfered Etched Glass frame with its
 * bevel. Doing it in a shader rather than in PIXI.Graphics is what makes
 * "shading" and "animates every frame" cheap instead of a per-token
 * retessellation.
 *
 * ── A note on units, because it is the one genuinely subtle thing here ──
 *
 * `core/glsl.mjs`'s prelude measures everything against `uTexel`, one device
 * pixel expressed in UV units — and UV units are relative to the quad's
 * *width*. That works for the token overlay, whose quads are square. A resource
 * bar is not: it is routinely 8:1, so 0.02 "UV units" is a hairline across the
 * bar and a fifth of its height. Feeding the prelude's helpers a y-distance
 * would clamp it against the wrong pixel size and either blur a crisp edge or
 * leave a crawling one.
 *
 * So this shader works in `p` — an isotropic space where one unit is the bar's
 * height, x scaled by `uAspect` — and restates the prelude's *policy* (its
 * GL_BAND / GL_EDGE / GL_FADE thresholds, imported, not re-guessed) in that
 * space via `px`, one device pixel in p units. `glDetail` is still used
 * directly wherever a width is genuinely along x.
 *
 * As in the prelude, `uTexel = 0` leaves every clamp inert: a missing uniform
 * degrades to the unfiltered look rather than to a blank quad.
 */

import { SCALE_PRELUDE, VERTEX_SHADER } from "../../core/glsl.mjs";

export { VERTEX_SHADER };


/** A standalone vertex shader for the preview harness (no PIXI matrices). */
export const PREVIEW_VERTEX_SHADER = `
attribute vec2 aVertexPosition;
attribute vec2 aUvs;
varying vec2 vTextureCoord;
void main(void) {
  vTextureCoord = aUvs;
  gl_Position = vec4(aVertexPosition, 0.0, 1.0);
}`;

/**
 * Every uniform this shader declares, with its GLSL type. `tools/resource-bar-check.mjs`
 * cross-checks this list against both the GLSL source and the JS that supplies
 * them: a uniform declared and never set is a silent no-op, and one set and
 * never declared is a silent typo.
 */
export const UNIFORMS = Object.freeze({
  uTime: "float",     // seconds, for the sweep and the low-health pulse
  uTexel: "float",    // one device pixel in UV units (prelude contract; 0 = inert)
  uAspect: "float",   // quad width / height, in the same units

  uFrac: "float",     // current value, 0..1
  uGhost: "float",    // chip-trail head; > uFrac while draining, < uFrac while healing
  uBloom: "float",    // heal bloom at the leading edge, 0..1
  uFlash: "float",    // impact flash, 0..1
  uLow: "float",      // low-health state, 0..1
  uSweep: "float",    // specular sweep intensity, 0..1 (hover / recently changed only)
  uTemp: "float",     // temp HP as a fraction of max, 0 = none
  uCracked: "float",  // shield break, 0..1 (role 2)
  uHit: "float",      // impact envelope, 1 at the frame of the hit decaying to 0
  uHitX: "float",     // where the hit landed, as a fraction along the bar
  uHeal: "float",     // 1 while the impact envelope is a heal rather than a hit
  uSpark: "float",    // debris + spoke intensity, 0 once shed under load
  uChip: "float",     // how fresh the chip trail is, 1 = just cut and white-hot
  uWave: "float",     // change-sweep amplitude, 0..1
  uWaveX: "float",    // the sweep front's position, as a fraction along the bar
  uSeg: "float",      // segment count across the fill, 0 = one continuous plate
  uRole: "float",     // 0 hero bar, 1 secondary rail, 2 shield rail

  uRamp: "vec3[4]",   // health ramp in OKLab, empty → full
  uTempCol: "vec3",   // temp-HP overlay colour, sRGB 0..1
  uShieldCol: "vec3", // shield rail colour, sRGB 0..1
  uRailCol: "vec3",   // secondary-rail colour, sRGB 0..1 (the suite accent)
});

/**
 * PIXI prepends a precision qualifier to any fragment shader that does not
 * declare one — and it prepends `mediump`. That matters twice over. A bare
 * WebGL context (the preview harness, the check tool) prepends nothing at all,
 * so the same source fails to compile there; and if we let PIXI supply it, the
 * harness would be validating a *different program* than the one Foundry runs.
 *
 * Declaring it here pins both. `highp` is what the OKLab inverse and the
 * exponential falloffs want — at mediump the ramp visibly bands across the
 * fill — with the standard guard for hardware that cannot offer it.
 */
export const PRECISION = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
`;

/**
 * The cut corner, as a multiple of the bar's half-height, and how far inside
 * the quad's right edge the readout is anchored, in whole bar heights.
 *
 * They are exported and paired for the same reason the shear used to be: the
 * bar is drawn in GLSL and the numerals are laid out in JS, and the readout has
 * to clear the corner the bar takes out of itself. Get them out of step and the
 * digits sit *on* the diagonal — which does not read as a two-pixel error, it
 * reads as two people having drawn the same bar.
 *
 * The inset is derived, not guessed: the cut's edge at the top of the numerals
 * is BODY_INSET + CUT * heroHalf - capHeight/2 from the quad edge, and this is
 * that with a little air. `tools/resource-bar-check.mjs` recomputes it.
 */
export const CUT = 1.05;
export const BODY_INSET = 0.235;
export const READOUT_INSET = 0.54;

export const FRAGMENT_SHADER = PRECISION + SCALE_PRELUDE + `
const float CUT = ` + CUT.toFixed(4) + `;
const float BODY_INSET = ` + BODY_INSET.toFixed(4) + `;` + `
varying vec2 vTextureCoord;

uniform float uTime;
uniform float uAspect;
uniform float uFrac;
uniform float uGhost;
uniform float uBloom;
uniform float uFlash;
uniform float uLow;
uniform float uSweep;
uniform float uTemp;
uniform float uCracked;
uniform float uHit;
uniform float uHitX;
uniform float uHeal;
uniform float uSpark;
uniform float uChip;
uniform float uWave;
uniform float uWaveX;
uniform float uSeg;
uniform float uRole;
uniform vec3  uRamp[4];
uniform vec3  uTempCol;
uniform vec3  uShieldCol;
uniform vec3  uRailCol;

/* One device pixel in p units. Set once in main(), read by the helpers below —
   GLSL ES 1.0 has no closures, so this is a global by necessity. */
float px;

/* ── The prelude's policy, restated in p ─────────────────────────────────
   Same thresholds (GL_BAND, GL_EDGE, GL_FADE_*, all imported), same
   brightness-preserving widening: a band that must grow to stay a pixel wide is
   dimmed by exactly the factor it grew, so its integrated light is unchanged
   rather than aliased into buzzing. */

float rbBand(float d, float halfW) {
  float w = max(halfW, px * GL_BAND);
  return exp(-abs(d) / w) * (halfW / w);
}

float rbGauss(float d, float halfW) {
  float w = max(halfW, px * GL_BAND);
  float x = d / w;
  return exp(-x * x) * (halfW / w);
}

float rbEdge(float e0, float e1, float x) {
  float m = (e0 + e1) * 0.5;
  float h = max(abs(e1 - e0), px * GL_EDGE) * 0.5;
  float s = e1 < e0 ? -1.0 : 1.0;
  return smoothstep(m - h * s, m + h * s, x);
}

/* Detail that cannot be filtered, only left out. */
float rbDetail(float w) {
  return smoothstep(GL_FADE_LO, GL_FADE_HI, w / px);
}

/* Antialiased coverage of an SDF: 1 inside, 0 outside, one pixel of transition. */
float rbCover(float d) {
  return 1.0 - smoothstep(-px * 0.5, px * 0.5, d);
}

float sdBox(vec2 p, vec2 b) {
  vec2 d = abs(p) - b;
  return min(max(d.x, d.y), 0.0) + length(max(d, 0.0));
}

/* The same box with one corner taken off, top-right.

   This is the suite mark — the corner gl-tokens.css cuts out of every panel —
   and it is what carries the family identity now that the bar is axis-aligned.
   A cut corner is a mark; the shear it replaces was a costume, and one that
   made the bar disagree with every other rectangle on the canvas.

   Note p and not abs(p): mirroring would cut all four corners and turn an
   instrument with a front and a back into a lozenge. */
float sdCut(vec2 p, vec2 b, float c) {
  float k = (b.x + b.y - c) * 0.7071068;
  return max(sdBox(p, b), dot(p, vec2(0.7071068)) - k);
}

/* ── OKLab → sRGB ────────────────────────────────────────────────────────
   The forward transform happens in JS (features/resource-bars/ramp.mjs) so the
   shader pays only for this inverse, once. */
vec3 oklabToSrgb(vec3 c) {
  float l_ = c.x + 0.3963377774 * c.y + 0.2158037573 * c.z;
  float m_ = c.x - 0.1055613458 * c.y - 0.0638541728 * c.z;
  float s_ = c.x - 0.0894841775 * c.y - 1.2914855480 * c.z;

  float l = l_ * l_ * l_;
  float m = m_ * m_ * m_;
  float s = s_ * s_ * s_;

  vec3 lin = vec3(
     4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
  );
  lin = max(lin, vec3(0.0));
  return mix(lin * 12.92, 1.055 * pow(lin, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, lin));
}

/* The ramp, sampled at a health fraction. Indices are constant expressions:
   GLSL ES 1.0 does not promise dynamic indexing of uniform arrays in a fragment
   shader, and a driver that refuses it fails at compile time — which, for a
   shader whose failure mode is a silent fallback, means the effect simply
   vanishes on some machines and not others. */
vec3 rampAt(float t) {
  float s = clamp(t, 0.0, 1.0) * 3.0;
  float i = min(floor(s), 2.0);
  float f = s - i;
  vec3 a = i < 0.5 ? uRamp[0] : (i < 1.5 ? uRamp[1] : uRamp[2]);
  vec3 b = i < 0.5 ? uRamp[1] : (i < 1.5 ? uRamp[2] : uRamp[3]);
  return oklabToSrgb(mix(a, b, f));
}


/* Etched Glass ink, mirrored from PALETTE.ink1 / ink2 in core/theme.mjs. */
const vec3 INK  = vec3(0.043, 0.059, 0.090);
const vec3 INK0 = vec3(0.008, 0.027, 0.043);

void main(void) {
  vec2 uv = vTextureCoord;
  vec2 p  = (vec2(uv.x, 1.0 - uv.y) - 0.5) * vec2(uAspect, 1.0);
  vec2 b  = vec2(uAspect, 1.0) * 0.5;
  px = max(uTexel * uAspect, 0.000001);

  float hero = 1.0 - step(0.5, uRole);

  /* ── Geometry ──────────────────────────────────────────────────────────
     The quad is bigger than the bar. The body is inset on every side, which
     leaves the margin the additive bloom needs — light that stops dead at the
     quad edge is the single clearest tell that something was drawn rather than
     lit.

     The horizontal inset used to be 0.30, and a third of that was headroom for
     the shear: a body leaning by 0.32 per unit of height overhangs its own box
     by half that on each side. With the bar axis-aligned that headroom is free
     length, and length is the one dimension a resource bar is read with. */
  float padY = mix(0.21, 0.18, hero);
  vec2 bb = vec2(b.x - BODY_INSET, b.y - padY);

  float hb = clamp(p.y / max(bb.y, 0.0001), -1.0, 1.0);

  /* Three separated layers, not one welded frame: stroke, air, trough, lip,
     fill. The gaps are the point — a stroke that touches its trough is a
     border, and a border is a form control. */
  float sw  = max(0.030, px * 1.05);
  float air = 0.058;
  float lip = 0.032;

  /* The cut is proportional to the bar, not absolute: a fixed one is a nick on
     a gargantuan creature's bar and half the end of a familiar's. */
  float dBody   = sdCut(p, bb, bb.y * CUT);
  float dTrough = dBody + sw + air;

  /* Nothing animates the geometry. Not the frame, not the fill's height. An
     earlier pass compressed the fill plate on impact and it read as jelly — a
     bar whose height breathes is a bar you stop reading as a measurement. The
     whole reaction is carried by light travelling across a rigid instrument. */
  float dFillA  = dTrough + lip;

  float mBody   = rbCover(dBody);
  float mStroke = clamp(mBody - rbCover(dBody + sw), 0.0, 1.0);
  float mTrough = rbCover(dTrough);
  float mFillA  = rbCover(dFillA);

  float fx0 = -bb.x + sw + air + lip;
  float fx1 =  bb.x - sw - air - lip;
  float span = max(fx1 - fx0, 0.0001);
  float fillX  = mix(fx0, fx1, clamp(uFrac,  0.0, 1.0));
  float ghostX = mix(fx0, fx1, clamp(uGhost, 0.0, 1.0));

  /* ── Palette ───────────────────────────────────────────────────────────
     GOLD is PALETTE.signalPale. It is the only warm note and it appears in
     exactly two places — the top of the stroke and the cap — which is what
     keeps it reading as a material rather than as a colour scheme. */
  /* The ramp is sampled through a curve, not linearly. Linear sampling spends
     the whole lower half of the bar's range on orange and only reaches red in
     the last few percent — so a creature at a third of its hit points looks
     merely warm. Biasing the sample downward pulls red up into the band where
     it is actually load-bearing, without touching the ramp stops themselves
     (which mirror gl-tokens.css and are pinned to it). */
  float rampT = pow(clamp(uFrac, 0.0, 1.0), 1.45);
  vec3 base = uRole < 0.5 ? rampAt(rampT) : (uRole < 1.5 ? uRailCol : uShieldCol);
  float grey = dot(base, vec3(0.299, 0.587, 0.114));
  base = mix(base, vec3(grey), mix(0.24, 0.06, hero));
  /* …and the bottom of the range goes further, into a hot arterial red that no
     ramp stop reaches. This is the one place the fill is allowed to editorialise,
     because "you are about to die" is not a shade of the same information. */
  base = mix(base, vec3(1.000, 0.106, 0.153), uLow * 0.55 * hero);

  /* ── The trough ────────────────────────────────────────────────────────*/
  /* Flat and dark, with one shadow under the top edge. There used to be a
     diagonal scan pattern in here; on a bar that is mostly empty — which is
     every bar that matters — those stripes are the largest thing on screen and
     the fill has to compete with them. A well is not supposed to be the
     interesting part. */
  vec3 troughCol = mix(INK0, INK, 0.24 + 0.62 * smoothstep(1.0, -0.85, hb));
  troughCol *= 1.0 - 0.38 * rbBand(hb - 0.92, 0.14);

  /* ── The fill ──────────────────────────────────────────────────────────
     Flat and high-key, with the light carried by one hot hairline rather than
     a broad gradient. A soft gaussian down the middle is the gloss every CSS
     progress bar has had since 2009; a hard 1px specular under the top edge is
     what a lit surface actually does. */
  vec3 fillCol = base * (1.04 - 0.17 * smoothstep(0.35, -1.0, hb));
  fillCol += vec3(1.0) * rbBand(hb - 0.55, 0.30) * 0.10;
  fillCol += vec3(1.0) * rbBand(hb - 0.80, 0.070) * 1.15 * hero;
  fillCol *= 1.0 - 0.34 * rbBand(hb + 0.92, 0.13);

  /* ── Low health ────────────────────────────────────────────────────────
     A slow red breath through the fill, not a hatch.

     The hatch that used to live here was a *spatial* second channel — stripes
     you could read without colour. It also sat on the bar permanently once you
     dropped below the threshold, and a static stripe pattern on the one element
     a player checks constantly is exactly the kind of decoration that has to be
     looked past. The second channel is now *temporal*: the pulse is slow enough
     (~4.6s) to read as breathing rather than as an alarm, and it carries the
     "this is different" information without occupying any of the bar's surface.

     The mottle is two drifting sine fields multiplied together. Multiplying two
     incommensurate frequencies gives an interference field with no repeat the
     eye can lock onto — the surface reads as having grain, and never as having
     a pattern. That distinction is the whole difference between texture and
     distraction. */
  float breathe = 0.5 + 0.5 * sin(uTime * 1.35);

  /* The texture is domain-warped, and that is the whole trick. Two sine fields
     multiplied together give a plaid — a grid you can see the axes of, which is
     a pattern rather than a material. Displacing the sample point by *another*
     pair of sines before evaluating it breaks the alignment: the cells stretch,
     drift and fold, and the result reads as something moving inside the liquid
     rather than as a texture laid over it.

     Two octaves, the second warped again by the first. One octave alone is a
     field of soft blobs, which at a glance is indistinguishable from uneven
     lighting; the fine layer riding on the coarse one is what makes it read as
     matter with structure. Six sines, no texture fetch. */
  vec2 wq = p + vec2(sin(p.y * 3.10 + uTime * 0.55) * 0.13,
                     sin(p.x * 2.70 - uTime * 0.43) * 0.09);
  float c1 = 0.5 + 0.5 * sin(wq.x * 5.60 + uTime * 0.80) * sin(wq.y * 4.00 - uTime * 0.62);
  vec2 wq2 = wq + vec2(sin(wq.y * 6.30 - uTime * 0.90) * 0.06,
                       sin(wq.x * 5.10 + uTime * 0.70) * 0.05);
  float c2 = 0.5 + 0.5 * sin(wq2.x * 11.50 - uTime * 1.15) * sin(wq2.y * 8.30 + uTime * 0.90);

  /* Contrast-stretched into clots and channels. Left as a smooth field the
     whole thing reads as a gentle sheen; the hard shoulders are what make it a
     substance. */
  float cell = smoothstep(0.24, 0.76, clamp(c1 * 0.70 + c2 * 0.30, 0.0, 1.0));
  float ember = pow(cell, 2.2);

  /* The texture's presence follows the health, and *only* the emission follows
     the breath. Routing both through the pulse makes the whole surface fade to
     flat every few seconds, which is the opposite of a substance. */
  float lowT = uLow * hero;
  float breathGlow = 0.30 + 0.70 * breathe;

  /* Near-black in the channels, so the liquid has real depth… */
  fillCol = mix(fillCol, vec3(0.50, 0.02, 0.05), lowT * (1.0 - cell) * 0.88);
  /* …arterial red across the clots… */
  fillCol = mix(fillCol, vec3(1.00, 0.10, 0.13), lowT * cell * 0.55);
  /* …and emitted above 1.0 at their cores, so the bright-pass finds it: at low
     health the fill is not a darker colour, it is a light source. */
  fillCol += vec3(1.45, 0.24, 0.28) * lowT * ember * breathGlow * 1.10;

  /* ── Segments ──────────────────────────────────────────────────────────
     Real gaps between discrete plates, not grooves cut into one continuous
     bar. A groove says "one quantity, subdivided for counting"; a gap says
     "assembled from parts", which is what every game HUD in this idiom says.
     The gap closes back up once it can no longer hold a pixel, so a shrinking
     bar loses its divisions instead of dissolving into stripes. */
  float segMask = 1.0;
  if (uSeg > 0.5) {
    float segW = span / uSeg;
    float sx = fract(clamp((p.x - fx0) / span, 0.0, 1.0) * uSeg) * segW;
    /* Thin — but thin measured in *device pixels*, not in geometry units.
       A fixed 0.036 here is 2.1px on a retina display and 0.68px on an ordinary
       one, where rbDetail correctly deletes it: the divisions, and with them
       the colour-blind position channel, silently disappear for every player
       without a HiDPI monitor. Previewing at dpr 2 cannot show you this.

       Pinned to px, the gap is the same hairline at every size and on every
       display; 2.4 clears GL_FADE_HI so it is never half-faded. The segW cap
       keeps a bar with many divisions from becoming more gap than plate. */
    float gapP = min(max(px * 2.4, 0.012), segW * 0.28);
    segMask = mix(1.0, rbEdge(0.0, gapP, sx), rbDetail(gapP) * hero);
  }

  /* The same divisions, whispered across the empty trough: without them the
     spent half of the bar has no scale on it, and how much room is left has to
     be estimated rather than read. */
  float troughDiv = (1.0 - segMask) * mFillA * (1.0 - rbEdge(fillX + px, fillX - px, p.x));

  float mFill  = mFillA * rbEdge(fillX + px, fillX - px, p.x) * segMask;
  float mGhost = mFillA * rbEdge(ghostX + px, ghostX - px, p.x) * segMask * (1.0 - mFill);

  /* ── The chip trail ────────────────────────────────────────────────────
     The span that was just lost. It is cut white-hot and cools over its own
     lifetime rather than appearing pre-cooled: a trail that is the same colour
     the instant it is cut and half a second later carries no information about
     *when* — which, in a round where three things hit the same creature, is the
     only thing that tells the three apart. */
  float chipT = clamp((ghostX - p.x) / max(ghostX - fillX, 0.0001), 0.0, 1.0);
  vec3 ghostCol = mix(mix(base, vec3(1.0), 0.52) * 0.62,
                      vec3(1.40, 1.02, 0.86), uChip * chipT * 0.72);

  /* ── Temp HP: a shield, not a stripe ───────────────────────────────────
     A thin band read as "some other bar happens to be here". A shield has to
     look like a thing placed *in front of* the hit points — so it spans nearly
     the full height, it is translucent enough that the health underneath still
     reads through it, and it carries a scaled lattice that no other layer has.
     Pattern is what sells it: colour alone just makes a second fill. */
  float tempX = mix(fx0, fx1, clamp(uTemp, 0.0, 1.0));
  float tempOn = step(0.001, uTemp) * hero;
  float mTempArea = mFillA * rbEdge(tempX + px, tempX - px, p.x)
                  * rbEdge(-0.86, -0.66, hb) * rbEdge(0.88, 0.68, hb) * tempOn;

  /* Two crossed diagonal families make diamond scales. The lattice is drawn in
     the shield plate itself rather than over the whole bar, so it stops exactly
     where the shield does. */
  float sc = 0.185;
  float l1 = abs(fract((p.x * 1.0 + p.y * 2.05) / sc) - 0.5);
  float l2 = abs(fract((p.x * 1.0 - p.y * 2.05) / sc) - 0.5);
  float lattice = smoothstep(0.30, 0.50, max(l1, l2)) * rbDetail(sc * 0.5);

  /* A slow shimmer travelling along it, so it reads as held rather than
     painted. */
  float shimmer = 0.5 + 0.5 * sin(p.x * 5.5 - uTime * 1.9);

  /* ── The leading edge ──────────────────────────────────────────────────*/
  float headIn = rbGauss(p.x - fillX, 0.055 + 0.11 * uBloom) * mFillA;
  vec3 headCol = mix(base, vec3(1.0), 0.60 + 0.35 * uBloom);

  /* ── The specular sweep ────────────────────────────────────────────────*/
  float sweepX = mix(fx0 - 0.9, fx1 + 0.9, fract(uTime * 0.30));
  float sweep = rbGauss(p.x - sweepX, 0.15) * mFill * uSweep;

  /* ── Stroke, cap, pip ──────────────────────────────────────────────────
     The furniture. A solid plate anchoring the left end and a detached pip past
     the right are what break the symmetry — a bar that is the same at both ends
     reads as a form control no matter how it is shaded. */
  vec3 GOLD  = vec3(1.000, 0.914, 0.722);
  vec3 STEEL = vec3(0.55, 0.62, 0.78);
  vec3 strokeCol = mix(vec3(0.085, 0.100, 0.140),
                       mix(STEEL, GOLD, 0.60), smoothstep(-0.75, 0.92, hb));

  /* The cap is a machined bracket, not a slab: an outer plate with a dark inlay
     milled out of it and a lit top edge. One inset is the whole difference
     between a part and a rectangle — a solid block of gold reads as a swatch,
     and a swatch reads as placeholder art. */
  float capCx = -b.x + 0.140;
  float dCapOut = sdBox(vec2(p.x - capCx, p.y), vec2(0.098, bb.y + 0.055));
  float dCapIn  = sdBox(vec2(p.x - capCx, p.y), vec2(0.036, bb.y * 0.52));
  float mCap = rbCover(dCapOut) * hero;
  float mCapIn = rbCover(dCapIn) * hero;
  vec3 capCol = mix(vec3(0.115, 0.135, 0.19), GOLD * 0.92, smoothstep(-0.95, 0.70, hb));
  capCol = mix(capCol, GOLD * 1.6, rbBand(hb - 0.90, 0.10) * 0.75);
  capCol = mix(capCol, vec3(0.030, 0.040, 0.062), mCapIn);
  capCol += GOLD * rbBand(hb - 0.30, 0.06) * mCapIn * 0.55;

  /* Two pips of unequal height rather than one slab. Asymmetry at the tail is
     what stops the eye reading the bar as a symmetrical widget. */
  float mPip = rbCover(sdBox(vec2(p.x - (b.x - 0.148), p.y), vec2(0.036, bb.y * 0.62))) * hero;
  mPip = max(mPip, rbCover(sdBox(vec2(p.x - (b.x - 0.056), p.y), vec2(0.025, bb.y * 0.30))) * hero);

  /* Register marks stepping outside the body at the quarters — the detail that
     says this was laid out on an instrument rather than drawn as a box. They
     leave once they no longer span a pixel. */
  float tickMark = 0.0;
  for (int k = 1; k < 4; k++) {
    float tx = mix(fx0, fx1, float(k) * 0.25);
    tickMark += rbBand(p.x - tx, 0.022) * rbBand(p.y + bb.y + 0.085, 0.055);
  }
  tickMark *= rbDetail(0.048) * hero;

  /* ── Compose ───────────────────────────────────────────────────────────*/
  vec3 C = vec3(0.0);
  float A = 0.0;

  C = mix(C, troughCol, mTrough); A = mix(A, 1.0, mTrough);
  C += vec3(0.16, 0.19, 0.26) * troughDiv * 0.55;
  C = mix(C, ghostCol, mGhost * step(uFrac, uGhost));
  C = mix(C, fillCol, mFill);

  /* ── The wave ──────────────────────────────────────────────────────────
     A glowing line crossing the bar in the direction the value moved, with a
     colour ramp trailing behind it. Outward on a heal, back down the bar on a
     hit.

     Deliberately simple. An earlier pass gave this a crest train, slope
     shading, flow streaks and a domed cross-section, and all of it fought the
     one thing the effect is for: being read peripherally, in under half a
     second, while you are looking at something else. Structure inside the ramp
     is detail nobody has time to resolve, and every extra term was one more
     thing to blow the colour out to white.

     Three parts, and nothing else:

       1. **The line.** Three widths — a coloured halo, a hot core, a white
          filament — so it reads as light rather than as a painted stroke.
       2. **The ramp.** One exponential decay behind the front, coloured in
          three stops: deep at the tail, the wave's hue through the body, a hot
          shoulder just behind the line. Three stops rather than a fade to
          nothing, because a fade in motion is a smear.
       3. **Nothing ahead of it.** That asymmetry is the direction cue: a
          symmetric band travelling along a bar is a highlight, and a highlight
          can be going either way. */
  if (uWave > 0.001) {
    float wx = mix(fx0 - 0.14, fx1 + 0.14, clamp(uWaveX, 0.0, 1.0));
    float dir = uHeal > 0.5 ? 1.0 : -1.0;
    float wd = (p.x - wx) * dir;                 /* < 0 behind the front */

    vec3 waveCol = mix(vec3(1.00, 0.17, 0.12), vec3(0.26, 1.00, 0.48), uHeal);
    vec3 hotCol  = mix(vec3(1.00, 0.60, 0.40), vec3(0.74, 1.00, 0.82), uHeal);
    vec3 deepCol = mix(vec3(0.34, 0.03, 0.05), vec3(0.02, 0.30, 0.24), uHeal);

    /* The ramp's length is a fraction of the *bar*, not a fixed distance in
       shader units. Written as a constant it is a third of a stubby rail and a
       twelfth of a wide hero bar, so the effect that is meant to be the loudest
       thing here quietly becomes a local highlight on exactly the bars with the
       most room to show it. */
    float rampLen = max(span * 0.44, 0.35);
    float env = exp(min(wd, 0.0) / rampLen) * (1.0 - step(0.0, wd));

    float f = clamp(env, 0.0, 1.0);
    vec3 rampCol = mix(deepCol, waveCol, smoothstep(0.00, 0.45, f));
    rampCol = mix(rampCol, hotCol, smoothstep(0.62, 1.00, f));

    /* On a heal the wave runs through the fill; on a hit it runs through the
       fill *and* the span being given up, so it crosses the trail on its way
       back down and the two events read as one. */
    float area = mix(max(mFill, mGhost), mFill, uHeal) * uWave;

    /* Hue before light. Added as pure light on top of an already-bright plate
       it just saturates: the green of a heal and the red of a hit both arrive
       as the same pale smear, which is the one thing this must not do. So the
       ramp *replaces* the material's colour where it passes, and only the line
       itself goes on top as light. */
    C = mix(C, rampCol, clamp(env * area * 1.90, 0.0, 1.0));

    C += waveCol * rbGauss(wd, 0.100) * area * 1.55;
    C += hotCol  * rbGauss(wd, 0.034) * area * 1.60;
    C += vec3(1.00, 0.97, 0.94) * rbGauss(wd, 0.014) * area * 0.85;

    /* It spills past the silhouette as well, so the wave is visible on a bar
       that is nearly empty — where the fill it would otherwise tint is a few
       pixels wide and there is nothing to see. */
    C += waveCol * rbGauss(wd, 0.110) * uWave * mTrough * 0.65;
  }
  /* The shield plate: a translucent pane over the fill, then its lattice, its
     top rim, and a hot leading edge where it ends. */
  vec3 shieldPane = uTempCol * (0.42 + 0.30 * shimmer);
  C = mix(C, shieldPane, mTempArea * 0.44);
  C += uTempCol * lattice * mTempArea * (0.30 + 0.22 * shimmer);
  C += uTempCol * rbBand(hb - 0.70, 0.07) * mTempArea * 0.85;
  C += uTempCol * rbBand(hb + 0.70, 0.06) * mTempArea * 0.35;
  /* Leading edge, pushed above 1.0 so the bloom pass finds it. */
  C += uTempCol * rbGauss(p.x - tempX, 0.045) * mFillA * tempOn * 1.9;
  C += headCol * headIn * (0.85 + 1.5 * uBloom);
  C += vec3(0.62, 0.74, 0.96) * sweep * 0.34;

  C = mix(C, strokeCol, mStroke); A = mix(A, 1.0, mStroke);
  capCol = mix(capCol, vec3(1.9, 1.7, 1.5), uFlash * 0.55);
  C = mix(C, capCol, mCap);       A = mix(A, 1.0, mCap);
  C = mix(C, mix(STEEL, GOLD, 0.35) * 0.90, mPip); A = mix(A, 1.0, mPip);
  C += STEEL * tickMark * 0.85; A = max(A, min(tickMark * 0.9, 1.0));

  /* Shield break: fractures wide enough to survive the 12px rail that is the
     only size this is ever drawn at, plus a drop in value and saturation, both
     of which survive any size at all. */
  if (uRole > 1.5 && uCracked > 0.001) {
    float c = rbBand(p.x * 0.9 + p.y * 2.1 + 0.35, 0.055)
            + rbBand(p.x * 0.9 - p.y * 1.7 - 0.90, 0.045)
            + rbBand(p.x * 0.9 + p.y * 2.4 - 2.10, 0.050);
    c *= mTrough * uCracked;
    C = mix(C, INK0, clamp(c, 0.0, 1.0) * 0.90);
    C = mix(C, vec3(dot(C, vec3(0.299, 0.587, 0.114))) * 0.72, uCracked * 0.65);
  }

  /* ── Impact ────────────────────────────────────────────────────────────
     A bar that only changes length reports a number; the hit has to *land*.
     The envelope decays 1 → 0, so the radius grows as the amplitude falls —
     one expanding, fading ring plus the spokes it throws off, both centred on
     where the value was when it changed rather than on the bar as a whole.

     All three terms are written well above 1.0 on purpose: the bright-pass
     downstream keeps only what exceeds 1.0, so anything meant to bloom has to
     be emitted as light, not as a pale colour. */
  if (uHit > 0.001) {
    vec2 hp = vec2(p.x - mix(fx0, fx1, uHitX), p.y * 1.55);
    float r = length(hp);
    float radius = (1.0 - uHit) * 1.05;
    vec3 hitCol = mix(vec3(1.00, 0.42, 0.34), vec3(0.55, 1.00, 0.72), uHeal);

    /* Narrow. A wide ring with a bright core is a blob, and a blob is a flash —
       it says "something happened" without saying where or how hard. The
       readable version is a thin front travelling outward, with the spokes
       running slightly ahead of it. */
    float ring = rbBand(r - radius, 0.028) * uHit * uHit * 2.6;
    float spokes = pow(abs(sin(atan(hp.y, hp.x) * 4.0)), 11.0);
    float spark = exp(-abs(r - radius * 1.22) / 0.045) * spokes * uHit * 1.8 * uSpark;

    /* Debris. Three streaks thrown along the bar's own axis, stretching as they
       travel and thinning as they go — the ring says how hard, the debris says
       which way. They are the first thing shed under load, which is why they are
       additive light on top of a complete picture rather than part of it. */
    float debris = 0.0;
    for (int k = 0; k < 3; k++) {
      float fk = float(k);
      float side = mod(fk, 2.0) < 0.5 ? -1.0 : 1.0;
      float travel = radius * (1.10 + fk * 0.26);
      float dx = hp.x - side * travel;
      float dy = hp.y - (fk - 1.0) * 0.34 * (1.0 - uHit);
      debris += exp(-abs(dx) / (0.012 + 0.070 * (1.0 - uHit)))
              * exp(-abs(dy) / 0.055);
    }

    C += hitCol * (ring + spark + debris * uHit * uHit * uSpark * 1.5)
       * mix(1.0, 0.45, 1.0 - hero);
  }

  /* The flare sits at the wound, and *only* at the wound.
     A full-quad whiteout is the obvious way to write this and it is wrong twice
     over: held through the hitstop it turns the whole bar white for 55ms, which
     buries the readout and the trail exactly when they are the two things worth
     looking at, and it says "the HUD blinked" rather than "it was hit there". */
  C += vec3(1.0, 0.92, 0.86) * uFlash * 1.25 * rbGauss(p.x - fillX, 0.060) * mFillA;

  /* The chrome breathes on the same slow clock as the fill. Two red pulses at
     different rates read as two unrelated warnings rather than as one state. */
  C = mix(C, vec3(1.00, 0.20, 0.24), mStroke * uLow * (0.28 + 0.52 * breathe));
  C = mix(C, vec3(1.0), uFlash * 0.06);

  vec3 outC = C * A * mix(0.80, 1.0, hero);
  float outA = A * mix(0.80, 1.0, hero);

  /* ── Bloom ─────────────────────────────────────────────────────────────
     Added after the premultiply, so it is light spilling past the body rather
     than a translucent shape drawn beside it. Nothing on a web page glows;
     everything in a game HUD does, and its absence is most of why a bar reads
     as a control instead of a readout. */
  float outside = max(dBody, 0.0);

  /* Every falloff below is exp(-outside/k), which is 1.0 everywhere *inside*
     the body — so without this gate the bloom does not spill past the bar, it
     floods it, and the plates and gaps it is supposed to be lighting from
     behind wash out into a smear. The glow exists only outside the silhouette;
     inside, the fill is already the light source. */
  float outMask = smoothstep(0.0, max(px * 1.6, 0.012), dBody);

  /* A floor only. The separable-blur pass downstream is the real bloom; an
     analytic halo on top of it reads as haze rather than as light, because the
     two falloffs do not agree and the mismatch looks like fog. What stays here
     is the contact light immediately against the body, which a low-resolution
     blur cannot resolve. */
  vec3 glowCol = mix(base, vec3(1.00, 0.16, 0.20), uLow * 0.85);
  float glow = exp(-outside / 0.055) * rbEdge(fillX + 0.14, fillX - 0.04, p.x) * 0.22;
  glow += exp(-outside / 0.045) * exp(-abs(p.x - fillX) / 0.14) * (0.30 + 0.9 * uBloom);
  glow += exp(-outside / 0.050) * uLow * (0.30 + 0.70 * breathe) * 0.55 * hero;
  glow *= outMask * mix(0.45, 1.0, hero);
  outC += glowCol * glow * 0.75;
  outA += glow * 0.26;

  gl_FragColor = vec4(outC, clamp(outA, 0.0, 1.0));
}
`;
