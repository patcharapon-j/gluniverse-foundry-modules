# Resource Bars

Replaces Foundry's canvas token bars with a shader-drawn HUD. System-agnostic
at the core, with a PF2e layer for temp HP and raised shields.

Feature id `resource-bars`, setting prefix `rb.`, i18n `GLRB.*`.

---

## Why a shader

Foundry draws its bars as `PIXI.Graphics` rectangles, re-tessellated on every
refresh. That form cannot hold a gradient, a bevel, a per-frame animation or a
gloss without redrawing geometry, which is why the stock bars look the way they
do. One quad and a fragment shader makes all of that free, and makes "animates
every frame" cost nothing extra.

The visual language is Etched Glass materials on *Honkai: Star Rail* geometry:
layers separated by air rather than welded into one frame, a flat high-key fill
lit by a single hard specular, and **one cut corner, top-right**. The palette is
entirely the suite's own; the gold is `PALETTE.signalPale`, and it appears in
exactly one place — the top of the stroke.

The bar is **axis-aligned**. It used to lean, by a shear of 0.32 shared between
the GLSL and the numerals' layout, and the lean was doing most of the work of
making it look like this suite rather than like a progress bar. It was also the
only thing on the canvas at that angle, which is the problem: a token, its
border, its nameplate and every other module's furniture are all rectangles, and
a bar that disagrees with them reads as costume rather than as design. The cut
corner replaces it — the same corner `gl-tokens.css` takes out of every panel in
the suite, so the family resemblance is now to the suite's own mark rather than
to a borrowed angle.

**The end furniture is gone too.** There used to be a milled gold bracket
anchoring the left end and two pips of unequal height past the right, there to
break the symmetry so the bar would not read as a form control. The cut corner
does that job now, with none of the width.

Between them the shear and the furniture were costing most of the inset. A body
leaning 0.32 per unit of height overhangs its own box by half that on each side,
and the quad had to carry the margin; the cap and the pips wanted the rest. What
remains is 0.13, which is the bloom margin — light that stops dead at the quad
edge is the clearest tell that something was drawn rather than lit — and the
difference is fill. On the one element whose length *is* its content, that is
the trade worth making twice. At true size on a 128px grid the pips were two
three-pixel marks anyway, and ornament that cannot be resolved is just a shorter
bar.

**The cut and the readout share the bar's right end**, which sounds like a
collision and is not. The reason is the shape of the run rather than the room
left over: the run is right-aligned, so the part nearest the corner is the
*maximum* — two-thirds the size of the value and sitting on the shared baseline
rather than on the mid-line. Its ink reaches about a tenth of a bar-height above
centre where the value reaches three tenths, so the small low part passes under
the diagonal and the tall part is already well to its left.

That is a real dependency between two decisions that look unrelated. Make the
maximum bigger, or stop bottom-aligning it, or enlarge the cut, and the digits
move up into the corner — and the rendered result is numerals lying across a
diagonal, which reads as a clipped glyph rather than as a geometry error.
`resource-bar-check` recomputes the clearance from those sizes and the atlas's
own cell metrics rather than trusting the number.

`CUT`, `BODY_INSET` and `READOUT_INSET` are exported from `shader.mjs` together,
for the reason the shear used to be: the bar is drawn in GLSL and the numerals
are laid out in JS, and one piece of geometry described from two files is how a
bar and its readout end up disagreeing.

`READOUT_INSET` is measured to the **fill area**, not to the body. Between the
body's edge and the fill there is a stroke, a gap of air and a lip; anchor to the
body and the last digit is drawn over the frame, which reads as a clipped numeral
rather than as a misplaced one. `resource-bar-check` derives that inset from the
GLSL's own `sw`/`air`/`lip` rather than repeating it, so widening any of the
three moves the requirement with it, and pins that the cut has not wandered back
to the readout's end.

---

## The pipeline

```
bar meshes ──► one container on canvas.interface ──► bloom filter ──► screen
                 (world coords, never token children)
```

Bars live in **one** container, not as children of each token. Three reasons:

1. The bloom is **one** filter over that container. A filter on a token
   allocates a render texture per token per frame — in a forty-token combat
   that is the most expensive thing this feature could do.
2. Tokens rotate; bars must not. World space means never counter-rotating.
3. One container is one place to hide everything.

That container carries an explicit **zIndex of 900**, and it is load-bearing.
`InterfaceCanvasGroup` sorts its children by zIndex and every Foundry layer
declares one; a container left at the default 0 sorts *under the tokens layer*,
which is where a Token's hover box, target reticle and nameplate live. The bars
are above the token artwork either way — that is in `canvas.primary`, a
different group entirely — so the symptom is narrow and easy to miss: everything
looks right until you hover, and then the border is drawn straight over the bar.
900 clears the notes layer (800) and stays under the controls layer (1000), so
rulers and door controls keep the top of the stack. Never put a health bar in
front of something you click.

`core/bloom.mjs` (shared with the token condition rail) runs threshold → blur H → blur V → composite. **PIXI's filter
textures are 8-bit**, so everything the shader emits above 1.0 is clamped before
the filter sees it; the threshold therefore sits below 1.0 and works on what
survived. The preview harness renders to RGBA16F and can threshold above 1.0,
so it is strictly more accurate than the shipped path. If a future Foundry
offers a float filter target, raising the threshold is the only change needed.

---

## Units, and the one subtle thing

`core/glsl.mjs`'s prelude measures everything against `uTexel` — one device
pixel in UV units, where UV is relative to the quad's **width**. That is correct
for the square quads of the token overlay it was written for. A resource bar is
routinely 8:1, so a y-distance clamped against `uTexel` is clamped against the
wrong pixel size.

