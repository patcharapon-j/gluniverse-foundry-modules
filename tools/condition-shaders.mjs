/**
 * Token conditions — the candidate fragment shader, and the data behind it.
 *
 * This is a *proposal*, not a shipped feature: it lives under `tools/` until a
 * direction is chosen, at which point the winner moves to
 * `scripts/features/token-conditions/`. It is a real module rather than a
 * string inside the preview template so the preview compiles the same source a
 * check tool would.
 *
 * ── Why one shader with a form switch ────────────────────────────────────
 *
 * A chip on a rail, a bead on a ring, a row in a ledger and a cell in a strip
 * are four layouts of one *material*: the same layered body, the same single
 * hard specular, the same etched icon, the same tone rail. Splitting them into
 * four programs would mean four copies of that material, and four places for it
 * to drift out of agreement — which is exactly how a set of related widgets
 * ends up looking like a set of unrelated ones. `uForm` is the same device
 * `uRole` is in the resource bar's shader, for the same reason.
 *
 * ── Units ────────────────────────────────────────────────────────────────
 *
 * Identical to the resource bar's: `core/glsl.mjs`'s prelude measures against
 * `uTexel`, one device pixel in UV units, and UV is relative to the quad's
 * *width*. A ledger row is 6:1, so this works in `p` — an isotropic space where
 * one unit is the plate's height — and restates the prelude's thresholds there
 * via `px`. `uTexel = 0` leaves every clamp inert.
 */

import { SCALE_PRELUDE } from "../scripts/core/glsl.mjs";
import { PALETTE } from "../scripts/core/theme.mjs";

/** Standalone vertex shader for the preview harness (no PIXI matrices). */
export const PREVIEW_VERTEX_SHADER = `
attribute vec2 aVertexPosition;
attribute vec2 aUvs;
varying vec2 vTextureCoord;
void main(void) {
  vTextureCoord = aUvs;
  gl_Position = vec4(aVertexPosition, 0.0, 1.0);
}`;

export const PRECISION = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
`;

/**
 * The chamfer, as a multiple of the plate's half-height, and how far the body
 * is inset from its quad.
 *
 * CUT is the suite mark — the same corner `gl-tokens.css` takes out of every
 * panel and the resource bar's shader takes out of the bar. It is what makes a
 * condition chip read as a sibling of the bar rather than as a button.
 *
 * INSET is the bloom margin and nothing else. Light that stops dead at the quad
 * edge is the single clearest tell that something was drawn rather than lit,
 * and these plates emit above 1.0 in three places.
 */
/**
 * The resource bar cuts its corner at 0.85 of its half-height, and on an 8:1
 * bar that is a nick: the diagonal is a fraction of the length it sits at the
 * end of. A condition plate is square, or nearly, and the identical number
 * takes a bite out of two fifths of it — the icon is pushed off centre, the
 * value tab has nowhere to sit, and the whole thing stops reading as a
 * chamfered plate and starts reading as a page with the corner turned down.
 *
 * So the plate's chamfer is measured against its SHORT side and cut to half the
 * bar's proportion. What it has to preserve is the *mark* — a 45° corner at the
 * top right — not the number that produces it on a completely different aspect.
 */
export const CUT = 0.45;
export const INSET = 0.115;

/** Forms, matching `uForm`. */
export const FORM = Object.freeze({ plate: 0, bead: 1, frame: 2, ring: 3, row: 4 });

/** Which edge carries the tone rail, matching `uEdge`. */
export const EDGE = Object.freeze({ bottom: 0, left: 1 });

/**
 * Every uniform the shader declares. The harness looks up exactly this list and
 * fails on any that the linker dropped — a uniform declared and never read is a
 * silent no-op, and `gl.uniform1f(null, x)` throws nothing.
 */
export const UNIFORMS = Object.freeze({
  uTime: "float",     // seconds — the breath, the ring's specular
  uTexel: "float",    // one device pixel in UV units (prelude contract; 0 = inert)
  uAspect: "float",   // quad width / height

  uForm: "float",     // 0 plate, 1 bead, 2 frame, 3 ring, 4 row
  uEdgeSide: "float", // 0 tone rail along the bottom, 1 down the left
  uEnter: "float",    // 0..1 — the print. 0 = nothing drawn, 1 = fully seated
  uFlash: "float",    // 0..1 — the white-hot frame on arrival and on removal
  uPulse: "float",    // 0..1 — the peril breath, on the bar's own clock
  uBadge: "float",    // 0 = no value, 1 = draw the corner tab
  uSel: "float",      // 0..1 — hovered / expanded
  uGold: "float",     // 0..1 — how much gold the top of the stroke catches
  uSpin: "float",     // ring only: where the travelling specular is, 0..1
  uSeed: "float",     // per-instance, so two plates never shimmer in lockstep

  uTone: "vec3",      // the tone's body colour, sRGB
  uToneHot: "vec3",   // its hot variant — what is allowed above 1.0

  uIconUv: "vec4",    // atlas cell: u0, v0, u1, v1
  uIconBox: "vec4",   // where the icon sits in p space: cx, cy, halfW, halfH
  uIcon: "sampler2D", // the glyph atlas
});

export const FRAGMENT_SHADER = PRECISION + SCALE_PRELUDE + `
const float CUT = ` + CUT.toFixed(4) + `;
const float INSET = ` + INSET.toFixed(4) + `;

