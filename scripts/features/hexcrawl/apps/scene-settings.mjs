/**
 * Hexcrawl — per-scene settings (the map's `config`).
 *
 * Every DEFAULT_CONFIG field, one form. Names are dotted (`dice.perRating.2`,
 * `cost.unit`) so Foundry's parser hands the handler a nested object; the
 * per-rating tables come back as `{ "0": …, "1": … }` and are turned into arrays
 * here. `store.setConfig` merges and normalizes, so clamping lives in one place.
 *
 * It also owns the map's mask presets (`presets.<id>.name`, `presets.<id>.f.<field>`):
 * rows are added and removed in the DOM, and Save replaces the whole preset set
 * in the same write as the config, so a deleted row stays deleted.
 */

import {
  COST_UNITS, DIE_SIZES, MASK_FIELDS, MASK_PRESETS, RATING_MAX, RATING_MIN, RENDER_MODES, SIGHT_STATES,
} from "../constants.mjs";
import { newId, validPresetId } from "../model.mjs";
import { StoreAppBase } from "./base.mjs";
import { L, currentStore, indexedList, optionList, ratingLabel, readForm, tpl } from "./shared.mjs";

export const SCENE_SETTINGS_ID = "glhex-scene-settings";

const FIELD_ICONS = Object.freeze({
  region: "fa-solid fa-draw-polygon", terrain: "fa-solid fa-mountain-sun", rating: "fa-solid fa-gauge-high",
  name: "fa-solid fa-signature", landmarks: "fa-solid fa-location-dot", rumor: "fa-solid fa-comment-dots",
});
const fieldCols = () => MASK_FIELDS.map((key) => ({ key, icon: FIELD_ICONS[key], label: L(`GLHEX.field.${key}`) }));
const presetRow = (id, p) => ({
  id, name: p.name,
  placeholder: Object.hasOwn(MASK_PRESETS, id) ? L(`GLHEX.mask.${id}`) : L("GLHEX.app.scene.presetName"),
  fields: MASK_FIELDS.map((key) => ({ key, on: !!p.f[key], label: L(`GLHEX.field.${key}`) })),
});

let _App = null;

