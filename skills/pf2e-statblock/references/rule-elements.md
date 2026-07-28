# PF2e Rule Element Cookbook (verified against shipped Paizo compendium data)

Every JSON block below is **copied verbatim** from `pathfinder-monster-core`,
`pathfinder-monster-core-2`, `pathfinder-npc-core`, `npc-gallery`,
`bestiary-ability-glossary-srd`, `bestiary-family-ability-glossary`, or
`bestiary-effects`. Nothing here was written from memory. Corpus: 4546 rule
elements across 1214 NPCs + 1263 glossary/effect items.

The importer accepts any rule whose `key` it recognises and does **not** validate
shape. A wrong-shaped rule imports clean and then silently does nothing. So: only
emit shapes that appear below.

---

## 0. Placement — the thing that silently kills homebrew rules

Every rule element lives on an **item**, and which item decides whether it works.
Observed distribution of the 4546 rules:

| Host item | count | what it is |
|---|---|---|
| `npc-action` | 2604 | an action/passive ability item on the creature. **This is where a statblock's `RuleElements:` block lands.** |
| `effect` | 1125 | an `Effect: …` item in `bestiary-effects`, applied to *someone else* (or to self) by an Aura or GrantItem |
| `action` | 652 | a reusable ability item in the glossary packs |
| `npc-strike` | 165 | a `melee`/`ranged` strike item on the creature |

**Keys that are effect-only in the entire corpus — never put them on an NPC action:**

- `TempHP` — 62/62 on `effect` items. An NPC action carrying `TempHP` grants
  permanent temp HP that regenerates every refresh; Paizo never does it.
- `TokenMark` — 20/20 on `effect` items. The mark must be carried by an effect
  applied to the *target*; a TokenMark on the attacker's action marks nothing.

**Keys that never appear on an `npc-action` in the corpus:**

- `ChoiceSet` — 77 uses, all on `effect` (71) or glossary `action` (6) items.
  NPCs express "the GM picks one of N" with **`RollOption` + `suboptions`** instead
  (see recipe 43). Emitting a `ChoiceSet` on an imported NPC action pops a dialog
  at import time and writes a flag the statblock text won't match.
- `RollTwice` — 32 uses, all `effect`/`action`.

**Keys safe directly on an `npc-action`** (count on npc-action):
`FlatModifier` 651, `RollOption` 613, `DamageDice` 266, `Aura` 227,
`Note` 149, `ActiveEffectLike` 146, `ItemAlteration` 79, `FastHealing` 68,
`Resistance` 50, `CreatureSize` 41, `AdjustDegreeOfSuccess` 41, `AdjustStrike` 37,
`Immunity` 36, `DamageAlteration` 35, `Strike` 34, `EphemeralEffect` 29,
`GrantItem` 19, `BaseSpeed` 18, `Weakness` 18, `AdjustModifier` 12,
`ActorTraits` 9, `TokenLight` 9, `SpecialStatistic` 6, `CriticalSpecialization` 5,
`SubstituteRoll` 4, `Sense` 2.

**Keys that appear on `npc-strike` items** (the only 8): `RollOption` 69,
`DamageAlteration` 45, `DamageDice` 32, `FlatModifier` 6,
`AdjustDegreeOfSuccess` 5, `Note` 5, `ItemAlteration` 2, `GrantItem` 1.
Anything else on a strike is unprecedented.

---

# RECIPES

## A. Extra damage

### 1. Give the creature extra damage while a situational toggle is on

Live on: **the passive action item**. Pair is mandatory — the `DamageDice` alone
never fires because nothing sets `pack-attack`.
```json
[
  {"key":"RollOption","domain":"damage","option":"pack-attack","toggleable":true},
  {"key":"DamageDice","diceNumber":1,"dieSize":"d8","predicate":["pack-attack"],"selector":"strike-damage"}
]
```
Precedents: **Greater Hell Hound / Pack Attack** (verbatim above);
**Hyaenodon / Pack Attack** (`d6`); **Frost Drake / Retaliatory Strike**
(`selector: "tail-damage"`).

Gotcha: `domain: "damage"` is what makes the toggle checkbox appear on the damage
roll dialog. Without a domain the toggle still exists but shows on the character
sheet only (225 uses of the bare `{option, toggleable}` form — also valid).

### 2. Give the creature sneak attack / precision damage vs off-guard targets

Live on: **the passive action item**.
```json
[
  {"key":"DamageDice","category":"precision","diceNumber":1,"dieSize":"d6","predicate":["target:condition:off-guard"],"selector":"strike-damage"},
  {"key":"RollOption","label":"PF2E.SpecificRule.TOTMToggle.OffGuard","option":"target:condition:off-guard","toggleable":"totm"}
]
```
Precedents: **Wererat / Sneak Attack**; **Smilodon / Sneak Attack**;
**Lion / Sneak Attack**. 112 rules use this `{category,diceNumber,dieSize,predicate,selector}` shape.

Gotcha: `toggleable: "totm"` ("theatre of the mind") is used with exactly two
options in the whole corpus — `target:condition:off-guard` and
`target:condition:frightened` (84 uses). Use `"totm"` only for those two;
everything else uses `toggleable: true`.

### 3. Make a strike deal extra damage of a different type against a category of creature

Live on: **the passive action item**.
```json
{"key":"DamageDice","damageType":"void","diceNumber":3,"dieSize":"d6","predicate":["target:mode:living"],"selector":"strike-damage"}
```
Precedents: **Yamaraj / Shepherd's Touch** (verbatim); **Nosoi / Shepherd's Touch**
(`vitality`, `1d6`, `target:mode:undead`); **Scarecrow / Clawing Fear**
(`mental`, `1d6`, `target:condition:frightened`). 85 rules share this shape.

### 4. Make a strike deal extra damage against a marked target

