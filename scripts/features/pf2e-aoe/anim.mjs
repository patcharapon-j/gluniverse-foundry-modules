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
  castIn: 520,      // the template is DRAWN on: nib travels, ink lands behind it
  castHold: 90,     // the beat after the last stroke lands, before it settles
  pulse: 520,       // the trigger beat: flash, shockwave, settle
  dissipate: 640,   // collapse inward and drift up
  scorchFade: 2600, // the ground decal outliving the effect
});

/**
 * Everything animated, cheapest to shed first. The host drops behaviours off
 * the front of this list as frame time climbs.
 *
 * Two entries are deliberately ABSENT and must stay absent: the rules lattice
 * and the boundary rim. Readability is not a quality tier — a player must be
 * able to answer "am I in it?" on a machine that cannot afford motes.
 */
export const SHED_ORDER = Object.freeze([
  "tokenEdgeLight", // alpha-masked token rim light; no image displacement
  "motes",     // rising particulate
  "scorch",    // the persistent ground decal
  "skirt",     // the fake vertical
  "turbulence" // the archetype fill collapses to a flat lit plate
]);

/** Hysteresis, ms of rolling frame time. Shedding at the same threshold it
 *  unsheds at makes the whole set flicker on and off at the boundary. */
export const SHED_AT = 22;
export const UNSHED_AT = 15;

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
   * True while this effect still needs frames. A sustaining AoE is always hot —
   * turbulence and motes need frames with no event behind them — but a shed-out
   * one that has finished entering does not.
   */
  get hot() {
    if (this.dead) return false;
    if (this.still) return false;
    return true;
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
   * What this drives is the shader's business: uEnterMode picks between a pen
   * running the perimeter, a radial write outward, and a wireframe that strikes
   * whole before flooding. All three read this one curve, and none of them
   * scales the geometry or fades the whole quad — the extent is final from
   * frame one and only the INK moves. A template that grows is a template
   * briefly lying about which squares are in it.
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
   * shockwave radius is driven off this, so the attack must be sharp or the
   * ring reads as a slow bloom rather than an impact.
   */
  get shock() {
    if (this.pulseAt < 0 || this.still) return 0;
    const span = TIMING.pulse * this.motionScale;
    if (span <= 0) return 0;
    const t = clamp01(this.pulseAt / span);
    return Math.pow(1 - t, 1.9) * smooth(clamp01(t * 14));
  }

  /** Seconds since birth, for the shader's own clocks. */
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
   * reached is the shader's business (see uEnterMode); this is only how much of
   * the effect is left as it dissipates.
   */
  get presence() {
    return smooth(this.leave);
  }
}
