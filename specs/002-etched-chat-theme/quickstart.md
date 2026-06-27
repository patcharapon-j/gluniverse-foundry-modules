# Quickstart & Validation: Etched-Glass Chat Theme (PF2e)

Run these gates and scenarios before committing. There is no automated test runner;
correctness rests on the static gates (Constitution V) plus the in-Foundry scenarios.

## Static gates (must pass)

```bash
# 1. JS/MJS syntax — every script must pass
find scripts -name '*.mjs' -o -name '*.js' | xargs -I{} node --check {}

# 2. JSON validity — module.json + every lang file (incl. the new one)
for f in module.json lang/*.json; do \
  python3 -c "import json,sys;json.load(open(sys.argv[1]))" "$f"; done
```

Also verify by inspection:
- `module.json` `styles` includes `styles/etched-chat.css` and `languages` includes
  `lang/etched-chat.en.json`, and both files exist.
- `scripts/features/index.mjs` imports `./etched-chat/index.mjs` (display order).
- Every `GLEC.*` key referenced in code exists in `lang/etched-chat.en.json`.
- No `prefers-reduced-motion` / `matchMedia` appears anywhere in the feature.
- The adapter registers no Hooks at import time (only in `onInit`/`onReady`).
- **GLSL extraction gate**: `core/fx-glsl.mjs` exists and `initiative/gl.mjs`
  re-exports `FX_FRAG_BREAK` (+ helpers) from it with no other behavior change; the
  shader keeps its colors as `uBreakAmber`/`uBreakHot` uniforms (not constants).
  Then **re-run the Initiative card FX in-Foundry** (start a combat, advance turns,
  trigger a guard-break/dying card) and confirm it looks identical to before the move.

## Prerequisites for in-Foundry scenarios

- A **PF2e** world with the GLUniverse Suite installed.
- Dorako UI installed and active, with its chat-message theme set to a non-default
  (e.g. BG3) — to prove override.
- At least one combat-capable actor with a portrait, one without a portrait.
- Control Center → enable **Etched-Glass Chat Theme**.

## Scenario A — Baseline on every card + Dorako override (User Story 1 / P1) — HARD GATE

1. With the feature enabled, post an ordinary skill check and a non-lethal damage roll.
2. **Expect**: both cards show `.glec-card` + `data-glec-tier="baseline"`; glass
   surface, edge light, entrance animation; portrait-bearing card shows diorama bleed;
   no-portrait card looks correct (no broken art region).
3. Hover an action/damage button → light-sweep sheen plays.
4. **Expect (override — HARD GATE)**: with Dorako's chat theme set to **BG3**, the card
   is visibly **glass, not BG3** — background, border, header all ours. Any property
   that still reads as BG3 is a **specificity bug to fix before sign-off**, not "close
   enough" (FR-004). Then open a character **sheet** → still Dorako-themed (we touched
   only chat) (FR-005).
5. Toggle the feature **off**, post another card → no `.glec-*` markup, Dorako/default
   styling shows through. (FR-014, SC-002)

## Scenario B — Disposition-colored fracture (User Story 2 / P2)

1. Re-enable.
2. With a **friendly/PC** actor, force a **critical success** on an eligible roll
   (attack/save/skill/perception). **Expect**: gold fracture animates ~1s then freezes
   to a static cracked still; `data-glec-tier="fracture-gold"`, `data-glec-frac="gold"`.
3. Friendly actor **critical failure** → **red/purple** (`fracture-red` / `red`).
4. With a **hostile NPC** (token disposition = Hostile), force a **critical success**
   → color **reversed** to **red/purple** (bad for party).
5. Hostile NPC **critical failure** → color **reversed** to **gold** (good for party).
6. A crit card with **no resolvable token/disposition** (GM roll, no speaker token)
   → treated as neutral: success = gold, failure = red. (FR-010a)
7. Post an ordinary (non-critical) success and failure. **Expect**: NO fracture.
   (SC-003)
8. Scroll the fractured cards out of view and back. **Expect**: static cracked still,
   **no animation replay**. (FR-017) Then have a **second client join late** / reload
   → historical crits show static, do **not** replay.
9. Rapidly post 20+ cards including several fractures. **Expect**: chat stays
   scrollable/interactive; no crash/freeze; DevTools shows at most **two** WebGL
   contexts for the client (initiative + etched-chat) — **never one-per-card**. (SC-006)

## Scenario C — Dying sheen + WebGL-off fallback (User Story 3 / P3)

1. Apply the **dying** (or wounded) condition to an actor and post a related card.
   **Expect**: dying sheen; `data-glec-tier="dying"`. (FR-011, SC-004)
2. Simulate **WebGL unavailable** (e.g. disable WebGL in the browser, or stub the
   renderer `supported=false`). Trigger a crit-failure. **Expect**: CSS/SVG crack
   appears in place of the shader; no console errors; card not empty/broken.
   (FR-013, SC-005)
3. As a **player** with the game board closed / no scene loaded (viewing chat only),
   receive a fracture card. **Expect**: the **WebGL effect still renders** — the
   feature-local renderer is scene-independent (Research C); only an actual WebGL
   failure falls back to the CSS crack. (User Story 3 #3)

## Scenario D — System gate (SC-007)

1. Load a **non-pf2e** world (e.g. dnd5e) with the suite installed.
2. **Expect**: the Etched-Glass Chat Theme does not activate; chat cards render
   normally; the feature shows as system-locked in the Control Center.

## Sign-off checklist

- [ ] Static gates pass (`node --check`, JSON valid); GLSL-extraction gate + initiative
      card-FX still looks identical.
- [ ] Scenario A (HARD GATE): baseline + Dorako-BG3 override wins + disabled-inert.
- [ ] Scenario B: friendly gold/red + hostile reversal + no-disposition default +
      no-fracture on ordinary + re-render/late-join static + stress test ≤2 contexts.
- [ ] Scenario C: dying sheen + WebGL-off CSS fallback + board-closed still WebGL.
- [ ] Scenario D: non-pf2e inert.
- [ ] No `prefers-reduced-motion`/`matchMedia` added; no import-time hooks; no DSN
      coupling; no kill-detection code.
