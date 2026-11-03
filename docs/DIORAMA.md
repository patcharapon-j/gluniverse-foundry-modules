# Diorama

The battle map as a painted 3D diorama, like the old tactics RPGs: height-painted
ground blocks under the map art, Foundry's walls and doors as 3D walls, tokens as
die-cut paper standees on round bases. Height is **mechanical**: it occludes sight
and light (on the 2D canvas too), moves tokens up and down, stops walking at
cliffs, and shows cover and falls.

Feature id `diorama`, setting prefix `dio.`, i18n `GLDIO.*`, CSS prefix `gldio-`.
**Foundry v14 only** (`minimumGeneration: 14`), square grids only.

## What a table gets

- **The view.** A full-screen 3D overlay over the 2D canvas. The way in is the
  labelled **3D view** chip on the 2D board, beside the scene controls (shown where
  the view is offered and the scene is not switched off; hidden while the view is
  open and on the stream capture; `view/entry.mjs`), Shift+V, or the suite
  scene-control button. The way out is the labelled **Exit 3D** button under the
  toolbar (beside the scene controls), Esc or Shift+V; leaving pans the 2D canvas to
  centre what the 3D camera was looking at, so the switch keeps the player's place
  (never on the stream capture, whose camera owns the 2D view). A scene-control
  layer or tool switch never opens or closes it: only a press does. The 2D canvas
  stays the only source of truth: every action in 3D writes ordinary Foundry
  documents, and anyone can drop back to 2D for anything 3D does not cover.
