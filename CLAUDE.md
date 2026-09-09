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
etc. (full matrix in `docs/FEATURE_CONTRACT.md`).

## Conventions (read before editing)

- **Adding/porting a feature** → follow `docs/FEATURE_CONTRACT.md` exactly. The
  adapter must NOT register Hooks or open UI at import time; only inside
  `onInit`/`onReady` so disabled features stay inert.
- **Localization** — all UI strings go through `game.i18n.localize/format`. Keep
  each module's existing key namespace (`GLCT.*`, `GLS.*`, `GLLG.*`, `GLSBI.*`,
  `GLUNI.*`, etc.) — they don't collide. **Watch dynamic keys**: code
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

**The grade is measured on both sides** (`postfx/tally.mjs`), and its four
components — light colour, saturation, brightness, tonal range — are separable
*by design*, not by tidiness: a GM who dislikes the result has to be able to find
which part they dislike, and a single per-channel affine (the obvious
simplification, and one multiply instead of four) makes every dial a different
way of asking the same question. `postfx-check` asserts one dial moves one
property, including that the cast's own luma is 1 — skip that and brightness and
light colour both move the level. Every component is its own identity at 0, so a
world can get the previous look back exactly.

**Skin resists the two chromatic components and takes the two achromatic ones in
full.** That asymmetry is the feature: a face in a blue night scene has to get
darker without going blue. It is also why the four have to stay separable — if
level and hue arrived as one matrix there would be nothing to split. The wiring
is pinned structurally by `postfx-check` (the guard must not reach the level or
contrast statements) and the *behaviour* only by the browser harness, which
scores a skin patch against a luminance-matched grey under a hard blue cast.
Matched luminance is the point: "skin changes less" is satisfied for free by a
darker patch. Two easy-to-lose assertions sit beside it — that the guard leaves
brightness alone (a guard that held back level too leaves every face floating at
its original exposure in a dark room, which is worse than a blue one), and that
it does not spill onto neutrals (an over-generous ellipse holds the match back
everywhere, which reads as the feature not working).

The light kit's `ppWrap` and `ppBacklight` are **multipliers over the style
table**; halation, glow radius and glow sense are **absolute**, because no style
carries a value for them to multiply — halation is a claim about a lens and none
of the three styles is one. Don't "fix" that asymmetry by adding them to the
tables: a multiplier over a table value of 0 is a dial that cannot be turned on.

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
`GLRK.parse.warn.emptyBand.*`, `GLRK.presentation.*`) are built at runtime, so
nothing else catches a missing key; a presentation row missing one of its fields
renders as `undefined` in the GM's clipboard and cannot be fixed from inside
Foundry; a second presentation quietly permitting numbers turns the feature back
into the stat readout it exists to replace; the cumulative-carry warning either
crying wolf on a good ladder or never firing on a fragmented one; a word budget
whose top band runs so much longer than its bottom one that the length of what
the GM reads aloud tells the table how well somebody rolled (and the same
budgets restated in `skills/pf2e-recall/SKILL.md`, which nothing else reads);
the inline-markdown renderer either leaving a marker unrendered — so the GM
reads asterisks aloud — or letting a tag through, since the panel, the
`privateNotes` mirror and Insight all print its output unescaped; a
`SUBJECT_TYPES` entry with no extractor or no payload kind word behind it, which
is a live menu item that answers "that document type cannot be summarised"; an
Insight hand-off carrying the band, the mode or a title, each of which gives the
player their die result in words and none of which the GM can see from their own
side of the screen; and if the `privateNotes` mirror heading ever equals
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

**When touching the resource bars** (`features/resource-bars/`), re-run the
consistency check. Everything it covers fails *silently*: a shader that will not
compile degrades to a static fallback rather than erroring; a uniform declared
and never written holds its initial value forever; a duration written as a
literal ignores the user's motion tier; the OKLab ramp mirrors `gl-tokens.css`
by hand and can drift from it; an animated behaviour missing from
`SHED_ORDER` never degrades under load; and a numeric readout drawn outside the
`displayBars` gate leaks a hostile's hit points while looking entirely correct:

```bash
node tools/resource-bar-check.mjs
```

Zero problems required. It also pins the seam with the initiative tracker: the
guard-break fracture is that feature's crack, run from the *shared* field in
`scripts/core/fx-glsl.mjs` rather than a lookalike, and everything holding the
two together fails silently — the flag key drifting (a fracture that never
appears), the gold drifting (one creature cracking in two golds), the field being
forked, or the extraction ceasing to be an identity for `FX_FRAG_BREAK`, which
changes the token and the card while nothing in the bars is even running. If you
touch `core/fx-glsl.mjs`, that shader is consumed by three features; the pin only
proves the *call* is unchanged, so re-render before you trust it.

Two more pins are worth knowing about before you touch this.

