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
| gradient | amount, colour | the light's colour across the figure, soft-light, lit side strongest |
| wash | amount, colour, darkness | the room's colour as a luminance-neutral cast; how far scene darkness dims the cast |
| rim | amount, depth, softness, colour | light on the edge that faces the lamp, screened |
| back shadow | amount | the side turned away from the lamp, darker (level only) |
| looks | up to 4 × (look, opacity) | 3D LUTs, in order |
| glow | amount, radius, threshold | the art's highlights bloomed, spilling past the outline |
| strength | one dial | crossfades everything back to the art |

`light` (angle, softness) is not a layer: it is the scene's one light, shared by
every layer with a direction, so every character is lit from the same side.
`skin` (protection) is not a layer either — see below.

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

### Gradient, wash and darkness

The gradient ramps the light's colour from the lit side of the art's frame
(`litWeight`), made isotropic first so 45° is 45° on a tall portrait. The wash is
the room's colour normalised to unit luminance, so it moves hue and not level; a
saturated room is pulled toward white until no channel asks for more than
`WASH_CAST_MAX`, which keeps its luminance at exactly 1.

Foundry's **scene darkness** is the one live input the grade listens to, and it
reaches the picture only through the wash's `darkness` dial. At dial 0 a
pitch-dark scene changes nothing.

### Rim

AutoCompositing's inner-shadow model, made directional: the art's blurred
silhouette here, minus the same silhouette shifted toward the light, is high
exactly where moving toward the lamp leaves the figure. The plain inner shadow
(shifted silhouette alone) also lights every edge the blur reaches, including
ones parallel to the light — an outline, not a rim. Coverage clamps at the
frame's border, so a bust cropped by its own frame gets no false rim along the
crop. Reach and blur are in units of the art's height, divided by the aspect on
x.

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
holds back the **chromatic** change of the gradient, wash and looks by the
protection dial, and takes their **level** in full: a face in a dark room still
darkens. `guardSkin` keeps the layer's luminance and the pre-layer
chromaticity. It does not spill onto neutrals. The rim and glow are light and are
not held back. Skin-coloured things that are not skin are protected too; that is
the price of finding skin by colour.

## Seeding and re-sampling

The first time a scene is used on the stage — visible, with a character on it —
the active GM's client samples the background (`scene-sample.mjs`) and stores a
grade: the world default's amounts, with the light's colour, the room's colour,
the rim colour and the light's direction proposed from the image. A flat-colour
background proposes colours but not a direction. After that the grade is data.

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
and darkness become a CSS filter chain on the `<img>`; the gradient, wash and
back shadow become overlays masked to the art by URL. The rim, glow and looks
need the art's pixels and have no honest CSS equivalent, so the fallback leaves
them out rather than faking them. Neutral dials, or strength 0, write no filter
and invisible overlays.

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

```bash
node tools/stage-lighting-preview.mjs --out=.preview/grade.png
```

Real GPU, via Playwright. Compiles all three programs, asserts both identities at
0/255 drift, renders every layer and dial and compares the GPU with `shadePixel`
pixel for pixel (coverage outside the art included), reads the bloom pyramid back
and compares it with `bloomPyramid`, and writes a contact sheet. **Look at the
contact sheet** — the ghosting in the first glow and the seam in the first
saturation both passed every numeric check and were caught there.

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
