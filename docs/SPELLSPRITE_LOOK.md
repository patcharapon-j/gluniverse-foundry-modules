# Spellsprite look model

This doc covers how Spellsprite decides what an action looks like. It replaces
"pick by damage type" with five separate axes. Each axis has one owning signal,
then a fallback chain. Every document in the PF2e compendium resolves through
this model: spells, NPC strikes and abilities, weapons, feats, actions, class
features, consumables and hazards. That includes the Starfinder 2e weapon
groups and traits that PF2e 8.5 ships.

## The axes

| Axis | Spec field | Answers | Owner, then fallbacks |
|---|---|---|---|
| Delivery | `spec.delivery` | How it gets there: the timeline | Structure first: weapon group, range, area shape, attack trait or save. Then the name, then `kind` |
| Motif | `spec.motif` | What object it depicts | The name's nouns, then the weapon's base item or group, then traits. May be `null` |
| Substance | `spec.material`, `spec.accent` | What it is made of: ramp, family, particles | Damage type, then an element named in the name, then element traits, then tradition. `accent` is the second strongest |
| Props | `spec.props` (string[]) | How hard and how big | Weapon traits, spell traits, rank and degree of success |
| Flavor | `spec.flavor` | Who is doing it: the caster's wind-up | The class trait or class feature, then the tradition. May be `null` |

When the name and the damage disagree, the damage colours the effect and the
name shapes it. An element in the name becomes `accent`. A "Frost Claw" that
deals fire is a claw rake, made of fire, with a cold accent. Purely physical
damage is the exception: `kinetic` yields to the named element, so a "Stone
Fist" is earth and an "Ice Claw" that deals slashing is cold. A property rune's
element is never overridden. The element words are a strict list: "Cold Iron"
and "Light Hammer" name no element.

A custom look (`looks.mjs`) still overrides the material, the hue, the flourish
and the take. The curated slug table (`FX_CURATED`) may set any axis.

Every axis records where it came from in `spec.why`: `why.delivery`,
`why.motif`, `why.props` and `why.flavor`, alongside the existing `kind`,
`func` and `material` entries. The coverage tool reports these sources.

`spec.weapon` stays. It is `{ style, ranged, splash, heavy, power }`, and
`style` becomes derived from `delivery` (WEAPON_STYLES keep working for the
looks editor and old callers).

## Vocabularies

These are closed sets in `constants.mjs`: `DELIVERY_VOCAB`, `MOTIF_VOCAB`,
`PROP_VOCAB` and `FLAVOR_VOCAB`. A resolver may only emit a listed value, and
`fx-check` requires a renderer for every delivery. Growing a set means adding
the value, its lexicon entries and its renderer in the same change. The
semantics pass added `squeeze`, `bloom` and the props `boost` and `area` from
the compendium survey; their renderers land with the renderer pass.

### Delivery

**Melee weapons**, by PF2e weapon group:

| Delivery | Groups |
|---|---|
| `swing` | sword |
| `chop` | axe |
| `smash` | club, hammer, mace-likes |
| `thrust` | spear, polearm with piercing |
| `sweep` | polearm with slashing |
| `stab` | knife: a quick, agile thrust |
| `peck` | pick |
| `flail` | flail: a spinning chain |
| `lash` | whip; also natural tails, tentacles, tongues, tendrils and vines |
| `fist` | brawling |
| `bash` | shield |

**Natural attacks**, from the attack's name. 10,413 NPC strikes were surveyed;
the most common names are jaws, claw, fist, tail, fangs, tentacle, horn, beak
and hoof.

| Delivery | Names |
|---|---|
| `rake` | claw, talon |
| `jaws` | jaws, bite, fangs, beak, mandibles, maw, teeth |
| `lash` | tail, tentacle, tongue, tendril, vine, whip |
| `gore` | horn, tusk, antler |
| `sting` | stinger, barb, spine, quill |
| `stomp` | hoof, foot, leg, stomp |
| `buffet` | wing |
| `slam` | fist, slam, body, pseudopod, limb, branch, arm, headbutt |
| `pincer` | pincer |
| `grasp` | hand, ghostly hand, touch, seize, capture |
| `squeeze` | constrict, coil, crush, garrote: a hold that tightens |

