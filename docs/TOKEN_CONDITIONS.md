# Token Conditions

Replaces Foundry's grid of effect icons with a shader-drawn block on the token's
flank: PF2e's conditions with their counters, and the effects feats, items and
spells apply with their durations counting down.

Feature id `token-conditions`, setting prefix `tc.`, i18n `GLTC.*`, system `pf2e`.

---

## Why a shader, and why this one

Foundry draws effect icons as sprites in a grid over the token art. That form
cannot hold a bevel, a counter, a duration or a state, which is why the stock
icons look the way they do — and why a GM ends up hovering a token to find out
what the four grey squares on it mean.

The material is the **resource bar's**, deliberately and exactly: the same
layered body (stroke, air, trough, lip, face), the same single hard specular
under the top edge, the same chamfered corner, the same emission above 1.0 for
the same bloom to find. A condition plate and a health bar are two readings of
one creature and they have to look like it.

That resemblance is not a matter of copying hex values. What makes two HUD
elements look related is the **light**: a plate drawn in CSS beside a bar drawn
in GLSL has no emission over 1.0, no bloom and no bevel that survives a device
pixel, so it reads as a sticker next to an instrument however carefully its
palette was matched. The first pass at this feature was exactly that, and it
looked exactly as cheap as that predicts.

### What is not the bar's

Three constants had to be re-derived rather than copied, because the bar is
routinely 8:1 and a plate is square.

| | The bar | Here | Why |
|---|---|---|---|
| **Chamfer** | `0.85 × half-height` | `0.45 × min(half-width, half-height)` | On something eight times longer than it is tall, the bar's number is a nick. On a square plate it takes a bite out of two fifths of the face, pushes the sigil off centre, and reads as a page with the corner turned down. |
| **Air + lip** | `0.058` / `0.032` | `0.030` / `0.017` | The bar pays those margins on its short axis only. A plate pays them on both, and at 30px the layered construction otherwise leaves the sigil drawing inside a postage stamp. |
| **Icon bevel** | — | `0.015` of a cell | The etch differences the glyph's alpha against itself. PF2e's art is drawn at about a fourteenth of its cell, so an offset anywhere near that differences it against empty space along its *whole length*: every part reads as a lit top edge, the white filament floods the sigil, and every condition arrives white with a coloured halo. |

`shader.mjs`, `constants.mjs` (`PLATE`) and `host.mjs` describe one piece of
geometry from three places, so `tools/token-conditions-check.mjs` compares the
counter tab's three numbers against the literals in the GLSL on every run. Two
copies of one geometry does not read as a two-pixel error — it reads as two
people having drawn the same plate.

---

## Two sources, one shape

`data.mjs` resolves PF2e's two models into one list.

**Conditions** come from `actor.conditions.active`. That is PF2e's own resolution
of the override rules, so a condition suppressed by a higher-value one of the
same slug, or listed in another's `overrides`, is already excluded —
reimplementing it here would mean drawing "paralyzed" under "unconscious" on a
token whose sheet correctly shows one of them.

**Effects** come from `actor.itemTypes.effect` and `.affliction` — whatever a
feat, an item, a spell or a poison applied. Three gates, and each of them is
somebody's explicit decision rather than ours:

| Gate | Why it is not optional |
|---|---|
| `isExpired` | PF2e leaves an expired effect on the sheet, greyed out, until its owner clears it. Drawing it says the creature still has it. |
| `system.tokenIcon.show` | The system's own per-effect "show this on the token" switch. Every PF2e user knows where it is; a module that ignores it has taken a control away from them. |
| `isIdentified` | An unidentified effect is one the GM deliberately hid. |

The two groups are drawn **conditions first, effects after, with one wider gap**
between them — a column break in the packed block, a wider gap in the unfolded
list. The split is positional rather than chromatic and that is the load-bearing
decision in the feature: tone already carries *how bad*, and asking it to carry
*what kind of thing* as well would need twelve colours — which at 14px is no
colours. Position is free, exact, and survives a colour-blind viewer, the same
argument the resource bar's plates make for reading health by position as well as
by hue.

The cap applies to the **whole** rail rather than per group, because the cap
exists to stop the rail outgrowing the token's square and the square does not
care which group a plate was in. Conditions are taken first: a condition changes
what a creature can do this turn, and an effect is usually a modifier already
baked into a number somebody else is rolling. The tail spends one of the slots,
so a cap of eight with ten things shows seven and `+3` — the alternative silently
drops one more than the number says.

The GM's cap is a ceiling rather than a promise: `RailHost#capacityFor` floors it
at what the token's own square can hold, so a Tiny familiar on a 64px grid shows
six and a `+N` however high the setting goes. Without that floor the setting
would be a number that means "and then draw the rest on the creature standing
next to it".

---

## What an effect brings that a condition does not

### A duration

The tone rail along the bottom of the face is a **hairline on a condition and a
depleting gauge on anything timed**. One element, two jobs: the mark is in the
same place, the same weight and the same colour whether or not it is counting
down, and only its length means anything. A second row of furniture on the most
crowded part of the screen would cost more than it told you.

