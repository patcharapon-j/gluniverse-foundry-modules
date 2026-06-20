/**
 * TrackerEditor — create/edit dialogs for trackers, against any store.
 *
 * Uses DialogV2 forms (like EventsEditor) with type-specific fields. Creating
 * first asks for the type, then shows that type's config form; editing jumps
 * straight to the form for the existing tracker's type. All writes go through a
 * *store* passed by the caller — the world-scope {@link TrackerStore} (the global
 * dock) or a per-actor {@link ActorTrackerStore} (a PC's private sheet tab). The
 * store decides who may write (`canWrite`) and whether world-only fields like
 * player visibility apply (`isActor`), so one editor serves both homes.
 */

import { TrackerStore } from "../trackers/trackers.js";
import { TRACKER_TYPES } from "../const.js";

const { DialogV2 } = foundry.applications.api;

const L = (k) => game.i18n.localize(k);
const esc = (s) => foundry.utils.escapeHTML?.(String(s ?? "")) ?? String(s ?? "");

export class TrackerEditor {
  /** Ask for a type, then open its config form to create a new tracker. */
  static async create(store = TrackerStore) {
    if (!store?.canWrite) return;
    const type = await this._promptType();
    if (!type) return;
    const data = await this._promptConfig(type, store.makeNew(type), store);
    if (!data) return;
    await store.create(type, data);
  }

  /** Edit an existing tracker by id within `store`. */
  static async edit(store, id) {
    if (!store?.canWrite) return;
    const t = store.get(id);
    if (!t) return;
    const data = await this._promptConfig(t.type, t, store);
    if (!data) return;
    await store.update(id, data);
  }

  /* ------------------------------ type picker ------------------------------ */

  static async _promptType() {
    const buttons = TRACKER_TYPES.map(type => ({
      action: type,
      label: L(`GLCT.tracker.types.${type}`),
      callback: () => type
    }));
    try {
      return await DialogV2.wait({
        window: { title: L("GLCT.tracker.add"), icon: "fa-solid fa-list-check" },
        content: `<p class="glct-trk-pick">${L("GLCT.tracker.pickType")}</p>`,
        buttons,
        rejectClose: false
      });
    } catch { return null; }
  }

  /* ------------------------------ config form ------------------------------ */

  static _fields(type, t, isActor) {
    const row = (label, input) => `<label>${label}</label>${input}`;
    const text = (name, val) => `<input type="text" name="${name}" value="${esc(val)}">`;
    const num = (name, val, min, max) => `<input type="number" name="${name}" value="${val ?? 0}"${min != null ? ` min="${min}"` : ""}${max != null ? ` max="${max}"` : ""}>`;
    // Optional number: leaves the field blank when unset, so it reads back as null.
    const onum = (name, val) => `<input type="number" name="${name}" value="${val ?? ""}" placeholder="—">`;
    const check = (name, on) => `<input type="checkbox" name="${name}" ${on ? "checked" : ""}>`;

    const parts = [];
    switch (type) {
      case "point":
        parts.push(row(L("GLCT.tracker.field.name"), text("name", t.name)));
        parts.push(row(L("GLCT.tracker.field.value"), num("value", t.value)));
        parts.push(row(L("GLCT.tracker.field.min"), onum("min", t.min)));
        parts.push(row(L("GLCT.tracker.field.max"), onum("max", t.max)));
        break;
      case "clock":
        parts.push(row(L("GLCT.tracker.field.name"), text("name", t.name)));
        parts.push(row(L("GLCT.tracker.field.slices"), num("slices", t.slices, 1, 24)));
        parts.push(row(L("GLCT.tracker.field.value"), num("value", t.value, 0)));
        parts.push(row(L("GLCT.tracker.field.badClock"), check("bad", t.bad)));
        break;
      case "pool":
        parts.push(row(L("GLCT.tracker.field.name"), text("name", t.name)));
        parts.push(row(L("GLCT.tracker.field.count"), num("count", t.count, 1, 50)));
        parts.push(row(L("GLCT.tracker.field.size"), num("size", t.size, 2, 100)));
        parts.push(row(L("GLCT.tracker.field.discard"), num("discard", t.discard, 0)));
        parts.push(row(L("GLCT.tracker.field.current"), num("current", t.current, 0)));
        // A PC's private pool is always rollable by its owner, so the world-only
        // "players may roll" opt-in is meaningless on a sheet — hide it there.
        if (!isActor) parts.push(row(L("GLCT.tracker.field.playerRoll"), check("playerRoll", t.playerRoll)));
        break;
      case "task":
      case "hazard":
        parts.push(row(L("GLCT.tracker.field.titleField"), text("title", t.title)));
        parts.push(row(L("GLCT.tracker.field.subtitle"), text("subtitle", t.subtitle)));
        parts.push(row(L("GLCT.tracker.field.boxes"), num("boxes", t.boxes, 1, 30)));
        parts.push(row(L("GLCT.tracker.field.value"), num("value", t.value, 0)));
        break;
      case "separator":
        parts.push(row(L("GLCT.tracker.field.label"), text("label", t.label)));
        break;
    }
    // Per-tracker player visibility only applies to the shared world dock; a
    // sheet tracker is private to the PC by definition.
    if (!isActor) parts.push(row(L("GLCT.tracker.field.visible"), check("visibleToPlayers", t.visibleToPlayers ?? true)));
    return parts.join("");
  }

