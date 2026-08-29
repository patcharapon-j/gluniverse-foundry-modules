---
name: pf2e-statblock
description: Design or convert Pathfinder 2e NPC, monster, boss and hazard statblocks, and emit them in the format the GLUniverse Suite stat block importer reads. Use when the user wants a PF2e creature, monster, NPC, boss, minion, or hazard built from a concept; when they want an existing statblock (from a PDF, Archives of Nethys, or a third-party book) converted for Foundry import; when they mention PF2e creature building, creature benchmarks, the five-slot kit, Postures, or the Combo slot; or when they ask to stat something up for Pathfinder.
---

# PF2e statblock design and conversion

Produces PF2e creatures in the exact Markdown grammar that
`GLUniverse Suite → PF2e Stat Block Importer` parses, so the result imports into
Foundry with its strikes, actions, spellcasting, effects and combat-engine
metadata already wired.

## Route first

**Did the user paste an existing statblock?**

- **Yes, and they want it changed into something else** (a "reflavor" payload
  naming a rung, or any ask to reskin/retheme/rebuild/retune what they pasted)
  → read `references/reflavor.md`. The rung says what you may touch; obey it
  literally.
- **Yes, and they want it in this format** → read `references/conversion.md`.
  Transcribe faithfully. Do not redesign, do not add a kit, do not rebalance.
- **No** → design path. Continue below.

## Design path

### 1. Settle the inputs

Infer everything you can from the request:

| Input | How to infer it |
|---|---|
| Level | Stated party level, or the creature's described threat. Ask only if there is nothing to go on. |
| Tier | "mook"/"a few guards" → `background`. A named combatant → `standard`. A lieutenant, rival, recurring ally → `elite`. "boss", "set-piece", "solo" → `boss`. |
| Allegiance | Enemy unless described as an ally, escort, wildcard or rival crew. |
| Creature type & traits | From the concept. |

Then ask **at most one round** of questions, and only for things that would
genuinely change the design. In practice:

1. **What does the party get to do because this creature is here?** (the Combo)
2. **What pressure does it apply?** (offer two or three plausible options)

Skip the questions entirely when the user already told you, or when the tier is
`background`. Never run an eleven-step interview.

### 2. Design it

Follow `references/kit-design.md`. What each tier owes:

| Tier | Kit slots | Postures | Combo | Ultimate | Resource | Explanation cap |
|---|---|---|---|---|---|---|
| `background` | 1 | 1 | no | no | none | **1 sentence** |
| `standard` | 2 | 2 | yes | yes — once/encounter, no resource | none, or 0–1 | **3** |
| `elite` | 4 + 2 talents | 3 | yes | yes | 0–2 | **5** |
| `boss` | 4 + 2 talents | 3–4 per phase | yes | yes | full pool + Break | **8** |

The five slots are **Signature · Combo · Ultimate · Talent ×2**. Nothing adds a
sixth. Level growth goes into the **Chassis** — stock PF2e spells, gear and
abilities — never into new bespoke slots.

Also read:

- `references/postures.md` — always, from `background` up.
- `references/combo-menu.md` — whenever the tier owes a Combo, i.e. `standard`
  and above.
- `references/boss-design.md` — a `boss` that fights **alone**. Solo bosses break
  the XP table above five bodies; the Apex and Break patterns there are the fix.

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

Extreme costs two, and must be paid for by a Low or Terrible elsewhere. Every
`elite` and `boss` needs at least one Low stat — that is where the counterplay
lives.

**The Combo prices on the reaction damage column**, not the Strike column.

### 4. Check the explanation cost

> **sentences ≈ 3 + (2 × gain branches) + 3 if the kit introduces a new board object**

Measured across four shipped sheets. Run it against the tier cap in the table
above **before** you write the file, because busting it is a redesign, not an
edit. An `elite` gets one gain branch and no board object. Blowing the cap is
allowed only if you name and justify the overflow in the report.

