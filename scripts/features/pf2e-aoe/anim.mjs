/**
 * PF2e AoE — the animation model.
 *
 * Dependency-free and side-effect-free BY DESIGN: `tools/pf2e-aoe-preview.mjs`
 * inlines this file verbatim into the preview page, so what you scrub in the
 * browser is the beat the module actually runs. A reimplementation is how a
 * preview ends up demonstrating a beat the module does not have.
 *
 * Every duration below is in milliseconds and every one is multiplied by
 * `motionScale` (0 = none, 0.6 = reduced, 1 = default) before use. A literal
 * duration anywhere else silently ignores the user's motion tier.
 */

/** Phase durations, ms. Multiplied by motionScale at every read. */
export const TIMING = Object.freeze({
  castIn: 520,      // the rim is DRAWN on (or flashes in): the extent never grows
  pulse: 520,       // the trigger beat: flash, echo, settle
  dissipate: 640,   // everything fades out together
  echo: 900,        // one echo ring travelling out past the boundary
});

/**
 * Everything animated, cheapest to shed first. The host drops behaviours off
 * the front of this list as frame time climbs. When, and how far, is not
 * decided here: the host binds this order to the suite's shared frame budget
 * (`core/budget.mjs`), which owns the clock and the hysteresis.
 *
 * Four things are deliberately ABSENT and must stay absent: the fill, the
 * function pattern, the rules seams and the boundary rim. Readability is not
 * a quality tier — a player must be able to answer "am I in it, and what is
 * it?" on a machine that cannot afford a glow.
 */
export const SHED_ORDER = Object.freeze([
  "tokenMarks", // brackets around Tokens standing in the area
  "echo",       // rings leaving the boundary on each beat
  "drift",      // the pattern's own motion and the rim's chase
  "secondary",  // the secondary-function pattern and the detect sweep
  "glow",       // the additive glow stack and the alert flare
]);

const clamp01 = (n) => (n < 0 ? 0 : n > 1 ? 1 : n);

/** Symmetric ease, the same curve arriving and leaving. */
const smooth = (t) => t * t * (3 - 2 * t);

/**
 * The stroke curve — what a nib travelling across a surface does.
 *
 * Deliberately NOT an overshoot: a thing that flies past its size and comes
 * back reads as a wobble, not as an arrival.
 *
 * And deliberately not an ease-OUT either, which is what a scale or an opacity
 * ramp wants. A pen that decelerates through the last third of its travel does
 * not read as landing, it reads as running out of ink, and it leaves the final
 * squares of the area arriving too slowly to be sure they arrived. Smoothstep
 * accelerates once, holds a constant speed through the middle of the stroke —
 * where nearly all the ink is laid — and eases off only at the very end.
 */
const stroke = (t) => t * t * (3 - 2 * t);

/**
 * The idle alert, 0 at rest and 1 at the crest, for `kind` at `t` seconds
 * with one cycle every `period` seconds. Pure, so the preview and the check
 * tool read the same beat the canvas does.
 *
 *   heartbeat  lub-dub: two sharp beats close together, then rest (harm)
 *   breathe    a slow even swell (restore, support, control, summon)
 *   throb      a swell with a hard crest and a long trough (hinder)
 *   strobe     on/off with quick edges, the alarm (hazard)
 */
export function alertLevel(kind, t, period) {
  if (!(period > 0) || kind === "none" || !kind) return 0;
  const p = ((t / period) % 1 + 1) % 1;
  if (kind === "heartbeat") {
    const beat = (c, w) => Math.exp(-((p - c) ** 2) / (2 * w * w));
    return Math.min(1, beat(0.08, 0.045) + 0.72 * beat(0.27, 0.05));
  }
  if (kind === "breathe") return 0.5 - 0.5 * Math.cos(p * Math.PI * 2);
  if (kind === "throb") return Math.pow(0.5 - 0.5 * Math.cos(p * Math.PI * 2), 2.4);
  if (kind === "strobe") {
    const edge = 0.06;
    const up = smooth(clamp01(p / edge)), down = smooth(clamp01((p - 0.5) / edge));
    return up * (1 - down);
  }
  return 0;
}

