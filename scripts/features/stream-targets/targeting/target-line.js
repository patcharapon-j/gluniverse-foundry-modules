import { animate, remove } from "../../stream/motion/engine.js";
import { INK_SIGNAL, hexToInt } from "../../../core/theme.mjs";
import { TARGET_LINE_MOTION } from "./line-motion.js";
import { HEAD_HALF_WIDTH_SQUARES, HEAD_LENGTH_SQUARES, createPath, lineGeometry, pointAt, ringRadius } from "./target-geometry.js";

/**
 * The ink under every stroke: Ink and Signal's void (`--gl-is-ink-0`). A fixed near-black rather than a tint,
 * because a dark edge is what separates a line from bright map art: on a parchment floor a pale line with no rim
 * simply disappears. With PAPER it is the only colour this file does not take from the relationship colour setting.
 */
const INK = hexToInt(INK_SIGNAL.ink0);
/** The light the hairline core is mixed towards: Ink and Signal's paper (`--gl-is-paper`), not pure white. */
const PAPER = hexToInt(INK_SIGNAL.paper);
/** The brackets' alpha while a hand-off moves the origin and keeps the target. */
const RETICLE_HANDOFF_ALPHA = 0.45;
/** The brackets lock in from this multiple of their spread, and a released target's open back out to it. */
const RETICLE_OPEN_SCALE = 1.45;
/** During the lock, the brackets' alpha reaches 1 this many times sooner than their spread settles. */
const RETICLE_LOCK_ALPHA_RATE = 1.8;
/** A bracket's arm, as a share of its half-span. */
const BRACKET_ARM_SHARE = 0.34;
/** The head fades in over the last stretch of the reach, so it lands with the line. */
const HEAD_FADE_FROM = 0.82;
/** The body is thin where it leaves the source and reaches full width over this share of its length. */
const TAPER_SHARE = 0.4;
const TAPER_FROM = 0.4;
/** How far the core is mixed towards PAPER, for the one-device-pixel hairline down the middle. */
const BRIGHT_MIX = 0.62;

/** One lineStyle options object reused for every stroke; PIXI copies what it needs out of it. */
const LINE = { width: 1, color: PAPER, alpha: 1, cap: "round", join: "round", native: false };

/**
 * The containers a controller hangs its lines in: `under` holds each line's soft bed (drawn first, normal blend,
 * no filter), `core` the ink rim, the colour and the hairline. There used to be a third, blurred and additive,
 * for a halo; a filter on a container is a whole extra render pass every frame the lines are up, and the soft bed
 * reads the same over a map at a fraction of the cost.
 */
export function createLineLayers() {
  const layer = new PIXI.Container();
  layer.eventMode = "none";
  layer.interactiveChildren = false;
  const under = layer.addChild(new PIXI.Container());
  const core = layer.addChild(new PIXI.Container());
  return { layer, under, core };
}

/**
 * One targeting line from a source token to a target token: an arc that leaves the source thin and arrives at
 * full width, cut as ink, colour and a one-device-pixel hairline over a soft bed, ending in a solid head on four
 * corner brackets locked round the target.
 *
 * anime.js drives every animated value on `state`; `render` turns that state and the tokens' current (animated)
 * positions into PIXI geometry. A line that has landed does not move, and nothing is redrawn until an input to
 * its shape changes (`#shapeKey`): on a held line whose tokens are still, that is never. A line targeting its own
 * source draws only the brackets.
 */
export class TargetLine {
  state = { reach: 0, body: 1, headOut: 1, ringAlpha: 0, ringScale: 1 };
  shown = false;
  leaving = false;
  destroyed = false;
  /** Set while a hand-off retracts the body into the old source; the next `show()` relaunches from here. */
  nextSourceId = null;
  path = createPath();
  #point = { x: 0, y: 0, tx: 1, ty: 0 };
  #from = { x: 0, y: 0, tx: 1, ty: 0 };
  #geometry = { from: null, to: null, sourceSize: 0, targetSize: 0, gridSize: 100 };
  /** Every input the shape depends on, as last drawn; NaN forces the next render to redraw. */
  #shapeKey = new Float64Array(21).fill(NaN);

  constructor({ sourceId, targetId, under, core, style, calm, onGone }) {
    this.sourceId = sourceId;
    this.targetId = targetId;
    this.calm = calm;
    this.onGone = onGone;
    this.underGraphics = under.addChild(new PIXI.Graphics());
    this.coreGraphics = core.addChild(new PIXI.Graphics());
    this.setStyle(style);
  }

