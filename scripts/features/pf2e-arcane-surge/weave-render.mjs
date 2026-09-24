/**
 * GLUniverse Suite — the stability weave, as DOM and motion.
 *
 * Everything about the weave that is an element or a tween. It knows nothing
 * about Foundry, settings, permissions or stability levels: it takes a box and
 * a set of parameters out of `weave-shape.mjs` and draws them. `weave.mjs` is
 * the half that reads the world.
 *
 * That seam is not tidiness. This layer is judged by eye and only by eye — no
 * pure check can tell you whether a weave reads at twenty pixels tall over a
 * word — so `tools/arcane-surge-preview.mjs` has to be able to run the REAL
 * renderer rather than a reimplementation of it, and it can only do that if the
 * renderer does not reach for `game`. A preview built on a second copy of this
 * flatters whichever copy somebody last touched.
 *
 * THE MOTION IS ANIME.JS, SOUGHT BY THE SUITE'S SHARED ENGINE. Nothing here
 * touches that engine, its speed or its main loop: a dozen other features run
 * on it. It already pauses itself while the document is hidden, which is why
 * this layer costs nothing in a background tab and carries no visibility
 * handler of its own.
 *
 * SHEDDING RIDES `core/budget.mjs`. The renderer used to time its own frames
 * on a one-second anime timer to feed a private rolling average; the suite's
 * shared reflex already measures every frame, so this layer now only LISTENS
 * for the feature's ladder (`ladder.mjs`) to change and pauses or plays the
 * drift when it does. That import is still drivable from the preview: the
 * budget is dependency-free and reads nothing of Foundry's.
 */

import { Budget } from "../../core/budget.mjs";
import { animate, createMotionOwner } from "../../core/motion.mjs";
import { acquireLadder, releaseLadder } from "./ladder.mjs";
import {
  BLEED_PX,
  FLOW_PERIOD_PX,
  THREADS,
  dashPattern,
  driftMs,
  flowDash,
  flowMs,
  threadPath,
  wavelength,
} from "./weave-shape.mjs";

/** How long the weave takes to spread or close when the level changes.
 *  A cut would announce the change; a spread lets people notice it. */
export const FADE_MS = 1100;

const SVG_NS = "http://www.w3.org/2000/svg";

let sequence = 0;

const el = (name, attrs = {}) => {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
};

/** True when two parameter sets differ in anything the GEOMETRY is built from.
 *  Opacity and reach are animated instead, so a change in either must not
 *  trigger a rebuild — that would restart every drift loop mid-fade. */
const reshapes = (a, b) =>
  !a || a.amplitude !== b.amplitude || a.gapFraction !== b.gapFraction || a.splay !== b.splay;

export class WeaveRenderer {
  constructor({ seed = Math.random() * 100 } = {}) {
    this.seed = seed;
    this.budget = acquireLadder();
    this.motion = createMotionOwner();
    /** The live, animated state — the only two things `_paint()` writes. */
    this.state = { opacity: 0, reach: 0.5 };
    this._ids = null;
    this.svg = null;
    this.maskNode = null;
    this.reachEllipse = null;
    this.threads = [];
    this._built = null;
    this._wanted = null;
    this._fade = null;
    this._unwatch = null;
    this._drifting = false;
    this._box = null;
    this._observer = null;
    this._build();
  }

  get element() {
    return this.svg;
  }

  /* ── The element ─────────────────────────────────────────────────── */