- **The 2D map window** (toolbar map button, Shift+M; `view/peek.mjs`). A small
  framed window, docked bottom-right beside the sidebar the first time (32% of the
  viewport wide, 16:10), through which the **live** 2D canvas shows and takes input
  with all its usual tools: tokens, walls, lights, drawings, regions, the scene
  controls, the wheel. It is not a copy: the view's root gets an evenodd
  `clip-path` with the window's rectangle cut out, so the real `#board` under the
  overlay shows through, and a clipped-out region is not hit-tested, so every
  pointer and wheel event in it lands on Foundry's canvas (Foundry's wheel handler
  asks `elementFromPoint`, which honours the clip). The 3D input listens on its
  own canvas and never sees them; T and Escape over the window are Foundry's too.
  Opening it (and its Centre button) pans the 2D canvas so the 3D camera's target
  sits in the middle of the window; after that the user pans and zooms 2D freely,
  and the stream follow stands down while it is open. Drag it by the header,
  resize it from the top-left corner; its place is remembered per client
  (localStorage `gluniverse-foundry-modules.dio.peek`). **Switch to 2D** leaves the
  view centred on what the window was showing. Escape closes it before the view;
  it closes with the view and never opens on the stream capture. Foundry's canvas
  keeps rendering under the overlay the whole time (nothing in the suite pauses
  it; the Performance feature's idle rate wakes on any input), so the window adds
  nothing per frame and the 3D view still renders on demand.
- **Camera.** An orthographic tactics view: pitch presets 30° (default), 45° and 65°
  (R), yaw on the four diagonals (Q/E), or in 45° steps if the GM sets
  `dio.yawSnap` to 45. Free zoom (wheel) and pan (right or middle drag), all
  tweened. Opening the view frames the controlled token (a player's own token),
  else what the 2D canvas was showing when its centre is on the map, else the
  current combatant, else the scene's middle. The scene's
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
  scene's ambient). Each mote has a darker, slightly warm core and a lighter rim
  (`DUST_RAMP` in `render/art.mjs`), so the puff reads on pale stone by its core
  and on dark earth by its rim. A flyer breathes and sways on its stand
  (`TIMING.hoverLoop`, whole cycles per loop) while the stand and its foot stay
  put; its contact shadow shrinks and a soft one widens with altitude. A held
  figure does none of this. Plans and curves: `render/life.mjs` (pure). Off: the
  old slide with a plain bounce, and nothing moves on its own.
- **Other features, in 3D.** The targeting lines are the ones `stream-targets`
  draws on that client, in its colours: an arc from the source's chest with an
  arrowhead whose tip lands on the target's base, turned along the arc's end as
  it falls on screen, both with the dark ink edge and sized in device pixels
  (`LINK_PX`: a 10 px ribbon, a 32 × 24 px head). pf2e-odds badges and Roleplay
  Chat bubbles hang over the standee's head (suite api `tokenAnchor`). In stream mode the capture's view follows the
  stream camera, joins invites without a toast, and hides the view's chrome.
  The view sits on the board's layer, so Foundry's UI, Stage portraits and
  every suite overlay stay in front of it.
- **At the table in 3D.** The usual Foundry token controls, on the standees.
  Select by click, shift-click or a box dragged from empty ground (every token on
  your board whose foot or head is in it; shift adds); a click on the ground
  releases all. Drag-move with a path preview (distance, PF2e actions by Speed,
  Daggerheart range bands, climb and fall marks); dragging one of several
  controlled tokens carries them all by the same offset. Target (T), open / close
  doors, ping (long press or Alt+click), ruler (Ctrl+drag), the sheet
  (double-click), and hover distance + cover from the controlled token to the
  hovered one.
  **Right-click opens Foundry's own Token HUD** (`view/token-hud.mjs`), bound
  exactly as a 2D right-click binds it, so its bars, elevation, status effects,
  movement action, visibility, target and combat toggle are Foundry's, the
  system's and every module's. It is placed at the standee and follows it as the
  camera or the token moves: while the view is open `_updatePosition` is
  shadowed on the HUD instance and states the standee's screen box in #hud's own
  units (#hud is scaled with the hidden 2D stage, so the HUD is drawn at scale
  1 / stage scale, its controls at their native size). #hud sits under the view,
  so while the HUD is open it is lifted one step above it, with everything else
  in #hud hidden. Escape, a press elsewhere on the board, a drag or closing the
  view closes it. In 3D only it carries one more button, "Standee & height…"
  (`view/standee-app.mjs`), for the actor's owner and the GM. The HUD's
  elevation field is how a figure's height is set: see "Elevation is written".
  **Drop** an Actor, Item, Journal entry, Macro or anything else Foundry's canvas
  takes onto the 3D board: it is handed to Foundry's own canvas drop (a `drop`
  dispatched on #board) at the client point the 2D canvas has for the ground
  under the pointer (a standee's centre when dropped on one), so `dropCanvasData`
  and every system handler run as in 2D.
  **The keyboard is Foundry's.** The view keeps the Tokens layer active, so
  Delete, the movement keys and Tab act on what is controlled in 3D; the view
  keeps only T (target the hovered standee) and Escape.
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
  scene's diagonal rule); world adapter: `view/reach.mjs`. A drop off a ledge
  is a legal step, but the route never takes one to save a few feet: it is
  solved twice, without drops and with them, and a square the first reaches
  keeps that route (`preferReach`), so a walker goes down the stairs and jumps
  only where that is the only way down. Each square is drawn per sub-cell on
  the ground under it, so one on a flight lies on its steps. Per player
  (`dio.reach`): when selected, only while moving, or never.
  Other creatures count too. A mover may pass through an ally's squares but not
  end there, and may not pass through an enemy's, so those squares show as out
  of reach. Disposition decides: the same side, or a neutral on either side, is
  an ally. Under PF2e a Tiny creature shares space either way round. A creature
  wholly above or below the mover (a flyer overhead) is not in the way, a big
  token fills every square it covers, and a big mover may not end with any part
  of its footprint on someone. Only creatures the viewer can see count
  (`token.isVisible`; under "view as players", the tokens on that board), and a
  dead one is not in the way. This changes the shading and the red warning on a
  drop, never the drop itself.
  The range, the cell marks and the walked path are drawn only on seen ground:
  over unseen ground they discard, they fade under the mist's edge, and the
  range draws before the fog bank, so none of them traces the shape of what
  the mist hides.
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
- **Tiles and buildings.** Foundry tiles draw in 3D: ground tiles as decals on the
  terrain, overhead tiles as roofs that fade while a viewer's figure is inside, with
  the GM's "cut away roofs" for every interior. Bridges and arches walk by the prop
  rules. See `docs/DIORAMA_BUILDINGS.md`.
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

`terrain/model.mjs`. One height field per scene Level (see [Levels](#levels)),
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

## Levels

Foundry v14 scenes can hold several Levels (floors). Each has its own elevation
range, its own background art, and the walls and regions included in it
(`common/documents/level.mjs`, `client/documents/level.mjs`). Diorama gives every
Level its own terrain and its own props.

- **Which Level.** `terrain/levels.mjs` `resolveLevelId` is the only answer. A
  Level that was asked for wins if the scene holds it. Otherwise it is the Level
  viewed on the canvas (`scene._view`), then the initial Level, then `"default"`,
  the key a scene with no Levels was always stored under. Old worlds read exactly
  what they wrote, so nothing migrates.
- **Two frames.** Stored heights are relative to their Level's base: the bottom,
  or min(top, 0) for an open bottom, as `Level#prepareBaseData` computes it.
  Token elevation stays absolute. The rules work in the Level's own frame and take
  the base off an absolute elevation (`context.mjs` `localQ`, the eyes in
  `sight-backend.mjs`, `cover.mjs`). The ground they write back adds it
  (`movement.mjs` `groundFrom`). The 3D view works in the absolute frame:
  `liveTerrain(...).absolute()` is the same terrain lifted by its base, rounded to
  whole q. A base that is not a whole q can leave a figure up to half a q off its
  floor in the view. The rules use the exact base.
- **A one-Level scene has base 0** whatever its Level says (`levelBaseDist`), and
  `absolute()` returns the same objects, so it draws and plays exactly as before.
  `tools/diorama-check/levels.mjs` holds that regression.
- **The rules read the token's own Level.** `tokenContext(doc)` uses
  `TokenDocument#level`. The drag wrapper uses the waypoint's Level, the cost
  function and the elevation sync use the token's, and a change of Level counts
  as a move. A repaint re-seats only the tokens on the Levels it touched
  (`install.mjs` `levelsToResync`, `movement.mjs` `planResync`). The sight and
  light backends read the polygon's own Level (`PointSourcePolygon#level`).
  Detection between tokens on different Levels is left to Foundry's own
  cross-Level test. Terrain cover between two tokens on different Levels is
  nothing, and the tactics line between them uses walls only.
- **Caches.** `live.mjs` caches per scene and Level. `createLevel`,
  `updateLevel` and `deleteLevel` drop the scene's entries.

### Drawing the stack

The 3D view follows Foundry's viewed Level. Changing Level is Foundry's job (the
scene navigation's Level buttons, a staircase region). It redraws the canvas, and
the overlay reads the new Level on `canvasReady`.

- `view/levels.mjs` (pure) plans the stack. A Level with a higher base than the
  viewed one, or the same base, is cut away and never drawn. Levels below are
  drawn as quieter floors at their own base, each with its own art and props. A
  player gets the ones the viewed Level lists in `visibility.levels`, which is the
  rule Foundry uses to draw another Level's art (`Scene#_configureLevelTextures`).
  The GM's own view also gets the rest, as dimmer ghosts. At most `MAX_BELOW`
  floors are drawn, the nearest ones.
- `render/level-stack.mjs` draws those floors. Each gets its own materials on the
  scene's existing programs, so nothing new compiles. They cast no shadows. The
  table drops to the lowest floor.
- Props on the floors below are tagged with their Level (`<level>:<id>`), lifted
  by its base, and never block, so nothing from another floor stamps into the
  viewed floor's ground. The props layer itself is unchanged.
- Tokens keep Foundry's visibility (`token.isVisible`). A token on a cut-away
  Level is a ghost in the GM's own view and is not drawn for anyone else
  (`cutTokens`).
- Only the viewed Level's walls stand in the view (`CanvasDocument#includedInLevel`;
  a wall with no Levels set is in all of them).

### Editing a Level

The editor edits the Level viewed on the canvas and names it in its title. Its
Level row lists every Level, highest first, and marks those with saved terrain.
Picking one views it on the canvas and the editor follows, asking first if the
draft has changes. It reads and writes only that Level's terrain, props and
difficult-terrain regions, and a new region is limited to that Level. Auto setup
and the magic wand read that Level's own art. The 3D preview stacks the floors
below the edited one.

### Limits

- A click through a hole picks the table plane, not the floor below.
- A difficult-terrain region written before Levels (no Levels set) is in every
  Level, so it shows in each Level's editor.
- A layout import places tokens at the Level's local elevation. The GM's
  elevation sync corrects them.
- When a Level's base changes, tokens are re-seated against the new base only.

## Height is mechanical

- **Elevation is written.** A token's `elevation` = ground under it + its own
  altitude (token flag `dio.altitude`, for flyers). Written per waypoint in the same
  move (`Token#_getDragWaypointPosition`), so drags animate up and down ledges.
  Repainting under standing tokens resyncs them (active GM, one batched update).
  An elevation set on purpose with the token staying on its square (the Token
  HUD's field, the token config, the keyboard's up / down, a macro) re-derives
  the altitude, `max(0, elevation − ground)`, in the same update on the client
  that makes it (`preUpdateToken`), so the figure stays at that height and later
  moves carry it, with or without a GM connected. A new token (a drop, a paste)
  is seated on the ground under it on `preCreateToken`: a pasted flyer keeps its
  altitude flag, otherwise an elevation above the ground becomes its altitude.
- **Cliffs block walking.** A rise above the step height (default 2.5 ft) costs
  Infinity for `walk` (Foundry's own pathfinding routes via stairs / ramps), is
  allowed at cost for `climb`, and only sets the minimum altitude for `fly`. A drop
  above the step height is flagged as a fall with a damage hint (PF2e: half the fall
  as bludgeoning, 20 ft shorter into water). Nothing is applied automatically.
- **Sight and light.** A custom `ClockwiseSweepPolygon` subclass is installed as
  `CONFIG.Canvas.polygonBackends.sight` and `.light`. For each source it adds the
  outline of high ground as ordinary edges, so the 2D canvas and the 3D view draw
  the same polygons. A light is cut by all ground above it (its elevation +
  ground). Sight is cut only by ground more than 6 ft (a medium creature) above
  the eye (token elevation + 0.9 × creature height), so the fog lifts wherever a
  creature standing there would be seen, not only where the floor itself is.
  Stairs and ramps are open at their foot: seen from below along its descent,
  someone standing anywhere on a flight is in view, so the outline leaves out
  the edge a flight comes down over. Its flanks stay cliffs, and the outline
  still runs where it meets high ground that is not a slope, so the terrace it
  leads to stays hidden (`cliffEdges`). Point tests (`testCollision`, used by token
  detection) instead march the real 3D segment over the height field, because they
  have real target heights; feet, centre and head are tested.
  Ground below the eye is never outlined, so high ground sees down; a creature
  pressed against the foot of the viewer's own cliff stays hidden by the lip.
- **Walls have a top.** It is the one the 3D view draws (`terrain/wall-top.mjs`):
  the highest ground beside the wall plus the scene's wall height, or the Wall
  Height module's `top`. A polygon whose eye is above that top drops the wall, and
  a point test drops it when its 3D ray crosses above the top, so a lookout on a
  tower sees over a fence below while a creature tucked behind the fence stays
  hidden. Each target height the ground leaves clear is tested against the walls
  on its own. Scene bounds and other modules' edges always block, and the
  tactics line passes over a wall the same way. Movement uses the same top: the
  backend is also installed for `move`, and a move gets past a wall only when the
  token's feet where it crosses are within the step height of the top (flying
  over it, or a low rail). Climbing does not pass a wall: anyone can pick Climb,
  and a room wall has no ceiling above it here. The reach overlay applies the
  same rule (`movesOverWall`). Wall tops apply on any scene with saved terrain,
  flat included (`wallContext`); a scene with none stays plain Foundry.
  See [ADR 0002](adr/0002-height-sight-backend.md).
- **Cover** from terrain: five rays from the attacker's eye to the target (feet,
  middle, head, both flanks). Some blocked = standard, most = greater. Shown on
  hover and targeting only; PF2e's own cover is per-target for all attackers, so
  applying it for one attacker would be wrong for the rest.
- **Creature height** by size (Tiny 2.5, Small 3, Medium 6, Large 10, Huge 15,
  Gargantuan 20 ft, converted to the scene's units, so a metre scene gets
  metres), overridable per actor in the **Standee** window: actor flag
  `dio.heightCm` (centimetres, entered as cm or ft + in), converted to the
  scene's distance units (`ft`/`feet` ÷ 30.48, `m`/`metre(s)`/`meter(s)` ÷ 100,
  unknown units read as feet). The legacy flag `dio.height` (distance units) is
  still read below it; saving the window moves it to `dio.heightCm`.
  `rules/creature.mjs` `creatureHeightDist` is the one reader.
- **The Standee window** (`view/standee-app.mjs` `openStandeeConfig(actor)`),
  for the actor's owners and the GM, from the actor sheet header (ApplicationV2
  and AppV1 sheets, PF2e's included) and the Token HUD: the standee art (the
  portrait, or a picked file written to `dio.standee`), two lines dragged to
  the top of the head and the soles of the feet (`dio.artMarks`), and the
  height. With marks, the span between them is the creature's height and the
  feet line stands on the base; art below the feet is cut off, art above the
  head (a raised sword, a hat) draws above the height. Marks are stored as
  `{ top, bottom, src }`, fractions 0..1 of the art's height plus the art they
  were made on, and are ignored on any other art (a disguised token, a changed
  portrait). No marks: the whole art is the height, as before.

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
  a "view as players" toggle applies a player's view. Under it a hidden token
  leaves no trace: no standee, no movement range or footprint even while the GM
  has it selected, no Sequencer effect attached to it or aimed from or at it,
  and no pool from a light it carries.
- **A known layout** (scene flag `dio.known`, the GM's Scene environment panel,
  "Players know this map's layout"). The bake starts every square explored, so
  ground nobody has seen yet takes the remembered look instead of the fog:
  terrain only, since creatures still need sight. 3D only: Foundry's 2D fog is
  unchanged. GM's "view as players" honours it too (it has no explored fog of
  its own otherwise).
- **Fog of war as dark mist** (`dio.fogStyle` "clouds", client; Low quality
  keeps the flat look). Unexplored ground lies under a bank of slowly drifting
  mist (`render/fog.mjs`): a cool dark slate lit by the sky alone, well below
  the lit board so what the party sees stands out. It lies along the ground
  the party has seen, averaged over a few squares, so it meets each known
  terrace at its height; over ground nobody has seen it settles flat on the
  lowest ground, so it never rises into the shape of a hill or tower hidden in
  it. Its floor is dense over the unseen, thins where it turns edge-on to the
  camera and fades out across the blurred bake as a ragged veil over the edge
  of sight, and translucent wisps streak above it down the wind. **Unseen
  ground is never drawn at all**: tops, cliff faces, water, props and walls
  there discard, so they write no colour and no outline. A cliff face counts
  as seen when the top it hangs from is, or the ground just past its foot
  (`FACE_FOOT`, half a bake pixel, so seen ground has to reach the face itself:
  any further would look over a Foundry wall standing just in front of it,
  which the bake knows and the shader does not). So the near face of a terrace
  too tall for sight to reveal its top still stands on the seen ground and
  rises into the mist. Such a face takes its fog look from half a square out
  (`FACE_FOG`), since the edge of sight is full mist at its foot. A prop on
  such hidden ground is asked about the way a token there is, in 3D at its
  foot, middle and top past the ground and the walls (`columnSeen`,
  `view/props-seen.mjs`), so a tree whose crown clears the lip draws while the
  ground under it stays hidden. The gap is filled by
  a mist backdrop: a box over the board's footprint, from the plinth to above
  the highest ground anyone has seen or explored, drawn from inside at the far
  plane. Its top reads only seen ground (`fogSeenTop`), so the mist never
  stands exactly as tall as the tallest tower hidden in it; it rises when that
  tower is first seen. Its shape is the
  board's bounding box, and it reads no terrain: it paints where some point of
  the pixel's ray inside the box is unseen, in the bank floor's colour. The ray
  is tested at 24 taps, which on a big board lie more than a square apart, so
  it reads a coverage map built from the vision bake with the unseen grown by
  half the widest tap spacing (the board's diagonal over 48); a narrow unseen
  wedge behind a pillar cannot fall between two taps. Whatever the party can
  see draws over it, the camera
  finds no hole under the bank's rim or down the board's side, and an unseen
  tower is no prism and no silhouette, even where it would stand past the
  board's edge against the room. Nothing unseen throws a sun shadow either (the
  receiver finds the caster along the key from the shadow map's depth and drops
  it if nobody has seen it), so a hidden tower cannot lay its outline across
  the ground. Lit
  ground falls into the fog's shadow over most of a square at the edge of sight,
  and ground out of sight now fades to its remembered look (dim, grey, a faint
  mist) rather than switching at a line. The wide blur alone never reaches full
  mist over a thin wedge behind a pillar, which left a hard dark cut where the
  ground stops being drawn. So the soft map's blue channel holds the unseen
  grown by a quarter square and softened over a fifth (`FOG_EDGE_GROW`,
  `FOG_EDGE_SOFT`), and every reader takes the larger of the two
  (`fogUnseenAt` in `glsl.mjs`): the mist reaches its full colour at that line
  and the edge of sight is soft over a fraction of a square. Figures are never fogged. The drift is
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
- Standee art is the actor portrait for every viewer, so a bestiary creature
  stands as its full art for the players too (a mystery-man or missing portrait
  falls back to the token image). The GM's standee override (actor flag
  `dio.standee`) always wins. One escape hatch keeps a disguise: to a viewer who
  cannot Observe the actor, a token whose image was deliberately changed from
  the actor's prototype token image shows that token image instead (a mimic's
  chest token stays a chest). A prototype that picks a random or wildcard image
  is never read as a disguise. `view/snapshot.mjs` `tokenArtFor`.

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
first): tilt-shift, atmosphere, embers, video tiles (they hold their frame), weather particles, the fog of war's drift
(the mist holds still), ambient occlusion, soft shadows, torch
shadows and torch-side shading, prop detail, shadows, torch flicker (lights burn
steady, flames hold still), water animation, landing dust, roof fades (roofs snap), standee sway (and a
flyer's hover), marker motion (the
reticle's breathe and the target lines' glint, `TIMING.reticleBreathe` /
`linkGlint`), area motion (spell volumes hold still), effect lights, render scale 0.75, 30 fps cap. Each rung only ever
caps what the player's own Graphics settings asked for; with adaptive shedding off
nothing is shed. Vision, lighting correctness and fog are never shed.

