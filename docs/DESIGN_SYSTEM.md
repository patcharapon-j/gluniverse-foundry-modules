# GLUniverse Suite — Etched Glass design system

The suite ships **one** theme: Etched Glass. This document describes the pool a
feature draws from, and the contract that keeps that single theme *rethemeable*
rather than hardcoded into 30 stylesheets.

If you are adding or porting a feature, read this alongside
[`FEATURE_CONTRACT.md`](FEATURE_CONTRACT.md).

---

## Where things live

| File | Owns |
|---|---|
| `styles/gl-fonts.css` | The only `@font-face` declarations in the suite. |
| `styles/gl-tokens.css` | Every canonical `--gl-*` token, plus the shared utility classes. |
| `styles/gl-motion.css` | Every shared `@keyframes` and the `.gl-anim-*` utilities. |
| `scripts/core/theme.mjs` | The JS mirror: palette, colour maths, motion tiers, retheme hook. |
| `styles/<feature>.css` | That feature's own rules — and nothing that belongs above. |

These three stylesheets load first (in that order), so everything downstream can
assume the tokens exist.

---

## The five layers

`gl-tokens.css` is organised as layers. Which layer a value belongs to
determines who may write it.

**L0 — Primitives.** Raw material: the two tint channels, the ink ramp, and the
fixed semantic hues. A retheme rewrites L0.

**L1 — Theme contract.** The short list a theme is *allowed* to override:
`--gl-accent`, the surface mix ratios, `--gl-blur` / `--gl-saturation`, the two
typefaces, the chamfer geometry, and `--gl-motion-scale`.

**L2 — Semantic.** Derived meaning: surfaces, lines, elevation, the motion
vocabulary. **This is what feature CSS consumes.**

**L3 — Scales.** Discrete steps for space, type, radius and z-index.

**L4 — Utilities.** Opt-in classes: `.gl-glass`, `.gl-btn`, `.gl-icon-btn`,
`.gl-field`, `.gl-well`, `.gl-chip`, `.gl-panel-head`, `.gl-rule`, `.gl-empty`,
`.gl-notch`, `.gl-hover-lift`, `.gl-tech-label`, `.gl-scroll`, `.gl-numeric`,
`.gl-type`.

---

## The rules

### 1. Never redeclare a foundation token outside `gl-tokens.css`

A feature stylesheet writing `--gl-cut: 14px` on `:root` changes the chamfer for
*every* feature that loads after it. Custom properties are global and cascading;
there is no module scope. If a feature needs its own value, give it its own name:

```css
/* wrong — silently repaints the rest of the suite */
:root { --gl-cut: 14px; }

/* right */
:root { --glucargo-cut: 14px; }
```

The one sanctioned exception is remapping the accent channel on a **scoped**
selector — see rule 2.

### 2. Route identity through `--gl-accent`

One variable carries contextual colour. Remap it on a feature root or a state
selector and every derived surface, glow, rim and focus ring follows:

```css
.my-feature                   { --gl-accent: var(--gl-cyan); }
.my-feature[data-tier="hot"]  { --gl-accent: var(--gl-hazard); }
```

Do not hardcode a hue you could route through the accent. Do not pin
`--gl-accent` to a literal that merely restates the default — that makes your
feature the one surface a retheme cannot move.

### 3. Use a semantic hue when the colour carries meaning

The fixed hues are deliberately independent of the accent: a hazard must read as
hazard whatever the campaign colour is.

`--gl-signal` (ceremony/commit) · `--gl-cyan` (system) · `--gl-hazard` (danger)
· `--gl-peril` (escalation beyond hazard) · `--gl-good` (success) · `--gl-info`
(deferred) · `--gl-warn` (strain) · `--gl-violet` (secret) · `--gl-orchid`
(dying) · `--gl-jade` (conditions) · `--gl-teal` (stabilised) · `--gl-mission`
(objective) · `--gl-apex*` (solo boss)

Most have a `-hot` variant for glow and peak states.

### 4. Strike translucent veils from a tint channel

Roughly 1,200 rim-lights, hairlines and inner shadows across the suite are
translucent white or black. There are ~80 distinct alpha values in use, so a
named token per value is not workable. Instead the *colour* is tokenised and the
*alpha* stays inline, where it belongs:

