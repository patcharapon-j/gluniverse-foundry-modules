/**
 * GLUniverse Suite — Arcane Surge load shedding and colour ramp.
 *
 * Dependency-free by design: `tools/arcane-surge-preview.mjs` inlines this file
 * verbatim into its preview page, so it must not import anything the browser
 * would have to resolve.
 *
 * The ambient overlay is a STANDING cost — it runs for as long as the party is
 * somewhere unstable, which can be a whole session. Under pressure it has to
 * give way to the things people are actually playing with, and it has to give
 * way in a defined order rather than by whoever notices the frame budget first.
 * The order is stated here; the measuring is the suite's (see `ladder.mjs`).
 */

/**
 * What is dropped, in order, as the frame budget is exceeded.
 *
 * `flourish` goes first: it is the small second beat on a severity roll, the
 * most ornamental thing here. `drift` goes last and only freezes the field's
 * MOTION — the overlay itself stays, because what degrades under load must be
 * the animation and never the state. A player whose machine is struggling
 * should not stop being able to see that the world is unstable.
 */
export const SHED_ORDER = Object.freeze(["flourish", "drift"]);

/* The thresholds and the rolling average that used to sit here are gone.
   Shedding rides `core/budget.mjs` now, through the one ladder `ladder.mjs`
   binds to this order: the shared reflex measures the frame (22/15 ms at the
   default 60 fps target, the pair this file shipped with), and a Performance
   tier can start the ladder shed. This file keeps only WHAT is shed and in which
   order, which is the one part that is this feature's to decide — and it stays
   dependency-free, because the preview inlines it verbatim. */

/**
 * The teal→cyan arcane ramp, as float triples for GLSL.
 *
 * THE SHIPPED HOSTS DO NOT USE THIS. They call `palette.mjs`, which derives the
 * ramp from `core/theme.mjs` so a retheme reaches the shaders. This literal copy
 * exists solely for the preview page, which inlines this file as source with no
 * module resolution available to it.
 *
 * That makes it a genuine drift risk — two statements of one colour — so
 * `tools/arcane-surge-check.mjs` asserts these floats still equal
 * `hexToRgbFloat(PALETTE[…])` for the keys `palette.mjs` names. Do not edit one
 * without the other.
 */
export const RAMP = Object.freeze({
  /* PALETTE.ink2 — the near-black the veil sits over */
  deep: Object.freeze([0.043137254901960784, 0.058823529411764705, 0.09019607843137255]),
  /* PALETTE.teal #4ad9c0 — "held", the suite's stabilised hue */
  mid: Object.freeze([0.2901960784313726, 0.8509803921568627, 0.7529411764705882]),
  /* PALETTE.cyan #5eeaff — what it tears toward */
  hot: Object.freeze([0.3686274509803922, 0.9176470588235294, 1]),
});

/** Ease used by both the ambient's fade and the burst's envelope. */
export const easeOut = (t) => 1 - Math.pow(1 - Math.max(0, Math.min(1, t)), 3);
