/**
 * Motion helpers shared by every stream card.
 *
 * They are shared rather than copied because a second set of easings drifting from the first is
 * invisible in a diff and shows up on a stream as two cards that do not feel like the same feature.
 *
 * Everything here runs on the suite's shared anime.js engine through `stream/motion/engine.js`, and
 * nothing touches that engine, its speed or its main loop — it is shared with a dozen other features.
 * The Web Animations API is used only where anime.js cannot help: clip-path shapes with calc() and
 * pseudo-elements.
 *
 * Every length a card animates for is named in CARD_MOTION and read through `timing()`, which passes it
 * through the suite's motion scale once per gesture. Nothing in the card files writes a literal duration:
 * a number written inline is a beat that ignores the motion tier and drifts from its siblings unseen.
 *
 * Pure DOM plus the engine: no Foundry documents, no settings.
 */

import { animate, cubicBezier } from "../../stream/motion/engine.js";
import { motionDuration } from "../../../core/motion.mjs";

/** Decelerate to rest: the suite's `--gl-ease`. */
export const EASE_OUT = cubicBezier(0.16, 1, 0.3, 1);
/** A decisive in-out for rules and dividers drawing themselves: `--gl-ease-sharp`. */
export const EASE_SNAP = cubicBezier(0.7, 0, 0.1, 1);
/** The one overshoot, kept for a number landing and a die settling. */
export const EASE_POP = cubicBezier(0.34, 1.56, 0.5, 1);
/** Exits decelerate too, faster: an ease-in exit reads as a stall on a stream. */
export const EASE_EXIT = cubicBezier(0.4, 0, 0.2, 1);
export const CSS_EASE_OUT = "cubic-bezier(.16,1,.3,1)";
export const CSS_UNFOLD = "cubic-bezier(.7,0,.1,1)";

/**
 * Every animation length on a card, in ms at motion scale 1. Grouped by the gesture they belong to,
 * because a beat only reads as one when its parts are timed against each other.
 */
export const CARD_MOTION = Object.freeze({
  // A roll card arriving.
  cardIn: 480,
  ruleIn: 360,
  stripDelay: 120,
  unfold: 420,
  artIn: 620,
  artDelay: 60,
  playerIn: 300,
  playerDelay: 140,
  nameIn: 380,
  nameDelay: 190,
  actionIn: 360,
  actionDelay: 290,
  dividerIn: 340,
  dividerDelay: 220,
  metaIn: 300,
  metaDelay: 360,
  headlineIn: 420,
  headlineDelay: 260,
  quoteIn: 420,
  quoteDelay: 280,
  dieDelay: 160,
  dieSpin: 430,
  dieSettle: 190,
  dieFlicker: 460,
  dieFlickerStep: 50,
  totalIn: 380,
  totalDelay: 280,
  count: 540,
  countHold: 600,
  noTotalHold: 680,
  // The outcome landing.
  labelIn: 300,
  ruleTone: 560,
  diePopUp: 150,
  diePopDown: 230,
  totalPop: 320,
  climaxDelay: 160,
  glowIn: 220,
  glowRest: 880,
  critPop: 540,
  shakeStep: 70,
  pop: 580,
  popGlowIn: 280,
  popGlowOut: 600,
  // A card rewritten in place: a reroll, the next step of a spell chain.
  updateOut: 180,
  chipIn: 280,
  updateRuleIn: 400,
  updateIn: 320,
  updateCount: 600,
  updateHold: 680,
  // The damage row dropping in under its attack.
  damageDrop: 380,
  damagePartIn: 280,
  damagePartStagger: 70,
  damageCount: 620,
  damageCritPop: 500,
  // Leaving: slide toward the edge the stack hugs, then close the gap it leaves.
  exitSlide: 300,
  exitCollapse: 260,
  // A status card.
  statusIn: 360,
  statusRuleIn: 300,
  statusArtIn: 480,
  statusArtDelay: 60,
  statusNameIn: 300,
  statusNameDelay: 80,
  statusUnfold: 340,
  statusChipStagger: 80,
  statusFoldStagger: 60,
  statusChipUp: 200,
  statusChipDown: 160,
  statusExitSlide: 260,
  statusExitCollapse: 220,
  // A safety margin on every awaited animation: it settles even if the animation never reports back.
  settleSlack: 120
});