### A still board draws nothing

A board where nothing moves renders **zero frames** and holds no
`claimMotion`. Every layer keeps that true, and a new one (tiles, roofs, slabs,
anything) follows the same four rules:

- `frame(t, dt, …)` returns `true` only while the layer itself is moving: a
  tween in flight, a fade, a video that is playing. A layer at rest returns
  `false`, even if it could animate. The renderer keeps requesting frames and
  holds `claimMotion` only while some layer returns `true`.
- Never call `requestRender()` from inside a frame or on a timer. Call it from
  a setter when the state you were handed changed, and only then. No
  `setTimeout`/`setInterval` under `render/` at all (the check refuses them).
- The sun's shadow map is cached. It renders again only when a caster or the
  sun changed: walls and props set `shadow.dirty`, standees raise
  `castersDirty` from a pose signature that leaves out hover, and the camera
  never dirties it (the shadow camera is fitted to the board, not the view). A
  layer with casters of its own lists its caster group in the renderer's
  `_casters` and raises its `castersDirty` (or calls `markShadowsDirty()`) when
  they change shape or place, never every frame. Something that casts while it moves (a swinging door, a lifting
  miniature) marks it dirty on the frames it moves and stops when it stops.
- Torch light is the one thing that lives on a still board, and it ticks
  instead of running at the frame rate. A flicker steps every
  `TIMING.flickerTick` (66 ms, about 15 Hz) and a flame or its embers every
  `TIMING.fireTick` (33 ms); `flickerTick` is a whole multiple so the two share
  frames. Animation frames before the next tick return at once, a tick whose
  lights did not visibly change (`FLICKER_EPS`) draws nothing, and a light whose
  reach is off screen does not tick at all. Torch figure-shadows rewrite their
  buffers only when a light or a figure moved. The `torchFlicker` and `embers`
  rungs still stop them outright.