  _build() {
    /* Ids are document-global and `<use>`/`mask` resolve through them, so each
       renderer gets its own set. One weave ships at a time, but the preview
       page stands four of them side by side and a shared id would point every
       thread on it at the last one built. */
    const n = ++sequence;
    this._ids = {
      falloff: `glas-weave-falloff-${n}`,
      mask: `glas-weave-mask-${n}`,
      thread: (i) => `glas-weave-thread-${n}-${i}`,
    };

    const svg = el("svg", {
      class: "glas-weave",
      "aria-hidden": "true",
      focusable: "false",
      preserveAspectRatio: "none",
    });

    const defs = el("defs");
    /* One radial stop set, used as an ELLIPTICAL falloff: in the default
       objectBoundingBox units it takes the shape of whatever it fills, so the
       same gradient gives the x-spread and the y-feather at once. Opaque out to
       0.55 and gone by 1.0, which is the shape the shader's
       `smoothstep(reach, reach * 0.55)` had. Both ends feather because the
       element's edge is four straight lines, and a thread cut by one reads as a
       clipped texture rather than as something coming loose. */
    const falloff = el("radialGradient", { id: this._ids.falloff });
    falloff.append(
      el("stop", { offset: "0", "stop-color": "#fff" }),
      el("stop", { offset: "0.55", "stop-color": "#fff" }),
      el("stop", { offset: "1", "stop-color": "#000" }),
    );
    /* userSpaceOnUse so the mask region is exactly the viewBox: the threads run
       a wavelength past both ends of it so the drift never exposes an end, and
       that overhang must not draw. */
    this.maskNode = el("mask", { id: this._ids.mask, maskUnits: "userSpaceOnUse", x: 0, y: 0 });
    this.reachEllipse = el("ellipse", { fill: `url(#${this._ids.falloff})` });
    this.maskNode.append(this.reachEllipse);
    defs.append(falloff, this.maskNode);

    const body = el("g", { class: "glas-weave-body", mask: `url(#${this._ids.mask})` });

    this.threads = [];
    for (let i = 0; i < THREADS; i++) {
      const path = el("path", { id: this._ids.thread(i) });
      defs.append(path);
      const href = `#${this._ids.thread(i)}`;
      const group = el("g", { class: "glas-weave-thread" });
      /* Layer order is the picture: the light a thread throws, the torn fibres
         behind it, the hairline itself, then the energy running along it. The
         halo is a wide dim STROKE rather than a blur filter, because a filtered
         group re-rasterises on every frame of the drift and this layer runs for
         hours. */
      const halo = el("use", { class: "glas-weave-halo", href });
      const fibreUp = el("use", { class: "glas-weave-fibre", href });
      const fibreDown = el("use", { class: "glas-weave-fibre", href });
      const line = el("use", { class: "glas-weave-line", href });
      const flow = el("use", { class: "glas-weave-flow", href, "stroke-dasharray": flowDash().join(" ") });
      group.append(halo, fibreUp, fibreDown, line, flow);
      body.append(group);
      this.threads.push({ path, group, halo, fibreUp, fibreDown, line, flow });
    }

    svg.append(defs, body);
    this.svg = svg;
    this._paint();
  }

  /**
   * Put the weave inside this container, and watch it for resizing.
   *
   * The time-tracker HUD rebuilds its own DOM on every clock tick, which wipes
   * whatever is inside the chip. The element is held in JS, so re-appending it
   * keeps its geometry and its running tweens; only the parent changes.
   */
  attach(container) {
    if (!container || !this.svg) return;
    if (this.svg.parentElement !== container) {
      container.appendChild(this.svg);
      this._observer?.disconnect();
      if (typeof ResizeObserver === "function") {
        // The chip's width is the level's own NAME, so it changes when the
        // level does — and the HUD is draggable, collapsible and re-laid-out.
        this._observer = new ResizeObserver(() => this.measure());
        this._observer.observe(container);
      }
    }
    this.measure();
  }

  /**
   * Re-read the container's box.
   *
   * `_box` doubles as "is there anywhere to draw". A chip inside a collapsed
   * HUD measures zero; keeping the last good box means reopening it shows the
   * weave it had rather than an empty strip.
   */
  measure() {
    const parent = this.svg?.parentElement;
    if (!parent || parent.offsetWidth <= 0 || parent.offsetHeight <= 0) return;
    const width = parent.offsetWidth + BLEED_PX * 2;
    const height = parent.offsetHeight + BLEED_PX * 2;
    if (this._box && this._box.width === width && this._box.height === height) return;
    this._box = { width, height };
    this._built = null;
    if (this._wanted) this._lay(this._wanted);
  }

  /**
   * Draw a set of parameters.
   *
   * Geometry is rebuilt only when the box or the SHAPE changes — a HUD tick, a
   * drag or a repaint all re-attach the same paths, and nothing here runs per
   * frame. Opacity and reach are tweened toward instead: what the eye reads as
   * the instability growing is the weave REACHING further around the word, and
   * that one value is cheap to animate where four paths of geometry are not.
   */
  render(params, onSettled = null) {
    this._wanted = params;
    this._lay(params);
    this._settle(params, onSettled);
  }

