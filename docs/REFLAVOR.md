# Reflavor — the rung ladder

`features/statsblock-import/reflavor.js` turns any NPC or hazard into a prompt
you paste into Claude, and the answer back into a creature. It is the same loop
as `pf2e-recall`'s: nothing calls a model, nothing imports automatically, and
the GM reviews what came back in the importer's own preview.

It is owned by `statsblock-import` rather than being its own feature, because
its output has nowhere to go without that importer. A separate feature would
make "reflavor enabled, importer disabled" a reachable state that produces a
payload and a dead end.

## The ladder

The rungs are defined by **what may move**, not by how creative to be. A model
cannot calibrate "change it a moderate amount"; it can obey "do not change any
number". Each rung inherits the permissions of the one below and states its own
floor explicitly.

| Rung | May change | Floor |
|---|---|---|
| 1 Reskin | the name, and every `Description:` | every number, every `Traits:` line, every block name |
| 2 Retheme | + block names, traits, damage and condition types | every numeric value; the block count per section |
| 3 Rebuild | + the kit: blocks replaced, added, removed; rule elements rewritten | `Level:`; each statistic's benchmark tier; the action economy |
| 4 Retune | + `Level:`, and every number to the new level's row | the tier column each statistic sits in |

**Traits are frozen at rung 1.** They read like flavour and are not: in PF2e
they drive weaknesses, resistances and automation. Rung 1 is the rung whose
promise is "nothing mechanical moved", and a trait swap breaks it.

**Rung 4 is unavailable for hazards.** It retunes against the Building
Creatures tables, and no hazard tables exist anywhere in this repository.
Offering it would emit creature AC and HP rows for something built on a
different scale — confidently wrong, which is worse than a disabled control.
Rung 3 on a hazard gets an explicit "no benchmarks available, hold every
number" notice in place of the rows, because a silent omission would read as
permission.

## What the payload carries

- The **whole exported stat block**, verbatim. Not a summary: Create builds the
  new creature from this text alone, so a section left out is a section the new
  creature does not have.
- The **grammar for exactly the sections that stat block uses**, and no others.
  A GM reflavouring a common goblin should not be reading the `## Engine` spec,
  and a section whose grammar is absent is one the model has no reason to
  invent.
- The **rung rules**, permits and freezes both.
- The **GM's concept**, which is the highest-value line in the payload and is
  required above rung 1. Without it, a rung that permits change is just an
  unpredictable rewrite.
- At rungs 3 and 4, the **Building Creatures rows** for the statistics the
  creature has, every tier, with this creature's own position marked.

Everything in `reflavor-prompt.js` is **English data, not copy**. It is
parse/format vocabulary the importer's parser depends on; a translated field
name teaches the model a field that does not parse, and every reflavour then
fails at once. Only the dialog's own labels are localized.

### Locked sections

`## Engine`, `## Phases` and `## Recall Knowledge` are reproduce-verbatim at
rungs 1–2, rename-only at rung 3, and retunable at rung 4. They carry
automation this feature has no business rewriting on a reskin.

### Benchmarks must be un-flattened

`Benchmarks.resolve()` subtracts level under Proficiency-without-Level. That is
right when *generating* a number and wrong when *comparing* one: an actor's
statistics sit un-flattened on disk. Worse, its PWoL detection reads
`game.pf2e.settings.variants.pwol.enabled`, which `pf2e-flatten` never sets —
so in this suite's own worlds it returns un-flattened rows **by accident**, and
in a world using the system's own variant it would return flattened ones that
silently disagree with the stat block printed beside them.

`Benchmarks.rawRow()` exists for this. `tools/reflavor-check.mjs` fails if the
payload builder ever calls the flattening pair.

**HP is not covered.** The Building Creatures HP table is not embedded in this
suite. The payload says so rather than staying quiet, because silence about a
constraint reads as the absence of one.

### Tier classification reports "between"

