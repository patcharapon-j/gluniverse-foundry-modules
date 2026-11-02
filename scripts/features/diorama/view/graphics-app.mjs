/**
 * Diorama — the Graphics panel: every per-user option of the 3D view in one
 * small window, opened from the view's toolbar. Each change is written to its
 * client setting at once; the view redraws from updateSetting. The same
 * settings are also in the Control Center; this is the quick road to them.
 *
 * The ApplicationV2 subclass is built in a memoised factory: nothing here
 * touches `foundry` at import.
 */

import { SUITE_ID } from "../../../core/const.mjs";
import { OPTIONS } from "../options.mjs";
import { SETTINGS } from "../constants.mjs";

/** The client settings this panel shows, in order: the view's own toggles, then graphics. */
const VIEW_ROWS = Object.freeze([
  { key: SETTINGS.grid, name: "grid", type: "boolean" },
  { key: SETTINGS.tiltShift, name: "tiltShift", type: "boolean" },
  { key: SETTINGS.effects, name: "effects", type: "string", choices: ["halo", "plate"] },
  { key: SETTINGS.follow, name: "follow", type: "boolean" },
  { key: SETTINGS.invite, name: "invite", type: "string", choices: ["ask", "auto", "never"] },
]);

export const GRAPHICS_ROWS = Object.freeze([...OPTIONS.filter((o) => o.scope === "client"), ...VIEW_ROWS]);

let _Class = null;
let _app = null;

function makeClass() {
  const { ApplicationV2 } = foundry.applications.api;
  const f = foundry.data.fields;
  const T = (k) => game.i18n.localize(k);

  return class DioramaGraphicsApp extends ApplicationV2 {
    static DEFAULT_OPTIONS = {
      id: "gldio-graphics",
      classes: ["gldio-graphics", "gl-type"],
      tag: "form",
      window: { title: "GLDIO.graphics.title", icon: "fa-solid fa-sliders", resizable: true },
      position: { width: 440, height: 620 },
      actions: { reset: DioramaGraphicsApp._onReset },
    };

    #field(o) {
      if (o.type === "boolean") return new f.BooleanField();
      if (o.choices) {
        const choices = Object.fromEntries(o.choices.map((v) => [v, `GLDIO.settings.${o.name}.${v}`]));
        return o.numeric ? new f.NumberField({ required: true, nullable: false, choices }) : new f.StringField({ required: true, choices });
      }
      if (o.range) return new f.NumberField({ required: true, nullable: false, min: o.range.min, max: o.range.max, step: o.range.step });
      return new f.StringField({ required: true });
    }

    async _renderHTML() {
      const root = document.createElement("div");
      root.className = "gldio-graphics-body";
      const hint = document.createElement("p");
      hint.className = "gldio-graphics-hint";
      hint.textContent = T("GLDIO.graphics.hint");
      root.append(hint);
      for (const o of GRAPHICS_ROWS) {
        let value;
        try { value = game.settings.get(SUITE_ID, o.key); } catch { value = o.default; }
        const group = this.#field(o).toFormGroup(
          { label: T(`GLDIO.settings.${o.name}.name`), hint: T(`GLDIO.settings.${o.name}.hint`), rootId: this.id },
          { name: o.key, value: o.type === "boolean" ? !!value : value, localize: true },
        );
        root.append(group);
      }
      const foot = document.createElement("footer");
      foot.className = "gldio-graphics-foot";
      const reset = document.createElement("button");
      reset.type = "button";
      reset.className = "gl-btn gldio-graphics-reset";
      reset.dataset.action = "reset";
      const icon = document.createElement("i");
      icon.className = "fa-solid fa-rotate-left";
      const label = document.createElement("span");
      label.textContent = T("GLDIO.graphics.reset");
      reset.append(icon, label);
      foot.append(reset);
      root.append(foot);
      return root;
    }

    _replaceHTML(result, content) {
      content.replaceChildren(result);
    }

    // The window element outlives re-renders: listen once.
    _onFirstRender(context, options) {
      super._onFirstRender?.(context, options);
      this.element.addEventListener("change", (ev) => this.#onChange(ev));
    }

    async #onChange(ev) {
      const input = ev.target;
      const row = GRAPHICS_ROWS.find((o) => o.key === input?.name);
      if (!row) return;
      let v = input.type === "checkbox" ? input.checked : input.value;
      if (row.numeric || row.range) v = Number(v);
      try { await game.settings.set(SUITE_ID, row.key, v); } catch (e) { console.error(e); }
    }

    static async _onReset() {
      for (const o of OPTIONS) if (o.scope === "client") {
        try { await game.settings.set(SUITE_ID, o.key, o.default); } catch { /* unregistered */ }
      }
      this.render();
    }
  };
}

export function openGraphics() {
  _Class ??= makeClass();
  _app ??= new _Class();
  _app.render({ force: true });
  return _app;
}
