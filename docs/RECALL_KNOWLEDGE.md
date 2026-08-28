# Recall Knowledge — the lore ladder

`features/pf2e-recall/` is a GM prep-and-play tool. It turns any Actor,
JournalEntry, Item or Scene into **eight short read-aloud answers** authored with
Claude through the clipboard, and reads the right slice of it back at the table
according to the roller's Flatfinder competence band.

It is GM-facing. Nothing is posted to players, nothing is auto-rolled, and no
statblock values are revealed — the GM reads one paragraph and narrates it in
their own voice. Auto-delivery turns lore into a loot drop.

## The band model

**One short paragraph per competence band, and the GM reads exactly one.**

| Band | Total | What it knows |
|---|---|---|
| Disastrous | < 0 | Nothing at all. No frame of reference, played for comedy, containing no true fact. |
| Inept | 0–4 | Confidently wrong: a folklore-shaped belief the character would act on. |
| Poor | 5–9 | The reputation, hedged. True in outline, vague in detail. No tactics. |
| Passable | 10–14 | Plain identification: what it is and what it is known for. |
| Solid | 15–19 | Identification plus **one** useful thing — a damage type, a weak save, a defence. |
| Impressive | 20–24 | How it actually fights: the signature mechanic and the vulnerability. |
| Remarkable | 25–29 | The secret: true origin, an unexpected lever, something not in any bestiary. |
| Phenomenal | 30+ | The secret and what it opens onto — a name, a connection, a hook. |

Flatfinder already maps a PF2e skill-check total onto one of eight competence
bands (Lore +1, natural 20 +1, natural 1 −1). This feature adds only the
right-hand column.

### Why paragraphs rather than tiers of bullets

v1 authored three cumulative tiers — the "Everyone knows / One might know / Very
few know" device from **Stonetop** by Jeremy Strandberg (Lampblack & Brimstone) —
and derived eight table experiences from them by unlocking progressively more
bullets.

It read well as a design and failed as a table tool. At the top bands the GM was
holding nine or ten bullets and asked to perform them mid-combat. Nobody does
that: they skim, pick two, and the authored depth is wasted. Worse, the bands
that shared a depth differed only in *delivery*, so two rolls five points apart
often produced the same content read two ways.

v2 authors all eight directly. Whatever the roll, the GM reads one paragraph
aloud and the scene keeps moving. The escalation that used to live in "how many
bullets you unlocked" now lives in what the paragraph is *about* — which is
where it always belonged, and it is why mechanics still sit in the middle of the
climb rather than at the top: Solid and Impressive are the common rolls and must
be actionable, while the rare roll buys story.

The Stonetop headings are retired, but the shape of the climb they describe still
governs the band guidance, and the credit stands.

### Uniqueness is the load-bearing property

The payload demands all eight paragraphs differ, the parser warns when two come
back identical, and `tools/recall-check.mjs` asserts it of its own sample. Two
bands that read the same are two rolls that play the same, which defeats the
point of using competence checks at all.

### Pitched to what the subject is

The payload tells the model to use level, rarity and statistics to decide **how
much is knowable at all**: a common low-level creature has no cosmic secret, so
its top bands get smaller and more specific rather than grander; a rare or
high-level subject can carry campaign weight; a famous creature is well known at
the *bottom* bands, and an obscure one may be barely identifiable at Passable.

Without that steer every subject produces the same shape of ladder, and a goblin
ends up with a buried prophecy.

### Delivery, and what survived from v1

`BAND_REVEAL` still maps each band to a delivery mode (`blank`, `wrong`,
`hedged`, `clean`, `lead`, `bonus`). It no longer selects content — the
paragraph is the content — but it colours the panel, drives the GM-facing hint,
and chooses the mistaken-identity fallback when a band was never authored. Modes
now repeat across bands, which is correct: three bands deliver `clean` and are
still entirely distinct, because they are three different paragraphs.

**A trained character cannot reach `blank` at all.** Under Proficiency-without-
Level, realistic skill modifiers run about +3 to +18 across levels 1–20, so the
practical centre of mass is bands 3–5 and it drifts up roughly two bands over
twenty levels. The bottom rung is what happens to someone entirely out of their
depth; the top rung is a late-game specialist's reward.

