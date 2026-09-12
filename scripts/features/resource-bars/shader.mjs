/**
 * GLUniverse Suite — resource bars: the fragment shader.
 *
 * One quad per bar, everything computed per-pixel: the recessed well, the
 * health liquid and its meniscus front, the chip trail, the temp-HP overlay,
 * the segment ticks, the low-health breath, the change wave, the impact and its
 * debris, and the chamfered Etched Glass frame. Doing it in a shader rather
 * than in PIXI.Graphics is what makes "shading" and "animates every frame"
 * cheap instead of a per-token retessellation.
 *
 * ── Three liquids, one program each ──
 *
 * The primary bar is filled with one of three stylised liquids — ink, mercury
 * or lava — chosen by the world setting `rb.liquid`. Each is a separate
 * *program*, string-assembled from the shared frame below and that liquid's
 * own chunk, so a bar only ever pays for the material it draws: a shader that
 * carried all three behind a uniform switch would still be compiled, linked and
 * (on some drivers) evaluated as all three. `fragmentShader(liquid)` is the only
 * way a program is built, and `tools/resource-bar-check.mjs` checks every
 * variant rather than the default one.
 *
 * The rails and the shield rail keep a flat plate: a secondary resource is not
 * health, and giving it the same liquid would say it is.
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
 * space via `px`, one device pixel in p units.
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
 * cross-checks this list against every liquid's GLSL and against the JS that
 * supplies them: a uniform declared and never set is a silent no-op, and one set
 * and never declared is a silent typo.
 */
