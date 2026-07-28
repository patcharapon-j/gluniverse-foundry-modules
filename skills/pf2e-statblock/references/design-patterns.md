# PF2e Monster Design Patterns — mined from 380 third-party statblocks

Corpus: Battlezoo Bestiary (BB, 114 blocks), Bestiary: Strange and Unusual (SU, 105),
Bestiary: Elemental Storm (ES, 161). Levels −0 to 24, mode 8. Every example below is
cited `Name, BOOK level — Ability`. Mechanics are paraphrased, never quoted at length.

---

## 0. VOCABULARY FIREWALL — READ BEFORE USING ANY EXAMPLE

**BB and SU are PRE-REMASTER. Their vocabulary is obsolete and must never be reproduced.**
Verified by scan: all 114 BB and all 105 SU blocks carry an alignment trait line; 39 use
`negative`/`positive` damage; 36 use `flat-footed`; 145 use spell-school traits; 18 use
`Attack of Opportunity`. ES is Remastered (55 blocks use `void`, 38 `vitality`, 28
`off-guard`, 13 `Reactive Strike`).

Mandatory translation when reusing any BB/SU idea:

| Obsolete (BB/SU) | Use instead |
|---|---|
| negative damage / negative healing | void damage / void healing |
| positive damage / positive healing | vitality damage / vitality healing |
| flat-footed | off-guard |
| Attack of Opportunity | Reactive Strike |
| Nth-level spell | Nth-rank spell |
| alignment traits (LG/N/CE…) on the trait line | delete; use `holy`/`unholy` only if the creature is genuinely sanctified/profane |
| `evil` / `good` damage and weaknesses | `unholy` / `holy` |
| spell school traits (necromancy, evocation, enchantment, abjuration, conjuration, transmutation, divination, illusion) | delete; keep only real traits (mental, emotion, fear, void, light, etc.) |
| "Athletics check to Grapple/Shove/Trip" | just "Grapple"/"Shove"/"Trip" (the action already names the skill) |
| `Improved Grab` | still valid; `Grab` unchanged |

**Flagged as NOT cleanly portable — I was unsure and you should redesign, not translate:**

- **`lawful` / `chaotic` damage and weaknesses** have no Remaster equivalent. Arcarayut,
  BB 10 deals a law-flavoured damage rider and has a chaos weakness; its regeneration is
  switched off by chaos. There is no drop-in replacement. Rebuild as `spirit` damage, or
  as a weakness to a specific *behaviour* (see §5.3), not to an alignment.
- **Kharozat, BB 20 — Variable Alignment** (its immunity and weakness 20 swap depending on
  which alignment-flavoured ability it just used) is structurally alignment-dependent. The
  *idea* survives (a rotating immunity/weakness keyed to its own last action — see
  Invulnerabug and Neoctri in §1.7); the alignment implementation does not.
- **Askyron, SU 18 — Alien Morality** ("whichever alignment is worst for it") is
  pre-Remaster and also GM-fiat. Discard both the vocabulary and the mechanic.
- BB/SU **rejuvenating undead** all carry `negative healing` plus school traits on the
  Rejuvenation line. The *quest-condition* design (§5.5) is excellent and portable; the
  trait line is not.

---

## 1. RESOURCE AND STATE ENGINES

The single biggest differentiator between a stock monster and a memorable one. ~1 in 6
blocks in this corpus runs a tracked quantity across rounds. Seven distinct shapes:

### 1.1 Battery — store incoming damage, then discharge it
The creature converts a damage type it is exposed to into stored potential, then spends it.

- **Volt Ram, ES 2 — Store Charge / Discharge:** any electricity effect (or its own charge
  move) charges its wool; Discharge dumps it as a 10-ft emanation. Binary at low level.
- **Living Lightning Rod, ES 15 — Voltaic Charges:** starts the fight at charged 2, caps at
  charged 3, and *charging past the cap forcibly self-detonates* for massive damage, then
  drops it to zero and stuns it. Its own Gather Charge feeds the bomb. The entire encounter
  is the party deciding whether electricity is a weapon or a gift.
- **Ice Zuggle, BB 2 — Elemental Absorption:** absorbs cold as HP then temporary HP;
  exceeding 15 temp HP destroys it in a burst. Same overflow idea at level 2.
- **Thunderhead Willow, SU 9 — Lightning Collection / Explosion:** absorbing electricity
  charges its Strikes; the once-per-day dump *downgrades the creature* afterward (it loses
  its electricity rider and two abilities until recharged).

**Reach for it when:** the creature's element is something the party is likely to bring.
The battery turns a resistance line into a decision. **Always include the overflow or the
spend-down**, or it is just a resistance.

### 1.2 Counter that converts at a threshold
A number climbs; when it caps, it becomes something else. This is the cleanest engine shape
because the cap is the payoff and the telegraph at once.

- **Time Golem, SU 21 — Shorten Timeline:** first damage each round pushes doomed +1 up to
  doomed 3; further increments *convert into flat force damage instead*. The counter caps
  into damage rather than escalating forever.
- **Endless Growth, ES 9 — Infectious Growth:** an attached tumour forces a save each turn,
  drained +1 per failure; at drained 4 the tumour drops off and grows a new monster.
- **Vengeful Crab Bowl, ES 6 — Spill Vulnerability:** each time it's knocked prone it gains
  a cumulative drained *and* bursts fire. The counter is player-driven — they choose how
  much to feed it.
- **Eternal Symphony, ES 15 — Crescendo:** +1d6 sonic to its sonic effects, cumulative each
  *consecutive* turn it re-uses it, capped at 4d6. Breaking the chain resets it — so the
  party's job is to make it do something else.

**Reach for it when:** you want a fight with a visible clock. Cap it, and state what
happens at the cap.

### 1.3 Consume — kills, conditions, or objects are the fuel
The monster gets stronger from something that is *already happening* at the table.

- **Necrosis Engine, ES 10 — Absorb Soul:** any living creature dying within 30 ft makes it
  quickened for a minute and blocks that creature's resurrection while it lives.
- **Hatemonger, ES 13 — Echo Chamber:** requires two or more frightened creatures nearby;
  damages all of them and converts the largest single hit into temporary HP. Fear is ammo.
- **Nightmare Shade, ES 8 — Consume Fear:** eats an adjacent creature's frightened value for
  temp HP, reducing the condition by 1 regardless of the save. Note the elegance: it *helps*
  the victim slightly, so it isn't a pure death spiral.
- **Necroflesh Monarch, BB 15 — Consume the Dead:** three uses per round with decaying
  returns (30 / 20 / 10 HP). Diminishing returns stop it from snowballing.
- **Hemadae Queen, ES 11 — Absorb the Fallen:** eats her own dead drones to heal. The
  party killing minions feeds the boss.

**Reach for it when:** you want the party's default tactics to have a cost. Best paired
with a visible "stop feeding it" alternative.

