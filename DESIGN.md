---
name: GLUniverse Suite
description: Ink and Signal. Black chrome that sits on any campaign's art, paper text, and hue only where it means something.
colors:
  ink-0: "#05060a"
  ink-1: "#0a0b11"
  ink-2: "#0f1017"
  ink-3: "#15171f"
  ink-4: "#1c1e28"
  ink-5: "#272a36"
  ink-6: "#353846"
  text: "#f4f4f7"
  paper: "#ecedf2"
  dim: "#b3b5c2"
  faint: "#7f8291"
  steel: "#8e91a0"
  on-slab: "#05060a"
  signal-amber: "#ffb020"
  signal-red: "#ff4d5a"
  signal-green: "#2fb672"
  signal-ember: "#ff8a3d"
  signal-info: "#4aa3ff"
typography:
  display:
    fontFamily: "Google Sans Flex, Google Sans, Segoe UI, system-ui, sans-serif"
    fontSize: "22px"
    fontWeight: 750
    lineHeight: 1.1
    letterSpacing: "-0.01em"
  title:
    fontFamily: "Google Sans Flex, Google Sans, Segoe UI, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 700
    lineHeight: 1.2
  lead:
    fontFamily: "Google Sans Flex, Google Sans, Segoe UI, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 600
    lineHeight: 1.35
  body:
    fontFamily: "Google Sans Flex, Google Sans, Segoe UI, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.4
  control:
    fontFamily: "Google Sans Flex, Google Sans, Segoe UI, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: 1.1
  label:
    fontFamily: "Google Sans Flex, Google Sans, Segoe UI, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "0.1em"
  number:
    fontFamily: "Bahnschrift, JetBrains Mono, Google Sans, Consolas, monospace"
    fontWeight: 500
    fontFeature: "tnum"
rounded:
  hairline: "2px"
  dot: "50%"
spacing:
  cut-lg: "10px"
  cut: "8px"
  cut-sm: "5px"
  cut-xs: "3px"
components:
  button:
    backgroundColor: "{colors.ink-3}"
    textColor: "{colors.text}"
    typography: "{typography.control}"
    padding: "0 12px"
    height: "32px"
  button-hover:
    backgroundColor: "{colors.ink-4}"
    textColor: "{colors.text}"
  button-primary:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.on-slab}"
    typography: "{typography.control}"
  plate:
    backgroundColor: "{colors.ink-2}"
    textColor: "{colors.text}"
    padding: "0 14px 12px 16px"
  panel:
    backgroundColor: "{colors.ink-1}"
    textColor: "{colors.text}"
  field:
    backgroundColor: "{colors.ink-0}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    height: "32px"
  label:
    textColor: "{colors.faint}"
    typography: "{typography.label}"
---

# Design System: GLUniverse Suite

## Overview

**Creative North Star: "Ink and Signal"**

The suite is migrating from Etched Glass (cool tinted glass, the blue accent, glows, a display face) to Ink and Signal. Ten feature sheets were rebuilt on it in the remakes merged on 2026-11-03: Stream Pacer, Resource Trackers, the Creaturedex, PF2e Odds, the stream view, Stage's Director, Theatre's apps, Mythic GME, Flatfinder and Destiny Dice (`docs/adr/0003` to `0011`). Since 2026-11-04 the system's values live once in core as the `--gl-is-*` family, and those ten sheets alias them (`docs/adr/0012`). Every other surface still runs Etched Glass and moves over feature by feature. **New work uses Ink and Signal. Etched Glass is legacy.** The one surface that keeps its own look when the migration ends is the Aegis campaign skin of the initiative rail and Combat Intro (`docs/adr/0001`).

The chrome is black ink, so it sits on a fantasy map, a horror one-shot or a sci-fi deck without picking a setting. Text is paper. Hue is a signal and nothing else: amber for a call, red for danger, green for good, ember for heat, info blue for a neutral shift, steel for the quiet and the negative. Because the chrome says nothing, the one thing that matters on a panel (the answer, the hand, the clock about to fill) can be the loudest thing on it without shouting. It still reads as GLUniverse through three things it keeps from the old system: the cut corner, the type, and the motion.

Density is a GM console's: small, tight, scannable, and everything a player or the stream reads mid-scene must still read at a glance.

