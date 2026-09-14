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
 *   ~55ms  the hitstop releases; the sweep, the ring and the surge all start
 *          from a standstill rather than from mid-flight
 *   ~180ms the chip trail begins to drain, white-hot, cooling as it goes
 *   ~420ms the readout has finished counting to the new number
 *   ~500ms the sweep has crossed the bar and gone
 *   ~1.4s  the surge through the liquid has settled
 *
 * **No length springs.** The fill, the chip trail and the readout each
 * decelerate once, cleanly, and stop — springs are the standard way to make a
 * bar feel alive and on a *length* they read as jelly; an instrument that
 * wobbles is an instrument you stop trusting. The one spring here is `surge`,
 * and it moves nothing that measures: it pushes the liquid's texture back and
 * forth through the tube and lifts its light, while the bar's edge stays a
 * straight line exactly on `frac`.
 */

import { animate, createTimeline, eases, spring } from "../../core/motion.mjs";
import { DYING_BEATS } from "./shader.mjs";

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
  fadeInMs: 120,   // --gl-d-tap     a bar fading in as it becomes visible
  fadeOutMs: 120,  // --gl-d-tap     and out when a hover or a selection lets go of it
  surgeMs: 380,    // the surge through the liquid, perceived; the spring settles in about 3.5× this
  dyingInMs: 320,  // --gl-d-brisk   the orchid taking the bar over when dying lands
  dyingOutMs: 540, // --gl-d-glide   and handing it back when dying clears
  dyingLevelMs: 920, // --gl-d-slow  the heartbeat crossfading to a new dying level's rate
  flatlineMs: 920, // --gl-d-slow    the heartbeat dying away as death lands
  deadInMs: 1400,  // the flatline end to end: the liquid runs out, the line draws, DEAD comes up (shader.mjs DEAD_PHASES)
  deadDrainMs: 540, // --gl-d-glide  the liquid running out of the bar, and the ticker coasting to a stop
  deadOutMs: 540,  // --gl-d-glide   the flatline fading back when a creature is revived
  tickerInMs: 920, // --gl-d-slow    the words sliding in from the right as dying lands
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
 * Where the dying clock wraps, in seconds: the idle loop, which the shader's
 * `LOOP_W` is built on. Every moving dying term — the veins' two orbits and the
 * heartbeat at every level — turns a whole number of times in it, so the wrap
 * lands on the frame it left. `resource-bar-check` pins both halves.
 */
export const DYING_LOOP_S = TIMING.idleLoopMs / TIMING.clockMs;

/**
 * How many heartbeat rates the shader carries (`DYING_BEATS` in shader.mjs):
 * dying 1, 2, 3, and 4 or more. The model crossfades between their indices, so a
 * new level blends from one rate into the next rather than jumping mid-beat.
 */
export const DYING_LEVELS = 4;

/**
 * The dying ticker's speed, in bar heights per second at dying 1's heartbeat.
 * Each level runs it at that level's heartbeat rate over dying 1's
 * (DYING_BEATS), so the text quickens in step with the beat and crossfades
 * between speeds as the heartbeat does. Bar heights, so it reads the same pace on
 * a familiar's bar and a dragon's.
 */
export const TICKER_SPEED = 0.85;

/**
 * Entered far enough to cover any bar: the idle loop's length, read as bar
 * heights, is well past the widest bar a scene can lay out. Where the words sit
 * once they have slid in, and at once when they arrive quietly or frozen.
 */
export const TICKER_FULL = DYING_LOOP_S;

/** The ticker's speed at a heartbeat level, fractional while it crossfades, in bar heights per second. */
export function tickerSpeed(level) {
  const top = DYING_BEATS.length - 1;
  const l = level < 0 ? 0 : level > top ? top : level;
  const i = Math.floor(l);
  const a = DYING_BEATS[i], b = DYING_BEATS[Math.min(top, i + 1)];
  return (TICKER_SPEED * (a + (b - a) * (l - i))) / DYING_BEATS[0];
}

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
 * How springy the surge is. Anime.js's `bounce`: at 0.6 the liquid's texture
 * swings back and forth about three times — a quarter as far back the first
 * time — and is still inside a spring's rest threshold well before `hotMs` lets
 * the bar go cold.
 */
