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
- **Token life** (`dio.tokenLife`, per client). A moving figure hops once per
  square, timed from the move's own speed (`TIMING.standeeStep`), and settles with
  a slight squash. A walker whose move ends more than half a cell lower steps off
  the edge and falls with gravity (`TIMING.standeeFall` × √drop), lands squashed
  and raises a puff of dust; stairs and ramps are hopped down, never fallen. Dust
  also rises at the end of a move and where a lifted miniature is set down
  (`render/dust.mjs`, a fixed pool on the shared unlit program, tinted by the
  scene's ambient). A flyer breathes and sways on its stand
  (`TIMING.hoverLoop`, whole cycles per loop) while the stand and its foot stay
  put; its contact shadow shrinks and a soft one widens with altitude. A held
  figure does none of this. Plans and curves: `render/life.mjs` (pure). Off: the
  old slide with a plain bounce, and nothing moves on its own.
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
- **Tactical readouts** (`dio.tactics`, per client). Hovering a token while one
  of yours is selected, and every token you target, draws a sight line from eye
  to eye: solid while clear, dashed where terrain or a sight-blocking wall cuts
  it, faint past the first block, with a ring where it is first cut. The label
  gives the 3D distance (PF2e: the system's own `distanceTo`, restated in
  `rules/distance3d.mjs` for the preview and the check), how far above or below
  the target is, and a cover chip (none, standard +2, greater +4 AC, or no line
  of sight; `rules/los.mjs`). Nothing is drawn to a token `token.isVisible` says
  the viewer cannot see, and nothing at all under "view as players". While
  carrying a walker along a route it can walk, every step that drops off a ledge previews
  the fall: a dashed drop from the lip and "Drop 10 ft · 5 bludgeoning, lands
  prone" (PF2e, `rules/fall.mjs`), with the water note when it lands in water.
  Display only: no damage, no prone, no cover is ever applied.
- **Movement range.** Selecting a token you own shades the squares it can reach in
  one, two and three Strides (PF2e; Close for Daggerheart), counting walls and
  one-way walls (`canvas.edges`), difficult terrain (movement-cost Regions, at the
  token's elevation) and cliffs. Solver: `rules/reach.mjs` (pure Dijkstra with the
  scene's diagonal rule); world adapter: `view/reach.mjs`. Per player
  (`dio.reach`): when selected, only while moving, or never.
- **Pick up and set down.** Dragging a token you own lifts the miniature clear of
  the table (it overshoots a little, stretches as it leaves, bobs in the hand and
  leans into the motion) and drops it onto the square under the hand when you let
  go: one `TokenDocument#move`, placed with `animate: false`, so it never walks. The
  carried pose, and the colour of the squares it will land on, reach everyone
  watching the scene live (socket `hold`, throttled, re-sent every
  `TIMING.holdKeep` while the hand is still; a hidden token's goes to GMs only;
  drawn only by a viewer whose board shows that token).
  **Warn, never block.** Out of reach, up a cliff or past a wall is shown, never
  refused: the landing squares and the route turn red, the readout says why
  ("No walking route this turn", "More than a turn's movement") and that it can
  still be set down. The move is made with `constrainOptions: {ignoreWalls,
  ignoreCost}` and records the reach's cheapest route when one exists (so its cost
  is kept), else the straight line. Foundry's pause still applies to players.
- **Flyers** are grabbable by the figure, its glass stand or its foot and squares
  on the ground. By the figure they move at their altitude (the pointer is read on
  the level plane at their feet); by the foot, the pointer's square is the square.
- **Options.** Every graphics and handling choice is a per-client setting in the
  view's Graphics panel (`options.mjs`: quality preset and its overrides, adaptive
  shedding, day/night, grade, grid strength, range, token animation). The table's rules
  (where time and weather come from, whether props block) are world settings.
- **Environment and props.** Time of day, weather and air per scene
  (`docs/DIORAMA_ENVIRONMENT.md`); primitive props placed in the editor or a layout
  (`docs/DIORAMA_PROPS.md`).
- **Walls.** Camera-facing walls drop to a stub so rooms read. Doors swing.
- **Light and vision.** Lit from Foundry's own light polygons, hidden by Foundry's
  own vision polygons and explored fog. Unexplored ground is not drawn at all.
- **Invites.** When the GM opens the view, players on the scene are invited
  (ask / auto / never, per client). The GM can bring everyone to their camera, and
  anyone can follow the current combatant.
