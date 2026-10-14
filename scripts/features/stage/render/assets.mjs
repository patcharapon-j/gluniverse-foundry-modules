/**
 * Stage — turning a loaded picture into what the renderer and director need.
 *
 * DOM (a 2D canvas) but no Foundry: the overlay and the preview page both call
 * these, so the preview prepares art exactly as the table does.
 */

import { SHAPE_PAD, buildShape, shapeGrid } from "../light/shape.mjs";
import { backdropReadSize, buildBackdrop } from "../light/backdrop.mjs";
import { gradeBytes } from "../light/picture.mjs";

const ART_MAX = 2048;

function canvas2d(w, h) {
  const c = typeof OffscreenCanvas === "function" ? new OffscreenCanvas(w, h) : Object.assign(document.createElement("canvas"), { width: w, height: h });
  const ctx = c.getContext("2d", { willReadFrequently: true });
  return { c, ctx };
}

const sizeOf = (img) => ({ w: img.naturalWidth || img.videoWidth || img.width, h: img.naturalHeight || img.videoHeight || img.height });

/**
 * Prepare one art. Throws on a tainted (unreadable) picture — the caller
 * degrades that character to unlit.
 *
 * @param {HTMLImageElement|ImageBitmap|HTMLCanvasElement} img
 * @returns {{ image: TexImageSource, shape: object, info: object }}
 */
export function prepareArt(img) {
  const { w, h } = sizeOf(img);
  if (!(w > 0 && h > 0)) throw new Error("empty image");
  const aspect = w / h;

  // Upload size: the art, capped.
  const k = Math.min(1, ART_MAX / Math.max(w, h));
  let image = img;
  if (k < 1) {
    const { c, ctx } = canvas2d(Math.round(w * k), Math.round(h * k));
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, c.width, c.height);
    image = c;
  }

  // Shape: the art drawn small into its padded grid.
  const grid = shapeGrid(aspect);
  const { c, ctx } = canvas2d(grid.w, grid.h);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, grid.padX, grid.padY, grid.artW, grid.artH);
  const read = ctx.getImageData(0, 0, grid.w, grid.h); // throws when tainted
  const shape = buildShape(read, grid);

  return {
    image,
    shape,
    info: {
      aspect,
      width: w,
      height: h,
      padU: grid.padX / grid.w,
      padV: grid.padY / grid.h,
      shapeTexel: [1 / grid.w, 1 / grid.h],
      bounds: shape.bounds,
      head: shape.head,
      face: null,
    },
  };
}

/** The picture itself, capped at ART_MAX on its long side, for upload. */
function capped(img) {
  const { w, h } = sizeOf(img);
  const k = Math.min(1, ART_MAX / Math.max(w, h));
  if (k >= 1 && !(typeof HTMLVideoElement !== "undefined" && img instanceof HTMLVideoElement)) return img;
  const { c, ctx } = canvas2d(Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k)));
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return c;
}

/**
 * Prepare a backdrop: its maps (light/backdrop.mjs) and the sharp picture to
 * upload beside them. A video is read as its current frame. Throws when tainted.
 * The maps are made from the picture graded by `picture` (light/picture.mjs), so
 * the room the cast is lit by, its bloom and its blur levels are the picture as
 * Theatre shows it; the sharp level is graded by the shader instead.
 * @param {HTMLImageElement|HTMLVideoElement|ImageBitmap} img
 * @param {object} [picture]  light.picture
 * @returns {{ maps: object, image: TexImageSource }}
 */
export function prepareBackdrop(img, picture = null) {
  const { w, h } = sizeOf(img);
  if (!(w > 0 && h > 0)) throw new Error("empty image");
  const size = backdropReadSize(w / h);
  const { c, ctx } = canvas2d(size.width, size.height);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, size.width, size.height);
  const read = ctx.getImageData(0, 0, size.width, size.height);
  gradeBytes(read.data, picture);
  const maps = buildBackdrop(read);
  return { maps, image: capped(img) };
}

/** The face locator's head box ([x, y, w, h] fractions) as the director's face. */
export function faceFromBox(b) {
  if (!Array.isArray(b) || b.length !== 4 || !b.every(Number.isFinite)) return null;
  return { x: b[0] + b[2] / 2, y: b[1] + b[3] / 2, h: b[3] };
}

export { SHAPE_PAD };
