/**
 * Stage post-processing — scene background sampling.
 *
 * Derives everything the lighting model needs from the *scene background asset*
 * alone: an ambient colour, a horizontal strip of column colours (so a character
 * standing in front of the campfire picks up its orange while the one by the
 * window picks up cold blue), and a luminance centroid that stands in for the
 * scene's key light.
 *
 * Deliberately does NOT read the renderer or the lighting layer. Slot X maps
 * straight to image X — no camera transform — so the result is a pure function
 * of the background asset. Every client computes an identical grade, panning
 * never re-grades, and there is nothing to broadcast over the socket.
 *
 * Sampling is layered so it can never hard-fail:
 *   1. still image  → downsample during decode, read pixels
 *   2. video        → draw a single frame once, then treat it as static
 *   3. tainted/404  → fall back to the scene's flat background colour
 *   4. no scene     → neutral; the effect goes inert
 */

import { clamp01, hex6 } from "../../../core/util.mjs";
import { loadPixelImage, corsRetryUrl, invalidateAsset } from "./asset.mjs";

/** Width of the sampling thumbnail — also the number of columns we keep. */
const THUMB_W = 32;
const THUMB_H = 32;

/** Cache key → sample. Scenes are few; no eviction needed here. */
const _cache = new Map();

/** In-flight sampling promises, so N slots don't each kick off a decode. */
const _pending = new Map();

const VIDEO_RE = /\.(webm|mp4|m4v|ogv)(\?.*)?$/i;

/** Neutral sample: the effect renders as a no-op against this. */
export const NEUTRAL_SAMPLE = Object.freeze({
  ok: false,
  degraded: false,
  ambient: [0.5, 0.5, 0.5],
  columns: [[0.5, 0.5, 0.5]],
  centroid: [0.5, 0.5],
  luminance: 0.5,
  darkness: 0,
  reason: "none",
});

/** Rec. 709 luma of a 0..1 float triplet. */
function luma(rgb) {
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}

/** Parse `#rrggbb` (or a Foundry Color-ish value) into a 0..1 float triplet. */
function parseColor(value, fallback = [0.5, 0.5, 0.5]) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return [
      ((value >> 16) & 0xff) / 255,
      ((value >> 8) & 0xff) / 255,
      (value & 0xff) / 255,
    ];
  }
  const hex = hex6(String(value ?? ""), null);
  if (!hex) return fallback;
  return [
    parseInt(hex.slice(1, 3), 16) / 255,
    parseInt(hex.slice(3, 5), 16) / 255,
    parseInt(hex.slice(5, 7), 16) / 255,
  ];
}

/** The scene's darkness level, normalised to 0..1. */
function readDarkness(scene) {
  return clamp01(Number(scene?.environment?.darknessLevel ?? 0) || 0);
}

/** The flat colour Foundry paints behind the map — always available. */
function readFlatColor(scene) {
  return parseColor(scene?.backgroundColor, [0.35, 0.35, 0.38]);
}

/** Load a still image, downsampling *during* decode so an 8k map never
 *  materialises at full size. */
async function decodeImage(src) {
  // Shared loader: a background on S3 needs the same CORS negotiation the
  // character art does, and benefits from the same cache-busted retry.
  const img = await loadPixelImage(src);

  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(img, {
        resizeWidth: THUMB_W,
        resizeHeight: THUMB_H,
        resizeQuality: "low",
      });
    } catch (_e) {
      // Older engines reject the resize options — fall through to the element.
    }
  }
  return img;
}

/** Load a video in CORS mode, far enough to have a frame to draw. */
function openVideo(url) {
  const video = document.createElement("video");
  video.crossOrigin = "anonymous";
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = url;

  return new Promise((resolve, reject) => {
    video.addEventListener("loadeddata", () => resolve(video), { once: true });
    video.addEventListener("error", () => reject(new Error("video load failed")), { once: true });
  });
}

/** Grab a single frame from a video background, then treat it as static. */
async function decodeVideo(src) {
  let video;
  try {
    video = await openVideo(src);
  } catch (err) {
    // Same poisoned-cache retry the image path gets: a header-less copy cached
    // from Foundry's own no-CORS playback would otherwise fail us permanently.
    const retry = corsRetryUrl(src);
    if (!retry) throw err;
    video = await openVideo(retry);
  }

  // Nudge past frame 0 — many encodes open on a black or fade-in frame, which
  // would grade the whole cast to pitch black.
  try {
    if (video.duration && Number.isFinite(video.duration)) {
      await new Promise((resolve) => {
        video.addEventListener("seeked", resolve, { once: true });
        video.currentTime = Math.min(video.duration * 0.25, 2);
        // Some codecs never fire `seeked` for a cold decode; don't hang on it.
        setTimeout(resolve, 400);
      });
    }
  } catch (_e) {
    /* keep whatever frame we have */
  }
  return video;
}

/**
 * Reduce a decoded source to a THUMB_W × THUMB_H pixel buffer.
 * Throws on a tainted (cross-origin, non-CORS) source — the caller degrades.
 */
function readPixels(source) {
  const canvas = document.createElement("canvas");
  canvas.width = THUMB_W;
  canvas.height = THUMB_H;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("no 2d context");
  ctx.drawImage(source, 0, 0, THUMB_W, THUMB_H);
  // Throws SecurityError when the source tainted the canvas.
  return ctx.getImageData(0, 0, THUMB_W, THUMB_H).data;
}

