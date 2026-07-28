# Creature statistic benchmarks

Every number on a generated statblock must land on a named band in these
tables. Deviating is allowed and often correct — but only by spending the
trade-off budget in `SKILL.md`, and only while saying which trade you made.

**These tables are verified, not remembered.** They were cross-checked against
1,214 official Remaster creatures (Monster Core, Monster Core 2, NPC Core, NPC
Gallery) extracted from the installed `pf2e` system. At every level with a
meaningful sample, the corpus median lands on a band in these tables within
tolerance. Zero rows disagreed.

## The single most useful fact in this file

Official creatures are **not** built at "moderate everything". The corpus median
sits at:

| Statistic | Where the typical official creature actually sits |
|---|---|
| AC | Moderate, drifting to High at higher levels |
| HP | Moderate |
| Perception | Moderate |
| Fortitude / Reflex / Will | Moderate |
| Strike damage | Moderate |
| **Strike attack bonus** | **High** |
| **Spell DC** | **High** |
| **Best skill** | **High** |

So the default chassis is *moderate defences, high accuracy*. A creature built
at moderate attack will feel limp; one built at high AC **and** high HP **and**
high saves will feel unkillable. Start every build from this row and deviate
deliberately.

## Choosing a band

- **Extreme** — one stat at most, and only for a creature whose entire identity
  is that stat. Costs a Low or Terrible somewhere else. Never on a Background or
  Standard tier NPC.
- **High** — the stat the creature is known for. Two or three at most.
- **Moderate** — the default. Most stats on most creatures.
- **Low** — the deliberate soft spot the party can find and exploit. Every
  Elite and Boss must have at least one.
- **Terrible** (saves and Perception only) — a glaring, thematic hole.

A Boss with no Low stat is a Boss with no counterplay.

## Armor Class

### AC by level

A creature's AC is the single most felt number at the table. Extreme AC on a boss with high HP produces the classic unfun slog — pick one.

| Level | Extreme | High | Moderate | Low |
|---|---|---|---|---|
| 0 | 19 | 16 | 15 | 13 |
| 1 | 19 | 16 | 15 | 13 |
| 2 | 21 | 18 | 17 | 15 |
| 3 | 22 | 19 | 18 | 16 |
| 4 | 24 | 21 | 20 | 18 |
| 5 | 25 | 22 | 21 | 19 |
| 6 | 27 | 24 | 23 | 21 |
| 7 | 28 | 25 | 24 | 22 |
| 8 | 30 | 27 | 26 | 24 |
| 9 | 31 | 28 | 27 | 25 |
| 10 | 33 | 30 | 29 | 27 |
| 11 | 34 | 31 | 30 | 28 |
| 12 | 36 | 33 | 32 | 30 |
| 13 | 37 | 34 | 33 | 31 |
| 14 | 39 | 36 | 35 | 33 |
| 15 | 40 | 37 | 36 | 34 |
| 16 | 42 | 39 | 38 | 36 |
| 17 | 43 | 40 | 39 | 37 |
| 18 | 45 | 42 | 41 | 39 |
| 19 | 46 | 43 | 42 | 40 |
| 20 | 48 | 45 | 44 | 42 |
| 21 | 49 | 46 | 45 | 43 |
| 22 | 51 | 48 | 47 | 45 |
| 23 | 52 | 49 | 48 | 46 |
| 24 | 54 | 51 | 50 | 48 |
| -1 | 18 | 15 | 14 | 12 |

## Hit Points

### HP by level

HP has no Extreme band. Solo bosses take High; anything the party should be able to burst down takes Low. The values are midpoints — ±10% is within band.

