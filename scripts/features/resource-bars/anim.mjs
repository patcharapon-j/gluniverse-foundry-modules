/**
 * GLUniverse Suite — resource bars: the animation model.
 *
 * This module owns *when* a bar looks like what, and knows nothing about PIXI,
 * Foundry, or the DOM. That is what lets the preview harness drive the real
 * thing rather than an approximation of it.
 *
 * Every duration lives in TIMING and nowhere else. `tools/resource-bar-check.mjs`
 * pins that — a raw `260` in the update path would survive every test while
 * silently ignoring the user's motion tier, which is not a failure anyone would
 * report as a bug.
 *
 * ── anime.js, sought rather than played ──
 *
 * The tweens are anime.js timelines and animations, and none of them is ever
 * *played*. Each is built with `autoplay: false` and moved with `.seek(ms)` on
 * this model's own clock, which the PIXI ticker advances through `step(dt)`.
 *
 * The suite's anime.js engine is shared — Insight, the initiative tracker and
 * half a dozen other features run their DOM animations on it — so it is not
 * this feature's to reconfigure: no engine speed, no main loop, no globals. And
 * a played animation would put these tweens on that engine's own
 * requestAnimationFrame, which cannot know three things this model depends on:
 * that the hitstop freezes every channel mid-flight, that an off-screen bar's
 * idle clock is frozen while its transitions keep running, and that a bar at
 * motion "none" gets no frames at all. Seeking keeps one clock in charge. It is
 * also what lets the check tool drive the model under plain Node, where a
 * played animation would schedule `setImmediate` and keep the process alive.
 *
 * The *clocks* — the idle loop and the guard break's shatter clock — stay
 * arithmetic. They are not tweens: they run for as long as a creature exists.
 *
 * ── The shape of a change ──
 *
 *   0ms    the fill snaps to the new value and everything *stops*
 *   ~55ms  the hitstop releases; the sweep, the ring and the slosh all start
 *          from a standstill rather than from mid-flight
 *   ~180ms the chip trail begins to drain, white-hot, cooling as it goes
 *   ~420ms the readout has finished counting to the new number
 *   ~500ms the sweep has crossed the bar and gone
 *   ~1.4s  the front's slosh has settled
 *
 * **No length springs.** The fill, the chip trail and the readout each
 * decelerate once, cleanly, and stop — springs are the standard way to make a
 * bar feel alive and on a *length* they read as jelly; an instrument that
 * wobbles is an instrument you stop trusting. The one spring here moves the
 * liquid's front around the value, never the value: `slosh` bends the meniscus,
 * and the shader keeps its centre exactly on `frac`.
 */

import { animate, createTimeline, eases, spring } from "../../core/motion.mjs";

/**
 * Durations in unscaled milliseconds, each named for the `--gl-d-*` token it
 * mirrors from `styles/gl-tokens.css`. `motionScale` multiplies all of them,
 * exactly as `--gl-motion-scale` does for CSS.
 */
