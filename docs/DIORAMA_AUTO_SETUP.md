# Diorama Auto setup

Auto setup (Terrain editor, Auto setup button) makes a first draft from the map
art and the walls. It is a draft for the GM to fix, not a model of the map.
It's pure and deterministic: the same art, walls and options always give the
same `Terrain`, and nothing in it is random.

Code: `scripts/features/diorama/editor/auto-setup.mjs` (the method),
`editor/sample.mjs` (reading the art), `editor/auto-dialog.mjs` (the options).
Checks: `tools/diorama-check/auto.mjs`. Measurement: `tools/diorama-auto-eval.mjs`.

## What it reads

The art is sampled at the scene rect onto a fine raster of up to 8 px per
sub-cell (16 per square), capped at 4096 px a side and 1.6 MP. Each sub-cell
also gets its block average, which the room and colour passes use.

1. **Rooms, void, water.** These are unchanged from the earlier version. Walls
   enclose rooms, and the rooms are floor. Near-black art outside the walls is
   void, and void stays void. Water comes from colour (hue, saturation, value
   in HSV), with a stricter rule for murky green-teal water.
2. **Regions.** Felzenszwalb graph segmentation over OKLab colour on the
   sub-cell grid. Walls block merges, and lightness counts a little less than
   chroma so a shadow does not split a floor in two. Regions get an adjacency
   graph with shared border lengths.
3. **Shadow bands.** At each sub-cell a short ray is probed along the light's
   direction. A cast shadow is a sharp drop in lightness, a band, then
   recovery. The band's width is the height of what casts it (width × height
   scale). A band whose far end fades is a soft cast shadow. One that is sharp
   at both ends is a "strip" (a painted line, a dark path) and weighs half as
   much.
4. **The light.** When the option is Auto, the light is the compass point
   whose soft-band energy most exceeds the opposite point's. Below a confidence
   of 0.12 there is no consistent light, and the draft takes no heights from
   shadows. Strips falling *toward* a guessed light cancel strips falling away
   from it, pair by pair, so symmetric dark lines cannot invent a cliff.
5. **Constraints and solve.** Each band says "the region it starts in is
   higher than the region past it, by about the band's width". Regions mostly
   covered by the light's bands (60% or more) are shadow, not ground. They are
   left out of the cues and take their lowest neighbour's level. Opposing cues
   on one region pair are netted. The heights come from least squares
   (Gauss-Seidel) over the cue edges plus a weak smoothness term on the other
   edges. The smoothness is stronger between regions of the same chroma, and
   there is a tiny anchor to 0.
6. **Quantise and clamp.** Each region's height is rounded to the level step.
   The datum (0) is the lowest level that holds at least 12% of the land. One
   cue claims at most 15 ft, and the whole draft stays within ±60 ft.
7. **Water, beds.** Water sits one level step below its lowest bank (2.5 ft by
   default, so 1.25 to 3.75 ft depending on the step). Small green regions
   rise one step as planting beds. A region counts as small at 10% of the
   ground or less, and this only applies when green is at most 35% of the
   ground. On a grass map the grass is the ground.
8. **Stairs.** A stair flight is periodic stripes. Each sub-cell window is
   autocorrelated along both axes, and a peak of at least 0.45 at a tread
   period of 0.15 to 0.6 squares is a stair candidate. Candidates group into
   flights. A flight of at least a square whose two ends sit on levels at least
   one step apart becomes a ramped stair from the higher end down to the lower,
   with `dir` pointing down. Stripes between equal levels (a plank bridge, a
   tiled floor) stay floor.

Anything the art does not support stays flat. A flat map gives a flat draft
with rooms, water and void, the same as before this change.

## Options

The dialog opens on every click. Options are remembered per browser
(`localStorage`, key `gluniverse-foundry-modules.dio.autoSetup`).

| Option | Values | Effect |
| --- | --- | --- |
| Read heights from the art | on / off | Off gives a flat draft: rooms, water, void. |
| Light from | Auto, N, NE, E, SE, S, SW, W, NW | The side the light comes from. Forcing it skips the confidence test. |
| Drawn faces | None, N, E, S, W | For art drawn at a slight angle, where a terrace's side wall shows below its edge. Bands falling to that side read as a step up away from it. |
| Height scale | 0.25 to 4 | How tall a shadow reads. At 1 a shadow is as long as its caster is tall. |
| Level step | 1.25, 2.5, 5 ft | Heights are rounded to this. |

The notice after a run says what was used: the light it found (or "no
consistent light"), and the face side if one was set.

## Measured

`node tools/diorama-auto-eval.mjs` runs on the Czepeku Lion Garden
(29 × 58 at 5 ft). Its truth is the map-setup skill's hand-made layout, and the
old row is HEAD's Auto setup. MAE align removes the best constant offset,
because the datum is a choice. Bound F1 counts level boundaries of 2.5 ft or
more, matched within one sub-cell.

| | class | water IoU | MAE align ft | ≤2.5 ft | corr | bound F1 | stairs P/R/dir | levels |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| old (HEAD) | 79.4% | 0.0% | 14.86 | 23.6% | 0.000 | 0.000 | 0/0/0 | 1 |
| new, defaults | 82.1% | 41.0% | 14.71 | 27.1% | 0.109 | 0.673 | 0/0/0 | 4 |
| new, faces S | 82.1% | 41.0% | 5.78 | 42.8% | 0.894 | 0.761 | 0.93/0.80/1.00 | 37 |
| new, faces S, light SW | 82.1% | 41.0% | 10.65 | 24.6% | 0.772 | 0.742 | 0.93/0.73/1.00 | 22 |
| new, light NW | 82.1% | 41.0% | 12.59 | 20.3% | 0.624 | 0.727 | 0.88/0.41/1.00 | 17 |
| new, faces N (wrong) | 82.1% | 41.0% | 27.13 | 15.7% | -0.891 | 0.769 | 1.00/0.80/0.00 | 34 |

The run takes about 93 ms in Node on that map (best of 3), and about 150 ms on
a 100 × 100 grid. A second map (`dio-test/map.png`, 20 × 14, flat with a pond)
gives flat ground, its void corner, the pond at −2.5 ft and no stairs. Its
plank bridge stays floor.

## Limits

- Lion Garden has no consistent cast light (confidence 0.089), so the defaults
  leave it nearly flat. That is the intended answer when the shadows do not
  agree. Its terraces read only when the GM sets Drawn faces to S, because the
  art shows its walls rather than casting shadows.
- A wrong face side inverts the map (faces N gives corr −0.89). A wrong forced
  light gives a weaker, mostly flat draft rather than an inverted one.
- Heights are relative. A raised terrace is right in shape, but its absolute
  height is the shadow's width times the height scale, which depends on the
  artist's sun angle.
- Stairs need visible treads at least a square long, between two levels the
  solve already separated. Spiral stairs, ladders and stairs drawn as a single
  ramp are not found.
- Water detection is colour only. Dark teal foliage can still read as water,
  and murky brown water does not.
- Ramps, pits and cliffs inside a single colour region are not inferred.
- It reads the art at the scene rect only. Tiles and drawings on top of the
  background are not sampled.

For a map Auto setup cannot read, write a layout with the `diorama-map-setup`
skill and import it (docs/DIORAMA_LAYOUT.md).
