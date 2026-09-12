/**
 * GLUniverse Suite — resource bars: the name label.
 *
 * Foundry's nameplate is a `PIXI.Text` centred under the token, in a font and a
 * position nothing else in this feature shares. Once the bars are an instrument,
 * a caption floating somewhere near them reads as a second, unrelated widget. So
 * the name moves onto the bar: uppercase, lightly tracked, in the readout's own
 * `--gl-tech`, sitting on the bar's top edge and followed by a hairline rule that
 * runs toward the cut corner. A token with no bar gets the same name centred in
 * the same slot, as `── NAME ──`.
 *
 * ── Why a raster per name ──
 *
 * Names are arbitrary Unicode, so the numeral atlas cannot draw them. Each one is
 * rasterised once per (text, size bucket) and cached. The bucket follows the
 * label's size in *device* pixels, stepping by a third of an octave, so a label
 * is re-rastered only when zoom crosses a step: it stays crisp at every zoom and
 * nothing is uploaded while the canvas is standing still. Textures are
 * reference-counted and destroyed when the last label lets go of them.
 *
 * ── Why the row is always reserved ──
 *
 * The bar stack moves down by the name row whenever a label is *possible*, not
 * when one is drawn. Otherwise a Hover-mode name appearing would push the bar
 * down a row under the cursor — the jump Phase 1 spent its whole effort removing.
 *
 * ── Motion ──
 *
 * Driven by anime.js on a plain state object, never autoplayed: the host seeks it
 * from its own ticker clock, so the motion tier scales it, an off-screen label
 * freezes with its bar, and the Node check tool can step it frame by frame. The
 * shared engine's main loop and speed belong to other features and are never
 * touched. Every duration is in NAME_TIMING and nowhere else.
 */

import { animate as anime } from "../../core/motion.mjs";
import { cssVar, hexToInt, hexToRgbFloat, PALETTE } from "../../core/theme.mjs";
import { CUT, PRECISION } from "./shader.mjs";
import { TEXT_FRAGMENT_SHADER, TEXT_VERTEX_SHADER } from "./atlas.mjs";
import { CIPHER_ADVANCE_OF_CAP, cipherGeometry, getCipherAtlas } from "./cipher-atlas.mjs";
import { cipherGlyphs, cipherLength, flurryEpoch, GM_MARKER, scrambleGlyph } from "./mystify.mjs";

/* ══════════════════════════════════════════════════════════════════════
   Tables — every duration and every size lives in one of these
   ══════════════════════════════════════════════════════════════════════ */

/**
 * Durations in unscaled milliseconds. `motionScale` multiplies each of them,
 * exactly as it does TIMING in `anim.mjs`.
 *
 * `flurryMs` is the one *period* here and it is divided by the scale rather than
 * multiplied: "reduced" motion shortens every animation, and a shorter flurry
 * period would mean a cipher that flickers *more* on the setting that asked for
 * less. At motion "none" the flurry does not run at all.
 */
export const NAME_TIMING = Object.freeze({
  fadeInMs: 120,    // a label appearing — the bar's own fade
  fadeOutMs: 120,   // a hover or selection letting go — the bar's own fade
  identifyMs: 600,  // a cipher decoding into the real name, on identification
  scrambleMs: 60,   // how often a still-decoding glyph re-rolls
  flurryMs: 4000,   // a standing cipher: two or three glyphs re-roll this often
});

/** anime.js ease names for each transition. */
export const NAME_EASE = Object.freeze({
  appear: "linear",
  identify: "inOut(1.6)",
  fade: "linear",
});

/** Label geometry. Sizes are fractions of the cap height unless named otherwise. */
export const NAME_LAYOUT = Object.freeze({
  /* 0.30 of the hero quad is a 7.2px cap on a 100px grid — whole at 100% zoom
     on an ordinary display, just above the fade band — and lets a typical
     seventeen-letter creature name fit a one-square token by shrinking rather
     than by losing its end. At 0.36 half the bestiary took an ellipsis. */
  capOfHero: 0.30,     // cap height, × the hero quad's height (itself grid-derived)
  minCapPx: 5,         // world px floors and ceilings on the cap, before the viewer's scale
  maxCapPx: 16,
  rowOfCap: 1.8,       // the reserved row
  liftOfCap: 0.45,     // air between the baseline and the bar body
  trackEm: 0.08,       // letter spacing: light, because every em of it is width a name loses
  weight: 600,
  strokeOfFont: 0.16,  // baked outline, × font size
  ruleGapOfCap: 0.7,   // name → rule
  ruleMinOfCap: 1.0,   // a rule shorter than this is not drawn
  cutGapOfCap: 0.35,   // the rule stops this far short of the cut corner
  flankOfCap: 1.2,     // `── NAME ──` flank length
  flankMaxOfW: 0.12,   // … but never more than this fraction of the token: the flanks
  flankGapOfCap: 0.5,  //   frame the name, and at a fifth each they were eating it
  markerOfCap: 0.8,    // the GM's cipher marker
  markerGapOfCap: 0.45,
  minFit: 0.75,        // shrink a long name to this, then ellipsis
  fadeLoPx: 4.5,       // cap height in device px: gone at or below…
  fadeHiPx: 7,         // …whole at or above
  rulePx: 1,           // the hairline, in DEVICE pixels
  bucketsPerOctave: 3,
  minRasterPx: 8,
  maxRasterPx: 160,
  measurePx: 100,      // font size layout is measured at
  capRatio: 0.7,       // cap height / font size, when the font cannot be measured
});

