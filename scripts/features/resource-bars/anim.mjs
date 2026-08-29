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
 *
 * ── The shape of a change ──
 *
 * A value change is not one animation, it is a short sequence, and the order is
 * what makes it read as an event rather than as a transition:
 *
 *   0ms    the fill snaps to the new value and everything *stops*
 *   ~55ms  the hitstop releases; the ring and the compression spring both start
 *          from a standstill rather than from mid-flight
 *   ~180ms the chip trail begins to drain, white-hot, cooling as it goes
 *   ~380ms the fill's own recoil has settled back onto the value
 *   ~420ms the readout has finished counting to the new number
 *
 * The hitstop is the piece that is easy to leave out and impossible to unsee:
 * a beat of held frames before the reaction is most of what separates "the
 * number went down" from "that hurt".
 */

/**
 * Durations in unscaled milliseconds, each named for the `--gl-d-*` token it
 * mirrors from `styles/gl-tokens.css`. `motionScale` multiplies all of them,
 * exactly as `--gl-motion-scale` does for CSS.
 */
export const TIMING = Object.freeze({
  stopMs: 55,      // the hitstop: every channel holds its first frame
  holdMs: 180,     // --gl-d-quick   the beat before the chip trail starts draining
  drainMs: 540,    // --gl-d-glide   the trail's drain
  chipMs: 620,     // how long a fresh chip stays white-hot before cooling
  bloomMs: 260,    // --gl-d-brisk   heal flare at the leading edge
  flashMs: 70,     // --gl-d-flash   impact whiteout
  shockMs: 320,    // the compression spring through the fill (never the frame)
  reboundMs: 380,  // the fill's recoil past the new value and back onto it
  fillMs: 340,     // --gl-d-swift   the fill's own catch-up on a heal
  countMs: 420,    // the readout counting to the new number
  waveMs: 620,     // the front travelling the distance the value moved
  sweepInMs: 420,  // --gl-d-move    gloss fading in on hover
  sweepOutMs: 540, // --gl-d-glide   and back out
  hitMs: 480,      // the impact ring + spokes, from landing to gone
  punchMs: 300,    // the readout scaling up and settling back
  popupMs: 950,    // a floating delta, rise and fade
  hotMs: 2200,     // how long a bar keeps animating after a change (see COLD below)
});

/** Where the low-health state engages. Mirrored by ramp.mjs's LOW_HEALTH_AT. */
export const LOW_AT = 0.25;

/**
 * A floating delta's travel, as a fraction of the quad height.
 *
 * It starts already clear of the bar rather than rising out of it. A delta that
 * begins on the readout spends its first two hundred milliseconds sitting on
 * top of the number it is explaining, which is the one moment both are worth
 * reading.
 */
export const POPUP_LIFT = 0.62;
export const POPUP_RISE = 1.00;

/** Peak scale of the readout punch. */
export const PUNCH = 0.55;

/**
 * Peak of the compression spring.
 *
 * It drives the *contents* of the bar and nothing else. The frame does not
 * move, shake or scale: a HUD element that jumps around its own anchor reads as
 * a cheap screen-shake bolted onto a widget, and once you have seen it you
 * cannot see anything else. What sells an impact is the thing inside the frame
 * reacting while the frame stays exactly where it was.
 */
export const SHOCK = 0.62;

/** The furthest the fill may recoil past its new value, in fraction units. */
export const REBOUND = 0.055;

const clamp01 = (n) => (n < 0 ? 0 : n > 1 ? 1 : n);

/** Cubic ease-out — the drain and the readout's count. */
const easeOut = (t) => 1 - Math.pow(1 - t, 3);

/** Ease-out with overshoot: the heal runs past its target and settles back. */
const easeBack = (t) => {
  const u = t - 1;
  return 1 + 2.9 * u * u * u + 1.9 * u * u;
};

/** A spring released from rest: starts at its peak and rings down. */
const ring = (t) => (t >= 1 ? 0 : Math.sin(t * Math.PI * 2.6) * Math.pow(1 - t, 2.0));