/**
 * Turn a thumbnail buffer into the lighting sample.
 *
 * Rows are weighted toward the lower part of the frame: stage characters stand
 * at the bottom of the viewport, so the ground and mid-ground matter more to
 * how they read than the sky does.
 */
function analyse(data) {
  const columns = [];
  let ambient = [0, 0, 0];
  let ambientWeight = 0;
  let cx = 0;
  let cy = 0;
  let centroidWeight = 0;

  for (let x = 0; x < THUMB_W; x++) {
    let col = [0, 0, 0];
    let colWeight = 0;

    for (let y = 0; y < THUMB_H; y++) {
      const i = (y * THUMB_W + x) * 4;
      const a = data[i + 3] / 255;
      if (a <= 0) continue;

      const r = (data[i] / 255) * a;
      const g = (data[i + 1] / 255) * a;
      const b = (data[i + 2] / 255) * a;

      // Lower rows count for more (1.0 at the top → 2.0 at the bottom).
      const rowWeight = 1 + y / (THUMB_H - 1);
      col[0] += r * rowWeight;
      col[1] += g * rowWeight;
      col[2] += b * rowWeight;
      colWeight += rowWeight;

      ambient[0] += r;
      ambient[1] += g;
      ambient[2] += b;
      ambientWeight += 1;

      // Luminance-weighted centroid — where the picture is brightest. Painted
      // backgrounds put their light source in frame, so this tracks it well.
      const l = luma([r, g, b]);
      const lw = l * l; // square it so highlights dominate midtones
      cx += (x / (THUMB_W - 1)) * lw;
      cy += (y / (THUMB_H - 1)) * lw;
      centroidWeight += lw;
    }

    columns.push(colWeight > 0 ? col.map((v) => clamp01(v / colWeight)) : [0.5, 0.5, 0.5]);
  }

  if (ambientWeight > 0) ambient = ambient.map((v) => clamp01(v / ambientWeight));
  else ambient = [0.5, 0.5, 0.5];

  const centroid =
    centroidWeight > 1e-6 ? [clamp01(cx / centroidWeight), clamp01(cy / centroidWeight)] : [0.5, 0.35];

  return { ambient, columns, centroid, luminance: luma(ambient) };
}

/** Build the degraded sample used when pixels are unavailable. */
function degradedSample(scene, reason) {
  const flat = readFlatColor(scene);
  return {
    ok: true,
    degraded: true,
    ambient: flat,
    columns: [flat],
    // No image to infer from — light from slightly above and in front.
    centroid: [0.5, 0.3],
    luminance: luma(flat),
    darkness: readDarkness(scene),
    reason,
  };
}

/**
 * Sample a scene's background. Resolves to a sample object; never rejects.
 * Repeat calls for the same background are served from cache.
 */
export async function sampleScene(scene) {
  if (!scene) return NEUTRAL_SAMPLE;

  const src = scene.background?.src || "";
  const darkness = readDarkness(scene);

  if (!src) {
    // A blank scene still has its flat colour, which is better than nothing.
    return degradedSample(scene, "no-background");
  }

  const key = src;
  const cached = _cache.get(key);
  // Darkness is free to read and changes independently of the asset, so it is
  // refreshed on every call rather than baked into the cache entry.
  if (cached) return { ...cached, darkness };
  if (_pending.has(key)) {
    const sample = await _pending.get(key);
    return { ...sample, darkness };
  }

  const job = (async () => {
    let sample;
    try {
      const source = VIDEO_RE.test(src) ? await decodeVideo(src) : await decodeImage(src);
      const data = readPixels(source);
      sample = {
        ok: true,
        degraded: false,
        ...analyse(data),
        darkness,
        reason: "image",
      };
      if (typeof source.close === "function") source.close();
    } catch (err) {
      // Tainted canvas, 404, decode failure — all degrade the same way, but the
      // reason drives what the GM panel offers to do about it. `loadPixelImage`
      // has already told CORS and missing apart; a raw SecurityError means the
      // canvas tainted despite a clean load.
      const reason =
        err?.reason ||
        (err?.name === "SecurityError" ? "cors" : VIDEO_RE.test(src) ? "video" : "decode");
      sample = degradedSample(scene, reason);
    }
    _cache.set(key, sample);
    _pending.delete(key);
    return sample;
  })();

  _pending.set(key, job);
  return job;
}

/**
 * The colour of the background directly behind a slot.
 * @param {object} sample  A sample from {@link sampleScene}.
 * @param {number} t       Horizontal position across the stage, 0..1.
 */
export function columnAt(sample, t) {
  const cols = sample?.columns;
  if (!cols?.length) return [0.5, 0.5, 0.5];
  const idx = Math.round(clamp01(t) * (cols.length - 1));
  return cols[idx] || cols[0];
}

/** Drop cached samples — call when a background asset may have changed. */
export function invalidateSceneSamples(src = null) {
  invalidateAsset(src);
  if (src) {
    _cache.delete(src);
    _pending.delete(src);
  } else {
    _cache.clear();
    _pending.clear();
  }
}