Anything meant to read as a hairline must be sized in **device pixels** (`px`),
never in the shader's geometry units — a fixed value is ~2px on a HiDPI display
and sub-pixel on an ordinary one, where `rbDetail` deletes it, so the detail
silently vanishes for every player without a retina monitor and no preview you
run yourself will show you that.

A third: `PIXI.Filter` defaults its `resolution` to **1**, not to the
renderer's, and the filter system sizes its intermediate textures from the
filter. Left alone, the whole bar container renders at half the device pixels on
any HiDPI display and is scaled back up. Nothing errors; the bars are just soft,
and softer the harder you zoom. `syncFilterResolution()` in `host.mjs` is the
only thing standing between that and a blurry feature, and no preview you run at
dpr 1 will show you it is missing.

And the bar container's `zIndex` is load-bearing. `canvas.interface` sorts its
children and every Foundry layer declares one; left at the default the bars sort
under the tokens layer, so the hover border draws over them — correct in every
other respect, wrong only while a token is hovered.

To see it, `node tools/resource-bar-preview.mjs --out=.preview/bars.html` writes
a page that compiles the real shader in a real WebGL2 context and drives it with
the real animation model. **Serve it** (`node tools/preview-server.mjs`) — a
`file://` page does not execute its module script. See
`docs/RESOURCE_BARS.md` for the pipeline, the unit convention and the
permission contract.

**When touching Arcane Surge** (`features/pf2e-arcane-surge/`,
`styles/pf2e-arcane-surge.css`), re-run its consistency check. Everything it
covers fails *silently*. The load-bearing one: a level's surge threshold is
simultaneously the d20 result that surges, the number of glyph faces baked onto
that level's die, and what the baker asserts coverage for. Those live in three
files, and a disagreement renders perfectly while making the die a **lie about
its own odds** — the one thing that die exists to tell the truth about. It also
pins band monotonicity and the tier windows the draft's tone rests on (Fraying
reaches Major but never Catastrophic; inviting in Unraveling must actually be
more dangerous than not inviting, or the temptation the whole mechanic is built
on is false); the three-way uniform agreement across all *four* shader programs,
where a uniform missing from one leaves every frame drawn at whatever value the
driver happened to start with; `SHED_ORDER` completeness; the runtime-built
`GLAS.level.*`, `GLAS.tier.*` and `GLAS.mode.*` key families, which nothing else
checks; the die's defensive claim on the global `CONFIG.Dice.terms` letter,
where a collision silently breaks another module's die; and the two guards a
double-fire would destroy — one casting one check, one card one roll.

Two more it pins because this feature got both wrong on the way in. The
stability cracks in the HUD must run the **shared** fracture from
`core/fx-glsl.mjs`, not a lookalike — four features carry that one crack now.
And each level's hue must be a single statement: `palette.mjs`'s `LEVEL_KEYS`
and the `.glas-level-*` accent remaps naming the same token, with no two levels
naming the same one. `unbound` was on `--gl-holo-b`, which `gl-tokens.css`
aliases to `--gl-violet`, so the ladder's two most dangerous rungs rendered in
exactly the same colour and nothing said so:

```bash
node tools/arcane-surge-check.mjs
```

Zero problems required. Two things it cannot do. It cannot compile a line of
GLSL — and a shader that fails to compile degrades to *nothing drawn* rather
than erroring — and it cannot prove the cracks are actually inert at Stable,
only that their alpha is shaped so that they should be. Both need the
browser-backed harness:

```bash
node tools/arcane-surge-preview.mjs --out=.preview/surge.html
```

**Serve it** (`node tools/preview-server.mjs`) — a `file://` page does not
execute its module script, so the shaders never compile and you get an empty box
rather than a failure. The crack row there is drawn at **shipping size** — a
strip in a HUD bar — with a nearest-neighbour 4× mirror beside it, because the
shared fracture's shards are the finest detail in the suite and this is the
smallest place any of them has been asked to land. Ignore that page's
`ms/frame` readout: a dozen canvases and a throttled tab put it in the hundreds
while the shader is doing nothing. The `ms/draw` figure beside it is the one
that means something.

The die faces are generated, not drawn; re-bake and confirm coverage after any
recipe change:

```bash
node tools/gen-surge-textures.mjs && node tools/gen-surge-textures.mjs --check
```

**Nothing on these dice is painted** — every face is relief and light over Dice
So Nice's own frosted glass. Two of the shipped files exist only to make that
possible and both read as mistakes: `clear.png` is fully transparent and is what
makes DSN read a face's bump and emissive maps at all (a text label, `""`
included, takes a branch that ignores them), and `surface.png` is pure white
because DSN draws a texture's bump only inside the block that draws its source.
Replace either with the "obvious" thing and the dice go blank while nothing
errors.

