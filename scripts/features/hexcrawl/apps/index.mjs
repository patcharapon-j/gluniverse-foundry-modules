/**
 * Hexcrawl — GM apps, public surface.
 *
 * Importable without Foundry: every ApplicationV2 class is built lazily in a
 * memoised factory, and the runtime store is loaded with a dynamic import the
 * first time an app opens. Every opener is therefore async.
 *
 *   openPalette() / closePalette() / togglePalette()
 *   openHexEditor(key)            — right-click a hex
 *   openRegionEditor(id | null)   — null creates a region, then edits it
 *   openSceneSettings()
 *   openTerrainManager()
 *   pickIcon({ icon, img })       → Promise<{ icon, img } | null>
 *   terrainLabel(map, id)         — localized built-in name, or the custom name
 *   registerAppTemplates()        — optional preload of every app template
 */

import { APP_TEMPLATES, loadStore } from "./shared.mjs";
import * as palette from "./palette.mjs";
import * as hexEditor from "./hex-editor.mjs";
import * as regionEditor from "./region-editor.mjs";
import * as sceneSettings from "./scene-settings.mjs";
import * as terrainManager from "./terrain-manager.mjs";
import * as iconPicker from "./icon-picker.mjs";

export { terrainLabel, APP_TEMPLATES } from "./shared.mjs";

export async function openPalette() { await loadStore(); return palette.openPalette(); }
export async function closePalette() { await loadStore(); return palette.closePalette(); }
export async function togglePalette() { await loadStore(); return palette.togglePalette(); }
export async function openHexEditor(key) { await loadStore(); return hexEditor.openHexEditor(key); }
export async function openRegionEditor(id = null) { await loadStore(); return regionEditor.openRegionEditor(id); }
export async function openSceneSettings() { await loadStore(); return sceneSettings.openSceneSettings(); }
export async function openTerrainManager() { await loadStore(); return terrainManager.openTerrainManager(); }
export async function pickIcon(current = {}) { return iconPicker.pickIcon(current ?? {}); }

/** Preload every app template (optional — the mixin loads on first render too). */
export async function registerAppTemplates() {
  const load = globalThis.foundry?.applications?.handlebars?.loadTemplates ?? globalThis.loadTemplates;
  if (typeof load === "function") await load(APP_TEMPLATES);
}
