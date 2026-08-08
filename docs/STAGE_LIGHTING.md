# Stage character lighting

Four things decide how a character ends up looking: **the style**, **the shading
model**, **how the art is framed**, and **where it is hosted**. The last one
decides whether the full effect is available at all.

## The three styles

`stage.ppStyle` picks between **semi-realistic**, **cel / anime** and **rim light
only**. They are one shader, not three: `u_cel` and `u_rimOnly` crossfade every
affected term below against its twin, so semi-realistic is both switches at 0 and
is the model term for term — a style cannot quietly rebalance the look of a world
that never switched. `tools/postfx-check.mjs` reads main() statement by statement
and fails on any banded term that reaches the output without passing through
`mix(…, u_cel)`, and on any statement touching `u_rimOnly` that is not itself a
`mix()`.

What cel changes, and why each one is a separate decision rather than a filter
over the finished image:

| Term | Semi-realistic | Cel |
| --- | --- | --- |
| diffuse | continuous wrap ramp | three flat tones, two terminators |
| rim halo / core | falloffs peaking at the outline | strips of constant brightness |
| facing | fades out round the silhouette | the arc terminates |
| ambient bounce | hue creeping across the figure | a fill with an edge on it |
| specular / sheen | lobes | hard-edged shapes with the lobe's own contour |
| contour | form edges catch light | a drawn line along them |
| grounding | a fade at the hem | a shadow with a boundary |

Two orderings inside that carry more weight than they look like they should.

**The diffuse is banded after the distance falloff, not before.** Fold a
continuous attenuation into a quantised tone and every fill acquires a slow
gradient again, which is the one thing this style cannot have. Applied
afterwards, the lamp's distance moves the *terminator* — a shape, which is how
the style expresses distance anyway.

**The additive terms take a flattened attenuation.** Same failure, arriving from
the other side: a flat shape multiplied by a continuous gain is a gradient, and
the sheen lobe is broad enough to do that across half a garment. A third of the
falloff is kept so a lamp across the room is still weaker than one beside it.

The cel strengths are their own frozen table and are lower almost across the
board — not a taste judgement but arithmetic, since a flat band delivers several
times the light of the falloff peaking at one contour that it replaces. Carrying
the realistic numbers over turns the rim into a white bar. The two that go *up*
are the core and the contour, which are the terms the style leans on.

One honest limit. The normal field is invented from the blurred alpha, so deep
inside a silhouette it barely turns and the diffuse hardly varies there in either
style — the banding mostly shows where the shading actually ramps, which is near
the outline and across the form edges the contour term finds. On art that is
already flat-shaded that is the right amount; do not expect cel to invent
interior form the model cannot see.

