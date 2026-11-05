---
name: diorama-craft
description: "The quality bar for the Diorama feature's 3D view (scripts/features/diorama/render/): standees, outlines, the effect halo, target reticles and lines, terrain, light and shadow, camera motion. Use before writing or reviewing anything under diorama/render/ or tools/diorama-preview.mjs. API reference lives in the threejs-* skills; motion decisions in animate; this skill says what good looks like here."
---

# Diorama craft

The `threejs-*` skills say how the API works. This one says what to build so the
diorama reads like a painted miniature table and not like a CG demo. It is the
GLUniverse VTT `threejs-craft` bar, adapted to a Foundry v14 module.

## Where 3D lives here

- three.js r169, vendored at `scripts/vendor/three/`, WebGL2 only (no WebGPU, no
  TSL). One renderer, one context, registered with `Surfaces` and shed through
  `Budget.ladder("diorama", SHED_ORDER)`. Never open a second context.
- Orthographic camera at 30, 45 or 65 degrees pitch, yaw snapped to the four
  diagonals by default (`dio.yawSnap`). Design for those views: the top and
  the two camera-facing sides of every block are all anyone sees.
- The 2D canvas is the truth. The view draws what Foundry decided (visibility,
  light, targets, conditions) and never decides it.
- The renderer is pure: nothing under `render/` reaches `game`, `canvas` or
  `foundry`. The preview drives the shipped files, so a world read there makes
  the preview a second copy that flatters whichever one was touched last.

## 1. Light: one sun, matched to the map

- One key direction (`uKeyDir`), about 38 degrees up. Painted battle maps
  already carry their own light, so the key adds form to blocks and figures;
  it never re-lights the paint. Sky fill is cool, sun is warm (`SKY_FILL`,
  `SUN_KEY` in `glsl.mjs`).
- Never add a light to "brighten it up". Raise ambient or exposure instead. A
  second key doubles every highlight and reads as CG.
- Standee cards are lit as if they stand upright, from their foot, so a figure
  in a wall's shadow goes dark with the wall.

## 2. Grounding: contact first, then the shadow map

- Every standee gets a contact shadow on the ground under its footprint, also
  while flying (the glass stand connects the two). This one term is what makes
  a figure sit on the table.
- Sprite shadows come from the `casters` scene, alpha-tested and turned to the
  sun, so a figure's shadow has its silhouette and not a card's rectangle.
- The shadow map updates only while something moves (`castersDirty`,
  `shadow.dirty`). A still table renders nothing new.

## 3. Readability beats realism

- A figure must read at a glance against any paint. That is the dark outline:
  screen-sized (device px, never art units), ink at rest, gold when controlled,
  the targeting user's colour when targeted, accent on hover. Priority goes
  targeted, then controlled, then hovered.
- Hairlines are screen pixels everywhere: outlines, grid, reticle, link
  ribbons. A world-sized line is a slab up close and gone far away.
- State colours come from the palette mirror in `core/theme.mjs` and the
  user's own colour. Never hardcode a suite colour in JS.
- Conditions sit on the effect halo, an arc of round chips along the
  camera-facing front of the base ring. Under PF2e that mirrors PF2e Effects
  Halo, so the 2D and 3D views say the same thing in the same place.

## 4. Motion: designed, frame-rate independent, interruptible

- Damp with `x = lerp(x, target, 1 - Math.exp(-k * dt))`: k 10 to 14 for UI
  follows (hover lift, selection), 3 to 4 for camera inertia. A linear step
  feels robotic and depends on frame rate.
- Movement hops a figure along its path, one step per cell
  (`TIMING.standeeStep`). It never slides through walls or teleports.
- Idle loops turn a whole number of times per loop period, or they snap once
  per loop forever. Anything that moves on its own calls
  `Budget.claimMotion("diorama", true)` while it does.
- Every duration is in `TIMING`; read the `animate` skill before you add one.

## 5. Post: as little as possible

- The vignette is CSS. Tilt-shift is opt-in (`tiltShift: false`). No bloom, DoF,
  SSAO, lens dirt or chromatic aberration: they fight a readable tactical board.
- Hide banding in dark gradients with a little dithering in the shader, not
  with blur.

## 6. First frame and budget

- Never compile in front of the player. Programs are decided at build time and
  varied by uniforms. A new define, light count or `castShadow` at runtime is a
  new program and a visible stall.
- Allocate nothing per frame. Reuse vectors, matrices and typed arrays.
- Every new effect gets a name in `SHED_ORDER` so it degrades under load.
- Dispose textures, render targets, geometries and materials when a standee or
  the view goes away.

## 7. Check it like a lookdev artist

- `node tools/diorama-check.mjs` must report zero problems, and so must
  `node tools/budget-check.mjs` when you touch the budget or a shed name.
- Look at it. Serve `node tools/diorama-preview.mjs && node
  tools/preview-server.mjs`, open `/.preview/diorama.html`, and judge at every
  pitch and both yaw snaps, on a dark map and a bright one. Headless stills want
  `shed=0` (swiftshader sheds shadows).
- Ask the usual questions. Does every figure read against the busiest paint? Do
  shadows fall the same way as the map's painted shadows? Does a flying figure
  clearly show which square it is over? Is any line a dotted string rather
  than one clean stroke?