### 1.4 Bank-and-release — spend actions now, cash them later
- **Emirad, ES 10 — Resounding Refrain:** Sustains to bank actions; the first turn it stops
  Sustaining, it fires that many Strikes at once, ignoring existing MAP. A charge-up the
  party can see coming and can interrupt.
- **Cosiadifex, ES 17 — Ominous Wingbeat:** stirs a tornado that *appears at the start of
  its next turn*. Pure telegraph — an entire round to react.
- **Shale Behemoth, BB 18 — Hurl Supersonic Shard:** shards land, hum audibly and debuff
  for one round, then detonate on its next turn.
- **Sepsis Serpent, ES 6 — Septic Invasion / Activate Invader:** plants a dormant clone
  inside a creature for later remote detonation; the clone dies inert after 24 hours.

**Reach for it when:** you want a big number without a save-or-die. The round of warning is
the design.

### 1.5 Inventory — the resource is a physical, targetable thing
- **Ferropaceon, BB 10 — Metallic Carapace:** its Hardness *equals* the Bulk of scrap stuck
  to it (cap 12). Hyperpolarization refills it by disarming everyone nearby; Repulsive
  Barrage spends the whole pile as 1d6 per Bulk. An adjacent creature can Interact + skill
  check to strip one piece. Fully player-manipulable in both directions.
- **Pilfermin, ES 9 — What Else Do I Got? / Fair Trade?:** draws a trinket, and the trinket
  is literally the ammunition for its defensive reaction (see §3, "the bribe").
- **Eyesore, BB 3 — Steal Eye / Stolen Vision:** its senses upgrade with the number of
  stolen eyes it holds (4 = low-light, 6 = darkvision, 8 = all-around). Eyes are recoverable
  from its corpse within an hour.
- **Rictus Mask, ES 7 — Echoes of the Damned:** manufactures statue objects (AC 20, 10 HP)
  that are consumable ablative charges for its damage-reduction reaction.

**Reach for it when:** you want the resource to be attackable. This is the most
player-legible engine shape in the corpus.

### 1.6 Self-cost — the engine runs on the monster's own health or freedom
- **Chronoceros, SU 7 — All-Seeing Eyes:** every ability it uses costs it mental damage.
  Its whole kit runs on a self-damage budget, so it can kill itself by trying too hard.
- **Laelaps, ES 6 — Relentless Pursuit:** sheds any one restraining condition by taking a
  cumulative drained (max 4). Usable even while unable to act. Escape has a price.
- **Vaspertil, SU 10 — Proliferate:** spends temp HP *and* self-inflicted slashing damage to
  grow an arm (max four); returning to full HP sheds every arm and unwinds the engine.
- **Bolbalos, ES 9 — Blundering Slam:** the big AoE also stuns it and locks itself out.

**Reach for it when:** the monster should feel reckless. This is how you give a creature a
strong ability without a Frequency line.

### 1.7 Adaptive — it rewrites its own defences in response to you
- **Invulnerabug, ES 16 — Adaptive Immunity:** one action to declare immunity to a chosen
  damage type, persisting until reused. **Neoctri, ES 5 — Adaptive Resistance** is the
  reaction version at a third the level.
- **Thousand Skins, SU 20 — Shifting Defense:** on taking damage, gains resistance to *that*
  type for a minute, replacing the previous one. Counterplay: rotate damage types, or use
  the one thing it can't adapt to.

**Reach for it when:** you want to punish a party that only ever does one thing. **Always
name the exception** (Thousand Skins keeps a cold iron weakness) or it becomes a slog.

---

## 2. MODE SWITCHES

### 2.1 Breakable armour — and the important inversion
The base template appears verbatim ~8 times: Hardness plus higher AC, broken at half HP
*or on any critical hit*, dropping Hardness and AC. It is fine but inert. What the good
versions do is **change what the creature can do**, not just its numbers:

- **Monolithic Cube, ES 9 — Construct Armor + Mercurial Quickness:** breaking it costs it
  Hardness and AC but *grants quickened and a new ranged Strike*. Hurting it makes it
  more dangerous. This is the best version of the template in the corpus.
- **Iron Fern, BB 2 — Metal Coating:** on breaking, its fire *resistance* flips to fire
  *weakness*. One line, total tactical reversal.
- **Braincase, ES 13 — Cranium Shell:** first time it would drop to 0 HP it goes to 1
  instead and the shell shatters; while exposed, *any* damage kills it regardless of HP.
- **Arahabaki, ES 15 — Pottery Armor:** breaking shrinks its healing aura but doubles its
  fly Speed; it can rebuild in 10 minutes of meditation.
- **Zweiblade Guardian, SU 9 — Twin Body:** breaking splits it into two halves sharing one
  HP pool, actions and MAP; it gains quickened but rolls saves twice and takes the worse.

**Rule:** if the broken state is only "worse numbers", cut it. Make breaking it a *choice*.

### 2.2 HP-threshold phases
- **Matrona, BB 15 — Mother Suit:** shrinks Gargantuan → Huge at 200 HP and Huge → Large at
  100 HP; each step loses 5 ft of reach and gains 10 ft of Speed. Visible, describable,
  and it changes the tactical problem twice.
- **Corpsesewn Colossus, BB 12 — Malfunctioning Furnace:** below 100 HP its furnace
  detonates every round on its own turn — *and damages the colossus too*, so the phase
  visibly kills it. The players can see the fight ending.
- **Coenosteum Knight, ES 8:** one ability requires 61+ HP, another requires 60 or fewer.
  Same creature, two halves of the fight. (But see §9 — invisible thresholds.)

**Reach for it when:** you want a boss with acts. Give each phase a *sensory* description
so the players know a threshold was crossed.

### 2.3 Voluntary stance with an explicit tax
- **Knotsman, BB 7 — Uncoil:** +2 AC and +10 ft Speed, squeezes through a one-inch gap —
  but slashing weakness triples. One action to exit.
- **Testudan, SU 19 — Shell Defense:** big AC bump, but it can only Shell Slam, Stand, or
  emerge; being knocked prone in the shell removes the bonus *and* doubles the cost to stand.
- **Braincase, ES 13 — Six Palms Stance:** grows a force torso, becomes Gargantuan, unlocks
  a new Strike and a second reaction — which must be spent on a *different* action than the
  first. Breaks if it Casts a Spell.
- **Vengeful Crab Bowl, ES 6 — Boil Over:** −1 AC for a minute in exchange for a fire rider
  and retaliation damage.

**Rule from the corpus:** every good stance costs an action to enter *and* names a way out.
Stances with no exit condition are traps for the GM.

### 2.4 Environment forces the mode
The party controls the switch by controlling the room.

- **Skotogelia, BB 5 — Solidifying Light:** in bright light it *loses* the incorporeal trait
  and all its resistances. Carry a torch.
- **Othruni, BB 7 — Photosensitive Moss:** bright light disables its two spore abilities,
  its ranged Strike, and all its bonus poison — and simultaneously removes its fire weakness.
  A genuine trade, not a switch-off.
