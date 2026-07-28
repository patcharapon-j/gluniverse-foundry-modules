# The importer grammar

This is the exact format `GLUniverse Suite → PF2e Stat Block Importer` parses.
It is authoritative: it was written against
`scripts/features/statsblock-import/importer.js` in this repository, and
`tools/parse-check.mjs` verifies the in-app samples against it.

**Emit this format directly.** Never emit a "pretty" statblock and offer to
convert it afterwards.

## Shape

```
# Creature Name          ← H1, the name. Required.
Key: value              ← top-level fields, one per line
Key: value

## Section              ← H2 opens a section
### Block Name          ← H3 opens an entry inside that section
Key: value              ← the entry's fields
Description: prose
```

Rules the parser actually enforces:

- Field lines are `Key: value`. The key may contain letters, digits, spaces,
  `/`, `_`, `-` — **not** parentheses, and not a leading digit. (The one
  exception is the Recall Knowledge section, which is read off the raw line.)
- `Description:`, `Effect:` and `Text:` all open a multi-line block. Every
  following line, including `- bullets`, is appended until the next `Key:` line
  or the next heading.
- `RuleElements:` and `RuleHelpers:` likewise open multi-line blocks.
- Unknown top-level fields produce a warning and are dropped. Unknown sections
  drop their whole block with a warning.
- A missing `# Name` or a missing `Level:` is a hard error. Everything else
  degrades to a warning.

If a statblock does not look like this format at all, the parser falls back to a
loose reader and warns. Do not rely on that — emit strict form.

## Description formatting

`Description:`, `Effect:` and `Text:` are multi-line blocks that carry a little
Markdown. **Use it.** A description written as one long run-on paragraph is the
most common defect in a generated stat block — it renders as an unreadable slab
on the Foundry sheet.

| Write | Renders as |
|---|---|
| blank line between two lines | separate `<p>` paragraphs |
| single newline | `<br>` inside the same paragraph |
| `- item` lines | `<ul><li>` list |
| `---` alone on a line | `<hr />` |
| `**text**` / `*text*` | `<strong>` / `<em>` |

A line that *opens* with a structural keyword is bolded automatically, so
`Trigger An ally is hit.` renders as **Trigger** An ally is hit. The keywords:
`Trigger`, `Effect`, `Requirements`, `Prerequisites`, `Frequency`, `Special`,
`Targets`, `Range`, `Area`, `Duration`, `Onset`, `Saving Throw`,
`Maximum Duration`, `Stage N`, and the four degrees of success. Bolding them by
hand works too and is clearer to read in source.

The shape official abilities use, and the one to copy:

```
Description: **Trigger** A creature targets the courier with an attack.

**Effect** The courier gains a +2 circumstance bonus to AC against it.
```

```
Description: The warden breathes a cone of fire.

Creatures in a @Template[cone|distance:30] take @Damage[6d6[fire]|options:area-damage] damage with a @Check[reflex|dc:22|basic|options:area-effect] save.

---

**Critical Failure** The creature also takes 1d6 persistent fire damage.
```

### Lead with flavour, then mechanics

A description carries two budgets, and they are **not** the same budget. Brevity
is a virtue in the mechanics and a defect in the fiction.

**The flavour line is where the creature becomes real — spend words there.** One
or two italic sentences of concrete, sensory fiction: what a person at the table
would see, hear or smell in the half-second before the dice resolve. Reach for a
specific image, a tell, a tic, a wrongness:

    Description: *A charge out of the socket in her palm, and something she
    means, said out loud. The flash arrives first; her voice arrives after it,
    still finishing the sentence.*

    Nuke throws a charge at a point within 60 feet...

Not `*She throws an explosive.*` — that is the mechanics wearing italics. If the
line could be deduced from the rules text beneath it, it is doing no work. The
flavour is the only part of a stat block that tells the GM how to *narrate* the
ability, so make it worth reading aloud. Evocative beats terse here.

