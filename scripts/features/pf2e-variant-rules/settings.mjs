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
import { SETTINGS } from "./constants.mjs";

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

  // The permissive variant: a button on an already-rolled card that rewrites the
  // result to maximum. It is strictly better than the rule — a player only ever
  // presses it on a bad roll, which deletes the "is this worth a third action
  // when I don't know what I'd have rolled" decision the rule exists to create.
  // Off by default, and labelled as the permissive reading.
  game.settings.register(SUITE_ID, SETTINGS.carefulPostRoll, bool(SETTINGS.carefulPostRoll, false));

  // ── Chip Damage ─────────────────────────────────────────────────────────
  game.settings.register(SUITE_ID, SETTINGS.chipAutoApply, bool(SETTINGS.chipAutoApply, false));

  // pf2e-flatten never rewrites an actor's level — it applies an "all"-selector
  // custom modifier — so `actor.level` is already the true, un-flattened value
  // and this setting exists only for tables that want chip damage to shrink
  // along with everything else in a PWoL world.
  game.settings.register(SUITE_ID, SETTINGS.chipUseFlattened, bool(SETTINGS.chipUseFlattened, false));

  // ── Dents ───────────────────────────────────────────────────────────────
  game.settings.register(SUITE_ID, SETTINGS.dentsRepair, bool(SETTINGS.dentsRepair, true));

  // ── Lasting Wounds ──────────────────────────────────────────────────────
  game.settings.register(SUITE_ID, SETTINGS.woundsBlockRest, bool(SETTINGS.woundsBlockRest, true));
  game.settings.register(SUITE_ID, SETTINGS.woundsMedicine, bool(SETTINGS.woundsMedicine, true));
  game.settings.register(SUITE_ID, SETTINGS.woundsHealing, bool(SETTINGS.woundsHealing, true));
}

/* ── Sub-feature enable state ─────────────────────────────────────────────
   Read at call time rather than captured at init, so flipping a rule in the
   Control Center takes effect on the very next chat card without a reload. */

export const carefulOn = () => !!get(SETTINGS.carefulEnabled, false);
export const chipOn = () => !!get(SETTINGS.chipEnabled, false);
export const dentsOn = () => !!get(SETTINGS.dentsEnabled, false);
export const woundsOn = () => !!get(SETTINGS.woundsEnabled, false);