export const TIMING = Object.freeze({
  idleLoopMs: 64000, // the idle loop; every idle term in the shader turns a whole number of times in it
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
  hitMs: 480,      // the impact reaction, from landing to gone
  punchMs: 300,    // the readout scaling up and settling back
  popupMs: 950,    // a floating delta, rise and fade
  hotMs: 2200,     // how long a bar keeps animating after a change (see `hot`)
  breakInMs: 715,  // the guard-break fracture spreading (see BREAK_SETTLE_S)
  breakOutMs: 320, // --gl-d-brisk   and fading again when the break is cleared
  revealMs: 260,   // --gl-d-brisk   a bar materialising as it becomes visible
  fadeOutMs: 150,  // a bar fading when a hover or a selection lets go of it
  sloshMs: 380,    // the front's slosh spring, perceived; it settles in about 3.5× this
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

/**
 * How springy the front's slosh is. Anime.js's `bounce`: at 0.6 the front swings
 * through the value about three times — a quarter as far back the first time —
 * and is still inside a spring's rest threshold well before `hotMs` lets the
 * bar go cold.
 */
export const SLOSH_BOUNCE = 0.6;

/** The share of the wave's life spent crossing; the rest is its fade. */
export const WAVE_TRAVEL = 0.72;

const clamp01 = (n) => (n < 0 ? 0 : n > 1 ? 1 : n);

/**
 * Quintic ease-out. Everything that moves a *length* uses this.
 *
 * No overshoot, no oscillation, no spring. An earlier pass had the fill recoil
 * past its new value and ring back onto it, and the trail settle the same way;
 * both read, on a bar, as jelly. What makes it satisfying is a long clean
 * deceleration that arrives exactly once and stops.
 */
const GLIDE = eases.outQuint;

/** Cubic ease-out — the readout's count, which should arrive rather than creep. */
const COUNT = eases.outCubic;

/**
 * The sweep's own travel: near-linear, with only a slight deceleration.
 *
 * A quintic here would put the front three-quarters of the way down the bar in
 * the first fifth of its life and then crawl, which is the wrong shape for the
 * one thing meant to be caught peripherally. A sweep wants to be *seen*
 * crossing. `out(1.7)` is `1 - (1 - t)^1.7`.
 */
const TRAVEL = eases.out(1.7);

/** 1 → 0 as `(1 - t)^1.8`: a chip cools fast and then lingers warm. */
const COOL = eases.out(1.8);

/** 1 → 0 as `(1 - t)^1.6`: a linear decay reads as a shape being scaled rather
 *  than as light going out. */
const FADE_OUT = eases.out(1.6);

const LINEAR = eases.linear;

/** 0 → peak → 0, with the settle drawn out: the readout's punch. */
const PUNCH_CURVE = (t) => Math.sin(t * Math.PI) * Math.pow(1 - t, 0.55);

/** The idle strength of the hover gloss. */
const IDLE_SWEEP = 0.22;

/**
 * One tween, never played. The suite's engine is shared, so every animation
 * this feature builds is created paused and moved only by `seek()`.
 */
function tween(target, params) {
  return animate(target, { ...params, autoplay: false, composition: "none" });
}

/** A paused timeline whose children neither compose with nor override anything. */
function timeline() {
  return createTimeline({ autoplay: false, defaults: { composition: "none", ease: LINEAR } });
}

/**
 * The only spring in the feature, and the only thing it may be given to.
 * `resource-bar-check` refuses a spring anywhere else in this file.
 */
function sloshSpring(durationMs) {
  return spring({ bounce: SLOSH_BOUNCE, duration: durationMs });
}

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
    this.sweep = IDLE_SWEEP;
    /** How fresh the chip trail is: 1 the frame it is cut, 0 once cooled. */
    this.chip = 0;

    /* Impact state. `hitX` is where the value *was* when it changed, so the
       reaction emanates from the point on the bar that moved rather than from
       its middle. */
    this.hit = 0;
    this.hitX = 1;
    this.heal = 0;
    this.punch = 0;

    /* The change wave: `wave` is its amplitude, `waveX` where its front has got
       to as a fraction along the bar. */
    this.wave = 0;
    this.waveX = this.frac;

    /** The front's slosh, -1..1: a spring around 0 that bends the meniscus. */
    this.slosh = 0;

    /* The guard break. `broken` is how present the fracture is (the shatter is
       its own arrival, so this goes to 1 at once and only fades on the way out);
       `breakT` is the shared field's clock; `breakX` is where it nucleated,
       captured once rather than followed. */
    this.broken = 0;
    this.breakT = 0;
    this.breakX = this.frac;
    /** Set by the renderer from the shed budget: freeze the fracture, keep it. */
    this.breakFrozen = false;

    /** Floating deltas, newest last. Each is { text, heal, t } with t in 0..1. */
    this.popups = [];

    /** The shader's idle clock, in seconds, wrapping at TIMING.idleLoopMs. */
    this.time = 0;
    this.idleFrozen = false;

    /** Real milliseconds this model has been stepped. */
    this._now = 0;
    /** The same, less every hitstop — the clock every tween is sought on. */
    this._live = 0;
    this._changedAt = -Infinity;
    this._stop = 0;
    this._hover = false;
    this._breakOn = false;

    /* Live tweens, each { tw, at }: `at` is the `_live` time it started.
         _impact    one change's whole reaction — replaced by every set()
         _drain     the chip trail's hold-and-drain, which a heal does not cancel
         _breakOut  the fracture fading when a break is cleared
         _gloss     the hover gloss */
    this._impact = null;
    this._drain = null;
    this._breakOut = null;
    this._gloss = null;
  }

  /** A duration in TIMING, scaled by the user's motion tier. 0 disables motion. */
  _ms(key) {
    return TIMING[key] * this.motionScale;
  }

  _play(tw) {
    return { tw, at: this._live };
  }

  /** Seek a tween to where this model's clock says it is. False once finished. */
  _seek(slot) {
    const local = this._live - slot.at;
    const end = slot.tw.duration;
    slot.tw.seek(local < end ? local : end);
    return local < end;
  }

  /** Every length at its target, every reaction at rest, nothing running. */
  _settle() {
    this.frac = this.ghost = this.num = this.target;
    this.waveX = this.target;
    this._stop = 0;
    this._impact = this._drain = null;
    this.bloom = this.flash = this.hit = this.punch = this.chip = this.wave = this.slosh = 0;
    this.popups.length = 0;
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

    /* Every change replaces the previous change's reaction wholesale, fill glide
       included, so a damage event during a heal never keeps interpolating from
       the old heal origin: the fill stays wherever the glide had got to. The
       chip trail's drain is the one thing a heal leaves running — the span the
       last hit took is still lost. */
    this._impact = null;
    const damaged = next < this.target;
    const delta = next - this.target;
    this.target = next;

    if (silent || this.motionScale === 0) {
      this._settle();
      return;
    }

    this._changedAt = this._now;
    this._stop = this._ms("stopMs");

    /* The impact fires for both directions — a heal that lands silently reads
       as a number quietly changing, which is the thing we are replacing. */
    this.hitX = damaged ? next : this.frac;
    this.heal = damaged ? 0 : 1;

    if (max > 0) {
      const n = Math.round(Math.abs(delta) * max);
      if (n > 0) {
        const pop = { text: (damaged ? "-" : "+") + n, heal: damaged ? 0 : 1, t: 0 };
        pop._slot = this._play(tween(pop, { t: [0, 1], duration: this._ms("popupMs"), ease: LINEAR }));
        this.popups.push(pop);
        /* A burst of small hits must not become a wall of text. */
        if (this.popups.length > 4) this.popups.shift();
      }
    }

    if (damaged) {
      /* The fill drops immediately; the ghost stays put and drains after a
         beat, from wherever an earlier drain had got to.

         `next` is in the max as well, for a damage that lands above a heal
         still gliding up — a value of 0.89 hit down to 0.88 while the fill is
         drawn at 0.87. The fill snaps to the true value, which is *up*, and a
         trail left at the old fill would sit inside it through the hitstop,
         when nothing is stepped to correct it. */
      this.ghost = Math.max(this.ghost, this.frac, next);
      this.frac = next;
      const drain = timeline().add(this, {
        ghost: [this.ghost, next], duration: this._ms("drainMs"), ease: GLIDE,
      }, this._ms("holdMs"));
      this._drain = this._play(drain);
    }

    this._impact = this._play(this._reaction(damaged));
  }

  /**
   * One change's reaction, as a timeline on this model's clock.
   *
   * A timeline writes nothing until it is first sought, so every channel's first
   * frame is set here as well — and those first frames are exactly what the
   * hitstop holds, because nothing seeks during it.
   */
  _reaction(damaged) {
    const ms = (key) => this._ms(key);
    /* The sweep crosses the *whole* bar in the direction the value moved.
       Scoped to the delta it is a detail you have to already be looking at the
       bar to catch; crossing the full length makes it the thing that tells you,
       from the corner of your eye, that something happened and which way. */
    const waveFrom = damaged ? 1 : 0;
    const waveTo = damaged ? 0 : 1;
    const crossing = ms("waveMs") * WAVE_TRAVEL;

    this.hit = 1;
    this.punch = 0;
    this.flash = 1;
    this.wave = 1;
    this.waveX = waveFrom;
    this.slosh = damaged ? 1 : -1;
    this.chip = damaged ? 1 : 0;
    this.bloom = damaged ? 0 : 1;

    const tl = timeline()
      .add(this, { hit: [1, 0], duration: ms("hitMs"), ease: FADE_OUT }, 0)
      .add(this, { punch: [0, PUNCH], duration: ms("punchMs"), ease: PUNCH_CURVE }, 0)
      .add(this, { flash: [1, 0], duration: ms("flashMs") }, 0)
      /* The readout counts rather than snaps, in both directions. */
      .add(this, { num: [this.num, this.target], duration: ms("countMs"), ease: COUNT }, 0)
      /* It crosses at full strength and only then fades: a front that fades
         *while* it travels never arrives anywhere, and arriving is what reads. */
      .add(this, { waveX: [waveFrom, waveTo], duration: crossing, ease: TRAVEL }, 0)
      .add(this, { wave: [1, 0], duration: ms("waveMs") - crossing }, crossing)
      /* The front swings through the value and settles on it. A spring, and the
         only one: it bends the liquid's surface, not the length it measures. */
      .add(this, { slosh: [this.slosh, 0], ease: sloshSpring(ms("sloshMs")) }, 0);

    if (damaged) {
      tl.add(this, { chip: [1, 0], duration: ms("chipMs"), ease: COOL }, 0);
    } else {
      /* The fill glides up to meet a heal. One deceleration, no overshoot. */
      tl.add(this, { bloom: [1, 0], duration: ms("bloomMs") }, 0)
        .add(this, { frac: [this.frac, this.target], duration: ms("fillMs"), ease: GLIDE }, 0);
    }
    return tl;
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
      this._breakOut = null;
      /* At motion "none" the fracture is a fact, not an animation: it arrives
         already settled and its clock never moves again. */
      this.breakT = this.motionScale === 0 ? BREAK_SETTLE_S : 0;
    } else if (this.motionScale === 0) {
      this.broken = 0;
      this._breakOut = null;
    } else {
      this._breakOut = this._play(tween(this, {
        broken: [this.broken, 0], duration: this._ms("breakOutMs"), ease: LINEAR,
      }));
    }
  }

  /** Hover / control state drives the gloss, and nothing else. */
  setHover(on) {
    const next = !!on;
    if (next === this._hover) return;
    this._hover = next;
    if (this.motionScale === 0) {
      this.sweep = next ? 1 : 0;
      this._gloss = null;
      return;
    }
    this._gloss = this._play(tween(this, {
      sweep: [this.sweep, next ? 1 : IDLE_SWEEP],
      duration: this._ms(next ? "sweepInMs" : "sweepOutMs"),
      ease: GLIDE,
    }));
  }

  /**
   * Advance by `dt` milliseconds. Returns true while the bar still needs
   * frames — the renderer's cue to keep it in the ticker.
   */
  step(dt) {
    this._now += dt;
    const s = this.motionScale;

    if (s === 0) {
      this._settle();
      this.sweep = this._hover ? 1 : 0;
      this._gloss = null;
      /* The fracture is state, not motion, so it survives the tier that turns
         every animation off — it just arrives fully formed and stops. */
      this.broken = this._breakOn ? 1 : 0;
      this._breakOut = null;
      this.breakT = BREAK_SETTLE_S;
      return false;
    }

    /* ── Hitstop ──────────────────────────────────────────────────────────
       Every channel holds its first frame for a beat. Nothing is sought, so
       every tween stays exactly where set() left it — including an earlier
       change's popups and a fracture fading out. Released, the sweep, the ring
       and the slosh all start from a standstill, which is what makes them read
       as a reaction to something rather than as the tail of a transition. */
    let live = dt;
    if (this._stop > 0) {
      this._stop -= dt;
      if (this._stop > 0) return true;
      live = -this._stop;
      this._stop = 0;
    }
    this._live += live;

    if (!this.idleFrozen) this.time = (this.time + live / (TIMING.clockMs * s))
      % (TIMING.idleLoopMs / TIMING.clockMs);

    if (this._impact && !this._seek(this._impact)) {
      this._impact = null;
      /* At rest exactly, not within a float of it: `hot` and the tests compare. */
      this.frac = this.num = this.target;
      this.hit = this.punch = this.flash = this.chip = this.bloom = this.wave = this.slosh = 0;
    }

    // The chip trail: hold, then drain to meet the fill; never below it.
    if (this._drain && !this._seek(this._drain)) this._drain = null;
    if (!this._drain || this.ghost < this.frac) this.ghost = this.frac;

    for (const pop of this.popups) this._seek(pop._slot);
    while (this.popups.length && this.popups[0].t >= 1) this.popups.shift();

    /* The fracture's clock. One rate for the whole life of the crack: the same
       walk that spreads it in TIMING.breakInMs then carries its pulse and its
       flow, so at full motion both run in real seconds and match the token's. */
    if ((this._breakOn || this.broken > 0) && !this.breakFrozen) {
      this.breakT += (live / Math.max(1, this._ms("breakInMs"))) * BREAK_SETTLE_S;
      if (this.breakT > BREAK_WRAP) this.breakT -= BREAK_WRAP;
    }
    if (this._breakOut && !this._seek(this._breakOut)) {
      this._breakOut = null;
      this.broken = 0;
    }

    if (this._gloss && !this._seek(this._gloss)) this._gloss = null;

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
    if (this._hover || this._gloss) return true;
    if (this.ghost !== this.frac || this._impact || this._drain) return true;
    if (this.popups.length) return true;
    if (this.low > 0) return true; // the low-health pulse is continuous by design
    /* A settled fracture is still breathing, so a broken creature's bar stays
       hot for as long as it is broken — the same standing cost as low health,
       and the same reason. Freezing it is the shed's job, not this one's. */
    if (this.broken > 0 && !this.breakFrozen) return true;
    return this._now - this._changedAt < this._ms("hotMs");
  }
}

