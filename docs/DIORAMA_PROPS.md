# Diorama props

Props are objects that stand on the Diorama board: trees, crates, columns,
rocks, arches, fences, stairs, roofs, braziers, image cards, slabs of raised
ground at any size and turn, kits built from several primitives, and the GM's
own 3D models. They sit on top of the terrain (docs/DIORAMA_LAYOUT.md for the
terrain itself) and, when solid, they are part of the rules: tokens stand on
them, bump into them and hide behind them.

How each part is controlled:

| What | Who | Where |
|---|---|---|
| Which props a scene has, and each one's shape, size, turn, material, colour, solid, GM only | the GM, per scene and Level | Terrain editor, Props mode; or a layout's `props` |
| Whether solid props block movement and sight | the world | setting "Solid props block" (`dio.propsBlock`, default on) |
| How much detail they draw (relief, foliage sway) | each user | Diorama graphics: Detail (`dio.detail`), and the quality preset |
| Wind (foliage sway) | the scene | Diorama environment: wind |

## The model

`scripts/features/diorama/terrain/props.mjs` (pure). A prop is a plain object;
its keys are stored data and are never renamed.

| Key | |
|---|---|
| `id` | unique per Level, `[A-Za-z0-9_-]`, at most 32. A missing or repeated id is minted from the prop's place in the list and its content, so every client mints the same one |
| `shape` | `box cylinder cone sphere dome pyramid wedge torus capsule arch pillar crate barrel rock tree pine bush card`, then `slab hex octagon pipe stairs platform fence parapet beam sign cross bowl brazier lamp gable hip lean spire lathe extrude kit model` (see Shapes below) |
| `x`, `y` | the footprint's centre in grid squares on the canvas (2.5 is the middle of column 2) |
| `w`, `d`, `h` | width, depth and height in squares (0.1 to 64; height from 0.05). One square of height is one grid distance |
| `elev` | where the base sits, in squares, or `null` to stand on whatever is under the footprint |
| `rot` | degrees clockwise, `[0, 360)` |
| `mat` | `stone marble wood metal foliage crystal plaster cloth earth ice map` |
| `tint` | `#rrggbb` multiplied over the material, or `null` |
| `solid` | blocks movement and sight and can be stood on |
| `hidden` | GM only |
| `label` | the GM's name for it, at most 60 characters |
| `img` | `card` only: the image path. A path longer than 2048 characters is dropped rather than cut, because a cut path decodes as a blank card |
| `roof` | it fades away while a figure is under it (which roofs fade, and when, is the buildings layer's call). On by default for `gable hip lean spire`, off for everything else, and any prop can be one |
| `points` | `slab` and `extrude`: the outline, 3 to 256 `[x, y]` corners relative to `x, y`, unturned. Kept to three decimals |
| `cliff` | `slab` only: the side material, one of the terrain's cliff materials (`earth stone edge ice wood brick metal`, default `stone`) |
| `path` | `pipe` only: its centre line, 2 to 64 `[x, y, z]` points relative to `x, y`; `z` is the centre's height above the base |
| `thick` | a path pipe's width in squares |
| `profile` | `lathe` only: 2 to 48 `[r, y]` pairs, each 0 to 1 of the half-width and the height, bottom to top |
| `bevel` | `extrude` only: the rounded top edge, 0 to 0.5 squares |
| `src`, `scale`, `rules` | `model` only: the `.glb` or `.gltf` path; squares per model unit, or `null` to fit inside `w × d × h`; `box` (its box is in the rules) or `none` (scenery) |
| `kit`, `parts` | `kit` only: its name, and its parts stored inline (up to 64), each a primitive with `shape x y w d h elev rot mat tint solid` (and an outline, path, profile or bevel where its shape keeps one), relative to the kit's centre, `elev` above the kit's base |

`normalizeProp` is total: anything that is not an object, has an unknown
shape or has no position comes back `null`, and every other field falls back
to the shape's default (`SHAPE_DEFAULTS`). A Level holds at most 2000 props.
A slab or an extrude given `points` takes its size and middle from them, so
`w`, `d`, `x` and `y` always describe its bounds. A kit's size is its parts'
bounds and its height the highest part's top. A key that belongs to another
shape is dropped, so a stored prop only ever carries its own.

## Shapes

| Shape | What it is | Rules profile | Solid by default |
|---|---|---|---|
| `slab` | raised ground of any outline and turn: the map on its top, a cliff on its sides | flat at its top, exactly the half squares it covers | yes |
| `hex`, `octagon` | prisms | flat, their own outline | yes |
| `pipe` | straight along `w`, or along a `path` with rounded corners | its centre line, however thin | no |
| `stairs` | a flight of steps climbing to the back edge (one step per 0.2 squares of height, 2 to 16) | a ramp descending to the front | yes |
| `platform` | a table on four legs | flat (standing on a table is allowed) | yes |
| `fence`, `parapet` | a post-and-rail fence (a post every 0.9 squares), a low wall with a coping | a full row of half squares along it, never stepped over | yes |
| `beam` | a timber beam, often raised with `elev` | its centre line | no |
| `sign`, `cross` | a post with a board, a standing cross | flat | no |
| `bowl` | a wide stone basin | round | yes |
| `brazier` | a dark iron bowl on three legs, glowing coals in it; the torch layer puts a flame in the bowl | round | yes |
| `lamp` | an iron post with a glowing lantern | round | no |
| `gable`, `hip`, `lean`, `spire` | roofs: a ridge, four slopes, one slope, a cone | the roof's own slope | no, and `roof` on |
| `lathe` | a turned shape from its `profile` (an urn without one) | round | yes |
| `extrude` | an outline raised to `h` with a rounded top edge | its outline | yes |
| `kit` | several primitives placed as one | the union of its solid parts | from its parts |
| `model` | a glTF model | its box, or nothing | yes |

## Slab or terrain, prop, kit or model

- **Terrain** is the half-square grid. Use it for ground that sits on the grid
  and for anything bigger than a room.
- **A slab** is ground that does not sit on the grid: a dais drawn at a
  slant, a round platform, a ledge whose painted rim falls a third of the way
  into a square. It draws like terrain (the map on top, a lipped cliff around
  it) and is floor at its top in the rules, to the half square: a half square
  counts when its centre is inside the outline. It does not own its art: the
  top shows the map exactly where the slab stands, so measure the outline to
  the painted rim and the paint and the 3D edge agree.
- **A prop** is one object. A **kit** is several placed as one (a market
  stall, a well with its roof), defined once in a layout's `kits` and placed
  as often as needed; it is stored inline, so a scene never depends on the
  layout file.
- **A model** is a file the GM brings. It is lit by the board, casts and
  takes shadows and fades under fog like any prop. Use `rules: "none"` for a
  model whose box would be wrong in the rules (an overhang, a hollow), and
  stand solid primitives under it where it should block.

## Storage

`terrain/props-store.mjs` is the only reader and writer. Props live at
`scene.flags["gluniverse-foundry-modules"].dio.props.levels[<levelId>]` as
`{ v, props }`, keyed by Level like the terrain. Every write is a forced
replacement of that one Level's entry (`ForcedReplacement` on v14, `==key` on
v13): a plain nested update merges arrays by index, so a deleted prop would
come back. `PropStore.touched(changes)` recognises both shapes Foundry hands an
`updateScene` hook (the dotted key and the nested one, with or without the
`==`/`-=` prefix).

