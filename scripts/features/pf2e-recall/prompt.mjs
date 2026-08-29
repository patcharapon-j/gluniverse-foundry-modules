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
 * v2 authors ONE paragraph per competence band. Whatever the roll, the GM reads
 * exactly one paragraph aloud and moves on. The escalation that used to live in
 * "how many bullets you unlocked" now lives in what the paragraph is ABOUT,
 * which is where it always belonged.
 *
 * ## What changed in v2.1
 *
 * v2.0 told the model each paragraph must "stand alone", meaning: readable
 * cold. The model heard "say only what this rung adds", and the top bands came
 * back carrying the secret and nothing else — no identification, no weakness,
 * no tactics. At the table that is unusable: the GM has the payoff and none of
 * the setup, and to give the player a complete answer they have to read the
 * lower bands too, which is exactly the failure v2 exists to remove.
 *
 * v2.1 says the thing it actually meant. From Passable up, every paragraph is
 * CUMULATIVE: it carries everything the rungs below it would have told the
 * player, compressed to a clause each, and then adds its own layer. One
 * paragraph is the whole answer for that roll. The word budget climbs with the
 * rung to pay for it (BAND_WORDS).
 *
 * ## What changed in v2.2
 *
 * The eight bands say how MUCH is known. They said nothing about how the
 * knowing reaches the player, so every ladder sounded like a person
 * remembering — which is wrong for a party reading a ship's log, researching in
 * an archive, or being shown a vision. v2.2 adds the presentation: a table of
 * what changes (speaker, evidence, how falsehood arrives, who is addressed),
 * chosen by the GM and baked in at authoring time, because nothing here can
 * re-voice stored prose at read time.
 *
 * It also splits the rule list. Some rules are the presentation's to set —
 * speaker, addressee, register — and some hold no matter what: no interiority,
 * no advice, no contradicting the statistics. Leaving that unstated meant the
 * model had to break one rule or the other silently, and a terminal log
 * addressing the character as "you" is not a terminal log.
 *
 * The tier idiom this feature borrowed from Stonetop ("Everyone knows / One
 * might know / Very few know") no longer appears as headings, but it still
 * shapes the guidance below: the ladder still climbs from what a farmhand
 * repeats to what nobody alive should know. Credit stands; see
 * docs/RECALL_KNOWLEDGE.md.
 */

import {
  BAND_KEYS,
  BAND_WORDS,
  DEFAULT_PRESENTATION,
  GRAMMAR_VERSION,
  presentationByKey,
} from "./constants.mjs";

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
 *
 * Each entry is phrased as CARRIES / ADDS, deliberately. Describing a rung by
 * its new material alone is what produced a Remarkable paragraph with no
 * identification in it: the model writes what the guidance names, so the
 * guidance has to name the carry too. The bottom two rungs carry nothing —
 * they are false answers, and accumulating truth into them would defeat them.
 */
const BAND_GUIDANCE = Object.freeze({
  disastrous: [
    "**Carries nothing.** No frame of reference at all — a blank, a wrong",
    "category, a confident answer about something else entirely, arriving the",
    "way the presentation above says falsehood arrives here. Funny rather than",
    "cruel. This paragraph must contain **no true fact whatsoever**, not even",
    "the creature's kind. It is the only rung allowed to be a joke.",
  ].join(" "),
  inept: [
    "**Carries nothing true.** Confidently wrong, in exactly the way the",
    "presentation above says this source goes wrong — and wrong in **flavour**:",
    "a mistaken origin, a garbled name, a rumour or record that inflates or",
    "deflates it, an outright misidentification. Never invert a real fact: do",
    "not claim it fears something it is immune to, or that its strongest save",
    "is its weakest. Whoever acts on this should be unlucky, not punished.",
  ].join(" "),
  poor: [
    "**The floor of true knowledge.** The reputation, hedged: what people say",
    "about it, delivered with visible uncertainty — half-remembered,",
    "second-hand, possibly confused with something similar. True in outline,",
    "vague in every detail. No tactics.",
  ].join(" "),
  passable: [
    "**Carries the reputation, now said plainly** — no hedging, no maybe — and",
    "**adds** the identification: what the thing is and what it is known for.",
    "This is common currency; a farmhand would know it. Still no tactical",
    "content: knowing what it is called is not knowing how to fight it.",
  ].join(" "),
  solid: [
    "**Carries the identification and what it is known for**, then **adds one**",
    "genuinely useful thing. Pick the single fact that most changes what a",
    "player does next turn — the damage type that hurts it, the save it is",
    "worst at, or the one defence worth planning around. One only: this rung is",
    "the common success, not the jackpot. A player who hears only this",
    "paragraph should still know what they are looking at and have one lever.",
  ].join(" "),
  impressive: [
    "**Carries the identification and that one useful fact**, then **adds** how",
    "it actually fights: its signature mechanic — the thing that defines the",
    "encounter — what that means for the party, and the vulnerability worth",
    "exploiting. This is the rung a prepared player is aiming for, and read",
    "alone it should be a complete tactical briefing.",
  ].join(" "),
  remarkable: [
    "**Carries the identification, the useful fact and how it fights** —",
    "compressed hard, a clause or two each — then **adds** the secret: true",
    "origin, an unexpected lever, a weakness nobody would guess, something that",
    "is not in any bestiary. Keep it actionable; a secret you cannot use is",
    "trivia. The player should walk away knowing both how to fight it and what",
    "it really is.",
  ].join(" "),
  phenomenal: [
    "**Carries everything Remarkable carries** — what it is, how it fights, how",
    "it dies, and the secret — then **adds** the thread that leads somewhere: a",
    "name, a connection, a reason this thing is *here*, a hook the GM can pull",
    "on later. This is a specialist's reward and should feel like one, but it",
    "is still one paragraph the GM reads in place of every other.",
  ].join(" "),
});

/**
 * The presentation block: who is speaking, and what the knowing is made of.
 *
 * Rendered high in the payload, before the bands, because it governs how every
 * band is written. The GM's own note comes last and is explicitly allowed to
 * win, the same way their table context outranks anything generic.
 */
function renderPresentation(presentation, note) {
  const out = [
    "## How this reaches the player",
    "",
    `This is not a style preference; it decides who is speaking and what the knowledge is made of. **${presentation.label}.**`,
    "",
    `- **Speaker.** ${presentation.speaker}`,
    `- **What the knowledge is made of.** ${presentation.evidence}`,
    `- **How it goes wrong.** At the two false bands below: ${presentation.falsehood}`,
    `- **Who is addressed.** ${presentation.address}`,
  ];
  if (presentation.numbers) {
    out.push(
      "- **Numbers.** This presentation is the one exception to the no-numbers rule below: it is a readout, and a readout that refuses to print a number is not one. Give the statistics as the record would."
    );
  }
  if (note.trim()) {
    out.push(
      "",
      "The GM has described how this should look and sound. Prefer it over anything generic above:",
      "",
      note.trim()
    );
  }
  return out.join("\n");
}

function renderGrammar(name) {
  // The per-band budget is repeated inside the template as well as in the band
  // list above: this block is the last thing the model reads before writing,
  // and a ceiling stated once, forty lines earlier, is a ceiling that drifts.
  const body = BAND_KEYS.map(
    (key) => `## ${HEADINGS[key]}\n<one paragraph, ${BAND_WORDS[key][0]}-${BAND_WORDS[key][1]} words>\n`
  ).join("\n");
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
 * @param {object}   opts.presentation  `{key, note}` — how the knowledge reaches
 *                                      the player. Falls back to the baseline.
 */
export function buildPayload(
  brief,
  { context = "", extras = [], seed = [], presentation = null } = {}
) {
  const style = presentationByKey(presentation?.key ?? DEFAULT_PRESENTATION);
  const styleNote = String(presentation?.note ?? "");
  const kindWord =
    {
      creature: "creature",
      hazard: "hazard or trap",
      journal: "place, group or topic",
      item: "item",
      scene: "location",
    }[brief.kind] ?? "subject";

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
    "1. **Every paragraph is the whole answer for that roll.** Not just readable cold — *complete*. From Passable upward each band carries everything the bands below it would have told me, then adds its own new layer. If I read only the Remarkable paragraph, the player must still learn what the thing is, how it fights and how it dies, as well as the secret. A paragraph that gives me the payoff without the setup is unusable: it forces me to read a second one, which is the one thing I cannot do.",
    "2. **Each band must add something the one below it did not have.** The carried material is shared by design, but the new layer is not: if a band adds nothing its predecessor lacked, that roll was wasted. Carry briefly, add substantially.",
    "3. **Length is a hard constraint, and it is per band.** The budget is given with each band below. One paragraph, no bullets, no headings inside it. This is spoken aloud — every ten words is about two seconds — so the carried layers must arrive as a clause each, never re-told at their original length. The newest layer always gets the most words.",
    "",
    renderPresentation(style, styleNote),
    "",
    "## The bands, shallowest to deepest",
    "",
    "Each band is written as **what it carries up from below** and **what it adds**, with its word budget. The bottom two are false answers and carry nothing.",
    "",
    ...BAND_KEYS.map(
      (key) =>
        `- **${HEADINGS[key]}** (${BAND_WORDS[key][0]}–${BAND_WORDS[key][1]} words) — ${BAND_GUIDANCE[key]}`
    ),
    "",
    "## How to compress what you carry",
    "",
    "Carrying is not repeating. At Phenomenal I should not hear the Passable paragraph verbatim with three sentences bolted on — I should hear one paragraph written from the top, in which the identification is a clause, the weakness is a clause, the tactics are a sentence, and the new material is the rest. Rewrite each band from scratch with everything it knows in hand; do not concatenate the ones below it.",
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
    "These hold whatever the presentation is:",
    "",
    `1. Name weaknesses and resistances as **types, never numbers** — "fire scars it and it does not heal" rather than "weakness 10 fire". The same goes for saves: "slow to dodge" rather than "Reflex +12".${style.numbers ? " (This presentation is the stated exception: give the numbers as the record would.)" : ""}`,
    "2. **No interiority.** Describe the world and what is known about it, never what the character feels, notices in themselves, or decides. \"Your blood runs cold\" is my line to write, not yours, and it is the fastest way to take the scene away from me.",
    "3. **No advice.** State what is true; do not tell the player what to do about it. \"Fire is the only thing that keeps a wound shut\" — not \"so you should burn it\".",
    "4. **Plain and concrete, sayable in one breath.** The immersion comes from specific images — a smell, a mark on the ground, the one detail nobody would invent — never from ornament. Write nothing I have to perform to make it land; the mood is mine to add.",
    "5. Do not contradict the statistics given below. Invent freely in the gaps, especially at the deepest bands.",
    "6. No bullets, no bold labels, no headings inside a paragraph, no trailing commentary.",
    "7. Do not name the band inside its own paragraph. I read the prose, not the label.",
    "",
    "The presentation above owns the rest — **who is speaking, who is addressed, and the register**. Where it disagrees with your instinct for how these usually sound, the presentation wins.",
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
