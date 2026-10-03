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
const { StagePostFX, cssFallbackFor, cssGradientAngle } = await import(mod("index.mjs"));
const { seedFromSample, lightAngleFrom, toKeyLight } = await import(mod("seed.mjs"));
const LUT = await import(mod("lut.mjs"));
const { LookLibrary, normalizeCustomLook, customLookId } = await import(mod("look-library.mjs"));
const { StageGL, FRAG, UNIFORMS, BLOOM_DOWN_FRAG, BLOOM_UP_FRAG, BLOOM_DOWN_UNIFORMS, BLOOM_UP_UNIFORMS } = await import(mod("gl.mjs"));
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
  ok(JSON.stringify(g) === JSON.stringify(M.DEFAULT_GRADE), "nothing stored reads as the world's default grade");
  const n = M.normalizeGrade(null, M.NEUTRAL_GRADE);
  ok(M.BASIC_KEYS.every((k) => n.basic[k] === M.BASIC_DIALS[k].neutral), "…and against the neutral grade, as all-neutral");
  for (const [section, dials] of Object.entries(M.SECTIONS)) {
    for (const [key, spec] of Object.entries(dials)) {
      ok(spec.default >= spec.min && spec.default <= spec.max, `${section}.${key}: default is inside its range`);
      if ("neutral" in spec) ok(spec.neutral >= spec.min && spec.neutral <= spec.max, `${section}.${key}: neutral is inside its range`);
    }
  }
  const colours = M.normalizeGrade({ gradient: { color: "red" }, wash: { color: "#ABCDEF" } });
  ok(colours.gradient.color === M.COLORS.gradient.color, "an unparseable colour falls back to the default");
  ok(colours.wash.color === "#abcdef", "a valid colour is kept, lower-cased");
  ok(M.normalizeGrade({ seeded: true }).seeded === true && M.normalizeGrade({}).seeded === false, "the seeded flag survives normalization");

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

  const keysOf = (o) => JSON.stringify(Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v && typeof v === "object" ? Object.keys(v) : typeof v])));
  ok(
    keysOf(M.normalizeGrade({ basic: { hue: 3 } })) === keysOf(M.DEFAULT_GRADE),
    "normalized grades always carry every key of every section",
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
    const out = M.shadePixel(px, [Math.random(), Math.random()], P);
    if (out.some((x, j) => x !== px[j])) bad++;
  }
  ok(bad === 0, `the whole stack at neutral is exact on ${samples.length} colours`, `${bad} differed`);

  // Scene darkness reaches the picture only through the wash's darkness dial.
  const darkRoom = M.stackParams(M.NEUTRAL_GRADE, M.DEFAULT_TRIM, { darkness: 1 });
  ok(darkRoom.darkGain === 1, "a pitch-dark scene changes nothing while the darkness dial is at 0");

  // Every layer's amount at 0, with every shaping setting and colour at its
  // most extreme, is still the identity: shaping settings cannot leak.
  const loud = M.normalizeGrade({
    light: { angle: 37, softness: 0 }, gradient: { color: "#ff0000" },
    rim: { width: 100, softness: 100, color: "#00ff00" },
    wash: { color: "#0000ff" }, skin: { guard: 100 },
  }, M.NEUTRAL_GRADE);
  const LP = M.stackParams(loud, M.DEFAULT_TRIM, { aspect: 0.4, darkness: 0.8 });
  let badL = 0;
  for (const px of samples.slice(0, 5000)) {
    const out = M.shadePixel(px, [Math.random(), Math.random()], LP);
    if (out.some((x, j) => x !== px[j])) badL++;
  }
  ok(badL === 0, "…and stays exact whatever the angle, softness, colours and skin guard say", `${badL} differed`);

  let badI = 0;
  for (const px of samples.slice(0, 2000)) {
    const graded = grade(px, { exposure: 1.5, hue: 60, contrast: 40 });
    const out = M.applyIntensity(px, graded, 0);
    if (out.some((x, j) => x !== px[j])) badI++;
  }
  ok(badI === 0, "master intensity 0 returns the art exactly, whatever the dials say");

  const trimmed = M.stackParams(M.NEUTRAL_GRADE, M.DEFAULT_TRIM);
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
  for (const [name, src, list] of [["main", FRAG, UNIFORMS], ["bloom down", BLOOM_DOWN_FRAG, BLOOM_DOWN_UNIFORMS], ["bloom up", BLOOM_UP_FRAG, BLOOM_UP_UNIFORMS]]) {
    const declared = [...src.matchAll(/^\s*uniform\s+\w+\s+u_(\w+)\s*;/gm)].map((m) => m[1]);
    const missing = declared.filter((n) => !list.includes(n));
    const extra = list.filter((n) => !declared.includes(n));
    ok(!missing.length, `${name}: every uniform the GLSL declares is looked up`, missing.join(", "));
    ok(!extra.length, `${name}: every looked-up uniform exists in the GLSL`, extra.join(", "));
  }
  const glSrc = await read("scripts/features/stage/postfx/gl.mjs");
  const bloomBody = glSrc.slice(glSrc.indexOf("  _renderBloom(gl, art, params) {"), glSrc.indexOf("  readBloom() {"));
  for (const n of ["srcTexel", "bright", "threshold", "coarseTexel", "weight"]) {
    ok(new RegExp(`\\.u\\.${n}\\b`).test(bloomBody), `the bloom pass writes u_${n}`);
  }
  ok(FRAG.includes("float y = (p.g + 0.5) / N;") && FRAG.includes("(b0 * N + p.r + 0.5) / (N * N)"), "the GLSL samples the strip at texel centres inside its tile, like sampleStrip");
  for (let i = 0; i < M.MAX_LOOKS; i++) {
    ok(FRAG.includes(`if (u_lookAmount.${"xyzw"[i]} > 0.0) lin = applyLook(lin, u_lut${i},`), `look slot ${i} is applied, and skipped at opacity 0`);
  }
  const knee = BLOOM_DOWN_FRAG.match(/const float GLOW_KNEE = ([\d.]+);/);
  ok(!!knee && Number(knee[1]) === M.GLOW_KNEE, "GLSL GLOW_KNEE is the model's", knee?.[1]);
  const taps = [...BLOOM_DOWN_FRAG.matchAll(/tap\(v_uv \+ vec2\(([-\d.]+), ([-\d.]+)\)/g)].map((m) => [Number(m[1]), Number(m[2])]);
  ok(JSON.stringify(taps) === JSON.stringify(M.DOWN_TAPS), "the GLSL downsample taps are DOWN_TAPS", JSON.stringify(taps));
  ok(/\(i == 0 \? 2\.0 : 1\.0\) \* \(j == 0 \? 2\.0 : 1\.0\) \/ 16\.0/.test(BLOOM_UP_FRAG), "the GLSL upsample is the model's 3×3 tent");

  const src = await read("scripts/features/stage/postfx/gl.mjs");
  const drawBody = src.slice(src.indexOf("  draw(prepared, params)"), src.indexOf("  _dropTextures()"));
  // Samplers are bound to their texture units once, when the context is made.
  const unwritten = UNIFORMS.filter((n) => n !== "art" && n !== "bloom" && !/^lut\d$/.test(n) && !new RegExp(`u\\.${n}\\b`).test(drawBody));
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
  ok(FRAG.includes(`i < ${M.RIM_TAPS}; i++`) && FRAG.includes(`/ ${M.RIM_TAPS + 1}.0`), "the GLSL rim samples RIM_TAPS + 1 taps, like the model");
  ok(same(nums("SKIN_CENTRE", "vec2"), M.SKIN_CENTRE) && same(nums("SKIN_RADIUS", "vec2"), M.SKIN_RADIUS), "GLSL skin ellipse is the model's");
  for (const guard of ["u_gradAmount > 0.0", "u_washAmount > 0.0", "u_darkGain != 1.0", "if (w > 0.0)", "u_rimAmount > 0.0", "u_backAmount > 0.0", "if (k != 1.0)", "bool glowing = u_glowAmount > 0.0;", "glowing ? vec4(G, ga) * u_intensity : vec4(0.0)"]) {
    ok(FRAG.includes(guard), `the shader skips a layer at neutral: ${guard}`);
  }
  ok(FRAG.includes("if (u_sat != 1.0 || u_hue.x != 1.0 || u_hue.y != 0.0) c = chromaAdjust(c);"),
    "the GLSL skips the OKLab round trip at neutral", "it is not exact, and rule 1 is");

  // The neutral-skip guards are what make rule 1 hold on a GPU, where pow(x, 1.0)
  // is exp2(log2(x)) and not x. Losing one reads as a refactor.
  for (const guard of ["u_lift != 0.0", "u_gamma != 1.0", "u_contrast != 1.0", "yt != ye"]) {
    ok(FRAG.includes(guard), `the shader keeps its neutral guard: ${guard}`);
  }
  ok(/art\.rgb \+ \(toSRGB\(lin\) - toSRGB\(linIn\)\)/.test(FRAG), "the shader forms its output as a difference from the input");
  for (const [name, value] of [["TONE_RATIO_CAP", M.TONE_RATIO_CAP], ["GAMUT_REACH", M.GAMUT_REACH], ["GAMUT_KNEE", M.GAMUT_KNEE], ["RIM_GAIN", M.RIM_GAIN], ["GLOW_GAIN", M.GLOW_GAIN]]) {
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

// ═══ 5c. Gradient, wash, darkness and skin ═══
section("gradient: the light's colour, ramping from the lit side");
{
  const at = (dials, uv, px = [0.5, 0.45, 0.42], ctx = { aspect: 0.6 }) =>
    M.shadePixel(px, uv, M.stackParams(M.normalizeGrade(dials, M.NEUTRAL_GRADE), M.DEFAULT_TRIM, ctx));
  const warm = { light: { angle: 0, softness: 40 }, gradient: { amount: 80, color: "#fff0d8" } };
  const right = at(warm, [0.95, 0.5]);
  const left = at(warm, [0.05, 0.5]);
  ok(Y(right) > Y([0.5, 0.45, 0.42]) * 1.05, "a light on the right brightens the right edge", `${Y(right).toFixed(4)}`);
  ok(left.every((x, i) => x === [0.5, 0.45, 0.42][i]), "…and leaves the far edge exactly as it was");
  const flip = { ...warm, light: { angle: 180 } };
  ok(Y(at(flip, [0.05, 0.5])) > Y(at(flip, [0.95, 0.5])), "turning the light round turns the ramp round");
  const up = { ...warm, light: { angle: 90 } };
  ok(Y(at(up, [0.5, 0.05])) > Y(at(up, [0.5, 0.95])), "a light above lights the top (+Y is down in art space)");

  // 45° on a tall portrait has to be 45° in pixels, not in uv.
  const diag = { ...warm, light: { angle: 45, softness: 0 } };
  const tall = { aspect: 0.5 };
  // A point on the terminator for a true 45° line through the centre, in
  // isotropic units: moving right by d and down by d stays on it.
  const onLine = at(diag, [0.5 + 0.1 / 0.5, 0.5 + 0.1], [0.5, 0.45, 0.42], tall);
  const lit = at(diag, [0.5 + 0.15 / 0.5, 0.5 - 0.05], [0.5, 0.45, 0.42], tall);
  ok(Y(lit) > Y(onLine), "the ramp is isotropic: 45° is 45° on a tall portrait");

  const amt = (a) => Y(at({ ...warm, gradient: { ...warm.gradient, amount: a } }, [0.9, 0.5]));
  ok(amt(20) < amt(50) && amt(50) < amt(90), "the amount dial scales the effect monotonically");
}

section("wash: the room's colour as a level-free cast");
{
  const grey = [0.5, 0.5, 0.5];
  const blue = { wash: { amount: 60, color: "#4060c0" } };
  const P = M.stackParams(M.normalizeGrade(blue, M.NEUTRAL_GRADE));
  const out = M.shadePixel(grey, [0.5, 0.5], P);
  ok(Math.abs(Y(out) - Y(grey)) < 2e-3, "on a neutral pixel the wash moves hue, not level", `${Y(out).toFixed(4)} vs ${Y(grey).toFixed(4)}`);
  ok(out[2] > out[0], "…toward the room's colour");
  const big = M.stackParams(M.normalizeGrade({ wash: { amount: 100, color: "#0000ff" } }, M.NEUTRAL_GRADE));
  ok(big.washCast.every((x) => x <= M.WASH_CAST_MAX + 1e-12), "a saturated room cannot ask for more than WASH_CAST_MAX on any channel", String(big.washCast));
  const castY = big.washCast[0] * M.LUMA[0] + big.washCast[1] * M.LUMA[1] + big.washCast[2] * M.LUMA[2];
  ok(Math.abs(castY - 1) < 1e-12, "…and limiting it keeps the cast at unit luminance", String(castY));
}

section("darkness: level only, and only through its dial");
{
  const g = M.normalizeGrade({ wash: { darkness: 60 } }, M.NEUTRAL_GRADE);
  const lit = M.stackParams(g, M.DEFAULT_TRIM, { darkness: 0 });
  const dark = M.stackParams(g, M.DEFAULT_TRIM, { darkness: 1 });
  ok(lit.darkGain === 1, "a scene at darkness 0 changes nothing, whatever the dial");
  ok(Math.abs(dark.darkGain - 0.4) < 1e-12, "full darkness at dial 60 is a 60% cut in linear light", String(dark.darkGain));
  ok(MUTED.every((px) => sameRatios(M.shadePixel(px, [0.5, 0.5], dark), px, 1e-6)), "…which moves level and not chromaticity");
}

section("skin: holds back colour, never level");
{
  // A skin tone and a grey of the same luminance, under a hard blue wash.
  const skin = [0.87, 0.68, 0.56];
  const yS = Y(skin);
  const g = M.toSRGB(yS);
  const grey = [g, g, g];
  const blue = (guard) => M.stackParams(M.normalizeGrade({ wash: { amount: 100, color: "#2040ff" }, skin: { guard } }, M.NEUTRAL_GRADE));
  ok(M.skinMask(skin) > 0.8, "the test swatch reads as skin", String(M.skinMask(skin)));
  ok(M.skinMask(grey) < 0.05, "…and the matched grey does not", String(M.skinMask(grey)));
  const guarded = M.shadePixel(skin, [0.5, 0.5], blue(100));
  const open = M.shadePixel(skin, [0.5, 0.5], blue(0));
  const bOf = (px) => M.linearToOklab(lin(px))[2];
  ok(bOf(guarded) > bOf(open) + 0.01, "guarded, skin turns far less blue than unguarded", `b ${bOf(guarded).toFixed(4)} vs ${bOf(open).toFixed(4)}`);
  ok(Math.abs(Y(guarded) - Y(open)) < 1e-9, "…while taking exactly the same level");
  const greyG = M.shadePixel(grey, [0.5, 0.5], blue(100));
  const greyO = M.shadePixel(grey, [0.5, 0.5], blue(0));
  ok(greyG.every((x, i) => Math.abs(x - greyO[i]) < 1e-9), "the guard does not spill onto the neutral beside it");

  // Darkness is level, and skin takes all of it.
  const dim = M.normalizeGrade({ wash: { darkness: 100 }, skin: { guard: 100 } }, M.NEUTRAL_GRADE);
  const d = M.shadePixel(skin, [0.5, 0.5], M.stackParams(dim, M.DEFAULT_TRIM, { darkness: 0.5 }));
  ok(Y(d) < yS * 0.6, "skin darkens in a dark room in full", `${Y(d).toFixed(4)} vs ${yS.toFixed(4)}`);
}

section("rim: the edge that faces the lamp");
{
  // A disc of coverage, with clamp-to-edge sampling like a texture's.
  const aspect = 0.5;
  const disc = (u, v) => {
    const cu = Math.min(Math.max(u, 0), 1);
    const cv = Math.min(Math.max(v, 0), 1);
    return Math.hypot((cu - 0.5) * aspect, cv - 0.5) < 0.2 ? 1 : 0;
  };
  const px = [0.3, 0.3, 0.3];
  const shade = (dials, uv) => M.shadePixel(px, uv, M.stackParams(M.normalizeGrade(dials, M.NEUTRAL_GRADE), M.DEFAULT_TRIM, { aspect }), disc, disc(...uv));
  const rim = (angle, extra = {}) => ({ light: { angle }, rim: { amount: 100, width: 60, softness: 30, ...extra } });
  // Disc edges, in uv: x = 0.5 ± 0.4, y = 0.5 ± 0.2.
  const rightEdge = [0.87, 0.5];
  const leftEdge = [0.13, 0.5];
  ok(Y(shade(rim(0), rightEdge)) > Y(px) * 2, "a light on the right rims the right edge", Y(shade(rim(0), rightEdge)).toFixed(4));
  ok(shade(rim(0), leftEdge).every((x, i) => x === px[i]), "…and leaves the left edge untouched");
  ok(Y(shade(rim(180), leftEdge)) > Y(px) * 2, "turning the light round moves the rim to the left edge");
  ok(Y(shade(rim(90), [0.5, 0.31])) > Y(px) * 2 && shade(rim(90), [0.5, 0.69]).every((x, i) => x === px[i]), "a light above rims the top, not the bottom");
  ok(shade(rim(0), [0.5, 0.5]).every((x, i) => x === px[i]), "the middle of the figure gets no rim");
  // The bottom of the disc runs parallel to a light from the right: an outline
  // there is the failure the directional mask exists to prevent.
  ok(Y(shade(rim(0), [0.5, 0.69])) < Y(px) * 1.02, "an edge parallel to the light gets no rim", Y(shade(rim(0), [0.5, 0.69])).toFixed(4));
  const reachAt = (width) => Y(shade(rim(0, { width }), [0.78, 0.5]));
  ok(reachAt(90) > reachAt(20), "a wider rim reaches further in", `${reachAt(90).toFixed(4)} vs ${reachAt(20).toFixed(4)}`);
  ok(M.stackParams(M.normalizeGrade(rim(0, { width: 0 }), M.NEUTRAL_GRADE)).rimAmount === 0, "a rim with no width is no rim");
  const warm = shade(rim(0, { color: "#ffb060" }), rightEdge);
  ok(warm[0] > warm[2], "the rim takes its colour", String(warm));
  // Isotropic: the same width reaches the same distance on the side of a tall
  // portrait as on its top, measured in isotropic units.
  const side = M.stackParams(M.normalizeGrade(rim(0), M.NEUTRAL_GRADE), M.DEFAULT_TRIM, { aspect });
  ok(Math.abs(side.rimOffset[0] * aspect - M.stackParams(M.normalizeGrade(rim(-90), M.NEUTRAL_GRADE), M.DEFAULT_TRIM, { aspect }).rimOffset[1]) < 1e-12,
    "the rim's reach is isotropic on a tall portrait");
}

section("glow: a bloom pyramid of the art's own highlights");
{
  // A grey disc on a 64×96 image, a bright patch in its middle and a bright
  // band at its right edge. Premultiplied, like the texture.
  const W = 64;
  const H = 96;
  const aspect = W / H;
  const art = { width: W, height: H, data: new Float32Array(W * H * 4) };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = (x + 0.5) / W;
      const v = (y + 0.5) / H;
      if (Math.hypot((u - 0.5) * aspect, v - 0.5) >= 0.3) continue;
      const c = Math.abs(u - 0.5) < 0.08 && Math.abs(v - 0.5) < 0.04 ? [1, 0.9, 0.6]
        : u > 0.82 ? [0.95, 0.95, 0.95] : [0.3, 0.3, 0.3];
      art.data.set([...c, 1], (y * W + x) * 4);
    }
  }
  const sample = (u, v) => M.sampleImage(art, u, v);
  const texelAt = (u, v) => {
    const x = Math.min(Math.max(Math.floor(u * W), 0), W - 1);
    const y = Math.min(Math.max(Math.floor(v * H), 0), H - 1);
    return Array.from(art.data.subarray((y * W + x) * 4, (y * W + x) * 4 + 4));
  };
  const P = (dials, ctx = {}) => M.stackParams(M.normalizeGrade(dials, M.NEUTRAL_GRADE), M.DEFAULT_TRIM, { aspect, ...ctx });
  const glowing = (p) => {
    const bloom = M.bloomPyramid(art, p);
    return (uv, k = 1) => M.shadeFragment(texelAt(...uv), uv, p, sample, k, (u, v) => M.sampleImage(bloom, u, v));
  };
  const glow = { glow: { amount: 100, radius: 50, threshold: 60 } };
  const frag = glowing(P(glow));

  const sizes = M.bloomSizes(1280, 720);
  ok(sizes.length === M.GLOW_LEVELS && sizes[0][0] === 640 && sizes[4][0] === 40, "the pyramid halves GLOW_LEVELS times from half size", JSON.stringify(sizes));
  ok(M.bloomSizes(3, 2).at(-1).join() === "1,1", "…and stops at a single texel on tiny art");
  const w1 = M.bloomWeights(5, 1);
  const w0 = M.bloomWeights(5, 0);
  ok(w0.every((x) => x === 0), "at spread 0 only the finest level counts");
  ok(Math.abs(w1[0] - 0.8) < 1e-12 && Math.abs(w1[3] - 0.5) < 1e-12, "at spread 1 every level counts equally", String(w1));

  const off = glowing(M.NEUTRAL_PARAMS);
  let bad = 0;
  for (let i = 0; i < 3000; i++) {
    const uv = [Math.random(), Math.random()];
    const t = texelAt(...uv);
    if (off(uv).some((x, j) => x !== t[j])) bad++;
  }
  ok(bad === 0, "with glow off, every fragment — inside and outside the art — is the texture exactly", `${bad} differed`);
  let bad0 = 0;
  for (let i = 0; i < 2000; i++) {
    const uv = [Math.random(), Math.random()];
    const t = texelAt(...uv);
    if (frag(uv, 0).some((x, j) => x !== t[j])) bad0++;
  }
  ok(bad0 === 0, "at intensity 0 the glow draws nothing anywhere", `${bad0} differed`);

  const near = frag([0.5, 0.56]);
  const far = frag([0.5, 0.66]);
  ok(near[0] > 0.33 && far[0] < near[0], "light blooms out of the bright patch and falls off with distance", `${near[0].toFixed(3)} → ${far[0].toFixed(3)}`);
  const outside = frag([0.97, 0.5]);
  ok(outside[3] > 0.02, "the bright edge spills past the outline, the one place the pass draws outside the art", outside.map((x) => x.toFixed(3)).join(","));
  ok(frag([0.03, 0.5])[3] < outside[3] / 4, "…and a dark edge spills far less");
  ok(glowing(P({ glow: { ...glow.glow, threshold: 100 } }))([0.5, 0.56])[0] < near[0], "raising the threshold narrows what glows");
  ok(glowing(P({ ...glow, wash: { darkness: 100 } }, { darkness: 0.8 }))([0.5, 0.56])[0] < near[0], "a dark room glows less");

  // Spread changes how far the glow reaches.
  const reach = (radius) => glowing(P({ glow: { ...glow.glow, radius } }))([0.5, 0.7])[0];
  ok(reach(100) > reach(0), "a wider radius reaches further", `${reach(100).toFixed(4)} vs ${reach(0).toFixed(4)}`);

  // No ghosts: along a line through the bright patch, the bloom rises and falls
  // with no secondary peaks — the failure a sparse ring of taps produced.
  const bloom = M.bloomPyramid(art, P({ glow: { ...glow.glow, radius: 100 } }));
  const line = Array.from({ length: 60 }, (_, i) => M.sampleImage(bloom, 0.5, 0.2 + (i / 59) * 0.6)[0]);
  const peak = line.indexOf(Math.max(...line));
  let bumps = 0;
  for (let i = 1; i < line.length; i++) {
    const rising = i <= peak;
    if (rising ? line[i] < line[i - 1] - 1e-4 : line[i] > line[i - 1] + 1e-4) bumps++;
  }
  ok(bumps === 0, "the bloom falls off monotonically from its peak — no ghost copies", `${bumps} reversals`);
}

