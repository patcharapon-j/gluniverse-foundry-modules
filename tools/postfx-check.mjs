#!/usr/bin/env node
/**
 * Checks the pure logic behind Stage character lighting.
 *
 * Almost none of this feature is reviewable by eye. A sign flip in the light
 * geometry lights characters from below; an off-by-one in the blur window tilts
 * every figure's shading; a typo'd uniform name silently becomes a no-op rather
 * than an error. All of those have happened here. The maths is deliberately
 * factored into pure exported helpers so this file can pin them down without a
 * browser or a Foundry instance.
 *
 * What it cannot check is how any of it *looks* — that still needs a real
 * session with real art.
 *
 *   node tools/postfx-check.mjs
 */

const ROOT = new URL("../", import.meta.url);
const mod = (p) => new URL(`scripts/features/stage/postfx/${p}`, ROOT).href;

let failed = 0;
let checks = 0;

function ok(cond, label, extra = "") {
  checks++;
  console.log(`${cond ? "  ok  " : "FAIL  "}${label}${extra ? "  → " + extra : ""}`);
  if (!cond) failed++;
}

function near(a, b, eps = 1e-6) {
  return Math.abs(a - b) < eps;
}

function section(title) {
  console.log(`\n── ${title} ──`);
}

// ═══ A browser-ish environment, enough for asset.mjs ═══
// asset.mjs reads window.location and constructs Image; nothing else touches
// the DOM at import time.
const ORIGIN = "https://vtt.example.com";
globalThis.window = { location: { href: `${ORIGIN}/game`, origin: ORIGIN } };

let HOSTS = {};
let requests = [];

globalThis.Image = class {
  constructor() {
    this._listeners = {};
    this.naturalWidth = 0;
    this.crossOrigin = null;
    this.complete = false;
  }
  addEventListener(type, fn) {
    this._listeners[type] = fn;
  }
  set src(value) {
    const anonymous = this.crossOrigin === "anonymous";
    requests.push({ url: value, anonymous });
    const rule = HOSTS[value];
    const succeeds = rule ? (anonymous ? rule.cors : rule.plain) : false;
    queueMicrotask(() => {
      if (succeeds) {
        this.naturalWidth = 512;
        this._listeners.load?.();
      } else {
        this._listeners.error?.();
      }
    });
  }
};

const { boxBlur, describeFigure } = await import(mod("normal-map.mjs"));
const { keyDirection, cssGradientAngle, lightPlacement, SLOT_ANCHOR_Y } = await import(
  mod("index.mjs")
);
const { loadPixelImage, assetReason, corsRetryUrl, isSameOrigin, invalidateAsset } = await import(
  mod("asset.mjs")
);

// ═══ 1. Blur kernel ═══
// The normal map is the gradient of a blurred alpha field. An asymmetric window
// biases that gradient, and every character ends up lit slightly off-axis.
section("blur kernel");
{
  const W = 21;
  const H = 21;
  const R = 3;
  const run = (field, passes = 1) => {
    const src = Float32Array.from(field);
    const dst = new Float32Array(W * H);
    for (let i = 0; i < passes; i++) boxBlur(src, dst, W, H, R);
    return src;
  };

  const flat = run(new Array(W * H).fill(0.5));
  let maxErr = 0;
  for (const v of flat) maxErr = Math.max(maxErr, Math.abs(v - 0.5));
  ok(maxErr < 1e-5, "constant field is preserved (kernel sums to 1)");

  const impulse = new Array(W * H).fill(0);
  const c = (W - 1) / 2;
  impulse[c * W + c] = 1;
  const blurred = run(impulse);
  let hErr = 0;
  let vErr = 0;
  for (let d = 1; d <= 6; d++) {
    hErr = Math.max(hErr, Math.abs(blurred[c * W + (c - d)] - blurred[c * W + (c + d)]));
    vErr = Math.max(vErr, Math.abs(blurred[(c - d) * W + c] - blurred[(c + d) * W + c]));
  }
  ok(hErr < 1e-6, "impulse blurs symmetrically horizontally");
  ok(vErr < 1e-6, "impulse blurs symmetrically vertically");

  // One box pass makes a plateau, not a peak — only the three passes production
  // runs produce a unique maximum.
  const smooth = run(impulse, 3);
  let peakIdx = -1;
  let peak = -1;
  smooth.forEach((v, i) => {
    if (v > peak) {
      peak = v;
      peakIdx = i;
    }
  });
  ok(peakIdx === c * W + c, "3-pass impulse peaks at the centre");

  // Gradient sign: normal-map negates this so the normal points *out* of the
  // silhouette. Flip it and light wraps the wrong way around every limb.
  const half = new Array(W * H).fill(0);
  for (let y = 0; y < H; y++) for (let x = 10; x < W; x++) half[y * W + x] = 1;
  const edge = run(half);
  ok(edge[10 * W + 11] - edge[10 * W + 9] > 0, "gradient rises toward the filled side");
}

