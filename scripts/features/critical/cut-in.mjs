/**
 * Critical's cut-in, the parts that need no world: what counts as a video, where
 * the art lands on screen, and how long a video's edges run.
 *
 * Pure on purpose. `module.js` drives the PIXI still and the DOM video through
 * these, and so do `tools/critical-check.mjs` and `tools/critical-preview.mjs`.
 * The moment this reads `game`, the DOM or PIXI, the preview has to restate it
 * and flatters whichever copy was touched last.
 */

import { escapeHTML } from "../../core/util.mjs";

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
 * The band the wipe has opened, in screen pixels: the art's fit box, opened
 * vertically from its centre by `wipe`, lifted and scaled with the art. Both
 * kinds clip to it (the PIXI mask, the video's inset) and the chrome's rules
 * ride its edges, so the three can never part.
 */
export function bandOf(frame, box, sh) {
  const wipe = Math.min(1, Math.max(0, Number(frame.wipe) || 0));
  const scale = Number(frame.scaleMul) || 1;
  const cy = sh / 2 + (Number(frame.lift) || 0);
  const half = (box.h / 2) * wipe * scale;
  const w = box.w * scale;
  return { x: box.x + (box.w - w) / 2, w, top: cy - half, bottom: cy + half };
}

/**
 * What the cut-in says, beside the art. A critical is the table's good news
 * when a player's character lands it and its danger when an NPC does, so the
 * tone is the side, never a decoration.
 *
 * A PC's name is printed: the players already know their own characters. An
 * NPC's never is. The GM may have hidden it on the token, and the cut-in is
 * drawn on every player's screen and on the stream login; the art already
 * says who it is as much as the GM chose to say.
 */
export function cutInModel(event, t) {
  const isPC = event?.isPC === true;
  const name = isPC ? String(event?.actorName ?? "").trim() : "";
  return { tone: isPC ? "pc" : "npc", label: t("GLUC.CutIn.Critical"), name: name || null };
}

/** The chrome's markup. One layer per beat, mounted over the art. */
export function cutInHTML(model) {
  const name = model.name ? `<span class="gluc-cut-name">${escapeHTML(model.name)}</span>` : "";
  return (
    `<div class="gluc-cut" data-tone="${model.tone === "pc" ? "pc" : "npc"}" aria-hidden="true">` +
    `<i class="gluc-cut-rule"></i><i class="gluc-cut-rule"></i>` +
    `<div class="gluc-cut-plate"><span class="gluc-cut-slab">${escapeHTML(model.label)}</span>${name}</div>` +
    `</div>`
  );
}

/**
 * One motion frame as the chrome's inline styles: the two rules on the band's
 * edges, the plate pinned inside the band's lower-left corner and revealed
 * left to right with the wipe. Transforms and opacity only, plus one small
 * inset clip, so the beat stays on the compositor.
 */
export function chromeStyle(frame, box, sw, sh) {
  const band = bandOf(frame, box, sh);
  const inset = Math.min(48, Math.max(20, sh * 0.04));
  const left = Math.max(inset, band.x + inset);
  const reveal = (1 - Math.min(1, Math.max(0, Number(frame.wipe) || 0))) * 100;
  return {
    root: { opacity: String(frame.imgAlpha) },
    top: { transform: `translate3d(0, ${(band.top - 1).toFixed(1)}px, 0)` },
    bottom: { transform: `translate3d(0, ${(band.bottom - 1).toFixed(1)}px, 0)` },
    plate: {
      transform: `translate3d(${left.toFixed(1)}px, ${(Math.min(band.bottom, sh) - inset).toFixed(1)}px, 0) translateY(-100%)`,
      clipPath: `inset(0% ${reveal.toFixed(2)}% 0% 0%)`,
    },
  };
}

/** The duration slider's readout, written at render and on every input. */
export function durationLabel(ms) {
  const n = Math.round(Number(ms));
  return `${Number.isFinite(n) ? n : 0} ms`;
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
