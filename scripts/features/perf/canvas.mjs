/**
 * Performance — what a tier does to Foundry's canvas.
 *
 * Every value here is an OVERRIDE of what the user's own Foundry settings
 * produce, applied at runtime and never written back. Choosing Quality, or
 * switching the feature off, leaves Foundry exactly as the user configured it
 * — including on the next load, because nothing was stored.
 *
 *   perfMode       (core patch) caps Foundry's canvas performance mode, and
 *                  sets the canvas resolution through the `canvasConfig` hook.
 *                  Neither is live: a mode change redraws the canvas and a
 *                  resolution change re-allocates every render target, which
 *                  are exactly the hitches this feature exists to remove. Both
 *                  apply at the next scene draw (`canvasInit`, before blur and
 *                  textures are initialised) or at load.
 *   visionThrottle (core patch) a moving token's sight and light are
 *                  recomputed every Nth animation frame, or once when the move
 *                  lands. Foundry sweeps every wall for every vision source on
 *                  every frame of a move otherwise.
 *   idleFps        the canvas ticker drops to a lower rate once nothing has
 *                  moved for a few seconds; any input snaps it back.
 *   textureLoad    a scene's textures load a few at a time rather than all at
 *                  once, recent scenes stay pinned in the texture cache, and
 *                  (a world opt-in) the navigation bar's scenes are preloaded.
 */

import { Budget } from "../../core/budget.mjs";
import { SUITE_ID } from "../../core/const.mjs";
import { IDLE_AFTER_MS, SETTINGS, TEXTURE_CONCURRENCY } from "./constants.mjs";
import { Perf } from "./runtime.mjs";
import { Patches } from "./patches.mjs";
import { Overrides } from "./overrides.mjs";
import { resolutionFor } from "./tiers.mjs";

const L = (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key));

const MODE_LABELS = ["SETTINGS.PerformanceModeLow", "SETTINGS.PerformanceModeMed", "SETTINGS.PerformanceModeHigh", "SETTINGS.PerformanceModeMax"];
const modeLabel = (m) => L(MODE_LABELS[m] ?? "GLPERF.value.unknown");

/* ══════════════════════════════════════════════════════════════════════
   perfMode — the performance-mode ceiling and the resolution
   ══════════════════════════════════════════════════════════════════════ */

/** The non-live half of the tier the canvas was last configured with. */
let _appliedNonLive = null;
/** The resolution Foundry chose at load, before any override. */
let _ownResolution = null;

const nonLiveKey = (v) => `${v?.perfMode ?? "own"}|${v?.resolution ?? "native"}`;

Patches.define({
  id: "perfMode",
  target: "foundry.canvas.Canvas.prototype._configurePerformanceMode",
  signature: 'const fps = game.settings.get("core", "maxFPS");',
  handler(wrapped, ...args) {
    const settings = wrapped(...args);
    const values = Perf.ensure().values;
    const own = settings.mode;
    const cap = values.perfMode;
    if (cap !== null && cap !== undefined && own > cap) {
      settings.mode = cap;
      // The mode-derived fields Foundry computed from the higher mode.
      const modes = CONST.CANVAS_PERFORMANCE_MODES;
      settings.smaa = cap >= modes.MED;
      if (cap !== modes.MAX && settings.fps === 0) settings.fps = 60;
      this.app.ticker.maxFPS = PIXI.Ticker.shared.maxFPS = PIXI.Ticker.system.maxFPS = settings.fps;
      Overrides.set("perfMode", modeLabel(cap), modeLabel(own));
    } else {
      Overrides.clear("perfMode");
    }
    _appliedNonLive = nonLiveKey(values);
    return settings;
  },
});

function onCanvasConfig(config) {
  if (!Perf.patchOn("perfMode")) return;
  const values = Perf.ensure().values;
  _ownResolution = config.resolution;
  const next = resolutionFor(values.resolution, config.resolution);
  if (next !== config.resolution) {
    config.resolution = next;
    Overrides.set("resolution", `${next}×`, `${_ownResolution}×`);
  }
}

/**
 * A tier changed mid-session: the non-live half waits for the next scene draw.
 * `canvasInit` runs before blur and textures are initialised, so re-running the
 * (wrapped) performance configuration there is the same thing Foundry's own
 * setting change does, minus its immediate `canvas.draw()`.
 */
function onCanvasInit() {
  const values = Perf.state?.values;
  if (!values) return;
  const key = Perf.patchOn("perfMode") ? nonLiveKey(values) : nonLiveKey(null);
  if (key === _appliedNonLive) return;
  try {
    canvas._configurePerformanceMode();
  } catch (e) {
    console.warn("GLUniverse Suite | perf: could not re-apply the performance mode", e);
  }
  applyResolution(Perf.patchOn("perfMode") ? values.resolution : "native");
  _appliedNonLive = key;
}

