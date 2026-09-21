/**
 * Hexcrawl — custom terrain manager.
 *
 * Edits are LIVE: a name, colour or glyph change writes that terrain through
 * `store.setTerrain` on `change`, and the manager re-renders from the store. With
 * nothing held in a draft, a store event can never overwrite an unsaved edit.
 * Built-ins are listed read-only for reference; a GM who wants a different
 * forest makes a custom terrain rather than repainting everyone's.
 */

import { escapeHTML } from "../../../core/util.mjs";
import { BUILTIN_TERRAIN_IDS, BUILTIN_TERRAINS, GLYPH_IDS } from "../constants.mjs";
import { newId } from "../model.mjs";
import { StoreAppBase } from "./base.mjs";
import { L, confirmDialog, currentStore, glyphSvg, tpl } from "./shared.mjs";

export const TERRAIN_MANAGER_ID = "glhex-terrains";

let _App = null;

function TerrainManagerApp() {
  if (_App) return _App;
  const Base = StoreAppBase();

  _App = class HexTerrainManager extends Base {
    static DEFAULT_OPTIONS = {
      id: TERRAIN_MANAGER_ID,
      classes: ["glhex-app", "glhex-editor", "glhex-terrain-manager"],
      tag: "section",
      window: { title: "GLHEX.app.terrains.title", icon: "fa-solid fa-swatchbook", resizable: true },
      position: { width: 440, height: 620 },
      actions: {
        add: HexTerrainManager.#onAdd,
        select: HexTerrainManager.#onSelect,
        glyph: HexTerrainManager.#onGlyph,
        remove: HexTerrainManager.#onRemove,
      },
    };

    static PARTS = { main: { template: tpl("terrain-manager"), scrollable: [".glhex-body"] } };

    selected = null;

    async _prepareContext(options) {
      const context = await super._prepareContext(options);
      const map = this.map;
      if (!map) return { ...context, empty: true };
      const custom = Object.values(map.terrains).sort((a, b) => (a.name || "").localeCompare(b.name || ""));
      if (this.selected && !map.terrains[this.selected]) this.selected = null;
      const sel = this.selected ? map.terrains[this.selected] : null;
      return {
        ...context,
        empty: false,
        builtins: BUILTIN_TERRAIN_IDS.map((id) => ({
          id, label: L(`GLHEX.terrain.${id}`), color: BUILTIN_TERRAINS[id].color,
          svg: glyphSvg(BUILTIN_TERRAINS[id].glyph), shadowed: !!map.terrains[id],
        })),
        custom: custom.map((t) => ({
          id: t.id, name: t.name, color: t.color, svg: glyphSvg(t.glyph),
          glyphLabel: L(`GLHEX.glyph.${t.glyph}`), active: t.id === this.selected,
        })),
        sel: sel ? { ...sel } : null,
        glyphs: GLYPH_IDS.map((g) => ({ id: g, label: L(`GLHEX.glyph.${g}`), svg: glyphSvg(g), active: sel?.glyph === g })),
      };
    }

    async _onRender(context, options) {
      await super._onRender(context, options);
      for (const input of this.element.querySelectorAll("[data-field]")) {
        input.addEventListener("change", () => this.#write({ [input.dataset.field]: input.value }));
      }
    }

    _onStoreChange() { this._scheduleRender(); }

    async #write(partial) {
      const store = this.store;
      const cur = this.selected ? store?.map?.terrains?.[this.selected] : null;
      if (!cur) return;
      const next = { ...cur, ...partial };
      if (typeof next.name === "string") next.name = next.name.trim() || cur.name;
      await store.setTerrain(cur.id, next);
    }

    static async #onAdd() {
      const store = this.store;
      if (!store) return;
      const id = await store.setTerrain(null, { id: newId("t"), name: L("GLHEX.app.terrains.defaultName"), color: "#7f8fb0", glyph: "star" });
      if (id) { this.selected = id; this.render(); }
    }

    static #onSelect(event, target) {
      const id = target.closest("[data-id]")?.dataset.id ?? null;
      this.selected = this.selected === id ? null : id;
      this.render();
    }

    static #onGlyph(event, target) {
      this.#write({ glyph: target.dataset.glyph });
    }

    static async #onRemove(event, target) {
      event.stopPropagation();
      const store = this.store;
      const id = target.closest("[data-id]")?.dataset.id;
      const t = id ? store?.map?.terrains?.[id] : null;
      if (!t) return;
      let uses = 0;
      for (const h of Object.values(store.map.hexes)) if (h?.t === id) uses++;
      for (const r of Object.values(store.map.regions)) if (r?.t === id) uses++;
      const ok = await confirmDialog(
        L("GLHEX.app.terrains.deleteTitle"),
        L("GLHEX.app.terrains.deleteBody", { name: escapeHTML(t.name), n: uses }),
      );
      if (!ok) return;
      if (this.selected === id) this.selected = null;
      await store.deleteTerrain(id);
    }
  };

  return _App;
}

export async function openTerrainManager() {
  if (!game.user?.isGM || !currentStore()) return null;
  const existing = foundry.applications.instances.get(TERRAIN_MANAGER_ID);
  if (existing) {
    if (existing.store === currentStore()) { existing.render({ force: true }); existing.bringToFront?.(); return existing; }
    await existing.close();
  }
  const Cls = TerrainManagerApp();
  const app = new Cls();
  app.render({ force: true });
  return app;
}
