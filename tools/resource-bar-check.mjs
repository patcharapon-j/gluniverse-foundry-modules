/**
 * Resource bars — consistency check.
 *
 *   node tools/resource-bar-check.mjs
 *   node tools/resource-bar-check.mjs --sheet=/tmp/bars.html
 *
 * Everything below fails *silently* in a running world, which is the bar this
 * repo sets for writing one of these. A shader that will not compile degrades
 * to a static fallback rather than erroring; a uniform that is declared and
 * never set is a no-op; a duration written as a literal ignores the user's
 * motion tier forever; and a numeric readout drawn outside the displayBars gate
 * leaks a hostile's hit points while looking completely correct.
 *
 * The browser-backed pass needs Playwright and skips cleanly without it, as
 * `tools/stage-lighting-preview.mjs` does.
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const ROOT = new URL("../", import.meta.url);
const rel = (p) => fileURLToPath(new URL(p, ROOT));

let problems = 0;
const fail = (msg) => { console.log("FAIL  " + msg); problems++; };
const ok = (msg) => console.log("ok    " + msg);

const src = async (p) => readFile(rel(p), "utf8");
/* Comments are prose and routinely contain the words we grep for. */
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const shader = await import(new URL("scripts/features/resource-bars/shader.mjs", ROOT).href);
const anim = await import(new URL("scripts/features/resource-bars/anim.mjs", ROOT).href);
const ramp = await import(new URL("scripts/features/resource-bars/ramp.mjs", ROOT).href);

const shaderSrc = await src("scripts/features/resource-bars/shader.mjs");
const hostSrc = await src("scripts/features/resource-bars/host.mjs");
const animSrc = await src("scripts/features/resource-bars/anim.mjs");
const tokensCss = await src("styles/gl-tokens.css");

/* ── 1. The uniform table, the GLSL and the JS all agree ────────────────── */
{
  const glsl = strip(shader.FRAGMENT_SHADER);
  const declared = new Set([...glsl.matchAll(/uniform\s+\w+\s+(\w+)/g)].map((m) => m[1]));
  const listed = new Set(Object.keys(shader.UNIFORMS));

  for (const u of listed) if (!declared.has(u)) fail(`UNIFORMS lists ${u}, which the GLSL never declares.`);
  for (const u of declared) if (!listed.has(u)) fail(`GLSL declares ${u}, which UNIFORMS does not list.`);

  /* A uniform nothing writes is a silent no-op, not an error. */
  const written = strip(hostSrc);
  for (const u of listed) {
    if (u === "uTexel") continue;                       // written through texelFor()
    if (!new RegExp(`\\b${u}\\b`).test(written) && !new RegExp(`\\b${u}\\b`).test(strip(shaderSrc.split("FRAGMENT_SHADER")[0])))
      fail(`${u} is declared but never written from host.mjs — it will always hold its initial value.`);
  }
  if (!problems) ok(`${listed.size} uniforms: declared, listed and written`);
}

/* ── 2. uTexel = 0 must be inert ────────────────────────────────────────── */
{
  const glsl = strip(shader.FRAGMENT_SHADER);
  /* Every clamp against px must be a max()/smoothstep that degrades to the
     unfiltered form at px = 0 — never a divide by it. */
  const divides = [...glsl.matchAll(/\/\s*uTexel\b/g)];
  if (divides.length) fail(`The shader divides by uTexel directly in ${divides.length} place(s). Divide by px, which is floored to an epsilon — uTexel itself is 0 whenever the uniform is missing.`);
  if (!/px = max\(uTexel \* uAspect, [0-9.]+\)/.test(glsl))
    fail("px is not derived as max(uTexel * uAspect, epsilon); the epsilon is what keeps uTexel 0 inert.");
  else ok("uTexel 0 is inert (px floors to epsilon, no divisions by px)");
}

/* ── 3. The ramp still mirrors gl-tokens.css ────────────────────────────── */
{
  const cssHex = (name) => tokensCss.match(new RegExp(`--gl-${name}:\\s*(#[0-9a-fA-F]{6})`))?.[1]?.toLowerCase();
  const pairs = [["hazard", 0], ["warn-deep", 1], ["signal", 2], ["good", 3]];
  let drift = 0;
  for (const [css, i] of pairs) {
    const want = cssHex(css);
    const have = String(ramp.RAMPS.default[i]).toLowerCase();
    if (!want) { fail(`gl-tokens.css has no --gl-${css}; the ramp mirrors a token that no longer exists.`); drift++; }
    else if (want !== have) { fail(`Ramp stop ${i} is ${have} but --gl-${css} is ${want}. The JS mirror has drifted from the stylesheet.`); drift++; }
  }
  if (!drift) ok("health ramp mirrors --gl-hazard / --gl-warn-deep / --gl-signal / --gl-good");
}

