# Stage character grade

The Stage grades character art so the cast reads as standing in the scene
rather than pasted over it. It is a **stack of layers the GM controls**,
modelled on a compositor's adjustment layers: the background is read once to
*propose* starting values, and after that nothing changes unless the GM changes
it.

```
scripts/features/stage/
  grade-tab.mjs            the Stage Director's Grade tab
  postfx/
    grade-model.mjs        the schema, the dials, and shadePixel — the shader in JS
    edge-field.mjs         the silhouette's distance + normal field, for the rim
    gl.mjs                 the GPU pass (main program + bloom down/up programs)
    index.mjs              slots, the tween, the CSS fallback
    grade-store.mjs        scene flag / world default / custom looks (touches `game`)
    seed.mjs               starting values from a background sample
    scene-sample.mjs       reads the background asset
    lut.mjs                looks: .cube parsing, recipes, the LUT strip
    look-library.mjs       look id → LUT, cached
    asset.mjs              CORS-aware pixel loading
```

## Two rules

Every dial in every layer keeps both, and `tools/postfx-check.mjs` enforces
both:

1. **Neutral is an exact no-op.** Every dial at its neutral value returns the art
   bit for bit — not nearly: on a GPU `pow(x, 1.0)` is `exp2(log2(x))`, so each
   step is *skipped* at neutral rather than evaluated there, and the output is
   formed as `input + (toSRGB(out) − toSRGB(in))` so the encode round trip
   cancels. Master strength 0 returns the art exactly whatever the dials say.
2. **One dial, one property.** Two dials that move the same thing are two ways of
   asking one question, and a GM who dislikes the result can no longer find which
   part they dislike.

Settings that only shape an effect — the light's angle, a colour, a softness —
have no neutral. They cannot leak: the check sets every one of them to an
extreme with every amount at 0 and requires the art back exactly.

## Where values live

| | | |
| --- | --- | --- |
| scene flag | `stage.grade` | the scene's whole stack |
| world setting | `stage.gradeDefaults` | what a scene with no grade uses |
| world setting | `stage.lookLibrary` | imported `.cube` looks: id, name, path, revision |
| actor library | `ppTrim` | a per-art correction (exposure, gamma, saturation, hue) |
| actor library | `ppOptOut` | leave this art untouched |
| world setting | `stage.ppIntensity` | master strength |
| client setting | `stage.ppQuality` | a player's own off switch |

A scene with no flag is "the world default", not "neutral": changing the default
reaches every scene nobody has graded, and none that somebody has. Grades are
written through `grade-store.mjs` only, and `normalizeGrade` is total — every
stored grade carries every key — because Foundry *merges* a flag update, and a
key the new grade lacked would survive the write.

## The layers, in shader order

| Layer | Dials | Owns |
| --- | --- | --- |
| basic | exposure, brightness, gamma, contrast, saturation, hue | tone and colour of the art itself |
| wash | amount, colour, darkness | the room's colour as a luminance-neutral cast; how far scene darkness dims the cast |
| rim | edge, edge width, edge falloff, backglow, backglow reach, colour | **the scene light** — a sharp line and a soft backglow, both in the air *outside* the outline facing the lamp |
| back shadow | amount | the side turned away from the lamp, darker (level only) |
| looks | up to 4 × (look, opacity) | 3D LUTs, in order |
| glow | amount, radius, threshold | the art's highlights bloomed, spilling past the outline |
| strength | one dial | crossfades everything back to the art |

`light` (angle, softness) is not a layer: it is the scene's one light, shared by
every layer with a direction, so every character is lit from the same side.
`skin` (protection) is not a layer either — see below.

**The light reaches the art as a rim and nothing else.** There used to be a
`gradient` layer as well — the light's colour soft-light blended across the whole
figure, strongest on the lit side — and it is the one thing a grade cannot do
honestly. The art arrives already painted with its own light, so a second one
smeared over all of it does not read as light in the room; it reads as a pale
strip laid over the character, and it was the loudest thing on the stage. Light
lands on an edge. So the directional light is a rim, the back shadow takes the
far side down in level only, and the room's own colour arrives through the wash,
which has no direction at all. A grade stored before this reads back without the
layer — `normalizeGrade` drops sections it does not know — and keeps everything
else exactly as it was.