Two items. The **mark** lives on an `Effect:` item applied to the victim; the
**benefit** lives on that same effect item (the effect is on the victim, the
`target:mark:` predicate resolves from the attacker's roll).

Effect item (`bestiary-effects` / **Effect: Revealing Hypothesis**,
`_id=AwMp9BwvNMrLylDJ`):
```json
[
  {"key":"TokenMark","slug":"revealing-hypothesis"},
  {"key":"DamageDice","category":"precision","diceNumber":2,"dieSize":"d6","predicate":["target:mark:revealing-hypothesis"],"selector":"strike-damage"}
]
```
Precedents: **Effect: Denounce** (`1d4` precision); **Effect: Sight Prey**
(`3d6` precision on `ranged-strike-damage` + a matching `FlatModifier` on
`ranged-strike-attack-roll`); **Effect: Conduct the Experiment**
(`2d8` on `melee-strike-damage`).

Flat-bonus variant on the creature's own action, using a mark another item set —
**Einherji / Challenge Foe**:
```json
[
  {"key":"FlatModifier","predicate":["target:mark:challenge-foe"],"selector":"damage","slug":"challenge-foe-bonus","type":"circumstance","value":2},
  {"key":"FlatModifier","predicate":["self:effect:challenge-foe",{"not":"target:mark:challenge-foe"}],"selector":"damage","slug":"challenge-foe-penalty","type":"circumstance","value":-2}
]
```
with **Effect: Challenge Foe** (`_id=KuCh1JGrAidkKBav`) being nothing but
`[{ "key": "TokenMark", "slug": "challenge-foe" }]`.

Gotcha: the mark slug and the predicate string must match exactly, and the mark
must be on an effect the GM applies to the target. There is **no** precedent for
a `TokenMark` living on an NPC action.

### 5. Boost only one named strike, not all of them

Live on: **the action item**. The selector is `<strike-slug>-damage`.
```json
[
  {"key":"RollOption","domain":"damage","option":"powerful-charge","toggleable":true},
  {"key":"FlatModifier","predicate":["powerful-charge"],"selector":"horn-damage","value":7},
  {"key":"DamageDice","diceNumber":1,"dieSize":"d10","predicate":["powerful-charge"],"selector":"horn-damage"}
]
```
Precedents: **Great Cyclops / Powerful Charge** (verbatim);
**Frost Drake / Retaliatory Strike** (`tail-damage`);
**Wererat / Curse of the Wererat** (`Note` on `jaws-damage`).

Gotcha: the slug is the strike's name lowercased and hyphenated
(`Horn` → `horn-damage`, `Dragon Jaws` → `dragon-jaws-damage`). Verified selectors
in corpus: `jaws-damage`, `claw-damage`, `fist-damage`, `beak-damage`,
`horn-damage`, `horns-damage`, `tail-damage`, `staff-damage`, `dagger-damage`,
`trident-damage`, `crossbow-damage`, `weapon-arm-damage`, `dragon-jaws-damage`.

### 6. Upgrade a strike's damage die when wielded two-handed

Live on: **the strike item itself** (`npc-strike`).
```json
[
  {"key":"RollOption","domain":"damage","label":"PF2E.SpecificRule.TwoHanded.BastardSword","option":"two-handed","toggleable":true},
  {"key":"DamageAlteration","mode":"upgrade","predicate":["two-handed"],"property":"dice-faces","selectors":["{item|_id}-damage"],"slug":"base","value":12}
]
```
Precedents: **Ghoul Soldier / Bastard Sword**; **Bugbear Prowler / Bastard Sword**;
**Pitborn Adept / Staff** (`value: 8`). 45 identical-shape uses, all on strikes.

Gotcha: `{item|_id}-damage` only resolves on the strike item. `slug: "base"`
targets the weapon's base damage entry; omit it and the upgrade hits nothing.
An alternate shipped form uses `DamageDice` with `override`:
`{"key":"DamageDice","label":"PF2E.TraitTwoHandD8","override":{"dieSize":"d8"},"predicate":["two-handed"],"selector":"{item|_id}-damage"}` (**Bodach / Staff**, **Sage / Staff**).

### 7. Let a creature choose the damage type of one of its strikes

Live on: **the strike item**.
```json
[
  {"key":"RollOption","alwaysActive":true,"option":"akhana-fist","suboptions":[{"label":"PF2E.TraitVitality","value":"vitality"},{"label":"PF2E.TraitVoid","value":"void"}],"toggleable":true},
  {"key":"DamageDice","damageType":"vitality","diceNumber":1,"predicate":["akhana-fist:vitality"],"selector":"fist-damage"},
  {"key":"DamageDice","damageType":"void","diceNumber":1,"predicate":["akhana-fist:void"],"selector":"fist-damage"}
]
```
Precedent: **Akhana / Fist** (verbatim).

Gotcha: a `suboptions` selection produces the compound roll option
`"<option>:<value>"` — that is what you predicate on. This is the NPC substitute
for `ChoiceSet`.

---

## B. Rolls: bonuses, penalties, degrees of success

### 8. Give a blanket save bonus against a category of effect

Live on: **the passive action item**. This is the single most common rule element
in the corpus (611 uses of `{predicate,selector,type,value}`).
```json
{"key":"FlatModifier","predicate":["item:magical"],"selector":"saving-throw","type":"status","value":1}
```
Precedents: **Yamaraj / +1 Status to All Saves vs. Magic**;
**Akhana / +1 Status to All Saves vs. Magic**;
**Despair Dragon (Ancient) / +2 Status to All Saves vs. Occult**
(`predicate: ["item:trait:occult"]`, `value: 2`);
**Zyss Serpentfolk / +4 Status to Will Saves vs. Mental** (`selector: "will"`).

Gotcha: `item:magical` is a bare flag (no value). Trait predicates are
`item:trait:<trait>` — 209 uses, e.g. `item:trait:occult`, `item:trait:mental`,
`item:trait:divine`, `item:trait:primal`, `item:trait:disease`, `item:trait:fear`.
Bare trait words (`"emotion"`, `"fear"`, `"sonic"`) are **also** used as
predicates on effect items — see the predicate cookbook.

### 9. Turn a bonus on and off with the same toggle across several statistics

Live on: **the passive action item**.
```json
[
  {"key":"RollOption","option":"formation","toggleable":true},
  {"key":"FlatModifier","predicate":["formation"],"selector":"ac","type":"circumstance","value":1},
  {"key":"FlatModifier","predicate":["formation"],"selector":"saving-throw","type":"circumstance","value":1},
  {"key":"FlatModifier","label":"PF2E.NPCAbility.HobgoblinFormationArea","predicate":["formation","area-effect"],"selector":"reflex","type":"circumstance","value":2}
]
```
Precedents: **Hobgoblin Archer / Formation** (verbatim);
**Aapoph Granitescale / Chipping Scales** (`predicate: ["shed-scales"]`,
`selector: "ac"`, `type: "untyped"`, `value: -2`);
**Crawling Hand / Mark Quarry** (`selector: "strike-damage"`).

### 10. Give a skill bonus that applies only to one action

```json
{"key":"FlatModifier","predicate":["action:sense-motive"],"selector":"perception","value":2}
```
Precedents: **Conspirator Dragon (Ancient) / +2 to Sense Motive**;
**Whisper Dragon (Adult) / +2 to Sense Motive** (`selector: "perception-check"`);
**Iron Hag / Bonds of Iron** (`predicate: ["action:grapple","bonds-of-iron"]`,
`selector: "athletics"`, `type: "circumstance"`, `value: 2`).

Gotcha: the action predicate is the action name slugified —
verified in corpus: `action:seek`, `action:track`, `action:grapple`,
`action:shove`, `action:trip`, `action:disarm`, `action:demoralize`,
`action:coerce`, `action:feint`, `action:hide`, `action:climb`, `action:swim`,
`action:balance`, `action:escape`, `action:steal`, `action:aid`,
`action:lie`, `action:request`, `action:impersonate`, `action:sense-motive`,
`action:sense-direction`, `action:recall-knowledge`, `action:tumble-through`,
`action:make-an-impression`, `action:gather-information`, `action:subsist`,
`action:treat-wounds`, `action:treat-disease`, `action:treat-poison`,
`action:palm-an-object`. If it isn't in that list, verify before using.

### 11. Make a bonus get bigger under a further condition

Do **not** emit two overlapping FlatModifiers of the same type — use
`AdjustModifier` with `mode: "upgrade"` and a matching `slug`.
```json
[
  {"key":"RollOption","option":"smite","toggleable":true},
  {"key":"FlatModifier","predicate":["smite"],"selector":"damage","slug":"smite-damage","type":"status","value":4},
  {"key":"AdjustModifier","mode":"upgrade","predicate":["target:trait:unholy"],"relabel":"Smite (vs Unholy)","selector":"damage","slug":"smite-damage","value":8}
]
```
Precedents: **Champion of Shelyn / Smite** (verbatim);
**Demonbane Warrior / Demonbane** (`+1` → upgrade `2` on `attack-damage`);
**Deluded Mob / Victim Complex** (`+2` at `hp-remaining ≤ 50` → upgrade `4` at `≤ 25`).

Gotcha: `slug` on the `FlatModifier` and `slug` on the `AdjustModifier` **must be
identical** or the upgrade finds no modifier and does nothing. `AdjustModifier`
uses `selector` (singular) in 15 uses and `selectors` (array) in 8 — both ship;
use `selector` for one, `selectors` for several
(**Phalanx Formation / Shields Up!**: `"selectors":["ac","reflex"]`).

### 12. Crit on a natural 19

Live on: **the passive action item**.
```json
[
  {"key":"AdjustDegreeOfSuccess","adjustment":{"success":"to-critical-success"},"predicate":["check:total:natural:19",{"gte":["check:total:delta",0]}],"selector":"strike-attack-roll"},
  {"key":"Note","predicate":["check:total:natural:19",{"not":{"gte":["check:total","check:total:delta"]}}],"selector":"strike-attack-roll","text":"{item|description}","title":"{item|name}"}
]
```
Precedent: **Guthallath / Powerful Blows** (verbatim). Keen-rune variant on the
**strike** item — **Dullahan / Keen Returning Hatchet**, **Lesser Death / Keen Scythe**:
```json
{"key":"AdjustDegreeOfSuccess","adjustment":{"success":"one-degree-better"},"predicate":["check:total:natural:19",{"or":["item:damage:type:slashing","item:damage:type:piercing"]}],"selector":"{item|_id}-attack"}
```

### 13. Upgrade a whole statistic's degree of success

```json
{"key":"AdjustDegreeOfSuccess","adjustment":{"success":"one-degree-better"},"selector":"reflex"}
```
Precedents: **Giant Eagle / Evasive Maneuvers**; **Maestro / Resolve**
(`selector: "will"`); **Sceaduinar / Void Child**
(`{"all":"to-critical-failure"}`, `selector: "crafting"`).

Observed adjustment values: `one-degree-better`, `to-critical-success`,
`to-critical-failure`; observed keys inside `adjustment`: `success`, `all`.

### 14. Force rolls to be made twice (misfortune / fortune)

**Effect item only.**
```json
{"key":"RollTwice","keep":"lower","removeAfterRoll":false,"selector":"all"}
```
Precedents: **Effect: Aura of Misfortune** (`_id=QoneHsjZKtGHWlam`, used by
**Lesser Death / Aura of Misfortune**); **Effect: Black Cat Curse**
(`selector: ["attack","saving-throw"]`); **Effect: Drain Luck (Critical Failure)**;
**(Graveknight) Eager for Battle** (`{"keep":"higher","selector":"initiative"}`).

### 15. Give a creature an automatic result on a check

```json
[
  {"key":"RollOption","option":"mimic-object","toggleable":true},
  {"key":"FlatModifier","predicate":["mimic-object"],"selector":["deception-dc","deception"],"slug":"mimic-object-bonus","value":19},
  {"key":"SubstituteRoll","predicate":["mimic-object"],"required":true,"selector":"deception-check","slug":"mimic-object-bonus","value":10}
]
```
Precedents: **Mimic / Mimic Object** (verbatim); **Ambush Copse / Feign Copse**;
**Kuribu / Statue**. Initiative variant with no predicate:
**Norn / Sense Fate** — `{"key":"SubstituteRoll","required":true,"selector":"initiative","value":20}`.

Gotcha: `SubstituteRoll` replaces the *die*, not the total; the "automatic result
of 28" is `value: 10` (the die) plus a `FlatModifier` of 19… minus nothing. Copy
the pair, do not compute one from the statblock number alone.

---

## C. Defenses

### 16. Give flat resistance

```json
{"key":"Resistance","type":"physical","value":15,"exceptions":["adamantine"]}
```
Precedents: **Adamantine Dragon (Adult, Spellcaster) / Abandon Armor**;
**Feathered Bear / Bond with Mortal**
(`{"exceptions":["force","ghost-touch","vitality"],"type":"all-damage","value":10}`);
**Effect: Steward of the Faithful** (`{"key":"Resistance","type":"void","value":5}`).

Observed `type` values: `all-damage` (29), `physical` (27), `fire`, `void`, `cold`,
`piercing`, `slashing`, `bludgeoning`, `vitality`, `spirit`, `acid`, `electricity`,
`spells`.

### 17. Give resistance with a complex exception (the vampire pattern)

```json
{"key":"Resistance","type":"physical","value":7,"exceptions":[{"definition":["item:magical",{"or":["damage:material:dawnsilver","damage:material:silver"]}],"label":"PF2E.IWR.Custom.MagicalSilver"}]}
```
Precedents: **Vampire Count / Vampire Vulnerabilities** (verbatim);
**Vampire Mastermind / Vampire Vulnerabilities** (`value: 10`);
**Iron Warden / Breath Poison**
(`{"definition":[{"or":["damage:type:acid","spell:cause-rust"]}],"label":"PF2E.IWR.Custom.AcidAndSpellsThatCauseRust"}`).

### 18. Grant resistance that only applies while a state is active

```json
[
  {"key":"RollOption","option":"divine-deflection","toggleable":true},
  {"key":"Resistance","predicate":["divine-deflection"],"type":"all-damage","value":10}
]
```
Precedents: **Empyreal Dragon (Young) / Divine Deflection**;
**Duskwalker Ghost Hunter / Ghost Dodge**
(`{"predicate":["ghost-dodge"],"type":["spirit","void"],"value":5}`).

HP-threshold variant, no toggle needed — **Adamantine Dragon (Young) / Abandon Armor**:
```json
[
  {"key":"FlatModifier","predicate":[{"lt":["hp-percent",50]}],"selector":"speed","type":"circumstance","value":10},
  {"key":"Resistance","exceptions":["adamantine"],"predicate":[{"gte":["hp-percent",50]}],"type":"physical","value":10}
]
```

### 19. Give a weakness — flat, conditional, or custom-triggered

```json
{"key":"Weakness","type":"cold","value":5}
```
Precedents: **(Skeleton) Blaze**; **Effect: Claim Corpse - Skeletal**
(`bludgeoning 5`); **(Castrovelian) Gaseous Adaptation**
(`{"type":"electricity","value":"2+@actor.level"}`).

Conditional — **Snow Oni / Bean Panic**:
`{"key":"Weakness","predicate":["bean-panic"],"type":"spirit","value":20}`

Custom (a weakness to a *thing*, not a damage type) — **Tempest Incarnate / Earthbound Vulnerability**:
```json
{"key":"Weakness","definition":["earthbind"],"label":"Earthbound Vulnerability","type":"custom","value":20}
```
Gotcha: `type: "custom"` **requires** `definition`; without it the weakness never
matches anything.

### 20. Give (or remove) immunities

```json
{"key":"Immunity","type":"immobilized"}
```
Precedents: **Magma Worm / Inexorable**; **Cave Worm / Inexorable**.

List + condition — **Calikang / Suspended Animation**:
`{"key":"Immunity","predicate":["suspended-animation:enter"],"type":["disease","poison"]}`
and **Ostovite / Bone Chariot** (13-entry list).

Remove an immunity the creature's traits gave it — **Soulbound Doll (Calm) / Personality Fragments**,
**Soulbound Doll (Timid)**, **Soulbound Doll (Impish)**:
```json
{"key":"Immunity","mode":"remove","type":"spirit"}
```

### 21. Give fast healing or regeneration

```json
{"key":"FastHealing","value":20}
```
Precedents: **Yamaraj / Fast Healing 20**; **Dullahan / Fast Healing 5**;
**Naunet / Fast Healing 2** (with explicit `"type":"fast-healing"`, 16 uses).

Regeneration — **Tor Linnorm / Regeneration 20 (Deactivated by Cold Iron)**,
**Terotricus / Regeneration 25 (Deactivated by Cold)**, **Norn**:
```json
{"key":"FastHealing","deactivatedBy":["cold-iron"],"type":"regeneration","value":20}
```
Conditional — **Ofalth / Filth Wallow**, **Magma Worm / Fire Healing**,
**Redcap / Fast Healing 10**:
```json
[
  {"key":"FastHealing","predicate":["filth-wallow"],"value":2},
  {"key":"RollOption","option":"filth-wallow","toggleable":true}
]
```

`{"key":"FastHealing","predicate":[{"not":"self:effect:lost-red-cap"}],"value":10}` (Redcap).

### 22. Give temporary hit points

**Effect item only** (62/62).
```json
{"key":"TempHP","value":15}
```
Precedents: **Effect: Nature's Infusion**; **Effect: Drain Blood**
(`"value": "@item.badge.value"`); **Effect: Static Field**
(`{"predicate":["self:trait:plant"],"value":5}`).

---

## D. Auras

### 23. Give the creature a bare aura (visual/geometry only, mechanics in prose)

Live on: **the passive action item**, which should carry the `aura` trait.
143 uses — the most common Aura shape by far.
```json
{"key":"Aura","radius":60,"slug":"frightful-presence","traits":["emotion","fear","mental"]}
```
Precedents: **Yamaraj / Frightful Presence**; **Despair Dragon (Ancient) / Frightful Presence**;
**Ghoul Soldier / Stench** (`radius: 10`, `traits: ["olfactory"]`);
**Living Waterfall / Vortex**.

Gotcha: this draws a template and tags the creature — it applies **no** mechanics.
That is correct and normal for save-based auras (Frightful Presence, Stench):
the GM resolves the save from the description text. `slug` is optional
(48 uses omit it) but you need it if anything else predicates on the aura.

### 24. Give the creature an aura that debuffs enemies who enter

Live on: **the passive action item**. `effects[].uuid` must point at an effect
item that **already exists** in a compendium — see "VERIFIED UUIDs" below.
```json
{"key":"Aura","radius":100,"slug":"undead-mastery","traits":["divine"],"effects":[{"affects":"allies","events":["enter"],"includesSelf":false,"predicate":["target:mode:undead",{"lt":["target:level","self:level"]}],"uuid":"Compendium.pf2e.bestiary-effects.Item.4M2K16mH4gndHAKa"}]}
```
Precedents: **Mummy Pharaoh / Undead Mastery** (verbatim);
**Nessari / Commander's Aura** (`predicate:["target:trait:unholy",{"lt":["target:level","self:level"]}]`,
uuid `…5NSWRxAsJuvwyl0E`);
**Lesser Death / Aura of Misfortune**
(`{"affects":"all","events":["enter"],"includesSelf":false,"predicate":["target:mode:living"],"uuid":"Compendium.pf2e.bestiary-effects.Item.QoneHsjZKtGHWlam"}`);
**Leukodaemon / Infectious Aura** (`predicate:["target:creature"]`).