  get isSelfTarget() {
    return this.sourceId === this.targetId;
  }

  /** The token this line belongs to: its source, or the source a pending hand-off will relaunch it from. */
  get origin() {
    return this.nextSourceId ?? this.sourceId;
  }

  get color() {
    return Number(this.style?.color) || 0;
  }

  /** How long `hide()` or `retarget()` takes to clear the body from full reach. */
  get retractMs() {
    const motion = TARGET_LINE_MOTION;
    return this.calm ? motion.calmFadeOutMs : Math.max(motion.retractMs, motion.releaseMs);
  }

  /** The pause a hand-off leaves between this line's retract and its relaunch. */
  get beatMs() {
    return this.calm ? TARGET_LINE_MOTION.calmHandoffBeatMs : TARGET_LINE_MOTION.handoffBeatMs;
  }

  /** Whether this line can carry `targetId` over to `sourceId` in a hand-off: it is up, on that target, and not already theirs. */
  canHandOff(targetId, sourceId) {
    return this.shown && !this.leaving && !this.destroyed && this.targetId === targetId && this.origin !== sourceId;
  }

  /** Whether the body is currently drawn out of `tokenId` (a retargeted line still is, until it relaunches). */
  isDrawnFrom(tokenId) {
    return this.sourceId === tokenId;
  }

  setStyle(style) {
    const color = Number(style?.color) || 0;
    const intensity = Number(style?.intensity) || 1;
    if (this.style && color === this.color && intensity === (Number(this.style.intensity) || 1)) return;
    this.style = style;
    this.bright = mixColor(color, PAPER, BRIGHT_MIX);
    this.#shapeKey.fill(NaN);
  }

  /**
   * Launch the line; turn a retracting line around from wherever it has got to; or, after `retarget()`, move it
   * to its new source and relaunch from there with the kept brackets brightening back up.
   */
  show() {
    if (this.destroyed) return;
    const first = !this.shown;
    const relaunch = this.nextSourceId != null;
    if (!first && !this.leaving && !relaunch) return;
    const reversing = this.leaving;
    this.shown = true;
    this.leaving = false;
    if (relaunch) {
      this.sourceId = this.nextSourceId;
      this.nextSourceId = null;
    }
    const motion = TARGET_LINE_MOTION;
    const state = this.state;

    if (this.calm) {
      state.reach = 1;
      state.ringScale = 1;
      state.headOut = 1;
      if (first) {
        state.body = 0;
        state.ringAlpha = 0;
      }
      animate(state, { body: 1, ringAlpha: 1, duration: motion.calmFadeInMs, ease: "outQuad" });
      return;
    }

    state.body = 1;
    const reachMs = this.isSelfTarget ? 1 : Math.max(1, motion.launchMs * (1 - clamp01(state.reach)));
    animate(state, { reach: 1, duration: reachMs, ease: "outCubic" });
    if (first) {
      state.headOut = 1;
      state.ringAlpha = 0;
      state.ringScale = RETICLE_OPEN_SCALE;
      const delay = this.isSelfTarget ? 0 : motion.lockDelayMs;
      // The lock: the brackets close on the target and settle with a small overshoot.
      animate(state, { ringScale: 1, duration: motion.lockMs, delay, ease: "outBack(1.7)" });
      animate(state, { ringAlpha: 1, duration: motion.lockMs / RETICLE_LOCK_ALPHA_RATE, delay, ease: "linear" });
    } else if (relaunch) {
      state.headOut = 1;
      animate(state, { ringAlpha: 1, ringScale: 1, duration: motion.launchMs, ease: "outCubic" });
    } else if (reversing) {
      animate(state, { ringAlpha: 1, ringScale: 1, headOut: 1, duration: motion.releaseMs, ease: "outCubic" });
    }
  }

  /** Retract into the source and open the brackets away (or fade, in calm mode), then remove the line. */
  hide() {
    if (this.destroyed || this.leaving) return;
    this.leaving = true;
    this.nextSourceId = null;
    const finish = () => {
      if (this.leaving) this.destroy();
    };
    const motion = TARGET_LINE_MOTION;
    const state = this.state;
    if (this.calm) {
      animate(state, { body: 0, ringAlpha: 0, duration: motion.calmFadeOutMs, ease: "inQuad", onComplete: finish });
      return;
    }
    animate(state, { ringAlpha: 0, ringScale: RETICLE_OPEN_SCALE, duration: motion.releaseMs, ease: "inCubic" });
    this.#fadeHead();
    animate(state, {
      reach: 0,
      duration: Math.max(motion.releaseMs, motion.retractMs * clamp01(state.reach)),
      ease: "inCubic",
      onComplete: finish
    });
  }

