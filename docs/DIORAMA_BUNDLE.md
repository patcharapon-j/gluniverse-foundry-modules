# Diorama Bundles

A Diorama Bundle is a version of a map made for the 3D view, exported by Map
Maker (contract: patcharapon-j/gluniverse-map-maker#111). Map Maker paints
standing props in 3/4 view, so in 3D that paint would lie flat on the floor
beside the real prop. A bundle brings the map with those props painted out,
and each prop as a textured model that stands where the 2D art drew it.

## The folder (v1)

| File | |
|---|---|
| `manifest.json` | `{ "version": 1, "name", "gridPx", "squares": [w, h], "image": [wPx, hPx], "ground": "ground.webp", "layout": "layout.json" }` |
| the ground | the Player Export with every standing prop removed (flat props stay). Same size and grid as the Player Export |
| `props/<key>.glb` | one per look of a standing prop: glTF 2.0 binary, Y up, 1 unit = 1 square, base at y = 0, centred on its footprint, unrotated. NEAREST samplers. Glowing parts in an emissive texture |
| the layout | a layout (docs/DIORAMA_LAYOUT.md) with one `model` prop per standing prop, its `src` relative to the folder |

`terrain/bundle.mjs` reads it (pure): `readManifest` checks the manifest and
refuses another version, a missing `ground` or `layout`, or a path that
climbs out of the folder; sizes that disagree with each other or with the
scene are warnings, since the ground is drawn over the scene rect whatever its
size. `resolveBundleLayout` joins each model `src` to the folder (a URL or an
absolute path is kept as it is). The contract names a model's place as `x`,
`y`; a layout places a prop with `at: [row, col]`, so a model with no `at`
and numeric `x`, `y` is read as the footprint's centre in map squares (`x`
the column, `y` the row). Everything else in the layout is read exactly as
Import layout reads it.

## Importing

Put the folder anywhere Foundry serves (the world's folder is a good place:
`worlds/<world>/maps/concourse-3-diorama`).

- Terrain editor, Map-wide, **Import bundle**: pick the folder. The layout's
  terrain and models replace the draft and the bundle's ground becomes the
  draft's 3D ground, as one undoable step. Save writes them; tokens named in
  the layout move then, like Import layout.
- API, GM only, writes at once:
  `game.modules.get("gluniverse-foundry-modules").api.features.diorama.importBundle(folder, { scene, tokens })`
  resolves `{ ok, errors, warnings, ground, props, moved, missing }`. Nothing
  is written while there is an error.

Both write the Level in question (the one viewed on the canvas).

## The 3D ground

`scene.flags["gluniverse-foundry-modules"].dio.ground.levels[<levelId>]` holds
an image path, keyed by Level like the terrain. `terrain/ground.mjs` is its
only reader and writer. While it is set, the 3D view draws it as that Level's
ground instead of the Level's background, over the same scene rect: the
viewed floor (`view/overlay.mjs`), the floors below it (`view/level-view.mjs`)
and the editor's preview, which shows the draft's. Slab tops and `map`
material sample it too, since they sample the ground the view draws. The 2D
canvas never reads it and keeps the full art, and auto setup and the magic
wand still sample the full art.

- The editor's Map-wide section shows the 3D ground when there is one, with a
  button that goes back to the background (undoable; Save writes it).
- API, GM only: `api.features.diorama.setGround(src | null, { scene, level })`.

## Models from a bundle

They are ordinary `model` props (docs/DIORAMA_PROPS.md). Two things keep them
looking like the map:

- **Crisp pixels.** A texture whose sampler magnifies with NEAREST also
  minifies with NEAREST and gets no mipmaps (`prepareModelTexture` in
  `render/props-models.mjs`), so its texels stay hard at any zoom. A model
  whose sampler asks for linear filtering keeps it.
- **Glow.** The glTF `emissiveFactor` × `emissiveTexture` (and
  `KHR_materials_emissive_strength`) is added after the light and is never
  shadowed, so a lightbox or a screen reads in the dark. As glTF says, an
  emissive texture with no `emissiveFactor` glows with nothing.

## Checks and preview

```bash
node tools/diorama-check.mjs
node tools/diorama-preview.mjs --bundle=<folder> [--scene=<foundry-scene.json>]
node tools/preview-server.mjs   # /.preview/diorama-map.html?pitch=1&yaw=0&still=1&shed=0
```

`tools/diorama-check/bundle.mjs` covers paths, the manifest, the layout and
its `x`, `y`, the ground flag in every shape the view hears, the editor draft
(one undo step, undo and redo, save, clear), `importBundle` end to end against
a fake world (what it writes, and that it writes nothing on an error), the
editor and API wiring, and the fixture's models through the real GLTFLoader
(NEAREST, no mipmaps, the emissive texture, the program's uniforms).

`tests/fixtures/diorama-bundle` is a small hand-made bundle (an 8×6 ground, a
crate and a rune pillar with an emissive band), written by
`node tools/diorama-bundle-fixture.mjs`. `--bundle` draws a bundle the way
Import bundle writes it, models through the real loader; without `--scene`
the scene is the manifest's map with no walls or lights.