Observed `affects` values: `allies`, `enemies`, `all` (default when omitted:
everyone). Observed `events`: `["enter"]` only.

### 25. Give the creature an aura that buffs allies

```json
{"key":"Aura","radius":20,"slug":"harmonizing-aura","traits":["divine","sonic"],"effects":[{"affects":"allies","includesSelf":false,"uuid":"Compendium.pf2e.bestiary-effects.Item.31nnjHZqiaqaWBUi"},{"affects":"enemies","includesSelf":false,"uuid":"Compendium.pf2e.bestiary-effects.Item.tSF9z5VTeevxoww3"}]}
```
Precedents: **Choral / Harmonizing Aura** (verbatim);
**Standard Bearer / Inspiring Aura** (uuid `…lM0swBGK6CfkMb6E`);
**Teacher / Inspirational Presence** (uuid `…CiCG3r7SHYMJeUxz`);
**Crime Kingpin / Kingpin's Presence** (uuid `…X40cigEVNNMBtOre`).

### 26. Give the creature an aura it can switch off

```json
[
  {"key":"Aura","predicate":["petrifying"],"radius":30,"slug":"petrifying-gaze","traits":["arcane","visual"]},
  {"key":"RollOption","option":"petrifying","toggleable":true,"value":true}
]
```
Precedents: **Medusa / Petrifying Gaze** (verbatim);
**Mist Stalker / Mist Cloud** (`predicate:["mist-cloud-active"]`);
**Elemental Avalanche / Spike Stones** (`predicate:[{"not":"spike-stones"}]`).

