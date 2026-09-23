import { TARGET_LINE_MOTION } from "../../stream/constants.js";
import { animate, remove } from "../../stream/motion/engine.js";
import { HEAD_HALF_WIDTH_SQUARES, HEAD_LENGTH_SQUARES, SWEEP_LENGTH_SQUARES, createPath, lineGeometry, pointAt, ringRadius } from "./target-geometry.js";

/**
 * The etched rim under every body and reticle. A fixed near-black rather than a tint, because a dark edge is
 * what separates a line from bright map art. With white it is the only colour this file does not take from the
 * relationship colour setting.
 */
const INK = 0x080a0e;
const WHITE = 0xffffff;
/** The reticle's alpha while a hand-off moves the origin and keeps the target. */
const RETICLE_HANDOFF_ALPHA = 0.45;
/** The reticle pops in from this multiple of its radius, and a collapsing one grows out to it. */
const RETICLE_POP_SCALE = 1.6;
/** During the pop, the reticle's alpha reaches 1 this many times sooner than its scale settles. */
const RETICLE_POP_ALPHA_RATE = 1.6;
const QUADRANT_SPAN = Math.PI * 0.22;
/** The head fades in over the last stretch of the reach, so it lands with the line. */
const HEAD_FADE_FROM = 0.82;
/** The sweep's white hairline covers its leading part only. */
const SWEEP_LEAD_FROM = 0.55;
const TAU = Math.PI * 2;
/** The body halo's alpha runs LOW..LOW+SWING with the pulse; PEAK is the top of that range. */
const HALO_BODY_LOW = 0.16;
const HALO_BODY_SWING = 0.08;
const HALO_BODY_PEAK = HALO_BODY_LOW + HALO_BODY_SWING;
/** The same for the reticle's halo. */
const HALO_RING_LOW = 0.22;
const HALO_RING_SWING = 0.1;
const HALO_RING_PEAK = HALO_RING_LOW + HALO_RING_SWING;

/** One lineStyle options object reused for every stroke; PIXI copies what it needs out of it. */
const LINE = { width: 1, color: WHITE, alpha: 1, cap: "round", join: "round", native: false };

/**
 * One targeting line from a source token to a target token, cut as Etched Glass (the "Etched Bow"): an arc with a
 * dark etched rim, a band and core tinted with the relationship colour and a one-device-pixel bright hairline,
 * under one blurred halo. A filled wedge lands on a hairline reticle whose four quadrant marks turn once every
 * six seconds, and a single light sweep runs down the body while it holds.
 *
 * anime.js drives every animated value on `state`; `render` turns that state and the tokens' current (animated)
 * positions into PIXI geometry once per canvas frame. A line targeting its own source draws only the reticle.
 *
 * Graphics: `halo` sits in the controller's shared blurred ADD container, `core` draws normally (the etched rim
 * would vanish under ADD), and `glint` adds the sweep's light on top.
 *
 * While a line holds, three loops run forever — sweep, spin, pulse — and rebuilding every stroke of every line
 * for them each frame is the whole of this feature's CPU cost. So each loop reaches the screen through the
 * cheapest thing that can carry it: the pulse is the alpha of the two halo Graphics (split so each keeps its own
 * exact pulse range), the spin is the rotation of the quadrant marks' own Graphics, and only the sweep, which
 * travels a curve, is re-stroked, on `glint` alone. Everything else is rebuilt only when an input to its shape
 * changes (`#shapeKey`), which on a held line whose tokens are still is never.
 */
export class TargetLine {
  state = { reach: 0, body: 1, headOut: 1, ringAlpha: 0, ringScale: 1, sweep: 0, spin: 0, pulse: 0.5 };
  shown = false;
  leaving = false;
  destroyed = false;
  /** Set while a hand-off retracts the body into the old source; the next `show()` relaunches from here. */
  nextSourceId = null;
  loops = [];
  path = createPath();
  #point = { x: 0, y: 0, tx: 1, ty: 0 };
  #geometry = { from: null, to: null, sourceSize: 0, targetSize: 0, gridSize: 100 };
  /** Every input the static shape depends on, as last drawn; NaN forces the next render to redraw. */
  #shapeKey = new Float64Array(22).fill(NaN);
  #sweepDrawn = NaN;