```css
border-top: 1px solid rgb(var(--gl-tint-light) / 0.06);
box-shadow: inset 0 -8px 20px rgb(var(--gl-tint-dark) / 0.42);
```

Prefer a semantic token when one fits — `--gl-hair`, `--gl-edge`,
`--gl-glass-highlight`, `--gl-glass-shade`, `--gl-shadow`, `--gl-scrim` — since
it says what the veil is *for*. Reach for the raw channel only when none does.

Both forms retheme together: a light mode swaps the two channel definitions in
L0 and every veil in the suite inverts.

### 5. Never write a raw duration or easing

Durations all derive through `--gl-motion-scale`, so one number retimes
everything:

```css
transition: opacity var(--gl-d-quick) var(--gl-ease);
animation: gl-cascade var(--gl-d-reveal) var(--gl-ease) both;
```

| Duration | Base | For |
|---|---|---|
| `--gl-d-flash` | 70ms | micro-tick, beat gap |
| `--gl-d-tap` | 120ms | press feedback |
| `--gl-d-quick` | 180ms | hover, tint, focus |
| `--gl-d-brisk` | 260ms | small state change |
| `--gl-d-swift` | 340ms | card / row transition |
| `--gl-d-move` | 420ms | position / layout |
| `--gl-d-glide` | 540ms | long travel, exits |
| `--gl-d-reveal` | 620ms | entrance |
| `--gl-d-splash` | 720ms | full-screen beat |
| `--gl-d-slow` | 920ms | alert cycle, dwell |
| `--gl-d-cinematic` | 1200ms | ceremony |
| `--gl-breathe` / `--gl-dread` / `--gl-drift` | 2.6s / 3.2s / 4.2s | ambient loops with meaning |
| `--gl-loop-sm` … `--gl-loop-xl` | 6s / 12s / 22s / 38s | texture that merely has to move |

The ladder is deliberately fine-grained. It has to be: the features between them
used ~50 distinct literal durations, and a rung gap wide enough to force a
visible rounding error is a gap where literals survive — and **a literal
duration is invisible to `--gl-motion-scale`**, which is to say invisible to
every motion-tier setting the suite ships. Pick the nearest rung and move on;
if nothing is within ~15%, that is worth a second look before adding a rung.

Ambient loop values are not sacred. `9.5s`, `11s`, `12s`, `13s` and `14s` were
five spellings of "a background texture drifts"; they are one token now.

Six easings cover every gesture — pick by gesture, not by feel:
`--gl-ease` (decelerate to rest) · `--gl-snap` (slight overshoot) · `--gl-pop`
(pronounced overshoot) · `--gl-exit` (accelerate away) · `--gl-ease-inout`
(symmetric/reversible) · `--gl-ease-sharp` (decisive) · `--gl-linear` (loops).

### 6. Reuse the motion pool; prefix anything bespoke

`@keyframes` names are **global** — there is no scoping. Two files declaring
`gl-sheen` means the last one loaded wins for the whole suite, silently. So:

- Reuse a `gl-*` keyframe from `gl-motion.css` when one fits.
- A genuinely feature-specific motion gets the feature's prefix (`glinv-shatter`,
  `sp-campfire-flames`), **never** a bare `gl-` name.

Entrances: `gl-fade-in` `gl-cascade` `gl-rise-in` `gl-drop-in` `gl-pop-in`
`gl-stamp` · Exits: `gl-fade-out` `gl-sink-out` `gl-pop-out` · Ambient:
`gl-breathe` `gl-pulse` `gl-glow-pulse` `gl-dread` `gl-float` `gl-drift`
`gl-spin` `gl-blink` · Surface: `gl-sheen` `gl-sweep` `gl-scan` `gl-shimmer`
`gl-wipe-x` `gl-wipe-diag` `gl-signal-flash` `gl-burst` · Emphasis: `gl-shake`
`gl-flash` `gl-bump`.

### 6b. One physical vocabulary for interaction

An element rises slightly toward the cursor and sinks under the click. That is
the whole vocabulary; anything more is a bespoke effect, not an affordance.

