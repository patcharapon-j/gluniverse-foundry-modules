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

// ═══ A browser-ish environment ═══
// asset.mjs reads window.location and constructs Image; the slot-ownership
// section below drives the real StagePostFX, which needs enough of a document
// to hang canvases off. Nothing touches any of this at import time.
const ORIGIN = "https://vtt.example.com";
globalThis.window = { location: { href: `${ORIGIN}/game`, origin: ORIGIN } };
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
globalThis.getComputedStyle = () => ({ getPropertyValue: () => "" });

/**
 * The smallest element that satisfies the effect. A canvas records what was
 * last drawn into it, which is the whole point of the ownership section.
 */
function fakeElement(tag) {
  const el = {
    tagName: String(tag).toUpperCase(),
    isConnected: true,
    children: [],
    width: 0,
    height: 0,
    painted: null,
    style: { setProperty() {}, removeProperty() {} },
    classList: {
      _s: new Set(),
      add(...c) { c.forEach((x) => this._s.add(x)); },
      remove(...c) { c.forEach((x) => this._s.delete(x)); },
      contains(c) { return this._s.has(c); },
    },
    setAttribute() {},
    appendChild(child) { el.children.push(child); return child; },
    remove() {},
  };
  if (tag === "canvas") {
    el.getContext = () => ({
      clearRect() {},
      drawImage(source) { el.painted = source?.content ?? null; },
      // The normal-map prepass reads a synthetic silhouette: a figure occupying
      // the middle of the frame, so `describeFigure` gets something plausible.
      getImageData(_x, _y, w, h) {
        const data = new Uint8ClampedArray(w * h * 4);
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const inside = x > w * 0.3 && x < w * 0.7 && y > h * 0.1 && y < h * 0.95;
            data[(y * w + x) * 4 + 3] = inside ? 255 : 0;
          }
        }
        return { data };
      },
    });
  }
  return el;
}
globalThis.document = { createElement: fakeElement, body: fakeElement("div") };

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

const { boxBlur, describeFigure, getNormalMap } = await import(mod("normal-map.mjs"));
const {
  StagePostFX,
  keyDirection,
  cssGradientAngle,
  lightPlacement,
  bounceLight,
  SLOT_ANCHOR_Y,
} = await import(mod("index.mjs"));
const { StageGL } = await import(mod("gl.mjs"));
const { analyse, columnAt, NEUTRAL_SAMPLE } = await import(mod("scene-sample.mjs"));
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

// ═══ 4. Background sampling ═══
// Everything geometric in the feature is measured from the centroid this
// produces, so a centroid that lands on the wrong thing mis-lights every
// character in the scene — silently, and consistently enough to look deliberate.
section("background sampling");
{
  const W = 32;
  const H = 32;
  /** Paint a 32×32 RGBA thumbnail from a per-pixel grey function. */
  const thumb = (fn) => {
    const data = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        const v = Math.round(fn(x, y) * 255);
        data[i] = data[i + 1] = data[i + 2] = v;
        data[i + 3] = 255;
      }
    }
    return data;
  };

  // The case the old luma² weighting got wrong: a large, moderately bright sky
  // and a small brilliant lamp low on the left. By area the sky wins by ~20×; by
  // brightness the lamp is the only thing casting anything.
  const lampX = 3;
  const lampY = 25;
  const scene = analyse(
    thumb((x, y) => {
      if (y < 16) return 0.55; // sky
      if (Math.abs(x - lampX) <= 1 && Math.abs(y - lampY) <= 1) return 1.0; // lamp
      return 0.12; // dark interior
    })
  );
  ok(
    scene.centroid[0] < 0.25,
    "the key lands on a small bright lamp, not the wide bright sky (x)",
    scene.centroid[0].toFixed(3)
  );
  ok(
    scene.centroid[1] > 0.6,
    "…and below the horizon, where the lamp actually is (y)",
    scene.centroid[1].toFixed(3)
  );

  // A smooth vertical gradient — no discrete source. The key should still sit in
  // the bright half rather than defaulting to the middle of the frame.
  const gradient = analyse(thumb((_x, y) => 1 - y / (H - 1)));
  ok(gradient.centroid[1] < 0.3, "a top-lit gradient keys from the top", gradient.centroid[1].toFixed(3));

  // A black frame has nothing to measure; it must not divide by zero.
  const black = analyse(thumb(() => 0));
  ok(
    near(black.centroid[0], 0.5) && near(black.centroid[1], 0.35),
    "a black frame falls back to a light above and in front"
  );

  ok(scene.columns.length === W, "one colour column per thumbnail column");
  ok(
    scene.columns[lampX][0] > scene.columns[W - 1][0],
    "the column holding the lamp is brighter than one across the room"
  );
}