- **Splintertooth, ES 8 — Shadow Step:** exposure to bright light triggers a reaction that
  teleports it away into darkness. Light doesn't kill it; it relocates the fight.
- **Midnight Lily, SU 3 — Desiccation:** carry no light and it stays slowed with a Speed
  penalty.
- **Shadowblooded, ES 19 — Aura of Noon and Midnight:** *it* sets the light level, and the
  light level determines which energy heals it — bright means vitality heals it, dark means
  void heals it, dim means neither works. The party must fight the lighting.

**Reach for it when:** you want the terrain to matter without writing a hazard.

### 2.5 Object form — the monster is furniture
The single most-repeated "memorable in one line" device in the corpus (see §7).

- **Ghostwriter, BB 6 — Inhabit Text:** possesses a *book* rather than a creature; the book
  then carries its full statline, and destroying the book destroys it. The party fights the
  library.
- **Butcher Booth, BB 12 — Mimic Structure:** three actions to become any Large-to-Gargantuan
  object with an automatic Deception result; creatures can walk *inside* it, which triggers
  its reaction.
- **Coromn, BB 6 — Accursed Coronation:** a devil that lives inside a crown, cannot Strike
  while inside, and rules through whoever wears it.
- **Coppersmyf / Silversmyf / Goldsmyf, SU 4/6/10 — Disanimate:** become an inert set of
  bowls, silverware, or coins with no Speed and no actions — but gain a bespoke retaliation
  reaction for anyone who touches a piece.

**Key craft note:** all of these give a **fixed, stated Deception result** (an automatic 30,
38, 39…) rather than a hidden roll. The disguise becomes a legible, beatable number.

### 2.6 The two-state elemental flip
One binary flag rewrites the aura, the damage type, and the rider all at once.

- **Tabilda, ES 3 — Heartflame:** a lit/unlit pilot light, maintained by a flat check when
  damaged, auto-extinguished by air/cold/water. Lit, it has a cold-resistance aura and fire
  Strikes; out, it has a fear aura, cold Strikes, and takes persistent cold itself.
- **Mercurial Knight, SU 3 — Mercurial Form / Reform:** solid vs. liquid changes AC, saves,
  Speed, Strike, and *swaps which physical damage type it is weak and resistant to*. Reform
  is a reaction that flips the state **before** the damage applies.
- **Metallic Phase Elemental, ES 6 — Phases of Matter:** gas / liquid / solid, each gating a
  different Strike, a different action, and a different movement mode.
- **Fylaka, BB 6 — Swap Energy:** a persistent toggle setting whether its breath deals void
  or vitality. (Remaster restatement; BB prints positive/negative.)

### 2.7 The don't-die reaction
Four flavours, all with different costs — pick the one that says something:

- **Unbound Arboreal, ES 15 — False Felling:** survives at 1 HP, deals a line of damage on
  the way down, and permanently gains a wounded point. **Requires wounded 2 or less** — so
  it can only do it while it still has slack.
- **Interstitial Sludge, ES 15 — Retreat to the In-Between:** at 0 HP it is *banished*
  rather than killed, casting confusion on its way out. The party wins but doesn't kill it.
- **Living Blade, BB 8 — Weapon Form:** at 0 HP it doesn't die, it reverts to being a magic
  scimitar until it re-summons its wielder. Its corpse is loot that is also still a monster.
- **Shadow Thief, BB 2 — Darkness Dissolution:** once per *week*, stays at 1 HP and
  teleports to darkness within 1,000 ft — and is destroyed outright if there is no darkness.
  A survival tool the party can pre-empt by lighting the room.

---

## 3. TRIGGER AND REACTION DESIGN

215 explicit `Trigger` clauses across 186 of 380 blocks; 29 blocks have two or more.
This is where third-party design most visibly diverges from stock bestiary design: stock
monsters trigger off "a creature within reach uses a manipulate action." These trigger off
*narrative events*.

### 3.1 The trigger taxonomy actually used

**On being targeted (pre-resolution) — resolves before the roll matters**
Shale Spitter BB 2 (merely *targeted*, not hit); Moonlight Owl ES 15 (attacker rolls twice,
takes lower); Weatherbane ES 3 (specifically a *physical ranged* attack, and only if it is
aware and not off-guard); Xotlxotl SU 1 (invisibility resolves **before** the Strike,
movement after — note the explicit ordering).

**On being hit, with a damage-type or threshold qualifier**
Othruni BB 7 (10+ slashing or piercing); Mogadb BB 3 (30+ slashing in a round); Matrona
BB 15 (10+ from one source, and the effect *scales with the amount*); Ouveliste ES 12
(piercing or slashing only); Drumcap ES 1 (bludgeoning only); Volt Ram ES 2 (**an unarmed
attack or a metal weapon** — trigger keyed to weapon material); Ferrofluidic Ooze ES 9
(slashing specifically); Blood Fern ES 12 (**a creature bites into it**).

**On a critical result specifically**
Jungle Mantis Swarm BB 8 (a crit against it is downgraded to a plain success); Rope Golem
BB 6 and Sklaggan BB 5 (attacker critically *fails*); Bolbalos ES 9 (crit failure redirects
the attack at a different target and the attacker rerolls); Pollen Brawler ES 6; Bloodsport
Remnant SU 10 (it shrugs off your critical hit as showmanship and frightens you for trying).

**On a save or check result**
Sapphire Drake BB 7 (**it fails its own Fortitude save**, and improves the result one
degree); Kabrus ES 5 (a creature fails a save to reduce its own sickened value); Harrophage
ES 20 (a creature fails a save against one of *its* afflictions); Crystal Chimling ES 2 and
Muse Wyrm ES 11 (an **ally** fails — a buff-reaction, not a defensive one); Wellwisher ES 9
(**the wellwisher itself rolls a 3 or a 13**).

**On movement**
Reaver Beaver BB 5 (**a creature within reach uses the Stand action** — the most specific
trigger in the corpus); Thunderhead Willow SU 9; Genius Loci ES 9 (a creature Strides, and
a crit failure redirects the whole Stride as forced movement); Braincase ES 13 (a creature
*moves closer*); Aestival ES 6 and Unbound Arboreal ES 15 (a creature **leaves a square**
during a move action); Laelaps ES 6 (its Hunt Prey target Strides *or teleports*); Gorehed
SU 5 (a foe **ends their turn** within its reach); Lingering Regret ES 9 (any Step or Stride
within 60 ft, rewound to the starting square on a failed save).

**On a spell or magical effect, trait-gated**
Curtain Caller BB 10 (a spell with the auditory or sonic trait); Fractrix ES 12 (an effect
with the **light** trait); Tempestuan ES 17 (an **air**-trait effect); Amphitwister ES 11
(an action with the **emotion** trait — it disrupts your buffs); Eternal Inventor ES 17 and
Handless Mage SU 9 (any **manipulate** action within 60 ft); Staccarix ES 17 and Hemadae
Queen ES 11 (any **concentrate** action); Interstitial Sludge ES 15 and Dimension Ooze ES 9
(a **teleportation** effect); Auroplasm SU 15 (targeted by electricity — and it *redirects
the effect to a different creature*).

