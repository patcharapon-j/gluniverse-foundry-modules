/**
 * GLUniverse Suite — settings catalog.
 *
 * The suite presents every setting through its own grouped "Control Center"
 * (suite-config-app.mjs) instead of Foundry's flat native list. After all
 * features have registered their settings + menus, `buildCatalog()`:
 *
 *   1. Walks `game.settings.settings` for our package, records each *visible*
 *      (config:true) setting's metadata under its owning feature, then flips
 *      *every* suite setting to config:false so none ever show in Foundry's
 *      native Settings sheet. A setting whose key matches no feature's
 *      `settingPrefix` is still hidden, but logs a warning (it would otherwise
 *      be unreachable) — keep prefixes and `settingPrefix` in sync.
 *   2. Walks `game.settings.menus`, records each feature's specialized editor
 *      menus, then removes *every* suite menu from the native list (the Control
 *      Center surfaces them as "Open editor" buttons). The suite's own Feature
 *      Manager menu is left in place as the single native entry point.
 *
 * Nothing about the settings' behaviour changes — they remain registered and
 * fully readable/writable via `game.settings.get/set`; only their *presentation*
 * moves into the suite UI.
 */

import { SUITE_ID, warn } from "./const.mjs";
import { Suite } from "./registry.mjs";

/**
 * Routing is derived from the features themselves: every feature declares the
 * setting-key prefix(es) it owns via `settingPrefix` in its `Suite.register(...)`
 * definition (string or string[]). This keeps each module's configuration
 * *attributed to that module* — there is no second, hand-maintained list to keep
 * in sync, so a new feature can never silently leak its settings into Foundry's
 * native sheet.
 *
 * Rules are sorted longest-prefix-first so a promoted sub-feature (e.g. the
 * `ct.weather…` keys → `clocks-weather`) claims its keys before the parent
 * engine's catch-all prefix (`ct.` → `clocks-tracker`).
 */
function prefixesOf(def) {
  const v = def.settingPrefix;
  const list = v == null ? [] : Array.isArray(v) ? v : [v];
  return list.map((p) => String(p).toLowerCase()).filter(Boolean);
}

/** Built once, lazily, after every feature has registered. */
let _rules = null;

function buildRules() {
  const rules = [];
  for (const def of Suite.all()) {
    for (const prefix of prefixesOf(def)) rules.push([prefix, def.id]);
  }
  // Longest prefix wins so sub-feature prefixes resolve before the parent's.
  rules.sort((a, b) => b[0].length - a[0].length);
  return rules;
}

/** Map a raw setting/menu key to its owning feature id, or null (suite core). */
export function featureForKey(key) {
  if (!_rules) _rules = buildRules();
  const k = String(key).toLowerCase();
  for (const [prefix, fid] of _rules) if (k.startsWith(prefix)) return fid;
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
      if (fid) {
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
        // (no-control settings have their own specialized editor menu)
      } else {
        warn(
          `Setting "${cfg.key}" has no owning feature — hidden from the native ` +
            `sheet but not shown in the Control Center. Add its prefix to the ` +
            `owning feature's settingPrefix.`
        );
      }
      // Always hide every suite setting from Foundry's native Settings sheet so
      // the Control Center is the single configuration surface — nothing leaks.
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
    if (fid) {
      bucket(fid).menus.push({
        key: menu.key,
        name: menu.name ?? menu.label ?? menu.key,
        label: menu.label ?? menu.name ?? menu.key,
        hint: menu.hint ?? "",
        icon: menu.icon ?? "fa-solid fa-sliders",
        type: menu.type,
      });
    } else {
      warn(
        `Menu "${menu.key}" has no owning feature — removed from the native ` +
          `sheet but not shown in the Control Center. Add its prefix to the ` +
          `owning feature's settingPrefix.`
      );
    }
    // Always remove suite menus from the native list (the Control Center
    // surfaces them as "Open editor" buttons).
    menus.delete(fqKey);
  }

  return _catalog;
}

/** Catalog entry for one feature ({ settings, menus }), or empty. */
export function catalogFor(featureId) {
  return _catalog.get(featureId) ?? { settings: [], menus: [] };
}
