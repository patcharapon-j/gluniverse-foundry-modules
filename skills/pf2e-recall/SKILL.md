---
name: pf2e-recall
description: Write eight Recall Knowledge answers — one short read-aloud paragraph per competence band, from Disastrous to Phenomenal — for a Pathfinder 2e creature, place, faction, item or topic, in the exact grammar the GLUniverse Suite Recall Knowledge feature imports. Use when the user pastes a Recall Knowledge prompt from that feature, asks what to tell players when they succeed at Recall Knowledge, or wants band-by-band lore for a PF2e subject.
---

# Recall Knowledge band answers

Produces eight short paragraphs — one per competence band — in the grammar
`GLUniverse Suite → Recall Knowledge` parses, so the GM can paste it straight
back into Foundry.

> **The clipboard payload is authoritative.** If the user pasted a prompt from
> the feature, follow *that* prompt — it carries the current grammar and their
> campaign context. This skill is for when they have not, or when they want a
> set written from scratch. If the two ever disagree, the payload wins.

## Why paragraphs, not bullets

The GM reads **exactly one** of these aloud, mid-scene, and moves on. They never
combine them and never read two. An earlier version of this format handed the GM
nine or ten bullets on a good roll and they skimmed, so the depth was wasted.

Three consequences:

1. **Every paragraph stands alone.** It must make sense read cold. A higher band
   may re-establish what the thing is in a clause, but never depends on a lower
   one having been read.
2. **All eight must be different.** Eight pieces of knowledge, not one idea
   worded eight ways. If two could be swapped unnoticed, one is wasted.
3. **25–70 words each.** One paragraph, no bullets, no internal headings. This
   is spoken aloud; past seventy words the GM starts paraphrasing.

## The shape

```markdown
# Recall Knowledge: <Subject>
<!-- glrk:2 -->

## Disastrous
<one paragraph>

## Inept
<one paragraph>

## Poor
<one paragraph>

## Passable
<one paragraph>

## Solid
<one paragraph>

## Impressive
<one paragraph>

## Remarkable
<one paragraph>

## Phenomenal
<one paragraph>
```

## What goes in each band

The bands are Flatfinder competence bands: the roll total lands in one, and that
band is the answer. They describe **how widely a fact is known in the world**,
climbing from what a farmhand repeats to what nobody alive should know.

**Disastrous** — Nothing at all. No frame of reference. Funny rather than cruel:
a blank, a wrong category, a confident guess about something else. Must contain
**no true fact whatsoever**, not even the creature's kind. The only band allowed
to be a joke.

**Inept** — Confidently wrong. A plausible, folklore-shaped belief the character
would act on: a mistaken origin, a garbled name, an inflated rumour, an outright
misidentification.

**Poor** — The reputation, hedged. What people say, with visible uncertainty.
True in outline, vague in detail. No tactics.

**Passable** — Plain identification. What it is and what it is known for, said
without hedging. Still no tactical content.

**Solid** — Identification plus **one** useful thing: the damage type that hurts
it, the save it is worst at, or the one defence worth planning around. One only.

**Impressive** — How it actually fights. The signature mechanic that defines the
encounter, and the vulnerability worth exploiting.

**Remarkable** — The secret. True origin, an unexpected lever, a weakness nobody
would guess. Still actionable: a secret you cannot use is trivia.

**Phenomenal** — The secret and what it opens onto: a name, a connection, a
reason this thing is *here*, a hook to pull on later.

## Pitch it to what the subject actually is

Use the level, rarity and statistics to decide **how much is knowable at all**.
This is what separates a real ladder from a generic one.

- **A common, low-level creature has no cosmic secret.** Nobody holds forbidden
  knowledge about a goblin. For ordinary things the top bands get *smaller and
  more specific*, not grander: a local name, a habit, where they nest, the one
  trick that works. A concrete local truth beats an invented prophecy.
- **A rare, unique or high-level subject can carry real weight.** Origin,
  conspiracy and campaign consequence are earned here.
- **Fame is not power.** A famous creature is well known at the *bottom* bands —
  even a poor roll recognises a dragon. An obscure one may be barely
  identifiable at Passable, and saying so is a legitimate answer.
- **Commonness sets the floor.** Seen weekly in the region, and everyone knows
  it plainly; last seen a century ago, and it is rumour at best.

## Rules

1. **GM's narrating voice, addressing the character as "you".** Short, concrete,
   sayable out loud. No stat-block formatting, no rules jargon players would not
   hear.
2. **Types, never numbers.** "Fire scars it and it does not heal", not "weakness
   10 fire". "Slow to dodge", not "Reflex +12".
3. **Never invert a real fact at Inept.** Wrong in *flavour* — a mistaken
   origin, a garbled name, a rumour — never a lie that reverses a weakness or a
   save. A character who acts on it should be unlucky, not punished.
4. **Do not contradict a supplied statistic.** Invent freely in the gaps,
   especially at the deepest bands.
5. **Do not name the band inside its own paragraph.** The GM reads the prose,
   not the label.

## Subjects without a statblock

Journals, places, factions and topics have no level, rarity or traits, and that
is fine — the feature resolves them against competence checks rather than DCs.
Lean harder on the user's own context and let the climb carry the structure:
what the region says about the place, what a traveller might know, what is
actually buried there.

## Non-negotiables

- Never invent a mechanical fact that contradicts a supplied statistic.
- Never emit numbers as player-facing prose.
- Never add a band, rename a heading, or drop the `<!-- glrk:2 -->` line — the
  parser matches on all three.
