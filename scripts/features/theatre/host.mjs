/**
 * Theatre — mounts the shot layer on Foundry's canvas and feeds it.
 *
 * The renderer (render/shot-renderer.mjs) is pure: PIXI is injected and it never
 * reads the world. Everything world-shaped — which scene, the frame rect, the
 * device resolution, the motion scale, the shared frame budget, the camera — is
 * decided HERE and pushed in.
 *
 * Layering is hexcrawl's: a container in `canvas.primary` (where tile and token
 * ART lives) on the TILES sort layer minus one — above the scene background,
 * beneath tiles, drawings and tokens — at the background's elevation, so a v14
 * Level whose base is not 0 still puts the shots on its floor. The layer is
 * opaque over the scene rect, so a converted scene's own background (which
 * Theatre never touches) is simply covered.
 *
 * The backdrop (the blurred picture around a fitted frame) cannot live there:
 * Foundry masks canvas.primary to the scene rect, which is exactly where the
 * backdrop is not. It goes on canvas.stage beneath `canvas.root` instead —
 * world-space, under every group, unmasked — and is fed the live view each
 * frame, so it also covers a GM who zooms out past the frame. Its blur is baked
 * once per picture with Foundry's own renderer (render/backdrop-blur.mjs), at
 * the GM's strength (th.backdropBlur).
 *
 * Canvas mode never attaches the host: the picture is the scene background there.
 *
 * Shedding: SHED_ORDER (the camera shake first) is bound to the suite's one
 * frame clock with Budget.ladder(); the renderer is told the level each frame.
 * The shake is ambient motion, so it also holds still while Budget says ambient
 * motion should. While the layer moves on its own (a shake, a transition, a
 * playing video) it claims continuous motion, so the perf feature's idle-rate
 * drop never stutters it.
 *
 * Nothing runs at import.
 */

import { warn } from "../../core/const.mjs";
import { Budget } from "../../core/budget.mjs";
import { warmAtIdle, warmPixi } from "../../core/warmup.mjs";
import { motionScale } from "../../core/theme.mjs";
import { FEATURE_ID } from "./constants.mjs";
import { BACKDROP, ShotRenderer, SHED_ORDER } from "./render/shot-renderer.mjs";
import { camera } from "./camera.mjs";

export { SHED_ORDER };

const loadTexture = (src) => (foundry?.canvas?.loadTexture ?? globalThis.loadTexture)(src);

class Host {
  constructor() {
    this.scene = null;
    this.renderer = null;
    this.layer = null;
    this.ladder = null;
    this._tick = null;
    this._claimed = false;
    this._lockWanted = true;
    this._freePan = false;
    this._pendingPlay = null;
    this._pendingPreload = new Set();
    this._shakeDefault = 0;
    this._backdropBlur = BACKDROP.blur;
  }

  get attached() { return !!this.renderer; }

  /**
   * Mount for a Theatre scene that is on the canvas now. Idempotent; returns
   * whether the layer is mounted.
   * @param {Scene} scene
   */
  attach(scene) {
    if (!scene || !canvas?.ready || canvas.scene !== scene) return false;
    if (this.scene === scene && this.renderer && !this.layer?.destroyed) { this._applyCamera(); return true; }
    this.detach({ keepPending: true });

    const layer = this._ensureLayer();
    if (!layer) return false;
    const rect = canvas.dimensions.sceneRect;
    try {
      this.renderer = new ShotRenderer(PIXI, {
        width: rect.width,
        height: rect.height,
        loadTexture,
        warn: (...a) => warn("theatre |", ...a),
        resolution: canvas.app.renderer.resolution,
        renderer: canvas.app.renderer,
      });
    } catch (e) {
      warn("theatre | the shot layer failed to build", e);
      this.renderer = null;
      return false;
    }
    this.scene = scene;
    this.renderer.container.position.set(rect.x, rect.y);
    this.renderer.backdrop.position.set(rect.x, rect.y);
    this.renderer.setMotionScale(motionScale());
    this.renderer.setShakeDefault(this._shakeDefault);
    this.renderer.setBackdropBlur(this._backdropBlur);
    layer.addChild(this.renderer.container);
    canvas.stage.addChildAt(this.renderer.backdrop, 0);

    // The ladder starts the budget's frame loop — never at import.
    this.ladder = Budget.ladder(FEATURE_ID, SHED_ORDER);
    this._tick = Budget.measure(FEATURE_ID, () => this.tick());
    canvas.app.ticker.add(this._tick);

    if (this._pendingPreload.size) this.renderer.preload([...this._pendingPreload]);
    this._pendingPreload.clear();
    if (this._pendingPlay) {
      const { shot, opts } = this._pendingPlay;
      this._pendingPlay = null;
      this.renderer.show(shot, opts);
    }
    this._applyCamera();
    // The backdrop and its blur first compile mid-cue; compile them at idle instead.
    const r = this.renderer;
    warmAtIdle(FEATURE_ID, () => {
      if (r === this.renderer) warmPixi(r.warmMeshes(canvas.app.renderer.gl), canvas.app.renderer);
    });
    return true;
  }

