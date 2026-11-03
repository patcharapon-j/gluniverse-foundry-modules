# Diorama layouts

A layout is a terrain written as JSON: a palette of named levels, then shapes
painted onto the map in order. It is how a map gets set up outside the brush
editor, by a GM by hand or by an AI agent that has read the art (the
`diorama-map-setup` skill in `.claude/skills/`). `terrain/layout.mjs` compiles
it; the compile is pure, so `tools/diorama-layout.mjs` and the check tool run
exactly what Foundry runs.

## Importing

- Terrain editor, then **Import layout**: paste or pick a `.json`. It replaces
  the draft (and its props, when it has a `props` key) as one undoable step;
  Save writes it. Tokens named in the layout move when you save, onto the
  saved ground, on top of any solid prop under them.
- API, GM only, writes at once:
  `game.modules.get("gluniverse-foundry-modules").api.features.diorama.importLayout(layout, { scene, tokens })`
  resolves `{ ok, errors, warnings, props, moved, missing }` (`props` is how
  many were written, or null when the layout had no `props` key).

Every problem is reported as a sentence naming the op, and nothing is written
while there is one. A shape that misses the map is a warning, not an error.

A Map Maker Diorama Bundle carries a layout too, with its models beside it;
**Import bundle** and `importBundle(folder)` read it from the folder
(docs/DIORAMA_BUNDLE.md).

## Coordinates

`[row, column]` in squares from the top-left corner of the **map** (the scene
rect), not the padded canvas; the importer adds the padding offset. Fractions
are allowed and halves are the finest the terrain stores (2×2 sub-squares per
square). A shape covers every sub-square whose centre is inside it, and ranges
are half-open: `rows: [4, 9]` is rows 4 through 8.

## Top level

| Key | |
|---|---|
| `format` | `"gluniverse-diorama-layout"` (optional, checked when present) |
| `version` | `1` |
| `name` | free text |
| `map` | `{cols, rows}` the layout was written for; a mismatch is a warning |
| `heightUnit` | `"ft"` (default, scene units) or `"q"` (quarter squares) |
| `palette` | entries, below; at most 32 |
| `base` | palette name that fills the map first (default: the first non-void entry) |
| `mirror` | `{cols: N}` and/or `{rows: N}`: the axis an op's `mirror` reflects across (`c → N − c`) |
| `ops` | shapes, below, painted in order |
| `tokens` | optional placements, below |
| `props` | optional objects standing on the terrain, below; at most 2000 |
| `kits` | optional crafted props, `{ "name": { "parts": [ … ] } }`, below. `models` is read as `kits` with a warning |

## Palette entries

`{name, h, kind, material, color}`. `name` is unique (case-insensitive) and is
how ops refer to the entry. `kind` is one of `floor`, `water`, `pit`, `stairs`,
`ramp`, `void`. `material` is the cliff face: `stone`, `earth`, `brick`,
`wood`, `ice`, `edge`. `color` is the editor swatch. A `void` entry is added
for outside the map if the palette has none.

## Ops

Every op names a `layer` and may set `h` to override that entry's height, and
`mirror: true` (or `"cols"`, `"rows"`, `"both"`) to paint a reflected copy.
`note` is ignored.

| `op` | Fields |
|---|---|
| `rect` | `rows: [r0, r1]`, `cols: [c0, c1]` |
| `circle` | `center: [r, c]`, `radius` |
| `ellipse` | `center: [r, c]`, `radii: [rows, cols]`, optional `clip: {rows?, cols?}` |
| `polygon` | `points: [[r, c], …]` (3 to 256, even-odd fill) |
| `stairs` / `ramp` | `rows`, `cols`, `down: "N"/"E"/"S"/"W"` (the way it descends), `top`, `bottom`; `layer` defaults to the first entry of that kind |
| `grid` | `origin: [r, c]`, `res: "cell"` or `"sub"`, `rows: ["..##.."]`, `key: {"#": "Ledge", "~": {"layer": "Pond", "h": -2.5}}`; `.` and space leave a square alone |

A flight's top sub-row sits at `top` and each step drops evenly, so the last
step is one riser above `bottom`, the ground it lands on. A mirrored flight
faces the mirrored way.

## Tokens

`{name | id, cell: [r, c], elevation?, altitude?}`. `cell` is the token's
top-left square. Without `elevation` the token stands on the highest ground
under its footprint, plus `altitude` (which is also stored as the token's
Diorama altitude). Both are in `heightUnit`. Tokens are teleported, so a
placement on a ledge is not refused as a climb.

## Props

Props are objects that stand on the terrain: trees, crates, pillars, rocks,
statues built from primitives (docs/DIORAMA_PROPS.md). Leave `props` out and
the scene keeps the props it already has; give `props: []` to clear them.

`{shape, at: [r, c], w?, d?, h?, elev?, rot?, mat?, tint?, solid?, hidden?, roof?, label?, img?, id?, mirror?}`,
plus the shape's own keys below.

