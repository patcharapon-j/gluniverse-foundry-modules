<!--
SYNC IMPACT REPORT
==================
Version change: (template, unversioned) → 1.0.0
Rationale: Initial ratification. First concrete constitution derived from the
project's established conventions (CLAUDE.md, docs/FEATURE_CONTRACT.md). MINOR/PATCH
not applicable for a first adoption; baseline is 1.0.0.

Modified principles: none (initial set)
Added principles:
  - I. Single-Package Namespace Discipline
  - II. Zero-Build, Source-Is-The-Artifact
  - III. Feature Isolation & Inert-When-Disabled
  - IV. Canonical Design System & Localization
  - V. Manual Validation Gates (NON-NEGOTIABLE)
Added sections:
  - Platform & Compatibility Constraints
  - Development Workflow
Removed sections: none

Templates requiring updates:
  - .specify/templates/plan-template.md ✅ reviewed — generic "Constitution Check"
    gate, no principle-specific edits required.
  - .specify/templates/spec-template.md ✅ reviewed — technology-agnostic, aligned.
  - .specify/templates/tasks-template.md ✅ reviewed — tests are optional here, which
    matches Principle V (manual validation, no test runner). No edits required.
  - .specify/templates/checklist-template.md ✅ reviewed — generic, aligned.

Follow-up TODOs: none
-->

# GLUniverse Suite Constitution

## Core Principles

### I. Single-Package Namespace Discipline

All suite code MUST register exclusively under the package id
`gluniverse-foundry-modules` (`SUITE_ID`). Foundry only permits a package to own
settings, flags, and socket channels under its own id, so isolation between the
~17 bundled features is achieved by namespacing — not by separate ids:

- **Settings & flags** MUST be key-prefixed with the feature's short prefix
  (`ct.`, `init.`, `ff.`, `dd.`, `stage.`, `lg.`, `cargo.`, …), and the adapter
  MUST declare that same prefix as `settingPrefix`. The prefix and `settingPrefix`
  MUST always agree.
- **Sockets** MUST go through `emitSocket`/`onSocket` in `core/socket.mjs` with a
  feature-tagged payload; never call `game.socket` directly.
- **Asset/template paths** MUST resolve under
  `modules/gluniverse-foundry-modules/...`, preferably via `featurePath()`.

**Rationale**: One id is a hard platform constraint. Prefixing and payload-tagging
are the only mechanisms that keep features from colliding on shared state.

### II. Zero-Build, Source-Is-The-Artifact

The repository IS the installed module. There MUST be no build step, bundler, or
transpiler. Foundry loads `scripts/main.mjs` as native ES modules and consumes the
CSS/lang files listed in `module.json` directly. Code MUST be written in the form
Foundry executes — no syntax requiring compilation, no generated output checked in
as the source of truth.

**Rationale**: Adding a build pipeline would fork "what we edit" from "what ships,"
breaking the guarantee that the checked-out tree is exactly what runs in Foundry.

### III. Feature Isolation & Inert-When-Disabled

Every feature is a self-registering adapter (`scripts/features/<id>/index.mjs`)
that calls `Suite.register({...})`. A disabled feature MUST stay completely inert:

- Adapters MUST NOT register Foundry Hooks, open UI, or run other side effects at
  import time. Such work happens ONLY inside `onInit`/`onReady`, and only for
  features that are enabled AND available (system + dependency gating).
- Adapters MUST register ALL of their settings/menus unconditionally during the
  init settings pass, so toggles exist even while the feature is off.
- Cross-feature coupling MUST go through the registry, the shared socket, or
  declared `requires`/`system` gates — never by reaching into another feature's
  internals.

**Rationale**: Toggleability is the suite's core promise; an import-time side
effect leaks a "disabled" feature into every world that installs the package.

### IV. Canonical Design System & Localization

The look and the language of the suite are single-sourced:

