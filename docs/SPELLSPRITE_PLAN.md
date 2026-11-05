# Spellsprite: procedural pixel-art effects for PF2e

Status: slices 1 to 5 implemented, slice 6 (polish) ongoing. The shipped
design is `docs/SPELLSPRITE.md`; where this plan and the code disagree, the
code and that doc win.
Scope: a new suite feature, `pf2e-fx` ("Spellsprite"), plus one change to
Diorama's effect layer.
Target: Foundry VTT v14, PF2e 8.x.
Visual reference: the approved v2 prototype,
https://claude.ai/artifact/1ThJxU4kuwJoesakUSL5ig (v1, the smooth vs pixel
comparison: https://claude.ai/artifact/7vdQQymTn4dzaxaU4HGiFk).

## 1. Outcome

Every spell, Strike and condition in a PF2e game gets an effect, with nobody
authoring one. The feature reads what happened from the chat message, turns
it into a cue sheet, simulates it, and paints it as pixel art on the 2D canvas
and in Diorama from the same simulation.

This is an engine, not a library of finished effects. One fireball is not
drawn. A fire material, a burst geometry, a save delivery and a failed-save
outcome are, and the fireball is what they compose to. That makes the
long tail work: a third-party spell with the `fire` trait and an area gets a
fire burst on the day it is installed.

Players restyle their own weapons and spells, and the GM restyles NPCs and
monsters, so two fire bolts at one table need not look alike.

## 2. Binding product decisions

These came from the design conversation and are not up for change during
implementation.

- **Pixel art.** It won against a smooth style by a wide margin. The bar is the
  v2 prototype (section 9).
- **Automatic from chat.** No macro, no button. A message that lands plays its
  effect on every client that can see it.
- **A new feature**, not a mode of Spellglass (`pf2e-aoe`) or Diorama. It may
  import pure modules from both. It never requires either to be enabled.
- **First slice is all three, thin**: spells, Strikes and conditions together,
  each with a narrow set of shapes, before any of them goes deep.
- **Custom looks may change the apparent damage type.** A player can draw their
  fire spell as ice, motion and all. There is no GM gate on this (decided
  2026-11-03). The GM can still edit or clear any look, because the GM can edit
  any document.
- **Both views.** The top-down map and Diorama draw the same cue sheet. Neither
  is a port of the other.

## 3. Pipeline

```
ChatMessage ──read──▶ FxEvent ──semantics──▶ FxSpec ──compile──▶ CueSheet
                                                                    │
                     2D host ◀──paint── Sim (120 Hz, seeded) ◀──────┘
                Diorama host ◀──paint──┘
```

| Stage | Module | Pure? | Job |
|---|---|---|---|
| read | `read.mjs` | no (reads `game`) | Turns a message into an `FxEvent`, or null. All privacy is decided here. |
| semantics | `semantics.mjs` | yes | Material, delivery, geometry, outcome, magnitude, tradition. |
| looks | `looks.mjs` | yes | Applies the look layers (section 7) to the spec. |
| compile | `compile.mjs` | yes | Spec to cue sheet: phases, motifs, timings, positions. |
| sim | `sim.mjs` | yes | Particles, lights, decals, hits, hitstop and shake, seeded. |
| paint | `paint.mjs`, `shapes/` | yes | Pixel buffer, palettes, shapes, outline, banded light. |
| hosts | `host-2d.mjs`, `host-dio.mjs` | no | Put the buffers on screen, light the tokens. |

`semantics`, `looks`, `compile`, `sim`, `paint` and `shapes/` reach no `game`,
`canvas`, `foundry`, `ui` or `Hooks`. That is what the preview page and the
check tool drive, the same rule Stage, Theatre and the hexcrawl follow.

## 4. Reading the chat

### What triggers what

| Message | Read from | Plays |
|---|---|---|
| Spell attack | `flags.pf2e.context.type === "spell-attack-roll"` | charge, travel, impact by degree |
| Strike | `context.type === "attack-roll"`, origin is a weapon or melee item | wind-up, slash or shot, impact by degree |
| Spell cast card, area spell | `flags.pf2e.origin.type === "spell"` with an area | charge, lob or spray, area release |
| Spell cast card, targeted save | as above, no area, has targets | charge, travel to each target |
| Saving throw against a spell | `context.type === "saving-throw"` with an origin spell | that target's impact by degree |
| Condition gained | `createItem` of a condition on an actor with a token | condition loop, until `deleteItem` |
| Persistent damage tick | the persistent damage roll message | one condition tick |

