/**
 * GLUniverse Suite — Recall Knowledge: handing one band to one player.
 *
 * The feature stayed GM-only for a reason — auto-delivery turns lore into a
 * loot drop — and it still does: nothing here fires from a roll, a hook or a
 * socket the GM did not press. What this module adds is the one delivery a GM
 * actually asked for, which is the same thing they were doing by hand anyway:
 * the paragraph they just read on screen, pushed to the one player who earned
 * it, privately, through the Insight feature's notification card.
 *
 * ## What is deliberately NOT sent
 *
 * The band name, the delivery mode, the subject's own name and the ladder's
 * provenance all stay behind. They are GM-facing scaffolding, and every one of
 * them tells the player how well they rolled — which is the same tell the word
 * budgets in constants.mjs exist to suppress. A player who is told they got the
 * "Remarkable" answer has been handed the die result in words. So the message
 * carries the paragraph and nothing else, under a fixed label that reads the
 * same at every rung.
 *
 * Kept separate from app.mjs so the shape of what reaches a player is one pure
 * function that tools/recall-check.mjs can assert on: a leak here is invisible
 * from the GM's side of the screen, because the GM sees the panel, not the card.
 */

import { inlineMarkdownToHtml } from "./markdown.mjs";

/**
 * English fallbacks, so this module is exercisable outside a Foundry session.
 * `lang/pf2e-recall.en.json` is the shipped copy; these only stand in when
 * `game.i18n` is absent (Node, or an early call before i18n is ready).
 */
const FALLBACK = Object.freeze({
  "GLRK.insight.sense": "Recall Knowledge",
  "GLRK.insight.blank": "Nothing comes to mind.",
  "GLRK.insight.mistaken": "You are fairly sure it is {name}.",
});

const L = (key) => {
  const i18n = globalThis.game?.i18n;
  const value = i18n?.localize ? i18n.localize(key) : key;
  return value === key ? (FALLBACK[key] ?? key) : value;
};

const F = (key, data) => {
  const i18n = globalThis.game?.i18n;
  if (i18n?.format) {
    const value = i18n.format(key, data);
    if (value && value !== key) return value;
  }
  return String(FALLBACK[key] ?? key).replace(/\{(\w+)\}/g, (_m, k) => String(data?.[k] ?? ""));
};

/**
 * The text a player may see for a resolved band, or null when there is nothing
 * to send.
 *
 * An authored paragraph is sent as written. The two fallbacks are NOT: the
 * panel's own wording for them is addressed to the GM about the character
 * ("They are fairly sure it is a hill giant, and will act on that"), which is
 * an instruction to the GM, not a thing to say to the player. They are
 * re-voiced here in the second person, matching how every authored paragraph in
 * the baseline presentation is written.
 */
export function playerFacingText(reveal) {
  const authored = typeof reveal?.text === "string" ? reveal.text.trim() : "";
  if (authored) return authored;
  if (reveal?.wrongSource === "mistaken" && reveal?.wrongName) {
    return F("GLRK.insight.mistaken", { name: reveal.wrongName });
  }
  if (reveal?.wrongSource === "none") return L("GLRK.insight.blank");
  return null;
}

/**
 * Build the Insight notification for one resolved band.
 *
 * @param {object} reveal  from reveal.mjs `resolveReveal`
 * @returns {{title: null, sense: string, body: string}|null}
 */
export function buildInsightMessage(reveal) {
  const text = playerFacingText(reveal);
  if (!text) return null;
  return {
    // Insight renders a title above a divider when one is given. Every title
    // worth writing here — the band, the creature, the skill — is a tell, so
    // the card carries none and leans on the fixed sense label instead.
    title: null,
    sense: L("GLRK.insight.sense"),
    // Insight's template prints the body unescaped (`{{{body}}}`), so what goes
    // in must already be safe. inlineMarkdownToHtml escapes first and marks up
    // second, which is exactly that guarantee.
    body: `<p>${inlineMarkdownToHtml(text)}</p>`,
  };
}