| Level | High | Moderate | Low |
|---|---|---|---|
| 0 | 20 | 16 | 12 |
| 1 | 26 | 20 | 15 |
| 2 | 40 | 32 | 25 |
| 3 | 59 | 48 | 37 |
| 4 | 78 | 63 | 48 |
| 5 | 97 | 78 | 59 |
| 6 | 123 | 99 | 75 |
| 7 | 148 | 119 | 90 |
| 8 | 173 | 139 | 105 |
| 9 | 198 | 159 | 120 |
| 10 | 223 | 179 | 135 |
| 11 | 248 | 199 | 150 |
| 12 | 273 | 219 | 165 |
| 13 | 298 | 239 | 180 |
| 14 | 323 | 259 | 195 |
| 15 | 348 | 279 | 210 |
| 16 | 373 | 299 | 225 |
| 17 | 398 | 319 | 240 |
| 18 | 423 | 339 | 255 |
| 19 | 448 | 359 | 270 |
| 20 | 473 | 379 | 285 |
| 21 | 505 | 405 | 305 |
| 22 | 544 | 436 | 328 |
| 23 | 581 | 466 | 351 |
| 24 | 633 | 508 | 383 |
| -1 | 9 | 7 | 5 |

## Saving throws and Perception

Saves and Perception share one table.

### Save / Perception modifier by level

Give a creature one save noticeably below the others. That is where casters aim, and it is most of what makes a monster feel like it has a shape.

| Level | Extreme | High | Moderate | Low | Terrible |
|---|---|---|---|---|---|
| 0 | 10 | 9 | 6 | 3 | 1 |
| 1 | 11 | 10 | 7 | 4 | 2 |
| 2 | 12 | 11 | 8 | 5 | 3 |
| 3 | 14 | 12 | 10 | 7 | 5 |
| 4 | 15 | 14 | 11 | 8 | 6 |
| 5 | 17 | 15 | 12 | 9 | 7 |
| 6 | 18 | 17 | 14 | 11 | 8 |
| 7 | 20 | 18 | 15 | 12 | 10 |
| 8 | 21 | 19 | 16 | 13 | 11 |
| 9 | 23 | 21 | 18 | 15 | 12 |
| 10 | 24 | 22 | 19 | 16 | 14 |
| 11 | 26 | 24 | 21 | 18 | 15 |
| 12 | 27 | 25 | 22 | 19 | 16 |
| 13 | 29 | 26 | 23 | 20 | 18 |
| 14 | 30 | 28 | 25 | 22 | 19 |
| 15 | 32 | 29 | 26 | 23 | 20 |
| 16 | 33 | 31 | 28 | 25 | 22 |
| 17 | 35 | 32 | 29 | 26 | 23 |
| 18 | 36 | 34 | 30 | 27 | 24 |
| 19 | 38 | 35 | 32 | 29 | 26 |
| 20 | 39 | 36 | 33 | 30 | 27 |
| 21 | 41 | 38 | 35 | 32 | 28 |
| 22 | 43 | 39 | 36 | 33 | 30 |
| 23 | 44 | 41 | 37 | 34 | 31 |
| 24 | 46 | 42 | 38 | 35 | 32 |
| -1 | 9 | 8 | 5 | 2 | 0 |

## Strikes

### Strike attack bonus by level

The corpus median is **High**, not Moderate. Use High unless the creature is deliberately clumsy.

| Level | Extreme | High | Moderate | Low |
|---|---|---|---|---|
| 0 | 10 | 8 | 6 | 4 |
| 1 | 11 | 9 | 7 | 5 |
| 2 | 13 | 11 | 9 | 7 |
| 3 | 14 | 12 | 10 | 8 |
| 4 | 16 | 14 | 12 | 10 |
| 5 | 17 | 15 | 13 | 11 |
| 6 | 19 | 17 | 15 | 13 |
| 7 | 20 | 18 | 16 | 14 |
| 8 | 22 | 20 | 18 | 16 |
| 9 | 23 | 21 | 19 | 17 |
| 10 | 25 | 23 | 21 | 19 |
| 11 | 26 | 24 | 22 | 20 |
| 12 | 28 | 26 | 24 | 22 |
| 13 | 29 | 27 | 25 | 23 |
| 14 | 31 | 29 | 27 | 25 |
| 15 | 32 | 30 | 28 | 26 |
| 16 | 34 | 32 | 30 | 28 |
| 17 | 35 | 33 | 31 | 29 |
| 18 | 37 | 35 | 33 | 31 |
| 19 | 38 | 36 | 34 | 32 |
| 20 | 40 | 38 | 36 | 34 |
| 21 | 41 | 39 | 37 | 35 |
| 22 | 43 | 41 | 39 | 37 |
| 23 | 44 | 42 | 40 | 38 |
| 24 | 46 | 44 | 42 | 40 |
| -1 | 10 | 8 | 6 | 4 |

