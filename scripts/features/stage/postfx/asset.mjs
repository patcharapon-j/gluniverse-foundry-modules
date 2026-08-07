/**
 * Stage post-processing — CORS-aware asset loading.
 *
 * Every part of this feature that touches pixels (the normal-map prepass, the
 * background sampler, the GL texture upload) needs the browser to consider the
 * asset *readable*, not merely displayable. Those are different bars, and the
 * gap between them is where remotely-hosted art — S3 above all — lands:
 *
 *   - A plain `<img src="https://bucket.s3.../art.webp">` renders with no CORS
 *     headers whatsoever. This is why art "already works" on the stage.
 *   - `getImageData` / `texImage2D` need the image to have been fetched in CORS
 *     mode AND the response to carry `Access-Control-Allow-Origin`. Without
 *     both, the canvas is tainted and reads throw `SecurityError`.
 *
 * So `crossOrigin = "anonymous"` is necessary but not sufficient, and it is not
 * free either: if the host does not answer with the header, the image fails to
 * load *at all* rather than loading un-readably.
 *
 * This module resolves, once per asset, the strongest load strategy that
 * actually works, and remembers it:
 *
 *   plain      same-origin (or data:/blob:) — no attribute needed, and omitting
 *              it reuses the cache entry the visible <img> already populated
 *   anon       cross-origin with working CORS headers
 *   anon-bust  cross-origin where the first anonymous attempt failed but a
 *              cache-busted retry succeeded — see below
 *   cors       the host serves the file but never the header: unreadable
 *   missing    the file itself does not load
 *
 * The `anon-bust` rung exists because of a specific, common S3/CloudFront
 * failure that looks exactly like a misconfigured bucket but isn't. A response
 * fetched in no-CORS mode (by the visible `<img>`, by Foundry's own token or
 * actor-sheet render) can be reused from the HTTP cache for a later CORS-mode
 * request. That cached copy has no `Access-Control-Allow-Origin` on it, so the
 * anonymous load fails even though the bucket is configured correctly. It is
 * worse behind CloudFront, which does not forward the `Origin` header unless
 * told to, and will happily cache and serve the header-less variant to
 * everyone. Retrying under a distinct URL sidesteps the poisoned entry.
 *
 * The retry is skipped for pre-signed URLs, where the signature covers the
 * query string and an extra parameter would turn a CORS problem into a 403.
 */

/** Query parameter used for the cache-busting retry. */
const BUST_PARAM = "glstage-cors";

/** Markers that identify a signed URL, whose query string must not be touched. */
const SIGNED_RE = /(^|&)(X-Amz-Signature|X-Amz-Credential|AWSAccessKeyId|Signature|sig|token)=/i;

/** src → strategy record. Small and long-lived; keyed by the original src. */
const _strategy = new Map();

/** src → in-flight resolution, so N slots don't each probe the same asset. */
const _probing = new Map();

/** The CORS advice is logged once per session, not once per portrait. */
let _advised = false;

/** Resolve a Foundry asset path against the page. Returns null if unparseable. */
function toUrl(src) {
  try {
    return new URL(src, window.location.href);
  } catch (_e) {
    return null;
  }
}

/**
 * Whether the asset can be read without any CORS negotiation.
 * `data:` and `blob:` URLs are same-origin by definition.
 */
export function isSameOrigin(src) {
  if (!src) return false;
  if (/^(data|blob):/i.test(src)) return true;
  const url = toUrl(src);
  return !!url && url.origin === window.location.origin;
}

/** Whether appending a query parameter is safe for this URL. */
function bustable(url) {
  if (!url || !/^https?:$/i.test(url.protocol)) return false;
  return !SIGNED_RE.test(url.search.replace(/^\?/, ""));
}

/** The same asset under a URL the HTTP cache has no header-less entry for. */
function bustedUrl(url) {
  const copy = new URL(url.href);
  copy.searchParams.set(BUST_PARAM, "1");
  return copy.href;
}

/**
 * Load one image under an explicit CORS mode.
 * @param {string} url
 * @param {boolean} anonymous  Whether to request in CORS mode.
 */
function loadOnce(url, anonymous) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    // Must be set before `src`, or the request goes out in the wrong mode.
    if (anonymous) img.crossOrigin = "anonymous";
    img.decoding = "async";

    const done = () => {
      // A zero-sized decode is a failure the `load` event doesn't report.
      if (!img.naturalWidth) reject(new Error("empty decode"));
      else resolve(img);
    };
    img.addEventListener("load", done, { once: true });
    img.addEventListener("error", () => reject(new Error("load failed")), { once: true });
    img.src = url;
    if (img.complete && img.naturalWidth) done();
  });
}