/**
 * The quad's vertical padding per row role, mirrored from the shader's
 * `padY = mix(0.15, 0.10, hero)`. The name sits on the *body's* top edge, and the
 * body is inset from the quad by this much. Pinned against the GLSL.
 */
export const HERO_PAD_Y = 0.10;
export const RAIL_PAD_Y = 0.15;

/** Colours, from the palette mirror — never literals. */
export const NAME_INK = Object.freeze({
  text: PALETTE.text,
  edge: PALETTE.ink0,
  rule: PALETTE.textDim,    // the steel/ink family the bar's stroke is drawn in
  marker: PALETTE.accent,
  ruleAlpha: 0.55,
  gmDim: 0.7,               // the GM's view of a name players cannot read
});

const ELLIPSIS = "…";
const clamp01 = (n) => (n < 0 ? 0 : n > 1 ? 1 : n);
const clamp = (n, lo, hi) => (n < lo ? lo : n > hi ? hi : n);

/* ══════════════════════════════════════════════════════════════════════
   Pure layout — the host, the preview and the check tool all call these
   ══════════════════════════════════════════════════════════════════════ */

/** The label's cap height in world pixels. */
export function nameCap(heroH, scale = 1) {
  const s = Number.isFinite(scale) && scale > 0 ? scale : 1;
  return clamp(heroH * NAME_LAYOUT.capOfHero, NAME_LAYOUT.minCapPx, NAME_LAYOUT.maxCapPx) * s;
}

/** The row reserved above the bars, in world pixels. */
export function nameRowHeight(heroH, scale = 1) {
  return nameCap(heroH, scale) * NAME_LAYOUT.rowOfCap;
}

/**
 * Where a label goes, in world pixels.
 *
 * `bar` is the top row of the stack (`{ h, pad }`), or null for a token with no
 * bar, in which case the label is centred where the hero bar *would* be — the
 * same baseline, so a token that gains a bar does not move its name vertically.
 */
export function nameGeometry({ baseX, barsTop, w, heroH, scale = 1, bar = null }) {
  const cap = nameCap(heroH, scale);
  const row = bar ?? { h: heroH, pad: HERO_PAD_Y };
  const baseline = barsTop + row.h * row.pad - cap * NAME_LAYOUT.liftOfCap;
  const capMid = baseline - cap / 2;
  const ruleGap = cap * NAME_LAYOUT.ruleGapOfCap;
  if (!bar) {
    const flank = Math.min(cap * NAME_LAYOUT.flankOfCap, w * NAME_LAYOUT.flankMaxOfW);
    const flankGap = cap * NAME_LAYOUT.flankGapOfCap;
    return {
      centred: true, cap, baseline, capMid, left: baseX, width: w, centre: baseX + w / 2,
      textMax: Math.max(0, w - 2 * (flank + flankGap)), flank, flankGap, ruleGap, ruleStop: baseX + w,
    };
  }
  /* The cut takes `half body height × CUT` off the top edge, exactly as
     `sdCut` does, so the rule stops short of the diagonal rather than running
     into it. */
  const cutLen = row.h * (0.5 - row.pad) * CUT;
  return {
    centred: false, cap, baseline, capMid, left: baseX, width: w, centre: baseX + w / 2,
    textMax: Math.max(0, w - cutLen), flank: 0, flankGap: 0, ruleGap,
    ruleStop: baseX + w - cutLen - cap * NAME_LAYOUT.cutGapOfCap,
  };
}

/** The room the GM's cipher marker takes after a name, in world units. */
export function markerSpan(cap) {
  return cap * (NAME_LAYOUT.markerGapOfCap + NAME_LAYOUT.markerOfCap * CIPHER_ADVANCE_OF_CAP);
}

/**
 * The width a label's text may use: the geometry's, less the marker's room when
 * it carries one. Fitting to the geometry alone put the marker past the bar's
 * right end on exactly the long names that fill it — so on the GM's screen, the
 * one place the marker is drawn, it was off the token.
 */
export function textRoom(g, content) {
  return Math.max(0, g.textMax - (content?.marker ? markerSpan(g.cap) : 0));
}

/** What the label spells: the name, uppercased. */
export function displayText(name) {
  return String(name ?? "").trim().toLocaleUpperCase();
}

