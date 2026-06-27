# Phase 0 Research: Suite Scene Control Group

## Context

Five features currently inject tools into Foundry's **Token Controls** group via the
`getSceneControlButtons` hook:

| Feature | File | Tools added | Gating |
|---------|------|-------------|--------|
| Clocks/Tracker | `scripts/features/clocks-tracker/module.js` | `glct-toggle`, `glct-tracker-toggle`, `glct-weather-toggle`, `glct-support-toggle`, `glct-delving-toggle` | per sub-feature store/flag; delving is GM-only |
| Loot Gen | `scripts/features/loot-gen/module.js` | `gllg-auditor`, `gllg-generate`, `gllg-workshop`, `gllg-shop` | `game.user.isGM` |
| Minimap | `scripts/features/minimap/index.mjs` | `glmm-studio` (GM), `glmm-viewer` (GM, and player when an active map exists) | role + active-map |
| Stage | `scripts/features/stage/module.js` | `gluniverseStage` | `game.user.isGM` |
| Insight | `scripts/features/insight/insight.mjs` | `insight` | `game.user.isGM` |

Each does `const group = controls.tokens ?? controls.notes ?? Object.values(controls)[0]`
and writes into `group.tools[...]`. Insight additionally binds a click handler in a
`renderSceneControls` hook (querying `[data-tool="insight"]`) to work around the
`button`-tool `onChange` reliability issue.

Out of scope: `scripts/features/flatfinder/apex.js` adds an **actor-sheet header**
button (`getHeaderControls`-style), not a scene control — it is not touched.

## Decision 1 — Introduce one shared top-level control group

**Decision**: Add a single top-level entry to the `controls` record passed to
`getSceneControlButtons`, keyed `gluniverse`, owned by a new shared core helper.
Every feature stops writing to `controls.tokens.tools` and instead writes to the
suite group's `tools`.

**Rationale**: Foundry v13+ models the left bar as a record of control *groups*, each
with its own `tools` map. A sibling group is the native way to cluster the suite's
tools and is exactly what the spec asks for (FR-001..FR-003).

**Alternatives considered**:
- *Keep Token Controls, just reorder*: rejected — does not satisfy "own top-level
  button" and keeps the clutter.
- *One group per feature*: rejected — produces many top-level buttons; the request is
  a single suite button.

## Decision 2 — Shared helper, not copy-paste per feature

**Decision**: Add `scripts/core/scene-controls.mjs` exporting:
- `ensureSuiteGroup(controls)` — idempotently creates and returns `controls.gluniverse`
  (with title/icon/`tools: {}`/`order`/`visible`), returning the same object on repeat
  calls within one hook pass so multiple features share one group.
- `pruneEmptySuiteGroup(controls)` — removes the group if it ended the pass with zero
  tools (satisfies FR-007 "no empty group").
- `bindSuiteToolClicks(html, toolNames)` — generalizes Insight's per-render click
  rebind so any `button` tool fires its action on every click (FR-009).

The helper is registered/driven from a single core hook in `scripts/main.mjs` (or a
small `core` init) so the prune step runs **after** all feature hooks have contributed.

**Rationale**: Constitution Principle I (single namespace) and the FEATURE_CONTRACT
favor shared core mechanisms over per-feature duplication; FR-010 requires future
features to join via the same mechanism. Centralizing also gives one place to own the
empty-group prune and the click-reliability rebind.

**Alternatives considered**:
- *Each feature creates the group itself*: rejected — five copies of create/prune
  logic, race on who prunes, and no single ordering authority.
- *Put helper in `core/util.mjs`*: rejected — `util.mjs` must stay dependency-free and
  side-effect-free (constitution); scene-control wiring is feature-of-Foundry glue, so
  a dedicated module is cleaner.

## Decision 3 — Hook ordering / prune timing

**Decision**: Feature `getSceneControlButtons` handlers call `ensureSuiteGroup` and add
their tools. A core `getSceneControlButtons` handler registered with the **lowest
priority among the suite's handlers but configured to run last** calls
`pruneEmptySuiteGroup`. Implementation: register the prune handler once at core init;
because Foundry runs same-event hooks in registration order, the core prune hook is
attached after feature hooks (features wire theirs in `onInit`, core can wire prune in
a `ready`-safe way or use a microtask). If ordering proves fragile, prune lazily inside
`ensureSuiteGroup` by checking on the next call, plus a `renderSceneControls` safety net
that hides an empty group node.

**Rationale**: The group must exist while features add tools, but disappear if none did.
A dedicated last-running prune is the simplest correct ordering.

**Alternatives considered**:
- *Create group only when first tool is added*: viable and even simpler — `ensureSuiteGroup`
  is called only by features that actually have a visible tool, so an untouched group is
  never created and no prune is needed. **This is the preferred primary approach**; the
  explicit prune is the fallback for any feature that calls `ensureSuiteGroup` before
  deciding it has nothing to show.

## Decision 4 — Canvas layer for the group (key Foundry detail)

**Decision**: The suite group is a **button/tool container without its own canvas
layer**. It contains only `button: true` tools (every current suite tool is a button
that toggles a HUD or opens a dialog — none paints on canvas), so the group never needs
to `activate()` a layer. Set the group's `activeTool` to its first tool and rely on the
button tools' own handlers. Verify in Foundry (manual gate) that selecting the group
does not throw due to a missing layer; if a build requires a layer, fall back to
reusing the `tokens` layer reference for the group's `layer` field without moving the
tools back.

**Rationale**: All suite tools are momentary buttons, not stateful canvas tools, so the
group does not conceptually own a layer. Foundry v13/v14 differ slightly in how a
layerless group activates, which is why this is called out for manual verification —
consistent with the project's manual-validation model (Principle V; no test runner).

**Alternatives considered**:
- *Bind a real custom CanvasLayer*: rejected — heavyweight, none of the tools draw on
  canvas, and it risks interfering with core layer activation.

## Decision 5 — Localization & branding

**Decision**: Add a group title key in the suite-level `GLS.*` namespace
(`lang/en.json`), e.g. `GLS.controls.suiteGroup` = "GLUniverse". Choose a suite-brand
icon (recommend `fa-solid fa-meteor`; `fa-solid fa-atom`/`fa-solid fa-shuttle-space` are
alternatives). Per-tool `title` keys and icons stay exactly as they are today (no
renames — Principle IV).

**Rationale**: The only new user-facing string is the group label; everything else is a
relocation. Suite-wide strings already live under `GLS.*`.

## Decision 6 — Insight click-rebind generalization

**Decision**: Keep Insight working by either (a) leaving its existing
`renderSceneControls` rebind as-is (the `[data-tool="insight"]` selector is unaffected
by the parent group change), or (b) migrating it to the shared `bindSuiteToolClicks`.
Prefer (b) so all suite button tools get the same guarantee, but (a) is an acceptable
no-touch fallback.

**Rationale**: The reliability fix is about the tool node, which keeps its `data-tool`
attribute regardless of which group renders it (FR-009).

## Open items requiring manual verification (Foundry runtime)

1. A layerless top-level group renders and is selectable in v13 and v14 without console
   errors (Decision 4).
2. Player with an active minimap map sees the suite group with only the viewer tool
   (FR-006 / US2).
3. With no contributing feature enabled, the suite group does not appear (FR-007).