section("looks: .cube parsing");
{
  const cube2 = "# comment\nTITLE \"Swap\"\nLUT_3D_SIZE 2\n0 0 0\n0 1 0\n1 0 0\n1 1 0\n0 0 1\n0 1 1\n1 0 1\n1 1 1\n";
  const swap = LUT.parseCube(cube2);
  ok(swap.title === "Swap" && swap.size === 2, "title and size are read", `${swap.title} ${swap.size}`);
  const s = LUT.sampleLut(swap, [0.25, 0.75, 0.5]);
  ok(Math.abs(s[0] - 0.75) < 1e-6 && Math.abs(s[1] - 0.25) < 1e-6, "red varies fastest (this LUT swaps red and green)", String(s));
  const errs = [
    ["LUT_3D_SIZE 3\n0 0 0\n", /expected 27/],
    ["0 0 0\n1 1 1\n", /not a \.cube/],
    ["LUT_3D_SIZE 2\n0 0 x\n", /bad data line/],
    ["LUT_3D_SIZE 2000\n", /out of range/],
    ["DOMAIN_MIN 1 1 1\nDOMAIN_MAX 0 0 0\nLUT_3D_SIZE 2\n" + "0 0 0\n".repeat(8), /DOMAIN_MIN/],
  ];
  for (const [text, re] of errs) {
    let msg = "";
    try { LUT.parseCube(text); } catch (e) { msg = e.message; }
    ok(re.test(msg), `a broken file is refused with a reason: ${re}`, msg);
  }
  // A 1D LUT is applied per channel.
  const inv = LUT.parseCube("LUT_1D_SIZE 2\n1 1 1\n0 0 0\n");
  const i1 = LUT.sampleLut(inv, [0.2, 0.5, 0.9]);
  ok(i1.every((x, k) => Math.abs(x - (1 - [0.2, 0.5, 0.9][k])) < 1e-6), "a 1D LUT is applied per channel", String(i1));
  // A domain other than 0..1 is remapped onto 0..1.
  const half = LUT.parseCube("DOMAIN_MAX 2 2 2\nLUT_3D_SIZE 2\n0 0 0\n2 0 0\n0 2 0\n2 2 0\n0 0 2\n2 0 2\n0 2 2\n2 2 2\n");
  const h = LUT.sampleLut(half, [0.5, 0.5, 0.5]);
  ok(h.every((x) => Math.abs(x - 0.5) < 1e-6), "a 0..2 domain is remapped onto 0..1", String(h));
  const big = LUT.resampleLut(LUT.bakeFunction((c) => c, 65));
  ok(big.size === LUT.LUT_SIZE, "a larger LUT is resampled down to LUT_SIZE");
}

