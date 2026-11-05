/**
 * Critical's cut-in, the parts that need no world: what counts as a video, where
 * the art lands on screen, and how long a video's edges run.
 *
 * Pure on purpose. `module.js` drives the PIXI still and the DOM video through
 * these, and so do `tools/critical-check.mjs` and `tools/critical-preview.mjs`.
 * The moment this reads `game`, the DOM or PIXI, the preview has to restate it
 * and flatters whichever copy was touched last.
 */

export const VIDEO_EXTENSIONS = Object.freeze(["webm", "mp4", "m4v", "ogv", "ogg", "mov"]);

/** The beat's edges as fractions of the cut-in, at scale 1 (see motion.mjs). */
export const EDGE_FRACTIONS = Object.freeze({ easeIn: 0.15, easeOut: 0.2, bgIn: 0.2, bgOut: 0.28 });

/**
 * Real-time caps on a video's edges. The still runs at most 3s, so its
 * fractions stay short; on a 20s clip the same 15% would be a 3s fade-in.
 */
export const VIDEO_EDGE_MS = Object.freeze({ easeIn: 400, easeOut: 500, bgIn: 500, bgOut: 700 });

/**
 * The custom property the backdrop is painted from, on the overlay root. PIXI
 * cannot read CSS, so the still path reads it once per cut-in; the video path's
 * backdrop is a DOM node that reads it directly.
 */
export const BACKDROP_VAR = "--gluc-backdrop";

/** Does this asset path name a video the cut-in should play rather than blit? */
export function isVideoPath(path) {
  const clean = String(path ?? "").split("?")[0].split("#")[0];
  const dot = clean.lastIndexOf(".");
  if (dot < 0) return false;
  return VIDEO_EXTENSIONS.includes(clean.slice(dot + 1).toLowerCase());
}

/**
 * Aspect-fit a source of `srcW × srcH` into a `sw × sh` screen, centred. An
 * unknown source size fits at scale 1, as the PIXI path always has.
 */
export function fitBox(srcW, srcH, sw, sh) {
  const w0 = Number(srcW) || 0;
  const h0 = Number(srcH) || 0;
  const scale = w0 > 0 && h0 > 0 ? Math.min(sw / w0, sh / h0) : 1;
  const w = w0 * scale;
  const h = h0 * scale;
  return { scale, w, h, x: (sw - w) / 2, y: (sh - h) / 2 };
}

/** Fade fractions for a video of `durationMs`, each capped to its real-time budget. */
export function videoEdges(durationMs) {
  const span = Math.max(1, Number(durationMs) || 0);
  const cap = (key) => Math.min(EDGE_FRACTIONS[key], VIDEO_EDGE_MS[key] / span);
  return { easeIn: cap("easeIn"), easeOut: cap("easeOut"), bgIn: cap("bgIn"), bgOut: cap("bgOut") };
}

/**
 * One motion frame as the inline style of a DOM cut-in (the `<video>`, or the
 * preview's still). The PIXI still applies the same frame as sprite properties
 * and a rect mask, so both kinds read as one effect.
 */
export function mediaStyle(frame) {
  const wipe = Math.min(1, Math.max(0, Number(frame.wipe) || 0));
  const inset = (1 - wipe) * 50;
  return {
    opacity: String(frame.imgAlpha),
    transform: `translate(-50%, -50%) translateY(${frame.lift}px) scale(${frame.scaleMul})`,
    clipPath: `inset(${inset}% 0% ${inset}% 0%)`,
  };
}

/**
 * A CSS colour as a PIXI integer. Takes `#rgb` and `#rrggbb` (what a token
 * alias computes to); anything else is `fallback`, so a missing token draws the
 * old black rather than nothing.
 */
export function colorToInt(value, fallback = 0) {
  const s = String(value ?? "").trim();
  const short = /^#([0-9a-f]{3})$/i.exec(s);
  if (short) return parseInt(short[1].replace(/./g, (c) => c + c), 16);
  const long = /^#([0-9a-f]{6})$/i.exec(s);
  return long ? parseInt(long[1], 16) : fallback;
}