// ═══ 2. Lighting geometry ═══
section("lighting geometry (+Y is DOWN, matching the normal map's green channel)");
{
  const check = (label, actual, expected) => {
    ok(expected.every((v, i) => near(actual[i], v)), label, JSON.stringify(actual));
  };
  check("light above yields -Y", keyDirection([0.5, 0.3], 0.5), [0, -1]);
  check("light below yields +Y", keyDirection([0.5, 0.95], 0.5, 0.5), [0, 1]);
  check("light to the right", keyDirection([0.9, SLOT_ANCHOR_Y], 0.5), [1, 0]);
  check("light to the left", keyDirection([0.1, SLOT_ANCHOR_Y], 0.5), [-1, 0]);

  const left = keyDirection([0.5, 0.35], 0.2);
  const right = keyDirection([0.5, 0.35], 0.8);
  ok(
    Math.sign(left[0]) !== Math.sign(right[0]),
    "characters flanking one light are lit from opposite sides"
  );

  ok(
    SLOT_ANCHOR_Y > 0.6 && SLOT_ANCHOR_Y < 0.75,
    "fallback anchor sits at mid-body, not the feet",
    SLOT_ANCHOR_Y.toFixed(2)
  );
}

section("CSS gradient angle (0deg = to top; the lit colour sits at the 0% stop)");
{
  // The gradient must point AWAY from the light, because a gradient's 0% stop
  // is at the end opposite its angle. Getting this backwards puts the lit
  // colour on the shadow side.
  ok(near(cssGradientAngle([0, -1]), 180), "light above → 180deg");
  ok(near(cssGradientAngle([1, 0]), 270), "light right → 270deg");
  ok(near(cssGradientAngle([-1, 0]), 90), "light left → 90deg");
  ok(near(cssGradientAngle([0, 1]), 0), "light below → 0deg (never -0 or -180)");
}

// ═══ 3. Framing ═══
// Stage art is knee-up or full-body, and the two need different treatment. The
// silhouette's aspect is the only signal available for telling them apart.
section("framing detection");
const figureOf = (pxW, pxH, artW = 256, artH = 256) =>
  describeFigure(
    {
      x0: Math.round((artW - pxW) / 2),
      y0: Math.round((artH - pxH) / 2),
      x1: Math.round((artW - pxW) / 2) + pxW - 1,
      y1: Math.round((artH - pxH) / 2) + pxH - 1,
    },
    artW,
    artH
  );

const fullBody = figureOf(88, 254);
const kneeUp = figureOf(140, 254);
const waistUp = figureOf(180, 254);
{
  ok(fullBody.bodyFraction > 0.95, "full body reads as a whole body", fullBody.bodyFraction.toFixed(2));
  ok(
    kneeUp.bodyFraction > 0.5 && kneeUp.bodyFraction < 0.75,
    "knee-up reads as a partial body",
    kneeUp.bodyFraction.toFixed(2)
  );
  ok(waistUp.bodyFraction < kneeUp.bodyFraction, "waist-up shows less body than knee-up");

  // Art with no transparency at all — a JPEG portrait. Must not divide by zero.
  const opaque = describeFigure({ x0: 1e9, y0: 1e9, x1: -1, y1: -1 }, 512, 768);
  ok(
    opaque.x0 === 0 && opaque.x1 === 1 && opaque.bodyFraction > 0.3,
    "empty silhouette falls back to the whole image"
  );
}

