/**
 * GLUniverse Suite — one-time data migration from the standalone modules.
 *
 * When a world previously used the separate modules, their settings live in
 * Foundry storage under the *old* package ids (e.g. "pf2e-flatfinder.foo").
 * Those namespaces are no longer registered, so we read them straight from
 * storage and re-register them under `gluniverse-foundry-modules` using each feature's
 * declared key mapping. Document flags (actors / chat messages) are handled by
 * an optional per-feature `legacyMigrate()` hook.
 *
 * Each feature opts in via a `legacy` descriptor on its definition:
 *   legacy: {
 *     id: "old-module-id",
 *     // map raw old setting key -> new (already-prefixed) suite key
 *     settings: { "weatherEnabled": "ct.weatherEnabled", ... },
 *     // optional: async (ctx) => { ... } for flags / custom data
 *     migrate: async (ctx) => {}
 *   }
 */

import { SUITE_ID, SETTING_MIGRATION, log, warn } from "./const.mjs";
import { Suite } from "./registry.mjs";

const MIGRATION_VERSION = 1;

/** Read a raw world setting value (parsed) for an arbitrary namespace.key. */
function readWorldSetting(namespace, key) {
  const full = `${namespace}.${key}`;
  const store = game.settings.storage.get("world");
  const doc = store?.find?.((s) => s.key === full) ?? store?.getName?.(full);
  if (!doc) return undefined;
  try {
    return JSON.parse(doc.value);
  } catch {
    return doc.value;
  }
}

/** Read a raw client (localStorage) setting value for an arbitrary key. */
function readClientSetting(namespace, key) {
  const raw = game.settings.storage.get("client")?.getItem?.(`${namespace}.${key}`);
  if (raw == null) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/** Whether a (registered) suite setting still holds its default value. */
function isUnset(suiteKey) {
  try {
    const cfg = game.settings.settings.get(`${SUITE_ID}.${suiteKey}`);
    if (!cfg) return false;
    const current = game.settings.get(SUITE_ID, suiteKey);
    return JSON.stringify(current) === JSON.stringify(cfg.default ?? undefined);
  } catch {
    return false;
  }
}

export async function runMigrations() {
  if (!game.user.isGM) return;
  const done = game.settings.get(SUITE_ID, SETTING_MIGRATION) ?? {};
  if (done.version >= MIGRATION_VERSION) return;

  let migratedAny = false;

  for (const def of Suite.all()) {
    const legacy = def.legacy;
    if (!legacy?.id) continue;
    if (done[def.id]) continue;

    try {
      // 1) Settings remap (world + client).
      for (const [oldKey, newKey] of Object.entries(legacy.settings ?? {})) {
        const cfg = game.settings.settings.get(`${SUITE_ID}.${newKey}`);
        if (!cfg) continue;
        const scope = cfg.scope ?? "world";
        const val =
          scope === "client"
            ? readClientSetting(legacy.id, oldKey)
            : readWorldSetting(legacy.id, oldKey);
        if (val === undefined) continue;
        if (!isUnset(newKey)) continue; // never clobber a value the GM already set
        await game.settings.set(SUITE_ID, newKey, val);
        migratedAny = true;
      }

      // 2) Custom (flags / documents).
      if (typeof legacy.migrate === "function") {
        await legacy.migrate.call(def, { SUITE_ID, readWorldSetting, readClientSetting });
        migratedAny = true;
      }
    } catch (e) {
      warn(`Migration for "${def.id}" (from ${legacy.id}) failed:`, e);
    }
  }

  await game.settings.set(SUITE_ID, SETTING_MIGRATION, {
    ...done,
    version: MIGRATION_VERSION,
  });
  if (migratedAny) {
    log("Imported configuration from previously-installed standalone modules.");
    ui.notifications?.info(
      game.i18n.localize("GLS.migration.done") ||
        "GLUniverse Suite: imported settings from your previous standalone modules."
    );
  }
}