The claim that this is a change of *shape* is checked rather than asserted:
`tools/stage-lighting-preview.mjs` measures the fill past the terminator (0.004
against the realistic model's 0.012 — the cel fill sits on the dither floor) and
the mean luminance over the whole figure (0.384 against 0.382, so the strength
dial does not need re-tuning when a stage switches style).

### Rim light only

For art that is already lit — a portrait with its own painted shading, which
re-lighting only muddies — but that still has to belong to the room it is
standing in. The colour grade stays; the light stops at the outline.

Everything that puts a gradient on the body from the lamp's direction goes:

| Term | Semi-realistic | Rim only |
| --- | --- | --- |
| diffuse | N·L ramp × distance falloff | one flat level (`KEY_FLAT`) |
| ambient bounce | lamp's side vs the room's | held at the midpoint, both hues kept |
| contact darkening | edge sits in its own shadow | off — it greys the band the rim lands on |
| grounding | a fade at the hem | off |
| contour / specular / sheen | interior form and highlights | strength 0 |
| rim halo | `edge³·⁵`, dies out over the ribs | `edge²²`, a line on the outline |
| rim core, spill | the outline and just past it | driven harder — all that is left |

`KEY_FLAT` is not zero, and that is the design. Dropping the key term would
darken every stage by whatever it was carrying, so instead the lamp stops being a
*direction* and becomes an *exposure*: mean luminance lands at 0.380 against the
semi-realistic model's 0.382, so a GM switching style does not then have to
re-tune the strength dial.

`RIM_ONLY_FALLOFF` is large because the field it raises sits at 0.5 exactly on
the outline and climbs slowly — gentler exponents do not bite. The value is
measured, not chosen; see *Checking it* below.

The interior terms are zeroed in the strength table rather than flattened in the
shader, because no amount of tuning makes an interior highlight not be one.
`postfx-check` fails if any of the three acquires a value.

### On the CSS fallback

Cel follows as far as three masked gradients can: hard stops instead of ramps, so
the lit and shadow sides meet at a line. It cannot band the art's own shading,
because it never reads a pixel.

Rim-only is the one style this path renders honestly rather than approximates.
The two directional gradients are exactly what the mode removes, so they are
hidden, and the glow becomes two stacked `drop-shadow()`s on the `<img>` — tight
plus wide, the same two lobes for the same reason. A drop-shadow is a blur of the
image's own alpha, which is the quantity the shader's spill term reads, reached
by a different route; and because the `<img>` paints over its own shadow, on this
path the light *cannot* reach the art. The strength dial rides in the shadow
colour's alpha, since a filter has no opacity of its own.

## The shading model

The pass works in **linear light**. Every number arriving from an image or a CSS
colour is gamma-encoded, and the operations that matter here behave differently
on encoded values: adding two lights saturates early, mixing two colours passes
through a muddy midpoint, and clamping a highlight shifts its hue instead of
rolling it off.

Two things are deliberately *not* in linear, and both were arrived at by
computing the old and new results side by side rather than by eye:

- **The diffuse multiplier is converted, not re-derived.** A multiplier is a
  ratio, and a ratio means the same thing in either space provided it is raised
  to the same power the values were: `base * toLinear(amb + key * diffuse)`
  reproduces the previous shading contrast exactly. Re-deriving it instead —
  linearising the ambient and key separately — cannot be made to match, because
  a gamma-space *sum* of two lights is not any fixed pair of linear gains; a fit
  that lands on one room's balance is wrong for the next one.
- **The strength dial blends after the encode.** `u_intensity` is a control a GM
  drags, not a light quantity. Blending in linear makes the same slider position
  deliver visibly less effect in a dark room than a bright one.

The upshot is that the baseline — the model with the new terms inert — is
numerically the same picture it was before, so every visible difference is
attributable to a term that was added on purpose. The largest baseline deviation
across four test rooms and four art tones is 0.03 in encoded luminance, all of it
where the tone-map shoulder engages on a highlight that used to clip.

The rim and specular strengths passed from `index.mjs` *do* add in linear, where
mid-grey is 0.22 rather than 0.5 — which is why they look far too large next to
the values they replaced.

The terms, in the order they apply:

| Term | What it is for |
| --- | --- |
| ambient / bounce | Two luminance-matched colours, not one wash. Light that misses the key side arrives bounced off the room and carries the *room's* colour, not the lamp's — see `bounceLight`. Matching luminance keeps it a colour separation rather than a second lamp. |
| diffuse | Half-Lambert wrapped with true Lambert, attenuated by distance to the positioned key. |
| rim halo | The wide inward falloff from the outline. On its own this is a soft wash with no edge in it. |
| rim core | A tight, near-white line hugging the outline. On its own this is a drawn outline with no light in it. See below — together they are the effect. |
| spill | The same edge continuing *past* the silhouette into the air. |
| contour | Interior form edges — a lapel over a shirt, a collar, an arm crossing hair. The alpha silhouette cannot see any of them. |
| specular / sheen | A tight lobe and a broad one. Both gated on thickness and on the art's own brightness, so a highlight lands on a pauldron and never on black cloth. The tight lobe alone puts a speck on metal and nothing on cloth; the broad one is what separates satin from wool and gives hair a band. |
| grounding | The bottom of a full body sits in its own shadow. Framing-dependent — see below. |
| exposure / night | Scene darkness dims, and deep darkness desaturates and drifts blue. |
| tone map | A shoulder above `KNEE`, applied to luminance and rescaled. Clamping channels independently is what turns a warm-lit face magenta; only the very top desaturates. |
| dither | Sub-LSB interleaved-gradient noise. The output is 8-bit and most of the image is a slow ramp, which is the one thing 8 bits cannot hold. |

Two sampling details carry more weight than their size suggests. The normal field
is prepassed small and stretched over a much larger render, so it is fetched with
a smoothstepped interpolant — plain bilinear is only C0 and its texel lattice
shows up as faint diamond creases on a ramp this smooth. And art is downscaled by
the browser at decode rather than by the GPU at sample time, because WebGL1
cannot mipmap a non-power-of-two texture: minifying a 4000px portrait would
otherwise be a single bilinear tap, which crawls on hair and fine outlines.

## The edge

The rim is most of what people mean when they say art is "lit into" a scene, so
it gets four things the rest of the model does not. Each one is there because the
obvious version of it demonstrably did not work.

**It has its own light, behind the figure.** A rim light *is* a light behind the
subject; the key cannot be, because it has to sit in front or nothing would be
diffusely lit. So the rim takes the key's bearing across the frame and throws its
depth away. Using the full 3D key instead lets `u_lightZ` — roughly half a
body-height in front of the art plane — dominate the dot product, so nearly every
outward-facing normal scores the same and the rim comes out even the whole way
round. That reads as a sticker cut from white paper.

**It is measured twice, at two scales.** The prepass field is blurred wide on
purpose: its job is inventing a rounded *surface*, and its ramp runs several
percent of the frame. A core taken from it is a soft band however hard the
exponent is raised. So the core gets its own measurement — eight taps on a small
ring of the art's own alpha, at full render resolution — while the halo and the
outer bloom keep using the prepass field. Hot line, soft air behind it.

**Both are rescaled before the exponent.** A blurred step edge reads 0.5 *at* the
outline and climbs to 1.0 going inward, so a bare `1 - thickness` tops out at 0.5
on the outermost real pixel. Any exponent sharp enough to make a line out of that
annihilates the term instead — 0.5 to the 11th is 0.0005 — which is why the rim
has to be normalised against the half of the ramp that is actually inside the
figure.

**The core is added past the strength dial, not through it.** Every other term
crossfades with `u_intensity`, which is right for anything that *modifies*
pixels. It is wrong for the rim: the crossfade mixes the flat original art back
over the lit edge, and at the default 60% that caps the core at 0.72 over dark
art no matter how hard it is driven. A rim that cannot reach white is not a rim.
So the core and the spill scale with the dial rather than crossfading with it.
Strength 0 is still exactly the original pixels — that was the property that
mattered, and `tools/stage-lighting-preview.mjs` asserts it channel-for-channel.

The spill is the one place this feature gets something for free. Drawing light
past the outline normally means a second render target and a blur pass; here the
prepass already blurred the alpha channel, so the field it hands over already
extends a blur-radius beyond the silhouette, already shaped like a falloff. The
branch for `art.a ≈ 0` is that falloff, drawn.

One honest limit: the spill composites with normal alpha blending, because the
canvas also carries the opaque character and `screen`/`plus-lighter` on the
element would blow the figure itself through the background. Over the dark
painted backgrounds this feature targets that is indistinguishable from additive.
Over a bright background the spill is subtler than it should be.

## Art with a dark rind

A rim is only a rim if it lands on the character. Land it on a black outline
instead and it reads as a halo: the eye takes the bright line, then the dark band
immediately behind it, and the pair together look like a sticker cut out and
pasted onto the scene. Two separate things put a dark band there, and they need
different answers.

**The sampler can invent one.** Bilinear filtering blends whatever is stored, and
in straight alpha the fully transparent pixels of a cut-out PNG carry rgb 0,0,0
almost without exception. Interpolating against those darkens every texel on the
boundary — a black rind that is nowhere in the asset, appearing only once the art
is magnified to the render size. The fix is not a workaround: premultiplied is
the space interpolation is *correct* in, so the art texture is uploaded
premultiplied and every colour read goes back through `artAt()`, which divides
the coverage out again. `tools/postfx-check.mjs` fails the build on a bare
`texture2D(u_art, …).rgb`, because that reads as ordinary code and silently
shades a half-covered pixel as though the artist had painted it darker.

**The asset can carry one of its own** — an authored outline stroke, or the
residue of a matte lifted off a black background. Nothing can be done about those
pixels; they are the art. So the shader stands down instead. A guard measures the
boundary against the body a few pixels inside it and fades the core, the halo,
the spill and the contour term where it fires.

Two conditions have to hold together, and the pair is what makes the guard safe:

- the boundary is **markedly darker** than the body just inside it, and
- the boundary is **near black in absolute terms**.

Relative darkness alone cannot tell a matte from a navy coat with a pale lining —
that test alone cost the clean reference figure 9% of its edge. Absolute darkness
alone would strip the rim from any character dressed head to foot in black.
Requiring both leaves the clean figure measurably untouched while cutting the
matted one by a third.

The contour term is the one that gains most from the guard, which is not obvious:
a matte rind is the largest tonal step anywhere in the asset, so the term that
looks for form edges finds its inner boundary first and draws a *second* bright
line just inside the rim. That pair is most of what makes a halo look like one.

## Framing — knee-up vs full body

Stage art is composited over the background, not placed in it, so nothing tells
the shader where the figure is standing or how much of a body is on screen. Both
are inferred.

The normal-map prepass already scans every pixel of the alpha channel, so it also
measures the silhouette's bounding box. Its height-to-width ratio is the framing
signal — a whole standing figure lands near 2.9, a knee-up three-quarter shot
near 1.8, a waist-up portrait near 1.4 — and `describeFigure` turns that into
`bodyFraction`: how much of a whole body is in frame, measured down from the
head. Art with no transparency degrades to the image's own aspect, which is
still roughly right.

Two things depend on it:

- **Where the light sits relative to the figure.** The key light is passed to the
  shader as a *position* in the art's own space, not as one direction shared by
  the whole figure. On a full body the head and the shins are far apart, and a
  lamp in the room does not shine on both from the same angle — so the head
  catches a rim the legs do not, and `dot(N, L)` varies down the body. A knee-up
  crop at the same pixel height is not the same distance from that lamp, so it
  gets a gentler gradient.
- **Grounding shadow.** A full body has a floor in frame and its lowest part sits
  in its own shadow. A knee-up crop has no floor, so a dark band across its hem
  would read as a bug. Strength scales with `bodyFraction` cubed, which takes a
  knee-up crop to roughly a quarter of a full body's.

The scene model behind this is two constants in `postfx/index.mjs`: a standing
figure's feet land near the bottom of the frame (`FEET_SCENE_Y`) and the figure
covers about half the frame's height (`BODY_SCENE_HEIGHT`). They hold for painted
VN-style backgrounds, where the horizon is high and the foreground floor fills
the lower third. Both spaces are made isotropic before any angle is computed,
because 0.1 across a 16:9 background is nearly twice the distance of 0.1 down it.

The CSS fallback cannot do any of this — it has no normal map, which is why it is
the fallback — so it uses a single direction measured from mid-body.

## One canvas, many characters

There is a single WebGL context and a single render target for the whole feature
— a browser caps out around sixteen contexts, and a stage can hold more slots
than that. Characters are shaded into it one at a time and each result is copied
into that slot's own 2D canvas.

That makes the copy-out a **synchronisation point**, and the pipeline is split
around it:

| | Suspends? | Touches the shared canvas? |
| --- | --- | --- |
| `StageGL.prepare` | yes — fetch, decode, upload | no |
| `StageGL.draw` | **never** | yes |
| `StagePostFX._blit` | never | reads it |

A slot's pixels exist alone for exactly as long as the synchronous block that
drew them. Yield anywhere between `draw` and `_blit` and the slot copies out
whatever the *next* character drew — which is what made adding an actor to the
stage repaint the actor beside them with the new arrival's face. Nothing about
that looks like a timing bug on screen; it looks like the wrong art was assigned.

So: **no `await` between `draw` and `_blit`.** `tools/postfx-check.mjs` pins this
down two ways — structurally (`draw` must not be an async function) and by
driving two slots through one coalesced render pass against a fake context that
poisons the shared canvas on the next microtask.

## Checking it

Two tools, and they cover different things.

```bash
node tools/postfx-check.mjs             # the maths, no browser
node tools/stage-lighting-preview.mjs   # the shader, in a real GPU context
```

`postfx-check` is pure logic — blur kernel, light geometry, framing, the CORS
strategy, slot ownership, and a cross-check that every shader uniform is both
declared in the GLSL and looked up from JS. It cannot compile a line of GLSL,
which matters more than it sounds: a shader that fails to compile does not throw,
it degrades silently to the CSS fallback.

`stage-lighting-preview` fills that gap. It serves the repo, drives the real
`getNormalMap` / `prepare` / `draw` in headless Chromium against a synthetic
character, and asserts the things a diff cannot show — that the shader compiles
and links, that strength 0 is bit-identical to the source art, that a lamp on the
left rims the left edge and one on the right rims the right, that the core
reaches near-white at the default strength, that light actually crosses the
silhouette, and that the rim stands down on art carrying its own black rind. That
last one renders the same silhouette twice, differing only in the colour of its
boundary pixels, so the two numbers are directly comparable.

Every one of those is a property of the effect rather than of one style, so each
style is put through them again — none of it follows from the realistic set
passing, because the styles are separate paths through the shader. On top of that
each gets the measurements that make it a style and not a second set of dials.

For **cel**: the fill past the terminator is flat (0.004 spread against 0.012, on
the flat coat panel only, so the art's own colour cannot leak into the number) and
the exposure has not moved (0.384 against 0.382).

For **rim only**, two, and they answer different halves of the claim:

- **The lamp swings, the art does not.** Light the figure from hard left, then
  hard right, and compare every pixel more than 45px inside the silhouette. A
  shading gradient *is* the thing that would change; the mean shift is 0.000
  against the semi-realistic model's 0.025, over 127k pixels. Flatness alone
  would not have proved this — an even wash is still a wash.
- **The rim reaches 3.2% of the figure's width in**, against 11.4%
  semi-realistic. Getting this number honestly took a second attempt: reading a
  luminance profile inward from the outline crosses the art's own materials — a
  dark shirt, then a pale coat — so any single baseline scores the *artwork's*
  edges as light, and the first version read three times the truth. The
  measurement now differences the render against the same render with
  `rim`/`rimEdge`/`glow` zeroed, which isolates the light whatever is underneath
  it. The dither is deterministic and identical in both, so it cancels instead of
  setting a floor.

It also writes a four-room contact sheet with magnified detail rows — the clean
cut-out, the matted one, the cel style and the rim-only style — which is the only
way to tell a crisp edge from a soft one, or a rim from a halo:

```bash
node tools/stage-lighting-preview.mjs --out=/tmp/sheet.png
```

It needs Playwright (`npm i -g playwright`; Chromium is usually already present)
and skips cleanly with exit 0 when that is missing. Neither tool can tell you how
any of this looks on real art — that still needs a session.

Re-registering a slot with different art drops its canvas rather than carrying it
forward, for the same reason: the shaded canvas is what the viewer sees and the
`<img>` beneath it is hidden, so a stale canvas is a stale *face*. Dropping it
shows the plain art, unlit, until the new render lands.

## Asset hosting

The Stage feature can light and colour-grade character art to match the current
scene's background (`stage.ppEnabled`). Doing that means *reading* pixels, not
just displaying them, and those are two different permissions in a browser. This
is the one thing that decides whether a given portrait gets the full effect or
the reduced one, so it is worth understanding before blaming the art.

## The two bars

| Operation | Needs |
| --- | --- |
| `<img src="…">` renders | nothing |
| `getImageData()` / `texImage2D()` | request sent in CORS mode **and** an `Access-Control-Allow-Origin` response header |

So art hosted on S3 that displays perfectly today may still be unreadable. The
`crossOrigin="anonymous"` attribute asks for CORS mode, but it is all-or-nothing:
if the host doesn't answer with the header, the image fails to load *entirely*
rather than loading un-readably.

## What the feature does about it

`scripts/features/stage/postfx/asset.mjs` resolves, once per asset, the
strongest strategy that actually works, and caches the verdict:

| Strategy | When |
| --- | --- |
| `plain` | Same-origin, `data:`, `blob:` — no CORS attribute, so it reuses the cache entry the visible `<img>` already filled |
| `anon` | Cross-origin, host sends the header |
| `anon-bust` | Cross-origin, the first CORS attempt failed but a cache-busted retry succeeded |
| `cors` | Host serves the file but never the header — unreadable |
| `missing` | The file itself doesn't load |

`cors` and `missing` both fall back to the CSS presentation (ambient tint, key
gradient, shade gradient — masked to the art's silhouette by URL, which never
requires pixel access). Players see a slightly simpler look; nobody sees an
error. Only the GM panel reports it, and only `cors` is reported as fixable.

### The `anon-bust` rung

A response fetched in **no-CORS** mode — by the visible `<img>`, by an actor
sheet, by a token — can be reused from the HTTP cache to satisfy a later
**CORS-mode** request. That cached copy carries no `Access-Control-Allow-Origin`,
so the CORS load fails even though the bucket is configured correctly. It's worse
behind CloudFront, which won't forward `Origin` unless told to and will cache and
serve the header-less variant to everyone.

Retrying under `?glstage-cors=1` sidesteps the poisoned entry. The retry is
**skipped for pre-signed URLs** (`X-Amz-Signature`, `X-Amz-Credential`,
`AWSAccessKeyId`, Azure `sig=`), where the signature covers the query string and
an extra parameter would turn a CORS problem into a 403.

## Enabling full lighting on an S3 bucket

Add a CORS rule allowing `GET` from the Foundry origin. The exact rule, with the
origin already filled in, is printed to the browser console the first time an
unreadable asset is hit:

```json
[
  {
    "AllowedHeaders": ["*"],
    "AllowedMethods": ["GET", "HEAD"],
    "AllowedOrigins": ["https://your-foundry-host.example"],
    "ExposeHeaders": [],
    "MaxAgeSeconds": 3000
  }
]
```

If the bucket sits behind CloudFront, the distribution must **also** forward
`Origin`, `Access-Control-Request-Method` and `Access-Control-Request-Headers`,
or it will cache one variant of the response and serve it to every origin.

Hosts that already work without any change: Foundry's own `Data` directory
(same-origin), The Forge asset library, and any CDN configured with `*`.

## Verifying a change

Almost none of this is reviewable by eye, so the maths is factored into pure
exported helpers and pinned down by:

```bash
node tools/postfx-check.mjs
```

Zero failures required. It covers the blur kernel, the light geometry and its
sign conventions, framing detection, background sampling (where the key light is
located, and the luminance-matching contract `bounceLight` has to hold), column
interpolation, the CORS strategy ladder, and a cross-check that every shader
uniform is both declared in the GLSL and looked up from JS — a typo there returns
`null` and every write to it becomes a silent no-op.

The fragment shader itself is not covered: GLSL needs a GPU to run, and mirroring
its maths in JS would only create a second copy to drift. The uniform cross-check
and the NIGHT-constant check are the only automated guards it has. When changing
a lighting term, reproduce the old and new arithmetic side by side over a few
rooms and art tones before trusting it — the baseline figures quoted above came
from exactly that, and it caught two rebalances that would have re-exposed every
stage in the process of "improving" it.

It cannot check how any of it *looks*. That needs a real session with real art.
