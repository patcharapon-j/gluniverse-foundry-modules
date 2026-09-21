/**
 * Hexcrawl GM apps — the shared ApplicationV2 base.
 *
 * Built in a memoised factory, never at module scope: this folder has to stay
 * importable under plain Node (check tools) where `foundry` does not exist.
 *
 * Every app binds to the store that was current when it opened. An editor for a
 * hex on scene A must not quietly start writing to scene B because the GM
 * switched scenes with it open, so by default a store switch closes the app;
 * the palette overrides that and follows the viewed scene instead.
 */

import { currentStore, STORE_HOOK } from "./shared.mjs";

let _Base = null;

export function StoreAppBase() {
  if (_Base) return _Base;
  const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

  _Base = class HexStoreApp extends HandlebarsApplicationMixin(ApplicationV2) {
    /** The store this app edits. Set on first render. */
    store = null;
    _changeFn = null;
    _hookId = null;
    _raf = 0;

    get map() { return this.store?.map ?? null; }

    async _onFirstRender(context, options) {
      await super._onFirstRender(context, options);
      this._hookId = Hooks.on(STORE_HOOK, (s) => this._onStoreSwitch(s ?? null));
    }

    /** Bind (or rebind) to a store. Idempotent. */
    _bindStore(store) {
      if (this.store === store) return;
      if (this.store && this._changeFn) this.store.off("change", this._changeFn);
      this.store = store ?? null;
      this._changeFn ??= () => this._onStoreChange();
      this.store?.on("change", this._changeFn);
    }

    async _prepareContext(options) {
      if (!this.store) this._bindStore(currentStore());
      return super._prepareContext(options);
    }

    _onClose(options) {
      super._onClose(options);
      if (this.store && this._changeFn) this.store.off("change", this._changeFn);
      if (this._hookId != null) Hooks.off(STORE_HOOK, this._hookId);
      this._hookId = null;
      if (this._raf) cancelAnimationFrame(this._raf);
      this._raf = 0;
    }

    /** Map/brush/staged/view changed. Default: nothing (editors hold drafts). */
    _onStoreChange() {}

    /** The viewed scene changed. Default: an editor for the old scene closes. */
    _onStoreSwitch(store) {
      if (!store || store.scene !== this.store?.scene) this.close();
    }

    /** Coalesce bursts of store events (a brush stroke) into one render per frame. */
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