**On another creature's reaction, or on your own prior effect**
Unarmored BB 12 — Deny Shield: a creature within 30 ft uses Shield Block, and the shield is
dematerialised so the block is bypassed. Reacting to a reaction.
Quietus ES 12 — Hush: a creature affected by *its own* silence spell successfully Strikes
it. Whalefeller ES 11 — Dart Away: only against an attacker currently taking persistent
damage from its own harpoon.

**On knowledge, speech, performance, and social acts**
Shadow Thief BB 2 (its merged host attempts to **Recall Knowledge**); Vengewhisper SU 11
(its designated victim Recalls Knowledge; frightened scaled to how much they learned);
Orb of Insanity BB 15 (targeted by a divination spell with the mental trait); Testudan
SU 19 (a creature in reach **attempts a skill check**); Storm Conductor ES 9 (a creature
**fails a Performance check** — it electrocutes you for playing badly); Ceasg ES 14
(a Performance check against its Will DC can fascinate it out of the fight); Spectral
Conductor ES 8 (**initiative would be rolled** — everyone rolls Performance instead).

**On objects and treasure**
Keepsake Warden BB 9 — Token Casting: one of its three designated trinkets, up to 120 ft
away and possibly out of sight, **gains the broken condition**; it instantly knows and
free-casts a defensive spell. Whalefeller ES 11 — Reclaim Harpoon: its harpoon is within a
mile and unheld. Pilatatry ES 4 — Strange Taste: a creature within 10 ft **Interacts to
consume food or drink**, including potions.

**On death — its own or anyone's**
At 0 HP: Arcarayut BB 10, Hearth Hound BB 4 (its death howl originates **from its hearth**,
not its body), Vigil Flame ES 5 (heals allies, damages foes), Wripie ES 2 (see §7),
Bog Bomber SU 10, Parasite Husk BB 3.
On *someone else's* death: Cloaked Cadaver SU 10 (any living creature dies within 20 ft);
Necrosis Engine ES 10; Unscaled Tyrant SU 4 (**a kobold ally is slain**, and it rises as a
skeleton at the same initiative); Autumnal ES 4.
Inverted: Demon Shepherd SU 10 — Flock Vulnerability: it takes mental damage every time a
weaker demon ally drops. Its own summons are its HP bar.

**On environment and physical circumstance**
Giant Sea Squirt BB 5 (**being removed from water** — the trigger requires a player to pick
it up); Skyheart ES 14 (**the skyheart falls**); Refulgent Prismite ES 10 (it is inside
*another* prismite's light radius — reactions that chain outward between identical
monsters); Quantum Hummer ES 5 (it *hears* another hummer's song, propagating the chain).

### 3.2 Rules the corpus follows

1. **Trigger off something a player did on purpose**, not off a die roll they don't control.
   Reaver Beaver punishing the Stand action is memorable because standing up was a choice.
2. **Name the observation, not the internal state.** "A creature moves into its space" beats
   "a creature is unaware of it."
3. **State the ordering** when a reaction interrupts. Xotlxotl BB 1 spells out that
   invisibility applies before the Strike and the Step after.
4. **A reaction that fires on *another creature's* reaction** (Unarmored BB 12) is a strong,
   rarely-used shape. So is a reaction that spends an **ally's** reaction (Rothive ES 4 —
   a wasp swarm suicides into it, transferring its remaining HP).
5. **Turn-boundary reactions are a de facto fourth action.** Celestial Geometry SU 14
   (turn ends), Tahagata SU 6 (turn begins), Shrubmerged ES 6, Unbound Arboreal ES 15
   (season pointer advances at turn start). Use this instead of granting quickened.

---

## 4. NAMING GRAMMAR

Measured over ~900 extracted ability names: **74% are exactly two words** (670/900);
13% are one word; 10% are three. Four-plus words is 2.7% and always a deliberate joke.
Possessives appear 21 times; "X of Y" 39 times.

### The shapes, and what each one signals

| Shape | Signals | Examples |
|---|---|---|
| Bare imperative verb | a stance or mode toggle | Uncoil, Flatten, Discorporate, Disanimate, Curl, Refract, Juxtapose, Expunge |
| Verb + object | an activated action | Steal Eye, Gouge Eyes, Deny Shield, Eat Curse, Drink Water, Crank the Heat, Consume Fear, Reforge Hammer, Tidy Up |
| Adjective + noun | a passive, aura, or damage rider | Malicious Tears, Crushing Vertigo, Cacophonous Fury, Grisly Trophies, Booming Voice, Cranium Shell |
| Possessive / X-of-Y | the dramatic ultimate | Sorrow's Howl, Killer's Possession, Tyrant's Command, Curse of Lonely Death, Glimpse of the Future, Autumn's Abscission |
| "X Vulnerability" / "Weakness to X" / "X Dependent" | **a player-facing signpost that a lever exists** | Axe Vulnerability, Water Vulnerability, Vulnerable to Grease, Prone Vulnerability, Foot Vulnerability, Bite Vulnerability, Fear Vulnerability, Sobriety Vulnerability, Time Magic Vulnerability, Mountain Dependent, Domain Dependent, Waterbound, Stormbound, Grounded |
| Spoken dialogue | a trickster, fey, or construct with a personality | Don't You Dare!, Fair Trade?, What Else Do I Got?, Put That Away!, Not That One!, Mine Now, Get Them!, Amp it Up!, Fire the Omnicannon!, Listen to my Song!, Now You Know How I Feel |
| Domain jargon lifted whole | instant legibility for a themed creature | Crescendo, Accelerando, Ritenuto, Fortissimo, Dissonance, Encore, Woodwinds/Brass/Strings/Percussion |
| Pun / portmanteau | a comic or one-note creature | Frogsplosion, No-Sell, Clothesline, Phantasmorgasbord, Split Ends, Fool's Gold, Light Snack, Half Life, Retroactive Continuity, Twice for Bad Luck |
| Verb doublet joined by "and" | a house tic on service-themed constructs | Prepare and Serve, Project and Serve, Protect and Preserve, Twist and Snap, Munch and Cover |

### Four rules worth stealing

1. **Name the *fiction*, not the effect.** "Belladonna Distraction" and "Boisterous Braggart"
   tell you what the creature is. "Cone of Poison" tells you nothing.
2. **The vulnerability naming convention is doing real work.** Putting "Vulnerability" in the
   title is how the designers hand the players a lever without a sidebar. Use it whenever a
   creature has a deliberate soft spot.
3. **Name the affliction after the creature; do not name the ability after the creature.**
   Near-universal across all three books: Feld Hag Tar, Gouger Toxin, Desiccation Venom,
   Kunthalaka Neurotoxin, Sepsis Serpent Venom — but the *actions* get evocative names.
