# Stage character lighting

Three things decide how a character ends up looking: **the shading model**, **how
the art is framed**, and **where it is hosted**. The last one decides whether the
full effect is available at all.

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
| rim | Bright where the surface is thin *and* turned toward the light. |
| specular | Gated on thickness and on the art's own brightness, so a highlight lands on a pauldron and never on black cloth. |
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
