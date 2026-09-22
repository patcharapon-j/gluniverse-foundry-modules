# Hexcrawl import format (`glhex-map`, version 1)

A hexcrawl map written outside Foundry — by hand, by a script, or by a language
model — and brought in through **Hexcrawl Import / Export** (scene controls →
Hexcrawl → *Import from JSON…*, or the palette's *Import JSON…*). The same
window exports a scene back out in this format, and exporting then importing
reproduces the map exactly.

The importer is forgiving where that is safe and says so every time it guesses:
**Check** lists every note before anything is written. Parsed by
`scripts/features/hexcrawl/import.mjs` (`parseImport`, `exportMap`).

## Coordinates

Every hex is `col` (column, left → right) and `row` (row, top → bottom), both
**0-based** from the top-left hex. These are Foundry's own grid offsets.

With the default grid (`"orientation": "flat", "offset": "odd"`) hexes are
flat-topped and **odd columns sit half a hex lower** than even ones (Red Blob
Games' "odd-q"). So the six neighbours of `(col, row)` are:

| column parity | neighbours |
|---|---|
| even col | (c, r−1) (c, r+1) (c−1, r−1) (c−1, r) (c+1, r−1) (c+1, r) |
| odd col  | (c, r−1) (c, r+1) (c−1, r) (c−1, r+1) (c+1, r) (c+1, r+1) |

`"offset": "even"` flips that (even columns sit lower). `"orientation": "pointy"`
uses rows instead of columns (odd/even **rows** shifted right).

A coordinate may be written `{ "col": 3, "row": 4 }`, `[3, 4]` (col first), or
`"3,4"`.

## The document

```jsonc
{
  "format": "glhex-map",            // optional but recommended
  "version": 1,

  "scene": {
    "name": "The Long Road North",
    "grid": { "orientation": "flat", "offset": "odd", "size": 100 },  // size = px between hex centres
    "cols": 24, "rows": 16,          // optional: defaults to the furthest hex used.
                                     // This is the map's EXTENT: the scene is created a
                                     // hex larger on every side, and that frame is drawn
                                     // as border — flat black, out of play (see below)
    "background": "worlds/x/maps/north.webp"   // optional scene background image
  },

  "config": { … },                   // optional, every field optional — see Scene config
  "terrains": [ … ],                 // optional custom terrains
  "regions":  [ … ],                 // named groups of hexes
  "layout":   { … },                 // optional ASCII painting
  "hexes":    [ … ],                 // per-hex detail
  "start":    { "col": 0, "row": 0 } // optional: this hex + its sight range are revealed on import
}
```

Layers apply in order **layout → region hex lists → hexes**; a later layer
overrides an earlier one field by field.

### Terrains

Built-in terrain ids (the *Journey to Horizon* habitats plus Ocean):

`grassland` `forest` `tropical` `wetland` `aquatic` `ocean` `drylands`
`rolling` (hills) `mountain` `frozen` `badlands` `underground`

Common words are accepted and mapped — `plains`, `woods`, `jungle`, `swamp`,
`lake`, `river`, `sea`, `desert`, `hills`, `mountains`, `tundra`, `snow`,
`wasteland`, `cave`, `underdark`, and more. **`shadowblighted`** (or
`blighted`) is not a terrain: it sets the blight overlay on whatever habitat is
underneath, exactly as the book rerolls the underlying habitat.

An unknown terrain word is **created as a custom terrain** with a muted
generated colour and no glyph, and noted. To control it, declare it:

```json
"terrains": [
  { "id": "ashfield", "name": "Ash Field", "color": "#7a6f66", "glyph": "lava" }
]
```

Glyphs: `grass tree palm marsh wave deep dune hills mount frozen mesa cave road
ruins crystal fungus lava star none`.

### Regions

```json
"regions": [
  {
    "id": "whisperwood",                 // optional; derived from name
    "name": "The Whispering Wood",
    "nameKnown": false,                  // players see "???" until true (default false)
    "terrain": "forest",                 // default terrain for its hexes
    "rating": 3,                         // terrain rating 1–4 (Optimal/Fair/Rough/Extreme)
    "color": "#6aa37d",                  // optional: the colour of its rim on the map
    "blight": false,
    "encounter": "A pack of hungry wolves shadows the party.",   // GM-only
    "encounterTable": "RollTable.abc123", // optional RollTable UUID
    "rumor": { "text": "The trees remember the old road.", "truth": "partial", "known": true },
    "notes": "GM notes",
    "hexes": [[1, 1], [2, 1], [1, 2]]    // [col, row] — the hexes that belong to it
  }
]
```

`truth` is `"true"` / `"partial"` / `"false"` (JSON booleans `true`/`false` are accepted too; a note for the GM); players see the
rumour text only when `known` is true. Hexes reference regions by `id` or by
`name`.

A region's **name** reaches players only when `nameKnown` is true — on revealed
hexes too. Until then, wherever the name would show (the map label, the
tooltip), players see **???**. The GM ticks *Name known to players* in the
region editor.

### Hexes

```json
"hexes": [
  { "col": 2, "row": 1,
    "terrain": "forest",          // overrides the region's terrain
    "region": "whisperwood",      // id or name
    "rating": 4,                  // overrides the region's rating
    "state": "revealed",          // hidden (default) | revealed | masked | sight | any preset id
    "mask": { "name": true },     // with a masked state: per-field overrides (region,terrain,rating,name,landmarks,rumor)
    "visited": true,
    "blight": true,
    "border": true,               // out of play: flat black, no sight, no entry.
                                  // Omit it and the hex follows scene.cols/rows;
                                  // `false` brings a hex outside them into play.
    "cost": 1,                    // travel cost override, in the scene's unit
    "name": "The Grey Scar",      // overrides the region name for this hex
    "notes": "GM notes",
    "landmarks": [
      {
        "icon": "tower-observation",   // or "img": a path to an image
        "label": "Old Watchtower",
        "visibility": "visible",       // follow (default) | visible | hidden
        "color": "#8ad8ff",            // optional #rrggbb; omit for the default badge colour
        "size": 1.25                   // optional badge size, 0.6–2 (default 1); out of range is clamped
      }
    ]
  }
]
```

### Border: what is not map

A scene is created one hex larger than `scene.cols` × `scene.rows` on every
side, so the map never runs off its own canvas. That frame is **border**: flat
black on every screen, no survey outline and no "?", and the party can neither
see into it nor walk into it. It costs nothing to say — the map's extent is
`scene.cols`/`scene.rows`, and every hex outside it is border by itself.

Per hex, `"border": true` marks one *inside* the extent (a chasm, a cliff, a
wall of sea), and `"border": false` brings one *outside* it back into play. Omit
the field and the hex follows the extent; a GM can do the same from the palette's
Border brush or the hex editor's tick, and Erase puts a hex back to following it.

Visibility states: **hidden** is fog; **revealed** shows everything; a
**masked** hex shows players only the fields its mask allows, each independent:

| field | what players see |
|---|---|
| `region` | the region's **shape** (its border) — nothing else about it |
| `terrain` | the terrain type (tile colour and glyph) |
| `rating` | the difficulty (terrain-rating pips) |
| `name` | the region / hex name (implies the shape; still **???** until the region's `nameKnown`) |
| `landmarks` | landmarks set to `follow` |
| `rumor` | the region's rumour, when `known` |

Write a preset id as the `state`, then adjust any field with `mask` — e.g.
`"state": "silhouette", "mask": { "rating": true }` is the shape and the
difficulty, nothing else. `"masked"` alone (or `"sight"`) uses the scene's sight
checklist (`config.sightFields`), resolved live: re-tick it and every such hex
follows.

### Mask presets (optional)

A map carries its own presets, which the GM can rename, re-tick, delete and add
to in the scene settings. Omit `presets` and a map starts with three:
**silhouette** (region shape only), **glimpsed** (shape + terrain + rating +
landmarks), **rumoured** (shape + name + known rumour). Give `presets` and the
map gets exactly those instead:

```json
"presets": [
  { "id": "scouted", "name": "Scouted", "fields": { "region": true, "terrain": true, "rating": true } },
  { "id": "silhouette", "fields": { "region": true } }
]
```

A field left out is off. `name` is optional (a seed id shows its built-in name).
The ids `hidden`, `masked`, `revealed` and `sight` are reserved. A hex whose
preset no longer exists falls back to the sight checklist.

Landmarks (at most 3 per hex): `icon` is a Font Awesome 6 name, with or without
`fa-`/`fa-solid` (`"tower-observation"`, `"dungeon"`, `"campground"`,
`"skull"`, `"place-of-worship"`, …) — or `img` for an image path instead.
`visibility`: `follow` (default — shown when its hex shows landmarks),
`visible` (known to players — intel — shown even while its hex is masked or hidden: the tower on the horizon), `hidden` (GM
only: the book's hidden point of interest). `journal` takes a Journal UUID.
`color` (`#rrggbb`) paints that badge, its mark and its row in the GM's editor;
leave it out for the default badge colour. `size` scales the badge and its mark
(0.6–2, default 1) — anything outside that is clamped, and badges sharing a hex
are spread and, if need be, scaled down together so none overlaps or leaves its
hex. In the GM's own view a landmark the party cannot see yet is drawn hatched
behind a dashed rim, so `hidden` (and `follow` on a hex that hides its
landmarks) is visible as such at a glance.

### Art: icons and ground textures (optional)

Every built-in terrain ships with an image icon (`assets/hexcrawl/icons/<id>.webp`,
white on transparency, tinted by the terrain colour). A custom terrain may name
its own, and a region may carry icon **variants** and a **ground texture**:

```json
"assetBase": "https://my-bucket.s3.eu-central-1.amazonaws.com/assets/dead-zone/",
"terrains": [ { "id": "ashfield", "name": "Ash Field", "color": "#7a6f66", "icon": "icons/ashfield.webp" } ],
"regions": [
  { "name": "Hästmark", "terrain": "grassland",
    "icon": ["icons/dz-c-1.webp", "icons/dz-c-2.webp", "icons/dz-c-3.webp"],
    "texture": { "src": "textures/dz-c.webp", "mode": "fit" } }
]
```

- `icon` — one path or up to 4. Each hex picks one variant by a stable hash of
  its position, so a region does not repeat one stamp. Icons are white shapes on
  transparency; the map tints them.
- `texture` — a path, or `{ src, mode, scale }`. `mode: "fit"` (default) lays
  ONE image over the region's whole bounding box: every hex shows a different
  part of it, nothing repeats, and neighbouring hexes continue it without a
  seam. `mode: "tile"` repeats a seamless image every `scale` hexes. How much
  shows through the glass is `config.texStrength` (0–1, default 0.55).
- `assetBase` — relative art paths are joined to it (an S3 bucket, a CDN, a
  world folder). Absolute URLs and paths starting with `/` are left alone.
  Without it, relative paths are Foundry Data paths.

Art follows visibility: a hex shows its icon and texture only when players may
see its terrain, and region art only when they may also see its region. A
silhouette shows neither.

### Layout (optional ASCII painting)

Quick for big areas; each character is one hex, row by row from the top.

```json
"layout": {
  "legend": {
    "^": "mountain",
    "~": { "terrain": "ocean", "rating": 4 },
    "F": { "terrain": "forest", "region": "The Whispering Wood" },
    ".": null
  },
  "rows": [
    "..FF^^~~",
    ".FFF^^~~",
    "........"
  ]
}
```

A legend value is a terrain word or any object of hex fields (without
`col`/`row`). `.` and space are blank; any other character not in the legend is
noted and left blank. Set `"spaces": true` to make space a legend symbol.

### Scene config

Every field optional; defaults follow the book.

```json
"config": {
  "sight": 1,                    // hexes the party sees around itself (0–6)
  "sightState": "masked",        // what hexes in sight become: masked | revealed (never lowered)
  "sightFields": { "region": true, "terrain": true, "rating": true, "name": true, "landmarks": false, "rumor": false },
                                 // with "masked": what players learn about them (the live "sight" preset)
  "render": "tiles",             // tiles | tint (over background art) | outlines
  "alwaysPips": false,
  "trail": true,
  "playersMove": true,
  "dice": { "die": 6, "perRating": [1, 2, 3, 4], "trigger": 1 },   // encounter check: N dX, a result ≤ trigger triggers
  "cost": { "unit": "days", "table": [1, 2, 3, 4], "watchHours": 4 }, // unit: minutes | hours | watches | days
  "advanceTime": false,          // advance world time by the cost (needs the Clocks time engine)
  "arrivalCard": false,          // whisper an arrival card to the GM on each move
  "texStrength": 0.55            // how much of a region texture shows through (0–1)
}
```

An older `"autoPreset"` (one preset id) is still read, as that preset's ticks.

## Placement

A new scene is sized to the map plus a **frame of blank, uncharted hexes** all
round (one hex deep; two along the offset axis so odd/even parity survives), so
the map never runs into the scene edge. Import coordinate (0,0) is stored on the
map, so *Replace this scene's map* and *Export* line up with the same frame.

## Limits

200 × 200 hexes, 20,000 hex entries. Everything outside is noted and skipped.

## A complete minimal example

The window's **Copy example** button puts this on the clipboard
(`exampleImport()` in `import.mjs`):

```json
{
  "format": "glhex-map", "version": 1,
  "scene": { "name": "The Long Road North", "grid": { "orientation": "flat", "offset": "odd", "size": 100 }, "cols": 8, "rows": 6 },
  "config": { "sight": 1, "sightState": "masked",
              "sightFields": { "region": true, "terrain": true, "rating": true, "name": true, "landmarks": false, "rumor": false } },
  "terrains": [{ "id": "ashfield", "name": "Ash Field", "color": "#7a6f66", "glyph": "lava" }],
  "regions": [
    { "id": "whisperwood", "name": "The Whispering Wood", "nameKnown": true, "terrain": "forest", "rating": 3,
      "encounter": "A pack of hungry wolves shadows the party.",
      "rumor": { "text": "The trees remember the old road.", "truth": "partial", "known": true },
      "hexes": [[1, 1], [2, 1], [1, 2], [2, 2]] },
    { "id": "kingsroad", "name": "King's Road", "terrain": "grassland", "rating": 1, "hexes": [[0, 0], [1, 0], [2, 0], [3, 0]] }
  ],
  "layout": {
    "legend": { "^": "mountain", "~": { "terrain": "ocean", "rating": 4 }, "a": "ashfield", ".": null },
    "rows": ["....^^~~", "....^^~~", "...a..~~", "...aa...", "........", "........"]
  },
  "hexes": [
    { "col": 2, "row": 1, "state": "revealed", "landmarks": [{ "icon": "tower-observation", "label": "Old Watchtower", "visibility": "visible", "color": "#8ad8ff", "size": 1.25 }] },
    { "col": 4, "row": 3, "terrain": "shadowblighted", "rating": 4, "name": "The Grey Scar" }
  ],
  "start": { "col": 0, "row": 0 }
}
```