Do **not** open with a role label — `**Primary Signature.**`, `**Engine —**`,
`**Ultimate.**`. The `Function:` field already records the role and the
Ultimates sheet displays it; repeating it costs a line and tells the GM nothing
they cannot see. A stock one-liner (`Razor Strides twice.`) needs no flavour
line at all.

**The mechanics are where you cut.** Below the flavour, every clause should
change what happens at the table. Delete any sentence that only restates the
fiction, and fold paired state clauses onto one line rather than giving each its
own paragraph:

    **Contained** she can exclude up to two allies. In **Excursion** the burst
    is 15 feet and she excludes no one.

## Inline enrichers

Anything you write in PF2e's inline syntax is passed through **verbatim** — it is
masked before the auto-linkers run, so it is never processed twice.

| Enricher | Use for |
|---|---|
| `@Damage[(2d6+7)[slashing]]` | any rollable damage. Multiple types: `@Damage[6d6[fire],2d6[persistent,fire]]` |
| `@Check[reflex\|dc:22\|basic]` | a saving throw. Add `\|options:area-effect` for areas |
| `@Template[cone\|distance:30]` | cones, bursts, lines, emanations |
| `@UUID[...]{Off-Guard}` | a condition link |
| `[[/gmr 1d4 #Recharge]]{1d4 rounds}` | a GM roll, e.g. breath weapon recharge |

You do not have to write them. Plain prose is auto-converted for the two common
cases: `DC 22 Reflex` (either word order) becomes an inline check, and
`2d6 fire damage` becomes an inline damage roll. Conditions named in prose are
linked automatically. Write enrichers by hand when you need something the
auto-linker cannot infer — a basic save, an area template, a persistent-damage
rider, a recharge roll.

## Do not restate the creature's own numbers

The suite is used with Proficiency Without Level. Under that variant
`pf2e-flatten` subtracts the creature's level from everything derived from its
statistics, and the suite's own **Flatfinder** feature flattens static DCs
written into item descriptions. Both work off *live* values — so a number
copied into prose is a number that will not scale.

| Instead of | Write |
|---|---|
| "Strides up to 35 feet" | "Strides up to its Speed" |
| "makes a +15 Strike for 2d6+7" | "makes a Bladed Iron Whip Strike" |
| "against AC 21" / "its Reflex DC is 27" | reference the statistic by name |
| a DC as bare prose | `@Check[fortitude\|dc:21]`, so Flatfinder can flatten it |

Numbers that are **correct** to hardcode, because they do not scale with level:
absolute distances (30 feet, a 15-foot burst), damage dice, and flat
circumstance or status bonuses (+1, +2).

## Top-level fields

| Field | Accepts | Notes |
|---|---|---|
| `Level` | integer, may be negative | Required. |
| `Rarity` | `common`, `uncommon`, `rare`, `unique` | |
| `Size` | `tiny`, `small`/`sm`, `medium`/`med`, `large`/`lg`, `huge`, `gargantuan`/`grg` | Drives token size. |
| `Traits` | comma list | Slugified. Validated against the live PF2e trait list. |
| `Description` | prose | Becomes public notes on the sheet. |
| `Image` | path | Optional; art is auto-matched by name otherwise. |
| `Perception` | `+13; Senses: darkvision, scent 30 feet` | Modifier, then optional senses after `;`. |
| `Senses` | comma list | Alternative to putting them on the Perception line. |
| `Languages` | comma list | Free text after a `;` becomes language details. |
| `Skills` | `Acrobatics +12, Stealth +10` | |
| `Abilities` | `STR +5, DEX +3, CON +4, INT +0, WIS +2, CHA +4` | Or one field each: `Str`, `Dex`, … |
| `AC` | `22` or `22; +2 vs. magic` | Text after `;` becomes AC details. |
| `Fortitude` / `Reflex` / `Will` | signed integer | `Fort` and `Ref` also accepted. |
| `HP` | `78` or `78; regeneration 10` | |
| `Speed` | `25 feet, fly 40 feet, swim 20 feet` | First entry is the land speed. |
| `Immunities` | comma list | |
| `Weaknesses` / `Resistances` | `cold 5, physical 10 (except silver)` | Value required or you get a warning. |
| `Note` / `Notes` | prose, repeatable | Appended to public notes. |
| `Type` / `Kind` | `npc` or `hazard` | Usually inferred; set explicitly for hazards. |

