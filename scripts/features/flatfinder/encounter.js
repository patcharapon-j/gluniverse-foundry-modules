/**
 * Flatfinder encounter XP — the world side.
 *
 * Reads the viewed combat into plain entries (`threatEntry`, `combatSnapshot`),
 * hands them to the pure model (encounter-model.mjs) and draws the strip at the
 * top of the combat tracker from the pure view (view.mjs). Combat Intro asks
 * `computeEncounter(combat)` for its threat card, so the shape of that return
 * value (`severity`, `totalXp`, `budget`) is a contract.
 *
 * Who counts:
 *   - the party is every player character in the encounter, or the Party
 *     actor's characters while none has been added yet;
 *   - a threat is an NPC or hazard whose token is not Friendly or Neutral and
 *     whose actor is not on the party's side;
 *   - each creature counts ONCE. A Boss Creature's extra turns are real
 *     Combatants carrying the boss's own actor, so reading combatants naively
 *     counted a Supreme boss three times, on top of its ×3. Extra turns are
 *     refused and actors are de-duplicated by uuid (PF2e's own analysis does
 *     the same), so a linked creature added twice is still one creature.
 */

import { THREAT_ORDER } from "./constants.js";
import { asElement, getSetting } from "./settings.js";
import { adjustmentOf, flatfinderEffectiveLevel, liveLevelOf } from "./adjustments.js";
import { buildEncounter } from "./encounter-model.mjs";
import { partyLevelOf } from "./rules.mjs";
import { trackerHTML } from "./view.mjs";
import { bossBadge, bossXpFactor } from "../pf2e-variant-rules/boss/profile.mjs";
import { isExtraTurn } from "../pf2e-variant-rules/boss/initiative.mjs";

const t = (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key));

const hasTrait = (actor, trait) =>
  !!(actor?.traits?.has?.(trait) || actor?.system?.traits?.value?.includes?.(trait));

/** A player character who belongs to the party (not a minion, familiar or eidolon). */
export function isPartyMember(actor) {
  if (actor?.type !== "character") return false;
  if (hasTrait(actor, "minion") || hasTrait(actor, "eidolon")) return false;
  return actor.alliance !== "opposition";
}

/** One threat as a plain model entry. */
export function threatEntry(actor, { id, name, img, hidden = false } = {}) {
  const hazard = actor?.type === "hazard" ? (actor.system?.details?.isComplex ? "complex" : "simple") : null;
  const badge = bossBadge(actor);
  return {
    id: id ?? actor?.id ?? "",
    uuid: actor?.uuid ?? null,
    name: name ?? actor?.name ?? "",
    img: img ?? actor?.img ?? "",
    // Flatfinder's level: Elite/Weak as ±2 from the base. The boss bump is
    // NOT folded in here — a boss reaches the budget through its XP factor
    // alone, or it would be counted twice.
    level: flatfinderEffectiveLevel(actor),
    hazard,
    adjustment: hazard ? null : adjustmentOf(actor),
    bossFactor: bossXpFactor(actor),
    bossTier: badge?.tier ?? null,
    minion: hasTrait(actor, "minion"),
    hidden: !!hidden,
  };
}

/** Is this combatant one of the encounter's threats? */
function isThreat(combatant, actor) {
  if (actor.type !== "npc" && actor.type !== "hazard") return false;
  if (actor.alliance === "party") return false;
  const disposition = combatant.token?.disposition;
  const D = globalThis.CONST?.TOKEN_DISPOSITIONS ?? { FRIENDLY: 1, NEUTRAL: 0 };
  return disposition !== D.FRIENDLY && disposition !== D.NEUTRAL;
}

/**
 * Who is in a combat: `{ pcs: Actor[], threats: { combatant, actor }[] }`,
 * each creature once (extra boss turns refused, actors de-duplicated by uuid).
 */
export function combatParticipants(combat) {
  const pcs = [];
  const threats = [];
  const seen = new Set();
  for (const combatant of combat?.combatants ?? []) {
    const actor = combatant.actor;
    if (!actor) continue;
    if (isExtraTurn(combatant)) continue;
    const key = actor.uuid ?? combatant.id;
    if (seen.has(key)) continue;
    seen.add(key);
    if (isPartyMember(actor)) pcs.push(actor);
    else if (isThreat(combatant, actor)) threats.push({ combatant, actor });
  }
  return { pcs, threats };
}

