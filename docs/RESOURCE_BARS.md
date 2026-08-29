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

The visual language is Etched Glass materials on *Honkai: Star Rail* geometry —
a consistent shear, layers separated by air rather than welded into one frame, a
flat high-key fill lit by a single hard specular, and asymmetric furniture at
the ends. The palette is entirely the suite's own; the gold is
`PALETTE.signalPale`.

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

`bloom.mjs` runs threshold → blur H → blur V → composite. **PIXI's filter
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

---

## The shape of a change

A value change is a sequence, and the order is what makes it read as an event:

| | |
|---|---|
| **0ms** | the fill snaps to the new value and everything **stops** |
| **~55ms** | the hitstop releases; the sweep and the ring both start from a standstill |
| **~180ms** | the chip trail starts to drain, white-hot at the wound, cooling as it goes |
| **~420ms** | the readout has finished counting |
| **~720ms** | the sweep has crossed the bar and gone |

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

**The sweep is the loudest thing here, and it carries hue rather than light.** A
front crosses the *whole* bar in the direction the value moved — scoped to just
the span that changed it is a detail you have to already be looking at the bar
to catch, and on a one-point heal it is a flicker two pixels wide. It drags a
long chevron-textured ramp behind it and nothing ahead of it; that asymmetry is
the direction cue, since a symmetric band travelling along a bar is a highlight
and a highlight can be going either way.

The ramp *replaces* the colour of the material it crosses and only then adds a
hot front on top. Written the obvious way, as pure additive light over an
already-bright plate, the green of a heal and the red of a hit both arrive as
the same pale smear. Its length is a fraction of the **bar**, not a fixed
distance in shader units: a constant is a third of a stubby rail and a twelfth
of a wide hero bar, so the effect that is meant to be loudest quietly becomes a
local highlight on exactly the bars with room to show it.

The readout has its own channel, `anim.num`, separate from the fill's `frac`:
the fill snaps on impact but the number counts, so a burst of small hits reads
as one continuous fall rather than as a digit flickering.

---

## Hot and cold

A bar that is not changing is **not ticked at all** — it keeps its last frame.
The ticker is attached only while at least one bar is hot, so a quiet scene
costs nothing and a scene where one creature is being hit costs one bar.

Under load, `SHED_ORDER` in `anim.mjs` gives effects up cheapest-first until the
rolling frame time is back inside budget. Every animated behaviour must appear
in that list; the check tool enforces it, so a new effect cannot be added that
never degrades.

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

Foundry's bars are suppressed with `renderable = false`, never `visible = false`
— `visible` is the permission answer this feature reads.

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
per-token offset still means "inherit" rather than "zero", that the readout's
per-glyph weight is wired end to end, that the shear has one home, and that
every detail gate still resolves at the reference size. With Playwright present
it also compiles the shader and checks that no uniform was optimised away.

```bash
node tools/resource-bar-preview.mjs --out=.preview/bars.html
```

Writes a self-contained page that compiles the **real** shader in the browser's
own WebGL2 context and drives it with the **real** animation model. Serve it
(`node tools/preview-server.mjs`) rather than opening it as a file — a `file://`
page does not run its module script. `--artifact=` emits the same page without
the document wrapper, for publishing.

Neither tool can tell you how any of this looks on a real battlemap at a real
zoom. That needs a session.
