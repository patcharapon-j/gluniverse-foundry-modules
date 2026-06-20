/**
 * GLUniverse Suite — feature adapter: PF2e Stat Block Importer (statsblock-import).
 *
 * Wraps the ported standalone module (`gluniverse-pf2e-statsblock-import`) and
 * registers it with the suite registry. All settings/flags now live under the
 * `gluniverse-foundry-modules` id, key-prefixed with "sbi.".
 */

import { Suite } from "../../core/registry.mjs";
import { SUITE_ID } from "../../core/const.mjs";
import { registerSettings, onInit, onReady, api } from "./importer.js";

const OLD_ID = "gluniverse-pf2e-statsblock-import";

/**
 * Best-effort migration of document flags written by the standalone module.
 * The old module stored its flags under its own package id; the suite stores
 * them under `gluniverse-foundry-modules` with an "sbi." sub-key prefix. We move any
 * surviving old-scope flags on world actors (and their embedded items) across.
 * Guarded so a failure on one document never aborts the whole migration.
 */
async function migrateFlags() {
  if (!game.user?.isGM) return;
  const moveDocFlags = (doc) => {
    const old = doc.flags?.[OLD_ID];
    if (!old || typeof old !== "object") return null;
    const next = {};
    if ("sourceMarkdown" in old) next["sbi.sourceMarkdown"] = old.sourceMarkdown;
    if ("parsedData" in old) next["sbi.parsedData"] = old.parsedData;
    if ("imported" in old) next["sbi.imported"] = old.imported;
    if ("originalName" in old) next["sbi.originalName"] = old.originalName;
    if ("frequency" in old) next["sbi.frequency"] = old.frequency;
    return Object.keys(next).length ? next : null;
  };

  for (const actor of game.actors ?? []) {
    try {
      const actorFlags = moveDocFlags(actor);
      if (actorFlags) {
        await actor.update({
          flags: { [SUITE_ID]: foundry.utils.expandObject(actorFlags), [`-=${OLD_ID}`]: null }
        });
      }
      const itemUpdates = [];
      for (const item of actor.items ?? []) {
        const itemFlags = moveDocFlags(item);
        if (itemFlags) {
          itemUpdates.push({
            _id: item.id,
            flags: { [SUITE_ID]: foundry.utils.expandObject(itemFlags), [`-=${OLD_ID}`]: null }
          });
        }
      }
      if (itemUpdates.length) await actor.updateEmbeddedDocuments("Item", itemUpdates);
    } catch (e) {
      console.warn(`GLUniverse Suite | statsblock-import flag migration failed for ${actor?.name}:`, e);
    }
  }
}

Suite.register({
  id: "statsblock-import",
  title: "GLS.feature.statsblock-import.title",
  hint: "GLS.feature.statsblock-import.hint",
  icon: "fa-solid fa-file-import",
  system: "pf2e",
  requires: [],
  core: false,
  defaultEnabled: false,

  registerSettings() {
    registerSettings();
  },

  onInit() {
    onInit();
  },

  onReady() {
    onReady();
  },

  legacy: {
    id: OLD_ID,
    settings: {
      // standalone client setting -> suite prefixed key
      motionTier: "sbi.motionTier",
    },
    migrate: migrateFlags,
  },

  api,
});
