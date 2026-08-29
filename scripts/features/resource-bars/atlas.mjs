/**
 * GLUniverse Suite — resource bars: the numeral atlas.
 *
 * Numbers on a token bar change constantly, and the obvious way to draw them —
 * `PIXI.Text`, or a canvas `fillText` into a texture — re-rasterises and
 * re-uploads a texture *every time the string changes*. That is one GPU upload
 * per token per damage roll, in a feature whose whole reason for being a shader
 * was to avoid exactly that kind of per-change cost.
 *
 * So the glyphs are baked once into an atlas and every number after that is a
 * geometry rebuild: a handful of quads with different UVs, no texture traffic.
 *
 * The outline is baked in too, in its own channel — the stroke is drawn in red
 * and the glyph body in green — so the shader can tint the numeral (white for a
 * value, red or green for a floating delta) without tinting the dark outline
 * that keeps it legible against a bright fill.
 */

import { PRECISION } from "./shader.mjs";

const GLYPHS = "0123456789/+-";
const CELL_W = 72;
const CELL_H = 104;
const FONT_PX = 78;

/** The suite's numeral face, with the fallbacks Foundry can be counted on for. */
const FACE = '700 ' + FONT_PX + 'px Oxanium, "Google Sans Code", sans-serif';

let cached = null;

/** Build (once) the glyph atlas. */
export function getAtlas() {
  if (cached) return cached;

  const canvas = document.createElement("canvas");
  canvas.width = CELL_W * GLYPHS.length;
  canvas.height = CELL_H;
  const ctx = canvas.getContext("2d");
  ctx.font = FACE;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";

  const metrics = {};
  for (let i = 0; i < GLYPHS.length; i++) {
    const ch = GLYPHS[i];
    const cx = i * CELL_W + CELL_W / 2;
    ctx.lineWidth = 9;
    ctx.strokeStyle = "rgba(255,0,0,1)";
    ctx.strokeText(ch, cx, CELL_H / 2);
    ctx.fillStyle = "rgba(0,255,0,1)";
    ctx.fillText(ch, cx, CELL_H / 2);
    metrics[ch] = {
      advance: ctx.measureText(ch).width / FONT_PX,
      u0: (i * CELL_W) / canvas.width,
      u1: ((i + 1) * CELL_W) / canvas.width,
    };
  }

  const texture = PIXI.Texture.from(canvas);
  texture.baseTexture.scaleMode = PIXI.SCALE_MODES?.LINEAR ?? texture.baseTexture.scaleMode;

  /* How far a digit's ink sits below the cell centre, as a fraction of the
     cell. Baked rather than guessed because it is what bottom-alignment is
     measured against: with textBaseline "middle" the *cell* centres line up but
     the ink does not, so aligning cell bottoms puts a small run visibly lower
     than the big one it is supposed to sit level with. The difference is a
     couple of pixels, which is exactly the size at which it reads as a mistake
     rather than as a style. */
  const inkM = ctx.measureText("0");
  const inkDrop = Number.isFinite(inkM.actualBoundingBoxDescent)
    ? inkM.actualBoundingBoxDescent / CELL_H
    : 0.26;

  cached = { texture, metrics, cellRatio: CELL_W / CELL_H, cellH: CELL_H, fontPx: FONT_PX, inkDrop };
  return cached;
}

/** Drop the atlas so the next draw rebuilds it (font load, canvas teardown). */
export function resetAtlas() {
  cached?.texture?.destroy(true);
  cached = null;
}

/**
 * `aDim` carries per-glyph weight.
 *
 * A run is one mesh with one `uInk`, so this is the only way to draw one part
 * of a readout at a different strength from the rest without a second mesh, a
 * second draw call and a second geometry to keep in sync — for what is,
 * visually, one number. A single float per vertex costs nothing and keeps the
 * run atomic.
 *
 * The weight it carries is meant to be a *step*, not a fade: see the readout in
 * host.mjs for what the values are for.
 */