A spell posts several messages: the cast card, then a save per target, then
damage. They are joined into one effect by the origin's uuid, the cast rank and
a short window (`TIMING.joinWindow`, about 8 s). The cast card starts the charge
and the release. A save that arrives later plays its target's impact. A target
whose save never arrives gets the neutral "hit" impact when the window closes.
Damage messages play nothing of their own. The impact has already happened.

When Dice So Nice is active, the impact waits for `diceSoNiceRollComplete` on
that message, so the fireball lands when the die does.

### Privacy

This is the part that fails silently, so it is decided in one function,
`read.mjs`, and nothing downstream asks again.

- **No effect for a message the viewer cannot read.** Blind rolls and whispers
  that did not reach the viewer play nothing for them. The rule is
  `pf2e-odds`' `landingOf`: reuse its helpers (`reachedPlayers`, `metagame`,
  `seesTruth`), never a private copy. `seesTruth`, not `isGM`, because the
  stream login holds GM rights and is watched by the players.
- **The degree is a secret too.** A crit's impact frames, or a miss flying wide,
  tell the table the result. Without the truth, or PF2e's "show results"
  metagame setting, the effect plays the neutral `hit` outcome.
- **No effect at a token the viewer cannot see.** An ambusher hit by a trap
  must not light up for players who have not spotted it. `token.isVisible` on
  the viewer's own client decides it, the way stream status cards fail closed.
  The caster side follows the same rule: an unseen caster's spell starts at the
  first visible point of its path.
- **No socket.** Every client already receives the message. Each one reads it
  through its own view and draws its own answer.

### Determinism

