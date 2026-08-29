/**
 * GLUniverse Suite — resource bars: the animation model.
 *
 * Pure and dependency-free: this module owns *when* a bar looks like what, and
 * knows nothing about PIXI, Foundry, or the DOM. That is what lets the preview
 * harness drive the real thing rather than an approximation of it.
 *
 * Every duration lives in TIMING and nowhere else. `tools/resource-bar-check.mjs`
 * pins that — a raw `260` in the update path would survive every test while
 * silently ignoring the user's motion tier, which is not a failure anyone would
 * report as a bug.
 */

/**
 * Durations in unscaled milliseconds, each named for the `--gl-d-*` token it
 * mirrors from `styles/gl-tokens.css`. `motionScale` multiplies all of them,
 * exactly as `--gl-motion-scale` does for CSS.
 */
export const TIMING = Object.freeze({
  holdMs: 180,     // --gl-d-quick   the beat before the chip trail starts draining
  drainMs: 540,    // --gl-d-glide   the trail's drain
  bloomMs: 260,    // --gl-d-brisk   heal flare at the leading edge
  flashMs: 70,     // --gl-d-flash   impact whiteout
  kickMs: 260,     // --gl-d-brisk   the damped positional shake
  fillMs: 340,     // --gl-d-swift   the fill's own catch-up on a heal
  sweepInMs: 420,  // --gl-d-move    gloss fading in on hover
  sweepOutMs: 540, // --gl-d-glide   and back out
  hitMs: 480,      // the impact ring + spokes, from landing to gone
  punchMs: 300,    // the readout scaling up and settling back
  popupMs: 950,    // a floating delta, rise and fade
  hotMs: 2200,     // how long a bar keeps animating after a change (see COLD below)
});

/** Where the low-health state engages. Mirrored by ramp.mjs's LOW_HEALTH_AT. */
export const LOW_AT = 0.25;

/** Peak displacement of the impact kick, in device pixels. */
export const KICK_PX = 2.4;

/** How far a floating delta rises, as a fraction of the quad height. */
export const POPUP_RISE = 1.15;

/** Peak scale of the readout punch. */
export const PUNCH = 0.42;

const clamp01 = (n) => (n < 0 ? 0 : n > 1 ? 1 : n);

/** Cubic ease-out — the drain and the fill catch-up. */
const easeOut = (t) => 1 - Math.pow(1 - t, 3);

/** Damped oscillation for the impact kick: two visible swings, then still. */
const kick = (t) => (t >= 1 ? 0 : Math.sin(t * Math.PI * 3.4) * Math.pow(1 - t, 2.2));

/**
 * One bar's live visual state.
 *
 * The contract with the renderer is `hot`: while false, the bar's uniforms are
 * unchanged from the previous frame and the shared ticker may skip it entirely.
 * This is what keeps a 40-token combat at frame rate — a resource bar's job is
 * to be interesting when it changes and silent when it does not.
 */
export class BarAnim {
  constructor(frac = 1, { motionScale = 1 } = {}) {
    this.frac = clamp01(frac);
    this.ghost = this.frac;
    this.target = this.frac;
    this.motionScale = motionScale;

    this.bloom = 0;
    this.flash = 0;
    this.kick = 0;
    this.sweep = 0;

    this._changedAt = -Infinity;
    this._hold = 0;
    this._drain = 1;
    this._ghostFrom = this.frac;
    this._fillFrom = this.frac;
    this._fillT = 1;
    this._bloomT = 1;
    this._flashT = 1;
    this._kickT = 1;
    this._hover = false;
    this._now = 0;

    /* Impact state. `hitX` is where the value *was* when it changed, so the
       ring emanates from the point on the bar that moved rather than from its
       middle — the difference between an effect that belongs to the event and
       one that belongs to the widget. */
    this.hit = 0;
    this.hitX = 1;
    this.heal = 0;
    this.punch = 0;
    this._hitT = 1;
    this._punchT = 1;

    /** Floating deltas, newest last. Each is { text, heal, t } with t in 0..1. */
    this.popups = [];
  }

  /** A duration in TIMING, scaled by the user's motion tier. 0 disables motion. */
  _ms(key) {
    return TIMING[key] * this.motionScale;
  }

  /**
   * Report a new value. Damage arms the chip trail; healing arms the bloom and
   * lets the fill catch up while the ghost waits where it is — so a heal reads
   * as the bar advancing into the trail rather than as a second animation.
   */
  /**
   * Report a new value. `max` is only used to label the floating delta; the
   * bar itself is scale-free.
   */
  set(frac, { silent = false, max = 0 } = {}) {
    const next = clamp01(frac);
    if (next === this.target) return;

    const damaged = next < this.target;
    const delta = next - this.target;
    this.target = next;

    if (silent || this.motionScale === 0) {
      this.frac = this.ghost = next;
      return;
    }

    this._changedAt = this._now;

    /* The impact fires for both directions — a heal that lands silently reads
       as a number quietly changing, which is the thing we are replacing. */
    this._hitT = 0;
    this._punchT = 0;
    this.hitX = damaged ? next : this.frac;
    this.heal = damaged ? 0 : 1;

    if (max > 0) {
      const n = Math.round(Math.abs(delta) * max);
      if (n > 0) {
        this.popups.push({ text: (damaged ? "-" : "+") + n, heal: damaged ? 0 : 1, t: 0 });
        /* A burst of small hits must not become a wall of text. */
        if (this.popups.length > 4) this.popups.shift();
      }
    }

    if (damaged) {
      // The fill drops immediately; the ghost stays put and drains after a beat.
      this.ghost = Math.max(this.ghost, this.frac);
      this.frac = next;
      this._hold = this._ms("holdMs");
      this._drain = 0;
      this._ghostFrom = this.ghost;
      this._flashT = 0;
      this._kickT = 0;
    } else {
      this._fillFrom = this.frac;
      this._fillT = 0;
      this._bloomT = 0;
    }
  }

