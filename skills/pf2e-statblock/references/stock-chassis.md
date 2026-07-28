# Stock Chassis Vocabulary — PF2e Remaster NPC Corpus

Frequency-mined from 1,214 official Remaster NPCs (Monster Core 492, Monster Core 2 445, NPC Core 271, NPC Gallery 6), levels −1..25.
Totals: 5,809 actions (2,979 distinct names), 2,618 strikes (422 distinct names), 685 strike-effect references (260 distinct slugs), 607 spellcasting entries.

Every name below is **exact canonical spelling** — paste verbatim. Counts are **distinct creatures** unless marked otherwise.

---

## 0. REMASTER HYGIENE — what to exclude

The corpus is almost entirely clean. Full audit:

| Legacy artefact | Hits | Where | Verdict |
|---|---|---|---|
| `evil` creature trait | 3 | Smoke Creeper (MC2), Antipaladin (NPC Gallery), Nyctessa (NPC Gallery) | **EXCLUDE** |
| `chaotic` creature trait | 1 | Antipaladin (NPC Gallery) | **EXCLUDE** |
| `good` / `lawful` traits | 0 | — | n/a |
| `negative` / `positive` damage | 0 | — | already `void` / `vitality` |
| `flat-footed` | 0 | — | corpus uses `off-guard` (418 occurrences) |
| School traits (abjuration, conjuration, divination, enchantment, evocation, necromancy, transmutation) | 0 | — | fully purged |
| `remaster: false` actors | 6 / 1214 | **all 6 from `npc-gallery`**: Server (−1), Barkeep (1), Acolyte of Nethys (1), Antipaladin (5), Nyctessa (5), Priest of Pharasma (6) | **EXCLUDE npc-gallery entirely as a style source** |
| `Attack of Opportunity` | 0 on creatures; **1 stale entry in `bestiary-ability-glossary-srd`** | glossary only | **NEVER emit.** Canonical name is **`Reactive Strike`** (114 creatures) |
| `illusion` trait | 35 (1 creature trait, 2 strike traits, 22 action traits) | — | **KEEP** — `illusion` survives the Remaster as a general trait; it is not a school trait |

Also legitimate and Remaster-correct in this corpus, do not "fix": `holy` / `unholy` (replacing good/evil weapon+creature traits), `spirit` and `void` and `vitality` damage, `sanctified`, `Void Healing` (was Negative Healing).

Alignment-adjacent replacements actually used: creature traits `holy` 54, `unholy` 165; weakness `holy` 78, `unholy` 36; strike traits `holy` 82, `unholy` 160.

---

## 1. UNIVERSAL ABILITIES — reuse these by name

Ranked by distinct creatures. `cost` column: `1`/`2`/`3` = actions, `R` = reaction, `F` = free action, `—` = passive. All these are SRD-glossary or de-facto glossary chassis; the importer resolves them and a generator should re-use the name verbatim rather than invent.

### Tier 1 — appear on 30+ creatures (use freely at any level)

| n | Name | Cost | actionType | category | traits | Level span | What it does |
|---|---|---|---|---|---|---|---|
| 153 | **Grab** | 1 | action | offensive | — | −1..22 | Requires a hit with the listed Strike; target becomes grabbed until it Escapes or the creature moves away. |
| 114 | **Reactive Strike** | R | reaction | defensive | — | 1..25 | Trigger: foe in reach uses a manipulate/move action, makes a ranged attack, or leaves a square. Melee Strike; crit vs manipulate disrupts. |
| 112 | **Constant Spells** | — | passive | interaction | — | 0..25 | Header line listing always-on spells at a rank; not an action. |
| 99 | **+1 Status to All Saves vs. Magic** | — | passive | defensive | — | 1..21 | Pure numeric rider. Variants: `+2 Status to All Saves vs. Arcane` (24), `vs. Occult` (21), `vs. Primal` (19), `vs. Divine` (14), `+4 Status to All Saves vs. Mental` (8). |
| 96 | **Telepathy 100 feet** | — | passive | interaction | `aura, magical, mental` | 1..24 | Two-way mental communication with anything sharing a language. Range variants below. |
| 79 | **Sneak Attack** | — | passive | offensive | — | −1..18 | +1d6 precision damage (scaling by level) to **off-guard** creatures. Use "off-guard", never "flat-footed". |
| 70 | **Change Shape** | 1 | action | offensive | `polymorph, concentrate` (+ one tradition trait: divine 24 / primal 20 / occult 15 / arcane 5) | −1..20 | Assumes a listed alternate form; usually swaps the Strike block. |
| 70 | **Void Healing** | — | passive | defensive | — | −1..21 | Healed by void damage, harmed by vitality damage. (Undead/void-touched default.) |
| 48 | **Improved Grab** | F | free | offensive | — | 3..24 | Free-action Grab after a hit with the listed Strike; no MAP cost. |
| 45 | **Constrict** | 1 | action | offensive | — | 1..21 | Automatic damage to a creature the monster already has grabbed, basic Fortitude for half. |
| 43 | **Frightful Presence** | — | passive | defensive | `aura, emotion, fear, mental` | 7..24 | Aura (usually 30/60/90 ft); Will save or frightened 1/2/4 by degree, temp-immune 1 min on success. |
| 38 | **Swallow Whole** | 1 | action | offensive | `attack` | 2..20 | After a Grab-style hit: swallow a creature of listed size; it takes damage each round; Rupture value ends it. |
| 37 | **Greater Darkvision** | — | passive | interaction | — | 0..20 | Sees in magical darkness. |
| 34 | **Knockdown** | 1 | action | offensive | — | 0..18 | Strike + Trip against a hit target. |
| 34 | **Trample** | 3 | action | offensive | — | 3..23 | Stride while moving through creatures of listed size or smaller, dealing the listed Strike's damage; basic Reflex. |
| 32 | **All-Around Vision** | — | passive | defensive | — | 1..24 | Can't be flanked. |

### Tier 2 — 10–30 creatures

| n | Name | Cost | actionType | category | traits | What it does |
|---|---|---|---|---|---|---|
| 25 | **Smoke Vision** | — | passive | interaction | — | Ignores concealed from smoke. |
| 23 | **Pack Attack** | — | passive | offensive | — | Extra damage vs. a foe within reach of ≥2 of the creature's allies. |
| 23 | **Troop Defenses** | — | passive | defensive | — | Troop-only: segment HP thresholds line. |
| 23 | **Troop Movement** | — | passive | defensive | — | Troop-only: how segments relocate. |
| 22 | **Shield Block** | R | reaction | defensive | — | Standard shield reaction. |
| 20 | **Swarm Mind** | — | passive | defensive | — | Mindless-swarm immunity package (no single mind to target). |
| 19 | **At-Will Spells** | — | passive | interaction | — | Header line for unlimited-use innate spells. |
| 17 | **Deep Breath** | — | passive | interaction | — | Holds breath for N rounds/minutes. |
| 15 | **Pounce** | 1 | action | offensive | — | Stride then Strike; if it started hidden it stays hidden until after the Strike. |
| 15 | **Ferocity** | R | reaction | defensive | — | At 0 HP stay at 1 HP, wounded +1; unusable at wounded 3. |
| 14 | **Rend** | 1 | action | offensive | — | Automatic repeat of a named Strike if both of that Strike hit the same foe this turn. |
| 14 | **Light Blindness** | — | passive | defensive | — | Standard drow/subterranean light weakness. |
| 13 | **Forest Passage** | — | passive | offensive | — | Ignores difficult terrain from forest growth. |
| 13 | **Buck** | R | reaction | defensive | — | Mount reaction to throw a rider. |
| 12 | **Earth Glide** | — | passive | offensive | — | Burrows through stone at full burrow Speed, leaving no tunnel. |
| 11 | **Stench** | — | passive | defensive | `aura, olfactory` | Aura, Fortitude or sickened 1 (+slowed 1 on crit fail). |
| 11 | **Focus Gaze** | 1 | action | offensive | `visual, concentrate` + tradition (+`fear`/`mental` often) | Single-target gaze forcing a save. |
| 10 | **Throw Rock** | 1 | action | offensive | — | Ranged rock Strike (pairs with `rock` strike entry). |
| 10 | **Rejuvenation** | — | passive | defensive | `divine` (8) / `arcane` / `occult` | Undead/haunt reforms after destruction unless a stated condition is met. |

### Tier 3 — 3–9 creatures (still stock, still worth reusing verbatim)

