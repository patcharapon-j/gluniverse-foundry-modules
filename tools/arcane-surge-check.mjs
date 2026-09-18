#!/usr/bin/env node
/**
 * GLUniverse Suite — Arcane Surge consistency check.
 *
 *   node tools/arcane-surge-check.mjs
 *
 * Everything this covers fails *silently*. None of it raises; all of it renders.
 *
 *   • The odds live in three places — the level config (threshold), the die
 *     presets (how many faces carry a glyph), and the texture baker (how many
 *     glyph faces it writes). If they disagree the die is a LIE about its own
 *     probability, and it looks completely correct while telling it.
 *   • Severity bands are cumulative upper bounds. Non-monotonic bounds produce a
 *     zero-or-negative-width tier that simply never comes up — a tier the GM
 *     configured and will never once see.
 *   • A shader that will not compile degrades to no overlay rather than erroring.
 *     A uniform declared in the GLSL and never written from JS holds its initial
 *     value forever, so the effect renders, just frozen.
 *   • JS timing constants mirror CSS duration tokens. A drifted pair unmounts
 *     the burst before or after its own animation, which reads as a flicker.
 *   • The level names are built into i18n keys at RUNTIME (`GLAS.level.<id>`),
 *     so a missing key renders the raw key string and nothing else catches it.
 *   • An animated behaviour missing from SHED_ORDER never degrades under load.
 *   • A severity card that can be rolled twice turns one casting into two
 *     verdicts — the exact thing the draft forbids.
 *
 * Zero problems required.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

const problems = [];
const fail = (where, msg) => problems.push(`${where}: ${msg}`);

/** Drop comments so a source-shape assertion cannot be satisfied — or tripped —
 *  by prose. Crude but sufficient: no regex literal in this feature contains a
 *  comment marker. */
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const FEATURE = "scripts/features/pf2e-arcane-surge";

const constants = await import(`../${FEATURE}/constants.mjs`);
const levels = await import(`../${FEATURE}/levels.mjs`);
const shader = await import(`../${FEATURE}/shader.mjs`);
const anim = await import(`../${FEATURE}/anim.mjs`);
const weave = await import(`../${FEATURE}/weave-shape.mjs`);

const {
  DEFAULT_LEVEL_CONFIG,
  LEVELS,
  ROWS,
  ROW_INVITED_UNRAVELING,
  TIERS,
  MAX_THRESHOLD,
  SURGE_DIE_DENOMINATION,
} = constants;

/* ══════════════════════════════════════════════════════════════════════
   1. The odds are one number, stated in three places
   ══════════════════════════════════════════════════════════════════════
   `threshold` is simultaneously the d20 result that surges, the count of glyph
   faces baked onto that level's die, and the count the DSN preset asks the
   baker for. Any two of them agreeing is not enough. */

const config = levels.resolveConfig();
const dsnSrc = read(`${FEATURE}/dsn.mjs`);
const bakerSrc = read("tools/gen-surge-textures.mjs");

for (const level of LEVELS) {
  const threshold = config[level].threshold;
  if (threshold !== DEFAULT_LEVEL_CONFIG[level].threshold) {
    fail("odds", `resolveConfig() changed the default threshold for "${level}"`);
  }
  if (levels.glyphFaces(level, config) !== threshold) {
    fail("odds", `glyphFaces("${level}") disagrees with its threshold (${threshold})`);
  }
  if (threshold < 0 || threshold > MAX_THRESHOLD) {
    fail("odds", `"${level}" threshold ${threshold} is outside 0..${MAX_THRESHOLD}`);
  }
}

if (config.stable.threshold !== 0) fail("odds", "Stable must never surge (threshold must be 0)");
if (levels.rollingLevels(config).includes("stable")) fail("odds", "Stable is listed as a rolling level");

