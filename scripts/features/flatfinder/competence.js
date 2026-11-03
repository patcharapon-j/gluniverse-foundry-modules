/**
 * Competence-check result badges — the world side.
 *
 * Flatfinder resolves many skill checks against the "Competence Check thresholds"
 * table instead of a fixed DC. Because the Proficiency-without-Level variant already
 * strips character level from skill modifiers, a PF2e skill-check roll total maps
 * directly onto the Flatfinder competence band. This module reads the total, the
 * natural d20 and whether it was a Lore check off the message; the band itself is
 * rules.mjs `competence()` and the markup is view.mjs `competenceHTML()`.
 *
 * Rules implemented (rules.mjs):
 *  - Bands per the Competence Check thresholds table.
 *  - A natural 20 shifts the band up one step; a natural 1 shifts it down one step.
 *  - Lore skills automatically gain a one-step band increase (equivalent to +5).
 */

import { FRESH_CARD_MS } from "./constants.js";
import { asElement, getSetting } from "./settings.js";
import { competence } from "./rules.mjs";
import { competenceHTML } from "./view.mjs";

const t = (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key));

/**
 * The natural d20 a check landed on: the kept result of the first d20 term
 * (fortune and misfortune roll 2d20 and keep one), or null.
 */
export function naturalD20(roll) {
  const die = roll?.dice?.find((d) => d.faces === 20);
  if (!die) return null;
  const active = die.results?.find((r) => r.active) ?? die.results?.[0];
  const face = active?.result ?? die.total;
  return typeof face === "number" ? face : null;
}

/** True when the check's domains identify it as a Lore skill. */
export function isLoreCheck(context) {
  const domains = context?.domains ?? [];
  return domains.some((d) => typeof d === "string" && d.endsWith("-lore"));
}

/**
 * Compute the competence band for a chat message, or null when the message is not
 * an applicable skill/perception check.
 */
export function computeCompetence(message, mode = getSetting("competenceBadge")) {
  if (!mode || mode === "off") return null;

  const context = message?.flags?.pf2e?.context;
  const type = context?.type;
  const applicable = type === "skill-check" || (mode === "all" && type === "perception-check");
  if (!applicable) return null;

  const roll = message.rolls?.[0];
  if (!roll || typeof roll.total !== "number") return null;

  return competence({
    total: roll.total,
    natural: naturalD20(roll),
    lore: type === "skill-check" && isLoreCheck(context),
  });
}

/**
 * Whether the current user may see a result derived from this message.
 *
 * `visible` controls access to the message itself (for whispers), while
 * `isContentVisible` controls access to its roll content.  Blind rolls are the
 * important distinction: Foundry renders a message shell to the rolling player,
 * but sets `isContentVisible` false so the result remains GM-only.
 */
export function isCompetenceResultVisible(message) {
  return message?.visible !== false && message?.isContentVisible !== false;
}

/** Render (or refresh) the competence badge on a chat card. */
export function renderCompetenceBadge(message, html) {
  const root = asElement(html);
  if (!root?.querySelector) return;

  // Remove first so a visibility-changing re-render cannot retain a stale result.
  root.querySelector(".flatfinder-competence")?.remove();
  if (!isCompetenceResultVisible(message)) return;

  const result = computeCompetence(message);
  if (!result) return;

  // Only a card that just arrived climbs its ladder: the log drawing fifty old
  // cards on load, or a card re-rendered later, should sit still.
  const age = Date.now() - (Number(message.timestamp) || 0);
  const holder = document.createElement("div");
  holder.innerHTML = competenceHTML(result, { t, fresh: age >= 0 && age < FRESH_CARD_MS });
  const badge = holder.firstElementChild;
  if (!badge) return;

  const content = root.querySelector(".message-content") ?? root;
  const diceRoll = content.querySelector(".dice-roll");
  if (diceRoll) diceRoll.insertAdjacentElement("afterend", badge);
  else content.appendChild(badge);
}
