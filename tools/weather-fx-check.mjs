/**
 * tools/weather-fx-check.mjs — pin what the time tracker's weather and delving
 * effects get wrong without a word.
 *
 *   node tools/weather-fx-check.mjs
 *
 * Every failure here renders something, just not the right thing: an archetype
 * with no look draws "clear"; a uniform declared and never written holds the
 * driver's initial value; a rate that is not a whole number of turns steps once
 * a loop; a shed name the effect never asks about never degrades; a pure module
 * that reaches the world breaks the preview; a CSS wash under the canvas
 * flattens every look back into one tinted pane. The check cannot compile GLSL:
 * serve `tools/weather-fx-preview.mjs` and look.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const rel = (p) => resolve(ROOT, p);
const src = (p) => readFileSync(rel(p), "utf8");
const imp = (p) => import(pathToFileURL(rel(p)).href);

const problems = [];
const fail = (msg) => problems.push(msg);
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const FX = "scripts/features/clocks-tracker/weather/fx/";
const looks = await imp(FX + "looks.mjs");
const shaders = await imp(FX + "shaders.mjs");
const { WEATHER_ARCHETYPES, WEATHER_DRIFTS } = await imp("scripts/features/clocks-tracker/const.js");
const { KINDS, effectFromKind } = await imp("scripts/features/clocks-tracker/weather/presets.js");
const { STAGE_LOOKS } = await imp("scripts/features/clocks-tracker/delving/presets.js");

const { LOOKS, ARCHETYPE_LOOK, KIND_LOOK, SHED_ORDER, BOLT, LOOP_SECONDS, resolveLook, makeBolt } = looks;
const { UNIFORMS, fragmentShader } = shaders;

/* ---- 1. every archetype and every kind lands on a real look ---- */
for (const a of WEATHER_ARCHETYPES) {
  if (!Object.hasOwn(ARCHETYPE_LOOK, a)) fail(`archetype "${a}" has no look (it would draw "clear")`);
  else if (!LOOKS.includes(ARCHETYPE_LOOK[a].look)) fail(`archetype "${a}" maps to unknown look "${ARCHETYPE_LOOK[a].look}"`);
}
for (const a of Object.keys(ARCHETYPE_LOOK)) if (!WEATHER_ARCHETYPES.includes(a)) fail(`ARCHETYPE_LOOK has "${a}", which no editor offers`);
for (const [k, v] of Object.entries(KIND_LOOK)) {
  if (!KINDS[k]) { fail(`KIND_LOOK names "${k}", which is not a shipped kind`); continue; }
  if (KINDS[k].archetype !== v.archetype) fail(`KIND_LOOK "${k}" expects archetype "${v.archetype}" but the kind ships "${KINDS[k].archetype}" (its look would never apply)`);
  const got = resolveLook(effectFromKind(k));
  if (got.look !== v.look) fail(`kind "${k}" resolves to "${got.look}", expected "${v.look}"`);
}
// A GM who changes a kind's archetype must get that archetype's look, not the kind's.
for (const k of Object.keys(KIND_LOOK)) {
  const other = WEATHER_ARCHETYPES.find((a) => a !== KIND_LOOK[k].archetype);
  const r = resolveLook({ ...effectFromKind(k), archetype: other });
  if (r.look !== ARCHETYPE_LOOK[other].look) fail(`kind "${k}" retyped to "${other}" still draws "${r.look}"`);
}
for (const [k, l] of Object.entries(STAGE_LOOKS)) {
  if (!WEATHER_ARCHETYPES.includes(l.effect?.archetype)) fail(`delving stage look "${k}" uses unknown archetype "${l.effect?.archetype}"`);
}

/* ---- 2. resolveLook is total and well-formed ---- */
const specs = [];
for (const a of [...WEATHER_ARCHETYPES, "nonsense", undefined]) for (const d of [...WEATHER_DRIFTS, undefined]) for (const I of [0, 0.5, 1, NaN, 7]) specs.push({ archetype: a, drift: d, intensity: I, tintParticle: "#zz", tintGlow: null });
for (const s of specs) {
  const r = resolveLook(s);
  const tag = `${s.archetype}/${s.drift}/${s.intensity}`;
  if (!LOOKS.includes(r.look)) fail(`${tag}: unknown look "${r.look}"`);
  if (!(r.I >= 0 && r.I <= 1)) fail(`${tag}: intensity ${r.I} outside 0..1`);
  if (r.p.length !== 4 || !r.p.every(Number.isFinite)) fail(`${tag}: variant flags malformed`);
  if (![...r.tint, ...r.glow].every((c) => c >= 0 && c <= 1)) fail(`${tag}: colour outside 0..1`);
  const len = Math.hypot(...r.dir);
  if (!(Math.abs(len - 1) < 1e-6 || len === 0)) fail(`${tag}: direction is not unit (${len})`);
}