/* ── 4. No raw durations in the animation path ──────────────────────────── */
{
  const body = strip(animSrc).split("export const TIMING")[1]?.split("});")[1] ?? "";
  const literals = [...body.matchAll(/(?<![.\d])(\d{2,5})(?![.\d])/g)]
    .map((m) => Number(m[1]))
    .filter((n) => n >= 40 && n <= 5000);
  if (literals.length)
    fail(`anim.mjs has millisecond-looking literals outside TIMING: ${[...new Set(literals)].join(", ")}. Every duration must route through TIMING so the motion tier can scale it.`);
  else ok("every duration lives in TIMING and is scaled by the motion tier");

  for (const key of ["stopMs", "holdMs", "drainMs", "chipMs", "bloomMs", "flashMs",
                     "fillMs", "countMs", "waveMs", "hitMs", "punchMs",
                     "popupMs", "hotMs"])
    if (!(key in anim.TIMING)) fail(`TIMING is missing ${key}.`);
}

/* ── 4b. The hitstop actually stops ─────────────────────────────────────── */
{
  /* The whole impact sequence is built on a beat of held frames. If the freeze
     ever stops holding — a channel added below it, an early return removed —
     nothing errors and nothing looks broken; the hit just goes back to reading
     as a transition, which is a regression nobody can point at. */
  const a = new anim.BarAnim(1, { motionScale: 1 });
  a.step(16);
  a.set(0.5);
  const before = { frac: a.frac, ghost: a.ghost, num: a.num };
  a.step(16);
  const frozen = a.frac === before.frac && a.ghost === before.ghost && a.num === before.num;
  if (!frozen) fail("The hitstop does not hold: a value moved on the first frame after a change.");
  else if (a.flash !== 1 || a.wave !== 1)
    fail("The hitstop holds the values but not the reaction channels; flash and the sweep must be at peak during the freeze.");
  else ok(`hitstop holds every channel for ${anim.TIMING.stopMs}ms`);

  /* And releases. A freeze that never ends is a bar that never animates.
     Measured on `flash`, not on `frac`: on damage the fill is already at its
     new value and — now that nothing springs — never moves again, so a value
     that stays put is the correct behaviour rather than evidence of a freeze. */
  let guard = 0;
  while (a.flash >= 1 && guard++ < 40) a.step(16);
  if (guard >= 40) fail("The hitstop never releases; every channel is still held after 640ms.");

  /* The readout counts rather than snapping — the reason `num` exists at all
     as a channel separate from `frac`. */
  const b = new anim.BarAnim(1, { motionScale: 1 });
  b.step(16);
  b.set(0.2);
  for (let i = 0; i < Math.ceil(anim.TIMING.stopMs / 16) + 1; i++) b.step(16);
  if (!(b.num > b.target && b.num < 1))
    fail("The readout snaps to the new value instead of counting to it (anim.num is not tweening).");
  else ok("the readout counts to the new value rather than snapping");
}

/* ── 5. The glyph atlas covers everything a run can emit ────────────────── */
{
  const atlasSrc = await src("scripts/features/resource-bars/atlas.mjs");
  const glyphs = strip(atlasSrc).match(/const GLYPHS = "([^"]+)"/)?.[1] ?? "";
  const needed = "0123456789/+-";
  const missing = [...needed].filter((c) => !glyphs.includes(c));
  if (missing.length) fail(`The atlas is missing glyph(s) ${missing.join(" ")}; a run containing one draws a gap.`);
  else ok(`atlas covers ${glyphs.length} glyphs, including the delta signs`);
}

