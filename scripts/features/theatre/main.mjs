/**
 * Theatre — lifecycle and cue playback. Every hook is registered here, from
 * onInit/onReady, never at import time, so a disabled feature is inert.
 *
 * The viewed scene decides everything: on canvasReady, if it carries
 * th.enabled, the shot layer (host) attaches to it, the title overlay mounts,
 * the camera locks and every shot is preloaded; otherwise all of it is torn
 * down. Switching the flag on the viewed scene does the same without a redraw.
 *
 * Playback. A cue is a write of th.state carrying { seq, at, kind, … } where
 * `at` is a SERVER time. Each client turns it into its own clock
 * (performance.now() + at − serverTime) and starts the cue at
 * max(that, the shot's image ready). Three renderers play it — the shot layer,
 * the DOM overlay and Stage's relight — and they agree only because each one is
 * handed the same timeline from timeline.mjs, scaled by the same motion scale.
 * A client that sees a cue for the first time on load, or later than
 * TIMING.lateGrace after its start, SETTLES: the end state, no animation.
 */

import { SUITE_ID, warn } from "../../core/const.mjs";
import { motionScale } from "../../core/theme.mjs";
import { DEFAULT_FRAMING, FACES, SETTINGS, TIMING } from "./constants.mjs";
import {
  hasTitle, resolveFace, resolveHold, resolveLetterbox, resolveStyle, titleOf,
} from "./model.mjs";
import { scaleTimeline, timelineFor } from "./timeline.mjs";
import { HOOK_CHANGED, isTheatreScene, TheatreStore, touchedKeys } from "./store.mjs";
import { host } from "./host.mjs";
import { TitleOverlay } from "./overlay/title-overlay.mjs";
import { clearPreloads, preloadAll, whenReady } from "./preload.mjs";
import {
  onGetSceneControlButtons, onRenderSceneControls, openEditor, registerKeybindings, toggleFilmstrip,
} from "./controls.mjs";
import { convertScene, createTheatreScene, leaveScene, promptCreate, registerSceneSetup } from "./scene-setup.mjs";

/** @type {TitleOverlay|null} */
let overlay = null;
/** The scene the layers are attached to. */
let attached = null;
/** Last cue seq this client has played (or settled) for `attached`. */
let lastSeq = null;
/** Bumped by every cue so a cue still waiting on its image can tell it was overtaken. */
let token = 0;
/** The resting letterbox on screen, which the next cue's bars ease from. */
let restingLetterbox = 0;
/** What the shot layer is showing, to redraw an on-screen shot the GM edits. */
let shownSig = null;

const now = () => performance.now();
const serverNow = () => game.time?.serverTime ?? Date.now();

const refreshControls = () => { try { ui.controls?.render({ reset: true }); } catch { /* not rendered yet */ } };
const emit = (store, detail) => Hooks.callAll(HOOK_CHANGED, store, detail);

/** The parts of a shot the shot layer draws (a change here redraws it). */
const drawSig = (shot) => (shot ? JSON.stringify([shot.id, shot.src, shot.focus, shot.drift, shot.treatment]) : null);

/* ── Timelines ──────────────────────────────────────────────────────────── */

function shotTimeline(style, shot, config, k) {
  const letterbox = resolveLetterbox(shot, config);
  return scaleTimeline(timelineFor(style, {
    hold: resolveHold(shot, config),
    letterbox,
    fromLetterbox: restingLetterbox,
    letters: (shot?.title ?? "").length,
    title: hasTitle(shot),
  }), k);
}

/** The DOM half's description of a shot. */
function overlayCue(kind, style, shot, config, extra = {}) {
  const letterbox = shot ? resolveLetterbox(shot, config) : restingLetterbox;
  return {
    kind,
    style,
    title: titleOf(shot),
    face: FACES[resolveFace(shot, config)] ?? FACES[config.face],
    cardText: style === "interlude" && kind === "shot" ? (shot?.title || shot?.subtitle || "") : undefined,
    letterbox,
    tag: config.tag && shot?.title ? shot.title : null,
    ...extra,
  };
}

/* ── Playing a cue ──────────────────────────────────────────────────────── */

/**
 * Play (or settle) the store's last cue on this client.
 * @param {TheatreStore} store
 * @param {{ settle?: boolean }} [o]
 */
