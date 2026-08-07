/**
 * Stage post-processing — character normal-map prepass.
 *
 * Flat 2D character art has no surface information, so lighting it convincingly
 * needs a surface to be invented. This derives one from the only geometry the
 * art actually carries: its alpha channel.
 *
 * The alpha mask is blurred into a smooth "thickness" field — near 1 deep inside
 * the silhouette, falling to 0 at the edges. Its gradient points inward, and
 * that gradient makes a serviceable normal: the interior faces the viewer, and
 * the surface rolls away toward every edge. Light then wraps around a shoulder
 * instead of just tinting it, which is the whole difference between "graded"
 * and "lit".
 *
 * Output is a single RGBA buffer carrying everything the shader needs:
 *   R,G — normal XY, encoded to 0..1
 *   B   — thickness (blurred alpha), for rim falloff and occlusion
 *   A   — the original alpha, for masking
 *
 * The prepass is pure CPU and runs once per art asset, cached by src. It needs
 * pixel access, so cross-origin art without CORS headers throws here — the
 * caller treats that as "no normal map" and drops to the CSS fallback path.
 */

import { clamp01 } from "../../../core/util.mjs";

/** Prepass resolution. The normal field is low-frequency; 256 is plenty and
 *  keeps the blur passes cheap even for a 4k portrait. */
const MAX_DIM = 256;

/** Blur radius as a fraction of the smaller dimension. Larger = softer, more
 *  rounded-looking form; smaller = the shading hugs the outline. */
const BLUR_FRACTION = 0.055;

/** How many box-blur passes approximate the gaussian. Three is the standard
 *  trade — visually smooth, still cheap. */
const BLUR_PASSES = 3;

/** LRU cache: src → { width, height, data } | null (null = known-unusable). */
const _cache = new Map();
const _pending = new Map();
const CACHE_LIMIT = 24;

function cacheGet(key) {
  if (!_cache.has(key)) return undefined;
  // Refresh recency.
  const value = _cache.get(key);
  _cache.delete(key);
  _cache.set(key, value);
  return value;
}

function cacheSet(key, value) {
  if (_cache.has(key)) _cache.delete(key);
  _cache.set(key, value);
  while (_cache.size > CACHE_LIMIT) {
    const oldest = _cache.keys().next().value;
    _cache.delete(oldest);
  }
}

/** Decode art at reduced size. Resizing during decode avoids ever holding the
 *  full-resolution bitmap. */
async function decodeArt(src) {
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.decoding = "async";
  img.src = src;

  await new Promise((resolve, reject) => {
    if (img.complete && img.naturalWidth) return resolve();
    img.addEventListener("load", resolve, { once: true });
    img.addEventListener("error", () => reject(new Error("art load failed")), { once: true });
  });

  const nw = img.naturalWidth || MAX_DIM;
  const nh = img.naturalHeight || MAX_DIM;
  const scale = Math.min(1, MAX_DIM / Math.max(nw, nh));
  const width = Math.max(1, Math.round(nw * scale));
  const height = Math.max(1, Math.round(nh * scale));

  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(img, {
        resizeWidth: width,
        resizeHeight: height,
        resizeQuality: "medium",
      });
      return { source: bitmap, width, height };
    } catch (_e) {
      /* fall through to the element */
    }
  }
  return { source: img, width, height };
}

/**
 * Separable box blur over a single Float32 channel, run in place via a scratch
 * buffer. Two 1D passes per iteration; O(n) per pass regardless of radius.
 *
 * Result lands back in `src`; `dst` is scratch. Exported for testing — an
 * off-by-one in the sliding window skews the gradient, and therefore the light
 * direction, on every character.
 */
