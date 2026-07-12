/**
 * GLUniverse Suite — Tidy 5e Inventory Slots feature adapter.
 *
 * Ported from the standalone `gluniverse-tidy-5e-inventory-slots` module. The
 * registry owns the Foundry lifecycle: settings are always registered (so the
 * toggles exist), while onInit/onReady run only when the feature is enabled and
 * the dnd5e system + tidy5e-sheet module are present.
 */

import { Suite } from "../../core/registry.mjs";
import { SUITE_ID } from "../../core/const.mjs";
import { registerSettings } from "./settings.js";

let runtimePromise = null;
const loadRuntime = () => runtimePromise ??= import("./module.js");

const OLD_ID = "gluniverse-tidy-5e-inventory-slots";
const KEY_PREFIX = "tidy.";

// Every document flag the standalone module wrote. Migrated to the suite scope
// with the "tidy." key prefix so per-feature isolation is preserved.
const ACTOR_FLAGS = ["maxSlotsOverride", "sizeOverride"];
const ITEM_FLAGS = [
  "notches", "peakNotches", "maxNotchesOverride", "fragility", "temper",
  "isArcaneFocus", "bulkCategory", "bulkOverride", "objectScale",
  "containerSlotsOverride", "magicContainerSlots", "isBasicSupply", "quickdraw",
  "pairedAmmoId", "isAmmoDice", "ammoTrackIndividual", "ammoDie", "ammoMaxDie",
  "hasDicePool", "poolSize", "poolMaxSize", "poolDieType", "poolDiscardThreshold",
];

/** Move a document's old-scope flags to the suite scope, prefixed. Best-effort. */
async function migrateDocFlags(doc, keys) {
  const oldFlags = doc?.flags?.[OLD_ID];
  if (!oldFlags) return;
  const update = {};
  for (const key of keys) {
    if (!(key in oldFlags)) continue;
    const value = oldFlags[key];
    if (value === undefined) continue;
    update[`flags.${SUITE_ID}.${KEY_PREFIX}${key}`] = value;
  }
  if (Object.keys(update).length === 0) return;
  try {
    await doc.update(update);
  } catch {
    /* best-effort: skip documents we cannot update */
  }
}

Suite.register({
  id: "tidy5e-slots",
  title: "GLS.feature.tidy5e-slots.title",
  hint: "GLS.feature.tidy5e-slots.hint",
  icon: "fa-solid fa-box-archive",
  settingPrefix: "tidy.",
  system: "dnd5e",
  requires: ["tidy5e-sheet"],
  core: false,
  defaultEnabled: false,

  registerSettings() {
    registerSettings();
  },

  async onInit() {
    const runtime = await loadRuntime();
    this.api = runtime.api;
    runtime.onInit();
  },

  async onReady() {
    const runtime = await loadRuntime();
    runtime.onReady();
  },

  legacy: {
    id: OLD_ID,
    settings: {
      enableSlotSystem: "tidy.enableSlotSystem",
      enableForNPCs: "tidy.enableForNPCs",
      enableQuickdraw: "tidy.enableQuickdraw",
      quickdrawSlots: "tidy.quickdrawSlots",
      enablePackEndurance: "tidy.enablePackEndurance",
      enableObjectScaling: "tidy.enableObjectScaling",
      enableEncumbranceEffects: "tidy.enableEncumbranceEffects",
      enableContainerRules: "tidy.enableContainerRules",
      enableBasicSupplies: "tidy.enableBasicSupplies",
      enableArmorSlotCost: "tidy.enableArmorSlotCost",
      autoBulkFromWeight: "tidy.autoBulkFromWeight",
      showBulkColumn: "tidy.showBulkColumn",
      replaceEncumbranceBar: "tidy.replaceEncumbranceBar",
      enableWearAndTear: "tidy.enableWearAndTear",
      enableTempering: "tidy.enableTempering",
      autoNotchOnCrit: "tidy.autoNotchOnCrit",
      enableAmmunitionDice: "tidy.enableAmmunitionDice",
      autoRollAmmoDice: "tidy.autoRollAmmoDice",
      enableDicePool: "tidy.enableDicePool",
    },
    // Move actor + embedded-item flags from the old module scope to the suite
    // scope (with the "tidy." prefix). Guarded so a failure on one document
    // never aborts the rest of the migration.
    migrate: async () => {
      for (const actor of game.actors ?? []) {
        await migrateDocFlags(actor, ACTOR_FLAGS);
        for (const item of actor.items ?? []) {
          await migrateDocFlags(item, ITEM_FLAGS);
        }
      }
      for (const item of game.items ?? []) {
        await migrateDocFlags(item, ITEM_FLAGS);
      }
    },
  },

  api: null,
});