`Motion Sense` 9 · `Rock Tunneler` 9 · `Camouflage` 9 · `Archon's Protection` 9 (R) · `Nimble Dodge` 8 (R) · `Coven` 8 (`mental, occult`) · `Status Sight` 8 · `Improved Knockdown` 7 (F) · `Twisting Tail` 7 (R) · `Swarming Bites` 7 (1) · `Gallop` 7 (2) · `Slow` 7 · `Sunlight Powerlessness` 7 · `No Breath` 7 · `Push 10 feet` 7 (1) · `Siphon Life` 7 (R, `divine, healing, vitality`) · `Consume Fear` 7 (R, `occult`) · `Greater Constrict` 6 (1) · `Fast Swallow` 6 (R) · `Sudden Charge` 6 (2) · `Aquatic Ambush` 6 (1) · `Tongue Grab` 6 · `Keen Eyes` 6 · `Steady Spellcasting` 6 · `Swiftness` 6 · `Rugged Travel` 6 · `Telepathy (Touch)` 6 · `Drink Blood` 5 (1, `divine`) · `Speed Surge` 5 (1, `move`) · `Wrap in Coils` 5 (1) · `Powerful Fists` 5 · `Healing Hands` 5 · `Animal Empathy` 5 · `Mauler` 5 · `Web Sense` 5 · `Moon Frenzy` 4 (`polymorph, primal`) · `Statue` 4 (1, `concentrate`) · `Powerful Charge` 4 (2) · `Engulf` 4 (2) · `Web Trap` 4 · `Capsize` 4 (1, `attack`) · `Explosion` 4 · `Swarming` 4 · `Flurry of Blows` 4 (1) · `Quick Draw` 4 (1) · `Deny Advantage` 4 · `Bravery` 4 · `Surprise Attack` 4 · `Plant Empathy` 4 · `Site Bound` 4 · `Weapon Master` 4 · `Cold Adaptation` 4 · `Drag` 3 (1) · `Sprint` 3 (2) · `Swoop` 3 (2) · `Jet` 3 (`move`) · `Thrash` 4 (2) · `Split` 3 · `Self-Destruct` 3 (R) · `Inexorable March` 3 (1) · `Terrain Advantage` 3 · `Wide Swing` 3 (1) · `Wide Cleave` 3 (2) · `Blood Scent` 3 · `Nature Empathy` 3 · `Hunt Prey` 3 (1, `concentrate`) · `Running Reload` 3 · `Hidden Movement` 3.

**Numeric-family templates** (collapse the number, keep the grammar):
- `Telepathy N feet` — 119 creatures. Observed N: 100 (96), 60 (11), 90 (4), 120 (3), 30 (3); plus `Telepathy (Touch)` 6.
- `Lifesense N feet` — 25; also `Lifesense (Imprecise) N feet` 8.
- `Tremorsense (Imprecise) N feet` — 38 (60ft ×15, 30ft ×9, 90/100/120 tail); bare `Tremorsense N feet` 7 (precise).
- `Fast Healing N` — 23 (N = 5, 10, 15, 20).
- `Regeneration N (Deactivated by X)` — 14 total; X ∈ `Holy or Silver` (6), `Cold Iron` (5), `Electricity or Fire` (3). **Always name the deactivator in parentheses.**
- `Push N feet` / `Improved Push N feet` — 9 / 7.
- `Construct Armor (Hardness N)` — 9. `Protean Anatomy N` — 6.
- `+N Status to All Saves vs. <Magic|Arcane|Divine|Occult|Primal|Mental|Vitality>` — 106 total.
- `+N to Sense Motive` — 33 (NPC Core social chassis).
- `Reactive Strike (Tail Only)` 7 / `(Jaws only)` 6 / `(Special)` 5 — parenthetical restriction is the canonical way to limit a stock reaction.

**Family chassis** (`bestiary-family-ability-glossary`, 552 entries) names abilities as `(Family) Ability Name` — e.g. `(Graveknight) Graveknight's Curse`, `(Vampire, Nosferatu) Dominate`, `(Skeleton) Rotten`, `(Mythic) Mythic Resilience`. Useful families: Vampire, Ghost, Ghoul, Skeleton, Zombie, Graveknight, Lich, Ravener, Werecreature, Golem, Clockwork Creature, Leshy, Coven, Protean, Dragon (+15 dragon sub-families), Mythic, Blight, Cryptid, Beheaded, Harrowkin.

---

## 2. ATTACK-EFFECT SLUGS (`strikes[].effects`)

260 distinct slugs, 685 references. **Only 9 resolve against Paizo's shipped glossary packs** — the other 251 are authored inline on the creature. A generator that emits an unresolvable slug will make the importer warn.

### Safe / always-resolvable (emit these freely)

| n strikes | slug | Pack | Creatures |
|---|---|---|---|
| 162 | `grab` | SRD | 156 creatures — the single most common rider |
| 52 | `improved-grab` | SRD | 51 |
| 38 | `knockdown` | SRD | 38 |
| 14 | `push` | SRD | 14 |
| 9 | `improved-push` | SRD | 9 |
| 9 | `improved-knockdown` | SRD | 9 |
| 1 | `lich-siphon-life` | family | Lich chassis |
| 2 | `vampire-nosferatu-drink-blood` | family | Nosferatu Overlord, Nosferatu Malefactor |
| 2 | `vampire-nosferatu-plague-of-ancients` | family | same |

**Rule: `grab` / `improved-grab` / `knockdown` / `improved-knockdown` / `push` / `improved-push` cover 284 of 685 effect references (41%). Prefer them.**

### Multi-creature bespoke slugs (patterns worth copying)

`detonating-rune` 12 (6 Rune Dragons) · `spirit-touch` 11 (6 psychopomps: Yamaraj, Nosoi, Vanth, Morrigna, Catrina, Esobok) · `serpentfolk-venom` 9 (5) · `clinging-remnants` 8 (2) · `sinful-bite` 7 (all 7 sinspawn) · `tongue-grab` 6 (boggards + Giant Frog + Giant Chameleon + Mobogo) · `soul-attach` 6 (Soulriders) · `web-trap` 4 · `energy-drain` 4 (Grim Reaper, Warsworn, Skulltaker) · `wretched-weeps` 4 · `darkening-poison` 3 (caligni) · `warpwave-strike` 3 (Keketar, Imentesh) · `shepherds-touch` 3 · `grabbing-trunk` 2 (Elephant, Mammoth) · `calcification` 2 (Cockatrice, Granite Glyptodont) · `girtablilu-venom` 2 · `grioth-venom` 2 · `homunculus-poison` 2 · `lethargy-poison` 2 · `wicked-bite` 2 (urdefhan) · `tearing-clutch` 2 (Terror Bird, Terror Shrike) · `drain-life` 2 · `heretics-smite` 2 · `coils-of-knowledge` 2.

### Slug-naming grammar for bespoke riders

- **`<creature-name>-venom` — 61 of 260 slugs (23%).** This is the dominant convention. Examples: `wyvern-venom`, `pit-fiend-venom`, `purple-worm-venom`, `giant-scorpion-venom`, `tor-linnorm-venom`, `yamaraj-venom`, `quetz-couatl-venom`, `raktavarna-venom`, `reefclaw-venom`, `emperor-cobra-venom`. **A new poisonous NPC should get `<slug-of-its-name>-venom`.**
- `<creature-name>-poison` — 4 only (`homunculus-poison`, `pukwudgie-poison`, `darkening-poison`, `lethargy-poison`). Venom is the strong default for injury poisons.
- Disease riders: `bogwid-fever`, `sensory-fever`, `filth-fever`, `fly-pox`, `goblin-pox`, `zombie-rot`, `slime-rot`, `putrid-plague`, `bubonic-plague`, `plague-of-ancients`, `mortasheen`, `daemonic-pestilence`.
- Curses: `tomb-curse`, `rotting-curse`, `stone-curse`, `cynics-curse`, `curse-of-wisdom`.
- Evocative two-word riders (verb+noun or adj+noun): `clawing-fear`, `unhealing-wound`, `infernal-wound`, `grievous-wound`, `choking-pain`, `exquisite-pain`, `mind-lash`, `censorious-lash`, `confounding-lash`, `draining-strike`, `weakening-strike`, `death-strike`, `predatory-grab`, `barbed-maw`, `bonecrunching-bite`, `enfeebling-bite`, `debilitating-bite`, `poison-tooth`, `entangling-slime`, `sticky-spores`, `tangle-spores`, `spore-blight`.
- Possessives are slugged without the apostrophe: `hunters-precision`, `smiths-fury`, `navigators-edge`, `gluttons-feast`, `shepherds-touch`, `fools-feast`.

---

## 3. STRIKE NAMING CONVENTIONS

2,618 strikes: **2,306 melee (88%) / 312 ranged (12%)**. 857 creatures melee-only, 303 mixed, only **3 ranged-only**.
Strikes per creature: 2 (420 creatures), 3 (326), 1 (293), 4 (110), 0 (51), 5 (13). **Median is 2; never exceed 5.**

Natural-weapon strikes 1,490 vs manufactured 1,128.

### Natural weapon names — actual distribution and canonical trait sets