async function playCue(store, { settle = false } = {}) {
  const state = store.state;
  const cue = state.cue;
  const config = store.config;
  const mine = ++token;
  if (!cue) return settleState(store);
  lastSeq = cue.seq;

  const k = motionScale();
  const late = serverNow() - cue.at > TIMING.lateGrace;
  settle = settle || late;
  // This client's clock for the cue's start, taken now, before any wait.
  const atLocal = now() + (cue.at - serverNow());

  switch (cue.kind) {
    case "shot": {
      const shot = store.shot(cue.shotId);
      if (!shot) return;
      const timeline = shotTimeline(cue.style, shot, config, k);
      if (!settle) {
        await whenReady(shot.src);
        if (mine !== token || store.scene !== attached) return; // overtaken while loading
      }
      const startAt = Math.max(atLocal, now());
      try { host.play(shot, { timeline, startAt, settle }); } catch (e) { warn("theatre | host.play failed", e); }
      overlay?.play(overlayCue("shot", cue.style, shot, config), { timeline, startAt, settle, scale: k });
      restingLetterbox = resolveLetterbox(shot, config);
      shownSig = drawSig(shot);
      return;
    }
    case "title": {
      const shot = store.shot(cue.shotId);
      if (!shot || settle) return; // a re-announce that is over has nothing to leave behind
      const timeline = shotTimeline(cue.style, shot, config, k);
      overlay?.play(overlayCue("title", cue.style, shot, config), { timeline, startAt: atLocal, settle: false, scale: k });
      return;
    }
    case "card": {
      const shot = store.currentShot;
      const timeline = scaleTimeline(timelineFor("interlude", {
        hold: resolveHold(shot, config), letterbox: restingLetterbox, fromLetterbox: restingLetterbox, title: false,
      }), k);
      overlay?.play(overlayCue("card", "interlude", shot, config, { cardText: cue.text, letterbox: restingLetterbox }),
        { timeline, startAt: atLocal, settle, scale: k });
      return;
    }
    case "black":
      overlay?.play({ kind: "black" }, { settle });
      return;
    case "clear":
      overlay?.play({ kind: "clear" }, { settle });
      return;
    default:
  }
}

/**
 * Show what the state says is on screen, instantly: a client loading into a
 * Theatre scene, or one that missed cues. The last cue is never animated here.
 */
function settleState(store) {
  ++token;
  const state = store.state;
  const config = store.config;
  lastSeq = state.cue?.seq ?? 0;
  const shot = store.currentShot;
  const k = motionScale();
  if (shot) {
    const style = resolveStyle(shot, config);
    restingLetterbox = resolveLetterbox(shot, config);
    const timeline = shotTimeline(style, shot, config, k);
    const startAt = now();
    try { host.play(shot, { timeline, startAt, settle: true }); } catch (e) { warn("theatre | host.play failed", e); }
    overlay?.play(overlayCue("shot", style, shot, config), { timeline, startAt, settle: true, scale: k });
    shownSig = drawSig(shot);
  } else {
    restingLetterbox = config.letterbox;
    overlay?.setLetterbox(restingLetterbox, { animate: false });
    shownSig = null;
  }
  const black = state.shotId === null && state.cue?.kind === "black";
  overlay?.setBlack(black || (!shot && !state.cue), { animate: false });
}

/** The GM edited the shot on screen (image, crop, look) without cutting: redraw it in place. */
function redrawOnScreen(store) {
  const shot = store.currentShot;
  const sig = drawSig(shot);
  if (!shot || sig === shownSig) return;
  shownSig = sig;
  const config = store.config;
  const timeline = shotTimeline(resolveStyle(shot, config), shot, config, motionScale());
  try { host.play(shot, { timeline, startAt: now(), settle: true }); } catch (e) { warn("theatre | host.play failed", e); }
}

/** Resting letterbox / corner tag follow a config or shot edit. */
function restLetterbox(store) {
  const lb = resolveLetterbox(store.currentShot, store.config);
  if (lb === restingLetterbox) return;
  restingLetterbox = lb;
  overlay?.setLetterbox(lb, { animate: true });
}

/* ── Framing (this client's fill / fit) ─────────────────────────────────── */

