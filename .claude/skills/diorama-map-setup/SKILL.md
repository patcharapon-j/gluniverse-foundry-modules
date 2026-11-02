---
name: diorama-map-setup
description: "Read a battle map image and write a Diorama layout (JSON) that gives it 3D height: terraces, cliffs, water, stairs, void. The GM imports the file in Foundry (Terrain editor → Import layout) and saves. Use when asked to set up, model, or 'process' a map for the Diorama 3D view, to write or fix a layout file, or when Auto setup is not good enough for a map."
---

# Diorama map setup

You turn a top-down battle map into a layout file. A layout is JSON: a palette
of height levels, then shape ops painted in order. It compiles to the terrain
the 3D view draws and the movement and sight rules read, so heights you write
are rules at the table, not only looks. The format reference is
`docs/DIORAMA_LAYOUT.md`; a complete worked example is
`examples/lion-garden.json` next to this file. Read both before you start.
`examples/rooftop-nest.json` is the off-grid one: a perspective-drawn roof
whose parapets, units and huts are slabs measured to their painted rims, with
kits for the mast and the dish.

You need: the map image, its size in squares (columns × rows), and feet per
square (5 unless told otherwise). If the user only gives the image, the
scene's grid is the authority: ask for it rather than guessing from the art.

## 1. See the grid, not the picture

Never estimate coordinates from a whole map at once. Render it with every
square numbered and read it in crops of about 12–20 squares a side:

```bash
node tools/diorama-layout.mjs grid --image=<map> --cols=<N> --crop=0:20,0:29 --out=.preview/dio-grid.html
node tools/preview-server.mjs   # then open /.preview/dio-grid.html and screenshot it
```

The page opens from `file://` too. Walk the whole map crop by crop and write
down, per region, which squares it covers and what it is. Coordinates are
`[row, column]` from the map's top-left corner; ranges are half-open
(`rows: [4, 9]` is rows 4–8); halves (`12.5`) are allowed and are the finest
step the terrain stores.

## 2. Decide the levels before drawing anything

Read the art for height cues: cast shadows (the side they fall on is lower),
stairs and their direction, walls seen edge-on, water, rails, planters, and
anything that reads as "you could fall off this". Then pick a small set of
named levels. These conventions keep maps consistent across a campaign:

| Thing | Height |
|---|---|
| Ground the party arrives on | 0 ft, or the map's middle level if most of it is raised |
| Kerb, low planter, dais step | 2.5–5 ft (2.5 ft is still a walkable step) |
| Terrace, plaza step-up, ledge | 10–15 ft per level |
| Building, tower, statue plinth | 15–30 ft; a giant statue up to 50–80 ft |
| Water surface | 1.25–3.75 ft below its bank (it draws a waterline on the bank) |
| Pit | 10 ft or more below; use kind `pit` |
| Off the map, black borders, sky | kind `void` |

Rules that bite:

- A rise over 2.5 ft is a climb and a drop over 2.5 ft is a fall. Every
  walkable route between levels needs `stairs` or a `ramp` op, with `down`
  pointing the way it descends and `top` / `bottom` matching the levels it
  joins. Stairs drawn without that are a cliff the party cannot use.
- Do not paint walls. Foundry walls are separate documents; the terrain is
  only the ground. A thin parapet or balustrade can be a 2.5–5 ft strip.
- Keep the palette small (6–10 entries). Use `h` on an op for one-off heights
  rather than a new entry per height. `material` (stone, earth, brick, wood,
  ice, edge) is what the cliff faces look like.
- Symmetric maps are common. Set `"mirror": {"cols": <N>}` and put
  `"mirror": true` on ops to paint both halves from one statement.

## 3. Write ops coarse to fine

Later ops paint over earlier ones. Order them like a sculptor:

1. `base`: the most common level fills the map.
2. Big regions: each terrace or plaza as a `rect` (or `polygon` for odd shapes).
3. Features on them: pools, beds, plinths, buildings.
4. Stairs and ramps last among the big shapes, so nothing paints over a flight.
5. Small details: pillars as `circle`s, rails as thin `rect`s.

The ops are `"rect"`, `"circle"`, `"ellipse"`, `"polygon"`, `"stairs"`,
`"ramp"` and `"grid"`. Use `"grid"` (an ASCII block with a key) for organic
areas such as cave walls or broken ground, where rectangles would take
dozens of ops. Give big ops a `"note"` naming what they are; the importer
ignores it and the next person reading the file will thank you.

## 3b. Terrain, slab, prop, kit or model?

A layout can also place `props`: objects that stand on the terrain. The
reference is the Props section of `docs/DIORAMA_LAYOUT.md`, and the shape
table in `docs/DIORAMA_PROPS.md`. Choose by what the thing is, not by how it
looks:

- **Terrain** is ground on the grid: anything you walk on as a level whose
  edges follow the squares, anything wider than a room, water, pits, stairs
  between levels. Terrain stores half squares, so a shape finer than that is
  lost.
- **A slab** (`"shape": "slab"`) is ground off the grid: a dais drawn at 20
  degrees, a round platform, a ledge whose painted rim falls a third of the way
  into a square, a loading dock with a slanted edge. Give it `points`, its
  outline as `[row, col]` corners on the map at any precision, and `h` its
  height. It draws like terrain (the map on top, a cliff around it, `cliff`
  for the side material) and is floor at its top in the rules. Put a slab
  over terrain at the level below it, not instead of terrain.