section("key light placement");
{
  const BG = 16 / 9;
  const place = (fig, centroid, pos, artAspect) =>
    lightPlacement(centroid, pos, fig, artAspect, BG);
  const FULL_A = 88 / 254;
  const KNEE_A = 140 / 254;

  const overhead = place(fullBody, [0.5, 0.2], 0.5, FULL_A);
  ok(overhead.lightP[1] < fullBody.y0, "an overhead light sits above the silhouette");
  ok(near(overhead.lightP[0], 0.5 * FULL_A), "and stays horizontally centred");

  const below = place(fullBody, [0.5, 0.99], 0.5, FULL_A);
  ok(below.lightP[1] > fullBody.y1, "a light below the feet sits under the silhouette");

  const l = place(fullBody, [0.5, 0.35], 0.2, FULL_A);
  const r = place(fullBody, [0.5, 0.35], 0.8, FULL_A);
  const centreX = 0.5 * FULL_A;
  ok(l.lightP[0] > centreX && r.lightP[0] < centreX, "flanking slots light from opposite sides");

  // A wider background makes the same horizontal offset a longer real distance,
  // so the angle to the light must flatten.
  const artCy = (fullBody.y0 + fullBody.y1) / 2;
  const ratio = (p) => Math.abs(p.lightP[0]) / Math.abs(p.lightP[1] - artCy);
  ok(
    ratio(lightPlacement([0.8, 0.35], 0.5, fullBody, FULL_A, 21 / 9)) >
      ratio(lightPlacement([0.8, 0.35], 0.5, fullBody, FULL_A, 1)),
    "a wider background pushes the light further sideways"
  );

  // Attenuation is normalised at the figure's centre, so a positioned light
  // adds a gradient across the body without changing overall exposure.
  const artCx = ((fullBody.x0 + fullBody.x1) / 2) * FULL_A;
  const measured = Math.hypot(
    overhead.lightP[0] - artCx,
    overhead.lightP[1] - artCy,
    overhead.lightZ
  );
  ok(near(measured, overhead.refDist, 1e-9), "refDist is the distance to the figure centre");

  const dist = (p, cx, y) => Math.hypot(p.lightP[0] - cx, p.lightP[1] - y, p.lightZ);
  const headToFoot = dist(overhead, artCx, fullBody.y1) / dist(overhead, artCx, fullBody.y0);
  ok(headToFoot > 1, "the head is nearer an overhead light than the feet");

  // The framing payoff: on a knee-up crop the lamp is proportionally further
  // from everything, so the top-to-bottom gradient is gentler.
  const knee = place(kneeUp, [0.5, 0.2], 0.5, KNEE_A);
  const kCx = ((kneeUp.x0 + kneeUp.x1) / 2) * KNEE_A;
  const kneeRatio = dist(knee, kCx, kneeUp.y1) / dist(knee, kCx, kneeUp.y0);
  ok(kneeRatio < headToFoot, "a knee-up crop gets a gentler vertical gradient",
     `${kneeRatio.toFixed(2)} < ${headToFoot.toFixed(2)}`);

  // Grounding shadow needs a floor in frame.
  ok(overhead.ground > 0.25, "full body gets a floor shadow", overhead.ground.toFixed(3));
  ok(knee.ground < 0.1, "knee-up crop gets almost none", knee.ground.toFixed(3));
}

// ═══ 4. Shader uniforms ═══
// getUniformLocation on a name the shader doesn't declare returns null, and
// gl.uniform*(null, …) is a silent no-op. A typo here costs nothing at load and
// everything at render.
section("shader uniform wiring");
{
  const src = await (await import("node:fs/promises")).readFile(
    new URL("scripts/features/stage/postfx/gl.mjs", ROOT),
    "utf8"
  );
  const declared = new Set(
    [...src.matchAll(/^uniform\s+\w+\s+(u_\w+)\s*;/gm)].map((m) => m[1])
  );
  const requested = new Set(
    [...src.matchAll(/getUniformLocation\(program,\s*"(\w+)"\)/g)].map((m) => m[1])
  );
  const used = new Set([...src.matchAll(/\bu_\w+/g)].map((m) => m[0]));

  for (const name of requested) {
    ok(declared.has(name), `getUniformLocation("${name}") matches a declared uniform`);
  }
  for (const name of declared) {
    // Every declared uniform must be both read by the shader and set from JS,
    // or it is dead weight that reads as configuration.
    const readCount = [...src.matchAll(new RegExp(`\\b${name}\\b`, "g"))].length;
    ok(readCount > 1 && used.has(name), `${name} is actually read by the shader`);
    if (!name.startsWith("u_art") && !name.startsWith("u_nrm")) {
      ok(requested.has(name), `${name} has a location looked up in JS`);
    }
  }
}

