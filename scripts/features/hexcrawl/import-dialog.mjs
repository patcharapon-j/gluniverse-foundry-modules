/**
 * Hexcrawl — the JSON import / export window (GM).
 *
 * Paste or load a document in the import format (docs/HEXCRAWL_IMPORT.md),
 * check it — every guess the parser made is listed before anything is
 * written — then create a new hexcrawl scene from it or replace the current
 * scene's map. Export writes the current scene back out in the same format.
 *
 * The ApplicationV2 subclass is built in a memoised factory, never at module
 * scope: `foundry` does not exist under Node, where the check tool imports
 * the feature's modules.
 */

import { SUITE_ID } from "../../core/const.mjs";
import { escapeHTML } from "../../core/util.mjs";
import { FLAGS } from "./constants.mjs";
import { foundryAdapter, gridOrigin, hexSceneDims, key as offKey, parseKey, pureAdapter, range } from "./hex-math.mjs";
import { applyPatch, autoRevealPatch, inExtent, normalizeMap, shiftKeys } from "./model.mjs";
import { exampleImport, exportMap, parseImport } from "./import.mjs";

/** Blank hexes framing an imported map (hex-math hexSceneDims; even along the shifted axis). */
export const IMPORT_PAD = 1;

const L = (k, data) => (data ? game.i18n.format(`GLHEX.import.${k}`, data) : game.i18n.localize(`GLHEX.import.${k}`));

/**
 * The parsed map placed on the grid: import coordinates shifted onto the
 * scene's first whole hex (`origin`, hex-math gridOrigin — Foundry puts half of
 * row 0 off a padding-less scene), then the start hex and its sight range
 * revealed.
 */
export function placeOnGrid(parsed, origin) {
  const { scene } = parsed;
  const map = { ...shiftKeys(parsed.map, origin.i, origin.j), origin: { i: origin.i, j: origin.j } };
  if (!parsed.start) return map;
  const s = parseKey(parsed.start);
  const start = offKey(s.i + origin.i, s.j + origin.j);
  const adapter = pureAdapter({ type: scene.gridType, size: scene.size });
  // The map's own extent (shifted with the hexes) decides what is map: the frame
  // of padding hexes around it is border, and the party sees nothing in it.
  const seen = new Set(range(adapter, start, map.config.sight).filter((k) => inExtent(map, k)));
  return applyPatch(map, autoRevealPatch(map, { entered: [start], seen }));
}

/**
 * Where import coordinate (0,0) sits on the live canvas: the origin the last
 * import recorded on the map (so a re-import lands inside the same frame), else
 * the scene's first whole hex.
 */
function liveOrigin() {
  const stored = normalizeMap(canvas.scene?.getFlag(SUITE_ID, FLAGS.map)).origin;
  if (stored) return stored;
  const rect = canvas.dimensions.sceneRect;
  return gridOrigin(foundryAdapter(canvas.grid, rect), rect);
}