Tracking load is a separate budget, and it ranks differently: count every
simultaneous state the GM holds (counters, marks, flags, timers, cooldowns) and
target **8 or fewer** at `elite`.

### 5. Stock chassis, bespoke identity

Aim for roughly **70% stock PF2e, 30% invented** — and now that is structural:
the **Chassis is the 70%**. Use `references/stock-chassis.md` for canonical
names, traits and conventions.

- Anything that is not one of the five slots must be a real PF2e construct under
  its **real name** — `Grab`, `Reactive Strike`, `Trample`, `Swallow Whole`,
  `Frightful Presence`, real spells, real gear.
- It is `Reactive Strike`, not `Attack of Opportunity`. That rename is
  Remaster-era and the old name appears on zero official creatures.
- Invent only the Signature, Combo, Ultimate, Talents and Postures.
- Ability names: two words, Title Case, `<Adjective> <Noun>` — that is 73% of
  official bespoke names. Verb-first is only 7%; do not default to it.

### 6. Automation

Only emit a rule element that appears in `references/rule-elements.md` with a
real compendium precedent. **The importer validates a rule element's key but not
its shape**, so a plausible-looking wrong one imports silently and then does
nothing at the table. No precedent → write the mechanic as prose in
`Description:` and note it. Prose a GM can read beats fake automation.

Postures and Break clocks are **not** automated. Say so when you hand the sheet
over.

### 7. Emit

Write the statblock in the grammar from `references/grammar.md`, to a `.md`
file. Never emit a "pretty" statblock and offer to convert it after.

**Statblocks are written in English**, flavour text included. This is a
deliberate carve-out from the vault's Thai-by-default rule: the importer's
auto-linker matches English condition words (`off-guard`, `frightened`,
`persistent-damage`), and non-English rules text silently stops linking.

Three things are easy to get wrong and all of them make the result worse at the
table:

- **Format every description.** Blank lines between paragraphs, `- ` for a list
  of choices, `**Trigger**` / `**Effect**` / `**Requirements**` on reactions and
  activations. A run-on paragraph is the single most common defect in a
  generated stat block. Write rollable numbers as inline enrichers —
  `@Damage[...]`, `@Check[...|basic]`, `@Template[...]`.
- **Evocative flavour first, tight mechanics second.** Open with one or two
  italic sentences of concrete sensory fiction — the flavour is the only part
  that tells the GM how to narrate the ability, so spend words there. Never open
  with a role label (`**Signature.**`, `**Ultimate.**`) — `Function:` already
  records it. Then cut hard in the *rules* text: delete any sentence that only
  restates the fiction.
- **Never restate a number the actor already owns.** "up to its Speed", not "up
  to 35 feet"; "a Bladed Iron Whip Strike", not "+15 for 2d6+7". The suite runs
  Proficiency Without Level, so a statistic copied into prose silently stops
  scaling. Absolute distances, damage dice and flat circumstance bonuses are
  correct to write literally.

### 8. Verify — not optional

```bash
node tools/parse-check.mjs <file>
```

Zero errors required. Resolve every warning, or explain each remaining one. If
you are not in this repository, say that the check could not be run.

Then walk the final validation checklist at the end of
`references/kit-design.md`.

### 9. Report

Keep it short. State:

- the trade-offs you spent, and what paid for them;
- **the explanation cost you counted**, and the tracking-load count;
- anything left as prose because no rule-element precedent existed, plus the
  reminder that Postures and clocks are manual;
- encounter budget, if a party was mentioned — see
  `references/encounter-budget.md`;
- any warning the parse check still emits.

## Hazards

The importer builds hazards too. Set `Type: hazard` and use `Stealth`,
`Hardness`, `Complexity`, `Disable`, `Routine`, `Reset`. Hazards take no
`## Engine` section and no kit. A complex hazard is often the right chassis for a
battlefield object network or an evolving zone — reach for it before inventing a
creature that pretends to be one. An **escort or protect target is a hazard**,
not a combatant.

## Reference files