### Strike damage (average per Strike) by level

Average damage of the whole expression, including the flat modifier. Compute it: 1d6=3.5, 1d8=4.5, 1d10=5.5, 1d12=6.5, 2d6=7, and so on. Extreme damage plus a high attack bonus is how a creature one-shots a PC; pair Extreme damage with a Moderate or Low attack bonus.

| Level | Extreme | High | Moderate | Low |
|---|---|---|---|---|
| 0 | 6 | 5 | 4 | 3 |
| 1 | 8 | 6 | 5 | 4 |
| 2 | 11 | 9 | 8 | 6 |
| 3 | 15 | 12 | 10 | 8 |
| 4 | 18 | 14 | 12 | 9 |
| 5 | 20 | 17 | 14 | 11 |
| 6 | 23 | 20 | 16 | 13 |
| 7 | 25 | 21 | 18 | 14 |
| 8 | 28 | 24 | 20 | 16 |
| 9 | 30 | 26 | 22 | 17 |
| 10 | 33 | 28 | 24 | 19 |
| 11 | 35 | 30 | 26 | 21 |
| 12 | 38 | 33 | 28 | 22 |
| 13 | 40 | 35 | 30 | 24 |
| 14 | 43 | 37 | 32 | 25 |
| 15 | 45 | 40 | 34 | 27 |
| 16 | 48 | 42 | 36 | 28 |
| 17 | 50 | 44 | 38 | 30 |
| 18 | 53 | 46 | 40 | 31 |
| 19 | 55 | 49 | 42 | 33 |
| 20 | 58 | 51 | 44 | 35 |
| 21 | 60 | 53 | 46 | 37 |
| 22 | 63 | 56 | 48 | 38 |
| 23 | 65 | 58 | 50 | 40 |
| 24 | 68 | 60 | 52 | 41 |
| -1 | 4 | 3 | 3 | 2 |

### Converting a damage target into dice

Pick a die size that suits the weapon, then solve for the count and flat bonus.
The flat modifier is usually about the creature's key ability modifier, and
Paizo's own strikes tend to sit near `(dice average) + (1.5 × key mod)`.

| Target average | Common shapes |
|---|---|
| 12 | 2d6+5, 1d10+7, 2d8+3 |
| 20 | 3d8+7, 2d10+9, 4d6+6 |
| 28 | 4d8+10, 3d12+9, 5d6+11 |
| 36 | 5d10+9, 6d8+9, 4d12+10 |
| 44 | 6d10+11, 7d8+13, 5d12+12 |

A second damage type ("plus 1d6 fire") counts toward the total. Persistent
damage does not — treat it as riders, not as budget.

## Damage that is not a Strike

The Strike Damage table above applies to Strikes. Two other shapes have their
own economics, measured here across 296 official creature abilities that carry
inline damage:

| Ability shape | Damage relative to **Strike Moderate** for the level | Why |
|---|---|---|
| **Area with a basic save** (cone, burst, emanation, line) | **× 1.3** — observed median ran 110–165% and climbs with level | A basic save means the expected damage taken is roughly half. The printed number has to be bigger to land in the same place. |
| **Reaction damage** | **× 0.8** — observed median ran 74–90% | It costs no action from the creature's own turn, so it is priced down. |
| **Constant / aura / persistent per-round** | **× 0.35–0.5**, and cap persistent damage at 1d6–2d6 by tier | It applies every round to everyone in the zone without a roll. |

