# Quickstart / Validation Guide: Suite Scene Control Group

This feature has no automated test runner (constitution Principle V). Validate with the
manual syntax/JSON gates plus in-Foundry checks.

## Prerequisites

- Foundry VTT v13+ (also verify v14) with `gluniverse-foundry-modules` loaded as the
  installed module (the repo IS the module).
- A test world where you can log in as both a GM and a non-GM player.

## Static validation gates (run before committing)

```bash
# 1) JS/MJS syntax — every script must pass
find scripts -name '*.mjs' -o -name '*.js' | xargs -I{} node --check {}

# 2) JSON validity — module.json + every lang file (en.json gets the new group key)
for f in module.json lang/*.json; do python3 -c "import json,sys;json.load(open(sys.argv[1]))" "$f"; done
```

Also confirm the new lang key `GLS.controls.suiteGroup` resolves and that
`scripts/core/scene-controls.mjs` is reachable from the feature adapters that import it.

## In-Foundry validation scenarios

Map to spec user stories / requirements.

### Scenario A — Single group, all tools relocated (US1 / FR-001..FR-003)
1. Enable Clocks/Tracker, Loot Gen, Minimap, Stage, and Insight in the Control Center.
2. Reload; log in as GM; open the scene controls (left bar).
3. **Expect**: one new top-level **GLUniverse** group button appears.
4. Select it. **Expect**: it contains the time HUD, tracker, weather, support, delving,
   loot auditor/generate/workshop/shop, minimap studio/viewer, stage director, and
   insight tools.
5. Open **Token Controls**. **Expect**: no GLUniverse tools remain there.

### Scenario B — Actions unchanged (US1 / FR-005, FR-009)
1. Click each relocated tool. **Expect**: it opens the same dialog / toggles the same
   HUD as before the change.
2. Click a button tool (e.g. Insight) twice in a row. **Expect**: it fires both times
   (no sticking).

### Scenario C — Gating preserved (US2 / FR-006, FR-012)
1. As a non-GM player on a scene **with** an active minimap map: open scene controls.
   **Expect**: the GLUniverse group shows **only** the minimap viewer; GM-only tools
   are absent.
2. Disable the Weather sub-feature; reload as GM. **Expect**: the weather tool is gone,
   other Clocks/Tracker tools remain.

### Scenario D — No empty group (US2 / FR-007)
1. Disable every control-contributing feature (or log in as a player with no available
   tool). **Expect**: the GLUniverse group does **not** appear at all.

### Scenario E — Survives re-render (US3 / FR-008, FR-011)
1. Switch scenes and toggle canvas layers several times.
2. Reopen the GLUniverse group. **Expect**: all expected tools are present, in the same
   stable order, and functional.
3. Confirm no console errors when selecting the group (layer check — research Decision 4),
   on both v13 and v14.

## Done / acceptance

- All static gates pass.
- Scenarios A–E behave as described on v13 and v14.
- 100% of suite scene-control tools are under the GLUniverse group; 0% in Token Controls
  (SC-001), with no visibility changes per role (SC-002) and no empty group (SC-003).

References: [contracts/scene-controls.md](contracts/scene-controls.md),
[data-model.md](data-model.md), [spec.md](spec.md).