| File | Read it when |
|---|---|
| `references/grammar.md` | Always. The exact format, every field and alias. |
| `references/benchmarks.md` | Always on the design path. Verified against 1,214 official creatures. |
| `references/kit-design.md` | Always on the design path. The five slots, the budgets, the checklist. |
| `references/postures.md` | Always on the design path. Every tier has at least one Posture. |
| `references/combo-menu.md` | `standard` and above. The trigger palette. |
| `references/boss-design.md` | A `boss` that fights solo. Apex template, Break, destructible parts, PWL budget maths above four PCs. |
| `references/stock-chassis.md` | Naming, traits, senses, languages, action economy, spellcasting conventions. |
| `references/rule-elements.md` | Before emitting any rule element. 48 precedent-backed recipes. |
| `references/conversion.md` | Convert path. Includes the full Remaster rename table. |
| `references/reflavor.md` | Reflavor path. The four rungs and the fence rule. |
| `references/encounter-budget.md` | Whenever a party level or size is mentioned. |
| `references/design-patterns.md` | For inspiration when a concept is thin. |

## Hard rules

**Format and vocabulary**

- Remaster vocabulary only: `off-guard` not `flat-footed`, `void`/`vitality` not
  `negative`/`positive`, no alignment traits, no spell schools, `Reactive
  Strike` not `Attack of Opportunity`.
- Every description is formatted — paragraphs, lists, bolded `Trigger`/`Effect`.
  Rollable numbers go in inline enrichers.
- Descriptions open with one or two evocative italic flavour sentences, not a
  role label. Compress the rules text, never the fiction.
- Never copy a statistic the actor owns into prose. Proficiency Without Level is
  in play; a copied number stops scaling.
- Statblocks are English, flavour included.

**The kit**

- Five slots: Signature, Combo, Ultimate, Talent ×2. Never a sixth.
- Level growth goes in the Chassis, never into new bespoke slots.
- At least one Talent must work outside combat.
- **Exactly one gain branch**, and the gain condition must be PC-caused or
  visibly performed on screen.
- **The Signature may not be the gain condition.** If pressing the button fills
  the bar, the bar is a round counter in costume.
- Only `boss` may exceed a 0–2 resource.
- An Ultimate can never generate the resource that paid for it.
- **Do not force a minor conversion.** Binary, threshold, placed-object and
  bloodied engines are exempt. A conversion is correct only for a deep pool.
- Exactly **one** engine-bearing creature per side per encounter.

**The Combo**

- Once per round, priced on the reaction column.
- At `standard` it **is** the creature's reaction. At `elite` and `boss` it is
  its own slot, and the normal reaction stays free for a stock Chassis reaction
  (`Nimble Dodge`, `Shield Block`, `Reactive Strike`). A Combo the creature can
  be forced to spend on self-defence is a tax on the party, not a decision.
- If the Chassis reaction also deals damage, both it and the Combo count against
  the reaction damage budget.
- It must point at something *another creature* does — never the creature's own
  action.
- For allies, the PC who triggered it decides whether it fires, free of charge.
- Never let one Combo satisfy another's trigger.

**Postures**

- Two ladder rungs, the last unconditional. Three only for a boss's Ultimate
  Posture.
- Linear only — no back-edges, except Break returning to the Posture it left.
- Never name a Posture after a real PF2e condition; check `CONDITION_WORDS` in
  `importer.js`. Never call one a "Stance" — that is a live PF2e trait.
- The current Posture is mirrored as a token effect the players can see.

**PF2e**

- Anything that can remove a PC from play carries `incapacitation`.
- Summons and second bodies carry `minion` and share action economy.
- Never grant a full extra turn. Use narrow action compression instead.
- No long save-or-lose. A failed save must leave meaningful participation.
- Only `grab`, `improved-grab`, `knockdown`, `improved-knockdown`, `push`,
  `improved-push` work as `Effects:` slugs. Everything else goes in prose.
- Budget allies as bodies by tier: `elite` full, `standard` half, escort zero.
