/**
 * Diorama editor — read the map art and the walls of a scene.
 *
 * `sampleColours(scene)` draws the level background over the scene rect on an
 * offscreen canvas at a few px per sub-cell and gives back two readings of it
 * over the WHOLE grid (padding included, where it reads black):
 *
 *   colours  one RGB average per sub-cell. The magic wand and Auto setup's
 *            classes work from that.
 *   fine     the canvas itself as RGB, `px` pixels per sub-cell per axis. Auto
 *            setup reads height cues from it (cast shadows, stair stripes),
 *            which are a fraction of a square wide and average away in
 *            `colours`.
 *
 * The plan (`samplePlan`) and the block average (`blockAverage`) are pure, so
 * tools/diorama-auto-eval.mjs reproduces exactly what the editor reads.
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
import { isMultiLevel, levelBackgroundSrc } from "../terrain/levels.mjs";
import { warn } from "../../../core/const.mjs";
import { loadCorsMedia } from "../render/art.mjs";

/** Most canvas px per sub-cell per axis (16 per square: a stair tread is 4–8). */
export const SAMPLE_PX = 8;
/** Fewest; below this the fine raster is just the colours again. */
const MIN_PX = 2;
/** Largest offscreen canvas side we allocate. */
const MAX_SIDE = 4096;
/** Most pixels in the fine raster (keeps Auto setup well under a second). */
const MAX_PIXELS = 1_600_000;

/**
 * How the map is sampled for a grid of `cols × rows` squares.
 * @returns {{px:number, w:number, h:number, cw:number, ch:number}}  px per sub-cell,
 *   the sub-cell grid, and the canvas size
 */
export function samplePlan(cols, rows) {
  const w = Math.max(1, cols | 0) * SUB, h = Math.max(1, rows | 0) * SUB;
  let px = SAMPLE_PX;
  while (px > 1 && (w * px > MAX_SIDE || h * px > MAX_SIDE || w * h * px * px > MAX_PIXELS)) px--;
  return { px, w, h, cw: Math.min(MAX_SIDE, w * px), ch: Math.min(MAX_SIDE, h * px) };
}

/**
 * Average `px × px` blocks of an RGB(A) raster into one RGB per sub-cell.
 * @param {ArrayLike<number>} data  raster, `stride` bytes per pixel (3 or 4)
 * @param {number} W @param {number} H  raster size
 * @param {number} stride
 * @param {number} w @param {number} h  sub-cell grid
 * @param {number} px
 * @returns {Uint8Array}
 */
export function blockAverage(data, W, H, stride, w, h, px) {
  const colours = new Uint8Array(w * h * 3);
  for (let si = 0; si < h; si++) {
    for (let sj = 0; sj < w; sj++) {
      let r0 = 0, g0 = 0, b0 = 0, n = 0;
      const y0 = si * px, x0 = sj * px;
      for (let dy = 0; dy < px; dy++) {
        const y = y0 + dy;
        if (y >= H) break;
        for (let dx = 0; dx < px; dx++) {
          const x = x0 + dx;
          if (x >= W) break;
          const o = (y * W + x) * stride;
          r0 += data[o]; g0 += data[o + 1]; b0 += data[o + 2]; n++;
        }
      }
      const o = (si * w + sj) * 3;
      if (n) { colours[o] = r0 / n; colours[o + 1] = g0 / n; colours[o + 2] = b0 / n; }
    }
  }
  return colours;
}

/** RGBA → RGB, dropping alpha (a transparent pixel reads black, like padding). */
function rgbOf(rgba, n) {
  const out = new Uint8Array(n * 3);
  for (let p = 0, o = 0; p < n; p++, o += 4) {
    const a = rgba[o + 3] / 255;
    out[p * 3] = rgba[o] * a; out[p * 3 + 1] = rgba[o + 1] * a; out[p * 3 + 2] = rgba[o + 2] * a;
  }
  return out;
}

/**
 * The art the terrain is painted over: v14 Levels carry their own background,
 * so a Level's (default: the one viewed on the canvas, else the initial one).
 */
export function backgroundSrc(scene, level = null) {
  // (not scene.background: v14 shims that to the FIRST Level's art)
  if (isMultiLevel(scene)) return levelBackgroundSrc(scene, level);
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
  return loadCorsMedia(src, { video: false });
}

/** One reading per art + grid: the wand and Auto setup share it. */
let _last = null;

/**
 * The scene's map art read per sub-cell, plus the fine raster.
 * @param {Scene} scene
 * @returns {Promise<{colours: Uint8Array, w: number, h: number,
 *   fine: {data: Uint8Array, w: number, h: number, px: number}} | {error: "none"|"load"|"tainted"}>}
 */
export async function sampleColours(scene) {
  const src = backgroundSrc(scene);
  if (!src) return { error: "none" };
  const g = gridOf(scene);
  const r = g.sceneRect;
  const key = `${src}|${g.cols}|${g.rows}|${g.size}|${r.x},${r.y},${r.width},${r.height}`;
  if (_last?.key === key) return _last.result;
  const img = await loadBackground(src);
  if (!img) return { error: "load" };
  const plan = samplePlan(g.cols, g.rows);
  const cv = document.createElement("canvas");
  cv.width = plan.cw;
  cv.height = plan.ch;
  const ctx = cv.getContext("2d", { willReadFrequently: true });
  ctx.clearRect(0, 0, cv.width, cv.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  const k = (SUB * plan.px) / g.size;
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
  const rgb = rgbOf(data, cv.width * cv.height);
  const colours = blockAverage(rgb, cv.width, cv.height, 3, plan.w, plan.h, plan.px);
  const result = { colours, w: plan.w, h: plan.h, fine: { data: rgb, w: cv.width, h: cv.height, px: plan.px } };
  _last = { key, result };
  return result;
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
