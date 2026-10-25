# PF2e Spellglass Areas

Spellglass is the GLUniverse Suite's presentation layer for PF2e Regions,
placed spell areas, token emanations, and live auras. PF2e and Foundry remain
authoritative for geometry, coverage, line of effect, visibility, targeting,
and aura membership.

## Visual contract

Every effect is resolved along independent axes, and each axis owns a
different part of the picture so two effects that mean different things never
draw the same thing:

- **Function** owns the **pattern, rim, alert and accent**: harm, restore,
  support, protect, hinder, control, conceal, terrain, detect, summon, hazard,
  or neutral (`FUNCTION_LOOK` in `render/look.mjs`).
- **Material** owns the **colour pair** — a body and a hot colour for each of
  the 26 canonical materials (`MATERIAL_COLORS`). A GM body-palette override
  replaces the body and derives the hot colour from it.
- **Behavior** owns the **motion**: drift, spin, pace and entrance for impact,
  pulse, flow, grow, contain, sweep, linger, sustain, trigger, or static
  (`BEHAVIOR_MOTION`). Static never moves and never alerts.
- **Treatment** (grounded / volumetric / airborne) and **intensity** (subtle /
  balanced / cinematic) scale fill, glow and pattern strength.

`composeLook()` folds those into one frozen look per area; the renderer reads
nothing else. There are no shaders, filters, atlases or warm-up: an area is
`PIXI.Graphics` plus `PIXI.TilingSprite`, which every client can draw.

| Function | Pattern | Rim | Alert |
| --- | --- | --- | --- |
| harm | shards | solid, heavy | heartbeat, echo ring |
| restore | cross | double | slow breathe |
| support | chevrons | solid | breathe |
| protect | scales | double, heavy | none |
| hinder | zigzag | dashed | throb |
| control | net | chain | breathe |
| conceal | fog | dotted | none |
| terrain | cobble | solid | none |
| detect | scan lines | dashed | sweeping wedge |
| summon | sigil | double | breathe, echo ring |
| hazard | caution tape | tape | strobe, echo ring |
| neutral | dots | solid | none |

The check tool holds the vocabulary apart: every function draws its own
pattern, function accents and material colour pairs stay at least 0.09 apart
in OKLab, and no two built-in profiles draw the same pattern in the same
colour.

### Layers

An area is two containers, so nothing that sits over a token can veil it:

- **Ground**, under tokens (`canvas.regions` highlights): outer glow (additive),
  the fill, the pattern tiles masked to the coverage, blocked squares, the
  seams between squares, and direction chevrons on cones and lines.
- **Overlay**, over tokens (`canvas.interface`): the rim, the entrance pen,
  corner brackets, the echo ring, the flare, and the marks on affected tokens.

Patterns are 128px seamless tiles baked once per id on a Canvas2D in white
(`render/patterns.mjs`) and tinted per area, repeating in hardware with
mipmaps on. Each pattern sits on an ink shadow of itself, offset a fraction of
a square, so it still reads on a bright map. A secondary function, where an
effect has one, lays its pattern over the primary at lower strength.

### The outline

The rim is drawn on the **rules edge**: on a square grid that is PF2e's
staircase traced from the covered squares (`render/outline.mjs`, holes
included); gridless it is the true shape. Blocked squares — inside the area,
out of line of effect — take a hatch and a darker shade instead of the
pattern.

Every stroke is sized in **screen pixels** (`SIZES` in `render/look.mjs`)
divided by the canvas zoom, and strokes are rebuilt when the zoom changes by
more than 6%, so a rim is the same weight at every zoom and never a slab or a
hairline that vanishes.

### Motion and alerts

`anim.mjs` holds the clocks: `alertLevel()` (heartbeat, breathe, throb,
strobe) modulates rim, glow and fill; `echoPhase()` sends a ring off the
boundary on the beat. The entrance is either a flash or a pen drawing the rim
on with a bright nib, per behaviour. A trigger beat (`pulse()` in the API)
flares the area and sends an echo.

The host ticks only while something needs frames — an entrance, a beat, a
dissipation, or an area whose look actually moves — and claims motion from the
shared budget only while it does. A settled static area costs nothing per
frame.

### Shedding

Under load the budget sheds, in `SHED_ORDER`: token marks, the echo ring,
drift and chase, the secondary pattern and detect sweep, then glow and flare.
The fill, pattern, seams and rim are tactical and never shed.

## Classification

Automatic classification consumes structured PF2e/Foundry evidence only:

1. explicit presentation data;
2. curated structured slug profiles;
3. item damage instances and traits;
4. origin roll options and resolved originating item data;
5. live aura traits, audience, and events;
6. recognized Region movement behaviors;
7. source type and authoritative area shape.

Description prose is never parsed. Ties are deterministic. Low-confidence
results use neutral visuals and expose **Needs classification** only to GMs.
Placed automatically classified Regions freeze a semantic snapshot when
committed; live auras continue to resolve from their source.

