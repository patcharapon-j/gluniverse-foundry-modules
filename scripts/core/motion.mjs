/** Shared local Anime.js entry points and ownership for disposable suite UI. */
export { animate } from "../vendor/animejs/animation/index.js";
export { createTimeline } from "../vendor/animejs/timeline/index.js";
export { stagger } from "../vendor/animejs/utils/stagger.js";
export { eases, spring } from "../vendor/animejs/easings/index.js";
import { scaledMs } from "./theme.mjs";

/** Resolve the existing suite/feature motion tier without retiming game state. */
export function motionDuration(ms, root = null) {
  return scaledMs(ms, root);
}

/**
 * One owner per mounted root or replaceable slot. Clear before replacing DOM.
 * External resources and queue settlement still belong to the feature.
 * Completed animations may retain inline styles, so keep them until clear()
 * unless the caller explicitly commits its final state and forgets them.
 */
export function createMotionOwner() {
  const animations = new Set();
  return {
    add(animation) {
      if (animation) animations.add(animation);
      return animation;
    },
    forget(animation) { animations.delete(animation); },
    clear() {
      const previous = [...animations];
      animations.clear();
      for (const animation of previous) animation.revert();
    },
  };
}
