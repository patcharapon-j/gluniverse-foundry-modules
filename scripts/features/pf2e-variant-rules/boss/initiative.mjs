/**
 * Boss Creatures — extra turns in initiative.
 *
 * "All bosses gain additional turns, allowing them to act multiple times in the
 * same round." A Greater boss takes 2, a Supreme 3.
 *
 * The suite's initiative rail has two modes and they need completely different
 * treatment, which is the whole reason this file exists:
 *
 *   • **Card mode** already models a multi-turn actor. `buildCardSequence` reads
 *     a per-actor `init.cardConfig` of `{ cards, turns }` and gives that actor
 *     `turns` slots in the shuffled deal. So all a boss has to do there is write
 *     its turn count into that flag and get out of the way.
 *
 *   • **Standard mode** has no such thing. Nothing in the suite wraps
 *     `Combat#setupTurns`, subclasses `Combatant`, or ever mutates
 *     `combat.turns`; the rail reads Foundry's own turn order and hands turn
 *     advancement straight back to `combat.nextTurn()`. The only way to give a
 *     creature a second turn without patching the system out from under every
 *     other module is to put a second *entry* in the order — which is exactly
 *     what the rail's own ad hoc combatants already do.
 *
 * So in standard mode a boss gets N−1 extra real Combatant documents pointing at
 * the same actor and token, each flagged as that boss's Nth turn. Foundry sorts
 * them, walks them, and every other module that reads the tracker sees a
 * perfectly ordinary turn order. Nothing is patched.
 *
 * The two paths must never both run: a boss with extra combatants *and* a
 * cardConfig of 3 would be dealt three cards per extra entry and take nine turns
 * a round, which looks like the rail is broken rather than like a rule is wrong.
 */

import { SUITE_ID, warn } from "../../../core/const.mjs";
import { SETTINGS } from "../constants.mjs";
import { get } from "../settings.mjs";
import { BOSS_FLAGS } from "./constants.mjs";
import { bossTurns, turnOffsets } from "./rules.mjs";
import { bossProfile } from "./profile.mjs";
import { advanceTurn, resetState } from "./downfall.mjs";

/** The initiative feature's own keys. Read, never written except cardConfig. */
const INIT_MODE_SETTING = "init.initiativeMode";
const INIT_CARD_CONFIG = "init.cardConfig";

