/**
 * GLUniverse Suite — resource bars: the cipher glyph atlas.
 *
 * A cipher re-rolls a couple of glyphs every few seconds on every unknown
 * creature on the map, and decodes change a glyph every few dozen milliseconds.
 * Rasterising a label per change would be one texture upload per token per beat
 * — exactly the per-change GPU cost `atlas.mjs` exists to avoid for the numerals.
 * So the cipher's glyphs are baked once here and a flurry is a geometry rebuild.
 *
 * Same channel convention as the numeral atlas — outline in red, glyph body in
 * green — so the run is drawn with `atlas.mjs`'s own text shader and tints
 * without tinting the outline that keeps it legible over a battlemap.
 *
 * Nothing here runs at import: the atlas is baked on first use, inside a world.
 */

import { cssVar } from "../../core/theme.mjs";
import { CIPHER_GLYPHS, CIPHER_QUERY } from "./mystify.mjs";

/** Cell and font sizes of the bake, in atlas pixels. */
export const CIPHER_ATLAS = Object.freeze({ cellW: 64, cellH: 88, fontPx: 56, strokePx: 6, weight: 600 });

/**
 * The run's advance, as a multiple of the label's cap height.
 *
 * Uniform rather than per-glyph on purpose: a flurry swaps a `?` for a `░`, and
 * with proportional advances every glyph after it would shuffle sideways and
 * drag the rule with it — a label that twitches every four seconds.
 */
export const CIPHER_ADVANCE_OF_CAP = 1.12;

let cached = null;

/**
 * Bake the atlas onto a canvas.
 *
 * `paint` draws real colours instead of the channel code; only the preview
 * harness passes it, because it composites with Canvas2D and has no shader to
 * decode the channels with. Everything else about the bake is shared.
 */
export function bakeCipherAtlas({ doc = globalThis.document, paint = null } = {}) {
  const glyphs = Array.from(CIPHER_GLYPHS);
  const { cellW, cellH, fontPx, strokePx, weight } = CIPHER_ATLAS;
  const canvas = doc.createElement("canvas");
  canvas.width = cellW * glyphs.length;
  canvas.height = cellH;
  const ctx = canvas.getContext("2d");
  ctx.font = weight + " " + fontPx + "px " + cssVar("--gl-tech", "monospace");
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.lineJoin = "round";

  /* Every glyph shares one baseline, placed so the `?` — the glyph a cipher is a
     third made of — has its ink centred in the cell. The cell centre then *is*
     the label's cap mid-line, which is the only vertical fact the layout knows. */
  const q = ctx.measureText(CIPHER_QUERY);
  const asc = Number.isFinite(q.actualBoundingBoxAscent) ? q.actualBoundingBoxAscent : fontPx * 0.72;
  const desc = Number.isFinite(q.actualBoundingBoxDescent) ? q.actualBoundingBoxDescent : 0;
  const capPx = Math.max(1, asc + desc);
  const baseY = cellH / 2 + (asc - desc) / 2;

  const metrics = {};
  glyphs.forEach((ch, i) => {
    const cx = i * cellW + cellW / 2;
    ctx.lineWidth = strokePx;
    ctx.strokeStyle = paint ? paint.edge : "rgba(255,0,0,1)";
    ctx.strokeText(ch, cx, baseY);
    ctx.fillStyle = paint ? paint.ink : "rgba(0,255,0,1)";
    ctx.fillText(ch, cx, baseY);
    metrics[ch] = { x: i * cellW, u0: (i * cellW) / canvas.width, u1: ((i + 1) * cellW) / canvas.width };
  });

  return { canvas, glyphs, metrics, cellW, cellH, capPx };
}

/** The atlas and its texture, built once per canvas lifetime. */
export function getCipherAtlas() {
  if (cached) return cached;
  const baked = bakeCipherAtlas();
  const texture = PIXI.Texture.from(baked.canvas);
  texture.baseTexture.scaleMode = PIXI.SCALE_MODES?.LINEAR ?? texture.baseTexture.scaleMode;
  cached = { ...baked, texture };
  return cached;
}

/** Drop the atlas so the next draw rebuilds it (canvas teardown, font load). */
export function resetCipherAtlas() {
  cached?.texture?.destroy(true);
  cached = null;
}

/**
 * Geometry for a glyph run in label-local coordinates: x from the label's left
 * edge, y from its cap mid-line. Carries `aDim` because the text shader it is
 * drawn with expects one.
 *
 * @param {object} atlas   from getCipherAtlas()
 * @param {Array<{ch: string, cx: number}>} glyphs  glyph centres, world units
 * @param {number} cap     the label's cap height, world units
 * @param {number} [sizeOfCap=1]  glyph size relative to the cap (the GM marker is smaller)
 */
export function cipherGeometry(atlas, glyphs, cap, sizeOfCap = 1) {
  const k = (cap * sizeOfCap) / atlas.capPx;
  const gw = atlas.cellW * k;
  const gh = atlas.cellH * k;
  const pos = [];
  const uvs = [];
  const dim = [];
  const idx = [];
  let n = 0;
  for (const g of glyphs) {
    const m = atlas.metrics[g.ch];
    if (!m) continue;
    const x0 = g.cx - gw / 2, x1 = g.cx + gw / 2;
    const y0 = -gh / 2, y1 = gh / 2;
    pos.push(x0, y0, x1, y0, x1, y1, x0, y1);
    uvs.push(m.u0, 0, m.u1, 0, m.u1, 1, m.u0, 1);
    dim.push(1, 1, 1, 1);
    idx.push(n, n + 1, n + 2, n, n + 2, n + 3);
    n += 4;
  }
  if (!n) return null;
  return new PIXI.Geometry()
    .addAttribute("aVertexPosition", pos, 2)
    .addAttribute("aUvs", uvs, 2)
    .addAttribute("aDim", dim, 1)
    .addIndex(idx);
}
