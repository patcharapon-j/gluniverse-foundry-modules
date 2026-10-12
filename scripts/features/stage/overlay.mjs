/**
 * Stage — the overlay host: the one place Stage meets Foundry at runtime.
 *
 * It owns the DOM (stage-dom.mjs), a renderer (render/gl.mjs, or the lite
 * render/dom-fallback.mjs), the director (director.mjs) and the comms overlay,
 * and it feeds them: the stored state and cast when they change, the scene's
 * picture and light when the scene or its light flag changes, the scene's
 * darkness, gestures from the channel. It draws only while something moves.
 *
 * Shedding binds to the suite's one frame clock (`Budget.ladder`), and the
 * WebGL context is registered with `Surfaces`, which pauses it while nothing on
 * this client can see it and may release it when idle; `use()` comes before
 * every draw and rebuilds a released context from the prepared assets this
 * host keeps.
 */

import { SUITE_ID, warn } from "../../core/const.mjs";
import { Budget } from "../../core/budget.mjs";
import { Surfaces } from "../../core/gl-surfaces.mjs";
import { motionScale } from "../../core/theme.mjs";
import { faceLocator, frameImage } from "../../core/face-frame.mjs";
import { Director, SHED_ORDER } from "./director.mjs";
import { StageGL } from "./render/gl.mjs";
import { DomStage } from "./render/dom-fallback.mjs";
import { faceFromBox, prepareArt, prepareBackdrop } from "./render/assets.mjs";
import { roomOf } from "./light/backdrop.mjs";
import { LIGHT_FLAG, resolveRig } from "./light/rig.mjs";
import { assetReason, corsRetryUrl, isSameOrigin, loadPixelImage, markTainted } from "./asset.mjs";
import { mountStageDom } from "./stage-dom.mjs";
import { onStageSetting } from "./settings.mjs";
import { onReaction } from "./channel.mjs";
import { readBreath, readCast, readComms, readCommsLayout, readLayout, readLight, readQuality, readState, sceneBackground } from "./store.mjs";
import { TWEEN_OPTION, resolveTweenTiming } from "./timing.mjs";
import { FEATURE_ID } from "./model.mjs";