  _lay(params) {
    if (!this.svg || !this._box) return;
    const { width, height } = this._box;

    this.svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    this.maskNode.setAttribute("width", String(width));
    this.maskNode.setAttribute("height", String(height));
    this.reachEllipse.setAttribute("cx", String(width / 2));
    this.reachEllipse.setAttribute("cy", String(height / 2));
    this.reachEllipse.setAttribute("ry", String(height / 2));

    if (!reshapes(this._built, params)) return;
    this._built = params;

    for (let i = 0; i < THREADS; i++) {
      const thread = this.threads[i];
      thread.path.setAttribute("d", threadPath(i, { width, height, amplitude: params.amplitude, seed: this.seed }));

      const dash = dashPattern(i, params);
      const line = dash.line.join(" ");
      thread.line.setAttribute("stroke-dasharray", line);
      thread.halo.setAttribute("stroke-dasharray", line);

      /* The fibres are the torn ENDS of each hole, so they only exist once a
         hole is wide enough to have two of them. Fraying barely parts and gets
         none, which is that rung reading as "loosening" rather than as "coming
         apart" — the ladder's own vocabulary, falling out of the numbers
         instead of out of a special case. */
      for (const [node, sign] of [[thread.fibreUp, -1], [thread.fibreDown, 1]]) {
        if (dash.fibre) {
          node.setAttribute("stroke-dasharray", dash.fibre.join(" "));
          node.setAttribute("y", String(sign * params.splay));
          node.removeAttribute("display");
        } else {
          node.setAttribute("display", "none");
        }
      }
    }

    this._startMotion();
  }

  /** The only place the animated state reaches the DOM. */
  _paint() {
    if (!this.svg) return;
    this.svg.style.opacity = String(this.state.opacity);
    if (this.reachEllipse && this._box) {
      this.reachEllipse.setAttribute("rx", String((this.state.reach * this._box.width) / 2));
    }
  }

  /* ── Motion ──────────────────────────────────────────────────────── */

  /**
   * Two loops per thread, and both are seamless by construction.
   *
   * The drift translates the thread by exactly one wavelength, which is why
   * every term of the wave is a harmonic of it: the path after the translation
   * is the path before it, so the loop has no seam to hide and no geometry is
   * rebuilt per frame — the drift costs one compositor transform per thread.
   * The flow runs its dash offset one period ALONG the thread, far faster and
   * against the drift, which is the travelling power term the shader carried.
   */
  _startMotion() {
    this.motion.clear();
    for (let i = 0; i < THREADS; i++) {
      this.motion.add(animate(this.threads[i].group, {
        translateX: [0, -wavelength(i)],
        duration: driftMs(i),
        ease: "linear",
        loop: true,
      }));
      this.motion.add(animate(this.threads[i].flow, {
        strokeDashoffset: [0, FLOW_PERIOD_PX],
        duration: flowMs(i),
        ease: "linear",
        loop: true,
      }));
    }
    this._drifting = true;
    this._watchBudget();
    this._applyShed();
  }

  /**
   * Follow the shared budget.
   *
   * `drift` stops the weave's MOTION and leaves the weave: what degrades under
   * load must be the animation, never the state — a player whose machine is
   * struggling should not stop being able to see that the world is unstable.
   * The shed can be taken back because the budget's own loop keeps measuring
   * while the drift is frozen, and says so here when its level moves. One
   * listener per renderer, given back in `destroy()`.
   */
  _watchBudget() {
    this._unwatch ??= Budget.onChange(() => this._applyShed());
  }

  _applyShed() {
    const allowed = this.budget?.allows("drift") ?? true;
    if (allowed === this._drifting) return;
    this._drifting = allowed;
    for (const animation of this.motion.list()) allowed ? animation.play() : animation.pause();
  }

  /**
   * Tween toward a set of parameters.
   *
   * One tween over a plain object with the writes in `_paint()`, so there is
   * exactly one place the DOM is touched and exactly one thing to cancel.
   * `cancel()` rather than `revert()`: reverting an object tween restores the
   * values it STARTED from, which would snap the weave back mid-spread.
   */
  _settle(params, onSettled = null) {
    /* The HUD rebuilds its chip on every clock tick, and every rebuild comes
       back through here with the same numbers. Starting a fresh 1.1s tween from
       a value to itself is invisible and endless, so a settled state settles
       once. */
    const settled = this._fade === null
      && Math.abs(this.state.opacity - params.opacity) < 1e-4
      && Math.abs(this.state.reach - params.reach) < 1e-4;
    if (settled) {
      onSettled?.();
      return;
    }

    this._fade?.cancel();
    this._fade = animate(this.state, {
      opacity: params.opacity,
      reach: params.reach,
      duration: FADE_MS,
      ease: "outQuad",
      onUpdate: () => this._paint(),
      onComplete: () => {
        this._fade = null;
        this._paint();
        onSettled?.();
      },
    });
  }

  destroy() {
    this._fade?.cancel();
    this._fade = null;
    this._unwatch?.();
    this._unwatch = null;
    this.motion.clear();
    this._observer?.disconnect();
    this._observer = null;
    this.svg?.remove();
    this.svg = null;
    this.maskNode = null;
    this.reachEllipse = null;
    this.threads = [];
    this._built = null;
    this._wanted = null;
    this._box = null;
    this._drifting = false;
    if (this.budget) releaseLadder();
    this.budget = null;
  }
}
