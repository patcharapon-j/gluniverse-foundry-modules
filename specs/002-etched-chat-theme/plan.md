# Implementation Plan: Etched-Glass Chat Theme (PF2e)

**Branch**: `002-etched-chat-theme` | **Date**: 2026-06-27 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/002-etched-chat-theme/spec.md`

## Summary

> **v2 overhaul (folded in):** The feature no longer restyles PF2e/Dorako markup in
> place. It now **reconstructs** each card into the suite's own "Dossier" layout by
> **reparenting PF2e's live functional nodes into named scaffold slots** — the real
> buttons, dice subtrees, inline rolls, and damage-application section are *moved, not
> cloned or re-rendered*, so every existing handler keeps working (FR-018). A new
> `layout.mjs` builds the scaffold per **Card Archetype** (roll-d20 / damage / content /
> plain / manual). `classify.mjs` is extended to resolve the archetype and a four-valued
> **Degree-of-Success** in addition to fracture/visibility/category, and `style.mjs`
> becomes the orchestrator (classify → layout → fx → badges). On d20 rolls a four-color
> **verdict bar** is shown on *every* roll (gold/green/amber/red); damage cards get a
> hero total + per-type colored chips (fixing grey physical damage at the source); the
> WebGL fracture is **re-anchored** to burst from the verdict-bar band (was top-right).
> Owning the layout *replaces* most v1 specificity-override CSS; only targeted overrides
> for the reparented inner dice nodes remain. Everything below from v1 — feature-local
> WebGL FX, disposition-driven gold/red valence, dying tier, Dorako-independence,
> inert-when-disabled, visibility badge — is retained.

A new toggleable suite feature (`etched-chat`) restyles PF2e chat cards in the
Etched Glass aesthetic and renders the suite's signature glass-fracture effect on
critical cards. It is self-contained — it stamps its **own** marker
(`.glec-card` + `data-glec-tier`) on each message root via a `renderChatMessageHTML`
hook and ships CSS built from `--gl-*` tokens, with no coupling to (and no
dependency on) Dorako UI. **`renderChatMessageHTML` is the sole classifier**: it
resolves the **treatment tier** (baseline / gold-fracture / red-purple-fracture /
dying) from `message.flags.pf2e.context.outcome`, the rolling actor's **disposition**
(only `HOSTILE` reverses the gold/red valence), and dying/wounded condition state,
reusing the `critical` feature's detection paths. A lightweight `createChatMessage`
hook does **one** thing — add the message id to an in-memory `freshIds` set on every
client — so the renderer animates a fracture **once** when it is live and shows the
**static** cracked still on scrollback/late-join. The fracture reuses the initiative
tracker's proven FX pipeline: a **feature-local** offscreen PIXI renderer runs
`FX_FRAG_BREAK` (its pure GLSL extracted to `core/fx-glsl.mjs`, shared with
initiative by re-export), blitted (`ctx.drawImage(renderer.view, …)`) to a per-card
2D `<canvas>` — never a WebGL context per card — recolored gold vs red/purple via the
shader's `uBreakAmber`/`uBreakHot` uniforms. When WebGL is unavailable, a pure-CSS/SVG
crack (the existing `gluni-…-crack` keyframes) is the guaranteed floor. Kill/0-HP
detection is deferred (no reliable card-linked signal); gold is driven by critical
**success**.

## Technical Context

**Language/Version**: JavaScript, native ES modules (`.mjs`/`.js`), no transpilation.

**Primary Dependencies**: Foundry VTT v13+ (verified v14) — `renderChatMessageHTML`
(+ legacy `renderChatMessage`) and `createChatMessage` hooks; PIXI (runtime global)
for the FX renderer; the PF2e system's chat-message flags. No new third-party deps.

**Storage**: None persisted beyond the world-scoped enable toggle (`ec.` prefix,
routed via the suite's existing `moduleConfig`). Per-card tier is derived at render
time; the one-shot-vs-static animation state is tracked in-memory (a `WeakSet`/`Map`
keyed by message id), never persisted.

**Testing**: Manual gates only (no runner) — `node --check` on every script, JSON
validation on `module.json` + `lang/*.json`, plus in-Foundry scenarios in
[quickstart.md](quickstart.md).

**Target Platform**: Foundry VTT v13+/v14, client-side, PF2e system only.

**Project Type**: Single installed Foundry package (zero build; repo is the artifact).

**Performance Goals**: Baseline styling is pure CSS (imperceptible). The fracture
animates ~1s at a throttled ~30fps, then settles to a static blit; one shared WebGL
context for the whole client regardless of card count.

**Constraints**: No build step; register only under `gluniverse-foundry-modules`; no
import-time side effects in the adapter; preserve i18n/CSS namespaces (`GLEC.*`,
`glec-`); animations always play (no `prefers-reduced-motion` / `matchMedia`); reuse
`--gl-*` tokens and `gl-*` keyframes; reuse `core/util.mjs` helpers.

**Scale/Scope**: 1 new feature adapter (+ supporting module files), 1 new CSS file,
1 new lang file, 1 shared FX-core extraction (optional, see Research D), edits to
`features/index.mjs` + `module.json` + `CLAUDE.md`. ~4 treatment tiers, ~6 PF2e
card categories.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Single-Package Namespace Discipline | PASS | Setting prefix `ec.` declared as `settingPrefix`; flags (animation-state none persisted); CSS `glec-`; i18n `GLEC.*`; all under `SUITE_ID`. No new package id. No `game.socket` use (feature is render-local, no cross-client payloads). |
| II. Zero-Build, Source-Is-The-Artifact | PASS | Plain `.mjs` + `.css`; new files added to `esmodules` graph via `features/index.mjs` and to `module.json` `styles`/`languages`. No bundler. |
| III. Feature Isolation & Inert-When-Disabled | PASS | Adapter registers settings unconditionally; the two chat hooks + the FX renderer are created ONLY in `onInit`/`onReady`. Disabled → no hooks, no scaffold, no marker, no CSS effect (CSS keys off `.glec-card`, which is only added when enabled), no renderer. **v2:** reparenting only happens inside the enabled render hook; disabled → PF2e's native DOM is never touched, never moved. |
| IV. Canonical Design System & Localization | PASS | Consumes `--gl-*` tokens / `gl-*` keyframes (incl. `--gl-signal`, `--gl-good`, `--gl-hazard`, `--gl-violet`, `--gl-cyan` for the v2 verdict/trait/plain colors); defines only feature-scoped aliases. All strings via `game.i18n` under `GLEC.*`. No renames. Does NOT localize pf2e parse tokens, trait values, or stored data (outcome/trait slugs are read, not relocalized). |
| V. Manual Validation Gates (NON-NEGOTIABLE) | PASS | `node --check` + JSON validation + quickstart scenarios documented; `module.json` lists verified to point at existing files. **v2 adds a non-negotiable gate:** reparenting MUST preserve handlers — every reparented affordance (apply-damage Full/Half/Double/Heal, set-as-initiative, inline rolls, item links, clickable save/DC strip) is click-tested after styling AND after a forced re-render (SC-008). |

**Initial gate**: PASS — no violations; Complexity Tracking not required.

**Post-design re-check** (after Phase 1, grill-plan resolved): PASS. The cross-feature
concern is handled the constitution-clean way — extract only **pure GLSL data** into
`core/fx-glsl.mjs` (dependency-free, side-effect-free) and re-export from
`initiative/gl.mjs`; each feature keeps its own renderer. This avoids a feature→feature
import (Principle III) and avoids destabilizing initiative. The `initiative/gl.mjs`
edit is a pure-data re-export, covered by `node --check` and an explicit quickstart
gate. No principle is stressed; Complexity Tracking omitted.

**v2 overhaul re-check**: PASS. The reconstruction adds `layout.mjs` but introduces no
new package id, no new dependency, and no build step — it is plain `.mjs` reparenting
the DOM the same render hook already touches (Principles I, II hold). The only genuinely
new risk is to Principle V / III: because v2 *moves* live PF2e nodes instead of restyling
them in place, a careless reparent could orphan an event handler. This is mitigated by
contract (move-not-recreate, `contracts/layout-scaffold.md`) and **gated by validation**
(SC-008 click-test after style + re-render, called out as a NON-NEGOTIABLE gate above).
Owning the layout also *reduces* CSS specificity-war complexity vs v1. Complexity
Tracking still omitted — no principle deviation, only a sharpened validation gate.

## Project Structure

### Documentation (this feature)

```text
specs/002-etched-chat-theme/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   ├── tier-resolution.md   # message → Treatment Tier (+ color) + Card Archetype + Degree-of-Success
│   ├── fx-surface.md        # The shared FX renderer + per-card canvas mount contract (impact re-anchored)
│   └── layout-scaffold.md   # NEW (v2): scaffold slot set + reparenting contract (move-not-recreate)
└── checklists/
    └── requirements.md  # From /speckit-specify
```

### Source Code (repository root)

```text
scripts/
  features/
    etched-chat/
      index.mjs            # NEW: Suite.register({ id:"etched-chat", system:"pf2e", settingPrefix:"ec." })
      module.mjs           # NEW: registerSettings/onInit/onReady; wires renderChatMessageHTML (+legacy)
                           #   as sole classifier + createChatMessage (freshIds marker only)
      classify.mjs         # message → TreatmentTier (+ fracture color via outcome+disposition).
                           #   Pure wrt message + live actor state. NO kill branch (deferred).
                           #   EXTENDED (v2): also resolves a Card Archetype (roll-d20 / damage /
                           #   content / IC / OOC / emote / manual / system) AND a four-valued
                           #   Degree-of-Success (criticalSuccess/success/failure/criticalFailure),
                           #   in addition to the existing fracture/visibility/category outputs.
      layout.mjs           # NEW (v2): builds the "Dossier" scaffold and REPARENTS PF2e's live
                           #   nodes (buttons, dice subtrees, inline rolls, damage-apply section)
                           #   into named slots — moved, not cloned. Per-archetype assembly for
                           #   roll-d20 / damage / content / plain / manual. Idempotent + re-render-
                           #   safe (re-acquire + re-slot). Omits a slot when its source node is
                           #   absent. See contracts/layout-scaffold.md.
      style.mjs            # renderChatMessageHTML handler. ORCHESTRATOR (v2): classify → layout
                           #   (build scaffold + reparent) → fx (fracture/dying) → badges
                           #   (visibility / d20 chip). Idempotent on re-render.
      fx-card.mjs          # feature-local PIXI renderer + per-card 2D-canvas blit/animate/settle.
                           #   v2: impact origin RE-ANCHORED to the verdict-bar band (was top-right).
      frame.mjs            # per-actor diorama portrait framing (object-position + zoom) for the rail
    initiative/
      gl.mjs               # EDIT: re-export the GLSL primitives now living in core/fx-glsl.mjs
                           #   (FX_FRAG_BREAK, noise/Voronoi helpers, mesh builder) — no loop changes
      gluniverse-initiative.mjs  # (reference: CardFXManager blit lifecycle to mirror — not edited)
    index.mjs              # EDIT: append `import "./etched-chat/index.mjs";`
  core/
    fx-glsl.mjs            # NEW (Research D): pure, dependency-free GLSL primitives (the crack
                           #   shader + helpers) so initiative + etched-chat single-source the
                           #   geometry. Each feature owns its OWN renderer (2 contexts total, never
                           #   per-card). No renderer/loop code here.
styles/
  etched-chat.css          # glec- baseline glass, diorama bleed, hover sheen, fracture/dying tiers.
                           #   v2: GAINS the scaffold grid (Dossier two-column + art-rail collapse),
                           #   verdict bar (four-color), damage hero + type chips, save/DC strip,
                           #   meta line, header zone (cost pips/name/subtitle), trait-rarity colors,
                           #   plain-message (IC/OOC/emote), and manual-readout sections. Most v1
                           #   specificity-override CSS is REPLACED by owning the layout; only targeted
                           #   overrides for the reparented inner dice nodes are retained.
lang/
  etched-chat.en.json      # NEW: GLEC.* (feature title/hint, setting labels)
module.json                # EDIT: add styles/etched-chat.css + lang/etched-chat.en.json
CLAUDE.md                  # EDIT: SPECKIT block → point at this plan
```

**Structure Decision**: Standard suite feature layout under
`scripts/features/etched-chat/`, split into single-responsibility modules
(adapter / settings+wiring / classify / **layout** / style-orchestrator / fx / frame).
The v2 overhaul adds `layout.mjs` as the scaffold builder + reparenter; `style.mjs`
becomes a thin orchestrator (classify → layout → fx → badges) so each concern stays
single-responsibility and `classify.mjs` remains pure (it gains archetype +
degree-of-success resolution but still performs no DOM work). The only cross-feature concern
is the crack shader: rather than share a renderer (which would risk regressing
initiative's tuned CardFXManager), only the **pure GLSL primitives** are lifted into
`core/fx-glsl.mjs` and re-exported from `initiative/gl.mjs`. Each feature owns its own
renderer (two WebGL contexts total, never per-card). The only edit to a shipped
feature is turning `initiative/gl.mjs`'s local shader consts into re-exports — a
pure-data move gated in quickstart.

## Phase 0 — Research

See [research.md](research.md). Key decisions (★ = revised/resolved in grill-plan):
1. ★ **One classifier, two roles** (Research A): `renderChatMessageHTML` is the SOLE
   classifier + styler (fires on every client, every render → satisfies FR-017);
   `createChatMessage` only adds the id to an in-memory `freshIds` set (on every
   client — it is NOT author-only) so the renderer animates-once when live and shows
   the static still on scrollback/late-join. No author gate.
2. **Tier source of truth**: `message.flags.pf2e.context.outcome`
   (`criticalSuccess`/`criticalFailure`) for fracture; dying/wounded from the speaker
   actor's condition data (`actor.system.attributes.dying.value` / condition items),
   read live.
3. ★ **Disposition decides color** (Research B): token-first
   (`message.token?.disposition` → prototype-token → default neutral); **only
   `HOSTILE` reverses** gold↔red. Friendly/neutral/secret keep the base mapping.
4. ★ **Kill (0 HP) detection deferred** (Research B): no reliable card-linked signal;
   `classify.mjs` has no kill branch. Gold = critical success (disposition-adjusted).
5. **FX pipeline**: reuse initiative's proven **offscreen PIXI renderer → 2D-canvas
   blit** mechanism, NOT `canvas.app.renderer`. Renderer is scene-independent, so the
   only fallback trigger is "WebGL unavailable / renderer init failed" (not "no
   scene").
6. **Fracture color** via shader `uBreakAmber`/`uBreakHot` uniforms: gold = positive
   valence, deep red/purple = negative valence (after disposition adjustment).
7. ★ **Renderer ownership** (Research D): **feature-local** renderer; share only the
   **pure GLSL** via `core/fx-glsl.mjs` (initiative re-exports). Two contexts total,
   zero initiative-regression risk. (Flipped from the earlier "shared renderer".)
8. ★ **Dorako override is by specificity, not load order** (Research E): selectors
   must out-specify Dorako; `!important` only as a scoped last resort; Scenario A is a
   hard visual gate. **No DSN coupling** in v1 (Research G). *(v2: largely superseded as
   the primary mechanism — owning the layout replaces most override CSS; see Research H.)*
9. ☆ **v2 overhaul decisions** (Research H–O): render strategy = **reparent live nodes**
   into a Dossier scaffold (H); slot model + art-rail collapse (I); degree-of-success
   **verdict bar on every d20 roll** in a four-color language + keep the d20 face chip
   (J); **damage hero + type chips** that fix grey physical damage at the source (K);
   the **Card Archetype matrix** and slot mapping (L); **rarity-aware** trait colors (M);
   fracture **re-anchored to the verdict bar** (N); independent `/r` **minimal readout**,
   nat-chip-only glow, no verdict/no fracture (O).

## Phase 1 — Design & Contracts

- **Data model**: [data-model.md](data-model.md) — Styled Chat Card, Treatment Tier
  (state machine: one tier + one fracture color per card), Signature-Moment Signal,
  Render Capability State. In-memory only; no persistence beyond the enable toggle.
- **Contracts**:
  - [contracts/tier-resolution.md](contracts/tier-resolution.md) — deterministic
    message → single tier (+ fracture color via outcome × disposition; only HOSTILE
    reverses; FR-010 / FR-010a).
  - [contracts/fx-surface.md](contracts/fx-surface.md) — the shared FX renderer
    interface and the per-card canvas mount/animate/settle/teardown contract; v2:
    impact origin re-anchored to the verdict-bar band (FR-030).
  - [contracts/layout-scaffold.md](contracts/layout-scaffold.md) — **v2**: the Dossier
    slot set, the per-archetype reparenting map (which PF2e source node → which slot),
    idempotency / re-render re-slotting, the move-not-recreate handler-preservation
    guarantee, and graceful slot omission when a source node is absent (FR-018, FR-019).
- **Quickstart**: [quickstart.md](quickstart.md) — static gates + in-Foundry
  scenarios covering all three user stories incl. the WebGL-off fallback.
- **Agent context**: `CLAUDE.md` SPECKIT block updated to point at this plan.

## Complexity Tracking

No constitution violations — table intentionally omitted. The single judgment call
(shared vs feature-local FX renderer) is captured in Research D with an explicit
fallback, not a principle deviation.