## Why this feature computes no DCs

Two independent reasons, either of which would be sufficient.

**1. Under PWoL the DC carries almost no signal.** `DC = 14 + level +
floor(level/3)`, so subtracting level collapses the whole range to `14 +
floor(level/3)` — **DC 14 to 20 across levels 0 through 20**. Rarity
(+2 / +5 / +10) is applied *after* flattening and therefore dominates: a unique
level-1 NPC (DC 24) is harder to identify than a common level-20 monster
(DC 20). Competence checks exist precisely for situations where inventing a DC
is the wrong move, and this is one.

**2. In this suite's own worlds the system's DCs are wrong anyway.**
`features/pf2e-flatten` implements PWoL as a PF2e **custom modifier on the
`"all"` selector** (`pf2e-flatten/constants.js`). It never sets
`game.pf2e.settings.variants.pwol.enabled` — which is exactly what the system's
`NPCPF2e#identificationDCs` reads to decide whether to flatten. So in a world
using `pf2e-flatten` rather than the system's own variant setting,
`actor.identificationDCs` returns **un-flattened** values, roughly double what
the table should see.

If a reference DC is ever surfaced in the UI, it must be labelled as the
system's own unadjusted number or corrected for that offset. Do not display it
raw. (The suite's only correct PWoL detection currently lives in
`clocks-tracker/support/benchmarks.js`; a third copy should move to
`core/util.mjs` rather than being pasted again.)

## Storage, and the heading that must not collide

The flag is the source of truth:

- `actor.getFlag(SUITE_ID, "rk.ladder")` — `{name, bands, generatedAt}`, where
  `bands` maps each competence band key to its paragraph
- `rk.context` — the GM's free-text steer, persisted so regenerating never means
  retyping it
- `rk.mistaken` — the cached misidentification pick

A **read-only mirror** renders into `system.details.privateNotes` so a GM who
disables the feature still finds their lore. On conflict the flag wins and the
mirror is rebuilt.

> **The mirror heading is `GLRK.notes.ladder`, and it must never equal
> `GLSBI.notes.recallKnowledge`.**
>
> `features/statsblock-import` recovers its own DC-keyed ladder by scraping
> `privateNotes` for that exact `<h3>` followed by a `<ul>` (see
> `exportRecallKnowledge`). If this feature wrote its *banded* paragraphs under
> the same heading, that exporter would scrape them and round-trip them back out
> as `{dc, skills, text}` entries — silent corruption of a documented format. Both keys are **data**. `tools/recall-check.mjs` asserts they differ.

Only **Actors** get a mirror. A JournalEntry, Item or Scene has no GM-only prose
field, and writing into their public description would leak the ladder to
players. Those subjects are flag-only.

Existing statsblock-import entries are offered to the generation prompt as **raw
material**, never auto-assigned to a band: a `DC 20` line carries no reliable
band signal, least of all under PWoL.

## What the payload carries

The brief is the **entire statblock**, not a summary. Solid and Impressive are
defined as "how it fights and how it dies", and that is unanswerable from a name
and an AC — the model has to see the attacks, the action economy and the spell
list to write them.

For a creature: level, rarity, size, traits · Perception with senses · languages
· **skills** · **ability modifiers** · items · AC · saves (with per-save notes
and which is lowest) · HP · immunities/weaknesses/resistances · **every movement
mode** · then three sections —

- **Attacks** — melee or ranged, attack bonus, every damage roll, range
  increment, area, traits (reach, agile, deadly) and attack effects.
- **Actions, reactions and passive abilities** — each labelled with its real
  cost (`one action`, `two actions`, `reaction`, `free action`, `passive`).
  Without the label a passive aura and a three-action ritual read identically.
- **Spellcasting** — each entry's tradition, preparation, DC and attack, plus
  **the actual spell list** grouped by rank, highest first, cantrips last.

**Hazards are a separate shape** and get their own extractor: stealth, hardness,
and the disable/routine/reset triad, with prose from `details.description`
rather than `publicNotes`. Extracting one as a creature yielded a near-empty
brief.