| n | name | typical traits (frequency) | typical damage |
|---|---|---|---|
| 331 | **jaws** | `unarmed` 237, `magical` 163, `reach-10` 78, `reach-15` 53, `finesse` 50, `agile` 32, `unholy` 31, `reach-20` 28 | piercing |
| 329 | **fist** | `unarmed` 306, `agile` 295, `nonlethal` 238, `finesse` 147, `magical` 46, `reach-10` 29 | bludgeoning |
| 263 | **claw** | `agile` 237, `unarmed` 173, `magical` 138, `finesse` 50, `reach-10` 50, `unholy` 37 | slashing |
| 163 | **tail** | `magical` 115, `reach-15` 61, `reach-20` 42, `agile` 30, `reach-25` 22, `reach-10` 16 | bludgeoning |
| 40 | **fangs** | `finesse` 18, `agile` 6, `magical` 6, `reach-10` 5 | piercing |
| 36 | **wing** | `agile` 30, `magical` 18, `reach-10` 13, `reach-15` 9 | slashing (10) / bludgeoning (6) |
| 31 | **horn** | `magical` 25, `unarmed` 17, `reach-20` 9, `reach-10` 8 | piercing |
| 28 | **claws** (plural form; ~10% of claw usage) | `agile` 28, `magical` 23 | slashing |
| 26 | **foot** | `unarmed` 20, `agile` 7, `reach-10` 6 | bludgeoning |
| 23 | **beak** | `unarmed` 18, `finesse` 9, `deadly-d10` 3 | piercing |
| 21 | **tentacle** | `unarmed` 16, `agile` 13, `magical` 11, `reach-20`/`reach-10` 7 each | bludgeoning |
| 21 | **hoof** | `agile` 7, `magical` 5, `unholy` 4 | bludgeoning |
| 19 | **talon** | `agile` 17, `unarmed` 14, `finesse` 7 | slashing / piercing |
| 18 | **stinger** | `reach-10` 8, `agile` 7, `magical` 6, `unholy` 6, `poison` 5 | piercing |
| 16 | **mandibles** | `finesse` 5, `agile` 3, `acid` 2 | piercing |
| 12 | **pseudopod** | `unarmed` 9, `reach-10` 3 | bludgeoning (+acid) |
| 10 | **tendril** | `reach-10` 7 | bludgeoning |
| 10 | **bite** (rare — prefer `jaws`) | `finesse` 6, `agile` 4 | piercing |
| 8 | **pincer** · 8 **tongue** (`reach-10`) · 8 **vine** · 6 **branch** · 6 **leg** · 6 **sucker** · 6 **web** (ranged) · 6 **mental blast** (ranged, `mental`) · 5 **tusk** · 4 **body** · 4 **gust** · 3 **root** · 3 **trunk** · 3 **shadow hand** (`finesse, magical`, void) · 3 **ghostly hand** | | |

Names **absent or near-absent** from the Remaster corpus despite intuition: `gore` (0), `slam` (0), `spike` (0), `antler` (0), `maw` (0 as a strike name). Do not use them.

### Trait rules learned from the data

- **`unarmed` is inconsistently applied**: always on `fist` (306/329) and `jaws` (237/331); *never* on `tail` (0/163), `wing`, `hoof`, `stinger`, `mandibles`. Follow: fist/jaws/claw/foot/beak/horn/talon/tentacle/pseudopod/tusk get `unarmed`; tail/wing/hoof/stinger/mandibles/tendril generally don't.
- **`agile`** on the small fast limb (claw, fist, wing, talon), **never** on jaws-as-primary.
- **`finesse`** appears on 546 strikes — pair with high-Dex chassis.
- **reach by size** (`reach-N` is the absolute reach, not a bonus):
  - tiny → `reach-0` (23) or default 5 ft
  - sm / med → default (1,457); `reach-10` only 60
  - lg → default 247, `reach-10` 205, `reach-15` 62
  - huge → `reach-15` 101, `reach-10` 66, default 55, `reach-20` 46
  - grg → `reach-20` 71, `reach-15` 51, `reach-25` 25, `reach-30` 15
- **`versatile-X` / `deadly-dN` / `fatal-dN` / `two-hand-dN` / `thrown-N` / `volley-N` / `reload-N` belong to manufactured weapons** (versatile-s 198 weapon vs 2 natural; thrown-10 103 weapon vs 0 natural). Exceptions are deliberate monster flourishes: `deadly-d10` on beak (3), `deadly-d12`/`deadly-2d10`/`deadly-3d12` on huge natural attacks (6/4/4), `versatile-p` on vine/horn (8).
- `magical` (925 strikes) is the standard "counts as magical" tag for level 5+ monsters; `holy`/`unholy` (82/160) replace the old alignment damage.

### Manufactured weapon names (NPC Core chassis)

dagger 135 (`agile, versatile-s, finesse, thrown-10`) · shortsword 34 (`agile, versatile-s, finesse`) · staff 31 (`two-hand-d8`) · crossbow 30 (ranged, `reload-1`) · rock 25 (19 ranged, `brutal`/`thrown-10`) · spear 24 (`thrown-20`) · club 23 (`thrown-10`) · trident 22 (`thrown-20`) · hand crossbow 20 (`reload-1`) · sling 18 (`propulsive, reload-1`) · shortbow 17 (`deadly-d10, reload-0`) · javelin 17 (`thrown-30`) · light hammer 17 (`agile, thrown-20`) · rapier 17 (`deadly-d8, disarm, finesse`) · composite longbow 16 (`deadly-d10, volley-30, propulsive, reload-0`) · composite shortbow 16 · hatchet 15 (`agile, sweep, thrown-10`) · scimitar 14 (`forceful, sweep`) · greataxe 14 (`sweep`) · longsword 14 (`versatile-p`) · longspear 13 (`reach-10`) · sickle 11 (`agile, trip, finesse`) · warhammer 10 (`shove`) · dart 10 (`agile, thrown-20`) · whip 9 (`disarm, nonlethal, trip, reach`) · starknife 8 (`agile, deadly-d6, versatile-s`) · bastard sword 7 (`two-hand-d12`) · greatclub 7 (`backswing, shove`) · kukri 7 (`agile, trip`) · pick 6 (`fatal-d10`) · gauntlet 6 (`agile, free-hand`) · sap 6 (`agile, nonlethal`) · dueling pistol 5 (`concealable, concussive, fatal-d10, reload-1`) · arbalest 5 (`backstabber, reload-1`) · alchemical grenade 5 (`splash`).

Matching `inventoryTypes` (carried gear) top entries: Dagger 81, Leather Armor 72, Shortsword 34, Crossbow 30, Staff 28, Studded Leather Armor 24, Breastplate 21, Hand Crossbow 21, Hide Armor 20, Sling 19, Composite Longbow 18, Rapier 18, Writing Set 18, Thieves' Toolkit 11, Healer's Toolkit 10, Spellbook 9. **An armed NPC should list its weapon and armor in inventory, matching the Strike.**

### Attack bonus by level (min / median / max across all strikes)

−1: 3/6/9 · 0: 3/6/8 · 1: 3/7/9 · 2: 6/10/12 · 3: 6/11/13 · 4: 9/13/15 · 5: 8/14/16 · 6: 12/16/18 · 7: 12/17/20 · 8: 13/19/21 · 9: 17/20/22 · 10: 18/22/24 · 11: 19/24/28 · 12: 23/25/28 · 13: 23/26/28 · 14: 24/28/30 · 15: 24/30/32 · 16: 27/32/34 · 17: 30/33/35 · 18: 24/34/37 · 19: 26/34/38 · 20: 35/38/40 · 21: 35/39/41 · 22: 39/41/42 · 24: 43/44/46 · 25: 45/47/47.

---

## 4. TRAIT VOCABULARY

### 4a. Creature traits — 156 distinct

**Creature type (pick exactly one, occasionally two):**
`humanoid` 433 · `animal` 143 · `dragon` 113 · `fiend` 73 · `undead` 70 · `beast` 66 · `aberration` 63 · `elemental` 53 · `construct` 48 · `fey` 47 · `celestial` 37 · `monitor` 30 · `plant` 30 · `giant` 30 · `spirit` 21 · `ooze` 13 · `shadow` 13 · `fungus` 6 · `dream` 4 · `ethereal` 4 · `astral` 2 · `time` 1.

**Sanctification / essence (Remaster alignment replacement):** `unholy` 165 · `holy` 54 · `spirit` 21 · `void` 2 · `vitality` 2.

**Elemental / energy:** `fire` 36 · `water` 26 · `earth` 26 · `air` 19 · `wood` 21 · `metal` 4 · `cold` 11 · `electricity` 2 · `acid` 1 · `light` 3.

**Tradition tags on creatures:** `primal` 26 · `divine` 25 · `occult` 24 · `arcane` 24.

**Structural / behavioural:** `mindless` 59 · `amphibious` 58 · `aquatic` 34 · `swarm` 25 · `troop` 23 · `incorporeal` 18 · `soulbound` 12 · `shade` 22 · `mutant` 5 · `summoned` 1 · `eidolon` 1.

**Ancestry / lineage (humanoid subtypes):** `human` 242 · `goblin` 10 · `gnome` 9 · `dwarf` 9 · `orc` 9 · `elf` 7 · `halfling` 6 · `hobgoblin` 6 · `kholo` 6 · `kobold` 6 · `lizardfolk` 5 · `tripkee` 5 · `catfolk` 4 · `ratfolk` 4 · `tengu` 4 · `nephilim` 4 · `aiuvarin` 2 · `dromaar` 2 · `dhampir` 2 · `duskwalker` 1 · `changeling` 1 · plus 20+ singletons (`kitsune`, `nagaji`, `samsaran`, `sylph`, `undine`, `oread`, `suli`, `vanara`, `wayang`, `fetchling`, `strix`, `azarketi`, `merfolk`, `vishkanya`, `dragonblood`, `munavri`, `locathah`).