Measured in the preview (swiftshader, 360×240, settled): a still board without
torches is 0 frames per second; with a torch and a brazier in view, about 30
(the fire tick; a flicker alone is at most 15); panning is the full frame rate;
the shadow map renders 0 times per second both while panning and at rest. Before
this, any lit torch near the view kept the frame rate at the display's.

Two things keep a board with figures from being still today: standee idle sway
and a flyer's hover (`tokenLife`), and the target reticle's breathe. Both are
real motion and both shed (`standeeSway`, `markerMotion`).

### The cost readout

The Graphics panel shows what the view costs right now: GPU and CPU time per
drawn frame, frames per second, draw calls, triangles, shadow-map renders per
second and the shed rung in force. The perf overlay shows the same rows under
"3D view" (`features/perf/readouts.mjs` is how a feature adds a section). GPU
time is `EXT_disjoint_timer_query_webgl2`: one query per drawn frame, read back
frames later and never waited on, all results in flight dropped on a disjoint
event, and "n/a" where the browser does not offer the extension. Nothing is
timed unless one of the two is open (`setProfiling`, `Budget.profiling`).

### Shaders on Windows

Chrome on Windows runs WebGL through ANGLE's D3D11 backend, which compiles GLSL
to HLSL. Two patterns warn there and can fail to link on some drivers, which
leaves the view drawing nothing: an implicit-level `texture()` inside a loop
D3D cannot unroll (a runtime bound, a `break`, or a loop after an early
`return`; warning X3595), and an early `return` before a result is set (X4000).
Sample with `textureLod(…, 0.0)` in loops (the bakes and shadow maps have no
mipmaps anyway) and give such functions one exit. The check scans every program
for the first and pins the soft-shadow loop, `shadowTap`, `paintedSide` and the
blur. To see the real compiler output, `probe=shaders` in the preview prints
every program's info log; run it in headless Chrome with `--use-angle=d3d11`.

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
r.setTiles(TileState[]);                     // integrations/tiles.mjs readTiles()
r.setRoofs({ roofs: RoofState[], focus });   // view/roofs.mjs readRoofs()
r.setLinks([{ sourceId, targetId, color:[r,g,b] }]);  // targeting lines, 0..1 rgb
r.setShed(ladderLike);                       // { allows(name) } from Budget.ladder
r.requestRender();
r.markShadowsDirty();                        // a caster moved: the cached sun shadow renders once more
r.setProfiling(on);                          // time frames (the Graphics panel's readout)
r.profile();                                 // { gpuMs, gpuSupported, cpuMs, fps, shadowsPerSec, calls, triangles, shed } | null
r.pick(clientX, clientY, { exclude, doors });  // {type:"token",id,part:"air"|"ground"} | {type:"door",id} | {type:"ground",x,y,zQ,i,j} | null
r.pickPlane(clientX, clientY, zQ);           // {x, y} px on the level plane at zQ
r.project(x, y, zQ);        // → {x, y} client px, for DOM labels
r.resize(width, height);
r.dispose();
```

- `WallState = { id, a:[x,y], b:[x,y], type:"wall"|"door"|"secret"|"window"|"terrain"|"invisible", door:"none"|"closed"|"open"|"locked", material, baseQ, topQ }`
- `TokenState = { id, x, y, footQ, groundQ, heightQ, widthCells, art, artTop, artBottom, disposition, visible, ghost, controlled, hovered, targets:[css colour], turn:"current"|"next"|null, conditions:[{icon, value}], halo, bars:[{frac, color}], name }`.
  `groundQ` is the ground under a flyer (its stand reaches down to it); `halo`
  puts `conditions` on the base ring instead of the head plate. `artTop` /
  `artBottom` are the top of the head and the soles of the feet in `art`,
  fractions 0..1 of its height, or `null` (both, or neither): with them the
  card's head-to-feet span is `heightQ` and the art below `artBottom` is cut
  off (`render/art.mjs` `composeCard`, `render/standees.mjs` `cardLayout`).
  Cards are cached per art URL **and** marks, so two actors sharing art with
  different marks each get their own.
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
rays, the visibility gates, and every area volume to its covered cells.
`tools/diorama-check/buildings.mjs` holds tile placement, who gets a tile, the
roof-fade table and the bridge and arch walk rules.
`tools/diorama-check/levels.mjs` holds Level resolution, bases and both frames,
the stack plan and cutaway, per-Level stores, caches, resync and eyes, and the
one-Level regression; `levels=1` (or `levels=ghost`) in the preview draws a
two-floor stack. The preview drives the shipped renderer with a
fabricated map; serve it (a `file://` page does not run module scripts). Nothing
there proves the sight backend, movement or Foundry's own vision; those need a live
v14 session.

## Not in v1

JB2A ground-effect placement, hex grids, the pixel-art filter,
the depth-model auto setup (spike pending real maps), translations. The movement
range ignores other creatures' spaces (PF2e lets you pass allies and not end in an
enemy's square; Foundry decides that on the move itself).