  constructor({ sourceId, targetId, halo, core, glint, style, calm, onGone }) {
    this.sourceId = sourceId;
    this.targetId = targetId;
    this.calm = calm;
    this.onGone = onGone;
    this.haloGraphics = halo.addChild(new PIXI.Graphics());
    this.haloRingGraphics = halo.addChild(new PIXI.Graphics());
    this.coreGraphics = core.addChild(new PIXI.Graphics());
    this.spinGraphics = core.addChild(new PIXI.Graphics());
    this.glintGraphics = glint.addChild(new PIXI.Graphics());
    this.glintGraphics.blendMode = PIXI.BLEND_MODES.ADD;
    this.setStyle(style);
    if (!calm) this.#startLoops();
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
    return this.calm ? motion.calmFadeOutMs : Math.max(motion.retractMs, motion.reticleCollapseMs);
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
    this.style = style;
    this.bright = mixColor(Number(style?.color) || 0, WHITE, 0.65);
    this.#shapeKey.fill(NaN);
  }

  /**
   * Launch the line; turn a retracting line around from wherever it has got to; or, after `retarget()`, move it
   * to its new source and relaunch from there with the kept reticle brightening back up.
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
    this.#resumeLoops();
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
      state.ringScale = RETICLE_POP_SCALE;
      const delay = this.isSelfTarget ? 0 : motion.reticlePopDelayMs;
      animate(state, { ringScale: 1, duration: motion.reticlePopMs, delay, ease: "outBack(2.2)" });
      animate(state, {
        ringAlpha: 1,
        duration: motion.reticlePopMs / RETICLE_POP_ALPHA_RATE,
        delay,
        ease: "linear"
      });
    } else if (relaunch) {
      state.headOut = 1;
      animate(state, { ringAlpha: 1, ringScale: 1, duration: motion.launchMs, ease: "outCubic" });
    } else if (reversing) {
      animate(state, { ringAlpha: 1, ringScale: 1, headOut: 1, duration: motion.reticleCollapseMs, ease: "outCubic" });
    }
  }

  /** Retract into the source and collapse the reticle (or fade, in calm mode), then remove the line. */
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
    animate(state, {
      ringAlpha: 0,
      ringScale: RETICLE_POP_SCALE,
      duration: motion.reticleCollapseMs,
      ease: "inCubic"
    });
    this.#fadeHead();
    animate(state, {
      reach: 0,
      duration: Math.max(motion.reticleCollapseMs, motion.retractMs * clamp01(state.reach)),
      ease: "inCubic",
      onComplete: finish
    });
  }

  /**
   * Hand the line to another source without losing its target: the body retracts into the current source and
   * the reticle stays up at 45% with its loops frozen. The line then waits; the controller calls `show()` after
   * the beat to relaunch it from `sourceId`, or `hide()` if the target went.
   */
  retarget(sourceId) {
    if (this.destroyed || this.leaving || !this.shown) return;
    if (this.nextSourceId === sourceId) return;
    const retracting = this.nextSourceId != null;
    this.nextSourceId = sourceId;
    if (retracting) return;
    this.#freezeLoops();
    const motion = TARGET_LINE_MOTION;
    const state = this.state;
    if (this.calm) {
      animate(state, { body: 0, duration: motion.calmFadeOutMs, ease: "inQuad" });
      animate(state, {
        ringAlpha: RETICLE_HANDOFF_ALPHA,
        ringScale: 1,
        duration: motion.calmFadeOutMs,
        ease: "inQuad"
      });
      return;
    }
    this.#fadeHead();
    animate(state, { reach: 0, duration: Math.max(1, motion.retractMs * clamp01(state.reach)), ease: "inCubic" });
    animate(state, { ringAlpha: RETICLE_HANDOFF_ALPHA, ringScale: 1, duration: motion.retractMs, ease: "inCubic" });
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const loop of this.loops) loop?.cancel?.();
    this.loops = [];
    remove(this.state);
    for (const graphics of [this.haloGraphics, this.haloRingGraphics, this.coreGraphics, this.spinGraphics, this.glintGraphics]) {
      if (!graphics.destroyed) graphics.destroy();
    }
    this.onGone?.(this);
  }

  render({ source, target, scale, gridSize, resolution = 1 }) {
    const halo = this.haloGraphics;
    const haloRing = this.haloRingGraphics;
    const core = this.coreGraphics;
    const spinMarks = this.spinGraphics;
    const glint = this.glintGraphics;
    if (this.destroyed || !source?.document || !target?.document) {
      for (const graphics of [halo, haloRing, core, spinMarks, glint]) graphics.clear();
      this.#shapeKey.fill(NaN);
      this.#sweepDrawn = NaN;
      return;
    }

    const state = this.state;
    const color = this.color;
    const bright = this.bright;
    const zoom = Math.max(0.05, Number(scale) || 1);
    // Soft widths are authored in screen pixels and only partly follow the zoom, so the line stays legible when
    // the camera pulls back and does not turn into a rope when it pushes in. A hairline is one device pixel.
    const u = Math.max(0.5, Number(this.style?.intensity) || 1) / Math.pow(zoom, 0.65);
    const hl = hairlineWidth(zoom, resolution);
    const pulse = this.calm ? 0.5 : clamp01(state.pulse);
    const body = clamp01(state.body);
    const reach = clamp01(state.reach);
    const to = target.center;
    const from = source.center;
    const targetSize = Math.max(target.w, target.h);
    const point = this.#point;
    const drawsBody = !this.isSelfTarget && reach > 0.001 && body > 0.001;
    const holding = drawsBody && this.#holding(reach);

    // The pulse, as the halo's alpha: each halo is drawn at the top of its range and scaled down into it, which
    // is exactly the per-stroke alpha it replaces.
    const bodyGain = (HALO_BODY_LOW + (HALO_BODY_SWING * pulse)) / HALO_BODY_PEAK;
    halo.alpha = bodyGain;
    haloRing.alpha = (HALO_RING_LOW + (HALO_RING_SWING * pulse)) / HALO_RING_PEAK;
    // The spin, as a rotation about the target's centre.
    spinMarks.x = to.x;
    spinMarks.y = to.y;
    spinMarks.rotation = this.calm ? 0 : Number(state.spin) || 0;

    const key = this.#shapeKey;
    const shapeChanged = updateKey(key, from.x, from.y, source.w, source.h, to.x, to.y, target.w, target.h, gridSize, u,
      hl, color, bright, body, reach, state.headOut, state.ringAlpha, state.ringScale, this.calm ? 1 : 0,
      this.leaving ? 1 : 0, this.nextSourceId == null ? 0 : 1, this.isSelfTarget ? 1 : 0);

    if (shapeChanged) {
      halo.clear();
      haloRing.clear();
      core.clear();
      spinMarks.clear();
      if (drawsBody) {
        const path = this.#layout(from, to, source, targetSize, gridSize);
        const end = path.length * reach;

        strokePath(halo, path, 0, end, 14 * u, color, HALO_BODY_PEAK * body, point);
        strokePath(core, path, 0, end, (5 * u) + (2 * hl), INK, 0.5 * body, point);
        strokePath(core, path, 0, end, 5 * u, color, 0.3 * body, point);
        strokePath(core, path, 0, end, 2 * u, color, 0.85 * body, point);
        strokePath(core, path, 0, end, hl, bright, 0.95 * body, point);

        pointAt(path, 0, point);
        strokeCircle(core, point.x, point.y, 3 * u, 2 * hl, INK, 0.5 * body);
        fillCircle(core, point.x, point.y, 2.4 * u, bright, 0.95 * body);

        pointAt(path, end, point);
        const headIn = clamp01((reach - HEAD_FADE_FROM) / (1 - HEAD_FADE_FROM));
        const headAlpha = headIn * clamp01(state.headOut) * body;
        if (headAlpha > 0.001) {
          drawHead(core, point, HEAD_LENGTH_SQUARES * gridSize, HEAD_HALF_WIDTH_SQUARES * gridSize, hl, color, bright, headAlpha);
        }
        if (!this.calm && reach < 0.98) {
          // Unpulsed, so drawn against the gain the halo carries this frame; reach is moving here, so it is
          // redrawn every frame this is on screen.
          fillCircle(halo, point.x, point.y, 9 * u, color, Math.min(1, (0.7 * body) / bodyGain));
          fillCircle(core, point.x, point.y, 3 * u, bright, body);
        }
      }

      const ringAlpha = clamp01(state.ringAlpha);
      if (ringAlpha > 0.001) {
        const radius = ringRadius(targetSize) * Math.max(0, Number(state.ringScale) || 0);
        strokeCircle(haloRing, to.x, to.y, radius, 8 * u, color, HALO_RING_PEAK * ringAlpha);
        strokeCircle(core, to.x, to.y, radius, 3 * hl, INK, 0.45 * ringAlpha);
        strokeCircle(core, to.x, to.y, radius, hl, color, 0.7 * ringAlpha);
        for (let i = 0; i < 4; i++) {
          const start = (i * Math.PI / 2) - (QUADRANT_SPAN / 2);
          strokeArc(spinMarks, 0, 0, radius, start, start + QUADRANT_SPAN, 3 * u, color, 0.95 * ringAlpha);
          strokeArc(spinMarks, 0, 0, radius, start, start + QUADRANT_SPAN, hl, bright, 0.95 * ringAlpha);
        }
      }
    }

    // The sweep travels a curve, so it is the one loop that has to be re-stroked — on its own Graphics only.
    const sweep = holding ? clamp01(state.sweep) : -1;
    if (shapeChanged || sweep !== this.#sweepDrawn) {
      this.#sweepDrawn = sweep;
      glint.clear();
      if (holding) {
        // Holding implies the body was laid out by the last shape pass, from these same inputs.
        const path = this.path;
        const length = SWEEP_LENGTH_SQUARES * gridSize;
        const head = (sweep * (path.length + length)) - length;
        const stop = Math.min(path.length, head + length);
        strokePath(glint, path, Math.max(0, head), stop, 3 * u, bright, 0.35 * body, point);
        strokePath(glint, path, Math.max(0, head + (length * SWEEP_LEAD_FROM)), stop, 2 * hl, WHITE, 0.6 * body, point);
      }
    }
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

  /** The sweep only runs down a body that is fully drawn and staying. */
  #holding(reach) {
    return !this.calm && !this.leaving && this.nextSourceId == null && reach >= 0.999;
  }

  /** The head goes in the first moments of a retract, rather than riding the body back into the source. */
  #fadeHead() {
    animate(this.state, { headOut: 0, duration: TARGET_LINE_MOTION.headFadeOutMs, ease: "linear" });
  }

  #startLoops() {
    const motion = TARGET_LINE_MOTION;
    this.loops = [
      animate(this.state, { sweep: [0, 1], duration: motion.sweepPeriodMs, ease: "linear", loop: true }),
      animate(this.state, { spin: [0, TAU], duration: motion.spinPeriodMs, ease: "linear", loop: true }),
      animate(this.state, {
        pulse: [0, 1],
        duration: motion.pulsePeriodMs,
        ease: "inOutSine",
        loop: true,
        alternate: true
      })
    ];
  }

  #freezeLoops() {
    for (const loop of this.loops) loop?.pause?.();
  }

  #resumeLoops() {
    for (const loop of this.loops) loop?.resume?.();
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
    this.bright = mixColor(Number(color) || 0, WHITE, 0.65);
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

