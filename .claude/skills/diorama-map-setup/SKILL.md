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

## 4. Check, look, fix, repeat

```bash
node tools/diorama-layout.mjs check <layout.json> --cols=<N> --rows=<M> --image=<map> --crop=0:20,0:29
```

It compiles exactly as Foundry will, prints every problem as a sentence naming
the op, prints a per-square height map, and writes `.preview/dio-layout.html`:
the compiled terrain over the art, with each square's top in feet and arrows
down every flight. Screenshot it crop by crop and compare with the art. Look
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
  This writes at once and returns `{ ok, errors, warnings, moved, missing }`.

`tokens` in the layout moves named tokens onto their squares and stands them
on the ground there; add `altitude` for flyers. Leave `tokens` out unless the
user asked for a starting setup.
