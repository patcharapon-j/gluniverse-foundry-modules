# Diorama: tiles, buildings, bridges

How the 3D view draws Foundry tiles, how roofs open over the people inside, and
how bridges and arches walk. The rest of the view is in `docs/DIORAMA.md`.

```
integrations/tiles.mjs   which tiles, as what, where (pure, plus readTiles)
view/roofs.mjs           which roofs open, for whom (pure, plus readRoofs)
render/tiles.mjs         TilesLayer: decals and roof planes, their shader
render/roofs.mjs         RoofFader: the fades, and the camera rule
tools/diorama-check/buildings.mjs
```

## Tiles

Foundry v14 has no "overhead" switch. A tile draws over tokens when its
elevation is above theirs, and fades for them when its occlusion modes say so.
The view sorts every tile into one of two kinds (`tileKind`):

- **Ground**: a decal lying on the terrain. A rug, a table top, blood on the
  flagstones. It is draped over the drawn ground on a fine grid (8 vertices per
  square), so a rug on a terrace lies on the terrace. Where it crosses a step it
  takes the lower side, so it sinks into the step instead of hanging a sheet in
  front of the cliff. It never sits below its own elevation. A decal over a ramp
  lies at the ramp's flat top, not along its slope.
- **Roof**: any tile with an occlusion mode, or one at or above the viewed
  Level's top (where v14 moved the old foreground elevation). It is one flat
  plane. It stands on the walls under it when there are any (`wallTopUnder`: a
  wall whose midpoint is on or inside the tile's box, invisible walls not
  counted), else at its own elevation, and never lower than the ground under it
  plus one square (`roofHeightQ`).

Placement follows Foundry's sprite exactly (`tileQuad`): `(x, y)` is the anchor,
the art is fitted to the box by `fit` (fill, cover, contain, width, height),
scaled by `scaleX` / `scaleY` (negative mirrors), and turned about the anchor.
Alpha and tint carry over. A video tile plays, using the element Foundry already
plays, and asks for frames only while it plays. Art loads once per URL, at most
`maxTexture` on its long side, and a tile whose art is cross-origin without CORS
is left out with one warning.

Both kinds are lit like the ground (one sun, shadows, weather) and go through
`dioFinish`. A roof is lit by the sky only, never by the lights in the room
under it. A shut roof casts a shadow; an opening one stops casting and stops
writing depth.

**Sight.** A decal follows the vision bake per pixel, exactly like the ground:
over ground nobody has seen it is not drawn. A roof shows where its own ground
is seen, or once its outline (or the ground just outside its walls) has been
seen (`roofSeen`), the way a player who walked past a house has seen its roof.
The interior under it is still the ground's business, so what nobody has seen
under an open roof stays undrawn.

**Who gets a tile.** A hidden tile reaches only the GM's own view, as the
hatched violet ghost every GM-only thing is, and it casts nothing. It never
reaches a player and never the GM's "view as players". A tile outside the
viewed Level is skipped.

**Turning tiles off.** Scene flag `dio.tiles`, in the GM's Scene environment
panel: ground tiles and roofs (the default, stored as no flag), roofs only,
ground tiles only, or off. For a map whose tiles clash with the 3D board.

## Roofs opening

Roofs come from two places: roof tiles, and props with `roof` set (the gable,
hip, lean and spire shapes default to it; see `docs/DIORAMA_PROPS.md`). Props
draw themselves; the renderer hands them their fade through
`PropsLayer#setRoofFade(Map<propId, alpha>)`.

"A viewer's figure" (`viewerTokens`):

| Viewer | Figures that open roofs |
| --- | --- |
| GM | the selected tokens |
| GM, view as players | every player-owned token that is not hidden |
| Player | their own tokens that are not hidden, and any they control |

That is narrower than Foundry's 2D rule, which also opens a roof for any
visible token. The 3D board has walls in it, and a roof that opened for a
goblin inside would show a player the room the goblin is in.

The table (`roofTarget`):

| Roof | When | Shows |
| --- | --- | --- |
| any | GM cut-away on, GM's own view | 12% (`ROOF_CUTAWAY_ALPHA`) |
| tile, FADE | a viewer's figure inside | the tile's occluded alpha |
| tile, RADIAL | a viewer's figure under it | a soft hole over each, feet to head as the camera sees it (up to 4) |
| tile, VISION, with a sight bake | a viewer's figure under it | open where the viewer sees now |
| tile, VISION, no bake (the GM) | a viewer's figure inside | as FADE |
| tile, no mode | always | shut |
| prop roof | a viewer's figure inside | gone |

"Inside" is Foundry's own test where the tile has one
(`TileMesh#testOcclusion`, which looks at the tile's opaque pixels under the
token), else the figure's centre in the tile's box, and only while its feet are
below the roof. On top of the table, the renderer adds one rule that needs the
camera: a roof between the camera and one of the viewer's figures (tested at
the feet and at the chest) thins to 25% (`ROOF_CAMERA_ALPHA`), so a figure is
never lost under the eaves of the house next door. A figure standing on a roof
is never hidden by it. A RADIAL hole needs the camera too: the figure's feet
and the top of its card (drawn taller and leaned back, as `render/standees.mjs`
draws it) are carried up the view ray onto the roof (`render/roofs.mjs`
`projectHole`), so the hole is a capsule over the whole figure on screen, not a
circle straight above its feet, and it moves when the camera turns.

The GM's **cut away roofs** is a toggle in the view (keybinding
`GLDIO.keys.roofs`, no default key). It acts in the GM's own view only, never
under "view as players".

Every change is a fade: exponential damping that lands 95% of the way inside
`TIMING.roofFade`, interruptible (a figure stepping in and straight out reverses
from wherever the roof is). Opening the view plays no fade: a roof starts at
its target. With the `roofFade` rung shed, roofs snap. Video tiles hold their
frame when `tileVideo` is shed.

## Bridges and arches

The rules see one height field per Level, and a prop changes it by stamping
its footprint (`terrain/props.mjs` `profileAt`, `resolveProps`). So:

- **A bridge** is a `platform` (or a `slab`) with its base set (`elev`) to the
  deck height. It stamps its footprint as floor at the deck's top, so tokens
  walk across. Put a `stairs` or `wedge` prop at each end (they stamp as a ramp
  descending to their front), or paint terrain stairs or a ramp up to it.
- **An arch** is a gateway. Its legs are solid to their full height; the
  opening between them (the middle 60% of its width) stamps nothing, so the
  ground there stays walkable at ground level and tokens walk through. Its top
  is never walkable in the same Level, because the opening under it is.
- **Roof shapes** (`gable`, `hip`, `lean`, `spire`) are scenery by default: a
  solid roof would stamp the house's floor to the ridge and lift everyone inside
  onto it. The check pins that.

**The limit.** One height field holds one floor per square. A deck stamps the
squares under it, so nobody can walk under a bridge in the same Level, and an
arch cannot be walked both through and over. To walk under a bridge, or over an
arch, put the deck on a second Level above the ground Level: the multi-Level
scene work (`terrain/levels.mjs`, `view/levels.mjs`) draws the floor below and
walks each token on its own Level's ground.

## Not done

- A decal over a ramp lies flat at the ramp's top.
- A RADIAL hole is a capsule in the roof's plane, not Foundry's screen-space circle.
- `SURFACE` tiles are drawn as roofs that never open (a surface is walked on in
  Foundry; the 3D view has no walkable tiles).
- Tiles on the floors drawn below the viewed Level are not drawn.
- Everything that reads Foundry (the occlusion test, video elements, the flag
  write, the keybinding) needs a live v14 session to prove.