And **the bump map is also the transmission mask.** On any transmissive material
DSN binds the finished bump canvas a second time as `transmissionMap` and reads
it through `smoothstep(0.6, 0.9, r)`, so the height field is what decides which
parts of the die are glass (≥ 230) and which are solid (≤ 153) — DSN draws its
own numerals at `#555` on a `#FFFFFF` field, which is that contract stated in
its source. A flat level below the top of that curve makes the whole die opaque
while remaining a perfectly ordinary-looking height map, and that is how these
dice first shipped: a field at 141/255 put 94% of every face under the curve and
the table got a black solid with no albedo on it. `--check` measures the band on
both faces now, and separately requires the *tiling* surface to stay wholly
inside it, since one dark pixel in a map drawn under every face is a permanent
opaque smear repeated across the table.

Three smaller ones in the same family, all of which shipped wrong once.

**A d20 face is not centred in its texture tile.** DSN draws a label image
across a whole 256px tile, 1:1, but what samples it is a triangle that is not
concentric with the square: read off the `uv` attribute of DSN's own
`DICE_MODELS.d20`, every face has its centroid at **y = 0.576**, not 0.5, and
its largest inscribed circle is **0.575** of the half-tile. So art composed on
the square is both off-centre and clipped by the die's own edges — and the
contact sheet cannot show you, because it prints squares. The concentric grooves
were struck at 0.62 about the square's centre, outside the incircle *and* off
the face's centre, so every ring on the die was cut by two of its own edges,
twenty times over. `--check` scans for it now: any pixel carrying a mark must
fall inside `FACE_TRIANGLE`. That is stronger than a radius test, which would
have caught only half of it.

**The die's body and the mark burning in it are one statement.** They are
produced in completely different places (the body is a colorset field in
`dsn.mjs`, the glyph is baked into an emissive PNG by the texture tool) and,
stated separately, they landed on the same teal within one commit — so the one
thing the die exists to say was invisible while each half looked correct in its
own file. Both come from `DIE_KEYS` in `palette.mjs`. The body is **black
glass** now (`ink1`): a transmissive material carries its tint through the whole
casting instead of painting it on, so that reads as smoked glass rather than as
a black surface. What it costs is the hue axis — at that value a hue is not a
colour anybody can see — so the check measures **either** ≥ 45° of hue **or**
≥ 0.35 of relative luminance, and requires one of them; the glyph must out-value
the body, and the *edge* must out-value it by ≥ 0.2, because DSN paints the
bevels with it and that is the entire silhouette of a dark die.

**Emission is not a local cost.** Any non-black `emissive` on any material in
the dice scene switches the whole canvas onto DSN's bloom path for the length of
the throw — a second full scene render plus ten `UnrealBloomPass` blurs — and on
a transmissive material each of those renders drags a `renderTransmissionPass`
with it, which three.js sizes to the **full viewport**, forces 4× MSAA on, and
re-mipmaps every frame. So one glowing numeral roughly doubles the per-frame
cost of every die on the table. The surge d20 pays it (a glyph that does not
glow is not a glyph); the severity d100 does not, and the check holds the
invariant rather than the implementation — the colorset must either set
`emissiveLabels` **or** sit on a body below 0.15 luminance, where a white
outlined numeral carries itself.

And **warm the presets**. DSN loads a preset's images lazily inside
`create()` at the first throw, one `await` per face — sixty serial round-trips
per system, times three systems, mid-animation. 6.2.9 added
`dice3d.preloadPresets(systemId)` for exactly this and says in its own source
that without it such presets "cause visible lag". Not calling it *was* the lag.
It does not cover DSN's own 2048² Sobel normal-map bake, which is JavaScript on
the main thread at **370–520 ms per material**, once per level system; there is
no public seam to warm that, and registering fewer systems is the only lever.
For scale, the feature's own full-screen shaders measure 0.89 ms (surge) and
0.37 ms (verdict) per frame at their worst shipping size — the live beats are
not where the time goes.

Bump and emissive maps *both* live behind DSN's "realistic lighting", which
Foundry's own Low performance mode turns off; a die carrying nothing else is
twenty identical faces there, so `registerDiceSoNice` checks and stands down to
DSN's internal word-labelled preset rather than registering blanks over it.

See `docs/ARCANE_SURGE.md` for the exposure model, the three deliberately
different transport channels, why the standing instability is drawn in the HUD
chip rather than over the board, and why every pass runs live off a warmed
context rather than from baked frames.

**When touching the PF2e areas** (`features/pf2e-aoe/`), re-run its consistency
check. It covers the closed semantic vocabulary, classification ties, profile
precedence, PF2e coverage (the 5/10/5 diagonal, half-grid cone origins, blocked
cells, emanation footprints), every shader uniform being both declared and
written by the host, the shed gates, and the atlas layout the shader's
`uAtlasRect` assumes:

```bash
node tools/pf2e-aoe-check.mjs
```

Zero failures required. It cannot compile a line of GLSL, and a shader that
fails to compile restores that Region to Foundry's native highlight rather than
erroring, so after touching `shader.mjs` render it:

```bash
node tools/pf2e-aoe-preview.mjs --out=.preview/aoe.html && node tools/preview-server.mjs
```

