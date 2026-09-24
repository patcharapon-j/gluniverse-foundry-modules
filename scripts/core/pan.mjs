/**
 * GLUniverse Suite — one pass per frame for pan and zoom listeners.
 *
 * `canvasPan` fires once per input event, and a trackpad or a free-spinning
 * wheel delivers several of those inside one frame. A listener that re-culls or
 * re-measures on every one of them does that work several times for a frame
 * that is drawn once. Wrap the listener here and it runs once, on the canvas
 * ticker just before Foundry's own placeable pass, with the newest arguments.
 *
 *     Hooks.on("canvasPan", coalescePan((canvas, pos) => host.cull()));
 *
 * The wrapper is what goes to `Hooks.on`, so a feature's own teardown (which
 * removes the hook by id) is unchanged. A listener that has to run AFTER the
 * render (it reads world transforms Foundry only recomputes then) keeps its own
 * post-render scheduling instead — pf2e-aoe's `onView` is one.
 */

/** A queued flush older than this is presumed lost with its ticker. */
const STALE_MS = 250;

/**
 * @template {(...args: any[]) => void} F
 * @param {F} fn
 * @returns {F}
 */
export function coalescePan(fn) {
  let queued = false;
  let queuedAt = 0;
  let lastArgs = [];
  const flush = () => {
    queued = false;
    fn(...lastArgs);
  };
  return /** @type {any} */ ((...args) => {
    lastArgs = args;
    // A flush scheduled on a ticker that stopped or was torn down with its
    // canvas never runs. Trusting the flag then would swallow every pan for the
    // rest of the session, so a flush that has not run within a few frames is
    // treated as lost.
    if (queued && performance.now() - queuedAt < STALE_MS) return;
    const ticker = globalThis.canvas?.app?.ticker;
    const P = globalThis.PIXI?.UPDATE_PRIORITY;
    if (!ticker || !P) {
      fn(...args);
      return;
    }
    queued = true;
    queuedAt = performance.now();
    // HIGH + 1: after input, before Foundry's OBJECTS pass (HIGH - 2) and the
    // render (LOW), so the frame that is drawn reflects this pan.
    ticker.addOnce(flush, null, P.HIGH + 1);
  });
}