/** User-perceived characters, so a decode never splits an accent from its letter. */
export function graphemes(text) {
  const s = String(text ?? "");
  if (typeof Intl !== "undefined" && typeof Intl.Segmenter === "function") {
    return Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(s), (g) => g.segment);
  }
  return Array.from(s);
}

/**
 * Fit a name into its width: shrink to fit down to `minFit`, then ellipsis.
 *
 * Shrinking first because a slightly smaller whole name beats a truncated one;
 * floored because past three-quarters the label stops matching every other label
 * on the map and reads as a different kind of thing. `measure(text)` is the width
 * at a font size of 1.
 *
 * @returns {{ text, scale, width, graphemes, stops }} `stops` are the x offsets of
 *          each grapheme boundary, in world units, length graphemes + 1.
 */
export function fitLabel(text, { cap, maxWidth, measure, capRatio = NAME_LAYOUT.capRatio, minFit = NAME_LAYOUT.minFit }) {
  const font = cap / capRatio;
  const widthOf = (t) => measure(t) * font;
  const build = (t, scale) => {
    const parts = graphemes(t);
    const stops = [0];
    let prefix = "";
    for (const g of parts) { prefix += g; stops.push(widthOf(prefix) * scale); }
    return { text: t, scale, width: stops[stops.length - 1], graphemes: parts, stops };
  };
  if (!text || !(maxWidth > 0)) return build("", 1);
  const full = widthOf(text);
  if (full <= maxWidth) return build(text, 1);
  if (full * minFit <= maxWidth) return build(text, maxWidth / full);
  const parts = graphemes(text);
  for (let n = parts.length - 1; n > 0; n--) {
    const t = parts.slice(0, n).join("").trimEnd() + ELLIPSIS;
    if (widthOf(t) * minFit <= maxWidth) return build(t, minFit);
  }
  return widthOf(ELLIPSIS) * minFit <= maxWidth ? build(ELLIPSIS, minFit) : build("", minFit);
}

/**
 * How present a label is at a given on-screen size.
 *
 * A smoothstep over cap height in device pixels, so a zoom-out thins the label
 * continuously instead of popping it at a threshold. Below a handful of pixels
 * uppercase letters are a grey smear, and a smear on every token is worse than
 * nothing.
 */
export function zoomFade(capDevicePx) {
  const t = clamp01((capDevicePx - NAME_LAYOUT.fadeLoPx) / (NAME_LAYOUT.fadeHiPx - NAME_LAYOUT.fadeLoPx));
  return t * t * (3 - 2 * t);
}

/** The raster size for a font size in device pixels: the next third-octave up. */
export function rasterBucket(fontDevicePx) {
  const b = NAME_LAYOUT.bucketsPerOctave;
  const px = Math.pow(2, Math.ceil(Math.log2(Math.max(1, fontDevicePx)) * b) / b);
  return clamp(Math.round(px), NAME_LAYOUT.minRasterPx, NAME_LAYOUT.maxRasterPx);
}

/**
 * Whether a content change is an identification — and so the one change that
 * decodes. Only ever cipher → a real name: a decode can never start from, or end
 * on, a name this client may not read.
 */
export function shouldIdentify(prev, next) {
  return !!prev?.cipher && !prev?.text && !!next?.text;
}

/**
 * What a label draws at one instant.
 *
 * Pure: the renderer and the preview both call it, so the preview is the real
 * composition rather than a drawing of one. In cipher mode it never sees a name —
 * there is no parameter for one.
 *
 * @returns {{ cut, glyphs, end, final }} `cut` is how much of the real name is
 *   resolved (world x from the label's left); `glyphs` the atlas glyphs to draw
 *   with their centres; `end` where the drawn content ends now; `final` where it
 *   ends once settled.
 */
export function composeLabel({ mode, fit = null, seed = 0, epoch = 0, tick = 0, decode = 1,
  identify = false, adv = 1, maxWidth = Infinity }) {
  const p = clamp01(decode);
  const glyphs = [];
  const fits = (cx) => cx + adv / 2 <= maxWidth + 1e-6;

  /* Appearing is a fade on the whole label, so a cipher is always its whole run. */
  if (mode === "cipher") {
    const run = cipherGlyphs(seed, epoch);
    let final = 0;
    for (let i = 0; i < run.length; i++) {
      const cx = (i + 0.5) * adv;
      if (!fits(cx)) break;
      glyphs.push({ ch: run[i], cx });
      final = cx + adv / 2;
    }
    return { cut: 0, glyphs, end: final, final };
  }

  const n = fit?.graphemes?.length ?? 0;
  const stops = fit?.stops ?? [0];
  const width = fit?.width ?? 0;
  if (!n) return { cut: 0, glyphs, end: 0, final: 0 };
  /* The only partial composition is identification; anything else is the name. */
  if (p >= 1 || !identify) return { cut: width, glyphs, end: width, final: width };

  {
    /* From the cipher, not from nothing: at the first frame the run is exactly
       the cipher the player was looking at, and it shrinks as the name grows. */
    const run = cipherGlyphs(seed, epoch);
    const len = run.length;
    const k = Math.min(n, Math.floor(n * p));
    const cut = stops[k];
    const unresolved = Math.ceil(((n - k) / n) * len);
    let end = cut;
    for (let i = 0; i < unresolved; i++) {
      const slot = len - unresolved + i;
      const cx = cut + (i + 0.5) * adv;
      if (!fits(cx)) break;
      glyphs.push({ ch: p === 0 ? run[slot] : scrambleGlyph(seed, slot, tick), cx });
      end = cx + adv / 2;
    }
    return { cut, glyphs, end, final: width };
  }
}

