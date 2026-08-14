# Postures

A **Posture** is a named state a creature occupies. It holds the creature's
changing behaviour so the GM does not have to, and — because Foundry renders it
as an effect badge on the token — it announces itself to the table without
anyone reading a rule aloud.

Postures replace `## Phases` as a concept. A boss phase is simply a Posture with
no exit.

> **The Posture you are standing in is the tell.**
> That one sentence is why this mechanism exists. It collapses "how do I
> telegraph the Ultimate?" and "how do I explain the engine without a lecture?"
> into a single object that is already on the screen.

## Why not a flat priority list

A flat "if X do A, else B" ladder is a lookup table: it has no memory, so the
creature behaves identically in round 1 and round 6. A Posture map gives the
creature **memory** — it is *in* a state, and what it does depends on which.

It also **bounds reading rather than expanding it**. At any moment the GM reads
only the current Posture's two rungs. A four-Posture creature is never four times
the reading; it is two lines, four times over the fight.

## Anatomy

```markdown
### Posture 2 — Undertow
Trigger: A creature within 30 feet is off-guard at the start of its turn.
Traits: water, emotion
Description: *The deck water stops sloshing and starts pulling, all of it one
direction, toward her.*

**Ladder**
1. A creature within reach is off-guard → **Riptide Cut**.
2. Otherwise → Stride, then Strike.

**On entering** She gains 1 Tide.
**Exit** None — she remains in Undertow until Break.
```

Three parts, all required:

| Part | Rule |
|---|---|
| **Entry trigger** | One observable event. Goes in `Trigger:`. |
| **Ladder** | **Exactly two rungs.** The last is unconditional. |
| **Exit** | Where it goes next, or `None`. |

### The ladder

- **Two rungs. The second is unconditional**, so the creature can never stall
  and the GM never has to improvise mid-fight.
- Rung 1 is the *interesting* line; rung 2 is the fallback.
- Write them as imperatives naming a printed ability. Not "consider attacking" —
  *"Stride, then Strike."*
- A rung may not contain a sub-condition. If you need three outcomes, that is a
  second Posture, not a longer rung.

A `boss` may take **three** rungs in the Posture that contains its Ultimate, so
that `resource is full → Ultimate` can sit at the top. That rung *is* the
telegraph — the players can read it off the table.

### Entry triggers

Same discipline as the Combo menu: prefer observable, prefer conditions.

Good: *reduced to half HP · a creature within 30 ft is off-guard · it has taken
fire damage this round · the Break bar empties · an ally within 30 ft drops to
0 HP · it has spent its Ultimate · a destructible part is destroyed.*

Bad: *at the start of round 3* (a round count is not a fiction) · *when the GM
decides* (not observable) · *when two of the following are true* (a compound
condition is a second Posture).

## Linear only, for now

Postures currently run **one-way**. `A → B → C`, no back-edges.

This is a tooling constraint as much as a design one: the importer's `## Phases`
section stores an ordinal and a verbatim trigger string, which is exactly a
linear node list, and a real graph would need a parser change plus a matching
exporter plus a round-trip test.

It is also the right place to start. One-way escalation is what phases were
always for, and a creature that can cycle back is a genuinely different creature
— worth designing deliberately rather than by accident. Revisit after Postures
have run at a few tables.

**Consequence to design around:** a Posture you can never leave must still be
playable for the rest of the fight. If Posture 3 is a berserk state with no exit,
it needs a ladder that stays interesting for four rounds, not a one-shot gimmick.

## Counts by tier

| Tier | Postures |
|---|---|
| `background` | **1** — a single unconditional line. That *is* the Posture. |
| `standard` | 2 |
| `elite` | 3 |
| `boss` | 3–4 **per phase** |

A `background` creature's single Posture is one line long and is the entire
reason mooks stop causing "what does this guy do again?" pauses four times a
round.

## Naming

Two hard constraints and one soft one.

**Never name a Posture after a PF2e condition.** The importer's auto-linker turns
every mention into a link to the actual rule, so a Posture called "Broken" links
to the damaged-equipment condition on every line. The reserved list:

```
blinded, broken, clumsy, concealed, confused, controlled, dazzled, deafened,
doomed, drained, dying, encumbered, enfeebled, fascinated, fatigued, fleeing,
frightened, grabbed, hidden, immobilized, invisible, off-guard, paralyzed,
persistent-damage, petrified, prone, quickened, restrained, sickened, slowed,
stunned, stupefied, unconscious, undetected, unfriendly, unnoticed, wounded
```

Inside Foundry the live `CONFIG.PF2E.conditionTypes` supersedes this list, so
treat it as a floor, not a ceiling. When in doubt, pick a different word.

**Never call a Posture a "Stance".** `stance` is a live PF2e trait with its own
meaning and rules text. Use "Posture" on the sheet; "node map" is fine as an
authoring term in conversation, but do not print it — this vault already uses
*node* for Alexandrian scene design and the two will cross-talk.

**Soft:** name it from the fiction, two words or fewer, and make it something a
GM can say out loud mid-fight. `Rising Tide` · `Undertow` · `Slack Water` beats
`Phase 2`.

## Break is a Posture

Emptying a boss's Break bar puts it into a Posture like any other. This replaces
the old "Break grants −2 and a lost turn" formulation, which `boss-design.md`
itself warns is *a reward, not a mechanic*.

Writing Break as a Posture forces you to author what the boss **does** while
broken. It has a ladder, same as every other state — just a bad one for it.

```markdown
### Posture 4 — Exposed
Trigger: The Break clock empties.
Description: *Something inside the shell stops keeping time. The plates hang
open on their own weight.*

**Ladder**
1. A weak point is intact → shield it with its own body; Strike once.
2. Otherwise → Stride away from the nearest creature.

**On entering** It loses its next turn entirely, takes −2 to AC and all saves,
cannot use reactions, and its weak points are exposed as targetable objects.
**Exit** At the end of its next turn, return to the Posture it left.
```

Note that this is the one sanctioned **back-edge**: Break returns the creature to
where it was. It is exempted because it is a temporary interruption rather than a
progression, and because the Break clock refilling is the thing that gates it.

## How Postures are written today

Until the importer gains a real `## Nodes` section, Postures ride in
`## Phases` — which already stores an ordinal (`sbi.phase`) and a verbatim
trigger (`sbi.phaseTrigger`) per entry, and accepts `Function:` tags.

```markdown
## Phases
### Posture 1 — Rising Tide
Trigger: Start of combat.
Description: …

### Posture 2 — Undertow
Trigger: A creature within 30 feet is off-guard at the start of its turn.
Description: …
```

Each becomes an inert passive item in the `interaction` category. **Nothing
activates a Posture automatically** — the importer has no state-machine concept.
The GM changes it by hand, and should mirror it as an effect on the token so the
badge is visible to the players. That mirroring is the part that does the work;
do not skip it because it is manual.

## Checklist

- Does every tier have at least its minimum Posture count?
- Does every ladder have exactly two rungs (three only for a boss's Ultimate
  Posture), with the last unconditional?
- Is every entry trigger a single observable event?
- Is every name outside `CONDITION_WORDS`, and not "Stance"?
- Is a Posture with no exit still playable for the rest of the fight?
- For a boss: does the Ultimate sit on a visible rung, so the telegraph is
  readable off the table?
- Is the current Posture mirrored as a token effect the players can see?
