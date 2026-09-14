/**
 * GLUniverse Suite — resource bars: the words on a dying or dead bar.
 *
 * The numeral atlas carries digits and signs and nothing else, and "DYING" and
 * "DEAD" are words, in whatever language the table plays in. So each string is
 * rasterised once into a strip and the *bar shader* samples it, rather than a text
 * mesh drawing it over the bar. That is the design, not a convenience: the
 * ticker's letters are cut dark into the liquid and lit orchid in the empty
 * trough, so the fill's edge splits a letter as it passes — and only the program
 * that knows where the fill ends can draw that.
 *
 * Same channel code as the atlas and the names — red is the outline, green the
 * body — and uploaded premultiplied, so a sampled channel is its own coverage.
 *
 * Two kinds of strip:
 *
 *   the ticker   one repetition of "DYING 2 ◆", wrapping, so the shader scrolls it
 *                by moving one offset. A viewer who may not read numbers gets
 *                "DYING ◆": the value is never handed to the raster, so it cannot
 *                be sampled, cached or read back.
 *   DEAD         one run, clamped, centred by the shader.
 *
 * Both are resampled onto a power-of-two width so they can mip and repeat on any
 * WebGL, and the shader is handed each strip's *own* aspect, which undoes the
 * stretch. The mips are not optional: a 128px strip is read on a 19px bar.
 *
 * Layout is pure and runs under plain Node (the check tool drives it);
 * rasterising needs a document and never runs at import.
 */

import { cssVar } from "../../core/theme.mjs";

/**
 * The ticker's typography, in strip heights (1 = the strip's full height, which
 * the shader maps onto TICKER_BAND of the bar). The value is larger than the
 * word because it is the reading; the word is tracked out because at 19px a
 * tight word is a smear.
 */
export const TICKER_TEXT = Object.freeze({
  rasterH: 128,    // strip height in texture pixels, whatever the bar's size — a power of two, as the width is made
  lead: 0.30,      // before the word
  wordCap: 0.44,   // the word's cap height
  wordTrack: 0.16, // its tracking, in ems
  numGap: 0.20,    // between the word and the value
  numCap: 0.62,    // the value's cap height
  numTrack: 0.02,
  trail: 0.42,     // after the value, before the separator
  sepR: 0.07,      // the separator diamond's half-diagonal
  sepGap: 0.12,    // after the separator, to the next repetition's lead
  rim: 0.11,       // outline stroke width
});

/** DEAD's typography, in the same units. Wider tracking: it is a stamp, not a run. */
export const DEAD_TEXT = Object.freeze({ pad: 0.10, cap: 0.50, track: 0.26 });

/**
 * One repetition of the ticker. `value` is null for a viewer who may not read
 * numbers, and then no digit is laid out at all.
 */
export function tickerParts(word, value) {
  const parts = [{ gap: TICKER_TEXT.lead }, { text: String(word), cap: TICKER_TEXT.wordCap, track: TICKER_TEXT.wordTrack }];
  if (value !== null && value !== undefined)
    parts.push({ gap: TICKER_TEXT.numGap }, { text: String(value), cap: TICKER_TEXT.numCap, track: TICKER_TEXT.numTrack });
  parts.push({ gap: TICKER_TEXT.trail }, { sep: true }, { gap: TICKER_TEXT.sepGap });
  return parts;
}

/** The DEAD run. */
export function deadParts(word) {
  return [{ gap: DEAD_TEXT.pad }, { text: String(word), cap: DEAD_TEXT.cap, track: DEAD_TEXT.track }, { gap: DEAD_TEXT.pad }];
}

/**
 * Lay a strip out, in strip heights. `widthOf(text, cap, track)` measures one run
 * at that cap height. `centre` is the middle of the lettering (not of the strip)
 * as a fraction of the width — where the shader parks a still ticker.
 */
export function layoutStrip(parts, widthOf) {
  const items = [];
  let pen = 0, first = null, last = 0;
  for (const part of parts) {
    if (part.gap) { pen += part.gap; continue; }
    if (part.sep) {
      items.push({ sep: true, x: pen + TICKER_TEXT.sepR });
      pen += TICKER_TEXT.sepR * 2;
      continue;
    }
    const w = Math.max(0, widthOf(part.text, part.cap, part.track ?? 0));
    items.push({ ...part, x: pen, w });
    if (first === null) first = pen;
    last = pen + w;
    pen += w;
  }
  return { items, width: pen, centre: pen > 0 && first !== null ? (first + last) / 2 / pen : 0.5 };
}

/* ── Rasterising — needs a document ─────────────────────────────────────── */

const fontOf = (px) => "700 " + px.toFixed(2) + "px " + cssVar("--gl-display", "sans-serif");

/**
 * Rasterise one strip onto a power-of-two canvas. Returns the canvas, the strip's
 * own aspect (width over height, before the stretch), the lettering's centre and
 * the font string, for the load check.
 */