## Stored Region flag

Schema-v2 data is stored at:

```text
flags.gluniverse-foundry-modules.aoe.presentation
```

The normalized shape is:

```js
{
  schema: 2,
  mode: "auto" | "profile" | "custom" | "native",
  profileId: "builtin:..." | "world:...",       // profile mode only
  snapshot: { semantics: {}, confidence: "high", evidenceVersion: 1 },
  overrides: { semantics: {}, appearance: {} },  // sparse
  label: { mode: "inherit" | "custom" | "hidden", value: "" }
}
```

`native` restores Foundry/PF2e presentation for one Region. Scene configuration
also offers a scene-wide native-presentation opt-out.

## Labels and measurements

Inherited identity resolves from the originating spell, action, feat, feature,
item, or reliable aura name, then from the Region name. A Region placed from
Fireball therefore displays **Fireball** automatically. A custom label overrides
it; hidden is an explicit blank and never falls back.

Measurement summaries use Scene grid size, distance, units, and Region shape
data. They appear contextually while a Region is inspected, hovered, or edited:

```text
20 ft • BURST
60 × 5 ft • LINE
20 ft • CONE • 90°
20 ft • EMANATION
20 × 20 ft • SQUARE
```

Unsupported shapes receive identity only; Spellglass never invents dimensions.
Labels use screen-space scaling and bounded collision avoidance.

## Profiles and authoring

The suite ships 24 immutable built-in profiles covering all twelve functions.
GMs can manage reusable world profiles from Module Settings:

- create, edit, duplicate, import, and export;
- delete only when no Region still references the profile;
- keep Regions linked so edits propagate;
- detach a Region to materialize the profile into custom semantic overrides.

The Region configuration sheet is preset-first and includes automatic evidence,
confidence, advanced semantic axes, optional intensity/treatment/body-palette
overrides, label mode, and native opt-out. The dedicated creator uses the same
built-in profiles.

## Geometry and fallback

Square grids use PF2e's covered-cell offsets and line-of-effect collision split.
Gridless circle, cone, emanation, rectangle, and actual-width line primitives
are traced from their analytic shape. Token emanations preserve the source footprint
from Small through Gargantuan and translate their cached mask rigidly during
movement.

Hex, polygon, ring, rotated rectangle, hole, and multi-shape cases that do not
have an exact active backend remain visibly native. A render or presenter
failure restores that Region's native nodes without affecting
other effects.

## Performance settings

- `aoe.motionTier` changes temporal motion only.
- `aoe.intensity` selects subtle, balanced, or cinematic spectacle.
- `aoe.quality` is automatic, low, medium, or high.
- `aoe.maxConcurrent` is the hard client safety ceiling; overflow stays native.

Automatic quality follows the shared frame budget; low and medium set a
minimum shed level. Priorities are inspected Regions,
attached effects, live auras, on-screen effects, then stable creation order.
No tier removes tactical boundaries, covered cells, or settled function marks.

## Migration

Legacy `aoe.style` and `aoe.suppress` flags are converted once by a GM. Before
writing, Spellglass displays affected/warning counts and downloads a JSON backup
containing versions, settings, UUIDs, original flags, converted flags, and a
timestamp. Writes are chunked by Scene and stop on the first failure. Conversion
is deterministic and idempotent; labels, explicit blanks, colors, and native
opt-outs are preserved.

## Public API

Available at `game.modules.get("gluniverse-foundry-modules").api["pf2e-aoe"]`:

```js
classify(source, options)
resolveProfile(regionOrSource, options)
pulse(effectId, options)
registerProfile(namespace, profile)
unregisterProfiles(namespace)
reconfigure()
```

Profile registration is session-scoped. The API rejects unknown semantic IDs
and exposes no remote textures, arbitrary GLSL, visibility override, or
mechanical coverage input.

## Validation and preview

```bash
node tools/pf2e-aoe-check.mjs
node tools/pf2e-aoe-preview.mjs --out=.preview/aoe.html
node tools/preview-server.mjs
```

Serve the preview from the repository root (`/.preview/aoe.html`); a
`file://` page does not run its module. It imports the shipped renderer, look
tables and data adapter and builds its areas from fixture Regions through the
real `regionGeometry()` / `regionCells()`. Query parameters for headless
stills: `sheet=functions|profiles|materials|shapes`, `floor=dark|bright`,
`zoom`, `shed=0..5`, `motion=0`, `seek=<ms>`; `window.__aoeSeek(ms)`
advances a paused clock. Judge on both floors — a pattern that reads on a dark
map can vanish on a bright one.

The check tool covers controlled vocabulary, every semantic axis, deterministic
ties, profile precedence, inherited/custom/hidden labels, migration mapping and
backup shape, PF2e coverage, gridless fallback, line width, token emanation
sizes and movement, aura adaptation, look distinctness, pattern and outline
geometry, renderer purity, the shed gates, and renderer restoration contracts.