/**
 * Whether a bar is on screen for this client, and how it got there.
 *
 * Kept apart from BarAnim because it is a fact about *this client's view* of the
 * token rather than about its values: a bar that fades on hover-out has not lost
 * anything, and a value change that lands while it is hidden must not replay as
 * an impact when it comes back.
 *
 * Three rules, each of which reads as a bug when it is broken:
 *
 *   - Appearing **materialises**, left to right (`reveal`). On every mouse pass
 *     over a Hover-mode token a bar that pops reads as flicker even when the rule
 *     behind it is correct; one that is wiped in reads as summoned.
 *   - Disappearing because a hover or selection let go **fades** (`fade`). It
 *     never plays the wipe backwards: a bar draining right to left is exactly
 *     what a creature losing all of its hit points looks like.
 *   - Disappearing because the token left sight is **instant**. The caller says
 *     so by passing `animate` false; a fade there leaves a bar lingering over a
 *     token this client can no longer see.
 */
export class RevealAnim {
  constructor({ motionScale = 1 } = {}) {
    this.motionScale = motionScale;
    /** The decision: may this client see the bar right now. */
    this.shown = false;
    /** The wipe front, 0 (nothing drawn) .. 1 (the whole bar). */
    this.reveal = 0;
    /** Overall opacity, 0..1. */
    this.fade = 0;
    this._mode = null;
    this._tween = null;
    this._t = 0;
  }

