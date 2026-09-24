/**
 * GLUniverse Suite — the shared frame budget.
 *
 * Before this module every feature that degraded under load measured the frame
 * on its own: pf2e-aoe kept a rolling average at 0.94/0.06, arcane-surge one at
 * 0.9/0.1 inside a `FrameBudget` class, resource-bars a third at 0.9/0.1 with a
 * literal 22 ms in the host. Three clocks of one frame, three sets of hysteresis,
 * and nothing that could tell all of them "this machine is a laptop, start one
 * rung down" — so a struggling table shed in whatever order its features happened
 * to notice, and a GM had no lever at all.
 *
 * This is the one clock. It is ALWAYS imported and always works: with the
 * `perf` feature off it applies the policy every ladder shipped with (a 60 fps
 * target → shed above 22 ms, recover below 15 ms, no floor), so a world that
 * never turns Performance on gets the behaviour it had. The `perf` feature only
 * changes the POLICY — the target frame rate, a tier floor, the supersample
 * ceiling — never the mechanism, and every feature asks the same question the
 * same way whether it is on or not. A feature that asked "is perf on?" and
 * branched would be the silent seam this suite keeps documenting in CLAUDE.md.
 *
 * Dependency-free and side-effect-free at import: check tools and preview pages
 * load it under plain Node or a bare browser page. Nothing starts until a ladder
 * is created or `start()` is called, and the frame loop only starts where
 * `requestAnimationFrame` exists; a tool drives `sample()` by hand instead.
 *
 * Two different measurements, and the difference is load-bearing:
 *
 *   • INTERVAL — the time between animation frames. This is what a player
 *     feels, and it is the only thing that can say "too slow". It cannot say
 *     "there is headroom": at 60 Hz every interval is ~16.7 ms however little
 *     work the frame did, so a governor stepping UP on intervals never steps up.
 *   • WORK — main-thread time actually spent inside the canvas frame (bracketed
 *     on the PIXI ticker by the `perf` feature). This is what says "there is
 *     room to give quality back".
 *
 * Ladders react to the interval average (a reflex, frames); the `perf`
 * feature's governor reads percentiles of both (a policy, seconds).
 */

/** A gap longer than this is a stall or a hidden tab, not a slow frame. Fed to
 *  the average it would shed everything the moment a player alt-tabs back. */
export const RESUME_GAP_MS = 200;

/** Cool frames a ladder must see under the recovery threshold before it takes
 *  one step back. Recovering as fast as it sheds flickers at the boundary. */
export const COOL_FRAMES = 120;

/** Frames held for percentiles (~4 s at 60 Hz). */
export const WINDOW = 240;

/** The reflex stepper's ceiling; the longest shipped ladder has 16 entries. */
export const MAX_STEPS = 32;

/** Rolling-average weight of a new interval. */
const EMA_NEW = 0.1;

/** A policy is what the `perf` feature pushes. This is the one every feature
 *  shipped with, and the one in force whenever that feature is off. */
export const LOCAL_POLICY = Object.freeze({
  /** Tier id the policy came from, or null when no tier is in force. */
  tier: null,
  /** Frame-rate target the thresholds derive from. */
  targetFps: 60,
  /** Steps every ladder starts shed by. `Infinity` = shed everything sheddable. */
  shedFloor: 0,
  /** Index into a supersample ladder below which it may not start (0 = full). */
  supersampleFloor: 0,
  /** Whether ambient loops may run while the view is still. */
  ambient: "always",
  /** Seconds an unused suite WebGL surface may hold its context (0 = forever). */
  glRelease: 0,
  /** Whether a surface pauses while the page is hidden. */
  pauseHidden: false,
});

/**
 * Shed/recover thresholds for a frame-rate target. At 60 fps this is 22 / 15 ms,
 * the pair all three ladders shipped with, so a default policy changes nothing.
 * @param {number} targetFps
 */
export function thresholdsFor(targetFps) {
  const fps = Number.isFinite(targetFps) && targetFps > 0 ? Math.min(240, Math.max(10, targetFps)) : 60;
  const ms = 1000 / fps;
  return { budgetMs: ms, shedAt: ms * 1.32, unshedAt: ms * 0.9 };
}