section("looks: the strip the shader samples");
{
  const id = LUT.lutToStrip(LUT.bakeFunction((c) => c));
  ok(id.width === LUT.LUT_SIZE ** 2 && id.height === LUT.LUT_SIZE, "a strip is size² wide and size tall");
  let worst = 0;
  for (let i = 0; i < 3000; i++) {
    const c = [Math.random(), Math.random(), Math.random()];
    worst = Math.max(worst, ...LUT.sampleStrip(id, c).map((x, k) => Math.abs(x - c[k])));
  }
  ok(worst * 255 <= 0.51, "an identity LUT through the strip returns the colour to within half an 8-bit step", (worst * 255).toFixed(3));

  // Every built-in recipe survives baking: a 33-point grid cannot follow the
  // gamut's own corners exactly, but on average it is well under a step.
  for (const lookId of LUT.BUILTIN_LOOK_IDS) {
    const recipe = LUT.BUILTIN_LOOKS[lookId].recipe;
    const strip = LUT.lutToStrip(LUT.bakeRecipe(recipe));
    let sum = 0;
    const n = 400;
    for (let i = 0; i < n; i++) {
      const c = [Math.random(), Math.random(), Math.random()];
      const a = LUT.applyRecipe(recipe, c);
      const b = LUT.sampleStrip(strip, c);
      sum += Math.max(...a.map((x, k) => Math.abs(x - b[k])));
    }
    ok((sum / n) * 255 < 1.5, `${lookId}: the baked LUT follows its recipe`, `mean ${((sum / n) * 255).toFixed(2)}/255`);
  }
  const names = Object.values(LUT.BUILTIN_LOOKS).map((l) => l.name);
  for (const want of ["Cherry Blossoms", "Neon", "Night City", "Rainy Forest", "Under Water", "Winter", "Flame", "Gray", "Lipstick", "Pastel", "Vintage", "Silence", "OrangeFilm"]) {
    ok(names.includes(want), `the built-in looks include ${want}`);
  }
  ok(LUT.BUILTIN_LOOK_IDS.every((i) => M.LOOK_ID_RE.test(i)), "every built-in id is a valid stored look id");
  const gray = LUT.applyRecipe(LUT.BUILTIN_LOOKS["builtin:gray"].recipe, [0.8, 0.3, 0.2]);
  ok(Math.max(...gray) - Math.min(...gray) < 0.01, "Gray takes the colour out", String(gray));
}

