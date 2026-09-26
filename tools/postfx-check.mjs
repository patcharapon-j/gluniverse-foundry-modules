#!/usr/bin/env node
/**
 * Checks the pure logic behind the Stage character grade.
 *
 * Almost none of this feature is reviewable by eye. A dial that also nudges a
 * second property looks like art that was slightly off to begin with; a
 * neutral dial that is only *nearly* neutral shifts every character on every
 * stage by a step nobody can point at; a typo'd uniform name silently becomes a
 * no-op rather than an error. The maths lives in pure exported helpers so this
 * file can pin it down without a browser or a Foundry instance.
 *
 * The two rules it enforces, from grade-model.mjs:
 *   1. every dial at its neutral value is an exact no-op — bit for bit;
 *   2. every dial changes one property of the picture and nothing else.
 *
 * What it cannot check is whether the GLSL compiles or agrees with the
 * JavaScript reference; `tools/stage-lighting-preview.mjs` does that in a real
 * browser. And neither tool can tell you how a grade looks on real art.
 *
 *   node tools/postfx-check.mjs
 */

import { readFile } from "node:fs/promises";

const ROOT = new URL("../", import.meta.url);
const mod = (p) => new URL(`scripts/features/stage/postfx/${p}`, ROOT).href;
const read = (p) => readFile(new URL(p, ROOT), "utf8");

let failed = 0;
let checks = 0;

function ok(cond, label, extra = "") {
  checks++;
  console.log(`${cond ? "  ok  " : "FAIL  "}${label}${extra ? "  → " + extra : ""}`);
  if (!cond) failed++;
}

function section(title) {
  console.log(`\n── ${title} ──`);
}

// ═══ A browser-ish environment ═══
// asset.mjs reads window.location and constructs Image; the slot-ownership
// section drives the real StagePostFX, which needs enough of a document to hang
// canvases off. Nothing touches any of this at import time.
const ORIGIN = "https://vtt.example.com";
globalThis.window = { location: { href: `${ORIGIN}/game`, origin: ORIGIN } };
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
globalThis.getComputedStyle = () => ({ getPropertyValue: () => "" });

function fakeElement(tag) {
  const props = new Map();
  const el = {
    tagName: String(tag).toUpperCase(),
    isConnected: true,
    children: [],
    width: 0,
    height: 0,
    painted: null,
    style: {
      setProperty(k, v) { props.set(k, v); },
      removeProperty(k) { props.delete(k); },
      getPropertyValue(k) { return props.get(k) ?? ""; },
    },
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
    });
  }
  return el;
}
globalThis.document = {
  createElement: fakeElement,
  body: fakeElement("div"),
  addEventListener() {},
};

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

const M = await import(mod("grade-model.mjs"));
const { StagePostFX, cssFilterFor } = await import(mod("index.mjs"));
const { StageGL, FRAG, UNIFORMS } = await import(mod("gl.mjs"));
const { changeTouchesGrade } = await import(mod("grade-store.mjs"));
const { loadPixelImage, assetReason, corsRetryUrl, isSameOrigin, invalidateAsset } = await import(
  mod("asset.mjs")
);

// ── Measurement helpers ──
// Every property a dial is allowed to own, measured in the space it is defined
// in: luminance and chromaticity in linear light for the tone dials; OKLab
// lightness, chroma and hue for the colour dials.
const lin = (srgb) => srgb.map(M.toLinear);
const Y = (srgb) => {
  const l = lin(srgb);
  return M.LUMA[0] * l[0] + M.LUMA[1] * l[1] + M.LUMA[2] * l[2];
};
/** OKLab lightness, chroma and hue angle. */
function lch(srgb) {
  const [L, a, b] = M.linearToOklab(lin(srgb));
  return { L, mag: Math.hypot(a, b), angle: Math.atan2(b, a) };
}
const chroma = lch;
/** Chromaticity: the linear channels over their sum, which a pure change of
 *  level leaves alone. */
const ratios = (srgb) => {
  const l = lin(srgb);
  const t = Math.max(l[0] + l[1] + l[2], 1e-12);
  return l.map((x) => x / t);
};
const sameRatios = (a, b, eps) => ratios(a).every((x, i) => Math.abs(x - ratios(b)[i]) <= eps);
const angleDiff = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
const grade = (px, dials, trim) => M.gradePixel(px, M.basicParams({ ...M.DEFAULT_GRADE.basic, ...dials }, trim));