`classifyTier()` does not snap to the nearest column. A creature sitting
between High and Extreme, told it is simply "High", would be anchored a whole
tier low at rung 3 with nothing on screen to show it happened. Saying "between
moderate and high" lets the model hold the real position — and lets it notice
when the classification disagrees with the number beside it.

## The output contract, and why prose cannot go in the paste

The model is told to put the stat block in **one** ` ```markdown ` fence and
write its change summary **outside** it.

This is forced by the parser, not by taste. `parseTopLevelField` gates only
`abilities`, `skills`, `engine` and `defense` by section; everything else falls
through to a `switch (slug)` that is **not section-gated**. A line reading
`Level: raised it to 8` therefore rewrites the creature's level from under any
heading, including one that looks like a change log. Inside a `###` block with
`Description:` open it is worse: unrecognised lines are appended to that
description, so the report lands in an ability's prose. Both failures are
invisible.

There is no safe position for prose inside the pasted text. The fence is what
separates them, and the change summary stays in the chat where the GM is
already reading it.

`parseStrictMarkdown` peels one wrapping fence off its input, so a GM who
copies the markers too does not end up with ``` ``` `` in an ability
description. `pf2e-recall`'s parser absorbs a wrapping fence for the same
reason.

## The hand-off, and why Create

The dialog's "Open importer" button opens the importer primed for the source
actor. **Create a new actor** is the steer.

Update is the footgun. `importItems` matches on `itemKey()`, which is
`type:slug(name)` — so a reflavour that renames abilities matches nothing, and
`replaceMatching` (the importer's default) leaves the old kit sitting beside
the new one. When a reflavour hand-off does reach Update, the item mode is
**forced to `replaceAll`**, which is the only mode whose behaviour is correct
under renaming, and the GM is told it happened.

## Storage

- `sbi.reflavor` — `{context, rung, level}`, the GM's intent, so redoing a
  reflavour is not retyping it. Same reasoning as `rk.context`.
- `sbi.reflavor.origin` — `{uuid, rung}`, written on the imported actor when
  the GM came through the hand-off. It is what makes a folder of variants
  navigable months later.

Intent is persisted for **world actors only**. A compendium source is usually a
locked bestiary pack, and writing a GM's prep into a shared pack would be wrong
even where it is possible. The cost is retyping the concept when reflavouring
the same compendium entry twice.

Provenance is absent when the GM pastes into a fresh importer window instead of
using the hand-off. That degrades quietly rather than warning: a hand-written
stat block has no origin either.

## Compendium rows

v14's `Compendium` application extends `DocumentDirectory` and fires the **same**
`get<Type>ContextOptions` hook as the sidebar, so an entry registered for the
sidebar appears on compendium rows too. Their ids are not in `game.actors`, and
their documents load from the pack asynchronously.

`resolveDirectoryDocument(app, li)` reads the collection off the application and
handles both. Reflavouring a bestiary entry is the central use case, so this is
not an edge.

> This also fixed a pre-existing bug: `statsblock-import`'s own "Import stat
> block" entry already appeared on compendium actors and failed there with a
> misleading "that type only" warning.

## Deliberately out of scope

No in-app model call · no automatic import · no batch or folder-wide reflavour ·
no art or token suggestion · no sheet header button · no in-place edit of the
source · no rung-1 "no digit changed" verification.

That last one is deferred rather than rejected. Rung 1 promises the diff touches
no digit, which is checkable — but it belongs beside the parser, in the
importer's existing validation surface, not in a second one built here.

A reflavoured creature also **does not inherit a `pf2e-recall` lore ladder**.
That ladder lives on a flag the exporter cannot see, so it cannot travel. The
dialog says so rather than letting it be discovered.

## Validation

```bash
node tools/reflavor-check.mjs
```

Zero problems required. Everything it covers fails silently: grammar drifting
from the parser's real field names (which breaks every reflavour at once and
reads as the model getting worse), benchmark rows emitted flattened beside
un-flattened numbers, rung 4 reaching a hazard, and the fence rule going
missing from the output contract.

It cannot check what a reflavour *reads* like. Only a session can.
