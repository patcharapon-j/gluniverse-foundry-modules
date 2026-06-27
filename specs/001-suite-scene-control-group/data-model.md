# Phase 1 Data Model: Suite Scene Control Group

This feature adds no persisted/world data. The "entities" are in-memory Foundry
scene-control structures assembled each time the `getSceneControlButtons` hook fires.

## Entity: Suite Control Group

The single top-level group the suite owns in the scene-control bar. It is a value in
the `controls` record under the key `gluniverse`.

| Field | Type | Value / Source | Notes |
|-------|------|----------------|-------|
| `name` | string | `"gluniverse"` | Group key; matches the `controls` record key |
| `title` | string (i18n key) | `"GLS.controls.suiteGroup"` | Localized "GLUniverse"; new key in `lang/en.json` |
| `icon` | string | `"fa-solid fa-meteor"` (recommended) | Suite-brand FontAwesome class |
| `tools` | record<string, Suite Tool> | `{}` then populated by features | Each member keyed by its existing tool name |
| `order` | number | stable integer | Places the group consistently in the bar |
| `activeTool` | string | first tool's `name` | Avoids "no active tool" edge in some builds |
| `visible` | boolean | `true` when ≥1 tool present | Group is removed entirely when empty (FR-007) |
| `layer` | string \| undefined | unset (button-only group) | See research Decision 4; fallback reuses `tokens` |

**Lifecycle / state**:
1. First feature with a visible tool calls `ensureSuiteGroup(controls)` → group created.
2. Subsequent features call `ensureSuiteGroup(controls)` → same group returned.
3. Each adds its tools to `group.tools`.
4. If created but left empty, prune removes it (fallback path only).

**Validation rules**:
- The group MUST exist iff at least one member tool is present for the current user.
- Member tool keys MUST be unique (existing names already are; no collisions).
- Creating the group MUST be idempotent within one hook pass.

## Entity: Suite Tool

An individual control contributed by a feature, now a member of the Suite Control
Group instead of `controls.tokens.tools`. Shape is unchanged from today.

| Field | Type | Notes |
|-------|------|-------|
| `name` | string | Existing per-tool name (e.g. `glct-toggle`, `gllg-shop`, `glmm-viewer`, `gluniverseStage`, `insight`) — MUST NOT change |
| `title` | string (i18n key) | Existing per-feature key (`GLCT.*`, `GLLG.*`, `GLMM.*`, `INSIGHT.*`, …) — MUST NOT change |
| `icon` | string | Existing FontAwesome class — unchanged |
| `button` | boolean | `true` for all current suite tools |
| `order` | number | Stable ordering within the group (FR-011) |
| `visible` / gating | derived | Tool added only when its feature/sub-feature is enabled and the user is entitled (FR-006, FR-012) |
| `onChange` | function | Existing action handler — unchanged (FR-005) |

**Inventory of tools relocated** (must all move out of Token Controls — FR-003):

- Clocks/Tracker: `glct-toggle`, `glct-tracker-toggle`, `glct-weather-toggle`,
  `glct-support-toggle`, `glct-delving-toggle`
- Loot Gen: `gllg-auditor`, `gllg-generate`, `gllg-workshop`, `gllg-shop`
- Minimap: `glmm-studio`, `glmm-viewer`
- Stage: `gluniverseStage`
- Insight: `insight`

## Relationships

```
controls (record, from Foundry)
 └─ gluniverse: Suite Control Group   (NEW — was: tools spread into controls.tokens)
     └─ tools: { <toolName>: Suite Tool, ... }   (gated per feature/role)
```

No entity persists between sessions; everything is rebuilt on each scene-controls
render.