/**
 * Tell the GM, once, how to make a remote asset host readable. This is the only
 * actual fix when a bucket genuinely serves no CORS headers, and it is a
 * two-minute change — worth more than silently degrading forever.
 */
function adviseOnce(url) {
  if (_advised) return;
  _advised = true;
  const origin = window.location.origin;
  console.warn(
    `gluniverse | Stage lighting can display ${url.host} art but cannot read its ` +
      `pixels, because the host does not send an Access-Control-Allow-Origin header. ` +
      `Those characters fall back to the simpler tinted look.\n` +
      `To enable full lighting, add a CORS rule to the bucket allowing GET from ` +
      `this origin:\n` +
      JSON.stringify(
        [
          {
            AllowedHeaders: ["*"],
            AllowedMethods: ["GET", "HEAD"],
            AllowedOrigins: [origin],
            ExposeHeaders: [],
            MaxAgeSeconds: 3000,
          },
        ],
        null,
        2
      ) +
      `\nIf the bucket sits behind CloudFront, the distribution must also forward ` +
      `the Origin, Access-Control-Request-Method and Access-Control-Request-Headers ` +
      `headers, or it will cache and serve a response with no CORS header on it.`
  );
}

/**
 * Work out how (and whether) this asset can be read, without leaving a decoded
 * image alive afterwards.
 * @returns {Promise<{mode:string, url:string, reason:string}>}
 */
async function resolveStrategy(src) {
  if (isSameOrigin(src)) return { mode: "plain", url: src, reason: "ok" };

  const url = toUrl(src);
  if (!url) return { mode: "none", url: src, reason: "missing" };

  try {
    await loadOnce(src, true);
    return { mode: "anon", url: src, reason: "ok" };
  } catch (_e) {
    /* fall through — either no CORS header, a poisoned cache entry, or a 404 */
  }

  if (bustable(url)) {
    const busted = bustedUrl(url);
    try {
      await loadOnce(busted, true);
      return { mode: "anon-bust", url: busted, reason: "ok" };
    } catch (_e) {
      /* fall through */
    }
  }

  // Distinguish "the host won't let us read it" from "the file isn't there".
  // Only the first is worth telling the GM how to fix.
  try {
    await loadOnce(src, false);
    adviseOnce(url);
    return { mode: "none", url: src, reason: "cors" };
  } catch (_e) {
    return { mode: "none", url: src, reason: "missing" };
  }
}

/**
 * Load an image whose pixels are readable — from a canvas, or as a WebGL
 * texture. Rejects when no strategy works; the caller degrades.
 *
 * @param {string} src
 * @returns {Promise<HTMLImageElement>}
 */
export async function loadPixelImage(src) {
  if (!src) throw new Error("no src");

  let strategy = _strategy.get(src);
  if (!strategy) {
    if (!_probing.has(src)) {
      _probing.set(
        src,
        resolveStrategy(src).then((result) => {
          _strategy.set(src, result);
          _probing.delete(src);
          return result;
        })
      );
    }
    strategy = await _probing.get(src);
  }

  if (strategy.reason !== "ok") {
    const err = new Error(`asset unreadable: ${strategy.reason}`);
    err.reason = strategy.reason;
    throw err;
  }
  // The probe already warmed the HTTP cache, so this is a cache hit rather
  // than a second trip to the host.
  return loadOnce(strategy.url, strategy.mode !== "plain");
}

/**
 * The cache-busted variant of a cross-origin URL, or null when there is no
 * point trying one (same-origin, unparseable, or signed).
 *
 * Exposed for `<video>` backgrounds, which cannot use {@link loadPixelImage}
 * but hit the identical poisoned-cache problem.
 */
export function corsRetryUrl(src) {
  if (!src || isSameOrigin(src)) return null;
  const url = toUrl(src);
  if (!bustable(url)) return null;
  return bustedUrl(url);
}

/**
 * Why an asset couldn't be read, once something has tried.
 * @returns {"ok"|"cors"|"missing"|"tainted"|undefined} undefined = not yet probed.
 */
export function assetReason(src) {
  return _strategy.get(src)?.reason;
}

/**
 * Record that an asset loaded but still tainted the canvas. Belt-and-braces: a
 * successful anonymous load should guarantee readability, but a proxy that
 * rewrites headers between the two requests could break that assumption, and
 * without this the next render would retry the same doomed read.
 */
export function markTainted(src) {
  if (!src) return;
  _strategy.set(src, { mode: "none", url: src, reason: "tainted" });
}

/** Forget what we learned about an asset — its bytes may have changed. */
export function invalidateAsset(src = null) {
  if (src) {
    _strategy.delete(src);
    _probing.delete(src);
  } else {
    _strategy.clear();
    _probing.clear();
  }
}
