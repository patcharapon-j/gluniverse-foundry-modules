/**
 * When a stored grade change should land on this client.
 *
 * Pure: no `game`, no clock of its own. A writer that wants the relight to
 * land at a particular moment — Theatre's cut lands it behind the black —
 * carries the timing in the scene update's OPTIONS, which Foundry hands to the
 * `updateScene` hook on every client along with the change:
 *
 *   options[TWEEN_OPTION] = { at, delayMs, durationMs }
 *
 *   at          the writer's `game.time.serverTime` when it wrote (ms)
 *   delayMs     how long after `at` the tween starts
 *   durationMs  how long the tween takes; omitted = Stage's own default
 *
 * Both durations are taken as already motion-scaled: the writer owns its
 * timeline. Each client measures how much of the delay is left against its own
 * `game.time.serverTime`, so a client that received the update late still
 * lands the relight at the same moment as everyone else — or, past that
 * moment, finishes the tween in whatever time is left, or snaps.
 */

/** The update-options key Stage reads its tween timing from. */
export const TWEEN_OPTION = "glStageTween";

/** A delay longer than this is a broken clock, not an intention. */
export const MAX_DELAY_MS = 60000;

const finite = (v) => typeof v === "number" && Number.isFinite(v);

/**
 * Turn the option a writer stamped into what `StagePostFX.setGrade` takes.
 *
 * @param {object|null} opt  `options[TWEEN_OPTION]`, or anything else.
 * @param {number} now       This client's `game.time.serverTime`.
 * @returns {{delayMs:number, durationMs?:number, immediate?:boolean}|null}
 *          null when there is no usable option — the caller then behaves
 *          exactly as it did before the option existed.
 */
export function resolveTweenTiming(opt, now) {
  if (!opt || typeof opt !== "object") return null;
  const delay = Math.min(Math.max(finite(opt.delayMs) ? opt.delayMs : 0, 0), MAX_DELAY_MS);
  const duration = finite(opt.durationMs) ? Math.max(opt.durationMs, 0) : undefined;
  const out = (delayMs, durationMs) => (durationMs === undefined ? { delayMs } : { delayMs, durationMs });

  // No stamp (or no clock): the delay counts from now.
  if (!finite(opt.at) || !finite(now)) return out(delay, duration);

  const remaining = Math.min(delay - (now - opt.at), MAX_DELAY_MS);
  if (remaining >= 0) return out(remaining, duration);

  // Late. With a known duration, finish in what is left of it; past its end,
  // snap. With the default duration there is no end to be past — just start.
  if (duration === undefined) return { delayMs: 0 };
  const left = duration + remaining;
  return left > 0 ? { delayMs: 0, durationMs: left } : { delayMs: 0, immediate: true };
}
