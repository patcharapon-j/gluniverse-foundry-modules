# Recall Knowledge — the lore ladder

`features/pf2e-recall/` is a GM prep-and-play tool. It turns any Actor,
JournalEntry, Item or Scene into a **three-tier lore ladder** authored with
Claude through the clipboard, and reads the right slice of it back at the table
according to the roller's Flatfinder competence band.

It is GM-facing. Nothing is posted to players, nothing is auto-rolled, and no
statblock values are revealed — the GM reads the tier and narrates it in their
own voice. Auto-delivery turns lore into a loot drop.

## The tier model

| Tier | Label | Content | Bullets |
|---|---|---|---|
| 1 | Everyone knows | What it is, and what it is known *for* — reputation, rumour | 3–4 |
| 2 | One might know | How it fights and how it dies | 2–3 |
| 3 | Very few know | The secret: true origin, an unexpected lever, a hook | 1–2 |
| — | Misremembered | One plausible, folklore-shaped wrong belief | 1 |

**Mechanics sit in the middle, not at the top.** This is the load-bearing
decision and it is deliberate. The best-known community DC ladder puts ecology
and society at its *hardest* rung, and Stonetop's "Very few know" is likewise
the secret rather than the statistic. Because tier 2 is the *typical* roll, the
common outcome is actionable — satisfying Paizo's own standard that a Recall
Knowledge answer must be something you can act on — while the rare roll buys
story instead of numbers.

Tier naming follows the "Everyone knows / One might know / Very few know" device
from **Stonetop** by Jeremy Strandberg (Lampblack & Brimstone), used here as a
structural idiom with credit. The tiers describe **how widely a fact is known in
the world**, not how well the player rolled — that framing is what makes them
read as lore rather than as a success table, and it is why they should not be
casually reskinned.

## Band → reveal

Flatfinder already maps a PF2e skill-check total onto one of eight competence
bands (Lore +1 band, natural 20 +1, natural 1 −1). This feature adds only the
right-hand column.

| Band | Total | Depth | Mode |
|---|---|---|---|
| Disastrous | < 0 | — | `blank` — nothing at all |
| Inept | 0–4 | — | `wrong` — the misremembered line, or a mistaken identity |
| Poor | 5–9 | 1 | `hedged` — tier 1, delivered with visible uncertainty |
| Passable | 10–14 | 1 | `clean` |
| Solid | 15–19 | 2 | `clean` |
| Impressive | 20–24 | 2 | `lead` — clean, plus a nudge that more exists |
| Remarkable | 25–29 | 3 | `clean` |
| Phenomenal | 30+ | 3 | `bonus` — plus the GM's own secret |

Three authored tiers, eight distinct table experiences. `tools/recall-check.mjs`
asserts that **no two bands resolve identically** — a duplicate `(depth, mode)`
pair means two bands are indistinguishable in play, which defeats the point of
using competence checks at all.

`blank` and `wrong` are split rather than collapsed because Flatfinder's own
band flavour distinguishes them: *Unbelievably bad* is comically disconnected
from the question, where *Gross* is wrong but engaged. Giving no information is
also explicitly permitted by the remaster on a critical failure, so the bottom
rung stays rules-legal.

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

- `actor.getFlag(SUITE_ID, "rk.ladder")` — the ladder
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
> `exportRecallKnowledge`). If this feature wrote a *tiered* ladder under the
> same heading, that exporter would scrape it and round-trip tiered prose back
> out as `{dc, skills, text}` entries — silent corruption of a documented
> format. Both keys are **data**. `tools/recall-check.mjs` asserts they differ.

Only **Actors** get a mirror. A JournalEntry, Item or Scene has no GM-only prose
field, and writing into their public description would leak the ladder to
players. Those subjects are flag-only.

Existing statsblock-import entries are offered to the generation prompt as **raw
material**, never auto-migrated into tiers: a `DC 20` line carries no reliable
tier signal, least of all under PWoL.

## The grammar

`prompt.mjs` emits it and `parse.mjs` reads it. The payload is **self-contained
and authoritative** — it carries the full spec every time, so a GM can paste
into claude.ai with nothing installed. `skills/pf2e-recall/` is a thin wrapper
over the same grammar for Claude Code users; if the two disagree, `prompt.mjs`
wins.

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

The parser is **strict about structure, forgiving about noise**. A wrapping code
fence, `*` instead of `-`, a bold lead-in, and trailing commentary are all
absorbed, because none of that should cost the GM a re-paste. What is *not*
absorbed: an unrecognised heading closes the current section rather than letting
its bullets leak into the wrong tier, and an empty ladder is refused outright
rather than half-stored.

## Mistaken identity

On a `wrong` band the authored Misremembered line always wins — a specific lie
about *your* creature beats a generic misidentification. When a creature has
none, `mistaken.mjs` finds a **real, similar creature** and answers as though
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
`GLRK.parse.warn.emptyTier.*`) are built at runtime, so nothing else catches a
missing key; and the heading collision above corrupts world data with no error
at all.
