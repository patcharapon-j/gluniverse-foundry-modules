/**
 * Boss Creatures — the hook wiring.
 *
 * Nothing here runs at import time. `registerBoss()` is called from the parent
 * adapter's `onInit`, and every handler re-reads the enable flag through
 * `bossProfile`, so switching the rule off in the Control Center takes effect on
 * the next event rather than the next reload.
 */

import { registerBossSheet } from "./sheet.mjs";
import { bossProfile } from "./profile.mjs";
import { refreshAbilityText } from "./apply.mjs";
import { onCombatantRemoved, onTurnChanged, syncBossTurns, syncEncounter } from "./initiative.mjs";
import { resetState, syncPenalty } from "./downfall.mjs";

/** Only the one acting GM writes; every client receives these hooks. */
const acting = () => game.user?.isGM && game.users?.activeGM === game.user;

const primaryOwner = (combatant) => combatant?.actor && bossProfile(combatant.actor);

export function registerBoss() {
  registerBossSheet();

  // Placing the extra turns needs the order to exist, so every event that can
  // move it re-syncs. `syncBossTurns` is idempotent, which is what makes that
  // safe rather than a source of duplicate entries.
  Hooks.on("combatStart", (combat) => acting() && syncEncounter(combat));
  Hooks.on("createCombatant", (combatant) => {
    if (!acting() || !primaryOwner(combatant)) return;
    syncBossTurns(combatant.parent, combatant);
  });
  Hooks.on("updateCombatant", (combatant, changed) => {
    if (!acting()) return;
    // Only an initiative change can move where the extra turns belong.
    if (!("initiative" in (changed ?? {}))) return;
    if (!primaryOwner(combatant)) return;
    syncBossTurns(combatant.parent, combatant);
  });
  Hooks.on("deleteCombatant", (combatant) => {
    if (!acting()) return;
    onCombatantRemoved(combatant.parent, combatant);
  });

  Hooks.on("updateCombat", (combat, changed) => {
    if (!acting()) return;
    if (!("turn" in (changed ?? {})) && !("round" in (changed ?? {}))) return;
    onTurnChanged(combat);
  });

  // A boss that leaves an encounter must not keep the Downfall penalty: it is a
  // custom modifier on the actor, so it would follow the creature into the next
  // fight and quietly cost it up to 3 AC there.
  Hooks.on("deleteCombat", async (combat) => {
    if (!acting()) return;
    for (const entry of combat.combatants) {
      const combatant = Array.isArray(entry) ? entry[1] : entry;
      if (!primaryOwner(combatant)) continue;
      await resetState(combatant);
    }
  });

  // A Boss DC is derived from the base creature's level and from the world's
  // Proficiency-without-Level offset. Both can change under a boss that already
  // has its abilities written out, and a description holding the old DC is a
  // number the GM reads aloud without checking.
  Hooks.on("updateActor", (actor, changed) => {
    if (!acting() || !bossProfile(actor)) return;
    const level = changed?.system?.details?.level?.value;
    const modifiers = changed?.system?.customModifiers;
    if (level === undefined && modifiers === undefined) return;
    refreshAbilityText(actor);
  });
}

/** Called from the parent adapter's `onReady`. */
export async function readyBoss() {
  if (!acting()) return;
  // A world that enabled the rule between sessions can be mid-encounter with a
  // boss that has no extra entries yet.
  if (game.combat) await syncEncounter(game.combat);
}

export { syncPenalty };