Observed area-damage medians (n per level in brackets): L3 13 [14], L5 11 [21],
L8 25 [23], L10 32 [18], L12 44 [20], L15 54 [10], L17 63 [15], L20 72 [8].

> Note for anyone cross-reading the HSR/Endfield toolkit: that document says
> area abilities use *lower* benchmarks than Strikes. For reactions and constant
> damage that is right. For **area damage with a basic save it is backwards** —
> the corpus is unambiguous that it runs above Strike Moderate. Follow the table
> here.

Multi-target abilities should almost always use a **basic save** rather than an
attack roll, and their save DC comes from the Spell DC table, not from AC.

## Spellcasting

### Spell DC by level

Spell attack bonus is conventionally DC − 10, i.e. an Extreme DC 33 pairs with a +25 spell attack. The corpus median is **High**.

| Level | Extreme | High | Moderate |
|---|---|---|---|
| 0 | 19 | 16 | 13 |
| 1 | 20 | 17 | 14 |
| 2 | 22 | 18 | 15 |
| 3 | 23 | 20 | 17 |
| 4 | 25 | 21 | 18 |
| 5 | 26 | 22 | 19 |
| 6 | 27 | 24 | 21 |
| 7 | 29 | 25 | 22 |
| 8 | 30 | 26 | 23 |
| 9 | 32 | 28 | 25 |
| 10 | 33 | 29 | 26 |
| 11 | 34 | 30 | 27 |
| 12 | 36 | 32 | 29 |
| 13 | 37 | 33 | 30 |
| 14 | 39 | 34 | 31 |
| 15 | 40 | 36 | 33 |
| 16 | 41 | 37 | 34 |
| 17 | 43 | 38 | 35 |
| 18 | 44 | 40 | 37 |
| 19 | 46 | 41 | 38 |
| 20 | 47 | 42 | 39 |
| 21 | 48 | 44 | 41 |
| 22 | 50 | 45 | 42 |
| 23 | 51 | 46 | 43 |
| 24 | 52 | 48 | 45 |
| -1 | 19 | 16 | 13 |

## Skills

### Skill modifier by level

Give a creature 3-5 skills, not ten. The corpus median for a creature's BEST skill is High; its remaining skills sit Moderate or Low. A Lore skill at High is a cheap, flavourful way to say what a creature knows.

| Level | Extreme | High | Moderate | Low |
|---|---|---|---|---|
| 0 | 9 | 6 | 5 | 3 |
| 1 | 10 | 7 | 6 | 4 |
| 2 | 11 | 8 | 7 | 5 |
| 3 | 13 | 10 | 9 | 6 |
| 4 | 15 | 12 | 10 | 8 |
| 5 | 16 | 13 | 12 | 9 |
| 6 | 18 | 15 | 13 | 10 |
| 7 | 20 | 17 | 15 | 12 |
| 8 | 21 | 18 | 16 | 13 |
| 9 | 23 | 20 | 18 | 14 |
| 10 | 25 | 22 | 19 | 16 |
| 11 | 26 | 23 | 21 | 17 |
| 12 | 28 | 25 | 22 | 18 |
| 13 | 30 | 26 | 24 | 20 |
| 14 | 31 | 28 | 25 | 21 |
| 15 | 33 | 30 | 27 | 22 |
| 16 | 35 | 31 | 28 | 24 |
| 17 | 36 | 33 | 30 | 25 |
| 18 | 38 | 35 | 31 | 26 |
| 19 | 40 | 36 | 33 | 28 |
| 20 | 41 | 38 | 34 | 29 |
| 21 | 43 | 40 | 36 | 30 |
| 22 | 45 | 41 | 37 | 32 |
| 23 | 46 | 43 | 38 | 33 |
| 24 | 48 | 44 | 40 | 34 |
| -1 | 8 | 5 | 4 | 2 |