So the shader works in **`p`**: an isotropic space where one unit is the bar's
height, x scaled by `uAspect`. It restates the prelude's *policy* — the same
imported `GL_BAND` / `GL_EDGE` / `GL_FADE_*` thresholds — in that space via
`px`, one device pixel in p units.

**Anything meant to read as a hairline must be defined in `px`, not in p units.**
A fixed `0.036` is 2.1 device pixels on a HiDPI display and 0.68 on an ordinary
one, where `rbDetail` correctly deletes it — so the feature silently disappears
for every player without a retina monitor, and no preview you run yourself can
show you that. `tools/resource-bar-check.mjs` pins it.

As in the prelude, `uTexel = 0` leaves every clamp inert: a missing uniform
degrades to the unfiltered look, never to a blank quad.

---

## Placement

Bars sit under the token by default, and the whole stack can be nudged.

| | |
|---|---|
| **World default** | `rb.offsetX` / `rb.offsetY`, in the Control Center |
| **Per token** | Flags `rb.offsetX` / `rb.offsetY`, edited in Token Config |

Both are in **grid squares**, not pixels. Everything else about the bar is sized
off the grid, so a pixel offset that reads correctly on a 100px-grid scene puts
the bar somewhere else on a 70px one and every token would have to be re-nudged
per scene.

A per-token value **replaces** the world default rather than adding to it. The
additive reading looks friendlier and is worse: a GM who later moves the world
default silently drags every hand-placed token with it, and the token whose
placement was the reason for the override moves furthest. An unset override is
`null` — which is why the Token Config inputs carry `data-dtype="Number"`
(Foundry turns an empty Number field into null rather than 0) and why
`offsetFor` tests for *finiteness* rather than truthiness. 0 is a legitimate
override meaning "hold still while the world default moves".

The Token Config fields are anchored on the **bar attribute pickers**, not on
the tab id. `data-tab="resources"` matches the navigation *link* as well as the
body it switches to, the link comes first in document order, and
`querySelector` returns the first — so the obvious selector appends the fields
inside the header's Resources button, where they render correctly, save
correctly, and are in the header. `bar1.attribute` exists only in the tab body,
so walking up from it cannot land on the nav.

---

## Divisions

The primary bar is assembled from plates. They let a player read health by
**position** as well as by colour, which is the whole reason a colour-blind
viewer can use this bar at all, so how many there are is not decoration.

| | |
|---|---|
| **Fixed count** | `rb.segmentMode` = count, `rb.segments` plates across the whole bar. 0 draws one continuous fill. |
| **One per N HP** | `rb.segmentMode` = perHp, `rb.segmentSize` hit points per plate. |
| **Off** | `rb.dividers` = false. One unbroken fill whatever the mode and count say. |
| **Thickness** | `rb.dividerWidth`, the gap between two plates in device pixels. |

The two answer different questions and neither is the default answer. A fixed
count makes position along the bar mean the same *fraction* on every creature,
so half-way is half-way on a goblin and on a dragon. One plate per N HP makes a
plate mean the same *quantity* everywhere, so "took about three blocks" is the
same hit on both, and a 12 HP goblin honestly gets three plates while a 200 HP
dragon gets forty.

Rounded **up**, so the short plate is the last one. Rounding down puts the
remainder in the first plate, which is the one at the full-health end that a GM
is looking at before anything has happened.

Two things this has to survive. A creature with **no maximum** — some actor
types genuinely have none — falls back to a continuous fill rather than to a
count derived from zero, and `segmentSize` is guarded above zero rather than
trusted, because `ceil(max / 0)` is `Infinity` and it reaches the shader as a
uniform. And the computed count is capped at `SEGMENTS.max`: the shader already
fades a division out once its gap falls under a device pixel, but the count is
also what sets that gap, so past the cap the bar is more gap than plate long
before the fade takes over.

The gap is **world-sized**: the setting is pixels at 100% zoom — six by default
— and the host divides it by the bar's world height, so `uSegW` reaches the
shader in bar heights and scales with the canvas. It is floored at **a pixel and
a half** and capped at 0.42 of a plate. Six rather than the two it started at
because the gap is what makes the fill read as assembled plates rather than as a
bar with scratches in it.

It used to be held at a fixed number of device pixels, for the reason in
**Units** above — a fixed geometry width is two pixels on a retina display and
sub-pixel on an ordinary one, where the colour-blind position channel silently
disappears for half the table. That was right about displays and wrong about
zoom: six pixels at every zoom level is a hairline on a zoomed-in bar and most of
the plate on a zoomed-out one. The floor keeps the display fix without the zoom
bug. It is a floor rather than a fade because a zoomed-out bar that loses its
divisions has lost the only reading that is not hue.

The cap is what holds the line at forty divisions, where the width would
otherwise leave more gap than plate. The check tool pins all three parts: the
world-sized term, the device-pixel floor, and that every host write actually
divides by the bar's height.

The quarter register marks under the bar are divisions too. They follow `uSeg`,
so a bar with the dividers off — or a count of zero — carries no division marks
of any kind.

**Off is a switch, not the bottom of the slider.** `rb.dividers` resolves inside
`segmentsFor()`, which means it returns a count of zero and the divisions are
never cut at all — including the ones whispered across the empty trough, which
come out of the same mask, and including in the per-HP mode, which has no count
to set to zero. A zero *width* would leave the mask in place and the trough
divisions with it. Turning it off leaves colour as the only channel carrying
health, which is a real cost for a colour-blind player and is what the setting's
hint says.