A natural attack wins over a weapon word in its name ("Bone Spear Claw" rakes),
unless a base weapon of two or more words matched ("Hand Adze", "Shield
Spikes", "Rope Dart"). A slam on a PC unarmed attack is `fist`.

**Ranged weapons**, by group, then name:

| Delivery | Source |
|---|---|
| `arrow` | bow |
| `bolt` | crossbow |
| `bullet` | firearm or projectile: muzzle flash and tracer |
| `pellets` | firearm with scatter |
| `slug` | sniper: a long tracer and a crack |
| `stone` | sling |
| `dart` | dart, shuriken |
| `thrown` | a thrown melee weapon, spinning |
| `rock` | rock, boulder |
| `bomb` | alchemical bomb: an arc and a splash |
| `grenade` | grenade: an arc, a bounce and a blast |
| `laser` | laser |
| `plasma` | plasma |
| `zap` | shock |
| `sonicwave` | sonic |
| `jet` | flame, cryo, corrosive, poison |
| `mindbeam` | mental |
| `spit` | spit, glob |
| `net` | web, net |
| `missile` | missile, rocket |

A strike may also carry `ray` or `orb` when its name says so ("Eye Beam",
"Solar Bolt") or when a ranged strike with no physical damage names nothing.

Ranged reads in this order: the base item's own override (whips lash,
javelins and chakrams are `thrown`, the blunderbuss and scatterguns are
`pellets`), then the group, then the name, then a default. An NPC strike counts
as ranged when it has a range increment **or** a `thrown-N` or
`range-increment-N` trait, because PF2e stores a thrown javelin's range there
and leaves `range` null. A group that only shoots (bow, crossbow, firearm,
sling, every SF2e ranged group) is ranged unless the weapon has `combination`.
An NPC strike reads its group and base item from the weapon it links
(`flags.<system>.linkedWeapon`) before its own name.

**SF2e** arrives as the same `weapon` documents with SF2e groups. Area guns say
their shape in traits (`area-cone`, `area-line`, `area-burst-N`), not in
`system.area`, so a projectile weapon with `area-cone` (the scattergun) reads as
`pellets` with no `scatter` trait. Grenades are group `grenade` with base item
`grenade`. An SF2e creature's area strike carries `system.area`.
**Spells and abilities** with harm or hazard:

| Delivery | What it is |
|---|---|
| `ray` | spell attack |
| `orb` | a projectile spell |
| `darts` | several small homing projectiles, like Force Barrage |
| `lob` | a lobbed burst |
| `fall` | it comes from above: names like strike, fall, rain, meteor, comet, column or pillar on a burst |
| `burst` | a burst at a point with no lob, e.g. hazards |
| `cone` | cone |
| `line` | line |
| `emanation` | emanation |
| `wall` | wall |
| `touch` | touch |
| `gaze` | gaze |
| `voice` | auditory or linguistic: word, roar, shout, song, command |
| `breath` | a cone or line from the mouth |
| `aura` | a persistent aura, or a harm spell with no range and no target |
| `bloom` | it appears on the target: a single-target save spell, the structural default |

A name that says wall gives `wall` whatever the function. An ability whose
name names a natural action uses it: Trample is `stomp`, Constrict `squeeze`,
Rend `rake`, Swallow Whole `jaws`, Throw Rock `rock`.
**Non-harm:** `form`. compile.mjs then picks FORMS by `func`, and the motif
draws on top.

**Conditions and ticks:** `condition` and `tick`, unchanged.

### Motif

A motif is a depicted object, mostly from name nouns, grouped by kind:

| Group | Motifs |
|---|---|
| Arms | `blade`, `weapon`, `spear`, `arrow`, `hammer`, `chain`, `whip`, `needle` |
| Body | `hand`, `fist`, `claw`, `jaws`, `eye`, `heart`, `skull`, `bones`, `blood`, `wing`, `feather` |
| Sky | `storm`, `cloud`, `rain`, `wind`, `tornado`, `lightning`, `sun`, `moon`, `star`, `comet` |
| Earth and water | `stone`, `crystal`, `spike`, `wave`, `bubble`, `mist`, `smoke` |
| Growth | `vine`, `thorn`, `root`, `flower`, `leaf`, `tree`, `spore` |
| Spirit | `ghost`, `rune`, `glyph`, `word`, `note`, `bell`, `mirror`, `door`, `mask`, `crown`, `coin`, `card` |
| Beasts | `serpent`, `dragon`, `beast`, `swarm`, `web` |
| Energy | `flame`, `orb`, `ray`, `shield`, `wall` |

