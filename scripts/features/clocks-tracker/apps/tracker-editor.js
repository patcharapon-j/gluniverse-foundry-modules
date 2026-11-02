/**
 * TrackerEditor: one dialog to create or edit a tracker, against any store.
 *
 * Creating opens on a type picker in the same dialog (it used to be two dialogs,
 * the first of which only asked for a type); editing opens on the tracker's own
 * type. A live sample row above the fields is drawn by the same TrackerList the
 * dock mounts, so what the GM sees while typing is what the table will see.
 *
 * Every write goes through the store the caller passes: the world TrackerStore
 * (the dock) or an ActorTrackerStore (a PC's sheet tab). The store decides who
 * may write (`canWrite`) and whether the dock-only fields apply (`isActor`).
 */

import { TRACKER_TYPES } from "../const.js";
import { TYPE_ICON, LIMITS, optInt, sanitizeTracker } from "../trackers/tracker-model.js";
import { listView } from "../trackers/view.js";
import { TrackerList } from "../trackers/tracker-render.js";

const { DialogV2 } = foundry.applications.api;

const L = (k, d) => (d ? game.i18n.format(k, d) : game.i18n.localize(k));
const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));

/** Which fields each type shows, by input name. */
export const FIELDS_BY_TYPE = {
  point: ["name", "value", "min", "max"],
  clock: ["name", "slices", "value", "bad"],
  pool: ["name", "count", "size", "discard", "current", "playerRoll"],
  task: ["title", "subtitle", "boxes", "value"],
  hazard: ["title", "subtitle", "boxes", "value"],
  separator: ["label"],
};
/** The dock-only fields (a sheet tracker is private and never prominent). */
export const WORLD_ONLY = ["playerRoll", "prominent", "visibleToPlayers"];

export class TrackerEditor {
  /** Create a tracker in `store`, starting from a type picker. */
  static async create(store) {
    if (!store?.canWrite) return;
    const draft = store.makeNew("clock");
    const data = await this._open(store, draft, { creating: true });
    if (!data) return;
    const { type, ...rest } = data;
    await store.create(type, rest);
  }

  /** Edit tracker `id` in `store`. */
  static async edit(store, id) {
    if (!store?.canWrite) return;
    const t = store.get(id);
    if (!t) return;
    const data = await this._open(store, t, { creating: false });
    if (!data) return;
    const { type: _type, ...rest } = data;
    await store.update(id, rest);
  }

  /* ------------------------------ the form ------------------------------ */

  static _form(t, { creating, isActor }) {
    const field = (name, label, input, cls = "") =>
      `<label class="trk-ed-field${cls}" data-field="${name}"><span>${esc(L(label))}</span>${input}</label>`;
    const text = (name, v, ph = "") => `<input type="text" name="${name}" value="${esc(v)}" placeholder="${esc(ph)}" autocomplete="off">`;
    const num = (name, v, [lo, hi] = [null, null]) =>
      `<input type="number" name="${name}" value="${esc(v ?? 0)}" step="1"${lo !== null ? ` min="${lo}"` : ""}${hi !== null ? ` max="${hi}"` : ""}>`;
    const opt = (name, v) => `<input type="number" name="${name}" value="${v ?? ""}" step="1" placeholder="—">`;
    const check = (name, on, label, hint = "") =>
      `<label class="trk-ed-check" data-field="${name}"><input type="checkbox" name="${name}"${on ? " checked" : ""}>`
      + `<span class="trk-ed-box" aria-hidden="true"></span><span class="trk-ed-check-text"><b>${esc(L(label))}</b>`
      + (hint ? `<small>${esc(L(hint))}</small>` : "") + `</span></label>`;

    const d = (type, key) => (t.type === type ? t[key] : undefined);
    const types = creating
      ? `<div class="trk-ed-types" role="radiogroup" aria-label="${esc(L("GLCT.tracker.pickType"))}">`
        + TRACKER_TYPES.map((type) => `<button type="button" class="trk-ed-type" data-type="${type}" role="radio" aria-checked="${type === t.type}">`
          + `<i class="${TYPE_ICON[type]}" aria-hidden="true"></i><span>${esc(L(`GLCT.tracker.types.${type}`))}</span></button>`).join("")
        + `</div>`
      : "";

    const fields = [
      field("name", "GLCT.tracker.field.name", text("name", t.name ?? "", L(`GLCT.tracker.types.${t.type === "separator" ? "point" : t.type}`)), " is-wide"),
      field("title", "GLCT.tracker.field.titleField", text("title", t.title ?? ""), " is-wide"),
      field("subtitle", "GLCT.tracker.field.subtitle", text("subtitle", t.subtitle ?? ""), " is-wide"),
      field("label", "GLCT.tracker.field.label", text("label", t.label ?? ""), " is-wide"),
      field("slices", "GLCT.tracker.field.slices", num("slices", d("clock", "slices") ?? 6, LIMITS.slices)),
      field("boxes", "GLCT.tracker.field.boxes", num("boxes", t.boxes ?? (t.type === "hazard" ? 8 : 6), LIMITS.boxes)),
      field("count", "GLCT.tracker.field.count", num("count", t.count ?? 5, LIMITS.count)),
      field("size", "GLCT.tracker.field.size", num("size", t.size ?? 6, LIMITS.size)),
      field("discard", "GLCT.tracker.field.discard", num("discard", t.discard ?? 2, [0, null])),
      field("value", "GLCT.tracker.field.value", num("value", t.value ?? 0)),
      field("current", "GLCT.tracker.field.current", num("current", t.current ?? t.count ?? 5, [0, null])),
      field("min", "GLCT.tracker.field.min", opt("min", d("point", "min"))),
      field("max", "GLCT.tracker.field.max", opt("max", d("point", "max"))),
    ].join("");

    const checks = [
      check("bad", t.bad, "GLCT.tracker.field.badClock", "GLCT.tracker.field.badClockHint"),
      isActor ? "" : check("playerRoll", t.playerRoll, "GLCT.tracker.field.playerRoll", "GLCT.tracker.field.playerRollHint"),
      isActor ? "" : check("prominent", t.prominent, "GLCT.tracker.field.prominent", "GLCT.tracker.field.prominentHint"),
      isActor ? "" : check("visibleToPlayers", t.visibleToPlayers !== false, "GLCT.tracker.field.visible", "GLCT.tracker.field.visibleHint"),
    ].join("");

    return `<div class="glct-trk-editor" data-type="${esc(t.type)}"${isActor ? " data-actor" : ""}>`
      + types
      + `<div class="trk-ed-sample trk-dock" aria-hidden="true"><div data-sample></div></div>`
      + `<input type="hidden" name="type" value="${esc(t.type)}">`
      + `<div class="trk-ed-grid">${fields}</div>`
      + `<div class="trk-ed-checks">${checks}</div>`
      + `</div>`;
  }