section("looks: in the stack");
{
  const g = M.normalizeGrade({ looks: [{ id: "builtin:neon", opacity: 50 }, { id: "nope" }, { id: "custom:x", opacity: 900 }, { id: "builtin:gray" }, { id: "builtin:winter" }, { id: "builtin:flame" }] });
  ok(g.looks.length === M.MAX_LOOKS, "a stack keeps at most MAX_LOOKS looks", String(g.looks.length));
  ok(g.looks[0].opacity === 50 && g.looks[1].id === "custom:x" && g.looks[1].opacity === 100, "invalid ids are dropped, opacities clamped, order kept", JSON.stringify(g.looks));
  ok(M.normalizeGrade({}).looks.length === 0, "a fresh grade has no looks");

  const neonStrip = LUT.lutToStrip(LUT.bakeRecipe(LUT.BUILTIN_LOOKS["builtin:neon"].recipe));
  const look = { sample: (c) => LUT.sampleStrip(neonStrip, c) };
  const zero = M.stackParams(M.normalizeGrade({ looks: [{ id: "builtin:neon", opacity: 0 }] }, M.NEUTRAL_GRADE));
  let bad = 0;
  for (let i = 0; i < 2000; i++) {
    const c = [Math.random(), Math.random(), Math.random()];
    if (M.shadePixel(c, [0.5, 0.5], zero, null, 1, [look]).some((x, k) => x !== c[k])) bad++;
  }
  ok(bad === 0, "a look at opacity 0 changes nothing, bit for bit", `${bad} differed`);
  const full = M.stackParams(M.normalizeGrade({ looks: [{ id: "builtin:neon", opacity: 100 }], skin: { guard: 0 } }, M.NEUTRAL_GRADE));
  const c = [0.4, 0.5, 0.6];
  const viaStack = M.shadePixel(c, [0.5, 0.5], full, null, 1, [look]);
  const direct = LUT.sampleStrip(neonStrip, c);
  ok(viaStack.every((x, k) => Math.abs(x - direct[k]) < 1e-6), "at full opacity the stack gives exactly the LUT's colour", `${viaStack} vs ${direct}`);
  const half = M.shadePixel(c, [0.5, 0.5], M.stackParams(M.normalizeGrade({ looks: [{ id: "builtin:neon", opacity: 50 }], skin: { guard: 0 } }, M.NEUTRAL_GRADE)), null, 1, [look]);
  ok(half.every((x, k) => Math.abs(x - (c[k] + direct[k]) / 2) < 1e-6), "…and at 50% exactly halfway, in encoded colour");
  ok(M.shadePixel(c, [0.5, 0.5], full, null, 1, [null]).every((x, k) => x === c[k]), "a look that has not loaded is drawn at opacity 0");

  const a = M.normalizeGrade({ looks: [{ id: "builtin:neon", opacity: 20 }] });
  const b = M.normalizeGrade({ looks: [{ id: "builtin:neon", opacity: 80 }] });
  ok(Math.abs(M.lerpGrade(a, b, 0.5).looks[0].opacity - 50) < 1e-9, "the same stack eases its opacities");
  const other = M.normalizeGrade({ looks: [{ id: "builtin:winter", opacity: 80 }] });
  const mid = M.lerpGrade(a, other, 0.5).looks;
  ok(mid.length === 1 && mid[0].id === "builtin:winter" && Math.abs(mid[0].opacity - 40) < 1e-9, "a different stack fades in from nothing", JSON.stringify(mid));
}

