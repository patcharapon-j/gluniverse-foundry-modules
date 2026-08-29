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

| Band | Total | Carries | Adds | Words |
|---|---|---|---|---|
| Disastrous | < 0 | — | Nothing at all. No frame of reference, played for comedy, containing no true fact. | 15–45 |
| Inept | 0–4 | — | Confidently wrong: a folklore-shaped belief the character would act on. | 30–60 |
| Poor | 5–9 | — | The reputation, hedged. True in outline, vague in detail. No tactics. | 30–60 |
| Passable | 10–14 | the reputation, unhedged | Plain identification: what it is and what it is known for. | 30–65 |
| Solid | 15–19 | + identification | **One** useful thing — a damage type, a weak save, a defence. | 50–90 |
| Impressive | 20–24 | + that useful fact | How it actually fights: the signature mechanic and the vulnerability. | 70–120 |
| Remarkable | 25–29 | + how it fights | The secret: true origin, an unexpected lever, something not in any bestiary. | 90–150 |
| Phenomenal | 30+ | + the secret | What it opens onto — a name, a connection, a hook. | 110–180 |

Flatfinder already maps a PF2e skill-check total onto one of eight competence
bands (Lore +1, natural 20 +1, natural 1 −1). This feature adds only the
right-hand column.

### Each paragraph is the whole answer, not the top slice of one

The GM reads **one** paragraph, so that paragraph has to be a complete answer to
"what do I know about this?". From Passable up, every band **carries everything
the bands below it would have told the player** — compressed to a clause each —
and then adds its own layer.

v2.0 got this wrong. It told the model each paragraph must "stand alone",
meaning *readable cold*; the model read it as *say only what this rung adds*,
and the deep bands came back as a secret with no identification, no weakness and
no tactics. That is unusable at the table: the GM is holding the payoff without
the setup, and the only way to give the player a whole answer is to read the
lower bands too — the exact failure the band model exists to remove. v2.1 states
the carry explicitly, band by band, and pays for it with a word budget that
climbs from 15–45 at Disastrous to 110–180 at Phenomenal.

The ceiling is still what a GM can say without skimming — roughly two seconds
per ten words — but it is not the same ceiling at every rung: the common rolls
stay brisk and the rare ones are allowed to stop the table, which is what they
are for. Carrying is not repeating:
the shallower layers arrive as a clause each, the newest layer takes the rest,
and each band is written from the top rather than concatenated onto the one
below. `BAND_WORDS` is the table, `tools/recall-check.mjs` asserts it never
narrows as the ladder deepens, and the parser warns when a stored paragraph runs
past its own band's budget by more than `OVERLONG_FACTOR`.

The bottom two bands are false answers and carry nothing: Disastrous holds no
true fact at all and Inept is confidently wrong, so accumulating into them would
be self-defeating. Poor is the floor of true knowledge.

The grammar version is **unchanged at 2**. Nothing about the document's
structure moved — a v2.0 ladder still parses and still plays — so flagging every
existing one as a version mismatch would be noise. Regenerating a subject is
what upgrades it.

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

v1 was right that knowledge accumulates, and v2.1 keeps that (see above); what
it does not keep is making the GM assemble the accumulation at the table.

The Stonetop headings are retired, but the shape of the climb they describe still
governs the band guidance, and the credit stands.

### Uniqueness is the load-bearing property

The payload demands each band add something the one below it did not have, the
parser warns when two come back identical, and `tools/recall-check.mjs` asserts
it of its own sample. Two bands that read the same are two rolls that play the
same, which defeats the point of using competence checks at all.

The parser also warns when a deeper band looks like it **dropped** the carry —
near-zero content-word overlap with the band below it, from Passable up. It
warns and never refuses: every other refusal in `parse.mjs` is structural (no
headings, nothing parsed), while this one is a heuristic over prose, and a
heuristic that blocks a GM's paste mid-prep is worse than a ladder they can see
and regenerate. It is also deliberately blind to the presentation — a console
log writes `SPECIMEN 4471-B` where a memory writes the creature's name, so
anything demanding the literal name back would warn on every well-written
science-fiction ladder, and a warning that cries wolf is ignored on the day it
is right. It fires late and misses rather than nagging.

