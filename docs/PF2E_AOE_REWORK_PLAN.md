# PF2e Spellglass visual-system rework

Status: implementation started; schema/classification/profile foundation in progress
Scope: `scripts/features/pf2e-aoe/`, its settings, assets, localization,
documentation, preview tooling, and validation tooling
Target: Foundry VTT v14 and PF2e 8.x

## 1. Outcome

Replace the current damage-archetype renderer with a compositional presentation
system that can faithfully depict damaging and non-damaging areas without
changing any PF2e rule, Region geometry, visibility decision, or aura behavior.

The finished system has two simultaneous responsibilities:

1. **Immutable tactical truth** — exact covered space, holes, boundaries,
   attachment, visibility, and measurements remain readable under every motion,
   intensity, and performance setting.
2. **Adaptive spectacle** — material texture, semantic structure, atmospheric
   detail, and lifecycle animation make the area feel like its originating
   effect and may shed gracefully when the scene becomes expensive.

This is a destructive replacement of the existing 14-archetype system. Legacy
world data is converted once, with a preflight report and downloadable backup;
the old schema, shader branches, settings UI, and runtime aliases are removed at
public cutover.

## 2. Binding product decisions

### Presentation boundary

- Spellglass is presentation-only. Foundry and PF2e remain authoritative for
  shapes, grid measurement, line of effect, aura membership, visibility,
  targeting, and rules application.
- Item, spell, action, feat, feature, and recognized aura areas classify
  automatically.
- Environment Regions and hazards classify only when they expose recognized
  structured behavior or have an explicit Spellglass profile.
- Unknown geometry or unsupported runtime states restore native Foundry
  presentation rather than drawing an approximation.
- Both a per-Region **Native presentation** choice and a scene-wide Spellglass
  opt-out are required.

### Semantic model

Every resolved effect uses these independent axes:

| Axis | Cardinality | Canonical values |
|---|---:|---|
| function | one primary, optional secondary | `harm`, `restore`, `support`, `protect`, `hinder`, `control`, `conceal`, `terrain`, `detect`, `summon`, `hazard`, `neutral` |
| material | one primary, optional accent | `fire`, `cold`, `electricity`, `acid`, `poison`, `sonic`, `force`, `kinetic`, `vitality`, `void`, `spirit`, `holy`, `unholy`, `light`, `shadow`, `mental`, `illusion`, `air`, `earth`, `water`, `wood`, `metal`, `plant`, `fungal`, `arcane`, `neutral` |
| behavior | exactly one | `impact`, `pulse`, `flow`, `grow`, `contain`, `sweep`, `linger`, `sustain`, `trigger`, `static` |
| modifiers | zero or more | audience, sense, source, and geometry metadata |

Built-in axis values are closed and localized. Integrations may register
namespaced profiles, but v1 does not accept arbitrary axis identifiers or
third-party GLSL.

### Resolution order

The resolver applies this precedence, highest first:

1. Region native opt-out
2. Sparse explicit Region overrides
3. Referenced built-in or world profile
4. Frozen classification snapshot on a committed placed Region
5. Live structured source evidence
6. Neutral fallback

Manual intent therefore wins without preventing automatic defaults. Placed
templates freeze inferred semantics when committed so later item edits do not
change an existing effect. Source-bound auras continue to resolve live.

### Visual grammar

- Function controls topology, boundary language, and semantic accents.
- Material controls the principal hue, surface texture, particles, and light
  response.
- Behavior controls motion rhythm and lifecycle transitions.
- Material owns the principal hue; function may add a restrained semantic
  accent or boundary color.
- Differences must remain recognizable through structure, texture, and motion,
  not color alone.
- Rank or level may scale restrained spectacle intensity, never geometry,
  tactical opacity, or measurement.
- The family retains one identity: an enchanted tactical projection whose
  materials still read distinctly as fire, frost, electricity, shadow, and so
  on.

## 3. Stored data and public contracts

### Region presentation flag

Replace `aoe.style` and the unused `aoe.suppress` flag with one versioned flag:

```js
flags[SUITE_ID]["aoe.presentation"] = {
  schema: 2,
  mode: "auto" | "profile" | "custom" | "native",
  profileId: "builtin:..." | "world:..." | null,
  snapshot: {
    semantics: {
      function: "harm",
      secondaryFunction: null,
      material: "fire",
      accent: null,
      behavior: "impact",
      audience: "all" | "allies" | "enemies" | "self" | "unknown",
      senses: ["visual"],
      source: "spell",
      geometry: "burst"
    },
    confidence: "high" | "medium" | "low",
    evidenceVersion: 1
  },
  overrides: {
    semantics: {},
    appearance: {
      palette: null,
      intensity: null,
      treatment: null
    }
  },
  label: {
    mode: "inherit" | "custom" | "hidden",
    value: ""
  }
};
```

Rules:

- Omit empty optional objects when persisting; the example shows the complete
  shape, not the minimum payload.
- `mode: "native"` is the sole Region-level opt-out.
- A custom label is player-visible only when the Region itself is visible to
  that player. `hidden` is an explicit blank and must not fall back to a name.
- Inherited labels resolve from the originating item, spell, action, feat,
  feature, aura, or recognized behavior name, then the Region name. A template
  placed from Fireball therefore displays **Fireball** by default.
- Stored values are stable IDs and never localized strings.

### World profiles

Add `aoe.profiles`, a versioned GM-managed world setting:

```js
{
  schema: 1,
  profiles: [{
    id: "world:<stable-id>",
    name: "Silence Field",
    semantics: {},
    appearance: {}
  }]
}
```

- Built-in profiles use immutable `builtin:*` IDs and cannot be edited.
- World profile IDs remain stable when display names change.
- Regions retain a live profile reference and store only sparse overrides.
- **Detach** materializes the resolved profile into Region overrides.
- Profile deletion requires reassignment, detachment, or restoration to auto;
  dangling references cannot be created through the UI.
- Duplicate, import, and export operate on validated JSON. Imported IDs are
  regenerated on collision.

### Settings

Replace `aoe.styleDefaults` and extend current configuration with:

| Key | Scope | Purpose |
|---|---|---|
| `aoe.schemaVersion` | world | completed migration version |
| `aoe.profiles` | world | reusable custom profiles |
| `aoe.intensity` | world | `subtle`, `balanced`, or `cinematic` |
| `aoe.quality` | client | automatic or explicit spectacle budget |
| `aoe.motionTier` | client | temporal motion only |
| `aoe.maxConcurrent` | client | hard safety ceiling |
| `aoe.devRenderer` | world, hidden | development slices before cutover |

Motion, spectacle intensity, and performance quality are independent. Every
motion tier keeps the complete settled tactical and material state; lower tiers
reduce or freeze temporal change rather than deleting meaning.

### Public API

Expose through the feature API:

```js
classify(source, options)             // evidence plus resolved semantics
resolveProfile(regionOrSource)        // complete immutable render profile
pulse(effectId, options)              // semantic manual trigger, socket-aware
registerProfile(namespace, profile)   // validated namespaced extension profile
unregisterProfiles(namespace)
```

The API does not accept shader source, textures from remote URLs, visibility
overrides, or mechanical coverage. Registration is session-scoped and must be
performed during the feature lifecycle, not at module import time.

## 4. Classification engine

Create a pure, dependency-light classification layer instead of the current
first-trait/first-damage early return.

### Evidence inputs

Collect independent evidence records from, in order of reliability:

1. Explicit presentation data
2. PF2e aura appearance and full aura/effect data
3. Frozen placement metadata, especially `origin.rollOptions`
4. Resolved originating item data
5. Aura effect UUIDs, audience, entry/turn events, and predicates
6. Structured Region behaviors such as movement cost
7. Curated slug profiles
8. Neutral unknown

Each record contains `axis`, `value`, `weight`, `source`, and a diagnostic reason.
Aggregation is deterministic: stable source priority, canonical value ordering,
and an explicit tie rule. Description text is never parsed.

### Resolution rules

- Resolve every axis independently, then validate the combination.
- Keep one primary and at most one secondary function.
- Keep one primary material and at most one accent.
- Damage kinds establish harm or restore evidence; the `healing` trait is a
  strong restore fallback, while `vitality` alone does not imply healing.
- Aura audience and lifecycle events inform modifiers and behavior, not
  mechanical targeting.
- Low-confidence results use the neutral visual profile and expose a GM-only
  **Needs classification** state. Players never see confidence diagnostics.