varying vec2 vTextureCoord;

uniform float uTime;
uniform float uAspect;
uniform float uForm;
uniform float uEdgeSide;
uniform float uEnter;
uniform float uFlash;
uniform float uPulse;
uniform float uBadge;
uniform float uSel;
uniform float uGold;
uniform float uSpin;
uniform float uSeed;
uniform vec3  uTone;
uniform vec3  uToneHot;
uniform vec4  uIconUv;
uniform vec4  uIconBox;
uniform sampler2D uIcon;

/* One device pixel in p units. GLSL ES 1.0 has no closures, so this is a
   global by necessity — the same arrangement the bar's shader uses. */
float px;

/* ── The prelude's policy, restated in p ──────────────────────────────────
   Same thresholds, same brightness-preserving widening: a band that has to grow
   to stay a pixel wide is dimmed by exactly the factor it grew, so its
   integrated light is unchanged rather than aliased into buzzing. */
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

/* Detail that cannot be filtered, only left out. A register tick on a 12px
   chip is not a smaller tick; it is noise. */
float cDetail(float w) { return smoothstep(GL_FADE_LO, GL_FADE_HI, w / px); }

float cCover(float d) { return 1.0 - smoothstep(-px * 0.5, px * 0.5, d); }

float sdBox(vec2 q, vec2 b) {
  vec2 d = abs(q) - b;
  return min(max(d.x, d.y), 0.0) + length(max(d, 0.0));
}

/* The suite mark: a box with the top-right corner taken off. Note q and not
   abs(q) — mirroring would cut all four corners and turn a plate with a front
   and a back into a lozenge. */
float sdCut(vec2 q, vec2 b, float c) {
  float k = (b.x + b.y - c) * 0.7071068;
  return max(sdBox(q, b), dot(q, vec2(0.7071068)) - k);
}

/* The same, cut top-LEFT — the value tab, so its chamfer opposes the plate's
   and the two corners read as a pair rather than as a repeat. */
float sdCutTL(vec2 q, vec2 b, float c) {
  float k = (b.x + b.y - c) * 0.7071068;
  return max(sdBox(q, b), dot(q, vec2(-0.7071068, 0.7071068)) - k);
}

/* Etched Glass ink, mirrored from PALETTE.ink1 / ink0 in core/theme.mjs. */
const vec3 INK  = vec3(0.043, 0.059, 0.090);
const vec3 INK0 = vec3(0.008, 0.027, 0.043);
const vec3 GOLD  = vec3(1.000, 0.914, 0.722);   /* PALETTE.signalPale */
const vec3 STEEL = vec3(0.38, 0.44, 0.58);