export const SURGE_BOUNCE = 0.6;

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
function surgeSpring(durationMs) {
  return spring({ bounce: SURGE_BOUNCE, duration: durationMs });
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

    /** The surge through the liquid, -1..1: a spring around 0 that moves its
     *  texture and light, never its edge. */
    this.surge = 0;

    /* The guard break. `broken` is how present the fracture is (the shatter is
       its own arrival, so this goes to 1 at once and only fades on the way out);
       `breakT` is the shared field's clock; `breakX` is where it nucleated,
       captured once rather than followed. */
    this.broken = 0;
    this.breakT = 0;
    this.breakX = this.frac;
    /** Set by the renderer from the shed budget: freeze the fracture, keep it. */
    this.breakFrozen = false;

    /* PF2e dying and death. While `_dyingOn` the ticker owns the fill's length
       and `hp` is only remembered, to glide back to when dying clears; while
       `_deadOn` the flatline owns it, at 0, and outranks dying. `dying` is how far
       the orchid has taken the bar over (0..1); `dyingT` is the veins' and the
       heartbeat's clock; `dyingLevel` indexes the heartbeat rate and is fractional
       while it crossfades; `dyingPulse` is the heartbeat's strength, 0 once dead.
       `ticker` is how far the text has run, in bar heights, `tickerIn` how far it
       has entered from the right, and `tickerRun` its speed as a share of the
       level's, which coasts to 0 as death lands. `dead` is the flatline's own
       progress, 0..1; the shader reads its beats off it (DEAD_PHASES). The value,
       the maximum and doomed's share of the track are the reading. */
    this.hp = this.frac;
    this.dying = 0;
    this.dyingT = 0;
    this.dyingLevel = 0;
    this.dyingPulse = 0;
    this.dyingValue = 0;
    this.dyingMax = 0;
    this.dyingSlots = 0;
    this.dyingDead = 0;
    this.ticker = 0;
    this.tickerIn = 0;
    /** How far the words have slid in from the right as dying landed, in bar heights. */
    this.tickerSlide = 0;
    /** The bar's length in bar heights, set by the renderer: what the words slide in over. */
    this.tickerSpan = 5;
    this.tickerRun = 1;
    this.dead = 0;
    /** Set by the renderer, on the idle clock's rule — off screen, or given up by
     *  the shed: freeze the veins, the heartbeat and the ticker, keep all three. */
    this.dyingFrozen = false;

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
    this._dyingOn = false;
    this._deadOn = false;
    this._levelTarget = 0;

    /* Live tweens, each { tw, at }: `at` is the `_live` time it started.
         _impact    one change's whole reaction — replaced by every set()
         _count     the readout counting to a new value, in its own slot so a
                    dying transition can drop it and leave the reaction running
         _drain     the chip trail's hold-and-drain, which a heal does not cancel
         _gauge     the fill gliding between hit points, the dying gauge and the
                    flatline's empty bar
         _breakOut  the fracture fading when a break is cleared
         _gloss     the hover gloss
         _dyingFade / _dyingLevelTw / _dyingPulseTw
                    the orchid arriving or leaving, the heartbeat crossfading to
                    a new rate, and the heartbeat dying away as death lands
         _deadFade  the flatline running in, or fading back on a revival
         _tickerStop
                    the ticker coasting to a stop as death lands */
    this._impact = null;
    this._count = null;
    this._drain = null;
    this._gauge = null;
    this._breakOut = null;
    this._gloss = null;
    this._dyingFade = null;
    this._dyingLevelTw = null;
    this._dyingPulseTw = null;
    this._deadFade = null;
    this._tickerStop = null;
    /** The words sliding in from the right as dying lands. */
    this._tickerEnter = null;
  }

  /** True while the dying ticker is on the primary bar. */
  get dyingOn() {
    return this._dyingOn;
  }

  /** True while the flatline owns the primary bar. */
  get deadOn() {
    return this._deadOn;
  }

  /**
   * What the numeric readout prints, as `{ value, max }` — always hit points.
   *
   * While dying or dead the readout is not the reading (the ticker's words and
   * DEAD are), and it fades out as they take the bar over. What it prints on the
   * way out, and on the way back in, is the hit points underneath, snapped: `num`
   * belongs to the gauge while dying, and a count carried across the switch
   * prints a gauge fraction as hit points. So every value this returns is a
   * hit-point value, counted only while nothing has taken the bar over.
   */
  readout(hpMax) {
    return this._dyingOn || this._deadOn
      ? { value: Math.round(this.hp * hpMax), max: hpMax }
      : { value: Math.round(this.num * hpMax), max: hpMax };
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

  /**
   * Seek the tween in `this[slot]`; once it has finished, drop it and put
   * `channel` exactly at `rest` — not within a float of it: `hot` and the
   * tests compare.
   */
  _seekTo(slot, channel, rest) {
    if (this[slot] && !this._seek(this[slot])) {
      this[slot] = null;
      this[channel] = rest;
    }
  }

  /**
   * Move one channel to `to` over TIMING[key] in its own slot — or, quiet, put
   * it there at once and drop whatever that slot was running.
   */
  _channel(slot, channel, to, key, quiet) {
    if (quiet) {
      this[slot] = null;
      this[channel] = to;
    } else {
      this[slot] = this._play(tween(this, { [channel]: [this[channel], to], duration: this._ms(key), ease: LINEAR }));
    }
  }

  /** Every length at its target, every reaction at rest, nothing running. */
  _settle() {
    this.frac = this.ghost = this.num = this.target;
    this.waveX = this.target;
    this._stop = 0;
    this._impact = this._count = this._drain = this._gauge = null;
    this.bloom = this.flash = this.hit = this.punch = this.chip = this.wave = this.surge = 0;
    this.popups.length = 0;
  }

  /**
   * Move the fill to a new length with no event attached — the dying gauge
   * taking the bar over, changing level, or handing it back.
   *
   * One deceleration, the heal's own glide: no overshoot, no recoil, and no
   * reaction of its own, because the gauge growing is not damage and a hit
   * point change arriving underneath it is not a heal. Any reaction already
   * running (the killing blow that put the creature down, usually a few
   * milliseconds earlier) is left to finish; this only takes over the length and
   * the count, and cuts the chip trail to the fill so it cannot draw a span of
   * hit points over the gauge.
   *
   * `across` is a change of domain — dying arriving or clearing. The fill still
   * glides, but the count does not: the readout snaps to the new domain's value
   * and whatever count was running (the killing blow's, counting hit points
   * down) is dropped, so no number is ever printed in the wrong domain. A new
   * dying level stays inside the gauge and counts.
   *
   * `key` is the TIMING entry the glide takes: the heal's `fillMs`, or
   * `deadDrainMs` for the liquid running out of the bar as death lands.
   */
  _toLength(next, quiet, across = false, key = "fillMs") {
    const to = clamp01(next);
    this.target = to;
    if (quiet) {
      this._settle();
      return;
    }
    this._drain = null;
    this.ghost = this.frac;
    this._gauge = this._play(tween(this, { frac: [this.frac, to], duration: this._ms(key), ease: GLIDE }));
    if (across) {
      this._count = null;
      this.num = to;
    } else {
      this._count = this._play(tween(this, { num: [this.num, to], duration: this._ms("countMs"), ease: COUNT }));
    }
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
    /* While dying or dead, the gauge or the flatline owns the length. Hit points
       are remembered and nothing else happens — no reaction, no delta — until
       both clear and the fill glides back to them. */
    this.hp = next;
    if (this._dyingOn || this._deadOn) return;
    if (next === this.target) return;

    /* Every change replaces the previous change's reaction wholesale, fill glide
       included, so a damage event during a heal never keeps interpolating from
       the old heal origin: the fill stays wherever the glide had got to. The
       chip trail's drain is the one thing a heal leaves running — the span the
       last hit took is still lost. */
    this._impact = this._count = this._gauge = null;
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
    /* The readout counts rather than snaps, in both directions — in a slot of
       its own, so a dying transition can drop the count without the reaction. */
    this._count = this._play(tween(this, { num: [this.num, this.target], duration: this._ms("countMs"), ease: COUNT }));
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
    this.surge = damaged ? 1 : -1;
    this.chip = damaged ? 1 : 0;
    this.bloom = damaged ? 0 : 1;

    const tl = timeline()
      .add(this, { hit: [1, 0], duration: ms("hitMs"), ease: FADE_OUT }, 0)
      .add(this, { punch: [0, PUNCH], duration: ms("punchMs"), ease: PUNCH_CURVE }, 0)
      .add(this, { flash: [1, 0], duration: ms("flashMs") }, 0)
      /* The wave crosses at full strength and only then fades: a front that fades
         *while* it travels never arrives anywhere, and arriving is what reads. */
      .add(this, { waveX: [waveFrom, waveTo], duration: crossing, ease: TRAVEL }, 0)
      .add(this, { wave: [1, 0], duration: ms("waveMs") - crossing }, crossing)
      /* The liquid surges back and forth through the tube and settles. A spring,
         and the only one: it moves the liquid's texture and light, never the
         length it measures. */
      .add(this, { surge: [this.surge, 0], ease: surgeSpring(ms("surgeMs")) }, 0);

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

  /**
   * Report the creature's PF2e dying state: `core/pf2e-dying.mjs`'s reading, or
   * null when it is not dying.
   *
   * While dying the primary bar is the dying ticker: the fill glides to
   * `value / slots` — one continuous length, with doomed's share of the track
   * hatched past the maximum — the orchid fades in, and the words start running in
   * from the right edge. A new level glides the fill and crossfades the heartbeat,
   * and the ticker's speed with it. Reaching the maximum is death, and death is
   * `setDead`'s: this only records the reading. Clearing dying fades the orchid
   * out and glides back to the hit points that arrived underneath — unless the
   * flatline owns the bar, which keeps it.
   *
   * Idempotent: the renderer reports on every read, and a reading that has not
   * changed does nothing.
   */
  setDying(state, { silent = false } = {}) {
    const on = !!state && Number(state.slots) > 0;
    const quiet = silent || this.motionScale === 0;

    if (!on) {
      if (!this._dyingOn) return;
      this._dyingOn = false;
      this._dyingLevelTw = this._dyingPulseTw = null;
      this._channel("_dyingFade", "dying", 0, "dyingOutMs", quiet);
      if (!this._deadOn) this._toLength(this.hp, quiet, true);
      return;
    }

    const slots = Math.max(1, Math.round(Number(state.slots)));
    const max = Math.min(slots, Math.max(0, Math.round(Number(state.max) || 0)));
    const value = Math.min(max, Math.max(0, Math.round(Number(state.value) || 0)));
    const level = Math.min(DYING_LEVELS - 1, Math.max(0, value - 1));
    const arriving = !this._dyingOn;
    if (!arriving && value === this.dyingValue && max === this.dyingMax && slots === this.dyingSlots) return;

    this._dyingOn = true;
    this.dyingValue = value;
    this.dyingMax = max;
    this.dyingSlots = slots;
    this.dyingDead = slots - max;

    if (arriving) {
      this._dyingLevelTw = this._dyingPulseTw = null;
      this.dyingLevel = level;
      this.dyingPulse = this._deadOn ? 0 : 1;
      /* The words slide in from the right over the bar's own length as the orchid
         arrives — the entering edge and the letters travel together — and then
         settle into the crawl. A quiet arrival (a bar that was hidden, a first
         read, motion "none") is already in. */
      this._tickerEnter = null;
      this.tickerSlide = 0;
      if (quiet) {
        this.tickerIn = TICKER_FULL;
      } else {
        const d = Math.max(1, this.tickerSpan) + 1;
        this.tickerIn = 0;
        this._tickerEnter = this._play(tween(this, {
          tickerIn: [0, d], tickerSlide: [0, d], duration: this._ms("tickerInMs"), ease: GLIDE,
        }));
      }
      this._channel("_dyingFade", "dying", 1, "dyingInMs", quiet);
    } else if (level !== this._levelTarget) {
      this._channel("_dyingLevelTw", "dyingLevel", level, "dyingLevelMs", quiet);
    }
    this._levelTarget = level;
    if (!this._deadOn) this._toLength(value / slots, quiet, arriving);
  }

  /**
   * Report whether the creature is dead (`core/pf2e-dying.mjs`'s readPf2eDead).
   *
   * Death outranks dying. Arriving, the flatline takes the bar: the liquid runs
   * out (the fill glides to 0 over `deadDrainMs`), the ticker coasts to a stop
   * over the same beat, the heartbeat dies away over `flatlineMs`, and `dead` runs
   * 0 → 1 over `deadInMs` — the shader reads the line and DEAD off it. Then
   * nothing moves. Leaving — a revival, or a status cleared — fades the flatline
   * back out and glides the fill to whatever owns it now: the dying gauge while
   * dying is still on, else the hit points underneath.
   *
   * A reading, never a verdict: nothing here marks, unmarks or writes to a
   * creature. Idempotent, like setDying.
   */
  setDead(on, { silent = false } = {}) {
    const next = !!on;
    if (next === this._deadOn) return;
    const quiet = silent || this.motionScale === 0;
    this._deadOn = next;
    if (next) {
      this._channel("_deadFade", "dead", 1, "deadInMs", quiet);
      this._channel("_tickerStop", "tickerRun", 0, "deadDrainMs", quiet);
      if (this._dyingOn) {
        this._dyingLevelTw = null;
        this.dyingLevel = this._levelTarget;
        this._channel("_dyingPulseTw", "dyingPulse", 0, "flatlineMs", quiet);
      }
      /* An NPC's killing blow has already put the length at 0, with its chip
         trail draining and its count running; gliding there again would cut both
         off on the frame the creature dies. */
      if (quiet || this.target !== 0) this._toLength(0, quiet, true, "deadDrainMs");
    } else {
      this._channel("_deadFade", "dead", 0, "deadOutMs", quiet);
      this._tickerStop = null;
      this.tickerRun = 1;
      if (this._dyingOn) {
        this._channel("_dyingPulseTw", "dyingPulse", 1, "dyingInMs", quiet);
        this._toLength(this.dyingValue / this.dyingSlots, quiet, true);
      } else {
        this._toLength(this.hp, quiet, true);
      }
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
      /* Dying and death are state too: the orchid, the words and the flatline are
         there, still, with the heartbeat at whatever strength the reading gives it,
         its clock parked, and the words entered in full (the host centres them). */
      this.dying = this._dyingOn ? 1 : 0;
      this.dead = this._deadOn ? 1 : 0;
      this._dyingFade = this._dyingLevelTw = this._dyingPulseTw = this._deadFade = this._tickerStop = null;
      this.dyingLevel = this._levelTarget;
      this.dyingPulse = this._dyingOn && !this._deadOn ? 1 : 0;
      this.tickerRun = this._deadOn ? 0 : 1;
      this._tickerEnter = null;
      this.tickerIn = TICKER_FULL;
      return false;
    }

    /* ── Hitstop ──────────────────────────────────────────────────────────
       Every channel holds its first frame for a beat. Nothing is sought, so
       every tween stays exactly where set() left it — including an earlier
       change's popups and a fracture fading out. Released, the sweep, the ring
       and the surge all start from a standstill, which is what makes them read
       as a reaction to something rather than as the tail of a transition. */
    let live = dt;
    if (this._stop > 0) {
      this._stop -= dt;
      if (this._stop > 0) return true;
      live = -this._stop;
      this._stop = 0;
    }
    this._live += live;

    /* A dead bar's liquid stops once the flatline has landed; there is nothing
       left in the bar for it to move. */
    const stilled = this._deadOn && !this._deadFade;
    if (!this.idleFrozen && !stilled) this.time = (this.time + live / (TIMING.clockMs * s))
      % (TIMING.idleLoopMs / TIMING.clockMs);

    if (this._impact && !this._seek(this._impact)) {
      this._impact = null;
      /* At rest exactly, not within a float of it: `hot` and the tests compare. */
      this.frac = this.target;
      this.hit = this.punch = this.flash = this.chip = this.bloom = this.wave = this.surge = 0;
    }
    /* After the reaction, so the gauge's glide owns the length while a killing
       blow's reaction plays out around it. */
    this._seekTo("_gauge", "frac", this.target);
    this._seekTo("_count", "num", this.target);

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

    /* The dying clock: the veins' orbits and the heartbeat, on the idle clock's
       rule — scaled by the motion tier, and frozen by the renderer off screen or
       under the shed. One scale for every rate, so the heartbeat still quickens
       in order as dying rises; what the tier changes is how fast motion runs,
       which is the user's explicit choice. Death stops it; the words stay. */
    const running = this._dyingOn && !this.dyingFrozen;
    if (running && !this._deadOn)
      this.dyingT = (this.dyingT + live / (TIMING.clockMs * s)) % DYING_LOOP_S;
    /* The ticker, on the same clock and the same freeze, at the heartbeat level's
       speed and coasting to a stop as death lands (tickerRun). Its distance is
       unbounded on purpose: the host wraps it inside one repetition of the strip,
       which is the only period that is seamless, and a double does not lose a
       pixel of that in a year of play. Frozen, the words are entered in full — a
       shed may give up the motion, never what the bar says. */
    this._seekTo("_tickerStop", "tickerRun", this._deadOn ? 0 : 1);
    if (running) {
      this.ticker += (live / (TIMING.clockMs * s)) * tickerSpeed(this.dyingLevel) * this.tickerRun;
      /* The slide in, sought on the model's clock; once it has landed the edge
         stands open over any bar and the letters keep the distance they slid. */
      if (this._tickerEnter && !this._seek(this._tickerEnter)) {
        this._tickerEnter = null;
        this.tickerIn = TICKER_FULL;
      }
    } else {
      this._tickerEnter = null;
      this.tickerIn = TICKER_FULL;
    }
    this._seekTo("_dyingFade", "dying", this._dyingOn ? 1 : 0);
    this._seekTo("_dyingLevelTw", "dyingLevel", this._levelTarget);
    this._seekTo("_dyingPulseTw", "dyingPulse", this._dyingOn && !this._deadOn ? 1 : 0);
    this._seekTo("_deadFade", "dead", this._deadOn ? 1 : 0);

    if (this._gloss && !this._seek(this._gloss)) this._gloss = null;

    return this.hot;
  }

  /** Low-health state, ramped over the band just above the threshold so it
   *  arrives rather than snaps. Handed over while dying or dead: neither is hit
   *  points, and the arterial red and its breath would fight the orchid and the
   *  flatline's steel. */
  get low() {
    return clamp01((LOW_AT - this.frac) / LOW_AT) * (1 - Math.max(this.dying, this.dead));
  }

  /**
   * Whether this bar still needs frames. Cold bars are dropped from the shared
   * ticker entirely; they keep their last drawn frame.
   */
  get hot() {
    if (this.motionScale === 0) return false;
    if (this._stop > 0) return true;
    if (this._hover || this._gloss) return true;
    if (this.ghost !== this.frac || this._impact || this._count || this._drain || this._gauge) return true;
    if (this.popups.length) return true;
    if (this._dyingFade || this._dyingLevelTw || this._dyingPulseTw || this._deadFade || this._tickerStop || this._tickerEnter) return true;
    /* A dying creature's heartbeat and ticker are the same standing cost as a
       broken one's fracture. A dead bar has nothing left to animate once the
       flatline has landed, and a frozen one is off screen or has been given up by
       the shed. */
    if (this._dyingOn && !this._deadOn && !this.dyingFrozen) return true;
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
 *   - Appearing and a hover or selection letting go are a **short, plain fade**.
 *     On every mouse pass over a Hover-mode token a bar that pops reads as
 *     flicker even when the rule behind it is correct; anything more than a fade
 *     (a sweep, a wipe) is a show on every pass, and draining a bar sideways is
 *     exactly what a creature losing all of its hit points looks like.
 *   - A fade caught half way turns round from where it is, never from an end.
 *   - Disappearing because the token left sight is **instant**. The caller says
 *     so by passing `animate` false; a fade there leaves a bar lingering over a
 *     token this client can no longer see.
 */
export class RevealAnim {
  constructor({ motionScale = 1 } = {}) {
    this.motionScale = motionScale;
    /** The decision: may this client see the bar right now. */
    this.shown = false;
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
    return this.fade > 0 || this._mode === "in";
  }

  /** True while a transition still needs frames. */
  get hot() {
    return this._mode !== null;
  }

  show(animate = false) {
    this.shown = true;
    if (this._mode === "in" || (this._mode === null && this.fade >= 1)) return;
    /* From wherever a fade-out left it: a bar caught leaving turns round. */
    const from = this.fade;
    if (animate && this.motionScale > 0 && from < 1) {
      this._begin("in", tween(this, { fade: [from, 1], duration: this._ms("fadeInMs") * (1 - from), ease: LINEAR }));
    } else {
      this.fade = 1;
      this._end();
    }
  }

  hide(animate = false) {
    const wasDrawn = this.drawn;
    this.shown = false;
    if (animate && this._mode === "out") return;
    if (animate && wasDrawn && this.motionScale > 0) {
      this._begin("out", tween(this, { fade: [this.fade, 0], duration: this._ms("fadeOutMs") * this.fade, ease: LINEAR }));
    } else {
      this.fade = 0;
      this._end();
    }
  }

  /** Advance by `dt` milliseconds. Returns true while still transitioning. */
  step(dt) {
    if (this._mode === null) return false;
    if (this.motionScale === 0) {
      this.fade = this.shown ? 1 : 0;
      this._end();
      return false;
    }
    this._t += dt;
    const end = this._tween.duration;
    this._tween.seek(this._t < end ? this._t : end);
    if (this._t >= end) {
      this.fade = this._mode === "in" ? 1 : 0;
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
 * The entries up to dyingFlow are the standing costs — paid every frame by
 * every bar on screen, or by every broken or dying one — and everything after
 * them is transient, paid once per change:
 *
 *   sweep      freezes the idle clock: the liquid holds its last frame
 *   flow      drops the liquid's animated layer in the shader, and takes idle
 *              bars out of the ticker altogether
 *   breakFlow  freezes a fracture at its settled frame
 *   dyingFlow  freezes the dying veins, heartbeat and words where they are
 *
 * What degrades is the motion, never the state: a frozen fracture keeps its
 * crack, a still liquid keeps its colour, its bloodied look and its edge, a
 * frozen dying ticker keeps its orchid, its words and its fill. A shed that could
 * hide "this creature's guard is broken" or "this creature is dying" would be
 * trading the information for the frame rate, which is not a trade this list is
 * allowed to make.
 */
export const SHED_ORDER = Object.freeze([
  "sweep", "flow", "reveal", "breakFlow", "dyingFlow", "popups", "sparks", "ring", "surge", "numbers", "punch", "ghost",
  "wave", "bloom",
  "flurry", "nameDecode", // names: the cipher's standing flurry; a label's decode (snaps when shed)
]);
