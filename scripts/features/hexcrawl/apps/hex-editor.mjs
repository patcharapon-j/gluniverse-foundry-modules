/**
 * Hexcrawl — the single-hex editor (right-click a hex).
 *
 * The form is a DRAFT: structural edits (add/remove a landmark, pick an icon,
 * change the state or region) read the form back into the draft and re-render,
 * so nothing is written until Save. Save writes ONE patch — the full new hex —
 * through `store.applyPatch`, which keeps a hex edit a single undo step.
 *
 * Inheritance is shown, not hidden: the "inherit" options name what the region
 * would give, so a GM can see why a hex looks the way it does before overriding.
 */

import {
  LANDMARK_VIS, MASK_FIELDS, MAX_LANDMARKS_PER_HEX, RATING_MAX, RATING_MIN, SIGHT_PRESET, STATES,
} from "../constants.mjs";
import { isBlankHex, isMaskPreset, maskFields, newId, normalizeHex, presetFields } from "../model.mjs";
import { StoreAppBase } from "./base.mjs";
import {
  L, bindUuidDrops, currentStore, indexedList, openUuid, optionalNumber, optionList, presetChoices, ratingLabel,
  readForm, terrainChoices, terrainLabel, tpl,
} from "./shared.mjs";
import { pickIcon } from "./icon-picker.mjs";

const appId = (key) => `glhex-hex-${String(key).replace(/[^0-9a-z-]/gi, "_")}`;

function draftFrom(map, key) {
  const h = map.hexes[key] ?? { st: "hidden" };
  return {
    t: h.t ?? "",
    rg: h.rg ?? "",
    rt: h.rt ?? "",
    st: h.st ?? "hidden",
    mkP: isMaskPreset(map, h.mk?.p) ? h.mk.p : SIGHT_PRESET,
    mkF: maskFields(map, h),
    vs: !!h.vs,
    bl: !!h.bl,
    cost: h.cost ?? null,
    nm: h.nm ?? "",
    nt: h.nt ?? "",
    lm: (h.lm ?? []).map((l) => ({ ...l })),
  };
}

let _Editor = null;

