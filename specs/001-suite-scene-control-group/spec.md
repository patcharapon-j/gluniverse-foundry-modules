# Feature Specification: Suite Scene Control Group

**Feature Branch**: `001-suite-scene-control-group`

**Created**: 2026-06-27

**Status**: Draft

**Input**: User description: "In this foundryvtt module, make all control this module added to the left panel control to be under the module own top level button isntead of all under token control"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Suite tools live under one dedicated control group (Priority: P1)

A Game Master opens a scene. Today, the buttons that the GLUniverse Suite adds (time HUD, weather, loot generator, minimap studio, stage director, insight, etc.) are mixed into Foundry's built-in **Token Controls** group, sitting alongside the core token-manipulation tools and cluttering them. The GM wants every Suite-provided control to instead live together under a single, clearly-labeled top-level GLUniverse group in the left scene-control bar, so Suite tools are grouped, recognizable, and separated from core Foundry tools.

**Why this priority**: This is the entire purpose of the request. Without it, there is no feature. Consolidating the Suite's scattered tools into one branded group is the minimum viable deliverable and immediately improves discoverability and reduces clutter in the Token Controls group.

**Independent Test**: Enable several Suite features (e.g. Clocks/Tracker, Loot Gen, Minimap, Stage, Insight), log in as a GM, and open the scene controls. Verify a new top-level GLUniverse group appears in the left bar and that every tool those features contribute is found inside that group — and that none of them remain inside Token Controls.

**Acceptance Scenarios**:

1. **Given** a GM with multiple Suite features enabled, **When** the scene controls render, **Then** a single top-level GLUniverse group button is shown in the left control bar.
2. **Given** the GM selects the GLUniverse group, **When** its tool palette expands, **Then** all Suite-contributed tools (time HUD toggle, tracker dock, weather, support, loot auditor/generate/workshop/shop, minimap studio/viewer, stage director, insight, and any other Suite tool) appear there.
3. **Given** the Suite group is present, **When** the GM inspects the Token Controls group, **Then** no Suite-contributed tools remain in it (only core Foundry token tools).
4. **Given** a tool is moved into the new group, **When** the GM clicks it, **Then** it performs exactly the same action it did before (opens the same dialog / toggles the same HUD).

---

### User Story 2 - Each tool only appears when its feature is enabled and the user is allowed (Priority: P2)

The Suite's tools are conditional today: some are GM-only, some appear for players only under certain conditions (e.g. the minimap viewer shows for a player when an active map exists), and some only appear when a specific sub-feature is turned on. The grouping change must preserve all of this gating — the new group must show only the tools the current user is actually entitled to, and must not appear as an empty shell.

**Why this priority**: Regressing visibility rules would either expose GM-only tools to players or hide tools that should be available. Preserving the existing per-tool and per-feature gating is essential, but it is secondary to establishing the group itself.

**Independent Test**: Log in as a non-GM player on a scene with an active minimap and confirm the GLUniverse group appears containing only the viewer tool; disable all Suite features that contribute controls and confirm the group does not appear at all.

**Acceptance Scenarios**:

1. **Given** a non-GM player and an active minimap map, **When** scene controls render, **Then** the GLUniverse group appears containing the minimap viewer and excludes GM-only tools.
2. **Given** a user for whom no Suite tool is currently available (no enabled contributing feature / no entitlement), **When** scene controls render, **Then** the GLUniverse group is not shown at all (no empty group).
3. **Given** a sub-feature toggle is off (e.g. weather disabled), **When** the group renders, **Then** that sub-feature's tool is absent while the other enabled tools remain present.

---

### User Story 3 - Group survives control re-renders and click reliability is preserved (Priority: P3)

Foundry re-renders the scene controls frequently (scene switches, layer changes, control toggles). The Suite group and its tools must reappear correctly on every re-render, and the existing workaround that guarantees "button" tools fire their action on every click (rather than getting stuck as the active tool) must continue to work inside the new group.

**Why this priority**: This protects against subtle regressions that only show up after interaction, but the core grouping (P1) and gating (P2) deliver the visible value first.

**Independent Test**: Switch scenes and toggle layers several times, then repeatedly click a Suite "button" tool (e.g. Insight) and confirm it triggers its action on every click without sticking.

**Acceptance Scenarios**:

1. **Given** the scene controls have re-rendered after a scene switch, **When** the GM opens the GLUniverse group, **Then** all expected tools are present and functional.
2. **Given** a Suite "button" tool is clicked twice in a row, **When** each click occurs, **Then** the bound action runs both times.

---

### Edge Cases

