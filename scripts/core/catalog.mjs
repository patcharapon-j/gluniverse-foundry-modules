/**
 * GLUniverse Suite — settings catalog.
 *
 * The suite presents every setting through its own grouped "Control Center"
 * (suite-config-app.mjs) instead of Foundry's flat native list. After all
 * features have registered their settings + menus, `buildCatalog()`:
 *
 *   1. Walks `game.settings.settings` for our package, records each *visible*
 *      (config:true) setting's metadata under its owning feature, then flips it
 *      to config:false so it no longer shows in Foundry's native Settings sheet.
 *   2. Walks `game.settings.menus`, records each feature's specialized editor
 *      menus, then removes them from the native menu list (the Control Center
 *      surfaces them as "Open editor" buttons). The suite's own Feature Manager
 *      menu is left in place as the single native entry point.
 *
 * Nothing about the settings' behaviour changes — they remain registered and
 * fully readable/writable via `game.settings.get/set`; only their *presentation*
 * moves into the suite UI.
 */

import { SUITE_ID } from "./const.mjs";

/** Ordered prefix → feature-id rules. Longest / most specific first so the
 *  promoted clocks-tracker sub-features claim their keys before the core. */
const KEY_RULES = [
  [/^ct\.weather/i, "clocks-weather"],
  [/^ct\.support/i, "clocks-support"],
  [/^ct\.delving/i, "clocks-delving"],
  [/^ct\.(tracker|sheetTrackers)/i, "clocks-trackers"],
  [/^ct\./i, "clocks-tracker"],
  [/^init\./i, "initiative"],
  [/^ff\./i, "flatfinder"],
  [/^dd\./i, "destiny-dice"],
  [/^insight\./i, "insight"],
  [/^stage\./i, "stage"],
  [/^sp\./i, "stream-pacer"],
  [/^sbi\./i, "statsblock-import"],
  [/^lg\./i, "loot-gen"],
  [/^cargo\./i, "cargo-grid"],
  [/^tidy\./i, "tidy5e-slots"],
  [/^flatten\./i, "pf2e-flatten"],
  [/^crit\./i, "critical"],
];

/** Map a raw setting/menu key to its owning feature id, or null (suite core). */
export function featureForKey(key) {
  for (const [re, fid] of KEY_RULES) if (re.test(key)) return fid;
  return null;
}

/** featureId → { settings: [...], menus: [...] } */
const _catalog = new Map();

function bucket(fid) {
  if (!_catalog.has(fid)) _catalog.set(fid, { settings: [], menus: [] });
  return _catalog.get(fid);
}

/** Classify a setting's editor control from its registration data. */
function controlOf(cfg) {
  if (cfg.choices && typeof cfg.choices === "object") return "select";
  const t = cfg.type;
  if (t === Boolean) return "boolean";
  if (t === Number) return cfg.range ? "range" : "number";
  if (t === String) return "text";
  return null; // Object/Array/DataField → edited via a specialized editor, not inline
}

/**
 * Build the catalog and hide suite settings/menus from the native UI. Idempotent
 * within a session (guarded by a flag) so repeated calls are safe.
 */
export function buildCatalog() {
  if (buildCatalog._done) return _catalog;
  buildCatalog._done = true;

  for (const [, cfg] of game.settings.settings) {
    try {
      if (cfg.namespace !== SUITE_ID) continue;
      if (cfg.config !== true) continue;
      const fid = featureForKey(cfg.key);
      if (!fid) continue;
      const control = controlOf(cfg);
      if (control) {
        bucket(fid).settings.push({
          key: cfg.key,
          name: cfg.name ?? cfg.key,
          hint: cfg.hint ?? "",
          scope: cfg.scope ?? "world",
          control,
          choices: cfg.choices ?? null,
          range: cfg.range ?? null,
        });
      }
      // Hide from Foundry's native Settings sheet either way (no-control
      // settings have their own specialized editor).
      cfg.config = false;
    } catch {
      /* be resilient to any one setting's odd registration shape */
    }
  }

  const menus = game.settings.menus;
  for (const [fqKey, menu] of [...menus]) {
    if (menu.namespace !== SUITE_ID) continue;
    if (menu.key === "featureManager") continue; // the suite's single native entry
    const fid = featureForKey(menu.key);
    if (!fid) continue;
    bucket(fid).menus.push({
      key: menu.key,
      name: menu.name ?? menu.label ?? menu.key,
      label: menu.label ?? menu.name ?? menu.key,
      hint: menu.hint ?? "",
      icon: menu.icon ?? "fa-solid fa-sliders",
      type: menu.type,
    });
    menus.delete(fqKey); // hide from the native menu list
  }

  return _catalog;
}

/** Catalog entry for one feature ({ settings, menus }), or empty. */
export function catalogFor(featureId) {
  return _catalog.get(featureId) ?? { settings: [], menus: [] };
}
