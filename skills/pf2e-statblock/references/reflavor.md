# Reflavouring an existing statblock

The **reflavor** path. The user hands you a stat block already in importer
format and wants it to become something else. It is neither the convert path
(which transcribes) nor the design paths (which build from nothing): the maths
is already there and mostly stays.

**The prime directive of this path is the rung.** The user's payload names one
of four, and the rung says exactly what you may touch. Obey it literally. A
reflavour that improves a creature the user asked you not to change is a
failed reflavour, not a bonus.

## The rungs

| Rung | May change | Floor |
|---|---|---|
| Reskin | the name, and every `Description:` | every number, every `Traits:` line, every block name |
| Retheme | + block names, traits, damage and condition types | every numeric value; the block count per section |
| Rebuild | + the kit: blocks replaced, added, removed; rule elements rewritten | `Level:`; each statistic's benchmark tier; the action economy |
| Retune | + `Level:`, and every number to the new level's row | the tier column each statistic sits in |

Traits are frozen at Reskin. They look like flavour and are not — in PF2e they
drive weaknesses, resistances and automation, and Reskin's whole promise is
that nothing mechanical moved.

Rung 4 never applies to a hazard. The Building Creatures tables are
creature-only, so a hazard has nothing to retune against; hold every number and
change what it *does*.

## Output

Put the complete stat block in **one** ` ```markdown ` fence and nothing else
inside it. Write the change summary outside the fence.

This is a hard requirement of the importer, not a formatting preference. Its
parser reads any `Key: value` line under any heading, so one line of commentary
inside the fence silently rewrites the creature — `Level: raised to 8` in a
change log actually sets the level. Inside a `###` block with `Description:`
open it is worse: stray lines are appended to that ability's prose.

Reproduce every line you are not changing exactly as written, including
sections you were told to leave alone. The importer builds the creature from
this text alone; a line you drop is a line the creature loses. That especially
covers `## Engine`, `## Phases` and `## Recall Knowledge`, which carry
automation.

## Procedure

1. **Read the rung first**, then the concept. The concept says what to aim at;
   the rung says what you are allowed to move to get there.
2. **Rename with intent.** A reskinned ability should read as though the new
   creature always had it. "Frenzy" on a bog-cult flagellant is not
   "Frenzy" — it is "Chain-Flail Ecstasy", and its description should say what
   the chains do, not what a troll's rage did.
3. **Keep damage types honest to the concept.** At Retheme and above, a drowned
   thing dealing fire damage is a reflavour that did not finish.
4. **At Rebuild, check the tiers before you invent.** The payload gives the
   Building Creatures rows and marks where this creature sits. Match the tier,
   not the exact number — and if it says "between moderate and high", it is
   between, and your replacement should be too.
5. **At Retune, move the whole shape.** A creature with a High AC and a
   Moderate Fortitude keeps that asymmetry at the new level. Uniformly-High is
   a different creature.
6. **HP has no table here.** Scale it proportionally to the level change and
   say what you scaled it from and to.
7. **Report** in prose outside the fence: what changed, what you deliberately
   left, and anything the rung stopped you doing that you think the user wants.

## What not to do

- Do not add an `## Engine` to a creature that has none. The engine is a boss
  contract, and inventing one is a design decision the user did not ask for.
- Do not "fix" numbers you think are wrong at Reskin or Retheme. Say so in the
  report instead.
- Do not drop a section because it looked irrelevant.
- Do not renumber, reorder or tidy the stat block. Diff-ability is what lets
  the user check you.
