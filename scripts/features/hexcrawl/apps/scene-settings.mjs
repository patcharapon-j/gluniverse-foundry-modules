/**
 * Hexcrawl — per-scene settings (the map's `config`).
 *
 * Every DEFAULT_CONFIG field, one form. Names are dotted (`dice.perRating.2`,
 * `cost.unit`) so Foundry's parser hands the handler a nested object; the
 * per-rating tables come back as `{ "0": …, "1": … }` and are turned into arrays
 * here. `store.setConfig` merges and normalizes, so clamping lives in one place.
 */

import { COST_UNITS, DIE_SIZES, MASK_PRESETS, RATING_MAX, RATING_MIN, RENDER_MODES } from "../constants.mjs";
import { StoreAppBase } from "./base.mjs";
import { L, currentStore, indexedList, optionList, ratingLabel, readForm, tpl } from "./shared.mjs";

export const SCENE_SETTINGS_ID = "glhex-scene-settings";

const AUTO_PRESETS = Object.freeze([...Object.keys(MASK_PRESETS), "revealed"]);

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
      actions: { cancel: function () { this.close(); } },
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
        autoPresets: optionList(AUTO_PRESETS, (p) => L(`GLHEX.mask.${p}`), c.autoPreset),
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
    }

    static async #save() {
      const store = this.store;
      if (!store) return;
      const f = readForm(this.element);
      const num = (v, fb) => (v === "" || v == null || !Number.isFinite(Number(v)) ? fb : Number(v));
      const c = store.map.config;
      await store.setConfig({
        sight: num(f.sight, c.sight),
        autoPreset: f.autoPreset,
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
      });
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