### Basic correction

The four tone dials act on luminance only, applied to the pixel as a *ratio*, so
none of them can move chromaticity; each pins something different:

| Dial | Moves | Pinned |
| --- | --- | --- |
| exposure | white (a gain in linear light) | black |
| brightness | black (a lift) | white |
| gamma | the midtones | black and white |
| contrast | the slope about mid-grey | black, white, mid-grey |

A ratio runs away near black (lifting 0.1% luminance to 5% is 50×, which turns
dark-region colour noise into blotches), so it is capped at `TONE_RATIO_CAP` and
the rest of the luminance arrives as grey. That is also what lets brightness
lift pure black at all.

Saturation and hue act on the **OKLab** chroma vector, so neither moves
lightness. Linear light would be the obvious space and is the wrong one: a dark
channel is a tiny number there, a chroma push drives it below zero almost at
once, and in encoded values that is a channel collapsing over a sliver of the
input — a visible seam across any gradient. A colour pushed past what the
display can show has its chroma compressed at constant lightness and hue, with
a soft knee (`GAMUT_KNEE`): a hard stop is continuous but has a corner, and the
corner is a seam.

### Wash and darkness

The wash is
the room's colour normalised to unit luminance, so it moves hue and not level; a
saturated room is pulled toward white until no channel asks for more than
`WASH_CAST_MAX`, which keeps its luminance at exactly 1.

Foundry's **scene darkness** is the one live input the grade listens to, and it
reaches the picture only through the wash's `darkness` dial. At dial 0 a
pitch-dark scene changes nothing.

### Rim

The scene's light, and the only thing carrying it.

**It is light in the air, not paint on the figure.** The whole of it lives
outside the outline; a pixel the art covers is never touched, at any setting.
That is not a tolerance, it is the shape of the effect: a rim light is the lamp
*behind* a figure, and what you see of it is the light that got past the
figure's edge. Nothing of it is on the character, so nothing of it can bleed
into one — the rim does not appear in the layer stack at all, it is emission in
{@link shadeFragment}. The lit edge still reads as attached, because a
silhouette's own boundary pixels are partly transparent and the alpha composite
lets exactly that much of the light through them; the art's coverage is already
the only honest answer to how much of a boundary pixel is figure.

Two lights, sharing a colour and a direction, both read from the **edge field**
(`edge-field.mjs`) — built once per asset during `prepare` and uploaded as one
RGBA8 texture the shader reads with a single tap:

- **the edge** — a sharp line hugging the outline and ending at `width`, which
  is deliberately small (`RIM_MAX_WIDTH`, 2% of the art's height at its widest,
  and a few pixels at the shipped default). Sharpness is the whole of its job: a
  rim light is sold by the catch being *thin*, and a dial with a centimetre of
  reach is a smear at every setting. `falloff` shapes the profile and nothing
  else; even at its flattest it keeps `RIM_FEATHER_MIN` of feather, so its end is
  not a stair.
- **the backglow** — the same lamp spilling into the room around the figure,
  reaching `haloSpread` (up to `HALO_MAX_SPREAD`) and far weaker (`HALO_GAIN`,
  which it cannot exceed, or the sharp line would sit on a bright field instead
  of against the room). Its falloff is squared rather than a smoothstep: a
  smoothstep leaves on a shelf, and over that distance a shelf is a slab of light
  with a visible edge on it. It is its own dial rather than a softness on the
  edge, because widening a rim does not make a glow — it makes a fuzzy rim, which
  reads as the edge being out of focus.

Both are gated by *which way the outline faces* — the gradient of the same
field, the outline's true outward normal, dotted with the light. The light's
`softness` is how gradually that fades toward the terminator. It is never
crossed: an edge facing away from the lamp is not lit at any setting, because a
rim that carries all the way round is an outline rather than light.

