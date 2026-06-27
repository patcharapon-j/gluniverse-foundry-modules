# Contract: `scripts/core/scene-controls.mjs`

The shared core module that every feature uses to place tools under the suite's
top-level scene-control group. This is the internal interface contract for the new
core helper (the suite exposes no external API change to consumers).

## Module exports

### `ensureSuiteGroup(controls) → SuiteGroup`

Idempotently create and return the suite's top-level control group on the `controls`
record passed by Foundry's `getSceneControlButtons` hook.

- **Input**: `controls` — the record Foundry passes to `getSceneControlButtons`
  (object keyed by group name in v13+).
- **Behavior**:
  - If `controls.gluniverse` does not exist, create it with `name: "gluniverse"`,
    `title: "GLS.controls.suiteGroup"`, `icon` (suite brand), `tools: {}`, a stable
    `order`, and `visible: true`.
  - If it already exists, return the existing object (no overwrite of accumulated
    `tools`).
- **Output**: the `SuiteGroup` object. Callers add tools via `group.tools[name] = {…}`.
- **Idempotency**: calling N times in one hook pass yields one group with merged tools.
- **Constraint**: MUST NOT touch `controls.tokens` (no suite tools remain there).

### `pruneEmptySuiteGroup(controls) → void`

Remove `controls.gluniverse` if it has zero tools. Fallback safety for any feature that
creates the group before deciding it has nothing visible.

- **Input**: same `controls` record.
- **Behavior**: if `controls.gluniverse` exists and `Object.keys(tools).length === 0`,
  delete the key.
- **Postcondition**: no empty suite group is ever rendered (FR-007).

### `bindSuiteToolClicks(html, handlers) → void`

Generalize Insight's per-render rebind so `button` tools fire on every click.

- **Input**: `html` from `renderSceneControls`; `handlers` — a map of tool `name` →
  click action (the same callback the tool's `onChange` runs).
- **Behavior**: for each entry, find `[data-tool="<name>"]`, and if not already bound,
  attach a click listener that invokes the action (idempotent via a `dataset` flag).
  Reuses the established pattern in `insight.mjs`. Passing an explicit handler map
  avoids any fragile global tool lookup.
- **Note**: optional generalization; equivalent per-feature binding remains acceptable.

## SuiteGroup shape (returned object)

```text
{
  name: "gluniverse",
  title: "GLS.controls.suiteGroup",   // i18n key
  icon: "fa-solid fa-meteor",          // recommended brand icon
  tools: { /* filled by features */ },
  order: <stable int>,
  activeTool: <first tool name>,       // set when first tool is added
  visible: true
}
```

## Caller contract (each feature's `getSceneControlButtons` handler)

**Before** (current): writes into Token Controls.
```text
const group = controls.tokens ?? controls.notes ?? Object.values(controls)[0];
group.tools["<name>"] = { … };
```

**After** (required):
```text
import { ensureSuiteGroup } from "../../core/scene-controls.mjs";
// inside the hook, only when the tool should be visible:
const group = ensureSuiteGroup(controls);
group.tools["<name>"] = { /* same tool object as today */ };
```

**Rules**:
1. A feature MUST call `ensureSuiteGroup(controls)` only when it has at least one tool
   to add for the current user (preferred: gate first, then ensure).
2. A feature MUST NOT add suite tools to `controls.tokens` (FR-003).
3. Tool `name`, `title`, `icon`, and `onChange` MUST be unchanged from today (FR-005).
4. Existing role/sub-feature gating MUST be preserved around the add (FR-006, FR-012).
5. Each tool SHOULD set a stable `order` so the group's tool order is deterministic
   (FR-011).

## Behavioral guarantees (map to requirements)

| Guarantee | Requirement |
|-----------|-------------|
| All suite tools render under `controls.gluniverse` | FR-001, FR-002 |
| No suite tool remains in `controls.tokens` | FR-003 |
| Group hidden when no tool present for the user | FR-007 |
| Group/tools reappear on every re-render | FR-008 |
| Button tools fire every click | FR-009 |
| New features join via `ensureSuiteGroup` | FR-010 |
| Deterministic tool order | FR-011 |
| Disabled feature adds nothing | FR-012 |
