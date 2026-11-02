/**
 * Diorama — tiny tween helpers. Pure: no three, no DOM.
 *
 * Every tween is driven by the renderer's own clock (`now` in ms) so a frame
 * that is skipped by the fps cap or a hidden tab simply lands further along.
 */

export const ease = {
  linear: (t) => t,
  outCubic: (t) => 1 - (1 - t) ** 3,
  inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
  outQuad: (t) => 1 - (1 - t) * (1 - t),
};

export const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);
export const lerp = (a, b, t) => a + (b - a) * t;

/** Shortest signed angular difference b − a, radians. */
export function angleDelta(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/**
 * A scalar tween. `value(now)` is total: before the start it reads `from`,
 * after the end `to`.
 */
export class Tween {
  constructor(from, to, ms, now, easing = ease.inOutCubic) {
    this.from = from;
    this.to = to;
    this.ms = Math.max(0, ms);
    this.t0 = now;
    this.easing = easing;
  }

  progress(now) {
    return this.ms <= 0 ? 1 : clamp01((now - this.t0) / this.ms);
  }

  value(now) {
    return lerp(this.from, this.to, this.easing(this.progress(now)));
  }

  done(now) {
    return this.progress(now) >= 1;
  }
}

/**
 * A value that eases toward whatever it was last told, from wherever it is.
 * `set(to)` mid-flight restarts from the current value, so nothing jumps.
 */
export class Eased {
  constructor(value, ms, easing = ease.inOutCubic) {
    this.ms = ms;
    this.easing = easing;
    this.tw = null;
    this.v = value;
    this.target = value;
  }

  set(to, now, animate = true, ms = this.ms) {
    if (to === this.target && (this.tw || this.v === to)) return;
    this.target = to;
    if (!animate || ms <= 0) { this.tw = null; this.v = to; return; }
    this.tw = new Tween(this.v, to, ms, now, this.easing);
  }

  update(now) {
    if (!this.tw) return this.v;
    this.v = this.tw.value(now);
    if (this.tw.done(now)) { this.v = this.tw.to; this.tw = null; }
    return this.v;
  }

  get active() {
    return this.tw !== null;
  }
}