**Key Characteristics:**
- A black-leaning neutral ink ramp (seven steps) with paper text.
- Hue only where it means something, routed through one per-element tone variable.
- Flat plates separated by tone steps and 1px inset hairlines, not borders or glows.
- The chamfered bottom-right corner on plates and controls, the 115° wedge on tags.
- Google Sans Flex for everything, a tabular technical face for numbers.
- Five type sizes, nothing under 11px.
- Motion from the suite's duration and easing tokens, always on.

### Where the tokens live

- **Core.** `styles/gl-tokens.css` declares the `--gl-is-*` family on `:root`: the ink ramp (`--gl-is-ink-0` to `-6`), the tones (`text`, `paper`, `dim`, `faint`, `steel`, `on-slab`), the signals (`amber`, `red`, `green`, `ember`, `info`), hairlines and shade (`line`, `line-strong`, `shade`), states (`hover`, `selected`, `press`, `disabled`, `focus-ring`, `focus-offset`), the type scale (`t-meta`, `t-body`, `t-lead`, `t-title`, `t-display`), the cut scale (`cut-lg`, `cut`, `cut-sm`, `cut-xs`, `radius`) and the faces (`font`, `num`).
- **Feature skins.** A skin keeps its prefix and roots and aliases core there: `--gmyth-ink-2: var(--gl-is-ink-2)`. A skin never restates a value and never writes on `:root`. Sizes, cuts and states are read straight from core (`font-size: var(--gl-is-t-meta)`).
- **The name.** The family is `--gl-is-*` because Etched Glass already owns `--gl-ink-0` to `-3`. When Etched Glass retires, the family can be renamed in one pass.
- **What stays shared with Etched Glass.** Motion (`--gl-d-*`, `--gl-ease*`, `--gl-stagger`, `--gl-lift`), the tint channels, glass strength (`--gl-glass-k`, `--gl-blur`), the fonts (`styles/gl-fonts.css`) and the JS palette mirror (`scripts/core/theme.mjs`; its `INK_SIGNAL` export carries the `--gl-is-*` hex values for canvas work).
- **To see it.** `node tools/ink-signal-preview.mjs && node tools/preview-server.mjs`, then `/.preview/ink-signal.html`. Every value there is read back from the shipped CSS, with a contrast grid for both grounds.

## Colors

A black ink ramp with paper text and six signal hues, each with one job.

### Primary
- **Paper** (`paper`): the "yes", the hand raised, the selected state, focus outlines and the active edge of a plate. It is the default tone, which is why most of a panel reads in black and white.

### Secondary
- **Call Amber** (`signal-amber`): a call for attention, a countdown, an event. The loudest hue in the system.
- **Alarm Red** (`signal-red`): danger, failure, an exceptional "no", a safety signal.
- **Clear Green** (`signal-green`): good, success, an exceptional "yes", a cue that is live.

### Tertiary
- **Ember** (`signal-ember`): heat and escalation that is not yet danger (Stream Pacer).
- **Info Blue** (`signal-info`): a neutral shift or a fact with no verdict (Mythic's scene shift, the Creaturedex's knowledge section).
- **Steel** (`steel`): the quiet tone. A "no", a legacy row, the inactive state. A neutral that still reads as a deliberate tone.

### Neutral
- **Void** (`ink-0`): the deepest well, behind everything; window edges, fields and the darkest trough.
- **Night** (`ink-1`): window and panel ground.
- **Slate Plate** (`ink-2`): the standard plate a section or card sits on.
- **Raised Slate** (`ink-3`): controls at rest.
- **Lit Slate** (`ink-4`): controls on hover.
- **Rule Slate** (`ink-5`) and **Edge Slate** (`ink-6`): tracks, meters and the strongest neutral fills. Not text grounds.
- **Bright Paper** (`text`): body text.
- **Dim** (`dim`): secondary text that still has to be read. Passes on every step.
- **Faint** (`faint`): labels, counts and meta, on `ink-0` to `ink-3` only (4.7 to 5.3:1). On `ink-4` and lighter use Dim.
- **On Slab** (`on-slab`): text on a filled tone slab or a primary button.
- Signal hues and steel used as text pass on `ink-0` to `ink-4`.
- Hairlines and veils come from the tint channels: line `/ 0.08`, strong line `/ 0.16`, hover veil `/ 0.05`, selected veil `/ 0.09`, shade `rgb(var(--gl-tint-dark) / 0.55)`.