```css
.thing:hover  { transform: translateY(var(--gl-lift)); }     /* -1px, small controls */
.card:hover   { transform: translateY(var(--gl-lift-lg)); }  /* -2px, cards + panels */
.thing:active { transform: translateY(var(--gl-press)) scale(var(--gl-press-scale)); }
```

Buttons inside a suite root already get the press for free (see the universal
`:active` rule in `gl-tokens.css`). That rule is written as the **independent
`scale` property**, not `transform: scale()`, precisely so it composes with a
control's existing transform instead of erasing it — the reason no blanket press
rule existed before. If you write a global rule that touches a transform, use
`scale` / `translate` / `rotate` for the same reason.

Keyboard focus is `--gl-focus-outline`, applied by the shared `:focus-visible`
rule to interactive elements inside every root the suite injects. It is an
`outline` and hover is a `box-shadow`, deliberately: half the suite's controls
draw their own border as an inset box-shadow, so a focus box-shadow would delete
a control's edge exactly when it gained focus. Add a new floating root to that
rule's selector list (and to the interface-scale list above it) when you build one.

### 6c. The chamfer has three sizes

`--gl-cut` (12px, panels/cards) · `--gl-cut-sm` (6px, buttons/chips) ·
`--gl-cut-xs` (4px, tags/pips/bars). The cut has to stay proportional to the
thing it cuts — 12px reads as a deliberate bevel on a panel and eats half the
edge of a 20px tag — but features had drifted to twelve sizes picked by eye.

`clip-path` cuts the *border* off the notched corner, so the suite's signature
corner is the one edge a panel does not draw by default. `.gl-glass` fixes this
for itself; anything else carrying a chamfer wants `.gl-notch`, or the gradient
directly as a background layer when the pseudo-elements are spoken for:

```css
background:
  var(--gl-chamfer-edge) top right / var(--gl-cut) var(--gl-cut) no-repeat,
  /* …the real background… */;
```

A feature sheet that declares its own `::before` on a `.gl-glass` element
replaces the shared chamfer edge (same specificity, later sheet). That is a
supported opt-out — check for it before adding one.

### 7. Never name a typeface literally

Use `--gl-display` (headings, hero numerals, chrome) and `--gl-tech`
(micro-labels, readouts, tabular numerals). Both faces are bundled and
offline-safe; **no stylesheet may add a `@font-face` or a network `@import`**.

Foundry styles `h1–h6, button, input, select, textarea, a, label` at element
level, which beats an inherited `font-family`. Any feature root that sets a font
must also carry `.gl-type` (or replicate its reset), or those controls silently
render in Foundry's Signika.

### 8. Keep JS colour out of features

PIXI, WebGL and `<canvas>` cannot read CSS custom properties, so
`scripts/core/theme.mjs` holds a hand-maintained mirror. Import from it; do not
hardcode a suite colour in JS.

```js
import { PALETTE, hexToRgbFloat, cssVar, applyMotionTier } from "../../core/theme.mjs";
```

`PALETTE` mirrors L0 · `hexToInt` / `hexToRgbFloat` for PIXI/GLSL · `mix`,
`lighten`, `darken`, `withAlpha` for derived tones · `cssVar()` reads the *live*
(possibly rethemed) value when an element is in the document — prefer it there.

> **Keep the mirror in sync.** When a hue changes in `gl-tokens.css` it must
> change in `theme.mjs` too. The same applies to the initiative feature's
> `constants.mjs` palettes, whose per-line comments name the token they mirror.

---

## Retheming

Everything the suite paints resolves from L0 + L1, so a retheme is a short
override sheet — not a fork.

```css
/* Warmer campaign, softer glass, calmer motion. */
:root {
  --gl-accent: #c98f4a;
  --gl-ink-0: #0a0705;  --gl-ink-1: #120d09;
  --gl-ink-2: #16100b;  --gl-ink-3: #2a1f16;
  --gl-blur: 10px;
  --gl-surface-mix: 6%;
  --gl-motion-scale: 0.8;
}
```

Canvas-based features can't observe that, so after changing tokens at runtime:

```js
import { refreshTheme } from "./scripts/core/theme.mjs";
refreshTheme();   // repaints registered PIXI/WebGL consumers
```

A feature with canvas FX registers its repaint path once:

