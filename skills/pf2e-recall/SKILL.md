---
name: pf2e-recall
description: Write a tiered Recall Knowledge lore ladder ("Everyone knows / One might know / Very few know") for a Pathfinder 2e creature, place, faction, item or topic, in the exact grammar the GLUniverse Suite Recall Knowledge feature imports. Use when the user pastes a Recall Knowledge prompt from that feature, asks for tiered lore or a lore ladder for a PF2e subject, wants to know what to tell players when they succeed at Recall Knowledge, or mentions Stonetop-style tiered lore.
---

# Recall Knowledge lore ladders

Produces a three-tier lore ladder in the grammar
`GLUniverse Suite → Recall Knowledge` parses, so the GM can paste it straight
back into Foundry.

> **The clipboard payload is authoritative.** If the user pasted a prompt from
> the feature, follow *that* prompt — it carries the current grammar and their
> campaign context. This skill is for when they have not, or when they want a
> ladder written from scratch. If the two ever disagree, the payload wins.

## The shape

```markdown
# Recall Knowledge: <Subject>
<!-- glrk:1 -->

## Everyone knows
- …

## One might know
- …

## Very few know
- …

## Misremembered
- …
```

Reply with **only** that markdown. No preamble, no explanation, no closing
offer. Keep the headings and the comment line exactly as written.

## What goes in each tier

The tiers describe **how widely a fact is known in the world**, not how well the
player rolled. They are cumulative: a better roll grants everything above too.

**Everyone knows** — 3–4 bullets. What the thing plainly is, and what it is
known *for*: reputation, rumour, the story people tell. Common currency, the
sort of thing a farmhand could tell you. No tactical content.

**One might know** — 2–3 bullets. How it fights and how it dies. **This tier
must be actionable**: a player who learns only this should be able to change
what they do next turn. Cover the standouts — which damage types hurt it, which
save is its weakest, and the one signature mechanic that defines fighting it.

**Very few know** — 1–2 bullets. The secret. True origin, an unexpected lever, a
weakness nobody would guess, or a hook onto the wider campaign. This is the
payoff for a rare roll; make it feel like one.

**Misremembered** — 1 bullet. A plausible, folklore-shaped thing a character
might wrongly believe.

Mechanics belong in the **middle**, not at the top. Tier 2 is the typical roll,
so the common outcome stays actionable; the rare roll buys story instead of
statistics.

## Rules for the prose

1. **The GM's narrating voice.** Short, concrete, sayable out loud. No
   stat-block formatting and no rules jargon the players would not hear.
2. **Types, never numbers.** "Fire scars it and it does not heal", not
   "weakness 10 fire". "Slow to dodge", not "Reflex +12". Applies to saves,
   weaknesses, resistances and AC alike.
3. **Never invert a real fact in the Misremembered line.** A wrong belief should
   be wrong in *flavour* — a mistaken origin, a garbled name, a rumour that
   overstates it — not a lie that reverses a weakness or a save. A player who
   acts on it should be unlucky, not punished. Inverted facts are the single
   most-complained-about outcome in the whole Recall Knowledge discourse.
4. **Do not contradict the statistics supplied.** Invent freely in the gaps,
   especially at the deepest tier.
5. **One fact per bullet.** No sub-bullets, no bold labels, no trailing
   commentary.

## Subjects without a statblock

Journals, places, factions and topics have no level, rarity or traits, and that
is fine — the feature resolves them against competence checks rather than DCs.
Lean harder on the user's own context, and let the tiers carry the structure:
what the region says about the place, what a traveller might know, what is
actually buried there.

## Non-negotiables

- Never invent a mechanical fact that contradicts a supplied statistic.
- Never emit numbers as player-facing prose.
- Never add a tier, rename a heading, or drop the `<!-- glrk:1 -->` line — the
  parser matches on all three.
