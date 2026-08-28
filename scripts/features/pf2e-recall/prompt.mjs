/**
 * GLUniverse Suite — Recall Knowledge: the clipboard payload.
 *
 * The payload is SELF-CONTAINED and authoritative: it carries the full output
 * grammar every time, so a GM can paste it into claude.ai with nothing
 * installed. skills/pf2e-recall/ is a thin wrapper over this same grammar for
 * Claude Code users; if the two ever disagree, this file wins.
 *
 * ## What changed in v2, and why
 *
 * v1 authored three cumulative tiers of bullets and derived eight table
 * experiences from them. It read well as a design and failed as a table tool:
 * at the top bands the GM was holding nine or ten bullets and asked to perform
 * them mid-combat. Nobody does that; they skim, pick two, and the authored
 * depth is wasted.
 *
 * v2 authors ONE self-contained paragraph per competence band. Whatever the
 * roll, the GM reads exactly one paragraph aloud and moves on. The escalation
 * that used to live in "how many bullets you unlocked" now lives in what the
 * paragraph is ABOUT, which is where it always belonged.
 *
 * The tier idiom this feature borrowed from Stonetop ("Everyone knows / One
 * might know / Very few know") no longer appears as headings, but it still
 * shapes the guidance below: the ladder still climbs from what a farmhand
 * repeats to what nobody alive should know. Credit stands; see
 * docs/RECALL_KNOWLEDGE.md.
 */

import { BAND_KEYS, GRAMMAR_VERSION, PARAGRAPH_WORDS } from "./constants.mjs";

/**
 * The literal headings the parser will look for. Data, not copy.
 *
 * These match Flatfinder's own competence band names, so a GM reading the
 * generated document recognises the rung a roll landed on without a lookup.
 */
export const HEADINGS = Object.freeze({
  disastrous: "Disastrous",
  inept: "Inept",
  poor: "Poor",
  passable: "Passable",
  solid: "Solid",
  impressive: "Impressive",
  remarkable: "Remarkable",
  phenomenal: "Phenomenal",
});

/** Machine-readable stamp; invisible when the markdown is rendered. */
export const VERSION_MARK = `<!-- glrk:${GRAMMAR_VERSION} -->`;

/**
 * What each band knows, and how it should sound.
 *
 * The shape of the climb: nothing → confidently wrong → hedged reputation →
 * plain identification → one useful fact → how it actually fights → the secret
 * → what the secret opens onto. Each rung has its own job, which is what stops
 * eight paragraphs from being one paragraph written eight ways.
 */
const BAND_GUIDANCE = Object.freeze({
  disastrous: [
    "Nothing. The character has no frame of reference at all, and it should be",
    "funny rather than cruel — a blank, a wrong category, a confident guess",
    "about something else entirely. This paragraph must contain **no true fact",
    "whatsoever**, not even the creature's kind. It is the only rung that is",
    "allowed to be a joke.",
  ].join(" "),
  inept: [
    "Confidently wrong. A plausible, folklore-shaped belief the character holds",
    "and would act on. Wrong in **flavour** — a mistaken origin, a garbled",
    "name, a rumour that inflates or deflates it, or an outright",
    "misidentification as a different creature. Never invert a real fact: do",
    "not claim it fears something it is immune to, or that its strongest save",
    "is its weakest. A character who acts on this should be unlucky, not",
    "punished.",
  ].join(" "),
  poor: [
    "The reputation, hedged. What people say about it, delivered with visible",
    "uncertainty — half-remembered, second-hand, possibly confused with",
    "something similar. True in outline, vague in every detail. No tactics.",
  ].join(" "),
  passable: [
    "Plain identification. What the thing is and what it is known for, said",
    "without hedging. This is common currency — a farmhand would know it. Still",
    "no tactical content: knowing what it is called is not knowing how to fight",
    "it.",
  ].join(" "),
  solid: [
    "Identification plus **one** genuinely useful thing. Pick the single fact",
    "that most changes what a player does next turn — the damage type that",
    "hurts it, the save it is worst at, or the one defence worth planning",
    "around. One only: this rung is the common success, not the jackpot.",
  ].join(" "),
  impressive: [
    "How it actually fights. Its signature mechanic — the thing that defines",
    "the encounter — and what that means for the party, plus the vulnerability",
    "worth exploiting. This is the rung a prepared player is aiming for, and it",
    "should feel like a real advantage.",
  ].join(" "),
  remarkable: [
    "The secret. True origin, an unexpected lever, a weakness nobody would",
    "guess, something that is not in any bestiary. It should still be",
    "actionable — a secret you cannot use is trivia — but it buys story rather",
    "than another statistic.",
  ].join(" "),
  phenomenal: [
    "The secret, and what it opens onto. Everything Remarkable knows, plus the",
    "thread that leads somewhere: a name, a connection, a reason this thing is",
    "*here*, a hook the GM can pull on later. This is a specialist's reward and",
    "should feel like one.",
  ].join(" "),
});