`uSeg` therefore depends on the *creature*, not only on the setting, and it is
written from three places — mesh creation, `configure`, and the per-frame write.
All three go through `segmentsFor()`. Any one of them reading `opts.segments`
directly divides the bar one way on creation and another way on its next frame,
which reads as a flicker on first draw and as nothing at all on a bar that never
animates. The check tool pins it. `uSegW` is written from the same three places
and goes through `dividerWidth()`, which clamps it: the shader multiplies the
gap's *floor* by it, so a negative value out of a hand-edited world inverts the
`min()` and takes the whole fill out.

---

## The shape of a change

A value change is a sequence, and the order is what makes it read as an event:

| | |
|---|---|
| **0ms** | the fill snaps to the new value and everything **stops** |
| **~55ms** | the hitstop releases; the sweep and the ring both start from a standstill |
| **~180ms** | the chip trail starts to drain, white-hot at the wound, cooling as it goes |
| **~420ms** | the readout has finished counting |
| **~800ms** | the wave has crossed the bar and gone |

Three things about it are easy to get wrong and impossible to unsee afterwards.

**Nothing about the geometry moves, and no length springs.** Not the mesh
transform, not the fill's height, and no overshoot, recoil or settle on any
value. Every one of those was tried and every one reads, on a bar, as jelly — an
instrument that wobbles is an instrument you stop trusting. Lengths use a
quintic ease-out: one long deceleration that arrives exactly once and stops. The
whole reaction is light travelling across something rigid.

**The hitstop is the load-bearing beat.** A freeze before the reaction is most
of what separates "the number went down" from "that hurt". It holds every
channel, including the value tweens and the popup timers.

**The wave is the loudest thing here.** It crosses the *whole* bar in the
direction the value moved — scoped to just the span that changed it is a detail
you have to already be looking at the bar to catch, and on a one-point heal it
is a flicker two pixels wide.

It is **deliberately simple**: a glowing line, and a colour ramp trailing it.
An earlier pass gave it a bowed crest, a decaying crest train, slope shading, a
domed cross-section and flow streaks, and all of it fought the one thing the
effect is for. This is read peripherally, in under half a second, while you are
looking at something else. Structure inside the ramp is detail nobody has time
to resolve, and every extra term was one more thing driving the colour to white.
Three parts, and nothing else:

1. **The line.** Three widths — a coloured halo, a hot core, a white filament —
   so it reads as light rather than as a painted stroke.
2. **The ramp.** One exponential decay behind the front, coloured in three
   stops: deep at the tail, the wave's hue through the body, a hot shoulder just
   behind the line. Three stops rather than a fade to nothing, because a fade in
   motion is a smear.
3. **Nothing ahead of it.** That asymmetry is the direction cue, since a
   symmetric band travelling along a bar is a highlight and a highlight can be
   going either way.

The ramp *replaces* the colour of the material it crosses; only the line goes on
top as light. Written the obvious way, as pure additive light over an
already-bright plate, the green of a heal and the red of a hit both arrive as
the same pale smear. Its length is a fraction of the **bar**, not a fixed
distance in shader units: a constant is a third of a stubby rail and a twelfth
of a wide hero bar, so the effect that is meant to be loudest quietly becomes a
local highlight on exactly the bars with room to show it.

The readout has its own channel, `anim.num`, separate from the fill's `frac`:
the fill snaps on impact but the number counts, so a burst of small hits reads
as one continuous fall rather than as a digit flickering.

The **maximum is the scale, not the reading**, so it steps back: one size
down, one step of opacity down, on the reading's baseline. One step, and the
band matters in both directions. At full strength a small numeral is still
high-contrast against the plate and competes with the number that actually
changes; at the 0.22/0.30 this used to carry, the denominator becomes furniture
you have to go looking for. 0.80 ranks the two and leaves both legible at a
glance. The separator goes one further, to 0.62, because it is punctuation
rather than information.

The weight rides on `aDim`, a per-vertex attribute, because a run is one mesh
with one `uInk`. Anything else means a second mesh and a second geometry to keep
in sync for what is visually one number, so the attribute is what keeps the run
atomic — and `resource-bar-check` pins both halves of it and the band.

The baseline matters because a run where every part is separately centred reads
as three sizes of number rather than as one reading with its scale beside it.
Alignment is measured against the **ink**, not the glyph cell: the atlas bakes
with `textBaseline "middle"`, so lining the cells up leaves the ink a couple of
pixels out, which at this size reads as a mistake. `runGeometry` takes the
offset from `actualBoundingBoxDescent`, measured once when the atlas is built.

**Size is the viewer's**, as a multiplier on what the bar's own height gives
rather than as a pixel count. Every other dimension here is derived from the
scene's grid, so an absolute size that reads correctly on a 100px-grid scene is
a smudge or a banner on a 70px one and the whole stack needs re-tuning per
scene; a multiplier holds its proportion at every grid size and zoom. The
floating delta scales with it — they are one readout.

The trap is the cache. Geometry is rebuilt only when its inputs change, and the
obvious key is the label text, which is exactly what a size setting does *not*
change. Keyed that way the slider moves, nothing happens, and the new size
appears minutes later when the creature next takes damage, which reads as a
broken setting rather than as a stale cache. `writeNumbers` keys on the resolved
size and the row width as well as on the text; the same key is what re-sizes a
readout when its token is resized.

---

## Hot and cold