section("column interpolation");
{
  const sample = { columns: [[0, 0, 0], [1, 1, 1], [0.5, 0.5, 0.5]] };
  ok(near(columnAt(sample, 0)[0], 0), "t=0 is the first column exactly");
  ok(near(columnAt(sample, 1)[0], 0.5), "t=1 is the last column exactly");
  // The reason this exists: snapping meant two slots a few percent apart picked
  // up identical light and sliding one stepped the colour.
  ok(near(columnAt(sample, 0.25)[0], 0.5), "a midpoint blends its two neighbours");
  ok(
    columnAt(sample, 0.26)[0] !== columnAt(sample, 0.24)[0],
    "a small move in position moves the colour"
  );
  ok(near(columnAt({ columns: [[0.2, 0.3, 0.4]] }, 0.7)[1], 0.3), "a single-column sample is safe");
  ok(columnAt(null, 0.5).length === 3, "a missing sample still returns a colour");
}

section("bounce light");
{
  // Luminance matching is the whole contract: the bounce recolours the shadow
  // side without adding exposure. If it changed brightness it would read as a
  // second lamp, and the stage's overall exposure would drift with the
  // background's hue.
  const cases = [
    ["warm firelit room", [0.42, 0.3, 0.22], [0.95, 0.62, 0.35]],
    ["cold moonlit room", [0.24, 0.28, 0.38], [0.55, 0.68, 0.95]],
    ["neutral grey room", [0.5, 0.5, 0.5], [0.7, 0.7, 0.7]],
    ["near-black room", [0.03, 0.03, 0.04], [0.2, 0.2, 0.25]],
  ];
  const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  for (const [label, ambient, key] of cases) {
    const b = bounceLight(ambient, key);
    ok(
      Math.abs(lum(b) - lum(ambient)) < 0.02,
      `${label}: bounce is luminance-matched to the ambient`,
      `${lum(b).toFixed(3)} vs ${lum(ambient).toFixed(3)}`
    );
    ok(b.every((c) => c >= 0 && c <= 1), `${label}: bounce stays in gamut`);
  }

  // A warm key must bounce cooler than the room, and a cool key warmer —
  // otherwise there is no separation and the term is doing nothing.
  const warm = bounceLight([0.42, 0.3, 0.22], [0.95, 0.62, 0.35]);
  ok(warm[2] - warm[0] > 0.3 - 0.42, "a warm key bounces cool", `${warm[0].toFixed(2)}/${warm[2].toFixed(2)}`);
  const cool = bounceLight([0.24, 0.28, 0.38], [0.55, 0.68, 0.95]);
  ok(
    cool[2] - cool[0] < 0.38 - 0.24,
    "a cool key bounces less cool than the room itself",
    `${cool[0].toFixed(2)}/${cool[2].toFixed(2)}`
  );
}