  _ensureLayer() {
    const primary = canvas?.primary;
    if (!primary) return null;
    if (this.layer && !this.layer.destroyed && this.layer.parent === primary) return this.layer;
    const layer = new PIXI.Container();
    layer.eventMode = "none";
    layer.interactiveChildren = false;
    const PCG = foundry.canvas?.groups?.PrimaryCanvasGroup ?? globalThis.PrimaryCanvasGroup;
    const tiles = PCG?.SORT_LAYERS?.TILES ?? 500;
    layer.elevation = primary.background?.elevation ?? 0;
    layer.sortLayer = tiles - 1;   // above the scene background, beneath tiles/drawings/tokens
    layer.sort = 0;
    layer.zIndex = tiles - 1;
    primary.addChild(layer);
    primary.sortDirty = true;
    this.layer = layer;
    return layer;
  }

  /** One frame. */
  tick() {
    const r = this.renderer;
    if (!r) return;
    try {
      r.setShed(this.ladder?.level ?? 0);
      r.setShakeEnabled(Budget.ambientAllowed);
      r.setResolution(canvas.app.renderer.resolution);
      r.setRenderer(canvas.app.renderer);
      const view = this._view();
      if (view) r.setView(view);
      r.update();
      const moving = r.animating;
      if (moving !== this._claimed) { Budget.claimMotion(FEATURE_ID, moving); this._claimed = moving; }
    } catch (e) {
      warn("theatre | render tick failed", e);
      this._stopTick();
    }
  }

  /**
   * Begin a cue's image half. Before attach the newest call is kept and played
   * on attach.
   * @param {object|null} shot  normalized Shot (null = black)
   * @param {{ timeline?: object, startAt?: number, settle?: boolean }} opts
   */
  play(shot, opts = {}) {
    if (!this.renderer) { this._pendingPlay = { shot, opts }; return; }
    try {
      this.renderer.setMotionScale(motionScale());
      this.renderer.show(shot, opts);
    } catch (e) {
      warn("theatre | could not play a shot", e);
    }
  }

  /** The GM's default camera shake (0..1); a shot's own wins. Kept across attaches. */
  setShakeDefault(v) {
    this._shakeDefault = Number(v) || 0;
    this.renderer?.setShakeDefault(this._shakeDefault);
  }

  /** The GM's backdrop blur strength (0..1). Kept across attaches. */
  setBackdropBlur(v) {
    const n = Number(v);
    this._backdropBlur = Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : BACKDROP.blur;
    this.renderer?.setBackdropBlur(this._backdropBlur);
  }

  /** Background-load every source (a scene's whole shot list). */
  preload(srcs) {
    const list = [...(srcs ?? [])].filter(Boolean);
    if (this.renderer) this.renderer.preload(list);
    else for (const s of list) this._pendingPreload.add(s);
  }

  /**
   * One source, cached. Resolves to a texture or null, never rejects — a cue
   * starts at max(at, ready), so await this before computing the start.
   */
  load(src) {
    return this.renderer ? this.renderer.load(src) : Promise.resolve(null);
  }

  /** What this client's screen shows, in frame px (the scene rect's own coordinates). */
  _view() {
    const st = canvas?.stage, rect = canvas?.dimensions?.sceneRect;
    const s = st?.scale?.x;
    if (!rect || !(s > 0)) return null;
    const [sw, sh] = canvas.screenDimensions ?? [innerWidth, innerHeight];
    const w = sw / s, h = sh / s;
    return { x: st.pivot.x - w / 2 - rect.x, y: st.pivot.y - h / 2 - rect.y, width: w, height: h };
  }

  /** The scene rect changed (dimensions update without a redraw). */
  refresh() {
    if (!this.renderer || !canvas?.ready) return;
    const rect = canvas.dimensions.sceneRect;
    this.renderer.container.position.set(rect.x, rect.y);
    this.renderer.backdrop.position.set(rect.x, rect.y);
    this.renderer.resize(rect.width, rect.height);
    camera.fit();
  }

  /* ── camera ──────────────────────────────────────────────────────── */

  /** Whether the Theatre framing lock is wanted at all (default on). */
  lockCamera(on) {
    this._lockWanted = !!on;
    this._applyCamera();
  }

  /** GM only: pan and zoom freely on a Theatre scene. Players are always locked. */
  setFreePan(on) {
    this._freePan = !!on && !!game.user?.isGM;
    this._applyCamera();
    return this._freePan;
  }

  get freePan() { return this._freePan; }

  /** This client's fill/fit choice and the fit's padding (client settings). */
  setFraming(framing) {
    camera.setFraming(framing);
  }

  _applyCamera() {
    const locked = this.attached && this._lockWanted && !(game.user?.isGM && this._freePan);
    camera.lock(locked);
  }

  /* ── teardown ────────────────────────────────────────────────────── */

  _stopTick() {
    if (this._tick) { try { canvas?.app?.ticker?.remove(this._tick); } catch { /* torn down */ } }
    this._tick = null;
  }

  /** Unmount. Safe to call any number of times, including after the canvas tore down. */
  detach({ keepPending = false } = {}) {
    camera.lock(false);
    this._stopTick();
    if (this._claimed) Budget.claimMotion(FEATURE_ID, false);
    this._claimed = false;
    this.ladder?.dispose();
    this.ladder = null;
    try { this.renderer?.destroy(); } catch { /* the parent may already be gone */ }
    this.renderer = null;
    try { if (this.layer && !this.layer.destroyed) this.layer.destroy({ children: true }); } catch { /* torn down with its group */ }
    this.layer = null;
    this.scene = null;
    if (!keepPending) { this._pendingPlay = null; this._pendingPreload.clear(); }
  }
}

export const host = new Host();