- **No Suite control features enabled**: The GLUniverse group must not appear at all rather than showing as empty.
- **Only one contributing feature enabled**: The group still appears and contains only that feature's tool(s).
- **Mixed entitlement**: A player who can see only one tool gets a group with just that tool; a GM sees the full set.
- **Future features**: A newly added Suite feature that contributes a scene-control tool must be able to join this group through the same shared mechanism without re-introducing tools into Token Controls.
- **Foundry version differences**: The group must render correctly across the supported Foundry versions (v13+, verified v14), where scene-control internals differ slightly.
- **Ordering**: Tools within the group should appear in a stable, predictable order rather than shuffling between renders.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The Suite MUST present a single top-level control group in Foundry's left scene-control bar that owns all scene-control tools contributed by Suite features.
- **FR-002**: Every Suite feature that currently injects a tool into Foundry's Token Controls group (at minimum: Clocks/Tracker time HUD, tracker dock, weather, and support toggles; Loot Gen auditor/generate/workshop/shop; Minimap studio and viewer; Stage director; Insight) MUST instead contribute its tool(s) to the Suite's top-level group.
- **FR-003**: After this change, no Suite-contributed tool MAY remain in Foundry's Token Controls group.
- **FR-004**: The Suite group MUST carry a recognizable GLUniverse label and icon consistent with the Suite's branding.
- **FR-005**: Each tool's existing action (the dialog it opens or HUD it toggles) MUST be preserved unchanged when moved into the group.
- **FR-006**: Each tool's existing visibility/entitlement rules MUST be preserved — GM-only tools stay GM-only, player-conditional tools (e.g. minimap viewer with an active map) keep their conditions, and sub-feature-gated tools appear only when their sub-feature is enabled.
- **FR-007**: The Suite group MUST NOT be shown when the current user has no available Suite tool to display (no empty group).
- **FR-008**: The group and its tools MUST re-appear correctly on every scene-control re-render (scene switches, layer changes, toggles).
- **FR-009**: The existing reliability behavior for "button"-type tools (firing their action on every click without sticking as the active tool) MUST be preserved within the new group.
- **FR-010**: Adding a future Suite feature's scene-control tool MUST be possible through the same shared grouping mechanism, without that feature having to target Token Controls.
- **FR-011**: Tools within the group MUST follow a stable, predictable ordering across re-renders.
- **FR-012**: The change MUST respect each feature's enabled/disabled state — a disabled feature contributes nothing to the group, consistent with the Suite's "disabled features stay inert" principle.

### Key Entities

- **Suite Control Group**: The single top-level entry in the scene-control bar representing GLUniverse. Has a label, an icon, and an ordered set of member tools; is visible only when it has at least one member tool the current user may use.
- **Suite Tool**: An individual control contributed by a feature (e.g. "Open Insight", "Toggle Time HUD", "Minimap Studio"). Has a name, label, icon, action handler, and visibility/entitlement conditions, and now belongs to the Suite Control Group rather than Token Controls.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: With every control-contributing Suite feature enabled, 100% of the Suite's scene-control tools appear under the single GLUniverse group and 0% remain in Token Controls.
- **SC-002**: Across all tested user roles (GM and player), the set of tools shown in the group exactly matches the set that was previously shown under Token Controls for that same role and feature configuration — no tool gained or lost visibility.
- **SC-003**: When no contributing feature is enabled for a user, the GLUniverse group is not rendered (0 empty groups observed).
- **SC-004**: Every relocated tool triggers its original action successfully on every click in a 10-click repeat test, matching pre-change behavior.
- **SC-005**: A GM can locate any given Suite tool within the single group in one expansion of the GLUniverse control, rather than scanning a mixed Token Controls list.

## Assumptions

- "Left panel control" refers to Foundry's left-hand scene-controls toolbar (`getSceneControlButtons`), not actor-sheet header buttons or other UI; actor-sheet controls such as the Flat Finder Apex button are out of scope.
- The intended target is a new top-level group entry in the scene-control bar (a sibling of Token Controls, Tiles, Notes, etc.), with the Suite's tools as its tools, matching how Foundry models native control groups.
- The set of contributing features is those that currently hook `getSceneControlButtons`: Clocks/Tracker, Loot Gen, Minimap, Stage, and Insight. Any other feature that later adds a scene-control tool is expected to use the same shared mechanism.
- Existing localization key namespaces and tool names/icons are retained; only the parent group changes. A new label/icon is introduced for the group itself under the Suite's existing branding.
- The Suite continues to register controls only under its own package id and follows the existing convention that feature adapters wire hooks inside `onInit`/`onReady`, not at import time.
- Keyboard shortcuts/keybindings for these tools (where they exist) are unaffected by the regrouping.
- No change to the underlying actions, dialogs, sockets, or stored data is intended — this is purely a relocation/consolidation of where the tools live in the control bar.
