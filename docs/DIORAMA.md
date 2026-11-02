# Diorama

The battle map as a painted 3D diorama, like the old tactics RPGs: height-painted
ground blocks under the map art, Foundry's walls and doors as 3D walls, tokens as
die-cut paper standees on round bases. Height is **mechanical**: it occludes sight
and light (on the 2D canvas too), moves tokens up and down, stops walking at
cliffs, and shows cover and falls.

Feature id `diorama`, setting prefix `dio.`, i18n `GLDIO.*`, CSS prefix `gldio-`.
**Foundry v14 only** (`minimumGeneration: 14`), square grids only.

## What a table gets

- **The view.** A full-screen 3D overlay over the 2D canvas (Shift+V or the suite
  scene-control button). The 2D canvas stays the only source of truth: every action
  in 3D writes ordinary Foundry documents, and the GM can drop back to 2D for
  anything 3D does not cover.
- **Camera.** An orthographic tactics view: pitch presets 30° (default), 45° and 65°
  (R), yaw on the four diagonals (Q/E), or in 45° steps if the GM sets
  `dio.yawSnap` to 45. Free zoom (wheel) and pan (right or middle drag), all
  tweened. Opening the view frames what the 2D canvas was showing. The scene's
  grid can be drawn on the ground (`dio.grid`, per client, toolbar toggle).
  Tilt-shift blur is opt-in.
- **Standees.** Figures cut out of their art with a dark outline, leaned back so
  the art keeps its proportions at every pitch, casting their own silhouette
  shadow. The outline turns gold when controlled, the targeting user's colour
  when targeted, and the accent on hover. They stand on a dark base with a
  disposition ring: gold for the current combatant, green for next. A flyer
  gets a glass stand down to the square it is over. Conditions ring the front
  of the base (`dio.effects`), and bars follow Foundry's own bar visibility.
- **Other features, in 3D.** The targeting lines are the ones `stream-targets`
  draws on that client, in its colours. pf2e-odds badges hang over the standee's
  head (suite api `tokenAnchor`). In stream mode the capture's view follows the
  stream camera, joins invites without a toast, and hides the view's chrome.
  The view sits on the board's layer, so Foundry's UI, Stage portraits and
  every suite overlay stay in front of it.
- **At the table in 3D.** Select (click, shift-click), drag-move with a path preview
  (distance, PF2e actions by Speed, Daggerheart range bands, climb and fall marks),
  target (T), open / close doors, ping (long press), ruler, a compact token menu
  (right-click), the sheet (double-click), and hover distance + cover from the
  controlled token to the hovered one.
- **Walls.** Camera-facing walls drop to a stub so rooms read. Doors swing.
- **Light and vision.** Lit from Foundry's own light polygons, hidden by Foundry's
  own vision polygons and explored fog. Unexplored ground is not drawn at all.
- **Invites.** When the GM opens the view, players on the scene are invited
  (ask / auto / never, per client). The GM can bring everyone to their camera, and
  anyone can follow the current combatant.
- **Effects.** Sequencer / JB2A effects are mirrored into 3D: standing, flat on the
  ground, or as beams. Templates show as highlighted cells.

## The terrain

`terrain/model.mjs`. One height field per scene Level (v1: the initial Level),
painted at **2×2 sub-cells per grid square**. Per sub-cell: `h` (Int16, quarter
cells, "q"), `layer` (palette index: cliff material + editor colour), `kind` (floor,
water, pit, stairs, ramp, void; stairs and ramps carry a direction). The palette is
per scene. Units: px (canvas), cell (three.js world unit), q (stored heights),
dist (scene units, `q / 4 · grid.distance`).

- Rules read **whole cells**: a cell's top is the highest of its sub-cells, a big
  token stands on the highest cell it covers.
- `terrain/store.mjs` is the only reader and writer of the flag
  (`flags[suite].dio.terrain.levels[levelId]`), always as a forced replacement.
- `terrain/live.mjs` caches the decoded terrain per scene; `invalidate(scene)` is
  called from `updateScene` and tells every listener.
- The flag reaches every client. Hiding unexplored ground is a **display rule, not
  a secrecy boundary**.

## Height is mechanical

- **Elevation is written.** A token's `elevation` = ground under it + its own
  altitude (token flag `dio.altitude`, for flyers). Written per waypoint in the same
  move (`Token#_getDragWaypointPosition`), so drags animate up and down ledges.
  Repainting under standing tokens resyncs them (active GM, one batched update).
