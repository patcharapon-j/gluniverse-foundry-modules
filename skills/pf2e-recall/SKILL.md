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

1. **Every paragraph is the whole answer for that roll.** Not merely readable
   cold — *complete*. From Passable up, each band carries everything the bands
   below it would have told the player, then adds its own layer. Read only the
   Remarkable paragraph and the player must still learn what the thing is, how
   it fights and how it dies, as well as the secret. A band that delivers the
   payoff without the setup forces the GM to read a second paragraph, which is
   the one thing they cannot do.
2. **Each band must add something the one below it did not have.** The carried
   material is shared by design; the new layer is not. A band that adds nothing
   its predecessor lacked wastes that roll.
3. **The word budget climbs, because the carry costs words.** Disastrous 15–45,
   Inept 30–60, Poor 30–60, Passable 30–65, Solid 50–90, Impressive 70–120,
   Remarkable 90–150, Phenomenal 110–180. One paragraph, no bullets, no internal
   headings. Carried layers arrive as a clause each, never re-told at length;
   the newest layer always gets the most words. The common rolls stay brisk; the
   rare ones are allowed to stop the table, which is what they are for.

**Carrying is not concatenating.** Write each band from the top with everything
it knows in hand — identification as a clause, weakness as a clause, tactics as
a sentence, the new material as the rest — rather than pasting the shallower
paragraph and bolting sentences onto it.

## The shape

```markdown
# Recall Knowledge: <Subject>
<!-- glrk:2 -->

## Disastrous
<one paragraph, 15-45 words>

## Inept
<one paragraph, 30-60 words>

## Poor
<one paragraph, 30-60 words>

## Passable
<one paragraph, 30-65 words>

## Solid
<one paragraph, 50-90 words>

## Impressive
<one paragraph, 70-120 words>

## Remarkable
<one paragraph, 90-150 words>

## Phenomenal
<one paragraph, 110-180 words>
```

## How the knowledge reaches the player

Before writing anything, settle **who is speaking and what the knowing is made
of**. The bands say how much is known; this says how it arrives, and it changes
the content, not just the wording. If the user pasted a prompt from the feature
it names the presentation in the GM's own words — those words win, and anything
listed under them is background. If they have not, ask, or default to the
character's own memory.

When the description is the user's own rather than one of the rows below, work
out the same four things from it — speaker, what the knowledge is made of, how
*that* source goes wrong, and whether there is anyone to address at all — instead
of assuming a person is remembering. Five of the six rows below are not a person.

| Presentation | Speaker | Made of | How it goes wrong |
|---|---|---|---|
| The character remembers | you, to the character | memory: taught, overheard, half kept | misremembering, rumour, two creatures confused |
| Worked out on the spot | you, as they examine it | remains, tracks, damage, smell | a confident misreading of real evidence |
| Research | the book or expert, quoted | entries, monographs, marginal notes | an outdated entry, or the facing page |
| Console or system log | the system, to nobody | catalogue entries, sensor returns, logs | a corrupted record, a redacted field, the wrong specimen matched with total confidence |
| Vision or augury | you, describing what is shown | images that arrive whole | a true image, misread — the vision does not lie |
| Bestiary / stat readout | the entry itself | catalogued statistics and rules text | a typo, an erratum, a superseded printing |

The fourth column is the one people forget. A terminal does not misremember and
an augury does not repeat gossip, so the two false bands must fail **the way
that source fails**, not the way a person does.

## What goes in each band

The bands are Flatfinder competence bands: the roll total lands in one, and that
band is the answer. They describe **how widely a fact is known in the world**,
climbing from what a farmhand repeats to what nobody alive should know.

Each band is **what it carries up from below** plus **what it adds**. The bottom
two are false answers and carry nothing.

**Disastrous** — *Carries nothing.* No frame of reference at all. Funny rather
than cruel: a blank, a wrong category, a confident guess about something else.
Must contain **no true fact whatsoever**, not even the creature's kind. The only
band allowed to be a joke.

**Inept** — *Carries nothing true.* Confidently wrong: a plausible,
folklore-shaped belief the character would act on — a mistaken origin, a garbled
name, an inflated rumour, an outright misidentification.

**Poor** — *The floor of true knowledge.* The reputation, hedged: what people
say, with visible uncertainty. True in outline, vague in detail. No tactics.

**Passable** — *Carries the reputation, now said plainly*, and **adds** the
identification: what it is and what it is known for. Still no tactical content.

**Solid** — *Carries the identification and what it is known for*, and **adds
one** useful thing: the damage type that hurts it, the save it is worst at, or
the one defence worth planning around. One only. Heard alone, the player still
knows what they are looking at and has one lever.

**Impressive** — *Carries the identification and that useful fact*, and **adds**
how it actually fights: the signature mechanic that defines the encounter and
the vulnerability worth exploiting. Read alone it is a complete tactical
briefing.

**Remarkable** — *Carries the identification, the useful fact and how it fights*
— compressed to a clause or two each — and **adds** the secret: true origin, an
unexpected lever, a weakness nobody would guess. Still actionable: a secret you
cannot use is trivia. The player leaves knowing both how to fight it and what it
really is.

**Phenomenal** — *Carries everything Remarkable carries* — what it is, how it
fights, how it dies, the secret — and **adds** the thread that leads somewhere:
a name, a connection, a reason this thing is *here*, a hook to pull on later.

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

These hold whatever the presentation is:

1. **No interiority.** Describe the world and what is known of it, never what the
   character feels, notices in themselves, or decides. "Your blood runs cold" is
   the GM's line to write; taking it is taking the scene from them.
2. **No advice.** State what is true, do not say what to do about it. "Only fire
   keeps a wound shut" — not "so you should burn it".
3. **Plain and concrete, sayable in one breath.** Immersion comes from specific
   images — a smell, a mark on the ground, the detail nobody would invent — never
   from ornament. Write nothing the GM must perform to make it land; the mood is
   theirs to add.
4. **Types, never numbers.** "Fire scars it and it does not heal", not "weakness
   10 fire". "Slow to dodge", not "Reflex +12". The bestiary/stat readout
   presentation is the single documented exception: a readout that refuses to
   print a number is not one.

The presentation owns the rest — **speaker, addressee and register**. Where it
disagrees with how these usually sound, the presentation wins.
5. **Never invert a real fact at Inept.** Wrong in *flavour* — a mistaken
   origin, a garbled name, a rumour — never a lie that reverses a weakness or a
   save. A character who acts on it should be unlucky, not punished.
6. **Do not contradict a supplied statistic.** Invent freely in the gaps,
   especially at the deepest bands.
7. **Do not name the band inside its own paragraph.** The GM reads the prose,
   not the label.
8. **Never hand back a fragment.** From Passable up, a paragraph that identifies
   nothing, or that gives the secret with no idea how to fight the thing, is not
   a shorter answer — it is an incomplete one, and the GM has no second
   paragraph to fix it with.

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
- Never write a deep band as only what that rung adds. Every band from Passable
  up must be readable as the entire answer to "what do I know about this?".