- **Effects.** Sequencer / JB2A effects are mirrored into 3D: standing, flat on the
  ground, or as beams. Templates show as highlighted cells.
- **Spell areas in 3D** (`dio.areaVolumes`, per client). A PF2e area stands up
  over its highlighted cells (`render/areas.mjs`): a burst as a dome, an
  emanation as a shell around its creature, a cone as a wedge falling away from
  its apex, a line as a raised slab. The volume is cut to the staircase of
  covered cells (pf2e-aoe's `pf2eCoverage`, else Foundry's own cell test) and
  stands on the terrain, so a burst on a plateau sits on the plateau and pours
  down its edge in steps. Translucent, in pf2e-aoe's colours, with device-pixel
  rims and one-cell contours, and a slow band of light drifting up it
  (`TIMING.areaDrift`, shed as `areaMotion`). The flat highlight stays under it.
  A hidden region, or one attached to a token the viewer cannot see, is never
  drawn for players (`integrations/templates.mjs` `mayShowArea`).

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
- **Fog of war as dark mist** (`dio.fogStyle` "clouds", client; Low quality
  keeps the flat look). Unexplored ground lies under a bank of slowly drifting
  mist (`render/fog.mjs`): a cool dark slate lit by the sky alone, well below
  the lit board so what the party sees stands out. It lies along the ground
  blurred over a few squares, so it follows the terraces and keeps no shape of
  anything standing in it; its floor is dense wherever the bake says nobody has
  seen, thins where it turns edge-on to the camera and fades out as a veil over
  the edge of sight, and translucent wisps streak above it down the wind.
  **Unseen ground is never drawn as itself**: tops, cliff faces and water there
  are painted flat in the fog's colour, and beyond the first square past the
  edge of sight they are a backdrop at the far plane, so an unseen tower hides
  nothing and casts no silhouette to read its shape from, and the camera never
  finds a hole under the bank's rim. Unseen props and walls are discarded. Lit
  ground falls into the fog's shadow over most of a square at the edge of sight,
  and ground out of sight now fades to its remembered look (dim, grey, a faint
  mist) rather than switching at a line. Figures are never fogged. The drift is
  a straight translation of the noise (`FOG_DRIFT_CELLS` per `TIMING.fogDrift`),
  so it never repeats and never wraps. With no vision bake (the GM) there is no
  fog at all.
- **Living light** (`dio.lightFx`, client; off at Low). The bake already holds
  every light; living light only shapes it (`render/torches.mjs`). Lights flicker
  by their Foundry animation: `torch`/`flame`/`fire` (and candle, campfire,
  fireplace) flicker at their speed and intensity, `pulse` breathes, a warm light
  with no animation wavers gently, anything else burns steady. Flicker is smooth
  value noise on the clock, never periodic, within ±22%. The eight lights nearest
  the camera's target shade surfaces and standees by direction (faces toward a
  light brighter, away darker, flat ground kept exactly at the bake), give a
  figure a rim on its torch side, and throw each standing figure a soft shadow
  away from its one or two strongest lights. A fire-like light (a fire
  animation, or a warm light on a prop labelled brazier, torch, hearth, lantern
  and the like) gets a stylized flame and rising embers at its foot; a light a
  token carries flickers but draws no flame. Flames, embers and figure shadows
  show only where the viewer sees right now. A light's elevation is absolute,
  like a token's. The view hands the renderer each light's position, radii,
  colour and animation from the bake (`view/bake.mjs` `lightData`).
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
- Cliff faces take the map colour at their lip, softened through the map's mips
  so one texel never streaks down the whole face, under the material's relief.
  A ragged overhang band hangs from each lip (earth most, wood none), grime runs
  down from it, and each lip gets a bevel highlight and a device-pixel hairline.
- Water: refracts the map under it, tints with depth, throws caustics, glints the
  sun (shadowed where the sun is blocked), reflects the sky at grazing angles and
  laces foam along its banks. Banks standing in water (side flag +4) darken below
  a waterline and carry caustics. Pits fade to dark. Void is not drawn.
- The terrain field (`render/terrain-field.mjs`, rebuilt on every terrain change,
  8 texels per square): R is horizon AO on tops, G the signed distance to the
  nearest lip, B the distance from water to its bank. Tops, sides and water all
  read it, so creases darken, lips catch light and foam finds the shore at any zoom.
- Light: one sun with a 12-tap rotated Poisson soft shadow, a warm bounce on
  faces, a cool sky fill, a gentle height grade (higher reads lighter), and a
  dithered colour grade. The board stands on a plinth with a trim line, and casts
  a soft shadow on the table away from the sun.

