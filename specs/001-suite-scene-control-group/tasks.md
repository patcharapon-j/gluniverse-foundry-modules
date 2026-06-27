---
description: "Task list for Suite Scene Control Group"
---

# Tasks: Suite Scene Control Group

**Input**: Design documents from `specs/001-suite-scene-control-group/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/scene-controls.md, quickstart.md

**Tests**: No automated tests. This project has no test runner (constitution Principle V);
validation is manual via `node --check`, JSON validity, and the in-Foundry scenarios in
[quickstart.md](quickstart.md). "Validation" tasks below run those gates.

**Organization**: Tasks are grouped by user story so each story is an independently
verifiable increment. Note: US1 relocates tools and preserves gating in the *same* edits;
US2 and US3 mostly add guarantees and verification on top of US1's edited files.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- File paths are relative to repo root `C:\Users\frostnoxia\AppData\Local\FoundryVTT\Data\modules\gluniverse-foundry-modules\`

## Path Conventions

Single installed Foundry package (zero build). Source under `scripts/`, strings under
`lang/`. No `src/`/`tests/` split.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: One-time strings/branding the group needs.

- [X] T001 [P] Add the group label key `GLS.controls.suiteGroup` (value `"GLUniverse"`) to `lang/en.json`, placed near the other `GLS.config.*`/`GLS.*` suite-level keys.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The shared core helper every feature adapter depends on. Per
[contracts/scene-controls.md](contracts/scene-controls.md).

**⚠️ CRITICAL**: No user-story work can begin until this phase is complete — all five
adapters import from this module.

- [X] T002 Create `scripts/core/scene-controls.mjs` and implement `ensureSuiteGroup(controls)`: idempotently create/return `controls.gluniverse` with `name:"gluniverse"`, `title:"GLS.controls.suiteGroup"`, `icon:"fa-solid fa-meteor"`, `tools:{}`, a stable `order`, `visible:true`; return the existing object on repeat calls without clobbering accumulated `tools`. Must not touch `controls.tokens`. Import `SUITE_ID`/helpers from `scripts/core/const.mjs` as needed; keep no import-time side effects.
- [X] T003 In `scripts/core/scene-controls.mjs`, add `pruneEmptySuiteGroup(controls)` that deletes `controls.gluniverse` when its `tools` map is empty (fallback for the no-empty-group guarantee).
- [X] T004 In `scripts/core/scene-controls.mjs`, add `bindSuiteToolClicks(html, toolNames)` generalizing the per-render click rebind currently in `insight.mjs` (find `[data-tool="<name>"]`, attach a click→action listener once, guarded by a `dataset` flag).
- [X] T005 Validate the new module: `node --check scripts/core/scene-controls.mjs` and confirm `lang/en.json` is valid JSON.

**Checkpoint**: Shared helper exists and parses — adapter relocation can begin.

---

## Phase 3: User Story 1 - Suite tools live under one dedicated control group (Priority: P1) 🎯 MVP

**Goal**: Every suite scene-control tool renders under one top-level **GLUniverse** group
instead of inside Foundry's Token Controls; actions and gating preserved.

**Independent Test**: As GM with the five features enabled, the GLUniverse group appears
with all suite tools and Token Controls holds none of them (quickstart Scenario A); every
tool performs its original action (Scenario B).

**Note**: Each adapter is a different file, so the five relocation tasks are `[P]`. Within
each, keep the *exact* existing tool objects (name/title/icon/`onChange`) and the existing
role/sub-feature conditionals — only swap the target group from
`controls.tokens` to `ensureSuiteGroup(controls)`, and call `ensureSuiteGroup` only inside
the branches that actually add a tool.

- [X] T006 [P] [US1] `scripts/features/clocks-tracker/module.js` — in `onGetSceneControlButtons`, replace `const group = controls.tokens ?? …` with `import { ensureSuiteGroup } from "../../core/scene-controls.mjs"` and call `ensureSuiteGroup(controls)` inside each enabled-branch (`timeHud`, `trackers.dock`, weather, support, delving) so each of `glct-toggle`/`glct-tracker-toggle`/`glct-weather-toggle`/`glct-support-toggle`/`glct-delving-toggle` lands in the suite group; keep all existing gating.
- [X] T007 [P] [US1] `scripts/features/loot-gen/module.js` — in the `getSceneControlButtons` handler, import and use `ensureSuiteGroup(controls)` (inside the existing `game.user.isGM` guard) for `gllg-auditor`/`gllg-generate`/`gllg-workshop`/`gllg-shop`; remove the `controls.tokens ?? …` fallback group.
- [X] T008 [P] [US1] `scripts/features/minimap/index.mjs` — in `onGetSceneControlButtons`, use `ensureSuiteGroup(controls)` for `glmm-studio` (GM) and `glmm-viewer` (GM, and the player+active-map branch); preserve the role/active-map conditions and the existing `order` handling.
- [X] T009 [P] [US1] `scripts/features/stage/module.js` — in the `getSceneControlButtons` handler, use `ensureSuiteGroup(controls)` (inside the `game.user.isGM` guard) for `gluniverseStage`; remove the `controls.tokens` target.
- [X] T010 [P] [US1] `scripts/features/insight/insight.mjs` — in the `getSceneControlButtons` handler, use `ensureSuiteGroup(controls)` (inside the `game.user.isGM` guard) for `insight`; leave the `renderSceneControls` click-rebind in place for now (revisited in US3).
- [X] T011 [US1] Validate syntax across all touched adapters: `node --check` on `scripts/features/{clocks-tracker/module.js,loot-gen/module.js,minimap/index.mjs,stage/module.js,insight/insight.mjs}`; grep the suite for any remaining `controls.tokens` writes of suite tools and confirm none remain (FR-003).
- [X] T012 [US1] Run quickstart **Scenario A** (single group, all tools relocated, none left in Token Controls) and **Scenario B** (each tool's action unchanged) as GM in Foundry.

**Checkpoint**: MVP — all suite tools appear under the GLUniverse group with original behavior.

---

## Phase 4: User Story 2 - Per-tool/feature gating preserved & no empty group (Priority: P2)

**Goal**: The group shows only the tools the current user is entitled to, and never renders
as an empty shell.

**Independent Test**: A non-GM player with an active minimap sees the group with only the
viewer; with no contributing feature enabled (or no entitlement) the group does not appear
(quickstart Scenarios C & D).

- [X] T013 [US2] Audit the five adapters (edited in T006–T010) to confirm `ensureSuiteGroup(controls)` is called **only** inside branches that add a tool (gate-then-ensure), so an empty group is never created for a user with no available tool. Adjust any adapter that calls it too early.
- [X] T014 [US2] Guarantee no-empty-group as a safety net: register a single core `getSceneControlButtons` handler (e.g. wired once in `scripts/main.mjs` core init) that runs `pruneEmptySuiteGroup(controls)` after feature handlers, OR document that the gate-then-ensure pattern from T013 makes prune unnecessary; if wired, ensure registration order puts it last. `node --check` any file touched.
- [X] T015 [US2] Run quickstart **Scenario C** (non-GM + active map → viewer-only; weather sub-feature off → weather tool absent) and **Scenario D** (no contributing feature → no group) in Foundry.

**Checkpoint**: Visibility matches pre-change behavior per role; no empty group ever shows.

---

## Phase 5: User Story 3 - Survives re-render; click reliability & stable order (Priority: P3)

**Goal**: The group and its tools reappear correctly on every scene-controls re-render,
button tools fire on every click, and tool order is deterministic.

**Independent Test**: After scene/layer switches the group still lists all tools in stable
order; repeated clicks on a button tool (e.g. Insight) fire every time (quickstart
Scenario E).

- [X] T016 [US3] Click reliability: either migrate `scripts/features/insight/insight.mjs` to the shared `bindSuiteToolClicks(html, ["insight"])` in its `renderSceneControls` hook, or confirm the existing rebind still resolves `[data-tool="insight"]` under the new group; ensure every `button` suite tool fires its action on each click (FR-009).
- [X] T017 [US3] Assign a stable `order` to each suite tool within the group across the five adapters so the group's tool order is deterministic across re-renders (FR-011); `node --check` touched files.
- [X] T018 [US3] Run quickstart **Scenario E** on both Foundry **v13 and v14**: switch scenes/toggle layers, confirm all tools persist in order, and confirm selecting the layerless group throws no console error (research Decision 4); if a build requires a `layer`, apply the documented fallback (reuse `tokens` layer reference without moving tools back).

**Checkpoint**: Robust across re-renders and Foundry versions.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T019 [P] Document the new shared mechanism: add a short note to `docs/FEATURE_CONTRACT.md` that scene-control tools must go through `ensureSuiteGroup(controls)` (so future features join the GLUniverse group, FR-010).
- [X] T020 Run the full static validation gates: `find scripts -name '*.mjs' -o -name '*.js' | xargs -I{} node --check {}` and JSON validation on `module.json` + every `lang/*.json`; confirm `GLS.controls.suiteGroup` resolves.
- [X] T021 Final end-to-end pass of [quickstart.md](quickstart.md) Scenarios A–E and confirm Success Criteria SC-001…SC-005 hold.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately (T001 is independent of the helper).
- **Foundational (Phase 2)**: T002→T003→T004 are the **same file** (sequential), then T005. BLOCKS all user stories (every adapter imports `ensureSuiteGroup`).
- **US1 (Phase 3)**: Depends on Phase 2. T006–T010 are parallel (different files); T011 then T012 after them.
- **US2 (Phase 4)**: Depends on US1 edits existing (operates on the same five files) + T003. T013→T014→T015.
- **US3 (Phase 5)**: Depends on US1 (and benefits from T004). T016/T017 then T018.
- **Polish (Phase 6)**: After US1–US3.

### User Story Dependencies

- **US1 (P1)**: The MVP. Needs only Phase 2.
- **US2 (P2)**: Refines/verifies the same adapter files US1 edits — sequence after US1 to avoid same-file conflicts.
- **US3 (P3)**: Adds click/order guarantees on top of US1 — sequence after US1.

### Within Each Story

- Relocate tool (US1) → preserve gating (verified US2) → reliability/order (US3).
- Run `node --check` before the in-Foundry validation task of each story.

### Parallel Opportunities

- T001 (Setup) runs parallel to nothing-blocking; it's independent of Phase 2.
- **US1 T006–T010 are the main parallel batch** — five different feature files, no shared edits.
- T019 (docs) can run parallel to other polish work.
- US2 and US3 are *not* parallel to US1 (they touch the same five files).

---

## Parallel Example: User Story 1

```text
# After Phase 2 completes, relocate all five adapters in parallel (different files):
Task: "clocks-tracker/module.js → ensureSuiteGroup"   (T006)
Task: "loot-gen/module.js → ensureSuiteGroup"          (T007)
Task: "minimap/index.mjs → ensureSuiteGroup"           (T008)
Task: "stage/module.js → ensureSuiteGroup"             (T009)
Task: "insight/insight.mjs → ensureSuiteGroup"         (T010)
# Then T011 (node --check + grep) and T012 (in-Foundry Scenarios A/B).
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1: Setup (T001 lang key).
2. Phase 2: Foundational (T002–T005 core helper) — **blocks everything**.
3. Phase 3: US1 (T006–T012) — relocate all tools.
4. **STOP and VALIDATE**: quickstart Scenarios A & B. This is a shippable improvement.

### Incremental Delivery

1. Setup + Foundational → helper ready.
2. US1 → single group with all tools (MVP) → validate → demo.
3. US2 → gating + no-empty-group guarantee → validate.
4. US3 → click reliability + stable order + v13/v14 check → validate.
5. Polish → docs + full gates.

---

## Notes

- [P] = different files, no dependencies. The Phase 2 helper tasks (T002–T004) share one
  file and are therefore sequential, not [P].
- No test tasks: there is no test runner; validation tasks invoke `node --check`, JSON
  checks, and the in-Foundry quickstart scenarios (constitution Principle V).
- Do not rename any existing tool `name`/`title`/icon or CSS/i18n namespace (constitution
  Principle IV) — only the parent group changes.
- Keep adapter hook wiring inside `onInit` (no import-time side effects; Principle III).
- Commit after each task or logical group.