Gotcha: `"value": true` on the RollOption makes the aura **on by default**; omit
it for default-off (**Exiled Revolutionary / Follow Me**).

---

## E. Movement, size, senses, actor traits

### 27. Give or change a speed

Two different keys, and they are not interchangeable.

**New/overridden base speed** — `BaseSpeed`, selectors `land`, `fly`, `swim`,
`climb`, `burrow` (also `land-speed`/`fly-speed`/`swim-speed`/`climb-speed` ship,
less often):
```json
{"key":"BaseSpeed","selector":"fly","value":25}
```
Precedents: **(Greater Barghest) Mutation - Wings**;
**Effect: Death Gasp (Etioling)**; **(Skeleton) Aquatic Bones**
(`{"selector":"swim-speed","value":20}`); **Barghest / Change Shape**
(`{"predicate":["change-shape:dog"],"selector":"land","value":35}`).

**Bonus/penalty to an existing speed** — `FlatModifier`, selectors `land-speed`
(51), `speed` (30), `all-speeds` (23), `swim-speed`, `fly-speed`:
```json
{"key":"FlatModifier","predicate":["change-formation:marching-column"],"selector":"all-speeds","slug":"marching-column-speed-bonus","type":"circumstance","value":10}
```
Precedents: **Line Infantry / Drilled in Formations** (verbatim);
**Wererat / Change Shape** (`{"predicate":["change-shape:animal"],"selector":"land-speed","value":5}`);
**Adamantine Dragon (Young) / Abandon Armor** (`selector: "speed"`).

### 28. Change the creature's size under a form

```json
{"key":"CreatureSize","predicate":["change-shape:animal"],"value":"small"}
```
Precedents: **Wererat / Change Shape**; **Pukwudgie / Change Shape**
(`change-shape:porcupine-giant` → `medium`); **Effect: Swell** (`{"value":"huge"}`).
Size-plus-reach variant — **Effect: Moon Frenzy**:
`{"key":"CreatureSize","reach":{"add":5},"value":1}`.

### 29. Add or drop actor traits conditionally

```json
{"key":"ActorTraits","add":["incorporeal","spirit"],"predicate":[{"not":"bond-with-mortal"}]}
```
Precedents: **Feathered Bear / Bond with Mortal**; **Cunning Fox / Bond with Mortal**;
**Clay Effigy / Sacred Art** (`{"add":["holy"],"predicate":["sacred-art:holy"]}`);
**(Skeleton) Aquatic Bones** (`{"add":["aquatic"]}`).

### 30. Give a sense

Only 3 precedents in the whole corpus — use sparingly.
```json
{"key":"Sense","range":60,"selector":"lifesense"}
```
Precedents: **Effect: Beseech the Spirits** (verbatim);
**Cassisian / Change Shape** (`{"acuity":"imprecise","predicate":["change-shape:dog"],"range":30,"selector":"scent"}`);
**Diver / Adjusted Eyes** (`{"predicate":["adjusted-eyes"],"selector":"low-light-vision"}`).

### 31. Make the creature emit light

```json
{"key":"TokenLight","predicate":["baleful-glow"],"value":{"animation":{"intensity":4,"speed":1,"type":"torch"},"bright":20,"color":"#9b7337","dim":40,"shadows":0.2}}
```
Precedents: **Scarecrow / Baleful Glow** (verbatim);
**Flash Beetle / Luminescent Aura** (`{"animation":{"intensity":2,"speed":8,"type":"pulse"},"bright":10,"color":"#fff9a3"}`);
**Shining Child / Blinding Aura** (`{"alpha":0.2,"bright":60,"color":"#AAAAAA"}`, no predicate).

---

## F. Conditions and marks

### 32. Make the creature permanently under a condition

Live on: **the passive action item**. `inMemoryOnly: true` means the condition is
derived, not a real embedded item the GM can delete by accident.
```json
{"key":"GrantItem","inMemoryOnly":true,"uuid":"Compendium.pf2e.conditionitems.Item.xYTAsEpcJE1Ccni3"}
```
Precedents: **Zombie Hulk / Slow**, **Zombie Brute / Slow**,
**Zombie Shambler / Slow** (slowed 1); **Danava Titan / Relentless** and
**Artillerist / Siege Acumen** (uuid `…nlCjDvLMf2EkV2dl`, quickened).

### 33. Give a condition only while a state is active

```json
{"key":"GrantItem","inMemoryOnly":true,"predicate":["shadow-invisibility"],"uuid":"Compendium.pf2e.conditionitems.Item.zJxUflt9np0q4yML"}
```
Precedents: **Betobeto-San / Shadow Invisibility** (invisible);
**Rusalka / Blurred Form** (`predicate:["terrain:underwater"]`, concealed);
**Dynamo / Extend Arms** (`predicate:["extend-arms"]`, enfeebled);
**Line Infantry / Drilled in Formations** (off-guard while in marching column).

