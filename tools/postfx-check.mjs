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
  SHADER_STRENGTHS,
  CEL_SHADER_STRENGTHS,
  RIM_SHADER_STRENGTHS,
  shaderStrengths,
} = await import(mod("index.mjs"));
const { StageGL } = await import(mod("gl.mjs"));
const { analyse, columnAt, NEUTRAL_SAMPLE } = await import(mod("scene-sample.mjs"));
const { tallyPixels, matchGrade, luma, NEUTRAL_STATS } = await import(mod("tally.mjs"));
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

  // The art texture is uploaded premultiplied — the only space bilinear
  // filtering is correct in, and the difference between a clean silhouette and
  // one the sampler has drawn a black rind around. The cost is that every colour
  // read has to divide the coverage back out. A bare texture2D(u_art, …).rgb is
  // not an error anywhere: it compiles, it renders, and it quietly shades a
  // half-covered pixel as though the artist had painted it darker.
  const rawColour = [...src.matchAll(/texture2D\(u_art,[^)]*\)\s*\.(?:rgb|xyz|r\b|g\b|b\b)/g)];
  ok(
    rawColour.length === 0,
    "every art colour read goes through artAt()",
    rawColour[0]?.[0] ?? "no bare texture2D(u_art, …).rgb"
  );
  ok(
    /UNPACK_PREMULTIPLY_ALPHA_WEBGL,\s*true/.test(src),
    "…because the art texture is uploaded premultiplied"
  );

  // Three copies of the strengths — production, the contact sheet, the
  // assertions — is three chances for the preview to vouch for a build nobody
  // runs. One frozen export is the only thing keeping them honest.
  ok(
    SHADER_STRENGTHS && Object.isFrozen(SHADER_STRENGTHS),
    "the shader strengths are a single frozen export"
  );
  ok(
    ["rim", "rimEdge", "glow", "contour", "spec", "sheen", "cel", "rimOnly"].every(
      (k) => Number.isFinite(SHADER_STRENGTHS?.[k])
    ),
    "…covering every term the shader takes a strength for"
  );

  // ── The three styles ──
  // Each style is one table, spread into `draw` in one go. The thing that must
  // not happen is a partial set: a strength arriving from one style and the
  // banding it was balanced against from the other, which is exactly what a
  // per-key override or a missing key would produce — silently, and only on the
  // style nobody was looking at.
  ok(
    CEL_SHADER_STRENGTHS && Object.isFrozen(CEL_SHADER_STRENGTHS),
    "the cel strengths are their own frozen export"
  );
  ok(
    RIM_SHADER_STRENGTHS && Object.isFrozen(RIM_SHADER_STRENGTHS),
    "the rim-only strengths are their own frozen export"
  );
  const realKeys = Object.keys(SHADER_STRENGTHS).sort().join(",");
  const celKeys = Object.keys(CEL_SHADER_STRENGTHS).sort().join(",");
  const rimKeys = Object.keys(RIM_SHADER_STRENGTHS).sort().join(",");
  ok(realKeys === celKeys && realKeys === rimKeys, "every style sets exactly the same uniforms", celKeys);
  ok(
    [...Object.values(CEL_SHADER_STRENGTHS), ...Object.values(RIM_SHADER_STRENGTHS)].every((v) =>
      Number.isFinite(v)
    ),
    "…and every strength in both is a number"
  );
  ok(
    SHADER_STRENGTHS.cel === 0 && SHADER_STRENGTHS.rimOnly === 0,
    "the semi-realistic style is every style switch at 0 — the old model exactly"
  );
  ok(
    CEL_SHADER_STRENGTHS.cel === 1 && CEL_SHADER_STRENGTHS.rimOnly === 0,
    "…the cel style is cel = 1 and nothing else"
  );
  ok(
    RIM_SHADER_STRENGTHS.rimOnly === 1 && RIM_SHADER_STRENGTHS.cel === 0,
    "…and rim-only is rimOnly = 1 and nothing else"
  );
  ok(shaderStrengths("cel") === CEL_SHADER_STRENGTHS, "shaderStrengths('cel') selects the cel set");
  ok(
    shaderStrengths("rim") === RIM_SHADER_STRENGTHS,
    "shaderStrengths('rim') selects the rim-only set"
  );
  ok(
    shaderStrengths("realistic") === SHADER_STRENGTHS &&
      shaderStrengths(undefined) === SHADER_STRENGTHS &&
      shaderStrengths("nonsense") === SHADER_STRENGTHS,
    "…and anything else falls back to semi-realistic"
  );

  // Rim-only's promise is that the key does not touch the interior of the art.
  // Three of the model's terms draw *inside* the silhouette by construction —
  // no strength makes an interior highlight not be one — so they are off, not
  // merely low. A rebalance that gives one of them a value is not a tuning
  // change; it breaks the one thing the mode is named for.
  const interior = ["contour", "spec", "sheen"].filter((k) => RIM_SHADER_STRENGTHS[k] !== 0);
  ok(
    interior.length === 0,
    "rim-only draws nothing inside the silhouette",
    interior.length ? `${interior.join(", ")} still driven` : "contour, spec and sheen are all 0"
  );
  // …and with the interior gone there is no lit body for a modest rim to sit
  // on, so the edge terms have to carry the whole effect.
  const edgeTerms = ["rim", "rimEdge", "glow"];
  ok(
    edgeTerms.every((k) => RIM_SHADER_STRENGTHS[k] > SHADER_STRENGTHS[k]),
    "…so every edge term is driven above the semi-realistic one",
    edgeTerms.map((k) => `${k} ${RIM_SHADER_STRENGTHS[k]} vs ${SHADER_STRENGTHS[k]}`).join(", ")
  );
  // A flat band covers far more of its shape than the falloff it replaces peaks
  // over, so carrying the realistic gains into cel blows the rim into a white
  // bar. This is the one relationship between the two tables worth pinning: if
  // a future rebalance raises the cel rim above the realistic one, that is a
  // decision, not a typo, and it should have to be made deliberately.
  ok(
    CEL_SHADER_STRENGTHS.rim < SHADER_STRENGTHS.rim,
    "the cel rim is driven below the realistic one — the band is flat, not a peak",
    `${CEL_SHADER_STRENGTHS.rim} vs ${SHADER_STRENGTHS.rim}`
  );

  // Every banded term is a crossfade against its continuous twin, which is what
  // makes cel = 0 the previous shader term for term. A bare celStep() reaching
  // the output without passing through mix(…, u_cel) would change the realistic
  // look too, and nothing in a cel-mode screenshot would show it.
  // Statement by statement through main(), which is the only place a banded term
  // can reach the output — the two helpers above it compose freely.
  // The vertex shader has a main() too, and it comes first in the file.
  const mainStart = src.indexOf("void main() {", src.indexOf("const FRAG ="));
  const mainBody = src.slice(mainStart, src.indexOf("\n`;", mainStart));
  const celStatements = mainBody
    .split(";")
    .map((s) => s.trim())
    .filter((s) => /celS(?:tep|hade)\(/.test(s));
  ok(celStatements.length > 0, "the cel bands reach main()", `${celStatements.length} banded terms`);
  const unmixed = celStatements.filter((s) => !/u_cel/.test(s));
  ok(
    unmixed.length === 0,
    "…and every one of them is mixed by u_cel, never applied outright",
    unmixed[0]?.split("\n")[0] ?? "all banded terms crossfade"
  );

  // Rim-only is the same discipline read the other way round. Its terms are
  // *flattenings* rather than a distinct arithmetic, so there is no celStep() to
  // grep for — what identifies one is the uniform itself. Every statement that
  // touches it has to be a crossfade, or semi-realistic stops being the model.
  const statements = mainBody.split(";").map((s) => s.trim());
  const rimStatements = statements.filter((s) => /u_rimOnly/.test(s));
  ok(rimStatements.length > 0, "the rim-only flattenings reach main()", `${rimStatements.length} terms`);
  const rimUnmixed = rimStatements.filter((s) => !/\bmix\(/.test(s));
  ok(
    rimUnmixed.length === 0,
    "…and every one of them is a mix(), never applied outright",
    rimUnmixed[0]?.split("\n")[0] ?? "all rim-only terms crossfade"
  );
  // The two constants the mode introduces are only ever the far end of one of
  // those crossfades. A stray KEY_FLAT would flatten the key for every style.
  const strayConst = statements.filter(
    (s) => /\b(?:KEY_FLAT|RIM_ONLY_FALLOFF)\b/.test(s) && !/u_rimOnly/.test(s)
  );
  ok(
    strayConst.length === 0,
    "…and the rim-only constants are reachable only through it",
    strayConst[0]?.split("\n")[0] ?? "KEY_FLAT and RIM_ONLY_FALLOFF are gated"
  );

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


// ═══ 8. The reference match ═══
//
// Everything here fails silently. A grade that is subtly wrong looks exactly
// like art that was subtly wrong to begin with, and the GM's only signal is a
// vague sense that the feature "isn't very good" — so none of it can be left to
// a screenshot.
section("measurement and the reference match");
{
  /** Build an RGBA buffer from a per-pixel function. */
  const buf = (n, fn) => {
    const d = new Uint8ClampedArray(n * 4);
    for (let i = 0; i < n; i++) {
      const [r, g, b, a] = fn(i);
      d[i * 4] = r * 255;
      d[i * 4 + 1] = g * 255;
      d[i * 4 + 2] = b * 255;
      d[i * 4 + 3] = a === undefined ? 255 : a * 255;
    }
    return d;
  };

  // ── tallyPixels ──
  const flat = tallyPixels(buf(400, () => [0.5, 0.5, 0.5, 1]));
  ok(flat.ok, "a flat field measures");
  ok(near(flat.luma, 0.5, 0.02), "…at the level it was painted", flat.luma.toFixed(3));
  ok(flat.sat < 0.02, "…with no chroma in it", flat.sat.toFixed(3));
  ok(
    near(luma(flat.black), luma(flat.white), 0.03),
    "…and no tonal range, because a flat field has none"
  );

  const ramp = tallyPixels(buf(400, (i) => { const v = i / 399; return [v, v, v, 1]; }));
  ok(
    luma(ramp.black) < luma(ramp.mid) && luma(ramp.mid) < luma(ramp.white),
    "a ramp measures black < mid < white",
    [luma(ramp.black), luma(ramp.mid), luma(ramp.white)].map((v) => v.toFixed(2)).join(" < ")
  );

  // The percentiles are the whole reason this is a histogram and not a min/max.
  // One specular ping, one anti-aliased corner of a signature, and a min/max
  // white point is 1.0 for the entire figure — after which the contrast match is
  // reading a single pixel and swinging the whole cast with it.
  const speck = tallyPixels(buf(1000, (i) => (i < 4 ? [1, 1, 1, 1] : [0.2, 0.2, 0.2, 1])));
  ok(
    luma(speck.white) < 0.4,
    "four blown pixels in a thousand do not become the white point",
    luma(speck.white).toFixed(3)
  );

  // The antialiased fringe of a cut-out carries whatever the art was lifted off,
  // which is very often black. Measuring it would put the subject's black point
  // on the *background* it came from and then correct the character for it.
  const fringed = tallyPixels(buf(400, (i) => (i < 200 ? [0.6, 0.5, 0.4, 1] : [0, 0, 0, 0])));
  ok(
    near(luma(fringed.mean), luma([0.6, 0.5, 0.4]), 0.03),
    "transparent pixels are not measured, whatever colour they carry"
  );
  ok(!tallyPixels(buf(16, () => [1, 1, 1, 0])).ok, "a fully transparent buffer measures nothing");

  // ── The match is inert until asked ──
  const subject = tallyPixels(
    buf(400, (i) => { const v = i / 399; return [v * 0.9, v * 0.7, v * 0.5, 1]; })
  );
  const scene = tallyPixels(
    buf(400, (i) => { const v = 0.15 + (i / 399) * 0.5; return [v * 0.5, v * 0.7, v, 1]; })
  );

  const id = (m) =>
    near(m.gain, 1, 1e-9) && near(m.bright, 1, 1e-9) && near(m.sat, 1, 1e-9) &&
    m.cast.every((c) => near(c, 1, 1e-9));

  ok(
    id(matchGrade(subject, scene, { cast: 0, sat: 0, bright: 0, tone: 0 })),
    "every dial at zero is the exact identity",
    "…so a world that never opts in gets the picture it had"
  );
  ok(
    id(matchGrade(NEUTRAL_STATS, scene, { cast: 1, sat: 1, bright: 1, tone: 1 })),
    "unmeasurable art makes the match inert, not wrong"
  );
  ok(
    id(matchGrade(subject, NEUTRAL_STATS, { cast: 1, sat: 1, bright: 1, tone: 1 })),
    "…and so does an unmeasurable room",
    "a degraded scene falls back to the ambient tint it always had"
  );

  // ── Separability ──
  // The four dials are the design. A GM who dislikes the result has to be able
  // to find *which part* they dislike, and that is only true if moving one dial
  // moves one property. Fold two together — which a single per-channel affine
  // does for free, and which is the obvious simplification here — and both dials
  // become two ways of asking the same question, so neither one answers it.
  const only = (key) => matchGrade(subject, scene, { cast: 0, sat: 0, bright: 0, tone: 0, [key]: 1 });

  const mb = only("bright");
  ok(
    !near(mb.bright, 1, 1e-6) && near(mb.gain, 1, 1e-9) && near(mb.sat, 1, 1e-9) &&
      mb.cast.every((c) => near(c, 1, 1e-9)),
    "brightness moves the level and nothing else",
    mb.bright.toFixed(3)
  );

  const mt = only("tone");
  ok(
    !near(mt.gain, 1, 1e-6) && near(mt.bright, 1, 1e-9) && near(mt.sat, 1, 1e-9) &&
      mt.cast.every((c) => near(c, 1, 1e-9)),
    "tonal range moves the contrast and nothing else",
    mt.gain.toFixed(3)
  );

  const mc = only("cast");
  ok(
    !mc.cast.every((v) => near(v, 1, 1e-6)) && near(mc.gain, 1, 1e-9) &&
      near(mc.bright, 1, 1e-9) && near(mc.sat, 1, 1e-9),
    "light colour moves the hue and nothing else",
    mc.cast.map((v) => v.toFixed(3)).join(", ")
  );
  // The load-bearing half of that claim. The cast is a per-channel multiplier,
  // and a per-channel multiplier re-exposes the picture unless its own luma is
  // exactly 1 — at which point brightness and cast would both move the level,
  // and a GM chasing an over-bright figure would have two sliders that each
  // half-work and no way to tell which one is at fault.
  ok(
    near(luma(mc.cast), 1, 1e-4),
    "…because the cast is luma-normalised, so it re-tints without re-exposing",
    luma(mc.cast).toFixed(6)
  );

  const ms = only("sat");
  ok(
    !near(ms.sat, 1, 1e-6) && near(ms.gain, 1, 1e-9) && near(ms.bright, 1, 1e-9) &&
      ms.cast.every((v) => near(v, 1, 1e-9)),
    "saturation moves the chroma and nothing else",
    ms.sat.toFixed(3)
  );

  // Contrast pivots about the subject's own mean, which is what keeps it from
  // moving the level as a side effect. A pivot of 0 would make gain a brightness
  // dial wearing a contrast dial's name.
  ok(
    near(mt.pivot, subject.luma, 1e-6),
    "contrast pivots on the subject's own mean, so it cannot also move it",
    mt.pivot.toFixed(4)
  );

  // ── The clamps ──
  // The measurement can legitimately ask for an enormous correction, and obeying
  // it does not put the character in the room — it destroys the character.
  const black = tallyPixels(buf(400, () => [0.02, 0.02, 0.02, 1]));
  const snow = tallyPixels(buf(400, () => [0.97, 0.97, 0.97, 1]));
  const extreme = matchGrade(black, snow, { cast: 1, sat: 1, bright: 1, tone: 1 });
  ok(
    extreme.bright <= 1.7 + 1e-6 && extreme.bright > 1,
    "a near-black figure against snow is clamped, not obeyed",
    extreme.bright.toFixed(3)
  );
  ok(
    extreme.cast.every((v) => v > 0.5 && v < 2),
    "…and so is every channel of the cast",
    extreme.cast.map((v) => v.toFixed(3)).join(", ")
  );
  ok(
    Number.isFinite(extreme.gain) && Number.isFinite(extreme.sat),
    "…with nothing coming back NaN from a zero-span subject"
  );
}

// ═══ 9. The new shader terms, by shape ═══
//
// Three properties stated in the shader's own comments as the reason each term
// works, and that a diff would show as one word added or removed.
section("grade and light-kit shader shape");
{
  const src = await (await import("node:fs/promises")).readFile(
    new URL("scripts/features/stage/postfx/gl.mjs", ROOT),
    "utf8"
  );

  // Skin resists the *chromatic* half of the match and takes the achromatic half
  // in full. That asymmetry is the entire feature: a face in a blue room has to
  // get darker without going blue. Let `keep` reach the level or contrast lines
  // and skin stops being dimmed by the scene at all — every face in the cast
  // then floats at its original exposure, lit from nowhere, in a dark room.
  const gradeBody = src.slice(src.indexOf("vec3 gradeMatch("), src.indexOf("nearAlpha"));
  const achromatic = gradeBody.split(";").filter((l) => /u_mGain|u_mBright|u_mPivot/.test(l));
  ok(achromatic.length >= 2, "the achromatic half of the grade reaches gradeMatch()");
  ok(
    achromatic.every((l) => !/\bkeep\b/.test(l)),
    "…and the skin guard cannot reach it — skin dims with the room",
    achromatic.find((l) => /\bkeep\b/.test(l))?.trim() ?? "level and contrast are ungated"
  );
  const chromatic = gradeBody.split(";").filter((l) => /u_mCast|u_mSat/.test(l));
  ok(
    chromatic.length >= 2 && chromatic.every((l) => /\bkeep\b/.test(l)),
    "…while both chromatic terms are gated by it"
  );

  // The wrap is the room, not a lamp. Every other edge term here rides `facing`
  // so it sweeps only the part of the outline turned toward the key; the wrap
  // arrives from the whole background at once. Gate it and the room becomes a
  // second key light — which is the exact reading it exists to break, and which
  // would still look perfectly plausible on screen.
  const wrapLine = (src.split(";").find((l) => /lit \+= toLinear\(u_wrapColor\)/.test(l)) ?? "")
    .replace(/\/\/[^\n]*/g, "")
    .replace(/\s+/g, " ")
    .trim();
  ok(!!wrapLine, "the light wrap reaches main()");
  ok(
    !!wrapLine && !/\bfacing\b/.test(wrapLine),
    "…and takes no facing term — it is the whole room, not one lamp",
    wrapLine
  );

  // The backlight reads the *unrescaled* field. That single difference is what
  // separates it from the rim: `edge` is normalised against the inside half of
  // its ramp so it can resolve a line, and transmission must not be, or it turns
  // into a third rim on an edge that already has two.
  ok(
    /lit \+= toLinear\(u_backColor\)/.test(src),
    "the backlight reaches main()"
  );
  // Comments stripped before the test: these statements are preceded by prose
  // explaining what they must *not* do, and matching on that prose would mean
  // the check passes or fails on how the comment happens to be worded.
  const code = (statement) =>
    (statement ?? "").replace(/\/\/[^\n]*/g, "").replace(/\s+/g, " ").trim();
  const backShape = code(src.split(";").find((l) => /float backShape/.test(l)));
  ok(!!backShape, "…and is shaped by its own statement");
  ok(
    /1\.0 - thick/.test(backShape) && !/\bedge\b/.test(backShape),
    "…off the unrescaled field, so it stays a wash and not a third rim",
    backShape
  );
}

// ═══ 10. Every uniform is actually written ═══
//
// Section 5 proves each uniform has a *location*. That is only half of it: a
// location that is never written holds whatever the driver initialised it to,
// for the life of the context. There is no error, no warning, and no way to see
// it except as a term that does nothing — or, worse, one that does something
// constant on every character on the stage.
section("uniform writes");
{
  const src = await (await import("node:fs/promises")).readFile(
    new URL("scripts/features/stage/postfx/gl.mjs", ROOT),
    "utf8"
  );
  const block = src.slice(
    src.indexOf("this.uniforms = {"),
    src.indexOf("gl.uniform1i(this.uniforms.art")
  );
  const keys = [...block.matchAll(/^\s{6}(\w+):/gm)].map((m) => m[1]);
  ok(keys.length > 25, "the uniform table parses", `${keys.length} uniforms`);

  // `_dropTextures()` is *called* long before it is declared, so the end anchor
  // has to be searched for from the start of draw() rather than from the top of
  // the file — otherwise the slice runs backwards and comes back empty, and an
  // empty body makes every uniform look unwritten at once.
  const drawStart = src.indexOf("  draw(prepared, params) {");
  ok(drawStart > 0, "draw() is locatable");
  const drawBody = src.slice(drawStart, src.indexOf("  _dropTextures() {", drawStart));
  const written = new Set([...drawBody.matchAll(/gl\.uniform\w+\(u\.(\w+)/g)].map((m) => m[1]));
  // The two samplers are bound once at setup rather than per draw, which is
  // correct — their texture units never change.
  const bound = new Set(["art", "nrm"]);
  const missing = keys.filter((key) => !written.has(key) && !bound.has(key));
  ok(
    missing.length === 0,
    "every uniform is written on every draw",
    missing.length ? `never written: ${missing.join(", ")}` : "no stale uniforms"
  );

  // …and every one of those writes has to find a value on the params object, for
  // the same reason in reverse: gl.uniform1f(loc, undefined) sets NaN, and a NaN
  // multiplied into a colour turns the fragment black rather than erroring.
  // Two legitimate sources: the caller's params, and `prepared`, which carries
  // the values that belong to the uploaded art rather than to the grade.
  const unsourced = [...drawBody.matchAll(/gl\.uniform\w+\(u\.(\w+),([^;]*)\)/g)]
    .filter(([, , args]) => !/\b(?:params|prepared)\./.test(args))
    .map(([, key]) => key);
  ok(
    unsourced.length === 0,
    "…each from params or prepared, never off the end of the object",
    unsourced.join(", ") || "every write reads a real field"
  );

  // And every params.* the draw reads has to be something a caller actually
  // sends. The style tables are spread in wholesale, so a term added to the
  // shader and to draw() but forgotten in all three tables arrives as undefined
  // — which is NaN in the uniform, and a black fragment rather than an error.
  const styleKeys = new Set(Object.keys(shaderStrengths("realistic")));
  const fromParams = new Set([...drawBody.matchAll(/params\.(\w+)/g)].map((m) => m[1]));
  const strengthLike = [...fromParams].filter((key) => styleKeys.has(key));
  ok(
    strengthLike.length >= 8,
    "the style tables supply the strengths draw() reads",
    `${strengthLike.length} of ${fromParams.size} params come from the style table`
  );
}

// ═══ 11. The settings → setConfig contract ═══
//
// `StageOverlay` reads thirteen settings and hands them over as a nested object.
// Every one of those keys is matched by name, so a typo on either side is a dial
// that silently does nothing — the GM moves it, the render re-runs, and the
// picture does not change. There is no error to see and no obvious place to look.
section("settings → setConfig");
{
  const fx = new StagePostFX();

  // The exact shape StageOverlay.updatePostFXConfig sends.
  fx.setConfig({
    match: { cast: 0.1, sat: 0.2, bright: 0.3, tone: 0.4 },
    skin: 0.5,
    kit: {
      wrap: 1.5, backlight: 0.5, halation: 0.25,
      glowRadius: 1.75, glowSense: 0.4,
      backColor: "#112233", fillColor: "", halationColor: "#ff6b38",
    },
  });

  ok(
    fx._match.cast === 0.1 && fx._match.sat === 0.2 &&
      fx._match.bright === 0.3 && fx._match.tone === 0.4,
    "all four match dials arrive",
    JSON.stringify(fx._match)
  );
  ok(fx._skin === 0.5, "the skin guard arrives", String(fx._skin));
  ok(
    fx._kit.wrap === 1.5 && fx._kit.backlight === 0.5 && fx._kit.halation === 0.25 &&
      fx._kit.glowRadius === 1.75 && fx._kit.glowSense === 0.4,
    "every light-kit dial arrives",
    JSON.stringify(fx._kit, (k, v) => (Array.isArray(v) ? v.join("/") : v))
  );
  ok(
    Array.isArray(fx._kit.backColor) && Math.abs(fx._kit.backColor[0] - 0x11 / 255) < 1e-6,
    "a hex colour override parses",
    String(fx._kit.backColor)
  );
  ok(
    fx._kit.fillColor === null,
    "…and a blank one stays null, meaning 'derive it from the room'"
  );

  // A partial update must move only what it names. The settings sheet fires one
  // onChange per setting, and the live intensity preview sends `intensity`
  // alone — if either reset a sibling to a default, dragging the strength slider
  // would quietly throw away the GM's whole grade.
  fx.setConfig({ intensity: 0.4 });
  ok(
    fx._match.cast === 0.1 && fx._skin === 0.5 && fx._kit.wrap === 1.5,
    "a partial update leaves every dial it does not name alone",
    "…so the live intensity preview cannot reset the grade"
  );
  fx.setConfig({ match: { cast: 0.9 } });
  ok(
    fx._match.cast === 0.9 && fx._match.sat === 0.2 && fx._match.tone === 0.4,
    "…and a partial match update moves one dial, not four"
  );

  // Garbage must not become NaN: every one of these values is multiplied into a
  // colour, and a NaN uniform turns the whole fragment black rather than erroring.
  fx.setConfig({
    match: { cast: NaN, sat: "x", bright: undefined, tone: -5 },
    skin: "nope",
    kit: { wrap: -3, glowRadius: 0, glowSense: 99, halation: NaN, backColor: "not a colour" },
  });
  const finite = [
    ...Object.values(fx._match), fx._skin,
    fx._kit.wrap, fx._kit.backlight, fx._kit.halation, fx._kit.glowRadius, fx._kit.glowSense,
  ];
  ok(finite.every(Number.isFinite), "nonsense input never becomes NaN", JSON.stringify(finite));
  ok(
    fx._kit.glowRadius >= 0.25,
    "…and the glow radius is floored above zero, since the shader divides by it",
    String(fx._kit.glowRadius)
  );
  ok(fx._kit.backColor === null, "…and an unparseable colour falls back to derived");

  fx.destroy();
}

console.log(
  failed ? `\n${failed} of ${checks} FAILED` : `\n${checks} checks passed`
);
process.exit(failed ? 1 : 0);