The flag reaches every client. "GM only" withholds a prop from a player's
renderer and from the rules; it is a display rule, not a secrecy boundary, the
same as a hidden token's flags.

## Rules

`terrain/live.mjs` resolves the props against the saved ground and keeps two
terrains per scene:

- `ground`: the saved terrain alone. The 3D view draws this, and the editor
  edits it.
- `terrain`: the rules terrain. Movement, sight, cover, standing height and
  the view's overlays read this. Every visible, solid prop is stamped into it
  while "Solid props block" is on.

`resolveProps` works through the list in order. A prop with no `elev` stands
on the highest point under its footprint at that moment, so a crate listed
after a table stands on the table. Stamping only ever raises sub-squares, to
`base + profile × h`, and makes them floor; a wedge's slope becomes a ramp
descending to its front; void stays void. The profile is the shape the rules
see (`profileAt`): a dome is low at its rim, a cone is a point, a tree is its
trunk and the core of its crown, an arch leaves its opening walkable, stairs
are a ramp, a roof is its slope. A prop too thin to cover a sub-square centre
still claims the one under its centre, so a post is never walked through.
Long thin shapes (`fence parapet beam pipe`) claim every half square their
centre line crosses, so a fence is never stepped through between two centres.
A slab is the exception the other way: it claims exactly the half squares its
outline covers and nothing for a sliver, like terrain.

A kit is the union of its solid parts, each part's top measured from the
kit's base, so a stall's counter is in the rules and its scenery roof is not.
A kit with no solid part, and a model with `rules: "none"`, are scenery.

A hidden prop is resolved (the GM sees where it stands) but never stamped and
never stood on, so the rules never betray what a player cannot see. A prop
that is not solid is scenery.

