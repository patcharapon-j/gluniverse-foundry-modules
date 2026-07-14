# GLUniverse Suite — Feature Adapter Contract

Every standalone module is ported into `scripts/features/<featureId>/` and exposes
a single adapter at `scripts/features/<featureId>/index.mjs` that registers itself
with the suite registry. This document is the binding contract for that port.

## The single installed package

- Package id: **`gluniverse-foundry-modules`** (constant `SUITE_ID`).
- Only this id may be used as a settings namespace, flag scope, or socket channel.
- Install path of any bundled asset/template: `modules/gluniverse-foundry-modules/...`.
- A feature's own files live under `modules/gluniverse-foundry-modules/features/<featureId>/...`.

## Namespace rewrite rules (apply inside the ported feature code)

1. **Settings** — register under `SUITE_ID`, never the old id. To avoid key
   collisions between features, **prefix every setting key** with the feature's
   short prefix, e.g. `pf2e-flatfinder`'s `competenceBadge` → key
   `ff.competenceBadge`. Update every `game.settings.get/set/register/registerMenu`
   call accordingly. **Declare that same prefix as `settingPrefix` in the
   adapter** (below) so the Control Center routes every one of the feature's
   settings/menus into its section and hides them from Foundry's native sheet.
   Every suite setting is hidden from the native sheet regardless; one without a
   matching `settingPrefix` is hidden but *unreachable* (it logs a warning), so
   the prefix and `settingPrefix` must always agree.
2. **Flags** — use scope `SUITE_ID`. Prefix flag keys with the feature prefix to
   avoid cross-feature flag collisions on the same document, e.g.
   `actor.getFlag(SUITE_ID, "init.portraitFrame")`.
3. **Sockets** — do NOT call `game.socket` directly. Import
   `{ onSocket, emitSocket } from "../../core/socket.mjs"` and use
   `emitSocket("<featureId>", payload)` / `onSocket("<featureId>", handler)`.
   Register the handler from `onReady`.
4. **Template & asset paths** — any `modules/<old-id>/...` string becomes
   `modules/gluniverse-foundry-modules/features/<featureId>/...`. Prefer the
   `featurePath(featureId, rel)` helper from `core/const.mjs` for JS-built paths.
5. **Localization keys** — keep the module's existing i18n key namespace
   (e.g. `GLUNI.*`, `FF.*`). These are merged into one `lang/en.json`; key
   prefixes already differ per module so they won't collide. Do not rename them.
6. **CSS classes** — keep the module's existing unique prefix (`gluni-`, `gllg-`,
   `glucargo-`, `insight-`, etc.). They do not collide. CSS files move to
   `styles/<featureId>.css` (may be multiple).

### Theme interface

- `styles/gl-tokens.css` owns every canonical `--gl-*` value. Feature CSS must
  consume those tokens and must not redeclare the ink, text, line, semantic
  accent, typography, motion, radius, or material tokens.
- Set only `--gl-accent` on a feature root or state selector. Derived surfaces,
  glow, and bloom come from `--gl-surface*`, `--gl-glow`, and `--gl-bloom`.
- Reuse `.gl-glass`, `.gl-btn`, `.gl-field`, `.gl-well`, `.gl-tech-label`, and
  `.gl-divider` where markup permits. Feature-local aliases must point to the
  canonical semantic tokens.
- Retheming must be possible by changing canonical values in `gl-tokens.css`;
  feature styles may keep domain colors only when they carry distinct meaning.

## The adapter (`index.mjs`)

```js
import { Suite } from "../../core/registry.mjs";

Suite.register({
  id: "<featureId>",
  title: "<i18n key or literal>",
  hint: "<i18n key or literal>",
  icon: "fa-solid fa-...",
  settingPrefix: "<ff.>",  // string | string[]: the setting/menu key prefix(es)
                           //   this feature owns. Routes its config into the
                           //   Control Center and hides it from the native sheet.
  system: null,            // null | "pf2e" | "dnd5e" | ["pf2e","dnd5e"]
  requires: [],            // other active module ids required, e.g. ["tidy5e-sheet"]
  core: false,             // true only for clocks-tracker
  defaultEnabled: false,   // core-on-rest-opt-in: only clocks-tracker is on

  // Always called at init. Register ALL of the feature's settings/menus here so
  // the toggles exist even when the feature is disabled.
  registerSettings() { /* ... */ },

  // Called at init ONLY when enabled & available. Wire Hooks here.
  onInit() { /* ... */ },

  // Called at ready ONLY when enabled & available. Open HUDs, sockets, etc.
  onReady() { /* ... */ },

  // Optional: migration from the standalone module.
  legacy: {
    id: "<old-module-id>",
    settings: { "<oldKey>": "<newPrefixedKey>", /* ... */ },
    // optional async (ctx) => {} for document flags / custom data
    migrate: async (ctx) => {},
  },

  // Optional: object exposed on game.modules.get(SUITE_ID).api.features[id]
  api: null,
});
```

### Lifecycle notes

- The feature MUST NOT register Foundry `Hooks` or open UI at import time. Move
  all such side effects into `onInit` / `onReady` so disabled features are inert.
- `registerSettings` runs unconditionally; everything else is gated by the
  registry on `Suite.enabled(id)` (enabled toggle AND system/requires available).
- Gameplay code that previously checked `game.system.id` can stay; the registry
  already prevents the feature from running on the wrong system when `system` is
  set, but keep internal guards for safety.

### Left-bar scene controls

- A feature that adds tools to Foundry's left scene-control bar MUST place them in
  the suite's own top-level group, NOT in Token Controls. From the feature's
  `getSceneControlButtons` handler, gate first (role / enabled sub-feature), then
  call `ensureSuiteGroup(controls)` from `scripts/core/scene-controls.mjs` and add
  tools to the returned `group.tools`:

  ```js
  import { ensureSuiteGroup } from "../../core/scene-controls.mjs";
  Hooks.on("getSceneControlButtons", (controls) => {
    if (!game.user.isGM) return;            // gate first
    const group = ensureSuiteGroup(controls);
    group.tools["myFeature-open"] = { name: "myFeature-open", title: "…", icon: "…", button: true, onChange };
  });
  ```

  Gate-then-ensure keeps an empty group from ever rendering. For `button` tools
  whose `onChange` is unreliable across v13/v14, use `bindSuiteToolClicks(html, { toolName: handler })`
  from the same module inside a `renderSceneControls` hook.

## Per-feature system/dependency matrix

| featureId          | prefix     | system            | requires        | default |
|--------------------|------------|-------------------|-----------------|---------|
| clocks-tracker     | ct         | null              | —               | core ON |
| initiative         | init       | null              | —               | off     |
| flatfinder         | ff         | pf2e              | —               | off     |
| destiny-dice       | dd         | pf2e              | —               | off     |
| insight            | insight    | null              | —               | off     |
| stage              | stage      | null              | —               | off     |
| stream-pacer       | sp         | null              | —               | off     |
| statsblock-import  | sbi        | pf2e              | —               | off     |
| loot-gen           | lg         | ["pf2e","dnd5e"]  | —               | off     |
| cargo-grid         | cargo      | null              | —               | off     |
| tidy5e-slots       | tidy       | dnd5e             | tidy5e-sheet    | off     |
| pf2e-flatten       | flatten    | pf2e              | —               | off     |
| critical           | crit       | ["pf2e","dnd5e"]  | —               | off     |
| timer              | timer      | null              | —               | off     |
| pf2e-ultimates     | ult        | pf2e              | —               | off     |