- `styles/gl-tokens.css` is the ONLY source of truth for design tokens, keyframes,
  and the `.gl-glass`/`.gl-btn` utilities. Features MUST consume `--gl-*` tokens
  and `gl-*` keyframes; they MUST NOT redefine tokens locally (derive an alias if
  needed). Each feature keeps its existing unique CSS class prefix.
- All user-facing strings MUST flow through `game.i18n.localize/format`. Each
  module's existing key namespace (`GLCT.*`, `GLS.*`, `GLLG.*`, `GLUCARGO.*`,
  `GLSBI.*`, `GLUNI.*`, …) MUST be preserved — never renamed. When a key is built
  dynamically at runtime, every value in the enum/set MUST have a matching lang
  key. Stored data values and parser/format vocabulary MUST NOT be localized.

**Rationale**: One token system keeps the Etched Glass UI consistent across every
feature; preserved i18n/CSS namespaces are load-bearing for migration and world
data, so renames silently break installed worlds.

### V. Manual Validation Gates (NON-NEGOTIABLE)

There is no CI, no automated test runner. Validation is manual and MUST pass
before any commit that touches the relevant files:

- Every `*.mjs`/`*.js` MUST pass `node --check`.
- `module.json` and every `lang/*.json` MUST be valid JSON.
- When localization changes, referenced keys MUST resolve, and `module.json`'s
  `styles`/`languages`/`esmodules` lists MUST still point at files that exist.

Because there is no test harness, the burden of correctness shifts onto these
gates plus careful review; they are not optional formalities.

**Rationale**: Without CI, a syntax error or a dangling `module.json` reference
ships straight to users' worlds. These checks are the only safety net.

## Platform & Compatibility Constraints

- **Target**: Foundry VTT v13+ (verified through v14). Code MUST use platform APIs
  available in that range.
- **Shared helpers**: Reach for `scripts/core/util.mjs` before re-declaring
  clamp / integer-coercion / hex-validation / HTML-escape. That module MUST remain
  dependency-free and side-effect-free.
- **Motion**: The suite intentionally does NOT honor the OS `prefers-reduced-motion`
  preference — animations always play for visual consistency across users. Do NOT
  add `@media (prefers-reduced-motion)` blocks or `matchMedia(...)` checks. The
  only exception is the explicit in-app "motion tier" setting in Loot Gen, Destiny
  Dice, and Statsblock Import, which is a deliberate user choice rather than an OS
  preference.

## Development Workflow

- Adding or porting a feature MUST follow `docs/FEATURE_CONTRACT.md` exactly;
  `docs/PORTING_GUIDE.md` documents how standalone modules were migrated in.
- One-time data migration from the old standalone modules lives in
  `core/migration.mjs`; behavior that world data depends on (i18n keys, flag keys,
  CSS prefixes) MUST NOT be renamed once shipped.
- Changes MUST run the manual validation gates of Principle V before commit.
- Reviews MUST verify compliance with these principles. Any deviation MUST be
  justified in the change description (see Governance).

## Governance

This constitution supersedes ad-hoc practice for the GLUniverse Suite repository.

- **Authority**: When guidance conflicts, the order of precedence is this
  constitution → `docs/FEATURE_CONTRACT.md` → `CLAUDE.md` → other docs.
- **Amendments**: Changes to this document MUST be made via an explicit edit that
  updates the version and the Sync Impact Report, and MUST propagate any affected
  guidance into `.specify/templates/*` and `CLAUDE.md`.
- **Versioning**: Semantic versioning applies. MAJOR for backward-incompatible
  principle removals or redefinitions; MINOR for a new principle or materially
  expanded guidance; PATCH for clarifications and non-semantic refinements.
- **Compliance**: Every change is expected to satisfy the manual validation gates
  and to leave disabled features inert. Complexity or any principle deviation MUST
  be documented and justified; unjustified violations are grounds to reject the
  change.

**Version**: 1.0.0 | **Ratified**: 2026-06-27 | **Last Amended**: 2026-06-27
