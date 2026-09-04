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