**Family/lineage (monster subtypes):** `dinosaur` 15 · `demon` 14 · `devil` 13 · `skeleton` 10 · `daemon` 10 · `archon` 9 · `psychopomp` 8 · `aeon` 8 · `nymph` 8 · `azata` 8 · `angel` 8 · `leshy` 8 · `hag` 8 · `zombie` 7 · `protean` 7 · `troll` 7 · `velstrac` 6 · `sahkil` 6 · `gremlin` 6 · `serpentfolk` 5 · `caligni` 5 · `genie` 5 · `vampire` 5 · `werecreature` 4 · `oni` 4 · `ghost` 4 · `qlippoth` 4 · `asura` 4 · `div` 4 · `clockwork` 4 · `agathion` 4 · `darvakka` 4 · `kami` 4 · `titan` 4 · `couatl` 3 · `sprite` 3 · `ghoul` 2 · `wraith` 2 · `rakshasa` 2 · `mummy` 2 · `automaton` 2 · `girtablilu` 2 · `urdefhan` 2 · `aesir` 2 · `phantom` 2 · `tane` 1 · `graveknight` 1 · `wight` 1 · `wyrwood` 1 · `naari` 1 · `jotunborn` 1 · `maftet` 1 · `tanuki` 1.

**Rarity:** common 988 (81%) · uncommon 160 (13%) · rare 61 (5%) · unique 5. **A generated NPC should default to `common` unless the concept is genuinely exotic.**
**Size:** med 572 · lg 256 · sm 117 · huge 111 · grg 93 · tiny 65.

### 4b. Ability (action) traits — 72 distinct, ranked by action instances (distinct creatures in parens)

`mental` 589(394) · `divine` 473(204) · `aura` 367(310) · `concentrate` 314(257) · `occult` 279(119) · `emotion` 257(216) · `primal` 254(152) · `arcane` 155(79) · `magical` 136(136) · `fear` 135(122) · `manipulate` 126(111) · `poison` 125(118) · `auditory` 124(111) · `polymorph` 110(90) · `visual` 106(80) · `fire` 93(54) · `incapacitation` 85(79) · `attack` 68(62) · `curse` 59(54) · `teleportation` 58(39) · `linguistic` 54(45) · `void` 52(43) · `water` 40(27) · `disease` 40(36) · `spirit` 39(36) · `healing` 39(33) · `unholy` 34(28) · `vitality` 32(26) · `move` 29(29) · `holy` 27(23) · `air` 26(19) · `earth` 24(17) · `light` 22(19) · `illusion` 22(20) · `sonic` 21(18) · `fortune` 19(18) · `exploration` 19(19) · `olfactory` 17(17) · `cold` 17(12) · `death` 14(14) · `force` 14(13) · `misfortune` 13(13) · `electricity` 12(10) · `prediction` 10(10) · `acid` 9(8) · `shadow` 9(7) · `plant` 8(7) · `nonlethal` 8(7) · `extradimensional` 7(7) · `injury` 6(6) · `darkness` 6(6) · `virulent` 6(6) · `downtime` 5(5) · `wood` 4 · `sanctified` 4 · `metal` 4 · `spellshape` 4 · `summon` 3 · `stance` 3 · `alchemical` 3 · `incorporeal` 2 · `possession` 2 · `scrying` 2 · `morph` 2 · `detection` 2 · `impulse` 2 · `overflow` 2 · `summoned` 1 · `sleep` 1 · `inhaled` 1 · `trap` 1 · `fighter` 1.

### 4c. Rules-weight of the load-bearing traits

- **`incapacitation` — 85 instances / 79 creatures.** Any effect that can take a creature out of the fight for ≥1 round *must* carry it. Halves effectiveness against targets of higher level than the effect's level. Seen on: `Diplomatic Solution` (6), `Dominate` (4), `Mirage Spores`, `Calcification`, `Focus Beauty`, `Nymph's Beauty`, `Petrifying Gaze`, `Warbling Song`, `Haunting Melody`, `Devour Soul`, `Stunning Shock`, `Giant Wasp Venom`. **Do not put it on damage-plus-frightened effects** — that is why Frightful Presence lacks it.
- **`death` — only 14 instances / 14 creatures**, all level 9+ except one. Triggers death-effect immunities (119 creatures are immune to `death-effects`). Names: `Void's Embrace`, `Soul Lock`, `Snip Thread`, `Curse of Death`, `Kiss of Death`, `Death Strike`, `Wail`, `Consume Soul`, `Whip Drain`, `Redirect River`, `Absorb`. **Use sparingly and only at high level.**
- **fear/emotion/mental as a package.** 135 fear instances; the dominant complete trait sets are `aura+emotion+fear+mental` (46), `auditory+emotion+fear+mental` (16), `emotion+fear+mental` (11), `emotion+fear+mental+occult` (6). **`fear` never appears without `mental`; `emotion` never without `mental`.** 45 creatures are immune to `fear-effects`, 14 to `mental`, 9 to `emotion` — mindless (59) and construct (48) chassis should be immune.
- **`aura` — 367 instances / 310 creatures.** Dominant sets: `aura+magical+mental` 132 (all Telepathy), `aura+emotion+fear+mental` 46 (Frightful Presence), `aura+divine` 16, `aura+emotion+mental` 14, `aura+olfactory` 12 (Stench). Auras are always `passive` + `defensive` or `interaction`; the range goes in the *text* ("60 feet.") and in a `rules[]` Aura element.
- **`visual` (106) / `auditory` (124).** Gaze and shriek effects must carry them so blinded/deafened counters work. 18 creatures are immune to `visual`. `visual` almost always co-occurs with `concentrate` on active gazes and with `aura` on passive ones.
- **`concentrate` (314) + `manipulate` (126)** are the Reactive-Strike triggers. Any 1–2 action spell-like or fiddly ability should carry one.
- **Tradition trait is mandatory on magical abilities**: `divine` 473 / `occult` 279 / `primal` 254 / `arcane` 155. A supernatural ability with no tradition trait reads as extraordinary. `magical` (136) is the fallback when the tradition is deliberately unspecified.

### 4d. Immunity / resistance / weakness vocabulary

**Immunities** (creature counts): `paralyzed` 238 · `sleep` 167 · `poison` 145 · `bleed` 129 · `death-effects` 119 · `disease` 117 · `unconscious` 78 · `precision` 62 · `fire` 58 · `fear-effects` 45 · `cold` 29 · `controlled` 25 · `swarm-mind` 22 · `confused` 20 · `critical-hits` 19 · `visual` 18 · `acid` 17 · `petrified` 15 · `mental` 14 · `drained` 11 · `electricity` 10 · `curse` 10 · `emotion` 9 · `dazzled` 9 · `doomed` 7 · `fascinated` 6 · `polymorph` 6 · `immobilized` 6 · `void` 5 · `blinded` 5 · `off-guard` 1.
The undead package is `death-effects, disease, paralyzed, poison, sleep, unconscious`; the mindless package adds `emotion, fear-effects, mental`; swarms add `precision, critical-hits, swarm-mind, grabbed, prone, restrained`.

**Resistance types**: `piercing` 57 · `physical` 53 · `fire` 51 · `slashing` 47 · `poison` 44 · `bludgeoning` 42 · `cold` 39 · `mental` 29 · `electricity` 22 · `all-damage` 19 · `void` 15 · `acid` 15 · `precision` 8 · `spells` 7 · `spirit` 7 · `sonic` 4.

**Weakness types**: `cold-iron` 83 · `holy` 78 · `area-damage` 48 · `splash-damage` 48 · `fire` 47 · `unholy` 36 · `cold` 30 · `slashing` 16 · `spirit` 15 · `silver` 14 · `vitality` 12 · `electricity` 11 · `axe-vulnerability` 10 · `water` 8 · `sonic` 6 · `orichalcum` 4 · `mental` 4 · `salt` 2 · `peachwood` 1.
`area-damage` and `splash-damage` are always paired (48/48) — that is the **swarm** package.

**Damage types in strikes**: piercing 1039 · bludgeoning 923 · slashing 516 · fire 123 · **spirit 121** · mental 55 · **void 51** · acid 48 · cold 43 · bleed 40 · force 28 · poison 23 · electricity 21 · sonic 11 · **vitality 11** · untyped 10. (No `negative`/`positive`.)

---

## 5. SENSE VOCABULARY

15 exact sense strings. Ranges live in `perception.senses[].range`; darkvision-family and see-invisibility carry **no range**.

