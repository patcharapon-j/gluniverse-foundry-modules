/**
 * Performance — glass, ambient motion and the view in motion.
 *
 * Three things a tier decides that are not about the canvas's own rendering:
 *
 *   glass    `data-gl-perf` on <html>: "full" | "light" | "none". The tokens in
 *            gl-tokens.css do the rest — every backdrop blur in the suite is
 *            written against `--gl-blur` / `--gl-glass-k`.
 *   ambient  "Ambient" is motion that says nothing new: a shimmer, a breathing
 *            rim, an idle loop. At "still" it holds while the view pans or
 *            zooms (the most expensive frames there are, and nobody is looking
 *            at the shimmer) and while the page is hidden (unless this is a
 *            capture client). At "off" it holds all the time. Only INFINITE CSS
 *            animations are touched — an entrance, a hit, anything that
 *            finishes, is an event and is never paused.
 *   zoomBlur false = Foundry's soft-shadow blur goes to 0 for the length of a
 *            zoom gesture and comes back when it settles.
 *
 * CSS animations are paused through the Web Animations API rather than a
 * stylesheet rule, because CSS cannot select "an animation that repeats
 * forever"; and only running ones are paused, and exactly those resumed, so an
 * animation some feature paused on purpose is never started by us.
 */

import { Budget } from "../../core/budget.mjs";
import { PAN_HOLD_MS } from "./constants.mjs";
import { Perf } from "./runtime.mjs";
import { Overrides } from "./overrides.mjs";

const L = (key) => game.i18n.localize(key);

/** Spinners and progress indicators say "working"; freezing one reads as a hang. */
const NEVER_PAUSE = ".fa-spin, .fa-pulse, .fa-spinner, [role='progressbar'], .loading, #loading";

/** Animations this module paused, and nothing else. */
const _held = new Set();
let _panning = false;
let _panTimer = 0;
let _sweepTimer = 0;
let _lastScale = null;
let _blurOwn = null;

function isAmbient(animation) {
  if (typeof CSSAnimation === "undefined" || !(animation instanceof CSSAnimation)) return false;
  if (animation.playState !== "running") return false;
  const timing = animation.effect?.getTiming?.();
  if (timing?.iterations !== Infinity) return false;
  const target = animation.effect?.target;
  if (!(target instanceof Element)) return false;
  return !target.closest(NEVER_PAUSE);
}

function hold() {
  if (typeof document.getAnimations !== "function") return;
  // An element removed from the page does not cancel its animation, and a held
  // reference would keep both alive for as long as the tier stays "off" — the
  // whole session, on Potato. Forget them; there is nothing to resume.
  for (const a of _held) if (!a.effect?.target?.isConnected) _held.delete(a);
  for (const a of document.getAnimations()) {
    if (!isAmbient(a)) continue;
    try { a.pause(); _held.add(a); } catch { /* removed mid-sweep */ }
  }
}

function release() {
  for (const a of _held) {
    try { if (a.playState === "paused") a.play(); } catch { /* element gone */ }
  }
  _held.clear();
}

/** Whether ambient motion should be holding right now. */
function shouldHold() {
  const values = Perf.state?.values;
  if (!values) return false;
  if (values.ambient === "off") return true;
  if (values.ambient === "always") return false;
  if (_panning) return true;
  return document.hidden && !Perf.state.capture;
}

function sync() {
  const holding = shouldHold();
  Budget.setAmbient(!holding);
  if (holding) hold();
  else if (_held.size) release();
  // At "off" new elements keep arriving (a HUD re-renders, a card is dealt);
  // a slow sweep catches them. At "still" the events are enough.
  const sweep = Perf.state?.values?.ambient === "off";
  if (sweep && !_sweepTimer) _sweepTimer = window.setInterval(hold, 2000);
  else if (!sweep && _sweepTimer) { window.clearInterval(_sweepTimer); _sweepTimer = 0; }
}

/* ── Glass ─────────────────────────────────────────────────────────── */

function applyGlass(values) {
  document.documentElement.dataset.glPerf = values?.glass ?? "full";
}

/* ── The view in motion ────────────────────────────────────────────── */

function onPan(_canvas, pos) {
  const scale = pos?.scale ?? canvas?.stage?.scale?.x ?? null;
  const zooming = _lastScale !== null && scale !== null && scale !== _lastScale;
  _lastScale = scale;
  if (!_panning) {
    _panning = true;
    sync();
  }
  if (zooming) dropBlur();
  window.clearTimeout(_panTimer);
  _panTimer = window.setTimeout(settle, PAN_HOLD_MS);
}

function settle() {
  _panning = false;
  restoreBlur();
  sync();
}

function dropBlur() {
  if (Perf.state?.values?.zoomBlur !== false) return;
  const blur = canvas?.blur;
  if (!blur?.enabled || _blurOwn !== null) return;
  _blurOwn = blur.strength;
  try {
    blur.strength = 0;
    Overrides.set("zoomBlur", L("GLPERF.value.zoomBlurOff"), L("GLPERF.value.on"));
  } catch {
    _blurOwn = null;
  }
}

function restoreBlur() {
  if (_blurOwn === null) return;
  try { if (canvas?.blur) canvas.blur.strength = _blurOwn; } catch { /* the canvas redrew */ }
  _blurOwn = null;
  Overrides.clear("zoomBlur");
}

export function startAmbient() {
  Hooks.on("canvasPan", onPan);
  Hooks.on("canvasInit", () => {
    // A redraw rebuilds canvas.blur; a held value belongs to the old one.
    _blurOwn = null;
    _lastScale = null;
    Overrides.clear("zoomBlur");
  });
  document.addEventListener("visibilitychange", sync);
  Perf.onResolve((state) => {
    applyGlass(state.values);
    sync();
  });
  if (Perf.state) {
    applyGlass(Perf.state.values);
    sync();
  }
}