/* ══════════════════════════════════════════════════════════════════════
   Measuring and rasterising — need a document, never run at import
   ══════════════════════════════════════════════════════════════════════ */

const labelFont = () => cssVar("--gl-tech", "monospace");

function applyFont(ctx, px) {
  ctx.font = NAME_LAYOUT.weight + " " + px + "px " + labelFont();
  /* Tracking where the canvas supports it. Drawing letters one at a time instead
     would break every script that shapes across letters, which is most of the
     non-Latin names a table will ever type. */
  if ("letterSpacing" in ctx) ctx.letterSpacing = (NAME_LAYOUT.trackEm * px).toFixed(2) + "px";
}

let measurer = null;
const widths = new Map();

function measureContext() {
  if (measurer) return measurer;
  const doc = globalThis.document;
  if (!doc?.createElement) return null;
  const ctx = doc.createElement("canvas").getContext("2d");
  if (!ctx) return null;
  applyFont(ctx, NAME_LAYOUT.measurePx);
  const h = ctx.measureText("H");
  const ratio = Number.isFinite(h.actualBoundingBoxAscent) && h.actualBoundingBoxAscent > 0
    ? h.actualBoundingBoxAscent / NAME_LAYOUT.measurePx
    : NAME_LAYOUT.capRatio;
  measurer = { ctx, capRatio: ratio };
  return measurer;
}

/** Cap height over font size for the label font. */
export function capRatio() {
  return measureContext()?.capRatio ?? NAME_LAYOUT.capRatio;
}

/** A string's width at a font size of 1, tracking included. */
export function measureEm(text) {
  const key = String(text ?? "");
  const hit = widths.get(key);
  if (hit !== undefined) return hit;
  const m = measureContext();
  const w = m ? m.ctx.measureText(key).width / NAME_LAYOUT.measurePx : key.length * 0.6;
  if (widths.size > NAME_LAYOUT.maxRasterPx * 4) widths.clear();
  widths.set(key, w);
  return w;
}

/**
 * Rasterise one label.
 *
 * `paint` draws real colours instead of the channel code, for the preview's
 * Canvas2D compositor; the typography is identical either way.
 */
export function rasterLabel(text, px, { doc = globalThis.document, paint = null } = {}) {
  const canvas = doc.createElement("canvas");
  let ctx = canvas.getContext("2d");
  applyFont(ctx, px);
  const m = ctx.measureText(text);
  const fin = (v, d) => (Number.isFinite(v) ? v : d);
  const ascent = Math.max(fin(m.actualBoundingBoxAscent, 0), px * capRatio());
  const descent = Math.max(fin(m.actualBoundingBoxDescent, 0), 0);
  const stroke = Math.max(1, px * NAME_LAYOUT.strokeOfFont);
  const pad = Math.ceil(stroke + 2);
  const textX = pad + Math.max(0, fin(m.actualBoundingBoxLeft, 0));
  const inkRight = Math.max(m.width, fin(m.actualBoundingBoxRight, m.width));
  canvas.width = Math.max(1, Math.ceil(textX + inkRight + pad));
  canvas.height = Math.max(1, Math.ceil(pad + ascent + descent + pad));
  /* Resizing a canvas resets its context, font and tracking included. */
  ctx = canvas.getContext("2d");
  applyFont(ctx, px);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.lineJoin = "round";
  const baselineY = pad + ascent;
  ctx.lineWidth = stroke;
  ctx.strokeStyle = paint ? paint.edge : "rgba(255,0,0,1)";
  ctx.strokeText(text, textX, baselineY);
  ctx.fillStyle = paint ? paint.ink : "rgba(0,255,0,1)";
  ctx.fillText(text, textX, baselineY);
  return { canvas, textX, baselineY, width: canvas.width, height: canvas.height, px };
}

/* ── The raster cache ────────────────────────────────────────────────────
   Keyed on (text, bucket) and reference-counted. It is only ever asked for a
   string that was handed to a label as `content.text` — which a player's label
   for a hidden creature never has — so it cannot hold, let alone hand out, a
   name this client may not read. */

const rasters = new Map();