Two things are true of a bar that is doing nothing, and only the first used to
be:

- **It is not ticked.** The ticker is attached only while at least one bar is
  hot, so a quiet scene costs nothing and a scene where one creature is being
  hit costs one bar.
- **It is not measured.** A filtered container measures itself from its children
  on every render and sizes the bloom's intermediate textures from that
  measurement, whether or not anything is animating. One token parked in the far
  corner of a large scene therefore sizes those textures to the whole distance
  between them. Entries outside the viewport have `renderable` cleared, which
  PIXI honours in `calculateBounds` as well as in the render, so the same flag
  fixes the measurement and the draw call together. The cull is re-run on
  `canvasPan` and for a single entry on a drag, with a 96px margin so the bloom
  a bar just off the edge would have spilled inward does not pop.

The bloom filter's **resolution is taken from the renderer**, not left at
PIXI's default. `PIXI.Filter` defaults `resolution` to 1 and the filter system
sizes its textures from the filter rather than from the target, so on a HiDPI
display the entire bar container renders at half the device pixels and is
scaled back up. There is no error and no warning: the bars are simply soft, and
softer the further you zoom in, because what is being upscaled is a fixed
fraction of the real pixel count. It is re-read rather than set once, since
moving the window to a display with a different pixel ratio changes it.

Under load, `SHED_ORDER` in `anim.mjs` gives effects up cheapest-first until the
rolling frame time is back inside budget. Every animated behaviour must appear
in that list; the check tool enforces it, so a new effect cannot be added that
never degrades.

---

## Guard break

When the **Initiative Tracker** marks a creature's guard as broken, it puts a
golden glass fracture on that creature's token and on its initiative card. The
bar is the third place that state lands, and arguably the one it matters most
on: the token overlay is *behind* the creature and the card is off at the edge
of the screen, while the bar is the thing everyone is already looking at.

It is the **same fracture**, not a lookalike. `core/fx-glsl.mjs` now exports the
crack *field* — `gluBreakField` — as well as the whole-shader `FX_FRAG_BREAK`
that initiative runs, and this feature composites that field
inside its own bar shader. A bar cannot use the whole shader: it is one quad
running one program, and its crack has to be clipped to the bar's own
cut-corner silhouette and composited *with* the fill rather than laid over it as
a second mesh. Three separate cracks drawn three times is how a break ends up
meaning three slightly different things.

The field takes two shape parameters, `dense` and `reach`, both **1.0 for the
square-ish quads it was written for and both arithmetic identities there** — so
the extraction changed nothing for the token or the card. Neither can be 1.0 on
a bar. At `dense` 1 the shards land about a pixel across, which is
mathematically the same fracture and visually grain; at `reach` 1 the crack
dies a tenth of the way along an 8:1 bar. `BREAK_DENSE` puts a shard at about a
fifth of a bar height (~4 device pixels on the 19px reference bar), and
`BREAK_REACH` is a fraction of the bar's **length** rather than a constant — the
same trap the wave's ramp length documents above, where a constant is most of a
stubby rail and a tenth of a wide hero bar. It also sets the pitch of the energy
flowing along the seams, which is measured against that distance, and a longer
reach makes that flow *coarser* — the direction that survives a small bar.

Two things the bar's fracture does differently from the way that field is drawn
elsewhere, and both are about what it is being drawn *over*:

**It cuts before it lights.** `FX_FRAG_BREAK` is pure additive gold, which is
right over token art and wrong over a bar: laid on an already-bright plate the
gold and the arterial red of a nearly-dead fill both arrive as the same pale
smear — the exact failure the wave is written to avoid. So the seam darkens the
material it crosses and the light goes *in* the seam, which is also what a
fracture in a lit pane actually looks like.

**It does not touch the reading.** No dimming, no desaturation, nothing
following the health — unlike the shield break a few lines further down the same
shader, which is allowed to grey out a rail whose whole subject is the thing that
broke. A guard break says nothing about hit points, and a bar that dulls its own
fill to announce an unrelated state has stopped being the measurement it is there
to be.

It nucleates at the **leading edge of the fill as it stood when the guard went**,
captured once and then held. That point is the only one on a bar that means
anything, so it is where the eye already is and where the shards are finest — and
a fracture that slid along with the next three hits would be a decal rather than
damage. The seed is derived from the token id, not from `Math.random()`: a
random seed reshuffles the shards on every redraw of the placeable, so a scar
would quietly rearrange itself mid-combat, and it would differ per client.

The clock is the shared field's own. It spreads the crack over
`clamp(time * 1.4, 0, 1)`, and `TIMING.breakInMs` is how long this model takes
to walk that far — at full motion the two agree by construction and the bar
shatters in step with the same creature's token. There is no fade *in*: the
shatter is the arrival, and a crack that fades up is a crack that was always
there. Clearing a break does fade, because nothing un-shatters and a crack that
vanishes between two frames reads as a glitch. Past the settle the clock keeps
running for the pulse and the flow, and wraps at **10π** — a whole number of
cycles of *both* (11 of the pulse's 2.2 rad/s, 16 of the flow's 3.2), so the
wrap cannot step the fracture mid-breath.

A broken creature's bar is therefore **hot for as long as it is broken**, the
same standing cost as low health and for the same reason. `breakFlow` sits
second in `SHED_ORDER` because of it — it is one of only two standing costs in
that list, everything after it being paid once per change. Shedding it freezes
the fracture at its settled frame and drops the bar out of the ticker; the crack
stays exactly where it was. **What degrades is the motion, never the state.**
The same is true of motion tier "none", where the fracture arrives already
settled and its clock never moves again: the crack is the state, the spread is
only how it got there.