function applyResolution(mode) {
  const renderer = canvas?.app?.renderer;
  if (!renderer) return;
  const own = _ownResolution ?? renderer.resolution;
  _ownResolution = own;
  const next = resolutionFor(mode, own);
  if (next === renderer.resolution) return;
  try {
    renderer.resolution = next;
    renderer.resize(window.innerWidth, window.innerHeight);
  } catch (e) {
    console.warn("GLUniverse Suite | perf: the canvas resolution could not change live; it applies after a reload", e);
    return;
  }
  if (next !== own) Overrides.set("resolution", `${next}×`, `${own}×`);
  else Overrides.clear("resolution");
}

/* ══════════════════════════════════════════════════════════════════════
   visionThrottle — sight during token moves
   ══════════════════════════════════════════════════════════════════════ */

/** token → frames since its last real initialisation */
const _visionFrames = new WeakMap();
/** Tokens with a deferred initialisation to flush. */
const _visionPending = new Set();
let _visionFlushOn = null;

Patches.define({
  id: "visionThrottle",
  target: "foundry.canvas.placeables.Token.prototype.initializeSources",
  signature: "this.initializeLightSource({deleted});",
  handler(wrapped, options = {}, ...rest) {
    const mode = Perf.state?.values?.vision ?? "full";
    // Only ever throttle a token that is mid-animation. A deletion, a door, a
    // config change or a token standing still always goes straight through.
    if (mode === "full" || options?.deleted || !this.animationContexts?.size) {
      _visionPending.delete(this);
      _visionFrames.delete(this);
      return wrapped(options, ...rest);
    }
    const n = (_visionFrames.get(this) ?? 0) + 1;
    if (mode !== "snap" && n >= Number(mode)) {
      _visionFrames.set(this, 0);
      _visionPending.delete(this);
      return wrapped(options, ...rest);
    }
    _visionFrames.set(this, n);
    _visionPending.add(this);
    ensureVisionFlush();
    return undefined;
  },
});

/**
 * Every frame, finish any token whose move has landed. Calling the method again
 * goes back through the wrapper, which lets it through now that nothing is
 * animating — so the final position is always initialised exactly as Foundry
 * would, just without the sweeps in between.
 */
function flushVision() {
  for (const token of _visionPending) {
    if (token.destroyed) { _visionPending.delete(token); continue; }
    if (token.animationContexts?.size) continue;
    _visionPending.delete(token);
    token.initializeSources();
  }
  if (!_visionPending.size) stopVisionFlush();
}

function ensureVisionFlush() {
  const ticker = canvas?.app?.ticker;
  if (!ticker || _visionFlushOn === ticker) return;
  stopVisionFlush();
  ticker.add(flushVision, null, PIXI.UPDATE_PRIORITY.LOW + 1);
  _visionFlushOn = ticker;
}

function stopVisionFlush() {
  try { _visionFlushOn?.remove(flushVision); } catch { /* gone with its canvas */ }
  _visionFlushOn = null;
}

function describeVision(values) {
  if (!Perf.patchOn("visionThrottle") || values.vision === "full") return Overrides.clear("vision");
  const value = values.vision === "snap" ? L("GLPERF.value.visionSnap") : L("GLPERF.value.visionEvery", { n: values.vision });
  Overrides.set("vision", value, L("GLPERF.value.visionFull"));
}

/* ══════════════════════════════════════════════════════════════════════
   idleFps — a still canvas redraws less often
   ══════════════════════════════════════════════════════════════════════ */

let _lastActive = 0;
let _idle = false;
let _idleTimer = 0;
let _sceneMotion = false;

const ACTIVITY_EVENTS = ["pointermove", "pointerdown", "wheel", "keydown", "touchstart"];

function markActive() {
  _lastActive = performance.now();
  if (_idle) wake();
}

function ownFps() {
  const fps = canvas?.performance?.fps;
  return Number.isFinite(fps) ? fps : 60;
}

/**
 * Whether anything on the canvas animates without input. At Balanced — "no
 * visible change" — a lower rate would be visible on exactly those things, so
 * such a canvas is never idle. Performance and below accept the trade.
 */
function computeSceneMotion() {
  try {
    const scene = canvas?.scene;
    if (!scene) return false;
    if (scene.weather || canvas.weather?.children?.length) return true;
    const VH = foundry.helpers.media?.VideoHelper;
    const isVideo = (src) => !!src && !!VH?.hasVideoExtension?.(src);
    for (const lt of scene._configureLevelTextures?.() ?? []) if (isVideo(lt.src)) return true;
    for (const tile of scene.tiles) if (isVideo(tile.texture?.src)) return true;
    for (const token of scene.tokens) if (isVideo(token.texture?.src) || token.light?.animation?.type) return true;
    for (const light of scene.lights) if (light.config?.animation?.type) return true;
  } catch {
    return true;
  }
  return false;
}

function canIdle() {
  const values = Perf.state?.values;
  if (!values?.idleFps || !Perf.patchOn("idleFps") || !canvas?.ready) return false;
  if (Object.keys(foundry.canvas.animation.CanvasAnimation.animations ?? {}).length) return false;
  if (Perf.state.tier === "balanced" && (_sceneMotion || Budget.motionClaimed)) return false;
  return performance.now() - _lastActive >= IDLE_AFTER_MS;
}