- Ambiguous pairs such as support/protect, hinder/control, fog/silence,
  terrain/control, creation/summon, and detection/hostile reveal require an
  explicit override or curated slug profile.

Add focused pure modules:

```text
schema.mjs          canonical IDs, normalization, validation
evidence.mjs        PF2e/Foundry evidence collectors
classifier.mjs      deterministic aggregation and confidence
profiles.mjs        built-ins, world profiles, precedence, final resolution
```

`data.mjs` should retain geometry and source adapters only until those concerns
are split; it must no longer own classification, palettes, labels, coverage, and
geometry simultaneously.

## 5. Renderer architecture

### Layer contract

Each rendered area consists of an invariant tactical layer plus optional
spectacle layers:

```text
exact Region geometry
  -> tactical boundary and PF2e coverage lattice       invariant
  -> function topology / semantic marks                invariant
  -> material body and detail texture                  quality-scaled
  -> behavior atmosphere and particles                 quality-scaled
  -> semantic accent and lifecycle transient           quality-scaled
  -> attached-token edge response                      first shed candidate
```

The boundary, coverage lattice, and settled function structure can never be
shed. Suggested shedding order is token-edge response, free particles,
transient decals, atmosphere, secondary material accent, then turbulence.

### Geometry backends

Use the exact backend appropriate to the Region rather than coercing all shapes
into four shader IDs:

- Analytic distance fields for exact rectangle, circle, ellipse, cone, ring,
  line, and simple emanation primitives.
- Foundry triangulation plus a Region-space mask for polygon, token, grid,
  multiple-shape, and hole composites.
- PF2e/Foundry covered-grid offsets for the tactical lattice on square and hex
  grids.
- Native rendering whenever exact geometry or visibility cannot be acquired.

Required corrections include actual line width, ring inner/outer widths,
rotated primitives, cone curvature, gridless geometry, multi-shape ordering,
holes, hex cells, and token emanations of every token size.

Geometry extraction, coverage textures, measurement data, and display nodes use
separate caches. Token movement updates transforms and token-edge sprites only;
it must not rebuild masks or meshes on every animation frame. Preview Regions
are keyed by object identity in a `WeakMap` because they may not yet have a
persisted document ID.

### Function topology

The first visual pass must make these families distinguishable in monochrome:

| Function | Structural language |
|---|---|
| harm | inward energy, fractures, aggressive rim |
| restore | outward renewal waves, open radial marks |
| support | linked nodes and reinforcing cadence |
| protect | double boundary, braces, counter-flow |
| hinder | drag, barbs, interrupted paths |
| control | locks, anchors, containment bands |
| conceal | broken edge, diffused interior, occluding drift |
| terrain | contour, footprint, grounded directional grain |
| detect | scanning spokes, reveal sweep, sparse reticle |
| summon | threshold, gate, converging construction |
| hazard | warning cadence, chevrons, armed/trigger states |
| neutral | restrained etched lattice |

The optional secondary function contributes a minor accent only; it cannot
compete with or obscure the primary topology.

### Materials and textures

Replace the numeric archetype `if` ladder with data-driven material descriptors
and shared shader functions. Split shader source into composable native modules
under `render/shaders/`; concatenate strings at import time without adding a
build step.

Ship compact local channel-packed atlases under `assets/pf2e-aoe/`:

- R: broad material variation
- G: fine detail or crack/vein mask
- B: emissive/hot structure
- A: particle or dissolve mask

Material descriptors select atlas regions, palette stops, distortion, surface
response, particle family, and safe fallback. A missing texture, unsupported GPU
capability, or asset-load failure switches to a procedural equivalent while
leaving tactical layers intact. Remote texture fetching is prohibited.

The first built-in catalog should contain roughly 24 curated profiles spanning
all twelve functions and every major material family. Existing ember, frost,
arc, caustic, resonance, radiance, umbra, spirit, force, kinetic, verdant, and
arcane identities guide the new material art but do not survive as runtime IDs.

### Lifecycle

All profiles share a state machine:

```text
preview -> cast-in -> sustain <-> semantic pulse -> dissipate -> removed
```

Behavior selects the transition curve and settled motion. Authoritative events
may trigger transitions:

- placement/commit: cast-in
- PF2e damage or healing event tied to the source: semantic pulse
- exposed aura entry or turn event: behavior-specific pulse
- attached-source movement: transform response, not a cast replay
- deletion/expiry: dissipate
- public API call: validated manual pulse

When no authoritative semantic event exists, render cast-in followed by sustain;
do not fabricate impact or damage pulses. The placement preview uses a stable,
simplified tactical/material state and runs the full cast-in only after commit.

## 6. Measurement and identity presenter

Create a separate `MeasurementPresenter` instead of folding text into the
render host.

### Identity

- Show a compact inherited or custom name near the shape's visual center.
- Respect Region visibility and player permissions before resolving or drawing
  names.
- Use screen-space scaling, collision avoidance, and a bounded offset from the
  owning shape.
- Permit an explicit hidden label without fallback.

### Contextual measurement

- Show detailed dimensions during creation/editing and while the Region is
  inspected, controlled, or hovered according to Foundry interaction state.
- Treat `displayMeasurements` as permission for contextual post-placement
  inspection, not a request for permanent measurement clutter. Creation and
  active editing may display measurements temporarily.
- Use Foundry `shape.measuredSegments`, PF2e grid rules, and scene units as the
  authority. Never infer rules distance from rendered pixels.
- Prefer a collision-aware callout near the clearest boundary. Hide optional
  detail below a screen-size threshold unless the area is inspected.
- Multi-shape Regions show an overall identity and details for the active shape.
  Polygon, token, or grid shapes receive a semantic label but no invented size.

Compact summaries include:

```text
20 ft • BURST
60 × 5 ft • LINE
20 ft • CONE • 90°
20 ft • EMANATION
20 × 20 ft • CUBE
```

Auras show radius and units. Show the source name only when it can be resolved
reliably and is permitted for the current user; uncertain identity remains
GM-only.

### Native suppression transaction

Native measurement lines and labels are suppressed only after the custom
presenter has successfully created a replacement for that Region. Track every
modified native node and restore it when the Region becomes unsupported, opts
out, the renderer fails, the feature is disabled, the canvas tears down, or the
module reloads. Never modify the persisted `displayMeasurements` value merely
to hide native graphics.

## 7. Configuration experience

Replace the archetype/color form with a preset-first editor:

1. Automatic recommendation, confidence, and concise evidence
2. Built-in or world-profile picker with live preview
3. Expandable advanced semantic axes and modifiers
4. Appearance overrides: palette, intensity, treatment
5. Label mode: inherit, custom, hidden
6. Native presentation opt-out

Only GMs see classification evidence and uncertainty. Players see permitted
identity, geometry, and measurement information. The creator uses the same
editor model and shows a simplified placement preview.

World profile management is a dedicated ApplicationV2 surface supporting
create, duplicate, rename, import, export, delete/reassign, and detach. Reuse
the Etched Glass design tokens and localize every label, option, hint, warning,
and migration message.

## 8. Performance and failure behavior

Performance target: stable 60 FPS at 1080p with approximately twelve visible,
simultaneous areas on a representative mid-range GPU.

### Budgeting

- Update time uniforms without allocating geometry, text, or textures per frame.
- Cache immutable geometry and atlas resources; reference count shared GPU data.
- Keep label layout event-driven and coalesced, not ticker-driven.
- Apply priorities in this order: inspected/controlled, attached, active hazard,
  nearby/on-screen, then remaining creation order.
- When a hard ceiling is exceeded, restore native presentation for overflow
  areas instead of hiding them.
- Quality shedding has hysteresis so effects do not oscillate between tiers.
- The renderer may reduce spectacle, never tactical truth.

### Failure containment

Each Region owns an error boundary. A failed profile, texture, geometry backend,
shader compile, or presenter creation restores that Region's native nodes and
records one deduplicated GM diagnostic. One bad Region must not detach the host
or blank other effects.

## 9. Migration and cutover

### Preflight

Before writing:

1. Count legacy `aoe.style` flags and `aoe.styleDefaults` entries.
2. Validate every candidate and list invalid colors, labels, and archetype IDs.
3. Produce a downloadable JSON backup containing settings, affected Scene/Region
   UUIDs, original values, module version, system version, and timestamp.
4. Show the deterministic mapping and warnings to the GM.
5. Require an explicit migration action; non-GMs never migrate world data.