4. **Reuse a keyword across a family verbatim** to signal kinship: every shale creature has
   Rock Stride; every salt creature has Fluidsense, Water Vulnerability, Ambush Attackers and
   Desiccation Venom; every seasonal fey has an "X Cloak".

Dialogue-style names appear **only in ES**, the newest book. They are the highest-impact,
lowest-cost way to give a creature a voice — and they cost zero mechanical complexity.

---

## 5. COUNTERPLAY DESIGN

This is what separates this corpus from a generic third-party bestiary. Nine devices:

### 5.1 The player-facing minigame — an action, a DC, and four degrees
The gold standard. The monster's statblock contains a procedure *the players* execute.

- **Afneith, BB 8 — Belladonna Distraction:** spend an Interact to offer a dose of
  belladonna, then a DC 25 Survival check. Four degrees: critical success poisons it
  outright; success gives it a penalised save; failure does nothing; **critical failure lets
  it spend a reaction to bite you**. It becomes immune to the trick for an hour. This is the
  single best-written "here is your out" in the corpus — it has a cost, a risk, a payoff,
  and a cooldown.
- **Lost Savior, BB 11 — Ancient Reminiscence:** one action and a Deception/Diplomacy/
  Intimidation check to remind the undead of its heroic past, making it off-guard.
- **Skyheart, ES 14 — Turbine Vulnerability:** an adjacent DC 37 Disable a Device stuns it;
  disabling both turbines removes its turbine Strikes for 10 minutes. **Critical failure
  eats a free Strike** — a genuine risk/reward check.
- **Boe Erchitu, SU 7 — Cursing Candles / Steel Horns:** pinch out its candles (unarmed
  attack vs. AC, or a skill check) to strip its curse ability *and* leave it drained and
  clumsy. Or shear both horns off in a single slashing Strike — Hardness 9, 36 HP, fully
  restored if not one-shot — and the cursed man walks free. The fight has an alternate
  win condition written into the statblock.
**Design note:** four degrees of success matter here. A binary check is a tax; a four-degree
check is a decision.

### 5.2 The removable rider — the debuff has an in-fight cure
- **Salt Mother, BB 10 — Barbed Spines:** one action, DC 26 Medicine, to pull spines from
  yourself *or an adjacent ally*. Failure still removes them but costs 2d8 piercing.
- **Endless Growth, ES 9 — Infectious Growth:** DC 31 Medicine by the victim or an ally,
  *or* void damage, *or* critically succeeding the ongoing save. Three separate outs.
- **Yomhibdi, BB 4 — Flick Ink:** blindness wiped off with two Interact actions (three on a
  critical failure), by the victim or an adjacent ally.
- **Writer's Block, SU 5 — Forced Reading:** once per turn, a DC 20 Society check to
  Decipher Writing ends the persistent damage; a critical success grants an hour of immunity
  *and stuns the monster*. Explicitly **exempted from the creature's own counter-ability**,
  so the out can't be countered. That exemption clause is excellent craft.

**Rule:** always allow an *adjacent ally* to perform the cure. It turns a solo problem into
a party decision.

### 5.3 The concept-tied weakness — the fiction tells you the answer
- **Rope Golem, BB 6 — Vulnerable to Grease:** a 1st-rank spell frees everyone it has
  grabbed and shuts off its Grab, and the entry explicitly permits targeting the golem even
  though it isn't an object. Someone thought about why a rope golem is a rope golem.
- **Salt Stalker family, BB 4–10 — Water Vulnerability:** a bucket of water slows them.
- **Ugadalu, ES 7 — Fear Vulnerability:** it frightens itself on seeing its own reflection.
  A mirror is a weapon.
- **Kayman Bacoo, SU 4 — Rum Weakness:** offer it alcohol; it cannot refuse, saves one
  degree worse, and enough of it knocks the creature out for hours.
- **Quietus, ES 12 — Performance Vulnerability:** a silence demon that takes mental damage
  from a successful Performance check made to aid an ally.
- **Auroplasm, SU 15 — Base Metal Vulnerability:** takes extra damage from **ordinary**
  metal weapons, and *not* from silver or cold iron. A deliberately inverted expectation.

### 5.4 The off-body phylactery
- **Keepsake Warden, BB 9 — Keepsake Items / Tethered Immortality:** it designates up to
  three trinkets; while one is within 120 ft it has fast healing 10 and death-effect
  immunity. Break one to strip that. **And: *faerie fire* cast on the warden makes the
  keepsakes glow.** A built-in detection hint, so the puzzle is solvable.
- **Ceasg, ES 14 — Life Shell:** an object with Hardness 10 and 40 HP; destroying it also
  deals heavy damage to the ceasg.
- **Crystal Chimling, ES 2 — Crystal Chimes:** its regeneration *equals its current number
  of chimes*, and the chimes are separately targetable 5-HP objects. A sever-the-parts
  puzzle at level 2, entirely visible.
- **Whalefeller, ES 11 — Bone Harpoon:** destroying its weapon sickens it.

**Rule:** if the phylactery is hidden, the statblock must say how it can be found.

### 5.5 The quest-condition rejuvenation
A whole family in BB and SU, and it is the best *narrative* pattern in the corpus. The
creature reforms in 2d4 days at a bound site and can only be permanently destroyed by a
specific, dramatically satisfying act:

- **Ghostwriter, BB 6** — publish its manuscript to a hundred readers.
- **Dishrag Dervish, BB 4** — clean the tavern it haunts.
- **Curtain Caller, BB 10** — perform the interrupted show to completion on its stage.
- **Unarmored, BB 12** — earnestly gift it a suit of armour worth 1,400+ gp; the armour
  vanishes with the departing spirit.
- **Hieroglyph Scorpion, BB 10** — destroy the mural it guards, which also **frees every
  victim petrified into it**. The out and the rescue are the same action.
- **Storm Conductor, ES 9** — perform a flawless, inspiring concert.

**Reach for it when:** the encounter should not end with a corpse. **Caveat:** the vaguer
the condition, the less runnable it is — see §9.

### 5.6 Temporary immunity as the pressure valve
75 uses across 69 blocks. The corpus treats this as near-mandatory on any save-based
lockdown. Three tiers observed:

- **Regardless of result** — the most generous, used on hard control: Hearth Hound BB 4,
  Pilfermin ES 9, Muse Wyrm ES 11, Amutu ES 2, Forgemaster ES 23. Use this when a failure
  would take a player out of the fight.
- **On a success or better** — the default: Fractrix ES 12, Golden Coinivore Swarm SU 8,
  Ribcage Vine SU 5, Coquecigrue BB 8.
- **On a critical success only** — for weak or repeatable effects: Thousand Skins SU 20.

Durations run 1 round / 1 minute / 1 hour / 24 hours. **Watch the scoping:** some grant
immunity to *that creature's* version, some to *any* creature of the species (Cabyar ES 5).
Be explicit — the corpus is inconsistent here and it causes table arguments.