function checkIdle() {
  if (!_idle && canIdle()) sleep();
  else if (_idle && !canIdle()) wake();
}

function sleep() {
  const ticker = canvas?.app?.ticker;
  if (!ticker) return;
  const target = Perf.state.values.idleFps;
  const own = ownFps();
  if (own && own <= target) return;
  ticker.maxFPS = target;
  _idle = true;
  Overrides.set("maxFps", L("GLPERF.value.idleFps", { fps: target }), own ? `${own}` : L("GLPERF.value.uncapped"));
}

function wake() {
  const ticker = canvas?.app?.ticker;
  if (ticker) ticker.maxFPS = ownFps();
  _idle = false;
  Overrides.clear("maxFps");
}

function startIdleWatch() {
  for (const type of ACTIVITY_EVENTS) window.addEventListener(type, markActive, { passive: true, capture: true });
  for (const hook of ["canvasPan", "refreshToken", "updateToken", "createToken", "deleteToken", "controlToken", "hoverToken", "targetToken"]) {
    Hooks.on(hook, markActive);
  }
  const rescan = () => { _sceneMotion = computeSceneMotion(); markActive(); };
  for (const hook of ["canvasReady", "updateScene", "createAmbientLight", "updateAmbientLight", "deleteAmbientLight", "createTile", "updateTile", "deleteTile", "updateToken"]) {
    Hooks.on(hook, rescan);
  }
  _lastActive = performance.now();
  _sceneMotion = computeSceneMotion();
  _idleTimer = window.setInterval(checkIdle, 250);
}

/* ══════════════════════════════════════════════════════════════════════
   textureLoad — smoother scene changes
   ══════════════════════════════════════════════════════════════════════ */

/** The last scenes' level textures, newest first; pinned while listed. */
const _pinned = [];
const PIN_SCENES = 2;

function onTextureInit() {
  if (!Perf.patchOn("textureLoad")) return Overrides.clear("textureLoad");
  const opts = canvas.loadTexturesOptions;
  if (opts && !opts.maxConcurrent) {
    opts.maxConcurrent = TEXTURE_CONCURRENCY;
    Overrides.set("textureLoad", L("GLPERF.value.concurrent", { n: TEXTURE_CONCURRENCY }), L("GLPERF.value.allAtOnce"));
  }
}

/**
 * Keep the backgrounds of the last scenes viewed pinned, so going back to the
 * previous scene (the most common "next" scene there is) does not reload them
 * after Foundry's 15-minute cache expiry evicted them mid-session.
 */
function pinSceneTextures() {
  if (!Perf.patchOn("textureLoad")) return;
  const TL = foundry.canvas.TextureLoader;
  const scene = canvas?.scene;
  if (!scene || typeof TL?.pinSource !== "function") return;
  const srcs = (scene._configureLevelTextures?.() ?? []).map((t) => t.src).filter(Boolean);
  const existing = _pinned.findIndex((p) => p.id === scene.id);
  if (existing >= 0) _pinned.splice(existing, 1);
  _pinned.unshift({ id: scene.id, srcs });
  for (const src of srcs) TL.pinSource(src);
  while (_pinned.length > PIN_SCENES) {
    const old = _pinned.pop();
    const stillUsed = new Set(_pinned.flatMap((p) => p.srcs));
    for (const src of old.srcs) if (!stillUsed.has(src)) TL.unpinSource(src);
  }
}

/**
 * GM opt-in: preload the navigation bar's scenes on every client, one at a
 * time, after the GM's own scene has finished drawing.
 */
let _preloading = false;
async function preloadNavigation() {
  if (!game.user?.isGM || _preloading) return;
  let on = false;
  try { on = !!game.settings.get(SUITE_ID, SETTINGS.preload); } catch { on = false; }
  if (!on) return;
  _preloading = true;
  try {
    const scenes = game.scenes.filter((s) => s.navigation && s.id !== canvas.scene?.id).slice(0, 6);
    for (const scene of scenes) await game.scenes.preload(scene.id, { broadcast: true });
  } finally {
    _preloading = false;
  }
}

/* ══════════════════════════════════════════════════════════════════════
   Wiring
   ══════════════════════════════════════════════════════════════════════ */

/** Register what must exist before the canvas is created (onInit). */
export function initCanvasTuning() {
  Hooks.on("canvasConfig", onCanvasConfig);
  Hooks.on("canvasInit", onCanvasInit);
  Hooks.on("canvasInit", onTextureInit);
  Hooks.on("canvasReady", () => {
    pinSceneTextures();
    preloadNavigation();
    _visionPending.clear();
    stopVisionFlush();
  });
}

/** Start the runtime half (onReady). */
export function startCanvasTuning() {
  startIdleWatch();
  Perf.onResolve((state) => {
    describeVision(state.values);
    if (_idle) wake();
    markActive();
  });
  if (Perf.state) describeVision(Perf.state.values);
}