```js
import { onThemeChange } from "../../core/theme.mjs";
onThemeChange(() => { cardFX?.notifyThemeChange?.(); overlay?.render?.(); });
```

### Motion tiers

A feature's "animation intensity" setting sets one number rather than shipping a
duration table:

```js
import { applyMotionTier } from "../../core/theme.mjs";
applyMotionTier("reduced");            // suite-wide
applyMotionTier("cinematic", myRoot);  // scoped to one feature
```

`none`/`off` → 0 · `reduced` → 0.6 · `default`/`full` → 1 · `cinematic` → 1.4.

**A JS timer that shadows a CSS duration must scale with it.** A `setTimeout`
that strips an animation class when the animation ends is a duplicate of a
number living in the stylesheet; once the stylesheet value scales, the two
disagree. At `cinematic` the timer fires *during* the animation and the element
snaps; at `none` it holds the class long after the animation resolved. Pass the
CSS baseline through `scaledMs()`:

```js
import { scaledMs } from "../../core/theme.mjs";
window.setTimeout(() => el.classList.remove("is-entering"), scaledMs(620));
```

Prefer an `animationend` / `transitionend` listener where one is practical.
`scaledMs()` is for the cases where several animations overlap on one element
and there is no single event to wait for. `motionScale()` reads the live
multiplier if you need it directly.

A feature whose tier *clamps* rather than scales (Loot Gen) must name every rung
it caps — anything omitted keeps its full length and the tier leaks.

The suite deliberately does **not** honour the OS `prefers-reduced-motion`
setting — motion is an explicit in-app choice. Do not add
`@media (prefers-reduced-motion)` blocks.

---

## Known hazards

**`#000` and `#fff` inside a mask are alpha, not colour.** In
`mask-image` / `-webkit-mask-image` the black and white stops of a gradient are
the mask's opacity ramp — black hides, white shows. There are ~48 of them in the
suite and they must NOT be routed through a tint channel: they are not veils,
they carry no theme meaning, and a sweep that "tokenizes" them is rewriting a
mask's geometry. Anything scripted over the stylesheets has to skip declarations
whose property matches `mask`.


**The game system may also use a `--gl-*` prefix.** `styles/mobile.css` reads
`--gl-parch`, `--gl-blood`, `--gl-serif` and friends *from the game system's*
stylesheet to match its chat cards. Those are not ours. They are always read
with a literal fallback (`var(--gl-parch, #f6f1e6)`) so they degrade safely — but
it means the `--gl-` namespace is not exclusively ours at runtime, and a system
defining `--gl-accent` on `:root` could collide. Keep suite tokens specific.

---

## Validating a change

There is no build step or CI. Before committing:

```bash
find scripts -name '*.mjs' -o -name '*.js' | xargs -I{} node --check {}
```

```bash
node -e "const fs=require('fs');for(const f of ['module.json',...fs.readdirSync('lang').map(x=>'lang/'+x)])JSON.parse(fs.readFileSync(f,'utf8'));console.log('JSON OK')"
```

Then confirm every path in `module.json` still resolves, and that a stylesheet
you touched has not reintroduced a raw hex, a network `@import`, a duplicate
`gl-*` keyframe, or a self-referential custom property.

Two greps catch the drift this document exists to prevent — a literal duration
or easing (invisible to every motion tier) and a literal weight or chamfer:

```bash
grep -rhoE '(transition|animation)(-duration|-delay)?:[^;{}]*' styles/*.css \
  | grep -oE '\b[0-9]*\.?[0-9]+(ms|s)\b|\b(ease-in-out|ease-out|ease-in)\b' | sort | uniq -c
```

```bash
grep -rhoE 'font-weight:\s*[0-9]+' styles/*.css | sort | uniq -c
grep -rhoE 'clip-path:[[:space:]]*polygon\([^;]*\)' styles/*.css \
  | grep -oE '(^|[^-0-9.])[0-9]+px' | sort | uniq -c
```

Both should come back empty apart from the handful of documented outliers
(`9px` / `16px` / `24px` chamfers, and `@font-face` weight ranges in
`gl-fonts.css`). A custom property holding a bare duration
(`--x: 640ms`) is the usual way one slips back in — the first grep will not see
it, so check those by eye.