Two things that are read wrong easily and fail only on the sheet. The distance
is the **difference of the two distance channels** and never either alone: each
is the signed distance rectified to one side, so a texel the outline runs
through carries both, and either read on its own is wrong by up to a texel right
where the sharp edge lives — which drew it faint and broken, in dashes. And both
lights **rise out of the outline** over `RIM_OCCLUDE_RISE` rather than starting
at full strength: the figure occludes its own light, and a step at `sd = 0` is
not only an edge no display can draw but a sign test, which the GPU computes in
float32 and the reference in float64 — the two then disagree by the entire band
on the brightest pixels the rim draws.

A figure cropped by its own frame has no outline along the crop (the field finds
none there), and art with no transparency at all has no outline anywhere, so it
gets no rim.

Two things about the field are the difference between a rim that fades out
cleanly and one that fades out in **dashes**, and both are invisible in a diff:

- Seeds are placed at **sub-pixel** positions, from `(coverage − ½) / |∇coverage|`.
  Threshold coverage at 0.5 instead and every seed sits at a cell centre, so the
  field is wrong by up to half a cell in a pattern that repeats along the
  outline — and a half-cell ripple with a period of a few cells has a *gradient*
  of several tenths. That gradient is the direction the rim lights from.
- The field is then **smoothed** (`SMOOTH_PASSES`), which finishes what seeding
  leaves. The order matters: a blur wide enough to flatten the *unseeded* ripple
  would be wider than the features it is protecting, because that ripple's period
  grows with how shallow the outline is.

Near the terminator a tenth of direction is the difference between lit and
unlit, so either one missing draws the fading rim as a row of detached ticks.
No number in `postfx-check` catches it; the contact sheet shows it at a glance.

### Glow

A bloom pyramid, not a ring of taps. A single pass sampling a wide radius leaves
visible copies of every sharp highlight; the pyramid does not at any radius,
because each level only blurs by a texel or two of its own resolution.

```
down 0   bright pass at half size: four bilinear taps, each thresholded (4×4 box)
down k   the same four-tap box from the level above   (GLOW_LEVELS levels)
up k     mix(down k, 3×3 tent of up k+1, bloomWeights[k])
```

`bloomWeights` makes the result the *normalised sum* of every level: at spread 0
only the finest counts, at spread 1 all count equally. A plain mix toward the
coarser level washes the core out; a plain sum overflows an 8-bit target. The
weighted mix is that normalised sum one level at a time and never leaves 0..1.
Targets are half-float where the GPU can render and filter it, 8-bit otherwise.

The bloom passes use their **own vertex shader, unflipped**: a render target
stores rows bottom-up, so a pass writing at the main pass's flipped coordinate
mirrors the image, and the next pass mirrors it back. Unflipped, every level
holds image row *y* at texture *y* — the art texture's convention — and the main
pass samples the bloom at its own `v_uv`. The glow is the one layer that draws
outside the art's coverage, as premultiplied emission.

### Looks

Every look is a 3D LUT on encoded colour, whatever it started as:

- **built-in** — a recipe in `lut.mjs` (exposure, contrast, saturation, hue,
  white balance, split tones, fade), baked on first use. The 13 are named after
  AutoCompositing's presets; their ids are stored data and are never renamed.
- **custom** — a `.cube` file (3D or 1D, any domain), imported from the Grade
  tab, validated *before* it is uploaded into `worlds/<id>/gluniverse/luts/`,
  resampled to `LUT_SIZE` (33) if larger.

WebGL1 has no 3D textures, so a LUT is a **strip**: N tiles of N×N side by side,
tile *b* holding blue slice *b*. The shader samples bilinearly inside tiles *b*
and *b+1* at texel centres — so a tile never bleeds into its neighbour — and
mixes them: trilinear. `sampleStrip` does the same on the same 8-bit data.

Recipes are fitted into gamut **once, at the end, softly, in OKLab**
(`fitOklab`). Fitting after every step — or pulling toward grey at constant
luminance — puts creases in the colour cube that no 33-point grid can follow;
near white a bright yellow's blue channel went from 0 to 103 across 2% of the
input.