function HexEditorApp() {
  if (_Editor) return _Editor;
  const Base = StoreAppBase();

  _Editor = class HexEditor extends Base {
    static DEFAULT_OPTIONS = {
      classes: ["glhex-app", "glhex-editor", "glhex-hex-editor"],
      tag: "form",
      window: { icon: "fa-solid fa-map-pin", resizable: true },
      position: { width: 420, height: "auto" },
      form: { handler: HexEditor.#save, submitOnChange: false, closeOnSubmit: true },
      actions: {
        addLandmark: HexEditor.#onAddLandmark,
        removeLandmark: HexEditor.#onRemoveLandmark,
        pickIcon: HexEditor.#onPickIcon,
        openLink: HexEditor.#onOpenLink,
        cancel: function () { this.close(); },
      },
    };

    static PARTS = { main: { template: tpl("hex-editor"), scrollable: [".glhex-body"] } };

    constructor(options = {}) {
      super({ ...options, id: appId(options.hexKey) });
      this.hexKey = options.hexKey;
      this.draft = null;
    }

    get title() {
      const name = this.map ? (this.map.hexes[this.hexKey]?.nm || this.map.regions[this.map.hexes[this.hexKey]?.rg]?.name || "") : "";
      return L("GLHEX.app.hex.title", { key: this.hexKey }) + (name ? ` · ${name}` : "");
    }

    async _prepareContext(options) {
      const context = await super._prepareContext(options);
      const map = this.map;
      if (!map) return { ...context, empty: true };
      this.draft ??= draftFrom(map, this.hexKey);
      const d = this.draft;

      const region = d.rg ? map.regions[d.rg] ?? null : null;
      const inheritedTerrain = region?.t ? terrainLabel(map, region.t) : L("GLHEX.app.common.noTerrain");
      const inheritedRating = region?.rt != null ? `${region.rt} · ${ratingLabel(region.rt)}` : L("GLHEX.app.common.none");
      const effRating = d.rt !== "" && d.rt != null ? Number(d.rt) : region?.rt ?? null;
      const tableCost = effRating != null ? map.config.cost.table[effRating - 1] ?? 0 : 0;

      const preset = presetFields(map, d.mkP);
      return {
        ...context,
        empty: false,
        key: this.hexKey,
        d,
        terrains: [
          { value: "", label: L("GLHEX.app.hex.inheritTerrain", { terrain: inheritedTerrain }), selected: !d.t },
          ...terrainChoices(map).map((c) => ({ value: c.id, label: c.label, selected: c.id === d.t })),
        ],
        regions: [
          { value: "", label: L("GLHEX.app.common.noRegion"), selected: !d.rg },
          ...Object.values(map.regions)
            .sort((a, b) => (a.name || "").localeCompare(b.name || ""))
            .map((r) => ({ value: r.id, label: r.name || L("GLHEX.app.common.unnamed"), selected: r.id === d.rg })),
        ],
        ratings: [
          { value: "", label: L("GLHEX.app.hex.inheritRating", { rating: inheritedRating }), selected: d.rt === "" || d.rt == null },
          ...optionList(Array.from({ length: RATING_MAX - RATING_MIN + 1 }, (_, i) => RATING_MIN + i),
            (n) => `${n} · ${ratingLabel(n)}`, d.rt),
        ],
        states: optionList(STATES, (s) => L(`GLHEX.state.${s}`), d.st),
        masked: d.st === "masked",
        presets: presetChoices(map).map((c) => ({ value: c.id, label: c.label, selected: c.id === d.mkP })),
        fields: MASK_FIELDS.map((f) => ({
          key: f, label: L(`GLHEX.field.${f}`), on: !!d.mkF[f], custom: !!d.mkF[f] !== !!preset[f],
        })),
        costPlaceholder: L("GLHEX.app.hex.costTable", { n: tableCost, unit: L(`GLHEX.unit.${map.config.cost.unit}`) }),
        cost: d.cost ?? "",
        namePlaceholder: region?.name || L("GLHEX.app.hex.namePlaceholder"),
        landmarks: d.lm.map((l, i) => ({
          ...l, i,
          vis: optionList(LANDMARK_VIS, (v) => L(`GLHEX.landmarkVis.${v}`), l.vis ?? "follow"),
        })),
        canAddLandmark: d.lm.length < MAX_LANDMARKS_PER_HEX,
        maxLandmarks: MAX_LANDMARKS_PER_HEX,
      };
    }

    async _onRender(context, options) {
      await super._onRender(context, options);
      const root = this.element;
      bindUuidDrops(root);
      for (const el of root.querySelectorAll("[data-rerender]")) {
        el.addEventListener("change", () => {
          this.#syncDraft();
          if (el.name === "mk.p") this.draft.mkF = { ...presetFields(this.map, this.draft.mkP) };
          this.render();
        });
      }
    }

    /** Read the form back into the draft (everything but ids/icons comes from inputs). */
    #syncDraft() {
      if (!this.draft || !this.element) return;
      const f = readForm(this.element);
      const d = this.draft;
      d.t = f.t ?? "";
      d.rg = f.rg ?? "";
      d.rt = f.rt ?? "";
      d.st = STATES.includes(f.st) ? f.st : "hidden";
      if (f.mk?.p) d.mkP = f.mk.p;
      if (f.mk?.f) for (const k of MASK_FIELDS) if (k in f.mk.f) d.mkF[k] = !!f.mk.f[k];
      d.vs = !!f.vs;
      d.bl = !!f.bl;
      d.cost = optionalNumber(f.cost);
      d.nm = f.nm ?? "";
      d.nt = f.nt ?? "";
      const rows = indexedList(f.lm);
      d.lm = d.lm.map((l, i) => ({
        ...l,
        label: rows[i]?.label ?? l.label ?? "",
        journal: rows[i]?.journal || null,
        vis: LANDMARK_VIS.includes(rows[i]?.vis) ? rows[i].vis : l.vis ?? "follow",
      }));
    }

    /** The full new hex from the draft, keeping any field this form does not own. */
    #buildHex() {
      const d = this.draft;
      const hex = structuredClone(this.map.hexes[this.hexKey] ?? { st: "hidden" });
      const set = (k, v) => { if (v === "" || v == null || v === false) delete hex[k]; else hex[k] = v; };
      set("t", d.t);
      set("rg", d.rg);
      set("rt", d.rt === "" || d.rt == null ? null : Number(d.rt));
      hex.st = d.st;
      if (d.st === "masked") {
        const p = isMaskPreset(this.map, d.mkP) ? d.mkP : SIGHT_PRESET;
        const preset = presetFields(this.map, p);
        const f = {};
        for (const k of MASK_FIELDS) if (!!d.mkF[k] !== !!preset[k]) f[k] = !!d.mkF[k];
        hex.mk = { p, f };
      } else delete hex.mk;
      set("vs", d.vs || null);
      set("bl", d.bl || null);
      // Blank CLEARS the override. normalizeHex would read "" as 0 (Number("") === 0),
      // which would make the hex free to enter — so a blank never reaches it.
      if (d.cost == null) delete hex.cost; else hex.cost = Math.max(0, d.cost);
      set("nm", d.nm.trim());
      set("nt", d.nt);
      const lm = d.lm
        .filter((l) => l.label?.trim() || l.icon || l.img || l.journal)
        .map((l) => ({ id: l.id, icon: l.icon || null, img: l.img || null, label: l.label?.trim() ?? "", journal: l.journal || null, vis: l.vis ?? "follow" }));
      if (lm.length) hex.lm = lm; else delete hex.lm;
      return hex;
    }

    static async #save() {
      const store = this.store;
      if (!store || !this.draft) return;
      this.#syncDraft();
      const hex = this.#buildHex();
      const patch = { [this.hexKey]: isBlankHex(hex) ? null : normalizeHex(hex) };
      await store.applyPatch(patch, { label: L("GLHEX.app.hex.undoLabel", { key: this.hexKey }) });
    }

    static #onAddLandmark() {
      this.#syncDraft();
      if (this.draft.lm.length >= MAX_LANDMARKS_PER_HEX) return;
      this.draft.lm.push({ id: newId("lm"), icon: "fa-solid fa-landmark", img: null, label: "", journal: null, vis: "follow" });
      this.render();
    }

    static #onRemoveLandmark(event, target) {
      this.#syncDraft();
      const i = Number(target.closest("[data-index]")?.dataset.index);
      if (Number.isInteger(i)) this.draft.lm.splice(i, 1);
      this.render();
    }

    static async #onPickIcon(event, target) {
      this.#syncDraft();
      const i = Number(target.closest("[data-index]")?.dataset.index);
      const l = this.draft.lm[i];
      if (!l) return;
      const picked = await pickIcon({ icon: l.icon, img: l.img });
      if (!picked || !this.rendered) return;
      l.icon = picked.icon ?? null;
      l.img = picked.img ?? null;
      this.render();
    }

    static #onOpenLink(event, target) {
      const input = target.closest(".glhex-link")?.querySelector("input");
      openUuid(input?.value?.trim());
    }
  };

  return _Editor;
}

export function openHexEditor(key) {
  if (!game.user?.isGM || key == null) return null;
  if (!currentStore()) return null;
  const existing = foundry.applications.instances.get(appId(key));
  if (existing) { existing.render({ force: true }); existing.bringToFront?.(); return existing; }
  const Cls = HexEditorApp();
  const app = new Cls({ hexKey: String(key) });
  app.render({ force: true });
  return app;
}