The page exposes `__aoeArchSheet`, `__aoeSheet` and `__aoeTimeSheet` for
headless contact sheets. Three things about that shader are invisible in a diff.
Every band of the frame is drawn against `latticeSdf` — the PF2e staircase —
not the smooth shape; drawing any of them against the shape puts two disagreeing
edges on a rules lattice. Every hairline is sized in device pixels through
`uTexel`, never in grid units. And the material fill is computed only on the
ground and shade planes: the boundary and atmosphere planes must not reach for
`fill`, or three of four passes pay for frost's dendrite search again. The
material atlas is generated, not drawn — re-bake and confirm after any recipe
change with `node tools/gen-pf2e-aoe-atlas.mjs && node tools/gen-pf2e-aoe-atlas.mjs --check`;
its tiles must stay seamless (periodic noise) and the host must keep mipmaps
off on it, or the `fract()` tiling draws a hairline grid at the repeat. See
`docs/PF2E_AOE.md` for the frame and the material contract.

**When touching Insight** (`features/insight/`, `styles/insight.css`,
`templates/insight/`), re-run its consistency check. An Insight arrival is a
sequence of classes applied to elements by a clock, over CSS that is almost
entirely one-shot keyframes — so nothing here throws when it breaks, a beat of
the reveal just never happens, on a player's screen, once, while the GM's own
screen looks correct. It pins every element the renderer reaches for against
the template (a rename makes `querySelector` return null, which drops a beat
silently and throws outright on the two that are not optional); the *reverse*
direction too, because most of the arrival — the flash, the scan, the four
corner marks, the frame — is nodes JS never touches and CSS alone animates, so
a rename on either side simply deletes that beat; the stage clock in
`tools/insight-preview.mjs` against the one in `notification.mjs`, since the
preview is where this feature is judged and a preview on its own timings
flatters a reveal nobody ships; that every setting the renderer reads is
registered (`game.settings.get` on an unregistered key throws *inside* the
render, losing the whole notification rather than degrading it); that every
edge-intensity tier names a class the CSS defines, since a tier that resolves
to nothing renders as "full" — the one outcome a player who turned the edge
down did not consent to; that every sound profile carries all three stages,
because a missing one is a designed no-op and a profile that lost its `impact`
is a silent alert on the exact beat the alert exists for; and that a preset
only ever remaps `--gl-accent` plus this feature's own `--insight-*` tokens,
because presets are **not** themes and one that repaints a surface forks
Etched Glass while looking perfectly fine in its own file:

```bash
node tools/insight-check.mjs
```

Zero problems required. Two of its rules are there because this feature got
both wrong on the way in.

`--gl-glow`, `--gl-bloom`, `--gl-accent-soft` and `--gl-accent-faint` are
declared at `:root` **against the `:root` accent**, so they do not follow a
scoped `--gl-accent` remap — a custom property's `var()` is substituted where
it is declared, and descendants inherit the already-resolved value. Reading one
inside a violet card paints the suite's default blue, and only on the elements
that happen to use it. Every accent-derived value in `styles/insight.css` is
struck inline with `color-mix()` for that reason; the check refuses the four.

And **an accent that covers a whole viewport has to be corrected per hue.**
The edge bands blend with `screen` over a cool canvas, where amber carries far
further than a luminance-matched violet would predict: on the shared burn the
Fantasy preset washed the entire frame yellow instead of lighting its edges,
and looked deliberate in every file involved. That is why a preset may set
`--insight-burn` and `--insight-reach-*` at all — the edge is the one place a
preset's hue is spread across the whole screen, so it is the one place the
preset carries its own correction.

It cannot show you how any of this looks, and a still cannot either — the
arrival *is* the feature. For that, `node tools/insight-preview.mjs` writes a
page that drives the real stylesheets and the real template through the real
stage order across four simulated 1200×675 desktops, plus the card at 1:1.
**Serve it** (`node tools/preview-server.mjs`) — a `file://` page loads the CSS
but not the module script, so you get a card frozen at its pre-entry values and
conclude, wrongly, that the reveal is broken. Add `--artifact=<path>` for a
self-contained copy that opens anywhere.

**When touching the PF2e variant rules** (`features/pf2e-variant-rules/`), re-run
its consistency check. Everything it covers fails *silently*.

The load-bearing one is the dent → item-HP reflection. Dents live in a flag, but
PF2e derives `isBroken` / `isDestroyed` straight off HP (`hp.value === 0` is
destroyed, `hp.value <= floor(max / 2)` is broken) and shields read those getters
to decide whether they still grant an AC bonus — so the reflection is the only
thing making "broken" mean anything. It **must** round down: on an item with odd
max HP, rounding 15 × 0.5 up to 8 leaves a two-dent item one point above PF2e's
threshold of 7 and it never reads as broken. Even-HP items are fine, which is
exactly how that survives a play session.

