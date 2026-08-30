/**
 * GLUniverse Suite — token conditions: the fragment shader.
 *
 * One quad per plate. The material is the resource bar's, deliberately and
 * exactly: the same layered body (stroke, air, trough, lip, face), the same
 * single hard specular under the top edge, the same chamfered corner, the same
 * emission above 1.0 for the bloom to find. A condition plate and a health bar
 * are two readings of one creature and they have to look like it — and what
 * makes two HUD elements look related is never the hex values, it is the light.
 *
 * ── What is NOT the bar's ────────────────────────────────────────────────
 *
 * Three constants had to be re-derived rather than copied, because the bar is
 * routinely 8:1 and a plate is square:
 *
 *   1. The chamfer measures against the SHORT side, at half the bar's
 *      proportion. The bar's own 0.85-of-half-height is a nick on something
 *      eight times longer than it is tall; on a square plate the same number
 *      takes a bite out of two fifths of the face, pushes the sigil off centre,
 *      and reads as a page with the corner turned down rather than as the
 *      suite's mark.
 *   2. `air` and `lip` are two thirds the bar's. The bar pays those margins on
 *      its short axis only; a plate pays them on both, and at 30px the layered
 *      construction otherwise leaves the sigil drawing inside a postage stamp.
 *   3. The icon's bevel offset is a fraction of the glyph's own stroke width,
 *      not of the atlas cell. PF2e's condition art is drawn at about a
 *      fourteenth of its cell, so an offset anywhere near that differences the
 *      glyph against empty space along its whole length: every part of it reads
 *      as a lit top edge, the white filament floods the sigil, and every
 *      condition arrives white with a coloured halo instead of in its tone.
 *
 * ── Units ────────────────────────────────────────────────────────────────
 *
 * `core/glsl.mjs`'s prelude measures against `uTexel`, one device pixel in UV
 * units, and UV is relative to the quad's *width*. An expanded plate is 4.6:1,
 * so this works in `p` — an isotropic space where one unit is the plate's
 * height, x scaled by `uAspect` — and restates the prelude's own thresholds
 * there via `px`. As in the prelude, `uTexel = 0` leaves every clamp inert: a
 * missing uniform degrades to the unfiltered look, never to a blank quad.
 */

import { PRECISION, SCALE_PRELUDE, VERTEX_SHADER } from "../../core/glsl.mjs";

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
 * The chamfer, as a multiple of the plate's SHORT half-side, and how far the
 * body is inset from its quad.
 *
 * INSET is the bloom margin and nothing else. Light that stops dead at the quad
 * edge is the single clearest tell that something was drawn rather than lit, and
 * these plates emit above 1.0 in four places.
 */
export const CUT = 0.45;
export const INSET = 0.115;

/** Forms, matching `uForm`. */
export const FORM = Object.freeze({ plate: 0, tail: 1 });

/**
 * Every uniform this shader declares, with its GLSL type.
 * `tools/token-conditions-check.mjs` cross-checks this list against both the
 * GLSL source and the JS that supplies them: a uniform declared and never set is
 * a silent no-op, and one set and never declared is a silent typo.
 */
export const UNIFORMS = Object.freeze({
  uTime: "float",     // seconds — the breath
  uTexel: "float",    // one device pixel in UV units (prelude contract; 0 = inert)
  uAspect: "float",   // quad width / height

  uForm: "float",     // 0 plate, 1 tail (the +N stand-in)
  uEnter: "float",    // 0..1 — the print. 0 = nothing drawn, 1 = fully seated
  uFlash: "float",    // 0..1 — the white-hot frame on arrival and on removal
  uPulse: "float",    // 0..1 — the breath, on the resource bar's own clock
  uSel: "float",      // 0..1 — expanded, showing its name
  uSeed: "float",     // per-plate, so two never shimmer in lockstep

  uLife: "float",     // 0..1 of the duration remaining
  uLifeOn: "float",   // 1 when there IS a duration; 0 draws a constant hairline
  uSustain: "float",  // 1 when the effect is sustained — the gauge turns gold
  uRedact: "float",   // 1 when this client may not know what the effect is
  uArt: "float",      // 0 silhouette, 1 full-colour artwork
  uBadge: "float",    // 1 draws the corner tab the counter sits on

  uTone: "vec3",      // the tone's body colour, sRGB
  uToneHot: "vec3",   // its hot variant — what is allowed above 1.0

  uIconUv: "vec4",    // atlas cell: u0, v0, u1, v1
  uIconBox: "vec4",   // where the icon sits in p space: cx, cy, halfW, halfH
  uIcon: "sampler2D", // the icon texture
});