/** This client's framing: its own override, else the GM's default (framing and padding together). */
export function readFraming() {
  const get = (k, d) => { try { return game.settings.get(SUITE_ID, k); } catch { return d; } };
  const own = get(SETTINGS.framing, "default");
  if (own === "fill" || own === "fit") return { mode: own, padding: get(SETTINGS.padding, 0) };
  return { mode: get(SETTINGS.defaultFraming, DEFAULT_FRAMING), padding: get(SETTINGS.defaultPadding, 0) };
}

/** A framing setting changed: re-fit now if a Theatre scene is up. */
export function applyFraming() {
  if (attached) host.setFraming(readFraming());
}

/* ── Attach / detach ────────────────────────────────────────────────────── */

function attachScene() {
  const scene = canvas?.ready ? canvas.scene : null;
  const on = !!scene && isTheatreScene(scene);
  if (on && attached === scene) return;
  detachScene();
  if (!on) return;
  const store = TheatreStore.current;
  if (!store) return;
  attached = scene;
  try { host.attach(scene); } catch (e) { warn("theatre | host attach failed", e); }
  try { host.setFraming(readFraming()); } catch (e) { warn("theatre | framing failed", e); }
  try { host.lockCamera(true); } catch (e) { warn("theatre | camera lock failed", e); }
  overlay?.mount();
  preloadAll(store.shots.map((s) => s.src));
  settleState(store);
  emit(store, { kind: "attach" });
  refreshControls();
}

function detachScene() {
  if (!attached) return;
  attached = null;
  lastSeq = null;
  shownSig = null;
  restingLetterbox = 0;
  ++token;
  try { host.lockCamera(false); } catch { /* host gone */ }
  try { host.detach(); } catch (e) { warn("theatre | host detach failed", e); }
  overlay?.unmount();
  clearPreloads();
  emit(null, { kind: "detach" });
  refreshControls();
}

function onUpdateScene(scene, changes) {
  if (scene !== canvas?.scene) return;
  const t = touchedKeys(changes);
  if (t.enabled || (!attached && isTheatreScene(scene)) || (attached && !isTheatreScene(scene))) {
    attachScene();
    if (t.enabled) return;
  }
  if (!attached || !t.any) return;
  const store = TheatreStore.current;
  if (!store) return;

  if (t.shots) preloadAll(store.shots.map((s) => s.src));
  const cue = store.state.cue;
  const fresh = !!cue && cue.seq !== lastSeq;
  if (fresh) playCue(store).catch((e) => warn("theatre | cue failed", e));
  else {
    if (t.shots) redrawOnScreen(store);
    if (t.shots || t.config) restLetterbox(store);
  }
  emit(store, { kind: "update", shots: t.shots, config: t.config, state: t.state, cue: fresh });
}

/* ── Lifecycle ──────────────────────────────────────────────────────────── */

export function onInit() {
  registerKeybindings();
  registerSceneSetup();
  Hooks.on("getSceneControlButtons", onGetSceneControlButtons);
  Hooks.on("renderSceneControls", onRenderSceneControls);
}

export function onReady() {
  overlay = new TitleOverlay({ root: document.body });
  Hooks.on("canvasReady", () => attachScene());
  Hooks.on("canvasTearDown", () => detachScene());
  Hooks.on("updateScene", (scene, changes) => {
    try { onUpdateScene(scene, changes); } catch (e) { warn("theatre | updateScene", e); }
  });
  if (canvas?.ready) attachScene();
}

/* ── Public api ─────────────────────────────────────────────────────────── */

const withStore = (fn) => (...a) => {
  const s = TheatreStore.current;
  return s ? fn(s, ...a) : Promise.resolve(null);
};

export const api = {
  get store() { return TheatreStore.current; },
  TheatreStore,
  HOOK_CHANGED,
  isTheatreScene,
  createTheatreScene,
  promptCreate,
  convert: convertScene,
  leave: leaveScene,
  cue: withStore((s, c) => s.cue(c)),
  next: withStore((s) => s.next()),
  prev: withStore((s) => s.prev()),
  reannounce: withStore((s) => s.reannounce()),
  card: withStore((s, text) => s.card(text)),
  black: withStore((s) => s.black()),
  clear: withStore((s) => s.clear()),
  toggleFilmstrip,
  openEditor,
  get host() { return host; },
  get overlay() { return overlay; },
};