/** Fixed-size ring of frame times with cheap percentile reads. */
export class FrameWindow {
  constructor(size = WINDOW) {
    this.buf = new Float64Array(size);
    this.size = size;
    this.count = 0;
    this.head = 0;
  }

  push(v) {
    this.buf[this.head] = v;
    this.head = (this.head + 1) % this.size;
    if (this.count < this.size) this.count++;
  }

  clear() {
    this.count = 0;
    this.head = 0;
  }

  /** The newest `n` samples (all when omitted), oldest first. */
  values(n = this.count) {
    const k = Math.min(n, this.count);
    const out = new Array(k);
    for (let i = 0; i < k; i++) out[i] = this.buf[(this.head - k + i + this.size) % this.size];
    return out;
  }

  /**
   * Percentiles over the newest `n` samples.
   * @param {number[]} qs  e.g. [0.5, 0.95, 0.99]
   * @param {number} [n]
   * @returns {number[]} one value per q (0 when empty)
   */
  percentiles(qs, n = this.count) {
    const v = this.values(n).sort((a, b) => a - b);
    if (!v.length) return qs.map(() => 0);
    return qs.map((q) => v[Math.min(v.length - 1, Math.max(0, Math.ceil(q * v.length) - 1))]);
  }
}

/* ══════════════════════════════════════════════════════════════════════
   State
   ══════════════════════════════════════════════════════════════════════ */

let _policy = LOCAL_POLICY;
let _thresholds = thresholdsFor(LOCAL_POLICY.targetFps);
let _avg = 16;
let _last = 0;
let _steps = 0;
let _cool = 0;
let _frames = 0;
let _running = false;
let _raf = 0;
let _ambientOn = true;
const _intervals = new FrameWindow();
const _work = new FrameWindow();
/** label → accumulated ms since the last `drainSpent()` */
const _spent = new Map();
let _profiling = false;
/** @type {Set<(reason: string) => void>} */
const _listeners = new Set();
/** @type {Set<Ladder>} */
const _ladders = new Set();
/** Ids currently claiming continuous canvas motion. */
const _motion = new Set();

function emit(reason) {
  for (const fn of _listeners) {
    try { fn(reason); } catch (e) { console.error("GLUniverse Suite | budget listener failed", e); }
  }
}

/* ══════════════════════════════════════════════════════════════════════
   Ladders
   ══════════════════════════════════════════════════════════════════════ */

/**
 * One feature's shed order, bound to the shared clock.
 *
 * The level is the MAX of three things, never their sum:
 *   • the feature's own minimum (a quality setting it already had),
 *   • the policy's floor (a tier: "this machine starts one rung down"),
 *   • the reflex (the shared stepper: "this frame is over budget right now").
 * A max rather than a sum is deliberate: a feature at its own "low" setting on a
 * Performance tier is one statement of "be cheap", not two.
 */
export class Ladder {
  /**
   * @param {string} id  Label for the overlay; also the profiling label.
   * @param {readonly string[]} order  Behaviours, cheapest to lose first.
   * @param {{ minShed?: () => number }} [opts]
   */
  constructor(id, order, { minShed = null } = {}) {
    this.id = id;
    this.order = order;
    this.minShed = typeof minShed === "function" ? minShed : () => 0;
  }

  get length() {
    return this.order.length;
  }

  /** How many entries of `order` are currently shed. */
  get level() {
    const len = this.order.length;
    let own = 0;
    try { own = Number(this.minShed()) || 0; } catch { own = 0; }
    const floor = _policy.shedFloor === Infinity ? len : Number(_policy.shedFloor) || 0;
    return Math.max(0, Math.min(len, Math.max(own, floor, _steps)));
  }

  /** True while `name` may still run. Names the ladder does not list always run. */
  allows(name) {
    const i = this.order.indexOf(name);
    return i < 0 || i >= this.level;
  }

  dispose() {
    _ladders.delete(this);
  }
}