  static _read(type, form, isActor) {
    const v = (n) => form.elements[n]?.value;
    const nn = (n, d = 0) => { const x = Math.trunc(Number(v(n))); return Number.isFinite(x) ? x : d; };
    // Optional number field: blank reads back as null (unset bound).
    const opt = (n) => { const s = v(n); if (s == null || String(s).trim() === "") return null; const x = Math.trunc(Number(s)); return Number.isFinite(x) ? x : null; };
    const ck = (n) => !!form.elements[n]?.checked;
    // Sheet trackers carry no player-visibility flag; keep them flagged visible
    // so they sort/behave consistently if ever surfaced elsewhere.
    const base = { visibleToPlayers: isActor ? true : ck("visibleToPlayers") };
    switch (type) {
      case "point": return { ...base, name: (v("name") || "").trim() || L("GLCT.tracker.types.point"), value: nn("value"), min: opt("min"), max: opt("max") };
      case "clock": return { ...base, name: (v("name") || "").trim() || L("GLCT.tracker.types.clock"), slices: nn("slices", 6), value: nn("value"), bad: ck("bad") };
      case "pool": return {
        ...base, name: (v("name") || "").trim() || L("GLCT.tracker.types.pool"),
        count: nn("count", 5), size: nn("size", 6), discard: nn("discard", 2),
        current: nn("current", nn("count", 5)), playerRoll: isActor ? false : ck("playerRoll")
      };
      case "task":
      case "hazard": return {
        ...base, title: (v("title") || "").trim() || L(`GLCT.tracker.types.${type}`),
        subtitle: (v("subtitle") || "").trim(), boxes: nn("boxes", 6), value: nn("value")
      };
      case "separator": return { ...base, label: (v("label") || "").trim() };
      default: return base;
    }
  }

  static async _promptConfig(type, t, store) {
    const isActor = !!store?.isActor;
    try {
      return await DialogV2.prompt({
        window: { title: `${L("GLCT.tracker.edit")} · ${L(`GLCT.tracker.types.${type}`)}`, icon: "fa-solid fa-pen" },
        content: `<div class="glct-trk-form">${this._fields(type, t, isActor)}</div>`,
        ok: {
          label: L("GLCT.editor.save"),
          callback: (event, button) => this._read(type, button.form, isActor)
        },
        rejectClose: false
      });
    } catch { return null; }
  }
}