The cache is dropped when a scene's terrain or props change (`main.mjs`,
`updateScene`) and when the setting changes (`updateSetting`), which re-stamps
every scene.

## Rendering

`render/props.mjs` and `render/props-glsl.mjs`. Pure, like the rest of
`render/`.

- **Instancing.** Every shape is drawn by parts (`SHAPE_PARTS`: a tree is a
  wood trunk and a foliage crown). Parts are grouped into buckets by geometry,
  material and part, and each bucket is one `InstancedMesh` with power-of-two
  capacity, so a forest of a few hundred trees is a handful of draw calls and
  an edit refills buffers rather than building meshes. Rocks pick one of four
  shapes from the prop's seed.
- **Look.** One program for every material (`PROP_MAT_ID`), with a bevel and
  rim on boxes, material and part relief at high detail (stone courses, marble
  veins, wood grain, crate planks, barrel staves and hoops, bark, pillar
  flutes, leaf clumps), patterns offset by each prop's seed so a row of crates
  is not a stamp, flat facets and a soft glow on crystal, and the shared lighting, shadow,
  weather surface (snow, wetness) and vision of the terrain (`shade`,
  `shadowAt`, `visionAt`, `dioFinish`).
- **Contact shadow.** One instanced soft disc or rounded box under every
  visible prop plants it on the ground.
- **Cast shadows.** The shadow pass draws one override material and cannot
  instance, so prop meshes are not in it. Instead a second `casters` scene
  holds instanced copies with matrices of their own; a GM-only ghost and a
  roof faded below half get a zero matrix there, so they cast nothing. Slabs
  add one merged caster of the solid ones. A card casts its image's
  silhouette, turned to the sun.
- **Cards.** An image card is a billboard that turns about its vertical axis
  to face the camera. It is as wide as its image at its height; until the
  image loads it uses the stored width.
- **GM only.** A hidden prop reaches only the GM's renderer, drawn as a violet
  hatched ghost that casts nothing and cannot be picked.
- **Detail and motion.** `fx.detail` (the user's Detail option, shed by the
  frame budget through the `propDetail` step) switches relief and foliage sway.
  The board asks for frames only while `animated(fx)` is true: high detail,
  foliage on the board and wind above zero. A still board costs no frames, and
  `frame()` allocates nothing.
- **Picking.** A click on a solid, visible prop lands on its top, the same way
  a click on raised ground does. A roof faded below half is not picked, so a
  click goes through it to the room.
- **Variants.** A few shapes change geometry with their size or settings:
  stairs get a step per 0.2 squares of height, a fence a post every 0.9
  squares, a hip roof its ridge from its proportions, a lathe its profile.
  Each variant is built once and shared by every prop that needs it. An
  extrusion and a path pipe are built at their own size (`props-geo.mjs`), so
  stretching never squashes their rounded edges.
- **Slabs** (`render/props-slabs.mjs`) are merged, not instanced: one top mesh
  and one side mesh for every slab on the Level. The top samples the map like
  the terrain and carries the terrain's lip band, an inset ring 0.12 squares
  in (`SLAB_INSET`) that the terrain's own lip shading reads. The sides are the
  terrain's cliff program with a ghost and a fade spliced in
  (`SLAB_SIDE_VERT`/`_FRAG`), so a slab's cliff is the same rock, brick or
  riveted metal as the ground's, with the same hairline at its rim. A floating
  slab (`elev` set) stops at its base; a grounded one runs its sides down to
  the lowest ground on the Level.
- **Models** (`render/props-models.mjs`) load once per file, in the
  background. `GLTFLoader` is imported only when the first model is asked for,
  so a board with no model never downloads it. A loaded model is baked to the
  suite's own program (`PROP_MODEL_*`): its meshes grouped by texture and
  colour, its colours moved to the display space the rest of the board draws
  in, stood on its base and centred. It then draws as one more instanced
  bucket at a uniform scale, so it is never stretched. A model that fails to
  load warns once in the console and draws, for the GM only, as a hatched box
  of its size with no shadow under it; a player sees nothing. A test or the
  preview replaces the loader with `setModelLoader(fn)`. A texture whose
  sampler magnifies with NEAREST stays crisp (nearest both ways, no mipmaps),
  and the glTF emission (`emissiveFactor` × `emissiveTexture`) is added after
  the light, unshadowed. Map Maker's Diorama Bundles rely on both
  (docs/DIORAMA_BUNDLE.md).
- **Roof fades.** `setRoofFade(Map<propId, 0..1>)` is pure: the caller decides
  which roofs fade, the layer writes a per-instance fade that the program
  dithers away (no blending and no second program, so nothing is compiled
  when a roof fades). A roof below half stops casting, and the layer asks for
  a shadow redraw only when a roof crosses that line. Cards and slabs take a
  fade the same way.
