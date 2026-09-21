/**
 * Hexcrawl — the GM brush palette.
 *
 * A compact docked panel beside the scene controls. It writes one thing, the
 * store's brush (`store.setBrush`), plus the handful of map-level buttons
 * (stage, reveal staged, view as players, undo). Painting itself happens on the
 * canvas in the runtime's input layer, which reads the brush back.
 *
 * It follows the viewed scene rather than closing on a switch, and closes only
 * when the viewed scene stops being a hexcrawl.
 */

import { BLANK_TERRAIN, BRUSH_TOOLS, MASK_PRESETS, RATING_MAX, RATING_MIN } from "../constants.mjs";
import { StoreAppBase } from "./base.mjs";
import { L, currentStore, glyphSvg, pips, ratingLabel, terrainChoices, terrainLabel, tpl } from "./shared.mjs";
import { openRegionEditor } from "./region-editor.mjs";
import { openSceneSettings } from "./scene-settings.mjs";
import { openTerrainManager } from "./terrain-manager.mjs";

export const PALETTE_ID = "glhex-palette";

const TOOL_ICONS = Object.freeze({
  select: "fa-solid fa-arrow-pointer",
  terrain: "fa-solid fa-mountain-sun",
  region: "fa-solid fa-draw-polygon",
  rating: "fa-solid fa-gauge-high",
  state: "fa-solid fa-eye",
  blight: "fa-solid fa-virus",
  visited: "fa-solid fa-shoe-prints",
  erase: "fa-solid fa-eraser",
});

const STATE_VALUES = Object.freeze([
  { value: "hidden", icon: "fa-solid fa-eye-slash", key: "GLHEX.state.hidden" },
  { value: "revealed", icon: "fa-solid fa-eye", key: "GLHEX.state.revealed" },
  ...Object.keys(MASK_PRESETS).map((p) => ({ value: p, icon: "fa-solid fa-mask", key: `GLHEX.mask.${p}` })),
]);

/** The last value used per tool, so switching tools and back keeps your pick. */
const lastValue = { terrain: "grassland", rating: 2, state: "revealed", blight: true, visited: true };
let lastPosition = null;
const REGION_FILTER_MIN = 8;

let _Palette = null;