That reflection is a *consequence* of a dent count, never a precondition for
one. PF2e authors item HP on shields and on virtually nothing else: the
`physical` template in `template.json` ships every item at
`hp: { value: 0, max: 0 }` with `hardness: 0`, and both `isBroken` and
`isDestroyed` begin `max > 0`. Requiring item HP before drawing a dent track
therefore reads as a careful guard and silences the whole rule — no panel on any
weapon, any suit of armour or any pack in a real world, which is indistinguishable
from the feature being switched off, and which is exactly how it first shipped.
Which items carry dents is `DENT_TYPES` in `constants.mjs` filtered by the
table's own `types` config; item HP is only written back where it exists. The
check tool refuses a `tracksDents` that consults HP or Hardness.

**The dent thresholds are a GM-editable config**, because "does a potion dent"
and "how much does adamantine buy you" are rulings rather than facts about the
data model. `DEFAULT_DENT_CONFIG` ships the printed rule and nothing else — 2/4,
doubled on a sturdy shield, on the gear the rule is written for, every grade and
material row at zero — so a table that never opens the sheet plays the book. Two
things there fail silently. Foundry's form parser builds a nested object only
from a **dotted** `name`: a flat `name="weapon"` saves a config with no `types`
key, `dentConfig()` merges the defaults back over the hole, and the GM's edit is
discarded while the form submits happily. And the sheet must be reachable — a
registered Object setting with no `registerMenu` in front of it is a config a GM
can only reach through the console. The check tool pins both, along with the
threshold invariant across every combination the sheet can produce: a destroyed
rung at or below the broken one deletes the broken state entirely, so an item
goes from working to gone in one hit and every number involved still renders.

**Hardness is the whole input to the rule, and PF2e supplies none.** Damage at
or below Hardness does nothing, above it is one dent, above twice it is two — so
an item at Hardness 0 takes the *maximum* two dents from every hit that lands and
is destroyed in two blows. `ShieldPF2e#prepareBaseData` is the only place in the
entire system that ever writes a real Hardness; every other physical item ships
from `template.json` at 0 and stays there. A resolver that simply reads
`system.hardness` is therefore one where a solid adamantine greatsword shatters
as fast as a wooden spoon, and nothing reports it. `hardness.mjs` is the ladder
down: the GM's per-item override, then `system.hardness` where PF2e or a rule
element actually set one (which keeps a shield's reinforcing runes and grade
improvements — recomputing from the material alone would silently throw them
away), then the material's own Hardness at its grade from **PF2e's own table**,
then the table's per-type default, which ships at 0. The panel prints where the
number came from, because a GM looking at a 10 otherwise has no way to tell
adamantine from a default they set months ago except by changing it.

**TABLE: OBJECT DENTS is keyed on possession, not on size.** The same paragraph
(p. 48) that gives Tiny 1/2 through Gargantuan 16/32 for objects pins anything
"carried, held, or wielded" at 2/4 *however large it is*. So implementing
"infer dents from size" by reading `system.size` — the obvious reading — quietly
makes every Large weapon in the world four times as durable, which renders
perfectly and is not the rule. `optionsFor` derives `carried` from the owning
actor's type (a creature is carrying it; a loot actor standing in for a chest or
a door, or no actor at all, is scenery) and the check tool asserts both
directions of that table.

`dent-config.mjs` builds its ApplicationV2 subclass in a **memoised factory**,
not at module scope. `settings.mjs` is imported transitively by pure modules the
check tools load under plain Node, where `foundry` does not exist, so a
top-level `const { ApplicationV2 } = foundry.applications.api` takes the tooling
down rather than the feature.

One more that is invisible in a diff and in any preview built on the suite's own
panels: **`.gl-btn` declares no font-size**. It states its padding in `em` and
takes its type from the host, so a button dropped into a chat card renders at
14px and one on a PF2e sheet larger still, beside labels this feature strikes at
9–11px — and because the padding is proportional it inflates with the type until
the label crowds its own border. Every button a feature ships has to be sized by
that feature, either on its own class or through one `<surface> .gl-btn` rule;
the check tool walks the emitted buttons and requires it.