/** Muted, mid-range colours: far enough from every gamut wall that a moderate
 *  dial never reaches one, so the gamut fit cannot blur what is being measured. */
const MUTED = [
  [0.55, 0.45, 0.4],
  [0.35, 0.42, 0.5],
  [0.6, 0.58, 0.45],
  [0.4, 0.5, 0.42],
  [0.62, 0.5, 0.56],
];

// ═══ 1. The data model ═══
section("grade model: normalization");
{
  const g = M.normalizeGrade(null);
  ok(M.BASIC_KEYS.every((k) => g.basic[k] === M.BASIC_DIALS[k].neutral), "nothing stored reads as all-neutral");

  const junk = M.normalizeGrade({ basic: { exposure: "x", gamma: NaN, hue: 9999, saturation: -500, extra: 5 } });
  ok(
    M.BASIC_KEYS.every((k) => Number.isFinite(junk.basic[k])),
    "garbage never becomes NaN (a NaN uniform blacks out the whole fragment)",
    JSON.stringify(junk.basic)
  );
  ok(junk.basic.hue === 180 && junk.basic.saturation === -100, "out-of-range values clamp to the dial's range");
  ok(!("extra" in junk.basic), "unknown keys are dropped");

  const partial = M.normalizeGrade({ basic: { exposure: 1 } }, { basic: { ...M.DEFAULT_GRADE.basic, contrast: 30 } });
  ok(partial.basic.exposure === 1 && partial.basic.contrast === 30, "a partial grade fills its gaps from the fallback, not from neutral");

  ok(
    JSON.stringify(Object.keys(M.normalizeGrade({}).basic)) === JSON.stringify(M.BASIC_KEYS),
    "normalized grades always carry every key",
    "grade-store writes by merge and relies on this to replace every value"
  );

  const t = M.normalizeTrim({ exposure: 10, hue: "nope", brightness: 50 });
  ok(t.exposure === 3 && t.hue === 0 && !("brightness" in t), "a trim is clamped and holds only trim keys");
  ok(M.isNeutralTrim({}) && !M.isNeutralTrim({ gamma: 1.2 }), "isNeutralTrim tells an empty trim from a real one");
}

// ═══ 2. Rule 1: neutral is an exact no-op ═══
section("identity: every dial neutral returns the art bit for bit");
{
  const P = M.NEUTRAL_PARAMS;
  ok(
    P.gain === 1 && P.lift === 0 && P.gamma === 1 && P.contrast === 1 && P.sat === 1 && P.hueCos === 1 && P.hueSin === 0,
    "neutral dials resolve to exact identity parameters",
    JSON.stringify(P)
  );

  let bad = 0;
  const edges = [[0, 0, 0], [1, 1, 1], [1, 0, 0], [0, 1, 0], [0, 0, 1], [0.5, 0.5, 0.5], [1e-6, 0, 0]];
  const samples = [...edges];
  for (let i = 0; i < 20000; i++) samples.push([Math.random(), Math.random(), Math.random()]);
  for (const px of samples) {
    const out = M.gradePixel(px, P);
    if (out.some((x, j) => x !== px[j])) bad++;
  }
  ok(bad === 0, `gradePixel at neutral is exact on ${samples.length} colours`, `${bad} differed`);

  let badI = 0;
  for (const px of samples.slice(0, 2000)) {
    const graded = grade(px, { exposure: 1.5, hue: 60, contrast: 40 });
    const out = M.applyIntensity(px, graded, 0);
    if (out.some((x, j) => x !== px[j])) badI++;
  }
  ok(badI === 0, "master intensity 0 returns the art exactly, whatever the dials say");

  const trimmed = M.basicParams(M.DEFAULT_GRADE.basic, M.DEFAULT_TRIM);
  ok(JSON.stringify(trimmed) === JSON.stringify(P), "a neutral actor trim changes nothing");
}