  /** Hover / control state drives the specular sweep, and nothing else. */
  setHover(on) {
    this._hover = !!on;
  }

  /**
   * Advance by `dt` milliseconds. Returns true while the bar still needs
   * frames — the renderer's cue to keep it in the ticker.
   */
  step(dt) {
    this._now += dt;
    const s = this.motionScale;

    if (s === 0) {
      this.frac = this.ghost = this.target;
      this.bloom = this.flash = this.kick = 0;
      this.hit = this.punch = 0;
      this.popups.length = 0;
      this.sweep = this._hover ? 1 : 0;
      return false;
    }

    /* Both of the value tweens below interpolate from a captured *start*
       value, never from the current one. Easing from the current value each
       frame compounds the curve: a 540ms drain lands in about 190ms and reads
       as a snap, which is a bug no one would ever file as one — the trail just
       quietly stops doing its job. */

    // The fill catches up on a heal (on damage it is already at target).
    if (this._fillT < 1) {
      this._fillT = Math.min(1, this._fillT + dt / Math.max(1, this._ms("fillMs")));
      this.frac = this._fillFrom + (this.target - this._fillFrom) * easeOut(this._fillT);
      if (this._fillT >= 1) this.frac = this.target;
    }

    // The chip trail: hold, then drain to meet the fill.
    if (this.ghost > this.frac) {
      if (this._hold > 0) this._hold -= dt;
      else {
        this._drain = Math.min(1, this._drain + dt / Math.max(1, this._ms("drainMs")));
        this.ghost = this._ghostFrom + (this.frac - this._ghostFrom) * easeOut(this._drain);
        if (this._drain >= 1) this.ghost = this.frac;
      }
    } else if (this.ghost < this.frac) {
      this.ghost = this.frac;
    }

    const adv = (t, key) => (t >= 1 ? 1 : Math.min(1, t + dt / Math.max(1, this._ms(key))));
    this._bloomT = adv(this._bloomT, "bloomMs");
    this._flashT = adv(this._flashT, "flashMs");
    this._kickT = adv(this._kickT, "kickMs");

    this._hitT = adv(this._hitT, "hitMs");
    this._punchT = adv(this._punchT, "punchMs");

    this.bloom = 1 - this._bloomT;
    this.flash = 1 - this._flashT;
    this.kick = kick(this._kickT) * KICK_PX;

    /* The ring fades on a curve, not a line: a linear decay reads as a shape
       being scaled rather than as light going out. */
    this.hit = Math.pow(1 - this._hitT, 1.6);
    /* Overshoot and settle. The readout is the thing the eye is on during a
       change, so it gets the most pronounced easing on the bar. */
    this.punch = this._punchT >= 1 ? 0
      : Math.sin(this._punchT * Math.PI) * Math.pow(1 - this._punchT, 0.55) * PUNCH;

    for (const pop of this.popups) pop.t = Math.min(1, pop.t + dt / Math.max(1, this._ms("popupMs")));
    while (this.popups.length && this.popups[0].t >= 1) this.popups.shift();

    // Sweep fades in on hover and out again; it is never on at rest.
    const wantSweep = this._hover ? 1 : 0;
    const sweepRate = dt / Math.max(1, this._ms(wantSweep ? "sweepInMs" : "sweepOutMs"));
    this.sweep += (wantSweep - this.sweep) * clamp01(sweepRate * 2.2);
    if (Math.abs(wantSweep - this.sweep) < 0.004) this.sweep = wantSweep;

    return this.hot;
  }

  /** Low-health state, ramped over the band just above the threshold so it
   *  arrives rather than snaps. */
  get low() {
    return clamp01((LOW_AT - this.frac) / LOW_AT);
  }

  /**
   * Whether this bar still needs frames. Cold bars are dropped from the shared
   * ticker entirely; they keep their last drawn frame.
   */
  get hot() {
    if (this.motionScale === 0) return false;
    if (this._hover || this.sweep > 0) return true;
    if (this.ghost !== this.frac || this._fillT < 1) return true;
    if (this._bloomT < 1 || this._flashT < 1 || this._kickT < 1) return true;
    if (this._hitT < 1 || this._punchT < 1 || this.popups.length) return true;
    if (this.low > 0) return true; // the low-health pulse is continuous by design
    return this._now - this._changedAt < this._ms("hotMs");
  }
}

/**
 * The shed order under load, cheapest sacrifice first. The renderer walks this
 * list and disables effects until it is inside budget; the check tool pins that
 * every animated behaviour appears here, so a new effect cannot be added that
 * never degrades.
 */
export const SHED_ORDER = Object.freeze([
  "sweep", "popups", "sparks", "ring", "numbers", "punch", "ghost", "kick", "bloom",
]);