It also pins that chip damage fires on a miss but **not** on a critical miss (the
book excludes every degree past the first that deals no damage, so getting this
wrong doubles the rule's frequency); that an applicable resistance *negates* chip
damage rather than reducing it; that a spell's rank beats its level and a level-0
effect clamps to 1 rather than chipping for nothing; that the healing penalty
stays negative, since a positive value would silently *increase* healing; that
every sub-feature prefix is strictly longer than the parent's `vr.` catch-all,
or the catalog's longest-first sort hands the child's keys to the parent and its
settings group renders empty; and the two runtime-built i18n families
(`GLVR.dents.state.*`, and the settings labels derived by slicing `vr.` off a
key, plus `GLVR.dents.source.*`, `GLVR.dents.hardnessFrom.*` and
`GLVR.dents.size.*`), which nothing else checks; that the material table has not
drifted from PF2e's own numbers, since a wrong value there is a silent lie about
the system's data; that a blank field in the per-item override *clears* rather
than storing a zero, which would make an item arrive already destroyed; and that
the dent nudge controls carry a size of their own rather than the panel's, since
a `+` and a `-` left at the surface default come out several times the height of
the rung they adjust:

```bash
node tools/pf2e-variant-rules-check.mjs
```

Zero problems required. Nothing there can show you a panel. For that:

```bash
node tools/variant-rules-preview.mjs --out=.preview/vr.html && node tools/preview-server.mjs 8954
```

**Serve it.** It draws the dent track in a 16px host and the chat cards in a 14px
one, because the type a button inherits is the whole bug, and it renders the dent
config sheet at its real window size, where a footer clipped by a stray
`height: 100%` is visible and in a diff is not.

Three things about this feature are worth knowing before
you change it.

**Chip Damage and Dents run in assist mode on purpose.** PF2e exposes no hook on
damage application and nothing else in this suite has ever written into that
pipeline; the GM presses a button and the module never silently changes a number.
`applyFlatDamage` in `apply.mjs` is the single place damage is written, and it
passes `damage` as a bare **number** with `final: true` — the number branch skips
`applyIWR` entirely and `final` additionally zeroes hardness and the shield-block
prompt, so the actor loses exactly what the card promised. `applyDamage` consumes
its `token` argument unguarded, so an actor with no token on the active scene has
to be refused up front rather than allowed to throw.

**Careful Consumption never calls PF2e's `consume()`.** That function takes only a
quantity, fires no hook, and builds a bare `DamageRoll(...).toMessage()` that
bypasses every synthetic in the system — there is nothing to hook. Because the
path is thin we simply do not use it: the same `(formula)[type,kind]` string is
rebuilt, evaluated with `maximize: true`, and posted, so PF2e's own apply buttons
still work and nothing was patched.

**Lasting Wounds has two limits that are PF2e's, not ours.** `applyDamage` skips
every modifier when called with `final: true`, which is what dragging a token's
HP bar does — so bar-dragged healing ignores the penalty while chat-card healing
honours it. And Treat Wounds rolls against a plain numeric DC, so
`StatisticCheck#roll` takes its un-targeted branch and the message carries **no**
`context.target` and no `target:*` roll options; the patient is resolved from the
user's own target or selection instead. The healing penalty itself is a custom
modifier on the `healing-received` selector — `prepareSynthetics` pushes every
key of `system.customModifiers` into `synthetics.modifiers` with no allow-list,
so that works without an effect item or a rule element. `addCustomModifier`
refuses a duplicate *label*, so changing the value means remove-then-add.

**Two seams with PF2e that this feature got wrong on the way in.** There is no
"largest possible total" property on a Foundry `Roll` — the one the chat-card
button originally read exists nowhere in core, so it was always `undefined`, the
guard in front of it always tripped, and the button never rendered on any card
while every other part of the feature looked correct. The maximum is produced by
`evaluateSync({ maximize: true })` on a fresh copy of the same formula now, which
is the same operation the pre-roll path performs, so the two routes agree by
construction. And a consumable carries **no action cost at all** in PF2e:
`system.uses.value` is the dose count, and reading it as one disqualified every
multi-dose elixir for the crime of having doses left. Doses and `quantity` are
also different counters, so spending a use decrements `system.uses.value` exactly
as `ConsumablePF2e#consume` does; spending quantity first destroys a part-used
elixir at the first sip. The check pins all four.

**Three more seams, all of which shipped wrong once.** `Check.roll(check, context)`
sums `check.modifiers`; the context's own `modifiers` array is copied into
`context.origin` as metadata about the roller and is never added to anything, so
the Medicine penalty written there was recorded, displayed nowhere and changed no
result. It goes on the check now, through `StatisticModifier#push`, which dedupes
by slug so a reroll cannot stack a second copy. Second, a dent readout gated on
`isGM` looks perfectly correct on the GM's screen and is simply absent on every
other one, which is the failure nobody at the table can report: reading and
writing are separate questions here, and the two sheet passes reach
`game.user.isGM` only through `canEdit()`. Third, the Careful Consumption button
lives where a player is standing when they decide to drink something, which is
PF2e's inventory summary and the item's own chat card, not the item sheet's
Details tab. `ItemSummaryRenderer#toggleSummary` fires no hook, so the sheet is
watched with a MutationObserver that is re-entrant exactly once. The check pins
all of it.

**Boss Creatures adds a sixth rule and three new seams**, all of which fail
silently. The load-bearing one is that a boss's level bump (+2 Greater, +4
Supreme) must **never** be written to `system.details.level.value`. pf2e-flatten
implements Proficiency-without-Level by adding a custom modifier equal to minus
the actor's stored level and re-flattening whenever that level changes, so
storing the bump makes it subtract that much a second time from every check and
DC the boss makes: a Supreme boss comes out four points *worse* than the creature
it was built from, in PWoL worlds only, with every number on its sheet looking
ordinary. That is the same trap Flatfinder's own `adjustments.js` is written to
avoid for Elite/Weak. The level lives in a flag and is read back out for
incapacitation only.

