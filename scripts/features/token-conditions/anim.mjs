/**
 * GLUniverse Suite — token conditions: the animation model.
 *
 * Dependency-free and side-effect-free by design, like the resource bar's
 * `anim.mjs` and for the same reason: the preview harness inlines this file
 * verbatim, so the page demonstrates the beat the module actually has rather
 * than a reimplementation of it that drifted.
 *
 * ── The shape of an application ──────────────────────────────────────────
 *
 * | 0ms    | the plate exists, at nothing, and everything holds       |
 * | ~55ms  | the hitstop releases and the print starts from a standstill |
 * | ~305ms | the wipe has crossed the plate and the front is gone     |
 * | ~355ms | the flash has decayed and the plate is at rest           |
 *
 * The hold is the load-bearing beat, exactly as it is on the bar. A freeze
 * before a reaction is most of what separates "a plate appeared" from "something
 * was applied to this creature", and it costs 55 milliseconds.
 *
 * Nothing scales and nothing springs. The resource bar refuses to move its
 * geometry because an instrument that wobbles is an instrument you stop
 * trusting, and two neighbouring instruments that disagree about that read as
 * two different HUDs rather than as one.
 */

/** Milliseconds. Every one of these is multiplied by `motionScale`. */
export const TIMING = Object.freeze({
  holdIn: 55,      // the hitstop before an arrival
  printIn: 250,    // the wipe across
  flashIn: 300,    // the white-hot decay
  holdOut: 40,     // shorter going away: a removal is news, not an event
  printOut: 190,
  flashOut: 210,
  /* The hover unfold, end to end. It is a *response to the cursor*, so it is
     held to the budget every hover interface is held to rather than to the
     pace of the print: past about 200ms a hover stops feeling like the thing
     answering you and starts feeling like the thing thinking about it. */
  unfold: 150,
});

/** A quintic ease-out: one long deceleration that arrives exactly once. */
const easeOut = (t) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 5);

/**
 * One plate's arrival and departure.
 *
 * `enter` is the only geometric channel and it runs both ways, which is the
 * whole design: a removal is the arrival reversed, so there is no second code
 * path to keep in agreement with the first, and a plate removed mid-print
 * un-prints from wherever it had got to rather than snapping to full first.
 */
export class PlateAnim {
  constructor({ motionScale = 1 } = {}) {
    this.motionScale = motionScale;
    this.enter = 0;
    this.flash = 1;
    this.target = 1;
    this.from = 0;
    this.t = 0;
    this.dead = false;
  }

  /** Point the plate at a new state, starting from wherever it is now. */
  retarget(target) {
    if (this.target === target) return;
    this.from = this.enter;
    this.target = target;
    this.t = 0;
    this.flash = 1;
    this.dead = false;
  }

  /**
   * With motion off entirely, there is no beat to run: a plate is either there
   * or it is not, and holding one at 40% for a fifth of a second is a stutter
   * rather than a reduced animation.
   */
  get still() {
    return this.motionScale <= 0;
  }

  step(dt) {
    if (this.still) {
      this.enter = this.target;
      this.flash = 0;
      this.dead = this.target === 0;
      return;
    }
    this.t += dt;
    const scale = this.motionScale;
    const hold = (this.target ? TIMING.holdIn : TIMING.holdOut) * scale;
    const print = (this.target ? TIMING.printIn : TIMING.printOut) * scale;
    const flash = (this.target ? TIMING.flashIn : TIMING.flashOut) * scale;

    const u = (this.t - hold) / Math.max(print, 1);
    this.enter = this.from + (this.target - this.from) * easeOut(u);
    this.flash = Math.max(0, 1 - this.t / Math.max(flash, 1));
    if (u >= 1) {
      this.enter = this.target;
      if (!this.target) this.dead = true;
    }
  }

  /** Whether this plate still needs frames. */
  get hot() {
    if (this.still) return false;
    return this.flash > 0.001 || this.enter !== this.target;
  }
}

/**
 * What is given up, cheapest first, when the frame budget runs out.
 *
 * Every animated behaviour in this feature must appear here, and
 * `tools/token-conditions-check.mjs` enforces it — an effect that is not in the
 * list is one that never degrades, so a forty-token encounter pays for it
 * whatever the frame time. The order is deliberate: the breath is a warning, the
 * flash is the punctuation on an event, and the print is the event itself, so
 * the event is the last thing to go.
 *
 * The expansion is not in the list and must not be: it only runs on the one
 * token under the cursor, it is what the viewer just asked for, and a hover that
 * stops answering under load is a broken control rather than a degraded effect.
 */
export const SHED_ORDER = Object.freeze(["breath", "flash", "print"]);

/** Frame time, in ms, above which the next effect in SHED_ORDER is given up. */
export const SHED_AT = 22;

/** …and below which one is taken back. Hysteresis, so it cannot oscillate. */
export const UNSHED_AT = 15;