  /**
   * Hand the line to another source without losing its target: the body retracts into the current source and
   * the brackets stay up at 45%. The line then waits; the controller calls `show()` after the beat to relaunch it
   * from `sourceId`, or `hide()` if the target went.
   */
  retarget(sourceId) {
    if (this.destroyed || this.leaving || !this.shown) return;
    if (this.nextSourceId === sourceId) return;
    const retracting = this.nextSourceId != null;
    this.nextSourceId = sourceId;
    if (retracting) return;
    const motion = TARGET_LINE_MOTION;
    const state = this.state;
    if (this.calm) {
      animate(state, { body: 0, duration: motion.calmFadeOutMs, ease: "inQuad" });
      animate(state, { ringAlpha: RETICLE_HANDOFF_ALPHA, ringScale: 1, duration: motion.calmFadeOutMs, ease: "inQuad" });
      return;
    }
    this.#fadeHead();
    animate(state, { reach: 0, duration: Math.max(1, motion.retractMs * clamp01(state.reach)), ease: "inCubic" });
    animate(state, { ringAlpha: RETICLE_HANDOFF_ALPHA, ringScale: 1, duration: motion.retractMs, ease: "inCubic" });
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    remove(this.state);
    for (const graphics of [this.underGraphics, this.coreGraphics]) {
      if (!graphics.destroyed) graphics.destroy();
    }
    this.onGone?.(this);
  }

  /** Draw for this frame; returns whether anything was redrawn (the controller's motion claim reads it). */
  render({ source, target, scale, gridSize, resolution = 1 }) {
    const under = this.underGraphics;
    const core = this.coreGraphics;
    if (this.destroyed || !source?.document || !target?.document) {
      under.clear();
      core.clear();
      this.#shapeKey.fill(NaN);
      return false;
    }

    const state = this.state;
    const color = this.color;
    const bright = this.bright;
    const zoom = Math.max(0.05, Number(scale) || 1);
    // Soft widths are authored in screen pixels and only partly follow the zoom, so the line stays legible when
    // the camera pulls back and does not turn into a rope when it pushes in. A hairline is one device pixel.
    const u = Math.max(0.5, Number(this.style?.intensity) || 1) / Math.pow(zoom, 0.65);
    const hl = hairlineWidth(zoom, resolution);
    const body = clamp01(state.body);
    const reach = clamp01(state.reach);
    const to = target.center;
    const from = source.center;
    const targetSize = Math.max(target.w, target.h);

    if (!updateKey(this.#shapeKey, from.x, from.y, source.w, source.h, to.x, to.y, target.w, target.h, gridSize, u,
      hl, color, body, reach, state.headOut, state.ringAlpha, state.ringScale, this.calm ? 1 : 0,
      this.leaving ? 1 : 0, this.nextSourceId == null ? 0 : 1)) return false;

    under.clear();
    core.clear();
    const point = this.#point;
    if (!this.isSelfTarget && reach > 0.001 && body > 0.001) {
      const path = this.#layout(from, to, source, targetSize, gridSize);
      const end = path.length * reach;
      const taperTo = Math.max(1, path.length * TAPER_SHARE);

      // The bed: a wide, faint band of the line's own colour, so it holds over busy art without a blur pass.
      strokePath(under, path, 0, end, 9 * u, color, 0.1 * body, point);
      strokePath(under, path, 0, end, 5 * u, color, 0.14 * body, point);
      // Ink rim, colour, hairline: the body tapers out of the source, so its direction reads without the head.
      // Never thinner than two device pixels, or the hairline down the middle would be wider than its band.
      strokeTapered(core, path, end, taperTo, (2.6 * u) + (2.5 * hl), 4.5 * hl, INK, 0.6 * body, point, this.#from);
      strokeTapered(core, path, end, taperTo, 2.6 * u, 2 * hl, color, 0.95 * body, point, this.#from);
      strokePath(core, path, 0, end, hl, bright, 0.9 * body, point);

      pointAt(path, 0, point);
      fillCircle(core, point.x, point.y, (1.7 * u) + (1.5 * hl), INK, 0.6 * body);
      fillCircle(core, point.x, point.y, 1.7 * u, bright, body);

      pointAt(path, end, point);
      const headIn = clamp01((reach - HEAD_FADE_FROM) / (1 - HEAD_FADE_FROM));
      const headAlpha = headIn * clamp01(state.headOut) * body;
      if (headAlpha > 0.001) {
        drawHead(core, point, HEAD_LENGTH_SQUARES * gridSize, HEAD_HALF_WIDTH_SQUARES * gridSize, hl, color, headAlpha);
      }
      // The pen: while the body is still travelling, its tip is lit.
      if (!this.calm && reach < 0.98) fillCircle(core, point.x, point.y, 2 * u, bright, body);
    }

    const ringAlpha = clamp01(state.ringAlpha);
    if (ringAlpha > 0.001) {
      const half = ringRadius(targetSize) * Math.max(0, Number(state.ringScale) || 0);
      drawBrackets(core, to.x, to.y, half, (1.8 * u) + (2.5 * hl), INK, 0.55 * ringAlpha);
      drawBrackets(core, to.x, to.y, half, 1.8 * u, color, 0.95 * ringAlpha);
      drawBrackets(core, to.x, to.y, half, hl, bright, 0.9 * ringAlpha);
    }
    return true;
  }

  /** The body's path for these endpoints, into the reused buffer. */
  #layout(from, to, source, targetSize, gridSize) {
    const input = this.#geometry;
    input.from = from;
    input.to = to;
    input.sourceSize = Math.max(source.w, source.h);
    input.targetSize = targetSize;
    input.gridSize = gridSize;
    return lineGeometry(input, this.path);
  }

  /** The head goes in the first moments of a retract, rather than riding the body back into the source. */
  #fadeHead() {
    animate(this.state, { headOut: 0, duration: TARGET_LINE_MOTION.headFadeOutMs, ease: "linear" });
  }
}

