/**
 * GLUniverse Suite — token conditions: the text atlas and the icon cache.
 *
 * Two caches, one file, because both exist for the same reason: a plate's
 * contents change whenever a condition ticks, and the obvious way to draw either
 * of them — `PIXI.Text` for the name, a fresh `Sprite` per icon — re-rasterises
 * and re-uploads a texture every time. In a forty-token encounter where three
 * creatures are counting down a duration, that is a GPU upload per plate per
 * round, in a feature whose whole reason for being a shader was to avoid exactly
 * that kind of per-change cost.
 *
 * ── Why this is not shared with the resource bar ─────────────────────────
 *
 * `features/resource-bars/atlas.mjs` bakes the same kind of atlas, and it is
 * tempting to import it. It would be wrong: every feature in this suite is
 * independently toggleable, and a feature that imports another one's internals
 * breaks the moment somebody turns that other one off — or, worse, quietly
 * keeps it half-loaded. Shared code lives in `core/`, and moving a text atlas
 * there is a refactor of a shipped feature that this change has no business
 * making.
 *
 * What actually has to agree between the two is the *typeface, the weight and
 * the baked outline*, and those are pinned here to the same values. The glyph
 * sets differ because the needs do: a bar prints numbers, a plate prints a name.
 */

import { PRECISION } from "./shader.mjs";

/* Uppercase only — every label this feature draws is a condition name set in
   caps, and carrying lowercase would double the atlas for glyphs nothing asks
   for. The digits and the three marks are for the counter tab and the tail. */
const GLYPHS = "0123456789+-/ABCDEFGHIJKLMNOPQRSTUVWXYZ' ";
const CELL_W = 72;
const CELL_H = 104;
const FONT_PX = 78;

/** The suite's display face, with the fallbacks Foundry can be counted on for. */
const FACE = '600 ' + FONT_PX + 'px Oxanium, "Google Sans Code", sans-serif';

let cached = null;

/** Build (once) the glyph atlas. */
export function getTextAtlas() {
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
    /* The outline goes in the red channel and the body in the green, so the
       shader can tint the glyph without tinting the dark edge that keeps it
       legible against a bright plate. */
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

  /* How far ink sits below the cell centre, as a fraction of the cell. Baked
     rather than guessed: with textBaseline "middle" the *cells* line up but the
     ink does not, and the couple of pixels between them is exactly the size at
     which it reads as a mistake rather than as a style. */
  const inkM = ctx.measureText("0");
  const inkDrop = Number.isFinite(inkM.actualBoundingBoxDescent)
    ? inkM.actualBoundingBoxDescent / CELL_H
    : 0.26;

  cached = { texture, metrics, cellRatio: CELL_W / CELL_H, cellH: CELL_H, fontPx: FONT_PX, inkDrop };
  return cached;
}

/** Drop the atlas so the next draw rebuilds it (font load, canvas teardown). */
export function resetTextAtlas() {
  cached?.texture?.destroy(true);
  cached = null;
}

/** The width one run would occupy, in the same units `runGeometry` lays out in. */
export function runWidth(parts) {
  const atlas = getTextAtlas();
  let total = 0;
  for (const part of parts) {
    const track = part.track ?? 0;
    for (const ch of part.text) total += (atlas.metrics[ch]?.advance ?? 0.5) * part.size + track;
  }
  return total;
}

/**
 * Build ONE geometry from several independently anchored runs.
 *
 * A plate draws two pieces of text with nothing in common: its name, set in the
 * text colour and running right from beside the sigil, and its counter, set in
 * near-black and centred on the tone tab the shader cut for it in the corner.
 * Laying them out as two meshes is the obvious arrangement and it doubles the
 * draw calls on the most numerous object in the feature — six plates on forty
 * tokens is 480 meshes rather than 240.
 *
 * So ink rides on a per-vertex attribute instead of on a uniform, which is what
 * lets two differently-coloured runs share one mesh. It is the same device the
 * resource bar uses to give a readout's denominator its own weight without a
 * second mesh, for the same reason: what is visually one label should be one
 * object.
 *
 * Coordinates are local pixels with y running downward — PIXI's convention,
 * which is the opposite of the fragment shader's.
 */