  _ms(key) {
    return TIMING[key] * this.motionScale;
  }

  _begin(mode, tw) {
    this._mode = mode;
    this._tween = tw;
    this._t = 0;
  }

  _end() {
    this._mode = null;
    this._tween = null;
  }

  /** True while any part of the bar would draw. */
  get drawn() {
    return this.fade > 0 && (this.reveal > 0 || this._mode === "reveal");
  }

  /** True while a transition still needs frames. */
  get hot() {
    return this._mode !== null;
  }

  show(animate = false) {
    const wasDrawn = this.drawn;
    this.shown = true;
    this.fade = 1;
    /* Caught mid fade-out: come straight back. Replaying the wipe over a bar
       that never finished leaving is a flicker of its own. */
    if (wasDrawn) { this.reveal = 1; this._end(); return; }
    if (animate && this.motionScale > 0) {
      /* The sweep's own curve: the front has to be seen crossing. */
      this._begin("reveal", tween(this, { reveal: [0, 1], duration: this._ms("revealMs"), ease: TRAVEL }));
    } else {
      this.reveal = 1;
      this._end();
    }
  }

  hide(animate = false) {
    const wasDrawn = this.drawn;
    this.shown = false;
    if (animate && wasDrawn && this.motionScale > 0) {
      this._begin("fade", tween(this, { fade: [this.fade, 0], duration: this._ms("fadeOutMs"), ease: LINEAR }));
    } else {
      this.fade = 0;
      this.reveal = 0;
      this._end();
    }
  }

