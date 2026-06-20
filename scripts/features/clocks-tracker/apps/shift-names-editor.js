/**
 * GM shift-name editor: rename the four daily watches (YZE shifts) used
 * throughout the HUD. Writes to the world `shiftNames` setting; blank fields
 * fall back to the chronological defaults.
 */

import { MODULE_ID, SETTINGS, WATCHES, DEFAULT_SHIFT_NAMES } from "../const.js";
import { GlctHud } from "./hud.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class ShiftNamesEditor extends HandlebarsApplicationMixin(ApplicationV2) {
  static instance = null;

  static async show() {
    if (!game.user.isGM) return;
    if (!this.instance) this.instance = new this();
    await this.instance.render(true);
    return this.instance;
  }

  static DEFAULT_OPTIONS = {
    id: "glct-shift-names-editor",
    classes: ["glct", "glct-caledit", "glct-shiftedit"],
    tag: "form",
    window: { title: "GLCT.shiftNames.title", icon: "fa-solid fa-user-clock", resizable: false },
    position: { width: 460, height: "auto" },
    actions: {
      resetNames: ShiftNamesEditor.prototype._onReset,
      saveNames: ShiftNamesEditor.prototype._onSave
    }
  };

  static PARTS = { main: { template: `modules/${MODULE_ID}/templates/shift-names-editor.hbs` } };

  /** Currently stored names, falling back to defaults when unset/malformed. */
  _currentNames() {
    let stored = null;
    try { stored = game.settings.get(MODULE_ID, SETTINGS.shiftNames); } catch { /* ignore */ }
    if (Array.isArray(stored) && stored.length === WATCHES.length) return stored;
    return DEFAULT_SHIFT_NAMES;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const current = this._currentNames();
    const rows = WATCHES.map((w, i) => ({
      index: i,
      key: w.key,
      tint: w.tint,
      value: current[i] ?? "",
      placeholder: DEFAULT_SHIFT_NAMES[i]
    }));
    return Object.assign(context, { rows });
  }

  async _onReset() {
    await game.settings.set(MODULE_ID, SETTINGS.shiftNames, DEFAULT_SHIFT_NAMES.slice());
    GlctHud.refreshState();
    ui.notifications.info(game.i18n.localize("GLCT.shiftNames.reset"));
    this.render();
  }

  async _onSave() {
    const names = WATCHES.map((_, i) => {
      const input = this.element.querySelector(`[name=shift-${i}]`);
      const value = (input?.value ?? "").trim();
      return value || DEFAULT_SHIFT_NAMES[i];
    });
    await game.settings.set(MODULE_ID, SETTINGS.shiftNames, names);
    GlctHud.refreshState();
    ui.notifications.info(game.i18n.localize("GLCT.shiftNames.saved"));
    this.render();
  }
}

/** Register the settings menu that opens this editor. */
export function registerShiftNamesMenu() {
  game.settings.registerMenu(MODULE_ID, "shiftNamesEditor", {
    name: "GLCT.shiftNames.title",
    label: "GLCT.shiftNames.label",
    hint: "GLCT.shiftNames.hint",
    icon: "fa-solid fa-user-clock",
    type: ShiftNamesEditor,
    restricted: true
  });
}