Looks load in the background (`look-library.mjs`) and are **never awaited by a
render**: a look not yet loaded draws at opacity 0 and its arrival schedules
another render; a look that fails draws at 0 with one console warning. A custom
look's cache key carries its revision, so re-importing a file under the same
name reloads it everywhere. Every look texture is uploaded before any is bound:
an upload binds its new texture to whichever unit is active, which silently
replaced the previous slot's look.

### Skin

A blue night scene applied honestly turns every face blue, and nobody reads that
as moonlight. Skin (a soft ellipse in Cb/Cr, measured on the *original* art)
holds back the **chromatic** change of the wash and the looks by the
protection dial, and takes their **level** in full: a face in a dark room still
darkens. `guardSkin` keeps the layer's luminance and the pre-layer
chromaticity. It does not spill onto neutrals. The rim and glow are light and are
not held back. Skin-coloured things that are not skin are protected too; that is
the price of finding skin by colour.

## Seeding and re-sampling

The first time a scene is used on the stage — visible, with a character on it —
the active GM's client samples the background (`scene-sample.mjs`) and stores a
grade: the world default's amounts, with the room's colour, the rim's colour and
the light's direction proposed from the image. A flat-colour background proposes
colours but not a direction. After that the grade is data.

The room colour is *saturated* on the way in (`roomCast`): an average over a
whole background is far greyer than the light it reads as, so its OKLab chroma is
multiplied by `WASH_CHROMA_BOOST` and, once the room has a clear hue, lifted to at
least `WASH_CHROMA_MIN`. A grey room stays grey. The rim's colour is the
background where the light appears to be, read as a light rather than as paint
(`toKeyLight`, `KEY_WHITEN`) and then pulled `RIM_WHITEN` further toward white,
because a grazing edge is the brightest thing a lamp does — but only part of the
way, so a blue room still lights blue.

"Re-sample background" re-reads the image and replaces only the colours and the
direction, keeping every amount. "Reset to defaults" stores the world default *as
the scene's grade* rather than clearing the flag — a scene with no grade would be
re-seeded the next time it is staged.

The sampler reads the background asset only; Foundry's lights, tiles and weather
are invisible to it.

## Live editing

The Grade tab edits a draft of the grade of the scene the GM is viewing.
Dragging previews on the GM's screen only, immediately
(`previewPostFXGrade`); releasing saves to the scene flag, and every client
viewing that scene eases into it over the 620 ms reveal (`setGrade`, also used
for scene darkness). A different look stack cannot be crossfaded in four slots,
so the new one fades in from nothing.

## The CSS fallback

Used when the art cannot be read (CORS) or there is no WebGL. Basic correction
and darkness become a CSS filter chain on the `<img>`; the wash and the back
shadow become overlays masked to the art by URL. The rim, glow and looks need the
art's pixels and have no honest CSS equivalent, so the fallback leaves them out
rather than faking them. Neutral dials, or strength 0, write no filter and
invisible overlays.

Since the rim is now the only way the scene light reaches the art, a slot on this
path gets the room's colour and the shadow side and **no light** — less than the
shader, never different from it. A `drop-shadow` offset toward the lamp is the
obvious fake and is not one: it is the silhouette blurred and shifted, which has
no sharp edge in it and is bright where the figure is thin, so it reads as a
smudge behind the character rather than as a line caught on it.

## One canvas, many characters

There is a single WebGL context and a single render target for the whole feature
— a browser caps out around sixteen contexts, and a stage can hold more slots
than that. Characters are graded into it one at a time and each result is copied
into that slot's own 2D canvas.

That makes the copy-out a **synchronisation point**, and the pipeline is split
around it:

| | Suspends? | Touches the shared canvas? |
| --- | --- | --- |
| `StageGL.prepare` | yes — fetch, decode, upload | no |
| `StageGL.draw` | **never** (bloom passes included) | yes |
| `StagePostFX._blit` | never | reads it |

Yield anywhere between `draw` and `_blit` and the slot copies out whatever the
*next* character drew — which looks like the wrong art was assigned, not like a
timing bug. So: **no `await` between `draw` and `_blit`.**