Second, the Boss DC is a **static** number computed from the level table, so
nothing in pf2e-flatten can reach it. In a PWoL world the PCs' saves are
flattened by their own level and this DC would not be, leaving every save against
the boss about a level too hard while each number involved looks right on its
own; `bossDc()` takes the actor's own flattening offset for that reason. Third,
the level bump and the XP multiplier must reach Flatfinder by *different* routes:
`threatXp` already derives XP from the level difference, so a boss level fed into
that lookup on top of the ×2/×3 factor counts the boss twice.

Two more. The book's turn rotations ("the boss's second turn typically occurs
after 2 members of the party have acted") are stated **for a party of four**;
stored literally they place two boss turns back to back at a table of five, which
the same page forbids outright, so `turnOffsets()` re-derives them as fractions of
the real party and `planTurns()` clamps an overflowing offset to the bottom of the
round rather than letting it wrap above the boss's own initiative. And the two
Downfall locks are **different locks** — one Downfall per boss *turn*, and a
specific trigger spent until the boss's next *initial* turn — which matters
because a Supreme boss takes three turns between initial turns, so collapsing them
lets one critical hit disrupt it twice in a round.

An extra turn is a real Combatant carrying the boss's **own actor and token**, so
it answers yes to every "is this a boss?" test in the feature. Sync one and it is
given extras of its own, each of which fires `createCombatant` and syncs again,
so the encounter doubles its boss entries per pass — in a live world that reached
~1800 combatants and hung the client inside a minute. The hook filter and
`syncBossTurns` both refuse an extra turn, and the check tool requires both,
because one guard is one edit away from being the only one.

On the rail the boss effect is the one card effect drawn **under** the portrait,
and two rules have to agree for it to exist at all. The canvas is parked below
the portrait layer, and the boss portrait is masked so the creature dissolves
into the liquid at its edges. Break, dying and scramble are things happening *to*
a creature and belong over its face; a boss's miasma is what it is standing in, and
laid over the art it is just a coloured film on somebody. Without the mask the
canvas is behind a full-bleed opaque cover image and can never be seen, which
looks exactly like WebGL being unavailable — and a mask on a portrait reads as a
cosmetic vignette, so it is the half that will be deleted. The check tool
requires both.

A boss card is also **bigger** than the cards around it, which is the only cue
that survives a glance, and that has to be restated inside the `@media
(max-width: 720px)` block: the narrow layout sets the height at
`.gluni-card .gluni-card-surface`, tying the boss rules on specificity and
beating them on order, so a boss below 720px came out exactly the size of the
creatures it towers over while the desktop rail looked correct. The check tool
measures both layouts.

The boss panel is on **its own sheet tab**, and that tab is this feature's, not
PF2e's. AppV1 binds a sheet's `Tabs` inside `activateListeners`, which runs
*before* the render hook, so a nav link injected from a module is invisible to it
and the page has to be activated by hand. Two consequences are load-bearing:
Foundry's `Tabs` must never be handed this tab's name (its `active` has to keep
naming one of the sheet's real tabs, or the next render restores nothing and the
body comes back blank), and *leaving* the tab has to be done by hand too, since
Foundry still believes the tab being clicked is the active one and its handler
no-ops.

Multi-turn initiative has two completely separate implementations and they must
never both run. Card mode already models it through the per-actor
`init.cardConfig` `{cards, turns}` flag; standard mode has nothing (nothing in the
suite wraps `Combat#setupTurns`, subclasses `Combatant`, or mutates
`combat.turns`), so a boss there gets N−1 extra real Combatant documents flagged
as its Nth turn. A boss carrying both would be dealt nine turns a round.

Two PF2e data-model facts this feature depends on. An NPC has **no DataModel**
(`CONFIG.Actor.dataModels` covers army/familiar/hazard/loot/party/vehicle only),
so `system.attributes.hp.max` is an unvalidated `_source` field and an
`actor.update()` on it persists — but `CreaturePF2e#_preUpdate` clamps an incoming
`hp.value` against the maximum the actor has *at that moment*, so max and value
must be written in two updates or the boss gains its Hit Points and immediately
sits at half of them. And PF2e's trait field is a tagify widget built with
`enforceWhitelist`, so a trait the system has no entry for survives an
`update()` and is then dropped the first time a GM touches the traits on that
item; the book's own new traits (`boss`, `telegraph`) therefore live in
`bookTraits` and are printed in the description instead of becoming trait chips.
See `docs/BOSS_RULES.md`.

A fifth rule from the same book section, **Belts**, deliberately ships no code —
a PF2e container with `system.stowing = false` already holds four items at full
Bulk. The check tool fails if a `belt.mjs` ever appears, so that decision is not
quietly reversed.