/* ---- 3. uniforms: declared ⊆ UNIFORMS, every one written, every use declared ---- */
const rendererSrc = src(FX + "renderer.mjs");
const hostSrc = src("scripts/features/clocks-tracker/weather/effects.js");
for (const u of UNIFORMS) {
  if (!new RegExp(`\\bL\\.${u}\\b`).test(rendererSrc)) fail(`renderer never writes uniform ${u}`);
  if (!new RegExp(`\\b${u}\\s*:`).test(hostSrc)) fail(`host never supplies uniform ${u} (_uniforms)`);
}
for (const look of LOOKS) {
  const fs = fragmentShader(look);
  const declared = new Set([...fs.matchAll(/^\s*uniform\s+\w+\s+(\w+)/gm)].map((m) => m[1]));
  for (const d of declared) if (!UNIFORMS.includes(d)) fail(`${look}: declares uniform ${d}, which the renderer never writes`);
  const used = new Set([...stripComments(fs).matchAll(/\bu[A-Z]\w*/g)].map((m) => m[0]));
  for (const u of used) if (!declared.has(u)) fail(`${look}: reads ${u} without declaring it`);
  if (look !== "clear" && fs === fragmentShader("clear")) fail(`${look}: has no program of its own (falls back to clear)`);
  let depth = 0;
  for (const ch of fs) { if (ch === "{") depth++; else if (ch === "}") depth--; if (depth < 0) break; }
  if (depth !== 0) fail(`${look}: unbalanced braces in the assembled shader`);
}

/* ---- 4. whole-turn loops ---- */
const shaderSrc = stripComments(src(FX + "shaders.mjs"));
shaderSrc.split("\n").forEach((line, i) => {
  if (!/\buPhase\b/.test(line) || /uniform\s+float\s+uPhase|"uPhase"/.test(line)) return;
  if (!/turns\(/.test(line)) fail(`shaders.mjs:${i + 1}: uPhase used without a whole-turn rate (turns(k)) — it would step once a loop`);
});
if (!/% LOOP_SECONDS\) \/ LOOP_SECONDS/.test(hostSrc)) fail("host phase is not clock mod LOOP_SECONDS over LOOP_SECONDS");
if (!(Number.isInteger(LOOP_SECONDS) && LOOP_SECONDS > 0)) fail("LOOP_SECONDS must be a positive whole number");