// ═══ 5. Shader uniforms ═══
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

  // The night tint claims to recolour without dimming, which is only true if it
  // is luma-normalised. Nothing on screen would say it had drifted — dark scenes
  // would simply get quietly darker than the exposure term intended.
  const night = /const vec3 NIGHT = vec3\(([^)]*)\)/.exec(src)?.[1].split(",").map(Number);
  ok(night?.length === 3, "the NIGHT tint is parseable");
  if (night?.length === 3) {
    const w = 0.2126 * night[0] + 0.7152 * night[1] + 0.0722 * night[2];
    ok(Math.abs(w - 1) < 0.01, "the NIGHT tint is luma-normalised", w.toFixed(4));
    ok(night[2] > night[0], "and drifts blue, not warm");
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

// ═══ 6. Asset CORS strategy ═══
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

// ═══ 7. Slot ownership ═══
// One WebGL canvas shades every character in turn, so each slot's pixels exist
// alone for exactly as long as the synchronous block that drew them. Yield in
// the middle of that and a slot copies out whatever the *next* character drew —
// which is how adding an actor to the stage once repainted the actor beside them
// with the new arrival's face. Nothing on screen suggests a timing bug; it looks
// like the wrong art was assigned.
section("slot ownership (one shared render target, N slots)");
{
  ok(
    StageGL.prototype.draw?.constructor?.name === "Function",
    "StageGL.draw is synchronous",
    "an await between the draw and the copy-out hands the canvas to another slot"
  );
  ok(
    StageGL.prototype.prepare?.constructor?.name === "AsyncFunction",
    "…and everything that can suspend lives in StageGL.prepare"
  );

  /** Stands in for the real context: async upload, synchronous draw. */
  class FakeGL {
    constructor() {
      this.canvas = { width: 8, height: 8, content: null };
      this.draws = 0;
    }
    isSupported() { return true; }
    async prepare(src) {
      await null; // the art-texture upload
      return { src };
    }
    draw(prepared) {
      this.draws++;
      this.canvas.content = prepared.src;
      // Poison on the very next microtask. The canvas belongs to this slot only
      // until the caller yields, so any await before the blit reads "POISON".
      queueMicrotask(() => { this.canvas.content = "POISON"; });
      return this.canvas;
    }
    invalidate() {}
    destroy() {}
  }

  const ALICE = `${ORIGIN}/art/alice.webp`;
  const BOB = `${ORIGIN}/art/bob.webp`;
  HOSTS = { [ALICE]: { cors: true, plain: true }, [BOB]: { cors: true, plain: true } };

  // Warm the prepass for both, so the render path is all microtasks — which is
  // exactly what it is on a live stage from the second render onward, and the
  // condition under which the slots interleave most tightly.
  await getNormalMap(ALICE);
  await getNormalMap(BOB);

  const fx = new StagePostFX();
  fx._gl = new FakeGL();
  fx._sample = { ...NEUTRAL_SAMPLE, ok: true };

  const wrapA = fakeElement("div");
  const wrapB = fakeElement("div");
  fx.register(wrapA, { src: ALICE, position: 0.25 });
  fx.register(wrapB, { src: BOB, position: 0.75 });

  // `register` schedules the render itself — the same coalesced pass a live
  // stage runs when a second actor is dropped onto it.
  await new Promise((r) => setTimeout(r, 20));

  const paintedA = fx._slots.get(wrapA)?.canvas?.painted;
  const paintedB = fx._slots.get(wrapB)?.canvas?.painted;
  ok(fx._gl.draws === 2, "one coalesced pass shades both slots", `${fx._gl.draws} draws`);
  ok(paintedA === ALICE, "the first slot keeps its own character", String(paintedA));
  ok(paintedB === BOB, "the second slot keeps its own character", String(paintedB));

  // Re-registering the same wrap with different art must not leave the old
  // character's canvas on screen — it is what the viewer sees, and the <img>
  // underneath is hidden while it is there.
  fx.register(wrapA, { src: BOB, position: 0.25 });
  ok(
    fx._slots.get(wrapA)?.canvas === null,
    "changing a slot's art drops the previous character's canvas"
  );
  ok(
    !wrapA.classList.contains("glstage-pp-on"),
    "…and unhides the plain <img> until the new render lands"
  );

  fx.destroy();
}

console.log(
  failed ? `\n${failed} of ${checks} FAILED` : `\n${checks} checks passed`
);
process.exit(failed ? 1 : 0);