function acquireRaster(text, px) {
  const key = px + " " + text;
  let r = rasters.get(key);
  if (!r) {
    const info = rasterLabel(text, px);
    const texture = PIXI.Texture.from(info.canvas);
    texture.baseTexture.scaleMode = PIXI.SCALE_MODES?.LINEAR ?? texture.baseTexture.scaleMode;
    r = { key, text, px, texture, info, refs: 0 };
    rasters.set(key, r);
  }
  r.refs++;
  return r;
}

function releaseRaster(r) {
  if (!r) return;
  r.refs--;
  if (r.refs > 0) return;
  r.texture.destroy(true);
  rasters.delete(r.key);
}

/** Drop every raster and measurement (canvas teardown, font load). */
export function resetNameRasters() {
  for (const r of rasters.values()) r.texture.destroy(true);
  rasters.clear();
  widths.clear();
  measurer = null;
}

/* ══════════════════════════════════════════════════════════════════════
   Shaders
   ══════════════════════════════════════════════════════════════════════ */

export const NAME_VERTEX_SHADER = `
attribute vec2 aVertexPosition;
attribute vec2 aUvs;
uniform mat3 translationMatrix;
uniform mat3 projectionMatrix;
varying vec2 vUv;
void main(void) {
  vUv = aUvs;
  gl_Position = vec4((projectionMatrix * translationMatrix * vec3(aVertexPosition, 1.0)).xy, 0.0, 1.0);
}`;

/**
 * The rasterised name, tinted through the same channel code as the numerals and
 * cut off at `uCut` so a decode can resolve it left to right without a second
 * texture. Unpremultiplied before the channel test, so the outline does not bleed
 * into the ink along every antialiased edge.
 */
export const NAME_FRAGMENT_SHADER = PRECISION + `
varying vec2 vUv;
uniform sampler2D uTex;
uniform vec3 uInk;
uniform vec3 uEdge;
uniform float uOpacity;
uniform float uCut;
uniform float uSoft;
void main(void) {
  vec4 t = texture2D(uTex, vUv);
  float keep = 1.0 - smoothstep(uCut - uSoft, uCut, vUv.x);
  float body = t.a > 0.0001 ? clamp(t.g / t.a, 0.0, 1.0) : 0.0;
  float a = t.a * uOpacity * keep;
  gl_FragColor = vec4(mix(uEdge, uInk, body) * a, a);
}`;

/* ══════════════════════════════════════════════════════════════════════
   Motion
   ══════════════════════════════════════════════════════════════════════ */

/**
 * Whether a label is on screen, and how it got there — the name's counterpart to
 * the bar's RevealAnim, with the same rules: appearing and a hover letting go are
 * a short plain fade that turns round from wherever it is, and leaving sight is
 * instant. The one decode is identification, cipher → name, which happens once.
 *
 * `state` is the plain object anime.js writes to. Nothing autoplays; `step(dt)`
 * seeks the running animation to this label's own elapsed time.
 */
export class LabelMotion {
  constructor({ motionScale = 1 } = {}) {
    this.motionScale = motionScale;
    this.shown = false;
    this.state = { fade: 0, decode: 1 };
    /** "appear" | "identify" | "fade" | null */
    this.mode = null;
    this._anim = null;
    this._t = 0;
    this._duration = 0;
  }

  get drawn() { return this.state.fade > 0 || this.mode === "appear"; }
  get hot() { return this._anim !== null; }
  get decoding() { return this.mode === "identify"; }

  /** `portion` shortens a fade that starts part way, so its speed is constant. */
  _run(mode, key, props, portion = 1) {
    this.cancel();
    const duration = NAME_TIMING[key] * this.motionScale * portion;
    if (!(duration > 0)) {
      for (const [k, v] of Object.entries(props)) this.state[k] = v[1];
      return;
    }
    this.mode = mode;
    this._t = 0;
    this._duration = duration;
    this._anim = anime(this.state, {
      ...props, duration, ease: NAME_EASE[mode], autoplay: false, composition: "none",
    });
    this._anim.seek(0, true);
  }

  show(animate = false) {
    this.shown = true;
    if (this.mode === "appear" || this.mode === "identify" || (!this._anim && this.state.fade >= 1)) return;
    /* From wherever a fade-out left it: a label caught leaving turns round. */
    const from = this.state.fade;
    this.state.decode = 1;
    if (animate && this.motionScale > 0 && from < 1) this._run("appear", "fadeInMs", { fade: [from, 1] }, 1 - from);
    else { this.cancel(); this.state.fade = 1; }
  }

  hide(animate = false) {
    const wasDrawn = this.drawn;
    this.shown = false;
    if (animate && this.mode === "fade") return;
    this.state.decode = 1;
    if (animate && wasDrawn && this.motionScale > 0) {
      this._run("fade", "fadeOutMs", { fade: [this.state.fade, 0] }, this.state.fade);
    } else {
      this.cancel();
      this.state.fade = 0;
    }
  }