## Performance

The view renders **on demand**: a frame only when the camera, a token, a light or
an effect changes; `Budget.claimMotion` is held only while something animates.
The WebGL context is registered with `Surfaces`. `SHED_ORDER` (cheapest loss
first): tilt-shift, atmosphere, embers, weather particles, the fog of war's drift
(the mist holds still), ambient occlusion, soft shadows, torch
shadows and torch-side shading, prop detail, shadows, torch flicker (lights burn
steady, flames hold still), water animation, landing dust, standee sway (and a
flyer's hover), marker motion (the
reticle's breathe and the target lines' glint, `TIMING.reticleBreathe` /
`linkGlint`), area motion (spell volumes hold still), effect lights, render scale 0.75, 30 fps cap. Each rung only ever
caps what the player's own Graphics settings asked for; with adaptive shedding off
nothing is shed. Vision, lighting correctness and fog are never shed.

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

**Import layout** takes a layout: the terrain written as JSON (palette, then
shapes in map squares), usually by an AI agent following the
`diorama-map-setup` skill, which can read a map far better than Auto setup can.
It replaces the draft as one undoable step. Format and API:
`docs/DIORAMA_LAYOUT.md`; offline compile and overlay: `tools/diorama-layout.mjs`.

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
r.setHold(id, { x, y, footQ, groundQ, phase:"carry"|"drop" } | null);  // a miniature in a hand
r.setLighting({ darkness, light, vision, sources });  // canvases, world-space, see below
r.setOverlays({ path, cells, ruler, pings, hover, reach, los, falls });
r.setAreas(AreaState[]);                     // integrations/templates.mjs templateAreas()
r.setEffects(EffectState[]);
r.setCamera({ yawStep, pitchIndex, zoom, target }, { animate });
r.getCamera();
r.setOptions({ tiltShift, cutaway, ghosts, grid: { on, color, alpha }, graphics });
r.setEnvironment(env);                       // environment.mjs resolveEnv()
r.setProps(PropState[]);                     // terrain/props.mjs propStates()
r.setLinks([{ sourceId, targetId, color:[r,g,b] }]);  // targeting lines, 0..1 rgb
r.setShed(ladderLike);                       // { allows(name) } from Budget.ladder
r.requestRender();
r.pick(clientX, clientY, { exclude, doors });  // {type:"token",id,part:"air"|"ground"} | {type:"door",id} | {type:"ground",x,y,zQ,i,j} | null
r.pickPlane(clientX, clientY, zQ);           // {x, y} px on the level plane at zQ
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
  `sources` (optional) are the lights in the bake, for living light:
  `[{ id, x, y, dim, bright (px), elevation (distance units), tint:[r,g,b] 0..1,
  color:[r,g,b]|null, anim:{ type, speed, intensity }, token }]`.
- `EffectState = { id, kind:"standing"|"flat"|"beam", source (video/img/canvas), x, y, zQ, x2, y2, z2Q, widthPx, heightPx, rotation, alpha, light:{color, radius}|null }`

## Checks

```bash
node tools/diorama-check.mjs
node tools/diorama-preview.mjs && node tools/preview-server.mjs   # /.preview/diorama.html
```

Zero problems required. The check covers the terrain codec and queries, cliff
edges, the 3D ray and cover, path analysis and system readouts, the auto-setup
heuristics, editor tools, layouts (every op, every refusal, the worked example
compiled and held to symmetry), the terrain field and the wet bank flag,
renderer purity, every uniform written, `SHED_ORDER` bound, and every dynamic
i18n family (`GLDIO.kind.*`, `GLDIO.material.*`,
`GLDIO.band.*`, `GLDIO.cover.*`). `tools/diorama-check/tactics.mjs` holds the
3D distance to PF2e's rule, the falling table, the sight line against the cover
rays, the visibility gates, and every area volume to its covered cells. The preview drives the shipped renderer with a
fabricated map; serve it (a `file://` page does not run module scripts). Nothing
there proves the sight backend, movement or Foundry's own vision; those need a live
v14 session.

## Not in v1

JB2A ground-effect placement, multi-Level scenes, hex grids, the pixel-art filter,
the depth-model auto setup (spike pending real maps), translations. The movement
range ignores other creatures' spaces (PF2e lets you pass allies and not end in an
enemy's square; Foundry decides that on the move itself).