### Paper ground
`.gl-is-paper` restates every role for a host known to be light: the ramp runs from `#f7f7f9` down to `#a6a9b7`, text is near-black, and the signals are darkened (amber `#8f5600`, red `#b81c2d`, green `#11714a`, ember `#a64808`, info `#185fbb`) so each passes 4.5:1 on paper `ink-0` to `ink-3`. Hairlines and veils are restated there from the dark tint channel, because a `var()` resolves where it is declared. Flatfinder's chat badge and Destiny Dice's strip stay ink plates on parchment (ADR 0010): they do not know which ground they land on.

### Named Rules
**The Signal Rule.** A hue appears only when it means something. If removing the colour loses no information, the element is ink or paper.

**The One Tone Rule.** An element's hue is set once, through its feature's `--<prefix>-tone` on a scoped class or `data-tone`. Its edge, fill, text and chat card all read that one variable, so a retone is one class swap.

**The No Violet Rule.** Violet, cyan and the holographic accents of Etched Glass do not appear in Ink and Signal. They read as one setting, and violet for "unknown" spent a hue on the absence of information.

**The Alias Rule.** A feature skin aliases `--gl-is-*`; it never restates a ramp, tone or signal value. A hex in a skin that equals a core value is drift.

## Typography

**Display Font:** Google Sans Flex (with Google Sans for Thai, then Segoe UI, system-ui), `--gl-is-font`
**Body Font:** Google Sans Flex
**Number Font:** the core technical face (Bahnschrift, then JetBrains Mono), `--gl-is-num`, for numbers only

**Character:** one variable sans does every job by weight, width and case, so the type reads as a single voice; numbers switch to a technical face with tabular figures so counts and dice never jitter.

### Hierarchy
Five sizes, each a core token. Weight and case do the rest.
- **Display** (`--gl-is-t-display`, 22px, 750, 1.1, -0.01em): the one name or answer a panel is about (a creature's name, the oracle's answer).
- **Title** (`--gl-is-t-title`, 15px, 700, 1.2): window and section titles.
- **Lead** (`--gl-is-t-lead`, 13px, 600): row names and the line a plate leads with.
- **Body** (`--gl-is-t-body`, 12px, 500, 1.4): rows, descriptions, card text. Controls are 12px at 600.
- **Meta** (`--gl-is-t-meta`, 11px): labels (700, 0.1em, uppercase), counts, notes and timestamps.
- **Number** (`--gl-is-num`, tabular): counts, totals, DCs, timers, at whichever size its row uses.

Sizes of 16px and up other than 22 (a hero numeral, an icon glyph) stay literal where a feature needs them.

### Named Rules
**The Size-It-Yourself Rule.** `.gl-btn` and Foundry leave a button's size to its host, so every control a feature ships declares its own font size. A button that inherits it renders at 14px in a chat log and larger on a sheet.

**The Floor Rule.** Nothing is set under 11px. Labels included. A player or the stream reads these panels mid-scene, and 9 or 10px text over a moving map is noise. Only icon glyphs may go smaller.

## Layout

Panels are compact columns of stacked plates with small, regular gaps, sized for a GM console beside the canvas and for a 1080p capture. Controls are 32px tall with 12px of side padding; plates carry about 14 to 16px of inner padding with the active edge on the left. Floating surfaces (the Pacer band, the trackers dock, the stream overlay) sit over the map and keep to the screen edges. Responsive behaviour is window width, not device: narrow windows stack, compact modes drop secondary rows. Text that grows to the floor wraps or ellipsizes; it never sits in a fixed height.

## Elevation & Depth

Flat by default. Depth comes from stepping the ink ramp (window on `ink-1`, plate on `ink-2`, control on `ink-3`, hover on `ink-4`) and from 1px inset hairlines, not from shadows or borders. A drop shadow appears only under something that floats free of its window: a popover, a docked HUD, a splash.

### Shadow Vocabulary
- **Hairline** (`box-shadow: inset 0 0 0 1px var(--gl-is-line)`): the outline of a plate or control at rest.
- **Strong hairline** (`inset 0 0 0 1px var(--gl-is-line-strong)`): hover, selection, a field, a plate that needs separating from its neighbour.
- **Tone edge** (`inset 2px 0 0 <tone>`): the active or meaningful edge of a row or plate.
- **Float** (`0 24px 64px var(--gl-is-shade)`): a surface floating over the canvas.

### Named Rules
**The No Glow Rule.** Nothing glows at rest. Zero-offset coloured shadows, radial halos and bloom belong to Etched Glass and to the cinematic beats, not to panels.

## Shapes

