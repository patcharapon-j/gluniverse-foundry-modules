# PF2e AoE — design and API reference

The suite's area-of-effect renderer for PF2e on Foundry **v14**. Draws animated
WebGL fills for placed Region templates, attached token emanations, and PF2e
auras, keyed to the effect's damage type and traits. Aura membership and effect
application remain entirely owned by PF2e; Spellglass replaces presentation only.

This document is the durable record of the design session and of the four source
reads behind it (Foundry v14 build 365 local source, the Foundry v14 API site, a
fresh `foundryvtt/pf2e` `v14-dev` clone, and the suite's own shader
infrastructure). Line numbers were true at the time of reading; re-verify before
relying on one.

---

## 1. The substrate: Regions, not MeasuredTemplates

**`MeasuredTemplate` does not survive v14.** It is a compatibility shim scheduled
for removal in v16.

- `client/canvas/placeables/template.mjs:12-21` — `@deprecated since v14`,
  "merged into the functionality of the Region document",
  `logCompatibilityWarning({since: 14, until: 16, once: true})`.
- `client/canvas/layers/templates.mjs:49-52` — `TemplateLayer#activate()` is
  `{ canvas.regions.activate(); return this; }`. The layer cannot be activated.
- `templates.mjs:57-72` — `objects.visible = false`; `:99-109` —
  `prepareSceneControls()` returns `visible: false, tools: {}`.
- `client/documents/measured-template.mjs:238-249` — `createDocuments()`
  delegates to `RegionDocument.implementation.createDocuments()` and stamps
  `flags.core.MeasuredTemplate = true`.

**Consequence for hooks.** A listener on `createMeasuredTemplate` silently stops
firing in v14. Listen on `createRegion` and filter on
`doc.getFlag("core", "MeasuredTemplate")` or on `flags.pf2e.areaShape`.