`life` is `remaining / total`, and **`null` and `0` are different answers**.
`null` draws the constant hairline — a condition, or an effect that lasts until
somebody removes it; `0` draws an empty gauge. Collapsing them puts a full-width
bar under every unlimited effect and makes the gauge meaningless on exactly the
plates that have one. The check tool pins both halves.

Durations are measured against the **world clock**, so the host refreshes on
`updateWorldTime` and `updateCombat` as well as on item changes. Without them a
gauge is frozen where it stood when the effect was applied, and an expired effect
stays on the token for the rest of the session.

### A sustain

A sustained effect draws its gauge in `PALETTE.signalPale`. Gold is the suite's
ceremony colour and appears in exactly one place per feature — the bar spends its
on the top of its own stroke — so here it means *somebody is spending an action
every round to keep this alive*, which is the one piece of duration information a
countdown cannot express. Nothing else in this feature is gold, including the
plate's stroke.

### A secret

An unidentified effect still gets a plate — a creature visibly has *something* on
it, which is what PF2e's own sheet tells a player — but it carries no name, no
artwork and no counter, and it says so with a diagonal hatch. A blank plate reads
as a bug; a hatched one reads as withheld.

**The redaction happens at the point of reading, not of drawing.** `data.mjs`
never puts the name, the image or the badge into the plate's state at all. A field
that is never populated cannot leak through a later refactor that draws one more
thing; a field that is populated and merely not drawn can, and eventually will.

### Somebody else's artwork

PF2e's condition art is a white silhouette on transparency, where alpha *is* the
shape. A spell's or an item's art is a full-colour illustration, often on an
opaque ground, where alpha is 1 everywhere — run through the silhouette path it
lights the whole icon box as a solid tone-coloured square.

`uArt` switches the sigil to its luminance instead. It costs one dot product and
it makes fifty different item icons read as one set of sigils rather than as a
sticker album. The choice is made from the image *path* (`/conditions/`), not
from its pixels, because the pixels are not available until the texture has
loaded and a plate that changes its lighting model one frame after it appears
reads as a bug.

---

## Tone

PF2e ships **no positive/negative flag** — not on a condition and not on an
effect. So colour can mean nothing until we decide what it means, and that
decision outlives the geometry: a GM learns "violet means an action was taken
away" once and then reads it for years.

| Tone | Colour | What it means |
|---|---|---|
| **peril** | `hazard` | The death track. Nothing else may outrank it. |
| **impair** | `warnDeep` | A number gets worse. Valued, almost always. |
| **control** | `violet` | Actions are taken away. |
| **sense** | `cyan` | What can be seen, heard or found. |
| **burden** | a steel | True, and rarely the thing you act on. |
| **boon** | `good` | The only tone that is good news. |

Six, held to two rules: every tone has to survive at a 16px plate on a dark map
(which rules out putting two of them on neighbouring ambers), and **none of them
may be the suite's gold**, which is spent on chrome and on a sustained gauge and
would otherwise mean two unrelated things.

Conditions map by slug. Effects resolve in three steps:

1. **A GM's per-effect flag** (`tc.tone` on the item), which wins outright.
2. **A trait that settles it** — `curse`, `disease`, `poison`, `death`,
   `incapacitation`, `misfortune`, `fear`, `healing`, `fortune`, `aura`. The
   table is deliberately short, because a trait says what an effect is *made of*
   rather than whether the creature wearing it is better off, and most effects
   are `magical`.
3. **Who applied it.** Self or no recorded origin is a buff; from another actor,
   the two tokens' dispositions decide. This is knowable where valence is not.

Step 3 is a heuristic and it will be wrong sometimes — a cleric's `Effect: Heal`
on an enemy undead is a real counterexample — which is exactly why step 1 exists.
The remedy for one wrong plate has to be fixing that plate, not turning the whole
channel off.

---

## Placement

There are **two arrangements**, and `layout()` computes both in full and
interpolates position *and* size between them by `entry.sel`. They are different
shapes rather than one shape at two scales, so easing the resting layout into the
expanded one would send plates to the wrong places; lerping between two complete
answers sends each plate where it belongs from wherever it happened to be.

**Packed** (`sel` 0) — the resting state. A block of small plates **inside the
token's own square**, filling column-first from the flank chosen by `tc.side`,
with as many rows as the square has room for and wrapping into a second and third
column.

A single column is legible at three plates and a liability at eight. A creature
in the sixth round of a real fight carries more conditions than a column can
hold, and the column answers by growing down through the two squares below it —
over whatever is standing there. A status readout that obscures the board it is
describing has stopped being a readout. Packing makes density cost *area* rather
than *trespass*, and the area it spends is the one square that is unambiguously
this creature's business.

The block reserves `LAYOUT.foot` at the token's bottom edge. Foundry draws its
own bars and nameplate across there, and the suite's resource bar straddles the
same edge; the reservation is unconditional rather than conditional on another
feature being enabled, because `constants.mjs` must not know that feature exists.