### 5.7 Telegraphs — the round of warning
See §1.4. Additionally: **Sapphire Drake, BB 7 — Harden Scales** improves a failed save by
one degree but visibly costs it 10 ft of Speed for 1d4 rounds, so the players can *see* the
save-fixer being used. **Chamber Ooze, BB 5 — Integrate** takes a full minute and it must
leave openings into the room.

### 5.8 Inverted counterplay — the obvious answer is the wrong one
Use sparingly; one per adventure, not one per monster.

- **Salt Scorcher, BB 6 — Hot Water:** its burning grease detonates on contact with water,
  and the flat check to douse it auto-fails. The intuitive fix is the detonator.
- **Attunement Arsenal, ES 13 — Sonic Healing:** sonic effects strip its slowed condition
  and heal it for half.
- **Liquefied, ES 8 — Slow Movement Weakness:** a **slowed** attacker ignores its resistance
  and doesn't trigger its retaliation. Slowing your own fighter is the counterplay.
- **Congealed Laughter, SU 15:** it has a slashing weakness — and slashing damage is exactly
  what makes it split. The weakness pulls players toward the bad choice.

### 5.9 The bribe / the aggro button — counterplay that isn't a check
- **Pilfermin, ES 9 — Fair Trade?:** when hit while holding a trinket, it offers the trinket
  for its life. The attacker's Strike *misses* unless they save — but if they accept, they
  gain a bonus to AC and saves against the pilfermin for as long as they hold it. A
  reaction that is also a negotiation.
- **Bloodsport Remnant, SU 10 — Easily Provoked:** **any** creature can spend one concentrate
  action to taunt it into attacking only them. A player-facing aggro button printed in the
  statblock.
- **Wripie, ES 2 — Final Prank:** on death it decides whether the party were good sports —
  healing everyone, or spiking the ground with thorns. Judged on roleplay. (Charming; also
  see §9 for why this is on the edge.)

---

## 6. ACTION-ECONOMY SHAPES

### 6.1 The house cooldown
**"can't use again for 1d4 rounds"** appears in **54 of 380 blocks** and is the default
recharge for a big-hitter. Prefer it to `Frequency once per day` in combat, because it keeps
the ability live in a four-round fight. Frequency counts by comparison: once/round 28
blocks, once/day 11, once/minute 9.

**Variants worth stealing:**
- **Othruni, BB 7 — Crystal Beam:** 1d4 rounds **or until exposed to bright light**. A
  cooldown the players can manipulate.
- **Solovei, BB 6 — Thundering Tremolo:** 1d4 rounds **or early if it steals something worth
  10+ gp**. A cooldown with a fiction-driven alternate unlock.
- **Caster Detritus, SU 8 — Blast Sheddings:** the cooldown is a *positioning cost* — it must
  stand in its own cone for a full round to reabsorb.
- **Spectral Conductor, ES 8 — Accelerando / Ritenuto** and **Time Warp, ES 10 — Accelerate
  Time / Decelerate Time:** mutually-gating pairs rather than a cooldown. Forces a
  predictable rhythm the players can read and plan around.

### 6.2 MAP: freeze it or exempt it — and be deliberate
The corpus distinguishes carefully between three treatments:

- **Frozen** ("the penalty doesn't increase until after all attacks"): Afneith BB 8 (four
  claws at a flat −2), Butcher Booth BB 12, Testudan SU 19 (six claws), Jikou BB 12 (three
  Strikes at three creatures), Hemadae Overseer ES 9.
- **Exempt** ("neither applies nor counts toward"): only 4 blocks in the corpus by strict
  phrasing but many more in practice — Necroflesh Monarch BB 15, Laelaps ES 6, Pilfermin
  ES 9, Unbound Arboreal ES 15, Braincase ES 13. Reserve this for *reactions* and for
  Trip/Disarm attempts, not for damage.
- **Deliberately normal:** Puppeteer BB 11 — Manipulate Puppets explicitly does **not**
  defer MAP, so the puppets get worse as it uses them. Terrordactyl ES 6 and Matsugami ES 18
  say so out loud. Saying "MAP applies normally" is a design statement, not an omission.
- **Novel:** Emirad ES 10 — Resounding Refrain's banked Strikes ignore the *existing* MAP
  and only build MAP against repeat targets.

Additional constraint worth copying: many multi-Strike bundles require **each attack against
a different creature** (Garataur BB 5, Curse Eater SU 12, Mechanical Artillerist BB 7,
Scyphozoid Eye SU 13). This turns a damage spike into a positioning problem.

### 6.3 Variable-action scaling
The cleanest in the corpus: **Calliophant, ES 11 — Steam Scream** scales 5d6/5 ft →
10d6/15 ft → 15d6/30 ft, and each action also spends a gallon of its water reservoir. Two
resources scaling together. **Harrophage, ES 20 — Biobombardment** is the simple version
(more dice for the third action). **Ayd-rahiba, SU 10 — Grabbing Onslaught** scales the
damage bonus by actions spent.

### 6.4 The two-step combo (Requirements clauses)
207 `Requirements` clauses across 158 blocks. The dominant shape is
**"its last action was a successful X Strike"** — a follow-up costing one action that is
strictly better than a second Strike, but only if the first one landed (Warp Wyrm BB 8;
Curtain Caller BB 10, as a *free action*; Argentaurem ES 8; Braincase ES 13; Emirad ES 10;
Pilfermin ES 9; Attunement Arsenal ES 13).

Other Requirements shapes: gated on the creature's own stance (Nobbler BB 5 — Gobble
requires it be prone from Go Limp); on holding an object (Pilfermin ES 9); on having a
hostage (Gymnophobia BB 9 — Meat Shield); on HP (Coenosteum Knight ES 8); on terrain (Salt
Glider BB 8 must be flying; Mortarfish ES 13 must be swimming in lava).

### 6.5 Granting, stealing, and taxing actions
- **Grant to allies with a restricted list:** Coromn BB 6 — Delegate (three actions split
  across two allies, Strike or Stride only, even if they already acted); Hatemonger ES 13 —
  Get Them! (an ally Strikes, **MAP-free for everyone**); Mirthless ES 5 — Taunting Tumble
  (every ally who *hears* the taunt may reaction-Stride).
- **Steal from the party:** Chronos Algorithm ES 22 takes a PC's quickened for itself;
  Starborn ES 20 — Gravity Well hijacks a spell or Strike and picks the targets.
- **Borrow against the future:** Emirad ES 10 — Right to the Chorus grants quickened this
  round and slowed 1 next round.
- **Poisoned gift:** Vile Ascender SU 10 — Curse of Ascendance stage 1 grants quickened; the
  later stages take the character.
- **Negative trade:** Scroll Mold BB 0 — Subtle Caster pays **+1 action per spell** to remove
  all components and manifestations. Rare and useful for an assassin-flavoured caster.
- **Self-tax:** Living Proof BB 1 slows itself for an hour after using its signature; Living
  Lightning Rod ES 15 stuns itself on overload; Spectral Conductor ES 8 slows itself.