- **Cliffs block walking.** A rise above the step height (default 2.5 ft) costs
  Infinity for `walk` (Foundry's own pathfinding routes via stairs / ramps), is
  allowed at cost for `climb`, and only sets the minimum altitude for `fly`. A drop
  above the step height is flagged as a fall with a damage hint (PF2e: half the fall
  as bludgeoning, 20 ft shorter into water). Nothing is applied automatically.
- **Sight and light.** A custom `ClockwiseSweepPolygon` subclass is installed as
  `CONFIG.Canvas.polygonBackends.sight` and `.light`. For each source it adds the
  outline of all ground above that source's eye (token elevation + 0.9 × creature
  height; a light's elevation + ground) as ordinary edges, so the 2D canvas and the
  3D view draw the same polygons. Point tests (`testCollision`, used by token
  detection) instead march the real 3D segment over the height field, because they
  have real target heights; feet, centre and head are tested.
  See [ADR 0002](adr/0002-height-sight-backend.md).
- **Cover** from terrain: five rays from the attacker's eye to the target (feet,
  middle, head, both flanks). Some blocked = standard, most = greater. Shown on
  hover and targeting only; PF2e's own cover is per-target for all attackers, so
  applying it for one attacker would be wrong for the rest.
- **Creature height** by size (Tiny 2.5, Small 3, Medium 6, Large 10, Huge 15,
  Gargantuan 20 ft), overridable with the actor flag `dio.height`.

## Light and vision in 3D

Foundry's illumination and vision render textures are **screen-space** (they follow
the 2D camera), so they cannot be projected onto the diorama. The view bakes its own
**world-space** maps instead, from Foundry's own computed polygons: each light
source's `shape` drawn with its colour and bright/dim falloff, each vision source's
`los`/`shape` as the visible mask, and the fog exploration as the explored mask, at
16 px per cell. Rebuilt on `lightingRefresh` / `sightRefresh`, throttled. The
polygons already carry height occlusion, so 2D and 3D agree by construction.

- Visible: full colour. Explored, not visible: desaturated and dim, no tokens.
  Unexplored: not drawn. GM: everything, hidden tokens ghosted (40%, hatched);
  a "view as players" toggle applies a player's view.