### Reading across a feature line

The break is a flag on the **Combatant**, under the suite's one flag scope with
the initiative feature's `init.` prefix. That is a real dependency and is
treated as one, in `break.mjs`:

- The key is named once and `resource-bar-check` pins it against
  `features/initiative/constants.mjs`'s own `FLAGS` table. A rename there would
  otherwise leave this reading a flag nobody writes any more, and a fracture that
  simply never appears is not a bug anyone reports.
- Nothing is ever **written**. The tracker owns the state and the GM-only paths
  that set it; the bars are a reader.
- The whole thing **self-gates** on the initiative feature being enabled, so a
  world running the bars alone pays nothing for it and cannot fracture on a stale
  flag left behind by a feature that is off.
- The two golds are `PALETTE.warn` and `PALETTE.signalHot` — reached through the
  palette names they are, rather than as two float triples copied out of that
  feature — and the check pins them against its `ACTIVE_SHADER_PALETTE`. A crack
  that is gold on the token and a near-identical other gold on the bar is drift
  nobody would file.

Every combatant on the token is checked rather than only the first:
PF2e-Flatfinder's solo bosses hold several combatants for one token (the prime
turn plus its reprises) and the tracker flags the one that was struck, so
`getCombatantByToken` would answer "intact" for a broken boss whenever a reprise
happened to sort first.

The break is read **outside the value diff**, and that is load-bearing. It is a
different source that moves on its own, and it lands on creatures nothing has
touched — which is exactly what happens when a break gauge empties on somebody
else's turn. Hung off the "did the numbers change" path, a broken creature's bar
would stay intact until the next time something hit it. It rides the **primary
bar only**: one creature, one fracture, and the shield has its own break and its
own look for it.

There is deliberately **no visibility test** in `break.mjs`. The fracture is
drawn on the bar, and `visibility.mjs` has already decided whether this client
may see that bar at all — a token whose Display Bars hides it from a player has
no bar for a crack to appear on. A second, differently-shaped rule here would be
a second thing to keep in step with core, which is the one mistake this feature's
permission story is built to avoid.

`rb.breakFx` turns it off. World-scoped, because it is a fact about the creature
that the whole table reads off the same bar rather than a preference about how
much motion one screen shows; that lever already exists and is the motion tier.

---

## Permission

**The feature never shows more than `displayBars` already permits.** A GM who
has hidden a hostile's bars from players must not have that undone by a prettier
bar — and a leak here renders perfectly, raises nothing, and is discovered only
when a player says a number they should not have known.

`visibility.mjs` defers to Foundry's own computed `token.bars.visible` wherever
it exists, rather than reimplementing the rule, so it cannot drift from core.
The numeric readout is gated *more* narrowly still: a number is a more precise
disclosure than a length, so it can be turned down but never up.

**The GM's override rides on top of that gate, never around it.** Players choose
when their own readout appears; a world setting can overrule that choice for the
table, and the GM keeps their own. It is resolved in `main.mjs`, where the rest
of the settings are resolved, and `visibility.mjs` is deliberately kept ignorant
of it: `canViewNumbers` refuses on `canViewBars` **before** it reads the mode, so
a forced `"always"` still draws nothing on a token whose bars that player cannot
see. Resolving the override inside the permission file, or reordering those two
tests, would print a hostile's hit points on every player's screen and look
entirely correct doing it. `resource-bar-check` pins both.

Foundry's bars are suppressed with `renderable = false`, never `visible = false`
— `visible` is the permission answer this feature reads.

---

## When a bar is shown

`visibility.mjs` says *whether* this client may see a bar. *When* that question
is asked turned out to matter as much as the answer, and getting it wrong was the
report that bars "appear and disappear on hover and move".

**Decisions are made in the `refreshToken` hook and nowhere else.** Foundry sets
a render flag and fires `hoverToken`/`controlToken` at once, but assigns
`token.bars.visible` in `Token#_refreshState` on the *next* render pass — and the
`refreshToken` hook runs after that pass. Decided from the hover hooks, the
answer was one event stale, so Hover-mode bars were inverted (hovering in hid the
bar, hovering out showed it) and Control-mode bars did the same on select. Alt
fires no hook at all, only a `refreshState` on every token, and movement arrives
as `refreshVisibility`, which the old code routed to a position-only path — so a
token that walked out of sight kept its bar. Both reach the hook now.

Three places look like they know and do not: the value hooks (`updateActor`
and friends, which fire before the flags they queue are applied), `drawToken`
(during `draw()` Foundry forces `token.visible` false), and `canvasReady` (every
flag is still pending, so `bars.visible` holds its default of true). Those
build and read; `refreshAll` then forces one `refreshState` pass so the decision
is made on current state.

**A bar is hidden, never destroyed.** Destroying an entry when permission took
the bar away threw away its animation state and brought it back with a silent
first read — on every mouse pass. `RevealAnim` in `anim.mjs` holds the decision
and its transition; values that change while a bar is hidden are applied
silently, so nothing replays as an impact when it comes back.

**Drag previews are refused by every hook.** A preview is a clone that carries
the real token's id; bound to one, the real bar followed the ghost and was
deleted when the ghost was destroyed, not to return until the token next
updated. `remove()` also checks that the placeable being destroyed is the one
the entry is bound to.

How the answer changes on screen:

| | |
|---|---|
| **Appearing** (hover, select, Alt, walking into sight) | materialises left to right behind a line of light, `TIMING.revealMs` |
| **A hover or selection letting go** | fades, `TIMING.fadeOutMs` — never the wipe played backwards, which is exactly what a creature losing all its hit points looks like |
| **Leaving sight** | instant; a fade would leave the bar hanging over a token this client can no longer see |
| **Scene load, a new token, panning** | instant — the first decision for an entry never animates, and culling is `renderable`, not visibility |

`reveal` is in `SHED_ORDER`, directly after the idle sweep: under load a bar
simply pops, which costs nobody any information.

---

## Names

Foundry's nameplate is a `PIXI.Text` centred under the token, in a font and a
position nothing else in this feature shares. Once the bars are an instrument, a
caption floating near them reads as a second, unrelated widget, so the name moves
onto the bar: uppercase, lightly tracked, in the readout's own `--gl-tech`,
left-aligned on the top edge of the top bar's *body* and followed by a hairline
rule running toward the cut corner. A token with no readable bar — a light
source token, a marker, a loot pile — gets the same name centred in the same
slot as `── NAME ──`. `name.mjs` owns how a label looks and moves; `mystify.mjs`
owns what it says and whether it shows.

| | |
|---|---|
| **Names on bars** | `rb.names`, world, default on. Off hands every nameplate back to Foundry. |
| **Name text size** | `rb.nameScale`, client, the readout's range. |

**The nameplate is suppressed with `renderable`, never `visible`**, for the same
reason the bars are: `nameplate.visible` is Foundry's Display Name answer,
assigned in `Token#_refreshState` as `!isSecret && _canViewMode(displayName)`, and
`canViewName` reads it. It is re-evaluated in every pass, so turning the setting
off — or a token losing its name — gives Foundry's nameplate straight back.

**The name is decided where the bar is**: in `applyVisibility`, from the
`refreshToken` hook, after Foundry's state pass. A rename arrives as
`refreshNameplate`, which is routed to the same decision. It is independent of
Display Bars — a name whose bar is hidden still draws alone in its slot — but its
*style* follows whether the token has a bar at all, not whether that bar is on
screen this frame. A Hover-mode bar under an Always-mode name would otherwise
switch the name between centred and left-aligned on every mouse pass.

### The row is always reserved

The bar stack moves down by the name row whenever a label is *possible* — names
on, a non-empty name, and Display Name not None (or a mystifiable creature, below)
— not when one is drawn. Reserving only while the name is visible is the obvious
version and it is the jump Phase 1 removed, back again: a Hover-mode name pushing
its bar down a row under the cursor. `layout()` never reads whether a label is
shown, and `resource-bar-check` pins that. The offsets move the whole stack,
name included; the row grows with `rb.nameScale`, since layout is per client
anyway; and floating deltas start above the row rather than on it, because a
delta born on top of the name reads as part of it.

### Text

Names are arbitrary Unicode, so the numeral atlas cannot draw them. Each is
rasterised once per **(text, size bucket)**, with the bucket following the
label's font size in *device* pixels at a third of an octave per step. A label is
therefore re-rastered only when zoom crosses a step — crisp at every zoom, and
nothing uploaded while the canvas stands still. Rasters are reference-counted and
destroyed with their last label. Letters are tracked with the canvas's own
`letterSpacing` rather than drawn one at a time, which would break every script
that shapes across letters; glyphs the tech font lacks fall back to system fonts.

The raster uses the numerals' channel code (outline red, body green) so the ink
can be tinted — the GM's dimmed view — without tinting the outline, and it is cut
off in the shader at `uCut`, which is how a decode resolves it left to right
without a second texture.

Labels live on a **second, unfiltered container** at the bars' zIndex. Inside the
bloom a white label haloes on every token, and adds a row per token to the
filter's measured bounds.

Long names shrink to fit down to **75%**, then take an ellipsis. Shrinking first
because a slightly smaller whole name beats a truncated one; floored because past
three-quarters a label no longer matches the ones around it. The width limit is
the bar up to its cut corner, or the token width less the flanks for a centred
label.

Below about **six device pixels of cap height** a label fades out — a smoothstep
over 4.5–7px, so a zoom thins it continuously rather than popping it. Uppercase
at that size is a grey smear, and a smear on every token is worse than nothing.
The rule and the flanks are **one device pixel** through zoom × resolution, the
hairline rule from **Units** above.

### Motion

`LabelMotion` is anime.js on a plain state object, `autoplay: false`, seeked to
its own elapsed time from the host's ticker. That keeps the motion tier, the
off-screen freeze and the Node check tool working, and it never touches the
shared engine's loop or speed, which Insight and Initiative own. Every duration is
in `NAME_TIMING`. The rules are the bar's: appearing **decodes in** — a lead front
brings scrambled glyphs in, a lag front resolves them, so the first frame is not
a full run of noise — a hover letting go fades in the bar's own 150ms, leaving
sight is instant, and the first decision for an entry is instant. `nameDecode` is
in `SHED_ORDER`; shed, a decode simply snaps.

---

## Mystification

Under PF2e only, and only for `character`, `npc`, `familiar` and `hazard` actors —
the things a Recall Knowledge check is made against. A loot pile or a vehicle is
not a mystery anyone rolls to solve, so those follow plain Display Name: hidden
means no label.

A creature's name is **hidden from players** when either:

- PF2e's *Token settings determine name visibility* is on and the token's own
  `playersCanSeeName` is false; or
- the Creaturedex is enabled and `CreaturedexApp.mayView(actor)` is null for this
  user.

