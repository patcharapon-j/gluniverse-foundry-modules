/**
 * PF2e Variant Rules — settings registration and reads.
 *
 * Every setting registered here begins with a prefix declared on the adapter
 * (or on one of its promoted sub-features), so the catalog routes it into the
 * right Control Center group. A setting whose key matches no declared prefix is
 * hidden from Foundry's native sheet *and* unreachable in the Control Center —
 * it would exist only in the database.
 *
 * The four `*.enabled` keys are `config: false` on purpose: the Control Center
 * feature toggle reads and writes them through the adapter's `enableGet` /
 * `enableSet`, so a second checkbox inside the group would be two controls
 * fighting over one boolean.
 */

import { SUITE_ID, warn } from "../../core/const.mjs";
import { DEFAULT_DENT_CONFIG, SETTINGS } from "./constants.mjs";
import { DentConfigApp } from "./dent-config.mjs";

/** Read a setting without throwing when it has not been registered yet. */
export function get(key, fallback = undefined) {
  try {
    return game.settings.get(SUITE_ID, key);
  } catch {
    return fallback;
  }
}

/** Write a setting, swallowing the failure a locked world can produce. */
export async function set(key, value) {
  try {
    return await game.settings.set(SUITE_ID, key, value);
  } catch (error) {
    warn(`pf2e-variant-rules | could not write ${key}`, error);
    return undefined;
  }
}

const bool = (key, dflt, extra = {}) => ({
  name: `GLVR.settings.${key.slice("vr.".length)}.name`,
  hint: `GLVR.settings.${key.slice("vr.".length)}.hint`,
  scope: "world",
  config: true,
  type: Boolean,
  default: dflt,
  ...extra,
});

export function registerSettings() {
  // ── Enable flags (hidden; the Control Center toggle owns these) ──────────
  for (const key of [
    SETTINGS.carefulEnabled,
    SETTINGS.chipEnabled,
    SETTINGS.dentsEnabled,
    SETTINGS.woundsEnabled,
    SETTINGS.bossEnabled,
  ]) {
    game.settings.register(SUITE_ID, key, {
      scope: "world",
      config: false,
      type: Boolean,
      default: false,
    });
  }

  // ── Careful Consumption ─────────────────────────────────────────────────
  game.settings.register(SUITE_ID, SETTINGS.carefulHealingOnly, bool(SETTINGS.carefulHealingOnly, false));

  // The permissive variant: a button on an already-rolled card that re-posts the
  // result at maximum. It is strictly better than the rule — a player only ever
  // presses it on a bad roll, which deletes the "is this worth a third action
  // when I don't know what I'd have rolled" decision the rule exists to create.
  // On regardless, because the chat card is the only surface a player reaches
  // mid-turn; the label says plainly that it is the permissive reading.
  game.settings.register(SUITE_ID, SETTINGS.carefulPostRoll, bool(SETTINGS.carefulPostRoll, true));

  // ── Chip Damage ─────────────────────────────────────────────────────────
  game.settings.register(SUITE_ID, SETTINGS.chipAutoApply, bool(SETTINGS.chipAutoApply, false));

  // pf2e-flatten never rewrites an actor's level — it applies an "all"-selector
  // custom modifier — so `actor.level` is already the true, un-flattened value
  // and this setting exists only for tables that want chip damage to shrink
  // along with everything else in a PWoL world.
  game.settings.register(SUITE_ID, SETTINGS.chipUseFlattened, bool(SETTINGS.chipUseFlattened, false));

  // ── Dents ───────────────────────────────────────────────────────────────
  game.settings.register(SUITE_ID, SETTINGS.dentsRepair, bool(SETTINGS.dentsRepair, true));

  // One object rather than a setting per material: twenty-two rows in the
  // Control Center, each needing its own i18n pair, for a table that most
  // worlds leave entirely at zero.
  game.settings.register(SUITE_ID, SETTINGS.dentsConfig, {
    name: `GLVR.settings.${SETTINGS.dentsConfig.slice("vr.".length)}.name`,
    hint: `GLVR.settings.${SETTINGS.dentsConfig.slice("vr.".length)}.hint`,
    scope: "world",
    config: false,
    type: Object,
    default: foundry.utils.deepClone(DEFAULT_DENT_CONFIG),
  });

  game.settings.registerMenu(SUITE_ID, "vr.dent.configMenu", {
    name: "GLVR.dentConfig.title",
    label: "GLVR.dentConfig.label",
    hint: "GLVR.dentConfig.hint",
    icon: "fa-solid fa-shield-halved",
    type: DentConfigApp(),
    restricted: true,
  });

  // ── Lasting Wounds ──────────────────────────────────────────────────────
  game.settings.register(SUITE_ID, SETTINGS.woundsBlockRest, bool(SETTINGS.woundsBlockRest, true));
  game.settings.register(SUITE_ID, SETTINGS.woundsMedicine, bool(SETTINGS.woundsMedicine, true));
  game.settings.register(SUITE_ID, SETTINGS.woundsHealing, bool(SETTINGS.woundsHealing, true));

  // ── Boss Creatures ──────────────────────────────────────────────────────
  // The three things a boss does *outside* its own sheet, each separable
  // because each lands on a different table's toes.
  //
  // The XP multiplier changes what the encounter-budget badge says, which a GM
  // who builds encounters by feel may not want moving under them.
  //
  // The incapacitation bump is the one part of the boss level that reaches a
  // roll, so a table that reads the +2/+4 as pure bookkeeping can switch it off
  // without giving up the rest of the rule.
  //
  // Extra turns write real Combatant documents into the encounter. That is the
  // only part of this feature another module can see, so it gets its own switch
  // for tables running a different initiative tracker.
  game.settings.register(SUITE_ID, SETTINGS.bossXp, bool(SETTINGS.bossXp, true));
  game.settings.register(SUITE_ID, SETTINGS.bossIncapacitation, bool(SETTINGS.bossIncapacitation, true));
  game.settings.register(SUITE_ID, SETTINGS.bossExtraTurns, bool(SETTINGS.bossExtraTurns, true));
}

/* ── Sub-feature enable state ─────────────────────────────────────────────
   Read at call time rather than captured at init, so flipping a rule in the
   Control Center takes effect on the very next chat card without a reload. */

export const carefulOn = () => !!get(SETTINGS.carefulEnabled, false);
export const chipOn = () => !!get(SETTINGS.chipEnabled, false);
export const dentsOn = () => !!get(SETTINGS.dentsEnabled, false);
export const woundsOn = () => !!get(SETTINGS.woundsEnabled, false);
export const bossOnSetting = () => !!get(SETTINGS.bossEnabled, false);