/* ── 6. Numbers never escape the displayBars gate ───────────────────────── */
{
  const h = strip(hostSrc);
  if (!/canViewNumbers\(/.test(h))
    fail("host.mjs never calls canViewNumbers; the numeric readout is not permission-gated and will leak hidden hit points.");
  else if (!/writeNumbers[\s\S]{0,400}canViewNumbers\(/.test(h))
    fail("writeNumbers does not consult canViewNumbers before drawing.");
  else ok("the numeric readout is inside the displayBars gate");

  const vis = strip(await src("scripts/features/resource-bars/visibility.mjs"));
  if (!/token\.bars[\s\S]{0,120}visible/.test(vis))
    fail("visibility.mjs no longer defers to Foundry's own token.bars.visible; recomputing the rule invites drift from core.");
}

/* ── 7. Every animated behaviour can be shed ────────────────────────────── */
{
  const h = strip(hostSrc);
  const gated = new Set([...h.matchAll(/allows\("(\w+)"\)/g)].map((m) => m[1]));
  for (const e of gated)
    if (!anim.SHED_ORDER.includes(e)) fail(`host.mjs gates "${e}" but SHED_ORDER does not list it, so it never actually degrades.`);
  const animated = ["sweep", "ghost", "bloom", "numbers", "popups", "ring", "punch",
                    "sparks", "wave"];
  for (const e of animated)
    if (!gated.has(e)) fail(`"${e}" is animated but is not behind an allows() gate; under load it can never be shed.`);
  for (const e of anim.SHED_ORDER)
    if (!gated.has(e)) fail(`SHED_ORDER lists "${e}" but nothing gates on it, so the entry is dead and the order it implies is a lie.`);
  if (!problems) ok(`shed table covers all ${gated.size} animated behaviours`);
}

/* ── 7b. The bars sort above the token furniture ────────────────────────── */
{
  /* `canvas.interface` sorts its children by zIndex and every Foundry layer
     declares one. A container left at the default 0 renders *under* the tokens
     layer — which is where a Token's hover box, target reticle and nameplate
     live — so the bars come out correct in every respect except that the hover
     border is drawn straight over them. Nothing errors; it just looks wrong
     only while a token is hovered, which is when a GM is least likely to be
     inspecting the HUD. */
  const h = strip(hostSrc);
  const z = h.match(/const CONTAINER_Z\s*=\s*(\d+)/)?.[1];
  if (!z) fail("host.mjs no longer declares CONTAINER_Z; the bar container will sort under the tokens layer and the hover box will draw over it.");
  else if (!/container\.zIndex\s*=\s*CONTAINER_Z/.test(h))
    fail("CONTAINER_Z is declared but never assigned to the container's zIndex.");
  else if (Number(z) <= 800 || Number(z) >= 1000)
    fail(`CONTAINER_Z is ${z}; it must clear the notes layer (800) and stay under the controls layer (1000), which owns rulers and door controls.`);
  else ok(`bar container sorts at zIndex ${z}, above the token furniture and below the controls layer`);
}

/* ── 7c. An unset per-token offset means "inherit", not "zero" ──────────── */
{
  /* The Token Config field is empty when a token has no override. Foundry turns
     an empty Number field into null only when the input declares
     data-dtype="Number"; without it the empty field submits "" which coerces to
     0, and every token silently pins its bars at the origin while the world
     default stops applying. The sheet looks completely normal. */
  const tc = strip(await src("scripts/features/resource-bars/token-config.mjs"));
  if (!/dataset\.dtype\s*=\s*"Number"/.test(tc))
    fail('The Token Config offset inputs do not declare data-dtype="Number"; an emptied field will read as a deliberate 0 rather than as "inherit the world default".');
  else ok("an emptied per-token offset falls back to the world default");

  if (!/Number\.isFinite\(v\)\s*\?\s*v\s*:\s*fallback/.test(strip(hostSrc)))
    fail("host.mjs's offsetFor no longer tests the flag for finiteness; a null or empty-string flag will coerce to 0 and override the world default.");

  if (!/name:\s*`flags\.\$\{SUITE_ID\}/.test(await src("scripts/features/resource-bars/token-config.mjs")))
    fail("The Token Config inputs are not named for the flag path; they will not be saved by the sheet's own submit.");
}

/* ── 7d. Per-glyph weight survives ──────────────────────────────────────── */
{
  /* The maximum is drawn quieter than the current value through a per-vertex
     attribute rather than a second mesh. Drop either half and the run still
     renders — at full strength, silently undoing the hierarchy. */
  const atlasSrc = strip(await src("scripts/features/resource-bars/atlas.mjs"));
  const declared = /attribute float aDim/.test(atlasSrc);
  const supplied = /addAttribute\("aDim"/.test(atlasSrc);
  const used = /vDim/.test(atlasSrc);
  if (!declared || !supplied || !used)
    fail("The readout's per-glyph weight is incomplete (aDim must be declared, supplied by runGeometry and read as vDim); the maximum will draw at full strength.");
  else if (!/dim:\s*0?\.\d+/.test(strip(hostSrc)))
    fail("Nothing in host.mjs passes a dim weight, so every part of the readout draws at the same strength.");
  else ok("the maximum is drawn at reduced weight through the run's own attribute");
}

/* ── 8. The shear has one home ──────────────────────────────────────────── */
{
  const glsl = shader.FRAGMENT_SHADER;
  if (!glsl.includes(`const float SKEW = ${shader.SKEW.toFixed(4)};`))
    fail("The GLSL's SKEW does not come from the exported constant; the bar and its numerals will drift apart.");
  else if (!/skew: SKEW/.test(strip(hostSrc)))
    fail("host.mjs lays out numerals with something other than the exported SKEW.");
  else ok(`shear is ${shader.SKEW} in exactly one place, shared by bar and numerals`);
}

/* ── 9. Detail survives the reference token size ────────────────────────── */
{
  /* The lesson the previews taught, twice. A feature can be mathematically
     correct and practically invisible: rbDetail deletes anything that no longer
     spans GL_FADE_LO device pixels, which is the right behaviour and the reason
     a detail specified in geometry units disappears at the size the thing is
     actually played at — or, worse, disappears only for players without a
     HiDPI display, which is invisible from any preview you run yourself.

     The reference is a hero bar under a 128px token on a dpr-1 monitor: 19
     device pixels tall, the smallest size this is expected to stay readable at. */
  const REF_BAR_PX = 19;
  const px = 1 / REF_BAR_PX;
  const GL_FADE_LO = 0.8, GL_FADE_HI = 2.2;
  const glsl = strip(shader.FRAGMENT_SHADER);

  /* The segment gap is deliberately *not* a fixed magnitude: pinned to px it is
     the same hairline on every display. Check that it still is — a literal
     creeping back in here is the retina-only-divisions bug returning. */
  if (!/float gapP = min\(max\(px \* [0-9.]+,/.test(glsl))
    fail("The segment gap is not derived from px. A fixed value is ~2px on a HiDPI display and sub-pixel on an ordinary one, so the divisions vanish for players without a retina monitor.");
  else ok("segment gap is pinned to device pixels, not geometry units");

  const gated = [...glsl.matchAll(/rbDetail\(([0-9.]+)\s*(?:\*\s*([0-9.]+))?\)/g)]
    .map((m) => ({ raw: m[0], value: Number(m[1]) * (m[2] ? Number(m[2]) : 1) }));

  if (!gated.length) fail("No literal rbDetail() gates found; the size-check has nothing to verify.");
  const faint = [];
  for (const g of gated) {
    const spans = g.value / px;
    if (spans < GL_FADE_LO)
      fail(`${g.raw} spans ${spans.toFixed(2)}px on a ${REF_BAR_PX}px bar — fully deleted there, so that detail does not exist at the size this is played at.`);
    else if (spans < GL_FADE_HI) faint.push(`${g.raw} → ${spans.toFixed(1)}px`);
  }
  if (gated.length) ok(`${gated.length} detail gate(s) still resolve on a ${REF_BAR_PX}px bar`);
  if (faint.length) console.log("      partial at the reference size (by design, but worth knowing): " + faint.join(", "));
}

/* ── 10. The shader compiles ────────────────────────────────────────────── */
{
  const { createRequire } = await import("node:module");
  const require_ = createRequire(import.meta.url);
  const GLOBAL_ROOTS = ["/usr/local/lib/node_modules", "/opt/homebrew/lib/node_modules"];
  let pwPath;
  try {
    pwPath = require_.resolve("playwright", { paths: [rel("."), ...GLOBAL_ROOTS] });
  } catch {
    console.log("SKIP  playwright is not installed — cannot compile the shader without a browser");
    console.log("      npm i -g playwright");
    console.log(problems ? `\n${problems} problem(s)` : "\nno problems");
    process.exit(problems ? 1 : 0);
  }

  const pw = await import(pwPath);
  const browser = await pw.chromium.launch();
  const page = await browser.newPage();
  const result = await page.evaluate(({ vert, frag }) => {
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl2") || c.getContext("webgl");
    if (!gl) return { error: "no WebGL context" };
    const build = (type, srcText, label) => {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, srcText);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) return label + ": " + gl.getShaderInfoLog(sh);
      return sh;
    };
    const vs = build(gl.VERTEX_SHADER, vert, "vertex");
    if (typeof vs === "string") return { error: vs };
    const fs = build(gl.FRAGMENT_SHADER, frag, "fragment");
    if (typeof fs === "string") return { error: fs };
    const prog = gl.createProgram();
    gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return { error: "link: " + gl.getProgramInfoLog(prog) };
    /* A uniform the compiler optimised away is a uniform nothing reads. */
    const dead = [];
    for (const name of Object.keys(UNIFORM_NAMES))
      if (gl.getUniformLocation(prog, name === "uRamp" ? "uRamp[0]" : name) === null) dead.push(name);
    return { dead };
  }, { vert: shader.PREVIEW_VERTEX_SHADER, frag: shader.FRAGMENT_SHADER });

  await browser.close();
  if (result.error) fail("The shader does not compile: " + result.error);
  else if (result.dead?.length) fail("Uniforms optimised away (nothing in the shader reads them): " + result.dead.join(", "));
  else ok("the fragment shader compiles and links, and every uniform survives");
}

console.log(problems ? `\n${problems} problem(s)` : "\nno problems");
process.exit(problems ? 1 : 0);