The context is a suite Surface (`core/gl-surfaces.mjs`) and can be released
while idle; a lost or released context is rebuilt on the next `prepare`, and a
loss schedules a re-render so a GPU reset does not leave the stage on the CSS
fallback. (Headless Chromium's software GPU resets once shortly after a page's
first context; the browser harness waits it out and exercises exactly that
path.)

## Checking it

```bash
node tools/postfx-check.mjs
```

Pure logic, no browser. Pins both rules for every dial and layer; the gamut and
seam behaviour; the look pipeline (`.cube` parsing and refusals, strip sampling,
every recipe surviving its bake, the library's caching and failure handling);
seeding; the tween; the CSS fallback; that every GLSL constant is *emitted from*
the model and every uniform in all three programs is declared, looked up and
written; the CORS ladder; slot ownership; and every i18n key the Grade tab builds
at runtime.

For the rim it drives the real edge field built from a real raster, rather than
sampling the model at a point: that the field's distances and normals are what
they claim to be, that a figure cropped by its frame and art with no transparency
both have no outline, that a soft gradient *inside* the figure makes no edge, and
that the edge and the backglow are two separate lights with their own reaches and
their own zeroes. The claim the whole model exists for is driven over **every
pixel the art covers, with both lights at full and every reach at maximum**: not
one of them is ever lit. The shipped edge is also measured in pixels at a
full-size render, because "sharp" is a number.

```bash
node tools/stage-lighting-preview.mjs --out=.preview/grade.png
```

Real GPU, via Playwright. Compiles all three programs, asserts both identities at
0/255 drift, renders every layer and dial and compares the GPU with `shadePixel`
pixel for pixel (coverage outside the art included), reads the bloom pyramid back
and compares it with `bloomPyramid`, and writes a contact sheet. **Look at the
contact sheet** — the ghosting in the first glow, the seam in the first
saturation, the ticks in the first SDF rim and the dashes in the first sharp edge
all passed every numeric check and were caught there.

Neither can tell you how a grade looks on real art. That needs a real session.

## Asset hosting

Grading means *reading* pixels, not just displaying them, and those are two
different permissions in a browser. This is the one thing that decides whether a
given portrait gets the full grade or the CSS fallback.

| Operation | Needs |
| --- | --- |
| `<img src="…">` renders | nothing |
| `getImageData()` / `texImage2D()` | request sent in CORS mode **and** an `Access-Control-Allow-Origin` response header |

`crossOrigin="anonymous"` is all-or-nothing: if the host doesn't answer with the
header, the image fails to load *entirely*. `asset.mjs` resolves, once per asset,
the strongest strategy that works, and caches the verdict:

| Strategy | When |
| --- | --- |
| `plain` | Same-origin, `data:`, `blob:` — no CORS attribute, so it reuses the cache entry the visible `<img>` already filled |
| `anon` | Cross-origin, host sends the header |
| `anon-bust` | Cross-origin, the first CORS attempt failed but a cache-busted retry succeeded |
| `cors` | Host serves the file but never the header — unreadable |
| `missing` | The file itself doesn't load |

`cors` and `missing` fall back to CSS. Players see a simpler look; nobody sees an
error. Only the GM panel reports it, and only `cors` is reported as fixable.

A response fetched in **no-CORS** mode — by the visible `<img>`, an actor sheet,
a token — can be reused from the HTTP cache to satisfy a later **CORS-mode**
request, and that cached copy carries no header; behind CloudFront it is worse.
Retrying under `?glstage-cors=1` sidesteps the poisoned entry. The retry is
skipped for pre-signed URLs (`X-Amz-Signature`, `X-Amz-Credential`,
`AWSAccessKeyId`, Azure `sig=`), where an extra parameter would turn a CORS
problem into a 403.

### Enabling full grading on an S3 bucket

Add a CORS rule allowing `GET` from the Foundry origin. The exact rule, with the
origin filled in, is printed to the browser console the first time an unreadable
asset is hit:

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

Behind CloudFront the distribution must **also** forward `Origin`,
`Access-Control-Request-Method` and `Access-Control-Request-Headers`.

Hosts that already work: Foundry's own `Data` directory (same-origin), The Forge
asset library, and any CDN configured with `*`. Imported `.cube` looks live in
the world folder and are always same-origin.