| sense | creatures | acuity | typical ranges |
|---|---|---|---|
| `darkvision` | 675 | (n/a) | no range |
| `scent` | 250 | imprecise (249), precise (1) | **30 ft** (123) or **60 ft** (118); 120/100/80/40 rare |
| `low-light-vision` | 202 | (n/a) | no range |
| `tremorsense` | 63 | imprecise (59), precise (4) | **60** (24), **30** (20), 90 (5), 120 (4), 100 (4), 10 (4) |
| `greater-darkvision` | 54 | (n/a) | no range |
| `lifesense` | 45 | precise (26), imprecise (19) | **60** (19), **30** (13), 120 (10), 240 (1, Yamaraj) |
| `truesight` | 40 | precise | **60** (38) |
| `wavesense` | 20 | imprecise (18) | 60 (9), 30 (7), 120 (3) |
| `echolocation` | 10 | precise | 20 (5), 120 (2), 40 (2), 60 (1) |
| `motion-sense` | 10 | precise | 60 (8) |
| `thoughtsense` | 6 | precise (4) / imprecise (2) | 60 |
| `magicsense` | 6 | imprecise | 60 |
| `see-invisibility` | 5 | (n/a) | no range |
| `bloodsense` | 3 | imprecise | 60–120 |
| `spiritsense` | 2 | imprecise | 30–60 |

**By creature type** (dominant sense package):
- animal → `low-light-vision` (92) + `scent 30 ft` (68); darkvision only 40
- beast → `darkvision` (55) + `scent 30 ft` (19)
- dragon → `darkvision` (107) + `scent 60 ft` (93); plus one exotic sense per dragon family (`magicsense 60`, `wavesense 60`, `lifesense 30–120`, `tremorsense 60–120`)
- fiend → `darkvision` (50) or `greater-darkvision` (23) + `truesight 60` (17)
- celestial → `darkvision` (37) + occasional `truesight 60`
- monitor → `darkvision` (30) + `lifesense 60–240` (10)
- undead → `darkvision` (63) + `lifesense 30–60` (11)
- aberration → `darkvision` (57), `tremorsense 30–60` (9), `thoughtsense 60` (4)
- construct → `darkvision` (43) only
- ooze → `motion-sense 60` (10) — no vision at all
- elemental → `darkvision` (50) + `tremorsense 30–90` (12)
- fey / plant → `low-light-vision` (26 / 20)
- humanoid → `darkvision` (123) or `low-light-vision` (56); `greater-darkvision` (13) for subterranean

**Most common full sense sets**: `darkvision` alone 418 · **none 240** · `darkvision+scent` 119 · `low-light-vision` 107 · `low-light-vision+scent` 81 · `darkvision+tremorsense` 36 · `greater-darkvision` 33 · `darkvision+truesight` 24.
**20% of official NPCs have no special senses at all** — a plain human NPC should have none.

Senses are *also* restated as a passive interaction action when they need a range in the statblock body: `Telepathy 100 feet`, `Lifesense 60 feet`, `Tremorsense (Imprecise) 60 feet`, `Greater Darkvision`, `Motion Sense`, `Echolocation (Precise) 20 feet`, `Wavesense (Imprecise) 30 feet`, `Entropy Sense (Imprecise) 30 feet`, `Thoughtsense 60 feet`. Format: `<Sense> (<Precise|Imprecise>) <N> feet` — precise/imprecise is only shown when the sense's default acuity is being overridden or is non-obvious.

---

## 6. LANGUAGE CONVENTIONS

262 creatures (22%) have zero language slugs; 238 (20%) have neither slugs nor a details line.
Language count per creature: 0 → 262 · **1 → 359** · **2 → 290** · 3 → 146 · 4 → 92 · 5 → 36 · 6 → 17 · 7 → 7 · 8 → 5. **Median is 1–2.**

### Language slugs actually in use

`common` 716 · `draconic` 185 · `empyrean` 131 · `fey` 118 · `aklo` 114 · `diabolic` 104 · `chthonian` 101 · `sakvroth` 68 · `necril` 61 · `thalassic` 52 · `jotun` 49 · `petran` 39 · `pyric` 36 · `elven` 31 · `daemonic` 30 · `sussuran` 28 · `requian` 26 · `shadowtongue` 24 · `goblin` 20 · `utopian` 19 · `dwarven` 15 · `gnomish` 13 · `orcish` 10 · `protean` 10 · `muan` 9 · `wildsong` 9 · `halfling` 8 · `caligni` 7 · `kholo` 7 · `arboreal` 6 · `alghollthu` 6 · `talican` 5 · `iruxi` 5 · `tripkee` 5 · `cyclops` 4 · `ysoki` 4 · `tengu` 4 · `boggard` 4 · `amurrun` 4 · then singletons.

**Remaster renames to enforce** (the corpus is 100% consistent): Celestial→`empyrean`, Infernal→`diabolic`, Abyssal→`chthonian`, Undercommon→`sakvroth`, Aquan→`thalassic`, Terran→`petran`, Ignan→`pyric`, Auran→`sussuran`, Giant→`jotun`, Sylvan→`fey`, Druidic→`wildsong`, Gnoll→`kholo`, Elvish→`elven`, Dwarvish→`dwarven`, Gnome→`gnomish`, Orc→`orcish`, Goblin→`goblin`, Halfling→`halfling`, Catfolk→`amurrun`, Lizardfolk→`iruxi`, Ratfolk→`ysoki`, Grippli→`tripkee`.

### By creature type (% with any languages)

humanoid 100% (common 397) · giant 100% (`jotun` 25 + `common` 22) · spirit 100% · shadow 100% (`common`+`shadowtongue`) · fey 98% (`fey` 39 + `common` 36) · dragon 98% (`draconic` 111 + `common` 100 + a thematic third) · fiend 96% (`chthonian`/`diabolic`/`daemonic` + `common` + `empyrean`) · celestial 95% (`empyrean` 35 + `draconic` 28 + `diabolic` 27) · monitor 93% (`empyrean`+`chthonian`+`diabolic`+`requian`) · beast 85% · aberration 84% (`aklo` 38 — the aberration marker) · elemental 83% (`pyric`/`sussuran`/`thalassic`/`petran` by element) · plant 80% (`fey` 19) · undead 74% (`necril` 36 + `common` 44) · construct 44% (`common` 8) · **ooze 8%** · **animal 1%**.

Note the celestial/fiend/monitor pattern: they know **their own planar tongue plus their opposites'** (`empyrean` + `diabolic` + `chthonian` together), not Common.

### By level band — top language

−1..0: `common` 51 (almost nothing else) · 1..3: `common` 188 · 4..7: `common` 189 · 8..11: `common` 127, `draconic` 50 · 12..15: `common` 95, `draconic` 44, `empyrean` 28 · 16..20: `common` 59, `draconic` 45, `empyrean` 27 · 21+: `common` 7, `chthonian` 5.
Language breadth grows with level: mean count rises from ~1 at level ≤3 to ~3 at level 16+.

### The `languages.details` free-text channel