// The preset builder must derive its face layout from the shared helper rather
// than hardcoding a count beside it.
if (!/glyphFaces\s*\(/.test(dsnSrc)) {
  fail("dsn.mjs", "die presets do not call glyphFaces() — the face count can drift from the threshold");
}
if (!/glyphFaces\s*\(/.test(bakerSrc) && !/threshold/.test(bakerSrc)) {
  fail("gen-surge-textures.mjs", "the baker does not read thresholds — its face set can drift from the odds");
}

/* ══════════════════════════════════════════════════════════════════════
   2. Severity bands stay monotonic, complete, and reachable-where-intended
   ══════════════════════════════════════════════════════════════════════ */

for (const row of ROWS) {
  const bands = config[row].bands;
  if (!bands) {
    fail("bands", `row "${row}" has no bands`);
    continue;
  }
  let floor = 0;
  for (const tier of TIERS) {
    if (!Number.isInteger(bands[tier])) fail("bands", `row "${row}" tier "${tier}" is not an integer`);
    if (bands[tier] < floor) fail("bands", `row "${row}" tier "${tier}" bound dips below the previous tier`);
    floor = bands[tier];
  }
  if (bands[TIERS[TIERS.length - 1]] !== 100) {
    fail("bands", `row "${row}" does not end at 100 — some d100 results fall off the end`);
  }

  // Every d100 result must resolve to exactly one tier.
  for (let roll = 1; roll <= 100; roll++) {
    const tier = levels.severityTier(roll, bands);
    if (!TIERS.includes(tier)) fail("bands", `row "${row}" roll ${roll} resolved to "${tier}"`);
  }
}

// The draft's defining shape: Fraying reaches Major but never Catastrophic or
// Breach without an invitation. If this ever inverts, the tone of the whole
// subsystem changes and nothing else would report it.
{
  const fraying = config.fraying.bands;
  if (levels.tierWindow("catastrophic", fraying)) fail("bands", "Fraying can reach Catastrophic without invitation");
  if (levels.tierWindow("breach", fraying)) fail("bands", "Fraying can reach Reality Breach without invitation");
  if (!levels.tierWindow("major", fraying)) fail("bands", "Fraying can never reach Major");

  const unbound = config.unbound.bands;
  if (!levels.tierWindow("catastrophic", unbound)) fail("bands", "Unbound can never reach Catastrophic");
  if (levels.tierWindow("breach", unbound)) fail("bands", "Unbound can reach Reality Breach without invitation");

  const unraveling = config.unraveling.bands;
  const breach = levels.tierWindow("breach", unraveling);
  if (!breach) fail("bands", "Unraveling can never reach Reality Breach");

  const invited = config[ROW_INVITED_UNRAVELING].bands;
  const invitedBreach = levels.tierWindow("breach", invited);
  if (!invitedBreach) fail("bands", "Invited-in-Unraveling can never reach Reality Breach");
  // Inviting must be more dangerous than not inviting, or the temptation the
  // whole mechanic rests on is a lie.
  if (breach && invitedBreach && invitedBreach[1] - invitedBreach[0] <= breach[1] - breach[0]) {
    fail("bands", "inviting in Unraveling is no more likely to breach than not inviting");
  }
}

/* ══════════════════════════════════════════════════════════════════════
   3. Exposure resolution — the rules the draft is explicit about
   ══════════════════════════════════════════════════════════════════════ */

{
  const stable = levels.resolveExposure("stable", "none", config);
  if (stable.rollsDie || stable.autoSurge) fail("exposure", "Stable rolls or surges");

  // Steadying is one step down; Fraying steadied is Stable, i.e. no check.
  if (levels.resolveExposure("fraying", "steadied", config).rollsDie) {
    fail("exposure", "a steadied casting in Fraying still rolls (it should be Stable)");
  }
  if (levels.resolveExposure("unbound", "steadied", config).effective !== "fraying") {
    fail("exposure", "steadying in Unbound does not reduce to Fraying");
  }
  if (levels.resolveExposure("unraveling", "steadied", config).effective !== "unbound") {
    fail("exposure", "steadying in Unraveling does not reduce to Unbound");
  }

  // Inviting escalates the ROW, guarantees a surge, and throws no die.
  const invitedFraying = levels.resolveExposure("fraying", "invited", config);
  if (invitedFraying.row !== "unbound") fail("exposure", "inviting in Fraying does not use the Unbound row");
  if (!invitedFraying.autoSurge) fail("exposure", "inviting does not guarantee a surge");
  if (invitedFraying.rollsDie) fail("exposure", "an invited casting throws a d20 whose result is predetermined");

  if (levels.resolveExposure("unbound", "invited", config).row !== "unraveling") {
    fail("exposure", "inviting in Unbound does not use the Unraveling row");
  }
  if (levels.resolveExposure("unraveling", "invited", config).row !== ROW_INVITED_UNRAVELING) {
    fail("exposure", "inviting in Unraveling does not use the invited row");
  }
  // Nothing to invite where the world is solid.
  if (levels.resolveExposure("stable", "invited", config).autoSurge) {
    fail("exposure", "inviting succeeds in Stable, where no instability exists");
  }
  // The two choices cannot stack; invited must win over a stale steadied flag.
  const both = levels.resolveExposure("unraveling", "invited", config);
  if (both.steadied) fail("exposure", "a casting resolved as both steadied and invited");
}

/* ══════════════════════════════════════════════════════════════════════
   4. Hostile config is repaired, not trusted
   ══════════════════════════════════════════════════════════════════════ */

{
  const wild = levels.resolveConfig({
    unbound: { threshold: 999, bands: { minor: 80, major: 20, catastrophic: 50, breach: 3 } },
    stable: { threshold: 7 },
  });
  if (wild.unbound.threshold > MAX_THRESHOLD) fail("config", "an out-of-range threshold survived resolveConfig()");
  if (wild.stable.threshold !== 0) fail("config", "a stored threshold made Stable surge");
  let floor = 0;
  for (const tier of TIERS) {
    if (wild.unbound.bands[tier] < floor) fail("config", "non-monotonic stored bands survived resolveConfig()");
    floor = wild.unbound.bands[tier];
  }
  if (wild.unbound.bands.breach !== 100) fail("config", "repaired bands do not end at 100");
}

/* ══════════════════════════════════════════════════════════════════════
   5. Shader uniforms: declared in GLSL, listed in the table, written from JS
   ══════════════════════════════════════════════════════════════════════
   Any two of the three agreeing is not enough. A uniform present in the GLSL
   and the table but never written holds its initial value for the life of the
   context — the effect renders, just frozen, and nothing reports it. */

for (const [label, frag, uniforms, hostRel] of [
  ["burst", shader.BURST_FRAG, shader.BURST_UNIFORMS, `${FEATURE}/burst.mjs`],
  // The verdict is an entirely separate program from the surge, and shares no
  // uniform block with it.
  ["severity", shader.SEVERITY_FRAG, shader.SEVERITY_UNIFORMS, `${FEATURE}/burst.mjs`],
  // The downsample runs a third. A uniform missing here would leave every frame
  // drawn at whatever opacity the driver happened to start with — usually zero,
  // i.e. an invisible beat.
  ["blit", shader.BLIT_FRAG, shader.BLIT_UNIFORMS, `${FEATURE}/gl-host.mjs`],
]) {
  const hostSrc = read(hostRel);
  const declared = new Set([...frag.matchAll(/uniform\s+\w+\s+(\w+)\s*;/g)].map((m) => m[1]));

  for (const name of uniforms) {
    if (!declared.has(name)) fail(`${label} shader`, `"${name}" is in the uniform table but not declared in the GLSL`);
    if (!hostSrc.includes(name)) fail(`${label} shader`, `"${name}" is never looked up or written from ${hostRel}`);
  }
  for (const name of declared) {
    if (!uniforms.includes(name)) fail(`${label} shader`, `"${name}" is declared in the GLSL but missing from the uniform table`);
  }
}

// A shader that fails to compile degrades to nothing, so SOMETHING must check.
// Both hosts build through the shared scaffolding, which is where the two
// statuses are read; if that ever stops being true, a broken shader goes
// completely silent on both layers at once.
{
  const glHost = read(`${FEATURE}/gl-host.mjs`);
  if (!/COMPILE_STATUS/.test(glHost) || !/LINK_STATUS/.test(glHost)) {
    fail("gl-host.mjs", "does not check both compile and link status — a broken shader would fail silently");
  }
  if (!/buildProgram\s*\(/.test(read(`${FEATURE}/burst.mjs`))) {
    fail("burst.mjs", "does not build through gl-host.mjs, so it may not be checking compile/link status");
  }
}

/* ══════════════════════════════════════════════════════════════════════
   5b. The standing weave is not WebGL, and the ladder is still a ladder
   ══════════════════════════════════════════════════════════════════════
   The instability ran as a fragment shader for a while. It does not any more —
   it is four SVG paths moved by anime.js — and most of what used to be checked
   here checked things that only a shader can get wrong. What replaced them are
   the things only THIS can get wrong, and every one of them renders.

   The first is the reversal itself. A GL context reintroduced here reads as a
   quality improvement in its own diff and brings back everything the move was
   for: a program to warm off-screen at load, a colour ramp to push by hand
   because GLSL cannot read a custom property, and a device-pixel size to
   recompute against both devicePixelRatio and the suite's Interface Scale zoom. */

{
  const shape = read(`${FEATURE}/weave-shape.mjs`);
  const weaveFiles = ["weave.mjs", "weave-render.mjs", "weave-shape.mjs"];

  for (const rel of weaveFiles) {
    const body = stripComments(read(`${FEATURE}/${rel}`));
    for (const pattern of [/getContext\s*\(/, /buildProgram\s*\(/, /mountCanvas\s*\(/, /\bWebGL/]) {
      if (pattern.test(body)) fail(rel, `reaches for WebGL (${pattern}) — the standing layer is DOM on purpose`);
    }
  }
  // And the crack program must stay gone from the shader module with it.
  for (const name of ["CRACK_FRAG", "CRACK_UNIFORMS", "CRACK_FIELD_PX"]) {
    if (name in shader) fail("shader.mjs", `still exports ${name} — the standing weave is not a shader any more`);
  }

  /* THE ENGINE IS NOT THIS FEATURE'S. anime.js's main loop is shared with a
     dozen features; re-hosting it, or changing its speed or its
     pauseOnDocumentHidden, silently re-clocks every one of them. (The suite
     relies on that default: it is what stops this layer costing anything in a
     background tab, and it is why there is no visibilitychange handler here.) */
  for (const rel of weaveFiles) {
    if (/\bengine\b|useDefaultMainLoop|pauseOnDocumentHidden/.test(stripComments(read(`${FEATURE}/${rel}`)))) {
      fail(rel, "touches the shared anime.js engine — that would re-clock every other feature");
    }
  }

  /* THE RENDERER MUST NOT READ THE WORLD. It is what the preview page drives,
     and it can only do that while it holds no reference to `game`: the moment
     it does, the preview has to reimplement it, and a preview built on a second
     copy flatters whichever copy somebody last touched. */
  for (const rel of ["weave-render.mjs", "weave-shape.mjs"]) {
    const body = stripComments(read(`${FEATURE}/${rel}`));
    if (/\bgame\.|\bHooks\b|\bcanvas\.|game\.settings/.test(body)) {
      fail(rel, "reads Foundry state — the renderer has to stay drivable from the preview page");
    }
  }

  /* STABLE RENDERS NOTHING. Not a very faint something: the chip at rest is a
     word and a marker, and anything drawn under it at Stable is the feature
     telling the table the world is unstable when it is not. */
  const rest = weave.weaveParams(0);
  if (levels.chaosFor("stable") !== 0) fail("weave", "chaosFor('stable') is not 0");
  for (const key of ["amplitude", "opacity", "splay", "gapFraction"]) {
    if (rest[key] !== 0) fail("weave-shape.mjs", `weaveParams(0).${key} is ${rest[key]}, not 0 — Stable would draw`);
  }

  /* THE LADDER HAS TO CLIMB. Every rung of it is a separate reading — how far
     the weave reaches, how far the threads wander, how much of them is missing,
     how far the torn halves pull apart — and a term that stopped rising with
     chaos renders a perfectly good weave that says the same thing at every
     level, which is the one thing this layer exists not to do. */
  const rungs = LEVELS.map((level) => ({ level, p: weave.weaveParams(levels.chaosFor(level)) }));
  for (let i = 2; i < rungs.length; i++) {
    for (const key of ["amplitude", "gapFraction", "splay", "reach", "opacity"]) {
      if (!(rungs[i].p[key] > rungs[i - 1].p[key])) {
        fail("weave-shape.mjs", `"${key}" does not rise from ${rungs[i - 1].level} to ${rungs[i].level} — the two rungs are indistinguishable`);
      }
    }
  }

  /* AND IT HAS TO CLIMB IN THE LADDER'S OWN VOCABULARY: loosening at Fraying,
     parting at Unbound, splayed fibres at Unraveling. The fibres are the torn
     ENDS of a hole, so a hole too narrow to hold two of them has none — which
     is what keeps Fraying reading as "loosening" rather than "coming apart",
     and it is a property of the numbers rather than of a special case. */
  for (const { level, p: params } of rungs) {
    const fibred = Array.from({ length: weave.THREADS }, (_, i) => !!weave.dashPattern(i, params).fibre);
    const any = fibred.some(Boolean);
    if ((level === "stable" || level === "fraying") && any) {
      fail("weave-shape.mjs", `"${level}" sprouts torn fibres — that rung is meant to loosen, not come apart`);
    }
    if (level === "unraveling" && !fibred.every(Boolean)) {
      fail("weave-shape.mjs", "Unraveling does not splay every thread into fibres — that is the top rung's whole picture");
    }
  }

  /* A DASH ARRAY WITH A NEGATIVE OR NaN ENTRY IS DISCARDED WHOLE by the
     browser, and a thread whose dash array was discarded simply never parts.
     That is the look of the feature not working, on every rung at once, with
     nothing reported — so every pattern the ladder can produce is evaluated. */
  for (const { level, p: params } of rungs) {
    for (let i = 0; i < weave.THREADS; i++) {
      const dash = weave.dashPattern(i, params);
      for (const [name, pattern] of [["line", dash.line], ["fibre", dash.fibre], ["flow", weave.flowDash()]]) {
        if (!pattern) continue;
        for (const n of pattern) {
          if (!Number.isFinite(n) || n < 0) fail("weave-shape.mjs", `${level} thread ${i}: ${name} dash array has an invalid entry (${n})`);
        }
        const total = pattern.reduce((a, b) => a + b, 0);
        if (!(total > 0)) fail("weave-shape.mjs", `${level} thread ${i}: ${name} dash array sums to ${total}`);
      }
      // The two must share one period or they drift out of register and the
      // fibres end up in the middle of the thread instead of at a torn end.
      if (dash.fibre) {
        const linePeriod = dash.line[0] + dash.line[1];
        const fibrePeriod = dash.fibre.reduce((a, b) => a + b, 0);
        if (Math.abs(linePeriod - fibrePeriod) > 0.05) {
          fail("weave-shape.mjs", `${level} thread ${i}: the fibres' period (${fibrePeriod}) is not the thread's (${linePeriod})`);
        }
      }
    }
  }

  /* THE DRIFT IS A TRANSLATION OF EXACTLY ONE WAVELENGTH, which is only
     seamless because every term of the wave is a harmonic of the fundamental.
     A non-harmonic term (the obvious way to make a wave look less mechanical)
     renders beautifully and then snaps, once per loop, forever. */
  const path = weave.threadPath(0, { width: 200, height: 40, amplitude: 3, seed: 7 });
  if (!/^M/.test(path) || !/C/.test(path)) fail("weave-shape.mjs", "threadPath does not emit a cubic path");
  if (/NaN|Infinity|undefined/.test(path)) fail("weave-shape.mjs", "threadPath emitted a non-finite coordinate");
  const HARMONIC = /^\s*(?:(\d+)\s*\*\s*)?k\s*\*\s*x\s*\+\s*p\d+\s*$/;
  for (const [, arg] of stripComments(shape).matchAll(/Math\.(?:sin|cos)\(([^)]*)\)/g)) {
    const harmonic = arg.match(HARMONIC);
    // A whole-number multiple of k, or none at all. Anything else — 1.87 is the
    // obvious pick, because it makes the wave look less mechanical — has a
    // period the translation is not a multiple of, so the loop snaps once per
    // wavelength, forever, and looks entirely correct in between.
    if (!harmonic || (harmonic[1] !== undefined && !Number.isInteger(Number(harmonic[1])))) {
      fail("weave-shape.mjs", `the wave has a term that is not a whole harmonic of k ("${arg.trim()}") — the drift loop would snap once per wavelength`);
    }
  }

  /* EVERY LENGTH IS A FIXED CSS PIXEL COUNT, never a fraction of the chip.
     This is the shader's `CRACK_FIELD_PX` rule surviving the move: tied to the
     strip's height, a shorter chip shrinks the weave with it and the same
     pattern reads as crushed. A smaller chip must show LESS of the weave. */
  if (/height\s*\*/.test(stripComments(shape).replace(/height \/ 2/g, ""))) {
    fail("weave-shape.mjs", "scales a length by the container's height — a shorter chip would crush the weave rather than show less of it");
  }
  if (!/BLEED_PX/.test(shape)) fail("weave-shape.mjs", "no BLEED_PX — the weave would be clipped to the chip's four straight lines");

  /* THE BLEED IS STATED TWICE, in the CSS that positions the element and in the
     viewBox the geometry is built against. They must agree exactly or the
     threads are laid out for a box that is not the one they are drawn in — a
     stretch nothing reports. */
  {
    const css = read("styles/pf2e-arcane-surge.css");
    const declared = css.match(/--glas-bleed:\s*(\d+(?:\.\d+)?)px/);
    if (!declared) fail("css", ".glas-weave declares no --glas-bleed");
    else if (Number(declared[1]) !== weave.BLEED_PX) {
      fail("css", `--glas-bleed is ${declared[1]}px but weave-shape.mjs builds its viewBox for ${weave.BLEED_PX}px`);
    }
    if (!/offsetWidth \+ BLEED_PX \* 2/.test(read(`${FEATURE}/weave-render.mjs`))) {
      fail("weave-render.mjs", "does not build its viewBox from the container plus BLEED_PX — the CSS box and the geometry would disagree");
    }
  }
}

/* ══════════════════════════════════════════════════════════════════════
   5c. Instability is its OWN pattern, not the break fracture
   ══════════════════════════════════════════════════════════════════════
   The HUD weave once ran the suite's shared glass fracture out of
   `core/fx-glsl.mjs`. It does not any more, on purpose: a broken creature's
   token, its initiative card and its health bar all carry that crack, and a
   world coming apart then read as one more thing being broken. Re-importing
   the shared field reads as tidying in its own diff and puts the two states
   back into one look, so it is refused — from the shader module it was removed
   from, and from the DOM layer that replaced it. */

{
  for (const rel of ["shader.mjs", "weave.mjs", "weave-render.mjs", "weave-shape.mjs"]) {
    if (/^\s*import\b[^;]*core\/fx-glsl\.mjs/m.test(read(`${FEATURE}/${rel}`))) {
      fail(rel, "imports core/fx-glsl.mjs — instability must not share the break fracture's look");
    }
  }
}

/* ══════════════════════════════════════════════════════════════════════
   5d. A stability level's colour is ONE statement
   ══════════════════════════════════════════════════════════════════════
   It used to be two: a `LEVEL_KEYS` table in palette.mjs feeding the shader's
   uniforms, and a `.glas-level-*` accent remap for the chip's marker two
   pixels away. They drifted immediately — `unbound` sat on --gl-holo-b, which
   gl-tokens.css aliases to --gl-violet, so the ladder's two most dangerous
   rungs rendered in exactly the same colour and both files looked correct.

   The weave is DOM now and inherits --gl-accent, so the CSS is the only
   statement and the drift is gone by construction. What is left to check is
   what the CSS alone can still get wrong: a rung with no rule, two rungs on one
   token, or a rung with no pale variant behind --glas-hot, which is the one
   colour the token file does not derive and cannot be mixed to. */

{
  const css = read("styles/pf2e-arcane-surge.css");
  const tokens = read("styles/gl-tokens.css");
  const seen = new Map();

  for (const level of LEVELS) {
    const rule = css.match(new RegExp(`\\.glas-level-${level}\\s*\\{([^}]*)\\}`));
    if (!rule) {
      fail("css", `no .glas-level-${level} accent remap`);
      continue;
    }
    const accent = rule[1].match(/--gl-accent:\s*var\((--gl-[a-z0-9-]+)\)/);
    const hot = rule[1].match(/--glas-hot:\s*var\((--gl-[a-z0-9-]+)\)/);
    if (!accent) {
      fail("css", `.glas-level-${level} routes no --gl-accent`);
      continue;
    }
    if (!hot) fail("css", `.glas-level-${level} sets no --glas-hot — the energy running along its threads would fall back to the thread's own colour`);
    else if (hot[1] !== `${accent[1]}-hot`) {
      fail("css", `.glas-level-${level} pairs ${accent[1]} with ${hot[1]} — the pale variant must be that hue's own`);
    }
    for (const token of [accent[1], hot?.[1]].filter(Boolean)) {
      if (!new RegExp(`\\s${token}:\\s*`).test(tokens)) {
        fail("css", `.glas-level-${level} names ${token}, which gl-tokens.css does not declare`);
      }
    }
    if (seen.has(accent[1])) {
      fail("css", `"${level}" and "${seen.get(accent[1])}" share ${accent[1]} — the two rungs are indistinguishable`);
    }
    seen.set(accent[1], level);
  }
}

/* ══════════════════════════════════════════════════════════════════════
   6. Load shedding is bidirectionally complete
   ══════════════════════════════════════════════════════════════════════ */

{
  const order = anim.SHED_ORDER;
  if (!Array.isArray(order) || !order.length) fail("anim.mjs", "SHED_ORDER is empty");
  const hosts = [read(`${FEATURE}/weave-render.mjs`), read(`${FEATURE}/burst.mjs`)].join("\n");
  const gated = new Set([...hosts.matchAll(/allows\(\s*["'](\w+)["']\s*\)/g)].map((m) => m[1]));
  for (const name of gated) {
    if (!order.includes(name)) fail("anim.mjs", `"${name}" is gated on but missing from SHED_ORDER — it never degrades`);
  }
  for (const name of order) {
    if (!gated.has(name)) fail("anim.mjs", `SHED_ORDER lists "${name}" but nothing gates on it`);
  }
}

/* ══════════════════════════════════════════════════════════════════════
   7. JS timing mirrors its CSS duration token
   ══════════════════════════════════════════════════════════════════════ */

{
  const css = read("styles/pf2e-arcane-surge.css");
  const tokens = read("styles/gl-tokens.css");
  const tokenMs = (name) => {
    const m = tokens.match(new RegExp(`--gl-d-${name}:\\s*calc\\((\\d+)ms`));
    return m ? Number(m[1]) : null;
  };

  /* The struck word is a CSS animation riding a beat timed in JS. If the word
     outlives its canvas it hangs on screen after the effect behind it has gone;
     if the beat outlives the word by too much, the tail plays with nothing in
     the middle of it. Neither errors. */
  const cinematic = tokenMs("cinematic");
  if (!cinematic) fail("timing", "--gl-d-cinematic not found in gl-tokens.css");
  else {
    const burstMs = shader.BURST_SECONDS * 1000;
    const verdictMs = shader.SEVERITY_SECONDS * 1000;
    if (cinematic > burstMs) fail("timing", `the word animation (${cinematic}ms) outlives the surge beat (${burstMs}ms)`);
    if (cinematic > verdictMs) fail("timing", `the word animation (${cinematic}ms) outlives the verdict beat (${verdictMs}ms)`);
  }
  // The verdict must be the shorter of the two: the GM is about to speak over it.
  if (shader.SEVERITY_SECONDS >= shader.BURST_SECONDS) {
    fail("timing", "the verdict beat is not shorter than the surge beat");
  }
  if (!/@keyframes\s+glas-strike/.test(css)) fail("css", "the struck word has no glas-strike keyframes");
  // A bare `gl-` keyframe name would silently override another feature's.
  if (/@keyframes\s+gl-(?!as-)/.test(css)) fail("css", "declares an unprefixed gl- keyframe, which is a global name");
  /* The weave is a LOCAL layer: absolute, inside the chip, and under the chip's
     own content so the level's name stays readable at Unraveling. If this ever
     goes back to `position: fixed` it is a full-screen veil again, which is the
     thing it was replaced for being. */
  {
    const block = css.match(/\.glas-weave\s*\{([^}]*)\}/s);
    if (!block) fail("css", "no .glas-weave rule — the weave would be unpositioned");
    else {
      if (!/position:\s*absolute/.test(block[1])) fail("css", ".glas-weave must be absolute inside the chip, not fixed to the viewport");
      if (!/z-index:\s*0/.test(block[1])) fail("css", ".glas-weave must sit under the chip's text");
      /* An SVG with no `fill: none` fills every path black. The paths are open
         curves, so what that draws is a solid wedge under the label — and it is
         the DEFAULT, so it arrives the moment somebody restates this rule. */
      if (!/fill:\s*none/.test(block[1])) fail("css", ".glas-weave must set fill: none, or every thread fills black under the label");
    }
    // The bleed is only a bleed if nothing clips it.
    if (!/#glct-hud \.glas-slot\s*\{[^}]*overflow:\s*visible/s.test(css)) {
      fail("css", "the HUD's stability slot clips its contents — the weave would be cut off at the chip's edge");
    }
  }
  /* Every stroke in the weave is a hairline stated in CSS pixels, which is the
     whole reason this is cheaper than the shader was: a CSS pixel is never
     sub-pixel, so nothing has to be recomputed against devicePixelRatio or the
     suite's Interface Scale zoom to survive a HiDPI display. A stroke width
     given as a percentage or an em would scale with the host's type instead. */
  for (const layer of ["halo", "line", "fibre", "flow"]) {
    const block = css.match(new RegExp(`\\.glas-weave-${layer}\\s*\\{([^}]*)\\}`, "s"));
    if (!block) {
      fail("css", `no .glas-weave-${layer} rule — that layer would draw with the inherited stroke`);
      continue;
    }
    const width = block[1].match(/stroke-width:\s*([^;]+);/);
    if (!width) fail("css", `.glas-weave-${layer} states no stroke-width`);
    else if (!/^\s*[\d.]+(px)?\s*$/.test(width[1])) {
      fail("css", `.glas-weave-${layer} sizes its stroke as "${width[1].trim()}" — a hairline has to be a fixed CSS pixel count`);
    }
    if (!/stroke:\s*var\(--gl/.test(block[1])) {
      fail("css", `.glas-weave-${layer} does not route its colour through a token — the weave would stop following the level and a retheme`);
    }
  }
  if (!/\.glas-burst\b[^}]*z-index:\s*var\(--gl-z-splash\)/s.test(css)) {
    fail("css", ".glas-burst must use --gl-z-splash");
  }
  for (const cls of ["glas-weave", "glas-burst"]) {
    const block = css.match(new RegExp(`\\.${cls}\\b[^{]*\\{([^}]*)\\}`, "s"));
    if (!block || !/pointer-events:\s*none/.test(block[1])) {
      fail("css", `.${cls} must set pointer-events: none or it will eat clicks`);
    }
  }
}

/* ══════════════════════════════════════════════════════════════════════
   8. Runtime-built i18n keys resolve
   ══════════════════════════════════════════════════════════════════════
   `GLAS.level.<id>`, `GLAS.tier.<id>` and `GLAS.mode.<id>` are assembled from
   enum values at runtime. Nothing else in the repo checks them. */

{
  const lang = JSON.parse(read("lang/pf2e-arcane-surge.en.json"));
  const has = (key) => key.split(".").reduce((node, part) => (node == null ? undefined : node[part]), lang) !== undefined;

  for (const level of LEVELS) {
    if (!has(`GLAS.level.${level}`)) fail("i18n", `missing GLAS.level.${level}`);
    if (!has(`GLAS.levelHint.${level}`)) fail("i18n", `missing GLAS.levelHint.${level}`);
  }
  for (const row of ROWS) if (!has(`GLAS.row.${row}`)) fail("i18n", `missing GLAS.row.${row}`);
  for (const tier of TIERS) {
    if (!has(`GLAS.tier.${tier}`)) fail("i18n", `missing GLAS.tier.${tier}`);
    if (!has(`GLAS.tierHint.${tier}`)) fail("i18n", `missing GLAS.tierHint.${tier}`);
  }
  for (const mode of ["none", "steadied", "invited"]) {
    if (!has(`GLAS.mode.${mode}`)) fail("i18n", `missing GLAS.mode.${mode}`);
  }

  // The Control Center's entry for this feature. Held as FLAT keys in the
  // feature's own lang file, which is the convention every other feature here
  // follows — putting them in lang/en.json would work but would scatter one
  // feature's strings across two files.
  for (const key of ["GLS.feature.pf2e-arcane-surge.title", "GLS.feature.pf2e-arcane-surge.hint"]) {
    if (lang[key] === undefined) fail("i18n", `missing ${key} in lang/pf2e-arcane-surge.en.json`);
  }
}

/* ══════════════════════════════════════════════════════════════════════
   9. The die takes its denomination defensively
   ══════════════════════════════════════════════════════════════════════
   `CONFIG.Dice.terms` is a global single-character namespace shared with every
   other module. Overwriting an occupied letter breaks the other module's die
   with no error on either side. */

{
  const dieSrc = read(`${FEATURE}/die.mjs`);
  const write = dieSrc.search(/CONFIG\.Dice\.terms\[[^\]]*\]\s*=/);
  const readBack = dieSrc.search(/CONFIG\.Dice\.terms\[[^\]]*\]\s*(?!=)/);
  if (write < 0) fail("die.mjs", "does not register into CONFIG.Dice.terms");
  // The invariant is ordering, not spelling: the term must be READ before it is
  // written, so an occupied letter can be detected instead of clobbered.
  else if (readBack < 0 || readBack >= write) {
    fail("die.mjs", `takes "${SURGE_DIE_DENOMINATION}" without first reading whether another module holds it`);
  }
  if (!dieSrc.includes("SURGE_DIE_FALLBACK_NOTATION")) {
    fail("die.mjs", "has no plain-d20 fallback for a denomination collision");
  }
}

/* ══════════════════════════════════════════════════════════════════════
   10. One casting, one check; one card, one severity roll
   ══════════════════════════════════════════════════════════════════════ */

{
  const checkSrc = read(`${FEATURE}/check.mjs`);
  const sevSrc = read(`${FEATURE}/severity.mjs`);

  if (!/casting/.test(checkSrc)) fail("check.mjs", "does not key on flags.pf2e.casting");
  if (!/origin/.test(checkSrc)) fail("check.mjs", "has no origin-uuid dedup — one casting could check twice");
  if (!/isReroll/.test(checkSrc)) fail("check.mjs", "does not reject rerolls");
  for (const context of ["damage-taken", "self-effect-applied"]) {
    if (!checkSrc.includes(context)) fail("check.mjs", `does not reject the "${context}" context`);
  }
  // Every client sees createChatMessage; exactly one must act. The invariant is
  // that the handler bails out on any client that is not the elected one.
  if (!/!==\s*game\.user\.id\s*\)\s*return/.test(checkSrc)) {
    fail("check.mjs", "does not bail out on clients that are not the elected roller — every client would roll its own result");
  }
  if (!/testUserPermission(?:\s*\?\.)?\s*\(\s*\w+\s*,\s*["']OWNER["']\s*\)/.test(checkSrc)) {
    fail("check.mjs", "does not decide public-vs-private by OWNER-level actor ownership");
  }

  if (!/getFlag|flags/.test(sevSrc)) fail("severity.mjs", "does not read its result back from a flag");
  if (!/inFlight|_pending|lock/i.test(sevSrc)) {
    fail("severity.mjs", "has no in-flight guard — two simultaneous presses would both roll");
  }
}

/* ══════════════════════════════════════════════════════════════════════
   11. Colour comes from the palette, and its one literal copy agrees
   ══════════════════════════════════════════════════════════════════════
   WebGL cannot read a CSS custom property, so the ramp is derived from
   `core/theme.mjs`. `anim.mjs` carries a literal copy purely because the
   preview page inlines it with no module resolution — two statements of one
   colour, which is exactly the drift this asserts away. */

{
  const theme = await import("../scripts/core/theme.mjs");
  const palette = await import(`../${FEATURE}/palette.mjs`);
  const ramp = palette.rampFloats();

  for (const [slot, key] of Object.entries(palette.RAMP_KEYS)) {
    const expected = theme.hexToRgbFloat(theme.PALETTE[key]);
    if (theme.PALETTE[key] === undefined) fail("palette", `PALETTE has no "${key}" for ramp slot "${slot}"`);
    for (let i = 0; i < 3; i++) {
      if (Math.abs(ramp[slot][i] - expected[i]) > 1e-9) {
        fail("palette", `rampFloats().${slot} does not equal hexToRgbFloat(PALETTE.${key})`);
        break;
      }
      // The preview's inlined copy must agree to the precision it is written at.
      if (Math.abs(anim.RAMP[slot][i] - expected[i]) > 5e-4) {
        fail("anim.mjs", `RAMP.${slot} has drifted from PALETTE.${key} — the preview would show the wrong colour`);
        break;
      }
    }
  }

  // No feature file may restate a suite colour as a hex of its own.
  for (const rel of ["weave.mjs", "weave-render.mjs", "weave-shape.mjs", "burst.mjs", "shader.mjs", "anim.mjs"]) {
    const src = read(`${FEATURE}/${rel}`);
    const hexes = [...src.matchAll(/#[0-9a-fA-F]{6}\b/g)].map((m) => m[0]);
    // Hexes inside comments are documentation of where a value came from.
    const live = hexes.filter((hex) => !new RegExp(`(?:\\*|//)[^\\n]*${hex}`).test(src));
    if (live.length) fail(rel, `hardcodes suite colour(s) ${live.join(", ")} — derive them from PALETTE instead`);
  }
}

/* ══════════════════════════════════════════════════════════════════════
   12. The die can label its own face
   ══════════════════════════════════════════════════════════════════════
   The same number is a surge at Unraveling and a blank at Fraying, so the die
   term has to carry the level it was rolled against. A read with no write means
   every face is labelled at the fallback level's threshold — the tooltip and
   the banner then disagree about the same roll, and neither errors. */

{
  const dieSrc = read(`${FEATURE}/die.mjs`);
  const checkSrc = read(`${FEATURE}/check.mjs`);
  const reads = /options\??\.\s*glasLevel/.test(dieSrc);
  const writes = /options\.glasLevel\s*=/.test(dieSrc);
  if (reads && !writes) fail("die.mjs", "reads options.glasLevel but nothing ever writes it");
  if (writes && !/stampLevel\s*\(/.test(checkSrc)) {
    fail("check.mjs", "never stamps the level onto the roll, so the die cannot label its own face");
  }
}

/* ══════════════════════════════════════════════════════════════════════
   13. Privacy: an NPC's check is the GM's alone
   ══════════════════════════════════════════════════════════════════════
   Gating only on `held` leaks a "the weave held" banner — naming the stability
   level — to every player on every enemy spell, which also defeats conceal. */

{
  const bannerSrc = read(`${FEATURE}/banner.mjs`);
  if (!/!check\.playerCast\s*&&\s*!game\.user\.isGM/.test(bannerSrc)) {
    fail("banner.mjs", "does not hide NPC-cast banners from players — a passed NPC check would be public");
  }
  if (!/isConcealed\s*\(/.test(bannerSrc)) {
    fail("banner.mjs", "does not redact the level while concealed — the banner would print it on the first player cast");
  }
  // A released surge must play from exactly one path, or it plays twice.
  if (!/releasedAt/.test(bannerSrc)) {
    fail("banner.mjs", "does not stand down for a released surge — the socket and the re-render would both play it");
  }
  if (!/playBurst\s*\(/.test(read(`${FEATURE}/check.mjs`))) {
    fail("check.mjs", "does not play the burst locally on release — Foundry does not echo a socket to its sender");
  }
}

/* ══════════════════════════════════════════════════════════════════════
   14. A refused denomination means no DSN preset either
   ══════════════════════════════════════════════════════════════════════
   If another module holds the letter, `du` is THEIR die. Registering a preset
   for it repaints their dice with our faces — worse than having no 3D die, and
   it looks like a bug in their module. */

{
  const dsnSrc = read(`${FEATURE}/dsn.mjs`);
  if (!/hasSurgeDie\s*\(\s*\)/.test(dsnSrc)) {
    fail("dsn.mjs", "registers presets without checking hasSurgeDie() — it would repaint another module's die");
  }
}

/* ══════════════════════════════════════════════════════════════════════
   16. This feature does not own the suite-global motion scale
   ══════════════════════════════════════════════════════════════════════
   `applyMotionTier()` writes `--gl-motion-scale` for the whole suite, so a
   second feature applying its own preference silently retimes the three
   features that legitimately own that control. */

{
  for (const rel of ["index.mjs", "main.mjs"]) {
    // Comments stripped first: main.mjs explains in prose why it does NOT do
    // this, and an assertion that cannot tell explanation from code would flag
    // the documentation of its own rule.
    const src = stripComments(read(`${FEATURE}/${rel}`));
    if (/applyMotionTier\s*\(/.test(src)) {
      fail(rel, "calls applyMotionTier() — that writes the suite-global motion scale and would retime other features");
    }
  }
}

/* ══════════════════════════════════════════════════════════════════════
   17. Everything is live, and everything is warm
   ══════════════════════════════════════════════════════════════════════
   The beats run live rather than from baked frames, which is only affordable
   because the programs are compiled at load. A GL program is not really
   compiled when linkProgram returns — drivers specialize on first draw. Lose
   the warm-up and the very first surge of a session stutters, which is the one
   moment it must not, and nothing anywhere reports why. */

{
  const burstSrc = read(`${FEATURE}/burst.mjs`);
  const mainSrc = stripComments(read(`${FEATURE}/main.mjs`));

  if (!/\bwarm\s*\(\s*\)\s*\{/.test(burstSrc)) fail("burst.mjs", "has no warm() — its shader compiles on first use, mid-animation");
  // A warm-up that never reaches the GPU is not a warm-up.
  if (!/gl\.finish\s*\(/.test(burstSrc)) fail("burst.mjs", "warm() does not gl.finish(), so the work stays queued behind the first real frame");
  if (!mainSrc.includes("warmBurst")) fail("main.mjs", "never calls warmBurst() — the beats compile on first use");

  // Baking is gone on purpose; a reintroduced frame set would silently make the
  // effect a filmstrip again.
  if (/BURST_FRAMES|_bake\s*\(|bakedKey/.test(burstSrc)) {
    fail("burst.mjs", "still references baked frames — the beats are meant to run live");
  }

  /* The same reversal was applied to the initiative guard-break splash, which
     this feature deliberately does not share code with but does share a
     rationale. If that one silently goes back to baking, the two overlays stop
     behaving alike and CLAUDE.md's note about it becomes wrong. */
  const splashSrc = read("scripts/features/initiative/gluniverse-initiative.mjs");
  if (/SPLASH_BAKE_FRAMES/.test(splashSrc)) {
    fail("initiative", "the break splash is baking frames again");
  }
  if (!/\bwarm\s*\(\s*\)\s*\{/.test(splashSrc)) {
    fail("initiative", "the break splash has no warm() — its first play of a session would stutter");
  }
}

/* ══════════════════════════════════════════════════════════════════════
   18. The tier hues agree between the card and the full-screen verdict
   ══════════════════════════════════════════════════════════════════════
   The severity card and the verdict beat fire together. Two different reds
   would read as two different results. */

{
  const palette = await import(`../${FEATURE}/palette.mjs`);
  const css = read("styles/pf2e-arcane-surge.css");

  for (const tier of TIERS) {
    const key = palette.TIER_KEYS[tier];
    if (!key) {
      fail("palette.mjs", `TIER_KEYS has no entry for tier "${tier}"`);
      continue;
    }
    // The CSS remaps --gl-accent per tier; the shader takes the same hue as a
    // uniform. Both must name the same token.
    const rule = css.match(new RegExp(`\\.glas-tier-${tier}\\s*\\{([^}]*)\\}`));
    if (!rule) fail("css", `no .glas-tier-${tier} accent remap`);
    else if (!rule[1].includes(`--gl-${key.replace(/([A-Z])/g, "-$1").toLowerCase()}`)) {
      fail("css", `.glas-tier-${tier} does not use --gl-${key} — the card and the verdict beat would disagree`);
    }
  }
  for (const tier of Object.keys(palette.TIER_KEYS)) {
    if (!TIERS.includes(tier)) fail("palette.mjs", `TIER_KEYS has a dead entry "${tier}"`);
  }
}

/* ══════════════════════════════════════════════════════════════════════
   19. Dice surfaces cover both kinds of die
   ══════════════════════════════════════════════════════════════════════
   The surge d20 is read by its glyph and needs per-face relief; the severity
   d100 is read by its number and needs a tiling surface under the numerals.
   Missing the second is what makes the severity roll look like a default die.

   Neither carries any painted colour: the point is to see Dice So Nice's own
   frosted glass. Two of these files exist only to make that possible, and both
   look like mistakes — see the headers of `dsn.mjs` and the baker. */

{
  const { existsSync } = await import("node:fs");
  const shipped = [
    "clear", "blank-bump", "blank-emissive", "surge-bump", "surge-emissive", "surface", "surface-bump",
  ];
  for (const file of shipped) {
    const rel = `assets/pf2e-arcane-surge/dice/${file}.png`;
    if (!existsSync(join(ROOT, rel))) fail("dice", `missing ${rel} — run tools/gen-surge-textures.mjs`);
  }
  /* The albedo maps are gone on purpose. If they come back, either somebody has
     painted the dice again or the baker has quietly reverted to a faces × maps
     cross product, and the material stops being what the table sees. */
  for (const file of ["blank", "surge"]) {
    if (existsSync(join(ROOT, `assets/pf2e-arcane-surge/dice/${file}.png`))) {
      fail("dice", `${file}.png is back — the face art is meant to be relief and light only`);
    }
  }

  /* Read the colorset's own body, comment-stripped: every field below is a
     common English word, and the prose around them must not be able to satisfy
     an assertion about the code. */
  const colorsetSrc = stripComments(dsnSrc).match(/function colorset\(\)[\s\S]*?\n}/)?.[0] ?? "";
  if (!colorsetSrc) fail("dsn.mjs", "no colorset() to check — the 3D theme is built somewhere this tool cannot see");

  /* THE TRANSPARENT LABEL IS LOAD-BEARING. Dice So Nice draws a face's
     bumpMaps and emissiveMaps only in the branch it takes when that face's
     label resolves to an image; a text label (including "") goes down a path
     that never reads them. Swapping clear.png for "" therefore removes the
     whirlpool from every die while looking like a simplification, and nothing
     errors. */
  if (!/clear/.test(dsnSrc)) {
    fail("dsn.mjs", "no transparent label carrier — DSN would silently ignore every bumpMap and emissiveMap");
  }
  if (!/labels:\s*faces\.map\(/.test(dsnSrc)) {
    fail("dsn.mjs", "the preset passes no per-face labels array, which is what DSN keys the face maps off");
  }
  for (const map of ["bumpMaps", "emissiveMaps"]) {
    if (!dsnSrc.includes(map)) fail("dsn.mjs", `the preset has no ${map} — with no albedo, that face carries nothing at all`);
  }

  if (!/addTexture\s*\(/.test(dsnSrc)) {
    fail("dsn.mjs", "registers no texture, so numbered dice (the severity d100 and its d10s) get no frosted surface");
  }
  /* And the same trap on the texture side: DSN draws a texture's `bump` only
     inside the block that draws its `source`, so the frost on the numbered dice
     needs a white source under `multiply` — the identity — rather than none. */
  if (!/composite:\s*["']multiply["']/.test(dsnSrc)) {
    fail("dsn.mjs", "the frost texture is not composited multiply, so its white source would paint over the glass instead of leaving it alone");
  }
  if (!/material:\s*["']glass["']/.test(dsnSrc)) fail("dsn.mjs", "the colorset is not frosted glass");

  /* And the third trap, which is the one that actually shipped broken. On a
     transmissive material DSN binds the finished bump canvas a SECOND time as
     the material's transmissionMap and reads it through smoothstep(0.6, 0.9).
     So the height field is also the glass/solid decision, and a flat level
     under 0.9 makes the die opaque — which is what happened: a field at
     141/255 put 94% of every face below the curve, the glass rendered as a
     black solid with no albedo on it, and nothing anywhere errored.

     The band is asserted where the pixels are, in the baker's own --check.
     Here we only hold the baker to declaring it, because a recipe that stops
     naming these is a recipe that has stopped thinking about them. */
  for (const name of ["GLASS_TOP", "SOLID_FLOOR"]) {
    if (!bakerSrc.includes(name)) {
      fail("gen-surge-textures.mjs", `does not define ${name} — the bump is also the transmission mask and its band has to be stated somewhere`);
    }
  }
  if (!/transmission/i.test(bakerSrc)) {
    fail("gen-surge-textures.mjs", "says nothing about transmission, so the next person to retune the bump will take the die's glass away without knowing");
  }

  /* AND WHERE THE FACE IS. The square the baker draws is a texture TILE; what
     samples it is a triangle whose centroid sits at y = 0.576, not 0.5, and
     whose largest inscribed circle is 0.575 of the half-tile. Art composed on
     the SQUARE is therefore both off-centre and clipped by the die's own edges,
     and it looks perfectly correct in the contact sheet, which prints squares.
     That is how the rings shipped: struck at 0.62 about the square's centre, so
     every one of them ran off two of its three edges, twenty times per die. The
     pixels are measured in the baker's own --check; here we only hold it to
     naming the geometry, because a recipe that has stopped stating it is a
     recipe that has stopped thinking about it. */
  for (const name of ["FACE_TRIANGLE", "FACE_INRADIUS"]) {
    if (!bakerSrc.includes(name)) {
      fail("gen-surge-textures.mjs", `does not define ${name} — a d20 face is a triangle that is not concentric with its texture tile, and art centred on the tile is clipped by the die's own edges`);
    }
  }

  /* THE DIE'S BODY AND THE MARK BURNING INSIDE IT ARE ONLY MEANINGFUL AGAINST
     EACH OTHER, and they are written in two entirely different files — the body
     reaches DSN as a colorset field, the glyph is baked into an emissive PNG by
     the texture tool. Stated separately they drifted onto the same colour
     immediately: the die was the feature's teal and so was the whirlpool, so
     the one thing the die exists to say was invisible, and each half looked
     perfectly correct in its own file.

     Both now come from DIE_KEYS, and this measures the distance between them —
     on EITHER of the two axes a mark can be seen by. Hue is the obvious one and
     was the only one measured at first, which was wrong: the die is black glass
     now, and at that value a hue is not a colour anybody can see. So a hue
     separation OR a value separation satisfies it, and one of them must.

     Two more, both of which black glass is what made necessary. The glyph has
     to out-value the body, because it is a light source burning inside it. And
     the EDGE has to out-value the body too: DSN paints the bevels between the
     faces with it, and on a dark die that is the only thing giving the shape a
     silhouette against the table. */
  let dieBodyLum = null;
  {
    const { DIE_KEYS } = await import(`../${FEATURE}/palette.mjs`);
    const { PALETTE } = await import("../scripts/core/theme.mjs");
    const hueOf = (hex) => {
      const n = parseInt(hex.slice(1), 16);
      const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
      const mx = Math.max(r, g, b), d = mx - Math.min(r, g, b);
      if (!d) return 0;
      const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
      return (h * 60 + 360) % 360;
    };
    const lumOf = (hex) => {
      const n = parseInt(hex.slice(1), 16);
      return 0.2126 * (((n >> 16) & 255) / 255) + 0.7152 * (((n >> 8) & 255) / 255) + 0.0722 * ((n & 255) / 255);
    };

    for (const role of ["body", "edge", "glyph"]) {
      if (!DIE_KEYS?.[role]) fail("palette.mjs", `DIE_KEYS has no "${role}"`);
      else if (!PALETTE[DIE_KEYS[role]]) fail("palette.mjs", `DIE_KEYS.${role} names "${DIE_KEYS[role]}", which is not a colour in PALETTE`);
    }
    const bodyHex = PALETTE[DIE_KEYS?.body];
    const glyphHex = PALETTE[DIE_KEYS?.glyph];
    const edgeHex = PALETTE[DIE_KEYS?.edge];
    if (bodyHex) dieBodyLum = lumOf(bodyHex);
    if (bodyHex && glyphHex) {
      let apart = Math.abs(hueOf(bodyHex) - hueOf(glyphHex));
      if (apart > 180) apart = 360 - apart;
      const value = lumOf(glyphHex) - lumOf(bodyHex);
      if (apart < 45 && value < 0.35) {
        fail("palette.mjs", `the die's body (${DIE_KEYS.body}) and its surge glyph (${DIE_KEYS.glyph}) are ${apart.toFixed(0)}° apart in hue and ${value.toFixed(2)} apart in value — the mark reads against the glass it burns in on neither axis`);
      }
      if (value <= 0) {
        fail("palette.mjs", `the surge glyph (${DIE_KEYS.glyph}) is no brighter than the body (${DIE_KEYS.body}); it is a light source inside the die and has to out-value it`);
      }
    }
    if (bodyHex && edgeHex) {
      const rim = lumOf(edgeHex) - lumOf(bodyHex);
      if (rim < 0.2) {
        fail("palette.mjs", `the die's bevels (${DIE_KEYS.edge}) are only ${rim.toFixed(2)} brighter than its body (${DIE_KEYS.body}); the edge is the whole silhouette of a dark die`);
      }
    }
    // And neither file may state a colour of its own any more.
    if (/background:\s*PALETTE\.\w/.test(colorsetSrc)) {
      fail("dsn.mjs", "the colorset names a palette colour directly instead of going through DIE_KEYS, which is how the body and the glyph drifted onto the same hue");
    }
    /* The baker must USE the shared hue, not merely import it. Matching the
       import alone passes on a file that imports it and then writes literals
       anyway, which is exactly the state this is here to prevent. */
    const emission = stripComments(bakerSrc).match(/emissive\[i \* 3[^\]]*\]\s*=[^;]+;/g) ?? [];
    if (!emission.length) fail("gen-surge-textures.mjs", "no emissive write found — this tool can no longer see how the glyph is lit");
    else if (!emission.every((line) => /GLYPH_RGB/.test(line))) {
      fail("gen-surge-textures.mjs", "the emissive map writes a literal colour instead of DIE_KEYS' hue, so the glyph can drift onto the body's colour again");
    }
  }

  /* A COLORSET WITHOUT ITS THREE IDENTITY FIELDS BREAKS SOMEBODY ELSE'S UI.
     `addColorset` supplies defaults for the appearance keys but NOT for these,
     then does `COLORSETS[colorset.name] = colorset` — so a missing `name`
     registers the theme under the literal key "undefined" and every die quietly
     falls back to the player's own colorset, frosted glass and all. Worse,
     `Utils.prepareColorsetList` localizes `description` and `category` to build
     the 3D-dice settings dialog and then sorts on the result: an undefined
     description reaches `.localeCompare` and throws, which does not break these
     dice, it breaks THAT DIALOG for every user in the world. This shipped once
     and did both at the same time. */
  for (const field of ["name", "description", "category"]) {
    if (!new RegExp(`\\b${field}:\\s*\\S`).test(colorsetSrc)) {
      fail("dsn.mjs", `the colorset has no \`${field}\` — DSN needs all three, and without them the theme never resolves and its settings dialog throws`);
    }
  }
  if (!/name:\s*DSN_COLORSET/.test(colorsetSrc)) {
    fail("dsn.mjs", "the colorset's name is not DSN_COLORSET, so the name tagRoll asks for is not the name it registered under");
  }

  /* THE NUMBERED DICE'S NUMERALS HAVE TO READ, and there are exactly two ways
     to get there. `emissiveLabels` lights DSN's own numeral canvas — a colorset
     has no emissive MAP slot, so it is the only emission channel one has. Or
     the body is dark enough that a white numeral with an `ink0` outline carries
     itself.

     Which is not a free choice. Emission on ANY die switches DSN's whole scene
     onto its bloom path for the length of the throw — a second full render plus
     ten blur passes, and on a transmissive material a second full-viewport 4×
     MSAA transmission pass with it. So the second route is the cheap one, and
     it is only open while the glass stays black. Lighten the body again and
     this asks for the glow back. */
  if (!/emissiveLabels:\s*true/.test(dsnSrc) && !(dieBodyLum !== null && dieBodyLum < 0.15)) {
    fail("dsn.mjs", "the colorset neither lights its labels nor sits on glass dark enough to carry an unlit numeral, so the severity roll's numbers are cut into glass nothing separates them from");
  }

  /* AND THE PRESETS HAVE TO BE WARMED. DSN loads a preset's images lazily,
     inside `create()` at the first throw, with one await per face — sixty
     serial round-trips for a preset like this one, times the three level
     systems, in the middle of an animation. 6.2.9 added
     `preloadPresets(systemId)` precisely for presets a user never selects in
     their own appearance settings, which is all three of ours, and says in its
     own source that without it they "cause visible lag". */
  if (!/preloadPresets/.test(stripComments(dsnSrc))) {
    fail("dsn.mjs", "does not warm its presets — DSN fetches a preset's twenty labels, twenty bumps and twenty emissive maps one await at a time inside the first roll");
  }

  /* Bump and emissive maps both live behind DSN's "realistic lighting", which
     Foundry's Low performance mode turns off. A die carrying nothing else is
     twenty identical faces there, so the registration has to notice. */
  if (!/bumpMapping/.test(dsnSrc)) {
    fail("dsn.mjs", "does not check DSN's realistic-lighting setting; with it off these dice have no relief, no glow and no albedo — twenty blank faces");
  }
  if (!/tagSeverityRoll/.test(read(`${FEATURE}/severity.mjs`))) {
    fail("severity.mjs", "does not dress its roll, so the d100 would not match the surge die");
  }
  // The numerals must be the HUD's face, or the die and the clock above it read
  // as two different objects.
  if (!/Oxanium/.test(dsnSrc)) fail("dsn.mjs", "the dice font is not the suite display face");
  if (!/fontDefinitions/.test(dsnSrc)) {
    fail("dsn.mjs", "does not declare the font to Foundry — Dice So Nice would fetch it from a CDN");
  }
}

/* ══════════════════════════════════════════════════════════════════════
   Report
   ══════════════════════════════════════════════════════════════════════ */

if (problems.length) {
  console.error(`\narcane-surge-check: ${problems.length} problem${problems.length === 1 ? "" : "s"}\n`);
  for (const line of problems) console.error(`  • ${line}`);
  console.error("");
  process.exitCode = 1;
} else {
  console.log("arcane-surge-check: no problems");
}