Hazard-only: `Stealth`, `Hardness`, `Complexity` (`simple`/`complex`), `Disable`,
`Routine`, `Reset`.

You may also group fields under `## Abilities`, `## Skills` or `## Defense`
headings instead of listing them at the top; the parser routes them either way.

## `## Attacks`

Aliases: `## Strikes`, `## Melee Attacks`, `## Ranged Attacks`.

| Field | Notes |
|---|---|
| `Type` | `melee` or `ranged`. |
| `Bonus` | Signed attack modifier. Aliases: `Attack`, `Modifier`. |
| `Damage` | `2d8+7 piercing plus 1d6 fire`. Parsed into real damage rolls. |
| `Traits` | `agile, finesse, reach-10, magical`. |
| `Effects` | Attack-effect slugs. **Only six reliably resolve**: `grab`, `improved-grab`, `knockdown`, `improved-knockdown`, `push`, `improved-push`. They cover 41% of all official uses. Anything else (venoms, diseases, bespoke riders) produces an unresolved warning — write those in `Description:` instead. |
| `Range` | `60 feet` — ranged only. |
| `Area` | `30-foot cone`. |
| `Function` | See below. |
| `Description` | Prose. Put critical-hit riders here. |

## `## Actions`

Aliases: `## Abilities`, `## Reactions`, `## Free Actions`, `## Passives`.

| Field | Notes |
|---|---|
| `Type` | `action`, `reaction`, `free`, `passive`. Matched loosely (anything containing "reaction" wins). |
| `Actions` | `1`, `2`, `3`. Only meaningful when `Type: action`. Aliases: `Cost`, `Glyph`. |
| `Category` | `offensive`, `defensive`, `interaction`. |
| `Traits` | Ability traits: `concentrate`, `manipulate`, `divine`, `fire`, `incapacitation`, … |
| `Frequency` | `once per round`, `once per encounter`, `2/day`. |
| `Function` | See below. |
| `Description` | Prose. Write `Trigger …` and `Effect …` inline here for reactions. |

## `## Spellcasting`

| Field | Notes |
|---|---|
| `Tradition` | `arcane`, `divine`, `occult`, `primal`. |
| `Type` | `innate`, `prepared`, `spontaneous`, `focus`, `ritual`. Defaults to `innate`. |
| `Ability` | `cha`, `wis`, … |
| `DC` | Spell DC. |
| `Attack` | Spell attack bonus (conventionally DC − 10). |
| `Slots` | Optional per-rank slot counts. |
| `Description` | The spell list, one rank per line. |

Spell list lines look like:

```
Description:
- Cantrips: detect magic, light
- 3: fireball, haste
- 2: obscuring mist
- At Will: shield
- 2/day: heal
```

Spell names are matched against the PF2e compendium. **Use exact official spell
names** — an unmatched spell is dropped with a warning, not invented.

## `## Inventory`

Aliases: `## Items`, `## Gear`. Fields: `Type` (`weapon`, `armor`, `shield`,
`consumable`, `equipment`, `backpack`, `treasure`), `Level`, `Quantity`,
`Traits`, `Source`, `Description`. Names are matched against the compendium;
an unmatched name becomes a generic item of that type.

## `## Effects`

Aliases: `## Auras`, `## Automation`. Fields: `Traits`, `Radius` (or `Range`),
`Duration`, `Badge`, `Level`, `Description`, plus rule elements. A block with a
`Radius` automatically gets an `Aura` rule element.

## Combat-engine grammar