export const FRAGMENT_SHADER = PRECISION + SCALE_PRELUDE + `
const float CUT = ` + CUT.toFixed(4) + `;
const float INSET = ` + INSET.toFixed(4) + `;

varying vec2 vTextureCoord;

uniform float uTime;
uniform float uAspect;
uniform float uForm;
uniform float uEnter;
uniform float uFlash;
uniform float uPulse;
uniform float uSel;
uniform float uSeed;
uniform float uLife;
uniform float uLifeOn;
uniform float uSustain;
uniform float uRedact;
uniform float uArt;
uniform float uBadge;
uniform vec3  uTone;
uniform vec3  uToneHot;
uniform vec4  uIconUv;
uniform vec4  uIconBox;
uniform sampler2D uIcon;

/* One device pixel in p units. GLSL ES 1.0 has no closures, so this is a global
   by necessity — the same arrangement the bar's shader uses. */
float px;

/* ── The prelude's policy, restated in p ──────────────────────────────────
   Same thresholds (GL_BAND / GL_EDGE / GL_FADE_*, all imported, not re-guessed),
   same brightness-preserving widening: a band that has to grow to stay a pixel
   wide is dimmed by exactly the factor it grew, so its integrated light is
   unchanged rather than aliased into buzzing. */
float cBand(float d, float halfW) {
  float w = max(halfW, px * GL_BAND);
  return exp(-abs(d) / w) * (halfW / w);
}

float cGauss(float d, float halfW) {
  float w = max(halfW, px * GL_BAND);
  float x = d / w;
  return exp(-x * x) * (halfW / w);
}

float cEdge(float e0, float e1, float x) {
  float m = (e0 + e1) * 0.5;
  float h = max(abs(e1 - e0), px * GL_EDGE) * 0.5;
  float s = e1 < e0 ? -1.0 : 1.0;
  return smoothstep(m - h * s, m + h * s, x);
}

/* Detail that cannot be filtered, only left out. A hatch on a 16px plate is not
   a finer hatch; it is grain over the one thing the plate is for. */
float cDetail(float w) { return smoothstep(GL_FADE_LO, GL_FADE_HI, w / px); }

float cCover(float d) { return 1.0 - smoothstep(-px * 0.5, px * 0.5, d); }

float sdBox(vec2 q, vec2 b) {
  vec2 d = abs(q) - b;
  return min(max(d.x, d.y), 0.0) + length(max(d, 0.0));
}

/* The suite mark: a box with the top-right corner taken off — the same corner
   gl-tokens.css cuts out of every panel and the resource bar cuts out of the
   bar. Note q and not abs(q): mirroring would cut all four corners and turn a
   plate with a front and a back into a lozenge. */
float sdCut(vec2 q, vec2 b, float c) {
  float k = (b.x + b.y - c) * 0.7071068;
  return max(sdBox(q, b), dot(q, vec2(0.7071068)) - k);
}

/* The same, cut top-LEFT — the counter's tab, so its chamfer opposes the
   plate's and the two corners read as a pair rather than as a repeat. */
float sdCutTL(vec2 q, vec2 b, float c) {
  float k = (b.x + b.y - c) * 0.7071068;
  return max(sdBox(q, b), dot(q, vec2(-0.7071068, 0.7071068)) - k);
}

/* Etched Glass ink, mirrored from PALETTE.ink1 / ink0 in core/theme.mjs. */
const vec3 INK  = vec3(0.043, 0.059, 0.090);
const vec3 INK0 = vec3(0.008, 0.027, 0.043);
const vec3 GOLD  = vec3(1.000, 0.914, 0.722);   /* PALETTE.signalPale */
const vec3 STEEL = vec3(0.38, 0.44, 0.58);

/**
 * The sigil's shape at a point, whatever kind of image it came from.
 *
 * PF2e's condition art is a white silhouette on transparency, where alpha IS the
 * shape. A spell's or an item's art is a full-colour illustration, often on an
 * opaque ground, where alpha is 1 everywhere and using it would light the whole
 * icon box as a solid tone-coloured square. Reducing artwork to its luminance
 * first costs one dot product and makes fifty different item icons read as one
 * set of sigils rather than as a sticker album.
 */
float glyphAt(vec2 uv) {
  vec4 t = texture2D(uIcon, uv);
  float lum = dot(t.rgb, vec3(0.299, 0.587, 0.114));
  return t.a * mix(1.0, smoothstep(0.10, 0.72, lum), uArt);
}

void main(void) {
  vec2 uv = vTextureCoord;
  vec2 p  = (vec2(uv.x, 1.0 - uv.y) - 0.5) * vec2(uAspect, 1.0);
  vec2 b  = vec2(uAspect, 1.0) * 0.5;
  px = max(uTexel * uAspect, 0.000001);

  float tail = step(0.5, uForm);

  vec2 bb = vec2(b.x - INSET, b.y - INSET);
  float dBody = sdCut(p, bb, min(bb.x, bb.y) * CUT);

  /* Three separated layers, not one welded frame: stroke, air, trough, lip,
     face. The gaps are the point — a stroke that touches its face is a border,
     and a border is a form control. */
  float sw  = max(0.026, px * 1.05);
  float air = 0.030;
  float lip = 0.017;

  float dTrough = dBody + sw + air;
  float dFace   = dTrough + lip;

  float mBody   = cCover(dBody);
  float mStroke = clamp(mBody - cCover(dBody + sw), 0.0, 1.0);
  float mTrough = cCover(dTrough);
  float mFace   = cCover(dFace);

  /* Height coordinate, -1 at the bottom of the body to +1 at the top. Every
     vertical gradient below is written against it, so a 16px plate and a 46px
     one are lit identically rather than at different rates. */
  float hb = clamp(p.y / max(bb.y, 0.0001), -1.0, 1.0);

  /* ── The print ───────────────────────────────────────────────────────────
     Arrival is a wipe with a hot front, not a fade and not a scale. A plate that
     scales in is a plate that was somewhere else a moment ago, which is the
     wrong story: a condition does not fly in, it is *applied*. Scaling is also
     the one thing the resource bar refuses to do, and two neighbouring
     instruments that disagree about whether geometry may move read as two
     different HUDs.

     Reversed, the same channel is the removal — run uEnter back down and the
     plate un-prints from the far end. One channel, two events, and no second
     code path to keep in agreement with the first. */
  float wx = mix(-bb.x - 0.09, bb.x + 0.09, clamp(uEnter, 0.0, 1.0));
  float seated = cEdge(wx + px, wx - px, p.x);
  float printing = 1.0 - smoothstep(0.985, 1.0, uEnter);

  mBody *= seated; mStroke *= seated; mTrough *= seated; mFace *= seated;

  /* ── The trough ──────────────────────────────────────────────────────── */
  vec3 troughCol = mix(INK0, INK, 0.22 + 0.58 * smoothstep(1.0, -0.85, hb));
  troughCol *= 1.0 - 0.34 * cBand(hb - 0.92, 0.13);

  /* ── The face ────────────────────────────────────────────────────────────
     Near-ink with a bias toward the tone, lit by ONE hard hairline under the top
     edge rather than by a broad gradient. A soft gaussian down the middle is the
     gloss every CSS control has had since 2009; a one-pixel specular under the
     top edge is what a lit surface actually does.

     The face is deliberately NOT a tone-coloured fill. Six saturated plates
     stacked beside a token is a paint chart, and it puts the loudest colour on
     the largest area — which is backwards, because colour is the least precise
     thing a plate says. Tone is carried by the gauge and by the sigil's own
     emission, both of which are small and bright. */
  vec3 faceBase = mix(INK * 1.02, uTone * 0.13 + INK * 0.52, 0.60);
  vec3 faceCol = faceBase * (1.14 - 0.46 * smoothstep(0.55, -1.0, hb));
  faceCol += uTone * cBand(hb - 0.50, 0.34) * 0.10;
  faceCol += vec3(1.0) * cBand(hb - 0.86, 0.048) * 0.44;
  faceCol *= 1.0 - 0.32 * cBand(hb + 0.94, 0.12);

  /* ── The gauge ───────────────────────────────────────────────────────────
     The tone rail along the bottom of the face is a hairline on a condition and
     a *depleting bar* on anything with a duration. Reusing one element for both
     is what keeps a rail of six plates from growing a second row of furniture:
     the mark is in the same place, the same weight and the same colour whether
     or not it is counting down, and only its length means anything.

     Sustained effects draw theirs in gold. That is the suite's ceremony colour
     and it appears in exactly one place per feature; here it means "somebody is
     spending an action every round to keep this alive", which is the one piece
     of duration information a round timer cannot express. */
  float gx0 = -bb.x + sw + air + lip;
  float gx1 =  bb.x - sw - air - lip;
  float gxN = mix(gx0, gx1, clamp(uLife, 0.0, 1.0));
  float spent = uLifeOn * cEdge(gxN - px, gxN + px, p.x);
  float filled = 1.0 - spent;

  float faceBot = -bb.y + sw + air + lip;
  float railW = max(px * 1.2, 0.019);
  float railLine = cBand(p.y - (faceBot + railW * 1.4), railW) * mFace;

  vec3 gaugeCol = mix(mix(uTone, uToneHot, 0.30), GOLD, uSustain * 0.85);

  /* ── The sigil ───────────────────────────────────────────────────────────
     Three samples of the same shape: the glyph, and the glyph a hair above and
     below. The differences are its top and bottom edges, which is what lets a
     flat silhouette be lit as though it were cut into the plate — a dark recess,
     the tone burning inside it, one white filament along the edge facing the
     light. A tinted sprite laid on top is the cheap version and it always reads
     as a sticker. */
  vec2 cellUv = uIconUv.zw - uIconUv.xy;
  vec2 q = (p - uIconBox.xy) / max(uIconBox.zw, vec2(0.0001));
  float inIcon = step(abs(q.x), 1.0) * step(abs(q.y), 1.0) * (1.0 - tail) * (1.0 - uRedact);
  vec2 iuv = mix(uIconUv.xy, uIconUv.zw, vec2(q.x * 0.5 + 0.5, 0.5 - q.y * 0.5));

  float bevel = 0.015;
  float ia   = glyphAt(iuv) * inIcon;
  float iaUp = glyphAt(iuv - vec2(0.0, cellUv.y * bevel)) * inIcon;
  float iaDn = glyphAt(iuv + vec2(0.0, cellUv.y * bevel)) * inIcon;
  float iTop = clamp(ia - iaUp, 0.0, 1.0);
  float iBot = clamp(ia - iaDn, 0.0, 1.0);

  faceCol = mix(faceCol, INK0 * 0.60, ia * 0.45);
  faceCol += uTone * ia * 1.42;
  faceCol += uToneHot * ia * 0.30;
  faceCol = mix(faceCol, INK0 * 0.35, iBot * 0.80);
  faceCol += vec3(1.0, 0.98, 0.95) * iTop * 0.72;

  /* ── Redaction ───────────────────────────────────────────────────────────
     An unidentified effect is one the GM deliberately hid. The plate still
     appears — a creature visibly has *something* on it, which is what PF2e's own
     sheet tells a player — but it carries no artwork, no name and no counter,
     and it says so with a hatch rather than by being blank. A blank plate reads
     as a bug; a hatched one reads as withheld.

     One family of diagonal ribs at a pitch generous enough to survive: at 16px
     anything finer is grain, and the hatch's whole job is to be recognised
     rather than resolved. */
  float hatchPitch = 0.26;
  float k = (p.x + p.y * 1.35) / hatchPitch;
  float dRib = abs(fract(k) - 0.5) * hatchPitch / 1.675;
  float hatch = cBand(dRib, max(px * 1.1, 0.017)) * cDetail(hatchPitch * 0.5) * mFace * uRedact;
  faceCol += STEEL * hatch * 0.60;

  /* ── The stroke ──────────────────────────────────────────────────────────
     Steel, and the light runs from the top down and then stops. The resource bar
     spreads this over smoothstep(-0.75, 0.92) because its stroke is one hairline
     around a body thirty pixels tall — the gradient is spent long before it
     reaches anything. A plate is thirty pixels on its longest side, so the same
     numbers put a broad pale band across its whole upper half and it stops
     reading as etched glass and starts reading as a glossy button.

     No gold here. The bar spends the suite's warmest note on one hairline at the
     top of its own stroke; spending it again on every plate would put it on the
     smallest and most numerous elements in the composition. The only gold in
     this feature is a sustained effect's gauge. */
  vec3 strokeCol = mix(vec3(0.055, 0.068, 0.098), STEEL, smoothstep(0.58, 0.99, hb));
  strokeCol = mix(strokeCol, mix(strokeCol, uToneHot, 0.55), uSel * 0.85);

  /* ── The counter's tab ───────────────────────────────────────────────────
     Sized for the digit rather than for the plate: a counter that cannot be read
     is a counter that has to be hovered, which is the one thing a badge exists
     to avoid. The numerals themselves are drawn by the host from the same glyph
     atlas the resource bar's readout uses — one set of numerals across the whole
     HUD, rather than a second that is nearly but not exactly the same weight. */
  float mTab = 0.0;
  if (uBadge > 0.5 && tail < 0.5) {
    vec2 nb = vec2(min(0.24, bb.x * 0.38), 0.235);
    vec2 nc = vec2(bb.x - nb.x, -bb.y + nb.y);
    mTab = cCover(sdCutTL(p - nc, nb, nb.y * 0.75)) * seated;
  }

  /* ── The breath ──────────────────────────────────────────────────────────
     uTime * 1.35 is the resource bar's low-health clock, used here unchanged.
     Two red pulses at different rates read as two unrelated warnings; on one
     rate, a dying creature's bar and its DYING plate are visibly one alarm, and
     an effect two seconds from falling off breathes with them. */
  float breathe = 0.5 + 0.5 * sin(uTime * 1.35 + uSeed * 0.7);

  /* ── Compose ─────────────────────────────────────────────────────────── */
  vec3 C = vec3(0.0);
  float A = 0.0;

  C = mix(C, troughCol, mTrough); A = mix(A, 1.0, mTrough);
  C = mix(C, faceCol, mFace);     A = mix(A, 1.0, mFace);

  /* The spent part of a gauge stays visible as a dark groove. Without it the bar
     has no scale on it and "a third left" has to be estimated against the plate
     rather than read against the track. */
  C += STEEL * railLine * spent * 0.16;
  C += gaugeCol * railLine * filled * 1.15;

  C = mix(C, strokeCol, mStroke); A = mix(A, 1.0, mStroke);

  /* The tab goes on last and opaque: a number that a face gradient shows through
     is a number you read twice to be sure of. */
  vec3 tabCol = mix(uTone, uToneHot, 0.30 + 0.22 * smoothstep(-1.0, 1.0, hb));
  C = mix(C, tabCol, mTab); A = mix(A, 1.0, mTab);

  /* The hot front of the print, and the flash behind it. Written well above 1.0
     on purpose: the bright-pass keeps only what exceeds 1.0, so anything meant
     to bloom has to be emitted as light rather than as a pale colour. */
  float front = cGauss(p.x - wx, 0.060) * printing * (mBody + mTrough * 0.5);
  C += vec3(1.00, 0.96, 0.90) * front * 2.30;
  C += vec3(1.00, 0.95, 0.88) * uFlash * 1.45 * mBody;

  /* The breath lives in the chrome and the gauge, never in the face. A plate
     whose whole surface pulses is a plate you cannot read a sigil off. */
  C = mix(C, uToneHot, mStroke * uPulse * (0.22 + 0.46 * breathe));
  C += gaugeCol * railLine * filled * uPulse * breathe * 0.9;

  /* Expanded: a specular crossing the face on the same 0.30 Hz as the bar's own
     sweep, so a hovered token reads as one gesture rather than as two widgets
     that both happened to notice the cursor. */
  float sweepX = mix(-bb.x - 0.6, bb.x + 0.6, fract(uTime * 0.30 + uSeed * 0.11));
  C += vec3(0.62, 0.74, 0.96) * cGauss(p.x - sweepX, 0.16) * mFace * uSel * 0.20;

  vec3 outC = C * A;
  float outA = A;

  /* ── Bloom ───────────────────────────────────────────────────────────────
     A contact-light floor only, added after the premultiply so it is light
     spilling past the body rather than a translucent shape drawn beside it. The
     separable blur downstream is the real bloom; an analytic halo on top of it
     reads as haze, because the two falloffs disagree and the mismatch looks like
     fog.

     The gate matters: exp(-outside / k) is 1.0 everywhere *inside* the body, so
     without it the glow does not spill past the plate, it floods it — and the
     etched sigil it is meant to be lighting from behind washes out. */
  float outside = max(dBody, 0.0);
  float outMask = smoothstep(0.0, max(px * 1.6, 0.012), dBody);
  float glow = exp(-outside / 0.048) * (0.26 + 0.85 * uFlash + 1.10 * front);
  glow += exp(-outside / 0.052) * uPulse * (0.28 + 0.72 * breathe) * 0.55;
  glow += exp(-outside / 0.040) * uSel * 0.35;
  glow *= outMask * seated;

  outC += mix(uTone, uToneHot, 0.45) * glow * 0.72;
  outA += glow * 0.24;

  gl_FragColor = vec4(outC, clamp(outA, 0.0, 1.0));
}
`;