Everything not a slug goes here, comma-separated, appended after the slug list:
- **Telepathy** — 68× `Telepathy 100 feet` (+29 lowercase), `Telepathy 60 feet` 10, `Telepathy 90 feet` 4, `Telepathy 120 feet` 3, `Telepathy 30 feet` 2, `Telepathy (Touch)` 3, `Telepathy 300 feet` 1. **Canonical form: `Telepathy 100 feet`.** Always mirrored by a passive interaction action of the same name with traits `aura, magical, mental`.
- **`Truespeech`** 66 — the celestial/fiend/monitor universal-comprehension marker.
- **"can't speak" family** — `Can't speak any language` 17, `(Can't Speak Any Language)` 10, plus lowercase/parenthesised variants (~35 total). Used for animals/constructs that *understand* but can't reply. **Canonical: `Can't speak any language`.**
- **"any N other" family** — `up to 4 additional languages` 4, `up to 3 additional languages` 3, `5 additional languages` 2, `Five additional common languages` 2, `Seven additional common languages` 2, `three additional mortal languages` 1, `plus two others` 3, `plus one regional language` 4, `plus two additional languages` 2. **Canonical for a generated NPC: `plus any N other languages` — the corpus's own phrasing varies but "up to N additional languages" is the most common exact form.**
- **Constructs/undead**: `One Spoken by its Creator (typically Common)` 11, `one language their creator speaks` 1, `any one spoken in life (such as common)` 3, `plus any two languages they knew while alive` 1.
- **Empathy/speech abilities** slot here too: `speak with animals` 6, `Speak with Plants` (+ parenthesised restrictions like `(Fungi Only)`, `(Gourds Only)`, `(Trees Only)`), `Speak with Stones`, `Sea Speech` 3, `Rat Empathy`, `Wolf Empathy`, `Bear Empathy`, `Tiger Empathy`, `snake empathy`, `Envisioning` 2, `tongues` 2.

---

## 7. SKILL-SET PATTERNS

Skills per creature: 0 → 2 · 1 → 94 · 2 → 190 · **3 → 219** · **4 → 211** · **5 → 214** · 6 → 116 · 7 → 74 · 8 → 59 · 9 → 21 · 10 → 14.
Average by level band: −1..0 → **3.0** · 1..3 → **3.6** · 4..7 → **3.9** · 8..11 → **4.7** · 12..15 → **5.2** · 16..20 → **5.9** · 21+ → **5.9**. **Never exceed 8.**

### Overall skill frequency (of 1,214)

`athletics` 885 (73%) · `stealth` 670 · `acrobatics` 662 · `intimidation` 437 · `diplomacy` 341 · `deception` 333 · `survival` 294 · `society` 249 · `religion` 217 · `nature` 210 · `occultism` 178 · `arcana` 145 · `crafting` 127 · `thievery` 112 · `performance` 110 · `medicine` 90.

**Athletics + Acrobatics is the near-universal spine** (an NPC almost always has at least one; dragons have both at 98/99%).

### By creature type (share of that type, avg skill count)

| type | n | avg | signature set |
|---|---|---|---|
| humanoid | 433 | 4.4 | athletics 65% · intimidation 47% · stealth 43% · acrobatics 39% · diplomacy 34% · deception 33% · society 32% · survival 31% |
| animal | 143 | **2.5** | athletics 91% · acrobatics 66% · stealth 61% · survival 25% — *and essentially nothing else* |
| dragon | 113 | **6.7** | acrobatics 99% · athletics 98% · diplomacy 82% · stealth 54% · intimidation 53% · society 49% · deception 34% · occultism/arcana 32% |
| undead | 70 | 3.2 | athletics 73% · stealth 60% · acrobatics 50% · intimidation 40% · religion 23% |
| fiend | 73 | 4.7 | acrobatics 68% · stealth 67% · athletics 64% · intimidation 58% · **religion 56%** · deception 53% · arcana 26% |
| beast | 66 | 4.1 | athletics 88% · stealth 64% · acrobatics 59% · survival 58% · intimidation 38% |
| aberration | 63 | 4.2 | athletics 81% · stealth 81% · acrobatics 63% · survival 35% · occultism 29% |
| elemental | 53 | 2.8 | athletics 72% · stealth 62% · acrobatics 45% |
| construct | 48 | **2.1** | athletics 60% · acrobatics 50% · stealth 35% · occultism 27% |
| fey | 47 | 5.3 | **stealth 87% · nature 74%** · acrobatics 68% · deception 60% · thievery 28% · performance 23% |
| celestial | 37 | 4.9 | **religion 78%** · acrobatics 65% · diplomacy 57% · athletics 49% |
| monitor | 30 | 4.9 | acrobatics 70% · stealth 67% · athletics 63% · religion 53% · occultism 33% |
| plant | 30 | 3.7 | **stealth 93%** · athletics 83% · nature 60% |
| giant | 30 | 3.7 | **athletics 97% · intimidation 83%** · survival 33% |
| spirit | 21 | 4.2 | stealth 76% · intimidation 62% · acrobatics 52% |
| swarm | 25 | 2.5 | acrobatics 80% · stealth 76% · athletics 48% |
| troop | 23 | 3.0 | athletics 91% · intimidation 65% |
| ooze | 13 | **1.6** | athletics 85% · stealth 62% — nothing else |

### Lore convention

383 of 1,214 creatures (32%) carry ≥1 Lore; **162 distinct Lore names**. Lore is a separate item, not one of the 16 core skills.

- Format is **`<Topic> Lore`** — capitalised topic, the word "Lore" second. 152 of the 162 follow it.
- Most common: `Legal Lore` 32 · `Warfare Lore` 25 · `Underworld Lore` 22 · `Engineering Lore` 13 · `Sailing Lore` 11 · `Heaven Lore` 10 · `Forest Lore` 10 · `Boneyard Lore` 9 · `Fortune-Telling Lore` 9 · `Mercantile Lore` 9 · `Accounting Lore` 9 · `Hell Lore` 8 · `Mining Lore` 8 · `Academia Lore` 8 · `Library Lore` 6 · `Illusion Lore` 6 · `Torture Lore` 6 · `Rune Lore` 6 · `Linguistics Lore` 6 · `Necromancy Lore` 6 · `Netherworld Lore` 6 · `River of Souls Lore` 6 · `Nirvana Lore` 5 · `Axis Lore` 4 · `Scribing Lore` 4 · `Bardic Lore` 4 · `Settlement Lore` 4 · `Architecture Lore` 4.
- **Placeholder form for a generic chassis**: `Lore (any one subcategory)` 8 · `Lore (any one region or settlement)` 6 · `One Additional Lore` 4 · `Lore (any two specific locations)` 2 · `Lore (any three specific locations)` 2 · `Lore (any four specific locations)` 2 · `Lore (all subcategories)` 1 · `<Deity> Lore` 1. Use these when the NPC is a template, not a specific individual.
- **Scoped form**: `Dwelling Lore (applies to the place the ghost is bound to)`, `Cult Lore (for the cultist's own cult)`, `Ruins Lore (Applies Only to Their Home Ruins)`, `Forest Lore (applies to the arboreal archive's territory)`, `Art Lore (+13 for visual arts)`.
- **Bias**: NPC Core social/professional statblocks (Legal, Accounting, Mercantile, Warfare, Underworld, Engineering) drive most Lore usage. Monsters mostly have planar Lores tied to their home plane.

---

## 8. ACTION-ECONOMY SHAPES

5,809 actions across 1,214 creatures.

### Cost distribution

| bucket | n | share |
|---|---|---|
| passive | 3,036 | **52%** |
| 1 action | 1,127 | 19% |
| 2 actions | 775 | 13% |
| reaction | 603 | 10% |
| 3 actions | 140 | 2.4% |
| free action | 128 | 2.2% |

**Half of everything on a statblock is passive.** 3-action abilities are rare (2.4%) and are almost always `Trample` or a big movement-plus-attack combo.

### Category distribution

offensive 3,058 (53%) · defensive 1,693 (29%) · interaction 1,058 (18%).

### Category × cost — what actually goes in each

| bucket | n | representative contents |
|---|---|---|
| **offensive / 1-action** | 1,117 | `Grab` 153, `Change Shape` 69, `Constrict` 45, `Swallow Whole` 38, `Knockdown` 34, `Pounce` 15, `Rend` 14, `Focus Gaze` 11, `Throw Rock` 10, `Push 10 feet` 7 — *grapple/trip/positional riders and single-target gazes* |
| **defensive / passive** | 1,100 | `+1 Status to All Saves vs. Magic` 99, `Void Healing` 70, `Frightful Presence` 43, `All-Around Vision` 32, `Troop Defenses` 23, `Swarm Mind` 20, `Stench`, `Light Blindness`, `Rejuvenation`, `Fast Healing N`, `No Breath` — *save riders, auras, damage-avoidance* |
| **interaction / passive** | 1,037 | `Constant Spells` 112, `Telepathy 100 feet` 96, `Greater Darkvision` 37, `Smoke Vision` 25, `At-Will Spells` 19, sense lines, `Camouflage`, `Coven`, `Deep Breath`, `<X> Empathy` — *senses, communication, social/exploration* |
| **offensive / passive** | 899 | `Sneak Attack` 79, `Draconic Momentum` 48, `Pack Attack` 22, `Earth Glide` 12, `Rock Tunneler` 9, venom/poison riders, `Steady Spellcasting` — *damage riders and movement-through-terrain* |
| **offensive / 2-action** | 761 | `Draconic Frenzy` 52 and **every breath weapon** (`Poison Breath`, `Hellfire Breath`, `Spirit Breath`, `Avalanche Breath`, `Cogitation Breath`, `Hydraulic Breath`, `Shrieking Breath`, `Dislocating Breath`, `Disruptive Breath`, `Destiny Breath`, `Smoke Breath`, `Hallucinatory Breath`, `Runic Breath`, `Pyre Breath`, `Dooming Breath`, `Soul Siphoning Breath`), plus `Sudden Charge`, `Impaling Charge`, `Halo Pulse`, `Gallop` — **breath weapons are 2 actions, near-universally** |
| **defensive / reaction** | 564 | `Reactive Strike` 114, `Shield Block` 22, `Ferocity` 15, `Buck` 13, `Archon's Protection` 9, `Nimble Dodge` 8, `Twisting Tail` 7, `Boiling Blood` 7, `Siphon Life` 7, `Consume Fear` 7, `Divine Deflection`, `Retract Body`, `Capture Spell` |
| **offensive / 3-action** | 137 | `Trample` 34, `Rushed Transformation`, `Burrowing Pounce`, `Reef Meld`, `Scimitar Storm`, `Blinking Barrage` |
| **offensive / free** | 107 | `Improved Grab` 48, `Improved Knockdown` 7, `Improved Push N feet`, `Drain Bonded Item`, `Command Thrall` — **free actions are almost exclusively "improved" versions of a 1-action rider** |
| **offensive / reaction** | 37 | `Fast Swallow` 6, `Vicious Rend`, `Deadly Cleave`, `Pin Prey`, `Sudden Shove` |
| **defensive / free** | 18 | `Diplomatic Solution` 6, `Mist Escape`, `Flash of Brutality`, `Flash of Insight` |
| interaction / non-passive | 21 | vanishingly rare — `Walk the Ethereal Line`, `Bond with Mortal`, `Form Up` |

**Anti-pattern to avoid**: interaction abilities that cost actions (21 of 1,058) and defensive abilities that cost 1–3 actions (11 of 1,693). If it costs actions it is almost certainly `offensive`.

