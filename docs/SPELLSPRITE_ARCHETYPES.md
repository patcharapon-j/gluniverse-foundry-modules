# Spellsprite animation archetypes

A plan for which reusable animations to build or rebuild so that every PC and
NPC action, effect and item in the PF2e compendium animates on its own, ranked
by how many documents each one reaches. Companion to
`docs/SPELLSPRITE_COVERAGE.md` (what plays today) and `docs/SPELLSPRITE.md`
(the pipeline). Counts are from PF2e 8.7.0's packs, 2026-11-09.

## What an archetype is

An **archetype** is one animation plus the parameters that let it stand in for
hundreds of documents. "Grab" is one animation: a hand, coil or maw closes on
the target and hands over to the `grabbed` condition. It plays for an ogre's
Grab, a tentacle's Improved Grab and a frog's Tongue Grab. They differ only in
parameters:

| parameter | what drives it | already in the engine as |
|---|---|---|
| **scale** | creature size (tiny…gargantuan), rank/level | `minor`/`major` props (rank), `T.size` on bodies |
| **material / ramp** | damage type, traits, tradition, name | 26 materials in 13 families (`constants.mjs`), `RAMP` |
| **motif** | the body part or object (jaws, claw, coil, shield) | `MOTIF_VOCAB`, `depict.mjs` |
| **count** | hits in a flurry, darts, heads | `darts` count; nothing generic yet |
| **direction** | actor → target vector, cone/line facing, push vector | deliveries read `caster`/`targets` |
| **outcome** | crit / hit / miss / neutral; crit-fail backlash on maneuvers | `OUTCOMES` |
| **hand-off** | which condition or Strike plays next (grabbed, prone, the Strike's own swing) | nothing yet: one card, one effect |
| **flavor** | who is acting: class or tradition wind-up | `FLAVORS` (rage, flurry, impulse, …) |

**How one is chosen.** The order is the one `semantics.mjs` already uses, and
each archetype is a key at one of these levels:

1. curated slug (`FX_CURATED`: `grapple`, `trip`, `rage`, `demoralize`…)
2. an ability name read whole (`ABILITY_NOUNS`: `breath weapon`, `constrict`, `trample`)
3. structure: area shape, attack vs save, a Strike's weapon group, range
4. name nouns (`STRIKE_NOUNS`, `RANGED_NOUNS`, `HARM_NOUNS`)
5. traits (`aura`, `rage`, `stance`, `polymorph`, `fear`, `auditory`, `visual`, `curse`…)
6. function fallback: `FORMS[func]` (non-harm) or `HARM.bloom` (harm with no shape)

Level 6 is where most of the work is.

## How the numbers were made

- **Source.** `.preview/fx-coverage.json` (100,752 documents: the semantics
  result for each). Traits, action cost, actor size and type, `attackEffects`
  and a description head were taken from the raw LevelDB packs. They were read
  in `tools/fx-coverage.mjs`'s exact walk order and joined to the JSON by
  index. All 100,752 rows matched on pack, name and type, so 0 were misaligned.
  The scripts are throwaway and live outside the repo (`raw.mjs`, `join.mjs`,
  `arche.mjs`, `extra.mjs`, `split.mjs` in the session scratchpad
  `…/scratchpad/archetypes/`). Re-derive them from this section.
- **A document** is one item. Embedded items count once per actor, so "Jaws" on
  1,575 creatures counts 1,575. That measures how many sheets carry a thing,
  not how often it is used: Trip is 4 documents and is rolled every session.
- **PC side** = every category except `bestiary-*`, `hazards-*` and
  `vehicles-*`. That includes the Spells pack, feats, actions, equipment and
  the `pcs-*` iconics. **NPC side** = `bestiary-*`, `hazards-*`, `vehicles-*`.
- **Exclusive assignment.** Each document goes to the *first* archetype that
  matches, in a fixed order: conditions, Strikes (by resolved delivery),
  consumables (by category), passive senses, cross-type names (breath,
  polymorph, summon, wall), named abilities, traits, then spells by
  shape/function, then ability fallbacks by function. Rows therefore sum to
  100,752 and lifts can be added up.
- **Generic** = `silent: "no-function"` (1,935), or playing on `delivery: "form"`
  (the `FORMS[func]` fallback, 39,635), on `bloom` (harm with no shape, 4,683),
  or with `why.delivery === "default"` on any other delivery (460).
  **46,713** documents in total.
- **Lift** = generic documents inside an archetype: what it would move from
  silent or generic to specific.
- **Passive that fires** = passive documents whose effect happens at the table
  with no chat card to key on: Frightful Presence, Regeneration/Fast Healing and
  aura-trait passives. **1,458** of them. They need a trigger, not just a
  renderer (see §5).

## Headline

- Of 71,775 playing documents, **41,080** (57%) get their delivery from
  `default`. Almost all of these are `FORMS[func]`: 39,635 docs, and 25,377 of
  them are spells.
- **Strikes are already specific.** 14,851 Strikes, 97.8% of NPC Strikes on a
  name or group delivery, lift 301. Their work is *rebuild with parameters*
  (size, material, riders), not coverage.
- The biggest single lever is **splitting `FORMS.hinder`** (5,675 spells plus
  3,445 abilities) by trait into about 8 sub-forms. Next are `FORMS.support`
  (4,847), `FORMS.detect` (3,233), `FORMS.conceal` (3,101) and
  **`HARM.bloom`** (2,577 spells plus about 2,100 non-spell documents).
- **Named creature abilities** are a cheap, high-yield set. Grab (1,112),
  Change Shape and polymorph (1,242), charge/pounce (490), Draconic Frenzy and other flurries
  (430), Knockdown (249), Push (251), Trample (136) and Rend (113) all land on
  `FORMS.hinder`/`FORMS.transform` today.

---

## 1. Catalogue

Columns: **docs** = total (PC / NPC). **lift** = generic docs in the row.
**state** = what plays today, most common first (`FORMS.x` = generic function
form; `silent:reason`; `X(default)` = fallback delivery).

### 1.1 Strikes

Rows are the delivery the name/group lexicon already resolves
(`depict.mjs` `STRIKE_NOUNS`/`RANGED_NOUNS`/`GROUP_DELIVERY`). Every row has its
own renderer in `strikes.mjs` `DELIVER` or `ranged.mjs` `RANGED`.

Shared parameters:
- **Size**: NPC Strikes are med 7,015, lg 2,583, sm 1,278, huge 1,205,
  grg 968, tiny 397. **35%** are Large or bigger, so a single-size animation is
  wrong for a third of them.
- **Material**: 3,357 of 14,851 Strikes (22.6%) are not kinetic. The top ones
  are fire 612, void 381, acid 286, unholy 272 and mental 268.
- **Riders** (`system.attackEffects`, below).

| archetype | signals | docs (PC/NPC) | examples | must take | state today | pri |
|---|---|---:|---|---|---|---|
| **jaws** | jaws, bite, fang, beak, mandible, maw, tooth, sucker | 2,153 (0/2,153) | Jaws 1,575, Fangs 189, Beak 111, Bite 85, Mandibles 73 | size; material (528 non-kinetic: fire 121, poison 61); grab/knockdown rider | own delivery `jaws` (2,153) | **P0 rebuild** |
| **rake** (claw/talon) | claw, talon, rake, scratch, nail, hook | 1,729 (0/1,729) | Claw 1,498, Talon 90, Claws 76, Spectral Claw 6 | size; count (paired claws); grab rider (277); void/unholy ramp | own delivery `rake` | **P0 rebuild** |
| **slam / fist** | fist, slam, pseudopod, body, branch, elemental blows; brawling group | 1,521 (35/1,486) | Fist 1,019, Pseudopod 78, Branch 41, Gauntlet 30, Slam 22 | size (huge elemental vs. med zombie); material (288 non-kinetic); push rider | own `slam` 1,396, `fist` 82, `slam(default)` 43 | **P0 rebuild** |
| **lash** (tail/tentacle/tongue/vine) | tail, tentacle, tongue, tendril, vine, whip, hair | 1,127 (21/1,106) | Tail 644, Tentacle 119, Tongue 54, Tendril 36, Whip 33 | size (68% Large+); arc direction; grab/knockdown rider (159/55) | own delivery `lash` | **P0 rebuild** |
| **swing** (sword) | sword group; blade nouns | 980 (135/845) | Shortsword 211, Longsword 131, Scimitar 84, Greatsword 56 | heavy/two-hand; material from runes | own `swing` 949, `swing(default)` 31 | P1 |
| **smash** (club/hammer, improvised) | club/hammer groups; improvised objects; bows/guns used in melee | 1,067 (311/756) | Staff 173, Club 60, Warhammer 50, Sap 44, Morningstar 35 | heavy; knockdown rider | own `smash` 984, `smash(default)` 83 | P1 |
| **thrown weapon** | thrown trait; javelin/throw nouns | 1,062 (23/1,039) | Dagger 344, Spear 96, Javelin 95, Club 53, Trident 48 | the object's motif (spin vs. straight) | own `thrown` 1,000, `thrown(default)` 62 | P1 |
| **arrow / bolt** | bow/crossbow groups | 732 (110/622) | Shortbow 142, Crossbow 141, Composite Shortbow 106, Composite Longbow 99 | volley, poison rider | own `arrow` 423, `bolt` 309 | P1 |
| **stab** (knife/dagger) | knife group | 717 (158/559) | Dagger 372, Sickle 53, Kukri 48, Clan Dagger 17 | agile (quick double); backstabber | own `stab` | P1 |
| **thrust** (spear/polearm) | spear/polearm groups | 553 (134/419) | Rapier 125, Spear 94, Trident 45, Longspear 43 | reach length | own `thrust` 527, `(default)` 26 | P1 |
| **dart / stone / rock** | dart/sling groups; rock, boulder | 415 (34/381) | Rock 90, Sling 79, Dart 44, Shuriken 25, Blowgun 18 | size (giant's rock) | own `dart` 217, `rock` 103, `stone` 95 | P2 |
| **bomb / grenade** | bomb group, splash | 395 (209/186) | Alchemist's Fire 45, Acid Flask 35, Bottled Lightning 22, Frost Vial 15 | material (323 non-kinetic); splash radius | own `bomb` 386, `grenade` 9 | P1 |
| **ray / orb** (magical ranged Strike) | beam, ray, eye beam, orb, mote, bolt | 303 (3/300) | Eye Beam 12, Mental Blast 10, Force Ball 8, Storm Bolt 8 | material (290 non-kinetic) | `orb` 125, `ray` 92, **`ray(default)` 56**, `mindbeam` 19 | P2 |
| **gore** (horn/tusk/antler) | horn, tusk, antler | 265 (0/265) | Horn 120, Horns 54, Antler 33, Tusk 30 | size; knockdown rider (21) | own `gore` | P2 |
| **stomp** (hoof/foot/leg) | hoof, foot, leg, kick, paw | 252 (0/252) | Hoof 104, Foot 80, Leg 38, Barbed Leg 7 | size | own `stomp` | P2 |
| **sweep** (scythe/glaive) | scythe, glaive, halberd | 159 (25/134) | Glaive 37, Scythe 34, Halberd 29 | sweep arc | own `sweep` | P2 |
| **spit / jet / net** | spit, glob, spray, web, net | 214 (4/210) | Spit 44, Web 27, Acid Spit 12, Caustic Spit 8 | material; web-trap rider (18) | own `spit` 126, `jet` 50, `net` 38 | P2 |
| **flail / peck / bash** | flail/pick/shield groups | 199 (55/144) | Spiked Chain 24, Flail 23, War Flail 19, Pick 19 | — | own `flail` 120, `peck` 57, `bash` 22 | P2 |
| **grasp** (hand/touch) | hand, ghostly hand, touch | 179 (0/179) | Ghostly Hand 43, Hand 21, Shadow Hand 14 | material (163 non-kinetic, void 112) | own `grasp` | P2 |
| **sting** | stinger, proboscis, spine, syringe | 152 (0/152) | Stinger 68, Proboscis 12, Syringe 10 | poison rider | own `sting` | P2 |
| **buffet** (wing) | wing, pinion | 108 (0/108) | Wing 99, Wings 3, Burning Wings 2 | size; push rider | own `buffet` | P2 |
| **bullet / pellets / slug** | firearm group | 204 (109/95) | Dueling Pistol 14, Flintlock Pistol 9, Flintlock Musket 9, Dwarven Scattergun 7 | kickback, scatter | own `bullet` 170, `pellets` 32 | P2 |
| **zap / sonicwave** | shock/spark; shriek/scream | 92 (0/92) | Shriek 8, Thunderbolt 7, Euphoric Spark 7 | — | own | P2 |
| **pincer** / **squeeze** | pincer, pliers; coil/crush Strikes | 39 + 6 | Pincer 30, Pliers 5; Manacles 2 | grab rider (27 of 39 pincers) | own | P2 |

#### Strike riders (one archetype each, played *after* the Strike lands)

Of 14,851 Strikes, **3,440** carry one or more `attackEffects`. Each rider is a
reusable follow-through keyed on the effect slug, not on the creature:

| rider | Strikes carrying it | follow-through archetype | state today |
|---|---:|---|---|
| grab / improved-grab / attach / tongue-grab | 1,253 | the **Grab** archetype (§1.2) on the same target | nothing: the Strike plays; Grab plays only if its own card is posted (then `FORMS.hinder`) |
| poison / venom | 397 | an affliction seep (corrode family) on the bitten spot | nothing |
| drain / paralysis / curse / wound | 266 | void or psyche seep; paralysis hands over to the condition | nothing |
| knockdown / trip | 225 | the **Trip / Knockdown** archetype | nothing |
| disease / fever / rot | 186 | sickly seep | nothing |
| push / knockback | 108 | the **Shove / Push** archetype | nothing |
| other (creature-specific) | 1,186 | — | nothing |

### 1.2 Creature abilities

| archetype | signals | docs (PC/NPC) | lift | examples | must take | state today | pri |
|---|---|---:|---:|---|---|---|---|
| **Grab / Grapple** | slug `grapple`; name grab, improved grab, combat grab, tongue grab, seize, snatch, capture, attach, wrestle | 1,232 (23/1,209) | 1,112 | Grab 806, Improved Grab 207, Tongue Grab 29, Efficient Capture 13, Attach 13 | motif from the last Strike (hand, jaws, coil, tongue); size; hand-off to `grabbed` | `FORMS.hinder` 1,072, silent:passive 74, `grasp` 44 | **P0** |
| **polymorph / change shape** | trait polymorph/morph; name change shape, swarm shape, turn to mist, vapor form, shadow form, liquefy, *form | 1,404 (187/1,217) | 1,242 | Change Shape 390, Humanoid Form 76, Cursed Metamorphosis 68, Vapor Form 62, Enlarge 45 | material; target size in and out; "into mist/swarm/shadow" variant | `FORMS.transform` 1,155, silent:passive 81 | P1 |
| **charge / pounce** (move + Strike) | pounce, charge, lunge, rush, gallop, strafe, swoop, leaping, dive | 556 (75/481) | 490 | Pounce 64, Sudden Charge 50, Gallop 18, Impaling Charge 15, Flying Strafe 14 | path (from → to); size; hand-off to the Strike | `FORMS.hinder` 401, silent:no-function 57, `slam` 24 | **P0** |
| **multi-strike flurry** | draconic frenzy, coiling frenzy, flurry of blows, swarming bites, double slice, twin takedown | 514 (37/477) | 430 | Draconic Frenzy 230, Flurry of Blows 60, Swarming Bites 41, Coiling Frenzy 20, Double Slice 12 | **count**; which body parts (jaws + claws + tail); each Strike still plays its own hit | `FORMS.hinder` 399, `jaws` 40, silent:no-function 23 | **P0** |
| **feed / drain** | drink blood, blood drain, consume flesh, feast, gnaw, devour, siphon, drain life | 539 (27/512) | 339 | Consume Flesh 63, Drink Blood 50, Drain Life 45, Blood Drain 24, Siphon Life 18 | stream direction (target → actor); ramp blood/void/soul | `FORMS.restore` 164, silent:passive 106, `FORMS.hinder` 102, `jaws` 74 | P1 |
| **affliction** (poison/disease/curse) | trait poison, disease, curse; name venom, fever, rot, plague, poison weapon | 1,479 (236/1,243) | 464 | Ghoul Fever 27, Graveknight's Curse 21, Poison Weapon 20, Spore Cloud 16 | material (poison 576, void 93); stage | silent:passive 625, `spit` 277, `bloom` 263, `FORMS.hinder` 147 | P1 |
| **teleport / phase step** | func teleport; trait teleportation; blink, phase, shadow step, mist escape, skip between | 437 (55/382) | 332 | Planar Acclimation 21, Mist Escape 20, Skip Between 17, Shadow Step 9 | material (shadow, mist, fey); from → to | `FORMS.teleport` 239, silent:passive 87 | P1 |
| **Trip / Knockdown** | slug `trip`; knockdown, improved knockdown, knocking sweep, topple | 265 (9/256) | 249 | Knockdown 170, Improved Knockdown 41, Knocking Sweep 12, Trip 4 | size; hand-off to `prone`; crit-fail backlash | `FORMS.hinder` 231 | **P0** |
| **Shove / Push / Reposition** | slug `shove`/`reposition`; push, improved push, push 10 feet, buck, fling | 293 (37/256) | 251 | Buck 36, Push 31, Push 10 feet 20, Improved Push 18, Reposition 13 | **push vector and distance**; size | `FORMS.hinder` 205, `FORMS.control` 18 | **P0** |
| **trample** | trample, stampede, overrun | 151 (6/145) | 136 | Trample 132, Overrun 5, Rolling Thunder Trample 2 | path through squares; size | `FORMS.hinder` 134 (Trample has no inline damage, so `ABILITY_NOUNS.stomp` is skipped), `stomp` 10 | P0 |
| **rend** | rend, eviscerate, rip and tear, savage | 152 (11/141) | 113 | Rend 87, Eviscerate 9, Savage 9, Eager Rend 9 | the two Strikes' motif; size | `FORMS.hinder` 101, `rake` 30 | P1 |
| **self-destruct / explode** | self destruct, explode, detonate, death burst | 334 (67/267) | 103 | Verdant Burst 26, Explode 16, Spore Burst 11, Explosion 9 | material; radius | `burst` 82, `emanation` 50, `aura` 43 | P2 |
| **possess / dominate** | trait possession; possess, dominate, command confusion | 145 (22/123) | 103 | Dominate 33, Malevolent Possession 9, Command Confusion 7 | spirit vs. mental ramp | `FORMS.hinder` 88 | P1 |
| **throw / catch rock** | throw rock, catch rock | 94 (0/94) | 94 | Throw Rock 61, Catch Rock 33 | size; arc | `FORMS.hinder` 61 / `FORMS.protect` 33 (the Strike that follows plays `rock`) | P1 |
| **roar / howl / shriek** | trait auditory; roar, howl, shriek, bellow, croak, scream, battle cry | 521 (119/402) | 82 | Terrifying Croak 16, Battle Cry 9, Scream in Agony 8, Resounding Roar 8 | cone vs. emanation; material (mental 195, sonic 122) | `voice` 312, silent:passive 92, `FORMS.hinder` 44 | P2 (has `voice`) |
| **gaze** | gaze, glance, stare, focus beauty | 390 (90/300) | 34 | Focus Gaze 45, Keen Eyes 22, Petrifying Gaze 17, Focus Beauty 15 | material | `gaze` 176, silent:passive 167 | P2 (has `gaze`) |
| **web / net / entangle** | web, web trap, entangle, snagging | 126 (15/111) | 36 | Web Trap 20, Descend on a Web 9, Snagging Strike 9 | — | silent:passive 52, `net` 35 | P2 |
| **swallow whole / engulf** | swallow, engulf, envelop | 253 (5/248) | 29 | Swallow Whole 173, Engulf 31, Fast Swallow 23 | size ratio; material (acid 46) | `jaws` 173, `squeeze` 42 | P1 rebuild (`jaws` replays a bite; needs a *gulp*) |
| **constrict / crush** | constrict, greater constrict, wrap in coils, crush | 344 (11/333) | 14 | Constrict 221, Greater Constrict 48, Wrap in Coils 9 | size; reads `grabbed` | own `squeeze` 309 | P2 |
| **breath weapon** | `/breath|exhal/` (not of-life/deep/no breath), or delivery breath | 711 (52/659) | 18 | Breath Weapon 170, Vomit Swarm 19, Poison Breath 14, Hellfire Breath 13 | material (fire 146, poison 85, cold 56, acid 47); cone/line | own `breath` 637 | P1 rebuild (size: dragons are huge+) |
| **frightful presence / fear aura** | frightful presence, frightful moan, dreadful | 361 (10/351) | 7 | Frightful Presence 311, Frightful Moan 22 | radius; size | **silent:passive 324** (no card to key on) | P1 (needs a trigger) |
| **regeneration / fast healing** | regeneration N, fast healing N, self repair | 404 (3/401) | 28 | Fast Healing 10 48, Regeneration 20 46, Fast Healing 2 36 | amount; "regeneration stopped" variant | **silent:passive 375** | P1 (needs a trigger) |

### 1.3 PC actions and skill actions

Basic actions are few documents and very frequent. A skill-check message
(`action:<slug>`) resolves through `describeSkillAction`, whatever the doc
count. Here is the Actions pack, action by action:

| action | today | archetype it should use | pri |
|---|---|---|---|
| Demoralize | `voice` / hinder / mental (curated) | **Demoralize** (glare + voice, shared with roar); 9 docs | P1 rebuild |
| Trip | `FORMS.control` (curated: control/kinetic) | **Trip / Knockdown** | **P0** |
| Grapple | `FORMS.control` | **Grab / Grapple** | **P0** |
| Shove | `FORMS.control` / force | **Shove / Push** | **P0** |
| Reposition | `FORMS.control` | **Shove / Push** (lateral vector) | P0 |
| Disarm | `FORMS.control` / metal | **Disarm** (weapon flies from hand) | P1 |
| Feint, Create a Diversion | `FORMS.conceal` / illusion | **Feint** (afterimage feint, then off-guard) | P1 |
| Raise a Shield | `FORMS.protect` + motif shield | **Shield** (shared with Shield Block) | P1 rebuild |
| Treat Wounds, Battle Medicine, Administer First Aid, Treat Poison/Disease | `CRAFTS.medicine` (`tend`) | keep (already specific) | — |
| Escape | `FORMS.support` / kinetic | **Escape** (bonds burst; ends `grabbed`/`restrained`) | P1 |
| Seek | `FORMS.detect` / light | detect sweep (shared with detect spells) | P2 |
| Point Out | `voice` / detect | keep | — |
| Aid | `FORMS.support` / light | **Aid / inspire** | P2 |
| Take Cover | `FORMS.protect` / earth | keep | P2 |
| Leap, High/Long Jump, Tumble Through, Maneuver in Flight | `FORMS.support` / air | **dash / leap** (path arc) | P2 |
| Stride, Step, Crawl, Climb, Swim, Burrow, Stand, Drop Prone, Interact, Ready, Sustain, Delay | silent:no-visual | keep silent. Foundry already animates token movement, so a second animation competes with it. At most a dust puff on Step/Leap | — |
| Recall Knowledge | silent:no-visual (curated) | keep silent, or a tiny *study* glint on the actor only | P2 |
| Hide, Sneak, Avoid Notice, Steal, Palm an Object, Sense Motive | silent:secret (curated) | **must stay silent**: the roll is hidden from players, and an animation can give away who rolled, at whom, or the result | — |
| Hunt Prey, Devise a Stratagem | `FORMS.detect` | **mark target** (reticle on the target) | P1 |
| Rage | `FORMS.support` / fire + flavor rage (curated) | **Rage** (§1.4) | **P0** |
| Overdrive | `FORMS.support` / electricity + flavor | keep | — |

And their namesakes across feats and creature abilities (exclusive rows,
signals as in §1.2):

| archetype | signals | docs (PC/NPC) | lift | examples | state today | pri |
|---|---|---:|---:|---|---|---|
| **Demoralize / intimidate / taunt** | demoralize, intimidat-, frighten, taunt, jeer, you're next | 199 (78/121) | 107 | Intimidating Glare 23, Intimidating Strike 19, Taunt 14, You're Next 12 | `FORMS.hinder` 98, silent:passive 62, `gaze` 14 | P1 |
| **Recall Knowledge / Hunt Prey / study** | hunt prey, devise a stratagem, exploit vulnerability, mark, size up, clue in | 218 (100/118) | 160 | Hunt Prey 63, Read the Cards 18, Devise a Stratagem 10, Mark for Death 7 | `FORMS.detect` 73, `FORMS.hinder` 49, silent:no-function 37 | P1 |
| **Feint / diversion / dirty trick** | feint, diversion, dirty trick, distract | 145 (55/90) | 81 | Twin Feint 14, Scoundrel's Feint 8, Feint 7, Dirty Trick 7 | silent:passive 49, `FORMS.hinder` 45 | P1 |
| **Disarm / sunder** | disarm, sunder, kneecap, armor-rending | 82 (25/57) | 52 | Wary Disarmament 10, Sunder Objects 7, Armor-Rending Bite 6 | `FORMS.hinder` 17, `FORMS.protect` 15 | P1 |
| **Escape / burst free** | escape, burst free, slip, wriggle | 76 (19/57) | 51 | Squirming Embrace 10, Unimpeded 7, Slip 5 | `FORMS.hinder` 26, `FORMS.protect` 15 | P1 |
| **Battle Medicine / healing hands** | battle medicine, treat wounds, healing hands, -medicine | 238 (124/114) | 88 | Coffin Restoration 41, Battle Medicine 19, Healing Hands 15 | silent:passive 140, `FORMS.restore` 62 | P2 (`tend` exists) |
| **Stride / Step / Leap / dash** | swift leap, scamper, scuttle, retreat, glide, speed surge, … stride | 788 (241/547) | 363 | Swift Leap 47, Earth Glide 40, Speed Surge 26, Goblin Scuttle 21 | silent:passive 396, `FORMS.hinder` 180, silent:no-function 64 | P2 |
| **Reload / draw / interact** | reload, quick draw, call gun, conjure bullet, quick alchemy, affix | 210 (60/150) | 186 | Quick Draw 47, Quick Bomber 38, Quick Alchemy 17, Running Reload 12 | `FORMS.hinder` 125, silent:no-function 44 | P2 |
| **Command / formation / tactic** | trait tactic/commander; command a(n), form up, formation, banner | 644 (160/484) | 151 | Troop Defenses 164, Troop Movement 164, Form Up 35 | silent:passive 477, `FORMS.hinder` 83, silent:no-function 59 | P2 |
| **Aid / inspire / composition** | trait composition; aid, inspire, courage | 213 (96/117) | 70 | Inspiration 13, Inspiring Presence 10, Inspiring Word 8 | silent:passive 112, `FORMS.hinder` 38 | P2 |
| **spellshape / casting tweak** | trait spellshape; quickened casting, reach spell, recharge, drain bonded item | 430 (176/254) | 328 | Steady Spellcasting 82, Quickened Casting 38, Drain Bonded Item 34, Reach Spell 31 | `FORMS.hinder` 155, silent:no-function 154 | P2 (a tradition glyph on the hand: `FLAVORS` already draws one) |
| **Strike modifier** (the Strike plays) | trait flourish/press/finisher, or name *strike, *shot, *slice, *swipe, *attack | 1,855 (426/1,429) | 683 | Sneak Attack 577 (passive), Surprise Attack 92, Swipe 23, Wide Swing 19 | silent:passive 1,018, `FORMS.hinder` 425, silent:no-function 191 | P1 (a wind-up that hands off to the Strike, never a second hit) |

### 1.4 Self buffs, stances, auras, rages, polymorph

| archetype | signals | docs (PC/NPC) | lift | examples | must take | state today | pri |
|---|---|---:|---:|---|---|---|---|
| **Rage** | trait rage; rage, berserk, blood/fanatical/death/moon frenzy, frenzied, fury | 302 (127/175) | 207 | Rage 39, Blood Frenzy 12, Berserk 11, Raging Intimidation 11, Fanatical Frenzy 11 | instinct → material (dragon → breath element, spirit, animal, fury); size; sustained shimmer while raging | `FORMS.hinder` 93 (NPC rages carry emotion/mental traits), silent:passive 77, silent:no-function 43 (Mighty Rage…), `FORMS.support` 41 (curated Rage) | **P0** (user's named example) |
| **stance** | trait stance, name stance | 273 (141/132) | 150 | Swarming Stance 9, Tiger Stance 6, Dragon Stance 2 | material / animal motif from the name; per-stance accent | `FORMS.support` 111, silent:passive 111 | P1 |
| **aura** (passive or activated) | trait aura, delivery aura | 988 (50/938) | 102 (+759 passive that fires) | Stench 84, Vortex 19, Sacrilegious Aura 17, Glow 16 | radius; material; olfactory/visual variant | silent:passive 759, `aura` 106, `bloom` 82 | P1 (needs a trigger for passives) |
| **polymorph / change shape** | §1.2 | 1,404 | 1,242 | | | | P1 |
| **summon / create minion** | func summon; summon, create undead, animate dead | 387 (62/325) | 321 | Create Undead 52, Summon Animal 34, Phantasmal Minion 30, Summon Undead 26 | material; creature size; count | `FORMS.summon` 246, `FORMS.neutral` 64 | P1 |
| **ferocity / last stand / shake it off** | ferocity, final spite, diehard, shake it off, remove a condition | 327 (49/278) | 264 | Ferocity 96, Remove a Condition 45, Final Spite 26, Diehard 19 | — | `FORMS.protect` 171, silent:no-function 54 | P1 |

### 1.5 Spell shapes × materials

**Harm spells (8,051, every spell category)** already have a shaped delivery.
Rows are deliveries and columns are material families. This is the grid each
shape must cover, recoloured by ramp:

| delivery | flame | frost | arc | tide | earthwork | growth | corrode | umbra | radiance | psyche | shock | physical |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **bloom** (no shape) | 61 | 87 | 100 | 0 | 6 | 6 | 160 | **561** | 52 | **1007** | 372 | 175 |
| ray | 300 | 193 | 16 | 81 | 5 | 1 | 143 | 2 | 4 | 0 | 374 | 24 |
| lob | 339 | 96 | 8 | 1 | 8 | 12 | 229 | 59 | 3 | 151 | 283 | 160 |
| orb | 60 | 3 | 8 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 323 | 10 |
| darts | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 21 | 250 | 9 |
| cone | 85 | 104 | 0 | 0 | 0 | 0 | 7 | 85 | 8 | 5 | 92 | 62 |
| line | 6 | 21 | 114 | 56 | 0 | 0 | 0 | 198 | 5 | 0 | 65 | 30 |
| touch | 1 | 6 | 28 | 0 | 0 | 0 | 1 | 295 | 0 | 10 | 58 | 74 |
| zap | 0 | 0 | 188 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| voice | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 40 | 1 | 82 | 17 | 1 |
| emanation / aura | 29 | 4 | 4 | 1 | 2 | 5 | 17 | 6 | 1 | 7 | 152 | 16 |
| wall | 3 | 50 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 0 | 96 |
| fall | 41 | 1 | 30 | 0 | 0 | 0 | 0 | 1 | 1 | 0 | 27 | 9 |
| breath / spit / gaze / burst | 2 | 1 | 1 | 0 | 0 | 0 | 6 | 1 | 0 | 0 | 5 | 20 |

Read across a row for the ramps a shape must take. Read down a column for the
family's look on every shape. **Bloom × psyche (1,007; Daze 570, Phantom Pain
102)** and **bloom × umbra (561; Harm 235, Void Warp 143)** are the two biggest
cells on the grid, and both are the shapeless fallback.

Harm rows from the exclusive pass, all with their own delivery: ray 1,142
(Divine Lance 201, Ignition 111, Ray of Frost 104); orb/darts 684 (Telekinetic
Projectile 310, Magic Missile 124, Force Barrage 124); lob 1,349 (Fireball 164,
Divine Wrath 123); cone/line 942 (Grim Tendrils 139, Lightning Bolt 114);
touch/voice/zap/gaze 1,212 (Command 263, Electric Arc 188, Chill Touch 111);
emanation/aura 418 (Divine Decree 68, Repulsion 54, Bless 42); fall 110 (Flame
Strike 31); wall 501 (Wall of Fire 96, Wall of Thorns 90). Lift 0: these are
P1/P2 *quality* work on existing shapes.

**Non-harm spells (26,350)** all draw `FORMS[func]`, tinted by material. Here
is the function × family grid:

| func | docs | flame | frost | arc | tide | earthwork | growth | corrode | umbra | radiance | psyche | shock | physical |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| hinder | 6,152 | 8 | 4 | 30 | 123 | 251 | 131 | 81 | 283 | 411 | **4225** | 583 | 22 |
| support | 4,915 | 11 | 18 | 5 | 20 | 88 | 629 | 0 | 235 | 1339 | 898 | 1443 | 229 |
| detect | 3,315 | 0 | 0 | 0 | 1 | 6 | 10 | 0 | 0 | 654 | 417 | 2227 | 0 |
| conceal | 3,112 | 1 | 0 | 0 | 51 | 0 | 0 | 0 | 250 | 1 | 2809 | 0 | 0 |
| neutral | 1,723 | 3 | 3 | 2 | 136 | 60 | 120 | 1 | 69 | 406 | 179 | 744 | 0 |
| restore | 1,438 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 4 | 1069 | 71 | 293 | 0 |
| teleport | 1,214 | 2 | 0 | 0 | 0 | 0 | 14 | 0 | 23 | 0 | 31 | 1144 | 0 |
| protect | 1,192 | 30 | 0 | 0 | 0 | 61 | 12 | 0 | 14 | 242 | 50 | 783 | 0 |
| movement | 850 | 0 | 0 | 0 | 49 | 0 | 40 | 0 | 0 | 51 | 7 | 703 | 0 |
| terrain | 960 | 96 | 1 | 6 | 218 | 85 | 156 | 0 | 2 | 172 | 44 | 180 | 0 |
| transform | 635 | 0 | 0 | 0 | 1 | 38 | 52 | 0 | 90 | 1 | 0 | 453 | 0 |
| control | 647 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 148 | 499 | 0 |
| summon | 197 | 0 | 0 | 0 | 2 | 4 | 26 | 0 | 18 | 29 | 59 | 59 | 0 |

(These are all non-harm spells. The exclusive rows below are smaller because
polymorph, summon and wall spells were assigned to those archetypes first.)

**Sub-archetypes inside each `FORMS` bucket** (spells only, exclusive split by
trait, then name, first match; counted from `split.mjs`):

| bucket | sub-archetype (signal) | docs | examples | pri |
|---|---|---:|---|---|
| hinder (5,675) | **mind hex** (mental/emotion) | 1,649 | Confusion 181, Enthrall 87, Mind Probe 78 | **P0** |
| | **mind control** (incapacitation + mental) | 1,018 | Charm 345, Suggestion 236, Warp Mind 87 | **P0** |
| | **fear** (trait fear) | 528 | Fear 501, Dirge of Doom 11 | **P0** |
| | **enfeeble / bind body** (enfeeble, earthbind, ray of enfeeblement) | 387 | Ray of Enfeeblement 167, Earthbind 113, Enfeeble 101 | P1 |
| | **curse** (trait curse) | 339 | Outcast's Curse 62, Ill Omen 61, Feeblemind 40 | P1 |
| | **paralyze / petrify** (name) | 282 | Paralyze 167, Shape Stone 59, Petrify 39 | P1 |
| | **slow / time** (name) | 256 | Slow 237, Stagnate Time 9 | **P0** |
| | **blind / deafen** (name) | 191 | Blindness 156, Deafness 27 | P1 |
| | **sleep** (trait sleep) | 98 | Sleep 96 | P1 |
| | (other: keeps generic hinder) | 925 | Revealing Light 104, Banishment 84, Control Water 71 | — |
| support (4,848) | **utility cantrip** (cantrip) | 817 | Prestidigitation 334, Guidance 228, Sigil 207 | P2 |
| | **light source** (trait light / name) | 438 | Light 431 | P1 |
| | **plant growth** (plant/wood) | 390 | Tangle Vine 118, Speak with Plants 100, Tanglefoot 87 | P2 |
| | **message / speech** (linguistic) | 372 | Message 369 | P2 |
| | **fortune / sure strike** (fortune) | 216 | True Strike 99, Sure Strike 92 | P1 |
| | (other: keeps generic support) | 2,588 | Truespeech 268, Unfettered Movement 139, Tongues 128 | — |
| conceal (3,101) | **illusion / disguise** (name) | 982 | Figment 206, Illusory Disguise 204, Mirror Image 114 | P1 |
| | **invisibility** (name) | 491 | Invisibility 424, Disappearance 51 | **P0** |
| | **phantom sound** (auditory) | 357 | Ghost Sound 181, Ventriloquism 123 | P2 |
| | **darkness** (trait darkness) | 240 | Darkness 222 | P1 |
| | **blur** (name) | 144 | Blur 143 | P1 |
| | **mist** (name) | 51 | Obscuring Mist 51 | P2 |
| | (other) | 836 | Silence 91, Paranoia 86, Nightmare 84 | — |
| detect (3,233) | **detect magic / read aura** | 1,499 | Detect Magic 971, Read Aura 423 | P1 |
| | **true sight / see invisible** | 591 | Truesight 175, True Seeing 141, See the Unseen 115 | P1 |
| | **scry** (trait scrying) | 289 | Clairvoyance 107, Clairaudience 94, Scrying 63 | P2 |
| | **augury** (prediction) | 270 | Augury 112, Read Omens 84 | P2 |
| | **mind reading** (mental) | 252 | Mind Reading 163, Ring of Truth 53 | P2 |
| | (other) | 332 | Know the Way 104, Locate 91 | — |
| neutral (1,646) | **telekinetic hand** | 429 | Telekinetic Hand 199, Mage Hand 191 | P2 |
| | **create** (food, water, object) | 237 | Create Water 78, Create Food 43 | P2 |
| | **dancing lights** (light) | 170 | Dancing Lights 134 | P2 |
| | **mending** | 81 | Mending 80 | P2 |
| restore (1,432) | **vital rise** (Heal, Stabilize, Soothe; paired with Harm on bloom) | 1,432 | Heal 421, Stabilize 169, Soothe 108, Cleanse Affliction 91 | **P0** |
| protect (1,129) | **ward / shield** | 1,129 | Shield 494, Resist Energy 134, Sanctuary 123 | P1 |
| teleport (1,213) | **fold / step** | 1,213 | Translocate 309, Dimension Door 262, Interplanar Teleport 131 | P1 |
| movement (850) | **haste / fly / levitate** (three looks) | 850 | Haste 233, Fly 211, Freedom of Movement 86, Levitate 77 | P1 |
| control (647) | **dispel (unweave)** | 499 | Dispel Magic 499 | P1 |
| | **dominate** | 148 | Dominate 148 | P1 (shares mind control) |
| terrain (704) | **ground patch** (grease, mist, entangle) | 704 | Grease 97, Alarm 80, Mist 76, Entangling Flora 52 | P2 |

### 1.6 Consumables

| archetype | signals | docs (PC/NPC) | lift | examples | must take | state today | pri |
|---|---|---:|---:|---|---|---|---|
| **drink** (potion, elixir, mutagen, drug) | category potion/elixir/mutagen/drug/tea/food/medicine, or the traits | 942 (604/338) | 857 | Healing Potion 152, Elixir of Life 108, Darkvision Elixir 34, Antidote 25, Invisibility Potion 20 | flask → mouth, then the func's after-effect; material (vitality 214, water 104, poison 68) | `FORMS.restore` 344, `FORMS.support` 213, `FORMS.transform` 125, `FORMS.hinder` 75 (no drink motion at all) | **P0** |
| **scroll / wand** | category scroll/wand | 346 (189/157) | 256 | Scroll of Heal 10, Wand of Mental Purification 9, Magic Wand 9 | unroll/flourish, then the embedded spell's archetype | `FORMS.support` 54, `FORMS.restore` 54 (an item doc with no embedded spell resolves on its own; a real cast reaches the spell's look) | P1 |
| **talisman** (affix and snap) | category/trait talisman | 252 (223/29) | 220 | Bloodseeker Beak 8, Feather Step Stone 6, Potency Crystal 6 | snap + spark on the wearer | `FORMS.support` 168 | P2 |
| **poison** (apply/inject) | category/trait poison | 240 (128/112) | 160 | Lethargy Poison 16, Black Adder Venom 10, Giant Wasp Venom 7 | coat the blade (applied) vs. ingest/inhale | `bloom` 92, `FORMS.hinder` 61, `spit` 50 | P1 |
| **oil** (apply to item) | category/trait oil | 94 (87/7) | 89 | Oil of Unlife 13, Oil of Potency 7, Serpent Oil 5 | wipe along the weapon/armour | `FORMS.support` 55, `FORMS.restore` 26 | P2 |
| **snare / gadget / fulu / other** | rest | 1,152 (1,051/101) | 663 | Rations 126, Chalk 109 (silent:gear, correctly), Marvelous Miniature 15, Smokestick 12 | — | `FORMS.support` 411, silent:gear 303, `FORMS.hinder` 93, `net` 48 | P2 |
| **bomb** | (a Strike: §1.1) | 395 | 0 | Alchemist's Fire 45 | | own `bomb` | P1 |

### 1.7 Conditions and persistent damage

`CONDITIONS` (`conditions.mjs`) has an entry for each condition slug in the
packs, including `persistent-damage`. 16 of them are deliberately `NONE` (clumsy,
encumbered, enfeebled, fatigued, off-guard, stupefied, wounded, the five
attitudes and the four awareness states). The 43 condition documents and 78
bestiary-embedded conditions play `condition` (106) or are `silent:state` (14).
Persistent damage ticks resolve through `describeTick` (read.mjs). 1,321 playing
documents carry the `persistent` prop.

**Lift 0.** Conditions are not a coverage problem. The archetype work is the
**hand-off** from §1.2: Grab → `grabbed`, Trip/Knockdown → `prone`, Fear →
`frightened`, Paralyze → `paralyzed`, so that the action's last frame is the
condition's first frame instead of two unrelated effects.

### 1.8 Reactions

5,340 reaction documents. 1,252 are silent (821 of them `strike-plays`) and
3,804 are generic. By archetype:

| archetype | reaction docs | state today | archetype to build | pri |
|---|---:|---|---|---|
| Attack of Opportunity / Reactive Strike / Retributive Strike | 902 | silent:strike-plays 833 (correct: the Strike posts and plays) | a 0.2 s **snap cue** (eye-glint plus lunge) on the reactor before its Strike | P2 |
| harm reactions (unarchetyped) | 837 | `bloom`/`emanation`/`burst` | §3 | — |
| protect reactions (unarchetyped) | 804 | `FORMS.protect` | **ward / shield** | P1 |
| hinder reactions (unarchetyped) | 576 | `FORMS.hinder` | hinder split | P0 |
| Shield Block | 220 | `FORMS.protect` + shield motif | **Shield** (raise, impact, Hardness spark, dent if broken) | P1 |
| Nimble Dodge / Wing Deflection / parry | 212 | `FORMS.protect` 166 | **Dodge** (afterimage sidestep) / **Deflect** (the parry clang) | P1 |
| Ferocity / Final Spite / Diehard | 181 | `FORMS.protect` | **last stand** | P1 |
| Counterspell / Spell Reflection / Golem Antimagic | 61 | `FORMS.protect` / `FORMS.restore` | **counterspell** (glyph intercept) | P1 |
| Catch Rock | 33 | `FORMS.protect` | **throw / catch rock** | P1 |

---

## 2. Silent but should play

**1,935** documents (**1,712** unique by category + name, which matches
`silentReview`) cost an action, reaction or free action and play nothing
(`silent: "no-function"`). By category: feats 1,450, bestiary-action 174,
pcs-feat 167, actions 58, pcs-action 33, others 53. Clustered by the archetype
they were assigned to:

| cluster (archetype that covers it) | docs | unique | examples |
|---|---:|---:|---|
| unclustered (long tail) | 933 | 910 | Mutagenic Flashback, Bend Time, Defend Life, Inevitable Return, Stop, Remove Head |
| Strike modifier → wind-up then hand-off | 191 | 189 | Sailfish Strike, Army of One, Defensive Advance, Slam Down |
| spellshape → hand glyph | 154 | 124 | Shift Spell, Drain Bonded Item, (Mythic) Recharge Spell, Coven Spell |
| Stride / dash / flight | 64 | 56 | Flight, Goblin Scuttle, Imperious Retreat, Ghostly Stride |
| Command / formation | 59 | 24 | Act Together, Command a Thrall, Command a Construct, Form Up |
| charge / pounce | 57 | 45 | Pounce Mimicry, Skirmish Strike, Scout's Charge, Hurling Charge |
| last stand / remove a condition | 54 | 11 | (Mythic) Remove a Condition, Rampaging Ferocity, Heroic Recovery, Orc Ferocity |
| reload / draw / interact | 44 | 33 | Affix a Fulu, Thoughtful Reload, Call Gun, Conjure Bullet |
| **Rage** | 43 | 40 | **Mighty Rage**, Renewed Vigor, Furious Finish, Follow-Up Assault |
| dodge / deflect / parry | 40 | 32 | Dodge Away, Sidestep, Aldori Riposte, Twin Riposte |
| study / mark target | 37 | 24 | Clue In, Designate Ally, Slayer's Identification, Size Up |
| multi-strike flurry | 23 | 14 | **Flurry of Blows**, Two-Weapon Flurry, Whirlwind Strike, Twin Takedown |
| roar / battle cry | 20 | 19 | Battle Cry, Squawk!, Beckoning Dirge |
| Grab / Grapple | 18 | 17 | Reflexive Grapple, Opportunistic Grapple, Bear Hug, Seize |
| Aid / inspire | 17 | 17 | Perform a Trick, Unrivaled Performer, Courageous Onslaught |
| Feint / diversion | 16 | 13 | Twin Feint, Distracting Performance, Perfect Distraction |
| teleport / phase | 16 | 8 | Phase Out, Mist Escape, Phase Bullet |
| explode | 15 | 11 | Astonishing Explosion, Remote Detonation, Exploding Bullet |
| gaze | 13 | 13 | Eyes of the Enthralled, Watchful Gaze, Deadeye |
| Shove / Push · Disarm · Seek · medicine | 11 · 8 · 8 · 11 | | Knockback Strike · Disarming Twist · Sense Weakness · Emergency Medical Assistance |
| everything else (≤ 10 each: affliction, feed, shield block, counterspell, breath, escape, rend, AoO, demoralize, web, polymorph, stance, possess, trip, …) | 83 | | Empower Breath, Envenom Fangs, Master's Counterspell, Topple Foe |

**The long tail (933).** Of these, 786 are feats. 292 carry a class trait
(kineticist 36, gunslinger 22, rogue 22, monk 20, bard 14, …) and 63 more a
tradition trait. A **class flourish** archetype costs almost nothing:
`FLAVORS` already has rage, flurry, impulse, gun, finisher, spellstrike,
overdrive, composition, stance, hunt, sneak, judgment and more. Have it play
the class's flavor wind-up on the actor, with no target effect, whenever a
costed action has no function. That gives 355 a specific cue. The other 578
are genuinely bespoke and can stay silent.

**Passive that fires (1,458)**, separate from the 1,935: Frightful Presence
324, Regeneration/Fast Healing 375, aura-trait passives 759 (Stench 84, Vortex
19, Sacrilegious Aura 17). They play nothing because nothing posts a card.
Building them is a **trigger** job:
- an aura on token entry, or on the creature's first turn;
- regeneration from the healing message PF2e's fast-healing rule element posts
  at turn start. Check the message shape in a live session first.

**Keep silent** (2,818 passive senses: Void Healing 830, Telepathy 312,
Greater Darkvision 175, Rejuvenation 143, Tremorsense; and the 5 `secret`
actions). An animation there is noise or a leak.

## 3. Generic fallback hotspots

The 46,713 generic documents (§ How the numbers were made), by the archetype
that would replace the fallback:

| hotspot (today) | docs | replaced by | lifted to specific |
|---|---:|---|---:|
| `FORMS.hinder`, spells | 5,675 | hinder split (§1.5) | 4,750 (925 keep generic) |
| `FORMS.support`, spells | 4,847 | support split | 2,233 (2,588 keep generic) |
| `FORMS.hinder`, unarchetyped abilities | 3,445 | trait split: casting-trait 511, mind 320, voice 228, fear 151, body sweep 103, water 68, curse 64, visual 42; **no signal 1,958** (1,275 unique names) | 976 by trait (+511 if a tradition wind-up counts) |
| `FORMS.detect`, spells | 3,233 | detect split | 2,901 |
| `FORMS.conceal`, spells | 3,101 | conceal split | 2,265 |
| `HARM.bloom`, spells | 2,577 | family bloom (psyche 1,007, umbra 561, shock 372, physical 175, corrode 160) | 2,577 |
| `FORMS.neutral`, spells | 1,646 | neutral split (drawn over all 1,711 `FORMS.neutral` spells, 65 of which sit in other rows) | ≤ 917 |
| `FORMS.restore`, spells | 1,432 | **vital rise** | 1,432 |
| `bloom`/default, unarchetyped abilities | 1,297 | no signal 869 (642 unique); fire 121; "vulnerability" passives 119 (Vulnerable to Sunlight 17: arguably silent); mental 94; blood/boil 68; capsize/water 26 | ~309 by signal |
| `FORMS.transform` (polymorph / change shape) | 1,242 | **change shape** | 1,242 |
| `FORMS.teleport`, spells + abilities | 1,213 + 332 | **fold / step** | 1,545 |
| `FORMS.protect`, spells | 1,129 | **ward / shield** | 1,129 |
| `FORMS.hinder`, Grab family | 1,112 | **Grab** | 1,112 |
| `FORMS.protect`, unarchetyped abilities | 955 | ward / shield (reactive variant); tail sweep (Twisting Tail 29, Tail Lash 23) | 955 |
| drink consumables | 857 | **drink** | 857 |
| `FORMS.movement`, spells | 850 | haste / fly / levitate | 850 |
| `FORMS.terrain`, spells | 704 | ground patch | 704 |
| Strike modifiers | 683 | wind-up + hand-off | 683 |
| `FORMS.control`, spells | 647 | dispel 499, dominate 148 | 647 |
| charge/pounce, flurry, trip, push, trample, rend, rock | 490+430+249+251+136+113+94 | the named-ability set (§1.2) | 1,763 |
| Strike delivery fallbacks | 301 | lexicon entries (General Mayhem, Apocalypse Beam, Binding Contract…; coverage residue) | 301 |

## 4. Build order

The minimal set that lifts the most documents, P0 first. "Lifted" is the
generic count each one replaces, from the exclusive pass, so the rows add up.

| # | archetype | lifted | reuse | notes |
|---:|---|---:|---|---|
| **P0** | | | | |
| 1 | **Hinder split** (mind hex, mind control, fear, slow, + enfeeble, curse, paralyze, blind, sleep) | 5,726 (4,750 spells + 976 abilities) | one hex body, recoloured by trait; fear → `frightened` hand-off; slow/paralyze → condition hand-off | the largest bucket in the engine. Also fix the misfiled buffs (§5) first |
| 2 | **Family bloom** (rebuild `HARM.bloom` per family: psyche spike, umbra void-pulse, shock crackle, corrode hiss…) | 2,577 + 561 default abilities | one bloom shape × 12 family looks; Harm ↔ Heal share it (§ vital rise) | Daze (570) and Harm (235) alone are 805 docs |
| 3 | **Vital rise** (restore) | 1,512 (1,432 spells + 54 scrolls + 26 oils; the 344 restore potions are counted under drink) | the after-effect of **drink**; inverts to the void pulse on undead | Heal 421, Stabilize 169 |
| 4 | **Drink** | 857 | flask motion, then the func's form (restore/support/transform) | Healing Potion 152, Elixir of Life 108 |
| 5 | **Grab / Grapple** | 1,112 (+1,253 Strike riders, + Grapple skill action) | motif from the Strike (hand/jaws/coil/tongue); hands off to `grabbed`; Constrict (309) and Swallow Whole (173) read the same hold | Grab 806, Improved Grab 207 |
| 6 | **Maneuvers**: Trip/Knockdown, Shove/Push, Trample, Rend, Throw/Catch Rock | 843 (+ Trip/Shove/Reposition/Disarm skill actions) | one *body-check* core: Trip → `prone`; Push → slide along a vector; Trample = Push along a path; Rend = two rakes plus a tear | Knockdown 170, Trample 132, Rend 87 |
| 7 | **Strike prelude**: charge/pounce, multi-strike flurry, Strike modifier | 1,603 (490 + 430 + 683) | dash trail / count wind-up, then **hand off** to the Strike's own delivery; never a second hit | Draconic Frenzy 230, Pounce 64, Flurry of Blows 60 |
| 8 | **Rage** (+ **stance**, same self-empower core) | 207 + 150 | flavor `rage` exists; material by instinct; sustained shimmer | the user's own example: barbarian Rage, NPC Berserk, Blood/Fanatical Frenzy |
| 9 | **Strike rebuild with parameters** (jaws, rake, slam/fist, lash first) | 0 (+301 default fallbacks) | size scale (35% Large+), material ramp (22.6% non-kinetic), rider hand-offs | 6,530 docs in those four rows: the most-seen effect in play |
| 10 | **Support split, P0 parts** (light, fortune/sure strike) | 654 | — | Light 431, True Strike 99, Sure Strike 92 |
| 11 | **Invisibility** | 491 | conceal core | Invisibility 424 |
| **P1** | | | | |
| 12 | Change shape / polymorph | 1,242 | one cocoon-and-burst core; mist/swarm/shadow variants | Change Shape 390 |
| 13 | Fold / step (teleport) | 1,545 | — | Translocate 309, Dimension Door 262 |
| 14 | Ward / shield / Shield Block / dodge / last stand / counterspell | 1,129 + 955 + 263 + 240 + 264 + 104 | one ward core; Shield Block = Raise a Shield + impact | Shield 494, Shield Block 232 |
| 15 | Detect split | 2,901 | sweep core | Detect Magic 971 |
| 16 | Conceal split (illusion, darkness, blur) | 1,366 | — | Figment 206, Darkness 222 |
| 17 | Haste / fly / levitate | 850 | — | Haste 233, Fly 211 |
| 18 | Dispel (unweave) + dominate | 647 | dominate shares mind control | Dispel Magic 499 |
| 19 | Feed / drain, affliction seep, poison apply | 339 + 464 + 160 | one stream core (target → actor) | Drink Blood 50, Ghoul Fever 27 |
| 20 | Summon | 321 | — | Create Undead 52 |
| 21 | Triggers for passives (frightful presence, regeneration, aura) | 1,458 passive + 7 + 28 + 102 | renderer mostly exists (`aura`, `voice`, `FORMS.restore`); the work is the hook | Frightful Presence 311 |
| 22 | Demoralize, feint, disarm, escape, study/mark, possess | 107 + 81 + 52 + 51 + 160 + 103 | — | — |
| 23 | Scroll/wand unroll, swallow-whole gulp, breath size | 256 + 29 + 18 | — | — |
| **P2** | | | | |
| 24 | Class flourish for costed no-function actions | 355 | `FLAVORS` | §2 |
| 25 | Neutral split, terrain patch, talisman, oil, snare/gadget | 917 + 704 + 220 + 89 + 663 | — | Mage Hand 191 |
| 26 | Stride/dash, reload/draw, command, aid, spellshape glyph, explode, web, gaze, roar polish | 363 + 186 + 151 + 70 + 328 + 103 + 36 + 34 + 82 | — | — |

The P0 set (rows 1–11) lifts about **16,600** documents
(5,726 + 3,138 + 1,512 + 857 + 1,112 + 843 + 1,603 + 357 + 301 + 654 + 491 = 16,594).
That is 36% of the 46,713 generic. Rows 9–11 also cover the effects seen most
often in play, which doc counts underweight.

## 5. Side findings (do these alongside)

- **Buffs filed as hinder.** `pickFunc` reads the `mental` trait as hinder
  (`HINDER_TRAITS`), so **Heroism** (74), **Sending** (93) and **Dream Message**
  (93) are `func: "hinder"`, `why.func: "trait"`. A hinder split would give a
  buff a curse's look. Correct their function before (1).
- **Grab, Draconic Frenzy, Trample and Rend are `func: "hinder"`.** The
  function comes from `category` or `defense`. These abilities have no inline
  damage, so `actionDelivery`'s `ABILITY_NOUNS` branch (which requires harm for
  `stomp`/`rake`/`grasp`) is skipped and they fall to `FORMS.hinder`. The
  lexicon already names them; the guard is what stops it.