- **A prop** is a thing standing on the ground: round or turned or thin (a
  column 0.7 squares across, a crate at 10 degrees, a lone tree, a statue), or
  something you would move between sessions. Beyond the basic shapes there are
  `fence` and `parapet` (a rail or low wall along `w`), `stairs` (a short
  flight that is a ramp in the rules, for steps onto a dais or a slab),
  `platform` (a table), `pipe` (with a `path` for a run that turns),
  `beam`, `sign`, `cross`, `bowl`, `brazier` (a fire, whatever its label),
  `lamp`, the roofs `gable`, `hip`, `lean`, `spire`, and `lathe` (an urn or
  a turned post, with a `profile`) and `extrude` (any outline raised a little,
  such as a rug or a flagstone).
- **A kit** is a thing built from several primitives that appears more than
  once: a market stall, a well with a roof, a cart. Define it once in `kits`,
  then place it with `"shape": "kit", "kit": "<name>"`. Give scenery parts
  `"solid": false` so only the parts you could stand on or bump into are in
  the rules.
- **A model** is a `.glb` or `.gltf` the user already has in their Foundry
  data. Only use one when the user names the file; never invent a path.
- Roofs fade when a figure is under them, so a covered market can be roofed
  without hiding the tokens inside. A roof is scenery by default.
- A prop is `solid` by default (bushes, rings and cards are scenery). Solid
  props block movement and sight like raised ground, so the same rules as
  terrain apply: do not wall off a route the map leaves open. Make
  decoration that the party can walk through `"solid": false`.
- Put props on the level they stand on and leave `elev` out; they find the
  ground themselves. Stack by listing the lower prop first.
- Be sparing. A few props that pick out what the art shows (the trees it
  paints, the columns, the cargo on a dock) read better than a scatter.
  Never put a solid prop on a square a token starts on.
- `"mirror": true` works as it does on ops, and turns the copy with it. A
  slab's outline and a pipe's path are reflected point by point; a kit
  reflects its parts.

### Measuring a fractional edge

A slab is only as good as its corners. For each corner, crop the grid page
around it (`--crop` of 4 to 6 squares) so a square is 100 pixels or more, find
the square the painted rim's corner sits in, and read its fraction of the
square across and down by eye in tenths. `[12.3, 7.65]` is row 12 and three
tenths, column 7 and sixty-five hundredths. Measure to the painted rim (the
top edge of the cliff in the art, not the foot of its shadow), because the slab
shows the map exactly where it stands. Then re-check on the layout page: the
cyan outline must sit on the rim in every crop.

### Crafting a kit

Build it at its own origin, as if standing in the middle of it: the parts'
`at` are `[dRow, dCol]` from there, and each part's `elev` is above the kit's
base. Work bottom up. For a market stall:

```json
"kits": {
  "stall": { "parts": [
    { "shape": "box",      "at": [0, 0],      "w": 2, "d": 1, "h": 4, "mat": "wood" },
    { "shape": "cylinder", "at": [0.6, -1.1], "w": 0.12, "d": 0.12, "h": 7, "mat": "wood", "solid": false },
    { "shape": "cylinder", "at": [0.6, 1.1],  "w": 0.12, "d": 0.12, "h": 7, "mat": "wood", "solid": false },
    { "shape": "gable",    "at": [0, 0],      "w": 2.6, "d": 1.6, "h": 3, "elev": 7, "mat": "cloth", "tint": "#a33a2a" }
  ] }
}
```

then `{"shape": "kit", "kit": "stall", "at": [12.5, 8], "rot": 90}` in
`props`. `scale` sizes a placement (`1.5` is half as big again). A part cannot
be a slab, a card, a model or another kit. Keep kits under about a dozen
parts; the art carries the detail.

## 4. Check, look, fix, repeat

```bash
node tools/diorama-layout.mjs check <layout.json> --cols=<N> --rows=<M> --image=<map> --crop=0:20,0:29
```

It compiles exactly as Foundry will, prints every problem as a sentence naming
the op, prints a per-square height map, and writes `.preview/dio-layout.html`:
the compiled terrain over the art, with each square's top in feet and arrows
down every flight. Props are outlined on it (amber solid, green scenery, violet
GM only, slabs in cyan with a dot on every corner, a kit with each part drawn
inside it) with their shape and top in feet, and listed in the console with
their base and top. Screenshot it crop by crop and compare with the art. Look
for: a level edge that misses the painted edge by a square, stairs whose arrow
points up, water that is not below its bank, a route between levels with no
stairs, and void where there is map. Fix and re-run until it compiles with no
errors and every crop matches.

## 5. Hand it over

Give the user the JSON file. They import it in Foundry one of two ways:

- **Editor**: open the Diorama view, then Edit terrain, then Import layout.
  Paste the JSON or pick the file, check the draft on the canvas, then Save.
  Undo works until they close the editor.
- **Macro**: `await game.modules.get("gluniverse-foundry-modules").api.features.diorama.importLayout(layout)`.
  This writes at once and returns `{ ok, errors, warnings, props, moved, missing }`.

A layout with a `props` key replaces the scene's props; without one it leaves
them alone.

`tokens` in the layout moves named tokens onto their squares and stands them
on the ground there; add `altitude` for flyers. Leave `tokens` out unless the
user asked for a starting setup.