**When touching the Creaturedex** (`features/pf2e-creaturedex/`), re-run its
consistency check. Everything it covers fails *silently*.

A section key is **data**: it is written into world knowledge the moment a GM
reveals anything, so renaming one does not throw — it forgets every creature the
party has ever learned, on the next load, with nothing reported. The book prints
an exact field list per section and the check is the only place that list is
compared against the code; a field in *two* sections is worse than a field in
none, because the player buys one section and silently receives part of another.
PF2e's own `system.category` (`interaction` / `defensive` / `offensive`) is the
book's three headings under other names, so an ability routes itself — but the
field's schema default is `null`, PF2e's own NPC sheet never reads it (it groups
by action cost instead) and its only consumer anywhere in the system is a
compendium-browser filter, so most bestiary abilities arrive **untagged**. A
guess from the action cost gets a majority right and the rest *leak*: an
offensive ability filed under Defense hands a player exactly what they did not
buy, and the stat block still looks ordinary. So an untagged ability routes
nowhere and is **deferred to completion**, where there is nothing left to leak.
`abilitySection` returning null is what makes that possible, and the check
refuses a fallback that guesses.

**The reveal is the GM's click, and the absence of a roll hook is pinned.** The
book's trigger is a Recall Knowledge check; the module's is a button, because
knowledge gets granted at a real table for reasons a roll does not cover — a
check made out of character, a creature nobody targeted, a correction after a
misclick. Wiring it back to a chat card is a change that reads as an improvement
in its own diff and puts a *player's click on the write path of a world setting*,
which then needs a socket that re-derives every claim it is handed because a raw
Foundry socket carries no attested identity. `chat.mjs`, `reveal.mjs`, a
chat-card hook, a socket and any read of `context.outcome` are all refused
outright for that reason.

The load-bearing one now is that **the store holds rendered snapshots, not
pointers.** Foundry hands every client the full Actor document, so a player who
holds no permission on a creature can still read `actor.system` from the console.
A dex that stored "Seri knows Defense" and rendered it out of the live actor
would be drawing a lock on the player's own screen over data one line away —
theatre, with every screen looking correct. A section is rendered by the GM's
client at reveal time and the *result* is stored, so the store contains exactly
what was handed over; redacting the last holder drops the snapshot with it, which
is that guarantee's other half. Snapshots are taken **post-flatten**, since
`pf2e-flatten` rewrites NPC numbers and the player should see what will really
apply at their table, and a section is therefore a memory rather than a live
view — which is why there is a Refresh action.

Two more. Identity is the creature's **kind**: the compendium source where there
is one, else a normalised name-and-level slug. One goblin warrior exists as the
compendium entry, a world duplicate and a `statsblock-import` creation all at
once, so keying on `actor.uuid` files three monsters and completes none of them;
the level is in the slug because a hand-built elite should not have the ordinary
goblin's AC answer for it. And a false section is stored beside the true ones and
rendered **identically** to its holder, marked only in the GM's view — a lie a
player can see is not a lie.

The doctoring pass that generates a lie has two rules a diff cannot show. A drift
is **never zero**, or the one row a player checks comes back as the truth while
the GM cannot tell from the dialog. And **immunities are never altered in either
direction**: removing one empties the poison rogue's whole kit into something
that was never going to care, and inventing one stops them trying at all. That
one is pinned twice — behaviourally, and structurally on the switch — because a
PF2e immunity list is words with no digits in it, so routing it into the numeric
drift changes nothing, passes every value assertion, and leaves the source saying
immunities are fair game for the next row shape that carries a number.

```bash
node tools/creaturedex-check.mjs
```

Zero problems required. It cannot show you how any of it looks, and the sealed
plate can only be judged beside a revealed section:

```bash
node tools/creaturedex-preview.mjs --out=.preview/dex.html && node tools/preview-server.mjs 8953
```

**Serve it.** The page puts the player view next to the GM view, draws the
reveal notice at a real chat log's 14px (the only size at which an unsized button
looks wrong) and shows the Falsify dialog, which is the last screen a lie passes
before a player sees it. See `docs/CREATUREDEX.md`.

Two more things it pins, both of which are silent. A whole-party reveal is a
**fan-out**, one row per member, never a shared `party` row: Party Knowledge is a
*read* — a union over the owners — so that a table can turn it off mid-campaign
without inventing or destroying a fact, and a shared row would read back only
while it was on. And every road in — the scene control, the `K` keybinding, the token
HUD button, the actor-directory right-click, an open window following the target
— has to ask `mayView` first. An
unknown creature's entry prints its **actor** name and portrait, and a GM who hid
a token's name did so on purpose, so a window that opens anyway quietly
identifies the thing the party is looking at. Knowing a *lie* counts as knowing
something there: a player told one cannot see that it is false, so refusing to
open is the module losing the only thing they were given.

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