Since v2.1 the property is about the **new layer**, not the whole paragraph:
material is shared up the ladder by design, so two deep bands will legitimately
overlap in what they carry. What must differ is what each one adds. The check
also asserts the sample's top five bands still name the subject and keep the
weakness the middle bands establish — the cheapest observable proof that the
example being taught is a whole answer rather than a fragment.

### How the knowledge reaches the player

The bands say how *much* is known. `PRESENTATIONS` says how it **arrives**: the
character's own memory (the baseline), what they work out on the spot, research
in books or from an expert, a console or system log, a vision or augury, or a
deliberate bestiary-style readout.

This is not tone, and that is why it is a table rather than an adjective. The
presentations disagree about *epistemology*: a character misremembers, but a
terminal does not — it returns a corrupted record or a confident match against
the wrong specimen. So each row carries four fields the payload prints verbatim:
**speaker**, **evidence** (what the knowing is made of), **falsehood** (how
Disastrous and Inept go wrong *for this source*), and **address**. The falsehood
column is the one that earns the table; a single generic "be wrong in flavour"
rule visibly breaks the moment the speaker stops being a person.

It follows `features/statsblock-import`'s `RUNGS` deliberately, including its
stated reason: a model cannot calibrate "make it feel like a terminal", but it
can obey "the system is never unsure; it is wrong with total confidence".

**Baked in, not overlaid.** The module holds no runtime model access — the
payload is copied out and the reply pasted back — so stored prose cannot be
re-voiced at read time. The presentation is therefore an authoring input, and
`writeLadder` stamps the one actually used into the record. The Read tab reports
that stamp, and says so when the Generate tab's picker has since moved: the
ladder is not wrong, it was written the other way. A ladder with **no** stamp
predates the feature and reads as unknown rather than stale — claiming it was
authored as `recall` would put a false warning on every existing ladder in every
world.

**Stored as one flag.** `rk.presentation` holds `{key, note}` together, the way
statsblock-import keeps `{context, rung, level}`: one intent, and redoing half of
it should not mean retyping the other half. It stays separate from `rk.context`,
which is about what is *true* at this table rather than how it is delivered — a
GM switches presentation while the campaign facts stay put. Two world settings
(`rk.defaultPresentation`, `rk.defaultPresentationNote`) supply the default, so a
campaign that is entirely ship's logs is configured once rather than per
creature.

**The numbers exception.** `readout` is the single presentation permitted to
state numbers, declared as a field rather than left to judgement, because a
readout that refuses to print one is not a readout. `tools/recall-check.mjs`
asserts it is the only one.

### The tone floor, and what the presentation owns

The payload's rules are split in two, because leaving the split implicit forced
the model to break one rule or another silently — a terminal log addressing the
character as "you" is not a terminal log.

**Invariant, whatever the presentation:** types never numbers (except `readout`)
· no interiority — the world and what is known of it, never what the character
feels or decides · no advice — what is true, not what to do about it · plain,
concrete, sayable in one breath · no contradicting the statistics · no band named
inside its own paragraph · cumulative from Passable up.

**The presentation's to set:** speaker, addressee, register.

The first two invariants are the ones that keep the GM's voice theirs. "Your
blood runs cold" is the GM's line to write, and "so you should burn it" is the
player's call to make; a paragraph that takes either has stopped being
information and started being performance. Immersion is carried by *specific
images* instead — a smell, a mark on the ground, the detail nobody would invent —
which is a floor rather than a style, so a presentation can set the register
without the prose ever going purple.

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

### The matrix previews the tail

The Read tab's matrix shows every band at once, clamped to two lines. Since the
bands became cumulative they all *open* with the same identification clause, so
the preview shows the **end** of each paragraph instead — the layer that rung
adds lands last, and the tail is the only part that distinguishes one row from
the next.

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

- `actor.getFlag(SUITE_ID, "rk.ladder")` — `{name, bands, presentation, generatedAt}`,
  where `bands` maps each competence band key to its paragraph and `presentation`
  stamps the one it was authored under (absent on pre-v2.2 ladders)
- `rk.context` — the GM's free-text steer, persisted so regenerating never means
  retyping it
- `rk.presentation` — `{key, note}`, how the knowledge reaches the player
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