### 34. Grant a condition at a specific value (badge)

```json
{"key":"GrantItem","alterations":[{"mode":"override","property":"badge-value","value":2}],"onDeleteActions":{"granter":"cascade"},"uuid":"Compendium.pf2e.conditionitems.Item.TBSHQspnbcqxsmjL"}
```
Precedents: **Effect: Utter Despair** (frightened 2, verbatim);
**Effect: Despair** (same minus `alterations` — frightened 1);
**Effect: Dual Mind** (clumsy 2); **Effect: Bogwid Fever**
(`"value": "@item.badge.value"`); **Jah-Tohl / Brain Blisters**
(`"value": "{item|flags.system.rulesSelections.brainBlistersStupefied}"`).

Persistent damage variant — **Effect: Compel Courage**:
`"alterations":[{"mode":"override","property":"persistent-damage","value":{"damageType":"bleed","formula":"1"}}]`.

### 35. Make a target off-guard to this creature under a circumstance

`EphemeralEffect` applies a condition **for the duration of one roll only**,
against the target of the listed selectors. Live on: **the action item**.
```json
{"key":"EphemeralEffect","predicate":["aquatic-ambush"],"selectors":["strike-attack-roll","strike-damage"],"uuid":"Compendium.pf2e.conditionitems.Item.AJh5ex99aV6VTggg"}
```
Precedents: **Crocodile / Aquatic Ambush** (paired with
`{"key":"RollOption","option":"aquatic-ambush","toggleable":true}`);
**Caligni Skulker / Tumble Behind**; **Tengu Sneak / Surprise Attacker**
(`predicate:["encounter:round:1",{"lt":["self:participant:initiative:rank","target:participant:initiative:rank"]}]`,
selectors `["strike-attack-roll","spell-attack-roll","strike-damage","attack-spell-damage"]`).

Gotcha: 33/35 uses have exactly `{predicate, selectors, uuid}`. `selectors` is
plural and an array. `AJh5ex99aV6VTggg` is off-guard — that is 40 of the 70
distinct UUIDs' worth of traffic in the corpus.

---

## G. Strikes and items

### 36. Give the creature a new strike that exists only in an alternate form

Live on: **the action item** that grants the form.
```json
{"key":"Strike","attackModifier":10,"damage":{"base":{"damageType":"bludgeoning","dice":1,"die":"d4","modifier":2}},"label":"PF2E.Strike.Fist.Label","predicate":["change-shape:humanoid"],"slug":"fist","traits":["unarmed"]}
```
Precedents: **Wererat / Change Shape**; **Werewolf / Change Shape**;
**Werebear / Change Shape**; **Cassisian / Change Shape**
(`label: "PF2E.BattleForm.Attack.Jaws"`, `slug: "jaws"`).

Ranged variant — **Stone Lion / Inhabit Vessel** adds `"range": {"increment": 30}`;
**Puppet / Puppet Type** uses `"range": {"increment": null, "max": 30}`.
Replace-all-strikes variant — **Mixed Martial Artist / Stance Shift** adds
`"replaceAll": true` and `"category": "unarmed"`.

### 37. Give all of a creature's weapons a property rune or material

```json
{"key":"AdjustStrike","mode":"add","property":"property-runes","value":"ghost-touch"}
```
Precedents: **Yamaraj / Shepherd's Touch**; **Nosoi / Shepherd's Touch**;
**Vanth / Shepherd's Touch**.

Restricted to some weapons — **Duskwalker Ghost Hunter / Ghost Hunter**,
**Sceaduinar / Entropic Touch**, **Vanth / Infuse Weapon**:
```json
{"key":"AdjustStrike","definition":[{"not":"item:category:unarmed"}],"mode":"add","property":"property-runes","value":"ghost-touch"}
```
Add a weapon trait while a toggle is on — **Giant Viper / Coil**, **Goblin Snake / Coil**:
```json
{"key":"AdjustStrike","definition":["item:slug:fangs"],"mode":"add","predicate":["coil"],"property":"weapon-traits","value":"reach-10"}
```

Observed `property` values: `property-runes`, `materials`, `weapon-traits`.
Note `definition` filters *which weapon*; `predicate` gates *whether at all*.

### 38. Add or remove a trait on one specific strike

```json
{"key":"ItemAlteration","itemType":"melee","mode":"add","predicate":["lunging-bite","item:slug:jaws"],"property":"traits","value":"reach-20"}
```
Precedents: **Mirage Dragon (Young) / Lunging Bite**;
**Mirage Dragon (Adult) / Lunging Bite** (`reach-25`);
**Shadow Giant / Shadow Chain** (`item:slug:spiked-chain`, `reach-60`);
**Adamantine Dragon (Young) / Adamantine Body**
(`{"mode":"add","predicate":[{"not":"item:slug:rock"}],"property":"traits","value":"adamantine"}`).

Removal — **Cacodaemon / Change Shape**:
`{"itemType":"melee","key":"ItemAlteration","mode":"remove","predicate":["item:slug:jaws","change-shape:lizard"],"property":"traits","value":"disease"}`.

Gotcha: NPC strikes are `itemType: "melee"` (yes, even ranged NPC strikes use the
`melee` item type in PF2e). Observed `property` values across all 575 uses:
`name` (456 — glossary renaming, not for you), `traits` (80), `description` (21),
`area-size` (7), `hardness` (4), `pd-recovery-dc` (4), `hp-max` (3).

### 39. Let the creature swap the damage type of its strikes

```json
[
  {"key":"RollOption","option":"phantom-touch","toggleable":true},
  {"key":"DamageAlteration","mode":"override","predicate":["phantom-touch"],"property":"damage-type","selectors":["strike-damage"],"value":"spirit"}
]
```
Precedents: **Phantom Knight / Phantom Touch**; **Phantom Beast / Phantom Touch**;
**Elemental Inferno / Blue Flames**
(`{"mode":"add","property":"dice-number","selectors":["inferno-leap-inline-damage","intense-heat-inline-damage"],"value":3}`).

Observed `property`: `damage-type`, `dice-faces`, `dice-number`.
Observed `mode`: `override`, `upgrade`, `add`. `selectors` is always an array.

### 40. Give the creature weapon critical specialization

```json
{"key":"CriticalSpecialization"}
```
Precedents: **Graveknight / Weapon Master**; **Graveknight Captain / Weapon Master**;
**Graveknight Warmaster / Weapon Master**. Restricted variant —
**Hobgoblin General / Polearm Critical Specialization**:
`{"key":"CriticalSpecialization","predicate":["item:group:polearm"]}`.

### 41. Give an ability its own attack roll (an ability that isn't a Strike)

Live on: **the action item**. Two rules, always together.
```json
[
  {"key":"SpecialStatistic","slug":"hurl-net","type":"attack-roll"},
  {"key":"FlatModifier","selector":"hurl-net-attack-roll","value":9}
]
```
Precedents: **Tripkee Scout / Hurl Net** (verbatim);
**Jailer / Efficient Capture**; **Millindemalion / Hat Toss**
(`{"key":"SpecialStatistic","label":"Hat Toss","slug":"millindemalion-hat-toss","type":"attack-roll"}` +
`{"key":"FlatModifier","selector":"millindemalion-hat-toss","value":27}`);
**Kuribu / Blessed Aspect**.

Gotcha: the FlatModifier selector is either `<slug>-attack-roll` (Hurl Net) **or**
just `<slug>` (Hat Toss, Blessed Aspect) — both ship; `<slug>-attack-roll` is the
safer form. `type: "attack-roll"` is the only observed `type`.

---

## H. Notes (chat reminders)

### 42. Print the ability text on a strike's damage card

