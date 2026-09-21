/**
 * Hexcrawl — the region editor.
 *
 * Same draft discipline as the hex editor: the Roll buttons draw from a linked
 * RollTable into the draft and re-render; nothing is written until Save, which
 * replaces the region through `store.setRegion(id, data)`.
 *
 * Encounter rolls APPEND (a GM preparing a region builds a short list of
 * encounters); rumour rolls REPLACE (a region carries one rumour at a time, and
 * its truth note describes that one).
 */

import { escapeHTML } from "../../../core/util.mjs";
import { BLANK_TERRAIN, RATING_MAX, RATING_MIN, RUMOR_TRUTH, MAX_ICON_VARIANTS, TEX_MODES } from "../constants.mjs";
import { StoreAppBase } from "./base.mjs";
import {
  L, bindUuidDrops, confirmDialog, currentStore, drawTableText, openUuid, optionList, ratingLabel,
  readForm, terrainChoices, tpl, bindFilePickers,
} from "./shared.mjs";

const appId = (id) => `glhex-region-${String(id).replace(/[^0-9a-z-]/gi, "_")}`;

function draftFrom(r) {
  return {
    name: r.name ?? "",
    nk: !!r.nk,
    t: r.t ?? "",
    rt: r.rt ?? 2,
    color: r.color ?? "",
    bl: !!r.bl,
    enc: { text: r.enc?.text ?? "", table: r.enc?.table ?? "" },
    rumor: {
      text: r.rumor?.text ?? "",
      truth: RUMOR_TRUTH.includes(r.rumor?.truth) ? r.rumor.truth : "true",
      known: !!r.rumor?.known,
      table: r.rumor?.table ?? "",
    },
    notes: r.notes ?? "",
    icon: Array.from({ length: MAX_ICON_VARIANTS }, (_, i) => r.icon?.[i] ?? ""),
    tex: { src: r.tex?.src ?? "", mode: r.tex?.mode ?? "fit", scale: r.tex?.scale ?? 4, pixel: !!r.tex?.pixel },
  };
}

let _Editor = null;