  /** Cipher → name. Only meaningful on a label that is showing. */
  identify(animate = false) {
    if (!this.shown) return;
    this.state.fade = 1;
    if (animate && this.motionScale > 0) this._run("identify", "identifyMs", { decode: [0, 1] });
    else { this.cancel(); this.state.decode = 1; }
  }

  /** Jump the running transition to its end. */
  finish() {
    if (!this._anim) return;
    this._anim.seek(this._duration, true);
    this._end();
  }

  cancel() {
    if (this._anim) this._anim.cancel();
    this._anim = null;
    this.mode = null;
  }

  _end() {
    const mode = this.mode;
    this.cancel();
    if (mode === "fade") this.state.fade = 0;
    else if (mode === "appear") this.state.fade = 1;
    else this.state.decode = 1;
    if (!this.shown) this.state.fade = 0;
  }

  /** Advance by `dt` milliseconds. True while still transitioning. */
  step(dt) {
    if (!this._anim) return false;
    if (this.motionScale === 0) { this.finish(); return false; }
    this._t += dt;
    this._anim.seek(Math.min(this._t, this._duration), true);
    if (this._t >= this._duration) this._end();
    return this._anim !== null;
  }
}

/* ══════════════════════════════════════════════════════════════════════
   The label on the canvas
   ══════════════════════════════════════════════════════════════════════ */

const EMPTY = Object.freeze({ text: null, cipher: false, dim: false, marker: false });

function unitQuad() {
  return new PIXI.Geometry()
    .addAttribute("aVertexPosition", [0, 0, 1, 0, 1, 1, 0, 1], 2)
    .addAttribute("aUvs", [0, 0, 1, 0, 1, 1, 0, 1], 2)
    .addIndex([0, 1, 2, 0, 2, 3]);
}

/**
 * One token's label: the name raster, the glyph run (cipher or decode), the GM's
 * marker and the hairline rules, in one container on the host's unfiltered label
 * layer.
 *
 * Every public method only marks the label dirty; `flush()` rebuilds what changed
 * and nothing else, so a label that is not changing costs nothing per frame.
 */
export class NameLabel {
  constructor({ seed = 0, motionScale = 1 } = {}) {
    this.seed = seed;
    this.motion = new LabelMotion({ motionScale });
    this.content = EMPTY;
    this.geo = null;
    this.scale = 1;
    this.res = 1;
    /** How present the label is at its current on-screen size (zoomFade). */
    this.fade = 1;
    /** This label's own clock, in ms. Advances only while it is stepped. */
    this.clock = 0;
    this.fit = null;
    this.raster = null;
    this.flurryOn = true;
    this.renderable = true;
    this._epoch = 0;
    this._dirty = true;
    this._glyphStamp = null;
    this._markerStamp = null;

    this.group = new PIXI.Container();
    this.group.eventMode = "none";
    this.group.visible = false;
    this.nameMesh = null;
    this.glyphMesh = null;
    this.markerMesh = null;
    this.rules = [];
    this._ink = new Float32Array(hexToRgbFloat(NAME_INK.text));
    this._edge = new Float32Array(hexToRgbFloat(NAME_INK.edge));
    this._markerInk = new Float32Array(hexToRgbFloat(NAME_INK.marker));
  }

  get motionScale() { return this.motion.motionScale; }
  set motionScale(v) {
    this.motion.motionScale = v;
    if (v === 0) this.motion.finish();
    this._dirty = true;
  }

  get shown() { return this.motion.shown; }

  /** True while a standing cipher on screen needs its flurry clock. */
  get flurryArmed() {
    return this.content.cipher && this.motion.drawn && this.renderable && this.fade > 0
      && this.motionScale > 0 && this.flurryOn;
  }

  get hot() { return this.motion.hot || this.flurryArmed; }

  /**
   * What the label says. `next` is a decision from `mystify.mjs`: a player's
   * decision for a hidden creature has `text: null`, and this is where that
   * becomes a label that holds no name — the raster is released with it.
   */
  setContent(next, { animate = false } = {}) {
    const c = {
      text: next?.text ?? null, cipher: !next?.text && !!next?.cipher, dim: !!next?.dim, marker: !!next?.marker,
    };
    const prev = this.content;
    if (prev.text === c.text && prev.cipher === c.cipher && prev.dim === c.dim && prev.marker === c.marker) return;
    const identify = shouldIdentify(prev, c) && this.motion.shown && this.motion.drawn;
    this.content = c;
    if (prev.text !== c.text) this.dropRaster();
    if (prev.text !== c.text || prev.marker !== c.marker) this.fit = null;
    if (identify) this.motion.identify(animate);
    /* Losing the name mid-decode stops the decode at once: a decode never runs
       over a label that no longer holds a name it is allowed to draw. */
    else if (!c.text && this.motion.decoding) this.motion.finish();
    this._dirty = true;
  }