- Token visibility is Foundry's (`token.isVisible`), never recomputed.
- Standee art for an actor the viewer cannot Observe never uses the actor portrait:
  the GM's standee override if set (actor flag `dio.standee`), else the token
  image. This keeps a disguised creature (a mimic's chest token) disguised.

## Looks

- Cliff sides: per palette entry, `earth` (strata tinted from the map, lit lip) by
  default, `stone` (cut courses) as a preset, plus `edge` (the original stretched
  edge pixels), `ice`, `wood`, `brick`.
- Walls: per wall, presets `stone` (stone with timber posts and a cap, default),
  `plaster`, `palisade`, `hedge`, `cave`, `map` (map pixels under the wall line).
- Water: an animated surface slightly below the cell top. Pits fade to dark.
  Void is not drawn.

## Performance

The view renders **on demand**: a frame only when the camera, a token, a light or
an effect changes; `Budget.claimMotion` is held only while something animates.
The WebGL context is registered with `Surfaces`. `SHED_ORDER` (cheapest loss
first): tilt-shift, ambient occlusion, soft shadows, shadows, water animation,
standee sway, marker motion (the reticle's breathe and the target lines' glint,
`TIMING.reticleBreathe` / `linkGlint`), effect lights, render scale 0.75, 30 fps
cap. Vision, lighting correctness and fog are never shed.

## Setting up a map (GM)

The first open of an unprepared scene is **flat**: walls and doors in 3D, ground at
0, usable on day one. A "Not set up" chip offers **Auto setup**, which produces a
*draft* (colour clustering of the map art; walls flood-filled into rooms; water by
hue; near-black outside rooms becomes void) in the editor.

The editor paints on the 2D canvas, with a docked live 3D preview of the draft:
brush (sizes), rectangle, flood fill, magic wand (tolerance, contiguous, add /
subtract), raise / lower, stairs and ramps (drag to set direction), kinds (water,
pit, void), wall materials, a named height palette per scene, undo / redo, and
copy from another scene with the same map image. **Difficult terrain** is not ours:
the brush writes native v14 Regions with the `modifyMovementCost` behaviour, so
Foundry's ruler, PF2e and the view all agree. **Save** writes the flag once; players
only ever see saved terrain.

## Module map

```
scripts/features/diorama/
  index.mjs              adapter + settings
  constants.mjs          ids, keys, KIND/DIR, materials, SHED_ORDER, TIMING
  main.mjs               onInit / onReady wiring, api
  terrain/               codec, model, occlusion (pure), store, live cache
  rules/                 pure: path analysis, system readouts, creature height
  foundry/               sight/light backend, movement wrappers, cover, elevation sync
  render/                three.js renderer (pure: no game/canvas/foundry/ui)
  view/                  the overlay: Foundry snapshot, bakes, input, sync, HUD
  integrations/          initiative turn, conditions, bars, templates, Sequencer
  editor/                editor app, 2D layer, tools (pure), auto setup, preview
scripts/vendor/three/    three.js r169, pinned (MIT)
styles/diorama*.css      templates/diorama/      lang/diorama*.en.json
tools/diorama-check.mjs  tools/diorama-check/*.mjs   tools/diorama-preview.mjs
```

### Renderer contract (`render/renderer.mjs`)

The renderer is **pure**: it never reads `game`, `canvas`, `foundry`, `ui` or
`Hooks`. The view (and the editor's preview, and the preview page) feed it plain
state. 1 world unit = 1 cell; x = px / size, z = py / size, y = q / 4.

```js
const r = new DioramaRenderer({ canvas, pixelRatio });
r.setGrid({ size, distance, cols, rows, sceneRect });
r.setTerrain(terrain);                       // Terrain from terrain/model.mjs
r.setBackground(image|null, rect);           // map art, placed over rect (px)
r.setWalls(WallState[]);
r.setTokens(TokenState[]);
r.setLighting({ darkness, light, vision });  // canvases, world-space, see below
r.setOverlays({ path, cells, ruler, pings, hover });
r.setEffects(EffectState[]);
r.setCamera({ yawStep, pitchIndex, zoom, target }, { animate });
r.getCamera();
r.setOptions({ tiltShift, cutaway, ghosts, grid: { on, color, alpha } });
r.setLinks([{ sourceId, targetId, color:[r,g,b] }]);  // targeting lines, 0..1 rgb
r.setShed(ladderLike);                       // { allows(name) } from Budget.ladder
r.requestRender();
r.pick(clientX, clientY);   // {type:"token",id} | {type:"door",id} | {type:"ground",x,y,zQ,i,j} | null
r.project(x, y, zQ);        // → {x, y} client px, for DOM labels
r.resize(width, height);
r.dispose();
```

- `WallState = { id, a:[x,y], b:[x,y], type:"wall"|"door"|"secret"|"window"|"terrain"|"invisible", door:"none"|"closed"|"open"|"locked", material, baseQ, topQ }`
- `TokenState = { id, x, y, footQ, groundQ, heightQ, widthCells, art, disposition, visible, ghost, controlled, hovered, targets:[css colour], turn:"current"|"next"|null, conditions:[{icon, value}], halo, bars:[{frac, color}], name }`.
  `groundQ` is the ground under a flyer (its stand reaches down to it); `halo`
  puts `conditions` on the base ring instead of the head plate.
- `setLinks`: only lines whose two ends are on the board; the view filters them
  (`integrations/target-lines.mjs`) and the renderer draws exactly what it gets.
- `setLighting`: `light` is a canvas covering px `[0, cols·size] × [0, rows·size]`
  (RGB = light added to the ambient), `vision` likewise (R = visible now, G =
  explored) or `null` for "everything visible". `darkness` 0..1 sets the ambient.
- `EffectState = { id, kind:"standing"|"flat"|"beam", source (video/img/canvas), x, y, zQ, x2, y2, z2Q, widthPx, heightPx, rotation, alpha, light:{color, radius}|null }`

## Checks

```bash
node tools/diorama-check.mjs
node tools/diorama-preview.mjs && node tools/preview-server.mjs   # /.preview/diorama.html
```

Zero problems required. The check covers the terrain codec and queries, cliff
edges, the 3D ray and cover, path analysis and system readouts, the auto-setup
heuristics, editor tools, renderer purity, every uniform written, `SHED_ORDER`
bound, and every dynamic i18n family (`GLDIO.kind.*`, `GLDIO.material.*`,
`GLDIO.band.*`, `GLDIO.cover.*`). The preview drives the shipped renderer with a
fabricated map; serve it (a `file://` page does not run module scripts). Nothing
there proves the sight backend, movement or Foundry's own vision; those need a live
v14 session.

## Not in v1

JB2A ground-effect placement, FXMaster weather, multi-Level scenes, hex grids, the
pixel-art filter, the depth-model auto setup (spike pending real maps), translations.
