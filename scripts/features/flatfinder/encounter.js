/**
 * Flatfinder encounter XP budget & difficulty badge in the Combat Tracker.
 *
 * As the GM adds PCs and monsters/hazards to the encounter tracker, this computes
 * the total Flatfinder (Proficiency-without-Level) XP and the resulting difficulty
 * band, then renders a badge at the top of the tracker. PCs define the party level
 * and party size; hostile NPCs and hazards are counted as the threat.
 */

import {
  ENCOUNTER_BUDGET,
  PWL_DIFF_MAX,
  PWL_DIFF_MIN,
  PWL_XP_BY_DIFF,
} from "./constants.js";
import { asElement, getSetting } from "./settings.js";
import { flatfinderEffectiveLevel } from "./adjustments.js";
import { getApexConfig, isApexActor, isApexExtraCombatant } from "./apex.js";

function actorLevel(actor) {
  const lvl = actor?.level ?? actor?.system?.details?.level?.value;
  return typeof lvl === "number" ? lvl : null;
}

/** XP value of a single threat creature/hazard relative to the party level. */
function threatXp(actor, partyLevel) {
  // Use the effective Flatfinder level so Elite/Weak threats count as +/-2 levels.
  const level = flatfinderEffectiveLevel(actor);
  if (level === null) return 0;
  const diff = Math.max(PWL_DIFF_MIN, Math.min(PWL_DIFF_MAX, level - partyLevel));
  let xp = PWL_XP_BY_DIFF[String(diff)] ?? 0;
  // Simple hazards are worth 20% of a creature of the same level; complex hazards
  // use the full creature value.
  if (actor?.type === "hazard" && actor?.system?.details?.isComplex === false) {
    xp = Math.round(xp * 0.2);
  }
  // An Apex (solo boss) takes multiple full turns each round, fighting like that
  // many creatures of its level (Flatfinder §8). Count its XP per turn so the
  // budget reflects its true threat — a 3-turn same-level boss is ~3× a single
  // creature, i.e. a severe encounter rather than a trivial one.
  if (getSetting("apexTurns") && isApexActor(actor)) {
    xp *= getApexConfig(actor).turns;
  }
  return xp;
}

/**
 * Inspect the active combat and return the computed budget, or null when nothing
 * useful can be shown.
 */
export function computeEncounter(combat) {
  if (!combat) return null;

  const pcs = [];
  const threats = [];
  for (const combatant of combat.combatants) {
    const actor = combatant.actor;
    if (!actor) continue;
    if (actor.type === "character") {
      pcs.push(actor);
      continue;
    }
    if (actor.type !== "npc" && actor.type !== "hazard") continue;
    // An Apex boss's extra-turn combatants point at the same actor as its prime;
    // they're additional turns, not additional threats. Skip them so the boss is
    // counted once (threatXp applies the turn multiplier) and the budget doesn't
    // jump the moment initiative is rolled.
    if (isApexExtraCombatant(combatant)) continue;
    const disposition = combatant.token?.disposition;
    // Treat hostiles (and disposition-less entries) as threats; skip friendly/neutral NPCs.
    if (disposition === CONST.TOKEN_DISPOSITIONS.FRIENDLY) continue;
    if (disposition === CONST.TOKEN_DISPOSITIONS.NEUTRAL) continue;
    threats.push(actor);
  }

  if (!threats.length) return null;

  const partySize = pcs.length || game.actors?.party?.members?.length || 4;

  let partyLevel;
  if (pcs.length) {
    partyLevel = Math.round(
      pcs.reduce((sum, a) => sum + (actorLevel(a) ?? 0), 0) / pcs.length
    );
  } else {
    partyLevel = actorLevel(game.actors?.party) ?? 1;
  }

  const totalXp = threats.reduce((sum, a) => sum + threatXp(a, partyLevel), 0);

  const budget = {};
  for (const [key, { base, perPc }] of Object.entries(ENCOUNTER_BUDGET)) {
    budget[key] = base + (partySize - 4) * perPc;
  }

  let severity = "trivial";
  if (totalXp >= budget.extreme) severity = "extreme";
  else if (totalXp >= budget.severe) severity = "severe";
  else if (totalXp >= budget.moderate) severity = "moderate";
  else if (totalXp >= budget.low) severity = "low";

  return { totalXp, severity, budget, partyLevel, partySize, threatCount: threats.length };
}

export function renderEncounterBudget(app, html) {
  const root = asElement(html);
  if (!root) return;
  root.querySelector(".flatfinder-encounter-budget")?.remove();

  if (!game.user?.isGM) return;
  if (!getSetting("encounterBudget")) return;

  const combat = app?.viewed ?? app?.combat ?? game.combats?.viewed ?? game.combat;
  const data = computeEncounter(combat);
  if (!data) return;

  const { totalXp, severity, budget, partyLevel, partySize } = data;
  const severityLabel = game.i18n.localize(
    `PF2E-FLATFINDER.Encounter.Severity.${severity.charAt(0).toUpperCase()}${severity.slice(1)}`
  );

  const tooltip = [
    game.i18n.format("PF2E-FLATFINDER.Encounter.Tooltip.Party", { level: partyLevel, size: partySize }),
    game.i18n.format("PF2E-FLATFINDER.Encounter.Tooltip.Budget", {
      trivial: budget.trivial,
      low: budget.low,
      moderate: budget.moderate,
      severe: budget.severe,
      extreme: budget.extreme,
    }),
  ].join("<br>");

  const badge = document.createElement("div");
  badge.className = "flatfinder-encounter-budget";
  badge.dataset.severity = severity;
  badge.dataset.tooltip = tooltip;
  badge.innerHTML =
    `<div class="ff-eb-row">` +
    `<span class="ff-eb-title">${game.i18n.localize("PF2E-FLATFINDER.Encounter.Title")}</span>` +
    `<span class="ff-eb-severity">${severityLabel}</span>` +
    `</div>` +
    `<div class="ff-eb-row ff-eb-detail">` +
    `<span class="ff-eb-xp">${game.i18n.format("PF2E-FLATFINDER.Encounter.Xp", { xp: totalXp })}</span>` +
    `<span class="ff-eb-budget">${game.i18n.format("PF2E-FLATFINDER.Encounter.BudgetShort", { budget: budget[severity] })}</span>` +
    `</div>`;

  // Insert above the combatant list when possible, else at the top of the tracker.
  const list = root.querySelector("ol.combat-tracker, ol.directory-list, .combat-tracker");
  if (list && list.parentElement) {
    list.parentElement.insertBefore(badge, list);
  } else {
    root.prepend(badge);
  }
}