section("looks: the library");
{
  ok(customLookId("Moody Blue!") === "custom:moody-blue", "a custom id is a slug of its name", customLookId("Moody Blue!"));
  ok(customLookId("Moody Blue", ["custom:moody-blue"]) === "custom:moody-blue-2", "…made unique against the ids already taken");
  ok(customLookId("日本") === "custom:look", "…and never empty");
  ok(normalizeCustomLook({ id: "custom:a", path: "" }) === null && normalizeCustomLook({ id: "builtin:a", path: "x" }) === null, "a custom entry needs a path and a custom id");

  const cube = LUT.lutToStrip ? "LUT_3D_SIZE 2\n0 0 0\n1 0 0\n0 1 0\n1 1 0\n0 0 1\n1 0 1\n0 1 1\n1 1 1\n" : "";
  let fetches = 0;
  const warnings = [];
  let customs = [{ id: "custom:ident", name: "Ident", path: "worlds/w/gluniverse/luts/ident.cube", rev: 1 }, { id: "custom:broken", name: "Broken", path: "x.cube", rev: 1 }];
  const lib = new LookLibrary({
    customLooks: () => customs,
    fetchText: async (path) => { fetches++; if (path === "x.cube") return "not a lut"; return cube; },
    warn: (m) => warnings.push(m),
  });
  ok(lib.list().length === LUT.BUILTIN_LOOK_IDS.length + 2 && lib.list()[0].builtin, "the list is built-ins first, then custom looks");
  const [one, two] = await Promise.all([lib.get("custom:ident"), lib.get("custom:ident")]);
  ok(one && one === two && fetches === 1, "concurrent requests share one fetch");
  ok(lib.peek("custom:ident") === one, "a loaded look can be read synchronously");
  ok((await lib.get("custom:broken")) === null && warnings.length === 1, "a file that does not parse resolves to null, with one warning");
  await lib.get("custom:broken");
  ok(warnings.length === 1 && fetches === 2, "…and is not retried on every render");
  customs = [{ ...customs[0], rev: 2 }];
  ok(lib.peek("custom:ident") === null, "replacing a custom look's file (a new revision) is a cache miss");
  ok((await lib.get("custom:nope")) === null, "an unknown id resolves to null");
  const builtin = await lib.get("builtin:gray");
  ok(builtin?.strip?.size === LUT.LUT_SIZE, "a built-in look bakes on first use");
}