Two readers are exempt, and both exemptions are easy to lose because the failure
looks harmless. **The party** (`actor.alliance === "party"`) is never an unknown
creature: PF2e's own rule already says so, but the dex has no such clause —
nobody reveals a player character in it — so without the exemption every PC and
companion wears a cipher the moment the Creaturedex is switched on. And **an
owner** always reads the name of what they own: a player's own summon or familiar
is not a mystery to them, whatever the table has hidden from everyone else.

When mystification applies, Display Name stops deciding whether a label shows and
starts deciding which label: the real name, or a **cipher**. A label with a bar
this player can see rides with that bar; a label whose bar is hidden from them
shows only on hover or Alt, and only in sight.

**Why a cipher and not nothing.** A hidden name used to be no label, which on a
canvas where every other token carries one reads as "this token is scenery". A
run of glyphs says "there is a creature here and you do not know what it is",
which is the actual state of the table.

The cipher's own rules are all about carrying no information:

- **No letters, no digits.** About a third is `?`; the rest is
  `! # * & ~ ^ = < > † ‡ ¤ ◇ ◆ ▚ ▞ ░`. `+ - / %` are excluded because the
  readout and the deltas use them, so a cipher containing one sits beside a bar
  looking like a number; `§` because it reads as an S.
- **Its length comes from the token id**, 6–9 glyphs, never from the name. A
  cipher that grew with the name would let a player count letters.
- **It flurries, it does not flicker.** Every ~4s two or three glyphs re-roll, on
  a per-token phase so a map full of unknowns does not re-roll in unison. The
  glyphs are a pure function of (seed, beat), with a slot keeping the glyph of the
  last beat that touched it. The period is *divided* by the motion scale: reduced
  motion shortens animations, and a shorter period would flicker more on the
  setting that asked for less. `flurry` is in `SHED_ORDER`.
- **It is an atlas.** A flurry is a geometry rebuild, not a texture upload, and
  the run uses a uniform advance so a `?` becoming a `░` does not shuffle every
  glyph after it and drag the rule along.

When a creature is **identified** while its label is on screen, the cipher
decodes into the name, left to right, in about 600ms — starting from the exact
glyphs the player was looking at, so the first frame does not pop. The GM always
reads the real name: at 70% brightness, with a small `◇` marker in the accent,
when players see a cipher.

### The leak rules

A leak here renders perfectly on the GM's screen and appears only on a player's.

- **A player's decision for a hidden creature carries `text: null`.** The label
  cannot draw, rasterise or decode a string it was never handed, which is a
  stronger guarantee than any number of "if hidden" checks further down. The
  raster cache is only ever asked for `content.text`; losing the name drops the
  raster and binds an empty texture; a decode only ever starts on cipher → name,
  and losing the name mid-decode snaps it.
- **The cipher cannot see the name.** `cipherGlyphs(seed, epoch)` has no name
  parameter, and the check tool pins that and proves `composeLabel`'s cipher mode
  is unchanged by one being present.
- **The decision is never stale.** It is made in the `refreshToken` pass, and
  re-made on the updates that change it without touching a token: the dex's
  `dex.knowledge`, PF2e's name-visibility setting (both through `updateSetting`
  and `createSetting`), a user's assigned character, and an actor's ownership or
  alliance. Each forgets the memoised answers and asks Foundry for a state pass,
  so the decision itself still happens in one place.

### Reading the Creaturedex

`mayView` is the authority on what a player knows, and it is used rather than
restated — including its rule that knowing a *lie* counts, because a player told
one cannot see that it is false. It is not imported statically: `app.mjs`
destructures `foundry.applications.api` at module scope, which does not exist
under the Node tooling that loads this feature, and a static import would tie the
two features' import graphs together. It is resolved with a dynamic `import()` on
first use — in a world, that module is already evaluated, so it lands on the next
microtask — and every label is re-decided when it does. **Until then the answer
is a cipher**, because the only safe way to be wrong about a secret is towards
keeping it.

`mayView` answers yes for any GM, so the GM's marker asks the dex's store directly
for the whole party (`knownSections`/`falseSections` on `PARTY_KEY`): the marker
means *no party character knows anything about this kind of creature*. In a world
with Party Knowledge off, one player may know a creature another does not; the
marker then stays off as long as anyone knows it. Answers are memoised per
creature kind until something invalidates them, because every `knownSections`
call deep-clones the whole dex and an Alt press re-decides every token.

---

## Colour

The fill hue is a function of the health fraction, interpolated in **OKLab**: a
naive sRGB lerp from `--gl-good` to `--gl-signal` passes through a desaturated
olive that reads as "muddy green" rather than "getting worse". The forward
transform happens in JS at settings-change time; the shader pays only for the
inverse.

Three things sit off the ramp on purpose:

| | Colour | Why |
|---|---|---|
| **Temp HP** | `cyanHot` | A buffer in front of your hit points |
| **Shield rail** | `cyan` | The same idea, so they read as related |
| **`bar2` rail** | `accent` | *Not* health. A half-full ammo counter must not be the same orange as a half-dead creature |

Temp HP is drawn as a plate laid over the fill, and what sells it as a plate is
the pattern rather than the colour: colour alone just makes a second fill. The
pattern is **one family of diagonal ribs** at `SHIELD_PITCH`, drawn as bright
lines on top of the health rather than as filled cells that would hide it — a
pattern that obscures the health it sits on has broken the one rule the layer
has. Parallel ribs also say *plating*, which is what temporary hit points are.

