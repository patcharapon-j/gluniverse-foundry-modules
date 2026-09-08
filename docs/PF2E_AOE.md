# PF2e Spellglass Areas

Spellglass is the GLUniverse Suite's presentation layer for PF2e Regions,
placed spell areas, token emanations, and live auras. PF2e and Foundry remain
authoritative for geometry, coverage, line of effect, visibility, targeting,
and aura membership.

## Visual contract

Every effect is resolved along independent axes:

- **Function** controls monochrome topology and semantic accent: harm, restore,
  support, protect, hinder, control, conceal, terrain, detect, summon, hazard,
  or neutral.
- **Material** controls the primary palette and surface. All 26 canonical
  materials select a tile in the local channel-packed atlas and retain a full
  procedural fallback; no remote texture or arbitrary shader input is accepted.
- **Behavior** controls temporal rhythm: impact, pulse, flow, grow, contain,
  sweep, linger, sustain, trigger, or static.

The invariant tactical layer—coverage lattice, blocked cells, and boundary—is
never removed by quality or motion settings. Spectacle sheds in this order:
token edge light, motes, scorch, vertical skirt, then turbulence.

### The frame

Every area is drawn as a **tactical frame** first and a material second. The
frame is what makes a placed area read as a precise instrument rather than a
tinted disc, and all of it lives in `shader.mjs` under "the tactical frame":

- **One rule on the rules edge.** On a square grid that is PF2e's staircase of
  covered squares; gridless it is the true shape. The old renderer drew both
  the staircase and the smooth geometry at similar weight, and two edges
  disagreeing is most of what read as fuzzy. The rule is a device-pixel
  hairline (`LAYOUT.rimWidthPx`) drawn against `latticeSdf`, a signed
  distance to the covered set computed from the 3×3 squares around the
  fragment, so every band below follows the squares exactly.
- **Corner brackets** on every convex corner of the staircase, where the rule
  brightens and widens for `LAYOUT.tickOut` squares.
- **An inset rule**, finer and dimmer, `LAYOUT.ruleInset` squares inside.
- **A fresnel band** inside the edge falling away over `LAYOUT.fresnelReach`
  squares, and **a soft glow** outside reaching `LAYOUT.glowReach`. Both are
  on the ground plane, under tokens, so no token is ever veiled by them; the
  boundary plane over tokens carries only hairlines.
- **Blocked squares** — inside the area, out of line of effect — carry no lit
  face; they take a 45° hatch in the tint instead, and a seam against the
  covered squares beside them.
- **The orbit ring**: a dashed ring on the true geometry, `LAYOUT.orbitOut`
  squares outside it, turning at the behaviour's pace. It is the intent the
  squares were cut from, drawn as a reticle so it cannot be mistaken for a
  second edge.
- **Direction chevrons** on cones and lines, one per square along the axis,
  drifting outward at the behaviour's pace.
- **A scan pulse** from origin to edge every `LAYOUT.scanPeriod` seconds at
  pace 1; static behaviour never pulses.
- **The landing.** When the cast-in edge pen closes its lap the frame flares
  once and a single ring leaves the boundary outward. Both are gone by the
  time the entrance completes.

`behaviourPace()` in the shader is the one clock all idle frame motion reads,
so the rhythm a profile declares is visible in the frame as well as in the
material.

### The material

The archetype fills remain procedural, but the ones that have to read as
matter (ember, spirit, umbra, the atmosphere column) run on gradient noise
rather than the shared value noise, whose lattice-aligned blobs are the "cloud
filter" look. Over the fill, the channel-packed atlas at
`assets/pf2e-aoe/material-atlas.png` is sampled as a **detail texture** at two
rotated scales (`LAYOUT.atlasScaleA/B`) so the repeat never lines up with the
lattice. It is 1024 × 512, one seamless 128px tile per canonical material in
`MATERIALS` order, baked deterministically by `tools/gen-pf2e-aoe-atlas.mjs`
(`--check` verifies the shipped bytes). R is body variation, G the family's
structure mask (cracks, dendrites, filaments, bubbles, waves, fibres, plates,
wisps, grain), B the emissive crests, A a particulate mask. The host loads it
with mipmaps **off**: the shader tiles with `fract()`, and a mip seam at the
repeat draws a dark hairline grid across the area.

The colour ramp has three stops: a deep stop (the tint squared) for the body,
the tint, and the hot stop for the rule and brackets. A ramp that starts at the
tint has nowhere to go but paler.

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
use analytic distance fields. Token emanations preserve the source footprint
from Small through Gargantuan and translate their cached mask rigidly during
movement.

Hex, polygon, ring, rotated rectangle, hole, and multi-shape cases that do not
have an exact active backend remain visibly native. A render, shader, texture,
or presenter failure restores that Region's native nodes without affecting
other effects.

## Performance settings

- `aoe.motionTier` changes temporal motion only.
- `aoe.intensity` selects subtle, balanced, or cinematic spectacle.
- `aoe.quality` is automatic, low, medium, or high.
- `aoe.maxConcurrent` is the hard client safety ceiling; overflow stays native.

Automatic quality uses frame-time hysteresis. Priorities are inspected Regions,
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

The preview embeds the shipped shader and animation source verbatim. The check
tool covers controlled vocabulary, every semantic axis, deterministic ties,
profile precedence, inherited/custom/hidden labels, migration mapping and
backup shape, PF2e coverage, gridless fallback, line width, token emanation
sizes and movement, aura adaptation, shader uniforms, and renderer restoration
contracts.