let _Cls = null;
function appClass() {
  if (_Cls) return _Cls;
  const { ApplicationV2 } = foundry.applications.api;
  _Cls = class HexImportApp extends ApplicationV2 {
    static DEFAULT_OPTIONS = {
      id: "glhex-import",
      classes: ["glhex-import", "gl-type"],
      tag: "section",
      window: { title: "GLHEX.import.title", icon: "fa-solid fa-file-import", resizable: true },
      position: { width: 560, height: "auto" },
      actions: {
        check: HexImportApp.#onCheck,
        create: HexImportApp.#onCreate,
        replace: HexImportApp.#onReplace,
        example: HexImportApp.#onExample,
        exportCurrent: HexImportApp.#onExport,
        loadFile: HexImportApp.#onLoadFile,
      },
    };

    text = "";
    parsed = null;
    error = null;

    async _renderHTML() {
      const scene = canvas?.scene;
      const isHex = !!scene?.getFlag(SUITE_ID, FLAGS.enabled);
      const p = this.parsed;
      const summary = p ? `
        <div class="glhex-import-summary gl-well">
          <div><b>${escapeHTML(p.scene.name)}</b> · ${p.scene.cols}×${p.scene.rows} · ${escapeHTML(L(`grid${p.scene.gridType}`))}</div>
          <div>${escapeHTML(L("counts", {
            hexes: Object.keys(p.map.hexes).length,
            regions: Object.keys(p.map.regions).length,
            terrains: Object.keys(p.map.terrains).length,
          }))}${p.start ? ` · ${escapeHTML(L("hasStart"))}` : ""}</div>
          ${p.warnings.length
            ? `<details class="glhex-import-warnings" open><summary>${escapeHTML(L("warnings", { n: p.warnings.length }))}</summary><ul>${p.warnings.map((w) => `<li>${escapeHTML(w)}</li>`).join("")}</ul></details>`
            : `<div class="glhex-import-ok"><i class="fa-solid fa-check"></i> ${escapeHTML(L("clean"))}</div>`}
        </div>` : "";
      const error = this.error ? `<div class="glhex-import-error"><i class="fa-solid fa-triangle-exclamation"></i> ${escapeHTML(this.error)}</div>` : "";
      return `
        <p class="glhex-import-hint">${escapeHTML(L("hint"))}</p>
        <textarea class="glhex-import-text gl-field" name="json" spellcheck="false" placeholder='{ "format": "glhex-map", … }'>${escapeHTML(this.text)}</textarea>
        <input type="file" class="glhex-import-file" accept=".json,application/json" hidden>
        <div class="glhex-import-row">
          <button type="button" class="gl-btn glhex-import-btn" data-action="loadFile"><i class="fa-solid fa-folder-open"></i> ${escapeHTML(L("load"))}</button>
          <button type="button" class="gl-btn glhex-import-btn" data-action="example"><i class="fa-solid fa-copy"></i> ${escapeHTML(L("example"))}</button>
          <button type="button" class="gl-btn glhex-import-btn" data-action="exportCurrent" ${isHex ? "" : "hidden"}><i class="fa-solid fa-file-export"></i> ${escapeHTML(L("export"))}</button>
          <span class="glhex-import-spacer"></span>
          <button type="button" class="gl-btn glhex-import-btn" data-action="check"><i class="fa-solid fa-list-check"></i> ${escapeHTML(L("check"))}</button>
        </div>
        ${error}${summary}
        <div class="glhex-import-row glhex-import-commit">
          <button type="button" class="gl-btn glhex-import-btn" data-action="replace" ${isHex ? "" : "hidden"}><i class="fa-solid fa-arrows-rotate"></i> ${escapeHTML(L("replace"))}</button>
          <button type="button" class="gl-btn glhex-import-btn glhex-import-primary" data-action="create"><i class="fa-solid fa-map-location-dot"></i> ${escapeHTML(L("create"))}</button>
        </div>`;
    }

    _replaceHTML(result, content) {
      content.innerHTML = result;
      const ta = content.querySelector(".glhex-import-text");
      ta?.addEventListener("input", () => { this.text = ta.value; });
      const file = content.querySelector(".glhex-import-file");
      file?.addEventListener("change", async () => {
        const f = file.files?.[0];
        if (!f) return;
        this.text = await f.text();
        this.#parse();
        this.render();
      });
    }

    #parse() {
      this.error = null;
      this.parsed = null;
      if (!this.text.trim()) { this.error = L("empty"); return null; }
      try { this.parsed = parseImport(this.text); }
      catch (e) { this.error = e.message; }
      return this.parsed;
    }

    static #onCheck() { this.#parse(); this.render(); }

    static #onLoadFile() { this.element.querySelector(".glhex-import-file")?.click(); }

    static async #onExample() {
      this.text = JSON.stringify(exampleImport(), null, 2);
      try { await game.clipboard.copyPlainText(this.text); ui.notifications.info(L("copied")); } catch { /* clipboard refused; the text is in the box */ }
      this.#parse();
      this.render();
    }

    static #onExport() {
      const scene = canvas?.scene;
      if (!scene?.getFlag(SUITE_ID, FLAGS.enabled)) return;
      const o = liveOrigin();
      const map = shiftKeys(normalizeMap(scene.getFlag(SUITE_ID, FLAGS.map)), -o.i, -o.j);
      // Hexes above/left of the origin (the jagged edge row) cannot be written as
      // 0-based coordinates; they are uncharted edge by construction, so drop them.
      for (const k of Object.keys(map.hexes)) { const { i, j } = parseKey(k); if (i < 0 || j < 0) delete map.hexes[k]; }
      const doc = exportMap(map, {
        name: scene.name, gridType: scene.grid.type, size: scene.grid.size,
        background: scene.background?.src ?? null,
      });
      const slug = scene.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "hexcrawl";
      foundry.utils.saveDataToFile(JSON.stringify(doc, null, 2), "application/json", `${slug}.hexcrawl.json`);
    }

    static async #onCreate() {
      const p = this.#parse();
      if (!p) return this.render();
      const { createHexcrawlScene } = await import("./scene-setup.mjs");
      const { origin } = hexSceneDims({ type: p.scene.gridType, size: p.scene.size, cols: p.scene.cols, rows: p.scene.rows, pad: IMPORT_PAD });
      const scene = await createHexcrawlScene({ ...p.scene, pad: IMPORT_PAD, map: placeOnGrid(p, origin) });
      if (scene) { ui.notifications.info(L("created", { name: scene.name })); this.close(); }
    }

    static async #onReplace() {
      const p = this.#parse();
      if (!p) return this.render();
      const scene = canvas?.scene;
      if (!scene?.getFlag(SUITE_ID, FLAGS.enabled)) return;
      if (scene.grid.type !== p.scene.gridType) ui.notifications.warn(L("gridMismatch"));
      const ok = await foundry.applications.api.DialogV2.confirm({
        window: { title: L("replaceTitle") },
        content: `<p>${escapeHTML(L("replaceConfirm", { name: scene.name }))}</p>`,
      });
      if (!ok) return;
      const { enableHexcrawl } = await import("./scene-setup.mjs");
      await enableHexcrawl(scene, placeOnGrid(p, liveOrigin()));
      ui.notifications.info(L("replaced", { name: scene.name }));
      this.close();
    }
  };
  return _Cls;
}

let _app = null;
export function openImportDialog() {
  if (!game.user?.isGM) return null;
  _app ??= new (appClass())();
  _app.render(true);
  return _app;
}