  show(animate = false) { this.motion.show(animate); this._dirty = true; }
  hide(animate = false) { this.motion.hide(animate); this._dirty = true; }

  setGeometry(geo) {
    const g = this.geo;
    if (!g || !geo || g.cap !== geo.cap || g.textMax !== geo.textMax || g.centred !== geo.centred) this.fit = null;
    this.geo = geo;
    this._dirty = true;
  }

  /** The canvas's zoom and the renderer's resolution: raster bucket, hairline, fade. */
  view(scale, res) {
    if (scale === this.scale && res === this.res) return;
    this.scale = scale;
    this.res = res;
    this._dirty = true;
  }

  setRenderable(on) {
    if (this.renderable === on) return;
    this.renderable = on;
    this.group.renderable = on;
  }

  /**
   * Advance by `dt`. `flurry` and `decode` are the host's shed gates. Returns true
   * while the label still wants frames.
   */
  step(dt, { flurry = true, decode = true } = {}) {
    this.flurryOn = !!flurry;
    const moving = this.motion.hot;
    if (!moving && !this.flurryArmed) { this.flush(); return false; }
    this.clock += dt;
    if (moving) {
      if (!decode && this.motion.decoding) this.motion.finish();
      else this.motion.step(dt);
      this._dirty = true;
    }
    if (this.flurryArmed) {
      const period = NAME_TIMING.flurryMs / Math.max(this.motionScale, 1e-3);
      const e = flurryEpoch(this.clock, this.seed, period);
      if (e !== this._epoch) { this._epoch = e; this._dirty = true; }
    }
    this.flush();
    return this.hot;
  }

  /** Rebuild whatever changed. Cheap when nothing did. */
  flush() {
    if (!this._dirty) return;
    this._dirty = false;
    const g = this.geo;
    const c = this.content;
    this.fade = g ? zoomFade(g.cap * this.scale * this.res) : 0;
    const on = !!g && this.motion.drawn && this.fade > 0 && (!!c.text || c.cipher);
    this.group.visible = on;
    if (!on) return;

    const alpha = this.motion.state.fade * this.fade;
    const mode = c.text ? "text" : "cipher";
    if (mode === "text" && !this.fit) {
      this.fit = fitLabel(displayText(c.text), { cap: g.cap, maxWidth: textRoom(g, c), measure: measureEm, capRatio: capRatio() });
    }
    const fit = mode === "text" ? this.fit : null;
    const adv = g.cap * CIPHER_ADVANCE_OF_CAP;
    const tick = Math.floor(this.clock / Math.max(1, NAME_TIMING.scrambleMs * this.motionScale));
    const comp = composeLabel({
      mode, fit, seed: this.seed, epoch: this._epoch, tick, decode: this.motion.state.decode,
      identify: this.motion.mode === "identify", adv, maxWidth: textRoom(g, c),
    });

    const left = g.centred ? g.centre - comp.final / 2 : g.left;
    const dim = c.dim ? NAME_INK.gmDim : 1;
    const rest = hexToRgbFloat(NAME_INK.text);
    for (let i = 0; i < 3; i++) this._ink[i] = rest[i] * dim;

    this.drawName(fit, comp.cut, left, g, alpha);
    this.drawGlyphs(comp.glyphs, left, g, alpha);
    let end = comp.end;
    if (c.marker && end > 0) end = this.drawMarker(left + end, g, alpha) - left;
    else if (this.markerMesh) this.markerMesh.visible = false;
    this.drawRules(left, end, comp.final, g, alpha);
  }

  drawName(fit, cut, left, g, alpha) {
    if (!fit?.text || !(cut > 0) || !this.content.text) {
      if (this.nameMesh) this.nameMesh.visible = false;
      return;
    }
    const font = (g.cap / capRatio()) * fit.scale;
    const px = rasterBucket(font * this.scale * this.res);
    if (!this.raster || this.raster.px !== px || this.raster.text !== fit.text) {
      const next = acquireRaster(fit.text, px);
      releaseRaster(this.raster);
      this.raster = next;
    }
    const info = this.raster.info;
    const k = font / px;
    if (!this.nameMesh) {
      const shader = PIXI.Shader.from(NAME_VERTEX_SHADER, NAME_FRAGMENT_SHADER, {
        uTex: PIXI.Texture.EMPTY, uInk: this._ink, uEdge: this._edge, uOpacity: 1, uCut: 2, uSoft: 0.01,
      });
      this.nameMesh = new PIXI.Mesh(unitQuad(), shader);
      this.nameMesh.blendMode = PIXI.BLEND_MODES?.NORMAL ?? "normal";
      this.group.addChild(this.nameMesh);
    }
    const mesh = this.nameMesh;
    const u = mesh.shader.uniforms;
    u.uTex = this.raster.texture;
    u.uInk = this._ink;
    u.uOpacity = alpha;
    u.uSoft = 1 / info.width;
    u.uCut = cut >= fit.width - 1e-6 ? 2 : (info.textX + cut / k) / info.width;
    mesh.position.set(left - info.textX * k, g.baseline - info.baselineY * k);
    mesh.scale.set(info.width * k, info.height * k);
    mesh.visible = true;
  }

