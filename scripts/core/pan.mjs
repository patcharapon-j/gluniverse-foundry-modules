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

/**
 * @template {(...args: any[]) => void} F
 * @param {F} fn
 * @returns {F}
 */
export function coalescePan(fn) {
  let queued = false;
  let lastArgs = [];
  const flush = () => {
    queued = false;
    fn(...lastArgs);
  };
  return /** @type {any} */ ((...args) => {
    lastArgs = args;
    if (queued) return;
    const ticker = globalThis.canvas?.app?.ticker;
    const P = globalThis.PIXI?.UPDATE_PRIORITY;
    if (!ticker || !P) {
      fn(...args);
      return;
    }
    queued = true;
    // HIGH + 1: after input, before Foundry's OBJECTS pass (HIGH - 2) and the
    // render (LOW), so the frame that is drawn reflects this pan.
    ticker.addOnce(flush, null, P.HIGH + 1);
  });
}
