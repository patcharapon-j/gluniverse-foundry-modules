/**
 * Every targeting line duration, in milliseconds. `TargetLine` animates with these and the controller
 * schedules turn hand-offs from them, so the two cannot drift apart.
 *
 * These used to live in `stream/constants.js` beside the stream rig's own timings. They are this feature's,
 * so they live here; the old export there is no longer read by anything in the line.
 *
 * There are no hold loops. A line that has landed is still: it says who is aiming at whom, and a line that
 * keeps moving after that only competes with the map for attention. Every beat below answers a change.
 */
export const TARGET_LINE_MOTION = Object.freeze({
  /** Launch: the body drawing out from the source to full length; the head lands over its last stretch. */
  launchMs: 520,
  /** Launch: the brackets start closing on the target once the launch is this far along... */
  lockDelayMs: 220,
  /** ...and lock over this long, landing just after the line. */
  lockMs: 360,
  /** A target that goes: its brackets open back out and fade over this long. */
  releaseMs: 220,
  /** Retract: the body drawing back into the source from full length. */
  retractMs: 340,
  /** Retract: the head fades out within the first 15% of it, so it never trails a withdrawing body. */
  headFadeOutMs: 50,
  /** Hand-off: the pause, body absent and brackets dimmed, between the retract and the relaunch. */
  handoffBeatMs: 140,
  /** Hand-off: a hairline ring sinks into the old source over the end of the retract... */
  originSinkMs: 200,
  /** ...and rises out of the new one at the start of the relaunch. */
  originRiseMs: 240,
  /** Calm motion (Foundry's photosensitive mode) replaces launch and retract with plain fades. */
  calmFadeInMs: 380,
  calmFadeOutMs: 300,
  calmHandoffBeatMs: 180
});