The seed is the message id (for a joined spell, the cast card's id). Every
client draws the same take of the same effect, so the table sees one fireball,
not five.

## 5. Semantics

Material, geometry and function come from Spellglass's classifier
(`pf2e-aoe/classifier.mjs`, `classify(source, options)`), imported as a pure
module. Its vocabulary is already closed and localized: 26 materials, from
`fire` to `fungal`, plus `neutral`. This feature adds the axes Spellglass does
not need:

| Axis | Values | From |
|---|---|---|
| delivery | `attack`, `save`, `auto`, `area`, `strike`, `condition`, `tick` | message type and origin |
| outcome | `crit`, `hit`, `miss`, `neutral` | `context.outcome`, gated by section 4 |
| magnitude | 1 to 10 | spell rank, else item level / 2, clamped |
| tradition | `arcane`, `divine`, `occult`, `primal`, none | the spell's traditions or the caster's entry |
| weapon | `slash`, `pierce`, `bludgeon`, `ranged`, `thrown` | damage type and the weapon's traits |
| runes | material accents | property runes (`flaming` adds fire, `frost` cold, and so on) |

Low classifier confidence resolves to `neutral`, which draws a clean force-like
pulse in the caster's look colour rather than guessing a material.

### Materials to motif families

26 materials do not need 26 effect families. They share about a dozen, and the
palette and a few family switches tell them apart.

| Family | Materials |
|---|---|
| flame | fire |
| frost | cold |
| arc | electricity |
| corrode | acid, poison (poison: greener ramp, no puddle, a cloud) |
| shock ring | sonic, force, air (air: no core, swirling streaks) |
| radiance | vitality, holy, light |
| umbra | void, unholy, shadow |
| psyche | mental, illusion, spirit (rippling glyph rings, afterimages) |
| earthwork | earth, metal (chunks, grit, a crater decal) |
| tide | water (splash crowns, droplets, a wet sheen decal) |
| growth | wood, plant, fungal (vines on the floor, spores) |
| physical | kinetic, neutral, arcane (arcane: glyph flourish on) |

## 6. Cue sheets and motifs

### Phases

Every effect is cut into the same phases, and the AUTHORING bar from pixelfx
holds: fast attack, slow release.

| Phase | Typical length | Notes |
|---|---|---|
| charge | 0.35 to 0.45 s | caster glyph, lines gather, light swells |
| release / travel | 0.4 to 0.65 s | projectile, lob, spray or slash |
| impact | 2 frames at 12 fps | hero frame (white) then palette; crit adds impact frames and hitstop |
| spread | 0.3 to 0.6 s | the material's own burst |
| linger | to 2.5 s | flames, frost, bubbles, motes; fades by dither |
| decay | to 5 s | debris, scorch, puddles stay and dissolve |

### The compiler's rules

- Material picks the family, the palette and the particle personality.
- Geometry picks the layout: burst, cone, line, emanation, single target.
- Delivery picks the travel: projectile, lob, spray, slash, none.
- Outcome picks the impact: crit is a hero frame, two impact frames, hitstop,
  shake, squash and knockback; hit is a flash and a flinch; miss flies wide and
  fizzles.
- Magnitude scales size, count and light (`m = 0.55 + 0.09 * rank` in v2).
- Tradition picks the charge glyph's alphabet.
- Every cast takes one of two or three layouts per family from the seed.

### Motifs to port from v2

`charge`, `projectile`, `burst` (per family), `trail`, `linger`, `aura`,
`slashArc`, `flourish`. Shapes: `blob`, `smoke`, `tongue`, `spark`, `streak`,
`ember`, `mote`, `flake`, `chunk`, `shard`, `crystal`, `orb`, `crescent`,
`star`, `flash`, `core`, `wisp`, `beam`, `octa`, `glint`, `petal`, `drip`,
`splash`, `bubble`, `bolt`, `halo`; decals `ring`, `scorch`, `frost`,
`puddle`, `darkpool`, `glyph`, `mark`, `cone`. New families (psyche,
earthwork, tide, growth) need about eight more shapes between them.

## 7. Looks

### Layers

Most specific wins, field by field:

1. world defaults (settings)
2. GM per-spell rule, keyed by the spell's slug
3. the actor's default look
4. the item's own look

### Data

A flag, `flags["gluniverse-foundry-modules"]["fx.look"]`, on Items and Actors.
It is read and written only through `looks-store.mjs`, which normalizes it.

```js
{
  material: "cold" | null,     // full reskin, motion included
  hue: 0..359 | null,          // rotates the whole ramp; the hue shift survives
  flourish: "sparkles" | "petals" | "runes" | "none" | null,
  layout: 0..2 | null,         // pin one take instead of the seeded one
  off: false                   // this item plays nothing
}
```

Writing a flag needs ownership, so permissions come free: a player edits looks
on their own character's items, the GM edits anything. Runes are derived, not
stored. A flaming weapon burns until its owner says otherwise.

### Editor

A small ApplicationV2 window opened from the item sheet header and the actor
sheet. It draws a live preview with the same pure renderer, at shipping size,
over both floors. No form name without a field in the normalizer.

## 8. Hosts

### 2D canvas

- One pixel buffer per active effect, sized to that effect's bounding box,
  not the viewport. A 1920×1080 view at 2 screen px per art px is half a
  million pixels a layer, and `putImageData` on all of it every frame is the
  first thing that would blow the budget.
- Each buffer becomes a `PIXI.Texture` with nearest scaling. The flat layer
  sits under the tokens, the standing layer over them.
- **Grid lock.** One square is a fixed number of art pixels (default 26). The
  screen px per art px is the integer nearest the canvas zoom, so pixels never
  resample. Effect positions snap to the art grid.
- **Light.** On a dark map, banded light is additive. On a bright map it is a
  tint, because additive light over parchment clips to white. The choice is
  per scene from the background's mean luminance, with a scene override.
- **Token light.** Rim and tint on tokens near a light, and the hit flash, go on
  a sprite drawn over the token's own mesh. The token is never retinted, and
  nothing is written to the token document.
- **Shake** moves the effect layers only. It never moves the canvas: the stream
  camera owns that, and `stream/camera/pan-guard.js` would refuse it anyway.

### Diorama

`diorama/render/effects.mjs` today draws every effect additively, which is
right for JB2A video and wrong for pixel art: outlines and smoke undersides are
darker than the ground and would vanish. It needs one new kind:

- `pixel`: a canvas source, normal alpha blending, `NearestFilter`, no
  mipmaps. One quad lying on the ground for the flat layer, one camera-facing
  quad for the standing layer, projected each frame from the camera's azimuth.
- Its lights go through the existing effect point lights (up to eight).
- Standee squash and knockback ride Diorama's own standee transform, through
  a hook Diorama exposes, never by reaching into its scene.

The Diorama change is a small, separately reviewable commit in the Diorama
feature, with its own `diorama-check` run.

### Budget and motion

- `Budget.ladder("fx", SHED_ORDER)`, shed in this order: `minor` particles,
  `tokenLight`, light bands, `debris`, `shake`, then a lower concurrent-effect
  cap. Never pixel size.
- `Budget.claimMotion("fx", true)` while any effect is alive, so an idle-rate
  drop does not stutter it.
- The motion tier scales nothing in time (sprite timing is the look). Motion
  "none" plays no effect at all.
- Zoomed below 0.75 the `minor` particles drop out. Pixels never shrink.
- Target: under 2 ms of main-thread time per frame for three overlapping
  effects, measured in the preview.

## 9. The visual bar

From the v2 prototype. A diff that loses one of these is a regression even if
every check passes.

1. Effects light the world: banded floor pools, token rim and tint, the hit
   flash in the effect's palette.
2. Grid-locked pixels, integer scale, hysteresis on slow particles, shapes
   drawn at their real angle, bolts in 45° and 90° runs.
3. Shapes, not dots. No single-pixel speckle anywhere: translucent fills are
   true blends, never dithered checkerboards.
4. Outlines on bright maps, light as a tint; judge every effect on dark stone
   and on parchment.
5. Hue-shifted 7-step ramps, cool shadows, warm highlights, pure white only on
   hero frames.
6. Shapes step at 12 fps, particles at full rate, smear on fast heads, impact
   frames on crits, debris that stays and dissolves.

The process is Sprite Fusion's: five to ten drafts per family, compared side
by side in the preview's contact sheet, judged by eye.

## 10. Settings (`fx.*`)

| Key | Scope | Default |
|---|---|---|
| `fx.spells`, `fx.strikes`, `fx.conditions` | world | on |
| `fx.artPerSquare` | world | 26 |
| `fx.impactFrames` | client | on (an explicit choice, not an OS preference) |
| `fx.shake` | client | on |
| `fx.maxConcurrent` | client | 6 |
| `fx.rules` | world | `{}` (GM per-spell rules, edited in a menu) |
| `fx.standDown` | world | on: skip items Automated Animations already handles |

All registered unconditionally in `registerSettings`. Lang namespace `GLFX.*`,
CSS prefix `glfx-`. Neither is used anywhere in the repo today.

## 11. Slices

1. **Core.** Adapter, the pure core ported from v2, `tools/fx-preview.mjs`
   with a contact sheet of every family × delivery × outcome × floor, and
   `tools/fx-check.mjs`.
2. **First playable, 2D.** Strike, spell attack, area save, condition loop, for
   the eight v2 materials, from real chat messages, with the privacy rules.
3. **Diorama.** The `pixel` effect kind and the Diorama host.
4. **Looks.** The flag, the store, the editor, GM rules.
5. **Breadth.** The remaining families (psyche, earthwork, tide, growth), lines
   and emanations, persistent damage ticks.
6. **Polish.** Draft rounds per family against the visual bar.

## 12. What `fx-check` pins

- Purity: no `game`, `canvas`, `foundry`, `ui` or `Hooks` in the pure modules.
- Every Spellglass material resolves to a family; every family draws in every
  delivery and outcome without throwing.
- Determinism: one seed draws byte-identical frames twice.
- Privacy: a blind roll, a whisper to someone else and a hidden target each
  produce no event; a degree without the truth or the metagame setting
  produces `neutral`.
- A look can reskin the material, and a cleared field falls through to the
  layer beneath.
- `SHED_ORDER` names only things the host can shed, and every one is read.
- Every runtime-built i18n key (`GLFX.family.*`, `GLFX.flourish.*`,
  `GLFX.delivery.*`) resolves.
- No speckle: a family that writes dithered alpha into a fill fails.
- Frame cost under budget in Node for the worst preset.

## 13. Open questions and risks

- **Message correlation.** Joining cast, save and damage by origin uuid and
  rank needs testing in a live PF2e session. A spell recast inside the join
  window is the edge case.
- **Area placement.** The burst centre should come from the Region the spell
  placed (Spellglass already listens for it). Casts with no placed area aim at
  the first target.
- **Token light on v14.** Drawing over the token mesh has to follow the token
  through movement animation. That needs a live session to prove.
- **Other animation modules.** Automated Animations and Sequencer may already
  play something for the same message. `fx.standDown` is the first answer; the
  real one needs a look at how they mark what they handle.
- **Licence.** v2 is our own code. If any pixelfx source is ported directly
  (it is MIT, and partly adapts Sprite Fusion and Hollow Crown, also MIT), its
  notice ships in `NOTICE.md`.