### Ability count by level

| band | n creatures | avg actions | offensive | defensive | interaction | reactions |
|---|---|---|---|---|---|---|
| −1..0 | 89 | 2.5 | 1.1 | 0.6 | 0.8 | 0.3 |
| 1..3 | 360 | 3.1 | 1.7 | 0.8 | 0.6 | 0.3 |
| 4..7 | 329 | 4.4 | 2.4 | 1.3 | 0.8 | 0.4 |
| 8..11 | 203 | 5.8 | 3.2 | 1.7 | 0.9 | 0.6 |
| 12..15 | 133 | 7.0 | 3.5 | 2.3 | 1.3 | 0.9 |
| 16..20 | 89 | 8.9 | 4.5 | 2.9 | 1.5 | 0.9 |
| 21..25 | 11 | 10.1 | 4.5 | 4.3 | 1.4 | 1.0 |

Actions per creature ranges 0–16; the mode is 3–5.
**Reactions: ~0.3 at low level rising to ~1.0 at level 16+. One reaction is the ceiling for most NPCs.**

### Frequency limiters (258 actions carry one)

`{max:1, per:"round"}` 98 · `{max:1, per:"day"}` 93 · `{max:1, per:"PT1H"}` (once per hour) 25 · `{max:1, per:"PT1M"}` (once per minute) 10 · `{max:1, per:"PT10M"}` (once per 10 minutes) 13 · `{max:3, per:"day"}` 10 · `{max:1, per:"turn"}` 5 · `{max:5, per:"day"}` 1 · yearly/monthly 3.
Rendered in text as `Frequency once per round` / `Frequency once per day` / `Frequency three times per day`. **Breath weapons conventionally carry a recharge in text ("can't use again for 1d4 rounds") rather than a `frequency` object.**

### Movement

Land Speed values: **25 ft (521 creatures)**, 30 (174), 20 (142), 40 (110), 35 (57), 0 (40), 50 (39), 15 (32), 60 (31), 10 (26), 5 (19).
Other speeds: `fly N` 324 · `swim N` 177 · `climb N` 135 · `burrow N` 54.

---

## 9. ABILITY-NAME GRAMMAR (bespoke identity abilities)

Corpus: 2,536 bespoke names (used by ≤2 creatures, not SRD glossary).

### Length

| words | count | share |
|---|---|---|
| 1 | 228 | 9% |
| **2** | **1,839** | **73%** |
| 3 | 316 | 12% |
| 4 | 92 | 4% |
| 5+ | 61 | 2% |

**Two words is the overwhelming default.** Longer than 4 words is essentially never correct (61 of 2,536).

### Structure

- **Noun-phrase, not imperative.** Only **7%** (186/2,536) start with a verb. The dominant shape is **`<Adjective|Noun-modifier> <Noun>`**: `Bonecrunching Bite`, `Haunting Melody`, `Freezing Mist Breath`, `Reflective Scales`, `Lightning Drinker`, `Icy Deflection`, `Defensive Quills`, `Warbling Song`.
- **Title Case on every significant word — 2,478/2,536 (98%) conform.** Lowercase is reserved for connectives (`of`, `the`, `to`, `in`, `and`, `from`, `for`): `Curse of the Wererat`, `Walk the Ethereal Line`, `Liberate the Earth`, `Share the Wealth`, `Feed on Emotion`, `Aura of Corruption`, `Death's Grace`.
- **`X of Y` construction: 145 names** (6%) — `Aura of Misfortune`, `Curse of Boiling Blood`, `Flash of Brutality`, `Kiss of Death`, `Spiral of Despair`.
- **Possessive `'s`: 87 names** (3.4%) — `Scarecrow's Leer`, `Matriarch's Caress`, `Hell's Sting`, `Archon's Protection`, `Graveknight's Curse`, `Death's Grace`, `Nymph's Beauty`, `Shepherd's Touch`, `Champion's Aura`. **Used when the ability is signature to a named family.**
- **Exclamation-terminal names: 44** — `Shoo!`, `Reawaken!`, `Arise!`, `Do a Jig!`, `Behold!`, `Look Behind You!`. Reserved for verbal/commanding abilities.
- **Parenthetical qualifier: 50** — `Reactive Strike (Tail Only)`, `Skymetal Metamorphosis (Orichalcum)`, `Echolocation (Precise) 20 feet`.
- **Creature's own name embedded: 305 names (12%).** Two flavours: (a) the venom/toxin line — `Yamaraj Venom`, `Giant Wasp Venom`, `Tor Linnorm Venom`, `Pukwudgie Poison`, `Serpentfolk Venom`; (b) the signature flourish — `Nymph's Beauty`, `Draconic Frenzy`, `Protean Anatomy 6`, `Vampire Vulnerabilities`, `Troop Defenses`. **Rule: embed the creature name for its poison/disease line and for family-defining traits, otherwise don't.**
- Most common first words across bespoke names: `Planar` 29 · `Curse` 11 · `Blood` 11 · `Death` 11 · `Shadow` 11 · `Quick` 10 · `Double` 9 · `Construct` 9 · `Final` 8 · `Giant` 8 · `Soul` 8 · `Master` 8 · `Reactive` 8 · `Aura` 8 · `Distracting` 8 · `Ravenous` 8 · `Absorb` 8.
- **Naming a breath weapon**: `<Theme> Breath` — `Poison Breath`, `Hellfire Breath`, `Chill Breath`, `Mist Breath`, `Void Breath`, `Pyroclastic Breath`, `Spirit Breath`, `Cogitation Breath`, `Shrieking Breath`, `Avalanche Breath`, `Hydraulic Breath`, `Dislocating Breath`, `Beetle Breath`, `Scree Breath`, `Freezing Mist Breath`, `Soul Siphoning Breath`. Always 2 actions, offensive, with the element/tradition traits.

### 30 real examples across level bands

**Level −1..0:** `Viper Venom` (passive/off, `poison`) · `Slink` (reaction/def) · `Bramble Jump` (3-action/off, `plant,primal,teleportation,wood`) · `Luminescent Aura` (passive/def, `aura,light`) · `Light Flash` (1/off, `concentrate,light`) · `Throat Grab` (1/off) · `Eagle Dive` (2/off) · `Ramming Speed` (2/off) · `Unluck Aura` (passive/def, `aura,mental,misfortune,primal`) · `Self-Loathing` (passive/int, `emotion,mental`) · `Vengeful Anger` (passive/off) · `Tooth Tug` (1/off, `manipulate`) · `Clinging Suckers` (passive/off) · `Plaque Burst` (passive/def).

**Level 1..3:** `Bonecrunching Bite` (passive/off) · `Ghoul Whispers` (1/off, `auditory,linguistic,occult`) · `Swift Leap` (1/off, `move`) · `Grave Knowledge` (passive/off, `occult`) · `Curse of the Wererat` (passive/off, `curse,primal`) · `Blood Feast` (1/off) · `Death Roll` (1/off, `attack`) · `Spore Cloud` (2/off, `poison`) · `Frightening Display` (2/off, `auditory,emotion,fear,mental`) · `Tree Dependent` (passive/def) · `Tree Meld` (2/off) · `Scree Breath` (2/off, `arcane,earth`) · `Haunting Melody` (1/off, `auditory,concentrate,divine,incapacitation,mental`) · `Implant Eggs` (1/off) · `Soul Lock` (3/off, `death,divine`) · `Do a Jig!` (1/off, `auditory,incapacitation,mental,occult`) · `Tumble Behind` (passive/off) · `Final Night` (passive/def, `darkness,occult`).

**Level 4..7:** `Shield Push` (2/off) · `Defensive Quills` (passive/def) · `Mirage Spores` (passive/def, `aura,incapacitation,mental`) · `Freezing Mist Breath` (2/off, `cold,primal`) · `Retaliatory Strike` (reaction/def) · `Ice Climb` (passive/off) · `Baleful Glow` (free/off, `concentrate,light,mental,occult`) · `Scarecrow's Leer` (passive/def, `aura,emotion,fear,mental,occult,visual`) · `Clawing Fear` (passive/off) · `Ghost Dodge` (reaction/def) · `Sliding Earth` (2/off) · `Hair Barrage` (2/off) · `Swarming Stings` (1/off) · `Wretched Weeps` (passive/off).

**Level 8..11:** `Matriarch's Caress` (2/off, `curse,mental,occult`) · `Scimitar Storm` (3/off) · `Hellish Revenge` (reaction/def) · `Draft Contract` (3/off, `divine,manipulate`) · `Ward Contract` (passive/def) · `Infernal Investment` (passive/off) · `Statuary Aura` (passive/def, `arcane,aura,earth`) · `Crystalline Dust Form` (1/off, `polymorph`) · `Ice Stride` (passive/off) · `Chill Breath` (1/off, `cold,primal`) · `Walk the Ethereal Line` (2/int) · `Susceptible to Death` (passive/def) · `Draw In` (2/off) · `Filth Wallow` (passive/def).

