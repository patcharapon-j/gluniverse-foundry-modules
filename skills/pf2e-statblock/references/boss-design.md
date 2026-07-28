# Solo boss design

Read this when the tier is `boss` **and** the creature is meant to carry an
encounter alone. A boss that fights alongside a retinue is just an `elite` with
a `## Phases` block — this file is about the solo set-piece.

Everything here assumes the suite's Proficiency Without Level setup
(`pf2e-flatten` + the `flatfinder` feature). Under PWL the level gap between a
party and a boss is worth far less than it is in stock PF2e, which changes the
arithmetic below in ways that are easy to get wrong.

## 1. The arithmetic that decides everything

The PWL creature XP table tops out at **party level +7 = 160 XP**. Budgets scale
at **+30 XP per character past four** for Severe.

| Bodies | Moderate | Severe | Extreme | Can one creature reach Severe? |
|---:|---:|---:|---:|---|
| 4 | 80 | 120 | 160 | yes |
| 5 | 100 | 150 | 200 | barely — PL+7 is 160 |
| 6 | 120 | **180** | 240 | **no — above the table's ceiling** |
| 7 | 140 | 210 | 280 | no |

**A combat-capable allied NPC counts as an additional party member.** Five PCs
plus one ally is six bodies, not five.

So for any party above five bodies, a solo boss is *structurally* under-budget —
and it is also getting 3 actions against 18. Both problems have the same fix.

## 2. The Apex template

Two turns per round: one at its initiative (**Turn A**) and one at
**initiative −10** (**Turn B**), three actions each. Roughly doubles the
creature's effective XP, so a level 9 Apex ≈ 144 XP and a level 10 Apex ≈ 180.

- **Tick timing** — anything that ticks at the *start* of a turn resolves at the
  start of Turn A; anything that ticks at the *end* resolves at the end of
  Turn B. Regeneration and persistent damage fire once per round, not twice.
- **MAP resets per turn.** This is the sharpest edge of the template — the boss
  gets two fresh attack chains. **Keep Strike damage at Moderate or below.**
  Extreme damage plus two turns kills a PC per round.
- **Reactions** — one per round as normal. Optionally it may spend one action on
  a turn to bank an extra reaction, at most once per turn.
- **HP — take the Low band and double it.** Moderate doubled is a wall: under
  PWL, PC damage does not scale with level as fast as creature HP does, so an
  over-HP'd Apex boss produces a long fight rather than a tense one.

| Level | Low × 2 | Moderate × 2 |
|---:|---:|---:|
| 7 | **180** | 238 |
| 9 | **240** | 318 |
| 11 | **300** | 398 |
| 13 | **360** | 478 |

Low HP costs one deviation from the tier's trade-off budget. Spend it here.

## 3. Break — a second, visible bar

Translated from HSR Toughness/Weakness Break. The creature carries a public
track that is *not* HP; emptying it puts the creature in **Break**, a short
window where the party can do something it otherwise cannot.

**Do not name the state "Broken".** `broken` is a real PF2e condition (damaged
equipment) and the importer's auto-linker will turn every mention into a link to
the wrong rule. Use "Break", "Staggered", "Exposed" — anything outside
`CONDITION_WORDS` in `importer.js`.

### Who moves the bar

| Model | Driver | Reach for it when |
|---|---|---|
| Boss-driven | No bar; the weak point simply opens on a fixed beat (e.g. every Turn B) | First boss that teaches the mechanic; a table that will not track another number |
| **Party-driven** | Qualifying **actions** drain it | You want every class to have its own lane into the mechanic |
| Damage-driven | Damage of matching types drains it | Rarely — see below |

**Damage-driven is a second HP bar.** Stacked on doubled Apex HP under PWL, that
is a three-hour fight. Prefer action-driven.

### The party-driven recipe

1. A **6-slice public clock**, starting full.
2. **Four ways to spend 1 slice, once per creature per round.** Pick them so
   every party member has a lane — a critical hit, a successful Athletics
   maneuver, damage of the creature's weak type, and *the first creature each
   round to succeed at Recall Knowledge* (which makes RK worth an action).
3. **At the end of any round without a Break, the bar refills by 1.** Pressure
   has to be sustained rather than dumped in one turn — and this replaces an
   arbitrary "max N per round" cap.
4. **At 0 → Break** until the end of its next Turn B: it loses its next Turn A
   entirely, takes −2 to AC and all saves, cannot use reactions, and its weak
   points are exposed.
5. **Break ends → the bar refills to full.**

