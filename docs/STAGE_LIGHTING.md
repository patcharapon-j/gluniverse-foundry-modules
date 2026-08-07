# Stage character lighting — asset hosting

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

The strategy ladder is pure logic over URLs and load outcomes, so it is testable
without a browser. `boxBlur` and the lighting geometry are exported for the same
reason — see the checks described in `CLAUDE.md`. When touching `asset.mjs`, the
cases that matter are: a presigned URL is never rewritten, an absent file is
reported as `missing` rather than `cors` (otherwise a GM goes and edits a bucket
policy over a typo), and concurrent slots share one probe.