export function rasterStrip(parts, { doc = globalThis.document } = {}) {
  const H = TICKER_TEXT.rasterH;
  const probe = doc.createElement("canvas").getContext("2d");
  probe.font = fontOf(100);
  const hm = probe.measureText("H");
  const capRatio = Number.isFinite(hm.actualBoundingBoxAscent) && hm.actualBoundingBoxAscent > 0 ? hm.actualBoundingBoxAscent / 100 : 0.7;
  const setRun = (ctx, cap, track) => {
    const px = (cap * H) / capRatio;
    ctx.font = fontOf(px);
    if ("letterSpacing" in ctx) ctx.letterSpacing = (track * px).toFixed(2) + "px";
    return px;
  };
  const layout = layoutStrip(parts, (text, cap, track) => {
    const px = setRun(probe, cap, track);
    /* Canvas tracking follows every letter, the last included; a run ends at its ink. */
    return (probe.measureText(text).width - track * px) / H;
  });

  const src = doc.createElement("canvas");
  src.width = Math.max(1, Math.ceil(layout.width * H));
  src.height = H;
  const ctx = src.getContext("2d");
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.lineJoin = "round";
  /* Every outline first, then every body, so a neighbour's outline never lands on
     a letter. */
  for (const pass of ["rim", "body"]) {
    for (const it of layout.items) {
      if (it.sep) {
        const r = TICKER_TEXT.sepR * H, cx = it.x * H, cy = H / 2;
        ctx.beginPath();
        ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r, cy); ctx.lineTo(cx, cy + r); ctx.lineTo(cx - r, cy);
        ctx.closePath();
        if (pass === "rim") { ctx.lineWidth = TICKER_TEXT.rim * H; ctx.strokeStyle = "rgb(255,0,0)"; ctx.stroke(); }
        else { ctx.fillStyle = "rgba(0,255,0,0.75)"; ctx.fill(); }
        continue;
      }
      setRun(ctx, it.cap, it.track ?? 0);
      /* Cap height centred on the strip's mid-line. */
      const y = H / 2 + (it.cap * H) / 2;
      if (pass === "rim") {
        ctx.lineWidth = TICKER_TEXT.rim * H;
        ctx.strokeStyle = "rgb(255,0,0)";
        ctx.strokeText(it.text, it.x * H, y);
      } else {
        ctx.fillStyle = "rgb(0,255,0)";
        ctx.fillText(it.text, it.x * H, y);
      }
    }
  }

  const pot = doc.createElement("canvas");
  pot.width = 2 ** Math.ceil(Math.log2(Math.max(2, src.width)));
  pot.height = H;
  pot.getContext("2d").drawImage(src, 0, 0, pot.width, H);
  return { canvas: pot, aspect: src.width / H, centre: layout.centre, font: fontOf(64) };
}

/* ── The strip cache ─────────────────────────────────────────────────────
   Keyed on the exact string and kind, and reference-counted. A strip is only
   ever asked for with the text a viewer may see, so a player's cache never holds
   a dying value their number permission refuses. */

const strips = new Map();
let listener = null;
let waiting = false;

/** The cache key for a strip. */
export function stripKey(kind, text) {
  return kind + "|" + text;
}

/** Called after the display face loads and every strip has been redrawn in place. */
export function onStripsChanged(fn) {
  listener = fn;
}

/**
 * The strip for `parts`, as `{ texture, aspect, centre }` — created on first use.
 * `repeat` for the ticker (it wraps), not for DEAD.
 */
export function acquireStrip(key, parts, repeat) {
  let r = strips.get(key);
  if (!r) {
    const info = rasterStrip(parts);
    const texture = PIXI.Texture.from(info.canvas);
    const base = texture.baseTexture;
    base.scaleMode = PIXI.SCALE_MODES?.LINEAR ?? base.scaleMode;
    base.mipmap = PIXI.MIPMAP_MODES?.ON ?? base.mipmap;
    base.wrapMode = repeat ? (PIXI.WRAP_MODES?.REPEAT ?? base.wrapMode) : (PIXI.WRAP_MODES?.CLAMP ?? base.wrapMode);
    r = { key, parts, canvas: info.canvas, texture, aspect: info.aspect, centre: info.centre, refs: 0 };
    strips.set(key, r);
    awaitFont(info.font);
  }
  r.refs++;
  return r;
}

export function releaseStrip(r) {
  if (!r || strips.get(r.key) !== r) return;
  r.refs--;
  if (r.refs > 0) return;
  r.texture.destroy(true);
  strips.delete(r.key);
}

/** Drop every strip (canvas teardown). */
export function resetStrips() {
  for (const r of strips.values()) r.texture.destroy(true);
  strips.clear();
}

/**
 * The display face is a web font, and a strip rasterised before it loads is
 * baked in the fallback for as long as the strip lives. So the first strip drawn
 * against an unloaded face waits for it, then redraws every strip into its own
 * canvas and re-uploads — the textures the bars hold stay valid — and tells the
 * host, whose settled bars would otherwise keep their old aspect until something
 * next moved them.
 */
function awaitFont(font) {
  const fonts = globalThis.document?.fonts;
  if (waiting || typeof fonts?.check !== "function" || typeof fonts.load !== "function") return;
  let ready = true;
  try { ready = fonts.check(font); } catch { return; }
  if (ready) return;
  waiting = true;
  fonts.load(font).then(() => {
    waiting = false;
    for (const r of strips.values()) {
      const next = rasterStrip(r.parts);
      r.canvas.width = next.canvas.width;
      r.canvas.height = next.canvas.height;
      r.canvas.getContext("2d").drawImage(next.canvas, 0, 0);
      r.aspect = next.aspect;
      r.centre = next.centre;
      r.texture.baseTexture.resource?.update?.();
    }
    listener?.();
  }, () => { waiting = false; });
}
