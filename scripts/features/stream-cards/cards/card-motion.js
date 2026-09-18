/**
 * Motion helpers shared by every stream card.
 *
 * Extracted from `roll-card.js` when the status card arrived. They are shared rather than copied
 * because a second set of easings drifting from the first is invisible in a diff and shows up on a
 * stream as two cards that do not feel like the same feature.
 *
 * Everything here runs on the suite's shared anime.js engine through `stream/motion/engine.js`, and
 * nothing touches that engine, its speed or its main loop — it is shared with a dozen other features.
 * The Web Animations API is used only where anime.js cannot help: clip-path polygons with calc(),
 * pseudo-elements, and plain `top`/`left` sweeps.
 *
 * Pure DOM plus the engine: no Foundry documents, no settings.
 */

import { animate, cubicBezier } from "../../stream/motion/engine.js";

export const EASE_OUT = cubicBezier(0.16, 1, 0.3, 1);
export const EASE_SNAP = cubicBezier(1, 0, 0.7, 1);
export const EASE_POP = cubicBezier(0.34, 1.56, 0.5, 1);
export const EASE_EXIT = cubicBezier(0.55, 0, 0.84, 0);
export const CSS_EASE_OUT = "cubic-bezier(.16,1,.3,1)";
export const CSS_UNFOLD = "cubic-bezier(.7,0,.2,1)";
export const CSS_SNAP = "cubic-bezier(1,0,.7,1)";

const SCRAMBLE_GLYPHS = "ABCDEFGHJKLMNPRSTUVWXYZ0123456789";

export const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = String(text);
  return node;
}

/** anime.js animation as a promise that also settles if the animation is cancelled. */
export function tween(target, params) {
  if (!target) return Promise.resolve();
  return new Promise((resolve) => {
    animate(target, { ...params, onComplete: resolve });
    setTimeout(resolve, (params.duration ?? 400) + (params.delay ?? 0) + 120);
  });
}

/** Web Animations call for the cases anime.js cannot drive; always settles. */
export function waapi(target, keyframes, options) {
  if (!target?.animate) return Promise.resolve();
  try {
    return target.animate(keyframes, { fill: "both", easing: CSS_EASE_OUT, ...options }).finished.catch(() => {});
  } catch (_error) {
    return Promise.resolve();
  }
}

/** Resolves a text node out of noise, left to right. */
export function scramble(node, text, duration = 400, delay = 0) {
  const target = String(text ?? "");
  const id = (node._scramble = (node._scramble ?? 0) + 1);
  const t0 = performance.now() + delay;
  const frame = (now) => {
    if (node._scramble !== id) return;
    const p = Math.max(0, Math.min(1, (now - t0) / duration));
    node.textContent = [...target]
      .map((ch, i) => (ch === " " || i / target.length < p ? ch : SCRAMBLE_GLYPHS[Math.floor(Math.random() * SCRAMBLE_GLYPHS.length)]))
      .join("");
    if (p < 1) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  setTimeout(() => {
    if (node._scramble === id) node.textContent = target;
  }, delay + duration + 80);
}

/** Counts a number up to its value, easing out. A non-numeric value is written straight in. */
export function countUp(node, to, duration = 520) {
  if (!Number.isFinite(to)) {
    node.textContent = to ?? "";
    return;
  }
  const current = Number(node.textContent);
  const from = Number.isFinite(current) && current >= 0 && current <= 9999 ? current : 0;
  const id = (node._count = (node._count ?? 0) + 1);
  const t0 = performance.now();
  const frame = (now) => {
    if (node._count !== id) return;
    const p = Math.max(0, Math.min(1, (now - t0) / duration));
    node.textContent = Math.round(from + (to - from) * (1 - (1 - p) ** 4));
    if (p < 1) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  setTimeout(() => {
    if (node._count === id) node.textContent = to;
  }, duration + 80);
}
