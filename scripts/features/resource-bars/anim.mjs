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
 *   ~55ms  the hitstop releases; the sweep and the ring both start from a
 *          standstill rather than from mid-flight
 *   ~180ms the chip trail begins to drain, white-hot, cooling as it goes
 *   ~420ms the readout has finished counting to the new number
 *   ~720ms the sweep has crossed the bar and gone
 *
 * Two pieces carry it. The **hitstop** is easy to leave out and impossible to
 * unsee afterwards: a beat of held frames before the reaction is most of what
 * separates "the number went down" from "that hurt". The **sweep** is what you
 * catch from the corner of your eye — a front crossing the whole bar in the
 * direction the value moved.
 *
 * What is deliberately absent is any spring. No overshoot, no recoil, no
 * settle, and nothing at all touching the fill's height. Springs are the
 * standard way to make a bar feel alive and on a bar they read as jelly; an
 * instrument that wobbles is an instrument you stop trusting. Every length here
 * decelerates once, cleanly, and stops.
 */

/**
 * Durations in unscaled milliseconds, each named for the `--gl-d-*` token it
 * mirrors from `styles/gl-tokens.css`. `motionScale` multiplies all of them,
 * exactly as `--gl-motion-scale` does for CSS.
 */
export const TIMING = Object.freeze({
  idleLoopMs: 64000, // four refraction cycles; exact wrap for every idle channel
  clockMs: 1000,   // shader clock, milliseconds per second
  stopMs: 55,      // the hitstop: every channel holds its first frame
  holdMs: 180,     // --gl-d-quick   the beat before the chip trail starts draining
  drainMs: 540,    // --gl-d-glide   the trail's drain
  chipMs: 620,     // how long a fresh chip stays white-hot before cooling
  bloomMs: 260,    // --gl-d-brisk   heal flare at the leading edge
  flashMs: 70,     // --gl-d-flash   impact whiteout
  fillMs: 430,     // --gl-d-swift   the fill's own catch-up on a heal
  countMs: 420,    // the readout counting to the new number
  waveMs: 440,     // the wave crossing the bar
  sweepInMs: 420,  // --gl-d-move    gloss fading in on hover
  sweepOutMs: 540, // --gl-d-glide   and back out
  hitMs: 480,      // the impact ring + spokes, from landing to gone
  punchMs: 300,    // the readout scaling up and settling back
  popupMs: 950,    // a floating delta, rise and fade
  hotMs: 2200,     // how long a bar keeps animating after a change (see COLD below)
  breakInMs: 715,  // the guard-break fracture spreading (see BREAK_SETTLE_S)
  breakOutMs: 320, // --gl-d-brisk   and fading again when the break is cleared
});

/** Where the low-health state engages. Mirrored by ramp.mjs's LOW_HEALTH_AT. */
export const LOW_AT = 0.25;

/**
 * Where the shared fracture stops spreading, in its own clock's units.
 *
 * `core/fx-glsl.mjs`'s field drives the shatter off `clamp(time * 1.4, 0, 1)`,
 * so it saturates here and the crack is fully formed. TIMING.breakInMs is the
 * real time this model takes to walk the clock that far, and at full motion the
 * two agree by construction — the bar shatters in step with the same creature's
 * token, which is the point of sharing the field at all.
 */
export const BREAK_SETTLE_S = 1 / 1.4;

/**
 * Where the fracture's clock wraps, so it cannot drift into float mush over a
 * long session.
 *
 * Not an arbitrary big number: the two things still moving once the crack has
 * settled are its pulse (`sin(t * 2.2)`) and the energy flowing along the seams
 * (`sin(… - t * 3.2)`), and 10π is a whole number of cycles of *both* — 11 and
 * 16 respectively. Wrapping anywhere else steps the fracture mid-breath, once
 * every few minutes, on a bar nobody is watching at the time.
 */
export const BREAK_WRAP = Math.PI * 10;

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
export const PUNCH = 0.08;

const clamp01 = (n) => (n < 0 ? 0 : n > 1 ? 1 : n);

/** Cubic ease-out — the readout's count, which should arrive rather than creep. */
const easeOut = (t) => 1 - Math.pow(1 - t, 3);

/**
 * Quintic ease-out. Everything that moves a *length* uses this.
 *
 * No overshoot, no oscillation, no spring. An earlier pass had the fill recoil
 * past its new value and ring back onto it, and the trail settle the same way;
 * both are the standard way to make a bar feel alive and both read, on a bar,
 * as jelly. A health bar is an instrument. What makes it satisfying is a long
 * clean deceleration that arrives exactly once and stops.
 */
const glide = (t) => 1 - Math.pow(1 - t, 5);

/**
 * The sweep's own travel: near-linear, with only a slight deceleration.
 *
 * A quintic here would put the front three-quarters of the way down the bar in
 * the first fifth of its life and then crawl, which is the wrong shape for the
 * one thing meant to be caught peripherally — by the time the eye arrives the
 * crossing has already happened. A sweep wants to be *seen* crossing.
 */