Field paths were verified against PF2e `template.json` at both **7.12.2** (the
installed version) and **8.4.1** (latest upstream); the NPC data model is
byte-identical between them, and the hazard model was checked against
`src/module/actor/hazard/data.ts` at the 8.4.1 tag.

Numbers are kept throughout. The "types, never numbers" rule governs what the
model is asked to *write*, not what it is allowed to *read*.

## The grammar

`prompt.mjs` emits it and `parse.mjs` reads it. The payload is **self-contained
and authoritative** — it carries the full spec every time, so a GM can paste
into claude.ai with nothing installed. `skills/pf2e-recall/` is a thin wrapper
over the same grammar for Claude Code users; if the two disagree, `prompt.mjs`
wins.

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

The parser is **strict about structure, forgiving about noise**. A wrapping code
fence, `*` instead of `-`, a bold lead-in, and trailing commentary are all
absorbed, because none of that should cost the GM a re-paste. What is *not*
absorbed: an unrecognised heading closes the current section rather than letting
its prose leak into the wrong band, and an empty ladder is refused outright
rather than half-stored.

**A v1 reply still parses.** Its three tiers are projected onto the bands and the
GM is told to regenerate. A v1 ladder already stored is likewise read in place
rather than migrated, so a world that rolls back to an older build still finds
it intact.

## Mistaken identity

On the Inept band the authored paragraph always wins — a specific lie
about *your* creature beats a generic misidentification. When a creature has
none — an un-prepped actor, or a partial paste — `mistaken.mjs` finds a **real,
similar creature** and answers as though
the target were that instead. The lie is then internally consistent, plausible,
and free, which directly addresses the most-cited GM complaint about Recall
Knowledge: improvising a convincing falsehood mid-combat is hard prep.

The scoring encodes three claims about how people misremember:

1. **Kind matters most** — shared traits at 10 points each. Zero overlap is
   rejected outright; "nothing comes to mind" beats naming something absurd.
2. **Silhouette is what a witness sees** — size gates first. Same size scores,
   one step off is penalised, two steps off is rejected however many traits it
   shares.
3. **You misremember toward the familiar** — common beats rare, because the
   character has plausibly heard the story.

Level proximity is the *weakest* term (1/level), because level is the one
property a witness cannot perceive. Nine levels of distance still costs less
than a single shared trait, so a famous elder kinsman stays a better mistake
than a same-level stranger.

The pick is cached on the actor: a wrong belief that changes every time it is
recalled is not a belief, it is a glitch. Uniques are never candidates —
"you think that's Treerazer" is not a misidentification, it is a plot event.

The technique is borrowed with credit from **GlassSpiderTV's `spider-vibes`**
(MIT), which is the only implementation known to have tried it.

## Deliberately out of scope

Chat delivery to players · player-initiated rolls · auto-rolling Recall
Knowledge · DC computation · statblock reveal state.

**Retry gating is deferred, not merely disabled.** The design allows an optional
"each further attempt needs one band higher" toggle, but v1 is GM-only viewing
and there is no event that honestly counts as *an attempt* — clicking a band
chip to read the ladder is not one. Rather than register a setting nothing
reads, it waits for the roll-driven path. Note also that the community record is
unambiguous that the real problem with Recall Knowledge is *under*-use rather
than spam, so a lockout treats a disease this feature does not have.

That last one is
[PF2e Bestiary Tracking](https://github.com/WBHarry/pf2e-bestiary-tracking)'s
job, and it does it well. The division of labour is clean: **that module reveals
the numbers, this one writes the story.**

## Validation

```bash
node tools/recall-check.mjs
```

Zero problems required. Everything it covers fails *silently* in a session: a
grammar that drifts between the emitter and the parser reads to the GM as "the
model got it wrong"; a band with no reveal rule falls through to the default and
shows the wrong depth; the two **dynamic** i18n families (`GLRK.mode.*`,
`GLRK.parse.warn.emptyBand.*`) are built at runtime, so nothing else catches a
missing key; and the heading collision above corrupts world data with no error
at all.