**Level 12..15:** `Sprout Life` (2/off, `concentrate,divine,plant,vitality`) · `Reclaim Life` (1/off, `divine,void`) · `Balance Life` (reaction/def, `divine`) · `Warbling Song` (2/off, `auditory,incapacitation,mental,primal`) · `Hop-Dodge` (reaction/def, `move`) · `Staccato Strike` (1/off, `mental,primal,sonic`) · `Liberate the Earth` (2/off, `concentrate,divine,earth`) · `Flash of Brutality` (free/def, `fortune,occult`) · `Manifold Vision` (passive/int) · `Infestation Aura` (passive/def, `aura,earth,occult`) · `Reflective Scales` (reaction/def) · `Frightful Sight` (passive/def, `aura,emotion,fear,mental,visual`) · `Reactive Heads` (passive/def) · `Icy Deflection` (reaction/def) · `Feed on Emotion` (1/off, `attack,emotion,incapacitation,mental`).

**Level 16..20:** `Lightning Drinker` (passive/def) · `Beetle Breath` (2/off, `divine`) · `Final Judgment` (passive/off) · `Impending Fate` (passive/off) · `Sticky Spores` (passive/off) · `Infest Environs` (2/off, `primal`) · `Enfeebling Bite` (passive/off, `divine`) · `Paralyzing Gaze` (passive/def, `aura,divine,unholy,visual`) · `Succor Vulnerability` (passive/def) · `Focused Gaze` (1/off, `concentrate,divine,incapacitation,visual`) · `Miasma` (passive/def, `aura,poison`) · `Shift Fate` (reaction/off, `occult`) · `Snip Thread` (2/off, `death,manipulate,occult`) · `Annihilation Beams` (2/off) · `Erosion Aura` (passive/def, `aura,primal`) · `Deadly Throw` (1/off).

**Level 21..25:** `Slashing Claws` (1/off) · `Pyroclastic Breath` (2/off, `fire,primal`) · `Lava Affinity` (passive/def) · `Curse of Boiling Blood` (passive/def, `curse,fire,primal`) · `Vicious Criticals` (passive/off) · `Defoliation` (2/off, `plant,primal`) · `Aura of Corruption` (passive/def, `aura,plant,primal`) · `Dispelling Strike` (free/off, `primal`) · `Lurking Death` (reaction/def, `divine,teleportation`) · `Aura of Misfortune` (passive/def, `aura,divine,misfortune`) · `Death's Grace` (passive/int) · `Consume Soul` (free/off, `death,primal`) · `Void Breath` (2/off, `primal,void`) · `Send Beyond` (1/off) · `Hundred-Dimension Grasp` (1/off) · `Hundred-Handed Whirlwind` (2/off).

---

## 10. SPELLCASTING CONVENTIONS

**505 of 1,214 creatures (42%) cast**; 607 entries total (some creatures have 2–3).

### Mode distribution

`innate` 402 (66%) · `prepared` 107 (18%) · `spontaneous` 50 (8%) · `focus` 48 (8%).
Tradition: `divine` 231 · `occult` 173 · `primal` 125 · `arcane` 78.

### Canonical entry names

`Divine Innate Spells` 166 · `Occult Innate Spells` 107 · `Primal Innate Spells` 79 · `Arcane Innate Spells` 38 · `Primal Prepared Spells` 31 · `Divine Prepared Spells` 29 · `Arcane Prepared Spells` 29 · `Occult Spontaneous Spells` 24 · `Occult Prepared Spells` 18 · `Cleric Domain Spells` 13 · `Arcane Spontaneous Spells` 10 · `Divine Spontaneous Spells` 10 · `Coven Spells` 8 · `Bard Composition Spells` 8 · `Druid Order Spells` 6 · `Primal Spontaneous Spells` 5 · `Champion Devotion Spells` 4 · `Witch Hex Spells` 3 · `Monk Focus Spells` 2 · `Wizard Focus Spells` 1.
**Format: `<Tradition> <Mode> Spells` for the main entry; `<Class> <Category> Spells` for focus pools.**

### Casting by creature type

| type | % that cast | dominant mode |
|---|---|---|
| monitor | **83%** | innate (24/25) |
| celestial | **81%** | innate (30/30) |
| fey | **81%** | innate |
| dragon | **80%** | innate 72 + **prepared 48** (spellcaster variants) |
| fiend | **78%** | innate (57/57) |
| spirit | 62% | innate |
| construct | 42% | innate |
| aberration | 37% | innate |
| plant | 37% | innate |
| beast | 35% | innate |
| humanoid | 34% | **mixed: innate 68 / prepared 49 / spontaneous 39 / focus 38** |
| giant | 33% | innate |
| undead | 31% | innate (19/22) |
| elemental | 28% | innate (15/15) |
| fungus | 17% | innate |
| ooze | 8% | innate |
| **animal** | **0%** | — |

**Rule: non-humanoid monsters get *innate* spells, essentially always. Humanoid NPCs are the only chassis that use prepared/spontaneous/focus with any regularity — and they get all four modes.**

### DC and spell attack by level (median across all entries)

| lvl | DC | atk | | lvl | DC | atk |
|---|---|---|---|---|---|---|
| −1 | 15 | 7 | | 13 | 33 | 25 |
| 0 | 14 | 6 | | 14 | 34 | 26 |
| 1 | 17 | 9 | | 15 | 36 | 28 |
| 2 | 18 | 10 | | 16 | 37 | 29 |
| 3 | 20 | 11 | | 17 | 38 | 30 |
| 4 | 21 | 13 | | 18 | 40 | 32 |
| 5 | 22 | 14 | | 19 | 41 | 33 |
| 6 | 24 | 16 | | 20 | 42 | 34 |
| 7 | 25 | 17 | | 21 | 44 | 36 |
| 8 | 26 | 18 | | 22 | 45 | 37 |
| 9 | 28 | 20 | | 23 | 46 | 38 |
| 10 | 29 | 21 | | 24 | 48 | 40 |
| 11 | 30 | 22 | | 25 | 49 | 43 |
| 12 | 32 | 24 | | | | |

Observed spread is roughly **±3 around the median** at any level. **Spell attack ≈ DC − 8** across the whole range (holds from level −1 to 25).

### Spell list sizing (spells linked per entry)

| band | innate | prepared | spontaneous | focus |
|---|---|---|---|---|
| −1..0 | 2.5 | — | 3.0 | — |
| 1..3 | 3.9 | 8.6 | 8.6 | 1.6 |
| 4..7 | 5.4 | 13.0 | 15.8 | 1.4 |
| 8..11 | 6.8 | 16.0 | 14.4 | 1.9 |
| 12..15 | 6.4 | 20.9 | 20.7 | 1.7 |
| 16..20 | 7.7 | 28.1 | 21.3 | 2.5 |
| 21..25 | 7.4 | — | — | — |

**Innate lists plateau at 6–8 spells.** Prepared lists scale hard (9 → 28). Focus pools are **1–3 spells, always**.

### Highest spell rank vs creature level (innate; median / max)

lvl 1: 3/5 · 2: 3/4 · 3: 2/7 · 4: 4/7 · 5: 4/7 · 6: 5/7 · 7: 4/8 · 8: 4/7 · 9: 5/9 · 10: 5/7 · 11: 5/7 · 12: 6/7 · 13: 6/8 · 14: 6/8 · 15: 6/8 · 16: 7/9 · 17: 6/9 · 18: 7/8 · 19: 7/9 · **20: 10/10** · 24–25: 10/10.

Practical rule: **median top innate rank ≈ ceil(creature level / 2.5), capped at 7 until level 20**, where 10th-rank appears. Innate entries are structured as "a couple of high-rank signature spells + several utility spells at lower ranks", not a flat list.

Companion header lines: `Constant Spells` (112 creatures) and `At-Will Spells` (19) are separate passive interaction actions listing always-on / unlimited spells; they are not part of the spellcasting entry's spell count.

---

## Quick generator checklist

1. Pick creature type trait + 0–2 lineage traits; rarity `common`; size.
2. **~70% stock:** pull 2–5 abilities from §1 with exact names, costs, categories, traits.
3. **~30% bespoke:** 2-word Title Case noun phrases (§9), one per level tier of budget; give the poison/disease rider a `<name>-venom` slug (§2).
4. Strikes: 2 (median), melee-first; use §3 names + trait sets; attack bonus from §3 table.
5. Effects on strikes: prefer `grab`/`improved-grab`/`knockdown`/`push` — they resolve.
6. Senses per §5 type package; ~20% get none.
7. Languages: 1–2 slugs, `common` + one thematic; `Telepathy 100 feet` for outsiders; details line for "can't speak" / "up to N additional languages".
8. Skills: 3–6 by level band, from the type's signature set; add one `<Topic> Lore` if the NPC has a profession.
9. Action economy: ~50% passive, one reaction max, breath weapon = 2 actions, "improved" riders = free actions.
10. Spellcasting: innate for monsters, prepared/spontaneous only for humanoids; DC from §10 table; spell attack = DC − 8.
11. **Never emit**: alignment traits, `negative`/`positive` damage, `flat-footed`, school traits, `Attack of Opportunity`, or npc-gallery-style legacy formatting.