/** Read a combat into `{ pcs, threats }`: party actors, and one model entry per threat creature. */
export function combatSnapshot(combat) {
  const { pcs, threats } = combatParticipants(combat);
  return {
    pcs,
    threats: threats.map(({ combatant, actor }) =>
      threatEntry(actor, { id: combatant.id, name: combatant.name, img: combatant.img, hidden: combatant.hidden })
    ),
  };
}

/** The party: the PCs in the encounter, else the Party actor's, else an assumed level 1 party of 4. */
export function partyOf(pcs = []) {
  const inCombat = pcs.map(liveLevelOf);
  if (pcs.length) return { level: partyLevelOf(inCombat) ?? 1, size: pcs.length, source: "combat" };
  const members = (game.actors?.party?.members ?? []).filter(isPartyMember);
  if (members.length) {
    return { level: partyLevelOf(members.map(liveLevelOf)) ?? 1, size: members.length, source: "party" };
  }
  return { level: 1, size: 4, source: "default" };
}

/** The encounter's model (encounter-model.mjs), or null when it has no threats. */
export function encounterModel(combat) {
  if (!combat) return null;
  const { pcs, threats } = combatSnapshot(combat);
  if (!threats.length) return null;
  return buildEncounter({ party: partyOf(pcs), threats, group: true, sort: true });
}

/**
 * The standalone module's shape, which Combat Intro reads: `severity`,
 * `totalXp`, and `budget` as the five budgets keyed by rating.
 */
export function computeEncounter(combat) {
  const model = encounterModel(combat);
  if (!model) return null;
  return {
    ...model,
    severity: model.rating,
    budget: model.budgets,
    partyLevel: model.party.level,
    partySize: model.party.size,
    threatCount: model.count,
  };
}

/* ── The tracker strip ─────────────────────────────────────────────────── */

/** Whether the breakdown is open; per client, survives re-renders. */
let open = false;
/** The fill each combat's meter last drew, so a change slides from there. */
const lastFill = new Map();

/**
 * Draw (or redraw) the strip. Removes the old one first, so a render that
 * should show nothing leaves nothing behind.
 */
export function renderEncounterBudget(app, html, { onPlan } = {}) {
  const root = asElement(html);
  if (!root?.querySelector) return;
  root.querySelector(".flatfinder-encounter-budget")?.remove();

  if (!game.user?.isGM) return;
  if (!getSetting("encounterBudget")) return;

  const combat = app?.viewed ?? game.combats?.viewed ?? game.combat ?? null;
  const model = encounterModel(combat);
  const key = combat?.id ?? "";
  const last = model ? lastFill.get(key) ?? null : null;
  if (model) lastFill.set(key, { fill: model.meter.fill, rating: model.rating });

  const holder = document.createElement("div");
  holder.innerHTML = trackerHTML(model, {
    t,
    open,
    from: last?.fill ?? null,
    rerated: !!last && last.rating !== model.rating,
  });
  const strip = holder.firstElementChild;
  if (!strip) return;

  strip.addEventListener("click", (event) => {
    const button = event.target.closest?.("[data-ff-action]");
    if (!button || !strip.contains(button)) return;
    event.preventDefault();
    const action = button.dataset.ffAction;
    if (action === "toggle") {
      open = !strip.classList.contains("is-open");
      strip.classList.toggle("is-open", open);
      button.setAttribute("aria-expanded", String(open));
    } else if (action === "plan") onPlan?.();
  });

  // PF2e's own threat line reads the standard XP table (pf2e-flatten does not
  // switch the system's PWoL variant on), so beside this strip it would rate the
  // same fight differently. The strip replaces it while it is drawn.
  if (model) root.querySelector("section.metrics")?.setAttribute("hidden", "");

  const list = root.querySelector("ol.combat-tracker, ol.directory-list, .combat-tracker");
  if (list?.parentElement) list.parentElement.insertBefore(strip, list);
  else root.prepend(strip);
}

/** The threat keys, re-exported for callers that only want the order. */
export { THREAT_ORDER };
