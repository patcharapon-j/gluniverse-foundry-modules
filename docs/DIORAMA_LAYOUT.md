# Diorama layouts

A layout is a terrain written as JSON: a palette of named levels, then shapes
painted onto the map in order. It is how a map gets set up outside the brush
editor, by a GM by hand or by an AI agent that has read the art (the
`diorama-map-setup` skill in `.claude/skills/`). `terrain/layout.mjs` compiles
it; the compile is pure, so `tools/diorama-layout.mjs` and the check tool run
exactly what Foundry runs.

## Importing

- Terrain editor, then **Import layout**: paste or pick a `.json`. It replaces
  the draft as one undoable step; Save writes it. Tokens named in the layout
  move when you save, onto the saved ground.
- API, GM only, writes at once:
  `game.modules.get("gluniverse-foundry-modules").api.features.diorama.importLayout(layout, { scene, tokens })`
  resolves `{ ok, errors, warnings, moved, missing }`.

Every problem is reported as a sentence naming the op, and nothing is written
while there is one. A shape that misses the map is a warning, not an error.

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

## Example

`.claude/skills/diorama-map-setup/examples/lion-garden.json` sets up the
Czepeku Lion Garden: 8 palette entries, 61 ops, most of them mirrored. The
check tool compiles it and holds it to the documented heights and to perfect
symmetry.