  drawGlyphs(glyphs, left, g, alpha) {
    if (!glyphs.length) {
      if (this.glyphMesh) this.glyphMesh.visible = false;
      return;
    }
    const stamp = g.cap.toFixed(3) + "|" + glyphs.map((q) => q.ch + q.cx.toFixed(2)).join(",");
    if (stamp !== this._glyphStamp || !this.glyphMesh) {
      this._glyphStamp = stamp;
      this.glyphMesh = this.swapRun(this.glyphMesh, cipherGeometry(getCipherAtlas(), glyphs, g.cap));
    }
    if (!this.glyphMesh) return;
    const u = this.glyphMesh.shader.uniforms;
    u.uInk = this._ink;
    u.uOpacity = alpha;
    this.glyphMesh.position.set(left, g.capMid);
    this.glyphMesh.visible = true;
  }

  /** The GM's "players see a cipher" marker. Returns the world x it ends at. */
  drawMarker(x, g, alpha) {
    const size = NAME_LAYOUT.markerOfCap;
    const half = (g.cap * size * CIPHER_ADVANCE_OF_CAP) / 2;
    const cx = g.cap * NAME_LAYOUT.markerGapOfCap + half;
    const stamp = g.cap.toFixed(3);
    if (stamp !== this._markerStamp || !this.markerMesh) {
      this._markerStamp = stamp;
      this.markerMesh = this.swapRun(this.markerMesh,
        cipherGeometry(getCipherAtlas(), [{ ch: GM_MARKER, cx }], g.cap, size));
    }
    if (!this.markerMesh) return x;
    const u = this.markerMesh.shader.uniforms;
    u.uInk = this._markerInk;
    u.uOpacity = alpha;
    this.markerMesh.position.set(x, g.capMid);
    this.markerMesh.visible = true;
    return x + markerSpan(g.cap);
  }

  /**
   * The hairlines. Their thickness is `rulePx` DEVICE pixels, converted through
   * the canvas zoom and the renderer resolution — a world-sized hairline is two
   * pixels on a retina display and sub-pixel on an ordinary one, where it simply
   * is not there.
   */
  drawRules(left, end, final, g, alpha) {
    const thick = NAME_LAYOUT.rulePx / Math.max(1e-6, this.scale * this.res);
    const spans = [];
    if (g.centred) {
      const l = g.centre - final / 2;
      const r = g.centre + final / 2;
      if (g.flank > 0 && final > 0) {
        spans.push([l - g.flankGap - g.flank, l - g.flankGap], [r + g.flankGap, r + g.flankGap + g.flank]);
      }
    } else {
      const x0 = left + end + g.ruleGap;
      if (g.ruleStop - x0 >= g.cap * NAME_LAYOUT.ruleMinOfCap) spans.push([x0, g.ruleStop]);
    }
    while (this.rules.length < spans.length) {
      const s = new PIXI.Sprite(PIXI.Texture.WHITE);
      s.anchor.set(0, 0.5);
      s.tint = hexToInt(NAME_INK.rule);
      s.eventMode = "none";
      this.rules.push(s);
      this.group.addChild(s);
    }
    this.rules.forEach((s, i) => {
      const span = spans[i];
      s.visible = !!span;
      if (!span) return;
      s.position.set(span[0], g.capMid);
      s.width = span[1] - span[0];
      s.height = thick;
      s.alpha = alpha * NAME_INK.ruleAlpha;
    });
  }

  /** Replace a glyph run's geometry, creating the mesh on first use. */
  swapRun(mesh, geometry) {
    if (!geometry) { if (mesh) mesh.visible = false; return mesh; }
    if (!mesh) {
      const shader = PIXI.Shader.from(TEXT_VERTEX_SHADER, TEXT_FRAGMENT_SHADER, {
        uAtlas: getCipherAtlas().texture, uInk: this._ink, uEdge: this._edge, uOpacity: 1,
      });
      mesh = new PIXI.Mesh(geometry, shader);
      mesh.blendMode = PIXI.BLEND_MODES?.NORMAL ?? "normal";
      this.group.addChild(mesh);
      return mesh;
    }
    const old = mesh.geometry;
    mesh.geometry = geometry;
    old?.destroy();
    return mesh;
  }

  /** Let go of the name raster. Called whenever the label stops holding that name. */
  dropRaster() {
    releaseRaster(this.raster);
    this.raster = null;
    if (this.nameMesh) {
      this.nameMesh.shader.uniforms.uTex = PIXI.Texture.EMPTY;
      this.nameMesh.visible = false;
    }
  }

  destroy() {
    this.motion.cancel();
    releaseRaster(this.raster);
    this.raster = null;
    this.group.destroy({ children: true });
  }
}