The cut corner carries the brand. Plates and controls are square except for one chamfered bottom-right corner, drawn with `clip-path: polygon(...)` from the cut scale:
- `--gl-is-cut-lg` (10px): slabs, answer plates, window-sized cards.
- `--gl-is-cut` (8px): panels and plates.
- `--gl-is-cut-sm` (5px): controls.
- `--gl-is-cut-xs` (3px): tags and pips.

Tags take a slanted 115° wedge. Where a radius is unavoidable it is `--gl-is-radius` (2px); circles are reserved for dots, pips and avatars.

## Components

### States
Every interactive element uses the same five, all core tokens:
- **Hover:** a control steps up one ink (`ink-3` to `ink-4`) and lifts by `--gl-lift`; a row takes the `--gl-is-hover` veil.
- **Selected:** a row takes `--gl-is-selected` plus its tone edge; a segmented cell takes `ink-4` and Bright Paper.
- **Press:** `scale: var(--gl-is-press)` (0.97).
- **Disabled:** `opacity: var(--gl-is-disabled)` (0.32), no lift.
- **Focus:** `outline: var(--gl-is-focus-ring)` (2px Paper) at `--gl-is-focus-offset` (1px). A control that sits flush against an edge may use a larger offset.

### Buttons
- **Shape:** square with the `cut-sm` corner.
- **Default:** Raised Slate fill, Bright Paper text, control type, hairline inset, 32px tall.
- **Primary:** Paper fill, On Slab text, no hairline. One per panel.
- **States:** as above, over `--gl-d-brisk`.

### Chips (tone tags)
- **Style:** a slab in the element's tone with On Slab text, or ink with a tone edge, cut with the 115° wedge, meta type.
- **State:** the tone is the state. Changing state changes the tone class, never the shape.

### Cards / Containers
- **Corner Style:** `cut` or `cut-lg`.
- **Background:** Slate Plate on a Night window.
- **Shadow Strategy:** hairline inset at rest; tone edge for meaning; no float.
- **Border:** none. The inset hairline does that job.
- **Internal Padding:** about 14px, with the tone edge on the left.
- **Nesting:** a plate does not sit inside another plate. Separate inner groups with spacing, a hairline rule or a tone step.

### Inputs / Fields
- **Style:** Void fill, strong hairline inset, square, body type, 32px tall.
- **Focus:** the focus ring.

### Navigation
- **Style:** tabs and segmented pickers as flat ink cells; the selected cell takes `ink-4` and Paper text (or the tone) as an underline or edge, never a filled glow.

### Signal band (signature)
Stream Pacer's band is the system at full volume: solid tone slabs (amber for a call, red for danger, paper for a hand) drawn over every screen, loud enough to be seen by a player looking at the map. The rest of the system is quiet so that this can be loud.

## Do's and Don'ts

### Do:
- **Do** build new UI in Ink and Signal, under the feature's own roots and prefix, never on `:root`.
- **Do** alias `--gl-is-*` in a skin and read sizes, cuts and states straight from core (The Alias Rule).
- **Do** route hue through one `--<prefix>-tone` per element (The One Tone Rule).
- **Do** take every duration and easing from `--gl-d-*` and `--gl-ease*`, prefix your own keyframes with the feature's prefix, and write any blur against `--gl-glass-k`.
- **Do** size every control in its own sheet, and size hairlines in device pixels.
- **Do** keep faint text on `ink-0` to `ink-3`, and signal or steel text on `ink-0` to `ink-4`.
- **Do** check new tokens on the specimen page (`/.preview/ink-signal.html`) on both grounds.

### Don't:
- **Don't** start new work in Etched Glass, or mix its glass, glows and blue accent into a migrated surface.
- **Don't** restate a core value in a skin, or set text under 11px (The Floor Rule).
- **Don't** use violet, cyan or holographic accents (The No Violet Rule).
- **Don't** put a hue on something that carries no meaning (The Signal Rule).
- **Don't** glow at rest: no zero-offset coloured shadows, no radial halos on panels.
- **Don't** nest plates.
- **Don't** redeclare a foundation `--gl-*` token, add `@font-face`, or add a network `@import`.
- **Don't** add `prefers-reduced-motion` handling. Motion always plays; the in-app motion tier is the user's control.
- **Don't** rename an existing class prefix or i18n key while migrating a feature.
- **Don't** migrate the Aegis skin. The initiative rail and Combat Intro keep it (ADR 0001).
