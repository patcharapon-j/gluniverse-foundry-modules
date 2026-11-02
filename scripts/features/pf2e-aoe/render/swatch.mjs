/**
 * Spellglass — a swatch of a look, for the GM's forms.
 *
 * The profile manager, the Region sheet and the creator each show what an
 * effect will look like before it is placed: a square of floor in the area's
 * own language (ink veil, body tint, the function's pattern on its shadow, the
 * inner edge light, the rim and the corner cuts) painted on a plain 2D canvas
 * from the same look tables and pattern recipes the canvas renderer uses. A
 * dropdown of names is a guess; a swatch is the answer.
 *
 * Pure apart from creating scratch canvases through the element it is handed:
 * no PIXI and nothing that reads the world.
 */

import { PALETTE } from "../../../core/theme.mjs";
import { INK_HEX, SIZES } from "./look.mjs";
import { paintPattern } from "./patterns.mjs";

const RIM_DASH = Object.freeze({ dashed: [3, 2], dotted: [0.2, 1.4], chain: [2.4, 1.2], tape: [2, 2] });

/** The pattern tile tinted to `color`, on a scratch canvas from `doc`. */
function tinted(doc, id, size, color) {
  const off = doc.createElement("canvas");
  off.width = off.height = size;
  const ctx = off.getContext("2d");
  paintPattern(ctx, id, size);
  ctx.globalCompositeOperation = "source-in";
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, size, size);
  return off;
}

/**
 * Paint `look` (composeLook() output) into a 2D context `ctx` of `size`
 * device pixels square. `doc` makes the scratch canvases (a Document).
 */
export function paintSwatch(ctx, look, size, doc = globalThis.document) {
  const S = Math.max(16, Math.round(size));
  const u = S / 64; // one swatch unit: the drawing is laid out on a 64 grid
  ctx.save();
  ctx.clearRect(0, 0, S, S);

  /* The floor: the suite's raised ink, so the veil and tint read as they do
     on a dark map. */
  ctx.globalAlpha = 1;
  ctx.fillStyle = PALETTE.ink3;
  ctx.fillRect(0, 0, S, S);
  ctx.globalAlpha = look.veil;
  ctx.fillStyle = INK_HEX;
  ctx.fillRect(0, 0, S, S);
  ctx.globalAlpha = Math.min(0.9, look.fill * 1.8);
  ctx.fillStyle = look.body;
  ctx.fillRect(0, 0, S, S);

  /* One tile per swatch reads at a glance; a two-square span is shown at its
     own scale so fog still looks like fog. */
  const tile = Math.round(S / Math.max(1, look.span === 2 ? 0.75 : 1));
  const shadow = tinted(doc, look.pattern, tile, INK_HEX);
  const lit = tinted(doc, look.pattern, tile, look.hot);
  ctx.globalAlpha = Math.min(0.8, look.patternAlpha * 0.95);
  ctx.drawImage(shadow, Math.max(1, u), Math.max(1, u));
  ctx.globalAlpha = Math.min(1, look.patternAlpha * 1.15);
  ctx.drawImage(lit, 0, 0);

  /* The inner edge light and the rim, inset so the swatch has a floor
     outside it like the area has on the map. */
  const inset = 7 * u;
  const w = S - inset * 2;
  ctx.globalAlpha = Math.min(1, SIZES.edgeAlpha[1] * look.glow * 1.4);
  ctx.strokeStyle = look.body;
  ctx.lineWidth = 6 * u;
  ctx.strokeRect(inset + 3 * u, inset + 3 * u, w - 6 * u, w - 6 * u);

  ctx.globalAlpha = 0.85;
  ctx.strokeStyle = INK_HEX;
  ctx.lineWidth = (look.rimPx + SIZES.keylinePx * 2) * u * 0.9;
  ctx.strokeRect(inset, inset, w, w);
  ctx.globalAlpha = look.rimAlpha;
  ctx.strokeStyle = look.rim === "tape" ? look.accent : look.hot;
  ctx.lineWidth = look.rimPx * u * 0.9;
  const dash = RIM_DASH[look.rim];
  if (dash && typeof ctx.setLineDash === "function") {
    ctx.lineCap = look.rim === "dotted" ? "round" : "butt";
    ctx.setLineDash(dash.map((d) => d * look.rimPx * u));
  }
  ctx.strokeRect(inset, inset, w, w);
  if (typeof ctx.setLineDash === "function") ctx.setLineDash([]);
  if (look.rim === "double") {
    ctx.strokeStyle = INK_HEX;
    ctx.lineWidth = look.rimPx * u * 0.35;
    ctx.strokeRect(inset, inset, w, w);
  }

  if (look.cuts) {
    const arm = 7 * u;
    ctx.globalAlpha = 1;
    ctx.lineCap = "round";
    for (const [width, color] of [[(SIZES.tickPx + 2.6) * u * 0.9, INK_HEX], [SIZES.tickPx * u * 0.9, look.accent]]) {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      for (const [cx, cy, sx, sy] of [[inset, inset, 1, 1], [inset + w, inset, -1, 1], [inset + w, inset + w, -1, -1], [inset, inset + w, 1, -1]]) {
        ctx.moveTo(cx + sx * arm, cy);
        ctx.lineTo(cx, cy + sy * arm);
      }
      ctx.stroke();
    }
  }
  ctx.restore();
}

/** Size a <canvas> element for its CSS box and the display, then paint. */
export function paintSwatchElement(element, look) {
  if (!element?.getContext || !look) return;
  const css = Number(element.dataset?.size) || element.clientWidth || 64;
  const size = Math.round(css * Math.min(3, Math.max(1, globalThis.devicePixelRatio || 1)));
  if (element.width !== size) element.width = size;
  if (element.height !== size) element.height = size;
  const ctx = element.getContext("2d");
  if (ctx) paintSwatch(ctx, look, size, element.ownerDocument ?? globalThis.document);
  element.dataset.fn = look.fn;
  element.dataset.material = look.material;
}
