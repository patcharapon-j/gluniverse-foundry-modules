/** GM editor for events & holidays (single day, day range, or whole month). */

import { MODULE_ID, SETTINGS } from "../const.js";
import { GlctHud } from "./hud.js";

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

export class EventsEditor extends HandlebarsApplicationMixin(ApplicationV2) {
  static instance = null;

  static async show() {
    if (!game.user.isGM) return;
    if (!this.instance) this.instance = new this();
    await this.instance.render(true);
    return this.instance;
  }

  static DEFAULT_OPTIONS = {
    id: "glct-events",
    classes: ["glct", "glct-events"],
    tag: "div",
    window: { title: "GLCT.events.title", icon: "fa-solid fa-star", resizable: true },
    position: { width: 520, height: "auto" },
    actions: {
      addEvent: EventsEditor.prototype._onAdd,
      editEvent: EventsEditor.prototype._onEdit,
      deleteEvent: EventsEditor.prototype._onDelete,
      toggleVis: EventsEditor.prototype._onToggleVis,
      togglePin: EventsEditor.prototype._onTogglePin
    }
  };

  static PARTS = { main: { template: `modules/${MODULE_ID}/templates/events-editor.hbs` } };

  static getEvents() {
    return foundry.utils.deepClone(game.settings.get(MODULE_ID, SETTINGS.events) ?? []);
  }
  static async setEvents(events) {
    await game.settings.set(MODULE_ID, SETTINGS.events, events);
    GlctHud.refreshState();
  }

  _months() { return game.time.calendar?.months?.values ?? []; }

  _describe(e) {
    const months = this._months();
    const mn = i => months[i]?.name ?? `M${(i ?? 0) + 1}`;
    switch (e.scope) {
      case "month": return `All of ${mn(e.month)}`;
      case "range": return `${mn(e.month)} ${e.day} – ${mn(e.endMonth)} ${e.endDay}`;
      default: return `${mn(e.month)} ${e.day}`;
    }
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const events = EventsEditor.getEvents().map(e => ({ ...e, when: this._describe(e) }));
    return Object.assign(context, { events });
  }

  /** Build the create/edit dialog form HTML. */
  static formContent(e = {}) {
    const months = game.time.calendar?.months?.values ?? [];
    const esc = (s) => foundry.utils.escapeHTML?.(s ?? "") ?? (s ?? "");
    const opts = (sel) => months.map((m, i) => `<option value="${i}" ${i === sel ? "selected" : ""}>${m.name}</option>`).join("");
    return `
      <div class="glct-evform" style="display:grid;grid-template-columns:auto 1fr;gap:8px 10px;align-items:center;">
        <label>${game.i18n.localize("GLCT.events.name")}</label>
        <input type="text" name="name" value="${esc(e.name)}">
        <label>${game.i18n.localize("GLCT.events.scopeLabel")}</label>
        <select name="scope">
          <option value="day"   ${e.scope === "day"   || !e.scope ? "selected" : ""}>${game.i18n.localize("GLCT.events.scope.day")}</option>
          <option value="range" ${e.scope === "range" ? "selected" : ""}>${game.i18n.localize("GLCT.events.scope.range")}</option>
          <option value="month" ${e.scope === "month" ? "selected" : ""}>${game.i18n.localize("GLCT.events.scope.month")}</option>
        </select>
        <label>${game.i18n.localize("GLCT.events.startMonth")}</label>  <select name="month">${opts(e.month ?? 0)}</select>
        <label>${game.i18n.localize("GLCT.events.startDay")}</label>    <input type="number" name="day" min="1" value="${e.day ?? 1}">
        <label>${game.i18n.localize("GLCT.events.endMonth")}</label>    <select name="endMonth">${opts(e.endMonth ?? e.month ?? 0)}</select>
        <label>${game.i18n.localize("GLCT.events.endDay")}</label>      <input type="number" name="endDay" min="1" value="${e.endDay ?? e.day ?? 1}">
        <label>${game.i18n.localize("GLCT.events.visibleToPlayers")}</label>
        <input type="checkbox" name="visibleToPlayers" ${e.visibleToPlayers ? "checked" : ""}>
        <label>${game.i18n.localize("GLCT.events.pinned")}</label>
        <input type="checkbox" name="pinned" ${e.pinned ? "checked" : ""}>
        <label class="glct-evform-wide">${game.i18n.localize("GLCT.events.notePublic")}</label>
        <textarea name="notePublic" rows="2" class="glct-evform-wide" placeholder="${game.i18n.localize("GLCT.events.notePublicHint")}">${esc(e.notePublic)}</textarea>
        <label class="glct-evform-wide">${game.i18n.localize("GLCT.events.notePrivate")}</label>
        <textarea name="notePrivate" rows="2" class="glct-evform-wide" placeholder="${game.i18n.localize("GLCT.events.notePrivateHint")}">${esc(e.notePrivate)}</textarea>
      </div>`;
  }

