# Spellsprite (`pf2e-fx`)

Procedural pixel-art effects for PF2e. Every spell, Strike, action and
condition plays an effect read straight from the chat, on the 2D map and in
Diorama, with nobody authoring one. A fireball is not drawn anywhere: a fire
material, a burst area, a save delivery and an outcome are, and the fireball is
what they compose to. So a third-party spell with the `fire` trait and an area
gets a fire burst the day it is installed.

Off by default. PF2e only. Settings prefix `fx.`, lang namespace `GLFX.*`,
CSS root `.glfx`. The design history is `docs/SPELLSPRITE_PLAN.md`; what every
document in the PF2e packs resolves to is `docs/SPELLSPRITE_COVERAGE.md`.

## Pipeline

```
ChatMessage ─read─▶ event ─semantics─▶ spec ─looks─▶ spec ─compile─▶ Sim
                                                                     │
                       Host2D (PIXI) ◀─paint─ Director (120 Hz) ◀────┘
               Diorama mirror (three) ◀─paint─┘
```

| Module | Pure | Job |
|---|---|---|
| `read.mjs` | no | Chat, Regions and condition items into events. Every privacy decision. |
| `semantics.mjs` | yes | Material, function, delivery, area, outcome, magnitude, tradition. |
| `looks.mjs` | yes | Merges the look layers onto a spec. |
| `compile.mjs` | yes | A spec into a seeded `Sim` with its cues. |
| `area.mjs` | yes | The area language (below). |
| `families/`, `forms.mjs`, `strikes.mjs`, `conditions.mjs` | yes | What each material, function, weapon style and condition draws. |
| `archetypes/` | yes | One animation per meaning, reused across documents (below). |
| `core/` | yes | Sim, shapes, palettes, the pixel buffer, frame painting. |
| `director.mjs` | yes | Which sims run, on which scene, under which budget. |
| `host-2d.mjs` | no | Puts the buffers on the Foundry canvas and moves the tokens. |
| `looks-app.mjs` | no | The look editor and the GM's world rules. |
| `diorama/integrations/spellsprite.mjs` | no | Diorama's mirror of the same sims. |

Nothing pure reaches `game`, `canvas`, `foundry`, `ui`, `Hooks` or `PIXI`, and
nothing calls `Math.random`. That is what the preview pages and the check tools
drive, and it is why every client draws the same take of an effect: the seed is
the message id.

## Reading the chat

A spell posts a cast card, then a save per target, then damage. They are
joined by origin uuid and cast rank inside `TIMING.joinWindow`. The cast card
starts the charge, each save plays its own target's impact, and a target whose
save has not arrived by `TIMING.saveWait` gets the neutral impact. Damage
messages play nothing. With Dice So Nice the impact waits for the die, capped
at `TIMING.diceWait`. An area takes its geometry from the Region the spell
placed (`flags.pf2e.areaShape`); with none it falls back to the first target.

PF2e 8.5 facts the reader depends on: a spell attack and a Strike are both
`context.type: "attack-roll"`; the cast rank is `origin.castRank`; a save from
a spell card carries the spell as `flags.pf2e.origin`; a persistent damage tick's
only origin is the `persistent-damage` condition item.

An Elemental Blast is not a Strike and not a spell: its roll carries
`context.action: "elemental-blast"` and `context.identifier`
(`element.damageType.melee|ranged.cost`), and its origin is an `action` item.
`describeBlast` plays it as a spell attack, its material the damage type when that
is energy and the element otherwise, as an orb at range and a touch in melee.

Condition loops are keyed `cond:<tokenId>:<slug>` (never the actor id, which
unlinked tokens share), start on `createItem` and stop on `deleteItem`.
`startLoop` is idempotent by signature, so a re-read restarts nothing.

### Privacy

Decided once, in `read.mjs`, with pf2e-odds' own helpers (`seesTruth`,
`reachedPlayers`, `metagame`), never a copy:

- A message this viewer cannot read plays nothing, not even a neutral effect.
- The degree is a secret. Without the truth or PF2e's "show results" setting,
  every impact is the neutral `hit`, because a crit's impact frames or a miss
  flying wide tell the table the result.
- A token this viewer cannot see is left out. An unseen caster's spell starts
  at its first visible target.
- No socket. Every client already has the message and draws its own answer.
- "Sees the truth" is `seesTruth()`, never `isGM`: the stream login is a GM
  the players are watching.

## The area language

Bursts, cones, lines and emanations read like a MOBA skill, not a handful of
particles: the shape fills, then a wave crosses it.