/* ══════════════════════════════════════════════════════════════════════
   The frame loop
   ══════════════════════════════════════════════════════════════════════ */

function loop(now) {
  if (!_running) return;
  if (_last) sample(now - _last);
  _last = now;
  _raf = globalThis.requestAnimationFrame(loop);
}

/**
 * Feed one frame interval. The browser loop calls this; tools call it by hand.
 * @param {number} dt  ms since the previous frame
 */
export function sample(dt) {
  if (!Number.isFinite(dt) || dt <= 0) return;
  if (dt > RESUME_GAP_MS) return;
  _frames++;
  _intervals.push(dt);
  _avg = _avg * (1 - EMA_NEW) + dt * EMA_NEW;
  const before = _steps;
  if (_avg > _thresholds.shedAt) {
    if (_steps < MAX_STEPS) _steps++;
    _cool = 0;
  } else if (_avg < _thresholds.unshedAt && _steps > 0) {
    if (++_cool > COOL_FRAMES) { _steps--; _cool = 0; }
  } else {
    _cool = 0;
  }
  if (_steps !== before) emit("reflex");
}

/**
 * Feed one frame's main-thread work, in ms. Only the `perf` feature brackets
 * the canvas ticker; with it off nothing reads this window.
 */
export function sampleWork(ms) {
  if (Number.isFinite(ms) && ms >= 0) _work.push(ms);
}

/* ══════════════════════════════════════════════════════════════════════
   Public surface
   ══════════════════════════════════════════════════════════════════════ */