export const TEXT_VERTEX_SHADER = `
attribute vec2 aVertexPosition;
attribute vec2 aUvs;
attribute float aDim;
uniform mat3 translationMatrix;
uniform mat3 projectionMatrix;
varying vec2 vUv;
varying float vDim;
void main(void) {
  vUv = aUvs;
  vDim = aDim;
  gl_Position = vec4((projectionMatrix * translationMatrix * vec3(aVertexPosition, 1.0)).xy, 0.0, 1.0);
}`;

export const TEXT_FRAGMENT_SHADER = PRECISION + `
varying vec2 vUv;
varying float vDim;
uniform sampler2D uAtlas;
uniform vec3 uInk;
uniform vec3 uEdge;
uniform float uOpacity;
void main(void) {
  vec4 t = texture2D(uAtlas, vUv);
  /* Weight is applied to colour and alpha together because the output is
     premultiplied; scaling only one of them dims the glyph and leaves its
     outline at full strength, which reads as a smudge rather than as quieter
     text. */
  float a = t.a * uOpacity * vDim;
  /* The green channel is the glyph body, the red is its outline: tint one
     without tinting the other. */
  gl_FragColor = vec4(mix(uEdge, uInk, t.g) * a, a);
}`;

/**
 * Build the geometry for one right-aligned run, in local pixel coordinates
 * where y runs downward (PIXI's convention, unlike the shader's).
 *
 * @param {Array<{text: string, size: number, dim?: number, bottom?: boolean}>} parts
 *        `dim` is the part's weight, 1 = full strength. `bottom` sits the part's
 *        ink on the same line as the run's largest part instead of centring it.
 * @param {{right: number, mid: number, skew: number}} at
 * @returns {PIXI.Geometry|null}
 */
export function runGeometry(parts, { right, mid, skew }) {
  const atlas = getAtlas();
  const pos = [];
  const uvs = [];
  const dim = [];
  const idx = [];

  let total = 0;
  for (const part of parts)
    for (const ch of part.text) total += (atlas.metrics[ch]?.advance ?? 0.5) * part.size;

  /* The line the bottom-aligned parts sit on: the ink bottom of the run's
     largest part, which is the one that stays centred on `mid`. */
  let maxSize = 0;
  for (const part of parts) maxSize = Math.max(maxSize, part.size);
  const inkLine = mid + maxSize * (atlas.cellH / atlas.fontPx) * atlas.inkDrop;

  let penX = right - total;
  let n = 0;
  for (const part of parts) {
    const weight = Number.isFinite(part.dim) ? part.dim : 1;
    const gh = part.size * (atlas.cellH / atlas.fontPx);
    const gw = gh * atlas.cellRatio;
    for (const ch of part.text) {
      const m = atlas.metrics[ch];
      if (!m) continue;
      const adv = m.advance * part.size;
      const cx = penX + adv / 2;
      const x0 = cx - gw / 2, x1 = cx + gw / 2;
      const cy = part.bottom ? inkLine - gh * atlas.inkDrop : mid;
      const y0 = cy - gh / 2, y1 = cy + gh / 2;
      /* Sheared about the run's own mid-line, by the same amount as the bar.
         y grows downward here, so the sign is inverted relative to the shader —
         get this wrong and the numerals lean into the bar instead of with it. */
      const s0 = (mid - y0) * skew;
      const s1 = (mid - y1) * skew;
      pos.push(x0 + s0, y0, x1 + s0, y0, x1 + s1, y1, x0 + s1, y1);
      uvs.push(m.u0, 0, m.u1, 0, m.u1, 1, m.u0, 1);
      dim.push(weight, weight, weight, weight);
      idx.push(n, n + 1, n + 2, n, n + 2, n + 3);
      n += 4;
      penX += adv;
    }
  }

  if (!n) return null;
  return new PIXI.Geometry()
    .addAttribute("aVertexPosition", pos, 2)
    .addAttribute("aUvs", uvs, 2)
    .addAttribute("aDim", dim, 1)
    .addIndex(idx);
}
