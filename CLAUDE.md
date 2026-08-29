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
    theme.mjs               JS side of the design system: palette mirror, colour
                            maths, motion tiers, retheme hook (canvas/PIXI only)
    util.mjs                Shared pure helpers (clamp/toInt/hex6/escapeHTML/…)
  features/
    index.mjs               Imports every adapter (import order = UI order)
    <featureId>/index.mjs   Adapter: Suite.register({...}) + the ported code
styles/
  gl-fonts.css              The ONLY @font-face declarations in the suite
  gl-tokens.css             CANONICAL design system: tokens + utilities
  gl-motion.css             CANONICAL keyframe pool + .gl-anim-* utilities
  <featureId>.css           Per-feature styles (may be several per feature)
lang/
  en.json + <featureId>.en.json   Merged by Foundry; keep namespaces distinct
templates/<featureId>/      Handlebars templates
assets/fonts/               Bundled typefaces (Oxanium, JetBrains Mono,
                            Google Sans Code — the 3D dice numerals)
assets/<featureId>/         Images, sounds
docs/DESIGN_SYSTEM.md       The token pool, the theme contract, retheming
docs/FEATURE_CONTRACT.md    Binding contract for porting/adding a feature
docs/PORTING_GUIDE.md       How a standalone module was migrated in
```

The three `gl-*.css` files load first, in that order, so every feature sheet can
assume the tokens exist.

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
- **CSS** — read `docs/DESIGN_SYSTEM.md`. Etched Glass is the suite's ONLY
  theme; `styles/gl-tokens.css` is the single source of truth and
  `styles/gl-motion.css` the single keyframe pool. Use the `--gl-*` tokens and
  the `.gl-*` utilities. The non-negotiables:
  - Never redeclare a foundation token outside `gl-tokens.css`. Custom
    properties are global — a feature setting `--gl-cut` on `:root` repaints
    every feature loaded after it. Give feature-local values a feature prefix.
  - Route identity through `--gl-accent` on a scoped selector; everything
    derived follows. Don't hardcode a hue you could route through it.
  - Veils come from a tint channel (`rgb(var(--gl-tint-light) / 0.06)`) or a
    semantic token — never a raw `rgba(255,255,255,…)`.
  - No raw durations or easings; no `@font-face`; no network `@import`.
  - `@keyframes` names are GLOBAL. Reuse the pool, or prefix your own —
    a bare `gl-` name silently overrides another feature's animation.
  - Keep each feature's existing unique class prefix.
- **Motion** — the suite does NOT honor the OS `prefers-reduced-motion`
  preference; animations always play so visuals are consistent for every user
  regardless of their PC settings. Do not add `@media (prefers-reduced-motion)`
  blocks or `matchMedia("(prefers-reduced-motion: reduce)")` checks. (Loot Gen,
  Destiny Dice and Statsblock Import keep their in-app "motion tier" setting,
  which is an explicit user choice, not an OS preference — implemented via
  `applyMotionTier()` in `core/theme.mjs`, which sets `--gl-motion-scale`.)
- **Colour in JS** — PIXI/WebGL/canvas can't read CSS variables, so
  `scripts/core/theme.mjs` holds the palette mirror plus colour maths
  (`hexToRgbFloat`, `mix`, `withAlpha`, `cssVar`). Import from it; never
  hardcode a suite colour in JS. Keep the mirror in sync with `gl-tokens.css`.
- **Shared helpers** — reach for `scripts/core/util.mjs` before re-declaring
  clamp/integer-coercion/hex-validation/HTML-escape. Keep that module
  dependency-free and side-effect-free.
- **Sockets** — never call `game.socket` directly; use `emitSocket`/`onSocket`
  from `core/socket.mjs`.

## Validation

No package.json / CI build. Validate manually before committing. Node is the
only interpreter you can count on here (there is no `python3` on the dev box):

```bash
find scripts -name '*.mjs' -o -name '*.js' | xargs -I{} node --check {}
```

```bash
node -e "const fs=require('fs');for(const f of ['module.json',...fs.readdirSync('lang').map(x=>'lang/'+x)])JSON.parse(fs.readFileSync(f,'utf8'));console.log('JSON OK')"
```

Every path listed in `module.json` must still resolve:

```bash
node -e "const fs=require('fs'),m=require('./module.json');let n=0;for(const p of [...m.styles,...m.esmodules,...m.languages.map(l=>l.path)])if(!fs.existsSync(p)){console.log('MISSING '+p);n++}console.log(n?n+' missing':'all paths OK')"
```

When touching localization, also sanity-check that referenced keys resolve —
especially keys built dynamically at runtime.

**When touching the stat block parser** (`features/statsblock-import/`), re-check
the two Load Sample payloads (the format's only in-app documentation) plus the
description-rendering round trip, all of which `--samples` covers:

```bash
node tools/parse-check.mjs --samples
```

Zero errors required. The same tool checks a file directly
(`node tools/parse-check.mjs foo.md`). See `docs/STATBLOCK_FORMAT.md` for the
export/import symmetry rules and the `ult.*` cross-feature flag contract.

**When touching Stage character lighting** (`features/stage/postfx/`), re-run the
pure-logic checks. The blur kernel, light geometry, framing detection and CORS
strategy are all things a diff cannot show you were wrong about:

```bash
node tools/postfx-check.mjs
```

Zero failures required. It also cross-checks that every shader uniform is both
declared in the GLSL and looked up from JS — a typo there is a silent no-op, not
an error.

**When you touch the GLSL itself**, that tool is not enough — it cannot compile a
line of it, and a shader that fails to compile degrades *silently* to the CSS
fallback rather than erroring. Run the browser-backed one too:

```bash
node tools/stage-lighting-preview.mjs
```

It drives the real modules in headless Chromium, fails on a compile or link
error, asserts the edge behaviour (strength 0 is bit-identical to the source art;
the rim follows the lamp; the core reaches near-white), and writes a four-room
contact sheet with a magnified detail row — `--out=/tmp/sheet.png` to put it
somewhere you'll look. Needs Playwright; skips cleanly with exit 0 without it.
Neither tool can check how any of this *looks* on real art; that needs a real
session. See `docs/STAGE_LIGHTING.md` for the shading model, the edge terms and
the asset-hosting contract (S3/CORS).

**When touching the PF2e Ultimates token overlay** (`features/pf2e-ultimates/token-overlay.mjs`),
the three shaders there draw in the quad's UV space, so how big a feature lands
on screen depends on the scene's grid size and the canvas zoom — a rim that
reads correctly on a grid-100 map is sub-pixel on a grid-50 one and crawls
between pixel centres. The shaders defend against that with `uTexel` (one
device pixel in UV units, fed from the mesh's world transform each frame) and
the helpers in `SCALE_PRELUDE`. None of it is visible in a diff, and a shader
that fails to compile falls back to a static icon rather than erroring, so run:

```bash
node tools/ultimate-overlay-check.mjs
```

Zero problems required. It compiles all three in headless Chromium and scores
them against a box-filtered ground truth at five quad sizes: the still frame,
the movement between frames, and the movement under a half-pixel pan. It also
pins the two invariants the design rests on — that the filtering is inert at
`uTexel` 0 (a missing uniform must degrade to the old look, not a blank quad)
and that it changes nothing at sizes with room for the detail. Needs Playwright;
skips cleanly with exit 0 without it. `--sheet=/tmp/ult.png` writes a
before/after/truth contact sheet — the only way to see what any of it looks
like short of a session.

**When touching the PF2e damage dice** (`features/pf2e-damage-dice/`), the
texture set under `assets/pf2e-damage-dice/textures/` is *generated*, not
hand-drawn. Re-bake it after any change to a recipe or to the damage-type table,
and confirm the set is complete:

```bash
node tools/gen-damage-textures.mjs && node tools/gen-damage-textures.mjs --check
```

The tool fails if `damage-types.mjs` declares a glow a type's baked emission map
does not have (or vice versa). To review a recipe change without launching
Foundry, render a contact sheet — a tiling seam or a blown-out glow is obvious
there and invisible in a diff:

```bash
node tools/gen-damage-textures.mjs --sheet=/tmp/damage-dice.png
```

**When touching Locations** (`features/locations/`, `styles/locations.css`),
re-run its consistency check. Everything it covers fails *silently* — a duration
that disagrees between the CSS token and the `ms` mirror, a `url(#…)` naming a
filter that does not exist, an `animation:` with no `@keyframes`, a style with no
i18n key, a `feComposite` that blacks out the plate:

```bash
node tools/locations-check.mjs
```

Zero problems required. It cannot check how any of it *looks* — for that,
`--sheet=/tmp/locations.html` writes a page with every style frozen
mid-transition; open it. See `docs/LOCATIONS.md` for the one-phase curtain model
and the v13/v14 background split.

**When touching calendar events** (`features/clocks-tracker/calendar/events.js`,
`apps/events-editor.js`, `apps/calendar-view.js`), re-run the identity check.
Every GM control on an event resolves its row by the event's `id`, so an event
with a missing, blank or duplicated id renders perfectly and then ignores edit,
delete, pin and visibility alike — silently. Read events through
`readEvents()`/`findEvent()` and write them through `writeEvents()`; never reach
for the `ct.events` setting directly from a UI:

```bash
node tools/calendar-events-check.mjs
```

Zero failures required. Minted ids must stay **deterministic** — the id a row
renders with has to be the id its click resolves, including on a client that
never wrote the repair back.

**When touching Stream Pacer's safety lights or its exempt-users form**
(`features/stream-pacer/`, `templates/stream-pacer/`), re-run the exemption
check. A safety-exempt user is normally the login whose screen is being captured,
so every miss here fails *silently* — it looks correct on your own screen and
appears on the recording. It covers the four sites each exemption column must
agree on (registration, save branch, form context, `name=` attribute), that every
enumerated safety surface in `module.js` sits inside the exemption gate, that the
HUD template's safety branches are keyed on `showSafetyLights` rather than
`isGM`, the two deliberately different liveness rules (local snapshot vs per-call
roster read), and that the hint still warns that exempting a real person removes
their means of signalling distress:

```bash
node tools/stream-pacer-safety-check.mjs
```

Zero problems required. It is a source-shape check and cannot prove the rendered
result — only a session with the capture login signed in can do that.

**When touching Reflavor** (`features/statsblock-import/reflavor*.js`,
`styles/statsblock-import-reflavor.css`), re-run its consistency check. The payload
*teaches* the importer's grammar section by section, so a field renamed in
`importer.js` and not there trains the model on a field the parser no longer
accepts — which breaks every reflavour at once and reads to the GM as the model
getting worse. It also pins the things that cannot be seen in a diff: benchmark
rows must come from `Benchmarks.rawRow()` (never `resolve()`, which subtracts
level under PWoL and would disagree with the un-flattened numbers printed beside
it), rung 4 must never reach a hazard (no hazard tables exist in this repo), and
the single-fence output contract must survive, because `parseTopLevelField`
reads `Key: value` under *any* heading and one line of commentary inside the
fence silently rewrites the creature:

```bash
node tools/reflavor-check.mjs
```

Zero problems required. See `docs/REFLAVOR.md` for the rung ladder and the
hand-off contract.

**When touching Recall Knowledge** (`features/pf2e-recall/`, `styles/pf2e-recall.css`,
`skills/pf2e-recall/`), re-run its consistency check. Everything it covers fails
*silently*: a grammar that drifts between the prompt emitter and the parser
reads to the GM as "the model got it wrong" rather than as an error; a
competence band with no delivery mode falls through to the default; two bands
coming back with the same paragraph means two rolls that play identically, which
is the exact failure the band model exists to remove and which renders perfectly
happily; `BAND_KEYS` silently disagreeing with Flatfinder's own band list or
order; the two **dynamic** i18n families (`GLRK.mode.*`,
`GLRK.parse.warn.emptyBand.*`) are built at runtime, so nothing else catches a
missing key; and if the `privateNotes` mirror heading ever equals
`statsblock-import`'s, that module's exporter scrapes this feature's paragraphs
and round-trips them back out as DC-keyed entries — silent corruption of a
documented format:

```bash
node tools/recall-check.mjs
```

Zero problems required. Note that this feature deliberately computes **no DCs**:
under PWoL the level-based DC collapses to a seven-point band and rarity
dominates it, and `pf2e-flatten` applies PWoL as an `"all"`-selector modifier
without setting `game.pf2e.settings.variants.pwol.enabled`, so the system's own
`identificationDCs` are un-flattened in these worlds. See
`docs/RECALL_KNOWLEDGE.md` for the tier model and the band mapping.

**When touching CSS**, additionally confirm you have not reintroduced any of the
drift this design system exists to prevent — a raw hex that duplicates a token,
a raw `rgba(255,255,255,…)` veil, a network `@import`, a second `@font-face`, a
duplicate `gl-*` `@keyframes`, a foundation token redeclared outside
`gl-tokens.css`, or a self-referential custom property (`--x: var(--x)`, which
is invalid and silently does nothing):

```bash
grep -rnE "^\s*@(import url\(['\"]?http|font-face)" styles/ | grep -v gl-fonts.css
```

```bash
grep -rhoE '@keyframes\s+gl-[A-Za-z0-9_-]+' styles/ | sort | uniq -d
```

## Don't

- Don't add a build step, bundler, or transpile — Foundry consumes the source.
- Don't register anything under an id other than `gluniverse-foundry-modules`.
- Don't rename existing i18n keys or CSS class prefixes (breaks migration/world data).
- Don't move side effects to import time in feature adapters.
