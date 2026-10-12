/**
 * Stage light — everything the stage needs from one backdrop, from one read.
 *
 * Pure. The host draws the backdrop once into a canvas (BG_W wide, its own
 * aspect) and hands the bytes here; out come
 *
 *   probe  what the room's light is (probe.mjs)
 *   env    a very soft copy — the room around each pixel, sampled by the
 *          figure shader so a character takes the colour of where they stand
 *   mid    the backdrop with a shallow depth of field
 *   soft   the backdrop with a deep one (the close-up's, and the far end of the dial)
 *   glow   the backdrop's bright paint, spread: its bloom, and the light that
 *          wraps round the cast's edges and veils them in a bright room
 *
 * The sharp picture itself is uploaded by the host as it is. Every blur here
 * runs once, in LINEAR light, on a small picture: blurring the encoded bytes
 * dims every highlight into grey mush, and a blur sampled live from a sharp
 * texture with a ring of taps draws a ghost of every highlight, while mip
 * sampling draws blocks.
 */

import { probeImage } from "./probe.mjs";
import { blur } from "./shape.mjs";

/** Width of the read, and of the mid blur. */
export const BG_W = 640;
/** Width of the soft blur and the glow. */
export const SOFT_W = 320;
export const ENV_W = 48;
/** Blur radii, in texels of their own level. */
export const MID_R = 2.5;
export const SOFT_R = 4.5;
export const GLOW_R = [2, 7];

/** Size of the read for a backdrop of the given aspect (w / h). */
export function backdropReadSize(aspect) {
  const a = Math.max(0.25, Math.min(4, Number(aspect) || 16 / 9));
  return { width: BG_W, height: Math.max(8, Math.round(BG_W / a)) };
}

/** Box-average an RGBA buffer down to w2 × h2. */
export function downsample(src, w, h, w2, h2) {
  const out = new Float32Array(w2 * h2 * 4);
  const cnt = new Float32Array(w2 * h2);
  for (let y = 0; y < h; y++) {
    const y2 = Math.min(h2 - 1, Math.floor((y * h2) / h));
    for (let x = 0; x < w; x++) {
      const x2 = Math.min(w2 - 1, Math.floor((x * w2) / w));
      const i = (y * w + x) * 4;
      const j = y2 * w2 + x2;
      out[j * 4] += src[i]; out[j * 4 + 1] += src[i + 1]; out[j * 4 + 2] += src[i + 2]; out[j * 4 + 3] += src[i + 3];
      cnt[j]++;
    }
  }
  const bytes = new Uint8Array(w2 * h2 * 4);
  for (let j = 0; j < w2 * h2; j++) for (let c = 0; c < 4; c++) bytes[j * 4 + c] = Math.round(out[j * 4 + c] / Math.max(1, cnt[j]));
  return bytes;
}

const LIN = new Float32Array(256);
for (let i = 0; i < 256; i++) { const c = i / 255; LIN[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }
const enc = (v) => {
  const c = Math.max(0, Math.min(1, v));
  return Math.round((c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055) * 255);
};

/** RGB planes in linear light. */
function linearPlanes(bytes, n) {
  const planes = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) planes[c][i] = LIN[bytes[i * 4 + c]];
  return planes;
}

/** Encode linear planes back to opaque sRGB bytes. */
function encodePlanes(planes, n) {
  const out = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    out[i * 4] = enc(planes[0][i]); out[i * 4 + 1] = enc(planes[1][i]); out[i * 4 + 2] = enc(planes[2][i]); out[i * 4 + 3] = 255;
  }
  return out;
}

const blurPlanes = (planes, w, h, r) => planes.map((p) => blur(p, w, h, r));

/** Blur an RGBA byte buffer in linear light. */
export function blurLinear(bytes, w, h, radius) {
  return encodePlanes(blurPlanes(linearPlanes(bytes, w * h), w, h, radius), w * h);
}

/**
 * The bloom: what in the picture is brighter than its own light level, kept in
 * its own colour and spread twice (a tight core and a wide veil). The knee sits
 * relative to the picture's whites, so a night street's lamps glow and a
 * snowfield does not turn into fog.
 */