section("back shadow: the far side, level only");
{
  const g = M.normalizeGrade({ light: { angle: 0, softness: 30 }, backShadow: { amount: 100 } }, M.NEUTRAL_GRADE);
  const P = M.stackParams(g, M.DEFAULT_TRIM, { aspect: 0.6 });
  const far = M.shadePixel(MUTED[0], [0.03, 0.5], P);
  const near = M.shadePixel(MUTED[0], [0.97, 0.5], P);
  ok(Y(far) < Y(MUTED[0]) * 0.5, "the side away from the light darkens", Y(far).toFixed(4));
  ok(near.every((x, i) => x === MUTED[0][i]), "…and the lit side is untouched");
  ok(sameRatios(far, MUTED[0], 1e-6), "…in level only, never chromaticity");
  ok(Y(far) > 0.2 * Y(MUTED[0]), "…and never to black (BACK_SHADOW_MAX)");
}

section("seeding: proposals from the background, never amounts");
{
  ok(lightAngleFrom([0.5, 0.1]) === 90, "a light straight above is 90°");
  ok(lightAngleFrom([0.95, 0.68]) === 0 && lightAngleFrom([0.05, 0.68]) === 180, "…right is 0° and left is 180°");
  ok(Math.abs(lightAngleFrom([0.85, 0.3], 16 / 9) - (Math.atan2(0.38, 0.35 * 16 / 9) * 180) / Math.PI) < 1, "angles are measured with the background's aspect");
  const k = toKeyLight([0.2, 0.1, 0.05]);
  ok(Math.max(...k) === 1 && k[0] >= k[1] && k[1] >= k[2], "a dim warm background yields a bright warm light", String(k));

  const base = M.normalizeGrade({ gradient: { amount: 12 }, wash: { amount: 77, darkness: 5 }, light: { angle: -40 } });
  const sample = { ok: true, degraded: false, ambient: [0.2, 0.3, 0.6], columns: [[0.9, 0.6, 0.3]], centroid: [0.2, 0.2], aspect: 16 / 9 };
  const seeded = seedFromSample(sample, base);
  ok(seeded.gradient.amount === 12 && seeded.wash.amount === 77 && seeded.wash.darkness === 5, "seeding keeps every amount of the grade it starts from");
  ok(seeded.light.angle !== -40 && seeded.seeded === true, "…and proposes the light direction and marks the grade seeded");
  ok(seeded.wash.color !== base.wash.color && seeded.gradient.color !== base.gradient.color, "…and proposes both colours");
  const flat = seedFromSample({ ...sample, degraded: true }, base);
  ok(flat.light.angle === -40, "a flat-colour background proposes no light direction");
  ok(seedFromSample(null, base).gradient.color === base.gradient.color, "no sample at all proposes nothing");
}