// ═══ 3. Rule 2: one dial, one property ═══
section("separability: each dial owns one property");
{
  const within = (a, b, eps) => Math.abs(a - b) <= eps;
  const all = (fn) => MUTED.every(fn);

  // exposure: level moves; relative chroma and hue do not; black stays black.
  ok(all((px) => Y(grade(px, { exposure: 0.5 })) > Y(px) * 1.2), "exposure raises luminance");
  ok(all((px) => sameRatios(grade(px, { exposure: 0.5 }), px, 1e-6)), "…without changing chromaticity");
  ok(all((px) => angleDiff(chroma(grade(px, { exposure: 0.5 })).angle, chroma(px).angle) < 1e-6), "…or hue");
  ok(grade([0, 0, 0], { exposure: 2 }).every((x) => x === 0), "…and black stays black (exposure is a gain)");

  // brightness: black moves, white is pinned, chromaticity kept.
  ok(grade([0, 0, 0], { brightness: 40 })[0] > 0.05, "brightness lifts black");
  ok(grade([1, 1, 1], { brightness: 40 }).every((x) => Math.abs(x - 1) < 1e-9), "…while white stays white");
  ok(all((px) => sameRatios(grade(px, { brightness: 30 }), px, 1e-6)), "…and chromaticity is kept");

  // gamma: both ends pinned, midtones move.
  ok(grade([0, 0, 0], { gamma: 1.8 }).every((x) => x === 0), "gamma leaves black alone");
  ok(grade([1, 1, 1], { gamma: 1.8 }).every((x) => Math.abs(x - 1) < 1e-9), "…and white");
  ok(grade([0.4, 0.4, 0.4], { gamma: 1.8 })[0] > 0.45, "…and moves the midtones");
  ok(all((px) => sameRatios(grade(px, { gamma: 1.4 }), px, 1e-6)), "…without changing chromaticity");

  // contrast: black, white and encoded mid-grey pinned. Mid-grey is 0.5 in
  // *encoded luminance*, which for a neutral colour is the channel value itself.
  const grey = (v) => [v, v, v];
  ok(Math.abs(grade(grey(0.5), { contrast: 60 })[0] - 0.5) < 1e-9, "contrast pins mid-grey");
  ok(grade(grey(0), { contrast: 60 })[0] === 0 && Math.abs(grade(grey(1), { contrast: 60 })[0] - 1) < 1e-9, "…and both ends");
  ok(grade(grey(0.3), { contrast: 60 })[0] < 0.3 && grade(grey(0.7), { contrast: 60 })[0] > 0.7, "…and pushes the rest apart");
  ok(all((px) => sameRatios(grade(px, { contrast: 40 }), px, 1e-6)), "…without changing chromaticity");

  // saturation: chroma moves; lightness and hue do not.
  ok(all((px) => within(lch(grade(px, { saturation: 40 })).L, lch(px).L, 1e-6)), "saturation keeps lightness");
  ok(all((px) => angleDiff(chroma(grade(px, { saturation: 40 })).angle, chroma(px).angle) < 1e-6), "…and hue");
  ok(all((px) => chroma(grade(px, { saturation: 40 })).mag > chroma(px).mag * 1.3), "…and scales chroma");
  ok(all((px) => chroma(grade(px, { saturation: -100 })).mag < 1e-6), "…down to grey at -100");

  // hue: angle moves; lightness and chroma do not.
  ok(all((px) => within(lch(grade(px, { hue: 45 })).L, lch(px).L, 1e-6)), "hue keeps lightness");
  ok(all((px) => within(chroma(grade(px, { hue: 45 })).mag, chroma(px).mag, 1e-6)), "…and chroma");
  ok(all((px) => within(angleDiff(chroma(grade(px, { hue: 45 })).angle, chroma(px).angle), Math.PI / 4, 1e-6)), "…and turns the hue by exactly the dial");

  // The gamut fit gives up chroma, never lightness or hue.
  const vivid = [0.95, 0.2, 0.15];
  const pushed = grade(vivid, { saturation: 100 });
  ok(pushed.every((x) => x >= 0 && x <= 1), "a saturated push stays in gamut");
  ok(Math.abs(lch(pushed).L - lch(vivid).L) < 2e-3, "…by giving up chroma, not lightness", `${lch(pushed).L} vs ${lch(vivid).L}`);
  ok(angleDiff(chroma(pushed).angle, chroma(vivid).angle) < 2e-3, "…or hue");

  // …and gives it up softly. A hard stop at the gamut wall is continuous but
  // has a corner, which on a smooth gradient is a visible seam; the soft knee
  // exists to remove it. Measured as the largest step between neighbouring
  // outputs along a two-stop ramp, against the ramp's own largest step.
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const stops = [hex("#b85a4a"), hex("#5a9a8a"), hex("#7a5ab8")];
  const ramp = (t) => {
    const u = t < 0.5 ? t * 2 : (t - 0.5) * 2;
    const [a, b] = t < 0.5 ? [stops[0], stops[1]] : [stops[1], stops[2]];
    return a.map((x, i) => x + (b[i] - x) * u);
  };
  const worstStep = (dials) => {
    let prev = null;
    let worst = 0;
    for (let i = 0; i <= 300; i++) {
      const o = grade(ramp(i / 300), dials).map((x) => x * 255);
      if (prev) worst = Math.max(worst, ...o.map((x, j) => Math.abs(x - prev[j])));
      prev = o;
    }
    return worst;
  };
  const base = worstStep({});
  const hard = worstStep({ saturation: 100 });
  ok(hard < base * 6, "a +100 saturation push leaves no seam in a smooth gradient", `worst step ${hard.toFixed(2)} vs ${base.toFixed(2)} in the input`);
}

