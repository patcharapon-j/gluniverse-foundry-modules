/**
 * Rolling initiative through PF2e itself — on the GM's client.
 *
 * PF2e's initiative is an `ActorInitiative`: a Statistic built from the chosen
 * skill (or Perception) and EXTENDED with the `initiative` domain, which is
 * where Scout, Incredible Initiative and every other initiative bonus live.
 * Rolling the bare skill would drop all of them while every number on the card
 * still looked right. So a per-slot ActorInitiative is built from the actor's
 * own class (`actor.initiative.constructor`) with the statistic the slot names,
 * and its `statistic.roll()` is what we call — never `ActorInitiative#roll`,
 * which writes the tracker at once and would put an NPC's total on every
 * player's screen before the sort.
 *
 * Modifier toggles ride Spotlight Roll's `Check.roll` wrapper (`pendCheck`):
 * libWrapper allows one wrapper per package per target, so two features may
 * not each wrap it. The card is held (`createMessage: false`) and posted at the
 * sort beat by `postHeld`, with Dice So Nice told to skip it.
 *
 * Values are committed through `setMultipleInitiatives`, PF2e's own batch
 * writer, which also records the statistic and the tie-break priority flags
 * PF2e's `_sortCombatants` reads. One update for the whole encounter.
 */
import { warn } from "../../core/const.mjs";
import { installCheckWrapper, pendCheck, unpendCheck, postHeld } from "../spotlight-roll/pf2e-roll.mjs";
import { IDENT } from "./constants.mjs";

export { installCheckWrapper, postHeld };

/** Every statistic a creature may roll initiative with: Perception, then skills and lores. */
export function statisticsOf(actor) {
  if (!actor) return [];
  const out = [];
  const perception = actor.perception;
  if (perception) out.push({ slug: "perception", label: perception.label ?? "Perception", mod: initiativeMod(actor, "perception") });
  for (const [slug, skill] of Object.entries(actor.skills ?? {})) {
    if (!skill) continue;
    out.push({ slug, label: skill.label ?? slug, mod: initiativeMod(actor, slug) });
  }
  return out;
}

/** The statistic PF2e itself would use (the sheet's initiative selector). */
export function defaultStatistic(actor) {
  return actor?.system?.initiative?.statistic || actor?.initiative?.statistic?.base?.slug || "perception";
}

/** A fresh ActorInitiative for `slug`, or null. */
function initiativeFor(actor, slug) {
  const Ctor = actor?.initiative?.constructor;
  if (!Ctor) return null;
  try {
    return new Ctor(actor, { statistic: slug, tiebreakPriority: actor.initiative.tiebreakPriority });
  } catch (e) {
    warn(`combat-intro: no initiative statistic "${slug}" on ${actor?.name}`, e);
    return null;
  }
}

function initiativeMod(actor, slug) {
  const init = initiativeFor(actor, slug);
  const mod = init?.statistic?.check?.mod;
  return Number.isFinite(mod) ? mod : 0;
}

/**
 * The chip list for one slot, exactly as PF2e would stack it, without rolling.
 * @returns {Promise<{mods: Array, total: number}|null>}
 */
export async function probeInitiative(actor, slug, toggles = {}) {
  const init = initiativeFor(actor, slug);
  if (!init?.statistic) return null;
  const id = `${IDENT}:probe:${foundry.utils.randomID()}`;
  const job = pendCheck(id, { probe: true, toggles });
  try {
    await init.statistic.roll({ skipDialog: true, createMessage: false, identifier: id, extraRollOptions: ["initiative"] });
  } catch (e) {
    warn("combat-intro: probe failed", e);
  } finally {
    unpendCheck(id);
  }
  return job.result ? { mods: job.result.mods, total: job.result.totalModifier } : null;
}

/**
 * Roll one slot's initiative.
 * @returns {Promise<{ total, natural, statistic, statLabel, mods, held }>}
 */
export async function rollInitiative(actor, slug, { toggles = {}, hidden = false } = {}) {
  const init = initiativeFor(actor, slug) ?? initiativeFor(actor, "perception");
  if (!init?.statistic) throw new Error(`no initiative statistic on ${actor?.name}`);
  const id = `${IDENT}:roll:${foundry.utils.randomID()}`;
  pendCheck(id, { probe: false, toggles });
  let held = null, roll = null;
  try {
    roll = await init.statistic.roll({
      skipDialog: true, createMessage: false, identifier: id,
      extraRollOptions: ["initiative", ...(hidden ? ["secret"] : [])],
      callback: (_r, _o, msg) => { held = msg?.toObject?.() ?? null; },
    });
  } finally {
    unpendCheck(id);
  }
  if (!roll) throw new Error("PF2e returned no roll");
  const die = roll.dice?.find((d) => d.faces === 20);
  const natural = die?.results?.find((r) => r.active !== false && !r.discarded)?.result ?? null;
  const mods = (held?.flags?.pf2e?.modifiers ?? []).map((m) => ({ slug: m.slug, label: m.label, value: m.modifier, enabled: !!m.enabled && !m.ignored }));
  const statistic = init.statistic.base?.slug ?? slug;
  return { total: roll.total, natural, statistic, statLabel: init.statistic.label ?? statistic, mods, held };
}

/**
 * Commit every value at once. `entries` = [{ id: combatantId, value, statistic }].
 * PF2e's own writer: it stamps `flags.pf2e.initiativeStatistic` and keeps the
 * turn pointer, which a bare `updateEmbeddedDocuments` would not.
 */
export async function commitInitiatives(combat, entries) {
  if (!entries.length) return;
  if (typeof combat.setMultipleInitiatives === "function") return combat.setMultipleInitiatives(entries);
  return combat.updateEmbeddedDocuments("Combatant", entries.map((e) => ({ _id: e.id, initiative: e.value })));
}

/**
 * Who sees an initiative card. PF2e's rule: a hidden combatant's roll is a GM
 * message (ActorInitiative#roll sets messageMode "gm"); an NPC's goes to the
 * GMs, since its total is not the table's business; a PC's is public.
 */
export function cardAudience(combatant, gmIds) {
  if (combatant?.hidden || combatant?.token?.hidden) return { whisper: gmIds, blind: true };
  if (!combatant?.actor?.hasPlayerOwner) return { whisper: gmIds, blind: false };
  return { whisper: [], blind: false };
}
