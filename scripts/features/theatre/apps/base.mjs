/**
 * Theatre GM apps — the shared ApplicationV2 base.
 *
 * Built in a memoised factory, never at module scope: this folder has to stay
 * importable under plain Node (check tools) where `foundry` does not exist.
 *
 * An app is bound to ONE scene (`sceneId`). It reads that scene's store fresh
 * on every render (`this.store`), re-renders on the store's change hook for that
 * scene, and reacts to the viewed scene changing (`canvasReady`) or the scene
 * leaving Theatre (`updateScene`). By default it closes on either — an editor
 * for scene A must not quietly start writing to scene B; the filmstrip
 * overrides that and follows the viewed scene instead.
 *
 * Hooks are registered in `_onFirstRender` and removed in `_onClose`, so a
 * closed app leaves nothing listening.
 */

import { currentStore, storeModule } from "./shared.mjs";

let _Base = null;

export function TheatreAppBase() {
  if (_Base) return _Base;
  const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

  _Base = class TheatreApp extends HandlebarsApplicationMixin(ApplicationV2) {
    /** The scene this app edits. Set on construction, or on first render from the viewed scene. */
    sceneId = null;
    _hooks = [];
    _raf = 0;

    constructor(options = {}) {
      super(options);
      this.sceneId = options.sceneId ?? currentStore()?.scene?.id ?? null;
    }

    /** The store for this app's scene — only while it is the viewed Theatre scene. */
    get store() {
      const s = currentStore();
      return s && s.scene?.id === this.sceneId ? s : null;
    }

    async _onFirstRender(context, options) {
      await super._onFirstRender(context, options);
      const mod = storeModule();
      const on = (name, fn) => this._hooks.push([name, Hooks.on(name, fn)]);
      if (mod?.HOOK_CHANGED) {
        on(mod.HOOK_CHANGED, (store, detail) => {
          if (store?.scene?.id === this.sceneId) this._onStoreChange(store, detail);
        });
      }
      on("canvasReady", () => this._onSceneSwitch(currentStore()));
      on("updateScene", (scene) => {
        if (scene?.id !== this.sceneId) return;
        const isTheatre = storeModule()?.isTheatreScene?.(scene) ?? true;
        if (!isTheatre) this._onSceneSwitch(null);
      });
      on("deleteScene", (scene) => { if (scene?.id === this.sceneId) this.close(); });
    }

    /** The frame is drawn before context resolves; restate a computed title once rendered. */
    async _onRender(context, options) {
      await super._onRender(context, options);
      const el = this.window?.title;
      if (el && el.textContent !== this.title) el.textContent = this.title;
    }

    _onClose(options) {
      super._onClose(options);
      for (const [name, id] of this._hooks) Hooks.off(name, id);
      this._hooks = [];
      if (this._raf) cancelAnimationFrame(this._raf);
      this._raf = 0;
    }

    /** This scene's shots/config/state changed. Default: re-render next frame. */
    _onStoreChange() { this._scheduleRender(); }

    /** The viewed scene changed, or this scene stopped being a Theatre scene. Default: close. */
    _onSceneSwitch(store) {
      if (!store || store.scene?.id !== this.sceneId) this.close();
    }

    /** Coalesce bursts of changes into one render per frame. */
    _scheduleRender() {
      if (this._raf) return;
      this._raf = requestAnimationFrame(() => {
        this._raf = 0;
        if (this.rendered) this.render();
      });
    }
  };

  return _Base;
}
