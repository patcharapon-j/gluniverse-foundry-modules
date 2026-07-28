---
name: pf2e-statblock
description: Design or convert Pathfinder 2e NPC, monster, boss and hazard statblocks, and emit them in the format the GLUniverse Suite stat block importer reads. Use when the user wants a PF2e creature, monster, NPC, boss, minion, or hazard built from a concept; when they want an existing statblock (from a PDF, Archives of Nethys, or a third-party book) converted for Foundry import; when they mention PF2e creature building, creature benchmarks, or the six-function NPC engine (Signature, Trigger, Engine, Ultimate); or when they ask to stat something up for Pathfinder.
---

# PF2e statblock design and conversion

Produces PF2e creatures in the exact Markdown grammar that
`GLUniverse Suite → PF2e Stat Block Importer` parses, so the result imports into
Foundry with its strikes, actions, spellcasting, effects and combat-engine
metadata already wired.

## Route first

**Did the user paste an existing statblock?**

- **Yes** → read `references/conversion.md`. Transcribe faithfully. Do not
  redesign, do not add an engine, do not rebalance.
- **No** → design path. Continue below.

## Design path

### 1. Settle the inputs

Infer everything you can from the request:

| Input | How to infer it |
|---|---|
| Level | Stated party level, or the creature's described threat. Default: ask only if there is nothing to go on. |
| Tier | "mook"/"a few guards" → `background`. A named combatant → `standard`. A lieutenant, rival, recurring ally → `elite`. "boss", "set-piece", "solo" → `boss`. |
| Allegiance | Enemy unless described as an ally, escort, wildcard or rival crew. |
| Creature type & traits | From the concept. |

Then ask **at most one round** of questions, and only for things that would
genuinely change the design. In practice that is almost always just:

1. **What resource does it build?** (offer a concrete suggestion)
2. **What pressure does it apply?** (offer two or three plausible options)

Skip the questions entirely when the user already told you, or when the tier is
`background` — a mook has no engine to ask about. Never run an eleven-step
interview.

### 2. Design it

Follow `references/engine-design.md`. What each tier owes:

| Tier | Owes |
|---|---|
| `background` | One Signature or gimmick. **No `## Engine` section.** |
| `standard` | Signature + a light Trigger **or** Engine. Engine section optional. |
| `elite` | Two Signatures, Trigger, Engine, Signature Utility, Ultimate, `## Engine`, `## Recall Knowledge` |
| `boss` | Everything in elite, plus `## Phases` |

### 3. Set the numbers

Use `references/benchmarks.md`. Two rules do most of the work:

- **Start from the real default**: Moderate defences, **High** attack bonus,
  **High** spell DC, **High** best skill. That is where official creatures
  actually sit — not "moderate everything".
- **Spend a trade-off budget**, and declare it.

| Tier | Deviations allowed |
|---|---|
| `background`, `standard` | 1 |
| `elite` | 2 |
| `boss` | 3 |

One deviation = moving one statistic one band off its default. Setting a stat to
**Extreme costs two**, and must be paid for by a Low or Terrible elsewhere.
Every `elite` and `boss` must have at least one Low stat — that is where the
counterplay lives. A boss with no soft spot has no fight in it.

### 4. Stock chassis, bespoke identity

Aim for roughly **70% stock PF2e, 30% invented**. Use `references/stock-chassis.md`
for the canonical names, traits and conventions.

- Anything that is not one of the six functions must be a real PF2e construct
  under its **real name** — `Grab`, `Reactive Strike`, `Trample`, `Swallow
  Whole`, `Frightful Presence`, real spells, real gear.
- It is `Reactive Strike`, not `Attack of Opportunity`. That rename is
  Remaster-era and the old name appears on zero official creatures.
- Invent only the Signatures, Trigger, Engine, Signature Utility and Ultimate.
- Ability names: two words, Title Case, `<Adjective> <Noun>` — that is 73% of
  official bespoke names. Verb-first is only 7%; do not default to it.

### 5. Automation

Only emit a rule element that appears in `references/rule-elements.md` with a
real compendium precedent. **The importer validates a rule element's key but not
its shape**, so a plausible-looking wrong one imports silently and then does
nothing at the table. No precedent → write the mechanic as prose in
`Description:` and note it. Prose a GM can read beats fake automation.

### 6. Emit

Write the statblock in the grammar from `references/grammar.md`, to a `.md`
file. Never emit a "pretty" statblock and offer to convert it after.

### 7. Verify — not optional

```bash
node tools/parse-check.mjs <file>
```

Zero errors required. Resolve every warning, or explain each remaining one. If
you are not in this repository, say that the check could not be run.

Then walk the final validation checklist at the end of
`references/engine-design.md`.

### 8. Report

Keep it short. State:

- the trade-offs you spent, and what paid for them;
- anything left as prose because no rule-element precedent existed;
- encounter budget, if a party was mentioned — see
  `references/encounter-budget.md`;
- any warning the parse check still emits.

## Hazards

The importer builds hazards too. Set `Type: hazard` and use `Stealth`,
`Hardness`, `Complexity`, `Disable`, `Routine`, `Reset`. Hazards take no
`## Engine` section. A complex hazard is often the right chassis for a
battlefield object network or an evolving zone — reach for it before inventing
a creature that pretends to be one.

## Reference files

| File | Read it when |
|---|---|
| `references/grammar.md` | Always. The exact format, every field and alias. |
| `references/benchmarks.md` | Always on the design path. Verified against 1,214 official creatures. |
| `references/engine-design.md` | Design path, `standard` tier and above. |
| `references/stock-chassis.md` | Naming, traits, senses, languages, action economy, spellcasting conventions. |
| `references/rule-elements.md` | Before emitting any rule element. 48 precedent-backed recipes. |
| `references/conversion.md` | Convert path. Includes the full Remaster rename table. |
| `references/encounter-budget.md` | Whenever a party level or size is mentioned. |
| `references/design-patterns.md` | For inspiration when a concept is thin. |

## Hard rules

- Remaster vocabulary only: `off-guard` not `flat-footed`, `void`/`vitality` not
  `negative`/`positive`, no alignment traits, no spell schools, `Reactive
  Strike` not `Attack of Opportunity`.
- Anything that can remove a PC from play carries `incapacitation`.
- Summons and second bodies carry `minion` and share action economy.
- Never grant a full extra turn. Use narrow action compression instead.
- No long save-or-lose. A failed save must leave meaningful participation.
- An Ultimate can never generate the resource that paid for it.
- Only `grab`, `improved-grab`, `knockdown`, `improved-knockdown`, `push`,
  `improved-push` work as `Effects:` slugs. Everything else goes in prose.
