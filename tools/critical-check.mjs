#!/usr/bin/env node
/**
 * Critical: consistency check.
 *
 * What it covers fails silently. A PIXI backdrop that hardcodes its colour
 * keeps the old black while every DOM surface moved to the skin's ink; a class
 * the runtime or a template emits with no rule behind it is a bare Foundry
 * control in an Ink and Signal window; a skin that restates a value drifts from
 * core the next time core is retuned; a missing `GLUC.*` key prints itself; a
 * video edge that stops being capped turns a 20s clip's fade-in into three
 * seconds. This drives the pure cut-in module and the real motion under Node
 * and reads the glue for what cannot be driven.
 *
 * It cannot show you the cut-in: `node tools/critical-preview.mjs` does.
 *
 *   node tools/critical-check.mjs
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const FEATURE = "scripts/features/critical";
const problems = [];
let checks = 0;
const fail = (msg) => problems.push(msg);
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/([^:"'`\\])\/\/.*$/gm, "$1");
const ok = (cond, what) => {
  checks++;
  if (!cond) fail(what);
};
const eq = (actual, expected, what) => {
  checks++;
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) fail(`${what}: expected ${e}, got ${a}`);
};
const near = (a, b, what, eps = 1e-6) => ok(Math.abs(a - b) < eps, `${what}: ${a} != ${b}`);

const C = await import(new URL(`../${FEATURE}/cut-in.mjs`, import.meta.url));
const { engine } = await import(new URL("../scripts/vendor/animejs/engine/engine.js", import.meta.url));
engine.useDefaultMainLoop = false;
const { createCinematicMotion } = await import(new URL(`../${FEATURE}/motion.mjs`, import.meta.url));

const sources = Object.fromEntries(
  readdirSync(join(ROOT, FEATURE)).filter((f) => /\.m?js$/.test(f)).map((f) => [f, strip(read(`${FEATURE}/${f}`))])
);
const templates = Object.fromEntries(
  readdirSync(join(ROOT, "templates/critical")).map((f) => [f, read(`templates/critical/${f}`)])
);
const css = read("styles/critical.css");
const cssBare = css.replace(/\/\*[\s\S]*?\*\//g, "");
const tokens = read("styles/gl-tokens.css");
const lang = JSON.parse(read("lang/critical.en.json"));
const coreLang = JSON.parse(read("lang/en.json"));

/* ── purity ──────────────────────────────────────────────────────────────── */
// cut-in.mjs is what the preview draws through. The moment it reads the world,
// the preview restates it and flatters whichever copy was touched last.
for (const file of ["cut-in.mjs", "motion.mjs"]) {
  ok(!/\b(game|canvas|ui|foundry|Hooks|document|window|PIXI|CONFIG)\s*[.?[]/.test(sources[file]), `${file}: reads the world, the DOM or PIXI; it must stay pure`);
}

/* ── what counts as a video ──────────────────────────────────────────────── */
for (const [path, want] of [
  ["worlds/x/crit.webm", true],
  ["https://cdn.example/a/B.MP4?token=1#t=2", true],
  ["clip.mov", true],
  ["portrait.webp", false],
  ["art/some.webm.png", false],
  ["noext", false],
  ["", false],
  [null, false],
]) eq(C.isVideoPath(path), want, `isVideoPath(${JSON.stringify(path)})`);

/* ── aspect fit ──────────────────────────────────────────────────────────── */
{
  const wide = C.fitBox(1920, 1080, 1280, 720);
  near(wide.scale, 2 / 3, "16:9 art on a 16:9 screen fits by width");
  near(wide.x, 0, "16:9 fit has no side bars");
  const tall = C.fitBox(1000, 2000, 1600, 900);
  near(tall.h, 900, "a portrait fits the screen height");
  near(tall.x, (1600 - 450) / 2, "a portrait is centred");
  const unknown = C.fitBox(0, 0, 800, 600);
  eq(unknown.scale, 1, "an unknown source fits at scale 1");
}

/* ── video edges: fractions while short, real-time caps once long ─────────── */
{
  const short = C.videoEdges(1000);
  for (const key of Object.keys(C.EDGE_FRACTIONS)) near(short[key], C.EDGE_FRACTIONS[key], `a 1s clip keeps the ${key} fraction`);
  const long = C.videoEdges(20000);
  for (const key of Object.keys(C.VIDEO_EDGE_MS)) near(long[key] * 20000, C.VIDEO_EDGE_MS[key], `a 20s clip caps ${key} at ${C.VIDEO_EDGE_MS[key]}ms`);
  ok(Number.isFinite(C.videoEdges(0).easeIn), "a zero-length clip still yields finite edges");
}

/* ── the duration readout ────────────────────────────────────────────────── */
eq(C.durationLabel(1250), "1250 ms", "durationLabel");
eq(C.durationLabel("800"), "800 ms", "durationLabel reads the slider's string value");
eq(C.durationLabel(undefined), "0 ms", "durationLabel never prints NaN");
ok(/addEventListener\("input"[^;]*durationLabel\(/.test(sources["module.js"]), "module.js: the slider readout must follow input, not the last save");
ok(/\{\{durationLabel\}\}/.test(templates["gm-config.html"]), "gm-config.html: the readout must render durationLabel");

/* ── colour from a token, for PIXI ───────────────────────────────────────── */
eq(C.colorToInt("#05060a"), 0x05060a, "colorToInt reads #rrggbb");
eq(C.colorToInt(" #fff "), 0xffffff, "colorToInt reads #rgb");
eq(C.colorToInt("", 0), 0, "a missing token falls back to black");
eq(C.colorToInt("rgb(1 2 3)", 7), 7, "a non-hex value falls back");

/* ── the DOM frame and the motion agree ──────────────────────────────────── */
{
  const motion = createCinematicMotion(1000);
  const open = C.mediaStyle(motion.sample(500));
  eq(open.clipPath, "inset(0% 0% 0% 0%)", "the wipe is fully open mid-beat");
  ok(Number(open.opacity) === 1, "the art is opaque mid-beat");
  const shut = C.mediaStyle({ ...motion.sample(0), wipe: -2 });
  eq(shut.clipPath, "inset(50% 0% 50% 0%)", "a wipe below 0 is clamped shut");
  const end = motion.sample(1000);
  near(end.bgAlpha, 0, "the backdrop is gone at the end of the beat");
  near(end.imgAlpha, 0, "the art is gone at the end of the beat");
  motion.destroy();
  ok(/EDGE_FRACTIONS\.easeIn/.test(sources["motion.mjs"]), "motion.mjs reads its edges from cut-in.mjs, not a second copy");
}

/* ── the runtime goes through the seam ───────────────────────────────────── */
{
  const mod = sources["module.js"];
  const imagePath = mod.slice(mod.indexOf("async function runImageCinematic"), mod.indexOf("async function runVideoCinematic"));
  ok(imagePath.length > 100 && !/beginFill\(\s*(0|0x0+)\s*,/.test(imagePath), "module.js: the PIXI backdrop hardcodes black instead of reading the skin");
  ok(/cssVar\(\s*BACKDROP_VAR/.test(mod), "module.js: the PIXI backdrop must read BACKDROP_VAR off the overlay root");
  ok(!/VIDEO_EXTENSIONS\s*=/.test(mod) && !/function (isVideoPath|videoEdges|aspectFitScale)\b/.test(mod), "module.js restates a cut-in.mjs helper");
  ok(/mediaStyle\(frame\)/.test(mod), "module.js: the video tick must style through mediaStyle()");
  ok(css.includes(`${C.BACKDROP_VAR}:`), `critical.css must declare ${C.BACKDROP_VAR}`);
}

/* ── the skin ────────────────────────────────────────────────────────────── */
ok(!/:root\b/.test(cssBare), "critical.css writes on :root");
ok(!/#[0-9a-f]{3,8}\b/i.test(cssBare), "critical.css states a hex: alias a --gl-is-* token instead");
ok(!/rgba?\(\s*255\s*,\s*255\s*,\s*255/.test(cssBare), "critical.css has a raw white veil");
ok(!/prefers-reduced-motion/.test(cssBare), "critical.css honours prefers-reduced-motion; the suite does not");
ok(!/@font-face|@import/.test(cssBare), "critical.css declares a font or an import");
for (const m of cssBare.matchAll(/@keyframes\s+([\w-]+)/g)) ok(m[1].startsWith("gluc-"), `@keyframes ${m[1]} is not prefixed gluc-`);
for (const m of cssBare.matchAll(/(transition|animation)(-duration|-delay)?\s*:[^;]*?\b\d+(\.\d+)?m?s\b/g)) fail(`raw duration in critical.css: ${m[0].slice(0, 80)}`);
for (const m of cssBare.matchAll(/cubic-bezier\(/g)) fail("raw easing in critical.css; use --gl-ease*");
{
  const declared = new Set([...cssBare.matchAll(/(--gluc-[\w-]+)\s*:/g)].map((m) => m[1]));
  for (const m of new Set([...cssBare.matchAll(/var\((--gluc-[\w-]+)/g)].map((m) => m[1]))) ok(declared.has(m), `${m} is read but never declared`);
  const core = new Set([...tokens.matchAll(/(--gl-[\w-]+)\s*:/g)].map((m) => m[1]));
  for (const m of new Set([...cssBare.matchAll(/var\((--gl-[\w-]+)/g)].map((m) => m[1]))) ok(core.has(m), `${m} is not a core token`);
  // An alias is `--gluc-x: var(--gl-is-y | --gluc-z)` and nothing else.
  for (const m of cssBare.matchAll(/(--gluc-[\w-]+)\s*:\s*([^;]+);/g)) {
    ok(/^var\(--(gl-is|gluc)-[\w-]+\)$/.test(m[2].trim()), `${m[1]} restates a value (${m[2].trim()}); alias core instead`);
  }
}

/* ── every class the runtime and the templates emit has a rule ───────────── */
{
  const emitted = new Set();
  for (const src of [...Object.values(sources), ...Object.values(templates)]) {
    for (const m of src.matchAll(/(?<![\w-])gluc-[a-z][\w-]*/g)) emitted.add(m[0]);
  }
  for (const tpl of Object.values(templates)) {
    for (const m of tpl.matchAll(/class="([^"{]+)"/g)) for (const c of m[1].split(/\s+/)) if (c) emitted.add(c);
  }
  // Icon glyphs and Foundry's own layout helper are not the skin's to style.
  const skip = (cls) => /^fa[srb]?$|^fa-/.test(cls) || cls === "flexrow";
  for (const cls of emitted) {
    if (skip(cls)) continue;
    ok(new RegExp(`\\.${cls}(?![\\w-])`).test(cssBare), `class "${cls}" is emitted but has no rule in critical.css`);
  }
  for (const cls of [...cssBare.matchAll(/\.(gluc-[\w-]+)/g)].map((m) => m[1])) ok(emitted.has(cls), `critical.css styles .${cls}, which nothing emits`);
}

/* ── i18n: every literal key resolves ────────────────────────────────────── */
{
  const get = (key) => key.split(".").reduce((o, k) => (o && typeof o === "object" ? o[k] : undefined), lang);
  const keys = new Set();
  for (const src of [...Object.values(sources), ...Object.values(templates)]) {
    for (const m of src.matchAll(/["'`](GLUC\.[\w.]+)["'`]/g)) keys.add(m[1]);
  }
  ok(keys.size > 20, `only ${keys.size} GLUC keys found; the scan is broken`);
  for (const key of keys) ok(typeof get(key) === "string", `${key} does not resolve in lang/critical.en.json`);
  for (const key of ["GLS.feature.critical.title", "GLS.feature.critical.hint"]) ok(typeof coreLang[key] === "string", `${key} missing from lang/en.json`);
}

/* ── nothing at import ───────────────────────────────────────────────────── */
{
  const index = sources["index.mjs"];
  ok(!/^\s*Hooks\.(on|once)/m.test(index) && !/^\s*Hooks\.(on|once)/m.test(sources["module.js"].split("\n").filter((l) => !/^\s{2,}/.test(l)).join("\n")), "a hook is registered at import time");
}

if (problems.length) {
  console.error(`critical-check: ${problems.length} problem(s) in ${checks} checks`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`critical-check: ${checks} checks, 0 problems`);
process.exit(0);