```json
{"key":"Note","selector":"jaws-damage","text":"{item|description}","title":"{item|name}","visibility":"owner"}
```
Precedents: **Wererat / Curse of the Wererat**; **Barghest / Change Shape**
(`"text":"@Localize[PF2E.NPC.Abilities.Glossary.Knockdown]","title":"Knockdown"`);
**Mimic / Mimic Object** (`selector: "deception"`).

### 43. Print a reminder only on a critical hit

```json
{"key":"Note","outcome":["criticalSuccess"],"selector":"strike-attack-roll","text":"{item|description}","title":"{item|name}","visibility":"owner"}
```
Precedents: **Horned Dragon (Young) / Draconic Momentum**;
**Omen Dragon (Ancient, Spellcaster) / Impending Fate** (`selector: "attack-roll"`);
**Shuln / Armor-Rending Strikes**
(`{"outcome":["criticalSuccess"],"selector":"melee-strike-damage","text":"{item|system.description.value}","title":"{item|name}","visibility":"owner"}`).

Gated on a toggle — **Rekhep / Terrifying Smite**:
`{"key":"Note","outcome":["success","criticalSuccess"],"predicate":["terrifying-smite"],"selector":"strike-damage","text":"{item|system.description.value}","title":"{item|name}","visibility":"owner"}`.

Gotcha: `text` is either `{item|description}` or `{item|system.description.value}`
— both ship and both mean "this ability's own text". `visibility` is `"owner"`
(most) or `"gm"`. `outcome` values seen: `criticalSuccess`, `success`,
`criticalFailure`.

---

## I. Toggles and NPC "choices"

### 44. Add a plain on/off toggle

```json
{"key":"RollOption","option":"filth-wallow","toggleable":true}
```

225 uses. Precedents: **Ofalth / Filth Wallow**; **Scarecrow / Baleful Glow**;
**Crocodile / Aquatic Ambush**. Add `"value": true` for default-on
(**Flash Beetle / Luminescent Aura**, **Medusa / Petrifying Gaze**,
**Ogre Glutton / Glutton's Rush** — 22 uses).

### 45. Let the GM pick one of several modes for an NPC (instead of ChoiceSet)

```json
{"key":"RollOption","alwaysActive":true,"label":"PF2E.NPCAbility.ChangeShape.Label","option":"change-shape","selection":"hybrid","suboptions":[{"label":"PF2E.NPCAbility.ChangeShape.Form.Hybrid","value":"hybrid"},{"label":"PF2E.NPCAbility.ChangeShape.Form.Humanoid.Humanoid","value":"humanoid"},{"label":"PF2E.NPCAbility.ChangeShape.Form.Animal.Animal","value":"animal"}],"toggleable":true,"value":true}
```
Precedents: **Wererat / Change Shape** (verbatim); **Lamia Matriarch / Change Shape**;
**Pukwudgie / Change Shape**; **Line Infantry / Drilled in Formations**
(2 suboptions, no `alwaysActive`); **Hadrinnex / Rapid Evolution** (7 damage types).

Gotcha, two of them:
1. The selection produces the compound option `"<option>:<value>"` —
   predicate on `change-shape:animal`, not on `animal`.
2. The chosen value is also readable as
   `{item|flags.system.rulesSelections.<camelCasedOption>}` —
   `rapid-evolution-husk` → `rapidEvolutionHusk`
   (**Hadrinnex / Rapid Evolution**: `{"key":"Resistance","type":"{item|flags.system.rulesSelections.rapidEvolutionHusk}","value":15}`).
   Get the camel-casing wrong and the value silently resolves to nothing.

---

## J. ActiveEffectLike — direct writes to actor data

Only these paths have precedent. Anything else is a guess.

| Path | mode | value | precedent |
|---|---|---|---|
| `system.attributes.hp.negativeHealing` | override | `true` | Ghoul Soldier / Void Healing (71 uses) |
| `system.attributes.flanking.flankable` | override | `false` | Hydra / All-Around Vision (35 uses) |
| `system.attributes.flanking.canFlank` | override | `false` | Effect: Aura of Disquietude |
| `system.attributes.flanking.offGuardable` | override | `7` / `8` / `12` | Gang Leader / Deny Advantage |
| `system.attributes.flanking.canGangUp` | **add** | `true` | Gang Leader / Gang Up |
| `system.attributes.hardness.value` | override | `0` / `5` | Animated Armor / Construct Armor (10 uses) |
| `system.attributes.dying.recoveryDC` | **subtract** | `2` | Effect: Near-Death Experience |
| `system.attributes.emitsSound` | override (`phase: "beforeDerived"`) | `false` | Effect: Silent Aura |
| `system.movement.terrain.difficult.ignored` | **add** | `{"environment":"all","feature":"all"}` | Gimmerling / Trickster's Step |
| `flags.system.<name>` | override | any | Ogre Glutton / Glutton's Rush, Hadrinnex / Rapid Evolution |

### 46. Give void healing (undead-style negative healing)

```json
{"key":"ActiveEffectLike","mode":"override","path":"system.attributes.hp.negativeHealing","value":true}
```
Precedents: **Ghoul Soldier / Void Healing**; **Greater Shadow / Void Healing**.

### 47. Make the creature immune to flanking

```json
{"key":"ActiveEffectLike","mode":"override","path":"system.attributes.flanking.flankable","value":false}
```
Precedents: **Hydra / All-Around Vision**; **Grikkitog / Manifold Vision**
(`predicate: ["implant-core"]`).

### 48. Give hardness that drops below half HP (construct armor)

```json
{"key":"ActiveEffectLike","mode":"override","path":"system.attributes.hardness.value","phase":"afterDerived","predicate":[{"or":["construct-armor",{"lt":["hp-percent",50]}]}],"value":0}
```
Precedents: **Animated Armor / Construct Armor (Hardness 9)**;
**Animated Statue / Construct Armor (Hardness 6)**;
**Giant Animated Statue / Construct Armor (Hardness 10)**.

Gotcha: `phase: "afterDerived"` is required here — the hardness is set by the
statblock during derivation, so an unphased override is overwritten.

---

# PREDICATE COOKBOOK

Operators actually used, with counts: `or` 175, `not` 117, `lt` 43, `gte` 33,
`lte` 16, `and` 9, `nor` 4, `gt` 3. **`xor`, `if`/`then`, `nand` never appear.**

A predicate is an **array**; all top-level entries are ANDed.

| Form | Example (verbatim) | From |
|---|---|---|
| bare slug (a RollOption set elsewhere) | `["pack-attack"]` | Greater Hell Hound / Pack Attack |
| negation | `[{"not": "change-shape:humanoid"}]` | Barghest / Change Shape |
| alternation | `[{"or": ["change-shape:humanoid-medium","change-shape:humanoid-small"]}]` | Conspirator Dragon (Ancient) / Conjure Disguise |
| numeric compare (HP %) | `[{"lt": ["hp-percent", 50]}]` | Adamantine Dragon (Young) / Abandon Armor |
| numeric compare (raw HP) | `[{"lte": ["hp-remaining", 25]}]` | Deluded Mob / Victim Complex |
| numeric compare (level) | `[{"lte": ["self:level", 14]}]` | Effect: Symbol of Loyalty |
| relative level | `[{"lt": ["target:level", "self:level"]}]` | Mummy Pharaoh / Undead Mastery |
| distance | `[{"lte": ["target:distance", 30]}]` | Halfling Street Watcher / Keen Eyes |
| initiative order | `[{"lt": ["self:participant:initiative:rank","target:participant:initiative:rank"]}]` | Tengu Sneak / Surprise Attacker |
| nested and/or | `[{"and": ["item:type:weapon","target:signature:{item\|origin.signature}",{"or":["item:bulk:light","item:bulk:negligible","item:category:unarmed"]}]}]` | Effect: Engulf and Swallow Whole |
| `nor` | `[{"nor": ["target:mark:engaging-duel","origin:mark:engaging-duel"]}]` | Effect: Engaging Duel |
| combined AND (implicit) | `["formation", "area-effect"]` | Hobgoblin Archer / Formation |

Atom families verified in the corpus (count of uses):

- **bare slugs** (866) — your own RollOptions, and bare trait words on effect
  items: `"emotion"` (Effect: Gloom Aura), `"fear"` (Effect: Inspiring Presence),
  `"sonic"`, `"auditory"` (Effect: Harmonizing Aura), `"area-effect"`.
- **`item:*`** — `item:magical` (116), `item:trait:<t>` (209), `item:slug:<s>` (111),
  `item:type:{spell,weapon,consumable,equipment}`, `item:category:{unarmed,physical}`,
  `item:damage:type:<t>`, `item:damage:category:physical`, `item:melee`,
  `item:ranged`, `item:equipped`, `item:group:<g>`, `item:base:staff`,
  `item:bulk:{light,negligible}`, `item:area:type:{burst,cone,line}`,
  `item:duration:0`, `item:tag:object`, `item:granter:id:{item|id}`.
- **`target:*`** — `target:condition:<c>` (127: off-guard, frightened, grabbed,
  hidden, prone), `target:mark:<slug>` (26), `target:mode:{living,undead}` (25),
  `target:trait:<t>` (23), `target:creature`, `target:effect:<slug>`,
  `target:signature:{item|origin.signature}`, `target:distance`, `target:level`.
- **`self:*`** — `self:effect:<slug>` (28), `self:trait:<t>`, `self:condition:<c>`,
  `self:level`, `self:signature:{item|origin.signature}`,
  `self:participant:initiative:{rank,stat:<skill>}`.
- **`origin:*`** (on effect items, refers to whoever applied the effect) —
  `origin:trait:<t>` (17), `origin:mark:<slug>`,
  `origin:signature:{item|origin.signature}`.
- **`parent:*`** (on granted items) — `parent:badge:value:<n>`, `parent:trait:<t>`.
- **`check:*`** — `check:total:natural:19` (12), `check:total:delta`,
  `check:statistic:<skill>`, `check:statistic:base:<skill>`,
  `check:outcome:critical-success`, `check:roll:total:natural:19`.
- **`damage:*` / `dice:*`** — `damage:type:<t>`, `damage:material:<m>`,
  `dice:damage:type:<t>`, `dice:slug:<s>`.
- **`penalty:*` / `bonus:*`** — `penalty:type:<t>`, `penalty:slug:<c>`,
  `bonus:type:circumstance`.
- **misc** — `encounter:round:1` (12), `terrain:underwater`, `hp-percent`,
  `hp-remaining`, `spellcasting:category:innate`, `spellcasting:tradition:divine`,
  `deity:primary:<god>`, `action:<slug>` (see recipe 10).

---

# ROLL OPTION DOMAINS AND SELECTORS THAT ACTUALLY EXIST ON NPCS

## `domain` values on RollOption (a RollOption on a nonexistent domain is inert)

Only 14 distinct domains appear across 733 RollOptions, and 176 of those uses are
just two:

| domain | uses | precedent |
|---|---|---|
| `damage` | 125 | Greater Hell Hound / Pack Attack |
| `ac` | 31 | Ofalth / Refuse Pile |
| `attack-roll` | 24 | Crocodile / Death Roll |
| `skill-check` | 7 | Vilderavn / Souleater |
| `strike-damage` | 6 | Rekhep / Terrifying Smite |
| `perception` | 5 | Clockwork Dragon / Wind-Up |
| `saving-throw` | 4 | Gancanagh / Vulnerable to Smoke |
| `ranged-attack-roll` | 4 | Elf Ranger / Double Shot |
| `attack` | 3 | Raktavarna / Betraying Bite |
| `will` | 2 | Hellcat / Hell Pack Mindlink |
| `{item\|id}-damage` | 2 | Evangelist / Morningstar |
| `initiative` | 1 | Samsaran Anchorite / All This Has Happened Before |
| `deception` | 1 | (Ulgrem-Axaan) Crocodile Tears |

Omitting `domain` entirely (388 of 733 uses) is fine and gives a sheet-level toggle.

## `selector` values (210 distinct; these are the ones with ≥3 precedents)

**Saves / defenses:** `saving-throw` (390), `ac` (170), `will` (52), `reflex` (35),
`fortitude` (17), `will-dc`, `perception-dc`, `deception-dc`, `spell-dc`,
`damage-received`, `hp`, `healing-received`, `pd-recovery-check`.

**Attacks:** `strike-attack-roll` (96), `attack` (89), `attack-roll` (44),
`spell-attack-roll` (18), `melee-strike-attack-roll`, `ranged-strike-attack-roll`,
`melee-attack-roll`, `spell-attack`, `attack-damage`, `{item|_id}-attack`,
`<slug>-attack` (e.g. `jaws-attack`, `tail-attack`, `fist-attack`).

**Damage:** `strike-damage` (296), `damage` (95), `melee-strike-damage` (25),
`{item|_id}-damage` (53), `{item|id}-damage` (22), `attack-spell-damage` (17),
`spell-damage` (15), `inline-damage` (11), `ranged-strike-damage`,
`{item|id}-inline-damage`, `<slug>-damage`, `<slug>-inline-damage`.

**Skills:** `skill-check` (71), `athletics` (29), `deception` (27), `survival` (24),
`acrobatics` (13), `diplomacy` (12), `performance` (11), `intimidation` (7),
`stealth` (14), `medicine` (5), `thievery` (4), `crafting` (3), `nature` (3),
`deception-check`, `perception` (92), `perception-check`, `initiative` (36).

**Speeds:** `land-speed` (55), `speed` (30), `all-speeds` (27), `fly` (13),
`land` (10), `swim`, `climb`, `burrow`, `swim-speed`, `fly-speed`, `climb-speed`.

**Other:** `all` (29 — every d20 roll), `spell-healing`, `cha-based`, `wis-based`.

A selector that isn't in this list (or isn't `<your-strike-slug>-damage`) has no
precedent; verify before emitting.

