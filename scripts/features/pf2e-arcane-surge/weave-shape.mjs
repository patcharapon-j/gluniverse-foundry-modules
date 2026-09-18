/**
 * GLUniverse Suite — the stability weave's geometry, as numbers.
 *
 * The standing instability used to be a fragment shader. It is four wavy SVG
 * paths now, and this module is everything about them that is arithmetic: where
 * the threads run, how far apart their holes sit, how wide they splay when they
 * tear. `weave.mjs` builds the DOM from it and anime.js moves it.
 *
 * DEPENDENCY-FREE BY CONTRACT, for the same reason `anim.mjs` is:
 * `tools/arcane-surge-check.mjs` drives these functions directly rather than a
 * reimplementation of them, and `tools/arcane-surge-preview.mjs` inlines this
 * file verbatim into a page with no module resolution behind it.
 *
 * EVERY LENGTH HERE IS A CSS PIXEL, and that is the one invariant worth
 * restating. The shader had to carry `uTexel` — a device pixel expressed in its
 * own field units — because GLSL has no notion of a CSS pixel, and the whole
 * scale had to be pinned to a fixed constant so a shorter chip would not shrink
 * the weave with it. In SVG the geometry simply *is* CSS pixels, so the
 * invariant costs nothing: a lane is 3.6px apart on every display, a hairline is
 * one CSS pixel and can never go sub-pixel, and a smaller chip shows LESS of the
 * weave rather than a squashed copy of it. Nothing here may be derived from the
 * container's measured height again.
 */

/** Four threads, the count the ladder's vocabulary was tuned against. */
export const THREADS = 4;

/** How far past the chip's own box the weave reaches, in CSS pixels.
 *  Without it every loose thread end is clipped to the chip's four straight
 *  lines and the weave reads as a filled panel rather than as something coming
 *  apart around the label. */
export const BLEED_PX = 10;

/** Lane spacing. Four lanes across ~11px, which is the band a HUD chip's label
 *  occupies — the threads run THROUGH the word, not above or below it. */
export const LANE_PX = 3.6;

/** The longest thread's wavelength; each subsequent thread is shorter, so no
 *  two ever come back into step. */
export const WAVE_BASE_PX = 53;
export const WAVE_STEP = 0.38;

/** How fast the weave drifts sideways, CSS px per second. The shader's threads
 *  all travelled at ~4.3px/s and their evolution came from noise terms this
 *  implementation does not carry, so the speeds are spread instead: the weave
 *  works visibly loose because its threads slide PAST each other. */
export const DRIFT_PX_S = 4.3;
export const DRIFT_STEP = 0.12;

/** The distance between one hole in a thread and the next. */
export const PART_BASE_PX = 29;
export const PART_STEP = 0.17;

/** The energy running along a thread: a short bright mark every so often,
 *  travelling far faster than the weave drifts and against it. */
export const FLOW_PERIOD_PX = 33;
export const FLOW_MARK_PX = 6;
export const FLOW_PX_S = 10;
export const FLOW_STEP = 0.2;

/** How long a torn fibre is at each end of a hole. */
export const FIBRE_PX = 2.6;

/** A hole narrower than two fibres and a gap between them cannot show any, so
 *  Fraying — which barely parts at all — never sprouts them. */
export const FIBRE_MIN_GAP_PX = FIBRE_PX * 2 + 1;

/** Cubic segments per wavelength. Eight is where an exact Hermite fit stops
 *  being distinguishable from the curve at these amplitudes. */
const SEGMENTS_PER_WAVE = 8;

const clamp01 = (n) => (!(n > 0) ? 0 : n > 1 ? 1 : n);
const round2 = (n) => Math.round(n * 100) / 100;

export const wavelength = (i) => WAVE_BASE_PX / (1 + i * WAVE_STEP);
export const driftSpeed = (i) => DRIFT_PX_S * (1 + i * DRIFT_STEP);
export const partPeriod = (i) => PART_BASE_PX * (1 + i * PART_STEP);
export const flowSpeed = (i) => FLOW_PX_S * (1 + i * FLOW_STEP);

/** Lane offsets are centred on zero, so the weave is centred on the LABEL.
 *  Anchored at one end the falloff leaves a splat over one end of the word and
 *  a dark tail at the other. */
export const laneOffset = (i) => (i - (THREADS - 1) / 2) * LANE_PX;

/** How long one thread's drift loop lasts, in ms. Translating by exactly one
 *  wavelength is seamless, which is why every term of the wave is a harmonic. */
export const driftMs = (i) => (wavelength(i) / driftSpeed(i)) * 1000;
/** And one lap of the flow's marks along that thread. */
export const flowMs = (i) => (FLOW_PERIOD_PX / flowSpeed(i)) * 1000;

/**
 * The ladder, as numbers.
 *
 * CHAOS IS SPENT ON SPREAD AND LOOSENESS, NEVER ON FINER THREADS. The strip is
 * a couple of dozen pixels tall; finer there buys mush, while how far the weave
 * reaches and how badly it has come apart are legible across the table. So the
 * threads stay one CSS pixel wide at every rung and what moves is:
 *
 *   loosening  → `amplitude`, how far the threads wander off true
 *   parting    → `gapFraction`, how much of each thread is simply missing
 *   splaying   → `splay`, how far the torn halves pull apart
 *   reaching   → `reach`, how far past the word the weave is visible at all
 *
 * Every one of them is 0 or inert at chaos 0, because Stable must render
 * NOTHING — not a very faint something.
 */