section("tween");
{
  const a = M.normalizeGrade({ light: { angle: 170 } });
  const b = M.normalizeGrade({ light: { angle: -170 } });
  const mid = M.lerpGrade(a, b, 0.5);
  ok(Math.abs(Math.abs(mid.light.angle) - 180) < 1e-9, "the light turns the short way round", String(mid.light.angle));
  const c = M.lerpGrade(M.normalizeGrade({ wash: { color: "#000000" } }), M.normalizeGrade({ wash: { color: "#ffffff" } }), 1);
  ok(c.wash.color === "#ffffff", "a finished colour tween lands exactly on the target");
}

// ═══ 6. CSS fallback ═══
section("CSS fallback");
{
  const neutral = cssFallbackFor(M.NEUTRAL_GRADE, M.DEFAULT_TRIM, 1, 1);
  ok(neutral.filter === "" && neutral.gradient.opacity === 0 && neutral.wash.opacity === 0,
    "a neutral grade produces no filter and invisible overlays, even in a dark scene");
  const f = cssFallbackFor({ ...M.NEUTRAL_GRADE, basic: { ...M.NEUTRAL_GRADE.basic, saturation: 40, hue: 30 } }, M.DEFAULT_TRIM, 1).filter;
  ok(/saturate\(1\.4/.test(f) && /hue-rotate\(30/.test(f), "saturation and hue map onto their CSS filters", f);
  const half = cssFallbackFor({ ...M.NEUTRAL_GRADE, basic: { ...M.NEUTRAL_GRADE.basic, hue: 30 } }, M.DEFAULT_TRIM, 0.5).filter;
  ok(/hue-rotate\(15/.test(half), "intensity scales each filter toward neutral", half);
  const zero = cssFallbackFor(M.DEFAULT_GRADE, M.DEFAULT_TRIM, 0, 1);
  ok(zero.filter === "" && zero.gradient.opacity === 0 && zero.wash.opacity === 0, "…to nothing at all at intensity 0");
  const dark = cssFallbackFor(M.NEUTRAL_GRADE.basic ? { ...M.NEUTRAL_GRADE, wash: { ...M.NEUTRAL_GRADE.wash, darkness: 100 } } : null, M.DEFAULT_TRIM, 1, 0.5).filter;
  ok(/brightness\(0\./.test(dark), "scene darkness dims the fallback through brightness()", dark);

  ok(cssGradientAngle(90) === 180, "a light above paints its colour at the top (gradient runs to bottom)");
  ok(cssGradientAngle(0) === 270, "a light to the right paints the right edge (gradient runs to left)");
  ok(cssGradientAngle(180) === 90, "a light to the left paints the left edge (gradient runs to right)");
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
      return { src, art: { width: 8, height: 16 } };
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

  // The Grade tab builds its keys at runtime from GRADE_UI, so nothing above
  // sees them; a missing one renders as its own key path in the GM's panel.
  const { GRADE_UI, DIRECTION_PAD } = await import(new URL("scripts/features/stage/grade-tab.mjs", ROOT).href);
  const dynamic = [];
  const wrongControl = [];
  for (const block of GRADE_UI) {
    dynamic.push(`GLSTAGE.grade.${block.section}.title`);
    if (block.section !== "looks") dynamic.push(`GLSTAGE.grade.${block.section}.hint`);
    for (const key of block.controls ?? []) {
      dynamic.push(`GLSTAGE.grade.${block.section}.${key}`);
      const isDial = !!M.SECTIONS[block.section]?.[key];
      const isColor = !!M.COLORS[block.section]?.[key];
      if (!isDial && !isColor) wrongControl.push(`${block.section}.${key}`);
    }
  }
  for (const k of M.TRIM_KEYS) dynamic.push(`GLSTAGE.grade.basic.${k}`);
  const tabSrc = await read("scripts/features/stage/grade-tab.mjs");
  for (const m of tabSrc.matchAll(/\b(?:i18n|fmt)\('([\w.]+)'/g)) dynamic.push(`GLSTAGE.grade.${m[1]}`);
  const unresolved = [...new Set(dynamic)].filter((k) => !has(k));
  ok(!unresolved.length, "every key the Grade tab builds or names resolves", unresolved.join("; "));
  ok(!wrongControl.length, "every Grade tab control is a real dial or colour of its section", wrongControl.join(", "));

  // Every dial of every section, and every colour, has a control somewhere:
  // a dial with no control is reachable only from the console.
  const shown = new Set(GRADE_UI.flatMap((b) => (b.controls ?? []).map((k) => `${b.section}.${k}`)));
  const hidden = [];
  for (const [section, dials] of Object.entries(M.SECTIONS)) {
    for (const key of [...Object.keys(dials), ...Object.keys(M.COLORS[section] ?? {})]) {
      if (!shown.has(`${section}.${key}`)) hidden.push(`${section}.${key}`);
    }
  }
  ok(!hidden.length, "every dial and colour in the schema has a Grade tab control", hidden.join(", "));
  ok(GRADE_UI.some((b) => b.looks), "the look stack has a section");
  ok(DIRECTION_PAD.filter((a) => a !== null).length === 8 && DIRECTION_PAD[4] === null, "the direction pad is eight directions around an empty centre");
  ok(DIRECTION_PAD.every((a) => a === null || (a >= M.SECTIONS.light.angle.min && a <= M.SECTIONS.light.angle.max)), "…each inside the angle dial's range");
  ok(has("GLSTAGE.panel.grade") && has("GLSTAGE.panel.trim") && has("GLSTAGE.panel.trimHint"), "the tab and the actor correction have their labels");
}

console.log(failed ? `\n${failed} of ${checks} FAILED` : `\n${checks} checks passed`);
process.exit(failed ? 1 : 0);
