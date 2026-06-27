# Implementation Plan: Suite Scene Control Group

**Branch**: `001-suite-scene-control-group` | **Date**: 2026-06-27 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/001-suite-scene-control-group/spec.md`

## Summary

Consolidate every scene-control tool the suite injects into Foundry's **Token Controls**
group into a single, dedicated top-level **GLUniverse** group in the left scene-control
bar. A new shared core module `scripts/core/scene-controls.mjs` exposes
`ensureSuiteGroup(controls)` (idempotently create/return the suite group) plus a prune
helper and an optional click-rebind helper. The five contributing feature adapters
(Clocks/Tracker, Loot Gen, Minimap, Stage, Insight) switch from writing into
`controls.tokens.tools` to writing into the shared group's `tools`, preserving every
tool's name, icon, action, and role/sub-feature gating. The only new user-facing string
is the group label (`GLS.controls.suiteGroup`). No persisted data, sockets, or actions
change.

## Technical Context

**Language/Version**: JavaScript, native ES modules (`.mjs`/`.js`), no transpilation.

**Primary Dependencies**: Foundry VTT v13+ runtime (verified v14) — `getSceneControlButtons`
and `renderSceneControls` hooks; FontAwesome icon classes; `game.i18n`.

**Storage**: None. Scene-control structures are rebuilt in-memory on every render.

**Testing**: Manual gates only (no test runner) — `node --check` on every script, JSON
validation on `module.json` + `lang/*.json`, plus in-Foundry scenarios in
[quickstart.md](quickstart.md).

**Target Platform**: Foundry VTT v13+ / v14, client-side.

**Project Type**: Single installed Foundry package (zero build; repo is the artifact).

**Performance Goals**: Imperceptible — work runs once per scene-controls render; the
helper is O(number of suite tools).

**Constraints**: No build step; register only under `gluniverse-foundry-modules`; no
import-time side effects in adapters; preserve i18n/CSS namespaces; do not honor OS
`prefers-reduced-motion`.

**Scale/Scope**: 5 feature adapters touched + 1 new core module + 1 new lang key; ~13
relocated tools.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Single-Package Namespace Discipline | PASS | New group key `gluniverse` and string under `GLS.*`, all under `SUITE_ID`. No new ids. |
| II. Zero-Build, Source-Is-The-Artifact | PASS | Plain `.mjs`, no build/bundler; new `scripts/core/scene-controls.mjs` is loaded as source. |
| III. Feature Isolation & Inert-When-Disabled | PASS | Adapters still wire the hook in `onInit`; a disabled feature never registers its hook, so it adds no tool. The new core helper is side-effect-free until called from within a hook. |
| IV. Canonical Design System & Localization | PASS | No CSS token changes; new string flows through `game.i18n`; no per-tool i18n/icon renames. |
| V. Manual Validation Gates (NON-NEGOTIABLE) | PASS | `node --check` + JSON validation + in-Foundry quickstart scenarios documented. |

**Initial gate**: PASS — no violations; Complexity Tracking not required.

**Post-design re-check** (after Phase 1): PASS — the design adds one dependency-free core
module and edits five adapters in place; no principle is stressed. `core/util.mjs` is
intentionally left untouched (new glue lives in a dedicated module to keep `util.mjs`
side-effect-free). No entries needed in Complexity Tracking.

## Project Structure

### Documentation (this feature)

```text
specs/001-suite-scene-control-group/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   └── scene-controls.md  # Internal interface contract for the core helper
└── checklists/
    └── requirements.md  # From /speckit-specify
```

### Source Code (repository root)

```text
scripts/
  core/
    scene-controls.mjs        # NEW: ensureSuiteGroup / pruneEmptySuiteGroup / bindSuiteToolClicks
    const.mjs                 # (reference: SUITE_ID, SUITE_TITLE)
  features/
    clocks-tracker/module.js  # EDIT: onGetSceneControlButtons → ensureSuiteGroup
    loot-gen/module.js        # EDIT: getSceneControlButtons handler → ensureSuiteGroup
    minimap/index.mjs         # EDIT: onGetSceneControlButtons → ensureSuiteGroup
    stage/module.js           # EDIT: getSceneControlButtons handler → ensureSuiteGroup
    insight/insight.mjs       # EDIT: tool add → ensureSuiteGroup (keep/adapt click rebind)
lang/
  en.json                     # EDIT: add GLS.controls.suiteGroup
```

**Structure Decision**: Single-package layout (the only option here). New shared logic
goes in `scripts/core/scene-controls.mjs` — a dedicated core module rather than
`core/util.mjs` (which must stay dependency-free/side-effect-free). All five feature
adapters are edited in place; no files move or are renamed.

## Phase 0 — Research

See [research.md](research.md). Key decisions:
1. One shared top-level group keyed `gluniverse` (sibling of Token Controls).
2. Shared core helper `ensureSuiteGroup` rather than per-feature copy-paste.
3. Preferred ordering: features call `ensureSuiteGroup` only when they have a visible
   tool, so an empty group is never created; `pruneEmptySuiteGroup` is the fallback.
4. Group is a button-only container with **no canvas layer** (all suite tools are
   momentary buttons); verify selectability in v13/v14 (manual gate), fall back to
   reusing the `tokens` layer reference if a build requires a layer.
5. New label `GLS.controls.suiteGroup`; recommended icon `fa-solid fa-meteor`.
6. Insight's click-rebind still works (its `[data-tool="insight"]` selector is
   unaffected); optionally fold into `bindSuiteToolClicks`.

## Phase 1 — Design & Contracts

- **Data model**: [data-model.md](data-model.md) — Suite Control Group + Suite Tool
  (in-memory only; no persistence). Full inventory of the ~13 relocated tools.
- **Contracts**: [contracts/scene-controls.md](contracts/scene-controls.md) — the
  `ensureSuiteGroup` / `pruneEmptySuiteGroup` / `bindSuiteToolClicks` interface and the
  caller contract every feature adapter must follow.
- **Quickstart**: [quickstart.md](quickstart.md) — static gates + in-Foundry scenarios
  A–E covering all user stories.
- **Agent context**: `CLAUDE.md` SPECKIT block updated to point at this plan.

## Complexity Tracking

No constitution violations — table intentionally omitted.