function RegionEditorApp() {
  if (_Editor) return _Editor;
  const Base = StoreAppBase();

  _Editor = class RegionEditor extends Base {
    static DEFAULT_OPTIONS = {
      classes: ["glhex-app", "glhex-editor", "glhex-region-editor"],
      tag: "form",
      window: { icon: "fa-solid fa-draw-polygon", resizable: true },
      position: { width: 440, height: "auto" },
      form: { handler: RegionEditor.#save, submitOnChange: false, closeOnSubmit: true },
      actions: {
        rollEnc: RegionEditor.#onRollEnc,
        rollRumor: RegionEditor.#onRollRumor,
        openLink: RegionEditor.#onOpenLink,
        clearColor: RegionEditor.#onClearColor,
        delete: RegionEditor.#onDelete,
        cancel: function () { this.close(); },
      },
    };

    static PARTS = { main: { template: tpl("region-editor"), scrollable: [".glhex-body"] } };

    constructor(options = {}) {
      super({ ...options, id: appId(options.regionId) });
      this.regionId = options.regionId;
      this.draft = null;
    }

    get title() {
      const r = this.map?.regions?.[this.regionId];
      return L("GLHEX.app.region.title", { name: r?.name || L("GLHEX.app.common.unnamed") });
    }

    get region() { return this.map?.regions?.[this.regionId] ?? null; }

    async _prepareContext(options) {
      const context = await super._prepareContext(options);
      const map = this.map;
      const region = this.region;
      if (!map || !region) return { ...context, empty: true };
      this.draft ??= draftFrom(region);
      const d = this.draft;
      const choices = terrainChoices(map);
      const terrainColor = choices.find((c) => c.id === d.t)?.color ?? BLANK_TERRAIN.color;
      let count = 0;
      for (const h of Object.values(map.hexes)) if (h?.rg === this.regionId) count++;
      return {
        ...context,
        empty: false,
        iconRows: d.icon.map((src, i) => ({ i, src, n: i + 1 })),
        texModes: TEX_MODES.map((m) => ({ value: m, label: L(`GLHEX.texMode.${m}`), selected: m === d.tex.mode })),
        texTile: d.tex.mode === "tile",
        d,
        count,
        terrains: [
          { value: "", label: L("GLHEX.app.common.noTerrain"), selected: !d.t },
          ...choices.map((c) => ({ value: c.id, label: c.label, selected: c.id === d.t })),
        ],
        ratings: optionList(Array.from({ length: RATING_MAX - RATING_MIN + 1 }, (_, i) => RATING_MIN + i),
          (n) => `${n} · ${ratingLabel(n)}`, d.rt),
        truths: optionList(RUMOR_TRUTH, (t) => L(`GLHEX.truth.${t}`), d.rumor.truth),
        colorShown: d.color || terrainColor,
        colorCustom: !!d.color,
      };
    }

    async _onRender(context, options) {
      await super._onRender(context, options);
      const root = this.element;
      bindUuidDrops(root);
      bindFilePickers(root);
      const picker = root.querySelector("[data-color-picker]");
      const hidden = root.querySelector("input[name='color']");
      picker?.addEventListener("input", () => {
        hidden.value = picker.value;
        picker.closest(".glhex-color")?.classList.add("is-custom");
      });
      root.querySelector("select[name='t']")?.addEventListener("change", () => { this.#syncDraft(); this.render(); });
    }

    #syncDraft() {
      if (!this.draft || !this.element) return;
      const f = readForm(this.element);
      const d = this.draft;
      d.name = f.name ?? "";
      d.nk = !!f.nk;
      d.t = f.t ?? "";
      d.rt = Number(f.rt) || 2;
      d.color = /^#[0-9a-f]{6}$/i.test(f.color ?? "") ? f.color : "";
      d.bl = !!f.bl;
      d.enc = { text: f.enc?.text ?? "", table: (f.enc?.table ?? "").trim() };
      d.rumor = {
        text: f.rumor?.text ?? "",
        truth: RUMOR_TRUTH.includes(f.rumor?.truth) ? f.rumor.truth : "true",
        known: !!f.rumor?.known,
        table: (f.rumor?.table ?? "").trim(),
      };
      d.notes = f.notes ?? "";
      d.icon = Array.from({ length: MAX_ICON_VARIANTS }, (_, i) => String(f.icon?.[i] ?? "").trim());
      d.tex = { src: String(f.tex?.src ?? "").trim(), mode: TEX_MODES.includes(f.tex?.mode) ? f.tex.mode : "fit", scale: Number(f.tex?.scale) || 4, pixel: !!f.tex?.pixel };
    }

    static async #save() {
      const store = this.store;
      if (!store || !this.draft || !this.region) return;
      this.#syncDraft();
      const d = this.draft;
      await store.setRegion(this.regionId, {
        id: this.regionId,
        name: d.name.trim(),
        nk: d.nk,
        t: d.t || null,
        rt: d.rt,
        color: d.color || null,
        bl: d.bl,
        enc: { text: d.enc.text, table: d.enc.table || null },
        rumor: { text: d.rumor.text, truth: d.rumor.truth, known: d.rumor.known, table: d.rumor.table || null },
        notes: d.notes,
        icon: d.icon.filter(Boolean),
        tex: d.tex.src ? { ...d.tex } : null,
      });
    }

    static async #onRollEnc() {
      this.#syncDraft();
      const text = await drawTableText(this.draft.enc.table);
      if (!text || !this.rendered) return;
      const cur = this.draft.enc.text.trim();
      this.draft.enc.text = cur ? `${cur}\n${text}` : text;
      this.render();
    }

    static async #onRollRumor() {
      this.#syncDraft();
      const text = await drawTableText(this.draft.rumor.table);
      if (!text || !this.rendered) return;
      this.draft.rumor.text = text;
      this.render();
    }

    static #onOpenLink(event, target) {
      openUuid(target.closest(".glhex-link")?.querySelector("input")?.value?.trim());
    }

    static #onClearColor() {
      this.#syncDraft();
      this.draft.color = "";
      this.render();
    }

    static async #onDelete() {
      const store = this.store;
      const r = this.region;
      if (!store || !r) return;
      const ok = await confirmDialog(
        L("GLHEX.app.region.deleteTitle"),
        L("GLHEX.app.region.deleteBody", { name: escapeHTML(r.name || L("GLHEX.app.common.unnamed")) }),
      );
      if (!ok) return;
      await store.deleteRegion(this.regionId);
      this.close();
    }

    _onStoreChange() {
      // The region vanished under us (deleted from another window, or undone).
      if (this.rendered && !this.region) this.close();
    }
  };

  return _Editor;
}

export function openRegionEditor(id) {
  if (!game.user?.isGM) return null;
  const store = currentStore();
  if (!store) return null;
  if (id == null) {
    // No id: create a region first, then edit it.
    return store.setRegion(null, { name: L("GLHEX.app.region.defaultName"), t: "grassland", rt: 2 })
      .then((newId) => (newId ? openRegionEditor(newId) : null));
  }
  if (!store.map?.regions?.[id]) return null;
  const existing = foundry.applications.instances.get(appId(id));
  if (existing) { existing.render({ force: true }); existing.bringToFront?.(); return existing; }
  const Cls = RegionEditorApp();
  const app = new Cls({ regionId: id });
  app.render({ force: true });
  return app;
}