  /** Read the form into a tracker patch for `type`. */
  static _read(form, isActor) {
    const v = (n) => form.elements[n]?.value;
    const int = (n, dflt = 0) => { const x = Math.trunc(Number(v(n))); return Number.isFinite(x) ? x : dflt; };
    const on = (n) => !!form.elements[n]?.checked;
    const type = TRACKER_TYPES.includes(v("type")) ? v("type") : "point";
    const name = (n) => String(v(n) ?? "").trim();
    const out = { type };
    switch (type) {
      case "point": Object.assign(out, { name: name("name") || L("GLCT.tracker.types.point"), value: int("value"), min: optInt(v("min")), max: optInt(v("max")) }); break;
      case "clock": Object.assign(out, { name: name("name") || L("GLCT.tracker.types.clock"), slices: int("slices", 6), value: int("value"), bad: on("bad") }); break;
      case "pool": Object.assign(out, {
        name: name("name") || L("GLCT.tracker.types.pool"),
        count: int("count", 5), size: int("size", 6), discard: int("discard", 2), current: int("current", int("count", 5)),
        playerRoll: isActor ? false : on("playerRoll"),
      }); break;
      case "task":
      case "hazard": Object.assign(out, { title: name("title") || L(`GLCT.tracker.types.${type}`), subtitle: name("subtitle"), boxes: int("boxes", 6), value: int("value") }); break;
      case "separator": Object.assign(out, { label: name("label") }); break;
    }
    out.visibleToPlayers = isActor ? true : on("visibleToPlayers");
    out.prominent = !isActor && type !== "separator" ? on("prominent") : false;
    return out;
  }

  static async _open(store, t, { creating }) {
    const isActor = !!store.isActor;
    const title = creating ? L("GLCT.tracker.add") : `${L("GLCT.tracker.edit")} · ${L(`GLCT.tracker.types.${t.type}`)}`;
    let sample = null;
    try {
      return await DialogV2.wait({
        window: { title, icon: creating ? "fa-solid fa-plus" : "fa-solid fa-pen" },
        classes: ["glct-trk-skin", "glct-trk-dialog"],
        position: { width: 400 },
        content: this._form(t, { creating, isActor }),
        buttons: [
          // Not GLCT.editor.save: that one reads "Save Calendar", and said so on
          // this button for as long as it borrowed it.
          { action: "save", label: L(creating ? "GLCT.tracker.create" : "GLCT.tracker.save"), icon: "fa-solid fa-check", default: true,
            callback: (_ev, button) => this._read(button.form, isActor) },
          { action: "cancel", label: L("GLCT.tracker.cancel"), icon: "fa-solid fa-xmark", callback: () => null },
        ],
        render: (event, dialog) => { sample = this._wire(dialog?.element ?? event?.target?.element, t, isActor); },
        rejectClose: false,
      });
    } catch { return null; }
    finally { sample?.destroy(); }
  }

  /** Type picker, field visibility, the live sample. Returns the sample list. */
  static _wire(root, t, isActor) {
    const form = root?.querySelector("form") ?? root?.querySelector(".glct-trk-editor")?.closest("form");
    const wrap = root?.querySelector(".glct-trk-editor");
    if (!form || !wrap) return null;
    const host = wrap.querySelector("[data-sample]");
    const list = new TrackerList(host, { L, variant: "sample" });

    const show = () => {
      const type = form.elements.type.value;
      wrap.dataset.type = type;
      const want = new Set(FIELDS_BY_TYPE[type] ?? []);
      for (const f of wrap.querySelectorAll("[data-field]")) {
        const name = f.dataset.field;
        const shown = want.has(name) || (name === "visibleToPlayers" && !isActor) || (name === "prominent" && !isActor && type !== "separator");
        f.hidden = !shown;
      }
      paint();
    };
    let first = true;
    const paint = () => {
      const draft = sanitizeTracker({ ...this._read(form, isActor), id: t.id ?? "sample", order: 0 });
      list.update(listView([draft], { isGM: !isActor, canWrite: false, sheet: isActor }), { animate: !first });
      first = false;
    };

    for (const b of wrap.querySelectorAll(".trk-ed-type")) {
      b.addEventListener("click", () => {
        form.elements.type.value = b.dataset.type;
        wrap.querySelectorAll(".trk-ed-type").forEach((x) => x.setAttribute("aria-checked", String(x === b)));
        show();
        wrap.querySelector(".trk-ed-field:not([hidden]) input")?.focus();
      });
    }
    form.addEventListener("input", paint);
    form.addEventListener("change", paint);
    show();
    return list;
  }
}