### 6.6 Extra reactions — always with a spend restriction
Star Wyrm SU 19 (two per round); Curse Eater SU 12 (a second reaction usable only for two
named abilities, with an explicit one-reaction-per-triggering-action clause); Volcanic
Calamity Knight ES 15 (a bonus reaction usable only for Shield Block); **Braincase ES 13**
(a second reaction that must be spent on a *different* action than the first — the cleanest
anti-spam clause in the corpus).

Inverted: **Cadavalier SU 7** is permanently slowed 1 and cannot use reactions at all.
**Trench Lord ES 14** loses its reactions out of water. Removing the reaction is a valid
balancing lever.

---

## 7. MAKING A MONSTER MEMORABLE IN ONE LINE

The corpus's highest-value trick. Each of these is a whole creature identity carried by one
ability. Note how few of them are about damage.

**The monster is an object or a place**
- Ghostwriter, BB 6 — Inhabit Text: it possesses a *book*, so the party fights the furniture.
- Chamber Ooze, BB 5 — Integrate: the room is the monster.
- Butcher Booth, BB 12 — Mimic Structure: the market stall is the monster, and stepping
  inside triggers it.
- Vengeful Doormat, ES 1 — Foot Vulnerability: a level-1 doormat you can grapple by standing
  on it, and hurt by kicking it.

**The monster inverts a basic assumption**
- Xenarian, ES 15 — Half Life: it can only ever be reduced to *half* its remaining HP.
- Mechanical Artillerist, BB 7 — Sensitive Components: burning it makes it faster; cold
  slows it. The party's damage type sets its speed.
- Invulnerabug, ES 16 — Adaptive Immunity: it simply declares itself immune to whatever you
  just used.
- Guiltbound, SU 10 — Murdersense: it cannot perceive anyone who has never killed.

**The monster turns your own tools against you**
- Writer's Block, SU 5 — Creative Plagiarism: it copies the spell you just cast and casts it
  back, using your modifiers and DCs.
- Postgeist, ES 11 — Return to Sender: it counteracts your spell, transcribes it into a
  letter, and *mails it back to you later* at the original's attack bonus and DC.
- Auroplasm, SU 15 — Conduct Electricity: it redirects your electricity effect onto someone
  else.
- Kabrus, ES 5 — Expunge: when you fail to shake off nausea, it makes you vomit a cone onto
  your own allies.

**The monster has an ending that isn't a corpse**
- Boe Erchitu, SU 7 — Steel Horns: shear both horns in one Strike and the cursed man is free.
- Unarmored, BB 12: give it a suit of armour and it moves on.
- Wispy Wayfarer, BB 2 — Sailcloth: *gust of wind* shoves it double distance, and blowing it
  off the ship destroys it.
- Living Blade, BB 8 — Weapon Form: kill it and it becomes loot that curses whoever picks it
  up.

**The monster does one absurdly specific thing**
- Reaver Beaver, BB 5 — Tail Sweep: a monster that exists to punish you for standing up.
- Hook Melon, BB 4 — Steal Stride: a fruit that latches on and drives your body around.
- Milopoxy, BB 8 — Boisterous Braggart: it *automatically critically fails* Deception and
  Stealth, so it can never lie or ambush — and it powers itself by making bystanders cheer.
- Toyblox, ES 5 — Put That Away!: it disarms you because it disapproves of weapons.
- Weatherbane, ES 3 — Grounded: it cannot move, and moving it destroys it.
- Quantum Hummer, ES 5 — Superposition: a bird in several squares at once until someone
  actually looks at it.

**Device checklist for the one-liner:** it should be sayable in a single sentence, it should
change what the players *do* rather than what they roll, and it should be true from the
first round — not revealed at 50% HP.

---

## 8. FAMILY DESIGN AND SCALING

When you build three related creatures at different levels, the corpus does four things:

1. **Reference, don't reprint.** "As hemadae drone, except the piercing weakness is 10";
   "Desiccation Venom: as salt stalker, but DC 30"; "As woodpluck, except the item can be
   level 3 and 8 Bulk". The shared mechanic stays identical; only the numbers move.
2. **Give each tier a different *job*, not a bigger number.**
   Hemadae (ES 7/9/11): drone = worker, overseer = engineer (its abilities retarget attacks
   at its Crafting DC and weld victims to the floor — skill-check-as-attack), queen =
   commander (every one of her abilities references *other* hemadae).
   Spectral Conductor ES 8 vs. Storm Conductor ES 9: one rewards Performance, one punishes
   failing it. Same skill, opposite polarity.
3. **Add complexity only at the top.** In the seasonal fey ladder (Hibernal ES 3, Adnt ES 4,
   Aestival ES 6, Vernal ES 7) every member has a themed "X Cloak" passive and one 2-action
   mobility-plus-damage move; only the level-6 member gets a true mode switch, and only the
   level-7 member gets spellcasting.
4. **Express the shared theme three different ways.** The temporal trio — Paradoxical Past
   ES 9, Parallel Present ES 12, Pruned Future ES 16 — all share Thoughtsense and a scaling
   Fortune Vulnerability, but Past is *repetition* (it heals only if it repeats last turn's
   exact action sequence), Present is *duplication* (bankable duplicates that eat a hit), and
   Future is *foresight* (misfortune and doomed). The scaling is conceptual, not numeric.

Also worth copying: **Woodpluck Chorus, ES 7** is a swarm with deliberately non-standard
swarm rules — its members are Small, it can't share spaces, and it is **not** immune to
precision nor resistant to physical damage. The designers stripped the parts of the swarm
template that frustrate players.

---

## 9. ANTI-PATTERNS — DO NOT DO THESE

### 9.1 Hidden state the players cannot see or infer
- **Secradow, SU 7 — Never Show:** it appears completely unharmed no matter what you do,
  so the GM must secretly track real HP while narrating a false one, per player, with a
  24-hour immunity ledger. Unrunnable without prep and reads as fiat.
- **Braincase, ES 13 — Cranium Shell:** once broken, *any* damage kills it regardless of HP.
  An invisible instant-death threshold the players can only discover by accident.
- **Coenosteum Knight, ES 8:** abilities gated at exactly 61+/60− HP with no sensory cue.
- **Fix:** every threshold needs a describable tell. "Its shell cracks", "the flame gutters",
  "it shrinks a size". If you can't describe it, don't gate on it.

### 9.2 Save-or-permanent with no telegraph and no in-tier cure
- **Eyesore, BB 3 — Steal Eye:** one failed Fortitude save at **level 3** causes permanent
  dazzled; a repeat or a critical failure causes permanent blindness. No ongoing save.
- **Cloaked Gouger, BB 6 — Gouge Eyes:** permanent blindness on one failed save.
- **Coquecigrue, BB 8 — Mind-Bending Warble:** a critical failure while already confused is
  *permanent* confusion, curable only by a 6th-rank restoration — an out-of-tier cure on a
  level-8 creature.
