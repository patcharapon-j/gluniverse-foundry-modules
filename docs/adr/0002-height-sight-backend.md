# 0002 · Terrain height occludes sight through a replaced polygon backend

Status: accepted (2026-11-02)

## Context

Diorama makes terrain height mechanical: a token standing below a cliff must
not see over it, and a light at the foot of a wall of rock must not light the
plateau above. Foundry v14 has no notion of this. Walls carry no elevation in
the sweep, Scene Levels and `defineSurface` regions are flat planes, and the
sweep is 2D.

The design rule for the feature is that the 2D canvas stays the source of
truth and vision is never recomputed by the suite. The 3D view only draws what
Foundry computed. So the occlusion has to live inside Foundry's own vision,
where both views read it.

Three options were weighed:

1. Draw fog or darkness over hidden ground in the 3D view only. The 2D canvas
   and the 3D view would disagree, and token detection would still say yes.
2. Write temporary walls along every cliff. Walls are world documents, every
   client would sync them, and a wall cannot say "blocks a short creature, not
   a tall one", since its height is not the viewer's.
3. Replace the polygon backend (`CONFIG.Canvas.polygonBackends.sight` and
   `.light`) with a `ClockwiseSweepPolygon` subclass that knows the height field.

## Decision

Option 3. `foundry/sight-backend.mjs` installs `HeightSweepPolygon` for `sight`
and `light`.

- **Polygons.** `_identifyEdges` adds the outline of high ground as ordinary
  edges, per source. For a light that is all ground above its elevation plus
  the ground under it. For sight it is ground more than a medium creature's
  height (`SIGHT_REVEAL_DIST`, 6 ft) above the eye (token elevation + 0.9 ×
  creature height): the polygon reveals ground where a creature standing on it
  would be seen, not only ground whose floor the eye can see. The strict
  "floor only" rule hid every terrace a little above the party and everything
  behind it, about two thirds of a terraced map. Tokens are not revealed by
  this: detection still marches each target's feet, middle and head in 3D.
  The crossings with the scene's edges are computed on the clones, because
  Foundry precomputes `edge.intersections` for scene edges only.
- **Point tests.** `_testCollision` has a real destination height, so it marches
  the 3D segment over the height field and tests the walls without the 2D
  outline, which cannot express "a head above the lip".
- **Detection.** v14 answers a same-Level detection test with
  `los.contains(point)` on points at the target's base elevation, never
  reaching the backend. `DetectionMode#_testLOS` is wrapped (libWrapper, MIXED)
  to test the target's feet, middle and head in 3D.
- **Light in 3D.** Foundry's illumination and vision textures are screen-space,
  so the view bakes world-space maps from these same polygons. That keeps 2D and
  3D in agreement by construction.
- **Coexistence.** The backend is installed only where the slot still holds
  Foundry's own class. If another module replaced it, Diorama stands down for
  that type and reports a conflict instead of chaining blindly.
- A flat scene, or one with no terrain flag, adds no edges and tests exactly
  like the base class.
- **Levels.** Each scene Level has its own terrain, stored relative to the
  Level's base. A polygon reads its own Level (`PointSourcePolygon#level`), and
  the eye, a light's own elevation and a point test's destination lose that
  base before they meet the height field. Detection reads the vision source's
  Level and only wraps a same-Level test; Foundry's cross-Level test is left
  alone. A scene with one Level has base 0, so it behaves as before.

## Consequences

- Height occlusion costs one extra edge set per source per refresh. It is
  bounded by the merged cliff outline, not the cell count.
- Any module that also replaces the sight or light backend (for example a
  wall-height module) and Diorama are exclusive per type. The first one wins and
  the other is told.
- A Foundry update that changes `_identifyEdges`, `_testCollision` or
  `DetectionMode#_testLOS` needs this backend re-read. Live verification is the
  only proof: `tools/diorama-check.mjs` covers the pure ray and edge maths, not
  Foundry's sweep.
- Cover from terrain is shown, never applied. PF2e's cover is per target for
  every attacker, so writing one attacker's answer would be wrong for the rest.