The pitch is a legibility floor rather than a taste. It used to be two crossed
families at 0.185, making diamond scales — a nice idea at preview size and noise
at the size it actually draws. On a 128px grid the bar is 19px tall, so those
diamonds were about three pixels across and the crossing halved the feature size
again. Detail below a couple of pixels stops being a pattern and becomes grain
over the one reading the player came to take. 0.44 puts a cell at about 8px,
which is the smallest that still reads as a pattern; chevrons, a hex mesh,
scales, a grid and a wave were all built and compared at that pitch before the
ribs were kept.

The ramp is sampled through `pow(uFrac, 1.45)` rather than linearly. Sampled
straight, the whole lower half of the range is orange and red only arrives in
the last few percent, so a creature at a third of its hit points looks merely
warm. Below the threshold the fill goes further still, into an arterial red no
ramp stop reaches — the one place the fill is allowed to editorialise, because
"you are about to die" is not a shade of the same information.

Health is encoded two ways that are not hue: **segment position**, and the
**low-health breath**. The breath replaced a diagonal danger hatch, and the
trade is deliberate: the hatch was a *spatial* second channel that sat on the
bar permanently once you dropped below the threshold, and a static stripe
pattern on the element a player checks constantly is decoration you have to look
past. The second channel is now *temporal* — a ~4.6s pulse, slow enough to read
as breathing rather than as an alarm, and it lands on the **liquid** as well as
the chrome. The fill carries a domain-warped cell texture while it lasts: two
sine fields multiplied together give a plaid whose axes you can see, so the
sample point is displaced by another pair of sines first, which stretches and
folds the cells into something that reads as movement *inside* the liquid rather
than as a texture laid over it. Four sines, no texture fetch. The trough's own
diagonal scan pattern was removed at the same time — on a bar that is mostly
empty, which is every bar that matters, those stripes were the largest thing on
screen and the fill had to compete with them. A client-scoped colour-blind-safe
ramp (blue → orange) is offered as a third option.

---

## Validation

```bash
node tools/resource-bar-check.mjs
```

Zero problems required. It pins the uniform table against the GLSL *and* the JS
that writes it, that `uTexel = 0` stays inert, that the OKLab ramp still mirrors
`gl-tokens.css`, that no raw millisecond literal has escaped `TIMING`, that the
glyph atlas covers every character a run can emit, that the numeric readout is
inside the permission gate, that every animated behaviour is shed-able *and*
that no `SHED_ORDER` entry is dead, that the hitstop actually holds every
channel and then releases, that the readout counts rather than snapping, that
the bar container still sorts above the token furniture, that an emptied
per-token offset still means "inherit" rather than "zero", that value and
maximum still differ by one step of weight rather than by none or by a fade to
furniture, that the readout still stands inside the fill rather than on the
frame and the cut corner is still at the other end, that the readout's geometry
cache is keyed on
its size so the size setting is not silently inert, that the GM's readout
override never reaches the permission gate and never outruns `displayBars`, that
nothing has been sheared again, and that every detail gate still resolves at
the
reference size.

For the guard break it pins the whole cross-feature seam: that the flag key still
matches the initiative tracker's own table, that `break.mjs` never writes that
flag and still self-gates on the tracker being enabled, that the two golds still
match its palette, that the fracture runs the *shared* field rather than a fork
of it, that `FX_FRAG_BREAK` still calls that field at `dense`/`reach` 1.0 so the
extraction stayed an identity for the token and the card, that the crack is
clipped to the bar's silhouette and does not desaturate the fill, that
`TIMING.breakInMs` still agrees with the field's own settle and `BREAK_WRAP` is
a whole number of cycles of both moving terms, that the nucleation point is
captured rather than followed, and that freezing the fracture stops its clock and
releases the ticker **without losing the crack**. With Playwright present
it also compiles the shader and checks that no uniform was optimised away.

For names it pins that Foundry's nameplate is suppressed through `renderable`
and handed back on disable; that the name is decided from `nameplate.visible`
inside `applyVisibility` and nowhere else; mystification's scope and gate order,
behaviourally, including which probes run for which tokens; that a player's
decision for a hidden creature never carries the name, that a name raster is only
acquired on the guarded path and dropped with the name, and that a decode only
ever starts on cipher → name; that the Creaturedex is read lazily and its
knowledge key still matches; the cipher's glyph set, its id-seeded length, its
independence from the name and the size of a flurry beat; that label motion is
seeked rather than autoplayed, never touches the shared engine, and has no
millisecond literal outside its tables; the 75%-then-ellipsis fit, the continuous
zoom fade and the device-pixel hairline; that the rule stops short of the cut and
the pads still mirror the shader; that the row is reserved and the bars do not
move when a name is drawn; that deltas start above the row; and that both
settings are registered, read and localised.

```bash
node tools/resource-bar-preview.mjs --out=.preview/bars.html
```

Writes a self-contained page that compiles the **real** shader in the browser's
own WebGL2 context and drives it with the **real** animation model. Serve it
(`node tools/preview-server.mjs`) rather than opening it as a file — a `file://`
page does not run its module script. `--artifact=` emits the same page without
the document wrapper, for publishing.

Its **Names** section (on a bar, with no bar, long names on narrow tokens, the
player's cipher, the GM's view, and the zoom-out fade) imports the real
`name.mjs`, `mystify.mjs` and `cipher-atlas.mjs` — layout, fit, cipher,
composition and anime.js motion are the shipped code; only the pixel compositor
is the page's own Canvas2D. Because it imports them it needs the same server, and
it expects the page under `.preview/`.

Neither tool can tell you how any of this looks on a real battlemap at a real
zoom. That needs a session.