## Ability modifiers

Ability modifiers on an NPC are almost purely descriptive in PF2e — the
statblock's AC, saves, attack and DC are authored directly, not derived from
them. Set them to describe the creature and move on. Observed ranges in the
corpus:

| Level band | Typical highest modifier | Typical lowest |
|---|---|---|
| −1 to 1 | +3 to +4 | −3 to 0 |
| 2 to 5 | +4 to +5 | −2 to +0 |
| 6 to 10 | +5 to +7 | −2 to +1 |
| 11 to 15 | +6 to +8 | −1 to +2 |
| 16 to 20 | +7 to +9 | +0 to +3 |
| 21+ | +8 to +11 | +1 to +4 |

Mindless creatures take Int −5. Animals sit around Int −4.

## Corpus medians (raw, for reference)

The observed median of every official Remaster creature at each level. Use this
when you want to sanity-check a build against what Paizo actually ships rather
than against the idealised bands.

| Level | n | AC p50 | HP p50 | Perc p50 | Fort p50 | Ref p50 | Will p50 | Atk p50 | Dmg p50 | SpellDC p50 |
|---|---|---|---|---|---|---|---|---|---|---|
| -1 | 49 | 14 | 8 | 5 | 4 | 7 | 4 | 6 | 4 | 14 |
| 0 | 40 | 15 | 15 | 6 | 6 | 6 | 4 | 6 | 5 | 14 |
| 1 | 141 | 16 | 20 | 7 | 7 | 7 | 6 | 8 | 6 | 17 |
| 2 | 118 | 17 | 30 | 8 | 8 | 9 | 7 | 10 | 8 | 18 |
| 3 | 101 | 18 | 45 | 9 | 9 | 10 | 7 | 11 | 10 | 20 |
| 4 | 94 | 21 | 60 | 11 | 11 | 11 | 10 | 14 | 12 | 21 |
| 5 | 77 | 21 | 75 | 12 | 12 | 12 | 11 | 15 | 14 | 22 |
| 6 | 86 | 23 | 95 | 14 | 15 | 13 | 13 | 17 | 15 | 24 |
| 7 | 72 | 25 | 110 | 15 | 15 | 15 | 15 | 18 | 18 | 25 |
| 8 | 63 | 26 | 135 | 16 | 17 | 15 | 16 | 20 | 20 | 26 |
| 9 | 52 | 27 | 154 | 18 | 18 | 18 | 17 | 21 | 22 | 28 |
| 10 | 51 | 30 | 175 | 19 | 20 | 19 | 19 | 23 | 24 | 29 |
| 11 | 37 | 30 | 195 | 21 | 22 | 20 | 21 | 24 | 25 | 30 |
| 12 | 37 | 33 | 215 | 22 | 23 | 20 | 22 | 25 | 28 | 32 |
| 13 | 41 | 33 | 240 | 24 | 23 | 23 | 23 | 27 | 32 | 33 |
| 14 | 24 | 36 | 258 | 26 | 27 | 24 | 24 | 29 | 32 | 34 |
| 15 | 31 | 36 | 280 | 27 | 26 | 25 | 27 | 30 | 34 | 36 |
| 16 | 16 | 39 | 280 | 28 | 28 | 28 | 28 | 32 | 35 | 37 |
| 17 | 23 | 40 | 315 | 30 | 30 | 28 | 32 | 33 | 36 | 38 |
| 18 | 18 | 41 | 313 | 32 | 32 | 29 | 32 | 35 | 39 | 40 |
| 19 | 14 | 43 | 355 | 34 | 32 | 31 | 33 | 35 | 43 | 41 |
| 20 | 18 | 45 | 375 | 36 | 35 | 32 | 35 | 38 | 46 | 42 |
| 21 | 4 | 47 | 420 | 37 | 38 | 35 | 36 | 40 | 45 | 44 |