| Key | |
|---|---|
| `shape` | `box`, `cylinder`, `cone`, `sphere`, `dome`, `pyramid`, `wedge`, `torus`, `capsule`, `arch`, `pillar`, `crate`, `barrel`, `rock`, `tree`, `pine`, `bush`, `card`, `slab`, `hex`, `octagon`, `pipe`, `stairs`, `platform`, `fence`, `parapet`, `beam`, `sign`, `cross`, `bowl`, `brazier`, `lamp`, `gable`, `hip`, `lean`, `spire`, `lathe`, `extrude`, `kit`, `model` (the table in docs/DIORAMA_PROPS.md says what each is) |
| `at` | the **centre** of the footprint, `[row, col]` in map squares; `[3.5, 7.5]` is the middle of square (3, 7) |
| `w`, `d` | footprint width and depth in squares, before turning (0.1 to 64); default per shape |
| `h` | height, in `heightUnit`; default per shape |
| `elev` | where its base sits, in `heightUnit`; left out, it stands on whatever is under it (the ground, or a solid prop listed earlier) |
| `rot` | degrees clockwise. A wedge rises toward its back, so `rot: 0` descends to the south |
| `mat` | `stone`, `marble`, `wood`, `metal`, `foliage`, `crystal`, `plaster`, `cloth`, `earth`, `ice`, `map` |
| `tint` | `"#rrggbb"` multiplied over the material |
| `solid` | blocks movement and sight and can be stood on (world setting "Solid props block"); default per shape (bush, ring and card are scenery) |
| `hidden` | GM only: drawn as a ghost for the GM, never for players, never in the rules |
| `label` | the GM's name for it; error sentences use it |
| `img` | `card` only: the image path |
| `mirror` | `true`, `"cols"`, `"rows"` or `"both"`, like an op. The copy is turned with it (`rot → −rot` across columns, `180 − rot` across rows) |
| `roof` | it fades while a figure is under it; default on for `gable`, `hip`, `lean`, `spire` |

The shapes with keys of their own:

| Key | Shape | |
|---|---|---|
| `points` | `slab`, `extrude` | the outline, 3 to 256 `[row, col]` corners **on the map**, at any precision. It places the prop, so `at` and `rot` are ignored (with a warning). Mirrored copies reflect it point by point |
| `cliff` | `slab` | the side material, a palette `material` or `metal` |
| `path` | `pipe` | its centre line, 2 to 64 `[row, col]` or `[row, col, height]` points on the map; the height is the centre's, in `heightUnit`, and defaults to resting on the floor |
| `thick` | `pipe` | a path pipe's width in squares |
| `profile` | `lathe` | 2 to 48 `[radius, height]` pairs, each 0 to 1 of the half-width and the height, bottom to top |
| `bevel` | `extrude` | the rounded top edge, 0 to 0.5 squares |
| `src` | `model` | required: a `.glb` or `.gltf` path, as Foundry serves it (`worlds/<world>/models/well.glb`) |
| `scale` | `model`, `kit` | a model: squares per model unit (left out, it fits inside `w × d × h`). A kit: a size factor for every part |
| `rules` | `model` | `"box"` (default: its `w × d × h` box is in the rules when solid) or `"none"` (scenery) |
| `bright` | `model` | 0.1 to 2 (default 1): its colour × this before the light, never its glow. Out of range is an error; on another shape it is ignored with a warning |
| `kit` | `kit` | the name of one of the layout's `kits`. A kit's `w`, `d` and `h` come from its parts, so use `scale` |

A slab, a pipe and an extrude may still use `at` with `w × d` (a straight pipe
runs along `w`).

A prop outside the map, or one sitting on its own mirror axis with `mirror`
set, is a warning, and so is a key the shape does not keep. Every other
mistake is an error that names the prop, as `props[3] (pillar "North column"): …`.

## Kits

A kit is a prop built from primitives, defined once and placed many times. It
is stored inline in each placement, so the scene does not depend on the
layout afterwards.

```json
"kits": {
  "stall": { "parts": [
    { "shape": "box",      "at": [0, 0],       "w": 2, "d": 1, "h": 4, "mat": "wood" },
    { "shape": "cylinder", "at": [0.6, -1.1],  "w": 0.12, "d": 0.12, "h": 7, "mat": "wood", "solid": false },
    { "shape": "cylinder", "at": [0.6, 1.1],   "w": 0.12, "d": 0.12, "h": 7, "mat": "wood", "solid": false },
    { "shape": "gable",    "at": [0, 0],       "w": 2.6, "d": 1.6, "h": 3, "elev": 7, "mat": "cloth", "tint": "#a33a2a" }
  ] }
},
"props": [{ "shape": "kit", "kit": "stall", "at": [12.5, 8], "rot": 90, "mirror": true }]
```

A part takes `shape at w d h elev rot mat tint solid` and the outline, path,
profile or bevel its shape keeps. `at`, `points` and `path` are `[dRow, dCol]`
from the kit's origin; `elev` is above the kit's base (0 by default); heights
are in `heightUnit`. A part may be any primitive except `slab`, `card`, `model`
or `kit`. At most 64 parts. In the rules the kit is the union of its solid
parts, so give scenery parts (a roof, an awning) `solid: false`; roof parts
already are. A mirrored kit reflects its parts in its own frame, so a stall
with its counter on the left has it on the right in the copy.

## Example

`.claude/skills/diorama-map-setup/examples/lion-garden.json` sets up the
Czepeku Lion Garden: 8 palette entries, 37 ops (28 of them mirrored) for the
levels, and 51 props (89 once mirrored). The structures the art paints off the
half-square grid are 15 slabs measured to their painted rims: the lion plinths,
the garden beds, the round planter, the corner towers, the gate piers, the
plaza planters, the quay lions, the palace tower, the spire and the lion-head
fountain. Five kits (a seated lion, a globe post, a finial, a rowboat and a
sailboat) are placed 19 times, with a parapet along the plaza edge and the
quay stair, palms, cypresses, garden lamps, rotunda columns and a fountain
bowl. The boats follow the art, which is not symmetric, so they are not
mirrored. The check tool compiles it and holds it to the documented heights,
to a symmetric terrain, to a twin for every mirrored prop, and to no prop
standing on a token's square.

`examples/rooftop-nest.json` beside it is a snowy roof drawn in perspective:
one terrain polygon for the deck and two flights down to the street, 27 slabs
measured to the painted rims (parapets, air-con units, ducts, hut, shed,
generator), and kits for the radio mast, the satellite dish and the antennas.
