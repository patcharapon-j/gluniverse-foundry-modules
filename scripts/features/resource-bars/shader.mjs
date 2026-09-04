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

import { PRECISION, SCALE_PRELUDE, VERTEX_SHADER } from "../../core/glsl.mjs";
import { FX_GLSL_BREAK_FIELD, FX_GLSL_BREAK_PULSE, FX_GLSL_NOISE } from "../../core/fx-glsl.mjs";

/* Re-exported so this module stays the single import site for everything the
   feature compiles, as it was when it owned the constant. */
export { VERTEX_SHADER, PRECISION };


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
  uTemp: "float",     // temp HP as a fraction of max, 0 = none
  uCracked: "float",  // shield break, 0..1 (role 2)
  uHit: "float",      // impact envelope, 1 at the frame of the hit decaying to 0
  uHitX: "float",     // where the hit landed, as a fraction along the bar
  uHeal: "float",     // 1 while the impact envelope is a heal rather than a hit
  uSpark: "float",    // debris + spoke intensity, 0 once shed under load
  uChip: "float",     // how fresh the chip trail is, 1 = just cut and white-hot
  uWave: "float",     // change-sweep amplitude, 0..1
  uWaveX: "float",    // the sweep front's position, as a fraction along the bar
  uSeg: "float",      // divisions across the fill, 0 = one continuous plate
  uSegW: "float",     // the gap between two plates, in device pixels
  uRole: "float",     // 0 hero bar, 1 secondary rail, 2 shield rail

  uBreak: "float",     // guard-break fracture, 0..1 (0 = intact); hero row only
  uBreakT: "float",    // seconds since the fracture landed — the shatter's own clock
  uBreakX: "float",    // where it nucleated, as a fraction along the bar
  uBreakFlow: "float", // the energy flowing along the seams, 0 once shed under load
  uSeed: "float",      // per-token seed, so two broken creatures shatter differently

  uRamp: "vec3[4]",   // health ramp in OKLab, empty → full
  uTempCol: "vec3",   // temp-HP overlay colour, sRGB 0..1
  uShieldCol: "vec3", // shield rail colour, sRGB 0..1
  uRailCol: "vec3",   // secondary-rail colour, sRGB 0..1 (the suite accent)
  uBreakAmber: "vec3",// fracture seam gold, sRGB 0..1
  uBreakHot: "vec3",  // fracture core gold, sRGB 0..1
});

/** Frame shape and the numeric run's safe inset, in bar-height units.
 * BODY_INSET is zero so the visible frame spans exactly the token width. */
export const CUT = 0.20;
export const BODY_INSET = 0.0;
export const READOUT_INSET = 0.06;

/**
 * The shield ribs' pitch, in bar heights.
 *
 * Named and generous because the number is a legibility floor rather than a
 * taste: on a 128px grid the bar is 19px tall, which puts a 0.44 cell at about
 * 8px, and that is the smallest a repeating pattern can be and still read as one
 * rather than as grain over the value the player came to take. This replaced two
 * crossed families at 0.185, whose cells were three pixels across before the
 * crossing halved them again.
 */
export const SHIELD_PITCH = 0.44;

/**
 * The guard-break fracture's two shape parameters, in the units
 * `core/fx-glsl.mjs`'s field takes them: how many shards, and how far they
 * spread. Both are 1.0 for the square-ish quads that field was written for and
 * neither can be 1.0 here, which is the whole reason it takes them.
 *
 * BREAK_DENSE scales the shard count. The cells are round and this shader's
 * space is one unit per *bar height*, so a bar height is what sets their size:
 * 0.30 puts a cell at about a fifth of one, which is ~4 device pixels on the
 * 19px reference bar. At the field's own 1.0 they would be a pixel across —
 * mathematically the same fracture, and grain.
 *
 * BREAK_REACH is how far the crack travels from the impact, as a fraction of the
 * bar's *length* rather than as a constant. A constant is most of a stubby rail
 * and a tenth of a wide hero bar, so the fracture would die a tenth of the way
 * along exactly the bars with the room to show it — the same trap the wave's
 * ramp length documents above. It also sets the pitch of the energy flowing
 * along the seams, which is measured against this distance: a longer reach makes
 * that flow *coarser*, which is the direction that survives a small bar.
 */
