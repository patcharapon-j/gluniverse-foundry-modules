/**
 * Performance — the runtime: which tier this client runs, and telling
 * everything that cares.
 *
 * One resolution, one fan-out. Every subsystem (the canvas knobs, the glass
 * level, the vision throttle, the WebGL lifecycle) reads `Perf.values` and
 * subscribes with `Perf.onResolve`; none of them re-derives the tier from the
 * settings. Two derivations of one tier is how the overlay ends up saying
 * "Performance" while the glass is still drawn at Quality.
 */

import { SUITE_ID, warn } from "../../core/const.mjs";
import { Budget } from "../../core/budget.mjs";
import { SETTINGS, DISPLAY_CAP, patchWorldKey, patchClientKey, PATCHES } from "./constants.mjs";
import { AUTO, AUTO_RANGE, DEFAULT_TIER, floorFor, isCapture, resolveTier } from "./tiers.mjs";
import { GOVERNOR, Governor, targetFpsFor } from "./governor.mjs";

const get = (key, fallback) => {
  try {
    const v = game.settings.get(SUITE_ID, key);
    return v ?? fallback;
  } catch {
    return fallback;
  }
};

/** @type {Set<(state: object, why: string) => void>} */
const _listeners = new Set();

let _state = null;
let _governor = null;
let _govTimer = 0;
let _displayHz = 0;
let _workStart = 0;
let _bracketed = null;

export const Perf = {
  /** The resolved state: { tier, auto, values, baseline, floor, choice, targetFps, capture }. */
  get state() {
    return _state;
  },

  /** Shorthand for the tier row in force. */
  get values() {
    return _state?.values ?? null;
  },

  get displayHz() {
    return _displayHz;
  },

  get governor() {
    return _governor;
  },

  /**
   * Subscribe to (re)resolution.
   * @param {(state: object, why: string) => void} fn
   * @returns {() => void}
   */
  onResolve(fn) {
    _listeners.add(fn);
    return () => _listeners.delete(fn);
  },

  /** The GM's floor object, normalised. */
  floor() {
    const f = get(SETTINGS.floor, {});
    return f && typeof f === "object" ? f : {};
  },

  /**
   * Whether a user is a capture client (never pauses on hidden). Read live:
   * the GM changes the roster while players are connected. The stream
   * feature's own capture login is one by definition — it is the login an OBS
   * browser source runs, and `document.hidden` is true there while it records.
   */
  isCaptureClient(userId = game.user?.id) {
    if (!userId) return false;
    if (isCapture(this.floor(), userId)) return true;
    return get("stream.streamUserId", "") === userId;
  },

  /**
   * Whether a switchable intervention is on for this client: the GM's world
   * switch AND the client's own. Either side can turn it off; neither can turn
   * on what the other turned off.
   */
  patchOn(id) {
    if (!PATCHES.some((p) => p.id === id)) return false;
    return get(patchWorldKey(id), true) !== false && get(patchClientKey(id), true) !== false;
  },

  /** Re-read the settings and fan out. */
  resolve(why = "settings") {
    const choice = get(SETTINGS.tier, DEFAULT_TIER);
    const floor = floorFor(this.floor(), game.user?.id);
    const targetFps = targetFpsFor(String(get(SETTINGS.targetFps, "display")), _displayHz, DISPLAY_CAP);

    if (choice === AUTO) {
      if (!_governor) _governor = new Governor({ budgetMs: 1000 / targetFps });
      _governor.setBudget(1000 / targetFps);
      startGovernor();
    } else {
      stopGovernor();
      _governor = null;
    }

    const resolved = resolveTier({ choice, floor, autoTier: _governor?.tier ?? AUTO_RANGE[0] });
    _state = Object.freeze({
      ...resolved,
      choice,
      floor,
      targetFps,
      capture: this.isCaptureClient(),
    });

    Budget.setPolicy({
      tier: resolved.tier,
      targetFps,
      shedFloor: resolved.values.shedFloor,
      supersampleFloor: resolved.values.supersampleFloor,
      ambient: resolved.values.ambient,
    });

    for (const fn of _listeners) {
      try { fn(_state, why); } catch (e) { warn("perf | a resolve listener failed", e); }
    }
    return _state;
  },

  /** Start the measurement plumbing. Called from onReady. */
  async start() {
    _displayHz = await measureDisplayHz();
    Budget.start();
    this.resolve("start");
    Hooks.on("canvasReady", () => {
      Budget.settle();
      _governor?.settle(performance.now());
      bracketTicker();
    });
    if (canvas?.ready) bracketTicker();
  },

  /** Drop everything back to the shipped policy. */
  stop() {
    stopGovernor();
    unbracketTicker();
    Budget.setPolicy(null);
  },
};

