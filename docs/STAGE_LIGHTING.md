# Stage character lighting

Two things decide how a character ends up looking: **how it is framed**, and
**where it is hosted**. The first shapes the light; the second decides whether
the full effect is available at all.

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
sign conventions, framing detection, the CORS strategy ladder, and a cross-check
that every shader uniform is both declared in the GLSL and looked up from JS — a
typo there returns `null` and every write to it becomes a silent no-op.

It cannot check how any of it *looks*. That needs a real session with real art.