// ═══ 4. Actor trim ═══
section("actor trim composes with the scene");
{
  const px = [0.5, 0.4, 0.35];
  const viaTrim = M.gradePixel(px, M.basicParams(M.DEFAULT_GRADE.basic, { exposure: 1 }));
  const viaScene = grade(px, { exposure: 1 });
  ok(viaTrim.every((x, i) => Math.abs(x - viaScene[i]) < 1e-12), "a +1 stop trim equals a +1 stop scene exposure");
  const both = M.basicParams({ ...M.DEFAULT_GRADE.basic, exposure: 1, hue: 20 }, { exposure: -1, hue: -20 });
  ok(Math.abs(both.gain - 1) < 1e-12 && Math.abs(both.hueSin) < 1e-12, "opposite trim and scene values cancel");
  const sat = M.basicParams({ ...M.DEFAULT_GRADE.basic, saturation: 50 }, { saturation: -50 });
  ok(Math.abs(sat.sat - 0.75) < 1e-12, "saturation multiplies rather than adds", String(sat.sat));
}

// ═══ 5. The shader agrees with the model ═══
section("shader wiring");
{
  const declared = [...FRAG.matchAll(/^\s*uniform\s+\w+\s+u_(\w+)\s*;/gm)].map((m) => m[1]);
  const missing = declared.filter((n) => !UNIFORMS.includes(n));
  const extra = UNIFORMS.filter((n) => !declared.includes(n));
  ok(!missing.length, "every uniform the GLSL declares is looked up", missing.join(", "));
  ok(!extra.length, "every looked-up uniform exists in the GLSL", extra.join(", "));

  const src = await read("scripts/features/stage/postfx/gl.mjs");
  const drawBody = src.slice(src.indexOf("  draw(prepared, params)"), src.indexOf("  _dropTextures()"));
  const unwritten = UNIFORMS.filter((n) => n !== "art" && !new RegExp(`u\\.${n}\\b`).test(drawBody));
  ok(!unwritten.length, "every uniform is written on every draw", unwritten.join(", "));

  // The constants are emitted from the model rather than copied, so what is
  // checked is that the emission says what the model says — including that the
  // row-major tables arrive column-major, which GLSL's mat3() expects.
  const nums = (name, kind) => {
    const m = FRAG.match(new RegExp(`const ${kind} ${name} = ${kind}\\(([^)]*)\\)`));
    return m ? m[1].split(",").map(Number) : null;
  };
  const colMajor = (rows) => [0, 1, 2].flatMap((c) => rows.map((r) => r[c]));
  const same = (a, b) => !!a && a.length === b.length && a.every((x, i) => x === b[i]);
  ok(same(nums("LUMA", "vec3"), M.LUMA), "GLSL LUMA is the model's");
  for (const [glName, key] of [["OK_TO_LMS", "toLms"], ["OK_TO_LAB", "toLab"], ["OK_FROM_LAB", "fromLab"], ["OK_FROM_LMS", "fromLms"]]) {
    ok(same(nums(glName, "mat3"), colMajor(M.OKLAB[key])), `GLSL ${glName} is OKLAB.${key}, column-major`);
  }
  ok(FRAG.includes(`i < ${M.GAMUT_STEPS}; i++`), "the GLSL gamut search runs GAMUT_STEPS bisections");
  ok(FRAG.includes("if (u_sat != 1.0 || u_hue.x != 1.0 || u_hue.y != 0.0) c = chromaAdjust(c);"),
    "the GLSL skips the OKLab round trip at neutral", "it is not exact, and rule 1 is");

  // The neutral-skip guards are what make rule 1 hold on a GPU, where pow(x, 1.0)
  // is exp2(log2(x)) and not x. Losing one reads as a refactor.
  for (const guard of ["u_lift != 0.0", "u_gamma != 1.0", "u_contrast != 1.0", "yt != ye"]) {
    ok(FRAG.includes(guard), `the shader keeps its neutral guard: ${guard}`);
  }
  ok(/art\.rgb \+ \(toSRGB\(lin\) - toSRGB\(linIn\)\)/.test(FRAG), "the shader forms its output as a difference from the input");
  for (const [name, value] of [["TONE_RATIO_CAP", M.TONE_RATIO_CAP], ["GAMUT_REACH", M.GAMUT_REACH], ["GAMUT_KNEE", M.GAMUT_KNEE]]) {
    const m = FRAG.match(new RegExp(`const float ${name} = ([\\d.]+);`));
    ok(!!m && Number(m[1]) === value, `GLSL ${name} is the model's`, m?.[1]);
  }
}

