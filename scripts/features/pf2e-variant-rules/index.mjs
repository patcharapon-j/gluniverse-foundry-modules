/**
 * PF2e Variant Rules — suite adapter.
 *
 * Five optional rules from *Adventures+* pp. 45–55, each a promoted sub-feature
 * with its own Control Center toggle, gated on this parent via
 * `requiresFeature`. The parent owns all the wiring; the children own nothing
 * but their enable state, which every handler re-reads at call time so flipping
 * a rule takes effect on the next chat card rather than the next reload.
 *
 * A fifth rule from that section, **Belts**, deliberately ships no code. A PF2e
 * container with `system.stowing = false` already holds four items at full Bulk,
 * and the free-action draw is a table agreement — automating it would add a
 * feature whose only job is to restate something the system already models.
 */

import { Suite } from "../../core/registry.mjs";
import { SUITE_ID } from "../../core/const.mjs";
import { FEATURE_ID, PREFIX, RULES, SETTINGS } from "./constants.mjs";
import { registerSettings } from "./settings.mjs";
import { pf2eReady } from "./pf2e.mjs";
import { registerChip } from "./chip.mjs";
import { registerDents } from "./dents.mjs";
import { registerCareful } from "./careful.mjs";
import { registerWounds, readyWounds, syncActor } from "./wounds.mjs";
import { registerBoss, readyBoss } from "./boss/index.mjs";

/** Back a sub-feature's toggle on the world setting the rule itself reads. */
function settingBacked(key) {
  return {
    enableGet: () => {
      try {
        return !!game.settings.get(SUITE_ID, key);
      } catch {
        return false;
      }
    },
    enableSet: async (on) => game.settings.set(SUITE_ID, key, !!on),
  };
}

function onInit() {
  registerChip();
  registerDents();
  registerCareful();
  registerWounds();
  registerBoss();
}

async function onReady() {
  if (!pf2eReady()) return;
  readyWounds();
  await readyBoss();

  // Bring existing actors in line once at startup: a world that enabled the rule
  // between sessions has wounded creatures carrying no healing modifier yet.
  if (game.user.isGM && game.users?.activeGM === game.user) {
    for (const actor of game.actors ?? []) {
      try {
        await syncActor(actor);
      } catch {
        /* one unwritable actor must not stop the rest */
      }
    }
  }
}

Suite.register({
  id: FEATURE_ID,
  title: "GLS.feature.pf2e-variant-rules.title",
  hint: "GLS.feature.pf2e-variant-rules.hint",
  icon: "fa-solid fa-scale-balanced",
  settingPrefix: PREFIX,
  system: "pf2e",
  requires: [],
  core: false,
  defaultEnabled: false,
  registerSettings,
  onInit,
  onReady,
  api: null,
});

/*
 * The five rules, registered after the parent so they group beneath it in the
 * Control Center. Each claims a prefix strictly longer than the parent's `vr.`
 * catch-all — the catalog sorts routing rules longest-first, so a child takes
 * its own keys before the parent's prefix can swallow them.
 */

Suite.register({
  id: RULES.careful.id,
  title: "GLS.feature.vr-careful-consumption.title",
  hint: "GLS.feature.vr-careful-consumption.hint",
  icon: RULES.careful.icon,
  settingPrefix: RULES.careful.prefix,
  system: "pf2e",
  requiresFeature: FEATURE_ID,
  defaultEnabled: false,
  ...settingBacked(SETTINGS.carefulEnabled),
});

Suite.register({
  id: RULES.chip.id,
  title: "GLS.feature.vr-chip-damage.title",
  hint: "GLS.feature.vr-chip-damage.hint",
  icon: RULES.chip.icon,
  settingPrefix: RULES.chip.prefix,
  system: "pf2e",
  requiresFeature: FEATURE_ID,
  defaultEnabled: false,
  ...settingBacked(SETTINGS.chipEnabled),
});

Suite.register({
  id: RULES.dents.id,
  title: "GLS.feature.vr-dents.title",
  hint: "GLS.feature.vr-dents.hint",
  icon: RULES.dents.icon,
  settingPrefix: RULES.dents.prefix,
  system: "pf2e",
  requiresFeature: FEATURE_ID,
  defaultEnabled: false,
  ...settingBacked(SETTINGS.dentsEnabled),
});

Suite.register({
  id: RULES.boss.id,
  title: "GLS.feature.vr-boss-creatures.title",
  hint: "GLS.feature.vr-boss-creatures.hint",
  icon: RULES.boss.icon,
  settingPrefix: RULES.boss.prefix,
  system: "pf2e",
  requiresFeature: FEATURE_ID,
  defaultEnabled: false,
  ...settingBacked(SETTINGS.bossEnabled),
});

Suite.register({
  id: RULES.wounds.id,
  title: "GLS.feature.vr-lasting-wounds.title",
  hint: "GLS.feature.vr-lasting-wounds.hint",
  icon: RULES.wounds.icon,
  settingPrefix: RULES.wounds.prefix,
  system: "pf2e",
  requiresFeature: FEATURE_ID,
  defaultEnabled: false,
  ...settingBacked(SETTINGS.woundsEnabled),
});