export function weaveParams(chaos) {
  const c = clamp01(chaos);
  return {
    chaos: c,
    /** Half the peak-to-peak wander of a thread, CSS px. */
    amplitude: c === 0 ? 0 : 0.8 + 2.6 * c,
    /** The share of each thread that has parted. The shader read this off a
     *  noise threshold that starts BELOW zero, so Fraying barely parts at all
     *  and the rung still reads as "loosening" rather than "coming apart". */
    gapFraction: clamp01(-0.05 + 0.47 * c),
    /** How far a torn thread's two halves pull apart, CSS px. */
    splay: c === 0 ? 0 : 1.26 + 2.1 * c,
    /** How far the weave reaches past the label, as a fraction of half the
     *  strip. Measured against the strip's own half-width so the ladder means
     *  the same thing on a chip saying "Fraying" and one saying "Unraveling",
     *  which are visibly different widths. */
    reach: 0.5 + 0.55 * c,
    /** The layer's opacity. Deliberately above a straight line in c: the first
     *  rung has to be VISIBLE on a bright HUD, and a scale that reaches
     *  Unraveling at a comfortable opacity leaves Fraying as a rumour. */
    opacity: Math.min(1, c * (1.1 + 0.25 * c)),
  };
}

/**
 * One thread's dash patterns.
 *
 * `line` parts the thread; `fibre` puts a short hairline at each torn END of
 * every hole, which is where the shader's splayed fibres lived — they peak at
 * the edges of a gap and are gone by the middle of it. Both patterns share one
 * period, so they stay registered with each other under one dash offset.
 *
 * EVERY NUMBER IN A DASH ARRAY MUST BE POSITIVE. A single negative entry makes
 * the browser discard the WHOLE attribute, which renders as a thread that never
 * parts — the exact look of the feature not working, with nothing reported.
 */
export function dashPattern(i, params) {
  const period = partPeriod(i);
  const gap = period * clamp01(params.gapFraction);
  const dash = period - gap;
  const line = [round2(dash), round2(gap)];

  if (gap < FIBRE_MIN_GAP_PX) return { period: round2(period), line, fibre: null };

  /* Ink for FIBRE_PX at each end of the hole and nowhere else: skip the intact
     stretch, mark, skip the middle of the hole, mark. The leading zero-length
     dash is what lets the pattern start with a skip. */
  const middle = gap - FIBRE_PX * 2;
  return {
    period: round2(period),
    line,
    fibre: [0, round2(dash), FIBRE_PX, round2(middle), FIBRE_PX, 0],
  };
}

/** The flow's marks: short ink, long skip, one period apart along the thread. */
export const flowDash = () => [FLOW_MARK_PX, round2(FLOW_PERIOD_PX - FLOW_MARK_PX)];

/**
 * A thread's path, as an SVG `d`.
 *
 * The wave is a fundamental plus its third harmonic, and the harmonic is not
 * decoration: a pure sine reads as a printed rule rather than as a thread, and
 * anything NOT harmonic cannot be looped by translation, which is the whole
 * animation. Translating by exactly one wavelength is then seamless, so the
 * drift needs no per-frame geometry and costs one compositor transform.
 *
 * The path runs one wavelength past the box at BOTH ends so the drift never
 * exposes an end of it.
 */
export function threadPath(i, { width, height, amplitude, seed = 0 }) {
  const w = Math.max(1, width);
  const lane = height / 2 + laneOffset(i);
  const wave = wavelength(i);
  const k = (Math.PI * 2) / wave;
  // Bounded, and different for every thread: two worlds never fray identically
  // and no two threads in one world are in phase.
  const p1 = (seed * 1.37 + i * 2.3) % (Math.PI * 2);
  const p2 = (seed * 0.61 + i * 5.1) % (Math.PI * 2);

  const y = (x) => lane + amplitude * (0.62 * Math.sin(k * x + p1) + 0.38 * Math.sin(3 * k * x + p2));
  const dy = (x) => amplitude * k * (0.62 * Math.cos(k * x + p1) + 1.14 * Math.cos(3 * k * x + p2));

  const step = wave / SEGMENTS_PER_WAVE;
  const x0 = -wave;
  const x1 = w + wave;
  const parts = [`M${round2(x0)} ${round2(y(x0))}`];
  for (let x = x0; x < x1; x += step) {
    const xb = Math.min(x + step, x1);
    const h = (xb - x) / 3;
    // Hermite → cubic Bézier: the control points ride the curve's own slope, so
    // the segment is exact at both ends and within a fraction of a pixel between.
    parts.push(
      `C${round2(x + h)} ${round2(y(x) + dy(x) * h)} ${round2(xb - h)} ${round2(y(xb) - dy(xb) * h)} ${round2(xb)} ${round2(y(xb))}`,
    );
  }
  return parts.join("");
}