/**
 * The suite's motion scale for one gesture, read once. Returns `d(name)` for a CARD_MOTION entry.
 * The scale is read from the card's own element so a scoped motion tier reaches it.
 */
export function timing(root = null) {
  const scale = motionDuration(1000, root) / 1000;
  return (name) => {
    const ms = CARD_MOTION[name];
    if (!Number.isFinite(ms)) throw new Error(`stream cards: no CARD_MOTION entry "${name}"`);
    return Math.round(ms * scale);
  };
}

/**
 * The card's resting shape: the slab's polygon with the chamfer on its lower right, the same polygon
 * the stylesheet clips `.glus-rc-main`, `.glus-sc-strip` and `.glus-rc-damage` to. An entrance that
 * unfolds a plate starts on the folded copy and ends on this one, so the card never changes shape when
 * the animation is cleared. Both have the same five points, which is what lets the browser interpolate
 * between them.
 */
export const PLATE_CLIP = "polygon(0 0, 100% 0, 100% calc(100% - var(--glus-cut)), calc(100% - var(--glus-cut)) 100%, 0 100%)";
export const PLATE_CLIP_FOLDED = "polygon(0 0, 100% 0, 100% 0%, calc(100% - var(--glus-cut)) 0%, 0 0%)";

/**
 * Which edge of the screen the stack hugs: the chat root says so (`data-side`), set by the overlay from
 * the corner it sits in. A card slides in from and out to that edge.
 */
export function sideOf(element) {
  return element?.parentElement?.dataset?.side === "right" ? 1 : -1;
}

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
    setTimeout(resolve, (params.duration ?? 0) + (params.delay ?? 0) + CARD_MOTION.settleSlack);
  });
}

/**
 * Web Animations call for the cases anime.js cannot drive. Always settles: `finished` never resolves for
 * an animation whose element left the document, or in a throttled background tab, and the damage row
 * once sat at "0" with no parts on it for the card's whole life waiting on exactly that.
 */
export function waapi(target, keyframes, options) {
  if (!target?.animate) return Promise.resolve();
  const total = (options?.duration ?? 0) + (options?.delay ?? 0) + CARD_MOTION.settleSlack;
  try {
    const finished = target.animate(keyframes, { fill: "both", easing: CSS_EASE_OUT, ...options }).finished.catch(() => {});
    return Promise.race([finished, wait(total)]);
  } catch (_error) {
    return Promise.resolve();
  }
}

/**
 * Closes the space a leaving card held: its height and both its block margins (the stack spaces its
 * cards with margins, not `gap`, for exactly this) shrink together, so the cards behind it move once.
 */
export function collapse(node, duration) {
  if (!node?.isConnected) return Promise.resolve();
  const style = getComputedStyle(node);
  const height = node.getBoundingClientRect().height;
  node.style.overflow = "hidden";
  return tween(node, {
    height: [`${height}px`, "0px"],
    marginTop: [style.marginTop, "0px"],
    marginBottom: [style.marginBottom, "0px"],
    duration,
    ease: EASE_OUT
  });
}

/** Counts a number up to its value, easing out. A non-numeric value is written straight in. */
export function countUp(node, to, duration) {
  if (!node) return;
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
    const p = duration > 0 ? Math.max(0, Math.min(1, (now - t0) / duration)) : 1;
    node.textContent = Math.round(from + (to - from) * (1 - (1 - p) ** 4));
    if (p < 1) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  // The last write is a timer as well as a frame: a background tab runs no frames.
  setTimeout(() => {
    if (node._count === id) node.textContent = to;
  }, duration + CARD_MOTION.settleSlack);
}