function PaletteApp() {
  if (_Palette) return _Palette;
  const Base = StoreAppBase();

  _Palette = class HexPalette extends Base {
    static DEFAULT_OPTIONS = {
      id: PALETTE_ID,
      classes: ["glhex-app", "glhex-palette"],
      tag: "section",
      window: { title: "GLHEX.app.palette.title", icon: "fa-solid fa-map-location-dot", minimizable: true, resizable: false },
      position: { width: 272, height: "auto", left: 116, top: 76 },
      actions: {
        tool: HexPalette.#onTool,
        terrain: HexPalette.#onTerrain,
        rating: HexPalette.#onRating,
        state: HexPalette.#onState,
        toggle: HexPalette.#onToggle,
        region: HexPalette.#onRegion,
        regionClear: HexPalette.#onRegionClear,
        newRegion: HexPalette.#onNewRegion,
        editRegion: HexPalette.#onEditRegion,
        manageTerrains: () => openTerrainManager(),
        stage: HexPalette.#onStage,
        reveal: HexPalette.#onReveal,
        viewPlayers: HexPalette.#onViewPlayers,
        undo: HexPalette.#onUndo,
        settings: () => openSceneSettings(),
        importJson: HexPalette.#onImportJson,
      },
    };

    static PARTS = { main: { template: tpl("palette"), scrollable: [".glhex-region-list"] } };

    _filter = "";

    constructor(options = {}) {
      if (lastPosition) options.position = { ...(options.position ?? {}), ...lastPosition };
      super(options);
    }

    get brush() {
      return this.store?.brush ?? { tool: "select", value: null, stage: false };
    }

    async _prepareContext(options) {
      const context = await super._prepareContext(options);
      const store = this.store;
      const map = store?.map;
      if (!map) return { ...context, empty: true };
      const brush = this.brush;
      const tool = BRUSH_TOOLS.includes(brush.tool) ? brush.tool : "select";

      const counts = {};
      for (const h of Object.values(map.hexes)) if (h?.rg) counts[h.rg] = (counts[h.rg] ?? 0) + 1;

      const regions = Object.values(map.regions)
        .sort((a, b) => (a.name || "").localeCompare(b.name || ""))
        .map((r) => {
          const t = r.t ? terrainChoices(map).find((c) => c.id === r.t) : null;
          return {
            id: r.id,
            name: r.name || L("GLHEX.app.common.unnamed"),
            terrain: terrainLabel(map, r.t) || L("GLHEX.app.common.noTerrain"),
            color: r.color || t?.color || BLANK_TERRAIN.color,
            pips: pips(r.rt),
            ratingTitle: ratingLabel(r.rt),
            rating: r.rt ?? null,
            count: counts[r.id] ?? 0,
            blight: !!r.bl,
            active: tool === "region" && brush.value === r.id,
            search: `${r.name} ${terrainLabel(map, r.t)}`.toLowerCase(),
          };
        });

      const staged = store.staged?.size ?? 0;
      return {
        ...context,
        empty: false,
        tool,
        is: Object.fromEntries(BRUSH_TOOLS.map((t) => [t, t === tool])),
        tools: BRUSH_TOOLS.map((t) => ({
          id: t, icon: TOOL_ICONS[t], label: L(`GLHEX.tool.${t}`), active: t === tool,
        })),
        toolLabel: L(`GLHEX.tool.${tool}`),
        toolHint: L(`GLHEX.app.palette.hint.${tool}`),
        terrains: terrainChoices(map).map((c) => ({
          ...c, svg: glyphSvg(c.glyph), active: tool === "terrain" && brush.value === c.id,
        })),
        terrainInherit: tool === "terrain" && !brush.value,
        ratings: Array.from({ length: RATING_MAX - RATING_MIN + 1 }, (_, i) => {
          const n = RATING_MIN + i;
          return { n, label: ratingLabel(n), pips: pips(n), active: tool === "rating" && brush.value === n };
        }),
        ratingClear: tool === "rating" && brush.value == null,
        states: STATE_VALUES.map((s) => ({
          ...s, label: L(s.key), masked: !!MASK_PRESETS[s.value],
          active: tool === "state" && brush.value === s.value,
        })),
        toggleOn: brush.value === true,
        regions,
        regionNone: tool === "region" && !brush.value,
        showFilter: regions.length > REGION_FILTER_MIN,
        filter: this._filter,
        stage: !!brush.stage,
        staged,
        stagedLabel: L("GLHEX.app.palette.revealStaged", { n: staged }),
        viewAsPlayers: !!store.viewAsPlayers,
      };
    }

    async _onRender(context, options) {
      await super._onRender(context, options);
      const root = this.element;
      for (const row of root.querySelectorAll(".glhex-region-row[data-id]")) {
        row.addEventListener("dblclick", (ev) => { ev.preventDefault(); openRegionEditor(row.dataset.id); });
      }
      const search = root.querySelector("[data-region-filter]");
      if (search) {
        search.addEventListener("input", () => { this._filter = search.value; this.#applyFilter(); });
        if (this._filterFocused) {
          search.focus();
          search.setSelectionRange(search.value.length, search.value.length);
        }
        search.addEventListener("focus", () => { this._filterFocused = true; });
        search.addEventListener("blur", () => { this._filterFocused = false; });
      }
      this.#applyFilter();
    }

    #applyFilter() {
      const q = this._filter.trim().toLowerCase();
      for (const row of this.element.querySelectorAll(".glhex-region-row[data-search]")) {
        row.hidden = !!q && !row.dataset.search.includes(q);
      }
    }

    _onStoreChange() { this._scheduleRender(); }

    /** The input layer asks the store whether the palette is open (brush clicks vs. token clicks). */
    _bindStore(store) {
      if (this.store === store) return;
      // Report before listening, so our own report does not bounce back as a re-render.
      this.store?.setPaletteOpen?.(false);
      if (store && !store.paletteOpen) store.setPaletteOpen?.(true);
      super._bindStore(store);
    }

    _onStoreSwitch(store) {
      if (!store) { this.close(); return; }
      this._bindStore(store);
      this._scheduleRender();
    }

    _onClose(options) {
      const { left, top } = this.position ?? {};
      if (Number.isFinite(left) && Number.isFinite(top)) lastPosition = { left, top };
      this.store?.setPaletteOpen?.(false);
      super._onClose(options);
    }

    /* ── actions ─────────────────────────────────────────────────────── */

    #setBrush(partial) {
      if (!this.store) return;
      if (partial.tool && partial.tool in lastValue && "value" in partial) lastValue[partial.tool] = partial.value;
      this.store.setBrush(partial);
    }

    static #onTool(event, target) {
      const tool = target.dataset.tool;
      if (!BRUSH_TOOLS.includes(tool)) return;
      let value = null;
      if (tool in lastValue) value = lastValue[tool];
      if (tool === "region") {
        const cur = this.brush.tool === "region" ? this.brush.value : null;
        value = cur && this.map?.regions?.[cur] ? cur : Object.keys(this.map?.regions ?? {})[0] ?? null;
      }
      this.store?.setBrush({ tool, value });
    }

    static #onTerrain(event, target) {
      this.#setBrush({ tool: "terrain", value: target.dataset.value || null });
    }

    static #onRating(event, target) {
      const n = Number(target.dataset.value);
      this.#setBrush({ tool: "rating", value: Number.isInteger(n) && n >= RATING_MIN ? n : null });
    }

    static #onState(event, target) {
      this.#setBrush({ tool: "state", value: target.dataset.value });
    }

    static #onToggle(event, target) {
      const tool = this.brush.tool;
      if (tool !== "blight" && tool !== "visited") return;
      this.#setBrush({ tool, value: target.dataset.value === "1" });
    }

    static #onRegion(event, target) {
      this.store?.setBrush({ tool: "region", value: target.closest("[data-id]")?.dataset.id ?? null });
    }

    static #onRegionClear() {
      this.store?.setBrush({ tool: "region", value: null });
    }

    static #onEditRegion(event, target) {
      event.stopPropagation();
      openRegionEditor(target.closest("[data-id]")?.dataset.id ?? null);
    }

    static async #onNewRegion() {
      const store = this.store;
      if (!store) return;
      const id = await store.setRegion(null, { name: L("GLHEX.app.region.defaultName"), t: "grassland", rt: 2 });
      if (!id) return;
      store.setBrush({ tool: "region", value: id });
      openRegionEditor(id);
    }

    static #onStage() {
      this.store?.setBrush({ stage: !this.brush.stage });
    }

    static async #onReveal() {
      const store = this.store;
      if (!store) return;
      if (!store.staged?.size) { ui.notifications.info(L("GLHEX.app.palette.nothingStaged")); return; }
      await store.commitStaged();
    }

    static #onViewPlayers() {
      this.store?.setViewAsPlayers(!this.store.viewAsPlayers);
    }

    static async #onImportJson() {
      // Lazy: the import dialog is its own module and costs nothing until asked for.
      try {
        const mod = await import("../import-dialog.mjs");
        await mod.openImportDialog();
      } catch (error) {
        console.error("GLUniverse Suite | hexcrawl import dialog failed", error);
      }
    }

    static async #onUndo() {
      await this.store?.undo();
    }
  };

  return _Palette;
}

const instance = () => foundry.applications.instances.get(PALETTE_ID) ?? null;

export function openPalette() {
  if (!game.user?.isGM) return null;
  if (!currentStore()) { ui.notifications.warn(L("GLHEX.app.palette.noScene")); return null; }
  const existing = instance();
  if (existing) { existing.render({ force: true }); existing.bringToFront?.(); return existing; }
  const Cls = PaletteApp();
  const app = new Cls();
  app.render({ force: true });
  return app;
}

export function closePalette() {
  return instance()?.close() ?? null;
}

export function togglePalette() {
  return instance() ? closePalette() : openPalette();
}