export const UNIFORMS = Object.freeze({
  uTime: "float",     // seconds on the idle loop (see IDLE_LOOP_S)
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
  uSpark: "float",    // debris intensity, 0 once shed under load
  uChip: "float",     // how fresh the chip trail is, 1 = just cut and white-hot
  uWave: "float",     // change-sweep amplitude, 0..1
  uWaveX: "float",    // the sweep front's position, as a fraction along the bar
  uSeg: "float",      // divisions across the fill, 0 = one continuous plate
  uSegW: "float",     // the gap between two plates, in bar heights (world-sized: it scales with zoom)
  uRole: "float",     // 0 hero bar, 1 secondary rail, 2 shield rail
  uReveal: "float",   // materialise wipe: 0 nothing drawn, 1 the whole bar
  uFade: "float",     // overall opacity while a bar fades out, 1 at rest

  uFlow: "float",     // the liquid's own animated layer, 1 on, 0 once shed under load
  uWobble: "float",   // the meniscus's idle wobble, 1 on, 0 once shed
  uSlosh: "float",    // the front's slosh after a change, -1..1, 0 at rest or shed

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
 * ramp length documents. It also sets the pitch of the energy flowing along the
 * seams, which is measured against this distance: a longer reach makes that flow
 * *coarser*, which is the direction that survives a small bar.
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

/** The three liquids, in the order the setting offers them. */
export const LIQUIDS = Object.freeze(["ink", "mercury", "lava"]);
export const DEFAULT_LIQUID = "ink";

/**
 * The length of the idle loop, in seconds. `anim.mjs` wraps the shader clock
 * here (TIMING.idleLoopMs), and every moving term in every liquid is written as
 * a whole number of cycles of it — through `rbPhase(k)` for an angle and
 * `rbDrift(k, period)` for a translation of periodic noise — so the wrap lands
 * on the same frame it left and a bar nobody is watching does not step once a
 * minute. `resource-bar-check` pins both halves.
 */
export const IDLE_LOOP_S = 64;

/**
 * The leading edge's shape, in bar heights.
 *
 * The front is a rounded meniscus rather than a ruler line, which is most of
 * what makes the fill read as liquid. It has three terms — the meniscus itself,
 * a very small idle wobble, and the slosh a value change sets off — and each is
 * built from a profile across the fill's height whose **mean is zero**:
 * `1/3 - y²`, `y`, `y² - 1/3` and `cos(πy)` all integrate to nothing over
 * [-1, 1]. So the centre of the front, averaged over the bar's height, is
 * exactly where the value is. The shape bends around the reading; it never
 * moves it.
 *
 * The amplitudes are chosen so that the worst case of all three together stays
 * inside a third of a bar height either way: 0.15 × 2/3 + 0.025 × 1 + 0.15 × 1
 * = 0.275. Past that the front stops being a curve on a length and becomes a
 * second, disagreeing length. `resource-bar-check` evaluates `rbFront`'s own
 * GLSL numerically to hold both claims, rather than trusting this comment.
 */
export const FRONT = Object.freeze({ meniscus: 0.15, wobble: 0.025, slosh: 0.15 });

/**
 * How much of its own glow the lava gives up while the guard is broken.
 *
 * The lava's seams are warm light in cracks between plates, and the guard break
 * is gold light in cracks — laid over one another at full strength the fracture
 * the initiative tracker put there simply disappears into the lava. So the lava
 * dims its *seams* (never its plates, and never the hue: the reading is not
 * touched) and lets the gold carry the break.
 */
export const LAVA_BREAK_DIM = 0.65;

const f4 = (n) => n.toFixed(4);

/* ── The shared frame ───────────────────────────────────────────────────── */

const HEAD = PRECISION + SCALE_PRELUDE + `
const float CUT = ` + f4(CUT) + `;
const float BODY_INSET = ` + f4(BODY_INSET) + `;
const float SHIELD_PITCH = ` + f4(SHIELD_PITCH) + `;
const float BREAK_DENSE = ` + f4(BREAK_DENSE) + `;
const float BREAK_REACH = ` + f4(BREAK_REACH) + `;
const float BREAK_THICK = ` + f4(BREAK_THICK) + `;
const float LAVA_BREAK_DIM = ` + f4(LAVA_BREAK_DIM) + `;
const float LOOP_W = ` + (Math.PI * 2 / IDLE_LOOP_S).toFixed(10) + `;` + `
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
uniform float uReveal;
uniform float uFade;
uniform float uFlow;
uniform float uWobble;
uniform float uSlosh;
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

   The corner and the readout share this end of the bar, which sounds like a
   collision and is not, because of *what* is nearest the corner. The run is
   right-aligned and its last part is the maximum: two-thirds the size of the
   value and sitting on the shared baseline rather than on the mid-line, so its
   ink reaches only about a tenth of a bar-height above centre where the value
   reaches three tenths. resource-bar-check computes the clearance from those
   two sizes rather than trusting this comment.

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

/* ── The idle loop ───────────────────────────────────────────────────────
   Every moving term goes through these two. rbPhase(k) is an angle that turns
   k whole times per loop; rbDrift(k, period) slides periodic noise by k whole
   periods per loop. Either way the loop's wrap is invisible, which is the only
   reason the loop can wrap at all. Pass whole numbers. */
float rbPhase(float k) {
  return uTime * LOOP_W * k;
}

float rbDrift(float k, float period) {
  return rbPhase(k) * period * 0.1591549431;
}

/* Hash and value noise, periodic in x with the given lattice period so that a
   drift of whole periods is seamless. Seeded per token, so two creatures'
   liquids do not move in lockstep. */
float rbHash(vec2 i) {
  return fract(sin(dot(i, vec2(127.1, 311.7)) + uSeed * 1.7) * 43758.5453);
}

float rbNoise(vec2 x, float period) {
  vec2 i = floor(x);
  vec2 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  float i0 = mod(i.x, period);
  float i1 = mod(i.x + 1.0, period);
  float a = rbHash(vec2(i0, i.y));
  float b = rbHash(vec2(i1, i.y));
  float c = rbHash(vec2(i0, i.y + 1.0));
  float d = rbHash(vec2(i1, i.y + 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

/* The leading edge, as an x-offset from the true value at height fy (-1 at the
   bottom of the fill, 1 at the top). Every profile here integrates to zero over
   [-1, 1], so the front's centre is the value; see FRONT in shader.mjs for the
   amplitude budget. resource-bar-check evaluates this function's own source, so
   keep it to float arithmetic, sin, cos and rbPhase. */
float rbFront(float fy, float wobble, float slosh) {
  float meniscus = ` + f4(FRONT.meniscus) + ` * (0.3333333333 - fy * fy);
  float lean = ` + f4(FRONT.wobble) + ` * wobble * (0.6 * fy * sin(rbPhase(3.0)) + 0.6 * (fy * fy - 0.3333333333) * sin(rbPhase(5.0) + 1.3));
  float surge = ` + f4(FRONT.slosh) + ` * slosh * (0.75 * fy + 0.25 * cos(3.1415926536 * fy));
  return meniscus + lean + surge;
}

/* Etched Glass ink, mirrored from PALETTE.ink1 / ink2 in core/theme.mjs. */
const vec3 INK  = vec3(0.043, 0.059, 0.090);
const vec3 INK0 = vec3(0.008, 0.027, 0.043);
`;

/* ── The liquids ────────────────────────────────────────────────────────────
   Each liquid is five snippets spliced into main() — `functions` at file scope,
   `decl` before the fill, `fill` (writes fillCol and cover), `wave` and `impact`
   — so they read main()'s locals directly instead of through a twelve-argument
   signature per liquid. Every snippet must use only what main() has declared by
   the point it is spliced in. */

const LIQUID_CHUNKS = {
  /* Ink, or plasma: a slow domain-warped field flowing along the tube,
     posterised into a few flat tones of the health colour. The calmest of the
     three and the default, because a fill that is always quietly moving is
     still a fill that is mostly not asking to be looked at. */
  ink: {
    functions: `
float inkField(vec2 lq) {
  /* Stretched along the bar so it reads as flow down a tube, not as blotches. */
  vec2 w = vec2(lq.x * 0.95, lq.y * 2.6);
  if (uFlow < 0.5) return rbNoise(w, 12.0);
  vec2 warp = vec2(rbNoise(w * 0.7 + vec2(rbDrift(1.0, 6.0), 1.7), 6.0),
                   rbNoise(w * 0.7 + vec2(-rbDrift(2.0, 6.0), 5.3), 6.0));
  return rbNoise(w + (warp - 0.5) * 2.2 + vec2(rbDrift(3.0, 12.0), 0.0), 12.0);
}
`,
    decl: ``,
    fill: `
    float field = inkField(lq);
    /* Posterised, with each step antialiased against the device pixel: flat
       tones are what make it read as drawn ink rather than as smoke. */
    float levels = mix(4.0, 3.0, bloodied);
    float s = clamp(field * 1.25 - 0.12, 0.0, 0.999) * levels;
    float aaI = clamp(6.0 * px, 0.06, 0.45);
    float tone = (floor(s) + smoothstep(1.0 - aaI, 1.0, fract(s))) / levels;
    vec3 deep = base * 0.16;
    vec3 midI = base * 0.60;
    vec3 lite = mix(base, vec3(1.0), 0.30) * 1.05;
    fillCol = mix(mix(deep, midI, clamp(tone * 2.0, 0.0, 1.0)), lite, clamp(tone * 2.0 - 1.0, 0.0, 1.0));
    fillCol *= 0.76 + 0.34 * depth;
    /* Bloodied: turbid. A slow cloud muddies the tones and pulls them dark, so
       the same liquid now reads as something has got into it. */
    float cloud = rbNoise(vec2(lq.x * 0.45 + rbDrift(1.0, 8.0), lq.y * 1.3 + 3.1), 8.0);
    vec3 murk = mix(INK0, base * 0.24, 0.35 + 0.65 * cloud);
    fillCol = mix(fillCol, murk, bloodied * (0.42 + 0.38 * cloud));
    fillCol += mix(base, vec3(1.0), 0.55) * rbBand(hb - 0.80, 0.035) * mix(0.55, 0.20, bloodied);
    fillCol += base * rbBand(hb + 0.83, 0.045) * 0.30;
`,
    wave: `
  if (uWave > 0.001) {
    float wx = mix(fx0 - 0.14, fx1 + 0.14, clamp(uWaveX, 0.0, 1.0));
    float dir = uHeal > 0.5 ? 1.0 : -1.0;
    /* A billowing front, lobed by noise, pushing a plume of ink behind it. */
    float lobe = rbNoise(vec2(fy * 1.6 + 2.0, uWaveX * 5.0), 64.0) - 0.5;
    float wd = (p.x - wx) * dir + fy * fy * 0.16 + lobe * 0.16;
    float area = mix(max(mFill, mGhost), mFill, uHeal) * uWave;
    vec3 waveCol = mix(vec3(1.0, 0.22, 0.08), vec3(0.20, 0.90, 0.64), uHeal);
    float behind = max(-wd, 0.0);
    float plume = exp(-behind / 0.55) * (1.0 - step(0.0, wd));
    /* Posterised like the liquid it is pushing through: three flat steps. */
    float ps = plume * 3.0;
    float aaP = clamp(6.0 * px, 0.10, 0.5);
    float plumeStep = (floor(ps) + smoothstep(1.0 - aaP, 1.0, fract(ps))) / 3.0;
    C = mix(C, waveCol * (0.30 + 0.60 * plumeStep), plumeStep * area * 0.85);
    float crest = rbGauss(wd, 0.05);
    C += mix(waveCol, vec3(1.0), 0.35) * crest * area * 1.10;
    C += waveCol * crest * uWave * mTrough * 0.20;
  }
`,
    impact: `
  if (uHit > 0.001) {
    vec2 hp = vec2(p.x - mix(fx0, fx1, uHitX), p.y * 1.55);
    float r = length(hp);
    float grow = 1.0 - uHit;
    float radius = grow * 1.05;
    vec3 hitCol = mix(vec3(1.00, 0.42, 0.34), vec3(0.55, 1.00, 0.72), uHeal);
    /* A burst of ink: round blobs pushed out from the wound, thinning into
       rings as the envelope decays, instead of a single hairline ring. */
    float splash = rbGauss(r - radius, 0.045) * uHit * uHit * 0.9;
    for (int n = 0; n < 5; n++) {
      float fn = float(n);
      float ang = fn * 1.2566371 + uSeed;
      vec2 c = vec2(cos(ang), sin(ang) * 0.55) * radius * 0.85;
      float rr = 0.08 + 0.14 * grow;
      float disc = rbCover(length(hp - c) - rr) - rbCover(length(hp - c) - rr * grow * 0.85);
      splash += clamp(disc, 0.0, 1.0) * uHit * uHit * 1.2;
    }
    /* Droplets flung along the bar's own axis: which way the ink went. */
    float drops = 0.0;
    for (int n = 0; n < 4; n++) {
      float fn = float(n);
      float side = mod(fn, 2.0) < 0.5 ? -1.0 : 1.0;
      vec2 c = vec2(side * radius * (1.15 + fn * 0.22), (fn - 1.5) * 0.18 * grow);
      drops += rbCover(length(hp - c) - (0.05 + 0.03 * uHit));
    }
    C += hitCol * (splash + drops * uHit * uSpark * 1.3 * (1.0 - uHeal * 0.4))
       * mix(1.0, 0.45, 1.0 - hero) * mBody;
  }
`,
  },

  /* Mercury: a cylinder of liquid metal. Mirror-bright, stylised rather than
     physical — a studio environment of three hard bands reflected in a tube,
     tinted by the health colour — with a rounded bead of a front. Chrome reads
     as chrome from the hardness of its reflections, so there is no grain here at
     all. */
  mercury: {
    functions: `
/* The environment the tube reflects, as a function of the reflected height. */
vec3 mercuryEnv(float ny, float aa, vec3 base) {
  vec3 hi = mix(base, vec3(1.0), 0.72);
  vec3 lo = base * 0.10 + INK * 0.6;
  vec3 skyC = mix(hi * 1.25, base * 0.85, smoothstep(0.25, 1.0, ny) * 0.55);
  vec3 midC = base * 0.46;
  vec3 floorC = mix(base * 0.80, hi, 0.25);
  vec3 env = mix(floorC, midC, smoothstep(-0.62 - aa, -0.62 + aa, ny));
  env = mix(env, lo, smoothstep(-0.05 - aa, -0.05 + aa, ny));
  return mix(env, skyC, smoothstep(0.18 - aa, 0.18 + aa, ny));
}
`,
    decl: ``,
    fill: `
    float ripple = 0.0;
    if (uFlow > 0.5) {
      ripple = 0.07 * sin(lq.x * 1.7 - rbPhase(3.0))
             + 0.035 * sin(lq.x * 3.9 + rbPhase(5.0) + uSeed);
    }
    /* One device pixel in the fill's own height units, so the band edges stay a
       pixel wide at every zoom: hard, never aliased. */
    float aaM = clamp(px / fh * 1.5, 0.02, 0.35);
    fillCol = mercuryEnv(clamp(fy * 0.92 + ripple, -1.0, 1.0), aaM, base);
    /* The rounded front: a bright crescent a little behind the edge, and the
       edge itself turning away into shadow. */
    float toFront = frontX - p.x;
    fillCol *= 1.0 - 0.50 * (1.0 - smoothstep(0.0, 0.06, toFront));
    fillCol += mix(base, vec3(1.0), 0.75) * rbBand(toFront - 0.09, 0.022)
             * smoothstep(-0.3, 0.7, fy) * 0.85;
    /* Bloodied: tarnished, and breaking into beads. The metal dulls towards a
       grey sheen of itself, and the column necks down between rounded beads
       anchored to the front, so the front bead is always a whole one. */
    vec3 dull = mix(vec3(dot(fillCol, vec3(0.299, 0.587, 0.114))), fillCol, 0.55) * 0.62 + base * 0.08;
    fillCol = mix(fillCol, dull, bloodied * 0.75);
    float beadL = 0.78;
    float bx = mod(frontX - fh - p.x + beadL * 0.5, beadL) - beadL * 0.5;
    float neck = mix(fh * 1.2, fh * 0.30, bloodied);
    cover = rbCover(min(length(vec2(bx, p.y)) - fh, abs(p.y) - neck));
`,
    wave: `
  if (uWave > 0.001) {
    float wx = mix(fx0 - 0.14, fx1 + 0.14, clamp(uWaveX, 0.0, 1.0));
    float dir = uHeal > 0.5 ? 1.0 : -1.0;
    float wd = (p.x - wx) * dir + fy * fy * 0.10;
    float area = mix(max(mFill, mGhost), mFill, uHeal) * uWave;
    vec3 waveCol = mix(vec3(1.0, 0.22, 0.08), vec3(0.20, 0.90, 0.64), uHeal);
    float behind = max(-wd, 0.0);
    float wake = exp(-behind / 0.45) * (1.0 - step(0.0, wd));
    /* A ripple packet behind the front, drawn as hard chrome bands in the
       wave's colour. Left out once a band can no longer hold a few pixels. */
    float rip = sin(behind * 14.0) * wake;
    float aaW = clamp(14.0 * px, 0.05, 0.6);
    float bandM = smoothstep(0.35 - aaW, 0.35 + aaW, rip) * rbDetail(0.22);
    C = mix(C, waveCol * (0.25 + 0.90 * bandM), wake * area * 0.75);
    float crest = rbGauss(wd, 0.035);
    C += mix(waveCol, vec3(1.0), 0.50) * crest * area * 1.25;
    C += waveCol * crest * uWave * mTrough * 0.22;
  }
`,
    impact: `
  if (uHit > 0.001) {
    vec2 hp = vec2(p.x - mix(fx0, fx1, uHitX), p.y * 1.55);
    float r = length(hp);
    float grow = 1.0 - uHit;
    float radius = grow * 1.05;
    vec3 hitCol = mix(vec3(1.00, 0.42, 0.34), vec3(0.55, 1.00, 0.72), uHeal);
    vec3 chrome = mix(hitCol, vec3(1.0), 0.55);
    /* Ripple rings: three concentric fronts, the outermost the brightest. */
    float ring = rbBand(r - radius, 0.022) * 1.4
               + rbBand(r - radius * 0.66, 0.018) * 0.9
               + rbBand(r - radius * 0.38, 0.015) * 0.55;
    ring *= uHit * uHit;
    /* Droplets thrown along the bar that split in two as they fly. */
    float drops = 0.0;
    float apart = smoothstep(0.25, 0.75, grow);
    for (int n = 0; n < 4; n++) {
      float fn = float(n);
      float side = mod(fn, 2.0) < 0.5 ? -1.0 : 1.0;
      float fly = radius * (1.12 + fn * 0.20);
      vec2 c0 = vec2(side * fly, (fn - 1.5) * 0.10 + apart * 0.11);
      vec2 c1 = vec2(side * fly * 1.04, (fn - 1.5) * 0.10 - apart * 0.11);
      float rad = mix(0.075, 0.048, apart);
      drops += rbCover(length(hp - c0) - rad)
             + rbCover(length(hp - c1) - rad) * smoothstep(0.2, 0.4, grow);
    }
    C += chrome * (ring * 1.2 + drops * uHit * uSpark * 1.4 * (1.0 - uHeal * 0.3))
       * mix(1.0, 0.45, 1.0 - hero) * mBody;
  }
`,
  },

  /* Lava: a dark crust of rounded plates drifting over soft glowing seams in
     the health colour. It has to read as nothing like the guard-break fracture
     it will sometimes carry — that is thin gold lines and sharp shards — so the
     plates are pebbles, the seams are wide soft channels, and the light is the
     health hue. And while a guard break is on, it dims its own seams so the
     gold can be seen. */
  lava: {
    functions: `
/* Rounded crust cells: x = distance to the cell border, y = distance to the
   cell's own point, z = a per-cell hash. Periodic in x so the drift wraps. */
vec3 lavaCells(vec2 x, float period) {
  vec2 n = floor(x);
  vec2 f = fract(x);
  float f1 = 9.0;
  float f2 = 9.0;
  float id = 0.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 cellKey = vec2(mod(n.x + g.x, period), n.y + g.y);
      /* Points held off the cell edges, so the plates come out round. */
      vec2 o = vec2(rbHash(cellKey), rbHash(cellKey + 17.3)) * 0.8 + 0.1;
      vec2 r = g + o - f;
      float d = dot(r, r);
      if (d < f1) { f2 = f1; f1 = d; id = rbHash(cellKey + 5.1); }
      else if (d < f2) { f2 = d; }
    }
  }
  return vec3(sqrt(f2) - sqrt(f1), sqrt(f1), id);
}
`,
    decl: `
  float lavaSeam = 0.0;
`,
    fill: `
    /* Big plates — about a bar height across, so one or two span the fill —
       because at token size a crust of small plates is a field of bright
       squiggles, and squiggles read as writing rather than as rock. */
    vec3 cellL = lavaCells(vec2(lq.x * 1.55 + rbDrift(1.0, 16.0), lq.y * 1.75 + 0.5), 16.0);
    /* Bloodied: the crust thickens — narrower channels, fuller plates. */
    float seamW = mix(0.10, 0.04, bloodied);
    float softL = clamp(px * 3.0, 0.04, 0.20);
    /* The plate is the cell's interior intersected with a disc about its own
       point, so its corners are arcs rather than the shards of a fracture, and
       where three plates meet they part around a pool. */
    float plateD = min(cellL.x - seamW, (0.55 + 0.12 * cellL.z + bloodied * 0.15) - cellL.y);
    float plate = smoothstep(0.0, softL, plateD);
    lavaSeam = 1.0 - plate;
    float pulse = 1.0;
    if (uFlow > 0.5) pulse = 0.78 + 0.22 * sin(lq.x * 2.2 - rbPhase(6.0) + cellL.z * 6.2831853);
    /* …and its glow sputters, seam by seam. */
    float sputter = mix(1.0, 0.30 + 0.70 * smoothstep(-0.25, 0.25, sin(rbPhase(71.0) + cellL.z * 40.0) + 0.35), bloodied);
    float glowAmt = pulse * sputter * (1.0 - LAVA_BREAK_DIM * uBreak);
    /* Heat is depth into the channel: a narrow crack glows dimly in the health
       hue and only the pools run bright. A crack that is bright along its whole
       length is a line, and a bar full of bright lines reads as writing — or as
       the guard-break fracture this liquid has to stay distinct from. */
    float heat = smoothstep(0.0, 0.22, -plateD);
    vec3 crust = mix(INK0, base * 0.13, 0.40 + 0.30 * depth) * (0.80 + 0.35 * cellL.z);
    vec3 ember = base * (0.40 + 0.60 * glowAmt);
    vec3 pool = mix(base, vec3(1.0, 0.95, 0.85), 0.20) * (0.75 + 0.75 * glowAmt);
    fillCol = crust + base * exp(-max(plateD, 0.0) / 0.07) * 0.22 * glowAmt * plate;
    fillCol = mix(fillCol, mix(ember, pool, heat), lavaSeam * (0.30 + 0.70 * glowAmt));
    fillCol += vec3(0.9) * rbBand(hb - 0.76, 0.05) * 0.06 * plate;
`,
    wave: `
  if (uWave > 0.001) {
    float wx = mix(fx0 - 0.14, fx1 + 0.14, clamp(uWaveX, 0.0, 1.0));
    float dir = uHeal > 0.5 ? 1.0 : -1.0;
    float wd = (p.x - wx) * dir + fy * fy * 0.12;
    float area = mix(max(mFill, mGhost), mFill, uHeal) * uWave;
    vec3 waveCol = mix(vec3(1.0, 0.22, 0.08), vec3(0.20, 0.90, 0.64), uHeal);
    float behind = max(-wd, 0.0);
    float flare = exp(-behind / 0.50) * (1.0 - step(0.0, wd));
    /* The crust catches behind the front: its seams flare in the wave's colour
       while the plates stay dark, so the flare has the crust's own shape. */
    vec3 flareCol = mix(waveCol, vec3(1.0, 0.90, 0.70), 0.25);
    C = mix(C, mix(waveCol * 0.25, flareCol * 1.6, lavaSeam), flare * area * 0.85);
    float crest = rbGauss(wd, 0.05);
    C += flareCol * crest * area * 1.30;
    C += waveCol * crest * uWave * mTrough * 0.22;
  }
`,
    impact: `
  if (uHit > 0.001) {
    vec2 hp = vec2(p.x - mix(fx0, fx1, uHitX), p.y * 1.55);
    float r = length(hp);
    float grow = 1.0 - uHit;
    float radius = grow * 1.05;
    vec3 hitCol = mix(vec3(1.00, 0.42, 0.34), vec3(0.55, 1.00, 0.72), uHeal);
    /* A flare at the wound, and one soft ring leaving it. */
    float flareHit = exp(-r / (0.10 + 0.35 * grow)) * uHit * uHit * 1.4;
    float ring = rbGauss(r - radius, 0.05) * uHit * uHit * 0.9;
    /* Embers spattered on ballistic arcs — up, then down — cooling as they go. */
    float embers = 0.0;
    for (int n = 0; n < 6; n++) {
      float fn = float(n);
      float side = mod(fn, 2.0) < 0.5 ? -1.0 : 1.0;
      float h1 = fract(sin(fn * 12.9898 + uSeed) * 43758.5453);
      float vx = side * (0.8 + 0.9 * h1);
      float vy = 0.55 + 0.5 * fract(h1 * 7.13);
      vec2 c = vec2(vx * grow * 1.1, vy * grow - 1.3 * grow * grow);
      embers += rbCover(length(hp - c) - (0.05 * uHit + 0.012));
    }
    vec3 emberCol = mix(hitCol, vec3(1.0, 0.92, 0.60), uHit);
    C += (hitCol * (flareHit + ring) + emberCol * embers * uHit * uSpark * 1.6)
       * mix(1.0, 0.45, 1.0 - hero) * mBody;
  }
`,
  },
};

const MAIN = `
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

  /* Nothing animates the frame or the fill's height. An earlier pass compressed
     the fill plate on impact and it read as jelly — a bar whose height breathes
     is a bar you stop reading as a measurement. The liquid moves *inside* a
     rigid instrument, and only its front bends. */
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

  /* ── The front ─────────────────────────────────────────────────────────
     A rounded meniscus, a very small idle wobble and the slosh after a change,
     all zero-mean across the fill's height (rbFront), so the front bends around
     the value without moving it. It flattens against either end of the tube: a
     full bar is full to the lip, and an empty one shows no sliver of meniscus.
     The rails keep a straight edge. */
  float fh = max(bb.y - sw - air - lip, 0.0001);
  float fy = clamp(p.y / fh, -1.0, 1.0);
  float endFade = smoothstep(0.0, 0.35, fillX - fx0) * smoothstep(0.0, 0.35, fx1 - fillX);
  float frontX = fillX + rbFront(fy, uWobble, uSlosh) * hero * endFade;
  float ghostFade = smoothstep(0.0, 0.35, ghostX - fx0) * smoothstep(0.0, 0.35, fx1 - ghostX);
  float ghostFrontX = max(ghostX + rbFront(fy, uWobble, 0.0) * hero * ghostFade, frontX);

  /* ── Palette ───────────────────────────────────────────────────────────
     GOLD is PALETTE.signalPale. It is the only warm note and it appears in
     exactly one place — the top of the stroke — which is what keeps it reading
     as a material catching light rather than as a colour scheme.

     "Bloodied" (under half) is a state of the *liquid* — each one shows it in
     its own idiom below — and a partial pull towards the danger end of the
     ramp, never a hard swap: a colour that jumps at 50% says more than the
     number does. */
  float bloodied = hero * (1.0 - smoothstep(0.485, 0.50, uFrac));
  float rampT = clamp(uFrac / 0.72, 0.0, 1.0);
  vec3 base = uRole < 0.5 ? rampAt(rampT) : (uRole < 1.5 ? uRailCol : uShieldCol);
  base = mix(base, rampAt(0.06), bloodied * 0.40);
  float grey = dot(base, vec3(0.299, 0.587, 0.114));
  base = mix(base, vec3(grey), mix(0.24, 0.06, hero));
  base = mix(base, uTempCol, 0.16 * smoothstep(0.6, 1.0, uFrac) * hero);
  /* …and the bottom of the range goes further, into a hot arterial red that no
     ramp stop reaches. This is the one place the fill is allowed to editorialise,
     because "you are about to die" is not a shade of the same information. */
  base = mix(base, vec3(1.000, 0.106, 0.153), uLow * 0.55 * hero);

  /* ── The trough ────────────────────────────────────────────────────────*/
  /* Flat and dark, with one shadow under the top edge. A well is not supposed
     to be the interesting part. */
  vec3 troughCol = mix(INK0, INK, 0.24 + 0.62 * smoothstep(1.0, -0.85, hb));
  troughCol *= 1.0 - 0.38 * rbBand(hb - 0.92, 0.14);

  float breathe = 0.5 + 0.5 * sin(rbPhase(4.0));
  float depth = smoothstep(-0.95, 0.65, hb);

  /* ── The liquid ────────────────────────────────────────────────────────
     lq is fill-local: x from the empty end of the tube, y the bar's own, both
     in bar heights. cover is the liquid's own coverage, which only mercury's
     beads ever take below 1. */
  vec2 lq = vec2(p.x - fx0, p.y);
  vec3 fillCol = vec3(0.0);
  float cover = 1.0;
/*__DECL__*/
  if (hero > 0.5) {
/*__FILL__*/
  } else {
    /* Rails: a flat plate with a lit top edge. Not health, so not liquid. */
    fillCol = base * (0.20 + 0.34 * depth);
    fillCol += base * rbGauss(hb + 0.70, 0.22) * 0.42;
    fillCol += mix(base, vec3(1.0), 0.68) * rbBand(hb - 0.81, 0.035) * 0.65;
    fillCol += base * rbBand(hb + 0.83, 0.045) * 0.38;
  }
  // The lower rim carries the warning, leaving the centre quiet for the value.
  fillCol += base * uLow * hero * (0.12 + 0.34 * breathe);

  /* ── Segments ──────────────────────────────────────────────────────────
     Real gaps between discrete plates, not grooves cut into one continuous
     bar. A groove says "one quantity, subdivided for counting"; a gap says
     "assembled from parts", which is what every game HUD in this idiom says. */
  float segMask = 1.0;
  if (uSeg > 0.5) {
    float segW = span / uSeg;
    float sx = fract(clamp((p.x - fx0) / span, 0.0, 1.0) * uSeg) * segW;
    /* Sized in the *world*, so it scales with the canvas. uSegW arrives in bar
       heights: the host divides the setting ("pixels at 100% zoom") by the
       bar's own world height.

       Floored at a pixel and a half rather than faded out, which is what keeps
       the reason it was ever pinned to device pixels: a fixed geometry width is
       ~2px on a retina display and sub-pixel on an ordinary one, where it would
       vanish — and the divisions are the colour-blind position channel. The
       segW cap keeps a bar with many divisions from becoming more gap than
       plate. */
    float gapP = min(max(uSegW, px * 1.5), segW * 0.42);
    segMask = 1.0 - (1.0 - smoothstep(max(0.0, gapP - px), gapP, sx)) * hero;
  }

  /* The same divisions, whispered across the empty trough: without them the
     spent half of the bar has no scale on it. */
  float troughDiv = (1.0 - segMask) * mFillA * (1.0 - rbEdge(frontX + px, frontX - px, p.x));

  float mFillEdge = mFillA * rbEdge(frontX + px, frontX - px, p.x) * segMask;
  float mFill  = mFillEdge * cover;
  float chipOn = smoothstep(0.0, 0.004, uGhost - uFrac);
  float mGhost = mFillA * rbEdge(ghostFrontX + px, ghostFrontX - px, p.x) * segMask
               * (1.0 - mFillEdge) * chipOn;

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

  /* One family of diagonal ribs, not two crossed ones: parallel ribs read as
     plating, and plating is what temporary hit points are. Drawn as bright
     lines rather than as filled cells, so the shield adds light to the fill
     underneath instead of masking it. */
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
  float shimmer = 0.5 + 0.5 * sin(p.x * 5.5 - rbPhase(8.0));

  /* ── The leading edge ──────────────────────────────────────────────────*/
  float headIn = rbGauss(p.x - frontX, 0.055 + 0.11 * uBloom) * mFillA;
  vec3 headCol = mix(base, vec3(1.0), 0.60 + 0.35 * uBloom);

  /* ── Stroke ────────────────────────────────────────────────────────────
     The asymmetry that stops the bar reading as a form control comes from the
     cut corner, which does the job with none of the width end furniture cost. */
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
  /* They are divisions too, so they leave with the divisions. */
  tickMark *= rbDetail(0.048) * hero * 0.20 * step(0.5, uSeg);

  /* ── Compose ───────────────────────────────────────────────────────────*/
  vec3 C = vec3(0.0);
  float A = 0.0;

  C = mix(C, troughCol, mTrough); A = mix(A, 1.0, mTrough);

  C = mix(C, ghostCol, mGhost);
  C = mix(C, fillCol, mFill);

  /* ── The change wave ───────────────────────────────────────────────────
     Crosses the whole bar in the direction the value moved, in the liquid's own
     idiom. Its colour *replaces* the material behind the front; only the crest
     goes on top as light; nothing is drawn ahead of it. */
/*__WAVE__*/
  /* The shield plate: a translucent pane over the fill, then its lattice, its
     top rim, and a hot leading edge where it ends. */
  vec3 shieldPane = uTempCol * (0.65 + 0.35 * shimmer);
  C = mix(C, shieldPane, mTempArea * 0.58);
  C += uTempCol * lattice * mTempArea * (0.50 + 0.25 * shimmer);
  C += uTempCol * rbBand(hb - 0.70, 0.07) * mTempArea * 1.20;
  C += uTempCol * rbBand(hb - 0.20, 0.045) * mTempArea * 0.85;
  /* Leading edge, pushed above 1.0 so the bloom pass finds it. */
  C += uTempCol * rbGauss(p.x - tempX, 0.045) * mTempArea * 1.65;
  C += headCol * headIn * (0.55 + 1.1 * uBloom) * cover;

  C = mix(C, strokeCol, mStroke); A = mix(A, 1.0, mStroke);
  C += STEEL * tickMark * 0.85; A = max(A, min(tickMark * 0.9, 1.0));

  /* Shield break: fractures wide enough to survive the 12px rail that is the
     only size this is ever drawn at, plus a drop in value and saturation. */
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
     card, from the same field in core/fx-glsl.mjs, on the same clock.

     **It cuts before it lights**: the seam darkens the material it crosses and
     the light goes *in* the seam. **It does not touch the reading**: no
     desaturation, no dimming of the fill. (The lava liquid dims its own seam
     glow while this is on, which is a statement about the lava's light, not
     about the hit points.)

     uBreak arrives 0 on the rails, so this branch — the most expensive thing in
     the shader — is skipped on every bar that is not a broken creature's own. */
  if (uBreak > 0.001) {
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
     The envelope decays 1 → 0, so the reaction grows as its amplitude falls,
     centred on where the value was when it changed. Written above 1.0 on
     purpose: the bright-pass downstream keeps only what exceeds it. */
/*__IMPACT__*/
  /* The flare sits at the wound, and *only* at the wound: a full-quad whiteout
     held through the hitstop buries the readout and the trail exactly when they
     are the two things worth looking at. */
  C += vec3(1.0, 0.92, 0.86) * uFlash * 1.25 * rbGauss(p.x - frontX, 0.060) * mFillA;

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
     than a translucent shape drawn beside it. */
  float outside = max(dBody, 0.0);

  /* Every falloff below is exp(-outside/k), which is 1.0 everywhere *inside*
     the body — so without this gate the bloom floods the bar rather than
     spilling past it. */
  float outMask = smoothstep(0.0, max(px * 1.6, 0.012), dBody);

  /* A floor only. The separable-blur pass downstream is the real bloom; what
     stays here is the contact light immediately against the body. */
  vec3 glowCol = mix(base, vec3(1.00, 0.16, 0.20), uLow * 0.85);
  float glow = exp(-outside / 0.055) * rbEdge(fillX + 0.14, fillX - 0.04, p.x) * 0.22;
  glow += exp(-outside / 0.045) * exp(-abs(p.x - fillX) / 0.14) * (0.30 + 0.9 * uBloom);
  glow += exp(-outside / 0.050) * uLow * (0.30 + 0.70 * breathe) * 0.55 * hero;
  glow *= outMask * mix(0.45, 1.0, hero);
  outC += glowCol * glow * 0.75;
  outA += glow * 0.26;

  /* ── Materialise ───────────────────────────────────────────────────────
     A bar becoming visible is wiped in from the left behind a line of light;
     one a hover lets go of fades. Both are applied last, to the finished pixel
     and its bloom floor, so nothing the bar draws can arrive ahead of the front
     or linger after the fade. At rest both are 1 and this branch is skipped. */
  if (uReveal < 0.999 || uFade < 0.999) {
    float frontM = mix(-b.x - 0.35, b.x + 0.35, clamp(uReveal, 0.0, 1.0));
    float shownMask = rbEdge(frontM + 0.10, frontM - 0.10, p.x);
    float front = rbGauss(p.x - frontM, 0.05) * mBody
                * step(0.001, uReveal) * (1.0 - smoothstep(0.80, 1.0, uReveal));
    outC = outC * shownMask + mix(base, vec3(1.0), 0.55) * front * 1.2;
    outA = outA * shownMask + front * 0.8;
    outC *= uFade;
    outA *= uFade;
  }

  gl_FragColor = vec4(outC, clamp(outA, 0.0, 1.0));
}
`;

const built = new Map();

/**
 * The fragment shader for one liquid. Unknown names fall back to the default
 * rather than throwing: a world setting edited by hand must degrade to ink, not
 * to a canvas with no bars.
 */
export function fragmentShader(liquid = DEFAULT_LIQUID) {
  const key = LIQUIDS.includes(liquid) ? liquid : DEFAULT_LIQUID;
  if (built.has(key)) return built.get(key);
  const chunk = LIQUID_CHUNKS[key];
  const src = HEAD + chunk.functions + MAIN
    .replace("/*__DECL__*/", chunk.decl)
    .replace("/*__FILL__*/", chunk.fill)
    .replace("/*__WAVE__*/", chunk.wave)
    .replace("/*__IMPACT__*/", chunk.impact);
  built.set(key, src);
  return src;
}

/** Every variant, keyed by liquid — what the check tool and the preview compile. */
export const FRAGMENT_SHADERS = Object.freeze(Object.fromEntries(LIQUIDS.map((l) => [l, fragmentShader(l)])));

/** The default liquid's program, under the name the feature has always used. */
export const FRAGMENT_SHADER = FRAGMENT_SHADERS[DEFAULT_LIQUID];