// ═══ 5b. No dial combination produces NaN ═══
// A NaN reaching gl_FragColor is a black hole in the art, not an error.
section("extremes stay finite and in range");
{
  const corners = [];
  for (const key of M.BASIC_KEYS) {
    corners.push({ [key]: M.BASIC_DIALS[key].min }, { [key]: M.BASIC_DIALS[key].max });
  }
  const maxed = Object.fromEntries(M.BASIC_KEYS.map((k) => [k, M.BASIC_DIALS[k].max]));
  const minned = Object.fromEntries(M.BASIC_KEYS.map((k) => [k, M.BASIC_DIALS[k].min]));
  corners.push(maxed, minned);
  let bad = 0;
  let example = "";
  const pixels = [[0, 0, 0], [1, 1, 1], [1, 0, 0], [0, 0, 1], [0.001, 0.0005, 0.002]];
  for (let i = 0; i < 300; i++) pixels.push([Math.random(), Math.random(), Math.random()]);
  for (const dials of corners) {
    for (const px of pixels) {
      const out = grade(px, dials);
      if (!out.every((x) => Number.isFinite(x) && x >= 0 && x <= 1)) {
        bad++;
        example ||= `${JSON.stringify(dials)} on ${px} → ${out}`;
      }
    }
  }
  ok(bad === 0, "every dial at either end, alone and together, stays finite and in [0, 1]", example);
}