---

# VERIFIED UUIDs

Only reference a UUID that exists. Each of these is confirmed by at least one
shipped rule element; condition names are confirmed by an in-data label
(`PF2E.condition.*.name` / `PF2E.ConditionType*`) or by the ability's own text.

## Conditions — `Compendium.pf2e.conditionitems.Item.<id>`

| Condition | id | evidence |
|---|---|---|
| Off-Guard | `AJh5ex99aV6VTggg` | Caligni Skulker / Tumble Behind ("that creature is Off-Guard") |
| Slowed | `xYTAsEpcJE1Ccni3` | Zombie Hulk / Slow ("permanently slowed 1") |
| Quickened | `nlCjDvLMf2EkV2dl` | Danava Titan / Relentless ("permanently Quickened") |
| Clumsy | `i3OJZU2nk64Df3xm` | Curse Monger / Incurable Curse suboption label |
| Drained | `4D2KBtexWXa6oUMR` | Curse Monger / Incurable Curse suboption label |
| Enfeebled | `MIRkyAjyBeXivMa7` | Curse Monger / Incurable Curse suboption label |
| Stupefied | `e1XGnhKNSQIm5IXg` | Curse Monger / Incurable Curse suboption label |
| Invisible | `zJxUflt9np0q4yML` | Will-o'-Wisp / Go Dark suboption `PF2E.ConditionTypeInvisible` |
| Hidden | `iU0fEDdBp3rXpTMC` | Will-o'-Wisp / Go Dark suboption `PF2E.ConditionTypeHidden` |
| Concealed | `DmAIPqOBomZ7H95W` | Rusalka / Blurred Form ("is Concealed while underwater") |
| Frightened | `TBSHQspnbcqxsmjL` | Effect: Despair ("are frightened 1 while in a despair aura") |
| Grabbed | `kWc1fhmv9LBiTuei` | Effect: Engulf and Swallow Whole ("You are grabbed, slowed 1…") |
| Immobilized | `eIcWbB5o3pP6OIMe` | Effect: Radiate Cold ("Critical Failure You are immobilized") |
| Dazzled | `TkIyaNPgTZFBCCuh` | Effect: Aura of Reflection ("You are dazzled…") |
| Sickened | `fesd1n5eVhpCSS18` | Effect: Vulnerable to Curved Space ("becomes sickened 1") |
| Persistent Damage | `lDVqvLKA6eF3Df60` | Effect: Compel Courage (`persistent-damage` alteration) |