### Conversion

Map legacy archetypes approximately:

| Legacy | New material/function default |
|---|---|
| ember | fire / harm |
| frost | cold / harm |
| arc | electricity / harm |
| caustic | acid / harm |
| resonance | sonic / harm |
| radiance | vitality / restore or harm from source evidence |
| umbra | void / harm |
| spirit | spirit / harm |
| force | force / harm |
| kinetic | kinetic / harm |
| verdant | plant / terrain |
| arcane | arcane / neutral, then reclassify from evidence |
| generic | neutral / neutral |
| warning | neutral / hazard |

Preserve custom labels, explicit blank labels, colors, and compatible intensity
intent as sparse overrides. Convert legacy world colors into generated world
profiles only when they differ from the new built-ins. After successful writes,
set `aoe.schemaVersion`, remove legacy flags/settings, and emit a report.

Migration is idempotent and chunked across Scenes. A failed chunk stops further
writes and reports completed and pending document UUIDs. Runtime dual-reading is
allowed only behind the development gate before public cutover; the released
renderer reads schema 2 only.

## 10. Module decomposition

Target structure; names may change slightly during implementation, but ownership
boundaries are binding:

```text
scripts/features/pf2e-aoe/
  constants.mjs              feature/settings/flag IDs only
  schema.mjs                 controlled vocabulary and validation
  evidence.mjs               PF2e and Foundry evidence adapters
  classifier.mjs             pure aggregation and confidence
  profiles.mjs               built-ins, world profiles, precedence
  geometry.mjs               exact shape adapters and coverage
  measurement.mjs            identity and measurement presenter
  lifecycle.mjs              behavior state machine and triggers
  migration.mjs              preflight, backup payload, conversion
  controls.mjs               placement entry point and preview
  region-config.mjs          preset-first Region editor
  profile-app.mjs            world profile management
  aura.mjs                   aura source adapter only
  main.mjs                   hooks, sockets, public API composition
  render/
    host.mjs                 resource ownership and scheduling
    effect.mjs               one Region display object
    materials.mjs            atlas and procedural descriptors
    shaders/
      common.mjs
      tactical.mjs
      topology.mjs
      material.mjs
      atmosphere.mjs
```

Avoid circular dependencies. Pure schema, classification, profile, geometry,
and migration helpers must remain importable by Node validation tools without a
Foundry runtime.

## 11. Implementation sequence and gates

### Phase 0 — Baseline and development gate

- Capture current visual gallery and representative performance figures.
- Add hidden `aoe.devRenderer` without changing the public renderer.
- Establish stable fixtures for Regions, PF2e origin metadata, auras, and legacy
  flags.

Exit gate: existing checks still pass; baseline gallery and benchmark are
repeatable.

### Phase 1 — Schema, classifier, profiles, and migration dry run

- Implement controlled vocabulary and validators.
- Implement evidence collection, deterministic aggregation, confidence, and
  neutral fallback.
- Define built-in profiles and world-profile resolution.
- Implement migration preflight and pure conversion without writing documents.
- Expose diagnostics in development tooling.

Exit gate: table-driven tests cover every function, material family, behavior,
source type, ambiguity, tie, and legacy archetype.

### Phase 2 — Exact geometry and measurement presenter

- Split geometry from current `data.mjs`.
- Add analytic primitive and triangulated composite backends.
- Add square, hex, and gridless coverage contracts.
- Implement identity inheritance and contextual measurement summaries.
- Implement transactional native suppression and preview object identity.

Exit gate: no supported shape is approximated; unsupported cases remain visibly
native; all native nodes restore on teardown and failure.

### Phase 3 — Compositional renderer vertical slice

- Build neutral tactical layer first.
- Add one complete function/material/behavior slice for each shader path.
- Introduce local atlas loading and procedural fallback.
- Implement lifecycle, quality shedding, caching, and attached-token transforms.
- Port the remaining materials and functions only after the slice satisfies the
  performance budget.

Exit gate: twelve simultaneous representative effects meet the target and retain
tactical truth at the lowest quality and motion tiers.

### Phase 4 — Presets and authoring surfaces

- Finish approximately 24 built-in presets and their visual gallery.
- Replace archetype defaults UI with profile management.
- Replace Region archetype controls with preset-first configuration.
- Integrate simplified placement preview, label modes, detachment, import/export,
  opt-outs, and GM diagnostics.

