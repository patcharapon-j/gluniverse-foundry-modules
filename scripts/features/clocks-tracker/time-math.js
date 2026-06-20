/**
 * Pure, Foundry-independent YZE time math.
 *
 * Day model (fixed regardless of the active calendar's month layout):
 *   1 stretch = 10 minutes = 600 seconds
 *   1 hour    = 6 stretches
 *   1 shift   = 6 hours = 36 stretches = 21,600 seconds
 *   1 day     = 4 shifts = 144 stretches = 86,400 seconds
 *
 * All functions here operate on plain numbers so they can be unit-tested
 * without a Foundry runtime. The engine layer maps these onto
 * game.time.worldTime (seconds) and the native calendar components.
 */

export const SECONDS_PER_STRETCH = 600;
export const STRETCHES_PER_HOUR = 6;
export const HOURS_PER_SHIFT = 6;
export const SHIFTS_PER_DAY = 4;

export const STRETCHES_PER_SHIFT = STRETCHES_PER_HOUR * HOURS_PER_SHIFT; // 36
export const STRETCHES_PER_DAY = STRETCHES_PER_SHIFT * SHIFTS_PER_DAY;   // 144
export const SECONDS_PER_SHIFT = SECONDS_PER_STRETCH * STRETCHES_PER_SHIFT; // 21600
export const SECONDS_PER_DAY = SECONDS_PER_STRETCH * STRETCHES_PER_DAY;     // 86400

/** Step sizes expressed in stretches, keyed by name. */
export const STEP_STRETCHES = {
  stretch: 1,
  hour: STRETCHES_PER_HOUR,
  shift: STRETCHES_PER_SHIFT,
  day: STRETCHES_PER_DAY
};

/** Total elapsed stretches since worldTime origin. */
export function stretchIndexFromSeconds(seconds) {
  return Math.floor(seconds / SECONDS_PER_STRETCH);
}

/**
 * Decompose an absolute world-time (seconds) into the display-relevant
 * pieces the HUD needs. `dayOffset` is whole days since origin; the
 * calendar layer turns that into a real date.
 */
export function decompose(seconds) {
  const totalStretches = stretchIndexFromSeconds(seconds);
  const dayOffset = Math.floor(totalStretches / STRETCHES_PER_DAY);
  const stretchOfDay = ((totalStretches % STRETCHES_PER_DAY) + STRETCHES_PER_DAY) % STRETCHES_PER_DAY;
  const shiftIndex = Math.floor(stretchOfDay / STRETCHES_PER_SHIFT);
  const stretchInShift = stretchOfDay % STRETCHES_PER_SHIFT;
  const hourOfShift = Math.floor(stretchInShift / STRETCHES_PER_HOUR);
  const stretchInHour = stretchInShift % STRETCHES_PER_HOUR;

  const minutesOfDay = stretchOfDay * 10;
  const hour = Math.floor(minutesOfDay / 60);
  const minute = minutesOfDay % 60;

  return {
    totalStretches,
    dayOffset,
    stretchOfDay,
    shiftIndex,
    stretchInShift,
    hourOfShift,
    stretchInHour,
    hour,
    minute,
    stretchesLeftInShift: STRETCHES_PER_SHIFT - stretchInShift,
    /** 0..1 progress through the current shift (for the active shift fill). */
    shiftProgress: (stretchInShift + 1) / STRETCHES_PER_SHIFT
  };
}

/** Format HH:MM (24h) from a decomposed time. */
export function formatClock({ hour, minute }) {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/**
 * Snap a world-time (seconds) to the nearest stretch boundary.
 * Used so manual nudges always land cleanly on a stretch.
 */
export function snapToStretch(seconds) {
  return Math.round(seconds / SECONDS_PER_STRETCH) * SECONDS_PER_STRETCH;
}

/** Snap a world-time (seconds) to the nearest shift boundary. */
export function snapToShift(seconds) {
  return Math.round(seconds / SECONDS_PER_SHIFT) * SECONDS_PER_SHIFT;
}

/** Seconds to advance to reach the start of the next shift from `seconds`. */
export function secondsToNextShift(seconds) {
  const snapped = snapToStretch(seconds);
  const into = ((snapped % SECONDS_PER_SHIFT) + SECONDS_PER_SHIFT) % SECONDS_PER_SHIFT;
  return into === 0 ? SECONDS_PER_SHIFT : SECONDS_PER_SHIFT - into;
}

/** Convert a step name (stretch|hour|shift|day) to seconds. */
export function stepToSeconds(step) {
  const stretches = STEP_STRETCHES[step];
  return stretches ? stretches * SECONDS_PER_STRETCH : 0;
}