const VIDEO_RE = /\.(webm|mp4|m4v|ogv|mov)(?:[?#]|$)/i;
const now = () => performance.now();

/** Load a video's first frame, readable, for the backdrop maps. */
function loadVideoFrame(src) {
  const attempt = (url, anon) => new Promise((resolve, reject) => {
    const v = document.createElement("video");
    if (anon) v.crossOrigin = "anonymous";
    v.muted = true;
    v.playsInline = true;
    v.preload = "auto";
    const done = () => { cleanup(); resolve(v); };
    const fail = () => { cleanup(); reject(new Error("video did not load")); };
    const cleanup = () => { v.removeEventListener("seeked", done); v.removeEventListener("error", fail); };
    v.addEventListener("error", fail);
    v.addEventListener("loadeddata", () => { v.addEventListener("seeked", done, { once: true }); v.currentTime = Math.min(0.1, v.duration || 0); }, { once: true });
    v.src = url;
  });
  const anon = !isSameOrigin(src);
  return attempt(src, anon).catch((e) => {
    const retry = corsRetryUrl(src);
    if (retry) return attempt(retry, true);
    throw e;
  });
}

/**
 * A picture's size, without reading its pixels: what the lite renderer needs
 * to place a picture it draws as it is (no CORS required).
 */
function loadPlainSize(src) {
  if (VIDEO_RE.test(src)) {
    return new Promise((resolve, reject) => {
      const v = document.createElement("video");
      v.muted = true;
      v.preload = "metadata";
      v.addEventListener("loadedmetadata", () => resolve({ w: v.videoWidth, h: v.videoHeight }), { once: true });
      v.addEventListener("error", () => reject(new Error("video did not load")), { once: true });
      v.src = src;
    });
  }
  const img = new Image();
  img.decoding = "async";
  img.src = src;
  return img.decode().then(() => ({ w: img.naturalWidth, h: img.naturalHeight }));
}

/** The scene's darkness, 0..1, across v13/v14. */
function darknessOf(scene) {
  const d = canvas?.scene === scene ? canvas?.environment?.darknessLevel : undefined;
  return Number(d ?? scene?.environment?.darknessLevel ?? scene?.darkness ?? 0) || 0;
}

export class StageOverlay {
  constructor() {
    this.dom = null;
    this.gl = null;
    this.lite = null;
    this.surface = null;
    this.ladder = null;
    this.director = null;
    this.comms = null;
    this.arts = new Map();          // src → { image, shape, info } | { failed: reason }
    this.loading = new Map();       // src → Promise
    this.backdrops = new Map();     // key → { maps, image }
    this.backdropKey = null;
    this.hooks = [];
    this.offs = [];
    this._raf = 0;
    this._lastLight = null;
    this._warned = new Set();
    this._lastDark = null;
    this._syncRev = 0;
    this._breathe = readBreath();
    this._draw = Budget.measure(FEATURE_ID, (frame) => this.gl?.draw(frame));
  }

  /* ── lifecycle ───────────────────────────────────────────────────── */

  start() {
    if (this.dom) return;
    this.ladder = Budget.ladder(FEATURE_ID, SHED_ORDER, { minShed: () => (readQuality() === "lite" ? SHED_ORDER.length : 0) });
    this.director = new Director({
      scale: (ms) => ms * motionScale(this.dom?.root),
      allows: (name) => this.ladder.allows(name),
      breathe: () => this._breathe,
    });
    this.dom = mountStageDom(document.body);
    this._buildRenderer();
    this._resize();
    this._mountComms();

    this.director.setLayout(readLayout());
    this._syncCast();
    this.director.setState(readState(), now(), { immediate: true });
    this._syncScene({ immediate: true });

    const on = (hook, fn) => this.hooks.push([hook, Hooks.on(hook, fn)]);
    on("canvasReady", () => this._syncScene({ immediate: false }));
    on("updateScene", (scene, change, options) => this._onUpdateScene(scene, change, options));
    on("lightingRefresh", () => this._syncDarkness());
    // v14: the picture lives on the scene's Level.
    on("updateLevel", (level, change) => {
      if (level?.parent !== canvas?.scene || !("background" in (change ?? {}))) return;
      this._syncScene({});
    });
    this.offs.push(onStageSetting((kind) => this._onSetting(kind)));
    this.offs.push(onReaction((id, kind) => { if (this.director.react(id, kind, now())) this.wake(); }));
    this.offs.push(faceLocator.subscribe((src, entry) => this._onFace(src, entry)));
    this._onResize = () => { this._resize(); this.wake(); };
    window.addEventListener("resize", this._onResize);
    this.wake();
  }

  stop() {
    cancelAnimationFrame(this._raf);
    this._raf = 0;
    for (const [hook, id] of this.hooks) Hooks.off(hook, id);
    this.hooks = [];
    for (const off of this.offs) try { off(); } catch { /* already gone */ }
    this.offs = [];
    window.removeEventListener("resize", this._onResize);
    Budget.claimMotion(FEATURE_ID, false);
    this.surface?.dispose();
    this.surface = null;
    this.gl?.release();
    this.gl = null;
    this.lite?.destroy();
    this.lite = null;
    this.comms?.destroy();
    this.comms = null;
    this.dom?.destroy();
    this.dom = null;
    this.ladder?.dispose();
    this.ladder = null;
  }

  /* ── renderers ───────────────────────────────────────────────────── */

  _buildRenderer() {
    if (this.gl) {
      this.gl.release();
      this._freshCanvas(); // a released context stays lost on its canvas
    }
    this.gl = null;
    this.lite?.destroy();
    this.lite = null;
    this.surface?.dispose();
    this.surface = null;
    if (readQuality() !== "lite") {
      const gl = new StageGL(this.dom.canvas);
      if (gl.init()) this.gl = gl;
      else warn(`stage | WebGL2 unavailable (${gl.report}); drawing the stage without its lighting`);
    }
    if (!this.gl) {
      this._useLite();
      return;
    }
    this.dom.canvas.hidden = false;
    this._resize();
    this._upload();
    this.surface = Surfaces.register({
      id: "stage",
      element: () => this.dom?.canvas ?? null,
      pause: () => { cancelAnimationFrame(this._raf); this._raf = 0; Budget.claimMotion(FEATURE_ID, false); },
      resume: () => this.wake(),
      release: () => { this.gl?.release(); },
      restore: () => this._restoreContext(),
    });
  }

  /**
   * Draw with the lite renderer. It needs no pixels, so art and pictures the
   * lit stage could not read are tried again as plain pictures.
   */
  _useLite() {
    this.gl = null;
    this.surface?.dispose();
    this.surface = null;
    this.dom.canvas.hidden = true;
    this.lite = new DomStage(this.dom.root);
    for (const [key, b] of this.backdrops) this.lite.setBackdrop(key, b.src);
    for (const [src, a] of [...this.arts]) {
      if (!a.failed) continue;
      this.arts.delete(src);
      this._ensureArt(src);
    }
    if (this.backdropKey && !this.backdrops.has(this.backdropKey)) {
      this.backdropKey = null;
      this._syncScene({ immediate: true });
    }
  }

  /** A released or lost context stays lost on its canvas: rebuild on a new one. */
  _freshCanvas() {
    const fresh = this.dom.canvas.cloneNode();
    this.dom.canvas.replaceWith(fresh);
    this.dom.canvas = fresh;
    this.surface?.observe();
    return fresh;
  }

  _restoreContext() {
    if (!this.dom) return;
    const fresh = this._freshCanvas();
    const gl = new StageGL(fresh);
    if (!gl.init()) {
      warn(`stage | could not rebuild the WebGL context (${gl.report}); drawing the stage without its lighting`);
      this._useLite();
      return;
    }
    this.gl = gl;
    this._resize();
    this._upload();
  }

  /** Upload everything prepared so far to the current context. */
  _upload() {
    if (!this.gl?.ok) return;
    for (const [src, a] of this.arts) if (a.image) this.gl.setArt(src, a.image, a.shape);
    for (const [key, b] of this.backdrops) if (b.maps) this.gl.setBackdrop(key, b.maps, b.image);
  }

  _resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.director?.setView(w, h);
    this.gl?.setSize(w, h, Math.min(window.devicePixelRatio || 1, 2));
  }

  /* ── the loop ────────────────────────────────────────────────────── */

  /** Draw until nothing moves. Safe to call any number of times. */
  wake() {
    if (this._raf || !this.dom) return;
    this._raf = requestAnimationFrame((t) => this._frame(t));
  }

  _frame() {
    this._raf = 0;
    if (!this.dom) return;
    const t = now();
    const frame = this.director.step(t);
    // The DOM always follows the frame (it is what makes the stage visible
    // again); only the GPU work waits while nobody can see the canvas.
    this.dom.update(frame);
    let visible = true;
    if (this.gl) {
      visible = this.surface ? this.surface.use() : true;
      if (visible && this.gl?.lost) this._restoreContext();
      if (visible) this._draw(frame);
    } else this.lite?.draw(frame);
    const live = this.director.busy(t) || this.director.ambient();
    Budget.claimMotion(FEATURE_ID, live && visible && this.director.show.value(t) > 0);
    if (live && visible) this.wake();
  }

  /* ── stored state ────────────────────────────────────────────────── */

  _onSetting(kind) {
    const t = now();
    switch (kind) {
      case "cast":
        this._syncCast();
        this.director.setState(readState(), t);
        break;
      case "state":
        this.director.setState(readState(), t);
        break;
      case "layout":
        this.director.setLayout(readLayout());
        this.director.setState(readState(), t);
        break;
      case "comms":
      case "commsLayout":
        this._updateComms();
        return;
      case "quality":
        this._buildRenderer();
        break;
      case "breath":
        this._breathe = readBreath();
        break;
      default:
        return;
    }
    this.wake();
  }

  _syncCast() {
    const cast = readCast();
    this.director.setCast(cast);
    for (const m of cast) this._ensureArt(m.image);
    this._updateComms();
  }

  _ensureArt(src) {
    if (!src || this.arts.has(src) || this.loading.has(src)) return;
    const job = (async () => {
      try {
        const img = await loadPixelImage(src);
        let prepared;
        try { prepared = prepareArt(img); } catch (e) { markTainted(src); throw e; }
        const face = faceLocator.peek(src);
        if (face && face.k === "s") prepared.info.face = faceFromBox(face.b);
        else if (face === undefined) faceLocator.request(src).catch(() => {});
        this.arts.set(src, prepared);
        this.gl?.setArt(src, prepared.image, prepared.shape);
        this.director.setArt(src, prepared.info);
        // A newcomer whose art arrived after their entrance started still enters.
        this.director.setState(readState(), now());
        this.wake();
      } catch (e) {
        if (!this.gl && await this._plainArt(src)) return;
        this.arts.set(src, { failed: assetReason(src) ?? "error" });
        this._warnArt(src, e);
      } finally {
        this.loading.delete(src);
      }
    })();
    this.loading.set(src, job);
  }

  /** The lite renderer draws art it cannot read as it is: only its size is needed. */
  async _plainArt(src) {
    try {
      const { w, h } = await loadPlainSize(src);
      if (!(w > 0 && h > 0)) return false;
      const info = { aspect: w / h, width: w, height: h, padU: 0, padV: 0, shapeTexel: [0, 0], bounds: { x0: 0, y0: 0, x1: 1, y1: 1 }, head: null, face: null };
      this.arts.set(src, { plain: true, info });
      this.director.setArt(src, info);
      this.director.setState(readState(), now());
      this.wake();
      return true;
    } catch {
      return false;
    }
  }

  _onFace(src, entry) {
    const a = this.arts.get(src);
    if (!a?.info || !entry || entry.k !== "s") return;
    a.info.face = faceFromBox(entry.b);
    this.director.setArt(src, a.info);
    this.director.setState(readState(), now());
    this.wake();
  }

  _warnArt(src, e) {
    if (this._warned.has(src)) return;
    this._warned.add(src);
    warn(`stage | "${src}" could not be read for lighting (${e?.reason ?? e?.message ?? e}); the character is left off the lit stage. Serve the art from this server or a host that sends CORS headers.`);
    if (game.user?.isGM) ui.notifications?.warn(game.i18n.format("GLSTAGE.warn.art", { src }), { permanent: false });
  }

  /* ── the scene: picture and light ────────────────────────────────── */

  _sceneSrc(scene, light) {
    return light.src || sceneBackground(scene);
  }

  _onUpdateScene(scene, change, options) {
    if (scene !== canvas?.scene) return;
    const flags = change?.flags?.[SUITE_ID];
    const lightMoved = !!flags && Object.keys(flags).some((k) => k === LIGHT_FLAG || k.startsWith(`==${LIGHT_FLAG}`) || k === "stage" || k.startsWith("==stage"));
    const bgMoved = "background" in (change ?? {});
    const darkMoved = "environment" in (change ?? {}) || "darkness" in (change ?? {});
    if (!lightMoved && !bgMoved && !darkMoved) return;
    const timing = resolveTweenTiming(options?.[TWEEN_OPTION], game.time?.serverTime);
    this._syncScene({ timing });
  }

  /** Re-read the scene's picture and light; cross-fade and relight together. */
  async _syncScene({ immediate = false, timing = null } = {}) {
    const t0 = now();
    const rev = ++this._syncRev;
    const scene = canvas?.scene ?? null;
    const light = readLight(scene);
    const src = this._sceneSrc(scene, light);
    let opts = immediate ? { immediate: true } : timing ?? {};
    const key = src ?? null;
    if (!key && this.backdropKey) {
      this.backdropKey = null;
      this.director.setBackdrop(null, null, now(), opts);
      this._dropStaleBackdrops();
    } else if (key && key !== this.backdropKey) {
      this.backdropKey = key;
      const b = await this._ensureBackdrop(key);
      if (this.backdropKey !== key) return; // a later change won
      // A later sync of the same picture already applied its own light and
      // timing; this one only brings the picture (and its probe) in.
      const stale = rev !== this._syncRev;
      if (stale) { opts = {}; timing = null; }
      // The cue's timing counted from when the update arrived, not from when
      // the picture was ready: land the relight where the cue put it.
      if (timing && !immediate) opts = resolveTweenTiming({ ...timing, at: t0 }, now()) ?? opts;
      if (b) {
        this.director.setBackdrop(key, b.maps ? roomOf(b.maps) : b.room, now(), opts);
        this._dropStaleBackdrops();
      } else {
        // Unreadable: never leave the last room standing behind this scene's
        // light. The key is forgotten so a later change tries again.
        this.backdropKey = null;
        this.director.setBackdrop(null, null, now(), opts);
        this._dropStaleBackdrops();
      }
    }
    // Re-read: the light may have moved while the picture was loading.
    this._lastLight = readLight(canvas?.scene ?? null);
    this._applyRig(opts);
  }

  /** Lighting refreshes often; relight only when the darkness really moved. */
  _syncDarkness() {
    if (!this._lastLight?.darkness) return;
    const d = darknessOf(canvas?.scene ?? null);
    if (this._lastDark !== null && Math.abs(d - this._lastDark) < 0.02) return;
    this._applyRig({});
  }

  _applyRig(opts) {
    const scene = canvas?.scene ?? null;
    const light = this._lastLight ?? readLight(scene);
    const probe = this.backdrops.get(this.backdropKey)?.maps?.probe ?? null;
    const darkness = light.darkness ? darknessOf(scene) : 0;
    this._lastDark = darkness;
    const rig = resolveRig(light, probe, { darkness });
    this.director.setRig(rig, now(), opts);
    this.wake();
  }

  async _ensureBackdrop(src) {
    const have = this.backdrops.get(src);
    if (have) return have;
    try {
      const media = VIDEO_RE.test(src) ? await loadVideoFrame(src) : await loadPixelImage(src);
      const { maps, image } = prepareBackdrop(media);
      const b = { src, maps, image };
      this.backdrops.set(src, b);
      this.gl?.setBackdrop(src, maps, image);
      this.lite?.setBackdrop(src, src);
      return b;
    } catch (e) {
      markTainted(src);
      if (!this.gl) {
        try {
          const { w, h } = await loadPlainSize(src);
          if (w > 0 && h > 0) {
            const b = { src, maps: null, image: null, room: { ...roomOf(null), aspect: w / h } };
            this.backdrops.set(src, b);
            this.lite?.setBackdrop(src, src);
            return b;
          }
        } catch { /* unreadable as a picture too */ }
      }
      this._warnArt(src, e);
      return null;
    }
  }

  _dropStaleBackdrops() {
    // Keep the two a cross-fade may draw; free the rest a little later.
    setTimeout(() => {
      const keep = new Set(this.director?.backdropsInUse() ?? []);
      for (const key of [...this.backdrops.keys()]) {
        if (keep.has(key)) continue;
        this.backdrops.delete(key);
        this.gl?.dropBackdrop(key);
        this.lite?.dropBackdrop(key);
      }
    }, 4000);
  }

  /* ── comms ───────────────────────────────────────────────────────── */

  async _mountComms() {
    try {
      const { CommsOverlay, COMMS_FACE_PRESET } = await import("./comms/comms-overlay.mjs");
      if (!this.dom) return;
      this.comms = new CommsOverlay(document.body, {
        frame: (img) => frameImage(img, COMMS_FACE_PRESET),
        t: (key) => game.i18n.localize(key),
      });
      this._updateComms();
    } catch (e) {
      warn("stage | the comms overlay could not be mounted", e);
    }
  }

  _updateComms() {
    this.comms?.update({ comms: readComms(), layout: readCommsLayout(), cast: readCast() });
  }
}