- **Mighty Rage and other rage follow-ups are `no-function`** (43 rage docs
  silent with a cost) while Rage itself is curated.
- **Secret actions must stay silent**: Hide, Sneak, Avoid Notice, Steal, Palm
  an Object and Sense Motive (`silent: "secret"`). Recall Knowledge is a
  secret-trait check too. **Seek also carries the `secret` trait** and plays
  `FORMS.detect` today. Decide whether a visible sweep is acceptable there
  (the act is public, the result is not) and make Recall Knowledge consistent
  with it.
- **Token movement is Foundry's.** Stride/Step/Climb/Swim are `no-visual` by
  design. A move archetype should only decorate (dust, a wing beat), never move
  the token.
- **Doc counts are per sheet.** 31,407 of the spell documents are
  `bestiary-spell` (NPC spell lists). Detect Magic (971) is mostly NPC prep,
  not combat traffic. Weigh PC-side numbers and the Actions-pack table (§1.3)
  when two items tie.

## Reproduce

1. `node tools/fx-coverage.mjs` → `.preview/fx-coverage.json`.
2. Walk the packs in the same order as `walkPacks` (skip the six `*-effects`
   packs; actors' embedded items; skip `spellcastingEntry`, `lore`, `effect`,
   gear types and NPC `weapon`). Emit `system.traits.value`,
   `system.actionType.value`, `system.category`, `system.attackEffects.value`,
   actor `type`/`size`, and join by index. Every row must match on pack, name
   and type.
3. Assign each document to the first matching archetype in the order of §1
   (conditions → Strikes by delivery → consumables by category → passive senses
   → breath/polymorph/summon/wall → named abilities and actions → traits →
   spells by delivery/func → ability fallbacks by func). Count total, PC/NPC,
   state (`silent:reason` | `FORMS.func` | delivery, with `(default)` when
   `why.delivery` is `default`) and lift (generic as defined above).