// ═══ 6. CSS fallback ═══
section("CSS fallback");
{
  ok(cssFilterFor(M.DEFAULT_GRADE.basic, M.DEFAULT_TRIM, 1) === "", "neutral dials produce no filter at all");
  const f = cssFilterFor({ ...M.DEFAULT_GRADE.basic, saturation: 40, hue: 30 }, M.DEFAULT_TRIM, 1);
  ok(/saturate\(1\.4/.test(f) && /hue-rotate\(30/.test(f), "saturation and hue map onto their CSS filters", f);
  const half = cssFilterFor({ ...M.DEFAULT_GRADE.basic, hue: 30 }, M.DEFAULT_TRIM, 0.5);
  ok(/hue-rotate\(15/.test(half), "intensity scales each filter toward neutral", half);
  ok(cssFilterFor({ ...M.DEFAULT_GRADE.basic, hue: 30, exposure: 1, contrast: 20 }, M.DEFAULT_TRIM, 0) === "",
     "…to nothing at all at intensity 0");
}

// ═══ 7. Scene flag detection ═══
section("grade flag change detection");
{
  const ID = "gluniverse-foundry-modules";
  ok(changeTouchesGrade({ flags: { [ID]: { "stage.grade": {} } } }), "a dotted-key diff is recognised");
  ok(changeTouchesGrade({ flags: { [ID]: { stage: { grade: {} } } } }), "…and a nested one");
  ok(changeTouchesGrade({ flags: { [ID]: { "-=stage.grade": null } } }), "…and an unset");
  ok(!changeTouchesGrade({ flags: { [ID]: { "hex.map": {} } } }), "another feature's flag is ignored");
  ok(!changeTouchesGrade({ darkness: 0.5 }), "a change with no flags is ignored");
}

// ═══ 8. Asset CORS strategy ═══
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

// ═══ 9. Slot ownership ═══
// One WebGL canvas grades every character in turn, so each slot's pixels exist
// alone for exactly as long as the synchronous block that drew them. Yield in
// the middle of that and a slot copies out whatever the *next* character drew —
// which reads as the wrong art being assigned, not as a timing bug.
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
      this.lastParams = null;
    }
    isSupported() { return true; }
    async prepare(src) {
      await null; // the art-texture upload
      return { src };
    }
    draw(prepared, params) {
      this.draws++;
      this.lastParams = params;
      this.canvas.content = prepared.src;
      // Poison on the very next microtask: any await before the blit reads it.
      queueMicrotask(() => { this.canvas.content = "POISON"; });
      return this.canvas;
    }
    invalidate() {}
    destroy() {}
  }

  const ALICE = `${ORIGIN}/art/alice.webp`;
  const BOB = `${ORIGIN}/art/bob.webp`;

  const fx = new StagePostFX();
  fx._gl = new FakeGL();

  const wrapA = fakeElement("div");
  const wrapB = fakeElement("div");
  fx.register(wrapA, { src: ALICE, position: 0.25 });
  fx.register(wrapB, { src: BOB, position: 0.75 });
  await new Promise((r) => setTimeout(r, 20));

  const paintedA = fx._slots.get(wrapA)?.canvas?.painted;
  const paintedB = fx._slots.get(wrapB)?.canvas?.painted;
  ok(fx._gl.draws === 2, "one coalesced pass grades both slots", `${fx._gl.draws} draws`);
  ok(paintedA === ALICE, "the first slot keeps its own character", String(paintedA));
  ok(paintedB === BOB, "the second slot keeps its own character", String(paintedB));

  fx.register(wrapA, { src: BOB, position: 0.25 });
  ok(fx._slots.get(wrapA)?.canvas === null, "changing a slot's art drops the previous character's canvas");
  ok(!wrapA.classList.contains("glstage-pp-on"), "…and unhides the plain <img> until the new render lands");

  // The grade reaches the draw, trim included.
  fx.setGrade({ basic: { exposure: 1 } }, { immediate: true });
  fx.register(wrapB, { src: BOB, position: 0.75, trim: { exposure: 1 } });
  await new Promise((r) => setTimeout(r, 20));
  ok(Math.abs((fx._gl.lastParams?.gain ?? 0) - 4) < 1e-9, "scene exposure and actor trim both reach the shader", String(fx._gl.lastParams?.gain));

  fx.setConfig({ intensity: NaN, enabled: "yes", quality: 7 });
  ok(Number.isFinite(fx._intensity) && fx._quality === "auto", "nonsense config never becomes NaN");

  fx.destroy();
}

// ═══ 10. Localization ═══
// Every GLSTAGE key the stage code names has to exist; a missing one renders as
// its own key path in the GM's panel.
section("localization");
{
  const lang = JSON.parse(await read("lang/stage.en.json"));
  const has = (path) => path.split(".").reduce((o, k) => (o && typeof o === "object" ? o[k] : undefined), lang) !== undefined;
  const files = ["GMPanel.js", "settings.js", "StageOverlay.js", "module.js"];
  const missing = [];
  for (const f of files) {
    const text = await read(`scripts/features/stage/${f}`);
    for (const m of text.matchAll(/i18n\('([\w.]+)'\)/g)) if (!has(`GLSTAGE.${m[1]}`)) missing.push(`${f}: ${m[1]}`);
    for (const m of text.matchAll(/'(GLSTAGE\.[\w.]+)'/g)) if (!has(m[1])) missing.push(`${f}: ${m[1]}`);
  }
  ok(!missing.length, "every literal GLSTAGE key the stage names resolves", missing.join("; "));
}

console.log(failed ? `\n${failed} of ${checks} FAILED` : `\n${checks} checks passed`);
process.exit(failed ? 1 : 0);
