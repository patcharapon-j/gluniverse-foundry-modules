/**
 * Diorama editor — read the map art and the walls of a scene.
 *
 * `sampleColours(scene)` draws the level background over the scene rect on an
 * offscreen canvas at SAMPLE_PX px per sub-cell and averages each block, giving
 * one RGB per sub-cell over the WHOLE grid (padding included, where it reads
 * black). The magic wand and Auto setup both work from that.
 *
 * The image Foundry already loaded for the canvas is preferred (no second
 * download, and it is CORS-clean if it rendered at all); a fresh
 * `crossOrigin = "anonymous"` load is the fallback. A canvas tainted by a
 * cross-origin image without CORS headers cannot be read: that comes back as
 * `{ error: "tainted" }`, never as a throw.
 *
 * Nothing here runs at import.
 */

import { SUB } from "../constants.mjs";
import { gridOf } from "../terrain/store.mjs";
import { warn } from "../../../core/const.mjs";

/** Samples per sub-cell per axis before averaging. */
const SAMPLE_PX = 4;
/** Largest offscreen canvas side we allocate. */
const MAX_SIDE = 4096;

/** The art the terrain is painted over (v14: the initial Level's background). */
export function backgroundSrc(scene) {
  return scene?.initialLevel?.background?.src || scene?.background?.src || null;
}

const drawable = (el) => !!el && (
  (typeof HTMLImageElement !== "undefined" && el instanceof HTMLImageElement && el.naturalWidth > 0)
  || (typeof HTMLCanvasElement !== "undefined" && el instanceof HTMLCanvasElement)
  || (typeof HTMLVideoElement !== "undefined" && el instanceof HTMLVideoElement && el.videoWidth > 0)
  || (typeof ImageBitmap !== "undefined" && el instanceof ImageBitmap));

/** Load the background as something drawImage accepts. */
export async function loadBackground(src) {
  if (!src) return null;
  try {
    const getTexture = globalThis.foundry?.canvas?.getTexture ?? globalThis.getTexture;
    const el = getTexture?.(src)?.baseTexture?.resource?.source;
    if (drawable(el)) return el;
  } catch { /* not cached */ }
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/**
 * Per-sub-cell RGB averages of the scene's map art.
 * @param {Scene} scene
 * @returns {Promise<{colours: Uint8Array, w: number, h: number} | {error: "none"|"load"|"tainted"}>}
 */
export async function sampleColours(scene) {
  const src = backgroundSrc(scene);
  if (!src) return { error: "none" };
  const img = await loadBackground(src);
  if (!img) return { error: "load" };
  const g = gridOf(scene);
  const w = g.cols * SUB, h = g.rows * SUB;
  let px = SAMPLE_PX;
  while (px > 1 && (w * px > MAX_SIDE || h * px > MAX_SIDE)) px--;
  const cv = document.createElement("canvas");
  cv.width = Math.min(MAX_SIDE, w * px);
  cv.height = Math.min(MAX_SIDE, h * px);
  const ctx = cv.getContext("2d", { willReadFrequently: true });
  ctx.clearRect(0, 0, cv.width, cv.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  const k = (SUB * px) / g.size;
  const r = g.sceneRect;
  try {
    ctx.drawImage(img, r.x * k, r.y * k, r.width * k, r.height * k);
  } catch (e) {
    warn("diorama | editor could not draw the map art", e);
    return { error: "load" };
  }
  let data;
  try {
    data = ctx.getImageData(0, 0, cv.width, cv.height).data;
  } catch {
    return { error: "tainted" };
  }
  const colours = new Uint8Array(w * h * 3);
  const W = cv.width;
  for (let si = 0; si < h; si++) {
    for (let sj = 0; sj < w; sj++) {
      let r0 = 0, g0 = 0, b0 = 0, n = 0;
      const y0 = si * px, x0 = sj * px;
      for (let dy = 0; dy < px; dy++) {
        const y = y0 + dy;
        if (y >= cv.height) break;
        for (let dx = 0; dx < px; dx++) {
          const x = x0 + dx;
          if (x >= W) break;
          const o = (y * W + x) * 4;
          r0 += data[o]; g0 += data[o + 1]; b0 += data[o + 2]; n++;
        }
      }
      const o = (si * w + sj) * 3;
      if (n) { colours[o] = r0 / n; colours[o + 1] = g0 / n; colours[o + 2] = b0 / n; }
    }
  }
  return { colours, w, h };
}

/** The scene's walls as plain segments, px. */
export function wallSegments(scene) {
  const out = [];
  for (const w of scene?.walls ?? []) {
    const c = w.c ?? [];
    if (c.length < 4) continue;
    out.push({ id: w.id, a: [c[0], c[1]], b: [c[2], c[3]], door: w.door ?? 0 });
  }
  return out;
}

/** (i, j) → is the cell centre inside the scene rect (same rule as blankFor). */
export function sceneInsideFn(scene) {
  const g = gridOf(scene);
  const r = g.sceneRect;
  return (i, j) => {
    const cx = (j + 0.5) * g.size, cy = (i + 0.5) * g.size;
    return cx >= r.x && cx < r.x + r.width && cy >= r.y && cy < r.y + r.height;
  };
}