/**
 * A hand-off's "the origin moved" cue: one hairline ring sinking into the old token over the end of the retract,
 * or rising out of the new token as its lines launch. The controller draws one per token per hand-off, however
 * many targets are handed over, and never in calm motion. It removes itself when it has played.
 */
export class OriginRing {
  state = { progress: 0 };
  destroyed = false;

  constructor({ layer, tokenId, kind, color, onGone }) {
    this.tokenId = tokenId;
    this.kind = kind;
    this.onGone = onGone;
    this.bright = mixColor(Number(color) || 0, PAPER, BRIGHT_MIX);
    this.graphics = layer.addChild(new PIXI.Graphics());
    const motion = TARGET_LINE_MOTION;
    const sinking = kind === "sink";
    animate(this.state, {
      progress: [0, 1],
      duration: sinking ? motion.originSinkMs : motion.originRiseMs,
      delay: sinking ? Math.max(0, motion.retractMs - motion.originSinkMs) : 0,
      ease: "linear",
      onComplete: () => this.destroy()
    });
  }

  render({ source, scale, resolution = 1 }) {
    const graphics = this.graphics;
    graphics.clear();
    const progress = Number(this.state.progress) || 0;
    if (this.destroyed || !source?.center || progress <= 0 || progress >= 1) return;
    const tokenRadius = Math.max(source.w, source.h) / 2;
    const sinking = this.kind === "sink";
    const radius = tokenRadius * (sinking
      ? lerp(1.45, 0.9, progress * progress * progress)
      : lerp(0.9, 1.5, 1 - Math.pow(1 - progress, 3)));
    const alpha = 0.9 * (sinking ? 1 - (0.6 * progress) : 1 - progress);
    const hl = hairlineWidth(Math.max(0.05, Number(scale) || 1), resolution);
    strokeCircle(graphics, source.center.x, source.center.y, radius, hl, this.bright, alpha);
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    remove(this.state);
    if (!this.graphics.destroyed) this.graphics.destroy();
    this.onGone?.(this);
  }
}

/** Write the values into `key`, returning whether any differed from what it held. */
function updateKey(key, ...values) {
  let changed = false;
  for (let i = 0; i < values.length; i++) {
    const value = Number(values[i]);
    if (key[i] !== value) {
      key[i] = value;
      changed = true;
    }
  }
  return changed;
}

/** One device pixel in world units, at this zoom and renderer resolution. */
function hairlineWidth(zoom, resolution) {
  return 1 / (zoom * Math.max(0.25, Number(resolution) || 1));
}

function setLine(graphics, width, color, alpha) {
  LINE.width = width;
  LINE.color = color;
  LINE.alpha = alpha;
  LINE.cap = PIXI.LINE_CAP.ROUND;
  LINE.join = PIXI.LINE_JOIN.ROUND;
  graphics.lineStyle(LINE);
}