void main(void) {
  vec2 uv = vTextureCoord;
  vec2 p  = (vec2(uv.x, 1.0 - uv.y) - 0.5) * vec2(uAspect, 1.0);
  vec2 b  = vec2(uAspect, 1.0) * 0.5;
  px = max(uTexel * uAspect, 0.000001);

  bool bead  = uForm > 0.5 && uForm < 1.5;
  bool frame = uForm > 1.5 && uForm < 2.5;
  bool ring  = uForm > 2.5 && uForm < 3.5;
  bool row   = uForm > 3.5;

  vec2 bb = vec2(b.x - INSET, b.y - INSET);
  float rad = length(p);
  float R = min(bb.x, bb.y);

  /* ── The body ────────────────────────────────────────────────────────── */
  float dBody;
  if (bead)      dBody = rad - R;
  else if (ring) dBody = abs(rad - R) - max(px * 1.1, 0.006);
  /* A row is a band inside a frame, so it carries no chamfer of its own. Six
     chamfered plates stacked inside a seventh is six corners doing the work of
     one, and the eye reads the repetition rather than the mark. */
  else if (row)  dBody = sdBox(p, bb);
  else           dBody = sdCut(p, bb, min(bb.x, bb.y) * CUT * (frame ? 0.55 : 1.0));

  /* Three separated layers, not one welded frame: stroke, air, trough, lip,
     face. The gaps are the point — a stroke that touches its face is a border,
     and a border is a form control. Same construction as the resource bar, so
     a chip beside the bar is the same object seen from a different angle. */
  float sw  = max(0.026, px * 1.05);
  float air = frame ? 0.050 : 0.030;
  float lip = frame ? 0.028 : 0.017;

  float dTrough = dBody + sw + air;
  float dFace   = dTrough + lip;

  /* Which layers a form actually has. A FRAME is a well you put things in, so
     it stops at its trough — give it a face too and every plate inside is
     sitting on a lit panel, which is two surfaces where the design has one. A
     ROW is the opposite: face only, because its frame already supplied the
     stroke and the trough, and repeating them per row is the nested-box look
     that makes a list of six read as six separate widgets. */
  float mBody   = cCover(dBody);
  float mStroke = (row ? 0.0 : 1.0) * clamp(mBody - cCover(dBody + sw), 0.0, 1.0);
  float mTrough = (row ? 0.0 : 1.0) * cCover(dTrough);
  float mFace   = (ring || frame) ? 0.0 : (row ? mBody : cCover(dFace));

  /* Height coordinate, -1 at the bottom of the body to +1 at the top. Every
     vertical gradient below is written against it, so a 12px bead and a 40px
     row are lit identically rather than at different rates. */
  float hb = clamp(p.y / max(bb.y, 0.0001), -1.0, 1.0);

  /* ── The print ───────────────────────────────────────────────────────────
     Arrival is a wipe with a hot front, not a fade and not a scale. A plate
     that scales in is a plate that was somewhere else a moment ago, which is
     the wrong story: a condition does not fly in, it is *applied*. Scaling is
     also the one thing the resource bar refuses to do, and two neighbouring
     instruments that disagree about whether geometry may move read as two
     different HUDs.

     Reversed, the same channel is the removal: run uEnter back down and the
     plate un-prints from the far end. One channel, two events, no second
     code path to keep in agreement with the first. */
  float wc = bead || ring ? rad : p.x;
  float w0 = bead || ring ? -0.02 : -bb.x - 0.09;
  float w1 = bead || ring ? R + 0.09 : bb.x + 0.09;
  float wx = mix(w0, w1, clamp(uEnter, 0.0, 1.0));
  float seated = cEdge(wx + px, wx - px, wc);
  float printing = 1.0 - smoothstep(0.985, 1.0, uEnter);

  mBody *= seated; mStroke *= seated; mTrough *= seated; mFace *= seated;

  /* ── The trough ──────────────────────────────────────────────────────────
     Flat and dark, with one shadow under the top edge. Whatever sits in a well
     is the interesting part; the well is not. */
  vec3 troughCol = mix(INK0, INK, 0.22 + 0.58 * smoothstep(1.0, -0.85, hb));
  troughCol *= 1.0 - 0.34 * cBand(hb - 0.92, 0.13);

  /* ── The face ────────────────────────────────────────────────────────────
     Near-ink with a bias toward the tone, lit by ONE hard hairline under the
     top edge rather than by a broad gradient. A soft gaussian down the middle
     is the gloss every CSS control has had since 2009; a 1px specular under the
     top edge is what a lit surface actually does.

     The face is deliberately NOT a tone-coloured fill. Six saturated plates
     stacked beside a token is a paint chart, and it puts the loudest colour on
     the largest area — which is backwards, because the colour is the least
     precise thing a chip says. Tone is carried by the rail and by the icon's
     emission, both of which are small and bright. */
  vec3 faceBase = mix(INK * 1.02, uTone * 0.13 + INK * 0.52, 0.60);
  vec3 faceCol = faceBase * (1.14 - 0.46 * smoothstep(0.55, -1.0, hb));
  faceCol += uTone * cBand(hb - 0.50, 0.34) * 0.10;
  faceCol += vec3(1.0) * cBand(hb - 0.86, 0.048) * 0.44;
  faceCol *= 1.0 - 0.32 * cBand(hb + 0.94, 0.12);

  /* ── The tone rail ───────────────────────────────────────────────────────
     One hot hairline of the tone, along the bottom of the face — or down its
     left edge on a wide row, where a bottom rail would be a 6:1 underline and
     read as a scrollbar. Emitted above 1.0 so the bloom pass finds it: this is
     the plate's single light source and the only place the tone is at full
     strength. */
  float faceBot  = row ? -bb.y : -bb.y + sw + air + lip;
  float faceLeft = row ? -bb.x : -bb.x + sw + air + lip;
  float railW = max(px * 1.2, 0.019);
  float rail = uEdgeSide < 0.5
    ? cBand(p.y - (faceBot + railW * 1.4), railW) * mFace
    : cBand(p.x - (faceLeft + railW * 1.4), railW) * mFace;

  /* ── The icon, etched rather than stamped ────────────────────────────────
     Three samples of the same alpha: the glyph, and the glyph shifted a hair up
     and down. The differences are its top and bottom edges, which is what lets
     a flat silhouette be lit as though it were cut into the plate — a dark
     recess, the tone burning inside it, one white filament along the edge that
     faces the light. A tinted sprite laid on top is the cheap version and it
     always reads as a sticker.

     The offset is a fraction of the *atlas cell*, not a constant, so a glyph
     drawn at 12px and the same glyph at 40px are bevelled by the same
     proportion of themselves. */
  vec2 cellUv = uIconUv.zw - uIconUv.xy;
  vec2 q = (p - uIconBox.xy) / max(uIconBox.zw, vec2(0.0001));
  float inIcon = step(abs(q.x), 1.0) * step(abs(q.y), 1.0) * (frame || ring ? 0.0 : 1.0);
  vec2 iuv = mix(uIconUv.xy, uIconUv.zw, vec2(q.x * 0.5 + 0.5, 0.5 - q.y * 0.5));

  /* The offset has to be small against the glyph's own STROKE, not against the
     cell. These strokes are 1.7 units on a 24-unit grid — about 7% of a cell —
     so an offset anywhere near that differences the glyph against empty space
     along its whole length, every part of it reads as a top edge, and the white
     filament floods the sigil until it is a white icon with a coloured halo
     rather than a coloured sigil with a lit edge. A fifth of the stroke width
     finds the edge and nothing else. */
  float bevel = 0.015;
  float ia = texture2D(uIcon, iuv).a * inIcon;
  float iaUp = texture2D(uIcon, iuv - vec2(0.0, cellUv.y * bevel)).a * inIcon;
  float iaDn = texture2D(uIcon, iuv + vec2(0.0, cellUv.y * bevel)).a * inIcon;
  float iTop = clamp(ia - iaUp, 0.0, 1.0);
  float iBot = clamp(ia - iaDn, 0.0, 1.0);

  faceCol = mix(faceCol, INK0 * 0.60, ia * 0.45);
  faceCol += uTone * ia * 1.42;
  faceCol += uToneHot * ia * 0.30;
  faceCol = mix(faceCol, INK0 * 0.35, iBot * 0.80);
  faceCol += vec3(1.0, 0.98, 0.95) * iTop * 0.72;

  /* ── The stroke ──────────────────────────────────────────────────────────
     Steel, warming to gold at the top — but only where uGold says so. Gold is
     the suite's ceremony colour and the resource bar spends it in exactly one
     place, the top of its own stroke. Spending it again on every chip would put
     the warmest note in the composition on its smallest and most numerous
     elements. The containers get it; the plates inside them do not. */
  /* The light runs from the top DOWN, and it has to stop.
     The resource bar spreads this over smoothstep(-0.75, 0.92) because its
     stroke is one hairline around a body thirty pixels tall — the gradient is
     spent long before it reaches anything. A condition plate is twenty-five
     pixels on its longest side, so the same numbers put a broad pale band
     across its whole upper half and the plate stops reading as etched glass and
     starts reading as a glossy button. Held to the top fifth, it is what it was
     always meant to be: one lit edge. */
  vec3 strokeCol = mix(vec3(0.055, 0.068, 0.098),
                       mix(STEEL, GOLD, uGold), smoothstep(0.58, 0.99, hb));
  strokeCol = mix(strokeCol, mix(strokeCol, uToneHot, 0.55), uSel * 0.85);

  /* Register marks stepping outside the body — the detail that says this was
     laid out on an instrument rather than drawn as a box. They leave the moment
     they can no longer span a pixel, rather than becoming grain. */
  float tick = 0.0;
  if (frame && uAspect > 1.5) {
    for (int k = 1; k < 4; k++) {
      float tx = mix(-bb.x, bb.x, float(k) * 0.25);
      tick += cBand(p.x - tx, 0.020) * cBand(p.y + bb.y + 0.075, 0.048);
    }
    tick *= cDetail(0.044);
  }

  /* ── The value tab ───────────────────────────────────────────────────────
     A solid tone chip in the bottom-right with its own chamfer, opposed to the
     plate's. The digit itself is drawn by the harness from the same glyph atlas
     the bar's readout uses — one set of numerals across the whole HUD, rather
     than a second one that is nearly but not exactly the same weight. */
  float mTab = 0.0;
  if (uBadge > 0.5 && !frame && !ring) {
    /* Sized for the digit, not for the plate: a counter that cannot be read is
       a counter that has to be hovered, which is the one thing a badge exists
       to avoid. Flush into the corner, so the tab and the chamfer sit at
       opposite ends of the same diagonal. */
    vec2 nb = vec2(min(0.24, bb.x * 0.38), bead ? 0.205 : 0.235);
    vec2 nc = vec2(bb.x - nb.x, -bb.y + nb.y);
    float dTab = sdCutTL(p - nc, nb, nb.y * 0.75);
    mTab = cCover(dTab) * seated;
  }

  /* ── The breath ──────────────────────────────────────────────────────────
     Peril breathes, on uTime * 1.35 — the *same clock* the resource bar's low
     state uses. Two red pulses at different rates read as two unrelated
     warnings; on one rate a dying creature's bar and its DYING plate are
     visibly one alarm. */
  float breathe = 0.5 + 0.5 * sin(uTime * 1.35 + uSeed * 0.7);

  /* ── The ring ────────────────────────────────────────────────────────────
     One hard specular travelling the rim, and nothing else. The ring is
     furniture: the beads seated on it are the reading. */
  float ringLight = 0.0;
  if (ring) {
    float ang = atan(p.y, p.x) / 6.2831853 + 0.5;
    float d = abs(fract(ang - uSpin + 0.5) - 0.5);
    ringLight = exp(-d / 0.045) * mBody;
  }

  /* ── Compose ─────────────────────────────────────────────────────────── */
  vec3 C = vec3(0.0);
  float A = 0.0;

  C = mix(C, troughCol, mTrough); A = mix(A, 1.0, mTrough);
  C = mix(C, faceCol, mFace);     A = mix(A, 1.0, mFace);

  /* A row's only separator: one hairline along its bottom edge, which is all a
     list needs once the frame around it is doing the containing. */
  if (row) C += STEEL * cBand(p.y + bb.y, max(px * 1.0, 0.010)) * mFace * 0.42;

  C += mix(uTone, uToneHot, 0.30) * rail * 1.15;
  C += mix(GOLD, uToneHot, 0.35) * ringLight * 1.20;

  C = mix(C, strokeCol, mStroke); A = mix(A, 1.0, mStroke);
  C += STEEL * tick * 0.80;       A = max(A, min(tick * 0.9, 1.0));

  /* The tab goes on last and opaque: a number that a face gradient shows
     through is a number you read twice to be sure of. */
  vec3 tabCol = mix(uTone, uToneHot, 0.30 + 0.22 * smoothstep(-1.0, 1.0, hb));
  C = mix(C, tabCol, mTab); A = mix(A, 1.0, mTab);

  /* The hot front of the print, and the flash behind it. Written well above
     1.0 on purpose: the bright-pass keeps only what exceeds 1.0, so anything
     meant to bloom has to be emitted as light rather than as a pale colour. */
  float front = cGauss(wc - wx, 0.060) * printing * (mBody + mTrough * 0.5);
  C += vec3(1.00, 0.96, 0.90) * front * 2.30;
  C += vec3(1.00, 0.95, 0.88) * uFlash * 1.45 * mBody;

  /* The peril breath, in the chrome and the rail — never in the face. A plate
     whose whole surface pulses is a plate you cannot read a glyph off. */
  C = mix(C, uToneHot, mStroke * uPulse * (0.22 + 0.46 * breathe));
  C += uToneHot * rail * uPulse * breathe * 0.9;

  /* Hover: a specular crossing the face, on the same 0.30 Hz the bar's sweep
     uses so a hovered token reads as one gesture. */
  float sweepX = mix(-bb.x - 0.6, bb.x + 0.6, fract(uTime * 0.30 + uSeed * 0.11));
  C += vec3(0.62, 0.74, 0.96) * cGauss(p.x - sweepX, 0.16) * mFace * uSel * 0.20;

  vec3 outC = C * A;
  float outA = A;

  /* ── Bloom ───────────────────────────────────────────────────────────────
     A contact-light floor only, added after the premultiply so it is light
     spilling past the body rather than a translucent shape drawn beside it. The
     separable blur downstream is the real bloom; an analytic halo on top of it
     reads as haze, because the two falloffs disagree and the mismatch looks
     like fog.

     The gate matters: exp(-outside/k) is 1.0 everywhere *inside* the body, so
     without it the glow does not spill past the plate, it floods it — and the
     etched icon it is meant to be lighting from behind washes out. */
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

/* ══════════════════════════════════════════════════════════════════════════
   Tone — the classification PF2e does not ship
   ══════════════════════════════════════════════════════════════════════════

   The system knows only a slug: `CONDITION_SLUGS` is a flat set, and nothing
   on a ConditionPF2e says whether it is good or bad news, let alone what kind
   of bad. So colour can carry no meaning until we decide what the tones are,
   and that decision is the one thing here that is expensive to change later —
   a GM learns "orange means a number got worse" once.

   Six, and the two constraints that fixed the number: every tone has to be
   separable from every other at a 14px chip on a dark map (which rules out
   putting `impair` and `control` on neighbouring ambers), and none of them may
   be the suite's gold, which is spent on chrome.
   ────────────────────────────────────────────────────────────────────────── */
export const TONES = Object.freeze({
  peril:   { body: PALETTE.hazard,  hot: PALETTE.hazardHot, rank: 0,
             note: "The death track. Nothing else may outrank it." },
  impair:  { body: PALETTE.warnDeep, hot: PALETTE.warn,     rank: 1,
             note: "A number gets worse. Valued, almost always." },
  control: { body: PALETTE.violet,  hot: PALETTE.violetHot, rank: 2,
             note: "Actions are taken away." },
  sense:   { body: PALETTE.cyan,    hot: PALETTE.cyanHot,   rank: 3,
             note: "What can be seen, heard or found." },
  burden:  { body: "#8593ad",       hot: "#cfd7e4",         rank: 4,
             note: "True, and rarely the thing you act on." },
  boon:    { body: PALETTE.good,    hot: PALETTE.goodHot,   rank: 5,
             note: "The only tone that is good news." },
});

/**
 * The PF2e conditions this preview draws, with the tone each is assigned.
 *
 * Slugs and labels are the system's own (`CONFIG.PF2E.conditionTypes`, of which
 * 37 reach the token HUD); `valued` marks the twelve that carry a counter badge
 * plus persistent damage, which carries a formula instead.
 */
export const CONDITIONS = Object.freeze({
  "dying":             { name: "Dying",       tone: "peril",   valued: true },
  "wounded":           { name: "Wounded",     tone: "peril",   valued: true },
  "doomed":            { name: "Doomed",      tone: "peril",   valued: true },
  "persistent-damage": { name: "Persistent",  tone: "peril",   valued: false },
  "frightened":        { name: "Frightened",  tone: "impair",  valued: true },
  "clumsy":            { name: "Clumsy",      tone: "impair",  valued: true },
  "enfeebled":         { name: "Enfeebled",   tone: "impair",  valued: true },
  "drained":           { name: "Drained",     tone: "impair",  valued: true },
  "stupefied":         { name: "Stupefied",   tone: "impair",  valued: true },
  "sickened":          { name: "Sickened",    tone: "impair",  valued: true },
  "slowed":            { name: "Slowed",      tone: "control", valued: true },
  "stunned":           { name: "Stunned",     tone: "control", valued: true },
  "immobilized":       { name: "Immobilized", tone: "control", valued: false },
  "grabbed":           { name: "Grabbed",     tone: "control", valued: false },
  "prone":             { name: "Prone",       tone: "control", valued: false },
  "fleeing":           { name: "Fleeing",     tone: "control", valued: false },
  "confused":          { name: "Confused",    tone: "control", valued: false },
  "blinded":           { name: "Blinded",     tone: "sense",   valued: false },
  "dazzled":           { name: "Dazzled",     tone: "sense",   valued: false },
  "concealed":         { name: "Concealed",   tone: "sense",   valued: false },
  "off-guard":         { name: "Off-Guard",   tone: "burden",  valued: false },
  "encumbered":        { name: "Encumbered",  tone: "burden",  valued: false },
  "fatigued":          { name: "Fatigued",    tone: "burden",  valued: false },
  "quickened":         { name: "Quickened",   tone: "boon",    valued: false },
});

/**
 * The glyph set, as SVG path data on a 24-unit grid.
 *
 * Stroke-built at one weight, because the shader lights these by *differencing*
 * the alpha against itself a fraction of a cell up and down: a set that mixes
 * heavy fills with hairlines bevels at wildly different strengths and stops
 * looking like one system. The shipped feature would sample PF2e's own
 * `systems/pf2e/icons/conditions/*.webp` through the same path — they are
 * silhouettes on transparency, which is all the etch needs.
 */
export const ICON_STROKE = 1.7;
export const ICONS = Object.freeze({
  "dying": [
    "M12 3a7.5 7.5 0 0 0-7.5 7.5v2.6l2 2V19h11v-3.9l2-2V10.5A7.5 7.5 0 0 0 12 3z",
    "M10.2 15.4v2M13.8 15.4v2",
    { fill: "M9.2 9.3a1.7 1.7 0 1 1 0 3.4 1.7 1.7 0 0 1 0-3.4zM14.8 9.3a1.7 1.7 0 1 1 0 3.4 1.7 1.7 0 0 1 0-3.4z" },
  ],
  "wounded": [
    "M12 20.5S4 15.4 4 10.4A3.9 3.9 0 0 1 12 8a3.9 3.9 0 0 1 8 2.4c0 5-8 10.1-8 10.1z",
    "M12.6 8.6l-2 3.6 3 1.3-2 3.4",
  ],
  "doomed": [
    "M3.5 5h17L12 20.5z", "M12 9v3.6",
    { fill: "M12 14.8a1 1 0 1 1 0 2 1 1 0 0 1 0-2z" },
  ],
  "persistent-damage": [
    "M12 2.6c3.3 4.3 5.4 5.9 5.4 9.9a5.4 5.4 0 0 1-10.8 0c0-1.9.9-3.2 2.1-4.3 0 2.1 1 3.1 2 3.1 0-3.1.5-6.1 1.3-8.7z",
  ],
  "frightened": [
    "M12 12a8.5 8.5 0 1 1 0-17 8.5 8.5 0 0 1 0 17z", "M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17z",
    "M12 14a2.6 2 0 1 1 0 4 2.6 2 0 0 1 0-4z",
    { fill: "M9.2 8.7a1.3 1.3 0 1 1 0 2.6 1.3 1.3 0 0 1 0-2.6zM14.8 8.7a1.3 1.3 0 1 1 0 2.6 1.3 1.3 0 0 1 0-2.6z" },
  ],
  "clumsy": [
    "M3.5 16.5c2.6-5.6 4.6 3.4 8-2.4s4.4 1.8 6.2-2.6", "M20.5 11.5l-.6 3.2-2.9-1", "M3 20.5h18",
  ],
  "enfeebled": ["M12 3.5v11.5", "M7 10.5l5 4.5 5-4.5", "M4.5 20h15"],
  "drained": ["M12 3.2s6.2 7.1 6.2 11a6.2 6.2 0 1 1-12.4 0c0-3.9 6.2-11 6.2-11z", "M9 14.4h6"],
  "stupefied": [
    "M12 12.3a1.9 1.9 0 1 1-1.7-1.9 4.4 4.4 0 1 1 4.1 4.6 6.9 6.9 0 1 1-6.6-8.5",
    "M18.5 4.5l2 .6-.6 2",
  ],
  "sickened": [
    "M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17z",
    "M7.6 8.8l2.4 2.4M10 8.8l-2.4 2.4M14 8.8l2.4 2.4M16.4 8.8L14 11.2",
    "M8 16.6q2-2.2 4 0t4 0",
  ],
  "slowed": [
    "M6 3.2h12M6 20.8h12",
    "M7.4 3.2c0 4.9 4.6 5.9 4.6 8.8s-4.6 3.9-4.6 8.8",
    "M16.6 3.2c0 4.9-4.6 5.9-4.6 8.8s4.6 3.9 4.6 8.8",
  ],
  "stunned": [
    "M4 10.5c4.5-6 11.5-6 16 0",
    "M5.4 13.9a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zM12 16.1a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zM18.6 13.9a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3z",
  ],
  "immobilized": [
    "M4.5 11.6a1.6 1.6 0 0 1 1.6-1.6h11.8a1.6 1.6 0 0 1 1.6 1.6v7.3a1.6 1.6 0 0 1-1.6 1.6H6.1a1.6 1.6 0 0 1-1.6-1.6z",
    "M8.2 10V7.2a3.8 3.8 0 0 1 7.6 0V10",
  ],
  "grabbed": ["M7 12.5V7M11 12V3.8M15 12.5V6.2", "M19 11.5v4.2a6 6 0 0 1-6 6h-1.6A6.4 6.4 0 0 1 5 15.3v-3"],
  "prone": [
    "M5.4 10.3a2.3 2.3 0 1 1 0 4.6 2.3 2.3 0 0 1 0-4.6z",
    "M8.2 14.6h9.4M8.6 11h6.6", "M2.5 19.5h19",
  ],
  "fleeing": ["M2.5 12h11.5", "M10.5 7.6L14.9 12l-4.4 4.4", "M19.5 4.5v15"],
  "confused": [
    "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z",
    "M9.4 9.4a2.7 2.7 0 1 1 3.5 3.4c-.8.3-1.1 1-1.1 1.7",
    { fill: "M11.8 16.2a1 1 0 1 1 0 2 1 1 0 0 1 0-2z" },
  ],
  "blinded": [
    "M2.2 12S6 5.8 12 5.8 21.8 12 21.8 12 18 18.2 12 18.2 2.2 12 2.2 12z",
    "M12 9.4a2.6 2.6 0 1 1 0 5.2 2.6 2.6 0 0 1 0-5.2z",
    "M3.6 20.4L20.4 3.6",
  ],
  "dazzled": [
    "M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8z",
    "M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.2 2.2M16.9 16.9l2.2 2.2M19.1 4.9l-2.2 2.2M7.1 16.9l-2.2 2.2",
  ],
  "concealed": ["M7 18.5h10a4.2 4.2 0 0 0 .7-8.3A6.3 6.3 0 0 0 5.8 11 3.7 3.7 0 0 0 7 18.5z"],
  "off-guard": [
    "M12 2.8l8 3.2v6c0 5.5-4.4 8.7-8 10.2-3.6-1.5-8-4.7-8-10.2v-6z",
    { dash: [0.1, 3.4], d: "M12 3v19" },
  ],
  "encumbered": ["M4 8.5h16l-1.6 12H5.6z", "M8.6 8.5V6a3.4 3.4 0 0 1 6.8 0v2.5"],
  "fatigued": ["M20 14.2A8.4 8.4 0 0 1 9.8 4a8.6 8.6 0 1 0 10.2 10.2z"],
  "quickened": ["M13.4 2L5 13.2h5.6L9.4 22 19 10.4h-5.8z"],
});

/** "#rrggbb" → [r, g, b] floats, for a uniform. */
export function hexToFloat3(hex) {
  const n = parseInt(String(hex).replace(/^#/, ""), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