function SceneSettingsApp() {
  if (_App) return _App;
  const Base = StoreAppBase();

  _App = class HexSceneSettings extends Base {
    static DEFAULT_OPTIONS = {
      id: SCENE_SETTINGS_ID,
      classes: ["glhex-app", "glhex-editor", "glhex-scene-settings"],
      tag: "form",
      window: { title: "GLHEX.app.scene.title", icon: "fa-solid fa-sliders", resizable: true },
      position: { width: 460, height: "auto" },
      form: { handler: HexSceneSettings.#save, submitOnChange: false, closeOnSubmit: true },
      actions: {
        cancel: function () { this.close(); },
        addPreset: HexSceneSettings.#onAddPreset,
        removePreset: HexSceneSettings.#onRemovePreset,
        fillSight: HexSceneSettings.#onFillSight,
      },
    };

    static PARTS = { main: { template: tpl("scene-settings"), scrollable: [".glhex-body"] } };

    async _prepareContext(options_) {
      const context = await super._prepareContext(options_);
      const c = this.map?.config;
      if (!c) return { ...context, empty: true };
      const rows = Array.from({ length: RATING_MAX - RATING_MIN + 1 }, (_, i) => ({
        i, n: RATING_MIN + i, label: ratingLabel(RATING_MIN + i),
        dice: c.dice.perRating[i], cost: c.cost.table[i],
      }));
      return {
        ...context,
        empty: false,
        c,
        sceneName: this.store.scene?.name ?? "",
        sightStates: optionList(SIGHT_STATES, (v) => L(`GLHEX.sightState.${v}`), c.sightState),
        sightMasked: c.sightState === "masked",
        sightFields: MASK_FIELDS.map((key) => ({ key, icon: FIELD_ICONS[key], label: L(`GLHEX.field.${key}`), on: !!c.sightFields[key] })),
        fieldCols: fieldCols(),
        presets: Object.entries(this.map.presets).map(([id, p]) => presetRow(id, p)),
        renders: optionList(RENDER_MODES, (m) => L(`GLHEX.render.${m}`), c.render),
        dies: optionList(DIE_SIZES, (d) => `d${d}`, c.dice.die),
        units: optionList(Object.keys(COST_UNITS), (u) => L(`GLHEX.unit.${u}`), c.cost.unit),
        rows,
        watches: c.cost.unit === "watches",
      };
    }

    async _onRender(context, options_) {
      await super._onRender(context, options_);
      const unit = this.element.querySelector("select[name='cost.unit']");
      const watch = this.element.querySelector("[data-watch-row]");
      unit?.addEventListener("change", () => { if (watch) watch.hidden = unit.value !== "watches"; });
      const state = this.element.querySelector("select[name='sightState']");
      const checks = this.element.querySelector("[data-sight-fields]");
      state?.addEventListener("change", () => { if (checks) checks.hidden = state.value !== "masked"; });
    }

    /** A new, empty preset row (DOM only; Save writes it). */
    static #onAddPreset() {
      const body = this.element.querySelector("[data-preset-rows]");
      const proto = this.element.querySelector("template[data-preset-proto]");
      if (!body || !proto) return;
      let id = newId("p");
      while (!validPresetId(id) || this.element.querySelector(`[data-preset="${id}"]`)) id = newId("p");
      body.insertAdjacentHTML("beforeend", proto.innerHTML.replaceAll("__ID__", id));
      body.lastElementChild?.querySelector("input[type='text']")?.focus();
      this.element.querySelector("[data-preset-empty]")?.setAttribute("hidden", "");
    }

    static #onRemovePreset(event, target) {
      target.closest("[data-preset]")?.remove();
      const empty = this.element.querySelector("[data-preset-empty]");
      if (empty && !this.element.querySelector("[data-preset-rows] [data-preset]")) empty.removeAttribute("hidden");
    }

    /** Copy a preset row's ticks (as currently edited, not as saved) into the sight checklist. */
    static #onFillSight(event, target) {
      const row = target.closest("[data-preset]");
      if (!row) return;
      for (const key of MASK_FIELDS) {
        const src = row.querySelector(`input[name$=".f.${key}"]`);
        const dst = this.element.querySelector(`input[name="sightFields.${key}"]`);
        if (src && dst) dst.checked = src.checked;
      }
      const state = this.element.querySelector("select[name='sightState']");
      if (state && state.value !== "masked") { state.value = "masked"; state.dispatchEvent(new Event("change")); }
    }

    static async #save() {
      const store = this.store;
      if (!store) return;
      const f = readForm(this.element);
      const num = (v, fb) => (v === "" || v == null || !Number.isFinite(Number(v)) ? fb : Number(v));
      const c = store.map.config;
      const presets = {};
      for (const [id, p] of Object.entries(f.presets ?? {})) {
        if (!validPresetId(id)) continue;
        presets[id] = { name: String(p?.name ?? "").trim(), f: Object.fromEntries(MASK_FIELDS.map((k) => [k, !!p?.f?.[k]])) };
      }
      await store.setConfig({
        sight: num(f.sight, c.sight),
        sightState: f.sightState,
        sightFields: Object.fromEntries(MASK_FIELDS.map((k) => [k, !!f.sightFields?.[k]])),
        render: f.render,
        alwaysPips: !!f.alwaysPips,
        trail: !!f.trail,
        playersMove: !!f.playersMove,
        dice: {
          die: num(f.dice?.die, c.dice.die),
          perRating: indexedList(f.dice?.perRating).map((v, i) => num(v, c.dice.perRating[i])),
          trigger: num(f.dice?.trigger, c.dice.trigger),
        },
        cost: {
          unit: f.cost?.unit,
          table: indexedList(f.cost?.table).map((v, i) => num(v, c.cost.table[i])),
          watchHours: num(f.cost?.watchHours, c.cost.watchHours),
        },
        advanceTime: !!f.advanceTime,
        arrivalCard: !!f.arrivalCard,
      }, { presets });
    }
  };

  return _App;
}

export async function openSceneSettings() {
  if (!game.user?.isGM || !currentStore()) return null;
  const existing = foundry.applications.instances.get(SCENE_SETTINGS_ID);
  if (existing) {
    if (existing.store === currentStore()) { existing.render({ force: true }); existing.bringToFront?.(); return existing; }
    await existing.close();
  }
  const Cls = SceneSettingsApp();
  const app = new Cls();
  app.render({ force: true });
  return app;
}