A motif that repeats the delivery is dropped (a wall spell's `wall`, a ray's
`ray`). The words of a matched base weapon are the weapon, not a motif, so a
Hand Crossbow is an `arrow`, never a `hand`. A strike with no motif noun takes
its body part (`claw` for `rake`, `wing` for `buffet`) or its group's arm.
### Props

| Group | Props |
|---|---|
| Weapon | `deadly`, `fatal`, `scatter`, `automatic`, `concussive`, `kickback`, `splash`, `heavy` (two-hand), `power` (Vicious Swing), `reach`, `sweep`, `agile`, `forceful`, `backstabber`, `volley`, `unwieldy`, `tech`, `boost` (SF2e `boost-N`), `area` (SF2e `area-*`) |
| Material | `precious` (cold iron, silver, adamantine), `magical`, `persistent` |
| Spell traits | `incapacitation`, `fortune`, `misfortune`, `auditory`, `visual`, `linguistic`, `emotion`, `fear`, `curse`, `polymorph`, `teleportation`, `summon`, `healing`, `nonlethal`, `holy`, `unholy`, `death`, `light`, `darkness`, `poison`, `disease` |
| Scale | `minor` (cantrip or rank 1), `major` (rank 7+) |

### Flavor

| Kind | Flavors |
|---|---|
| Traditions | `arcane`, `divine`, `occult`, `primal` |
| Class signatures | `rage`, `flurry`, `impulse`, `gun`, `finisher`, `spellstrike`, `overdrive`, `composition`, `stance`, `hunt`, `sneak`, `judgment` (champion and cleric sanction), `esoterica` (thaumaturge), `psyche` (psychic), `apparition` (animist), `necromancy` (necromancer thralls), `rune` (runesmith), `command` (commander), `guard` (guardian), `exemplar`, `eidolon` |

## Density and glow

Deferred. `ART_PER_SQUARE` stays at 26 and there is no glow layer yet. The
52 px density and soft glow are a separate change (branch
`t3/spellsprite-density-glow`): its first cut cost too much paint time and
the glow washed a fireball white. Every size in this document is art pixels at
26 per square. The sprite clock stays at 12 fps; particles move at 120 Hz.

## Renderer API

- **Strikes:** `strikes.mjs` exports `STRIKES[delivery](s, M, ctx)` for every
  melee, natural and ranged-weapon delivery. Ranged weapons live in
  `ranged.mjs` and are re-exported. ctx is unchanged:
  `{ caster, targets, outcome, release, linger, fire, handOf, POW }`.
- **Harm deliveries:** `deliveries.mjs` exports `HARM[delivery](s, M, ctx)` for
  spell and ability harm deliveries. compile.mjs's `buildHarm` becomes its
  shared helpers.
- **Motifs:** `motif-art.mjs` exports `MOTIFS[motif]`. Each entry may have:
  - `carrier(s, M, p)`: decorates or replaces the travelling particle
  - `impact(s, M, { x, y, z, pow, rad, at })`: the object landing
  - `conjure(s, M, { x, y, z, h, at, life })`: the object appearing, used by
    forms and summons
  - `residue(s, M, { x, y, at })`: what stays behind

  A delivery calls the hooks its motif has and draws its own default
  otherwise. A missing motif is never an error.
- **Props:** read through `s.props`, a Set built in compile.mjs.
- **Flavors:** `flavors.mjs` exports `FLAVORS[flavor](s, M, { caster, hand, at, dur })`,
  the caster's wind-up, which replaces the generic `charge` when present.
- **Routing in `compile.mjs`:**

  | Kind | Plays |
  |---|---|
  | strike | `STRIKES[spec.delivery]`, else `STRIKES[weapon.style]` |
  | harm and hazard | `HARM[spec.delivery]`, else the legacy path |
  | everything else | `FORMS[func]`, plus the motif's `conjure` |