Five or six bodies realistically drain 3–4 a round against the +1 refill, so
**Break lands about every two rounds.** Shrink the clock to 5 to speed that up,
grow it to 8 to slow it down. That one number is the fight's whole tempo dial.

## 4. Make Break mean something

A Break that only grants "−2 and a lost turn" is a *reward*, not a mechanic.
Take at least one of these:

| Shape | What it does |
|---|---|
| **Part-break** | Weak points are destructible **objects**, targetable only during Break. Destroying one changes what the creature *does*. |
| **Interrupt** | Break **zeroes the creature's own resource**, so its Ultimate is cancelled rather than endured. The stickiest loop of the three. |
| **Kill window** | Regeneration or resistance switches off only during Break. |

### Destructible parts

Statted as objects: **AC 18, Hardness 5, HP 30 (BT 15)** for a level 8–11 boss.
Immune to fire and precision unless the fiction says otherwise.

> **Objects have no level, so `pf2e-flatten` subtracts nothing from them.**
> Write the object's AC **already flattened**, and say so in the ability text
> ("these numbers are already flat — do not reduce them by the creature's
> level"). This is the single easiest thing to get wrong in a PWL boss.

Damage to a part should not damage the creature, and should not be reduced by
the creature's resistances — otherwise the peeling-defenses curve fights itself.

Part count sets fight length (six bodies, Break every ~2 rounds):

| Parts | Breaks | Rounds |
|---:|---:|---|
| 2 | 2 | ~5 |
| **3** | **3** | **~7–8 — one session's combat** |
| 4 | 4 | ~10 — realistically two sessions |

**Each part must switch off a different ability.** Two parts that both subtract
numbers is a lock with two identical keys. Better still, follow Monolithic Cube
(`design-patterns.md` §2.1) and have breaking a part *open* something too —
losing the limb it chases with should turn it into artillery, not just slow it
down.

## 5. Peeling defenses beat a hard gate

A boss that literally cannot be reduced below 1 HP until the party solves the
puzzle is dramatic and hard-walls a table that rolls badly on discovery. The
kinder shape reaches the same place:

| Parts intact | Regeneration | Resistance to all damage |
|---:|---:|---:|
| 3 | 20 | 10 |
| 2 | 10 | 5 |
| ≤1 | — | — |

Grinding raw HP through the top row is arithmetically hopeless against the
Ultimate clock, so the mechanic is still how you win — but nothing is *forbidden*,
the damage dealers watch their numbers matter more every round, and destroying
the final part can still drop it to 0 outright as a clean cinematic kill.

## 6. Phase triggers should be earned

`## Phases` accepts any prose `Trigger:`. Prefer **"the second weak point is
destroyed"** over **"reduced to half Hit Points"** whenever the fight is built
around a mechanic: an HP trigger lets a high-damage party skip the content, and
it drifts out of sync with the mechanic so the story beat lands at a random
moment. A phase change should also *invert* the tactical problem, not amplify
it — a mobile hunter that anchors into a stationary artillery platform gives the
party a different fight, which is what a second act is for.

## 7. Wiring it into the suite

| Piece | Where it lives |
|---|---|
| Boss's own resource | `## Engine` — renders on the token overlay via PF2e Ultimates |
| Party-facing Break bar | A passive ability, plus a `clock` in the clocks-tracker feature (6 slices, `bad` flag) |
| Weak points | Prose in a passive. Do **not** invent rule elements for them |
| Phase change | `## Phases` with a prose `Trigger:` |

Two tracks, each dumb, beat one clever track. A single bar both sides push reads
elegantly on paper, but its Ultimate trigger becomes a nested conditional and it
cannot use the token counter the suite already provides.

## 8. Boss checklist

- Both tracks visible to the players from round 1 — neither is a secret.
- The Ultimate's tell is narrated *every* time its resource ticks up.
- Break does at least one of: part-break, interrupt, kill window.
- Each destructible part switches off a *different* ability.
- Object numbers are pre-flattened, and the text says so.
- HP is the Low band doubled; Strike damage is Moderate or below.
- At least one Low stat. A boss with no soft spot has no fight in it.
- Phase trigger is earned by the mechanic, not by an HP threshold.
- More than three Recall Knowledge routes, plus at least one free tell that
  needs no roll.
- Allied NPCs counted as additional party members in the budget.
- A dial prepared in both directions — what to add if the party steamrolls,
  what to shrink if they drown. Shrinking the Break clock is the cheapest one.