export function runsGeometry(runs) {
  const atlas = getTextAtlas();
  const pos = [];
  const uvs = [];
  const ink = [];
  const idx = [];
  let n = 0;

  for (const run of runs) {
    const parts = run.parts ?? [];
    if (!parts.length) continue;
    const total = runWidth(parts);
    let maxSize = 0;
    for (const part of parts) maxSize = Math.max(maxSize, part.size);
    const inkLine = run.mid + maxSize * (atlas.cellH / atlas.fontPx) * atlas.inkDrop;

    let penX = run.align === "right" ? run.x - total
      : run.align === "center" ? run.x - total / 2
      : run.x;

    for (const part of parts) {
      const track = part.track ?? 0;
      const gh = part.size * (atlas.cellH / atlas.fontPx);
      const gw = gh * atlas.cellRatio;
      const c = part.ink ?? run.ink ?? [1, 1, 1];
      for (const ch of part.text) {
        const m = atlas.metrics[ch];
        if (!m) { penX += (atlas.metrics[" "]?.advance ?? 0.3) * part.size + track; continue; }
        const adv = m.advance * part.size;
        const cx = penX + adv / 2;
        const x0 = cx - gw / 2, x1 = cx + gw / 2;
        const cy = part.bottom ? inkLine - gh * atlas.inkDrop : run.mid;
        const y0 = cy - gh / 2, y1 = cy + gh / 2;
        pos.push(x0, y0, x1, y0, x1, y1, x0, y1);
        uvs.push(m.u0, 0, m.u1, 0, m.u1, 1, m.u0, 1);
        ink.push(c[0], c[1], c[2], c[0], c[1], c[2], c[0], c[1], c[2], c[0], c[1], c[2]);
        idx.push(n, n + 1, n + 2, n, n + 2, n + 3);
        n += 4;
        penX += adv + track;
      }
    }
  }

  if (!n) return null;
  return new PIXI.Geometry()
    .addAttribute("aVertexPosition", pos, 2)
    .addAttribute("aUvs", uvs, 2)
    .addAttribute("aInk", ink, 3)
    .addIndex(idx);
}

/** One anchored run — the common case, and a thin wrapper over the above. */
export function runGeometry(parts, at) {
  return runsGeometry([{ parts, ...at }]);
}

export const TEXT_VERTEX_SHADER = `
attribute vec2 aVertexPosition;
attribute vec2 aUvs;
attribute vec3 aInk;
uniform mat3 translationMatrix;
uniform mat3 projectionMatrix;
varying vec2 vUv;
varying vec3 vInk;
void main(void) {
  vUv = aUvs;
  vInk = aInk;
  gl_Position = vec4((projectionMatrix * translationMatrix * vec3(aVertexPosition, 1.0)).xy, 0.0, 1.0);
}`;

export const TEXT_FRAGMENT_SHADER = PRECISION + `
varying vec2 vUv;
varying vec3 vInk;
uniform sampler2D uAtlas;
uniform vec3 uEdge;
uniform float uOpacity;
void main(void) {
  vec4 t = texture2D(uAtlas, vUv);
  /* Opacity multiplies colour and alpha together because the output is
     premultiplied; scaling only one dims the glyph and leaves its outline at
     full strength, which reads as a smudge rather than as quieter text. */
  float a = t.a * uOpacity;
  /* The green channel is the glyph body and the red its baked outline, so the
     ink tints one without touching the dark edge that keeps a name legible over
     a lit plate. */
  gl_FragColor = vec4(mix(uEdge, vInk, t.g) * a, a);
}`;

/* ══════════════════════════════════════════════════════════════════════════
   Icons
   ══════════════════════════════════════════════════════════════════════════ */

const icons = new Map();
let blank = null;

/**
 * A 1×1 transparent texture, so a plate whose art has not arrived yet draws its
 * chrome and nothing else rather than sampling whatever texture the previous
 * mesh left bound. A missing sigil is a plate with a gap in it; the wrong sigil
 * is a plate that lies.
 */
export function blankTexture() {
  if (blank) return blank;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  blank = PIXI.Texture.from(canvas);
  return blank;
}

/**
 * The texture for one item image, cached by path.
 *
 * Deliberately synchronous and deliberately tolerant: `Texture.from` hands back
 * a texture that is still loading, and PIXI swaps its contents in when it
 * arrives. A plate therefore appears immediately with its chrome, its tone and
 * its counter, and the sigil fades in a frame or two later — which is the right
 * order, because everything except the sigil is information the renderer
 * already had.
 */
export function getIconTexture(path) {
  if (!path) return blankTexture();
  const hit = icons.get(path);
  if (hit) return hit;
  let texture;
  try {
    texture = PIXI.Texture.from(path);
  } catch {
    return blankTexture();
  }
  if (texture?.baseTexture) {
    texture.baseTexture.scaleMode = PIXI.SCALE_MODES?.LINEAR ?? texture.baseTexture.scaleMode;
    /* The bevel samples a fraction of a cell above and below the glyph, which at
       the edge of the frame reads outside it. Clamping there returns the edge
       texel — a straight extension of the art — where a repeat would wrap the
       opposite side of the icon into the bevel and outline the sigil with a
       sliver of something else. */
    texture.baseTexture.wrapMode = PIXI.WRAP_MODES?.CLAMP ?? texture.baseTexture.wrapMode;
  }
  icons.set(path, texture);
  return texture;
}

/**
 * Release every cached icon.
 *
 * `destroy(false)` — the base texture is dropped but the underlying image is
 * left to the browser's own cache, because the same condition art reappears on
 * the next scene within seconds and re-decoding a webp per plate per scene
 * change is the one cost this cache exists to remove.
 */
export function resetIcons() {
  for (const texture of icons.values()) {
    try { texture.destroy(false); } catch { /* already gone with the renderer */ }
  }
  icons.clear();
}