These four additions drive the **PF2e Ultimates** feature. All are optional;
omit them entirely for an ordinary creature and nothing changes.

### `## Engine`

Actor-level metadata. Becomes the `ult.state` flag the Ultimates sheet reads.

| Field | Accepts | Aliases |
|---|---|---|
| `Resource` | The resource's name, e.g. `Verdict` | `Resource Name` |
| `Tier` | `background`, `standard`, `elite`, `boss` | `Complexity` |
| `Allegiance` | `enemy`, `ally`, `neutral` | `Side` |
| `Charges` | 1–12, default 3 | `Max` |
| `Ready` | `full`, `atLeast`, `exactly` | `Ready Mode` |
| `Threshold` | charges needed when `Ready` is not `full` | `Ready Threshold` |
| `Icon` | Font Awesome classes, e.g. `fa-solid fa-scale-balanced` | |
| `Color` | hex colour | `Colour` |
| `Promise` | the combat promise, one sentence | `Combat Promise` |
| `Gain` | exactly how the resource is earned | `Gain Rule` |
| `Cash Out` | what spending it does — usually the Ultimate's name | `Payoff` |
| `Tell` | the observable telegraph | `Telegraph` |
| `Threat` | what it does to the party if ignored | |
| `Counterplay` | how the party interferes | |

`Promise`, `Gain`, `Cash Out`, `Tell` and `Threat` are stored capped at 280
characters; `Counterplay` at 560. Write tight.

### `Function:` on an ability

Tags which of the six functions an ability performs. Valid on `## Attacks`,
`## Actions` and `## Phases` blocks only — anywhere else it warns and is
dropped, because those are the item types the Ultimates feature can tag.

```
Function: signature
Function: ultimate
Function: signature, engine
```

Four roles exist in the data model: `signature`, `trigger`, `engine`,
`ultimate`. Both the Primary and the Pivot Signature use `signature`. The
Signature Utility takes **no** tag — it is an accent, not one of the four
tracked roles.

An ability tagged `ultimate` also sets `ult.isUltimate`, which is what lights up
the token overlay and the charge counter.

### `## Recall Knowledge`

GM-facing ladder. Rendered into the actor's private notes, above the imported
source. One rung per line, in any of these forms:

```
DC 30 (Religion): It judges stillness, not malice.
DC 32: Each detached halo ring is a stored Verdict.
Religion DC 35: At half health it splits its halo.
```

### `## Phases`

Boss phase changes. Each becomes a passive action item in the `interaction`
category, flagged with its ordinal so export can round-trip it.

```
## Phases
### Phase 2 — The Halo Splits
Trigger: The arbiter is reduced to half its Hit Points or fewer.
Traits: divine, visual
Description: It marks every creature it can see, and can no longer fly.
```

## Rule elements

Two ways in. Both attach to the block they appear in.

**`RuleElements:`** — raw JSON, one object per line (a bare array also works):

```
RuleElements:
- {"key":"Aura","radius":10,"traits":["fire","visual"],"effects":[]}
```

**`RuleHelpers:`** — shorthand for the five common shapes:

```
RuleHelpers:
- FlatModifier selector=ac value=2 type=status
- RollOption domain=all option=marked-target
- Aura radius=15 traits=divine,fire
- Note selector=all text="Reduce the damage by half on a success."
- GrantItem uuid=Compendium.pf2e.bestiary-effects.Item.xxxx
```

Anything outside those five must be written as raw `RuleElements:` JSON.

**The importer validates that a rule element's `key` exists. It does not
validate the shape.** A rule element with a valid key and a wrong field name
imports silently and then does nothing at the table. This is why you may only
emit rule elements that appear in `references/rule-elements.md` with a real
compendium precedent. When in doubt, write the mechanic as prose in
`Description:` — a GM reading clear text beats an ability that looks automated
and is not.

## Verifying output

```bash
node tools/parse-check.mjs path/to/statblock.md
```

Zero errors is required. Resolve warnings or explain each one.