export const Budget = {
  sample,
  sampleWork,

  /** Start the shared frame loop (idempotent; a no-op without rAF). */
  start() {
    if (_running || typeof globalThis.requestAnimationFrame !== "function") return;
    _running = true;
    _last = 0;
    _raf = globalThis.requestAnimationFrame(loop);
  },

  stop() {
    _running = false;
    if (_raf && typeof globalThis.cancelAnimationFrame === "function") globalThis.cancelAnimationFrame(_raf);
    _raf = 0;
    _last = 0;
  },

  get running() {
    return _running;
  },

  /**
   * Bind a shed order to the shared clock. Starts the loop on first use.
   * @param {string} id
   * @param {readonly string[]} order
   * @param {{ minShed?: () => number }} [opts]
   */
  ladder(id, order, opts) {
    const ladder = new Ladder(id, order, opts);
    _ladders.add(ladder);
    this.start();
    return ladder;
  },

  /** Every live ladder, for the overlay. */
  ladders() {
    return [..._ladders];
  },

  /** The policy in force (LOCAL_POLICY unless the `perf` feature set one). */
  get policy() {
    return _policy;
  },

  /**
   * Replace the policy. `null` restores LOCAL_POLICY, which is exactly what a
   * world without the `perf` feature runs. Resets the reflex so a new target is
   * not judged against an average built under the old one.
   */
  setPolicy(policy) {
    const next = policy ? Object.freeze({ ...LOCAL_POLICY, ...policy }) : LOCAL_POLICY;
    const changedTarget = next.targetFps !== _policy.targetFps;
    _policy = next;
    _thresholds = thresholdsFor(next.targetFps);
    if (changedTarget) { _steps = 0; _cool = 0; }
    emit("policy");
  },

  get thresholds() {
    return _thresholds;
  },

  /** Rolling average interval, ms. */
  get frameMs() {
    return _avg;
  },

  /** Reflex steps currently in force. */
  get steps() {
    return _steps;
  },

  /** Frames sampled since load. */
  get frames() {
    return _frames;
  },

  /** Interval percentiles over the newest `n` frames. */
  intervals(qs = [0.5, 0.95, 0.99], n) {
    return _intervals.percentiles(qs, n);
  },

  /** Work percentiles over the newest `n` canvas frames. */
  work(qs = [0.5, 0.95, 0.99], n) {
    return _work.percentiles(qs, n);
  },

  get workSamples() {
    return _work.count;
  },

  /**
   * Forget the recent past. Called after a scene change: a load is not a slow
   * machine, and a governor that judged the next few seconds by it would step a
   * capable machine down on every scene switch.
   */
  settle() {
    _intervals.clear();
    _work.clear();
    _avg = _thresholds.budgetMs;
    _steps = 0;
    _cool = 0;
    emit("settle");
  },

  /* ── Ambient stillness ────────────────────────────────────────────────
     "Ambient" is motion that says nothing new — a shimmer, a drifting sheen,
     an idle loop. It pauses while the view moves (a pan is when a frame is
     most expensive and nobody is looking at the shimmer) and, where the
     policy says so, while the client is hidden. The `perf` feature decides;
     features that run their own JS loops listen here. */

  /** False while ambient motion should hold still. */
  get ambientAllowed() {
    return _ambientOn;
  },

  /** Set by the `perf` feature only. */
  setAmbient(allowed) {
    const v = !!allowed;
    if (v === _ambientOn) return;
    _ambientOn = v;
    emit("ambient");
  },

  /* ── Continuous motion ──────────────────────────────────────────────
     A feature that animates ON THE CANVAS without anything moving — an idle
     liquid flowing, an area's turbulence — claims motion while it does. The
     `perf` feature's idle-rate drop reads this: at Balanced, whose promise is
     "no visible change", a canvas with anything still animating on it is not
     idle, because a lower rate would be visible on exactly that thing. */

  /** @param {string} id  @param {boolean} on */
  claimMotion(id, on) {
    if (on) _motion.add(id);
    else _motion.delete(id);
  },

  get motionClaimed() {
    return _motion.size > 0;
  },

  /* ── Change notification ─────────────────────────────────────────── */

  /**
   * @param {(reason: "reflex"|"policy"|"ambient"|"settle") => void} fn
   * @returns {() => void} unsubscribe
   */
  onChange(fn) {
    if (typeof fn !== "function") return () => {};
    _listeners.add(fn);
    return () => _listeners.delete(fn);
  },

  /* ── Attribution ───────────────────────────────────────────────────
     Features route their per-frame callbacks through `measure` so the overlay
     can say which subsystem ate the frame. With profiling off the wrapper is
     one boolean read and a direct call. */

  get profiling() {
    return _profiling;
  },

  setProfiling(on) {
    _profiling = !!on;
    if (!_profiling) _spent.clear();
  },

  /**
   * Wrap a per-frame callback so its time is attributed to `label`.
   * Returns a stable function — keep it, since tickers remove by identity.
   * @template {Function} F
   * @param {string} label
   * @param {F} fn
   * @returns {F}
   */
  measure(label, fn) {
    return /** @type {any} */ (function measured(...args) {
      if (!_profiling) return fn.apply(this, args);
      const t0 = performance.now();
      try {
        return fn.apply(this, args);
      } finally {
        _spent.set(label, (_spent.get(label) ?? 0) + performance.now() - t0);
      }
    });
  },

  /** Add time to a label directly (for spans that are not one callback). */
  spend(label, ms) {
    if (!_profiling || !Number.isFinite(ms)) return;
    _spent.set(label, (_spent.get(label) ?? 0) + ms);
  },

  /** Take the accumulated attribution and reset it. */
  drainSpent() {
    const out = Object.fromEntries(_spent);
    _spent.clear();
    return out;
  },

  /** Test seam: restore everything to its load-time state. */
  _reset() {
    this.stop();
    _policy = LOCAL_POLICY;
    _thresholds = thresholdsFor(LOCAL_POLICY.targetFps);
    _avg = 16;
    _steps = 0;
    _cool = 0;
    _frames = 0;
    _ambientOn = true;
    _intervals.clear();
    _work.clear();
    _spent.clear();
    _profiling = false;
    _ladders.clear();
    _listeners.clear();
    _motion.clear();
  },
};

/**
 * The supersample rung a ladder may start at, given its length. A policy floor
 * of 0 leaves full quality; anything past the end clamps to the cheapest rung.
 * @param {number} ladderLength
 */
export function supersampleFloor(ladderLength) {
  const f = Number(_policy.supersampleFloor) || 0;
  return Math.max(0, Math.min(ladderLength - 1, f));
}