/** A spring released from a *displaced* position: starts at 1 and rings to 0. */
const settle = (t) => (t >= 1 ? 0 : Math.cos(t * Math.PI * 2.4) * Math.pow(1 - t, 2.0));

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

    /** What the readout says. Counts to the new value instead of snapping. */
    this.num = this.frac;

    this.bloom = 0;
    this.flash = 0;
    this.sweep = 0;
    /** Compression through the bar's contents, signed, peaks at SHOCK. */
    this.shock = 0;
    /** How fresh the chip trail is: 1 the frame it is cut, 0 once cooled. */
    this.chip = 0;

    this._changedAt = -Infinity;
    this._stop = 0;
    this._hold = 0;
    this._drain = 1;
    this._ghostFrom = this.frac;
    this._fillFrom = this.frac;
    this._fillT = 1;
    this._numFrom = this.frac;
    this._numT = 1;
    this._bloomT = 1;
    this._flashT = 1;
    this._shockT = 1;
    this._chipT = 1;
    this._reboundT = 1;
    this._reboundAmp = 0;
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

    /* The change wave: a front that travels the span the value moved, in the
       direction it moved. `wave` is its amplitude, `waveX` where its front has
       got to as a fraction along the bar. Rendered by the shader; the two
       endpoints live here because only the model knows where the value came
       from. */
    this.wave = 0;
    this.waveX = this.frac;
    this._waveA = this.frac;
    this._waveB = this.frac;
    this._waveT = 1;

    /** Floating deltas, newest last. Each is { text, heal, t } with t in 0..1. */
    this.popups = [];
  }

  /** A duration in TIMING, scaled by the user's motion tier. 0 disables motion. */
  _ms(key) {
    return TIMING[key] * this.motionScale;
  }

  /**
   * Report a new value. `max` is only used to label the floating delta; the
   * bar itself is scale-free.
   *
   * Damage arms the chip trail, the recoil and the backward wave; healing arms
   * the bloom and lets the fill overshoot forward into the wave's wake — so a
   * heal reads as the bar being pushed outward rather than as a second, milder
   * copy of the damage animation.
   */
  set(frac, { silent = false, max = 0 } = {}) {
    const next = clamp01(frac);
    if (next === this.target) return;

    const damaged = next < this.target;
    const delta = next - this.target;
    const from = this.target;
    this.target = next;

    if (silent || this.motionScale === 0) {
      this.frac = this.ghost = this.num = next;
      this.waveX = next;
      return;
    }

    this._changedAt = this._now;
    this._stop = this._ms("stopMs");

    /* The impact fires for both directions — a heal that lands silently reads
       as a number quietly changing, which is the thing we are replacing. */
    this._hitT = 0;
    this._punchT = 0;
    this._shockT = 0;
    this.hitX = damaged ? next : this.frac;
    this.heal = damaged ? 0 : 1;

    /* The readout counts rather than snaps, in both directions. */
    this._numFrom = this.num;
    this._numT = 0;

    /* The wave runs across exactly the span that changed. */
    this._waveA = damaged ? from : this.frac;
    this._waveB = next;
    this._waveT = 0;

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
      this._chipT = 0;
      /* Recoil: the fill dips a little past the new value and springs back onto
         it. Scaled by the size of the hit, so a scratch does not bounce like a
         critical — an amplitude that ignores magnitude makes every hit feel the
         same, which is the failure this whole sequence exists to avoid. */
      this._reboundAmp = Math.min(REBOUND, Math.abs(delta) * 0.45);
      this._reboundT = 0;
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
      this.frac = this.ghost = this.num = this.target;
      this.bloom = this.flash = 0;
      this.hit = this.punch = this.shock = this.chip = this.wave = 0;
      this.popups.length = 0;
      this.sweep = this._hover ? 1 : 0;
      return false;
    }

    /* ── Hitstop ──────────────────────────────────────────────────────────
       Every channel holds its first frame for a beat. Nothing here is a tween;
       the point is the absence of one. Released, the ring and the compression
       spring both start from a standstill, which is what makes them read as a
       reaction to something rather than as the tail of a transition. */
    if (this._stop > 0) {
      this._stop -= dt;
      this.flash = 1;
      this.shock = SHOCK;
      this.chip = 1;
      this.hit = 1;
      this.wave = 1;
      this.waveX = this._waveA;
      return true;
    }

    /* Both of the value tweens below interpolate from a captured *start*
       value, never from the current one. Easing from the current value each
       frame compounds the curve: a 540ms drain lands in about 190ms and reads
       as a snap, which is a bug no one would ever file as one — the trail just
       quietly stops doing its job. */

    // The fill catches up on a heal, overshooting the target and settling back.
    if (this._fillT < 1) {
      this._fillT = Math.min(1, this._fillT + dt / Math.max(1, this._ms("fillMs")));
      this.frac = clamp01(this._fillFrom + (this.target - this._fillFrom) * easeBack(this._fillT));
      if (this._fillT >= 1) this.frac = this.target;
    }

    // …and recoils past it on a hit, springing back onto the value.
    if (this._reboundT < 1) {
      this._reboundT = Math.min(1, this._reboundT + dt / Math.max(1, this._ms("reboundMs")));
      this.frac = clamp01(this.target - this._reboundAmp * settle(this._reboundT));
      if (this._reboundT >= 1) this.frac = this.target;
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

    // The readout counts. A number that snaps is a number you did not see move.
    if (this._numT < 1) {
      this._numT = Math.min(1, this._numT + dt / Math.max(1, this._ms("countMs")));
      this.num = this._numFrom + (this.target - this._numFrom) * easeOut(this._numT);
      if (this._numT >= 1) this.num = this.target;
    }

    const adv = (t, key) => (t >= 1 ? 1 : Math.min(1, t + dt / Math.max(1, this._ms(key))));
    this._bloomT = adv(this._bloomT, "bloomMs");
    this._flashT = adv(this._flashT, "flashMs");
    this._shockT = adv(this._shockT, "shockMs");
    this._chipT = adv(this._chipT, "chipMs");
    this._waveT = adv(this._waveT, "waveMs");

    this._hitT = adv(this._hitT, "hitMs");
    this._punchT = adv(this._punchT, "punchMs");

    this.bloom = 1 - this._bloomT;
    this.flash = 1 - this._flashT;
    this.shock = ring(this._shockT) * SHOCK;
    this.chip = Math.pow(1 - this._chipT, 1.8);

    /* The wave travels the whole span in the first half of its life and spends
       the rest fading where it landed. A front that fades *while* travelling
       never arrives anywhere, and arriving is the part that reads. */
    const wt = this._waveT;
    this.waveX = this._waveA + (this._waveB - this._waveA) * easeOut(Math.min(1, wt / 0.55));
    this.wave = wt >= 1 ? 0 : Math.pow(1 - wt, 1.5);

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
    if (this._stop > 0) return true;
    if (this._hover || this.sweep > 0) return true;
    if (this.ghost !== this.frac || this._fillT < 1 || this._reboundT < 1) return true;
    if (this._bloomT < 1 || this._flashT < 1) return true;
    if (this._shockT < 1 || this._chipT < 1 || this._waveT < 1 || this._numT < 1) return true;
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
  "sweep", "popups", "sparks", "wave", "shock", "ring", "numbers", "punch", "ghost", "bloom",
]);
