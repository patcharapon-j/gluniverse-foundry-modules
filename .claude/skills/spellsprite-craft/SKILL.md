---
name: spellsprite-craft
description: "The quality bar for Spellsprite's pixel-art effects (scripts/features/pf2e-fx/): how big, dense, lit and timed an effect must be, how to read the pixelfx reference into our top-down engine, and which reference effect to study for each family, Strike and condition. Use before drawing, resizing or reviewing any Spellsprite effect (families/, strikes.mjs, ranged.mjs, deliveries.mjs, forms.mjs, conditions.mjs, core/shapes.mjs, area.mjs)."
---

# Spellsprite craft

`fx-check` proves an effect works. This says what a good one looks like. The
reference is **pixelfx** (github.com/patch-gg/pixelfx, MIT, Patch and Hugo
Duprez, after Sprite Fusion's effects): 244 handmade effects at our pixel
scale. It is a side view and ours is top-down, so we take its technique and its
numbers, never its files. If code is ever adapted, its MIT notice ships in
`NOTICE.md` and the file carries a credit header.

## The method

1. **Fetch the reference** once per machine: `node tools/fx-reference.mjs`. It
   clones pixelfx at a pinned commit into `.reference/pixelfx/` (gitignored)
   and writes `.preview/fx-reference.html`.
2. **Find the closest reference effect** in the map at the end and read its
   source under `.reference/pixelfx/src/fx/`: the choreography, the counts, the
   timings, the radii. `.reference/pixelfx/docs/AUTHORING.md` is its own bar.
3. **Say the effect in one line**, art direction included, then draft it in
   our engine.
4. **Benchmark side by side.** `node tools/preview-server.mjs`, then
   `/.preview/fx-reference.html`. Each scene plays our effect above the
   reference, staged on the same PF2e event at the same scale. Judge both
   floors at 1x. If the reference is bigger, denser, brighter or livelier, ours
   is not done.
5. **Fix the worst thing, look again.** Three rounds minimum; a showpiece
   (Fireball, a crit) takes more. Judge stills with `seek` on
   `/.preview/fx-canvas.html` too, since that page runs the shipped host.
6. **Check.** Done is `node tools/fx-check.mjs` and
   `node tools/fx-semantics-check.mjs` at zero problems, plus the side-by-side
   showing ours at least as big, dense and lit as the reference.

## 1. Presence: JRPG, slightly over the top

Players miss small effects; that is the most common failure here. Size every
effect to be noticed from across the table. One square is 26 art px, the same
scale as the reference's 24 × 38 px character, so its numbers carry over
directly. The art pixel never grows; the effect's extent does.

| Beat | Floor at a one-handed hit / rank-mid spell |
|---|---|
| Melee smear | radius 40+ px (1.5 squares), 10–12 px thick at the head, light riding the head (radius ~40 px) |
| Contact | flash and sparks reach 1.2+ squares past the contact point; sparks fly 150–400 px/s |
| Release light | a soft pool ~3× the burst radius plus a tight white core |
| Burst | 25–30 fire blobs, 10–15 smoke, ~80 sparks, ~40 embers, ~25 tumbling chunks, grit and floor dust |
| Area | waves and rings reach the rim; eruptions are spread through it |
| Projectile | head 10+ px, a wake of a square or more |
| Crit | ×1.4 extent, white hero frames, longer hold |

Density is affordable because the budget sheds it: mark everything past the
readable core `minor: true`, and give any new shed name a place in `SHED_ORDER`.

## 2. The bar

1. **Lines and light, not fills.** One-pixel rims, rings, trails and sparks
   carry the shape; light carries brightness. White-hot cores and edges, tinted
   middles, deep colour only in shadow.
2. **Light on everything.** A light per spark and glint, a flare at contact
   that falls away, light along arcs and beams, a warm or cold floor pool while
   something burns or freezes.
3. **Translucent volumes.** Smoke, vapour and dust use `Pix.mix` (true
   translucency), lit on top, swelling and thinning. `dot` (dither) is for
   dissolves.
4. **Real motion.** Sparks stretch with speed, fall and bounce. Debris tumbles,
   bounces, settles, fades. Fire rises and cools into smoke. Landings kick dust.
   Drag gives the shape: a fast burst, then a slow drift.
5. **Phases.** Anticipation (things gather in), release (a 1–2 frame white
   hero frame, flare, light), spread, hold (glints, embers), decay. Many small
   events, each varied in size, speed, timing and life.
6. **Timing.** Fast attack, slow release. Big effects linger 2–4 s; hits are
   snappy (0.3–0.8 s) with follow-through. A heavy blow holds its contact frame
   longer (0.03–0.2 s).
7. **Reads at 1x**: one focal point, no speckle inside a shape.

## 3. Reading a side view into our top-down engine

- **Height.** Their screen-up is our `z`. The 2D top view lifts `z` by only
  0.2 (`topView` `lift`), so a rising column reads as drift and spread on the
  floor; in Diorama the stand layer is an upright billboard and `z` is full
  height. Give an effect both: spread for 2D, height for Diorama.
- **The floor.** Their floor rings are squashed ellipses with a far half behind
  the character and a near half in front. Ours are true circles in the flat
  layer: Diorama lays that layer as a decal and the camera foreshortens it at
  every pitch. A baked squash is right at one angle only.
- **Layers.** Their `drawBack` / `draw` split maps onto our flat / stand split
  by what touches the ground, not by depth.
- **Direction.** Their directional effects face right; ours aim along the
  delivery's unit vector (`A.ux`, `A.uy`) from the caster.
- **Units.** Their pixel is our art pixel. Divide their speeds and distances by
  26 for squares; their gravity is 950 px/s² (about 36 squares/s²). Hugo
  Duprez's own code uses 2 world units per pixel, so halve his numbers first.

## 4. What stays ours

Spellsprite's contract (purity, seeding, privacy, ramps, layers, the area
language) is in `docs/SPELLSPRITE.md`, and its checks pin it. Two points meet
the reference head on: colour comes from the 7-step ramps in
`core/palette.mjs` (pure white is for hero frames only), and every random
number comes from the sim (`s.rand`, `s.R`), so every client draws one take.