/* ---- 5. budget, surfaces ---- */
const host = stripComments(hostSrc);
if (!/Budget\.ladder\(\s*LADDER_ID\s*,\s*SHED_ORDER\s*\)/.test(host)) fail("the effect does not bind Budget.ladder(id, SHED_ORDER)");
if (!/LADDER_ID\s*=\s*"clocks-weather"/.test(host)) fail('ladder id must stay "clocks-weather"');
for (const n of SHED_ORDER) if (!new RegExp(`allows\\("${n}"\\)`).test(host)) fail(`shed name "${n}" is never asked about (it would never degrade)`);
if (!/Surfaces\.register\(/.test(host)) fail("the effect never registers with Surfaces");
if (!/surface\.use\(\)/.test(host)) fail("the effect draws without asking Surfaces.use() first");
if (/getContext\(\s*["']webgl/.test(host)) fail("effects.js opens its own WebGL context (there is one, in fx/renderer.mjs)");
if (/x\s*=\s*x\s*\*\s*0\.9/.test(host)) fail("a private frame average crept back into effects.js");

/* ---- 6. purity of fx/ ---- */
for (const f of ["looks.mjs", "shaders.mjs", "renderer.mjs"]) {
  const s = stripComments(src(FX + f));
  for (const g of ["game", "foundry", "ui", "Hooks", "CONFIG"]) if (new RegExp(`(^|[^.\\w])${g}\\.`).test(s)) fail(`fx/${f} reaches ${g} (it must stay pure for the preview)`);
  if (/(^|[^.\w])canvas\.(stage|scene|app|ready)/.test(s)) fail(`fx/${f} reaches Foundry's canvas`);
  if (/\bimport\b[^;]*core\//.test(s)) fail(`fx/${f} imports from core/ (the preview loads it alone)`);
}

/* ---- 7. bolts ---- */
let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
for (const [w, h] of [[300, 54], [62, 50], [900, 54], [10, 10]]) {
  for (let n = 0; n < 200; n++) {
    const b = makeBolt(w, h, rand);
    if (b.length !== BOLT.points) { fail(`makeBolt(${w}×${h}) gave ${b.length} points, not ${BOLT.points}`); break; }
    if (b[0][0] < 0) { fail(`makeBolt(${w}×${h}) starts with the sentinel`); break; }
    const bad = b.find(([x, y]) => !(x === -1 && y === -1) && !(x >= -16 && x <= w + 16 && y >= -h * 0.2 && y <= h * 1.4));
    if (bad) { fail(`makeBolt(${w}×${h}) placed a point at ${bad} outside the host`); break; }
  }
}

/* ---- 8. the HUD shows the weather it was given ---- */
for (const f of ["scripts/features/clocks-tracker/apps/hud.js", "scripts/features/clocks-tracker/apps/weather-hud.js"]) {
  if (/document\.hidden/.test(stripComments(src(f)))) fail(`${f} gates an effect on document.hidden; nothing repaints on visibilitychange, so a change made while the tab was hidden stays hidden`);
}

/* ---- 9. CSS: no wash under the canvas, no :root writes ---- */
for (const f of ["styles/clocks-tracker-hud.css", "styles/clocks-tracker-weather.css", "styles/clocks-tracker-delving.css"]) {
  const css = stripComments(src(f));
  if (/(^|[\s,}]):root\b/.test(css)) fail(`${f} writes a custom property on :root`);
  for (const sel of ["#glct-hud .bar-wx", "#glct-hud .bar-dx", "#glct-hud .bar.dx-terminal .bar-dx", "#glct-hud .bar.collapsed.has-wx .bar-wx"]) {
    const m = css.match(new RegExp(sel.replace(/[.#]/g, (c) => "\\" + c) + "\\s*\\{([^}]*)\\}"));
    if (m && /\bbackground\s*:/.test(m[1])) fail(`${f}: "${sel}" paints a background under the shader (it flattens every look into one tinted pane)`);
  }
  if (/\.wxmini-label\s*\{[^}]*word-break\s*:\s*break-(word|all)/.test(css)) fail(`${f}: the weather label breaks inside a word again`);
}

/* ---- 10. calendar ranges that wrap past the year's end ---- */
try {
  const { TimeEngine } = await imp("scripts/features/clocks-tracker/engine.js");
  const R = (month, day, endMonth, endDay) => ({ scope: "range", month, day, endMonth, endDay });
  const cases = [
    [R(2, 10, 2, 20), 2, 15, true], [R(2, 10, 2, 20), 2, 21, false], [R(2, 10, 4, 5), 3, 1, true],
    [R(2, 10, 4, 5), 4, 6, false], [R(11, 20, 1, 5), 0, 15, true], [R(11, 20, 1, 5), 11, 25, true],
    [R(11, 20, 1, 5), 1, 5, true], [R(11, 20, 1, 5), 1, 6, false], [R(11, 20, 1, 5), 6, 1, false],
    [R(11, 20, 1, 5), 11, 19, false], [R(5, 20, 5, 3), 5, 25, true], [R(5, 20, 5, 3), 5, 10, false]
  ];
  for (const [e, m, d, want] of cases) {
    if (TimeEngine.matchesToday(e, m, d) !== want) fail(`range ${e.month}/${e.day}–${e.endMonth}/${e.endDay} on ${m}/${d} should be ${want}`);
  }
} catch (err) { fail(`engine.js did not import under Node: ${err.message}`); }

/* ---- 11. the frame loop actually draws ----
   Driven, not read: `Budget.measure` RETURNS a wrapper, and a loop that passed
   its work to it without calling the result drew one frame and then held it
   forever, with every still still looking right. */
{
  const frames = [];
  const fakeCanvas = () => ({
    width: 2, height: 2, style: {}, classList: { add() {} }, addEventListener() {}, removeEventListener() {},
    remove() {}, getContext: (k) => (k === "2d" ? { clearRect() {}, drawImage() {} } : { getExtension: () => null })
  });
  globalThis.document ??= { createElement: () => fakeCanvas(), hidden: false, addEventListener() {} };
  globalThis.requestAnimationFrame = (cb) => { frames.push(cb); return frames.length; };
  globalThis.cancelAnimationFrame = () => {};
  globalThis.getComputedStyle ??= () => ({ maskImage: "none" });
  const { WeatherEffect } = await imp("scripts/features/clocks-tracker/weather/effects.js");
  const { FxRenderer } = await imp(FX + "renderer.mjs");
  let draws = 0;
  FxRenderer.supported = () => true;
  FxRenderer.prototype.draw = function () { draws++; return null; };
  const host = { clientWidth: 300, clientHeight: 54, appendChild() {}, isConnected: true };
  const fx = WeatherEffect.create(host, effectFromKind("storm"));
  if (!fx) fail("WeatherEffect.create returned null with WebGL2 stubbed in");
  else {
    fx.resume();
    const before = draws;
    let t = 0;
    // One browser frame runs every callback queued for it at the same time
    // (the budget's own interval loop rides this stub too).
    for (let i = 0; i < 180 && frames.length; i++) { t += 1000 / 60; for (const cb of frames.splice(0)) cb(t); }
    const drawn = draws - before;
    if (drawn < 60) fail(`three seconds of animation frames drew ${drawn} time(s): the loop is not stepping the effects`);
    fx.pause();
    fx.destroy?.();
  }
}

if (problems.length) {
  console.log(problems.map((p) => "  ✗ " + p).join("\n"));
  console.log(`\n${problems.length} problem(s).`);
  process.exit(1);
}
console.log(`weather-fx-check: ${LOOKS.length} looks, ${WEATHER_ARCHETYPES.length} archetypes, ${Object.keys(KIND_LOOK).length} kind looks, ${specs.length} specs, 0 problems.`);
// The core surface registry keeps an idle timer alive under Node.
process.exit(0);