/** Where each beat's echo ring is, 0 → 1, for an alert of this kind. */
export function echoPhase(kind, t, period, travel) {
  if (!(period > 0) || !(travel > 0)) return -1;
  const start = kind === "heartbeat" ? 0.06 : kind === "strobe" ? 0 : 0.5;
  const since = (((t / period - start) % 1) + 1) % 1 * period;
  return since < travel ? since / travel : -1;
}

export class AoeAnim {
  constructor({ motionScale = 1 } = {}) {
    this.motionScale = motionScale;
    this.elapsed = 0;
    this.leaving = false;
    this.leftFor = 0;
    this.pulseAt = -1;
    this.dead = false;
  }

  /** Fire the trigger beat — the moment the spell actually resolves. */
  pulse() {
    this.pulseAt = 0;
  }

  /** Begin the dissipate phase. `hot` stays true until it finishes. */
  release() {
    if (!this.leaving) {
      this.leaving = true;
      this.leftFor = 0;
    }
  }

  /** Motion tier "none" freezes every channel at its resting value. */
  get still() {
    return this.motionScale <= 0;
  }

  /**
   * True while this effect's own beats still need frames: the entrance, a
   * trigger beat or the exit. Whether the LOOK needs idle frames (a drifting
   * pattern, an alert) is the renderer's `animated`, not this.
   */
  get hot() {
    if (this.dead || this.still) return false;
    return this.leaving || this.pulseAt >= 0 || this.enter < 1;
  }

  step(dt) {
    if (this.still) {
      if (this.leaving) this.dead = true;
      return;
    }
    const s = this.motionScale;
    this.elapsed += dt;
    if (this.pulseAt >= 0) {
      this.pulseAt += dt;
      if (this.pulseAt > TIMING.pulse * s) this.pulseAt = -1;
    }
    if (this.leaving) {
      this.leftFor += dt;
      if (this.leftFor >= TIMING.dissipate * s) this.dead = true;
    }
  }

  /** 0 -> 1 through the entrance, linear, then held at 1. */
  get enter() {
    if (this.still) return 1;
    const span = TIMING.castIn * this.motionScale;
    return span <= 0 ? 1 : clamp01(this.elapsed / span);
  }

  /**
   * The entrance as a NIB POSITION, 0 -> 1, monotonic, arriving exactly once.
   *
   * What this drives is the renderer's business: a "draw" entrance runs a pen
   * round the rim with the fill following it in, a "flash" entrance strikes
   * the whole frame at once and lets a flare settle. Neither scales the
   * geometry — the extent is final from frame one and only the INK moves. A
   * template that grows is a template briefly lying about which squares are
   * in it.
   */
  get eased() {
    return stroke(this.enter);
  }

  /** 1 -> 0 through the dissipate. */
  get leave() {
    if (!this.leaving) return 1;
    if (this.still) return 0;
    const span = TIMING.dissipate * this.motionScale;
    return span <= 0 ? 0 : 1 - clamp01(this.leftFor / span);
  }

  /**
   * The trigger beat, 0 at rest. Rises almost instantly and decays — the
   * flare is driven off this, so the attack must be sharp or the beat reads
   * as a slow bloom rather than an impact.
   */
  get shock() {
    if (this.pulseAt < 0 || this.still) return 0;
    const span = TIMING.pulse * this.motionScale;
    if (span <= 0) return 0;
    const t = clamp01(this.pulseAt / span);
    return Math.pow(1 - t, 1.9) * smooth(clamp01(t * 14));
  }

  /** 0 → 1 through the trigger beat, -1 at rest: the beat's echo ring. */
  get pulseProgress() {
    if (this.pulseAt < 0 || this.still) return -1;
    const span = TIMING.pulse * this.motionScale;
    return span <= 0 ? -1 : clamp01(this.pulseAt / span);
  }

  /** Seconds since birth, for the renderer's idle clocks. */
  get time() {
    return this.elapsed / 1000;
  }

  /**
   * Visibility, and the EXIT ONLY.
   *
   * The entrance is deliberately absent from this. Multiplying the whole quad's
   * alpha by the entrance curve is a global opacity ramp, which is the exact
   * thing a drawn-on template must not do: it fades the finished squares back
   * out while the nib is still laying the next ones, so the area never reads as
   * ink on a surface, only as a picture being turned up. Where the ink has
   * reached is the renderer's business (see `enter` in BEHAVIOR_MOTION); this
   * is only how much of the effect is left as it dissipates.
   */
  get presence() {
    return smooth(this.leave);
  }
}