1. **Indicator.** A marching rim and a filling floor show where it will land.
2. **Wave.** Each pixel lights when the shock front reaches it: white-hot, then
   the material's warm colour, then glow. Timing is per pixel from the area's
   own distance metric, so a cone sweeps out from the caster and a burst
   rings out from its centre.
3. **Shock.** Four bands eased to the exact edge (a second, broken one on a
   crit).
4. **Eruptions.** Material bursts scattered through the area, more on bigger
   areas and crits; half of them are `minor` and shed first.
5. **Scar.** A chunky 4×4 grain that dissolves. Never fine dither, which reads
   as speckle.

Targets are hit when the wave reaches them, not all at once. Lights run along
a cone or a line rather than pooling at one point. Non-harm areas (`gentle`)
skip the shake.

A lobbed area (a burst thrown from the hand) is drawn at a size that promises
the area it carries (`lobSize` in `compile.mjs`): the charge swells to that
size, and the ball has a dark rim and a white-hot core so it reads as a ball
on either floor. Fire's trail grows with it.

## Weight and craft

Every effect has the same beats: anticipation, travel, contact, aftermath. Impact
never lands on the first frame. (We borrowed this from turn-based gacha combat
such as Honkai: Star Rail, where weight comes from a slow wind-up against an
instant strike and a held contact frame.)

**Weight.** `weightOf(spec)` in `strikes.mjs` is 1 for a one-handed blow, more
for `weapon.heavy` (two-handed usage or a `two-hand-d*` trait) and for
`weapon.power`. Weight adds a planted wind-up with a backswing arc, a bigger
smear with a white cutting rim and a dimmer echo, and a held contact frame
(`freeze` with no veil, since the veil belongs to a crit). It also adds a
hairline cut that splits outward, plus thrown grit and dust. It never adds a
second hit, so a powered miss is still a miss. The kinetic release light is
damped under weight, or the held frame holds a white pool over the target.

`weapon.power` is Vicious Swing (Power Attack before the remaster). It is a
**damage**-domain toggle, so the attack roll never carries it; `read.mjs`
reads `actor.rollOptions.damage` at attack time. A creature's own Power Attack
or Vicious Swing action card is silent (`strike-plays`): the Strike that
follows plays. Otherwise the card dropped a hinder weight on the creature's
own head.

**Craft.** `craft: "medicine"` (Treat Wounds, Battle Medicine, First Aid,
Treat Poison, Treat Disease) is a skill, not a spell, and must not read as one.
It skips the charge circle, the material light, the beam and the halo. The
medic tosses a roll of bandage, it winds round the patient in two turns and
cinches, and a flat green cross pops up (`CRAFTS.medicine` in `forms.mjs`,
`linen` and `salve` ramps). The green cross is the one healing sign shared with
magical healing; the cloth is what says nobody cast anything.

## Hosts

**2D.** Ground effects sit in `canvas.primary` just under the tokens;
standing effects, lights and impact frames in `canvas.interface`. Light draws
under the stand layer on a bright floor and above it, additively, on a dark
one. Floor brightness is the scene flag `fx.floor`, then the client setting,
then scene darkness, then a 16×16 luminance sample of the background.

Hits move the real token mesh (knockback, squash, flash) and hand it back to
Foundry's pose afterwards. The canvas texture is resized through
`base.resource.update()`, with its frame parked at 1×1 first, or a shrinking
canvas throws "frame does not fit".

**Diorama.** The same sims, not a port. The ground layer becomes a decal and a
light pool; each site gets an upright sprite that faces the camera and stands
on the terrain. Pixel-sharp: nearest filtering, no mipmaps, no depth writes,
one art pixel a whole number of device pixels. An empty scene costs nothing per
frame. Not yet mirrored: impact frames; a bolt keeps its caster's ground
height while it crosses terrain; the decal does not follow slopes.

**Budget.** One ladder, `Budget.ladder("pf2e-fx", SHED_ORDER)`: `minor`,
`tokenLight`, `lightBands`, `debris`, `shake`, then `concurrency` (halves
`fx.maxConcurrent`). Pixel size is never shed. While anything plays the
Director holds `Budget.claimMotion`.

## Archetypes

An archetype is one animation reused by every document that means the same
thing: one grab for every Grab and Improved Grab, one rage for barbarian Rage and
every NPC berserk, one rise for every healing spell. `archetypes/rules.mjs`
`pickArch` chooses it from the slug, then the traits, then the function, and
`depictSpec` puts it on the spec as `arch`. The drawers are
`archetypes/{mind,body,self}.mjs`, called exactly like a `FORMS` entry, and they
take the creature sizes, the material ramp, the outcome and the rank as their
parameters, so one drawing serves a goblin's Grab and a dragon's.
`docs/SPELLSPRITE_ARCHETYPES.md` is the catalogue and the build order; the
coverage report counts what each archetype plays.

