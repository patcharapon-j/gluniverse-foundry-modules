/**
 * GLUniverse Stream — motion.
 *
 * The standalone module re-hosted anime.js's main loop on the PIXI canvas
 * ticker (`engine.useDefaultMainLoop = false`) so canvas work could not drift a
 * frame out of step with the render. In the suite that engine is **shared** —
 * Insight, the initiative tracker, the resource bars, Stage and Stream Pacer all
 * animate on it — so taking it over would re-clock twelve features that never
 * asked for it, and stall every one of them whenever no canvas exists or during
 * `canvasTearDown`. Nothing here touches the engine, its speed or its main loop.
 *
 * Canvas synchronisation is achieved the way the rest of the suite does it: the
 * work that must land in the canvas's own frame is driven from a PIXI ticker
 * callback, and anything it animates is built with `autoplay: false` and moved
 * with `.seek()` on that callback's clock. See `features/resource-bars/anim.mjs`
 * for the same pattern at greater length.
 *
 * DOM overlays (chat cards, dialogs) need none of this and run on the engine's
 * default loop like every other feature's UI.
 */

import { animate, createTimeline, createTimer, cubicBezier, eases, remove } from "../../../core/motion.mjs";
import { MODULE_ID } from "../constants.js";

export { animate, createTimeline, createTimer, cubicBezier, eases, remove };

/**
 * Canvas-bound work runs just after Foundry's token animations advance and just
 * before the canvas renders, so anything that reads a token's animated position,
 * or moves the stage, lands in the frame the canvas draws.
 */
const CANVAS_TICK_PRIORITY = (globalThis.PIXI?.UPDATE_PRIORITY?.LOW ?? -25) + 0.5;

const frameListeners = new Set();
let attachedTicker = null;

/** Called from the feature's `onInit`. No import-time side effects. */
export function registerMotionEngine() {
  Hooks.on("canvasReady", attachToCanvasTicker);
  Hooks.on("canvasTearDown", detachFromCanvasTicker);
  if (globalThis.canvas?.ready) attachToCanvasTicker();
}

/** Undo `registerMotionEngine`, for a canvas that goes away for good. */
export function unregisterMotionEngine() {
  Hooks.off("canvasReady", attachToCanvasTicker);
  Hooks.off("canvasTearDown", detachFromCanvasTicker);
  detachFromCanvasTicker();
  frameListeners.clear();
}

/**
 * Run a listener once per canvas frame, with the elapsed milliseconds for that
 * frame. Listeners only run while a canvas exists, which is the only time
 * canvas-bound work has anywhere to draw. Returns a remover.
 *
 * A listener that drives an animation must `.seek()` it rather than play it: a
 * played animation runs on the shared engine's own frame loop, where this
 * ticker's timing — and Foundry's pause — cannot reach it.
 */
export function onCanvasFrame(listener) {
  frameListeners.add(listener);
  return () => frameListeners.delete(listener);
}

/**
 * True when this client asked for less motion.
 *
 * The suite deliberately ignores the OS/browser `prefers-reduced-motion` query
 * — motion is an explicit in-app choice, not something inferred from a system
 * setting (see `styles/gl-motion.css` and CLAUDE.md), so the standalone
 * module's `matchMedia` check is gone. Foundry's own photosensitive mode is a
 * different thing: somebody opened Foundry's settings and turned it on, so it
 * is honoured.
 */
export function prefersCalmMotion() {
  try {
    return Boolean(game.settings.get("core", "photosensitiveMode"));
  } catch (_error) {
    return false;
  }
}

function attachToCanvasTicker() {
  const ticker = globalThis.canvas?.app?.ticker;
  if (!ticker || ticker === attachedTicker) return;
  detachFromCanvasTicker();
  ticker.add(stepFrame, null, CANVAS_TICK_PRIORITY);
  attachedTicker = ticker;
}

function detachFromCanvasTicker() {
  if (!attachedTicker) return;
  attachedTicker.remove(stepFrame, null);
  attachedTicker = null;
}

/**
 * PIXI hands its callbacks the ticker itself in v7+ and a scalar deltaTime in
 * older builds; `deltaMS` is read off the ticker either way so listeners get
 * real milliseconds rather than frame-fractions.
 */
function stepFrame() {
  const deltaMs = attachedTicker?.deltaMS ?? 16.667;
  for (const listener of frameListeners) {
    try {
      listener(deltaMs);
    } catch (error) {
      console.error(`${MODULE_ID} | Stream canvas frame listener failed`, error);
    }
  }
}