## Reusable aura effects — `Compendium.pf2e.bestiary-effects.Item.<id>`

| Effect | id | what it does |
|---|---|---|
| Commander's Aura | `5NSWRxAsJuvwyl0E` | +1 circ to ac/attack/saving-throw/skill-check/damage |
| Undead Mastery | `4M2K16mH4gndHAKa` | same +1 circumstance package |
| Inspiring Presence (Empyreal Dragon) | `tgF8r8uXyw3IFWBp` | +1 status to saving-throw & skill-check |
| Inspiring Aura | `lM0swBGK6CfkMb6E` | +1 status initiative & saves vs fear |
| Sentinel's Aura | `zrW4ETHiYN2r7Hks` | +1 status AC |
| Verdant Aria | `Kwz70TYirPYYL3J3` | +2 status AC and saves |
| Aura of Command | `OxOMYmlPtjsEkRtY` | +1 status attack, +2 status will |
| Symbol of Loyalty | `QMRMgU8l697aBcxj` | +3 status will if `self:level ≤ 14` |
| Kingpin's Presence | `X40cigEVNNMBtOre` | +2 status saves vs mental |
| Calming Bioluminescence | `pfG1S7yShwkHT9e0` | +2 circ saves vs emotion |
| Follow Me | `EJVV3zsMOhDBqxGM` | +2 circ deception & stealth |
| Gloom Aura | `Me16QQGxpivWE2WW` | −1 circ saves vs emotion |
| Unsettled Aura | `aOpSI5tApXF5xHCM` | −1 status Will |
| Beguiling Presence | `pPmtUt7lPYfbVqbR` | −2 status Will vs Request |
| Infectious Aura | `T2tfacwoOozQfsIz` | −2 status saves vs disease |
| Despoiler | `itdoXvcDo8wwmTME` | −2 circ saves vs poison/disease/drug |
| Champion's Aura (Rovagug) | `xLy4bBwk50AGbd7w` | −1 circ saves vs fear |
| Void Tendrils | `dl8qj25dK6PtO5Y7` | −15 vitality healing received |
| Aura of Misfortune | `QoneHsjZKtGHWlam` | RollTwice keep lower, all |
| Mist Cloud | `5SLAqVPYa0kliRDt` | grants Concealed |
| Fetid Fumes | `mD44D9I05NQaXiED` | grants Concealed |
| Air of Authority | `Df5j0AitqDVE08hL` | −2 status will-dc vs Coerce/Demoralize |
| Never off the Hook | `hJJzppHOKE6g6iEJ` | −3 circ will-dc vs Coerce/Demoralize |
| Harmonizing Aura (Allies) | `31nnjHZqiaqaWBUi` | +1 AC/saves & +2 damage vs sonic |
| Harmonizing Aura (Enemies) | `tSF9z5VTeevxoww3` | the mirrored penalty |
| Guardian's Aegis | `AL7E03DYahfDhbcR` | +1 status saves vs magic (2 vs fiends) |
| Steward of the Faithful | `Fjyhw3lhuHCz01xS` | void resistance 5, +1 will/diplomacy/medicine |
| Five Color Dance | `jhYlpTfRASb4P3r3` | +3 hardness / +20 HP to worn gear |
| Resonance | `1dwMVgBHfT4qO4OS` | elemental ChoiceSet + +1 status attack/damage |

## Glossary abilities you can GrantItem — `Compendium.pf2e.bestiary-ability-glossary-srd.Item.<id>`

`Tkd8sH4pwFIPzqTr` = Grab · `BCLvAx4Pz4MLa2pu` = Knockdown ·
`9qV49KjZujZnSp6w` = All-Around Vision · `HBrBrUzjfvj2gDXB` = Aquatic Ambush.
Precedents: **Cacodaemon / Change Shape**, **Cassisian / Change Shape**,
**Troll Warleader / Shed Armor**, **(Skeleton) Aquatic Bones**.

---

# DO NOT EMIT

These keys are real and shipped, but need a build-time or authoring context an
imported NPC statblock doesn't have. Emitting them produces a rule that is inert,
or a dialog the GM has to dismiss on every import.

1. **`ChoiceSet`** — 0 uses on `npc-action` in 2604 samples. It prompts at item-
   creation time and writes `flags.system.rulesSelections.<flag>`, which every
   downstream rule must then reference by exact camelCase. Use **RollOption with
   `suboptions`** (recipe 45) — that is what Paizo does for NPCs.
2. **`TokenMark`** on anything other than an `Effect:` item — 20/20 precedents are
   effect items. A mark on the attacker marks nothing.
3. **`TempHP`** on anything other than an `Effect:` item — 62/62 are effect items.
4. **`RollTwice`** on an `npc-action` — 0/32 precedents.
5. **`ItemAlteration` with `property: "name"`** — 456 of the 575 uses are the
   glossary's own `{"itemId":"{item|id}","mode":"override","property":"name"}`
   renaming machinery, driven by localization keys that only exist inside the
   family-ability packs. A generated NPC has no such key.
6. **Any `uuid` you did not copy from the tables above.** A `GrantItem`,
   `EphemeralEffect`, or `Aura.effects[].uuid` that points at a nonexistent
   document imports silently and does nothing at all. There is no mechanism for
   a statblock to *define* a new effect item, so you can only reference existing
   ones.
7. **`{item|flags.system.rulesSelections.*}` references** unless the same item
   also carries the RollOption/ChoiceSet that populates them. 100% of the ~30
   uses in the corpus are self-contained on one item.
8. **`SpecialStatistic` without its paired `FlatModifier`** — the statistic exists
   with a +0 modifier and the ability rolls at zero.
9. **`Strike` without `attackModifier` and `damage.base`** — every one of the 52
   precedents has both.
10. **`Aura` with `effects` but no `slug`** is legal (12 precedents) but an Aura
    that anything else predicates on **must** have `slug`.

---

# NO PRECEDENT FOUND

Things a statblock generator will want, that the corpus does not support. Write
these into the ability's descriptive text instead of into a rule element.

- **A save-based aura that rolls the save automatically.** Every one of the 263
  Auras either applies a fixed effect on entry or does nothing mechanical. There
  is no `Aura` field for a DC or a save. Frightful Presence, Stench, and Petrifying
  Gaze are all prose + a geometry marker.
- **Persistent damage applied by a strike.** No rule element in the corpus adds
  persistent damage from a Strike; it is always text plus (occasionally) a `Note`.
  The only persistent-damage mechanism is `GrantItem` + `alterations`
  `property: "persistent-damage"` on an *effect* item.
- **Triggering off a specific enemy action (reactions).** No key expresses
  "when the target does X". Reactions are actionType metadata plus prose.
- **`xor`, `if`/`then`, `nand` predicate operators** — 0 uses. Rewrite with
  `or`/`not`/`nor`.
- **`Sense` for darkvision, tremorsense, or scent range increases on a base
  creature** — only 3 `Sense` rules exist in the entire corpus, all tied to a
  form change or an effect. Base senses belong in the statblock's `senses` field,
  not in a rule element.
- **A `FlatModifier` targeting a specific spell's DC or a specific spell rank** —
  `spell-dc` and `spell-attack` exist as selectors (7 and 5 uses) but never
  scoped to one spell.
- **Adjusting an NPC's number of actions, or granting an extra action** —
  the only shipped approach is `GrantItem` of the Quickened condition
  (`nlCjDvLMf2EkV2dl`), with the restriction written in prose.
