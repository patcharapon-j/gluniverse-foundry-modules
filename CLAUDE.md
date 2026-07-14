# CLAUDE.md

Guidance for Claude Code (and humans) working in this repository.

## What this is

**GLUniverse Suite** (`gluniverse-foundry-modules`) is a single Foundry VTT package
(v13+, verified v14) that bundles ~17 former standalone GLUniverse modules as
individually toggleable **features** behind one shared **Etched Glass** UI. There
is no build step, no bundler, and no test runner — the repo *is* the installed
module. Foundry loads `scripts/main.mjs` (native ES modules) and the CSS/lang
files listed in `module.json` directly.

## Architecture

One installed package, a small core framework, and one self-registering adapter
per feature.

```
scripts/
  main.mjs                  Entry point: init → ready lifecycle (see below)
  core/
    const.mjs               SUITE_ID, SOCKET, path helpers, log/warn/err
    registry.mjs            Suite.register / enable resolution / system+dep gating
    settings.mjs            Core settings registration
    catalog.mjs             Hides suite settings from Foundry's native sheet
    suite-config-app.mjs    The "Control Center" — single grouped settings UI
    socket.mjs              One multiplexed socket channel (payloads feature-tagged)
    migration.mjs           One-time import from the old standalone modules
    util.mjs                Shared pure helpers (clamp/toInt/hex6/escapeHTML/…)
  features/
    index.mjs               Imports every adapter (import order = UI order)
    <featureId>/index.mjs   Adapter: Suite.register({...}) + the ported code
styles/
  gl-tokens.css             CANONICAL design system: tokens, keyframes, utilities
  <featureId>.css           Per-feature styles (may be several per feature)
lang/
  en.json + <featureId>.en.json   Merged by Foundry; keep namespaces distinct
templates/<featureId>/      Handlebars templates
assets/<featureId>/         Images, sounds
docs/FEATURE_CONTRACT.md    Binding contract for porting/adding a feature
docs/PORTING_GUIDE.md       How a standalone module was migrated in
```

### Lifecycle (`scripts/main.mjs`)

- **init** → `registerCoreSettings()`, then `Suite.registerAllSettings()` (every
  feature registers ALL its settings/menus unconditionally so toggles exist even
  when disabled), then `buildCatalog()`, then `onInit` for enabled+available
  features.
- **ready** → wire the shared socket, run one-time migrations, then `onReady` for
  enabled+available features, then expose `game.modules.get(SUITE_ID).api`.

### Why everything is namespaced onto one id

Foundry only lets a package register settings/flags/sockets under *its own* id.
So every former per-module namespace collapses onto `SUITE_ID`, and isolation is
achieved by **key-prefixing** (settings + flags) and **payload-tagging**
(sockets). Per-feature prefixes: `ct.`, `init.`, `ff.`, `dd.`, `stage.`, `lg.`,
`cargo.`, etc. (full matrix in `docs/FEATURE_CONTRACT.md`).

## Conventions (read before editing)

- **Adding/porting a feature** → follow `docs/FEATURE_CONTRACT.md` exactly. The
  adapter must NOT register Hooks or open UI at import time; only inside
  `onInit`/`onReady` so disabled features stay inert.
- **Localization** — all UI strings go through `game.i18n.localize/format`. Keep
  each module's existing key namespace (`GLCT.*`, `GLS.*`, `GLLG.*`, `GLUCARGO.*`,
  `GLSBI.*`, `GLUNI.*`, etc.) — they don't collide. **Watch dynamic keys**: code
  that builds a key at runtime (e.g. `` `GLCT.weather.arch.${a}` ``) breaks
  silently when a value's key is missing. When you add to an enum/archetype set,
  add the matching lang keys. Do NOT localize stored data values or
  parse/format vocabulary (e.g. statsblock parsing tokens).
- **CSS** — `styles/gl-tokens.css` is the single source of truth for the design
  system. Use the `--gl-*` tokens, `.gl-glass`/`.gl-btn`/`.gl-field`/`.gl-well`
  utilities, semantic `--gl-surface*` tokens, and `gl-*` keyframes. Don't redefine tokens locally; derive from them if you need an
  alias. Keep each feature's existing unique class prefix.
- **Motion** — the suite does NOT honor the OS `prefers-reduced-motion`
  preference; animations always play so visuals are consistent for every user
  regardless of their PC settings. Do not add `@media (prefers-reduced-motion)`
  blocks or `matchMedia("(prefers-reduced-motion: reduce)")` checks. (Loot Gen,
  Destiny Dice and Statsblock Import keep their in-app "motion tier" setting,
  which is an explicit user choice, not an OS preference.)
- **Shared helpers** — reach for `scripts/core/util.mjs` before re-declaring
  clamp/integer-coercion/hex-validation/HTML-escape. Keep that module
  dependency-free and side-effect-free.
- **Sockets** — never call `game.socket` directly; use `emitSocket`/`onSocket`
  from `core/socket.mjs`.

## Validation

No package.json / CI build. Validate manually before committing:

```bash
# JS/MJS syntax — every script must pass
find scripts -name '*.mjs' -o -name '*.js' | xargs -I{} node --check {}

# JSON validity — module.json + every lang file
for f in module.json lang/*.json; do python3 -c "import json,sys;json.load(open(sys.argv[1]))" "$f"; done
```

When touching localization, also sanity-check that referenced keys resolve and
that `module.json`'s `styles`/`languages`/`esmodules` lists still point at files
that exist.

## Don't

- Don't add a build step, bundler, or transpile — Foundry consumes the source.
- Don't register anything under an id other than `gluniverse-foundry-modules`.
- Don't rename existing i18n keys or CSS class prefixes (breaks migration/world data).
- Don't move side effects to import time in feature adapters.