/* ── Governor loop ─────────────────────────────────────────────────── */

function startGovernor() {
  if (_govTimer) return;
  _govTimer = window.setInterval(() => {
    if (!_governor || document.hidden) return;
    const [intervalP95] = Budget.intervals([0.95], 120);
    const [workP95] = Budget.work([0.95], 120);
    const move = _governor.step(performance.now(), { intervalP95, workP95, workSamples: Budget.workSamples });
    if (move !== 0) Perf.resolve(move > 0 ? "auto-down" : "auto-up");
  }, GOVERNOR.cadenceMs);
}

function stopGovernor() {
  if (_govTimer) window.clearInterval(_govTimer);
  _govTimer = 0;
}

/* ── Work bracket ──────────────────────────────────────────────────────
   Ticker callbacks at chosen priorities, so a span between two of them is the
   main-thread time of whatever Foundry runs in between. PIXI v7's priorities
   are INTERACTION 50, HIGH 25, NORMAL 0, LOW -25, UTILITY -50; Foundry adds
   OBJECTS 23, INTERFACE 22, PRIMARY 3 and PERCEPTION 2, and the Application
   renders at LOW. Fractional priorities sit between them without a tie.

   The outer pair is always on — the governor needs WORK, and the span from
   first to last callback is it. The inner pairs only while profiling (the
   overlay is open or a benchmark is running): they attribute that work to
   placeables, perception and the render call. None of this is GPU time, which
   nothing on the main thread can see; it is what a frame spends before it can
   hand anything over. No Foundry method is wrapped to get it. */

const PROBES = Object.freeze([
  // [label, startPriority, endPriority]
  ["placeables", 23.5, 21.5],
  ["perception", 2.5, 1.5],
  ["render", -24.5, -25.5],
]);

const _probeFns = [];
let _detail = false;

function bracketTicker() {
  const ticker = canvas?.app?.ticker;
  if (!ticker || _bracketed === ticker) return;
  unbracketTicker();
  const P = PIXI.UPDATE_PRIORITY;
  ticker.add(onWorkStart, null, P.INTERACTION + 1);
  ticker.add(onWorkEnd, null, P.UTILITY - 1);
  _bracketed = ticker;
  if (_detail) addProbes();
}

function unbracketTicker() {
  if (!_bracketed) return;
  removeProbes();
  try {
    _bracketed.remove(onWorkStart);
    _bracketed.remove(onWorkEnd);
  } catch { /* the ticker went with its canvas */ }
  _bracketed = null;
}

function addProbes() {
  if (!_bracketed || _probeFns.length) return;
  for (const [label, from, to] of PROBES) {
    let t0 = 0;
    const open = () => { t0 = performance.now(); };
    const close = () => { if (t0) Budget.spend(label, performance.now() - t0); t0 = 0; };
    _bracketed.add(open, null, from);
    _bracketed.add(close, null, to);
    _probeFns.push(open, close);
  }
}

function removeProbes() {
  for (const fn of _probeFns.splice(0)) {
    try { _bracketed?.remove(fn); } catch { /* gone with the canvas */ }
  }
}

/** Attribution detail on or off (the overlay and the benchmark turn it on). */
export function setDetailedProbes(on) {
  _detail = !!on;
  if (_detail) addProbes();
  else removeProbes();
}

function onWorkStart() {
  _workStart = performance.now();
}

function onWorkEnd() {
  if (!_workStart) return;
  const ms = performance.now() - _workStart;
  Budget.sampleWork(ms);
  Budget.spend("canvas", ms);
  _workStart = 0;
}

/**
 * The display's refresh rate, from the median of a short run of animation
 * frames. The median, not the mean: one frame lost to a GC pause at startup
 * would otherwise read a 60 Hz display as 50.
 */
function measureDisplayHz(frames = 30) {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame !== "function") return resolve(DISPLAY_CAP);
    const times = [];
    let last = 0;
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      if (times.length < 5) return resolve(DISPLAY_CAP);
      times.sort((a, b) => a - b);
      const median = times[Math.floor(times.length / 2)];
      resolve(median > 0 ? 1000 / median : DISPLAY_CAP);
    };
    // A hidden tab never runs the frames; give up rather than wait forever.
    const giveUp = window.setTimeout(done, 1500);
    const step = (now) => {
      if (last) times.push(now - last);
      last = now;
      if (times.length >= frames) {
        window.clearTimeout(giveUp);
        return done();
      }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}