- **mind** — hex (the catch-all for any hinder), fear, charm, slow, sleep, blind,
  vanish.
- **body** — grab, trip, shove (Trample and Throw Rock by slug), rend, charge,
  flurry. These are maneuvers: `noCharge` skips the spell charge unless a spell
  plays one (`spec.cast`), and none of them may read as a second hit, because the
  Strike beside it plays its own.
- **self** — rise, drink (the flask, then the potion's own form; a restore
  potion ends in rise), rage, stance, light, fortune.

A name never moves a document across functions: `fits` gates each archetype,
so See the Unseen is a detect, not a vanish. A silent action is lifted only by an
archetype marked `rescue`, and a damaging ability takes only a body archetype and
only in place of a generic delivery.

## Looks

A look restyles an effect: material, hue, flourish, layout, or off. Players
restyle their own items and actors, the GM restyles anything. A look may change
the apparent damage type with no GM gate (decided 2026-11-03). Layers, lowest
first: the GM's world default (`"*"` in `fx.rules`), the GM's slug rules, the
actor's look, the item's look (`flags[SUITE_ID]["fx.look"]`). A cleared field
falls through to the layer beneath. The editor opens from a header button on
Actor and Item sheets and previews the look live.

## Checks

```bash
node tools/fx-check.mjs            # engine, Director, privacy wiring, cost
node tools/fx-semantics-check.mjs  # semantics against real pack data
node tools/fx-coverage.mjs         # regenerates docs/SPELLSPRITE_COVERAGE.md
node tools/diorama-check.mjs       # includes the Spellsprite mirror
```

Zero problems required. Regenerate coverage after any change to
`semantics.mjs`. To look at it:

- `node tools/fx-preview.mjs && node tools/preview-server.mjs`, then
  `/.preview/fx.html`: the pure engine in top and side views.
- `node tools/fx-canvas-preview.mjs`, then `/.preview/fx-canvas.html`: the
  shipped Director and `Host2D` on real PIXI over a fake Foundry canvas (`fx`,
  `mat`, `zoom`, `floor`, `loop`, `seek`).
- `node tools/diorama-preview.mjs` with `?fx=burst|strike|cone|condition`.

Headless Chrome delivers almost no animation frames under a virtual-time
budget, so judge stills with `seek`, never by waiting. `fx.html` takes `arch`
and `slug` to play an archetype, and `layers=flat,stand,light` to find which
layer a wash comes from.

The size, density and timing bar lives in the `spellsprite-craft` skill, which
benchmarks against the pixelfx reference (`node tools/fx-reference.mjs`).

## Fails silently

- A shed name nobody reads never degrades. fx-check pins every one.
- A pure module that reads the world breaks the previews, which then flatter a
  copy nobody ships.
- A privacy rule restated in `read.mjs` drifts from pf2e-odds and leaks a
  degree on the stream. fx-check refuses a local copy.
- `sideView`'s forward vector: mirrored, far squares draw nearer the camera
  and every effect reads back to front. fx-check pins its direction.
- A condition slug with no `CONDITIONS` entry plays nothing. fx-check walks all
  43 PF2e condition slugs.
- A form nothing routes to. `teleport`, `movement` and `transform` are
  Spellsprite's own functions, which Spellglass's classifier never returns,
  so `pickFunc` reads their traits and slugs before it asks the classifier.
  Check the function table in the coverage report after adding one.
- An archetype left as a placeholder plays its function's old form for
  thousands of documents. fx-check refuses one.
- `spec.slug` is how an archetype picks a variant (charm's heart, Trample, Throw
  Rock). `finish()` in `read.mjs` must keep copying it; without it every variant
  works in the preview and never in play.
- A release flash sized by the area whites out the whole footprint for two
  frames, and every eruption under it. `releaseFlash` caps the white core in
  squares; the area's own lights stay below a wash for the same reason.
- Persistent bleed arrives as slug `persistent-damage` with
  `damageType: "bleed"`; the bleed ramp is chosen on either.

## Needs a live session

Region rotation units and cone direction, whether `User#targets` is current on
other clients when the card lands, scroll and wand casts, Automated Animations'
stand-down (`fx.standDown`, written without AA installed), and the token mesh
reaction during v14's movement animation.
