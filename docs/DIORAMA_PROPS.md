# Diorama props

Props are objects that stand on the Diorama board: trees, crates, columns,
rocks, arches, statues built from boxes and cylinders, and image cards. They
sit on top of the terrain (docs/DIORAMA_LAYOUT.md for the terrain itself) and,
when solid, they are part of the rules: tokens stand on them, bump into them
and hide behind them.

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
| `shape` | `box cylinder cone sphere dome pyramid wedge torus capsule arch pillar crate barrel rock tree pine bush card` |
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

`normalizeProp` is total: anything that is not an object, has an unknown
shape or has no position comes back `null`, and every other field falls back
to the shape's default (`SHAPE_DEFAULTS`). A Level holds at most 2000 props.

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
trunk and the core of its crown, an arch leaves its opening walkable. A prop
too thin to cover a sub-square centre still claims the one under its centre,
so a post is never walked through.

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
  holds instanced copies that share each bucket's matrices; GM-only ghosts sit
  at the end of every bucket so the caster count simply stops short of them.
  A card casts its image's silhouette, turned to the sun.
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
  a click on raised ground does.

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
  "use the material's own colour"), Solid, GM only, and for a card the image
  with a file picker.
- Every change is one undo step, shared with terrain edits. Save writes the
  terrain and, when they changed, the props.

The canvas layer draws each footprint as a hairline, the selection with its
front edge marked, GM-only props in violet. The live 3D preview shows the
draft.

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
idle rule, the strings and the stylesheet. `tools/diorama-check/layout.mjs`
covers layout props and the worked example.

```bash
node tools/diorama-preview.mjs && node tools/preview-server.mjs
```

Then `/.preview/diorama.html?props=1` shows every shape and material, a stack,
two cards, a tinted column and a GM-only ghost (`view=props` or `view=mats` to
frame them, `wind=0.6` for sway, `probe=props` writes the layer's state into
`#probe`). Headless Chrome with SwiftShader compiles the programs:
`--dump-dom` prints the page's `#err` panel if any fail.