export function boxBlur(src, dst, width, height, radius) {
  const inv = 1 / (radius * 2 + 1);

  // Horizontal
  for (let y = 0; y < height; y++) {
    const row = y * width;
    let sum = 0;
    for (let i = -radius; i <= radius; i++) {
      sum += src[row + Math.min(width - 1, Math.max(0, i))];
    }
    for (let x = 0; x < width; x++) {
      dst[row + x] = sum * inv;
      const add = src[row + Math.min(width - 1, x + radius + 1)];
      const sub = src[row + Math.max(0, x - radius)];
      sum += add - sub;
    }
  }

  // Vertical
  for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let i = -radius; i <= radius; i++) {
      sum += dst[Math.min(height - 1, Math.max(0, i)) * width + x];
    }
    for (let y = 0; y < height; y++) {
      src[y * width + x] = sum * inv;
      const add = dst[Math.min(height - 1, y + radius + 1) * width + x];
      const sub = dst[Math.max(0, y - radius) * width + x];
      sum += add - sub;
    }
  }
}

/**
 * Build the normal/thickness buffer for one decoded art source.
 * @returns {{width:number,height:number,data:Uint8ClampedArray}}
 */
function buildNormals(source, width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("no 2d context");
  ctx.drawImage(source, 0, 0, width, height);
  // Throws SecurityError on cross-origin art served without CORS headers.
  const pixels = ctx.getImageData(0, 0, width, height).data;

  const count = width * height;
  const alpha = new Uint8ClampedArray(count);
  const field = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const a = pixels[i * 4 + 3];
    alpha[i] = a;
    field[i] = a / 255;
  }

  const scratch = new Float32Array(count);
  const radius = Math.max(1, Math.round(Math.min(width, height) * BLUR_FRACTION));
  for (let pass = 0; pass < BLUR_PASSES; pass++) {
    boxBlur(field, scratch, width, height, radius);
  }

  const data = new Uint8ClampedArray(count * 4);
  // Gradient scale: the blurred field ramps over ~radius pixels, so normalise
  // the derivative by the radius to keep the tilt independent of art size.
  const gradScale = radius * 0.75;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const xm = i - (x > 0 ? 1 : 0);
      const xp = i + (x < width - 1 ? 1 : 0);
      const ym = i - (y > 0 ? width : 0);
      const yp = i + (y < height - 1 ? width : 0);

      // Gradient points *up* the field, i.e. inward from the silhouette edge.
      // The surface normal tilts the opposite way — outward — so negate it.
      const dx = -(field[xp] - field[xm]) * gradScale;
      const dy = -(field[yp] - field[ym]) * gradScale;

      const thickness = clamp01(field[i]);
      const o = i * 4;
      data[o] = Math.round((clamp01(dx * 0.5 + 0.5)) * 255);
      data[o + 1] = Math.round((clamp01(dy * 0.5 + 0.5)) * 255);
      data[o + 2] = Math.round(thickness * 255);
      data[o + 3] = alpha[i];
    }
  }

  return { width, height, data };
}

/**
 * Get (or build) the normal map for a piece of character art.
 * Resolves to `null` when the art can't be sampled — a tainted cross-origin
 * asset, a decode failure, or a missing file. Never rejects.
 */
export async function getNormalMap(src) {
  if (!src) return null;

  const cached = cacheGet(src);
  if (cached !== undefined) return cached;
  if (_pending.has(src)) return _pending.get(src);

  const job = (async () => {
    let result = null;
    try {
      const { source, width, height } = await decodeArt(src);
      result = buildNormals(source, width, height);
      if (typeof source.close === "function") source.close();
    } catch (_err) {
      // Cache the failure too — otherwise every re-render retries a decode that
      // is never going to succeed.
      result = null;
    }
    cacheSet(src, result);
    _pending.delete(src);
    return result;
  })();

  _pending.set(src, job);
  return job;
}

/** Drop cached prepasses. Called when an actor's image changes. */
export function invalidateNormalMap(src = null) {
  if (src) {
    _cache.delete(src);
    _pending.delete(src);
  } else {
    _cache.clear();
    _pending.clear();
  }
}
