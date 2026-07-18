/**
 * Competence-check result badges.
 *
 * Flatfinder resolves many skill checks against the "Competence Check thresholds"
 * table instead of a fixed DC. Because the Proficiency-without-Level variant already
 * strips character level from skill modifiers, a PF2e skill-check roll total maps
 * directly onto the Flatfinder competence band. This module reads the total off the
 * roll and renders a styled badge onto the chat card.
 *
 * Rules implemented:
 *  - Bands per the Competence Check thresholds table.
 *  - A natural 20 shifts the band up one step; a natural 1 shifts it down one step
 *    (Flatfinder treats these as a +/-5, i.e. one band).
 *  - Lore skills automatically gain a one-step band increase (equivalent to +5).
 */

import { COMPETENCE_BANDS, MODULE_ID } from "./constants.js";
import { asElement, getSetting } from "./settings.js";

/** Highest band whose minimum is <= total. Negative totals land in band 0. */
function bandIndexFromTotal(total) {
  let index = 0;
  for (let i = 0; i < COMPETENCE_BANDS.length; i++) {
    if (total >= COMPETENCE_BANDS[i].min) index = i;
  }
  return index;
}

/** Read the active natural d20 face from a check roll, if present. */
function naturalD20(roll) {
  const die = roll?.dice?.find((d) => d.faces === 20);
  if (!die) return null;
  const active = die.results?.find((r) => r.active) ?? die.results?.[0];
  return active?.result ?? die.total ?? null;
}

/** True when the check's domains identify it as a Lore skill. */
function isLoreCheck(context) {
  const domains = context?.domains ?? [];
  return domains.some((d) => typeof d === "string" && d.endsWith("-lore"));
}

function clampBand(index) {
  return Math.max(0, Math.min(COMPETENCE_BANDS.length - 1, index));
}

/**
 * Compute the competence band for a chat message, or null when the message is not
 * an applicable skill/perception check.
 */
export function computeCompetence(message) {
  const mode = getSetting("competenceBadge");
  if (!mode || mode === "off") return null;

  const context = message.flags?.pf2e?.context;
  const type = context?.type;
  const applicable =
    type === "skill-check" || (mode === "all" && type === "perception-check");
  if (!applicable) return null;

  const roll = message.rolls?.[0];
  if (!roll || typeof roll.total !== "number") return null;

  const total = roll.total;
  const natural = naturalD20(roll);
  const lore = type === "skill-check" && isLoreCheck(context);

  let index = bandIndexFromTotal(total);
  const adjustments = [];

  if (lore) {
    index += 1;
    adjustments.push("PF2E-FLATFINDER.Competence.Adjust.Lore");
  }
  if (natural === 20) {
    index += 1;
    adjustments.push("PF2E-FLATFINDER.Competence.Adjust.Nat20");
  } else if (natural === 1) {
    index -= 1;
    adjustments.push("PF2E-FLATFINDER.Competence.Adjust.Nat1");
  }

  const band = COMPETENCE_BANDS[clampBand(index)];
  return { band, total, lore, natural, adjustments };
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
  if (!root) return;

  // Remove first so a visibility-changing re-render cannot retain a stale result.
  root.querySelector(".flatfinder-competence")?.remove();
  if (!isCompetenceResultVisible(message)) return;

  const result = computeCompetence(message);
  if (!result) return;

  const { band, total, adjustments } = result;
  const label = game.i18n.localize(band.label);
  const caption = game.i18n.localize("PF2E-FLATFINDER.Competence.Caption");

  const tooltipLines = [
    game.i18n.format("PF2E-FLATFINDER.Competence.Tooltip.Total", { total }),
    ...adjustments.map((key) => game.i18n.localize(key)),
  ];

  const badge = document.createElement("div");
  badge.className = `flatfinder-competence flatfinder-tier-${band.key}`;
  badge.dataset.tier = band.key;
  badge.dataset.tooltip = tooltipLines.join("<br>");
  badge.innerHTML =
    `<span class="ff-caption">${caption}</span>` +
    `<span class="ff-label">${label}</span>`;

  const content = root.querySelector(".message-content") ?? root;
  const diceRoll = content.querySelector(".dice-roll");
  if (diceRoll) {
    diceRoll.insertAdjacentElement("afterend", badge);
  } else {
    content.appendChild(badge);
  }
}