/** True when the rail is running its card deal rather than Foundry's order. */
export function cardMode() {
  try {
    return game.settings.get(SUITE_ID, INIT_MODE_SETTING) === "card";
  } catch {
    return false;
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   PLACEMENT — pure, so the check tool can assert on it
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Work out what initiative each of a boss's extra turns should take.
 *
 * `order` is the round's entries, highest initiative first, as
 * `[{ id, initiative, boss }]` — `boss` marking every entry belonging to *this*
 * boss, which must not be counted as a turn that has passed.
 *
 * Walks down from the boss's own entry counting other creatures' turns, and
 * places an extra turn immediately after the offset-th of them. Two rules the
 * book states outright shape the edges:
 *
 *   • "A boss should never be able to take multiple turns in succession" — an
 *     offset can never resolve to the slot directly after the boss's own.
 *   • The extra turns belong to the same round, so an offset that runs past the
 *     end of the order lands at the bottom rather than wrapping above the boss's
 *     own initiative, where it would act *before* the turn it comes after.
 *
 * @returns {number[]} one initiative value per extra turn, in turn order
 */
export function planTurns(order, bossId, offsets) {
  const rows = Array.isArray(order) ? order.filter((row) => Number.isFinite(Number(row?.initiative))) : [];
  const index = rows.findIndex((row) => row.id === bossId);
  if (index < 0 || !offsets?.length) return [];

  // Everything below the boss that is not the boss: the turns that "pass".
  const below = rows.slice(index + 1).filter((row) => !row.boss);
  const bossInitiative = Number(rows[index].initiative);

  const taken = [];
  return offsets.map((offset) => {
    const gap = Math.max(1, Math.trunc(Number(offset) || 1));
    // The entry the extra turn comes after, clamped to the last one available.
    const anchorIndex = Math.min(gap, below.length) - 1;
    const after = anchorIndex >= 0 ? Number(below[anchorIndex].initiative) : bossInitiative;
    const beforeRow = below[anchorIndex + 1];
    const before = beforeRow ? Number(beforeRow.initiative) : null;

    let value = before === null ? after - 0.5 : (after + before) / 2;
    // Never above the boss's own entry, and never colliding with a value we
    // already handed out — two extra turns on the same number sort arbitrarily.
    if (value >= bossInitiative) value = bossInitiative - 0.01;
    while (taken.includes(value)) value -= 0.01;
    taken.push(value);
    return Math.round(value * 100) / 100;
  });
}

/* ══════════════════════════════════════════════════════════════════════════
   THE FOUNDRY SIDE
   ══════════════════════════════════════════════════════════════════════════ */

/** The boss-turn marker on an extra combatant, or null on an ordinary one. */
export function turnMarker(combatant) {
  const raw = combatant?.getFlag?.(SUITE_ID, BOSS_FLAGS.turn);
  if (!raw || typeof raw !== "object") return null;
  return {
    owner: String(raw.owner ?? ""),
    index: Math.max(1, Math.trunc(Number(raw.index) || 1)),
    of: Math.max(1, Math.trunc(Number(raw.of) || 1)),
  };
}

/** Is this an extra turn we created? */
export const isExtraTurn = (combatant) => turnMarker(combatant) !== null;

/** The combatant that owns a boss's turns: itself, or the entry it belongs to. */
export function primaryOf(combat, combatant) {
  const marker = turnMarker(combatant);
  if (!marker) return combatant;
  return combat?.combatants?.get?.(marker.owner) ?? null;
}

/** Every extra entry belonging to one boss combatant. */
function extrasFor(combat, combatantId) {
  return Array.from(combat?.combatants ?? [])
    .map((entry) => (Array.isArray(entry) ? entry[1] : entry))
    .filter((entry) => turnMarker(entry)?.owner === combatantId);
}

/** How many PCs are in this encounter, for the rotation maths. */
function partySize(combat) {
  const pcs = Array.from(combat?.combatants ?? [])
    .map((entry) => (Array.isArray(entry) ? entry[1] : entry))
    .filter((entry) => entry?.actor?.type === "character");
  return Math.max(1, pcs.length || 4);
}

/**
 * Bring one boss's extra turns in line with its tier and the current order.
 *
 * Idempotent by construction: it works out the full set it wants, deletes every
 * extra it did not want, and creates the ones missing. Called on every event
 * that could move the order, so it has to be safe to run repeatedly.
 */
export async function syncBossTurns(combat, combatant) {
  if (!combat || !combatant) return;
  if (!game.user?.isGM || game.users?.activeGM !== game.user) return;

  const profile = bossProfile(combatant.actor);
  const existing = extrasFor(combat, combatant.id);

  // In card mode the deal owns multi-turn, so every extra entry has to go — and
  // so does a table that switched extra turns off, which must leave the
  // encounter exactly as it found it rather than merely stopping.
  const allowed = profile && get(SETTINGS.bossExtraTurns, true) && !cardMode();
  const wanted = allowed ? bossTurns(profile.tier) - 1 : 0;

  if (!wanted) {
    if (existing.length) {
      await combat.deleteEmbeddedDocuments("Combatant", existing.map((entry) => entry.id));
    }
    return;
  }

  const initiative = Number(combatant.initiative);
  // Nothing to place around until the boss has actually rolled.
  if (!Number.isFinite(initiative)) return;

  const order = Array.from(combat.combatants)
    .map((entry) => (Array.isArray(entry) ? entry[1] : entry))
    .filter((entry) => Number.isFinite(Number(entry.initiative)))
    .sort((a, b) => Number(b.initiative) - Number(a.initiative))
    .map((entry) => ({
      id: entry.id,
      initiative: Number(entry.initiative),
      boss: entry.id === combatant.id || turnMarker(entry)?.owner === combatant.id,
    }));

  const values = planTurns(order, combatant.id, turnOffsets(profile.tier, partySize(combat)));
  if (values.length !== wanted) return;

  // Reuse what is there, by index, so an extra turn keeps its document id and
  // the rail's animation does not treat every re-sync as a card being dealt.
  const byIndex = new Map(existing.map((entry) => [turnMarker(entry).index, entry]));

  const creates = [];
  const updates = [];
  for (let i = 0; i < wanted; i++) {
    const index = i + 2; // the boss's initial turn is 1
    const value = values[i];
    const current = byIndex.get(index);
    if (current) {
      byIndex.delete(index);
      if (Number(current.initiative) !== value) updates.push({ _id: current.id, initiative: value });
      continue;
    }
    creates.push({
      actorId: combatant.actorId,
      tokenId: combatant.tokenId,
      sceneId: combatant.sceneId,
      hidden: combatant.hidden,
      initiative: value,
      flags: {
        [SUITE_ID]: {
          [BOSS_FLAGS.turn]: { owner: combatant.id, index, of: wanted + 1 },
        },
      },
    });
  }

  const doomed = Array.from(byIndex.values()).map((entry) => entry.id);
  try {
    if (doomed.length) await combat.deleteEmbeddedDocuments("Combatant", doomed);
    if (updates.length) await combat.updateEmbeddedDocuments("Combatant", updates);
    if (creates.length) await combat.createEmbeddedDocuments("Combatant", creates);
  } catch (error) {
    warn("pf2e-variant-rules | could not sync boss turns", error);
  }
}

/** Bring every boss in this encounter in line. */
export async function syncEncounter(combat) {
  if (!combat) return;
  for (const entry of Array.from(combat.combatants)) {
    const combatant = Array.isArray(entry) ? entry[1] : entry;
    if (isExtraTurn(combatant)) continue;
    if (!bossProfile(combatant?.actor)) continue;
    await syncBossTurns(combat, combatant);
  }
}

/**
 * Keep the per-actor card config honest.
 *
 * Written when a boss is marked or its tier changes, and reset to 1 when it is
 * unmarked, so a world that switches the rail to card mode later already has the
 * right turn count without the GM having to find the deck dialog.
 */
export async function syncCardConfig(actor, turns) {
  if (!actor?.setFlag) return;
  const count = Math.max(1, Math.trunc(Number(turns) || 1));
  const current = actor.getFlag(SUITE_ID, INIT_CARD_CONFIG) ?? {};
  if (Number(current.turns) === count) return;
  try {
    await actor.setFlag(SUITE_ID, INIT_CARD_CONFIG, { ...current, turns: count });
  } catch (error) {
    warn("pf2e-variant-rules | could not write the card turn count", error);
  }
}

/* ── The clock ───────────────────────────────────────────────────────────── */

/**
 * Advance a boss's own counters when its turn comes up.
 *
 * "When a boss rolls initiative, the initiative determines the boss's initial
 * turn of the round." — so the primary entry is the initial turn and every extra
 * entry is not, which is the distinction the Downfall clock is built on.
 */
export async function onTurnChanged(combat) {
  if (!game.user?.isGM || game.users?.activeGM !== game.user) return;
  const combatant = combat?.combatant;
  if (!combatant) return;

  const marker = turnMarker(combatant);
  const primary = marker ? primaryOf(combat, combatant) : combatant;
  if (!primary || !bossProfile(primary.actor)) return;

  await advanceTurn(primary, { initial: !marker });
}

/** Tear down a boss's extra entries and state when it leaves the encounter. */
export async function onCombatantRemoved(combat, combatant) {
  if (!game.user?.isGM || game.users?.activeGM !== game.user) return;
  if (isExtraTurn(combatant)) return;

  const extras = extrasFor(combat, combatant.id);
  if (extras.length) {
    try {
      await combat.deleteEmbeddedDocuments("Combatant", extras.map((entry) => entry.id));
    } catch {
      /* the encounter may already be gone */
    }
  }
  await resetState(combatant);
}