- **Aglys, ES 20 — Subjugating Light:** a 10th-rank dominate whose only reliable counter is
  a sonic source the party may not have.
- **Fix:** permanent conditions need (a) multiple rounds of visible escalation, (b) a cure at
  or below the creature's level, and (c) a save on each stage.

### 9.3 Removing a player from the session
- **Sorrow Portrait, SU 12 — Subject of Horror:** incapacitation plus a maze effect on one
  Will save, no telegraph, and the escape check is entirely GM-invented — the skill, the
  DC, *and* the save type.
- **Temporal Manifestation, BB 5:** its stasis pocket keeps suffocated creatures unconscious
  indefinitely **with no clock**.
- **Interstitial Sludge, ES 15:** on a critical failure victims are dragged into an
  extraplanar void — at the moment the party wins.
- **Vile Ascender, SU 10 / Telepathic Earwig Swarm, SU 6:** both end in permanent NPC
  control of a player character.
- **Fix:** cap the removal at a number of rounds, and put the escape in the *victim's* hands.

### 9.4 Counters and trackers the GM must maintain silently
- **Feth Velaunt, SU 9 — Accursed Absence:** a miss-chance flat check whose DC drops by 2
  after **every single Strike** and resets each round. Per-attack bookkeeping that scales
  with party size.
- **Liquefied, ES 8 — Stored Momentum:** requires counting every instance of force/physical
  damage taken across the round to size one bonus.
- **Bloodsport Remnant, SU 10 — Hype Aura:** a +1…+4 damage modifier applied to **every
  creature at the table**, re-applied to every damage roll, every round.
- **Paradoxical Past, ES 9 — Life Loop:** the GM must record the exact action sequence, in
  order, every turn.
- **Fix:** one tracked number per monster, maximum. If it changes more than once per round,
  cut it.

### 9.5 GM-fiat clauses masquerading as mechanics
- **Calamity Gremlin, ES 9 — Calamity:** a once-per-month curse whose effects are "up to the
  GM", triggering between one day and one year later.
- **Oligtharu, ES 21 — Temporal Corruption:** retroactively rewrites campaign history if one
  PC fails a save, and explicitly asks the GM to invent the causal chain.
- **Electrum Juggernaut, ES 11 — Vanity:** triggers on anything that "would reasonably" get
  it dirty, at GM discretion. **Hollow Krait Swarm, ES 10** keys partly off "an act of
  exceptional bravery", undefined.
- **Vaspertil, SU 10 — Vigorous Acquisition:** the GM picks which of the PC's **feats** are
  temporarily stolen, "preferably one they overrely on". Removes a player's chosen build.
- **Wripie, ES 2 — Final Prank:** "good sports vs. poor sports" decides whether the party is
  healed or damaged. Charming as flavour, non-adjudicable as a rule.
- **Fix:** if the trigger can't be checked against the rules text, give it a concrete proxy
  (a trait, a condition, a check result).

### 9.6 Punishing the actions you want players to take
- **Orb of Insanity, BB 15 — Forbidden Knowledge:** targeting it with a divination spell
  inflicts stunned 4 and stupefied 3, or a day of being controlled. It specifically punishes
  the action players take to *learn how to fight it*.
- **Askyron, SU 18 — Outdated:** any Recall Knowledge result short of a critical success is
  treated as a critical failure.
- **Sirenspider, ES 15 — Resonant Carapace** and **Beat Hopper, ES 5 — Friend To All:** both
  silently turn the party bard's own compositions against them, with no telegraph.
- **Fix:** if you want to blunt a tactic, make it *less effective*, not actively harmful.
  And print the warning where the player will see it before they commit.

### 9.7 Randomness that adds nothing
- **Coquecigrue, BB 8 — Prismatic Spittle:** a 1-in-6 chance the attack does nothing at all,
  plus a random damage type that interacts unpredictably with resistances.
- **Parrotbear, BB 4 — Crunch Bones:** the GM randomly rolls which body part is crushed; the
  three outcomes are near-equivalent.
- **Irivyrn, BB 12 — Mercurial Attitude:** roll 1d4 for the dragon's attitude *every time*
  it meets anyone, destroying any reward for social play.
- **Fix:** randomise *which* good thing happens, never *whether* anything happens.

### 9.8 Add generation with no cap
- **Butcher Booth, BB 12 — Create Husk:** once per round, converts any corpse in its space
  into a controlled undead, with **no stated cap**.
- **Fragmentor, SU 7 — Phantasms:** up to seven duplicates, each with its own initiative
  slot, AC, saves, and leash.
- **Puppeteer, BB 11 — Attach Strings:** five extra tokens each carrying the puppeteer's
  full AC, saves, and HP.
- **Fix:** cap the count, and make the adds either minions (act on the parent's turn) or
  objects with flat HP — not full turn-takers.

### 9.9 Requiring a book the table doesn't have
Living Lightning Rod ES 15, Plasma Lasher ES 13 and Voska Bounty Hunter ES 7 all depend on a
`shocked` condition imported from another product and reprinted in a sidebar. Cranklejack
ES 8 references an external wild-magic table. **If you invent a condition, define it inline
in the statblock.**

### 9.10 Template fatigue
Nearly every venom in BB is "maximum duration 6 rounds, three stages of 1 round each"; nearly
every disease is 5–6 daily stages ending in death; six BB undead share one identical
rejuvenation paragraph. Any template used more than twice in a book stops being a pattern
and starts being wallpaper. **Vary the shape, not just the numbers.**

---

## 10. CHECKLIST FOR DESIGNING ONE MONSTER

1. **One sentence.** What is the one line someone repeats about this creature a week later?
   (§7) If you can't write it, you don't have a monster yet.
2. **One engine, at most.** Pick a shape from §1 and cap it. State what happens at the cap.
   One tracked number.
3. **One or two reactions**, triggered off something a player *chose* to do. (§3) Prefer an
   observable event over an internal state.
4. **One named lever.** A "X Vulnerability" or a player-facing minigame with an action, a DC,
   and four degrees. (§5.1, §5.3) If the creature has a hidden weak point, print how it's
   found.
5. **A pressure valve** on every save-based lockdown: temporary immunity, an ally-usable
   cure, or an escalating-relief clause (Nightmare Shade ES 8 drops its paralysis DC by 1
   per attempt). (§5.2, §5.6)
6. **A telegraph** on anything that deals more than a round's worth of damage. (§1.4, §5.7)
7. **Names:** two words, evocative, verb+object for actions and adjective+noun for passives.
   Name the affliction after the creature; give the actions a voice. (§4)
8. **Cooldown with 1d4 rounds**, not once-per-day, for anything that should fire twice in a
   fight. (§6.1) Say explicitly whether MAP is frozen, exempt, or normal. (§6.2)
9. **An ending that isn't a corpse**, if the creature has a story. (§5.5)
10. **Remaster vocabulary throughout.** Re-read §0 before you write a single trait line.