/** Stroke the stretch of `path` from arc length `start` to `end`, straight from the path buffer. */
function strokePath(graphics, path, start, end, width, color, alpha, point) {
  if (end - start < 0.01 || alpha <= 0.001 || width <= 0) return;
  setLine(graphics, width, color, alpha);
  pointAt(path, start, point);
  graphics.moveTo(point.x, point.y);
  const { xs, ys, arcs } = path;
  const last = xs.length - 1;
  for (let i = 1; i < last; i++) {
    if (arcs[i] > start && arcs[i] < end) graphics.lineTo(xs[i], ys[i]);
  }
  pointAt(path, end, point);
  graphics.lineTo(point.x, point.y);
}

/**
 * Stroke `path` up to `end` at a width that grows from TAPER_FROM of `width` at the source to all of it at
 * `taperTo`, then holds, never under `floor`. Each sample span is its own stroke with round caps, so the joins
 * stay closed.
 */
function strokeTapered(graphics, path, end, taperTo, width, floor, color, alpha, point, prev) {
  width = Math.max(width, floor);
  if (end < 0.01 || alpha <= 0.001 || width <= 0) return;
  const { xs, ys, arcs } = path;
  const last = xs.length - 1;
  pointAt(path, 0, prev);
  let at = 0;
  // Past the taper the width no longer changes: one stroke carries the rest.
  for (let i = 1; i <= last && at < end; i++) {
    const next = Math.min(end, arcs[i]);
    if (at >= taperTo) {
      strokePath(graphics, path, at, end, width, color, alpha, point);
      return;
    }
    const share = TAPER_FROM + ((1 - TAPER_FROM) * smooth(clamp01(((at + next) / 2) / taperTo)));
    setLine(graphics, Math.max(floor, width * share), color, alpha);
    graphics.moveTo(prev.x, prev.y);
    pointAt(path, next, point);
    graphics.lineTo(point.x, point.y);
    prev.x = point.x;
    prev.y = point.y;
    at = next;
  }
}

function strokeCircle(graphics, x, y, radius, width, color, alpha) {
  if (alpha <= 0.001 || radius <= 0) return;
  setLine(graphics, width, color, alpha);
  graphics.drawCircle(x, y, radius);
}

function fillCircle(graphics, x, y, radius, color, alpha) {
  if (alpha <= 0.001 || radius <= 0) return;
  graphics.lineStyle(0);
  graphics.beginFill(color, alpha);
  graphics.drawCircle(x, y, radius);
  graphics.endFill();
}

/** Four corner brackets on the square of half-span `half` round (x, y): the suite's cut motif, as a lock. */
function drawBrackets(graphics, x, y, half, width, color, alpha) {
  if (alpha <= 0.001 || half <= 0 || width <= 0) return;
  const arm = half * BRACKET_ARM_SHARE;
  setLine(graphics, width, color, alpha);
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      const cx = x + (sx * half);
      const cy = y + (sy * half);
      graphics.moveTo(cx - (sx * arm), cy);
      graphics.lineTo(cx, cy);
      graphics.lineTo(cx, cy - (sy * arm));
    }
  }
}

/** A filled wedge whose tip sits on `tip`, pointing along its tangent, with an ink rim. */
function drawHead(graphics, tip, length, halfWidth, hairline, color, alpha) {
  const baseX = tip.x - (tip.tx * length);
  const baseY = tip.y - (tip.ty * length);
  const nx = -tip.ty * halfWidth;
  const ny = tip.tx * halfWidth;
  setLine(graphics, 2.5 * hairline, INK, 0.6 * alpha);
  graphics.beginFill(color, alpha);
  graphics.moveTo(tip.x, tip.y);
  graphics.lineTo(baseX + nx, baseY + ny);
  graphics.lineTo(baseX - nx, baseY - ny);
  graphics.closePath();
  graphics.endFill();
}

function mixColor(a, b, amount) {
  const mix = (shift) => {
    const from = (a >> shift) & 0xff;
    const to = (b >> shift) & 0xff;
    return Math.round(from + ((to - from) * amount)) << shift;
  };
  return mix(16) | mix(8) | mix(0);
}

function smooth(t) {
  return t * t * (3 - (2 * t));
}

function lerp(a, b, t) {
  return a + ((b - a) * t);
}

function clamp01(value) {
  return Math.min(1, Math.max(0, Number(value) || 0));
}

export { INK, PAPER, RETICLE_HANDOFF_ALPHA };