  /** Prompt the GM to create/edit one event; resolves to the data (or null). */
  static async promptEvent(existing) {
    try {
      const result = await DialogV2.prompt({
        classes: ["glct", "glct-events"],
        window: { title: existing ? game.i18n.localize("GLCT.events.edit") : game.i18n.localize("GLCT.events.add") },
        content: this.formContent(existing ?? {}),
        ok: {
          label: game.i18n.localize("GLCT.editor.save"),
          callback: (event, button) => {
            const f = button.form;
            return {
              name: f.name.value.trim() || "Event",
              scope: f.scope.value,
              month: Number(f.month.value),
              day: Math.max(1, Number(f.day.value)),
              endMonth: Number(f.endMonth.value),
              endDay: Math.max(1, Number(f.endDay.value)),
              visibleToPlayers: f.visibleToPlayers.checked,
              pinned: f.pinned.checked,
              notePublic: f.notePublic.value.trim(),
              notePrivate: f.notePrivate.value.trim()
            };
          }
        }
      });
      return result ?? null;
    } catch { return null; }   // dialog dismissed
  }

  /** Create a new event (optionally seeded with defaults). Returns it or null. */
  static async createEvent(defaults = {}) {
    if (!game.user.isGM) return null;
    const data = await this.promptEvent({ scope: "day", ...defaults });
    if (!data) return null;
    const events = this.getEvents();
    const created = { id: foundry.utils.randomID(), ...data };
    events.push(created);
    await this.setEvents(events);
    this.instance?.render();
    return created;
  }

  /** Edit an existing event by id. Returns the updated event or null. */
  static async editEvent(id) {
    if (!game.user.isGM) return null;
    const events = this.getEvents();
    const existing = events.find(e => e.id === id);
    if (!existing) return null;
    const data = await this.promptEvent(existing);
    if (!data) return null;
    Object.assign(existing, data);
    await this.setEvents(events);
    this.instance?.render();
    return existing;
  }

  /** Delete an event by id (with confirmation). Returns true if removed. */
  static async deleteEvent(id) {
    if (!game.user.isGM) return false;
    const confirmed = await DialogV2.confirm({
      classes: ["glct", "glct-events"],
      window: { title: game.i18n.localize("GLCT.events.title") },
      content: `<p>${game.i18n.localize("GLCT.events.confirmDelete")}</p>`
    });
    if (!confirmed) return false;
    await this.setEvents(this.getEvents().filter(e => e.id !== id));
    this.instance?.render();
    return true;
  }

  async _onAdd() {
    await EventsEditor.createEvent();
  }

  async _onEdit(ev, target) {
    const id = target.closest("[data-event-id]")?.dataset.eventId;
    await EventsEditor.editEvent(id);
  }

  async _onDelete(ev, target) {
    const id = target.closest("[data-event-id]")?.dataset.eventId;
    await EventsEditor.deleteEvent(id);
  }

  async _onToggleVis(ev, target) {
    const id = target.closest("[data-event-id]")?.dataset.eventId;
    const events = EventsEditor.getEvents();
    const e = events.find(x => x.id === id);
    if (!e) return;
    e.visibleToPlayers = !e.visibleToPlayers;
    await EventsEditor.setEvents(events);
    this.render();
  }

  async _onTogglePin(ev, target) {
    const id = target.closest("[data-event-id]")?.dataset.eventId;
    const events = EventsEditor.getEvents();
    const e = events.find(x => x.id === id);
    if (!e) return;
    e.pinned = !e.pinned;
    await EventsEditor.setEvents(events);
    this.render();
  }
}