export function glowPlanes(planes, w, h, white) {
  const n = w * h;
  const knee = Math.max(0.18, white * 0.5);
  const bright = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  for (let i = 0; i < n; i++) {
    const r = planes[0][i], g = planes[1][i], b = planes[2][i];
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    // Soft knee: a quadratic ramp into the threshold, linear past it.
    const x = Math.max(0, l - knee * 0.6);
    const over = x < knee * 0.8 ? (x * x) / (knee * 1.6) : x - knee * 0.4;
    const k = l > 1e-5 ? over / l : 0;
    bright[0][i] = r * k; bright[1][i] = g * k; bright[2][i] = b * k;
  }
  const core = blurPlanes(bright, w, h, GLOW_R[0]);
  const veil = blurPlanes(bright, w, h, GLOW_R[1]);
  return core.map((c, j) => c.map((v, i) => v * 0.45 + veil[j][i] * 0.9));
}

/**
 * @param {{data: ArrayLike<number>, width: number, height: number}} read  RGBA at backdropReadSize
 */
export function buildBackdrop(read) {
  const { width: w, height: h } = read;
  const data = read.data instanceof Uint8Array ? read.data : Uint8Array.from(read.data);
  const ew = ENV_W;
  const eh = Math.max(4, Math.round((ENV_W * h) / w));
  const small = downsample(data, w, h, ew, eh);
  const probe = probeImage({ data: small, width: ew, height: eh });
  const env = blurLinear(small, ew, eh, 3.2);

  const mid = blurLinear(data, w, h, MID_R);

  const sw = SOFT_W;
  const sh = Math.max(4, Math.round((SOFT_W * h) / w));
  const softBytes = downsample(data, w, h, sw, sh);
  const softPlanes = linearPlanes(softBytes, sw * sh);
  const soft = encodePlanes(blurPlanes(softPlanes, sw, sh, SOFT_R), sw * sh);
  const white = probe?.ok ? 0.2126 * probe.white[0] + 0.7152 * probe.white[1] + 0.0722 * probe.white[2] : 0.6;
  const glow = encodePlanes(glowPlanes(softPlanes, sw, sh, white), sw * sh);

  return {
    aspect: w / h,
    probe,
    env: { data: env, width: ew, height: eh },
    mid: { data: mid, width: w, height: h },
    soft: { data: soft, width: sw, height: sh },
    glow: { data: glow, width: sw, height: sh },
  };
}

/**
 * Screen → picture uv for a picture of `aspect` laid over a `view` as `cover`,
 * pushed in by `zoom` about `focus` (screen uv). Returns [sx, sy, ox, oy] such
 * that uv = screenPx * s + o (pixels) — or, with `unit`, screen uv * s + o.
 */
export function coverMap(view, aspect, { zoom = 1, focus = [0.5, 0.5], unit = false } = {}) {
  const va = view.w / Math.max(1, view.h);
  // Fraction of the picture visible across each axis at zoom 1.
  let fx = 1, fy = 1;
  if (va > aspect) fy = aspect / va; else fx = va / aspect;
  fx /= zoom; fy /= zoom;
  const ox = focus[0] - fx * focus[0];
  const oy = focus[1] - fy * focus[1];
  if (unit) return [fx, fy, ox, oy];
  return [fx / view.w, fy / view.h, ox, oy];
}

/** Picture uv → screen uv, through a unit cover map. */
export function pictureToScreen(map, uv) {
  return [(uv[0] - map[2]) / map[0], (uv[1] - map[3]) / map[1]];
}

const toSRGB = (v) => {
  const c = Math.max(0, Math.min(1, v));
  return c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
};

/**
 * The director's room numbers for a prepared backdrop (or none): the room's
 * luminance, the floor shade's colour (the room's own darkest paint, as the
 * screen shader draws it, sRGB), and the picture's aspect.
 */
export function roomOf(maps) {
  if (!maps?.probe?.ok) return { lum: 0.16, floorColor: [0.02, 0.02, 0.03], aspect: maps?.aspect ?? 16 / 9 };
  const s = maps.probe.shadow;
  return {
    lum: maps.probe.meanLum,
    floorColor: s.map((v) => toSRGB(v * 0.7)),
    aspect: maps.aspect,
  };
}