const travel = (t) => 1 - Math.pow(1 - t, 1.7);

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
    this._chipT = 1;
    this._hover = false;
    this._now = 0;
    this.time = 0;
    this.idleFrozen = false;

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

    /* The guard break. `broken` is how present the fracture is (the shatter is
       its own arrival, so this goes to 1 at once and only fades on the way out);
       `breakT` is the shared field's clock; `breakX` is where it nucleated,
       captured once rather than followed. */
    this.broken = 0;
    this.breakT = 0;
    this.breakX = this.frac;
    /** Set by the renderer from the shed budget: freeze the fracture, keep it. */
    this.breakFrozen = false;
    this._breakOn = false;
    this._breakOutT = 1;

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
   * Damage arms the chip trail and a sweep running back down the bar; healing
   * arms the bloom and a sweep running out along it, with the fill gliding up
   * behind the front — so a heal reads as the bar being pushed outward rather
   * than as a second, milder copy of the damage animation.
   */
  set(frac, { silent = false, max = 0 } = {}) {
    const next = clamp01(frac);
    if (next === this.target) return;

    // Cancel the previous length tween before changing direction. A damage
    // event during a heal must not keep interpolating from the old heal origin.
    this._fillT = 1;
    this._bloomT = 1;
    this._flashT = 1;
    this._chipT = 1;
    const damaged = next < this.target;
    const delta = next - this.target;
    const from = this.target;
    this.target = next;

    if (silent || this.motionScale === 0) {
      this.frac = this.ghost = this.num = next;
      this.waveX = next;
      this._stop = this._hold = 0;
      this._drain = this._fillT = this._numT = 1;
      this._hitT = this._punchT = this._waveT = 1;
      this.bloom = this.flash = this.hit = this.punch = this.chip = this.wave = 0;
      this.popups.length = 0;
      return;
    }

    this._changedAt = this._now;
    this._stop = this._ms("stopMs");

    /* The impact fires for both directions — a heal that lands silently reads
       as a number quietly changing, which is the thing we are replacing. */
    this._hitT = 0;
    this._punchT = 0;
    this.hitX = damaged ? next : this.frac;
    this.heal = damaged ? 0 : 1;

    /* The readout counts rather than snaps, in both directions. */
    this._numFrom = this.num;
    this._numT = 0;

    /* The sweep crosses the *whole* bar, not just the span that changed.
       Scoped to the delta it is a detail you have to already be looking at the
       bar to catch, and on a one-point heal it is a flicker two pixels wide.
       Crossing the full length in the direction the value moved makes it the
       thing that tells you, from the corner of your eye, that something
       happened and which way — which is the job. */
    this._waveA = damaged ? 1 : 0;
    this._waveB = damaged ? 0 : 1;
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
    } else {
      this._fillFrom = this.frac;
      this._fillT = 0;
      this._bloomT = 0;
    }
  }

  /**
   * Report the creature's guard-break state.
   *
   * `at` is the fill fraction the fracture nucleates on, captured *now* and then
   * held: the crack belongs to the moment the guard went, so following the fill
   * through the next three hits would make it a decal rather than damage.
   *
   * There is no fade *in*. The shatter is the arrival — a fracture that fades up
   * is a fracture that was always there and only just became visible, which is
   * the opposite of what happened. Clearing it does fade, because nothing
   * un-shatters and a crack that vanishes between two frames reads as a glitch.
   */
  setBroken(on, { at = this.frac } = {}) {
    const next = !!on;
    if (next === this._breakOn) return;
    this._breakOn = next;
    if (next) {
      this.breakX = clamp01(at);
      this.broken = 1;
      this._breakOutT = 1;
      /* At motion "none" the fracture is a fact, not an animation: it arrives
         already settled and its clock never moves again. */
      this.breakT = this.motionScale === 0 ? BREAK_SETTLE_S : 0;
    } else {
      this._breakOutT = this.motionScale === 0 ? 1 : 0;
      if (this.motionScale === 0) this.broken = 0;
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
      this.hit = this.punch = this.chip = this.wave = 0;
      this.popups.length = 0;
      this.sweep = this._hover ? 1 : 0;
      /* The fracture is state, not motion, so it survives the tier that turns
         every animation off — it just arrives fully formed and stops. */
      this.broken = this._breakOn ? 1 : 0;
      this.breakT = BREAK_SETTLE_S;
      return false;
    }

    /* ── Hitstop ──────────────────────────────────────────────────────────
       Every channel holds its first frame for a beat. Nothing here is a tween;
       the point is the absence of one. Released, the sweep and the ring both
       start from a standstill, which is what makes them read as a reaction to
       something rather than as the tail of a transition. */
    if (this._stop > 0) {
      this._stop -= dt;
      this.flash = 1;
      this.chip = 1;
      this.hit = 1;
      this.wave = 1;
      this.waveX = this._waveA;
      return true;
    }

    if (!this.idleFrozen) this.time = (this.time + dt / (TIMING.clockMs * s))
      % (TIMING.idleLoopMs / TIMING.clockMs);

    /* Both of the value tweens below interpolate from a captured *start*
       value, never from the current one. Easing from the current value each
       frame compounds the curve: a 540ms drain lands in about 190ms and reads
       as a snap, which is a bug no one would ever file as one — the trail just
       quietly stops doing its job. */

    // The fill glides up to meet a heal. One deceleration, no overshoot.
    if (this._fillT < 1) {
      this._fillT = Math.min(1, this._fillT + dt / Math.max(1, this._ms("fillMs")));
      this.frac = clamp01(this._fillFrom + (this.target - this._fillFrom) * glide(this._fillT));
      if (this._fillT >= 1) this.frac = this.target;
    }

    // The chip trail: hold, then drain to meet the fill.
    if (this.ghost > this.frac) {
      if (this._hold > 0) this._hold -= dt;
      else {
        this._drain = Math.min(1, this._drain + dt / Math.max(1, this._ms("drainMs")));
        this.ghost = this._ghostFrom + (this.frac - this._ghostFrom) * glide(this._drain);
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
    this._chipT = adv(this._chipT, "chipMs");
    this._waveT = adv(this._waveT, "waveMs");

    this._hitT = adv(this._hitT, "hitMs");
    this._punchT = adv(this._punchT, "punchMs");

    this.bloom = 1 - this._bloomT;
    this.flash = 1 - this._flashT;
    this.chip = Math.pow(1 - this._chipT, 1.8);

    /* The sweep crosses in the first three-quarters of its life at full
       strength and fades out over the last quarter. A front that fades *while*
       it travels never arrives anywhere, and arriving is the part that reads. */
    const wt = this._waveT;
    this.waveX = this._waveA + (this._waveB - this._waveA) * travel(Math.min(1, wt / 0.72));
    this.wave = wt >= 1 ? 0 : Math.min(1, (1 - wt) / 0.28);

    /* The ring fades on a curve, not a line: a linear decay reads as a shape
       being scaled rather than as light going out. */
    this.hit = Math.pow(1 - this._hitT, 1.6);
    /* Overshoot and settle. The readout is the thing the eye is on during a
       change, so it gets the most pronounced easing on the bar. */
    this.punch = this._punchT >= 1 ? 0
      : Math.sin(this._punchT * Math.PI) * Math.pow(1 - this._punchT, 0.55) * PUNCH;

    for (const pop of this.popups) pop.t = Math.min(1, pop.t + dt / Math.max(1, this._ms("popupMs")));
    while (this.popups.length && this.popups[0].t >= 1) this.popups.shift();

    /* The fracture's clock. One rate for the whole life of the crack: the same
       walk that spreads it in TIMING.breakInMs then carries its pulse and its
       flow, so at full motion both run in real seconds and match the token's. */
    if (this._breakOn || this.broken > 0) {
      if (!this.breakFrozen) {
        this.breakT += (dt / Math.max(1, this._ms("breakInMs"))) * BREAK_SETTLE_S;
        if (this.breakT > BREAK_WRAP) this.breakT -= BREAK_WRAP;
      }
      if (!this._breakOn) {
        this._breakOutT = adv(this._breakOutT, "breakOutMs");
        this.broken = 1 - this._breakOutT;
      }
    }

    // A quiet idle glint strengthens on hover.
    const wantSweep = this._hover ? 1 : 0.22;
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
    if (this._hover || this.sweep > 0.23) return true;
    if (this.ghost !== this.frac || this._fillT < 1) return true;
    if (this._bloomT < 1 || this._flashT < 1) return true;
    if (this._chipT < 1 || this._waveT < 1 || this._numT < 1) return true;
    if (this._hitT < 1 || this._punchT < 1 || this.popups.length) return true;
    if (this.low > 0) return true; // the low-health pulse is continuous by design
    /* A settled fracture is still breathing, so a broken creature's bar stays
       hot for as long as it is broken — the same standing cost as low health,
       and the same reason. Freezing it is the shed's job, not this one's. */
    if (this.broken > 0 && !this.breakFrozen) return true;
    return this._now - this._changedAt < this._ms("hotMs");
  }
}

/**
 * The shed order under load, cheapest sacrifice first. The renderer walks this
 * list and disables effects until it is inside budget; the check tool pins that
 * every animated behaviour appears here, so a new effect cannot be added that
 * never degrades.
 *
 * `breakFlow` sits second because it is one of only two standing costs in the
 * list — everything after it is transient, paid once per change, while a broken
 * creature's bar is hot for as long as it is broken. Giving it up freezes the
 * fracture at its settled frame and drops that bar out of the ticker; the crack
 * stays exactly where it was. What degrades is the motion, never the state: a
 * shed that could hide "this creature's guard is broken" would be trading the
 * information for the frame rate, which is not a trade this list is allowed to
 * make.
 */
export const SHED_ORDER = Object.freeze([
  "sweep", "breakFlow", "popups", "sparks", "ring", "numbers", "punch", "ghost",
  "wave", "bloom",
]);