function renderGrammar(name) {
  const body = BAND_KEYS.map((key) => `## ${HEADINGS[key]}\n<one paragraph>\n`).join("\n");
  return ["```markdown", `# Recall Knowledge: ${name}`, VERSION_MARK, "", body.trimEnd(), "```"].join("\n");
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

  // Attacks, actions and spellcasting. Each entry leads with its mechanical
  // meta line (cost, attack bonus, damage, traits) because that is what the
  // middle bands are written from — "how it fights and how it dies" cannot be
  // answered from a name alone.
  for (const section of brief.sections ?? []) {
    if (!section.entries?.length) continue;
    out.push("", `### ${section.title}`);
    for (const entry of section.entries) {
      out.push(`- **${entry.name}**${entry.meta ? ` — ${entry.meta}` : ""}`);
      if (entry.text) out.push(...entry.text.split("\n").map((line) => `  ${line}`));
    }
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
    {
      creature: "creature",
      hazard: "hazard or trap",
      journal: "place, group or topic",
      item: "item",
      scene: "location",
    }[brief.kind] ?? "subject";
  const [minWords, maxWords] = PARAGRAPH_WORDS;

  const sections = [
    "# Task: write eight Recall Knowledge answers",
    "",
    `I am the GM of a Pathfinder 2e (Remaster) game. When a player succeeds at Recall Knowledge on the ${kindWord} below, I want to read one short paragraph aloud and keep the scene moving. Write me one paragraph for each of the eight competence bands my table uses.`,
    "",
    "## How these are used",
    "",
    "My table resolves skill checks with **competence bands** rather than degrees of success: the roll total lands in a band, and the band is the answer. So at the table I look up exactly one band and read exactly one paragraph. I never combine them, never read two, and never summarise.",
    "",
    "That has three consequences for what you write:",
    "",
    `1. **Every paragraph stands alone.** It must make sense read cold, with nothing before it. A higher band may re-establish what the thing is in a clause, but it must never depend on a lower one having been read.`,
    `2. **All eight must be different.** Not eight rewordings of one idea — eight different pieces of knowledge. If two paragraphs could be swapped without anyone noticing, one of them is wasted.`,
    `3. **Length is a hard constraint.** ${minWords}–${maxWords} words each, one paragraph, no bullets, no headings inside it. This is spoken aloud: past about ${maxWords} words I start skimming and paraphrasing, and your work is lost.`,
    "",
    "## The bands, shallowest to deepest",
    "",
    ...BAND_KEYS.map((key) => `- **${HEADINGS[key]}** — ${BAND_GUIDANCE[key]}`),
    "",
    "## Pitch it to what this thing actually is",
    "",
    "The subject's level, rarity and statistics are given below. Use them to decide **how much is knowable at all** — this is the difference between a ladder that feels real and one that feels generic:",
    "",
    "- **A common, low-level creature has no cosmic secret.** Nobody alive holds forbidden knowledge about a goblin. For an ordinary thing, the top bands should get *smaller and more specific*, not grander: a local name, a habit, where they nest, who trades with them, the one trick that actually works. A concrete local truth is a better reward than an invented prophecy.",
    "- **A rare, unique or high-level subject can carry real weight.** Here the top bands may reach for origin, conspiracy and campaign consequence, because the fiction supports it.",
    "- **Fame is not power.** A famous creature is well known at the *bottom* bands — even a poor roll recognises a dragon. An obscure one may be barely identifiable even at Passable, and saying so is a legitimate answer.",
    "- **Commonness sets the floor.** Something the region sees weekly is known plainly by everyone; something last seen a century ago is rumour at best.",
    "",
    "## Rules for what you write",
    "",
    "1. Write in the GM's narrating voice, addressing the character as \"you\". Short, concrete, sayable out loud. No stat-block formatting and no rules jargon the players would not hear.",
    "2. Name weaknesses and resistances as **types, never numbers** — \"fire scars it and it does not heal\" rather than \"weakness 10 fire\". The same goes for saves: \"slow to dodge\" rather than \"Reflex +12\".",
    "3. Do not contradict the statistics given below. Invent freely in the gaps, especially at the deepest bands.",
    "4. No bullets, no bold labels, no headings inside a paragraph, no trailing commentary.",
    "5. Do not name the band inside its own paragraph. I read the prose, not the label.",
    "",
    "## Output format",
    "",
    "Reply with **only** the markdown below, with no preamble and no explanation. Keep the eight headings and the comment line exactly as written.",
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
      "These are my own earlier notes about this subject. Reuse what is good; re-sort them across the bands above. They are raw material, not already-banded output:",
      "",
      ...seed.map((e) => `- ${[e.skills, e.dc ? `DC ${e.dc}` : ""].filter(Boolean).join(" ")}${e.skills || e.dc ? ": " : ""}${e.text}`)
    );
  }

  sections.push("", "---", "", renderBrief(brief));

  for (const extra of extras.filter(Boolean)) sections.push("", "---", "", extra);

  return sections.join("\n");
}