// ═══ 5. Asset CORS strategy ═══
section("asset CORS strategy");
{
  ok(isSameOrigin("worlds/foo/art.webp"), "relative Foundry path is same-origin");
  ok(isSameOrigin("data:image/png;base64,AAAA"), "data: URL is same-origin");
  ok(!isSameOrigin("https://bucket.s3.us-east-1.amazonaws.com/a.webp"), "S3 URL is cross-origin");

  ok(corsRetryUrl("worlds/foo/art.webp") === null, "same-origin needs no retry URL");
  ok(
    corsRetryUrl("https://bucket.s3.amazonaws.com/a.webp?v=3")?.includes("v=3"),
    "existing query params survive the cache-bust"
  );
  ok(
    corsRetryUrl(
      "https://bucket.s3.amazonaws.com/a.webp?X-Amz-Credential=AKIA&X-Amz-Signature=deadbeef"
    ) === null,
    "presigned URL is never rewritten (an extra param would 403 it)"
  );
  ok(
    corsRetryUrl("https://acct.blob.core.windows.net/c/a.webp?sv=2021&sig=abc") === null,
    "Azure SAS URL is never rewritten"
  );

  const attempt = async (src) => {
    requests = [];
    try {
      await loadPixelImage(src);
      return { ok: true, reason: assetReason(src) };
    } catch (err) {
      return { ok: false, reason: err.reason };
    }
  };

  const same = `${ORIGIN}/worlds/art.webp`;
  HOSTS = { [same]: { cors: true, plain: true } };
  await attempt(same);
  ok(
    requests.every((q) => !q.anonymous),
    "same-origin loads without crossOrigin, reusing the visible <img>'s cache entry"
  );

  const clean = "https://good.s3.amazonaws.com/a.webp";
  HOSTS = { [clean]: { cors: true, plain: true } };
  const cleanResult = await attempt(clean);
  ok(cleanResult.ok, "CORS-clean bucket succeeds");
  ok(!requests.some((q) => q.url.includes("glstage-cors")), "and is not cache-busted needlessly");

  // The case the retry exists for: a header-less response cached from a no-CORS
  // request fails a correctly-configured bucket.
  const poisoned = "https://cdn.example.com/a.webp";
  HOSTS = {
    [poisoned]: { cors: false, plain: true },
    [`${poisoned}?glstage-cors=1`]: { cors: true, plain: true },
  };
  ok((await attempt(poisoned)).ok, "a poisoned cache entry is recovered by the busted retry");

  const nocors = "https://nocors.s3.amazonaws.com/a.webp";
  HOSTS = {
    [nocors]: { cors: false, plain: true },
    [`${nocors}?glstage-cors=1`]: { cors: false, plain: true },
  };
  ok((await attempt(nocors)).reason === "cors", "a host that sends no header reports 'cors'");

  HOSTS = {};
  const gone = await attempt("https://nocors.s3.amazonaws.com/typo.webp");
  ok(
    gone.reason === "missing",
    "an absent file reports 'missing', not 'cors'",
    "a GM must not be sent to edit a bucket policy over a typo"
  );

  const later = "https://later.s3.amazonaws.com/a.webp";
  HOSTS = {
    [later]: { cors: false, plain: true },
    [`${later}?glstage-cors=1`]: { cors: false, plain: true },
  };
  await attempt(later);
  requests = [];
  await attempt(later);
  ok(requests.length === 0, "a cached failure costs no further requests");
  HOSTS[later] = { cors: true, plain: true };
  invalidateAsset(later);
  ok((await attempt(later)).ok, "invalidation lets a newly-configured bucket succeed");

  const shared = "https://shared.s3.amazonaws.com/a.webp";
  HOSTS = { [shared]: { cors: true, plain: true } };
  invalidateAsset(shared);
  requests = [];
  await Promise.all([loadPixelImage(shared), loadPixelImage(shared), loadPixelImage(shared)]);
  ok(requests.length <= 4, "concurrent slots share one probe", `${requests.length} requests`);
}

console.log(
  failed ? `\n${failed} of ${checks} FAILED` : `\n${checks} checks passed`
);
process.exit(failed ? 1 : 0);
