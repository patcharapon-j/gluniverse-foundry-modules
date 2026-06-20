/**
 * GM calendar editor: pick a preset, edit the native CalendarConfig as JSON,
 * import/export definitions, and save a custom calendar for the world.
 */

import { MODULE_ID, SETTINGS } from "../const.js";
import { PRESETS } from "../calendar/presets.js";
import { applyCalendar, getActiveCalendarConfig } from "../calendar/calendar.js";
import { GlctHud } from "./hud.js";

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

export class CalendarEditor extends HandlebarsApplicationMixin(ApplicationV2) {
  static instance = null;

  static async show() {
    if (!game.user.isGM) return;
    if (!this.instance) this.instance = new this();
    await this.instance.render(true);
    return this.instance;
  }

  static DEFAULT_OPTIONS = {
    id: "glct-calendar-editor",
    classes: ["glct", "glct-caledit"],
    tag: "form",
    window: { title: "GLCT.editor.title", icon: "fa-solid fa-pen-ruler", resizable: true },
    position: { width: 560, height: "auto" },
    actions: {
      loadPreset: CalendarEditor.prototype._onLoadPreset,
      importJson: CalendarEditor.prototype._onImport,
      exportJson: CalendarEditor.prototype._onExport,
      resetCustom: CalendarEditor.prototype._onReset,
      saveCalendar: CalendarEditor.prototype._onSave
    }
  };

  static PARTS = { main: { template: `modules/${MODULE_ID}/templates/calendar-editor.hbs` } };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const active = getActiveCalendarConfig();
    let currentId = ""; try { currentId = game.settings.get(MODULE_ID, SETTINGS.calendarId); } catch { /* ignore */ }
    return Object.assign(context, {
      presets: Object.entries(PRESETS).map(([k, v]) => ({ id: k, name: v.name, selected: k === currentId })),
      json: JSON.stringify(active, null, 2)
    });
  }

  _textarea() { return this.element.querySelector("[name=calendarJson]"); }

  _parse() {
    try { return { ok: true, value: JSON.parse(this._textarea().value) }; }
    catch (e) { ui.notifications.error(`Invalid JSON: ${e.message}`); return { ok: false }; }
  }

  _onLoadPreset() {
    const id = this.element.querySelector("[name=presetSelect]")?.value;
    const cfg = PRESETS[id];
    if (cfg) this._textarea().value = JSON.stringify(cfg, null, 2);
  }

  async _onImport() {
    const input = document.createElement("input");
    input.type = "file"; input.accept = "application/json,.json";
    input.addEventListener("change", async () => {
      const file = input.files?.[0]; if (!file) return;
      try {
        const text = await file.text();
        JSON.parse(text); // validate
        this._textarea().value = text;
        ui.notifications.info("Calendar JSON loaded into the editor. Review, then Save.");
      } catch (e) { ui.notifications.error(`Invalid calendar file: ${e.message}`); }
    });
    input.click();
  }

  _onExport() {
    const parsed = this._parse(); if (!parsed.ok) return;
    const name = (parsed.value.name ?? "calendar").replace(/[^\w-]+/g, "_");
    const blob = new Blob([JSON.stringify(parsed.value, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${name}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async _onReset() {
    const ok = await DialogV2.confirm({
      window: { title: game.i18n.localize("GLCT.editor.title") },
      content: `<p>Discard the custom calendar and revert to the selected preset?</p>`
    });
    if (!ok) return;
    await game.settings.set(MODULE_ID, SETTINGS.calendarConfig, null);
    applyCalendar({ reinitialize: true });
    GlctHud.refreshState();
    this.render();
  }

  async _onSave() {
    const parsed = this._parse(); if (!parsed.ok) return;
    const cfg = parsed.value;
    if (!cfg?.days?.values?.length) {
      ui.notifications.error("Calendar must define days.values (the weekdays).");
      return;
    }
    await game.settings.set(MODULE_ID, SETTINGS.calendarConfig, cfg);
    const id = this.element.querySelector("[name=presetSelect]")?.value;
    if (id) await game.settings.set(MODULE_ID, SETTINGS.calendarId, id);
    applyCalendar({ reinitialize: true });
    GlctHud.refreshState();
    ui.notifications.info("Calendar saved.");
    this.render();
  }
}

/** Register the settings menu that opens this editor. */
export function registerCalendarMenu() {
  game.settings.registerMenu(MODULE_ID, "calendarEditor", {
    name: "GLCT.editor.title",
    label: "GLCT.editor.title",
    icon: "fa-solid fa-pen-ruler",
    type: CalendarEditor,
    restricted: true
  });
}