Exit gate: a GM can create, classify, override, reuse, detach, export, import,
and safely delete a profile without editing flags.

### Phase 5 — Auras, environment behaviors, and semantic events

- Resolve live aura profiles, authored aura appearance, audience, and lifecycle
  evidence without taking over PF2e membership.
- Add conservative terrain styling for recognized movement behaviors.
- Wire authoritative damage, healing, aura, placement, movement, and removal
  events.
- Finalize socket validation and public API registration cleanup.

Exit gate: source-bound effects update safely, unreliable aura names stay hidden,
and no event is inferred from prose.

### Phase 6 — Migration write path and public cutover

- Add GM preflight dialog, backup download, chunked write, and report.
- Run full migration fixtures and interrupted-migration recovery tests.
- Remove legacy constants, shader branches, settings UI, runtime dual-read, and
  development gate.
- Update durable documentation and release notes.

Exit gate: a copied legacy world converts once, reloads cleanly, and contains no
runtime dependency on old archetype IDs.

## 12. Validation matrix

### Automated contracts

Extend or split `tools/pf2e-aoe-check.mjs` to cover:

- schema normalization and rejection of unknown IDs
- every source type and semantic axis
- deterministic evidence ties and confidence thresholds
- primary/secondary function and material/accent limits
- manual/profile/snapshot/evidence/fallback precedence
- inherited, custom, and explicitly hidden labels
- all ten Foundry Region shape types
- PF2e burst, cone, cube, cylinder, emanation, line, ring, and square
- actual wide lines and inner/outer ring widths
- rotated shapes, cone curvature, holes, composites, and active-shape selection
- square grids, hex grids, gridless Scenes, and diagonal rules
- Small through Gargantuan attached token emanations during movement animation
- aura identity, radius, audience, and unreliable-source fallback
- migration mapping, idempotence, partial failure, and backup completeness
- profile import collision, deletion reassignment, and detach semantics
- native restoration on opt-out, overflow, failure, teardown, and feature disable
- public API validation and socket payload validation

Run the repository's required syntax and JSON checks after every phase. All new
localization keys must be checked against their dynamic enum use.

### Visual gallery

Upgrade `tools/pf2e-aoe-preview.mjs` and its template to produce a deterministic
gallery covering:

- every built-in profile
- every primary function in monochrome
- every material at settled, cast-in, pulse, and dissipate states
- every behavior under all motion tiers
- square, hex, gridless, primitive, composite, and hole geometry
- subtle, balanced, and cinematic intensity
- high- and low-contrast maps, vision masking, overlap, labels, and measurement
- procedural fallback with atlases deliberately unavailable

Golden captures are review artifacts, not brittle pixel-exact tests. Each review
records the module revision, dimensions, device scale, motion tier, quality,
intensity, and seed.

### Performance benchmark

Add a repeatable preview scene with 1, 4, 8, 12, 24, and 48 effects. Record frame
time percentiles, allocations/rebuilds, draw calls, texture count, and selected
quality tier for settled, pulsing, overlapping, and attached-motion scenarios.
Export results as JSON so regressions can be compared between revisions.

Release blocks on any of these failures:

- tactical boundary or coverage becomes ambiguous
- custom presentation disagrees with authoritative geometry
- native fallback fails to restore
- labels expose information the Region does not permit the user to see
- movement rebuilds full geometry per animation frame
- the 12-effect representative benchmark misses its stable-frame target
- a low-motion or low-quality tier removes semantic meaning

## 13. Definition of done

The rework is complete only when:

- damaging and non-damaging effects resolve through the same compositional
  system;
- all Foundry Region shapes either render exactly or remain native;
- item-derived templates inherit their source name automatically;
- measurement is accurate, contextual, collision-aware, and safely reversible;
- the old archetype runtime and schema are gone after a backed-up migration;
- world profiles and sparse Region overrides work end to end;
- visibility, aura mechanics, and PF2e rules remain untouched;
- the visual gallery has approved coverage across semantics, materials,
  behaviors, shapes, motion tiers, and fallback paths;
- automated contracts, syntax checks, JSON checks, and the performance benchmark
  pass with zero blocking errors.
