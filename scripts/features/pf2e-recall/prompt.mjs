/**
 * GLUniverse Suite — Recall Knowledge: the clipboard payload.
 *
 * The payload is SELF-CONTAINED and authoritative: it carries the full output
 * grammar every time, so a GM can paste it into claude.ai with nothing
 * installed. skills/pf2e-recall/ is a thin wrapper over this same grammar for
 * Claude Code users; if the two ever disagree, this file wins.
 *
 * Why the tiers are ordered the way they are (mechanics in the MIDDLE, story at
 * the top) is argued in docs/RECALL_KNOWLEDGE.md. The short version: tier 2 is
 * the typical roll, so the common outcome is actionable, and the rare roll buys
 * lore rather than statistics.
 */

import { GRAMMAR_VERSION, TIERS } from "./constants.mjs";

/** The literal headings the parser will look for. Data, not copy. */
export const HEADINGS = Object.freeze({
  everyone: "Everyone knows",
  might: "One might know",
  few: "Very few know",
  misremembered: "Misremembered",
});

/** Machine-readable stamp; invisible when the markdown is rendered. */
export const VERSION_MARK = `<!-- glrk:${GRAMMAR_VERSION} -->`;

const TIER_GUIDANCE = {
  everyone: [
    "What the thing plainly is, and what it is known FOR — reputation, rumour, the",
    "story people tell. This is common currency: a farmhand would know it. No",
    "tactical content here.",
  ].join(" "),
  might: [
    "How it fights and how it dies. This is the tier that must be ACTIONABLE — a",
    "player who learns only this should be able to change what they do next turn.",
    "Cover the standouts: which damage types hurt it, which save is its weakest,",
    "and the one signature mechanic that defines fighting it.",
  ].join(" "),
  few: [
    "The secret. True origin, an unexpected lever, a weakness nobody would guess,",
    "or a hook that opens onto the wider campaign. This is the payoff for a rare",
    "roll and it should feel like it.",
  ].join(" "),
};

function bulletRange([lo, hi]) {
  return lo === hi ? `${lo} bullet` : `${lo}–${hi} bullets`;
}

function renderGrammar(name) {
  const tiers = TIERS.map(
    (t) => `## ${HEADINGS[t.key]}\n${"- …\n".repeat(t.bullets[0])}`
  ).join("\n");
  return [
    "```markdown",
    `# Recall Knowledge: ${name}`,
    VERSION_MARK,
    "",
    tiers + `\n## ${HEADINGS.misremembered}\n- …`,
    "```",
  ].join("\n");
}

function renderBrief(brief) {
  const out = [`## Subject: ${brief.name}`];
  const meta = [
    brief.subtitle,
    brief.rarity && brief.rarity !== "common" ? `Rarity: ${brief.rarity}` : "",
    brief.size ? `Size: ${brief.size}` : "",
  ].filter(Boolean);
  if (meta.length) out.push(meta.join(" · "));
  if (brief.traits?.length) out.push(`Traits: ${brief.traits.join(", ")}`);

  const fields = Object.entries(brief.fields ?? {}).filter(
    ([, v]) => v != null && String(v).trim() !== ""
  );
  if (fields.length) {
    out.push("", "### Statistics");
    out.push(...fields.map(([k, v]) => `- ${k}: ${v}`));
  }

  if (brief.abilities?.length) {
    out.push("", "### Abilities");
    out.push(...brief.abilities.map((a) => `- **${a.name}** — ${a.text}`));
  }

  if (brief.blurb) out.push("", "### Blurb", brief.blurb);

  if (brief.prose?.text) {
    out.push("", "### Description / notes");
    out.push(brief.prose.text);
    if (brief.prose.truncated) {
      out.push("", "> (Truncated to fit. Ask if you need more of this text.)");
    }
  }
  return out.join("\n");
}

/**
 * Build the full clipboard payload.
 *
 * @param {object}   brief    from extract.mjs `subjectBrief`
 * @param {object}   opts
 * @param {string}   opts.context  the GM's free-text steer (the highest-value field)
 * @param {string[]} opts.extras   rendered blocks of opted-in extra context
 * @param {object[]} opts.seed     existing DC-keyed RK entries offered as source material
 */
export function buildPayload(brief, { context = "", extras = [], seed = [] } = {}) {
  const kindWord =
    { creature: "creature", journal: "place, group or topic", item: "item", scene: "location" }[
      brief.kind
    ] ?? "subject";

  const sections = [
    "# Task: write a Recall Knowledge lore ladder",
    "",
    `I am the GM of a Pathfinder 2e (Remaster) game. I need a tiered lore ladder for the ${kindWord} below, so that when a player succeeds at Recall Knowledge I know what to tell them and how deep to go.`,
    "",
    "## How the ladder is used",
    "",
    "The three tiers are cumulative: a better roll reveals everything above it as well. The tiers describe **how widely a fact is known in the world**, not how well the player rolled.",
    "",
    ...TIERS.map((t) => `- **${HEADINGS[t.key]}** (${bulletRange(t.bullets)}) — ${TIER_GUIDANCE[t.key]}`),
    `- **${HEADINGS.misremembered}** (1 bullet) — a plausible, folklore-shaped thing a character might wrongly believe. It fires on a badly failed roll.`,
    "",
    "## Rules for what you write",
    "",
    "1. Write in the GM's narrating voice: short, concrete, sayable out loud at the table. No stat-block formatting, no rules jargon the players would not hear.",
    "2. Name weaknesses and resistances as **types, never numbers** — “fire scars it and it does not heal” rather than “weakness 10 fire”. The same goes for saves: “slow to dodge” rather than “Reflex +12”.",
    "3. Never invert a real fact in the Misremembered line. A wrong belief should be wrong in *flavour* — a mistaken origin, a garbled name, a rumour that overstates it — not a lie that reverses a weakness or a save. A player who acts on it should be unlucky, not punished.",
    "4. Do not invent contradictions with the statistics given below. You may invent freely in the gaps, especially for the deepest tier.",
    "5. One fact per bullet. No sub-bullets, no bold labels, no trailing commentary.",
    "",
    "## Output format",
    "",
    "Reply with **only** the markdown below, with no preamble and no explanation. Keep the headings and the comment line exactly as written.",
    "",
    renderGrammar(brief.name),
  ];

  if (context.trim()) {
    sections.push(
      "",
      "## What matters at my table",
      "",
      "This is the most important context. Prefer it over anything generic:",
      "",
      context.trim()
    );
  }

  if (seed.length) {
    sections.push(
      "",
      "## Existing notes to draw on",
      "",
      "These are my own earlier notes about this subject. Reuse what is good; re-sort them into the tiers above. They are raw material, not already-tiered output:",
      "",
      ...seed.map((e) => `- ${[e.skills, e.dc ? `DC ${e.dc}` : ""].filter(Boolean).join(" ")}${e.skills || e.dc ? ": " : ""}${e.text}`)
    );
  }

  sections.push("", "---", "", renderBrief(brief));

  for (const extra of extras.filter(Boolean)) sections.push("", "---", "", extra);

  return sections.join("\n");
}