  /** Advance by `dt` milliseconds. Returns true while still transitioning. */
  step(dt) {
    if (this._mode === null) return false;
    if (this.motionScale === 0) {
      this.fade = this.reveal = this.shown ? 1 : 0;
      this._end();
      return false;
    }
    this._t += dt;
    const end = this._tween.duration;
    this._tween.seek(this._t < end ? this._t : end);
    if (this._t >= end) {
      if (this._mode === "reveal") this.reveal = 1;
      else { this.fade = 0; this.reveal = 0; }
      this._end();
    }
    return this._mode !== null;
  }
}

/**
 * The shed order under load, cheapest sacrifice first. The renderer walks this
 * list and disables effects until it is inside budget; the check tool pins that
 * every animated behaviour appears here, so a new effect cannot be added that
 * never degrades.
 *
 * The first four are the standing costs — paid every frame by every bar on
 * screen, or by every broken one — and everything after them is transient, paid
 * once per change:
 *
 *   sweep      freezes the idle clock: the liquid holds its last frame
 *   wobble     takes the meniscus's idle wobble out
 *   flow       drops the liquid's animated layer in the shader, and takes idle
 *              bars out of the ticker altogether
 *   breakFlow  freezes a fracture at its settled frame
 *
 * What degrades is the motion, never the state: a frozen fracture keeps its
 * crack, a still liquid keeps its colour, its bloodied look and its front. A
 * shed that could hide "this creature's guard is broken" would be trading the
 * information for the frame rate, which is not a trade this list is allowed to
 * make.
 */
export const SHED_ORDER = Object.freeze([
  "sweep", "wobble", "flow", "reveal", "breakFlow", "popups", "sparks", "ring", "slosh", "numbers", "punch", "ghost",
  "wave", "bloom",
  "flurry", "nameDecode", // names: the cipher's standing flurry; a label's decode (snaps when shed)
]);