## 5. Reference map

What to open under `.reference/pixelfx/src/fx/` for each thing we draw. The
three its author holds up as the bar are `melee/sword-slash`,
`ice/frost-nova` and `explosions/small-explosion`.

| Ours | Study |
|---|---|
| Strike `swing` (slash) | `melee/sword-slash`, `melee/double-slash`, `melee/heavy-cleave` (weight), `melee/spin-slash` (sweep) |
| `thrust` (pierce) | `melee/thrust`, `melee/spear-sweep`, `melee/dagger-flurry` (agile) |
| `smash` (bludgeon) | `melee/hammer-smash`, `impacts/blunt-hit`, `impacts/ground-slam` |
| `rake` / `jaws` / `fist` | `melee/claw-swipe`, `melee/uppercut`, `melee/whip-crack` |
| Crit / hit / miss | `impacts/crit-hit`, `impacts/impact-frame`, `impacts/hit-spark`, `impacts/hit-flash` |
| Shield Block, parries | `impacts/shield-block`, `impacts/parry`, `holy/divine-shield` |
| `ranged` / `thrown` | `projectiles/arrow`, `projectiles/bullet-tracer`, `projectiles/muzzle-*`, `projectiles/cannonball` |
| Charge | `arcane/spell-charge`, `arcane/magic-circle-cast`, `arcane/rune-circle` |
| Flame (fire) | `explosions/small-explosion`, `fire/fireball`, `fire/fire-breath` (cone), `fire/flamethrower` (line), `fire/fire-ring` (emanation) |
| Frost (cold) | `ice/frost-nova`, `ice/ice-lance`, `ice/ice-shatter`, `ice/frost-breath`, `ice/freeze` |
| Arc (electricity) | `lightning/lightning-strike`, `lightning/chain-lightning`, `lightning/zap-hit`, `lightning/spark-arc` |
| Shock (force, sonic, air) | `arcane/mana-burst`, `lightning/thunderclap`, `nature/tornado`, `arcane/arcane-missiles` |
| Corrode (acid, poison) | `nature/acid-splash`, `nature/toxic-puddle`, `nature/poison-cloud` |
| Earthwork (earth, metal) | `nature/earth-spike`, `nature/quake`, `nature/boulder`, `explosions/dirt-explosion` |
| Tide (water) | `water/splash`, `water/wave-crash`, `water/water-jet`, `water/geyser` |
| Growth (wood, plant, fungal) | `nature/vine-whip`, `nature/thorns`, `nature/root-snare`, `nature/spore-burst` |
| Radiance (vitality, holy, light) | `holy/heal`, `holy/heal-aoe`, `holy/smite`, `holy/holy-pillar`, `holy/sunburst` |
| Umbra (void, unholy, shadow) | `shadow/curse`, `shadow/void-orb`, `shadow/life-steal`, `shadow/shadow-tendrils` |
| Psyche (mental, illusion, spirit) | `status/charmed`, `status/confused`, `arcane/time-stop`, `shadow/soul-drain` |
| Teleport, movement | `arcane/blink-in`, `arcane/blink-out`, `arcane/portal`, `spawn/*` |
| Conditions | `status/*` (burning, frozen, poisoned, stunned, slowed, sleep, bleeding, ...) |
| Archetypes: mind (`archetypes/mind.mjs`) | `shadow/hex-sigil`, `status/cursed`, `status/charmed`, `status/slowed`, `status/sleep`, `holy/sunburst`, `arcane/blink-out`, `transitions/pixel-dissolve` |
| Archetypes: body (`archetypes/body.mjs`) | `shadow/grasping-hands`, `melee/spear-sweep`, `melee/claw-swipe`, `moves/dash-strike`, `melee/dagger-flurry`, `impacts/ground-slam` |
| Archetypes: self (`archetypes/self.mjs`) | `holy/heal`, `holy/resurrection`, `pickups/potion`, `status/rage`, `arcane/rune-circle`, `holy/halo`, `holy/blessing` |
