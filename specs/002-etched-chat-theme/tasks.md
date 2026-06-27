---
description: "Task list for Etched-Glass Chat Theme (PF2e)"
---

# Tasks: Etched-Glass Chat Theme (PF2e)

**Input**: Design documents from `specs/002-etched-chat-theme/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: This project has **no automated test runner** (Constitution Principle V —
manual validation gates only). No test tasks are generated; validation is the
`quickstart.md` static gates + in-Foundry scenarios, captured in the Polish phase.

**Organization**: Tasks are grouped by user story. Each story is an independently
testable increment. US1 alone is the MVP.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1 / US2 / US3 (maps to spec.md user stories)
- All paths are repo-relative to `gluniverse-foundry-modules/`

## Conventions for this feature

- Feature id `etched-chat`; setting prefix `ec.`; CSS prefix `glec-`; feature i18n
  `GLEC.*`; Control-Center title/hint under `GLS.feature.etched-chat.*` (suite
  convention, mirrors `critical/index.mjs`).
- Adapter MUST register Hooks only in `onInit`/`onReady` (inert when disabled).
- CSS consumes `--gl-*` tokens / `gl-*` keyframes; never redefine tokens.
- No `prefers-reduced-motion` / `matchMedia`. No Dice So Nice coupling. No kill code.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Scaffold the feature files and register them with the suite + Foundry.

- [X] T001 [P] Create `scripts/features/etched-chat/index.mjs` — the adapter calling `Suite.register({ id:"etched-chat", title:"GLS.feature.etched-chat.title", hint:"GLS.feature.etched-chat.hint", icon:"fa-solid fa-gem", settingPrefix:"ec.", system:"pf2e", requires:[], core:false, defaultEnabled:false, registerSettings, onInit, onReady })`, importing those lifecycle fns from `./module.mjs` (mirror `scripts/features/critical/index.mjs`).
- [X] T002 [P] Create `lang/etched-chat.en.json` with a `GLEC.*` scaffold (e.g. `GLEC.aria.fracture`, `GLEC.aria.card` placeholders for any future in-card labels). Valid JSON, distinct namespace.
- [X] T003 [P] Create `styles/etched-chat.css` with a header comment and the canonical-token usage note; no rules yet (scaffold only).
- [X] T004 Register assets in `module.json`: append `"styles/etched-chat.css"` to `styles` and `{ "lang":"en", "name":"English", "path":"lang/etched-chat.en.json" }` to `languages`. Keep JSON valid.
- [X] T005 Add Control-Center strings `GLS.feature.etched-chat.title` and `GLS.feature.etched-chat.hint` to `lang/en.json` (the suite `GLS` namespace, as `critical` does).
- [X] T006 Append `import "./etched-chat/index.mjs";` to `scripts/features/index.mjs` (append = last display position in the Control Center).

**Checkpoint**: Module loads; the feature appears (disabled) in the Control Center; no chat behavior yet.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The shared classification + hook wiring every story builds on. After this
phase, every PF2e card is marked with `.glec-card` + `data-glec-tier` but is **not yet
visually restyled** (no CSS), and disabled-feature inertness holds.

**⚠️ CRITICAL**: No user-story phase can begin until this phase is complete.

- [X] T007 Create `scripts/features/etched-chat/classify.mjs` — implement `classifyMessage(message)` exactly per [contracts/tier-resolution.md](contracts/tier-resolution.md): read `message.flags.pf2e.context.outcome`/`.type`; eligible roll types set; disposition resolution `message.token?.disposition` → `actor.prototypeToken?.disposition` → `0` (neutral), only `-1` (HOSTILE) reverses; dying/wounded from speaker actor (`system.attributes.dying.value` / `condition` items, slugs `dying`/`wounded`); derive `category`; return `{ tier, fracture, category, reason }`. Pure, total, never throws (missing flags ⇒ `baseline`). Reuse `scripts/core/util.mjs` helpers where applicable.
- [X] T008 Create `scripts/features/etched-chat/style.mjs` — `applyStyle(message, html)`: normalize root (`html instanceof HTMLElement ? html : html?.[0]`), guard `game.system.id === "pf2e"`, call `classifyMessage`, stamp `.glec-card`, `data-glec-tier`, `data-glec-frac` (when fractured) and `data-glec-category` on the message root. No visual CSS or FX yet (added in US1/US2). Idempotent on re-render.
- [X] T009 Create `scripts/features/etched-chat/module.mjs` — `registerSettings()` (no extra settings in v1; stub that exists so the toggle resolves), `onInit()` registers `renderChatMessageHTML` **and** legacy `renderChatMessage` → `applyStyle`, plus `createChatMessage` → `freshIds.add(message.id)` (module-scoped `Set`, **no author gate**, fires on every client), `onReady()` reserved for lazy FX init. Provide a teardown path that removes hooks / clears `freshIds` so a disabled feature is fully inert (Principle III, FR-014).

**Checkpoint**: Inspect a posted PF2e card → it carries `.glec-card` + `data-glec-tier`; toggling the feature off removes all markup on next render.

---

## Phase 3: User Story 1 - Unified premium baseline on every card (Priority: P1) 🎯 MVP

**Goal**: Every in-scope PF2e card adopts the Etched-Glass baseline (liquid glass, edge
light, diorama bleed, entrance, hover sheen) and **visually overrides** Dorako's chat
theme.

**Independent Test**: Quickstart Scenario A — with Dorako set to BG3, a posted card is
visibly glass (not BG3); sheets stay Dorako; disabling the feature reverts cards.

- [X] T010 [P] [US1] In `styles/etched-chat.css`, add the `.glec-card` baseline: liquid-glass surface + edge-reflection light built from `--gl-*` tokens and `.gl-glass` vocabulary; establish the scoping wrapper for all subsequent rules.
- [X] T011 [US1] In `styles/etched-chat.css`, add the **Dorako-override specificity layer** per [research.md](research.md) §E: selectors like `.chat-message.glec-card .message-content …` that out-specify Dorako's `[data-theme="…"]` rules, doubled-class (`.glec-card.glec-card`) where Dorako goes deeper, `!important` only as a scoped last resort on hard-pinned background/border properties. (Depends on T010 for the base.)
- [X] T012 [P] [US1] In `styles/etched-chat.css`, add the fast no-bounce **entrance animation** for `.glec-card` using a `gl-*` keyframe + `--gl-ease`/`--gl-d-*` (no `prefers-reduced-motion`).
- [X] T013 [P] [US1] In `styles/etched-chat.css`, add the **hover light-sweep sheen** on interactive buttons inside cards, reusing the `.gl-btn::before` sheen technique.
- [X] T014 [US1] **Diorama portrait bleed**: in `style.mjs` mount a portrait-art layer (image from the card header / `message.speaker` actor img) into `.glec-card`; in `styles/etched-chat.css` add the bleed/mask styling reusing the `clocks-tracker-support.css` diorama pattern (`mask-image` gradients + overflow). Omit the layer gracefully when no art exists (no broken region).
- [X] T015 [P] [US1] In `styles/etched-chat.css`, add category-aware baseline tweaks keyed off `data-glec-category` (check/save, damage, action, item-spell, whisper).

**Checkpoint**: Scenario A passes — MVP shippable.

---

## Phase 4: User Story 2 - Disposition-colored glass fracture (Priority: P2)

**Goal**: Critical cards fracture in the suite's WebGL glass-shatter, colored
gold/red by outcome × disposition (only Hostile reverses), animating once then
settling to a static cracked still.

**Independent Test**: Quickstart Scenario B — friendly crit-success = gold, friendly
crit-failure = red, hostile reversed; ordinary cards never fracture; scrollback /
late-join shows static; stress test stays ≤2 WebGL contexts.

- [X] T016 [US2] Create `scripts/core/fx-glsl.mjs` — move the **pure GLSL primitives** (`FX_FRAG_BREAK`, the Voronoi/noise helpers, the mesh builder, `FX_SUPERSAMPLE`) out of `scripts/features/initiative/gl.mjs` into this dependency-free module. Ensure the crack colors are `uBreakAmber`/`uBreakHot` **uniforms**, not hard-coded constants (parameterize if needed). Per [research.md](research.md) §D.
- [X] T017 [US2] Edit `scripts/features/initiative/gl.mjs` to **re-export** the moved primitives from `../../core/fx-glsl.mjs` (no render-loop change, no behavior change). This touches a shipped feature — keep the diff to re-exports only.
- [X] T018 [US2] Create `scripts/features/etched-chat/fx-card.mjs` — the **feature-local** offscreen PIXI renderer + per-card 2D-canvas blit, per [contracts/fx-surface.md](contracts/fx-surface.md): lazy single renderer with a `supported` flag (mirror initiative CardFXManager), importing `FX_FRAG_BREAK` from `core/fx-glsl.mjs`; `mountAnimated(canvas,{color})` (throttled ~30fps rAF, ~1s window then settle to a static final frame and drop from the loop), `mountStatic`, `unmount`, `destroy`. Never a per-card context.
- [X] T019 [P] [US2] In `fx-card.mjs`, implement the **color→uniform** mapping: `"gold"` → warm amber `uBreakAmber` + white-hot `uBreakHot`; `"red"` → deep red `uBreakAmber` + violet/purple `uBreakHot`.
- [X] T020 [US2] In `style.mjs`, wire the **fracture mount**: for `data-glec-tier` in `{fracture-gold,fracture-red}`, ensure a `<canvas class="glec-fx">` over the card art; if `fxRenderer.supported`, `freshIds.has(id)` ⇒ `mountAnimated` + `freshIds.delete(id)`, else `mountStatic`. Unmount/cleanup on card removal (avoid Map growth). (Depends on T018, T009's `freshIds`.)
- [X] T021 [P] [US2] In `styles/etched-chat.css`, add the fracture-tier **glass accents** (valence-colored glow/halo around the cracked card) keyed off `data-glec-frac="gold|red"`.

**Checkpoint**: Scenario B passes — gold/red fracture with disposition reversal, animate-once, ≤2 contexts.

---

## Phase 5: User Story 3 - Dying sheen + WebGL-off fallback (Priority: P3)

**Goal**: Dying/wounded cards show the dying sheen; when WebGL is unavailable, a
pure-CSS/SVG crack stands in so no styled card is ever broken.

**Independent Test**: Quickstart Scenario C — dying card shows sheen; with WebGL
disabled a critical card shows a CSS crack (no errors); board-closed player still gets
the WebGL effect (renderer is scene-independent).

- [X] T022 [P] [US3] In `styles/etched-chat.css`, add the **dying-sheen** treatment for `data-glec-tier="dying"`, adapting the initiative `gluni-dying-sheen` vocabulary to the card surface.
- [X] T023 [P] [US3] In `styles/etched-chat.css`, add the **CSS/SVG crack fallback** class `.glec-crack-css` for fracture tiers, reusing the initiative `gluni-guard-break-crack-trace` keyframes (valence-colored via `data-glec-frac`).
- [X] T024 [US3] In `style.mjs`, gate on `fxRenderer.supported`: when **false**, apply `.glec-crack-css` to fracture cards instead of mounting the canvas — no console errors, no empty canvas (FR-013, SC-005). (Depends on T020, T023.)

**Checkpoint**: Scenario C passes — dying sheen + graceful WebGL-off fallback.

---

## Phase 6: Polish & Cross-Cutting Validation

**Purpose**: The project's manual validation gates (Constitution V) + quickstart sign-off.

- [X] T025 [P] Static syntax gate: `find scripts -name '*.mjs' -o -name '*.js' | xargs -I{} node --check {}` — must pass, including `core/fx-glsl.mjs`, the edited `initiative/gl.mjs`, and all `etched-chat/*.mjs`.
- [X] T026 [P] JSON gate: validate `module.json` + every `lang/*.json` (incl. the new `lang/etched-chat.en.json` and edited `lang/en.json`); confirm `styles`/`languages` entries point at existing files and every referenced `GLEC.*` / `GLS.feature.etched-chat.*` key resolves.
- [ ] T027 GLSL-extraction regression gate: re-run the **Initiative** card FX in-Foundry (combat, advance turns, trigger guard-break/dying) and confirm it looks identical to before T016/T017.
- [ ] T028 Run quickstart Scenarios A–D in-Foundry: A (baseline + Dorako-BG3 hard override gate + disabled-inert), B (friendly gold/red + hostile reversal + no-disposition default + ordinary=no-fracture + late-join/scrollback static + ≤2 contexts stress of 20+ cards), C (dying sheen + WebGL-off CSS fallback + board-closed still-WebGL), D (non-pf2e inert).
- [X] T029 [P] Compliance sweep: grep the feature for `prefers-reduced-motion`/`matchMedia` (must be absent), confirm no Hooks registered at import time, no Dice So Nice coupling, no kill-detection code, and that a disabled feature adds no `.glec-*` markup.

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (Phase 1)**: no dependencies — start immediately. T001–T003 are [P]; T004–T006 edit shared files (`module.json`, `lang/en.json`, `features/index.mjs`).
- **Foundational (Phase 2)**: depends on Setup. T007 (classify) and T008 (style stamping) before T009 (wiring). **Blocks all user stories.**
- **User Stories (Phase 3–5)**: all depend on Foundational. US1 is independent; US2 and US3 build on the same `style.mjs`/CSS but are separately testable. Recommended order P1 → P2 → P3.
- **Polish (Phase 6)**: after the desired stories are complete.

### User-story dependencies

- **US1 (P1)**: after Foundational. No dependency on US2/US3. **MVP.**
- **US2 (P2)**: after Foundational. Internal order T016 → T017 → T018 → (T019 ‖ T020) → T021. T020 also depends on T009's `freshIds`.
- **US3 (P3)**: after Foundational. T024 depends on T018 (`supported` flag) + T020 + T023. T022/T023 are pure CSS and can be done any time after Foundational.

### Parallel opportunities

- Setup: T001, T002, T003 together.
- US1: T010 first (base), then T012, T013, T015 in parallel; T011 after T010; T014 spans style.mjs + css.
- US2: T019 ‖ T021 once T018 exists.
- US3: T022 ‖ T023 (both pure CSS); T024 after.
- Polish: T025, T026, T029 in parallel; T027/T028 are in-Foundry manual.

---

## Parallel Example: User Story 1

```bash
# After T010 (baseline surface) lands, these touch independent CSS blocks:
Task: "T012 [US1] entrance animation for .glec-card in styles/etched-chat.css"
Task: "T013 [US1] hover light-sweep sheen on card buttons in styles/etched-chat.css"
Task: "T015 [US1] category-aware tweaks keyed off data-glec-category in styles/etched-chat.css"
```

---

## Implementation Strategy

### MVP first (User Story 1 only)

1. Phase 1 Setup → 2. Phase 2 Foundational → 3. Phase 3 US1 → **STOP & validate
   Scenario A** (baseline + Dorako override + disabled-inert). Shippable MVP.

### Incremental delivery

1. Setup + Foundational → cards are marked, no visual change.
2. US1 → Etched-Glass baseline overriding Dorako → demo (MVP).
3. US2 → disposition-colored WebGL fracture → demo.
4. US3 → dying sheen + WebGL-off fallback → demo.
5. Polish → run all gates + quickstart sign-off.

### Notes

- Commit after each task or logical group; run `node --check` on touched scripts as you go.
- The only edit to shipped code is T017 (`initiative/gl.mjs` re-exports) — keep it minimal and gate it with T027.
- Keep `style.mjs` idempotent: re-render must re-apply the marker and mount the **static** fracture (never replay) unless the id is in `freshIds`.