**Expanded** (`sel` 1) — one column of larger plates hung *outside* the flank,
each showing its name, and free to overlap the squares around it. That is not a
lapse in the rule above: it exists only while the cursor is on the token and it
goes away the moment the cursor leaves, so it can never be what somebody is
looking *past*. `LAYOUT.selScale` gives back the size the packed block traded for
density, so a name is read at the size it was drawn for.

Names appear only past `LAYOUT.nameAt`: a label laid out against the expanded
width while the plate is still nearly square hangs off the end of it.

Everything is derived from the scene's **grid** and the token's **square**, never
from its artwork: a creature whose art is scaled to 1.4 is still standing in one
square, and a block that followed the art would be a different size on every
token. The
per-token offsets (`tc.offsetX` / `tc.offsetY` flags) are in grid squares for the
same reason, and a per-token value **replaces** the world default rather than
adding to it — the additive reading looks friendlier and silently drags every
hand-placed token when the GM later moves the default.

---

## The beat

| | |
|---|---|
| **0ms** | the plate exists, at nothing, and everything holds |
| **~55ms** | the hitstop releases; the print starts from a standstill |
| **~305ms** | the wipe has crossed and the hot front is gone |
| **~355ms** | the flash has decayed and the plate is at rest |

Arrival is a **wipe with a hot front**, not a fade and not a scale. A plate that
scales in is a plate that was somewhere else a moment ago, which is the wrong
story: a condition is not thrown at a creature, it is *applied*. Scaling is also
the one thing the resource bar refuses to do, and two neighbouring instruments
that disagree about whether geometry may move read as two different HUDs.

`uEnter` runs both ways, so a removal is the arrival reversed — one channel, two
events, and no second code path to keep in agreement with the first. A plate
removed mid-print un-prints from wherever it had got to.

**The breath is the resource bar's own clock**, `uTime * 1.35`, unchanged. Two
red pulses at different rates read as two unrelated warnings; on one rate, a
dying creature's bar and its `DYING` plate are visibly one alarm, and an effect a
round from falling off breathes with them. Only `dying` and an expiring effect
breathe — routing the pulse off the *tone* put wounded, doomed and persistent
damage on the same alarm, and three things pulsing at once is three things
nothing is urgent about.

Under load, `SHED_ORDER` in `anim.mjs` gives effects up cheapest-first until the
rolling frame time is back inside budget: breath, then flash, then the print. The
event is the last thing to go. Every animated behaviour must appear in that list
and the check tool enforces it, so a new effect cannot be added that never
degrades.

The **unfold is deliberately not in that list**. It runs on the one token under
the cursor, it is what the viewer just asked for, and a hover that stops
answering under load is a broken control rather than a degraded effect.

Expansion also adds **no moving light**. An earlier version crossed the face with
a travelling specular on the bar's own 0.30 Hz; on a bar eight times as wide that
reads as a sweep, but on a plate it is a flicker — and it is a flicker underneath
the one word the whole gesture exists to let you read. What expansion adds is
static: the stroke lifts toward the tone and the contact glow widens.

---

## Permission

**Never draw on a token this client cannot see, and never resolve an
unidentified effect for a non-GM.** Both failures render perfectly, raise
nothing, and are discovered only when a player says something they should not
have known.

`visibility.mjs` defers to Foundry's own `token.visible` rather than
reimplementing the vision rules, so it cannot drift from core. A GM sees a hidden
token's plates, because a hidden token is one the GM is running. A secret token
gets nothing at all for anybody else — a floating rail with nothing under it says
"something is standing here" as loudly as the token would.

The label mode is strictly narrower than the plate: a name is a more precise
disclosure than a coloured plate with a symbol on it, so `canViewLabels` refuses
on `canViewPlates` *before* it reads the mode. A client that chose "always" still
reads nothing off a token it cannot see.

Foundry's own icons are suppressed with `renderable = false`, **never**
`visible` — `visible` is the permission answer other code reads, and clearing it
would make the token's state invisible to everything that asks, this feature
included.

---

## Validating

```bash
node tools/token-conditions-check.mjs
```

Zero problems required. It covers the things a diff cannot show you were wrong
about: the three-way uniform agreement (table, GLSL, host), the plate geometry
described from two files, hairlines not clamped to device pixels, an animated
behaviour missing from `SHED_ORDER`, a literal duration bypassing the motion
tier, a redaction populated before it is checked, one of PF2e's three gates
dropped, a missing world-clock hook, a `null` life collapsed into `0`, and a tone
that has borrowed the suite's gold.

It cannot show you how any of it *looks*. For that:

```bash
node tools/token-conditions-preview.mjs --out=.preview/conditions.html
node tools/preview-server.mjs
```

The preview compiles **both** shipped shaders — this one and the resource bar's —
in a real WebGL2 context, drives them with both shipped animation models, and
puts them through one HDR buffer and one bright-pass. Sharing the buffer is the
point; nothing on the page is a mockup of the effect. What it cannot show is
PF2e's own artwork, which lives inside a Foundry install: the sigils come from
`tools/preview-glyphs.mjs`, drawn to the brief the etch expects, with one plate
deliberately carrying a full-colour stand-in so the `uArt` path is exercised too.