export const BREAK_DENSE = 0.30;
export const BREAK_REACH = 1.80;

/**
 * The crack line's own weight, in the field's edge units.
 *
 * It is not the thing that keeps the seams visible — the field floors its own
 * antialiasing at a device pixel, and on any bar at playable size that floor is
 * what wins. This only decides how heavy the fracture looks once you have zoomed
 * far enough in for the floor to stop mattering. The initiative overlay uses
 * 0.08 on a token quad and etched-chat 0.05 on a card; a bar is read at a
 * fraction of either size, so it takes the heaviest of the three.
 */
export const BREAK_THICK = 0.14;

export const FRAGMENT_SHADER = PRECISION + SCALE_PRELUDE + `
const float CUT = ` + CUT.toFixed(4) + `;
const float BODY_INSET = ` + BODY_INSET.toFixed(4) + `;
const float SHIELD_PITCH = ` + SHIELD_PITCH.toFixed(4) + `;
const float BREAK_DENSE = ` + BREAK_DENSE.toFixed(4) + `;
const float BREAK_REACH = ` + BREAK_REACH.toFixed(4) + `;
const float BREAK_THICK = ` + BREAK_THICK.toFixed(4) + `;` + `
varying vec2 vTextureCoord;

uniform float uTime;
uniform float uAspect;
uniform float uFrac;
uniform float uGhost;
uniform float uBloom;
uniform float uFlash;
uniform float uLow;
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
uniform float uSegW;
uniform float uRole;
uniform float uBreak;
uniform float uBreakT;
uniform float uBreakX;
uniform float uBreakFlow;
uniform float uSeed;
uniform vec3  uRamp[4];
uniform vec3  uTempCol;
uniform vec3  uShieldCol;
uniform vec3  uRailCol;
uniform vec3  uBreakAmber;
uniform vec3  uBreakHot;

/* The guard-break fracture, shared verbatim with the initiative tracker's token
   overlay and card portraits and with the etched-chat crit crack. Only the field
   is shared; the colouring below is this shader's own, because that is the part
   that has to answer to what it is being drawn over. uSeed must be declared
   before either chunk — both hash against it. */` + FX_GLSL_NOISE + FX_GLSL_BREAK_FIELD + FX_GLSL_BREAK_PULSE + `

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

   The corner and the readout share this end of the bar, which sounds like a
   collision and is not, because of *what* is nearest the corner. The run is
   right-aligned and its last part is the maximum: two-thirds the size of the
   value and sitting on the shared baseline rather than on the mid-line, so its
   ink reaches only about a tenth of a bar-height above centre where the value
   reaches three tenths. The small low part passes under the diagonal, and the
   tall part is already well to its left. That is a real dependency and not a
   happy accident: make the maximum bigger, or stop bottom-aligning it, and the
   digits move up into the cut. resource-bar-check computes the clearance from
   those two sizes rather than trusting this comment.

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

  // Horizontal bounds match the token; vertical padding separates the rails.
  float padY = mix(0.15, 0.10, hero);
  vec2 bb = vec2(b.x - BODY_INSET, b.y - padY);

  float hb = clamp(p.y / max(bb.y, 0.0001), -1.0, 1.0);

  /* Three separated layers, not one welded frame: stroke, air, trough, lip,
     fill. The gaps are the point — a stroke that touches its trough is a
     border, and a border is a form control. */
  float sw  = max(0.030, px * 1.05);
  float air = 0.025;
  float lip = 0.025;

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
     exactly one place — the top of the stroke — which is what keeps it reading
     as a material catching light rather than as a colour scheme. */
  // Keep healthy values near jade while preserving the configured ramp.
  float bloodied = (1.0 - step(0.5, uFrac)) * hero;
  float rampT = clamp(uFrac / 0.72, 0.0, 1.0);
  vec3 base = uRole < 0.5 ? rampAt(rampT) : (uRole < 1.5 ? uRailCol : uShieldCol);
  // Use the configured danger color so alternate palettes remain meaningful.
  base = mix(base, rampAt(0.06) * vec3(0.88, 0.72, 0.78), bloodied);
  float grey = dot(base, vec3(0.299, 0.587, 0.114));
  base = mix(base, vec3(grey), mix(0.24, 0.06, hero));
  base = mix(base, uTempCol, 0.16 * smoothstep(0.6, 1.0, uFrac) * hero);
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

  /* Refractive core: the colour lives behind a smoked pane. Three travelling
     ribbons refract in opposite directions; their broad shadows remain visible
     when zoom removes the thin caustic edges. No texture uploads per frame. */
  float phase = uTime * 0.3926990817;
  float breathe = 0.5 + 0.5 * sin(phase);
  float depth = smoothstep(-0.95, 0.65, hb);
  vec3 fillCol = base * mix(0.08 + 0.24 * depth, 0.24 + 0.36 * depth, hero);
  fillCol += base * rbGauss(hb + 0.70, 0.22) * 0.42;
  // Bloodied liquid rolls in broad, slow folds instead of glass-like planes.
  float liquidQ = (p.x - fx0) / span;
  float fold = sin(liquidQ * 8.0 + hb * 3.2 - phase * 0.5
                 + sin(liquidQ * 4.0 + phase * 0.25) * 1.1);
  fillCol *= 1.0 - bloodied * (0.12 + 0.14 * fold);
  fillCol += base * rbGauss(fold - 0.25, 0.40) * bloodied * 0.30;
  float glassLight = 0.0;
  float glassShade = 0.0;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float q = (p.x - fx0) / span;
    float slope = fi < 1.5 ? 0.78 + fi * 0.45 : -1.45;
    float bend = sin(q * 6.0 + phase + fi) * 0.042
               + sin(q * 11.0 - phase * 0.5 + fi * 1.7) * 0.012;
    bend = mix(bend, sin(q * 7.0 - phase * 0.5 + fi * 1.6) * 0.15
                    + sin(q * 3.0 + phase * 0.25 + fi) * 0.07, bloodied);
    float d = p.y + (q - 0.5) * slope - (fi - 1.0) * 0.22 + bend;
    float focus = pow(0.5 + 0.5 * sin(q * 10.0 - phase + fi * 2.1), 6.0);
    glassLight += rbGauss(d, 0.025 + fi * 0.006 + bloodied * 0.025)
                * (0.18 + focus * 0.32);
    glassShade += rbGauss(d + 0.048, 0.09) * 0.10;
    // Defocused internal reflection sits behind the sharp moving caustic.
    float echo = d - 0.075 - 0.018 * sin(phase * 0.5 + fi);
    fillCol += mix(base, uTempCol, 0.18 * (1.0 - bloodied)) * rbGauss(echo, 0.055)
             * (0.08 + focus * 0.20) * hero;
    float glint = pow(0.5 + 0.5 * sin(q * 14.0 + phase * 2.0 + fi), 18.0);
    fillCol += vec3(0.82, 0.96, 1.0) * rbBand(d, 0.010)
             * glint * focus * 0.24 * hero * (1.0 - bloodied * 0.8);
    // Light passes through the plane, then splits at its thin edge.
    fillCol += base * rbGauss(d - 0.06, 0.12) * 0.30;
    fillCol += uTempCol * rbBand(d - 0.018, 0.007) * focus * 0.10 * hero * (1.0 - bloodied);
    fillCol += uBreakAmber * rbBand(d + 0.015, 0.006) * focus * 0.06 * hero;
  }
  fillCol *= 1.0 - glassShade * hero;
  fillCol += mix(base, uTempCol, 0.20 * (1.0 - bloodied)) * glassLight * 0.85 * hero;
  float facet = smoothstep(-0.12, 0.12, sin(p.x * 1.9 + p.y * 5.2 + phase * 0.25));
  fillCol *= 0.85 + 0.15 * facet;
  fillCol += mix(uTempCol, base, bloodied) * glassLight * rbGauss(hb + 0.60, 0.24) * 0.15 * hero;
  fillCol += mix(base, vec3(1.0), 0.68) * rbBand(hb - 0.81, 0.035) * 0.65;
  fillCol += base * rbBand(hb + 0.83, 0.045) * 0.38;
  // Bloodied is a separate material: rolling cellular fluid, no glass ribbons.
  if (bloodied > 0.5) {
    // Two broad fluid layers with a soft meniscus, no cellular grain.
    float roll = sin(liquidQ * 4.5 - phase * 0.5);
    float surface = hb + roll * 0.20 + sin(liquidQ * 7.0 + phase * 0.25) * 0.06;
    float body = smoothstep(-0.65, 0.65, surface);
    fillCol = base * (0.38 + body * 0.26);
    fillCol += base * rbGauss(surface - 0.22, 0.30) * 0.16;
    fillCol += base * rbGauss(hb + 0.73, 0.18) * 0.26;
  }
  // The lower rim carries the warning, leaving the centre quiet for the value.
  fillCol += base * uLow * hero * (0.12 + 0.34 * breathe);

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

       Pinned to px, the gap is the same width at every size and on every
       display; uSegW is that width, in device pixels, and every value the GM
       can choose clears GL_FADE_HI (see DIVIDER in constants.mjs), so it is
       never half-faded and the plates read as assembled parts rather than as a
       bar with scratches in it. The floor scales with it rather than sitting at
       a fixed 0.030, so a wider divider is still wider on a bar tall enough for
       the floor to win. The segW cap keeps a bar with many divisions from
       becoming more gap than plate — and it is the cap, not the px term, that
       does the work once a per-HP division count runs into the dozens. */
    float gapP = min(max(px * uSegW, 0.005 * uSegW), segW * 0.42);
    segMask = 1.0 - (1.0 - smoothstep(max(0.0, gapP - px), gapP, sx)) * hero;
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
  vec3 ghostCol = mix(uBreakAmber * 0.20, uBreakHot * 0.72, uChip);
  float shard = rbBand(p.y - sin(p.x * 3.2 + uSeed) * 0.19, 0.018)
              + rbBand(p.y + p.x * 0.12 - 0.10, 0.012);
  ghostCol += uBreakHot * shard * uChip * 0.65;

  // A broad luminous shield band is distinct from the health material.
  float tempX = mix(fx0, fx1, clamp(uTemp, 0.0, 1.0));
  float tempOn = step(0.001, uTemp) * hero;
  float mTempArea = mFillA * rbEdge(tempX + px, tempX - px, p.x)
                  * rbEdge(0.04, 0.18, hb) * tempOn;

  /* One family of diagonal ribs, not two crossed ones.

     Crossing two families at a 0.185 pitch made diamond scales, which is a nice
     idea at preview size and noise at the size this actually draws: on a 128px
     grid the bar is 19px tall, so those diamonds were about three pixels across
     and the crossing halved the feature size again. Anything with detail below
     a couple of pixels stops being a pattern and becomes grain over the one
     reading the player came to take.

     One family at more than twice the pitch survives. It is also the more
     legible idea: parallel ribs read as plating, and plating is what temporary
     hit points are — something strapped over the health rather than part of it.

     Drawn as bright lines rather than as filled cells, so the shield adds light
     to the fill underneath instead of masking it. A pattern that hides the
     health it sits on top of has broken the one rule the layer has. */
  float sc = SHIELD_PITCH;
  float k = (p.x + p.y * 1.35) / sc;
  /* fract() gives distance along the gradient; the ribs run perpendicular to
     it, so divide by the gradient's length to get a real distance and keep the
     rib the same width whatever angle it is set at. */
  float dRib = abs(fract(k) - 0.5) * sc / 1.675;
  float ribW = max(px * 1.1, 0.020);
  float lattice = rbBand(dRib, ribW) * rbDetail(sc * 0.5);

  /* A slow shimmer travelling along it, so it reads as held rather than
     painted. */
  float shimmer = 0.5 + 0.5 * sin(p.x * 5.5 - phase * 2.0);

  /* ── The leading edge ──────────────────────────────────────────────────*/
  float headIn = rbGauss(p.x - fillX, 0.055 + 0.11 * uBloom) * mFillA;
  vec3 headCol = mix(base, vec3(1.0), 0.60 + 0.35 * uBloom);


  /* ── Stroke ────────────────────────────────────────────────────────────
     There used to be end furniture here: a milled gold bracket anchoring the
     left end and two pips of unequal height past the right, there to break the
     symmetry so the bar would not read as a form control.

     They are gone, and the asymmetry they were providing now comes from the cut
     corner instead — which does the same job with none of the width. The
     furniture was costing about a fifth of the bar's length at both ends
     together, on the one element whose length *is* its content, and at true
     size on a 128px grid the pips were two three-pixel marks nobody could read
     as anything. Ornament that cannot be resolved is just a shorter bar. */
  vec3 GOLD  = vec3(1.000, 0.914, 0.722);
  vec3 STEEL = vec3(0.55, 0.62, 0.78);
  vec3 strokeCol = mix(vec3(0.085, 0.100, 0.140),
                       mix(STEEL, GOLD, 0.60), smoothstep(-0.75, 0.92, hb));


  /* Register marks stepping outside the body at the quarters — the detail that
     says this was laid out on an instrument rather than drawn as a box. They
     leave once they no longer span a pixel. */
  float tickMark = 0.0;
  for (int k = 1; k < 4; k++) {
    float tx = mix(fx0, fx1, float(k) * 0.25);
    tickMark += rbBand(p.x - tx, 0.022) * rbBand(p.y + bb.y + 0.085, 0.055);
  }
  tickMark *= rbDetail(0.048) * hero * 0.20;

  /* ── Compose ───────────────────────────────────────────────────────────*/
  vec3 C = vec3(0.0);
  float A = 0.0;

  C = mix(C, troughCol, mTrough); A = mix(A, 1.0, mTrough);

  C = mix(C, ghostCol, mGhost * step(uFrac, uGhost));
  C = mix(C, fillCol, mFill);

  // Damage tears the fluid with a jagged compression front. Healing grows
  // curved overlapping ripples, with small motes riding the restored fill.
  if (uWave > 0.001) {
    float wx = mix(fx0 - 0.14, fx1 + 0.14, clamp(uWaveX, 0.0, 1.0));
    float dir = uHeal > 0.5 ? 1.0 : -1.0;
    float frontShape = mix(abs(sin(hb * 8.0 + uSeed)) * 0.10,
                           hb * hb * 0.18, uHeal);
    float wd = (p.x - wx) * dir + frontShape;
    float area = mix(max(mFill, mGhost), mFill, uHeal) * uWave;
    vec3 waveCol = mix(vec3(1.0, 0.22, 0.08), vec3(0.20, 0.90, 0.64), uHeal);
    float wake = exp(-abs(wd + 0.16) / 0.28) * (1.0 - step(0.0, wd));
    C = mix(C, waveCol * 0.32, wake * area * (1.0 - uHeal) * 0.65);
    float crest = rbGauss(wd, 0.035);
    float echo = rbGauss(wd + mix(0.13, 0.24, uHeal), 0.055);
    C += waveCol * (crest * 1.2 + echo * 0.36 + wake * 0.22) * area;
    C += mix(vec3(1.0, 0.70, 0.43), vec3(0.76, 1.0, 0.88), uHeal)
       * rbBand(wd, 0.012) * area * 0.45;
    float mote = pow(max(0.0, sin(p.x * 17.0 + hb * 9.0)), 14.0)
               * pow(max(0.0, cos(hb * 12.0 - uWaveX * 9.0)), 12.0);
    C += vec3(0.65, 1.0, 0.82) * mote * wake * area * uHeal * 0.8;
    C += waveCol * crest * uWave * mTrough * 0.25;
  }
  /* The shield plate: a translucent pane over the fill, then its lattice, its
     top rim, and a hot leading edge where it ends. */
  vec3 shieldPane = uTempCol * (0.65 + 0.35 * shimmer);
  C = mix(C, shieldPane, mTempArea * 0.58);
  C += uTempCol * lattice * mTempArea * (0.50 + 0.25 * shimmer);
  C += uTempCol * rbBand(hb - 0.70, 0.07) * mTempArea * 1.20;
  C += uTempCol * rbBand(hb - 0.20, 0.045) * mTempArea * 0.85;
  /* Leading edge, pushed above 1.0 so the bloom pass finds it. */
  C += uTempCol * rbGauss(p.x - tempX, 0.045) * mTempArea * 1.65;
  C += headCol * headIn * (0.55 + 1.1 * uBloom);

  C = mix(C, strokeCol, mStroke); A = mix(A, 1.0, mStroke);
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

  /* ── Guard break ───────────────────────────────────────────────────────
     The creature's guard has been shattered, so the *instrument* is shattered:
     one fracture across the whole body — trough, fill and frame alike — clipped
     to the silhouette by mBody so the cut corner cuts the cracks too and nothing
     lands out in the bloom margin.

     It is the same fracture the initiative tracker puts on the token and on the
     card, from the same field in core/fx-glsl.mjs, on the same clock. Three
     lookalikes drawn three times is how a break ends up meaning three slightly
     different things.

     Two deliberate differences from the way that field is drawn elsewhere, and
     both are about what it is being drawn *over*.

     **It cuts before it lights.** FX_FRAG_BREAK is pure additive gold, which is
     right over token art and wrong over a bar: laid on an already-bright plate,
     the gold and the arterial red of a nearly-dead fill both arrive as the same
     pale smear — the exact failure the wave above is written to avoid. So the
     seam darkens the material it crosses and the light goes *in* the seam, which
     is also what a fracture in a lit pane actually looks like.

     **It does not touch the reading.** No desaturation, no dimming, nothing
     following the health — unlike the shield break above, which is allowed to
     grey out a rail whose whole subject is the thing that broke. A guard break
     says nothing about hit points, and a bar that dulls its own fill to announce
     an unrelated state has stopped being the measurement it is there to be.

     uBreak arrives 0 on the rails (the host only writes it for the hero row), so
     this branch — the most expensive thing in the shader, and the only place it
     evaluates a Voronoi field and two octaves of fbm — is skipped on every bar
     that is not a broken creature's own. */
  if (uBreak > 0.001) {
    /* It nucleates at the leading edge of the fill as it stood when the break
       landed, a little above the mid-line. That point is the only one on a bar
       that means anything, so it is where the eye already is and where the
       shards are finest — and it is captured once rather than followed, because
       a fracture that slides along with the next hit is a decal, not damage. */
    vec2 imp = vec2(mix(fx0, fx1, clamp(uBreakX, 0.0, 1.0)), bb.y * 0.22);
    float breakClock = min(uBreakT, 0.715) + max(0.0, uBreakT - 0.715) * 0.5;
    // Refraction bends the fracture into the bevel instead of cutting it off.
    float bevelY = smoothstep(0.50, 0.96, abs(hb));
    float bevelX = smoothstep(bb.x - 0.24, bb.x, abs(p.x));
    vec2 fractureP = p;
    fractureP.x += sin(hb * 2.6) * bevelY * 0.10;
    fractureP.y += sin(p.x * 2.1 + uSeed) * bevelX * 0.065;
    fractureP.y *= 1.0 + bevelY * 0.18;
    vec4 fld = gluBreakField(fractureP, imp, breakClock, BREAK_THICK, px,
                             BREAK_DENSE, max(uAspect * BREAK_REACH, 1.6));
    // Keep the shared golden fracture network. A dark cut, amber shoulders,
    // and a narrow hot filament give each seam depth without extra crack noise.
    float crack = fld.x;
    float halo = fld.y;
    float hotCore = fld.z * (1.0 - smoothstep(0.12, 0.55, uBreakT));
    float glowFlow = fld.w * uBreakFlow;
    float bpulse = gluBreakPulse(breakClock);
    float edgeFade = smoothstep(0.004, 0.11, -dBody);
    // Quiet the right-side reading area with a soft falloff, not a label box.
    float readZone = smoothstep(0.25, 0.52, (p.x - fx0) / span)
                   * (1.0 - smoothstep(0.34, 0.78, abs(hb)));
    float variation = 0.55 + 0.45 * smoothstep(-0.7, 0.8,
                      sin(p.x * 2.3 + p.y * 5.1 + uSeed));
    float amt = uBreak * mBody * edgeFade * (1.0 - readZone * 0.94);
    C *= 1.0 - readZone * uBreak * 0.24;
    float filament = pow(clamp(crack, 0.0, 1.0), 2.6);
    float shoulder = sqrt(clamp(crack, 0.0, 1.0));
    float gleam = glowFlow * (0.35 + 0.25 * bpulse);

    C = mix(C, INK0, shoulder * amt * 0.56);
    // Warm gold remains visible through the empty part of the pane as well.
    C += uBreakAmber * shoulder * amt * 0.34 * variation;
    C += mix(uBreakAmber, uBreakHot, 0.76) * crack * amt * 0.50 * variation;
    C += uBreakHot * filament * amt * (0.25 * variation + gleam * 0.60);
    C += uBreakAmber * halo * amt * 0.36 * variation;
    C += mix(uBreakHot, vec3(1.0, 0.96, 0.83), 0.35)
       * (gleam * filament * 0.48 + hotCore * 0.52) * amt;
    float lit = clamp(shoulder + halo + hotCore, 0.0, 1.0);
    /* The seams cross the gap of air between the stroke and the trough, where
       the bar has no alpha at all. Without this the crack is premultiplied to
       nothing exactly where it would have read as one pane rather than two. */
    A = max(A, min(lit * amt * 1.10, 1.0));
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
    float ring = rbBand(r - radius, 0.028) * uHit * uHit * 1.6;
    // Healing has concentric fluid ripples; hits retain sharp expelled shards.
    ring += rbGauss(r - radius * 0.62, 0.045) * uHit * uHeal * 0.65;
    float spokes = pow(abs(sin(atan(hp.y, hp.x) * 4.0)), 11.0);
    float spark = exp(-abs(r - radius * 1.22) / 0.045) * spokes * uHit * 1.8 * uSpark * (1.0 - uHeal);

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

    C += hitCol * (ring + spark + debris * uHit * uHit * uSpark * 1.5 * (1.0 - uHeal))
       * mix(1.0, 0.45, 1.0 - hero) * mBody;
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

  // A broad, soft recess protects the in-bar reading without adding a badge.
  float readingWell = rbGauss(p.y, 0.13) * hero * mTrough;
  C *= 1.0 - readingWell * 0.34;
  // Dividers remain opaque black across every fill and effect layer.
  C = mix(C, vec3(0.0), (1.0 - segMask) * mFillA);
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