function strokeCircle(graphics, x, y, radius, width, color, alpha) {
  if (alpha <= 0.001 || radius <= 0) return;
  setLine(graphics, width, color, alpha);
  graphics.drawCircle(x, y, radius);
}

function strokeArc(graphics, x, y, radius, start, end, width, color, alpha) {
  if (alpha <= 0.001 || radius <= 0) return;
  setLine(graphics, width, color, alpha);
  graphics.moveTo(x + (Math.cos(start) * radius), y + (Math.sin(start) * radius));
  graphics.arc(x, y, radius, start, end);
}

function fillCircle(graphics, x, y, radius, color, alpha) {
  if (alpha <= 0.001 || radius <= 0) return;
  graphics.lineStyle(0);
  graphics.beginFill(color, alpha);
  graphics.drawCircle(x, y, radius);
  graphics.endFill();
}

/** A filled wedge whose tip sits on `tip`, pointing along its tangent. */
function drawHead(graphics, tip, length, halfWidth, hairline, color, bright, alpha) {
  const baseX = tip.x - (tip.tx * length);
  const baseY = tip.y - (tip.ty * length);
  const nx = -tip.ty * halfWidth;
  const ny = tip.tx * halfWidth;
  setLine(graphics, hairline, bright, 0.95 * alpha);
  graphics.beginFill(color, 0.6 * alpha);
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

function lerp(a, b, t) {
  return a + ((b - a) * t);
}

function clamp01(value) {
  return Math.min(1, Math.max(0, Number(value) || 0));
}