- **Level of detail.** Far away, relief and foliage sway fade out with the
  zoom: full at 30 device pixels per square, none at 12, damped over about a
  sixth of a second (`LOD_RATE`), so zooming never pops. Geometry is not
  swapped; the shapes are cheap enough that a lower mesh would save less than
  the switch costs. A zoomed-out board with the relief gone asks for no frames.
- **Brazier.** A dark iron bowl on three legs with coals that glow by
  themselves (`coals` part, untinted). The torch layer treats any `brazier`
  as a fire, whatever its label, and stands its flame at the bowl's rim, just
  over the coals.

## The editor

Terrain editor, the **Props** switch at the top (beside Terrain). The tool
row, options and palette give way to the props palette; Map-wide stays.

- Pick a shape and a material, then click the canvas to place one (snapped to
  the square's centre while "Snap to the grid" is on).
- Click a prop to select it; drag to move it (hold Ctrl to move off the grid).
  Shift-click removes. Alt- or Ctrl-click on empty ground lets go.
- Keys while one is selected: Delete or Backspace removes, R turns 90 degrees
  (Shift+R back), Ctrl+D duplicates, Escape lets go.
- The selected prop's fields: name, position in squares, width, depth, height
  and base in the scene's units (base empty = on the ground), turn, colour (and
  "use the material's own colour"), Solid, GM only, Roof, and for a card the
  image with a file picker. A slab has its side material. A model has its file
  (with a picker), its scale (empty fits the size) and its rules footprint.
- Typing a width, depth or height on a slab or extrusion scales its outline,
  on a path pipe its path, and on a kit every part (a kit scales evenly). A
  kit's parts are edited in the layout file; the editor shows its name and
  part count and draws each part's footprint inside the selection.
- A kit cannot be placed from the palette, since it needs parts. Import a
  layout with `kits` to place one, then duplicate and move it freely.
- Every change is one undo step, shared with terrain edits. Save writes the
  terrain and, when they changed, the props.

The canvas layer draws each footprint as a hairline (a slab or extrusion as
its outline), the selection with its front edge marked, GM-only props in
violet. The live 3D preview shows the draft.

## Layouts

A layout's optional `props` array places props in map squares, with heights in
the layout's unit, mirror support and error sentences that name the prop. See
the Props section of docs/DIORAMA_LAYOUT.md, and the map-setup skill for when a
thing should be a prop rather than terrain. A layout with a `props` key
replaces the scene's props; one without leaves them alone. The editor applies a
layout's terrain and props as one undo step.

## Checks and preview

```bash
node tools/diorama-check.mjs
```

`tools/diorama-check/props.mjs` covers the normaliser, minted ids, the stored
keys, stamping (stacking, wedge ramps, hidden and scenery props, void, the
setting off), what a player receives, the forced write and `touched` in both
shapes, the editor's place, drag, duplicate, remove, undo and redo, every
shape's geometry, every program's uniforms, the layer's buckets, casters and
idle rule, the strings and the stylesheet. Past the first eighteen shapes it
drives every new shape from a bare placement, slab stamping to the half square,
stairs as a ramp, fences as a full row, kits as the union of their solid
parts, models through a stub loader (ready, failed, GM-only placeholder, one
warning), slab geometry (tops up, sides out, the lip band), roof fades and the
caster matrix, and the level of detail settling. `tools/diorama-check/layout.mjs`
covers layout props, outlines, paths, kits and their mirroring, models, every
refusal, and the worked example. `tools/diorama-check/bundle.mjs` reads a
hand-made bundle's models through the real GLTFLoader: crisp textures and
emission.

```bash
node tools/diorama-preview.mjs && node tools/preview-server.mjs
```

Then `/.preview/diorama.html?props=1` shows every shape and material, a stack,
two cards, a tinted column and a GM-only ghost (`view=props` or `view=mats` to
frame them, `wind=0.6` for sway, `probe=props` writes the layer's state into
`#probe`). `props=2` shows the rest: the newer shapes in the house on the
plateau (`view=props2`), an outlined slab with metal sides and a turned slab
with steps (`view=slabs`, best at `yaw=6&pitch=1`), and a kit, a path pipe, a
model built in JS and handed over through `setModelLoader`, and a model that
fails (`view=kits`). The gable is faded to `fade=0.4`. Add `novision=1` for
stills. Headless Chrome with SwiftShader compiles the programs:
`--dump-dom` prints the page's `#err` panel if any fail.
