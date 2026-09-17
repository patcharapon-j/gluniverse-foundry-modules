/**
 * GLUniverse Suite — face framing geometry. Pure: no DOM, no Foundry.
 *
 * `scripts/core/face-frame.mjs` finds the head in a piece of art and stores a compact
 * entry per image. The helpers here turn an entry into a crop for a given box, and a
 * crop into the CSS the suite's portraits already use (`object-fit: cover` plus
 * `object-position`, `transform-origin` and a `scale()`).
 */

import { computeCrop, PRESETS } from "../vendor/face-frame/face-frame.mjs";

export { PRESETS };

/**
 * A detection result, reduced to what framing needs, as stored in the caches.
 * `k`: "s" subject, "f" already framed (ring baked into the art), "n" nothing found.
 * `b`: the chosen head box, as fractions of the image width/height.
 * `t`: which edges the art touches (transparent art only), as "trbl" letters.
 *
 * @typedef {{k: "s"|"f"|"n", w: number, h: number, a?: 1, t?: string, b?: number[], tier?: string}} FaceEntry
 */

/** @returns {FaceEntry} */
export function compactResult(result) {
  const { width: w, height: h, hasAlpha, touches } = result.image;
  const entry = { k: result.kind === "subject" ? "s" : result.kind === "already-framed" ? "f" : "n", w, h };
  if (hasAlpha) {
    entry.a = 1;
    if (touches) entry.t = ["top", "right", "bottom", "left"].filter(e => touches[e]).map(e => e[0]).join("");
  }
  if (result.kind === "subject") {
    const top = result.candidates[0];
    const { x, y, width, height } = top.box;
    entry.b = [x / w, y / h, width / w, height / h].map(round);
    entry.tier = top.tier;
  }
  return entry;
}

export function isFaceEntry(value) {
  return !!value && ["s", "f", "n"].includes(value.k) && value.w > 0 && value.h > 0
    && (value.k !== "s" || (Array.isArray(value.b) && value.b.length === 4 && value.b.every(Number.isFinite)));
}

/** The head box in image pixels, or null. */
export function headBox(entry) {
  if (entry?.k !== "s") return null;
  const [x, y, bw, bh] = entry.b;
  return { x: x * entry.w, y: y * entry.h, width: bw * entry.w, height: bh * entry.h };
}

/**
 * Where to crop the image so the head sits in `frame` (a library preset name or
 * `{aspect, headRatio, eyeLine, eyeInHead}`), in image pixels. Null when no head was
 * found or the art is already framed: callers keep their default placement.
 * The crop never leaves the image, since DOM portraits cannot show padding.
 */
export function cropFor(entry, frame) {
  const box = headBox(entry);
  if (!box) return null;
  const preset = typeof frame === "string" ? PRESETS[frame] : { eyeInHead: 0.55, ...frame };
  const touches = entry.t ?? "";
  const image = {
    width: entry.w,
    height: entry.h,
    hasAlpha: !!entry.a,
    touches: { top: touches.includes("t"), right: touches.includes("r"), bottom: touches.includes("b"), left: touches.includes("l") }
  };
  const result = { kind: "subject", image, candidates: [{ box, confidence: 1, tier: entry.tier ?? "detector", source: "cache" }] };
  const { x, y, width, height } = computeCrop(result, preset, { allowPadding: false });
  return { x, y, width, height };
}

/**
 * The `object-position` (percent, also used as `transform-origin`) and `scale()` that
 * show `crop` in a `boxW` x `boxH` element with `object-fit: cover`. The crop's centre
 * lands on the box centre, and the crop fills the box on its tighter axis.
 *
 * With cover, the image is drawn at s0 = max(boxW/W, boxH/H) and offset by
 * (box - drawn) * p. Scaling by S about the point box * p moves image point u to
 * box*p + S * (offset + u*s0 - box*p). Solving for the crop centre landing at box/2
 * gives p = (box/2 - S*c*s0) / (box - S*drawn); when S*drawn equals the box, p has no
 * effect and 50% is as good as any.
 *
 * Only the box's aspect matters. With `zoom: false` the scale stays 1 and the position is
 * kept within 0–100%, for elements that cannot be scaled: the crop is then only centred
 * as far as the cover fit allows.
 */
export function coverPlacement(crop, imageW, imageH, boxW, boxH, { zoom = true } = {}) {
  const s0 = Math.max(boxW / imageW, boxH / imageH);
  const scale = zoom ? Math.max(1, Math.min(boxW / (s0 * crop.width), boxH / (s0 * crop.height))) : 1;
  const axis = (box, drawn, centre) => {
    const denominator = box - scale * drawn;
    if (Math.abs(denominator) < 1e-6) return 50;
    const p = ((box / 2 - scale * centre * s0) / denominator) * 100;
    return zoom ? p : Math.max(0, Math.min(100, p));
  };
  return {
    x: round2(axis(boxW, imageW * s0, crop.x + crop.width / 2)),
    y: round2(axis(boxH, imageH * s0, crop.y + crop.height / 2)),
    scale: round2(scale)
  };
}

/** Screen position of image point (u, v) under a cover placement, for tests and previews. */
export function projectCover(placement, u, v, imageW, imageH, boxW, boxH) {
  const s0 = Math.max(boxW / imageW, boxH / imageH);
  const project = (p, box, drawn, point) => {
    const origin = box * p;
    return origin + placement.scale * ((box - drawn) * p + point * s0 - origin);
  };
  return {
    x: project(placement.x / 100, boxW, imageW * s0, u),
    y: project(placement.y / 100, boxH, imageH * s0, v)
  };
}

/** Inline style for a plain `<img>` with `object-fit: cover` whose parent clips it. */
export function coverStyle(placement) {
  const position = `${placement.x}% ${placement.y}%`;
  return { objectFit: "cover", objectPosition: position, transformOrigin: position, transform: `scale(${placement.scale})` };
}

/**
 * Inline style for an `<img>` whose parent does not clip (thumbnails, chat avatars):
 * `object-view-box` crops inside the element. Where it is unsupported (Firefox) the
 * caller falls back to `coverPlacement` without the scale.
 */
export function viewBoxStyle(crop, imageW, imageH) {
  const pct = n => `${round2(Math.max(0, n) * 100)}%`;
  const inset = [
    crop.y / imageH,
    1 - (crop.x + crop.width) / imageW,
    1 - (crop.y + crop.height) / imageH,
    crop.x / imageW
  ].map(pct).join(" ");
  return { objectFit: "cover", objectViewBox: `inset(${inset})` };
}

function round(n) {
  return Math.round(n * 10000) / 10000;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}