**PF2e has already ported.** 8.5.0, `v14-dev` (the repo default branch),
`compatibility: {minimum: "14.361", verified: "14.367", maximum: "14"}`.
`MeasuredTemplatePF2e` was deleted outright (commit `71face46`), then
[pf2e#22455](https://github.com/foundryvtt/pf2e/pull/22455) restored rules-accurate
coverage on Regions. The 8.x line does not run on v13, and there are no
`game.release.generation` gates anywhere in the source.

Note the manifest is now `system.pf2e.json`, not `system.json` — Starfinder 2e
ships from the same repo as `system.sf2e.json`.

---

## 2. Region API seams

### Shapes

`BaseShapeData.TYPES` (`common/data/data.mjs:151-164`) — ten types:
`rectangle circle ellipse emanation cone ring line polygon token grid`.
Every shape carries `hole` (`data.mjs:183`) and `rotation`.

`gridBased` (documented at `data.mjs:210-212`): dimensions are divided by grid
size and multiplied by grid distance, then the shape is constructed "conforming
to the grid's metric". This is how PF2e-correct grid geometry happens natively.

`ConeShapeData.curvature` ∈ `round | flat | semicircle`, validated at
`data.mjs:378-388` (flat ≤ 90°, semicircle ≤ 180°).

`EmanationShapeData` wraps a `base` shape and expands it by `radius`. With a
`token` base it produces four 90° corner cones plus the swept body
(`client/data/shapes.mjs:2045-2065`) — literally PF2e's "issues forth from each
side of your space". **This is why emanation across token sizes needs no code.**

Shapes combine by ordered, batched Clipper (`client/documents/region.mjs:318-351`):
consecutive non-hole shapes union, consecutive hole shapes difference,
left to right. There is no intersection operator.

### Geometry and coverage

Cached lazily on the document (`client/documents/region.mjs:53-151`):
`polygonTree`, `clipperPolyTree`, `clipperPaths`, `triangulation`, `bounds`,
`area`, `polygons`, plus `tokens: ReadonlySet<TokenDocument>`.

`region.testPoint({x, y, elevation})` (`region.mjs:236-238`) is 3D.
`PolygonTree#testPoint(point, distance)` takes a tolerance.
`PolygonTree#sampleInterior(out)` / `sampleBoundary(out)` exist and are what
core's particle generator consumes.

`Region#_getCoveredGridSpaceOffsets()` (`client/canvas/placeables/region.mjs:508-529`)
is `@protected` and is the coverage hook. Core's rule is a grid-centre test with
a 0.75px tolerance, with the centre rounded "as a token position would be".

With `highlightMode: "coverage"`, `_refreshGeometry()` (`region.mjs:452-488`)
builds a separate `#coverageGeometry` — a fan triangulation of
`canvas.grid.getVertices(offset)` per covered cell, 4 verts square / 6 hex,
`Uint32Array` indices above 65535 offsets.

`SquareGrid#getCircle` (`common/grid/square.mjs:931-942`) dispatches on the
scene's `GRID_DIAGONALS`, including `ALTERNATING_1`/`ALTERNATING_2` — PF2e's
5/10/5 rule, free.

### Rendering — the custom shader seam

```js
// client/canvas/placeables/regions/mesh.mjs:13-28
constructor(region, shaderClass = RegionShader) {
  if ( !AbstractBaseShader.isPrototypeOf(shaderClass) ) throw new Error(...);
  super();
  this.#region = region;
  this.geometry = region.geometry;
  this.#shader = shaderClass.create();
}
```

`setShaderClass(shaderClass)` (`mesh.mjs:171-179`) swaps it on a live mesh.
`RegionMesh` is a **`PIXI.Container` with a hand-rolled `_render`**, not a
`PIXI.Mesh` — it calls `shader._preRender(this, renderer)`, sets
`translationMatrix`, flushes the batch renderer, binds and draws `TRIANGLES`.
Its `geometry` setter accepts any `PIXI.Geometry` carrying `aVertexPosition`
plus an index buffer.

Namespaces: `foundry.canvas.placeables.regions.{RegionGeometry, RegionMesh}`,
`foundry.canvas.rendering.shaders.{RegionShader, HighlightRegionShader}`.

`RegionShader` (`client/canvas/rendering/shaders/region/base.mjs`) hands the
fragment stage three varyings free — `vCanvasCoord`, `vSceneCoord`,
`vScreenCoord` — and `defaultUniforms` `{canvasDimensions, sceneDimensions,
screenDimensions, tintAlpha}`. **There is no `time` uniform**; add one and write
it in `_preRender`. `HighlightRegionShader` is core's own worked subclass.

Core drives this exact pattern from a region behavior —
`client/data/region-behaviors/adjust-darkness-level.mjs:65-109` creates meshes on
`BEHAVIOR_VIEWED` and destroys them on `BEHAVIOR_UNVIEWED`, naming each
`this.behavior.uuid` for lookup.

### Containers, z-order, visibility

```js
// client/canvas/layers/regions.mjs:191-198
#initializeHighlights() {
  const highlights = new PIXI.Container();
  highlights.filters = game.user.isGM ? [] : [VisionMaskFilter.create()];
  highlights.filterArea = canvas.app.screen;
  highlights.sortableChildren = true;
  highlights.eventMode = "none";
  return highlights;
}
```

`canvas.regions._highlights` is marked `@internal`. It is added before
`super._draw` creates `this.objects`, so fills render beneath region borders.
Per-region z comes from `Region#_refreshState` (`region.mjs:407`):
`#highlight.zIndex = this.zIndex`. `#highlight` is a hard private field with no
accessor.

Interface-group layer `zIndex`: regions **100** (`zIndexActive` **600**),
tokens 200, tiles 300, templates 400, drawings 500, walls 700, notes 800,
lighting/sounds 900, controls 1000. **The regions layer sorts above tokens
whenever it is active** — a known, accepted behaviour in GM editing mode.

`CONST.REGION_VISIBILITY`: `LAYER_UNLOCKED: 4` (default), `LAYER: 0`,
`GAMEMASTER: 1`, `OBSERVER: 3`, `ALWAYS: 2`. `ALWAYS` renders for every user
with no layer active (`client/canvas/placeables/region.mjs:78-96`).

### Placement

`RegionLayer#placeRegion(data, options)` (`client/canvas/layers/regions.mjs:688`)
and `#placeRegions` (`:824`) — awaitable, cursor-driven, wheel-rotated.
Options: `create, createOptions, allowRotation, allowEmpty, attachToToken,
onMove, onRotate, onChange, preConfirm, preSkip, preCommit`. Left-click confirms,
right-click skips. Returns `null` when rejected or dismissed, and refuses for
paused non-GMs.

`RegionLayer#templateMode` (`regions.mjs:159-172`) defaults to `!game.user.isGM`
— **players are already in a template-flavoured Regions UI by default.**

The shipped feature also adds a GM-only **Create Spellglass Area** button to the
GLUniverse scene-control group. Its creator captures a PF2e shape, exact scene-unit
size, visual archetype, color, Region name, and centered label before calling
`canvas.regions.placeRegion(data)`. The new Region is stamped with both
`flags.pf2e.areaShape` and the suite's `aoe.style` flag, so it is never confused
with a generic freehand Region and is picked up by the renderer immediately.
Choosing **Emanation from selected token** instead calls
`RegionDocument.createTokenEmanation` with `gridBased` enabled on square Scenes.
The resulting Region carries Foundry's real `attachment.token` relationship and
moves with the Token in both persisted updates and client-side movement animation.

### Token attachment

`attachment.token` is a document field (`common/documents/region.mjs:70-72`).
`RegionDocument.createTokenEmanation(token, range, regionData, {excludeToken,
gridBased, createOptions})` (`client/documents/region.mjs:1312-1330`) builds the
shape, the elevation volume and the attachment in one call.

Shape rewriting on token move is computed in
`TokenDocument#computeAttachedRegionUpdates` and applied **server-side, one DB
write per move commit** — not per frame. Per-frame animation is client-side via
`Token#_animateAttachments` → `Region#_onTokenAnimationFrame()`.

**Cost warning:** `_onTokenAnimationFrame` (`region.mjs:539-591`) clones and
moves every shape, invalidates the animated polygon trees, and sets
`refreshGeometry`, so the next access re-runs Clipper and earcut in full. Core
flags it with its own `// TODO optimize this further?`. Prefer the empty
`Region#_onAnimationStateChange()` hook (`region.mjs:617`) for cheap per-frame
uniform updates.

### Hooks

Generated from the document name: `preCreateRegion`, `createRegion`,
`preUpdateRegion`, `updateRegion`, `preDeleteRegion`, `deleteRegion`,
`drawRegion`, `refreshRegion`, `destroyRegion`, `controlRegion`, `hoverRegion`,
`pasteRegion`.

**`refreshRegion(region, flags)` passes an undocumented second argument** — the
applied `RenderFlags` (`placeable-object.mjs:440`). `client/hooks.mjs:793-799`
documents only `(object)`. Use it to redraw on `refreshShapes` alone.

`CONST.REGION_EVENTS`: `REGION_BOUNDARY REGION_ANIMATION BEHAVIOR_ACTIVATED
BEHAVIOR_DEACTIVATED BEHAVIOR_VIEWED BEHAVIOR_UNVIEWED TOKEN_ENTER TOKEN_EXIT
TOKEN_MOVE_IN TOKEN_MOVE_OUT TOKEN_MOVE_WITHIN TOKEN_ANIMATE_IN TOKEN_ANIMATE_OUT
TOKEN_TURN_START TOKEN_TURN_END TOKEN_ROUND_START TOKEN_ROUND_END`.

> **Core bug, build 365.** `placeables/region.mjs:588,606` emit
> `CONST.REGION_EVENTS.REGION_ANIMATED`, but the frozen constant is
> `REGION_ANIMATION`. The emitted name is `undefined`, so nothing subscribed to
> `REGION_ANIMATION` fires from token-attached animation — core's own darkness
> behavior included. **Do not build per-frame updates on it.**

### PIXI

**7.4.3, unchanged from v13.** Every convention in `scripts/core/glsl.mjs`
transfers untouched. `@pixi/graphics-smooth` ^1.1.1.

`client/canvas/board.mjs:1006-1012` sets `PIXI.Filter.defaultResolution = null`
and `defaultMultisample = null` ("inherit from the current render target"), and
`PIXI.Program.default{Vertex,Fragment}Precision = HIGH`. That partly retires the
HiDPI filter trap, but only for filters constructed after canvas config —
`syncFilterResolution()` stays worth copying.

---

## 3. PF2e integration seams

### CONFIG slots PF2e owns

`src/scripts/hooks/load.ts`: `CONFIG.Region.documentClass = RegionDocumentPF2e`
(:79), `CONFIG.Region.objectClass = RegionPF2e` (:80),
`CONFIG.Canvas.layers.regions.layerClass = RegionLayerPF2e` (:128),
`CONFIG.Token.{objectClass, documentClass}` (:90-92), plus
`CONFIG.RegionBehavior.dataModels.{environment, environmentFeature,
modifyMovementCost}` (:81-88).

**We must never claim these.** Suppress core's stock hatch per-region at
`drawRegion` instead.

### Flags

```ts
// src/module/scene/region-document/document.ts:58-64
flags: { pf2e: { messageId?: string; origin?: ItemOriginFlag; areaShape: EffectAreaShape | null } }
```

`origin` is `{name, slug, traits, ...item.getOriginData()}` (`item/helpers.ts:228-258`)
— **traits are available**, which is what makes the trait-override style layer
possible. Inline `@Template` links write a reduced origin of `{actor, traits}`
only, so **do not assume `origin.uuid` exists**
(`src/scripts/ui/inline-roll-links.ts:314-348`).

`EFFECT_AREA_SHAPES = ["burst","cone","cube","cylinder","emanation","line","ring","square"]`
(`src/module/item/values.ts:32`).

`RegionDocumentPF2e#isEffectArea` = one shape plus an `areaShape`.

> Suspected live bug: `RegionDocumentPF2e#_initializeSource` back-fills
> `areaShape` from a legacy `t` field absent from `RegionSchema`, so a region
> drawn with core's own tools gets `areaShape: null` — which is what
> `isEffectArea` keys on.

### Creation path

`chat-message/listeners/cards.ts` `case "spell-template"` (:136) →
`SpellPF2e#placeTemplate` (`item/spell/document.ts:553`) →
`placeRegionFromItem` (`item/helpers.ts:228`) →
`shapeDataFromEffectArea` (`canvas/helpers.ts:180-210`) →
`canvas.regions.placeRegion(data)`.

Plain DOM `data-action` delegation, **no hook**. `placeRegionFromItem` and
`shapeDataFromEffectArea` are module-internal ES exports, not on `game.pf2e`.
`preCreateRegion` + `flags.pf2e.areaShape` is the reliable interception point.

Shape mapping (`canvas/helpers.ts:180-210`):

| areaShape | shape data |
|---|---|
| `burst`, `cylinder` | `{type: "circle", radius: distance}` |
| `cone` | `{type: "cone", angle: 90, radius: distance}` |
| `cube`, `square` | `{type: "rectangle", width: d, height: d}` |
| `emanation` | `{type: "emanation", radius: d, base: {type: "token", ...pick(tokenSource, w/h/x/y/shape)}}` |
| `line` | `{type: "line", length: d, width: canvas.dimensions.size}` |
| `ring` | `{type: "ring", radius, innerWidth, outerWidth}` |

PF2e's own placement defaults: `highlightMode: "coverage"`,
`displayMeasurements: true`, `visibility: CONST.REGION_VISIBILITY.ALWAYS`,
`ownership: {[game.user.id]: OWNER}`.

### Coverage — `RegionPF2e` (`src/module/canvas/region.ts`)

`snappingMode` (:18-30): burst → `VERTEX`; cone →
`CENTER|VERTEX|EDGE_MIDPOINT`; line → `EDGE_MIDPOINT|VERTEX`; default →
`CENTER|VERTEX`.

`_getCoveredGridSpaceOffsets()` (:41-83) bails to `super` unless the grid is
square, there is exactly one shape, and it is `circle`/`cone`/`line`. Otherwise
it scans `±(ceil(reach)+1)` cells, tests each **centre**, and splits into
covered vs blocked:

```ts
const hasLineOfEffect = !canvas.ready ||
  !CONFIG.Canvas.polygonBackends.move.testCollision(area.origin, destination, { type: "move", mode: "any" });
(hasLineOfEffect ? offsets : blocked).push(offset);
```

Distances go through `measureDistance` → `measureDistanceOnGrid`
(`canvas/helpers.ts:125-168`):

```ts
Math.floor(squares.doubleDiagonal * 1.75 + squares.diagonal * 1.5 + squares.straight) - reduction
```

with the CRB p.455 10-foot-reach exception at :160-161.

**Cone** (:101-111, `#coneCoverage` :142-172) — the apex is nudged half a cell
toward the firing direction on each axis not already on a grid line (Y inverted
for screen space), which is what separates a corner-origin cone from a
side-origin one. Then a wedge test on `[direction ± angle/2]` with wraparound,
then the distance test. Angle is 90°, set in `shapeDataFromEffectArea` and in
`get-scene-control-buttons.ts:10-13`. Direction snaps to 45° (5° for lines).

**Line** (:113-134) — origin stepped back to the grid corner on whichever axes
sit mid-cell; coverage is a projection/offset test.

Spellglass resolves emanations from every edge of the token footprint with the
same alternating 5/10/5 distance used by PF2e. Regression cases pin the Medium,
smaller, and Large 5-foot and 10-foot diagrams in the supplied `Rules354.png`:
the token's full space is the base, the first diagonal costs 5 feet, and the
second diagonal removes the outer corner at 10 feet.

`#drawBlockedHighlight()` (:182-199) paints blocked squares into
`layer._highlights` as a black 50% fill plus a diagonal slash, refreshed on
`refreshGeometry|refreshVisibility`. **This is in the same container as our
ground mesh** — we hide it and express blocking as a third lattice state.

`#areaCoverage`, `#coneCoverage`, `#drawBlockedHighlight`, `#blockedOffsets` are
`#`-private; the only override point is the public
`_getCoveredGridSpaceOffsets()`.

> PF2e 8.4.1 changelog: "Restore rules-accurate measured-template coverage".
> `region.ts` is freshly stabilised after the v14 port broke it. Pin its
> behaviour in our check tool rather than assume it holds.

### Auras

Entirely separate from Regions; still token-attached PIXI drawn by PF2e.

**Rule element** `src/module/rules/rule-element/aura.ts` — `radius` (clamped
`clamp(ceil(n/5)*5, 5, 240)`), `level`, `traits`, `effects[]`, `appearance`
(`border`/`highlight`/`texture`, `"user-color"` resolvable), `mergeExisting`.
Output goes to `actor.auras: Map<string, AuraData>`.
⚠️ `AuraEffectSchema.save` is declared but dead — `#processEffects` (:331-337)
unconditionally sets `save: null`. Do not build on it.

**Renderer** `src/module/canvas/token/aura/renderer.ts` — a `PIXI.Graphics`
child of the token object.

```ts
radiusPixels = 0.5 * token.mechanicalBounds.width + (radius / canvas.dimensions.distance) * canvas.grid.size
```

i.e. measured from the **edge** of the token's space, which is where Large/Huge
sizing enters — no special case needed. Border is one `lineStyle().drawCircle()`,
drawn once. The texture fill goes into a **separate `PIXI.Graphics` parented to
`canvas.interface.grid`** (hence `repositionTexture()`), and square highlights go
into the shared grid highlight layer `Token.${id}`. Squares are only highlighted
during an active encounter.

**Membership** is `TokenAura#containsToken`
(`scene/token-document/aura/index.ts:71-85`) plus `getAreaSquares`
(`canvas/token/aura/util.ts:7-68`), which tests five points per square against
`sight`/`sound`/`move` collision depending on the `visual`/`auditory` traits.
**Nothing in the effect pipeline calls into `AuraRenderer`** — rendering and
membership are cleanly split.

**Our seam is the live `token.auras` map, not PF2e's mechanics.** Each
`AuraRenderer` is adapted to an ephemeral emanation-shaped source for the shared
Spellglass host. Its `squares` getter remains the authority for square coverage
and wall blocking, so PF2e's five-point sight/sound/move collision test is not
reimplemented. The native border, texture, and shared highlight layer are hidden
only while the replacement mesh exists and are restored on teardown or when the
client's concurrent-area cap is reached. No Aura document or Actor data is created.

Constraints on any replacement:
- `AuraRenderer implements TokenAuraData` (`renderer.ts:11`) — keep `radius`,
  `token`, `bounds`, `radiusPixels`, `appearance`, `traits`, or `getAreaSquares`
  breaks.
- Clean up both shared containers: the texture graphics on
  `canvas.interface.grid`, and the `Token.${id}` highlight layer.
- `ScenePF2e.prototype.checkAuras` is defined `configurable: false, writable:
  false` (`scene/document.ts:209-214`) — **it cannot be patched or wrapped.**
- `ActorPF2e#checkAreaEffects` is installed per-instance via
  `Object.defineProperty` in the constructor (`actor/base.ts:127-130`), so a
  prototype patch will not take.

### PF2e hooks and API

`Hooks.callAll("pf2e.*")` is only: `startTurn`, `endTurn`, `preReroll`,
`reroll`, `damageRoll`, `restForTheNight`, `systemReady`. **Nothing
template- or aura-related.** `game.pf2e` exposes nothing template- or
aura-related either. `pf2e.damageRoll` is the hook for the trigger beat.

---

## 4. Our design

### Identity

`pf2e-aoe`, prefix `aoe.`, `system: "pf2e"`, no `requires`,
`minimumGeneration: 14`, `defaultEnabled: false`, i18n `GLAOE.*`, CSS `gl-aoe-`,
`styles/pf2e-aoe.css`. Appended last in `scripts/features/index.mjs`.
The suite keeps its Foundry 13 module minimum; the registry generation-gates
this feature alone.

### Three depth planes

| plane | container | carries |
|---|---|---|
| ground | `RegionMesh` in `canvas.regions._highlights` | archetype fill, rules lattice, skirt base, scorch decal |
| atmosphere | suite container above tokens | motes, bloom haze |
| token wrap | alpha-masked token overlay | restrained one-sided edge light; never displacement |
| boundary | suite container above everything | the outer rim and lattice edge, 1–2px, never occluded |

True volumetric occlusion is not achievable in Foundry's 2D sort. The skirt's
inner edge is faded to fake it; say so rather than promise depth.

### The lattice is three-valued

`covered` / `blocked` / `outside`. Blocked is line-of-effect shadowing, resolved
with PF2e's square-grid algorithm and expressed in the effect's language instead
of PF2e's black crosshatch. The resolver is kept locally as a compatibility
bridge for PF2e 8.4.0, which still delegates Region coverage to Foundry core;
it mirrors PF2e's newer resolver for circle, cone, and line shapes. Gridless
Scenes render the Region's continuous geometry without lattice seams; hex
Scenes retain Foundry's native Region mesh until true hex coverage is supported.
The rules read lives on the ground plane; the organic true
geometry lives in the atmosphere. Shedding thins the atmosphere first — the
lattice and rim are never shed.

### Fourteen archetypes, one skeleton

`ember frost arc caustic resonance radiance umbra spirit force kinetic verdant arcane generic warning`

Shared skeleton (ground fill → rim → skirt → composite) with the *fill* term as
an archetype branch. Resolution order: **trait override → damage type →
`arcane`**. `generic` is opt-in only: a flat GM-selected color with no material
motion or motes. `warning` is also opt-in: a boss-attack telegraph with one
shared pulse/sweep clock. Build order `ember`, `frost`, `arc` first — they prove the skeleton.

Damage-type identity mirrors the 16 canonical PF2e ids locally. DSN
presentation stays with `pf2e-damage-dice`; GLSL presentation stays here, so
this feature does not inherit its `requires: ["dice-so-nice"]` dependency.

### Four phases

cast-in → sustain → **trigger beat** → dissipate. The trigger beat is a public
`api.pulse(regionId)` plus auto-match against `pf2e.damageRoll` via
`flags.pf2e.messageId`. Document lifecycle rides Foundry replication; only
transient beats go over the suite socket (`emitSocket`/`onSocket`, handler
registered in `onReady`, `__claimedSender` treated as routing metadata only).

### Settings

`aoe.motionTier` (`default | reduced | none`, client) feeding `MOTION_SCALE`
from `core/theme.mjs`. Adaptive `SHED_ORDER` with hysteresis handles load; no
second fidelity knob. `aoe.styleDefaults` is a GM-only world map of archetype
id to `#RRGGBB`, covering every built-in, `generic`, and `warning`. The
Aura replacement is part of the feature itself; there is no inert second toggle.

Each region may override those defaults with the suite flag `aoe.style`:

```js
{ archetype: "generic", colorOverride: true, color: "#759dff", label: "Silence Field" }
```

`colorOverride: false` keeps the chosen visual type but resolves its current
world-default color. Legacy Regions that stored a color before this toggle are
treated as opted in until the GM turns the override off. The editor is GM-only;
the result replicates and renders for everyone. Validate
`archetype` against `ARCHETYPES`, color as six-digit hex, and trim `label` to 80
characters. An empty label renders nothing. Labels are PIXI text, never HTML.

Canvas features must register a repaint with `onThemeChange()` from
`core/theme.mjs` — neither `resource-bars` nor `token-conditions` does. Do it
here.

### Known risks

1. Emanation coverage for Gargantuan creatures is unverified — live session.
2. `canvas.regions._highlights` is `@internal`.
3. Regions layer sorts above tokens while active.
4. PF2e's `region.ts` is freshly stabilised; pin it.
5. Fourteen shader branches is the largest authoring job in the suite.

---

## 5. Validation

```bash
node tools/pf2e-aoe-preview.mjs --out=.preview/aoe.html && node tools/preview-server.mjs
```

`file://` will not execute the page's module script — serve it.

```bash
node tools/pf2e-aoe-check.mjs
```

Must pin: every `UNIFORMS` entry declared in the GLSL and written by the host;
all fourteen archetype branches compile and link; `SHED_ORDER` covers every
animated behaviour; the lattice and rim are absent from `SHED_ORDER`; no literal
durations bypassing `motionScale`; the archetype table covers all 16 damage type
ids; hairlines sized in `uTexel` device pixels, never geometry units; `uTexel`
0 is inert; PF2e's `snappingMode` and coverage whitelist unchanged from what we
read.
## 6. Settled visual decisions

**Treatment: `grounded`.** Chosen at visual review 1. Its four character
multipliers (scorch, motes, rim, churn) are all exactly 1 so it is the
untouched baseline; `volumetric` and `airborne` exist in `TREATMENTS` as the
rejected alternatives and as the proof that the character axis does something.
Do not retune grounded's numbers without a new review.

**The entrance is DRAWN, never scaled and never faded.** Two things are
therefore forbidden and both were removed after they were tried:

- a geometry scale on the entrance. For its duration the template covers
  squares it does not cover, which is a rules object lying about itself.
- multiplying the whole quad's alpha by the entrance curve. That fades finished
  squares back out while later ones are still arriving, so it never reads as
  ink on a surface. `AoeAnim#presence` is the EXIT only, for this reason.

**The outer edge always traces**, in every mode. It is the one line that says
where the area ends, and it gives the eye something to follow into the shape.
The modes differ only in how the interior arrives behind it.

### Three things here fail silently and are worth a check-tool pin

1. **Write gates must overrun 1.** `glEdge(0, w, pen - ord)` is only half open
   when `pen == ord`, so a pen stopping exactly at 1 leaves the last-written
   ring — and, for the edge pen, the seam where the lap closes — permanently
   unfinished. It reads as the area missing squares, i.e. as a coverage bug.
   Pin: after the stroke lands, all three entrances must light an identical
   pixel count. Measured 1750 / 1806 / 958 across the three preview shapes,
   identical for trace, inscribe and ignite, shortfall 0.00%.

2. **The nib's radial ordinal must not be clamped above 1.** Clamped, every
   pixel outside the area shares the single value 1, so when the write front
   reached the edge the nib's gaussian fired across the entire canvas at once.
   Pin: nothing outside the area's own rect may light at any frame of any
   entrance. Measured 0.00% for all three.

3. **A cone's perimeter cannot be parameterised by angle.** Two of its three
   boundary segments are radial lines from the apex, so every point on one
   shares an angle and the whole edge lights at once — a laser, not a stroke.
   `perimeterOrd()` stitches the three segments by their true lengths. Bursts
   and emanations are star-shaped about their own origin and do use the angle.
   The line branch is written but **unverified** — no line template is in the
   preview harness yet.

### Known weakness, not yet addressed

On a bright map the effect washes out: it composites additively, so adding
orange to already-bright stone lowers contrast instead of reading as fire on
it. Fixing it means a multiply/darken term beneath the additive glow, which
changes all three treatments and so was deliberately left out of review 1.

## 7. Archetypes (visual review 2)

**Answer to the question the review existed to ask: twelve branches are
justified.** Colour alone is not enough, and PF2e proves it — its cold and its
electricity are neighbours in hue, so a palette-only scheme cannot separate two
of the most common damage types on a table. What separates them here is
behaviour over time, and each branch owns three things:

| | fill | particulate | temporal signature |
|---|---|---|---|
| `ember` | ridged noise advected upward | rising, guttering embers | continuous; it boils |
| `frost` | three noise-warped crease families at 60° — a triangular lattice | static glints that twinkle in place | near-motionless; it creeps |
| `arc` | filaments re-seeded per strike, hard attack and short decay | sparks on the discharge only | intermittent; mostly quiet |

### Things learned here that the remaining nine branches must respect

- **Contours of a smooth field are organic, not crystalline.** The first frost
  quantised fbm into plates; it read as marble. Ice needs straight creases, so
  `frostShard` builds them from directional gradients and only warps them with
  noise. Anything meant to look faceted, cut or shattered should start there.
- **A crease distance must be converted back into GRID UNITS before it reaches
  `glEdge`.** glEdge widens by `uTexel`, which is one device pixel measured in
  grid units; handing it a value in cycles widens by the wrong factor at every
  zoom, and nothing about that is visible in a diff or at one zoom level.
- **A thin body, not a filled slab.** Frost's first version returned a high DC
  term, which saturated toward the hot colour and drowned both the lattice
  seams and the rim — on `grounded`, the two things the treatment exists to
  make readable. The structure carries the archetype; the space between it
  should stay mostly open.
- **Every intermittent archetype needs an idle floor.** `arcFill` keeps a base
  glow plus a faint always-on filament. Without it, "which squares am I in"
  depends on catching the right frame, and the area looks switched off between
  discharges.
- **One clock, not two.** `archMotes`'s arc branch reuses `arcFill`'s strike
  rate deliberately. Two independent flicker rates read as two effects
  overlapping, not as one thing discharging.

Measured after these were applied: **zero saturated pixels** in all nine
preview slots at 5 seconds, including arc sampled on its strike frames
(265, 266, 268) where it is brightest.

### Palette

`ARCHETYPE_PALETTE` in `constants.mjs`. Deliberately NOT derived from
`pf2e-damage-dice/damage-types.mjs`: that table describes a die, a lit object
with a dark body and bright numerals, so its `background` is nearly black for
fire and nearly white for cold. Mapping either onto an emissive area gives the
wrong answer, in opposite directions. What must hold is hue-family agreement so
a fireball's dice and its area read as one spell — a check-tool assertion, not
equality.

## 8. The shade pass, and why bright maps needed one

Every other pass composites **over**. On a dark floor that is enough: the effect
out-lights what is under it and contrast is free. On a lit flagstone map it is
not — a partly transparent orange over pale stone is *dimmer* than the stone, so
the area reads as a wash laid on the map rather than as fire on a floor.

Real fire on a pale floor takes its contrast from both directions at once: the
floor darkens where it burns, and the flame out-lights what is left. The
over-passes do the second. `uPlane 3` does the first.

- Drawn **first**, under everything including tokens.
- **MULTIPLY** blend: `gl.blendFunc(DST_COLOR, ONE_MINUS_SRC_ALPHA)` against a
  premultiplied source, resolving to `dst * (1 - s * (1 - shade))`. Given the
  wrong blend it does not error; it lays a dark patch on the map.
- It cannot be folded into the over-passes. Darkening needs the destination, and
  one over-blend cannot both subtract from and add to it.
- Multiply is **self-limiting**, which is why it is safe to leave on everywhere:
  on a dark map the destination is already dark and it changes almost nothing.
- It is scaled by the treatment's scorch character but **never to zero**, and it
  deliberately ignores the `uFx.z` shed gate. An airborne treatment marking no
  floor is a look; being illegible on a lit map is a bug, and readability is not
  a quality tier.
- Not every archetype marks the floor. `radiance` (0.14) and `resonance` (0.24)
  are near-inert by design; `umbra` (0.86) is *mostly* this pass.

## 9. All twelve archetypes

Each owns a fill behaviour, one of four particulate classes, a palette entry and
a shade. **Four mote classes, not twelve** — twelve near-identical mote models
would be twelve things to keep in sync for a difference nobody can see; what has
to differ is the class of motion (rise / glint / spark / fall), and the fill
carries the rest of the identity.

| archetype | fill | motes | shade |
|---|---|---|---|
| ember | ridged noise advected upward | rise | 0.66 burnt |
| frost | dendrites from nucleation points, six-fold | glint | 0.60 cooled |
| arc | filaments re-seeded per strike | spark | 0.52 seared |
| caustic | bubbles that swell and pop | fall | 0.72 eaten |
| resonance | two beating wavelengths travelling outward | spark | 0.24 |
| radiance | rays from a bright core, breathing | rise | 0.14 |
| umbra | inverted ridge — the gaps are what is bright | fall | 0.86 |
| spirit | two ridge generations drifting laterally | rise | 0.20 |
| force | hex tessellation, cells shimmering out of phase | glint | 0.22 |
| kinetic | grit that settles and stops | fall | 0.58 |
| verdant | four crease families as woven strands | fall | 0.70 |
| arcane | rings and twelve spokes — a diagram, not a substance | glint | 0.32 |

### Failures found writing these, all of which rendered plausibly

- **`hexEdge` produced diagonal herringbone stripes, not hexagons.** A `min` of
  two axis distances looks like a reasonable hex metric and is not one. The
  correct form is `0.5 - max(dot(|p|, vec2(0.5, 0.866)), |p|.x)` over two
  interleaved lattices. Nothing about the wrong version was detectable except by
  rendering it and looking.
- **The dot-screen failure recurs in every new coat.** Caustic's first bubbles
  were one per cell at one size: polka dots. The fix is always the same three
  things together — drop a quarter of the cells, jitter on both axes, vary size
  and brightness.
- **"No hard edges" is not "no structure".** Spirit's first version was an even
  green haze that could have been four other archetypes at a glance. Two ridge
  generations at different scales and drifts fixed it.
- **A high DC term drowns the archetype.** Verdant came out as a flat green
  disc, frost as a white slab. In both cases the fix was to lower the base and
  let the structure carry it — which also un-drowns the lattice seams and the
  rim, the two things `grounded` exists to make readable.
- **Reuse the tested helper.** Verdant's strands are `frostShard` at a higher
  frequency: the same construction reads as fibre at one scale and fracture at
  another, and a second lookalike would alias differently.

Measured after all of it: **zero saturated pixels** in all twelve archetypes
over 5 seconds (51 slot samples across six scroll positions).

## 10. Visual review 3 — transparency repair

The first high-fidelity pass was rejected because it treated every archetype as
an opaque lit surface. A dark palette stop, finite-difference normals, contact
occlusion and equal alpha on all three over-passes compounded into a moulded
material slab. Ember read as lava, and the map stopped participating in the
composition.

The repaired composite keeps the useful parts of that pass—persistent domain
flow, archetype-specific structure, sparse hot detail, bloom and the
multiply shade—but restores the scene as the material's shadow layer:

- no baked dark palette stop;
- one fill evaluation instead of three normal-map taps;
- no diffuse lighting or contact occlusion on the ground plane;
- sparse structure can run hot without raising the whole area's opacity;
- ground, atmosphere and boundary have separate alpha budgets (`0.48`, `0.24`,
  `0.86` before the review multiplier);
- the multiply shade is compressed to `0.38` of its previous strength.

The preview exposes three review-only finish multipliers: **A · veil** (`0.72`),
**B · spellglass** (`0.88`, recommended) and **C · cinematic** (`1.08`). These
are alternatives for choosing the settled composite, not a proposed user-facing
fidelity setting. The design still has one adaptive quality path through
`SHED_ORDER`.

## 11. Visual review 4 — token integrity and GM-authored style

**Spellglass is selected.** It is the fixed composite multiplier; A and C remain
preview history, not product settings.

Backdrop displacement is removed entirely. It was visually expensive and made
token artwork shimmer, which is distracting at exactly the moment players need
to read the creature. The atmosphere pass no longer samples the scene at all.
The only allowed token response is a restrained edge light:

- source pixels are never moved, blurred or recoloured wholesale;
- the token alpha silhouette masks a narrow inner rim;
- the light is strongest on the side facing the area's origin and falls around
  the silhouette, avoiding the sticker-outline look;
- only tokens covered by the Region receive it;
- it is first in `SHED_ORDER` as `tokenEdgeLight` and may disappear without
  changing area readability.

The thirteenth archetype, `generic`, is deliberately plain: one translucent GM
color, the PF2e coverage lattice, and the standard boundary. It has no material
motion, motes or hot-color shift. It is for hazards, zones, reminders and other
ad-hoc areas that should not claim to be fire, frost, force or arcane energy.

GM styling has two layers. `aoe.styleDefaults` sets the world color for every
archetype, including `generic`; a region's `aoe.style` flag may override
`archetype`, `color`, and an optional player-visible `label`. The label follows
the attached Region, remains readable at canvas zoom, and is escaped/truncated
rather than interpreted as markup.

## 12. Visual review 5 — integrated labels and Warning Zone

Labels sit at the visual center of the template instead of in an external UI
badge. They use the suite's Oxanium display face, uppercase tracking, a faint
color-matched glow, and thin fading rules above and below. The backing is a
transparent central falloff rather than a pill, so the text reads as part of
the projected template and does not conceal the map. An empty label still
renders nothing. The eventual Foundry renderer uses zoom-aware PIXI text, not
HTML, and keeps the label attached to its Region.

The fourteenth archetype, `warning`, is an opt-in boss-attack telegraph. It
defaults to hazard red but remains color-configurable through the same GM style
defaults and per-region override as every other archetype. A 1.4-second shared
phase drives its breathing field, rotating scanner, inward countdown ring, and
boundary emphasis. It deliberately has no motes: one clock and a small visual
vocabulary make the danger state readable immediately. The quiet point retains
both translucent fill and a rules-readable boundary; the map never disappears.
