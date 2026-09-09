/**
 * One seekable beat sheet for the PIXI portrait and DOM video cut-ins.
 * The existing renderer/media clock owns time; Anime.js never starts a second
 * frame loop or changes the clip's duration. Only the decorative edges scale.
 */
import { createTimeline } from "../../core/motion.mjs";
import { clamp01 } from "../../core/util.mjs";

export function createCinematicMotion(durationMs, { edges = {}, scale = 1 } = {}) {
  const duration = Math.max(1, durationMs);
  const frame = { bgAlpha: 0, imgAlpha: 0, scaleMul: 0.94, wipe: 0, lift: 10 };
  const edge = (value, fallback) => duration * Math.min(0.45, Math.max(0, (value ?? fallback) * scale));
  const enter = edge(edges.easeIn, 0.15);
  const leave = edge(edges.easeOut, 0.2);
  const bgIn = edge(edges.bgIn, 0.2);
  const bgOut = edge(edges.bgOut, 0.28);
  const timeline = createTimeline({ autoplay: false });
  if (scale > 0) {
    timeline
      .add(frame, { bgAlpha: [0, 0.85], duration: bgIn, ease: "out(3)" }, 0)
      .add(frame, { imgAlpha: [0, 1], wipe: [0, 1], duration: enter, ease: "out(4)" }, 0)
      .add(frame, { scaleMul: [0.94, 1], lift: [10, 0], duration: enter, ease: "out(5)" }, 0)
      .add(frame, { scaleMul: [1, 1.035], duration: duration - enter - leave, ease: "inOutSine" }, enter)
      .add(frame, { imgAlpha: [1, 1], wipe: [1, 1], lift: [0, 0], duration: duration - enter - leave, ease: "linear" }, enter)
      .add(frame, { bgAlpha: [0.85, 0.85], duration: duration - bgIn - bgOut, ease: "linear" }, bgIn)
      .add(frame, { imgAlpha: [1, 0], scaleMul: [1.035, 1.16], lift: [0, -6], duration: leave, ease: "in(3)" }, duration - leave)
      .add(frame, { bgAlpha: [0.85, 0], duration: bgOut, ease: "in(3)" }, duration - bgOut);
  }
  return {
    sample(elapsedMs) {
      if (scale <= 0) {
        Object.assign(frame, { bgAlpha: elapsedMs < duration ? 0.85 : 0, imgAlpha: elapsedMs < duration ? 1 : 0, scaleMul: 1, wipe: 1, lift: 0 });
      } else {
        timeline.seek(clamp01(elapsedMs / duration) * duration, true);
      }
      return frame;
    },
    destroy() { timeline.revert(); },
  };
}
